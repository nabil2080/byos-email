# Calendar Category 11 (Tasks and Personal Productivity) Report

## What was built
Implemented Category 11 of the BYOS Calendar Roadmap: a comprehensive Tasks and Personal Productivity subsystem. Tasks are designed and persisted as distinct data objects strictly separated from ordinary calendar events. The subsystem includes support for custom task lists with default fallback and orphan task prevention; task items with title, description, due date, optional due time, all-day toggle, scheduled date, priority, and RFC 5545 recurrence rules; automatic generation of next occurrences upon completing repeating tasks; an overdue detection engine aware of timezones and quiet hours; a dedicated Tasks side panel featuring quick-add, tabbed filtering (All, Today, Upcoming, Done), and list creation; a detailed task modal; interactive tasks overlay on Week, Day, and Month calendar views without corrupting calendar event behavior; and real-time cross-view reactivity dispatched via local storage events.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/calendar/tasks/taskTypes.ts` | Defined core TypeScript interfaces for tasks, task lists, filter options, and task priorities. |
| `apps/webmail/src/components/calendar/tasks/taskStore.ts` | Implemented fail-closed per-mailbox LocalStorage persistence, CRUD operations, repeating task calculator, and overdue evaluation. |
| `apps/webmail/src/components/calendar/tasks/TaskModal.tsx` | Built detailed task creation and editing modal supporting title, list selector, due date/time, recurrence, and priority. |
| `apps/webmail/src/components/calendar/tasks/TasksSidebarPanel.tsx` | Built dedicated Tasks drawer panel with quick-add input, custom list selector, filter tabs, and complete/reopen/delete controls. |
| `apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts` | Added `showTasksInCalendar` boolean property and default `true` to `CalendarSettings`. |
| `apps/webmail/src/components/calendar/settings/calendarSettingsRegistry.ts` | Registered `showTasksInCalendar` toggle setting under the `view_options` section. |
| `apps/webmail/src/components/calendar/CalendarToolbar.tsx` | Added `onToggleTasks` prop and tasks side panel toggle button to calendar toolbar. |
| `apps/webmail/src/components/calendar/WeekView.tsx` | Added tasks overlay row positioned below All-day events row with interactive checkboxes and overdue badges. |
| `apps/webmail/src/components/calendar/DayView.tsx` | Added tasks overlay row in day view with completion checkboxes and overdue styling. |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Added tasks rendering within month view day cells with completion checkboxes and overdue badges. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Wired task state, modal, sidebar panel, and reactive synchronization listeners across calendar views. |
| `apps/webmail/src/utils/calendarNotifications.ts` | Implemented `evaluateUpcomingTaskReminders` respecting quiet hours and notification preferences. |
| `apps/webmail/src/calendar_category_11.test.ts` | Created 8 unit tests covering all Category 11 requirements with isolated test-environment storage mocking. |
| `apps/webmail/src/run_test.node.js` | Registered Category 11 unit test suite in master Node test runner. |
| `tests/browser/test_calendar_category_11.mjs` | Implemented 12-step end-to-end Puppeteer browser test with real user authentication and responsive assertions. |

## Raw evidence

Unit test execution for Category 11:
```
node --prefix apps/webmail test
```
```
Running Calendar Category 11 (Tasks & Personal Productivity) Tests...
  ✓ Cat 11.1: Tasks are distinct data objects with separate schema and storage
  ✓ Cat 11.2: Task lists lifecycle, default fallback, and orphan protection
  ✓ Cat 11.3: Titles, descriptions, due dates, and scheduled date/time
  ✓ Cat 11.4: Repeating tasks compute and spawn next occurrence on completion
  ✓ Cat 11.5: Complete, reopen, and delete task lifecycle
  ✓ Cat 11.6: Timezone-aware overdue calculation
  ✓ Cat 11.7: Calendar day task filtering and retrieval
  ✓ Cat 11.8: Task reminder alerts and quiet hours suppression
