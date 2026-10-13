# Webmail Design Refinements Report

## What was built
Implemented four design and operational refinements to the BYOS Webmail platform across dedicated, individual commits: (1) borderless sidebar unification eliminating hard borders and synchronizing palette tones with the main reading canvas, (2) conditional All Inboxes visibility displaying aggregate views strictly when two or more accounts are connected and resetting view states to the primary mailbox upon account disconnection, (3) sovereign profile photos and deterministic initial fallback avatars featuring client-side AES-GCM encryption, dedicated `/v1/users/me/profile-photo` endpoints, and storage-worker integration, and (4) 30-day persistent session support leveraging a non-extractable AES-GCM CryptoKey in IndexedDB (`byos_device_keystore`) to seal cryptographic credentials locally alongside persistent authentication tokens and mandatory UI risk disclosures.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/Sidebar.tsx` | Removed border-r to unify sidebar canvas styling with the main window. |
| `apps/webmail/src/components/ReadingPane.tsx` | Replaced color dots with ProfileAvatar and aligned reading pane borders. |
| `apps/webmail/src/components/AccountSwitcher.tsx` | Rendered conditional All Inboxes item and user ProfileAvatar. |
| `apps/webmail/src/components/MessageRow.tsx` | Replaced sender color dot with ProfileAvatar fallback/custom image. |
| `apps/webmail/src/components/MessageList.tsx` | Propagated selected mailbox attributes for avatar rendering. |
| `apps/webmail/src/components/ProfileAvatar.tsx` | Created sovereign profile photo and deterministic initial avatar component. |
| `apps/webmail/src/components/AddMailboxModal.tsx` | Preserved active session token and captured profile_photo_ref on connect. |
| `apps/webmail/src/routes/settings/AccountTab.tsx` | Added profile photo upload, client-side encryption, and deletion UI. |
| `apps/webmail/src/routes/settings/SettingsLayout.tsx` | Included Account tab in settings navigation pane. |
| `apps/webmail/src/unified_inbox.ts` | Updated shouldShowAllInboxes and resetSelectionOnAccountRemoval helpers. |
| `apps/webmail/src/persistent_session.ts` | Implemented 30-day persistent session sealing using non-extractable device key. |
| `apps/webmail/src/api.ts` | Added profile photo and connected account interface types and API endpoints. |
| `apps/webmail/src/App.tsx` | Integrated persistent session restoration, profile photo state, and layout styling. |
| `apps/webmail/src/sidebar_borderless.test.ts` | Added unit tests for borderless sidebar styling and canvas background unification. |
| `apps/webmail/src/unified_inbox.test.ts` | Added unit tests for conditional All Inboxes and account removal reset. |
| `apps/webmail/src/profile_photo.test.ts` | Added unit tests for profile avatar fallback and crypto roundtrip. |
| `apps/webmail/src/persistent_session.test.ts` | Added unit tests for non-extractable device key sealing and tamper checks. |
| `apps/webmail/src/run_test.node.js` | Registered new test suites in the Node runner. |
| `infra/postgres/init/053_profile_photos.sql` | Migration adding profile_photo_ref and profile_photo_updated_at columns. |
| `services/api/main.go` | Registered `/v1/users/me/profile-photo` route on API mux. |
| `services/api/auth.go` | Included profile_photo_ref in `/v1/auth/me` and `/v1/auth/login` responses. |
| `services/api/profile_photo.go` | Implemented GET, POST, DELETE endpoints for encrypted profile photos. |
| `services/api/profile_photo_test.go` | Added Go unit tests for profile photo endpoints and storage-worker interaction. |
| `tests/browser/test_sidebar_restructure.mjs` | Added Check 7 asserting All Inboxes disappears when only one account remains. |
| `tests/browser/test_profile_photo.mjs` | Added end-to-end browser test for profile photo upload, rendering, and removal. |
| `tests/browser/test_persistent_session.mjs` | Added end-to-end browser test for persistent sessions, restore, and key wipe. |
| `tools/webmail_design_refinements_verify.sql` | Created SQL verification query for migration 053 column additions. |

## Raw evidence

### Git commit history
Command: `git log -n 5 --oneline`
```
0f241b7 fix(auth): preserve active session token on add mailbox and avoid 404 photo fetches
07baa22 feat(auth): 30-day persistent sessions with non-extractable device key (Change 3)
eab242d feat(avatar): profile photos and fallback initial avatars replacing color dots (Change 1)
c17f516 feat(ui): conditional All Inboxes based on connected account count (Change 2)
1310314 feat(ui): remove sidebar borders and unify background with main canvas (Change 4)
```

### PostgreSQL Migration 053 Schema
Command: `Get-Content tools/webmail_design_refinements_verify.sql | docker exec -i byos-postgres psql -U byos -d byos`
```
       column_name        |        data_type         | is_nullable | column_default 
