package main

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// EvaluateRules evaluates enabled mail rules for a mailbox in priority order.
//
// Rules:
//  1. Load enabled rules ordered by priority ASC, created_at ASC.
//  2. Evaluate all non-null match conditions for a rule as AND.
//     - match_sender: case-insensitive substring match on sender
//     - match_recipient: case-insensitive substring match on any recipient
//     - match_has_attachments: boolean equality check
//     - match_min_size_bytes: sizeBytes >= match_min_size_bytes
//  3. First matching rule wins (do NOT compose effects from multiple rules).
//
// PRIVACY: Rules match only on metadata visible at ingest (sender, recipient,
// attachment presence, size). Subject and body are end-to-end encrypted
// and cannot be matched against.
func EvaluateRules(
	ctx context.Context,
	tx pgx.Tx,
	mailboxID string,
	sender string,
	recipients []string,
	sizeBytes int64,
	hasAttachments bool,
) (folderOverride string, labelIDs []string, markRead bool, deleteMessage bool, categoryOverride string, err error) {
	rows, err := tx.Query(ctx, `
		SELECT action_type, action_folder, action_label_id::text, action_category,
		       match_sender, match_recipient, match_has_attachments, match_min_size_bytes
		FROM mail_rules
		WHERE mailbox_id = $1 AND enabled = true
		ORDER BY priority ASC, created_at ASC
	`, mailboxID)
	if err != nil {
		return "", nil, false, false, "", err
	}
	defer rows.Close()

	type evalRule struct {
		actionType          string
		actionFolder        *string
		actionLabelID       *string
		actionCategory      *string
		matchSender         *string
		matchRecipient      *string
		matchHasAttachments *bool
		matchMinSizeBytes   *int64
	}

	var rules []evalRule
	for rows.Next() {
		var r evalRule
		if err := rows.Scan(
			&r.actionType, &r.actionFolder, &r.actionLabelID, &r.actionCategory,
			&r.matchSender, &r.matchRecipient, &r.matchHasAttachments, &r.matchMinSizeBytes,
		); err != nil {
			return "", nil, false, false, "", err
		}
		rules = append(rules, r)
	}
	if err := rows.Err(); err != nil {
		return "", nil, false, false, "", err
	}

	lowerSender := strings.ToLower(sender)

	for _, rule := range rules {
		// Condition 1: match_sender
		if rule.matchSender != nil && strings.TrimSpace(*rule.matchSender) != "" {
			if !strings.Contains(lowerSender, strings.ToLower(strings.TrimSpace(*rule.matchSender))) {
				continue
			}
		}

		// Condition 2: match_recipient
		if rule.matchRecipient != nil && strings.TrimSpace(*rule.matchRecipient) != "" {
			target := strings.ToLower(strings.TrimSpace(*rule.matchRecipient))
			matched := false
			for _, rec := range recipients {
				if strings.Contains(strings.ToLower(rec), target) {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}

		// Condition 3: match_has_attachments
		if rule.matchHasAttachments != nil {
			if *rule.matchHasAttachments != hasAttachments {
				continue
			}
		}

		// Condition 4: match_min_size_bytes
		if rule.matchMinSizeBytes != nil {
			if sizeBytes < *rule.matchMinSizeBytes {
				continue
			}
		}

		// All non-null conditions matched! First matching rule wins.
		switch rule.actionType {
		case "move":
			if rule.actionFolder != nil && *rule.actionFolder != "" {
				folderOverride = *rule.actionFolder
			}
		case "label":
			if rule.actionLabelID != nil && *rule.actionLabelID != "" {
				labelIDs = []string{*rule.actionLabelID}
			}
		case "mark_read":
			markRead = true
		case "delete":
			deleteMessage = true
			folderOverride = "trash"
		case "category":
			if rule.actionCategory != nil && *rule.actionCategory != "" {
				categoryOverride = *rule.actionCategory
			} else if rule.actionFolder != nil && *rule.actionFolder != "" {
				categoryOverride = *rule.actionFolder
			}
		}

		if rule.actionCategory != nil && *rule.actionCategory != "" && categoryOverride == "" {
			categoryOverride = *rule.actionCategory
		}

		return folderOverride, labelIDs, markRead, deleteMessage, categoryOverride, nil
	}

	return "", nil, false, false, "", nil
}
