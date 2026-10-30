# Staged Historical-Key Reactivation Protocol Report

## What was built
We upgraded the historical-key reactivation protocol in BYOS from immediate, irreversible envelope replacement to a staged, recoverable 4-phase lifecycle (`Prepare` -> `Read Back` -> `Client Verification` -> `Finalize`/`Rollback`). The implementation provisions a new `mailbox_key_reactivations` ledger with strict mailbox-first lock ordering, guaranteeing atomic candidate promotion, non-destructive rollbacks, and opportunistic TTL expiry cleanup. The client-side Webmail application verifies server-persisted candidates in browser memory via production WebAssembly (`byos_crypto_core`) and enforces exact 32-byte equality before requesting finalization, ensuring historical key material can never be destroyed by network faults, race conditions, or corrupted candidate envelopes.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/061_mailbox_key_reactivations.sql` | Schema migration defining `mailbox_key_reactivations` table and partial unique indexes |
| `services/api/recovery_flow.go` | Implemented staged handlers (`prepare`, `pending`, `finalize`, `rollback`), mailbox-first lock ordering, password-reset invalidation, and table auto-provisioning |
| `services/api/main.go` | Registered HTTP route endpoints for staged key reactivation protocol |
| `services/api/recovery_flow_test.go` | Added `TestStagedHistoricalKeyReactivationLifecycle` integration test suite covering all 12 concurrency, authorization, and lifecycle cases |
| `apps/webmail/src/api.ts` | Added API client functions and types for `prepare`, `fetchPending`, `finalize`, and `rollback` |
| `apps/webmail/src/historical_key_reactivation.ts` | Implemented `verifyReadBackCandidateEnvelope` and `executeStagedHistoricalKeyReactivation` workflow |
| `apps/webmail/src/historical_key_reactivation.test.ts` | Added unit tests 10 through 15 covering read-back verification, tampered candidate rollback, and error isolation |
| `apps/webmail/src/routes/settings/SecurityTab.tsx` | Updated `handleReactivateKeys` to execute the staged workflow and display state progression |
| `tests/browser/test_historical_key_preflight_browser.mjs` | Updated browser test suite assertions for staged `prepare`, `read-back`, and `finalize` network exchanges |
| `tools/staged_key_reactivation_verify.sql` | Created verification SQL script for inspecting staged tables and mailboxes in disposable databases |
| `scratch/disposable_api.exe` | Recompiled disposable API test binary to support staged protocol in end-to-end browser tests |

## Database State Transitions

The staged historical-key reactivation ledger `mailbox_key_reactivations` enforces deterministic state transitions:

```mermaid
stateDiagram-v2
    [*] --> pending: POST /prepare (Candidate Envelope Staged)
    pending --> pending: Idempotent Retry (Exact Same Envelope)
    pending --> rolled_back: POST /rollback (Client Verification Mismatch / User Abort)
    pending --> rolled_back: Opportunistic TTL Expiry (now() > expires_at)
    pending --> rolled_back: Password Reset / Superseded by New Preparation
    pending --> finalized: POST /finalize (WASM Verification Succeeded)
    finalized --> [*]: candidate promoted to wrapped_sk_user; previous_wrapped_sk_user cleared
    rolled_back --> [*]: original active & historical envelopes preserved untouched
