package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ByteaColumns defines columns known to store raw binary/bytea data that were hex-encoded during backup.
var ByteaColumns = map[string]map[string]bool{
	"organizations":           {"org_recovery_pk": true},
	"domains":                 {"dkim_private_key_enc": true},
	"root_secrets":            {"root_secret_wrapped": true},
	"mailboxes":               {"mailbox_sk_wrapped": true, "mailbox_pk": true},
	"devices":                 {"device_pk": true},
	"device_mailbox_access":   {"wrapped_root_secret": true},
	"org_recovery_principals": {"kdf_salt": true, "org_recovery_sk_encrypted": true, "org_recovery_pk": true},
	"storage_connections":     {"credentials_enc": true},
	"message_metadata":        {"delivery_identity": true, "content_key_hpke_wrapped": true, "encryption_iv": true, "bundle_hash": true},
	"search_tokens":           {"token_hash": true},
	"search_index":            {"token_hash": true},
	"scheduled_messages":      {"encrypted_message": true, "send_token_hpke_wrapped": true, "send_token_hash": true},
	"outbound_queue":          {"encrypted_message": true, "send_token_hpke_wrapped": true},
	"drafts":                  {"encrypted_envelope": true},
	"users":                   {"recovery_auth_pk": true},
}

// RunRestore verifies the backup bundle first, then connects to PostgreSQL and
// restores records transactionally in dependency order.
func RunRestore(ctx context.Context, backupDir string, dbURL string, dryRun bool, cleanExisting bool) (*RestoreResult, error) {
	start := time.Now()

	// 1. Mandatory Pre-Flight Verification
	verifyResult, err := RunVerify(backupDir)
	if err != nil {
		return nil, fmt.Errorf("backup pre-verification failed: %w", err)
	}
	if !verifyResult.Passed {
		return nil, fmt.Errorf("backup verification failed with %d error(s): %s", len(verifyResult.Errors), strings.Join(verifyResult.Errors, "; "))
	}

	// 2. Mandatory Pre-Flight Safety & Zero-Knowledge Verification
	// Refuses restore if backup contains non-Private modes or legacy escrow key material.
	// Executes before connecting to database or performing any destructive actions (clean/truncate).
	if err := validateRestoreSafety(backupDir); err != nil {
		return nil, err
	}

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	defer conn.Close(ctx)

	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin restore transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	result := &RestoreResult{
		Success:     false,
		DryRun:      dryRun,
		TableCounts: make(map[string]int),
		Warnings:    []string{},
	}

	if cleanExisting {
		// Clean tables in reverse dependency order or cascade for existing tables
		for i := len(DefaultTables) - 1; i >= 0; i-- {
			table := DefaultTables[i]
			var exists bool
			_ = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)`, table).Scan(&exists)
			if exists {
				_, _ = tx.Exec(ctx, fmt.Sprintf("TRUNCATE TABLE %s CASCADE", table))
			}
		}
	}

	for _, table := range DefaultTables {
		filePath := filepath.Join(backupDir, fmt.Sprintf("%s.json", table))
		dataBytes, err := os.ReadFile(filePath)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read table backup file %s: %w", filePath, err)
		}

		var rows []map[string]any
		if err := json.Unmarshal(dataBytes, &rows); err != nil {
			return nil, fmt.Errorf("parse table %s JSON: %w", table, err)
		}

		if len(rows) == 0 {
			result.TableCounts[table] = 0
			result.RestoredTables++
			continue
		}

		// Check if table exists in destination DB
		var exists bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM information_schema.tables 
				WHERE table_schema = 'public' AND table_name = $1
			)`, table).Scan(&exists)
		if err != nil {
			return nil, fmt.Errorf("check destination table %s: %w", table, err)
		}
		if !exists {
			fmt.Printf("Notice: destination table %q does not exist, skipping insert.\n", table)
			result.Warnings = append(result.Warnings, fmt.Sprintf("destination table %q does not exist, skipped", table))
			continue
		}

		// Fetch destination table columns to ensure compatibility across schema versions
		destCols := make(map[string]bool)
		colRows, err := tx.Query(ctx, `
			SELECT column_name 
			FROM information_schema.columns 
			WHERE table_schema = 'public' AND table_name = $1
		`, table)
		if err != nil {
			return nil, fmt.Errorf("query columns for destination table %s: %w", table, err)
		}
		for colRows.Next() {
			var colName string
			if err := colRows.Scan(&colName); err == nil {
				destCols[colName] = true
			}
		}
		colRows.Close()

		// Check which source columns are not in destination
		for col := range rows[0] {
			if !destCols[col] {
				result.Warnings = append(result.Warnings, fmt.Sprintf("omitted column %q from table %q (not present in destination schema)", col, table))
			}
		}

		for _, row := range rows {
			filteredRow := make(map[string]any, len(row))
			for col, val := range row {
				if destCols[col] {
					filteredRow[col] = val
				}
			}

			if table == "organizations" {
				// Prevent silently repopulating retired organization-recovery metadata into the current application schema.
				// Post-058 organizations strictly store NULL for org_recovery_pk.
				if _, hasCol := destCols["org_recovery_pk"]; hasCol {
					if origVal, hasKey := row["org_recovery_pk"]; hasKey && origVal != nil {
						if strVal, isStr := origVal.(string); isStr && strings.TrimSpace(strVal) != "" {
							result.Warnings = append(result.Warnings, fmt.Sprintf("cleared retired org_recovery_pk for organization %v to prevent repopulating retired metadata", filteredRow["id"]))
						}
					}
					filteredRow["org_recovery_pk"] = nil
				}
			}

			cols, vals, placeholders := buildInsertParams(table, filteredRow)
			if len(cols) == 0 {
				continue
			}

			query := fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT DO NOTHING",
				table, strings.Join(cols, ", "), strings.Join(placeholders, ", "))

			if _, err := tx.Exec(ctx, query, vals...); err != nil {
				return nil, fmt.Errorf("insert into %s: %w", table, err)
			}
		}

		result.TableCounts[table] = len(rows)
		result.RestoredRecords += len(rows)
		result.RestoredTables++
	}

	// 2. Synchronize sequences
	_ = tx.QueryRow(ctx, `
		SELECT setval('mailbox_message_seq', COALESCE((SELECT MAX(message_seq) FROM message_metadata), 1))
	`).Scan(new(int64))

	if dryRun {
		_ = tx.Rollback(ctx)
		result.Success = true
		result.Duration = time.Since(start).String()
		return result, nil
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit restore transaction: %w", err)
	}

	result.Success = true
	result.Duration = time.Since(start).String()
	return result, nil
}

