# BYOS Calendar Legacy Recovery: Final Referential Integrity and ETag Report

## What was built
This milestone resolves the two final integrity and correctness requirements for the BYOS calendar legacy plaintext recovery subsystem: first, referential integrity and foreign key constraints (`ON DELETE RESTRICT`) on `calendar_event_migrations` were reconciled with mailbox deactivation by transactionally cleaning up terminal migration records (`finalized`, `rolled_back`) while strictly blocking deletion and preserving data when an active staged migration exists; second, the ETag derivation mechanism was refactored from magic string sentinels to a typed, length-prefixed canonical framing (`v2|S<len>:...|T<len>:...|B<0|1>|N|H64:...`) that provides mathematical collision resistance across null, empty, and literal sentinel values (`"<null>"`, `"null"`, `"N"`), eliminates delimiter boundary injection, normalizes timestamps to UTC across all 10 mutable event fields, and was asserted against disposable database `byos_recovery_disposable_20261024` with zero impact on active database `byos`.

## Files edited
| File | Reason |
|------|--------|
| services/api/calendar.go | Implemented typed length-prefixed canonical framing for `computeCalendarEventETag` covering all 10 mutable fields with zero delimiter/sentinel ambiguity. |
| services/api/mailboxes.go | Added transactional terminal migration cleanup and active staged migration deletion guard in `deleteMailbox`. |
| services/api/calendar_test.go | Added comprehensive integration tests for 5 mailbox deletion scenarios and unit tests for ETag field sensitivity, delimiter injection, and sentinel collision resistance. |

## Referential Integrity and Foreign Key Analysis

### Schema Constraints in Migration 060
Migration `infra/postgres/init/060_calendar_event_migrations.sql` establishes foreign key constraints on the staging table:
```sql
CREATE TABLE IF NOT EXISTS calendar_event_migrations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           uuid NOT NULL REFERENCES calendar_events(id) ON DELETE RESTRICT,
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE RESTRICT,
    legacy_payload     bytea,
    staged_payload     bytea NOT NULL,
    status             text NOT NULL CHECK (status IN ('staged', 'finalized', 'rolled_back')),
    etag               text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
    finalized_at       timestamptz,
    rolled_back_at     timestamptz,
    rollback_reason    text
);
```
Both `event_id` and `mailbox_id` enforce `ON DELETE RESTRICT`. Under PostgreSQL foreign key semantics, any `DELETE` operation on `mailboxes` or `calendar_events` fails unconditionally if referencing rows exist in `calendar_event_migrations`.

### Mailbox Deactivation Architecture
In `services/api/mailboxes.go`, `deleteMailbox` executes within a database transaction:
1. Inspects `calendar_event_migrations` for the target `mailbox_id` with `FOR UPDATE` row locks.
2. Evaluates migration statuses:
   - **Active Staged (`status = 'staged'`, `now() < expires_at`)**: Aborts the operation immediately with `fmt.Errorf("cannot delete mailbox with active calendar event migrations in progress")`. This triggers transaction rollback, leaving the mailbox, event, and staged migration intact.
   - **Expired Staged (`status = 'staged'`, `now() >= expires_at`)**: Opportunistically rolls back the legacy payload into `calendar_events`, transitions migration status to `rolled_back`, and clears `legacy_payload` to avoid duplicate retention.
   - **Terminal Migrations (`status IN ('finalized', 'rolled_back')`)**: Atomically deletes terminal rows:
     ```sql
     DELETE FROM calendar_event_migrations
     WHERE mailbox_id=$1 AND status IN ('finalized', 'rolled_back')
     ```
3. Proceeding to soft-delete / deactivate the mailbox:
   ```sql
   UPDATE mailboxes 
   SET is_active=false, status='suspended', local_part=$1, updated_at=now() 
   WHERE id=$2
   ```

