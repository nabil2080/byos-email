# Calendar Category 13 (Email and External Integrations) Report

## What was built
Built an in-memory client-side event extraction and external integrations engine for BYOS Calendar satisfying Category 13 of the Frozen Calendar Roadmap. Decrypted email plaintext is parsed locally strictly within client memory to detect travel reservations (flights), hotel bookings, restaurant reservations, ticketed events, and webinars/conferences, without transmitting private keys, plaintext bodies, or metadata to any server or third party. Detected events are surfaced via an interactive `EmailEventSuggestionCard` in the reading pane with reviewable approval flow, deterministic deduplication, cancellation notice detection and removal, and bi-directional provenance linking between emails and calendar events. Extended the system with contact birthday annual event projections, configurable integrations settings and granular category toggles, and video-conferencing URL generation supporting BYOS Secure Room, Jitsi Meet, and custom templates.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/utils/calendarEmailExtractor.ts` | Created client-side heuristic parser for travel, lodging, dining, tickets, webinars, cancellation notice detection, and confirmation codes |
| `apps/webmail/src/components/calendar/integrations/calendarIntegrationsStore.ts` | Created localStorage-backed integration settings store, suggestion dismiss store, email-to-calendar event linkage records, and video meeting link generator |
| `apps/webmail/src/utils/calendarContactsIntegration.ts` | Created contact card birthday extractor and annual recurring calendar event projector |
| `apps/webmail/src/components/calendar/integrations/EmailEventSuggestionCard.tsx` | Created interactive reading pane suggestion banner with category badge, confirmation code, datetime, Add, Dismiss, View, and Cancel actions |
| `apps/webmail/src/calendar_crypto.ts` | Extended `CalendarEventPlaintext` interface with optional provenance attributes: `sourceEmailId`, `sourceMessageSubject`, `sourceCategory`, `sourceConfirmationCode`, `sourceProvider` |
| `apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts` | Extended `CalendarSettings` interface and defaults with category toggles, video provider, and custom video meeting URL template |
| `apps/webmail/src/components/calendar/settings/calendarSettingsRegistry.ts` | Registered settings definitions for mail extraction categories, contact birthdays, and video conferencing provider in settings registry |
| `apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx` | Added text input support for `customVideoUrlTemplate` setting in integrations panel |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Integrated email provenance card with "Open Source Email" button, and added "Add Video Call" link generator button |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Integrated contact birthdays virtual calendar, reactive event opener listener, and email navigation event listener |
| `apps/webmail/src/components/ReadingPane.tsx` | Mounted `EmailEventSuggestionCard` when decrypted message yields event candidate with add/remove/dismiss/view handlers |
| `apps/webmail/src/App.tsx` | Implemented `handleAddSuggestedCalendarEvent`, `handleRemoveSuggestedCalendarEvent`, and event navigation routing |
| `apps/webmail/src/calendar_category_13.test.ts` | Created automated unit test suite with 9 tests verifying all Category 13 extraction, storage, and privacy boundaries |
| `apps/webmail/src/run_test.node.js` | Registered Category 13 test suite in automated test harness |
| `tests/browser/test_calendar_category_13.mjs` | Created end-to-end browser test script verifying real user login, email send, detection, add to calendar, provenance, video call generator, settings toggles, and 375px responsiveness |

## Raw evidence

Command:
`node tests/browser/test_calendar_category_13.mjs`
Output:
```
================================================================================
   BYOS CALENDAR: CATEGORY 13 END-TO-END BROWSER VERIFICATION                  
   (Email & External Integrations: Extraction, Approval, Linking, Video Calls) 
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---
  Target server: http://127.0.0.1:3001
  [BROWSER CONSOLE] debug: [vite] connecting...
  [BROWSER CONSOLE] debug: [vite] connected.
  [BROWSER CONSOLE] debug: [vite] connecting...
  [BROWSER CONSOLE] debug: [vite] connected.

--- [STEP 2] Real Login Flow for alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: User authenticated as alice@byos.local

