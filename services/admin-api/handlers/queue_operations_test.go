package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func getQueueTestDBURL() string {
	if url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL")); url != "" {
		return url
	}
	return "postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable"
}

func setupQueueTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	connStr := getQueueTestDBURL()
	u, err := url.Parse(connStr)
	if err != nil {
		t.Fatalf("invalid test db url: %v", err)
	}

	dbName := strings.TrimPrefix(u.Path, "/")
	if !strings.EqualFold(dbName, "byos_test_isolation") {
		t.Fatalf("SAFETY VIOLATION: Refusing to run tests against database '%s'. Must be 'byos_test_isolation'.", dbName)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("failed to connect to test db: %v", err)
	}

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), "TRUNCATE TABLE outbound_delivery_operator_audit, outbound_queue, delivery_log CASCADE")
		pool.Close()
	})

	return pool
}

type queueSeededTenant struct {
	OrgID    uuid.UUID
	DomainID uuid.UUID
	UserID   uuid.UUID
	MailboxID uuid.UUID
}

func seedTestTenant(t *testing.T, ctx context.Context, pool *pgxpool.Pool) queueSeededTenant {
	t.Helper()

	orgID := uuid.New()
	domainID := uuid.New()
	userID := uuid.New()
	mailboxID := uuid.New()
	domainName := "c65-" + strings.ReplaceAll(domainID.String()[:8], "-", "") + ".local"
	userEmail := "c65_user@" + domainName

	_, err := pool.Exec(ctx, `
		INSERT INTO organizations (id, name, org_recovery_pk)
		VALUES ($1, 'C65 Test Org', '\x01020304')
		ON CONFLICT (id) DO NOTHING
	`, orgID)
	if err != nil {
		t.Fatalf("failed to insert test org: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO domains (id, org_id, name, is_verified)
		VALUES ($1, $2, $3, true)
		ON CONFLICT (id) DO NOTHING
	`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("failed to insert test domain: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, org_id, email, password_hash)
		VALUES ($1, $2, $3, '$2a$10$fakehashforqueueops')
		ON CONFLICT (id) DO NOTHING
	`, userID, orgID, userEmail)
	if err != nil {
		t.Fatalf("failed to insert test user: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, mailbox_pk)
		VALUES ($1, $2, $3, $4, 'c65_user', 'private', '\x01020304')
		ON CONFLICT (id) DO NOTHING
	`, mailboxID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("failed to insert test mailbox: %v", err)
	}

	return queueSeededTenant{
		OrgID:     orgID,
		DomainID:  domainID,
		UserID:    userID,
		MailboxID: mailboxID,
	}
}

func dummyPassAuth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// If context already has an identity (e.g. from an explicit test case), preserve it
		if _, ok := GetAgentIdentity(r.Context()); ok {
			h(w, r)
			return
		}

		actorID := r.Header.Get("X-Operator-Id")
		if actorID == "" {
			actorID = "test-support-agent"
		}
		actorEmail := r.Header.Get("X-Operator-Email")
		if actorEmail == "" {
			actorEmail = "support@byos.local"
		}
		actorRole := r.Header.Get("X-Operator-Role")
		if actorRole == "" {
			actorRole = "support_agent"
		}

		ctx := ContextWithAgentIdentity(r.Context(), AgentIdentity{
			ActorID:  actorID,
			Email:    actorEmail,
			Role:     actorRole,
			AuthType: "test",
		})
		h(w, r.WithContext(ctx))
	}
}

// 1. Test Input Validation without DB
func TestQueueOperations_InputValidation(t *testing.T) {
	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, nil, dummyPassAuth)

	validQueueID := uuid.New().String()

	cases := []struct {
		name         string
		method       string
		path         string
		body         any
		expectedCode int
		expectedMsg  string
	}{
		{
			name:         "Invalid Action",
			method:       http.MethodPost,
			path:         "/admin/v1/queue/messages/" + validQueueID + "/reconcile",
			body:         ReconcileRequest{Action: "invalid_action", OperatorReason: "test reason"},
			expectedCode: http.StatusBadRequest,
			expectedMsg:  "invalid action",
		},
		{
			name:         "Missing Operator Reason",
			method:       http.MethodPost,
			path:         "/admin/v1/queue/messages/" + validQueueID + "/reconcile",
			body:         ReconcileRequest{Action: "resolve_accepted"},
			expectedCode: http.StatusBadRequest,
			expectedMsg:  "operator_reason is strictly required",
		},
		{
			name:         "resolve_accepted Missing Evidence Category",
			method:       http.MethodPost,
			path:         "/admin/v1/queue/messages/" + validQueueID + "/reconcile",
			body:         ReconcileRequest{Action: "resolve_accepted", OperatorReason: "verified via logs"},
			expectedCode: http.StatusBadRequest,
			expectedMsg:  "requires evidence_category and evidence_reference",
		},
		{
			name:         "authorize_retry Missing Duplicate Risk Acknowledgment",
			method:       http.MethodPost,
			path:         "/admin/v1/queue/messages/" + validQueueID + "/reconcile",
			body: ReconcileRequest{
				Action:                     "authorize_retry",
				OperatorReason:             "recipient confirmed not received",
				EvidenceCategory:           "ticket_transcript",
				EvidenceReference:          "TKT-99102",
				DuplicateRiskAcknowledged: false,
			},
			expectedCode: http.StatusBadRequest,
			expectedMsg:  "duplicate_risk_acknowledged must be true",
		},
		{
			name:         "Invalid UUID in Path",
			method:       http.MethodGet,
			path:         "/admin/v1/queue/messages/not-a-valid-uuid",
			body:         nil,
			expectedCode: http.StatusBadRequest,
			expectedMsg:  "invalid queue message UUID",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var bodyBytes []byte
			if tc.body != nil {
				bodyBytes, _ = json.Marshal(tc.body)
			}
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewReader(bodyBytes))
			rec := httptest.NewRecorder()

			mux.ServeHTTP(rec, req)

			if rec.Code != tc.expectedCode {
				t.Fatalf("expected status %d, got %d. Body: %s", tc.expectedCode, rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.expectedMsg) {
				t.Fatalf("expected body to contain '%s', got: %s", tc.expectedMsg, rec.Body.String())
			}
		})
	}
}

// 2. Integration Test: Overview Metrics and Health Invariants
func TestQueueOperations_OverviewMetrics(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	// Clean queue table for isolated test
	_, err := pool.Exec(ctx, `DELETE FROM outbound_queue WHERE mailbox_id = $1`, tenant.MailboxID)
	if err != nil {
		t.Fatalf("failed cleaning outbound_queue: %v", err)
	}

	// 1. Seed pending message
	pendingID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at)
		VALUES ($1, $1, $2, $3, 'pending@c65-test.local', '\x01', '\x02', 'pending', 0, clock_timestamp() - interval '60 seconds', clock_timestamp(), clock_timestamp() + interval '24 hours')
	`, pendingID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed seeding pending item: %v", err)
	}

	// 2. Seed outcome_unknown message
	unknownID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, failed_at, expires_at, smtp_phase, last_error)
		VALUES ($1, $1, $2, $3, 'unknown@c65-test.local', '\x01', '\x02', 'outcome_unknown', 1, clock_timestamp() - interval '120 seconds', clock_timestamp() - interval '30 seconds', clock_timestamp() + interval '24 hours', 'terminator_in_flight', 'Connection reset by peer')
	`, unknownID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed seeding outcome_unknown item: %v", err)
	}

	// 3. Seed delivered message
	delID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, delivered_at, expires_at)
		VALUES ($1, $1, $2, $3, 'delivered@c65-test.local', '\x01', '\x02', 'delivered', 1, clock_timestamp() - interval '300 seconds', clock_timestamp() - interval '200 seconds', clock_timestamp() + interval '24 hours')
	`, delID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed seeding delivered item: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/overview", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var resp QueueOverviewResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed decoding json: %v", err)
	}

	if resp.Counts["pending"] < 1 {
		t.Fatalf("expected pending count >= 1, got %d", resp.Counts["pending"])
	}
	if resp.Counts["outcome_unknown"] < 1 {
		t.Fatalf("expected outcome_unknown count >= 1, got %d", resp.Counts["outcome_unknown"])
	}
	if resp.Counts["delivered"] < 1 {
		t.Fatalf("expected delivered count >= 1, got %d", resp.Counts["delivered"])
	}
	if resp.Counts["delivered_24h"] < 1 {
		t.Fatalf("expected delivered_24h >= 1, got %d", resp.Counts["delivered_24h"])
	}

	// Health status should be degraded or critical because outcome_unknown > 0
	if resp.Status != "degraded" && resp.Status != "critical" {
		t.Fatalf("expected health status 'degraded' or 'critical' when outcome_unknown > 0, got '%s'", resp.Status)
	}
}

