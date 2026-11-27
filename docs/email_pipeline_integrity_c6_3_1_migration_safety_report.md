# Release C6.3.1: Migration Baseline Safety & Real Compose Deployment Verification Report

## What was built

In Release C6.3.1, we performed a comprehensive audit and hardening of the canonical database migration runner `tools/byos-migrate`, its baseline detection safety, its Docker Compose startup integration, and validated both fresh and existing persistent-volume deployments:

1. **Comprehensive Manifest-Based Baseline Verification (`tools/byos-migrate/migrator.go`):** Replaced the fragile 4-table heuristic with a strict 66-point structural catalog verification manifest for baseline 068 (checking 54 user tables, 8 critical schema columns, and 4 prohibited post-baseline objects). Any discrepancy causes the migrator to fail closed with a diagnostic report rather than corrupting or skipping migrations.
2. **Controlled Operator CLI (`tools/byos-migrate/main.go`):** Added a dedicated `byos-migrate baseline --version 068 [--confirm]` command that performs preflight catalog checks and outputs an audit table. Operator cannot bypass failed checks even with `--confirm`. Added `--help` returning code 0, invalid commands exiting 1, and masked database credentials in logs via `SanitizeDBURL`.
3. **Session-Level Advisory Lock Pinning:** Configured advisory lock acquisition (`pg_try_advisory_lock(4780962453531182930)`) on a single physical `pgx.Conn` with backend PID logging (`SELECT pg_backend_pid()`), ensuring lock retention across all transactions and automatic disconnection release on network drop.
4. **Init Directory Audit & Clean Bootstrap (`infra/postgres/init/`):** Removed 69 historical duplicate `.sql` files from `infra/postgres/init/` to prevent duplicate execution after `000_run_migrations.sh`. Updated PostgreSQL TCP healthcheck probe (`pg_isready -h 127.0.0.1 -U byos -d byos`) so external services do not connect prematurely during entrypoint initialization.
5. **Compose Startup Dependency Graph (`infra/docker-compose.yml`):** Enforced `migrate: condition: service_completed_successfully` across all database-dependent services (`api`, `outbound-worker`, `admin-api`, `storage-worker`, `mail-router`).
6. **Non-Transactional Migration Directives:** Implemented support for `-- byos-migrate: no-transaction` allowing individual migrations containing non-transactional PostgreSQL DDL (such as `CREATE INDEX CONCURRENTLY` or `ALTER TYPE ... ADD VALUE`) to execute outside explicit transactions while safely recording their execution in `schema_migrations`.
7. **Real Docker Compose Verification:** Executed full end-to-end tests against both an existing persistent data volume (`c631_existing_vol`) and a fresh empty volume (`c631_fresh_vol`), demonstrating clean upgrades, data preservation, and startup idempotency.

---

## Files edited

| File | Reason |
|------|--------|
| `tools/byos-migrate/migrator.go` | Added 66-point baseline 068 manifest verification, advisory lock connection pinning, backend PID tracking, and non-transactional migration support |
| `tools/byos-migrate/main.go` | Implemented operator baseline CLI command with preflight audit, sanitized credential masking, `--help` exit code 0, and invalid command handling |
| `tools/byos-migrate/migrator_test.go` | Created 13 unit and integration tests covering baseline preflight, partial schema failure, conflicting post-baseline schema failure, lock session pinning, lock disconnect release, interruption recovery, non-transactional DDL, checksum mismatch, missing file, duplicate version, concurrency protection, and permission errors |
| `tools/byos-migrate/byos-migrate.exe` | Rebuilt canonical migration runner binary for Windows |
| `infra/postgres/init/000_run_migrations.sh` | Hardened initdb hook with schema_migrations table alignment and fail-closed directory checks |
| `infra/postgres/init/*.sql` | Removed 69 duplicate historical SQL migration files from initdb directory |
| `infra/postgres/migrations/026_message_folders_and_labels.sql` | Stripped UTF-8 BOM to prevent psql parse errors |
| `infra/postgres/migrations/027_message_read_state.sql` | Stripped UTF-8 BOM to prevent psql parse errors |
| `infra/docker-compose.yml` | Added migrate dependency to all database services and updated postgres healthcheck to TCP probe |
| `infra/docker-compose.disposable-test.yml` | Added isolated compose override with port override directives for Phase 3 testing |
| `tests/compose_c631_verification.ps1` | Created automated end-to-end Compose upgrade and fresh install verification script |
| `docs/email_pipeline_integrity_c6_3_1_migration_safety_report.md` | Comprehensive C6.3.1 migration safety report |

---

## 1. Baseline Detection Analysis

The pre-C6.3.1 migration runner determined baseline 068 state by testing for the existence of 4 arbitrary tables: `users`, `organizations`, `mailboxes`, `domains`.

Our audit identified the following critical vulnerabilities with that heuristic:
1. **Partial Schema Stamping:** If a database initialization was interrupted or stopped midway through an earlier release (e.g. at migration 020), those 4 core tables already existed. The old heuristic would falsely identify the database as baseline 068, skipping migrations 021 through 068 and corrupting the production schema.
2. **Conflicting Post-Baseline Schema:** If a database had already partially applied migrations 069 or 070 (e.g. from an unversioned deployment attempt), the old heuristic would stamp baseline 068 and subsequently attempt to re-apply 069/070, leading to `relation already exists` or `column already exists` DDL aborts.
3. **Foreign / Unrelated Database Collisions:** An operator pointing the migration runner at an unrelated database sharing common table names (`users`, `organizations`) would have baseline 068 stamped blindly without any structural schema validation.

