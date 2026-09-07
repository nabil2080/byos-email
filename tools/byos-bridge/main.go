package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
)

// BYOS Local IMAP/SMTP Bridge (Section 19)
// Provides a local loopback proxy on 127.0.0.1:1143 (IMAP) and 127.0.0.1:1025 (SMTP)
// for native desktop email clients (Thunderbird, Apple Mail, Outlook).

type BridgeConfig struct {
	ApiURL     string
	MailboxID  string
	Token      string
	ImapPort   string
	SmtpPort   string
	StorageDir string
}

type bridgeMessage struct {
	MessageSeq int64    `json:"message_seq"`
	Sender     string   `json:"sender"`
	Recipients []string `json:"recipients"`
	ReceivedAt string   `json:"received_at"`
	SentAt     string   `json:"sent_at"`
}

func fetchBridgeMessages(cfg *BridgeConfig) ([]bridgeMessage, bool) {
	req, err := http.NewRequest(http.MethodGet, cfg.ApiURL+"/v1/bridge/messages?mailbox_id="+cfg.MailboxID, nil)
	if err != nil {
		return nil, false
	}
	req.Header.Set("X-BYOS-Bridge-Token", cfg.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, false
	}
	var payload struct {
		Messages []bridgeMessage `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, false
	}
	return payload.Messages, true
}

func fetchBridgeMessageCount(cfg *BridgeConfig) (int, bool) {
	messages, ok := fetchBridgeMessages(cfg)
	return len(messages), ok
}

func writeHeaderFetch(writer *bufio.Writer, tag string, message bridgeMessage) {
	date := message.ReceivedAt
	if message.SentAt != "" {
		date = message.SentAt
	}
	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\nDate: %s\r\nMessage-ID: <%d.%d@byos.local>\r\n\r\n",
		message.Sender, strings.Join(message.Recipients, ", "), date, message.MessageSeq, message.MessageSeq)
	writer.WriteString(fmt.Sprintf("* %d FETCH (UID %d BODY[HEADER] {%d}\r\n%s)\r\n", message.MessageSeq, message.MessageSeq, len(headers), headers))
	writer.WriteString(fmt.Sprintf("%s OK FETCH completed\r\n", tag))
}

func authenticateWithAPI(cfg *BridgeConfig) bool {
	payload := fmt.Sprintf(`{"mailbox_id":%q,"token":%q}`, cfg.MailboxID, cfg.Token)
	req, err := http.NewRequest(http.MethodPost, cfg.ApiURL+"/v1/bridge/authenticate", strings.NewReader(payload))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusNoContent
}

func main() {
	apiURL := flag.String("api-url", "http://127.0.0.1:8080", "BYOS API URL")
	mailboxID := flag.String("mailbox-id", "", "Mailbox UUID")
	token := flag.String("token", "", "Bridge access token (byos_bridge_...)")
	imapPort := flag.String("imap-port", "1143", "Local IMAP listening port")
	smtpPort := flag.String("smtp-port", "1025", "Local SMTP listening port")
	flag.Parse()

	if *mailboxID == "" || *token == "" {
		log.Fatal("mailbox-id and token are required")
	}

	cfg := &BridgeConfig{
		ApiURL:    strings.TrimRight(*apiURL, "/"),
		MailboxID: *mailboxID,
		Token:     *token,
		ImapPort:  *imapPort,
		SmtpPort:  *smtpPort,
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("Shutting down BYOS Bridge...")
		cancel()
	}()

	// Start local SMTP listener
	go startSMTPListener(ctx, cfg)

	// Start local IMAP listener
	startIMAPListener(ctx, cfg)
}

func startIMAPListener(ctx context.Context, cfg *BridgeConfig) {
	addr := "127.0.0.1:" + cfg.ImapPort
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("IMAP bridge failed to bind to %s: %v", addr, err)
		return
	}
	defer listener.Close()
	log.Printf("[IMAP] BYOS Bridge listening on %s (loopback only)", addr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				log.Printf("IMAP accept error: %v", err)
				continue
			}
		}
		go handleIMAPConnection(conn, cfg)
	}
}

func handleIMAPConnection(conn net.Conn, cfg *BridgeConfig) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	writer := bufio.NewWriter(conn)
	authenticated := false

	// Initial greeting
	writer.WriteString("* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] BYOS Sovereign Email Bridge Ready\r\n")
	writer.Flush()

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		parts := strings.Split(line, " ")
		if len(parts) < 2 {
			continue
		}
		tag := parts[0]
		cmd := strings.ToUpper(parts[1])

		switch cmd {
		case "CAPABILITY":
			writer.WriteString("* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n")
			writer.WriteString(fmt.Sprintf("%s OK CAPABILITY completed\r\n", tag))
		case "NOOP":
			writer.WriteString(fmt.Sprintf("%s OK NOOP completed\r\n", tag))
		case "LOGIN":
			if len(parts) < 4 || !constantTimeEqual(strings.Trim(parts[3], `"`), cfg.Token) || !authenticateWithAPI(cfg) {
				writer.WriteString(fmt.Sprintf("%s NO authentication failed\r\n", tag))
				break
			}
			authenticated = true
			writer.WriteString(fmt.Sprintf("%s OK [CAPABILITY IMAP4rev1] LOGIN successful\r\n", tag))
		case "AUTH":
			if len(parts) < 3 || !strings.EqualFold(parts[2], "PLAIN") {
				writer.WriteString(fmt.Sprintf("%s NO unsupported authentication mechanism\r\n", tag))
				break
			}
			writer.WriteString("+ \r\n")
			writer.Flush()
			line, readErr := reader.ReadString('\n')
			if readErr != nil {
				return
			}
			raw, decodeErr := base64.StdEncoding.DecodeString(strings.TrimSpace(line))
			fields := bytes.Split(raw, []byte{0})
			if decodeErr != nil || len(fields) != 3 || !constantTimeEqual(string(fields[2]), cfg.Token) || !authenticateWithAPI(cfg) {
				writer.WriteString(fmt.Sprintf("%s NO authentication failed\r\n", tag))
				break
			}
			authenticated = true
			writer.WriteString(fmt.Sprintf("%s OK AUTHENTICATE completed\r\n", tag))
		case "SELECT":
			if !authenticated {
				writer.WriteString(fmt.Sprintf("%s NO authenticate first\r\n", tag))
				break
			}
			// The bridge must never invent server-side messages. A real
			// mailbox proxy will populate this from the authenticated API.
			count, ok := fetchBridgeMessageCount(cfg)
			if !ok {
				writer.WriteString(fmt.Sprintf("%s NO mailbox metadata unavailable\r\n", tag))
				break
			}
			writer.WriteString(fmt.Sprintf("* %d EXISTS\r\n", count))
			writer.WriteString("* 0 RECENT\r\n")
			writer.WriteString("* OK [UIDVALIDITY 1] UIDs valid\r\n")
			writer.WriteString(fmt.Sprintf("%s OK [READ-ONLY] SELECT completed\r\n", tag))
		case "FETCH":
			if !authenticated {
				writer.WriteString(fmt.Sprintf("%s NO authenticate first\r\n", tag))
				break
			}
			if len(parts) < 3 || !strings.Contains(strings.ToUpper(parts[2]), "HEADER") {
				writer.WriteString(fmt.Sprintf("%s NO encrypted message body retrieval is not implemented\r\n", tag))
				break
			}
			sequence := strings.Fields(parts[2])[0]
			var requested int64
			if _, err := fmt.Sscan(sequence, &requested); err != nil {
				writer.WriteString(fmt.Sprintf("%s BAD invalid message sequence\r\n", tag))
				break
			}
			messages, ok := fetchBridgeMessages(cfg)
			if !ok {
				writer.WriteString(fmt.Sprintf("%s NO mailbox metadata unavailable\r\n", tag))
				break
			}
			found := false
			for _, message := range messages {
				if message.MessageSeq == requested {
					writeHeaderFetch(writer, tag, message)
					found = true
					break
				}
			}
			if !found {
				writer.WriteString(fmt.Sprintf("%s NO message not found\r\n", tag))
			}
		case "LIST":
			if !authenticated {
				writer.WriteString(fmt.Sprintf("%s NO authenticate first\r\n", tag))
				break
			}
			writer.WriteString(`* LIST (\HasNoChildren) "/" "INBOX"` + "\r\n")
			writer.WriteString(fmt.Sprintf("%s OK LIST completed\r\n", tag))
		case "STATUS":
			if !authenticated {
				writer.WriteString(fmt.Sprintf("%s NO authenticate first\r\n", tag))
				break
			}
			count, ok := fetchBridgeMessageCount(cfg)
			if !ok {
				writer.WriteString(fmt.Sprintf("%s NO mailbox metadata unavailable\r\n", tag))
				break
			}
			writer.WriteString(fmt.Sprintf("* STATUS INBOX (MESSAGES %d UIDNEXT %d UNSEEN 0)\r\n", count, count+1))
			writer.WriteString(fmt.Sprintf("%s OK STATUS completed\r\n", tag))
		case "SEARCH":
			if !authenticated {
				writer.WriteString(fmt.Sprintf("%s NO authenticate first\r\n", tag))
				break
			}
			writer.WriteString(fmt.Sprintf("%s NO message search proxy is not implemented\r\n", tag))
		case "LOGOUT":
			writer.WriteString("* BYE BYOS Bridge logging out\r\n")
			writer.WriteString(fmt.Sprintf("%s OK LOGOUT completed\r\n", tag))
			writer.Flush()
			return
		default:
			writer.WriteString(fmt.Sprintf("%s OK %s completed\r\n", tag, cmd))
		}
		writer.Flush()
	}
}