### Evaluation Across Five Scenarios
1. **Case 1 (No events or migrations)**: `deleteMailbox` queries migrations, finds zero records, and deactivates the mailbox cleanly.
2. **Case 2 (Active staged migration)**: `deleteMailbox` detects active staging, aborts without modifying `mailboxes` or `calendar_events`, rollback executes, and recovery state is preserved.
3. **Case 3 (Finalized migration)**: `deleteMailbox` purges finalized history rows from `calendar_event_migrations`, removes the `ON DELETE RESTRICT` dependency, and deactivates the mailbox without foreign key errors.
4. **Case 4 (Rolled-back migration)**: `deleteMailbox` purges rolled-back history rows, removes the foreign key dependency, and deactivates the mailbox cleanly.
5. **Case 5 (Mixed terminal and staged migrations)**: `deleteMailbox` identifies at least one active staged migration, returns an error before committing, and transaction rollback preserves all staged and terminal records without partial deletion.

---

## Canonical ETag Framing and Collision Resistance

### Eliminating Sentinel Ambiguity
Previous implementations utilized a literal string sentinel `"<null>"` for unset `rrule` pointers. If an event legitimately contained the string `"<null>"` as an recurrence rule, the serialized representation collided with `nil`.

The updated implementation in `services/api/calendar.go` adopts a typed length-prefixed canonical framing:
```
v2|S<len>:<id>|S<len>:<mailbox_id>|S<len>:<calendar_id>|T<len>:<start_time>|T<len>:<end_time>|B<0|1>|<N|S<len>:<rrule>>|S<len>:<status>|H64:<payload_sha256>|T<len>:<updated_at>
```

### Framing Rules
1. **Version Prefix**: `v2` enforces domain separation from prior ETag schemes.
2. **String Fields (`id`, `mailbox_id`, `calendar_id`, `status`)**: Encoded as `|S<len>:<content>`. The explicit byte length prefix eliminates delimiter collisions when values contain `|` or `:`.
3. **Timestamps (`start_time`, `end_time`, `updated_at`)**: Converted to UTC via `t.UTC().Format(time.RFC3339Nano)` and framed as `|T<len>:<utc_string>`. Guarantees timezone independence (Asia/Dhaka, America/New_York, and UTC produce identical representations for the same UTC instant).
4. **Booleans (`is_all_day`)**: Framed as `|B1` (true) or `|B0` (false).
5. **Recurrence Rule (`rrule`)**:
   - `rrule == nil`: Encoded as `|N`.
   - `rrule != nil`: Encoded as `|S<len>:<content>`.
     - Empty string `""` becomes `|S0:`.
     - Literal `"<null>"` becomes `|S6:<null>`.
     - Literal `"null"` becomes `|S4:null`.
     - Literal `"N"` becomes `|S1:N`.
   The `N` token cannot collide with `S<len>:...` due to distinct type discriminators.
6. **Binary Payload**: Encoded as `|H64:<sha256_hex>`, ensuring binary safety and exact byte-level change detection.

---

## Active Database Quarantine and Isolation

The production/active database `byos` remained strictly isolated:
1. Migration `060_calendar_event_migrations.sql` was NOT applied to `byos`.
2. The three active legacy calendar records in `byos` were inspected in read-only mode and remain untouched.
3. All destructive and lifecycle tests were executed against the dedicated disposable database `byos_recovery_disposable_20261024`.

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

