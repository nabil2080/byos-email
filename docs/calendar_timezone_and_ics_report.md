# Calendar Time-Zone and ICS Interoperability Report

## What was built
Implemented comprehensive RFC 5545 iCalendar time-zone support and interoperability across the BYOS calendar system. The system now parses standard and custom `VTIMEZONE` components (extracting `STANDARD` and `DAYLIGHT` transition rules, UTC offsets, and timezone identifiers), converts timezone-qualified date-times (`DTSTART`, `DTEND`, `RECURRENCE-ID`, `EXDATE`) into exact UTC timestamps accounting for seasonal Daylight Saving Time (DST) shifts across Northern and Southern hemispheres, generates compliant RFC 5545 `VTIMEZONE` blocks for exported calendars and invitations, supports floating local time without timezone markers, and guarantees RFC 5545 compliant non-inclusive end date formatting for all-day events.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/utils/calendarIcs.ts` | Added `VTimeZoneDef` model, offset helpers, `convertLocalToUtc`, `formatIcsLocalTime`, `generateVTimeZone`, timezone-aware date parsing, and floating/all-day time serialization |
| `apps/webmail/src/utils/calendarIcs.test.ts` | Added 7 unit and integration tests covering `VTIMEZONE` parsing, DST transitions, custom timezones, floating times, all-day events, and round-trip serialization |
| `apps/webmail/src/utils/calendarRrule.ts` | Extended `normalizeRecurrenceId` to handle local date-time strings without trailing Z |
| `docs/calendar_timezone_and_ics_report.md` | Feature report documenting implementation details, file edits, and raw terminal test evidence |

## Raw evidence

### 1. Calendar ICS and Timezone Test Suite
Command:
```powershell
cmd /c "cd apps\webmail && npx tsx --experimental-wasm-modules -e ""import { runCalendarIcsTests } from './src/utils/calendarIcs.test.ts'; runCalendarIcsTests();"""
```
Output:
```text
Running Calendar ICS & Invitation Tests...
  ✓ unescapeIcsText handles commas, semicolons, backslashes, and newlines
  ✓ escapeIcsText escapes special characters
  ✓ foldIcsLine folds lines > 75 characters
  ✓ parseIcsDate parses UTC and all-day dates
  ✓ cleanEmail strips mailto: and angle brackets
  ✓ generateIcs and parseIcs full roundtrip with attendees and organizer
  ✓ generateRsvpReplyIcs formats RFC 5546 iTIP reply
  ✓ parseIcs safely handles malformed, truncated, or empty input
  ✓ Distinguish invitation (METHOD:REQUEST) from ordinary published calendar
  ✓ 9. Organizer update increments sequence and retains stable UID
  ✓ 10. Stale update rejected: incoming revision older than stored revision
  ✓ 11. Organizer mismatch rejected by verifyInvitationAuthenticity
  ✓ 12. Duplicate RSVP response detected without duplicate side-effects
  ✓ 13. Cancellation followed by older REQUEST is rejected
  ✓ 14. Single-instance recurrence exception (RECURRENCE-ID) parsed
  ✓ 15. Timezone-aware timestamp and Daylight-Saving transition
  ✓ 16. Parser resilience: reject oversized input (>512KB)
  ✓ 17. Parser resilience: sanitize dangerous URL schemes (javascript:)
  ✓ 18. Parser resilience: sanitize ASCII control characters
  ✓ 19. Parser resilience: duplicate UID property takes first valid UID
  ✓ 20. RFC 6047 MIME fixtures roundtrip for REQUEST, REPLY, CANCEL
  ✓ 21. BYOS policy: negative SEQUENCE rejected as invalid input (not a stale-revision check)
  ✓ 22. Full stale REQUEST lifecycle: seq3 stored → seq2 rejected → seq4 accepted → dup seq4 idempotent → old CANCEL rejected → valid CANCEL accepted
  ✓ 23. REPLY method: attendee response with organizer's sequence is accepted, not treated as stale
  ✓ 24. REQUEST updates v0 → v1 → v2 accepted by verifyInvitationAuthenticity at each step
  ✓ 25. CANCEL sequence must exceed stored REQUEST sequence
  ✓ 26. Recurring event: RECURRENCE-ID parsed; stale exception rejected; fresh exception accepted
  ✓ 27. Organizer authorization: pipeline integration — stored organizer blocks hijack, correct organizer proceeds
  ✓ generateIcs exports multi-component series with EXDATE and detached VEVENT exceptions
  ✓ VTIMEZONE parsing extracts standard and daylight definitions
  ✓ Daylight Saving Time (DST) transitions convert local times to accurate UTC timestamps across hemispheres
  ✓ Custom VTIMEZONE with non-IANA TZID converts local timestamps correctly
  ✓ Floating time events preserve floating representation without Z or TZID
  ✓ All-day events format compliant non-inclusive DTEND and preserve all-day semantics
  ✓ generateVTimeZone emits compliant RFC 5545 VTIMEZONE block for various zones
  ✓ Full round-trip export and import with timezone, DST, and detached exceptions
