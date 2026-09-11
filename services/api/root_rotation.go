package main

// Section 15 recovery-root rotation.
//
// Semantics (deliberately narrow): ROOT-ONLY rotation. The mailbox key
// (mailbox_sk/mailbox_pk, mailbox_sk_version) is untouched, so all existing
// message content keys — wrapped to the unchanged mailbox public key — keep
// decrypting. What changes is the root anchor: a new root_secrets row
// (version = old + 1), the mailbox pointer moves, the old row is marked
// revoked, and device grants sealed under the old root are revoked (an old
// root that can still unwrap via a grant is not rotated).
//
// Trust notes:
// - The server validates SHAPE only (81-byte HPKE wrap for org_managed,
//   absent for private — same rules as provisioning). It cannot verify the
//   client re-wrapped the SAME mailbox key; validity comes from the client
//   proving possession of the old root (unwrap must succeed before it can
//   build the request) plus audit. A bare session without the old root
//   cannot construct a working rotation, only a bricking one — which is why
//   rotation requires admin role or mailbox ownership (same blast radius as
//   the destructive ops those roles already hold).
// - After rotation the recovery verifier (derived from the old root) no
//   longer matches: the client MUST re-enroll (recovery_reenroll path).
// - Org-managed rotation shows NO mnemonic to anyone (frozen §9): the admin
//   client seals the new root to the org recovery key without a phrase.

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func rootRotationHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	mailboxID := r.PathValue("mailbox_id")
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
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
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		RootSecretWrapped string `json:"root_secret_wrapped"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
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

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Lock the mailbox row: concurrent rotations serialize here instead of
	// forking the version lineage. user_id is nullable (org mailboxes may be
	// unowned), so COALESCE keeps admin rotation working for those rows.
	var mode, ownerUserID, currentRootID string
	var isActive bool
	err = tx.QueryRow(ctx, `SELECT mode, COALESCE(user_id::text,''), root_secret_id::text, is_active FROM mailboxes WHERE id=$1 AND org_id=$2 FOR UPDATE`,
		mailboxID, orgID).Scan(&mode, &ownerUserID, &currentRootID, &isActive)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if !isActive {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}

	// Admins rotate any org mailbox; otherwise only the owning user may
	// rotate (covers member-owned private mailboxes).
	if !isAdmin(userID, orgID, conn) && ownerUserID != userID {
		http.Error(w, "not authorized to rotate this mailbox", http.StatusForbidden)
		return
	}

	// Mode-specific wrap rules mirror provisioning exactly.
	var newWrapped []byte
	if mode == "org_managed" {
		if strings.TrimSpace(req.RootSecretWrapped) == "" {
			http.Error(w, "root_secret_wrapped required for org_managed mailbox", http.StatusBadRequest)
			return
		}
		newWrapped, err = hexDecodeString(strings.TrimSpace(req.RootSecretWrapped))
		if err != nil || len(newWrapped) != 81 {
			http.Error(w, "invalid root_secret_wrapped", http.StatusBadRequest)
			return
		}
	} else if mode == "private" {
		if strings.TrimSpace(req.RootSecretWrapped) != "" {
			http.Error(w, "root_secret_wrapped must be omitted for private mailbox", http.StatusBadRequest)
			return
		}
		newWrapped = nil
	} else {
		http.Error(w, "unknown mailbox mode", http.StatusInternalServerError)
		return
	}

	var currentVersion int
	err = tx.QueryRow(ctx, `SELECT version FROM root_secrets WHERE id=$1 FOR UPDATE`, currentRootID).Scan(&currentVersion)
	if err != nil {
		http.Error(w, "current root material missing", http.StatusInternalServerError)
		return
	}

	var newRootID string
	newVersion := currentVersion + 1
	err = tx.QueryRow(ctx, `INSERT INTO root_secrets (root_secret_wrapped, version) VALUES ($1, $2) RETURNING id::text`,
		newWrapped, newVersion).Scan(&newRootID)
	if err != nil {
		http.Error(w, "failed to store new root", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE mailboxes SET root_secret_id=$1, updated_at=now() WHERE id=$2`, newRootID, mailboxID); err != nil {
		http.Error(w, "failed to switch root pointer", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE root_secrets SET revoked_at=now() WHERE id=$1`, currentRootID); err != nil {
		http.Error(w, "failed to revoke old root", http.StatusInternalServerError)
		return
	}
	// Device grants sealed under the old root die with it; affected devices
	// must re-enroll against the new root.
	if _, err := tx.Exec(ctx, `UPDATE device_mailbox_access SET is_active=false, revoked_at=now() WHERE mailbox_id=$1 AND is_active=true`, mailboxID); err != nil {
		http.Error(w, "failed to revoke device grants", http.StatusInternalServerError)
		return
	}
	// A rotation is a compromise response: kill the mailbox owner's other
	// sessions so a stolen session does not survive the operation. The
	// request's own session stays alive; an admin rotating someone else's
	// mailbox keeps theirs while the owner's sessions die.
	var sessionsRevoked int64
	if ownerUserID != "" {
		var currentHash []byte
		if cookie, cerr := r.Cookie("byos_session"); cerr == nil {
			currentHash = hashToken(cookie.Value)
		}
		var tag pgconn.CommandTag
		if currentHash == nil {
			tag, err = tx.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`, ownerUserID)
		} else {
			tag, err = tx.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash != $2 AND revoked_at IS NULL`, ownerUserID, currentHash)
		}
		if err != nil {
			http.Error(w, "failed to rotate sessions", http.StatusInternalServerError)
			return
		}
		sessionsRevoked = tag.RowsAffected()
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "root_rotation", "mailbox", mailboxID,
		map[string]interface{}{"version": newVersion, "sessions_revoked": sessionsRevoked})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"mailbox_id":     mailboxID,
		"root_secret_id": newRootID,
		"version":        newVersion,
	})
}
