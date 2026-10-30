# BYOS Calendar Recovery: Security and Data-Integrity Remediation Report

## 1. Executive Summary & Remediation Overview

This report documents the implementation and verification of the security, concurrency, and data-integrity remediations mandated by the independent audit report (`docs/calendar_legacy_recovery_independent_implementation_audit.md`).

All remediations were designed, implemented, and evaluated in accordance with the strict operational boundaries specified in the task contract:
- The active development/production database (`byos`) remained strictly untouched: migration `060` was not applied, no recovery/migration endpoints were invoked against it, and all three active legacy calendar records remain undisturbed.
- All integration testing was executed exclusively against the dedicated disposable database `byos_recovery_disposable_20261024`.
- Zero changes were made to unrelated authentication, mailbox, draft, or cryptographic logic.

### Core Remediations Implemented:
1. **Strict Mailbox-Owner Authorization**: Created a dedicated `resolveCalendarMailboxOwner` helper enforcing that the authenticated actor's `userID` directly matches `mailboxes.user_id` in addition to organization boundary matching. Applied consistently across all 6 calendar endpoints. Organization administrators and peer employees within the same organization are strictly forbidden from accessing or manipulating a user's calendar.
2. **Real API Lifecycle Expiration Recovery**: Connected `RunStartupMigrationReconciliation` to API boot in `main.go` prior to serving traffic, wired a dedicated `StartCalendarExpirationWorker` running on a bounded 60-second ticker with clean context shutdown, and added periodic reconciliation to `janitor.go`.
3. **Inconsistent / Ambiguous Backup Reconciliation Safeguard**: Updated `ReconcileRestoredMigrations` to compare current event payload against `staged_payload` and `legacy_payload`. If an inconsistent state is detected, both copies are preserved without overwriting `calendar_events`, and the migration is flagged with `rollback_reason = 'ambiguous_inconsistent_state_requires_manual_review'`.
4. **Duplicate Plaintext Elimination on Rollback**: Atomically updated all rollback paths (`calendarEventRollbackMigrationHandler`, opportunistic expiry, finalize race rollback, and restore reconciliation) to execute `SET status='rolled_back', legacy_payload=NULL` once `calendar_events` has been restored byte-for-byte.
5. **Ordinary Event Update & Deletion Concurrency**: Refactored `calendarEventsHandler` (`PATCH`, `PUT`, `DELETE`) to enforce canonical hierarchical locking: begin transaction, acquire exclusive lock on parent `calendar_events` first (`SELECT ... FOR UPDATE`), inspect child `calendar_event_migrations` second, reject concurrent writes with `409 Conflict` if an active staged migration exists, and preserve strong ETags.
6. **Terminal Migration Deletion Invariant**: In event and calendar deletion handlers, active staged migrations are strictly protected from deletion (returning `409 Conflict`), while terminal migration records (`finalized`, `rolled_back`) are cleaned up transactionally before parent records are removed, allowing normal user deletion without violating foreign key constraints. In `mailboxes.go`, `deleteMailbox` checks and blocks mailbox deletion if active staged migrations exist.
7. **Strong ETag Collision Resistance**: Updated `computeCalendarEventETag` to serialize `nil` `rrule` as `"<null>"` versus empty string `""`, enforce strict UTC timestamps (`.UTC().Format(time.RFC3339Nano)`), and asserted field sensitivity independently across all 10 mutable fields.

---

## 2. Remediated Findings Matrix