// 3. Integration Test: Message Listing, Filtering, and Zero-Knowledge Assurance
func TestQueueOperations_ListAndZeroKnowledge(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	// Clean queue table for isolated test
	_, _ = pool.Exec(ctx, `DELETE FROM outbound_queue WHERE mailbox_id = $1`, tenant.MailboxID)

	targetID := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at)
		VALUES ($1, $1, $2, $3, 'zk-check@c65-test.local', '\xdeadbeef010203', '\xfeedface040506', 'outcome_unknown', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours')
	`, targetID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed seeding zk-check item: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Query message listing
	req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/messages?recipient=zk-check", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	rawBody := rec.Body.String()

	// CRITICAL ZERO-KNOWLEDGE INVARIANT CHECKS:
	if strings.Contains(rawBody, "deadbeef") || strings.Contains(rawBody, "feedface") {
		t.Fatalf("CRITICAL SECURITY VIOLATION: encrypted_message or send_token ciphertext leaked in API response!")
	}
	if strings.Contains(rawBody, "encrypted_message") || strings.Contains(rawBody, "send_token_hpke_wrapped") {
		t.Fatalf("CRITICAL SECURITY VIOLATION: Ciphertext column keys present in API response schema!")
	}

	var listResp QueueMessageListResponse
	if err := json.Unmarshal([]byte(rawBody), &listResp); err != nil {
		t.Fatalf("failed parsing list json: %v", err)
	}

	if len(listResp.Messages) == 0 {
		t.Fatalf("expected at least 1 message in list")
	}

	found := false
	for _, m := range listResp.Messages {
		if m.ID == targetID.String() {
			found = true
			if m.Recipient != "zk-check@c65-test.local" {
				t.Fatalf("unexpected recipient: %s", m.Recipient)
			}
			if m.Status != "outcome_unknown" {
				t.Fatalf("unexpected status: %s", m.Status)
			}
		}
	}
	if !found {
		t.Fatalf("seeded item %s not found in list response", targetID)
	}
}

// 4. Integration Test: Message Detail and Delivery Log History
func TestQueueOperations_DetailAndHistory(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	itemUUID := uuid.New()
	deliveryUUID := uuid.New()

	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at, smtp_phase, last_error)
		VALUES ($1, $2, $3, $4, 'detail@c65-test.local', '\x01', '\x02', 'outcome_unknown', 2, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours', 'terminator_in_flight', 'TLS drop')
	`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting queue item: %v", err)
	}

	// Insert attempt history in delivery_log
	lease1 := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO delivery_log (delivery_id, mailbox_id, domain_id, recipient, direction, status, smtp_code, smtp_message, created_at, lease_token, smtp_phase)
		VALUES ($1, $2, $3, 'detail@c65-test.local', 'outbound', 'retrying', 451, 'Temporary local problem', clock_timestamp() - interval '5 minutes', $4, 'pre_data')
	`, deliveryUUID, tenant.MailboxID, tenant.DomainID, lease1)
	if err != nil {
		t.Fatalf("failed inserting attempt 1 log: %v", err)
	}

	lease2 := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO delivery_log (delivery_id, mailbox_id, domain_id, recipient, direction, status, smtp_code, smtp_message, created_at, lease_token, smtp_phase)
		VALUES ($1, $2, $3, 'detail@c65-test.local', 'outbound', 'outcome_unknown', 0, 'TLS drop after terminator', clock_timestamp() - interval '1 minute', $4, 'terminator_in_flight')
	`, deliveryUUID, tenant.MailboxID, tenant.DomainID, lease2)
	if err != nil {
		t.Fatalf("failed inserting attempt 2 log: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/messages/"+itemUUID.String(), nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var detailResp QueueMessageDetailResponse
	if err := json.NewDecoder(rec.Body).Decode(&detailResp); err != nil {
		t.Fatalf("failed decoding detail json: %v", err)
	}

	if detailResp.Message.ID != itemUUID.String() {
		t.Fatalf("expected message id %s, got %s", itemUUID, detailResp.Message.ID)
	}
	if detailResp.Message.DeliveryID != deliveryUUID.String() {
		t.Fatalf("expected delivery id %s, got %s", deliveryUUID, detailResp.Message.DeliveryID)
	}
	if len(detailResp.DeliveryLogs) != 2 {
		t.Fatalf("expected exactly 2 delivery log entries, got %d", len(detailResp.DeliveryLogs))
	}
	if detailResp.DeliveryLogs[0].Status != "retrying" || detailResp.DeliveryLogs[1].Status != "outcome_unknown" {
		t.Fatalf("unexpected delivery log statuses: %v", detailResp.DeliveryLogs)
	}
}

// 5. Integration Test: Reconcile resolve_accepted (Mark as Delivered)
func TestQueueOperations_ReconcileResolveAccepted(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	itemUUID := uuid.New()
	deliveryUUID := uuid.New()

	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at, smtp_phase)
		VALUES ($1, $2, $3, $4, 'accepted@c65-test.local', '\x01', '\x02', 'outcome_unknown', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours', 'terminator_in_flight')
	`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting queue item: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	reconcileReq := ReconcileRequest{
		Action:             "resolve_accepted",
		OperatorReason:     "Confirmed received via recipient Postfix log ID 4S8x9Z1",
		ResolutionCategory: "manual_mta_verification",
		EvidenceCategory:   "postfix_queue_id",
		EvidenceReference:  "4S8x9Z1000",
	}
	bodyBytes, _ := json.Marshal(reconcileReq)

	req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
	req.Header.Set("X-Operator-Id", "op-42")
	req.Header.Set("X-Operator-Email", "sarah.chen@byos.local")
	req.Header.Set("X-Operator-Role", "platform_admin")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var resp ReconcileResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed decoding json: %v", err)
	}

	if !resp.Success || resp.ResultingStatus != "delivered" {
		t.Fatalf("expected successful resolution to 'delivered', got %+v", resp)
	}

	// Verify database row state
	var status string
	var deliveredAt *time.Time
	var reconciledBy, reconciledReason *string
	var leaseTok *uuid.UUID

	err = pool.QueryRow(ctx, `
		SELECT status, delivered_at, reconciled_by, reconciliation_reason, lease_token
		FROM outbound_queue WHERE id = $1
	`, itemUUID).Scan(&status, &deliveredAt, &reconciledBy, &reconciledReason, &leaseTok)
	if err != nil {
		t.Fatalf("failed querying updated queue row: %v", err)
	}

	if status != "delivered" {
		t.Fatalf("expected status 'delivered', got '%s'", status)
	}
	if deliveredAt == nil {
		t.Fatalf("expected delivered_at to be populated")
	}
	if reconciledBy == nil || *reconciledBy != "sarah.chen@byos.local" {
		t.Fatalf("expected reconciled_by 'sarah.chen@byos.local', got %v", reconciledBy)
	}
	if reconciledReason == nil || !strings.Contains(*reconciledReason, "4S8x9Z1") {
		t.Fatalf("expected reconciliation_reason populated, got %v", reconciledReason)
	}
	if leaseTok != nil {
		t.Fatalf("expected lease_token to be NULL on delivered status, got %v", leaseTok)
	}

	// Verify delivery_log record
	var logStatus string
	var smtpCode int
	err = pool.QueryRow(ctx, `
		SELECT status, smtp_code
		FROM delivery_log
		WHERE delivery_id = $1 AND status = 'delivered'
	`, deliveryUUID).Scan(&logStatus, &smtpCode)
	if err != nil {
		t.Fatalf("expected terminal delivered row in delivery_log: %v", err)
	}
	if smtpCode != 250 {
		t.Fatalf("expected smtp_code 250, got %d", smtpCode)
	}

	// Verify outbound_delivery_operator_audit record
	var auditAction, actorEmail, prevStatus, resStatus, evidCat, evidRef string
	err = pool.QueryRow(ctx, `
		SELECT action, actor_email, previous_status, resulting_status, evidence_category, evidence_reference
		FROM outbound_delivery_operator_audit
		WHERE queue_id = $1
	`, itemUUID).Scan(&auditAction, &actorEmail, &prevStatus, &resStatus, &evidCat, &evidRef)
	if err != nil {
		t.Fatalf("expected audit row in outbound_delivery_operator_audit: %v", err)
	}

	if auditAction != "resolve_accepted" || actorEmail != "sarah.chen@byos.local" || prevStatus != "outcome_unknown" || resStatus != "delivered" {
		t.Fatalf("unexpected audit entry values: action=%s, actor=%s, prev=%s, res=%s", auditAction, actorEmail, prevStatus, resStatus)
	}
	if evidCat != "postfix_queue_id" || evidRef != "4S8x9Z1000" {
		t.Fatalf("unexpected evidence fields: cat=%s, ref=%s", evidCat, evidRef)
	}
}

// 6. Integration Test: Reconcile authorize_retry (Authorize Retransmission)
func TestQueueOperations_ReconcileAuthorizeRetry(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	itemUUID := uuid.New()
	deliveryUUID := uuid.New()

	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at, smtp_phase)
		VALUES ($1, $2, $3, $4, 'retry@c65-test.local', '\x01', '\x02', 'outcome_unknown', 2, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours', 'terminator_in_flight')
	`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting queue item: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Step A: Attempt authorize_retry without duplicate risk acknowledgement -> Must fail
	reqNoAck := ReconcileRequest{
		Action:                     "authorize_retry",
		OperatorReason:             "Recipient confirms email was never received",
		EvidenceCategory:           "support_ticket",
		EvidenceReference:          "TKT-4912",
		DuplicateRiskAcknowledged: false,
	}
	bodyBytes, _ := json.Marshal(reqNoAck)
	req1 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
	rec1 := httptest.NewRecorder()
	mux.ServeHTTP(rec1, req1)

	if rec1.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when duplicate_risk_acknowledged is false, got %d", rec1.Code)
	}

	// Step B: Attempt with duplicate_risk_acknowledged = true -> Must succeed
	reqAck := reqNoAck
	reqAck.DuplicateRiskAcknowledged = true
	bodyBytesAck, _ := json.Marshal(reqAck)

	req2 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytesAck))
	req2.Header.Set("X-Operator-Id", "op-88")
	req2.Header.Set("X-Operator-Email", "alex.operator@byos.local")
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec2.Code, rec2.Body.String())
	}

	// Verify database row state: status must be 'pending', smtp_phase must be NULL, next_attempt_at <= clock_timestamp()
	var status string
	var nextAttempt time.Time
	var smtpPhase *string
	var leaseTok *uuid.UUID

	err = pool.QueryRow(ctx, `
		SELECT status, next_attempt_at, smtp_phase, lease_token
		FROM outbound_queue WHERE id = $1
	`, itemUUID).Scan(&status, &nextAttempt, &smtpPhase, &leaseTok)
	if err != nil {
		t.Fatalf("failed querying updated queue row: %v", err)
	}

	if status != "pending" {
		t.Fatalf("expected status 'pending', got '%s'", status)
	}
	if smtpPhase != nil {
		t.Fatalf("expected smtp_phase to be reset to NULL, got %v", *smtpPhase)
	}
	if leaseTok != nil {
		t.Fatalf("expected lease_token to be NULL, got %v", leaseTok)
	}

	// Verify delivery_log record
	var retryCount int
	err = pool.QueryRow(ctx, `
		SELECT count(*)
		FROM delivery_log
		WHERE delivery_id = $1 AND status = 'retrying'
	`, deliveryUUID).Scan(&retryCount)
	if err != nil || retryCount != 1 {
		t.Fatalf("expected retrying entry in delivery_log, count=%d, err=%v", retryCount, err)
	}
}