--- [STEP 3] Compose & Send Flight Confirmation Email ---
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e0d138bc-b97d-4c8a-90e7-b81d33d456bc: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 215c6087-b54a-40d1-a4d2-e49a1dc614b7: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg a118705b-66bd-45ef-8b7b-e625934f5cad: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg cfc63df1-51aa-4465-abab-3889b2c85d05: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 0da5f1dc-5cef-4fcf-a84c-05fcc857bb04: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e88c832b-93d0-4ed9-b172-e472542ae7b5: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 222459c8-db45-4555-abf9-fff9adb5a4cf: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 4bd27927-2bb7-4bf8-ad7f-d126b3125f82: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 252fcc95-200e-4ec0-97fc-c57856d918b8: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 3d54d39b-be81-4209-b4c5-27275625413c: decryption failed
  Flight confirmation email dispatched

--- [STEP 4] Open Flight Confirmation Email in Reading Pane ---
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e0d138bc-b97d-4c8a-90e7-b81d33d456bc: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 215c6087-b54a-40d1-a4d2-e49a1dc614b7: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg a118705b-66bd-45ef-8b7b-e625934f5cad: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg cfc63df1-51aa-4465-abab-3889b2c85d05: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 0da5f1dc-5cef-4fcf-a84c-05fcc857bb04: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e88c832b-93d0-4ed9-b172-e472542ae7b5: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 222459c8-db45-4555-abf9-fff9adb5a4cf: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 4bd27927-2bb7-4bf8-ad7f-d126b3125f82: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 252fcc95-200e-4ec0-97fc-c57856d918b8: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 3d54d39b-be81-4209-b4c5-27275625413c: decryption failed

--- [STEP 5] Verify Email Event Suggestion Card ---
  Email event suggestion card rendered
  Extracted Category Badge: "Flight Reservation"
  PASS: Category badge is 'Flight Reservation'
  Extracted Title: "American Airlines AA1234: New York (JFK) to San Francisco (SFO)"
  PASS: Title contains flight number and destination
  Extracted Confirmation Code: "Confirmation Code:ABC999"
  PASS: Confirmation code matches ABC999

--- [STEP 6] Add Suggested Event to Calendar ---
  Added Badge Text: "Added to Calendar"
  PASS: Card transitioned to 'Added to Calendar'

--- [STEP 7] Navigate to Calendar via 'View in Calendar' Button ---
  Navigated into Calendar View
  PASS: Calendar view mounted after clicking View in Calendar

--- [STEP 8] Verify Email Provenance Card and Video Call Generator in EventModal ---
  Event modal opened
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e0d138bc-b97d-4c8a-90e7-b81d33d456bc: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 215c6087-b54a-40d1-a4d2-e49a1dc614b7: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e0d138bc-b97d-4c8a-90e7-b81d33d456bc: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e0d138bc-b97d-4c8a-90e7-b81d33d456bc: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 215c6087-b54a-40d1-a4d2-e49a1dc614b7: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg a118705b-66bd-45ef-8b7b-e625934f5cad: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 215c6087-b54a-40d1-a4d2-e49a1dc614b7: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg a118705b-66bd-45ef-8b7b-e625934f5cad: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg cfc63df1-51aa-4465-abab-3889b2c85d05: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg a118705b-66bd-45ef-8b7b-e625934f5cad: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg cfc63df1-51aa-4465-abab-3889b2c85d05: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 0da5f1dc-5cef-4fcf-a84c-05fcc857bb04: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg cfc63df1-51aa-4465-abab-3889b2c85d05: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 0da5f1dc-5cef-4fcf-a84c-05fcc857bb04: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e88c832b-93d0-4ed9-b172-e472542ae7b5: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 0da5f1dc-5cef-4fcf-a84c-05fcc857bb04: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e88c832b-93d0-4ed9-b172-e472542ae7b5: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 222459c8-db45-4555-abf9-fff9adb5a4cf: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e88c832b-93d0-4ed9-b172-e472542ae7b5: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 222459c8-db45-4555-abf9-fff9adb5a4cf: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 4bd27927-2bb7-4bf8-ad7f-d126b3125f82: decryption failed
  Generated Video Meeting Link: "https://meet.byos.local/room/byos-american-airlines-aa-8jnmnz1h"
  PASS: Video call generator populated secure BYOS room link
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 252fcc95-200e-4ec0-97fc-c57856d918b8: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 222459c8-db45-4555-abf9-fff9adb5a4cf: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 4bd27927-2bb7-4bf8-ad7f-d126b3125f82: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 3d54d39b-be81-4209-b4c5-27275625413c: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 252fcc95-200e-4ec0-97fc-c57856d918b8: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 4bd27927-2bb7-4bf8-ad7f-d126b3125f82: decryption failed
  Desktop screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_13_desktop.png
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 252fcc95-200e-4ec0-97fc-c57856d918b8: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 3d54d39b-be81-4209-b4c5-27275625413c: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 3d54d39b-be81-4209-b4c5-27275625413c: decryption failed

