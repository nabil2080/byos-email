package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type MailboxSettings struct {
	MailboxID              string    `json:"mailbox_id"`
	DisplayName            string    `json:"display_name"`
	SignaturePlain         string    `json:"signature_plain"`
	SignatureHTML          string    `json:"signature_html"`
	InsertSignatureOnReply bool      `json:"insert_signature_on_reply"`
	RecoveryPhraseWrapped  string    `json:"recovery_phrase_wrapped,omitempty"`
	RecoveryPhraseSalt     string    `json:"recovery_phrase_salt,omitempty"`
	Density                string    `json:"density"`
	LayoutMode             string    `json:"layout_mode"`
	Theme                  string    `json:"theme"`
	Language               string    `json:"language"`
	TimeFormat             string    `json:"time_format"`
	WeekStart              string    `json:"week_start"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

// mailboxSettingsHandler handles GET /v1/mailboxes/{mailbox_id}/settings and PUT /v1/mailboxes/{mailbox_id}/settings
func mailboxSettingsHandler(w http.ResponseWriter, r *http.Request) {
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

	// Validate user and mailbox belong to same org
	var userOrgID, mailboxOrgID, mailboxLocalPart, userDisplayName string
	err = conn.QueryRow(ctx, `SELECT org_id::text, COALESCE(display_name, '') FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID, &userDisplayName)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text, local_part FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID, &mailboxLocalPart)
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
		var s MailboxSettings
		var recWrapped, recSalt *string
		err := conn.QueryRow(ctx, `
			SELECT mailbox_id::text, COALESCE(display_name, ''), COALESCE(signature_plain, ''), COALESCE(signature_html, ''),
			       insert_signature_on_reply, recovery_phrase_wrapped, recovery_phrase_salt,
			       COALESCE(density, 'cozy'), COALESCE(layout_mode, 'split'), COALESCE(theme, 'cloud_dancer'),
			       COALESCE(language, 'en'), COALESCE(time_format, '12h'), COALESCE(week_start, 'sunday'),
			       created_at, updated_at
			FROM mailbox_settings
			WHERE mailbox_id=$1
		`, mailboxID).Scan(
			&s.MailboxID, &s.DisplayName, &s.SignaturePlain, &s.SignatureHTML,
			&s.InsertSignatureOnReply, &recWrapped, &recSalt,
			&s.Density, &s.LayoutMode, &s.Theme,
			&s.Language, &s.TimeFormat, &s.WeekStart,
			&s.CreatedAt, &s.UpdatedAt,
		)

		if err == pgx.ErrNoRows {
			// Return default settings for mailbox
			disp := userDisplayName
			if disp == "" {
				disp = mailboxLocalPart
			}
			s = MailboxSettings{
				MailboxID:              mailboxID,
				DisplayName:            disp,
				SignaturePlain:         "",
				SignatureHTML:          "",
				InsertSignatureOnReply: true,
				Density:                "cozy",
				LayoutMode:             "split",
				Theme:                  "cloud_dancer",
				Language:               "en",
				TimeFormat:             "12h",
				WeekStart:              "sunday",
				CreatedAt:              time.Now(),
				UpdatedAt:              time.Now(),
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(s)
			return
		}
		if err != nil {
			log.Printf("failed to query mailbox settings: %v", err)
			http.Error(w, "failed to get mailbox settings", http.StatusInternalServerError)
			return
		}

		if recWrapped != nil {
			s.RecoveryPhraseWrapped = *recWrapped
		}
		if recSalt != nil {
			s.RecoveryPhraseSalt = *recSalt
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s)

	case http.MethodPut, http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			DisplayName            *string `json:"display_name"`
			SignaturePlain         *string `json:"signature_plain"`
			SignatureHTML          *string `json:"signature_html"`
			InsertSignatureOnReply *bool   `json:"insert_signature_on_reply"`
			RecoveryPhraseWrapped  *string `json:"recovery_phrase_wrapped"`
			RecoveryPhraseSalt     *string `json:"recovery_phrase_salt"`
			Density                *string `json:"density"`
			LayoutMode             *string `json:"layout_mode"`
			Theme                  *string `json:"theme"`
			Language               *string `json:"language"`
			TimeFormat             *string `json:"time_format"`
			WeekStart              *string `json:"week_start"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		var density *string
		if req.Density != nil {
			d := strings.ToLower(strings.TrimSpace(*req.Density))
			if d == "compact" || d == "cozy" || d == "comfortable" {
				density = &d
			}
		}

		var layoutMode *string
		if req.LayoutMode != nil {
			l := strings.ToLower(strings.TrimSpace(*req.LayoutMode))
			if l == "split" || l == "full" {
				layoutMode = &l
			}
		}

		var theme *string
		if req.Theme != nil {
			t := strings.ToLower(strings.TrimSpace(*req.Theme))
			if t == "cloud_dancer" || t == "dark" {
				theme = &t
			}
		}

		var language *string
		if req.Language != nil {
			lang := strings.ToLower(strings.TrimSpace(*req.Language))
			if lang != "" {
				language = &lang
			}
		}

		var timeFormat *string
		if req.TimeFormat != nil {
			tf := strings.ToLower(strings.TrimSpace(*req.TimeFormat))
			if tf == "12h" || tf == "24h" {
				timeFormat = &tf
			}
		}

		var weekStart *string
		if req.WeekStart != nil {
			ws := strings.ToLower(strings.TrimSpace(*req.WeekStart))
			if ws == "sunday" || ws == "monday" || ws == "saturday" {
				weekStart = &ws
			}
		}

		var dispName *string
		if req.DisplayName != nil {
			d := strings.TrimSpace(*req.DisplayName)
			dispName = &d
		}

		var s MailboxSettings
		var recWrapped, recSalt *string
		err := conn.QueryRow(ctx, `
			INSERT INTO mailbox_settings (
				mailbox_id, display_name, signature_plain, signature_html, insert_signature_on_reply,
				recovery_phrase_wrapped, recovery_phrase_salt, density, layout_mode, theme,
				language, time_format, week_start, updated_at
			) VALUES (
				$1,
				COALESCE($2, ''),
				COALESCE($3, ''),
				COALESCE($4, ''),
				COALESCE($5, true),
				$6,
				$7,
				COALESCE($8, 'cozy'),
				COALESCE($9, 'split'),
				COALESCE($10, 'cloud_dancer'),
				COALESCE($11, 'en'),
				COALESCE($12, '12h'),
				COALESCE($13, 'sunday'),
				now()
			)
			ON CONFLICT (mailbox_id) DO UPDATE SET
				display_name = COALESCE($2, mailbox_settings.display_name),
				signature_plain = COALESCE($3, mailbox_settings.signature_plain),
				signature_html = COALESCE($4, mailbox_settings.signature_html),
				insert_signature_on_reply = COALESCE($5, mailbox_settings.insert_signature_on_reply),
				recovery_phrase_wrapped = COALESCE($6, mailbox_settings.recovery_phrase_wrapped),
				recovery_phrase_salt = COALESCE($7, mailbox_settings.recovery_phrase_salt),
				density = COALESCE($8, mailbox_settings.density),
				layout_mode = COALESCE($9, mailbox_settings.layout_mode),
				theme = COALESCE($10, mailbox_settings.theme),
				language = COALESCE($11, mailbox_settings.language),
				time_format = COALESCE($12, mailbox_settings.time_format),
				week_start = COALESCE($13, mailbox_settings.week_start),
				updated_at = now()
			RETURNING mailbox_id::text, COALESCE(display_name, ''), COALESCE(signature_plain, ''), COALESCE(signature_html, ''),
			          insert_signature_on_reply, recovery_phrase_wrapped, recovery_phrase_salt,
			          density, layout_mode, theme, language, time_format, week_start, created_at, updated_at
		`, mailboxID, dispName, req.SignaturePlain, req.SignatureHTML, req.InsertSignatureOnReply, req.RecoveryPhraseWrapped, req.RecoveryPhraseSalt, density, layoutMode, theme, language, timeFormat, weekStart).Scan(
			&s.MailboxID, &s.DisplayName, &s.SignaturePlain, &s.SignatureHTML,
			&s.InsertSignatureOnReply, &recWrapped, &recSalt,
			&s.Density, &s.LayoutMode, &s.Theme,
			&s.Language, &s.TimeFormat, &s.WeekStart,
			&s.CreatedAt, &s.UpdatedAt,
		)

		if err != nil {
			log.Printf("failed to upsert mailbox settings: %v", err)
			http.Error(w, "failed to update mailbox settings", http.StatusInternalServerError)
			return
		}

		if recWrapped != nil {
			s.RecoveryPhraseWrapped = *recWrapped
		}
		if recSalt != nil {
			s.RecoveryPhraseSalt = *recSalt
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(s)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
