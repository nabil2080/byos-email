# Holiday and Religious Calendars Report

## What was built
Implemented Category 03 (Holiday and Religious Calendars) of the BYOS Calendar Roadmap adhering strictly to Section 5, Section 6 Sequence 4, and zero-knowledge cryptographic invariants. A modular holiday catalogue framework was built featuring regional national feeds (with Bangladesh prioritized, alongside the United States and the United Kingdom) and world religious traditions (Islam, Christianity, Hinduism, Buddhism, Judaism). Events are classified with honest date typing (`fixed`, `calculated`, and `provisional`), highlighting crescent moon-sighting notices and regional observance notes. A responsive two-pane explorer modal (`HolidayCatalogueModal`) allows users to preview feeds with official provider attributions, toggle observances, customize feed colors, and manage subscriptions with duplicate prevention. Subscriptions project into read-only `UserCalendar` interfaces and generate ephemeral read-only `DecryptedEventRecord` items that render across month/week/day views without exposing plaintext private user events or bypassing calendar permissions.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/calendar/holidays/holidayCatalogue.ts` | Defined holiday catalogue types, regional feeds (Bangladesh focus, US, UK), religious traditions (Islam, Christianity, Hinduism, Buddhism, Judaism), honest date classifications, provider attribution, and moon-sighting notices |
| `apps/webmail/src/components/calendar/holidays/holidaySubscriptionStore.ts` | Implemented local subscription store with deduplication, color/observance updates, visibility toggling, individual entry hiding/restoration, and read-only projection into UserCalendar and DecryptedEventRecord |
| `apps/webmail/src/components/calendar/holidays/HolidayCatalogueModal.tsx` | Created two-pane holiday exploration modal with regional/religious tabs, search query filtering, feed previews, provider attributions, moon-sighting notices, color picker, and subscription management |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Added Explore button to Other Calendars header, empty state browse trigger, holiday calendar badge, and visibility/settings triggers |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Added read-only holiday banner with honest date badges, provider attribution, provisional/regional notes, and read-only enforcement disabling edits/deletes |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Integrated holiday subscriptions into allCalendars memo, merged holiday decrypted records into event stream, wired holiday modal, and fixed visibility toggle race conditions |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Added data-is-holiday and data-event-title attributes to calendar event pills for unambiguous inspection |
| `apps/webmail/src/calendar_holidays.test.ts` | Created unit test suite verifying catalogue completeness, Bangladesh priority focus, date type honesty, subscription store operations, deduplication, and read-only projection |
| `apps/webmail/src/run_test.node.js` | Registered runCalendarHolidayTests in root test runner suite |
| `tests/browser/test_calendar_holidays.mjs` | Created browser integration test verifying login, modal exploration, Bangladesh & Islam subscriptions, sidebar rendering, grid rendering, read-only modal enforcement, visibility toggle, 375px mobile responsiveness, and clean unsubscribe |

## Raw evidence

### 1. Webmail Build
Command: `npm.cmd --prefix apps/webmail run build`
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 169 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                    1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-D_5RH-K0.css                   113.84 kB │ gzip:  17.90 kB
dist/assets/highlight-CFsI1eMM.js                 73.46 kB │ gzip:  23.49 kB
dist/assets/index-DcIowCjT.js                  1,096.09 kB │ gzip: 270.06 kB
✓ built in 3.83s
```

### 2. Unit Test Suite Execution
Command: `npm.cmd --prefix apps/webmail test`
```
Starting Holiday and Religious Calendars (Category 03) Tests...
  ✓ 1. Holiday feeds catalogue completeness & categorisation
  ✓ 2. Bangladesh national holidays and regional observances focus
  ✓ 3. Religious honesty: provisional moon-sighting vs fixed vs calculated dates
  ✓ 4. Subscription store: subscribe, deduplication, color, visibility, hide/restore
  ✓ 5. Projection to UserCalendar & DecryptedEventRecord generation
CALENDAR HOLIDAY & RELIGIOUS TESTS: 5 passed, 0 failed

OVERALL: 427 passed, 0 failed
```

### 3. Backend Service Test Suite Execution
Command: `go test ./...`
```
ok  	byos.email/crypto/core	(cached)
ok  	byos.email/crypto/envelope	(cached)
ok  	byos.email/crypto/hpke	0.647s
?   	byos.email/scratch	[no test files]
```

## Manual browser verification
Executed automated real-browser integration test suite (`tests/browser/test_calendar_holidays.mjs`) against Chrome (headless).

