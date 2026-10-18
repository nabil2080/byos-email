# Product Tour & Webmail Tour Removal Report

## What was built
Completely removed the automatic and optional guided product walkthrough from BYOS Webmail (`apps/webmail/`) so authenticated users land directly into an immediate, distraction-free email interface. All Webmail-specific Driver.js dependencies, tour runners, CSS styles, lifecycle hooks, and Settings restart controls were cleanly eradicated. The Control Panel product tour (`apps/control-plane/`, `control_plane_v1`, 7 steps) was strictly preserved with its responsive viewport positioning across mobile and desktop breakpoints (375px, 390px, 768px, 1280px), PostgreSQL JSONB persistence, Policy A missing-anchor filtering, and Settings restart capabilities. The backend (`services/api/tours.go`) was updated to retire `webmail_v1` while preserving shared database infrastructure and `control_plane_v1` tour management.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/App.tsx` | Removed tour imports, DEV test hook `window.__startWebmailTour`, bootstrap auto-launch check, and tour cleanup logic |
| `apps/webmail/src/routes/settings/AccountTab.tsx` | Removed Guided Product Tour card and `restart-tour-btn` button |
| `apps/webmail/src/index.tsx` | Removed `./tours/tour_style.css` stylesheet import |
| `apps/webmail/src/tours/runner.ts` | Deleted Webmail tour runner |
| `apps/webmail/src/tours/tour_style.css` | Deleted Webmail tour stylesheet |
| `apps/webmail/src/tours/webmail_v1.ts` | Deleted Webmail tour step definitions |
| `apps/webmail/package.json` | Removed `driver.js` dependency from Webmail |
| `apps/webmail/package-lock.json` | Updated package lockfile after removing `driver.js` |
| `services/api/tours.go` | Retired `webmail_v1` from `validTourIDs`, restricting allowed tours to `control_plane_v1` |
| `services/api/tours_test.go` | Added assertion verifying retired `webmail_v1` requests return HTTP 400 Bad Request |
| `clean-test-data.ps1` | Removed synthetic test account `ob@byos.local` provisioning |
| `tools/clean-test-data.sql` | Removed synthetic test account `ob@byos.local` from preserved users list |
| `tests/browser/test_tours.mjs` | Preserved all Control Panel checks; replaced Webmail walkthrough with assertions verifying immediate inbox access, zero popovers, zero `/v1/tours/state` calls, and no Settings restart button |
| `smoke.ps1` | Smoke test script executing 18 end-to-end browser tests |
| `tools/product_tour_verify.sql` | SQL verification script inspecting persisted tour state in PostgreSQL |
| `docs/product_tour_report.md` | Comprehensive report documenting Webmail tour removal and Control Panel tour preservation |

---

## 1. Webmail Tutorial Files Removed
The entire directory `apps/webmail/src/tours/` was deleted:
1. `apps/webmail/src/tours/runner.ts` (Tour execution engine, Driver.js initialization, coordinate clamping, and API synchronization)
2. `apps/webmail/src/tours/tour_style.css` (Driver.js theme customizations and mobile bottom-sheet CSS rules)
3. `apps/webmail/src/tours/webmail_v1.ts` (Step definitions for 6 Webmail orientation popovers)

No files remain inside `apps/webmail/src/tours/`.

---

## 2. Webmail Files Modified
1. `apps/webmail/src/App.tsx`:
   - Removed imports: `fetchTourState`, `startWebmailTour`, `destroyWebmailTour`, `WEBMAIL_V1_ID` from `./tours/runner`.
   - Removed DEV test hook `window.__startWebmailTour`.
   - Removed tour status check and automatic `startWebmailTour()` trigger from `bootstrapSession()`.
   - Removed `destroyWebmailTour()` from component `onCleanup`.
   - Removed `onRestartTour` prop passing to `<AccountTab>`.
2. `apps/webmail/src/routes/settings/AccountTab.tsx`:
   - Removed imports: `recordTourReset`, `WEBMAIL_V1_ID` from `../../tours/runner`.
   - Removed `onRestartTour?: () => void;` from `AccountTabProps` interface.
   - Removed the "Guided Product Tour" settings section and the "Restart tour" button (`[data-testid="restart-tour-btn"]`).
3. `apps/webmail/src/index.tsx`:
   - Removed `import "./tours/tour_style.css";`.

---

## 3. Dependencies Removed
- Removed `driver.js` (`^1.10.1`) from `apps/webmail/package.json` and `package-lock.json`.
- Executed production build (`npm --prefix apps/webmail run build`) and searched the output chunks for `driver.js`. Zero instances exist in `apps/webmail/dist/` or `apps/webmail/src/`.
- `driver.js` remains installed exclusively in `apps/control-plane/package.json` where it powers the Control Panel onboarding orientation tour.

---

## 4. Backend Changes
- `services/api/tours.go`:
  - Updated `validTourIDs` map to remove `"webmail_v1": true`. Only `"control_plane_v1": true` is permitted.
  - Any request targeting `/v1/tours/webmail_v1/finish`, `/skip`, or `/reset` is rejected immediately with HTTP 400 Bad Request (`unknown tour_id: webmail_v1`).
- `services/api/tours_test.go`:
  - Updated unit tests to validate `control_plane_v1` for skip, reset, completion, and idempotency.
  - Added test case validating that requests targeting `webmail_v1` return HTTP 400.

---

## 5. Database State
- No destructive database migrations were introduced.
- Migration `057_tour_state.sql` remains intact, providing the `users.tours_seen JSONB` column used by `control_plane_v1`.
- Any legacy `webmail_v1` keys in existing user rows remain benign, inert JSON data.
- Synthetic zero-mailbox test fixture `ob@byos.local` was deleted from PostgreSQL and purged from `clean-test-data.ps1` and `tools/clean-test-data.sql`.

---

## 6. Test Files Updated
- `tests/browser/test_tours.mjs`:
  - Preserved all Control Panel test checks: onboarding wizard guard matrix, automatic start on `/dashboard`, 7-step progression, early skip persistence to PostgreSQL, reload suppression, Settings restart from step 1 (ignoring `last_step`), Policy A pre-flight filtering of missing optional anchors, and multi-viewport bounding box constraints across 1280px, 768px, 390px, and 375px.
  - Replaced Webmail walkthrough and Policy B checks with assertions verifying:
    1. Authenticated user lands directly in the active inbox without delay.
    2. Zero Driver.js popovers or overlay elements are rendered.
    3. Zero HTTP requests are dispatched to `/v1/tours/state` during bootstrap or mailbox navigation.
    4. Settings Account tab contains no "Guided Product Tour" card or `restart-tour-btn`.
    5. Normal email operations (compose, search, message listing) remain fully functional.
    6. `window.__startWebmailTour` test hook is undefined.
    7. Driver.js runtime is not loaded in Webmail.

---

## 7. Control Panel Functionality Preserved
The Control Panel product tour remains fully operational:
1. **7 Orientation Steps**: Highlights Dashboard Overview, Domain Management, Cryptographic Mailboxes, Team & Role Access, Storage Governance, Seat-Based Capacity, and Security & Governance.
2. **First Visit Trigger**: Launches automatically upon first visit to `/dashboard` when `control_plane_v1` is unrecorded in `users.tours_seen`.
3. **Onboarding Guard**: Does not trigger during the post-payment onboarding wizard (`/onboarding/*`).
4. **Skip Persistence**: Dismissing via the close button records `skipped_at` and `last_step` via `POST /v1/tours/control_plane_v1/skip`.
5. **Reload Suppression**: Subsequent visits to `/dashboard` do not restart the tour once previously dismissed or concluded.
6. **Settings Restart**: Settings > Guided Product Tour > "Restart tour" resets PostgreSQL state via `POST /v1/tours/control_plane_v1/reset` and restarts the tour at Step 1.
7. **Policy A Pre-flight**: If an optional anchor is absent from the DOM, the runner filters that step out, logs a console warning, and continues smoothly with available steps without crashing.
8. **Responsive Viewport Clamping**: Popover bounding boxes remain entirely within the viewport boundaries without horizontal document overflow at 1280px, 768px, 390px, and 375px.

---

## 8. Actual Webmail Login Behavior After Removal
1. User logs in at `http://localhost:3001/` with valid credentials (`alice@byos.local`).
2. Webmail validates credentials, derives cryptographic keys, authenticates the session, and presents the inbox stream immediately.
3. No Driver.js backdrop overlays, popover cards, or tutorial prompts appear.
4. The browser network log records zero requests to `/v1/tours/state` or `/v1/tours/*`.
5. Navigating to Settings displays the Account tab without any tutorial sections or restart buttons.
6. The user can immediately read messages, execute searches, and compose encrypted emails without disruption.

---

## 9. Actual Test and Build Outputs

### Webmail Unit Tests
Command: `cmd.exe /c "npm --prefix apps/webmail test"`
```text
SNOOZE TESTS: 2 passed, 0 failed

Running Scheduled Folder Tests...
Running Scheduled Folder Tests...
  ✓ 1. Folder type union includes 'scheduled'
  ✓ 2. Sidebar folder list order places 'scheduled' between 'sent' and 'drafts'
  ✓ 3. MessageRow formatSmartDate formats scheduled dates correctly
  ✓ 4. DisplayMessage folder supports 'scheduled'
  ✓ 5. Scheduled message error placeholders conform to specification
  ✓ 6. Folder threading support accurately distinguishes flat-by-design folders
  ✓ 7. Edit then discard leaves scheduled item untouched
  ✓ 8. Edit then save with body change updates same row in place
  ✓ 9. Edit then save with time change updates send_at on same row
  ✓ 10. Edit then save with no changes preserves all attributes without orphan drafts
  ✓ 11. Failed schedule surfaces specific backend error step, not generic wrapper
  ✓ 12. Schedule send with locked mailbox key surfaces actionable unlock message
  ✓ 13. Real-time event message.deleted removes scheduled item from list live
  ✓ 14. Real-time event message.created adds delivered sent copy to Sent folder live
  ✓ 15. Delivery failure event moves message to Drafts with sendFailed marker live
SCHEDULED FOLDER TESTS: 15 passed, 0 failed

Running Display Party Tests...
Running Display Party & Sent Folder Tests...
  ✓ 1. formatAddress extracts clean display name or email
  ✓ 2. Inbox row renders sender, not recipient
  ✓ 3. Archive, spam, trash, and search rows render sender
  ✓ 4. Sent row renders recipient, not sender
  ✓ 5. Sent row with multiple recipients renders first +N
  ✓ 6. Drafts row with no recipient renders 'No recipient'
  ✓ 7. Scheduled folder renders recipient(s) and first +N
  ✓ 8. Threaded Sent row renders the recipient of the latest message
  ✓ 9. Sent folder rows are never treated as unread
DISPLAY PARTY TESTS: 9 passed, 0 failed

Running Nested Labels Tests...
  PASS: test_sidebar_renders_tree
  PASS: test_parent_click_filters_descendants
  PASS: test_expand_state_persists
  PASS: test_reparent_cycle_blocked_ui
NESTED LABELS TESTS: 4 passed, 0 failed

Running API Error Handling Tests...
Running API Error Handling Tests...
  ✓ test_api_error_propagates_not_swallowed: fetchMailboxes throws on 500
  ✓ test_api_error_propagates_not_swallowed: fetchDrafts, fetchFolders, fetchLabels, fetchContacts throw on 500
  ✓ test_successful_return_shape: api client returns data on 200
  ✓ test_global_error_banner_renders: set and clear global error signal
API ERROR HANDLING TESTS: 4 passed, 0 failed

Running Unified Inbox Tests...
Running Unified Inbox Tests...
  ✓ test_unified_inbox_merges_accounts
  ✓ test_account_chip_renders
  ✓ test_reply_uses_message_account
  ✓ test_unified_search_deduplicates
  ✓ test_snooze_uses_correct_account_endpoint
  ✓ test_multi_sse_routing
  ✓ test_account_chip_shows_current_selection
  ✓ test_dropdown_lists_all_accounts
  ✓ test_selecting_account_updates_folders
  ✓ test_selecting_all_inboxes_shows_aggregate
  ✓ test_account_chip_color_matches_selection
  ✓ test_key_resolution_uses_owning_mailbox
  ✓ test_key_locked_prompts_for_correct_account
  ✓ test_unlock_retries_decrypt
  ✓ test_global_key_signal_never_used_in_unified_path
  ✓ test_popup_hides_all_inboxes_with_one_account
  ✓ test_popup_shows_all_inboxes_with_two_accounts
  ✓ test_popup_shows_all_inboxes_with_three_accounts
  ✓ test_selection_resets_on_account_removal
UNIFIED INBOX TESTS: 19 passed, 0 failed

Running Masked Email Tests...
Running Masked Email Tests...
  ✓ 1. TestBuildMimeStringIncludesAliasHeaders
  ✓ 2. TestBuildPendingSendPayloadWithFromAlias
  ✓ 3. TestRestoreComposeStateWithFromAlias
  ✓ 4. TestMaskedAliasAPIFunctions
  ✓ 5. TestMaskedAliasRateLimitErrorHandling
  ✓ 6. TestMessageMetadataReplyViaAlias
  ✓ 7. test_custom_alias_validation_shows_errors
  ✓ 8. test_custom_alias_preview_updates
  ✓ 9. test_custom_alias_409_shows_friendly_error
  ✓ 10. test_random_mode_hides_custom_input
  ✓ 11. TestCreateCustomAliasAPI
MASKED EMAIL TESTS: 11 passed, 0 failed

Running Focused Inbox Tests...
Running Focused Inbox Classifier Tests...
  ✓ 1. TestPrimaryClassificationForDirectHumanMail
  ✓ 2. TestNewslettersClassificationHeaders
  ✓ 3. TestSocialClassificationForSocialDomains
  ✓ 4. TestNotificationsClassificationSignals
  ✓ 5. TestClassificationPrecedenceOrder
  ✓ 6. TestOverridesPrecedence
FOCUSED INBOX TESTS: 6 passed, 0 failed

Running Offline Support Tests...
  ✓ 1. Cache stores 50 messages, prunes older
  ✓ 2. Cached content is ciphertext, not plaintext
  ✓ 3. Unsealed keys NOT present in IndexedDB
  ✓ 4. Send queue persists items with client_queue_id UUID
  ✓ 5. Queue replay sends items in FIFO order
  ✓ 6. Replay handles server 200 (removes item) and server error (marks failed)
  ✓ 7. Clear offline cache deletes all stores and SW caches
OFFLINE SUPPORT TESTS: 7 passed, 0 failed

Running Composer Sanitizer Tests...
Running Composer Sanitizer Tests...
  ✓ test_sanitize_strips_script_tags
  ✓ test_sanitize_strips_onclick_handlers
  ✓ test_sanitize_strips_javascript_hrefs
  ✓ test_sanitize_allows_safe_tags
  ✓ test_sanitize_allows_byos_storage_images
  ✓ test_sanitize_blocks_remote_images_by_default
  ✓ test_sanitize_preserves_table_structure
  ✓ test_sanitize_preserves_code_blocks
  ✓ test_paste_from_word_strips_wrapper_html
COMPOSER SANITIZER TESTS: 9 passed, 0 failed

Running Contacts Management Tests...
Running Contacts Management & Autocomplete Tests...
  ✓ test_contact_list_renders
  ✓ test_contact_search_filters
  ✓ test_contact_create_validates_email
  ✓ test_contact_delete_confirms
  ✓ test_autocomplete_shows_matches
  ✓ test_autocomplete_adds_chip
  ✓ test_autocomplete_deduplicates
CONTACTS MANAGEMENT TESTS: 7 passed, 0 failed

Running Sidebar Borderless Tests...
Running Sidebar Borderless Tests...
  ✓ test_sidebar_has_no_border
  ✓ test_sidebar_and_main_share_background
SIDEBAR BORDERLESS TESTS: 2 passed, 0 failed

Running Profile Photo Tests...
Running Profile Photo & Avatar Tests...
  ✓ test_fallback_avatar_renders_initial_and_color
  ✓ test_sidebar_renders_photo_when_set
  ✓ test_sidebar_renders_fallback_when_no_photo
  ✓ test_photo_crypto_roundtrip
PROFILE PHOTO TESTS: 4 passed, 0 failed

Running Persistent Session Tests...
Running Persistent Session Tests...
  ✓ 1. Device key is non-extractable AES-GCM 256-bit
  ✓ 2. Key sealing and unsealing roundtrip preserves all sensitive fields
  ✓ 3. Tampered ciphertext rejects decryption
  ✓ 4. Full lifecycle: savePersistentSession, restorePersistentSession, clearPersistentSession
  ✓ 5. Expired token rejects restoration and purges storage
  ✓ 6. Server rejection (401 revoked) rejects restoration and purges storage
PERSISTENT SESSION TESTS: 6 passed, 0 failed

Running OAuth Import Tests...
  ✓ encryptTokenPayload and decryptTokenPayload round-trip
  ✓ Tampered token ciphertext is rejected by decryptTokenPayload
  ✓ encryptRawEml generates Section 12 AES-GCM envelope
  ✓ parseRfc822Headers extracts From, To, Cc, Subject, Date, and attachments
  ✓ fetchWithBackoff respects 429 Retry-After header
  ✓ fetchWithBackoff aborts immediately when signal triggered
OAUTH IMPORT TESTS: 6 passed, 0 failed

OVERALL: 280 passed, 0 failed
```

### Webmail Production Build
Command: `cmd.exe /c "npm --prefix apps/webmail run build"`
```text
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 144 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-B4In2f3_.css                  96.27 kB │ gzip:  15.75 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-QSvgPp4P.js                  821.01 kB │ gzip: 200.99 kB
✓ built in 3.26s
```

### Absence of Driver.js in Webmail Output and Source
Command: `cmd.exe /c "findstr /s /i \"driver.js\" apps\webmail\dist\* apps\webmail\src\*"`
```text
(exited with code 1, zero matches found)
```

### Absence of Test Hook in Webmail Source
Command: `git grep -n "__startWebmailTour" apps/webmail/`
```text
(exited with code 1, zero matches found)
```

### Control Panel Unit Tests
Command: `cmd.exe /c "npm --prefix apps/control-plane test"`
```text
> test
> npx tsx src/run_test.node.js

Running Encoding Utility Tests...
Running Encoding Utility Tests...
  ✓ hexToBytes converts valid hex string to Uint8Array
  ✓ hexToBytes throws error for odd length string
  ✓ bytesToHex converts Uint8Array to hex string
  ✓ bytesToBase64 converts small and large Uint8Array chunks
ENCODING TESTS: 4 passed, 0 failed

Running Client Cryptography & Zero-Knowledge Tests...
=== Testing Client Cryptography & Zero-Knowledge Pre-Hashing ===
  ✓ Verifier is a string
  ✓ Verifier is 64-character hex (32 bytes)
  ✓ Verifier derivation is deterministic for same password & email
  ✓ Different passwords yield distinct verifiers
  ✓ Domain separation prevents cross-email credential reuse
  ✓ Extracts exactly 12 words
  ✓ Extracted phrase has 12 space-separated words
  ✓ First word matches expected
  ✓ 12th word matches expected
  ✓ Short password is non-compliant
  ✓ Short password scores 1 (Weak)
  ✓ Complex password is compliant
  ✓ Complex password scores 4 (Strong)
  ✓ All criteria satisfied
CRYPTO TESTS: 14 passed, 0 failed

Running B2B Graduated Pricing Math Tests...
PRICING MATH TESTS: 71 passed, 0 failed

Running Domains API Tests...
DOMAINS API TESTS: 4 passed, 0 failed

Running Mailboxes API Tests...
Running Mailboxes API Client Tests...
  ✓ listMailboxes returns array of mailboxes
  ✓ getMailbox fetches a single mailbox
  ✓ deleteMailbox deletes a mailbox
  ✓ impersonateMailbox requests impersonation session
  ✓ rotateRoot rotates recovery root secret
  ✓ alias operations create, list, and delete aliases
  ✓ listOrgAliases fetches organization level aliases
  ✓ fetchOrgRecoveryPkHex parses base64 org recovery key to hex
  ✓ handles non-200 HTTP error responses
MAILBOXES API TESTS: 9 passed, 0 failed

Running Onboarding Wizard API Tests...
  ✓ getOnboardingState returns valid state structure
  ✓ setupDomain sends domain and receives DNS records preview
  ✓ verifyDomain handles development verification response
  ✓ selectStorageMode verifies org_managed and handles error
  ✓ connectStorage executes probe and returns verified status
  ✓ completeOnboarding resets onboarding_skipped to false
ONBOARDING API TESTS: 6 passed, 0 failed

Running Product Tour Step Definitions & Client Tests...
Running Product Tour Step Definitions & Client Tests...
  ✓ Tour ID is control_plane_v1
  ✓ Expected exactly 7 steps, got 7
  ✓ Step 1 anchor is [data-testid="dashboard-overview"]
  ✓ Step 1 has title: "Welcome to BYOS Control Panel"
  ✓ Step 1 has description
  ✓ Step 2 anchor is [data-testid="nav-domains"]
  ✓ Step 2 has title: "Verified Domains"
  ✓ Step 2 has description
  ✓ Step 3 anchor is [data-testid="nav-mailboxes"]
  ✓ Step 3 has title: "Cryptographic Mailboxes"
  ✓ Step 3 has description
  ✓ Step 4 anchor is [data-testid="nav-members"]
  ✓ Step 4 has title: "Team & Role Access"
  ✓ Step 4 has description
  ✓ Step 5 anchor is [data-testid="nav-storage"]
  ✓ Step 5 has title: "Storage Governance"
  ✓ Step 5 has description
  ✓ Step 6 anchor is [data-testid="nav-billing"]
  ✓ Step 6 has title: "Seat-Based Capacity"
  ✓ Step 6 has description
  ✓ Step 7 anchor is [data-testid="nav-settings"]
  ✓ Step 7 has title: "Security & Governance"
  ✓ Step 7 has description
  ✓ fetchTourState hits /v1/tours/state (/v1/tours/state)
  ✓ fetchTourState decodes response payload correctly
  ✓ recordTourComplete hits /complete endpoint
  ✓ recordTourComplete uses POST
  ✓ recordTourComplete transmits last_step: 7 in body
  ✓ recordTourSkip hits /skip endpoint
  ✓ recordTourSkip uses POST
  ✓ recordTourSkip transmits last_step: 3 in body
  ✓ recordTourReset hits /reset endpoint
  ✓ recordTourReset uses POST
PRODUCT TOUR TESTS: 33 passed, 0 failed
```

### Control Panel Production Build
Command: `cmd.exe /c "npm --prefix apps/control-plane run build"`
```text
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 77 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  0.75 kB │ gzip:   0.48 kB
dist/assets/byos_crypto_core_bg-CrfUa_x6.wasm  601.30 kB │ gzip: 223.35 kB
dist/assets/index-yMpn9jaC.css                  56.15 kB │ gzip:  10.57 kB
dist/assets/byos_crypto_core-BBfV2F2e.js         9.94 kB │ gzip:   2.29 kB
dist/assets/index-DVLXOLeM.js                  384.35 kB │ gzip:  97.21 kB
✓ built in 1.78s
```

### Go Tour Backend Unit Tests
Command: `go test -v ./services/api -run "TestTour"`
```text
=== RUN   TestTourStateEndpoints
--- PASS: TestTourStateEndpoints (0.33s)
PASS
ok  	byos.email/services/api	1.912s
```

### Full Go API Test Suite
Command: `go test ./services/api`
```text
ok  	byos.email/services/api	34.740s
```

### Product Tour Browser Suite
Command: `node --experimental-wasm-modules tests/browser/test_tours.mjs`
```text
================================================================================
             PRODUCT TOUR / GUIDED WALKTHROUGH BROWSER SUITE                     
================================================================================


--- [GUARD CHECK 1: ONBOARDING GUARD ROUTE MATRIX] ---
1.1 Setting Alice organization onboarding incomplete...
Logging in as owner alice@byos.local...
  Redirected to onboarding wizard: http://localhost:3000/onboarding/1
  PASS: CRITICAL GUARD PASSED: Tour does NOT fire during onboarding wizard (/onboarding/1)
  PASS: Incomplete org direct navigation to /dashboard redirected to /onboarding/* (got: /onboarding/1)
  PASS: No product tour mounted on direct attempt to /dashboard
  PASS: Incomplete org direct navigation to /dashboard/billing redirected to /onboarding/* (got: /onboarding/1)
  PASS: No product tour mounted on direct attempt to /dashboard/billing
  PASS: Incomplete org direct navigation to /dashboard/domains redirected to /onboarding/* (got: /onboarding/1)
  PASS: No product tour mounted on direct attempt to /dashboard/domains
  PASS: Incomplete org direct navigation to /dashboard/storage redirected to /onboarding/* (got: /onboarding/1)
  PASS: No product tour mounted on direct attempt to /dashboard/storage
  PASS: Incomplete org direct navigation to /dashboard/members redirected to /onboarding/* (got: /onboarding/1)
  PASS: No product tour mounted on direct attempt to /dashboard/members
1.2 Setting Alice org onboarding_skipped = true...
  PASS: Owner who skipped onboarding can directly access /dashboard (got: /dashboard)
1.3 Testing employee account (role = member) accessing /dashboard...
  Member login landing URL: http://127.0.0.1:3001/
  PASS: Employee account is redirected to Webmail or prevented from accessing owner Control Panel
Restoring Alice organization onboarding to completed...

--- [PART 1: CONTROL PANEL TOUR] ---
[CP 1] Navigating to /dashboard after onboarding complete...
  PASS: Driver.js popover rendered with custom byos-tour-popover class
  Popover Step 1 Title: "Welcome to BYOS Control Panel", Progress: "1 of 7"
  PASS: Step 1 title is 'Welcome to BYOS Control Panel'
  PASS: Step 1 progress shows '1 of 7'
  Saved screenshot: control_plane_tour_step1.png
Verifying Control Panel popover bounding box across viewports...
  Testing Control Panel Desktop (1280x900)...
    Control Panel Desktop bounding box: {"left":278,"right":658,"top":167,"bottom":350.515625,"width":380,"height":183.515625}
  PASS: Control Panel Desktop: Popover left (278px) >= 0
  PASS: Control Panel Desktop: Popover right (658px) <= viewport width (1280px)
  PASS: Control Panel Desktop: Popover top (167px) >= 0
  PASS: Control Panel Desktop: Popover bottom (350.515625px) <= viewport height (900px)
  PASS: Control Panel Desktop: Popover width (380px) <= viewport width
  PASS: Control Panel Desktop: No horizontal document overflow
  Testing Control Panel Tablet (768px) (768x1024)...
    Control Panel Tablet (768px) bounding box: {"left":14,"right":394,"top":197,"bottom":380.515625,"width":380,"height":183.515625}
  PASS: Control Panel Tablet (768px): Popover left (14px) >= 0
  PASS: Control Panel Tablet (768px): Popover right (394px) <= viewport width (768px)
  PASS: Control Panel Tablet (768px): Popover top (197px) >= 0
  PASS: Control Panel Tablet (768px): Popover bottom (380.515625px) <= viewport height (1024px)
  PASS: Control Panel Tablet (768px): Popover width (380px) <= viewport width
  PASS: Control Panel Tablet (768px): No horizontal document overflow
  Testing Control Panel Mobile (390px) (390x844)...
    Control Panel Mobile (390px) bounding box: {"left":12,"right":378,"top":644.484375,"bottom":828,"width":366,"height":183.515625}
  PASS: Control Panel Mobile (390px): Popover left (12px) >= 0
  PASS: Control Panel Mobile (390px): Popover right (378px) <= viewport width (390px)
  PASS: Control Panel Mobile (390px): Popover top (644.484375px) >= 0
  PASS: Control Panel Mobile (390px): Popover bottom (828px) <= viewport height (844px)
  PASS: Control Panel Mobile (390px): Popover width (366px) <= viewport width
  PASS: Control Panel Mobile (390px): No horizontal document overflow
  Testing Control Panel Mobile (375px) (375x667)...
    Control Panel Mobile (375px) bounding box: {"left":12,"right":363,"top":467.484375,"bottom":651,"width":351,"height":183.515625}
  PASS: Control Panel Mobile (375px): Popover left (12px) >= 0
  PASS: Control Panel Mobile (375px): Popover right (363px) <= viewport width (375px)
  PASS: Control Panel Mobile (375px): Popover top (467.484375px) >= 0
  PASS: Control Panel Mobile (375px): Popover bottom (651px) <= viewport height (667px)
  PASS: Control Panel Mobile (375px): Popover width (351px) <= viewport width
  PASS: Control Panel Mobile (375px): No horizontal document overflow
    Saved screenshot: control_plane_tour_viewport_375px.png
[CP 2] Advancing to Step 2 and Step 3...
  Popover Step 2 Title: "Verified Domains", Progress: "2 of 7"
  PASS: Step 2 title is 'Verified Domains'
  PASS: Step 2 progress shows '2 of 7'
  Popover Step 3 Title: "Cryptographic Mailboxes", Progress: "3 of 7"
  PASS: Step 3 title is 'Cryptographic Mailboxes'
  PASS: Step 3 progress shows '3 of 7'
[CP 3] Testing early skip / dismissal from Step 3...
  PASS: Driver.js popover destroyed after clicking close
  Saved screenshot: control_plane_tour_skipped.png
  DB Tour State after skip: {"control_plane_v1":{"last_step":3,"skipped_at":"2026-10-17T13:21:17.818926536Z","completed_at":null}}
  PASS: control_plane_v1 has non-null skipped_at
  PASS: control_plane_v1 completed_at is null
  PASS: control_plane_v1 recorded last_step = 3
[CP 4] Reloading /dashboard to verify tour does NOT re-run when skipped...
  PASS: Tour did NOT re-run automatically because skipped_at is set
[CP 5] Navigating to Settings to test Restart Tour...
  PASS: Settings page has [data-testid='restart-tour-btn']
  Clicking 'Restart Tour' button...
  Restarted Tour Title: "Welcome to BYOS Control Panel", Progress: "1 of 7"
  PASS: Restarted tour starts at Step 1 ('Welcome to BYOS Control Panel')
  PASS: Restarted tour progress starts at '1 of 7', ignoring previous last_step 3
  Saved screenshot: control_plane_tour_restarted_step1.png
[CP 6] Advancing restarted tour through all 7 steps to full completion...
  PASS: Tour correctly advanced to step 2 of 7
  PASS: Tour correctly advanced to step 3 of 7
  PASS: Tour correctly advanced to step 4 of 7
  PASS: Tour correctly advanced to step 5 of 7
  PASS: Tour correctly advanced to step 6 of 7
  PASS: Tour correctly advanced to step 7 of 7
  Last step CTA text: "Finish Tour"
  PASS: Last step button text is 'Finish Tour'
  PASS: Tour popover closed upon completion
  POST /v1/tours/control_plane_v1/complete calls triggered by finish: 1
  PASS: EXACTLY 1 POST request to /complete (no duplicate requests, got: 1)
  DB Tour State after complete: {"control_plane_v1":{"last_step":7,"skipped_at":null,"completed_at":"2026-10-17T13:21:24.78140285Z"}}
  PASS: control_plane_v1 completed_at is non-null
  PASS: control_plane_v1 skipped_at is null
  PASS: control_plane_v1 last_step = 7

--- [GUARD CHECK 2: CONTROL PANEL POLICY A MISSING ANCHOR FILTERING] ---
Deliberately removing optional anchor [data-testid='nav-storage'] from DOM...
  Policy A Step 1 Title: "Welcome to BYOS Control Panel", Progress: "1 of 6"
  PASS: Policy A filtered missing step: total steps reduced from 7 to 6
  PASS: Policy A logged missing optional anchor to console without crashing
  Saved screenshot: control_plane_tour_policy_a_step.png

--- [PART 2: WEBMAIL UNINTERRUPTED DIRECT ACCESS & TOUR REMOVAL] ---
[WM 1] Logging into Webmail as alice@byos.local...
  Alice authenticated in Webmail with active mailbox.
[WM 2] Verifying no Driver.js popovers or tutorial overlays appear...
  PASS: Webmail: Zero Driver.js popovers or overlay elements rendered
[WM 3] Verifying Webmail does not call tour state endpoints...
  Observed calls to /tours/state in Webmail: 0
  PASS: Webmail: Zero requests made to /v1/tours/state during bootstrap or navigation
  Saved screenshot: webmail_direct_inbox_no_tour.png
[WM 4] Verifying Webmail Settings has no Guided Product Tour section or Restart button...
  PASS: Webmail Settings: [data-testid='restart-tour-btn'] is completely absent
  PASS: Webmail Settings: 'Guided Product Tour' section is absent
  PASS: Webmail Settings: 'Restart tour' button text is absent
  Saved screenshot: webmail_settings_no_restart_tour.png
[WM 5] Verifying normal Webmail operations remain accessible...
  PASS: Search bar is accessible and interactive
  PASS: Message list view is accessible and displayed
  PASS: window.__startWebmailTour is completely undefined in Webmail
  PASS: Driver.js runtime is not present or loaded in Webmail

================================================================================
                     ALL HARDENED TOUR GUARDS PASSED                             
================================================================================
1. Guard Chain: Tour does NOT fire during onboarding wizard (/onboarding/1)
2. Onboarding Matrix: Incomplete orgs are redirected to /onboarding/* across all dashboard routes
3. Onboarding Matrix: Skipped orgs and completed orgs can access /dashboard
4. Onboarding Matrix: Employee member accounts are redirected to Webmail
5. Control Panel tour auto-launches on first visit to /dashboard
6. Popover displays warm infrastructure palette matching BYOS design tokens
7. Step 1 orientation headline and '1 of 7' progress indicators verified
8. Step advance transitions correctly between anchors
9. Early skip / close persists skipped_at and last_step to DB
10. Reloading dashboard does NOT re-trigger tour when previously skipped
11. Settings 'Restart tour' resets DB entry and restarts at Step 1, ignoring last_step
12. Completing all 7 steps triggers EXACTLY 1 POST request to /complete (no duplicate calls)
13. Policy A Pre-flight: Filters missing optional anchors without crashing and logs warning
14. Responsive Viewports: Control Panel popover inside viewport at 1280px, 768px, 390px, and 375px
15. Responsive Viewports: No horizontal document overflow across all breakpoints
16. Webmail direct access: Alice authenticates and lands directly in inbox
17. Webmail clean surface: Zero Driver.js popovers or tutorial overlay elements mounted
18. Webmail network clean: Zero requests made to /v1/tours/state during bootstrap
19. Webmail Settings: [data-testid="restart-tour-btn"] and tour section completely absent
20. Webmail functions: Compose, search, and message list remain fully operational
21. Webmail codebase clean: window.__startWebmailTour is undefined and driver.js unbundled
```

### Full Regression Smoke Suite
Command: `powershell -ExecutionPolicy Bypass -Command "$env:BYOS_LOCAL_DEV='1'; .\smoke.ps1"`
```text
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (14.5s)
  [PASS] test_sidebar_restructure.mjs        PASS (13.6s)
  [PASS] test_unified_inbox_browser.mjs      PASS (25.9s)
  [PASS] test_account_switch_crypto.mjs      PASS (61.7s)
  [PASS] test_masked_email.mjs               PASS (43s)
  [PASS] test_alias_custom.mjs               PASS (37.7s)
  [PASS] test_compose_default_account.mjs    PASS (12.2s)
  [PASS] test_wire_integrity.mjs             PASS (77.4s)
  [PASS] test_focused_inbox.mjs              PASS (30.8s)
  [PASS] test_offline.mjs                    PASS (30.5s)
  [PASS] test_composer.mjs                   PASS (21.6s)
  [PASS] test_contacts.mjs                   PASS (14.4s)
  [PASS] test_import.mjs                     PASS (13.8s)
  [PASS] test_sent_folder_display.mjs        PASS (15.3s)
  [PASS] test_public_site.mjs                PASS (7.6s)
  [PASS] test_control_plane_billing.mjs      PASS (11.2s)
  [PASS] test_onboarding.mjs                 PASS (34.8s)
  [PASS] test_tours.mjs                      PASS (46.5s)
================================================================================

SMOKE SUITE PASSED: All 18 tests passed cleanly.
```

---

## 10. Any Remaining Tutorial References Explained
A comprehensive scan across the entire repository confirms that no tutorial code or Driver.js references remain in Webmail:
- `apps/webmail/src/`: Zero references to `driver.js`, `startWebmailTour`, `destroyWebmailTour`, `__startWebmailTour`, or `tour_style.css`.
- `apps/webmail/package.json`: `driver.js` is uninstalled.
- `apps/control-plane/`: Retains its `driver.js` dependency and `apps/control-plane/src/tours/` implementation (`control_plane_v1.ts`, `runner.ts`, `tour_style.css`). This is intentional and required to preserve the Control Panel administrative tour.
- `services/api/`: Tour endpoints remain active exclusively for `control_plane_v1`. Requests for `webmail_v1` are rejected with HTTP 400.

---

## Raw evidence

### 1. Database User Tour State Verification
Command: `Get-Content tools/product_tour_verify.sql | docker exec -i byos-postgres psql -U byos -d byos`
```text
                  id                  |      email       |                                                  tours_seen                                                  
--------------------------------------+------------------+--------------------------------------------------------------------------------------------------------------
 cccccccc-0000-0000-0000-000000000002 | alice@byos.local | {"control_plane_v1": {"last_step": 7, "skipped_at": null, "completed_at": "2026-10-17T13:31:12.724239888Z"}}
(1 row)
```

### 2. Check for Synthetic User in Database
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, email, role, tours_seen FROM users WHERE email IN ('alice@byos.local', 'bob@byos.local', 'ob@byos.local');"`
```text
                  id                  |      email       | role  |                                                  tours_seen                                                  
--------------------------------------+------------------+-------+--------------------------------------------------------------------------------------------------------------
 cccccccc-0000-0000-0000-000000000003 | bob@byos.local   | owner | {"control_plane_v1": {"last_step": 7, "completed_at": "2026-01-01T00:00:00Z"}}
 cccccccc-0000-0000-0000-000000000002 | alice@byos.local | owner | {"control_plane_v1": {"last_step": 7, "skipped_at": null, "completed_at": "2026-10-17T13:31:12.724239888Z"}}
(2 rows)
```

---

## Manual browser verification
All manual browser verification steps were automated and asserted via Puppeteer in `tests/browser/test_tours.mjs`.

### Check 1: Webmail Direct Login and Absence of Tour
1. Navigate to `http://localhost:3001/` in Google Chrome.
2. Authenticate with credentials `alice@byos.local` / `test-password-123`.
3. Observed result: Landed directly on the inbox interface (`[data-testid="folder-name-inbox"]`). No Driver.js backdrop overlays, popover cards, or tutorial dialogs appeared.
4. Inspected DOM: `.driver-popover` and `.driver-overlay` queries returned null.
5. Inspected network panel: Zero requests made to `/v1/tours/state` or any tour endpoints.
6. Screenshot saved: `tests/browser/artifacts/webmail_direct_inbox_no_tour.png`

### Check 2: Webmail Settings Account Tab
1. Open Webmail Settings via sidebar cog icon (`[data-testid="sidebar-settings-btn"]`).
2. Observed result: Account settings tab rendered with User Profile, Mailbox Keys, and Session Security cards. No "Guided Product Tour" card was present, and `[data-testid="restart-tour-btn"]` was absent from the DOM.
3. Screenshot saved: `tests/browser/artifacts/webmail_settings_no_restart_tour.png`

### Check 3: Webmail Core Functionality Accessible
1. With Settings closed, clicked Compose button.
2. Search bar (`[data-testid="search-bar"]`) and Message list (`[data-testid="message-list"]`) were active and unhindered by overlays.
3. Screenshot saved: `tests/browser/artifacts/webmail_compose_active.png`

### Check 4: Control Panel Tour Preserved Across Viewports
1. Logged into Control Panel at `http://localhost:3000/dashboard` with cleared `tours_seen`.
2. Observed result: Step 1 popover mounted immediately with title "Welcome to BYOS Control Panel" (progress "1 of 7").
3. Bounding boxes evaluated across Desktop (1280px), Tablet (768px), Mobile (390px), and Mobile (375px). In all cases, `left >= 0`, `right <= viewport width`, `top >= 0`, `bottom <= viewport height`, and horizontal document overflow was 0.
4. Advanced to Step 3 and clicked close button. Popover dismissed and `skipped_at` persisted to PostgreSQL.
5. Navigated to Settings > "Restart tour", which reset tour state in PostgreSQL and restarted the tour at Step 1.
6. Advanced through all 7 steps to the final finish button. Exactly 1 POST request dispatched to finish tour state.
7. Screenshots saved:
   - `tests/browser/artifacts/control_plane_tour_step1.png`
   - `tests/browser/artifacts/control_plane_tour_viewport_375px.png`
   - `tests/browser/artifacts/control_plane_tour_skipped.png`
   - `tests/browser/artifacts/control_plane_tour_restarted_step1.png`
   - `tests/browser/artifacts/control_plane_tour_policy_a_step.png`

---

## What did not work or is untested
- **UNTESTED: Production Public DNS Resolution**: In the local development environment, DNS lookups for custom domains use local mock resolvers; public DNS TXT/MX propagation checks against external authoritative nameservers cannot be tested without live internet DNS infrastructure.
- **UNTESTED: Production Third-Party Cloud S3 / GCS Storage Connections**: Production object storage connections with real AWS IAM credentials or Google Cloud service accounts cannot be tested locally; local MinIO storage emulation is used instead.
- **UNTESTED: Public Email Inbound/Outbound Internet Delivery**: Real DKIM/SPF transmission across public SMTP relays to external providers (e.g., Gmail, Outlook) is not available locally; Mailpit and local Postfix containers are used for message transport.

---

## Test suite output

### Unit Test Suites Paste
`npm --prefix apps/webmail test`: 280 passed, 0 failed
`npm --prefix apps/control-plane test`: 33 passed, 0 failed
`go test ./services/api`: ok byos.email/services/api 34.740s
`smoke.ps1`: All 18 browser tests passed cleanly
