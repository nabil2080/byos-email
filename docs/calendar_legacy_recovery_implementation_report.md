# BYOS Calendar Legacy Recovery Implementation Report

## What was built
Implemented the approved non-destructive legacy calendar plaintext recovery architecture across the Go API, PostgreSQL migration definitions, and SolidJS Webmail client. The system establishes a non-destructive, four-phase state machine featuring atomic server preservation, RFC 9110 strong ETag concurrency guards, canonical parent-then-child row-lock ordering, client-side cryptographic provenance validation via X25519 HPKE challenges, in-memory WASM AES-GCM re-encryption, server read-back round-trip equality checks, automatic rollback on verification failure, opportunistic expiration recovery, and disaster-recovery restoration reconciliation (`ReconcileRestoredMigrations`). The database migration `060_calendar_event_migrations.sql` was authored and validated exclusively against disposable test database `byos_recovery_disposable_20261024`, leaving the active `byos` database and its three quarantined legacy plaintext records completely untouched.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/060_calendar_event_migrations.sql` | Authored DDL schema for `calendar_event_migrations` table with `ON DELETE RESTRICT` constraints, unique partial index, and lookup/expiry indexes (kept unapplied to active `byos` database). |
| `services/api/calendar.go` | Implemented `computeCalendarEventETag`, canonical parent-then-child row-lock ordering, staging, finalization, rollback, migration-status endpoints, write/delete conflict guards, opportunistic expiration recovery, and `ReconcileRestoredMigrations`. |
| `services/api/main.go` | Registered the four new legacy calendar migration HTTP routes under `/v1/mailboxes/{mailbox_id}/calendar-events/{event_id}/`. |
| `services/api/calendar_test.go` | Added `calMigrationRequest` helper and `TestCalendarLegacyRecoveryLifecycle` covering strong ETag determinism, staging preconditions (428/400/412), write/delete guards (409), finalization idempotence, rollback restoration, opportunistic expiration, and backup reconciliation against disposable database. |
| `apps/webmail/src/api.ts` | Added typed HTTP client functions `apiRequestWithHeaders`, `fetchCalendarEventWithETag`, `stageCalendarEventMigration`, `finalizeCalendarEventMigration`, `rollbackCalendarEventMigration`, and `fetchCalendarEventMigrationStatus`. |
| `apps/webmail/src/calendar_recovery.ts` | Implemented Webmail recovery controller with `validateMailboxKeyProvenance` (X25519 HPKE seal/open challenge), `findLegacyCalendarEvents`, and four-phase `executeLegacyCalendarEventRecovery` workflow with read-back verification and automated rollback. |
| `apps/webmail/src/calendar_recovery.test.ts` | Added automated unit test suite covering key provenance, legacy event identification, four-phase recovery lifecycle, read-back mismatch rollback, read-back decryption failure rollback, and 412 precondition aborts. |
| `apps/webmail/src/run_test.node.js` | Registered and executed `runCalendarRecoveryTests` within the Webmail Node.js test runner. |
| `apps/webmail/src/App.tsx` | Propagated `mailboxPk` and `unlockedBoxId` properties into the `<CalendarView />` invocation. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Added `findLegacyCalendarEvents` memo, migration state signals (`migrationRunning`, `migrationProgress`, `migrationError`, `migrationSuccess`), `handleStartRecovery` handler, and responsive upgrade alert banner. |
| `docs/calendar_legacy_recovery_safety_review.md` | Updated final specification with canonical database row-lock ordering, `ReconcileRestoredMigrations` disaster reconciliation, and RFC 9110 strong ETag serialization from authoritative database state. |
| `docs/calendar_legacy_recovery_implementation_report.md` | Final post-implementation engineering report with raw execution evidence and file accounting. |

## Raw evidence

### 1. Active `byos` Database Untouched (Absence of Migration 060)
Command: `docker exec byos-postgres psql -U byos -d byos -c "\dt calendar_event_migrations"`
```
Did not find any relation named "calendar_event_migrations".
```

### 2. Active `byos` Quarantined Legacy Records Intact
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, mailbox_id, status, encode(encrypted_payload, 'escape') FROM calendar_events;"`
```
                  id                  |              mailbox_id              | status |                                                                                                                                          encode                                                                                                                                           
--------------------------------------+--------------------------------------+--------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | c0000000-0000-0000-0000-000000000001 | busy   | {"title":"BYOS Architecture Review","description":"Discussion on zero-knowledge encryption guarantees.","location":"Security Lab 3A","meetingUrl":"","attendees":[],"timezone":"Asia/Dhaka"}
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | c0000000-0000-0000-0000-000000000001 | busy   | {"title":"Phase 5 Architecture Sync","description":"","location":"","meetingUrl":"","attendees":[{"email":"bob@byos.local","status":"needs-action"}],"timezone":"Asia/Dhaka","uid":"byos-evt-4015095e-42ec-4d03-a689-02771059b1bb","sequence":0,"organizer":{"email":"alice@byos.local"}}
 a4196298-d4e1-4921-8b26-0a2d470636f3 | c0000000-0000-0000-0000-000000000001 | busy   | {"title":"Phase 5 Architecture Sync","description":"","location":"","meetingUrl":"","attendees":[{"email":"bob@byos.local","status":"needs-action"}],"timezone":"Asia/Dhaka","uid":"byos-evt-d1db3acb-7bc2-430f-bdad-c1027a3ec292","sequence":0,"organizer":{"email":"alice@byos.local"}}
(3 rows)
```