func buildInsertParams(table string, row map[string]any) ([]string, []any, []string) {
	cols := make([]string, 0, len(row))
	vals := make([]any, 0, len(row))
	placeholders := make([]string, 0, len(row))

	byteaCols := ByteaColumns[table]

	idx := 1
	for col, rawVal := range row {
		cols = append(cols, col)
		placeholders = append(placeholders, fmt.Sprintf("$%d", idx))
		idx++

		if byteaCols != nil && byteaCols[col] {
			if strVal, ok := rawVal.(string); ok && strVal != "" {
				// Strip leading \x if present
				cleanHex := strings.TrimPrefix(strVal, `\x`)
				if decoded, err := hex.DecodeString(cleanHex); err == nil {
					vals = append(vals, decoded)
					continue
				}
			}
		}

		vals = append(vals, rawVal)
	}

	return cols, vals, placeholders
}

func validateRestoreSafety(backupDir string) error {
	// 1. Check mailboxes.json: refuse if non-Private mode or non-null wrapped_sk_org
	mbPath := filepath.Join(backupDir, "mailboxes.json")
	if mbBytes, err := os.ReadFile(mbPath); err == nil {
		var rows []map[string]any
		if err := json.Unmarshal(mbBytes, &rows); err == nil {
			var nonPrivateIDs []string
			var escrowIDs []string
			for _, row := range rows {
				id, _ := row["id"].(string)
				if id == "" {
					id = "unknown"
				}

				if mode, ok := row["mode"].(string); ok && mode != "private" {
					nonPrivateIDs = append(nonPrivateIDs, id)
				}

				if wsk, ok := row["wrapped_sk_org"]; ok && wsk != nil {
					if strWsk, isStr := wsk.(string); isStr && strings.TrimSpace(strWsk) != "" {
						escrowIDs = append(escrowIDs, id)
					}
				}
			}

			if len(nonPrivateIDs) > 0 {
				return fmt.Errorf("restore rejected: table 'mailboxes' contains non-Private mode for records: %s", strings.Join(nonPrivateIDs, ", "))
			}
			if len(escrowIDs) > 0 {
				return fmt.Errorf("restore rejected: table 'mailboxes' contains legacy wrapped_sk_org for records: %s", strings.Join(escrowIDs, ", "))
			}
		}
	}

	// 2. Check account_invitations.json: refuse if non-Private mode or legacy escrow keys exist
	invPath := filepath.Join(backupDir, "account_invitations.json")
	if invBytes, err := os.ReadFile(invPath); err == nil {
		var rows []map[string]any
		if err := json.Unmarshal(invBytes, &rows); err == nil {
			var nonPrivateIDs []string
			var escrowIDs []string
			for _, row := range rows {
				id, _ := row["id"].(string)
				if id == "" {
					id = "unknown"
				}

				if pmode, ok := row["privacy_mode"].(string); ok && pmode != "private" {
					nonPrivateIDs = append(nonPrivateIDs, id)
				}

				hasEscrow := false
				if wsk, ok := row["wrapped_sk_org"]; ok && wsk != nil {
					if strWsk, isStr := wsk.(string); isStr && strings.TrimSpace(strWsk) != "" {
						hasEscrow = true
					}
				}
				if twsk, ok := row["temp_wrapped_sk"]; ok && twsk != nil {
					if strTwsk, isStr := twsk.(string); isStr && strings.TrimSpace(strTwsk) != "" {
						hasEscrow = true
					}
				}

				if hasEscrow {
					escrowIDs = append(escrowIDs, id)
				}
			}

			if len(nonPrivateIDs) > 0 {
				return fmt.Errorf("restore rejected: table 'account_invitations' contains non-Private privacy_mode for records: %s", strings.Join(nonPrivateIDs, ", "))
			}
			if len(escrowIDs) > 0 {
				return fmt.Errorf("restore rejected: table 'account_invitations' contains legacy escrow keys (wrapped_sk_org or temp_wrapped_sk) for records: %s", strings.Join(escrowIDs, ", "))
			}
		}
	}

	return nil
}