---

## 2. Baseline Verification Strategy

To resolve these vulnerabilities, `tools/byos-migrate/migrator.go` implements `VerifyBaseline(ctx, conn, "068")` returning a comprehensive `BaselineReport`. The check evaluates:

1. **54 Expected User Tables:**
   `organizations`, `users`, `domains`, `root_secrets`, `mailboxes`, `aliases`, `devices`, `device_mailbox_access`, `storage_connections`, `mailbox_storage`, `message_metadata`, `search_index`, `scheduled_messages`, `outbound_queue`, `auto_reply_rules`, `drafts`, `delivery_log`, `audit_log`, `outbound_reservations`, `rate_limits`, `sessions`, `storage_migrations`, `contacts`, `google_drive_oauth_states`, `search_tokens`, `bridge_credentials`, `attachments`, `recovery_challenges`, `account_invitations`, `mailbox_settings`, `mailbox_folders`, `mailbox_labels`, `message_labels`, `mailbox_address_rules`, `message_tracking`, `user_passkeys`, `auth_challenges`, `support_audit_logs`, `mail_rules`, `masked_aliases`, `masked_alias_reply_map`, `import_jobs`, `user_calendars`, `calendar_events`, `calendar_event_migrations`, `mailbox_key_reactivations`, `calendar_event_exceptions`, `calendar_shares`, `support_agents`, `support_tickets`, `support_ticket_messages`, `support_notification_outbox`, `support_reply_tokens`, `support_inbound_dedup`.
   *(Note: `org_recovery_principals` was dropped in 058 and `mailbox_filters` was replaced by `mail_rules` in 040).*
2. **8 Critical Baseline Columns:**
   - `organizations.seat_count` (added in 055)
   - `organizations.subscription_status` (added in 055)
   - `message_metadata.client_queue_id` (added in 051)
   - `users.role` (added in 010)
   - `users.recovery_auth_pk` (added in 009)
   - `scheduled_messages.draft_storage_ref` (added in 042)
   - `drafts.folder` (added in 068)
   - `drafts.folder_id` (added in 068)
3. **4 Prohibited Post-Baseline Objects:**
   - Absence of `outbound_queue.lease_token` (from 069)
   - Absence of `outbound_delivery_attachments` (from 070)
   - Absence of `outbound_delivery_keys` (from 070)
   - Absence of `draft_attachments` (from 070)

If any check fails, baseline stamping is aborted with a structured diagnostic error and exit code 1.

---

## 3. Advisory Lock Connection-Pinning Evidence

The migration runner acquires PostgreSQL session-level advisory lock `4780962453531182930` on a single dedicated `*pgx.Conn`. The backend PID is queried via `SELECT pg_backend_pid()` and logged.

Raw terminal evidence from `migrator_test.go` (`TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease`):

```
=== RUN   TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease
2026/11/22 21:14:24 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39651
    migrator_test.go:489: Verified advisory lock is held on backend PID 39651
    migrator_test.go:501: Verified concurrent connection is blocked by held lock
2026/11/22 21:14:24 Disconnecting backend PID 39651 to simulate network interruption...
    migrator_test.go:514: Verified advisory lock was automatically released upon connection termination
2026/11/22 21:14:24 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39652
2026/11/22 21:14:24 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39652
    migrator_test.go:523: Verified second connection successfully acquired advisory lock after disconnect
--- PASS: TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease (0.34s)
```

---

## 4. Fresh Compose Initialization Results

Raw terminal evidence from `tests/compose_c631_verification.ps1` (Scenario B):

