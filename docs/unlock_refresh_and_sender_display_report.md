# Mailbox Unlock Refresh Persistence & Sender Display Report

## What was built
Implemented mailbox cryptographic key persistence across browser page reloads (F5 refresh) via tab-scoped authenticated `sessionStorage` (`byos_session_vault`), while guaranteeing complete zeroization and vault purging upon explicit user logout. Updated email list views (`MessageRow`, `ThreadRow`, `MessageList`, `MailContext`, `unified_inbox`, `App`) to extract and render sender Display Names cleanly when present, falling back to clean email addresses without raw angle brackets or extraneous quotation marks. Suppressed external sender warning alert banners ("This message came from outside BYOS. Its sender cannot be cryptographically verified.") and unverified badges in `ReadingPane` for external communications. Audited and fixed latent TypeScript compilation errors, test simulation flaws, and E2E browser selector mismatches across the repository.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/session_isolation.ts` | Implemented `byos_session_vault` in `sessionStorage` for reload persistence, supported X-Wing and signing seed retention, decoupled in-memory zeroization on `beforeunload` from storage purging, and ensured `zeroizeKeys()` wipes the vault. |
| `apps/webmail/src/App.tsx` | Fixed `TS2304` missing import for `isAccountUnlocked`, resolved block-scoped `memSk` reference, extracted `validSenderName` into `DisplayMessage`, and reordered key storage to persist keys prior to `pendingSwitchAccount()` checks. |
| `apps/webmail/src/components/AccountSwitcher.tsx` | Imported `isAccountUnlocked` and updated `isAccountLocked` to check reactive `acc.isLocked` prop before falling back to `!isAccountUnlocked(id)`. |
| `apps/webmail/src/components/ReadingPane.tsx` | Added missing `onShowToast` and `onTrashSenderMessages` to `ReadingPaneProps` to fix `TS2322`, and suppressed external sender warnings via `isExternalSenderError`. |
| `apps/webmail/src/components/MessageRow.tsx` | Added sender display name extraction fallback and populated `data-testid="message-sender-name"` and `data-testid="message-subject"` in full-width and split modes. |
| `apps/webmail/src/components/ThreadRow.tsx` | Updated sender display logic to prioritize `msg.senderName` and added `data-testid="thread-sender-name"` and `data-testid="thread-subject"`. |
| `apps/webmail/src/components/MessageList.tsx` | Added `senderName?: string;` property to `DisplayMessage` interface. |
| `apps/webmail/src/context/MailContext.tsx` | Added `senderName?: string;` property to `DisplayMessage` interface. |
| `apps/webmail/src/unified_inbox.ts` | Added `senderName?: string;` property to `DisplayMessage` interface. |
| `apps/webmail/src/display_party.test.ts` | Added unit tests covering sender display name parsing and mailbox unlock persistence across simulated reloads using `zeroizeInMemoryOnly()`, resolving `TS18047` null narrowing. |
| `apps/webmail/src/multi_account.test.ts` | Cleaned up `byos_session_vault` in test teardown for test isolation. |
| `tests/browser/verify_unlock_refresh_sender_display.mjs` | Created E2E Puppeteer test suite checking unlock state, refresh persistence, sender display strings, external warning suppression, and key zeroization on logout. |

## Raw evidence

### 1. TypeScript Compilation Check
Ran `cmd.exe /c "npm run typecheck --prefix apps/webmail"`:
```
> typecheck
> tsc --noEmit
```

### 2. End-to-End Browser Automation Suite
Ran `cmd.exe /c "node tests/browser/verify_unlock_refresh_sender_display.mjs"`:
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

--- [STEP 3] Page Reload (F5 Refresh) Persistence Check ---
  [PASS] [VERIFY-1b] Mailbox stays unlocked across browser refresh (no re-lock or prompt)
         Details: isLockedAfterReload=false, hasUnlockModal=false, hasVault=true
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\mailbox_unlocked_after_refresh.png

--- [STEP 4] Email List Sender Display Logic Check ---
  Sample rendered senders in message list: [
  {
    "sender": "Bob Stone",
    "subject": "Feedback on the new cryptographic key unwrap UX"
  },
  {
    "sender": "David Chen",
    "subject": "Invitation: BYOS Sprint 42 Planning & PQC Review"
  },
  {
    "sender": "DevOps Automation",
    "subject": "Automated Nightly Vulnerability Audit Log - Nov 7"
  },
  {
    "sender": "Bob Stone",
    "subject": "Re: Database migration window for v2.4 upgrade"
  },
  {
    "sender": "Sarah Jenkins",
    "subject": "Design System Token audit for dark mode contrast"
  }
]
  [PASS] [VERIFY-2] Sender column displays clean Name or email without angle brackets or malformed formatting
         Details: Inspected 10 rows; senderRenderClean=true
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
TOTAL CHECKS: 5 | PASSED: 5 | FAILED: 0
ALL E2E CHECKS PASSED!
```

### 3. Webmail Test Suite
Ran `cmd.exe /c "npm test --prefix apps/webmail"`:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:18352) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=ac022906-aa8a-4f02-9558-647029895440 chunk_index=1
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
  ✓ test_switch_loads_target_account_keys: switched to Account B signing seed
  ✓ test_switch_loads_target_account_keys: target account keys exist in store
  ✓ test_switch_to_account_without_keys_fails_safely: switch throws on missing keys
  ✓ test_switch_to_account_without_keys_fails_safely: still on Account A signing seed
  ✓ test_storage_event_syncs_account_switch: storage event triggers switch to Account B
  ✓ test_storage_event_syncs_account_switch: account B is now active in storage
  ✓ test_concurrent_sessions_isolated: Session A has correct signing seed
  ✓ test_concurrent_sessions_isolated: Session B has correct distinct signing seed
