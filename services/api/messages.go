package main

import (
	"encoding/base64"
	"encoding/json"
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
		dsn = "******localhost:5432/byos?sslmode=disable"
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
		SELECT id::text, direction, sender, recipients, storage_object_id,
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
		if err := rows.Scan(&m.ID, &m.Direction, &m.Sender, &m.Recipients, &m.StorageObjectID,
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
