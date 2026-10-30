# BYOS Calendar Legacy Recovery: Mailbox Deletion vs Migration Staging Concurrency Report

## What was built
A focused concurrency review was conducted on the interaction between mailbox deletion (`deleteMailbox`) and calendar migration staging (`stageCalendarEventMigrationHandler`), revealing a race window where a staging request that passed pre-transaction authorization could commit a new staged migration onto an already deactivated mailbox. To eliminate this window, a strict three-level canonical lock hierarchy was established across all migration transactions: Level 1 locks the root mailbox row (`mailboxes FOR UPDATE`) and re-evaluates active ownership inside the transaction before Level 2 (`calendar_events FOR UPDATE`) and Level 3 (`calendar_event_migrations FOR UPDATE`) locks are acquired. In addition, `resolveCalendarMailboxOwner` was updated to require `is_active=true`, immediately rejecting requests targeting deactivated mailboxes at the HTTP gateway. Five deterministic concurrency integration tests were added to `services/api/calendar_test.go` and asserted against disposable database `byos_recovery_disposable_20261024`, while active database `byos` remained strictly untouched.

## Files edited
| File | Reason |
|------|--------|
| services/api/calendar.go | Added `is_active=true` filter to `resolveCalendarMailboxOwner` and implemented Level 1 root mailbox row locking (`mailboxes FOR UPDATE`) in `stage`, `finalize`, `rollback`, and opportunistic recovery handlers. |
| services/api/calendar_test.go | Added `TestCalendarMailboxDeletionVsMigrationStagingConcurrency` covering all 5 required concurrency scenarios across sequential, interleaved, and parallel execution. |

## Concurrency Analysis: Mailbox Deletion vs Migration Staging

### 1. The Race Window in the Previous Implementation
Prior to this review, the sequence described below was possible:
1. Client A sends a staging request: `POST /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/stage-migration`.
2. `stageCalendarEventMigrationHandler` invokes `resolveCalendarMailboxOwner` outside the database transaction. The query checked `SELECT org_id, user_id FROM mailboxes WHERE id=$1` without checking `is_active=true`.
3. Client B triggers mailbox deletion (`deleteMailbox`), opening transaction `tx_del`.
4. `tx_del` locks the mailbox row: `SELECT ... FROM mailboxes WHERE id=$1 AND org_id=$2 AND is_active=true FOR UPDATE`.
5. `tx_del` queries `calendar_event_migrations WHERE mailbox_id=$1 FOR UPDATE`. Staging has not inserted a record yet, so `tx_del` finds zero active migrations.
6. `tx_del` deactivates the mailbox: `UPDATE mailboxes SET is_active=false, status='suspended' WHERE id=$2` and commits.
7. Client A's staging handler resumes and opens transaction `tx_stage`.
8. `tx_stage` locked `calendar_events WHERE id=$1 AND mailbox_id=$2 FOR UPDATE` and `calendar_event_migrations WHERE event_id=$1 AND status='staged' FOR UPDATE`.
9. `tx_stage` never queried or locked `mailboxes`.
10. `tx_stage` inserted into `calendar_event_migrations`. PostgreSQL foreign key constraint `mailbox_id REFERENCES mailboxes(id)` succeeded because the mailbox row was soft-deleted, not removed.
11. `tx_stage` committed successfully.

**Result**: A deactivated mailbox possessed an active staged migration, violating the core data-safety invariant.

### 2. Forensic Investigation of the Six Invariant Questions
- **Is mailbox ownership checked again inside the staging transaction?**
  Previously: No. Ownership was checked only in `resolveCalendarMailboxOwner` prior to `tx.Begin`.
  Remediated: Yes. The staging transaction now executes `SELECT is_active, user_id::text FROM mailboxes WHERE id=$1 AND org_id=$2 FOR UPDATE` and explicitly asserts `mbOwnerID == userID`.
- **Is mailbox active/deleted state checked?**
  Previously: No. Neither `resolveCalendarMailboxOwner` nor the staging transaction checked `is_active`.
  Remediated: Yes. `resolveCalendarMailboxOwner` enforces `AND is_active=true`, and the staging transaction checks `!mbActive` under the Level 1 row lock.
- **Is the mailbox row protected against concurrent deactivation?**
  Previously: No. The staging transaction locked only `calendar_events` and `calendar_event_migrations`.
  Remediated: Yes. The staging transaction exclusively locks the root `mailboxes` row `FOR UPDATE` before touching child entities.