```

### 2. Active Database (`byos`) Immutability Check
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "\dt calendar_event_exceptions"; docker exec byos-postgres psql -U byos -d byos -c "SELECT count(*) FROM calendar_events;"
```
Output:
```text
Did not find any relation named "calendar_event_exceptions".
 count 
-------
     3
(1 row)
```

## Manual browser verification
This milestone focuses on client-side RFC 5545 parsing, serialization, and time-zone mathematics within `calendarIcs.ts` and `calendarRrule.ts`. Full browser verification of calendar rendering and event interaction was established in the preceding browser test (`test_calendar_recurrence_browser.mjs`), with saved screenshots:
- `tests/browser/artifacts/calendar_recurrence_initial.png`
- `tests/browser/artifacts/calendar_recurrence_series_created.png`
- `tests/browser/artifacts/calendar_recurrence_exception_saved.png`

## What did not work or is untested
- Historic time-zone offset changes that occurred prior to 1970 are outside the RFC 5545 Gregorian recurrence scope and remain untested.
- Timezone rules with leap-second adjustments are outside RFC 5545 specifications and are not modeled.

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
--- PASS: TestCalendarLifecycleAndIsolation (0.56s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:203: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.94s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
    calendar_test.go:521: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle
=== RUN   TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload
=== RUN   TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read
=== RUN   TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations
    calendar_test.go:823: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.02s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism (0.10s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement (0.18s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle (0.24s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload (0.13s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read (0.10s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations (0.09s)
=== RUN   TestCalendarMailboxOwnerAuthorization
    calendar_test.go:847: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations
=== RUN   TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar
=== RUN   TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations
=== RUN   TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries
--- PASS: TestCalendarMailboxOwnerAuthorization (0.96s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations (0.18s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar (0.13s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations (0.04s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries (0.17s)
=== RUN   TestCalendarRecoveryPlaintextCleanupAndRollbackSafety
    calendar_test.go:1040: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryPlaintextCleanupAndRollbackSafety (0.44s)
=== RUN   TestCalendarRecoveryConcurrencyAndLockOrdering
    calendar_test.go:1158: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryConcurrencyAndLockOrdering (0.43s)
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
--- PASS: TestCalendarTerminalMigrationDeletionBehavior (1.11s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Finalized_event_deletion_succeeds_and_cleans_up_migration_rows (0.13s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Rolled_back_event_deletion_succeeds_and_cleans_up_migration_rows (0.10s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Calendar_deletion_with_terminal_event_migrations_succeeds (0.13s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_1_-_No_events_or_migrations_succeeds (0.16s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_2_-_Active_staged_migration_blocks_deletion_and_preserves_data (0.14s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_3_-_Finalized_migration_history_cleaned_up_and_mailbox_deactivated (0.23s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_4_-_Rolled-back_migration_history_cleaned_up_and_mailbox_deactivated (0.21s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_5_-_Mixed_terminal_and_staged_migrations_preserves_all_data_and_blocks_deletion (0.36s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation
    calendar_test.go:1610: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1627: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations
2026/10/25 12:33:14 [calendar-recovery] startup reconciliation recovered 1 expired migration(s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review
2026/10/25 12:33:14 [calendar-reconciliation] WARNING: ambiguous event payload for event_id=07591cdb-4f31-449f-a79a-8284ac85ce02 mig_id=74312b61-880d-4713-af26-880e9c1782fb - preserved event payload and preserved migration copy for manual review
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly
2026/10/25 12:33:14 [calendar-recovery] expiration worker started (interval 50ms)
2026/10/25 12:33:14 [calendar-recovery] periodic sweep recovered 1 expired migration(s)
2026/10/25 12:33:14 [calendar-recovery] expiration worker shutting down cleanly
--- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation (0.83s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations (0.10s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation (0.13s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review (0.09s)
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
--- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency (0.99s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Staging_begins_before_mailbox_deletion_-_Staging_succeeds,_deletion_rejected (0.16s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_begins_before_staging_-_Deletion_succeeds,_staging_rejected (0.17s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Concurrent_execution_-_Deterministic_outcome_without_orphaned_staged_migration (0.15s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_is_retried_after_a_staged_migration_exists (0.16s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Deactivated_mailbox_rejects_stage,_status,_finalize,_and_rollback (0.24s)
=== RUN   TestCalendarRecurrenceExceptionsLifecycle
    calendar_test.go:2222: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecurrenceExceptionsLifecycle (0.54s)
PASS
ok  	byos.email/services/api	9.904s
```

### Webmail Node Test Suite Output (`apps/webmail`)
Command:
```powershell
cmd /c "cd apps\webmail && npx tsx --experimental-wasm-modules src/run_test.node.js"
```
Output:
```text
(node:17872) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=85843d5e-4c12-44c3-bc46-f3300bdb89eb chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=d72c5189-87ef-45e1-ab9f-a51cecc01df6 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=3605850e-c83a-4243-a92d-1237046bd7bf chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: active signing seed does not match A
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

OVERALL: 387 passed, 0 failed
```
