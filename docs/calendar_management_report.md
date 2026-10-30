# Calendar Management (Category 02) Report

## What was built
Implemented Category 02 (Calendar Management) of the BYOS Calendar Roadmap adhering strictly to Section 4.2 and Section 5 sequence 2. The solution provides full lifecycle management for owned calendars (creation with templates including Personal, Family, Team, and Project; renaming; custom color palettes; descriptions; default calendar designation; and safe deletion with irreversible confirmation dialogs) alongside distinct isolation for shared/subscribed calendars ("Other Calendars") displaying owner email, permissions ("Can edit" / "Read-only"), and non-destructive unsubscription. Calendar visibility toggling operates without data loss, per-calendar default reminder overrides are persisted under mailbox-scoped storage, and all controls scale down to a 375px mobile viewport with zero horizontal scrolling.

## Files edited
| File | Reason |
|------|--------|
| apps/webmail/src/components/calendar/CalendarModal.tsx | Added template pills, description input, reminder override select, shared calendar ownership info, and safe delete/unsubscribe confirmation dialogs. |
| apps/webmail/src/components/calendar/CalendarSidebar.tsx | Separated owned calendars ("My Calendars") and shared calendars ("Other Calendars") with owner attribution, access badges, settings buttons, and unsubscribe actions. |
| apps/webmail/src/components/calendar/CalendarToolbar.tsx | Added data-testid to mobile sidebar drawer toggle button for responsive drawer control. |
| apps/webmail/src/components/calendar/CalendarView.tsx | Connected calendar metadata persistence to overrides storage, wired safe unsubscription via revokeCalendarShare, and passed handlers to sidebar and modals. |
| apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts | Expanded CalendarOverrides interface with description and template properties for per-calendar metadata persistence. |
| apps/webmail/src/calendar_management.test.ts | Created Category 02 unit test suite covering template pre-fills, overrides persistence, reminder precedence, owned/shared separation, and safe deletion. |
| apps/webmail/src/run_test.node.js | Registered Category 02 calendar management test suite in the central test runner. |
| tests/browser/test_calendar_management.mjs | Created end-to-end browser test script testing real login, calendar templates, creation, event association, visibility toggling, safe deletion modal, and 375px mobile viewport. |

## Raw evidence
Below is the raw terminal output from the build check:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 166 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                    1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-DcQDxIOt.css                   112.22 kB │ gzip:  17.73 kB
dist/assets/highlight-CFsI1eMM.js                 73.46 kB │ gzip:  23.49 kB
dist/assets/index-B_Wv6KWR.js                  1,048.49 kB │ gzip: 257.62 kB
✓ built in 7.90s
```

Below is the raw terminal output from the Category 02 unit test suite execution:
```
Starting Calendar Management (Category 02) Tests...
  ✓ 1. Calendar templates definition and pre-fills
  ✓ 2. Calendar overrides save and load lifecycle
  ✓ 3. Multi-level reminder resolution precedence (Global < Calendar < Event)
  ✓ 4. Owned vs shared calendar separation and identification
  ✓ 5. Safe calendar deletion constraints and permissions
  ✓ 6. Unsubscribe action targets share grant without destroying source calendar
CALENDAR MANAGEMENT TESTS: 6 passed, 0 failed
```

Below is the raw terminal output confirming that generated browser verification screenshots exist:
```
    Directory: F:\Codex\byos-email\tests\browser\artifacts

Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
-a----        10/26/2026   1:08 AM          44405 calendar_management_created_calendar.png
-a----        10/26/2026   1:08 AM          48915 calendar_management_event_in_calendar.png
-a----        10/26/2026   1:08 AM          30797 calendar_management_mobile_375px.png
```

## Manual browser verification
Browser verification executed end-to-end against the running system using `node tests/browser/test_calendar_management.mjs`.

Raw output from browser verification:
```
================================================================================
   BYOS CALENDAR MANAGEMENT (CATEGORY 02) BROWSER VERIFICATION                  
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---

--- [STEP 2] Real Login Flow for alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: User successfully authenticated as alice@byos.local

--- [STEP 3] Switch to Calendar Module ---
  PASS: Calendar workspace is active

--- [STEP 4] Verify 'My Calendars' in Sidebar ---
  Initial calendar count in sidebar: 3
  PASS: At least one initial calendar exists

