package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TestScheduledSendCreatesSentCopy verifies that when a scheduled message is delivered,
// a copy is written to the sender's Sent folder in message_metadata.
func TestScheduledSendCreatesSentCopy(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
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
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Second)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, envelope_json,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4,
			decode('', 'hex'), $5, 'pending',
			$6, true, $7,
			$8, 'Meeting at 3'
		)
	`, rowID, senderMailboxID, senderDomainID, recipientEmail,
		scheduledAt, expiresAt, vec.EnvelopeJSON,
		storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	// Process due scheduled messages
	if err := processPathAScheduled(ctx, testDSN); err != nil {
		t.Fatalf("processPathAScheduled: %v", err)
	}

	// Verify sent copy exists for sender
	var sentCount int
	var sentFolder string
	var sentDirection string
	var sentStorageID string
	err = conn.QueryRow(ctx, `
		SELECT count(*), folder, direction, storage_object_id
		FROM message_metadata
		WHERE mailbox_id = $1 AND folder = 'sent'
		GROUP BY folder, direction, storage_object_id
	`, senderMailboxID).Scan(&sentCount, &sentFolder, &sentDirection, &sentStorageID)
	if err != nil {
		t.Fatalf("failed to query sent copy: %v", err)
	}
	if sentCount != 1 {
		t.Errorf("expected 1 sent copy for sender, got %d", sentCount)
	}
	if sentFolder != "sent" || sentDirection != "sent" {
		t.Errorf("expected folder=sent, direction=sent; got folder=%s, direction=%s", sentFolder, sentDirection)
	}
	if sentStorageID == "" || !strings.HasPrefix(sentStorageID, "mailboxes/") {
		t.Errorf("expected sent copy on customer storage prefix mailboxes/, got %s", sentStorageID)
	}
}

// TestScheduledSendUpdatesStatusToSent verifies that scheduled_messages.status
// is updated to 'sent' (NOT 'executed'), with sent_at and updated_at populated.
func TestScheduledSendUpdatesStatusToSent(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
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
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Second)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, envelope_json,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4,
			decode('', 'hex'), $5, 'pending',
			$6, true, $7,
			$8, 'Project Roadmap'
		)
	`, rowID, senderMailboxID, senderDomainID, recipientEmail,
		scheduledAt, expiresAt, vec.EnvelopeJSON,
		storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	if err := processPathAScheduled(ctx, testDSN); err != nil {
		t.Fatalf("processPathAScheduled: %v", err)
	}

	var status string
	var sentAt *time.Time
	var updatedAt *time.Time
	err = conn.QueryRow(ctx, `
		SELECT status, sent_at, updated_at
		FROM scheduled_messages
		WHERE id = $1
	`, rowID).Scan(&status, &sentAt, &updatedAt)
	if err != nil {
		t.Fatalf("query scheduled_messages: %v", err)
	}

	if status != "sent" {
		t.Errorf("expected status='sent', got %q", status)
	}
	if sentAt == nil {
		t.Errorf("expected non-nil sent_at timestamp")
	}
	if updatedAt == nil {
		t.Errorf("expected non-nil updated_at timestamp")
	}
}

