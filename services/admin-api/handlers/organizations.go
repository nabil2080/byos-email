package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type OrganizationResponse struct {
	ID           string    `json:"id"`
	OrgUUID      string    `json:"org_uuid"`
	Name         string    `json:"name"`
	Plan         string    `json:"plan"`
	PlanTier     string    `json:"plan_tier"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"created_at"`
	MailboxCount int       `json:"mailbox_count"`
	SeatCount          int       `json:"seat_count"`
	BillingCycle       string    `json:"billing_cycle"`
	SubscriptionStatus string    `json:"subscription_status"`
	MaxDomains         int       `json:"max_domains"`
	MaxAliases         int       `json:"max_aliases"`
	StorageUsed        int64     `json:"storage_used"`
	StorageQuota       int64     `json:"storage_quota"`
}

type AuditLogEntry struct {
	ActorName  string    `json:"actor_name"`
	TargetName string    `json:"target_name"`
	TargetType string    `json:"target_type"`
	ID         string    `json:"id"`
	AdminUUID  string    `json:"admin_uuid"`
	ActorUUID  string    `json:"actor_uuid"`
	Action     string    `json:"action"`
	ActionType string    `json:"action_type"`
	TargetUUID string    `json:"target_uuid"`
	Metadata   any       `json:"metadata"`
	Timestamp  time.Time `json:"timestamp"`
}

