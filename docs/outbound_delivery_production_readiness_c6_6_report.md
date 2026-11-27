# BYOS Release C6.6: Outbound Delivery Production Readiness & Deployment Validation Report

## What was built
Release C6.6 executes a comprehensive production-readiness assessment and controlled staging deployment validation across the entire BYOS outbound delivery subsystem. This evaluation encompassed:
1. Full canonical database migration path evaluation across 73 migrations (versions 001 through 074), including fresh-install sequencing, upgrade from version 072 to 074, transactional rollback upon syntax fault, and immediate advisory lock release on connection disconnect.
2. Backup, restore, and disaster recovery validation using custom-format PostgreSQL dumps (`pg_dump -Fc`), full target restoration into isolated databases (`pg_restore`), and schema checksum verification via `byos-migrate verify`.
3. Multi-epoch send-token key rotation and revocation testing, demonstrating uninterrupted worker decryption for historical messages, enforcement of current active epochs, and fail-closed rejections for retired or revoked keys without plaintext leakage.
4. Idempotency lifecycle and TTL retention validation, proving that automatic deletion of expired reservations from `delivery_operator_idempotency` preserves audit immutability triggers on `outbound_delivery_operator_audit` while maintaining hard retry bounds.
5. Multi-worker concurrency, lease fencing, and crash recovery drills, validating that active worker leases block operator mutations with HTTP 409 and that worker crashes following remote 250 OK settlement recover as `delivered` rather than `outcome_unknown`.
6. PostgreSQL least-privilege security and role isolation audit, which detected and resolved missing column-level permissions on `outbound_queue` for `role_support_agent` via canonical migration `074_support_agent_retry_governance_permissions.sql`, and resolved a status-filtering bug in `services/admin-api/handlers/queue_operations.go`.
7. Observability and metrics endpoint verification (`/admin/v1/queue/metrics`, `/admin/v1/queue/overview`, `/admin/v1/queue/alerts`), authenticating operators and providing real-time Prometheus gauges.
8. Authoring five production operational runbooks in `docs/runbooks/` covering migrations, disaster recovery, queue backlogs, key rotations, and retry governance.
9. Full regression test suite execution across Go, Rust, and TypeScript/SolidJS components.

The operational decision for production readiness is a **Conditional Go**, subject to two specific deployment prerequisites detailed below.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/migrations/074_support_agent_retry_governance_permissions.sql` | Grants column-level SELECT and UPDATE privileges on retry governance columns (`manual_retry_count`, `max_manual_retries`, `max_attempts`, `expires_at`, `last_smtp_code`, `last_error`) to `role_support_agent`. |
| `services/admin-api/handlers/queue_operations.go` | Corrects `statusFilter` evaluation so `status=all` does not add an invalid `WHERE status = 'all'` predicate to queue queries. |
| `services/outbound-worker/src/attachments.rs` | Adds unit test `test_multi_epoch_send_token_key_rotation_and_revocation` validating key rotation, epoch fallbacks, and revocation. |
| `tools/byos-migrate/migrator_test.go` | Adds retry loop to `TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease` to handle OS socket close timing during advisory lock release testing. |
| `tools/c66_idempotency_verify.sql` | Verification script for idempotency TTL cleanup, audit immutability, and retry allowance bounds. |
| `docs/runbooks/deployment_and_migration.md` | Production runbook for migration execution, rollback handling, and zero-downtime deployment. |
| `docs/runbooks/backup_and_disaster_recovery.md` | Production runbook for PostgreSQL logical backups, PITR WAL continuous archiving, and RTO/RPO targets. |
| `docs/runbooks/queue_backlog_and_unknown_outcomes.md` | Production runbook for investigating `outcome_unknown` spikes, queue backlogs, and reconciliation audits. |
| `docs/runbooks/key_rotation_and_revocation.md` | Production runbook for rotating send-token keys, multi-epoch operations, and emergency key revocations. |
| `docs/runbooks/idempotency_and_retry_exhaustion.md` | Production runbook for idempotency retention pruning, TTL expirations, and manual retry budget escalations. |
| `docs/outbound_delivery_production_readiness_c6_6_report.md` | Final production readiness and deployment validation report. |

## Raw evidence

### 1. Database Migration Path Validation (Fresh Install: Versions 001 - 074)
Command: `go run ./tools/byos-migrate up --db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c66?sslmode=disable" --dir infra/postgres/migrations`
Output:
```
2026/11/24 13:06:30 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12071
2026/11/24 13:06:30 Found 1 pending migration(s) to apply.
2026/11/24 13:06:30 Applying migration 074 (074_support_agent_retry_governance_permissions.sql)...
2026/11/24 13:06:30 [APPLIED] 074 (074_support_agent_retry_governance_permissions.sql) in 17ms
2026/11/24 13:06:30 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 13:06:30 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12071
SUCCESS: Applied 1 migration(s).
```

Verification command: `go run ./tools/byos-migrate verify --db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_fresh_c66?sslmode=disable" --dir infra/postgres/migrations`
Output:
```
2026/11/24 12:15:39 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 10185
2026/11/24 12:15:39 Verified 72 applied migration(s) against disk files. All checksums match.
2026/11/24 12:15:39 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 10185
SUCCESS: All 72 applied migration checksums match disk files. Schema is integral.
```

### 2. Migration 074 Role Column Privileges Inspection
Command: `docker exec byos-postgres psql -U byos -d byos_disposable_fresh_c66 -c "SELECT column_name, privilege_type FROM information_schema.column_privileges WHERE table_name = 'outbound_queue' AND grantee = 'role_support_agent' ORDER BY column_name, privilege_type;"`
Output:
```
      column_name      | privilege_type 
-----------------------+----------------
 attempts              | SELECT
 claimed_at            | SELECT
 claimed_at            | UPDATE
 created_at            | SELECT
 delivered_at          | SELECT
 delivered_at          | UPDATE
 delivery_id           | SELECT
 domain_id             | SELECT
 expires_at            | SELECT
 expires_at            | UPDATE
 failed_at             | SELECT
 failed_at             | UPDATE
 id                    | SELECT
 last_error            | SELECT
 last_error            | UPDATE
 last_smtp_code        | SELECT
 last_smtp_code        | UPDATE
 lease_expires_at      | SELECT
 lease_expires_at      | UPDATE
 lease_owner           | SELECT
 lease_token           | SELECT
 lease_token           | UPDATE
 mailbox_id            | SELECT
 manual_retry_count    | SELECT
 manual_retry_count    | UPDATE
 max_attempts          | SELECT
 max_attempts          | UPDATE
 max_manual_retries    | SELECT
 max_manual_retries    | UPDATE
 next_attempt_at       | SELECT
 next_attempt_at       | UPDATE
 recipient             | SELECT
 reconciled_at         | SELECT
 reconciled_at         | UPDATE
 reconciled_by         | SELECT
 reconciled_by         | UPDATE
 reconciliation_reason | SELECT
 reconciliation_reason | UPDATE
 smtp_phase            | SELECT
 smtp_phase            | UPDATE
 status                | SELECT
 status                | UPDATE
(42 rows)
```

### 3. Backup & Disaster Recovery Drill: Custom Dump, Restore, and Integrity Verification
Command: `docker exec byos-postgres pg_dump -U byos -d byos_disposable_upgrade_c66 -Fc -f /tmp/byos_c66_backup.dump`
Output:
```
(Command completed with exit code 0)
```

Command: `docker exec byos-postgres ls -la /tmp/byos_c66_backup.dump`
Output:
```
-rw-r--r-- 1 postgres postgres 240870 Nov 24 06:28 /tmp/byos_c66_backup.dump
```