Command: `node tests/browser/test_calendar_holidays.mjs`
Output:
```
================================================================================
   BYOS HOLIDAY & RELIGIOUS CALENDARS (CATEGORY 03) BROWSER VERIFICATION       
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---

--- [STEP 2] Real Login Flow for alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: User authenticated as alice@byos.local

--- [STEP 3] Switch to Calendar Module ---
  PASS: Calendar workspace active

--- [STEP 4] Open Holiday & Religious Catalogue Modal ---
  PASS: Holiday catalogue modal rendered

--- [STEP 5] Verify Regional Catalogue & Bangladesh Priority Feed ---
  Selected feed title: "Bangladesh Holidays"
  PASS: Bangladesh Holidays is loaded in preview
  Provider attribution: "Ministry of Public Administration, Government of the People's Republic of Bangladesh"
  PASS: Official government provider attribution present
  PASS: Fixed date type badges present for national holidays
  Saved screenshot: calendar_holidays_catalogue_regional.png

--- [STEP 6] Subscribe to Bangladesh Holidays ---
  Action feedback: "Subscribed to Bangladesh Holidays!"
  PASS: Subscription confirmation received
  PASS: Save Preferences button visible after subscribing
  PASS: Unsubscribe button visible after subscribing

--- [STEP 7] Switch to Religious Traditions Catalogue (Islam Feed) ---
  Selected religious feed: "Islamic Holidays (Hijri 1447–1448)"
  PASS: Islamic Holidays loaded in preview
  PASS: Astronomical & moon-sighting disclaimer banner rendered
  PASS: Provisional moon-sighting badges rendered honestly
  Saved screenshot: calendar_holidays_catalogue_religious.png

--- [STEP 8] Subscribe to Islamic Holidays ---
  Action feedback: "Subscribed to Islamic Holidays (Hijri 1447–1448)!"
  PASS: Islamic subscription confirmed

--- [STEP 9] Close Modal & Verify Subscribed Feeds in Sidebar ---
  PASS: Modal closed successfully
  Holiday calendar badges in sidebar: 2
  PASS: Both Bangladesh and Islamic feeds appear under Other Calendars
  Saved screenshot: calendar_holidays_sidebar_subscribed.png

--- [STEP 10] View Holiday Events on Calendar Grid ---
  Found 1 holiday event pills on the visible calendar month
  PASS: Holiday event pills rendered on month calendar grid

--- [STEP 11] Inspect Read-Only Holiday EventModal ---
  Inspecting holiday event: "Armed Forces Day"
  PASS: EventModal opened for holiday event
  PASS: Read-only holiday detail banner displayed
  PASS: Save button is disabled for read-only holiday events
  PASS: Delete button is not rendered for read-only holiday events
  Saved screenshot: calendar_holidays_event_detail_modal.png

--- [STEP 12] Toggle Holiday Calendar Visibility ---
  Visible holiday event pills before toggle: 1
  PASS: Visibility checkboxes available for shared calendars
  Visible holiday event pills after unchecking one feed: 0
  Visible holiday event pills after re-checking: 1
  PASS: All holiday event pills restored after re-checking visibility
  Saved screenshot: calendar_holidays_visibility_toggled.png

--- [STEP 13] 375px Mobile Viewport & Responsiveness Check ---
  Horizontal overflow on 375px viewport: NO
  PASS: Zero horizontal scroll on 375px mobile viewport
  Mobile drawer holiday calendar badges: 4
  PASS: Holiday feeds accessible in mobile drawer
  Saved screenshot: calendar_holidays_mobile_responsive.png

--- [STEP 14] Safe Cleanup (Unsubscribe from test feeds) ---
  Remaining holiday badges after cleanup: 0
  PASS: All holiday feeds safely unsubscribed
  Saved screenshot: calendar_holidays_cleaned_up.png

--- [STEP 15] Error & DevTools Storage Verification ---
  PASS: Zero uncaught page errors (found: 0)
  LocalStorage holiday entries after test: [{"key":"byos_calendar_holiday_subs_c0000000-0000-0000-0000-000000000001","val":"[]"}]

================================================================================
   ALL BROWSER VERIFICATION CHECKS PASSED SUCCESSFULLY                         
================================================================================
```

Screenshots saved to repository:
- `tests/browser/artifacts/calendar_holidays_catalogue_regional.png`
- `tests/browser/artifacts/calendar_holidays_catalogue_religious.png`
- `tests/browser/artifacts/calendar_holidays_sidebar_subscribed.png`
- `tests/browser/artifacts/calendar_holidays_event_detail_modal.png`
- `tests/browser/artifacts/calendar_holidays_visibility_toggled.png`
- `tests/browser/artifacts/calendar_holidays_mobile_responsive.png`
- `tests/browser/artifacts/calendar_holidays_cleaned_up.png`

## What did not work or is untested
- Live HTTP fetching from external third-party CalDAV feeds over the network: UNTESTED. The catalogue uses verified local provider schemas to guarantee zero-knowledge offline operation and prevent outbound network leaks.
- Moon-sighting committee real-time push notification updates: UNTESTED. Dates are currently statically classified as provisional with clear explanatory notices.

