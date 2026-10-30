# Minimal Event Modal & Categorized Settings Report

## What was built
Redesigned the Add/Edit Event dialog (`EventModal.tsx`) from a cluttered multi-option popup into a clean, minimal archetype modeled after Google Calendar and Tuta Calendar reference layouts, featuring an unboxed title input, compact event-type pills, consolidated date/time/timezone card, and streamlined location, video call, guest, and calendar pickers. In addition, transformed both the Webmail settings navigation (`SettingsLayout.tsx`) and the Calendar settings panel (`CalendarSettingsPanel.tsx`) from flat, overwhelming tab lists into structured, categorized sections (`Account & Security`, `Mail & Appearance`, `Integrations & Access` for Webmail; `General & Views`, `Schedule & Availability`, `Connections & Privacy`, `Calendars & Subscriptions`, `Manage Calendars` for Calendar), preserving full 375px mobile responsiveness and all existing cryptographic and DOM test identifiers.

## Files edited
| File | Reason |
|------|--------|
| apps/webmail/src/components/calendar/EventModal.tsx | Redesigned the Add Event modal into a minimal Google Calendar and Tuta Calendar archetype with unboxed title, compact pills, and organized cards |
| apps/webmail/src/routes/settings/SettingsLayout.tsx | Reorganized flat webmail settings tabs into three categorized navigation groups with responsive mobile/desktop sidebars |
| apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx | Categorized 15 calendar settings tools and sections into five distinct functional categories with uppercase group headers |
| apps/webmail/src/components/calendar/CalendarSidebar.tsx | Added the missing world clock widget markup with live city time indicators |
| tests/browser/test_calendar_category_05.mjs | Prioritized webmail port 3001 in port probing order |
| tests/browser/test_calendar_category_06.mjs | Prioritized webmail port 3001 in port probing order and added scrollIntoView before pill interaction |
| tests/browser/test_minimal_event_modal_and_categorized_settings.mjs | End-to-end Puppeteer audit script validating the minimal event modal, 375px mobile viewport, and categorized settings navigation |
| docs/minimal_event_modal_and_categorized_settings_report.md | Comprehensive engineering report with raw execution evidence and file accounting |

## Raw evidence
Claim: The production bundle builds successfully without compilation errors.
Output from `npm --prefix apps\webmail run build`:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 309 modules transformed.
rendering chunks...
[plugin vite:reporter] 
(!) F:/Codex/byos-email/apps/webmail/src/generated/crypto-core/byos_crypto_core.js is dynamically imported by F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/components/AddMailboxModal.tsx, F:/Codex/byos-email/apps/webmail/src/message_crypto.ts, F:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/setup-account.tsx, F:/Codex/byos-email/apps/webmail/src/routes/setup-account.tsx, F:/Codex/byos-email/apps/webmail/src/routes/setup-account.tsx, F:/Codex/byos-email/apps/webmail/src/session_isolation.ts, F:/Codex/byos-email/apps/webmail/src/utils/calendarImportExport.ts but also statically imported by F:/Codex/byos-email/apps/webmail/src/attachment_crypto.ts, F:/Codex/byos-email/apps/webmail/src/components/calendar/CalendarView.tsx, dynamic import will not move module into another chunk.

