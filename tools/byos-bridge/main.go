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
	"strconv"
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
	ID         string   `json:"id"`
	Sender     string   `json:"sender"`
	Recipients []string `json:"recipients"`
	ReceivedAt string   `json:"received_at"`
	SentAt     string   `json:"sent_at"`
	Status     string   `json:"status"`
}

type bridgeMessageBody struct {
	EncryptedBody         string `json:"encrypted_body"`
	ContentKeyHPKEWrapped string `json:"content_key_hpke_wrapped"`
	EncryptionIV          string `json:"encryption_iv"`
	AADVersion            int    `json:"aad_version"`
	BundleHash            string `json:"bundle_hash"`
	EncryptionVersion     int    `json:"encryption_version"`
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

func fetchBridgeMessageBody(cfg *BridgeConfig, messageID string) (*bridgeMessageBody, bool) {
	req, err := http.NewRequest(http.MethodGet, cfg.ApiURL+"/v1/bridge/message-body?mailbox_id="+cfg.MailboxID+"&message_id="+messageID, nil)
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
	var body bridgeMessageBody
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, false
	}
	return &body, true
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
	headerBytes := []byte(headers)
	writer.WriteString(fmt.Sprintf("* %d FETCH (UID %d BODY[HEADER] {%d}\r\n", message.MessageSeq, message.MessageSeq, len(headerBytes)))
	writer.Write(headerBytes)
	writer.WriteString(")\r\n")
	writer.WriteString(fmt.Sprintf("%s OK FETCH completed\r\n", tag))
}

func writeBodyFetch(writer *bufio.Writer, tag string, message bridgeMessage, cfg *BridgeConfig) {
	bodyData, ok := fetchBridgeMessageBody(cfg, message.ID)
	if !ok {
		writer.WriteString(fmt.Sprintf("%s NO failed to retrieve encrypted message body\r\n", tag))
		return
	}

	encryptedBytes, err := base64.StdEncoding.DecodeString(bodyData.EncryptedBody)
	if err != nil {
		writer.WriteString(fmt.Sprintf("%s NO invalid encrypted body encoding\r\n", tag))
		return
	}

	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\nDate: %s\r\nMessage-ID: <%d.%d@byos.local>\r\nMIME-Version: 1.0\r\nContent-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\nX-BYOS-Encrypted: true\r\n\r\n",
		message.Sender, strings.Join(message.Recipients, ", "), message.ReceivedAt, message.MessageSeq, message.MessageSeq)
	headerBytes := []byte(headers)
	encodedBody := base64.StdEncoding.EncodeToString(encryptedBytes)
	bodyBytes := []byte(encodedBody)
	totalLen := len(headerBytes) + len(bodyBytes)

	writer.WriteString(fmt.Sprintf("* %d FETCH (UID %d BODY[] {%d}\r\n", message.MessageSeq, message.MessageSeq, totalLen))
	writer.Write(headerBytes)
	writer.Write(bodyBytes)
	writer.WriteString(")\r\n")
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

func searchBridgeMessages(writer *bufio.Writer, tag, criteria string, cfg *BridgeConfig) {
	messages, ok := fetchBridgeMessages(cfg)
	if !ok {
		writer.WriteString(fmt.Sprintf("%s NO mailbox metadata unavailable\r\n", tag))
		return
	}

	matchedSeqs := make([]string, 0)
	criteriaClean := strings.TrimSpace(criteria)
	criteriaUpper := strings.ToUpper(criteriaClean)

	if criteriaUpper == "" || criteriaUpper == "ALL" {
		for _, m := range messages {
			matchedSeqs = append(matchedSeqs, strconv.FormatInt(m.MessageSeq, 10))
		}
	} else {
		tokens := strings.Fields(criteriaClean)
		for _, m := range messages {
			match := true

			// Lazy lowercasing
			var lowerSender string
			senderLowered := false

			var lowerRecipients []string
			var recipientsLowered []bool

			checkRecipients := func(term string) bool {
				if lowerRecipients == nil {
					lowerRecipients = make([]string, len(m.Recipients))
					recipientsLowered = make([]bool, len(m.Recipients))
				}
				for j, recip := range m.Recipients {
					if !recipientsLowered[j] {
						lowerRecipients[j] = strings.ToLower(recip)
						recipientsLowered[j] = true
					}
					if strings.Contains(lowerRecipients[j], term) {
						return true
					}
				}
				return false
			}

			for i := 0; i < len(tokens); i++ {
				token := strings.ToUpper(tokens[i])
				if token == "ALL" {
					continue
				} else if token == "UNSEEN" {
					if !strings.EqualFold(m.Status, "unseen") && !strings.EqualFold(m.Status, "unread") {
						match = false
						break
					}
				} else if token == "FROM" && i+1 < len(tokens) {
					term := strings.Trim(strings.ToLower(tokens[i+1]), `"`)
					if !senderLowered {
						lowerSender = strings.ToLower(m.Sender)
						senderLowered = true
					}
					if !strings.Contains(lowerSender, term) {
						match = false
						break
					}
					i++
				} else if token == "TO" && i+1 < len(tokens) {
					term := strings.Trim(strings.ToLower(tokens[i+1]), `"`)
					if !checkRecipients(term) {
						match = false
						break
					}
					i++
				} else {
					term := strings.Trim(strings.ToLower(tokens[i]), `"`)
					if !senderLowered {
						lowerSender = strings.ToLower(m.Sender)
						senderLowered = true
					}
					if !strings.Contains(lowerSender, term) && !checkRecipients(term) {
						match = false
						break
					}
				}
			}
			if match {
				matchedSeqs = append(matchedSeqs, strconv.FormatInt(m.MessageSeq, 10))
			}
		}
	}

	if len(matchedSeqs) > 0 {
		writer.WriteString(fmt.Sprintf("* SEARCH %s\r\n", strings.Join(matchedSeqs, " ")))
	} else {
		writer.WriteString("* SEARCH\r\n")
	}
	writer.WriteString(fmt.Sprintf("%s OK SEARCH completed\r\n", tag))
}

