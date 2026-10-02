package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TestScheduledCompleteRequiresAuth verifies that calling /v1/internal/scheduled/complete
// without the X-Internal-Key returns 401 Unauthorized and does not modify the scheduled row.
func TestScheduledCompleteRequiresAuth(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	var senderDomainID string
	err = conn.QueryRow(ctx, `SELECT domain_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&senderDomainID)
	if err != nil {
		t.Fatalf("lookup sender domain: %v", err)
	}

	rowID := uuid.New().String()
	deliveryID := uuid.New().String()
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Minute)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'auth_test@example.com',
			decode('', 'hex'), $5, 'pending',
			$6, false, $7, 'Requires Auth Subject'
		)
	`, rowID, deliveryID, senderMailboxID, senderDomainID,
		scheduledAt, expiresAt, storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	t.Setenv("INTERNAL_API_KEY", "expected-secret-key-12345")

	reqBody := fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(reqBody))
	// No X-Internal-Key header provided
	rec := httptest.NewRecorder()
	scheduledCompleteHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", rec.Code)
	}

	// Verify row was NOT modified
	var status string
	err = conn.QueryRow(ctx, `SELECT status FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status)
	if err != nil {
		t.Fatalf("query status: %v", err)
	}
	if status != "pending" {
		t.Errorf("expected status to remain 'pending', got %q", status)
	}

	// Verify no message_metadata row written
	var count int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM message_metadata WHERE mailbox_id = $1`, senderMailboxID).Scan(&count)
	if err != nil {
		t.Fatalf("query count: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 message_metadata rows, got %d", count)
	}
}

// TestScheduledCompleteRejectsWrongKey verifies that calling /v1/internal/scheduled/complete
// with an incorrect X-Internal-Key returns 401 Unauthorized and does not modify the row.
func TestScheduledCompleteRejectsWrongKey(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	var senderDomainID string
	err = conn.QueryRow(ctx, `SELECT domain_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&senderDomainID)
	if err != nil {
		t.Fatalf("lookup sender domain: %v", err)
	}

	rowID := uuid.New().String()
	deliveryID := uuid.New().String()
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Minute)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'wrong_key@example.com',
			decode('', 'hex'), $5, 'pending',
			$6, false, $7, 'Wrong Key Subject'
		)
	`, rowID, deliveryID, senderMailboxID, senderDomainID,
		scheduledAt, expiresAt, storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	t.Setenv("INTERNAL_API_KEY", "correct-secret-key-12345")

	reqBody := fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(reqBody))
	req.Header.Set("X-Internal-Key", "wrong-secret-key-67890")
	rec := httptest.NewRecorder()
	scheduledCompleteHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong key, got %d", rec.Code)
	}

	var status string
	err = conn.QueryRow(ctx, `SELECT status FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status)
	if err != nil {
		t.Fatalf("query status: %v", err)
	}
	if status != "pending" {
		t.Errorf("expected status to remain 'pending', got %q", status)
	}
}

// TestScheduledCompleteAcceptsValidKey verifies that calling /v1/internal/scheduled/complete
// with the correct X-Internal-Key returns 200 OK and successfully completes the row.
func TestScheduledCompleteAcceptsValidKey(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	var senderDomainID string
	err = conn.QueryRow(ctx, `SELECT domain_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&senderDomainID)
	if err != nil {
		t.Fatalf("lookup sender domain: %v", err)
	}

	rowID := uuid.New().String()
	deliveryID := uuid.New().String()
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Minute)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'valid_key@example.com',
			decode('', 'hex'), $5, 'pending',
			$6, false, $7, 'Valid Key Subject'
		)
	`, rowID, deliveryID, senderMailboxID, senderDomainID,
		scheduledAt, expiresAt, storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	mockDraftBytes := make([]byte, 29)
	mockDraftBytes[0] = 0x01
	_ = storeScheduledDraftEnvelope(ctx, senderMailboxID, storageRef, mockDraftBytes)

	validKey := "valid-secret-key-xyz"
	t.Setenv("INTERNAL_API_KEY", validKey)

	reqBody := fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(reqBody))
	req.Header.Set("X-Internal-Key", validKey)
	rec := httptest.NewRecorder()
	scheduledCompleteHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid key, got %d: %s", rec.Code, rec.Body.String())
	}

	var status string
	var sentAt *time.Time
	err = conn.QueryRow(ctx, `SELECT status, sent_at FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status, &sentAt)
	if err != nil {
		t.Fatalf("query status: %v", err)
	}
	if status != "sent" || sentAt == nil {
		t.Errorf("expected status='sent' and non-nil sent_at, got status=%s, sent_at=%v", status, sentAt)
	}

	var count int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'`, senderMailboxID).Scan(&count)
	if err != nil {
		t.Fatalf("query sent count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 Sent message row, got %d", count)
	}
}

