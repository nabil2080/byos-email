# Historical Key Reactivation Security Findings F-01 and F-03 Remediation Report

## 1. What was built
Remediated Findings F-01 and F-03 from the staged historical-key reactivation independent security audit:
- **F-01 Remediation:** Implemented transactional, atomic invalidation of pending historical-key reactivations across all password modification paths (`services/api/recovery.go:changePasswordHandler`, `services/api/recovery_flow.go:recoveryFlowResetPasswordHandler`, `services/api/recovery_flow.go:exceptionalRecoveryResetHandler`, and `services/api/invitations.go:claimInvitationHandler`). All invalidation operations enforce canonical two-tier lock ordering (mailbox parent row locked first `FOR UPDATE`, pending reactivation child row locked and updated second) within the same ACID database transaction, ensuring no stale candidate envelope can be promoted after a password mutation.
- **F-03 Remediation:** Eliminated runtime dynamic DDL execution (`ensureKeyReactivationsTable`) from all HTTP request handlers (`prepare`, `pending`, `finalize`, `rollback`, and fallback). Schema management is now governed exclusively by `infra/postgres/init/061_mailbox_key_reactivations.sql`. Missing schema produces explicit operational errors rather than being swallowed, and handlers execute seamlessly under database roles possessing standard application DML privileges and zero DDL permissions.
- **Adversarial Test Suite:** Added comprehensive concurrency and boundary tests in `services/api/recovery_flow_test.go:TestPasswordModificationInvalidatesPendingReactivations` verifying normal password change invalidation, exceptional recovery reset invalidation, recovery flow reset invalidation, failed password change preservation, cross-user isolation, and finalization racing with password change under canonical lock order.

---

## 2. Files edited

| File | Reason |
|:---|:---|
| `services/api/recovery.go` | Added canonical lock ordering and pending reactivation child invalidation in `changePasswordHandler`. |
| `services/api/recovery_flow.go` | Added canonical lock ordering and error-checked invalidation in `recoveryFlowResetPasswordHandler` and `exceptionalRecoveryResetHandler`; eliminated `ensureKeyReactivationsTable` and all 5 request handler DDL call sites (F-03). |
| `services/api/invitations.go` | Added pending reactivation child invalidation on invitation claim in `claimInvitationHandler`. |
| `services/api/recovery_flow_test.go` | Added `TestPasswordModificationInvalidatesPendingReactivations` covering 6 adversarial scenarios and imported `sync`. |
| `docs/historical_key_reactivation_f01_f03_remediation_report.md` | Authoritative security remediation and verification report deliverable. |

---

## 3. Complete Password-Mutation Inventory

The following represents the complete inventory of all API endpoints and code paths across the BYOS service that can modify user credentials, reset passwords, or replace/invalidate password-derived mailbox key envelopes:

| ID | Endpoint | Handler | File & Lines | Operation Type | Invalidation Mechanism |
|:---|:---|:---|:---|:---|:---|
| **P-1** | `POST /v1/auth/change-password` | `changePasswordHandler` | `services/api/recovery.go:477-525` | Authenticated In-Session Password Change & Key Re-wrap | Canonical lock on user's active mailboxes `FOR UPDATE`, updates `users.password_hash`, re-wraps `mailboxes.wrapped_sk_user`, and rolls back pending reactivations with `password_changed_during_pending`. |
| **P-2** | `POST /v1/auth/recovery/reset-password` | `recoveryFlowResetPasswordHandler` | `services/api/recovery_flow.go:335-460` | OTP / TOTP / Passkey Two-Tier Recovery Password Reset | Canonical lock on user's active mailboxes `FOR UPDATE`, updates `users.password_hash`, archives previous key to `previous_wrapped_sk_user`, and rolls back pending reactivations with `password_reset_during_pending`. |
| **P-3** | `POST /v1/auth/recovery/reset-with-approval` | `exceptionalRecoveryResetHandler` | `services/api/recovery_flow.go:1970-2025` | Organization Owner Approved Exceptional Password Reset | Canonical lock on user's active mailboxes `FOR UPDATE`, updates `users.password_hash`, preserves zero-knowledge mailbox keys untouched, and rolls back pending reactivations with `exceptional_recovery_reset_during_pending`. |
| **P-4** | `POST /v1/auth/invitations/claim` | `claimInvitationHandler` | `services/api/invitations.go:520-575` | First-Time Employee Invitation Onboarding & Credential Setup | Activates user, sets `password_hash`, activates mailbox with initial `wrapped_sk_user`, and invalidates any stale pending reactivations with `invitation_claimed_during_pending`. |
| **P-5** | `POST /v1/mailboxes/{id}/reactivate-keys/finalize` | `mailboxReactivateKeysFinalizeHandler` | `services/api/recovery_flow.go:960-1120` | Staged Historical Key Envelope Promotion | Canonical lock on mailbox `FOR UPDATE`, verifies pending unexpired candidate, promotes candidate to `wrapped_sk_user`, clears `previous_wrapped_sk_user`, and marks record `finalized`. |

