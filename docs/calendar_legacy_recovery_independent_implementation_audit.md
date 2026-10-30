# BYOS Calendar Legacy Plaintext Recovery: Independent Implementation Audit Report

## 1. Executive Summary & Audit Verdict

This audit provides an independent, read-only security, architectural, and data-safety evaluation of the legacy calendar event plaintext recovery workflow implemented in the BYOS repository.

The implementation was evaluated directly against the safety contract specified in `docs/calendar_legacy_recovery_safety_review.md` and the claims recorded in `docs/calendar_legacy_recovery_implementation_report.md`. All empirical testing was conducted exclusively against an isolated disposable database (`byos_recovery_disposable_20261024`). The active production database (`byos`) was inspected in a strictly read-only manner and remained completely untouched.

### Overall Audit Verdict
PASS (WITH RESERVATIONS AND IDENTIFIED LIMITATIONS)
```
================================================================================
AUDIT VERDICT: PASS WITH RESERVATIONS AND IDENTIFIED LIMITATIONS
================================================================================
Status: CONDITIONALLY ACCEPTED PENDING OPERATIONAL REMEDIATION

The cryptographic core, client-side mailbox key provenance assertion, server-side
atomic staging isolation, deterministic RFC 9110 strong ETag precondition
handling, and client-side read-back verification with automated rollback are soundly
architected and empirically validated in disposable test execution.

However, production execution against active data must remain BLOCKED until the
following two Medium-severity and two Low-severity findings are addressed:

1. [MEDIUM] Intra-Organization Authorization Hole:
   `resolveDraftMailbox` validates that the user's organization matches the mailbox's
   organization, but fails to check that `mailboxes.user_id == userID`. In a multi-user
   organization, any user could target another user's calendar events.
2. [MEDIUM] Orphaned Disaster Recovery Reconciliation:
   `ReconcileRestoredMigrations` was authored and tested, but is never invoked by
   `main.go` on server boot or by any background scheduler. Stale migrations will
   only be swept reactively per-event upon access.
3. [LOW] Duplicate Plaintext Retention on Rollback:
   When a staged migration rolls back, the legacy payload is restored to `calendar_events`,
   but `calendar_event_migrations.legacy_payload` is NOT nulled, leaving duplicate
   plaintext indefinitely in the staging table.
4. [LOW] Concurrency Window on Ordinary Event Updates:
   Ordinary `PATCH`/`PUT` updates check active staged migrations without a row lock
   on `calendar_events`, permitting a concurrent staging race.
================================================================================
```

---

## 2. Security Properties Status Matrix

The following table records the status of each core security property mandated by the recovery contract.

| Security Property | Audit Status | Forensic Summary |
|:---|:---:|:---|
| **Active Database Isolation** | VALIDATED | Migration 060 is not applied to active `byos`. The 3 legacy records remain intact and quarantined. |
| **Mailbox-Key Authenticity & Provenance** | VALIDATED | Client asserts 32-byte secret key, active `unlockedBoxId == mailboxId`, and mathematical X25519 HPKE seal/open pairing against registered `mailbox_pk`. |
| **Atomic Staging & Preservation** | VALIDATED | Staging acquires exclusive row lock on `calendar_events`, archives legacy payload, inserts staging row, updates event to ciphertext, and computes strong ETag in a single transaction. |
| **Client Read-Back & Rollback** | VALIDATED | Client fetches staged event with ETag, decrypts via client WASM AES-GCM, compares byte-for-byte with legacy JSON, and dispatches automated rollback on mismatch or failure. |
| **RFC 9110 Strong ETag Determinism** | VALIDATED | `computeCalendarEventETag` computes SHA-256 over 10 canonical event fields with strict RFC 3339 Nano UTC formatting. Preconditions strictly enforced. |
| **Hierarchical Database Row Locking** | PARTIALLY VALIDATED | Staging, finalization, and rollback strictly adhere to canonical lock hierarchy (`calendar_events` first, `calendar_event_migrations` second). However, ordinary `PATCH` checks staging outside a transaction lock. |
| **Opportunistic Expiration on Read** | VALIDATED | Any `GET`, `PATCH`, `DELETE`, or `migration-status` check for an expired staged migration triggers automatic rollback before request processing resumes. |
| **Post-Restore Disaster Reconciliation** | DEFICIENT | `ReconcileRestoredMigrations` is implemented and unit-tested, but is orphaned in application startup; no boot hook or daemon calls it. |
| **Tenant & Mailbox Boundary Authorization** | DEFICIENT | `resolveDraftMailbox` checks organization ID matching (`userOrgID == mailboxOrgID`), but does not assert user-level ownership (`mailboxes.user_id == userID`). |
| **Plaintext Erasure on Finalization** | VALIDATED | Logical erasure: `legacy_payload` is set to `NULL` upon finalization. Physical storage subject to PostgreSQL MVCC dead-tuple vacuuming and WAL retention. |
| **Plaintext Disposal on Rollback** | DEFICIENT | Rollback restores `legacy_payload` to `calendar_events` but leaves `legacy_payload` populated in `calendar_event_migrations`, creating duplicate plaintext persistence. |
| **Foreign Key Deletion Guards** | VALIDATED | `ON DELETE RESTRICT` on `event_id` and `mailbox_id` prevents event or mailbox deletion during staging. Note: Also anchors finalized events from deletion. |

