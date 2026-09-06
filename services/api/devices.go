package main

// Evidence:
// - Route table: POST /v1/auth/device-enroll, POST /v1/auth/device-revoke.
// - api.exe symbols: deviceEnrollHandler, deviceRevokeHandler.
// - infra/postgres/init/001_init.sql: devices(id,user_id,device_name,
//   device_pk,created_at); device_mailbox_access(id,device_id,mailbox_id,
//   wrapped_root_secret NOT NULL,is_active,granted_at,revoked_at,
//   UNIQUE(device_id,mailbox_id)).
// - docs/08-v5.3-final.md Section 16: client HPKE-seals root_secret to
//   device_pk and uploads wrapped_root_secret; server stores wrapped only.
// Reconstruction judgments flagged inline. Server never receives unwrapped
// customer keys; only wrapped_root_secret (already HPKE-sealed client-side)
// is persisted.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func deviceEnrollHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid authentication", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		DeviceName        string `json:"device_name"`
		DevicePk          string `json:"device_pk"`
		MailboxID         string `json:"mailbox_id,omitempty"`
		WrappedRootSecret string `json:"wrapped_root_secret,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.DeviceName) == "" {
		http.Error(w, "device_name required", http.StatusBadRequest)
		return
	}
	pkBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.DevicePk))
	if err != nil || len(pkBytes) != 32 {
		http.Error(w, "device_pk must be base64 32 bytes", http.StatusBadRequest)
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
	var active bool
	err = conn.QueryRow(ctx, `SELECT is_active FROM users WHERE id=$1`, userID).Scan(&active)
	if err != nil || !active {
		http.Error(w, "not authorized", http.StatusForbidden)
		return
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	deviceID := uuid.New().String()
	_, err = tx.Exec(ctx, `INSERT INTO devices (id, user_id, device_name, device_pk) VALUES ($1, $2, $3, $4)`, deviceID, userID, strings.TrimSpace(req.DeviceName), pkBytes)
	if err != nil {
		http.Error(w, "failed to enroll device", http.StatusInternalServerError)
		return
	}
	// Optional mailbox grant: wrapped_root_secret arrives already HPKE-sealed
	// client-side; the server only stores it.
	if strings.TrimSpace(req.MailboxID) != "" {
		if _, err := uuid.Parse(strings.TrimSpace(req.MailboxID)); err != nil {
			http.Error(w, "mailbox_id must be UUID", http.StatusBadRequest)
			return
		}
		wrapped, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.WrappedRootSecret))
		if err != nil || len(wrapped) == 0 {
			http.Error(w, "wrapped_root_secret required with mailbox_id", http.StatusBadRequest)
			return
		}
		var userOrgID, mailboxOrgID string
		_ = tx.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&userOrgID)
		err = tx.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, strings.TrimSpace(req.MailboxID)).Scan(&mailboxOrgID)
		if err != nil {
			http.Error(w, "mailbox not found", http.StatusNotFound)
			return
		}
		if mailboxOrgID != userOrgID {
			http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
			return
		}
		_, err = tx.Exec(ctx, `INSERT INTO device_mailbox_access (device_id, mailbox_id, wrapped_root_secret) VALUES ($1, $2, $3)`, deviceID, strings.TrimSpace(req.MailboxID), wrapped)
		if err != nil {
			if isUniqueViolation(err) {
				http.Error(w, "device already granted for this mailbox", http.StatusConflict)
				return
			}
			http.Error(w, "failed to grant mailbox access", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	var orgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&orgID)
	auditLog(ctx, conn, orgID, userID, "device_enroll", "device", deviceID, map[string]interface{}{"device_name": strings.TrimSpace(req.DeviceName)})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": deviceID, "device_name": strings.TrimSpace(req.DeviceName)})
}

func deviceRevokeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid authentication", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		DeviceID string `json:"device_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(strings.TrimSpace(req.DeviceID)); err != nil {
		http.Error(w, "device_id must be UUID", http.StatusBadRequest)
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
	// Verify ownership before revoking.
	var owner string
	err = conn.QueryRow(ctx, `SELECT user_id::text FROM devices WHERE id=$1`, strings.TrimSpace(req.DeviceID)).Scan(&owner)
	if err != nil {
		http.Error(w, "device not found", http.StatusNotFound)
		return
	}
	if owner != userID {
		http.Error(w, "not authorized for this device", http.StatusForbidden)
		return
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `UPDATE device_mailbox_access SET is_active=false, revoked_at=now() WHERE device_id=$1`, strings.TrimSpace(req.DeviceID))
	if err != nil {
		http.Error(w, "failed to revoke mailbox access", http.StatusInternalServerError)
		return
	}
	// devices carries no active flag, so revocation removes the row.
	_, err = tx.Exec(ctx, `DELETE FROM devices WHERE id=$1`, strings.TrimSpace(req.DeviceID))
	if err != nil {
		http.Error(w, "failed to revoke device", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	var orgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&orgID)
	auditLog(ctx, conn, orgID, userID, "device_revoke", "device", strings.TrimSpace(req.DeviceID), nil)
	w.WriteHeader(http.StatusNoContent)
}