--- [STEP 5] Open Create Calendar Modal ---
  PASS: Create Calendar modal opened

--- [STEP 6] Test Template Selection & Pre-fills ---
  Template pre-filled name: "Team"
  PASS: Template pre-filled name correctly
  Template pre-filled description: "Team syncs, work meetings, office hours, and project milestones"
  PASS: Template pre-filled description correctly

--- [STEP 7] Customize Calendar Name, Color, Description & Reminders ---

--- [STEP 8] Assert New Calendar appears in Sidebar ---
  Found calendars: ["Personal","Engineering Projects","Sprint Delivery & QA","Sprint Delivery & QA 9096"]
  PASS: New calendar 'Sprint Delivery & QA 9096' successfully created and listed in sidebar
  Screenshot saved to: F:\Codex\byos-email\tests\browser\artifacts\calendar_management_created_calendar.png

--- [STEP 9] Create Event in the New Calendar ---
  Found calendar option value: 7dae9e61-c9fb-4618-aaac-01fd0ffda876
  PASS: Calendar 'Sprint Delivery & QA 9096' is selectable for new events

--- [STEP 10] Verify Event Renders in Calendar ---
  Found event cards: ["Sprint Planning & Release Demo1:08 AM - 2:08 AM"]
  PASS: Created event renders in calendar view
  Screenshot saved to: F:\Codex\byos-email\tests\browser\artifacts\calendar_management_event_in_calendar.png

--- [STEP 11] Toggle Calendar Visibility (Hide & Show) ---
  PASS: Toggling visibility off hides events from calendar view
  PASS: Toggling visibility back on restores events without data loss

--- [STEP 12] Safe Calendar Deletion Modal & Protection ---
  PASS: Safe delete confirmation dialog appeared with irreversible warning
  PASS: Safe confirmation modal dismissed cleanly on cancel

--- [STEP 13] Responsive Viewport Verification (375px) ---
  PASS: 375px mobile viewport has zero horizontal scrollbar
  Screenshot saved to: F:\Codex\byos-email\tests\browser\artifacts\calendar_management_mobile_375px.png

--- [STEP 14] Safe Calendar Cleanup ---
  PASS: Calendar 'Sprint Delivery & QA 9096' successfully and safely deleted after verification

================================================================================
   CATEGORY 02 BROWSER VERIFICATION COMPLETED SUCCESSFULLY                      
