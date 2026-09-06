package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrStorageDisconnected = errors.New("storage_disconnected")

type Config struct {
	DatabaseURL      string
	Port             string
	HealthPort       string
	CryptoWorkerURL  string
	StorageWorkerURL string
}

type App struct {
	cfg        Config
	pool       *pgxpool.Pool
	httpClient *http.Client
}

type InboundRequest struct {
	EnvelopeFrom  string   `json:"envelope_from"`
	Recipients    []string `json:"recipients"`
	RawMessageB64 string   `json:"raw_message_b64"`
}

type InboundResponse struct {
	Stored []StoredMessage `json:"stored"`
}

type StoredMessage struct {
	MessageID       string `json:"message_id"`
	MailboxID       string `json:"mailbox_id"`
	Recipient       string `json:"recipient"`
	MessageSeq      int64  `json:"message_seq"`
	StorageObjectID string `json:"storage_object_id"`
}

type mailboxRoute struct {
	MailboxID        string
	DomainID         string
	MailboxPK        []byte
	MailboxSKVersion int32
	ObjectPrefix     string
}

type cryptoEncryptRequest struct {
	MailboxID        string `json:"mailbox_id"`
	MessageSeq       int64  `json:"message_seq"`
	MailboxPublicKey string `json:"mailbox_public_key"`
	Plaintext        string `json:"plaintext"`
	StorageObjectID  string `json:"storage_object_id"`
	MailboxSKVersion int32  `json:"mailbox_sk_version"`
}

type cryptoEncryptResponse struct {
	Ciphertext            string `json:"ciphertext"`
	ContentKeyHPKEWrapped string `json:"content_key_hpke_wrapped"`
	EncryptionIV          string `json:"encryption_iv"`
	BundleHash            string `json:"bundle_hash"`
	EncryptionVersion     int32  `json:"encryption_version"`
	AADVersion            int16  `json:"aad_version"`
}

type storageStoreRequest struct {
	ObjectKey string            `json:"object_key"`
	Data      []byte            `json:"data"`
	Metadata  map[string]string `json:"metadata"`
}

type latestMessageResponse struct {
	ID                    string   `json:"id"`
	MailboxID             string   `json:"mailbox_id"`
	MessageSeq            int64    `json:"message_seq"`
	Sender                string   `json:"sender"`
	Recipients            []string `json:"recipients"`
	StorageObjectID       string   `json:"storage_object_id"`
	ContentKeyHPKEWrapped string   `json:"content_key_hpke_wrapped"`
	EncryptionIV          string   `json:"encryption_iv"`
	BundleHash            string   `json:"bundle_hash"`
	MailboxSKVersion      int32    `json:"mailbox_sk_version"`
	EncryptionVersion     int32    `json:"encryption_version"`
	AADVersion            int16    `json:"aad_version"`
	ReceivedAt            string   `json:"received_at"`
}

func main() {
	cfg := Config{
		DatabaseURL:      envOrDefault("DATABASE_URL", "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"),
		Port:             envOrDefault("MAIL_ROUTER_PORT", "8081"),
		HealthPort:       envOrDefault("MAIL_ROUTER_HEALTH_PORT", "8082"),
		CryptoWorkerURL:  strings.TrimRight(envOrDefault("CRYPTO_WORKER_URL", "http://localhost:8084"), "/"),
		StorageWorkerURL: strings.TrimRight(envOrDefault("STORAGE_WORKER_URL", "http://localhost:8083"), "/"),
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database pool: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("database ping: %v", err)
	}

	app := &App{
		cfg:        cfg,
		pool:       pool,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", app.healthHandler)
	mux.HandleFunc("/v1/inbound", app.inboundHandler)
	mux.HandleFunc("/v1/messages/latest", app.latestMessageHandler)

	log.Printf("mail-router listening on :%s", cfg.Port)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, mux))
}

func (a *App) healthHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := a.pool.Ping(ctx); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unhealthy", "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "healthy", "service": "mail-router"})
}