// 7. Integration Test: Reconcile add_note (Non-mutating Investigation)
func TestQueueOperations_ReconcileAddNote(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	itemUUID := uuid.New()
	deliveryUUID := uuid.New()

	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at, smtp_phase)
		VALUES ($1, $2, $3, $4, 'note@c65-test.local', '\x01', '\x02', 'outcome_unknown', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours', 'terminator_in_flight')
	`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting queue item: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	reqBody := ReconcileRequest{
		Action:         "add_note",
		OperatorReason: "Reached out to upstream Postfix admin; awaiting log trace",
	}
	b, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(b))
	req.Header.Set("X-Operator-Email", "support@byos.local")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	// Assert queue row status did NOT change
	var status string
	err = pool.QueryRow(ctx, `SELECT status FROM outbound_queue WHERE id = $1`, itemUUID).Scan(&status)
	if err != nil || status != "outcome_unknown" {
		t.Fatalf("expected status to remain 'outcome_unknown', got '%s'", status)
	}

	// Assert audit log was created
	var auditCount int
	err = pool.QueryRow(ctx, `SELECT count(*) FROM outbound_delivery_operator_audit WHERE queue_id = $1 AND action = 'add_note'`, itemUUID).Scan(&auditCount)
	if err != nil || auditCount != 1 {
		t.Fatalf("expected 1 audit note, got %d", auditCount)
	}
}

// 8. Integration Test: Fencing Conflicts (Processing / Delivered / Concurrent Races)
func TestQueueOperations_ReconcileFencingConflicts(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Case A: Reject reconcile on 'processing' status
	procID := uuid.New()
	leaseTok := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at, lease_token, lease_owner, claimed_at, lease_expires_at)
		VALUES ($1, $1, $2, $3, 'processing@c65-test.local', '\x01', '\x02', 'processing', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours', $4, 'worker-1', clock_timestamp(), clock_timestamp() + interval '10 minutes')
	`, procID, tenant.MailboxID, tenant.DomainID, leaseTok)
	if err != nil {
		t.Fatalf("failed seeding processing row: %v", err)
	}

	reqBody := ReconcileRequest{
		Action:            "resolve_accepted",
		OperatorReason:    "attempting to resolve processing message",
		EvidenceCategory:  "mta_log",
		EvidenceReference: "LOG-01",
	}
	b, _ := json.Marshal(reqBody)

	req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+procID.String()+"/reconcile", bytes.NewReader(b))
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict when reconciling processing item, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	// Case B: Reject reconcile on 'delivered' status
	delID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at, delivered_at)
		VALUES ($1, $1, $2, $3, 'del@c65-test.local', '\x01', '\x02', 'delivered', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours', clock_timestamp())
	`, delID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed seeding delivered row: %v", err)
	}

	reqDel := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+delID.String()+"/reconcile", bytes.NewReader(b))
	recDel := httptest.NewRecorder()
	mux.ServeHTTP(recDel, reqDel)

	if recDel.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict when reconciling delivered item, got %d. Body: %s", recDel.Code, recDel.Body.String())
	}
}

// 9. Integration Test: Alerts Detection for Stuck Messages and Stale Leases
func TestQueueOperations_AlertsDetection(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	// Clean queue
	_, _ = pool.Exec(ctx, `DELETE FROM outbound_queue WHERE mailbox_id = $1`, tenant.MailboxID)

	// Seed stale lease: processing message where lease expired 10 minutes ago
	staleID := uuid.New()
	staleLease := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at, lease_token, lease_owner, claimed_at, lease_expires_at)
		VALUES ($1, $1, $2, $3, 'stale@c65-test.local', '\x01', '\x02', 'processing', 1, clock_timestamp() - interval '20 minutes', clock_timestamp(), clock_timestamp() + interval '24 hours', $4, 'crashed-worker-7', clock_timestamp() - interval '20 minutes', clock_timestamp() - interval '10 minutes')
	`, staleID, tenant.MailboxID, tenant.DomainID, staleLease)
	if err != nil {
		t.Fatalf("failed seeding stale lease row: %v", err)
	}

	// Seed stuck pending: pending message scheduled 30 minutes in the past
	stuckID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at)
		VALUES ($1, $1, $2, $3, 'stuck@c65-test.local', '\x01', '\x02', 'pending', 1, clock_timestamp() - interval '40 minutes', clock_timestamp() - interval '30 minutes', clock_timestamp() + interval '24 hours')
	`, stuckID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed seeding stuck pending row: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/alerts", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var alertsResp QueueAlertsResponse
	if err := json.NewDecoder(rec.Body).Decode(&alertsResp); err != nil {
		t.Fatalf("failed decoding alerts json: %v", err)
	}

	if alertsResp.Status != "critical" {
		t.Fatalf("expected overall alert status 'critical' when stale lease present, got '%s'", alertsResp.Status)
	}

	hasStaleAlert := false
	hasStuckAlert := false
	for _, a := range alertsResp.Alerts {
		if a.Type == "stale_lease" && a.Severity == "critical" {
			hasStaleAlert = true
		}
		if a.Type == "stuck_pending" {
			hasStuckAlert = true
		}
	}

	if !hasStaleAlert {
		t.Fatalf("expected critical stale_lease alert in alerts list: %+v", alertsResp.Alerts)
	}
	if !hasStuckAlert {
		t.Fatalf("expected stuck_pending alert in alerts list: %+v", alertsResp.Alerts)
	}
}

// 10. Integration Test: Prometheus Metrics Output
func TestQueueOperations_PrometheusMetrics(t *testing.T) {
	pool := setupQueueTestPool(t)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/metrics", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	body := rec.Body.String()
	expectedMetrics := []string{
		"byos_outbound_queue_size{status=\"pending\"}",
		"byos_outbound_queue_size{status=\"processing\"}",
		"byos_outbound_queue_size{status=\"outcome_unknown\"}",
		"byos_outbound_queue_size{status=\"delivered\"}",
		"byos_outbound_stale_leases",
		"byos_outbound_queue_oldest_seconds{status=\"pending\"}",
	}

	for _, m := range expectedMetrics {
		if !strings.Contains(body, m) {
			t.Fatalf("expected metrics output to contain '%s', got:\n%s", m, body)
		}
	}
}

// 11. Integration Test: Immutable Audit Ledger Verification (Trigger Enforcement)
func TestQueueOperations_AuditLedgerImmutability(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	itemUUID := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at)
		VALUES ($1, $1, $2, $3, 'audit-immut@c65-test.local', '\x01', '\x02', 'outcome_unknown', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours')
	`, itemUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting queue item: %v", err)
	}

	var auditID uuid.UUID
	err = pool.QueryRow(ctx, `
		INSERT INTO outbound_delivery_operator_audit (
			actor_id, actor_email, actor_role, action, queue_id, delivery_id,
			previous_status, resulting_status, operator_reason
		) VALUES ('op-1', 'op@byos.local', 'admin', 'investigate', $1, $1, 'outcome_unknown', 'outcome_unknown', 'initial review')
		RETURNING id
	`, itemUUID).Scan(&auditID)
	if err != nil {
		t.Fatalf("failed inserting audit row: %v", err)
	}

	// 1. Attempt UPDATE on outbound_delivery_operator_audit -> Must fail due to trigger
	_, errUpdate := pool.Exec(ctx, `UPDATE outbound_delivery_operator_audit SET operator_reason = 'tampered' WHERE id = $1`, auditID)
	if errUpdate == nil {
		t.Fatalf("CRITICAL SECURITY VIOLATION: UPDATE on outbound_delivery_operator_audit succeeded! Trigger failed to block.")
	}
	if !strings.Contains(errUpdate.Error(), "outbound_delivery_operator_audit is immutable") {
		t.Fatalf("expected trigger exception message, got: %v", errUpdate)
	}

	// 2. Attempt DELETE on outbound_delivery_operator_audit -> Must fail due to trigger
	_, errDelete := pool.Exec(ctx, `DELETE FROM outbound_delivery_operator_audit WHERE id = $1`, auditID)
	if errDelete == nil {
		t.Fatalf("CRITICAL SECURITY VIOLATION: DELETE on outbound_delivery_operator_audit succeeded! Trigger failed to block.")
	}
	if !strings.Contains(errDelete.Error(), "outbound_delivery_operator_audit is immutable") {
		t.Fatalf("expected trigger exception message, got: %v", errDelete)
	}
}

