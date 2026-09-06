package main

// Step 8 Drafts: create / list / get-one / update / delete (backend).
//
// Evidence:
// - BYOS_V1_Prototype_Roadmap.md Section 17 (Drafts: encrypted storage,
//   autosave, multi-device sync; attachment handling and Contacts/Search/etc
//   are separate scope, NOT implemented here).
// - 07-v5.1-reconciliation.md: draft composition is Category 1 client-only
//   (server never sees plaintext); subject display and recipient routing are
//   Category 3 server-readable metadata (same convention as outbound_queue /
//   scheduled_messages recipient columns).
// - infra/postgres/init/001_init.sql table 17 + 011_drafts_metadata.sql:
//   drafts(id, mailbox_id, subject, recipient, encrypted_envelope,
//   version, created_at, updated_at).
// - Route/contract conventions follow mailboxAliasesHandler (collection +
//   item patterns, {drafts:[]} envelope, 201/200/400/401/403/404/405).
// - Crypto: Section 12 canonical AES-GCM envelope, client-encrypted. The
//   server validates envelope structure only (same doctrine as outbound
//   send) and never decrypts.
// The API stores encrypted envelopes opaquely; the frontend remains a separate
// roadmap slice.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// draftResponse is the JSON shape for single-draft responses and list items.
func draftResponse(id, mailboxID, subject, recipient string, envelope []byte, version int, createdAt, updatedAt time.Time) map[string]interface{} {
	return map[string]interface{}{
		"id":                 id,
		"mailbox_id":         mailboxID,
		"subject":            subject,
		"recipient":          recipient,
		"encrypted_envelope": base64.StdEncoding.EncodeToString(envelope),
		"version":            version,
		"created_at":         createdAt.Format(time.RFC3339),
		"updated_at":         updatedAt.Format(time.RFC3339),
	}
}

// resolveDraftMailbox authenticates the actor and resolves the mailbox with
// organization isolation. Returns mailbox org ID.
func resolveDraftMailbox(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context) (userID, userOrgID, mailboxOrgID, mailboxID string, ok bool) {
	mailboxID = r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox ID required", http.StatusBadRequest)
		return "", "", "", "", false
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "mailbox ID must be UUID", http.StatusBadRequest)
		return "", "", "", "", false
	}
	userID, ok = getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return "", "", "", "", false
	}
	err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return "", "", "", "", false
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return "", "", "", "", false
	}
	if mailboxOrgID != userOrgID {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return "", "", "", "", false
	}
	return userID, userOrgID, mailboxOrgID, mailboxID, true
}

