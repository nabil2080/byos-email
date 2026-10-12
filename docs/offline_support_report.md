# Offline Support (Service Worker + Local Queue) Report

## What was built
Implemented end-to-end offline support for the BYOS webmail platform. The application shell and static assets are precached by a Service Worker (`sw.js`). Inbox envelopes (up to the 50 most recent per active mailbox) are cached as raw ciphertext in IndexedDB (`byos-offline`), leaving unsealed private keys strictly in `sessionStorage` (Directive D1 & D4). An accessible top notification banner (`OfflineBanner.tsx`) informs the user when offline. Offline compose locks the `From:` dropdown to the active account (Directive D3) and buffers messages into a persistent IndexedDB `send_queue` tagged with a UUID `client_queue_id`. Upon network reconnection, queued items are replayed in FIFO order with server-side deduplication via PostgreSQL migration 051, returning HTTP 200 with `X-Idempotent-Replay: true` (Directive D5). On logout, all offline caches and stores are purged.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/051_client_queue_id.sql` | Added `client_queue_id UUID` column and unique partial index on `message_metadata`. |
| `services/api/internal_delivery.go` | Added `client_queue_id` validation, server idempotency lookup, and DB write support. |
| `services/api/outbound.go` | Added `client_queue_id` validation and deduplication lookup in outbound send handler. |
| `services/api/scheduled_completion.go` | Updated `createSentMessageCopy` caller to pass `nil` `clientQueueID`. |
| `services/api/scheduled_path_a_delivery.go` | Updated callers of `deliverEnvelopeToMailbox` and `createSentMessageCopy` to pass `nil` `clientQueueID`. |
| `services/api/offline_idempotency_test.go` | Added backend Go unit tests verifying `client_queue_id` idempotency and header replay. |
| `apps/webmail/src/api.ts` | Added `client_queue_id`, `alias_id`, and `sender_email` to `InternalSendRequest`. |
| `apps/webmail/src/offline.ts` | Implemented reactive network status signals (`online`/`offline`/`reconnecting`) and event listeners. |
| `apps/webmail/src/offline_cache.ts` | Implemented IndexedDB `byos-offline` manager for ciphertext envelope caching and cleanup. |
| `apps/webmail/src/send_queue.ts` | Implemented FIFO offline send queue, replay worker, and concurrency mutex. |
| `apps/webmail/src/components/OfflineBanner.tsx` | Created accessible UI banner for offline status and reconnect sync state. |
| `apps/webmail/public/sw.js` | Service Worker script for shell precaching and runtime caching. |
| `apps/webmail/src/sw.ts` | Deleted: consolidated Service Worker registration and cache utilities into `offline.ts`. |
| `apps/webmail/src/components/ComposeDrawer.tsx` | Locked `From:` dropdown when offline with lock indicator badge (Directive D3). |
| `apps/webmail/src/App.tsx` | Wired network listeners, Service Worker, banner, offline caching, and offline compose queuing. |
| `apps/webmail/src/offline.test.ts` | Unit test suite covering offline cache depth, ciphertext storage, key absence, and queue replay. |
| `apps/webmail/src/run_test.node.js` | Registered `offline.test.ts` in webmail test runner. |
| `tests/browser/test_offline.mjs` | E2E Puppeteer test verifying real login, offline reading, compose lock, queueing, and reconnect replay. |
| `smoke.ps1` | Added `test_offline.mjs` to automated browser smoke verification suite (10/10). |
| `docs/smoke_gaps.md` | Documented deliberate offline architectural limitations (Directives D1 and D2). |
| `docs/offline_support_report.md` | Full evidence report. |

## Raw evidence

### 1. Database Schema Migration Verification
Command: `docker exec byos-postgres psql -U byos -d byos -c "\d message_metadata"`
```
                                             Table "public.message_metadata"
           Column            |           Type           | Collation | Nullable |                 Default                  
