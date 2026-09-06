package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type PlanLimits struct {
	Plan           string `json:"plan"`
	MonthlyUSD     int    `json:"monthly_usd"`
	AnnualUSD      int    `json:"annual_usd"`
	MailboxLimit   int    `json:"mailbox_limit"`
	DomainLimit    int    `json:"domain_limit"`
	AliasesPerMail int    `json:"aliases_per_mail"`
}

var PLAN_SPECS = map[string]PlanLimits{
	"solo":          {Plan: "solo", MonthlyUSD: 3, AnnualUSD: 31, MailboxLimit: 1, DomainLimit: 1, AliasesPerMail: 10},
	"starter":       {Plan: "starter", MonthlyUSD: 14, AnnualUSD: 143, MailboxLimit: 5, DomainLimit: 2, AliasesPerMail: 15},
	"business":      {Plan: "business", MonthlyUSD: 26, AnnualUSD: 265, MailboxLimit: 10, DomainLimit: 3, AliasesPerMail: 20},
	"team":          {Plan: "team", MonthlyUSD: 60, AnnualUSD: 612, MailboxLimit: 25, DomainLimit: 5, AliasesPerMail: 30},
	"business_plus": {Plan: "business_plus", MonthlyUSD: 110, AnnualUSD: 1122, MailboxLimit: 50, DomainLimit: 10, AliasesPerMail: 40},
	"enterprise":    {Plan: "enterprise", MonthlyUSD: 0, AnnualUSD: 0, MailboxLimit: 9999, DomainLimit: 999, AliasesPerMail: 999},
}

type BillingResponse struct {
	PlanLimits
	UsedMailboxes int `json:"used_mailboxes"`
	UsedDomains   int `json:"used_domains"`
}

func billingHandler(w http.ResponseWriter, r *http.Request) {
	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "org_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "invalid org_id UUID", http.StatusBadRequest)
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

	// Authorize: user belongs to org
	var userOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil || userOrgID != orgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		var currentPlan string
		err := conn.QueryRow(ctx, `SELECT plan FROM organizations WHERE id=$1`, orgID).Scan(&currentPlan)
		if err != nil {
			currentPlan = "solo"
		}

		spec, ok := PLAN_SPECS[currentPlan]
		if !ok {
			spec = PLAN_SPECS["solo"]
		}

		var usedMailboxes, usedDomains int
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&usedMailboxes)
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id=$1`, orgID).Scan(&usedDomains)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(BillingResponse{
			PlanLimits:    spec,
			UsedMailboxes: usedMailboxes,
			UsedDomains:   usedDomains,
		})

	case http.MethodPost:
		// Update plan (owner only)
		if !isOwner(userID, orgID, conn) {
			http.Error(w, "only organization owner can change subscription plan", http.StatusForbidden)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Plan string `json:"plan"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		newPlan := strings.TrimSpace(req.Plan)
		spec, ok := PLAN_SPECS[newPlan]
		if !ok {
			http.Error(w, "invalid plan name", http.StatusBadRequest)
			return
		}

		_, err := conn.Exec(ctx, `UPDATE organizations SET plan=$1 WHERE id=$2`, newPlan, orgID)
		if err != nil {
			http.Error(w, "failed to update organization plan", http.StatusInternalServerError)
			return
		}
		// Sync active mailboxes to match org plan
		_, _ = conn.Exec(ctx, `UPDATE mailboxes SET plan=$1 WHERE org_id=$2`, newPlan, orgID)

		auditLog(ctx, conn, orgID, userID, "change_plan", "organization", orgID, map[string]interface{}{"new_plan": newPlan})

		var usedMailboxes, usedDomains int
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&usedMailboxes)
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id=$1`, orgID).Scan(&usedDomains)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(BillingResponse{
			PlanLimits:    spec,
			UsedMailboxes: usedMailboxes,
			UsedDomains:   usedDomains,
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
