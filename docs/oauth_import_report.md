# Direct Gmail and Outlook OAuth Import (V1) Report

## What was built
Implemented a direct browser-driven OAuth 2.0 mailbox import for Gmail and Outlook conforming to the zero-knowledge architecture. OAuth tokens and imported raw RFC 822 messages are encrypted client-side using AES-GCM with the mailbox key before being saved to customer storage (`storage-worker`), ensuring plaintext credentials and email bodies never touch BYOS backend servers. The system enforces a 5-worker concurrency limit, handles HTTP 429 `Retry-After` headers and 503 exponential backoff, provides a 5-step user wizard with an explicit progress warning banner and cancellation support, and guarantees import idempotency through unique partial database constraints on `(mailbox_id, source_provider, source_message_id)`.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/054_oauth_import.sql` | Schema migration defining `import_jobs` table and adding deduplication columns to `message_metadata`. |
| `services/api/import.go` | Go backend endpoints for OAuth state generation, callback token exchange, job tracking, and customer storage proxying. |
| `services/api/messages.go` | Permitted `byos-imported-v1` wrapped key algorithm in `loadEncryptedMessageBody`. |
| `services/api/main.go` | Registered HTTP route handlers for import lifecycle and customer storage access. |
| `services/api/import_test.go` | Unit and integration tests for import authentication, token exchange, deduplication, and job tracking. |
| `tools/clean-test-data.sql` | Added cleanup statements for `import_jobs` table between test runs. |
| `apps/webmail/src/oauth_import.ts` | Client-side cryptographic envelope encryption for tokens and raw EML data, and API storage helpers. |
| `apps/webmail/src/import_worker.ts` | Browser import engine managing 5-worker concurrency cap, 429 Retry-After backoff, EML parsing, and message ingestion. |
| `apps/webmail/src/routes/settings/ImportTab.tsx` | 5-step import wizard component with provider cards, popup authorization, folder mapping, D4 warning banner, and job history. |
| `apps/webmail/src/routes/import/OAuthCallback.tsx` | Popup callback handler extracting OAuth tokens from URI hash fragment and transmitting them via `postMessage`. |
| `apps/webmail/src/routes/settings/SettingsLayout.tsx` | Added Mailbox Import navigation item to Settings sidebar. |
| `apps/webmail/src/components/Sidebar.tsx` | Added quick import navigation action and test attribute to sidebar. |
| `apps/webmail/src/App.tsx` | Routed `/import/callback` and rendered `ImportTab` within settings view. |
| `apps/webmail/src/oauth_import.test.ts` | Unit tests for client token encryption roundtrip, tampered ciphertext rejection, envelope format, and backoff handling. |
| `apps/webmail/src/run_test.node.js` | Registered `runOAuthImportTests()` suite in Node test runner. |
| `tests/browser/test_import.mjs` | Browser test verifying real login, popup OAuth, progress banner, inbox decryption, idempotency, and storage ciphertext. |
| `smoke.ps1` | Added `tests/browser/test_import.mjs` to automated smoke test suite. |
| `docs/oauth_import_report.md` | Verification report with raw evidence, schema dumps, and test logs. |

## Raw evidence

### Schema verification: import_jobs table
The schema migration was applied and verified
```
                               Table "public.import_jobs"
      Column       |           Type           | Collation | Nullable |      Default      
-------------------+--------------------------+-----------+----------+-------------------
 id                | uuid                     |           | not null | gen_random_uuid()
 mailbox_id        | uuid                     |           | not null | 
 provider          | text                     |           | not null | 
 status            | text                     |           | not null | 'running'::text
 total_messages    | integer                  |           | not null | 0
 imported_messages | integer                  |           | not null | 0
 skipped_messages  | integer                  |           | not null | 0
 failed_messages   | integer                  |           | not null | 0
 error_message     | text                     |           |          | 
 started_at        | timestamp with time zone |           | not null | now()
 completed_at      | timestamp with time zone |           |          | 
 created_at        | timestamp with time zone |           | not null | now()
 updated_at        | timestamp with time zone |           | not null | now()
Indexes:
    "import_jobs_pkey" PRIMARY KEY, btree (id)
    "idx_import_jobs_mailbox" btree (mailbox_id, created_at DESC)
