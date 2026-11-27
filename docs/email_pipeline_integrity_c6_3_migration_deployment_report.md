# BYOS Release C6.3: Canonical Database Migration Runner & Existing-Installation Upgrade Verification Report

## What was built

A standalone, canonical database migration runner (`tools/byos-migrate`) and Docker Compose service integration (`migrate`) providing robust, atomic, and versioned database schema migrations across both fresh installations and existing installations upgrading from historical baselines (pre-069 baseline 068). The runner establishes a single canonical source of truth for schema migrations in `infra/postgres/migrations/`, provides transactional DDL execution with automatic rollback, session-level advisory locking (`pg_try_advisory_lock`) to prevent concurrent deployments, SHA-256 checksum verification to detect historical migration tampering, automatic baseline detection for legacy databases without data loss or re-initialization, and Docker Compose dependency choreography ensuring `migrate` completes successfully before dependent services (`outbound-worker`, `api`) initialize.

---

## Files edited

| File | Reason |
|------|--------|
| `tools/byos-migrate/go.mod` | Defines Go module `byos-migrate` with Go 1.26 and pgx/v5 dependency |
| `tools/byos-migrate/main.go` | CLI entrypoint supporting `up`, `status`, `verify`, and `baseline` subcommands |
| `tools/byos-migrate/migrator.go` | Core migration engine with advisory locking, checksum verification, baseline detection, and transactional execution |
| `tools/byos-migrate/migrator_test.go` | Comprehensive automated test suite covering fresh bootstrap, baseline upgrade, rollbacks, checksum tampering, concurrency, and RBAC |
| `tools/byos-migrate/Dockerfile` | Multi-stage Docker container definition packaging `byos-migrate` on Alpine Linux |
| `infra/postgres/init/000_run_migrations.sh` | Fresh container initialization script executing migrations directly from canonical directory |
| `infra/postgres/migrations/` | Canonical directory holding all sequential migration SQL files (001 through 070) |
| `infra/postgres/migrations_unapplied/README.md` | Documents migration archive deprecation in favor of canonical source |
| `infra/docker-compose.yml` | Adds one-shot `migrate` service and configures `depends_on: migrate: condition: service_completed_successfully` for `api` and `outbound-worker` |
| `scripts/deploy-path-a.ps1` | Updates manual migration path to reference canonical `infra/postgres/migrations/` |
| `go.work` | Registers `./tools/byos-migrate` in root Go workspace |
| `docs/email_pipeline_integrity_c6_3_migration_deployment_report.md` | Comprehensive C6.3 verification and deployment report |

---

## 1. Previous Migration Architecture

In prior releases (C1 through C6.2), database migrations were copied into `infra/postgres/init/`. The official PostgreSQL Docker entrypoint (`docker-entrypoint.sh`) only executes scripts in `/docker-entrypoint-initdb.d/` when the data directory (`PGDATA`) is empty upon initial volume creation.

Consequently:
1. Fresh deployments created during automated CI or clean Docker volume initialization executed all SQL scripts sequentially.
2. Existing deployments with persistent Docker volumes (`postgres-data`) completely bypassed `/docker-entrypoint-initdb.d/` on container restart or image upgrade.
3. Migrations 069 (`outbound_queue_lease_and_outcomes.sql`) and 070 (`attachment_encryption_v2_and_delivery.sql`) remained unapplied on existing installations unless manually executed via external `psql` invocations.
4. Unapplied migrations on existing databases led to runtime failures when updated worker binaries expected new columns (such as `lease_token`, `lease_expires_at`, `recipients_delivered`, `recipients_failed`).
5. There was no schema tracking table (`schema_migrations`), no checksum verification, and no atomic rollback or concurrency locks.

---

## 2. Chosen Canonical Migration Source

The canonical migration directory is established at:
`infra/postgres/migrations/`

**Rationale:**
- **Single Source of Truth:** Separates schema migration definitions from container-specific initialization hooks. Both local tooling (`byos-migrate.exe`), Docker Compose (`migrate` service), and fresh container bootstrap (`000_run_migrations.sh`) read from the identical set of SQL files.
- **Elimination of Drift:** Previously, duplicate or partial migrations existed between `infra/postgres/init/` and `infra/postgres/migrations_unapplied/`. All 69 active migrations (001 through 070, with legacy 005 skipped in sequence) are now version-controlled in `infra/postgres/migrations/`.
- **Mount Safety:** Mounted read-only (`:ro`) into the `migrate` container at `/migrations` and the `postgres` container at `/migrations:ro`.

---

## 3. Migration Version Tracking Implementation

