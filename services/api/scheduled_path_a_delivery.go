package main

// scheduled_path_a_delivery.go
//
// Polls scheduled_messages for Path A rows (is_path_a = true) whose
// scheduled_at has arrived, and delivers them via deliverEnvelopeToMailbox —
// the same logic used by internalSendHandler — without any decryption.
//
// Uses FOR UPDATE SKIP LOCKED to safely coexist with any other poller
// (including the Rust outbound-worker, which now skips is_path_a=true rows).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"byos.email/crypto/envelope"
	"github.com/jackc/pgx/v5"
)

// startScheduledPathADelivery runs processPathAScheduled every 5 seconds.
// It is launched from main() and runs until ctx is cancelled.
func startScheduledPathADelivery(ctx context.Context, dsn string) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	log.Printf("[scheduled-path-a] goroutine started")
	for {
		select {
		case <-ctx.Done():
			log.Printf("[scheduled-path-a] goroutine stopping")
			return
		case <-ticker.C:
			if err := processPathAScheduled(ctx, dsn); err != nil {
				log.Printf("[scheduled-path-a] error: %v", err)
			}
		}
	}
}

type pathAScheduledRow struct {
	id                        string
	deliveryID                string
	mailboxID                 string
	recipient                 string
	envelopeJSON              string
	draftStorageRef           string
	subject                   string
	attachmentEnvelopes       []AttachmentEnvelope
	senderAttachmentEnvelopes []AttachmentEnvelope
}

// processPathAScheduled fetches up to 10 due Path A rows, delivers each one,
// and marks status='sent' on success (writing a copy to Sent folder) or status='failed' on error (moving to Drafts).
func processPathAScheduled(ctx context.Context, dsn string) error {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("db connect: %w", err)
	}
	defer conn.Close(ctx)

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id::text, delivery_id::text, mailbox_id::text, recipient, COALESCE(envelope_json, ''),
		       COALESCE(draft_storage_ref, ''), COALESCE(subject, ''),
		       COALESCE(attachment_envelopes, '[]'::jsonb),
		       COALESCE(sender_attachment_envelopes, '[]'::jsonb)
		FROM scheduled_messages
		WHERE status = 'pending'
		  AND is_path_a = true
		  AND scheduled_at <= now()
		  AND expires_at > now()
		ORDER BY scheduled_at ASC
		LIMIT 10
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return fmt.Errorf("query scheduled: %w", err)
	}

	var batch []pathAScheduledRow
	for rows.Next() {
		var r pathAScheduledRow
		var attRaw, senderAttRaw []byte
		if err := rows.Scan(&r.id, &r.deliveryID, &r.mailboxID, &r.recipient, &r.envelopeJSON, &r.draftStorageRef, &r.subject, &attRaw, &senderAttRaw); err != nil {
			rows.Close()
			return fmt.Errorf("scan row: %w", err)
		}
		if len(attRaw) > 0 {
			_ = json.Unmarshal(attRaw, &r.attachmentEnvelopes)
		}
		if len(senderAttRaw) > 0 {
			_ = json.Unmarshal(senderAttRaw, &r.senderAttachmentEnvelopes)
		}
		batch = append(batch, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("rows error: %w", err)
	}

	if len(batch) == 0 {
		// Opportunistically expire Path A rows past their window
		if _, err := tx.Exec(ctx, "UPDATE scheduled_messages SET status='expired', updated_at=now() WHERE status='pending' AND is_path_a = true AND expires_at <= now()"); err != nil {
			log.Printf("[scheduled-path-a] failed to expire rows: %v", err)
			return err
		}
		return tx.Commit(ctx)
	}

	log.Printf("[scheduled-path-a] processing %d rows", len(batch))

	for _, r := range batch {
		err := deliverPathARow(ctx, conn, tx, r)
		targetID := r.deliveryID
		if targetID == "" {
			targetID = r.id
		}
		if err != nil {
			log.Printf("[scheduled-path-a] delivery failed id=%s: %v", r.id, err)
			if compErr := completeScheduledDeliveryTx(ctx, tx, targetID, "failed", err.Error()); compErr != nil {
				log.Printf("[scheduled-path-a] failed to mark failure for %s: %v", r.id, compErr)
				return compErr
			}
		} else {
			if compErr := completeScheduledDeliveryTx(ctx, tx, targetID, "delivered", ""); compErr != nil {
				log.Printf("[scheduled-path-a] failed to mark delivery for %s: %v", r.id, compErr)
				return compErr
			}
		}
	}

	return tx.Commit(ctx)
}

