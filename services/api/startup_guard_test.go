package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestStartupWarnDetectsStrayBucket(t *testing.T) {
	// Mock an S3 server with 2 buckets: "byos-mailbox" and "stray-bucket-xyz"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Owner>
        <ID>02d6176db174dc93cb1b899f7c6078f08654445fe8cf1b6ce98d8855f66bdbf4</ID>
        <DisplayName>minio</DisplayName>
    </Owner>
    <Buckets>
        <Bucket><Name>byos-mailbox</Name><CreationDate>2026-09-30T08:41:04.879Z</CreationDate></Bucket>
        <Bucket><Name>stray-bucket-xyz</Name><CreationDate>2026-10-01T08:41:04.879Z</CreationDate></Bucket>
    </Buckets>
</ListAllMyBucketsResult>`))
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	warnings := CheckTestPollution(ctx, "", server.URL, "byosminio", "byosminio_dev_password")
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "[STARTUP-WARN] test pollution detected: stray MinIO bucket(s) found") &&
			strings.Contains(w, "stray-bucket-xyz") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected stray bucket warning, got: %v", warnings)
	}
}

func TestStartupWarnDetectsKeyMismatch(t *testing.T) {
	t.Setenv("BYOS_DEV_MODE", "1")
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()
	var orgID, domainID, userID, mailboxID string
	err := db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`, "Org "+tag).Scan(&orgID)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer db.Exec("DELETE FROM organizations WHERE id = $1", orgID)

	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, tag+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}
	defer db.Exec("DELETE FROM domains WHERE id = $1", domainID)

	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash)
		VALUES ($1, $2, 'Test User', 'dummy-hash')
		RETURNING id
	`, orgID, "user-"+tag+"@"+tag+".local").Scan(&userID)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}
	defer db.Exec("DELETE FROM users WHERE id = $1", userID)

	// Valid Alice wrapped_sk_user JSON (unwraps to key starting with 66c3f0c7...)
	aliceWrapped := `{"envelope":"01e50daa67af5e6d7f45c684736b8da5f7756d44fbcbb0fa31ff44e5cf061a259db9f2673c9b7b722f6a1c86ef90c1314afc03b1f63bf5c71bc26c2308","root_wrapped":"0139e3407a2c35100c23e3544818c6ae1c910618e1d6088c704364cfe3ff37909c6f74b8672bedbd50cd0961eaa1418e62bbf4eb48a8b416f39655516b","salt":"c8c854b66abb45695e70bd4c5a2a126f","signing_envelope":"01603346cc9d09a289187ffbb2ce77d41fd4e84c63847ed39af83a9354b92e6de493762e664b5105f747e9bf13421c02243776ad0890aecdf94a18cdb5","signing_root_wrapped":"01e512c9817036fec1d0e01b0dd6266a7db72c1fe961e7feda37ddd5cefda95e7a984268f90c419208645f1a6293e3e3543f21917b5da3bd162403288a","signing_salt":"fde5a6bcfd9695639547e6810fc35fb3","xwing_envelope":"01b982d488e98a6ac82615aa441415ceeaf48c33bd7b31cf1590c9cb8cc8f1a4598b36e3fd7face0e71ed58679d3764ad69aba7495d37a127676ae8ca8","xwing_root_wrapped":"01da19e93258e2cf34ee07bdf92ee52f3be195f80a815ddceda223072ddae4eda4a72f9a5f869ed76facf41cacc1401a680aed3c90cc24df6a9721a934","xwing_salt":"5780cfc4a7119c2d06a334d911f4ee38"}`
	// Tampered Ed25519 public key (32 bytes of 0x99)
	tamperedPK := bytes.Repeat([]byte{0x99}, 32)

	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, wrapped_sk_user, mailbox_ed25519_pk, mailbox_pk, is_active)
		VALUES ($1, $2, $3, 'alice', $4, $5, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), true)
		RETURNING id
	`, orgID, userID, domainID, aliceWrapped, tamperedPK).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}
	defer db.Exec("DELETE FROM mailboxes WHERE id = $1", mailboxID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	warnings := CheckTestPollution(ctx, testDSN, "", "", "")
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "[STARTUP-WARN] test pollution detected: mailbox alice") &&
			strings.Contains(w, mailboxID) &&
			strings.Contains(w, "Ed25519 public key does not match derived key") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected key mismatch warning for mailbox %s, got: %v", mailboxID, warnings)
	}
}