### 3. Disposable Database Migration 060 Schema
Command: `docker exec byos-postgres psql -U byos -d byos_recovery_disposable_20261024 -c "\d calendar_event_migrations"`
```
                             Table "public.calendar_event_migrations"
     Column      |           Type           | Collation | Nullable |           Default            
-----------------+--------------------------+-----------+----------+------------------------------
 id              | uuid                     |           | not null | gen_random_uuid()
 event_id        | uuid                     |           | not null | 
 mailbox_id      | uuid                     |           | not null | 
 legacy_payload  | bytea                    |           |          | 
 staged_payload  | bytea                    |           | not null | 
 status          | text                     |           | not null | 
 etag            | text                     |           | not null | 
 created_at      | timestamp with time zone |           | not null | now()
 expires_at      | timestamp with time zone |           | not null | now() + '00:15:00'::interval
 finalized_at    | timestamp with time zone |           |          | 
 rolled_back_at  | timestamp with time zone |           |          | 
 rollback_reason | text                     |           |          | 
Indexes:
    "calendar_event_migrations_pkey" PRIMARY KEY, btree (id)
    "idx_calendar_event_migrations_expiry" btree (status, expires_at) WHERE status = 'staged'::text
    "idx_calendar_event_migrations_lookup" btree (mailbox_id, event_id, status)
    "uq_calendar_event_active_migration" UNIQUE, btree (event_id) WHERE status = 'staged'::text
Check constraints:
    "calendar_event_migrations_status_check" CHECK (status = ANY (ARRAY['staged'::text, 'finalized'::text, 'rolled_back'::text]))
Foreign-key constraints:
    "calendar_event_migrations_event_id_fkey" FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE RESTRICT
    "calendar_event_migrations_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE RESTRICT
```

### 4. Go API Integration Test Output (Disposable Test Database)
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -count=1 ./services/api -run "TestCalendar.*"`
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:60: [test-db] Using test database 'byos_recovery_disposable_20261024' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.59s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:202: [test-db] Using test database 'byos_recovery_disposable_20261024' on host '127.0.0.1'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (1.07s)
=== RUN   TestCalendarLegacyRecoveryLifecycle
    calendar_test.go:520: [test-db] Using test database 'byos_recovery_disposable_20261024' on host '127.0.0.1'
=== RUN   TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement
=== RUN   TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle
=== RUN   TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload
=== RUN   TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read
=== RUN   TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations
    calendar_test.go:822: [test-db] Using test database 'byos_recovery_disposable_20261024' on host '127.0.0.1'
--- PASS: TestCalendarLegacyRecoveryLifecycle (1.13s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ETag_computation_determinism (0.09s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_migration_input_and_precondition_enforcement (0.20s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Stage_and_Finalize_successful_lifecycle (0.23s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Rollback_restores_legacy_payload (0.12s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/Opportunistic_expiration_recovery_on_read (0.11s)
    --- PASS: TestCalendarLegacyRecoveryLifecycle/ReconcileRestoredMigrations_recovers_expired_restored_migrations (0.12s)
PASS
ok  	byos.email/services/api	4.478s
```

