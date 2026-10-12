package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// MailRule represents a rule for automated message routing and handling.
//
// PRIVACY: Rules match only on metadata visible at ingest (sender, recipient,
// attachment presence, size). Subject and body are end-to-end encrypted
// and cannot be matched against.
type MailRule struct {
	ID                  string  `json:"id"`
	MailboxID           string  `json:"mailbox_id"`
	Name                string  `json:"name"`
	Enabled             bool    `json:"enabled"`
	Priority            int     `json:"priority"`
	MatchSender         *string `json:"match_sender"`
	MatchRecipient      *string `json:"match_recipient"`
	MatchHasAttachments *bool   `json:"match_has_attachments"`
	MatchMinSizeBytes   *int64  `json:"match_min_size_bytes"`
	ActionType          string  `json:"action_type"`
	ActionFolder        *string `json:"action_folder"`
	ActionLabelID       *string `json:"action_label_id"`
	ActionCategory      *string `json:"action_category,omitempty"`
	CreatedAt           string  `json:"created_at"`
	UpdatedAt           string  `json:"updated_at"`
}

type createRuleRequest struct {
	Name                string  `json:"name"`
	Enabled             *bool   `json:"enabled"`
	Priority            *int    `json:"priority"`
	MatchSender         *string `json:"match_sender"`
	MatchRecipient      *string `json:"match_recipient"`
	MatchHasAttachments *bool   `json:"match_has_attachments"`
	MatchMinSizeBytes   *int64  `json:"match_min_size_bytes"`
	ActionType          string  `json:"action_type"`
	ActionFolder        *string `json:"action_folder"`
	ActionLabelID       *string `json:"action_label_id"`
	ActionCategory      *string `json:"action_category"`
}

type updateRuleRequest struct {
	Name                *string `json:"name"`
	Enabled             *bool   `json:"enabled"`
	Priority            *int    `json:"priority"`
	MatchSender         *string `json:"match_sender"`
	MatchRecipient      *string `json:"match_recipient"`
	MatchHasAttachments *bool   `json:"match_has_attachments"`
	MatchMinSizeBytes   *int64  `json:"match_min_size_bytes"`
	ActionType          *string `json:"action_type"`
	ActionFolder        *string `json:"action_folder"`
	ActionLabelID       *string `json:"action_label_id"`
	ActionCategory      *string `json:"action_category"`
}

// verifyMailboxAccess verifies user session and authorization for the given mailbox.
func verifyMailboxAccess(ctx context.Context, conn *pgx.Conn, mailboxID, userID string) (string, error) {
	var orgID string
	err := conn.QueryRow(ctx, `
		SELECT m.org_id::text
		FROM mailboxes m
		JOIN users u ON u.org_id = m.org_id
		WHERE m.id = $1 AND u.id = $2 AND u.is_active = true
	`, mailboxID, userID).Scan(&orgID)
	return orgID, err
}