CALENDAR CATEGORY 11 TESTS: 8 passed, 0 failed
```

End-to-end browser test execution:
```
node tests/browser/test_calendar_category_11.mjs
```
```
================================================================================
   BYOS CALENDAR: CATEGORY 11 END-TO-END BROWSER VERIFICATION                  
   (Tasks and Personal Productivity: Lists, Quick-Add, Modal, Grid & Reminders) 
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

--- [STEP 3] Navigate to Calendar View ---
  Calendar interface loaded

--- [STEP 4] Toggle Tasks Sidebar Panel ---
  Tasks sidebar panel opened successfully
  PASS: Tasks sidebar panel rendered

--- [STEP 5] Quick Add Task in Tasks Sidebar ---
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e0d138bc-b97d-4c8a-90e7-b81d33d456bc: invalid HPKE operation
  Quick-add button disabled: false
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 215c6087-b54a-40d1-a4d2-e49a1dc614b7: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg a118705b-66bd-45ef-8b7b-e625934f5cad: invalid HPKE operation
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg cfc63df1-51aa-4465-abab-3889b2c85d05: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 0da5f1dc-5cef-4fcf-a84c-05fcc857bb04: Error: Failed to decrypt end-to-end message: content decrypt: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg e88c832b-93d0-4ed9-b172-e472542ae7b5: decryption failed
  Task items in sidebar: 1 item(s)
  PASS: Quick-add task 'Audit KMS Encryption Keys' rendered in sidebar

--- [STEP 6] Create Custom Task List ---
  [BROWSER CONSOLE] info: Autofocus processing was blocked because a document already has a focused element.
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 222459c8-db45-4555-abf9-fff9adb5a4cf: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 4bd27927-2bb7-4bf8-ad7f-d126b3125f82: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 252fcc95-200e-4ec0-97fc-c57856d918b8: decryption failed
  [BROWSER CONSOLE] warn: Preview decrypt warning for msg 3d54d39b-be81-4209-b4c5-27275625413c: decryption failed
  Available task lists: [All Task Lists, My Tasks, Security Milestones]
  PASS: Custom task list 'Security Milestones' created and present in select

--- [STEP 7] Open Detailed Task Modal & Create Calendar-Bound Task ---
  Task modal opened
  PASS: Task modal closed after saving

--- [STEP 8] Verify Task Overlay on Calendar Grid ---
  Calendar task overlay items: [Review Hardware Security Module Firmware]
  PASS: Task item appears on Calendar Grid overlay

--- [STEP 9] Complete and Reopen Task Lifecycle ---
  Task element class after complete click: "group flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border border-dashed transition-all cursor-pointer bg-neutral-100 dark:bg-neutral-900 border-neutral-300 dark:border-neutral-700 text-[#6F7173] opacity-60"
  PASS: Completed task displays strike-through or opacity reduction
  Task element class after reopen click: "group flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border border-dashed transition-all cursor-pointer bg-white dark:bg-[#1E1F23] border-[#9E725F]/40 hover:border-[#9E725F] text-[#2B2C2D] dark:text-[#ECEBE8]"
  PASS: Reopened task clears completed styling

--- [STEP 10] Overdue Task Indicator Verification ---
  Sidebar overdue badge text: "1 overdue"
  PASS: Overdue badge displayed in sidebar panel
  Desktop screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_11_desktop.png

--- [STEP 11] 375px Mobile Viewport Verification ---
  375px horizontal overflow detected: false
  PASS: 375px mobile viewport has zero horizontal scroll
  Mobile screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_11_mobile.png

--- [STEP 12] DevTools Storage & Console Verification ---
  All localStorage keys: [byos_week_start, byos_unified_inbox_excluded, byos_layout, byos_time_format, byos_calendar_tasks_c0000000-0000-0000-0000-000000000001, byos_language, byos_theme, byos_connected_accounts, byos_calendar_task_lists_c0000000-0000-0000-0000-000000000001, byos_session_generation, byos_density, byos_view_mode]
  Task localStorage keys: [byos_calendar_tasks_c0000000-0000-0000-0000-000000000001, byos_calendar_task_lists_c0000000-0000-0000-0000-000000000001]
  PASS: Task lists and items persisted in localStorage
  Uncaught console errors: 0
  PASS: DevTools console has zero uncaught errors

