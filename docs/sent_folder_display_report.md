# Sent Folder Recipient Display Fix Report

## What was built
Fixed the "x to x" recipient display bug in the Sent folder reading pane and prepended the explicit "To: " prefix to recipient names/addresses in the email list panels (both flat message list and threaded views) across full-width and split-view layouts. In the reading pane header, sent messages now explicitly show "from <sender>" and "to <recipient>" (resolved from message recipients rather than falling back to the owning mailbox account email), and the message details dropdown accurately reports "from: <sender>" and "to: <recipient>". The recipient avatar icon retains the recipient's initial without being contaminated by the "To: " prefix.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/MessageRow.tsx` | Prepend "To: " label before recipient party name in Sent folder rows across full-width and split list views without changing avatar initials. |
| `apps/webmail/src/components/ThreadRow.tsx` | Prepend "To: " label before recipient party name in Sent folder thread rows across full-width and split list views. |
| `apps/webmail/src/components/ReadingPane.tsx` | Add "from" prefix in Sent folder header; resolve recipient via `recipientSummary()` and `recipientFull()` to fix "x to x" bug and display actual recipient in header and details dropdown. |
| `apps/webmail/src/display_party.test.ts` | Add unit tests for Sent folder "To: " row prefix and reading pane recipient resolution to prevent regressions. |
| `tests/browser/test_sent_folder_display.mjs` | End-to-end browser verification script testing Alice-to-Bob composition, sent list "To: " row rendering, and reading pane recipient headers. |

## Raw evidence

### Unit Test Suite
Ran `npm.cmd test -- --run` in `apps/webmail`:
```
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
  ✓ 10. Sent folder row prepends 'To: ' to recipient display
  ✓ 11. Reading pane displays from <sender> to <recipient> without x to x bug
DISPLAY PARTY TESTS: 11 passed, 0 failed

OVERALL: 282 passed, 0 failed
```

### Production Vite Build
Ran `npm.cmd run build` in `apps/webmail`:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 144 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  1.15 kB │ gzip:   0.54 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-B4In2f3_.css                  96.27 kB │ gzip:  15.75 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-jrD1rZq6.js                  821.00 kB │ gzip: 200.83 kB
✓ built in 4.92s
```

## Manual browser verification
Executed `node --experimental-wasm-modules tests\browser\test_sent_folder_display.mjs` against the live webmail application running on port 3001.

Terminal output from browser verification:
```
================================================================================
             SENT FOLDER & READING PANE RECIPIENT DISPLAY TEST                  
================================================================================

--- [STEP 1] Login as Alice (alice@byos.local) ---
  PASS: Alice logged in successfully

--- [STEP 2] Compose and send email to Bob (bob@byos.local) ---
  Sent clicked; waiting for 5s undo window + outbound dispatch...
  Outbound send response status: 201
  PASS: Sent message dispatched successfully

--- [STEP 3] Navigate to Sent folder ---
  PASS: Found message rows in Sent folder
Sent folder rows: [
  "BTo: bob@byos.localSent Display Verification 179192169780802:01 AM",
  "BTo: bob@byos.localAFILE01:42 AM"
]
  PASS: Found sent message row for target subject
  PASS: Message row includes 'To: ' prefix (got text: "BTo: bob@byos.localSent Display Verification 179192169780802:01 AM")
  Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\sent_folder_list.png

--- [STEP 4] Open Sent message in ReadingPane ---

--- [STEP 5] Assert ReadingPane sender & recipient headers ---
  PASS: Reading pane loaded
  PASS: Reading pane indicates 'from' Alice
  PASS: Reading pane indicates 'to' Bob
  PASS: Reading pane does NOT say 'to alice@byos.local' (no x to x bug)

--- [STEP 6] Expand details dropdown and verify from / to fields ---
  PASS: Dropdown displays 'from: alice@byos.local'
  PASS: Dropdown displays 'to: bob@byos.local'
  Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\sent_reading_pane.png

================================================================================
            SENT FOLDER DISPLAY VERIFICATION PASSED PERFECTLY                   
================================================================================
```

Screenshots saved:
- `tests/browser/artifacts/sent_folder_list.png`
- `tests/browser/artifacts/sent_reading_pane.png`

## What did not work or is untested
- None: All acceptance criteria tested and verified across unit tests, production build, and headless browser run.

## Test suite output

### `npm.cmd test -- --run` (full paste)
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

Running Scheduled Folder Tests...
Running Scheduled Folder Tests...
  ✓ 1. System folder type union includes 'scheduled'
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
  ✓ 10. Sent folder row prepends 'To: ' to recipient display
  ✓ 11. Reading pane displays from <sender> to <recipient> without x to x bug
DISPLAY PARTY TESTS: 11 passed, 0 failed

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

OVERALL: 282 passed, 0 failed
```

### `go test -count=1 ./...` (full paste)
```
ok  	byos.email/services/api	39.578s
```
