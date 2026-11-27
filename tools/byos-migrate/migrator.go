package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// AdvisoryLockID is a 64-bit integer derived from "BYOSMIGR" in hex.
// Used to prevent concurrent migration executions against the same database.
const AdvisoryLockID int64 = 4780962453531182930 // 0x42594F534D494752

var migrationFileRegex = regexp.MustCompile(`^(\d{3,})_(.+)\.sql$`)

// Migration represents a SQL migration file on disk.
type Migration struct {
	Version  string // e.g., "001", "069"
	Name     string // e.g., "001_init.sql"
	Path     string // full path to file
	Checksum string // SHA-256 hex digest
	Content  string // raw SQL statements
}

// AppliedMigration represents a recorded migration in schema_migrations.
type AppliedMigration struct {
	Version         string
	Name            string
	Checksum        string
	AppliedAt       time.Time
	ExecutionTimeMs int
}

// MigrationStatus reports status of a migration relative to the database.
type MigrationStatus struct {
	Version   string
	Name      string
	Checksum  string
	State     string // "APPLIED" or "PENDING"
	AppliedAt *time.Time
}

// BaselineCheckResult holds the result of a single schema check during baseline verification.
type BaselineCheckResult struct {
	Name    string
	Type    string // "table", "column", "absence"
	Passed  bool
	Details string
}

// BaselineReport represents the audit report of schema verification against a target baseline.
type BaselineReport struct {
	TargetVersion string
	TotalChecks   int
	PassedCount   int
	FailedCount   int
	IsEmpty       bool
	IsMatch       bool
	Checks        []BaselineCheckResult
}

// ExpectedTables068 contains all 54 user tables expected in baseline 068.
// Note: org_recovery_principals was dropped in 058, and mailbox_filters was replaced by mail_rules in 040.
var ExpectedTables068 = []string{
	"organizations",
	"users",
	"domains",
	"root_secrets",
	"mailboxes",
	"aliases",
	"devices",
	"device_mailbox_access",
	"storage_connections",
	"mailbox_storage",
	"message_metadata",
	"search_index",
	"scheduled_messages",
	"outbound_queue",
	"auto_reply_rules",
	"drafts",
	"delivery_log",
	"audit_log",
	"outbound_reservations",
	"rate_limits",
	"sessions",
	"storage_migrations",
	"contacts",
	"google_drive_oauth_states",
	"search_tokens",
	"bridge_credentials",
	"attachments",
	"recovery_challenges",
	"account_invitations",
	"mailbox_settings",
	"mailbox_folders",
	"mailbox_labels",
	"message_labels",
	"mailbox_address_rules",
	"message_tracking",
	"user_passkeys",
	"auth_challenges",
	"support_audit_logs",
	"mail_rules",
	"masked_aliases",
	"masked_alias_reply_map",
	"import_jobs",
	"user_calendars",
	"calendar_events",
	"calendar_event_migrations",
	"mailbox_key_reactivations",
	"calendar_event_exceptions",
	"calendar_shares",
	"support_agents",
	"support_tickets",
	"support_ticket_messages",
	"support_notification_outbox",
	"support_reply_tokens",
	"support_inbound_dedup",
}

// ExpectedColumns068 contains critical columns introduced across historical migrations up through 068.
var ExpectedColumns068 = []struct {
	Table  string
	Column string
	Origin string
}{
	{"organizations", "seat_count", "055_seat_based_pricing.sql"},
	{"organizations", "subscription_status", "055_seat_based_pricing.sql"},
	{"message_metadata", "client_queue_id", "051_client_queue_id.sql"},
	{"users", "role", "010_rbac_roles.sql"},
	{"users", "recovery_auth_pk", "009_recovery_verifiers.sql"},
	{"scheduled_messages", "draft_storage_ref", "042_scheduled_draft_ref.sql"},
	{"drafts", "folder", "068_draft_folders.sql"},
	{"drafts", "folder_id", "068_draft_folders.sql"},
}