// deliverPathARow resolves the sender + recipient from the database and calls
// deliverEnvelopeToMailbox within the existing transaction.
func deliverPathARow(ctx context.Context, conn *pgx.Conn, tx pgx.Tx, r pathAScheduledRow) error {
	if r.envelopeJSON == "" {
		return fmt.Errorf("envelope_json is empty")
	}

	// 1. Parse + validate envelope
	env, err := envelope.UnmarshalCanonical([]byte(r.envelopeJSON))
	if err != nil {
		return fmt.Errorf("unmarshal envelope: %w", err)
	}
	if env.V != 1 || env.Alg != "HPKE-XWing-AES256GCM-v1" {
		return fmt.Errorf("unsupported envelope v=%d alg=%s", env.V, env.Alg)
	}
	if env.KeyEpoch == 0 {
		return fmt.Errorf("invalid_key_epoch")
	}

	// 2. Look up sender mailbox (from scheduled_messages.mailbox_id)
	var senderLocalPart, senderDomainName, senderEd25519PKHex, senderDomainID string
	err = conn.QueryRow(ctx, `
		SELECT m.local_part, d.name, encode(m.mailbox_ed25519_pk, 'hex'), d.id::text
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE m.id = $1 AND m.is_active = true
	`, r.mailboxID).Scan(&senderLocalPart, &senderDomainName, &senderEd25519PKHex, &senderDomainID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("sender mailbox not found")
		}
		return fmt.Errorf("sender lookup: %w", err)
	}
	senderEmail := strings.ToLower(senderLocalPart) + "@" + strings.ToLower(senderDomainName)

	// 3. Verify sender signature (re-verify at delivery time)
	senderEd25519PK, err := hexToBytes(senderEd25519PKHex)
	if err != nil {
		return fmt.Errorf("decode sender pk: %w", err)
	}
	if len(senderEd25519PK) == 0 {
		return fmt.Errorf("sender has no signing key")
	}
	if err := envelope.VerifyEnvelopeSignature(senderEd25519PK, env); err != nil {
		return fmt.Errorf("signature verification failed: %w", err)
	}

	// 4. Look up recipient mailbox (key_id in envelope == recipient mailbox UUID)
	recipientMailboxID := env.KeyID
	var recipientDomainID, recipientEmail string
	var recipientXWingPK []byte
	err = conn.QueryRow(ctx, `
		SELECT m.mailbox_xwing_pk, d.id::text, lower(m.local_part) || '@' || lower(d.name)
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE m.id = $1 AND m.is_active = true AND m.key_status = 'active'
	`, recipientMailboxID).Scan(&recipientXWingPK, &recipientDomainID, &recipientEmail)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("recipient mailbox not found: %s", recipientMailboxID)
		}
		return fmt.Errorf("recipient lookup: %w", err)
	}
	if len(recipientXWingPK) == 0 {
		return fmt.Errorf("recipient has no X-Wing key")
	}

	// 5. Deliver envelope to recipient mailbox
	messageID, _, err := deliverEnvelopeToMailbox(
		ctx, conn, tx,
		recipientMailboxID, recipientDomainID,
		senderEmail, recipientEmail,
		r.envelopeJSON, env,
		r.attachmentEnvelopes,
	)
	if err != nil {
		return fmt.Errorf("deliver to mailbox: %w", err)
	}
	if messageID == "" {
		// Already delivered (idempotent)
		log.Printf("[scheduled-path-a] id=%s already delivered (idempotent)", r.id)
		return nil
	}

	// 6. Evaluate rules on scheduled delivery
	sizeBytes := int64(len(r.envelopeJSON))
	hasAttachments := len(r.attachmentEnvelopes) > 0
	folderOverride, labelIDs, markRead, deleteMessage, ruleErr := EvaluateRules(
		ctx, tx, recipientMailboxID, senderEmail, []string{recipientEmail}, sizeBytes, hasAttachments,
	)
	if ruleErr != nil {
		return fmt.Errorf("evaluate rules: %w", ruleErr)
	}
	finalFolder := "inbox"
	if deleteMessage {
		finalFolder = "trash"
	} else if folderOverride != "" {
		finalFolder = folderOverride
	}
	if finalFolder != "inbox" || markRead {
		if _, updateErr := tx.Exec(ctx, `
			UPDATE message_metadata
			SET folder = $1, is_read = $2
			WHERE id = $3
		`, finalFolder, markRead, messageID); updateErr != nil {
			return fmt.Errorf("rule update: %w", updateErr)
		}
	}
	for _, labelID := range labelIDs {
		if _, lErr := tx.Exec(ctx, `
			INSERT INTO message_labels (message_id, label_id)
			VALUES ($1, $2)
			ON CONFLICT DO NOTHING
		`, messageID, labelID); lErr != nil {
			return fmt.Errorf("rule label: %w", lErr)
		}
	}
	return nil
}


// hexToBytes converts a hex-encoded string (from PostgreSQL encode(col,'hex'))
// to a byte slice.
func hexToBytes(s string) ([]byte, error) {
	if s == "" {
		return []byte{}, nil
	}
	n := len(s)
	if n%2 != 0 {
		return nil, fmt.Errorf("odd-length hex string")
	}
	b := make([]byte, n/2)
	for i := 0; i < n/2; i++ {
		hi, err := hexNibble(s[2*i])
		if err != nil {
			return nil, err
		}
		lo, err := hexNibble(s[2*i+1])
		if err != nil {
			return nil, err
		}
		b[i] = (hi << 4) | lo
	}
	return b, nil
}

func hexNibble(c byte) (byte, error) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', nil
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, nil
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10, nil
	default:
		return 0, fmt.Errorf("invalid hex char %q", c)
	}
}