---

## 3. Forensic Codebase Inspection & Architectural Analysis

### 3.1 Database Migration Schema (`060_calendar_event_migrations.sql`)
The migration table `calendar_event_migrations` was inspected at `infra/postgres/init/060_calendar_event_migrations.sql`:
- **Columns**: `id`, `event_id`, `mailbox_id`, `legacy_payload` (bytea, nullable), `staged_payload` (bytea, not null), `status` (text check in `staged`, `finalized`, `rolled_back`), `etag` (text, not null), `created_at`, `expires_at` (default +15 minutes), `finalized_at`, `rolled_back_at`, `rollback_reason`.
- **Partial Unique Index**: `uq_calendar_event_active_migration` on `(event_id) WHERE status = 'staged'`. This database-level constraint guarantees that no more than one active staged migration can exist for a given event, preventing concurrent duplicate staging attempts.
- **Foreign Keys**:
  - `event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE RESTRICT`
  - `mailbox_id uuid NOT NULL REFERENCES mailboxes(id) ON DELETE RESTRICT`
  These foreign keys prevent accidental deletion of parent events or mailboxes during an active migration.
- **Architectural Side Effect**: Because the foreign keys are defined unconditionally across all statuses (not scoped only to `status = 'staged'`), any event that has undergone migration retains a historical record in `calendar_event_migrations`. Consequently, subsequent attempts to delete the event (`DELETE /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}`) will fail with a foreign key violation unless the corresponding migration rows are also cleaned up.

### 3.2 Authorization & Access Control Analysis (`resolveDraftMailbox`)
Every calendar handler, including the migration endpoints (`stage-migration`, `migration-status`, `finalize-migration`, `rollback-migration`), invokes `resolveDraftMailbox` at `services/api/drafts.go:54-83` for authentication and access control:

```go
// services/api/drafts.go:54-83
func resolveDraftMailbox(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context) (userID, userOrgID, mailboxOrgID, mailboxID string, ok bool) {
	...
	err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return "", "", "", "", false
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return "", "", "", "", false
	}
	if mailboxOrgID != userOrgID {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return "", "", "", "", false
	}
	return userID, userOrgID, mailboxOrgID, mailboxID, true
}
```

**Security Vulnerability Analysis (Severity: Medium)**:
- `resolveDraftMailbox` verifies that the caller's organization matches the target mailbox's organization (`mailboxOrgID == userOrgID`).
- It does **NOT** check whether `mailboxes.user_id == userID`.
- In a multi-user organization where User A and User B belong to the same organization, User B possesses a valid session token within that organization. If User B invokes `stage-migration`, `finalize-migration`, or `rollback-migration` targeting User A's `mailbox_id`, the check at line 79 passes.
- While User B could not construct valid client-side AES-GCM ciphertext without User A's mailbox encryption key, User B could trigger a denial of service by calling `rollback-migration` or calling `stage-migration` with arbitrary ciphertext conforming to the 29-byte envelope structure, or querying migration status.
- **Remediation Required**: The query must verify `WHERE id=$1 AND (user_id=$2 OR mode='org_managed')` to enforce user-to-mailbox boundary security within multi-user organizations.