// ProhibitedObjects068 defines objects that must NOT be present in a true baseline 068 database.
// Their presence indicates the database has already had 069 or 070 partially or fully applied.
var ProhibitedObjects068 = []struct {
	Table       string
	Column      string // empty if table itself must not exist
	Description string
}{
	{"outbound_queue", "lease_token", "column lease_token is present in outbound_queue (indicates migration 069 was applied)"},
	{"outbound_delivery_attachments", "", "table outbound_delivery_attachments is present (indicates migration 070 was applied)"},
	{"outbound_delivery_keys", "", "table outbound_delivery_keys is present (indicates migration 070 was applied)"},
	{"draft_attachments", "", "table draft_attachments is present (indicates migration 070 was applied)"},
}

// SanitizeDBURL returns a URL string with user password redacted.
func SanitizeDBURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return "[malformed-db-url]"
	}
	if u.User != nil {
		if _, hasPass := u.User.Password(); hasPass {
			u.User = url.UserPassword(u.User.Username(), "REDACTED")
		}
	}
	return u.String()
}

// Migrator coordinates database schema migrations.
type Migrator struct {
	DBURL          string
	MigrationsDir  string
	LockID         int64
	AutoBaseline   bool
	BaselineTo     string // if set, force baseline up to this version
	StrictChecksum bool
	BackendPID     int    // recorded PostgreSQL backend PID holding lock
}

// NewMigrator creates a new Migrator instance with standard defaults.
func NewMigrator(dbURL, migrationsDir string) *Migrator {
	if migrationsDir == "" {
		migrationsDir = "infra/postgres/migrations"
	}
	return &Migrator{
		DBURL:          dbURL,
		MigrationsDir:  migrationsDir,
		LockID:         AdvisoryLockID,
		AutoBaseline:   true,
		StrictChecksum: true,
	}
}

// LoadMigrations scans migrationsDir and returns strictly ordered migrations.
func (m *Migrator) LoadMigrations() ([]Migration, error) {
	entries, err := os.ReadDir(m.MigrationsDir)
	if err != nil {
		return nil, fmt.Errorf("reading migrations directory %q: %w", m.MigrationsDir, err)
	}

	var migrations []Migration
	versionMap := make(map[string]string)

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		filename := entry.Name()
		matches := migrationFileRegex.FindStringSubmatch(filename)
		if matches == nil {
			continue
		}

		version := matches[1]
		if existing, exists := versionMap[version]; exists {
			return nil, fmt.Errorf("duplicate migration version %s: %s and %s", version, existing, filename)
		}
		versionMap[version] = filename

		filePath := filepath.Join(m.MigrationsDir, filename)
		contentBytes, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("reading migration file %q: %w", filePath, err)
		}

		// Strip UTF-8 BOM if present (EF BB BF)
		contentBytes = bytes.TrimPrefix(contentBytes, []byte("\xef\xbb\xbf"))

		hasher := sha256.New()
		hasher.Write(contentBytes)
		checksum := hex.EncodeToString(hasher.Sum(nil))

		migrations = append(migrations, Migration{
			Version:  version,
			Name:     filename,
			Path:     filePath,
			Checksum: checksum,
			Content:  string(contentBytes),
		})
	}

	sort.Slice(migrations, func(i, j int) bool {
		return migrations[i].Version < migrations[j].Version
	})

	if len(migrations) == 0 {
		return nil, fmt.Errorf("no migration files found in %q", m.MigrationsDir)
	}

	return migrations, nil
}

// AcquireAdvisoryLock acquires the PostgreSQL session-level advisory lock on conn.
func (m *Migrator) AcquireAdvisoryLock(ctx context.Context, conn *pgx.Conn) (func(), error) {
	var locked bool
	err := conn.QueryRow(ctx, "SELECT pg_try_advisory_lock($1)", m.LockID).Scan(&locked)
	if err != nil {
		return nil, fmt.Errorf("querying advisory lock: %w", err)
	}
	if !locked {
		return nil, fmt.Errorf("concurrent migration in progress: another deployment is holding advisory lock (lock ID: %d)", m.LockID)
	}

	var backendPID int
	_ = conn.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&backendPID)
	m.BackendPID = backendPID
	log.Printf("[LOCK] Acquired session-level advisory lock (lock ID: %d) on backend PID %d", m.LockID, backendPID)

	unlock := func() {
		_, err := conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", m.LockID)
		if err == nil {
			log.Printf("[LOCK] Released session-level advisory lock (lock ID: %d) on backend PID %d", m.LockID, backendPID)
		}
	}
	return unlock, nil
}