Foreign-key constraints:
    "import_jobs_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
```

### Schema verification: message_metadata columns & index
The partial unique index and source columns were confirmed
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
 source                      | text                     |           | not null | 'native'::text
 source_provider             | text                     |           |          | 
 source_message_id           | text                     |           |          | 
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
    "idx_message_metadata_source_unique" UNIQUE, btree (mailbox_id, source_provider, source_message_id) WHERE source_provider IS NOT NULL AND source_message_id IS NOT NULL
    "idx_message_metadata_starred" btree (mailbox_id, is_starred) WHERE is_starred = true
    "idx_message_metadata_thread" btree (mailbox_id, thread_id)
    "message_metadata_mailbox_id_delivery_identity_key" UNIQUE CONSTRAINT, btree (mailbox_id, delivery_identity)
    "message_metadata_mailbox_id_message_seq_key" UNIQUE CONSTRAINT, btree (mailbox_id, message_seq)
```

### Directive D1 & D2 Customer Storage Ciphertext Verification
Inspection of customer storage objects confirms zero-knowledge encryption with mailbox key
```
OAuth token storage blob length: 170 bytes, Version byte: 0x1
Imported message blob length: 286 bytes, Version byte: 0x1
```

### Directive D5 Deduplication Database Proof
Re-running the import confirmed idempotency; the second execution skipped all duplicates
```
                  id                  | provider |  status   | total_messages | imported_messages | skipped_messages 
--------------------------------------+----------+-----------+----------------+-------------------+------------------
 109c400d-8932-4c7b-b1df-2ca6567a56a5 | gmail    | completed |              5 |                 5 |                0
 e9d127ad-f4c1-433d-be42-064ef625d224 | gmail    | completed |              5 |                 0 |                5
(2 rows)
```

### Test File Diffs
Diff of `apps/webmail/src/run_test.node.js` and `smoke.ps1`:
```diff
diff --git a/apps/webmail/src/run_test.node.js b/apps/webmail/src/run_test.node.js
index 6057d04..cea1260 100644
--- a/apps/webmail/src/run_test.node.js
+++ b/apps/webmail/src/run_test.node.js
@@ -29,6 +29,7 @@ import { runContactsTests } from "./contacts.test.js";
 import { runSidebarBorderlessTests } from "./sidebar_borderless.test.js";
 import { runProfilePhotoTests } from "./profile_photo.test.js";
 import { runPersistentSessionTests } from "./persistent_session.test.js";
+import { runOAuthImportTests } from "./oauth_import.test.js";
 
 async function main() {
   let totalPassed = 0;
@@ -218,6 +219,12 @@ async function main() {
   totalPassed += persistentSessionRes.passed;
   totalFailed += persistentSessionRes.failed;
 
+  console.log("Running OAuth Import Tests...");
+  const oauthImportRes = await runOAuthImportTests();
+  console.log(`OAUTH IMPORT TESTS: ${oauthImportRes.passed} passed, ${oauthImportRes.failed} failed\n`);
+  totalPassed += oauthImportRes.passed;
+  totalFailed += oauthImportRes.failed;
+
   console.log(`OVERALL: ${totalPassed} passed, ${totalFailed} failed`);
   if (totalFailed > 0) {
     process.exit(1);
diff --git a/smoke.ps1 b/smoke.ps1
index 70cc9b4..8c5d5d2 100644
--- a/smoke.ps1
+++ b/smoke.ps1
@@ -46,7 +46,8 @@ $tests = @(
     "tests/browser/test_focused_inbox.mjs",
     "tests/browser/test_offline.mjs",
     "tests/browser/test_composer.mjs",
-    "tests/browser/test_contacts.mjs"
+    "tests/browser/test_contacts.mjs",
+    "tests/browser/test_import.mjs"
 )
 
 $results = @{}
```

