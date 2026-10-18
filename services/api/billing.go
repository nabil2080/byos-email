package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type TierBracket struct {
	MinSeats  int
	MaxSeats  int
	RateCents int
}

var TIER_BRACKETS = []TierBracket{
	{MinSeats: 1, MaxSeats: 10, RateCents: 300},
	{MinSeats: 11, MaxSeats: 25, RateCents: 285},
	{MinSeats: 26, MaxSeats: 50, RateCents: 271},
	{MinSeats: 51, MaxSeats: 100, RateCents: 257},
	{MinSeats: 101, MaxSeats: 10000000, RateCents: 244},
}

// CalculateSeatPriceCents computes graduated monthly and annual pricing in integer cents.
func CalculateSeatPriceCents(seats int) (monthlyCents int, annualCents int) {
	if seats < 1 {
		seats = 1
	}
	remaining := seats
	for _, b := range TIER_BRACKETS {
		if remaining <= 0 {
			break
		}
		capacity := b.MaxSeats - b.MinSeats + 1
		inTier := remaining
		if inTier > capacity {
			inTier = capacity
		}
		monthlyCents += inTier * b.RateCents
		remaining -= inTier
	}
	annualCents = monthlyCents * 10
	return monthlyCents, annualCents
}

// ComputeCapacityCaps calculates dynamic resource limits from seat count:
// - Mailboxes: 1 per seat, exact
// - Domains: max(1, ceil(seats / 5))
// - Aliases: max(5, seats * 2)
func ComputeCapacityCaps(seats int) (domainsCap int, aliasesCap int) {
	if seats < 1 {
		seats = 1
	}
	domainsCap = (seats + 4) / 5
	if domainsCap < 1 {
		domainsCap = 1
	}
	aliasesCap = seats * 2
	if aliasesCap < 5 {
		aliasesCap = 5
	}
	return domainsCap, aliasesCap
}

type BillingResponse struct {
	SeatCount          int     `json:"seat_count"`
	SubscriptionStatus string  `json:"subscription_status"`
	BillingCycle       string  `json:"billing_cycle"`
	MonthlyUSD         float64 `json:"monthly_usd"`
	AnnualUSD          float64 `json:"annual_usd"`
	MailboxLimit       int     `json:"mailbox_limit"`
	DomainLimit        int     `json:"domain_limit"`
	AliasesPerMail     int     `json:"aliases_per_mail"`
	UsedMailboxes      int     `json:"used_mailboxes"`
	UsedDomains        int     `json:"used_domains"`
	UsedAliases        int     `json:"used_aliases"`
}

// organizationSeatsHandler handles PATCH /v1/organizations/{org_id}/seats
func organizationSeatsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

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

	// Owner check
	if !isOwner(userID, orgID, conn) {
		http.Error(w, "only organization owner can change seat count", http.StatusForbidden)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		SeatCount int `json:"seat_count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.SeatCount < 1 || req.SeatCount > 10000 {
		http.Error(w, "seat_count must be between 1 and 10000", http.StatusBadRequest)
		return
	}

	// Check active mailboxes count
	var activeMailboxes int
	_ = conn.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&activeMailboxes)
	if req.SeatCount < activeMailboxes {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":             "seat_count_below_active_mailboxes",
			"current_mailboxes": activeMailboxes,
		})
		return
	}

	cmdTag, err := conn.Exec(ctx, `UPDATE organizations SET seat_count=$1, updated_at=now() WHERE id=$2`, req.SeatCount, orgID)
	if err != nil || cmdTag.RowsAffected() == 0 {
		http.Error(w, "failed to update organization seats", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "update_seats", "organization", orgID, map[string]interface{}{"seat_count": req.SeatCount})

	monthlyCents, annualCents := CalculateSeatPriceCents(req.SeatCount)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"org_id":              orgID,
		"seat_count":          req.SeatCount,
		"monthly_total_cents": monthlyCents,
		"annual_total_cents":  annualCents,
	})
}

// organizationCapacityHandler handles GET /v1/organizations/{org_id}/capacity
func organizationCapacityHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

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

	var seatCount int
	err = conn.QueryRow(ctx, `SELECT COALESCE(seat_count, 1) FROM organizations WHERE id=$1`, orgID).Scan(&seatCount)
	if err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}

	var usedMailboxes, usedDomains, usedAliases int
	_ = conn.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&usedMailboxes)
	_ = conn.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id=$1`, orgID).Scan(&usedDomains)
	_ = conn.QueryRow(ctx, `SELECT count(*) FROM aliases a JOIN mailboxes m ON m.id = a.mailbox_id WHERE m.org_id=$1 AND a.is_active=true`, orgID).Scan(&usedAliases)

	domainsCap, aliasesCap := ComputeCapacityCaps(seatCount)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"mailboxes": map[string]interface{}{"used": usedMailboxes, "cap": seatCount},
		"domains":   map[string]interface{}{"used": usedDomains, "cap": domainsCap},
		"aliases":   map[string]interface{}{"used": usedAliases, "cap": aliasesCap},
		"storage":   map[string]interface{}{"used": nil, "cap": nil, "note": "customer-controlled"},
	})
}