## Test file changes
`apps/webmail/src/run_test.node.js` diff:
```diff
--- a/apps/webmail/src/run_test.node.js
+++ b/apps/webmail/src/run_test.node.js
@@ -43,4 +43,5 @@ import { runCalendarSharingTests } from "./calendar_sharing.test.js";
 import { runCalendarSettingsTests } from "./calendar_settings.test.js";
 import { runCalendarManagementTests } from "./calendar_management.test.js";
+import { runCalendarHolidayTests } from "./calendar_holidays.test.js";
 import { runUnlockAnd2FAPersistenceTests } from "./unlock_and_2fa_persistence.test.js";

@@ -309,4 +310,10 @@ async function main() {
   totalPassed += calendarMgmtRes.passed;
   totalFailed += calendarMgmtRes.failed;

+  console.log("Running Calendar Holiday & Religious Tests...");
+  const calendarHolidaysRes = await runCalendarHolidayTests();
+  console.log(`CALENDAR HOLIDAY & RELIGIOUS TESTS: ${calendarHolidaysRes.passed} passed, ${calendarHolidaysRes.failed} failed\n`);
+  totalPassed += calendarHolidaysRes.passed;
+  totalFailed += calendarHolidaysRes.failed;
+
   const unlock2faRes = await runUnlockAnd2FAPersistenceTests();
```

## Test suite output
Full paste of `npm.cmd --prefix apps/webmail test`:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:5352) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
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
  ✓ test_switch_loads_target_account_keys: active account index updated
  ✓ test_switch_updates_active_index: active index updated from 0 to 1
  ✓ test_sync_account_metadata_idempotent: does not duplicate existing account
  ✓ test_sync_account_metadata_idempotent: updates display name without adding new account
MULTI-ACCOUNT & STORAGE SYNC TESTS: 36 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 5 passed, 0 failed

Running Path A Compose Crypto Tests...
PATH A COMPOSE TESTS: 17 passed, 0 failed

Running Path A Read Decryption Tests...
PATH A READ TESTS: 12 passed, 0 failed

Running MIME Structure Tests...
MIME STRUCTURE TESTS: 9 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 8 passed, 0 failed

Running Reply Signature Placement Tests...
REPLY SIGNATURE TESTS: 5 passed, 0 failed

Running Mbox Streaming Parser Tests...
MBOX STREAMING TESTS: 11 passed, 0 failed

Running Mbox Labels Tests...
MBOX LABELS TESTS: 6 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 8 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 7 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 6 passed, 0 failed

Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 24 passed, 0 failed

Running Snooze Logic Tests...
SNOOZE LOGIC TESTS: 11 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 8 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 12 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 13 passed, 0 failed

Running API Error Tests...
API ERROR TESTS: 10 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 7 passed, 0 failed

Running Masked Email Generator Tests...
MASKED EMAIL TESTS: 8 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 12 passed, 0 failed

Running Offline Sync & Queue Tests...
OFFLINE SYNC & QUEUE TESTS: 14 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 11 passed, 0 failed

Running Contacts Autocomplete Tests...
CONTACTS AUTOCOMPLETE TESTS: 8 passed, 0 failed

Running Sidebar Borderless Tests...
SIDEBAR BORDERLESS TESTS: 11 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 9 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 14 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 7 passed, 0 failed

Running Calendar Recurrence (RRULE) Tests...
  ✓ RFC 5545 daily expansion
  ✓ RFC 5545 weekly expansion with BYDAY filter
  ✓ RFC 5545 monthly expansion with interval
  ✓ RFC 5545 expansion with UNTIL constraint
  ✓ RFC 5545 expansion with COUNT constraint
  ✓ Occurrence identification preserves base event ID
  ✓ Occurrence window filter correctly clamps output range
  ✓ Max limit avoids infinite loop on open-ended rule
  ✓ Single instance parsing returns exact event time
  ✓ parseRrule handles frequency and interval
  ✓ parseRrule handles until date
  ✓ parseRrule handles count limit
  ✓ parseRrule handles byday array
  ✓ formatRrule serializes back to RFC 5545 string
  ✓ formatRrule round-trips with parseRrule
CALENDAR RRULE TESTS: 15 passed, 0 failed

Running Calendar Crypto Tests...
  ✓ Event payload encrypts to valid versioned envelope
  ✓ Encrypted envelope decrypts to exact original payload
  ✓ Wrong mailbox key fails decryption safely
  ✓ Wrong mailbox ID AAD fails decryption safely
  ✓ Tampered ciphertext envelope fails decryption safely
  ✓ Payload with all optional fields roundtrips cleanly
  ✓ Payload with minimum fields roundtrips cleanly
  ✓ Unsupported envelope version fails closed
CALENDAR CRYPTO TESTS: 8 passed, 0 failed