---

## 4. Root Cause and Exact Fix for F-01

### Root Cause
During the initial implementation of the staged protocol, invalidation was added to `recoveryFlowResetPasswordHandler` (where the error was also swallowed via `_, _ = tx.Exec(...)`). However, invalidation was omitted from `changePasswordHandler` and `exceptionalRecoveryResetHandler`. Consequently, if a user changed their password or completed exceptional recovery while a pending candidate envelope $C_1$ (wrapped under the old password) was in flight, a client could subsequently call `finalize` and promote $C_1$ to `wrapped_sk_user`. This created a critical desynchronization where the mailbox was encrypted under old password $P_1$ while authentication expected new password $P_2$.

### Exact Fix
In each password modification path, the database transaction enforces:
1. **Canonical Lock Order (Parent First):**
   ```go
   mRows, err := tx.Query(ctx, `
       SELECT id::text
       FROM mailboxes
       WHERE user_id = $1 AND is_active = true
       FOR UPDATE
   `, userID)
   if err != nil {
       http.Error(w, "failed to lock mailboxes", http.StatusInternalServerError)
       return
   }
   var userMailboxIDs []string
   for mRows.Next() {
       var mID string
       if err := mRows.Scan(&mID); err == nil {
           userMailboxIDs = append(userMailboxIDs, mID)
       }
   }
   mRows.Close()
   ```
2. **Atomic Child Invalidation (Child Second):**
   ```go
   if len(userMailboxIDs) > 0 {
       _, err = tx.Exec(ctx, `
           UPDATE mailbox_key_reactivations
           SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = $2
           WHERE user_id = $1 AND mailbox_id = ANY($3::uuid[]) AND status = 'pending'
       `, userID, reason, userMailboxIDs)
   } else {
       _, err = tx.Exec(ctx, `
           UPDATE mailbox_key_reactivations
           SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = $2
           WHERE user_id = $1 AND status = 'pending'
       `, userID, reason)
   }
   if err != nil {
       http.Error(w, "failed to invalidate pending key reactivations", http.StatusInternalServerError)
       return
   }
   ```
3. **Fail-Closed Atomicity:**
   If the invalidation query encounters any error, `http.Error` is returned and `defer tx.Rollback(ctx)` rolls back the entire transaction, aborting the password modification rather than leaving an inconsistent pending reactivation valid.

---

## 5. Transaction and Lock-Order Explanation

To prevent circular wait deadlocks between concurrent password modification and key finalization, all transactions strictly adhere to the **parent-first, child-second** hierarchy:

```
  Lock Level 1 (Parent): mailboxes row(s) [FOR UPDATE]
             │
             ▼
  Lock Level 2 (Child):  mailbox_key_reactivations row(s) [FOR UPDATE / UPDATE]
```

### Concurrency Resolution:
- **Scenario A: Finalize acquires Lock Level 1 first:**
  `finalize` acquires the mailbox row lock. `changePassword` blocks waiting on the mailbox lock. `finalize` verifies `status == 'pending'`, checks unexpired TTL, promotes candidate to `wrapped_sk_user`, clears `previous_wrapped_sk_user`, sets `status = 'finalized'`, and commits. `changePassword` then acquires the mailbox lock, updates `users.password_hash`, re-wraps `mailboxes.wrapped_sk_user` to the new password, and rolls back pending reactivations (of which none are pending). Both succeed in safe chronological order.