The tracking table is created automatically in PostgreSQL `public` schema:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(32) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    execution_time_ms INTEGER NOT NULL DEFAULT 0
);
```

**Key Tracking Guarantees:**
1. **Advisory Lock:** Acquires a 64-bit PostgreSQL session advisory lock (`pg_try_advisory_lock(4780962453531182930)`). If another instance holds the lock, execution fails closed immediately.
2. **SHA-256 Checksums:** Calculates SHA-256 over raw migration SQL bytes (stripping UTF-8 BOM if present). Verifies that every previously applied migration matches its recorded checksum. If historical files were altered, the runner halts with an explicit error before any statement runs.
3. **Missing File Detection:** Fails closed if a migration recorded in `schema_migrations` is missing from the migrations directory.
4. **Duplicate Version Detection:** Fails closed if two files share the same version prefix (e.g. `001_a.sql` and `001_b.sql`).
5. **Transactional Atomicity:** Each pending migration runs inside an isolated transaction (`BEGIN ... COMMIT`). If any statement fails, the transaction rolls back, and no entry is written to `schema_migrations`.
6. **Automatic Baseline Stamping:** When connecting to an existing unversioned database (where `schema_migrations` does not exist or is empty, but core application tables `organizations`, `users`, `mailboxes`, `outbound_queue` exist), the runner identifies the database as baseline 068. It computes checksums for migrations 001 through 068 and records them in `schema_migrations` in a single transaction before applying migrations 069 and 070.

---

## 4. Fresh-Install Verification

Automated test `TestPhase4_FreshDatabaseBootstrap` bootstraps an empty database, executes all 69 migrations, verifies `schema_migrations` records, and validates RBAC privileges.

### Raw Evidence: Fresh Database Bootstrap
```
=== RUN   TestPhase4_FreshDatabaseBootstrap
2026/11/22 19:51:13 Found 69 pending migration(s) to apply.
2026/11/22 19:51:13 Applying migration 001 (001_init.sql)...
2026/11/22 19:51:14 [APPLIED] 001 (001_init.sql) in 560ms
2026/11/22 19:51:14 Applying migration 002 (002_outbound_reservations.sql)...
2026/11/22 19:51:14 [APPLIED] 002 (002_outbound_reservations.sql) in 88ms
2026/11/22 19:51:14 Applying migration 003 (003_scheduled_enhancements.sql)...
2026/11/22 19:51:14 [APPLIED] 003 (003_scheduled_enhancements.sql) in 33ms
2026/11/22 19:51:14 Applying migration 004 (004_rate_limits.sql)...
2026/11/22 19:51:14 [APPLIED] 004 (004_rate_limits.sql) in 40ms
2026/11/22 19:51:14 Applying migration 006 (006_storage_enhancements.sql)...
2026/11/22 19:51:14 [APPLIED] 006 (006_storage_enhancements.sql) in 30ms
2026/11/22 19:51:14 Applying migration 007 (007_fix_storage_hardening.sql)...
2026/11/22 19:51:14 [APPLIED] 007 (007_fix_storage_hardening.sql) in 7ms
2026/11/22 19:51:14 Applying migration 008 (008_auth_sessions.sql)...
2026/11/22 19:51:14 [APPLIED] 008 (008_auth_sessions.sql) in 46ms
2026/11/22 19:51:14 Applying migration 009 (009_recovery_verifiers.sql)...
2026/11/22 19:51:14 [APPLIED] 009 (009_recovery_verifiers.sql) in 37ms
2026/11/22 19:51:14 Applying migration 010 (010_rbac_roles.sql)...
2026/11/22 19:51:14 [APPLIED] 010 (010_rbac_roles.sql) in 23ms
2026/11/22 19:51:14 Applying migration 011 (011_drafts_metadata.sql)...
2026/11/22 19:51:14 [APPLIED] 011 (011_drafts_metadata.sql) in 11ms
2026/11/22 19:51:14 Applying migration 012 (012_storage_migrations.sql)...
2026/11/22 19:51:14 [APPLIED] 012 (012_storage_migrations.sql) in 31ms
2026/11/22 19:51:14 Applying migration 013 (013_storage_migration_cutover.sql)...
2026/11/22 19:51:14 [APPLIED] 013 (013_storage_migration_cutover.sql) in 3ms
2026/11/22 19:51:14 Applying migration 014 (014_contacts.sql)...
2026/11/22 19:51:14 [APPLIED] 014 (014_contacts.sql) in 30ms
2026/11/22 19:51:14 Applying migration 015 (015_storage_migration_recovery.sql)...
2026/11/22 19:51:14 [APPLIED] 015 (015_storage_migration_recovery.sql) in 4ms
2026/11/22 19:51:14 Applying migration 016 (016_google_drive_provider.sql)...
2026/11/22 19:51:14 [APPLIED] 016 (016_google_drive_provider.sql) in 4ms
2026/11/22 19:51:14 Applying migration 017 (017_google_drive_oauth.sql)...
2026/11/22 19:51:14 [APPLIED] 017 (017_google_drive_oauth.sql) in 27ms
2026/11/22 19:51:14 Applying migration 018 (018_message_search_tokens.sql)...
2026/11/22 19:51:14 [APPLIED] 018 (018_message_search_tokens.sql) in 38ms
2026/11/22 19:51:14 Applying migration 019 (019_bridge_credentials.sql)...
2026/11/22 19:51:14 [APPLIED] 019 (019_bridge_credentials.sql) in 42ms
2026/11/22 19:51:14 Applying migration 020 (020_attachments.sql)...
2026/11/22 19:51:14 [APPLIED] 020 (020_attachments.sql) in 30ms
2026/11/22 19:51:14 Applying migration 021 (021_recovery_challenges.sql)...
2026/11/22 19:51:14 [APPLIED] 021 (021_recovery_challenges.sql) in 33ms
2026/11/22 19:51:14 Applying migration 022 (022_auto_reply_unique.sql)...
2026/11/22 19:51:14 [APPLIED] 022 (022_auto_reply_unique.sql) in 20ms
2026/11/22 19:51:14 Applying migration 023 (023_mailbox_invitations.sql)...
2026/11/22 19:51:14 [APPLIED] 023 (023_mailbox_invitations.sql) in 69ms
2026/11/22 19:51:14 Applying migration 024 (024_mailbox_settings_and_sessions.sql)...
2026/11/22 19:51:14 [APPLIED] 024 (024_mailbox_settings_and_sessions.sql) in 48ms
2026/11/22 19:51:14 Applying migration 025 (025_folders_and_labels.sql)...
2026/11/22 19:51:15 [APPLIED] 025 (025_folders_and_labels.sql) in 94ms
2026/11/22 19:51:15 Applying migration 026 (026_message_folders_and_labels.sql)...
2026/11/22 19:51:15 [APPLIED] 026 (026_message_folders_and_labels.sql) in 26ms
2026/11/22 19:51:15 Applying migration 027 (027_message_read_state.sql)...
2026/11/22 19:51:15 [APPLIED] 027 (027_message_read_state.sql) in 4ms
2026/11/22 19:51:15 Applying migration 028 (028_webmail_advanced_features.sql)...
2026/11/22 19:51:15 [APPLIED] 028 (028_webmail_advanced_features.sql) in 110ms
2026/11/22 19:51:15 Applying migration 029 (029_proton_sweet_spot.sql)...
2026/11/22 19:51:15 [APPLIED] 029 (029_proton_sweet_spot.sql) in 75ms
2026/11/22 19:51:15 Applying migration 030 (030_support_crm.sql)...
2026/11/22 19:51:15 [APPLIED] 030 (030_support_crm.sql) in 89ms
2026/11/22 19:51:15 Applying migration 031 (031_org_cascade_and_mandatory_2fa.sql)...
2026/11/22 19:51:15 [APPLIED] 031 (031_org_cascade_and_mandatory_2fa.sql) in 155ms
2026/11/22 19:51:15 Applying migration 032 (032_support_crm_org_mgmt.sql)...
2026/11/22 19:51:15 [APPLIED] 032 (032_support_crm_org_mgmt.sql) in 8ms
2026/11/22 19:51:15 Applying migration 033 (033_org_seat_capacity.sql)...
2026/11/22 19:51:15 [APPLIED] 033 (033_org_seat_capacity.sql) in 5ms
2026/11/22 19:51:15 Applying migration 034 (034_org_billing_and_resource_caps.sql)...
2026/11/22 19:51:15 [APPLIED] 034 (034_org_billing_and_resource_caps.sql) in 6ms
2026/11/22 19:51:15 Applying migration 035 (035_custom_domain_ownership_proofs.sql)...
2026/11/22 19:51:15 [APPLIED] 035 (035_custom_domain_ownership_proofs.sql) in 60ms
2026/11/22 19:51:15 Applying migration 036 (036_passkey_enrollments.sql)...
2026/11/22 19:51:15 [APPLIED] 036 (036_passkey_enrollments.sql) in 44ms
2026/11/22 19:51:15 Applying migration 037 (037_inbound_routing_aliases.sql)...
2026/11/22 19:51:15 [APPLIED] 037 (037_inbound_routing_aliases.sql) in 25ms
2026/11/22 19:51:15 Applying migration 038 (038_masked_address_directory.sql)...
2026/11/22 19:51:15 [APPLIED] 038 (038_masked_address_directory.sql) in 66ms
2026/11/22 19:51:15 Applying migration 039 (039_support_role_privilege_boundary.sql)...
2026/11/22 19:51:15 [APPLIED] 039 (039_support_role_privilege_boundary.sql) in 4ms
2026/11/22 19:51:15 Applying migration 040 (040_path_a_delivery_reservations.sql)...
2026/11/22 19:51:15 [APPLIED] 040 (040_path_a_delivery_reservations.sql) in 14ms
2026/11/22 19:51:15 Applying migration 041 (041_scheduled_path_a.sql)...
2026/11/22 19:51:15 [APPLIED] 041 (041_scheduled_path_a.sql) in 8ms
2026/11/22 19:51:15 Applying migration 042 (042_two_factor_auth.sql)...
2026/11/22 19:51:16 [APPLIED] 042 (042_two_factor_auth.sql) in 17ms
2026/11/22 19:51:16 Applying migration 043 (043_fix_org_invitations_fk.sql)...
2026/11/22 19:51:16 [APPLIED] 043 (043_fix_org_invitations_fk.sql) in 5ms
2026/11/22 19:51:16 Applying migration 044 (044_passkey_auth.sql)...
2026/11/22 19:51:16 [APPLIED] 044 (044_passkey_auth.sql) in 20ms
2026/11/22 19:51:16 Applying migration 045 (045_org_rbac.sql)...
2026/11/22 19:51:16 [APPLIED] 045 (045_org_rbac.sql) in 16ms
2026/11/22 19:51:16 Applying migration 046 (046_recovery_flow.sql)...
2026/11/22 19:51:16 [APPLIED] 046 (046_recovery_flow.sql) in 17ms
2026/11/22 19:51:16 Applying migration 047 (047_message_tracking.sql)...
2026/11/22 19:51:16 [APPLIED] 047 (047_message_tracking.sql) in 22ms
2026/11/22 19:51:16 Applying migration 048 (048_domain_dkim.sql)...
2026/11/22 19:51:16 [APPLIED] 048 (048_domain_dkim.sql) in 13ms
2026/11/22 19:51:16 Applying migration 049 (049_masked_domain_dkim.sql)...
2026/11/22 19:51:16 [APPLIED] 049 (049_masked_domain_dkim.sql) in 10ms
2026/11/22 19:51:16 Applying migration 050 (050_email_templates.sql)...
2026/11/22 19:51:16 [APPLIED] 050 (050_email_templates.sql) in 24ms
2026/11/22 19:51:16 Applying migration 051 (051_calendar_system.sql)...
2026/11/22 19:51:16 [APPLIED] 051 (051_calendar_system.sql) in 57ms
2026/11/22 19:51:16 Applying migration 052 (052_outbound_queue_recipient_hash.sql)...
2026/11/22 19:51:16 [APPLIED] 052 (052_outbound_queue_recipient_hash.sql) in 11ms
2026/11/22 19:51:16 Applying migration 053 (053_inbound_messages_thread_idx.sql)...
2026/11/22 19:51:16 [APPLIED] 053 (053_inbound_messages_thread_idx.sql) in 9ms
2026/11/22 19:51:16 Applying migration 054 (054_outbox_messages_thread_idx.sql)...
2026/11/22 19:51:16 [APPLIED] 054 (054_outbox_messages_thread_idx.sql) in 7ms
2026/11/22 19:51:16 Applying migration 055 (055_email_threading_integrity.sql)...
2026/11/22 19:51:16 [APPLIED] 055 (055_email_threading_integrity.sql) in 48ms
2026/11/22 19:51:16 Applying migration 056 (056_inbound_messages_recipient_idx.sql)...
2026/11/22 19:51:16 [APPLIED] 056 (056_inbound_messages_recipient_idx.sql) in 7ms
2026/11/22 19:51:16 Applying migration 057 (057_outbox_messages_recipient_idx.sql)...
2026/11/22 19:51:16 [APPLIED] 057 (057_outbox_messages_recipient_idx.sql) in 6ms
2026/11/22 19:51:16 Applying migration 058 (058_threading_reply_maps.sql)...
2026/11/22 19:51:16 [APPLIED] 058 (058_threading_reply_maps.sql) in 23ms
2026/11/22 19:51:16 Applying migration 059 (059_thread_reply_map_org_id.sql)...
2026/11/22 19:51:16 [APPLIED] 059 (059_thread_reply_map_org_id.sql) in 8ms
2026/11/22 19:51:16 Applying migration 060 (060_rate_limit_events.sql)...
2026/11/22 19:51:16 [APPLIED] 060 (060_rate_limit_events.sql) in 17ms
2026/11/22 19:51:16 Applying migration 061 (061_login_attempt_history.sql)...
2026/11/22 19:51:16 [APPLIED] 061 (061_login_attempt_history.sql) in 16ms
2026/11/22 19:51:16 Applying migration 062 (062_security_audit_events.sql)...
2026/11/22 19:51:17 [APPLIED] 062 (062_security_audit_events.sql) in 15ms
2026/11/22 19:51:17 Applying migration 063 (063_message_dispositions.sql)...
2026/11/22 19:51:17 [APPLIED] 063 (063_message_dispositions.sql) in 15ms
2026/11/22 19:51:17 Applying migration 064 (064_inbound_quarantine.sql)...
2026/11/22 19:51:17 [APPLIED] 064 (064_inbound_quarantine.sql) in 14ms
2026/11/22 19:51:17 Applying migration 065 (065_storage_retention_policies.sql)...
2026/11/22 19:51:17 [APPLIED] 065 (065_storage_retention_policies.sql) in 13ms
2026/11/22 19:51:17 Applying migration 066 (066_outbound_queue_dead_letter.sql)...
2026/11/22 19:51:17 [APPLIED] 066 (066_outbound_queue_dead_letter.sql) in 13ms
2026/11/22 19:51:17 Applying migration 067 (067_support_account_suspension_privileges.sql)...
2026/11/22 19:51:17 [APPLIED] 067 (067_support_account_suspension_privileges.sql) in 4ms
2026/11/22 19:51:17 Applying migration 068 (068_draft_folders.sql)...
2026/11/22 19:51:17 [APPLIED] 068 (068_draft_folders.sql) in 17ms
2026/11/22 19:51:17 Applying migration 069 (069_outbound_queue_lease_and_outcomes.sql)...
2026/11/22 19:51:17 [APPLIED] 069 (069_outbound_queue_lease_and_outcomes.sql) in 58ms
2026/11/22 19:51:17 Applying migration 070 (070_attachment_encryption_v2_and_delivery.sql)...
2026/11/22 19:51:17 [APPLIED] 070 (070_attachment_encryption_v2_and_delivery.sql) in 131ms
2026/11/22 19:51:17 Successfully applied 69 migration(s). Database schema is now fully upgraded.
2026/11/22 19:51:17 Database schema is up to date (version 070). No pending migrations.
--- PASS: TestPhase4_FreshDatabaseBootstrap (4.29s)
```

---

## 5. Existing-Installation Upgrade Verification

Automated test `TestPhase5_ExistingDatabaseUpgrade_Baseline068` sets up an existing unversioned database with migrations 001 through 068, inserts synthetic customer organizations, users, mailboxes, and outbound queue items, and invokes `byos-migrate`.

The runner detects the existing baseline, stamps versions 001..068 into `schema_migrations`, applies only 069 and 070, verifies customer data integrity, and checks idempotency on immediate re-execution.

### Raw Evidence: Existing Database Upgrade
```
=== RUN   TestPhase5_ExistingDatabaseUpgrade_Baseline068
    migrator_test.go:191: Applying baseline migrations 001 through 068...
