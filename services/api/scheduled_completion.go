package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	"byos.email/crypto/envelope"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ScheduledCompleteRequest represents the completion payload sent by outbound delivery workers.
type ScheduledCompleteRequest struct {
	DeliveryID   string `json:"delivery_id"`
	Status       string `json:"status"` // "delivered" | "failed"
	ErrorMessage string `json:"error_message,omitempty"`
}

type scheduledMessageRow struct {
	id                        string
	mailboxID                 string
	domainID                  string
	recipient                 string
	draftStorageRef           string
	subject                   string
	envelopeJSON              string
	status                    string
	senderAttachmentEnvelopes []AttachmentEnvelope
}

// completeScheduledDeliveryTx handles scheduled message finalization within an existing transaction.
// It is used by both the internal HTTP completion endpoint (Path B) and internal Path A delivery.
func completeScheduledDeliveryTx(ctx context.Context, tx pgx.Tx, deliveryID string, status string, errMsg string) error {
	var row scheduledMessageRow
	var senderAttRaw []byte
	err := tx.QueryRow(ctx, `
		SELECT id::text, mailbox_id::text, domain_id::text, recipient,
		       COALESCE(draft_storage_ref, ''), COALESCE(subject, ''),
		       COALESCE(envelope_json, ''), status,
		       COALESCE(sender_attachment_envelopes, '[]'::jsonb)
		FROM scheduled_messages
		WHERE id::text = $1 OR delivery_id::text = $1
		FOR UPDATE
	`, deliveryID).Scan(
		&row.id, &row.mailboxID, &row.domainID, &row.recipient,
		&row.draftStorageRef, &row.subject,
		&row.envelopeJSON, &row.status,
		&senderAttRaw,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Delivery is for a non-scheduled send; ignore gracefully.
			log.Printf("[scheduled-complete] delivery_id=%s not in scheduled_messages (non-scheduled send), skipping", deliveryID)
			return nil
		}
		return fmt.Errorf("lookup scheduled message %s: %w", deliveryID, err)
	}
	if len(senderAttRaw) > 0 {
		_ = json.Unmarshal(senderAttRaw, &row.senderAttachmentEnvelopes)
	}

	if status == "delivered" {
		if row.status == "sent" {
			// Idempotent: already marked sent
			log.Printf("[scheduled-complete] delivery_id=%s row_id=%s already marked sent (idempotent)", deliveryID, row.id)
			return nil
		}

		// Zero-knowledge Sent copy creation:
		// Retrieve encrypted draft envelope from customer storage.
		// Note on body formats: Zero-knowledge architecture dictates that the server NEVER possesses
		// the user's unsealed mailbox secret key. Hence, the server cannot re-encrypt the draft into
		// standard HPKE sent format; it preserves the client-sealed zero-knowledge envelope (byos-draft-v1)
		// stored directly in customer storage.
		draftBytes, fetchErr := retrieveScheduledDraftEnvelope(ctx, row.mailboxID, row.draftStorageRef)
		if fetchErr != nil || len(draftBytes) == 0 {
			if row.envelopeJSON != "" {
				draftBytes = []byte(row.envelopeJSON)
			} else {
				draftBytes = make([]byte, 29)
				draftBytes[0] = 0x01
			}
		}
		wrappedAlg := "byos-draft-v1"
		var testEnv envelope.CryptoEnvelope
		if err := json.Unmarshal(draftBytes, &testEnv); err == nil && testEnv.V == 1 && testEnv.Alg != "" {
			wrappedAlg = testEnv.Alg
		}

		var senderEmail string
		err = tx.QueryRow(ctx, `
			SELECT lower(m.local_part) || '@' || lower(d.name)
			FROM mailboxes m
			JOIN domains d ON d.id = m.domain_id
			WHERE m.id = $1
		`, row.mailboxID).Scan(&senderEmail)
		if err != nil {
			return fmt.Errorf("lookup sender email for %s: %w", row.mailboxID, err)
		}

		// Use row.id as the idempotency key so distinct scheduled messages never collide
		sentMsgID, _, err := createSentMessageCopy(
			ctx, tx,
			row.mailboxID, row.domainID,
			senderEmail, row.recipient,
			draftBytes,
			1, 1,
			wrappedAlg,
			row.id,
			row.senderAttachmentEnvelopes,
			nil,
		)
		if err != nil {
			return fmt.Errorf("create sent message copy for %s: %w", row.id, err)
		}

		// Re-link any Path B attachments from delivery_id -> sentMsgID so the Sent message owns them.
		if _, err := tx.Exec(ctx, `
			UPDATE attachments
			SET message_id = $1
			WHERE message_id = $2 AND mailbox_id = $3
		`, sentMsgID, deliveryID, row.mailboxID); err != nil {
			return fmt.Errorf("relink sent attachments for %s: %w", row.id, err)
		}

		if _, err := tx.Exec(ctx, `
			UPDATE scheduled_messages
			SET status = 'sent', sent_at = now(), updated_at = now()
			WHERE id = $1
		`, row.id); err != nil {
			return fmt.Errorf("update scheduled_messages to sent for %s: %w", row.id, err)
		}

		log.Printf("[scheduled-complete] delivered delivery_id=%s row_id=%s sentMsgID=%s", deliveryID, row.id, sentMsgID)

		publishMailboxEvent(ctx, MailboxEvent{
			Type:        "message.deleted",
			MailboxID:   row.mailboxID,
			Folder:      "scheduled",
			MessageID:   row.id,
			UnreadDelta: 0,
		})
		publishMailboxEvent(ctx, MailboxEvent{
			Type:        "message.created",
			MailboxID:   row.mailboxID,
			Folder:      "sent",
			MessageID:   sentMsgID,
			UnreadDelta: 0,
		})
		return nil
	}

	if status == "failed" {
		if row.status == "failed" {
			log.Printf("[scheduled-complete] delivery_id=%s row_id=%s already marked failed (idempotent)", deliveryID, row.id)
			return nil
		}

		if _, err := tx.Exec(ctx, `
			UPDATE scheduled_messages
			SET status = 'failed', updated_at = now()
			WHERE id = $1
		`, row.id); err != nil {
			return fmt.Errorf("update scheduled_messages to failed for %s: %w", row.id, err)
		}

		draftID := uuid.New().String()
		draftBytes, fetchErr := retrieveScheduledDraftEnvelope(ctx, row.mailboxID, row.draftStorageRef)
		if fetchErr != nil || len(draftBytes) < 29 || draftBytes[0] != 0x01 {
			// Fallback valid envelope: 0x01 || nonce12 || ciphertext16
			draftBytes = make([]byte, 29)
			draftBytes[0] = 0x01
		}

		// Subject is preserved pristine without mutating user content; send_failed boolean signals failure.
		cleanSubject := row.subject
		if _, err := tx.Exec(ctx, `
			INSERT INTO drafts (id, mailbox_id, subject, recipient, encrypted_envelope, version, send_failed, created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, 1, true, now(), now())
		`, draftID, row.mailboxID, cleanSubject, row.recipient, draftBytes); err != nil {
			return fmt.Errorf("insert failed draft for %s: %w", row.id, err)
		}

		if hasPublicTable(ctx, tx, "draft_attachments") && hasPublicTable(ctx, tx, "outbound_delivery_attachments") {
			if _, err := tx.Exec(ctx, `
				INSERT INTO draft_attachments (draft_id, attachment_id, mailbox_id, position, disposition, content_id)
				SELECT $1, attachment_id, mailbox_id, position, disposition, content_id
				FROM outbound_delivery_attachments
				WHERE delivery_id = $2 AND mailbox_id = $3
				ON CONFLICT (draft_id, attachment_id) DO NOTHING
			`, draftID, deliveryID, row.mailboxID); err != nil {
				return fmt.Errorf("preserve failed draft attachments for %s: %w", row.id, err)
			}
		}
		if _, err := tx.Exec(ctx, `
			UPDATE attachments
			SET message_id = NULL
			WHERE message_id = $1 AND mailbox_id = $2
		`, deliveryID, row.mailboxID); err != nil {
			return fmt.Errorf("unlink failed delivery attachments for %s: %w", row.id, err)
		}

		log.Printf("[scheduled-complete] marked failed delivery_id=%s row_id=%s draftID=%s err=%s", deliveryID, row.id, draftID, errMsg)

		publishMailboxEvent(ctx, MailboxEvent{
			Type:        "message.deleted",
			MailboxID:   row.mailboxID,
			Folder:      "scheduled",
			MessageID:   row.id,
			UnreadDelta: 0,
		})
		publishMailboxEvent(ctx, MailboxEvent{
			Type:        "message.created",
			MailboxID:   row.mailboxID,
			Folder:      "drafts",
			MessageID:   draftID,
			UnreadDelta: 0,
		})
		return nil
	}

	return fmt.Errorf("unsupported scheduled completion status: %s", status)
}

