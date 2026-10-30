# CalDAV Synchronization Completion Report

## What was built

A production-grade, RFC 4791 (CalDAV) and RFC 4918 (WebDAV) compliant calendar synchronization and collection management engine in Go (`services/api`), featuring RFC 6764 service discovery (`/.well-known/caldav`), RFC 6578 collection synchronization (`sync-collection` REPORT), RFC 5545 iCalendar bidirectional ingestion and generation, HTTP Basic Authentication with Argon2id password verification, tenant and mailbox isolation, and a cryptographic bridge to Section 12 zero-knowledge AES-256-GCM authenticated envelopes with Argon2id key unwrapping.

## Files edited

| File | Reason |
|------|--------|
| `services/api/main.go` | Registered CalDAV and WebDAV endpoints for well-known discovery, principal sets, calendar collections, and event resources. |
| `services/api/caldav.go` | Implemented RFC 4791/4918/6764/6578 sync handlers, RFC 5545 iCalendar parser/serializer, XML multistatus formatting, and Section 12 AES-GCM cryptographic bridge. |
| `services/api/caldav_test.go` | Added Go test suite verifying discovery, Basic Auth, MKCALENDAR, PUT, GET, DELETE, REPORT (calendar-query, calendar-multiget, sync-collection), recurrence exceptions, and permissions. |
| `tests/browser/test_caldav_sync.mjs` | Created automated end-to-end sync verification script simulating CalDAV client sync and capturing Webmail calendar browser state. |
| `tests/browser/artifacts/caldav_sync_browser_calendar.png` | Saved visual evidence screenshot of Webmail calendar interface displaying CalDAV-synchronized event. |
| `docs/caldav_synchronization_completion_report.md` | Milestone completion report documenting architecture, test output, file accounting, and raw verification evidence. |

## Raw evidence

### Active database preservation check (Read-Only)
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "SELECT count(*) FROM calendar_events;"
```
Output:
```
 count 
-------
     3
(1 row)
```

### CalDAV test execution against disposable database
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run TestCalDav ./services/api
```
Output:
```
=== RUN   TestCalDavWellKnown
--- PASS: TestCalDavWellKnown (0.00s)
=== RUN   TestCalDavAuthenticationAndPrincipal
    caldav_test.go:141: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavAuthenticationAndPrincipal (0.28s)
=== RUN   TestCalDavHomeSetAndMkcalendar
    caldav_test.go:181: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavHomeSetAndMkcalendar (0.47s)
=== RUN   TestCalDavPutGetDeleteEventLifecycle
    caldav_test.go:223: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavPutGetDeleteEventLifecycle (1.10s)
=== RUN   TestCalDavCalendarQueryAndMultigetReport
    caldav_test.go:336: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavCalendarQueryAndMultigetReport (0.73s)
=== RUN   TestCalDavRecurrenceExceptionSync
    caldav_test.go:429: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavRecurrenceExceptionSync (0.58s)
=== RUN   TestCalDavSharedCalendarPermissions
    caldav_test.go:499: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavSharedCalendarPermissions (1.06s)
PASS
ok  	byos.email/services/api	5.712s
```

### Database Section 12 wire envelope verification
Query:
```powershell
docker exec byos-postgres psql -U byos -d byos_recovery_disposable_20261024 -c "SELECT length(encrypted_payload), encode(substring(encrypted_payload from 1 for 1), 'hex') FROM calendar_events WHERE calendar_id = '902fadd2-399b-5b0b-8a98-27db87fb3d70';"
```
Output:
```
 length | encode 
--------+--------
    274 | 01
(1 row)
```

## Manual browser verification

Test script `tests/browser/test_caldav_sync.mjs` was executed against disposable API instance on port 8098 and disposable Webmail frontend on port 3012.

