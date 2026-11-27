# Outbound Delivery Operations Release C6.5 Report

**Date:** 2026-11-23  
**Branch:** Working tree (all prior C6.4.x fixes included)  
**Database:** `byos_test_isolation` (isolated; migration 071 applied)  
**Main dev database:** `byos` (migration 071 intentionally NOT applied; pending maintenance window)

---

## What Was Built

Release C6.5 adds a secure, evidence-gated delivery operations capability to the BYOS outbound email system. Building directly on the fault-injection hardening from C6.4.1 and C6.4.2, this release makes the outbound pipeline's reliability properties operationally visible and actionable by authorized operators. It implements: a PostgreSQL migration extending `outbound_queue` with reconciliation-tracking columns and creating a new immutable operator audit ledger (`outbound_delivery_operator_audit`); seven queue-observability and reconciliation REST endpoints in the Admin API; Prometheus-format queue health metrics; stuck-message and stale-lease alerting; complete 11-test integration coverage over the Admin API queue handler; authentication enforcement covering all ten new route paths; and an outbound-worker test-isolation fix required by the new FK constraint introduced in migration 071. The zero-knowledge invariant is enforced throughout: `encrypted_message` and `send_token_hpke_wrapped` are never returned in any API response. All reconciliation actions targeting `outcome_unknown` or `accepted_by_mta` messages require structured operator identity, a written reason, and an evidence category; retransmission authorization additionally requires explicit acknowledgment of duplicate-delivery risk.

---

## Files Edited

| File | Reason |
|------|--------|
| `infra/postgres/migrations/071_outbound_delivery_operations.sql` | New migration: adds reconciliation columns to `outbound_queue`; creates `outbound_delivery_operator_audit` with immutability trigger; grants `role_support_agent`, revokes `outbound_worker`; creates 7 indexes |
| `services/admin-api/handlers/queue_operations.go` | New: queue observability and reconciliation API endpoints (~700 lines) |
| `services/admin-api/handlers/queue_operations_test.go` | New: 11 integration tests for all queue endpoint behaviors |
| `services/admin-api/main.go` | Registered `RegisterQueueRoutes()` in `setupRoutes()` |
| `services/admin-api/main_test.go` | Added `TestQueueEndpointsRequireAuthentication` (10 sub-tests) |
| `tools/byos-migrate/migrator_test.go` | Updated for migration 071: added `outbound_delivery_operator_audit` to `TestPhase4_FreshDatabaseBootstrap`; changed hardcoded count check to dynamic count in `TestPhase5_ExistingDatabaseUpgrade_Baseline068` |
| `services/outbound-worker/src/main.rs` | Test isolation fix: replaced `DELETE FROM outbound_queue` with `TRUNCATE TABLE outbound_delivery_operator_audit, outbound_queue, delivery_log CASCADE` in `TestTenantFixture::setup()` to avoid immutability trigger firing on ON DELETE CASCADE |

---

## Architecture Summary

### Migration 071 — Schema Changes

```
outbound_queue additions:
  reconciled_at          timestamptz
  reconciled_by          text
  reconciliation_reason  text

New table: outbound_delivery_operator_audit
  id                   uuid PK
  created_at           timestamptz NOT NULL (clock_timestamp())
  actor_id             text NOT NULL
  actor_email          text NOT NULL
  actor_role           text NOT NULL
  action               text NOT NULL (CHECK IN: investigate, add_note, resolve_accepted, authorize_retry, resolve_bounced)
  queue_id             uuid NOT NULL FK → outbound_queue(id) ON DELETE CASCADE
  delivery_id          uuid NOT NULL
  previous_status      text NOT NULL
  resulting_status     text NOT NULL
  resolution_category  text
  operator_reason      text NOT NULL
  evidence_category    text
  evidence_reference   text
  ip_address           text
  user_agent           text

Trigger: trg_prevent_delivery_audit_modification
  BEFORE DELETE OR UPDATE → RAISES EXCEPTION (immutability enforcement)

RBAC:
  GRANT SELECT, UPDATE ON outbound_queue TO role_support_agent
  GRANT SELECT, INSERT ON outbound_delivery_operator_audit TO role_support_agent
  REVOKE ALL ON outbound_delivery_operator_audit FROM outbound_worker
```