// EnsureSchemaMigrationsTable creates the schema_migrations tracking table if absent.
func (m *Migrator) EnsureSchemaMigrationsTable(ctx context.Context, conn *pgx.Conn) error {
	query := `
	CREATE TABLE IF NOT EXISTS schema_migrations (
		version VARCHAR(32) PRIMARY KEY,
		name VARCHAR(255) NOT NULL,
		checksum VARCHAR(64) NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
		execution_time_ms INTEGER NOT NULL DEFAULT 0
	);`
	_, err := conn.Exec(ctx, query)
	if err != nil {
		return fmt.Errorf("creating schema_migrations table: %w", err)
	}
	return nil
}

// VerifyBaseline performs comprehensive catalog verification against target baseline schema.
func (m *Migrator) VerifyBaseline(ctx context.Context, conn *pgx.Conn, targetVersion string) (*BaselineReport, error) {
	if targetVersion != "068" {
		return nil, fmt.Errorf("unsupported baseline target version: %s (only 068 is supported for baseline verification)", targetVersion)
	}

	report := &BaselineReport{
		TargetVersion: targetVersion,
	}

	// 1. Fetch all existing public base tables
	rows, err := conn.Query(ctx, `
		SELECT table_name 
		FROM information_schema.tables 
		WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
	`)
	if err != nil {
		return nil, fmt.Errorf("querying database tables: %w", err)
	}
	defer rows.Close()

	existingTables := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scanning table name: %w", err)
		}
		if name != "schema_migrations" {
			existingTables[name] = true
		}
	}

	// 2. Fetch all existing public columns
	colRows, err := conn.Query(ctx, `
		SELECT table_name, column_name 
		FROM information_schema.columns 
		WHERE table_schema = 'public'
	`)
	if err != nil {
		return nil, fmt.Errorf("querying database columns: %w", err)
	}
	defer colRows.Close()

	existingCols := make(map[string]bool)
	for colRows.Next() {
		var t, c string
		if err := colRows.Scan(&t, &c); err != nil {
			return nil, fmt.Errorf("scanning column: %w", err)
		}
		existingCols[t+"."+c] = true
	}

	// If database has 0 user tables, it's fresh/empty
	if len(existingTables) == 0 {
		report.IsEmpty = true
		report.IsMatch = false
		return report, nil
	}

	// Check all expected tables
	for _, table := range ExpectedTables068 {
		report.TotalChecks++
		if existingTables[table] {
			report.PassedCount++
			report.Checks = append(report.Checks, BaselineCheckResult{
				Name:    table,
				Type:    "table",
				Passed:  true,
				Details: "table present",
			})
		} else {
			report.FailedCount++
			report.Checks = append(report.Checks, BaselineCheckResult{
				Name:    table,
				Type:    "table",
				Passed:  false,
				Details: "missing expected table",
			})
		}
	}

	// Check all expected columns
	for _, col := range ExpectedColumns068 {
		report.TotalChecks++
		key := col.Table + "." + col.Column
		if existingCols[key] {
			report.PassedCount++
			report.Checks = append(report.Checks, BaselineCheckResult{
				Name:    key,
				Type:    "column",
				Passed:  true,
				Details: fmt.Sprintf("column present (from %s)", col.Origin),
			})
		} else {
			report.FailedCount++
			report.Checks = append(report.Checks, BaselineCheckResult{
				Name:    key,
				Type:    "column",
				Passed:  false,
				Details: fmt.Sprintf("missing expected column (from %s)", col.Origin),
			})
		}
	}

	// Check prohibited/conflicting objects
	for _, prob := range ProhibitedObjects068 {
		report.TotalChecks++
		if prob.Column == "" {
			if existingTables[prob.Table] {
				report.FailedCount++
				report.Checks = append(report.Checks, BaselineCheckResult{
					Name:    prob.Table,
					Type:    "absence",
					Passed:  false,
					Details: prob.Description,
				})
			} else {
				report.PassedCount++
				report.Checks = append(report.Checks, BaselineCheckResult{
					Name:    prob.Table,
					Type:    "absence",
					Passed:  true,
					Details: "prohibited table absent (verified baseline 068 boundary)",
				})
			}
		} else {
			key := prob.Table + "." + prob.Column
			if existingCols[key] {
				report.FailedCount++
				report.Checks = append(report.Checks, BaselineCheckResult{
					Name:    key,
					Type:    "absence",
					Passed:  false,
					Details: prob.Description,
				})
			} else {
				report.PassedCount++
				report.Checks = append(report.Checks, BaselineCheckResult{
					Name:    key,
					Type:    "absence",
					Passed:  true,
					Details: "prohibited column absent (verified baseline 068 boundary)",
				})
			}
		}
	}

	report.IsMatch = (report.FailedCount == 0)
	return report, nil
}

