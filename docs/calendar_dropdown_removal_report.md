# Calendar Month Dropdown Removal Report

## What was built
Completely removed the collapsible mini-month calendar dropdown picker from the mobile calendar header (`MobileCalendarHeader.tsx`). The dropdown popover container, backdrop overlay, interactive toggle state, and chevron trigger icon were eliminated, transforming the period indicator into a clean, non-clickable semantic heading that displays the current view period title without triggering any popovers or layout shifts.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/calendar/MobileCalendarHeader.tsx` | Completely removed the collapsible mini-month picker dropdown, backdrop, chevron icon, and toggle state. |
| `tests/browser/verify_calendar_dropdown_removal.mjs` | Automated browser verification exercising real login, calendar navigation, and confirming dropdown absence across viewports. |

## Raw evidence
Diff of changes to `apps/webmail/src/components/calendar/MobileCalendarHeader.tsx`:
```diff
diff --git a/apps/webmail/src/components/calendar/MobileCalendarHeader.tsx b/apps/webmail/src/components/calendar/MobileCalendarHeader.tsx
index ddda604..bec7519 100644
--- a/apps/webmail/src/components/calendar/MobileCalendarHeader.tsx
+++ b/apps/webmail/src/components/calendar/MobileCalendarHeader.tsx
@@ -1,10 +1,9 @@
 import { Component, createSignal, Show } from "solid-js";
