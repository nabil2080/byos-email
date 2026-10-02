package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"byos.email/crypto/envelope"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type AttachmentWrappedKey struct {
	X25519Encapsulated string `json:"x25519_encapsulated"`
	MLKEMEncryptedKey  string `json:"mlkem_encrypted_key"`
}

type AttachmentChunk struct {
	Index      int    `json:"index"`
	StorageRef string `json:"storage_ref"`
	SizeBytes  int64  `json:"size_bytes"`
}

type AttachmentEnvelope struct {
	AttachmentID      string               `json:"attachment_id"`
	Filename          string               `json:"filename"`
	MimeType          string               `json:"mime_type"`
	SizeBytes         int64                `json:"size_bytes"`
	IV                string               `json:"iv"`
	WrappedKey        AttachmentWrappedKey `json:"wrapped_key"`
	ContentHashSHA256 string               `json:"content_hash_sha256"`
	ChunkCount        int                  `json:"chunk_count"`
	Chunks            []AttachmentChunk    `json:"chunks"`
}

type InternalSendRequest struct {
	EnvelopeJSON              string               `json:"envelope_json"`
	SenderEnvelopeJSON        string               `json:"sender_envelope_json,omitempty"`
	Recipient                 string               `json:"recipient"`
	SenderMailboxID           string               `json:"sender_mailbox_id"`
	AttachmentEnvelopes       []AttachmentEnvelope `json:"attachment_envelopes,omitempty"`
	SenderAttachmentEnvelopes []AttachmentEnvelope `json:"sender_attachment_envelopes,omitempty"`
}

type InternalSendResponse struct {
	DeliveryID string `json:"delivery_id"`
	MessageID  string `json:"message_id"`
	Status     string `json:"status"`
	MessageSeq int64  `json:"message_seq"`
}

func writeInternalSendError(w http.ResponseWriter, statusCode int, errorCode string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"error": errorCode,
	})
}