func TestCleanTestDataRemovesTestRows(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// Seed 2 test mailboxes and 5 test messages
	tag := uuid.New().String()
	var orgID, domainID, user1ID, user2ID, mb1ID, mb2ID string

	err := db.QueryRow(`INSERT INTO organizations (name, org_recovery_pk) VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64')) RETURNING id`, "Org "+tag).Scan(&orgID)
	if err != nil {
		t.Fatalf("failed to insert test org: %v", err)
	}
	err = db.QueryRow(`INSERT INTO domains (org_id, name, is_verified) VALUES ($1, $2, true) RETURNING id`, orgID, "test-"+tag+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert test domain: %v", err)
	}

	err = db.QueryRow(`INSERT INTO users (org_id, email, display_name, password_hash) VALUES ($1, $2, 'U1', 'hash') RETURNING id`, orgID, "user1-"+tag+"@test.local").Scan(&user1ID)
	if err != nil {
		t.Fatalf("failed to insert test user 1: %v", err)
	}
	err = db.QueryRow(`INSERT INTO users (org_id, email, display_name, password_hash) VALUES ($1, $2, 'U2', 'hash') RETURNING id`, orgID, "user2-"+tag+"@test.local").Scan(&user2ID)
	if err != nil {
		t.Fatalf("failed to insert test user 2: %v", err)
	}

	err = db.QueryRow(`INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mailbox_pk, is_active) VALUES ($1, $2, $3, 'alice', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), true) RETURNING id`, orgID, user1ID, domainID).Scan(&mb1ID)
	if err != nil {
		t.Fatalf("failed to insert test mailbox 1: %v", err)
	}
	err = db.QueryRow(`INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mailbox_pk, is_active) VALUES ($1, $2, $3, 'bob', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), true) RETURNING id`, orgID, user2ID, domainID).Scan(&mb2ID)
	if err != nil {
		t.Fatalf("failed to insert test mailbox 2: %v", err)
	}

	// Insert 5 test messages
	for i := 0; i < 5; i++ {
		targetMB := mb1ID
		if i%2 == 1 {
			targetMB = mb2ID
		}
		_, err = db.Exec(`
			INSERT INTO message_metadata (
				mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
				storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
				encryption_iv, bundle_hash, folder, size_bytes
			) VALUES (
				$1, $2, 'received', $3, 'test@byos.local', ARRAY['recipient@byos.local'],
				'mailboxes/test.eml', '\x00'::bytea, 1, '\x00'::bytea, '\x00'::bytea, 'inbox', 100
			)
		`, targetMB, domainID, []byte("deliv-"+uuid.New().String()))
		if err != nil {
			t.Fatalf("failed to insert test message %d: %v", i, err)
		}
	}

	// Read and execute tools/clean-test-data.sql
	sqlPath := filepath.Join("..", "..", "tools", "clean-test-data.sql")
	sqlBytes, err := os.ReadFile(sqlPath)
	if err != nil {
		t.Fatalf("failed to read %s: %v", sqlPath, err)
	}

	_, err = db.Exec(string(sqlBytes))
	if err != nil {
		t.Fatalf("cleanup SQL execution failed: %v", err)
	}

	// Assert the 2 test mailboxes are gone
	var countMB int
	err = db.QueryRow(`SELECT count(*) FROM mailboxes WHERE id IN ($1, $2)`, mb1ID, mb2ID).Scan(&countMB)
	if err != nil {
		t.Fatalf("failed to query test mailboxes count: %v", err)
	}
	if countMB != 0 {
		t.Fatalf("expected 0 test mailboxes after cleanup, got %d", countMB)
	}

	// Assert the test messages are gone
	var countMsg int
	err = db.QueryRow(`SELECT count(*) FROM message_metadata WHERE mailbox_id IN ($1, $2)`, mb1ID, mb2ID).Scan(&countMsg)
	if err != nil {
		t.Fatalf("failed to query test messages count: %v", err)
	}
	if countMsg != 0 {
		t.Fatalf("expected 0 test messages after cleanup, got %d", countMsg)
	}

	// Assert production seed users exist (or can be reseeded)
	var seedCount int
	err = db.QueryRow(`SELECT count(*) FROM mailboxes WHERE id IN ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')`).Scan(&seedCount)
	if err != nil {
		t.Fatalf("failed to query seed mailboxes: %v", err)
	}
	if seedCount != 2 {
		t.Logf("seed mailboxes count is %d (will be recreated upon reseed)", seedCount)
	}
}