### 3.3 Cryptographic Key Provenance & Authenticity (`calendar_recovery.ts`)
The client recovery controller implements strict three-layer key provenance checking in `validateMailboxKeyProvenance` (`apps/webmail/src/calendar_recovery.ts:66-131`):
1. **Structural Validation**: Ensures `mailboxKey` is an extant `Uint8Array` of exactly 32 bytes.
2. **Custody Assertion**: Ensures `activeUnlockedBoxId === mailboxId`, guaranteeing the key was loaded through the authenticated login/unlock flow for this exact mailbox.
3. **Mathematical Consistency Assertion**: Rather than relying solely on identity labels, it performs an X25519 HPKE seal/open challenge:
   - Generates a 32-byte cryptographically secure random probe.
   - Encrypts the probe using `wasm.wasm_hpke_seal` with the registered public key `mailboxPk`.
   - Decrypts the ciphertext using `wasm.wasm_hpke_open` with the candidate private key `mailboxKey`.
   - Compares the recovered probe to the original probe.
   - If the decrypted probe does not match, or if WASM throws an error, the candidate key is rejected before any network traffic is initiated.

### 3.4 Deterministic Strong RFC 9110 ETag Generation (`computeCalendarEventETag`)
In `services/api/calendar.go:1038-1065`, `computeCalendarEventETag` computes an authoritative strong ETag:
- Canonical inputs include:
  - `id` (UUID string)
  - `mailbox_id` (UUID string)
  - `calendar_id` (UUID string)
  - `start_time` (RFC 3339 Nano UTC)
  - `end_time` (RFC 3339 Nano UTC)
  - `is_all_day` (boolean string)
  - `rrule` (string or empty)
  - `status` (string)
  - `payload_sha256` (hex-encoded SHA-256 of the raw payload bytes)
  - `updated_at` (RFC 3339 Nano UTC)
- Output format: RFC 9110 compliant strong entity tag enclosed in quotes: `"<sha256_hex>"`.
- The `stage-migration` endpoint requires the `If-Match` header. If the provided ETag does not match the computed ETag of the current database record, the server immediately returns `412 Precondition Failed` without altering state.

### 3.5 Database Row-Locking Hierarchy & Deadlock Prevention
The recovery workflow establishes a strict row-locking order:
1. Lock parent row in `calendar_events` via `SELECT ... FOR UPDATE`.
2. Lock child row in `calendar_event_migrations` via `SELECT ... FOR UPDATE`.

This canonical ordering is strictly maintained across:
- `calendarEventStageMigrationHandler` (`services/api/calendar.go:1115-1123`)
- `calendarEventFinalizeMigrationHandler` (`services/api/calendar.go:1299-1309`)
- `calendarEventRollbackMigrationHandler` (`services/api/calendar.go:1300-1310`)
- `opportunisticallyRecoverExpiredMigration` (`services/api/calendar.go:210-218`)
- `ReconcileRestoredMigrations` (`services/api/calendar.go:266-280`)