================================================================================
```

Screenshots saved to repository:
- `tests/browser/artifacts/calendar_management_created_calendar.png`: Captures creation of the new template-backed calendar in "My Calendars" with custom Terracotta color swatch.
- `tests/browser/artifacts/calendar_management_event_in_calendar.png`: Captures event rendering scheduled inside the newly created calendar.
- `tests/browser/artifacts/calendar_management_mobile_375px.png`: Captures 375px mobile viewport with sidebar drawer showing responsive calendar management without horizontal overflow.

## What did not work or is untested
- Live server-to-server CalDAV client synchronization for third-party desktop clients (Apple Calendar, Thunderbird) is scheduled under Category 14 (Import, Export, and Synchronization) and is UNTESTED in this task. To verify manually, configure a CalDAV client pointing to `/v1/caldav/` using HTTP Basic credentials.

## Test suite output
### Webmail Node Test Suite (npm test)
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:18044) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=656a56f6-5319-467b-a586-62549e972676 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=5ca1a075-1f22-45f7-9ded-214706bec523 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=bef742e5-b4f3-494c-9806-0e6d7eb3d695 chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: target account is promoted to front
  ✓ test_switch_preserves_unrelated_keys: Account A keys still in store after switch
  ✓ test_recovery_phrase_validation: valid 24-word phrase succeeds
  ✓ test_recovery_phrase_validation: 23-word phrase fails
  ✓ test_recovery_phrase_validation: invalid word fails
  ✓ test_recovery_phrase_validation: empty phrase fails
  ✓ test_cross_tab_storage_sync: storage event with different generation marker prompts sync
  ✓ test_cross_tab_storage_sync: same generation marker does not trigger sync
  ✓ test_cross_tab_storage_sync: corrupted accounts JSON fails safely
  ✓ test_cross_tab_storage_sync: null accounts triggers logout
MULTI-ACCOUNT & STORAGE SYNC TESTS: 42 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 5 passed, 0 failed

Running Path A Compose Tests...
PATH A COMPOSE TESTS: 12 passed, 0 failed

Running Path A Read Tests...
PATH A READ TESTS: 11 passed, 0 failed

Running MIME Parsing Tests...
MIME TESTS: 13 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 11 passed, 0 failed

Running Reply Signature Placement Tests...
REPLY SIGNATURE TESTS: 7 passed, 0 failed

Running Mbox Streaming Parser Tests...
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
SNOOZE TESTS: 8 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 8 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 10 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 8 passed, 0 failed

Running API Error Tests...
API ERROR TESTS: 10 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 8 passed, 0 failed

Running Masked Email Tests...
MASKED EMAIL TESTS: 8 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 10 passed, 0 failed

Running Offline Storage & Queue Tests...
OFFLINE STORAGE & QUEUE TESTS: 10 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 10 passed, 0 failed

Running Contacts Tests...
CONTACTS TESTS: 10 passed, 0 failed

Running Sidebar Borderless Style Tests...
SIDEBAR BORDERLESS TESTS: 10 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 10 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 10 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 10 passed, 0 failed

Running Calendar Recurrence (RRULE) Tests...
CALENDAR RRULE TESTS: 12 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 10 passed, 0 failed

Running Calendar ICS & Invitation Tests...
CALENDAR ICS TESTS: 12 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
Running Calendar Persistence Security Tests...
  ✓ 1. Valid event payload is encrypted before any network call
  ✓ 2. CalendarEventItem payload matches version 1 contract
  ✓ 3. Missing or null mailboxKey rejects creation before persistence
[CalendarView] Event encryption failed: Error: Mailbox key must be 32 bytes
    at encryptCalendarEventPayload (file:///F:/Codex/byos-email/apps/webmail/src/calendar_crypto.ts:263:34)
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
  ✓ 13. End-to-end multi-phase reactivation workflow succeeds
  ✓ 14. Server reject during finalize triggers rollback and aborts before finalization
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

Running Calendar Settings Tests...
  ✓ 1. Registry specifies exactly the 10 sections from Section 4.1
  ✓ 2. Every setting in registry belongs to a valid section and has valid scope
  ✓ 3. Search/filtering finds settings by label, description, and keywords
  ✓ 4. loadCalendarSettings returns default values when storage is empty
  ✓ 5. saveCalendarSettings and loadCalendarSettings persist and restore preferences
  ✓ 6. Three-level configuration scope separation: global vs calendar vs event
  ✓ 7. World clock cities configuration can be modified and restored
CALENDAR SETTINGS TESTS: 7 passed, 0 failed

Running Calendar Management Tests...
Starting Calendar Management (Category 02) Tests...
  ✓ 1. Calendar templates definition and pre-fills
  ✓ 2. Calendar overrides save and load lifecycle
  ✓ 3. Multi-level reminder resolution precedence (Global < Calendar < Event)
  ✓ 4. Owned vs shared calendar separation and identification
  ✓ 5. Safe calendar deletion constraints and permissions
  ✓ 6. Unsubscribe action targets share grant without destroying source calendar
CALENDAR MANAGEMENT TESTS: 6 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 422 passed, 0 failed
```

### Go API Test Suite (go test ./...)
```
=== RUN   TestValidateCustomLocalPartUnit
--- PASS: TestValidateCustomLocalPartUnit (0.00s)
=== RUN   TestValidateTestDSNSafeguards
--- PASS: TestValidateTestDSNSafeguards (0.00s)
=== RUN   TestDeriveRejectsHugeArgon2Params
--- PASS: TestDeriveRejectsHugeArgon2Params (0.00s)
=== RUN   TestStorageHealthInterval
--- PASS: TestStorageHealthInterval (0.00s)
=== RUN   TestTestEncryptedStorage
--- PASS: TestTestEncryptedStorage (0.00s)
=== RUN   TestTestEncryptedStorageRejectsMissingInput
--- PASS: TestTestEncryptedStorageRejectsMissingInput (0.00s)
=== RUN   TestNormalizeMsgID
--- PASS: TestNormalizeMsgID (0.00s)
PASS
ok  	byos.email/services/api	3.443s
```