```

- **Pending:** Created during `POST /prepare` with a 10-minute expiry (`expires_at = NOW() + INTERVAL '10 minutes'`). During this state, `mailboxes.wrapped_sk_user` and `mailboxes.previous_wrapped_sk_user` remain intact and untouched. A partial unique index `uq_mailbox_pending_key_reactivation` guarantees at most one pending operation per mailbox.
- **Finalized:** Transitioned atomically via `POST /finalize`. The candidate envelope is promoted to `wrapped_sk_user`, `previous_wrapped_sk_user` is cleared, and `finalized_at` is stamped. Subsequent finalize calls are idempotent.
- **Rolled Back:** Transitioned via `POST /rollback` (or opportunistically on TTL expiration or password reset). The candidate envelope is invalidated without touching `mailboxes` active or historical envelopes. Subsequent rollbacks are idempotent.

## API Endpoints

1. **`POST /v1/mailboxes/{mailbox_id}/reactivate-keys/prepare`**
   - **Auth:** Mailbox owner session cookie.
   - **Body:** `{"wrapped_sk_user": string, "mailbox_pk"?: string}`
   - **Action:** Validates structure, locks mailbox first, stages candidate in `mailbox_key_reactivations` with 10-minute expiry.
   - **Response:** `201 Created` with `{"migration_id": string, "mailbox_id": string, "status": "pending", "expires_at": string}`.
2. **`GET /v1/mailboxes/{mailbox_id}/reactivate-keys/pending`** or **`GET /v1/mailboxes/{mailbox_id}/reactivate-keys/{migration_id}`**
   - **Auth:** Mailbox owner session cookie.
   - **Action:** Returns exact server-stored candidate envelope for client verification. Exposes zero data to non-owners.
   - **Response:** `200 OK` with candidate envelope, or `410 Gone` if expired.
3. **`POST /v1/mailboxes/{mailbox_id}/reactivate-keys/finalize`**
   - **Auth:** Mailbox owner session cookie.
   - **Body:** `{"migration_id": string}`
   - **Action:** Atomic transaction: locks mailbox first, locks pending record second, verifies unexpired `pending` status, promotes candidate to `wrapped_sk_user`, sets `previous_wrapped_sk_user = NULL`, marks record `finalized`.
   - **Response:** `200 OK` with `{"success": true, "status": "finalized"}`.
4. **`POST /v1/mailboxes/{mailbox_id}/reactivate-keys/rollback`**
   - **Auth:** Mailbox owner session cookie.
   - **Body:** `{"migration_id": string, "reason": string}`
   - **Action:** Atomically marks pending record `rolled_back` with reason. Leaves `mailboxes` active and historical envelopes untouched.
   - **Response:** `200 OK` (idempotent).
5. **`POST /v1/mailboxes/{mailbox_id}/reactivate-keys`** (Compatibility Handler)
   - Supports legacy callers by routing `migration_id` requests to finalize and direct candidate payloads through atomic staged recording.

## Authorization & Lock Ordering

- **Ownership Invariant:** Only the authenticated mailbox owner (`mailboxes.user_id == authenticated_user_id`) has cryptographic authority. Organization owners, administrators, or other tenants receive `HTTP 403 Forbidden` on all staged endpoints.
- **Deactivated Mailbox Invariant:** If `mailboxes.is_active` is `false`, preparation and finalization fail with `HTTP 403 Forbidden`.
- **Lock Ordering:** Every transactional operation strictly locks the parent `mailboxes` row first (`SELECT ... FROM mailboxes WHERE id = $1 FOR UPDATE`) before locking or querying child `mailbox_key_reactivations` rows. This consistent hierarchy completely eliminates the possibility of deadlocks across concurrent requests.

## Cryptographic Client Verification & Trust Boundary

### Honest Zero-Knowledge Trust Boundary
The server **never** possesses or inspects the user's plaintext password, recovery phrase, or unencrypted private keys. Consequently:
- The server **cannot** independently verify whether a candidate envelope was wrapped with the correct password or decrypts to the correct private key.
- The server acts solely as a zero-knowledge state ledger: enforcing mailbox ownership, structural envelope validity (JSON format, salt/envelope presence), atomic state transitions, and concurrency safety.
- Cryptographic round-trip correctness is exclusively proven by the client browser executing production WASM (`byos_crypto_core`).

### Client Verification Workflow
```mermaid
sequenceDiagram
    autonumber
    actor User as Mailbox Owner
    participant Webmail as Browser (WASM)
    participant Server as BYOS API
    participant DB as Postgres DB

    User->>Webmail: Enters recovery phrase & new password
    Webmail->>Webmail: 1. Validate password policy & confirmation match
    Webmail->>Webmail: 2. Local preflight: unseal historical secret, derive candidate envelope
    Webmail->>Server: 3. POST /reactivate-keys/prepare (candidate envelope)
    Server->>DB: Lock mailbox, stage candidate in mailbox_key_reactivations
    Server-->>Webmail: Return migration_id (expires in 10 min)
    Webmail->>Server: 4. GET /reactivate-keys/{migration_id} (Read-back)
    Server-->>Webmail: Return candidate_wrapped_sk from DB
    Webmail->>Webmail: 5. Unwrap read-back candidate with new password using WASM
    Webmail->>Webmail: 6. constantTimeEqual(candidateSecret, originalHistoricalSecret) === 32 bytes
    alt Client Verification Succeeded
        Webmail->>Server: 7a. POST /reactivate-keys/finalize (migration_id)
        Server->>DB: Atomically promote candidate & clear historical envelope
        Server-->>Webmail: 200 OK (finalized)
        Webmail->>Webmail: Store unsealed key in sessionStorage only
        Webmail-->>User: Success notification & unlock old messages
    else Client Verification Failed (Tampered / Mismatched)
        Webmail->>Server: 7b. POST /reactivate-keys/rollback (migration_id, reason)
        Server->>DB: Invalidate pending candidate (preserves historical key)
        Server-->>Webmail: 200 OK (rolled_back)
        Webmail-->>User: Fail closed with security error (never finalizes)
    end