2026/11/22 19:51:20 [BASELINE] Detected existing unversioned database. Stamping baseline migrations through 068...
2026/11/22 19:51:20 [BASELINE] Successfully recorded baseline migrations through 068 in schema_migrations.
2026/11/22 19:51:20 Found 2 pending migration(s) to apply.
2026/11/22 19:51:20 Applying migration 069 (069_outbound_queue_lease_and_outcomes.sql)...
2026/11/22 19:51:21 [APPLIED] 069 (069_outbound_queue_lease_and_outcomes.sql) in 76ms
2026/11/22 19:51:21 Applying migration 070 (070_attachment_encryption_v2_and_delivery.sql)...
2026/11/22 19:51:21 [APPLIED] 070 (070_attachment_encryption_v2_and_delivery.sql) in 164ms
2026/11/22 19:51:21 Successfully applied 2 migration(s). Database schema is now fully upgraded.
2026/11/22 19:51:21 Database schema is up to date (version 070). No pending migrations.
--- PASS: TestPhase5_ExistingDatabaseUpgrade_Baseline068 (3.94s)
```

---

## 6. Persistent-Volume Verification

The automated verification in `TestPhase5_ExistingDatabaseUpgrade_Baseline068` confirms:
1. **Pre-existing data intact:** Pre-existing customer rows inserted in `organizations`, `users`, `mailboxes`, and `outbound_queue` remained unmodified.
2. **New schema additions present:** Columns `lease_token`, `lease_expires_at`, `recipients_delivered`, `recipients_failed` in `outbound_queue` and table `message_attachments` columns were successfully added.
3. **Idempotency:** A second execution of `byos-migrate up` against the upgraded volume immediately confirmed:
   `Database schema is up to date (version 070). No pending migrations.`
   No DDL statements were re-executed, avoiding duplicates and errors.

---

## 7. Interrupted Migration and Recovery Verification

Automated test `TestPhase6_MigrationInterruptionAndRecovery` introduces a bad migration containing invalid SQL syntax, verifies that the transaction rolled back without polluting the database or recording the bad version, and verifies that fixing the file allows clean recovery and completion.

### Raw Evidence: Interruption and Rollback Recovery
```
=== RUN   TestPhase6_MigrationInterruptionAndRecovery
2026/11/22 19:51:21 Found 2 pending migration(s) to apply.
2026/11/22 19:51:21 Applying migration 001 (001_good.sql)...
2026/11/22 19:51:21 [APPLIED] 001 (001_good.sql) in 15ms
2026/11/22 19:51:21 Applying migration 002 (002_bad.sql)...
    migrator_test.go:345: Expected failure observed: migration 002 (002_bad.sql) failed during execution: ERROR: syntax error at or near "SYNTAX" (SQLSTATE 42601)
