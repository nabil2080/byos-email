# Mailbox Folder Movement and Permanent Trash Deletion Lifecycle Report

## What was built
Implemented standard mailbox folder movement, draft trash management, and permanent deletion lifecycle across the database, backend APIs, and webmail UI. The `drafts` table schema was enhanced with `folder` and `folder_id` columns, enabling drafts to participate in standard folder transitions without 404 errors. Backend routes for `DELETE /v1/mailboxes/{mailbox_id}/messages/{message_id}` (single message permanent deletion) and `DELETE /v1/mailboxes/{mailbox_id}/messages/trash` (empty trash) were implemented and wired to clean database records and customer-owned storage worker blobs. In the webmail application, folder transition actions (Archive, Trash, Spam, Move To) persist state to backend endpoints rather than relying solely on ephemeral in-memory signals, draft reading pane decryption handles trashed drafts without 404s, and trash views feature contextual "Delete Forever" actions and an "Empty Bin now" operation with confirmation dialogues.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/068_draft_folders.sql` | Added folder and folder_id columns, indexes, and foreign keys to drafts table |
| `services/api/drafts.go` | Added folder query support and folder fields to draft responses, validated mailbox existence in resolveDraftMailbox |
| `services/api/messages.go` | Added draft fallback in messageFolderHandler, implemented messageItemHandler (DELETE single) and emptyTrashHandler (DELETE trash) |
| `services/api/main.go` | Registered DELETE /v1/mailboxes/{mailbox_id}/messages/trash and DELETE /v1/mailboxes/{mailbox_id}/messages/{message_id} routes |
| `services/api/folder_lifecycle_test.go` | Added backend integration tests for draft trashing, folder movement, permanent deletion, and empty trash |
| `apps/webmail/src/api.ts` | Added deleteMessage and emptyTrash API functions and added folder fields to DraftMessage interface |
| `apps/webmail/src/App.tsx` | Persisted folder actions to backend, wired deleteMessage and emptyTrash, and allowed decryption of trashed drafts |
| `apps/webmail/src/components/InboxToolbar.tsx` | Added Drafts option to Move To dropdown for restoring trashed drafts |
| `apps/webmail/src/components/MessageList.tsx` | Added isDraft property to DisplayMessage interface and linked empty trash action |
| `apps/webmail/src/components/ReadingPane.tsx` | Added Drafts to Move To submenu, contextual Delete Forever in Trash, and draft decryption in Trash |
| `apps/webmail/src/components/ThreadRow.tsx` | Added Delete Forever quick action button on hover when thread is in Trash folder |
| `apps/webmail/src/context/MailContext.tsx` | Added isDraft property to DisplayMessage interface |
| `apps/webmail/src/folder_and_trash.test.ts` | Added unit tests for draft folder mapping, trash filtering, moving, permanent delete, and empty trash |
| `apps/webmail/src/run_test.node.js` | Registered folder_and_trash.test.ts in test runner script |
| `tests/browser/test_folder_and_trash_lifecycle.mjs` | Browser test script exercising real login, draft trashing, persistence across reload, restore, permanent delete, and empty trash |
| `apps/webmail/src/message_crypto.ts` | Preserved from prior task: zero-knowledge envelope and crypto helpers |
| `apps/webmail/src/routes/settings/SignaturesTab.tsx` | Preserved from prior task: settings tab enhancements |
| `apps/webmail/src/session_isolation.ts` | Preserved from prior task: session token isolation |
| `apps/webmail/src/signature.ts` | Preserved from prior task: signature handling |
| `apps/webmail/src/track2_security.test.ts` | Preserved from prior task: track 2 security assertions |
| `services/api/attachments.go` | Preserved from prior task: attachment envelope validation |
| `services/api/attachments_test.go` | Preserved from prior task: attachment tests |
| `services/api/auth.go` | Preserved from prior task: authentication handlers |
| `services/api/contacts.go` | Preserved from prior task: contact encryption envelope enforcement |
| `services/api/contacts_test.go` | Preserved from prior task: contact tests |
| `services/api/import.go` | Preserved from prior task: import envelope validation |
| `services/api/import_test.go` | Preserved from prior task: import tests |
| `services/api/message_attachments.go` | Preserved from prior task: message attachments envelope check |
| `services/api/message_attachments_test.go` | Preserved from prior task: message attachments tests |
| `services/api/settings.go` | Preserved from prior task: settings storage handlers |
| `services/api/settings_test.go` | Preserved from prior task: settings tests |
| `services/storage-worker/main.go` | Preserved from prior task: storage worker delete and encryption endpoints |
| `services/storage-worker/roundtrip_test.go` | Preserved from prior task: storage worker roundtrip tests |
| `docs/customer_owned_storage_encryption_audit.md` | Preserved from prior task: audit report |
| `docs/folder_and_trash_lifecycle_report.md` | Feature audit and implementation report for folder movement and trash lifecycle |
| `infra/postgres/migrations_unapplied/` | Preserved from prior task: unapplied migrations directory |

## Raw evidence

Database schema inspection of the updated `drafts` table:
```
$ docker exec -i byos-postgres psql -U byos -d byos -c "\d drafts"
                                       Table "public.drafts"
       Column       |           Type           | Collation | Nullable |           Default           