| Finding | Remediation Status | Enforcement Mechanism |
|:---|:---:|:---|
| **Cross-user mailbox access** | Remediated | Dedicated `resolveCalendarMailboxOwner` asserts `mailboxes.user_id == userID` across all 6 calendar endpoints. Peer users and org admins rejected with 403. |
| **Orphaned reconciliation function** | Remediated | Wired into `services/api/main.go` startup, 60s background ticker worker with clean shutdown, and `services/api/janitor.go`. |
| **Duplicate plaintext after rollback** | Remediated | `calendar_event_migrations.legacy_payload` is set to `NULL` in the same transaction after restoring `calendar_events.encrypted_payload`. |
| **Ordinary update concurrency race** | Remediated | `PATCH`/`PUT`/`DELETE` wrapped in transactions with canonical `SELECT ... FOR UPDATE` on parent event before inspecting migrations. |
| **Terminal migration deletion restriction** | Remediated | Transactional deletion of terminal records (`finalized`, `rolled_back`) unlocks parent event and calendar deletion while preserving staged records. |
| **ETag field sensitivity** | Validated | Demonstrated field-by-field uniqueness, `nil` vs empty string differentiation, and timezone-offset independence. |
| **Recovery key provenance** | Validated | Authenticated password-unlock derivation, active custody assertion (`unlockedBoxId == mailboxId`), and X25519 HPKE seal/open challenge validated. |
| **Browser integration** | UNTESTED | Automated Go and Webmail unit/integration tests passed; interactive browser workflow remains untested in this headless session. |

---

## 3. Exact Source Files and Functions Modified

| File | Functions Changed | Description of Changes |
|:---|:---|:---|
| `services/api/calendar.go` | `computeCalendarEventETag` | Serializes `nil` `rrule` as `"<null>"` to distinguish from empty string; formats all timestamps with `.UTC().Format(time.RFC3339Nano)`. |
| `services/api/calendar.go` | `opportunisticallyRecoverExpiredMigration` | Clears `legacy_payload = NULL` atomically upon rolling back expired staged migrations. |
| `services/api/calendar.go` | `ReconcileRestoredMigrations` | Compares current payload against staged and legacy payloads; restores legacy payload and nulls migration copy on match; preserves both copies on ambiguous state. |
| `services/api/calendar.go` | `RunStartupMigrationReconciliation` | New exported function executed on API boot; checks if table exists and sweeps expired migrations safely. |
| `services/api/calendar.go` | `StartCalendarExpirationWorker` | New exported background worker running on 60-second ticker with clean context cancellation. |
| `services/api/calendar.go` | `runCalendarExpirationSweep` | Helper executing periodic expiration sweep. |
| `services/api/calendar.go` | `resolveCalendarMailboxOwner` | New authentication helper enforcing `mailboxOrgID == userOrgID && mailboxUserID != nil && *mailboxUserID == userID`. |
| `services/api/calendar.go` | `calendarsHandler` | Uses `resolveCalendarMailboxOwner`; locks events and migrations on DELETE; rejects active staged migrations; cleans up terminal records. |
| `services/api/calendar.go` | `calendarEventsHandler` | Uses `resolveCalendarMailboxOwner`; encloses `PATCH`/`PUT`/`DELETE` in transactions with canonical row-level locks on parent event first; cleans up terminal migration records on DELETE. |
| `services/api/calendar.go` | `calendarEventStageMigrationHandler` | Uses `resolveCalendarMailboxOwner`; nulls `legacy_payload` on inline expired rollback. |
| `services/api/calendar.go` | `calendarEventFinalizeMigrationHandler` | Uses `resolveCalendarMailboxOwner`; nulls `legacy_payload` on inline expired rollback race. |
| `services/api/calendar.go` | `calendarEventRollbackMigrationHandler` | Uses `resolveCalendarMailboxOwner`; clears `legacy_payload = NULL` atomically on rollback. |
| `services/api/calendar.go` | `calendarEventMigrationStatusHandler` | Uses `resolveCalendarMailboxOwner`; asserts event existence before reporting status. |
| `services/api/main.go` | `main()` | Invokes `RunStartupMigrationReconciliation` on startup; starts `StartCalendarExpirationWorker` with process lifetime context. |
| `services/api/janitor.go` | `runJanitorPurge` | Periodically invokes `ReconcileRestoredMigrations` if `calendar_event_migrations` table exists. |
| `services/api/mailboxes.go` | `deleteMailbox` | Rejects mailbox deletion if active staged calendar event migrations exist. |
| `services/api/calendar_test.go` | Test suites | Added 6 new test suites: `TestCalendarMailboxOwnerAuthorization`, `TestCalendarRecoveryPlaintextCleanupAndRollbackSafety`, `TestCalendarRecoveryConcurrencyAndLockOrdering`, `TestCalendarTerminalMigrationDeletionBehavior`, `TestCalendarLifecycleWorkerAndStartupReconciliation`, `TestCalendarETagFieldSensitivityAndDeterminism`. |