- **Scenario B: Password Change acquires Lock Level 1 first:**
  `changePassword` acquires the mailbox row lock. `finalize` blocks waiting on the mailbox lock. `changePassword` updates `users.password_hash`, re-wraps `wrapped_sk_user`, and updates `mailbox_key_reactivations SET status = 'rolled_back', rollback_reason = 'password_changed_during_pending'`. `changePassword` commits. `finalize` unblocks, locks the mailbox, queries the child record `FOR UPDATE`, observes `status == 'rolled_back'`, and aborts immediately with `409 Conflict: cannot finalize a rolled back reactivation`.
- **Deadlock Immunity:**
  Because both operations acquire the mailbox parent row lock first before touching the child table, lock inversion deadlocks are impossible.

---

## 6. Exact F-03 Changes

1. **Elimination of `ensureKeyReactivationsTable`:**
   Removed `ensureKeyReactivationsTable` and all 5 call sites from `services/api/recovery_flow.go`:
   - Line 667 in `mailboxReactivateKeysPrepareHandler`
   - Line 825 in `mailboxReactivateKeysPendingHandler`
   - Line 966 in `mailboxReactivateKeysFinalizeHandler`
   - Line 1189 in `mailboxReactivateKeysRollbackHandler`
   - Line 1365 in `mailboxReactivateKeysHandler`
2. **Operational Error Visibility:**
   If `mailbox_key_reactivations` does not exist (e.g. migration 061 missing), handlers log explicit error messages (`log.Printf("[reactivate-keys:prepare] query existing reactivation failed: %v", err)`) and return HTTP 500 cleanly instead of swallowing errors.
3. **No Automatic Startup Migrations:**
   No automatic DDL or schema creation was added to API startup.
4. **Least-Privilege DML Verification:**
   Verified that handlers and tests execute successfully against a PostgreSQL role (`byos_dml_test_role`) that has `USAGE`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` permissions but explicitly lacks `CREATE` permissions on schema `public` (`has_create_privilege = false`).

---

## 7. Raw Evidence

### Go Build
Command:
```cmd
cmd.exe /c "cd services\api && go build"
```
Output:
```
(Exited with code 0, clean build, zero errors)
```

### Focused Staged Reactivation & Concurrency Tests
Command:
```powershell
$env:TEST_DATABASE_URL='postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable'; go test -v -run 'TestPasswordModificationInvalidatesPendingReactivations|TestStagedHistoricalKeyReactivationLifecycle|TestMailboxReactivateKeysAuthorization|TestMailboxReactivateKeysAtomicPreservationAndIdempotency' ./services/api
```
Output:
```
=== RUN   TestMailboxReactivateKeysAuthorization
    recovery_flow_test.go:225: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAuthorization (0.27s)
=== RUN   TestMailboxReactivateKeysAtomicPreservationAndIdempotency
    recovery_flow_test.go:1567: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAtomicPreservationAndIdempotency (0.27s)
=== RUN   TestStagedHistoricalKeyReactivationLifecycle
    recovery_flow_test.go:1681: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestStagedHistoricalKeyReactivationLifecycle (0.64s)
=== RUN   TestPasswordModificationInvalidatesPendingReactivations
    recovery_flow_test.go:2004: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestPasswordModificationInvalidatesPendingReactivations (1.30s)
PASS
ok  	byos.email/services/api	4.000s
```

### Relevant Authentication, Recovery, and Mailbox Tests
Command:
```powershell
$env:TEST_DATABASE_URL='postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable'; go test -v -run 'TestChangePassword|TestClaimInvitation|TestRecoveryVerifyFlow|TestExceptionalRecoveryLifecycle' ./services/api
```
Output:
```
=== RUN   TestClaimInvitation
    invitations_test.go:164: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestClaimInvitation (0.34s)
=== RUN   TestClaimInvitationWithXWingPK
    invitations_test.go:341: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestClaimInvitationWithXWingPK (0.35s)
=== RUN   TestRecoveryVerifyFlow
    recovery_flow_test.go:64: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestRecoveryVerifyFlow (0.35s)
=== RUN   TestExceptionalRecoveryLifecycle
    recovery_flow_test.go:436: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestExceptionalRecoveryLifecycle (0.50s)
=== RUN   TestChangePasswordWithWrappedSkUser
    recovery_test.go:14: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestChangePasswordWithWrappedSkUser (0.41s)