- **Do staging and deletion use compatible lock ordering?**
  Previously: No. `deleteMailbox` acquired `mailboxes FOR UPDATE` then `calendar_event_migrations FOR UPDATE`. Staging acquired `calendar_events FOR UPDATE` then `calendar_event_migrations FOR UPDATE`, omitting `mailboxes`.
  Remediated: Yes. Both paths now start by acquiring `mailboxes FOR UPDATE` as Level 1.
- **Can a request that began before deletion still commit after deactivation?**
  Previously: Yes.
  Remediated: No. If deletion commits first, the staging transaction unblocks from the Level 1 lock, reads the committed `is_active = false` state, aborts with HTTP 404, and rolls back without writing to `calendar_event_migrations`.
- **Do migration status, finalization, and rollback remain correctly authorized after deactivation?**
  Previously: Because `resolveCalendarMailboxOwner` lacked an `is_active=true` clause, status, finalization, and rollback could execute against deactivated mailboxes.
  Remediated: `resolveCalendarMailboxOwner` rejects any request for an inactive mailbox with HTTP 404, and all handlers (`finalize`, `rollback`, `status`) lock the Level 1 mailbox row to evaluate active state under transaction isolation.

### 3. Canonical Lock Hierarchy Specification
To prevent races and eliminate deadlock risks across all concurrent lifecycle operations:
```
Level 1 (Root):   mailboxes (WHERE id = $1 FOR UPDATE)
Level 2 (Parent): calendar_events / user_calendars (WHERE mailbox_id = $1 FOR UPDATE)
Level 3 (Child):  calendar_event_migrations (WHERE mailbox_id = $1 / event_id = $2 FOR UPDATE)
```

#### Deadlock Freedom Proof
Both `deleteMailbox` and `stageCalendarEventMigrationHandler` require Level 1 (`mailboxes.id = mailboxID`) before acquiring any subsequent locks. Because Level 1 is an exclusive lock on the single target mailbox row, exactly one transaction can hold Level 1 at any moment. The competing transaction is blocked at Level 1 before acquiring any Level 2 or Level 3 locks that the first transaction could wait on. Consequently, circular wait conditions are mathematically impossible.

---

## Required Concurrency Test Suite Results

The 5 required concurrency test scenarios were implemented in `services/api/calendar_test.go` under `TestCalendarMailboxDeletionVsMigrationStagingConcurrency`:

1. **Scenario 1: Staging begins before mailbox deletion**
   Staging completes and commits. `deleteMailbox` is invoked. `deleteMailbox` detects active staging and returns `"cannot delete mailbox with active calendar event migrations in progress"`. The staged migration, legacy payload, and mailbox remain active.
2. **Scenario 2: Mailbox deletion begins before staging**
   `deleteMailbox` completes and commits. Staging request is invoked for an event in the deactivated mailbox. Staging fails with HTTP 404. Zero migration rows are created.
3. **Scenario 3: Both operations execute concurrently**
   Staging and deletion are launched simultaneously on parallel goroutines synchronized with a channel barrier. Evaluated across repeated runs:
   - If staging wins Level 1 lock: staging succeeds (200 OK), deletion fails with error, mailbox remains active, exactly 1 staged migration exists.
   - If deletion wins Level 1 lock: deletion succeeds, staging fails (404 Not Found), mailbox is deactivated, exactly 0 staged migrations exist.
   - Invariant: A deactivated mailbox never receives a staged migration.
4. **Scenario 4: Mailbox deletion is retried after a staged migration exists**
   With an active staged migration present, `deleteMailbox` is called repeatedly (3 successive attempts). All 3 attempts fail with `"cannot delete mailbox with active calendar event migrations in progress"`. Staging state remains intact throughout.
5. **Scenario 5: A deactivated mailbox cannot begin a new migration, check status, finalize, or rollback**
   Mailbox is cleanly deactivated. Sequential calls to `stage`, `migration-status`, `finalize-migration`, and `rollback-migration` all return HTTP 404. Zero migration rows exist.

---

## Raw Evidence

