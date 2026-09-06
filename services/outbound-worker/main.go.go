package main

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"os/signal"
	"syscall"
	"time"
)

type Config struct {
	ListenAddr       string
	DatabaseURL      string
	PostfixAddr      string
	PollInterval     time.Duration
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
		ListenAddr:  envOrDefault("OUTBOUND_WORKER_ADDR", ":8085"),
		DatabaseURL: envOrDefault("DATABASE_URL", "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"),
		PostfixAddr: envOrDefault("POSTFIX_ADDR", "localhost:25"),
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
	ID                      string // uuid
	DeliveryID              string // uuid
	MailboxID               string // uuid
	DomainID                string // uuid
	Recipient               string
	EncryptedMessage        []byte
	SendTokenHPKEWrapped    []byte
	Status                  string
	Attempts                int
	ExpiresAt               time.Time
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
		        encrypted_message, send_token_hpke_wrapped, status, attempts, expires_at
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
			&msg.EncryptedMessage, &msg.SendTokenHPKEWrapped, &msg.Status, &msg.Attempts, &msg.ExpiresAt); err != nil {
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
	// For now, use envelope-from as empty or extract via simple parse; Postfix permit_mynetworks allows empty.
	envelopeFrom := "" // TODO: lookup mailbox address for MAIL FROM
	// Try to extract From header for envelope
	if idx := findHeader(plaintext, "From:"); idx >= 0 {
		// keep empty for now; don't fail on parse
		_ = idx
	}

	host, _, err := net.SplitHostPort(cfg.PostfixAddr)
	if err != nil {
		host = cfg.PostfixAddr
	}

	c, err := smtp.Dial(cfg.PostfixAddr)
	if err != nil {
		return fmt.Errorf("smtp dial %s: %w", cfg.PostfixAddr, err)
	}
	defer c.Close()

	if err := c.Mail(envelopeFrom); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}

	if err := c.Rcpt(msg.Recipient); err != nil {
		return fmt.Errorf("smtp rcpt %s: %w", msg.Recipient, err)
	}

	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}

	// Write plaintext as-is (already DKIM-signed, full MIME). No re-wrapping.
	_, err = w.Write(plaintext)
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

func decryptForDelivery(ctx context.Context, msg OutboundMessage) ([]byte, error) {
	_ = ctx
	_ = msg
	// Native Rust crypto-core (compiled to native for server) via crypto-worker HTTP API.
	// WASM is browser-only; server must not use WASM.
	// TODO: POST http://crypto-worker:8084/v1/outbound/decrypt {send_token_wrapped, mailbox_id, message_seq, ciphertext}
	//       → HPKE-Open with outbound_delivery_sk (held only by worker) → AES-GCM decrypt → plaintext
	return nil, fmt.Errorf("decrypt: not implemented (requires native Rust crypto-core via crypto-worker)")
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