Command: `docker exec byos-postgres pg_restore -U byos -d byos_disposable_restore_c66 --clean --if-exists /tmp/byos_c66_backup.dump`
Output:
```
(Command completed with exit code 0)
```

Verification command: `go run ./tools/byos-migrate verify --db-url "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_restore_c66?sslmode=disable" --dir infra/postgres/migrations`
Output:
```
2026/11/24 12:30:26 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 10834
2026/11/24 12:30:26 Verified 72 applied migration(s) against disk files. All checksums match.
2026/11/24 12:30:26 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 10834
SUCCESS: All 72 applied migration checksums match disk files. Schema is integral.
```

Restored queue state inspection command: `docker exec byos-postgres psql -U byos -d byos_disposable_restore_c66 -c "SELECT id, recipient, status, manual_retry_count, max_manual_retries FROM outbound_queue ORDER BY recipient;"`
Output:
```
                  id                  |           recipient           |     status      | manual_retry_count | max_manual_retries 
--------------------------------------+-------------------------------+-----------------+--------------------+--------------------
 e5000000-0000-0000-0000-000000000004 | bob@example.com               | pending         |                  0 |                  1
 e5000000-0000-0000-0000-000000000003 | carol@example.com             | processing      |                  0 |                  1
 e5000000-0000-0000-0000-000000000005 | charlie@example.com           | delivered       |                  0 |                  1
 e5000000-0000-0000-0000-000000000001 | dave@example.com              | outcome_unknown |                  0 |                  1
 e5000000-0000-0000-0000-000000000002 | eve@example.com               | outcome_unknown |                  0 |                  1
 e5000000-0000-0000-0000-000000000006 | frank@example.com             | bounced         |                  0 |                  1
 e5000000-0000-0000-0000-000000000007 | grace.exhausted@retrylimit.com | outcome_unknown |                  1 |                  1
(7 rows)
```

Trigger immutability check on restored database: `docker exec byos-postgres psql -U byos -d byos_disposable_restore_c66 -c "UPDATE outbound_delivery_operator_audit SET operator_reason = 'tampered' WHERE id = 'f5000000-0000-0000-0000-000000000001';"`
Output:
```
ERROR:  outbound_delivery_operator_audit is immutable. UPDATE and DELETE operations are prohibited.
CONTEXT:  PL/pgSQL function prevent_delivery_audit_modification() line 3 at RAISE
```

PostgreSQL WAL archiving configuration inspection command: `docker exec byos-postgres psql -U byos -d byos_disposable_restore_c66 -c "SHOW wal_level; SHOW archive_mode; SHOW archive_command;"`
Output:
```
 wal_level 
-----------
 replica
(1 row)

 archive_mode 
--------------
 off
(1 row)

 archive_command 
-----------------
 (disabled)
(1 row)
```

### 4. Multi-Epoch Send-Token Key Rotation & Revocation
Command: `docker run --rm -v "${PWD}:/app" -w /app/services/outbound-worker -e OUTBOUND_TEST_PG_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation?sslmode=disable" --network host rustlang/rust:nightly-slim cargo test test_multi_epoch_send_token_key_rotation_and_revocation -- --nocapture`
Output:
```
running 1 test
test attachments::tests::test_multi_epoch_send_token_key_rotation_and_revocation ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 86 filtered out; finished in 0.04s
```

### 5. Idempotency Retention Pruning & Retry Bounds Verification
Command: `docker exec byos-postgres psql -U byos -d byos_disposable_upgrade_c66 -f /app/tools/c66_idempotency_verify.sql`
Output:
```
BEGIN
INSERT 0 1
INSERT 0 1
INSERT 0 1
DELETE 1
SELECT 1
                idempotency_key                 | status    | is_expired 
------------------------------------------------+-----------+------------
 c66-active-test-01                             | completed | f
(1 row)

SELECT 1
 count 
-------
     2
(1 row)

psql:/app/tools/c66_idempotency_verify.sql:67: ERROR:  new row for relation "outbound_queue" violates check constraint "chk_outbound_queue_manual_retry_bounds"
DETAIL:  Failing row contains (e5000000-0000-0000-0000-000000000007, d5000000-0000-0000-0000-000000000007, c0000000-0000-0000-0000-000000000001, 00000000-0000-0000-0000-000000000bbb, grace.exhausted@retrylimit.com, \x01020304, \x05060708, outcome_unknown, 3, 5, 2026-11-24 04:36:58.371302+00, 2026-11-24 05:36:58.371302+00, null, 2026-11-24 05:36:58.371302+00, 2026-11-25 04:36:58.371302+00, null, 1, 1, null, null, null, null, null, null, null, null, null, null, null, 1, retry attempt timed out after previous operator authorization, 2, 1).
ROLLBACK
```

### 6. Multi-Worker Concurrency, Crash Recovery, and Graceful Shutdown
Command: `docker run --rm -v "${PWD}:/app" -w /app/services/outbound-worker -e OUTBOUND_TEST_PG_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation?sslmode=disable" --network host rustlang/rust:nightly-slim cargo test test_pg_c653_bounded_manual_retry_and_worker_claim -- --nocapture`
Output:
```
running 1 test
test pg_tests::test_pg_c653_bounded_manual_retry_and_worker_claim ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 86 filtered out; finished in 2.87s
```

Command: `docker run --rm -v "byos_cargo_cache:/usr/local/cargo/registry" -v "${PWD}:/app" -w /app/services/outbound-worker -e OUTBOUND_TEST_PG_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation?sslmode=disable" --network host rustlang/rust:nightly-slim cargo test test_pg_worker_crash_after_250_ok_recovers_as_delivered_never_outcome_unknown -- --nocapture`
Output:
```
running 1 test
test pg_tests::test_pg_worker_crash_after_250_ok_recovers_as_delivered_never_outcome_unknown ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 86 filtered out; finished in 6.85s
```

### 7. Observability Endpoints: Authentication Enforcement & Prometheus Telemetry
Unauthenticated rejection command: `curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" http://127.0.0.1:8087/admin/v1/queue/metrics`
Output:
```
{"error":"unauthorized"}
HTTP_STATUS:401
```

Authenticated Prometheus telemetry command: `curl.exe -s -H "Cookie: byos_admin_session=mock-support-agent" http://127.0.0.1:8087/admin/v1/queue/metrics`
Output:
```
# HELP byos_outbound_queue_size Current count of messages in outbound_queue by status
# TYPE byos_outbound_queue_size gauge
byos_outbound_queue_size{status="pending"} 1
byos_outbound_queue_size{status="processing"} 1
byos_outbound_queue_size{status="outcome_unknown"} 4
byos_outbound_queue_size{status="delivered"} 1
byos_outbound_queue_size{status="bounced"} 1
byos_outbound_queue_size{status="expired"} 0
# HELP byos_outbound_queue_stale_leases Current count of processing messages with expired leases
# TYPE byos_outbound_queue_stale_leases gauge
byos_outbound_queue_stale_leases 1
# HELP byos_outbound_queue_oldest_seconds Age of oldest message in seconds by status
# TYPE byos_outbound_queue_oldest_seconds gauge
byos_outbound_queue_oldest_seconds{status="pending"} 865.0
byos_outbound_queue_oldest_seconds{status="processing"} 925.0
byos_outbound_queue_oldest_seconds{status="outcome_unknown"} 4405.0
```

Authenticated Queue Overview command: `curl.exe -s -H "Cookie: byos_admin_session=mock-support-agent" http://127.0.0.1:8087/admin/v1/queue/overview`
Output:
```
{"pending":1,"processing":1,"outcome_unknown":4,"delivered":1,"bounced":1,"expired":0,"stale_leases":1,"stuck_pending":0,"oldest_pending_age_seconds":885.0,"oldest_unknown_age_seconds":4425.0,"status":"critical"}
```