## Manual browser verification
Browser execution was executed via Puppeteer in `tests/browser/test_import.mjs`:
1. **Real Login Flow:** Authenticated as `alice@byos.local` via user login form; verified active mailbox context loaded.
2. **Step 1 Provider Selection:** Navigated to Settings → Mailbox Import. Captured screenshot: `tests/browser/artifacts/import_step1_providers.png`.
3. **Step 2 Popup Authorization:** Simulated popup launch and `#hash` fragment token exchange via `postMessage`.
4. **Step 3 Configuration:** Rendered folder mapping options and date range selector. Captured screenshot: `tests/browser/artifacts/import_step3_configure.png`.
5. **Step 4 Concurrency & Banner:** Triggered import. Verified D4 persistent warning banner: `"Import is in progress. Please keep this tab open until the import is complete."` and Cancel button. Captured screenshot: `tests/browser/artifacts/import_step4_progress.png`.
6. **Step 5 Summary Card:** Monitored worker queue completion. Asserted summary card displays `5 / 5` imported messages. Captured screenshot: `tests/browser/artifacts/import_step5_summary.png`.
7. **Step 6 Inbox Reading Pane Decryption:** Returned to Inbox. Asserted 4 imported messages rendered in list. Clicked message from `alex@external-partner.com`. Verified reading pane client-side decryption parsed subject and body. Captured screenshot: `tests/browser/artifacts/import_inbox_messages.png`.
8. **Step 7 Idempotency Re-run:** Re-executed import for same date range and provider. Asserted duplicate emails were skipped (`5 skipped`).
9. **Step 8 Encrypted Token Storage:** Queried customer storage proxy for `mailboxes/{mailboxId}/oauth/gmail.enc`. Asserted binary 0x01 version header and ciphertext payload without plaintext tokens.
10. **Step 9 Encrypted EML Storage:** Queried customer storage proxy for imported email object. Asserted binary 0x01 version header and ciphertext payload without plaintext RFC 822 body.
11. **Step 10 Database Audit:** Queried PostgreSQL `import_jobs` table to verify records reflect completed status and accurate counts.

Execution output from `tests/browser/test_import.mjs`:
```
================================================================================
       DIRECT GMAIL / OUTLOOK OAUTH IMPORT (V1) BROWSER VERIFICATION            
================================================================================

Mock OAuth & Gmail Provider server listening on http://127.0.0.1:9999
Resetting database and storage state for Alice import tests...
--- [STEP 1] Login as Alice via real login flow ---
✓ Login successful, inbox loaded.

--- [STEP 2] Open Settings → Mailbox Import ---
✓ Step 1 verified: Provider cards (Gmail & Outlook) visible. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\import_step1_providers.png

--- [STEP 3] Launch Mock OAuth Authorization Popup ---
Popup target captured, navigating to callback...
✓ OAuth callback processed via postMessage, advanced to Step 3 (Configure).
✓ Step 3 verified: Configure UI with date range & folder mapping. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\import_step3_configure.png

--- [STEP 4] Start Import and verify D4 Warning Banner ---
Warning banner text: Import is in progress. Please keep this tab open until the import is complete.Cancel
✓ Step 4 verified: D4 warning banner displayed during import. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\import_step4_progress.png

--- [STEP 5] Wait for Import Completion & Summary Card ---
✓ Step 5 verified: Summary card indicates Import Completed. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\import_step5_summary.png

--- [STEP 6] Return to Inbox and verify imported emails ---
Found 4 messages in Primary tab: [
  {
    "id": "e104552d-bb4e-49f4-8072-0f0fbbdb974c",
    "text": "Eevents@community-forum.netSecurity Key Summit InvitationJan 20, 01"
  },
  {
    "id": "b0b25cc4-1994-4ce2-9669-6e996d62db74",
    "text": "Ddr.smith@medical-clinic.orgAppointment Confirmation - Jan 22Jan 18, 01"
  },
  {
    "id": "bdd05b09-8b84-4034-afd0-703d18bbdd37",
    "text": "Nnotifications@github.comPull Request #412 merged into mainJan 16, 01"
  },
  {
    "id": "f2f1ba19-7c71-403f-89e5-a24500672fd6",
    "text": "Aalex@external-partner.comQuarterly Strategy Plan 2026Jan 15, 01"
  }
]
Found 1 message(s) in Notifications tab: [
  {
    "id": "9b1f6908-fbbb-4819-9ae8-91e1a0ed1d1c",
    "text": "Bbilling@cloudprovider.comInvoice INV-2026-003 AvailableJan 17, 01"
  }
]
✓ Asserted across tabs: Primary has 4, Notifications has 1, total = 5.
✓ Found imported email from 'alex@external-partner.com' in message list.
✓ Reading pane opened and decrypted imported email. Screenshot: F:\Codex\byos-email\tests\browser\artifacts\import_inbox_messages.png

--- [STEP 7] Re-run Import to verify Idempotency (D5) ---
✓ Re-run completed cleanly without errors.

--- [STEP 8] Assert OAuth Tokens Stored Encrypted in Customer Storage (D1) ---
OAuth token storage blob length: 170 bytes, Version byte: 0x1
✓ D1 VERIFIED: OAuth tokens stored encrypted with mailbox key in customer storage.

--- [STEP 9] Assert Imported Message Encrypted in Customer Storage (D2) ---
Imported message blob length: 286 bytes, Version byte: 0x1
✓ D2 VERIFIED: Raw EML encrypted client-side with mailbox key before storage.

--- [STEP 10] Verify Postgres import_jobs Table ---
                  id                  | provider |  status   | total_messages | imported_messages | skipped_messages 
--------------------------------------+----------+-----------+----------------+-------------------+------------------
 109c400d-8932-4c7b-b1df-2ca6567a56a5 | gmail    | completed |              5 |                 5 |                0
 e9d127ad-f4c1-433d-be42-064ef625d224 | gmail    | completed |              5 |                 0 |                5
(2 rows)



================================================================================
            ALL 10 BROWSER IMPORT CHECKS PASSED PERFECTLY                       
================================================================================

>>> RESULT: PASS (test_import.mjs) in 12.5s
```

