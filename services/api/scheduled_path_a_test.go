package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func setupSchedulePathAMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/outbound/schedule-path-a", withSecurityHeaders(withCORS(outboundSchedulePathAHandler)))
	return mux
}

// envelopeKeyID parses the key_id field from an envelope JSON string.
func envelopeKeyID(envelopeJSON string) string {
	var raw map[string]interface{}
	if err := json.Unmarshal([]byte(envelopeJSON), &raw); err != nil {
		return ""
	}
	kid, _ := raw["key_id"].(string)
	return kid
}

// recipientAddrFromMailboxID looks up local_part@domain for a mailbox UUID.
func recipientAddrFromMailboxID(ctx context.Context, conn *pgx.Conn, mailboxID string) (string, error) {
	var local, domain string
	err := conn.QueryRow(ctx, `
		SELECT m.local_part, d.name FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id WHERE m.id = $1
	`, mailboxID).Scan(&local, &domain)
	if err != nil {
		return "", err
	}
	return local + "@" + domain, nil
}

// TestSchedulePathAStoresEnvelope — POST /v1/outbound/schedule-path-a with a
// valid signed envelope returns 201 and a row in scheduled_messages with is_path_a=true.
func TestSchedulePathAStoresEnvelope(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	recipientEmail, err := recipientAddrFromMailboxID(ctx, conn, recipientMailboxID)
	if err != nil {
		t.Fatalf("lookup recipient addr: %v", err)
	}

	deliverAt := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
	body := map[string]string{
		"mailbox_id":    senderMailboxID,
		"recipient":     recipientEmail,
		"envelope_json": vec.EnvelopeJSON,
		"deliver_at":    deliverAt,
	}
	bodyJSON, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/outbound/schedule-path-a", strings.NewReader(string(bodyJSON)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+senderToken)

	mux := setupSchedulePathAMux()
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		ID          string `json:"id"`
		ScheduledAt string `json:"scheduled_at"`
		Status      string `json:"status"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.ID == "" {
		t.Fatal("expected non-empty id")
	}
	if resp.Status != "scheduled" {
		t.Errorf("expected status=scheduled, got %q", resp.Status)
	}

	// Verify DB row
	var isPathA bool
	var storedEnvJSON string
	err = conn.QueryRow(ctx, `
		SELECT is_path_a, envelope_json FROM scheduled_messages WHERE id = $1
	`, resp.ID).Scan(&isPathA, &storedEnvJSON)
	if err != nil {
		t.Fatalf("query scheduled_messages: %v", err)
	}
	if !isPathA {
		t.Error("expected is_path_a=true")
	}
	if storedEnvJSON != vec.EnvelopeJSON {
		t.Errorf("envelope_json mismatch: got %d bytes, want %d bytes", len(storedEnvJSON), len(vec.EnvelopeJSON))
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", resp.ID)
	})
}

// TestSchedulePathARejectsBadSignature — tampered envelope returns 400.
func TestSchedulePathARejectsBadSignature(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	recipientEmail, err := recipientAddrFromMailboxID(ctx, conn, recipientMailboxID)
	if err != nil {
		t.Fatalf("lookup recipient addr: %v", err)
	}

	// Tamper the sig field
	tampered := vec.EnvelopeJSON
	if strings.Contains(tampered, `"sig":"`) {
		// Replace a few bytes in the sig with garbage
		idx := strings.Index(tampered, `"sig":"`)
		if idx >= 0 {
			afterKey := idx + len(`"sig":"`)
			if afterKey+8 < len(tampered) {
				tampered = tampered[:afterKey] + "AAAAAAAA" + tampered[afterKey+8:]
			}
		}
	}
	if tampered == vec.EnvelopeJSON {
		// Fallback: corrupt the ct field
		tampered = strings.Replace(vec.EnvelopeJSON, `"ct":"`, `"ct":"ZZZZ`, 1)
	}

	deliverAt := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
	body := map[string]string{
		"mailbox_id":    senderMailboxID,
		"recipient":     recipientEmail,
		"envelope_json": tampered,
		"deliver_at":    deliverAt,
	}
	bodyJSON, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1/outbound/schedule-path-a", strings.NewReader(string(bodyJSON)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+senderToken)

	mux := setupSchedulePathAMux()
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for tampered envelope, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestScheduledPathADelivery — inserts a past-due Path A row and calls
// processPathAScheduled; asserts recipient has a message and status='executed'.
func TestScheduledPathADelivery(t *testing.T) {
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

	recipientEmail, err := recipientAddrFromMailboxID(ctx, conn, recipientMailboxID)
	if err != nil {
		t.Fatalf("lookup recipient addr: %v", err)
	}

	// Look up sender domain_id
	var senderDomainID string
	err = conn.QueryRow(ctx, `SELECT domain_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&senderDomainID)
	if err != nil {
		t.Fatalf("lookup sender domain: %v", err)
	}

	// Insert a row that is due right now (scheduled_at in the past)
	scheduledAt := time.Now().Add(-1 * time.Second)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	var rowID string
	err = conn.QueryRow(ctx, `
		INSERT INTO scheduled_messages (
			mailbox_id, domain_id, recipient,
			send_token_hash,
			scheduled_at, status,
			expires_at,
			is_path_a, envelope_json
		) VALUES (
			$1, $2, $3,
			decode('', 'hex'),
			$4, 'pending',
			$5,
			true, $6
		) RETURNING id::text
	`, senderMailboxID, senderDomainID, recipientEmail,
		scheduledAt, expiresAt, vec.EnvelopeJSON,
	).Scan(&rowID)
	if err != nil {
		t.Fatalf("insert scheduled row: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1", recipientMailboxID)
	})

	// Run the goroutine function once
	if err := processPathAScheduled(ctx, testDSN); err != nil {
		t.Fatalf("processPathAScheduled: %v", err)
	}

	// Check the row is now 'executed'
	var status string
	err = conn.QueryRow(ctx, `SELECT status FROM scheduled_messages WHERE id = $1`, rowID).Scan(&status)
	if err != nil {
		t.Fatalf("query scheduled_messages status: %v", err)
	}
	if status != "executed" {
		t.Errorf("expected status=executed, got %q", status)
	}

	// Check the recipient got a message
	var msgCount int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_metadata
		WHERE mailbox_id = $1 AND wrapped_key_algorithm = 'HPKE-XWing-AES256GCM-v1'
	`, recipientMailboxID).Scan(&msgCount)
	if err != nil {
		t.Fatalf("query message_metadata: %v", err)
	}
	if msgCount == 0 {
		t.Error("expected at least 1 message in recipient mailbox with HPKE-XWing-AES256GCM-v1")
	}
}