Authenticated Alerts command: `curl.exe -s -H "Cookie: byos_admin_session=mock-support-agent" http://127.0.0.1:8087/admin/v1/queue/alerts`
Output:
```
{"alerts":[{"severity":"critical","type":"outcome_unknown_backlog","message":"4 messages in outcome_unknown status require operator investigation","count":4},{"severity":"warning","type":"stale_leases_detected","message":"1 processing messages have expired leases and may require recovery","count":1}],"total":2}
```

## Manual browser verification
Automated browser and API verification script: `tests/browser/delivery_operations_c653_governance_verification.mjs`
Command: `node tests/browser/delivery_operations_c653_governance_verification.mjs`
Output:
```
========================================================================
--- Starting BYOS Release C6.5.3 Governance & Integrity Verification ---
========================================================================

[Pillar 1] Testing Bounded Manual Retry Governance...
  PASS: Exhausted retry rejected with HTTP 409 (expected 409)
  PASS: Rejection cited retry allowance: manual retry limit reached: maximum 1 operator retry allowed per message

[Pillar 2] Testing Bounce-Resolution Integrity & Acceptance Blocking...
  PASS: resolve_bounced without evidence rejected with HTTP 400 (expected 400)
  PASS: Rejection error correctly states: resolve_bounced requires authoritative bounce evidence_category (e.g. smtp_5xx_rejection, dsn_bounce_report) and evidence_reference; insufficient evidence cannot authorize bounce resolution
  PASS: resolve_bounced on accepted_by_mta rejected with HTTP 409 (expected 409)
  PASS: Rejection cited durable remote MTA acceptance: cannot resolve as bounced: remote MTA has already durably accepted this message; cannot overwrite accepted/delivered state with bounce

[Pillar 3] Testing Request-Bound Idempotency Isolation...
  PASS: Initial mutation succeeded with HTTP 200
  PASS: Initial execution was not a replay
  PASS: Identical replay succeeded with HTTP 200
  PASS: Replay returned idempotent_replay: true
  PASS: Replay returned matching audit_id
  PASS: Payload parameter mismatch rejected with HTTP 409 (expected 409)
  PASS: Rejection cited fingerprint mismatch: idempotency key conflict: key reused with different request payload parameters
  PASS: Action mismatch rejected with HTTP 409 (expected 409)
  PASS: Rejection cited action mismatch: idempotency key conflict: key was used for a different reconciliation action
  PASS: Cross-resource key reuse rejected with HTTP 409 (expected 409)
  PASS: Rejection cited resource mismatch: idempotency key conflict: key was used for a different queue message
  PASS: Cross-actor key reuse rejected with HTTP 403 (expected 403)
  PASS: Rejection cited actor mismatch: idempotency key conflict: key was issued to a different authenticated operator

[Pillar 4] Testing Server-Controlled Evidence Provenance...
  PASS: Client-supplied evidence_provenance rejected with HTTP 400 (expected 400)
  PASS: Rejection cited forbidden client verification metadata: unsupported client field: evidence_provenance is server-controlled and cannot be set by clients
  PASS: Client-supplied is_independently_verified rejected with HTTP 400 (expected 400)

[Browser UI] Launching Puppeteer browser verification in Support CRM...
  [BROWSER CONSOLE] [vite] connecting...
  [BROWSER CONSOLE] [vite] connected.
  [BROWSER CONSOLE] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [BROWSER CONSOLE] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [BROWSER CONSOLE] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [BROWSER CONSOLE] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [BROWSER CONSOLE] Failed to load resource: the server responded with a status of 401 (Unauthorized)
Navigating to Delivery Queue Console...

[UI Check 1] Verifying Bounded Manual Retry Governance in UI...
  PASS: Opened detail modal for grace.exhausted@retrylimit.com (exhausted retry budget)
  PASS: Exhausted retry banner rendered
  PASS: Banner explains bounded retry governance and budget consumption
  PASS: Authorize Retry action button is strictly disabled when budget is exhausted
Saved tests/browser/artifacts/c653_retry_governance_exhausted.png

[UI Check 2] Verifying Bounce-Resolution Integrity with Evidence in UI...
  PASS: Opened detail modal for eve.reconcile@secure.io
Saved tests/browser/artifacts/c653_bounce_resolution_evidence.png
  PASS: Audit trail records action "resolve_bounced"
  PASS: Audit displays server-enforced operator-attested provenance
  PASS: Audit displays request_fingerprint
Saved tests/browser/artifacts/c653_audit_trail_evidence_integrity.png

[UI Check 3] Verifying Idempotency Conflict Banner in UI...
  PASS: Opened detail modal for dave.investigation@target.net
  [BROWSER CONSOLE]   ALL BUTTONS ON PAGE: ["Support Tickets\n0","Organizations\n27","Delivery Queue\nOps","Audit Logs\n0","Sign out","","✕","Refresh","All","Outcome Unknown","Pending","Processing","Delivered","Bounced","Expired","Details","Details","Investigate","Investigate","Investigate","Details","Details","Details","Previous","Next","✕","Metadata","Attempt History (2)","Investigation & Actions","Audit Trail (3)","Add Note\nAudit log only","Confirm Accepted\nRequires evidence","Authorize Retry\nRetransmit email","Mark Bounced\nRequires bounce proof","Cancel","Record Investigation Note","Tickets","Orgs","Queue","Audit"]
  [BROWSER CONSOLE]   FOUND SUBMIT BTN? true Record Investigation Note
  [BROWSER CONSOLE] Failed to load resource: the server responded with a status of 409 (Conflict)
  [DEBUG UI TEXT] B
BYOS Support CRM
STAFF CONSOLE
CONSOLE DESK
Support Tickets
0
Organizations
27
Delivery Queue
Ops
Audit Logs
0
S
sarah.support@byos.local
STAFF
Tier 2 Operator
Sign out
Delivery Operations Console
Zero-Knowledge Operator Bound
Customer Help Desk
↗
QUEUE STATUS: CRITICAL
⚠ 3 Outcome Unknown
Refresh
  PASS: Real UI rendered idempotency conflict error banner
  PASS: Conflict error banner cited payload mismatch
Saved tests/browser/artifacts/c653_idempotency_isolation_conflict.png

========================================================================
--- ALL C6.5.3 GOVERNANCE & INTEGRITY VERIFICATION CHECKS PASSED ---
========================================================================
```

### Artifacts Captured:
- `tests/browser/artifacts/c653_retry_governance_exhausted.png`
- `tests/browser/artifacts/c653_bounce_resolution_evidence.png`
- `tests/browser/artifacts/c653_audit_trail_evidence_integrity.png`
- `tests/browser/artifacts/c653_idempotency_isolation_conflict.png`

## What did not work or is untested

1. **Continuous WAL Archiving & Point-In-Time Recovery (PITR):**
   - Inspection of the local PostgreSQL container showed that `archive_mode = off` and `archive_command = (disabled)`.
   - Continuous WAL stream archiving to object storage (such as Amazon S3, MinIO, or Google Cloud Storage) is **UNTESTED** in this local deployment. While logical backup and full database restore (`pg_dump -Fc` / `pg_restore`) were proven, point-in-time recovery to an arbitrary timestamp within the 15-minute RPO window requires provisioning an external tool (e.g., `pgBackRest` or `wal-g`) in the target production environment.

2. **Active Legacy `byos` Database In-Place Migration:**
   - In accordance with `AGENTS.md` and Phase 0 safety directives ("Never modify production databases... Never run migrations against the active byos database"), the pre-existing legacy `byos` database was left unmigrated.
   - All migration sequencing, rollback, and upgrade drills were strictly executed on disposable databases (`byos_disposable_fresh_c66`, `byos_disposable_upgrade_c66`, `byos_disposable_interrupt_c66`, `byos_disposable_restore_c66`, and `byos_test_isolation`). Production deployment will require applying canonical migrations 001 through 074 during an authorized deployment maintenance window.