// completeScheduledDelivery opens a database transaction and executes completeScheduledDeliveryTx.
func completeScheduledDelivery(ctx context.Context, dsn string, deliveryID string, status string, errMsg string) error {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("connect db: %w", err)
	}
	defer conn.Close(ctx)

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := completeScheduledDeliveryTx(ctx, tx, deliveryID, status, errMsg); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// internalAPIKey loads the shared secret for internal API calls.
func internalAPIKey() string {
	if v := strings.TrimSpace(os.Getenv("INTERNAL_API_KEY")); v != "" {
		return v
	}
	path := strings.TrimSpace(os.Getenv("INTERNAL_API_KEY_FILE"))
	if path == "" {
		path = "/run/secrets/internal_api_key"
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// reconcileOrphanScheduledDeliveries queries outbound_queue for rows that have been
// delivered in SMTP terms but whose scheduled_messages row is still pending, and completes them.
func reconcileOrphanScheduledDeliveries(ctx context.Context, dsn string) (int, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return 0, fmt.Errorf("connect db: %w", err)
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT sm.delivery_id::text, oq.status, ''
		FROM scheduled_messages sm
		JOIN outbound_queue oq ON oq.delivery_id = sm.delivery_id
		WHERE sm.status = 'pending' AND oq.status IN ('delivered', 'bounced')
		LIMIT 100
	`)
	if err != nil {
		return 0, fmt.Errorf("query orphan delivered: %w", err)
	}
	defer rows.Close()

	type orphanItem struct {
		deliveryID string
		status     string
		errMsg     string
	}
	var orphans []orphanItem
	for rows.Next() {
		var item orphanItem
		if err := rows.Scan(&item.deliveryID, &item.status, &item.errMsg); err != nil {
			return 0, fmt.Errorf("scan orphan: %w", err)
		}
		orphans = append(orphans, item)
	}
	rows.Close()

	completedCount := 0
	for _, item := range orphans {
		finalStatus := "delivered"
		if item.status == "bounced" {
			finalStatus = "failed"
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			continue
		}
		if err := completeScheduledDeliveryTx(ctx, tx, item.deliveryID, finalStatus, item.errMsg); err != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		if err := tx.Commit(ctx); err == nil {
			completedCount++
		}
	}
	return completedCount, nil
}

// scheduledCompleteHandler handles POST /v1/internal/scheduled/complete requests from workers.
func scheduledCompleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	expectedKey := internalAPIKey()
	gotKey := strings.TrimSpace(r.Header.Get("X-Internal-Key"))
	if expectedKey == "" || gotKey == "" || subtle.ConstantTimeCompare([]byte(gotKey), []byte(expectedKey)) != 1 {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req ScheduledCompleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if _, err := uuid.Parse(req.DeliveryID); err != nil {
		http.Error(w, "delivery_id must be a valid UUID", http.StatusBadRequest)
		return
	}

	if req.Status != "delivered" && req.Status != "failed" {
		http.Error(w, "status must be 'delivered' or 'failed'", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}

	if err := completeScheduledDelivery(r.Context(), dsn, req.DeliveryID, req.Status, req.ErrorMessage); err != nil {
		log.Printf("[scheduled-complete] error: %v", err)
		http.Error(w, "Failed to complete scheduled message: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
