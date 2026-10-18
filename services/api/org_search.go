package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type SearchDomainResult struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	IsVerified bool   `json:"is_verified"`
}

type SearchMailboxResult struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	LocalPart  string `json:"local_part"`
	DomainName string `json:"domain_name"`
	Mode       string `json:"mode"`
	Status     string `json:"status"`
}

type SearchMemberResult struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	IsActive    bool   `json:"is_active"`
}

type OrganizationSearchResponse struct {
	Query     string                `json:"query"`
	Domains   []SearchDomainResult  `json:"domains"`
	Mailboxes []SearchMailboxResult `json:"mailboxes"`
	Members   []SearchMemberResult  `json:"members"`
}

func organizationSearchHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid authentication", http.StatusUnauthorized)
		return
	}

	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "organization ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Verify caller belongs to the target organization and is active
	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	limit := 10
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			if parsed > 25 {
				limit = 25
			} else {
				limit = parsed
			}
		}
	}

	response := OrganizationSearchResponse{
		Query:     query,
		Domains:   []SearchDomainResult{},
		Mailboxes: []SearchMailboxResult{},
		Members:   []SearchMemberResult{},
	}

	if query == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
		return
	}

	searchPattern := "%" + query + "%"

	// 1. Search Domains (name match)
	domainRows, err := conn.Query(ctx, `
		SELECT id::text, name, is_verified
		FROM domains
		WHERE org_id = $1 AND name ILIKE $2
		ORDER BY name
		LIMIT $3
	`, orgID, searchPattern, limit)
	if err == nil {
		defer domainRows.Close()
		for domainRows.Next() {
			var d SearchDomainResult
			if err := domainRows.Scan(&d.ID, &d.Name, &d.IsVerified); err == nil {
				response.Domains = append(response.Domains, d)
			}
		}
	}

	// 2. Search Mailboxes (local_part match or full email match)
	mailboxRows, err := conn.Query(ctx, `
		SELECT m.id::text, m.local_part, COALESCE(d.name, ''), COALESCE(m.mode, 'org_managed'), COALESCE(m.status, 'active')
		FROM mailboxes m
		LEFT JOIN domains d ON d.id = m.domain_id
		WHERE m.org_id = $1 AND m.is_active = true
		  AND (m.local_part ILIKE $2 OR (m.local_part || '@' || COALESCE(d.name, '')) ILIKE $2)
		ORDER BY m.local_part
		LIMIT $3
	`, orgID, searchPattern, limit)
	if err == nil {
		defer mailboxRows.Close()
		for mailboxRows.Next() {
			var m SearchMailboxResult
			if err := mailboxRows.Scan(&m.ID, &m.LocalPart, &m.DomainName, &m.Mode, &m.Status); err == nil {
				if m.DomainName != "" {
					m.Email = m.LocalPart + "@" + m.DomainName
				} else {
					m.Email = m.LocalPart
				}
				response.Mailboxes = append(response.Mailboxes, m)
			}
		}
	}

	// 3. Search Members (email or display_name match)
	memberRows, err := conn.Query(ctx, `
		SELECT id::text, email, COALESCE(display_name, ''), role, is_active
		FROM users
		WHERE org_id = $1 AND is_active = true
		  AND (email ILIKE $2 OR COALESCE(display_name, '') ILIKE $2)
		ORDER BY email
		LIMIT $3
	`, orgID, searchPattern, limit)
	if err == nil {
		defer memberRows.Close()
		for memberRows.Next() {
			var u SearchMemberResult
			if err := memberRows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.Role, &u.IsActive); err == nil {
				response.Members = append(response.Members, u)
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