// CheckAndApplyBaseline handles existing unversioned databases safely.
func (m *Migrator) CheckAndApplyBaseline(ctx context.Context, conn *pgx.Conn, allMigrations []Migration) error {
	var count int
	err := conn.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&count)
	if err != nil {
		return fmt.Errorf("checking schema_migrations count: %w", err)
	}
	if count > 0 {
		return nil // Already has tracked migrations
	}

	report, err := m.VerifyBaseline(ctx, conn, "068")
	if err != nil {
		return fmt.Errorf("verifying baseline 068 schema: %w", err)
	}

	if report.IsEmpty {
		// Fresh empty database; proceed without baseline stamping
		log.Println("[BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.")
		return nil
	}

	if !report.IsMatch {
		var failedDetails []string
		for _, c := range report.Checks {
			if !c.Passed {
				failedDetails = append(failedDetails, fmt.Sprintf("- [%s] %s: %s", c.Type, c.Name, c.Details))
			}
		}
		return fmt.Errorf("baseline verification failed: database contains unexpected, partial, or conflicting schema (%d/%d checks passed). Cannot automatically stamp baseline 068:\n%s",
			report.PassedCount, report.TotalChecks, strings.Join(failedDetails, "\n"))
	}

	log.Printf("[BASELINE] Database positively verified against baseline 068 manifest (passed %d/%d checks).", report.PassedCount, report.TotalChecks)

	targetBaseline := "068"
	if m.BaselineTo != "" {
		targetBaseline = m.BaselineTo
	}

	log.Printf("[BASELINE] Stamping baseline migrations through %s in schema_migrations...", targetBaseline)

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("starting baseline transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	for _, mig := range allMigrations {
		if mig.Version > targetBaseline {
			break
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_time_ms)
			VALUES ($1, $2, $3, NOW(), 0)
			ON CONFLICT (version) DO NOTHING
		`, mig.Version, mig.Name, mig.Checksum)
		if err != nil {
			return fmt.Errorf("stamping baseline migration %s: %w", mig.Version, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("committing baseline stamp: %w", err)
	}

	log.Printf("[BASELINE] Successfully recorded baseline migrations through %s in schema_migrations.", targetBaseline)
	return nil
}

// GetAppliedMigrations reads all records from schema_migrations.
func (m *Migrator) GetAppliedMigrations(ctx context.Context, conn *pgx.Conn) ([]AppliedMigration, error) {
	rows, err := conn.Query(ctx, `
		SELECT version, name, checksum, applied_at, execution_time_ms 
		FROM schema_migrations 
		ORDER BY version ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("querying schema_migrations: %w", err)
	}
	defer rows.Close()

	var applied []AppliedMigration
	for rows.Next() {
		var a AppliedMigration
		if err := rows.Scan(&a.Version, &a.Name, &a.Checksum, &a.AppliedAt, &a.ExecutionTimeMs); err != nil {
			return nil, fmt.Errorf("scanning schema_migrations row: %w", err)
		}
		applied = append(applied, a)
	}
	return applied, nil
}

