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
		var tid string
		err := tx.QueryRow(ctx, `
			SELECT thread_id::text FROM message_metadata
			WHERE mailbox_id = $1 AND message_id = $2
			ORDER BY received_at ASC
			LIMIT 1
		`, mailboxID, normalizeMsgID(inReplyTo)).Scan(&tid)
		if err == nil {
			return tid, nil
		}
		if err != pgx.ErrNoRows {
			return "", err
		}
	}

	// Fall back to References (last existing ID wins)
	if references != "" {
		ids := parseReferences(references)
		for i := len(ids) - 1; i >= 0; i-- {
			var tid string
			err := tx.QueryRow(ctx, `
				SELECT thread_id::text FROM message_metadata
				WHERE mailbox_id = $1 AND message_id = $2
				ORDER BY received_at ASC
				LIMIT 1
			`, mailboxID, ids[i]).Scan(&tid)
			if err == nil {
				return tid, nil
			}
			if err != pgx.ErrNoRows {
				return "", err
			}
		}
	}

	return "", nil
}

// normalizeMsgID strips angle brackets, whitespace, and comments.
func normalizeMsgID(s string) string {
	s = strings.TrimSpace(s)
	// Drop anything after whitespace (handles multiple IDs jammed together)
	if idx := strings.IndexAny(s, " \t"); idx != -1 {
		s = s[:idx]
	}
	s = strings.TrimPrefix(s, "<")
	s = strings.TrimSuffix(s, ">")
	return s
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