func cleanAddress(addr string) string {
	addr = strings.TrimSpace(addr)
	upper := strings.ToUpper(addr)
	if strings.HasPrefix(upper, "FROM:") {
		addr = strings.TrimSpace(addr[5:])
	} else if strings.HasPrefix(upper, "TO:") {
		addr = strings.TrimSpace(addr[3:])
	}
	return strings.Trim(addr, "<> ")
}

func submitBridgeOutbound(cfg *BridgeConfig, from, to string, rawData []byte) error {
	recipient := cleanAddress(to)
	reqBody := struct {
		MailboxID  string `json:"mailbox_id"`
		Recipient  string `json:"recipient"`
		RawMessage string `json:"raw_message"`
	}{
		MailboxID:  cfg.MailboxID,
		Recipient:  recipient,
		RawMessage: base64.StdEncoding.EncodeToString(rawData),
	}
	payloadBytes, err := json.Marshal(reqBody)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, cfg.ApiURL+"/v1/bridge/outbound/send", bytes.NewReader(payloadBytes))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-BYOS-Bridge-Token", cfg.Token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("api request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("api rejected message with status %d", resp.StatusCode)
	}
	return nil
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
			if len(parts) < 4 {
				writer.WriteString(fmt.Sprintf("%s BAD invalid FETCH command\r\n", tag))
				break
			}
			sequenceFields := strings.Fields(parts[2])
			if len(sequenceFields) == 0 {
				writer.WriteString(fmt.Sprintf("%s BAD invalid FETCH command\r\n", tag))
				break
			}
			sequence := sequenceFields[0]
			// Only single message sequence numbers are supported. Ranges and
			// sets (1:5, 1,2, *) must be rejected explicitly: fmt.Sscan would
			// silently parse a prefix ("1:5" -> 1) and claim OK while serving
			// a subset of what the client requested.
			if strings.ContainsAny(sequence, ":,*") {
				writer.WriteString(fmt.Sprintf("%s BAD only single message sequence fetch is supported\r\n", tag))
				break
			}
			var requested int64
			if _, err := fmt.Sscan(sequence, &requested); err != nil {
				writer.WriteString(fmt.Sprintf("%s BAD invalid message sequence\r\n", tag))
				break
			}
			// IMAP shape is "tag FETCH <seq> <item>": the data item lives in
			// parts[3:], not parts[2]. Reading the item from parts[2] (the
			// sequence) made every wire FETCH fall through to NO.
			fetchItem := strings.ToUpper(strings.Join(parts[3:], " "))
			messages, ok := fetchBridgeMessages(cfg)
			if !ok {
				writer.WriteString(fmt.Sprintf("%s NO mailbox metadata unavailable\r\n", tag))
				break
			}
			found := false
			for _, message := range messages {
				if message.MessageSeq == requested {
					if strings.Contains(fetchItem, "HEADER") {
						writeHeaderFetch(writer, tag, message)
					} else if strings.Contains(fetchItem, "BODY") || strings.Contains(fetchItem, "RFC822") {
						writeBodyFetch(writer, tag, message, cfg)
					} else {
						writer.WriteString(fmt.Sprintf("%s NO only HEADER and BODY fetch are supported\r\n", tag))
					}
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
			criteria := ""
			if len(parts) > 2 {
				criteria = strings.Join(parts[2:], " ")
			}
			searchBridgeMessages(writer, tag, criteria, cfg)
		case "LOGOUT":
			writer.WriteString("* BYE BYOS Bridge logging out\r\n")
			writer.WriteString(fmt.Sprintf("%s OK LOGOUT completed\r\n", tag))
			writer.Flush()
			return
		default:
			// Never claim OK for unimplemented commands (e.g. UID FETCH,
			// STORE, IDLE). A fake OK would make clients believe an
			// operation succeeded while nothing happened. BAD lets them
			// degrade or report honestly.
			writer.WriteString(fmt.Sprintf("%s BAD unknown command\r\n", tag))
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
				err := submitBridgeOutbound(cfg, from, to, dataBuffer.Bytes())
				if err != nil {
					log.Printf("[SMTP] outbound submission failed: %v", err)
					writer.WriteString("451 4.3.0 message submission failed: " + err.Error() + "\r\n")
				} else {
					writer.WriteString("250 2.0.0 OK: message queued for delivery\r\n")
				}
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
				from = cleanAddress(parts[1])
			}
			writer.WriteString("250 2.1.0 Sender OK\r\n")
		case "RCPT":
			if !authenticated {
				writer.WriteString("530 5.7.0 Authentication required\r\n")
				break
			}
			if len(parts) > 1 {
				to = cleanAddress(parts[1])
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