```

## Concurrency, Retries, and Expiry Semantics

| Scenario | Behavior | Idempotency |
|----------|----------|-------------|
| **Two simultaneous preparations** | Mailbox locked first; second request either adopts identical candidate or supersedes previous pending record safely. | Safe / Serialized |
| **Lost response on preparation** | Resubmitting identical candidate returns existing unexpired `migration_id` and `pending` status. | Idempotent (`200 OK`) |
| **Lost response on finalization** | Resubmitting `/finalize` for an already finalized migration returns success without re-modifying keys. | Idempotent (`200 OK`) |
| **Rollback racing with finalization** | Mailbox-first lock serializes requests. If finalize commits first, rollback returns `409 Conflict`. If rollback commits first, finalize returns `409 Conflict`. | Safe / Non-destructive |
| **Expired pending operation** | Finalization of expired candidate fails with `409 Conflict`, marks record `rolled_back`, and leaves active/historical envelopes untouched. | Safe / Preserved |
| **Password reset during pending** | User password reset marks all pending records `rolled_back` with `password_reset_during_pending`. | Invalidation |
| **Mailbox deactivation during pending** | Finalization verifies `is_active = true` under lock; deactivated mailbox returns `403 Forbidden`. | Enforced |

## Test File Changes Diff

In accordance with Section `Test file changes` of `AGENTS.md`, `tests/browser/test_historical_key_preflight_browser.mjs` was updated to assert the staged protocol lifecycle requests (prepare -> read-back -> finalize) rather than an unstaged immediate single request:

```diff
--- a/tests/browser/test_historical_key_preflight_browser.mjs
+++ b/tests/browser/test_historical_key_preflight_browser.mjs
@@ -300,5 +300,9 @@
-    // Verify exactly 1 reactivate API call was made
-    assert(reactivateApiCalls.length === 2, `Expected 1 request-response pair (2 events), got ${reactivateApiCalls.length}`);
-    const apiRes = reactivateApiCalls.find(e => e.type === 'response');
-    assert(apiRes && apiRes.status === 200, "Reactivate API returned HTTP 200 OK");
+    // Verify staged reactivate API calls: prepare, read-back (pending), and finalize
+    const prepareCall = reactivateApiCalls.find(e => e.type === 'response' && e.url.includes('/prepare'));
+    assert(prepareCall && (prepareCall.status === 201 || prepareCall.status === 200), "Stage 1: Prepare API returned HTTP 201 Created");
+
+    const readBackCall = reactivateApiCalls.find(e => e.type === 'response' && (e.url.includes('/pending') || Boolean(e.url.match(/reactivate-keys\/[a-f0-9-]+$/))));
+    assert(readBackCall && readBackCall.status === 200, "Stage 2: Read-back API returned HTTP 200 OK");
+
+    const finalizeCall = reactivateApiCalls.find(e => e.type === 'response' && e.url.includes('/finalize'));
+    assert(finalizeCall && finalizeCall.status === 200, "Stage 3: Finalize API returned HTTP 200 OK");
```

## Raw Evidence

### 1. Database Table Verification
Command:
```powershell
Get-Content tools\staged_key_reactivation_verify.sql | docker exec -i byos-postgres psql -U byos -d byos_recovery_disposable_20261024
```
Output:
```text
=== Mailbox Key Reactivations Table Schema ===
                               Table "public.mailbox_key_reactivations"
        Column        |           Type           | Collation | Nullable |           Default            
