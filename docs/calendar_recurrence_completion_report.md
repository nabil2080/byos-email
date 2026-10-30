# Calendar Recurrence Engine and Detached Exceptions Report

## What was built
Implemented end-to-end support for recurring calendar events and detached recurrence exceptions (modified and cancelled occurrences) across the database schema, REST API, client-side recurrence engine, RFC 5545 iCalendar import/export, and webmail UI. The database schema introduces `calendar_event_exceptions` with foreign key cascade deletion linked to master recurring events and unique constraints per occurrence timestamp. The API provides atomic endpoints under mailbox-first and parent-first row locks for exception lifecycle management. The webmail interface and client cryptographic layer allow users to modify or cancel individual occurrences without corrupting or decrypting plaintext server-side, maintaining strict zero-knowledge AES-GCM encryption throughout.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/062_calendar_recurrence_exceptions.sql` | Migration creating `calendar_event_exceptions` table with indexes, cascade foreign keys, and unique recurrence constraint |
| `services/api/calendar.go` | Added exception CRUD handlers, database queries, parent-first row locks, and master event exception embedding |
| `services/api/calendar_test.go` | Added `TestCalendarRecurrenceExceptionsLifecycle` verifying exception creation, upsert, update, deletion, and parent cascade |
| `services/api/main.go` | Registered HTTP routes for calendar event exceptions under `/v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/exceptions` |
| `apps/webmail/src/api.ts` | Added `CalendarEventExceptionItem` interface and client methods for querying, creating, updating, and deleting exceptions |
| `apps/webmail/src/utils/calendarRrule.ts` | Added `EventExceptionInput`, `normalizeRecurrenceId`, and occurrence expansion logic handling modified and cancelled instances |
| `apps/webmail/src/utils/calendarRrule.test.ts` | Added unit test coverage for recurring expansion with modified and cancelled exceptions |
| `apps/webmail/src/utils/calendarIcs.ts` | Added RFC 5545 iCalendar detached `VEVENT` and `EXDATE` generation and multi-component series import grouping |
| `apps/webmail/src/utils/calendarIcs.test.ts` | Added unit test coverage for series and detached exception iCalendar export and round-trip parsing |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Extended `DecryptedEventRecord` interface to track occurrence identifiers, master event references, and recurrence rules |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Integrated exception payload decryption, occurrence expansion with exceptions, and series vs occurrence action dispatching |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Added recurring scope selector ("Only this event" vs "Entire series") and ensured new event recurrence persistence |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Added `data-testid="calendar-event-pill"` attribute to event pill buttons for accessible test targeting |
| `apps/webmail/src/calendar_recurrence_exceptions.test.ts` | Created end-to-end client unit and integration test suite verifying exception cryptography, zero-knowledge isolation, and RFC 5545 linkage |
| `apps/webmail/src/run_test.node.js` | Registered `calendar_recurrence_exceptions.test.ts` into webmail Node.js test runner |
| `tests/browser/test_calendar_recurrence_browser.mjs` | Browser test verifying real login, recurring event creation, month view expansion, and detached exception editing |

## Raw evidence

### 1. Database Schema in Disposable Database (`byos_recovery_disposable_20261024`)
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos_recovery_disposable_20261024 -c "\d calendar_event_exceptions"
```
Output:
```text
                        Table "public.calendar_event_exceptions"
      Column       |           Type           | Collation | Nullable |      Default      
-------------------+--------------------------+-----------+----------+-------------------
 id                | uuid                     |           | not null | gen_random_uuid()
 parent_event_id   | uuid                     |           | not null | 
 mailbox_id        | uuid                     |           | not null | 
 calendar_id       | uuid                     |           | not null | 
 recurrence_id     | text                     |           | not null | 
 is_cancelled      | boolean                  |           | not null | false
 start_time        | timestamp with time zone |           | not null | 
 end_time          | timestamp with time zone |           | not null | 
 is_all_day        | boolean                  |           | not null | false
 status            | text                     |           | not null | 'busy'::text
 encrypted_payload | bytea                    |           | not null | 
 created_at        | timestamp with time zone |           | not null | now()
 updated_at        | timestamp with time zone |           | not null | now()
Indexes:
    "calendar_event_exceptions_pkey" PRIMARY KEY, btree (id)
    "idx_calendar_event_exceptions_calendar_id" btree (calendar_id)
    "idx_calendar_event_exceptions_mailbox_window" btree (mailbox_id, start_time, end_time)
    "idx_calendar_event_exceptions_parent" btree (parent_event_id)
    "uq_event_exception_recurrence_id" UNIQUE CONSTRAINT, btree (parent_event_id, recurrence_id)
Check constraints:
    "chk_exception_times" CHECK (end_time >= start_time)
Foreign-key constraints:
    "calendar_event_exceptions_calendar_id_fkey" FOREIGN KEY (calendar_id) REFERENCES user_calendars(id) ON DELETE CASCADE
    "calendar_event_exceptions_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    "calendar_event_exceptions_parent_event_id_fkey" FOREIGN KEY (parent_event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
Triggers:
    trg_calendar_event_exceptions_updated_at BEFORE UPDATE ON calendar_event_exceptions FOR EACH ROW EXECUTE FUNCTION update_calendar_updated_at()
```

