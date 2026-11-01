# Final Attachment Upload Acceptance and Remediation Report

## What was built
Implemented the three final acceptance areas for the BYOS concurrent binary attachment upload pipeline: centralized attachment send-readiness validation across normal composition and scheduled drafts (`validateAttachmentSendReadiness` in `apps/webmail/src/attachment_upload_pipeline.ts` preventing in-flight, failed, cancelled, or duplicate attachments from entering outgoing messages), safe handling and isolation of partially uploaded storage objects (tracking distinct `uploadAttemptId` references to eliminate race conditions from stale async callbacks, enforcing unlinked-only server attachment deletion, and isolating unreferenced Path A chunk objects under sender mailbox storage prefixes with conservative retention), and byte-accurate upload progress (tracking exact `completedBytes` and `totalBytes` across unequal chunk sizes, reporting human-readable byte formats in `ComposeDrawer.tsx`, and calculating byte-weighted aggregate progress across multi-attachment compose operations).

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/attachment_upload_pipeline.ts` | Added byte-based upload progress metrics, byte-weighted aggregation, `validateAttachmentSendReadiness` centralized validation guard, and byte formatting utilities. |
| `apps/webmail/src/api.ts` | Added `completedBytes`, `totalBytes`, and `uploadAttemptId` to `AttachmentItem` and `uploadEncryptedAttachment`. |
| `apps/webmail/src/components/ComposeDrawer.tsx` | Enforced centralized send readiness, displayed human-readable byte progress metrics in attachment pills and aggregate banner, and disabled the Send button when attachments are invalid or in-flight. |
| `apps/webmail/src/App.tsx` | Added `uploadAttemptId` lifecycle guards against stale async callbacks, updated `runAttachmentUpload`, `tryPathASend`, and `schedulePathA` with byte tracking, and added pre-send readiness validation check. |
| `apps/webmail/src/attachment_upload_pipeline.test.tsx` | Added automated tests for unequal chunk byte tracking, retry byte deduplication, byte-weighted aggregate progress, and send readiness validation edge cases. |
| `apps/webmail/src/components/ComposeDrawer.test.tsx` | Added reactive component tests testing byte progress display, Cancel All, retry, disabled send button behavior, and readiness validation. |
| `services/api/cors.go` | Added `X-Object-Key, x-object-key` to CORS allowed and exposed headers for binary chunk transport. |

## Raw evidence

### 1. TypeScript Strict Typecheck
Command:
```bash
cmd /c "cd apps\webmail && npm run typecheck"
```
Output:
```
> typecheck
> tsc --noEmit
```

### 2. Frontend Vitest Suite
Command:
```bash
cmd /c "cd apps\webmail && npm run test:vitest"
```
Output:
```
> test:vitest
> vitest run


 RUN  v5.0.5 F:/Codex/byos-email/apps/webmail

 ✓ src/binary_upload.test.tsx (4 tests) 8ms
 ✓ src/components/ErrorBoundary.test.tsx (3 tests) 31ms
 ✓ src/context/context.test.tsx (13 tests) 23ms
 ✓ src/components/ComposeDrawer.test.tsx (5 tests) 56ms
 ✓ src/attachment_upload_pipeline.test.tsx (21 tests) 444ms

 Test Files  5 passed (5)
      Tests  46 passed (46)
   Start at  15:55:53
   Duration  1.79s (environment 47%, transform 23%, setup 18%, tests 9%, import 2%, worker 1%)
```

### 3. Production Vite Build
Command:
```bash
cmd /c "cd apps\webmail && npm run build"
```
Output:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 322 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                    1.79 kB │ gzip:   0.86 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-DObLGhWv.css                   154.00 kB │ gzip:  23.40 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-CATnuHCF.js                  3,124.88 kB │ gzip: 644.18 kB
✓ built in 6.52s
```

### 4. Active PostgreSQL Database Isolation Check
Command:
```bash
docker exec byos-postgres psql -U byos -d byos -c "SELECT count(*) FROM attachments;"
```
Output:
```
 count 
-------
     4
(1 row)
```

