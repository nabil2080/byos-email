package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// helper to create a valid synthetic backup bundle
func createTestBackupBundle(t *testing.T, dir string) *Manifest {
	t.Helper()

	orgID := "11111111-1111-1111-1111-111111111111"
	userID := "22222222-2222-2222-2222-222222222222"
	domainID := "33333333-3333-3333-3333-333333333333"
	rsID := "44444444-4444-4444-4444-444444444444"
	mailboxID := "55555555-5555-5555-5555-555555555555"
	storageID := "66666666-6666-6666-6666-666666666666"

	tablesData := map[string][]map[string]any{
		"organizations": {
			{
				"id":              orgID,
				"name":            "Acme Corp",
				"org_recovery_pk": hex.EncodeToString([]byte("test_org_recovery_pk_32_bytes_len")),
				"created_at":      time.Now().UTC().Format(time.RFC3339Nano),
			},
		},
		"users": {
			{
				"id":            userID,
				"org_id":        orgID,
				"email":         "alice@acme.corp",
				"display_name":  "Alice Admin",
				"password_hash": "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
				"is_active":     true,
			},
		},
		"domains": {
			{
				"id":          domainID,
				"org_id":      orgID,
				"name":        "acme.corp",
				"is_verified": true,
			},
		},
		"root_secrets": {
			{
				"id":                  rsID,
				"version":             1,
				"root_secret_wrapped": hex.EncodeToString([]byte("test_wrapped_root_secret_key")),
			},
		},
		"mailboxes": {
			{
				"id":                 mailboxID,
				"org_id":             orgID,
				"user_id":            userID,
				"domain_id":          domainID,
				"local_part":         "alice",
				"mode":               "org_managed",
				"root_secret_id":     rsID,
				"mailbox_sk_wrapped": hex.EncodeToString([]byte("test_mailbox_sk_wrapped")),
				"mailbox_sk_version": 1,
				"mailbox_pk":         hex.EncodeToString([]byte("test_mailbox_pk")),
				"is_active":          true,
			},
		},
		"storage_connections": {
			{
				"id":              storageID,
				"org_id":          orgID,
				"provider_type":   "s3_compatible",
				"bucket_name":     "byos-mail-storage",
				"endpoint":        "http://minio:9000",
				"credentials_enc": hex.EncodeToString([]byte("test_enc_creds")),
				"is_active":       true,
			},
		},
		"mailbox_storage": {
			{
				"id":                    "77777777-7777-7777-7777-777777777777",
				"mailbox_id":            mailboxID,
				"storage_connection_id": storageID,
				"object_prefix":         "mb_alice/",
				"status":                "active",
			},
		},
	}

	manifest := &Manifest{
		Version:      1,
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
		BYOSVersion:  "v1.0",
		Mode:         "metadata_only",
		Tables:       []TableEntry{},
		TotalRecords: 0,
		TotalTables:  len(tablesData),
		Compliance: ComplianceReport{
			Section23NoPlaintextArchives: true,
			CryptoMetadataPreserved:      true,
			DisasterRecoveryReady:        true,
			ProhibitedPlaintextStores:    []string{"customer_object_storage"},
		},
	}

	var tableChecksums []string

	for name, rows := range tablesData {
		dataBytes, err := json.MarshalIndent(rows, "", "  ")
		if err != nil {
			t.Fatalf("failed to marshal rows for table %s: %v", name, err)
		}
		fileName := name + ".json"
		filePath := filepath.Join(dir, fileName)
		if err := os.WriteFile(filePath, dataBytes, 0644); err != nil {
			t.Fatalf("failed to write %s: %v", filePath, err)
		}

		hash := sha256.Sum256(dataBytes)
		hashHex := hex.EncodeToString(hash[:])
		tableChecksums = append(tableChecksums, hashHex)

		manifest.Tables = append(manifest.Tables, TableEntry{
			Name:      name,
			File:      fileName,
			Records:   len(rows),
			SHA256:    hashHex,
			SizeBytes: int64(len(dataBytes)),
		})
		manifest.TotalRecords += len(rows)
	}

	sort.Strings(tableChecksums)
	bundleHasher := sha256.New()
	for _, chk := range tableChecksums {
		bundleHasher.Write([]byte(chk))
	}
	manifest.BundleSHA256 = hex.EncodeToString(bundleHasher.Sum(nil))

	mBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		t.Fatalf("failed to marshal manifest: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), mBytes, 0644); err != nil {
		t.Fatalf("failed to write manifest: %v", err)
	}

	return manifest
}

