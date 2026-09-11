package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type MessageMetadataResponse struct {
	ID                    string   `json:"id"`
	MailboxID             string   `json:"mailbox_id"`
	MessageSeq            int64    `json:"message_seq"`
	Direction             string   `json:"direction"`
	Sender                string   `json:"sender"`
	Recipients            []string `json:"recipients"`
	StorageObjectID       string   `json:"storage_object_id"`
	ContentKeyHPKEWrapped string   `json:"content_key_hpke_wrapped"`
	EncryptionVersion     int      `json:"encryption_version"`
	EncryptionIV          string   `json:"encryption_iv"`
	AADVersion            int      `json:"aad_version"`
	BundleHash            string   `json:"bundle_hash"`
	ReceivedAt            string   `json:"received_at"`
	SentAt                *string  `json:"sent_at,omitempty"`
	Status                string   `json:"status"`
	HasAttachments        bool     `json:"has_attachments"`
	AttachmentCount       int      `json:"attachment_count"`
}

func messagesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var authorized string
	if err := conn.QueryRow(ctx, `SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`, mailboxID, userID).Scan(&authorized); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	rows, err := conn.Query(ctx, `
		SELECT id::text, message_seq, direction, sender, recipients, storage_object_id,
		       content_key_hpke_wrapped, encryption_version, encryption_iv,
		       aad_version, bundle_hash, received_at, sent_at, status,
		       has_attachments, attachment_count
		FROM message_metadata
		WHERE mailbox_id=$1
		ORDER BY COALESCE(sent_at, received_at) DESC
		LIMIT 100`, mailboxID)
	if err != nil {
		http.Error(w, "failed to query messages", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := make([]MessageMetadataResponse, 0)
	for rows.Next() {
		var m MessageMetadataResponse
		var wrapped, iv, hash []byte
		var receivedAt time.Time
		var sentAt *time.Time
		if err := rows.Scan(&m.ID, &m.MessageSeq, &m.Direction, &m.Sender, &m.Recipients, &m.StorageObjectID,
			&wrapped, &m.EncryptionVersion, &iv, &m.AADVersion, &hash,
			&receivedAt, &sentAt, &m.Status, &m.HasAttachments, &m.AttachmentCount); err != nil {
			http.Error(w, "failed to read message metadata", http.StatusInternalServerError)
			return
		}
		m.MailboxID = mailboxID
		m.ReceivedAt = receivedAt.Format(time.RFC3339)
		m.ContentKeyHPKEWrapped = base64.StdEncoding.EncodeToString(wrapped)
		m.EncryptionIV = base64.StdEncoding.EncodeToString(iv)
		m.BundleHash = base64.StdEncoding.EncodeToString(hash)
		if sentAt != nil {
			formatted := sentAt.Format(time.RFC3339)
			m.SentAt = &formatted
		}
		m.Sender = strings.TrimSpace(m.Sender)
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "failed to read messages", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"messages": messages})
}

type MessageBodyResponse struct {
	EncryptedBody         string `json:"encrypted_body"`
	ContentKeyHPKEWrapped string `json:"content_key_hpke_wrapped"`
	EncryptionIV          string `json:"encryption_iv"`
	AADVersion            int    `json:"aad_version"`
	BundleHash            string `json:"bundle_hash"`
	EncryptionVersion     int    `json:"encryption_version"`
	// MessageSeq is operational metadata the client needs to reconstruct
	// canonical AAD via wasm_canonical_aad. It carries no key material.
	MessageSeq int64 `json:"message_seq"`
}

type messageBodyLoadError struct {
	status int
	msg    string
	err    error
}

func (e *messageBodyLoadError) Error() string { return e.msg }
func (e *messageBodyLoadError) Unwrap() error { return e.err }

// loadEncryptedMessageBody is the shared retrieval helper used by both the
// mailbox (messages.go) and bridge (bridge.go) message-body handlers. It
// performs the DB lookup for encryption metadata, retrieves the encrypted
// blob from storage-worker via /api/retrieve, and returns a base64-encoded
// response payload. Centralizing this logic prevents drift in auth, encoding,
// and error handling between the two handlers.
func loadEncryptedMessageBody(ctx context.Context, conn *pgx.Conn, mailboxID, messageID string) (*MessageBodyResponse, error) {
	var storageObjectID string
	var wrapped, iv, hash []byte
	var encryptionVersion, aadVersion int
	var messageSeq int64
	err := conn.QueryRow(ctx, `
		SELECT storage_object_id, content_key_hpke_wrapped, encryption_iv,
		       aad_version, bundle_hash, encryption_version, message_seq
		FROM message_metadata
		WHERE id=$1 AND mailbox_id=$2
	`, messageID, mailboxID).Scan(&storageObjectID, &wrapped, &iv, &aadVersion, &hash, &encryptionVersion, &messageSeq)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &messageBodyLoadError{status: http.StatusNotFound, msg: "message not found", err: err}
		}
		return nil, &messageBodyLoadError{status: http.StatusNotFound, msg: "message not found", err: err}
	}

	storageURL := storageWorkerURL()
	retrieveReq := map[string]string{
		"object_key": storageObjectID,
		"mailbox_id": mailboxID,
	}
	reqBody, _ := json.Marshal(retrieveReq)
	req, err := http.NewRequestWithContext(ctx, "POST", storageURL+"/api/retrieve", bytes.NewReader(reqBody))
	if err != nil {
		return nil, &messageBodyLoadError{status: http.StatusInternalServerError, msg: "failed to create storage request", err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	if k := storageInternalKey(); k != "" {
		req.Header.Set("X-Internal-Key", k)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, &messageBodyLoadError{status: http.StatusBadGateway, msg: "failed to retrieve from storage", err: err}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, &messageBodyLoadError{status: http.StatusBadGateway, msg: "storage retrieval failed", err: fmt.Errorf("storage status %d", resp.StatusCode)}
	}

	rawBody, _, err := decodeStorageRetrieveBody(resp.Body)
	if err != nil {
		return nil, &messageBodyLoadError{status: http.StatusBadGateway, msg: "storage returned invalid payload", err: err}
	}

	return &MessageBodyResponse{
		EncryptedBody:         base64.StdEncoding.EncodeToString(rawBody),
		ContentKeyHPKEWrapped: base64.StdEncoding.EncodeToString(wrapped),
		EncryptionIV:          base64.StdEncoding.EncodeToString(iv),
		AADVersion:            aadVersion,
		BundleHash:            base64.StdEncoding.EncodeToString(hash),
		EncryptionVersion:     encryptionVersion,
		MessageSeq:            messageSeq,
	}, nil
}

func messageBodyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	messageID := r.PathValue("message_id")
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(messageID); err != nil {
		http.Error(w, "invalid message_id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var authorized string
	if err := conn.QueryRow(ctx, `SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`, mailboxID, userID).Scan(&authorized); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	response, err := loadEncryptedMessageBody(ctx, conn, mailboxID, messageID)
	if err != nil {
		var loadErr *messageBodyLoadError
		if errors.As(err, &loadErr) {
			http.Error(w, loadErr.msg, loadErr.status)
			return
		}
		http.Error(w, "message not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