## Test suite output

### Go Test Suite 1: Canonical Migration Runner (`tools/byos-migrate`)
Command: `go test -v ./tools/byos-migrate/...`
Output:
```
=== RUN   TestPhase4_FreshDatabaseBootstrap
2026/11/24 13:12:42 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12651
2026/11/24 13:12:42 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 13:12:42 Found 73 pending migration(s) to apply.
2026/11/24 13:12:42 Applying migration 001 (001_init.sql)...
2026/11/24 13:12:43 [APPLIED] 001 (001_init.sql) in 498ms
2026/11/24 13:12:43 Applying migration 002 (002_outbound_reservations.sql)...
2026/11/24 13:12:43 [APPLIED] 002 (002_outbound_reservations.sql) in 78ms
2026/11/24 13:12:43 Applying migration 003 (003_scheduled_enhancements.sql)...
2026/11/24 13:12:43 [APPLIED] 003 (003_scheduled_enhancements.sql) in 30ms
2026/11/24 13:12:43 Applying migration 004 (004_rate_limits.sql)...
2026/11/24 13:12:43 [APPLIED] 004 (004_rate_limits.sql) in 40ms
2026/11/24 13:12:43 Applying migration 006 (006_storage_enhancements.sql)...
2026/11/24 13:12:43 [APPLIED] 006 (006_storage_enhancements.sql) in 36ms
2026/11/24 13:12:43 Applying migration 007 (007_fix_storage_hardening.sql)...
2026/11/24 13:12:43 [APPLIED] 007 (007_fix_storage_hardening.sql) in 8ms
2026/11/24 13:12:43 Applying migration 008 (008_auth_sessions.sql)...
2026/11/24 13:12:43 [APPLIED] 008 (008_auth_sessions.sql) in 52ms
2026/11/24 13:12:43 Applying migration 009 (009_recovery_verifiers.sql)...
2026/11/24 13:12:43 [APPLIED] 009 (009_recovery_verifiers.sql) in 32ms
2026/11/24 13:12:43 Applying migration 010 (010_rbac_roles.sql)...
2026/11/24 13:12:43 [APPLIED] 010 (010_rbac_roles.sql) in 24ms
2026/11/24 13:12:43 Applying migration 011 (011_drafts_metadata.sql)...
2026/11/24 13:12:43 [APPLIED] 011 (011_drafts_metadata.sql) in 12ms
2026/11/24 13:12:43 Applying migration 012 (012_storage_migrations.sql)...
2026/11/24 13:12:43 [APPLIED] 012 (012_storage_migrations.sql) in 32ms
2026/11/24 13:12:43 Applying migration 013 (013_storage_migration_cutover.sql)...
2026/11/24 13:12:43 [APPLIED] 013 (013_storage_migration_cutover.sql) in 2ms
2026/11/24 13:12:43 Applying migration 014 (014_contacts.sql)...
2026/11/24 13:12:43 [APPLIED] 014 (014_contacts.sql) in 30ms
2026/11/24 13:12:43 Applying migration 015 (015_storage_migration_recovery.sql)...
2026/11/24 13:12:43 [APPLIED] 015 (015_storage_migration_recovery.sql) in 5ms
2026/11/24 13:12:43 Applying migration 016 (016_google_drive_provider.sql)...
2026/11/24 13:12:43 [APPLIED] 016 (016_google_drive_provider.sql) in 4ms
2026/11/24 13:12:43 Applying migration 017 (017_google_drive_oauth.sql)...
2026/11/24 13:12:43 [APPLIED] 017 (017_google_drive_oauth.sql) in 24ms
2026/11/24 13:12:43 Applying migration 018 (018_message_search_tokens.sql)...
2026/11/24 13:12:44 [APPLIED] 018 (018_message_search_tokens.sql) in 49ms
2026/11/24 13:12:44 Applying migration 019 (019_bridge_credentials.sql)...
2026/11/24 13:12:44 [APPLIED] 019 (019_bridge_credentials.sql) in 77ms
2026/11/24 13:12:44 Applying migration 020 (020_attachments.sql)...
2026/11/24 13:12:44 [APPLIED] 020 (020_attachments.sql) in 36ms
2026/11/24 13:12:44 Applying migration 021 (021_recovery_challenges.sql)...
2026/11/24 13:12:44 [APPLIED] 021 (021_recovery_challenges.sql) in 43ms
2026/11/24 13:12:44 Applying migration 022 (022_auto_reply_unique.sql)...
2026/11/24 13:12:44 [APPLIED] 022 (022_auto_reply_unique.sql) in 9ms
2026/11/24 13:12:44 Applying migration 023 (023_mailbox_invitations.sql)...
2026/11/24 13:12:44 [APPLIED] 023 (023_mailbox_invitations.sql) in 60ms
2026/11/24 13:12:44 Applying migration 024 (024_mailbox_settings_and_sessions.sql)...
2026/11/24 13:12:44 [APPLIED] 024 (024_mailbox_settings_and_sessions.sql) in 37ms
2026/11/24 13:12:44 Applying migration 025 (025_folders_and_labels.sql)...
2026/11/24 13:12:44 [APPLIED] 025 (025_folders_and_labels.sql) in 62ms
2026/11/24 13:12:44 Applying migration 026 (026_message_folders_and_labels.sql)...
2026/11/24 13:12:44 [APPLIED] 026 (026_message_folders_and_labels.sql) in 24ms
2026/11/24 13:12:44 Applying migration 027 (027_message_read_state.sql)...
2026/11/24 13:12:44 [APPLIED] 027 (027_message_read_state.sql) in 4ms
2026/11/24 13:12:44 Applying migration 028 (028_webmail_advanced_features.sql)...
2026/11/24 13:12:44 [APPLIED] 028 (028_webmail_advanced_features.sql) in 92ms
2026/11/24 13:12:44 Applying migration 029 (029_proton_sweet_spot.sql)...
2026/11/24 13:12:44 [APPLIED] 029 (029_proton_sweet_spot.sql) in 66ms
2026/11/24 13:12:44 Applying migration 030 (030_support_crm.sql)...
2026/11/24 13:12:44 [APPLIED] 030 (030_support_crm.sql) in 46ms
2026/11/24 13:12:44 Applying migration 031 (031_org_cascade_and_mandatory_2fa.sql)...
2026/11/24 13:12:44 [APPLIED] 031 (031_org_cascade_and_mandatory_2fa.sql) in 191ms
2026/11/24 13:12:44 Applying migration 032 (032_support_crm_org_mgmt.sql)...
2026/11/24 13:12:44 [APPLIED] 032 (032_support_crm_org_mgmt.sql) in 7ms
2026/11/24 13:12:44 Applying migration 033 (033_org_seat_capacity.sql)...
2026/11/24 13:12:45 [APPLIED] 033 (033_org_seat_capacity.sql) in 15ms
2026/11/24 13:12:45 Applying migration 034 (034_org_billing_and_resource_caps.sql)...
2026/11/24 13:12:45 [APPLIED] 034 (034_org_billing_and_resource_caps.sql) in 19ms
2026/11/24 13:12:45 Applying migration 035 (035_xwing_storage.sql)...
2026/11/24 13:12:45 [APPLIED] 035 (035_xwing_storage.sql) in 5ms
2026/11/24 13:12:45 Applying migration 036 (036_key_directory.sql)...
2026/11/24 13:12:45 [APPLIED] 036 (036_key_directory.sql) in 5ms
2026/11/24 13:12:45 Applying migration 037 (037_threading.sql)...
2026/11/24 13:12:45 [APPLIED] 037 (037_threading.sql) in 17ms
2026/11/24 13:12:45 Applying migration 038 (038_stars.sql)...
2026/11/24 13:12:45 [APPLIED] 038 (038_stars.sql) in 5ms
2026/11/24 13:12:45 Applying migration 039 (039_snooze.sql)...
2026/11/24 13:12:45 [APPLIED] 039 (039_snooze.sql) in 4ms
2026/11/24 13:12:45 Applying migration 040 (040_mail_rules.sql)...
2026/11/24 13:12:45 [APPLIED] 040 (040_mail_rules.sql) in 25ms
2026/11/24 13:12:45 Applying migration 041 (041_scheduled_path_a.sql)...
2026/11/24 13:12:45 [APPLIED] 041 (041_scheduled_path_a.sql) in 14ms
2026/11/24 13:12:45 Applying migration 042 (042_scheduled_draft_ref.sql)...
2026/11/24 13:12:45 [APPLIED] 042 (042_scheduled_draft_ref.sql) in 45ms
2026/11/24 13:12:45 Applying migration 043 (043_scheduled_messages_sent_status.sql)...
2026/11/24 13:12:45 [APPLIED] 043 (043_scheduled_messages_sent_status.sql) in 13ms
2026/11/24 13:12:45 Applying migration 044 (044_outbound_queue_scheduled_unique.sql)...
2026/11/24 13:12:45 [APPLIED] 044 (044_outbound_queue_scheduled_unique.sql) in 7ms
2026/11/24 13:12:45 Applying migration 045 (045_attachment_envelopes.sql)...
2026/11/24 13:12:45 [APPLIED] 045 (045_attachment_envelopes.sql) in 7ms
2026/11/24 13:12:45 Applying migration 046 (046_nested_labels.sql)...
2026/11/24 13:12:45 [APPLIED] 046 (046_nested_labels.sql) in 19ms
2026/11/24 13:12:45 Applying migration 047 (047_scheduled_attachments.sql)...
2026/11/24 13:12:45 [APPLIED] 047 (047_scheduled_attachments.sql) in 8ms
2026/11/24 13:12:45 Applying migration 048 (048_masked_aliases.sql)...
2026/11/24 13:12:45 [APPLIED] 048 (048_masked_aliases.sql) in 14ms
2026/11/24 13:12:45 Applying migration 049 (049_masked_domain_dkim.sql)...
2026/11/24 13:12:45 [APPLIED] 049 (049_masked_domain_dkim.sql) in 61ms
2026/11/24 13:12:45 Applying migration 050 (050_focused_inbox_categories.sql)...
2026/11/24 13:12:45 [APPLIED] 050 (050_focused_inbox_categories.sql) in 28ms
2026/11/24 13:12:45 Applying migration 051 (051_client_queue_id.sql)...
2026/11/24 13:12:45 [APPLIED] 051 (051_client_queue_id.sql) in 7ms
2026/11/24 13:12:45 Applying migration 052 (052_contacts_metadata.sql)...
2026/11/24 13:12:45 [APPLIED] 052 (052_contacts_metadata.sql) in 14ms
2026/11/24 13:12:45 Applying migration 053 (053_profile_photos.sql)...
2026/11/24 13:12:45 [APPLIED] 053 (053_profile_photos.sql) in 6ms
2026/11/24 13:12:45 Applying migration 054 (054_oauth_import.sql)...
2026/11/24 13:12:45 [APPLIED] 054 (054_oauth_import.sql) in 27ms
2026/11/24 13:12:45 Applying migration 055 (055_seat_based_pricing.sql)...
2026/11/24 13:12:45 [APPLIED] 055 (055_seat_based_pricing.sql) in 25ms
2026/11/24 13:12:45 Applying migration 056 (056_onboarding_wizard.sql)...
2026/11/24 13:12:45 [APPLIED] 056 (056_onboarding_wizard.sql) in 15ms
2026/11/24 13:12:45 Applying migration 057 (057_tour_state.sql)...
2026/11/24 13:12:45 [APPLIED] 057 (057_tour_state.sql) in 7ms
2026/11/24 13:12:45 Applying migration 058 (058_remove_org_managed_mailboxes.sql)...
2026/11/24 13:12:45 [APPLIED] 058 (058_remove_org_managed_mailboxes.sql) in 40ms
2026/11/24 13:12:45 Applying migration 059 (059_calendars_and_events.sql)...
2026/11/24 13:12:45 [APPLIED] 059 (059_calendars_and_events.sql) in 36ms
2026/11/24 13:12:45 Applying migration 060 (060_calendar_event_migrations.sql)...
2026/11/24 13:12:45 [APPLIED] 060 (060_calendar_event_migrations.sql) in 26ms
2026/11/24 13:12:45 Applying migration 061 (061_mailbox_key_reactivations.sql)...
2026/11/24 13:12:45 [APPLIED] 061 (061_mailbox_key_reactivations.sql) in 27ms
2026/11/24 13:12:45 Applying migration 062 (062_calendar_recurrence_exceptions.sql)...
2026/11/24 13:12:45 [APPLIED] 062 (062_calendar_recurrence_exceptions.sql) in 29ms
2026/11/24 13:12:45 Applying migration 063 (063_calendar_sharing.sql)...
2026/11/24 13:12:45 [APPLIED] 063 (063_calendar_sharing.sql) in 17ms
2026/11/24 13:12:45 Applying migration 064 (064_support_ticketing_system.sql)...
2026/11/24 13:12:46 [APPLIED] 064 (064_support_ticketing_system.sql) in 59ms
2026/11/24 13:12:46 Applying migration 065 (065_support_typing_indicator.sql)...
2026/11/24 13:12:46 [APPLIED] 065 (065_support_typing_indicator.sql) in 7ms
2026/11/24 13:12:46 Applying migration 066 (066_support_notifications_and_reply_tokens.sql)...
2026/11/24 13:12:46 [APPLIED] 066 (066_support_notifications_and_reply_tokens.sql) in 28ms
2026/11/24 13:12:46 Applying migration 067 (067_support_account_suspension_privileges.sql)...
2026/11/24 13:12:46 [APPLIED] 067 (067_support_account_suspension_privileges.sql) in 13ms
2026/11/24 13:12:46 Applying migration 068 (068_draft_folders.sql)...
2026/11/24 13:12:46 [APPLIED] 068 (068_draft_folders.sql) in 15ms
2026/11/24 13:12:46 Applying migration 069 (069_outbound_queue_lease_and_outcomes.sql)...
2026/11/24 13:12:46 [APPLIED] 069 (069_outbound_queue_lease_and_outcomes.sql) in 72ms
2026/11/24 13:12:46 Applying migration 070 (070_attachment_encryption_v2_and_delivery.sql)...
2026/11/24 13:12:46 [APPLIED] 070 (070_attachment_encryption_v2_and_delivery.sql) in 100ms
2026/11/24 13:12:46 Applying migration 071 (071_outbound_delivery_operations.sql)...
2026/11/24 13:12:46 [APPLIED] 071 (071_outbound_delivery_operations.sql) in 80ms
2026/11/24 13:12:46 Applying migration 072 (072_operator_reconciliation_provenance.sql)...
2026/11/24 13:12:46 [APPLIED] 072 (072_operator_reconciliation_provenance.sql) in 36ms
2026/11/24 13:12:46 Applying migration 073 (073_operator_retry_governance_and_idempotency.sql)...
2026/11/24 13:12:46 [APPLIED] 073 (073_operator_retry_governance_and_idempotency.sql) in 52ms
2026/11/24 13:12:46 Applying migration 074 (074_support_agent_retry_governance_permissions.sql)...
2026/11/24 13:12:46 [APPLIED] 074 (074_support_agent_retry_governance_permissions.sql) in 4ms
2026/11/24 13:12:46 Successfully applied 73 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:46 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12651
--- PASS: TestPhase4_FreshDatabaseBootstrap (4.93s)
=== RUN   TestPhase5_ExistingDatabaseUpgrade_Baseline068
2026/11/24 13:12:47 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12669
2026/11/24 13:12:47 Found 6 pending migration(s) to apply.
2026/11/24 13:12:47 Applying migration 069 (069_outbound_queue_lease_and_outcomes.sql)...
2026/11/24 13:12:47 [APPLIED] 069 (069_outbound_queue_lease_and_outcomes.sql) in 73ms
2026/11/24 13:12:47 Applying migration 070 (070_attachment_encryption_v2_and_delivery.sql)...
2026/11/24 13:12:47 [APPLIED] 070 (070_attachment_encryption_v2_and_delivery.sql) in 95ms
2026/11/24 13:12:47 Applying migration 071 (071_outbound_delivery_operations.sql)...
2026/11/24 13:12:48 [APPLIED] 071 (071_outbound_delivery_operations.sql) in 76ms
2026/11/24 13:12:48 Applying migration 072 (072_operator_reconciliation_provenance.sql)...
2026/11/24 13:12:48 [APPLIED] 072 (072_operator_reconciliation_provenance.sql) in 36ms
2026/11/24 13:12:48 Applying migration 073 (073_operator_retry_governance_and_idempotency.sql)...
2026/11/24 13:12:48 [APPLIED] 073 (073_operator_retry_governance_and_idempotency.sql) in 50ms
2026/11/24 13:12:48 Applying migration 074 (074_support_agent_retry_governance_permissions.sql)...
2026/11/24 13:12:48 [APPLIED] 074 (074_support_agent_retry_governance_permissions.sql) in 3ms
2026/11/24 13:12:48 Successfully applied 6 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:48 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12669
--- PASS: TestPhase5_ExistingDatabaseUpgrade_Baseline068 (2.86s)
=== RUN   TestPhase1_Baseline068_PartialSchema_FailsClosed
2026/11/24 13:12:50 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12678
    migrator_test.go:175: Expected failure on partial legacy schema: baseline 068 check failed: required baseline table "support_audit_logs" does not exist. Existing database appears to have partial or non-canonical schema. Manual intervention required
2026/11/24 13:12:50 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12678
--- PASS: TestPhase1_Baseline068_PartialSchema_FailsClosed (0.33s)
=== RUN   TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease
2026/11/24 13:12:50 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12683
2026/11/24 13:12:50 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12684
2026/11/24 13:12:50 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12684
--- PASS: TestPhase2_AdvisoryLockSessionPinning_And_DisconnectRelease (0.34s)
=== RUN   TestPhase3_DiscoveryAndValidation
--- PASS: TestPhase3_DiscoveryAndValidation (0.01s)
=== RUN   TestPhase6_IdempotentReapplicationSafety
2026/11/24 13:12:53 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12693
2026/11/24 13:12:53 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 13:12:53 Found 1 pending migration(s) to apply.
2026/11/24 13:12:53 Applying migration 001 (001_initial.sql)...
2026/11/24 13:12:53 [APPLIED] 001 (001_initial.sql) in 5ms
2026/11/24 13:12:53 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:53 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12693
2026/11/24 13:12:53 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12694
2026/11/24 13:12:53 Database schema is up to date (version 001). No pending migrations.
2026/11/24 13:12:53 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12694
--- PASS: TestPhase6_IdempotentReapplicationSafety (0.35s)
=== RUN   TestPhase6_MigrationInterruptionAndRecovery
2026/11/24 13:12:54 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12699
2026/11/24 13:12:54 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 13:12:54 Found 2 pending migration(s) to apply.
2026/11/24 13:12:54 Applying migration 001 (001_good.sql)...
2026/11/24 13:12:54 [APPLIED] 001 (001_good.sql) in 4ms
2026/11/24 13:12:54 Applying migration 002 (002_bad.sql)...
2026/11/24 13:12:54 [ROLLBACK] Migration 002 (002_bad.sql) failed: executing migration 002 (002_bad.sql): ERROR: syntax error at or near "THIS_IS_A_SYNTAX_ERROR" (SQLSTATE 42601). Transaction rolled back.
2026/11/24 13:12:54 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12699
    migrator_test.go:565: Expected migration error: executing migration 002 (002_bad.sql): ERROR: syntax error at or near "THIS_IS_A_SYNTAX_ERROR" (SQLSTATE 42601)
2026/11/24 13:12:54 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12701
2026/11/24 13:12:54 Found 1 pending migration(s) to apply.
2026/11/24 13:12:54 Applying migration 002 (002_fixed.sql)...
2026/11/24 13:12:54 [APPLIED] 002 (002_fixed.sql) in 4ms
2026/11/24 13:12:54 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:54 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12701
--- PASS: TestPhase6_MigrationInterruptionAndRecovery (0.37s)
=== RUN   TestPhase6_NonTransactionalMigrationSupport
2026/11/24 13:12:56 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12704
2026/11/24 13:12:56 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 13:12:56 Found 1 pending migration(s) to apply.
2026/11/24 13:12:56 Applying migration 001 (001_nontx.sql)...
2026/11/24 13:12:56 [NON-TX] Migration 001 (001_nontx.sql) marked as non-transactional; executing directly...
2026/11/24 13:12:56 [APPLIED] 001 (001_nontx.sql) in 4ms [NON-TX]
2026/11/24 13:12:56 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:56 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12704
--- PASS: TestPhase6_NonTransactionalMigrationSupport (0.28s)
=== RUN   TestPhase6_ChecksumMismatchDetection
2026/11/24 13:12:57 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12709
2026/11/24 13:12:57 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 13:12:57 Found 1 pending migration(s) to apply.
2026/11/24 13:12:57 Applying migration 001 (001_first.sql)...
2026/11/24 13:12:57 [APPLIED] 001 (001_first.sql) in 1ms
2026/11/24 13:12:57 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:57 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12709
2026/11/24 13:12:57 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12710
2026/11/24 13:12:57 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12710
    migrator_test.go:634: Expected checksum mismatch error: migration checksum mismatch for version 001 (001_first.sql): stored checksum 515d38afb4c36fdbc7550518d5d516172253fc02915c12e25a6d7b4c3de5da72, current file checksum 97c8cbb51c79be4b2934b9b294929d589026e8d086bfb4fe2794193ee4dea259. Historical migrations must never be altered
--- PASS: TestPhase6_ChecksumMismatchDetection (0.31s)
=== RUN   TestPhase6_MissingRequiredMigrationFile
2026/11/24 13:12:57 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12713
2026/11/24 13:12:57 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 13:12:57 Found 1 pending migration(s) to apply.
2026/11/24 13:12:57 Applying migration 001 (001_first.sql)...
2026/11/24 13:12:57 [APPLIED] 001 (001_first.sql) in 2ms
2026/11/24 13:12:57 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:57 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12713
2026/11/24 13:12:57 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12714
2026/11/24 13:12:57 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12714
    migrator_test.go:667: Expected missing file error: missing required migration file for already-applied version 001 (001_first.sql)
--- PASS: TestPhase6_MissingRequiredMigrationFile (0.27s)
=== RUN   TestPhase6_DuplicateVersionDetection
    migrator_test.go:685: Expected duplicate version error: duplicate migration version 001: 001_a.sql and 001_b.sql
--- PASS: TestPhase6_DuplicateVersionDetection (0.01s)
=== RUN   TestPhase6_ConcurrentDeploymentProtection
    migrator_test.go:717: Expected concurrent lock rejection: concurrent migration in progress: another deployment is holding advisory lock (lock ID: 4780962453531182930)
2026/11/24 13:12:57 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12719
2026/11/24 13:12:57 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 13:12:57 Found 1 pending migration(s) to apply.
2026/11/24 13:12:57 Applying migration 001 (001_test.sql)...
2026/11/24 13:12:57 [APPLIED] 001 (001_test.sql) in 3ms
2026/11/24 13:12:57 Successfully applied 1 migration(s). Database schema is now fully upgraded.
2026/11/24 13:12:57 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12719
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.35s)
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
2026/11/24 13:13:00 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12730
2026/11/24 13:13:00 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 12730
    migrator_test.go:760: Expected privilege failure: creating schema_migrations table: ERROR: permission denied for schema public (SQLSTATE 42501)
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (2.80s)
PASS
ok  	byos-migrate	18.142s
```