```
>>> [SCENARIO B] 1. Creating second disposable volume for fresh installation: c631_fresh_vol
c631_fresh_vol

>>> [SCENARIO B] 2. Starting fresh Docker Compose deployment...
 Container byos-test-c631-minio Starting 
 Container byos-test-c631-redis Starting 
 Container byos-test-c631-crypto-worker Starting 
 Container byos-test-c631-postgres Starting 
 Container byos-test-c631-postgres Healthy 
 Container byos-test-c631-migrate Starting 
 Container byos-test-c631-migrate Started 
 Container byos-test-c631-redis Healthy 
 Container byos-test-c631-minio Healthy 
 Container byos-test-c631-migrate Exited 
 Container byos-test-c631-api Starting 
 Container byos-test-c631-outbound-worker Starting 
 Container byos-test-c631-api Started 
 Container byos-test-c631-outbound-worker Started 
Waiting for postgres and migrate services to complete initialization...
Fresh install migrate container logs:
2026/11/22 15:11:15 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 982
2026/11/22 15:11:15 Database schema is up to date (version 070). No pending migrations.
2026/11/22 15:11:15 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 982
SUCCESS: Applied 0 migration(s).
Fresh install postgres entrypoint logs (checking 000_run_migrations.sh execution):

[POSTGRES-INIT] Applying canonical migrations from /migrations...
[POSTGRES-INIT] Applying 001_init.sql...
[POSTGRES-INIT] Applying 002_outbound_reservations.sql...
[POSTGRES-INIT] Applying 003_scheduled_enhancements.sql...
[POSTGRES-INIT] Applying 004_rate_limits.sql...
[POSTGRES-INIT] Applying 006_storage_enhancements.sql...
[POSTGRES-INIT] Applying 007_fix_storage_hardening.sql...
[POSTGRES-INIT] Applying 008_auth_sessions.sql...
[POSTGRES-INIT] Applying 009_recovery_verifiers.sql...
[POSTGRES-INIT] Applying 010_rbac_roles.sql...
[POSTGRES-INIT] Applying 011_drafts_metadata.sql...
[POSTGRES-INIT] Applying 012_storage_migrations.sql...
[POSTGRES-INIT] Applying 013_storage_migration_cutover.sql...
[POSTGRES-INIT] Applying 014_contacts.sql...
[POSTGRES-INIT] Applying 015_storage_migration_recovery.sql...
[POSTGRES-INIT] Applying 016_google_drive_provider.sql...
[POSTGRES-INIT] Applying 017_google_drive_oauth.sql...
[POSTGRES-INIT] Applying 018_message_search_tokens.sql...
[POSTGRES-INIT] Applying 019_bridge_credentials.sql...
[POSTGRES-INIT] Applying 020_attachments.sql...
[POSTGRES-INIT] Applying 021_recovery_challenges.sql...
[POSTGRES-INIT] Applying 022_auto_reply_unique.sql...
[POSTGRES-INIT] Applying 023_mailbox_invitations.sql...
[POSTGRES-INIT] Applying 024_mailbox_settings_and_sessions.sql...
[POSTGRES-INIT] Applying 025_folders_and_labels.sql...
[POSTGRES-INIT] Applying 026_message_folders_and_labels.sql...
[POSTGRES-INIT] Applying 027_message_read_state.sql...
[POSTGRES-INIT] Applying 028_webmail_advanced_features.sql...
[POSTGRES-INIT] Applying 029_proton_sweet_spot.sql...
[POSTGRES-INIT] Applying 030_support_crm.sql...
[POSTGRES-INIT] Applying 031_org_cascade_and_mandatory_2fa.sql...
[POSTGRES-INIT] Applying 032_support_crm_org_mgmt.sql...
[POSTGRES-INIT] Applying 033_org_seat_capacity.sql...
[POSTGRES-INIT] Applying 034_org_billing_and_resource_caps.sql...
[POSTGRES-INIT] Applying 035_xwing_storage.sql...
[POSTGRES-INIT] Applying 036_key_directory.sql...
[POSTGRES-INIT] Applying 037_threading.sql...
[POSTGRES-INIT] Applying 038_stars.sql...
[POSTGRES-INIT] Applying 039_snooze.sql...
[POSTGRES-INIT] Applying 040_mail_rules.sql...
[POSTGRES-INIT] Applying 041_scheduled_path_a.sql...
[POSTGRES-INIT] Applying 042_scheduled_draft_ref.sql...
[POSTGRES-INIT] Applying 043_scheduled_messages_sent_status.sql...
[POSTGRES-INIT] Applying 044_outbound_queue_scheduled_unique.sql...
[POSTGRES-INIT] Applying 045_attachment_envelopes.sql...
[POSTGRES-INIT] Applying 046_nested_labels.sql...
[POSTGRES-INIT] Applying 047_scheduled_attachments.sql...
[POSTGRES-INIT] Applying 048_masked_aliases.sql...
[POSTGRES-INIT] Applying 049_masked_domain_dkim.sql...
[POSTGRES-INIT] Applying 050_focused_inbox_categories.sql...
[POSTGRES-INIT] Applying 051_client_queue_id.sql...
[POSTGRES-INIT] Applying 052_contacts_metadata.sql...
[POSTGRES-INIT] Applying 053_profile_photos.sql...
[POSTGRES-INIT] Applying 054_oauth_import.sql...
[POSTGRES-INIT] Applying 055_seat_based_pricing.sql...
[POSTGRES-INIT] Applying 056_onboarding_wizard.sql...
[POSTGRES-INIT] Applying 057_tour_state.sql...
[POSTGRES-INIT] Applying 058_remove_org_managed_mailboxes.sql...
[POSTGRES-INIT] Applying 059_calendars_and_events.sql...
[POSTGRES-INIT] Applying 060_calendar_event_migrations.sql...
[POSTGRES-INIT] Applying 061_mailbox_key_reactivations.sql...
[POSTGRES-INIT] Applying 062_calendar_recurrence_exceptions.sql...
[POSTGRES-INIT] Applying 063_calendar_sharing.sql...
[POSTGRES-INIT] Applying 064_support_ticketing_system.sql...
[POSTGRES-INIT] Applying 065_support_typing_indicator.sql...
[POSTGRES-INIT] Applying 066_support_notifications_and_reply_tokens.sql...
[POSTGRES-INIT] Applying 067_support_account_suspension_privileges.sql...
[POSTGRES-INIT] Applying 068_draft_folders.sql...
[POSTGRES-INIT] Applying 069_outbound_queue_lease_and_outcomes.sql...
[POSTGRES-INIT] Applying 070_attachment_encryption_v2_and_delivery.sql...
[POSTGRES-INIT] Finished applying canonical migrations.
Fresh install schema_migrations count (expected 69): 69
Fresh install latest version: 070
Checking service statuses:
NAME                             IMAGE                             COMMAND                  SERVICE           CREATED          STATUS                    PORTS
byos-test-c631-api               byos-c631-fresh-api               "./api"                  api               19 seconds ago   Up 1 second               127.0.0.1:18080->8080/tcp
byos-test-c631-crypto-worker     byos-c631-fresh-crypto-worker     "./byos-native-crypt…"   crypto-worker     20 seconds ago   Up 18 seconds (healthy)   8084/tcp
byos-test-c631-minio             minio/minio:latest                "/usr/bin/docker-ent…"   minio             20 seconds ago   Up 19 seconds (healthy)   127.0.0.1:19000->9000/tcp, 127.0.0.1:19001->9001/tcp
byos-test-c631-outbound-worker   byos-c631-fresh-outbound-worker   "./byos-outbound-wor…"   outbound-worker   19 seconds ago   Up 1 second               8086/tcp
byos-test-c631-postgres          postgres:16-alpine                "docker-entrypoint.s…"   postgres          20 seconds ago   Up 17 seconds (healthy)   127.0.0.1:15432->5432/tcp
byos-test-c631-redis             redis:7-alpine                    "docker-entrypoint.s…"   redis             20 seconds ago   Up 18 seconds (healthy)   127.0.0.1:16379->6379/tcp
```

