# Calendar Sharing & Permissions Completion Report

## What was built
Implemented end-to-end zero-knowledge calendar sharing and permission enforcement across the BYOS platform. Owners can share individual calendars with organizational teammates with configurable permissions (`read` or `write`) using Section 12 HPKE-sealed calendar key envelopes. The server enforces same-organization constraints and restricts administrative or peer privilege escalation. Grantees can query and view shared events without leaking cross-mailbox boundaries. Read-only shares strictly block event creation, mutation, and deletion at both the API and UI presentation layers with visible warning banners and disabled controls. Read-write shares allow collaborative event scheduling directly on the shared calendar while retaining owner mailbox key provenance. Revocation and leave actions immediately terminate access.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/063_calendar_sharing.sql` | Migration defining `calendar_shares` schema with check constraints, foreign keys, triggers, and indices. |
| `services/api/main.go` | Registers `/v1/mailboxes/{mailbox_id}/calendars/{calendar_id}/shares` and `.../shares/{share_id}` routes. |
| `services/api/calendar.go` | Implements calendar sharing endpoints, same-org validation, read-only vs write permission checks, and shared event querying. |
| `services/api/calendar_test.go` | Adds integration test `TestCalendarSharingAndPermissions` covering cross-tenant rejection, self-share rejection, read-only guards, write upgrades, and revocation. |
| `apps/webmail/src/api.ts` | Declares `CalendarShare` interface, share management API client methods, and updates `UserCalendar` with sharing metadata. |
| `apps/webmail/src/calendar_crypto.ts` | Adds WASM HPKE key envelope sealing (`sealCalendarKeyForGrantee`) and opening (`unsealCalendarKeyForGrantee`). |
| `apps/webmail/src/components/calendar/ShareCalendarModal.tsx` | Implements teammate sharing modal with email input, permission selection, active shares list, permission switcher, and access revocation. |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Groups calendars into "My Calendars" and "Shared with Me", displays permission badges, and adds share action buttons. |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Implements read-only calendar protection with notice banner, disabled form inputs, and suppressed save/delete actions. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Integrates `ShareCalendarModal`, handles calendar sharing events, unseals keys, and passes calendar owner mailbox ID as AAD for shared event decryption. |
| `apps/webmail/src/calendar_sharing.test.ts` | Adds unit tests for calendar key sealing/unsealing, grantee event decryption, and permission guards. |
| `apps/webmail/src/run_test.node.js` | Registers `runCalendarSharingTests` in the main test runner. |
| `tests/browser/test_calendar_sharing_browser.mjs` | Automated end-to-end browser test verifying sharing lifecycle, read-only UI enforcement, write upgrade, and 375px mobile viewport responsiveness. |

## Raw evidence

### Active Database Immutability Check
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos -c "SELECT count(*) FROM calendar_events;"
```
Output:
```
 count 
-------
     3
(1 row)
```

### Disposable Database Schema Application
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos_recovery_disposable_20261024 -c "\d calendar_shares"
```
Output:
```
                              Table "public.calendar_shares"
       Column       |           Type           | Collation | Nullable |      Default      
--------------------+--------------------------+-----------+----------+-------------------
 id                 | uuid                     |           | not null | gen_random_uuid()
 calendar_id        | uuid                     |           | not null | 
 grantor_mailbox_id | uuid                     |           | not null | 
 grantee_mailbox_id | uuid                     |           | not null | 
 permission         | text                     |           | not null | 'read'::text
 encrypted_key      | text                     |           |          | 
 status             | text                     |           | not null | 'active'::text
 created_at         | timestamp with time zone |           | not null | now()
 updated_at         | timestamp with time zone |           | not null | now()
Indexes:
    "calendar_shares_pkey" PRIMARY KEY, btree (id)
    "idx_calendar_shares_calendar" btree (calendar_id, status)
    "idx_calendar_shares_grantee" btree (grantee_mailbox_id, status)
    "idx_calendar_shares_grantor" btree (grantor_mailbox_id)
    "uq_calendar_shares_calendar_grantee" UNIQUE CONSTRAINT, btree (calendar_id, grantee_mailbox_id)
Check constraints:
    "chk_calendar_share_distinct_mailboxes" CHECK (grantor_mailbox_id <> grantee_mailbox_id)
    "chk_calendar_share_permission" CHECK (permission = ANY (ARRAY['read'::text, 'write'::text]))
    "chk_calendar_share_status" CHECK (status = ANY (ARRAY['active'::text, 'revoked'::text]))
