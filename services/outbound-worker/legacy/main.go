package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

type Config struct {
	ListenAddr   string
	DatabaseURL  string
	PostfixAddr  string
	PollInterval time.Duration
}

func loadConfig() Config {
	interval := 5 * time.Second
	if v := os.Getenv("POLL_INTERVAL_MS"); v != "" {
		var ms int
		fmt.Sscanf(v, "%d", &ms)
		if ms > 0 {
			interval = time.Duration(ms) * time.Millisecond
		}
	}
	return Config{
		ListenAddr:   envOrDefault("OUTBOUND_WORKER_ADDR", ":8085"),
		DatabaseURL:  envOrDefault("DATABASE_URL", "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"),
		PostfixAddr:  envOrDefault("POSTFIX_ADDR", "localhost:25"),
		PollInterval: interval,
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

type OutboundMessage struct {
	ID                   string // uuid
	DeliveryID           string // uuid
	MailboxID            string // uuid
	DomainID             string // uuid
	Recipient            string
	EncryptedMessage     []byte
	SendTokenHPKEWrapped []byte
	OutboxSeq            sql.NullInt64
	Status               string
	Attempts             int
	ExpiresAt            time.Time
}

func main() {
	cfg := loadConfig()

	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(5)
	if err := db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}
	log.Println("database connected")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go pollAndDeliver(ctx, db, cfg)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down...")
	cancel()
}

func pollAndDeliver(ctx context.Context, db *sql.DB, cfg Config) {
	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := processOutboundQueue(ctx, db, cfg); err != nil {
				log.Printf("poll cycle error: %v", err)
			}
		}
	}
}