---

## 5. Existing Persistent-Volume Upgrade Results

Raw terminal evidence from `tests/compose_c631_verification.ps1` (Scenario A):

```
>>> [SCENARIO A] 3. Starting Docker Compose deployment against preserved volume...
 Container byos-test-c631-redis Starting 
 Container byos-test-c631-crypto-worker Starting 
 Container byos-test-c631-postgres Starting 
 Container byos-test-c631-minio Starting 
 Container byos-test-c631-postgres Healthy 
 Container byos-test-c631-migrate Starting 
 Container byos-test-c631-migrate Started 
 Container byos-test-c631-redis Healthy 
 Container byos-test-c631-minio Healthy 
 Container byos-test-c631-migrate Exited 
 Container byos-test-c631-api Starting 
 Container byos-test-c631-outbound-worker Starting 
 Container byos-test-c631-api Started 
 Container byos-test-c631-outbound-worker Started 
Waiting for migrate service to complete...
Migrate container status: exited (exit: 0)
Dumping migrate container logs:
2026/11/22 15:05:59 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 40
2026/11/22 15:05:59 [BASELINE] Database positively verified against baseline 068 manifest (passed 66/66 checks).
2026/11/22 15:05:59 [BASELINE] Stamping baseline migrations through 068 in schema_migrations...
2026/11/22 15:05:59 [BASELINE] Successfully recorded baseline migrations through 068 in schema_migrations.
2026/11/22 15:05:59 Found 2 pending migration(s) to apply.
2026/11/22 15:05:59 Applying migration 069 (069_outbound_queue_lease_and_outcomes.sql)...
2026/11/22 15:05:59 [APPLIED] 069 (069_outbound_queue_lease_and_outcomes.sql) in 75ms
2026/11/22 15:05:59 Applying migration 070 (070_attachment_encryption_v2_and_delivery.sql)...
2026/11/22 15:05:59 [APPLIED] 070 (070_attachment_encryption_v2_and_delivery.sql) in 156ms
2026/11/22 15:05:59 Successfully applied 2 migration(s). Database schema is now fully upgraded.
2026/11/22 15:05:59 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 40
SUCCESS: Applied 2 migration(s).

>>> [SCENARIO A] 4. Verifying post-upgrade schema and data integrity...
schema_migrations total count (expected 69): 69
Latest migration version recorded: 070
Post-upgrade outbound_queue.lease_token count (expected 1): 1
Post-upgrade outbound_delivery_attachments count (expected 1): 1
Preserved organization record: Preserved Enterprise Org
Preserved outbound_queue recipient: customer@external.org
Checking dependent service statuses (api and outbound-worker):
NAME                             IMAGE                                COMMAND                  SERVICE           CREATED          STATUS                    PORTS
byos-test-c631-api               byos-c631-existing-api               "./api"                  api               10 seconds ago   Up 2 seconds              127.0.0.1:18080->8080/tcp
byos-test-c631-crypto-worker     byos-c631-existing-crypto-worker     "./byos-native-crypt…"   crypto-worker     11 seconds ago   Up 9 seconds (healthy)    8084/tcp
byos-test-c631-minio             minio/minio:latest                   "/usr/bin/docker-ent…"   minio             11 seconds ago   Up 9 seconds (healthy)    127.0.0.1:19000->9000/tcp, 127.0.0.1:19001->9001/tcp
byos-test-c631-outbound-worker   byos-c631-existing-outbound-worker   "./byos-outbound-wor…"   outbound-worker   10 seconds ago   Up 1 second               8086/tcp
byos-test-c631-postgres          postgres:16-alpine                   "docker-entrypoint.s…"   postgres          11 seconds ago   Up 9 seconds (healthy)    127.0.0.1:15432->5432/tcp
byos-test-c631-redis             redis:7-alpine                       "docker-entrypoint.s…"   redis             11 seconds ago   Up 10 seconds (healthy)   127.0.0.1:16379->6379/tcp

>>> [SCENARIO A] 5. Restarting Compose project on same volume to verify idempotency...
 Container byos-test-c631-migrate Restarting 
 Container byos-test-c631-migrate Started 
2026/11/22 15:06:03 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 95
2026/11/22 15:06:03 Database schema is up to date (version 070). No pending migrations.
2026/11/22 15:06:03 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 95
SUCCESS: Applied 0 migration(s).
```