----------------------+--------------------------+-----------+----------+------------------------------
 id                   | uuid                     |           | not null | gen_random_uuid()
 mailbox_id           | uuid                     |           | not null | 
 user_id              | uuid                     |           | not null | 
 candidate_wrapped_sk | text                     |           | not null | 
 candidate_mailbox_pk | bytea                    |           |          | 
 status               | text                     |           | not null | 
 created_at           | timestamp with time zone |           | not null | now()
 expires_at           | timestamp with time zone |           | not null | now() + '00:10:00'::interval
 finalized_at         | timestamp with time zone |           |          | 
 rolled_back_at       | timestamp with time zone |           |          | 
 rollback_reason      | text                     |           |          | 
Indexes:
    "mailbox_key_reactivations_pkey" PRIMARY KEY, btree (id)
    "idx_mailbox_key_reactivations_expiry" btree (status, expires_at) WHERE status = 'pending'::text
    "idx_mailbox_key_reactivations_lookup" btree (mailbox_id, user_id, status)
    "uq_mailbox_pending_key_reactivation" UNIQUE, btree (mailbox_id) WHERE status = 'pending'::text
Check constraints:
    "mailbox_key_reactivations_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'finalized'::text, 'rolled_back'::text]))
Foreign-key constraints:
    "mailbox_key_reactivations_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    "mailbox_key_reactivations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE

=== Active vs Historical Key Envelopes in Mailboxes ===
                  id                  | local_part | is_active | has_active_sk | has_historical_sk | previous_key_archived_at 
--------------------------------------+------------+-----------+---------------+-------------------+--------------------------
 c0000000-0000-0000-0000-000000000001 | alice      | t         | t             | f                 | 
(1 row)

=== Pending & Finalized Staged Key Reactivations ===
                  id                  |              mailbox_id              |               user_id                |  status   |          created_at           |          expires_at           |         finalized_at          | rolled_back_at | rollback_reason 
--------------------------------------+--------------------------------------+--------------------------------------+-----------+-------------------------------+-------------------------------+-------------------------------+----------------+-----------------
 3f8bb8eb-9cdd-4813-947b-bbf547987221 | c0000000-0000-0000-0000-000000000001 | cccccccc-0000-0000-0000-000000000002 | finalized | 2026-10-25 04:33:04.321885+00 | 2026-10-25 04:43:04.321885+00 | 2026-10-25 04:33:04.567519+00 |                | 
(1 row)
```

### 2. Go API Staged Protocol Test Suite Output
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable"; cd services\api; go test -v -run "TestStagedHistoricalKeyReactivationLifecycle|TestMailboxReactivateKeys" .
```
Output:
```text
=== RUN   TestMailboxReactivateKeysAuthorization
    recovery_flow_test.go:224: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAuthorization (0.28s)
=== RUN   TestMailboxReactivateKeysAtomicPreservationAndIdempotency
    recovery_flow_test.go:1566: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAtomicPreservationAndIdempotency (0.28s)
=== RUN   TestStagedHistoricalKeyReactivationLifecycle
    recovery_flow_test.go:1680: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestStagedHistoricalKeyReactivationLifecycle (0.68s)
PASS
ok  	byos.email/services/api	2.782s
```

