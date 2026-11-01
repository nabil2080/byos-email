package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type UserCalendar struct {
	ID           string  `json:"id"`
	MailboxID    string  `json:"mailbox_id"`
	Name         string  `json:"name"`
	Color        string  `json:"color"`
	IsDefault    bool    `json:"is_default"`
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
	IsShared     bool    `json:"is_shared"`
	Permission   string  `json:"permission"` // "owner", "read", "write"
	OwnerEmail   *string `json:"owner_email,omitempty"`
	EncryptedKey *string `json:"encrypted_key,omitempty"`
	ShareID      *string `json:"share_id,omitempty"`
}

type CalendarShare struct {
	ID               string `json:"id"`
	CalendarID       string `json:"calendar_id"`
	GrantorMailboxID string `json:"grantor_mailbox_id"`
	GranteeMailboxID string `json:"grantee_mailbox_id"`
	GranteeEmail     string `json:"grantee_email"`
	Permission       string `json:"permission"` // "read" | "write"
	EncryptedKey     string `json:"encrypted_key,omitempty"`
	Status           string `json:"status"` // "active" | "revoked"
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type CreateCalendarShareReq struct {
	GranteeEmail string `json:"grantee_email"`
	Permission   string `json:"permission"` // "read" | "write"
	EncryptedKey string `json:"encrypted_key,omitempty"`
}

type UpdateCalendarShareReq struct {
	Permission   *string `json:"permission"`
	EncryptedKey *string `json:"encrypted_key,omitempty"`
	Status       *string `json:"status"`
}

type CalendarEvent struct {
	ID               string                   `json:"id"`
	MailboxID        string                   `json:"mailbox_id"`
	CalendarID       string                   `json:"calendar_id"`
	StartTime        string                   `json:"start_time"`
	EndTime          string                   `json:"end_time"`
	IsAllDay         bool                     `json:"is_all_day"`
	RRule            string                   `json:"rrule,omitempty"`
	Status           string                   `json:"status"`
	EncryptedPayload string                   `json:"encrypted_payload"`
	Exceptions       []CalendarEventException `json:"exceptions,omitempty"`
	CreatedAt        string                   `json:"created_at"`
	UpdatedAt        string                   `json:"updated_at"`
}

type CalendarEventException struct {
	ID               string `json:"id"`
	ParentEventID    string `json:"parent_event_id"`
	MailboxID        string `json:"mailbox_id"`
	CalendarID       string `json:"calendar_id"`
	RecurrenceID     string `json:"recurrence_id"`
	IsCancelled      bool   `json:"is_cancelled"`
	StartTime        string `json:"start_time"`
	EndTime          string `json:"end_time"`
	IsAllDay         bool   `json:"is_all_day"`
	Status           string `json:"status"`
	EncryptedPayload string `json:"encrypted_payload"`
	CreatedAt        string `json:"created_at"`
	UpdatedAt        string `json:"updated_at"`
}

type CreateEventExceptionReq struct {
	RecurrenceID     string `json:"recurrence_id"`
	IsCancelled      bool   `json:"is_cancelled"`
	StartTime        string `json:"start_time"`
	EndTime          string `json:"end_time"`
	IsAllDay         bool   `json:"is_all_day"`
	Status           string `json:"status"`
	EncryptedPayload string `json:"encrypted_payload"`
}

type UpdateEventExceptionReq struct {
	IsCancelled      *bool   `json:"is_cancelled"`
	StartTime        *string `json:"start_time"`
	EndTime          *string `json:"end_time"`
	IsAllDay         *bool   `json:"is_all_day"`
	Status           *string `json:"status"`
	EncryptedPayload *string `json:"encrypted_payload"`
}

type CreateCalendarReq struct {
	Name      string `json:"name"`
	Color     string `json:"color"`
	IsDefault bool   `json:"is_default"`
}

type UpdateCalendarReq struct {
	Name      *string `json:"name"`
	Color     *string `json:"color"`
	IsDefault *bool   `json:"is_default"`
}

type CreateEventReq struct {
	CalendarID       string `json:"calendar_id"`
	StartTime        string `json:"start_time"`
	EndTime          string `json:"end_time"`
	IsAllDay         bool   `json:"is_all_day"`
	RRule            string `json:"rrule,omitempty"`
	Status           string `json:"status"`
	EncryptedPayload string `json:"encrypted_payload"`
}

type UpdateEventReq struct {
	CalendarID       *string `json:"calendar_id"`
	StartTime        *string `json:"start_time"`
	EndTime          *string `json:"end_time"`
	IsAllDay         *bool   `json:"is_all_day"`
	RRule            *string `json:"rrule"`
	Status           *string `json:"status"`
	EncryptedPayload *string `json:"encrypted_payload"`
}

type StageMigrationReq struct {
	StagedEncryptedPayload string `json:"staged_encrypted_payload"`
}

type StageMigrationResp struct {
	MigrationID string `json:"migration_id"`
	EventID     string `json:"event_id"`
	Status      string `json:"status"`
	ExpiresAt   string `json:"expires_at"`
	UpdatedAt   string `json:"updated_at"`
	ETag        string `json:"etag"`
}

type FinalizeMigrationReq struct {
	MigrationID string `json:"migration_id"`
}

type FinalizeMigrationResp struct {
	MigrationID string `json:"migration_id"`
	EventID     string `json:"event_id"`
	Status      string `json:"status"`
	FinalizedAt string `json:"finalized_at"`
}

type RollbackMigrationReq struct {
	MigrationID string `json:"migration_id"`
	Reason      string `json:"reason"`
}

type RollbackMigrationResp struct {
	MigrationID string `json:"migration_id"`
	EventID     string `json:"event_id"`
	Status      string `json:"status"`
	RestoredAt  string `json:"restored_at"`
}

type MigrationStatusResp struct {
	EventID            string  `json:"event_id"`
	HasActiveMigration bool    `json:"has_active_migration"`
	MigrationID        *string `json:"migration_id,omitempty"`
	Status             *string `json:"status,omitempty"`
	ExpiresAt          *string `json:"expires_at,omitempty"`
}

const (
	aesGcmEnvelopeVersion = 0x01
	minEnvelopeLength     = 29 // 1 (version) + 12 (nonce) + 16 (auth tag)
)

// validateCalendarEventEnvelope decodes and validates the wire envelope for a calendar event payload.
// Per Section 12 AES-GCM specifications:
// - Envelope layout: version(1) || nonce(12) || ciphertext+tag(N+16)
// - Minimum decoded envelope length: 29 bytes
// - Version byte: 0x01
// - Decoded payloads starting with 0x7B ('{') or 0x5B ('[') or unsupported versions are rejected.
func validateCalendarEventEnvelope(rawB64 string) ([]byte, error) {
	trimmed := strings.TrimSpace(rawB64)
	if trimmed == "" {
		return nil, fmt.Errorf("encrypted_payload is required and cannot be empty")
	}

	payloadBytes, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 encoding")
	}

	if len(payloadBytes) < minEnvelopeLength {
		return nil, fmt.Errorf("payload shorter than minimum envelope length (%d bytes)", minEnvelopeLength)
	}

	// Reject plaintext JSON (0x7B '{', 0x5B '[')
	if payloadBytes[0] == 0x7B || payloadBytes[0] == 0x5B {
		return nil, fmt.Errorf("plaintext or unencrypted JSON payload is rejected")
	}

	if payloadBytes[0] != aesGcmEnvelopeVersion {
		return nil, fmt.Errorf("unsupported envelope version: 0x%02x (expected 0x%02x)", payloadBytes[0], aesGcmEnvelopeVersion)
	}

	return payloadBytes, nil
}

// computeCalendarEventETag derives a strong, deterministic ETag (RFC 9110) covering
// every mutable event field, authoritative DB timestamps, and stored payload SHA-256.
// Uses a typed, length-prefixed canonical framing format to eliminate delimiter collisions
// and prevent sentinel ambiguity between null, empty, and literal values.
//
// Format:
// v2|S<len>:<id>|S<len>:<mailbox_id>|S<len>:<calendar_id>|T<len>:<start_time>|T<len>:<end_time>|B<0|1>|<N|S<len>:<rrule>>|S<len>:<status>|H64:<payload_sha256>|T<len>:<updated_at>
func computeCalendarEventETag(
	id, mailboxID, calendarID string,
	startTime, endTime time.Time,
	isAllDay bool,
	rrule *string,
	status string,
	payload []byte,
	updatedAt time.Time,
) string {
	var buf bytes.Buffer
	buf.WriteString("v2")

	// Helper for length-prefixed string framing: S<len>:<string>
	writeStringFrame := func(s string) {
		buf.WriteByte('|')
		buf.WriteByte('S')
		buf.WriteString(strconv.Itoa(len(s)))
		buf.WriteByte(':')
		buf.WriteString(s)
	}

	// Helper for length-prefixed timestamp framing: T<len>:<rfc3339nano_utc>
	writeTimeFrame := func(t time.Time) {
		formatted := t.UTC().Format(time.RFC3339Nano)
		buf.WriteByte('|')
		buf.WriteByte('T')
		buf.WriteString(strconv.Itoa(len(formatted)))
		buf.WriteByte(':')
		buf.WriteString(formatted)
	}

	writeStringFrame(id)
	writeStringFrame(mailboxID)
	writeStringFrame(calendarID)
	writeTimeFrame(startTime)
	writeTimeFrame(endTime)

	// Boolean framing: B1 or B0
	buf.WriteByte('|')
	buf.WriteByte('B')
	if isAllDay {
		buf.WriteByte('1')
	} else {
		buf.WriteByte('0')
	}

	// Recurrence rule framing:
	// N for null pointer
	// S<len>:<rrule> for non-null string (including empty string S0:)
	buf.WriteByte('|')
	if rrule == nil {
		buf.WriteByte('N')
	} else {
		buf.WriteByte('S')
		buf.WriteString(strconv.Itoa(len(*rrule)))
		buf.WriteByte(':')
		buf.WriteString(*rrule)
	}

	writeStringFrame(status)

	// Binary payload framing: SHA-256 hex string H64:<hex>
	payloadHash := sha256.Sum256(payload)
	payloadHashHex := hex.EncodeToString(payloadHash[:])
	buf.WriteByte('|')
	buf.WriteString("H64:")
	buf.WriteString(payloadHashHex)

	writeTimeFrame(updatedAt)

	sum := sha256.Sum256(buf.Bytes())
	return fmt.Sprintf("\"%s\"", hex.EncodeToString(sum[:]))
}

// opportunisticallyRecoverExpiredMigration detects expired staged migrations and transactionally
// restores the legacy payload before an API request executes.
// Clears legacy_payload in calendar_event_migrations atomically to avoid duplicate plaintext retention.
// Canonical lock order: Lock root mailbox first, then parent calendar_events, then child calendar_event_migrations.
func opportunisticallyRecoverExpiredMigration(ctx context.Context, conn *pgx.Conn, mailboxID, eventID string) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return
	}
	defer tx.Rollback(ctx)

	// 0. Lock root mailbox row and verify active state
	var dummyMbID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM mailboxes WHERE id=$1 AND is_active=true FOR UPDATE`, mailboxID).Scan(&dummyMbID)
	if err != nil {
		return
	}

	// 1. Lock parent row
	var dummyID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM calendar_events WHERE id=$1 AND mailbox_id=$2 FOR UPDATE`, eventID, mailboxID).Scan(&dummyID)
	if err != nil {
		return
	}

	// 2. Lock child row
	var migrationID string
	var legacyPayload []byte
	err = tx.QueryRow(ctx, `
		SELECT id::text, legacy_payload
		FROM calendar_event_migrations
		WHERE event_id=$1 AND mailbox_id=$2 AND status='staged' AND expires_at < now()
		FOR UPDATE`, eventID, mailboxID).Scan(&migrationID, &legacyPayload)
	if err != nil {
		return
	}

	if len(legacyPayload) > 0 {
		_, _ = tx.Exec(ctx, `
			UPDATE calendar_events
			SET encrypted_payload = $1, updated_at = now()
			WHERE id = $2 AND mailbox_id = $3`, legacyPayload, eventID, mailboxID)
	}

	_, _ = tx.Exec(ctx, `
		UPDATE calendar_event_migrations
		SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='ttl_expired_opportunistic'
		WHERE id=$1`, migrationID)

	_ = tx.Commit(ctx)
}