func draftsHandler(w http.ResponseWriter, r *http.Request) {
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

	userID, _, _, mailboxID, ok := resolveDraftMailbox(w, r, conn, ctx)
	if !ok {
		return
	}
	_ = userID

	if draftID := r.PathValue("draft_id"); draftID != "" {
		if _, err := uuid.Parse(draftID); err != nil {
			http.Error(w, "draft ID must be UUID", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodPut:
			draftUpdateHandler(w, r, conn, ctx, mailboxID, userID, draftID)
			return
		case http.MethodDelete:
			draftDeleteHandler(w, r, conn, ctx, mailboxID, userID, draftID)
			return
		case http.MethodGet:
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var id, subject, recipient string
		var envelope []byte
		var version int
		var createdAt, updatedAt time.Time
		err := conn.QueryRow(ctx, `SELECT id::text, COALESCE(subject,''), COALESCE(recipient,''), encrypted_envelope, version, created_at, updated_at FROM drafts WHERE id=$1 AND mailbox_id=$2`, draftID, mailboxID).Scan(&id, &subject, &recipient, &envelope, &version, &createdAt, &updatedAt)
		if err != nil {
			// Covers nonexistent IDs and IDs belonging to another mailbox
			// (no existence leak across mailboxes).
			http.Error(w, "draft not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(draftResponse(id, mailboxID, subject, recipient, envelope, version, createdAt, updatedAt))
		return
	}

	switch r.Method {
	case http.MethodPost:
		draftCreateHandler(w, r, conn, ctx, mailboxID, userID)
	case http.MethodGet:
		rows, err := conn.Query(ctx, `SELECT id::text, COALESCE(subject,''), COALESCE(recipient,''), encrypted_envelope, version, created_at, updated_at FROM drafts WHERE mailbox_id=$1 ORDER BY updated_at DESC, id ASC`, mailboxID)
		if err != nil {
			http.Error(w, "failed to list drafts", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		drafts := []map[string]interface{}{}
		for rows.Next() {
			var id, subject, recipient string
			var envelope []byte
			var version int
			var createdAt, updatedAt time.Time
			if err := rows.Scan(&id, &subject, &recipient, &envelope, &version, &createdAt, &updatedAt); err != nil {
				continue
			}
			drafts = append(drafts, draftResponse(id, mailboxID, subject, recipient, envelope, version, createdAt, updatedAt))
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"drafts": drafts})
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func draftUpdateHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, mailboxID, userID, draftID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Subject           string `json:"subject"`
		Recipient         string `json:"recipient"`
		EncryptedEnvelope string `json:"encrypted_envelope"`
		Version           int    `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	subject := strings.TrimSpace(req.Subject)
	if len(subject) > 998 {
		http.Error(w, "subject too long", http.StatusBadRequest)
		return
	}
	recipient := strings.TrimSpace(req.Recipient)
	if recipient != "" && (!strings.Contains(recipient, "@") || len(recipient) > 254) {
		http.Error(w, "invalid recipient", http.StatusBadRequest)
		return
	}
	if req.Version < 1 {
		http.Error(w, "version must be at least 1", http.StatusBadRequest)
		return
	}
	envelope, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.EncryptedEnvelope))
	if err != nil || len(envelope) < 29 || envelope[0] != 0x01 {
		http.Error(w, "invalid encrypted_envelope", http.StatusBadRequest)
		return
	}
	var id string
	var version int
	var createdAt, updatedAt time.Time
	err = conn.QueryRow(ctx, `
		UPDATE drafts
		SET subject=$1, recipient=$2, encrypted_envelope=$3,
		    version=version+1, updated_at=now()
		WHERE id=$4 AND mailbox_id=$5 AND version=$6
		RETURNING id::text, version, created_at, updated_at
	`, subject, recipient, envelope, draftID, mailboxID, req.Version).Scan(&id, &version, &createdAt, &updatedAt)
	if err == pgx.ErrNoRows {
		var currentVersion int
		err = conn.QueryRow(ctx, `SELECT version FROM drafts WHERE id=$1 AND mailbox_id=$2`, draftID, mailboxID).Scan(&currentVersion)
		if err == pgx.ErrNoRows {
			http.Error(w, "draft not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "failed to check draft version", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "draft_version_conflict", "current_version": currentVersion})
		return
	}
	if err != nil {
		http.Error(w, "failed to update draft", http.StatusInternalServerError)
		return
	}
	var orgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&orgID)
	auditLog(ctx, conn, orgID, userID, "draft_update", "draft", draftID, map[string]interface{}{"mailbox_id": mailboxID, "version": version})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(draftResponse(id, mailboxID, subject, recipient, envelope, version, createdAt, updatedAt))
}

func draftDeleteHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, mailboxID, userID, draftID string) {
	var deletedID string
	err := conn.QueryRow(ctx, `DELETE FROM drafts WHERE id=$1 AND mailbox_id=$2 RETURNING id::text`, draftID, mailboxID).Scan(&deletedID)
	if err == pgx.ErrNoRows {
		http.Error(w, "draft not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to delete draft", http.StatusInternalServerError)
		return
	}
	var orgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&orgID)
	auditLog(ctx, conn, orgID, userID, "draft_delete", "draft", deletedID, map[string]interface{}{"mailbox_id": mailboxID})
	w.WriteHeader(http.StatusNoContent)
}

func draftCreateHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, mailboxID, userID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Subject           string `json:"subject"`
		Recipient         string `json:"recipient"`
		EncryptedEnvelope string `json:"encrypted_envelope"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	subject := strings.TrimSpace(req.Subject)
	if len(subject) > 998 {
		http.Error(w, "subject too long", http.StatusBadRequest)
		return
	}
	recipient := strings.TrimSpace(req.Recipient)
	if recipient != "" && (!strings.Contains(recipient, "@") || len(recipient) > 254) {
		http.Error(w, "invalid recipient", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.EncryptedEnvelope) == "" {
		http.Error(w, "encrypted_envelope required", http.StatusBadRequest)
		return
	}
	envelope, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.EncryptedEnvelope))
	if err != nil {
		http.Error(w, "encrypted_envelope must be base64", http.StatusBadRequest)
		return
	}
	// Structural validation only: canonical AES-GCM envelope
	// (0x01 || nonce12 || ciphertext+tag). The server never decrypts.
	if len(envelope) < 29 || envelope[0] != 0x01 {
		http.Error(w, "invalid encrypted_envelope", http.StatusBadRequest)
		return
	}
	var orgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&orgID)
	draftID := uuid.New().String()
	var createdAt, updatedAt time.Time
	err = conn.QueryRow(ctx, `INSERT INTO drafts (id, mailbox_id, subject, recipient, encrypted_envelope, version) VALUES ($1, $2, $3, $4, $5, 1) RETURNING created_at, updated_at`, draftID, mailboxID, subject, recipient, envelope).Scan(&createdAt, &updatedAt)
	if err != nil {
		http.Error(w, "failed to save draft", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "draft_create", "draft", draftID, map[string]interface{}{"mailbox_id": mailboxID})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(draftResponse(draftID, mailboxID, subject, recipient, envelope, 1, createdAt, updatedAt))
}
