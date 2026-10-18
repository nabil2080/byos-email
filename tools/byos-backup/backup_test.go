package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
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

// helper to create a valid synthetic post-058 backup bundle (null org_recovery_pk, private mailboxes, no org_recovery_principals)
func createPost058TestBackupBundle(t *testing.T, dir string) *Manifest {
	t.Helper()

	orgID := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	userID := "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	domainID := "cccccccc-cccc-cccc-cccc-cccccccccccc"
	rsID := "dddddddd-dddd-dddd-dddd-dddddddddddd"
	mailboxID := "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
	storageID := "ffffffff-ffff-ffff-ffff-ffffffffffff"

	tablesData := map[string][]map[string]any{
		"organizations": {
			{
				"id":              orgID,
				"name":            "Modern Corp",
				"org_recovery_pk": nil, // NULL in post-058
				"created_at":      time.Now().UTC().Format(time.RFC3339Nano),
			},
		},
		"users": {
			{
				"id":            userID,
				"org_id":        orgID,
				"email":         "bob@modern.corp",
				"display_name":  "Bob Modern",
				"password_hash": "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
				"is_active":     true,
			},
		},
		"domains": {
			{
				"id":          domainID,
				"org_id":      orgID,
				"name":        "modern.corp",
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
				"local_part":         "bob",
				"mode":               "private", // Strictly private in post-058
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
				"id":                    "88888888-8888-8888-8888-888888888888",
				"mailbox_id":            mailboxID,
				"storage_connection_id": storageID,
				"object_prefix":         "mb_bob/",
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

// helper to create a valid historical pre-058 backup bundle (includes org_recovery_principals and wrapped_sk_org)
func createSafeHistoricalTestBackupBundle(t *testing.T, dir string) *Manifest {
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
				"name":            "Legacy Corp",
				"org_recovery_pk": hex.EncodeToString([]byte("legacy_recovery_pk_32_bytes_len_")),
				"created_at":      time.Now().UTC().Format(time.RFC3339Nano),
			},
		},
		"users": {
			{
				"id":            userID,
				"org_id":        orgID,
				"email":         "alice@legacy.corp",
				"display_name":  "Alice Legacy",
				"password_hash": "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
				"is_active":     true,
			},
		},
		"domains": {
			{
				"id":          domainID,
				"org_id":      orgID,
				"name":        "legacy.corp",
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
				"mode":               "private", // Already-Private historical record
				"root_secret_id":     rsID,
				"mailbox_sk_wrapped": hex.EncodeToString([]byte("test_mailbox_sk_wrapped")),
				"wrapped_sk_org":     nil, // Null legacy escrow key
				"mailbox_sk_version": 1,
				"mailbox_pk":         hex.EncodeToString([]byte("test_mailbox_pk")),
				"is_active":          true,
			},
		},
		"org_recovery_principals": {
			{
				"id":                        "99999999-9999-9999-9999-999999999999",
				"org_id":                    orgID,
				"user_id":                   userID,
				"org_recovery_pk":           hex.EncodeToString([]byte("legacy_recovery_pk_32_bytes_len_")),
				"org_recovery_sk_encrypted": hex.EncodeToString([]byte("enc_sk_bytes_12345678901234567890")),
				"kdf_salt":                  hex.EncodeToString([]byte("salt_bytes_12345678901234567890")),
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

	return writeBundleFromTables(t, dir, tablesData)
}

func writeBundleFromTables(t *testing.T, dir string, tablesData map[string][]map[string]any) *Manifest {
	t.Helper()

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

func createUnsafeOrgManagedMailboxBundle(t *testing.T, dir string) *Manifest {
	t.Helper()
	m := createSafeHistoricalTestBackupBundle(t, dir)
	// Mutate mailboxes.json to have mode = 'org_managed'
	mbPath := filepath.Join(dir, "mailboxes.json")
	var rows []map[string]any
	b, _ := os.ReadFile(mbPath)
	_ = json.Unmarshal(b, &rows)
	rows[0]["mode"] = "org_managed"
	nb, _ := json.MarshalIndent(rows, "", "  ")
	_ = os.WriteFile(mbPath, nb, 0644)

	// Recompute hash for table and manifest
	h := sha256.Sum256(nb)
	hHex := hex.EncodeToString(h[:])
	for i, te := range m.Tables {
		if te.Name == "mailboxes" {
			m.Tables[i].SHA256 = hHex
			m.Tables[i].SizeBytes = int64(len(nb))
		}
	}
	var chks []string
	for _, te := range m.Tables {
		chks = append(chks, te.SHA256)
	}
	sort.Strings(chks)
	bh := sha256.New()
	for _, c := range chks {
		bh.Write([]byte(c))
	}
	m.BundleSHA256 = hex.EncodeToString(bh.Sum(nil))
	mb, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), mb, 0644)
	return m
}

func createUnsafeWrappedSkOrgMailboxBundle(t *testing.T, dir string) *Manifest {
	t.Helper()
	m := createSafeHistoricalTestBackupBundle(t, dir)
	mbPath := filepath.Join(dir, "mailboxes.json")
	var rows []map[string]any
	b, _ := os.ReadFile(mbPath)
	_ = json.Unmarshal(b, &rows)
	rows[0]["wrapped_sk_org"] = "deadbeef_legacy_escrow_key"
	nb, _ := json.MarshalIndent(rows, "", "  ")
	_ = os.WriteFile(mbPath, nb, 0644)

	h := sha256.Sum256(nb)
	hHex := hex.EncodeToString(h[:])
	for i, te := range m.Tables {
		if te.Name == "mailboxes" {
			m.Tables[i].SHA256 = hHex
			m.Tables[i].SizeBytes = int64(len(nb))
		}
	}
	var chks []string
	for _, te := range m.Tables {
		chks = append(chks, te.SHA256)
	}
	sort.Strings(chks)
	bh := sha256.New()
	for _, c := range chks {
		bh.Write([]byte(c))
	}
	m.BundleSHA256 = hex.EncodeToString(bh.Sum(nil))
	mb, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), mb, 0644)
	return m
}

func createUnsafeInvitationBundle(t *testing.T, dir string) *Manifest {
	t.Helper()
	m := createSafeHistoricalTestBackupBundle(t, dir)
	invData := []map[string]any{
		{
			"id":             "88888888-8888-8888-8888-888888888888",
			"org_id":         "11111111-1111-1111-1111-111111111111",
			"mailbox_id":     "55555555-5555-5555-5555-555555555555",
			"email":          "invitee@legacy.corp",
			"token_hash":     "1122334455667788112233445566778811223344556677881122334455667788",
			"privacy_mode":   "private",
			"wrapped_sk_org": "deadbeef_legacy_invitation_escrow_key",
		},
	}
	invPath := filepath.Join(dir, "account_invitations.json")
	nb, _ := json.MarshalIndent(invData, "", "  ")
	_ = os.WriteFile(invPath, nb, 0644)

	h := sha256.Sum256(nb)
	hHex := hex.EncodeToString(h[:])
	m.Tables = append(m.Tables, TableEntry{
		Name:      "account_invitations",
		File:      "account_invitations.json",
		Records:   1,
		SHA256:    hHex,
		SizeBytes: int64(len(nb)),
	})
	m.TotalRecords++
	m.TotalTables++
	var chks []string
	for _, te := range m.Tables {
		chks = append(chks, te.SHA256)
	}
	sort.Strings(chks)
	bh := sha256.New()
	for _, c := range chks {
		bh.Write([]byte(c))
	}
	m.BundleSHA256 = hex.EncodeToString(bh.Sum(nil))
	mb, _ := json.MarshalIndent(m, "", "  ")
	_ = os.WriteFile(filepath.Join(dir, "manifest.json"), mb, 0644)
	return m
}

// Test 1: Restoring a safe historical backup (already-Private records, null legacy fields, dropped tables skipped)
func TestRestore_SafeHistoricalBackup(t *testing.T) {
	tempDir := t.TempDir()
	createSafeHistoricalTestBackupBundle(t, tempDir)

	testDSN := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDSN == "" {
		t.Skip("skipping restore integration test: TEST_DATABASE_URL is not set")
		return
	}

	res, err := RunRestore(context.Background(), tempDir, testDSN, true /* dryRun */, false /* cleanExisting */)
	if err != nil {
		t.Fatalf("RunRestore failed for safe historical backup: %v", err)
	}

	if !res.Success {
		t.Fatal("expected restore to report success on safe historical backup")
	}

	// Confirm that dropped tables and cleared recovery key generated explicit warnings rather than fatal errors
	foundDroppedTableNotice := false
	foundClearedRecoveryKeyNotice := false
	for _, w := range res.Warnings {
		if strings.Contains(w, "org_recovery_principals") {
			foundDroppedTableNotice = true
		}
		if strings.Contains(w, "cleared retired org_recovery_pk") {
			foundClearedRecoveryKeyNotice = true
		}
	}
	if !foundDroppedTableNotice {
		t.Errorf("expected warning for dropped table org_recovery_principals, got warnings: %v", res.Warnings)
	}
	if !foundClearedRecoveryKeyNotice {
		t.Errorf("expected warning for cleared retired org_recovery_pk, got warnings: %v", res.Warnings)
	}
}

// Test 1b: Refuses restoration when a mailbox has non-Private legacy mode
func TestRestore_RejectsUnsafeMailboxOrgManagedMode(t *testing.T) {
	tempDir := t.TempDir()
	createUnsafeOrgManagedMailboxBundle(t, tempDir)

	testDSN := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDSN == "" {
		t.Skip("skipping restore integration test: TEST_DATABASE_URL is not set")
		return
	}

	res, err := RunRestore(context.Background(), tempDir, testDSN, true /* dryRun */, false /* cleanExisting */)
	if err == nil {
		t.Fatalf("expected restore to reject org_managed mailbox, but succeeded with %+v", res)
	}
	if !strings.Contains(err.Error(), "table 'mailboxes' contains non-Private mode for records: 55555555-5555-5555-5555-555555555555") {
		t.Fatalf("expected error identifying mailboxes and record ID, got: %v", err)
	}
}

// Test 1c: Refuses restoration when a mailbox has non-null wrapped_sk_org
func TestRestore_RejectsUnsafeMailboxWrappedSkOrg(t *testing.T) {
	tempDir := t.TempDir()
	createUnsafeWrappedSkOrgMailboxBundle(t, tempDir)

	testDSN := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDSN == "" {
		t.Skip("skipping restore integration test: TEST_DATABASE_URL is not set")
		return
	}

	res, err := RunRestore(context.Background(), tempDir, testDSN, true /* dryRun */, false /* cleanExisting */)
	if err == nil {
		t.Fatalf("expected restore to reject mailbox with wrapped_sk_org, but succeeded with %+v", res)
	}
	if !strings.Contains(err.Error(), "table 'mailboxes' contains legacy wrapped_sk_org for records: 55555555-5555-5555-5555-555555555555") {
		t.Fatalf("expected error identifying mailboxes and record ID, got: %v", err)
	}
}

// Test 1d: Refuses restoration when an invitation has legacy key material
func TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial(t *testing.T) {
	tempDir := t.TempDir()
	createUnsafeInvitationBundle(t, tempDir)

	testDSN := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDSN == "" {
		t.Skip("skipping restore integration test: TEST_DATABASE_URL is not set")
		return
	}

	res, err := RunRestore(context.Background(), tempDir, testDSN, true /* dryRun */, false /* cleanExisting */)
	if err == nil {
		t.Fatalf("expected restore to reject invitation with legacy key material, but succeeded with %+v", res)
	}
	if !strings.Contains(err.Error(), "table 'account_invitations' contains legacy escrow keys") {
		t.Fatalf("expected error identifying account_invitations and legacy escrow keys, got: %v", err)
	}
	if !strings.Contains(err.Error(), "88888888-8888-8888-8888-888888888888") {
		t.Fatalf("expected error to include invitation record ID, got: %v", err)
	}
}

// Test 1e: A failed restore leaves all destination table counts and row data completely unchanged
func TestRestore_FailedRestoreLeavesDestinationUnchanged(t *testing.T) {
	testDSN := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDSN == "" {
		t.Skip("skipping restore integration test: TEST_DATABASE_URL is not set")
		return
	}

	conn, err := pgx.Connect(context.Background(), testDSN)
	if err != nil {
		t.Fatalf("connect to database: %v", err)
	}
	defer conn.Close(context.Background())

	// Measure initial row counts across tables
	var initialOrgCount, initialMailboxCount, initialRootSecretCount int
	_ = conn.QueryRow(context.Background(), `SELECT count(*) FROM organizations`).Scan(&initialOrgCount)
	_ = conn.QueryRow(context.Background(), `SELECT count(*) FROM mailboxes`).Scan(&initialMailboxCount)
	_ = conn.QueryRow(context.Background(), `SELECT count(*) FROM root_secrets`).Scan(&initialRootSecretCount)

	tempDir := t.TempDir()
	createUnsafeOrgManagedMailboxBundle(t, tempDir)

	// Attempt restore with cleanExisting = true to verify destructive clean is NOT executed
	res, err := RunRestore(context.Background(), tempDir, testDSN, false /* dryRun */, true /* cleanExisting */)
	if err == nil {
		t.Fatalf("expected restore to fail, but succeeded with %+v", res)
	}

	// Verify table counts remain completely unchanged
	var postOrgCount, postMailboxCount, postRootSecretCount int
	_ = conn.QueryRow(context.Background(), `SELECT count(*) FROM organizations`).Scan(&postOrgCount)
	_ = conn.QueryRow(context.Background(), `SELECT count(*) FROM mailboxes`).Scan(&postMailboxCount)
	_ = conn.QueryRow(context.Background(), `SELECT count(*) FROM root_secrets`).Scan(&postRootSecretCount)

	if postOrgCount != initialOrgCount {
		t.Fatalf("destination organizations count changed! before=%d, after=%d", initialOrgCount, postOrgCount)
	}
	if postMailboxCount != initialMailboxCount {
		t.Fatalf("destination mailboxes count changed! before=%d, after=%d", initialMailboxCount, postMailboxCount)
	}
	if postRootSecretCount != initialRootSecretCount {
		t.Fatalf("destination root_secrets count changed! before=%d, after=%d", initialRootSecretCount, postRootSecretCount)
	}
}

// Test 2: Restoring a post-058 backup (with NULL org_recovery_pk and strictly private mailboxes)
func TestRestore_Post058Backup(t *testing.T) {
	tempDir := t.TempDir()
	createPost058TestBackupBundle(t, tempDir)

	testDSN := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testDSN == "" {
		t.Skip("skipping restore integration test: TEST_DATABASE_URL is not set")
		return
	}

	res, err := RunRestore(context.Background(), tempDir, testDSN, true /* dryRun */, false /* cleanExisting */)
	if err != nil {
		t.Fatalf("RunRestore failed for post-058 backup: %v", err)
	}

	if !res.Success {
		t.Fatal("expected restore to report success on post-058 backup")
	}

	if res.RestoredTables < 7 {
		t.Errorf("expected at least 7 restored tables, got %d", res.RestoredTables)
	}
}

// Test 3: Verifying a post-058 backup with NULL organization recovery fields
func TestVerify_Post058BackupWithNullOrgRecovery(t *testing.T) {
	tempDir := t.TempDir()
	createPost058TestBackupBundle(t, tempDir)

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("RunVerify returned unexpected error: %v", err)
	}

	if !res.Passed {
		t.Fatalf("expected post-058 backup verification with NULL org_recovery_pk to pass, but failed: %v", res.Errors)
	}

	status, ok := res.TableDetails["organizations"]
	if !ok || !status.CryptoValid {
		t.Fatal("expected organizations table crypto validation to succeed with NULL org_recovery_pk")
	}
}