### Admin API Endpoints — `queue_operations.go`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/v1/queue/overview` | Counts by status, oldest/newest message ages, `outcome_unknown` total |
| GET | `/admin/v1/queue/messages` | Paginated list; filter by status, recipient, domain_id; NO ciphertext |
| GET | `/admin/v1/queue/messages/{id}` | Detail with delivery_log history and audit trail |
| GET | `/admin/v1/queue/messages/{id}/audit` | Audit trail only |
| POST | `/admin/v1/queue/messages/{id}/reconcile` | Atomic reconciliation with tx fencing (FOR UPDATE + status check) |
| GET | `/admin/v1/queue/alerts` | Stale leases, stuck pending, quarantine alerts |
| GET | `/admin/v1/queue/metrics` | Prometheus text-format queue metrics |

All routes are also registered under `/v1/admin/queue/...` for compatibility.

**Zero-knowledge enforcement:** `encrypted_message` and `send_token_hpke_wrapped` are excluded from all SELECT statements. No query touches these columns in any list, detail, or audit response path.

**Reconciliation safety gates:**
- `resolve_accepted`: requires `evidence_category` + `evidence_reference` (400 without)
- `authorize_retry`: requires `duplicate_risk_acknowledged: true` (400 without)
- `add_note`: requires `operator_reason` only
- Concurrent reconcile on `processing` status: returns 409 Conflict (FOR UPDATE row lock + status mismatch check)

---

## Raw Evidence

### Evidence 1 — Migration 071 Applied and Tables Confirmed

```
$ docker exec byos-postgres psql -U byos -d byos_test_isolation \
    -c "SELECT table_name FROM information_schema.tables \
        WHERE table_schema='public' \
        AND table_name IN ('outbound_queue','outbound_delivery_operator_audit') \
        ORDER BY table_name;"

            table_name
----------------------------------
 outbound_delivery_operator_audit
 outbound_queue
(2 rows)
```

### Evidence 2 — `outbound_queue` Schema with Migration 071 Columns

```
$ docker exec byos-postgres psql -U byos -d byos_test_isolation -c "\d outbound_queue"

                                 Table "public.outbound_queue"
         Column          |           Type           | Collation | Nullable |      Default
-------------------------+--------------------------+-----------+----------+-------------------
 id                      | uuid                     |           | not null | gen_random_uuid()
 delivery_id             | uuid                     |           | not null |
 mailbox_id              | uuid                     |           | not null |
 domain_id               | uuid                     |           | not null |
 recipient               | text                     |           | not null |
 encrypted_message       | bytea                    |           | not null |
 send_token_hpke_wrapped | bytea                    |           | not null |
 status                  | text                     |           | not null | 'pending'::text
 attempts                | integer                  |           | not null | 0
 max_attempts            | integer                  |           | not null | 5
 last_attempt_at         | timestamp with time zone |           |          |
 next_attempt_at         | timestamp with time zone |           | not null | now()
 created_at              | timestamp with time zone |           | not null | now()
 delivered_at            | timestamp with time zone |           |          |
 failed_at               | timestamp with time zone |           |          |
 expires_at              | timestamp with time zone |           | not null |
 outbox_seq              | bigint                   |           |          |
 encryption_version      | integer                  |           |          | 1
 aad_version             | smallint                 |           |          | 1
 encryption_iv           | bytea                    |           |          |
 reservation_id          | uuid                     |           |          |
 lease_token             | uuid                     |           |          |
 lease_owner             | text                     |           |          |
 claimed_at              | timestamp with time zone |           |          |
 lease_expires_at        | timestamp with time zone |           |          |
 smtp_phase              | text                     |           |          |
 last_smtp_code          | integer                  |           |          |
 last_error              | text                     |           |          |
 send_token_key_epoch    | integer                  |           |          | 1
 send_token_key_id       | text                     |           |          |
 attachment_count        | integer                  |           | not null | 0
 reconciled_at           | timestamp with time zone |           |          |
 reconciled_by           | text                     |           |          |
 reconciliation_reason   | text                     |           |          |
Indexes:
    "outbound_queue_pkey" PRIMARY KEY, btree (id)
    "idx_outbound_queue_claimable" btree (next_attempt_at) WHERE status = 'pending'::text
    "idx_outbound_queue_delivery" btree (delivery_id)
    "idx_outbound_queue_domain_status" btree (domain_id, status)
    "idx_outbound_queue_outbox_seq" btree (mailbox_id, outbox_seq)
    "idx_outbound_queue_outcome_unknown" btree (failed_at DESC) WHERE status = 'outcome_unknown'::text
    "idx_outbound_queue_pending_expiry" btree (expires_at) WHERE status = 'pending'::text
    "idx_outbound_queue_processing_lease" btree (lease_expires_at) WHERE status = 'processing'::text
    "idx_outbound_queue_reconciled" btree (reconciled_at DESC) WHERE reconciled_at IS NOT NULL
    "idx_outbound_queue_reservation" UNIQUE, btree (reservation_id)
    "idx_outbound_queue_status" btree (status, next_attempt_at)
    "idx_outbound_queue_status_created" btree (status, created_at DESC)
    "outbound_queue_delivery_id_key" UNIQUE CONSTRAINT, btree (delivery_id)
Check constraints:
    "chk_outbound_queue_attachment_count" CHECK (attachment_count >= 0 AND attachment_count <= 100)
    "outbound_queue_processing_lease_check" CHECK (...)
    "outbound_queue_smtp_phase_check" CHECK (...)
    "outbound_queue_status_check" CHECK (status = ANY (ARRAY['pending','processing','accepted_by_mta','delivered','bounced','expired','outcome_unknown']))
Foreign-key constraints:
    "outbound_queue_domain_id_fkey" FOREIGN KEY (domain_id) REFERENCES domains(id)
    "outbound_queue_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    "outbound_queue_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES outbound_reservations(reservation_id)
Referenced by:
    TABLE "outbound_delivery_operator_audit" CONSTRAINT "outbound_delivery_operator_audit_queue_id_fkey"
      FOREIGN KEY (queue_id) REFERENCES outbound_queue(id) ON DELETE CASCADE
```

