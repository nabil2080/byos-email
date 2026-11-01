package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TicketListItem struct {
	ID                string     `json:"id"`
	TicketNumber      string     `json:"ticket_number"`
	CustomerUserID    string     `json:"customer_user_id"`
	CustomerEmail     string     `json:"customer_email"`
	OrgID             *string    `json:"org_id,omitempty"`
	OrgName           *string    `json:"org_name,omitempty"`
	Subject           string     `json:"subject"`
	ProductArea       string     `json:"product_area"`
	Category          string     `json:"category"`
	Priority          string     `json:"priority"`
	Status            string     `json:"status"`
	AssignedAgentID   *string    `json:"assigned_agent_id,omitempty"`
	AssignedAgentName *string    `json:"assigned_agent_name,omitempty"`
	FirstResponseAt   *time.Time `json:"first_response_at,omitempty"`
	ResolvedAt        *time.Time `json:"resolved_at,omitempty"`
	LastActivityAt    time.Time  `json:"last_activity_at"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
	MessageCount      int        `json:"message_count"`
	Snippet           string     `json:"snippet"`
}

type TicketMessageItem struct {
	ID         string    `json:"id"`
	TicketID   string    `json:"ticket_id"`
	AuthorType string    `json:"author_type"` // customer, agent, system
	AuthorID   string    `json:"author_id"`
	AuthorName string    `json:"author_name"`
	Body       string    `json:"body"`
	Visibility string    `json:"visibility"` // public, internal
	CreatedAt  time.Time `json:"created_at"`
}

type CustomerMetadata struct {
	UserID        string    `json:"user_id"`
	Email         string    `json:"email"`
	DisplayName   string    `json:"display_name"`
	AccountStatus string    `json:"account_status"`
	CreatedAt     time.Time `json:"created_at"`
	OrgID         *string   `json:"org_id,omitempty"`
	OrgName       *string   `json:"org_name,omitempty"`
	OrgPlan       *string   `json:"org_plan,omitempty"`
	OrgStatus     *string   `json:"org_status,omitempty"`
	SeatCount     int       `json:"seat_count"`
	MailboxCount  int       `json:"mailbox_count"`
	StorageUsed   int64     `json:"storage_used"`
	TicketCount   int       `json:"ticket_count"`
}

type TicketDetailResponse struct {
	Ticket         TicketListItem      `json:"ticket"`
	Customer       CustomerMetadata    `json:"customer"`
	Messages       []TicketMessageItem `json:"messages"`
	CustomerTyping bool                `json:"customer_typing"`
}

type SupportAgentItem struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
	IsActive    bool      `json:"is_active"`
	CreatedAt   time.Time `json:"created_at"`
}

type SupportStatsResponse struct {
	Total           int `json:"total"`
	New             int `json:"new"`
	Open            int `json:"open"`
	Unassigned      int `json:"unassigned"`
	InProgress      int `json:"in_progress"`
	PendingCustomer int `json:"pending_customer"`
	Resolved        int `json:"resolved"`
	Closed          int `json:"closed"`
	HighPriority    int `json:"high_priority"`
}

// RegisterTicketRoutes registers staff ticket management endpoints
func RegisterTicketRoutes(mux *http.ServeMux, db *pgxpool.Pool, authMiddleware func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("/admin/v1/tickets", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleAdminListTickets(w, r, db)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/admin/v1/tickets/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/admin/v1/tickets/")
		parts := strings.Split(strings.Trim(path, "/"), "/")

		if len(parts) == 0 || parts[0] == "" {
			http.Error(w, "Ticket ID required", http.StatusBadRequest)
			return
		}

		ticketIDStr := parts[0]
		ticketUUID, err := uuid.Parse(ticketIDStr)
		if err != nil {
			http.Error(w, "Invalid Ticket UUID", http.StatusBadRequest)
			return
		}

		if len(parts) == 1 {
			switch r.Method {
			case http.MethodGet:
				handleAdminGetTicketDetail(w, r, db, ticketUUID)
			case http.MethodPatch, http.MethodPut, http.MethodPost:
				handleAdminUpdateTicket(w, r, db, ticketUUID)
			default:
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}

		subAction := parts[1]
		switch subAction {
		case "messages":
			if r.Method == http.MethodPost {
				handleAdminAddMessage(w, r, db, ticketUUID)
			} else if r.Method == http.MethodGet {
				handleAdminGetTicketMessages(w, r, db, ticketUUID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		case "typing":
			if r.Method == http.MethodPost {
				handleAdminRecordTyping(w, r, db, ticketUUID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		default:
			http.Error(w, "Unknown ticket sub-action", http.StatusNotFound)
		}
	}))

	mux.HandleFunc("/admin/v1/support-agents", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleAdminListAgents(w, r, db)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/admin/v1/support/stats", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleAdminSupportStats(w, r, db)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))
}

func handleAdminListTickets(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		json.NewEncoder(w).Encode(map[string]any{"tickets": []TicketListItem{}, "total": 0})
		return
	}

	query := r.URL.Query()
	statusFilter := query.Get("status")
	priorityFilter := query.Get("priority")
	assignedFilter := query.Get("assigned_to")
	searchQuery := strings.TrimSpace(query.Get("search"))

	page := 1
	if p, err := strconv.Atoi(query.Get("page")); err == nil && p > 0 {
		page = p
	}
	limit := 25
	if l, err := strconv.Atoi(query.Get("limit")); err == nil && l > 0 && l <= 100 {
		limit = l
	}
	offset := (page - 1) * limit

	var whereClauses []string
	var args []any
	argIdx := 1

	if statusFilter != "" && statusFilter != "all" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	if priorityFilter != "" && priorityFilter != "all" {
		whereClauses = append(whereClauses, fmt.Sprintf("t.priority = $%d", argIdx))
		args = append(args, priorityFilter)
		argIdx++
	}

	if assignedFilter == "unassigned" {
		whereClauses = append(whereClauses, "t.assigned_agent_id IS NULL")
	} else if assignedFilter != "" && assignedFilter != "all" {
		if agentUUID, err := uuid.Parse(assignedFilter); err == nil {
			whereClauses = append(whereClauses, fmt.Sprintf("t.assigned_agent_id = $%d", argIdx))
			args = append(args, agentUUID)
			argIdx++
		}
	}

	if searchQuery != "" {
		searchPattern := "%" + searchQuery + "%"
		whereClauses = append(whereClauses, fmt.Sprintf("(t.ticket_number ILIKE $%d OR t.subject ILIKE $%d OR u.email ILIKE $%d)", argIdx, argIdx, argIdx))
		args = append(args, searchPattern)
		argIdx++
	}

	whereSQL := ""
	if len(whereClauses) > 0 {
		whereSQL = "WHERE " + strings.Join(whereClauses, " AND ")
	}

	// Count total matching
	countSQL := fmt.Sprintf(`
		SELECT COUNT(*)
		FROM support_tickets t
		JOIN users u ON t.customer_user_id = u.id
		LEFT JOIN organizations o ON t.org_id = o.id
		LEFT JOIN support_agents a ON t.assigned_agent_id = a.id
		%s
	`, whereSQL)

	var totalCount int
	err := db.QueryRow(r.Context(), countSQL, args...).Scan(&totalCount)
	if err != nil {
		log.Printf("handleAdminListTickets count error: %v", err)
		http.Error(w, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}

	// Fetch page
	listSQL := fmt.Sprintf(`
		SELECT 
			t.id, t.ticket_number, t.customer_user_id, u.email,
			t.org_id, o.name,
			t.subject, t.product_area, t.category, t.priority, t.status,
			t.assigned_agent_id, a.display_name,
			t.first_response_at, t.resolved_at, t.last_activity_at,
			t.created_at, t.updated_at,
			COALESCE((SELECT COUNT(*) FROM support_ticket_messages m WHERE m.ticket_id = t.id), 0) AS message_count,
			COALESCE((SELECT m.body FROM support_ticket_messages m WHERE m.ticket_id = t.id ORDER BY m.created_at ASC LIMIT 1), '') AS snippet
		FROM support_tickets t
		JOIN users u ON t.customer_user_id = u.id
		LEFT JOIN organizations o ON t.org_id = o.id
		LEFT JOIN support_agents a ON t.assigned_agent_id = a.id
		%s
		ORDER BY t.last_activity_at DESC
		LIMIT $%d OFFSET $%d
	`, whereSQL, argIdx, argIdx+1)

	args = append(args, limit, offset)

	rows, err := db.Query(r.Context(), listSQL, args...)
	if err != nil {
		log.Printf("handleAdminListTickets list error: %v", err)
		http.Error(w, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	tickets := []TicketListItem{}
	for rows.Next() {
		var item TicketListItem
		var orgID, orgName, assignedID, assignedName *string
		var firstResp, resolved *time.Time
		var rawSnippet string

		err := rows.Scan(
			&item.ID, &item.TicketNumber, &item.CustomerUserID, &item.CustomerEmail,
			&orgID, &orgName,
			&item.Subject, &item.ProductArea, &item.Category, &item.Priority, &item.Status,
			&assignedID, &assignedName,
			&firstResp, &resolved, &item.LastActivityAt,
			&item.CreatedAt, &item.UpdatedAt,
			&item.MessageCount, &rawSnippet,
		)
		if err != nil {
			log.Printf("handleAdminListTickets scan error: %v", err)
			continue
		}

		item.OrgID = orgID
		item.OrgName = orgName
		item.AssignedAgentID = assignedID
		item.AssignedAgentName = assignedName
		item.FirstResponseAt = firstResp
		item.ResolvedAt = resolved
		if len(rawSnippet) > 140 {
			item.Snippet = rawSnippet[:140] + "..."
		} else {
			item.Snippet = rawSnippet
		}

		tickets = append(tickets, item)
	}

	json.NewEncoder(w).Encode(map[string]any{
		"tickets": tickets,
		"total":   totalCount,
		"page":    page,
		"limit":   limit,
	})
}

func handleAdminGetTicketDetail(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, ticketID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	// 1. Query ticket item
	var item TicketListItem
	var orgID, orgName, assignedID, assignedName *string
	var firstResp, resolved *time.Time
	var customerTyping bool

	ticketSQL := `
		SELECT 
			t.id, t.ticket_number, t.customer_user_id, u.email,
			t.org_id, o.name,
			t.subject, t.product_area, t.category, t.priority, t.status,
			t.assigned_agent_id, a.display_name,
			t.first_response_at, t.resolved_at, t.last_activity_at,
			t.created_at, t.updated_at,
			(t.customer_typing_at IS NOT NULL AND t.customer_typing_at > now() - interval '6 seconds') AS is_customer_typing
		FROM support_tickets t
		JOIN users u ON t.customer_user_id = u.id
		LEFT JOIN organizations o ON t.org_id = o.id
		LEFT JOIN support_agents a ON t.assigned_agent_id = a.id
		WHERE t.id = $1
	`
	err := db.QueryRow(r.Context(), ticketSQL, ticketID).Scan(
		&item.ID, &item.TicketNumber, &item.CustomerUserID, &item.CustomerEmail,
		&orgID, &orgName,
		&item.Subject, &item.ProductArea, &item.Category, &item.Priority, &item.Status,
		&assignedID, &assignedName,
		&firstResp, &resolved, &item.LastActivityAt,
		&item.CreatedAt, &item.UpdatedAt,
		&customerTyping,
	)
	if err != nil {
		http.Error(w, `{"error":"ticket not found"}`, http.StatusNotFound)
		return
	}
	item.OrgID = orgID
	item.OrgName = orgName
	item.AssignedAgentID = assignedID
	item.AssignedAgentName = assignedName
	item.FirstResponseAt = firstResp
	item.ResolvedAt = resolved

	// 2. Query customer metadata
	var cust CustomerMetadata
	customerSQL := `
		SELECT 
			u.id, u.email, COALESCE(u.display_name, ''),
			CASE WHEN u.is_active THEN 'active' ELSE 'inactive' END,
			u.created_at,
			o.id, o.name, COALESCE(o.subscription_status, 'active'), COALESCE(o.status, 'active'),
			COALESCE(o.seat_count, 1),
			COALESCE((SELECT COUNT(*) FROM mailboxes mb WHERE mb.org_id = o.id), 0),
			COALESCE((SELECT COALESCE(SUM(sc.used_bytes), 0) FROM storage_connections sc WHERE sc.org_id = o.id), 0),
			COALESCE((SELECT COUNT(*) FROM support_tickets st WHERE st.customer_user_id = u.id), 0)
		FROM users u
		LEFT JOIN organizations o ON u.org_id = o.id
		WHERE u.id = $1
	`
	custUserID, _ := uuid.Parse(item.CustomerUserID)
	var custOrgID, custOrgName, custOrgPlan, custOrgStatus *string
	err = db.QueryRow(r.Context(), customerSQL, custUserID).Scan(
		&cust.UserID, &cust.Email, &cust.DisplayName,
		&cust.AccountStatus, &cust.CreatedAt,
		&custOrgID, &custOrgName, &custOrgPlan, &custOrgStatus,
		&cust.SeatCount, &cust.MailboxCount, &cust.StorageUsed, &cust.TicketCount,
	)
	if err == nil {
		cust.OrgID = custOrgID
		cust.OrgName = custOrgName
		cust.OrgPlan = custOrgPlan
		cust.OrgStatus = custOrgStatus
	}

	// 3. Query all messages (both public and internal notes for staff)
	messagesSQL := `
		SELECT id, ticket_id, author_type, author_id, author_name, body, visibility, created_at
		FROM support_ticket_messages
		WHERE ticket_id = $1
		ORDER BY created_at ASC
	`
	msgRows, err := db.Query(r.Context(), messagesSQL, ticketID)
	messages := []TicketMessageItem{}
	if err == nil {
		defer msgRows.Close()
		for msgRows.Next() {
			var msg TicketMessageItem
			if err := msgRows.Scan(&msg.ID, &msg.TicketID, &msg.AuthorType, &msg.AuthorID, &msg.AuthorName, &msg.Body, &msg.Visibility, &msg.CreatedAt); err == nil {
				messages = append(messages, msg)
			}
		}
	}
	item.MessageCount = len(messages)

	json.NewEncoder(w).Encode(TicketDetailResponse{
		Ticket:         item,
		Customer:       cust,
		Messages:       messages,
		CustomerTyping: customerTyping,
	})
}

func handleAdminGetTicketMessages(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, ticketID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	messagesSQL := `
		SELECT id, ticket_id, author_type, author_id, author_name, body, visibility, created_at
		FROM support_ticket_messages
		WHERE ticket_id = $1
		ORDER BY created_at ASC
	`
	rows, err := db.Query(r.Context(), messagesSQL, ticketID)
	if err != nil {
		http.Error(w, `{"error":"failed to query messages"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	messages := []TicketMessageItem{}
	for rows.Next() {
		var msg TicketMessageItem
		if err := rows.Scan(&msg.ID, &msg.TicketID, &msg.AuthorType, &msg.AuthorID, &msg.AuthorName, &msg.Body, &msg.Visibility, &msg.CreatedAt); err == nil {
			messages = append(messages, msg)
		}
	}

	json.NewEncoder(w).Encode(messages)
}

func handleAdminAddMessage(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, ticketID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Body       string  `json:"body"`
		Visibility string  `json:"visibility"` // "public" or "internal"
		AuthorID   *string `json:"author_id,omitempty"`
		AuthorName *string `json:"author_name,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Body) == "" {
		http.Error(w, `{"error":"message body cannot be empty"}`, http.StatusBadRequest)
		return
	}

	visibility := "public"
	if strings.ToLower(req.Visibility) == "internal" {
		visibility = "internal"
	}

	authorName := "Support Agent"
	if req.AuthorName != nil && strings.TrimSpace(*req.AuthorName) != "" {
		authorName = strings.TrimSpace(*req.AuthorName)
	}

	authorUUID := uuid.New()
	if req.AuthorID != nil {
		if parsed, err := uuid.Parse(*req.AuthorID); err == nil {
			authorUUID = parsed
		}
	}

	// Begin transaction
	tx, err := db.Begin(r.Context())
	if err != nil {
		http.Error(w, `{"error":"transaction start failed"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	// Insert message
	var msgID uuid.UUID
	var createdAt time.Time
	insertMsgSQL := `
		INSERT INTO support_ticket_messages (ticket_id, author_type, author_id, author_name, body, visibility)
		VALUES ($1, 'agent', $2, $3, $4, $5)
		RETURNING id, created_at
	`
	err = tx.QueryRow(r.Context(), insertMsgSQL, ticketID, authorUUID, authorName, req.Body, visibility).Scan(&msgID, &createdAt)
	if err != nil {
		log.Printf("insert message error: %v", err)
		http.Error(w, `{"error":"failed to insert message"}`, http.StatusInternalServerError)
		return
	}

	// Update ticket timestamps and status
	if visibility == "public" {
		updateTicketSQL := `
			UPDATE support_tickets
			SET 
				status = CASE 
					WHEN status IN ('resolved', 'closed') THEN status 
					ELSE 'pending_customer' 
				END,
				first_response_at = COALESCE(first_response_at, now()),
				agent_typing_at = NULL,
				last_activity_at = now(),
				updated_at = now()
			WHERE id = $1
		`
		if _, err := tx.Exec(r.Context(), updateTicketSQL, ticketID); err != nil {
			log.Printf("update ticket public message error: %v", err)
		}
	} else {
		// Internal note updates last_activity_at without changing customer-facing status
		updateTicketSQL := `
			UPDATE support_tickets
			SET last_activity_at = now(), updated_at = now()
			WHERE id = $1
		`
		if _, err := tx.Exec(r.Context(), updateTicketSQL, ticketID); err != nil {
			log.Printf("update ticket internal note error: %v", err)
		}
	}

	// Write immutable audit log
	actionType := "agent_public_reply"
	if visibility == "internal" {
		actionType = "agent_internal_note"
	}
	metaJSON, _ := json.Marshal(map[string]any{
		"ticket_id":  ticketID.String(),
		"message_id": msgID.String(),
		"visibility": visibility,
		"author":     authorName,
	})
	_, _ = tx.Exec(r.Context(), `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, metadata)
		VALUES ($1, $1, $2, $3)
	`, authorUUID, actionType, metaJSON)

	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, `{"error":"failed to commit transaction"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(TicketMessageItem{
		ID:         msgID.String(),
		TicketID:   ticketID.String(),
		AuthorType: "agent",
		AuthorID:   authorUUID.String(),
		AuthorName: authorName,
		Body:       req.Body,
		Visibility: visibility,
		CreatedAt:  createdAt,
	})
}

func handleAdminUpdateTicket(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, ticketID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	var req struct {
		Status          *string `json:"status,omitempty"`
		Priority        *string `json:"priority,omitempty"`
		AssignedAgentID *string `json:"assigned_agent_id,omitempty"`
		Reason          string  `json:"reason,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid request payload"}`, http.StatusBadRequest)
		return
	}

	tx, err := db.Begin(r.Context())
	if err != nil {
		http.Error(w, `{"error":"transaction failed"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	// Retrieve current ticket status
	var currentStatus, currentPriority string
	var currentAssigned *uuid.UUID
	err = tx.QueryRow(r.Context(), `SELECT status, priority, assigned_agent_id FROM support_tickets WHERE id = $1`, ticketID).Scan(&currentStatus, &currentPriority, &currentAssigned)
	if err != nil {
		http.Error(w, `{"error":"ticket not found"}`, http.StatusNotFound)
		return
	}

	updates := []string{"last_activity_at = now()", "updated_at = now()"}
	var args []any
	args = append(args, ticketID)
	argIdx := 2

	auditChanges := map[string]any{"ticket_id": ticketID.String()}

	if req.Status != nil && *req.Status != "" {
		newStatus := strings.ToLower(strings.TrimSpace(*req.Status))
		validStatuses := map[string]bool{"new": true, "open": true, "pending_customer": true, "in_progress": true, "resolved": true, "closed": true}
		if !validStatuses[newStatus] {
			http.Error(w, `{"error":"invalid ticket status"}`, http.StatusBadRequest)
			return
		}
		updates = append(updates, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, newStatus)
		argIdx++
		auditChanges["status_from"] = currentStatus
		auditChanges["status_to"] = newStatus

		if newStatus == "resolved" && currentStatus != "resolved" {
			updates = append(updates, "resolved_at = now()")
		} else if newStatus == "closed" && currentStatus != "closed" {
			updates = append(updates, "closed_at = now()")
		}
	}

	if req.Priority != nil && *req.Priority != "" {
		newPriority := strings.ToLower(strings.TrimSpace(*req.Priority))
		validPriorities := map[string]bool{"low": true, "normal": true, "high": true, "urgent": true}
		if !validPriorities[newPriority] {
			http.Error(w, `{"error":"invalid ticket priority"}`, http.StatusBadRequest)
			return
		}
		updates = append(updates, fmt.Sprintf("priority = $%d", argIdx))
		args = append(args, newPriority)
		argIdx++
		auditChanges["priority_from"] = currentPriority
		auditChanges["priority_to"] = newPriority
	}

	if req.AssignedAgentID != nil {
		if *req.AssignedAgentID == "" || *req.AssignedAgentID == "unassigned" {
			updates = append(updates, "assigned_agent_id = NULL")
			auditChanges["assigned_to"] = "unassigned"
		} else {
			assignedUUID, err := uuid.Parse(*req.AssignedAgentID)
			if err != nil {
				http.Error(w, `{"error":"invalid assigned_agent_id"}`, http.StatusBadRequest)
				return
			}
			updates = append(updates, fmt.Sprintf("assigned_agent_id = $%d", argIdx))
			args = append(args, assignedUUID)
			argIdx++
			auditChanges["assigned_to"] = assignedUUID.String()
		}
	}

	updateSQL := fmt.Sprintf("UPDATE support_tickets SET %s WHERE id = $1", strings.Join(updates, ", "))
	if _, err := tx.Exec(r.Context(), updateSQL, args...); err != nil {
		log.Printf("update ticket failed: %v", err)
		http.Error(w, `{"error":"failed to update ticket"}`, http.StatusInternalServerError)
		return
	}

	// Insert audit record
	actorUUID := uuid.New()
	metaJSON, _ := json.Marshal(auditChanges)
	_, _ = tx.Exec(r.Context(), `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, metadata)
		VALUES ($1, $1, 'ticket_state_update', $2)
	`, actorUUID, metaJSON)

	if err := tx.Commit(r.Context()); err != nil {
		http.Error(w, `{"error":"failed to commit update"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]any{
		"success": true,
		"message": "Ticket updated successfully",
		"changes": auditChanges,
	})
}

func handleAdminListAgents(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		json.NewEncoder(w).Encode([]SupportAgentItem{})
		return
	}

	rows, err := db.Query(r.Context(), `
		SELECT id, email, display_name, role, is_active, created_at
		FROM support_agents
		WHERE is_active = true
		ORDER BY display_name ASC
	`)
	if err != nil {
		http.Error(w, `{"error":"failed to query support agents"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	agents := []SupportAgentItem{}
	for rows.Next() {
		var a SupportAgentItem
		if err := rows.Scan(&a.ID, &a.Email, &a.DisplayName, &a.Role, &a.IsActive, &a.CreatedAt); err == nil {
			agents = append(agents, a)
		}
	}

	json.NewEncoder(w).Encode(agents)
}

func handleAdminSupportStats(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		json.NewEncoder(w).Encode(SupportStatsResponse{})
		return
	}

	var stats SupportStatsResponse
	statsSQL := `
		SELECT 
			COUNT(*),
			COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN assigned_agent_id IS NULL AND status NOT IN ('resolved', 'closed') THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'pending_customer' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN priority IN ('high', 'urgent') AND status NOT IN ('resolved', 'closed') THEN 1 ELSE 0 END), 0)
		FROM support_tickets
	`
	err := db.QueryRow(r.Context(), statsSQL).Scan(
		&stats.Total, &stats.New, &stats.Open, &stats.Unassigned,
		&stats.InProgress, &stats.PendingCustomer, &stats.Resolved, &stats.Closed,
		&stats.HighPriority,
	)
	if err != nil {
		log.Printf("handleAdminSupportStats error: %v", err)
	}

	json.NewEncoder(w).Encode(stats)
}

func handleAdminRecordTyping(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, ticketID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusServiceUnavailable)
		return
	}
	_, err := db.Exec(r.Context(), `UPDATE support_tickets SET agent_typing_at = now() WHERE id = $1`, ticketID)
	if err != nil {
		log.Printf("handleAdminRecordTyping error: %v", err)
		http.Error(w, `{"error":"failed to update typing state"}`, http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}