--------------------------+--------------------------+-------------+----------------
 profile_photo_ref        | text                     | YES         | 
 profile_photo_updated_at | timestamp with time zone | YES         | 
(2 rows)
```

Command: `docker exec byos-postgres psql -U byos -d byos -c "\d mailboxes"`
```
                                    Table "public.mailboxes"
          Column          |           Type           | Collation | Nullable |      Default      
--------------------------+--------------------------+-----------+----------+-------------------
 id                       | uuid                     |           | not null | gen_random_uuid()
 org_id                   | uuid                     |           | not null | 
 user_id                  | uuid                     |           |          | 
 domain_id                | uuid                     |           | not null | 
 local_part               | text                     |           | not null | 
 mode                     | text                     |           | not null | 'private'::text
 root_secret_id           | uuid                     |           |          | 
 mailbox_sk_wrapped       | bytea                    |           |          | 
 mailbox_sk_version       | integer                  |           | not null | 1
 mailbox_pk               | bytea                    |           |          | 
 is_active                | boolean                  |           | not null | true
 created_at               | timestamp with time zone |           | not null | now()
 updated_at               | timestamp with time zone |           | not null | now()
 plan                     | text                     |           | not null | 'solo'::text
 status                   | text                     |           | not null | 'active'::text
 wrapped_sk_user          | text                     |           |          | 
 wrapped_sk_org           | text                     |           |          | 
 previous_wrapped_sk_user | text                     |           |          | 
 previous_key_archived_at | timestamp with time zone |           |          | 
 mailbox_xwing_pk         | bytea                    |           |          | 
 mailbox_ed25519_pk       | bytea                    |           |          | 
 key_epoch                | integer                  |           | not null | 1
 signing_key_epoch        | integer                  |           | not null | 1
 key_status               | text                     |           | not null | 'active'::text
 profile_photo_ref        | text                     |           |          | 
 profile_photo_updated_at | timestamp with time zone |           |          | 
Indexes:
    "mailboxes_pkey" PRIMARY KEY, btree (id)
    "idx_mailboxes_domain" btree (domain_id)
    "idx_mailboxes_lower_local_part" btree (lower(local_part))
    "idx_mailboxes_org" btree (org_id)
    "idx_mailboxes_user" btree (user_id)
    "mailboxes_domain_id_local_part_key" UNIQUE CONSTRAINT, btree (domain_id, local_part)
```

### TypeScript Compilation Check
Command: `npm.cmd run typecheck`
```
> typecheck
> tsc --noEmit
```

## Manual browser verification

### Change 1: Profile Photos & Fallback Avatar
Command: `node --experimental-wasm-modules tests/browser/test_profile_photo.mjs`
Output:
```
================================================================================
     CHANGE 1: PROFILE PHOTO & FALLBACK AVATAR BROWSER VERIFICATION             
================================================================================

Seeding message from Alice to Alice for avatar verification...
Setting up Alice session in browser...

--- [CHECK 1] Verify Fallback Avatar renders initial 'A' and deterministic color ---
Check 1 Fallback Avatar state: {
  "hasChip": true,
  "chipInitial": "A",
  "hasChipImg": false,
  "chipBg": "rgb(128, 34, 195)",
  "messageRowInitial": "A"
}
✓ CHECK 1 PASSED: Fallback initial 'A' and background color verified. Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\profile_photo_fallback.png

--- [CHECK 2] Upload photo in Settings → Account ---
Waiting for photo upload & client-side encryption...
Check 2 Settings state: {
  "hasPreviewImg": true,
  "previewSrc": "blob:http://127.0.0.1:3001/e42",
  "hasRemoveBtn": true,
  "fileInputFiles": 0
}
Check 2 Sidebar Photo state: {
  "hasChipPhoto": true,
  "chipPhotoSrc": "blob:http://127.0.0.1:3001/e42"
}
Check 2 Reading Pane Photo state: {
  "hasReadingPhoto": true
}
✓ CHECK 2 PASSED: Photo uploaded, encrypted, and displayed across chip and reading pane. Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\profile_photo_active.png

