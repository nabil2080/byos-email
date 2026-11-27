# BYOS Release C1.2: Final Email Rendering Security Closure Report

## What was built
Resolved the CSP and `<base>` inconsistency in the sandboxed iframe email rendering pipeline by completely removing `<base>` and enforcing strict CSP `base-uri 'none'`, which eliminated browser console violation warnings in Chromium while preventing base-URI hijacking. Hardened incoming link scheme validation in `sanitizeOnReceive()` to strictly permit only `https:`, `http:`, and `mailto:` schemes with `target="_blank"` and `rel="noopener noreferrer"`, while stripping unsafe schemes (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`) and relative or protocol-relative links. Implemented generation-identity tracking (`activeLoadGeneration`) and message identity verification in `ReadingPane.tsx` to discard stale in-flight asynchronous decryptions when switching messages rapidly or closing the pane. Enforced strict inline media resource bounds: per-image limit (`MAX_SINGLE_INLINE_BYTES` = 10 MB), aggregate per-message limit (`MAX_TOTAL_INLINE_BYTES` = 25 MB binary / ~33.3 MB base64 heap), and image count limit (`MAX_INLINE_IMAGE_COUNT` = 25), with raster magic-byte validation rejecting SVG and active payloads. Modularized the pure iframe generator in `reading_pane_isolation.ts` and updated `tests/browser/test_reading_pane_security_isolation.mjs` to directly import and test the actual production logic in Chromium.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/composer_sanitizer.ts` | Restrict link schemes in `sanitizeOnReceive()` and `sanitizeOnSend()` to `https:`, `http:`, and `mailto:`, stripping unsafe schemes and relative links. |
| `apps/webmail/src/composer_sanitizer.test.ts` | Added unit tests verifying rejection of unsafe link schemes (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`), relative links, and protocol-relative URLs. |
| `apps/webmail/src/components/reading_pane_isolation.ts` | Modularized pure iframe HTML document builder `buildIsolatedIframeDoc`, resource bounds constants, and raster magic-byte validator. |
| `apps/webmail/src/components/ReadingPane.tsx` | Integrated generation-identity tracking for asynchronous decryption, enforced media limits, and delegated iframe generation to `buildIsolatedIframeDoc`. |
| `apps/webmail/src/components/notes/NotesEditor.tsx` | Aligned top header actions bar surface styling to `bg-[#FAF9F6] dark:bg-[#18191D]` to match the email ReadingPane aesthetic. |
| `tests/browser/test_reading_pane_security_isolation.mjs` | Imported actual `buildIsolatedIframeDoc` and tested CSP `base-uri 'none'`, link rejection, media limits, and generation cancellation in Chromium. |
| `tests/browser/artifacts/reading_pane_html_isolation_verified.png` | Saved live browser verification screenshot capturing the isolated sandboxed iframe and parent host state. |
| `docs/email_html_isolation_release_c1_2_final_closure_report.md` | Final security closure verification report with raw pasted terminal evidence and documented limitations. |

## Raw evidence

### 1. Browser Security Isolation Suite (`tests/browser/test_reading_pane_security_isolation.mjs`)
Command:
```powershell
npx tsx tests/browser/test_reading_pane_security_isolation.mjs
```
Output:
```
================================================================================
     BYOS RELEASE C1.2: READING PANE HTML ISOLATION BROWSER SECURITY TESTS      
================================================================================

--- [CHECK 1] Set up parent Webmail host document ---
  [PASS] Parent Webmail context initialized with canary token and sensitive keys

--- [CHECK 2] Script execution blocked in sandboxed iframe ---
  [PASS] Parent canary is intact (no script executed)
  [PASS] Parent DOM isolation verified: iframe.contentDocument is inaccessible/null

--- [CHECK 3] Base URI consistency and incoming link scheme verification ---
  [PASS] HTTPS link preserved with target and rel
  [PASS] HTTP link preserved with target and rel
  [PASS] Mailto link preserved with target and rel
  [PASS] javascript: link rejected
  [PASS] data: link rejected
  [PASS] vbscript: link rejected
  [PASS] file: link rejected
  [PASS] blob: link rejected
  [PASS] protocol-relative link rejected
  [PASS] relative path link rejected
  [PASS] root-relative link rejected
  [PASS] Iframe document omits <base> element completely
  [PASS] Iframe document enforces CSP directive: base-uri 'none'
  [PASS] Zero CSP violation warnings in browser console (found: 0)

--- [CHECK 4] Parent-window navigation attempts blocked ---
  [PASS] Sanitizer rewrites target="_top"
  [PASS] Sanitizer rewrites target="_parent"
  [PASS] Sanitizer forces target="_blank"
  [PASS] Sanitizer forces rel="noopener noreferrer"

--- [CHECK 5] Remote tracker images blocked by default ---
  [PASS] Tracker detected and marked as blocked
  [PASS] Tracker replaced with inert raster 1x1 PNG data URI
  [PASS] Zero network requests dispatched to remote tracker domain

--- [CHECK 6] CSS remote leaks and url() blocked in style attributes ---
  [PASS] Sanitizer stripped CSS url(...) declaration
  [PASS] Sanitizer eliminated remote leak endpoint
  [PASS] Sanitizer preserved benign typography color

--- [CHECK 7] Plain-text email escaping inside isolated frame ---
  [PASS] Literal <script> in plain text was safely escaped and did not execute

--- [CHECK 8] Safe raster inline images render; SVG data URIs blocked ---
  [PASS] Safe raster inline image passed to srcdoc with valid PNG data URI
  [PASS] Sanitizer strictly stripped data:image/svg+xml
  [PASS] Sanitizer stripped onload attribute

--- [CHECK 9] Stale inline decryption prevention & aggregate resource bounds ---
  [PASS] MAX_SINGLE_INLINE_BYTES is bounded to 10 MB
  [PASS] MAX_TOTAL_INLINE_BYTES is bounded to 25 MB
  [PASS] MAX_INLINE_IMAGE_COUNT is bounded to 25 images
  [PASS] Validates PNG magic bytes
  [PASS] Validates JPEG magic bytes
  [PASS] Validates GIF magic bytes
  [PASS] Rejects SVG mime type and headers
  [PASS] Stale in-flight decryption from msg-A was discarded and did not populate msg-B state
  [PASS] Legitimate msg-B decryption resolved and populated current state

  ✓ Saved browser verification screenshot to: F:\Codex\byos-email\tests\browser\artifacts\reading_pane_html_isolation_verified.png

================================================================================
  ALL 9 BROWSER SECURITY ISOLATION CHECKS PASSED (0 FAILURES)
================================================================================
```

### 2. Composer & Sanitizer Isolated Unit Tests (`apps/webmail/src/composer_sanitizer.test.ts`)
Command:
```powershell
cmd /c "cd apps\webmail && npx tsx -e ""import { runComposerSanitizerTests } from './src/composer_sanitizer.test'; runComposerSanitizerTests().then(r => console.log('RESULTS:', r));"""
```
Output:
```
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
  ✓ test_sanitize_does_not_leak_hooks_across_calls
  ✓ test_sanitize_strips_svg_data_uris
  ✓ test_sanitize_strips_css_url_remote_loading
  ✓ test_sanitize_strips_css_expression_and_import
  ✓ test_sanitize_forbids_svg_and_mathml_tags
  ✓ test_sanitize_strips_all_event_handlers
  ✓ test_sanitize_enforces_target_blank_and_rel_noopener
  ✓ test_sanitize_overwrites_target_top_and_parent
  ✓ test_sanitize_handles_malformed_html_safely
  ✓ test_sanitize_rejects_unsafe_and_relative_link_schemes
RESULTS: { passed: 19, failed: 0 }
```

### 3. Notes Mobile Drawer Verification Suite (`tests/browser/notes_mobile_drawer.mjs`)
Command:
```powershell
node tests/browser/notes_mobile_drawer.mjs
```
Output:
```
==============================================================================
  BYOS NOTES: MOBILE DRAWER, ANIMATION & LIST-FIRST LAYOUT VERIFICATION
==============================================================================

--- [STEP 1] Login as Alice ---
  [PASS] [AUTH] Login as Alice succeeded
         Details: account-chip-selector mounted

--- [STEP 2] Open Notes module (desktop, nothing selected) ---
  [PASS] [DESKTOP_SIDEBAR_INLINE] Desktop sidebar is the 256px in-flow pane
         Details: width=256px position=static
  [PASS] [DESKTOP_NO_BACKDROP] Desktop renders no mobile backdrop
         Details: backdropDisplay=none
  [PASS] [DESKTOP_LIST_ONLY] Desktop shows the list only until a note is clicked
         Details: listWidth=1122px editorMounted=false

--- [STEP 3] Resize to 375px phone viewport ---
  [PASS] [MOBILE_LIST_FIRST] Notes opens on the note list, not the navigation sidebar
         Details: listVisible=true shellOpen=false transformX=-100
  [PASS] [MOBILE_NO_HSCROLL] No horizontal scroll at 375px
         Details: doc=375 body=375 viewport=375
  [PASS] [MOBILE_DRAWER_ANIMATION] Drawer slides (transform + visibility) and backdrop fades (opacity)
         Details: shell=translate, visibility 0.2s; backdrop=opacity 0.2s

--- [STEP 4] Open the mobile navigation drawer ---
  [PASS] [MOBILE_DRAWER_OVERLAY] Drawer is a fixed overlay flush to the left edge
         Details: open=true position=fixed left=0px top=0px transformX=0
  [PASS] [MOBILE_DRAWER_WIDTH] Drawer uses the Mail/Calendar 288px drawer width (max 85vw)
         Details: width=288px (max 319px)
  [PASS] [MOBILE_DRAWER_FULL_HEIGHT] Drawer spans the full viewport height
         Details: height=760px viewport=760px
  [PASS] [MOBILE_DRAWER_BACKDROP] Dimmed backdrop is present while the drawer is open
         Details: backdropShown=true opacity=1

--- [STEP 5] Drawer dismissal paths ---
  [PASS] [DRAWER_CLOSES_BACKDROP] Backdrop click closes the drawer and returns to the list
         Details: shellOpen=false listVisible=true transformX=-100 backdropShown=false
  [PASS] [SHELL_STAYS_MOUNTED] Closed drawer stays mounted off-canvas so the slide-out can play
         Details: mounted=true transformX=-100

--- [STEP 5B] Sample the close animation frame by frame ---
  [PASS] [DRAWER_ANIMATES_CLOSE] Closing the drawer interpolates through intermediate translate positions
         Details: samples=[0,-3,-16,-35,-50,-61,-69,-75,-80,-84,-88,-91,-93,-95]
  [PASS] [DRAWER_CLOSES_ESCAPE] Escape closes the drawer
         Details: shellOpen=false transformX=-100
  [PASS] [DRAWER_CLOSES_NAV] Selecting a navigation item closes the drawer
         Details: shellOpen=false listVisible=true

--- [STEP 6] Note selection opens the editor ---
  [PASS] [EDITOR_OPENS_ON_CLICK] Clicking a note opens the editor pane
         Details: editorBefore=false editorAfter=true

--- [STEP 7] Desktop split view after selection ---
  [PASS] [DESKTOP_SPLIT_ON_SELECT] Desktop splits into a 320-350px list plus the editor after a note is clicked
         Details: list=350px editor=772px
  [PASS] [NO_PAGE_ERRORS] No uncaught page errors during the run
         Details: none

==============================================================================
  SUMMARY: 19/19 checks passed
==============================================================================
```

### 4. TypeScript Diagnostics (`npx tsc --noEmit`)
Command:
```powershell
cmd /c "cd apps\webmail && npx tsc --noEmit"
```
Output:
```
src/offline.test.ts(460,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
src/offline.test.ts(619,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(620,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(621,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(622,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(623,28): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(624,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(625,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(626,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(626,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
src/offline.test.ts(861,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
```
*(Diagnostics confirm zero errors in `ReadingPane.tsx`, `reading_pane_isolation.ts`, `composer_sanitizer.ts`, or any production code. All errors are strictly confined to pre-existing `offline.test.ts`.)*

### 5. Production Application Build (`npm run build`)
Command:
```powershell
cmd /c "cd apps\webmail && npm run build"
```
Output:
```
> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 338 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                    1.86 kB │ gzip:   0.88 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-D_MgnkLV.css                   172.38 kB │ gzip:  26.12 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-BvJ-WEWJ.js                  3,588.84 kB │ gzip: 778.10 kB

✓ built in 8.65s
```

## Manual browser verification
1. **Navigated to preview server:** Opened `http://127.0.0.1:3001` with headless Chrome under Puppeteer control.
2. **Injected parent canaries:** Initialized `window.__parent_canary = "SENSITIVE_PARENT_DATA"`, `localStorage.setItem("byos_session_token", "SECRET_TOKEN_XYZ_123")`, and `sessionStorage.setItem("byos_mailbox_sk", "SENSITIVE_MAILBOX_KEY")`.
3. **Mounted actual `buildIsolatedIframeDoc` document:** Created an `<iframe>` with `sandbox="allow-popups allow-popups-to-escape-sandbox"` and loaded the production-generated document containing malicious exploit payloads (`<script>`, `onerror`, `target="_top"`, remote tracking image, CSS `url(...)`, and unsafe link schemes).
4. **Asserted boundary isolation:**
   - Evaluated `window.__parent_canary` remains `"SENSITIVE_PARENT_DATA"`.
   - Evaluated `iframe.contentDocument` is inaccessible (`null` or cross-origin access exception).
   - Confirmed 0 network requests dispatched to tracking domains.
   - Inspected console warnings and confirmed 0 CSP violation warnings.
5. **Saved verification artifact:** Captured visual proof to `tests/browser/artifacts/reading_pane_html_isolation_verified.png`.

## What did not work or is untested
- **Go Backend API Endpoints on Port 8080:** During initial cold runs without a running Go API daemon, tests that depend on backend network calls (such as `/v1/auth/me` or `/v1/keys/...`) fall back to local mock data. All clientside rendering, CSP containment, sanitization, and browser sandbox isolation were verified in a live Chromium browser running against the webmail application at `http://127.0.0.1:3001`.
- **Pre-existing TypeScript Errors in `offline.test.ts`:** `src/offline.test.ts` contains 10 pre-existing type check errors relating to possible undefined indexing on offline store items. In compliance with Rule 10 and test file preservation discipline, `offline.test.ts` was not modified as it is outside the scope of Release C1.2.

## Test suite output
Command:
```powershell
cmd /c "cd apps\webmail && npm test"
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:10588) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=3deeb012-babb-42e5-9775-7f5e9a0a4831 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=cda3cf58-2e3e-4bf5-8b7d-fee12b912bf5 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[Worker Crypto] Decryption failed for attachment_id=cc62f28d-2596-459e-ae7a-72c7e52aaa11 chunk_index=0
  ✓ Path A recipient cannot decrypt sender chunks
  ✓ Protocol v2 golden test vectors match Rust crypto-core
  ✓ Protocol v2 owner encrypt/decrypt + outbound grant roundtrip + tamper rejection
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed

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
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: non-secret display metadata is preserved
  ✓ test_expired_token_shows_specific_error: error message names the specific account
  ✓ test_expired_token_shows_specific_error: does not show generic unauthorized error
  ✓ test_expired_token_shows_specific_error: expired account is removed from sidebar
  ✓ test_expired_token_shows_specific_error: storage updated without expired account
  ✓ test_switch_loads_target_account: switched to Account B
  ✓ test_switch_loads_target_account: active account is Account B
  ✓ test_switch_loads_target_account: Account B is first in accounts list
  ✓ test_switch_loads_target_account: target account credentials intact
  ✓ test_switch_loads_target_account: other account credentials intact
  ✓ test_token_isolation: active account has correct session token
  ✓ test_token_isolation: passive account has distinct session token
  ✓ test_token_isolation: active account has correct mailbox SK
  ✓ test_token_isolation: passive account has distinct mailbox SK
  ✓ test_token_isolation: no shared tokens between accounts
  ✓ test_token_isolation: no shared keys between accounts
  ✓ test_token_isolation: publication record for Account A exists
  ✓ test_token_isolation: publication record for Account B exists
  ✓ test_token_isolation: publication records are distinct
  ✓ test_token_isolation: active account uses its own publication record
  ✓ test_token_isolation: passive account retains its own publication record
  ✓ test_token_isolation: cross-account key derivation produces different results
MULTI-ACCOUNT & STORAGE SYNC TESTS: 47 passed, 0 failed

Running Session Inactivity Timeout Tests...
  ✓ 1. Initial activity timestamp is set
  ✓ 2. Activity within timeout window extends session
  ✓ 3. Inactivity exceeding timeout triggers expiration
  ✓ 4. Custom timeout duration is respected
  ✓ 5. Keyboard event resets activity timer
  ✓ 6. Mouse movement resets activity timer
  ✓ 7. Touch event resets activity timer
  ✓ 8. Focus event resets activity timer
  ✓ 9. Activity recording throttled to at most once per 30 seconds
  ✓ 10. Clear activity removes storage timestamp
  ✓ 11. Warning threshold detected before timeout
  ✓ 12. Multiple rapid events generate only one storage write
SESSION TIMEOUT TESTS: 12 passed, 0 failed

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
  ✓ test_sanitize_does_not_leak_hooks_across_calls
  ✓ test_sanitize_strips_svg_data_uris
  ✓ test_sanitize_strips_css_url_remote_loading
  ✓ test_sanitize_strips_css_expression_and_import
  ✓ test_sanitize_forbids_svg_and_mathml_tags
  ✓ test_sanitize_strips_all_event_handlers
  ✓ test_sanitize_enforces_target_blank_and_rel_noopener
  ✓ test_sanitize_overwrites_target_top_and_parent
  ✓ test_sanitize_handles_malformed_html_safely
  ✓ test_sanitize_rejects_unsafe_and_relative_link_schemes
COMPOSER SANITIZER TESTS: 19 passed, 0 failed

Running Contacts Autocomplete & Address Resolution Tests...
  ✓ 1. Correct formatAddress output for name + address
  ✓ 2. Correct formatAddress output for address only
  ✓ 3. Search matching display name prefix
  ✓ 4. Search matching email address prefix
  ✓ 5. Case-insensitive query matching
  ✓ 6. Contact chips show name, email, and avatar fallback
  ✓ 7. Contact chip keyboard navigation
  ✓ 8. Removing contact chip restores remaining chips
  ✓ 9. External sender badge correctly flagged
  ✓ 10. Organization member contact receives org badge
  ✓ 11. Custom address book entry without org receives regular contact styling
  ✓ 12. Deduplication of suggested contacts across sources
CONTACTS TESTS: 12 passed, 0 failed

Running Calendar Timezone Engine Tests...
  ✓ 1. Converts UTC event time to target timezone correctly
  ✓ 2. Detects local vs event timezone mismatch
  ✓ 3. Formats dual-timezone display string accurately
  ✓ 4. Preserves UTC instant across timezone conversions
  ✓ 5. Handles daylight saving transitions cleanly
  ✓ 6. Renders timezone abbreviation according to DST state
  ✓ 7. Default to local timezone when event timezone is unspecified
  ✓ 8. Parses ISO strings with explicit offset into correct target timezone
  ✓ 9. Supports all major IANA timezone identifiers
  ✓ 10. Day/Week grid slot calculation respects timezone offset
CALENDAR TIMEZONE TESTS: 10 passed, 0 failed

Running Calendar View Grid & All-Day Rendering Tests...
  ✓ 1. Multi-day event spanning 3 days computes span of 3
  ✓ 2. All-day event returns span of 1
  ✓ 3. Single-day timed event returns span of 1
  ✓ 4. Event ending before start clamps to 1
  ✓ 5. Month view grid generates exactly 35 or 42 cells
  ✓ 6. Multi-day event in month view computes start column and day span
  ✓ 7. All-day section in week view groups and orders multi-day banners above single-day
  ✓ 8. Timed events compute correct top offset and height based on hours
  ✓ 9. Event spanning across week boundary calculates remaining days for week
  ✓ 10. All-day row collapses when no all-day events are present
CALENDAR GRID & ALL-DAY TESTS: 10 passed, 0 failed

Running ICS Import & Export RFC 5545 Compliance Tests...
  ✓ 1. Export produces valid VCALENDAR with PRODID and VERSION:2.0
  ✓ 2. Single event exports VEVENT with UID, DTSTAMP, DTSTART, DTEND, SUMMARY
  ✓ 3. All-day event exports VALUE=DATE without time component
  ✓ 4. Timed event exports UTC format with Z suffix
  ✓ 5. Escapes special characters (commas, semicolons, backslashes, newlines)
  ✓ 6. Folds lines exceeding 75 octets with CRLF space per RFC 5545 Section 3.1
  ✓ 7. Roundtrip single event preserves all fields
  ✓ 8. Roundtrip multi-day all-day event preserves start and end dates
  ✓ 9. Parses multi-event ICS file into individual events
  ✓ 10. Preserves recurrence rules (RRULE) in export
  ✓ 11. Handles DESCRIPTION and LOCATION fields
  ✓ 12. Generates unique UIDs for exported events
ICS COMPLIANCE TESTS: 12 passed, 0 failed

Running Calendar Keyboard Navigation & Accessibility Tests...
  ✓ 1. Arrow keys navigate between cells
  ✓ 2. Tab navigates between interactive elements
  ✓ 3. Enter opens selected event details
  ✓ 4. Escape closes open modals and menus
  ✓ 5. Grid cells have correct ARIA roles and labels
  ✓ 6. Focus indicator visible on keyboard navigation
  ✓ 7. Screen reader announcements on date navigation
  ✓ 8. Month/Week/Day view switch preserves focused date
CALENDAR A11Y TESTS: 8 passed, 0 failed

Running Calendar Conflict Detection Engine Tests...
  ✓ 1. Detects exact overlapping time intervals
  ✓ 2. Detects partial overlapping time intervals
  ✓ 3. Back-to-back events do not conflict
  ✓ 4. All-day events do not create timed conflicts
  ✓ 5. Detects overlapping events across multiple calendars
  ✓ 6. Conflict warning renders correct overlapping event titles
  ✓ 7. Suggested resolution finds next available slot
CALENDAR CONFLICT DETECTION TESTS: 7 passed, 0 failed

Running Unified Calendar Event Store Tests...
  ✓ 1. Initial state has zero events
  ✓ 2. Add event updates store and indexed lookup
  ✓ 3. Update event modifies fields and preserves UID
  ✓ 4. Delete event removes from store and cleanup indices
  ✓ 5. Filter events by date range returns only intersecting events
  ✓ 6. Filter events by calendar ID isolates calendars
  ✓ 7. Batch import adds multiple events idempotently
  ✓ 8. Clear store resets all state
UNIFIED CALENDAR STORE TESTS: 8 passed, 0 failed

Running Calendar RSVP & Participation Tests...
  ✓ 1. RSVP accepted updates status to ACCEPTED
  ✓ 2. RSVP tentative updates status to TENTATIVE
  ✓ 3. RSVP declined updates status to DECLINED
  ✓ 4. RSVP generates RFC 5545 compliant counter-invitation or status ICS
  ✓ 5. Sender verification displays badge for trusted domain
  ✓ 6. Unverified sender shows security warning banner
RSVP & PARTICIPATION TESTS: 6 passed, 0 failed

Running Email-to-Calendar Event Detection Tests...
  ✓ 1. Detects meeting invitation keywords in subject and body
  ✓ 2. Extracts ISO date and time from natural text
  ✓ 3. Suggestion card renders extracted title, date, time, and category
  ✓ 4. Clicking 'Add to Calendar' creates event and links messageId
  ✓ 5. Dismiss suggestion stores dismissal record in settings
  ✓ 6. Linked event shows 'View in Calendar' button
  ✓ 7. Category keywords correctly detected for flight, hotel, and dinner
EMAIL-TO-CALENDAR DETECTION TESTS: 7 passed, 0 failed

Running Recurring Event Series & Exception Tests...
  ✓ 1. Daily recurrence expands correct daily instances
  ✓ 2. Weekly recurrence respects BYDAY rule
  ✓ 3. Monthly recurrence calculates correct day of month
  ✓ 4. Recurrence with COUNT stops after specified instances
  ✓ 5. Recurrence with UNTIL stops before specified date
  ✓ 6. Exception date (EXDATE) skips specific recurring instance
  ✓ 7. Modified instance (RECURRENCE-ID) overrides master event for that date
  ✓ 8. Deleting single occurrence creates EXDATE without deleting series
RECURRING EVENTS TESTS: 8 passed, 0 failed

Running Calendar Search Engine Tests...
  ✓ 1. Search by title matches substring case-insensitively
  ✓ 2. Search by location matches substring
  ✓ 3. Search by description matches content
  ✓ 4. Search by attendee matches name or email
  ✓ 5. Empty search query returns all events in range
  ✓ 6. Multi-word query matches all terms
CALENDAR SEARCH TESTS: 6 passed, 0 failed

Running Calendar Mini-Month Widget Tests...
  ✓ 1. Mini-month renders correct days for current month
  ✓ 2. Clicking day navigates main calendar to selected date
  ✓ 3. Days with events render visual indicator dot
  ✓ 4. Selected date receives highlight ring
  ✓ 5. Month navigation arrows advance and regress mini-month view
MINI-MONTH WIDGET TESTS: 5 passed, 0 failed

Running Task & Calendar Integration Tests...
  ✓ 1. Task with due date appears in calendar day view
  ✓ 2. Completed task shows checked status and strikethrough in calendar
  ✓ 3. Dragging task updates due date
  ✓ 4. Creating task from calendar date pre-fills due date
  ✓ 5. Task list filter isolates tasks by calendar
TASK INTEGRATION TESTS: 5 passed, 0 failed

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
HISTORICAL REACTIVATION PREFLIGHT TESTS: 12 passed, 0 failed

Running Track 4: Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...
  ✓ Track 4.1: encryptNotesMedia & decryptNotesMedia perform authenticated AES-GCM roundtrip
[notesStore] WASM AES-GCM media decryption failed: decryption failed
[notesStore] WASM AES-GCM media decryption failed: decryption failed
  ✓ Track 4.2: decryptNotesMedia fails closed on wrong key or tampered ciphertext
  ✓ Track 4.3: saveMediaToIDB encrypts dataUrl in IndexedDB and redacts plaintext
  ✓ Track 4.4: getMediaFromIDB supports legacy unencrypted media fallback
  ✓ Track 4.5: offloadMediaIfDataUrl creates idb pointer and encrypts when key is provided
  ✓ Track 4.6: folderCounts correctly aggregates inbox, drafts, sent, trash, and snoozed
  ✓ Track 4.7: Bridge status transitions correctly based on health and credentials
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
  ✓ Worker bridge ping heartbeat succeeds over message channel
  ✓ Argon2id passphraseWrapKey & passphraseUnwrapKey roundtrip offloaded correctly
  ✓ autoUnwrapKeys derives mailboxSk, signingSeed, xwingSeed, and searchKey off-thread
  ✓ X-Wing hybrid envelope seal and open roundtrip via worker pipeline
  ✓ Multi-chunk AES-256-GCM attachment prepare and decrypt roundtrip
[Worker Crypto] Decryption failed for attachment_id=c508a0e8-0deb-4a7b-994b-88756c9c335a chunk_index=1
  ✓ Tampered attachment chunk is isolated and reports specific chunk index
  ✓ Worker rejects invalid operations and returns structured error
  ✓ Worker bridge enforces operation timeout and cleans pending request
[CryptoWorkerBridge] Worker error encountered: Out of memory simulated crash
  ✓ Worker error event triggers crash cleanup and rejects pending requests
  ✓ Transferable ArrayBuffer detaches buffer on message channel dispatch
  ✓ zeroizeBuffer wipes sensitive in-memory bytes to 0
  ✓ Dispatches multiple concurrent operations across the worker message channel without interference
  ✓ Direct execution fallback mode operates reliably when worker is disabled
OFF-THREAD CRYPTO WORKER TESTS: 13 passed, 0 failed

Running Subscriptions & Unsubscribe Store Tests...
  ✓ 1. TestExtractCleanEmailAndDisplayName
  ✓ 2. TestExtractUnsubscribeLinkFromHeadersAndBody
  ✓ 3. TestUnsubscribeAndResubscribeLifecycle
  ✓ 4. TestDetectSubscriptionsAggregatesMessages
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
  ✓ 1. TestExtractCleanEmailAddress
  ✓ 2. TestDefaultPolicyIsAsk
  ✓ 3. TestAlwaysAllowLifecycle
  ✓ 4. TestClearSenderPreference
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
  ✓ parses category keywords correctly
  ✓ parses 'Coffee with Sarah tomorrow 3pm'
  ✓ parses 'Design review Friday 10am 45m'
  ✓ parses time range 'Team standup 2pm-3:30pm'
  ✓ parses explicit date 'Dentist appointment Nov 12 at 2pm'
  ✓ parses all-day event 'Alice Birthday Nov 20 all-day'
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
  ✓ detectLanguage identifies supported scripts and stop words
  ✓ getLanguageName maps language codes correctly
  ✓ translateEmail returns identical content when source and target match
  ✓ translateEmail preserves HTML tags, attributes, and structure
  ✓ translateEmail preserves casing in Latin scripts
  ✓ translateEmail translates CJK and Arabic to English without screaming all-caps
  ✓ translateEmail does not replace subwords like 'Othello' or 'shell'
  ✓ translateEmail prioritizes longer multi-word phrases over single words
  ✓ translateEmail roundtrip between English and Spanish
  ✓ translateEmail translates into French, German, and Hindi
  ✓ translateEmail translates full email paragraphs without leaving untranslated English words
  ✓ translateEmail translates corporate email into Chinese and Russian with zero residual English
  ✓ t helper returns correct localized UI strings across all supported locales
  ✓ t helper interpolates dynamic params accurately without affecting proper nouns
  ✓ t helper gracefully falls back to English and key itself for unknown keys
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
  ✓ 1. TestDraftMappingPreservesFolderAndFlags
  ✓ 2. TestDraftsInTrashFilterCorrectly
  ✓ 3. TestMovingDraftToTrashAndRestoreInState
  ✓ 4. TestPermanentDeleteFiltersMessage
  ✓ 5. TestEmptyTrashFiltersAllTrashItems
  ✓ 6. TestReadingPaneDraftDetectionInTrash
  ✓ 7. TestUndoActionStoresPreviousAndTargetFolder
  ✓ 8. TestSentMessageMoveRestrictions
  ✓ 9. TestSnoozeRestrictions
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 727 passed, 0 failed
```

## Conclusion

**ACCEPTED WITH DOCUMENTED LIMITATIONS**
All security invariants specified in BYOS Release C1.2 have been implemented and verified in Chromium:
1. Base URI inconsistency is resolved by omitting `<base>` and strictly enforcing CSP `base-uri 'none'`, yielding zero browser console warnings.
2. Incoming link schemes are strictly bounded to `https:`, `http:`, and `mailto:` with `target="_blank"` and `rel="noopener noreferrer"`. Unsafe schemes and relative URLs are stripped.
3. Stale in-flight asynchronous decryptions are safely cancelled and discarded upon rapid message switching or pane close via generation-identity tracking (`activeLoadGeneration`).
4. Total inline media consumption is bounded by per-image (10 MB), aggregate per-message (25 MB), and image count (25) ceilings, accompanied by raster magic-byte validation.
5. The live browser security isolation suite directly imports and validates the production `buildIsolatedIframeDoc` output, with all 9 checks passing.
Documented limitation: pre-existing type check errors in `offline.test.ts` remain isolated and unchanged per Rule 10 test file preservation directives.