func TestCleanTestDataPreservesSeed(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// Ensure seed accounts exist before running test
	_, err := db.Exec(`
		INSERT INTO organizations (id, name, org_recovery_pk)
		VALUES ('00000000-0000-0000-0000-000000000aaa'::uuid, 'Smoke Test Org', '\x00'::bytea)
		ON CONFLICT (id) DO NOTHING;

		INSERT INTO domains (id, org_id, name, is_verified)
		VALUES ('00000000-0000-0000-0000-000000000bbb'::uuid, '00000000-0000-0000-0000-000000000aaa'::uuid, 'byos.local', true)
		ON CONFLICT (id) DO NOTHING;

		INSERT INTO users (id, org_id, email, display_name, password_hash, is_active)
		VALUES ('cccccccc-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000aaa'::uuid, 'alice@byos.local', 'Alice', 'hash', true)
		ON CONFLICT (id) DO NOTHING;

		INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mailbox_pk, is_active)
		VALUES ('c0000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000aaa'::uuid, 'cccccccc-0000-0000-0000-000000000002'::uuid, '00000000-0000-0000-0000-000000000bbb'::uuid, 'alice', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), true)
		ON CONFLICT (id) DO NOTHING;
	`)
	if err != nil {
		t.Fatalf("failed to insert seed records: %v", err)
	}

	// Read and execute tools/clean-test-data.sql
	sqlPath := filepath.Join("..", "..", "tools", "clean-test-data.sql")
	sqlBytes, err := os.ReadFile(sqlPath)
	if err != nil {
		t.Fatalf("failed to read %s: %v", sqlPath, err)
	}

	_, err = db.Exec(string(sqlBytes))
	if err != nil {
		t.Fatalf("cleanup SQL execution failed: %v", err)
	}

	// Assert the seed user Alice survived
	var userCount int
	err = db.QueryRow(`SELECT count(*) FROM users WHERE id = 'cccccccc-0000-0000-0000-000000000002'`).Scan(&userCount)
	if err != nil || userCount != 1 {
		t.Fatalf("seed user Alice must survive cleanup, count: %d (err: %v)", userCount, err)
	}

	// Assert the seed mailbox Alice survived
	var mailboxCount int
	err = db.QueryRow(`SELECT count(*) FROM mailboxes WHERE id = 'c0000000-0000-0000-0000-000000000001'`).Scan(&mailboxCount)
	if err != nil || mailboxCount != 1 {
		t.Fatalf("seed mailbox Alice must survive cleanup, count: %d (err: %v)", mailboxCount, err)
	}
}

