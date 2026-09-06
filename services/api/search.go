package main

import (
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type IndexSearchTokenRequest struct {
	MessageID string `json:"message_id"`
	Token     string `json:"token"` // hex-encoded 32-byte token
}

type SearchResponse struct {
	MessageIDs []string `json:"message_ids"`
}

func searchTokensHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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

	// Authorize: check user org matches mailbox org
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
		tokenHex := strings.TrimSpace(r.URL.Query().Get("token"))
		if tokenHex == "" {
			http.Error(w, "token query parameter required", http.StatusBadRequest)
			return
		}
		tokenBytes, err := hex.DecodeString(tokenHex)
		if err != nil || len(tokenBytes) == 0 {
			http.Error(w, "invalid token hex", http.StatusBadRequest)
			return
		}

		rows, err := conn.Query(ctx, `SELECT message_id FROM search_tokens WHERE mailbox_id=$1 AND token=$2`, mailboxID, tokenBytes)
		if err != nil {
			http.Error(w, "failed to query search tokens", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		msgIDs := make([]string, 0)
		for rows.Next() {
			var msgID string
			if err := rows.Scan(&msgID); err == nil {
				msgIDs = append(msgIDs, msgID)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(SearchResponse{MessageIDs: msgIDs})

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req IndexSearchTokenRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(req.MessageID) == "" {
			http.Error(w, "message_id required", http.StatusBadRequest)
			return
		}
		tokenBytes, err := hex.DecodeString(strings.TrimSpace(req.Token))
		if err != nil || len(tokenBytes) == 0 {
			http.Error(w, "token must be valid hex", http.StatusBadRequest)
			return
		}

		_, err = conn.Exec(ctx, `
			INSERT INTO search_tokens (mailbox_id, message_id, token)
			VALUES ($1, $2, $3)
			ON CONFLICT (mailbox_id, message_id, token) DO NOTHING
		`, mailboxID, req.MessageID, tokenBytes)
		if err != nil {
			http.Error(w, "failed to index search token", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
