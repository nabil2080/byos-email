# Remove folder-selection-dot from Sidebar Report

## What was built
Removed the per-folder colored dot (`data-testid="folder-selection-dot"`) from the sidebar folder rows across both the dynamic top Inbox row (`All Inboxes` / `Inbox`) and the remaining standard folders loop in `apps/webmail/src/components/Sidebar.tsx`. Removed the now-unused helper function `currentSelectionColor()` from `Sidebar.tsx`. Updated the standalone browser integration test `tests/browser/test_sidebar_restructure.mjs` to assert that zero `folder-selection-dot` elements exist in the sidebar DOM. Confirmed that the account chip at the top of the sidebar continues to clearly display the active account's avatar, email, and colored dot without visual noise on every folder row.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/Sidebar.tsx` | Delete `folder-selection-dot` `<span>` elements from top Inbox row and folder loop, and remove unused `currentSelectionColor` helper. |
| `apps/webmail/src/components/AccountSwitcher.tsx` | Add explicit `data-testid` attributes to dropdown row labels (`account-dropdown-all-label` and `account-dropdown-label-${acc.id}`). |
| `tests/browser/test_sidebar_restructure.mjs` | Update Check 4 and Check 5 assertions to verify zero folder dots; fix Check 3 and Check 7 selectors and add explicit string assertions for `allText`, `aliceText`, and `bobText`. |

## Raw evidence

### Investigation Grep Outputs
Command: `git grep -n "folder-selection-dot" apps/webmail/src/ tests/browser/`
```
apps/webmail/src/components/Sidebar.tsx:400:                  data-testid="folder-selection-dot"
apps/webmail/src/components/Sidebar.tsx:525:                    data-testid="folder-selection-dot"
tests/browser/test_sidebar_restructure.mjs:243:      const folderDots = Array.from(document.querySelectorAll('[data-testid="folder-selection-dot"]'))
tests/browser/test_sidebar_restructure.mjs:308:      const folderDots = Array.from(document.querySelectorAll('[data-testid="folder-selection-dot"]'))
```

Command: `git grep -n "currentSelectionColor" apps/webmail/src/`
```
apps/webmail/src/components/AccountSwitcher.tsx:33:  const currentSelectionColor = () => {
apps/webmail/src/components/Sidebar.tsx:220:  const currentSelectionColor = () => {
apps/webmail/src/components/Sidebar.tsx:399:                  style={{ "background-color": currentSelectionColor() }}
apps/webmail/src/components/Sidebar.tsx:524:                    style={{ "background-color": currentSelectionColor() }}
```
*(Note: `AccountSwitcher.tsx:33` uses its own `currentSelectionColor` for the account switcher component and remains untouched).*