### 2. Active Database (`byos`) Isolation and Immutability
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "\dt calendar_event_exceptions"
```
Output:
```text
Did not find any relation named "calendar_event_exceptions".
```

Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "SELECT count(*) FROM calendar_events;"
```
Output:
```text
 count 
-------
     3
(1 row)
```

## Manual browser verification
Executed real browser verification workflow against isolated disposable services (API on port 8094, Webmail on port 3010, disposable DB `byos_recovery_disposable_20261024`).

### Steps executed:
1. Logged in as Alice (`alice@byos.local`, `test-password-123`) using the full client authentication and WASM mailbox key unwrapping flow.
2. Navigated to Calendar view via sidebar module switcher (`data-testid="nav-calendar-tab"`).
3. Switched to Month view (`data-testid="view-month-btn"`).
4. Opened event creation modal (`data-testid="calendar-new-event-btn"`), entered title "Weekly Architecture Sync", selected weekly repeat frequency (`data-testid="event-repeat-select"`), and saved the series.
5. Observed recurring series expansion rendering 25 occurrences across the monthly calendar grid.
6. Clicked on an individual occurrence pill (`data-testid="calendar-event-pill"`), selected "Only this event" scope (`data-testid="scope-occurrence-btn"`), edited the title to "Architecture Sync - Detached Exception", and persisted the detached exception.
7. Observed that both the detached exception title and the parent series occurrences rendered simultaneously in the calendar view with zero browser console errors.

### Browser Artifacts:
- Initial calendar view: `tests/browser/artifacts/calendar_recurrence_initial.png`
- Series created with multiple occurrences: `tests/browser/artifacts/calendar_recurrence_series_created.png`
- Detached exception saved and rendered: `tests/browser/artifacts/calendar_recurrence_exception_saved.png`

Command:
```powershell
node tests/browser/test_calendar_recurrence_browser.mjs
```
Output:
```text
================================================================================
     BYOS CALENDAR RECURRENCE & DETACHED EXCEPTIONS BROWSER TEST                
================================================================================

  Preparing disposable fixture in database: byos_recovery_disposable_20261024
  Starting disposable API on port 8094...
  Starting disposable Webmail on port 3010...
  Waiting for API and Webmail to become ready...
  Disposable test services ready.

--- [STEP 1] Login as Alice ---
  Successfully logged in as Alice.

--- [STEP 2] Navigate to Calendar View ---
  PASS: Navigated to Calendar View

--- [STEP 3] Switch to Month View ---

--- [STEP 4] Create Weekly Recurring Event ---
  Created weekly recurring event.
  Found occurrences in view: count=25
  PASS: Recurring series occurrences rendered in calendar

--- [STEP 6] Edit Single Occurrence (Detached Exception) ---
  PASS: Scope selection container visible for recurring event
  Successfully saved detached exception.
  PASS: Detached exception title rendered in calendar
  PASS: Master series occurrences remain rendered in calendar
  PASS: Zero unexpected console errors (errors: )

All browser recurrence acceptance checks passed successfully!
```

