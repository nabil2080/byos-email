package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// GET /v1/mailboxes/{mailbox_id}/messages/{message_id}/attachments
func messageAttachmentsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	messageID := r.PathValue("message_id")
	if mailboxID == "" || messageID == "" {
		http.Error(w, "mailbox_id and message_id required", http.StatusBadRequest)
		return
	}
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

	// Verify session authorization for target mailbox
	if status, errMsg, authOk := verifyUserMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	var userOrgID, mailboxOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var rawEnvelopes []byte
	err = conn.QueryRow(ctx, `
		SELECT CASE
			WHEN folder = 'sent' AND jsonb_array_length(COALESCE(sender_attachment_envelopes, '[]'::jsonb)) > 0
			THEN sender_attachment_envelopes
			ELSE COALESCE(attachment_envelopes, '[]'::jsonb)
		END
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, messageID, mailboxID).Scan(&rawEnvelopes)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "message not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query error", http.StatusInternalServerError)
		return
	}

	var envelopes []AttachmentEnvelope
	if len(rawEnvelopes) > 0 {
		_ = json.Unmarshal(rawEnvelopes, &envelopes)
	}
	if envelopes == nil {
		envelopes = []AttachmentEnvelope{}
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"attachments": envelopes,
	})
}

// GET /v1/mailboxes/{mailbox_id}/messages/{message_id}/attachments/{attachment_id}/chunks/{index}
func messageAttachmentChunkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	messageID := r.PathValue("message_id")
	attachmentID := r.PathValue("attachment_id")
	indexStr := r.PathValue("index")

	if mailboxID == "" || messageID == "" || attachmentID == "" || indexStr == "" {
		http.Error(w, "missing path parameters", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(messageID); err != nil {
		http.Error(w, "invalid message_id UUID", http.StatusBadRequest)
		return
	}
	chunkIndex, err := strconv.Atoi(indexStr)
	if err != nil || chunkIndex < 0 {
		http.Error(w, "invalid chunk index", http.StatusBadRequest)
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

	// Verify session authorization for target mailbox
	if status, errMsg, authOk := verifyUserMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	var userOrgID, mailboxOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var rawEnvelopes []byte
	err = conn.QueryRow(ctx, `
		SELECT CASE
			WHEN folder = 'sent' AND jsonb_array_length(COALESCE(sender_attachment_envelopes, '[]'::jsonb)) > 0
			THEN sender_attachment_envelopes
			ELSE COALESCE(attachment_envelopes, '[]'::jsonb)
		END
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, messageID, mailboxID).Scan(&rawEnvelopes)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "message not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query error", http.StatusInternalServerError)
		return
	}

	var envelopes []AttachmentEnvelope
	if len(rawEnvelopes) > 0 {
		_ = json.Unmarshal(rawEnvelopes, &envelopes)
	}

	var targetChunk *AttachmentChunk
	for _, att := range envelopes {
		if att.AttachmentID == attachmentID {
			for _, ch := range att.Chunks {
				if ch.Index == chunkIndex {
					targetChunk = &ch
					break
				}
			}
			break
		}
	}
	if targetChunk == nil {
		http.Error(w, "attachment or chunk not found", http.StatusNotFound)
		return
	}

	storageBoxID := mailboxID
	if strings.HasPrefix(targetChunk.StorageRef, "mailboxes/") {
		parts := strings.Split(targetChunk.StorageRef, "/")
		if len(parts) >= 2 && parts[1] != "" {
			storageBoxID = parts[1]
		}
	}

	// Retrieve chunk from storage-worker
	retPayload, _ := json.Marshal(map[string]string{
		"object_key": targetChunk.StorageRef,
		"mailbox_id": storageBoxID,
	})
	retReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/retrieve", bytes.NewReader(retPayload))
	if err != nil {
		http.Error(w, "failed to prepare storage request", http.StatusInternalServerError)
		return
	}
	retReq.Header.Set("Content-Type", "application/json")
	setStorageInternalAuth(retReq)

	client := &http.Client{Timeout: 30 * time.Second}
	retResp, err := client.Do(retReq)
	if err != nil {
		http.Error(w, "storage-worker unavailable", http.StatusBadGateway)
		return
	}
	defer retResp.Body.Close()

	if retResp.StatusCode == http.StatusNotFound {
		http.Error(w, "chunk object not found in storage", http.StatusNotFound)
		return
	}
	if retResp.StatusCode != http.StatusOK {
		http.Error(w, "storage retrieve failed", http.StatusBadGateway)
		return
	}

	rawData, _, err := decodeStorageRetrieveBody(retResp.Body)
	if err != nil {
		http.Error(w, "storage decode failed", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(rawData)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(rawData)
}

// POST /v1/mailboxes/{mailbox_id}/attachment-chunks
func uploadAttachmentChunkHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox_id required", http.StatusBadRequest)
		return
	}
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

	// Verify session authorization for target mailbox
	if status, errMsg, authOk := verifyUserMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	var userOrgID, mailboxOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// 40 MB max chunk size
	r.Body = http.MaxBytesReader(w, r.Body, MaxAttachmentSize)

	// Can be JSON or octet-stream
	objectKey := r.Header.Get("X-Object-Key")
	var rawData []byte

	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var req struct {
			ObjectKey string `json:"object_key"`
			Data      string `json:"data"` // base64
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		objectKey = req.ObjectKey
		var decErr error
		rawData, decErr = base64.StdEncoding.DecodeString(req.Data)
		if decErr != nil {
			http.Error(w, "invalid base64 data", http.StatusBadRequest)
			return
		}
	} else {
		var readErr error
		rawData, readErr = io.ReadAll(r.Body)
		if readErr != nil {
			http.Error(w, "failed to read body", http.StatusBadRequest)
			return
		}
	}

	if objectKey == "" {
		http.Error(w, "object_key required", http.StatusBadRequest)
		return
	}

	// Tenant isolation: objectKey must start with mailboxes/{mailbox_id}/ and contain no path traversal
	prefix := fmt.Sprintf("mailboxes/%s/", mailboxID)
	if !strings.HasPrefix(objectKey, prefix) || strings.Contains(objectKey, "..") || strings.ContainsAny(objectKey, "\r\n\x00") {
		http.Error(w, "object_key outside mailbox scope or invalid", http.StatusForbidden)
		return
	}

	// Enforce authorized attachment chunk storage namespace
	subPath := strings.TrimPrefix(objectKey, prefix)
	if !strings.HasPrefix(subPath, "attachments/") &&
		!strings.HasPrefix(subPath, "path-a-attachments/") &&
		!strings.HasPrefix(subPath, "sent-attachments/") {
		http.Error(w, "object_key outside attachment chunk namespaces", http.StatusBadRequest)
		return
	}

	// FINDING-01 Remediation: Enforce canonical Section 12 AES-256-GCM encrypted envelope contract.
	if err := validateSection12BinaryEnvelope(rawData); err != nil {
		http.Error(w, fmt.Sprintf("invalid chunk envelope: %v", err), http.StatusBadRequest)
		return
	}

	// Store chunk via storage-worker
	err = storeInternalEnvelope(ctx, mailboxID, objectKey, 0, rawData)
	if err != nil {
		http.Error(w, fmt.Sprintf("store chunk failed: %v", err), http.StatusBadGateway)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "stored",
		"object_key": objectKey,
		"size_bytes": len(rawData),
	})
}