[plugin vite:reporter] 
(!) F:/Codex/byos-email/apps/webmail/src/api.ts is dynamically imported by F:/Codex/byos-email/apps/webmail/src/App.tsx but also statically imported by F:/Codex/byos-email/apps/webmail/src/App.tsx, F:/Codex/byos-email/apps/webmail/src/calendar_recovery.ts, F:/Codex/byos-email/apps/webmail/src/components/AccountSwitcher.tsx, F:/Codex/byos-email/apps/webmail/src/components/AddMailboxModal.tsx, F:/Codex/byos-email/apps/webmail/src/components/ProfileAvatar.tsx, F:/Codex/byos-email/apps/webmail/src/components/QuickSettingsPanel.tsx, F:/Codex/byos-email/apps/webmail/src/components/ReadingPane.tsx, F:/Codex/byos-email/apps/webmail/src/components/RecipientInput.tsx, F:/Codex/byos-email/apps/webmail/src/components/Sidebar.tsx, F:/Codex/byos-email/apps/webmail/src/components/calendar/CalendarView.tsx, F:/Codex/byos-email/apps/webmail/src/components/calendar/ShareCalendarModal.tsx, F:/Codex/byos-email/apps/webmail/src/components/calendar/offline/calendarOfflineSync.ts, F:/Codex/byos-email/apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts, F:/Codex/byos-email/apps/webmail/src/components/modals/ContactsModal.tsx, F:/Codex/byos-email/apps/webmail/src/components/modals/ImportEmailsModal.tsx, F:/Codex/byos-email/apps/webmail/src/message_crypto.ts, F:/Codex/byos-email/apps/webmail/src/oauth_import.ts, F:/Codex/byos-email/apps/webmail/src/persistent_session.ts, F:/Codex/byos-email/apps/webmail/src/routes/settings/AccountTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/AppearanceTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/AutoReplyTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/BridgeTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/FiltersTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/MaskedEmailTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/settings/SignaturesTab.tsx, F:/Codex/byos-email/apps/webmail/src/routes/setup-account.tsx, F:/Codex/byos-email/apps/webmail/src/send_queue.ts, F:/Codex/byos-email/apps/webmail/src/unified_inbox.ts, F:/Codex/byos-email/apps/webmail/src/utils/calendarImportExport.ts, dynamic import will not move module into another chunk.

computing gzip size...
dist/index.html                                    1.79 kB │ gzip:   0.86 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-D5yD4PJH.css                   137.15 kB │ gzip:  21.13 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-ybvdfyIh.js                  2,943.46 kB │ gzip: 599.61 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 8.01s
```

Claim: Minimal Event Modal and Categorized Settings browser execution output from Puppeteer.
Output from `node --experimental-wasm-modules tests/browser/test_minimal_event_modal_and_categorized_settings.mjs`:
```
================================================================================
   BYOS MINIMAL EVENT MODAL & CATEGORIZED SETTINGS BROWSER AUDIT               
================================================================================

--- [STEP 1] Login Flow for alice@byos.local ---
  Authenticated successfully as Alice

--- [STEP 2] Switch to Calendar View ---

--- [STEP 3] Open Add Event Popup & Verify Minimal Archetype ---
  PASS: Title input is present with prominent style
  PASS: Title placeholder is 'Add title' (Google Calendar style)
  PASS: Event type pills row is present
  PASS: Date & Time card with start date is present
  PASS: All day toggle is present
  PASS: Location input row is present
  PASS: Video conferencing row is present
  PASS: Guests & invitations row is present
  PASS: Description row is present
  PASS: Calendar metadata row is present
  PASS: Color swatch picker is present
  PASS: Save pill button is present
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\minimal_event_modal_desktop.png

--- [STEP 4] 375px Mobile Viewport Check for Event Modal ---
  Mobile modal overflow metrics: {"docScrollWidth":375,"docClientWidth":375,"hasDocOverflow":false}
  PASS: Zero horizontal document overflow on 375px mobile viewport
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\minimal_event_modal_mobile_375px.png

--- [STEP 5] Verify Categorized Calendar Settings Navigation ---
  Calendar Settings Category Headers: ["General & Views","Schedule & Availability","Connections & Privacy","Calendars & Subscriptions","Manage Calendars"]
  PASS: Category 'General & Views' is rendered
  PASS: Category 'Schedule & Availability' is rendered
  PASS: Category 'Connections & Privacy' is rendered
  PASS: Category 'Calendars & Subscriptions' is rendered
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\categorized_calendar_settings_desktop.png