---

## 4. Key Provenance and Cryptographic Boundary Analysis

In accordance with Section 8 of the remediation specification, the key provenance assertion in `validateMailboxKeyProvenance` (`apps/webmail/src/calendar_recovery.ts:66-131`) was reviewed:
- **Custody Assertion**: The client verifies that `activeUnlockedBoxId === mailboxId`. The candidate 32-byte secret key originates strictly from the authenticated password-unlock, passkey, or recovery-phrase flow that unwrapped `mailbox_sk_wrapped`.
- **Mathematical Relationship Challenge**: Uses WASM X25519 HPKE seal/open:
  - Generates 32-byte cryptographically secure random probe.
  - Seals probe with `wasm.wasm_hpke_seal(mailboxPkHex, probeHex, aadHex)`.
  - Opens ciphertext with `wasm.wasm_hpke_open(candidateKeyHex, sealedHex, aadHex)`.
  - Verifies exact plaintext probe recovery.
- **What this proves**: Proves that the candidate key held in browser memory is the exact mathematical private key corresponding to `mailbox_pk`.
- **What this does not prove**: Does not establish that `mailbox_pk` itself was not tampered with on the server. However, because the candidate key was unwrapped from `mailbox_sk_wrapped` (which is authenticated via PBKDF2/Argon2 + AES-GCM wrapping), and because client-side read-back verification deciphers and verifies the restored event content byte-for-byte, an invalid or swapped key will fail closed during read-back.

---

## 5. Raw Empirical Evidence

### 5.1 Active Production Database Quarantine
Inspection confirming migration `060` is unapplied to `byos`:
```
docker exec byos-postgres psql -U byos -d byos -c "\dt calendar_event_migrations"
```
Output:
```
Did not find any relation named "calendar_event_migrations".
```

Inspection confirming all 3 legacy records in active `byos` remain intact and unmutated:
```
docker exec byos-postgres psql -U byos -d byos -c "SELECT id, mailbox_id, status, length(encrypted_payload) as payload_len, encode(sha256(encrypted_payload), 'hex') as payload_sha256, updated_at FROM calendar_events ORDER BY created_at ASC;"
```
Output:
```
                  id                  |              mailbox_id              | status | payload_len |                          payload_sha256                          |          updated_at           
--------------------------------------+--------------------------------------+--------+-------------+------------------------------------------------------------------+-------------------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | c0000000-0000-0000-0000-000000000001 | busy   |         188 | a49165a967dbe0a638aaeea865e5e0a2607cf075982290c26f468ef4290550ba | 2026-10-20 08:23:53.880289+00
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | c0000000-0000-0000-0000-000000000001 | busy   |         281 | 1c48edf470158700fa5633ae519911b25958d68f6ef9ae2a214faad47d40cf47 | 2026-10-20 09:18:50.034662+00
 a4196298-d4e1-4921-8b26-0a2d470636f3 | c0000000-0000-0000-0000-000000000001 | busy   |         281 | 1934146a517682725fe1bf4fb264f50234003aa555fed908bb74575c92e77202 | 2026-10-20 09:21:30.891065+00
(3 rows)
```