### 3. Webmail Unit & Crypto Verification Test Suite Output
Command:
```powershell
cmd.exe /c "cd apps\webmail && npx.cmd tsx --experimental-wasm-modules src/run_test.node.js"
```
Output:
```text
(node:10888) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI ACCOUNT TESTS: 46 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 1 passed, 0 failed

Running Path A Compose Tests...
PATH A COMPOSE TESTS: 11 passed, 0 failed

Running Path A Read Tests...
PATH A READ TESTS: 10 passed, 0 failed

Running MIME Parser Tests...
MIME PARSER TESTS: 10 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 11 passed, 0 failed

Running Reply Signature Tests...
REPLY SIGNATURE TESTS: 8 passed, 0 failed

Running MBOX Stream Parser Tests...
MBOX STREAM TESTS: 14 passed, 0 failed

Running MBOX Labels Tests...
MBOX LABELS TESTS: 10 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 10 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 10 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 10 passed, 0 failed

Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 12 passed, 0 failed

Running Snooze Tests...
SNOOZE TESTS: 11 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 10 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 13 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 13 passed, 0 failed

Running API Error Tests...
API ERROR TESTS: 10 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 13 passed, 0 failed

Running Masked Email Tests...
MASKED EMAIL TESTS: 14 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 12 passed, 0 failed

Running Offline Storage Tests...
OFFLINE STORAGE TESTS: 11 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 9 passed, 0 failed

Running Contacts Tests...
CONTACTS TESTS: 9 passed, 0 failed

Running Sidebar Borderless Tests...
SIDEBAR BORDERLESS TESTS: 9 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 11 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 13 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 8 passed, 0 failed

Running Calendar RRule Tests...
CALENDAR RRULE TESTS: 8 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 6 passed, 0 failed

Running Calendar ICS Tests...
CALENDAR ICS TESTS: 28 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
CALENDAR REPO INTEGRATION TESTS: 8 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

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
  ✓ 14. Read-back candidate difference triggers rollback and aborts before finalization
  ✓ 15. Preflight failure prevents prepare, read-back, finalize, or rollback from running
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

OVERALL: 371 passed, 0 failed
```

## Manual Browser Verification

The automated end-to-end browser test was executed using real Chrome Headless against the disposable database `byos_recovery_disposable_20261024` and disposable API server on port 8092:

Command:
```powershell
node --experimental-wasm-modules tests/browser/test_historical_key_preflight_browser.mjs
```
Output:
```text
(node:6556) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
================================================================================
    BYOS SECURE HISTORICAL-KEY REACTIVATION BROWSER PREFLIGHT TEST               
================================================================================

  Configuring test fixture in disposable database: byos_recovery_disposable_20261024
  PASS: Disposable fixture previous_wrapped_sk_user successfully populated

  Starting disposable API on port 8092...
  Starting disposable Webmail on port 3008...
  Disposable API healthy on http://127.0.0.1:8092
  Disposable Webmail healthy on http://127.0.0.1:3008

--- [STEP 1] Login to Webmail as Alice ---
  Successfully logged into Webmail as Alice.

--- [STEP 2] Open Historical Key Reactivation Modal ---
  PASS: Clicked Reactivate Keys in notification banner
  PASS: Clicked Reactivate Old Keys button in Security tab
  Reactivate Historical Messages modal inputs verified.

--- [STEP 3] Test Negative Case 1: Password Confirmation Mismatch ---
  PASS: Expected mismatch error message, got: New password and confirmation do not match.
  PASS: ZERO API requests dispatched on confirmation mismatch
  Saved screenshot: historical_preflight_1_mismatch.png

--- [STEP 4] Test Negative Case 2: Password Policy Failure ---
  PASS: Expected policy error message, got: New password must be at least 8 characters long.
  PASS: ZERO API requests dispatched on password policy failure
  Saved screenshot: historical_preflight_2_policy_failure.png

--- [STEP 5] Test Negative Case 3: Incorrect Historical Secret ---
  PASS: Expected unwrap failure error, got: Unable to decrypt historical key with provided credentials.
  PASS: ZERO API requests dispatched on incorrect historical secret
  Saved screenshot: historical_preflight_3_wrong_secret.png

--- [STEP 6] Test Positive Case: Valid Credentials and Matching Confirmation ---
  [REACTIVATE API REQ] POST http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/prepare
  [REACTIVATE API REQ] GET http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/3f8bb8eb-9cdd-4813-947b-bbf547987221
  [REACTIVATE API RES] 201 http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/prepare -> {"expires_at":"2026-10-25T10:43:04+06:00","mailbox_id":"c0000000-0000-0000-0000-000000000001","migration_id":"3f8bb8eb-9cdd-4813-947b-bbf547987221","status":"pending"}

  [REACTIVATE API REQ] POST http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/finalize
  [REACTIVATE API RES] 200 http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/3f8bb8eb-9cdd-4813-947b-bbf547987221 -> {"candidate_mailbox_pk":"","candidate_wrapped_sk":"{\"salt\":\"b928a9b01040af1c5bbbd73f6e859c77\",\"envelope\":\"0124d4a4edf142cef101e4b44ef12fa7d5ed710b7042676b60ec2f2f17332281b586fd298845b134c971698c3de33cefc648347902c3a44295d7262d7c\",\"root_wrapped\":\"dummy_root_wrapped_test_marker\"}","expires_at":"2026-10-25T10:43:04+06:00","mailbox_id":"c0000000-0000-0000-0000-000000000001","migration_id":"3f8bb8eb-9cdd-4813-947b-bbf547987221","status":"pending"}

  [REACTIVATE API RES] 200 http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/finalize -> {"mailbox_id":"c0000000-0000-0000-0000-000000000001","message":"Historical key material successfully reactivated","migration_id":"3f8bb8eb-9cdd-4813-947b-bbf547987221","status":"finalized","success":true}

  Step 6 modal state after submit click: {}
  Step 6 API calls captured so far: 6
  Reactivation modal closed successfully after preflight and API dispatch.
  PASS: Stage 1: Prepare API returned HTTP 201 Created
  PASS: Stage 2: Read-back API returned HTTP 200 OK
  PASS: Stage 3: Finalize API returned HTTP 200 OK
  PASS: sessionStorage holds 64-char hex mailbox secret: 54f8acba...
  PASS: localStorage contains zero secret keys
  Saved screenshot: historical_preflight_4_reactivate_success.png

--- [STEP 7] Test Logout Cleanup ---
  PASS: sessionStorage mailbox key purged upon logout
  Saved screenshot: historical_preflight_5_logout_cleanup.png
  PASS: Zero passwords or private keys logged to browser console

================================================================================
    ALL BROWSER PREFLIGHT VERIFICATION CHECKS SUCCEEDED!                        
================================================================================
```