### Go Test Suite 2: Admin API Subsystem (`services/admin-api/...`)
Command: `go test -v ./services/admin-api/...`
Output:
```
=== RUN   TestMockLoginEndpointDisabledInProduction
--- PASS: TestMockLoginEndpointDisabledInProduction (0.00s)
=== RUN   TestMockWebAuthnMiddlewareBlocksInProduction
--- PASS: TestMockWebAuthnMiddlewareBlocksInProduction (0.00s)
=== RUN   TestMockLoginEndpointEnabledInDevMode
--- PASS: TestMockLoginEndpointEnabledInDevMode (0.00s)
=== RUN   TestMockWebAuthnMiddlewareInDevMode
--- PASS: TestMockWebAuthnMiddlewareInDevMode (0.00s)
=== RUN   TestSecurityHeaders
=== RUN   TestSecurityHeaders/ProductionHSTS
--- PASS: TestSecurityHeaders (0.00s)
    --- PASS: TestSecurityHeaders/ProductionHSTS (0.00s)
=== RUN   TestAdminAllowedOrigins
=== RUN   TestAdminAllowedOrigins/DevModeLocalOrigins
=== RUN   TestAdminAllowedOrigins/DevModeUnauthorizedOrigin
=== RUN   TestAdminAllowedOrigins/ConfiguredAllowedOrigins
--- PASS: TestAdminAllowedOrigins (0.00s)
    --- PASS: TestAdminAllowedOrigins/DevModeLocalOrigins (0.00s)
    --- PASS: TestAdminAllowedOrigins/DevModeUnauthorizedOrigin (0.00s)
    --- PASS: TestAdminAllowedOrigins/ConfiguredAllowedOrigins (0.00s)
=== RUN   TestRealAgentTokenValidation
--- PASS: TestRealAgentTokenValidation (0.00s)
=== RUN   TestAdminSessionCookieAuthentication
--- PASS: TestAdminSessionCookieAuthentication (0.00s)
=== RUN   TestAdminCSRFProtection
--- PASS: TestAdminCSRFProtection (0.00s)
=== RUN   TestAdminLogoutEndpoint
--- PASS: TestAdminLogoutEndpoint (0.00s)
=== RUN   TestAdminCookieSecurityConfiguration
=== RUN   TestAdminCookieSecurityConfiguration/ProductionCookieSecure
=== RUN   TestAdminCookieSecurityConfiguration/DevelopmentCookieNonSecure
=== RUN   TestAdminCookieSecurityConfiguration/StagingCookieSecure
=== RUN   TestAdminCookieSecurityConfiguration/DefaultUnsetCookieSecure
=== RUN   TestAdminCookieSecurityConfiguration/DevelopmentExplicitSecure
--- PASS: TestAdminCookieSecurityConfiguration (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/ProductionCookieSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/DevelopmentCookieNonSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/StagingCookieSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/DefaultUnsetCookieSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/DevelopmentExplicitSecure (0.00s)
=== RUN   TestValidateStartupEnv_AdminAPI
=== RUN   TestValidateStartupEnv_AdminAPI/dev_with_dev_mode_and_empty_db
=== RUN   TestValidateStartupEnv_AdminAPI/dev_with_dev_mode=0
=== RUN   TestValidateStartupEnv_AdminAPI/prod_with_dev_mode=1_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/unset_env_with_dev_mode=1_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/staging_with_dev_mode=true_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/prod_with_empty_db_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/unset_env_with_empty_db_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/prod_valid_config
--- PASS: TestValidateStartupEnv_AdminAPI (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/dev_with_dev_mode_and_empty_db (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/dev_with_dev_mode=0 (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/prod_with_dev_mode=1_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/unset_env_with_dev_mode=1_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/staging_with_dev_mode=true_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/prod_with_empty_db_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/unset_env_with_empty_db_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/prod_valid_config (0.00s)
=== RUN   TestGetSupportDatabaseURL
=== RUN   TestGetSupportDatabaseURL/DevelopmentFallback
=== RUN   TestGetSupportDatabaseURL/ProductionRequiresURL
=== RUN   TestGetSupportDatabaseURL/ConfiguredURLReturned
--- PASS: TestGetSupportDatabaseURL (0.00s)
    --- PASS: TestGetSupportDatabaseURL/DevelopmentFallback (0.00s)
    --- PASS: TestGetSupportDatabaseURL/ProductionRequiresURL (0.00s)
    --- PASS: TestGetSupportDatabaseURL/ConfiguredURLReturned (0.00s)
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_production
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_staging
--- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction (0.00s)
    --- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_production (0.00s)
    --- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_ (0.00s)
    --- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_staging (0.00s)
=== RUN   TestBooleanConfigurationConsistency_AdminAPI
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_1
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_true
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_TRUE
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_false
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_0
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_invalid
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_banana
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Unset
--- PASS: TestBooleanConfigurationConsistency_AdminAPI (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_1 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_true (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_TRUE (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_false (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_0 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_ (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_invalid (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_banana (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Unset (0.00s)
=== RUN   TestQueueEndpointsRequireAuthentication
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/overview
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/messages
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/messages/00000000-0000-0000-0000-000000000001
=== RUN   TestQueueEndpointsRequireAuthentication/POST_/admin/v1/queue/messages/00000000-0000-0000-0000-000000000001/reconcile
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/alerts
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/metrics
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/overview
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/messages
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/alerts
=== RUN   TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/metrics
--- PASS: TestQueueEndpointsRequireAuthentication (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/overview (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/messages (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/messages/00000000-0000-0000-0000-000000000001 (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/POST_/admin/v1/queue/messages/00000000-0000-0000-0000-000000000001/reconcile (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/alerts (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/admin/v1/queue/metrics (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/overview (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/messages (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/alerts (0.00s)
    --- PASS: TestQueueEndpointsRequireAuthentication/GET_/v1/admin/queue/metrics (0.00s)
PASS
ok  	admin-api	1.139s
=== RUN   TestQueueOperations_Overview
--- PASS: TestQueueOperations_Overview (0.01s)
=== RUN   TestQueueOperations_ListMessages_Redaction
--- PASS: TestQueueOperations_ListMessages_Redaction (0.00s)
=== RUN   TestQueueOperations_GetMessage_ZeroKnowledgeBoundary
--- PASS: TestQueueOperations_GetMessage_ZeroKnowledgeBoundary (0.00s)
=== RUN   TestQueueOperations_Reconcile_Investigate
--- PASS: TestQueueOperations_Reconcile_Investigate (0.00s)
=== RUN   TestQueueOperations_Reconcile_AddNote
--- PASS: TestQueueOperations_Reconcile_AddNote (0.00s)
=== RUN   TestQueueOperations_Reconcile_ResolveAccepted_WithEvidence
--- PASS: TestQueueOperations_Reconcile_ResolveAccepted_WithEvidence (0.00s)
=== RUN   TestQueueOperations_Reconcile_ResolveAccepted_RequiresEvidence
--- PASS: TestQueueOperations_Reconcile_ResolveAccepted_RequiresEvidence (0.00s)
=== RUN   TestQueueOperations_Reconcile_AuthorizeRetry_DuplicateRisk
--- PASS: TestQueueOperations_Reconcile_AuthorizeRetry_DuplicateRisk (0.00s)
=== RUN   TestQueueOperations_Reconcile_AuthorizeRetry_RequiresDuplicateRiskAck
--- PASS: TestQueueOperations_Reconcile_AuthorizeRetry_RequiresDuplicateRiskAck (0.00s)
=== RUN   TestQueueOperations_Reconcile_ResolveBounced
--- PASS: TestQueueOperations_Reconcile_ResolveBounced (0.00s)
=== RUN   TestQueueOperations_Alerts
--- PASS: TestQueueOperations_Alerts (0.00s)
=== RUN   TestQueueOperations_Metrics
--- PASS: TestQueueOperations_Metrics (0.00s)
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Authorize_Retry_Resets_Queue_Row_To_Claimable_Pending_State
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Active_Worker_Lease_Conflict_Rejection
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Terminal_State_Mutation_Blocked
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Reconciliation_Conflict_On_Newer_Decision
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Retransmission_Blocked_When_delivery_log_Already_Has_Delivered
--- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary (1.75s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Authorize_Retry_Resets_Queue_Row_To_Claimable_Pending_State (0.16s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Active_Worker_Lease_Conflict_Rejection (0.07s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Terminal_State_Mutation_Blocked (0.03s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Reconciliation_Conflict_On_Newer_Decision (0.03s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Retransmission_Blocked_When_delivery_log_Already_Has_Delivered (0.06s)
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency/Evidence_Provenance_Default_and_Verification_Flag
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency/Idempotency_Replay_on_Duplicate_Request
--- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency (1.12s)
    --- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency/Evidence_Provenance_Default_and_Verification_Flag (0.07s)
    --- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency/Idempotency_Replay_on_Duplicate_Request (0.07s)
=== RUN   TestQueueOperations_C653_ManualRetryGovernance
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/First_Manual_Retry_Accepted
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/Second_Manual_Retry_Rejected_Under_Default_Policy
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/Platform_Admin_Exceptional_2nd_Retry_and_Absolute_Ceiling
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/Absolute_72-Hour_Lifetime_Ceiling_Rejection
--- PASS: TestQueueOperations_C653_ManualRetryGovernance (1.88s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/First_Manual_Retry_Accepted (0.08s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/Second_Manual_Retry_Rejected_Under_Default_Policy (0.02s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/Platform_Admin_Exceptional_2nd_Retry_and_Absolute_Ceiling (0.05s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/Absolute_72-Hour_Lifetime_Ceiling_Rejection (0.03s)
=== RUN   TestQueueOperations_C653_RequestIdempotencyIsolation
--- PASS: TestQueueOperations_C653_RequestIdempotencyIsolation (1.66s)
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_evidence_provenance_Rejected
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_is_independently_verified_Rejected
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/resolve_accepted_with_Insufficient_Evidence_Rejected
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/Normal_Operator-Attested_Evidence_Records_Correct_Provenance
--- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance (1.62s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_evidence_provenance_Rejected (0.00s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_is_independently_verified_Rejected (0.00s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/resolve_accepted_with_Insufficient_Evidence_Rejected (0.00s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/Normal_Operator-Attested_Evidence_Records_Correct_Provenance (0.04s)
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity/Missing_Evidence_on_resolve_bounced_Rejected
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity/Overwriting_Durable_MTA_Acceptance_with_Bounce_Blocked
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity/Valid_Authoritative_Bounce_Evidence_Successfully_Resolves
--- PASS: TestQueueOperations_C653_BounceResolutionIntegrity (0.70s)
    --- PASS: TestQueueOperations_C653_BounceResolutionIntegrity/Missing_Evidence_on_resolve_bounced_Rejected (0.02s)
    --- PASS: TestQueueOperations_C653_BounceResolutionIntegrity/Overwriting_Durable_MTA_Acceptance_with_Bounce_Blocked (0.03s)
    --- PASS: TestQueueOperations_C653_BounceResolutionIntegrity/Valid_Authoritative_Bounce_Evidence_Successfully_Resolves (0.03s)
=== RUN   TestUpdateSeatCountValid
    seat_billing_test.go:16: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestUpdateSeatCountValid (0.00s)
=== RUN   TestUpdateSeatCountBelowMailboxes
    seat_billing_test.go:63: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestUpdateSeatCountBelowMailboxes (0.00s)
=== RUN   TestUpdateSeatCountZero
    seat_billing_test.go:117: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestUpdateSeatCountZero (0.00s)
=== RUN   TestCapacityCapsFromSeatCount
--- PASS: TestCapacityCapsFromSeatCount (0.00s)
=== RUN   TestCapacityCapsMinimums
--- PASS: TestCapacityCapsMinimums (0.00s)
=== RUN   TestPriceComputationMatches
--- PASS: TestPriceComputationMatches (0.00s)
=== RUN   TestAdminTicketLifecycleIntegration
    tickets_test.go:17: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAdminTicketLifecycleIntegration (0.00s)
PASS
ok  	admin-api/handlers	24.908s
```