2026/11/22 19:51:21 Found 1 pending migration(s) to apply.
2026/11/22 19:51:21 Applying migration 002 (002_bad.sql)...
2026/11/22 19:51:21 [APPLIED] 002 (002_bad.sql) in 17ms
2026/11/22 19:51:21 Successfully applied 1 migration(s). Database schema is now fully upgraded.
--- PASS: TestPhase6_MigrationInterruptionAndRecovery (0.43s)
```

Automated tests also verify checksum mismatch detection and missing file detection:
```
=== RUN   TestPhase6_ChecksumMismatchDetection
2026/11/22 19:51:22 Found 1 pending migration(s) to apply.
2026/11/22 19:51:22 Applying migration 001 (001_first.sql)...
2026/11/22 19:51:22 [APPLIED] 001 (001_first.sql) in 4ms
2026/11/22 19:51:22 Successfully applied 1 migration(s). Database schema is now fully upgraded.
    migrator_test.go:423: Expected checksum mismatch error: migration checksum mismatch for version 001 (001_first.sql): stored checksum 515d38afb4c36fdbc7550518d5d516172253fc02915c12e25a6d7b4c3de5da72, current file checksum 97c8cbb51c79be4b2934b9b294929d589026e8d086bfb4fe2794193ee4dea259. Historical migrations must never be altered
