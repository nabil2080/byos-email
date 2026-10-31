# Concurrent Binary Attachment Upload Pipeline Report

## What was built
Implemented a concurrent binary attachment upload pipeline (`apps/webmail/src/attachment_upload_pipeline.ts`) with bounded concurrency (default 4 workers, clamped 1–8), transient exponential backoff retry with jitter, fail-closed error propagation, and reactive progress tracking. Integrated the pipeline into `apps/webmail/src/App.tsx` for immediate Path A encrypted email dispatch and scheduled/offline draft sends, replacing previous serial `for (const ch of chunks) await uploadAttachmentChunk(...)` loops and reducing payload upload latency while providing fault tolerance against transient network failures.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/attachment_upload_pipeline.ts` | Concurrent attachment chunk upload coordinator with bounded concurrency pool, backoff retry, and progress callbacks |
| `apps/webmail/src/attachment_upload_pipeline.test.tsx` | Vitest test suite testing concurrency bounds, exponential retry, fail-closed handling, and progress notifications |
| `apps/webmail/src/App.tsx` | Integrated `uploadChunksConcurrently` into Path A real-time and scheduled message dispatch flows |
| `docs/concurrent_attachment_upload_pipeline_report.md` | Verification documentation, raw evidence, and file edit accounting |

## Raw evidence

### 1. TypeScript Verification
Terminal output of `cmd /c "cd apps\webmail && npm run typecheck"`:
```
> typecheck
> tsc --noEmit
```

### 2. Vitest Test Suite Execution
Terminal output of `cmd /c "cd apps\webmail && npm run test:vitest"`:
```
> test:vitest
> vitest run


 RUN  v5.0.5 F:/Codex/byos-email/apps/webmail

 ✓ src/components/ErrorBoundary.test.tsx (3 tests) 28ms
 ✓ src/context/context.test.tsx (13 tests) 27ms
 ✓ src/attachment_upload_pipeline.test.tsx (5 tests) 326ms

 Test Files  3 passed (3)
      Tests  21 passed (21)
   Start at  14:29:14
   Duration  1.10s (environment 56%, setup 22%, tests 17%, transform 3%, import 2%, worker 1%)
```

### 3. Production Bundle Build
Terminal output of `cmd /c "cd apps\webmail && npm run build"`:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 322 modules transformed.
rendering chunks...
dist/index.html                                    1.79 kB │ gzip:   0.86 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-BMUt3RQ-.css                   152.18 kB │ gzip:  23.26 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-DaMhq7MG.js                  3,110.76 kB │ gzip: 640.68 kB
✓ built in 6.24s
```

## Manual browser verification
UNTESTED: Live headless browser interaction with a running Go backend and Postgres storage cluster was not exercised during this unit and pipeline integration phase. The pipeline logic and network fault handling were verified via automated mock-injection unit testing in `apps/webmail/src/attachment_upload_pipeline.test.tsx`.

Manual steps required to verify end-to-end:
1. Start Postgres and backend API (`cd services/api && go run .`).
2. Start Webmail Vite dev server (`cd apps/webmail && npm run dev`).
3. Log into account with credentials.
4. Compose message with multiple large attachments (> 10MB total).
5. Open browser DevTools Network tab, inspect concurrent chunk PUT/POST requests, and verify up to 4 concurrent HTTP requests in flight simultaneously.

## What did not work or is untested
- Live multi-gigabyte upload under real WAN network throttling is UNTESTED in this unit harness.
- Browser DevTools screenshot generation in `tests/browser/artifacts/` was not executed as the Go backend server was not kept running during this code modernization step.

## Test suite output
Terminal output of `cmd /c "cd apps\webmail && npm test"`:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:16656) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
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
OVERALL: 615 passed, 0 failed
```