**Concurrency Limitation (Severity: Low)**:
In `calendarEventsHandler` for `http.MethodPatch` and `http.MethodPut` (`services/api/calendar.go:658-735`), the handler checks for active staged migrations:
```go
// services/api/calendar.go:662-667
var activeStagedCount int
_ = conn.QueryRow(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE event_id=$1 AND status='staged' AND expires_at >= now()`, eventID).Scan(&activeStagedCount)
if activeStagedCount > 0 {
    http.Error(w, "event migration in progress", http.StatusConflict)
    return
}
```
This check and the subsequent `UPDATE calendar_events` are executed as separate statements on `conn` without an enclosing transaction and without acquiring `SELECT ... FOR UPDATE` on `calendar_events`. If a `stage-migration` call commits between lines 663 and 718, an ordinary update could overwrite the staged payload, leading to race-condition anomalies upon finalization or rollback.

### 3.6 Expiration Handling & Disaster Recovery Reconciliation
- **Opportunistic Rollback**: Implemented in `opportunisticallyRecoverExpiredMigration` (`services/api/calendar.go:205-245`). Called transparently whenever an event is accessed via `GET`, `PATCH`, `DELETE`, or `migration-status`. If `expires_at < now()` and `status = 'staged'`, the legacy payload is restored and status is updated to `rolled_back`.
- **Restoration Reconciliation Function**: `ReconcileRestoredMigrations` (`services/api/calendar.go:236-305`) queries all staged migrations where `expires_at < now()`, locks each event and migration row in order, restores the legacy payload, and marks the migration `rolled_back` with `rollback_reason = 'backup_restoration_reconciliation'`.
- **Architectural Omission (Severity: Medium)**: Codebase forensics reveals that `ReconcileRestoredMigrations` is only invoked in `calendar_test.go:828`. It is **NOT** wired into `services/api/main.go` on application startup, nor is it registered with `startJanitor()` in `services/api/janitor.go`. Stale migrations after a cold restore will NOT be swept proactively on boot.

### 3.7 Plaintext Disposal & Storage Realities
- **Finalization**: When `finalize-migration` executes, `services/api/calendar.go:1232` explicitly executes `SET status='finalized', legacy_payload=NULL`. This removes the plaintext from the active staging tuple.
- **Rollback Defect (Severity: Low)**: When `rollback-migration` executes (`services/api/calendar.go:1364`), or when opportunistic rollback runs (`services/api/calendar.go:227`), or when restore reconciliation runs (`services/api/calendar.go:294`), the query restores `calendar_events.encrypted_payload` from `legacy_payload`, but executes:
  ```sql
  UPDATE calendar_event_migrations SET status='rolled_back', rolled_back_at=$1, rollback_reason=$2 WHERE id=$3
  ```
  `legacy_payload` is **NOT** set to `NULL`. Consequently, the legacy plaintext remains indefinitely duplicated in `calendar_event_migrations.legacy_payload`.
- **Physical MVCC and WAL Retention**: In PostgreSQL, setting a column to `NULL` or updating a row marks the old tuple as dead; the physical bytes remain on disk heap pages until reclaimed by `VACUUM` (or `VACUUM FULL`), and remain in Write-Ahead Log (WAL) segments until WAL recycling. True physical eradication requires post-migration vacuuming and WAL rotation.

### 3.8 Webmail Integration & User Flow
In `apps/webmail/src/components/calendar/CalendarView.tsx`:
- Detects legacy plaintext events using `findLegacyCalendarEvents(rawEvents())`.
- Renders an explicit warning banner (`data-testid="calendar-legacy-upgrade-banner"`) indicating the count of unencrypted events.
- Provides an "Upgrade to End-to-End Encryption" button.
- User clicking initiates `handleStartRecovery`:
  - Asserts existence of `mailboxKey`, `mailboxPk`, and `unlockedBoxId === mailboxId`.
  - Sequentially invokes `executeLegacyCalendarEventRecovery`.
  - Tracks and displays progress counter (`current / total`).
  - Reloads events upon completion.
  - No sensitive plaintext, keys, or attendee addresses are logged or exposed to the UI.

### 3.9 Active Database Boundary & Quarantined Legacy Records
The active database `byos` was inspected to confirm that no schema alterations or test records were introduced.

Psql inspection verifying migration 060 is absent from active database:
```
docker exec byos-postgres psql -U byos -d byos -c "\dt calendar_event_migrations"
```
Output:
```
Did not find any relation named "calendar_event_migrations".
```

Psql inspection verifying all 3 legacy records remain intact and quarantined:
```
docker exec byos-postgres psql -U byos -d byos -c "SELECT id, mailbox_id, status, length(encrypted_payload) as payload_len, encode(sha256(encrypted_payload), 'hex') as payload_sha256, updated_at FROM calendar_events ORDER BY created_at ASC;"
```
Output:
```
                  id                  |              mailbox_id              | status | payload_len |                          payload_sha256                          |         updated_at         
--------------------------------------+--------------------------------------+--------+-------------+------------------------------------------------------------------+----------------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | b8b63e6e-21ef-425b-ae84-b0445d0bda50 | active |         188 | a49165a967dbe0a638aaeea865e5e0a2607cf075982290c26f468ef4290550ba | 2026-10-24 07:44:31.954002
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | b8b63e6e-21ef-425b-ae84-b0445d0bda50 | active |         281 | 1c48edf470158700fa5633ae519911b25958d68f6ef9ae2a214faad47d40cf47 | 2026-10-24 07:44:32.062024
 a4196298-d4e1-4921-8b26-0a2d470636f3 | b8b63e6e-21ef-425b-ae84-b0445d0bda50 | active |         281 | 1934146a517682725fe1bf4fb264f50234003aa555fed908bb74575c92e77202 | 2026-10-24 07:44:32.14725