func TestVerify_ValidBundle(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("RunVerify returned unexpected error: %v", err)
	}

	if !res.Passed {
		t.Fatalf("expected verification to pass, but failed with: %v", res.Errors)
	}
	if res.ValidatedTables != 7 {
		t.Errorf("expected 7 tables validated, got %d", res.ValidatedTables)
	}
	if res.ValidatedRecords != 7 {
		t.Errorf("expected 7 records validated, got %d", res.ValidatedRecords)
	}
}

func TestVerify_TamperDetection(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	// Tamper with organizations.json
	orgFilePath := filepath.Join(tempDir, "organizations.json")
	data, err := os.ReadFile(orgFilePath)
	if err != nil {
		t.Fatalf("failed to read %s: %v", orgFilePath, err)
	}

	// Flip/append a character
	tampered := append(data, []byte(" ")...)
	if err := os.WriteFile(orgFilePath, tampered, 0644); err != nil {
		t.Fatalf("failed to overwrite %s: %v", orgFilePath, err)
	}

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("RunVerify returned error: %v", err)
	}

	if res.Passed {
		t.Fatal("expected verification to FAIL on tampered file, but it passed")
	}

	foundSHAError := false
	for _, e := range res.Errors {
		if len(e) > 0 {
			foundSHAError = true
			break
		}
	}
	if !foundSHAError {
		t.Errorf("expected SHA mismatch error in %v", res.Errors)
	}
}

func TestVerify_CryptoMetadataValidation(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	// Overwrite mailboxes.json with empty mailbox_pk
	mbFilePath := filepath.Join(tempDir, "mailboxes.json")
	invalidMailboxes := []map[string]any{
		{
			"id":                 "55555555-5555-5555-5555-555555555555",
			"org_id":             "11111111-1111-1111-1111-111111111111",
			"user_id":            "22222222-2222-2222-2222-222222222222",
			"domain_id":          "33333333-3333-3333-3333-333333333333",
			"local_part":         "alice",
			"mode":               "org_managed",
			"root_secret_id":     "44444444-4444-4444-4444-444444444444",
			"mailbox_sk_wrapped": "1234",
			"mailbox_pk":         "", // Empty PK - MUST FAIL!
		},
	}
	mbBytes, _ := json.MarshalIndent(invalidMailboxes, "", "  ")
	_ = os.WriteFile(mbFilePath, mbBytes, 0644)

	// Update manifest with new sha256 to isolate crypto validation
	manifestPath := filepath.Join(tempDir, "manifest.json")
	var m Manifest
	mData, _ := os.ReadFile(manifestPath)
	_ = json.Unmarshal(mData, &m)
	h := sha256.Sum256(mbBytes)
	for i := range m.Tables {
		if m.Tables[i].Name == "mailboxes" {
			m.Tables[i].SHA256 = hex.EncodeToString(h[:])
			m.Tables[i].SizeBytes = int64(len(mbBytes))
		}
	}
	m.BundleSHA256 = "" // skip bundle aggregate check for this isolated test
	mUpdated, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(manifestPath, mUpdated, 0644)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("RunVerify error: %v", err)
	}

	if res.Passed {
		t.Fatal("expected verification to FAIL due to empty mailbox_pk")
	}
}

func TestVerify_RelationalIntegrity(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	// Overwrite users.json with dangling org_id
	userFilePath := filepath.Join(tempDir, "users.json")
	invalidUsers := []map[string]any{
		{
			"id":     "22222222-2222-2222-2222-222222222222",
			"org_id": "99999999-9999-9999-9999-999999999999", // Nonexistent Org!
			"email":  "dangling@nowhere.corp",
		},
	}
	uBytes, _ := json.MarshalIndent(invalidUsers, "", "  ")
	_ = os.WriteFile(userFilePath, uBytes, 0644)

	// Update manifest
	manifestPath := filepath.Join(tempDir, "manifest.json")
	var m Manifest
	mData, _ := os.ReadFile(manifestPath)
	_ = json.Unmarshal(mData, &m)
	h := sha256.Sum256(uBytes)
	for i := range m.Tables {
		if m.Tables[i].Name == "users" {
			m.Tables[i].SHA256 = hex.EncodeToString(h[:])
			m.Tables[i].SizeBytes = int64(len(uBytes))
		}
	}
	m.BundleSHA256 = ""
	mUpdated, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(manifestPath, mUpdated, 0644)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("RunVerify error: %v", err)
	}

	if res.Passed {
		t.Fatal("expected verification to FAIL due to dangling FK org_id")
	}
}