func processOutboundQueue(ctx context.Context, db *sql.DB, cfg Config) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	rows, err := tx.QueryContext(ctx,
		`SELECT id::text, delivery_id::text, mailbox_id::text, domain_id::text, recipient,
		        encrypted_message, send_token_hpke_wrapped, outbox_seq, status, attempts, expires_at
		 FROM outbound_queue
		 WHERE status = 'pending' AND next_attempt_at <= now() AND expires_at > now()
		 ORDER BY next_attempt_at ASC
		 LIMIT 10
		 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return fmt.Errorf("query queue: %w", err)
	}
	defer rows.Close()

	var messages []OutboundMessage
	for rows.Next() {
		var msg OutboundMessage
		if err := rows.Scan(&msg.ID, &msg.DeliveryID, &msg.MailboxID, &msg.DomainID, &msg.Recipient,
			&msg.EncryptedMessage, &msg.SendTokenHPKEWrapped, &msg.OutboxSeq, &msg.Status, &msg.Attempts, &msg.ExpiresAt); err != nil {
			return fmt.Errorf("scan: %w", err)
		}
		messages = append(messages, msg)
	}
	rows.Close()

	if len(messages) == 0 {
		return nil
	}

	log.Printf("processing %d outbound messages", len(messages))

	for _, msg := range messages {
		if !msg.OutboxSeq.Valid {
			log.Printf("deliver failed id=%s delivery_id=%s: missing outbox_seq", msg.ID, msg.DeliveryID)
			_, _ = tx.ExecContext(ctx,
				`UPDATE outbound_queue SET status = 'bounced', failed_at = now(), attempts = attempts + 1 WHERE id = $1`, msg.ID)
			_, _ = tx.ExecContext(ctx,
				`INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message)
				 VALUES ($1, 'outbound', $2, $3, $4, 'bounced', 'missing outbox_seq')`, msg.DeliveryID, msg.MailboxID, msg.DomainID, msg.Recipient)
			continue
		}
		if err := deliverMessage(ctx, tx, msg, cfg); err != nil {
			log.Printf("deliver failed id=%s delivery_id=%s: %v", msg.ID, msg.DeliveryID, err)
			// Retry with backoff; after max_attempts → bounced
			_, _ = tx.ExecContext(ctx,
				`UPDATE outbound_queue SET attempts = attempts + 1, last_attempt_at = now(),
				        next_attempt_at = now() + (interval '1 minute' * (attempts + 1)),
				        status = CASE WHEN attempts + 1 >= max_attempts THEN 'bounced' ELSE 'pending' END,
				        failed_at = CASE WHEN attempts + 1 >= max_attempts THEN now() ELSE failed_at END
				 WHERE id = $1`, msg.ID)
			// Also log to delivery_log
			_, _ = tx.ExecContext(ctx,
				`INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message)
				 VALUES ($1, 'outbound', $2, $3, $4, 'bounced', $5)`, msg.DeliveryID, msg.MailboxID, msg.DomainID, msg.Recipient, err.Error())
			continue
		}
		_, _ = tx.ExecContext(ctx,
			`UPDATE outbound_queue SET status = 'delivered', delivered_at = now(), attempts = attempts + 1, last_attempt_at = now() WHERE id = $1`,
			msg.ID)
		_, _ = tx.ExecContext(ctx,
			`INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_code)
			 VALUES ($1, 'outbound', $2, $3, $4, 'delivered', 250)`, msg.DeliveryID, msg.MailboxID, msg.DomainID, msg.Recipient)
		log.Printf("delivered id=%s delivery_id=%s to %s", msg.ID, msg.DeliveryID, msg.Recipient)
	}

	return tx.Commit()
}

func deliverMessage(ctx context.Context, tx *sql.Tx, msg OutboundMessage, cfg Config) error {
	plaintext, err := decryptForDelivery(ctx, msg)
	if err != nil {
		return fmt.Errorf("decrypt: %w", err)
	}
	// plaintext is full RFC5322 message (already contains From/To/Subject/MIME, DKIM will be added before this)
	// For envelope, derive sender from mailbox (lookup) or use plaintext From header fallback.
	envelopeFrom := ""
	var localPart, domainName string
	err = tx.QueryRowContext(ctx,
		`SELECT m.local_part, d.name
		 FROM mailboxes m
		 JOIN domains d ON m.domain_id = d.id
		 WHERE m.id = $1`, msg.MailboxID).Scan(&localPart, &domainName)

	if err != nil && err != sql.ErrNoRows {
		return fmt.Errorf("mailbox lookup: %w", err)
	}

	if err == nil {
		if strings.ContainsAny(localPart, "<>\t\n\r ") || strings.ContainsAny(domainName, "<>\t\n\r ") {
			return fmt.Errorf("invalid characters in mailbox address")
		}
		envelopeFrom = fmt.Sprintf("%s@%s", localPart, domainName)
	} else {
		// Try to extract From header for envelope as fallback
		if idx := findHeader(plaintext, "From:"); idx >= 0 {
			// keep empty for now; don't fail on parse
			_ = idx
		}
	}

	return deliverToSmtpServer(cfg.PostfixAddr, envelopeFrom, msg.Recipient, plaintext)
}

func splitRecipientTokens(input string) []string {
	var parts []string
	inQuotes := false
	escaped := false
	start := 0
	for i := 0; i < len(input); i++ {
		ch := input[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' && inQuotes {
			escaped = true
			continue
		}
		if ch == '"' {
			inQuotes = !inQuotes
			continue
		}
		if !inQuotes && (ch == ',' || ch == ';') {
			parts = append(parts, input[start:i])
			start = i + 1
		}
	}
	parts = append(parts, input[start:])
	return parts
}

// parseAndValidateRecipients splits comma/semicolon-delimited recipients (respecting quoted display names),
// trims whitespace, validates against RFC 5322 syntax and header injection, and deduplicates addresses.
func parseAndValidateRecipients(recipientStr string) ([]string, error) {
	if strings.ContainsAny(recipientStr, "\r\n\x00") {
		return nil, fmt.Errorf("recipient list contains invalid control characters")
	}
	clean := strings.TrimSpace(recipientStr)
	if clean == "" {
		return nil, fmt.Errorf("recipient list is empty")
	}

	rawList := splitRecipientTokens(clean)

	seen := make(map[string]bool)
	recipients := make([]string, 0, len(rawList))

	for _, raw := range rawList {
		addrStr := strings.TrimSpace(raw)
		if addrStr == "" {
			continue
		}
		parsed, err := mail.ParseAddress(addrStr)
		if err != nil || parsed.Address == "" || !strings.Contains(parsed.Address, "@") {
			return nil, fmt.Errorf("invalid recipient email address: %s", addrStr)
		}
		parts := strings.Split(parsed.Address, "@")
		if len(parts) != 2 || len(parts[0]) == 0 || len(parts[1]) < 3 || !strings.Contains(parts[1], ".") {
			return nil, fmt.Errorf("invalid recipient email domain: %s", addrStr)
		}
		canonical := strings.ToLower(parsed.Address)
		if !seen[canonical] {
			seen[canonical] = true
			recipients = append(recipients, parsed.Address)
		}
	}

	if len(recipients) == 0 {
		return nil, fmt.Errorf("recipient list contains no valid addresses")
	}
	return recipients, nil
}

// stripBccHeaders removes all Bcc headers (case-insensitive, including multiline folded continuations)
// strictly within the RFC 5322 header section prior to the first blank-line boundary.
func stripBccHeaders(raw []byte) []byte {
	var headerBytes, bodyBytes, delimiter []byte
	if bytes.HasPrefix(raw, []byte("\r\n")) {
		headerBytes = nil
		delimiter = []byte("\r\n")
		bodyBytes = raw[2:]
	} else if bytes.HasPrefix(raw, []byte("\n")) {
		headerBytes = nil
		delimiter = []byte("\n")
		bodyBytes = raw[1:]
	} else {
		crlfIdx := bytes.Index(raw, []byte("\r\n\r\n"))
		lfIdx := bytes.Index(raw, []byte("\n\n"))
		if crlfIdx >= 0 && (lfIdx < 0 || crlfIdx <= lfIdx) {
			headerBytes = raw[:crlfIdx+2]
			delimiter = []byte("\r\n")
			bodyBytes = raw[crlfIdx+4:]
		} else if lfIdx >= 0 {
			headerBytes = raw[:lfIdx+1]
			delimiter = []byte("\n")
			bodyBytes = raw[lfIdx+2:]
		} else {
			headerBytes = raw
			bodyBytes = nil
			delimiter = nil
		}
	}

	var sanitizedHeaders bytes.Buffer
	skippingBcc := false
	cursor := 0

	for cursor < len(headerBytes) {
		nextNL := bytes.IndexByte(headerBytes[cursor:], '\n')
		var lineWithEnding []byte
		var nextCursor int
		if nextNL >= 0 {
			lineWithEnding = headerBytes[cursor : cursor+nextNL+1]
			nextCursor = cursor + nextNL + 1
		} else {
			lineWithEnding = headerBytes[cursor:]
			nextCursor = len(headerBytes)
		}

		if len(lineWithEnding) > 0 && (lineWithEnding[0] == ' ' || lineWithEnding[0] == '\t') {
			if skippingBcc {
				cursor = nextCursor
				continue
			}
			sanitizedHeaders.Write(lineWithEnding)
		} else {
			isBcc := false
			if colonIdx := bytes.IndexByte(lineWithEnding, ':'); colonIdx >= 0 {
				hdrName := strings.TrimSpace(string(lineWithEnding[:colonIdx]))
				if strings.EqualFold(hdrName, "bcc") {
					isBcc = true
				}
			}
			if isBcc {
				skippingBcc = true
				cursor = nextCursor
				continue
			}
			skippingBcc = false
			sanitizedHeaders.Write(lineWithEnding)
		}
		cursor = nextCursor
	}

	var out bytes.Buffer
	out.Grow(sanitizedHeaders.Len() + len(delimiter) + len(bodyBytes))
	out.Write(sanitizedHeaders.Bytes())
	out.Write(delimiter)
	out.Write(bodyBytes)
	return out.Bytes()
}

func deliverToSmtpServer(smtpAddr, envelopeFrom, recipientStr string, plaintext []byte) error {
	recipients, err := parseAndValidateRecipients(recipientStr)
	if err != nil {
		return fmt.Errorf("recipient validation: %w", err)
	}

	sanitizedPayload := stripBccHeaders(plaintext)

	host, _, err := net.SplitHostPort(smtpAddr)
	if err != nil {
		host = smtpAddr
	}

	c, err := smtp.Dial(smtpAddr)
	if err != nil {
		return fmt.Errorf("smtp dial %s: %w", smtpAddr, err)
	}
	defer c.Close()

	if err := c.Mail(envelopeFrom); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}

	for _, rcpt := range recipients {
		if err := c.Rcpt(rcpt); err != nil {
			return fmt.Errorf("smtp rcpt: %w", err)
		}
	}

	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}

	// Write sanitized payload (Bcc headers removed).
	_, err = w.Write(sanitizedPayload)
	if err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}

	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close: %w", err)
	}

	if err := c.Quit(); err != nil {
		log.Printf("WARN: smtp quit from %s: %v", host, err)
	}

	return nil
}

type DecryptOutboundRequest struct {
	SendTokenWrapped string `json:"send_token_wrapped"`
	MailboxID        string `json:"mailbox_id"`
	MessageSeq       uint64 `json:"message_seq"`
	Ciphertext       string `json:"ciphertext"`
}

type DecryptOutboundResponse struct {
	Plaintext string `json:"plaintext"`
}

var cryptoWorkerInternalKey string

func init() {
	if keyPath := os.Getenv("CRYPTO_WORKER_INTERNAL_KEY_FILE"); keyPath != "" {
		if keyBytes, err := os.ReadFile(keyPath); err == nil {
			cryptoWorkerInternalKey = string(bytes.TrimSpace(keyBytes))
		}
	}
}

func getCryptoWorkerURL() string {
	if u := os.Getenv("CRYPTO_WORKER_URL"); u != "" {
		return u
	}
	return "http://crypto-worker:8084"
}

func decryptForDelivery(ctx context.Context, msg OutboundMessage) ([]byte, error) {
	reqData := DecryptOutboundRequest{
		SendTokenWrapped: base64.StdEncoding.EncodeToString(msg.SendTokenHPKEWrapped),
		MailboxID:        msg.MailboxID,
		MessageSeq:       uint64(msg.OutboxSeq.Int64),
		Ciphertext:       base64.StdEncoding.EncodeToString(msg.EncryptedMessage),
	}
	reqBytes, err := json.Marshal(reqData)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, getCryptoWorkerURL()+"/v1/outbound/decrypt", bytes.NewReader(reqBytes))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if cryptoWorkerInternalKey == "" {
		return nil, fmt.Errorf("CRYPTO_WORKER_INTERNAL_KEY_FILE not configured or could not be read")
	}
	req.Header.Set("X-Internal-Key", cryptoWorkerInternalKey)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("crypto-worker error: status=%d body=%s", resp.StatusCode, string(body))
	}

	var respData DecryptOutboundResponse
	if err := json.NewDecoder(resp.Body).Decode(&respData); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	plaintext, err := base64.StdEncoding.DecodeString(respData.Plaintext)
	if err != nil {
		return nil, fmt.Errorf("decode plaintext base64: %w", err)

	}

	return plaintext, nil
}

func hexEncode(b []byte) string {
	return hex.EncodeToString(b)
}

func findHeader(data []byte, prefix string) int {
	// naive case-insensitive search for header line start
	s := string(data)
	idx := -1
	low := "from:"
	if prefix == "From:" {
		low = "from:"
	}
	for i := 0; i < len(s)-5; i++ {
		if s[i:i+5] == low || s[i:i+5] == "From:" {
			idx = i
			break
		}
	}
	return idx
}