---

## 6. Evidence that Existing Data Was Preserved

Pre-upgrade synthetic customer records were inserted into `organizations`, `domains`, `users`, `mailboxes`, and `outbound_queue` on volume `c631_existing_vol`:

```sql
INSERT INTO organizations (id, name, org_recovery_pk) 
VALUES ('99999999-1111-2222-3333-444444444444', 'Preserved Enterprise Org', '\x01020304');

INSERT INTO domains (id, org_id, name, is_verified) 
VALUES ('99999999-1111-2222-3333-444444444446', '99999999-1111-2222-3333-444444444444', 'preserved.byos.local', true);

INSERT INTO users (id, org_id, email, password_hash) 
VALUES ('99999999-1111-2222-3333-444444444445', '99999999-1111-2222-3333-444444444444', 'preserved_admin@byos.local', '$2a$10$fakehash');

INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, mailbox_pk) 
VALUES ('99999999-1111-2222-3333-444444444447', '99999999-1111-2222-3333-444444444444', '99999999-1111-2222-3333-444444444445', '99999999-1111-2222-3333-444444444446', 'preserved_admin', 'private', '\x05060708');

INSERT INTO outbound_queue (id, delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, status, expires_at) 
VALUES ('99999999-1111-2222-3333-444444444448', '99999999-1111-2222-3333-444444444448', '99999999-1111-2222-3333-444444444447', '99999999-1111-2222-3333-444444444446', 'customer@external.org', '\x0102'::bytea, '\x0304'::bytea, 'pending', NOW() + interval '24 hours');
```

Raw terminal evidence post-upgrade query outputs:

```
Preserved organization record: Preserved Enterprise Org
Preserved outbound_queue recipient: customer@external.org
```

---

## 7. Migration Service Permissions

`byos-migrate` executes DDL migrations that create tables, modify column definitions, create foreign keys, and configure indexes. Under PostgreSQL's security model:
1. **Schema DDL Permissions:** DDL execution requires table ownership or schema `CREATE` privileges on the `public` schema. Therefore, `byos-migrate` connects using the database administrator credentials (`byos:byos_dev_password`), while application services (such as `outbound-worker`) connect under restricted least-privilege roles (`outbound_worker_login`) with table-scoped `SELECT`, `UPDATE`, and `INSERT` grants only.
2. **Fail-Closed on Insufficient Privileges:** If an operator mistakenly runs `byos-migrate` with an unprivileged database user, `byos-migrate` detects permission errors immediately and aborts without partially applying unrecorded DDL.

Raw evidence from `TestPhase6_InsufficientPrivilegesFailsClosed`:

```
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
2026/11/22 21:14:27 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39677
2026/11/22 21:14:27 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39677
    migrator_test.go:730: Expected privilege failure: creating schema_migrations table: ERROR: permission denied for schema public (SQLSTATE 42501)
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (0.89s)
```

---

## 8. Service Startup Dependency Map

All Compose services that access PostgreSQL are configured with explicit dependencies on `migrate`:

```mermaid
flowchart TD
    postgres["postgres (healthy via TCP probe)"] --> migrate["migrate (service_completed_successfully)"]
    migrate --> api["api"]
    migrate --> outbound["outbound-worker"]
    migrate --> admin["admin-api"]
    migrate --> storage["storage-worker"]
    migrate --> mailrouter["mail-router"]
    redis["redis (healthy)"] --> api
    minio["minio (healthy)"] --> api
    crypto["crypto-worker (started)"] --> outbound
    crypto --> api
```

Docker Compose configuration in `infra/docker-compose.yml`:
- `api`: depends on `postgres: service_healthy`, `migrate: service_completed_successfully`, `redis: service_healthy`, `minio: service_healthy`.
- `outbound-worker`: depends on `postgres: service_healthy`, `migrate: service_completed_successfully`, `crypto-worker: service_started`.
- `admin-api`: depends on `postgres: service_healthy`, `migrate: service_completed_successfully`.
- `storage-worker`: depends on `postgres: service_healthy`, `migrate: service_completed_successfully`, `minio: service_healthy`.
- `mail-router`: depends on `postgres: service_healthy`, `migrate: service_completed_successfully`, `redis: service_healthy`.

---

## 9. Transaction Compatibility Audit

By default, every migration script is executed inside an atomic transaction (`BEGIN ... COMMIT`) to ensure that a failed migration rolls back cleanly without leaving partial schema changes.

However, certain PostgreSQL DDL operations cannot execute inside a transaction block (e.g., `CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE` before PostgreSQL 12, or certain tablespace mutations).

To support this safely without hardcoded exceptions:
- `tools/byos-migrate/migrator.go` parses migration files for the leading directive `-- byos-migrate: no-transaction`.
- When present, the migrator executes the file statements directly without an enclosing transaction block, verifies success, and then records the migration execution and checksum in `schema_migrations`.
- The session-level advisory lock remains active on the connection throughout execution to prevent concurrent migration attempts.

Raw evidence from `TestPhase6_NonTransactionalMigrationSupport`:

```
=== RUN   TestPhase6_NonTransactionalMigrationSupport
2026/11/22 21:14:25 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39657
2026/11/22 21:14:25 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/22 21:14:25 Found 1 pending migration(s) to apply.
2026/11/22 21:14:25 Applying migration 001 (001_nontx.sql)...
2026/11/22 21:14:25 [NON-TX] Migration 001 (001_nontx.sql) marked as non-transactional; executing directly...
2026/11/22 21:14:25 [APPLIED] 001 (001_nontx.sql) in 3ms [NON-TX]
2026/11/22 21:14:25 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/22 21:14:25 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39657
--- PASS: TestPhase6_NonTransactionalMigrationSupport (0.28s)
```

---

## 10. CLI Verification

### `byos-migrate --help`
Raw output:
```
BYOS Canonical Database Migration Runner

Usage:
  byos-migrate --help
  byos-migrate up       [--db-url <url>] [--dir <path>] [--baseline <ver>] [--no-auto-baseline]
  byos-migrate status   [--db-url <url>] [--dir <path>]
  byos-migrate verify   [--db-url <url>] [--dir <path>]
  byos-migrate baseline --version <ver> [--confirm] [--db-url <url>] [--dir <path>]

Environment Variables:
  DATABASE_URL    Database connection URL
  MIGRATIONS_DIR  Path to canonical migrations directory
EXIT: 0
```

### Invalid Command Handling
Raw output:
```
ERROR: Unknown command "invalid-command"

BYOS Canonical Database Migration Runner

Usage:
  byos-migrate --help
  byos-migrate up       [--db-url <url>] [--dir <path>] [--baseline <ver>] [--no-auto-baseline]
  byos-migrate status   [--db-url <url>] [--dir <path>]
  byos-migrate verify   [--db-url <url>] [--dir <path>]
  byos-migrate baseline --version <ver> [--confirm] [--db-url <url>] [--dir <path>]

Environment Variables:
  DATABASE_URL    Database connection URL
  MIGRATIONS_DIR  Path to canonical migrations directory
EXIT: 1
```

### Credential Redaction in Errors
Raw output:
```
2026/11/22 21:12:55 ERROR: Querying migration status failed: connecting to database (postgres://byos:REDACTED@127.0.0.1:5432/byos_test_isolation?sslmode=disable): failed to connect to `user=byos database=byos_test_isolation`: 127.0.0.1:5432 (127.0.0.1): failed SASL auth: FATAL: password authentication failed for user "byos" (SQLSTATE 28P01)
```

### Baseline Preflight Verification (Target: 068)
Raw output when tested against schema with conflicting post-baseline objects:
```
2026/11/22 21:13:50 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39560
=== BASELINE PREFLIGHT VERIFICATION (Target: 068) ===
Total Checks: 66 | Passed: 59 | Failed: 7 | IsEmpty: false | IsMatch: false

CHECK                                 TYPE     STATUS  DETAILS
-----                                 ----     ------  -------
organizations                         table    PASS    table present
users                                 table    PASS    table present
domains                               table    PASS    table present
root_secrets                          table    PASS    table present
mailboxes                             table    PASS    table present
aliases                               table    PASS    table present
devices                               table    PASS    table present
device_mailbox_access                 table    PASS    table present
storage_connections                   table    PASS    table present
mailbox_storage                       table    PASS    table present
message_metadata                      table    PASS    table present
search_index                          table    PASS    table present
scheduled_messages                    table    PASS    table present
outbound_queue                        table    PASS    table present
auto_reply_rules                      table    PASS    table present
drafts                                table    PASS    table present
delivery_log                          table    PASS    table present
audit_log                             table    PASS    table present
outbound_reservations                 table    PASS    table present
rate_limits                           table    PASS    table present
sessions                              table    PASS    table present
storage_migrations                    table    PASS    table present
contacts                              table    PASS    table present
google_drive_oauth_states             table    PASS    table present
search_tokens                         table    PASS    table present
bridge_credentials                    table    PASS    table present
attachments                           table    PASS    table present
recovery_challenges                   table    PASS    table present
account_invitations                   table    PASS    table present
mailbox_settings                      table    PASS    table present
mailbox_folders                       table    PASS    table present
mailbox_labels                        table    PASS    table present
message_labels                        table    PASS    table present
mailbox_address_rules                 table    PASS    table present
message_tracking                      table    PASS    table present
user_passkeys                         table    PASS    table present
auth_challenges                       table    PASS    table present
support_audit_logs                    table    PASS    table present
mail_rules                            table    PASS    table present
masked_aliases                        table    PASS    table present
masked_alias_reply_map                table    PASS    table present
import_jobs                           table    PASS    table present
user_calendars                        table    PASS    table present
calendar_events                       table    PASS    table present
calendar_event_migrations             table    PASS    table present
mailbox_key_reactivations             table    PASS    table present
calendar_event_exceptions             table    PASS    table present
calendar_shares                       table    PASS    table present
support_agents                        table    PASS    table present
support_tickets                       table    PASS    table present
support_ticket_messages               table    PASS    table present
support_notification_outbox           table    FAIL    missing expected table
support_reply_tokens                  table    FAIL    missing expected table
support_inbound_dedup                 table    FAIL    missing expected table
organizations.seat_count              column   PASS    column present (from 055_seat_based_pricing.sql)
organizations.subscription_status     column   PASS    column present (from 055_seat_based_pricing.sql)
message_metadata.client_queue_id      column   PASS    column present (from 051_client_queue_id.sql)
users.role                            column   PASS    column present (from 010_rbac_roles.sql)
users.recovery_auth_pk                column   PASS    column present (from 009_recovery_verifiers.sql)
scheduled_messages.draft_storage_ref  column   PASS    column present (from 042_scheduled_draft_ref.sql)
drafts.folder                         column   PASS    column present (from 068_draft_folders.sql)
drafts.folder_id                      column   PASS    column present (from 068_draft_folders.sql)
outbound_queue.lease_token            absence  FAIL    column lease_token is present in outbound_queue (indicates migration 069 was applied)
outbound_delivery_attachments         absence  FAIL    table outbound_delivery_attachments is present (indicates migration 070 was applied)
outbound_delivery_keys                absence  FAIL    table outbound_delivery_keys is present (indicates migration 070 was applied)
draft_attachments                     absence  FAIL    table draft_attachments is present (indicates migration 070 was applied)

ERROR: Database schema does not match baseline 068 manifest (7 checks failed).
Operator cannot bypass failed schema verification. Baseline aborted.
EXIT: 1
```

