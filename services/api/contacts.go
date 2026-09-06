package main

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

func contactResponse(id, mailboxID string, envelope []byte, version int, createdAt, updatedAt time.Time) map[string]interface{} {
	return map[string]interface{}{
		"id":                 id,
		"mailbox_id":         mailboxID,
		"encrypted_envelope": base64.StdEncoding.EncodeToString(envelope),
		"version":            version,
		"created_at":         createdAt.Format(time.RFC3339),
		"updated_at":         updatedAt.Format(time.RFC3339),
	}
}

func contactsHandler(w http.ResponseWriter, r *http.Request) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
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

	contactID := r.PathValue("contact_id")
	if contactID != "" {
		if _, err := uuid.Parse(contactID); err != nil {
			http.Error(w, "contact ID must be UUID", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodGet:
			var id string
			var envelope []byte
			var version int
			var createdAt, updatedAt time.Time
			err := conn.QueryRow(ctx, `
				SELECT id::text, encrypted_envelope, version, created_at, updated_at
				FROM contacts WHERE id=$1 AND mailbox_id=$2`, contactID, mailboxID).
				Scan(&id, &envelope, &version, &createdAt, &updatedAt)
			if err == pgx.ErrNoRows {
				http.Error(w, "contact not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to get contact", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(contactResponse(id, mailboxID, envelope, version, createdAt, updatedAt))
		case http.MethodPut:
			contactUpdateHandler(w, r, conn, ctx, mailboxID, contactID)
		case http.MethodDelete:
			tag, err := conn.Exec(ctx, `DELETE FROM contacts WHERE id=$1 AND mailbox_id=$2`, contactID, mailboxID)
			if err != nil {
				http.Error(w, "failed to delete contact", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "contact not found", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case http.MethodPost:
		contactCreateHandler(w, r, conn, ctx, mailboxID)
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT id::text, encrypted_envelope, version, created_at, updated_at
			FROM contacts WHERE mailbox_id=$1 ORDER BY updated_at DESC, id ASC`, mailboxID)
		if err != nil {
			http.Error(w, "failed to list contacts", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		contacts := []map[string]interface{}{}
		for rows.Next() {
			var id string
			var envelope []byte
			var version int
			var createdAt, updatedAt time.Time
			if err := rows.Scan(&id, &envelope, &version, &createdAt, &updatedAt); err != nil {
				http.Error(w, "failed to read contacts", http.StatusInternalServerError)
				return
			}
			contacts = append(contacts, contactResponse(id, mailboxID, envelope, version, createdAt, updatedAt))
		}
		if err := rows.Err(); err != nil {
			http.Error(w, "failed to list contacts", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"contacts": contacts})
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func decodeContactEnvelope(w http.ResponseWriter, r *http.Request) ([]byte, int, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		EncryptedEnvelope string `json:"encrypted_envelope"`
		Version           int    `json:"version"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return nil, 0, false
	}
	envelope, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.EncryptedEnvelope))
	if err != nil || len(envelope) < 29 || envelope[0] != 0x01 {
		http.Error(w, "invalid encrypted_envelope", http.StatusBadRequest)
		return nil, 0, false
	}
	return envelope, req.Version, true
}

func contactCreateHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, mailboxID string) {
	envelope, _, ok := decodeContactEnvelope(w, r)
	if !ok {
		return
	}
	var id string
	var version int
	var createdAt, updatedAt time.Time
	err := conn.QueryRow(ctx, `
		INSERT INTO contacts (mailbox_id, encrypted_envelope)
		VALUES ($1,$2)
		RETURNING id::text, version, created_at, updated_at`, mailboxID, envelope).
		Scan(&id, &version, &createdAt, &updatedAt)
	if err != nil {
		http.Error(w, "failed to create contact", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(contactResponse(id, mailboxID, envelope, version, createdAt, updatedAt))
}

func contactUpdateHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, mailboxID, contactID string) {
	envelope, expectedVersion, ok := decodeContactEnvelope(w, r)
	if !ok {
		return
	}
	if expectedVersion < 1 {
		http.Error(w, "version must be at least 1", http.StatusBadRequest)
		return
	}
	var id string
	var nextVersion int
	var createdAt, updatedAt time.Time
	err := conn.QueryRow(ctx, `
		UPDATE contacts SET encrypted_envelope=$1, version=version+1, updated_at=now()
		WHERE id=$2 AND mailbox_id=$3 AND version=$4
		RETURNING id::text, version, created_at, updated_at`,
		envelope, contactID, mailboxID, expectedVersion).
		Scan(&id, &nextVersion, &createdAt, &updatedAt)
	if err == pgx.ErrNoRows {
		var currentVersion int
		versionErr := conn.QueryRow(ctx, `SELECT version FROM contacts WHERE id=$1 AND mailbox_id=$2`, contactID, mailboxID).Scan(&currentVersion)
		if versionErr == pgx.ErrNoRows {
			http.Error(w, "contact not found", http.StatusNotFound)
			return
		}
		if versionErr != nil {
			http.Error(w, "failed to check contact version", http.StatusInternalServerError)
			return
		}
		http.Error(w, "contact version conflict", http.StatusConflict)
		return
	}
	if err != nil {
		http.Error(w, "failed to update contact", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(contactResponse(id, mailboxID, envelope, nextVersion, createdAt, updatedAt))
}