(3 rows)
```

### 3.10 Test Verification & Disposable Execution Output

Execution of the Go calendar integration test suite against the disposable database `byos_recovery_disposable_20261024`:
```
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run "TestCalendar" ./services/api
```
Output:
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:60: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLifecycleAndIsolation (0.57s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:202: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (1.13s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
    calendar_test.go:520: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle
=== RUN   TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload
=== RUN   TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read
=== RUN   TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations
    calendar_test.go:822: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.09s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism (0.10s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement (0.19s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle (0.24s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload (0.13s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read (0.10s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations (0.09s)
PASS
ok  	byos.email/services/api	4.316s
```

Execution of the Webmail TypeScript and cryptographic test suite:
```
npm.cmd --prefix apps/webmail test
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE TESTS: 39 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 15 passed, 0 failed

Running MIME Structure Tests...
MIME STRUCTURE TESTS: 32 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 28 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

Running Calendar Persistence Security Tests (P0 Remediation)...
  ✓ 1. Missing mailbox key prevents event creation
  ✓ 2. Missing mailbox key prevents event updates
  ✓ 3. Locked mailbox causes zero persistence requests
  ✓ 4. WASM encryption failure causes zero persistence requests
  ✓ 5. No Base64/plaintext fallback exists in the persistence path
  ✓ 6. Successful encryption persists the encrypted envelope
  ✓ 7. Wrong mailbox key cannot decrypt another mailbox's event
  ✓ 8. Tampered ciphertext fails closed
  ✓ 9. Existing valid encrypted events remain readable
  ✓ 10. Existing legacy records are identified without being silently modified
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

Running Calendar Recovery Tests...
  ✓ validateMailboxKeyProvenance: authentic key and matching pk succeeds
  ✓ validateMailboxKeyProvenance: mailbox id mismatch rejects provenance
  ✓ validateMailboxKeyProvenance: wrong public key fails mathematical pairing
  ✓ validateMailboxKeyProvenance: invalid key length fails closed
  ✓ validateMailboxKeyProvenance: missing key or pk fails closed
  ✓ findLegacyCalendarEvents: separates legacy plaintext JSON from encrypted envelopes
  ✓ executeLegacyCalendarEventRecovery: successful 4-phase recoverable workflow
  ✓ executeLegacyCalendarEventRecovery: read-back verification mismatch triggers rollback
  ✓ executeLegacyCalendarEventRecovery: read-back decryption failure triggers rollback
  ✓ executeLegacyCalendarEventRecovery: stage 412 Precondition Failed aborts cleanly without rollback
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

OVERALL: 356 passed, 0 failed
```

---

## 4. Missing Tests & Uncovered Scenarios

The audit identified the following test gaps in the current test suites:

1. **Intra-Organization Multi-User Isolation**:
   - `TestCalendarLifecycleAndIsolation` in `calendar_test.go:60` tests isolation between User A (Org A) and User B (Org B).
   - No test verifies isolation between User A and User B within the **same** organization (`Org A`). As demonstrated in Section 3.2, `resolveDraftMailbox` permits cross-mailbox access within the same organization.
2. **Concurrent Event Update During Migration**:
   - No test exercises a concurrent `PATCH` or `PUT` request arriving while a staged migration is pending, exposing the lack of row-level locking noted in Section 3.5.
3. **Rollback Plaintext Erasure**:
   - No test asserts whether `legacy_payload` is nulled in `calendar_event_migrations` upon rollback. Section 3.7 proves it remains in the table.
4. **Post-Restore Boot Sweeper Automation**:
   - No integration test verifies that `ReconcileRestoredMigrations` is executed on server startup, because the hook does not exist.
5. **Event Deletion Post-Finalization**:
   - No test asserts that a user can delete an event after it has been finalized. Due to the unconditional `ON DELETE RESTRICT` constraint on `calendar_event_migrations.event_id`, deleting a finalized event triggers an unhandled foreign key error.

---

## 5. Contradictions Between Implementation Report and Actual Code

| Feature / Claim | Claim in Implementation Report (`docs/...`) | Actual Implementation in Codebase |
|:---|:---|:---|
| **Disaster Recovery Automation** | "Disaster reconciliation mechanism implemented for restored databases: `ReconcileRestoredMigrations(ctx, conn)`" | The function exists in `calendar.go`, but is never invoked by `main.go`, `janitor.go`, or any boot routine. It is completely orphaned. |
| **Total Plaintext Disposal** | "Zero plaintext retained in database post-recovery" | While finalization nulls `legacy_payload`, rollback operations leave the legacy plaintext permanently populated in `calendar_event_migrations.legacy_payload`. |
| **Mailbox Ownership Enforcement** | "Strict tenant and mailbox isolation enforced across all endpoints" | `resolveDraftMailbox` only enforces organization isolation (`userOrgID == mailboxOrgID`). It does not check `mailboxes.user_id == userID`. |
| **Post-Migration Event Lifecycle** | "Foreign keys enforce ON DELETE RESTRICT on active staged migrations" | The foreign key constraint is table-level, not conditional on `status = 'staged'`. Consequently, finalized events can never be deleted via `DELETE /v1/.../calendar-events/{id}`. |