--- [CHECK 3] Remove photo in Settings → verify fallback returns ---
Check 3 Settings after removal: {
  "previewInitial": "A",
  "hasRemoveBtn": false
}
Check 3 Sidebar after removal: {
  "chipInitial": "A",
  "hasChipImg": false
}
✓ CHECK 3 PASSED: Photo removed, fallback initial 'A' restored everywhere. Screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\profile_photo_removed.png

================================================================================
          ALL PROFILE PHOTO BROWSER VERIFICATION CHECKS PASSED!                 
================================================================================
```
Screenshots:
- `tests/browser/artifacts/profile_photo_fallback.png`
- `tests/browser/artifacts/profile_photo_active.png`
- `tests/browser/artifacts/profile_photo_removed.png`

### Change 3: 30-Day Persistent Sessions & Non-Extractable Device Key
Command: `node --experimental-wasm-modules tests/browser/test_persistent_session.mjs`
Output:
```
================================================================================
   CHANGE 3: 30-DAY PERSISTENT SESSIONS & DEVICE KEY BROWSER VERIFICATION       
================================================================================

--- [STEP 1] Navigate to Login Page and verify disclosure UI ---
UI Elements Check: {
  "hasCheckbox": true,
  "checkboxChecked": false,
  "disclosureText": "Keys will be stored encrypted on this device. Anyone with access to this device and browser profile can read your email without entering a password."
}
✓ STEP 1 PASSED: Checkbox and required disclosure warning verified. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\persistent_session_login_disclosure.png

--- [STEP 2] Log in with 'Remember this device for 30 days' checked ---
Storage dump after persistent login: {
  "persistentUserId": "cccccccc-0000-0000-0000-000000000002",
  "hasPersistentToken": true,
  "hasActiveSessionToken": true,
  "idbData": {
    "hasDeviceKey": true,
    "keyExtractable": false,
    "keyAlgorithm": "AES-GCM",
    "hasSealedKeys": true,
    "sealedIvLen": 24,
    "hasCiphertext": true
  }
}
✓ STEP 2 PASSED: Non-extractable device key & sealed keys verified in IndexedDB. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\persistent_session_logged_in.png

--- [STEP 3] Simulate tab/browser close (wipe sessionStorage) & reload ---
Restored session state: {
  "hasChip": true,
  "hasActiveToken": true,
  "hasLoginInput": false
}
✓ STEP 3 PASSED: Session automatically restored from device key without password prompt. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\persistent_session_auto_restored.png

--- [STEP 4] Explicit Logout & verify key purge ---
Storage dump post-logout: {
  "persistentUserId": null,
  "persistentToken": null,
  "activeSessionToken": null,
  "idbData": {
    "hasDeviceKey": false,
    "hasSealedKeys": false
  }
}
✓ STEP 4 PASSED: Explicit logout completely purged device key, sealed keys, and tokens. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\persistent_session_logged_out.png

================================================================================
       ALL PERSISTENT SESSION BROWSER VERIFICATION CHECKS PASSED!               
================================================================================
```
Screenshots:
- `tests/browser/artifacts/persistent_session_login_disclosure.png`
- `tests/browser/artifacts/persistent_session_logged_in.png`
- `tests/browser/artifacts/persistent_session_auto_restored.png`
- `tests/browser/artifacts/persistent_session_logged_out.png`

### Change 2: Conditional All Inboxes
Command: `node --experimental-wasm-modules tests/browser/test_sidebar_restructure.mjs`
Output excerpt:
```
--- [CHECK 3] Click chip; confirm dropdown opens with 'All Inboxes', both accounts, and 'Add another mailbox' ---
Check 3 Result: {
  "hasAllInboxes": true,
  "hasAlice": true,
  "hasBob": true,
  "hasAddMailbox": true,
  "allText": "A",
  "aliceText": "A",
  "bobText": "B"
}
✓ CHECK 3 PASSED: Dropdown opens with All Inboxes, connected accounts, and Add mailbox action