Screenshots saved to `tests/browser/artifacts/`:
- `tests/browser/artifacts/historical_preflight_1_mismatch.png`
- `tests/browser/artifacts/historical_preflight_2_policy_failure.png`
- `tests/browser/artifacts/historical_preflight_3_wrong_secret.png`
- `tests/browser/artifacts/historical_preflight_4_reactivate_success.png`
- `tests/browser/artifacts/historical_preflight_5_logout_cleanup.png`

## Final Safety Verification

Confirmations:
1. **Active Database "byos" Untouched:**
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos -c "\dt mailbox_key_reactivations"
```
Output:
```text
Did not find any relation named "mailbox_key_reactivations".
```
2. **Active Historical Envelope Preserved in "byos":**
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos -c "SELECT id, user_id, local_part, previous_wrapped_sk_user IS NOT NULL as has_prev FROM mailboxes WHERE id = 'c0000000-0000-0000-0000-000000000001';"
```
Output:
```text
                  id                  |               user_id                | local_part | has_prev 
--------------------------------------+--------------------------------------+------------+----------
 c0000000-0000-0000-0000-000000000001 | cccccccc-0000-0000-0000-000000000002 | alice      | t
(1 row)
```
3. **Active Legacy Calendar Records Untouched in "byos":**
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos -c "SELECT id, mailbox_id, status, created_at FROM calendar_events;"
```
Output:
```text
                  id                  |              mailbox_id              | status |          created_at           
--------------------------------------+--------------------------------------+--------+-------------------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | c0000000-0000-0000-0000-000000000001 | busy   | 2026-10-20 08:23:53.880289+00
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | c0000000-0000-0000-0000-000000000001 | busy   | 2026-10-20 09:18:50.034662+00
 a4196298-d4e1-4921-8b26-0a2d470636f3 | c0000000-0000-0000-0000-000000000001 | busy   | 2026-10-20 09:21:30.891065+00
(3 rows)
```
4. **Disposable Fixture Isolation:** All tests and browser verifications ran strictly against `byos_recovery_disposable_20261024`.
5. **No Live Reactivation Performed:** Active database key material was never modified or activated.
6. **No Calendar Migration Executed:** Legacy calendar event records remain in their untouched state.

## What Did Not Work or Is Untested

- **Production HSM / Hardware Enclave Signing:** The platform uses client-side WASM and PostgreSQL; dedicated hardware cryptographic enclaves (e.g. AWS CloudHSM or Nitro Enclaves) are not implemented for key reactivation.
- **Offline Background Sweeper:** Opportunistic TTL expiration is performed during API queries and finalization. A standalone continuous cron janitor process for `mailbox_key_reactivations` was not added in this task to avoid persistent process daemon churn.