func TestKeyMismatchCheckSkippedWithoutDevMode(t *testing.T) {
	os.Unsetenv("BYOS_DEV_MODE")
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()
	var orgID, domainID, userID, mailboxID string
	err := db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`, "Org "+tag).Scan(&orgID)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer db.Exec("DELETE FROM organizations WHERE id = $1", orgID)

	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, tag+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}
	defer db.Exec("DELETE FROM domains WHERE id = $1", domainID)

	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash)
		VALUES ($1, $2, 'Test User', 'dummy-hash')
		RETURNING id
	`, orgID, "user-"+tag+"@"+tag+".local").Scan(&userID)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}
	defer db.Exec("DELETE FROM users WHERE id = $1", userID)

	aliceWrapped := `{"envelope":"01e50daa67af5e6d7f45c684736b8da5f7756d44fbcbb0fa31ff44e5cf061a259db9f2673c9b7b722f6a1c86ef90c1314afc03b1f63bf5c71bc26c2308","root_wrapped":"0139e3407a2c35100c23e3544818c6ae1c910618e1d6088c704364cfe3ff37909c6f74b8672bedbd50cd0961eaa1418e62bbf4eb48a8b416f39655516b","salt":"c8c854b66abb45695e70bd4c5a2a126f","signing_envelope":"01603346cc9d09a289187ffbb2ce77d41fd4e84c63847ed39af83a9354b92e6de493762e664b5105f747e9bf13421c02243776ad0890aecdf94a18cdb5","signing_root_wrapped":"01e512c9817036fec1d0e01b0dd6266a7db72c1fe961e7feda37ddd5cefda95e7a984268f90c419208645f1a6293e3e3543f21917b5da3bd162403288a","signing_salt":"fde5a6bcfd9695639547e6810fc35fb3","xwing_envelope":"01b982d488e98a6ac82615aa441415ceeaf48c33bd7b31cf1590c9cb8cc8f1a4598b36e3fd7face0e71ed58679d3764ad69aba7495d37a127676ae8ca8","xwing_root_wrapped":"01da19e93258e2cf34ee07bdf92ee52f3be195f80a815ddceda223072ddae4eda4a72f9a5f869ed76facf41cacc1401a680aed3c90cc24df6a9721a934","xwing_salt":"5780cfc4a7119c2d06a334d911f4ee38"}`
	tamperedPK := bytes.Repeat([]byte{0x99}, 32)

	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, wrapped_sk_user, mailbox_ed25519_pk, mailbox_pk, is_active)
		VALUES ($1, $2, $3, 'alice', $4, $5, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), true)
		RETURNING id
	`, orgID, userID, domainID, aliceWrapped, tamperedPK).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}
	defer db.Exec("DELETE FROM mailboxes WHERE id = $1", mailboxID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	warnings := CheckTestPollution(ctx, testDSN, "", "", "")
	for _, w := range warnings {
		if strings.Contains(w, "Ed25519 public key does not match derived key") {
			t.Fatalf("expected key mismatch check to be skipped without BYOS_DEV_MODE, but got warning: %s", w)
		}
	}
}

func TestKeyMismatchCheckRunsWithDevMode(t *testing.T) {
	t.Setenv("BYOS_DEV_MODE", "1")
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()
	var orgID, domainID, userID, mailboxID string
	err := db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`, "Org "+tag).Scan(&orgID)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer db.Exec("DELETE FROM organizations WHERE id = $1", orgID)

	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, tag+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}
	defer db.Exec("DELETE FROM domains WHERE id = $1", domainID)

	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash)
		VALUES ($1, $2, 'Test User', 'dummy-hash')
		RETURNING id
	`, orgID, "user-"+tag+"@"+tag+".local").Scan(&userID)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}
	defer db.Exec("DELETE FROM users WHERE id = $1", userID)

	aliceWrapped := `{"envelope":"01e50daa67af5e6d7f45c684736b8da5f7756d44fbcbb0fa31ff44e5cf061a259db9f2673c9b7b722f6a1c86ef90c1314afc03b1f63bf5c71bc26c2308","root_wrapped":"0139e3407a2c35100c23e3544818c6ae1c910618e1d6088c704364cfe3ff37909c6f74b8672bedbd50cd0961eaa1418e62bbf4eb48a8b416f39655516b","salt":"c8c854b66abb45695e70bd4c5a2a126f","signing_envelope":"01603346cc9d09a289187ffbb2ce77d41fd4e84c63847ed39af83a9354b92e6de493762e664b5105f747e9bf13421c02243776ad0890aecdf94a18cdb5","signing_root_wrapped":"01e512c9817036fec1d0e01b0dd6266a7db72c1fe961e7feda37ddd5cefda95e7a984268f90c419208645f1a6293e3e3543f21917b5da3bd162403288a","signing_salt":"fde5a6bcfd9695639547e6810fc35fb3","xwing_envelope":"01b982d488e98a6ac82615aa441415ceeaf48c33bd7b31cf1590c9cb8cc8f1a4598b36e3fd7face0e71ed58679d3764ad69aba7495d37a127676ae8ca8","xwing_root_wrapped":"01da19e93258e2cf34ee07bdf92ee52f3be195f80a815ddceda223072ddae4eda4a72f9a5f869ed76facf41cacc1401a680aed3c90cc24df6a9721a934","xwing_salt":"5780cfc4a7119c2d06a334d911f4ee38"}`
	tamperedPK := bytes.Repeat([]byte{0x99}, 32)

	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, wrapped_sk_user, mailbox_ed25519_pk, mailbox_pk, is_active)
		VALUES ($1, $2, $3, 'alice', $4, $5, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), true)
		RETURNING id
	`, orgID, userID, domainID, aliceWrapped, tamperedPK).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}
	defer db.Exec("DELETE FROM mailboxes WHERE id = $1", mailboxID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	warnings := CheckTestPollution(ctx, testDSN, "", "", "")
	found := false
	for _, w := range warnings {
		if strings.Contains(w, "[STARTUP-WARN] test pollution detected: mailbox alice") &&
			strings.Contains(w, mailboxID) &&
			strings.Contains(w, "Ed25519 public key does not match derived key") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected key mismatch warning for mailbox %s with BYOS_DEV_MODE=1, got: %v", mailboxID, warnings)
	}
}

func TestDeriveRejectsHugeArgon2Params(t *testing.T) {
	hugeParamsJSON := `{"memory_cost": 99999999, "time_cost": 3, "parallelism": 2, "signing_salt": "0102030405060708090a0b0c0d0e0f10", "signing_envelope": "01"}`
	_, err := DeriveEd25519PubkeyFromWrappedSeed(hugeParamsJSON)
	if err == nil {
		t.Fatal("expected error when memory_cost exceeds safety limits, got nil")
	}
	if !strings.Contains(err.Error(), "argon2 parameters exceed safety limits") {
		t.Fatalf("expected safety limits error, got: %v", err)
	}

	// Also test nested kdf_params format
	hugeKdfParamsJSON := `{"kdf_params": {"memory_cost": 99999999, "time_cost": 3, "parallelism": 2, "salt": "0102030405060708090a0b0c0d0e0f10"}, "signing_envelope": "01"}`
	_, err = DeriveEd25519PubkeyFromWrappedSeed(hugeKdfParamsJSON)
	if err == nil {
		t.Fatal("expected error when kdf_params.memory_cost exceeds safety limits, got nil")
	}
	if !strings.Contains(err.Error(), "argon2 parameters exceed safety limits") {
		t.Fatalf("expected safety limits error, got: %v", err)
	}
}