## What did not work or is untested
- **UNTESTED:** Continuous / background recurring sync beyond the initial batch import (explicitly documented as out of scope for V1).
- **UNTESTED:** Contacts and calendar import (explicitly documented as out of scope for V1).
- **UNTESTED:** Live external OAuth client credentials with Google and Microsoft cloud consent screens in this automated environment (mock OAuth authorization server was used to simulate production token issuance and RFC 822 batch payloads without internet dependency).

## Test suite output

### Go test suite (`go test -v ./services/api/...`)
The Go test suite returned
```
=== RUN   TestImportCSV
--- PASS: TestImportCSV (0.11s)
=== RUN   TestImportVCard
--- PASS: TestImportVCard (0.07s)
=== RUN   TestImportBegin_Unauthorized
--- PASS: TestImportBegin_Unauthorized (0.00s)
=== RUN   TestImportBegin_Success
--- PASS: TestImportBegin_Success (0.08s)
=== RUN   TestImportOAuthCallback_TokenExchange
--- PASS: TestImportOAuthCallback_TokenExchange (0.07s)
=== RUN   TestImportMessage_Idempotent
--- PASS: TestImportMessage_Idempotent (0.11s)
=== RUN   TestImportJobLifecycle
--- PASS: TestImportJobLifecycle (0.12s)
=== RUN   TestImportAssignsThreadID
--- PASS: TestImportAssignsThreadID (0.13s)
PASS
ok  	byos.email/services/api	1.646s
```

### Frontend unit test suite (`npm test -- --run` in `apps/webmail`)
The webmail unit test suite returned
```
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

### Full smoke test suite (`powershell -ExecutionPolicy Bypass -File .\smoke.ps1`)
The automated smoke test suite returned
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (14.6s)
  [PASS] test_sidebar_restructure.mjs        PASS (13.7s)
  [PASS] test_unified_inbox_browser.mjs      PASS (25.6s)
  [PASS] test_account_switch_crypto.mjs      PASS (61.9s)
  [PASS] test_masked_email.mjs               PASS (43.3s)
  [PASS] test_alias_custom.mjs               PASS (41.3s)
  [PASS] test_compose_default_account.mjs    PASS (12.4s)
  [PASS] test_wire_integrity.mjs             PASS (72.5s)
  [PASS] test_focused_inbox.mjs              PASS (31s)
  [PASS] test_offline.mjs                    PASS (31.4s)
  [PASS] test_composer.mjs                   PASS (21.6s)
  [PASS] test_contacts.mjs                   PASS (14.5s)
  [PASS] test_import.mjs                     PASS (12.5s)
================================================================================

SMOKE SUITE PASSED: All 13 tests passed cleanly.
```