-----------------------------+--------------------------+-----------+----------+------------------------------------------
 id                          | uuid                     |           | not null | gen_random_uuid()
 mailbox_id                  | uuid                     |           | not null | 
 domain_id                   | uuid                     |           | not null | 
 message_seq                 | bigint                   |           | not null | nextval('mailbox_message_seq'::regclass)
 direction                   | text                     |           | not null | 
 delivery_identity           | bytea                    |           | not null | 
 sender                      | text                     |           | not null | 
 recipients                  | text[]                   |           | not null | 
 has_attachments             | boolean                  |           | not null | false
 attachment_count            | integer                  |           | not null | 0
 storage_object_id           | text                     |           | not null | 
 content_key_hpke_wrapped    | bytea                    |           | not null | 
 mailbox_sk_version          | integer                  |           | not null | 
 encryption_version          | integer                  |           | not null | 1
 encryption_iv               | bytea                    |           | not null | 
 aad_version                 | smallint                 |           | not null | 1
 bundle_hash                 | bytea                    |           | not null | 
 received_at                 | timestamp with time zone |           | not null | now()
 sent_at                     | timestamp with time zone |           |          | 
 status                      | text                     |           | not null | 'received'::text
 folder                      | character varying(32)    |           | not null | 'inbox'::character varying
 folder_id                   | uuid                     |           |          | 
 is_read                     | boolean                  |           | not null | false
 wrapped_key_algorithm       | text                     |           | not null | 'HPKE-X25519-AES256GCM-v1'::text
 message_id                  | text                     |           |          | 
 in_reply_to                 | text                     |           |          | 
 thread_id                   | uuid                     |           | not null | gen_random_uuid()
 is_starred                  | boolean                  |           | not null | false
 snoozed_until               | timestamp with time zone |           |          | 
 size_bytes                  | bigint                   |           | not null | 0
 attachment_envelopes        | jsonb                    |           |          | '[]'::jsonb
 sender_attachment_envelopes | jsonb                    |           |          | '[]'::jsonb
 category_override           | text                     |           |          | 
 client_queue_id             | uuid                     |           |          | 
Indexes:
    "message_metadata_pkey" PRIMARY KEY, btree (id)
    "idx_message_metadata_attachments" gin (attachment_envelopes) WHERE attachment_envelopes <> '[]'::jsonb
    "idx_message_metadata_client_queue" UNIQUE, btree (mailbox_id, client_queue_id) WHERE client_queue_id IS NOT NULL
    "idx_message_metadata_folder" btree (mailbox_id, folder)
    "idx_message_metadata_folder_id" btree (mailbox_id, folder_id)
    "idx_message_metadata_identity" btree (mailbox_id, delivery_identity)
    "idx_message_metadata_inreply" btree (mailbox_id, in_reply_to) WHERE in_reply_to IS NOT NULL
    "idx_message_metadata_mailbox" btree (mailbox_id)
    "idx_message_metadata_msgid" btree (mailbox_id, message_id) WHERE message_id IS NOT NULL
    "idx_message_metadata_received" btree (mailbox_id, received_at)
    "idx_message_metadata_snoozed" btree (mailbox_id, snoozed_until) WHERE snoozed_until IS NOT NULL
    "idx_message_metadata_starred" btree (mailbox_id, is_starred) WHERE is_starred = true
    "idx_message_metadata_thread" btree (mailbox_id, thread_id)
    "message_metadata_mailbox_id_delivery_identity_key" UNIQUE CONSTRAINT, btree (mailbox_id, delivery_identity)
    "message_metadata_mailbox_id_message_seq_key" UNIQUE CONSTRAINT, btree (mailbox_id, message_seq)
```

### 2. PostgreSQL Duplicate client_queue_id Check
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT client_queue_id, count(*) FROM message_metadata WHERE client_queue_id IS NOT NULL GROUP BY client_queue_id HAVING count(*) > 1;"`
```
 client_queue_id | count 
-----------------+-------
(0 rows)
```

### 3. Backend Idempotency Unit Tests
Command: `go test -v -run "TestSendInternal" ./...` (in `services/api`)
```
=== RUN   TestSendInternalIdempotentByClientQueueId
2026/10/12 21:05:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
2026/10/12 21:05:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestSendInternalIdempotentByClientQueueId (0.15s)
=== RUN   TestSendInternalWithoutClientQueueIdIsNotIdempotent
2026/10/12 21:05:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
2026/10/12 21:05:01 [INFO] V1 envelope contains non-null sig (len=88); caller should verify
--- PASS: TestSendInternalWithoutClientQueueIdIsNotIdempotent (0.18s)
PASS
ok  	byos.email/services/api	0.354s
```

### 4. Frontend Unit Tests (Offline Suite)
Command: `npm.cmd test` (in `apps/webmail`)
```
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
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:182:22)
  ✓ 6. Replay handles server 200 (removes item) and server error (marks failed)
  ✓ 7. Clear offline cache deletes all stores and SW caches
OFFLINE SUPPORT TESTS: 7 passed, 0 failed

OVERALL: 242 passed, 0 failed
```