// TestScheduledReconciliationPicksUpOrphans verifies that reconcileOrphanScheduledDeliveries
// identifies scheduled messages marked 'pending' whose outbound_queue record is already 'delivered'
// and completes them (writing Sent copy and marking scheduled_messages 'sent').
func TestScheduledReconciliationPicksUpOrphans(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	var senderDomainID string
	err = conn.QueryRow(ctx, `SELECT domain_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&senderDomainID)
	if err != nil {
		t.Fatalf("lookup sender domain: %v", err)
	}

	rowID := uuid.New().String()
	deliveryID := uuid.New().String()
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-5 * time.Minute)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	// Insert pending scheduled message
	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'orphan_test@example.com',
			decode('', 'hex'), $5, 'pending',
			$6, false, $7, 'Orphan Reconciliation Subject'
		)
	`, rowID, deliveryID, senderMailboxID, senderDomainID,
		scheduledAt, expiresAt, storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	// Insert outbound_queue entry with status = 'delivered'
	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_queue (
			delivery_id, mailbox_id, domain_id, recipient,
			encrypted_message, send_token_hpke_wrapped, status,
			expires_at
		) VALUES (
			$1, $2, $3, 'orphan_test@example.com',
			decode('010203', 'hex'), decode('040506', 'hex'), 'delivered',
			$4
		)
	`, deliveryID, senderMailboxID, senderDomainID, expiresAt)
	if err != nil {
		t.Fatalf("insert outbound_queue: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM outbound_queue WHERE delivery_id = $1", deliveryID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	mockDraftBytes := make([]byte, 29)
	mockDraftBytes[0] = 0x01
	_ = storeScheduledDraftEnvelope(ctx, senderMailboxID, storageRef, mockDraftBytes)

	// Run reconciliation
	n, err := reconcileOrphanScheduledDeliveries(ctx, testDSN)
	if err != nil {
		t.Fatalf("reconcileOrphanScheduledDeliveries failed: %v", err)
	}
	if n < 1 {
		t.Fatalf("expected at least 1 orphan reconciled, got %d", n)
	}

	// Verify scheduled_messages status is now 'sent'
	var status string
	var sentAt *time.Time
	err = conn.QueryRow(ctx, `SELECT status, sent_at FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status, &sentAt)
	if err != nil {
		t.Fatalf("query status: %v", err)
	}
	if status != "sent" || sentAt == nil {
		t.Errorf("expected status='sent' and non-nil sent_at, got status=%s, sent_at=%v", status, sentAt)
	}

	// Verify Sent copy was written
	var count int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'`, senderMailboxID).Scan(&count)
	if err != nil {
		t.Fatalf("query sent count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 Sent message row after reconciliation, got %d", count)
	}
}

