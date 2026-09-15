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

// transparent1x1GIF is the canonical 43-byte transparent 1x1 GIF89a image
var transparent1x1GIF = []byte{
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
	0x01, 0x00, 0x01, 0x00, // 1 x 1
	0x80, 0x00, 0x00, // global color table flag, 2 entries
	0xff, 0xff, 0xff, // color 0: #ffffff
	0x00, 0x00, 0x00, // color 1: #000000
	0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // Graphic Control Extension (transparent color 0)
	0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // Image descriptor
	0x02, 0x02, 0x44, 0x01, 0x00, // Image data
	0x3b, // GIF Trailer
}

type MessageTrackingItem struct {
	ID            string     `json:"id"`
	MailboxID     string     `json:"mailbox_id"`
	TrackingToken string     `json:"tracking_token"`
	Subject       string     `json:"subject"`
	Recipient     string     `json:"recipient"`
	OpenCount     int        `json:"open_count"`
	FirstOpenedAt *time.Time `json:"first_opened_at"`
	LastOpenedAt  *time.Time `json:"last_opened_at"`
	LastUserAgent string     `json:"last_user_agent,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type RegisterTrackingRequest struct {
	TrackingToken string `json:"tracking_token"`
	Subject       string `json:"subject"`
	Recipient     string `json:"recipient"`
}

// trackPixelHandler serves GET /v1/track/{token} and /v1/track/{token}.gif
func trackPixelHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rawToken := r.PathValue("token")
	if rawToken == "" {
		// Try fallback from URL path
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) > 0 {
			rawToken = parts[len(parts)-1]
		}
	}
	token := strings.TrimSuffix(strings.TrimSpace(rawToken), ".gif")
	if token == "" {
		http.Error(w, "invalid token", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err == nil {
		defer conn.Close(ctx)
		userAgent := r.UserAgent()
		// Increment open count and timestamp
		_, _ = conn.Exec(ctx, `
			UPDATE message_tracking
			SET open_count = open_count + 1,
			    last_opened_at = NOW(),
			    first_opened_at = COALESCE(first_opened_at, NOW()),
			    last_user_agent = $1
			WHERE tracking_token = $2
		`, userAgent, token)
	}

	// Always return 1x1 transparent GIF with no-cache headers
	w.Header().Set("Content-Type", "image/gif")
	w.Header().Set("Content-Length", "43")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0, private")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		w.Write(transparent1x1GIF)
	}
}

// mailboxTrackingHandler handles POST and GET /v1/mailboxes/{mailbox_id}/tracking
func mailboxTrackingHandler(w http.ResponseWriter, r *http.Request) {
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

	// Authorize user has access to mailbox's org
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
	case http.MethodPost:
		var req RegisterTrackingRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		if req.TrackingToken == "" {
			http.Error(w, "tracking_token is required", http.StatusBadRequest)
			return
		}

		var item MessageTrackingItem
		err = conn.QueryRow(ctx, `
			INSERT INTO message_tracking (mailbox_id, tracking_token, subject, recipient)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (tracking_token) DO UPDATE
			SET subject = EXCLUDED.subject, recipient = EXCLUDED.recipient
			RETURNING id::text, mailbox_id::text, tracking_token, COALESCE(subject, ''), COALESCE(recipient, ''),
			          open_count, first_opened_at, last_opened_at, COALESCE(last_user_agent, ''), created_at
		`, mailboxID, req.TrackingToken, req.Subject, req.Recipient).Scan(
			&item.ID, &item.MailboxID, &item.TrackingToken, &item.Subject, &item.Recipient,
			&item.OpenCount, &item.FirstOpenedAt, &item.LastOpenedAt, &item.LastUserAgent, &item.CreatedAt,
		)
		if err != nil {
			http.Error(w, "failed to register tracking token", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(item)

	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT id::text, mailbox_id::text, tracking_token, COALESCE(subject, ''), COALESCE(recipient, ''),
			       open_count, first_opened_at, last_opened_at, COALESCE(last_user_agent, ''), created_at
			FROM message_tracking
			WHERE mailbox_id=$1
			ORDER BY created_at DESC
			LIMIT 100
		`, mailboxID)
		if err != nil {
			http.Error(w, "failed to query tracking items", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		items := make([]MessageTrackingItem, 0)
		for rows.Next() {
			var it MessageTrackingItem
			if err := rows.Scan(&it.ID, &it.MailboxID, &it.TrackingToken, &it.Subject, &it.Recipient,
				&it.OpenCount, &it.FirstOpenedAt, &it.LastOpenedAt, &it.LastUserAgent, &it.CreatedAt); err != nil {
				continue
			}
			items = append(items, it)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(items)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// mailboxTrackingItemHandler handles GET /v1/mailboxes/{mailbox_id}/tracking/{token}
func mailboxTrackingItemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	rawToken := r.PathValue("token")
	token := strings.TrimSuffix(strings.TrimSpace(rawToken), ".gif")

	if mailboxID == "" || token == "" {
		http.Error(w, "mailbox_id and token required", http.StatusBadRequest)
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

	// Auth check
	var userOrgID, mailboxOrgID string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID); err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var it MessageTrackingItem
	err = conn.QueryRow(ctx, `
		SELECT id::text, mailbox_id::text, tracking_token, COALESCE(subject, ''), COALESCE(recipient, ''),
		       open_count, first_opened_at, last_opened_at, COALESCE(last_user_agent, ''), created_at
		FROM message_tracking
		WHERE mailbox_id=$1 AND tracking_token=$2
	`, mailboxID, token).Scan(
		&it.ID, &it.MailboxID, &it.TrackingToken, &it.Subject, &it.Recipient,
		&it.OpenCount, &it.FirstOpenedAt, &it.LastOpenedAt, &it.LastUserAgent, &it.CreatedAt,
	)
	if err != nil {
		http.Error(w, "tracking record not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(it)
}