// storeInternalEnvelope writes an encrypted Path A envelope to storage-worker via /api/store.
func storeInternalEnvelope(ctx context.Context, mailboxID, objectKey string, messageSeq int64, envelopeBytes []byte) error {
	payload := map[string]interface{}{
		"object_key": objectKey,
		"mailbox_id": mailboxID,
		"data":       envelopeBytes,
		"metadata": map[string]string{
			"mailbox_id":   mailboxID,
			"message_seq":  fmt.Sprintf("%d", messageSeq),
			"content_type": "application/json",
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal storage payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create storage request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if k := storageInternalKey(); k != "" {
		req.Header.Set("X-Internal-Key", k)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("storage request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("storage store failed: status %d body %s", resp.StatusCode, string(respBytes))
	}
	return nil
}

func checkChunkStorageExists(ctx context.Context, mailboxID, storageRef string) error {
	payload, err := json.Marshal(map[string]string{
		"object_key": storageRef,
		"mailbox_id": mailboxID,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/head", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if k := storageInternalKey(); k != "" {
		req.Header.Set("X-Internal-Key", k)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("storage request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("chunk not found: %s", storageRef)
	}
	return nil
}


// createSentMessageCopy writes an encrypted sent copy into customer storage and records
// it in message_metadata under the Sent folder. Used by both internalSendHandler and scheduled delivery.
func createSentMessageCopy(
	ctx context.Context,
	tx pgx.Tx,
	senderMailboxID, senderDomainID string,
	senderEmail, recipient string,
	envelopeBytes []byte,
	keyEpoch, version int,
	wrappedKeyAlg string,
	idempotencyKey string,
	attachmentEnvelopes []AttachmentEnvelope,
) (messageID string, storageObjectID string, err error) {
	if len(envelopeBytes) == 0 {
		return "", "", errors.New("envelope bytes empty")
	}

	var senderDeliveryIdentity [32]byte
	if idempotencyKey != "" {
		senderDeliveryIdentity = sha256.Sum256([]byte("sent_copy:" + senderMailboxID + ":" + idempotencyKey))
	} else {
		senderDeliveryIdentity = sha256.Sum256(envelopeBytes)
	}

	// Idempotency check: see if a sent copy with this delivery_identity already exists
	var existingID string
	var existingStorageID string
	err = tx.QueryRow(ctx, `
		SELECT id::text, storage_object_id
		FROM message_metadata
		WHERE mailbox_id = $1 AND delivery_identity = $2
	`, senderMailboxID, senderDeliveryIdentity[:]).Scan(&existingID, &existingStorageID)
	if err == nil {
		return existingID, existingStorageID, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", fmt.Errorf("idempotency check: %w", err)
	}

	// Allocate sender sequence
	var senderMessageSeq int64
	if err := tx.QueryRow(ctx, "SELECT nextval('mailbox_message_seq')").Scan(&senderMessageSeq); err != nil {
		return "", "", fmt.Errorf("sequence allocation: %w", err)
	}

	senderStorageObjectID := fmt.Sprintf("mailboxes/%s/%020d.eml.enc", senderMailboxID, senderMessageSeq)

	if err := storeInternalEnvelope(ctx, senderMailboxID, senderStorageObjectID, senderMessageSeq, envelopeBytes); err != nil {
		return "", "", fmt.Errorf("store envelope: %w", err)
	}

	if wrappedKeyAlg == "" {
		wrappedKeyAlg = "HPKE-XWing-AES256GCM-v1"
	}
	if keyEpoch == 0 {
		keyEpoch = 1
	}
	if version == 0 {
		version = 1
	}

	hasAttachments := len(attachmentEnvelopes) > 0
	attCount := len(attachmentEnvelopes)
	var attBytes []byte
	if hasAttachments {
		attBytes, err = json.Marshal(attachmentEnvelopes)
		if err != nil {
			return "", "", fmt.Errorf("marshal attachment envelopes: %w", err)
		}
	} else {
		attBytes = []byte("[]")
	}

	err = tx.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, folder, delivery_identity,
			sender, recipients, has_attachments, attachment_count,
			storage_object_id, content_key_hpke_wrapped,
			mailbox_sk_version, encryption_version, encryption_iv, aad_version,
			bundle_hash, status, wrapped_key_algorithm, is_read, sent_at,
			attachment_envelopes, sender_attachment_envelopes
		) VALUES (
			$1, $2, $3, 'sent', 'sent', $4,
			$5, $6, $7, $8,
			$9, $10,
			$11, $12, $13, $14,
			$15, 'sent', $16, true, now(),
			$17, $17
		) RETURNING id::text
	`,
		senderMailboxID, senderDomainID, senderMessageSeq, senderDeliveryIdentity[:],
		senderEmail, []string{recipient},
		hasAttachments, attCount,
		senderStorageObjectID, []byte{},
		keyEpoch, version, []byte{}, 1,
		senderDeliveryIdentity[:],
		wrappedKeyAlg, attBytes,
	).Scan(&messageID)
	if err != nil {
		if reErr := tx.QueryRow(ctx, `
			SELECT id::text, storage_object_id
			FROM message_metadata
			WHERE mailbox_id = $1 AND delivery_identity = $2
		`, senderMailboxID, senderDeliveryIdentity[:]).Scan(&existingID, &existingStorageID); reErr == nil {
			return existingID, existingStorageID, nil
		}
		return "", "", fmt.Errorf("insert message_metadata: %w", err)
	}

	return messageID, senderStorageObjectID, nil
}

// deliverEnvelopeToMailbox stores a Path A envelope into the recipient's mailbox.
// It is used by both internalSendHandler (HTTP) and the scheduled Path A delivery goroutine.
//
// Parameters:
//   - ctx: request context
//   - conn: pgx connection (used for idempotency check and duplicate read-back)
//   - tx: open transaction to write into
//   - recipientMailboxID: recipient's mailbox UUID string
//   - recipientDomainID: recipient's domain UUID string
//   - senderEmail: full sender address (e.g. "alice@example.com")
//   - cleanRecipient: normalised recipient address
//   - envelopeJSON: the raw JSON XWing envelope string
//   - env: the already-parsed and signature-verified CryptoEnvelope
//   - attachmentEnvelopes: attachment metadata envelopes (if any)
//
// Returns (messageID, messageSeq, error).
// On "already delivered" the function returns ("", 0, nil) — caller should treat
// this as idempotent success. Callers must check messageID == "" for that case.
func deliverEnvelopeToMailbox(
	ctx context.Context,
	conn *pgx.Conn,
	tx pgx.Tx,
	recipientMailboxID, recipientDomainID string,
	senderEmail, cleanRecipient string,
	envelopeJSON string,
	env *envelope.CryptoEnvelope,
	attachmentEnvelopes []AttachmentEnvelope,
) (messageID string, messageSeq int64, err error) {
	// 1. Compute delivery_identity = SHA256(envelope_json)
	deliveryIdentity := sha256.Sum256([]byte(envelopeJSON))

	// 2. Idempotency check
	var existingMessageID string
	var existingMessageSeq int64
	err = tx.QueryRow(ctx, `
		SELECT id::text, message_seq
		FROM message_metadata
		WHERE mailbox_id = $1 AND delivery_identity = $2
	`, recipientMailboxID, deliveryIdentity[:]).Scan(&existingMessageID, &existingMessageSeq)
	if err == nil {
		// Already delivered — idempotent success
		return "", 0, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", 0, fmt.Errorf("idempotency check: %w", err)
	}

	// 3. Allocate sequence
	if err := tx.QueryRow(ctx, "SELECT nextval('mailbox_message_seq')").Scan(&messageSeq); err != nil {
		return "", 0, fmt.Errorf("allocate sequence: %w", err)
	}

	// 4. Build storage_object_id
	storageObjectID := fmt.Sprintf("mailboxes/%s/%020d.eml.enc", recipientMailboxID, messageSeq)

	// 5. POST to storage-worker
	if err := storeInternalEnvelope(ctx, recipientMailboxID, storageObjectID, messageSeq, []byte(envelopeJSON)); err != nil {
		return "", 0, fmt.Errorf("store envelope: %w", err)
	}

	// NOTE: Path A mail does not populate message_id, in_reply_to, or
	// thread_id because those headers live inside the encrypted envelope
	// and are inaccessible to the server. Replies to Path A mail therefore
	// start new threads. Cross-message threading for Path A is deferred
	// to V2 (see Appendix D).

	hasAttachments := len(attachmentEnvelopes) > 0
	attCount := len(attachmentEnvelopes)
	var attBytes []byte
	if hasAttachments {
		attBytes, err = json.Marshal(attachmentEnvelopes)
		if err != nil {
			return "", 0, fmt.Errorf("marshal attachment envelopes: %w", err)
		}
	} else {
		attBytes = []byte("[]")
	}

	// 6. INSERT message_metadata
	// Data hygiene: recipient row must NOT store sender's wrapped keys (sender_attachment_envelopes = '[]'::jsonb).
	err = tx.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, delivery_identity, sender, recipients,
			has_attachments, attachment_count, storage_object_id, content_key_hpke_wrapped,
			mailbox_sk_version, encryption_version, encryption_iv, aad_version, bundle_hash,
			status, wrapped_key_algorithm, attachment_envelopes, sender_attachment_envelopes
		) VALUES (
			$1, $2, $3, 'received', $4, $5, $6,
			$7, $8, $9, $10,
			$11, $12, $13, $14, $15,
			'received', $16, $17, '[]'::jsonb
		) RETURNING id::text
	`,
		recipientMailboxID, recipientDomainID, messageSeq, deliveryIdentity[:], senderEmail, []string{cleanRecipient},
		hasAttachments, attCount, storageObjectID, []byte{},
		int(env.KeyEpoch), int(env.V), []byte{}, 1, deliveryIdentity[:],
		"HPKE-XWing-AES256GCM-v1", attBytes,
	).Scan(&messageID)
	if err != nil {
		// Check for unique violation (concurrent insert of same delivery_identity)
		var dupID string
		var dupSeq int64
		if reErr := conn.QueryRow(ctx, `
			SELECT id::text, message_seq
			FROM message_metadata
			WHERE mailbox_id = $1 AND delivery_identity = $2
		`, recipientMailboxID, deliveryIdentity[:]).Scan(&dupID, &dupSeq); reErr == nil {
			// Concurrent duplicate — treat as idempotent
			return "", 0, nil
		}
		return "", 0, fmt.Errorf("insert message_metadata: %w", err)
	}

	return messageID, messageSeq, nil
}

func internalSendHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 1. Auth
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		writeInternalSendError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// 2. Rate limit
	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		writeInternalSendError(w, http.StatusTooManyRequests, "rate_limited")
		return
	}

	// 3. Body cap (4 MB)
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)

	// 4. Parse JSON
	var req InternalSendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if strings.TrimSpace(req.EnvelopeJSON) == "" || strings.TrimSpace(req.Recipient) == "" || strings.TrimSpace(req.SenderMailboxID) == "" {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_request")
		return
	}
	if _, err := uuid.Parse(req.SenderMailboxID); err != nil {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_sender_mailbox_id")
		return
	}

	// Validate total attachment payload size <= 40 MB
	var totalRecipientBytes int64
	for _, att := range req.AttachmentEnvelopes {
		attSize := att.SizeBytes
		var attChunkSum int64
		for _, chunk := range att.Chunks {
			attChunkSum += chunk.SizeBytes
		}
		if attChunkSum > attSize {
			attSize = attChunkSum
		}
		totalRecipientBytes += attSize
	}
	var totalSenderBytes int64
	for _, att := range req.SenderAttachmentEnvelopes {
		attSize := att.SizeBytes
		var attChunkSum int64
		for _, chunk := range att.Chunks {
			attChunkSum += chunk.SizeBytes
		}
		if attChunkSum > attSize {
			attSize = attChunkSum
		}
		totalSenderBytes += attSize
	}
	if totalRecipientBytes > MaxAttachmentSize || totalSenderBytes > MaxAttachmentSize {
		writeInternalSendError(w, http.StatusBadRequest, "attachments exceed 40 MB limit")
		return
	}

	if len(req.AttachmentEnvelopes) > 0 {
		if req.SenderEnvelopeJSON != "" {
			if len(req.SenderAttachmentEnvelopes) != len(req.AttachmentEnvelopes) {
				writeInternalSendError(w, http.StatusBadRequest, "sender_attachment_envelopes required for path a attachments")
				return
			}
			for i, sEnv := range req.SenderAttachmentEnvelopes {
				recEnv := req.AttachmentEnvelopes[i]
				if sEnv.WrappedKey.X25519Encapsulated == recEnv.WrappedKey.X25519Encapsulated &&
					sEnv.WrappedKey.MLKEMEncryptedKey == recEnv.WrappedKey.MLKEMEncryptedKey &&
					sEnv.WrappedKey.X25519Encapsulated != "" {
					writeInternalSendError(w, http.StatusBadRequest, "sent copy must not reuse recipient wrapped key")
					return
				}
				if len(sEnv.Chunks) != len(recEnv.Chunks) {
					writeInternalSendError(w, http.StatusBadRequest, "sent copy chunk count mismatch")
					return
				}
				for j, sChunk := range sEnv.Chunks {
					recChunk := recEnv.Chunks[j]
					if sChunk.StorageRef == recChunk.StorageRef {
						writeInternalSendError(w, http.StatusBadRequest, "sent copy chunks must not share storage refs with recipient")
						return
					}
					if !strings.Contains(sChunk.StorageRef, "sent-attachments/") {
						writeInternalSendError(w, http.StatusBadRequest, "sender chunk ref must use sent-attachments prefix")
						return
					}
				}
			}
		}

		// Verify recipient chunk storage refs exist and use namespaced prefix
		for _, att := range req.AttachmentEnvelopes {
			for _, chunk := range att.Chunks {
				if !strings.Contains(chunk.StorageRef, "path-a-attachments/") {
					writeInternalSendError(w, http.StatusBadRequest, "recipient chunk ref must use path-a-attachments prefix")
					return
				}
				if err := checkChunkStorageExists(r.Context(), req.SenderMailboxID, chunk.StorageRef); err != nil {
					writeInternalSendError(w, http.StatusBadRequest, fmt.Sprintf("chunk missing: %s", chunk.StorageRef))
					return
				}
			}
		}
		// Verify sender chunk storage refs exist
		for _, att := range req.SenderAttachmentEnvelopes {
			for _, chunk := range att.Chunks {
				if err := checkChunkStorageExists(r.Context(), req.SenderMailboxID, chunk.StorageRef); err != nil {
					writeInternalSendError(w, http.StatusBadRequest, fmt.Sprintf("chunk missing: %s", chunk.StorageRef))
					return
				}
			}
		}
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "database_connection_failed")
		return
	}
	defer conn.Close(ctx)

	// 5. Validate sender owns the mailbox
	var senderOrgID string
	var senderDomainID string
	var senderLocalPart string
	var senderDomainName string
	var senderEd25519PK []byte
	err = conn.QueryRow(ctx, `
		SELECT m.org_id::text, m.local_part, d.name, m.mailbox_ed25519_pk, d.id::text
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE m.id = $1 AND m.user_id = $2 AND m.is_active = true
	`, req.SenderMailboxID, userID).Scan(&senderOrgID, &senderLocalPart, &senderDomainName, &senderEd25519PK, &senderDomainID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeInternalSendError(w, http.StatusForbidden, "not_sender_mailbox")
			return
		}
		writeInternalSendError(w, http.StatusInternalServerError, "database_error")
		return
	}
	senderEmail := strings.ToLower(senderLocalPart) + "@" + strings.ToLower(senderDomainName)

	// 6. Parse and validate recipient
	cleanRecipient := strings.TrimSpace(req.Recipient)
	parts := strings.Split(cleanRecipient, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_recipient")
		return
	}
	localPart := strings.ToLower(parts[0])
	domainName := strings.ToLower(parts[1])

	var recipientMailboxID, recipientDomainID string
	var recipientXWingPK, recipientEd25519PK []byte
	err = conn.QueryRow(ctx, `
		SELECT m.id::text, m.mailbox_xwing_pk, m.mailbox_ed25519_pk, d.id::text
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE lower(m.local_part) = $1 AND lower(d.name) = $2
		  AND m.is_active = true AND m.key_status = 'active'
	`, localPart, domainName).Scan(&recipientMailboxID, &recipientXWingPK, &recipientEd25519PK, &recipientDomainID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeInternalSendError(w, http.StatusNotFound, "recipient_not_found")
			return
		}
		writeInternalSendError(w, http.StatusInternalServerError, "database_error")
		return
	}
	if len(recipientXWingPK) == 0 {
		writeInternalSendError(w, http.StatusBadRequest, "recipient_not_xwing")
		return
	}

	// 7. Parse envelope via envelope.UnmarshalCanonical
	env, err := envelope.UnmarshalCanonical([]byte(req.EnvelopeJSON))
	if err != nil {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_envelope")
		return
	}
	if env.V != 1 {
		writeInternalSendError(w, http.StatusBadRequest, "unsupported_version")
		return
	}
	if env.Alg != "HPKE-XWing-AES256GCM-v1" {
		writeInternalSendError(w, http.StatusBadRequest, "unsupported_algorithm")
		return
	}
	if env.KeyID != recipientMailboxID {
		writeInternalSendError(w, http.StatusBadRequest, "key_id_mismatch")
		return
	}
	if env.KeyEpoch == 0 {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_key_epoch")
		return
	}

	// 8. Fetch sender's ed25519 pubkey check
	if len(senderEd25519PK) == 0 {
		writeInternalSendError(w, http.StatusBadRequest, "sender_has_no_signing_key")
		return
	}

	// 9. Verify signature
	// Canonical form is AAD || ciphertext (raw bytes). Attachment envelopes are excluded from message envelope signature.
	if err := envelope.VerifyEnvelopeSignature(senderEd25519PK, env); err != nil {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_signature")
		return
	}

	var senderEnv *envelope.CryptoEnvelope
	if strings.TrimSpace(req.SenderEnvelopeJSON) != "" {
		senderEnv, err = envelope.UnmarshalCanonical([]byte(req.SenderEnvelopeJSON))
		if err != nil {
			writeInternalSendError(w, http.StatusBadRequest, "invalid_sender_envelope")
			return
		}
		if senderEnv.V != 1 {
			writeInternalSendError(w, http.StatusBadRequest, "unsupported_sender_version")
			return
		}
		if senderEnv.Alg != "HPKE-XWing-AES256GCM-v1" {
			writeInternalSendError(w, http.StatusBadRequest, "unsupported_sender_algorithm")
			return
		}
		if senderEnv.KeyID != req.SenderMailboxID {
			writeInternalSendError(w, http.StatusBadRequest, "sender_key_id_mismatch")
			return
		}
		if senderEnv.KeyEpoch == 0 {
			writeInternalSendError(w, http.StatusBadRequest, "invalid_sender_key_epoch")
			return
		}
		if err := envelope.VerifyEnvelopeSignature(senderEd25519PK, senderEnv); err != nil {
			writeInternalSendError(w, http.StatusBadRequest, "invalid_sender_signature")
			return
		}
	}

	// 10. Transaction begins
	tx, err := conn.Begin(ctx)
	if err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "transaction_begin_failed")
		return
	}
	defer tx.Rollback(ctx)

	// 11–15. Deliver to recipient mailbox
	messageID, messageSeq, err := deliverEnvelopeToMailbox(
		ctx, conn, tx,
		recipientMailboxID, recipientDomainID,
		senderEmail, cleanRecipient,
		req.EnvelopeJSON, env,
		req.AttachmentEnvelopes,
	)
	if err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "database_insert_failed")
		return
	}

	deliveryIdentity := sha256.Sum256([]byte(req.EnvelopeJSON))

	// Already delivered (idempotent) — look up the original IDs and return them
	if messageID == "" {
		_ = tx.Rollback(ctx)
		// Read back the existing row so we can return matching message_id + message_seq.
		var existingMessageID string
		var existingMessageSeq int64
		_ = conn.QueryRow(ctx, `
			SELECT id::text, message_seq FROM message_metadata
			WHERE mailbox_id = $1 AND delivery_identity = $2
		`, recipientMailboxID, deliveryIdentity[:]).Scan(&existingMessageID, &existingMessageSeq)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(InternalSendResponse{
			DeliveryID: hex.EncodeToString(deliveryIdentity[:]),
			MessageID:  existingMessageID,
			Status:     "already_delivered",
			MessageSeq: existingMessageSeq,
		})
		return
	}

	finalFolder := "inbox"
	finalIsRead := false
	if messageID != "" {
		sizeBytes := int64(len(req.EnvelopeJSON))
		hasAttachments := len(req.AttachmentEnvelopes) > 0
		folderOverride, labelIDs, markRead, deleteMessage, ruleErr := EvaluateRules(
			ctx, tx, recipientMailboxID, senderEmail, []string{cleanRecipient}, sizeBytes, hasAttachments,
		)
		if ruleErr != nil {
			writeInternalSendError(w, http.StatusInternalServerError, "rule_evaluation_failed")
			return
		}
		if deleteMessage {
			finalFolder = "trash"
		} else if folderOverride != "" {
			finalFolder = folderOverride
		}
		if markRead {
			finalIsRead = true
		}
		if finalFolder != "inbox" || finalIsRead {
			if _, updateErr := tx.Exec(ctx, `
				UPDATE message_metadata
				SET folder = $1, is_read = $2
				WHERE id = $3
			`, finalFolder, finalIsRead, messageID); updateErr != nil {
				writeInternalSendError(w, http.StatusInternalServerError, "rule_update_failed")
				return
			}
		}
		for _, labelID := range labelIDs {
			if _, lErr := tx.Exec(ctx, `
				INSERT INTO message_labels (message_id, label_id)
				VALUES ($1, $2)
				ON CONFLICT DO NOTHING
			`, messageID, labelID); lErr != nil {
				writeInternalSendError(w, http.StatusInternalServerError, "rule_label_failed")
				return
			}
		}
	}

	if req.SenderEnvelopeJSON != "" {
		sentEnvelopes := req.SenderAttachmentEnvelopes

		senderMessageID, _, err := createSentMessageCopy(
			ctx, tx,
			req.SenderMailboxID, senderDomainID,
			senderEmail, cleanRecipient,
			[]byte(req.SenderEnvelopeJSON),
			int(senderEnv.KeyEpoch), int(senderEnv.V),
			"HPKE-XWing-AES256GCM-v1",
			hex.EncodeToString(deliveryIdentity[:]),
			sentEnvelopes,
		)
		if err != nil {
			writeInternalSendError(w, http.StatusInternalServerError, "sender_insert_failed")
			return
		}

		_ = senderMessageID // available if we want to return it later
	}

	// 16. Commit
	if err := tx.Commit(ctx); err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "transaction_commit_failed")
		return
	}

	unreadDelta := 1
	if finalIsRead || finalFolder == "trash" {
		unreadDelta = 0
	}
	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.created",
		MailboxID:   recipientMailboxID,
		Folder:      finalFolder,
		MessageID:   messageID,
		UnreadDelta: unreadDelta,
	})
	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.created",
		MailboxID:   req.SenderMailboxID,
		Folder:      "sent",
		MessageID:   messageID,
		UnreadDelta: 0,
	})

	// 17. Audit log
	auditLog(ctx, conn, senderOrgID, userID, "send_internal_message", "message", messageID, map[string]interface{}{
		"sender_mailbox_id":    req.SenderMailboxID,
		"recipient_mailbox_id": recipientMailboxID,
		"message_seq":          messageSeq,
		"storage_object_id":    fmt.Sprintf("mailboxes/%s/%020d.eml.enc", recipientMailboxID, messageSeq),
	})

	// 18. Return 201
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(InternalSendResponse{
		DeliveryID: hex.EncodeToString(deliveryIdentity[:]),
		MessageID:  messageID,
		Status:     "delivered",
		MessageSeq: messageSeq,
	})
}