// 12. C6.5.2 Security Test: Server-Side RBAC Enforcement & Anti-Spoofing
func TestQueueOperations_AuthorizationRBAC(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	itemUUID := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, attempts, created_at, next_attempt_at, expires_at)
		VALUES ($1, $1, $2, $3, 'rbac-test@c65-test.local', '\x01', '\x02', 'outcome_unknown', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours')
	`, itemUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting test item: %v", err)
	}

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, func(next http.HandlerFunc) http.HandlerFunc {
		return next
	})

	reconcilePayload := ReconcileRequest{
		Action:         "add_note",
		OperatorReason: "rbac security audit note",
	}
	bodyBytes, _ := json.Marshal(reconcilePayload)

	// Subtest A: Unauthenticated request (no identity in context) -> 401 Unauthorized
	t.Run("Unauthenticated Request Blocked", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/overview", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized, got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})

	// Subtest B: Ordinary User Blocked -> 403 Forbidden
	t.Run("Ordinary User Role Blocked", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/overview", nil)
		reqContext := ContextWithAgentIdentity(req.Context(), AgentIdentity{
			ActorID: "user-1",
			Email:   "user@customer.org",
			Role:    "ordinary_user",
		})
		req = req.WithContext(reqContext)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for ordinary_user, got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})

	// Subtest C: Organization Admin Blocked -> 403 Forbidden
	t.Run("Org Admin Role Blocked", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/overview", nil)
		reqContext := ContextWithAgentIdentity(req.Context(), AgentIdentity{
			ActorID: "orgadmin-1",
			Email:   "orgadmin@customer.org",
			Role:    "org_admin",
		})
		req = req.WithContext(reqContext)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for org_admin, got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})

	// Subtest D: Read-Only Operator Read Allowed (200), Mutation Blocked (403)
	t.Run("Read-Only Operator Read Allowed, Mutation Blocked", func(t *testing.T) {
		// Read overview -> 200
		readReq := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/overview", nil)
		readCtx := ContextWithAgentIdentity(readReq.Context(), AgentIdentity{
			ActorID: "ro-op",
			Email:   "readonly@byos.local",
			Role:    "read_only_operator",
		})
		readRec := httptest.NewRecorder()
		mux.ServeHTTP(readRec, readReq.WithContext(readCtx))
		if readRec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for read_only_operator read, got %d. Body: %s", readRec.Code, readRec.Body.String())
		}

		// Mutate reconcile -> 403
		mutReq := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		mutRec := httptest.NewRecorder()
		mux.ServeHTTP(mutRec, mutReq.WithContext(readCtx))
		if mutRec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for read_only_operator mutation, got %d. Body: %s", mutRec.Code, mutRec.Body.String())
		}
		if !strings.Contains(mutRec.Body.String(), "read-only operator cannot perform queue mutations") {
			t.Fatalf("expected read-only forbidden message, got: %s", mutRec.Body.String())
		}
	})

	// Subtest E: Header Spoofing Attack Defeated -> Client headers ignored, context identity enforced
	t.Run("Header Spoofing Attack Defeated", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		// Authenticated context has read_only_operator
		ctxSpoof := ContextWithAgentIdentity(req.Context(), AgentIdentity{
			ActorID: "ro-op",
			Email:   "readonly@byos.local",
			Role:    "read_only_operator",
		})
		// Attacker attempts to spoof platform_admin via client headers
		req.Header.Set("X-Operator-Role", "platform_admin")
		req.Header.Set("X-Operator-Email", "attacker@evil.com")
		req.Header.Set("X-Operator-Id", "attacker-admin")

		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req.WithContext(ctxSpoof))

		if rec.Code != http.StatusForbidden {
			t.Fatalf("CRITICAL SECURITY VULNERABILITY: Header spoofing succeeded! Expected 403 Forbidden, got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})

	// Subtest F: Support Agent & Platform Admin Mutation Allowed -> 200 OK
	t.Run("Support Agent and Platform Admin Allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		ctxSupport := ContextWithAgentIdentity(req.Context(), AgentIdentity{
			ActorID: "support-agent-1",
			Email:   "support@byos.local",
			Role:    "support_agent",
		})
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req.WithContext(ctxSupport))
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for support_agent mutation, got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})
}

// 13. C6.5.2 Lease Safety & Concurrency Fencing Tests
func TestQueueOperations_LeaseSafetyAndFencing(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Scenario A: Active Worker Lease Held -> Operator mutation must fail with 409 Conflict
	t.Run("Scenario A: Active Worker Lease Rejected", func(t *testing.T) {
		itemUUID := uuid.New()
		activeLease := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, created_at, next_attempt_at, expires_at,
				lease_token, lease_owner, claimed_at, lease_expires_at, smtp_phase
			) VALUES (
				$1, $1, $2, $3, 'active-lease@c65-test.local', '\x01', '\x02',
				'processing', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours',
				$4, 'worker-pod-1', clock_timestamp(), clock_timestamp() + interval '5 minutes', 'terminator_in_flight'
			)
		`, itemUUID, tenant.MailboxID, tenant.DomainID, activeLease)
		if err != nil {
			t.Fatalf("failed inserting active lease item: %v", err)
		}

		payload := ReconcileRequest{
			Action:             "resolve_accepted",
			OperatorReason:     "Attempting reconcile while worker is active",
			ResolutionCategory: "manual_mta_verification",
			EvidenceCategory:   "postfix_queue_id",
			EvidenceReference:  "ACT-12345",
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict when worker lease is active, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "active worker lease held") {
			t.Fatalf("expected error message to cite active worker lease, got: %s", rec.Body.String())
		}
	})

	// Scenario B: Quarantined Outcome Unknown Message -> Operator mutation succeeds (200 OK)
	t.Run("Scenario B: Quarantined Unknown Outcome Reconciled", func(t *testing.T) {
		itemUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, created_at, next_attempt_at, expires_at, smtp_phase
			) VALUES (
				$1, $1, $2, $3, 'expired-lease@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours',
				'terminator_in_flight'
			)
		`, itemUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting unknown outcome item: %v", err)
		}

		payload := ReconcileRequest{
			Action:             "resolve_accepted",
			OperatorReason:     "Worker crashed after terminator; verified remote 250 via logs",
			ResolutionCategory: "manual_mta_verification",
			EvidenceCategory:   "mta_log_receipt",
			EvidenceReference:  "MTA-EXP-9921",
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for expired lease reconcile, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		// Verify row is now delivered in DB
		var status string
		var leaseTok *uuid.UUID
		err = pool.QueryRow(ctx, `SELECT status, lease_token FROM outbound_queue WHERE id = $1`, itemUUID).Scan(&status, &leaseTok)
		if err != nil {
			t.Fatalf("failed querying row: %v", err)
		}
		if status != "delivered" {
			t.Fatalf("expected status 'delivered', got '%s'", status)
		}
		if leaseTok != nil {
			t.Fatalf("expected lease_token to be cleared (NULL), got %v", leaseTok)
		}
	})

	// Scenario C/D: Concurrent Worker Status Change -> Reconcile rejected with 409 Conflict
	t.Run("Scenario C/D: Concurrent Worker Claim / Non-Unknown Status", func(t *testing.T) {
		itemUUID := uuid.New()
		activeLease := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, created_at, next_attempt_at, expires_at,
				lease_token, lease_owner, claimed_at, lease_expires_at
			) VALUES (
				$1, $1, $2, $3, 'processing-race@c65-test.local', '\x01', '\x02',
				'processing', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours',
				$4, 'worker-pod-2', clock_timestamp(), clock_timestamp() + interval '5 minutes'
			)
		`, itemUUID, tenant.MailboxID, tenant.DomainID, activeLease)
		if err != nil {
			t.Fatalf("failed inserting processing item: %v", err)
		}

		payload := ReconcileRequest{
			Action:            "resolve_bounced",
			OperatorReason:    "Concurrent race attempt",
			EvidenceCategory:  "smtp_5xx_rejection",
			EvidenceReference: "SMTP-550-USER-UNKNOWN",
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict when item is in status 'processing', got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})

	// Scenario E: Concurrent Operator Reconciliation (Already Settled)
	t.Run("Scenario E: Concurrent Operator Reconciliation Race", func(t *testing.T) {
		itemUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, created_at, next_attempt_at, expires_at
			) VALUES (
				$1, $1, $2, $3, 'already-settled@c65-test.local', '\x01', '\x02',
				'delivered', 1, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
			)
		`, itemUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting delivered item: %v", err)
		}

		payload := ReconcileRequest{
			Action:            "resolve_bounced",
			OperatorReason:    "Late operator decision after prior settlement",
			EvidenceCategory:  "smtp_5xx_rejection",
			EvidenceReference: "SMTP-550-USER-UNKNOWN",
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict when item is already settled, got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})
}

// 14. C6.5.2 Retry Claimability & Remote MTA Acceptance Invariants
func TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Check 1: Authorize retry extends expires_at, adds max_attempts headroom, clears smtp_phase
	t.Run("Authorize Retry Claimability Enhancements", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		// Seed an item whose initial expires_at is in the past (expired TTL) and attempts == max_attempts
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, smtp_phase
			) VALUES (
				$1, $2, $3, $4, 'retry-claim@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 5, 5, clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 day', clock_timestamp() - interval '1 hour',
				'terminator_in_flight'
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		payload := ReconcileRequest{
			Action:                     "authorize_retry",
			OperatorReason:             "Customer confirmed email not received; retransmission authorized",
			EvidenceCategory:           "ticket_transcript",
			EvidenceReference:          "TKT-CLAIM-01",
			DuplicateRiskAcknowledged: true,
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for authorize_retry, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		// Inspect database row to verify worker claimability invariants
		var status string
		var attempts, maxAttempts int
		var nextAttemptAt, expiresAt time.Time
		var smtpPhase *string
		var leaseTok *uuid.UUID

		err = pool.QueryRow(ctx, `
			SELECT status, attempts, max_attempts, next_attempt_at, expires_at, smtp_phase, lease_token
			FROM outbound_queue WHERE id = $1
		`, itemUUID).Scan(&status, &attempts, &maxAttempts, &nextAttemptAt, &expiresAt, &smtpPhase, &leaseTok)
		if err != nil {
			t.Fatalf("failed querying retried queue row: %v", err)
		}

		if status != "pending" {
			t.Fatalf("expected status 'pending', got '%s'", status)
		}
		if smtpPhase != nil {
			t.Fatalf("expected smtp_phase to be cleared (NULL), got '%s'", *smtpPhase)
		}
		if leaseTok != nil {
			t.Fatalf("expected lease_token to be NULL, got %v", leaseTok)
		}
		// Invariant: next_attempt_at <= now() so worker can claim immediately
		if nextAttemptAt.After(time.Now().Add(5 * time.Second)) {
			t.Fatalf("expected next_attempt_at to be immediate, got %v", nextAttemptAt)
		}
		// Invariant: expires_at must be extended into future (> now() + 20 hours)
		if expiresAt.Before(time.Now().Add(20 * time.Hour)) {
			t.Fatalf("expected expires_at to be extended > 20h into future, got %v", expiresAt)
		}
		// Invariant: max_attempts must have headroom over attempts (attempts + 1 < max_attempts)
		if attempts+1 >= maxAttempts {
			t.Fatalf("expected worker claimability attempt headroom (attempts + 1 < max_attempts): attempts=%d, max_attempts=%d", attempts, maxAttempts)
		}
		if maxAttempts < 7 {
			t.Fatalf("expected max_attempts to be updated to at least attempts+2 (7), got %d", maxAttempts)
		}

		// Verify delivery_log records retrying transition
		var retryCount int
		err = pool.QueryRow(ctx, `
			SELECT COUNT(*) FROM delivery_log
			WHERE delivery_id = $1 AND status = 'retrying' AND smtp_phase = 'operator_authorized_retry'
		`, deliveryUUID).Scan(&retryCount)
		if err != nil || retryCount != 1 {
			t.Fatalf("expected 1 retrying record in delivery_log, count=%d, err=%v", retryCount, err)
		}
	})

	// Check 2: Retransmission Prevention if message has smtp_phase = 'accepted_by_mta'
	t.Run("Retransmission Blocked When Remote MTA Already Accepted", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, smtp_phase
			) VALUES (
				$1, $2, $3, $4, 'no-retransmit@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours',
				'accepted_by_mta'
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting accepted_by_mta item: %v", err)
		}

		payload := ReconcileRequest{
			Action:                     "authorize_retry",
			OperatorReason:             "Accidental retry attempt on accepted message",
			EvidenceCategory:           "ticket_transcript",
			EvidenceReference:          "TKT-DUP-01",
			DuplicateRiskAcknowledged: true,
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("CRITICAL SAFETY VIOLATION: authorize_retry succeeded on accepted_by_mta! Expected 409 Conflict, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "remote MTA has already durably accepted this message") {
			t.Fatalf("expected conflict message to cite prior durable acceptance, got: %s", rec.Body.String())
		}
	})

	// Check 3: Retransmission Prevention if delivery_log already has terminal delivered
	t.Run("Retransmission Blocked When delivery_log Already Has Delivered", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, smtp_phase
			) VALUES (
				$1, $2, $3, $4, 'log-accepted@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours',
				'terminator_in_flight'
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		// Seed a delivered row in delivery_log
		_, err = pool.Exec(ctx, `
			INSERT INTO delivery_log (
				delivery_id, mailbox_id, domain_id, recipient, direction, status, smtp_code, created_at
			) VALUES ($1, $2, $3, 'log-accepted@c65-test.local', 'outbound', 'delivered', 250, clock_timestamp())
		`, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting delivered log: %v", err)
		}

		payload := ReconcileRequest{
			Action:                     "authorize_retry",
			OperatorReason:             "Retry attempt when log indicates delivered",
			EvidenceCategory:           "ticket_transcript",
			EvidenceReference:          "TKT-DUP-02",
			DuplicateRiskAcknowledged: true,
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict due to existing delivered log, got %d. Body: %s", rec.Code, rec.Body.String())
		}
	})
}

// 15. C6.5.2 Evidence Provenance & Mutation Idempotency Tests
func TestQueueOperations_EvidenceProvenanceAndIdempotency(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Test A: Evidence Provenance Defaulting and Auditing
	t.Run("Evidence Provenance Default and Verification Flag", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at
			) VALUES (
				$1, $2, $3, $4, 'prov-test@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		// Reconcile with operator-provided reference (no provenance passed -> defaults to operator_attested)
		payload := ReconcileRequest{
			Action:             "resolve_accepted",
			OperatorReason:     "External ticket reference provided",
			ResolutionCategory: "manual_mta_verification",
			EvidenceCategory:   "mta_log_receipt",
			EvidenceReference:  "MTA-RECEIPT-8891",
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		var resp ReconcileResponse
		_ = json.NewDecoder(rec.Body).Decode(&resp)

		if resp.EvidenceProvenance != "operator_attested" {
			t.Fatalf("expected default evidence_provenance 'operator_attested', got '%s'", resp.EvidenceProvenance)
		}
		if resp.IsIndependentlyVerified {
			t.Fatalf("expected is_independently_verified to be false for operator-attested reference")
		}

		// Verify audit ledger record directly
		var dbProv string
		var dbVerified bool
		err = pool.QueryRow(ctx, `
			SELECT evidence_provenance, is_independently_verified
			FROM outbound_delivery_operator_audit
			WHERE queue_id = $1
		`, itemUUID).Scan(&dbProv, &dbVerified)
		if err != nil {
			t.Fatalf("failed querying audit record: %v", err)
		}
		if dbProv != "operator_attested" || dbVerified != false {
			t.Fatalf("unexpected audit provenance: prov=%s, verified=%v", dbProv, dbVerified)
		}

		// Verify audit endpoint returns provenance fields
		auditReq := httptest.NewRequest(http.MethodGet, "/admin/v1/queue/messages/"+itemUUID.String()+"/audit", nil)
		auditRec := httptest.NewRecorder()
		mux.ServeHTTP(auditRec, auditReq)

		if auditRec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK from audit endpoint, got %d", auditRec.Code)
		}

		var auditList struct {
			AuditTrail []OperatorAuditItem `json:"audit_trail"`
		}
		_ = json.NewDecoder(auditRec.Body).Decode(&auditList)
		if len(auditList.AuditTrail) != 1 {
			t.Fatalf("expected 1 audit item, got %d", len(auditList.AuditTrail))
		}
		if auditList.AuditTrail[0].EvidenceProvenance != "operator_attested" {
			t.Fatalf("expected audit trail item to have 'operator_attested', got '%s'", auditList.AuditTrail[0].EvidenceProvenance)
		}
	})

	// Test B: Idempotency Key Prevents Duplicate Mutations & Audit Duplication
	t.Run("Idempotency Replay on Duplicate Request", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at
			) VALUES (
				$1, $2, $3, $4, 'idemp-test@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		idempotencyKey := "idemp-key-" + uuid.New().String()

		payload := ReconcileRequest{
			Action:                     "authorize_retry",
			OperatorReason:             "Retrying with idempotency key",
			EvidenceCategory:           "ticket_transcript",
			EvidenceReference:          "TKT-IDEMP-01",
			DuplicateRiskAcknowledged: true,
			IdempotencyKey:             idempotencyKey,
		}
		bodyBytes, _ := json.Marshal(payload)

		// First execution: should succeed and mutate row to 'pending'
		req1 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		rec1 := httptest.NewRecorder()
		mux.ServeHTTP(rec1, req1)

		if rec1.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on first execution, got %d. Body: %s", rec1.Code, rec1.Body.String())
		}

		var resp1 ReconcileResponse
		_ = json.NewDecoder(rec1.Body).Decode(&resp1)
		if resp1.IdempotentReplay {
			t.Fatalf("expected first execution to NOT be idempotent replay")
		}
		firstAuditID := resp1.AuditID

		// Second execution with identical idempotency key:
		// Queue row is now 'pending' (NOT 'outcome_unknown'), but idempotency must return 200 OK replay!
		req2 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		req2.Header.Set("Idempotency-Key", idempotencyKey)
		rec2 := httptest.NewRecorder()
		mux.ServeHTTP(rec2, req2)

		if rec2.Code != http.StatusOK {
			t.Fatalf("expected 200 OK on idempotent replay, got %d. Body: %s", rec2.Code, rec2.Body.String())
		}

		var resp2 ReconcileResponse
		_ = json.NewDecoder(rec2.Body).Decode(&resp2)
		if !resp2.IdempotentReplay {
			t.Fatalf("expected second execution to have IdempotentReplay = true, got %+v", resp2)
		}
		if resp2.AuditID != firstAuditID {
			t.Fatalf("expected replay to return original audit ID '%s', got '%s'", firstAuditID, resp2.AuditID)
		}

		// Ensure exactly ONE audit record was created in the database
		var auditCount int
		err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM outbound_delivery_operator_audit WHERE idempotency_key = $1`, idempotencyKey).Scan(&auditCount)
		if err != nil || auditCount != 1 {
			t.Fatalf("expected exactly 1 audit record for idempotency key, count=%d, err=%v", auditCount, err)
		}
	})
}