Command: `git grep -n "folderDotColors" tests/browser/`
```
tests/browser/test_sidebar_restructure.mjs:252:        folderDotColors: [...new Set(folderDots)],
tests/browser/test_sidebar_restructure.mjs:266:    if (!check4.folderDotColors.includes("rgb(128, 34, 195)")) {
tests/browser/test_sidebar_restructure.mjs:267:      throw new Error(`Folder selection dots should match Alice's violet color, got: ${check4.folderDotColors}`);
tests/browser/test_sidebar_restructure.mjs:322:        folderDotColors: [...new Set(folderDots)],
```

### Diff of `Sidebar.tsx`
Command: `git diff apps/webmail/src/components/Sidebar.tsx`
```diff
diff --git a/apps/webmail/src/components/Sidebar.tsx b/apps/webmail/src/components/Sidebar.tsx
index f74e779..cfc3a13 100644
--- a/apps/webmail/src/components/Sidebar.tsx
+++ b/apps/webmail/src/components/Sidebar.tsx
@@ -217,14 +217,6 @@ export const Sidebar: Component<SidebarProps> = (props) => {
   const isAllInboxes = () =>
     props.activeAccountId === "__all__" || props.currentFolder === "unified_inbox";
 
-  const currentSelectionColor = () => {
-    if (isAllInboxes()) {
-      return "#A27561";
-    }
-    const targetId = props.activeAccountId || props.selectedMailbox?.id || props.connectedAccounts?.[0]?.id || "";
-    return getAccountColor(targetId);
-  };
-
   return (
     <aside class={`w-full md:w-64 flex-shrink-0 bg-[#F0EEE9] dark:bg-[#18191D] flex flex-col justify-between select-none h-full relative ${props.class || ""}`}>
       {/* FIXED TOP: Brand Header & Mode Toggle, Account Switcher, Compose, Quick Actions */}
@@ -394,11 +386,6 @@ export const Sidebar: Component<SidebarProps> = (props) => {
               data-testid={isAllInboxes() ? "unified-inbox-button" : "folder-inbox"}
             >
               <div class="flex items-center gap-2.5">
-                <span
-                  class="w-2 h-2 rounded-full flex-shrink-0 transition-colors"
-                  style={{ "background-color": currentSelectionColor() }}
-                  data-testid="folder-selection-dot"
-                />
                 <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
                   <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                   <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
@@ -519,11 +506,6 @@ export const Sidebar: Component<SidebarProps> = (props) => {
                 data-testid={`folder-${f}`}
               >
                 <div class="flex items-center gap-2.5">
-                  <span
-                    class="w-2 h-2 rounded-full flex-shrink-0 transition-colors"
-                    style={{ "background-color": currentSelectionColor() }}
-                    data-testid="folder-selection-dot"
-                  />
                   {renderFolderIcon(f)}
                   <span>{folderLabels[f]}</span>
                 </div>
```

### Diff of `test_sidebar_restructure.mjs`
Command: `git diff tests/browser/test_sidebar_restructure.mjs`
```diff
diff --git a/tests/browser/test_sidebar_restructure.mjs b/tests/browser/test_sidebar_restructure.mjs
index 93fd943..1637aef 100644
--- a/tests/browser/test_sidebar_restructure.mjs
+++ b/tests/browser/test_sidebar_restructure.mjs
@@ -240,16 +240,14 @@ async function runSidebarVerification() {
 
       const topFolderBtn = document.querySelector('[data-testid="folder-inbox"]');
       const topFolderName = document.querySelector('[data-testid="folder-name-inbox"]')?.textContent?.trim();
-      const folderDots = Array.from(document.querySelectorAll('[data-testid="folder-selection-dot"]'))
-        .map((el) => window.getComputedStyle(el).backgroundColor);
+      const folderDotCount = document.querySelectorAll('[data-testid="folder-selection-dot"]').length;
 
       return {
         chipText,
         dotColor,
         hasInboxFolder: !!topFolderBtn,
         topFolderName,
-        folderCount: folderDots.length,
-        folderDotColors: [...new Set(folderDots)],
+        folderDotCount,
       };
     });
 
@@ -263,8 +261,8 @@ async function runSidebarVerification() {
     if (check4.topFolderName !== "Inbox") {
       throw new Error(`Expected top folder "Inbox" for Alice, got "${check4.topFolderName}"`);
     }
-    if (!check4.folderDotColors.includes("rgb(128, 34, 195)")) {
-      throw new Error(`Folder selection dots should match Alice's violet color, got: ${check4.folderDotColors}`);
+    if (check4.folderDotCount !== 0) {
+      throw new Error(`Expected no folder-selection-dot elements in sidebar, got: ${check4.folderDotCount}`);
     }
 
     // Capture screenshot of Alice selected state
@@ -305,8 +303,7 @@ async function runSidebarVerification() {
       const topFolderName = document.querySelector('[data-testid="folder-name-inbox"]')?.textContent?.trim();
       const topFolderUnread = document.querySelector('[data-testid="folder-unread-inbox"]')?.textContent?.trim();
 
-      const folderDots = Array.from(document.querySelectorAll('[data-testid="folder-selection-dot"]'))
-        .map((el) => window.getComputedStyle(el).backgroundColor);
+      const folderDotCount = document.querySelectorAll('[data-testid="folder-selection-dot"]').length;
 
       const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
       const text = document.body.innerText;
@@ -319,7 +316,7 @@ async function runSidebarVerification() {
         hasUnifiedFolder: !!topFolderBtn,
         topFolderName,
         topFolderUnread,
-        folderDotColors: [...new Set(folderDots)],
+        folderDotCount,
         rowCount: rows.length,
         hasAlpha,
         hasBeta,
@@ -333,6 +330,9 @@ async function runSidebarVerification() {
     if (check5.topFolderName !== "All Inboxes") {
       throw new Error(`Expected top folder "All Inboxes", got "${check5.topFolderName}"`);
     }
+    if (check5.folderDotCount !== 0) {
+      throw new Error(`Expected no folder-selection-dot elements in All Inboxes sidebar, got: ${check5.folderDotCount}`);
+    }
     if (!check5.hasAlpha || !check5.hasBeta) {
       throw new Error(`Unified Inbox messages from both accounts not found! Alpha=${check5.hasAlpha}, Beta=${check5.hasBeta}`);
     }
```

### Raw Output of Sidebar Browser Test (`test_sidebar_restructure.mjs`)
Command: `node --experimental-wasm-modules tests/browser/test_sidebar_restructure.mjs`
```
(node:7424) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
================================================================================
           SIDEBAR RESTRUCTURE MANUAL VERIFICATION (CHECKS 1 - 6)               
================================================================================

Seeding baseline message for Alice...
Seeding baseline message for Bob...

--- [CHECK 1] Open the webmail with two accounts connected ---
✓ CHECK 1 PASSED: Webmail opened with Alice and Bob connected

--- [CHECK 2] Confirm sidebar shows account chip at top, no 'ACCOUNTS' section ---
Check 2 Result: {
  "hasChip": true,
  "chipText": "alice@byos.local",
  "hasDot": true,
  "dotColor": "rgb(128, 34, 195)",
  "hasAccountsHeader": false,
  "hasPermanentAccountsSection": false
}
✓ CHECK 2 PASSED: Account chip present at top; no permanent ACCOUNTS section found

--- [CHECK 3] Click chip; confirm dropdown opens with 'All Inboxes', both accounts, and 'Add another mailbox' ---
Check 3 Result: {
  "hasAllInboxes": true,
  "hasAlice": true,
  "hasBob": true,
  "hasAddMailbox": true,
  "allText": "All Inboxes",
  "aliceText": "alice@byos.local",
  "bobText": "bob@byos.local"
}
Captured sidebar dropdown screenshot: F:\Codex\byos-email\tests\browser\artifacts\sidebar_dropdown_open.png
Captured account popup multi screenshot: F:\Codex\byos-email\tests\browser\artifacts\account_popup_multi.png
✓ CHECK 3 PASSED: Dropdown opens with All Inboxes, connected accounts, and Add mailbox action

--- [CHECK 4] Select alice@byos.local; confirm chip updates, violet dot, and alice folders ---
Check 4 Result: {
  "chipText": "alice@byos.local",
  "dotColor": "rgb(128, 34, 195)",
  "hasInboxFolder": true,
  "topFolderName": "Inbox",
  "folderDotCount": 0
}
Captured sidebar Alice selected screenshot: F:\Codex\byos-email\tests\browser\artifacts\sidebar_alice_selected.png
✓ CHECK 4 PASSED: Alice selected: chip shows alice@byos.local, violet dot, folder list shows Alice folders

--- [CHECK 5] Click chip again, select 'All Inboxes'; confirm chip, aggregate counts, both accounts ---
Check 5 Result: {
  "chipText": "All Inboxes",
  "dotColor": "rgb(162, 117, 97)",
  "hasUnifiedFolder": true,
  "topFolderName": "All Inboxes",
  "topFolderUnread": "3",
  "folderDotCount": 0,
  "rowCount": 3,
  "hasAlpha": true,
  "hasBeta": true
}
Captured sidebar All Inboxes selected screenshot: F:\Codex\byos-email\tests\browser\artifacts\sidebar_all_inboxes_selected.png
✓ CHECK 5 PASSED: All Inboxes selected: chip shows All Inboxes, aggregate folder list, both accounts' messages displayed

--- [CHECK 6] Screenshot comparison confirmed ---
Saved screenshots:
  1. Dropdown Open:       F:\Codex\byos-email\tests\browser\artifacts\sidebar_dropdown_open.png
  2. Alice Account State: F:\Codex\byos-email\tests\browser\artifacts\sidebar_alice_selected.png
  3. All Inboxes State:   F:\Codex\byos-email\tests\browser\artifacts\sidebar_all_inboxes_selected.png
✓ CHECK 6 PASSED: Both states captured and verified

--- [KEYBOARD VERIFICATION] Test 'g i' keyboard jump to inbox ---
Keyboard 'g i' active state: { isActive: true }
✓ KEYBOARD SHORTCUT 'g i' VERIFIED

--- [CHECK 7] Sign out Bob, verify All Inboxes disappears, view resets to Alice ---
Check 7 Reset View Result: {
  "chipText": "alice@byos.local",
  "topFolderName": "Inbox"
}
Check 7 Dropdown Result (Single Account): {
  "hasAllInboxes": false,
  "hasAlice": true,
  "hasAddMailbox": true,
  "aliceText": "alice@byos.local"
}
Captured account popup single screenshot: F:\Codex\byos-email\tests\browser\artifacts\account_popup_single.png
✓ CHECK 7 PASSED: All Inboxes conditional on 2+ accounts, selection resets on account removal

================================================================================
            ALL 7 MANUAL VERIFICATION CHECKS SUCCESSFULLY PASSED!              
================================================================================
```

### Raw Output of 5 Manual Verification Checks
Executed `node --experimental-wasm-modules tests\browser\verify_no_folder_dots.mjs`:
```
(node:7584) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
================================================================================
          MANUAL VERIFICATION: REMOVE FOLDER-SELECTION-DOT                       
================================================================================

--- [CHECK 1 & 2] Confirm no dots next to any folder and account chip shows active account (Alice) ---
  Observed Chip Text: alice@byos.local
  Observed Chip Dot Color: rgb(128, 34, 195)
  Observed folder-selection-dot count: 0
  Observed Folder Rows count: 8
  PASS: Account chip displays active account "alice@byos.local"
  PASS: Account chip dot retains Alice's violet color rgb(128, 34, 195)
  PASS: Zero folder-selection-dot elements exist in sidebar (got 0)
  PASS: Row folder-inbox has 0 dots inside
  PASS: Row folder-inbox has folder SVG icon
  PASS: Row folder-sent has 0 dots inside
  PASS: Row folder-sent has folder SVG icon
  PASS: Row folder-scheduled has 0 dots inside
  PASS: Row folder-scheduled has folder SVG icon
  PASS: Row folder-drafts has 0 dots inside
  PASS: Row folder-drafts has folder SVG icon
  PASS: Row folder-snoozed has 0 dots inside
  PASS: Row folder-snoozed has folder SVG icon
  PASS: Row folder-archive has 0 dots inside
  PASS: Row folder-archive has folder SVG icon
  PASS: Row folder-spam has 0 dots inside
  PASS: Row folder-spam has folder SVG icon
  PASS: Row folder-trash has 0 dots inside
  PASS: Row folder-trash has folder SVG icon
  Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\sidebar_no_dots_light.png

--- [CHECK 3] Switch to second account (Bob) and confirm no dots appear ---
  Observed Chip Text for Account 2: bob@byos.local
  Observed Chip Dot Color for Account 2: rgb(34, 195, 168)
  Observed folder-selection-dot count for Account 2: 0
  PASS: Account chip switched to "bob@byos.local"
  PASS: Account chip shows Bob's teal dot rgb(34, 195, 168)
  PASS: Zero folder-selection-dot elements exist after switching to Bob (got 0)
  Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\sidebar_no_dots_second_account.png

--- [CHECK 4] Toggle Dark Mode and confirm no dots in dark theme ---
  Dark Mode active: true
  Dark Mode folder-selection-dot count: 0
  PASS: Dark mode class active on documentElement
  PASS: Zero folder-selection-dot elements in Dark Mode (got 0)
  Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\sidebar_no_dots_dark.png
  PASS: Restored to Light Mode
  PASS: Zero folder-selection-dot elements after returning to Light Mode

================================================================================
         ALL 4 MANUAL UI CHECKS VERIFIED ZERO FOLDER DOTS                       
================================================================================
```

### Raw Output of `make smoke` (`.\make.bat smoke`)
Command: `.\make.bat smoke`
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (14.3s)
  [PASS] test_sidebar_restructure.mjs        PASS (13.7s)
  [PASS] test_unified_inbox_browser.mjs      PASS (26s)
  [PASS] test_account_switch_crypto.mjs      PASS (62.2s)
  [PASS] test_masked_email.mjs               PASS (45s)
  [PASS] test_alias_custom.mjs               PASS (41s)
  [PASS] test_compose_default_account.mjs    PASS (12.3s)
  [PASS] test_wire_integrity.mjs             PASS (77.4s)
  [PASS] test_focused_inbox.mjs              PASS (31s)
  [PASS] test_offline.mjs                    PASS (31.3s)
  [PASS] test_composer.mjs                   PASS (21.7s)
  [PASS] test_contacts.mjs                   PASS (14.5s)
  [PASS] test_import.mjs                     PASS (14s)
  [PASS] test_sent_folder_display.mjs        PASS (15.4s)
================================================================================

SMOKE SUITE PASSED: All 14 tests passed cleanly.
```

## What did not work or is untested
- None: All acceptance criteria tested and verified across unit tests, typecheck, standalone sidebar browser test, 5 manual verification checks, and the full 14-test smoke suite.

## Test suite output

### `npm.cmd run typecheck`
```
> typecheck
> tsc --noEmit
```

### `npm.cmd test -- --run`
```
RUN  v1.6.1 F:/Codex/byos-email/apps/webmail

Running Attachment Crypto Tests...
  ✓ test_attachment_encrypt_decrypt_roundtrip
  ✓ test_attachment_tampered_ciphertext_fails
  ✓ test_mime_type_preservation
ATTACHMENT CRYPTO TESTS: 3 passed, 0 failed

Running Session Isolation Tests...
Running Session Isolation Tests...
  ✓ test_key_isolation_cross_account
  ✓ test_key_cleanup_on_lock
  ✓ test_account_switch_purges_inactive_keys
  ✓ test_concurrent_sessions_isolated_keys
  ✓ test_mailbox_key_registration_and_lookup
  ✓ test_memory_zeroization_on_lock
  ✓ test_switch_active_account_updates_store
  ✓ test_multiple_accounts_keys_independent
SESSION ISOLATION TESTS: 8 passed, 0 failed

Running Client DB Isolation Tests...
Running Client DB Isolation Tests...
  ✓ test_per_user_idb_isolation: User A cannot read User B cache
  ✓ test_idb_cleared_on_logout: Logout drops and wipes user DB
  ✓ test_cross_tab_broadcast_channel: Logout in Tab A notifies Tab B
CLIENT DB ISOLATION TESTS: 3 passed, 0 failed

Running Wire Integrity Tests...
  ✓ Scenario A: Send to internal recipient (encrypted)
  ✓ Scenario B: Send from alias (reply-to verified)
  ✓ Scenario C: Send to external recipient (encrypted)
  ✓ Scenario D: Inbound message verified (no header spoofing)
WIRE INTEGRITY TESTS: 4 passed, 0 failed

Running Snooze Feature Tests...
Running Snooze Feature Tests...
  ✓ test_snooze_until_calculated_accurately
  ✓ test_snooze_status_payload_preserves_timestamp
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
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000005: Error: invalid recipient rejected by server
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:380:17)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:158:15)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:375:7)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:200:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:357:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:188:22)
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
[persistent-session] Token has expired. Purging persistent session.
  ✓ 5. Expired token rejects restoration and purges storage
[persistent-session] Token rejected by server (HTTP 401). Purging persistent session.
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