### Active Database Isolation Assertion (Read-Only)
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "\dt calendar_event_migrations"
```
Output:
```
Did not find any relation named "calendar_event_migrations".
```

### Active Legacy Records Quarantined and Untouched
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "SELECT id, status, length(encrypted_payload) as payload_len, starts_with(encode(encrypted_payload, 'hex'), '7b') as is_json FROM calendar_events WHERE id IN ('74b8ea49-47f1-4ed0-abfb-5fc563fbe04f', '6c75afcb-5d70-4f5c-b4ca-41bb010405ec', 'a4196298-d4e1-4921-8b26-0a2d470636f3') ORDER BY id;"
```
Output:
```
                  id                  | status | payload_len | is_json 
--------------------------------------+--------+-------------+---------
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | busy   |         281 | t
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | busy   |         188 | t
 a4196298-d4e1-4921-8b26-0a2d470636f3 | busy   |         281 | t
(3 rows)
```

### Disposable Database Target Verification
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos_recovery_disposable_20261024 -c "\dt calendar_event_migrations"
```
Output:
```
                 List of relations
 Schema |           Name            | Type  | Owner 
--------+---------------------------+-------+-------
 public | calendar_event_migrations | table | byos
(1 row)
```

### Concurrency Test Suite Execution
Command:
```powershell
$env:TEST_DATABASE_URL = "postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run "TestCalendarMailboxDeletionVsMigrationStagingConcurrency" ./services/api
```
Output:
```
=== RUN   TestCalendarMailboxDeletionVsMigrationStagingConcurrency
    calendar_test.go:1905: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Staging_begins_before_mailbox_deletion_-_Staging_succeeds,_deletion_rejected
    calendar_test.go:1939: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_begins_before_staging_-_Deletion_succeeds,_staging_rejected
    calendar_test.go:1979: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Concurrent_execution_-_Deterministic_outcome_without_orphaned_staged_migration
    calendar_test.go:2039: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_is_retried_after_a_staged_migration_exists
    calendar_test.go:2104: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Deactivated_mailbox_rejects_stage,_status,_finalize,_and_rollback
    calendar_test.go:2156: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency (1.02s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Staging_begins_before_mailbox_deletion_-_Staging_succeeds,_deletion_rejected (0.18s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_begins_before_staging_-_Deletion_succeeds,_staging_rejected (0.17s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Concurrent_execution_-_Deterministic_outcome_without_orphaned_staged_migration (0.15s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_is_retried_after_a_staged_migration_exists (0.17s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Deactivated_mailbox_rejects_stage,_status,_finalize,_and_rollback (0.23s)
PASS
ok  	byos.email/services/api	2.552s
```

### Full Calendar Suite Execution
Command:
```powershell
$env:TEST_DATABASE_URL = "postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run "TestCalendar" ./services/api
```
Output:
```
=== RUN   TestCalendarLifecycleAndIsolation
--- PASS: TestCalendarLifecycleAndIsolation (0.52s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.93s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.05s)
=== RUN   TestCalendarMailboxOwnerAuthorization
--- PASS: TestCalendarMailboxOwnerAuthorization (0.94s)
=== RUN   TestCalendarRecoveryPlaintextCleanupAndRollbackSafety
--- PASS: TestCalendarRecoveryPlaintextCleanupAndRollbackSafety (0.43s)
=== RUN   TestCalendarRecoveryConcurrencyAndLockOrdering
--- PASS: TestCalendarRecoveryConcurrencyAndLockOrdering (0.42s)
=== RUN   TestCalendarTerminalMigrationDeletionBehavior
--- PASS: TestCalendarTerminalMigrationDeletionBehavior (1.68s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation
--- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation (0.84s)
=== RUN   TestCalendarETagFieldSensitivityAndDeterminism
--- PASS: TestCalendarETagFieldSensitivityAndDeterminism (0.00s)
=== RUN   TestCalendarMailboxDeletionVsMigrationStagingConcurrency
--- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency (1.04s)
PASS
ok  	byos.email/services/api	9.384s
```

### Webmail Test Suite Output
Command:
```powershell
npm.cmd --prefix apps/webmail test
```
Output:
```
CALENDAR RECOVERY TESTS: 10 passed, 0 failed
OVERALL: 356 passed, 0 failed
```

---

## Manual Browser Verification
Manual UI flows for calendar migration were previously exercised in `test_calendar_browser.mjs`. The concurrency synchronization mechanisms implemented in this task operate within the database transaction and row-locking layers of `services/api`, requiring automated concurrent goroutine testing rather than interactive DOM clicks.

---

## What did not work or is untested
- **Live production migration**: Live execution of recovery against the 3 quarantined records in active database `byos` is explicitly UNTESTED and withheld pending deployment approval.
- **Physical database dropping**: Physical dropping of PostgreSQL clusters was not performed in accordance with database safety rules.