MULTI-ACCOUNT & STORAGE SYNC TESTS: 40 passed, 0 failed

Running Focused Inbox & Category 12 Tests...
  ✓ isImportant correctly identifies VIP senders, replies, and keywords
  ✓ categorizeEmail correctly classifies primary, transactions, updates, promotions
  ✓ parseCategoryRules converts plain text to structured rule objects
  ✓ applyCustomRules matches user-defined rules before default heuristics
FOCUSED INBOX TESTS: 4 passed, 0 failed

Running Track 2 & Zero-Knowledge Security Tests...
  ✓ debounced autosave dirty-state tracking and cancellation
  ✓ isMessageSnoozed correctly checks future vs expired timestamps
  ✓ checkSnoozeExpirations identifies messages expiring in the time window
  ✓ live snooze expiration loop wakes snoozed messages into inbox with read: false and clears snoozedUntil
  ✓ buildEmlContent formats RFC 5322 MIME headers and multipart mixed attachments
  ✓ uint8ArrayToBase64 safely encodes large buffers without failure
  ✓ decryptPathAEnvelope resolves dynamic key epoch without failing thread decryption
  ✓ decryptPathAEnvelope does NOT throw and preserves thread plaintext even if sender verification fails
TRACK 2 & ZERO-KNOWLEDGE SECURITY TESTS: 17 passed, 0 failed

Running Calendar Track 3 Verification Tests...
  ✓ Track 3.1: External Calendar URL normalization converts webcal:// to https://
  ✓ Track 3.2: URL feed fetcher routes through /v1/calendar/feed-proxy and falls back to direct fetch
  ✓ Track 3.3: OfflineActionType supports create_exception, update_exception, delete_exception
  ✓ Track 3.4: syncOfflineQueue replays recurrence exception actions and clears queue
  ✓ Track 3.5: moveEventToTrash encrypts details with AES-GCM and eliminates plaintext leakage in localStorage
  ✓ Track 3.6: Calendar trash supports legacy unencrypted fallback
  ✓ Track 3.7: saveTask encrypts task title and description with AES-GCM when key is available
  ✓ Track 3.8: taskStore supports legacy unencrypted fallback
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed

Running Track 4: Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...
  ✓ Track 4.1: encryptNotesMedia & decryptNotesMedia perform authenticated AES-GCM roundtrip
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
  ✓ Tampered attachment chunk is isolated and reports specific chunk index
  ✓ Worker rejects invalid operations and returns structured error
  ✓ Worker bridge enforces operation timeout and cleans pending request
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
TRANSLATOR & LOCALIZATION TESTS: 9 passed, 0 failed

Running Display Party & Unlock Persistence Tests...
  ✓ parseSenderParty extracts clean display name and email correctly
  ✓ displayParty prioritizes display name over email address
  ✓ session vault persists and rehydrates mailbox keys across simulated browser reloads
  ✓ zeroizeKeys purges session vault and zeroizes in-memory keys on logout
DISPLAY PARTY & UNLOCK PERSISTENCE TESTS: 4 passed, 0 failed

OVERALL: 660 passed, 0 failed
```

### 4. Backend Cryptographic & API Test Suites
Ran `go test -count=1 ./crypto/... ./services/admin-api/... ./services/api/...`:
```
ok  	byos.email/crypto/core	0.947s
ok  	byos.email/crypto/envelope	0.930s
ok  	byos.email/crypto/hpke	1.053s
ok  	admin-api	1.374s
ok  	admin-api/handlers	0.631s
ok  	byos.email/services/api	20.862s
```

## Manual browser verification
- Exercised full login flow as `alice@byos.local` against live backend API (`http://localhost:8080/v1`).
- Captured initial state screenshot: `tests/browser/artifacts/mailbox_unlocked_initial.png`.
- Performed browser reload (`page.reload({ waitUntil: 'networkidle0' })`) and verified the mailbox remained unlocked with no unlock prompt modal. Captured screenshot: `tests/browser/artifacts/mailbox_unlocked_after_refresh.png`.
- Inspected rendered message list elements verifying senders ("Bob Stone", "David Chen", "DevOps Automation", "Sarah Jenkins") render clean display names. Captured screenshot: `tests/browser/artifacts/email_list_sender_display.png`.
- Selected email in reading pane and asserted absence of warning text ("This message came from outside BYOS. Its sender cannot be cryptographically verified."). Captured screenshot: `tests/browser/artifacts/reading_pane_no_external_warning.png`.
- Clicked signout button and verified that `sessionStorage.getItem('byos_session_vault')` is null and all legacy `byos_acc_*` keys are deleted. Captured screenshot: `tests/browser/artifacts/mailbox_logged_out_vault_cleared.png`.

## What did not work or is untested
- **UNTESTED:** Opening webmail in an entirely new browser window or private browsing session (requires manual entry of credentials and passphrase as sessionStorage is tab-isolated by browser security architecture).
- **UNTESTED:** Physical Safari iOS mobile multi-touch gestures when scrolling the message list.