Execution command:
```powershell
node tests/browser/test_caldav_sync.mjs
```
Output:
```
================================================================================
        BYOS CALDAV SYNCHRONIZATION PROTOCOL CLIENT VERIFICATION                
================================================================================

  Preparing disposable fixture in database: byos_recovery_disposable_20261024
  Starting disposable API on port 8098...
  Starting disposable Webmail on port 3012...
  Waiting for API and Webmail to become ready...
  Disposable test services ready.

[Step 1] Verifying RFC 6764 /.well-known/caldav discovery redirect...
  PASS: /.well-known/caldav redirected (status 301)
  PASS: Redirect Location is /dav/principals/
[Step 2] Verifying OPTIONS capabilities and DAV header compliance...
  PASS: OPTIONS returned 200 OK
  PASS: DAV header includes 'calendar-access' (1, 2, 3, calendar-access, calendar-schedule)
  PASS: Allow header includes PROPFIND and REPORT
[Step 3] Verifying HTTP Basic Auth challenge on protected endpoints...
  PASS: Unauthenticated request returned 401 Unauthorized
  PASS: WWW-Authenticate header requests Basic auth (Basic realm="BYOS CalDAV")
[Step 4] Executing PROPFIND on /dav/principals/ for Alice...
  PASS: PROPFIND /dav/principals/ returned 207 Multi-Status
  PASS: XML contains current-user-principal
  PASS: XML contains calendar-home-set
  PASS: Calendar home set matches Alice mailbox URL
[Step 5] Executing PROPFIND (Depth 1) on Alice's calendar home set...
  PASS: PROPFIND calendar home returned 207 Multi-Status
  PASS: Home set contains calendar collection
  PASS: Home set contains CS:getctag property
[Step 6] Creating new calendar collection via MKCALENDAR...
  PASS: MKCALENDAR returned 201 Created
  PASS: Location header points to new collection: /dav/calendars/c0000000-0000-0000-0000-000000000001/902fadd2-399b-5b0b-8a98-27db87fb3d70/
  PASS: Created calendar collection found in DB: 902fadd2-399b-5b0b-8a98-27db87fb3d70
[Step 7] Ingesting RFC 5545 iCalendar event via PUT...
  PASS: PUT event returned 201 Created
  PASS: PUT returned valid ETag header: ""dea6631b55fa3ddd0f959c0d0a5f0bbb6ce0a1bba2a3187e527eac7354eda593""
  PASS: Database encrypted_payload length is >= 29 bytes (274)
  PASS: Database encrypted_payload version byte is Section 12 AES-GCM (0x01)
[Step 8] Retrieving event via GET...
  PASS: GET event returned 200 OK
  PASS: Content-Type is text/calendar
  PASS: ETag matches PUT response (""dea6631b55fa3ddd0f959c0d0a5f0bbb6ce0a1bba2a3187e527eac7354eda593"")
  PASS: GET iCalendar contains decrypted summary
  PASS: GET iCalendar contains decrypted location
[Step 9] Verifying If-None-Match: * precondition conflict rejection...
  PASS: PUT with If-None-Match: * returned 412 Precondition Failed
[Step 10] Executing REPORT calendar-query time-range search...
  PASS: calendar-query REPORT returned 207 Multi-Status
  PASS: Query report contains event UID: sync-event-1792920471491
  PASS: Query report contains decrypted event summary
[Step 11] Executing RFC 6578 sync-collection REPORT...
  PASS: sync-collection REPORT returned 207 Multi-Status
  PASS: sync-collection contains new sync-token
[Step 12] Sharing calendar with Bob and testing CalDAV permissions...
  PASS: Bob calendar home returned 207 Multi-Status
  PASS: Bob home set includes shared calendar
  PASS: Bob has read privilege on shared calendar
  PASS: Bob write attempt on read-only share was rejected with 403 Forbidden
[Step 13] Launching Puppeteer browser to verify CalDAV event in Webmail UI...
  Logging into Webmail as Alice...
  Waiting for Alice dashboard to load...
  Navigating to Calendar tab...
  Saved screenshot to: F:\Codex\byos-email\tests\browser\artifacts\caldav_sync_browser_calendar.png
  PASS: Browser verification screenshot saved

================================================================================
     ALL CALDAV SYNCHRONIZATION AND BROWSER VERIFICATIONS PASSED!               
================================================================================

  Cleaning up processes...
```

Artifact screenshot:
`tests/browser/artifacts/caldav_sync_browser_calendar.png`

## What did not work or is untested

- **UNTESTED:** Native macOS Calendar app and iOS Settings Accounts CalDAV synchronization against a live public domain with TLS certificates.
  - Manual steps to test: Expose `services/api` on an external public HTTPS domain with valid Let's Encrypt certificates, configure an iOS or macOS device under `Settings -> Calendar -> Accounts -> Add Account -> Other -> Add CalDAV Account`, enter server URL, email, and password, and verify two-way background sync with native calendar widgets.

## Test suite output

### Go test output (`services/api`)
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run "TestCal" ./services/api
```
Output:
```
=== RUN   TestCalDavWellKnown
--- PASS: TestCalDavWellKnown (0.00s)
=== RUN   TestCalDavAuthenticationAndPrincipal
    caldav_test.go:141: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavAuthenticationAndPrincipal (0.28s)
=== RUN   TestCalDavHomeSetAndMkcalendar
    caldav_test.go:181: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavHomeSetAndMkcalendar (0.47s)
=== RUN   TestCalDavPutGetDeleteEventLifecycle
    caldav_test.go:223: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavPutGetDeleteEventLifecycle (1.18s)
=== RUN   TestCalDavCalendarQueryAndMultigetReport
    caldav_test.go:336: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavCalendarQueryAndMultigetReport (0.79s)
=== RUN   TestCalDavRecurrenceExceptionSync
    caldav_test.go:429: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavRecurrenceExceptionSync (0.60s)
=== RUN   TestCalDavSharedCalendarPermissions
    caldav_test.go:499: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalDavSharedCalendarPermissions (1.09s)
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:61: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLifecycleAndIsolation (0.54s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:203: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.98s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
    calendar_test.go:521: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle
=== RUN   TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload
=== RUN   TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read
=== RUN   TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations
    calendar_test.go:823: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.09s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism (0.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement (0.20s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle (0.24s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload (0.13s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read (0.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations (0.10s)
=== RUN   TestCalendarMailboxOwnerAuthorization
    calendar_test.go:847: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations
=== RUN   TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar
=== RUN   TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations
=== RUN   TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries
--- PASS: TestCalendarMailboxOwnerAuthorization (1.03s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Peer_employee_in_same_org_rejected_from_owner_calendar_and_migrations (0.18s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Org_administrator_cannot_access_or_manipulate_employee_calendar (0.13s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Cross-tenant_user_rejected_from_mailbox_operations (0.06s)
    --- PASS: TestCalendarMailboxOwnerAuthorization/Migration_ID_cannot_cross_mailbox_boundaries (0.21s)
=== RUN   TestCalendarRecoveryPlaintextCleanupAndRollbackSafety
    calendar_test.go:1040: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryPlaintextCleanupAndRollbackSafety (0.45s)
=== RUN   TestCalendarRecoveryConcurrencyAndLockOrdering
    calendar_test.go:1158: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecoveryConcurrencyAndLockOrdering (0.45s)
=== RUN   TestCalendarTerminalMigrationDeletionBehavior
    calendar_test.go:1236: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1248: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1270: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1330: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1406: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1484: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarTerminalMigrationDeletionBehavior (1.19s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Normal_calendar_deletion_with_terminal_event_migrations_succeeds (0.16s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_1_-_No_events_or_migrations_succeeds (0.09s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_2_-_Active_staged_migration_blocks_deletion_and_preserves_data (0.18s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_3_-_Finalized_migration_history_cleaned_up_and_mailbox_deactivated (0.24s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_4_-_Rolled-back_migration_history_cleaned_up_and_mailbox_deactivated (0.23s)
    --- PASS: TestCalendarTerminalMigrationDeletionBehavior/Mailbox_deletion_Case_5_-_Mixed_terminal_and_staged_migrations_preserves_all_data_and_blocks_deletion (0.37s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation
    calendar_test.go:1610: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
    calendar_test.go:1627: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations
2026/10/25 15:28:44 [calendar-recovery] startup reconciliation recovered 1 expired migration(s)
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review
2026/10/25 15:28:44 [calendar-reconciliation] WARNING: ambiguous event payload for event_id=b9d91dc8-787a-486e-b4ce-2262404a570a mig_id=5c1182a7-2da3-4887-b29f-8d3faa8e3a89 - preserved event payload and preserved migration copy for manual review
=== RUN   TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly
2026/10/25 15:28:44 [calendar-recovery] expiration worker started (interval 50ms)
2026/10/25 15:28:44 [calendar-recovery] periodic sweep recovered 1 expired migration(s)
2026/10/25 15:28:45 [calendar-recovery] expiration worker shutting down cleanly
--- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation (0.89s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Startup_reconciliation_recovers_expired_staged_migrations (0.12s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Non-expired_staged_migration_is_preserved_by_reconciliation (0.13s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/Ambiguous_state_preserves_both_copies_and_marks_review (0.09s)
    --- PASS: TestCalendarLifecycleWorkerAndStartupReconciliation/StartCalendarExpirationWorker_sweeps_expired_migrations_and_stops_cleanly (0.33s)
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
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Mailbox_deletion_is_retried_after_a_staged_migration_exists (0.18s)
    --- PASS: TestCalendarMailboxDeletionVsMigrationStagingConcurrency/Deactivated_mailbox_rejects_stage,_status,_finalize,_and_rollback (0.25s)
=== RUN   TestCalendarRecurrenceExceptionsLifecycle
    calendar_test.go:2222: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarRecurrenceExceptionsLifecycle (0.57s)
=== RUN   TestCalendarSharingAndPermissions
    calendar_test.go:2435: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarSharingAndPermissions (0.89s)
PASS
ok  	byos.email/services/api	15.712s
```

### Webmail test output (`apps/webmail`)
Command:
```powershell
cd apps/webmail; npm.cmd test
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:9232) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=5def8b34-f94a-40b5-acba-31a2e515fd52 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=59bc198e-c224-4817-bc95-dfc4d1a7753e (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=14cc2518-2a90-4e2c-8307-074fc2cb5a95 chunk_index=0
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 39 passed, 0 failed

Running Message Crypto Tests...
MESSAGE CRYPTO TESTS: 6 passed, 0 failed

Running Draft Crypto Tests...
DRAFT CRYPTO TESTS: 5 passed, 0 failed

Running Contact Crypto Tests...
CONTACT CRYPTO TESTS: 4 passed, 0 failed

Running MIME Structure Tests...
MIME STRUCTURE TESTS: 16 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 6 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 3 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 151 passed, 0 failed

Running Calendar RRULE Tests...
CALENDAR RRULE TESTS: 78 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 19 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

Running Historical Key Reactivation & Preflight Tests...
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions & Interoperability Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

Running Calendar External Invitations & Fallback Delivery Tests...
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 7 passed, 0 failed

OVERALL: 404 passed, 0 failed
```
