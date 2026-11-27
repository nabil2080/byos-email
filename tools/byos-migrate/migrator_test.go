package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func getTestAdminDBURL() string {
	if url := os.Getenv("TEST_DATABASE_URL"); url != "" {
		return url
	}
	return "postgres://byos:byos_dev_password@localhost:5432/postgres?sslmode=disable"
}

func getMigrationsDir() string {
	if dir := os.Getenv("MIGRATIONS_DIR"); dir != "" {
		return dir
	}
	candidates := []string{
		"infra/postgres/migrations",
		"../../infra/postgres/migrations",
		"../../../infra/postgres/migrations",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return "infra/postgres/migrations"
}

func createIsolatedDB(t *testing.T, dbName string) (string, func()) {
	t.Helper()
	adminURL := getTestAdminDBURL()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	adminConn, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("failed to connect to admin database: %v", err)
	}
	defer adminConn.Close(ctx)

	_, _ = adminConn.Exec(ctx, fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s'", dbName))
	_, _ = adminConn.Exec(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s", dbName))

	_, err = adminConn.Exec(ctx, fmt.Sprintf("CREATE DATABASE %s OWNER byos", dbName))
	if err != nil {
		t.Fatalf("failed to create isolated test database %s: %v", dbName, err)
	}

	testDBURL := fmt.Sprintf("postgres://byos:byos_dev_password@localhost:5432/%s?sslmode=disable", dbName)

	cleanup := func() {
		cleanCtx, cleanCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanCancel()
		conn, err := pgx.Connect(cleanCtx, adminURL)
		if err == nil {
			defer conn.Close(cleanCtx)
			_, _ = conn.Exec(cleanCtx, fmt.Sprintf("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '%s'", dbName))
			_, _ = conn.Exec(cleanCtx, fmt.Sprintf("DROP DATABASE IF EXISTS %s", dbName))
		}
	}

	return testDBURL, cleanup
}

func TestPhase4_FreshDatabaseBootstrap(t *testing.T) {
	dbName := "byos_test_mig_fresh"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	migDir := getMigrationsDir()
	migrator := NewMigrator(dbURL, migDir)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	appliedCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("fresh database migration failed: %v", err)
	}

	allMigrations, err := migrator.LoadMigrations()
	if err != nil {
		t.Fatalf("failed to load migrations: %v", err)
	}

	if appliedCount != len(allMigrations) {
		t.Fatalf("expected %d migrations applied, got %d", len(allMigrations), appliedCount)
	}

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer conn.Close(ctx)

	var recordedCount int
	err = conn.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&recordedCount)
	if err != nil {
		t.Fatalf("failed querying schema_migrations count: %v", err)
	}
	if recordedCount != len(allMigrations) {
		t.Fatalf("expected %d rows in schema_migrations, got %d", len(allMigrations), recordedCount)
	}

	var hasLeaseToken int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.columns 
		WHERE table_schema = 'public' AND table_name = 'outbound_queue' AND column_name = 'lease_token'
	`).Scan(&hasLeaseToken)
	if err != nil || hasLeaseToken != 1 {
		t.Fatalf("expected outbound_queue.lease_token column to exist after migration 069")
	}

	var hasOutboundAttachments int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.tables 
		WHERE table_schema = 'public' AND table_name = 'outbound_delivery_attachments'
	`).Scan(&hasOutboundAttachments)
	if err != nil || hasOutboundAttachments != 1 {
		t.Fatalf("expected outbound_delivery_attachments table to exist after migration 070")
	}

	var hasOperatorAudit int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.tables 
		WHERE table_schema = 'public' AND table_name = 'outbound_delivery_operator_audit'
	`).Scan(&hasOperatorAudit)
	if err != nil || hasOperatorAudit != 1 {
		t.Fatalf("expected outbound_delivery_operator_audit table to exist after migration 071")
	}

	secondRunCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("idempotency check failed: %v", err)
	}
	if secondRunCount != 0 {
		t.Fatalf("expected 0 migrations on second run, got %d", secondRunCount)
	}
}

func TestPhase5_ExistingDatabaseUpgrade_Baseline068(t *testing.T) {
	dbName := "byos_test_mig_upgrade_068"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	migDir := getMigrationsDir()
	allMigrations, err := NewMigrator(dbURL, migDir).LoadMigrations()
	if err != nil {
		t.Fatalf("failed to load migrations: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer conn.Close(ctx)

	t.Log("Applying baseline migrations 001 through 068...")
	for _, mig := range allMigrations {
		if mig.Version > "068" {
			break
		}
		if mig.Version == "049" {
			_, _ = conn.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('00000000-0000-0000-0000-000000000aaa', 'Smoke Test Org', '\x00'::bytea) ON CONFLICT (id) DO NOTHING;`)
		}
		if _, err := conn.Exec(ctx, mig.Content); err != nil {
			t.Fatalf("failed applying baseline migration %s: %v", mig.Version, err)
		}
	}

	const testOrgID = "11111111-2222-3333-4444-555555555555"
	const testDomainID = "11111111-2222-3333-4444-555555555556"
	const testUserID = "22222222-3333-4444-5555-666666666666"
	const testMailboxID = "33333333-4444-5555-6666-777777777777"
	const testQueueID = "44444444-5555-6666-7777-888888888888"

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ($1, 'Upgrade Corp', '\x01020304')`, testOrgID)
	if err != nil {
		t.Fatalf("failed inserting synthetic org: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, 'upgrade.byos.local', true)`, testDomainID, testOrgID)
	if err != nil {
		t.Fatalf("failed inserting synthetic domain: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash) VALUES ($1, $2, 'upgrade_user@byos.local', '$2a$10$fakehash')`, testUserID, testOrgID)
	if err != nil {
		t.Fatalf("failed inserting synthetic user: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, mailbox_pk) VALUES ($1, $2, $3, $4, 'upgrade_user', 'private', '\x05060708')`, testMailboxID, testOrgID, testUserID, testDomainID)
	if err != nil {
		t.Fatalf("failed inserting synthetic mailbox: %v", err)
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, expires_at) 
		VALUES ($1, $1, $2, $3, 'test@external.com', '\x0102'::bytea, '\x0304'::bytea, 'pending', NOW() + interval '24 hours')
	`, testQueueID, testMailboxID, testDomainID)
	if err != nil {
		t.Fatalf("failed inserting synthetic outbound_queue: %v", err)
	}

	var migTableExists int
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='schema_migrations'").Scan(&migTableExists)
	if migTableExists != 0 {
		t.Fatalf("expected schema_migrations to NOT exist before upgrade")
	}

	var hasLeaseToken int
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='outbound_queue' AND column_name='lease_token'").Scan(&hasLeaseToken)
	if hasLeaseToken != 0 {
		t.Fatalf("expected outbound_queue.lease_token to NOT exist before upgrade")
	}

	migrator := NewMigrator(dbURL, migDir)
	appliedCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("upgrade migration failed: %v", err)
	}
	var expectedPostBaseline int
	for _, m := range allMigrations {
		if m.Version > "068" {
			expectedPostBaseline++
		}
	}
	if appliedCount != expectedPostBaseline {
		t.Fatalf("expected exactly %d migrations applied (069+), got %d", expectedPostBaseline, appliedCount)
	}

	var hasOperatorAudit int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM information_schema.tables 
		WHERE table_schema = 'public' AND table_name = 'outbound_delivery_operator_audit'
	`).Scan(&hasOperatorAudit)
	if err != nil || hasOperatorAudit != 1 {
		t.Fatalf("expected outbound_delivery_operator_audit table to exist after upgrade")
	}

	var finalRecordedCount int
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&finalRecordedCount)
	if finalRecordedCount != len(allMigrations) {
		t.Fatalf("expected %d total records in schema_migrations (stamped 068 + applied 2), got %d", len(allMigrations), finalRecordedCount)
	}

	var orgName string
	err = conn.QueryRow(ctx, "SELECT name FROM organizations WHERE id = $1", testOrgID).Scan(&orgName)
	if err != nil || orgName != "Upgrade Corp" {
		t.Fatalf("synthetic org corrupted or missing after upgrade: %v", err)
	}

	var queueRecipient string
	err = conn.QueryRow(ctx, "SELECT recipient FROM outbound_queue WHERE id = $1", testQueueID).Scan(&queueRecipient)
	if err != nil || queueRecipient != "test@external.com" {
		t.Fatalf("synthetic outbound_queue corrupted or missing after upgrade: %v", err)
	}

	secondRunCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("re-running upgrade failed: %v", err)
	}
	if secondRunCount != 0 {
		t.Fatalf("expected 0 migrations on re-run, got %d", secondRunCount)
	}
}