### 5. Webmail Test Suite Output
Command: `npm.cmd test --prefix apps/webmail`
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:13296) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=a2113988-3634-491f-8e67-751aa9213c5a chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=409b6a57-9d4a-4c16-83c7-2c55cd41cb1e (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=8d4579cf-f766-41a6-b619-593fceb9d50c chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: active X-Wing seed is B's after switch, not A's
  ✓ test_switch_loads_target_account_keys: active mailbox key is B's after switch, not A's
  ✓ test_switch_loads_target_account_keys: target account promoted to index 0
  ✓ test_switch_loads_target_account_keys: sessionStorage updated with active account ID
  ✓ test_sync_between_tabs: storage event for Account D updates state
  ✓ test_sync_between_tabs: session storage syncs across tabs via storage event
  ✓ test_concurrent_token_refresh: multiple 401s trigger single refresh call
  ✓ test_concurrent_token_refresh: queued requests retry with new token
  ✓ test_token_expiry_countdown: expiry timer starts with correct remaining seconds
  ✓ test_token_expiry_countdown: warning emitted at threshold (5 min)
  ✓ test_token_expiry_countdown: modal shown at critical threshold (1 min)
  ✓ test_tab_session_sync: session token change in another tab triggers re-read
  ✓ test_tab_session_sync: logout in another tab clears local state
  ✓ test_tab_session_sync: active account switch in another tab syncs active state
MULTI-ACCOUNT & STORAGE SYNC TESTS: 46 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 20 passed, 0 failed

Running Path A Compose Tests...
PATH A COMPOSE TESTS: 12 passed, 0 failed

Running Path A Read Tests...
PATH A READ TESTS: 12 passed, 0 failed

Running MIME & Envelope Tests...
MIME & ENVELOPE TESTS: 20 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 5 passed, 0 failed

Running Reply Signature Tests...
REPLY SIGNATURE TESTS: 8 passed, 0 failed

Running Mbox Stream Parser Tests...
MBOX STREAM PARSER TESTS: 6 passed, 0 failed

Running Mbox Label Extraction Tests...
MBOX LABEL EXTRACTION TESTS: 6 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 10 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 12 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 5 passed, 0 failed

Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 10 passed, 0 failed

Running Snooze Tests...
SNOOZE TESTS: 8 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 8 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 11 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 14 passed, 0 failed

Running API Error Handling Tests...
API ERROR HANDLING TESTS: 7 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 10 passed, 0 failed

Running Masked Email Tests...
MASKED EMAIL TESTS: 15 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 12 passed, 0 failed

Running Offline Detection Tests...
OFFLINE DETECTION TESTS: 8 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 9 passed, 0 failed

Running Contacts Tests...
CONTACTS TESTS: 12 passed, 0 failed

Running Sidebar Borderless UI Tests...
SIDEBAR BORDERLESS TESTS: 10 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 10 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 10 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 10 passed, 0 failed

Running Calendar RRULE Tests...
CALENDAR RRULE TESTS: 18 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 12 passed, 0 failed

Running Calendar ICS & Invitation Tests...
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

### 6. Webmail Production Build Output
Command: `npm.cmd run build --prefix apps/webmail`
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 159 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-BsGW6e2N.css                 106.86 kB │ gzip:  16.97 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-FrItjgN2.js                  940.54 kB │ gzip: 230.08 kB
✓ built in 3.55s
```

## Section: Implemented and tested
- **Database Schema for Staging:** Authored `infra/postgres/init/060_calendar_event_migrations.sql` with table `calendar_event_migrations`, `ON DELETE RESTRICT` foreign keys, unique partial index on `(event_id) WHERE status = 'staged'`, and expiry/lookup indexes. Tested and applied exclusively on `byos_recovery_disposable_20261024`.
- **Authoritative Deterministic Strong ETags:** RFC 9110 compliant hexadecimal SHA-256 ETag covering all mutable fields (`id`, `mailbox_id`, `calendar_id`, `start_time`, `end_time`, `is_all_day`, `rrule`, `status`, `encrypted_payload`, `updated_at`). Tested determinism and mutation sensitivity in Go test `ETag computation determinism`.
- **Precondition & Staging Endpoint Validation:** `POST /stage-migration` enforces `If-Match` presence (428), rejects weak `W/` ETags (400), rejects malformed ETags (400), rejects stale/mismatched ETags (412), rejects malformed envelopes (400), and rejects staging non-legacy records (400). Tested in `Stage migration input and precondition enforcement`.
- **Deadlock-Free Canonical Row-Lock Ordering:** Acquired parent `calendar_events` row lock first (`FOR UPDATE`), followed by child `calendar_event_migrations` row lock second (`FOR UPDATE`). Tested during concurrent staging and updates.
- **Write and Deletion Guards:** While an event is in `staged` status, concurrent `PATCH` (409), concurrent `DELETE` on event (409), concurrent `DELETE` on calendar (409), and concurrent staging (409) are blocked. Tested in `Stage and Finalize successful lifecycle`.
- **Idempotent Finalization:** `POST /finalize-migration` zeros/nulls `legacy_payload`, updates status to `finalized`, and returns idempotent 200 on repeated calls. Tested in `Stage and Finalize successful lifecycle`.
- **Atomic Rollback:** `POST /rollback-migration` restores legacy payload to `calendar_events.encrypted_payload`, marks status `rolled_back`, and blocks subsequent finalization (409). Tested in `Rollback restores legacy payload`.
- **Opportunistic Expiration Recovery:** When an expired migration (`expires_at < now()`) is read via `GET`, the legacy payload is automatically restored, and status updated to `rolled_back` with reason `ttl_expired_opportunistic`. Tested in `Opportunistic expiration recovery on read`.
- **Disaster Restoration Reconciliation:** `ReconcileRestoredMigrations` safely scans and rolls back all expired staged migrations following a database restoration. Tested in `ReconcileRestoredMigrations recovers expired restored migrations`.
- **Webmail Cryptographic Key Provenance Assertion:** `validateMailboxKeyProvenance` validates 32-byte key custody, identity match (`unlockedBoxId === mailboxId`), and performs an in-memory X25519 HPKE seal/open challenge against `mailboxPk`. Tested in unit tests.
- **Client-Side Recovery State Machine:** `executeLegacyCalendarEventRecovery` performs fetch, ETag validation, legacy JSON parsing, WASM AES-GCM re-encryption, staging, read-back verification, and finalization, with automatic rollback on mismatch or decryption failure. Tested in unit tests.

## Section: Implemented but not tested
- **Automated Cron Sweeper Daemon:** The background worker function `ReconcileRestoredMigrations` is implemented and tested under integration test execution, but an independent standalone background daemon process scheduled via cron was not configured as a background OS daemon in this task.
- **Active Production Mailbox Finalization:** The actual migration against the three production legacy records in the active `byos` database has not been triggered, adhering strictly to the constraint that migrations and data alterations are never performed without user authorization.

## Section: Designed but not implemented
- **Permanent Physical Storage Shredding / DB Compaction:** Physical sanitization of dead tuples from PostgreSQL table heap pages and WAL segments is designed and documented as subject to PostgreSQL MVCC vacuuming (`VACUUM FULL`) and WAL segment rotation. Application-level cryptographic erasure (nulling `legacy_payload` and overwriting `encrypted_payload` with ciphertext) is implemented, but physical disk overwrite / SSD trim is left to underlying infrastructure.

## Section: Known limitations
- **PostgreSQL MVCC Remanence:** Updating or setting `legacy_payload = NULL` generates a new MVCC tuple version. The old tuple containing legacy plaintext remains in table heap files until PostgreSQL runs `VACUUM` and dead pages are recycled.
- **Local Round-Trip Symmetrical Bound:** While encrypt-then-decrypt verifies the local WASM crypto subsystem, proof of key ownership is anchored in the user's password unseal / BIP39 unwrap flow and the mathematical X25519 HPKE pairing challenge against the registered `mailbox_pk`.
- **Session Lifespan Bound:** If a user initiates migration and closes the browser during the intermediate 15-minute verification window before finalization, the event remains staged until either read back (triggering opportunistic recovery) or swept by `ReconcileRestoredMigrations`.

## Manual browser verification
Manual browser verification status: **UNTESTED**
Manual steps required to verify in the browser:
1. Log in to Webmail at `http://localhost:3000` using credentials for `alice@byos.local`.
2. Unlock the mailbox by entering the mailbox password, establishing `mailboxKey` and `unlockedBoxId` in session state.
3. Switch to the Calendar module.
4. Observe the warning banner: "Legacy unencrypted calendar records detected. [Upgrade to End-to-End Encryption]".
5. Click the "Upgrade to End-to-End Encryption" button.
6. Observe progress state transition: "Upgrading (1/3)..." through "Upgrading (3/3)...".
7. Observe success banner: "Successfully upgraded 3 legacy calendar event(s) to end-to-end encryption."
8. Verify in DevTools Network tab that `/stage-migration`, read-back `/calendar-events/{id}`, and `/finalize-migration` completed with HTTP 200 responses.
9. Inspect PostgreSQL database to verify `encrypted_payload` in `calendar_events` begins with `0x01` AES-GCM envelope byte and `legacy_payload` in `calendar_event_migrations` is `NULL`.

## What did not work or is untested
- **Active Database Execution:** Migration of the three actual legacy records in `byos` was not executed. This was intentional to preserve active data integrity.
- **End-to-End Browser UI Automation:** Browser UI was built and unit/integration tested, but interactive browser execution with real browser session was not run in this headless turn.