## Manual browser verification
Executed end-to-end browser integration suite:
Command: `node --experimental-wasm-modules tests/browser/test_offline.mjs`
```
================================================================================
          OFFLINE SUPPORT BROWSER INTEGRATION TEST (E2E)                        
================================================================================

[Setup] Sending seed message to Alice: "Offline Seed Verification 1791819547443"...
--- [STEP 1] Real login flow as Alice (alice@byos.local) ---
  Active account: "alice@byos.local"
  PASS: Alice logged in successfully via real credentials

--- [STEP 2] Verify Service Worker registration ---
  PASS: Service worker registered (navigator.serviceWorker.controller non-null)

--- [STEP 3] Verify Inbox loads and caches messages in IndexedDB ---
  Cached messages count in IndexedDB: 2
  PASS: Inbox messages cached in IndexedDB (max 50)
  PASS: D1: Unsealed mailbox sk is NOT in IndexedDB
  PASS: D1: Unsealed signing seed is NOT in IndexedDB
  PASS: D1: Unsealed X-Wing seed is NOT in IndexedDB
  PASS: D4: Plaintext body is NOT stored on disk in IndexedDB

--- [STEP 4] Emulate network offline via CDP ---
  Testing offline reload of app shell from Service Worker cache...
  PASS: Reload offline loads the shell (sidebar rendered)
  Offline Banner text: "You are offline. Showing cached messages from this session. Changes will sync when reconnected."
  PASS: Offline banner appears
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\offline_support.png
  PASS: Cached message opens and decrypts

--- [STEP 5] Verify Compose From dropdown locked offline (Directive D3) ---
  PASS: Compose From: is locked with a tooltip

--- [STEP 6] Compose and enqueue message offline ---
  PASS: Send offline shows "queued" toast
  Waiting for undo countdown to finish and local enqueue (~6s)...
  PASS: IndexedDB has the queue entry
  PASS: D5: Queued item has valid UUID client_queue_id

--- [STEP 7] Reconnect network and verify queue replay ---
  PASS: Network restored
  PASS: "Back online" toast appears
  Waiting for replay to complete and empty send_queue...
  PASS: Queue is empty

--- [STEP 8] Verify Mailpit delivery ---
  PASS: Mailpit shows the delivered message
  PASS: No console errors

================================================================================
          ALL OFFLINE SUPPORT BROWSER TESTS PASSED CLEANLY                      
================================================================================
```

Screenshot artifact saved to repository:
`tests/browser/artifacts/offline_support.png`

## What did not work or is untested
1. **Multi-account offline compose (Directive D3 limitation):** Offline compose is locked exclusively to the currently active mailbox account. Changing senders offline across multiple accounts is intentionally unsupported for V1 and documented as out-of-scope.
2. **Session-bound offline decryption (Directive D1 tradeoff):** Unsealed private keys, signing seeds, and X-Wing seeds are restricted strictly to `sessionStorage`. If the browser tab is terminated while disconnected, cached ciphertext cannot be decrypted until the user reconnects and logs in again. Documented in `docs/smoke_gaps.md`.
3. **Non-Inbox folders offline (Directive D2 limitation):** Only the 50 newest Inbox messages are precached. Folders such as Sent, Archive, Trash, and Search are not cached for offline viewing.

## Test suite output

### Go Test Suite (`services/api`)
Command: `go test ./... -count=1`
```
ok  	byos.email/services/api	40.108s
```

### Full Smoke Test Suite
Command: `.\make.bat smoke`
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (15.7s)
  [PASS] test_sidebar_restructure.mjs        PASS (10.9s)
  [PASS] test_unified_inbox_browser.mjs      PASS (26.9s)
  [PASS] test_account_switch_crypto.mjs      PASS (63.6s)
  [PASS] test_masked_email.mjs               PASS (44.6s)
  [PASS] test_alias_custom.mjs               PASS (40.3s)
  [PASS] test_compose_default_account.mjs    PASS (13.2s)
  [PASS] test_wire_integrity.mjs             PASS (79.8s)
  [PASS] test_focused_inbox.mjs              PASS (31.9s)
  [PASS] test_offline.mjs                    PASS (32.6s)
================================================================================

SMOKE SUITE PASSED: All 10 tests passed cleanly.
```