---

## 11. Regression Test Results

### byos-migrate Test Suite
Command: `go test -count=1 -v ./tools/byos-migrate/...`
Raw output:
```
=== RUN   TestPhase4_FreshDatabaseBootstrap
2026/11/22 21:14:10 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39599
2026/11/22 21:14:10 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/22 21:14:10 Found 69 pending migration(s) to apply.
--- PASS: TestPhase4_FreshDatabaseBootstrap (3.87s)
=== RUN   TestPhase5_ExistingDatabaseUpgrade_Baseline068
2026/11/22 21:14:16 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39617
2026/11/22 21:14:16 [BASELINE] Database positively verified against baseline 068 manifest (passed 66/66 checks).
2026/11/22 21:14:16 [BASELINE] Stamping baseline migrations through 068 in schema_migrations...
2026/11/22 21:14:16 [BASELINE] Successfully recorded baseline migrations through 068 in schema_migrations.
2026/11/22 21:14:16 Found 2 pending migration(s) to apply.
2026/11/22 21:14:16 Applying migration 069 (069_outbound_queue_lease_and_outcomes.sql)...
2026/11/22 21:14:17 [APPLIED] 069 (069_outbound_queue_lease_and_outcomes.sql) in 69ms
2026/11/22 21:14:17 Applying migration 070 (070_attachment_encryption_v2_and_delivery.sql)...
2026/11/22 21:14:17 [APPLIED] 070 (070_attachment_encryption_v2_and_delivery.sql) in 143ms
2026/11/22 21:14:17 Successfully applied 2 migration(s). Database schema is now fully upgraded.
2026/11/22 21:14:17 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39617
--- PASS: TestPhase5_ExistingDatabaseUpgrade_Baseline068 (3.63s)
=== RUN   TestPhase1_Baseline068_PartialSchema_FailsClosed
2026/11/22 21:14:20 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39634
2026/11/22 21:14:20 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39634
--- PASS: TestPhase1_Baseline068_PartialSchema_FailsClosed (1.47s)
=== RUN   TestPhase1_Baseline068_ConflictingPostBaselineSchema_FailsClosed
2026/11/22 21:14:23 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39644
2026/11/22 21:14:23 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 39644
--- PASS: TestPhase1_Baseline068_ConflictingPostBaselineSchema_FailsClosed (3.39s)
=== RUN   TestPhase1_Baseline068_OperatorPreflightVerification
--- PASS: TestPhase1_Baseline068_OperatorPreflightVerification (0.28s)
=== RUN   TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease
--- PASS: TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease (0.34s)
=== RUN   TestPhase6_MigrationInterruptionAndRecovery
--- PASS: TestPhase6_MigrationInterruptionAndRecovery (0.39s)
=== RUN   TestPhase6_NonTransactionalMigrationSupport
--- PASS: TestPhase6_NonTransactionalMigrationSupport (0.28s)
=== RUN   TestPhase6_ChecksumMismatchDetection
--- PASS: TestPhase6_ChecksumMismatchDetection (0.30s)
=== RUN   TestPhase6_MissingRequiredMigrationFile
--- PASS: TestPhase6_MissingRequiredMigrationFile (0.30s)
=== RUN   TestPhase6_DuplicateVersionDetection
--- PASS: TestPhase6_DuplicateVersionDetection (0.01s)
=== RUN   TestPhase6_ConcurrentDeploymentProtection
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.30s)
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (0.89s)
PASS
ok  	byos-migrate	17.468s
```

### services/mail-router Test Suite
Command: `go test -count=1 -v ./services/mail-router/...`
Raw output:
```
=== RUN   TestAliasRoutingRewritesRecipient
--- PASS: TestAliasRoutingRewritesRecipient (0.43s)
=== RUN   TestAliasRoutingRejectsUnknown
--- PASS: TestAliasRoutingRejectsUnknown (0.02s)
=== RUN   TestAliasRoutingRejectsDisabled
--- PASS: TestAliasRoutingRejectsDisabled (0.18s)
=== RUN   TestAliasReplyMapInserted
--- PASS: TestAliasReplyMapInserted (0.28s)
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
--- PASS: TestPhase1_MessageID_CasePreservationAndCleaning (0.00s)
=== RUN   TestPhase1_ReferencesParsing
--- PASS: TestPhase1_ReferencesParsing (0.00s)
=== RUN   TestPhase1_ComputeThreadID_DatabasePriority
--- PASS: TestPhase1_ComputeThreadID_DatabasePriority (0.18s)
=== RUN   TestPhase2_StripBccHeader_MIMEStorageSanitization
--- PASS: TestPhase2_StripBccHeader_MIMEStorageSanitization (0.00s)
=== RUN   TestPhase2_MetadataRecipients_VisibleIsolation
--- PASS: TestPhase2_MetadataRecipients_VisibleIsolation (0.00s)
=== RUN   TestPhase3_PartialDelivery_NeverHidesRecipientFailures
--- PASS: TestPhase3_PartialDelivery_NeverHidesRecipientFailures (0.44s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_SupportAddresses
--- PASS: TestPhase4_RecipientVerifyEndpoint_SupportAddresses (0.00s)
=== RUN   TestPhase4_RecipientVerifyEndpoint_AuthProtection
--- PASS: TestPhase4_RecipientVerifyEndpoint_AuthProtection (0.00s)
=== RUN   TestPhase2_MessageID_ThreadingSafetyMatrix
--- PASS: TestPhase2_MessageID_ThreadingSafetyMatrix (0.22s)
PASS
ok  	byos.email/services/mail-router	2.039s
```