--- PASS: TestPhase6_ChecksumMismatchDetection (0.36s)
=== RUN   TestPhase6_MissingRequiredMigrationFile
2026/11/22 19:51:22 Found 1 pending migration(s) to apply.
2026/11/22 19:51:22 Applying migration 001 (001_first.sql)...
2026/11/22 19:51:22 [APPLIED] 001 (001_first.sql) in 4ms
2026/11/22 19:51:22 Successfully applied 1 migration(s). Database schema is now fully upgraded.
    migrator_test.go:466: Expected missing file error: missing required migration file for already-applied version 001 (001_first.sql)
--- PASS: TestPhase6_MissingRequiredMigrationFile (0.32s)
=== RUN   TestPhase6_DuplicateVersionDetection
    migrator_test.go:485: Expected duplicate version error: duplicate migration version 001: 001_a.sql and 001_b.sql
--- PASS: TestPhase6_DuplicateVersionDetection (0.01s)
```

---

## 8. Concurrent Deployment Protection

To prevent race conditions during rolling deployments or multi-instance restarts, `byos-migrate` calls:
`SELECT pg_try_advisory_lock(4780962453531182930)`

If another deployment is running, `pg_try_advisory_lock` returns `false`, causing the runner to immediately terminate with an error without modifying database state.

### Raw Evidence: Advisory Lock Concurrency Protection
```
=== RUN   TestPhase6_ConcurrentDeploymentProtection
    migrator_test.go:520: Expected concurrent lock rejection: concurrent migration in progress: another deployment is holding advisory lock (lock ID: 4780962453531182930)
