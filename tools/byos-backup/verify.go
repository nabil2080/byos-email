package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// RunVerify checks manifest integrity, recomputes SHA-256 checksums of all
// table files, validates cryptographic metadata invariants, and verifies
// relational foreign key consistency.
func RunVerify(backupDir string) (*VerifyResult, error) {
	manifestPath := filepath.Join(backupDir, "manifest.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("read manifest from %s: %w", manifestPath, err)
	}

	var manifest Manifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest JSON: %w", err)
	}

	result := &VerifyResult{
		Passed:       true,
		Manifest:     &manifest,
		TableDetails: make(map[string]TableVerifyStatus),
		Errors:       []string{},
		Warnings:     []string{},
	}

	// 1. Verify Section 23 compliance flags
	if !manifest.Compliance.Section23NoPlaintextArchives {
		result.Errors = append(result.Errors, "Section 23 compliance violation: backup indicates plaintext customer mailbox archives")
		result.Passed = false
	}
	if !manifest.Compliance.CryptoMetadataPreserved {
		result.Errors = append(result.Errors, "Section 23 compliance violation: cryptographic metadata was not preserved")
		result.Passed = false
	}

	loadedTables := make(map[string][]map[string]any)
	var computedChecksums []string

	// 2. Validate individual table files
	for _, entry := range manifest.Tables {
		status := TableVerifyStatus{
			Name:          entry.Name,
			Records:       entry.Records,
			ChecksumValid: false,
			SchemaValid:   false,
			CryptoValid:   true,
		}

		tableFilePath := filepath.Join(backupDir, entry.File)
		tableDataBytes, err := os.ReadFile(tableFilePath)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("table %s file %q not readable: %v", entry.Name, entry.File, err))
			result.Passed = false
			result.TableDetails[entry.Name] = status
			continue
		}

		// Recompute SHA-256
		computedHash := sha256.Sum256(tableDataBytes)
		computedHashHex := hex.EncodeToString(computedHash[:])
		computedChecksums = append(computedChecksums, computedHashHex)

		if computedHashHex != entry.SHA256 {
			result.Errors = append(result.Errors, fmt.Sprintf("table %s SHA-256 mismatch: expected %s, computed %s", entry.Name, entry.SHA256, computedHashHex))
			result.Passed = false
		} else {
			status.ChecksumValid = true
		}

		var rows []map[string]any
		if err := json.Unmarshal(tableDataBytes, &rows); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("table %s contains invalid JSON: %v", entry.Name, err))
			result.Passed = false
			result.TableDetails[entry.Name] = status
			continue
		}

		if len(rows) != entry.Records {
			result.Errors = append(result.Errors, fmt.Sprintf("table %s record count mismatch: manifest says %d, found %d", entry.Name, entry.Records, len(rows)))
			result.Passed = false
		} else {
			status.SchemaValid = true
		}

		loadedTables[entry.Name] = rows

		// Validate Cryptographic Metadata
		cryptoErrors := validateCryptoMetadata(entry.Name, rows)
		if len(cryptoErrors) > 0 {
			for _, ce := range cryptoErrors {
				result.Errors = append(result.Errors, fmt.Sprintf("[%s crypto] %s", entry.Name, ce))
			}
			status.CryptoValid = false
			result.Passed = false
		}

		result.TableDetails[entry.Name] = status
		result.ValidatedTables++
		result.ValidatedRecords += len(rows)
	}

	// 3. Verify bundle aggregate SHA-256
	sort.Strings(computedChecksums)
	bundleHasher := sha256.New()
	for _, chk := range computedChecksums {
		bundleHasher.Write([]byte(chk))
	}
	computedBundleHex := hex.EncodeToString(bundleHasher.Sum(nil))

	if manifest.BundleSHA256 != "" && computedBundleHex != manifest.BundleSHA256 {
		result.Errors = append(result.Errors, fmt.Sprintf("bundle aggregate SHA-256 mismatch: expected %s, computed %s", manifest.BundleSHA256, computedBundleHex))
		result.Passed = false
	}

	// 4. Validate In-Memory Relational Foreign Key Integrity
	relErrors := validateRelationalIntegrity(loadedTables)
	if len(relErrors) > 0 {
		for _, re := range relErrors {
			result.Errors = append(result.Errors, fmt.Sprintf("[FK integrity] %s", re))
		}
		result.Passed = false
	}

	return result, nil
}

func validateCryptoMetadata(table string, rows []map[string]any) []string {
	var errs []string
	for idx, row := range rows {
		switch table {
		case "organizations":
			if val, ok := row["org_recovery_pk"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required org_recovery_pk", idx))
			}
		case "mailboxes":
			if val, ok := row["mailbox_pk"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required mailbox_pk", idx))
			}
			if val, ok := row["mailbox_sk_wrapped"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required mailbox_sk_wrapped", idx))
			}
		case "root_secrets":
			if val, ok := row["root_secret_wrapped"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required root_secret_wrapped", idx))
			}
		case "devices":
			if val, ok := row["device_pk"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required device_pk", idx))
			}
		case "device_mailbox_access":
			if val, ok := row["wrapped_root_secret"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required wrapped_root_secret", idx))
			}
		case "org_recovery_principals":
			if val, ok := row["org_recovery_pk"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required org_recovery_pk", idx))
			}
			if val, ok := row["org_recovery_sk_encrypted"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required org_recovery_sk_encrypted", idx))
			}
		case "message_metadata":
			if val, ok := row["content_key_hpke_wrapped"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required content_key_hpke_wrapped", idx))
			}
			if val, ok := row["delivery_identity"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required delivery_identity", idx))
			}
			if val, ok := row["encryption_iv"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required encryption_iv", idx))
			}
			if val, ok := row["bundle_hash"].(string); !ok || val == "" {
				errs = append(errs, fmt.Sprintf("row %d missing required bundle_hash", idx))
			}
		}
	}
	return errs
}