---

## 6. Prioritized Remediation Recommendations

### Priority 1: Mandatory Security Remediations (Blockers for Production Execution)
1. **Enforce Intra-Organization Mailbox Ownership**:
   Modify `resolveDraftMailbox` in `services/api/drafts.go` (or add a dedicated validator in `calendar.go`) to assert user ownership:
   ```go
   var mailboxUserID *string
   var mode string
   err = conn.QueryRow(ctx, `SELECT org_id::text, user_id::text, mode FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID, &mailboxUserID, &mode)
   if err != nil {
       http.Error(w, "mailbox not found", http.StatusNotFound)
       return
   }
   if mailboxOrgID != userOrgID || (mode == "private" && (mailboxUserID == nil || *mailboxUserID != userID)) {
       http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
       return
   }
   ```
2. **Wire Startup Recovery Reconciliation**:
   Call `ReconcileRestoredMigrations` during server initialization in `services/api/main.go` and add periodic invocation inside `startJanitor()` in `services/api/janitor.go`.

### Priority 2: Data-Safety & Concurrency Hardening
3. **Null Legacy Payload on Rollback**:
   In `calendarEventRollbackMigrationHandler`, `opportunisticallyRecoverExpiredMigration`, and `ReconcileRestoredMigrations`, update the SQL statement to set `legacy_payload = NULL` once the payload has been restored to `calendar_events`:
   ```sql
   UPDATE calendar_event_migrations
   SET status = 'rolled_back', legacy_payload = NULL, rolled_back_at = now(), rollback_reason = $1
   WHERE id = $2
   ```
4. **Lock Calendar Events in Ordinary Updates**:
   Enclose `PATCH`/`PUT` handling in `services/api/calendar.go` within a transaction that begins with:
   ```sql
   SELECT id FROM calendar_events WHERE id = $1 AND mailbox_id = $2 FOR UPDATE
   ```
   This prevents concurrent staging operations from interleaving with standard event modifications.

### Priority 3: Operational Cleanup & Lifecycle Maintenance
5. **Permit Deletion of Finalized Events**:
   Update `060_calendar_event_migrations.sql` foreign key constraint to `ON DELETE CASCADE` or implement a cascading delete handler in the calendar event deletion route so that finalized migration audit records do not permanently block event deletion.
6. **Physical Vacuum and WAL Rotation**:
   Following production migration of the 3 legacy records, run `VACUUM FULL calendar_events; VACUUM FULL calendar_event_migrations;` and trigger WAL archiving rotation to physically reclaim disk pages containing legacy plaintext.

---

## 7. Statement of Untested / Unauthorized Actions

In strict compliance with audit directives:
- **No changes made to database schemas or records**: Migration 060 was NOT applied to the active `byos` database.
- **No live endpoints invoked**: No recovery, stage, finalize, rollback, or status endpoints were executed against the active system or live user accounts.
- **Quarantine maintained**: The 3 legacy plaintext records remain undisturbed in the active database.

### Required Manual Checklist for Eventual Live Execution:
When the Priority 1 and Priority 2 remediations are completed, live execution must proceed strictly as follows:
1. Create a full physical database backup of `byos`.
2. Apply migration `060_calendar_event_migrations.sql` to `byos`.
3. Log in to Webmail as the owner of mailbox `b8b63e6e-21ef-425b-ae84-b0445d0bda50`.
4. Navigate to the Calendar view.
5. Inspect the upgrade banner indicating 3 legacy events detected.
6. Trigger "Upgrade to End-to-End Encryption" and observe the 4-phase recovery workflow.
7. Verify that all 3 events decrypt successfully with client-side AES-GCM.
8. Verify in PostgreSQL that `calendar_event_migrations` shows `status = 'finalized'` and `legacy_payload IS NULL`.
9. Execute `VACUUM FULL calendar_events; VACUUM FULL calendar_event_migrations;`.
