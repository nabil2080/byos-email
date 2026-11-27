package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QueueOverviewResponse models aggregate health and depth metrics for the outbound delivery queue.
type QueueOverviewResponse struct {
	Status           string            `json:"status"` // healthy, degraded, critical
	Counts           map[string]int64  `json:"counts"`
	OldestAgeSeconds map[string]int64  `json:"oldest_age_seconds"`
	Timestamp        time.Time         `json:"timestamp"`
}

// QueueMessageItem represents a single outbound queue envelope metadata row (strictly zero-knowledge).
type QueueMessageItem struct {
	ID                   string     `json:"id"`
	DeliveryID           string     `json:"delivery_id"`
	MailboxID            string     `json:"mailbox_id"`
	DomainID             string     `json:"domain_id"`
	Recipient            string     `json:"recipient"`
	Status               string     `json:"status"`
	Attempts             int        `json:"attempts"`
	MaxAttempts          int        `json:"max_attempts"`
	NextAttemptAt        time.Time  `json:"next_attempt_at"`
	CreatedAt            time.Time  `json:"created_at"`
	DeliveredAt          *time.Time `json:"delivered_at,omitempty"`
	FailedAt             *time.Time `json:"failed_at,omitempty"`
	ExpiresAt            time.Time  `json:"expires_at"`
	LeaseToken           *string    `json:"lease_token,omitempty"`
	LeaseOwner           *string    `json:"lease_owner,omitempty"`
	ClaimedAt            *time.Time `json:"claimed_at,omitempty"`
	LeaseExpiresAt       *time.Time `json:"lease_expires_at,omitempty"`
	IsLeaseActive        bool       `json:"is_lease_active"`
	SMTPPhase            *string    `json:"smtp_phase,omitempty"`
	LastSMTPCode         *int       `json:"last_smtp_code,omitempty"`
	LastError            *string    `json:"last_error,omitempty"`
	ReconciledAt         *time.Time `json:"reconciled_at,omitempty"`
	ReconciledBy         *string    `json:"reconciled_by,omitempty"`
	ReconciliationReason *string    `json:"reconciliation_reason,omitempty"`
	ManualRetryCount     int        `json:"manual_retry_count"`
	MaxManualRetries     int        `json:"max_manual_retries"`
}

// QueueMessageListResponse models paginated message envelopes.
type QueueMessageListResponse struct {
	Messages []QueueMessageItem `json:"messages"`
	Total    int64              `json:"total"`
	Limit    int                `json:"limit"`
	Offset   int                `json:"offset"`
}

// DeliveryLogHistoryItem models an attempt or state transition recorded in delivery_log.
type DeliveryLogHistoryItem struct {
	ID          string    `json:"id"`
	DeliveryID  string    `json:"delivery_id"`
	Direction   string    `json:"direction"`
	Status      string    `json:"status"`
	SMTPCode    *int      `json:"smtp_code,omitempty"`
	SMTPMessage *string   `json:"smtp_message,omitempty"`
	AttemptedAt time.Time `json:"attempted_at"`
	LeaseToken  *string   `json:"lease_token,omitempty"`
	SMTPPhase   *string   `json:"smtp_phase,omitempty"`
}

// OperatorAuditItem models an immutable operator action from outbound_delivery_operator_audit.
type OperatorAuditItem struct {
	ID                      string    `json:"id"`
	CreatedAt               time.Time `json:"created_at"`
	ActorID                 string    `json:"actor_id"`
	ActorEmail              string    `json:"actor_email"`
	ActorRole               string    `json:"actor_role"`
	Action                  string    `json:"action"`
	QueueID                 string    `json:"queue_id"`
	DeliveryID              string    `json:"delivery_id"`
	PreviousStatus          string    `json:"previous_status"`
	ResultingStatus         string    `json:"resulting_status"`
	ResolutionCategory      *string   `json:"resolution_category,omitempty"`
	OperatorReason          string    `json:"operator_reason"`
	EvidenceCategory        *string   `json:"evidence_category,omitempty"`
	EvidenceReference       *string   `json:"evidence_reference,omitempty"`
	EvidenceProvenance      string    `json:"evidence_provenance"`
	IsIndependentlyVerified bool      `json:"is_independently_verified"`
	IdempotencyKey          *string   `json:"idempotency_key,omitempty"`
	RequestFingerprint      *string   `json:"request_fingerprint,omitempty"`
	IPAddress               *string   `json:"ip_address,omitempty"`
	UserAgent               *string   `json:"user_agent,omitempty"`
}

// QueueMessageDetailResponse models the complete diagnostic and audit view of a queue item.
type QueueMessageDetailResponse struct {
	Message      QueueMessageItem         `json:"message"`
	DeliveryLogs []DeliveryLogHistoryItem `json:"delivery_logs"`
	AuditTrail   []OperatorAuditItem      `json:"audit_trail"`
}

// ReconcileRequest models the input payload for reconciling an outcome_unknown queue item.
// Note: evidence_provenance and is_independently_verified are intentionally excluded from client DTO.
type ReconcileRequest struct {
	Action                    string `json:"action"` // resolve_accepted, authorize_retry, resolve_bounced, add_note
	OperatorReason            string `json:"operator_reason"`
	ResolutionCategory        string `json:"resolution_category,omitempty"`
	EvidenceCategory          string `json:"evidence_category,omitempty"`
	EvidenceReference         string `json:"evidence_reference,omitempty"`
	DuplicateRiskAcknowledged bool   `json:"duplicate_risk_acknowledged,omitempty"`
	IdempotencyKey            string `json:"idempotency_key,omitempty"`
}

// calculateRequestFingerprint derives a canonical cryptographic digest of the semantic operation parameters.
func calculateRequestFingerprint(actorID string, queueID uuid.UUID, action, reason, evCat, evRef, resCat string, dupAck bool) string {
	canonical := fmt.Sprintf(
		"action:%s|actor:%s|category:%s|dup:%t|queue:%s|reason:%s|ref:%s|resolution:%s",
		strings.TrimSpace(action),
		strings.TrimSpace(actorID),
		strings.TrimSpace(evCat),
		dupAck,
		queueID.String(),
		strings.TrimSpace(reason),
		strings.TrimSpace(evRef),
		strings.TrimSpace(resCat),
	)
	h := sha256.Sum256([]byte(canonical))
	return fmt.Sprintf("%x", h)
}

// ReconcileResponse models the outcome of an operator reconciliation.
type ReconcileResponse struct {
	Success                 bool      `json:"success"`
	Action                  string    `json:"action"`
	QueueID                 string    `json:"queue_id"`
	DeliveryID              string    `json:"delivery_id"`
	PreviousStatus          string    `json:"previous_status"`
	ResultingStatus         string    `json:"resulting_status"`
	ReconciledAt            time.Time `json:"reconciled_at"`
	ReconciledBy            string    `json:"reconciled_by"`
	AuditID                 string    `json:"audit_id"`
	EvidenceProvenance      string    `json:"evidence_provenance"`
	IsIndependentlyVerified bool      `json:"is_independently_verified"`
	IdempotentReplay        bool      `json:"idempotent_replay,omitempty"`
}

// QueueAlertItem represents a detected queue anomaly or stuck item.
type QueueAlertItem struct {
	Type        string   `json:"type"`     // stale_lease, stuck_pending, outcome_unknown_quarantine
	Severity    string   `json:"severity"` // warning, critical
	Count       int      `json:"count"`
	Message     string   `json:"message"`
	SampleIDs   []string `json:"sample_ids"`
}