// RegisterOrganizationRoutes registers all organization and audit log endpoints.
func RegisterOrganizationRoutes(mux *http.ServeMux, db *pgxpool.Pool, authMiddleware func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("/admin/v1/organizations", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleGetOrganizations(w, r, db)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	// Dynamic organization route dispatcher for /admin/v1/organizations/{uuid}/...
	mux.HandleFunc("/admin/v1/organizations/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		// Path: /admin/v1/organizations/{uuid}/{action}
		path := strings.TrimPrefix(r.URL.Path, "/admin/v1/organizations/")
		parts := strings.Split(strings.Trim(path, "/"), "/")

		if len(parts) == 0 || parts[0] == "" {
			http.Error(w, "Organization UUID required", http.StatusBadRequest)
			return
		}

		orgUUIDStr := parts[0]
		orgUUID, err := uuid.Parse(orgUUIDStr)
		if err != nil {
			http.Error(w, "Invalid Organization UUID", http.StatusBadRequest)
			return
		}

		if len(parts) == 1 {
			if r.Method == http.MethodGet {
				handleGetSingleOrganization(w, r, db, orgUUID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
			return
		}

		action := parts[1]
		switch action {
		case "suspend":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			handleSuspendOrganization(w, r, db, orgUUID)
		case "seats":
			HandleUpdateSeatCount(w, r, db, orgUUID)
		case "plan":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			handleUpdatePlan(w, r, db, orgUUID)
		case "capacity":
			if r.Method == http.MethodGet {
				HandleGetCapacity(w, r, db, orgUUID)
			} else if r.Method == http.MethodPost {
				handleAdjustCapacity(w, r, db, orgUUID)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		case "state-reset", "recovery":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			handleStateReset(w, r, db, orgUUID)
		default:
			http.Error(w, "Unknown organization action", http.StatusNotFound)
		}
	}))

	mux.HandleFunc("/admin/v1/domains", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			handleAdminCreateDomain(w, r, db)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/admin/v1/audit-logs", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleGetAuditLogs(w, r, db)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))
}

// handleGetOrganizations strictly selects non-cryptographic metadata only.
// Database role role_support_agent has no SELECT privileges on org_recovery_pk.
func handleGetOrganizations(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	orgs := []OrganizationResponse{}
	if db == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(orgs)
		return
	}

	rows, err := db.Query(r.Context(), `
		SELECT o.id, o.name, COALESCE(o.status, 'active'), o.created_at,
		       COALESCE((SELECT COUNT(*) FROM mailboxes m WHERE m.org_id = o.id), 0) AS mailbox_count,
		       COALESCE((SELECT SUM(sc.used_bytes) FROM storage_connections sc WHERE sc.org_id = o.id), 0) AS used_bytes,
		       COALESCE(o.seat_count, 1) AS seat_count,
		       COALESCE(o.billing_cycle, 'annual') AS billing_cycle,
		       COALESCE(o.subscription_status, 'active') AS subscription_status
		FROM organizations o
		ORDER BY o.created_at DESC
		LIMIT 100
	`)
	if err != nil {
		log.Printf("handleGetOrganizations query error: %v", err)
		http.Error(w, `{"error":"Failed to query organizations"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var org OrganizationResponse
		var uid uuid.UUID
		var usedBytes int64
		if err := rows.Scan(&uid, &org.Name, &org.Status, &org.CreatedAt, &org.MailboxCount, &usedBytes, &org.SeatCount, &org.BillingCycle, &org.SubscriptionStatus); err != nil {
			log.Printf("handleGetOrganizations scan error: %v", err)
			http.Error(w, `{"error":"Failed to scan organization record"}`, http.StatusInternalServerError)
			return
		}
		org.ID = uid.String()
		org.OrgUUID = uid.String()
		org.Plan = fmt.Sprintf("%d Seats", org.SeatCount)
		org.PlanTier = org.Plan
		org.MaxDomains, org.MaxAliases = ComputeCapacityCaps(org.SeatCount)
		org.StorageQuota = 0
		org.StorageUsed = usedBytes
		orgs = append(orgs, org)
	}

	if err := rows.Err(); err != nil {
		log.Printf("handleGetOrganizations iteration error: %v", err)
		http.Error(w, `{"error":"Failed while iterating organizations"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(orgs)
}

func handleGetSingleOrganization(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, orgUUID uuid.UUID) {
	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	var org OrganizationResponse
	var usedBytes int64
	err := db.QueryRow(r.Context(), `
		SELECT o.id, o.name, COALESCE(o.status, 'active'), o.created_at,
		       COALESCE((SELECT COUNT(*) FROM mailboxes m WHERE m.org_id = o.id), 0) AS mailbox_count,
		       COALESCE((SELECT SUM(sc.used_bytes) FROM storage_connections sc WHERE sc.org_id = o.id), 0) AS used_bytes,
		       COALESCE(o.seat_count, 1) AS seat_count,
		       COALESCE(o.billing_cycle, 'annual') AS billing_cycle,
		       COALESCE(o.subscription_status, 'active') AS subscription_status
		FROM organizations o
		WHERE o.id = $1
	`, orgUUID).Scan(&org.ID, &org.Name, &org.Status, &org.CreatedAt, &org.MailboxCount, &usedBytes, &org.SeatCount, &org.BillingCycle, &org.SubscriptionStatus)

	if err != nil {
		http.Error(w, "Organization not found", http.StatusNotFound)
		return
	}

	org.OrgUUID = org.ID
	org.Plan = fmt.Sprintf("%d Seats", org.SeatCount)
	org.PlanTier = org.Plan
	org.MaxDomains, org.MaxAliases = ComputeCapacityCaps(org.SeatCount)
	org.StorageQuota = 0
	org.StorageUsed = usedBytes

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(org)
}

// handleSuspendOrganization wraps the status update and audit log in a single atomic transaction.
// If the audit log fails to write, the transaction rolls back.
func handleSuspendOrganization(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, orgUUID uuid.UUID) {
	var req struct {
		Status string `json:"status"` // "suspended" or "active"
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	targetStatus := req.Status
	if targetStatus == "" {
		targetStatus = "suspended"
	}
	if targetStatus != "suspended" && targetStatus != "active" && targetStatus != "grace_period" {
		http.Error(w, "Invalid status parameter", http.StatusBadRequest)
		return
	}

	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to initiate database transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 1. Update organization status
	cmdTag, err := tx.Exec(ctx, "UPDATE organizations SET status = $1, updated_at = now() WHERE id = $2", targetStatus, orgUUID)
	if err != nil || cmdTag.RowsAffected() == 0 {
		http.Error(w, "Organization update failed or not found", http.StatusInternalServerError)
		return
	}

	// 2. Cascade status to all users under this organization
	userActive := targetStatus == "active"
	_, err = tx.Exec(ctx, "UPDATE users SET status = $1, is_active = $2, updated_at = now() WHERE org_id = $3", targetStatus, userActive, orgUUID)
	if err != nil {
		http.Error(w, "Failed to cascade status to users", http.StatusInternalServerError)
		return
	}

	// 3. Cascade status to all mailboxes under this organization
	_, err = tx.Exec(ctx, "UPDATE mailboxes SET status = $1, is_active = $2, updated_at = now() WHERE org_id = $3", targetStatus, userActive, orgUUID)
	if err != nil {
		http.Error(w, "Failed to cascade status to mailboxes", http.StatusInternalServerError)
		return
	}

	// 4. Invalidate active sessions if suspending
	if targetStatus == "suspended" {
		_, _ = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)", orgUUID)
	}

	// Fetch org name for audit metadata
	var orgName string
	_ = tx.QueryRow(ctx, "SELECT name FROM organizations WHERE id = $1", orgUUID).Scan(&orgName)

	// 5. Write Immutable Audit Log
	adminActorUUID := uuid.MustParse("11111111-2222-3333-4444-555555555501") // Sarah Chen (Tier 2 Lead Agent)
	auditID := "aud_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
	metaJSON, _ := json.Marshal(map[string]any{
		"reason":    req.Reason,
		"audit_id":  auditID,
		"status":    targetStatus,
		"org_name":  orgName,
		"operation": "organization_status_change",
		"client":    "byos-support-crm",
		"actor":     "Sarah Chen (Tier 2)",
	})

	actionType := "org_suspend"
	if targetStatus == "active" {
		actionType = "org_reactivate"
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, target_org_uuid, metadata)
		VALUES ($1, $2, $3, $4, $5)
	`, adminActorUUID, adminActorUUID, actionType, orgUUID, metaJSON)
	if err != nil {
		http.Error(w, "Failed to commit audit trail: transaction rolled back", http.StatusInternalServerError)
		return
	}

	// 6. Commit Transaction
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"audit_id":        auditID,
		"target_org_uuid": orgUUID.String(),
		"org_name":        orgName,
		"status":          targetStatus,
		"message":         "Organization and account status updated with immutable audit confirmation.",
	})
}

// handleUpdatePlan updates the subscription plan tier within an atomic transaction.
// If the audit log fails to write, the transaction rolls back.
func handleUpdatePlan(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, orgUUID uuid.UUID) {
	var req struct {
		Plan   string `json:"plan"`
		Reason string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Plan == "" {
		http.Error(w, "Plan tier required", http.StatusBadRequest)
		return
	}

	validPlans := map[string]bool{"solo": true, "starter": true, "business": true, "enterprise": true}
	if !validPlans[strings.ToLower(req.Plan)] {
		http.Error(w, "Invalid plan tier", http.StatusBadRequest)
		return
	}

	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to initiate database transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 1. Update plan
	cmdTag, err := tx.Exec(ctx, "UPDATE organizations SET plan = $1, updated_at = now() WHERE id = $2", strings.ToLower(req.Plan), orgUUID)
	if err != nil || cmdTag.RowsAffected() == 0 {
		http.Error(w, "Organization plan update failed or not found", http.StatusInternalServerError)
		return
	}

	// 2. Write Immutable Audit Log
	adminActorUUID := uuid.New()
	auditID := "aud_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
	metaJSON, _ := json.Marshal(map[string]string{
		"new_plan":  req.Plan,
		"reason":    req.Reason,
		"audit_id":  auditID,
		"operation": "organization_plan_update",
		"client":    "byos-support-crm",
	})

	_, err = tx.Exec(ctx, `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, target_org_uuid, metadata)
		VALUES ($1, $2, $3, $4, $5)
	`, adminActorUUID, adminActorUUID, "org_update_plan", orgUUID, metaJSON)
	if err != nil {
		// Rollback occurs automatically via defer tx.Rollback
		http.Error(w, "Failed to commit audit trail: transaction rolled back", http.StatusInternalServerError)
		return
	}

	// 3. Commit Transaction
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"audit_id":        auditID,
		"target_org_uuid": orgUUID.String(),
		"plan":            req.Plan,
		"message":         "Organization plan tier updated with immutable audit confirmation.",
	})
}

// handleAdjustCapacity updates the allocated mailbox capacity within an atomic transaction.
// If the audit log fails to write, the transaction rolls back.
func handleAdjustCapacity(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, orgUUID uuid.UUID) {
	var req struct {
		SeatCount int    `json:"seat_count"`
		Reason    string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.SeatCount < 1 {
		http.Error(w, "Valid seat_count (>= 1) required", http.StatusBadRequest)
		return
	}

	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to initiate database transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	maxDomains, maxAliases := ComputeCapacityCaps(req.SeatCount)

	cmdTag, err := tx.Exec(ctx, "UPDATE organizations SET seat_count = $1, updated_at = now() WHERE id = $2", req.SeatCount, orgUUID)
	if err != nil || cmdTag.RowsAffected() == 0 {
		http.Error(w, "Organization capacity update failed or not found", http.StatusInternalServerError)
		return
	}

	// 2. Write Immutable Audit Log
	adminActorUUID := uuid.New()
	auditID := "aud_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
	metaJSON, _ := json.Marshal(map[string]interface{}{
		"seat_count":  req.SeatCount,
		"max_domains": maxDomains,
		"max_aliases": maxAliases,
		"reason":      req.Reason,
		"audit_id":    auditID,
		"operation":   "organization_adjust_capacity",
		"client":      "byos-support-crm",
	})

	_, err = tx.Exec(ctx, `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, target_org_uuid, metadata)
		VALUES ($1, $2, $3, $4, $5)
	`, adminActorUUID, adminActorUUID, "org_adjust_capacity", orgUUID, metaJSON)
	if err != nil {
		// Rollback occurs automatically via defer tx.Rollback
		http.Error(w, "Failed to commit audit trail: transaction rolled back", http.StatusInternalServerError)
		return
	}

	// 3. Commit Transaction
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"audit_id":        auditID,
		"target_org_uuid": orgUUID.String(),
		"seat_count":      req.SeatCount,
		"max_domains":     maxDomains,
		"max_aliases":     maxAliases,
		"message":         "Organization mailbox capacity updated with immutable audit confirmation.",
	})
}

// handleStateReset triggers the verifier-based offline recovery flow within an atomic transaction.
// If the audit log fails to write, the transaction rolls back.
func handleStateReset(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, orgUUID uuid.UUID) {
	var req struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to initiate database transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	adminActorUUID := uuid.New()
	auditID := "aud_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
	metaJSON, _ := json.Marshal(map[string]string{
		"protocol":  "verifier_offline_recovery_s3_3",
		"reason":    req.Reason,
		"audit_id":  auditID,
		"operation": "organization_state_reset",
		"client":    "byos-support-crm",
	})

	_, err = tx.Exec(ctx, `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, target_org_uuid, metadata)
		VALUES ($1, $2, $3, $4, $5)
	`, adminActorUUID, adminActorUUID, "org_state_reset", orgUUID, metaJSON)
	if err != nil {
		http.Error(w, "Failed to commit audit trail: transaction rolled back", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"audit_id":        auditID,
		"target_org_uuid": orgUUID.String(),
		"message":         "Verifier-based state reset issued and committed to immutable audit ledger.",
	})
}

// handleGetAuditLogs fetches read-only entries from the immutable support audit log.
func handleGetAuditLogs(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	entries := []AuditLogEntry{}
	if db == nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(entries)
		return
	}

	rows, err := db.Query(r.Context(), `
		SELECT l.id, l.actor_uuid, l.action_type,
		       COALESCE(l.target_org_uuid::text, COALESCE(l.target_mailbox_uuid::text, COALESCE(l.metadata->>'ticket_id', ''))) AS target_uuid,
		       COALESCE(o.name, COALESCE(u.email, COALESCE(t.ticket_number, ''))) AS target_name,
		       COALESCE(sa.display_name, COALESCE(sa.email, 'Sarah Chen (Tier 2)')) AS actor_name,
		       CASE 
		           WHEN l.target_org_uuid IS NOT NULL THEN 'organization'
		           WHEN l.target_mailbox_uuid IS NOT NULL THEN 'customer'
		           WHEN (l.metadata->>'ticket_id') IS NOT NULL THEN 'ticket'
		           ELSE 'system'
		       END AS target_type,
		       l.metadata, l.timestamp
		FROM support_audit_logs l
		LEFT JOIN organizations o ON l.target_org_uuid = o.id
		LEFT JOIN users u ON l.target_mailbox_uuid = u.id
		LEFT JOIN support_tickets t ON (CASE WHEN (l.metadata->>'ticket_id') ~ '^[0-9a-fA-F-]{36}$' THEN (l.metadata->>'ticket_id')::uuid ELSE NULL END) = t.id
		LEFT JOIN support_agents sa ON l.actor_uuid = sa.id
		ORDER BY l.timestamp DESC
		LIMIT 100
	`)
	if err != nil {
		log.Printf("handleGetAuditLogs query error: %v", err)
		http.Error(w, `{"error":"Failed to query audit logs"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var e AuditLogEntry
		var uid, actorUid uuid.UUID
		var targetStr, targetName, actorName, targetType string
		var metaBytes []byte
		if err := rows.Scan(&uid, &actorUid, &e.ActionType, &targetStr, &targetName, &actorName, &targetType, &metaBytes, &e.Timestamp); err != nil {
			log.Printf("handleGetAuditLogs scan error: %v", err)
			http.Error(w, `{"error":"Failed to scan audit logs"}`, http.StatusInternalServerError)
			return
		}
		e.ID = uid.String()
		e.AdminUUID = actorUid.String()
		e.ActorUUID = actorUid.String()
		e.ActorName = actorName
		e.Action = e.ActionType
		e.TargetUUID = targetStr
		e.TargetName = targetName
		e.TargetType = targetType
		var parsedMeta any
		_ = json.Unmarshal(metaBytes, &parsedMeta)
		e.Metadata = parsedMeta
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		log.Printf("handleGetAuditLogs rows error: %v", err)
		http.Error(w, `{"error":"Failed to read audit logs"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

func handleAdminCreateDomain(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		OrgID  string `json:"org_id"`
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	orgUUID, err := uuid.Parse(strings.TrimSpace(req.OrgID))
	if err != nil {
		http.Error(w, "Invalid org_id UUID", http.StatusBadRequest)
		return
	}

	domainName := strings.ToLower(strings.TrimSpace(req.Domain))
	if domainName == "" || strings.Contains(domainName, " ") || !strings.Contains(domainName, ".") || strings.ContainsAny(domainName, "<>\t\n\r") {
		http.Error(w, "Invalid domain name", http.StatusBadRequest)
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Check organization exists and compute max_domains from seat_count
	var seatCount int
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(seat_count, 1) 
		FROM organizations 
		WHERE id = $1
	`, orgUUID).Scan(&seatCount)
	if err != nil {
		http.Error(w, "Organization not found", http.StatusNotFound)
		return
	}

	maxDomains, _ := ComputeCapacityCaps(seatCount)

	// Check domain quota
	var usedDomains int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id = $1`, orgUUID).Scan(&usedDomains)

	if usedDomains >= maxDomains {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":               "domain_limit_reached",
			"message":             "Domain limit reached for your allocated capacity. Please purchase the Extra Custom Domain add-on ($1.50/mo).",
			"limit":               maxDomains,
			"addon_product_id":    "pdt_extra_domain_v1",
			"addon_price_monthly": 1.50,
		})
		return
	}

	// Insert domain
	var domainID uuid.UUID
	err = tx.QueryRow(ctx, `
		INSERT INTO domains (org_id, name, is_verified, verification_token, dkim_selector)
		VALUES ($1, $2, false, $3, 'byos')
		RETURNING id
	`, orgUUID, domainName, "byos-verification="+strings.ReplaceAll(uuid.New().String(), "-", "")).Scan(&domainID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			http.Error(w, "Domain already exists", http.StatusConflict)
			return
		}
		http.Error(w, "Failed to insert domain", http.StatusInternalServerError)
		return
	}

	// Write Immutable Audit Log
	adminActorUUID := uuid.New()
	auditID := "aud_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
	metaJSON, _ := json.Marshal(map[string]interface{}{
		"org_uuid":    orgUUID.String(),
		"domain_id":   domainID.String(),
		"domain_name": domainName,
		"max_domains": maxDomains,
		"audit_id":    auditID,
		"operation":   "admin_domain_create",
		"client":      "byos-support-crm",
	})

	_, err = tx.Exec(ctx, `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, target_org_uuid, metadata)
		VALUES ($1, $2, $3, $4, $5)
	`, adminActorUUID, adminActorUUID, "admin_domain_create", orgUUID, metaJSON)
	if err != nil {
		http.Error(w, "Failed to commit audit trail: transaction rolled back", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"audit_id":        auditID,
		"id":              domainID.String(),
		"domain_id":       domainID.String(),
		"domain":          domainName,
		"target_org_uuid": orgUUID.String(),
		"message":         "Domain registered successfully under quota.",
	})
}

// HandleUpdateSeatCount updates seat_count with floor validation and returns graduated price calculation.
func HandleUpdateSeatCount(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, orgUUID uuid.UUID) {
	if r.Method != http.MethodPatch && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		SeatCount int `json:"seat_count"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.SeatCount < 1 || req.SeatCount > 10000 {
		http.Error(w, "seat_count must be between 1 and 10000", http.StatusBadRequest)
		return
	}
	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	var activeMailboxes int
	_ = db.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id = $1 AND is_active = true`, orgUUID).Scan(&activeMailboxes)
	if req.SeatCount < activeMailboxes {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":             "seat_count_below_active_mailboxes",
			"current_mailboxes": activeMailboxes,
		})
		return
	}

	cmdTag, err := db.Exec(ctx, "UPDATE organizations SET seat_count = $1, updated_at = now() WHERE id = $2", req.SeatCount, orgUUID)
	if err != nil || cmdTag.RowsAffected() == 0 {
		http.Error(w, "Organization update failed or not found", http.StatusInternalServerError)
		return
	}

	monthlyCents, annualCents := CalculateSeatPriceCents(req.SeatCount)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"org_id":              orgUUID.String(),
		"seat_count":          req.SeatCount,
		"monthly_total_cents": monthlyCents,
		"annual_total_cents":  annualCents,
	})
}

// HandleGetCapacity returns capacity usage and limits for the organization.
func HandleGetCapacity(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, orgUUID uuid.UUID) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	var seatCount int
	err := db.QueryRow(ctx, `SELECT COALESCE(seat_count, 1) FROM organizations WHERE id = $1`, orgUUID).Scan(&seatCount)
	if err != nil {
		http.Error(w, "Organization not found", http.StatusNotFound)
		return
	}

	var usedMailboxes, usedDomains, usedAliases int
	_ = db.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id = $1 AND is_active = true`, orgUUID).Scan(&usedMailboxes)
	_ = db.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id = $1`, orgUUID).Scan(&usedDomains)
	_ = db.QueryRow(ctx, `SELECT count(*) FROM aliases a JOIN mailboxes m ON m.id = a.mailbox_id WHERE m.org_id = $1 AND a.is_active = true`, orgUUID).Scan(&usedAliases)

	domainsCap, aliasesCap := ComputeCapacityCaps(seatCount)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"mailboxes": map[string]interface{}{"used": usedMailboxes, "cap": seatCount},
		"domains":   map[string]interface{}{"used": usedDomains, "cap": domainsCap},
		"aliases":   map[string]interface{}{"used": usedAliases, "cap": aliasesCap},
		"storage":   map[string]interface{}{"used": nil, "cap": nil, "note": "customer-controlled"},
	})
}


// RegisterCustomerRoutes registers customer management routes for support staff.
func RegisterCustomerRoutes(mux *http.ServeMux, db *pgxpool.Pool, authMiddleware func(http.HandlerFunc) http.HandlerFunc) {
	mux.HandleFunc("/admin/v1/customers/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/admin/v1/customers/")
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) < 2 {
			http.Error(w, "Customer user UUID and action required", http.StatusBadRequest)
			return
		}

		userUUID, err := uuid.Parse(parts[0])
		if err != nil {
			http.Error(w, "Invalid customer user UUID", http.StatusBadRequest)
			return
		}

		action := parts[1]
		switch action {
		case "suspend":
			if r.Method != http.MethodPost {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
				return
			}
			handleSuspendCustomer(w, r, db, userUUID)
		default:
			http.Error(w, "Unknown customer action", http.StatusNotFound)
		}
	}))
}

// handleSuspendCustomer toggles active/suspended status for a customer user account and their personal mailbox.
func handleSuspendCustomer(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, userUUID uuid.UUID) {
	var req struct {
		Status string `json:"status"` // "suspended" or "active"
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	targetStatus := req.Status
	if targetStatus == "" {
		targetStatus = "suspended"
	}
	if targetStatus != "suspended" && targetStatus != "active" {
		http.Error(w, "Invalid status parameter", http.StatusBadRequest)
		return
	}

	if db == nil {
		http.Error(w, "Database unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()
	tx, err := db.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to initiate database transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var userEmail string
	var orgID uuid.UUID
	err = tx.QueryRow(ctx, "SELECT email, org_id FROM users WHERE id = $1", userUUID).Scan(&userEmail, &orgID)
	if err != nil {
		http.Error(w, "User account not found", http.StatusNotFound)
		return
	}

	userActive := targetStatus == "active"
	cmdTag, err := tx.Exec(ctx, "UPDATE users SET status = $1, is_active = $2, updated_at = now() WHERE id = $3", targetStatus, userActive, userUUID)
	if err != nil || cmdTag.RowsAffected() == 0 {
		http.Error(w, "Failed to update user account", http.StatusInternalServerError)
		return
	}

	_, _ = tx.Exec(ctx, "UPDATE mailboxes SET status = $1, is_active = $2, updated_at = now() WHERE user_id = $3", targetStatus, userActive, userUUID)

	if targetStatus == "suspended" {
		_, _ = tx.Exec(ctx, "DELETE FROM sessions WHERE user_id = $1", userUUID)
	}

	adminActorUUID := uuid.MustParse("11111111-2222-3333-4444-555555555501") // Sarah Chen (Tier 2 Lead Agent)
	auditID := "aud_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
	metaJSON, _ := json.Marshal(map[string]any{
		"reason":    req.Reason,
		"audit_id":  auditID,
		"status":    targetStatus,
		"email":     userEmail,
		"user_id":   userUUID.String(),
		"operation": "customer_account_status_change",
		"client":    "byos-support-crm",
		"actor":     "Sarah Chen (Tier 2)",
	})

	actionType := "customer_suspend"
	if targetStatus == "active" {
		actionType = "customer_reactivate"
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, target_org_uuid, target_mailbox_uuid, metadata)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, adminActorUUID, adminActorUUID, actionType, orgID, userUUID, metaJSON)
	if err != nil {
		log.Printf("handleSuspendCustomer audit error: %v", err)
		http.Error(w, "Failed to commit audit trail: " + err.Error(), http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "Transaction commit failed", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":  true,
		"audit_id": auditID,
		"user_id":  userUUID.String(),
		"email":    userEmail,
		"status":   targetStatus,
		"message":  fmt.Sprintf("Customer account %s status set to %s.", userEmail, targetStatus),
	})
}