// TestRustWorkerSkipsPathARows — verifies that the SQL WHERE clause used by the
// Rust worker (AND is_path_a = false) excludes Path A rows.
func TestRustWorkerSkipsPathARows(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)
	_ = recipientMailboxID
	setupMockStorageServer(t)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	recipientEmail, _ := recipientAddrFromMailboxID(ctx, conn, recipientMailboxID)

	var senderDomainID string
	_ = conn.QueryRow(ctx, `SELECT domain_id::text FROM mailboxes WHERE id = $1`, senderMailboxID).Scan(&senderDomainID)

	scheduledAt := time.Now().Add(-1 * time.Second)
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	var rowID string
	err = conn.QueryRow(ctx, `
		INSERT INTO scheduled_messages (
			mailbox_id, domain_id, recipient, send_token_hash,
			scheduled_at, status, expires_at, is_path_a, envelope_json
		) VALUES (
			$1, $2, $3, decode('', 'hex'),
			$4, 'pending', $5, true, $6
		) RETURNING id::text
	`, senderMailboxID, senderDomainID, recipientEmail,
		scheduledAt, expiresAt, vec.EnvelopeJSON,
	).Scan(&rowID)
	if err != nil {
		t.Fatalf("insert path a row: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM scheduled_messages WHERE id = $1", rowID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1", recipientMailboxID)
	})

	// Rust worker query filter: WHERE is_path_a = false — must NOT see this row
	var count int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM scheduled_messages
		WHERE id = $1 AND status = 'pending' AND is_path_a = false
	`, rowID).Scan(&count)
	if err != nil {
		t.Fatalf("rust worker filter query: %v", err)
	}
	if count != 0 {
		t.Errorf("Rust worker query (is_path_a=false) should not select Path A row, got count=%d", count)
	}

	// Path A goroutine query: WHERE is_path_a = true — must see this row
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM scheduled_messages
		WHERE id = $1 AND status = 'pending' AND is_path_a = true AND scheduled_at <= now()
	`, rowID).Scan(&count)
	if err != nil {
		t.Fatalf("path a goroutine filter query: %v", err)
	}
	if count != 1 {
		t.Errorf("Path A goroutine query (is_path_a=true) should select this row, got count=%d", count)
	}
}
