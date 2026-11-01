package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func TestCustomerSupportTicketLifecycleIntegration(t *testing.T) {
	testDSN := os.Getenv("TEST_DATABASE_URL")
	if testDSN == "" {
		t.Skip("TEST_DATABASE_URL not set, skipping live customer support integration test")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	require.NoError(t, err)
	defer conn.Close(ctx)

	// Ensure disposable rehearsal safety
	var dbName string
	err = conn.QueryRow(ctx, "SELECT current_database()").Scan(&dbName)
	require.NoError(t, err)
	require.Contains(t, dbName, "disposable", "safety guard: must run only against disposable database")

	// Set env for handlers
	origDSN := os.Getenv("DATABASE_URL")
	os.Setenv("DATABASE_URL", testDSN)
	defer os.Setenv("DATABASE_URL", origDSN)

	// 1. Seed test organization and customer users
	orgID := uuid.New()
	_, err = conn.Exec(ctx, `
		INSERT INTO organizations (id, name, status, seat_count, billing_cycle, subscription_status)
		VALUES ($1, 'Customer Support Test Org', 'active', 5, 'monthly', 'active')
		ON CONFLICT (id) DO NOTHING
	`, orgID)
	require.NoError(t, err)

	customer1ID := uuid.New()
	customer1Email := fmt.Sprintf("cust1_%s@byos.local", customer1ID.String()[:8])
	_, err = conn.Exec(ctx, `
		INSERT INTO users (id, org_id, email, display_name, role, status, is_active)
		VALUES ($1, $2, $3, 'Customer Alice', 'member', 'active', true)
	`, customer1ID, orgID, customer1Email)
	require.NoError(t, err)

	customer2ID := uuid.New()
	customer2Email := fmt.Sprintf("cust2_%s@byos.local", customer2ID.String()[:8])
	_, err = conn.Exec(ctx, `
		INSERT INTO users (id, org_id, email, display_name, role, status, is_active)
		VALUES ($1, $2, $3, 'Customer Bob', 'member', 'active', true)
	`, customer2ID, orgID, customer2Email)
	require.NoError(t, err)

	// Helper to create authenticated customer request with session cookie
	createAuthCustomerRequest := func(method, path string, userUUID uuid.UUID, body []byte) *http.Request {
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		// Insert active session in sessions table with token_hash for getSessionUserID
		sessionToken := "test_sess_" + userUUID.String()
		tokHash := hashToken(sessionToken)
		_, _ = conn.Exec(ctx, `
			INSERT INTO sessions (user_id, token_hash, expires_at)
			VALUES ($1, $2, NOW() + INTERVAL '1 hour')
			ON CONFLICT (token_hash) DO NOTHING
		`, userUUID, tokHash)
		req.AddCookie(&http.Cookie{
			Name:  "byos_cp_session",
			Value: sessionToken,
		})
		return req
	}

	// 2. Test Customer 1 creates a new ticket
	createPayload := map[string]string{
		"subject":      "Unable to verify domain DNS records",
		"product_area": "Control Plane",
		"category":     "issue",
		"priority":     "high",
		"body":         "I added the TXT verification record 2 hours ago, but the check still fails.",
	}
	bodyBytes, _ := json.Marshal(createPayload)
	req := createAuthCustomerRequest(http.MethodPost, "/v1/support/tickets", customer1ID, bodyBytes)
	rec := httptest.NewRecorder()

	customerSupportTicketsHandler(rec, req)
	require.Equal(t, http.StatusCreated, rec.Code, "Response: %s", rec.Body.String())

	var createResp struct {
		Ticket  CustomerTicketListItem `json:"ticket"`
		Message CustomerTicketMessage  `json:"message"`
	}
	err = json.Unmarshal(rec.Body.Bytes(), &createResp)
	require.NoError(t, err)
	require.NotEmpty(t, createResp.Ticket.ID)
	require.Contains(t, createResp.Ticket.TicketNumber, "TK-")
	require.Equal(t, "Unable to verify domain DNS records", createResp.Ticket.Subject)
	require.Equal(t, "new", createResp.Ticket.Status)
	require.Equal(t, "high", createResp.Ticket.Priority)
	require.Equal(t, "customer", createResp.Message.AuthorType)
	require.Equal(t, "Customer Alice", createResp.Message.AuthorName)

	ticketID := createResp.Ticket.ID
	ticketUUID, _ := uuid.Parse(ticketID)

	// 3. Test Customer 1 lists tickets
	req = createAuthCustomerRequest(http.MethodGet, "/v1/support/tickets", customer1ID, nil)
	rec = httptest.NewRecorder()
	customerSupportTicketsHandler(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var listResp struct {
		Tickets []CustomerTicketListItem `json:"tickets"`
		Total   int                      `json:"total"`
	}
	err = json.Unmarshal(rec.Body.Bytes(), &listResp)
	require.NoError(t, err)
	require.GreaterOrEqual(t, listResp.Total, 1)
	require.Equal(t, ticketID, listResp.Tickets[0].ID)
	require.Equal(t, 1, listResp.Tickets[0].MessageCount)

	// 4. Test Customer Isolation: Customer 2 must NOT see Customer 1's ticket in list
	req = createAuthCustomerRequest(http.MethodGet, "/v1/support/tickets", customer2ID, nil)
	rec = httptest.NewRecorder()
	customerSupportTicketsHandler(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	var listResp2 struct {
		Tickets []CustomerTicketListItem `json:"tickets"`
		Total   int                      `json:"total"`
	}
	err = json.Unmarshal(rec.Body.Bytes(), &listResp2)
	require.NoError(t, err)
	for _, tkt := range listResp2.Tickets {
		require.NotEqual(t, ticketID, tkt.ID, "Customer 2 should not see Customer 1 ticket")
	}

	// 5. Test Customer Isolation: Customer 2 cannot fetch Customer 1's ticket detail
	req = createAuthCustomerRequest(http.MethodGet, "/v1/support/tickets/"+ticketID, customer2ID, nil)
	rec = httptest.NewRecorder()
	customerSupportTicketRouter(rec, req)
	require.Equal(t, http.StatusNotFound, rec.Code, "Expected 404 for unauthorized customer access")

	// 6. Test Security / Zero-Knowledge Isolation: Internal notes must NEVER be exposed to customer
	// Insert an internal note from support staff
	agentUUID := uuid.New()
	_, err = conn.Exec(ctx, `
		INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body, visibility)
		VALUES ($1, 'agent', $2, 'Support Agent Sarah', 'INTERNAL NOTE: Checked DNS zone file manually, customer record is missing quotes.', 'internal')
	`, ticketUUID, agentUUID)
	require.NoError(t, err)

	// Insert a public agent reply
	_, err = conn.Exec(ctx, `
		INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body, visibility)
		VALUES ($1, 'agent', $2, 'Support Agent Sarah', 'Hello Alice, we checked and suggest verifying your DNS quotes.', 'public')
	`, ticketUUID, agentUUID)
	require.NoError(t, err)

	// Customer 1 fetches ticket detail
	req = createAuthCustomerRequest(http.MethodGet, "/v1/support/tickets/"+ticketID, customer1ID, nil)
	rec = httptest.NewRecorder()
	customerSupportTicketRouter(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	var detailResp CustomerTicketDetail
	err = json.Unmarshal(rec.Body.Bytes(), &detailResp)
	require.NoError(t, err)
	require.Equal(t, ticketID, detailResp.ID)
	// Must contain the initial customer message (1) + public agent reply (1) = 2 messages. Internal note must be REDACTED!
	require.Equal(t, 2, len(detailResp.Messages), "Customer must see exactly 2 public messages")
	for _, msg := range detailResp.Messages {
		require.NotContains(t, msg.Body, "INTERNAL NOTE", "CRITICAL SECURITY LEAK: Internal note visible to customer!")
	}

	// 7. Test Customer 1 adds a reply
	replyPayload := map[string]string{
		"body": "Thank you! I corrected the quotes and the DNS check succeeded.",
	}
	replyBytes, _ := json.Marshal(replyPayload)
	req = createAuthCustomerRequest(http.MethodPost, "/v1/support/tickets/"+ticketID+"/reply", customer1ID, replyBytes)
	rec = httptest.NewRecorder()
	customerSupportTicketRouter(rec, req)
	require.Equal(t, http.StatusCreated, rec.Code)

	var replyResp CustomerTicketMessage
	err = json.Unmarshal(rec.Body.Bytes(), &replyResp)
	require.NoError(t, err)
	require.Equal(t, "customer", replyResp.AuthorType)
	require.Contains(t, replyResp.Body, "corrected the quotes")

	// 8. Verify ticket detail now has 3 public messages
	req = createAuthCustomerRequest(http.MethodGet, "/v1/support/tickets/"+ticketID, customer1ID, nil)
	rec = httptest.NewRecorder()
	customerSupportTicketRouter(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	err = json.Unmarshal(rec.Body.Bytes(), &detailResp)
	require.NoError(t, err)
	require.Equal(t, 3, len(detailResp.Messages))
}
