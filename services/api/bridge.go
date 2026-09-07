package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CreateBridgeCredentialRequest struct {
	Label string `json:"label"`
}

type BridgeCredentialResponse struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Token      string     `json:"token,omitempty"` // Returned ONLY on creation
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

type BridgeAuthenticateRequest struct {
	MailboxID string `json:"mailbox_id"`
	Token     string `json:"token"`
}

type BridgeMessageResponse struct {
	ID         string     `json:"id"`
	MessageSeq int64      `json:"message_seq"`
	Sender     string     `json:"sender"`
	Recipients []string   `json:"recipients"`
	ReceivedAt time.Time  `json:"received_at"`
	SentAt     *time.Time `json:"sent_at,omitempty"`
	Status     string     `json:"status"`
}

func bridgeMessagesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.URL.Query().Get("mailbox_id")
	token := r.Header.Get("X-BYOS-Bridge-Token")
	if _, err := uuid.Parse(mailboxID); err != nil || token == "" {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	hash := sha256.Sum256([]byte(token))
	conn, err := pgx.Connect(r.Context(), bridgeDatabaseURL())
	if err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	defer conn.Close(r.Context())
	var credentialID string
	if err := conn.QueryRow(r.Context(), `SELECT id::text FROM bridge_credentials WHERE mailbox_id=$1 AND token_hash=$2 AND revoked_at IS NULL`, mailboxID, hash[:]).Scan(&credentialID); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := conn.Exec(r.Context(), `UPDATE bridge_credentials SET last_used_at=now() WHERE id=$1`, credentialID); err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	rows, err := conn.Query(r.Context(), `
		SELECT id::text, message_seq, sender, recipients, received_at, sent_at, status
		FROM message_metadata WHERE mailbox_id=$1
		ORDER BY message_seq DESC LIMIT 100`, mailboxID)
	if err != nil {
		http.Error(w, "failed to query messages", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	messages := make([]BridgeMessageResponse, 0)
	for rows.Next() {
		var message BridgeMessageResponse
		if err := rows.Scan(&message.ID, &message.MessageSeq, &message.Sender, &message.Recipients, &message.ReceivedAt, &message.SentAt, &message.Status); err != nil {
			http.Error(w, "failed to read messages", http.StatusInternalServerError)
			return
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "failed to read messages", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"messages": messages})
}

func bridgeDatabaseURL() string {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}
	return "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
}

func bridgeAuthenticateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req BridgeAuthenticateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := uuid.Parse(req.MailboxID); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	hash := sha256.Sum256([]byte(req.Token))
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, bridgeDatabaseURL())
	if err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	defer conn.Close(ctx)
	var credentialID string
	if err := conn.QueryRow(ctx, `SELECT id::text FROM bridge_credentials WHERE mailbox_id=$1 AND token_hash=$2 AND revoked_at IS NULL`, req.MailboxID, hash[:]).Scan(&credentialID); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := conn.Exec(ctx, `UPDATE bridge_credentials SET last_used_at=now() WHERE id=$1`, credentialID); err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func bridgeCredentialsHandler(w http.ResponseWriter, r *http.Request) {
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

	// Check if path has a specific credential ID for DELETE
	credID := r.PathValue("credential_id")

	switch r.Method {
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT id::text, label, created_at, last_used_at
			FROM bridge_credentials
			WHERE mailbox_id=$1 AND revoked_at IS NULL
			ORDER BY created_at DESC
		`, mailboxID)
		if err != nil {
			http.Error(w, "failed to query bridge credentials", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		creds := make([]BridgeCredentialResponse, 0)
		for rows.Next() {
			var c BridgeCredentialResponse
			if err := rows.Scan(&c.ID, &c.Label, &c.CreatedAt, &c.LastUsedAt); err == nil {
				creds = append(creds, c)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"credentials": creds})

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req CreateBridgeCredentialRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		label := strings.TrimSpace(req.Label)
		if label == "" {
			label = "Desktop Mail Client"
		}

		// Generate random 32-byte token
		rawBytes := make([]byte, 32)
		if _, err := rand.Read(rawBytes); err != nil {
			http.Error(w, "entropy error", http.StatusInternalServerError)
			return
		}
		token := "byos_bridge_" + hex.EncodeToString(rawBytes)
		hash := sha256.Sum256([]byte(token))

		var id string
		var createdAt time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO bridge_credentials (mailbox_id, label, token_hash)
			VALUES ($1, $2, $3)
			RETURNING id::text, created_at
		`, mailboxID, label, hash[:]).Scan(&id, &createdAt)
		if err != nil {
			http.Error(w, "failed to create bridge credential", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, userOrgID, userID, "create_bridge_credential", "bridge_credential", id, map[string]interface{}{"label": label})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(BridgeCredentialResponse{
			ID:        id,
			Label:     label,
			Token:     token,
			CreatedAt: createdAt,
		})

	case http.MethodDelete:
		if credID == "" {
			http.Error(w, "credential_id required in URL path", http.StatusBadRequest)
			return
		}
		if _, err := uuid.Parse(credID); err != nil {
			http.Error(w, "invalid credential_id UUID", http.StatusBadRequest)
			return
		}

		res, err := conn.Exec(ctx, `
			UPDATE bridge_credentials
			SET revoked_at=now()
			WHERE id=$1 AND mailbox_id=$2 AND revoked_at IS NULL
		`, credID, mailboxID)
		if err != nil {
			http.Error(w, "failed to revoke bridge credential", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			http.Error(w, "credential not found or already revoked", http.StatusNotFound)
			return
		}

		auditLog(ctx, conn, userOrgID, userID, "revoke_bridge_credential", "bridge_credential", credID, nil)

		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