// TestScheduledPromoteIsIdempotent verifies that promoting a pending scheduled row into outbound_queue
// cannot insert duplicate rows even if promotion is attempted multiple times (e.g. on worker restarts).
func TestScheduledPromoteIsIdempotent(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	orgID, senderMailboxID, _, _, _ := setupInternalDeliveryTest(t, db, vec)
	_ = orgID

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	var senderDomainID string
	err = conn.QueryRow(ctx, `SELECT domain_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&senderDomainID)
	if err != nil {
		t.Fatalf("lookup sender domain: %v", err)
	}

	var userID string
	err = conn.QueryRow(ctx, `SELECT user_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&userID)
	if err != nil {
		t.Fatalf("lookup user_id: %v", err)
	}

	reservationID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_reservations (
			reservation_id, user_id, mailbox_id, outbox_seq,
			encryption_version, aad_version, status, expires_at
		) VALUES ($1, $2, $3, 1, 1, 1, 'reserved', now() + interval '1 hour')
	`, reservationID, userID, senderMailboxID)
	if err != nil {
		t.Fatalf("insert reservation: %v", err)
	}

	rowID := uuid.New().String()
	deliveryID := uuid.New().String()
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Minute)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	dummyEnc := []byte{1, 2, 3, 4, 5}
	dummyWrapped := []byte{6, 7, 8, 9, 10}
	dummyIV := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, draft_storage_ref, subject,
			encrypted_message, send_token_hpke_wrapped, outbox_seq,
			encryption_version, aad_version, encryption_iv, reservation_id
		) VALUES (
			$1, $2, $3, $4, 'idempotent_promote@example.com',
			decode('', 'hex'), $5, 'pending',
			$6, false, $7, 'Promote Idempotent Subject',
			$8, $9, 1,
			1, 1, $10, $11
		)
	`, rowID, deliveryID, senderMailboxID, senderDomainID,
		scheduledAt, expiresAt, storageRef,
		dummyEnc, dummyWrapped, dummyIV, reservationID,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM outbound_queue WHERE delivery_id = $1", deliveryID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM outbound_reservations WHERE reservation_id = $1", reservationID)
	})

	// Promote function simulating poll_scheduled
	promoteQuery := func() (int64, error) {
		// 1. SELECT pending where NOT EXISTS in outbound_queue
		var foundID string
		err := conn.QueryRow(ctx, `
			SELECT sm.delivery_id::text
			FROM scheduled_messages sm
			WHERE sm.id = $1
			  AND sm.status = 'pending'
			  AND sm.is_path_a = false
			  AND sm.scheduled_at <= now()
			  AND sm.expires_at > now()
			  AND NOT EXISTS (SELECT 1 FROM outbound_queue oq WHERE oq.delivery_id = sm.delivery_id)
		`, rowID).Scan(&foundID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return 0, nil
			}
			return 0, err
		}

		// 2. INSERT ON CONFLICT DO NOTHING
		ct, err := conn.Exec(ctx, `
			INSERT INTO outbound_queue (
				delivery_id, mailbox_id, domain_id, recipient,
				encrypted_message, send_token_hpke_wrapped, outbox_seq,
				encryption_version, aad_version, encryption_iv, reservation_id,
				status, next_attempt_at, expires_at
			) VALUES (
				$1, $2, $3, 'idempotent_promote@example.com',
				$4, $5, 1,
				1, 1, $6, $7,
				'pending', now(), now() + interval '7 days'
			)
			ON CONFLICT (delivery_id) DO NOTHING
		`, deliveryID, senderMailboxID, senderDomainID, dummyEnc, dummyWrapped, dummyIV, reservationID)
		if err != nil {
			return 0, err
		}
		return ct.RowsAffected(), nil
	}

	// First promotion run: should insert exactly 1 row
	rows1, err := promoteQuery()
	if err != nil {
		t.Fatalf("promote 1 error: %v", err)
	}
	if rows1 != 1 {
		t.Fatalf("expected 1 row inserted on first promote, got %d", rows1)
	}

	// Second promotion run (e.g., worker restart before SMTP delivery):
	// NOT EXISTS filter prevents re-selection; ON CONFLICT DO NOTHING prevents duplicate insert
	rows2, err := promoteQuery()
	if err != nil {
		t.Fatalf("promote 2 error: %v", err)
	}
	if rows2 != 0 {
		t.Fatalf("expected 0 rows inserted on duplicate promote, got %d", rows2)
	}

	// Direct INSERT ON CONFLICT DO NOTHING bypass test:
	ct, err := conn.Exec(ctx, `
		INSERT INTO outbound_queue (
			delivery_id, mailbox_id, domain_id, recipient,
			encrypted_message, send_token_hpke_wrapped, outbox_seq,
			encryption_version, aad_version, encryption_iv, reservation_id,
			status, next_attempt_at, expires_at
		) VALUES (
			$1, $2, $3, 'idempotent_promote@example.com',
			$4, $5, 1,
			1, 1, $6, $7,
			'pending', now(), now() + interval '7 days'
		)
		ON CONFLICT (delivery_id) DO NOTHING
	`, deliveryID, senderMailboxID, senderDomainID, dummyEnc, dummyWrapped, dummyIV, reservationID)
	if err != nil {
		t.Fatalf("direct insert failed: %v", err)
	}
	if ct.RowsAffected() != 0 {
		t.Fatalf("expected ON CONFLICT DO NOTHING to insert 0 rows, got %d", ct.RowsAffected())
	}

	// Assert exactly 1 outbound_queue row exists
	var count int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM outbound_queue WHERE delivery_id = $1`, deliveryID).Scan(&count)
	if err != nil {
		t.Fatalf("query count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 outbound_queue row, got %d", count)
	}
}
