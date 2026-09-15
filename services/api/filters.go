package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type MailboxFilter struct {
	ID          string          `json:"id"`
	MailboxID   string          `json:"mailbox_id"`
	Name        string          `json:"name"`
	FilterType  string          `json:"filter_type"` // "custom" or "sieve"
	RulesJSON   json.RawMessage `json:"rules_json,omitempty"`
	SieveScript string          `json:"sieve_script,omitempty"`
	Priority    int             `json:"priority"`
	IsActive    bool            `json:"is_active"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type MailboxAddressRule struct {
	ID         string    `json:"id"`
	MailboxID  string    `json:"mailbox_id"`
	ListType   string    `json:"list_type"`   // "spam", "block", "allow"
	TargetType string    `json:"target_type"` // "address", "domain"
	Value      string    `json:"value"`
	CreatedAt  time.Time `json:"created_at"`
}

// mailboxFiltersHandler handles GET and POST /v1/mailboxes/{mailbox_id}/filters
func mailboxFiltersHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Auth check
	var userOrgID, mailboxOrgID string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID); err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT id::text, mailbox_id::text, name, filter_type, COALESCE(rules_json, '{}'::jsonb),
			       COALESCE(sieve_script, ''), priority, is_active, created_at, updated_at
			FROM mailbox_filters
			WHERE mailbox_id=$1
			ORDER BY priority ASC, created_at ASC
		`, mailboxID)
		if err != nil {
			http.Error(w, "failed to query filters", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		filters := make([]MailboxFilter, 0)
		for rows.Next() {
			var f MailboxFilter
			var rawJSON []byte
			if err := rows.Scan(&f.ID, &f.MailboxID, &f.Name, &f.FilterType, &rawJSON, &f.SieveScript, &f.Priority, &f.IsActive, &f.CreatedAt, &f.UpdatedAt); err != nil {
				continue
			}
			f.RulesJSON = rawJSON
			filters = append(filters, f)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(filters)

	case http.MethodPost:
		var req struct {
			Name        string          `json:"name"`
			FilterType  string          `json:"filter_type"`
			RulesJSON   json.RawMessage `json:"rules_json"`
			SieveScript string          `json:"sieve_script"`
			Priority    int             `json:"priority"`
			IsActive    *bool           `json:"is_active"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(req.Name) == "" {
			http.Error(w, "filter name is required", http.StatusBadRequest)
			return
		}
		if req.FilterType == "" {
			req.FilterType = "custom"
		}
		isActive := true
		if req.IsActive != nil {
			isActive = *req.IsActive
		}

		var f MailboxFilter
		var rawJSON []byte
		err = conn.QueryRow(ctx, `
			INSERT INTO mailbox_filters (mailbox_id, name, filter_type, rules_json, sieve_script, priority, is_active)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			RETURNING id::text, mailbox_id::text, name, filter_type, COALESCE(rules_json, '{}'::jsonb),
			          COALESCE(sieve_script, ''), priority, is_active, created_at, updated_at
		`, mailboxID, strings.TrimSpace(req.Name), req.FilterType, req.RulesJSON, req.SieveScript, req.Priority, isActive).Scan(
			&f.ID, &f.MailboxID, &f.Name, &f.FilterType, &rawJSON, &f.SieveScript, &f.Priority, &f.IsActive, &f.CreatedAt, &f.UpdatedAt,
		)
		if err != nil {
			http.Error(w, "failed to create filter", http.StatusInternalServerError)
			return
		}
		f.RulesJSON = rawJSON

		auditLog(ctx, conn, mailboxOrgID, userID, "create_mailbox_filter", "mailbox_filter", f.ID, map[string]interface{}{
			"name": f.Name,
			"type": f.FilterType,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(f)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// mailboxFilterItemHandler handles PUT and DELETE /v1/mailboxes/{mailbox_id}/filters/{filter_id}
func mailboxFilterItemHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	filterID := r.PathValue("filter_id")
	if mailboxID == "" || filterID == "" {
		http.Error(w, "mailbox_id and filter_id required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Auth check
	var userOrgID, mailboxOrgID string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID); err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodPut:
		var req struct {
			Name        *string          `json:"name"`
			FilterType  *string          `json:"filter_type"`
			RulesJSON   *json.RawMessage `json:"rules_json"`
			SieveScript *string          `json:"sieve_script"`
			Priority    *int             `json:"priority"`
			IsActive    *bool            `json:"is_active"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		var f MailboxFilter
		var rawJSON []byte
		err = conn.QueryRow(ctx, `
			UPDATE mailbox_filters
			SET name = COALESCE($1, name),
			    filter_type = COALESCE($2, filter_type),
			    rules_json = COALESCE($3, rules_json),
			    sieve_script = COALESCE($4, sieve_script),
			    priority = COALESCE($5, priority),
			    is_active = COALESCE($6, is_active),
			    updated_at = NOW()
			WHERE id=$7 AND mailbox_id=$8
			RETURNING id::text, mailbox_id::text, name, filter_type, COALESCE(rules_json, '{}'::jsonb),
			          COALESCE(sieve_script, ''), priority, is_active, created_at, updated_at
		`, req.Name, req.FilterType, req.RulesJSON, req.SieveScript, req.Priority, req.IsActive, filterID, mailboxID).Scan(
			&f.ID, &f.MailboxID, &f.Name, &f.FilterType, &rawJSON, &f.SieveScript, &f.Priority, &f.IsActive, &f.CreatedAt, &f.UpdatedAt,
		)
		if err != nil {
			http.Error(w, "filter not found or update failed", http.StatusNotFound)
			return
		}
		f.RulesJSON = rawJSON

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(f)

	case http.MethodDelete:
		res, err := conn.Exec(ctx, `DELETE FROM mailbox_filters WHERE id=$1 AND mailbox_id=$2`, filterID, mailboxID)
		if err != nil {
			http.Error(w, "failed to delete filter", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			http.Error(w, "filter not found", http.StatusNotFound)
			return
		}
		auditLog(ctx, conn, mailboxOrgID, userID, "delete_mailbox_filter", "mailbox_filter", filterID, nil)
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// mailboxAddressRulesHandler handles GET and POST /v1/mailboxes/{mailbox_id}/address-rules
func mailboxAddressRulesHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox_id required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Auth check
	var userOrgID, mailboxOrgID string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID); err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		listFilter := r.URL.Query().Get("list_type")
		var rows pgx.Rows
		if listFilter != "" {
			rows, err = conn.Query(ctx, `
				SELECT id::text, mailbox_id::text, list_type, target_type, value, created_at
				FROM mailbox_address_rules
				WHERE mailbox_id=$1 AND list_type=$2
				ORDER BY created_at DESC
			`, mailboxID, listFilter)
		} else {
			rows, err = conn.Query(ctx, `
				SELECT id::text, mailbox_id::text, list_type, target_type, value, created_at
				FROM mailbox_address_rules
				WHERE mailbox_id=$1
				ORDER BY list_type, created_at DESC
			`, mailboxID)
		}
		if err != nil {
			http.Error(w, "failed to query address rules", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		rules := make([]MailboxAddressRule, 0)
		for rows.Next() {
			var r MailboxAddressRule
			if err := rows.Scan(&r.ID, &r.MailboxID, &r.ListType, &r.TargetType, &r.Value, &r.CreatedAt); err != nil {
				continue
			}
			rules = append(rules, r)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rules)

	case http.MethodPost:
		var req struct {
			ListType   string `json:"list_type"`   // "spam", "block", "allow"
			TargetType string `json:"target_type"` // "address", "domain"
			Value      string `json:"value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		cleanVal := strings.ToLower(strings.TrimSpace(req.Value))
		if cleanVal == "" {
			http.Error(w, "value is required", http.StatusBadRequest)
			return
		}

		listType := strings.ToLower(strings.TrimSpace(req.ListType))
		if listType != "spam" && listType != "block" && listType != "allow" {
			http.Error(w, "list_type must be spam, block, or allow", http.StatusBadRequest)
			return
		}

		targetType := req.TargetType
		if targetType == "" {
			if strings.HasPrefix(cleanVal, "@") || !strings.Contains(cleanVal, "@") {
				targetType = "domain"
			} else {
				targetType = "address"
			}
		}

		var rule MailboxAddressRule
		err = conn.QueryRow(ctx, `
			INSERT INTO mailbox_address_rules (mailbox_id, list_type, target_type, value)
			VALUES ($1, $2, $3, $4)
			RETURNING id::text, mailbox_id::text, list_type, target_type, value, created_at
		`, mailboxID, listType, targetType, cleanVal).Scan(
			&rule.ID, &rule.MailboxID, &rule.ListType, &rule.TargetType, &rule.Value, &rule.CreatedAt,
		)
		if err != nil {
			http.Error(w, "failed to create address rule", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, mailboxOrgID, userID, "create_address_rule", "mailbox_address_rule", rule.ID, map[string]interface{}{
			"list_type":   rule.ListType,
			"target_type": rule.TargetType,
			"value":       rule.Value,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(rule)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// mailboxAddressRuleItemHandler handles DELETE /v1/mailboxes/{mailbox_id}/address-rules/{rule_id}
func mailboxAddressRuleItemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	ruleID := r.PathValue("rule_id")
	if mailboxID == "" || ruleID == "" {
		http.Error(w, "mailbox_id and rule_id required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Auth check
	var userOrgID, mailboxOrgID string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID); err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	res, err := conn.Exec(ctx, `DELETE FROM mailbox_address_rules WHERE id=$1 AND mailbox_id=$2`, ruleID, mailboxID)
	if err != nil {
		http.Error(w, "failed to delete rule", http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "rule not found", http.StatusNotFound)
		return
	}

	auditLog(ctx, conn, mailboxOrgID, userID, "delete_address_rule", "mailbox_address_rule", ruleID, nil)
	w.WriteHeader(http.StatusNoContent)
}