func (a *App) inboundHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req InboundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.Recipients) == 0 || strings.TrimSpace(req.RawMessageB64) == "" {
		http.Error(w, "recipients and raw_message_b64 are required", http.StatusBadRequest)
		return
	}

	rawMessage, err := base64.StdEncoding.DecodeString(req.RawMessageB64)
	if err != nil {
		http.Error(w, "raw_message_b64 is invalid", http.StatusBadRequest)
		return
	}

	// Compute delivery identity once for all recipients (V5.3 spec)
	deliveryIdentity := deliveryIdentity(req.EnvelopeFrom, req.Recipients, rawMessage)

	// Pre-compute normalized recipients for database storage
	normalizedRecipients := make([]string, len(req.Recipients))
	for i, r := range req.Recipients {
		normalizedRecipients[i] = normalizeAddress(r)
	}

	stored := make([]StoredMessage, 0, len(req.Recipients))
	for _, recipient := range req.Recipients {
		result, err := a.processRecipient(r.Context(), req.EnvelopeFrom, recipient, rawMessage, deliveryIdentity, normalizedRecipients)
		if err != nil {
			if errors.Is(err, ErrStorageDisconnected) || strings.Contains(strings.ToLower(err.Error()), "storage_disconnected") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusServiceUnavailable)
				json.NewEncoder(w).Encode(map[string]string{"status": "error", "code": "storage_disconnected", "message": "Mailbox storage is currently unavailable. Please reconnect storage."})
				return
			}
			log.Printf("process recipient %q: %v", recipient, err)
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		stored = append(stored, result)
	}

	writeJSON(w, http.StatusAccepted, InboundResponse{Stored: stored})
}