### services/inbound-bridge Test Suite
Command: `go test -count=1 -v ./services/inbound-bridge/...`
Raw output:
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
--- PASS: TestSessionRcptVerify_TemporaryFailure (0.00s)
=== RUN   TestSessionData_NoRecipients
--- PASS: TestSessionData_NoRecipients (0.00s)
=== RUN   TestPhase4_VerifyMatrix_UnknownRecipient_550
--- PASS: TestPhase4_VerifyMatrix_UnknownRecipient_550 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ValidRecipient_Accept
--- PASS: TestPhase4_VerifyMatrix_ValidRecipient_Accept (0.00s)
=== RUN   TestPhase4_VerifyMatrix_ServiceUnavailable_451
--- PASS: TestPhase4_VerifyMatrix_ServiceUnavailable_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InternalAuthFailure_451
--- PASS: TestPhase4_VerifyMatrix_InternalAuthFailure_451 (0.00s)
=== RUN   TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject
--- PASS: TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject (0.00s)
=== RUN   TestPhase4_VerifyMatrix_SyntacticallyInvalid_501
--- PASS: TestPhase4_VerifyMatrix_SyntacticallyInvalid_501 (0.00s)
=== RUN   TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification
--- PASS: TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification (0.02s)
PASS
ok  	github.com/byos/byos-email/services/inbound-bridge	2.178s
```

### Outbound Worker Legacy Go Tests
Command: `cd services/outbound-worker/legacy && go test -count=1 -v .`
Raw output:
```
=== RUN   TestParseAndValidateRecipients
--- PASS: TestParseAndValidateRecipients (0.00s)
=== RUN   TestStripBccHeaders
--- PASS: TestStripBccHeaders (0.00s)
=== RUN   TestDeliverToSmtpServerCapture
--- PASS: TestDeliverToSmtpServerCapture (0.01s)
PASS
ok  	github.com/byos/byos-email/services/outbound-worker	1.121s
```

### Outbound Worker Rust Unit Tests
Command: `cargo test --bin byos-outbound-worker -- --skip pg_tests`
Raw output:
```
test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 7.50s
```

### Outbound Worker Rust Postgres Integration Tests
Command: `cargo test --bin byos-outbound-worker pg_tests -- --test-threads=1`
Raw output:
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

test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 51 filtered out; finished in 70.95s
```

### Crypto Workspace Cargo Tests
Command: `cargo test --workspace`
Raw output:
```
test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 27.22s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.20s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.30s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
```

### Webmail Test Suite
Command: `cd apps/webmail && npm test`
Raw output:
```
OVERALL: 735 passed, 0 failed
```

### Webmail Production Build
Command: `cd apps/webmail && npm run build`
Raw output:
```
vite v6.4.5 building for production...
transforming...
✓ 340 modules transformed.
rendering chunks...
dist/index.html                                    1.86 kB │ gzip:   0.88 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-Cj7wMlFc.css                   171.44 kB │ gzip:  26.04 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-Ct6oJHVI.js                  3,587.79 kB │ gzip: 777.99 kB
✓ built in 14.74s
```

---

## 12. What Did Not Work or Is Untested

- **UNTESTED:** Deployment against external AWS RDS or Azure Database for PostgreSQL managed instances where session advisory lock IDs might collide with other operator tools (the lock ID `4780962453531182930` is BYOS-specific and 64-bit, making accidental collision near-zero, but cloud multi-tenant DB permissions must be tested manually by operators).
- **UNTESTED:** Automatic baseline stamping for arbitrary historical versions other than `068`. The baseline command currently supports `--version 068` exclusively because 068 represents the single frozen pre-C6.3 schema boundary. Any other baseline target requires explicit schema definition.

---

## 13. Remaining Deployment Limitations

1. **PostgreSQL TCP Readiness:** When running PostgreSQL in Docker Compose without the updated TCP healthcheck (`pg_isready -h 127.0.0.1`), external containers connecting over TCP during initdb will receive `connection refused` until PostgreSQL restarts after initdb scripts finish. The updated `docker-compose.yml` healthcheck resolves this.
2. **Operator Baseline Invocation on Legacy Databases:** Existing installations running unversioned databases should run `docker compose run --rm migrate byos-migrate baseline --version 068 --confirm` during maintenance window or let the automated verification preflight confirm 66/66 checks before running `up`.