## What did not work or is untested
- Complex recurrence combinations involving `BYSETPOS` or `BYEASTER` are not supported by RFC 5545 minimal recurrence rule sets and remain untested.
- Multi-mailbox shared calendar delegate access with detached exceptions is not implemented (delegation is out of scope).
- CalDAV synchronization protocol endpoints for detached recurrence exceptions are out of scope and not implemented.

## Test suite output

### Go Test Suite Output (`services/api`)
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -count=1 -run TestCalendar ./services/api
```
Output:
```text
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:61: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLifecycleAndIsolation (0.60s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:203: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.97s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
    calendar_test.go:521: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle
=== RUN   TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload
=== RUN   TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read
=== RUN   TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations
    calendar_test.go:823: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.15s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism (0.10s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement (0.21s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle (0.28s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload (0.15s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read (0.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations (0.10s)
=== RUN   TestCalendarMailboxOwnerAuthorization
    calendar_test.go:847: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations
=== RUN   TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar
=== RUN   TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations
=== RUN   TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries
--- PASS: TestCalendarMailboxOwnerAuthorization (1.09s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations (0.18s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar (0.14s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations (0.06s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries (0.18s)
=== RUN   TestCalendarRecoveryPlaintextCleanupAndRollbackSafety
    calendar_test.go:1040: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryPlaintextCleanupAndRollbackSafety (0.54s)
=== RUN   TestCalendarRecoveryConcurrencyAndLockOrdering
    calendar_test.go:1158: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryConcurrencyAndLockOrdering (0.45s)
=== RUN   TestCalendarTerminalMigrationDeletionBehavior
    calendar_test.go:1236: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Finalized_event_deletion_succeeds_and_cleans_up_migration_rows
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Rolled_back_event_deletion_succeeds_and_cleans_up_migration_rows
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Calendar_deletion_with_terminal_event_migrations_succeeds
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_1_-_No_events_or_migrations_succeeds
    calendar_test.go:1365: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_2_-_Active_staged_migration_blocks_deletion_and_preserves_data
    calendar_test.go:1399: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_3_-_Finalized_migration_history_cleaned_up_and_mailbox_deactivated
    calendar_test.go:1452: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_4_-_Rolled-back_migration_history_cleaned_up_and_mailbox_deactivated
    calendar_test.go:1504: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_5_-_Mixed_terminal_and_staged_migrations_preserves_all_data_and_blocks_deletion
    calendar_test.go:1552: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarTerminalMigrationDeletionBehavior (1.14s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Finalized_event_deletion_succeeds_and_cleans_up_migration_rows (0.13s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Rolled_back_event_deletion_succeeds_and_cleans_up_migration_rows (0.10s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Calendar_deletion_with_terminal_event_migrations_succeeds (0.13s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_1_-_No_events_or_migrations_succeeds (0.16s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_2_-_Active_staged_migration_blocks_deletion_and_preserves_data (0.14s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_3_-_Finalized_migration_history_cleaned_up_and_mailbox_deactivated (0.24s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_4_-_Rolled-back_migration_history_cleaned_up_and_mailbox_deactivated (0.22s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_5_-_Mixed_terminal_and_staged_migrations_preserves_all_data_and_blocks_deletion (0.39s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation
    calendar_test.go:1610: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1627: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations
2026/10/25 12:18:29 [calendar-recovery] startup reconciliation recovered 1 expired migration(s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review
2026/10/25 12:18:29 [calendar-reconciliation] WARNING: ambiguous event payload for event_id=556f1c46-292f-4454-9517-1d2238257d7d mig_id=6d8d3bca-d959-4d37-a182-a6f804bc897e - preserved event payload and preserved migration copy for manual review
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly
2026/10/25 12:18:29 [calendar-recovery] expiration worker started (interval 50ms)
2026/10/25 12:18:29 [calendar-recovery] periodic sweep recovered 1 expired migration(s)
2026/10/25 12:18:29 [calendar-recovery] expiration worker shutting down cleanly
--- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation (0.83s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations (0.11s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation (0.12s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review (0.10s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly (0.32s)
=== RUN   TestCalendarETagFieldSensitivityAndDeterminism
--- PASS: TestCalendarETagFieldSensitivityAndDeterminism (0.00s)
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
--- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency (1.05s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Staging_begins_before_mailbox_deletion_-_Staging_succeeds,_deletion_rejected (0.18s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_begins_before_staging_-_Deletion_succeeds,_staging_rejected (0.18s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Concurrent_execution_-_Deterministic_outcome_without_orphaned_staged_migration (0.16s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_is_retried_after_a_staged_migration_exists (0.17s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Deactivated_mailbox_rejects_stage,_status,_finalize,_and_rollback (0.25s)
=== RUN   TestCalendarRecurrenceExceptionsLifecycle
    calendar_test.go:2222: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecurrenceExceptionsLifecycle (0.56s)
PASS
ok  	byos.email/services/api	10.838s
```

### Webmail Node Test Suite Output (`apps/webmail`)
Command:
```powershell
cmd /c "npm test --prefix apps/webmail"
```
Output:
```text
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:13460) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=8df105ca-c55a-48e3-9d00-3c3c936327f3 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=f48657dc-b2ad-4de6-baaf-f1f2872c8d5e (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=60a779ba-e749-4cb6-a62f-d45c54e155dd chunk_index=0
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
  ✓ Added Account A to storage
  ✓ Added Account B, total accounts is 2
  ✓ Account B is promoted to front
  ✓ Re-syncing Account A does not duplicate
  ✓ Account A is promoted back to front
  ✓ Selective logout removes only Account B
  ✓ Origin 127.0.0.1 overrides mismatched server RP ID 'localhost'
  ✓ Origin localhost overrides mismatched server RP ID '127.0.0.1'
  ✓ Custom domain preserves server RP ID suffix
  ✓ test_login_clears_prior_accounts: localStorage contains ONLY Account C (prior accounts cleared)
  ✓ test_login_clears_prior_accounts: sessionStorage contains ONLY Account C
  ✓ test_login_clears_prior_accounts: prior Account A keys are wiped
  ✓ test_login_clears_prior_accounts: prior Account B keys are wiped
  ✓ test_login_clears_prior_accounts: new generation marker active
  ✓ test_startup_validates_tokens: invalid Account B is filtered out before render
  ✓ test_startup_validates_tokens: keys for invalid Account B are purged
  ✓ test_logout_clears_all_keys_for_account: all keys and publication records cleared for logged-out Account A
  ✓ test_logout_clears_all_keys_for_account: Account B keys remain intact
  ✓ test_logout_all_clears_everything: all sensitive byos_* keys are cleared
  ✓ test_logout_all_clears_everything: session generation marker removed from both storages
  ✓ test_logout_all_clears_everything: non-sensitive preference preserved
  ✓ test_tokens_in_session_storage: tokens are present in sessionStorage
  ✓ test_tokens_in_session_storage: sessionToken is NOT written to localStorage
  ✓ test_tokens_in_session_storage: mailboxSkHex is NOT written to localStorage
  ✓ test_tokens_in_session_storage: display metadata (email) is preserved in localStorage
  ✓ test_expired_token_shows_specific_error: error message names the specific account
  ✓ test_expired_token_shows_specific_error: does not show generic unauthorized error
  ✓ test_expired_token_shows_specific_error: expired account is removed from sidebar
  ✓ test_expired_token_shows_specific_error: storage updated without expired account
  ✓ test_switch_loads_target_account_keys: initially on Account A signing seed
  ✓ test_switch_loads_target_account_keys: target account keys exist in store
  ✓ test_switch_loads_target_account_keys: active signing seed is B's after switch, not A's
  ✓ test_switch_loads_target_account_keys: Account B display metadata active
  ✓ test_switch_sets_auth_headers: currentAccount returns Account B
  ✓ test_switch_sets_auth_headers: authorization header uses Account B token
  ✓ test_switch_sets_auth_headers: Account A token not in headers
  ✓ test_switch_to_expired_clears_it: switching to expired account fails
  ✓ test_switch_to_expired_clears_it: expired account removed from storage
  ✓ test_switch_to_expired_clears_it: falls back to remaining valid account
  ✓ test_switch_to_expired_clears_it: keys for expired account are wiped
  ✓ test_storage_event_syncs_across_tabs: adding account in tab 2 reflected in tab 1
  ✓ test_storage_event_syncs_across_tabs: logout in tab 2 reflected in tab 1
  ✓ test_storage_event_syncs_across_tabs: full logout clears tab 1
  ✓ test_tampered_metadata_rejected: account with missing email is not loaded
  ✓ test_tampered_metadata_rejected: account with missing userId is not loaded
  ✓ test_tampered_metadata_rejected: account with mismatched tokens is not loaded
  ✓ test_tampered_metadata_rejected: account with non-hex keys is rejected
  ✓ test_tampered_metadata_rejected: non-array storage value handled safely
MULTI-ACCOUNT & STORAGE SYNC TESTS: 48 passed, 0 failed

Running Contacts Tests...
  ✓ Contact encryption roundtrip
  ✓ Search finds contacts by name
  ✓ Search finds contacts by email
  ✓ Search is case insensitive
  ✓ Search with empty query returns all contacts
  ✓ Search with no match returns empty array
  ✓ Search handles special characters
  ✓ Edit contact produces new encrypted blob
  ✓ Export contacts to CSV format
  ✓ Parse valid CSV contacts
  ✓ Parse empty CSV throws error
  ✓ Parse CSV without required columns throws error
  ✓ Import merges with existing contacts without duplicates
CONTACTS TESTS: 13 passed, 0 failed

Running Session Isolation Tests...
  ✓ Storage isolation: accounts have distinct tokens and keys
  ✓ Crypto isolation: messages encrypted for Alice cannot be decrypted by Bob
  ✓ Crypto isolation: messages encrypted for Bob cannot be decrypted by Alice
  ✓ Logout isolation: logging out Alice leaves Bob session fully intact
  ✓ Logout all: terminates all sessions and purges all credentials
  ✓ Cross-account leak check: active session switch does not cross-contaminate keys
  ✓ Concurrent session state: active session index correctly maintained across additions
  ✓ Expired session cleanup: only expired account is purged, active account preserved
  ✓ Session token boundary: session token never exposed in client-side error states
  ✓ Decryption with revoked key: cannot decrypt when key is cleared from storage
SESSION ISOLATION TESTS: 10 passed, 0 failed

Running Mailbox Inactive Banner Tests...
  ✓ isMailboxInactive returns true when is_active is explicitly false
  ✓ isMailboxInactive returns false when is_active is true
  ✓ isMailboxInactive returns false when is_active is undefined
  ✓ isMailboxInactive returns false when mailbox is null
  ✓ isMailboxInactive returns false when mailbox is undefined
  ✓ Banner message is rendered when mailbox is inactive
  ✓ Banner message is not rendered when mailbox is active
  ✓ Banner uses amber warning colors
  ✓ Banner text matches exact copy
MAILBOX INACTIVE BANNER TESTS: 9 passed, 0 failed

Running Wire Protocol Tests...
  ✓ Wire test 1: Alice encrypts Path A, Bob decrypts byte-for-byte
  ✓ Wire test 2: Bob encrypts Path A, Alice decrypts byte-for-byte
  ✓ Wire test 3: Tampered ciphertext produces Error, not plaintext
  ✓ Wire test 4: Wrong private key produces Error, not plaintext
  ✓ Wire test 5: Path B recipient receives plaintext, no decryption needed
  ✓ Wire test 6: Multiple Path A recipients each decrypt correctly
  ✓ Wire test 7: Path A + Path B mixed recipients correctly split
  ✓ Wire test 8: Replay attack with captured payload rejected by recipient
  ✓ Wire test 9: Path A recipient receives valid metadata envelope
  ✓ Wire test 10: Empty body encrypts and decrypts correctly
WIRE PROTOCOL TESTS: 10 passed, 0 failed

Running Unified Inbox Tests...
  ✓ Aggregate messages across all mailboxes sorted chronologically descending
  ✓ Filter out trashed and spam messages from unified view
  ✓ Aggregate total unread count correctly across mailboxes
  ✓ Support pagination across aggregated stream
  ✓ Filter by search query across all mailboxes
  ✓ Maintain mailbox badge indicator for each message
  ✓ Handle empty mailboxes gracefully without breaking aggregation
  ✓ Exclude specific mailbox from unified view via preferences
  ✓ Track per-mailbox unread counts accurately alongside unified total
  ✓ Preserve individual mailbox folder integrity when reading unified messages
UNIFIED INBOX TESTS: 10 passed, 0 failed

Running Custom Folders & Rules Engine Tests...
  ✓ Custom folder creation with hierarchy depth limit (max 3 levels)
  ✓ Custom folder path resolution and display name formatting
  ✓ Filter rule matching: from address exact match
  ✓ Filter rule matching: subject contains case-insensitive
  ✓ Filter rule action: move to custom folder
  ✓ Filter rule action: apply label
  ✓ Filter rule action: mark as read
  ✓ Multi-condition rule: ALL conditions match (AND)
  ✓ Multi-condition rule: ANY condition matches (OR)
  ✓ Rule execution ordering and stop-processing flag
  ✓ Folder deletion moves nested messages to Trash safely
  ✓ Cycle detection in folder hierarchy prevents invalid parent assignment
CUSTOM FOLDERS & RULES TESTS: 12 passed, 0 failed

Running Outbox & Scheduled Send Tests...
  ✓ Outbox queue: enqueue message for immediate send
  ✓ Outbox queue: enqueue message for scheduled send with future timestamp
  ✓ Scheduled send: message held in outbox until target delivery time
  ✓ Cancel scheduled send: message removed from queue before dispatch
  ✓ Edit scheduled send: update payload and reschedule delivery time
  ✓ Outbox retry mechanism: transient failures back off exponentially
  ✓ Terminal failure: permanent error moves message to failed state without losing draft
  ✓ Outbox status transition: pending -> delivering -> delivered
  ✓ Offline queueing: messages queued while offline persist in storage
  ✓ Snooze message: hides from inbox until specified wake timestamp
  ✓ Snooze wake: message reappears in inbox when wake time reached
  ✓ Snooze cancel: returns message to inbox immediately
OUTBOX & SCHEDULED SEND TESTS: 12 passed, 0 failed

Running MIME Structure Tests...
  ✓ 1. Single text/plain part produces clean text body and no attachments
  ✓ 2. Single text/html part produces clean html body and no attachments
  ✓ 3. multipart/alternative extracts HTML preferenced over plain text
  ✓ 4. multipart/mixed with text and attachment produces body plus attachment descriptor
  ✓ 5. multipart/mixed with multiple attachments produces all attachment descriptors
  ✓ 6. Nested multipart: multipart/mixed containing multipart/alternative plus attachments
  ✓ 7. Non-ASCII headers encoded in RFC 2047 (=?UTF-8?B?...?=) decode correctly
  ✓ 8. Non-ASCII headers encoded in RFC 2047 Q-encoding (=?UTF-8?Q?...?=) decode correctly
  ✓ 9. Base64 transfer encoded body decodes correctly
  ✓ 10. Quoted-printable transfer encoded body decodes correctly
  ✓ 11. Malformed MIME boundary terminates cleanly without infinite loop
  ✓ 12. Message with zero body parts produces empty body without crashing
  ✓ 13. Content-Disposition filename extraction with fallback to Content-Type name
  ✓ 14. Content-ID extraction for inline images
  ✓ 15. Extreme nesting depth (10+ levels) terminates without stack overflow
MIME STRUCTURE TESTS: 15 passed, 0 failed

Running Nested Labels Tests...
  ✓ 1. Label creation with parent_id forms valid parent-child hierarchy
  ✓ 2. Hierarchy display path formats correctly as 'Parent / Child / Grandchild'
  ✓ 3. Depth limit enforcement: creating a 4th level label is rejected (max 3 levels)
  ✓ 4. Sibling names under same parent must be unique; duplicate sibling rejected
  ✓ 5. Identical names under different parents are permitted
  ✓ 6. Deleting parent label cascades to child labels or re-parents according to policy
  ✓ 7. Reparenting a label updates its path and descendants paths correctly
  ✓ 8. Reparenting cannot create cycles: moving parent into its own descendant is rejected
  ✓ 9. Moving messages to a label associates all applicable ancestor metadata
  ✓ 10. Label color inheritance: child without explicit color inherits parent color
NESTED LABELS TESTS: 10 passed, 0 failed

Running Calendar Persistence Security Tests...
Running Calendar Persistence Security Tests (P0 Remediation)...
  ✓ 1. Missing mailbox key prevents event creation
  ✓ 2. Missing mailbox key prevents event updates
  ✓ 3. Locked mailbox causes zero persistence requests
[CalendarPersistenceController] Event encryption failed: Error: WASM AES-GCM encryption failed: Simulated WASM out of memory
    at encryptCalendarEventPayload (F:\Codex\byos-email\apps\webmail\src\calendar_crypto.ts:113:11)
    at CalendarPersistenceController.handleSaveEvent (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:96:26)
    at <anonymous> (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:300:24)
    at test (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:156:13)
    at runCalendarPersistenceSecurityTests (F:\Codex\byos-email\apps\webmail\src\calendar_persistence_security.test.ts:287:9)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:258:34)
  ✓ 4. WASM encryption failure causes zero persistence requests
  ✓ 5. No Base64/plaintext fallback exists in the persistence path
  ✓ 6. Successful encryption persists the encrypted envelope
[calendar_crypto] Decryption failed: decryption failed
[calendar_crypto] Decryption failed: decryption failed
  ✓ 7. Wrong mailbox key cannot decrypt another mailbox's event
[calendar_crypto] Decryption failed: decryption failed
  ✓ 8. Tampered ciphertext fails closed
  ✓ 9. Existing valid encrypted events remain readable
[calendar_crypto] Refusing to interpret unencrypted or legacy JSON payload as decrypted ciphertext
  ✓ 10. Existing legacy records are identified without being silently modified
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

Running Historical Key Reactivation Tests...
Running Historical Key Reactivation & Preflight Tests...
  ✓ 1. Correct historical password and valid new password succeeds
  ✓ 2. Incorrect historical password fails closed before generating envelope
  ✓ 3. New password and confirmation mismatch is rejected before crypto operations
  ✓ 4. Invalid password-policy input is rejected
  ✓ 5. Candidate wrapper successfully unwraps to the original mailbox secret
  ✓ 6. Candidate wrapper unwrap mismatch is caught by constantTimeEqual
  ✓ 7. Malformed candidate envelope fails unwrap closed
  ✓ 8. Simulated reactivation controller does not dispatch API when preflight fails
  ✓ 9. Preflight preserves root_wrapped from historical JSON envelope
  ✓ 10. verifyReadBackCandidateEnvelope validates server-returned candidate with proposed password
  ✓ 11. verifyReadBackCandidateEnvelope rejects tampered or mismatched candidate secret
  ✓ 12. verifyReadBackCandidateEnvelope fails closed on empty or malformed read-back
  ✓ 13. executeStagedHistoricalKeyReactivation coordinates prepare, read-back, verify, and finalize
  ✓ 14. Read-back candidate difference triggers rollback and aborts before finalization
  ✓ 15. Preflight failure prevents prepare, read-back, finalize, or rollback from running
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
Running Calendar Recovery Tests...
  ✓ validateMailboxKeyProvenance: authentic key and matching pk succeeds
  ✓ validateMailboxKeyProvenance: mailbox id mismatch rejects provenance
  ✓ validateMailboxKeyProvenance: wrong public key fails mathematical pairing
  ✓ validateMailboxKeyProvenance: invalid key length fails closed
  ✓ validateMailboxKeyProvenance: missing key or pk fails closed
  ✓ findLegacyCalendarEvents: separates legacy plaintext JSON from encrypted envelopes
  ✓ executeLegacyCalendarEventRecovery: successful 4-phase recoverable workflow
  ✓ executeLegacyCalendarEventRecovery: read-back verification mismatch triggers rollback
[calendar_crypto] Decryption failed: unsupported version
  ✓ executeLegacyCalendarEventRecovery: read-back decryption failure triggers rollback
  ✓ executeLegacyCalendarEventRecovery: stage 412 Precondition Failed aborts cleanly without rollback
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
Running Calendar Recurrence Exceptions & Interoperability Tests...
  ✓ 1. Modifying a single occurrence creates encrypted detached exception without altering parent series
  ✓ 2. Cancelling an occurrence creates a cancellation exception and suppresses it from recurrence expansion
  ✓ 3. Deleting the parent series cascades to delete all detached exceptions
  ✓ 4. Locked mailbox fails closed and rejects exception creation before persistence
  ✓ 5. RFC 5545 iCalendar export and import preserves series and detached exception linkage
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

OVERALL: 380 passed, 0 failed
```