### 5. Git Status Check
Command:
```bash
git status
```
Output:
```
On branch main
Your branch is ahead of 'origin/main' by 6 commits.
  (use "git push" to publish your local commits)

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   apps/webmail/src/App.tsx
	modified:   apps/webmail/src/api.ts
	modified:   apps/webmail/src/attachment_upload_pipeline.test.tsx
	modified:   apps/webmail/src/attachment_upload_pipeline.ts
	modified:   apps/webmail/src/components/ComposeDrawer.tsx
	modified:   services/api/cors.go

Untracked files:
  (use "git add <file>..." to include in what will be committed)
	apps/webmail/src/binary_upload.test.tsx
	apps/webmail/src/components/ComposeDrawer.test.tsx
	docs/attachment_upload_experience_recovery_report.md
	docs/attachment_upload_final_acceptance_report.md
	docs/attachment_upload_pipeline_binary_transport_report.md
	docs/attachment_upload_pipeline_scope_verification.md
	services/api/message_attachments_test.go

no changes added to commit (use "git add" and/or "git commit -a")
```

### 6. Git Diff Stat
Command:
```bash
git diff --stat
```
Output:
```
 apps/webmail/src/App.tsx                           | 328 +++++++++++++++--
 apps/webmail/src/api.ts                            |  54 ++-
 .../src/attachment_upload_pipeline.test.tsx        | 392 ++++++++++++++++++++-
 apps/webmail/src/attachment_upload_pipeline.ts     | 306 +++++++++++++++-
 apps/webmail/src/components/ComposeDrawer.tsx      | 219 ++++++++++--
 services/api/cors.go                               |   2 +-
 6 files changed, 1228 insertions(+), 73 deletions(-)
```

## Manual browser verification
UNTESTED: Live headless browser interaction with a running Go backend and full local mail stack was not exercised during this final pipeline acceptance phase. Reactive UI state assertions, byte formatting displays, Send button disabled states, and cancellation flows were exercised via DOM component tests in `apps/webmail/src/components/ComposeDrawer.test.tsx` and pipeline tests in `apps/webmail/src/attachment_upload_pipeline.test.tsx`.

Manual steps required to verify end-to-end:
1. Start PostgreSQL (`docker start byos-postgres`).
2. Start the Go API server (`cd services/api && go run .`).
3. Start the Webmail Vite server (`cd apps/webmail && npm run dev`).
4. Log into `http://localhost:5173` with account credentials.
5. Open the compose drawer and attach a file with unequal chunks (e.g., 2.5 MB file with 1 MB chunk size).
6. Observe the progress pill display byte-level progress (e.g. "1.0 MB / 2.5 MB (40%)") instead of coarse chunk counts.
7. Verify that the Send button remains disabled while any upload is in progress or in an error state.
8. Cancel an in-flight upload and verify that the Send button tooltip reports the readiness failure reason.

## What did not work or is untested
- Live multi-gigabyte browser upload to external cloud object storage (S3/GCS) under simulated WAN latency is UNTESTED.
- Full end-to-end headless browser screenshots via Puppeteer in `tests/browser/artifacts/` were not captured because the Go API server and frontend dev server were not running continuously in the background during this test isolation phase.

## Test suite output

### Go Integration Test Suite (Database Isolated via `byos_test_isolation`)
Command:
```bash
cmd /c "set TEST_DATABASE_URL=postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable&& cd services\api && go test -v -run TestUploadAttachmentChunk"
```
Output:
```
=== RUN   TestUploadAttachmentChunk_RawBinarySuccess
    message_attachments_test.go:27: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
2026/10/31 15:59:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestUploadAttachmentChunk_RawBinarySuccess (0.16s)
=== RUN   TestUploadAttachmentChunk_Base64JsonFallback
    message_attachments_test.go:62: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
2026/10/31 15:59:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestUploadAttachmentChunk_Base64JsonFallback (0.14s)
=== RUN   TestUploadAttachmentChunk_Unauthorized
--- PASS: TestUploadAttachmentChunk_Unauthorized (0.00s)
=== RUN   TestUploadAttachmentChunk_ScopeIsolation
    message_attachments_test.go:106: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
2026/10/31 15:59:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestUploadAttachmentChunk_ScopeIsolation (0.14s)
=== RUN   TestUploadAttachmentChunk_CORSPreflight
--- PASS: TestUploadAttachmentChunk_CORSPreflight (0.00s)
=== RUN   TestUploadAttachmentChunk_OversizedChunk
    message_attachments_test.go:165: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
2026/10/31 15:59:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestUploadAttachmentChunk_OversizedChunk (0.17s)
=== RUN   TestUploadAttachmentChunk_StorageWorkerFailure
    message_attachments_test.go:191: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
2026/10/31 15:59:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestUploadAttachmentChunk_StorageWorkerFailure (0.14s)
=== RUN   TestUploadAttachmentChunk_EndToEndCiphertextIntegrity
    message_attachments_test.go:214: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
2026/10/31 15:59:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestUploadAttachmentChunk_EndToEndCiphertextIntegrity (0.14s)
PASS
ok  	byos.email/services/api	1.040s
```