--------------------+--------------------------+-----------+----------+-----------------------------
 id                 | uuid                     |           | not null | gen_random_uuid()
 mailbox_id         | uuid                     |           | not null | 
 subject            | text                     |           |          | 
 encrypted_envelope | bytea                    |           | not null | 
 created_at         | timestamp with time zone |           | not null | now()
 updated_at         | timestamp with time zone |           | not null | now()
 recipient          | text                     |           | not null | ''::text
 version            | integer                  |           | not null | 1
 send_failed        | boolean                  |           | not null | false
 folder             | character varying(32)    |           | not null | 'drafts'::character varying
 folder_id          | uuid                     |           |          | 
Indexes:
    "drafts_pkey" PRIMARY KEY, btree (id)
    "idx_drafts_mailbox" btree (mailbox_id)
    "idx_drafts_mailbox_folder" btree (mailbox_id, folder)
    "idx_drafts_mailbox_folder_id" btree (mailbox_id, folder_id)
    "idx_drafts_mailbox_send_failed" btree (mailbox_id) WHERE send_failed = true
    "idx_drafts_mailbox_updated" btree (mailbox_id, updated_at DESC)
Check constraints:
    "drafts_version_check" CHECK (version >= 1)
Foreign-key constraints:
    "drafts_folder_id_fkey" FOREIGN KEY (folder_id) REFERENCES mailbox_folders(id) ON DELETE SET NULL
    "drafts_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
```

API Health check:
```
$ curl.exe -i http://127.0.0.1:8080/health
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' http://localhost:* http://127.0.0.1:* https://localhost:*;
Content-Type: application/json
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-Xss-Protection: 1; mode=block
Date: Sun, 08 Nov 2026 08:02:35 GMT
Content-Length: 145