Foreign-key constraints:
    "calendar_shares_calendar_id_fkey" FOREIGN KEY (calendar_id) REFERENCES user_calendars(id) ON DELETE CASCADE
    "calendar_shares_grantee_mailbox_id_fkey" FOREIGN KEY (grantee_mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    "calendar_shares_grantor_mailbox_id_fkey" FOREIGN KEY (grantor_mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
Triggers:
    trg_calendar_shares_updated_at BEFORE UPDATE ON calendar_shares FOR EACH ROW EXECUTE FUNCTION update_calendar_updated_at()
```

### Go Integration Test Suite
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; go test -v -run TestCalendarSharingAndPermissions ./services/api
```
Output:
```
=== RUN   TestCalendarSharingAndPermissions
    calendar_test.go:2435: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestCalendarSharingAndPermissions (0.95s)
PASS
ok  	byos.email/services/api	2.542s
```

### Browser Test Verification Suite
Command:
```powershell
node --experimental-wasm-modules tests/browser/test_calendar_sharing_browser.mjs
```
Output:
```
================================================================================
     BYOS CALENDAR SHARING & PERMISSIONS BROWSER VERIFICATION TEST              
================================================================================

  Preparing disposable fixture in database: byos_recovery_disposable_20261024
  Starting disposable API on port 8095...
  Starting disposable Webmail on port 3011...
  Waiting for API and Webmail to become ready...
  Disposable test services ready.

--- [STEP 1] Login as Alice ---
  Successfully logged in as Alice.

--- [STEP 2] Navigate to Calendar View ---
  PASS: Navigated to Calendar View as Alice

--- [STEP 3] Alice creates 'Engineering Roadmap' calendar ---
  PASS: Engineering Roadmap appears in Alice's calendars

--- [STEP 4] Alice shares 'Engineering Roadmap' with Bob (Can view) ---
  PASS: Calendar rows are present
  PASS: Share calendar button is available on owned calendar
  PASS: Share success confirmation visible: "Calendar shared with bob@byos.local"

--- [STEP 5] Alice creates 'Sprint 42 Kickoff' event ---
  PASS: Alice created event on 'Engineering Roadmap'

--- [STEP 6] Bob logs in and checks 'Shared with Me' ---
  Successfully logged in as Bob.
  PASS: 'Shared with Me' section is present in Bob's sidebar
  PASS: Read-only badge displayed on Engineering Roadmap for Bob

--- [STEP 7] Bob inspects event and verifies read-only enforcement ---
  PASS: Bob can see Alice's shared event
  PASS: Read-only notice banner rendered in EventModal for Bob
  PASS: Event title input is disabled for read-only calendar
  PASS: Save button is disabled for read-only calendar
  PASS: Delete button is not rendered for read-only calendar

--- [STEP 8] Alice upgrades Bob's access to 'Can edit' ---
  PASS: Permission upgrade confirmed: "Updated permission for bob@byos.local to Can edit"

--- [STEP 9] Bob creates an event under write access ---
  PASS: Badge updated to 'Can edit' for Bob
  PASS: Save button is enabled for write-shared calendar
  PASS: Bob successfully created event on shared calendar

--- [STEP 10] Alice revokes Bob's share ---
  PASS: Revoke confirmation: "Access revoked for bob@byos.local"
  PASS: Shared calendar disappeared from Bob's sidebar after revocation

--- [STEP 11] Mobile Viewport Responsiveness (375px) ---
  PASS: Mobile 375px viewport has no horizontal overflow: scrollWidth=375px
  PASS: Mobile 375px responsive screenshot captured

================================================================================
     ALL CALENDAR SHARING BROWSER CHECKS PASSED SUCCESSFULLY!                   
================================================================================
```

## Manual browser verification
The automated browser verification script `tests/browser/test_calendar_sharing_browser.mjs` executed the complete multi-user calendar sharing lifecycle:

1. **Step 1 - Alice Login:** Logged into Webmail using authentic user credentials (`alice@byos.local`).
   - Screenshot: `tests/browser/artifacts/calendar_share_alice_view.png`
2. **Step 2 - Calendar Navigation:** Navigated to Calendar View; verified owned calendars render under "My Calendars".
3. **Step 3 - Calendar Creation:** Alice created custom calendar "Engineering Roadmap" with `#2563EB` color tag.
4. **Step 4 - Teammate Share Modal:** Alice opened Share Modal and shared "Engineering Roadmap" with `bob@byos.local` with "Can view" (read-only) permissions.
   - Screenshot: `tests/browser/artifacts/calendar_share_modal_shared.png`
5. **Step 5 - Event Creation:** Alice scheduled "Sprint 42 Kickoff" on "Engineering Roadmap".
6. **Step 6 - Bob Read-Only View:** Bob logged in within an isolated session context. "Engineering Roadmap" appeared under "Shared with Me" with a "Read-only" badge.
   - Screenshot: `tests/browser/artifacts/calendar_share_bob_read_only.png`
7. **Step 7 - Read-Only Modal Enforcement:** Bob opened "Sprint 42 Kickoff". The modal displayed the amber read-only warning notice, title/location inputs were disabled, the Save button was disabled, and the Delete button was suppressed.
   - Screenshot: `tests/browser/artifacts/calendar_share_event_read_only_modal.png`
8. **Step 8 - Permission Upgrade:** Alice upgraded Bob's permission from "Can view" to "Can edit" via the share modal permission dropdown.
   - Screenshot: `tests/browser/artifacts/calendar_share_upgraded_to_write.png`
9. **Step 9 - Bob Write Access & Event Scheduling:** Bob refreshed his view. The permission badge updated to "Can edit". Bob successfully created "Architecture Review by Bob" on the shared calendar with an enabled Save button.
   - Screenshot: `tests/browser/artifacts/calendar_share_bob_created_event.png`
10. **Step 10 - Access Revocation:** Alice revoked Bob's share. After Bob refreshed, "Engineering Roadmap" was immediately removed from Bob's view.
    - Screenshot: `tests/browser/artifacts/calendar_share_revoked.png`
11. **Step 11 - Responsive Mobile Viewport:** Evaluated interface at a 375px mobile viewport (`scrollWidth = 375px`), confirming zero horizontal scrolling and seamless responsive adaptation.
    - Screenshot: `tests/browser/artifacts/calendar_share_mobile_375px.png`

## What did not work or is untested
- **Cross-Organization Sharing:** The server enforces strict organization boundaries and rejects cross-organization shares with `403 Forbidden` (`cannot_share_cross_org`). External federated sharing across disparate BYOS tenant instances is out of scope for Milestone 4 and is UNTESTED.
- **CalDAV Access for Shared Calendars:** CalDAV sharing synchronization protocol endpoints are scheduled for Milestone 6 and remain UNTESTED.

## Test suite output

### Full npm test output (apps/webmail)
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:6092) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=467546a3-f487-44a7-82e5-b295ae181829 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=dd7823f3-6ed8-4ac6-86b6-d555176c1d41 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=f9e5be75-7fd7-4c85-9188-4412a085ef09 chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: active mailbox key is B's after switch, not A's
  ✓ test_switch_preserves_inactive_account_keys: Account A keys remain in store after switch to B
  ✓ test_failed_switch_does_not_mutate_active_account: active account remains A after bad token
  ✓ test_failed_switch_does_not_mutate_active_account: active signing seed remains A's
  ✓ test_concurrent_tab_account_switch: storage event updates activeAccount signal
  ✓ test_concurrent_tab_logout: storage event triggers handleExternalStorageSync
  ✓ test_concurrent_tab_logout: activeAccount is null after external clear
  ✓ test_concurrent_tab_new_login: storage event triggers sync and loads new account
  ✓ test_cross_tab_key_invalidation: key purge in Tab 1 clears Tab 2 in-memory key on next action
  ✓ test_cross_tab_key_invalidation: crypto action throws key_purged error
  ✓ test_storage_event_origin_validation: untrusted origin does NOT trigger clearState
  ✓ test_storage_event_origin_validation: trusted origin triggers clearState
  ✓ test_storage_event_origin_validation: subdomains of trusted origin do NOT trigger clearState
MULTI ACCOUNT TESTS: 45 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 11 passed, 0 failed

Running Path A Compose Tests...
  ✓ compose form elements render properly
  ✓ key lookup caching: 1 network call for 2 sends to same recipient
  ✓ key lookup failure blocks send with clear error
  ✓ encrypts body with X-Wing HPKE
  ✓ signs ciphertext with Ed25519
  ✓ attachment encryption: zero plaintext chunks
  ✓ payload contains correct metadata
  ✓ handles non-ASCII characters in body and subject
PATH A COMPOSE TESTS: 8 passed, 0 failed

Running Path A Read Tests...
  ✓ test_path_a_full_flow: create keys -> send -> read -> verify decrypted body
  ✓ test_path_a_signature_valid: verify valid signature succeeds
  ✓ test_path_a_signature_invalid: tampered ciphertext fails signature verification
  ✓ test_path_a_untrusted_sender: signature valid but key unknown -> trusted=false
  ✓ test_path_a_attachment_decrypt: encrypted attachment decrypts to exact original bytes
  ✓ test_path_a_corrupted_attachment: corrupted chunk marks attachment corrupted
  ✓ test_path_a_missing_key: decryption fails gracefully with error message
  ✓ test_path_a_non_ascii: unicode content round-trips byte-for-byte
PATH A READ TESTS: 8 passed, 0 failed

Running MIME Parser Tests...
MIME PARSER TESTS: 10 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 10 passed, 0 failed

Running Reply Signature Tests...
REPLY SIGNATURE TESTS: 10 passed, 0 failed

Running Mbox Stream Parser Tests...
MBOX STREAM TESTS: 10 passed, 0 failed

Running Mbox Labels Tests...
MBOX LABELS TESTS: 10 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 10 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 10 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 10 passed, 0 failed

Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 10 passed, 0 failed

Running Snooze Tests...
SNOOZE TESTS: 10 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 10 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 10 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 10 passed, 0 failed

Running API Error Tests...
API ERROR TESTS: 10 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 10 passed, 0 failed

Running Masked Email Tests...
MASKED EMAIL TESTS: 10 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 10 passed, 0 failed

Running Offline Store Tests...
OFFLINE STORE TESTS: 10 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 10 passed, 0 failed

Running Contacts Tests...
CONTACTS TESTS: 10 passed, 0 failed

Running Sidebar Borderless Tests...
SIDEBAR BORDERLESS TESTS: 10 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 10 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 10 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 10 passed, 0 failed

Running Calendar RRule Tests...
  ✓ parseRRule: DAILY
  ✓ parseRRule: WEEKLY with BYDAY and INTERVAL
  ✓ parseRRule: MONTHLY with COUNT
  ✓ parseRRule: YEARLY with UNTIL
  ✓ buildRRuleString: simple daily
  ✓ buildRRuleString: weekly with interval and days
  ✓ buildRRuleString: with until date
  ✓ buildRRuleString: with count
  ✓ expandEventOccurrences: daily for 5 days
  ✓ expandEventOccurrences: weekly on specific days
  ✓ expandEventOccurrences: with count limit
  ✓ expandEventOccurrences: with until limit
  ✓ expandEventOccurrences: respects maxOccurrences safety cap
  ✓ formatRecurrenceRule: none
  ✓ formatRecurrenceRule: daily
  ✓ formatRecurrenceRule: weekly
CALENDAR RRULE TESTS: 16 passed, 0 failed

Running Calendar Crypto Tests...
  ✓ encrypt and decrypt roundtrip preserves all event metadata
  ✓ tampered ciphertext fails decryption gracefully with safe placeholder
  ✓ missing mailbox key returns safe placeholder
  ✓ missing mailbox ID fails encryption closed
  ✓ wrong mailbox ID fails decryption closed
  ✓ classifyCalendarPayload identifies AES-GCM envelope
  ✓ classifyCalendarPayload identifies legacy Base64 JSON
  ✓ classifyCalendarPayload identifies unknown or empty payload
  ✓ decryptCalendarEventPayload rejects legacy Base64 plaintext JSON
CALENDAR CRYPTO TESTS: 9 passed, 0 failed

Running Calendar ICS Tests...
  ✓ generateIcs and parseIcs roundtrip preserves single event
  ✓ generateIcs and parseIcs roundtrip preserves recurring event
  ✓ generateIcs with METHOD:REQUEST includes attendees with RSVP
  ✓ generateIcs with METHOD:CANCEL sets status CANCELLED
  ✓ parseIcs: handles multiple events in single VCALENDAR
  ✓ parseIcs: handles invalid / corrupted ICS gracefully
CALENDAR ICS TESTS: 6 passed, 0 failed

Running Calendar Persistence & Security Tests...
  ✓ 1. Valid event encrypts to authenticated AES-GCM envelope with prefix AAD
  ✓ 2. Calendar event AAD matches Section 12 specification
  ✓ 3. Missing mailbox key fails closed before persistence
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

Running Calendar External Invitations Tests...
Running Calendar External Invitations & Fallback Delivery Tests...
  ✓ 1. sendMimeWithFallback: routes to Path A (E2E) for internal recipient
  ✓ 2. sendMimeWithFallback: falls back to Path B for external recipient
  ✓ 3. sendMimeWithFallback: fails closed on local crypto error
  ✓ 4. sendMimeWithFallback: reports failure on Path B server rejection
  ✓ 5. Outbound invitation formatting: compliant RFC 5545 REQUEST
  ✓ 6. Event update sequence increment: SEQUENCE monotonically increments
  ✓ 7. Cancellation dispatch: METHOD:CANCEL with incremented sequence
  ✓ 8. Occurrence cancellation dispatch: includes RECURRENCE-ID
  ✓ 9. Outbound RSVP reply formatting: compliant RFC 5546 REPLY
  ✓ 10. External RSVP dispatch pipeline: routes via Path B to external organizer
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
  ✓ sealCalendarKeyForGrantee seals with HPKE and unseal recovers exact key
  ✓ sealing rejects invalid calendar key length
  ✓ sealing rejects invalid recipient public key
  ✓ unsealing with wrong recipient private key fails closed
  ✓ unsealing tampered envelope fails closed
  ✓ Bob can decrypt Alice's shared calendar events using unsealed calendar key and Alice AAD
  ✓ Read-only calendar permissions enforce creation and modification guards
CALENDAR SHARING TESTS: 7 passed, 0 failed

OVERALL: 404 passed, 0 failed
```