// 16. C6.5.3 Bounded Manual Retry Governance Tests
func TestQueueOperations_C653_ManualRetryGovernance(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Test A: First manual retry accepted (increments manual_retry_count, resets to pending)
	t.Run("First Manual Retry Accepted", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, manual_retry_count, max_manual_retries
			) VALUES (
				$1, $2, $3, $4, 'retry-gov-1@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 2, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '12 hours', 0, 1
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		payload := ReconcileRequest{
			Action:                    "authorize_retry",
			OperatorReason:            "First authorized retry investigation",
			EvidenceCategory:          "mta_log_receipt",
			EvidenceReference:         "MTA-RECEIPT-001",
			DuplicateRiskAcknowledged: true,
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for first retry, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		var rowStatus string
		var manualRetryCount, maxManualRetries, maxAttempts int
		var expiresAt time.Time
		err = pool.QueryRow(ctx, `
			SELECT status, manual_retry_count, max_manual_retries, max_attempts, expires_at
			FROM outbound_queue WHERE id = $1
		`, itemUUID).Scan(&rowStatus, &manualRetryCount, &maxManualRetries, &maxAttempts, &expiresAt)
		if err != nil {
			t.Fatalf("failed querying updated queue item: %v", err)
		}

		if rowStatus != "pending" {
			t.Fatalf("expected status 'pending', got '%s'", rowStatus)
		}
		if manualRetryCount != 1 {
			t.Fatalf("expected manual_retry_count = 1, got %d", manualRetryCount)
		}
		if maxManualRetries != 1 {
			t.Fatalf("expected max_manual_retries = 1, got %d", maxManualRetries)
		}
		if maxAttempts < 4 {
			t.Fatalf("expected max_attempts headroom, got %d", maxAttempts)
		}
	})

	// Test B: Second manual retry rejected under default policy (409 Conflict)
	t.Run("Second Manual Retry Rejected Under Default Policy", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, manual_retry_count, max_manual_retries
			) VALUES (
				$1, $2, $3, $4, 'retry-gov-2@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 3, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '12 hours', 1, 1
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		payload := ReconcileRequest{
			Action:                    "authorize_retry",
			OperatorReason:            "Attempting second retry by support agent",
			EvidenceCategory:          "mta_log_receipt",
			EvidenceReference:         "MTA-RECEIPT-002",
			DuplicateRiskAcknowledged: true,
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict on second retry, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "manual retry limit reached") {
			t.Fatalf("expected error mentioning manual retry limit reached, got: %s", rec.Body.String())
		}
	})

	// Test C: Platform Admin Exceptional 2nd Retry & Hard Absolute Ceiling (Max 2)
	t.Run("Platform Admin Exceptional 2nd Retry and Absolute Ceiling", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, manual_retry_count, max_manual_retries
			) VALUES (
				$1, $2, $3, $4, 'retry-gov-admin@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 3, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '12 hours', 1, 1
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		payload := ReconcileRequest{
			Action:                    "authorize_retry",
			OperatorReason:            "Platform admin exceptional second retry",
			EvidenceCategory:          "mta_log_receipt",
			EvidenceReference:         "ADMIN-OVERRIDE-01",
			DuplicateRiskAcknowledged: true,
		}
		bodyBytes, _ := json.Marshal(payload)

		// Exceptional retry as platform_admin
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		req.Header.Set("X-Operator-Role", "platform_admin")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for platform_admin 2nd retry, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		var count, maxRetries int
		_ = pool.QueryRow(ctx, `SELECT manual_retry_count, max_manual_retries FROM outbound_queue WHERE id = $1`, itemUUID).Scan(&count, &maxRetries)
		if count != 2 || maxRetries != 2 {
			t.Fatalf("expected count=2 and max_manual_retries=2, got count=%d, max=%d", count, maxRetries)
		}

		// Re-simulate returning to outcome_unknown to attempt 3rd retry
		_, _ = pool.Exec(ctx, `UPDATE outbound_queue SET status = 'outcome_unknown' WHERE id = $1`, itemUUID)

		// 3rd retry attempt by platform_admin MUST be rejected (absolute ceiling reached)
		req3 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		req3.Header.Set("X-Operator-Role", "platform_admin")
		rec3 := httptest.NewRecorder()
		mux.ServeHTTP(rec3, req3)

		if rec3.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict on 3rd retry by platform_admin, got %d. Body: %s", rec3.Code, rec3.Body.String())
		}
		if !strings.Contains(rec3.Body.String(), "absolute manual retry limit reached") {
			t.Fatalf("expected error mentioning absolute manual retry limit reached, got: %s", rec3.Body.String())
		}
	})

	// Test D: Absolute 72-Hour Lifetime Ceiling
	t.Run("Absolute 72-Hour Lifetime Ceiling Rejection", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		// Created 73 hours ago
		_, err := pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, manual_retry_count, max_manual_retries
			) VALUES (
				$1, $2, $3, $4, 'retry-gov-old@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, 5, clock_timestamp() - interval '73 hours', clock_timestamp(), clock_timestamp() + interval '1 hour', 0, 1
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
		if err != nil {
			t.Fatalf("failed inserting item: %v", err)
		}

		payload := ReconcileRequest{
			Action:                    "authorize_retry",
			OperatorReason:            "Attempting retry on message past 72h lifetime",
			EvidenceCategory:          "mta_log_receipt",
			EvidenceReference:         "OLD-RECEIPT",
			DuplicateRiskAcknowledged: true,
		}
		bodyBytes, _ := json.Marshal(payload)

		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(bodyBytes))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict for message past 72h ceiling, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "72-hour lifetime ceiling") {
			t.Fatalf("expected error citing 72-hour lifetime ceiling, got: %s", rec.Body.String())
		}
	})
}

