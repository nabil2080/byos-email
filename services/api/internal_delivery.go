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

type InternalSendRequest struct {
	EnvelopeJSON    string `json:"envelope_json"`
	Recipient       string `json:"recipient"`
	SenderMailboxID string `json:"sender_mailbox_id"`
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
	var senderLocalPart string
	var senderDomainName string
	var senderEd25519PK []byte
	err = conn.QueryRow(ctx, `
		SELECT m.org_id::text, m.local_part, d.name, m.mailbox_ed25519_pk
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE m.id = $1 AND m.user_id = $2 AND m.is_active = true
	`, req.SenderMailboxID, userID).Scan(&senderOrgID, &senderLocalPart, &senderDomainName, &senderEd25519PK)
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
	if err := envelope.VerifyEnvelopeSignature(senderEd25519PK, env); err != nil {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_signature")
		return
	}

	// 10. Transaction begins
	tx, err := conn.Begin(ctx)
	if err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "transaction_begin_failed")
		return
	}
	defer tx.Rollback(ctx)

	// 12. Compute delivery_identity = SHA256(envelope_json)
	deliveryIdentity := sha256.Sum256([]byte(req.EnvelopeJSON))

	// Check for existing row (idempotency check)
	var existingMessageID string
	var existingMessageSeq int64
	err = tx.QueryRow(ctx, `
		SELECT id::text, message_seq
		FROM message_metadata
		WHERE mailbox_id = $1 AND delivery_identity = $2
	`, recipientMailboxID, deliveryIdentity[:]).Scan(&existingMessageID, &existingMessageSeq)
	if err == nil {
		_ = tx.Rollback(ctx)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(InternalSendResponse{
			DeliveryID: hex.EncodeToString(deliveryIdentity[:]),
			MessageID:  existingMessageID,
			Status:     "already_delivered",
			MessageSeq: existingMessageSeq,
		})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		writeInternalSendError(w, http.StatusInternalServerError, "database_error")
		return
	}

	// 11. Allocate sequence
	var messageSeq int64
	if err := tx.QueryRow(ctx, "SELECT nextval('mailbox_message_seq')").Scan(&messageSeq); err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "sequence_allocation_failed")
		return
	}

	// 13. Build storage_object_id
	storageObjectID := fmt.Sprintf("mailboxes/%s/%020d.eml.enc", recipientMailboxID, messageSeq)

	// 14. POST to storage-worker /api/store
	if err := storeInternalEnvelope(ctx, recipientMailboxID, storageObjectID, messageSeq, []byte(req.EnvelopeJSON)); err != nil {
		writeInternalSendError(w, http.StatusBadGateway, "storage_failed")
		return
	}

	// 15. INSERT INTO message_metadata
	var messageID string
	err = tx.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, delivery_identity, sender, recipients,
			has_attachments, attachment_count, storage_object_id, content_key_hpke_wrapped,
			mailbox_sk_version, encryption_version, encryption_iv, aad_version, bundle_hash,
			status, wrapped_key_algorithm
		) VALUES (
			$1, $2, $3, 'received', $4, $5, $6,
			false, 0, $7, $8,
			$9, $10, $11, $12, $13,
			'received', $14
		) RETURNING id::text
	`,
		recipientMailboxID, recipientDomainID, messageSeq, deliveryIdentity[:], senderEmail, []string{cleanRecipient},
		storageObjectID, []byte{},
		int(env.KeyEpoch), int(env.V), []byte{}, 1, deliveryIdentity[:],
		"HPKE-XWing-AES256GCM-v1",
	).Scan(&messageID)
	if err != nil {
		_ = tx.Rollback(ctx)
		// Check for unique violation (concurrent insert of same delivery_identity)
		var dupID string
		var dupSeq int64
		if reErr := conn.QueryRow(ctx, `
			SELECT id::text, message_seq
			FROM message_metadata
			WHERE mailbox_id = $1 AND delivery_identity = $2
		`, recipientMailboxID, deliveryIdentity[:]).Scan(&dupID, &dupSeq); reErr == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(InternalSendResponse{
				DeliveryID: hex.EncodeToString(deliveryIdentity[:]),
				MessageID:  dupID,
				Status:     "already_delivered",
				MessageSeq: dupSeq,
			})
			return
		}
		writeInternalSendError(w, http.StatusInternalServerError, "database_insert_failed")
		return
	}

	// 16. Commit
	if err := tx.Commit(ctx); err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "transaction_commit_failed")
		return
	}

	// 17. Audit log
	auditLog(ctx, conn, senderOrgID, userID, "send_internal_message", "message", messageID, map[string]interface{}{
		"sender_mailbox_id":    req.SenderMailboxID,
		"recipient_mailbox_id": recipientMailboxID,
		"message_seq":          messageSeq,
		"storage_object_id":    storageObjectID,
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
