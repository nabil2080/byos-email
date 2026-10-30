# Sidebar Footer, RightBar Reorganization & Top Bar Placement Report

## What was built
Replaced the "Synced to S3" / `StorageStatusPill` across all module sidebars (Mailbox, Calendar, Notes) with clean, accessible Contacts and Settings buttons in the sidebar footer. Completely removed the `Import Emails` button from the mailbox sidebar. Reorganized `RightBar` to strictly contain only the 4 module navigations (Emails, Calendar, Notes, Contacts), the Customization palette icon, and a single-icon Light/Dark switcher, while stripping all extraneous shortcuts and security lock icons. Positioned `RightBar` full-height beside the workspace card across all sections (Email, Calendar, Notes). Replaced the `<header>` element of `TopFixedBar` with a standard `<div>` container and placed it directly inside the Email List `div` (`[data-testid="message-list"]`), removing any outer header wrapper.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/Sidebar.tsx` | Removed `StorageStatusPill` & `Import Emails` button; added Contacts and Settings buttons in footer. |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Removed `StorageStatusPill`; added Contacts and Settings buttons in sidebar footer; added props. |
| `apps/webmail/src/components/notes/NotesSidebar.tsx` | Removed `StorageStatusPill`; added Contacts and Settings buttons in sidebar footer; added props. |
| `apps/webmail/src/components/RightBar.tsx` | Reorganized RightBar to contain only Emails, Calendar, Notes, Contacts, Customizer, and Theme toggle; removed shortcuts & lock icons. |
| `apps/webmail/src/components/TopFixedBar.tsx` | Converted root `<header>` tag to `<div>` tag with container queries `@container` and adaptive responsiveness. |
| `apps/webmail/src/components/MessageList.tsx` | Converted root `<section>` to `<div>` tag; embedded `<TopFixedBar>` and active label filter directly at top of email list. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Added `onOpenSettings` prop and wired up `onOpenContacts` and `onOpenSettings` to desktop and mobile CalendarSidebar. |
| `apps/webmail/src/components/notes/NotesView.tsx` | Added `onOpenSettings` prop and wired up `onOpenContacts` and `onOpenSettings` to desktop and mobile NotesSidebar. |
| `apps/webmail/src/App.tsx` | Wired `MessageList` to contain `TopFixedBar`; placed `RightBar` and `QuickSettingsPanel` at main container level across all modules. |
| `tests/browser/test_sidebar_footer_and_rightbar_reorganization.mjs` | Automated Puppeteer browser test suite verifying sidebar footers, rightbar reorganization, topbar placement inside email list div with no header tag, and 375px responsiveness. |

## Raw evidence

### 1. Browser Verification Script Execution
Command:
`node tests/browser/test_sidebar_footer_and_rightbar_reorganization.mjs`

Output:
```text
================================================================================
   BYOS: SIDEBAR FOOTER, RIGHTBAR REORGANIZATION & TOP BAR PLACEMENT TEST       
================================================================================

--- [STEP 1] Login as alice@byos.local ---
  Logged into Webmail successfully.

--- [STEP 2] Check Mailbox Sidebar Footer & Removed Buttons ---
  Mailbox sidebar checks: {
  "hasImportBtn": false,
  "hasStoragePill": false,
  "hasSyncedS3Text": false,
  "hasContactsBtn": true,
  "hasSettingsBtn": true
}
  PASS: Import Emails button is completely removed from Mailbox sidebar
  PASS: StorageStatusPill element is completely removed from Mailbox sidebar
  PASS: 'Synced to S3' text is completely removed from Mailbox sidebar
  PASS: Contacts button is present in sidebar footer
  PASS: Settings button is present in sidebar footer
  Saved screenshot: sidebar_footer_contacts_settings.png

--- [STEP 2.1] Test Contacts & Settings from Sidebar Footer ---
  Contacts modal opened successfully from sidebar footer.
  Settings layout opened successfully from sidebar footer.

--- [STEP 3] Check TopFixedBar is inside Email List div and uses div instead of header ---
  TopBar placement: {
  "found": true,
  "topBarTag": "div",
  "messageListTag": "div",
  "isInsideMessageList": true
}
  PASS: TopFixedBar is rendered
  PASS: TopFixedBar must be a 'div' without header tag (got 'div')
  PASS: Email list container must be a 'div' (got 'div')
  PASS: TopFixedBar is situated directly INSIDE the email list div
  Saved screenshot: mailbox_top_bar_inside_email_list.png