// VerifyIntegrity verifies that disk files match the records in schema_migrations.
func (m *Migrator) VerifyIntegrity(allMigrations []Migration, applied []AppliedMigration) error {
	diskMap := make(map[string]Migration)
	for _, mig := range allMigrations {
		diskMap[mig.Version] = mig
	}

	for _, app := range applied {
		mig, exists := diskMap[app.Version]
		if !exists {
			return fmt.Errorf("missing required migration file for already-applied version %s (%s)", app.Version, app.Name)
		}
		if m.StrictChecksum && mig.Checksum != app.Checksum {
			return fmt.Errorf("migration checksum mismatch for version %s (%s): stored checksum %s, current file checksum %s. Historical migrations must never be altered",
				app.Version, app.Name, app.Checksum, mig.Checksum)
		}
	}
	return nil
}

// EnsurePreMigrationPrerequisites runs idempotent safety inserts before certain historical migrations.
func (m *Migrator) EnsurePreMigrationPrerequisites(ctx context.Context, conn *pgx.Conn, version string) error {
	if version == "049" {
		_, err := conn.Exec(ctx, `
			INSERT INTO organizations (id, name, org_recovery_pk) 
			VALUES ('00000000-0000-0000-0000-000000000aaa', 'Smoke Test Org', '\x00'::bytea) 
			ON CONFLICT (id) DO NOTHING;
		`)
		if err != nil {
			return fmt.Errorf("ensuring prerequisite system organization for migration 049: %w", err)
		}
	}
	return nil
}

