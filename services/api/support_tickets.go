package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// CustomerTicketListItem represents a summary ticket returned to the customer
type CustomerTicketListItem struct {
	ID              string     `json:"id"`
	TicketNumber    string     `json:"ticket_number"`
	Subject         string     `json:"subject"`
	ProductArea     string     `json:"product_area"`
	Category        string     `json:"category"`
	Priority        string     `json:"priority"`
	Status          string     `json:"status"`
	FirstResponseAt *time.Time `json:"first_response_at,omitempty"`
	ResolvedAt      *time.Time `json:"resolved_at,omitempty"`
	LastActivityAt  time.Time  `json:"last_activity_at"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	MessageCount    int        `json:"message_count"`
	Snippet         string     `json:"snippet"`
}

// CustomerTicketMessage represents a single message visible to the customer (public only)
type CustomerTicketMessage struct {
	ID         string    `json:"id"`
	AuthorType string    `json:"author_type"` // "customer" or "agent"
	AuthorName string    `json:"author_name"`
	Body       string    `json:"body"`
	CreatedAt  time.Time `json:"created_at"`
}

// CustomerTicketDetail represents full ticket view for the customer
type CustomerTicketDetail struct {
	CustomerTicketListItem
	Messages    []CustomerTicketMessage `json:"messages"`
	AgentTyping bool                    `json:"agent_typing"`
}

// CreateCustomerTicketRequest contains the required payload to create a new ticket
type CreateCustomerTicketRequest struct {
	Subject     string `json:"subject"`
	ProductArea string `json:"product_area"`
	Category    string `json:"category"`
	Priority    string `json:"priority"`
	Body        string `json:"body"`
}

// CreateCustomerTicketReplyRequest contains the payload to add a customer reply
type CreateCustomerTicketReplyRequest struct {
	Body string `json:"body"`
}

func getSupportDBConnection(ctx context.Context) (*pgx.Conn, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	return pgx.Connect(ctx, dsn)
}

// customerSupportTicketsHandler handles:
// GET  /v1/support/tickets -> lists current authenticated customer's own tickets
// POST /v1/support/tickets -> creates a new ticket and initial message
func customerSupportTicketsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := getSessionUserID(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		http.Error(w, `{"error":"invalid user session"}`, http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	conn, err := getSupportDBConnection(ctx)
	if err != nil {
		log.Printf("support tickets db connection error: %v", err)
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	switch r.Method {
	case http.MethodGet:
		handleCustomerListTickets(w, r, conn, userUUID)
	case http.MethodPost:
		handleCustomerCreateTicket(w, r, conn, userUUID)
	default:
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

// customerSupportTicketRouter handles subroutes:
// GET  /v1/support/tickets/{ticket_id}
// POST /v1/support/tickets/{ticket_id}/reply
func customerSupportTicketRouter(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := getSessionUserID(r)
	if !ok {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	userUUID, err := uuid.Parse(userID)
	if err != nil {
		http.Error(w, `{"error":"invalid user session"}`, http.StatusBadRequest)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/v1/support/tickets/")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, `{"error":"ticket ID required"}`, http.StatusBadRequest)
		return
	}

	ticketUUID, err := uuid.Parse(parts[0])
	if err != nil {
		http.Error(w, `{"error":"invalid ticket ID"}`, http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	conn, err := getSupportDBConnection(ctx)
	if err != nil {
		log.Printf("support ticket detail db connection error: %v", err)
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	if len(parts) == 1 {
		if r.Method == http.MethodGet {
			handleCustomerGetTicketDetail(w, r, conn, userUUID, ticketUUID)
			return
		}
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if len(parts) == 2 && parts[1] == "reply" {
		if r.Method == http.MethodPost {
			handleCustomerAddTicketReply(w, r, conn, userUUID, ticketUUID)
			return
		}
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	if len(parts) == 2 && parts[1] == "typing" {
		if r.Method == http.MethodPost {
			handleCustomerRecordTyping(w, r, conn, userUUID, ticketUUID)
			return
		}
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
}

func handleCustomerListTickets(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, userUUID uuid.UUID) {
	querySQL := `
		SELECT 
			t.id, t.ticket_number, t.subject, t.product_area, t.category, t.priority, t.status,
			t.first_response_at, t.resolved_at, t.last_activity_at, t.created_at, t.updated_at,
			(SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.visibility = 'public') AS message_count,
			COALESCE((SELECT m.body FROM support_ticket_messages m WHERE m.ticket_id = t.id AND m.visibility = 'public' ORDER BY m.created_at DESC LIMIT 1), '') AS last_snippet
		FROM support_tickets t
		WHERE t.customer_user_id = $1
		ORDER BY t.last_activity_at DESC
	`

	rows, err := conn.Query(r.Context(), querySQL, userUUID)
	if err != nil {
		log.Printf("handleCustomerListTickets query error: %v", err)
		http.Error(w, `{"error":"failed to query tickets"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tickets := []CustomerTicketListItem{}
	for rows.Next() {
		var item CustomerTicketListItem
		var rawSnippet string
		err := rows.Scan(
			&item.ID, &item.TicketNumber, &item.Subject, &item.ProductArea, &item.Category, &item.Priority, &item.Status,
			&item.FirstResponseAt, &item.ResolvedAt, &item.LastActivityAt, &item.CreatedAt, &item.UpdatedAt,
			&item.MessageCount, &rawSnippet,
		)
		if err != nil {
			log.Printf("handleCustomerListTickets scan error: %v", err)
			continue
		}
		if len(rawSnippet) > 120 {
			item.Snippet = rawSnippet[:120] + "..."
		} else {
			item.Snippet = rawSnippet
		}
		tickets = append(tickets, item)
	}

	json.NewEncoder(w).Encode(map[string]any{
		"tickets": tickets,
		"total":   len(tickets),
	})
}

func handleCustomerCreateTicket(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, userUUID uuid.UUID) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

	if redisClient != nil {
		ctx := r.Context()
		rateKey := fmt.Sprintf("rate:support:ticket:create:%s", userUUID.String())
		cnt, err := redisClient.Incr(ctx, rateKey).Result()
		if err != nil {
			log.Printf("support tickets rate limiter error: %v", err)
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"rate limiter unavailable, please retry shortly"}`, http.StatusServiceUnavailable)
			return
		}
		if cnt == 1 {
			redisClient.Expire(ctx, rateKey, 10*time.Minute)
		}
		if cnt > 5 {
			w.Header().Set("Retry-After", "600")
			http.Error(w, `{"error":"too many tickets created, please wait before submitting another"}`, http.StatusTooManyRequests)
			return
		}
	} else if os.Getenv("BYOS_ENV") == "production" {
		w.Header().Set("Retry-After", "60")
		http.Error(w, `{"error":"rate limiter unavailable, please retry shortly"}`, http.StatusServiceUnavailable)
		return
	}

	var req CreateCustomerTicketRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request json"}`, http.StatusBadRequest)
		return
	}

	subject := strings.TrimSpace(req.Subject)
	if subject == "" {
		http.Error(w, `{"error":"subject is required"}`, http.StatusBadRequest)
		return
	}
	if len(subject) > 255 {
		subject = subject[:255]
	}

	body := strings.TrimSpace(req.Body)
	if body == "" {
		http.Error(w, `{"error":"ticket body is required"}`, http.StatusBadRequest)
		return
	}
	if len(body) > 32768 {
		http.Error(w, `{"error":"ticket body exceeds maximum allowed size (32KB)"}`, http.StatusBadRequest)
		return
	}

	productArea := strings.ToLower(strings.TrimSpace(req.ProductArea))
	switch productArea {
	case "mail", "account", "security", "domains", "storage", "calendar", "org_mgmt", "billing", "bug_report", "feature_request", "other":
		// valid
	default:
		switch productArea {
		case "control plane", "control_plane":
			productArea = "org_mgmt"
		case "webmail":
			productArea = "mail"
		case "crypto core", "crypto":
			productArea = "security"
		case "bridge / imap", "bridge", "imap":
			productArea = "mail"
		case "billing / subscription":
			productArea = "billing"
		default:
			productArea = "other"
		}
	}

	category := strings.TrimSpace(req.Category)
	if category == "" {
		category = "issue"
	}

	priority := strings.ToLower(strings.TrimSpace(req.Priority))
	switch priority {
	case "low", "normal", "high", "urgent":
		// valid
	default:
		priority = "normal"
	}

	// Fetch user details & org_id
	var userEmail, userDisplayName string
	var orgID uuid.UUID
	err := conn.QueryRow(r.Context(), `
		SELECT email, COALESCE(display_name, ''), org_id
		FROM users
		WHERE id = $1
	`, userUUID).Scan(&userEmail, &userDisplayName, &orgID)
	if err != nil {
		http.Error(w, `{"error":"user not found"}`, http.StatusUnauthorized)
		return
	}

	authorName := userDisplayName
	if authorName == "" {
		authorName = userEmail
	}

	// Generate human-friendly unique ticket number e.g. TK-20261031-A1B2
	ticketNumber := fmt.Sprintf("TK-%s-%s", time.Now().UTC().Format("20060102"), strings.ToUpper(uuid.New().String()[:4]))

	// Perform atomic insertion of ticket + initial message
	tx, err := conn.Begin(r.Context())
	if err != nil {
		log.Printf("handleCustomerCreateTicket begin tx error: %v", err)
		http.Error(w, `{"error":"failed to create ticket"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	var createdTicket CustomerTicketListItem
	insertTicketSQL := `
		INSERT INTO support_tickets (
			ticket_number, customer_user_id, org_id, subject, product_area, category, priority, status, last_activity_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, 'new', NOW()
		)
		RETURNING id, ticket_number, subject, product_area, category, priority, status, last_activity_at, created_at, updated_at
	`
	err = tx.QueryRow(r.Context(), insertTicketSQL,
		ticketNumber, userUUID, orgID, subject, productArea, category, priority,
	).Scan(
		&createdTicket.ID, &createdTicket.TicketNumber, &createdTicket.Subject,
		&createdTicket.ProductArea, &createdTicket.Category, &createdTicket.Priority, &createdTicket.Status,
		&createdTicket.LastActivityAt, &createdTicket.CreatedAt, &createdTicket.UpdatedAt,
	)
	if err != nil {
		log.Printf("handleCustomerCreateTicket insert ticket error: %v", err)
		http.Error(w, `{"error":"failed to save ticket"}`, http.StatusInternalServerError)
		return
	}

	var createdMsg CustomerTicketMessage
	insertMsgSQL := `
		INSERT INTO support_ticket_messages (
			ticket_id, author_type, author_id, author_name, body, visibility
		) VALUES (
			$1, 'customer', $2, $3, $4, 'public'
		)
		RETURNING id, author_type, author_name, body, created_at
	`
	createdTicketUUID, _ := uuid.Parse(createdTicket.ID)
	err = tx.QueryRow(r.Context(), insertMsgSQL,
		createdTicketUUID, userUUID, authorName, body,
	).Scan(
		&createdMsg.ID, &createdMsg.AuthorType, &createdMsg.AuthorName, &createdMsg.Body, &createdMsg.CreatedAt,
	)
	if err != nil {
		log.Printf("handleCustomerCreateTicket insert message error: %v", err)
		http.Error(w, `{"error":"failed to save ticket message"}`, http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		log.Printf("handleCustomerCreateTicket commit error: %v", err)
		http.Error(w, `{"error":"failed to commit ticket"}`, http.StatusInternalServerError)
		return
	}

	createdTicket.MessageCount = 1
	if len(body) > 120 {
		createdTicket.Snippet = body[:120] + "..."
	} else {
		createdTicket.Snippet = body
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]any{
		"ticket":  createdTicket,
		"message": createdMsg,
	})
}

func handleCustomerGetTicketDetail(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, userUUID uuid.UUID, ticketUUID uuid.UUID) {
	var detail CustomerTicketDetail
	ticketSQL := `
		SELECT 
			id, ticket_number, subject, product_area, category, priority, status,
			first_response_at, resolved_at, last_activity_at, created_at, updated_at,
			(agent_typing_at IS NOT NULL AND agent_typing_at > now() - interval '6 seconds') AS is_agent_typing
		FROM support_tickets
		WHERE id = $1 AND customer_user_id = $2
	`
	err := conn.QueryRow(r.Context(), ticketSQL, ticketUUID, userUUID).Scan(
		&detail.ID, &detail.TicketNumber, &detail.Subject, &detail.ProductArea, &detail.Category, &detail.Priority, &detail.Status,
		&detail.FirstResponseAt, &detail.ResolvedAt, &detail.LastActivityAt, &detail.CreatedAt, &detail.UpdatedAt,
		&detail.AgentTyping,
	)
	if err != nil {
		// Strict isolation: return 404 if ticket belongs to another customer or does not exist
		http.Error(w, `{"error":"ticket not found"}`, http.StatusNotFound)
		return
	}

	// CRITICAL SECURITY RULE: Only retrieve messages where visibility = 'public'.
	// Support internal notes (visibility = 'internal') must NEVER be exposed to customer!
	msgSQL := `
		SELECT id, author_type, author_name, body, created_at
		FROM support_ticket_messages
		WHERE ticket_id = $1 AND visibility = 'public'
		ORDER BY created_at ASC
	`
	rows, err := conn.Query(r.Context(), msgSQL, ticketUUID)
	if err != nil {
		log.Printf("handleCustomerGetTicketDetail query messages error: %v", err)
		http.Error(w, `{"error":"failed to query ticket messages"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := []CustomerTicketMessage{}
	for rows.Next() {
		var msg CustomerTicketMessage
		if err := rows.Scan(&msg.ID, &msg.AuthorType, &msg.AuthorName, &msg.Body, &msg.CreatedAt); err == nil {
			messages = append(messages, msg)
		}
	}
	detail.Messages = messages
	detail.MessageCount = len(messages)
	if len(messages) > 0 {
		detail.Snippet = messages[len(messages)-1].Body
	}

	json.NewEncoder(w).Encode(detail)
}

func handleCustomerAddTicketReply(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, userUUID uuid.UUID, ticketUUID uuid.UUID) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)

	if redisClient != nil {
		ctx := r.Context()
		rateKey := fmt.Sprintf("rate:support:ticket:reply:%s", userUUID.String())
		cnt, err := redisClient.Incr(ctx, rateKey).Result()
		if err != nil {
			log.Printf("support tickets reply rate limiter error: %v", err)
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"rate limiter unavailable, please retry shortly"}`, http.StatusServiceUnavailable)
			return
		}
		if cnt == 1 {
			redisClient.Expire(ctx, rateKey, time.Minute)
		}
		if cnt > 15 {
			w.Header().Set("Retry-After", "60")
			http.Error(w, `{"error":"reply rate limit exceeded, please slow down"}`, http.StatusTooManyRequests)
			return
		}
	} else if os.Getenv("BYOS_ENV") == "production" {
		w.Header().Set("Retry-After", "60")
		http.Error(w, `{"error":"rate limiter unavailable, please retry shortly"}`, http.StatusServiceUnavailable)
		return
	}

	var req CreateCustomerTicketReplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request json"}`, http.StatusBadRequest)
		return
	}

	body := strings.TrimSpace(req.Body)
	if body == "" {
		http.Error(w, `{"error":"reply body is required"}`, http.StatusBadRequest)
		return
	}
	if len(body) > 32768 {
		http.Error(w, `{"error":"reply body exceeds maximum allowed size (32KB)"}`, http.StatusBadRequest)
		return
	}

	// Verify customer owns the ticket
	var currentStatus string
	err := conn.QueryRow(r.Context(), `
		SELECT status
		FROM support_tickets
		WHERE id = $1 AND customer_user_id = $2
	`, ticketUUID, userUUID).Scan(&currentStatus)
	if err != nil {
		http.Error(w, `{"error":"ticket not found"}`, http.StatusNotFound)
		return
	}

	// Fetch customer's display name or email
	var userEmail, userDisplayName string
	err = conn.QueryRow(r.Context(), `
		SELECT email, COALESCE(display_name, '')
		FROM users
		WHERE id = $1
	`, userUUID).Scan(&userEmail, &userDisplayName)
	if err != nil {
		http.Error(w, `{"error":"user not found"}`, http.StatusUnauthorized)
		return
	}

	authorName := userDisplayName
	if authorName == "" {
		authorName = userEmail
	}

	tx, err := conn.Begin(r.Context())
	if err != nil {
		log.Printf("handleCustomerAddTicketReply begin tx error: %v", err)
		http.Error(w, `{"error":"failed to add reply"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	var createdMsg CustomerTicketMessage
	insertMsgSQL := `
		INSERT INTO support_ticket_messages (
			ticket_id, author_type, author_id, author_name, body, visibility
		) VALUES (
			$1, 'customer', $2, $3, $4, 'public'
		)
		RETURNING id, author_type, author_name, body, created_at
	`
	err = tx.QueryRow(r.Context(), insertMsgSQL,
		ticketUUID, userUUID, authorName, body,
	).Scan(
		&createdMsg.ID, &createdMsg.AuthorType, &createdMsg.AuthorName, &createdMsg.Body, &createdMsg.CreatedAt,
	)
	if err != nil {
		log.Printf("handleCustomerAddTicketReply insert message error: %v", err)
		http.Error(w, `{"error":"failed to save reply message"}`, http.StatusInternalServerError)
		return
	}

	// If ticket was resolved or closed, a customer reply reopens it to in_progress. Otherwise keep active status.
	newStatus := currentStatus
	if currentStatus == "resolved" || currentStatus == "closed" || currentStatus == "pending_customer" {
		newStatus = "in_progress"
	}

	updateTicketSQL := `
		UPDATE support_tickets
		SET status = $1, customer_typing_at = NULL, last_activity_at = NOW(), updated_at = NOW()
		WHERE id = $2
	`
	_, err = tx.Exec(r.Context(), updateTicketSQL, newStatus, ticketUUID)
	if err != nil {
		log.Printf("handleCustomerAddTicketReply update ticket error: %v", err)
		http.Error(w, `{"error":"failed to update ticket status"}`, http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		log.Printf("handleCustomerAddTicketReply commit error: %v", err)
		http.Error(w, `{"error":"failed to commit reply"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(createdMsg)
}

func handleCustomerRecordTyping(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, userUUID uuid.UUID, ticketUUID uuid.UUID) {
	_, err := conn.Exec(r.Context(), `
		UPDATE support_tickets
		SET customer_typing_at = now()
		WHERE id = $1 AND customer_user_id = $2
	`, ticketUUID, userUUID)
	if err != nil {
		log.Printf("handleCustomerRecordTyping error: %v", err)
		http.Error(w, `{"error":"failed to update typing state"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}