--- [STEP 4] Check RightBar Only Contains Permitted Icons ---
  RightBar checks: {
  "hasEmailsBtn": true,
  "hasCalendarBtn": true,
  "hasNotesBtn": true,
  "hasContactsBtn": true,
  "hasCustomizerBtn": true,
  "hasThemeToggle": true,
  "totalButtonsCount": 6,
  "hasShortcutsBtn": false,
  "hasSecurityBtn": false,
  "hasStandaloneSettingsBtn": false
}
  PASS: RightBar includes Emails button
  PASS: RightBar includes Calendar button
  PASS: RightBar includes Notes button
  PASS: RightBar includes Contacts button
  PASS: RightBar includes Customizer (palette) button
  PASS: RightBar includes Light/Dark theme toggle
  PASS: RightBar does NOT have shortcuts icon
  PASS: RightBar does NOT have security lock indicator
  PASS: RightBar does NOT have duplicate settings button
  PASS: RightBar has exactly 6 buttons (got 6)
  Theme toggled from cloud_dancer to dark
  PASS: Theme toggle in RightBar switched theme successfully
  Saved screenshot: rightbar_module_customizer_theme.png

--- [STEP 5] Switch to Calendar via RightBar ---
  Switched to Calendar View.
  PASS: RightBar is visible beside Workspace Card in Calendar View
  Calendar sidebar footer checks: {
  "hasStoragePill": false,
  "hasContactsBtn": true,
  "hasSettingsBtn": true,
  "hasSyncedS3": false
}
  PASS: StorageStatusPill removed from Calendar sidebar
  PASS: 'Synced to S3' removed from Calendar sidebar
  PASS: Contacts button in Calendar sidebar footer
  PASS: Settings button in Calendar sidebar footer
  Saved screenshot: calendar_with_rightbar_active.png

--- [STEP 6] Switch to Notes via RightBar ---
  Switched to Notes View.
  PASS: RightBar is visible beside Workspace Card in Notes View
  Notes sidebar footer checks: {
  "hasStoragePill": false,
  "hasContactsBtn": true,
  "hasSettingsBtn": true,
  "hasSyncedS3": false
}
  PASS: StorageStatusPill removed from Notes sidebar
  PASS: 'Synced to S3' removed from Notes sidebar
  PASS: Contacts button in Notes sidebar footer
  PASS: Settings button in Notes sidebar footer
  Saved screenshot: notes_with_rightbar_active.png

--- [STEP 7] Mobile Responsive Test at 375px Viewport ---
  Mobile 375px scroll info: {
  "scrollWidth": 375,
  "clientWidth": 375,
  "hasHorizontalScroll": false
}
  PASS: Zero horizontal scrolling at 375px mobile viewport
  Saved screenshot: mobile_viewport_375px_no_scroll.png

ALL VERIFICATIONS PASSED SUCCESSFULLY.
```

## Manual browser verification
1. Authenticated as real user `alice@byos.local` via the production webmail login form at `http://127.0.0.1:3001`.
2. Verified the mailbox sidebar footer: `StorageStatusPill` / "Synced to S3" is completely gone. In its place are `Contacts` and `Settings` side-by-side buttons.
3. Verified the mailbox sidebar top actions: `Import Emails` button is removed.
4. Clicked `Contacts` in the footer to verify the Contacts modal opens cleanly. Closed it.
5. Clicked `Settings` in the footer to verify the Settings layout opens cleanly. Closed it and returned to mailbox.
6. Verified `TopFixedBar` uses a `div` element (no `<header>` tag), and is located directly inside the email list container `div` (`[data-testid="message-list"]`).
7. Inspected `RightBar`: verified exactly 6 buttons are present: Emails, Calendar, Notes, Contacts, Appearance Customizer, and Theme Toggle. Verified that shortcuts and security lock indicators have been removed.
8. Clicked the single Theme toggle button in `RightBar`: toggled between light (Cloud Dancer) and dark mode with immediate DOM reflection.
9. Clicked Calendar in `RightBar`: navigated to Calendar view; verified `RightBar` remains visible full-height on the right; verified `CalendarSidebar` footer displays Contacts and Settings buttons with zero "Synced to S3" element.
10. Clicked Notes in `RightBar`: navigated to Notes view; verified `RightBar` remains visible full-height on the right; verified `NotesSidebar` footer displays Contacts and Settings buttons with zero "Synced to S3" element.
11. Resized viewport to 375px mobile dimensions: verified document has `scrollWidth === 375` and `clientWidth === 375` with zero horizontal scrolling.
12. Captured screenshots saved to:
    - `tests/browser/artifacts/sidebar_footer_contacts_settings.png`
    - `tests/browser/artifacts/mailbox_top_bar_inside_email_list.png`
    - `tests/browser/artifacts/rightbar_module_customizer_theme.png`
    - `tests/browser/artifacts/calendar_with_rightbar_active.png`
    - `tests/browser/artifacts/notes_with_rightbar_active.png`
    - `tests/browser/artifacts/mobile_viewport_375px_no_scroll.png`

## What did not work or is untested
- All requested items were tested and verified via unit test and Puppeteer browser runs.
- Production S3 sync backend logic is unaffected and remains intact in services/api.

## Test suite output

### Node.js / Webmail Test Suite:
Command:
`cd apps/webmail; cmd.exe /c "npm test"`

