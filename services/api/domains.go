package main

// Evidence:
// - Route table: GET/POST /v1/organizations/{org_id}/domains,
//   POST /v1/organizations/{org_id}/domains/{domain_id}/verify.
// - tests/domain_mailbox_api.ps1: create -> 201; duplicate -> 409;
//   list -> 200; verify -> 200; cross-org create -> 403.
// - apps/control-plane/src/lib/api/domains.ts: list -> {domains:[{
//   id,name,is_verified}]}; create {domain} -> Domain;
//   verify -> {status,domain}.
// - infra/postgres/init/001_init.sql domains table: id, org_id,
//   name UNIQUE, is_verified, verification_token, dkim_selector,
//   dkim_private_key_enc, dkim_public_key, created_at.
// - ROADMAP_STATUS.md Step 7a: domain/alias administration, cross-org 403,
//   duplicate 409, verified-domain gating.
// - api.exe symbols: domainsHandler, domainVerifyHandler, isUniqueViolation.

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func domainsHandler(w http.ResponseWriter, r *http.Request) {
	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "organization ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}

	if r.Method == http.MethodGet {
		rows, err := conn.Query(ctx, `SELECT id::text, name, is_verified FROM domains WHERE org_id=$1 ORDER BY name`, orgID)
		if err != nil {
			http.Error(w, "failed to list domains", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		domains := []map[string]interface{}{}
		for rows.Next() {
			var id, name string
			var verified bool
			if err := rows.Scan(&id, &name, &verified); err != nil {
				continue
			}
			domains = append(domains, map[string]interface{}{
				"id":          id,
				"name":        name,
				"is_verified": verified,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"domains": domains})
		return
	}

	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Domain string `json:"domain"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		name := strings.ToLower(strings.TrimSpace(req.Domain))
		if name == "" || strings.Contains(name, " ") || !strings.Contains(name, ".") {
			http.Error(w, "invalid domain", http.StatusBadRequest)
			return
		}

		// Quota check: enforce plan domain limits
		var usedDomains int
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id=$1`, orgID).Scan(&usedDomains)
		var currentPlan string
		err = conn.QueryRow(ctx, `SELECT plan FROM organizations WHERE id=$1`, orgID).Scan(&currentPlan)
		if err != nil || currentPlan == "" {
			currentPlan = "solo"
		}
		spec, ok := PLAN_SPECS[currentPlan]
		if !ok {
			spec = PLAN_SPECS["solo"]
		}
		if usedDomains >= spec.DomainLimit {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": "domain_limit_reached",
				"limit": spec.DomainLimit,
				"plan":  spec.Plan,
			})
			return
		}

		var newID string
		var verified bool
		err = conn.QueryRow(ctx, `INSERT INTO domains (org_id, name) VALUES ($1, $2) RETURNING id::text, is_verified`, orgID, name).Scan(&newID, &verified)
		if err != nil {
			if isUniqueViolation(err) {
				http.Error(w, "domain already exists", http.StatusConflict)
				return
			}
			http.Error(w, "failed to create domain", http.StatusInternalServerError)
			return
		}
		auditLog(ctx, conn, orgID, userID, "domain_create", "domain", newID, map[string]interface{}{"name": name})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{"id": newID, "name": name, "is_verified": verified})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func domainVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	domainID := r.PathValue("domain_id")
	if orgID == "" || domainID == "" {
		http.Error(w, "organization and domain ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(domainID); err != nil {
		http.Error(w, "domain ID must be UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}
	var name string
	err = conn.QueryRow(ctx, `UPDATE domains SET is_verified=true WHERE id=$1 AND org_id=$2 RETURNING name`, domainID, orgID).Scan(&name)
	if err != nil {
		http.Error(w, "domain not found", http.StatusNotFound)
		return
	}
	auditLog(ctx, conn, orgID, userID, "domain_verify", "domain", domainID, map[string]interface{}{"name": name})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "verified", "domain": name})
}