Running Calendar ICS & Invitation Tests...
  ✓ Serializes standard VEVENT RFC 5545 ICS
  ✓ Serializes recurring VEVENT with RRULE
  ✓ Serializes VCALENDAR invitation with attendees and organizer
  ✓ Parses standard single-event RFC 5545 ICS
  ✓ Parses recurring event RFC 5545 ICS with RRULE
  ✓ Round-trip serialize and parse preserves event data
  ✓ Parses attendee list and RSVP status
  ✓ Rejects malformed ICS string safely
  ✓ Formats iCalendar UTC date-time string
  ✓ Parses iCalendar UTC date-time string
CALENDAR ICS TESTS: 10 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
  ✓ 1. createDraft preserves explicit attachments when inserting iCalendar
  ✓ 2. createDraft generates RFC 5545 REQUEST invitation with attendees
  ✓ 3. parseEmailAttachments extracts text/calendar MIME parts
  ✓ 4. parseEmailAttachments returns null for non-invitation emails
  ✓ 5. RSVP reply draft targets organizer with PARTSTAT=ACCEPTED
  ✓ 6. RSVP reply draft targets organizer with PARTSTAT=DECLINED
  ✓ 7. RSVP reply draft targets organizer with PARTSTAT=TENTATIVE
  ✓ 8. Cancel invitation draft produces METHOD:CANCEL VCALENDAR
  ✓ 9. Invitation draft generation rejects empty or missing organizer
  ✓ 10. parseEmailAttachments ignores malformed ICS without crashing
CALENDAR PERSISTENCE SECURITY TESTS: 7 passed, 0 failed
CALENDAR REPO INTEGRATION TESTS: 10 passed, 0 failed

Running Calendar Persistence Security Tests...
  ✓ Event plaintext is not stored in plaintext anywhere in payload
  ✓ Event envelope includes standard auth tag and ciphertext
  ✓ Encryption keys are never embedded in ciphertext envelopes
  ✓ Decrypting with wrong key throws DecryptionError
  ✓ Local calendar store persists and loads encrypted cache without leaking plaintext
  ✓ Locked mailbox cannot decrypt cached calendar events
  ✓ Search indexing does not write decrypted titles to unencrypted storage

Running Historical Key Reactivation Tests...
  ✓ 1. Preflight with correct historical password and valid new password succeeds
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
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed

Running Calendar Recovery Tests...
  ✓ parseCalendarEventRecoveryCandidate: valid envelope passes structural validation
  ✓ parseCalendarEventRecoveryCandidate: missing or unparseable payload fails closed
  ✓ parseCalendarEventRecoveryCandidate: invalid key length fails closed
  ✓ validateMailboxKeyProvenance: missing key or pk fails closed
  ✓ findLegacyCalendarEvents: separates legacy plaintext JSON from encrypted envelopes
  ✓ executeLegacyCalendarEventRecovery: successful 4-phase recoverable workflow
  ✓ executeLegacyCalendarEventRecovery: read-back verification mismatch triggers rollback
  ✓ executeLegacyCalendarEventRecovery: read-back decryption failure triggers rollback
  ✓ executeLegacyCalendarEventRecovery: stage 412 Precondition Failed aborts cleanly without rollback
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
  ✓ 1. Modifying a single occurrence creates encrypted detached exception without altering parent series
  ✓ 2. Cancelling an occurrence creates a cancellation exception and suppresses it from recurrence expansion
  ✓ 3. Deleting the parent series cascades to delete all detached exceptions
  ✓ 4. Locked mailbox fails closed and rejects exception creation before persistence
  ✓ 5. RFC 5545 iCalendar export and import preserves series and detached exception linkage
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

Running Calendar External Invitations Tests...
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
  ✓ 1. Calendar templates definition and pre-fills
  ✓ 2. Calendar overrides save and load lifecycle
  ✓ 3. Multi-level reminder resolution precedence (Global < Calendar < Event)
  ✓ 4. Owned vs shared calendar separation and identification
  ✓ 5. Safe calendar deletion constraints and permissions
  ✓ 6. Unsubscribe action targets share grant without destroying source calendar
CALENDAR MANAGEMENT TESTS: 6 passed, 0 failed

Running Calendar Holiday & Religious Tests...
Starting Holiday and Religious Calendars (Category 03) Tests...
  ✓ 1. Holiday feeds catalogue completeness & categorisation
  ✓ 2. Bangladesh national holidays and regional observances focus
  ✓ 3. Religious honesty: provisional moon-sighting vs fixed vs calculated dates
  ✓ 4. Subscription store: subscribe, deduplication, color, visibility, hide/restore
  ✓ 5. Projection to UserCalendar & DecryptedEventRecord generation
CALENDAR HOLIDAY & RELIGIOUS TESTS: 5 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 427 passed, 0 failed
```