=== RUN   TestChangePasswordRejectsMissingWrappedSkForMailboxOwner
    recovery_test.go:70: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestChangePasswordRejectsMissingWrappedSkForMailboxOwner (0.27s)
=== RUN   TestChangePasswordCurrentPasswordVerification
    recovery_test.go:126: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestChangePasswordCurrentPasswordVerification (0.54s)
=== RUN   TestChangePasswordAllowsPureAdminWithoutMailbox
    recovery_test.go:211: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestChangePasswordAllowsPureAdminWithoutMailbox (0.41s)
=== RUN   TestChangePasswordInvalidWrappedSkUser
    recovery_test.go:251: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestChangePasswordInvalidWrappedSkUser (0.16s)
=== RUN   TestChangePasswordMFAEnforcement
    recovery_test.go:283: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestChangePasswordMFAEnforcement (0.58s)
=== RUN   TestChangePasswordMultiMailboxIsolation
    recovery_test.go:357: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestChangePasswordMultiMailboxIsolation (0.55s)
PASS
ok  	byos.email/services/api	5.987s
```

### Full Go API Test Suite Execution
Command:
```powershell
$env:TEST_DATABASE_URL='postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable'; go test ./services/api
```
Output:
```
ok  	byos.email/services/api	64.293s
```

### Non-DDL Database Role Verification Output
Command:
```powershell
$env:TEST_DATABASE_URL='postgres://byos_dml_test_role:dml_pass_test_123@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable'; go test -v -run 'TestStagedHistoricalKeyReactivationLifecycle|TestPasswordModificationInvalidatesPendingReactivations' ./services/api
```
Output:
```
=== RUN   TestStagedHistoricalKeyReactivationLifecycle
    recovery_flow_test.go:1681: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestStagedHistoricalKeyReactivationLifecycle (0.65s)
=== RUN   TestPasswordModificationInvalidatesPendingReactivations
    recovery_flow_test.go:2004: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestPasswordModificationInvalidatesPendingReactivations (1.33s)
PASS
ok  	byos.email/services/api	3.524s
```

### Webmail TS/WASM Unit Test Suite
Command:
```cmd
cmd.exe /c "cd apps\webmail && npx.cmd tsx --experimental-wasm-modules src/run_test.node.js"
```
Output:
```
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

CALENDAR RECOVERY TESTS: 10 passed, 0 failed

OVERALL: 371 passed, 0 failed
```

### End-to-End Browser Preflight Verification
Command:
```cmd
node --experimental-wasm-modules tests/browser/test_historical_key_preflight_browser.mjs
```
Output:
```
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
  [REACTIVATE API REQ] GET http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/7ec61f68-ae61-45a7-89e8-d8b8907dcaa5
  [REACTIVATE API RES] 201 http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/prepare -> {"expires_at":"2026-10-25T11:40:10+06:00","mailbox_id":"c0000000-0000-0000-0000-000000000001","migration_id":"7ec61f68-ae61-45a7-89e8-d8b8907dcaa5","status":"pending"}
  [REACTIVATE API REQ] POST http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/finalize
  [REACTIVATE API RES] 200 http://127.0.0.1:3008/v1/mailboxes/c0000000-0000-0000-0000-000000000001/reactivate-keys/finalize -> {"mailbox_id":"c0000000-0000-0000-0000-000000000001","message":"Historical key material successfully reactivated","migration_id":"7ec61f68-ae61-45a7-89e8-d8b8907dcaa5","status":"finalized","success":true}
  Reactivation modal closed successfully after preflight and API dispatch.
  PASS: Stage 1: Prepare API returned HTTP 201 Created
  PASS: Stage 2: Read-back API returned HTTP 200 OK
  PASS: Stage 3: Finalize API returned HTTP 200 OK
  PASS: sessionStorage holds 64-char hex mailbox secret: 4e17c517...
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

### Webmail Production Build
Command:
```cmd
cmd.exe /c "cd apps\webmail && npx.cmd vite build"
```
Output:
```
vite v6.4.3 building for production...
transforming...
✓ 160 modules transformed.
rendering chunks...
dist/index.html                                  1.45 kB │ gzip:   0.73 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm  600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css               1.31 kB │ gzip:   0.61 kB
dist/assets/index-BsGW6e2N.css                 106.86 kB │ gzip:  16.97 kB
dist/assets/highlight-CFsI1eMM.js               73.46 kB │ gzip:  23.49 kB
dist/assets/index-Drm7PdYd.js                  946.33 kB │ gzip: 231.70 kB
✓ built in 3.51s
```