-import { MiniMonthPicker } from "./MiniMonthPicker";
 
 export interface MobileCalendarHeaderProps {
   periodTitle: string;
-  selectedDate: Date;
-  onSelectDate: (d: Date) => void;
+  selectedDate?: Date;
+  onSelectDate?: (d: Date) => void;
   onToday: () => void;
   onOpenSidebar: () => void;
   searchQuery: string;
@@ -14,16 +13,10 @@ export interface MobileCalendarHeaderProps {
 }
 
 export const MobileCalendarHeader: Component<MobileCalendarHeaderProps> = (props) => {
-  const [isMonthPickerOpen, setIsMonthPickerOpen] = createSignal(false);
   const [isSearchOpen, setIsSearchOpen] = createSignal(false);
 
   const todayDateNum = () => new Date().getDate();
 
-  const userInitial = () => {
-    if (!props.currentUserEmail) return "U";
-    return props.currentUserEmail.charAt(0).toUpperCase();
-  };
-
   return (
     <header
       class="md:hidden relative flex items-center justify-between px-2.5 py-2 h-14 bg-[#F0EEE9] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex-shrink-0 select-none z-30"
@@ -33,7 +26,7 @@ export const MobileCalendarHeader: Component<MobileCalendarHeaderProps> = (props
         when={isSearchOpen()}
         fallback={
           <>
-            {/* ── Left Cluster: Hamburger + Period Title Dropdown ── */}
+            {/* ── Left Cluster: Hamburger + Period Title ── */}
             <div class="flex items-center gap-1.5 min-w-0 flex-1">
               {/* Hamburger Button */}
               <button
@@ -51,27 +44,13 @@ export const MobileCalendarHeader: Component<MobileCalendarHeaderProps> = (props
                 </svg>
               </button>
 
-              {/* Period Title Button with Chevron (Google Calendar Phone pattern) */}
-              <button
-                type="button"
-                onClick={() => setIsMonthPickerOpen(!isMonthPickerOpen())}
-                class="flex items-center gap-1 px-2.5 py-2 min-h-[44px] min-w-[44px] rounded-xl hover:bg-[#E8E5DF] dark:hover:bg-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] transition-colors cursor-pointer"
-                data-testid="calendar-month-dropdown-btn"
-                aria-expanded={isMonthPickerOpen()}
-                aria-label="Toggle month picker"
+              {/* Period Title */}
+              <h2
+                class="text-sm font-bold truncate max-w-[180px] sm:max-w-[240px] text-[#3C3D3E] dark:text-[#ECEBE8] px-1"
+                data-testid="calendar-period-title"
               >
-                <span class="text-sm font-bold truncate max-w-[160px] sm:max-w-[220px]">
-                  {props.periodTitle}
-                </span>
-                <svg
-                  class={`w-4 h-4 text-[#6F7173] dark:text-[#878A8E] stroke-current fill-none stroke-[2.2] transition-transform duration-200 flex-shrink-0 ${
-                    isMonthPickerOpen() ? "rotate-180" : ""
-                  }`}
-                  viewBox="0 0 24 24"
-                >
-                  <polyline points="6 9 12 15 18 9" />
-                </svg>
-              </button>
+                <span>{props.periodTitle}</span>
+              </h2>
             </div>
 
             {/* ── Right Cluster: Search Toggle + Dynamic Today + Avatar ── */}
@@ -153,27 +132,6 @@ export const MobileCalendarHeader: Component<MobileCalendarHeaderProps> = (props
           </div>
         </div>
       </Show>
-
-      {/* ── Collapsible Mini-Month Dropdown Picker ── */}
-      <Show when={isMonthPickerOpen()}>
-        <div
-          class="fixed inset-0 top-14 bg-black/25 z-40 backdrop-blur-2xs"
-          onClick={() => setIsMonthPickerOpen(false)}
-          data-testid="mobile-month-picker-backdrop"
-        />
-        <div
-          class="absolute top-full left-2 right-2 sm:left-4 sm:right-auto sm:w-80 mt-1 z-50 bg-white dark:bg-[#1E1F23] rounded-2xl shadow-2xl border border-[#E2DFD8] dark:border-[#2A2D35] p-2 animate-in fade-in slide-in-from-top-2 duration-150"
-          data-testid="mobile-month-picker-dropdown"
-        >
-          <MiniMonthPicker
-            selectedDate={props.selectedDate}
-            onSelectDate={(d) => {
-              props.onSelectDate(d);
-              setIsMonthPickerOpen(false);
-            }}
-          />
-        </div>
-      </Show>
     </header>
   );
 };
```

Production build output (`npm run build --prefix apps/webmail`):
```
> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 338 modules transformed.
rendering chunks...
dist/index.html                                    1.86 kB │ gzip:   0.88 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-tvpQcmnw.css                   172.10 kB │ gzip:  26.09 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-nwqTHQPG.js                  3,587.59 kB │ gzip: 777.80 kB
✓ built in 9.76s
```

## Manual browser verification
Executed real automated browser verification via `node tests/browser/verify_calendar_dropdown_removal.mjs`:
1. Navigated to `http://127.0.0.1:3001` with a mobile viewport of 375x667.
2. Authenticated with live credentials `alice@byos.local` / `test-password-123`.
3. Switched to Calendar module via `[data-testid="bottom-nav-calendar-tab"]`.
4. Queried the DOM for `[data-testid="mobile-month-picker-dropdown"]` and `[data-testid="mobile-month-picker-backdrop"]`, confirming both are absent.
5. Inspected `[data-testid="calendar-period-title"]`, confirming the chevron SVG icon is removed.
6. Clicked the period title and confirmed no dropdown or backdrop opens.
7. Verified layout and lack of overflow at 375px, 414px, and 640px breakpoints.
8. Captured screenshots to repository paths:
   - `tests/browser/artifacts/calendar_dropdown_removed_375px.png`
   - `tests/browser/artifacts/calendar_header_clean_mobile.png`

Exact execution output:
```
================================================================================
      VERIFICATION: MOBILE CALENDAR MONTH DROPDOWN COMPLETE REMOVAL             
================================================================================

--- [STEP 1] Real login flow on 375px mobile viewport ---
  Successfully logged in as Alice on mobile.

--- [STEP 2] Navigate to Calendar via Bottom Bar ---
  PASS: CalendarView mounted on mobile

--- [STEP 3] Assert Dropdown & Chevron Elements Are Completely Absent ---
  Header Audit Result: {
  hasDropdown: false,
  hasBackdrop: false,
  hasPeriodTitle: true,
  periodTitleText: 'November 2026',
  hasHamburger: true,
  hasSearchToggle: true,
  hasTodayBtn: true,
  chevronCountInTitle: 0
}
  PASS: Mini-month picker dropdown is ABSENT from DOM
  PASS: Mini-month picker backdrop is ABSENT from DOM
  PASS: Period title is rendered cleanly in header
  PASS: No chevron icon exists in period title
  PASS: Hamburger navigation drawer button is present
  PASS: Search toggle button is present
  PASS: Dynamic today button is present

--- [STEP 4] Click Period Title and Confirm No Dropdown Opens ---
  PASS: Found calendar period title element
  PASS: Dropdown does NOT appear after tapping period title
  PASS: Backdrop does NOT appear after tapping period title
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_dropdown_removed_375px.png

--- [STEP 5] Multi-Breakpoint Verification ---
  PASS: Dropdown absent at 375px viewport
  PASS: No horizontal overflow at 375px viewport
  PASS: Dropdown absent at 414px viewport
  PASS: No horizontal overflow at 414px viewport
  PASS: Dropdown absent at 640px viewport
  PASS: No horizontal overflow at 640px viewport
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_header_clean_mobile.png

--- [STEP 6] DevTools State Dump ---
  Storage Keys: {
  "localStorageKeys": [
    "byos_week_start",
    "byos_unified_inbox_excluded",
    "byos_layout",
    "byos_time_format",
    "byos_calendar_offline_cache_c0000000-0000-0000-0000-000000000001",
    "byos_language",
    "byos_theme",
    "byos_connected_accounts",
    "byos_session_generation",
    "byos_density",
    "byos_view_mode"
  ],
  "sessionStorageKeys": [
    "byos_msg_subject_d5407593-7c3b-45c0-bfd9-15c9a7de09f0",
    "byos_msg_subject_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff",
    "byos_msg_category_e311272b-4ef4-4f8c-87e5-3a581441c82e",
    "byos_msg_category_bcde7268-d542-4e4b-ab31-246b85bace74",
    "byos_msg_sender_name_d5407593-7c3b-45c0-bfd9-15c9a7de09f0",
    "byos_session_vault"
  ]
}
  Captured 44 API network requests.
  Unhandled console errors: 0
  PASS: Zero unhandled console errors during test

================================================================================
       ALL CHECKS PASSED: DROPDOWN REMOVAL FULLY VERIFIED IN BROWSER            
================================================================================
```

## What did not work or is untested
None. All components, responsive views, and DOM elements were tested directly via real automated browser execution.

## Test suite output
Go API tests (`go test ./services/api/...`):
```
ok  	byos.email/services/api	12.101s
```

Webmail unit and integration suite (`npm test --prefix apps/webmail`):
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

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
  ✓ test_switch_loads_target_account
MULTI-ACCOUNT & STORAGE SYNC TESTS: 31 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
  ✓ Worker bridge ping heartbeat succeeds over message channel
  ✓ Argon2id passphraseWrapKey & passphraseUnwrapKey roundtrip offloaded correctly
  ✓ autoUnwrapKeys derives mailboxSk, signingSeed, xwingSeed, and searchKey off-thread
  ✓ X-Wing hybrid envelope seal and open roundtrip via worker pipeline
  ✓ Multi-chunk AES-256-GCM attachment prepare and decrypt roundtrip
  ✓ Tampered attachment chunk is isolated and reports specific chunk index
  ✓ Worker rejects invalid operations and returns structured error
  ✓ Worker bridge enforces operation timeout and cleans pending request
  ✓ Worker error event triggers crash cleanup and rejects pending requests
  ✓ Transferable ArrayBuffer detaches buffer on message channel dispatch
  ✓ zeroizeBuffer wipes sensitive in-memory bytes to 0
  ✓ Dispatches multiple concurrent operations across the worker message channel without interference
  ✓ Direct execution fallback mode operates reliably when worker is disabled
OFF-THREAD CRYPTO WEB WORKER TESTS: 13 passed, 0 failed

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