// ReconcileRestoredMigrations resolves active migrations after database restoration or outage.
// Traverses all expired staged migrations and safely restores legacy payloads before writes resume.
// Canonical lock order: Parent calendar_events first, then child calendar_event_migrations.
func ReconcileRestoredMigrations(ctx context.Context, conn *pgx.Conn) (int, error) {
	rows, err := conn.Query(ctx, `
		SELECT id::text, event_id::text, mailbox_id::text
		FROM calendar_event_migrations
		WHERE status='staged' AND expires_at < now()
		ORDER BY created_at ASC`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type item struct {
		migID, eventID, mailboxID string
	}
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.migID, &it.eventID, &it.mailboxID); err == nil {
			items = append(items, it)
		}
	}
	rows.Close()

	reconciled := 0
	for _, it := range items {
		tx, err := conn.Begin(ctx)
		if err != nil {
			continue
		}

		// 1. Lock parent row and read current payload
		var currentPayload []byte
		err = tx.QueryRow(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id=$1 FOR UPDATE`, it.eventID).Scan(&currentPayload)
		if err != nil {
			tx.Rollback(ctx)
			continue
		}

		// 2. Lock child row
		var legacy []byte
		var staged []byte
		err = tx.QueryRow(ctx, `
			SELECT legacy_payload, staged_payload
			FROM calendar_event_migrations
			WHERE id=$1 AND status='staged' AND expires_at < now()
			FOR UPDATE`, it.migID).Scan(&legacy, &staged)
		if err != nil {
			tx.Rollback(ctx)
			continue
		}

		// Inconsistency / backup ambiguity check:
		// If current payload matches staged payload: safe to restore legacy payload and clear duplicate plaintext.
		// If current payload matches legacy payload: already restored, just mark rolled_back and clear migration copy.
		// If current payload matches NEITHER (e.g. newer write or corrupted backup):
		// Preserve both copies, do NOT overwrite calendar_events, mark rolled_back with ambiguous reason for operator review.
		if len(staged) > 0 && bytes.Equal(currentPayload, staged) {
			if len(legacy) > 0 {
				_, err = tx.Exec(ctx, `UPDATE calendar_events SET encrypted_payload=$1, updated_at=now() WHERE id=$2`, legacy, it.eventID)
				if err != nil {
					tx.Rollback(ctx)
					continue
				}
			}
			_, err = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='backup_restoration_reconciliation' WHERE id=$1`, it.migID)
			if err != nil {
				tx.Rollback(ctx)
				continue
			}
		} else if len(legacy) > 0 && bytes.Equal(currentPayload, legacy) {
			_, err = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='already_restored_reconciliation' WHERE id=$1`, it.migID)
			if err != nil {
				tx.Rollback(ctx)
				continue
			}
		} else {
			// Ambiguous state: preserve both copies without overwriting current event payload
			log.Printf("[calendar-reconciliation] WARNING: ambiguous event payload for event_id=%s mig_id=%s - preserved event payload and preserved migration copy for manual review", it.eventID, it.migID)
			_, err = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', rolled_back_at=now(), rollback_reason='ambiguous_inconsistent_state_requires_manual_review' WHERE id=$1`, it.migID)
			if err != nil {
				tx.Rollback(ctx)
				continue
			}
		}

		if err := tx.Commit(ctx); err == nil {
			reconciled++
		}
	}
	return reconciled, nil
}

// RunStartupMigrationReconciliation performs a reconciliation pass during API boot
// before normal calendar operations are served. If calendar_event_migrations table
// does not exist yet (e.g. migration 060 unapplied), it logs and skips gracefully.
func RunStartupMigrationReconciliation(ctx context.Context, dsn string) (int, error) {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return 0, fmt.Errorf("failed to connect to database for startup reconciliation: %w", err)
	}
	defer conn.Close(ctx)

	var tableExists bool
	err = conn.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema='public' AND table_name='calendar_event_migrations'
		)`).Scan(&tableExists)
	if err != nil || !tableExists {
		log.Printf("[calendar-recovery] calendar_event_migrations table not present; skipping startup reconciliation")
		return 0, nil
	}

	count, err := ReconcileRestoredMigrations(ctx, conn)
	if err != nil {
		log.Printf("[calendar-recovery] startup reconciliation error: %v", err)
		return 0, err
	}
	if count > 0 {
		log.Printf("[calendar-recovery] startup reconciliation recovered %d expired migration(s)", count)
	}
	return count, nil
}

// StartCalendarExpirationWorker launches a background goroutine running on a 60-second
// ticker (or custom interval) to sweep expired staged migrations. Exits cleanly on ctx cancellation.
func StartCalendarExpirationWorker(ctx context.Context, dsn string, interval time.Duration) {
	if interval <= 0 {
		interval = 60 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Printf("[calendar-recovery] expiration worker shutting down cleanly")
				return
			case <-ticker.C:
				runCalendarExpirationSweep(ctx, dsn)
			}
		}
	}()
	log.Printf("[calendar-recovery] expiration worker started (interval %s)", interval)
}

func runCalendarExpirationSweep(ctx context.Context, dsn string) {
	connCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	conn, err := pgx.Connect(connCtx, dsn)
	if err != nil {
		return
	}
	defer conn.Close(connCtx)

	var tableExists bool
	err = conn.QueryRow(connCtx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema='public' AND table_name='calendar_event_migrations'
		)`).Scan(&tableExists)
	if err != nil || !tableExists {
		return
	}

	count, err := ReconcileRestoredMigrations(connCtx, conn)
	if err != nil {
		log.Printf("[calendar-recovery] periodic sweep error: %v", err)
	} else if count > 0 {
		log.Printf("[calendar-recovery] periodic sweep recovered %d expired migration(s)", count)
	}
}

// resolveCalendarMailboxOwner authenticates the requesting actor and strictly enforces
// that the authenticated user is the explicit owner of the target mailbox (mailboxes.user_id == userID).
// Organization administrators, peer employees, or cross-tenant actors cannot access another user's calendar.
// Returns (userID, userOrgID, mailboxID, ok).
// Unauthorized responses return http.StatusNotFound or http.StatusForbidden without revealing
// whether another user's mailbox/events exist.
func resolveCalendarMailboxOwner(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context) (userID, userOrgID, mailboxID string, ok bool) {
	mailboxID = r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox ID required", http.StatusBadRequest)
		return "", "", "", false
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "mailbox ID must be UUID", http.StatusBadRequest)
		return "", "", "", false
	}
	userID, ok = getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return "", "", "", false
	}
	err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return "", "", "", false
	}
	var mailboxOrgID string
	var mailboxUserID *string
	err = conn.QueryRow(ctx, `SELECT org_id::text, user_id::text FROM mailboxes WHERE id=$1 AND is_active=true`, mailboxID).Scan(&mailboxOrgID, &mailboxUserID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return "", "", "", false
	}
	if status, errMsg, authOk := verifyMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return "", "", "", false
	}
	// Strict owner or linked session check: User must belong to same org AND be the direct owner or have linked session.
	// Peer employees or unauthorized org administrators are forbidden from accessing another user's private calendar.
	isOwner := mailboxUserID != nil && *mailboxUserID == userID
	isLinked := false
	if callerHash, hasHash := getCallerTokenHash(r); hasHash && len(callerHash) > 0 {
		isLinked = isMailboxAuthorizedForSession(callerHash, userID, mailboxID, conn, ctx)
	}
	if mailboxOrgID != userOrgID || (!isOwner && !isLinked) {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return "", "", "", false
	}
	return userID, userOrgID, mailboxID, true
}

func getDBConn(ctx context.Context) (*pgx.Conn, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	return pgx.Connect(ctx, dsn)
}

func ensureDefaultCalendar(ctx context.Context, conn *pgx.Conn, mailboxID string) error {
	var count int
	err := conn.QueryRow(ctx, `SELECT count(*) FROM user_calendars WHERE mailbox_id=$1`, mailboxID).Scan(&count)
	if err != nil {
		return err
	}
	if count == 0 {
		_, err = conn.Exec(ctx, `
			INSERT INTO user_calendars (mailbox_id, name, color, is_default)
			VALUES ($1, 'Personal', '#9E725F', true)
			ON CONFLICT DO NOTHING`, mailboxID)
		return err
	}
	return nil
}