### 5.2 Go Calendar Integration Test Suite Output
Command executed against disposable test database `byos_recovery_disposable_20261024`:
```
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run "TestCalendar" ./services/api
```
Execution status:
PASS
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:60: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLifecycleAndIsolation (0.59s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:202: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (1.02s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
    calendar_test.go:520: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle
=== RUN   TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload
=== RUN   TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read
=== RUN   TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations
    calendar_test.go:822: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism (0.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement (0.20s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle (0.26s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload (0.13s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read (0.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations (0.10s)
=== RUN   TestCalendarMailboxOwnerAuthorization
    calendar_test.go:846: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations
=== RUN   TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar
=== RUN   TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations
=== RUN   TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries
--- PASS: TestCalendarMailboxOwnerAuthorization (1.02s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations (0.19s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar (0.14s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations (0.05s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries (0.16s)
=== RUN   TestCalendarRecoveryPlaintextCleanupAndRollbackSafety
    calendar_test.go:1039: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryPlaintextCleanupAndRollbackSafety (0.55s)
=== RUN   TestCalendarRecoveryConcurrencyAndLockOrdering
    calendar_test.go:1157: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryConcurrencyAndLockOrdering (0.43s)
=== RUN   TestCalendarTerminalMigrationDeletionBehavior
    calendar_test.go:1235: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Finalized_event_deletion_succeeds_and_cleans_up_migration_rows
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Rolled_back_event_deletion_succeeds_and_cleans_up_migration_rows
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Calendar_deletion_with_terminal_event_migrations_succeeds
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_blocked_when_staged_migration_is_active
    calendar_test.go:1375: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarTerminalMigrationDeletionBehavior (0.74s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Finalized_event_deletion_succeeds_and_cleans_up_migration_rows (0.14s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Rolled_back_event_deletion_succeeds_and_cleans_up_migration_rows (0.14s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Calendar_deletion_with_terminal_event_migrations_succeeds (0.17s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_blocked_when_staged_migration_is_active (0.09s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation
    calendar_test.go:1389: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1406: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations
2026/10/24 20:09:10 [calendar-recovery] startup reconciliation recovered 1 expired migration(s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review
2026/10/24 20:09:10 [calendar-reconciliation] WARNING: ambiguous event payload for event_id=0b7532b5-f390-4643-b73a-4fedbbef3dce mig_id=c4039a59-094a-48f8-b8a4-4efc5f415df8 - preserved event payload and preserved migration copy for manual review
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly
2026/10/24 20:09:10 [calendar-recovery] expiration worker started (interval 50ms)
2026/10/24 20:09:10 [calendar-recovery] periodic sweep recovered 1 expired migration(s)
2026/10/24 20:09:10 [calendar-recovery] expiration worker shutting down cleanly
--- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation (0.86s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations (0.10s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation (0.12s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review (0.09s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly (0.32s)
=== RUN   TestCalendarETagFieldSensitivityAndDeterminism
--- PASS: TestCalendarETagFieldSensitivityAndDeterminism (0.00s)
PASS
ok  	byos.email/services/api	7.929s
```

### 5.3 Go API Build Verification
Command:
```
go build -v ./services/api
```
Output:
```
byos.email/services/api
```
Exit code: `0`.

### 5.4 Webmail TypeScript Test Suite Output
Command:
```
npm.cmd --prefix apps/webmail test
```
Output:
```
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
Exit code: `0`.

### 5.5 Webmail Production Build Verification
Command:
```
npm.cmd --prefix apps/webmail run build
```
Output:
```
✓ 159 modules transformed.
rendering chunks...
dist/index.html                                  1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-BsGW6e2N.css                 106.86 kB │ gzip:  16.97 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-FrItjgN2.js                  940.54 kB │ gzip: 230.08 kB
✓ built in 3.57s
```
Exit code: `0`.

---

## 6. What Did Not Work or Is Untested

1. **Interactive Browser Integration Workflow**:
   Status: **UNTESTED** in an interactive browser during this task.
   *Reason*: Current session was focused on server-side authorization, concurrency, lifecycle reconciliation, and automated test suite verification.
   *Manual Verification Steps Required*:
   - Launch local API service and Webmail client on `localhost:3000`.
   - Log in through Webmail password unlock flow as the owner of mailbox `b8b63e6e-21ef-425b-ae84-b0445d0bda50`.
   - Navigate to the Calendar view.
   - Confirm the legacy upgrade banner appears displaying `3 legacy unencrypted calendar events detected`.
   - Click "Upgrade to End-to-End Encryption" and observe that progress reaches 3/3 without errors.
   - Confirm all three events render properly in the calendar view and decrypt without fallback.
   - Inspect PostgreSQL database to verify migration rows have `status = 'finalized'` and `legacy_payload IS NULL`.
2. **Production Execution Against Active Database `byos`**:
   Status: **UNTESTED** by design. Migration `060` was intentionally not applied to `byos` in order to preserve existing quarantined legacy records pending final approval.
