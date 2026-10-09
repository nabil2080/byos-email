package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	maskedAliasDomain   = "masked.byos.local"
	maxUserAliasesPerDay = 20
)

type MaskedAliasResponse struct {
	ID           string  `json:"id"`
	AliasAddress string  `json:"alias_address"`
	Label        string  `json:"label"`
	IsEnabled    bool    `json:"is_enabled"`
	CreatedAt    string  `json:"created_at"`
	DisabledAt   *string `json:"disabled_at"`
	ReplyCount   int     `json:"reply_count"`
}

type CreateAliasRequest struct {
	Label     string `json:"label"`
	MailboxID string `json:"mailbox_id,omitempty"`
}

type UpdateAliasRequest struct {
	Label     *string `json:"label,omitempty"`
	IsEnabled *bool   `json:"is_enabled,omitempty"`
}

func generateRandomLocalPart(length int) (string, error) {
	const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, length)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		b[i] = charset[n.Int64()]
	}
	return string(b), nil
}

func generateUniqueMaskedAddress(ctx context.Context, conn *pgx.Conn) (string, error) {
	for attempt := 0; attempt < 5; attempt++ {
		lp, err := generateRandomLocalPart(12)
		if err != nil {
			return "", fmt.Errorf("failed to generate random alias: %w", err)
		}
		candidate := lp + "@" + maskedAliasDomain
		var exists bool
		err = conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM masked_aliases WHERE lower(alias_address) = lower($1))`, candidate).Scan(&exists)
		if err != nil {
			return "", fmt.Errorf("failed to check alias uniqueness: %w", err)
		}
		if !exists {
			return candidate, nil
		}
	}
	return "", errors.New("failed to generate unique alias after 5 attempts")
}

func aliasesHandler(w http.ResponseWriter, r *http.Request) {
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

	var userOrgID string
	var userActive bool
	err = conn.QueryRow(ctx, `SELECT org_id::text, is_active FROM users WHERE id=$1`, userID).Scan(&userOrgID, &userActive)
	if err != nil || !userActive {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	switch r.Method {
	case http.MethodGet:
		mailboxFilter := r.URL.Query().Get("mailbox_id")
		var rows pgx.Rows
		if mailboxFilter != "" {
			if _, err := uuid.Parse(mailboxFilter); err != nil {
				http.Error(w, "invalid mailbox_id query parameter", http.StatusBadRequest)
				return
			}
			rows, err = conn.Query(ctx, `
				SELECT ma.id::text, ma.alias_address, ma.label, ma.is_enabled, ma.created_at, ma.disabled_at, ma.reply_count
				FROM masked_aliases ma
				JOIN mailboxes m ON m.id = ma.mailbox_id
				JOIN users u ON u.id = $1
				WHERE ma.mailbox_id = $2
				  AND (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))
				ORDER BY ma.created_at DESC
			`, userID, mailboxFilter)
		} else {
			rows, err = conn.Query(ctx, `
				SELECT ma.id::text, ma.alias_address, ma.label, ma.is_enabled, ma.created_at, ma.disabled_at, ma.reply_count
				FROM masked_aliases ma
				JOIN mailboxes m ON m.id = ma.mailbox_id
				JOIN users u ON u.id = $1
				WHERE (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))
				ORDER BY ma.created_at DESC
			`, userID)
		}
		if err != nil {
			http.Error(w, "failed to query aliases: "+err.Error(), http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		aliases := make([]MaskedAliasResponse, 0)
		for rows.Next() {
			var item MaskedAliasResponse
			var createdAt time.Time
			var disabledAt *time.Time
			if err := rows.Scan(&item.ID, &item.AliasAddress, &item.Label, &item.IsEnabled, &createdAt, &disabledAt, &item.ReplyCount); err != nil {
				http.Error(w, "failed to read alias row: "+err.Error(), http.StatusInternalServerError)
				return
			}
			item.CreatedAt = createdAt.UTC().Format(time.RFC3339)
			if disabledAt != nil {
				formatted := disabledAt.UTC().Format(time.RFC3339)
				item.DisabledAt = &formatted
			}
			aliases = append(aliases, item)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"aliases": aliases,
		})

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req CreateAliasRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Check 24-hour rate limit: 20 aliases per user per 24 hours
		var recentCount int
		err = conn.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM masked_aliases ma
			JOIN mailboxes m ON m.id = ma.mailbox_id
			JOIN users u ON u.id = $1
			WHERE (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))
			  AND ma.created_at > now() - interval '24 hours'
		`, userID).Scan(&recentCount)
		if err != nil {
			http.Error(w, "failed to check rate limit", http.StatusInternalServerError)
			return
		}

		if recentCount >= maxUserAliasesPerDay {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Retry-After", "86400")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error":       "rate_limit_exceeded",
				"retry_after": 86400,
			})
			return
		}

		// Resolve mailbox ID
		var targetMailboxID string
		if req.MailboxID != "" {
			if _, err := uuid.Parse(req.MailboxID); err != nil {
				http.Error(w, "invalid mailbox_id", http.StatusBadRequest)
				return
			}
			err = conn.QueryRow(ctx, `
				SELECT m.id::text
				FROM mailboxes m
				JOIN users u ON u.id = $1
				WHERE m.id = $2
				  AND (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))
				  AND m.is_active = true
			`, userID, req.MailboxID).Scan(&targetMailboxID)
			if err != nil {
				http.Error(w, "mailbox not found or unauthorized", http.StatusForbidden)
				return
			}
		} else {
			// Find primary active mailbox for user
			err = conn.QueryRow(ctx, `
				SELECT m.id::text
				FROM mailboxes m
				WHERE m.user_id = $1 AND m.is_active = true
				ORDER BY m.created_at ASC
				LIMIT 1
			`, userID).Scan(&targetMailboxID)
			if err != nil {
				// Fallback to org mailbox if user is admin/owner
				err = conn.QueryRow(ctx, `
					SELECT m.id::text
					FROM mailboxes m
					JOIN users u ON u.org_id = m.org_id
					WHERE u.id = $1 AND u.role IN ('admin', 'owner') AND m.is_active = true
					ORDER BY m.created_at ASC
					LIMIT 1
				`, userID).Scan(&targetMailboxID)
				if err != nil {
					http.Error(w, "no active mailbox found for user", http.StatusBadRequest)
					return
				}
			}
		}

		aliasAddress, err := generateUniqueMaskedAddress(ctx, conn)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		var created MaskedAliasResponse
		var createdAt time.Time
		var disabledAt *time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO masked_aliases (mailbox_id, alias_address, label, is_enabled, created_at, reply_count)
			VALUES ($1, $2, $3, true, now(), 0)
			RETURNING id::text, alias_address, label, is_enabled, created_at, disabled_at, reply_count
		`, targetMailboxID, aliasAddress, strings.TrimSpace(req.Label)).Scan(
			&created.ID, &created.AliasAddress, &created.Label, &created.IsEnabled, &createdAt, &disabledAt, &created.ReplyCount,
		)
		if err != nil {
			http.Error(w, "failed to create alias: "+err.Error(), http.StatusInternalServerError)
			return
		}

		created.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		if disabledAt != nil {
			formatted := disabledAt.UTC().Format(time.RFC3339)
			created.DisabledAt = &formatted
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(created)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func aliasDetailHandler(w http.ResponseWriter, r *http.Request) {
	aliasID := r.PathValue("id")
	if aliasID == "" {
		// Fallback for custom routing prefixes
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) >= 5 && parts[0] == "v1" && parts[1] == "users" && parts[2] == "me" && parts[3] == "aliases" {
			aliasID = parts[4]
		}
	}
	if aliasID == "" {
		http.Error(w, "alias ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(aliasID); err != nil {
		http.Error(w, "alias ID must be UUID", http.StatusBadRequest)
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

	var authorizedID string
	err = conn.QueryRow(ctx, `
		SELECT ma.id::text
		FROM masked_aliases ma
		JOIN mailboxes m ON m.id = ma.mailbox_id
		JOIN users u ON u.id = $1
		WHERE ma.id = $2
		  AND (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))
	`, userID, aliasID).Scan(&authorizedID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "alias not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodPatch:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req UpdateAliasRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// Retrieve current state
		var currentLabel string
		var currentEnabled bool
		err = conn.QueryRow(ctx, `SELECT label, is_enabled FROM masked_aliases WHERE id = $1`, aliasID).Scan(&currentLabel, &currentEnabled)
		if err != nil {
			http.Error(w, "alias not found", http.StatusNotFound)
			return
		}

		newLabel := currentLabel
		if req.Label != nil {
			newLabel = strings.TrimSpace(*req.Label)
		}

		newEnabled := currentEnabled
		updateDisabledAtSQL := "disabled_at"
		if req.IsEnabled != nil {
			newEnabled = *req.IsEnabled
			if currentEnabled && !newEnabled {
				// Transition true -> false: set disabled_at = now()
				updateDisabledAtSQL = "now()"
			} else if !currentEnabled && newEnabled {
				// Transition false -> true: set disabled_at = null
				updateDisabledAtSQL = "NULL"
			}
		}

		query := fmt.Sprintf(`
			UPDATE masked_aliases
			SET label = $1, is_enabled = $2, disabled_at = %s
			WHERE id = $3
			RETURNING id::text, alias_address, label, is_enabled, created_at, disabled_at, reply_count
		`, updateDisabledAtSQL)

		var updated MaskedAliasResponse
		var createdAt time.Time
		var disabledAt *time.Time
		err = conn.QueryRow(ctx, query, newLabel, newEnabled, aliasID).Scan(
			&updated.ID, &updated.AliasAddress, &updated.Label, &updated.IsEnabled, &createdAt, &disabledAt, &updated.ReplyCount,
		)
		if err != nil {
			http.Error(w, "failed to update alias: "+err.Error(), http.StatusInternalServerError)
			return
		}

		updated.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		if disabledAt != nil {
			formatted := disabledAt.UTC().Format(time.RFC3339)
			updated.DisabledAt = &formatted
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(updated)

	case http.MethodDelete:
		// Hard delete from masked_aliases; ON DELETE CASCADE clears masked_alias_reply_map rows
		res, err := conn.Exec(ctx, `DELETE FROM masked_aliases WHERE id = $1`, aliasID)
		if err != nil {
			http.Error(w, "failed to delete alias", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			http.Error(w, "alias not found", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