// TestScheduledSendFailureMovesToDrafts verifies that upon delivery failure,
// the row status becomes 'failed', moves to Drafts with '[Send Failed]' subject,
// and does NOT appear in Sent.
func TestScheduledSendFailureMovesToDrafts(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
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
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Second)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	// Provide an invalid envelope that will fail signature verification / unmarshal
	invalidEnvelopeJSON := `{"v":1,"alg":"invalid-alg","key_id":"none"}`

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, envelope_json,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4,
			decode('', 'hex'), $5, 'pending',
			$6, true, $7,
			$8, 'Quarterly Earnings'
		)
	`, rowID, senderMailboxID, senderDomainID, recipientEmail,
		scheduledAt, expiresAt, invalidEnvelopeJSON,
		storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM drafts WHERE mailbox_id = $1", senderMailboxID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	// Process due scheduled messages
	_ = processPathAScheduled(ctx, testDSN)

	// Check status is 'failed'
	var status string
	err = conn.QueryRow(ctx, `SELECT status FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status)
	if err != nil {
		t.Fatalf("query status: %v", err)
	}
	if status != "failed" {
		t.Errorf("expected status='failed', got %q", status)
	}

	// Check draft exists with send_failed = true and pristine subject
	var draftSubject string
	var sendFailed bool
	err = conn.QueryRow(ctx, `
		SELECT subject, send_failed FROM drafts WHERE mailbox_id = $1 ORDER BY created_at DESC LIMIT 1
	`, senderMailboxID).Scan(&draftSubject, &sendFailed)
	if err != nil {
		t.Fatalf("query drafts for failed scheduled send: %v", err)
	}
	if draftSubject != "Quarterly Earnings" {
		t.Errorf("expected draft subject to remain 'Quarterly Earnings', got %q", draftSubject)
	}
	if !sendFailed {
		t.Errorf("expected send_failed to be true on failed draft")
	}

	// Verify message does NOT appear in Sent folder
	var sentCount int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'
	`, senderMailboxID).Scan(&sentCount)
	if err != nil {
		t.Fatalf("query sent folder: %v", err)
	}
	if sentCount != 0 {
		t.Errorf("expected 0 messages in Sent folder on failure, got %d", sentCount)
	}
}

// TestScheduledSendIsIdempotent verifies that if processPathAScheduled runs multiple times,
// it does not duplicate Sent folder rows or recipient messages.
func TestScheduledSendIsIdempotent(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
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
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Second)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, envelope_json,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4,
			decode('', 'hex'), $5, 'pending',
			$6, true, $7,
			$8, 'Idempotency Check'
		)
	`, rowID, senderMailboxID, senderDomainID, recipientEmail,
		scheduledAt, expiresAt, vec.EnvelopeJSON,
		storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	// Run 1st time
	if err := processPathAScheduled(ctx, testDSN); err != nil {
		t.Fatalf("processPathAScheduled run 1: %v", err)
	}

	// Run 2nd time
	if err := processPathAScheduled(ctx, testDSN); err != nil {
		t.Fatalf("processPathAScheduled run 2: %v", err)
	}

	var sentCount int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'
	`, senderMailboxID).Scan(&sentCount)
	if err != nil {
		t.Fatalf("query sentCount: %v", err)
	}
	if sentCount != 1 {
		t.Errorf("idempotency violated: expected 1 sent copy, got %d", sentCount)
	}

	var recipientCount int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_metadata WHERE mailbox_id = $1
	`, recipientMailboxID).Scan(&recipientCount)
	if err != nil {
		t.Fatalf("query recipientCount: %v", err)
	}
	if recipientCount != 1 {
		t.Errorf("idempotency violated: expected 1 recipient message, got %d", recipientCount)
	}
}