---

## 8. Disclosed Failures and Environmental Limitations

### TypeScript Check Failure in Untracked Calendar Test File
Command:
```cmd
cmd.exe /c "cd apps\webmail && npx.cmd tsc --noEmit"
```
Failure Output:
```
src/calendar_recovery.test.ts(71,12): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
src/calendar_recovery.test.ts(77,12): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
src/calendar_recovery.test.ts(84,12): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
src/calendar_recovery.test.ts(247,14): error TS2367: This comparison appears to be unintentional because the types 'false' and 'true' have no overlap.
src/calendar_recovery.test.ts(248,14): error TS2367: This comparison appears to be unintentional because the types 'false' and 'true' have no overlap.
src/calendar_recovery.test.ts(339,14): error TS2367: This comparison appears to be unintentional because the types 'false' and 'true' have no overlap.
src/calendar_recovery.test.ts(341,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
src/calendar_recovery.test.ts(414,14): error TS2367: This comparison appears to be unintentional because the types 'false' and 'true' have no overlap.
src/calendar_recovery.test.ts(481,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
```
- **Distinction:** This failure is strictly an environmental/pre-existing issue in the untracked file `apps/webmail/src/calendar_recovery.test.ts` from an earlier calendar task.
- Per user constraints ("Preserve all unrelated modifications and untracked files", "Do not rewrite existing test files"), this test was intentionally left unmodified. All code modified or created for historical key reactivation typechecks cleanly.

---

## 9. Active Database "byos" Strict Read-Only Verification

Command:
```cmd
docker exec byos-postgres psql -U byos -d byos -c "\dt mailbox_key_reactivations" -c "SELECT count(*) AS legacy_calendar_events_count FROM calendar_events;" -c "SELECT id, previous_key_archived_at, length(previous_wrapped_sk_user) AS prev_envelope_len FROM mailboxes WHERE previous_wrapped_sk_user IS NOT NULL;"
```
Output:
```
Did not find any relation named "mailbox_key_reactivations".
 legacy_calendar_events_count 
------------------------------
                            3
(1 row)

                  id                  |   previous_key_archived_at   | prev_envelope_len 
--------------------------------------+------------------------------+-------------------
 c0000000-0000-0000-0000-000000000001 | 2026-10-18 16:58:02.86008+00 |               997
(1 row)
```

**Explicit Confirmation:**
- Table `mailbox_key_reactivations` does not exist in active `byos`. Migration 061 was never run on active `byos`.
- The 3 legacy calendar records in `calendar_events` remain untouched.
- Alice's historical envelope (`c0000000-0000-0000-0000-000000000001`, length 997, archived timestamp `2026-10-18 16:58:02.86008+00`) remains untouched.

---

## 10. Git Working-Tree Preservation