// 17. C6.5.3 Request-Bound Idempotency Isolation Tests
func TestQueueOperations_C653_RequestIdempotencyIsolation(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	sharedKey := "idemp-iso-" + uuid.New().String()

	itemUUID := uuid.New()
	deliveryUUID := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (
			id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
			status, attempts, max_attempts, created_at, next_attempt_at, expires_at
		) VALUES (
			$1, $2, $3, $4, 'idemp-iso@c65-test.local', '\x01', '\x02',
			'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
		)
	`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting item: %v", err)
	}

	origPayload := ReconcileRequest{
		Action:                    "authorize_retry",
		OperatorReason:            "Original justification",
		EvidenceCategory:          "ticket_transcript",
		EvidenceReference:         "TKT-ORIG-01",
		DuplicateRiskAcknowledged: true,
		IdempotencyKey:            sharedKey,
	}
	origBytes, _ := json.Marshal(origPayload)

	// Step 1: Initial successful operation
	req1 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(origBytes))
	req1.Header.Set("X-Operator-Id", "agent-1")
	req1.Header.Set("X-Operator-Role", "support_agent")
	req1.Header.Set("X-Operator-Email", "agent1@byos.local")
	rec1 := httptest.NewRecorder()
	mux.ServeHTTP(rec1, req1)

	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on initial request, got %d. Body: %s", rec1.Code, rec1.Body.String())
	}

	var resp1 ReconcileResponse
	_ = json.NewDecoder(rec1.Body).Decode(&resp1)
	if resp1.IdempotentReplay {
		t.Fatalf("initial request should not be idempotent replay")
	}

	// Step 2: Same key, same actor, same resource, identical payload -> 200 OK replay
	req2 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(origBytes))
	req2.Header.Set("X-Operator-Id", "agent-1")
	req2.Header.Set("X-Operator-Role", "support_agent")
	req2.Header.Set("X-Operator-Email", "agent1@byos.local")
	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on identical replay, got %d. Body: %s", rec2.Code, rec2.Body.String())
	}
	var resp2 ReconcileResponse
	_ = json.NewDecoder(rec2.Body).Decode(&resp2)
	if !resp2.IdempotentReplay || resp2.AuditID != resp1.AuditID {
		t.Fatalf("expected idempotent replay with identical audit ID")
	}

	// Step 3: Same key, different reason (payload fingerprint mismatch) -> 409 Conflict
	mismatchPayload := origPayload
	mismatchPayload.OperatorReason = "A completely different reason"
	mismatchBytes, _ := json.Marshal(mismatchPayload)

	req3 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(mismatchBytes))
	req3.Header.Set("X-Operator-Id", "agent-1")
	req3.Header.Set("X-Operator-Role", "support_agent")
	req3.Header.Set("X-Operator-Email", "agent1@byos.local")
	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, req3)

	if rec3.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on payload mismatch, got %d. Body: %s", rec3.Code, rec3.Body.String())
	}
	if !strings.Contains(rec3.Body.String(), "different request payload parameters") {
		t.Fatalf("expected conflict citing different payload, got: %s", rec3.Body.String())
	}

	// Step 4: Same key, different action -> 409 Conflict
	actionMismatchPayload := origPayload
	actionMismatchPayload.Action = "resolve_bounced"
	actionMismatchPayload.EvidenceCategory = "smtp_5xx_rejection"
	actionMismatchPayload.EvidenceReference = "550-TEST"
	actionMismatchBytes, _ := json.Marshal(actionMismatchPayload)

	req4 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(actionMismatchBytes))
	req4.Header.Set("X-Operator-Id", "agent-1")
	req4.Header.Set("X-Operator-Role", "support_agent")
	req4.Header.Set("X-Operator-Email", "agent1@byos.local")
	rec4 := httptest.NewRecorder()
	mux.ServeHTTP(rec4, req4)

	if rec4.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on action mismatch, got %d. Body: %s", rec4.Code, rec4.Body.String())
	}
	if !strings.Contains(rec4.Body.String(), "different reconciliation action") {
		t.Fatalf("expected conflict citing different action, got: %s", rec4.Body.String())
	}

	// Step 5: Same key, different queue item (cross-resource reuse) -> 409 Conflict
	otherItemUUID := uuid.New()
	_, _ = pool.Exec(ctx, `
		INSERT INTO outbound_queue (
			id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
			status, attempts, max_attempts, created_at, next_attempt_at, expires_at
		) VALUES (
			$1, $2, $3, $4, 'other-item@c65-test.local', '\x01', '\x02',
			'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
		)
	`, otherItemUUID, uuid.New(), tenant.MailboxID, tenant.DomainID)

	req5 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+otherItemUUID.String()+"/reconcile", bytes.NewReader(origBytes))
	req5.Header.Set("X-Operator-Id", "agent-1")
	req5.Header.Set("X-Operator-Role", "support_agent")
	req5.Header.Set("X-Operator-Email", "agent1@byos.local")
	rec5 := httptest.NewRecorder()
	mux.ServeHTTP(rec5, req5)

	if rec5.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict on resource mismatch, got %d. Body: %s", rec5.Code, rec5.Body.String())
	}
	if !strings.Contains(rec5.Body.String(), "different queue message") {
		t.Fatalf("expected conflict citing different queue message, got: %s", rec5.Body.String())
	}

	// Step 6: Same key, different authenticated actor -> 403 Forbidden
	req6 := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", bytes.NewReader(origBytes))
	req6.Header.Set("X-Operator-Id", "agent-2")
	req6.Header.Set("X-Operator-Role", "support_agent")
	req6.Header.Set("X-Operator-Email", "different_agent@byos.local")
	rec6 := httptest.NewRecorder()
	mux.ServeHTTP(rec6, req6)

	if rec6.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden on actor mismatch, got %d. Body: %s", rec6.Code, rec6.Body.String())
	}
	if !strings.Contains(rec6.Body.String(), "different authenticated operator") {
		t.Fatalf("expected error citing different operator, got: %s", rec6.Body.String())
	}
}

// 18. C6.5.3 Server-Controlled Evidence Provenance Tests
func TestQueueOperations_C653_ServerControlledEvidenceProvenance(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	itemUUID := uuid.New()
	deliveryUUID := uuid.New()
	_, err := pool.Exec(ctx, `
		INSERT INTO outbound_queue (
			id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
			status, attempts, max_attempts, created_at, next_attempt_at, expires_at
		) VALUES (
			$1, $2, $3, $4, 'prov-test@c65-test.local', '\x01', '\x02',
			'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
		)
	`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)
	if err != nil {
		t.Fatalf("failed inserting item: %v", err)
	}

	// Test A: Attempt to submit evidence_provenance in client JSON -> 400 Bad Request
	t.Run("Client Submitting evidence_provenance Rejected", func(t *testing.T) {
		rawJSON := `{"action":"resolve_accepted","operator_reason":"test","evidence_category":"mta_log_receipt","evidence_reference":"REF-1","evidence_provenance":"independent_verified"}`
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", strings.NewReader(rawJSON))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for client evidence_provenance, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "evidence_provenance is server-controlled") {
			t.Fatalf("expected rejection mentioning server-controlled, got: %s", rec.Body.String())
		}
	})

	// Test B: Attempt to submit is_independently_verified in client JSON -> 400 Bad Request
	t.Run("Client Submitting is_independently_verified Rejected", func(t *testing.T) {
		rawJSON := `{"action":"resolve_accepted","operator_reason":"test","evidence_category":"mta_log_receipt","evidence_reference":"REF-1","is_independently_verified":true}`
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", strings.NewReader(rawJSON))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for client is_independently_verified, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "is_independently_verified is server-controlled") {
			t.Fatalf("expected rejection mentioning server-controlled, got: %s", rec.Body.String())
		}
	})

	// Test C: Attempt resolve_accepted with insufficient evidence -> 400 Bad Request
	t.Run("resolve_accepted with Insufficient Evidence Rejected", func(t *testing.T) {
		rawJSON := `{"action":"resolve_accepted","operator_reason":"test","evidence_category":"insufficient","evidence_reference":"REF-1"}`
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", strings.NewReader(rawJSON))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for insufficient evidence on resolve_accepted, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "insufficient evidence cannot authorize acceptance") {
			t.Fatalf("expected rejection for insufficient evidence, got: %s", rec.Body.String())
		}
	})

	// Test D: Normal operator-attested evidence succeeds with server-controlled defaults
	t.Run("Normal Operator-Attested Evidence Records Correct Provenance", func(t *testing.T) {
		rawJSON := `{"action":"resolve_accepted","operator_reason":"Valid operator investigation","evidence_category":"mta_log_receipt","evidence_reference":"MTA-LOG-12345"}`
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", strings.NewReader(rawJSON))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for valid resolve_accepted, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		var resp ReconcileResponse
		_ = json.NewDecoder(rec.Body).Decode(&resp)
		if resp.EvidenceProvenance != "operator_attested" || resp.IsIndependentlyVerified != false {
			t.Fatalf("expected operator_attested and false, got %s and %v", resp.EvidenceProvenance, resp.IsIndependentlyVerified)
		}

		// Verify audit ledger row
		var audProv string
		var audVer bool
		err = pool.QueryRow(ctx, `SELECT evidence_provenance, is_independently_verified FROM outbound_delivery_operator_audit WHERE id = $1`, resp.AuditID).Scan(&audProv, &audVer)
		if err != nil || audProv != "operator_attested" || audVer != false {
			t.Fatalf("audit ledger mismatch: prov=%s ver=%v err=%v", audProv, audVer, err)
		}
	})
}

// 19. C6.5.3 Bounce-Resolution Integrity Tests
func TestQueueOperations_C653_BounceResolutionIntegrity(t *testing.T) {
	pool := setupQueueTestPool(t)
	ctx := context.Background()
	tenant := seedTestTenant(t, ctx, pool)

	mux := http.NewServeMux()
	RegisterQueueRoutes(mux, pool, dummyPassAuth)

	// Test A: Missing bounce evidence rejected with 400
	t.Run("Missing Evidence on resolve_bounced Rejected", func(t *testing.T) {
		itemUUID := uuid.New()
		_, _ = pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at
			) VALUES (
				$1, $2, $3, $4, 'bounce-missing-ev@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
			)
		`, itemUUID, uuid.New(), tenant.MailboxID, tenant.DomainID)

		rawJSON := `{"action":"resolve_bounced","operator_reason":"No evidence provided"}`
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", strings.NewReader(rawJSON))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for missing evidence on resolve_bounced, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "resolve_bounced requires authoritative bounce evidence_category") {
			t.Fatalf("expected error citing bounce evidence required, got: %s", rec.Body.String())
		}
	})

	// Test B: Overwriting durable MTA acceptance with bounce blocked with 409
	t.Run("Overwriting Durable MTA Acceptance with Bounce Blocked", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, _ = pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at, smtp_phase
			) VALUES (
				$1, $2, $3, $4, 'bounce-mta-block@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 1, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours', 'accepted_by_mta'
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)

		rawJSON := `{"action":"resolve_bounced","operator_reason":"Trying to bounce accepted message","evidence_category":"smtp_5xx_rejection","evidence_reference":"REF-550"}`
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", strings.NewReader(rawJSON))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409 Conflict when bouncing message with accepted_by_mta, got %d. Body: %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "remote MTA has already durably accepted this message") {
			t.Fatalf("expected error citing MTA already accepted, got: %s", rec.Body.String())
		}
	})

	// Test C: Valid permanent rejection resolves to bounced with terminal delivery log
	t.Run("Valid Authoritative Bounce Evidence Successfully Resolves", func(t *testing.T) {
		itemUUID := uuid.New()
		deliveryUUID := uuid.New()
		_, _ = pool.Exec(ctx, `
			INSERT INTO outbound_queue (
				id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped,
				status, attempts, max_attempts, created_at, next_attempt_at, expires_at
			) VALUES (
				$1, $2, $3, $4, 'bounce-success@c65-test.local', '\x01', '\x02',
				'outcome_unknown', 2, 5, clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '24 hours'
			)
		`, itemUUID, deliveryUUID, tenant.MailboxID, tenant.DomainID)

		rawJSON := `{"action":"resolve_bounced","operator_reason":"Confirmed user unknown NDR from target host","evidence_category":"smtp_5xx_rejection","evidence_reference":"550-5.1.1-NO-SUCH-USER"}`
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/queue/messages/"+itemUUID.String()+"/reconcile", strings.NewReader(rawJSON))
		req.Header.Set("X-Operator-Role", "support_agent")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for valid resolve_bounced, got %d. Body: %s", rec.Code, rec.Body.String())
		}

		var qStatus string
		_ = pool.QueryRow(ctx, `SELECT status FROM outbound_queue WHERE id = $1`, itemUUID).Scan(&qStatus)
		if qStatus != "bounced" {
			t.Fatalf("expected status 'bounced', got '%s'", qStatus)
		}

		var dStatus string
		var smtpCode int
		err := pool.QueryRow(ctx, `SELECT status, smtp_code FROM delivery_log WHERE delivery_id = $1 AND status = 'bounced'`, deliveryUUID).Scan(&dStatus, &smtpCode)
		if err != nil || dStatus != "bounced" || smtpCode != 550 {
			t.Fatalf("expected terminal bounce log with 550, got status=%s code=%d err=%v", dStatus, smtpCode, err)
		}
	})
}