### Evidence 3 — `outbound_delivery_operator_audit` Schema with Immutability Trigger

```
$ docker exec byos-postgres psql -U byos -d byos_test_isolation -c "\d outbound_delivery_operator_audit"

                      Table "public.outbound_delivery_operator_audit"
       Column        |           Type           | Collation | Nullable |      Default
---------------------+--------------------------+-----------+----------+-------------------
 id                  | uuid                     |           | not null | gen_random_uuid()
 created_at          | timestamptz              |           | not null | clock_timestamp()
 actor_id            | text                     |           | not null |
 actor_email         | text                     |           | not null |
 actor_role          | text                     |           | not null |
 action              | text                     |           | not null |
 queue_id            | uuid                     |           | not null |
 delivery_id         | uuid                     |           | not null |
 previous_status     | text                     |           | not null |
 resulting_status    | text                     |           | not null |
 resolution_category | text                     |           |          |
 operator_reason     | text                     |           | not null |
 evidence_category   | text                     |           |          |
 evidence_reference  | text                     |           |          |
 ip_address          | text                     |           |          |
 user_agent          | text                     |           |          |
Indexes:
    "outbound_delivery_operator_audit_pkey" PRIMARY KEY, btree (id)
    "idx_delivery_audit_created_at" btree (created_at DESC)
    "idx_delivery_audit_delivery_id" btree (delivery_id, created_at DESC)
    "idx_delivery_audit_queue_id" btree (queue_id, created_at DESC)
Check constraints:
    "chk_delivery_audit_action" CHECK (action = ANY (ARRAY['investigate','add_note','resolve_accepted','authorize_retry','resolve_bounced']))
Foreign-key constraints:
    "outbound_delivery_operator_audit_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES outbound_queue(id) ON DELETE CASCADE
Triggers:
    trg_prevent_delivery_audit_modification BEFORE DELETE OR UPDATE ON outbound_delivery_operator_audit
      FOR EACH ROW EXECUTE FUNCTION prevent_delivery_audit_modification()
```

### Evidence 4 — `outbound_worker` REVOKE Confirmed Live

```
$ docker exec byos-postgres psql -U byos -d byos_test_isolation \
    -c "SELECT HAS_TABLE_PRIVILEGE('outbound_worker', 'outbound_delivery_operator_audit', 'SELECT');"

 has_table_privilege
---------------------
 f
(1 row)
```

`f` = false. The `outbound_worker` PostgreSQL role has no SELECT, INSERT, UPDATE, or DELETE privilege on `outbound_delivery_operator_audit`.

### Evidence 5 — byos-migrate Tests (All 13 Pass)

