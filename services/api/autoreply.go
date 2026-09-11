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

type AutoReplyRule struct {
	ID              string     `json:"id,omitempty"`
	MailboxID       string     `json:"mailbox_id"`
	IsActive        bool       `json:"is_active"`
	SubjectTemplate string     `json:"subject_template"`
	BodyTemplate    string     `json:"body_template"`
	ReplyAll        bool       `json:"reply_all"`
	AllowedSenders  []string   `json:"allowed_senders"`
	BlockedSenders  []string   `json:"blocked_senders"`
	StartTime       *time.Time `json:"start_time,omitempty"`
	EndTime         *time.Time `json:"end_time,omitempty"`
	CreatedAt       *time.Time `json:"created_at,omitempty"`
	UpdatedAt       *time.Time `json:"updated_at,omitempty"`
}

func autoReplyHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "mailbox ID must be UUID", http.StatusBadRequest)
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
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Authorize org membership
	var userOrgID, mailboxOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		var rule AutoReplyRule
		var allowed, blocked []string
		var startTime, endTime, createdAt, updatedAt *time.Time
		err := conn.QueryRow(ctx, `
			SELECT id::text, mailbox_id::text, is_active, subject_template, body_template, reply_all, 
			       COALESCE(allowed_senders, '{}'), COALESCE(blocked_senders, '{}'), start_time, end_time, created_at, updated_at
			FROM auto_reply_rules WHERE mailbox_id=$1`, mailboxID).
			Scan(&rule.ID, &rule.MailboxID, &rule.IsActive, &rule.SubjectTemplate, &rule.BodyTemplate, &rule.ReplyAll,
				&allowed, &blocked, &startTime, &endTime, &createdAt, &updatedAt)
		if err == pgx.ErrNoRows {
			// No rule configured yet - return default inactive
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(AutoReplyRule{
				MailboxID:      mailboxID,
				IsActive:       false,
				AllowedSenders: []string{},
				BlockedSenders: []string{},
			})
			return
		}
		if err != nil {
			http.Error(w, "failed to get auto-reply rule", http.StatusInternalServerError)
			return
		}

		rule.AllowedSenders = allowed
		rule.BlockedSenders = blocked
		rule.StartTime = startTime
		rule.EndTime = endTime
		rule.CreatedAt = createdAt
		rule.UpdatedAt = updatedAt

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rule)

	case http.MethodPut, http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req AutoReplyRule
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		// Validation
		if strings.ContainsAny(req.SubjectTemplate, "\r\n\x00") {
			http.Error(w, "subject_template contains invalid control characters", http.StatusBadRequest)
			return
		}
		if len(req.BodyTemplate) > 10000 {
			http.Error(w, "body_template exceeds 10 KB limit", http.StatusBadRequest)
			return
		}

		if req.AllowedSenders == nil {
			req.AllowedSenders = []string{}
		}
		if req.BlockedSenders == nil {
			req.BlockedSenders = []string{}
		}

		// Upsert auto_reply_rules row
		var ruleID string
		var updatedAt time.Time
		err := conn.QueryRow(ctx, `
			INSERT INTO auto_reply_rules (
				mailbox_id, is_active, subject_template, body_template, reply_all, 
				allowed_senders, blocked_senders, start_time, end_time, updated_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
			ON CONFLICT (mailbox_id) DO UPDATE SET
				is_active = EXCLUDED.is_active,
				subject_template = EXCLUDED.subject_template,
				body_template = EXCLUDED.body_template,
				reply_all = EXCLUDED.reply_all,
				allowed_senders = EXCLUDED.allowed_senders,
				blocked_senders = EXCLUDED.blocked_senders,
				start_time = EXCLUDED.start_time,
				end_time = EXCLUDED.end_time,
				updated_at = now()
			RETURNING id::text, updated_at`,
			mailboxID, req.IsActive, req.SubjectTemplate, req.BodyTemplate, req.ReplyAll,
			req.AllowedSenders, req.BlockedSenders, req.StartTime, req.EndTime).Scan(&ruleID, &updatedAt)
		if err != nil {
			http.Error(w, "failed to save auto-reply rule", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, mailboxOrgID, userID, "auto_reply_update", "auto_reply_rules", ruleID, map[string]interface{}{
			"is_active": req.IsActive,
		})

		req.ID = ruleID
		req.MailboxID = mailboxID
		req.UpdatedAt = &updatedAt

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(req)

	case http.MethodDelete:
		_, err := conn.Exec(ctx, `UPDATE auto_reply_rules SET is_active=false, updated_at=now() WHERE mailbox_id=$1`, mailboxID)
		if err != nil {
			http.Error(w, "failed to disable auto-reply rule", http.StatusInternalServerError)
			return
		}
		auditLog(ctx, conn, mailboxOrgID, userID, "auto_reply_disable", "auto_reply_rules", "", map[string]interface{}{
			"mailbox_id": mailboxID,
		})
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