// validateSection12BinaryEnvelope performs structural envelope validation on
// Section 12 AES-256-GCM binary envelopes (wire format: 0x01 || Nonce(12B) || Ciphertext(NB) || Tag(16B)).
//
// TRUST BOUNDARY & CRYPTOGRAPHIC LIMITATION NOTE:
// In the BYOS zero-knowledge model, the backend API does NOT hold the ephemeral
// attachment content key or the recipient's private mailbox key (mailbox_sk).
// Consequently, the server CANNOT cryptographically verify the AES-GCM authentication
// tag or decrypt the ciphertext without violating zero-knowledge boundaries.
//
// This validation enforces:
// 1. Framing and minimum length (>= 29 bytes: 1B version + 12B nonce + 0B ciphertext + 16B tag).
// 2. Exact version match (0x01).
// 3. Non-degeneracy of the 12-byte IV (rejecting all-zero or all-identical byte nonces).
// 4. Non-degeneracy of the 16-byte GCM authentication tag (rejecting all-zero or all-identical tags).
// 5. Deep inspection heuristic: rejecting payloads containing recognizable plaintext markers
//    (MIME headers, HTML tags, SQL keywords) embedded anywhere in the envelope.
//
// Full cryptographic authenticity relies on the trusted-client assumption at the
// client-side encryption boundary.
func validateSection12BinaryEnvelope(rawData []byte) error {
	if len(rawData) < 29 {
		return fmt.Errorf("length %d below minimum framing (29 bytes)", len(rawData))
	}
	if rawData[0] != 0x01 {
		return fmt.Errorf("unsupported version 0x%02x, expected 0x01", rawData[0])
	}

	// Non-degenerate nonce validation
	nonce := rawData[1:13]
	allZeroNonce := true
	allIdenticalNonce := true
	for i := 0; i < len(nonce); i++ {
		if nonce[i] != 0x00 {
			allZeroNonce = false
		}
		if nonce[i] != nonce[0] {
			allIdenticalNonce = false
		}
	}
	if allZeroNonce || allIdenticalNonce {
		return fmt.Errorf("degenerate nonce detected (must be random 12-byte CSPRNG IV)")
	}

	// Non-degenerate authentication tag validation
	tag := rawData[len(rawData)-16:]
	allZeroTag := true
	allIdenticalTag := true
	for i := 0; i < len(tag); i++ {
		if tag[i] != 0x00 {
			allZeroTag = false
		}
		if tag[i] != tag[0] {
			allIdenticalTag = false
		}
	}
	if allZeroTag || allIdenticalTag {
		return fmt.Errorf("degenerate authentication tag detected (must be 16-byte GCM tag)")
	}

	// Deep inspection: Reject recognizable plaintext signatures embedded in envelope body
	plaintextMarkers := [][]byte{
		[]byte("From:"),
		[]byte("Received:"),
		[]byte("MIME-Version:"),
		[]byte("Content-Type:"),
		[]byte("<html"),
		[]byte("<!DOCTYPE"),
		[]byte("Subject:"),
		[]byte("To:"),
		[]byte("SELECT "),
		[]byte("INSERT INTO"),
	}
	for _, marker := range plaintextMarkers {
		if bytes.Contains(rawData[13:], marker) {
			return fmt.Errorf("unencrypted plaintext marker %q detected in envelope body", string(marker))
		}
	}

	return nil
}