func (a *App) processRecipient(ctx context.Context, envelopeFrom, recipient string, rawMessage []byte, deliveryIdentity [32]byte, normalizedRecipients []string) (StoredMessage, error) {
	normalizedRecipient := normalizeAddress(recipient)
	domain, localPart, err := splitAddress(normalizedRecipient)
	if err != nil {
		return StoredMessage{}, err
	}

	tx, err := a.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return StoredMessage{}, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	route, err := lookupMailboxRoute(ctx, tx, domain, localPart)
	if err != nil {
		return StoredMessage{}, err
	}

	var messageSeq int64
	if err := tx.QueryRow(ctx, "SELECT nextval('mailbox_message_seq')").Scan(&messageSeq); err != nil {
		return StoredMessage{}, fmt.Errorf("allocate message sequence: %w", err)
	}

	objectPrefix := strings.Trim(strings.TrimSpace(route.ObjectPrefix), "/")
	if objectPrefix == "" {
		objectPrefix = fmt.Sprintf("mailboxes/%s", route.MailboxID)
	}
	storageObjectID := fmt.Sprintf("%s/%020d.eml.enc", objectPrefix, messageSeq)

	cryptoResp, err := a.encryptMessage(ctx, route, messageSeq, storageObjectID, rawMessage)
	if err != nil {
		return StoredMessage{}, err
	}

	ciphertext, err := base64.StdEncoding.DecodeString(cryptoResp.Ciphertext)
	if err != nil {
		return StoredMessage{}, fmt.Errorf("crypto returned invalid ciphertext: %w", err)
	}
	wrappedKey, err := base64.StdEncoding.DecodeString(cryptoResp.ContentKeyHPKEWrapped)
	if err != nil {
		return StoredMessage{}, fmt.Errorf("crypto returned invalid wrapped key: %w", err)
	}
	iv, err := base64.StdEncoding.DecodeString(cryptoResp.EncryptionIV)
	if err != nil {
		return StoredMessage{}, fmt.Errorf("crypto returned invalid iv: %w", err)
	}
	bundleHash, err := base64.StdEncoding.DecodeString(cryptoResp.BundleHash)
	if err != nil {
		return StoredMessage{}, fmt.Errorf("crypto returned invalid bundle hash: %w", err)
	}

	if err := a.storeCiphertext(ctx, storageObjectID, ciphertext, route.MailboxID, messageSeq); err != nil {
		return StoredMessage{}, err
	}

	var messageID string
	// Check for duplicate delivery_identity before inserting (V5.3 deduplication)
	err = tx.QueryRow(ctx, `
		SELECT id, storage_object_id
		FROM message_metadata
		WHERE mailbox_id = $1 AND delivery_identity = $2`,
		route.MailboxID, deliveryIdentity[:],
	).Scan(&messageID, &storageObjectID)
	if err == nil {
		// Duplicate delivery_identity found - return existing message
		log.Printf("duplicate delivery detected for mailbox=%s delivery_identity=%x", route.MailboxID, deliveryIdentity[:])
		return StoredMessage{MessageID: messageID, MailboxID: route.MailboxID, Recipient: normalizeAddress(recipient), MessageSeq: 0, StorageObjectID: storageObjectID}, nil
	} else if err.Error() != "no rows in result set" {
		return StoredMessage{}, fmt.Errorf("check duplicate delivery: %w", err)
	}

	// No duplicate - insert new message
	err = tx.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version, encryption_version,
			encryption_iv, aad_version, bundle_hash, status
		) VALUES ($1, $2, $3, 'received', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'received')
		RETURNING id`,
		route.MailboxID, route.DomainID, messageSeq, deliveryIdentity[:], normalizeAddress(envelopeFrom), normalizedRecipients,
		storageObjectID, wrappedKey, route.MailboxSKVersion, cryptoResp.EncryptionVersion, iv, cryptoResp.AADVersion, bundleHash,
	).Scan(&messageID)
	if err != nil {
		return StoredMessage{}, fmt.Errorf("insert message metadata: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return StoredMessage{}, fmt.Errorf("commit metadata: %w", err)
	}

	log.Printf("stored inbound message id=%s mailbox=%s seq=%d object=%s", messageID, route.MailboxID, messageSeq, storageObjectID)
	return StoredMessage{MessageID: messageID, MailboxID: route.MailboxID, Recipient: normalizeAddress(recipient), MessageSeq: messageSeq, StorageObjectID: storageObjectID}, nil
}

func (a *App) storeCiphertext(ctx context.Context, objectKey string, ciphertext []byte, mailboxID string, messageSeq int64) error {
	payload := storageStoreRequest{
		ObjectKey: objectKey,
		Data:      ciphertext,
		Metadata: map[string]string{
			"mailbox_id":   mailboxID,
			"message_seq":  fmt.Sprintf("%d", messageSeq),
			"content_type": "application/octet-stream",
		},
	}
	var resp map[string]string
	if err := postJSON(ctx, a.httpClient, a.cfg.StorageWorkerURL+"/api/store", payload, &resp); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "storage_disconnected") {
			return ErrStorageDisconnected
		}
		return fmt.Errorf("storage-worker store: %w", err)
	}
	return nil
}

func (a *App) encryptMessage(ctx context.Context, route mailboxRoute, messageSeq int64, storageObjectID string, rawMessage []byte) (cryptoEncryptResponse, error) {
	payload := cryptoEncryptRequest{
		MailboxID:        route.MailboxID,
		MessageSeq:       messageSeq,
		MailboxPublicKey: base64.StdEncoding.EncodeToString(route.MailboxPK),
		Plaintext:        base64.StdEncoding.EncodeToString(rawMessage),
		StorageObjectID:  storageObjectID,
		MailboxSKVersion: route.MailboxSKVersion,
	}
	var resp cryptoEncryptResponse
	if err := postJSON(ctx, a.httpClient, a.cfg.CryptoWorkerURL+"/v1/encrypt", payload, &resp); err != nil {
		return cryptoEncryptResponse{}, fmt.Errorf("crypto-worker encrypt: %w", err)
	}
	if resp.Ciphertext == "" || resp.ContentKeyHPKEWrapped == "" || resp.EncryptionIV == "" || resp.BundleHash == "" {
		return cryptoEncryptResponse{}, fmt.Errorf("crypto-worker returned incomplete bundle")
	}
	return resp, nil
}

func (a *App) latestMessageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	recipient := normalizeAddress(r.URL.Query().Get("recipient"))
	domain, localPart, err := splitAddress(recipient)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	var msg latestMessageResponse
	var wrappedKey, iv, bundleHash []byte
	var receivedAt time.Time
	err = a.pool.QueryRow(ctx, `
		SELECT mm.id::text, mm.mailbox_id::text, mm.message_seq, mm.sender, mm.recipients, mm.storage_object_id,
		       mm.content_key_hpke_wrapped, mm.encryption_iv, mm.bundle_hash, mm.mailbox_sk_version,
		       mm.encryption_version, mm.aad_version, mm.received_at
		FROM message_metadata mm
		JOIN mailboxes m ON m.id = mm.mailbox_id
		JOIN domains d ON d.id = m.domain_id
		WHERE lower(d.name) = lower($1) AND lower(m.local_part) = lower($2)
		ORDER BY mm.received_at DESC
		LIMIT 1`, domain, localPart,
	).Scan(&msg.ID, &msg.MailboxID, &msg.MessageSeq, &msg.Sender, &msg.Recipients, &msg.StorageObjectID,
		&wrappedKey, &iv, &bundleHash, &msg.MailboxSKVersion, &msg.EncryptionVersion, &msg.AADVersion, &receivedAt)
	if err != nil {
		http.Error(w, fmt.Sprintf("latest message not found: %v", err), http.StatusNotFound)
		return
	}
	msg.ContentKeyHPKEWrapped = base64.StdEncoding.EncodeToString(wrappedKey)
	msg.EncryptionIV = base64.StdEncoding.EncodeToString(iv)
	msg.BundleHash = base64.StdEncoding.EncodeToString(bundleHash)
	msg.ReceivedAt = receivedAt.UTC().Format(time.RFC3339Nano)
	writeJSON(w, http.StatusOK, msg)
}

func postJSON(ctx context.Context, client *http.Client, url string, payload any, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s: %s", resp.Status, strings.TrimSpace(string(respBody)))
	}
	if target != nil && len(respBody) > 0 {
		if err := json.Unmarshal(respBody, target); err != nil {
			return err
		}
	}
	return nil
}

func deliveryIdentity(envelopeFrom string, recipients []string, rawMessage []byte) [32]byte {
	// Parse the raw message to extract headers
	msg, err := mail.ReadMessage(bytes.NewReader(rawMessage))
	if err != nil {
		// If we can't parse, fall back to the old behavior (without Message-ID)
		return deliveryIdentityFallback(envelopeFrom, recipients, rawMessage)
	}

	// Extract and normalize Message-ID
	messageID := msg.Header.Get("Message-ID")
	normalizedMessageID := normalizeMessageID(messageID)

	// Normalize sender
	normalizedSender := strings.ToLower(strings.TrimSpace(envelopeFrom))

	// Normalize and sort recipients
	normalizedRecipients := make([]string, len(recipients))
	for i, r := range recipients {
		normalizedRecipients[i] = strings.ToLower(strings.TrimSpace(r))
	}
	sort.Strings(normalizedRecipients)
	normalizedSortedRecipients := strings.Join(normalizedRecipients, "")

	h := sha256.New()

	if normalizedMessageID != "" {
		// Case 1: Message-ID present
		// SHA-256(normalized(Message-ID) || normalized(sender) || normalized(sorted_recipients))
		h.Write([]byte(normalizedMessageID))
		h.Write([]byte{0})
		h.Write([]byte(normalizedSender))
		h.Write([]byte{0})
		h.Write([]byte(normalizedSortedRecipients))
	} else {
		// Case 2: Message-ID absent
		// SHA-256(normalized(sender) || normalized(sorted_recipients) || canonical_envelope || canonical_RFC5322)
		// For canonical envelope, we use the SMTP envelope info
		// For canonical RFC5322, we use the raw message bytes
		canonicalEnvelope := envelopeFrom + "\x00" + strings.Join(recipients, "\x00")

		h.Write([]byte(normalizedSender))
		h.Write([]byte{0})
		h.Write([]byte(normalizedSortedRecipients))
		h.Write([]byte{0})
		h.Write([]byte(canonicalEnvelope))
		h.Write([]byte{0})
		h.Write(rawMessage)
	}

	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// normalizeMessageID normalizes a Message-ID header per RFC 5322
func normalizeMessageID(messageID string) string {
	if messageID == "" {
		return ""
	}
	// Remove angle brackets and trim whitespace
	messageID = strings.TrimSpace(messageID)
	messageID = strings.Trim(messageID, "<>")
	return strings.ToLower(strings.TrimSpace(messageID))
}

// deliveryIdentityFallback is the old behavior for compatibility/fallback
func deliveryIdentityFallback(envelopeFrom string, recipients []string, rawMessage []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte(strings.ToLower(strings.TrimSpace(envelopeFrom))))
	h.Write([]byte{0})

	normalizedRecipients := make([]string, len(recipients))
	for i, r := range recipients {
		normalizedRecipients[i] = strings.ToLower(strings.TrimSpace(r))
	}
	sort.Strings(normalizedRecipients)
	normalizedSortedRecipients := strings.Join(normalizedRecipients, "")

	h.Write([]byte(normalizedSortedRecipients))
	h.Write([]byte{0})
	h.Write(rawMessage)

	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

func splitAddress(addr string) (string, string, error) {
	addr = normalizeAddress(addr)
	parts := strings.Split(addr, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", fmt.Errorf("invalid email address %q", addr)
	}
	return parts[1], parts[0], nil
}

func normalizeAddress(addr string) string {
	addr = strings.TrimSpace(addr)
	if parsed, err := mail.ParseAddress(addr); err == nil {
		addr = parsed.Address
	}
	addr = strings.Trim(addr, "<>")
	return strings.ToLower(strings.TrimSpace(addr))
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func lookupMailboxRoute(ctx context.Context, tx pgx.Tx, domain, localPart string) (mailboxRoute, error) {
	var route mailboxRoute
	err := tx.QueryRow(ctx, `
		SELECT m.id::text, d.id::text, m.mailbox_pk, m.mailbox_sk_version, ms.object_prefix
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		JOIN mailbox_storage ms ON ms.mailbox_id = m.id
		WHERE lower(d.name) = lower($1)
		  AND lower(m.local_part) = lower($2)
		  AND m.is_active = true
		  AND ms.status = 'active'
		LIMIT 1`, domain, localPart,
	).Scan(&route.MailboxID, &route.DomainID, &route.MailboxPK, &route.MailboxSKVersion, &route.ObjectPrefix)
	if err == nil {
		if len(route.MailboxPK) != 32 {
			return mailboxRoute{}, fmt.Errorf("mailbox public key for %s@%s must be 32 bytes", localPart, domain)
		}
		return route, nil
	}
	// If not found, check if it is due to disconnected storage (explicit 503)
	var scStatus string
	err2 := tx.QueryRow(ctx, `
		SELECT sc.status
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		JOIN mailbox_storage ms ON ms.mailbox_id = m.id
		JOIN storage_connections sc ON sc.id = ms.storage_connection_id
		WHERE lower(d.name) = lower($1)
		  AND lower(m.local_part) = lower($2)
		LIMIT 1`, domain, localPart).Scan(&scStatus)
	if err2 == nil && scStatus == "deleted" {
		return mailboxRoute{}, ErrStorageDisconnected
	}
	return mailboxRoute{}, fmt.Errorf("mailbox route not found for %s@%s: %w", localPart, domain, err)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}