Output:
```text
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:2040) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[PathA Attachment] Decryption failed for attachment_id=97104f69-6cd1-4915-844b-4f3ccb6d6d02 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[PathA Attachment] Hash mismatch for attachment_id=20b9aaab-f7e5-49fd-85b4-9c057476b6b0 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[PathA Attachment] Decryption failed for attachment_id=74628eb9-18c1-48fb-a17e-cdad6c685efe chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: active xwing seed is B's after switch, not A's
  ✓ test_switch_updates_storage_order: Account B is first in active accounts array
  ✓ test_switch_updates_storage_order: Account A is second
  ✓ test_switch_preserves_unselected_keys: Account A's seeds remain safely stored in sessionStorage
  ✓ test_all_inboxes_sets_unified_sentinel: activeAccountId is __all__
  ✓ test_all_inboxes_preserves_keys: session keys still present in sessionStorage
  ✓ test_all_inboxes_preserves_keys: accounts array unchanged
  ✓ test_all_inboxes_sets_unified_sentinel: activeAccountId is explicitly __all__
  ✓ test_all_inboxes_preserves_keys: signingSeedHex present in session for Account A
MULTI-ACCOUNT & STORAGE SYNC TESTS: 40 passed, 0 failed

Running Calendar Category 11 (Focus, Agenda and Productivity) Tests...
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

Running Calendar Category 14 (Import, Export and Synchronization) Tests...
Running Calendar Category 14 (Import, Export and Synchronization) Tests...
  ✓ Cat 14.1: ICS file validation, size limits (512KB rejection), and event count limits
  ✓ Cat 14.2: Full calendar export to RFC 5545 format (VCALENDAR, VTIMEZONE, VEVENT, CLASS, VALARM)
  ✓ Cat 14.3: ICS import parsing with UID preservation, timezone normalization, and payload encryption
  ✓ Cat 14.4: Duplicate detection and conflict handling (skip_duplicates vs update_duplicates)
  ✓ Cat 14.5: Recurrence rule and exception preservation on import/export round-trip
  ✓ Cat 14.6: External URL feed subscription lifecycle (subscribe, cache, refresh, pause, resume, unsubscribe)
  ✓ Cat 14.7: Subscribed feed error handling, invalid URL rejection, and safe fallback
  ✓ Cat 14.8: CalDAV protocol metadata, URL generation, and principal resolution
  ✓ Cat 14.9: Client-side privacy boundary (zero plaintext leakage on export and import)

CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed

CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed

Running Calendar Category 15 (Accessibility, Interface and Offline Experience) Tests...
Running Calendar Category 15 (Accessibility, Interface & Offline Experience) Tests...
  ✓ Cat 15.1: View density and display controls (compact vs comfortable, week numbers, weekends)
  ✓ Cat 15.2: Declined event visibility and strikethrough styling logic
  ✓ Cat 15.3: Offline event action queueing and safety invariant ('queued_locally')
  ✓ Cat 15.4: Offline decrypted event caching and retrieval
  ✓ Cat 15.5: Offline sync reconnection and conflict detection without silent overwrite
  ✓ Cat 15.6: Deleted-event trash lifecycle (30-day retention countdown, restore, permanent delete, empty)
  ✓ Cat 15.7: Transient undo action coordination alongside persistent trash
  ✓ Cat 15.8: Keyboard navigation and global shortcut map
  ✓ Cat 15.9: Screen-reader announcements (aria-live='polite') and accessibility attributes

CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

Running Calendar Interval Scheduling & Layout Tests...
  ✓ 1. Empty input handling
  ✓ 2. Single event spans 100% width
  ✓ 3. Disjoint non-overlapping events independently span 100% width
  ✓ 4. Two overlapping events allocate 50/50 parallel non-colliding columns
  ✓ 5. Three concurrent events allocate 3 parallel columns with 0% collision
  ✓ 6. Greedy interval scheduling correctly packs sequential sub-intervals
  ✓ 7. Day View cleanly allocates 5 parallel non-overlapping lanes
  ✓ 8. Week View high-concurrency clusters cascade with >= 60% readable card width
  ✓ 9. getOpaqueEventBg computes 100% solid, fully-opaque surfaces
CALENDAR INTERVAL & LAYOUT TESTS: All 9 passed, 0 failed

Running Google Keep Notes Feature Tests...
  ✓ 1. Initial load provides welcome notes with checklists, labels, and reminders
  ✓ 2. Google Keep labels management (add, rename, delete all without restore bug) works reliably
  ✓ 3. createNote supports checklists, color styling, labels, and reminders
  ✓ 4. Archive and Unarchive note lifecycle functions correctly
  ✓ 5. Bin lifecycle (move to bin, restore, and empty bin) matches Google Keep
  ✓ 6. Duplicate note functionality works as expected
  ✓ 7. Verified all 8 approved Google Keep pastel color definitions
GOOGLE NOTE FEATURE TESTS: All 7 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 550 passed, 0 failed
```

### Go API Test Suite:
Command:
`cd services/api; go test ./...`

Output:
```text
ok  	byos.email/services/api	(cached)
```
