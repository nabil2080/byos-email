package main

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ComputeThreadID determines the thread_id for a new message.
//
// Rules:
//   1. If In-Reply-To references an existing message in this mailbox, 
//      inherit that message's thread_id.
//   2. Otherwise if References is present, look up the latest reference ID 
//      that exists in the mailbox and inherit its thread_id.
//   3. Otherwise return "" so the DB default generates a fresh UUID.
//
// Lookup is scoped to mailbox_id — cross-mailbox threading is not 
// supported in V1.
//
// PRIVACY: storing message_id, in_reply_to, and thread_id discloses the 
// reply graph. See roadmap Section 16.
func ComputeThreadID(
	ctx context.Context,
	tx pgx.Tx,
	mailboxID string,
	inReplyTo string,
	references string,
) (string, error) {
	// Try In-Reply-To first
	if inReplyTo != "" {
		cleanedInReplyTo := cleanMsgID(inReplyTo)
		if cleanedInReplyTo != "" {
			tid, err := resolveThreadMatch(ctx, tx, mailboxID, cleanedInReplyTo)
			if err != nil {
				return "", err
			}
			if tid != "" {
				return tid, nil
			}
		}
	}

	// Fall back to References (last existing ID wins)
	if references != "" {
		ids := parseReferences(references)
		for i := len(ids) - 1; i >= 0; i-- {
			tid, err := resolveThreadMatch(ctx, tx, mailboxID, ids[i])
			if err != nil {
				return "", err
			}
			if tid != "" {
				return tid, nil
			}
		}
	}

	return "", nil
}

// resolveThreadMatch queries message_metadata for matching thread IDs.
// Exact case match takes unconditional priority per RFC 5322 §3.6.4.
// If no exact match exists:
//   - If all case-variant candidates belong to the same thread (len == 1),
//     that thread_id is safely inherited (backward-compatible with pre-C6.1 lowercased
//     metadata records and MTAs that case-fold reply headers).
//   - If case-variant candidates belong to multiple distinct threads (len > 1),
//     the match is considered ambiguous; merging is refused to preserve conversation
//     isolation, returning "" (fresh thread generation).
func resolveThreadMatch(ctx context.Context, tx pgx.Tx, mailboxID, targetMsgID string) (string, error) {
	rows, err := tx.Query(ctx, `
		SELECT thread_id::text,
		       (CASE
		           WHEN message_id = $2 THEN 0
		           WHEN split_part(message_id, '@', 1) = split_part($2, '@', 1) AND lower(split_part(message_id, '@', 2)) = lower(split_part($2, '@', 2)) THEN 1
		           ELSE 2
		        END) AS match_tier
		FROM message_metadata
		WHERE mailbox_id = $1 AND (message_id = $2 OR lower(message_id) = lower($2))
		ORDER BY match_tier ASC, received_at ASC
	`, mailboxID, targetMsgID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var rfcExactThreadID string
	hasRfcExact := false
	tier2Candidates := make(map[string]struct{})

	for rows.Next() {
		var tid string
		var matchTier int
		if err := rows.Scan(&tid, &matchTier); err != nil {
			return "", err
		}
		if matchTier <= 1 {
			// Tier 0 (exact string) or Tier 1 (exact id-left + case-insensitive domain per RFC 5322 §3.6.4)
			if !hasRfcExact {
				rfcExactThreadID = tid
				hasRfcExact = true
			}
		} else {
			tier2Candidates[tid] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	if hasRfcExact {
		return rfcExactThreadID, nil
	}

	if len(tier2Candidates) == 1 {
		for tid := range tier2Candidates {
			return tid, nil
		}
	}

	// Ambiguous (> 1) or none (== 0)
	return "", nil
}

// cleanMsgID strips angle brackets, surrounding whitespace, and comments,
// while strictly preserving the original casing of id-left and id-right (RFC 5322 §3.6.4).
func cleanMsgID(s string) string {
	s = strings.TrimSpace(s)
	if start := strings.Index(s, "<"); start != -1 {
		if end := strings.Index(s[start:], ">"); end != -1 {
			s = s[start+1 : start+end]
		} else {
			s = s[start+1:]
		}
	} else {
		// Drop anything after whitespace (handles multiple IDs jammed together or trailing comments)
		if idx := strings.IndexAny(s, " \t\r\n"); idx != -1 {
			s = s[:idx]
		}
	}
	return strings.TrimSpace(s)
}

// normalizeMsgID normalizes message IDs while preserving original case.
func normalizeMsgID(s string) string {
	return cleanMsgID(s)
}

// parseReferences extracts individual message IDs from a References header.
func parseReferences(refs string) []string {
	var out []string
	for _, tok := range strings.Fields(refs) {
		tok = normalizeMsgID(tok)
		if tok != "" {
			out = append(out, tok)
		}
	}
	return out
}