--- [STEP 6] Verify Categorized Webmail Settings Navigation ---
  Webmail Settings Category Headers: ["Settings Categories","Account & SecurityAccountProfile photo and account preferencesSecurity & SessionsPassword, 2FA, passkeys, and recoverySignatures & IdentitiesDisplay names, aliases, and signatures","Account & Security","AccountProfile photo and account preferences","Account","Profile photo and account preferences","Security & SessionsPassword, 2FA, passkeys, and recovery","Security & Sessions","Password, 2FA, passkeys, and recovery","Signatures & IdentitiesDisplay names, aliases, and signatures","Signatures & Identities","Display names, aliases, and signatures","Mail & AppearanceAppearanceThemes, density, layout, and font scaleFilters & RulesCustom rules, Sieve, and allow/block listsAuto-ReplyAutomatic vacation responder rulesMasked EmailBurner aliases that forward securely to inbox","Mail & Appearance","AppearanceThemes, density, layout, and font scale","Appearance","Themes, density, layout, and font scale","Filters & RulesCustom rules, Sieve, and allow/block lists","Filters & Rules","Custom rules, Sieve, and allow/block lists","Auto-ReplyAutomatic vacation responder rules","Auto-Reply","Automatic vacation responder rules","Masked EmailBurner aliases that forward securely to inbox","Masked Email","Burner aliases that forward securely to inbox","Integrations & AccessCalendarCalendar workspace configuration & noticeDesktop & Mobile AppsIMAP/SMTP credentials for Thunderbird & Apple MailMailbox ImportZero-knowledge import from Gmail or Outlook","Integrations & Access","CalendarCalendar workspace configuration & notice","Calendar","Calendar workspace configuration & notice","Desktop & Mobile AppsIMAP/SMTP credentials for Thunderbird & Apple Mail","Desktop & Mobile Apps","IMAP/SMTP credentials for Thunderbird & Apple Mail","Mailbox ImportZero-knowledge import from Gmail or Outlook","Mailbox Import","Zero-knowledge import from Gmail or Outlook","Security & EncryptionClient-side keys protect your privacy. Settings are encrypted and isolated per mailbox."]
  PASS: Category 'Account & Security' is rendered
  PASS: Category 'Mail & Appearance' is rendered
  PASS: Category 'Integrations & Access' is rendered
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\categorized_webmail_settings_desktop.png
  PASS: Zero uncaught page errors (found 0)

================================================================================
   ALL MINIMAL EVENT MODAL & CATEGORIZED SETTINGS CHECKS PASSED                
================================================================================
```

## Manual browser verification
Executed automated browser navigation in Chromium via Puppeteer script `tests/browser/test_minimal_event_modal_and_categorized_settings.mjs`:
1. Navigated to webmail authentication screen on local server (`http://127.0.0.1:3001`), logged in as `alice@byos.local`, and waited for active mailbox view.
2. Switched to Calendar module via navigation pill (`[data-testid="sidebar-calendar-btn"]`) and observed grid mounting.
3. Triggered `[data-testid="calendar-add-event-btn"]` to open the newly redesigned Add Event popup:
   - Evaluated the Google Calendar-style unboxed title input (`[data-testid="event-title-input"]`) with placeholder `"Add title"`.
   - Evaluated the event type pills row (`Event`, `Focus time`, `Out of office`, `Work location`).
   - Typed event title `"Strategy Sync with Team"` and location `"Boardroom Alpha"`.
   - Inspected presence of Date & Time card, all-day toggle switch, video conference button, guests/invitations input, description textarea, calendar selector, and color palette swatches.
   - Captured screenshot to `tests/browser/artifacts/minimal_event_modal_desktop.png`.
4. Resized browser viewport to 375px mobile viewport (`width: 375, height: 667`):
   - Evaluated `document.documentElement.scrollWidth <= document.documentElement.clientWidth`.
   - Recorded zero horizontal document overflow (`docScrollWidth: 375, docClientWidth: 375, hasDocOverflow: false`).
   - Captured screenshot to `tests/browser/artifacts/minimal_event_modal_mobile_375px.png`.
5. Closed event modal and clicked `[data-testid="calendar-settings-btn"]`:
   - Inspected modal opened with `[data-testid="calendar-settings-modal"]`.
   - Inspected grouped category navigation headers: `General & Views`, `Schedule & Availability`, `Connections & Privacy`, `Calendars & Subscriptions`, `Manage Calendars`.
   - Captured screenshot to `tests/browser/artifacts/categorized_calendar_settings_desktop.png`.
6. Closed Calendar settings and opened Webmail Settings via Right Bar `[data-testid="sidebar-settings-btn"]`:
   - Inspected `[data-testid="settings-layout"]` opened with `[data-testid="settings-sidebar"]`.
   - Inspected three grouped category headers: `Account & Security`, `Mail & Appearance`, and `Integrations & Access`.
   - Captured screenshot to `tests/browser/artifacts/categorized_webmail_settings_desktop.png`.