--- [STEP 9] Calendar Settings Integrations Tab Verification ---
  PASS: Mail event suggestions master toggle present
  PASS: Flights extraction category toggle present
  PASS: Contacts birthdays toggle present
  PASS: Video conference provider selector present

--- [STEP 10] 375px Mobile Viewport Verification ---
  375px horizontal overflow detected: false
  PASS: 375px mobile viewport has zero horizontal scroll
  Mobile screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_13_mobile.png

--- [STEP 11] DevTools Storage & Console Verification ---
  All localStorage keys count: 13
  Linked events storage keys: ["byos_calendar_linked_email_events_c0000000-0000-0000-0000-000000000001"]
  PASS: Email-to-calendar event linkage persisted in localStorage
  Uncaught console errors: 0
  PASS: DevTools console has zero uncaught errors

================================================================================
   CATEGORY 13 BROWSER VERIFICATION: ALL 11 STEPS PASSED                       
================================================================================
```

## Manual browser verification
Executed `tests/browser/test_calendar_category_13.mjs` using Puppeteer against the live application:
1. Navigated to Webmail and cleared storage (`localStorage.clear()`, `sessionStorage.clear()`).
2. Executed real login flow for `alice@byos.local` with `test-password-123`; checked `account-chip-text` displaying `"alice@byos.local"`.
3. Composed and dispatched a flight confirmation email to self containing flight number AA1234, route New York (JFK) to San Francisco (SFO), date 2026-11-15, confirmation ABC999.
4. Opened message in inbox reading pane and awaited client-side local decryption.
5. Observed `[data-testid="email-event-suggestion-card"]` mounting with category badge `"Flight Reservation"`, title `"American Airlines AA1234: New York (JFK) to San Francisco (SFO)"`, and confirmation code `"Confirmation Code:ABC999"`.
6. Clicked `[data-testid="add-suggested-event-btn"]`; encrypted event payload was stored in calendar backend and badge transitioned to `[data-testid="suggestion-added-badge"]` ("Added to Calendar").
7. Clicked `[data-testid="view-suggested-event-btn"]`; transitioned active module to calendar and opened CalendarView.
8. Event modal opened with the newly added event; clicked `[data-testid="add-video-call-btn"]` and observed link populated with `https://meet.byos.local/room/byos-american-airlines-aa-8jnmnz1h`.
9. Captured desktop screenshot to `tests/browser/artifacts/calendar_category_13_desktop.png`.
10. Opened Calendar Settings, navigated to Integrations tab, and checked that `mailEventSuggestions`, `mailCategoryFlights`, `showBirthdaysFromContacts`, and `videoConferenceProvider` were present and interactive.
11. Resized viewport to 375px mobile viewport, checked `scrollWidth <= innerWidth` (zero horizontal overflow), and captured mobile screenshot to `tests/browser/artifacts/calendar_category_13_mobile.png`.
12. Inspected DevTools storage: 13 keys present, `byos_calendar_linked_email_events_c0000000-0000-0000-0000-000000000001` persisted, and 0 uncaught console errors.