// TestScheduledFolderExcludesSentAndFailed verifies that folder=scheduled returns ONLY status='pending'
func TestScheduledFolderExcludesSentAndFailed(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID
	_ = domainID

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	idPending := uuid.New().String()
	idSent := uuid.New().String()
	idFailed := uuid.New().String()
	futureTime := time.Now().Add(2 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (id, mailbox_id, domain_id, recipient, scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json, draft_storage_ref)
		VALUES ($1, $2, $3, 'pending@test.local', $4, 'pending', $5, true, decode('', 'hex'), '{"v":1}', $6)
	`, idPending, mailboxID, domainID, futureTime, futureTime.Add(24*time.Hour), fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, idPending))
	if err != nil {
		t.Fatalf("insert pending: %v", err)
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (id, mailbox_id, domain_id, recipient, scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json, draft_storage_ref)
		VALUES ($1, $2, $3, 'sent@test.local', $4, 'sent', $5, true, decode('', 'hex'), '{"v":1}', $6)
	`, idSent, mailboxID, domainID, futureTime, futureTime.Add(24*time.Hour), fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, idSent))
	if err != nil {
		t.Fatalf("insert sent: %v", err)
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (id, mailbox_id, domain_id, recipient, scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json, draft_storage_ref)
		VALUES ($1, $2, $3, 'failed@test.local', $4, 'failed', $5, true, decode('', 'hex'), '{"v":1}', $6)
	`, idFailed, mailboxID, domainID, futureTime, futureTime.Add(24*time.Hour), fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, idFailed))
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	req := httptest.NewRequest("GET", fmt.Sprintf("/v1/mailboxes/%s/messages?folder=scheduled", mailboxID), nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	messagesHandler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	var res struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(res.Messages) != 1 {
		t.Fatalf("expected exactly 1 message in scheduled folder, got %d", len(res.Messages))
	}
	if res.Messages[0].ID != idPending {
		t.Errorf("expected pending message id %s, got %s", idPending, res.Messages[0].ID)
	}
}

// TestScheduledSendEmitsEvents verifies that real-time events are triggered on delivery
func TestScheduledSendEmitsEvents(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
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
	storageRef := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, rowID)
	scheduledAt := time.Now().Add(-1 * time.Second)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a, envelope_json,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4,
			decode('', 'hex'), $5, 'pending',
			$6, true, $7,
			$8, 'Event Verification'
		)
	`, rowID, senderMailboxID, senderDomainID, recipientEmail,
		scheduledAt, expiresAt, vec.EnvelopeJSON,
		storageRef,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	// Process due scheduled messages
	if err := processPathAScheduled(ctx, testDSN); err != nil {
		t.Fatalf("processPathAScheduled: %v", err)
	}

	// Verify status is updated to 'sent'
	var status string
	err = conn.QueryRow(ctx, `SELECT status FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status)
	if err != nil {
		t.Fatalf("query status: %v", err)
	}
	if status != "sent" {
		t.Errorf("expected status 'sent', got %q", status)
	}
}

// TestScheduledSendPathBCreatesSentCopy verifies that when a Path B (external SMTP)
// scheduled message completes delivery via /v1/internal/scheduled/complete,
// a copy is written to the sender's Sent folder in message_metadata.
func TestScheduledSendPathBCreatesSentCopy(t *testing.T) {
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
	externalRecipient := "test-user@gmail.com"

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, $5,
			decode('', 'hex'), $6, 'pending',
			$7, false,
			$8, 'External Financial Report'
		)
	`, rowID, deliveryID, senderMailboxID, senderDomainID, externalRecipient,
		scheduledAt, expiresAt,
		storageRef,
	)
	if err != nil {
		t.Fatalf("insert path b scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	mockDraftBytes := make([]byte, 29)
	mockDraftBytes[0] = 0x01
	_ = storeScheduledDraftEnvelope(ctx, senderMailboxID, storageRef, mockDraftBytes)

	t.Setenv("INTERNAL_API_KEY", "test-internal-scheduled-key")

	// Call internal completion handler
	reqBody := fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(reqBody))
	req.Header.Set("X-Internal-Key", "test-internal-scheduled-key")
	rec := httptest.NewRecorder()
	scheduledCompleteHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from scheduledCompleteHandler, got %d: %s", rec.Code, rec.Body.String())
	}

	// Verify scheduled_messages status is 'sent'
	var status string
	var sentAt *time.Time
	err = conn.QueryRow(ctx, `SELECT status, sent_at FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status, &sentAt)
	if err != nil {
		t.Fatalf("query scheduled_messages: %v", err)
	}
	if status != "sent" || sentAt == nil {
		t.Errorf("expected status='sent' with non-nil sent_at, got status=%s, sent_at=%v", status, sentAt)
	}

	// Verify message_metadata Sent folder row exists
	var sentCount int
	var sentFolder, sentDirection, sentStorageID string
	err = conn.QueryRow(ctx, `
		SELECT count(*), folder, direction, storage_object_id
		FROM message_metadata
		WHERE mailbox_id = $1 AND folder = 'sent'
		GROUP BY folder, direction, storage_object_id
	`, senderMailboxID).Scan(&sentCount, &sentFolder, &sentDirection, &sentStorageID)
	if err != nil {
		t.Fatalf("failed to query sent copy: %v", err)
	}
	if sentCount != 1 {
		t.Errorf("expected 1 sent copy in Sent folder for sender, got %d", sentCount)
	}
	if sentFolder != "sent" || sentDirection != "sent" {
		t.Errorf("expected folder=sent, direction=sent; got %s, %s", sentFolder, sentDirection)
	}
	if !strings.HasPrefix(sentStorageID, "mailboxes/") {
		t.Errorf("expected storage_object_id to start with mailboxes/, got %s", sentStorageID)
	}
}

// TestScheduledSendPathBEmitsEvents verifies that completing Path B delivery
// succeeds and updates the row to sent.
func TestScheduledSendPathBEmitsEvents(t *testing.T) {
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
			expires_at, is_path_a,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'partner@corporate.org',
			decode('', 'hex'), $5, 'pending',
			$6, false,
			$7, 'Event Emission Test'
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

	t.Setenv("INTERNAL_API_KEY", "test-internal-scheduled-key")

	reqBody := fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(reqBody))
	req.Header.Set("X-Internal-Key", "test-internal-scheduled-key")
	rec := httptest.NewRecorder()
	scheduledCompleteHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
}

// TestScheduledSendIdempotencyByRowID verifies that scheduling two identical messages
// (same recipient, subject, envelope bytes) produces two distinct Sent entries because
// idempotency is keyed on scheduled message row ID, not content hash.
func TestScheduledSendIdempotencyByRowID(t *testing.T) {
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

	rowID1 := uuid.New().String()
	deliveryID1 := uuid.New().String()
	rowID2 := uuid.New().String()
	deliveryID2 := uuid.New().String()
	sharedStorageRef := fmt.Sprintf("mailboxes/%s/scheduled/shared.draft.enc", senderMailboxID)
	scheduledAt := time.Now().Add(-1 * time.Minute)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	recipient := "client@example.com"
	subject := "Weekly Update"

	for _, item := range []struct {
		id  string
		did string
	}{
		{rowID1, deliveryID1},
		{rowID2, deliveryID2},
	} {
		_, err = conn.Exec(ctx, `
			INSERT INTO scheduled_messages (
				id, delivery_id, mailbox_id, domain_id, recipient,
				send_token_hash, scheduled_at, status,
				expires_at, is_path_a,
				draft_storage_ref, subject
			) VALUES (
				$1, $2, $3, $4, $5,
				decode('', 'hex'), $6, 'pending',
				$7, false,
				$8, $9
			)
		`, item.id, item.did, senderMailboxID, senderDomainID, recipient,
			scheduledAt, expiresAt, sharedStorageRef, subject,
		)
		if err != nil {
			t.Fatalf("insert scheduled message %s: %v", item.id, err)
		}
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id IN ($1, $2)", rowID1, rowID2)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	mockDraftBytes := make([]byte, 29)
	mockDraftBytes[0] = 0x01
	_ = storeScheduledDraftEnvelope(ctx, senderMailboxID, sharedStorageRef, mockDraftBytes)

	t.Setenv("INTERNAL_API_KEY", "test-internal-scheduled-key")

	// Deliver message 1
	req1 := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID1)))
	req1.Header.Set("X-Internal-Key", "test-internal-scheduled-key")
	rec1 := httptest.NewRecorder()
	scheduledCompleteHandler(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("deliver 1 failed: %d: %s", rec1.Code, rec1.Body.String())
	}

	// Deliver message 2 (identical content and recipient)
	req2 := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID2)))
	req2.Header.Set("X-Internal-Key", "test-internal-scheduled-key")
	rec2 := httptest.NewRecorder()
	scheduledCompleteHandler(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("deliver 2 failed: %d: %s", rec2.Code, rec2.Body.String())
	}

	// Verify BOTH messages produced distinct entries in Sent folder
	var totalSent int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'
	`, senderMailboxID).Scan(&totalSent)
	if err != nil {
		t.Fatalf("query sent count: %v", err)
	}
	if totalSent != 2 {
		t.Errorf("expected 2 distinct Sent messages for 2 identical scheduled sends, got %d", totalSent)
	}

	// Retry delivery for message 1: must be idempotent and still result in exactly 2 sent entries
	req1Retry := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(fmt.Sprintf(`{"delivery_id":"%s","status":"delivered"}`, deliveryID1)))
	req1Retry.Header.Set("X-Internal-Key", "test-internal-scheduled-key")
	rec1Retry := httptest.NewRecorder()
	scheduledCompleteHandler(rec1Retry, req1Retry)
	if rec1Retry.Code != http.StatusOK {
		t.Fatalf("retry failed: %d", rec1Retry.Code)
	}

	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'
	`, senderMailboxID).Scan(&totalSent)
	if err != nil {
		t.Fatalf("query sent count after retry: %v", err)
	}
	if totalSent != 2 {
		t.Errorf("idempotency violated: expected 2 Sent messages after retry, got %d", totalSent)
	}
}

// TestScheduledSendFailureDoesNotMutateSubject verifies that when a scheduled message fails,
// the draft created preserves the original subject without mutating it with prefixes like '[Send Failed]'.
func TestScheduledSendFailureDoesNotMutateSubject(t *testing.T) {
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
	originalSubject := "Pristine User Subject Line"

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient,
			send_token_hash, scheduled_at, status,
			expires_at, is_path_a,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'external@fail.test',
			decode('', 'hex'), $5, 'pending',
			$6, false,
			$7, $8
		)
	`, rowID, deliveryID, senderMailboxID, senderDomainID,
		scheduledAt, expiresAt, storageRef, originalSubject,
	)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM drafts WHERE mailbox_id = $1", senderMailboxID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1 OR mailbox_id = $2", senderMailboxID, recipientMailboxID)
	})

	// Complete with failure
	t.Setenv("INTERNAL_API_KEY", "test-internal-scheduled-key")
	reqBody := fmt.Sprintf(`{"delivery_id":"%s","status":"failed","error_message":"permanent SMTP 550"}`, deliveryID)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", strings.NewReader(reqBody))
	req.Header.Set("X-Internal-Key", "test-internal-scheduled-key")
	rec := httptest.NewRecorder()
	scheduledCompleteHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from scheduledCompleteHandler, got %d", rec.Code)
	}

	// Verify draft exists with identical subject and send_failed = true
	var draftSubject string
	var sendFailed bool
	err = conn.QueryRow(ctx, `
		SELECT subject, send_failed FROM drafts WHERE mailbox_id = $1 ORDER BY created_at DESC LIMIT 1
	`, senderMailboxID).Scan(&draftSubject, &sendFailed)
	if err != nil {
		t.Fatalf("query draft on failure: %v", err)
	}
	if draftSubject != originalSubject {
		t.Errorf("subject was corrupted! expected %q, got %q", originalSubject, draftSubject)
	}
	if !sendFailed {
		t.Errorf("expected draft send_failed = true, got false")
	}

	// Verify Sent folder has 0 messages
	var sentCount int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'
	`, senderMailboxID).Scan(&sentCount)
	if err != nil {
		t.Fatalf("query sent count: %v", err)
	}
	if sentCount != 0 {
		t.Errorf("expected 0 Sent messages on failure, got %d", sentCount)
	}
}