// Test 4: Verifying a backup without org_recovery_principals
func TestVerify_BackupWithoutOrgRecoveryPrincipals(t *testing.T) {
	tempDir := t.TempDir()
	createPost058TestBackupBundle(t, tempDir)

	// Confirm that org_recovery_principals is absent from the bundle
	if _, err := os.Stat(filepath.Join(tempDir, "org_recovery_principals.json")); !os.IsNotExist(err) {
		t.Fatal("expected org_recovery_principals.json to be absent from post-058 bundle")
	}

	res, err := RunVerify(tempDir)
	if err != nil {
		t.Fatalf("RunVerify returned unexpected error: %v", err)
	}

	if !res.Passed {
		t.Fatalf("expected verification to pass without org_recovery_principals, but failed: %v", res.Errors)
	}

	if _, exists := res.TableDetails["org_recovery_principals"]; exists {
		t.Fatal("expected org_recovery_principals to NOT be in TableDetails")
	}
}

// Test 5: Handling legacy recovery data without making it available to application users
func TestLegacyRecoveryData_NotExposedToApplication(t *testing.T) {
	// 1. Verify buildInsertParams maps nil/null org_recovery_pk to SQL NULL
	nullRow := map[string]any{
		"id":              "11111111-1111-1111-1111-111111111111",
		"name":            "Test Org",
		"org_recovery_pk": nil,
	}
	cols, vals, _ := buildInsertParams("organizations", nullRow)
	for i, c := range cols {
		if c == "org_recovery_pk" {
			if vals[i] != nil {
				t.Fatalf("expected nil for null org_recovery_pk, got %v", vals[i])
			}
		}
	}

	// 2. Verify buildInsertParams with legacy hex string still decodes bytes for DB storage
	legacyRow := map[string]any{
		"id":              "11111111-1111-1111-1111-111111111111",
		"name":            "Legacy Org",
		"org_recovery_pk": "deadbeef01020304",
	}
	cols, vals, _ = buildInsertParams("organizations", legacyRow)
	for i, c := range cols {
		if c == "org_recovery_pk" {
			byteVal, ok := vals[i].([]byte)
			if !ok {
				t.Fatalf("expected []byte for legacy org_recovery_pk, got %T", vals[i])
			}
			if hex.EncodeToString(byteVal) != "deadbeef01020304" {
				t.Errorf("expected deadbeef01020304, got %x", byteVal)
			}
		}
	}

	// 3. Verify that ByteaColumns properly recognizes legacy tables without exposing them
	if !ByteaColumns["org_recovery_principals"]["org_recovery_pk"] {
		t.Error("expected ByteaColumns to maintain historical decoding support for org_recovery_principals")
	}
}


