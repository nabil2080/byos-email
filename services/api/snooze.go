package main

import (
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

// POST /v1/mailboxes/{mailbox_id}/messages/{message_id}/snooze
// Body: { "snoozed_until": "RFC3339 timestamp" or null }
// null clears the snooze.
func messageSnoozeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		writeInternalSendError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !allowPerUser(userID) {
		writeInternalSendError(w, http.StatusTooManyRequests, "rate_limited")
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	messageID := r.PathValue("message_id")

	var req struct {
		SnoozedUntil *string `json:"snoozed_until"` // null to clear
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeInternalSendError(w, http.StatusBadRequest, "invalid_request")
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "database_connection_failed")
		return
	}
	defer conn.Close(ctx)

	if status, errMsg, authOk := verifyMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		writeInternalSendError(w, status, errMsg)
		return
	}

	// Verify ownership
	var owns bool
	err = conn.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM mailboxes m
			JOIN users u ON u.org_id = m.org_id
			WHERE m.id = $1 AND u.id = $2 AND m.is_active = true
			  AND (m.user_id = u.id OR u.role IN ('admin', 'owner'))
		)
	`, mailboxID, userID).Scan(&owns)
	if err != nil || !owns {
		writeInternalSendError(w, http.StatusForbidden, "not_mailbox_owner")
		return
	}

	// Parse or clear the snooze
	var snoozedUntil interface{}
	if req.SnoozedUntil == nil || *req.SnoozedUntil == "" {
		snoozedUntil = nil
	} else {
		t, err := time.Parse(time.RFC3339Nano, *req.SnoozedUntil)
		if err != nil {
			t, err = time.Parse(time.RFC3339, *req.SnoozedUntil)
			if err != nil {
				writeInternalSendError(w, http.StatusBadRequest, "invalid_timestamp")
				return
			}
		}
		if t.Before(time.Now()) {
			writeInternalSendError(w, http.StatusBadRequest, "snooze_time_in_past")
			return
		}
		snoozedUntil = t.UTC()
	}

	cmdTag, err := conn.Exec(ctx, `
		UPDATE message_metadata
		SET snoozed_until = $1, is_read = false
		WHERE id = $2 AND mailbox_id = $3
	`, snoozedUntil, messageID, mailboxID)
	if err != nil {
		writeInternalSendError(w, http.StatusInternalServerError, "update_failed")
		return
	}
	if cmdTag.RowsAffected() == 0 {
		writeInternalSendError(w, http.StatusNotFound, "message_not_found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"snoozed_until": req.SnoozedUntil,
	})
}