// mailboxRulesHandler handles GET and POST /v1/mailboxes/{mailbox_id}/rules
func mailboxRulesHandler(w http.ResponseWriter, r *http.Request) {
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

	orgID, err := verifyMailboxAccess(ctx, conn, mailboxID, userID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT id::text, mailbox_id::text, name, enabled, priority,
			       match_sender, match_recipient, match_has_attachments, match_min_size_bytes,
			       action_type, action_folder, action_label_id::text, action_category,
			       created_at, updated_at
			FROM mail_rules
			WHERE mailbox_id = $1
			ORDER BY priority ASC, created_at ASC
		`, mailboxID)
		if err != nil {
			http.Error(w, "failed to query rules", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		rules := make([]MailRule, 0)
		for rows.Next() {
			var rule MailRule
			var createdAt, updatedAt time.Time
			var labelID *string
			if err := rows.Scan(
				&rule.ID, &rule.MailboxID, &rule.Name, &rule.Enabled, &rule.Priority,
				&rule.MatchSender, &rule.MatchRecipient, &rule.MatchHasAttachments, &rule.MatchMinSizeBytes,
				&rule.ActionType, &rule.ActionFolder, &labelID, &rule.ActionCategory,
				&createdAt, &updatedAt,
			); err != nil {
				http.Error(w, "failed to read rule", http.StatusInternalServerError)
				return
			}
			rule.ActionLabelID = labelID
			rule.CreatedAt = createdAt.Format(time.RFC3339)
			rule.UpdatedAt = updatedAt.Format(time.RFC3339)
			rules = append(rules, rule)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(rules)

	case http.MethodPost:
		var req createRuleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		name := strings.TrimSpace(req.Name)
		if name == "" {
			http.Error(w, "rule name is required", http.StatusBadRequest)
			return
		}

		enabled := true
		if req.Enabled != nil {
			enabled = *req.Enabled
		}

		priority := 0
		if req.Priority != nil {
			priority = *req.Priority
		} else {
			_ = conn.QueryRow(ctx, `SELECT COALESCE(MAX(priority) + 1, 0) FROM mail_rules WHERE mailbox_id = $1`, mailboxID).Scan(&priority)
		}

		actionType := strings.TrimSpace(req.ActionType)
		var actionFolder *string
		var actionLabelID *string
		var actionCategory *string

		switch actionType {
		case "move":
			if req.ActionFolder == nil || strings.TrimSpace(*req.ActionFolder) == "" {
				http.Error(w, "action_folder is required when action_type is move", http.StatusBadRequest)
				return
			}
			folder := strings.ToLower(strings.TrimSpace(*req.ActionFolder))
			actionFolder = &folder
		case "label":
			if req.ActionLabelID == nil || strings.TrimSpace(*req.ActionLabelID) == "" {
				http.Error(w, "action_label_id is required when action_type is label", http.StatusBadRequest)
				return
			}
			trimmed := strings.TrimSpace(*req.ActionLabelID)
			if _, err := uuid.Parse(trimmed); err != nil {
				http.Error(w, "invalid action_label_id UUID", http.StatusBadRequest)
				return
			}
			actionLabelID = &trimmed
		case "mark_read":
			// valid
		case "delete":
			folder := "trash"
			actionFolder = &folder
		case "category":
			var cat string
			if req.ActionCategory != nil && strings.TrimSpace(*req.ActionCategory) != "" {
				cat = strings.ToLower(strings.TrimSpace(*req.ActionCategory))
			} else if req.ActionFolder != nil && strings.TrimSpace(*req.ActionFolder) != "" {
				cat = strings.ToLower(strings.TrimSpace(*req.ActionFolder))
			} else {
				http.Error(w, "action_category is required when action_type is category", http.StatusBadRequest)
				return
			}
			validCats := map[string]bool{"primary": true, "notifications": true, "newsletters": true, "social": true}
			if !validCats[cat] {
				http.Error(w, "invalid action_category (must be primary, notifications, newsletters, or social)", http.StatusBadRequest)
				return
			}
			actionCategory = &cat
		default:
			http.Error(w, "invalid action_type (must be move, label, mark_read, delete, or category)", http.StatusBadRequest)
			return
		}

		if actionCategory == nil && req.ActionCategory != nil && strings.TrimSpace(*req.ActionCategory) != "" {
			cat := strings.ToLower(strings.TrimSpace(*req.ActionCategory))
			validCats := map[string]bool{"primary": true, "notifications": true, "newsletters": true, "social": true}
			if validCats[cat] {
				actionCategory = &cat
			}
		}

		var matchSender *string
		if req.MatchSender != nil && strings.TrimSpace(*req.MatchSender) != "" {
			s := strings.TrimSpace(*req.MatchSender)
			matchSender = &s
		}
		var matchRecipient *string
		if req.MatchRecipient != nil && strings.TrimSpace(*req.MatchRecipient) != "" {
			s := strings.TrimSpace(*req.MatchRecipient)
			matchRecipient = &s
		}

		var rule MailRule
		var createdAt, updatedAt time.Time
		var scannedLabelID *string

		err = conn.QueryRow(ctx, `
			INSERT INTO mail_rules (
				mailbox_id, name, enabled, priority,
				match_sender, match_recipient, match_has_attachments, match_min_size_bytes,
				action_type, action_folder, action_label_id, action_category
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			RETURNING id::text, mailbox_id::text, name, enabled, priority,
			          match_sender, match_recipient, match_has_attachments, match_min_size_bytes,
			          action_type, action_folder, action_label_id::text, action_category,
			          created_at, updated_at
		`, mailboxID, name, enabled, priority,
			matchSender, matchRecipient, req.MatchHasAttachments, req.MatchMinSizeBytes,
			actionType, actionFolder, actionLabelID, actionCategory,
		).Scan(
			&rule.ID, &rule.MailboxID, &rule.Name, &rule.Enabled, &rule.Priority,
			&rule.MatchSender, &rule.MatchRecipient, &rule.MatchHasAttachments, &rule.MatchMinSizeBytes,
			&rule.ActionType, &rule.ActionFolder, &scannedLabelID, &rule.ActionCategory,
			&createdAt, &updatedAt,
		)
		if err != nil {
			http.Error(w, "failed to create rule: "+err.Error(), http.StatusInternalServerError)
			return
		}
		rule.ActionLabelID = scannedLabelID
		rule.CreatedAt = createdAt.Format(time.RFC3339)
		rule.UpdatedAt = updatedAt.Format(time.RFC3339)

		auditLog(ctx, conn, orgID, userID, "create_mail_rule", "mail_rule", rule.ID, map[string]interface{}{
			"name":        rule.Name,
			"action_type": rule.ActionType,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(rule)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// mailboxRuleItemHandler handles PUT and DELETE /v1/mailboxes/{mailbox_id}/rules/{rule_id}
func mailboxRuleItemHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	ruleID := r.PathValue("rule_id")
	if mailboxID == "" || ruleID == "" {
		http.Error(w, "mailbox_id and rule_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(ruleID); err != nil {
		http.Error(w, "invalid rule_id UUID", http.StatusBadRequest)
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

	orgID, err := verifyMailboxAccess(ctx, conn, mailboxID, userID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodPut:
		var req updateRuleRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		// First retrieve existing rule
		var existing MailRule
		var createdAt, updatedAt time.Time
		var existingLabelID *string
		err = conn.QueryRow(ctx, `
			SELECT id::text, mailbox_id::text, name, enabled, priority,
			       match_sender, match_recipient, match_has_attachments, match_min_size_bytes,
			       action_type, action_folder, action_label_id::text, action_category,
			       created_at, updated_at
			FROM mail_rules
			WHERE id = $1 AND mailbox_id = $2
		`, ruleID, mailboxID).Scan(
			&existing.ID, &existing.MailboxID, &existing.Name, &existing.Enabled, &existing.Priority,
			&existing.MatchSender, &existing.MatchRecipient, &existing.MatchHasAttachments, &existing.MatchMinSizeBytes,
			&existing.ActionType, &existing.ActionFolder, &existingLabelID, &existing.ActionCategory,
			&createdAt, &updatedAt,
		)
		if err != nil {
			http.Error(w, "rule not found", http.StatusNotFound)
			return
		}
		existing.ActionLabelID = existingLabelID

		if req.Name != nil && strings.TrimSpace(*req.Name) != "" {
			existing.Name = strings.TrimSpace(*req.Name)
		}
		if req.Enabled != nil {
			existing.Enabled = *req.Enabled
		}
		if req.Priority != nil {
			existing.Priority = *req.Priority
		}
		if req.MatchSender != nil {
			if strings.TrimSpace(*req.MatchSender) == "" {
				existing.MatchSender = nil
			} else {
				s := strings.TrimSpace(*req.MatchSender)
				existing.MatchSender = &s
			}
		}
		if req.MatchRecipient != nil {
			if strings.TrimSpace(*req.MatchRecipient) == "" {
				existing.MatchRecipient = nil
			} else {
				s := strings.TrimSpace(*req.MatchRecipient)
				existing.MatchRecipient = &s
			}
		}
		if req.MatchHasAttachments != nil {
			existing.MatchHasAttachments = req.MatchHasAttachments
		}
		if req.MatchMinSizeBytes != nil {
			existing.MatchMinSizeBytes = req.MatchMinSizeBytes
		}
		if req.ActionType != nil {
			act := strings.TrimSpace(*req.ActionType)
			switch act {
			case "move":
				existing.ActionType = "move"
				if req.ActionFolder != nil && strings.TrimSpace(*req.ActionFolder) != "" {
					f := strings.ToLower(strings.TrimSpace(*req.ActionFolder))
					existing.ActionFolder = &f
				} else if existing.ActionFolder == nil || *existing.ActionFolder == "" {
					http.Error(w, "action_folder is required when action_type is move", http.StatusBadRequest)
					return
				}
				existing.ActionLabelID = nil
			case "label":
				existing.ActionType = "label"
				if req.ActionLabelID != nil && strings.TrimSpace(*req.ActionLabelID) != "" {
					l := strings.TrimSpace(*req.ActionLabelID)
					if _, err := uuid.Parse(l); err != nil {
						http.Error(w, "invalid action_label_id UUID", http.StatusBadRequest)
						return
					}
					existing.ActionLabelID = &l
				} else if existing.ActionLabelID == nil || *existing.ActionLabelID == "" {
					http.Error(w, "action_label_id is required when action_type is label", http.StatusBadRequest)
					return
				}
				existing.ActionFolder = nil
			case "mark_read":
				existing.ActionType = "mark_read"
				existing.ActionFolder = nil
				existing.ActionLabelID = nil
			case "delete":
				existing.ActionType = "delete"
				f := "trash"
				existing.ActionFolder = &f
				existing.ActionLabelID = nil
			case "category":
				existing.ActionType = "category"
				if req.ActionCategory != nil && strings.TrimSpace(*req.ActionCategory) != "" {
					cat := strings.ToLower(strings.TrimSpace(*req.ActionCategory))
					validCats := map[string]bool{"primary": true, "notifications": true, "newsletters": true, "social": true}
					if !validCats[cat] {
						http.Error(w, "invalid action_category", http.StatusBadRequest)
						return
					}
					existing.ActionCategory = &cat
				} else if req.ActionFolder != nil && strings.TrimSpace(*req.ActionFolder) != "" {
					cat := strings.ToLower(strings.TrimSpace(*req.ActionFolder))
					validCats := map[string]bool{"primary": true, "notifications": true, "newsletters": true, "social": true}
					if !validCats[cat] {
						http.Error(w, "invalid action_category", http.StatusBadRequest)
						return
					}
					existing.ActionCategory = &cat
				} else if existing.ActionCategory == nil || *existing.ActionCategory == "" {
					http.Error(w, "action_category is required when action_type is category", http.StatusBadRequest)
					return
				}
				existing.ActionFolder = nil
				existing.ActionLabelID = nil
			default:
				http.Error(w, "invalid action_type", http.StatusBadRequest)
				return
			}
		} else {
			if req.ActionFolder != nil {
				f := strings.ToLower(strings.TrimSpace(*req.ActionFolder))
				existing.ActionFolder = &f
			}
			if req.ActionLabelID != nil {
				l := strings.TrimSpace(*req.ActionLabelID)
				if l != "" {
					if _, err := uuid.Parse(l); err != nil {
						http.Error(w, "invalid action_label_id UUID", http.StatusBadRequest)
						return
					}
					existing.ActionLabelID = &l
				} else {
					existing.ActionLabelID = nil
				}
			}
			if req.ActionCategory != nil {
				cat := strings.ToLower(strings.TrimSpace(*req.ActionCategory))
				if cat != "" {
					validCats := map[string]bool{"primary": true, "notifications": true, "newsletters": true, "social": true}
					if !validCats[cat] {
						http.Error(w, "invalid action_category", http.StatusBadRequest)
						return
					}
					existing.ActionCategory = &cat
				} else {
					existing.ActionCategory = nil
				}
			}
		}

		var updatedLabelID *string
		err = conn.QueryRow(ctx, `
			UPDATE mail_rules
			SET name = $1, enabled = $2, priority = $3,
			    match_sender = $4, match_recipient = $5, match_has_attachments = $6, match_min_size_bytes = $7,
			    action_type = $8, action_folder = $9, action_label_id = $10, action_category = $11,
			    updated_at = now()
			WHERE id = $12 AND mailbox_id = $13
			RETURNING id::text, mailbox_id::text, name, enabled, priority,
			          match_sender, match_recipient, match_has_attachments, match_min_size_bytes,
			          action_type, action_folder, action_label_id::text, action_category,
			          created_at, updated_at
		`, existing.Name, existing.Enabled, existing.Priority,
			existing.MatchSender, existing.MatchRecipient, existing.MatchHasAttachments, existing.MatchMinSizeBytes,
			existing.ActionType, existing.ActionFolder, existing.ActionLabelID, existing.ActionCategory,
			ruleID, mailboxID,
		).Scan(
			&existing.ID, &existing.MailboxID, &existing.Name, &existing.Enabled, &existing.Priority,
			&existing.MatchSender, &existing.MatchRecipient, &existing.MatchHasAttachments, &existing.MatchMinSizeBytes,
			&existing.ActionType, &existing.ActionFolder, &updatedLabelID, &existing.ActionCategory,
			&createdAt, &updatedAt,
		)
		if err != nil {
			http.Error(w, "failed to update rule: "+err.Error(), http.StatusInternalServerError)
			return
		}
		existing.ActionLabelID = updatedLabelID
		existing.CreatedAt = createdAt.Format(time.RFC3339)
		existing.UpdatedAt = updatedAt.Format(time.RFC3339)

		auditLog(ctx, conn, orgID, userID, "update_mail_rule", "mail_rule", existing.ID, map[string]interface{}{
			"name": existing.Name,
		})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(existing)

	case http.MethodDelete:
		res, err := conn.Exec(ctx, `DELETE FROM mail_rules WHERE id = $1 AND mailbox_id = $2`, ruleID, mailboxID)
		if err != nil {
			http.Error(w, "failed to delete rule", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			http.Error(w, "rule not found", http.StatusNotFound)
			return
		}

		auditLog(ctx, conn, orgID, userID, "delete_mail_rule", "mail_rule", ruleID, nil)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