func validateRelationalIntegrity(tables map[string][]map[string]any) []string {
	var errs []string

	// Helper to extract set of IDs
	idSet := func(tableName string) map[string]bool {
		set := make(map[string]bool)
		for _, row := range tables[tableName] {
			if id, ok := row["id"].(string); ok && id != "" {
				set[id] = true
			}
		}
		return set
	}

	orgIDs := idSet("organizations")
	userIDs := idSet("users")
	domainIDs := idSet("domains")
	rootSecretIDs := idSet("root_secrets")
	mailboxIDs := idSet("mailboxes")
	storageIDs := idSet("storage_connections")
	deviceIDs := idSet("devices")

	if len(tables["users"]) > 0 && len(orgIDs) > 0 {
		for idx, row := range tables["users"] {
			if orgID, ok := row["org_id"].(string); ok && orgID != "" && !orgIDs[orgID] {
				errs = append(errs, fmt.Sprintf("users[%d] references non-existent org_id %s", idx, orgID))
			}
		}
	}

	if len(tables["domains"]) > 0 && len(orgIDs) > 0 {
		for idx, row := range tables["domains"] {
			if orgID, ok := row["org_id"].(string); ok && orgID != "" && !orgIDs[orgID] {
				errs = append(errs, fmt.Sprintf("domains[%d] references non-existent org_id %s", idx, orgID))
			}
		}
	}

	if len(tables["mailboxes"]) > 0 {
		for idx, row := range tables["mailboxes"] {
			if len(orgIDs) > 0 {
				if orgID, ok := row["org_id"].(string); ok && orgID != "" && !orgIDs[orgID] {
					errs = append(errs, fmt.Sprintf("mailboxes[%d] references non-existent org_id %s", idx, orgID))
				}
			}
			if len(domainIDs) > 0 {
				if domainID, ok := row["domain_id"].(string); ok && domainID != "" && !domainIDs[domainID] {
					errs = append(errs, fmt.Sprintf("mailboxes[%d] references non-existent domain_id %s", idx, domainID))
				}
			}
			if len(rootSecretIDs) > 0 {
				if rsID, ok := row["root_secret_id"].(string); ok && rsID != "" && !rootSecretIDs[rsID] {
					errs = append(errs, fmt.Sprintf("mailboxes[%d] references non-existent root_secret_id %s", idx, rsID))
				}
			}
		}
	}

	if len(tables["mailbox_storage"]) > 0 {
		for idx, row := range tables["mailbox_storage"] {
			if len(mailboxIDs) > 0 {
				if mbID, ok := row["mailbox_id"].(string); ok && mbID != "" && !mailboxIDs[mbID] {
					errs = append(errs, fmt.Sprintf("mailbox_storage[%d] references non-existent mailbox_id %s", idx, mbID))
				}
			}
			if len(storageIDs) > 0 {
				if stID, ok := row["storage_connection_id"].(string); ok && stID != "" && !storageIDs[stID] {
					errs = append(errs, fmt.Sprintf("mailbox_storage[%d] references non-existent storage_connection_id %s", idx, stID))
				}
			}
		}
	}

	if len(tables["device_mailbox_access"]) > 0 {
		for idx, row := range tables["device_mailbox_access"] {
			if len(deviceIDs) > 0 {
				if devID, ok := row["device_id"].(string); ok && devID != "" && !deviceIDs[devID] {
					errs = append(errs, fmt.Sprintf("device_mailbox_access[%d] references non-existent device_id %s", idx, devID))
				}
			}
			if len(mailboxIDs) > 0 {
				if mbID, ok := row["mailbox_id"].(string); ok && mbID != "" && !mailboxIDs[mbID] {
					errs = append(errs, fmt.Sprintf("device_mailbox_access[%d] references non-existent mailbox_id %s", idx, mbID))
				}
			}
		}
	}

	if len(tables["org_recovery_principals"]) > 0 {
		for idx, row := range tables["org_recovery_principals"] {
			if len(userIDs) > 0 {
				if uID, ok := row["user_id"].(string); ok && uID != "" && !userIDs[uID] {
					errs = append(errs, fmt.Sprintf("org_recovery_principals[%d] references non-existent user_id %s", idx, uID))
				}
			}
			if len(orgIDs) > 0 {
				if orgID, ok := row["org_id"].(string); ok && orgID != "" && !orgIDs[orgID] {
					errs = append(errs, fmt.Sprintf("org_recovery_principals[%d] references non-existent org_id %s", idx, orgID))
				}
			}
		}
	}

	return errs
}