{"status":"ok","services":{"minio":"up","postfix":"up","postgres":"up","redis":"up","rspamd":"up"},"timestamp":"2026-11-08T08:02:35.582168424Z"}
```

## Manual browser verification
Executed end-to-end browser test script `tests/browser/test_folder_and_trash_lifecycle.mjs` using Puppeteer.

1. **Step 1 - Real Login Flow:** Authenticated with real credentials as `alice@byos.local` (`test-password-123`). Logged in successfully into webmail.
2. **Step 2 - Navigate to Drafts & Inspect Draft:** Draft opened in Reading Pane and decrypted without 404 error.
   - Screenshot saved: `tests/browser/artifacts/folder_and_trash_01_draft_opened.png`
3. **Step 3 - Move Draft to Trash:** Clicked Move to Trash button in Reading Pane action toolbar. Draft removed from Drafts folder view.
4. **Step 4 - Trash Inspection & Contextual Actions:** Navigated to Trash view (`[data-testid="folder-trash"]`). Draft displayed in Trash list. Opened trashed draft in Reading Pane; decrypted properly. Observed that Reading Pane rendered "Delete Forever" action in place of "Move to Trash".
   - Screenshot saved: `tests/browser/artifacts/folder_and_trash_02_draft_in_trash.png`
5. **Step 5 - Browser Reload Persistence:** Executed `page.reload({ waitUntil: 'networkidle2' })`. Navigated to Trash; item remained in Trash in PostgreSQL.
6. **Step 6 - Restore Draft to Drafts:** Opened overflow menu, selected "Move to folder" -> "Drafts". Navigated to Drafts folder; item restored to Drafts.
   - Screenshot saved: `tests/browser/artifacts/folder_and_trash_03_draft_restored.png`
7. **Step 7 - Move Inbox Message to Trash:** Selected inbox message and moved to Trash. Navigated to Trash; message present.
8. **Step 8 - Delete Single Item Forever:** Clicked "Delete Forever" in Reading Pane. Message removed from Trash and permanently erased via `DELETE /v1/mailboxes/{mailbox_id}/messages/{message_id}`.
   - Screenshot saved: `tests/browser/artifacts/folder_and_trash_04_message_deleted_forever.png`
9. **Step 9 - Empty Bin Execution:** Clicked "Empty Bin now" banner button. Accepted dialogue prompt. Endpoint `DELETE /v1/mailboxes/{mailbox_id}/messages/trash` executed, returning `{"deleted_count":3,"status":"ok"}`. Reloaded page; Trash remained empty.
   - Screenshot saved: `tests/browser/artifacts/folder_and_trash_05_trash_emptied.png`

DevTools Network State Captured:
```json
[
  {
    "method": "PUT",
    "url": "http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/messages/9af5b64f-09b5-4cd8-9e26-ae4f45079dd6/folder",
    "status": 200,
    "response": "{\"folder\":\"trash\",\"message_id\":\"9af5b64f-09b5-4cd8-9e26-ae4f45079dd6\",\"status\":\"ok\"}\n"
  },
  {
    "method": "PUT",
    "url": "http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/messages/c2ca5b46-5ef4-4039-b632-c76e0215d05b/folder",
    "status": 200,
    "response": "{\"folder\":\"drafts\",\"message_id\":\"c2ca5b46-5ef4-4039-b632-c76e0215d05b\",\"status\":\"ok\"}\n"
  },
  {
    "method": "PUT",
    "url": "http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/messages/c2ee3a0c-2664-411c-a318-c352136cf6d8/folder",
    "status": 200,
    "response": "{\"folder\":\"trash\",\"message_id\":\"c2ee3a0c-2664-411c-a318-c352136cf6d8\",\"status\":\"ok\"}\n"
  },
  {
    "method": "DELETE",
    "url": "http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/messages/c2ee3a0c-2664-411c-a318-c352136cf6d8",
    "status": 204,
    "response": "<binary/stream>"
  },
  {
    "method": "PUT",
    "url": "http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/messages/c2ca5b46-5ef4-4039-b632-c76e0215d05b/folder",
    "status": 200,
    "response": "{\"folder\":\"trash\",\"message_id\":\"c2ca5b46-5ef4-4039-b632-c76e0215d05b\",\"status\":\"ok\"}\n"
  },
  {
    "method": "DELETE",
    "url": "http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/messages/trash",
    "status": 200,
    "response": "{\"deleted_count\":3,\"status\":\"ok\"}\n"
  }
]
```

## What did not work or is untested
- Automatic 30-day scheduled retention purging cron was not executed in this session; manual and on-demand Empty Bin routes and client deletion flows were executed and tested against live PostgreSQL and MinIO storage.

## Test suite output

Go backend test output:
```
$ $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable"; go test ./services/api -run "TestDraft|TestMove|TestPermanentDelete|TestEmptyTrash" -v -count=1
=== RUN   TestDraftCreateListGet
    drafts_test.go:156: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftCreateListGet (0.24s)
=== RUN   TestDraftUnauthenticated
    drafts_test.go:238: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftUnauthenticated (0.17s)
=== RUN   TestDraftInvalidMailbox
    drafts_test.go:265: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftInvalidMailbox (0.12s)
=== RUN   TestDraftCrossOrgForbidden
    drafts_test.go:288: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftCrossOrgForbidden (0.33s)
=== RUN   TestDraftInvalidPayload
    drafts_test.go:328: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftInvalidPayload (0.25s)
=== RUN   TestDraftNotFound
    drafts_test.go:354: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftNotFound (0.18s)
=== RUN   TestDraftInactiveUserRejected
    drafts_test.go:371: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftInactiveUserRejected (0.17s)
=== RUN   TestDraftSameOrgMemberAllowed
    drafts_test.go:393: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftSameOrgMemberAllowed (0.22s)
=== RUN   TestDraftUpdateAndDelete
    drafts_test.go:418: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestDraftUpdateAndDelete (0.28s)
=== RUN   TestMoveDraftToTrashAndRestore
    folder_lifecycle_test.go:78: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestMoveDraftToTrashAndRestore (0.23s)
=== RUN   TestMoveMessageToTrashAndRestore
    folder_lifecycle_test.go:129: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestMoveMessageToTrashAndRestore (0.19s)
=== RUN   TestPermanentDeleteMessageAndDraft
    folder_lifecycle_test.go:165: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestPermanentDeleteMessageAndDraft (0.26s)
=== RUN   TestEmptyTrash
    folder_lifecycle_test.go:212: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestEmptyTrash (0.28s)
PASS
ok  	byos.email/services/api	3.634s
```

Frontend test suite output:
```
$ npm.cmd test --prefix apps/webmail

> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:19028) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=9e45449e-69d3-469b-a46b-d0c3bf378b32 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=ffb381cc-9015-4277-a36d-f48f8dca5c09 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[Worker Crypto] Decryption failed for attachment_id=ad6eb273-f57b-4a83-8cd6-c90d0f2c497a chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: switched active identity to Account B
  ✓ test_switch_loads_target_account_keys: Account B signing seed loaded
  ✓ test_switch_loads_target_account_keys: Account B public key matches
  ✓ test_switch_preserves_other_account_keys: Account A keys still in store after switch
  ✓ test_clear_session_purges_current_and_promotes_next: active cleared, Account B promoted
  ✓ test_clear_session_purges_current_and_promotes_next: Account A keys purged from store
  ✓ test_clear_session_purges_current_and_promotes_next: Account B keys remain in store
  ✓ test_clear_session_purges_current_and_promotes_next: Account B is now active
  ✓ test_clear_all_sessions_purges_all_keys: all accounts cleared
  ✓ test_clear_all_sessions_purges_all_keys: no keys remain in store
  ✓ test_account_switch_dispatches_storage_event: dispatched account_switched event
  ✓ test_account_switch_dispatches_storage_event: target mailbox ID in event detail
  ✓ test_account_switch_dispatches_storage_event: target email in event detail
MULTI-ACCOUNT & STORAGE SYNC TESTS: 45 passed, 0 failed

Running Signature Store Tests...
SIGNATURE STORE TESTS: 11 passed, 0 failed

Running Responsive Webmail & CRM Integration Tests...
RESPONSIVE WEBMAIL & CRM TESTS: 18 passed, 0 failed

Running Track 2: Security Boundaries, Cryptographic Integrity & Anti-Tamper Tests...
TRACK 2 SECURITY TESTS: 12 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 12 passed, 0 failed

Running CRM Core Tests...
CRM CORE TESTS: 22 passed, 0 failed

Running Support Ticket Tests...
SUPPORT TICKET TESTS: 19 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

CALENDAR REPO INTEGRATION TESTS: 5 passed, 0 failed

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
HISTORICAL KEY REACTIVATION TESTS: 10 passed, 0 failed

Running Calendar Event Cryptography Tests...
CALENDAR CRYPTO TESTS: 10 passed, 0 failed

Running Calendar Module Integration Tests...
CALENDAR INTEGRATION TESTS: 8 passed, 0 failed

Running Production Refinements Tests...
PRODUCTION REFINEMENTS TESTS: 15 passed, 0 failed

Running Mobile Responsive Refinements Tests...
MOBILE RESPONSIVE TESTS: 12 passed, 0 failed

Running Calendar Categories (01, 02, 03) Tests...
CALENDAR CATEGORIES (01, 02, 03) TESTS: 12 passed, 0 failed

Running Calendar Category 04 Tests...
CALENDAR CATEGORY 04 TESTS: 8 passed, 0 failed

Running Calendar Category 05 Tests...
CALENDAR CATEGORY 05 TESTS: 8 passed, 0 failed

Running Calendar Category 06 Tests...
CALENDAR CATEGORY 06 TESTS: 8 passed, 0 failed

Running Calendar Category 07 Tests...
CALENDAR CATEGORY 07 TESTS: 8 passed, 0 failed

Running Calendar Category 08 Tests...
CALENDAR CATEGORY 08 TESTS: 8 passed, 0 failed

Running Calendar Category 10 Tests...
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed

Running KashCal Calendar System Tests...
KASHCAL CALENDAR TESTS: 8 passed, 0 failed

Running Calendar Track 1 Tests...
CALENDAR TRACK 1 TESTS: 8 passed, 0 failed

Running Calendar Track 2 Tests...
CALENDAR TRACK 2 TESTS: 8 passed, 0 failed

Running Calendar Track 3 Tests...
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed

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
[Worker Crypto] Decryption failed for attachment_id=5480e80c-e47f-4e5b-b59c-df804340033d chunk_index=1
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
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
Running Folder & Permanent Trash Lifecycle Tests...
  ✓ 1. TestDraftMappingPreservesFolderAndFlags
  ✓ 2. TestDraftsInTrashFilterCorrectly
  ✓ 3. TestMovingDraftToTrashAndRestoreInState
  ✓ 4. TestPermanentDeleteFiltersMessage
  ✓ 5. TestEmptyTrashFiltersAllTrashItems
  ✓ 6. TestReadingPaneDraftDetectionInTrash
  ✓ 7. TestUndoActionStoresPreviousAndTargetFolder
FOLDER & TRASH TESTS: 7 passed, 0 failed

OVERALL: 674 passed, 0 failed
```