// QueueAlertsResponse models the response for queue health alerts.
type QueueAlertsResponse struct {
	Status string           `json:"status"` // healthy, warning, critical
	Alerts []QueueAlertItem `json:"alerts"`
}

// RegisterQueueRoutes registers all delivery operations, reconciliation, and observability endpoints.
func RegisterQueueRoutes(mux *http.ServeMux, db *pgxpool.Pool, authMiddleware func(http.HandlerFunc) http.HandlerFunc) {
	// Standard admin path prefix
	mux.HandleFunc("/admin/v1/queue/overview", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueOverview(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/admin/v1/queue/messages", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueListMessages(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/admin/v1/queue/messages/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		handleQueueMessageDispatcher(w, r, db, "/admin/v1/queue/messages/")
	}))

	mux.HandleFunc("/admin/v1/queue/alerts", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueAlerts(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/admin/v1/queue/metrics", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueMetrics(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))

	// Canonical /v1/admin/queue/... alias routes for specification parity
	mux.HandleFunc("/v1/admin/queue/overview", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueOverview(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/v1/admin/queue/messages", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueListMessages(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/v1/admin/queue/messages/", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		handleQueueMessageDispatcher(w, r, db, "/v1/admin/queue/messages/")
	}))

	mux.HandleFunc("/v1/admin/queue/alerts", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueAlerts(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))

	mux.HandleFunc("/v1/admin/queue/metrics", authMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			handleQueueMetrics(w, r, db)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	}))
}

// checkQueuePermission verifies server-side role authorization for queue operations.
func checkQueuePermission(r *http.Request, capability string) (AgentIdentity, error) {
	identity, ok := GetAgentIdentity(r.Context())
	if !ok || identity.Role == "" {
		if IsDevModeEnabled() {
			return AgentIdentity{
				ActorID:  "mock-support-agent",
				Email:    "admin@byos.local",
				Role:     "support_agent",
				AuthType: "mock",
			}, nil
		}
		return AgentIdentity{}, errors.New("unauthorized")
	}

	switch identity.Role {
	case "platform_admin", "admin":
		return identity, nil

	case "support_agent", "senior_agent", "agent":
		return identity, nil

	case "read_only_operator", "support_read_only":
		if capability == "mutate" {
			return identity, errors.New("forbidden_read_only")
		}
		return identity, nil

	default:
		// Ordinary user, organization admin, or unknown role
		return identity, errors.New("forbidden_role")
	}
}

// extractOperatorIdentity extracts authenticated operator metadata strictly from server-side session context.
// Client-supplied headers (X-Operator-Role, X-Operator-Email, etc.) are strictly ignored to prevent
// privilege escalation or audit spoofing.
func extractOperatorIdentity(r *http.Request) (actorID, actorEmail, actorRole, ipAddress, userAgent string) {
	ipAddress = r.Header.Get("X-Forwarded-For")
	if ipAddress == "" {
		ipAddress = r.RemoteAddr
	}
	if commaIdx := strings.Index(ipAddress, ","); commaIdx != -1 {
		ipAddress = strings.TrimSpace(ipAddress[:commaIdx])
	}
	userAgent = r.UserAgent()

	if id, ok := GetAgentIdentity(r.Context()); ok && id.ActorID != "" {
		return id.ActorID, id.Email, id.Role, ipAddress, userAgent
	}

	if IsDevModeEnabled() {
		return "mock-support-agent", "admin@byos.local", "support_agent", ipAddress, userAgent
	}

	return "operator-system", "operator@byos.local", "support_agent", ipAddress, userAgent
}