Command:
```cmd
git status --short
```
Output:
```
 M .env.example
 M apps/control-plane/src/lib/api/auth.ts
 M apps/control-plane/src/routes/dashboard/security.tsx
 M apps/control-plane/src/routes/dashboard/settings.tsx
 M apps/control-plane/src/routes/login.tsx
 M apps/control-plane/src/routes/register.tsx
 M apps/control-plane/src/run_test.node.js
 M apps/webmail/src/App.tsx
 M apps/webmail/src/api.ts
 M apps/webmail/src/components/ReadingPane.tsx
 M apps/webmail/src/components/Sidebar.tsx
 M apps/webmail/src/message_crypto.ts
 M apps/webmail/src/mime.test.ts
 M apps/webmail/src/mime.ts
 M apps/webmail/src/persistent_session.test.ts
 M apps/webmail/src/routes/settings/SecurityTab.tsx
 M apps/webmail/src/routes/setup-account.tsx
 M apps/webmail/src/run_test.node.js
 M apps/webmail/tsconfig.json
 M docs/control_panel_2fa_report.md
 M infra/docker-compose.yml
 M services/api/auth.go
 M services/api/go.mod
 M services/api/go.sum
 M services/api/invitations.go
 M services/api/janitor.go
 M services/api/mailboxes.go
 M services/api/main.go
 M services/api/passkeys.go
 M services/api/passkeys_test.go
 M services/api/recovery.go
 M services/api/recovery_flow.go
 M services/api/recovery_flow_test.go
 M services/api/recovery_test.go
 M services/api/sessions.go
 M services/api/two_factor.go
 M tests/browser/test_control_plane_2fa.mjs
 M tools/clean-test-data.sql
?? apps/control-plane/src/lib/api/auth_sessions_pwd.test.ts
?? apps/webmail/src/calendar_crypto.test.ts
?? apps/webmail/src/calendar_crypto.ts
?? apps/webmail/src/calendar_invitation_repository.test.ts
?? apps/webmail/src/calendar_persistence_security.test.ts
?? apps/webmail/src/calendar_recovery.test.ts
?? apps/webmail/src/calendar_recovery.ts
?? apps/webmail/src/components/calendar/
?? apps/webmail/src/historical_key_reactivation.test.ts
?? apps/webmail/src/historical_key_reactivation.ts
?? apps/webmail/src/utils/calendarIcs.test.ts
?? apps/webmail/src/utils/calendarIcs.ts
?? apps/webmail/src/utils/calendarRrule.test.ts
?? apps/webmail/src/utils/calendarRrule.ts
?? docs/calendar_api_envelope_validation_report.md
?? docs/calendar_architecture_report.md
?? docs/calendar_browser_recovery_acceptance_report.md
?? docs/calendar_final_p0_security_verification.md
?? docs/calendar_implementation_report.md
?? docs/calendar_invitation_integration_report.md
?? docs/calendar_legacy_plaintext_recovery_design.md
?? docs/calendar_legacy_recovery_final_integrity_report.md
?? docs/calendar_legacy_recovery_implementation_report.md
?? docs/calendar_legacy_recovery_independent_implementation_audit.md
?? docs/calendar_legacy_recovery_mailbox_race_report.md
?? docs/calendar_legacy_recovery_remediation_report.md
?? docs/calendar_legacy_recovery_safety_review.md
?? docs/calendar_p0_independent_security_verification.md
?? docs/calendar_phase_5_1_1_independent_review.md
?? docs/calendar_phase_5_1_security_interoperability_report.md
?? docs/calendar_plaintext_fallback_remediation_report.md
?? docs/calendar_post_implementation_audit.md
?? docs/calendar_recovery_post_acceptance_security_report.md
?? docs/historical_key_reactivation_f01_f03_remediation_report.md
?? docs/historical_key_reactivation_independent_security_review.md
?? docs/historical_key_reactivation_password_safety_report.md
?? docs/historical_key_reactivation_staged_protocol_report.md
?? docs/mfa_and_recovery_completion_report.md
?? docs/passkey_audit_report.md
?? docs/passkey_domain_investigation_report.md
?? docs/passkey_implementation_report.md
?? docs/passkey_registration_api_contract_report.md
?? docs/password_change_and_sessions_report.md
?? docs/real_otp_delivery_implementation_report.md
?? docs/security_architecture_audit_report.md
?? docs/security_remediation_implementation_report.md
?? docs/security_remediation_verification_report.md
?? infra/postgres/init/059_calendars_and_events.sql
?? infra/postgres/init/060_calendar_event_migrations.sql
?? infra/postgres/init/061_mailbox_key_reactivations.sql
?? services/api/calendar.go
?? services/api/calendar_test.go
?? services/api/otp_delivery.go
?? services/api/otp_delivery_test.go
?? services/api/webauthn_config.go
?? tests/browser/artifacts/acceptance_summary.json
?? tests/browser/artifacts/historical_preflight_summary.json
?? tests/browser/domain_reproduction.mjs
?? tests/browser/test_calendar_browser.mjs
?? tests/browser/test_calendar_invitations.mjs
?? tests/browser/test_calendar_legacy_recovery_acceptance.mjs
?? tests/browser/test_historical_key_preflight_browser.mjs
?? tests/browser/test_passkeys_browser.mjs
?? tests/browser/test_password_and_sessions.mjs
?? tests/fixtures/
?? tests/manual_otp_delivery_test.mjs
?? tools/staged_key_reactivation_verify.sql
```
All unrelated modifications and untracked files are preserved.