// billingHandler handles /v1/organizations/{org_id}/billing and /v1/organizations/{org_id}/billing/plan
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
		var seatCount int
		var subscriptionStatus, billingCycle string
		err := conn.QueryRow(ctx, `SELECT COALESCE(seat_count, 1), COALESCE(subscription_status, 'active'), COALESCE(billing_cycle, 'annual') FROM organizations WHERE id=$1`, orgID).Scan(&seatCount, &subscriptionStatus, &billingCycle)
		if err != nil {
			seatCount = 1
			subscriptionStatus = "active"
			billingCycle = "annual"
		}

		monthlyCents, annualCents := CalculateSeatPriceCents(seatCount)
		domainsCap, aliasesCap := ComputeCapacityCaps(seatCount)

		var usedMailboxes, usedDomains, usedAliases int
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&usedMailboxes)
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id=$1`, orgID).Scan(&usedDomains)
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM aliases a JOIN mailboxes m ON m.id = a.mailbox_id WHERE m.org_id=$1 AND a.is_active=true`, orgID).Scan(&usedAliases)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(BillingResponse{
			SeatCount:          seatCount,
			SubscriptionStatus: subscriptionStatus,
			BillingCycle:       billingCycle,
			MonthlyUSD:         float64(monthlyCents) / 100.0,
			AnnualUSD:          float64(annualCents) / 100.0,
			MailboxLimit:       seatCount,
			DomainLimit:        domainsCap,
			AliasesPerMail:     aliasesCap,
			UsedMailboxes:      usedMailboxes,
			UsedDomains:        usedDomains,
			UsedAliases:        usedAliases,
		})

	case http.MethodPost:
		// Owner only
		if !isOwner(userID, orgID, conn) {
			http.Error(w, "only organization owner can change subscription", http.StatusForbidden)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Plan         string `json:"plan"`
			SeatCount    int    `json:"seat_count"`
			BillingCycle string `json:"billing_cycle"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		targetSeats := req.SeatCount
		if targetSeats <= 0 && req.Plan != "" {
			switch strings.ToLower(strings.TrimSpace(req.Plan)) {
			case "solo":
				targetSeats = 1
			case "starter":
				targetSeats = 5
			case "business":
				targetSeats = 10
			case "team":
				targetSeats = 25
			case "business_plus":
				targetSeats = 50
			case "enterprise":
				targetSeats = 50
			default:
				http.Error(w, "invalid plan name", http.StatusBadRequest)
				return
			}
		}

		if targetSeats < 1 || targetSeats > 10000 {
			http.Error(w, "invalid seat count", http.StatusBadRequest)
			return
		}

		var activeMailboxes int
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&activeMailboxes)
		if targetSeats < activeMailboxes {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":             "seat_count_below_active_mailboxes",
				"current_mailboxes": activeMailboxes,
			})
			return
		}

		cycle := req.BillingCycle
		if cycle != "monthly" && cycle != "annual" {
			cycle = "annual"
		}

		_, err := conn.Exec(ctx, `UPDATE organizations SET seat_count=$1, billing_cycle=$2, updated_at=now() WHERE id=$3`, targetSeats, cycle, orgID)
		if err != nil {
			http.Error(w, "failed to update organization subscription", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, orgID, userID, "update_subscription", "organization", orgID, map[string]interface{}{
			"seat_count":    targetSeats,
			"billing_cycle": cycle,
		})

		monthlyCents, annualCents := CalculateSeatPriceCents(targetSeats)
		domainsCap, aliasesCap := ComputeCapacityCaps(targetSeats)

		var usedMailboxes, usedDomains, usedAliases int
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&usedMailboxes)
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id=$1`, orgID).Scan(&usedDomains)
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM aliases a JOIN mailboxes m ON m.id = a.mailbox_id WHERE m.org_id=$1 AND a.is_active=true`, orgID).Scan(&usedAliases)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(BillingResponse{
			SeatCount:          targetSeats,
			SubscriptionStatus: "active",
			BillingCycle:       cycle,
			MonthlyUSD:         float64(monthlyCents) / 100.0,
			AnnualUSD:          float64(annualCents) / 100.0,
			MailboxLimit:       targetSeats,
			DomainLimit:        domainsCap,
			AliasesPerMail:     aliasesCap,
			UsedMailboxes:      usedMailboxes,
			UsedDomains:        usedDomains,
			UsedAliases:        usedAliases,
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