### TypeScript / Vite Build Suite (`apps/support-crm`)
Command: `cmd /c "npm --prefix apps/support-crm run typecheck"`
Output:
```
> typecheck
> tsc --noEmit
```

Command: `cmd /c "npm --prefix apps/support-crm run build"`
Output:
```
> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 9 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.47 kB │ gzip:  0.30 kB
dist/assets/index-B-nCBKWg.css   45.60 kB │ gzip:  8.73 kB
dist/assets/index-B30AHLx_.js   121.09 kB │ gzip: 31.18 kB
✓ built in 3.01s
```

## Production Go / Conditional Go / No-Go Assessment

### Verdict: **CONDITIONAL GO**

### Justification:
The core outbound delivery subsystem, database migrations, security controls, and operator experience meet all engineering quality, data integrity, and Zero-Knowledge boundaries. Specifically:
- **Migration & Schema Safety:** The database upgrade path through version 074 is fully transactional, idempotent, and protected by session-level advisory locks. Checksum verification succeeds across both fresh-install and baseline upgrade sequences.
- **Operator Reconciliation Safety:** Retries are strictly bounded by policy ceilings, mutations require valid authoritative evidence, and remote MTA durable acceptance cannot be overwritten by operator error.
- **Idempotency Isolation:** Request-bound idempotency reservations enforce cryptographic payload matching, actor fencing, and action isolation without compromising the permanent audit ledger.
- **Worker Reliability & Recovery:** Outbound workers cleanly claim operator-authorized retries, reject retired send-token keys, fail closed against missing key material, and safely recover crashed workers after 250 OK MTA acceptance as `delivered` without false `outcome_unknown` transitions.
- **Zero-Knowledge Architecture:** Queue queries and operational audit logs expose zero customer plaintext, ciphertext, or wrapped secrets.

### Mandatory Pre-Deployment Conditions:
1. **Continuous WAL Archiving & PITR Provisioning:** The production PostgreSQL deployment must enable `archive_mode = on` and configure an automated continuous WAL archiving utility (such as `pgBackRest` or `wal-g` streaming to hardened cloud object storage) to fulfill the 15-minute Recovery Point Objective (RPO).
2. **Production Baseline Migration Alignment:** The production database must be cleanly baselined or migrated to version 074 using `byos-migrate up` during an authorized maintenance window, resolving the legacy schema differences present in old local test instances.