// handleQueueOverview returns aggregate status counts and queue depth metrics.
func handleQueueOverview(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	w.Header().Set("Content-Type", "application/json")
	if _, err := checkQueuePermission(r, "read"); err != nil {
		if err.Error() == "unauthorized" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		} else {
			http.Error(w, `{"error":"forbidden: insufficient role permissions for queue operations"}`, http.StatusForbidden)
		}
		return
	}
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}

	counts := map[string]int64{
		"pending":         0,
		"processing":      0,
		"retry_scheduled": 0,
		"outcome_unknown": 0,
		"delivered":       0,
		"bounced":         0,
		"expired":         0,
		"delivered_24h":   0,
		"bounced_24h":     0,
		"expired_24h":     0,
	}

	// 1. Query status distribution
	rows, err := db.Query(r.Context(), `
		SELECT status, COUNT(*)
		FROM outbound_queue
		GROUP BY status
	`)
	if err != nil {
		log.Printf("handleQueueOverview query error: %v", err)
		http.Error(w, `{"error":"failed to query queue counts"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var st string
		var cnt int64
		if err := rows.Scan(&st, &cnt); err == nil {
			counts[st] = cnt
		}
	}

	// 2. Query retry_scheduled (pending items with attempts > 0 and next_attempt_at in the future)
	var retryScheduled int64
	_ = db.QueryRow(r.Context(), `
		SELECT COUNT(*)
		FROM outbound_queue
		WHERE status = 'pending' AND attempts > 0 AND next_attempt_at > clock_timestamp()
	`).Scan(&retryScheduled)
	counts["retry_scheduled"] = retryScheduled

	// 3. Query 24h terminal windows
	var del24, bnc24, exp24 int64
	_ = db.QueryRow(r.Context(), `
		SELECT
			COALESCE(COUNT(*) FILTER (WHERE status = 'delivered' AND delivered_at > clock_timestamp() - interval '24 hours'), 0),
			COALESCE(COUNT(*) FILTER (WHERE status = 'bounced' AND failed_at > clock_timestamp() - interval '24 hours'), 0),
			COALESCE(COUNT(*) FILTER (WHERE status = 'expired' AND failed_at > clock_timestamp() - interval '24 hours'), 0)
		FROM outbound_queue
	`).Scan(&del24, &bnc24, &exp24)
	counts["delivered_24h"] = del24
	counts["bounced_24h"] = bnc24
	counts["expired_24h"] = exp24

	// 4. Query oldest age metrics
	oldestAges := map[string]int64{
		"pending":         0,
		"processing":      0,
		"outcome_unknown": 0,
	}

	var oldestPending, oldestProcessing, oldestUnknown *float64
	_ = db.QueryRow(r.Context(), `
		SELECT
			EXTRACT(EPOCH FROM (clock_timestamp() - MIN(created_at))) FILTER (WHERE status = 'pending'),
			EXTRACT(EPOCH FROM (clock_timestamp() - MIN(claimed_at))) FILTER (WHERE status = 'processing'),
			EXTRACT(EPOCH FROM (clock_timestamp() - MIN(failed_at))) FILTER (WHERE status = 'outcome_unknown')
		FROM outbound_queue
	`).Scan(&oldestPending, &oldestProcessing, &oldestUnknown)

	if oldestPending != nil && *oldestPending > 0 {
		oldestAges["pending"] = int64(*oldestPending)
	}
	if oldestProcessing != nil && *oldestProcessing > 0 {
		oldestAges["processing"] = int64(*oldestProcessing)
	}
	if oldestUnknown != nil && *oldestUnknown > 0 {
		oldestAges["outcome_unknown"] = int64(*oldestUnknown)
	}

	// 5. Evaluate overall health status
	status := "healthy"
	if counts["outcome_unknown"] > 0 || oldestAges["pending"] > 300 {
		status = "degraded"
	}
	if counts["outcome_unknown"] > 10 || oldestAges["pending"] > 900 {
		status = "critical"
	}

	// Check if any stale processing lease exists
	var staleLeaseCount int64
	_ = db.QueryRow(r.Context(), `
		SELECT COUNT(*)
		FROM outbound_queue
		WHERE status = 'processing' AND lease_expires_at < clock_timestamp()
	`).Scan(&staleLeaseCount)
	if staleLeaseCount > 0 {
		status = "critical"
	}

	resp := QueueOverviewResponse{
		Status:           status,
		Counts:           counts,
		OldestAgeSeconds: oldestAges,
		Timestamp:        time.Now().UTC(),
	}

	_ = json.NewEncoder(w).Encode(resp)
}

// handleQueueListMessages returns a filtered, bounded list of queue envelopes without ciphertext or private data.
func handleQueueListMessages(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	w.Header().Set("Content-Type", "application/json")
	if _, err := checkQueuePermission(r, "read"); err != nil {
		if err.Error() == "unauthorized" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		} else {
			http.Error(w, `{"error":"forbidden: insufficient role permissions for queue operations"}`, http.StatusForbidden)
		}
		return
	}
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}

	limit := 50
	if lStr := r.URL.Query().Get("limit"); lStr != "" {
		if l, err := strconv.Atoi(lStr); err == nil && l > 0 {
			limit = l
			if limit > 100 {
				limit = 100
			}
		}
	}

	offset := 0
	if oStr := r.URL.Query().Get("offset"); oStr != "" {
		if o, err := strconv.Atoi(oStr); err == nil && o >= 0 {
			offset = o
		}
	}

	statusFilter := strings.TrimSpace(r.URL.Query().Get("status"))
	recipientFilter := strings.TrimSpace(r.URL.Query().Get("recipient"))
	domainIDFilter := strings.TrimSpace(r.URL.Query().Get("domain_id"))

	var conditions []string
	var args []any
	argIdx := 1

	if statusFilter != "" && statusFilter != "all" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, statusFilter)
		argIdx++
	}

	if recipientFilter != "" {
		conditions = append(conditions, fmt.Sprintf("recipient ILIKE $%d", argIdx))
		args = append(args, "%"+recipientFilter+"%")
		argIdx++
	}

	if domainIDFilter != "" {
		if domainUUID, err := uuid.Parse(domainIDFilter); err == nil {
			conditions = append(conditions, fmt.Sprintf("domain_id = $%d", argIdx))
			args = append(args, domainUUID)
			argIdx++
		}
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	// Count total
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM outbound_queue %s", whereClause)
	var total int64
	if err := db.QueryRow(r.Context(), countQuery, args...).Scan(&total); err != nil {
		log.Printf("handleQueueListMessages count error: %v", err)
		http.Error(w, `{"error":"failed to count queue messages"}`, http.StatusInternalServerError)
		return
	}

	// Fetch page
	listQuery := fmt.Sprintf(`
		SELECT
			id, delivery_id, mailbox_id, domain_id, recipient, status,
			attempts, max_attempts, next_attempt_at, created_at, delivered_at, failed_at, expires_at,
			lease_token, lease_owner, claimed_at, lease_expires_at,
			smtp_phase, last_smtp_code, last_error,
			reconciled_at, reconciled_by, reconciliation_reason,
			manual_retry_count, max_manual_retries
		FROM outbound_queue
		%s
		ORDER BY created_at DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, argIdx, argIdx+1)

	args = append(args, limit, offset)

	rows, err := db.Query(r.Context(), listQuery, args...)
	if err != nil {
		log.Printf("handleQueueListMessages query error: %v", err)
		http.Error(w, `{"error":"failed to query queue messages"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	now := time.Now()
	items := make([]QueueMessageItem, 0)

	for rows.Next() {
		var item QueueMessageItem
		var qID, dID, mID, domID uuid.UUID
		var leaseTok *uuid.UUID
		var lastSmtp *int

		err := rows.Scan(
			&qID, &dID, &mID, &domID, &item.Recipient, &item.Status,
			&item.Attempts, &item.MaxAttempts, &item.NextAttemptAt, &item.CreatedAt, &item.DeliveredAt, &item.FailedAt, &item.ExpiresAt,
			&leaseTok, &item.LeaseOwner, &item.ClaimedAt, &item.LeaseExpiresAt,
			&item.SMTPPhase, &lastSmtp, &item.LastError,
			&item.ReconciledAt, &item.ReconciledBy, &item.ReconciliationReason,
			&item.ManualRetryCount, &item.MaxManualRetries,
		)
		if err != nil {
			log.Printf("handleQueueListMessages row scan error: %v", err)
			continue
		}

		item.ID = qID.String()
		item.DeliveryID = dID.String()
		item.MailboxID = mID.String()
		item.DomainID = domID.String()
		if leaseTok != nil {
			ltStr := leaseTok.String()
			item.LeaseToken = &ltStr
		}
		item.LastSMTPCode = lastSmtp

		if item.Status == "processing" && item.LeaseExpiresAt != nil && item.LeaseExpiresAt.After(now) {
			item.IsLeaseActive = true
		}

		items = append(items, item)
	}

	resp := QueueMessageListResponse{
		Messages: items,
		Total:    total,
		Limit:    limit,
		Offset:   offset,
	}

	_ = json.NewEncoder(w).Encode(resp)
}

// handleQueueMessageDispatcher routes message sub-paths: /{id}, /{id}/reconcile, /{id}/audit.
func handleQueueMessageDispatcher(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, routePrefix string) {
	subPath := strings.TrimPrefix(r.URL.Path, routePrefix)
	parts := strings.Split(strings.Trim(subPath, "/"), "/")

	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, `{"error":"missing queue message identifier"}`, http.StatusBadRequest)
		return
	}

	idStr := parts[0]
	queueID, err := uuid.Parse(idStr)
	if err != nil {
		http.Error(w, `{"error":"invalid queue message UUID"}`, http.StatusBadRequest)
		return
	}

	if len(parts) == 1 {
		if r.Method == http.MethodGet {
			handleGetQueueMessageDetail(w, r, db, queueID)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
		return
	}

	switch parts[1] {
	case "reconcile":
		if r.Method == http.MethodPost {
			handleReconcileQueueMessage(w, r, db, queueID)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	case "audit":
		if r.Method == http.MethodGet {
			handleGetQueueMessageAudit(w, r, db, queueID)
		} else {
			http.Error(w, `{"error":"Method not allowed"}`, http.StatusMethodNotAllowed)
		}
	default:
		http.Error(w, `{"error":"unknown queue sub-resource"}`, http.StatusNotFound)
	}
}

// handleGetQueueMessageDetail returns the full diagnostic envelope, attempt history, and audit ledger.
func handleGetQueueMessageDetail(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, queueID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")
	if _, err := checkQueuePermission(r, "read"); err != nil {
		if err.Error() == "unauthorized" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		} else {
			http.Error(w, `{"error":"forbidden: insufficient role permissions for queue operations"}`, http.StatusForbidden)
		}
		return
	}
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}

	var item QueueMessageItem
	var qID, dID, mID, domID uuid.UUID
	var leaseTok *uuid.UUID
	var lastSmtp *int

	err := db.QueryRow(r.Context(), `
		SELECT
			id, delivery_id, mailbox_id, domain_id, recipient, status,
			attempts, max_attempts, next_attempt_at, created_at, delivered_at, failed_at, expires_at,
			lease_token, lease_owner, claimed_at, lease_expires_at,
			smtp_phase, last_smtp_code, last_error,
			reconciled_at, reconciled_by, reconciliation_reason,
			manual_retry_count, max_manual_retries
		FROM outbound_queue
		WHERE id = $1
	`, queueID).Scan(
		&qID, &dID, &mID, &domID, &item.Recipient, &item.Status,
		&item.Attempts, &item.MaxAttempts, &item.NextAttemptAt, &item.CreatedAt, &item.DeliveredAt, &item.FailedAt, &item.ExpiresAt,
		&leaseTok, &item.LeaseOwner, &item.ClaimedAt, &item.LeaseExpiresAt,
		&item.SMTPPhase, &lastSmtp, &item.LastError,
		&item.ReconciledAt, &item.ReconciledBy, &item.ReconciliationReason,
		&item.ManualRetryCount, &item.MaxManualRetries,
	)
	if err == pgx.ErrNoRows {
		http.Error(w, `{"error":"queue message not found"}`, http.StatusNotFound)
		return
	} else if err != nil {
		log.Printf("handleGetQueueMessageDetail query error: %v", err)
		http.Error(w, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}

	item.ID = qID.String()
	item.DeliveryID = dID.String()
	item.MailboxID = mID.String()
	item.DomainID = domID.String()
	if leaseTok != nil {
		ltStr := leaseTok.String()
		item.LeaseToken = &ltStr
	}
	item.LastSMTPCode = lastSmtp
	if item.Status == "processing" && item.LeaseExpiresAt != nil && item.LeaseExpiresAt.After(time.Now()) {
		item.IsLeaseActive = true
	}

	// Fetch delivery logs for delivery_id
	logs := make([]DeliveryLogHistoryItem, 0)
	logRows, err := db.Query(r.Context(), `
		SELECT id, delivery_id, direction, status, smtp_code, smtp_message, created_at, lease_token, smtp_phase
		FROM delivery_log
		WHERE delivery_id = $1
		ORDER BY created_at ASC
	`, dID)
	if err == nil {
		defer logRows.Close()
		for logRows.Next() {
			var l DeliveryLogHistoryItem
			var logID, delID uuid.UUID
			var lt *uuid.UUID
			var code *int
			var msg, phase *string
			if err := logRows.Scan(&logID, &delID, &l.Direction, &l.Status, &code, &msg, &l.AttemptedAt, &lt, &phase); err == nil {
				l.ID = logID.String()
				l.DeliveryID = delID.String()
				l.SMTPCode = code
				l.SMTPMessage = msg
				l.SMTPPhase = phase
				if lt != nil {
					ltStr := lt.String()
					l.LeaseToken = &ltStr
				}
				logs = append(logs, l)
			}
		}
	}

	// Fetch operator audit history for queueID
	audits := fetchAuditTrail(r.Context(), db, queueID)

	resp := QueueMessageDetailResponse{
		Message:      item,
		DeliveryLogs: logs,
		AuditTrail:   audits,
	}

	_ = json.NewEncoder(w).Encode(resp)
}

// fetchAuditTrail queries outbound_delivery_operator_audit for a given queueID.
func fetchAuditTrail(ctx context.Context, db *pgxpool.Pool, queueID uuid.UUID) []OperatorAuditItem {
	audits := make([]OperatorAuditItem, 0)
	auditRows, err := db.Query(ctx, `
		SELECT
			id, created_at, actor_id, actor_email, actor_role, action,
			queue_id, delivery_id, previous_status, resulting_status,
			resolution_category, operator_reason, evidence_category, evidence_reference,
			ip_address, user_agent,
			evidence_provenance, is_independently_verified, idempotency_key, request_fingerprint
		FROM outbound_delivery_operator_audit
		WHERE queue_id = $1
		ORDER BY created_at DESC
	`, queueID)
	if err == nil {
		defer auditRows.Close()
		for auditRows.Next() {
			var a OperatorAuditItem
			var aID, qID, dID uuid.UUID
			if err := auditRows.Scan(
				&aID, &a.CreatedAt, &a.ActorID, &a.ActorEmail, &a.ActorRole, &a.Action,
				&qID, &dID, &a.PreviousStatus, &a.ResultingStatus,
				&a.ResolutionCategory, &a.OperatorReason, &a.EvidenceCategory, &a.EvidenceReference,
				&a.IPAddress, &a.UserAgent,
				&a.EvidenceProvenance, &a.IsIndependentlyVerified, &a.IdempotencyKey, &a.RequestFingerprint,
			); err == nil {
				a.ID = aID.String()
				a.QueueID = qID.String()
				a.DeliveryID = dID.String()
				audits = append(audits, a)
			}
		}
	}
	return audits
}

// handleGetQueueMessageAudit returns the audit trail for a single queue item.
func handleGetQueueMessageAudit(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, queueID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")
	if _, err := checkQueuePermission(r, "read"); err != nil {
		if err.Error() == "unauthorized" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		} else {
			http.Error(w, `{"error":"forbidden: insufficient role permissions for queue operations"}`, http.StatusForbidden)
		}
		return
	}
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}

	audits := fetchAuditTrail(r.Context(), db, queueID)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"queue_id":    queueID.String(),
		"audit_count": len(audits),
		"audit_trail": audits,
	})
}

// handleReconcileQueueMessage safely reconciles an outcome_unknown item with optimistic concurrency, lease fencing, idempotency isolation, retry governance, and immutable audit logging.
func handleReconcileQueueMessage(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool, queueID uuid.UUID) {
	w.Header().Set("Content-Type", "application/json")

	if _, err := checkQueuePermission(r, "mutate"); err != nil {
		if err.Error() == "unauthorized" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		} else if err.Error() == "forbidden_read_only" {
			http.Error(w, `{"error":"forbidden: read-only operator cannot perform queue mutations"}`, http.StatusForbidden)
		} else {
			http.Error(w, `{"error":"forbidden: insufficient role permissions for queue operations"}`, http.StatusForbidden)
		}
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error":"failed to read request body"}`, http.StatusBadRequest)
		return
	}

	var rawMap map[string]any
	if err := json.Unmarshal(bodyBytes, &rawMap); err != nil {
		http.Error(w, `{"error":"invalid request payload"}`, http.StatusBadRequest)
		return
	}

	// Pillar 3: Server-controlled evidence provenance. Reject client attempts to submit verification metadata.
	if _, exists := rawMap["evidence_provenance"]; exists {
		http.Error(w, `{"error":"unsupported client field: evidence_provenance is server-controlled and cannot be set by clients"}`, http.StatusBadRequest)
		return
	}
	if _, exists := rawMap["is_independently_verified"]; exists {
		http.Error(w, `{"error":"unsupported client field: is_independently_verified is server-controlled and cannot be set by clients"}`, http.StatusBadRequest)
		return
	}
	if _, exists := rawMap["verifier_id"]; exists {
		http.Error(w, `{"error":"unsupported client field: verifier_id is server-controlled and cannot be set by clients"}`, http.StatusBadRequest)
		return
	}
	if _, exists := rawMap["verification_timestamp"]; exists {
		http.Error(w, `{"error":"unsupported client field: verification_timestamp is server-controlled and cannot be set by clients"}`, http.StatusBadRequest)
		return
	}

	var req ReconcileRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		http.Error(w, `{"error":"invalid request payload"}`, http.StatusBadRequest)
		return
	}

	req.Action = strings.TrimSpace(req.Action)
	req.OperatorReason = strings.TrimSpace(req.OperatorReason)
	req.EvidenceCategory = strings.TrimSpace(req.EvidenceCategory)
	req.EvidenceReference = strings.TrimSpace(req.EvidenceReference)
	req.ResolutionCategory = strings.TrimSpace(req.ResolutionCategory)

	// Validate action
	switch req.Action {
	case "resolve_accepted", "authorize_retry", "resolve_bounced", "add_note":
		// valid
	default:
		http.Error(w, `{"error":"invalid action: must be one of 'resolve_accepted', 'authorize_retry', 'resolve_bounced', 'add_note'"}`, http.StatusBadRequest)
		return
	}

	// Validate reason
	if req.OperatorReason == "" {
		http.Error(w, `{"error":"operator_reason is strictly required for all reconciliation actions"}`, http.StatusBadRequest)
		return
	}

	// Validate evidence requirements per action
	if req.Action == "resolve_accepted" {
		if req.EvidenceCategory == "" || req.EvidenceReference == "" || req.EvidenceCategory == "insufficient" {
			http.Error(w, `{"error":"resolve_accepted requires evidence_category and evidence_reference (e.g. Postfix Queue ID, MTA log receipt); insufficient evidence cannot authorize acceptance"}`, http.StatusBadRequest)
			return
		}
	}

	if req.Action == "authorize_retry" {
		if req.EvidenceCategory == "" || req.EvidenceReference == "" || req.EvidenceCategory == "insufficient" {
			http.Error(w, `{"error":"authorize_retry requires evidence_category and evidence_reference"}`, http.StatusBadRequest)
			return
		}
		if !req.DuplicateRiskAcknowledged {
			http.Error(w, `{"error":"duplicate_risk_acknowledged must be true to authorize retransmission of an outcome_unknown email"}`, http.StatusBadRequest)
			return
		}
	}

	if req.Action == "resolve_bounced" {
		if req.EvidenceCategory == "" || req.EvidenceReference == "" || req.EvidenceCategory == "insufficient" {
			http.Error(w, `{"error":"resolve_bounced requires authoritative bounce evidence_category (e.g. smtp_5xx_rejection, dsn_bounce_report) and evidence_reference; insufficient evidence cannot authorize bounce resolution"}`, http.StatusBadRequest)
			return
		}
	}

	if req.Action == "add_note" {
		if req.EvidenceCategory != "" || req.EvidenceReference != "" {
			http.Error(w, `{"error":"action 'add_note' does not accept evidence metadata"}`, http.StatusBadRequest)
			return
		}
	}

	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}

	actorID, actorEmail, actorRole, ipAddress, userAgent := extractOperatorIdentity(r)

	// Server-controlled provenance: all operator actions are operator_attested
	evidenceProvenance := "operator_attested"
	isIndependentlyVerified := false

	// Idempotency key extraction
	idempotencyKey := strings.TrimSpace(req.IdempotencyKey)
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	}
	if idempotencyKey == "" {
		idempotencyKey = strings.TrimSpace(r.Header.Get("X-Idempotency-Key"))
	}

	// Compute semantic request fingerprint
	requestFingerprint := calculateRequestFingerprint(actorID, queueID, req.Action, req.OperatorReason, req.EvidenceCategory, req.EvidenceReference, req.ResolutionCategory, req.DuplicateRiskAcknowledged)

	// Begin atomic transaction
	tx, err := db.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		log.Printf("handleReconcileQueueMessage begin tx error: %v", err)
		http.Error(w, `{"error":"failed to begin transaction"}`, http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(r.Context())

	// Pillar 2: Request-Bound Idempotency Isolation
	if idempotencyKey != "" {
		var reservedKey string
		err := tx.QueryRow(r.Context(), `
			INSERT INTO delivery_operator_idempotency (
				idempotency_key, actor_id, actor_email, queue_id, action, request_fingerprint, status
			) VALUES ($1, $2, $3, $4, $5, $6, 'in_progress')
			ON CONFLICT (idempotency_key) DO NOTHING
			RETURNING idempotency_key
		`, idempotencyKey, actorID, actorEmail, queueID, req.Action, requestFingerprint).Scan(&reservedKey)

		if err == pgx.ErrNoRows {
			// Key already exists; query existing reservation record under row share lock
			var existingActorID, existingActorEmail, existingAction, existingFingerprint, existingStatus string
			var existingQueueID uuid.UUID
			var existingPayloadBytes []byte

			err := tx.QueryRow(r.Context(), `
				SELECT actor_id, actor_email, queue_id, action, request_fingerprint, status, response_payload
				FROM delivery_operator_idempotency
				WHERE idempotency_key = $1
				FOR SHARE
			`, idempotencyKey).Scan(
				&existingActorID, &existingActorEmail, &existingQueueID, &existingAction,
				&existingFingerprint, &existingStatus, &existingPayloadBytes,
			)

			if err != nil {
				log.Printf("failed to query existing idempotency record: %v", err)
				http.Error(w, `{"error":"database error evaluating idempotency key"}`, http.StatusInternalServerError)
				return
			}

			// Cross-actor reuse isolation
			if existingActorID != actorID || existingActorEmail != actorEmail {
				http.Error(w, `{"error":"idempotency key conflict: key was issued to a different authenticated operator"}`, http.StatusForbidden)
				return
			}

			// Cross-resource reuse isolation
			if existingQueueID != queueID {
				http.Error(w, `{"error":"idempotency key conflict: key was used for a different queue message"}`, http.StatusConflict)
				return
			}

			// Cross-action reuse isolation
			if existingAction != req.Action {
				http.Error(w, `{"error":"idempotency key conflict: key was used for a different reconciliation action"}`, http.StatusConflict)
				return
			}

			// Payload fingerprint mismatch
			if existingFingerprint != requestFingerprint {
				http.Error(w, `{"error":"idempotency key conflict: key reused with different request payload parameters"}`, http.StatusConflict)
				return
			}

			// In-progress concurrent operation
			if existingStatus == "in_progress" {
				http.Error(w, `{"error":"concurrent operation in progress for this idempotency key; please wait and retry"}`, http.StatusConflict)
				return
			}

			// Completed replay
			if len(existingPayloadBytes) > 0 {
				var cachedResp ReconcileResponse
				if err := json.Unmarshal(existingPayloadBytes, &cachedResp); err == nil {
					cachedResp.IdempotentReplay = true
					w.WriteHeader(http.StatusOK)
					_ = json.NewEncoder(w).Encode(cachedResp)
					return
				}
			}

			// Fallback: fetch from audit table if payload was empty
			var existingAuditID, existingDeliveryID uuid.UUID
			var existingPrevStatus, existingResultingStatus, existingAudActorEmail, existingAudProv, existingAudAction string
			var existingAudVerified bool
			var existingAudCreatedAt time.Time
			err = tx.QueryRow(r.Context(), `
				SELECT id, delivery_id, previous_status, resulting_status, actor_email,
				       evidence_provenance, is_independently_verified, created_at, action
				FROM outbound_delivery_operator_audit
				WHERE idempotency_key = $1
			`, idempotencyKey).Scan(
				&existingAuditID, &existingDeliveryID, &existingPrevStatus, &existingResultingStatus,
				&existingAudActorEmail, &existingAudProv, &existingAudVerified, &existingAudCreatedAt, &existingAudAction,
			)
			if err == nil {
				resp := ReconcileResponse{
					Success:                 true,
					Action:                  existingAudAction,
					QueueID:                 queueID.String(),
					DeliveryID:              existingDeliveryID.String(),
					PreviousStatus:          existingPrevStatus,
					ResultingStatus:         existingResultingStatus,
					ReconciledAt:            existingAudCreatedAt,
					ReconciledBy:            existingAudActorEmail,
					AuditID:                 existingAuditID.String(),
					EvidenceProvenance:      existingAudProv,
					IsIndependentlyVerified: existingAudVerified,
					IdempotentReplay:        true,
				}
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(resp)
				return
			}

			http.Error(w, `{"error":"idempotency record exists in indeterminate state"}`, http.StatusConflict)
			return
		} else if err != nil {
			log.Printf("idempotency reservation error: %v", err)
			http.Error(w, `{"error":"failed to reserve idempotency key"}`, http.StatusInternalServerError)
			return
		}
	}

	// Inspect current queue item under row-lock with real-time DB clock lease evaluation
	var currentStatus string
	var dID, mID, domID uuid.UUID
	var recipient string
	var leaseTok *uuid.UUID
	var leaseExpiresAt *time.Time
	var currentSmtpPhase *string
	var attempts, maxAttempts int
	var currentExpiresAt, currentCreatedAt time.Time
	var manualRetryCount, maxManualRetries int
	var isLeaseActive bool

	err = tx.QueryRow(r.Context(), `
		SELECT status, delivery_id, mailbox_id, domain_id, recipient,
		       lease_token, lease_expires_at, smtp_phase, attempts, max_attempts, expires_at,
		       created_at, manual_retry_count, max_manual_retries,
		       (lease_token IS NOT NULL AND lease_expires_at > clock_timestamp()) AS lease_active
		FROM outbound_queue
		WHERE id = $1
		FOR UPDATE
	`, queueID).Scan(
		&currentStatus, &dID, &mID, &domID, &recipient,
		&leaseTok, &leaseExpiresAt, &currentSmtpPhase, &attempts, &maxAttempts, &currentExpiresAt,
		&currentCreatedAt, &manualRetryCount, &maxManualRetries,
		&isLeaseActive,
	)

	if err == pgx.ErrNoRows {
		http.Error(w, `{"error":"queue message not found"}`, http.StatusNotFound)
		return
	} else if err != nil {
		log.Printf("handleReconcileQueueMessage row lock error: %v", err)
		http.Error(w, `{"error":"database query failed"}`, http.StatusInternalServerError)
		return
	}

	// Fencing rule 1: Check for active worker lease using authoritative DB clock
	if req.Action != "add_note" {
		if isLeaseActive {
			http.Error(w, `{"error":"active worker lease held on message; cannot reconcile while worker is actively processing. Please wait for worker lease to expire or settle."}`, http.StatusConflict)
			return
		}
		// Fencing rule 2: If action mutates status, currentStatus MUST be outcome_unknown
		if currentStatus != "outcome_unknown" {
			http.Error(w, fmt.Sprintf(`{"error":"cannot reconcile item in status '%s': message must be in 'outcome_unknown' status to reconcile"}`, currentStatus), http.StatusConflict)
			return
		}
	}

	// Fencing rule 3: Verify the message has NOT already achieved remote MTA acceptance (blocks retry AND bounce)
	if req.Action == "authorize_retry" || req.Action == "resolve_bounced" {
		var existingDeliveredCount int
		_ = tx.QueryRow(r.Context(), `
			SELECT COUNT(*)
			FROM delivery_log
			WHERE delivery_id = $1 AND direction = 'outbound' AND (status = 'delivered' OR smtp_phase = 'accepted_by_mta')
		`, dID).Scan(&existingDeliveredCount)

		if (currentSmtpPhase != nil && *currentSmtpPhase == "accepted_by_mta") || existingDeliveredCount > 0 {
			if req.Action == "authorize_retry" {
				http.Error(w, `{"error":"cannot authorize retry: remote MTA has already durably accepted this message; retransmitting would cause duplicate delivery"}`, http.StatusConflict)
			} else {
				http.Error(w, `{"error":"cannot resolve as bounced: remote MTA has already durably accepted this message; cannot overwrite accepted/delivered state with bounce"}`, http.StatusConflict)
			}
			return
		}
	}

	// Pillar 1: Manual Retry Governance
	if req.Action == "authorize_retry" {
		// Enforce bounded manual retry limits per role
		isPlatformAdmin := (actorRole == "platform_admin" || actorRole == "admin")
		if !isPlatformAdmin && manualRetryCount >= 1 {
			http.Error(w, `{"error":"manual retry limit reached: maximum 1 operator retry allowed per message"}`, http.StatusConflict)
			return
		}
		if isPlatformAdmin && manualRetryCount >= 2 {
			http.Error(w, `{"error":"absolute manual retry limit reached: maximum 2 operator retries allowed per message"}`, http.StatusConflict)
			return
		}

		// Enforce 72-hour absolute message lifetime ceiling
		if time.Now().After(currentCreatedAt.Add(72 * time.Hour)) {
			http.Error(w, `{"error":"cannot authorize retry: message has reached the absolute 72-hour lifetime ceiling"}`, http.StatusConflict)
			return
		}
	}

	now := time.Now().UTC()
	resultingStatus := currentStatus

	switch req.Action {
	case "resolve_accepted":
		resultingStatus = "delivered"
		// Conditional update ensuring row remains outcome_unknown and lease is not held by an active worker
		tag, err := tx.Exec(r.Context(), `
			UPDATE outbound_queue
			SET status = 'delivered',
				delivered_at = clock_timestamp(),
				lease_token = NULL,
				lease_expires_at = NULL,
				claimed_at = NULL,
				reconciled_at = clock_timestamp(),
				reconciled_by = $2,
				reconciliation_reason = $3
			WHERE id = $1 AND status = 'outcome_unknown'
			  AND (lease_token IS NULL OR lease_expires_at <= clock_timestamp())
		`, queueID, actorEmail, req.OperatorReason)
		if err != nil || tag.RowsAffected() != 1 {
			http.Error(w, `{"error":"concurrency conflict: message status or lease changed concurrently"}`, http.StatusConflict)
			return
		}

		// Insert delivery_log terminal settlement
		logMsg := fmt.Sprintf("Operator reconciled as delivered: %s (Ref: %s)", req.OperatorReason, req.EvidenceReference)
		_, _ = tx.Exec(r.Context(), `
			INSERT INTO delivery_log (
				delivery_id, mailbox_id, domain_id, recipient, direction,
				status, smtp_code, smtp_message, created_at, smtp_phase
			) VALUES ($1, $2, $3, $4, 'outbound', 'delivered', 250, $5, clock_timestamp(), 'operator_reconciled')
			ON CONFLICT (delivery_id) WHERE direction = 'outbound' AND status IN ('delivered', 'bounced', 'expired')
			DO NOTHING
		`, dID, mID, domID, recipient, logMsg)

	case "authorize_retry":
		resultingStatus = "pending"
		// Reset next_attempt_at to clock_timestamp(), clear smtp_phase, extend expires_at bounded by 72h ceiling,
		// cap max_attempts headroom, and atomically increment manual_retry_count
		maxAllowedRetries := 1
		if actorRole == "platform_admin" || actorRole == "admin" {
			maxAllowedRetries = 2
		}

		tag, err := tx.Exec(r.Context(), `
			UPDATE outbound_queue
			SET status = 'pending',
				next_attempt_at = clock_timestamp(),
				expires_at = LEAST(created_at + interval '72 hours', GREATEST(expires_at, clock_timestamp() + interval '24 hours')),
				max_attempts = LEAST(8, GREATEST(max_attempts, attempts + 2)),
				manual_retry_count = manual_retry_count + 1,
				max_manual_retries = CASE WHEN $2 IN ('platform_admin', 'admin') THEN 2 ELSE max_manual_retries END,
				smtp_phase = NULL,
				lease_token = NULL,
				lease_expires_at = NULL,
				claimed_at = NULL,
				reconciled_at = clock_timestamp(),
				reconciled_by = $3,
				reconciliation_reason = $4
			WHERE id = $1 AND status = 'outcome_unknown'
			  AND manual_retry_count < $5
			  AND (lease_token IS NULL OR lease_expires_at <= clock_timestamp())
		`, queueID, actorRole, actorEmail, req.OperatorReason, maxAllowedRetries)
		if err != nil || tag.RowsAffected() != 1 {
			http.Error(w, `{"error":"concurrency conflict or manual retry limit reached concurrently"}`, http.StatusConflict)
			return
		}

		// Record retry decision in delivery_log
		retryMsg := fmt.Sprintf("Operator authorized retry: %s (Ref: %s)", req.OperatorReason, req.EvidenceReference)
		_, _ = tx.Exec(r.Context(), `
			INSERT INTO delivery_log (
				delivery_id, mailbox_id, domain_id, recipient, direction,
				status, smtp_code, smtp_message, created_at, smtp_phase
			) VALUES ($1, $2, $3, $4, 'outbound', 'retrying', 0, $5, clock_timestamp(), 'operator_authorized_retry')
		`, dID, mID, domID, recipient, retryMsg)

	case "resolve_bounced":
		resultingStatus = "bounced"
		tag, err := tx.Exec(r.Context(), `
			UPDATE outbound_queue
			SET status = 'bounced',
				failed_at = clock_timestamp(),
				lease_token = NULL,
				lease_expires_at = NULL,
				claimed_at = NULL,
				reconciled_at = clock_timestamp(),
				reconciled_by = $2,
				reconciliation_reason = $3
			WHERE id = $1 AND status = 'outcome_unknown'
			  AND (lease_token IS NULL OR lease_expires_at <= clock_timestamp())
		`, queueID, actorEmail, req.OperatorReason)
		if err != nil || tag.RowsAffected() != 1 {
			http.Error(w, `{"error":"concurrency conflict: message status or lease changed concurrently"}`, http.StatusConflict)
			return
		}

		bounceMsg := fmt.Sprintf("Operator resolved as bounced: %s (Evidence: %s - %s)", req.OperatorReason, req.EvidenceCategory, req.EvidenceReference)
		_, _ = tx.Exec(r.Context(), `
			INSERT INTO delivery_log (
				delivery_id, mailbox_id, domain_id, recipient, direction,
				status, smtp_code, smtp_message, created_at, smtp_phase
			) VALUES ($1, $2, $3, $4, 'outbound', 'bounced', 550, $5, clock_timestamp(), 'operator_resolved_bounced')
			ON CONFLICT (delivery_id) WHERE direction = 'outbound' AND status IN ('delivered', 'bounced', 'expired')
			DO NOTHING
		`, dID, mID, domID, recipient, bounceMsg)

	case "add_note":
		// Queue row is not modified; purely adds an immutable audit entry
	}

	// Record to immutable audit ledger
	var auditID uuid.UUID
	var idempParam *string
	if idempotencyKey != "" {
		idempParam = &idempotencyKey
	}

	err = tx.QueryRow(r.Context(), `
		INSERT INTO outbound_delivery_operator_audit (
			actor_id, actor_email, actor_role, action, queue_id, delivery_id,
			previous_status, resulting_status, resolution_category, operator_reason,
			evidence_category, evidence_reference, ip_address, user_agent,
			evidence_provenance, is_independently_verified, idempotency_key, request_fingerprint
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
		RETURNING id
	`, actorID, actorEmail, actorRole, req.Action, queueID, dID,
		currentStatus, resultingStatus, req.ResolutionCategory, req.OperatorReason,
		req.EvidenceCategory, req.EvidenceReference, ipAddress, userAgent,
		evidenceProvenance, isIndependentlyVerified, idempParam, requestFingerprint,
	).Scan(&auditID)

	if err != nil {
		log.Printf("handleReconcileQueueMessage audit insert error: %v", err)
		http.Error(w, `{"error":"failed to persist operator audit log"}`, http.StatusInternalServerError)
		return
	}

	resp := ReconcileResponse{
		Success:                 true,
		Action:                  req.Action,
		QueueID:                 queueID.String(),
		DeliveryID:              dID.String(),
		PreviousStatus:          currentStatus,
		ResultingStatus:         resultingStatus,
		ReconciledAt:            now,
		ReconciledBy:            actorEmail,
		AuditID:                 auditID.String(),
		EvidenceProvenance:      evidenceProvenance,
		IsIndependentlyVerified: isIndependentlyVerified,
		IdempotentReplay:        false,
	}

	// Settle idempotency reservation as completed with cached response payload
	if idempotencyKey != "" {
		payloadBytes, _ := json.Marshal(resp)
		_, err = tx.Exec(r.Context(), `
			UPDATE delivery_operator_idempotency
			SET status = 'completed',
				audit_id = $1,
				response_payload = $2
			WHERE idempotency_key = $3
		`, auditID, payloadBytes, idempotencyKey)
		if err != nil {
			log.Printf("failed to update idempotency status: %v", err)
			http.Error(w, `{"error":"failed to finalize idempotency record"}`, http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		log.Printf("handleReconcileQueueMessage commit error: %v", err)
		http.Error(w, `{"error":"failed to commit reconciliation transaction"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(resp)
}

// handleQueueAlerts identifies stuck messages, stale leases, and quarantined items.
func handleQueueAlerts(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	w.Header().Set("Content-Type", "application/json")
	if _, err := checkQueuePermission(r, "read"); err != nil {
		if err.Error() == "unauthorized" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		} else {
			http.Error(w, `{"error":"forbidden: insufficient role permissions for queue operations"}`, http.StatusForbidden)
		}
		return
	}
	if db == nil {
		http.Error(w, `{"error":"database unavailable"}`, http.StatusInternalServerError)
		return
	}

	alerts := make([]QueueAlertItem, 0)
	overallStatus := "healthy"

	// 1. Stale processing leases
	staleRows, err := db.Query(r.Context(), `
		SELECT id
		FROM outbound_queue
		WHERE status = 'processing' AND lease_expires_at < clock_timestamp()
		LIMIT 5
	`)
	if err == nil {
		defer staleRows.Close()
		var sampleIDs []string
		for staleRows.Next() {
			var id uuid.UUID
			if err := staleRows.Scan(&id); err == nil {
				sampleIDs = append(sampleIDs, id.String())
			}
		}
		if len(sampleIDs) > 0 {
			var totalStale int
			_ = db.QueryRow(r.Context(), `SELECT COUNT(*) FROM outbound_queue WHERE status = 'processing' AND lease_expires_at < clock_timestamp()`).Scan(&totalStale)
			alerts = append(alerts, QueueAlertItem{
				Type:      "stale_lease",
				Severity:  "critical",
				Count:     totalStale,
				Message:   fmt.Sprintf("%d message(s) hold expired worker leases without settlement; reaper may be lagging or workers crashed", totalStale),
				SampleIDs: sampleIDs,
			})
			overallStatus = "critical"
		}
	}

	// 2. Stuck pending items (pending for > 15 minutes past next_attempt_at)
	stuckPendingRows, err := db.Query(r.Context(), `
		SELECT id
		FROM outbound_queue
		WHERE status = 'pending' AND next_attempt_at < clock_timestamp() - interval '15 minutes'
		LIMIT 5
	`)
	if err == nil {
		defer stuckPendingRows.Close()
		var sampleIDs []string
		for stuckPendingRows.Next() {
			var id uuid.UUID
			if err := stuckPendingRows.Scan(&id); err == nil {
				sampleIDs = append(sampleIDs, id.String())
			}
		}
		if len(sampleIDs) > 0 {
			var totalStuck int
			_ = db.QueryRow(r.Context(), `SELECT COUNT(*) FROM outbound_queue WHERE status = 'pending' AND next_attempt_at < clock_timestamp() - interval '15 minutes'`).Scan(&totalStuck)
			alerts = append(alerts, QueueAlertItem{
				Type:      "stuck_pending",
				Severity:  "warning",
				Count:     totalStuck,
				Message:   fmt.Sprintf("%d message(s) have been pending delivery for over 15 minutes past scheduled attempt time", totalStuck),
				SampleIDs: sampleIDs,
			})
			if overallStatus != "critical" {
				overallStatus = "warning"
			}
		}
	}

	// 3. Quarantined outcome_unknown items
	unknownRows, err := db.Query(r.Context(), `
		SELECT id
		FROM outbound_queue
		WHERE status = 'outcome_unknown'
		LIMIT 5
	`)
	if err == nil {
		defer unknownRows.Close()
		var sampleIDs []string
		for unknownRows.Next() {
			var id uuid.UUID
			if err := unknownRows.Scan(&id); err == nil {
				sampleIDs = append(sampleIDs, id.String())
			}
		}
		if len(sampleIDs) > 0 {
			var totalUnknown int
			_ = db.QueryRow(r.Context(), `SELECT COUNT(*) FROM outbound_queue WHERE status = 'outcome_unknown'`).Scan(&totalUnknown)
			severity := "warning"
			if totalUnknown > 10 {
				severity = "critical"
				overallStatus = "critical"
			} else if overallStatus != "critical" {
				overallStatus = "warning"
			}
			alerts = append(alerts, QueueAlertItem{
				Type:      "outcome_unknown_quarantine",
				Severity:  severity,
				Count:     totalUnknown,
				Message:   fmt.Sprintf("%d message(s) quarantined in 'outcome_unknown' status awaiting manual operator reconciliation", totalUnknown),
				SampleIDs: sampleIDs,
			})
		}
	}

	resp := QueueAlertsResponse{
		Status: overallStatus,
		Alerts: alerts,
	}

	_ = json.NewEncoder(w).Encode(resp)
}

// handleQueueMetrics formats outbound queue indicators in standard Prometheus text format.
func handleQueueMetrics(w http.ResponseWriter, r *http.Request, db *pgxpool.Pool) {
	if _, err := checkQueuePermission(r, "read"); err != nil {
		if err.Error() == "unauthorized" {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		} else {
			http.Error(w, `{"error":"forbidden: insufficient role permissions for queue operations"}`, http.StatusForbidden)
		}
		return
	}
	if db == nil {
		http.Error(w, "database unavailable", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	var pendingCount, processingCount, outcomeUnknownCount, deliveredCount, bouncedCount, expiredCount int64
	rows, err := db.Query(r.Context(), `SELECT status, COUNT(*) FROM outbound_queue GROUP BY status`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var st string
			var cnt int64
			if err := rows.Scan(&st, &cnt); err == nil {
				switch st {
				case "pending":
					pendingCount = cnt
				case "processing":
					processingCount = cnt
				case "outcome_unknown":
					outcomeUnknownCount = cnt
				case "delivered":
					deliveredCount = cnt
				case "bounced":
					bouncedCount = cnt
				case "expired":
					expiredCount = cnt
				}
			}
		}
	}

	var staleLeaseCount int64
	_ = db.QueryRow(r.Context(), `SELECT COUNT(*) FROM outbound_queue WHERE status = 'processing' AND lease_expires_at < clock_timestamp()`).Scan(&staleLeaseCount)

	var oldestPending, oldestProcessing, oldestUnknown *float64
	_ = db.QueryRow(r.Context(), `
		SELECT
			EXTRACT(EPOCH FROM (clock_timestamp() - MIN(created_at))) FILTER (WHERE status = 'pending'),
			EXTRACT(EPOCH FROM (clock_timestamp() - MIN(claimed_at))) FILTER (WHERE status = 'processing'),
			EXTRACT(EPOCH FROM (clock_timestamp() - MIN(failed_at))) FILTER (WHERE status = 'outcome_unknown')
		FROM outbound_queue
	`).Scan(&oldestPending, &oldestProcessing, &oldestUnknown)

	var sb strings.Builder
	sb.WriteString("# HELP byos_outbound_queue_size Current count of messages in outbound_queue by status\n")
	sb.WriteString("# TYPE byos_outbound_queue_size gauge\n")
	fmt.Fprintf(&sb, "byos_outbound_queue_size{status=\"pending\"} %d\n", pendingCount)
	fmt.Fprintf(&sb, "byos_outbound_queue_size{status=\"processing\"} %d\n", processingCount)
	fmt.Fprintf(&sb, "byos_outbound_queue_size{status=\"outcome_unknown\"} %d\n", outcomeUnknownCount)
	fmt.Fprintf(&sb, "byos_outbound_queue_size{status=\"delivered\"} %d\n", deliveredCount)
	fmt.Fprintf(&sb, "byos_outbound_queue_size{status=\"bounced\"} %d\n", bouncedCount)
	fmt.Fprintf(&sb, "byos_outbound_queue_size{status=\"expired\"} %d\n", expiredCount)

	sb.WriteString("# HELP byos_outbound_stale_leases Current count of processing messages with expired lease\n")
	sb.WriteString("# TYPE byos_outbound_stale_leases gauge\n")
	fmt.Fprintf(&sb, "byos_outbound_stale_leases %d\n", staleLeaseCount)

	sb.WriteString("# HELP byos_outbound_queue_oldest_seconds Age of oldest message in seconds by status\n")
	sb.WriteString("# TYPE byos_outbound_queue_oldest_seconds gauge\n")
	pSec := float64(0)
	if oldestPending != nil && *oldestPending > 0 {
		pSec = *oldestPending
	}
	prSec := float64(0)
	if oldestProcessing != nil && *oldestProcessing > 0 {
		prSec = *oldestProcessing
	}
	uSec := float64(0)
	if oldestUnknown != nil && *oldestUnknown > 0 {
		uSec = *oldestUnknown
	}
	fmt.Fprintf(&sb, "byos_outbound_queue_oldest_seconds{status=\"pending\"} %.1f\n", pSec)
	fmt.Fprintf(&sb, "byos_outbound_queue_oldest_seconds{status=\"processing\"} %.1f\n", prSec)
	fmt.Fprintf(&sb, "byos_outbound_queue_oldest_seconds{status=\"outcome_unknown\"} %.1f\n", uSec)

	_, _ = w.Write([]byte(sb.String()))
}