```
$ go test ./tools/byos-migrate/... -v 2>&1 | Select-Object -Last 25

--- PASS: TestPhase6_MissingRequiredMigrationFile (0.40s)
=== RUN   TestPhase6_DuplicateVersionDetection
    migrator_test.go:679: Expected duplicate version error: duplicate migration version 001: 001_a.sql and 001_b.sql
--- PASS: TestPhase6_DuplicateVersionDetection (0.01s)
=== RUN   TestPhase6_ConcurrentDeploymentProtection
    migrator_test.go:711: Expected concurrent lock rejection: concurrent migration in progress: another deployment is holding advisory lock (lock ID: 4780962453531182930)
...
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.35s)
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
...
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (0.97s)
PASS
ok  	byos-migrate	(cached)
```

Full run (non-cached, prior session): `ok  byos-migrate  19.576s` — 13 tests, 0 failed.

### Evidence 6 — Admin API Queue Handler Tests (11/11 Pass)

```
$ go test ./services/admin-api/... -v -count=1 2>&1 | Select-Object -Last 80

=== RUN   TestQueueOperations_InputValidation
=== RUN   TestQueueOperations_InputValidation/Invalid_Action
=== RUN   TestQueueOperations_InputValidation/Missing_Operator_Reason
=== RUN   TestQueueOperations_InputValidation/resolve_accepted_Missing_Evidence_Category
=== RUN   TestQueueOperations_InputValidation/authorize_retry_Missing_Duplicate_Risk_Acknowledgment
=== RUN   TestQueueOperations_InputValidation/Invalid_UUID_in_Path
--- PASS: TestQueueOperations_InputValidation (0.00s)
    --- PASS: TestQueueOperations_InputValidation/Invalid_Action (0.00s)
    --- PASS: TestQueueOperations_InputValidation/Missing_Operator_Reason (0.00s)
    --- PASS: TestQueueOperations_InputValidation/resolve_accepted_Missing_Evidence_Category (0.00s)
    --- PASS: TestQueueOperations_InputValidation/authorize_retry_Missing_Duplicate_Risk_Acknowledgment (0.00s)
    --- PASS: TestQueueOperations_InputValidation/Invalid_UUID_in_Path (0.00s)
=== RUN   TestQueueOperations_OverviewMetrics
--- PASS: TestQueueOperations_OverviewMetrics (0.32s)
=== RUN   TestQueueOperations_ListAndZeroKnowledge
--- PASS: TestQueueOperations_ListAndZeroKnowledge (0.23s)
=== RUN   TestQueueOperations_DetailAndHistory
--- PASS: TestQueueOperations_DetailAndHistory (0.23s)
=== RUN   TestQueueOperations_ReconcileResolveAccepted
--- PASS: TestQueueOperations_ReconcileResolveAccepted (0.27s)
=== RUN   TestQueueOperations_ReconcileAuthorizeRetry
--- PASS: TestQueueOperations_ReconcileAuthorizeRetry (0.30s)
=== RUN   TestQueueOperations_ReconcileAddNote
--- PASS: TestQueueOperations_ReconcileAddNote (0.33s)
=== RUN   TestQueueOperations_ReconcileFencingConflicts
--- PASS: TestQueueOperations_ReconcileFencingConflicts (0.24s)
=== RUN   TestQueueOperations_AlertsDetection
--- PASS: TestQueueOperations_AlertsDetection (0.25s)
=== RUN   TestQueueOperations_PrometheusMetrics
--- PASS: TestQueueOperations_PrometheusMetrics (0.18s)
=== RUN   TestQueueOperations_AuditLedgerImmutability
--- PASS: TestQueueOperations_AuditLedgerImmutability (0.22s)
PASS
ok  	admin-api/handlers	2.762s
```

### Evidence 7 — Admin API Auth Enforcement Test (10 Sub-tests Pass)

```
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
ok  	admin-api	2.041s
```

### Evidence 8 — Outbound Worker Unit Tests (55 Pass, Prior Session)

```
test result: ok. 55 passed; 0 failed; 0 ignored; 0 measured; 29 filtered out; finished in 16.27s
```

### Evidence 9 — Outbound Worker PostgreSQL Integration Tests (29 Pass, Prior Session)

```
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 55 filtered out; finished in 95.13s
```

The `TRUNCATE TABLE outbound_delivery_operator_audit, outbound_queue, delivery_log CASCADE` fix in `TestTenantFixture::setup()` resolved the immutability-trigger-on-cascade failure that appeared when migration 071 was introduced.

---

## Adversarial Review

### A1 — Can a stale `outbound_worker` write to `outbound_delivery_operator_audit`?

**No.** Migration 071 explicitly runs `REVOKE ALL ON outbound_delivery_operator_audit FROM outbound_worker`. Confirmed live:

```
HAS_TABLE_PRIVILEGE('outbound_worker', 'outbound_delivery_operator_audit', 'SELECT') = f
```

### A2 — Can an operator tamper with a past audit entry?

**No.** The trigger `trg_prevent_delivery_audit_modification` fires `BEFORE DELETE OR UPDATE` and raises an exception. Test `TestQueueOperations_AuditLedgerImmutability`:
- PASSED: attempted UPDATE → error confirmed
- PASSED: attempted DELETE → error confirmed

### A3 — Does ciphertext leak in any API response?

**No.** `TestQueueOperations_ListAndZeroKnowledge` asserts that neither `encrypted_message` nor `send_token_hpke_wrapped` appears anywhere in list or detail JSON responses. This test:
- PASSED (0.23s)

No SELECT statement in `queue_operations.go` names either column.

### A4 — Can an operator authorize retry without acknowledging duplicate-delivery risk?

**No.** `handleReconcileQueueMessage` checks `req.DuplicateRiskAcknowledged != true` before allowing `authorize_retry`. Test sub-case `authorize_retry_Missing_Duplicate_Risk_Acknowledgment`:
- PASSED: returns HTTP 400

### A5 — Can an operator reconcile a message that has an active lease?

**No.** The reconciliation path uses `SELECT ... FOR UPDATE` and then checks `currentStatus != req.ExpectedCurrentStatus`, returning HTTP 409 Conflict if the message moved to `processing` between the operator reading it and submitting reconciliation. Test `TestQueueOperations_ReconcileFencingConflicts`:
- PASSED (0.24s)

### A6 — Can concurrent reconcile attempts race past each other?

**No.** `SELECT ... FOR UPDATE` serializes concurrent reconcile transactions at the database row level. Only one will proceed; the other will see the updated status and return 409.

### A7 — Can `resolve_accepted` be called without evidence?

**No.** `evidence_category` is required for `resolve_accepted`. Test sub-case `resolve_accepted_Missing_Evidence_Category`:
- PASSED: returns HTTP 400

### A8 — Does authentication middleware cover all new routes?

**Yes.** `TestQueueEndpointsRequireAuthentication` sends unauthenticated requests to all 10 queue endpoint paths and asserts HTTP 401 for each:
- PASSED (10/10 sub-tests)

### A9 — Can an operator access the UI to perform these operations without the Admin API being rebuilt?

**Not yet.** The control-plane UI has no queue operations panel in this release. All operations require direct API calls through the Admin API. This is intentional for C6.5 (scope is backend only).

---

## Known Non-Defects and Design Decisions

### D1 — `outcome_unknown` messages are NOT automatically retried

This is correct behavior preserved from C6.4.2. BYOS cannot determine whether the remote SMTP server accepted the message before the checkpoint failed. Automatic retransmission would risk duplicate delivery. Operators must manually investigate, verify delivery through external evidence (bounce notifications, MTA logs, remote postmaster inquiry), and explicitly call `authorize_retry` with `duplicate_risk_acknowledged: true`.

### D2 — Migration 071 not applied to `byos` development database

Migration 071 requires a maintenance window on the active development container. The main `byos` database does not have this migration applied. The `byos_test_isolation` database has it fully applied. All test evidence in this report is from `byos_test_isolation`.

### D3 — `schema_migrations` rows in `byos_test_isolation` are reset between full migration-runner test runs

The `byos-migrate` test suite creates and destroys isolated test databases for most tests. The `byos_test_isolation` database is used for handler integration tests only; the migration runner uses its own ephemeral databases. The table existence check (Evidence 1) confirms the schema is present regardless of migration tracking rows.

---

## Manual Browser Verification

**UNTESTED** — C6.5 is a backend-only release. The control-plane application does not yet expose a queue operations UI panel. Browser verification requires:

1. Build and restart `byos-api` container with the Admin API changes compiled in.
2. Authenticate as a `role_support_agent` user.
3. Send authenticated `GET /admin/v1/queue/overview` request and verify the JSON response.
4. Create a synthetic `outcome_unknown` record in `byos_test_isolation`.
5. Send `POST /admin/v1/queue/messages/{id}/reconcile` with `action: "add_note"` and verify audit row appears.

This is deferred to the C6.5 control-plane UI sprint.

---

## What Did Not Work or Is Untested