2026/11/22 19:51:22 Found 1 pending migration(s) to apply.
2026/11/22 19:51:22 Applying migration 001 (001_test.sql)...
2026/11/22 19:51:22 [APPLIED] 001 (001_test.sql) in 6ms
2026/11/22 19:51:22 Successfully applied 1 migration(s). Database schema is now fully upgraded.
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.39s)
```

---

## 9. Role and Privilege Validation

`byos-migrate` requires DDL privileges (typically owner/admin `byos` user) to create tables, alter columns, and grant permissions. Restricted worker roles (such as `outbound_worker_login`) must strictly fail closed if attempting to run migrations.

### Raw Evidence: Privilege Failure Enforcement
```
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
    migrator_test.go:570: Expected privilege failure: creating schema_migrations table: ERROR: permission denied for schema public (SQLSTATE 42501)
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (1.04s)
```

---

## 10. Outbound-Worker Startup Ordering

In `infra/docker-compose.yml`, startup order is strictly enforced via healthchecks and service completion:

```yaml
  postgres:
    # ...
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U byos -d byos"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    build:
      context: ..
      dockerfile: tools/byos-migrate/Dockerfile
    container_name: byos-migrate
    environment:
      DATABASE_URL: "postgres://byos:byos_dev_password@postgres:5432/byos?sslmode=disable"
      MIGRATIONS_DIR: "/migrations"
    volumes:
      - ./postgres/migrations:/migrations:ro
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

  outbound-worker:
    # ...
    depends_on:
      postgres:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
      crypto-worker:
        condition: service_started

  api:
    # ...
    depends_on:
      postgres:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
      # ...
```

This guarantees:
1. `postgres` must be healthy before `migrate` runs.
2. `migrate` executes all pending migrations to completion (exit code 0).
3. `outbound-worker` and `api` only start after `migrate` has finished successfully (`service_completed_successfully`).

---

## 11. Complete Regression Test Results

### 11.1 Migration Runner Suite
Command: `go test -count=1 -v ./tools/byos-migrate/...`
```
PASS
ok  	byos-migrate	10.940s
```

### 11.2 Mail Router Suite
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation?sslmode=disable"; go test -count=1 -v ./services/mail-router/...`
```
=== RUN   TestAliasRoutingRewritesRecipient
2026/11/22 19:52:01 stored inbound message id=cfee9080-598c-4a5f-b0be-9b9c67a21f17 mailbox=706cffdf-32ca-4a69-849f-5eba3813d8ab seq=9310 object=mailboxes/706cffdf-32ca-4a69-849f-5eba3813d8ab/00000000000000009310.eml.enc
--- PASS: TestAliasRoutingRewritesRecipient (0.32s)
=== RUN   TestAliasRoutingRejectsUnknown
--- PASS: TestAliasRoutingRejectsUnknown (0.02s)
=== RUN   TestAliasRoutingRejectsDisabled
--- PASS: TestAliasRoutingRejectsDisabled (0.16s)
=== RUN   TestAliasReplyMapInserted
2026/11/22 19:52:01 stored inbound message id=9be7474b-d30f-40df-a3dc-87fc6c2c87fe mailbox=c52dcac9-9673-4017-8dc1-ffd99350ba79 seq=9311 object=mailboxes/c52dcac9-9673-4017-8dc1-ffd99350ba79/00000000000000009311.eml.enc
--- PASS: TestAliasReplyMapInserted (0.23s)
=== RUN   TestDependencyMinimums
--- PASS: TestDependencyMinimums (0.00s)
=== RUN   TestNormalizeAddress
--- PASS: TestNormalizeAddress (0.00s)
=== RUN   TestSplitAddress
--- PASS: TestSplitAddress (0.00s)
=== RUN   TestNormalizeMessageID
--- PASS: TestNormalizeMessageID (0.00s)
=== RUN   TestDeliveryIdentityDeterminism
--- PASS: TestDeliveryIdentityDeterminism (0.00s)
=== RUN   TestEnvOrDefault
--- PASS: TestEnvOrDefault (0.00s)
=== RUN   TestHealthHandler
--- PASS: TestHealthHandler (0.00s)
=== RUN   TestInboundHandlerValidation
--- PASS: TestInboundHandlerValidation (0.00s)
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Left_part_casing_preserved
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Surrounding_whitespace_trimmed
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Bare_identifier_without_brackets
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Trailing_comments_or_jammed_IDs_dropped
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Multiple_jammed_IDs_in_header_line
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Folded_whitespace_and_tabs
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Empty_input
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Whitespace_only
=== RUN   TestPhase1_MessageID_CasePreservationAndCleaning/Malformed_empty_brackets
--- PASS: TestPhase1_MessageID_CasePreservationAndCleaning (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Left_part_casing_preserved (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Surrounding_whitespace_trimmed (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Bare_identifier_without_brackets (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Trailing_comments_or_jammed_IDs_dropped (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Multiple_jammed_IDs_in_header_line (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Folded_whitespace_and_tabs (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Empty_input (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Whitespace_only (0.00s)
    --- PASS: TestPhase1_MessageID_CasePreservationAndCleaning/Malformed_empty_brackets (0.00s)
=== RUN   TestPhase1_ReferencesParsing
--- PASS: TestPhase1_ReferencesParsing (0.00s)
=== RUN   TestPhase1_ComputeThreadID_DatabasePriority
--- PASS: TestPhase1_ComputeThreadID_DatabasePriority (0.33s)
=== RUN   TestPhase2_StripBccHeader_MIMEStorageSanitization
--- PASS: TestPhase2_StripBccHeader_MIMEStorageSanitization (0.00s)
=== RUN   TestPhase2_MetadataRecipients_VisibleIsolation
--- PASS: TestPhase2_MetadataRecipients_VisibleIsolation (0.00s)
=== RUN   TestPhase3_PartialDelivery_NeverHidesRecipientFailures
--- PASS: TestPhase3_PartialDelivery_NeverHidesRecipientFailures (0.52s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_SupportAddresses
--- PASS: TestPhase4_RecipientVerifyEndpoint_SupportAddresses (0.00s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_AuthProtection
--- PASS: TestPhase4_RecipientVerifyEndpoint_AuthProtection (0.00s)
=== RUN   TestPhase2_MessageID_ThreadingSafetyMatrix
--- PASS: TestPhase2_MessageID_ThreadingSafetyMatrix (0.24s)
PASS
ok  	byos.email/services/mail-router	2.124s
```

