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
	Folder                string   `json:"folder"`
	FolderID              *string  `json:"folder_id,omitempty"`
	LabelIDs              []string `json:"label_ids"`
	IsRead                bool     `json:"is_read"`
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
		SELECT m.id::text, m.message_seq, m.direction, m.sender, m.recipients, m.storage_object_id,
		       m.content_key_hpke_wrapped, m.encryption_version, m.encryption_iv,
		       m.aad_version, m.bundle_hash, m.received_at, m.sent_at, m.status,
		       m.has_attachments, m.attachment_count,
		       COALESCE(m.folder, 'inbox'), COALESCE(m.folder_id::text, ''),
		       COALESCE(ARRAY_AGG(ml.label_id::text) FILTER (WHERE ml.label_id IS NOT NULL), ARRAY[]::text[]) as label_ids,
		       COALESCE(m.is_read, false)
		FROM message_metadata m
		LEFT JOIN message_labels ml ON ml.message_id = m.id
		WHERE m.mailbox_id=$1
		GROUP BY m.id
		ORDER BY COALESCE(m.sent_at, m.received_at) DESC
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
		var folder, folderIDStr string
		var labelIDs []string
		if err := rows.Scan(&m.ID, &m.MessageSeq, &m.Direction, &m.Sender, &m.Recipients, &m.StorageObjectID,
			&wrapped, &m.EncryptionVersion, &iv, &m.AADVersion, &hash,
			&receivedAt, &sentAt, &m.Status, &m.HasAttachments, &m.AttachmentCount,
			&folder, &folderIDStr, &labelIDs, &m.IsRead); err != nil {
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
		m.Folder = folder
		if folderIDStr != "" {
			m.FolderID = &folderIDStr
		}
		if labelIDs == nil {
			labelIDs = []string{}
		}
		m.LabelIDs = labelIDs
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

type UpdateMessageFolderRequest struct {
	Folder   *string `json:"folder"`
	FolderID *string `json:"folder_id"`
}

func messageFolderHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

	_, _, _, mailboxID, ok := resolveDraftMailbox(w, r, conn, ctx)
	if !ok {
		return
	}

	messageID := r.PathValue("message_id")
	if _, err := uuid.Parse(messageID); err != nil {
		http.Error(w, "invalid message_id UUID", http.StatusBadRequest)
		return
	}

	var req UpdateMessageFolderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	folder := "inbox"
	if req.Folder != nil && strings.TrimSpace(*req.Folder) != "" {
		folder = strings.ToLower(strings.TrimSpace(*req.Folder))
	}

	var folderUUID *string
	if req.FolderID != nil && strings.TrimSpace(*req.FolderID) != "" {
		fID := strings.TrimSpace(*req.FolderID)
		if _, err := uuid.Parse(fID); err != nil {
			http.Error(w, "folder_id must be valid UUID", http.StatusBadRequest)
			return
		}
		var checkID string
		err := conn.QueryRow(ctx, `SELECT id::text FROM mailbox_folders WHERE id=$1 AND mailbox_id=$2`, fID, mailboxID).Scan(&checkID)
		if err != nil {
			http.Error(w, "folder not found in this mailbox", http.StatusBadRequest)
			return
		}
		folderUUID = &fID
		folder = "custom"
	}

	tag, err := conn.Exec(ctx, `
		UPDATE message_metadata
		SET folder = $1, folder_id = $2
		WHERE id = $3 AND mailbox_id = $4`,
		folder, folderUUID, messageID, mailboxID)
	if err != nil {
		http.Error(w, "failed to update message folder", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "message not found", http.StatusNotFound)
		return
	}

	resp := map[string]interface{}{
		"status":     "ok",
		"message_id": messageID,
		"folder":     folder,
	}
	if folderUUID != nil {
		resp["folder_id"] = *folderUUID
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

type MessageLabelRequest struct {
	LabelID string `json:"label_id"`
}

func messageLabelsHandler(w http.ResponseWriter, r *http.Request) {
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

	_, _, _, mailboxID, ok := resolveDraftMailbox(w, r, conn, ctx)
	if !ok {
		return
	}

	messageID := r.PathValue("message_id")
	if _, err := uuid.Parse(messageID); err != nil {
		http.Error(w, "invalid message_id UUID", http.StatusBadRequest)
		return
	}

	var checkMsgID string
	if err := conn.QueryRow(ctx, `SELECT id::text FROM message_metadata WHERE id=$1 AND mailbox_id=$2`, messageID, mailboxID).Scan(&checkMsgID); err != nil {
		http.Error(w, "message not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case http.MethodPost:
		var req MessageLabelRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		labelID := strings.TrimSpace(req.LabelID)
		if _, err := uuid.Parse(labelID); err != nil {
			http.Error(w, "invalid label_id UUID", http.StatusBadRequest)
			return
		}
		var checkLabelID string
		if err := conn.QueryRow(ctx, `SELECT id::text FROM mailbox_labels WHERE id=$1 AND mailbox_id=$2`, labelID, mailboxID).Scan(&checkLabelID); err != nil {
			http.Error(w, "label not found in mailbox", http.StatusBadRequest)
			return
		}
		_, err = conn.Exec(ctx, `
			INSERT INTO message_labels (message_id, label_id)
			VALUES ($1, $2)
			ON CONFLICT (message_id, label_id) DO NOTHING`, messageID, labelID)
		if err != nil {
			http.Error(w, "failed to attach label", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok", "message_id": messageID, "label_id": labelID})

	case http.MethodDelete:
		labelID := r.PathValue("label_id")
		if labelID == "" {
			labelID = r.URL.Query().Get("label_id")
		}
		if _, err := uuid.Parse(labelID); err != nil {
			http.Error(w, "invalid label_id UUID", http.StatusBadRequest)
			return
		}
		_, err = conn.Exec(ctx, `DELETE FROM message_labels WHERE message_id=$1 AND label_id=$2`, messageID, labelID)
		if err != nil {
			http.Error(w, "failed to detach label", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// messageReadHandler handles PUT /v1/mailboxes/{mailbox_id}/messages/{message_id}/read
// Body: {"read": true|false}
func messageReadHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	messageID := r.PathValue("message_id")
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(messageID); err != nil {
		http.Error(w, "invalid message_id", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var body struct {
		Read bool `json:"read"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Verify ownership
	var authorized string
	if err := conn.QueryRow(ctx,
		`SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`,
		mailboxID, userID).Scan(&authorized); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	_, err = conn.Exec(ctx,
		`UPDATE message_metadata SET is_read=$1 WHERE id=$2 AND mailbox_id=$3`,
		body.Read, messageID, mailboxID)
	if err != nil {
		http.Error(w, "failed to update read state", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func computeDeliveryIdentity(envelopeFrom string, recipients []string, rawMessage []byte) [32]byte {
	msg, err := mail.ReadMessage(bytes.NewReader(rawMessage))
	if err != nil {
		return deliveryIdentityFallback(envelopeFrom, recipients, rawMessage)
	}

	messageID := msg.Header.Get("Message-ID")
	normalizedMessageID := normalizeMessageID(messageID)
	normalizedSender := strings.ToLower(strings.TrimSpace(envelopeFrom))

	normalizedRecipients := make([]string, len(recipients))
	for i, r := range recipients {
		normalizedRecipients[i] = strings.ToLower(strings.TrimSpace(r))
	}
	sort.Strings(normalizedRecipients)
	normalizedSortedRecipients := strings.Join(normalizedRecipients, "")

	h := sha256.New()
	if normalizedMessageID != "" {
		h.Write([]byte(normalizedMessageID))
		h.Write([]byte{0})
		h.Write([]byte(normalizedSender))
		h.Write([]byte{0})
		h.Write([]byte(normalizedSortedRecipients))
	} else {
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

func normalizeMessageID(messageID string) string {
	if messageID == "" {
		return ""
	}
	messageID = strings.TrimSpace(messageID)
	messageID = strings.Trim(messageID, "<>")
	return strings.ToLower(strings.TrimSpace(messageID))
}

func deliveryIdentityFallback(envelopeFrom string, recipients []string, rawMessage []byte) [32]byte {
	h := sha256.New()
	h.Write([]byte(strings.ToLower(strings.TrimSpace(envelopeFrom))))
	h.Write([]byte{0})

	normalizedRecipients := make([]string, len(recipients))
	for i, r := range recipients {
		normalizedRecipients[i] = strings.ToLower(strings.TrimSpace(r))
	}
	sort.Strings(normalizedRecipients)
	h.Write([]byte(strings.Join(normalizedRecipients, ",")))
	h.Write([]byte{0})
	h.Write(rawMessage)

	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// POST /v1/mailboxes/{mailbox_id}/messages/import
// Body: {"raw_eml": "<base64>", "folder": "inbox", "is_read": false}
func messageImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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

	r.Body = http.MaxBytesReader(w, r.Body, 35<<20)
	var req struct {
		RawEml string `json:"raw_eml"`
		Folder string `json:"folder"`
		IsRead bool   `json:"is_read"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.RawEml) == "" {
		http.Error(w, "raw_eml is required", http.StatusBadRequest)
		return
	}

	rawMessage, err := base64.StdEncoding.DecodeString(req.RawEml)
	if err != nil || len(rawMessage) == 0 {
		http.Error(w, "invalid or empty raw_eml base64 payload", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var domainID, orgID, localPart, domainName, objectPrefix string
	var mailboxPK []byte
	var mailboxSKVersion int32
	err = conn.QueryRow(ctx, `
		SELECT m.domain_id::text, m.org_id::text, m.local_part, d.name, m.mailbox_pk, m.mailbox_sk_version, COALESCE(ms.object_prefix, '')
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		JOIN users u ON u.org_id = m.org_id
		LEFT JOIN mailbox_storage ms ON ms.mailbox_id = m.id AND ms.status = 'active'
		WHERE m.id = $1 AND u.id = $2 AND u.is_active = true AND m.is_active = true`,
		mailboxID, userID,
	).Scan(&domainID, &orgID, &localPart, &domainName, &mailboxPK, &mailboxSKVersion, &objectPrefix)
	if err != nil {
		log.Printf("messageImportHandler: mailbox lookup error: %v (mailbox=%s, user=%s)", err, mailboxID, userID)
		http.Error(w, "forbidden or mailbox not found", http.StatusForbidden)
		return
	}
	if len(mailboxPK) == 0 {
		http.Error(w, "mailbox public key not initialized", http.StatusBadRequest)
		return
	}

	msg, parseErr := mail.ReadMessage(bytes.NewReader(rawMessage))
	var sender string
	var recipients []string
	receivedAt := time.Now().UTC()
	var hasAttachments bool
	var attachmentCount int

	if parseErr == nil && msg != nil {
		if fromHdr := msg.Header.Get("From"); fromHdr != "" {
			if parsedAddr, err := mail.ParseAddress(fromHdr); err == nil {
				sender = parsedAddr.Address
			} else {
				sender = strings.TrimSpace(fromHdr)
			}
		}

		for _, hdrName := range []string{"To", "Cc", "Bcc"} {
			if val := msg.Header.Get(hdrName); val != "" {
				if addrs, err := mail.ParseAddressList(val); err == nil {
					for _, a := range addrs {
						recipients = append(recipients, a.Address)
					}
				} else {
					for _, part := range strings.Split(val, ",") {
						if p := strings.TrimSpace(part); p != "" {
							recipients = append(recipients, p)
						}
					}
				}
			}
		}

		if dateHdr := msg.Header.Get("Date"); dateHdr != "" {
			if parsedDate, err := mail.ParseDate(dateHdr); err == nil {
				receivedAt = parsedDate.UTC()
			}
		}

		ct := strings.ToLower(msg.Header.Get("Content-Type"))
		if strings.Contains(ct, "multipart/mixed") || strings.Contains(ct, "multipart/related") {
			hasAttachments = true
			attachmentCount = 1
		}
	}

	if sender == "" {
		sender = "unknown@imported.local"
	}
	if len(recipients) == 0 {
		recipients = []string{strings.ToLower(localPart + "@" + domainName)}
	}

	deliveryID := computeDeliveryIdentity(sender, recipients, rawMessage)

	// Check deduplication
	var existingID, existingStorageObj string
	err = conn.QueryRow(ctx, `
		SELECT id::text, storage_object_id
		FROM message_metadata
		WHERE mailbox_id = $1 AND delivery_identity = $2`,
		mailboxID, deliveryID[:],
	).Scan(&existingID, &existingStorageObj)
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":            "already_imported",
			"message_id":        existingID,
			"storage_object_id": existingStorageObj,
		})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "deduplication check failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var messageSeq int64
	if err := conn.QueryRow(ctx, "SELECT nextval('mailbox_message_seq')").Scan(&messageSeq); err != nil {
		http.Error(w, "failed to allocate message sequence", http.StatusInternalServerError)
		return
	}

	storageObjectID := fmt.Sprintf("mailboxes/%s/%020d.eml.enc", mailboxID, messageSeq)

	// Encrypt via crypto-worker
	cryptoPayload := map[string]interface{}{
		"mailbox_id":         mailboxID,
		"message_seq":        messageSeq,
		"mailbox_public_key": base64.StdEncoding.EncodeToString(mailboxPK),
		"plaintext":          base64.StdEncoding.EncodeToString(rawMessage),
		"storage_object_id":  storageObjectID,
		"mailbox_sk_version": mailboxSKVersion,
	}
	cryptoJSON, err := json.Marshal(cryptoPayload)
	if err != nil {
		http.Error(w, "failed to marshal crypto request", http.StatusInternalServerError)
		return
	}

	cryptoReq, err := http.NewRequestWithContext(ctx, http.MethodPost, getCryptoWorkerURL()+"/v1/encrypt", bytes.NewReader(cryptoJSON))
	if err != nil {
		http.Error(w, "failed to create crypto request", http.StatusInternalServerError)
		return
	}
	cryptoReq.Header.Set("Content-Type", "application/json")

	cryptoClient := &http.Client{Timeout: 30 * time.Second}
	cryptoResp, err := cryptoClient.Do(cryptoReq)
	if err != nil || cryptoResp.StatusCode != http.StatusOK {
		if cryptoResp != nil {
			cryptoResp.Body.Close()
		}
		http.Error(w, "crypto worker unavailable", http.StatusServiceUnavailable)
		return
	}
	defer cryptoResp.Body.Close()

	var cryptoResult struct {
		Ciphertext            string `json:"ciphertext"`
		ContentKeyHPKEWrapped string `json:"content_key_hpke_wrapped"`
		EncryptionIV          string `json:"encryption_iv"`
		BundleHash            string `json:"bundle_hash"`
		EncryptionVersion     int    `json:"encryption_version"`
		AADVersion            int    `json:"aad_version"`
	}
	if err := json.NewDecoder(cryptoResp.Body).Decode(&cryptoResult); err != nil {
		http.Error(w, "failed to decode crypto response", http.StatusBadGateway)
		return
	}

	ciphertextBytes, err := base64.StdEncoding.DecodeString(cryptoResult.Ciphertext)
	if err != nil {
		http.Error(w, "invalid ciphertext from crypto worker", http.StatusBadGateway)
		return
	}
	wrappedKeyBytes, _ := base64.StdEncoding.DecodeString(cryptoResult.ContentKeyHPKEWrapped)
	ivBytes, _ := base64.StdEncoding.DecodeString(cryptoResult.EncryptionIV)
	bundleHashBytes, _ := base64.StdEncoding.DecodeString(cryptoResult.BundleHash)

	// Store in storage-worker
	storagePayload := map[string]interface{}{
		"object_key": storageObjectID,
		"mailbox_id": mailboxID,
		"data":       ciphertextBytes,
		"metadata": map[string]string{
			"mailbox_id":   mailboxID,
			"message_seq":  fmt.Sprintf("%d", messageSeq),
			"content_type": "application/octet-stream",
		},
	}
	storageJSON, err := json.Marshal(storagePayload)
	if err != nil {
		http.Error(w, "failed to marshal storage request", http.StatusInternalServerError)
		return
	}

	storageReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", bytes.NewReader(storageJSON))
	if err != nil {
		http.Error(w, "failed to create storage request", http.StatusInternalServerError)
		return
	}
	storageReq.Header.Set("Content-Type", "application/json")
	if k := storageInternalKey(); k != "" {
		storageReq.Header.Set("X-Internal-Key", k)
	}

	storageClient := &http.Client{Timeout: 30 * time.Second}
	storageResp, err := storageClient.Do(storageReq)
	if err != nil || storageResp.StatusCode != http.StatusOK {
		var respBody string
		if storageResp != nil {
			b, _ := io.ReadAll(storageResp.Body)
			respBody = string(b)
			storageResp.Body.Close()
		}
		log.Printf("messageImportHandler: storage store failed: err=%v status=%v body=%s (objectKey=%s)", err, storageResp.Status, respBody, storageObjectID)
		http.Error(w, "storage worker store failed: "+respBody, http.StatusBadGateway)
		return
	}
	storageResp.Body.Close()

	folder := strings.TrimSpace(req.Folder)
	if folder == "" {
		folder = "inbox"
	}
	folder = strings.ToLower(folder)
	if len(folder) > 32 {
		folder = folder[:32]
	}

	var messageID string
	err = conn.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, delivery_identity, sender, recipients,
			has_attachments, attachment_count, storage_object_id, content_key_hpke_wrapped,
			mailbox_sk_version, encryption_version, encryption_iv, aad_version, bundle_hash,
			received_at, status, folder, is_read
		) VALUES (
			$1, $2, $3, 'received', $4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13, $14, $15,
			$16, 'received', $17, $18
		) RETURNING id::text`,
		mailboxID, domainID, messageSeq, deliveryID[:], strings.ToLower(strings.TrimSpace(sender)), recipients,
		hasAttachments, attachmentCount, storageObjectID, wrappedKeyBytes,
		mailboxSKVersion, cryptoResult.EncryptionVersion, ivBytes, cryptoResult.AADVersion, bundleHashBytes,
		receivedAt, folder, req.IsRead,
	).Scan(&messageID)
	if err != nil {
		http.Error(w, "failed to insert message metadata: "+err.Error(), http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "import_message", "message", messageID, map[string]interface{}{
		"mailbox_id":  mailboxID,
		"message_seq": messageSeq,
		"folder":      folder,
		"sender":      sender,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":            "imported",
		"message_id":        messageID,
		"message_seq":       messageSeq,
		"storage_object_id": storageObjectID,
	})
}

