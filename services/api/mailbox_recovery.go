package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// mailboxRecoveryMaterialHandler returns only the org-sealed root secret.
// The org recovery private key never reaches the API.
func mailboxRecoveryMaterialHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
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
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	if !isAdmin(userID, orgID, conn) {
		http.Error(w, "administrator role required", http.StatusForbidden)
		return
	}

	var mode string
	var wrapped []byte
	err = conn.QueryRow(ctx, `
		SELECT m.mode, rs.root_secret_wrapped
		FROM mailboxes m
		LEFT JOIN root_secrets rs ON rs.id = m.root_secret_id
		WHERE m.id=$1 AND m.org_id=$2 AND m.is_active=true
	`, mailboxID, orgID).Scan(&mode, &wrapped)
	if err == pgx.ErrNoRows {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to load recovery material", http.StatusInternalServerError)
		return
	}
	if mode != "org_managed" || len(wrapped) == 0 {
		http.Error(w, "private mailbox recovery is unavailable", http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"mailbox_id":          mailboxID,
		"root_secret_wrapped": base64.StdEncoding.EncodeToString(wrapped),
	})
}