### 11.3 Inbound Bridge Suite
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation?sslmode=disable"; go test -count=1 -v ./services/inbound-bridge/...`
```
=== RUN   TestNormalizeSMTPAddress
--- PASS: TestNormalizeSMTPAddress (0.00s)
=== RUN   TestIsExpectedInternalKey
--- PASS: TestIsExpectedInternalKey (0.00s)
=== RUN   TestSessionRcptVerify_AcceptValid
--- PASS: TestSessionRcptVerify_AcceptValid (0.01s)
=== RUN   TestSessionRcptVerify_RejectUnknown
--- PASS: TestSessionRcptVerify_RejectUnknown (0.00s)
=== RUN   TestSessionRcptVerify_TemporaryFailure
2026/11/22 19:52:22 [WARN] mail-router recipient verify unexpected status=500
--- PASS: TestSessionRcptVerify_TemporaryFailure (0.00s)
=== RUN   TestSessionData_NoRecipients
--- PASS: TestSessionData_NoRecipients (0.00s)
=== RUN   TestPhase4_VerifyMatrix_UnknownRecipient_550
--- PASS: TestPhase4_VerifyMatrix_UnknownRecipient_550 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ValidRecipient_Accept
--- PASS: TestPhase4_VerifyMatrix_ValidRecipient_Accept (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ServiceUnavailable_451
2026/11/22 19:52:22 [WARN] mail-router service unavailable during recipient verify: status=503
--- PASS: TestPhase4_VerifyMatrix_ServiceUnavailable_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InternalAuthFailure_451
2026/11/22 19:52:22 [WARN] mail-router rejected internal auth for recipient verify: status=403
--- PASS: TestPhase4_VerifyMatrix_InternalAuthFailure_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject
2026/11/22 19:52:22 [WARN] mail-router rejected verify request as bad request: recipient="malformed@address.local"
--- PASS: TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject (0.00s)
=== RUN   TestPhase4_VerifyMatrix_SyntacticallyInvalid_501
--- PASS: TestPhase4_VerifyMatrix_SyntacticallyInvalid_501 (0.00s)
=== RUN   TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification
2026/11/22 19:52:22 router rejected message status=502 Bad Gateway body=502 partial delivery failure: simulated temporary failure for recipientb@byos.local
2026/11/22 19:52:22 accepted message from=sender@external.net recipients=2 bytes=204
2026/11/22 19:52:22 accepted message from=sender@external.net recipients=2 bytes=204
2026/11/22 19:52:22 router rejected message status=503 Service Unavailable body=503 service unavailable (pre-persistence failure)
2026/11/22 19:52:22 router rejected message status=500 Internal Server Error body=500 internal server error after commits
2026/11/22 19:52:22 accepted message from=sender@external.net recipients=1 bytes=204
2026/11/22 19:52:22 router rejected message status=500 Internal Server Error body=500 database transaction serialization failure
2026/11/22 19:52:22 router rejected message status=503 Service Unavailable body=503 object storage unreachable
2026/11/22 19:52:22 accepted message from=sender@external.net recipients=1 bytes=204
2026/11/22 19:52:22 accepted message from=sender@external.net recipients=1 bytes=204
--- PASS: TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification (0.02s)
PASS
ok  	github.com/byos/byos-email/services/inbound-bridge	2.389s
```

### 11.4 Outbound Worker Rust Unit Tests
Command: `docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo test --bin byos-outbound-worker -- --skip pg_tests`
```
test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 12.28s
```