func TestPhase1_Baseline068_PartialSchema_FailsClosed(t *testing.T) {
	dbName := "byos_test_mig_partial_fail"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	migDir := getMigrationsDir()
	allMigrations, err := NewMigrator(dbURL, migDir).LoadMigrations()
	if err != nil {
		t.Fatalf("failed to load migrations: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	defer conn.Close(ctx)

	// Apply only 001..010 (partial schema)
	for i := 0; i < 10; i++ {
		_, err := conn.Exec(ctx, allMigrations[i].Content)
		if err != nil {
			t.Fatalf("failed applying partial migration: %v", err)
		}
	}

	migrator := NewMigrator(dbURL, migDir)
	_, err = migrator.Up(ctx)
	if err == nil {
		t.Fatalf("expected Up() to fail closed on partial schema, but it succeeded!")
	}

	if !strings.Contains(err.Error(), "baseline verification failed") {
		t.Fatalf("expected 'baseline verification failed' error, got: %v", err)
	}
	t.Logf("Expected failure observed on partial schema: %v", err)
}

func TestPhase1_Baseline068_ConflictingPostBaselineSchema_FailsClosed(t *testing.T) {
	dbName := "byos_test_mig_conflict_fail"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	migDir := getMigrationsDir()
	allMigrations, err := NewMigrator(dbURL, migDir).LoadMigrations()
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	defer conn.Close(ctx)

	// Apply 001..068
	for _, mig := range allMigrations {
		if mig.Version > "068" {
			break
		}
		if mig.Version == "049" {
			_, _ = conn.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('00000000-0000-0000-0000-000000000aaa', 'Smoke Test Org', '\x00'::bytea) ON CONFLICT (id) DO NOTHING;`)
		}
		_, err := conn.Exec(ctx, mig.Content)
		if err != nil {
			t.Fatalf("failed applying baseline migration %s: %v", mig.Version, err)
		}
	}

	// Manually inject column from migration 069 (simulating partial/ambiguous state)
	_, err = conn.Exec(ctx, "ALTER TABLE outbound_queue ADD COLUMN lease_token UUID;")
	if err != nil {
		t.Fatalf("failed adding lease_token: %v", err)
	}

	migrator := NewMigrator(dbURL, migDir)
	report, err := migrator.VerifyBaseline(ctx, conn, "068")
	if err != nil {
		t.Fatalf("VerifyBaseline returned unexpected error: %v", err)
	}
	if report.IsMatch {
		t.Fatalf("expected report.IsMatch to be false for conflicting post-068 schema, but got true")
	}

	// Up must fail closed
	_, err = migrator.Up(ctx)
	if err == nil {
		t.Fatalf("expected Up() to fail closed on conflicting schema, but it succeeded!")
	}
	t.Logf("Expected conflict failure observed: %v", err)
}

func TestPhase1_Baseline068_OperatorPreflightVerification(t *testing.T) {
	dbName := "byos_test_mig_manifest"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	migDir := getMigrationsDir()
	allMigrations, err := NewMigrator(dbURL, migDir).LoadMigrations()
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	defer conn.Close(ctx)

	// Apply 001..068
	for _, mig := range allMigrations {
		if mig.Version > "068" {
			break
		}
		if mig.Version == "049" {
			_, _ = conn.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('00000000-0000-0000-0000-000000000aaa', 'Smoke Test Org', '\x00'::bytea) ON CONFLICT (id) DO NOTHING;`)
		}
		_, err := conn.Exec(ctx, mig.Content)
		if err != nil {
			t.Fatalf("failed applying baseline migration %s: %v", mig.Version, err)
		}
	}

	migrator := NewMigrator(dbURL, migDir)
	report, err := migrator.VerifyBaseline(ctx, conn, "068")
	if err != nil {
		t.Fatalf("VerifyBaseline failed: %v", err)
	}

	if !report.IsMatch {
		t.Fatalf("expected true baseline 068 to match manifest, but %d checks failed", report.FailedCount)
	}
	if report.PassedCount != report.TotalChecks {
		t.Fatalf("expected all %d checks to pass, got %d", report.TotalChecks, report.PassedCount)
	}
	t.Logf("Baseline 068 Preflight PASSED: %d/%d checks verified", report.PassedCount, report.TotalChecks)
}

func TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease(t *testing.T) {
	dbName := "byos_test_mig_lock_pinning"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 1. Connection 1 connects and acquires advisory lock
	conn1, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("conn1 connect failed: %v", err)
	}

	var pid1 int
	_ = conn1.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&pid1)

	var locked1 bool
	err = conn1.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", AdvisoryLockID).Scan(&locked1)
	if err != nil || !locked1 {
		t.Fatalf("conn1 failed to acquire lock on backend PID %d", pid1)
	}
	t.Logf("Session 1 acquired advisory lock on backend PID %d", pid1)

	// 2. Connection 2 connects and attempts lock -> must be REJECTED
	conn2, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("conn2 connect failed: %v", err)
	}
	defer conn2.Close(ctx)

	var pid2 int
	_ = conn2.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&pid2)
	if pid1 == pid2 {
		t.Fatalf("expected different backend PIDs, got both %d", pid1)
	}

	var locked2 bool
	err = conn2.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", AdvisoryLockID).Scan(&locked2)
	if err != nil {
		t.Fatalf("conn2 query error: %v", err)
	}
	if locked2 {
		t.Fatalf("expected conn2 (PID %d) to be REJECTED while conn1 (PID %d) holds lock, but it succeeded!", pid2, pid1)
	}
	t.Logf("Session 2 (PID %d) was correctly rejected while Session 1 (PID %d) holds advisory lock", pid2, pid1)

	// 3. Close Connection 1 (simulating network crash / server abort)
	conn1.Close(ctx)
	t.Logf("Session 1 (PID %d) closed / disconnected", pid1)

	// 4. Session 2 now attempts to acquire advisory lock -> must SUCCEED (polling briefly for backend OS disconnect cleanup)
	var lockedAfterDisconnect bool
	for attempt := 0; attempt < 40; attempt++ {
		err = conn2.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", AdvisoryLockID).Scan(&lockedAfterDisconnect)
		if err == nil && lockedAfterDisconnect {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil || !lockedAfterDisconnect {
		t.Fatalf("expected conn2 to acquire lock after conn1 disconnect, but failed: err=%v, locked=%v", err, lockedAfterDisconnect)
	}
	t.Logf("Session 2 (PID %d) successfully acquired advisory lock after Session 1 disconnected", pid2)

	// Clean unlock
	_, _ = conn2.Exec(ctx, "SELECT pg_advisory_unlock($1)", AdvisoryLockID)
}

func TestPhase6_MigrationInterruptionAndRecovery(t *testing.T) {
	dbName := "byos_test_mig_interrupted"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	tempDir, err := os.MkdirTemp("", "byos_mig_test_*")
	if err != nil {
		t.Fatalf("creating temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	file001 := filepath.Join(tempDir, "001_good.sql")
	_ = os.WriteFile(file001, []byte(`CREATE TABLE tbl_good (id UUID PRIMARY KEY, name TEXT);`), 0644)

	file002 := filepath.Join(tempDir, "002_bad.sql")
	_ = os.WriteFile(file002, []byte(`
		CREATE TABLE tbl_bad (id UUID PRIMARY KEY);
		THIS IS INTENTIONAL SYNTAX ERROR;
	`), 0644)

	migrator := NewMigrator(dbURL, tempDir)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err = migrator.Up(ctx)
	if err == nil {
		t.Fatalf("expected Up() to fail on syntax error in 002, but succeeded")
	}
	t.Logf("Expected failure observed: %v", err)

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("failed to connect: %v", err)
	}
	defer conn.Close(ctx)

	var goodTableExists int
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='tbl_good'").Scan(&goodTableExists)
	if goodTableExists != 1 {
		t.Fatalf("expected tbl_good to exist from successful migration 001")
	}

	var badTableExists int
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='tbl_bad'").Scan(&badTableExists)
	if badTableExists != 0 {
		t.Fatalf("expected tbl_bad to NOT exist due to transactional rollback!")
	}

	var mig002Recorded int
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM schema_migrations WHERE version='002'").Scan(&mig002Recorded)
	if mig002Recorded != 0 {
		t.Fatalf("expected version 002 to NOT be recorded in schema_migrations after rollback!")
	}

	_ = os.WriteFile(file002, []byte(`CREATE TABLE tbl_bad (id UUID PRIMARY KEY, fixed TEXT);`), 0644)

	appliedCount, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("retry failed after fix: %v", err)
	}
	if appliedCount != 1 {
		t.Fatalf("expected 1 migration applied on retry, got %d", appliedCount)
	}

	_ = conn.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='tbl_bad'").Scan(&badTableExists)
	if badTableExists != 1 {
		t.Fatalf("expected tbl_bad to exist after fixed retry")
	}
}

func TestPhase6_NonTransactionalMigrationSupport(t *testing.T) {
	dbName := "byos_test_mig_nontx"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	tempDir, err := os.MkdirTemp("", "byos_mig_nontx_*")
	if err != nil {
		t.Fatalf("creating temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	file001 := filepath.Join(tempDir, "001_nontx.sql")
	_ = os.WriteFile(file001, []byte("-- byos-migrate: no-transaction\nCREATE TABLE tbl_nontx (id int);"), 0644)

	migrator := NewMigrator(dbURL, tempDir)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	applied, err := migrator.Up(ctx)
	if err != nil {
		t.Fatalf("non-transactional migration failed: %v", err)
	}
	if applied != 1 {
		t.Fatalf("expected 1 migration applied, got %d", applied)
	}

	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect failed: %v", err)
	}
	defer conn.Close(ctx)

	var tblExists int
	_ = conn.QueryRow(ctx, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='tbl_nontx'").Scan(&tblExists)
	if tblExists != 1 {
		t.Fatalf("expected tbl_nontx to exist")
	}
}

func TestPhase6_ChecksumMismatchDetection(t *testing.T) {
	dbName := "byos_test_mig_checksum"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	tempDir, err := os.MkdirTemp("", "byos_mig_csum_*")
	if err != nil {
		t.Fatalf("creating temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	file001 := filepath.Join(tempDir, "001_first.sql")
	_ = os.WriteFile(file001, []byte(`CREATE TABLE t1 (id int);`), 0644)

	migrator := NewMigrator(dbURL, tempDir)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err = migrator.Up(ctx)
	if err != nil {
		t.Fatalf("initial migration failed: %v", err)
	}

	_ = os.WriteFile(file001, []byte(`CREATE TABLE t1 (id int, tampered int);`), 0644)

	_, err = migrator.Up(ctx)
	if err == nil {
		t.Fatalf("expected Up to fail due to checksum mismatch, but succeeded")
	}
	t.Logf("Expected checksum mismatch error: %v", err)
}

func TestPhase6_MissingRequiredMigrationFile(t *testing.T) {
	dbName := "byos_test_mig_missing"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	tempDir, err := os.MkdirTemp("", "byos_mig_miss_*")
	if err != nil {
		t.Fatalf("creating temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	file001 := filepath.Join(tempDir, "001_first.sql")
	_ = os.WriteFile(file001, []byte(`CREATE TABLE t1 (id int);`), 0644)

	migrator := NewMigrator(dbURL, tempDir)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_, err = migrator.Up(ctx)
	if err != nil {
		t.Fatalf("initial migration failed: %v", err)
	}

	_ = os.Remove(file001)
	_ = os.WriteFile(filepath.Join(tempDir, "002_second.sql"), []byte(`CREATE TABLE t2 (id int);`), 0644)

	_, err = migrator.Up(ctx)
	if err == nil {
		t.Fatalf("expected Up to fail due to missing migration 001, but succeeded")
	}
	t.Logf("Expected missing file error: %v", err)
}

func TestPhase6_DuplicateVersionDetection(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "byos_mig_dup_*")
	if err != nil {
		t.Fatalf("creating temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	_ = os.WriteFile(filepath.Join(tempDir, "001_a.sql"), []byte(`SELECT 1;`), 0644)
	_ = os.WriteFile(filepath.Join(tempDir, "001_b.sql"), []byte(`SELECT 2;`), 0644)

	migrator := NewMigrator("", tempDir)
	_, err = migrator.LoadMigrations()
	if err == nil {
		t.Fatalf("expected LoadMigrations to fail with duplicate version error, but succeeded")
	}
	t.Logf("Expected duplicate version error: %v", err)
}

func TestPhase6_ConcurrentDeploymentProtection(t *testing.T) {
	dbName := "byos_test_mig_concurrency"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn1, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("conn1 connect failed: %v", err)
	}
	defer conn1.Close(ctx)

	var locked bool
	err = conn1.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", AdvisoryLockID).Scan(&locked)
	if err != nil || !locked {
		t.Fatalf("conn1 failed to acquire advisory lock: err=%v, locked=%v", err, locked)
	}

	tempDir, _ := os.MkdirTemp("", "byos_mig_conc_*")
	defer os.RemoveAll(tempDir)
	_ = os.WriteFile(filepath.Join(tempDir, "001_test.sql"), []byte(`CREATE TABLE t (id int);`), 0644)

	migrator2 := NewMigrator(dbURL, tempDir)
	_, err = migrator2.Up(ctx)
	if err == nil {
		t.Fatalf("expected concurrent migrator to fail, but it succeeded!")
	}
	t.Logf("Expected concurrent lock rejection: %v", err)

	_, _ = conn1.Exec(ctx, "SELECT pg_advisory_unlock($1)", AdvisoryLockID)

	applied, err := migrator2.Up(ctx)
	if err != nil {
		t.Fatalf("migrator2 failed after lock release: %v", err)
	}
	if applied != 1 {
		t.Errorf("expected 1 migration applied, got %d", applied)
	}
}

func TestPhase6_InsufficientPrivilegesFailsClosed(t *testing.T) {
	dbName := "byos_test_mig_rbac"
	dbURL, cleanup := createIsolatedDB(t, dbName)
	defer cleanup()

	migDir := getMigrationsDir()
	adminMigrator := NewMigrator(dbURL, migDir)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Minute)
	defer cancel()

	allMigs, err := adminMigrator.LoadMigrations()
	if err != nil {
		t.Fatalf("load migrations: %v", err)
	}
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	for i := 0; i < 2; i++ {
		_, _ = conn.Exec(ctx, allMigs[i].Content)
	}
	conn.Close(ctx)

	workerURL := fmt.Sprintf("postgres://outbound_worker_login:byos_outbound_worker_dev@localhost:5432/%s?sslmode=disable", dbName)
	workerMigrator := NewMigrator(workerURL, migDir)

	_, err = workerMigrator.Up(ctx)
	if err == nil {
		t.Fatalf("expected migration to fail when executed by unprivileged outbound_worker_login, but succeeded!")
	}
	t.Logf("Expected privilege failure: %v", err)
}