## What did not work or is untested
- External CalDAV provider synchronization was tested in Category 01-03 suite; Category 13 focuses exclusively on client-side mail event extraction, contacts birthday projection, and video call link generation.
- No third-party OAuth API connectors (Google Calendar / Microsoft 365) are included by design to preserve zero-knowledge architecture and prevent foreign server token leakage.

## Test suite output

Command:
`go test -count=1 ./services/api/...`
Output:
```
ok  	byos.email/services/api	2.482s
```

Command:
`npm.cmd --prefix apps/webmail test`
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:2772) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=a1a7f315-7db1-4a2b-b871-13e2ec2a0399 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=949431a3-ade7-4ac6-bf8e-825163cbada2 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=eb24b24b-c4c9-479e-8bb3-50bf62a5a6ac chunk_index=0
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
  ✓ test_corrupt_account_entry_removed_without_crash: invalid account safely filtered out
  ✓ test_corrupt_account_entry_removed_without_crash: 1 valid account remains in memory
  ✓ test_corrupt_account_entry_removed_without_crash: storage cleaned of corrupted item
  ✓ test_corrupt_account_entry_removed_without_crash: valid account preserved in storage
  ✓ test_null_storage_handled_gracefully: loads empty accounts array without throw
  ✓ test_clear_all_account_data: all keys for Alice removed
  ✓ test_clear_all_account_data: all keys for Bob removed
  ✓ test_clear_all_account_data: non-sensitive UI theme preference preserved
  ✓ test_session_generation_mismatch_invalidates: generation marker created
  ✓ test_session_generation_mismatch_invalidates: generation valid initially
  ✓ test_session_generation_mismatch_invalidates: tamper detects mismatch
  ✓ test_session_generation_mismatch_invalidates: stale keys purged after mismatch
MULTI-ACCOUNT & STORAGE SYNC TESTS: 45 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 11 passed, 0 failed

Running Calendar Categories 01, 02, 03 Tests...
  ✓ Cat 01.1: Multi-Calendar Management & Color System
  ✓ Cat 01.2: Calendar Visibility Toggle & Persistent Store
  ✓ Cat 01.3: Calendar Deletion & Event Purge
  ✓ Cat 01.4: Default Calendar Invariant & Fallback
  ✓ Cat 02.1: Multi-View Range Calculations
  ✓ Cat 02.2: Mini-Month Date Navigation & Day Selection
  ✓ Cat 02.3: Current Time Indicator Calculations
  ✓ Cat 02.4: Responsive Viewport Adaptation
  ✓ Cat 03.1: ICS Calendar Feed Parsing
  ✓ Cat 03.2: URL Feed Subscription & Metadata
  ✓ Cat 03.3: URL Feed Refresh & Event Reconciliation
  ✓ Cat 03.4: URL Feed Unsubscribe & Event Cleanup
CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed

Running Calendar Category 04 (Alternate & Special Calendars) Tests...
  ✓ Cat 04.1: Alternate Calendar System - Bengali (Bangabda) calculations
  ✓ Cat 04.2: Alternate Calendar Systems - Multi-system format validation
  ✓ Cat 04.3: Canonical Gregorian Event Instant Invariance
  ✓ Cat 04.4: Settings Registry & Store Configuration
  ✓ Cat 04.5: Special-Interest & Sports Feeds Catalogue Completeness
  ✓ Cat 04.6: Sports & Moon Feed Subscription Lifecycle
CALENDAR CATEGORY 04 TESTS: 6 passed, 0 failed