### 11.5 Outbound Worker PostgreSQL Integration Tests
Command: `docker run --rm --network byos-email_default -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -w /workspace/services/outbound-worker -e OUTBOUND_TEST_ADMIN_PG_URL="postgres://byos:byos_dev_password@byos-postgres:5432/byos_test_isolation?sslmode=disable" -e OUTBOUND_TEST_PG_URL="postgres://outbound_worker_login:byos_outbound_worker_dev@byos-postgres:5432/byos_test_isolation?sslmode=disable" rustlang/rust:nightly-slim cargo test --bin byos-outbound-worker pg_tests -- --test-threads=1`
```
running 13 tests
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test pg_tests::test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_release_b_interrupted_retrieval_and_performance_metrics ... ok
test pg_tests::test_pg_release_b_least_privilege_rbac_and_e2e_attachments_25mib_and_failures ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok
test pg_tests::test_pg_verify_queue_lease_schema_presence_and_missing ... ok

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 100.52s
```

### 11.6 Outbound Worker Legacy Go Tests
Command: `$env:GOWORK="off"; Set-Location services/outbound-worker/legacy; go test -count=1 -v .`
```
=== RUN   TestParseAndValidateRecipients
--- PASS: TestParseAndValidateRecipients (0.00s)
=== RUN   TestStripBccHeaders
--- PASS: TestStripBccHeaders (0.00s)
=== RUN   TestDeliverToSmtpServerCapture
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<to@example.com>
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<cc@example.com>
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<bcc1@example.com>
    main_test.go:204: [GO-SMTP-CAPTURE] RCPT TO:<bcc2@example.com>
    main_test.go:206: [GO-SMTP-CAPTURE] DATA Payload:
        From: sender@byos.local\r\n
        To: to@example.com\r\n
        Cc: cc@example.com\r\n
        Subject: Multi Test\r\n
        \r\n
        Body with Bcc: secret-note
--- PASS: TestDeliverToSmtpServerCapture (0.01s)
PASS
ok  	github.com/byos/byos-email/services/outbound-worker	1.283s
```

### 11.7 Core API DKIM Tests
Command: `go test -count=1 -v -run "TestOutboundMessageDKIMHeaderFormat" ./services/api`
```
=== RUN   TestOutboundMessageDKIMHeaderFormat
=== RUN   TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender
=== RUN   TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender
=== NAME  TestOutboundMessageDKIMHeaderFormat
    outbound_dkim_test.go:120: Verified 0 delivered messages in Mailpit for correct header.i format
--- PASS: TestOutboundMessageDKIMHeaderFormat (0.04s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender (0.00s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender (0.00s)
PASS
ok  	byos.email/services/api	0.349s
```

### 11.8 Crypto Workspace Tests
Command: `docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -w /workspace rustlang/rust:nightly-slim cargo test --workspace`
```
test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 30.80s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.29s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.39s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
```

### 11.9 Webmail NPM Tests
Command: `cmd.exe /c "cd apps\webmail && npm test"`
```
OVERALL: 735 passed, 0 failed
```

### 11.10 Webmail Build
Command: `cmd.exe /c "cd apps\webmail && npm run build"`
```
✓ 340 modules transformed.
dist/index.html                                    1.86 kB │ gzip:   0.88 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-Cj7wMlFc.css                   171.44 kB │ gzip:  26.04 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-Ct6oJHVI.js                  3,587.79 kB │ gzip: 777.99 kB
✓ built in 15.46s
```

### 11.11 Go Vet
Command: `go vet ./tools/byos-migrate/... ./services/mail-router/... ./services/inbound-bridge/... ./services/api/...`
```
[Command exited with code 0 - zero warnings/errors]
```

---

## 12. Deployment Instructions for an Existing Installation

For any existing installation running a persistent database volume from an earlier version:

1. **Pull the latest release repository:**
   ```bash
   git pull origin main
   ```
2. **Review migration status (Dry-run inspect):**
   ```bash
   docker run --rm --network byos-net \
     -v $(pwd)/infra/postgres/migrations:/migrations:ro \
     -e DATABASE_URL="postgres://byos:byos_dev_password@byos-postgres:5432/byos?sslmode=disable" \
     -e MIGRATIONS_DIR="/migrations" \
     byos-migrate status
   ```
   *Expected output:* Shows migrations 001..068 stamped as baseline and 069, 070 pending.
3. **Execute migration upgrade:**
   ```bash
   docker compose -f infra/docker-compose.yml up --build migrate
   ```
   *Behavior:* The runner detects existing unversioned tables, stamps versions 001..068 into `schema_migrations`, applies 069 and 070 transactionally, and exits with code 0.
4. **Deploy application services:**
   ```bash
   docker compose -f infra/docker-compose.yml up -d --build
   ```
   *Note:* The Docker Compose configuration automatically ensures `api` and `outbound-worker` wait for `migrate` to complete before initializing.

---

## 13. Remaining Limitations

1. **Transactional DDL Limitations in PostgreSQL:** Certain PostgreSQL DDL statements (such as `CREATE INDEX CONCURRENTLY` or `ALTER TYPE ... ADD VALUE` in some historical PostgreSQL versions) cannot execute inside multi-statement transactions. All current BYOS migrations use standard non-concurrent index creation compatible with transactions. Any future migration requiring non-transactional execution would require a special directive (e.g. `-- no-transaction`).
2. **Downward Migrations (`down`):** `byos-migrate` intentionally only implements forward migrations (`up`). Reversing cryptographic or relational database schema in a production zero-knowledge email system is destructive; forward remediation migrations are preferred.
3. **External Production Connection:** In air-gapped or non-Docker environments, the administrator must provide `DATABASE_URL` pointing to the primary PostgreSQL instance with sufficient administrative privileges to alter tables and types.
