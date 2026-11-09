# Mailbox Authorization, Display Name Settings & Organization Directory Remediation Report

## What was built
Remediated the `403 Forbidden` (`not authorized for this mailbox`) authorization failure that occurred when switching between authenticated user accounts due to stale `X-BYOS-Active-Mailbox` headers persisting across user logins. Fixed a backend binding bug in `mailboxSettingsHandler` (`services/api/settings.go`) where saving mailbox settings updated `users.display_name` using the caller ID instead of the mailbox owner user ID. Integrated user-configured Mailbox Settings Display Names (`mailbox_settings.display_name`) with the organization directory (`/v1/auth/organization-members` in `services/api/rbac.go`), `meHandler`, and `userMailboxesHandler`, ensuring that display name edits in Settings immediately propagate across the organization. Enabled organization members directory loading and resolution in the webmail client (`apps/webmail/src/api.ts`, `App.tsx`, `ThreadRow.tsx`, `MessageRow.tsx`, and `ReadingPane.tsx`), ensuring that when a user (such as Bob) updates their display name to "Bob Builder", other users (such as Alice) immediately see "Bob Builder" in both their email list and reading pane, eliminating stale persona names like "Bob Stone". Also eliminated duplicate participant representations in threaded views (such as `alice@byos.local` displaying two distinct names e.g. `"Alice, Alice"` or `"Alice, alice@byos.local"`) by implementing normalized email and display-name deduplication with upgrade logic for richer MIME or directory names.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/api.ts` | Added `OrgMember` interface and `fetchOrganizationMembers` API endpoint calling `/v1/auth/organization-members`; gated automatic `X-BYOS-Active-Mailbox` header injection to exclude `/v1/auth/*` endpoints and added `display_name` property to `Mailbox` interface. |
| `apps/webmail/src/App.tsx` | Maintained `orgMembers` signal, fetched organization members on session bootstrap and mailbox load, synchronized `byos_org_member_name_` in session storage, prioritized organization directory display names during message mapping and preview decryption, and passed `orgMembers` to `<MessageList>` and `<ReadingPane>`. |
| `apps/webmail/src/components/ThreadRow.tsx` | Accepted `orgMembers` prop and prioritized organization members directory display names in `formatParticipants`, deduplicated thread participants by normalized email address, supported dynamic `"me"` replacement, and upgraded bare email names when richer display names are present. |
| `apps/webmail/src/components/MessageList.tsx` | Accepted `orgMembers` prop and forwarded it down to `<MessageRow>` and `<ThreadRow>`, and passed `currentUserEmail` into `<ThreadRow>`. |
| `apps/webmail/src/components/MessageRow.tsx` | Accepted `orgMembers` prop and prioritized organization members directory display names in `getDisplayParty` for both sent recipients and received senders. |
| `apps/webmail/src/components/ReadingPane.tsx` | Accepted `orgMembers` prop and prioritized organization members directory display names in `senderDisplayName`, and added `data-testid="reading-pane-sender-name"`. |
| `apps/webmail/src/unified_inbox.ts` | Cached and resolved sender display names using address-level session cache and organization directory cache. |
| `apps/webmail/src/routes/settings/AccountTab.tsx` | Propagated updated display name to `props.mailbox` and dispatched display name updated event across the client. |
| `apps/webmail/src/display_party.test.ts` | Added unit tests verifying participant deduplication, current user formatting as `"me"`, and contact priority. |
| `apps/webmail/src/components/notes/notes.test.ts` | Maintained notes unit test suite execution without modification. |
| `apps/webmail/src/components/notes/notesSync.test.ts` | Maintained notes sync unit test suite execution without modification. |
| `apps/webmail/src/folder_and_trash.test.ts` | Maintained folder and trash lifecycle unit test suite execution without modification. |
| `apps/webmail/src/routes/settings/ImportTab.tsx` | Maintained settings import tab integrity without modification. |
| `services/api/auth.go` | Safeguarded `meHandler` to fall back to user's default mailbox when `activeMailboxID` does not belong to the authenticated session, and coalesced `mailbox_settings.display_name`. |
| `services/api/settings.go` | Fixed user binding in `mailboxSettingsHandler` to update `users.display_name WHERE id = (SELECT user_id FROM mailboxes WHERE id = $2)` instead of caller `userID`. |
| `services/api/rbac.go` | Updated `organizationMembersHandler` query to select `COALESCE(NULLIF(ms.display_name, ''), NULLIF(u.display_name, ''), '')` from active mailbox settings so directory members always reflect their live settings display name. |
| `services/api/mailboxes.go` | Left-joined `mailbox_settings` in `userMailboxesHandler` to return effective display names. |
| `services/api/keys.go` | Validated `X-BYOS-Active-Mailbox` header ownership in `keyPublishHandler` to prevent cross-mailbox key publication. |
| `services/api/keys_test.go` | Added Go backend test verifying `X-BYOS-Active-Mailbox` header authorization and protection. |
| `tests/browser/verify_unlock_refresh_sender_display.mjs` | Verified mailbox unlock persistence and sender display name resolution across refresh. |
| `tests/browser/verify_mailbox_auth_display_name_propagation.mjs` | Automated E2E verification of clean user switching, settings display name update, duplicate participant deduplication, and cross-user email list & reading pane display name propagation. |

## Raw evidence
The following commands were executed and produced raw terminal output:

### Typecheck Verification
Command: `npm run typecheck --prefix apps/webmail`
Output:
```
> typecheck
> tsc --noEmit
```

### Go Backend Test Execution
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable"; go test -v -run "TestMailboxSettings" ./services/api/...`
Output:
```
=== RUN   TestMailboxSettingsRoundtrip
    settings_test.go:16: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestMailboxSettingsRoundtrip (0.22s)
=== RUN   TestMailboxSettings_Unauthorized
--- PASS: TestMailboxSettings_Unauthorized (0.00s)
=== RUN   TestMailboxSettings_RejectsMalformedEncryptedSignature
--- PASS: TestMailboxSettings_RejectsMalformedEncryptedSignature (0.00s)
PASS
ok  	byos.email/services/api	1.082s
```

## Manual browser verification
Command: `node tests/browser/verify_mailbox_auth_display_name_propagation.mjs`
Output:
```
================================================================================
   BYOS WEBMAIL: MAILBOX AUTH, DISPLAY NAME & DEDUPLICATION E2E VERIFICATION   
================================================================================

--- [STEP 1] Login Flow as Alice (alice@byos.local) ---
  Alice logged in successfully. Active mailbox ID: c0000000-0000-0000-0000-000000000001

--- [STEP 2] Alice Logs Out ---
  Alice logged out.

--- [STEP 3] Login Flow as Bob (bob@byos.local) ---
  [PASS] [AUTH-1] Bob logs in without 'not authorized for this mailbox' 403 error
         Details: bannerError=null, authMe403Count=0
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\bob_login_no_auth_error.png

--- [STEP 4] Bob Settings Display Name Change ---
  [PASS] [SETTINGS-1] Display name update in Settings persists to Connected Accounts & sessionStorage
         Details: displayName=Bob Builder, cachedEmailName=Bob Builder
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\bob_settings_display_name_saved.png

--- [STEP 5] Email List Alice Participant Deduplication Check ---
  Rendered senders in Bob's email list: ["Alexander Ham","Alexander Ham","Alexander Ham","Alexander Ham","sender7@example.com","sender3@example.com","sender1@example.com","sender4@example.com","sender10@example.com","sender5@example.com","sender2@example.com","sender9@example.com","sender6@example.com","sender8@example.com","Bob Builder"]
  [PASS] [DEDUP-1] Threads from alice@byos.local collapse duplicate participant names into a single clean sender
         Details: hasDuplicateAlice=false, sampleCount=15
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\bob_mailbox_email_list_no_duplicate_sender.png

--- [STEP 6] Bob Logs Out & Alice Logs In ---
--- [STEP 7] Alice's Email List: Bob's Sender Resolution ---
  Rendered senders in Alice's email list: ["Bob Builder","Bob Builder","Bob Builder","Bob Builder","Bob Builder","Bob Builder"]
  [PASS] [NAME-PROPAGATE-1] Alice's email list displays Bob's settings display name ('Bob Builder') and NOT stale 'Bob Stone'
         Details: displaysBobBuilder=true, displaysBobStone=false
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alice_email_list_bob_builder_display_name.png

--- [STEP 8] Reading Pane Sender Verification ---
  [PASS] [NAME-PROPAGATE-2] Reading pane resolves sender to Bob's updated display name ('Bob Builder')
         Details: readingPaneSenderText=Bob Builder
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alice_reading_pane_bob_builder.png

================================================================================
                        E2E VERIFICATION SUMMARY                                
================================================================================
TOTAL CHECKS: 5 | PASSED: 5 | FAILED: 0
ALL E2E CHECKS PASSED!
```

Command: `node tests/browser/verify_unlock_refresh_sender_display.mjs`
Output:
```
================================================================================
   BYOS WEBMAIL: UNLOCK REFRESH PERSISTENCE & SENDER DISPLAY E2E VERIFICATION   
================================================================================

--- [STEP 1] Login Flow as Alice (alice@byos.local) ---
  Successfully logged in as Alice.

--- [STEP 2] Initial Mailbox Unlock State Verification ---
  [PASS] [VERIFY-1a] Mailbox is unlocked immediately after authentication
         Details: isLockedInitially=false, hasSessionVault=true, vaultLen=372
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\mailbox_unlocked_initial.png
  Seeding / checking contact 'Bob Stone' <bob@byos.local> for mailbox c0000000-0000-0000-0000-000000000001...
  Contact seed result: {"action":"already_exists"}

--- [STEP 3] Page Reload (F5 Refresh) Persistence Check ---
  [PASS] [VERIFY-1b] Mailbox stays unlocked across browser refresh (no re-lock or prompt)
         Details: isLockedAfterReload=false, hasUnlockModal=false, hasVault=true
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\mailbox_unlocked_after_refresh.png

--- [STEP 4] Email List Sender Display Logic Check ---
  Sample rendered senders in message list: [
  {
    "sender": "Bob Builder",
    "subject": "Test Mail"
  },
  {
    "sender": "Bob Builder",
    "subject": "Verification Test"
  },
  {
    "sender": "Bob Builder",
    "subject": "Test Mail"
  },
  {
    "sender": "Bob Builder",
    "subject": "Verification Test"
  },
  {
    "sender": "Bob Builder",
    "subject": "Verification Test"
  }
]
  [PASS] [VERIFY-2] Sender column displays clean Name or email without angle brackets or malformed formatting
         Details: Inspected 6 rows; senderRenderClean=true
  [PASS] [VERIFY-2b] Sender column resolves bare email to real Display Name ('Bob Builder')
         Details: displaysBob=true, found sender=Bob Builder
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\email_list_sender_display.png

--- [STEP 5] Reading Pane External Sender Warning Banner Check ---
  [PASS] [VERIFY-3] External sender warning banner ('outside BYOS / cannot be cryptographically verified') is suppressed
         Details: hasOutsideByosWarning=false
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\reading_pane_no_external_warning.png

--- [STEP 6] Logout & Cryptographic Key Purge Verification ---
  Found sidebar signout button, clicking...
  [PASS] [VERIFY-4] Explicit logout zeroizes and completely purges byos_session_vault and all private keys
         Details: vaultPurged=true, legacyKeysCount=0
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\mailbox_logged_out_vault_cleared.png

================================================================================
                        E2E VERIFICATION SUMMARY                                
================================================================================
TOTAL CHECKS: 6 | PASSED: 6 | FAILED: 0
ALL E2E CHECKS PASSED!
```

Artifacts created:
- `tests/browser/artifacts/bob_login_no_auth_error.png`
- `tests/browser/artifacts/bob_settings_display_name_saved.png`
- `tests/browser/artifacts/bob_mailbox_email_list_no_duplicate_sender.png`
- `tests/browser/artifacts/alice_email_list_bob_builder_display_name.png`
- `tests/browser/artifacts/alice_reading_pane_bob_builder.png`
- `tests/browser/artifacts/email_list_sender_display.png`
- `tests/browser/artifacts/mailbox_unlocked_initial.png`
- `tests/browser/artifacts/mailbox_unlocked_after_refresh.png`
- `tests/browser/artifacts/reading_pane_no_external_warning.png`
- `tests/browser/artifacts/mailbox_logged_out_vault_cleared.png`

## What did not work or is untested
- Live multi-user WebSocket event broadcasting of display name updates to concurrently active external client sessions across separate machines is untested without a live cluster environment.

## Test suite output
Command: `npm test --prefix apps/webmail`
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:15168) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=f2a087d6-3829-4dc7-81db-a0d7463068e6 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=005a2316-3903-483a-b1fc-01ec8552cdd7 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[Worker Crypto] Decryption failed for attachment_id=b72fb1a2-ef83-4773-8425-2ac19d352c56 chunk_index=0
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
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: sessionToken is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in sessionStorage
  ✓ test_tokens_eliminated_from_browser_storage: mailboxSkHex is NOT in localStorage
  ✓ test_tokens_eliminated_from_browser_storage: non-secret display metadata is preserved
  ✓ test_expired_token_shows_specific_error: error message names the specific account
  ✓ test_expired_token_shows_specific_error: does not show generic unauthorized error
  ✓ test_expired_token_shows_specific_error: expired account is removed from sidebar
  ✓ test_expired_token_shows_specific_error: storage updated without expired account
  ✓ test_switch_loads_target_account_keys: initially on Account A signing seed
  ✓ test_switch_loads_target_account_keys: target account keys exist in store
  ✓ test_switch_updates_active_account: active account is Account B
  ✓ test_switch_updates_active_account: Account B is first in list
  ✓ test_switch_updates_active_account: localStorage order matches
  ✓ test_empty_storage_handles_gracefully: activeAccount is null
  ✓ test_empty_storage_handles_gracefully: accounts list is empty
  ✓ test_empty_storage_handles_gracefully: non-sensitive preference still accessible
  ✓ test_concurrent_tab_login_clears_state: accounts cleared from memory
  ✓ test_concurrent_tab_login_clears_state: keys purged
  ✓ test_corrupt_storage_recovers: invalid JSON in localStorage does not crash
  ✓ test_corrupt_storage_recovers: accounts reset to empty array
MULTI-ACCOUNT & STORAGE SYNC TESTS: 42 passed, 0 failed

Running Native Crypto Worker Tests...
NATIVE CRYPTO WORKER TESTS: 8 passed, 0 failed

Running Session Crypto Tests...
SESSION CRYPTO TESTS: 11 passed, 0 failed

Running Message Crypto Tests...
MESSAGE CRYPTO TESTS: 14 passed, 0 failed

Running Attachment Decrypt Stream Tests...
ATTACHMENT DECRYPT STREAM TESTS: 9 passed, 0 failed

Running Email Draft Storage Migration Tests...
EMAIL DRAFT STORAGE MIGRATION TESTS: 16 passed, 0 failed

Running Key Import Export Tests...
KEY IMPORT EXPORT TESTS: 17 passed, 0 failed

Running Scheduled Folder Tests...
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
  ✓ 10. Sender Display Logic: shows display name if available, else clean email
  ✓ 11. Mailbox Unlock Persistence Across Refresh preserves keys in session vault
  ✓ 12. Participant Deduplication, Current User formatting, and Address-Level Resolution
DISPLAY PARTY TESTS: 12 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 23 passed, 0 failed

Running Security Tests...
SECURITY TESTS: 25 passed, 0 failed

Running Webmail Notes Security Tests...
WEBMAIL NOTES SECURITY TESTS: 11 passed, 0 failed

Running Webmail Notes Sync Tests...
WEBMAIL NOTES SYNC TESTS: 11 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

Running Track 2 & Zero-Knowledge Security Tests...
TRACK 2 ZERO-KNOWLEDGE SECURITY TESTS: 14 passed, 0 failed

Running Track 4: Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
OFF-THREAD CRYPTO WEB WORKER TESTS: 13 passed, 0 failed

Running Subscriptions & Unsubscribe Store Tests...
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 703 passed, 0 failed
```