// calendarsHandler handles /v1/mailboxes/{mailbox_id}/calendars and /{calendar_id}
func calendarsHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, _, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	calendarID := r.PathValue("calendar_id")

	if calendarID != "" {
		if _, err := uuid.Parse(calendarID); err != nil {
			http.Error(w, "calendar ID must be UUID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodGet:
			var c UserCalendar
			var createdAt, updatedAt time.Time
			var ownerEmail string
			err := conn.QueryRow(ctx, `
				SELECT c.id::text, c.mailbox_id::text, c.name, c.color, c.is_default, c.created_at, c.updated_at,
				       m.local_part || '@' || d.name as owner_email
				FROM user_calendars c
				JOIN mailboxes m ON m.id = c.mailbox_id
				JOIN domains d ON d.id = m.domain_id
				WHERE c.id=$1 AND c.mailbox_id=$2`, calendarID, mailboxID).
				Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt, &ownerEmail)
			if err == pgx.ErrNoRows {
				// Check if shared with this mailbox
				var csPermission, csEncKey, csID, csOwnerEmail string
				err = conn.QueryRow(ctx, `
					SELECT c.id::text, c.mailbox_id::text, c.name, c.color, c.is_default, c.created_at, c.updated_at,
					       cs.id::text, cs.permission, COALESCE(cs.encrypted_key, ''),
					       m.local_part || '@' || d.name as owner_email
					FROM calendar_shares cs
					JOIN user_calendars c ON c.id = cs.calendar_id
					JOIN mailboxes m ON m.id = c.mailbox_id
					JOIN domains d ON d.id = m.domain_id
					WHERE cs.calendar_id=$1 AND cs.grantee_mailbox_id=$2 AND cs.status='active'`,
					calendarID, mailboxID).
					Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt,
						&csID, &csPermission, &csEncKey, &csOwnerEmail)
				if err == pgx.ErrNoRows {
					http.Error(w, "calendar not found", http.StatusNotFound)
					return
				}
				if err != nil {
					http.Error(w, "failed to query shared calendar", http.StatusInternalServerError)
					return
				}
				c.IsShared = true
				c.Permission = csPermission
				c.EncryptedKey = &csEncKey
				c.ShareID = &csID
				c.OwnerEmail = &csOwnerEmail
			} else if err != nil {
				http.Error(w, "failed to get calendar", http.StatusInternalServerError)
				return
			} else {
				c.IsShared = false
				c.Permission = "owner"
				c.OwnerEmail = &ownerEmail
			}
			c.CreatedAt = createdAt.Format(time.RFC3339)
			c.UpdatedAt = updatedAt.Format(time.RFC3339)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(c)

		case http.MethodPatch, http.MethodPut:
			// Check ownership
			var calOwnerID string
			err = conn.QueryRow(ctx, `SELECT mailbox_id::text FROM user_calendars WHERE id=$1`, calendarID).Scan(&calOwnerID)
			if err == pgx.ErrNoRows {
				http.Error(w, "calendar not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query calendar", http.StatusInternalServerError)
				return
			}
			if calOwnerID != mailboxID {
				http.Error(w, `{"error":"only_calendar_owner_can_modify"}`, http.StatusForbidden)
				return
			}

			var req UpdateCalendarReq
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}

			// Validate
			if req.Name != nil && (len(strings.TrimSpace(*req.Name)) == 0 || len(*req.Name) > 100) {
				http.Error(w, "name must be between 1 and 100 characters", http.StatusBadRequest)
				return
			}

			tx, err := conn.Begin(ctx)
			if err != nil {
				http.Error(w, "failed to start transaction", http.StatusInternalServerError)
				return
			}
			defer tx.Rollback(ctx)

			if req.IsDefault != nil && *req.IsDefault {
				// Clear any other default
				_, err = tx.Exec(ctx, `UPDATE user_calendars SET is_default=false WHERE mailbox_id=$1`, mailboxID)
				if err != nil {
					http.Error(w, "failed to update default calendar", http.StatusInternalServerError)
					return
				}
			}

			var c UserCalendar
			var createdAt, updatedAt time.Time
			err = tx.QueryRow(ctx, `
				UPDATE user_calendars
				SET name = COALESCE($1, name),
				    color = COALESCE($2, color),
				    is_default = COALESCE($3, is_default),
				    updated_at = now()
				WHERE id=$4 AND mailbox_id=$5
				RETURNING id::text, mailbox_id::text, name, color, is_default, created_at, updated_at`,
				req.Name, req.Color, req.IsDefault, calendarID, mailboxID).
				Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt)
			if err == pgx.ErrNoRows {
				http.Error(w, "calendar not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to update calendar", http.StatusInternalServerError)
				return
			}

			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
				return
			}

			c.CreatedAt = createdAt.Format(time.RFC3339)
			c.UpdatedAt = updatedAt.Format(time.RFC3339)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(c)

		case http.MethodDelete:
			tx, err := conn.Begin(ctx)
			if err != nil {
				http.Error(w, "failed to start transaction", http.StatusInternalServerError)
				return
			}
			defer tx.Rollback(ctx)

			// Check if calendar exists
			var wasDefault bool
			err = tx.QueryRow(ctx, `SELECT is_default FROM user_calendars WHERE id=$1 AND mailbox_id=$2 FOR UPDATE`, calendarID, mailboxID).Scan(&wasDefault)
			if err == pgx.ErrNoRows {
				var calOwnerID string
				if err2 := tx.QueryRow(ctx, `SELECT mailbox_id::text FROM user_calendars WHERE id=$1`, calendarID).Scan(&calOwnerID); err2 == nil && calOwnerID != mailboxID {
					http.Error(w, `{"error":"only_calendar_owner_can_modify"}`, http.StatusForbidden)
					return
				}
				http.Error(w, "calendar not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query calendar", http.StatusInternalServerError)
				return
			}

			// 1. Lock all events belonging to this calendar (Parent lock)
			evRows, err := tx.Query(ctx, `SELECT id::text FROM calendar_events WHERE calendar_id=$1 AND mailbox_id=$2 FOR UPDATE`, calendarID, mailboxID)
			if err != nil {
				http.Error(w, "failed to lock calendar events", http.StatusInternalServerError)
				return
			}
			var eventIDs []string
			for evRows.Next() {
				var evID string
				if err := evRows.Scan(&evID); err == nil {
					eventIDs = append(eventIDs, evID)
				}
			}
			evRows.Close()

			if len(eventIDs) > 0 {
				// 2. Lock migration rows for these events (Child lock)
				type calMigRow struct {
					id        string
					eventID   string
					status    string
					expiresAt time.Time
					legacy    []byte
				}
				var calMigRows []calMigRow
				cmRows, err := tx.Query(ctx, `
					SELECT id::text, event_id::text, status, expires_at, legacy_payload
					FROM calendar_event_migrations
					WHERE mailbox_id=$1 AND event_id = ANY($2)
					FOR UPDATE`, mailboxID, eventIDs)
				if err == nil {
					for cmRows.Next() {
						var cm calMigRow
						if err := cmRows.Scan(&cm.id, &cm.eventID, &cm.status, &cm.expiresAt, &cm.legacy); err == nil {
							calMigRows = append(calMigRows, cm)
						}
					}
					cmRows.Close()
				}

				// Check active staged migrations - Must guard against active migrations first (409 Conflict)
				for _, cm := range calMigRows {
					if cm.status == "staged" {
						if time.Now().After(cm.expiresAt) {
							// Expired: roll back
							if len(cm.legacy) > 0 {
								_, _ = tx.Exec(ctx, `UPDATE calendar_events SET encrypted_payload=$1, updated_at=now() WHERE id=$2`, cm.legacy, cm.eventID)
							}
							_, _ = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='ttl_expired_on_calendar_delete' WHERE id=$1`, cm.id)
						} else {
							http.Error(w, "cannot delete calendar with active event migrations in progress", http.StatusConflict)
							return
						}
					}
				}

				// Clean up terminal migration history rows so foreign key constraint allows calendar deletion cascade
				_, err = tx.Exec(ctx, `
					DELETE FROM calendar_event_migrations
					WHERE mailbox_id=$1 AND event_id = ANY($2) AND status IN ('finalized', 'rolled_back')`, mailboxID, eventIDs)
				if err != nil {
					http.Error(w, "failed to clean up terminal migration records", http.StatusInternalServerError)
					return
				}
			}

			// Disallow deleting if it is the only calendar
			var count int
			err = tx.QueryRow(ctx, `SELECT count(*) FROM user_calendars WHERE mailbox_id=$1`, mailboxID).Scan(&count)
			if err != nil {
				http.Error(w, "failed to verify calendars", http.StatusInternalServerError)
				return
			}
			if count <= 1 {
				http.Error(w, "cannot delete the only remaining calendar", http.StatusBadRequest)
				return
			}

			_, err = tx.Exec(ctx, `DELETE FROM user_calendars WHERE id=$1 AND mailbox_id=$2`, calendarID, mailboxID)
			if err != nil {
				http.Error(w, "failed to delete calendar", http.StatusInternalServerError)
				return
			}

			if wasDefault {
				// Reassign default to any remaining calendar
				_, err = tx.Exec(ctx, `
					UPDATE user_calendars SET is_default=true
					WHERE id = (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1)`, mailboxID)
				if err != nil {
					http.Error(w, "failed to reassign default calendar", http.StatusInternalServerError)
					return
				}
			}

			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		if err := ensureDefaultCalendar(ctx, conn, mailboxID); err != nil {
			http.Error(w, "failed to ensure default calendar", http.StatusInternalServerError)
			return
		}

		rows, err := conn.Query(ctx, `
			SELECT c.id::text, c.mailbox_id::text, c.name, c.color, c.is_default, c.created_at, c.updated_at,
			       m.local_part || '@' || d.name as owner_email
			FROM user_calendars c
			JOIN mailboxes m ON m.id = c.mailbox_id
			JOIN domains d ON d.id = m.domain_id
			WHERE c.mailbox_id=$1
			ORDER BY c.is_default DESC, c.name ASC`, mailboxID)
		if err != nil {
			http.Error(w, "failed to query calendars", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		calendars := make([]UserCalendar, 0)
		for rows.Next() {
			var c UserCalendar
			var createdAt, updatedAt time.Time
			var ownerEmail string
			if err := rows.Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt, &ownerEmail); err != nil {
				http.Error(w, "failed to scan calendar", http.StatusInternalServerError)
				return
			}
			c.CreatedAt = createdAt.Format(time.RFC3339)
			c.UpdatedAt = updatedAt.Format(time.RFC3339)
			c.IsShared = false
			c.Permission = "owner"
			c.OwnerEmail = &ownerEmail
			calendars = append(calendars, c)
		}
		rows.Close()

		// Append calendars shared with this mailbox
		sharedRows, err := conn.Query(ctx, `
			SELECT c.id::text, c.mailbox_id::text, c.name, c.color, c.is_default, c.created_at, c.updated_at,
			       cs.id::text, cs.permission, COALESCE(cs.encrypted_key, ''),
			       m.local_part || '@' || d.name as owner_email
			FROM calendar_shares cs
			JOIN user_calendars c ON c.id = cs.calendar_id
			JOIN mailboxes m ON m.id = c.mailbox_id
			JOIN domains d ON d.id = m.domain_id
			WHERE cs.grantee_mailbox_id=$1 AND cs.status='active'
			ORDER BY c.name ASC`, mailboxID)
		if err == nil {
			defer sharedRows.Close()
			for sharedRows.Next() {
				var c UserCalendar
				var createdAt, updatedAt time.Time
				var shareID, permission, encKey, ownerEmail string
				if err := sharedRows.Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt,
					&shareID, &permission, &encKey, &ownerEmail); err == nil {
					c.CreatedAt = createdAt.Format(time.RFC3339)
					c.UpdatedAt = updatedAt.Format(time.RFC3339)
					c.IsShared = true
					c.Permission = permission
					c.ShareID = &shareID
					c.EncryptedKey = &encKey
					c.OwnerEmail = &ownerEmail
					calendars = append(calendars, c)
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(calendars)

	case http.MethodPost:
		var req CreateCalendarReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		if len(req.Name) < 1 || len(req.Name) > 100 {
			http.Error(w, "name must be between 1 and 100 characters", http.StatusBadRequest)
			return
		}
		if req.Color == "" {
			req.Color = "#9E725F"
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			http.Error(w, "failed to start transaction", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)

		if req.IsDefault {
			_, err = tx.Exec(ctx, `UPDATE user_calendars SET is_default=false WHERE mailbox_id=$1`, mailboxID)
			if err != nil {
				http.Error(w, "failed to update default calendar", http.StatusInternalServerError)
				return
			}
		}

		var c UserCalendar
		var createdAt, updatedAt time.Time
		err = tx.QueryRow(ctx, `
			INSERT INTO user_calendars (mailbox_id, name, color, is_default)
			VALUES ($1, $2, $3, $4)
			RETURNING id::text, mailbox_id::text, name, color, is_default, created_at, updated_at`,
			mailboxID, req.Name, req.Color, req.IsDefault).
			Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt)
		if err != nil {
			http.Error(w, "failed to create calendar", http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
			return
		}

		c.CreatedAt = createdAt.Format(time.RFC3339)
		c.UpdatedAt = updatedAt.Format(time.RFC3339)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(c)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// calendarSharesHandler handles /v1/mailboxes/{mailbox_id}/calendars/{calendar_id}/shares and /{share_id}
func calendarSharesHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, userOrgID, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	calendarID := r.PathValue("calendar_id")
	if calendarID == "" {
		http.Error(w, "calendar ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(calendarID); err != nil {
		http.Error(w, "calendar ID must be UUID", http.StatusBadRequest)
		return
	}

	shareID := r.PathValue("share_id")

	// Verify calendar existence and owner
	var calOwnerID string
	err = conn.QueryRow(ctx, `SELECT mailbox_id::text FROM user_calendars WHERE id=$1`, calendarID).Scan(&calOwnerID)
	if err == pgx.ErrNoRows {
		http.Error(w, "calendar not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to query calendar", http.StatusInternalServerError)
		return
	}

	// Route /{share_id}
	if shareID != "" {
		if _, err := uuid.Parse(shareID); err != nil {
			http.Error(w, "share ID must be UUID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodDelete:
			// Allow either calendar owner OR grantee to revoke/leave the share
			var grantorMbID, granteeMbID string
			err := conn.QueryRow(ctx, `
				SELECT grantor_mailbox_id::text, grantee_mailbox_id::text
				FROM calendar_shares
				WHERE id=$1 AND calendar_id=$2`, shareID, calendarID).Scan(&grantorMbID, &granteeMbID)
			if err == pgx.ErrNoRows {
				http.Error(w, "share not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query share", http.StatusInternalServerError)
				return
			}
			if grantorMbID != mailboxID && granteeMbID != mailboxID {
				http.Error(w, "not authorized to revoke this share", http.StatusForbidden)
				return
			}

			_, err = conn.Exec(ctx, `
				UPDATE calendar_shares
				SET status='revoked', updated_at=now()
				WHERE id=$1`, shareID)
			if err != nil {
				http.Error(w, "failed to revoke share", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		case http.MethodPatch, http.MethodPut:
			if calOwnerID != mailboxID {
				http.Error(w, "only calendar owner can update share permissions", http.StatusForbidden)
				return
			}
			var req UpdateCalendarShareReq
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}
			if req.Permission != nil && *req.Permission != "read" && *req.Permission != "write" {
				http.Error(w, "permission must be 'read' or 'write'", http.StatusBadRequest)
				return
			}
			if req.Status != nil && *req.Status != "active" && *req.Status != "revoked" {
				http.Error(w, "status must be 'active' or 'revoked'", http.StatusBadRequest)
				return
			}

			var s CalendarShare
			var createdAt, updatedAt time.Time
			err := conn.QueryRow(ctx, `
				UPDATE calendar_shares
				SET permission = COALESCE($1, permission),
				    encrypted_key = COALESCE($2, encrypted_key),
				    status = COALESCE($3, status),
				    updated_at = now()
				WHERE id=$4 AND calendar_id=$5
				RETURNING id::text, calendar_id::text, grantor_mailbox_id::text, grantee_mailbox_id::text,
				          permission, COALESCE(encrypted_key, ''), status, created_at, updated_at`,
				req.Permission, req.EncryptedKey, req.Status, shareID, calendarID).
				Scan(&s.ID, &s.CalendarID, &s.GrantorMailboxID, &s.GranteeMailboxID,
					&s.Permission, &s.EncryptedKey, &s.Status, &createdAt, &updatedAt)
			if err == pgx.ErrNoRows {
				http.Error(w, "share not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to update share", http.StatusInternalServerError)
				return
			}
			s.CreatedAt = createdAt.Format(time.RFC3339)
			s.UpdatedAt = updatedAt.Format(time.RFC3339)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(s)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	// Caller must be calendar owner to list or create shares
	if calOwnerID != mailboxID {
		http.Error(w, "only calendar owner can manage shares", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT cs.id::text, cs.calendar_id::text, cs.grantor_mailbox_id::text, cs.grantee_mailbox_id::text,
			       cs.permission, COALESCE(cs.encrypted_key, ''), cs.status, cs.created_at, cs.updated_at,
			       gm.local_part || '@' || gd.name as grantee_email
			FROM calendar_shares cs
			JOIN mailboxes gm ON gm.id = cs.grantee_mailbox_id
			JOIN domains gd ON gd.id = gm.domain_id
			WHERE cs.calendar_id=$1 AND cs.grantor_mailbox_id=$2 AND cs.status='active'
			ORDER BY cs.created_at ASC`, calendarID, mailboxID)
		if err != nil {
			http.Error(w, "failed to query shares", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		shares := make([]CalendarShare, 0)
		for rows.Next() {
			var s CalendarShare
			var createdAt, updatedAt time.Time
			if err := rows.Scan(&s.ID, &s.CalendarID, &s.GrantorMailboxID, &s.GranteeMailboxID,
				&s.Permission, &s.EncryptedKey, &s.Status, &createdAt, &updatedAt, &s.GranteeEmail); err != nil {
				http.Error(w, "failed to scan share", http.StatusInternalServerError)
				return
			}
			s.CreatedAt = createdAt.Format(time.RFC3339)
			s.UpdatedAt = updatedAt.Format(time.RFC3339)
			shares = append(shares, s)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(shares)

	case http.MethodPost:
		var req CreateCalendarShareReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}
		req.GranteeEmail = strings.TrimSpace(strings.ToLower(req.GranteeEmail))
		if req.GranteeEmail == "" {
			http.Error(w, "grantee_email is required", http.StatusBadRequest)
			return
		}
		if req.Permission != "read" && req.Permission != "write" {
			req.Permission = "read"
		}

		// Look up grantee mailbox by email
		var granteeMailboxID, granteeOrgID string
		err := conn.QueryRow(ctx, `
			SELECT m.id::text, m.org_id::text
			FROM mailboxes m
			JOIN domains d ON d.id = m.domain_id
			WHERE lower(m.local_part || '@' || d.name) = $1 AND m.is_active = true`, req.GranteeEmail).
			Scan(&granteeMailboxID, &granteeOrgID)
		if err == pgx.ErrNoRows {
			http.Error(w, `{"error":"grantee_mailbox_not_found"}`, http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "failed to query grantee mailbox", http.StatusInternalServerError)
			return
		}

		// Strictly enforce same-organization sharing
		if granteeOrgID != userOrgID {
			http.Error(w, `{"error":"cannot_share_cross_org"}`, http.StatusForbidden)
			return
		}

		// Cannot share calendar with self
		if granteeMailboxID == mailboxID {
			http.Error(w, `{"error":"cannot_share_with_self"}`, http.StatusBadRequest)
			return
		}

		var s CalendarShare
		var createdAt, updatedAt time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO calendar_shares (calendar_id, grantor_mailbox_id, grantee_mailbox_id, permission, encrypted_key, status)
			VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'active')
			ON CONFLICT (calendar_id, grantee_mailbox_id)
			DO UPDATE SET permission = EXCLUDED.permission,
			              encrypted_key = COALESCE(EXCLUDED.encrypted_key, calendar_shares.encrypted_key),
			              status = 'active',
			              updated_at = now()
			RETURNING id::text, calendar_id::text, grantor_mailbox_id::text, grantee_mailbox_id::text,
			          permission, COALESCE(encrypted_key, ''), status, created_at, updated_at`,
			calendarID, mailboxID, granteeMailboxID, req.Permission, req.EncryptedKey).
			Scan(&s.ID, &s.CalendarID, &s.GrantorMailboxID, &s.GranteeMailboxID,
				&s.Permission, &s.EncryptedKey, &s.Status, &createdAt, &updatedAt)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to save calendar share: %v", err), http.StatusInternalServerError)
			return
		}
		s.GranteeEmail = req.GranteeEmail
		s.CreatedAt = createdAt.Format(time.RFC3339)
		s.UpdatedAt = updatedAt.Format(time.RFC3339)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(s)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// calendarEventsHandler handles /v1/mailboxes/{mailbox_id}/calendar-events and /{event_id}
func calendarEventsHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, _, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	eventID := r.PathValue("event_id")

	if eventID != "" {
		if _, err := uuid.Parse(eventID); err != nil {
			http.Error(w, "event ID must be UUID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodGet:
			opportunisticallyRecoverExpiredMigration(ctx, conn, mailboxID, eventID)

			var ev CalendarEvent
			var payload []byte
			var startTime, endTime, createdAt, updatedAt time.Time
			var rrule *string
			err := conn.QueryRow(ctx, `
				SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day,
				       rrule, status, encrypted_payload, created_at, updated_at
				FROM calendar_events
				WHERE id=$1 AND (
					mailbox_id=$2 OR
					calendar_id IN (
						SELECT calendar_id FROM calendar_shares
						WHERE grantee_mailbox_id=$2 AND status='active'
					)
				)`, eventID, mailboxID).
				Scan(&ev.ID, &ev.MailboxID, &ev.CalendarID, &startTime, &endTime, &ev.IsAllDay,
					&rrule, &ev.Status, &payload, &createdAt, &updatedAt)
			if err == pgx.ErrNoRows {
				http.Error(w, "event not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query event", http.StatusInternalServerError)
				return
			}
			ev.StartTime = startTime.Format(time.RFC3339)
			ev.EndTime = endTime.Format(time.RFC3339)
			if rrule != nil {
				ev.RRule = *rrule
			}
			ev.EncryptedPayload = base64.StdEncoding.EncodeToString(payload)
			ev.CreatedAt = createdAt.Format(time.RFC3339)
			ev.UpdatedAt = updatedAt.Format(time.RFC3339)

			if ev.RRule != "" {
				excRows, err := conn.Query(ctx, `
					SELECT id::text, parent_event_id::text, mailbox_id::text, calendar_id::text,
					       recurrence_id, is_cancelled, start_time, end_time, is_all_day,
					       status, encrypted_payload, created_at, updated_at
					FROM calendar_event_exceptions
					WHERE parent_event_id=$1
					ORDER BY start_time ASC`, ev.ID)
				if err == nil {
					defer excRows.Close()
					for excRows.Next() {
						var exc CalendarEventException
						var excStart, excEnd, excCreated, excUpdated time.Time
						var excPayload []byte
						if err := excRows.Scan(&exc.ID, &exc.ParentEventID, &exc.MailboxID, &exc.CalendarID,
							&exc.RecurrenceID, &exc.IsCancelled, &excStart, &excEnd, &exc.IsAllDay,
							&exc.Status, &excPayload, &excCreated, &excUpdated); err == nil {
							exc.StartTime = excStart.Format(time.RFC3339)
							exc.EndTime = excEnd.Format(time.RFC3339)
							exc.EncryptedPayload = base64.StdEncoding.EncodeToString(excPayload)
							exc.CreatedAt = excCreated.Format(time.RFC3339)
							exc.UpdatedAt = excUpdated.Format(time.RFC3339)
							ev.Exceptions = append(ev.Exceptions, exc)
						}
					}
				}
			}

			etag := computeCalendarEventETag(ev.ID, ev.MailboxID, ev.CalendarID, startTime, endTime, ev.IsAllDay, rrule, ev.Status, payload, updatedAt)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("ETag", etag)
			json.NewEncoder(w).Encode(ev)

		case http.MethodPatch, http.MethodPut:
			var req UpdateEventReq
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}

			// Validate timestamps if provided
			var parsedStart, parsedEnd *time.Time
			if req.StartTime != nil {
				t, err := time.Parse(time.RFC3339, *req.StartTime)
				if err != nil {
					http.Error(w, "invalid start_time format (RFC3339 required)", http.StatusBadRequest)
					return
				}
				parsedStart = &t
			}
			if req.EndTime != nil {
				t, err := time.Parse(time.RFC3339, *req.EndTime)
				if err != nil {
					http.Error(w, "invalid end_time format (RFC3339 required)", http.StatusBadRequest)
					return
				}
				parsedEnd = &t
			}

			var payloadBytes []byte
			if req.EncryptedPayload != nil {
				b, err := validateCalendarEventEnvelope(*req.EncryptedPayload)
				if err != nil {
					http.Error(w, fmt.Sprintf("invalid encrypted_payload: %v", err), http.StatusBadRequest)
					return
				}
				payloadBytes = b
			}

			if req.CalendarID != nil {
				var targetOwner string
				err := conn.QueryRow(ctx, `SELECT mailbox_id::text FROM user_calendars WHERE id=$1`, *req.CalendarID).Scan(&targetOwner)
				if err == pgx.ErrNoRows {
					http.Error(w, "invalid calendar_id for this mailbox", http.StatusBadRequest)
					return
				}
				if targetOwner != mailboxID {
					var perm string
					err = conn.QueryRow(ctx, `
						SELECT permission FROM calendar_shares
						WHERE calendar_id=$1 AND grantee_mailbox_id=$2 AND status='active'`,
						*req.CalendarID, mailboxID).Scan(&perm)
					if err != nil || perm != "write" {
						http.Error(w, "invalid calendar_id for this mailbox", http.StatusBadRequest)
						return
					}
				}
			}

			tx, err := conn.Begin(ctx)
			if err != nil {
				http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
				return
			}
			defer tx.Rollback(ctx)

			// 1. Lock parent row (canonical lock order: Parent calendar_events first)
			var currentEv CalendarEvent
			var currentPayload []byte
			var startTime, endTime, createdAt, updatedAt time.Time
			var rrule *string
			err = tx.QueryRow(ctx, `
				SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day,
				       rrule, status, encrypted_payload, created_at, updated_at
				FROM calendar_events
				WHERE id=$1
				FOR UPDATE`, eventID).Scan(
				&currentEv.ID, &currentEv.MailboxID, &currentEv.CalendarID, &startTime, &endTime, &currentEv.IsAllDay,
				&rrule, &currentEv.Status, &currentPayload, &createdAt, &updatedAt)
			if err == pgx.ErrNoRows {
				http.Error(w, "event not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query event", http.StatusInternalServerError)
				return
			}

			// Check permissions: owner or active write share
			if currentEv.MailboxID != mailboxID {
				var sharePerm string
				err = tx.QueryRow(ctx, `
					SELECT permission FROM calendar_shares
					WHERE calendar_id=$1 AND grantee_mailbox_id=$2 AND status='active'`,
					currentEv.CalendarID, mailboxID).Scan(&sharePerm)
				if err == pgx.ErrNoRows {
					http.Error(w, "event not found", http.StatusNotFound)
					return
				}
				if err != nil {
					http.Error(w, "failed to query calendar share", http.StatusInternalServerError)
					return
				}
				if sharePerm != "write" {
					http.Error(w, `{"error":"read_only_calendar"}`, http.StatusForbidden)
					return
				}
			}

			// If-Match check if supplied
			ifMatch := strings.TrimSpace(r.Header.Get("If-Match"))
			if ifMatch != "" {
				currentETag := computeCalendarEventETag(currentEv.ID, currentEv.MailboxID, currentEv.CalendarID, startTime, endTime, currentEv.IsAllDay, rrule, currentEv.Status, currentPayload, updatedAt)
				if ifMatch != currentETag {
					http.Error(w, "precondition failed", http.StatusPreconditionFailed)
					return
				}
			}

			// 2. Lock child migration row (canonical lock order: Child calendar_event_migrations second)
			var stagedMigID string
			var stagedLegacy []byte
			var stagedExpiresAt time.Time
			err = tx.QueryRow(ctx, `
				SELECT id::text, legacy_payload, expires_at
				FROM calendar_event_migrations
				WHERE event_id=$1 AND mailbox_id=$2 AND status='staged'
				FOR UPDATE`, eventID, currentEv.MailboxID).Scan(&stagedMigID, &stagedLegacy, &stagedExpiresAt)
			if err == nil {
				if time.Now().After(stagedExpiresAt) {
					// Expired staged migration: roll back inline
					if len(stagedLegacy) > 0 {
						_, _ = tx.Exec(ctx, `UPDATE calendar_events SET encrypted_payload=$1, updated_at=now() WHERE id=$2`, stagedLegacy, eventID)
					}
					_, _ = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='ttl_expired_on_write' WHERE id=$1`, stagedMigID)
				} else {
					// Active non-expired staged migration: reject write with 409 Conflict
					http.Error(w, "event migration in progress", http.StatusConflict)
					return
				}
			}

			var ev CalendarEvent
			var payload []byte
			var newStartTime, newEndTime, newCreatedAt, newUpdatedAt time.Time
			var newRRule *string

			err = tx.QueryRow(ctx, `
				UPDATE calendar_events
				SET calendar_id = COALESCE($1, calendar_id),
				    start_time = COALESCE($2, start_time),
				    end_time = COALESCE($3, end_time),
				    is_all_day = COALESCE($4, is_all_day),
				    rrule = COALESCE($5, rrule),
				    status = COALESCE($6, status),
				    encrypted_payload = CASE WHEN $7::bytea IS NOT NULL THEN $7::bytea ELSE encrypted_payload END,
				    updated_at = now()
				WHERE id=$8 AND mailbox_id=$9
				RETURNING id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day,
				          rrule, status, encrypted_payload, created_at, updated_at`,
				req.CalendarID, parsedStart, parsedEnd, req.IsAllDay, req.RRule, req.Status, payloadBytes, eventID, currentEv.MailboxID).
				Scan(&ev.ID, &ev.MailboxID, &ev.CalendarID, &newStartTime, &newEndTime, &ev.IsAllDay,
					&newRRule, &ev.Status, &payload, &newCreatedAt, &newUpdatedAt)
			if err != nil {
				http.Error(w, fmt.Sprintf("failed to update event: %v", err), http.StatusBadRequest)
				return
			}

			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit update", http.StatusInternalServerError)
				return
			}

			ev.StartTime = newStartTime.Format(time.RFC3339)
			ev.EndTime = newEndTime.Format(time.RFC3339)
			if newRRule != nil {
				ev.RRule = *newRRule
			}
			ev.EncryptedPayload = base64.StdEncoding.EncodeToString(payload)
			ev.CreatedAt = newCreatedAt.Format(time.RFC3339)
			ev.UpdatedAt = newUpdatedAt.Format(time.RFC3339)

			etag := computeCalendarEventETag(ev.ID, ev.MailboxID, ev.CalendarID, newStartTime, newEndTime, ev.IsAllDay, newRRule, ev.Status, payload, newUpdatedAt)
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("ETag", etag)
			json.NewEncoder(w).Encode(ev)

		case http.MethodDelete:
			tx, err := conn.Begin(ctx)
			if err != nil {
				http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
				return
			}
			defer tx.Rollback(ctx)

			// 1. Lock parent row (canonical lock order: Parent calendar_events first)
			var delEvMailboxID, delEvCalID string
			err = tx.QueryRow(ctx, `SELECT mailbox_id::text, calendar_id::text FROM calendar_events WHERE id=$1 FOR UPDATE`, eventID).Scan(&delEvMailboxID, &delEvCalID)
			if err == pgx.ErrNoRows {
				http.Error(w, "event not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query event", http.StatusInternalServerError)
				return
			}

			// Check permissions: owner or active write share
			if delEvMailboxID != mailboxID {
				var sharePerm string
				err = tx.QueryRow(ctx, `
					SELECT permission FROM calendar_shares
					WHERE calendar_id=$1 AND grantee_mailbox_id=$2 AND status='active'`,
					delEvCalID, mailboxID).Scan(&sharePerm)
				if err == pgx.ErrNoRows {
					http.Error(w, "event not found", http.StatusNotFound)
					return
				}
				if err != nil {
					http.Error(w, "failed to query calendar share", http.StatusInternalServerError)
					return
				}
				if sharePerm != "write" {
					http.Error(w, `{"error":"read_only_calendar"}`, http.StatusForbidden)
					return
				}
			}

			// 2. Lock child migration rows (canonical lock order: Child calendar_event_migrations second)
			type migRow struct {
				id        string
				status    string
				expiresAt time.Time
				legacy    []byte
			}
			var migRows []migRow
			qRows, err := tx.Query(ctx, `
				SELECT id::text, status, expires_at, legacy_payload
				FROM calendar_event_migrations
				WHERE event_id=$1 AND mailbox_id=$2
				FOR UPDATE`, eventID, delEvMailboxID)
			if err == nil {
				for qRows.Next() {
					var r migRow
					if err := qRows.Scan(&r.id, &r.status, &r.expiresAt, &r.legacy); err == nil {
						migRows = append(migRows, r)
					}
				}
				qRows.Close()
			}

			// Reject if active staged migration is in progress
			for _, m := range migRows {
				if m.status == "staged" {
					if time.Now().After(m.expiresAt) {
						// Expired staged migration: roll back
						if len(m.legacy) > 0 {
							_, _ = tx.Exec(ctx, `UPDATE calendar_events SET encrypted_payload=$1, updated_at=now() WHERE id=$2`, m.legacy, eventID)
						}
						_, _ = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='ttl_expired_on_delete' WHERE id=$1`, m.id)
					} else {
						http.Error(w, "cannot delete event with active migration in progress", http.StatusConflict)
						return
					}
				}
			}

			// Clean up terminal migration history rows so foreign key constraint allows event deletion
			_, err = tx.Exec(ctx, `
				DELETE FROM calendar_event_migrations
				WHERE event_id=$1 AND mailbox_id=$2 AND status IN ('finalized', 'rolled_back')`, eventID, delEvMailboxID)
			if err != nil {
				http.Error(w, "failed to clean up terminal migration records", http.StatusInternalServerError)
				return
			}

			tag, err := tx.Exec(ctx, `DELETE FROM calendar_events WHERE id=$1 AND mailbox_id=$2`, eventID, delEvMailboxID)
			if err != nil {
				http.Error(w, "failed to delete event", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "event not found", http.StatusNotFound)
				return
			}

			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit event deletion", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			if err != nil {
				http.Error(w, "failed to delete event", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "event not found", http.StatusNotFound)
				return
			}

			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit event deletion", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Parse query filters
		startParam := r.URL.Query().Get("start")
		endParam := r.URL.Query().Get("end")
		calParam := r.URL.Query().Get("calendar_id")

		var startT, endT time.Time
		if startParam != "" {
			var err error
			startT, err = time.Parse(time.RFC3339, startParam)
			if err != nil {
				http.Error(w, "invalid start query parameter (RFC3339 required)", http.StatusBadRequest)
				return
			}
		} else {
			// Default window: -30 days to +60 days
			startT = time.Now().AddDate(0, 0, -30)
		}

		if endParam != "" {
			var err error
			endT, err = time.Parse(time.RFC3339, endParam)
			if err != nil {
				http.Error(w, "invalid end query parameter (RFC3339 required)", http.StatusBadRequest)
				return
			}
		} else {
			endT = time.Now().AddDate(0, 0, 90)
		}

		query := `
			SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day,
			       rrule, status, encrypted_payload, created_at, updated_at
			FROM calendar_events
			WHERE (
			    mailbox_id = $1
			    OR calendar_id IN (
			        SELECT calendar_id FROM calendar_shares
			        WHERE grantee_mailbox_id = $1 AND status = 'active'
			    )
			  )
			  AND ($2::uuid IS NULL OR calendar_id=$2::uuid)
			  AND (
			      (start_time <= $4 AND end_time >= $3)
			      OR (rrule IS NOT NULL AND length(rrule) > 0)
			  )
			ORDER BY start_time ASC`

		var calUUID *uuid.UUID
		if calParam != "" {
			parsed, err := uuid.Parse(calParam)
			if err == nil {
				calUUID = &parsed
			}
		}

		rows, err := conn.Query(ctx, query, mailboxID, calUUID, startT, endT)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to query events: %v", err), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		events := make([]CalendarEvent, 0)
		for rows.Next() {
			var ev CalendarEvent
			var payload []byte
			var startTime, endTime, createdAt, updatedAt time.Time
			var rrule *string
			if err := rows.Scan(&ev.ID, &ev.MailboxID, &ev.CalendarID, &startTime, &endTime, &ev.IsAllDay,
				&rrule, &ev.Status, &payload, &createdAt, &updatedAt); err != nil {
				http.Error(w, "failed to scan event", http.StatusInternalServerError)
				return
			}
			ev.StartTime = startTime.Format(time.RFC3339)
			ev.EndTime = endTime.Format(time.RFC3339)
			if rrule != nil {
				ev.RRule = *rrule
			}
			ev.EncryptedPayload = base64.StdEncoding.EncodeToString(payload)
			ev.CreatedAt = createdAt.Format(time.RFC3339)
			ev.UpdatedAt = updatedAt.Format(time.RFC3339)
			events = append(events, ev)
		}

		var recurringEventIDs []string
		for _, ev := range events {
			if ev.RRule != "" {
				recurringEventIDs = append(recurringEventIDs, ev.ID)
			}
		}

		if len(recurringEventIDs) > 0 {
			excRows, err := conn.Query(ctx, `
				SELECT id::text, parent_event_id::text, mailbox_id::text, calendar_id::text,
				       recurrence_id, is_cancelled, start_time, end_time, is_all_day,
				       status, encrypted_payload, created_at, updated_at
				FROM calendar_event_exceptions
				WHERE parent_event_id = ANY($1)
				ORDER BY start_time ASC`, recurringEventIDs)
			if err == nil {
				defer excRows.Close()
				excMap := make(map[string][]CalendarEventException)
				for excRows.Next() {
					var exc CalendarEventException
					var excStart, excEnd, excCreated, excUpdated time.Time
					var excPayload []byte
					if err := excRows.Scan(&exc.ID, &exc.ParentEventID, &exc.MailboxID, &exc.CalendarID,
						&exc.RecurrenceID, &exc.IsCancelled, &excStart, &excEnd, &exc.IsAllDay,
						&exc.Status, &excPayload, &excCreated, &excUpdated); err == nil {
						exc.StartTime = excStart.Format(time.RFC3339)
						exc.EndTime = excEnd.Format(time.RFC3339)
						exc.EncryptedPayload = base64.StdEncoding.EncodeToString(excPayload)
						exc.CreatedAt = excCreated.Format(time.RFC3339)
						exc.UpdatedAt = excUpdated.Format(time.RFC3339)
						excMap[exc.ParentEventID] = append(excMap[exc.ParentEventID], exc)
					}
				}
				for i := range events {
					if exList, ok := excMap[events[i].ID]; ok {
						events[i].Exceptions = exList
					}
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(events)

	case http.MethodPost:
		var req CreateEventReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		if req.CalendarID == "" {
			http.Error(w, "calendar_id is required", http.StatusBadRequest)
			return
		}
		if _, err := uuid.Parse(req.CalendarID); err != nil {
			http.Error(w, "calendar_id must be UUID", http.StatusBadRequest)
			return
		}

		// Verify calendar belongs to mailbox or is shared with write permission
		var calOwnerMailboxID string
		err := conn.QueryRow(ctx, `SELECT mailbox_id::text FROM user_calendars WHERE id=$1`, req.CalendarID).Scan(&calOwnerMailboxID)
		if err == pgx.ErrNoRows {
			http.Error(w, "invalid calendar_id for this mailbox", http.StatusBadRequest)
			return
		}
		if err != nil {
			http.Error(w, "failed to query calendar", http.StatusInternalServerError)
			return
		}

		targetEventMailboxID := mailboxID
		if calOwnerMailboxID != mailboxID {
			var sharePerm string
			err = conn.QueryRow(ctx, `
				SELECT permission FROM calendar_shares
				WHERE calendar_id=$1 AND grantee_mailbox_id=$2 AND status='active'`,
				req.CalendarID, mailboxID).Scan(&sharePerm)
			if err == pgx.ErrNoRows {
				http.Error(w, "not authorized for this calendar", http.StatusForbidden)
				return
			}
			if err != nil {
				http.Error(w, "failed to query calendar share", http.StatusInternalServerError)
				return
			}
			if sharePerm != "write" {
				http.Error(w, `{"error":"read_only_calendar"}`, http.StatusForbidden)
				return
			}
			targetEventMailboxID = calOwnerMailboxID
		}

		startT, err := time.Parse(time.RFC3339, req.StartTime)
		if err != nil {
			http.Error(w, "invalid start_time format (RFC3339 required)", http.StatusBadRequest)
			return
		}

		endT, err := time.Parse(time.RFC3339, req.EndTime)
		if err != nil {
			http.Error(w, "invalid end_time format (RFC3339 required)", http.StatusBadRequest)
			return
		}

		if endT.Before(startT) {
			http.Error(w, "end_time cannot be before start_time", http.StatusBadRequest)
			return
		}

		if req.Status == "" {
			req.Status = "busy"
		}

		payloadBytes, err := validateCalendarEventEnvelope(req.EncryptedPayload)
		if err != nil {
			http.Error(w, fmt.Sprintf("invalid encrypted_payload: %v", err), http.StatusBadRequest)
			return
		}

		var ev CalendarEvent
		var payload []byte
		var createdAt, updatedAt time.Time
		var rrule *string

		err = conn.QueryRow(ctx, `
			INSERT INTO calendar_events (
				mailbox_id, calendar_id, start_time, end_time, is_all_day, rrule, status, encrypted_payload
			) VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8)
			RETURNING id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day,
			          rrule, status, encrypted_payload, created_at, updated_at`,
			targetEventMailboxID, req.CalendarID, startT, endT, req.IsAllDay, req.RRule, req.Status, payloadBytes).
			Scan(&ev.ID, &ev.MailboxID, &ev.CalendarID, &startT, &endT, &ev.IsAllDay,
				&rrule, &ev.Status, &payload, &createdAt, &updatedAt)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to insert event: %v", err), http.StatusInternalServerError)
			return
		}

		ev.StartTime = startT.Format(time.RFC3339)
		ev.EndTime = endT.Format(time.RFC3339)
		if rrule != nil {
			ev.RRule = *rrule
		}
		ev.EncryptedPayload = base64.StdEncoding.EncodeToString(payload)
		ev.CreatedAt = createdAt.Format(time.RFC3339)
		ev.UpdatedAt = updatedAt.Format(time.RFC3339)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(ev)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func calendarEventStageMigrationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	userID, userOrgID, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	eventID := r.PathValue("event_id")
	if _, err := uuid.Parse(eventID); err != nil {
		http.Error(w, "event ID must be UUID", http.StatusBadRequest)
		return
	}

	// Strong If-Match validation:
	ifMatch := strings.TrimSpace(r.Header.Get("If-Match"))
	if ifMatch == "" {
		http.Error(w, "If-Match header required", http.StatusPreconditionRequired)
		return
	}
	if strings.HasPrefix(ifMatch, "W/") {
		http.Error(w, "weak ETags not permitted for migration staging", http.StatusBadRequest)
		return
	}
	if !strings.HasPrefix(ifMatch, "\"") || !strings.HasSuffix(ifMatch, "\"") || len(strings.Trim(ifMatch, "\"")) != 64 {
		http.Error(w, "malformed If-Match ETag", http.StatusBadRequest)
		return
	}

	var req StageMigrationReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}

	stagedBytes, err := validateCalendarEventEnvelope(req.StagedEncryptedPayload)
	if err != nil {
		http.Error(w, fmt.Sprintf("invalid staged_encrypted_payload: %v", err), http.StatusBadRequest)
		return
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 0. Canonical lock order: Lock root mailbox first and verify active state
	var mbActive bool
	var mbOwnerID string
	err = tx.QueryRow(ctx, `
		SELECT is_active, user_id::text
		FROM mailboxes
		WHERE id=$1 AND org_id=$2
		FOR UPDATE`, mailboxID, userOrgID).Scan(&mbActive, &mbOwnerID)
	if err == pgx.ErrNoRows || !mbActive || mbOwnerID != userID {
		http.Error(w, "mailbox not found or deactivated", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to lock mailbox", http.StatusInternalServerError)
		return
	}

	// 1. Lock calendar_events row (Canonical lock order: Parent event second)
	var currentEv CalendarEvent
	var currentPayload []byte
	var startTime, endTime, createdAt, updatedAt time.Time
	var rrule *string
	err = tx.QueryRow(ctx, `
		SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day,
		       rrule, status, encrypted_payload, created_at, updated_at
		FROM calendar_events
		WHERE id=$1 AND mailbox_id=$2
		FOR UPDATE`, eventID, mailboxID).Scan(
		&currentEv.ID, &currentEv.MailboxID, &currentEv.CalendarID, &startTime, &endTime, &currentEv.IsAllDay,
		&rrule, &currentEv.Status, &currentPayload, &createdAt, &updatedAt)
	if err == pgx.ErrNoRows {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to query event", http.StatusInternalServerError)
		return
	}

	// 2. Lock calendar_event_migrations row (Canonical lock order: Child second)
	var existingActiveID string
	var existingExpired bool
	var existingLegacy []byte
	err = tx.QueryRow(ctx, `
		SELECT id::text, expires_at < now(), legacy_payload
		FROM calendar_event_migrations
		WHERE event_id=$1 AND status='staged'
		FOR UPDATE`, eventID).Scan(&existingActiveID, &existingExpired, &existingLegacy)
	if err == nil {
		if existingExpired {
			// Roll back expired migration inline
			if len(existingLegacy) > 0 {
				_, _ = tx.Exec(ctx, `UPDATE calendar_events SET encrypted_payload=$1, updated_at=now() WHERE id=$2`, existingLegacy, eventID)
				currentPayload = existingLegacy
				updatedAt = time.Now()
			}
			_, _ = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='ttl_expired_opportunistic' WHERE id=$1`, existingActiveID)
		} else {
			http.Error(w, "migration already in progress for this event", http.StatusConflict)
			return
		}
	}

	// 3. Verify payload is legacy plaintext
	if len(currentPayload) == 0 || (currentPayload[0] != 0x7B && currentPayload[0] != 0x5B) {
		http.Error(w, "event payload is not a legacy plaintext payload", http.StatusBadRequest)
		return
	}

	// 4. Verify strong ETag match
	currentETag := computeCalendarEventETag(currentEv.ID, currentEv.MailboxID, currentEv.CalendarID, startTime, endTime, currentEv.IsAllDay, rrule, currentEv.Status, currentPayload, updatedAt)
	if ifMatch != currentETag {
		http.Error(w, fmt.Sprintf("precondition failed: expected %s got %s", currentETag, ifMatch), http.StatusPreconditionFailed)
		return
	}

	// 5. Insert preservation row into calendar_event_migrations
	var migrationID string
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO calendar_event_migrations (
			event_id, mailbox_id, legacy_payload, staged_payload, status, etag, expires_at
		) VALUES ($1, $2, $3, $4, 'staged', $5, now() + interval '15 minutes')
		RETURNING id::text, expires_at`,
		eventID, mailboxID, currentPayload, stagedBytes, currentETag).Scan(&migrationID, &expiresAt)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to preserve legacy event: %v", err), http.StatusInternalServerError)
		return
	}

	// 6. Update calendar_events with staged replacement envelope
	var newUpdatedAt time.Time
	err = tx.QueryRow(ctx, `
		UPDATE calendar_events
		SET encrypted_payload = $1, updated_at = now()
		WHERE id = $2 AND mailbox_id = $3
		RETURNING updated_at`, stagedBytes, eventID, mailboxID).Scan(&newUpdatedAt)
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to stage replacement envelope: %v", err), http.StatusInternalServerError)
		return
	}

	newETag := computeCalendarEventETag(currentEv.ID, currentEv.MailboxID, currentEv.CalendarID, startTime, endTime, currentEv.IsAllDay, rrule, currentEv.Status, stagedBytes, newUpdatedAt)

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit staging transaction", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", newETag)
	json.NewEncoder(w).Encode(StageMigrationResp{
		MigrationID: migrationID,
		EventID:     eventID,
		Status:      "staged",
		ExpiresAt:   expiresAt.Format(time.RFC3339),
		UpdatedAt:   newUpdatedAt.Format(time.RFC3339),
		ETag:        newETag,
	})
}

func calendarEventFinalizeMigrationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	userID, userOrgID, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	eventID := r.PathValue("event_id")
	if _, err := uuid.Parse(eventID); err != nil {
		http.Error(w, "event ID must be UUID", http.StatusBadRequest)
		return
	}

	var req FinalizeMigrationReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}
	if req.MigrationID == "" {
		http.Error(w, "migration_id required", http.StatusBadRequest)
		return
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 0. Canonical lock order: Lock root mailbox first and verify active state
	var mbActive bool
	var mbOwnerID string
	err = tx.QueryRow(ctx, `
		SELECT is_active, user_id::text
		FROM mailboxes
		WHERE id=$1 AND org_id=$2
		FOR UPDATE`, mailboxID, userOrgID).Scan(&mbActive, &mbOwnerID)
	if err == pgx.ErrNoRows || !mbActive || mbOwnerID != userID {
		http.Error(w, "mailbox not found or deactivated", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to lock mailbox", http.StatusInternalServerError)
		return
	}

	// 1. Canonical lock order: Lock parent calendar_events second
	var dummyID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM calendar_events WHERE id=$1 AND mailbox_id=$2 FOR UPDATE`, eventID, mailboxID).Scan(&dummyID)
	if err == pgx.ErrNoRows {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to query event", http.StatusInternalServerError)
		return
	}

	// Canonical lock order: Lock child calendar_event_migrations second
	var migID, status string
	var expiresAt time.Time
	var finalizedAt *time.Time
	var legacyPayload []byte
	err = tx.QueryRow(ctx, `
		SELECT id::text, status, expires_at, finalized_at, legacy_payload
		FROM calendar_event_migrations
		WHERE id=$1 AND event_id=$2 AND mailbox_id=$3
		FOR UPDATE`, req.MigrationID, eventID, mailboxID).Scan(&migID, &status, &expiresAt, &finalizedAt, &legacyPayload)
	if err == pgx.ErrNoRows {
		http.Error(w, "migration record not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to query migration record", http.StatusInternalServerError)
		return
	}

	// Idempotent finalization:
	if status == "finalized" {
		fStr := ""
		if finalizedAt != nil {
			fStr = finalizedAt.Format(time.RFC3339)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(FinalizeMigrationResp{
			MigrationID: migID,
			EventID:     eventID,
			Status:      "finalized",
			FinalizedAt: fStr,
		})
		return
	}

	if status == "rolled_back" {
		http.Error(w, "migration already rolled back", http.StatusConflict)
		return
	}
	if status != "staged" {
		http.Error(w, "invalid migration status", http.StatusConflict)
		return
	}

	// Check expiration race
	if time.Now().After(expiresAt) {
		// Sweeper/timeout race: restore legacy payload, mark rolled_back
		if len(legacyPayload) > 0 {
			_, _ = tx.Exec(ctx, `UPDATE calendar_events SET encrypted_payload=$1, updated_at=now() WHERE id=$2`, legacyPayload, eventID)
		}
		_, _ = tx.Exec(ctx, `UPDATE calendar_event_migrations SET status='rolled_back', legacy_payload=NULL, rolled_back_at=now(), rollback_reason='ttl_expired_at_finalization' WHERE id=$1`, migID)
		_ = tx.Commit(ctx)
		http.Error(w, "migration expired and was rolled back", http.StatusConflict)
		return
	}

	now := time.Now()
	_, err = tx.Exec(ctx, `
		UPDATE calendar_event_migrations
		SET status='finalized', legacy_payload=NULL, finalized_at=$1
		WHERE id=$2`, now, migID)
	if err != nil {
		http.Error(w, "failed to finalize migration", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit finalization", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(FinalizeMigrationResp{
		MigrationID: migID,
		EventID:     eventID,
		Status:      "finalized",
		FinalizedAt: now.Format(time.RFC3339),
	})
}

func calendarEventRollbackMigrationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	userID, userOrgID, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	eventID := r.PathValue("event_id")
	if _, err := uuid.Parse(eventID); err != nil {
		http.Error(w, "event ID must be UUID", http.StatusBadRequest)
		return
	}

	var req RollbackMigrationReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON payload", http.StatusBadRequest)
		return
	}
	if req.MigrationID == "" {
		http.Error(w, "migration_id required", http.StatusBadRequest)
		return
	}
	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "client_requested_rollback"
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// 0. Canonical lock order: Lock root mailbox first and verify active state
	var mbActive bool
	var mbOwnerID string
	err = tx.QueryRow(ctx, `
		SELECT is_active, user_id::text
		FROM mailboxes
		WHERE id=$1 AND org_id=$2
		FOR UPDATE`, mailboxID, userOrgID).Scan(&mbActive, &mbOwnerID)
	if err == pgx.ErrNoRows || !mbActive || mbOwnerID != userID {
		http.Error(w, "mailbox not found or deactivated", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to lock mailbox", http.StatusInternalServerError)
		return
	}

	// 1. Canonical lock order: Lock parent calendar_events second
	var dummyID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM calendar_events WHERE id=$1 AND mailbox_id=$2 FOR UPDATE`, eventID, mailboxID).Scan(&dummyID)
	if err == pgx.ErrNoRows {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to query event", http.StatusInternalServerError)
		return
	}

	// Canonical lock order: Lock child calendar_event_migrations second
	var migID, status string
	var legacyPayload []byte
	var rolledBackAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, status, legacy_payload, rolled_back_at
		FROM calendar_event_migrations
		WHERE id=$1 AND event_id=$2 AND mailbox_id=$3
		FOR UPDATE`, req.MigrationID, eventID, mailboxID).Scan(&migID, &status, &legacyPayload, &rolledBackAt)
	if err == pgx.ErrNoRows {
		http.Error(w, "migration record not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to query migration record", http.StatusInternalServerError)
		return
	}

	// Idempotent rollback:
	if status == "rolled_back" {
		rStr := ""
		if rolledBackAt != nil {
			rStr = rolledBackAt.Format(time.RFC3339)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(RollbackMigrationResp{
			MigrationID: migID,
			EventID:     eventID,
			Status:      "rolled_back",
			RestoredAt:  rStr,
		})
		return
	}

	if status == "finalized" {
		http.Error(w, "cannot roll back a finalized migration", http.StatusConflict)
		return
	}

	now := time.Now()
	if len(legacyPayload) > 0 {
		_, err = tx.Exec(ctx, `
			UPDATE calendar_events
			SET encrypted_payload = $1, updated_at = now()
			WHERE id = $2 AND mailbox_id = $3`, legacyPayload, eventID, mailboxID)
		if err != nil {
			http.Error(w, "failed to restore legacy payload", http.StatusInternalServerError)
			return
		}
	}

	_, err = tx.Exec(ctx, `
		UPDATE calendar_event_migrations
		SET status='rolled_back', legacy_payload=NULL, rolled_back_at=$1, rollback_reason=$2
		WHERE id=$3`, now, reason, migID)
	if err != nil {
		http.Error(w, "failed to mark migration rolled back", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit rollback", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(RollbackMigrationResp{
		MigrationID: migID,
		EventID:     eventID,
		Status:      "rolled_back",
		RestoredAt:  now.Format(time.RFC3339),
	})
}

func calendarEventMigrationStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, _, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	eventID := r.PathValue("event_id")
	if _, err := uuid.Parse(eventID); err != nil {
		http.Error(w, "event ID must be UUID", http.StatusBadRequest)
		return
	}

	// Verify event exists for this mailbox
	var eventExists bool
	_ = conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM calendar_events WHERE id=$1 AND mailbox_id=$2)`, eventID, mailboxID).Scan(&eventExists)
	if !eventExists {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}

	// Opportunistic recovery of expired staged migration
	opportunisticallyRecoverExpiredMigration(ctx, conn, mailboxID, eventID)

	var migID, status string
	var expiresAt time.Time
	err = conn.QueryRow(ctx, `
		SELECT id::text, status, expires_at
		FROM calendar_event_migrations
		WHERE event_id=$1 AND mailbox_id=$2
		ORDER BY created_at DESC
		LIMIT 1`, eventID, mailboxID).Scan(&migID, &status, &expiresAt)

	resp := MigrationStatusResp{
		EventID: eventID,
	}
	if err == nil {
		hasActive := status == "staged" && time.Now().Before(expiresAt)
		resp.HasActiveMigration = hasActive
		resp.MigrationID = &migID
		resp.Status = &status
		expStr := expiresAt.Format(time.RFC3339)
		resp.ExpiresAt = &expStr
	} else {
		resp.HasActiveMigration = false
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// calendarEventExceptionsHandler handles exceptions for recurring calendar events
func calendarEventExceptionsHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	_, _, mailboxID, ok := resolveCalendarMailboxOwner(w, r, conn, ctx)
	if !ok {
		return
	}

	eventID := r.PathValue("event_id")
	if _, err := uuid.Parse(eventID); err != nil {
		http.Error(w, "event ID must be UUID", http.StatusBadRequest)
		return
	}

	exceptionID := r.PathValue("exception_id")
	if exceptionID != "" {
		if _, err := uuid.Parse(exceptionID); err != nil {
			http.Error(w, "exception ID must be UUID", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodGet:
			var exc CalendarEventException
			var excStart, excEnd, excCreated, excUpdated time.Time
			var excPayload []byte
			err := conn.QueryRow(ctx, `
				SELECT id::text, parent_event_id::text, mailbox_id::text, calendar_id::text,
				       recurrence_id, is_cancelled, start_time, end_time, is_all_day,
				       status, encrypted_payload, created_at, updated_at
				FROM calendar_event_exceptions
				WHERE id=$1 AND parent_event_id=$2 AND (
					mailbox_id=$3 OR
					calendar_id IN (
						SELECT calendar_id FROM calendar_shares
						WHERE grantee_mailbox_id=$3 AND status='active'
					)
				)`, exceptionID, eventID, mailboxID).
				Scan(&exc.ID, &exc.ParentEventID, &exc.MailboxID, &exc.CalendarID,
					&exc.RecurrenceID, &exc.IsCancelled, &excStart, &excEnd, &exc.IsAllDay,
					&exc.Status, &excPayload, &excCreated, &excUpdated)
			if err == pgx.ErrNoRows {
				http.Error(w, "exception not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query exception", http.StatusInternalServerError)
				return
			}
			exc.StartTime = excStart.Format(time.RFC3339)
			exc.EndTime = excEnd.Format(time.RFC3339)
			exc.EncryptedPayload = base64.StdEncoding.EncodeToString(excPayload)
			exc.CreatedAt = excCreated.Format(time.RFC3339)
			exc.UpdatedAt = excUpdated.Format(time.RFC3339)

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(exc)

		case http.MethodPatch, http.MethodPut:
			var req UpdateEventExceptionReq
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}

			var parsedStart, parsedEnd *time.Time
			if req.StartTime != nil {
				t, err := time.Parse(time.RFC3339, *req.StartTime)
				if err != nil {
					http.Error(w, "invalid start_time format (RFC3339 required)", http.StatusBadRequest)
					return
				}
				parsedStart = &t
			}
			if req.EndTime != nil {
				t, err := time.Parse(time.RFC3339, *req.EndTime)
				if err != nil {
					http.Error(w, "invalid end_time format (RFC3339 required)", http.StatusBadRequest)
					return
				}
				parsedEnd = &t
			}

			var payloadBytes []byte
			if req.EncryptedPayload != nil {
				b, err := validateCalendarEventEnvelope(*req.EncryptedPayload)
				if err != nil {
					http.Error(w, fmt.Sprintf("invalid encrypted_payload: %v", err), http.StatusBadRequest)
					return
				}
				payloadBytes = b
			}

			tx, err := conn.Begin(ctx)
			if err != nil {
				http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
				return
			}
			defer tx.Rollback(ctx)

			// 1. Lock parent row (canonical lock order: Parent calendar_events first)
			var parentMailboxID, parentCalID string
			err = tx.QueryRow(ctx, `SELECT mailbox_id::text, calendar_id::text FROM calendar_events WHERE id=$1 FOR UPDATE`, eventID).Scan(&parentMailboxID, &parentCalID)
			if err == pgx.ErrNoRows {
				http.Error(w, "parent event not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query parent event", http.StatusInternalServerError)
				return
			}

			if parentMailboxID != mailboxID {
				var sharePerm string
				err = tx.QueryRow(ctx, `
					SELECT permission FROM calendar_shares
					WHERE calendar_id=$1 AND grantee_mailbox_id=$2 AND status='active'`,
					parentCalID, mailboxID).Scan(&sharePerm)
				if err == pgx.ErrNoRows {
					http.Error(w, "parent event not found", http.StatusNotFound)
					return
				}
				if err != nil {
					http.Error(w, "failed to query calendar share", http.StatusInternalServerError)
					return
				}
				if sharePerm != "write" {
					http.Error(w, `{"error":"read_only_calendar"}`, http.StatusForbidden)
					return
				}
			}

			// 2. Lock and update child row
			var exc CalendarEventException
			var excStart, excEnd, excCreated, excUpdated time.Time
			var excPayload []byte

			err = tx.QueryRow(ctx, `
				UPDATE calendar_event_exceptions
				SET is_cancelled = COALESCE($1, is_cancelled),
				    start_time = COALESCE($2, start_time),
				    end_time = COALESCE($3, end_time),
				    is_all_day = COALESCE($4, is_all_day),
				    status = COALESCE($5, status),
				    encrypted_payload = CASE WHEN $6::bytea IS NOT NULL THEN $6::bytea ELSE encrypted_payload END,
				    updated_at = now()
				WHERE id=$7 AND parent_event_id=$8 AND mailbox_id=$9
				RETURNING id::text, parent_event_id::text, mailbox_id::text, calendar_id::text,
				          recurrence_id, is_cancelled, start_time, end_time, is_all_day,
				          status, encrypted_payload, created_at, updated_at`,
				req.IsCancelled, parsedStart, parsedEnd, req.IsAllDay, req.Status, payloadBytes,
				exceptionID, eventID, parentMailboxID).Scan(
				&exc.ID, &exc.ParentEventID, &exc.MailboxID, &exc.CalendarID,
				&exc.RecurrenceID, &exc.IsCancelled, &excStart, &excEnd, &exc.IsAllDay,
				&exc.Status, &excPayload, &excCreated, &excUpdated)
			if err == pgx.ErrNoRows {
				http.Error(w, "exception not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, fmt.Sprintf("failed to update exception: %v", err), http.StatusBadRequest)
				return
			}

			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit exception update", http.StatusInternalServerError)
				return
			}

			exc.StartTime = excStart.Format(time.RFC3339)
			exc.EndTime = excEnd.Format(time.RFC3339)
			exc.EncryptedPayload = base64.StdEncoding.EncodeToString(excPayload)
			exc.CreatedAt = excCreated.Format(time.RFC3339)
			exc.UpdatedAt = excUpdated.Format(time.RFC3339)

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(exc)

		case http.MethodDelete:
			tx, err := conn.Begin(ctx)
			if err != nil {
				http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
				return
			}
			defer tx.Rollback(ctx)

			// 1. Lock parent row
			var parentMailboxID, parentCalID string
			err = tx.QueryRow(ctx, `SELECT mailbox_id::text, calendar_id::text FROM calendar_events WHERE id=$1 FOR UPDATE`, eventID).Scan(&parentMailboxID, &parentCalID)
			if err == pgx.ErrNoRows {
				http.Error(w, "parent event not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query parent event", http.StatusInternalServerError)
				return
			}

			if parentMailboxID != mailboxID {
				var sharePerm string
				err = tx.QueryRow(ctx, `
					SELECT permission FROM calendar_shares
					WHERE calendar_id=$1 AND grantee_mailbox_id=$2 AND status='active'`,
					parentCalID, mailboxID).Scan(&sharePerm)
				if err == pgx.ErrNoRows {
					http.Error(w, "parent event not found", http.StatusNotFound)
					return
				}
				if err != nil {
					http.Error(w, "failed to query calendar share", http.StatusInternalServerError)
					return
				}
				if sharePerm != "write" {
					http.Error(w, `{"error":"read_only_calendar"}`, http.StatusForbidden)
					return
				}
			}

			// 2. Delete child row
			tag, err := tx.Exec(ctx, `DELETE FROM calendar_event_exceptions WHERE id=$1 AND parent_event_id=$2 AND mailbox_id=$3`, exceptionID, eventID, parentMailboxID)
			if err != nil {
				http.Error(w, "failed to delete exception", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "exception not found", http.StatusNotFound)
				return
			}

			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit exception deletion", http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case http.MethodGet:
		// Verify parent event exists and is accessible
		var parentDummyID string
		err := conn.QueryRow(ctx, `
			SELECT id::text FROM calendar_events
			WHERE id=$1 AND (
				mailbox_id=$2 OR
				calendar_id IN (
					SELECT calendar_id FROM calendar_shares
					WHERE grantee_mailbox_id=$2 AND status='active'
				)
			)`, eventID, mailboxID).Scan(&parentDummyID)
		if err == pgx.ErrNoRows {
			http.Error(w, "parent event not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "failed to query parent event", http.StatusInternalServerError)
			return
		}

		rows, err := conn.Query(ctx, `
			SELECT id::text, parent_event_id::text, mailbox_id::text, calendar_id::text,
			       recurrence_id, is_cancelled, start_time, end_time, is_all_day,
			       status, encrypted_payload, created_at, updated_at
			FROM calendar_event_exceptions
			WHERE parent_event_id=$1
			ORDER BY start_time ASC`, eventID)
		if err != nil {
			http.Error(w, "failed to query exceptions", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		exceptions := make([]CalendarEventException, 0)
		for rows.Next() {
			var exc CalendarEventException
			var excStart, excEnd, excCreated, excUpdated time.Time
			var excPayload []byte
			if err := rows.Scan(&exc.ID, &exc.ParentEventID, &exc.MailboxID, &exc.CalendarID,
				&exc.RecurrenceID, &exc.IsCancelled, &excStart, &excEnd, &exc.IsAllDay,
				&exc.Status, &excPayload, &excCreated, &excUpdated); err != nil {
				http.Error(w, "failed to scan exception", http.StatusInternalServerError)
				return
			}
			exc.StartTime = excStart.Format(time.RFC3339)
			exc.EndTime = excEnd.Format(time.RFC3339)
			exc.EncryptedPayload = base64.StdEncoding.EncodeToString(excPayload)
			exc.CreatedAt = excCreated.Format(time.RFC3339)
			exc.UpdatedAt = excUpdated.Format(time.RFC3339)
			exceptions = append(exceptions, exc)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(exceptions)

	case http.MethodPost:
		var req CreateEventExceptionReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		req.RecurrenceID = strings.TrimSpace(req.RecurrenceID)
		if req.RecurrenceID == "" {
			http.Error(w, "recurrence_id is required", http.StatusBadRequest)
			return
		}

		startT, err := time.Parse(time.RFC3339, req.StartTime)
		if err != nil {
			http.Error(w, "invalid start_time format (RFC3339 required)", http.StatusBadRequest)
			return
		}

		endT, err := time.Parse(time.RFC3339, req.EndTime)
		if err != nil {
			http.Error(w, "invalid end_time format (RFC3339 required)", http.StatusBadRequest)
			return
		}

		if endT.Before(startT) {
			http.Error(w, "end_time cannot be before start_time", http.StatusBadRequest)
			return
		}

		if req.Status == "" {
			req.Status = "busy"
		}

		payloadBytes, err := validateCalendarEventEnvelope(req.EncryptedPayload)
		if err != nil {
			http.Error(w, fmt.Sprintf("invalid encrypted_payload: %v", err), http.StatusBadRequest)
			return
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)

		// 1. Lock parent row (canonical lock order: Parent calendar_events first)
		var parentCalendarID, parentMailboxID string
		err = tx.QueryRow(ctx, `SELECT calendar_id::text, mailbox_id::text FROM calendar_events WHERE id=$1 FOR UPDATE`, eventID).Scan(&parentCalendarID, &parentMailboxID)
		if err == pgx.ErrNoRows {
			http.Error(w, "parent event not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "failed to query parent event", http.StatusInternalServerError)
			return
		}

		if parentMailboxID != mailboxID {
			var sharePerm string
			err = tx.QueryRow(ctx, `
				SELECT permission FROM calendar_shares
				WHERE calendar_id=$1 AND grantee_mailbox_id=$2 AND status='active'`,
				parentCalendarID, mailboxID).Scan(&sharePerm)
			if err == pgx.ErrNoRows {
				http.Error(w, "parent event not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to query calendar share", http.StatusInternalServerError)
				return
			}
			if sharePerm != "write" {
				http.Error(w, `{"error":"read_only_calendar"}`, http.StatusForbidden)
				return
			}
		}

		// 2. Insert into calendar_event_exceptions (upsert or insert)
		var exc CalendarEventException
		var excStart, excEnd, excCreated, excUpdated time.Time
		var excPayload []byte

		err = tx.QueryRow(ctx, `
			INSERT INTO calendar_event_exceptions (
				parent_event_id, mailbox_id, calendar_id, recurrence_id,
				is_cancelled, start_time, end_time, is_all_day, status, encrypted_payload
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (parent_event_id, recurrence_id)
			DO UPDATE SET
				is_cancelled = EXCLUDED.is_cancelled,
				start_time = EXCLUDED.start_time,
				end_time = EXCLUDED.end_time,
				is_all_day = EXCLUDED.is_all_day,
				status = EXCLUDED.status,
				encrypted_payload = EXCLUDED.encrypted_payload,
				updated_at = now()
			RETURNING id::text, parent_event_id::text, mailbox_id::text, calendar_id::text,
			          recurrence_id, is_cancelled, start_time, end_time, is_all_day,
			          status, encrypted_payload, created_at, updated_at`,
			eventID, parentMailboxID, parentCalendarID, req.RecurrenceID,
			req.IsCancelled, startT, endT, req.IsAllDay, req.Status, payloadBytes).
			Scan(&exc.ID, &exc.ParentEventID, &exc.MailboxID, &exc.CalendarID,
				&exc.RecurrenceID, &exc.IsCancelled, &excStart, &excEnd, &exc.IsAllDay,
				&exc.Status, &excPayload, &excCreated, &excUpdated)
		if err != nil {
			http.Error(w, fmt.Sprintf("failed to insert exception: %v", err), http.StatusInternalServerError)
			return
		}

		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "failed to commit exception creation", http.StatusInternalServerError)
			return
		}

		exc.StartTime = excStart.Format(time.RFC3339)
		exc.EndTime = excEnd.Format(time.RFC3339)
		exc.EncryptedPayload = base64.StdEncoding.EncodeToString(excPayload)
		exc.CreatedAt = excCreated.Format(time.RFC3339)
		exc.UpdatedAt = excUpdated.Format(time.RFC3339)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(exc)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