### Full Frontend Legacy Test Suite
Command:
```bash
cmd /c "cd apps\webmail && npm test"
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:6988) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=767eb27d-2fc7-4639-9886-f9f8857e8587 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=e58b63d8-71b2-4a9e-989e-f162e18e18a3 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
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
[Worker Crypto] Decryption failed for attachment_id=5e69c8aa-118d-455a-8ea6-af947d769e77 chunk_index=0
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
  ✓ test_switch_loads_target_account_keys: storage accounts list remains unchanged
  ✓ test_concurrent_tabs_account_switch: storage event triggers active account update
MULTI-ACCOUNT & STORAGE SYNC TESTS: 34 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 15 passed, 0 failed

Running Offline Sync Tests...
OFFLINE SYNC TESTS: 17 passed, 0 failed

Running Reply Signature Tests...
REPLY SIGNATURE TESTS: 12 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 10 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 14 passed, 0 failed

Running Masked Email Verification Tests...
MASKED EMAIL TESTS: 17 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 16 passed, 0 failed

Running Track 2 & Zero-Knowledge Security Tests...
--- Part A.1: In-Memory Key Custody & Zeroization ---
  ✓ sessionStorage has NO private key hex strings after setAccountKeys
  ✓ zeroizeKeys fills in-memory buffers with 0 and sweeps sensitive keys from storage
  ✓ unsealAccountKeys purges sessionStorage legacy keys and loads in-memory
  ✓ sanitizeConnectedAccounts removes private keys from accounts before session storage
  ✓ full login flow verifies sessionStorage contains NO private key hex strings after login

--- Part A.2: Encrypted Contacts Wireup ---
  ✓ encryptContactEnvelope creates valid ciphertext and decryptContactEnvelope unpacks all fields
  ✓ contact creation dispatches ciphertext envelopes with NO plaintext fields
  ✓ contact creation fails closed without active mailbox key

--- Part A.3: Envelope Draft Subjects & Recipients ---
  ✓ draft saving packages subject, recipient, and body into ciphertext envelope and zeroes API fields

--- Part B.1: Debounced Draft Auto-Save ---
  ✓ debounced autosave dirty-state tracking and cancellation

--- Part B.2: Live Snooze Expiration Loop ---
  ✓ isMessageSnoozed correctly checks future vs expired timestamps
  ✓ checkSnoozeExpirations identifies messages expiring in the time window
  ✓ live snooze expiration loop wakes snoozed messages into inbox with read: false and clears snoozedUntil

--- Part B.3: RFC 5322 .eml Export ---
  ✓ buildEmlContent formats RFC 5322 MIME headers and multipart mixed attachments
  ✓ uint8ArrayToBase64 safely encodes large buffers without failure

--- Part B.4: Dynamic Sender Key Epoch Resolution ---
  ✓ decryptPathAEnvelope resolves dynamic key epoch without failing thread decryption
  ✓ decryptPathAEnvelope does NOT throw and preserves thread plaintext even if sender verification fails
TRACK 2 & ZERO-KNOWLEDGE SECURITY TESTS: 17 passed, 0 failed

Running Calendar Track 3 Verification Tests...
  ✓ Track 3.1: External Calendar URL normalization converts webcal:// to https://
[urlCalendarStore] Proxy fetch returned HTTP 502, falling back to direct fetch
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
[Worker Crypto] Decryption failed for attachment_id=3a1faf53-1f3a-4d0e-b671-835d71649e49 chunk_index=1
  ✓ Tampered attachment chunk is isolated and reports specific chunk index
  ✓ Worker rejects invalid operations and returns structured error
  ✓ Worker bridge enforces operation timeout and cleans pending request
[CryptoWorkerBridge] Worker error encountered: Out of memory simulated crash
  ✓ Worker error event triggers crash cleanup and rejects pending requests
  ✓ Transferable ArrayBuffer detaches buffer on message channel dispatch
  ✓ zeroizeBuffer wipes sensitive in-memory bytes to 0
  ✓ Dispatches multiple concurrent operations across the worker message channel without interference
  ✓ Direct execution fallback mode operates reliably when worker is disabled
OVERALL: 612 passed, 0 failed
```