// Up runs all unapplied migrations in deterministic order.
func (m *Migrator) Up(ctx context.Context) (int, error) {
	conn, err := pgx.Connect(ctx, m.DBURL)
	if err != nil {
		return 0, fmt.Errorf("connecting to database (%s): %w", SanitizeDBURL(m.DBURL), err)
	}
	defer conn.Close(ctx)

	unlock, err := m.AcquireAdvisoryLock(ctx, conn)
	if err != nil {
		return 0, err
	}
	defer unlock()

	if err := m.EnsureSchemaMigrationsTable(ctx, conn); err != nil {
		return 0, err
	}

	allMigrations, err := m.LoadMigrations()
	if err != nil {
		return 0, err
	}

	if m.AutoBaseline || m.BaselineTo != "" {
		if err := m.CheckAndApplyBaseline(ctx, conn, allMigrations); err != nil {
			return 0, err
		}
	}

	applied, err := m.GetAppliedMigrations(ctx, conn)
	if err != nil {
		return 0, err
	}

	if err := m.VerifyIntegrity(allMigrations, applied); err != nil {
		return 0, err
	}

	appliedSet := make(map[string]bool)
	for _, app := range applied {
		appliedSet[app.Version] = true
	}

	var pending []Migration
	for _, mig := range allMigrations {
		if !appliedSet[mig.Version] {
			pending = append(pending, mig)
		}
	}

	if len(pending) == 0 {
		latestVersion := ""
		if len(applied) > 0 {
			latestVersion = applied[len(applied)-1].Version
		}
		log.Printf("Database schema is up to date (version %s). No pending migrations.", latestVersion)
		return 0, nil
	}

	log.Printf("Found %d pending migration(s) to apply.", len(pending))

	appliedCount := 0
	for _, mig := range pending {
		if err := m.EnsurePreMigrationPrerequisites(ctx, conn, mig.Version); err != nil {
			return appliedCount, err
		}

		log.Printf("Applying migration %s (%s)...", mig.Version, mig.Name)
		start := time.Now()

		isNonTransactional := strings.Contains(mig.Content, "-- byos-migrate: no-transaction")
		if isNonTransactional {
			log.Printf("[NON-TX] Migration %s (%s) marked as non-transactional; executing directly...", mig.Version, mig.Name)
			if _, err := conn.Exec(ctx, mig.Content); err != nil {
				return appliedCount, fmt.Errorf("migration %s (%s) failed during non-transactional execution: %w", mig.Version, mig.Name, err)
			}
			elapsed := int(time.Since(start).Milliseconds())
			_, err = conn.Exec(ctx, `
				INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_time_ms)
				VALUES ($1, $2, $3, NOW(), $4)
			`, mig.Version, mig.Name, mig.Checksum, elapsed)
			if err != nil {
				return appliedCount, fmt.Errorf("recording non-transactional migration %s in schema_migrations failed: %w", mig.Version, err)
			}
			log.Printf("[APPLIED] %s (%s) in %dms [NON-TX]", mig.Version, mig.Name, elapsed)
			appliedCount++
			continue
		}

		// Standard transactional path
		tx, err := conn.Begin(ctx)
		if err != nil {
			return appliedCount, fmt.Errorf("beginning transaction for %s: %w", mig.Version, err)
		}

		if _, err := tx.Exec(ctx, mig.Content); err != nil {
			_ = tx.Rollback(ctx)
			return appliedCount, fmt.Errorf("migration %s (%s) failed during execution: %w", mig.Version, mig.Name, err)
		}

		elapsed := int(time.Since(start).Milliseconds())

		_, err = tx.Exec(ctx, `
			INSERT INTO schema_migrations (version, name, checksum, applied_at, execution_time_ms)
			VALUES ($1, $2, $3, NOW(), $4)
		`, mig.Version, mig.Name, mig.Checksum, elapsed)
		if err != nil {
			_ = tx.Rollback(ctx)
			return appliedCount, fmt.Errorf("recording migration %s (%s) in schema_migrations failed: %w", mig.Version, mig.Name, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return appliedCount, fmt.Errorf("committing migration %s (%s) failed: %w", mig.Version, mig.Name, err)
		}

		log.Printf("[APPLIED] %s (%s) in %dms", mig.Version, mig.Name, elapsed)
		appliedCount++
	}

	log.Printf("Successfully applied %d migration(s). Database schema is now fully upgraded.", appliedCount)
	return appliedCount, nil
}

// Status returns the current status of all migrations.
func (m *Migrator) Status(ctx context.Context) ([]MigrationStatus, error) {
	conn, err := pgx.Connect(ctx, m.DBURL)
	if err != nil {
		return nil, fmt.Errorf("connecting to database (%s): %w", SanitizeDBURL(m.DBURL), err)
	}
	defer conn.Close(ctx)

	if err := m.EnsureSchemaMigrationsTable(ctx, conn); err != nil {
		return nil, err
	}

	allMigrations, err := m.LoadMigrations()
	if err != nil {
		return nil, err
	}

	applied, err := m.GetAppliedMigrations(ctx, conn)
	if err != nil {
		return nil, err
	}

	appliedMap := make(map[string]AppliedMigration)
	for _, app := range applied {
		appliedMap[app.Version] = app
	}

	var statuses []MigrationStatus
	for _, mig := range allMigrations {
		if app, exists := appliedMap[mig.Version]; exists {
			appliedAtCopy := app.AppliedAt
			statuses = append(statuses, MigrationStatus{
				Version:   mig.Version,
				Name:      mig.Name,
				Checksum:  mig.Checksum,
				State:     "APPLIED",
				AppliedAt: &appliedAtCopy,
			})
		} else {
			statuses = append(statuses, MigrationStatus{
				Version:   mig.Version,
				Name:      mig.Name,
				Checksum:  mig.Checksum,
				State:     "PENDING",
				AppliedAt: nil,
			})
		}
	}

	return statuses, nil
}

// Verify checks that all disk migrations have been applied and checksums match.
func (m *Migrator) Verify(ctx context.Context) error {
	conn, err := pgx.Connect(ctx, m.DBURL)
	if err != nil {
		return fmt.Errorf("connecting to database (%s): %w", SanitizeDBURL(m.DBURL), err)
	}
	defer conn.Close(ctx)

	if err := m.EnsureSchemaMigrationsTable(ctx, conn); err != nil {
		return err
	}

	allMigrations, err := m.LoadMigrations()
	if err != nil {
		return err
	}

	applied, err := m.GetAppliedMigrations(ctx, conn)
	if err != nil {
		return err
	}

	if err := m.VerifyIntegrity(allMigrations, applied); err != nil {
		return err
	}

	appliedSet := make(map[string]bool)
	for _, app := range applied {
		appliedSet[app.Version] = true
	}

	var missing []string
	for _, mig := range allMigrations {
		if !appliedSet[mig.Version] {
			missing = append(missing, fmt.Sprintf("%s (%s)", mig.Version, mig.Name))
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("database schema is not up to date; %d pending migration(s): %s", len(missing), strings.Join(missing, ", "))
	}

	return nil
}