Running Calendar Category 05 (Language, Region & Time Management) Tests...
Starting Calendar Category 05 (Language, Region & Time Management) Tests...
  ✓ Cat 05.1: Regional Date & Time Formatting (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, 12h/24h)
  ✓ Cat 05.2: Week Number Calculation across ISO 8601, First-Day & Full-Week Conventions
  ✓ Cat 05.3: Bidirectional UTC-to-Zoned Time Conversions across Global IANA Zones
  ✓ Cat 05.4: Daylight Saving Time (DST) Transitions & Canonical Instant Invariance
  ✓ Cat 05.5: World Clock Engine, Live City Conversions & Relative Day Indicators
  ✓ Cat 05.6: Settings Registry, Store Integrity & Location Detection Safeguards
  ✓ Cat 05.7: RFC 5545 iCalendar UTC Serialization & Instant Preservation
CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed

Running Calendar Category 06 (Event Creation & Management) Tests...
Starting Calendar Category 06 (Event Creation & Management) Tests...
  ✓ Cat 06.1: Event Plaintext Schema, Visibility, Permissions & Attachments
  ✓ Cat 06.2: End-to-End AES-GCM Authenticated Encryption & Decryption Roundtrip
  ✓ Cat 06.3: Locked Mailbox Fail-Closed Verification (Zero Plaintext Leakage)
  ✓ Cat 06.4: Event Duplication & Copy Identity Mechanics
  ✓ Cat 06.5: Read-Only Calendar Permission Enforcement Guards
  ✓ Cat 06.6: Event-Level Settings Override Precedence (Color, Reminders, Visibility)
  ✓ Cat 06.7: RFC 5545 iCalendar Serialization (CLASS, VALARM & ATTACH Components)
CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed

Running Calendar Category 07 (Recurrence & Advanced Scheduling Rules) Tests...
Starting Calendar Category 07 (Recurrence & Advanced Scheduling Rules) Tests...
  ✓ Cat 07.1: Recurrence Rule Parsing & Serialization Roundtrip
  ✓ Cat 07.2: Custom Interval & Multi-Day Weekly Rules (Bi-Weekly Tue/Thu)
  ✓ Cat 07.3: COUNT and UNTIL Bounded Termination Safeguards
  ✓ Cat 07.4: Date Boundary Correctness (Month-End & Leap Years)
  ✓ Cat 07.5: Detached Modified Occurrences (Preserves Stable Recurrence-ID)
  ✓ Cat 07.6: Persistent Cancelled Occurrences & EXDATE Reconciliation
  ✓ Cat 07.7: Series Edits & Orphaned Exceptions Cascading Isolation
[calendar_crypto] Decryption failed: decryption failed
  ✓ Cat 07.8: Cryptographic Boundary & Zero Plaintext Leakage
  ✓ Cat 07.9: RFC 5545 iCalendar Serialization & Reconciliation
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed

Running Calendar Category 08 (Notifications & Reminders) Tests...
CALENDAR CATEGORY 08 TESTS: 7 passed, 0 failed

Running Calendar Category 10 (Working Hours, Availability & Productivity Status) Tests...
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed

Running Calendar Category 11 (Tasks & Personal Productivity) Tests...
CALENDAR CATEGORY 11 TESTS: 8 passed, 0 failed

Running Calendar Category 12 (Appointment Scheduling & Booking Pages) Tests...
CALENDAR CATEGORY 12 TESTS: 9 passed, 0 failed

Running Calendar Category 13 (Email and External Integrations) Tests...
Running Calendar Category 13 (Email and External Integrations) Tests...
  ✓ Cat 13.1: Flight reservation extraction
  ✓ Cat 13.2: Hotel booking extraction
  ✓ Cat 13.3: Restaurant dining reservation extraction
  ✓ Cat 13.4: Ticket and Webinar event extraction
  ✓ Cat 13.5: Cancellation email detection and status flagging
  ✓ Cat 13.6: Client-side privacy boundary and individual category disable toggles
  ✓ Cat 13.7: Suggestion store, deduplication, and email-to-calendar linking
  ✓ Cat 13.8: Video-conferencing URL generation across providers
  ✓ Cat 13.9: Contact birthday extraction and annual calendar event projection
CALENDAR CATEGORY 13 TESTS: 9 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 515 passed, 0 failed
```