--- [CHECK 7] Sign out Bob, verify All Inboxes disappears, view resets to Alice ---
Check 7 Result: {
  "hasAllInboxes": false,
  "accountCount": 1,
  "chipText": "alice@byos.local",
  "currentFolder": "inbox"
}
✓ CHECK 7 PASSED: All Inboxes removed when single account remains; view cleanly reset to Alice
```
Screenshots:
- `tests/browser/artifacts/sidebar_dropdown_open.png`
- `tests/browser/artifacts/sidebar_alice_selected.png`
- `tests/browser/artifacts/sidebar_all_inboxes_selected.png`

## What did not work or is untested
- **Untested**: Operating system-level disk extraction attacks against raw IndexedDB database files on physical storage. While the device key is verified as non-extractable via the Web Cryptography API (`CryptoKey.extractable === false`), an attacker with local OS administrative access to the user profile filesystem could theoretically clone the raw browser database files. This posture is documented and disclosed in the login prompt disclosure.

## Test suite output

### Go Test Suite (`services/api`)
Command: `go test ./... -count=1`
Output:
```
ok  	byos.email/services/api	31.842s
```

### Webmail Unit Test Suite (`apps/webmail`)
Command: `npm.cmd test -- --run`
Output:
```
> test
> node --experimental-wasm-modules src/run_test.node.js --run

Running Multi-Account Tests...
Running Multi-Account Isolation Tests...
  ✓ 1. TestStorageIsolationBetweenAccounts
  ✓ 2. TestActiveAccountContextSeparation
  ✓ 3. TestAccountSwitchingKeys
  ✓ 4. TestAccountRemovalCleanup
  ✓ 5. TestAllInboxesAggregation
  ✓ 6. TestStaleStorageDetectionAndPurge
  ✓ 7. TestAccountSessionTokenValidation
  ✓ 8. TestSessionTokenPresenceInAccount
  ✓ 9. TestLegacyAccountFallbackPreserved
  ✓ 10. TestSessionStorageRestoration
  ✓ 11. TestPerAccountKeyStorageIsolation
  ✓ 12. TestSearchKeyDerivationIsolation
  ✓ 13. TestTokenIsolationAcrossSwitches
  ✓ 14. TestFullStorageWipeOnLogout
  ✓ 15. TestSelectiveLogoutIsolation
  ✓ 16. TestPrimaryLogoutPivotsOrPurges
  ✓ 17. TestPasswordSwitchWorkflow
MULTI-ACCOUNT TESTS: 17 passed, 0 failed

Running Session Isolation Rules Tests...
Running Session Isolation Rules Tests (1-6)...
  ✓ Rule 1: Fresh login purges prior session tokens and keys
  ✓ Rule 2: Multi-account switch unseals keys into per-account store
  ✓ Rule 3: Session token travels in Authorization Bearer header
  ✓ Rule 4: localStorage contains zero session tokens or secret keys
  ✓ Rule 5: Stale session token silently drops secondary account
  ✓ Rule 6: Per-account search key isolation
SESSION ISOLATION TESTS: 6 passed, 0 failed

Running Threading Tests...
Running Threading Tests...
  ✓ 1. GroupMessagesBySubjectThread
  ✓ 2. ComputeThreadUnreadCount
  ✓ 3. ThreadTimelineOrder
  ✓ 4. FlattenMessagesOrderPreserved
  ✓ 5. ThreadSnippetExtraction
  ✓ 6. ThreadParticipantsDeduplicated
THREADING TESTS: 6 passed, 0 failed

Running Label System Tests...
Running Label System Tests...
  ✓ 1. LabelColorValidation
  ✓ 2. LabelDeduplicationByName
  ✓ 3. LabelAssignmentImmutability
  ✓ 4. LabelSystemReservedNames
LABEL SYSTEM TESTS: 4 passed, 0 failed

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
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:187:22)
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
PERSISTENT SESSION TESTS: 4 passed, 0 failed

OVERALL: 272 passed, 0 failed
```

### Full Smoke Suite (`smoke.ps1`)
Command: `powershell -NoProfile -ExecutionPolicy Bypass -File ./smoke.ps1`
Output:
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (14.5s)
  [PASS] test_sidebar_restructure.mjs        PASS (13.6s)
  [PASS] test_unified_inbox_browser.mjs      PASS (25.9s)
  [PASS] test_account_switch_crypto.mjs      PASS (61.4s)
  [PASS] test_masked_email.mjs               PASS (41.4s)
  [PASS] test_alias_custom.mjs               PASS (41.2s)
  [PASS] test_compose_default_account.mjs    PASS (12.5s)
  [PASS] test_wire_integrity.mjs             PASS (72.7s)
  [PASS] test_focused_inbox.mjs              PASS (30.9s)
  [PASS] test_offline.mjs                    PASS (31.4s)
  [PASS] test_composer.mjs                   PASS (21.6s)
  [PASS] test_contacts.mjs                   PASS (14.3s)
================================================================================

SMOKE SUITE PASSED: All 12 tests passed cleanly.
```
