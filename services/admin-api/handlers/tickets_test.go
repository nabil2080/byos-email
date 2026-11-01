package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestAdminTicketLifecycleIntegration(t *testing.T) {
	pool := setupAdminTestPool(t)
	ctx := context.Background()

	// 1. Fetch a real customer user and org from test db
	var customerUserID, orgID uuid.UUID
	var customerEmail string
	err := pool.QueryRow(ctx, `SELECT id, email, org_id FROM users WHERE org_id IS NOT NULL LIMIT 1`).Scan(&customerUserID, &customerEmail, &orgID)
	if err != nil {
		t.Fatalf("failed to query test user: %v", err)
	}

	// 2. Fetch seeded support agent
	var agentID uuid.UUID
	var agentName string
	err = pool.QueryRow(ctx, `SELECT id, display_name FROM support_agents WHERE is_active = true LIMIT 1`).Scan(&agentID, &agentName)
	if err != nil {
		t.Fatalf("failed to query test agent: %v", err)
	}

	// 3. Create test ticket
	ticketUUID := uuid.New()
	ticketNumber := fmt.Sprintf("TKT-TEST-%s", ticketUUID.String()[:8])
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM support_ticket_messages WHERE ticket_id = $1`, ticketUUID)
		_, _ = pool.Exec(ctx, `DELETE FROM support_tickets WHERE id = $1`, ticketUUID)
	})

	initialSubject := "Integration Test Ticket Subject"
	initialBody := "Initial customer description for integration testing"

	insertTicketSQL := `
		INSERT INTO support_tickets (id, ticket_number, customer_user_id, org_id, subject, product_area, category, priority, status)
		VALUES ($1, $2, $3, $4, $5, 'mail', 'delivery', 'normal', 'new')
	`
	if _, err := pool.Exec(ctx, insertTicketSQL, ticketUUID, ticketNumber, customerUserID, orgID, initialSubject); err != nil {
		t.Fatalf("failed to insert test ticket: %v", err)
	}

	insertMsgSQL := `
		INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body, visibility)
		VALUES ($1, 'customer', $2, 'Test Customer', $3, 'public')
	`
	if _, err := pool.Exec(ctx, insertMsgSQL, ticketUUID, customerUserID, initialBody); err != nil {
		t.Fatalf("failed to insert initial test message: %v", err)
	}

	// 4. Test handleAdminListTickets
	reqList := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets?search="+ticketNumber, nil)
	recList := httptest.NewRecorder()
	handleAdminListTickets(recList, reqList, pool)
	if recList.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from list tickets, got %d: %s", recList.Code, recList.Body.String())
	}

	var listResp struct {
		Tickets []TicketListItem `json:"tickets"`
		Total   int              `json:"total"`
	}
	if err := json.NewDecoder(recList.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}
	if listResp.Total < 1 {
		t.Fatalf("expected at least 1 ticket matching search '%s', got %d", ticketNumber, listResp.Total)
	}

	found := false
	for _, tk := range listResp.Tickets {
		if tk.ID == ticketUUID.String() {
			found = true
			if tk.CustomerEmail != customerEmail {
				t.Errorf("expected customer email %s, got %s", customerEmail, tk.CustomerEmail)
			}
			break
		}
	}
	if !found {
		t.Fatalf("test ticket not found in list response")
	}

	// 5. Test handleAdminGetTicketDetail
	reqDetail := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets/"+ticketUUID.String(), nil)
	recDetail := httptest.NewRecorder()
	handleAdminGetTicketDetail(recDetail, reqDetail, pool, ticketUUID)
	if recDetail.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from ticket detail, got %d: %s", recDetail.Code, recDetail.Body.String())
	}

	var detailResp TicketDetailResponse
	if err := json.NewDecoder(recDetail.Body).Decode(&detailResp); err != nil {
		t.Fatalf("failed to decode detail response: %v", err)
	}
	if detailResp.Ticket.ID != ticketUUID.String() {
		t.Errorf("expected ticket ID %s, got %s", ticketUUID.String(), detailResp.Ticket.ID)
	}
	if detailResp.Customer.Email != customerEmail {
		t.Errorf("expected customer metadata email %s, got %s", customerEmail, detailResp.Customer.Email)
	}
	if len(detailResp.Messages) != 1 {
		t.Errorf("expected 1 initial message, got %d", len(detailResp.Messages))
	}

	// 6. Test handleAdminAddMessage with Private Internal Note
	noteBody := `{"body":"Internal observation: customer storage is verified","visibility":"internal","author_name":"Staff Agent"}`
	reqNote := httptest.NewRequest(http.MethodPost, "/admin/v1/tickets/"+ticketUUID.String()+"/messages", bytes.NewBufferString(noteBody))
	recNote := httptest.NewRecorder()
	handleAdminAddMessage(recNote, reqNote, pool, ticketUUID)
	if recNote.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for internal note, got %d: %s", recNote.Code, recNote.Body.String())
	}

	// Assert ticket status did NOT change to pending_customer for internal note
	var statusAfterNote string
	_ = pool.QueryRow(ctx, `SELECT status FROM support_tickets WHERE id = $1`, ticketUUID).Scan(&statusAfterNote)
	if statusAfterNote != "new" {
		t.Errorf("expected status to remain 'new' after internal note, got '%s'", statusAfterNote)
	}

	// 7. Test handleAdminAddMessage with Public Response
	replyBody := `{"body":"Hello, we have updated your DNS configuration. Please retry.","visibility":"public","author_name":"Sarah Chen"}`
	reqReply := httptest.NewRequest(http.MethodPost, "/admin/v1/tickets/"+ticketUUID.String()+"/messages", bytes.NewBufferString(replyBody))
	recReply := httptest.NewRecorder()
	handleAdminAddMessage(recReply, reqReply, pool, ticketUUID)
	if recReply.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for public reply, got %d: %s", recReply.Code, recReply.Body.String())
	}

	// Assert ticket status transitioned to pending_customer and first_response_at was populated
	var statusAfterReply string
	var firstResp *time.Time
	_ = pool.QueryRow(ctx, `SELECT status, first_response_at FROM support_tickets WHERE id = $1`, ticketUUID).Scan(&statusAfterReply, &firstResp)
	if statusAfterReply != "pending_customer" {
		t.Errorf("expected status to transition to 'pending_customer', got '%s'", statusAfterReply)
	}
	if firstResp == nil {
		t.Errorf("expected first_response_at to be populated")
	}

	// 8. Test handleAdminUpdateTicket: Assign Agent & Set Status to in_progress
	updatePayload := fmt.Sprintf(`{"status":"in_progress","priority":"high","assigned_agent_id":"%s"}`, agentID.String())
	reqUpdate := httptest.NewRequest(http.MethodPatch, "/admin/v1/tickets/"+ticketUUID.String(), bytes.NewBufferString(updatePayload))
	recUpdate := httptest.NewRecorder()
	handleAdminUpdateTicket(recUpdate, reqUpdate, pool, ticketUUID)
	if recUpdate.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from update ticket, got %d: %s", recUpdate.Code, recUpdate.Body.String())
	}

	var statusUpdated, priorityUpdated string
	var assignedUpdated *uuid.UUID
	_ = pool.QueryRow(ctx, `SELECT status, priority, assigned_agent_id FROM support_tickets WHERE id = $1`, ticketUUID).Scan(&statusUpdated, &priorityUpdated, &assignedUpdated)
	if statusUpdated != "in_progress" {
		t.Errorf("expected status 'in_progress', got '%s'", statusUpdated)
	}
	if priorityUpdated != "high" {
		t.Errorf("expected priority 'high', got '%s'", priorityUpdated)
	}
	if assignedUpdated == nil || *assignedUpdated != agentID {
		t.Errorf("expected assigned agent %s, got %v", agentID.String(), assignedUpdated)
	}

	// 9. Test handleAdminSupportStats
	reqStats := httptest.NewRequest(http.MethodGet, "/admin/v1/support/stats", nil)
	recStats := httptest.NewRecorder()
	handleAdminSupportStats(recStats, reqStats, pool)
	if recStats.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from support stats, got %d", recStats.Code)
	}

	var statsResp SupportStatsResponse
	if err := json.NewDecoder(recStats.Body).Decode(&statsResp); err != nil {
		t.Fatalf("failed to decode stats: %v", err)
	}
	if statsResp.Total < 1 {
		t.Errorf("expected stats total >= 1, got %d", statsResp.Total)
	}
	if statsResp.InProgress < 1 {
		t.Errorf("expected stats in_progress >= 1, got %d", statsResp.InProgress)
	}

	// 10. Test handleAdminListAgents
	reqAgents := httptest.NewRequest(http.MethodGet, "/admin/v1/support-agents", nil)
	recAgents := httptest.NewRecorder()
	handleAdminListAgents(recAgents, reqAgents, pool)
	if recAgents.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from list agents, got %d", recAgents.Code)
	}
	var agents []SupportAgentItem
	if err := json.NewDecoder(recAgents.Body).Decode(&agents); err != nil {
		t.Fatalf("failed to decode agents: %v", err)
	}
	if len(agents) < 1 {
		t.Errorf("expected at least 1 active agent, got %d", len(agents))
	}
}