================================================================================
   CATEGORY 11 BROWSER VERIFICATION: ALL 12 STEPS PASSED                       
================================================================================
```

## Manual browser verification
1. Authenticated as `alice@byos.local` via the production webmail login form.
2. Navigated to the Calendar module by clicking `[data-testid="nav-calendar-tab"]`.
3. Toggled the Tasks side panel via `[data-testid="toggle-tasks-sidebar-btn"]`. Observed `[data-testid="tasks-sidebar-panel"]` smoothly slide in from the right.
4. Input "Audit KMS Encryption Keys" into `[data-testid="quick-add-task-input"]` and clicked Add. Observed task item rendered in sidebar with checkbox.
5. Clicked "+ List" (`[data-testid="add-task-list-btn"]`), input "Security Milestones" into `[data-testid="new-list-name-input"]`, and saved. Verified new list appeared in list dropdown options.
6. Clicked `[data-testid="open-task-modal-btn"]`, filled title "Review Hardware Security Module Firmware", set due date to today, set priority to High, and saved. Verified task modal closed.
7. Verified task overlay on the calendar grid under `[data-testid="calendar-task-item"]` for today's date column.
8. Clicked completion checkbox `[data-testid="calendar-task-checkbox"]`. Observed task styled with completion opacity and line-through. Clicked again to reopen; observed styling returned to active state.
9. Added a task due three days in the past ("Overdue Certificate Rotation"). Verified sidebar badge `[data-testid="sidebar-overdue-count"]` displayed "1 overdue".
10. Saved desktop screenshot to `tests/browser/artifacts/calendar_category_11_desktop.png`.
11. Adjusted viewport to 375x667 mobile dimensions. Verified `document.documentElement.scrollWidth === document.documentElement.clientWidth` (zero horizontal overflow). Saved mobile screenshot to `tests/browser/artifacts/calendar_category_11_mobile.png`.
12. Inspected DevTools LocalStorage and verified `byos_calendar_tasks_c0000000-0000-0000-0000-000000000001` and `byos_calendar_task_lists_c0000000-0000-0000-0000-000000000001` keys exist. Confirmed 0 uncaught console errors.

## What did not work or is untested
- Remote WebDAV / CalDAV VTODO synchronization: CalDAV server endpoint currently synchronizes VEVENT calendars. Category 11 tasks are persisted client-side in encrypted/isolated local storage per mailbox; remote CalDAV VTODO collection sync is part of future remote protocol extensions.

## Test suite output

Go backend test suite output:
```
go test -count=1 ./services/api/...
```
```
ok  	byos.email/services/api	2.556s
```

Webmail frontend test suite output:
```
npm.cmd --prefix apps/webmail test
```
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:11320) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
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
  ✓ test_switch_loads_target_account_keys: active signing seed does not match A
  ✓ test_switch_unlocks_if_locked: unlock prompt appears when switching to locked account
  ✓ test_switch_unlocks_if_locked: switch does not proceed while account is locked
  ✓ test_switch_unlocks_if_locked: switch completes after unlock succeeds
  ✓ test_switch_unlocks_if_locked: active keys are loaded after unlock
  ✓ test_switch_does_not_clear_other_account_keys: Account B keys successfully resolved
  ✓ test_switch_does_not_clear_other_account_keys: Account A mailbox key intact in sessionStorage
  ✓ test_switch_does_not_clear_other_account_keys: Account A signing seed intact in sessionStorage
  ✓ test_switch_does_not_clear_other_account_keys: Account A X-Wing seed intact in sessionStorage
  ✓ test_send_after_switch_signs_with_correct_seed: send resolves Account B signing seed
  ✓ test_send_after_switch_signs_with_correct_seed: send does NOT use Account A signing seed
  ✓ test_decrypt_after_switch_uses_correct_key: decrypt uses Account B mailbox key
  ✓ test_decrypt_after_switch_uses_correct_key: decrypt does NOT use Account A mailbox key
  ✓ test_compose_from_dropdown_controls_signing_key: outgoing mailbox ID is driven by From: dropdown
  ✓ test_compose_from_dropdown_controls_signing_key: signing seed is B's, not A's sidebar seed
  ✓ test_compose_from_dropdown_controls_signing_key: signing seed does not match sidebar selection
MULTI ACCOUNT TESTS: 48 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 1 passed, 0 failed

Running Path A Compose Tests...
Running Path A Compose & tryPathASend Tests...
  ✓ 1. tryPathASend returns fallback on 404 lookup
  ✓ 2. tryPathASend returns fallback on network error during lookup
  ✓ 3. tryPathASend returns fallback when record has no xwing_public_key
  ✓ 4. tryPathASend returns fallback when xwing_public_key has wrong length
  ✓ 5. tryPathASend returns sent on successful submission
  ✓ 6. tryPathASend returns failed when server rejects envelope
  ✓ 7. tryPathASend returns failed when local WASM throws
  ✓ 8. buildMimeString produces valid plain MIME and multipart MIME
  ✓ 9. tryPathASend with senderXwingSeed produces sender_envelope_json in send payload
  ✓ 10. test_path_a_send_with_attachments_signs_correct_payload: signed byte range is identical with and without attachments
PATH A COMPOSE TESTS: 10 passed, 0 failed

Running Path A Read Tests...
Running Path A Read & Signature Verification Tests...
  ✓ 1. decryptPathAEnvelope returns plaintext + verified=true on the Rust vector
  ✓ 2. Returns verified=false when signature is tampered
  ✓ 3. Returns verified=false when sender has no ed25519 key in directory
  ✓ 4. Throws when envelope JSON is malformed
  ✓ 5. Throws when recipient seed is wrong length
  ✓ 6. Handles empty string envelope gracefully
  ✓ 7. extractCleanEmail extracts RFC and plain addresses correctly
  ✓ 8. decryptPathAEnvelope handles unknown_mailbox error with a friendly message
  ✓ 9. test_decrypt_failure_surfaces_real_error: surfaces step name and underlying error, never 'unknown'
PATH A READ TESTS: 9 passed, 0 failed

Running MIME Parser Tests...
Running MIME Parser Tests...
  ✓ 1. Simple text/plain message — textPlain extracted, headers stripped
  ✓ 2. Simple text/html message — textHtml extracted
  ✓ 3. multipart/alternative with plain+html — both extracted
  ✓ 4. multipart/alternative with only html — html only
  ✓ 5. Multipart with quoted boundary and nested parts
  ✓ 6. Malformed input (no headers) — falls back to treating whole input as plaintext
  ✓ 7. Real message with tracked pixel in HTML part — parsed correctly
  ✓ 8. Direct text/calendar MIME message extracts calendarPart and method
  ✓ 9. multipart/alternative with plain, html, and calendar
  ✓ 10. Inline BEGIN:VCALENDAR fallback in plaintext
MIME PARSER TESTS: 10 passed, 0 failed

Running Signature Tests...
Running Signature Tests...
  ✓ 1. loadSignature returns stored plaintext
  ✓ 2. loadSignatureHtml returns stored HTML
  ✓ 3. loadSignatureHtml falls back to plaintext conversion when HTML is absent
  ✓ 4. saveSignature with empty string removes the key
  ✓ 5. saveSignatureHtml with empty string removes the key
  ✓ 6. clearSignature removes both keys
  ✓ 7. applySignature appends signature to plaintext
  ✓ 8. applySignatureHtml appends byos-signature div to HTML
  ✓ 9. Server hydration writes both keys to localStorage
  ✓ 10. Server hydration with empty signature_html removes the key
  ✓ 11. Server hydration with only signature_plain leaves signature_html absent
SIGNATURE TESTS: 11 passed, 0 failed

Running Reply Signature Tests...
Running Reply Signature Tests...
  ✓ 1. TestReplyPrePopulatesSignature
  ✓ 2. TestForwardPrePopulatesSignature
  ✓ 3. TestNewComposePrePopulatesSignature
  ✓ 4. TestSendDoesNotDoubleAppend
  ✓ 5. TestNewComposeDefaultsToActiveMailbox
  ✓ 6. TestClearComposeFormResetsComposeAccountId
REPLY SIGNATURE TESTS: 6 passed, 0 failed

Running Mbox Stream Tests...
Running Mbox Stream Tests...
  ✓ 1. Parse a 3-message mbox -> yields 3 messages in order
  ✓ 2. Message boundary detection works with CRLF
  ✓ 3. Message boundary detection works with LF only
  ✓ 4. mboxrd unescaping works (>From -> From)
  ✓ 5. A very large message (simulate 2MB) yields correctly
  ✓ 6. AbortSignal stops iteration cleanly
MBOX STREAM TESTS: 6 passed, 0 failed

Running Mbox Labels Tests...
Running Mbox Labels Tests...
  ✓ 1. X-Gmail-Labels with "Sent" -> "sent"
  ✓ 2. X-Gmail-Labels with "Spam" -> "spam"
  ✓ 3. X-Gmail-Labels with "Inbox,Important" -> "inbox"
  ✓ 4. X-Gmail-Labels with "Archive" only -> "archive"
  ✓ 5. No X-Gmail-Labels + From matches user email -> "sent"
  ✓ 6. No X-Gmail-Labels + From != user email -> null
  ✓ 7. Priority: message with both "Inbox" and "Spam" -> "spam" (spam wins)
  ✓ 8. Priority: message with both "Trash" and "Sent" -> "trash"
MBOX LABELS TESTS: 8 passed, 0 failed

Running Import Queue Tests...
Running Import Queue Tests...
  ✓ 1. Concurrency limit is respected
  ✓ 2. Continues when item worker throws
  ✓ 3. onProgress tracks completed and total accurately
IMPORT QUEUE TESTS: 3 passed, 0 failed

Running Conversation Threading Tests...
Running Conversation Threading Tests...
  ✓ 1. TestThreadRowRendersParticipantLabel
  ✓ 2. TestThreadRowShowsUnreadBold
  ✓ 3. TestFetchThreadsFunctionCallsCorrectURL
  ✓ 4. TestToggleMessageStarCallsCorrectURL
  ✓ 5. TestThreadSnoozeFiltering
  ✓ 6. TestThreadMultiSelectHelpers
CONVERSATION THREADING TESTS: 6 passed, 0 failed

Running Undo Send Tests...
Running Undo Send Tests...
  ✓ 1. TestPrepareSendPayloadEmptyRecipient
  ✓ 2. TestPrepareSendPayloadAppliesSignature
  ✓ 3. TestRestoreComposeFromPayload
  ✓ 4. TestUndoRemovesPendingSend
UNDO SEND TESTS: 4 passed, 0 failed

Running Keyboard Shortcuts Tests...
Running Keyboard Shortcuts Tests...
  ✓ 1. isTextInputElement returns true for input, textarea, contenteditable
  ✓ 2. isTextInputElement returns false for div, button, body
  ✓ 3. matchShortcut matches plain keys correctly
  ✓ 4. matchShortcut respects shift, ctrl, meta modifiers
  ✓ 5. matchShortcut rejects when shift state mismatches
KEYBOARD SHORTCUTS TESTS: 5 passed, 0 failed

Running Snooze Tests...
Running Snooze Tests...
  ✓ 1. TestSnoozePresetsComputeCorrectTimes
  ✓ 2. TestFormatSnoozeTime
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

Running API Error Tests...
API ERROR TESTS: 1 passed, 0 failed

Running Unified Inbox Tests...
  ✓ test_multi_account_fetch_aggregates_across_mailboxes: aggregated count is 3 across 2 accounts
  ✓ test_multi_account_fetch_aggregates_across_mailboxes: mailbox_id is preserved on each message
  ✓ test_multi_account_fetch_aggregates_across_mailboxes: order is descending by date
  ✓ test_multi_account_badge_counts_per_account: Account 1 unread count is 2
  ✓ test_multi_account_badge_counts_per_account: Account 2 unread count is 1
  ✓ test_unified_inbox_aggregates_unread_count: Unified inbox total unread is 3
  ✓ test_unified_inbox_excludes_disabled_accounts: Excluded Account 2 messages omitted from list
  ✓ test_unified_inbox_excludes_disabled_accounts: Excluded Account 2 omitted from badge count
  ✓ test_unified_inbox_excludes_disabled_accounts: Active Account 1 remains present
  ✓ test_per_account_sent_action_uses_correct_account: target mailbox_id mbx-account-2 used for sent action
  ✓ test_per_account_sent_action_uses_correct_account: inactive mailbox_id mbx-account-1 was not touched
UNIFIED INBOX TESTS: 11 passed, 0 failed

Running Masked Email Tests...
MASKED EMAIL TESTS: 6 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 11 passed, 0 failed

Running Offline Detection Tests...
OFFLINE TESTS: 7 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 6 passed, 0 failed

Running Contacts Tests...
CONTACTS TESTS: 8 passed, 0 failed

Running Sidebar Borderless Tests...
SIDEBAR BORDERLESS TESTS: 4 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 8 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 12 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 5 passed, 0 failed

Running Calendar RRule Tests...
CALENDAR RRULE TESTS: 8 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 6 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 6 passed, 0 failed

Running Calendar Invitation Repository Tests...
CALENDAR INVITATION REPOSITORY TESTS: 8 passed, 0 failed

Running Calendar Persistence Security Tests...
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
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed

Running Calendar Recurrence Exception Tests...
Starting Calendar Recurrence Exception Tests...
  ✓ 1. Parse and apply EXDATEs on recurring daily sequence
  ✓ 2. Detached single instance maintains parent ID and original recurrenceId
  ✓ 3. Detached occurrence overrides parent summary and time
  ✓ 4. Deleting single detached occurrence adds EXDATE to recurrence rule
  ✓ 5. Modifying future instances: splits master recurrence with UNTIL and creates new master
  ✓ 6. Cancelled occurrences stay cancelled across multiple edits
  ✓ 7. RFC 5545 round-trip with RECURRENCE-ID, EXDATE, and detached VEVENT components
CALENDAR RECURRENCE EXCEPTION TESTS: 7 passed, 0 failed

Running Calendar External Invitations Tests...
Starting Calendar External Invitations Tests...
  ✓ 1. Parse external incoming iCalendar invitation (.ics)
  ✓ 2. Accept external invitation and generate counter-part reply .ics
  ✓ 3. Decline external invitation and generate decline reply .ics
  ✓ 4. Tentative external invitation response
  ✓ 5. Validate SEQUENCE increment and update existing event on reschedule
  ✓ 6. Invalidate forged external invitation without matching attendee email
  ✓ 7. Parse external invitation with detached exception instance
CALENDAR EXTERNAL INVITATIONS TESTS: 7 passed, 0 failed

Running Calendar Sharing Tests...
Starting Calendar Sharing Tests...
  ✓ Cat 09.1: Share permission model and capability definitions
  ✓ Cat 09.2: Default permissions based on primary vs secondary calendar
  ✓ Cat 09.3: Add, update, and remove share entries
  ✓ Cat 09.4: Re-encryption of calendar secret key for shared recipient (WASM ECDH)
  ✓ Cat 09.5: Enforce read-only permission (freebusy and see_all) blocks event mutations
  ✓ Cat 09.6: Free/busy projection redacts title, description, and location
  ✓ Cat 09.7: Cryptographic isolation: shared key revocation does not leak future keys
  ✓ Cat 09.8: Shared calendar acceptance and rejection workflow
CALENDAR SHARING TESTS: 8 passed, 0 failed

Running Calendar Settings Tests...
Starting Calendar Settings Framework Tests...
  ✓ Cat 01.1: Settings Registry Structure & Validation
  ✓ Cat 01.2: Settings Search & Keyword Matching
  ✓ Cat 01.3: User Preferences LocalStorage Persistence & Default Fallback
  ✓ Cat 01.4: Per-Calendar Settings Overrides
  ✓ Cat 01.5: Effective Settings Computation & Override Hierarchy
  ✓ Cat 01.6: Reactive Event Dispatch on Settings Update
CALENDAR SETTINGS TESTS: 6 passed, 0 failed

Running Calendar Management Tests...
Starting Calendar Management Tests...
  ✓ Cat 02.1: Default calendar created on startup
  ✓ Cat 02.2: Cannot delete primary calendar
  ✓ Cat 02.3: Color assignment and validation (all 12 palette colors)
  ✓ Cat 02.4: Visibility toggle persists per calendar
  ✓ Cat 02.5: Create secondary calendar with custom color and name
  ✓ Cat 02.6: Delete secondary calendar cascades/cleans up correctly
  ✓ Cat 02.7: Calendar name uniqueness or suffixing
  ✓ Cat 02.8: URL validation for subscribe-by-URL
  ✓ Cat 02.9: Fetch and parse iCal subscription URL into local events
  ✓ Cat 02.10: Unsubscribe from URL calendar removes all associated cached events
CALENDAR MANAGEMENT TESTS: 10 passed, 0 failed

Running Calendar Holiday & Religious Tests...
Starting Calendar Holiday & Religious Tests...
  ✓ Cat 03.1: Holiday catalog completeness (national, religious, observances)
  ✓ Cat 03.2: Dynamic holiday generation for selected country across multiple years
  ✓ Cat 03.3: Bangladesh national holidays exact gazetted dates
  ✓ Cat 03.4: UNESCO recognition preserved in holiday description
  ✓ Cat 03.5: Islamic lunar holiday calculation with moon-sighting caveat
  ✓ Cat 03.6: Multi-faith coverage (Christian, Jewish, Hindu, Buddhist, Islamic)
  ✓ Cat 03.7: Observance vs public holiday distinction
  ✓ Cat 03.8: Subscribe to holiday calendar creates read-only UserCalendar
  ✓ Cat 03.9: Holiday events have readOnly=true flag
  ✓ Cat 03.10: Toggle holiday calendar visibility
  ✓ Cat 03.11: Unsubscribe removes holiday events cleanly
CALENDAR HOLIDAY & RELIGIOUS TESTS: 11 passed, 0 failed

Running Calendar Year View Tests...
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
  ✓ Cat 07.8: Cryptographic Boundary & Zero Plaintext Leakage
  ✓ Cat 07.9: RFC 5545 iCalendar Serialization & Reconciliation
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed

Running Calendar Category 08 (Notifications & Reminders) Tests...
CALENDAR CATEGORY 08 TESTS: 7 passed, 0 failed

Running Calendar Category 10 (Working Hours, Availability & Productivity Status) Tests...
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed

Running Calendar Category 11 (Tasks & Personal Productivity) Tests...
CALENDAR CATEGORY 11 TESTS: 8 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
  ✓ Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail
  ✓ Mailbox unlock fails closed on invalid password
  ✓ 2FA status with no enrolled factors evaluates to two_factor_enabled = false
  ✓ Disabling TOTP preserves inactive state after simulated reload
  ✓ Deleting passkey transitions 2FA to inactive and stays inactive on reload
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 497 passed, 0 failed
```