### Go Test Suite Execution Against Disposable Database
Command:
```powershell
$env:TEST_DATABASE_URL = "postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run "TestCalendar" ./services/api
```
Output:
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:60: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLifecycleAndIsolation (0.56s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:202: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.97s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
    calendar_test.go:520: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle
=== RUN   TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload
=== RUN   TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read
=== RUN   TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations
    calendar_test.go:822: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.06s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism (0.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement (0.19s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle (0.25s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload (0.13s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read (0.10s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations (0.09s)
=== RUN   TestCalendarMailboxOwnerAuthorization
    calendar_test.go:846: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations
=== RUN   TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar
=== RUN   TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations
=== RUN   TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries
--- PASS: TestCalendarMailboxOwnerAuthorization (0.98s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations (0.19s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar (0.14s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations (0.05s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries (0.15s)
=== RUN   TestCalendarRecoveryPlaintextCleanupAndRollbackSafety
    calendar_test.go:1039: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryPlaintextCleanupAndRollbackSafety (0.45s)
=== RUN   TestCalendarRecoveryConcurrencyAndLockOrdering
    calendar_test.go:1157: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryConcurrencyAndLockOrdering (0.44s)
=== RUN   TestCalendarTerminalMigrationDeletionBehavior
    calendar_test.go:1235: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Finalized_event_deletion_succeeds_and_cleans_up_migration_rows
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Rolled_back_event_deletion_succeeds_and_cleans_up_migration_rows
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Calendar_deletion_with_terminal_event_migrations_succeeds
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_1_-_No_events_or_migrations_succeeds
    calendar_test.go:1364: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_2_-_Active_staged_migration_blocks_deletion_and_preserves_data
    calendar_test.go:1398: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_3_-_Finalized_migration_history_cleaned_up_and_mailbox_deactivated
    calendar_test.go:1451: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_4_-_Rolled-back_migration_history_cleaned_up_and_mailbox_deactivated
    calendar_test.go:1503: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_5_-_Mixed_terminal_and_staged_migrations_preserves_all_data_and_blocks_deletion
    calendar_test.go:1582: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarTerminalMigrationDeletionBehavior (1.71s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Finalized_event_deletion_succeeds_and_cleans_up_migration_rows (0.13s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Rolled_back_event_deletion_succeeds_and_cleans_up_migration_rows (0.13s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Calendar_deletion_with_terminal_event_migrations_succeeds (0.16s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_1_-_No_events_or_migrations_succeeds (0.09s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_2_-_Active_staged_migration_blocks_deletion_and_preserves_data (0.17s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_3_-_Finalized_migration_history_cleaned_up_and_mailbox_deactivated (0.22s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_4_-_Rolled-back_migration_history_cleaned_up_and_mailbox_deactivated (0.21s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_5_-_Mixed_terminal_and_staged_migrations_preserves_all_data_and_blocks_deletion (0.40s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation
    calendar_test.go:1609: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1626: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations
2026/10/24 20:24:09 [calendar-recovery] startup reconciliation recovered 1 expired migration(s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review
2026/10/24 20:24:09 [calendar-reconciliation] WARNING: ambiguous event payload for event_id=12b734f8-e474-43e3-92d3-a4383550001d mig_id=3edc0751-082b-4242-a883-dc12c8c70804 - preserved event payload and preserved migration copy for manual review
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly
2026/10/24 20:24:09 [calendar-recovery] expiration worker started (interval 50ms)
2026/10/24 20:24:09 [calendar-recovery] periodic sweep recovered 1 expired migration(s)
2026/10/24 20:24:09 [calendar-recovery] periodic sweep recovered 1 expired migration(s)
2026/10/24 20:24:09 [calendar-recovery] expiration worker shutting down cleanly
--- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation (0.81s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations (0.10s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation (0.12s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review (0.09s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly (0.32s)
=== RUN   TestCalendarETagFieldSensitivityAndDeterminism
--- PASS: TestCalendarETagFieldSensitivityAndDeterminism (0.00s)
PASS
ok  	byos.email/services/api	8.563s
```

### Webmail Test Suite Output
Command:
```powershell
npm.cmd --prefix apps/webmail test
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:3924) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI ACCOUNT TESTS: 48 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 10 passed, 0 failed

Running Session Recovery Phrase Tests...
SESSION RECOVERY PHRASE TESTS: 7 passed, 0 failed

Running Mime Tests...
MIME TESTS: 24 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 22 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 11 passed, 0 failed

Running Calendar RRule Tests...
CALENDAR RRULE TESTS: 23 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 28 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

Running Calendar Persistence Security Tests...
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

## Manual Browser Verification
Manual browser verification for the calendar migration user interface was conducted previously in `test_calendar_browser.mjs` with screenshots saved in `tests/browser/artifacts/`. The changes evaluated in this review target backend database referential integrity (`deleteMailbox` transaction handling) and cryptographic ETag derivation (`computeCalendarEventETag`), which operate on the API and data layers without altering frontend UI presentation components.

---

## What did not work or is untested
- **Live production migration**: Live execution of the legacy plaintext migration against the 3 quarantined records in active database `byos` is explicitly UNTESTED and withheld pending deployment approval.
- **Physical database destruction**: Testing actual PostgreSQL drop database operations was not performed in accordance with strict database safety boundaries.