func startSMTPListener(ctx context.Context, cfg *BridgeConfig) {
	addr := "127.0.0.1:" + cfg.SmtpPort
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Printf("SMTP bridge failed to bind to %s: %v", addr, err)
		return
	}
	defer listener.Close()
	log.Printf("[SMTP] BYOS Bridge listening on %s (loopback only)", addr)

	for {
		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				log.Printf("SMTP accept error: %v", err)
				continue
			}
		}
		go handleSMTPConnection(conn, cfg)
	}
}

func handleSMTPConnection(conn net.Conn, cfg *BridgeConfig) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	writer := bufio.NewWriter(conn)

	writer.WriteString("220 127.0.0.1 BYOS Local SMTP Bridge Service Ready\r\n")
	writer.Flush()

	var from, to string
	authenticated := false
	var inData bool
	var dataBuffer bytes.Buffer

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}

		if inData {
			if strings.TrimRight(line, "\r\n") == "." {
				inData = false
				writer.WriteString("451 4.3.0 outbound encryption proxy is not available\r\n")
				writer.Flush()
				dataBuffer.Reset()
				continue
			}
			dataBuffer.WriteString(line)
			continue
		}

		cmdLine := strings.TrimRight(line, "\r\n")
		parts := strings.SplitN(cmdLine, " ", 2)
		cmd := strings.ToUpper(parts[0])

		switch cmd {
		case "EHLO", "HELO":
			writer.WriteString("250-127.0.0.1 at your service\r\n")
			writer.WriteString("250-8BITMIME\r\n")
			writer.WriteString("250-AUTH PLAIN LOGIN\r\n")
			writer.WriteString("250 OK\r\n")
		case "AUTH":
			if len(parts) < 2 {
				writer.WriteString("501 5.5.2 Authentication mechanism required\r\n")
				break
			}
			authenticated = authenticateSMTP(parts[1], reader, writer, cfg.Token) && authenticateWithAPI(cfg)
		case "MAIL":
			if !authenticated {
				writer.WriteString("530 5.7.0 Authentication required\r\n")
				break
			}
			if len(parts) > 1 {
				from = parts[1]
			}
			writer.WriteString("250 2.1.0 Sender OK\r\n")
		case "RCPT":
			if !authenticated {
				writer.WriteString("530 5.7.0 Authentication required\r\n")
				break
			}
			if len(parts) > 1 {
				to = parts[1]
			}
			writer.WriteString("250 2.1.5 Recipient OK\r\n")
		case "DATA":
			if !authenticated || from == "" || to == "" {
				writer.WriteString("503 5.5.1 Need MAIL FROM and RCPT TO after authentication\r\n")
				break
			}
			inData = true
			dataBuffer.Reset()
			writer.WriteString("354 Start mail input; end with <CRLF>.<CRLF>\r\n")
		case "RSET":
			from, to = "", ""
			dataBuffer.Reset()
			writer.WriteString("250 2.0.0 OK Reset\r\n")
		case "NOOP":
			writer.WriteString("250 2.0.0 OK\r\n")
		case "QUIT":
			writer.WriteString("221 2.0.0 Bye\r\n")
			writer.Flush()
			return
		default:
			writer.WriteString("502 5.5.1 Command not implemented\r\n")
		}
		writer.Flush()
	}
}

func constantTimeEqual(got, expected string) bool {
	if got == "" || expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(expected)) == 1
}

func authenticateSMTP(argument string, reader *bufio.Reader, writer *bufio.Writer, token string) bool {
	if strings.EqualFold(argument, "PLAIN") {
		writer.WriteString("334 \r\n")
		writer.Flush()
		line, err := reader.ReadString('\n')
		if err != nil {
			return false
		}
		raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(line))
		if err != nil {
			writer.WriteString("535 5.7.8 Authentication credentials invalid\r\n")
			return false
		}
		parts := bytes.Split(raw, []byte{0})
		if len(parts) != 3 || !constantTimeEqual(string(parts[2]), token) {
			writer.WriteString("535 5.7.8 Authentication credentials invalid\r\n")
			return false
		}
		writer.WriteString("235 2.7.0 Authentication successful\r\n")
		return true
	}
	writer.WriteString("504 5.5.4 Unsupported authentication mechanism\r\n")
	return false
}