func TestSection23_ComplianceFlags(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	manifestPath := filepath.Join(tempDir, "manifest.json")
	var m Manifest
	mData, _ := os.ReadFile(manifestPath)
	_ = json.Unmarshal(mData, &m)

	// Violate Section 23
	m.Compliance.Section23NoPlaintextArchives = false
	mUpdated, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(manifestPath, mUpdated, 0644)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("RunVerify error: %v", err)
	}

	if res.Passed {
		t.Fatal("expected verification to FAIL on Section 23 non-compliance flag")
	}
}

func TestInspect_Summary(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	report, err := RunInspect(tempDir)
	if err != nil {
		t.Fatalf("RunInspect returned error: %v", err)
	}

	if !report.IntegrityValid {
		t.Errorf("expected report to indicate valid integrity")
	}
	if report.OrganizationsCount != 1 {
		t.Errorf("expected 1 organization, got %d", report.OrganizationsCount)
	}
	if report.UsersCount != 1 {
		t.Errorf("expected 1 user, got %d", report.UsersCount)
	}
	if report.MailboxesCount != 1 {
		t.Errorf("expected 1 mailbox, got %d", report.MailboxesCount)
	}
	if report.StorageConnCount != 1 {
		t.Errorf("expected 1 storage connection, got %d", report.StorageConnCount)
	}
}

func TestBuildInsertParams(t *testing.T) {
	row := map[string]any{
		"id":              "11111111-1111-1111-1111-111111111111",
		"name":            "Acme Corp",
		"org_recovery_pk": "deadbeef01020304",
	}

	cols, vals, placeholders := buildInsertParams("organizations", row)
	if len(cols) != 3 || len(vals) != 3 || len(placeholders) != 3 {
		t.Fatalf("unexpected param counts: cols=%d, vals=%d, placeholders=%d", len(cols), len(vals), len(placeholders))
	}

	// Verify bytea decoding of org_recovery_pk
	for i, c := range cols {
		if c == "org_recovery_pk" {
			byteVal, ok := vals[i].([]byte)
			if !ok {
				t.Fatalf("expected []byte for org_recovery_pk, got %T", vals[i])
			}
			if hex.EncodeToString(byteVal) != "deadbeef01020304" {
				t.Errorf("expected decoded bytes deadbeef01020304, got %x", byteVal)
			}
		}
	}
}

func TestVerify_MissingManifest(t *testing.T) {
	emptyDir := t.TempDir()
	_, err := RunVerify(emptyDir)
	if err == nil {
		t.Fatal("expected error when verifying empty dir without manifest")
	}
}

func TestVerify_MissingTableFile(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	// Remove one table file
	orgFilePath := filepath.Join(tempDir, "organizations.json")
	_ = os.Remove(orgFilePath)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Passed {
		t.Fatal("expected verification to FAIL when table file is deleted")
	}
}

func TestVerify_InvalidJSON(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	orgFilePath := filepath.Join(tempDir, "organizations.json")
	_ = os.WriteFile(orgFilePath, []byte("{invalid json corrupt]"), 0644)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Passed {
		t.Fatal("expected verification to FAIL on corrupt JSON")
	}
}

func TestVerify_BundleAggregateMismatch(t *testing.T) {
	tempDir := t.TempDir()
	createTestBackupBundle(t, tempDir)

	manifestPath := filepath.Join(tempDir, "manifest.json")
	var m Manifest
	mData, _ := os.ReadFile(manifestPath)
	_ = json.Unmarshal(mData, &m)

	m.BundleSHA256 = "0000000000000000000000000000000000000000000000000000000000000000"
	mUpdated, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(manifestPath, mUpdated, 0644)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Passed {
		t.Fatal("expected verification to FAIL on bundle aggregate mismatch")
	}
}