## What did not work or is untested
- UNTESTED: Physical mobile touch drag-and-drop gestures on calendar week grid events on real iOS and Android devices; automated verification was performed on Chromium at 375px viewport.

## Test suite output
### Backend Go Test Output
Command: `cd services/api && go test ./...`
```
ok  	byos.email/services/api	(cached)
```

### Frontend Webmail Test Output
Command: `npm --prefix apps\webmail test -- --run`
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js --run

(node:3700) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=7d77b0fb-6769-4901-9dc9-5149c616f631 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=0679974e-08d1-4054-8a81-4aad0d33c77a (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=bf307ec0-3206-46ab-ad4e-5757fa397c7a chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: target account session token is active
  ✓ test_switch_restores_active_view: activeFolder restored after switch
  ✓ test_switch_restores_active_view: selectedMessageId restored after switch
  ✓ test_switch_restores_active_view: draftId restored after switch
  ✓ test_switch_restores_active_view: composerOpen restored after switch
  ✓ test_switch_restores_active_view: currentTheme restored after switch
  ✓ test_switch_different_mailbox_key: target account has different mailboxKey
  ✓ test_switch_different_mailbox_key: prior account mailboxKey purged from memory
  ✓ test_legacy_single_account_upgrade: migrated account is in multi-account storage
  ✓ test_legacy_single_account_upgrade: session generation marker created
  ✓ test_legacy_single_account_upgrade: single-account token key purged
  ✓ test_legacy_single_account_upgrade: active account points to migrated account
  ✓ test_migration_leaves_no_orphaned_keys: old sessionToken purged
  ✓ test_migration_leaves_no_orphaned_keys: old mailboxSkHex purged
  ✓ test_storage_event_sync: account added in tab 2 appears in tab 1
  ✓ test_storage_event_sync: active account switch in tab 2 updates tab 1
  ✓ test_storage_event_sync: logout in tab 2 reflects in tab 1
  ✓ test_storage_event_sync: concurrent token refresh handled without overwrite
  ✓ test_storage_event_sync: generational conflict triggers reload, not silent state corruption
  ✓ test_device_name_in_registration: device_name present in payload
  ✓ test_device_name_in_registration: fallback name is non-empty string
  ✓ test_device_name_in_registration: custom device name preserved
  ✓ test_device_name_in_registration: platform info detected correctly
  ✓ test_device_name_in_registration: device_name matches platform format
MULTI-ACCOUNT & STORAGE SYNC TESTS: 56 passed, 0 failed

Running Session Isolation Tests...
SESSION ISOLATION TESTS: 6 passed, 0 failed

Running Sieve Tests...
SIEVE TESTS: 23 passed, 0 failed

Running Sieve Edge Tests...
SIEVE EDGE TESTS: 10 passed, 0 failed

Running Sieve Splicing Tests...
SIEVE SPLICING TESTS: 12 passed, 0 failed

Running Sieve Real-World Scenario Tests...
SIEVE SCENARIO TESTS: 6 passed, 0 failed

Running Sieve Action Execution Tests...
SIEVE ACTION EXECUTION TESTS: 23 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 6 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 11 passed, 0 failed

Running Calendar Settings Tests...
CALENDAR SETTINGS TESTS: 12 passed, 0 failed

Running Calendar Management Tests...
CALENDAR MANAGEMENT TESTS: 13 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 14 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 14 passed, 0 failed

Running Calendar Categories 01, 02, 03 Tests...
CALENDAR CATEGORIES 01, 02, 03 TESTS: 10 passed, 0 failed

Running Calendar Category 04 (Timezones & World Clock) Tests...
CALENDAR CATEGORY 04 TESTS: 7 passed, 0 failed

Running Calendar Category 05 (Search & Event Discovery) Tests...
CALENDAR CATEGORY 05 TESTS: 8 passed, 0 failed

Running Calendar Category 06 (Event Duplication, Movement & Templates) Tests...
CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed

Running Calendar Category 07 (Recurrence & Advanced Scheduling Rules) Tests...
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
CALENDAR CATEGORY 13 TESTS: 9 passed, 0 failed

Running Calendar Category 14 (Import, Export and Synchronization) Tests...
CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed

Running Calendar Category 15 (Accessibility, Interface and Offline Experience) Tests...
CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 533 passed, 0 failed
```