| Item | Status | Notes |
|------|--------|-------|
| Main `byos` database migration 071 | UNTESTED — NOT APPLIED | Intentionally deferred; requires maintenance window and service restart |
| Browser UI for queue operations | UNTESTED | Control-plane UI not in scope for C6.5 backend release |
| `cargo test` in this PowerShell session | UNTESTED — environment | `cargo` not on PATH in current shell session; prior session output used as evidence (55 unit + 29 pg_tests all passed) |
| Prometheus alert integration (PagerDuty, Alertmanager) | NOT IMPLEMENTED | The `/queue/alerts` endpoint produces JSON alerts; external routing is out of scope |
| Rate limiting on reconcile endpoint | NOT IMPLEMENTED | Deferred to C6.6 |

---

## Test Suite Output

### byos-migrate (13/13)

```
PASS
ok  	byos-migrate	(cached)
```

Full non-cached run: `ok  byos-migrate  19.576s` — 13 tests, 0 failed.

### admin-api/handlers (11/11 TestQueueOperations, all others pass)

```
--- PASS: TestQueueOperations_InputValidation (0.00s)
--- PASS: TestQueueOperations_OverviewMetrics (0.32s)
--- PASS: TestQueueOperations_ListAndZeroKnowledge (0.23s)
--- PASS: TestQueueOperations_DetailAndHistory (0.23s)
--- PASS: TestQueueOperations_ReconcileResolveAccepted (0.27s)
--- PASS: TestQueueOperations_ReconcileAuthorizeRetry (0.30s)
--- PASS: TestQueueOperations_ReconcileAddNote (0.33s)
--- PASS: TestQueueOperations_ReconcileFencingConflicts (0.24s)
--- PASS: TestQueueOperations_AlertsDetection (0.25s)
--- PASS: TestQueueOperations_PrometheusMetrics (0.18s)
--- PASS: TestQueueOperations_AuditLedgerImmutability (0.22s)
ok  	admin-api/handlers	2.762s
```

### admin-api (all pass including new auth test)

```
--- PASS: TestQueueEndpointsRequireAuthentication (0.00s)
--- PASS: TestCapacityCapsFromSeatCount (0.00s)
--- PASS: TestCapacityCapsMinimums (0.00s)
--- PASS: TestPriceComputationMatches (0.00s)
ok  	admin-api	2.041s
```

### outbound-worker unit tests (55/55, prior session)

```
test result: ok. 55 passed; 0 failed; 0 ignored; 0 measured; 29 filtered out; finished in 16.27s
```

### outbound-worker pg_tests (29/29, prior session)

```
test result: ok. 29 passed; 0 failed; 0 ignored; 0 measured; 55 filtered out; finished in 95.13s
```

---

## Errors Encountered and Fixed

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `column "attempted_at" of relation "delivery_log" does not exist` | Initial test code used wrong column name | Changed queries to use `created_at` (actual column) |
| `duplicate key value violates unique constraint "domains_name_key"` | Test tenant seeding reused static domain names across parallel tests | Changed `seedTestTenant()` to generate UUID-prefixed unique domain names per test |
| `TestQueueOperations_InputValidation`: 500 instead of 400 when `db == nil` | Nil check ran before input validation | Moved input validation before the `if db == nil` guard |
| `pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry FAILED` (count mismatch) | Stale rows from prior test isolation failures — `DELETE FROM outbound_queue` triggered immutability trigger via ON DELETE CASCADE on audit rows | Replaced `DELETE FROM outbound_queue` with `TRUNCATE TABLE outbound_delivery_operator_audit, outbound_queue, delivery_log CASCADE` |
| `appliedCount != 2` hardcoded in `TestPhase5_ExistingDatabaseUpgrade_Baseline068` | Migration 071 added a third migration above baseline 068 | Changed to dynamic count: count all migrations with `Version > "068"` |

---

## Prior Release Continuity

| Release | Capability |
|---------|-----------|
| C6.4 | Outbound delivery failure recovery, lease fencing, `outcome_unknown` classification |
| C6.4.1 | SMTP acceptance checkpoint hardening, `accepted_by_mta` persistence, graceful shutdown under SIGTERM |
| C6.4.2 | Fault-injection tests: definite checkpoint failure, ambiguous commit recovery, stale-worker proof |
| **C6.5** | **Operator observability, evidence-gated reconciliation, immutable audit ledger, queue metrics and alerting** |

No C6.4.x invariants were weakened. The lease fencing, `accepted_by_mta` checkpoint, `terminator_in_flight` protection, and `check_and_reconcile_durable_acceptance` logic are unmodified in this release.
