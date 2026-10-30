# Independent Security Audit: Staged Historical Mailbox-Key Reactivation Protocol

## 1. Executive Verdict

PASS WITH LIMITATIONS
```
=== RUN   TestMailboxReactivateKeysAuthorization
    recovery_flow_test.go:224: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAuthorization (0.30s)
=== RUN   TestMailboxReactivateKeysAtomicPreservationAndIdempotency
    recovery_flow_test.go:1566: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAtomicPreservationAndIdempotency (0.29s)
=== RUN   TestStagedHistoricalKeyReactivationLifecycle
    recovery_flow_test.go:1680: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestStagedHistoricalKeyReactivationLifecycle (0.73s)
PASS
ok  	byos.email/services/api	2.939s
```

The newly implemented staged historical-key reactivation protocol represents a substantial architectural improvement over immediate envelope replacement. The implementation successfully enforces zero-knowledge trust boundaries, eliminates multi-mailbox deadlocks through strict canonical locking (`mailboxes` parent row locked first, `mailbox_key_reactivations` child row locked second), guarantees fail-closed behavior across cross-tenant and administrative boundaries, and ensures atomic database promotion without modifying untouched historical envelopes.

However, an adversarial security analysis has identified **one Medium Severity vulnerability** and **two Low Severity findings**:
1. **F-01 (Medium Severity):** Incomplete invalidation of pending reactivations across all password modification paths (`services/api/recovery.go:changePasswordHandler` and `services/api/recovery_flow.go:exceptionalRecoveryResetHandler`).
2. **F-02 (Low Severity):** Absence of a recurring background expiration reconciliation worker and startup reconciliation routine for orphaned pending reactivations.
3. **F-03 (Low Severity):** Redundant runtime dynamic DDL execution (`ensureKeyReactivationsTable`) in handler hot paths, creating failure concealment risk under least-privilege database roles.
4. **F-04 (Informational):** Soft-deleted mailboxes rely on runtime fail-closed checks rather than cascading rollback during deletion.

None of these findings allow an unauthorized attacker to compromise private keys or decrypt mailbox data without the account holder's password. The overall architectural design is cryptographically sound and secure against active adversaries. Remediations are straightforward and prioritized in Section 9.

---

## 2. Findings Ordered by Severity

| ID | Title | Severity | Status | File & Line References |
|:---|:---|:---|:---|:---|
| **F-01** | Incomplete Invalidation of Pending Reactivations Across Password Change/Reset Paths | Medium | Demonstrated | `services/api/recovery.go:485-515`<br>`services/api/recovery_flow.go:1971-1987` |
| **F-02** | Absence of Background Expiration Worker and Startup Reconciler | Low | Demonstrated | `services/api/main.go:340-346`<br>`services/api/recovery_flow.go:570-599` |
| **F-03** | Redundant Runtime DDL Execution and Concealed Deployment Failure Risk | Low | Demonstrated | `services/api/recovery_flow.go:570-599`<br>`services/api/recovery_flow.go:667,825,966,1189,1365` |
| **F-04** | Soft-Deleted Mailbox Lingering Reactivations (Cleaned Opportunistically) | Informational | Demonstrated | `services/api/mailboxes.go:451-455` |

---

### Finding F-01: Incomplete Invalidation of Pending Reactivations Across Password Change/Reset Paths

- **Severity:** Medium
- **Classification:** Demonstrated
- **Target Files:**
  - `services/api/recovery.go:485-515` (`changePasswordHandler`)
  - `services/api/recovery_flow.go:1971-1987` (`exceptionalRecoveryResetHandler`)
- **Safe Comparison Path:**
  - `services/api/recovery_flow.go:428-433` (`recoveryFlowResetPasswordHandler`)

#### Description
In `services/api/recovery_flow.go:recoveryFlowResetPasswordHandler` (lines 428–433), when a user completes a standard recovery password reset, the handler correctly invalidates all active pending reactivations:
```go
// Invalidate any pending staged key reactivations when password resets
_, _ = tx.Exec(ctx, `
    UPDATE mailbox_key_reactivations
    SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'password_reset_during_pending'
    WHERE user_id = $1 AND status = 'pending'
`, userID)
```
However, inspection of all other password-modification paths in the system reveals that this invalidation was **omitted** from:
1. `services/api/recovery.go:changePasswordHandler` (lines 477–515): The standard authenticated in-session password change endpoint (`POST /v1/auth/change-password`).
2. `services/api/recovery_flow.go:exceptionalRecoveryResetHandler` (lines 1964–2000): The exceptional employee recovery password reset endpoint (`POST /v1/auth/recovery/reset-with-approval`).

#### Vulnerable Execution Path & Impact
1. User A initiates historical key reactivation in Webmail Tab 1. Client preflight generates a candidate envelope $E_1$ wrapped with proposed password $P_1$.
2. Tab 1 calls `POST /v1/mailboxes/{mailbox_id}/reactivate-keys/prepare`. A pending record is created with $E_1$ and a 10-minute expiry.
3. In Tab 2, User A (or an attacker with session access or an approved administrator via exceptional recovery) changes or resets the account password to $P_2$ via `POST /v1/auth/change-password` or `POST /v1/auth/recovery/reset-with-approval`.
4. The database updates `users.password_hash` to $P_2$. In the case of `changePasswordHandler`, it also re-wraps the active envelope in `mailboxes.wrapped_sk_user` to $P_2$.
5. Because neither handler invalidates `mailbox_key_reactivations`, the pending reactivation record for $E_1$ remains in state `status = 'pending'`.
6. Tab 1 completes client verification and submits `POST /v1/mailboxes/{mailbox_id}/reactivate-keys/finalize` with `migration_id`.
7. `mailboxReactivateKeysFinalizeHandler` checks `status == 'pending'`, verifies unexpired TTL, locks the mailbox, and promotes candidate $E_1$ to `mailboxes.wrapped_sk_user`.
8. **Consequence:** `mailboxes.wrapped_sk_user` is now encrypted under old password $P_1$, while `users.password_hash` is authenticated under $P_2$. Upon User A's next login with $P_2$, Webmail will fail to decrypt `wrapped_sk_user`, causing unexpected key lock-out.

#### Concrete Reproduction / Remediation
In both `services/api/recovery.go:changePasswordHandler` and `services/api/recovery_flow.go:exceptionalRecoveryResetHandler`, execute an invalidation query inside the existing transaction before commit:
```go
_, _ = tx.Exec(ctx, `
    UPDATE mailbox_key_reactivations
    SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'password_changed_during_pending'
    WHERE user_id = $1 AND status = 'pending'
`, userID)
```

---

### Finding F-02: Absence of Periodic Background Expiration Reconciliation Worker and Startup Reconciler

- **Severity:** Low
- **Classification:** Demonstrated
- **Target Files:**
  - `services/api/main.go:340-346`
  - `services/api/recovery_flow.go:570-599`

#### Description
In `services/api/main.go` (lines 340–346), the calendar subsystem starts both an explicit startup reconciler and a background expiration ticker:
```go
// Startup reconciliation for calendar legacy migrations
startupReconcileCtx, startupReconcileCancel := context.WithTimeout(context.Background(), 10*time.Second)
_, _ = RunStartupMigrationReconciliation(startupReconcileCtx, schedulerDSN)
startupReconcileCancel()

// Start recurring calendar expiration worker (60-second bounded interval)
StartCalendarExpirationWorker(schedulerCtx, schedulerDSN, 60*time.Second)
```
For `mailbox_key_reactivations`, there is **no background worker or startup reconciler wired into `main.go`**. Expiration is handled strictly opportunistically:
- In `prepare` (`recovery_flow.go:724-730`): If an existing record is expired, it is rolled back when a new prepare is requested.
- In `finalize` (`recovery_flow.go:1054-1064`): If the record is expired when finalization is requested, it is rolled back and rejected with 409 Conflict.
- In `pending` (`recovery_flow.go:882-891`): Returns HTTP 410 Gone if expired.

#### Vulnerable Execution Path & Impact
If a user prepares a reactivation but closes the browser, navigates away, or suffers an unrecoverable network partition without ever calling `finalize` or `rollback`, the database record remains permanently in status `'pending'`.
Although the row is harmless because `finalize` checks `expires_at < now()` under lock and rejects expired rows, the orphaned record lingers in PostgreSQL and retains the `uq_mailbox_pending_key_reactivation` partial index slot until the user triggers a subsequent prepare request on that specific mailbox.

#### Concrete Remediation
Add a periodic background cleanup routine (e.g. running every 5 minutes in `startJanitor()`) or startup reconciliation that executes:
```sql
UPDATE mailbox_key_reactivations
SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'ttl_expired_background_reconciliation'
WHERE status = 'pending' AND expires_at < NOW();
```

---

### Finding F-03: Redundant Runtime Dynamic DDL Execution and Concealed Deployment Failure Risk

- **Severity:** Low
- **Classification:** Demonstrated
- **Target Files:**
  - `services/api/recovery_flow.go:570-599` (`ensureKeyReactivationsTable`)
  - `services/api/recovery_flow.go:667, 825, 966, 1189, 1365`

#### Description
Every HTTP handler in the staged reactivation lifecycle calls:
```go
_ = ensureKeyReactivationsTable(ctx, conn)
```
This function issues dynamic `CREATE TABLE IF NOT EXISTS` and three `CREATE INDEX IF NOT EXISTS` statements directly to PostgreSQL on every request.

#### Security & Operational Concerns
1. **Failure Concealment under Least Privilege:** In hardened production deployments, the application database role possesses only DML privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) and is denied DDL privileges (`CREATE`, `ALTER`, `DROP`). The error returned by `ensureKeyReactivationsTable` is explicitly ignored (`_ = ensureKeyReactivationsTable(...)`). If Migration 061 was not applied during deployment, this error is swallowed, and subsequent DML queries will crash with `relation "mailbox_key_reactivations" does not exist`.
2. **Lock Contention:** Issuing `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` on every request forces PostgreSQL to acquire AccessExclusiveLocks on system catalogs (`pg_class`, `pg_index`), creating unnecessary lock contention under high concurrency.
3. **Migration Discipline:** Schema management should be governed exclusively by `infra/postgres/init/061_mailbox_key_reactivations.sql` applied during deployment or startup verification.

#### Concrete Remediation
Remove `ensureKeyReactivationsTable` from handler hot paths. Verify the existence of the table once during API startup (as done for `scheduled_messages.is_path_a` in `main.go:314-324`).

---

### Finding F-04: Soft-Deleted Mailbox Lingering Reactivations (Cleaned Opportunistically)

- **Severity:** Informational
- **Classification:** Demonstrated
- **Target Files:**
  - `services/api/mailboxes.go:451-455` (`deleteMailbox`)

#### Description
When a mailbox is deleted via `services/api/mailboxes.go:deleteMailbox`, the function checks and rolls back pending `calendar_event_migrations` (lines 392–448), but does not check or roll back pending `mailbox_key_reactivations`.
Because `deleteMailbox` executes a soft delete (`is_active = false, status = 'suspended'`), the PostgreSQL foreign key constraint `ON DELETE CASCADE` is not triggered.

#### Fail-Closed Safety Analysis
This finding is strictly Informational because all staged reactivation handlers check `is_active` under lock:
- `finalize` (`recovery_flow.go:1000-1003`):
  ```go
  if !isActive {
      http.Error(w, "forbidden: mailbox is deactivated", http.StatusForbidden)
      return
  }
  ```
- `prepare` (`recovery_flow.go:701-704`): Returns 403 Forbidden if `!isActive`.
- `pending` (`recovery_flow.go:843-846`): Returns 403 Forbidden if `!isActive`.
Any attempt to finalize an in-flight reactivation against a deactivated mailbox fails closed immediately.

---

## 3. Endpoint-by-Endpoint Authorization and State-Transition Analysis

### Detailed Answers to Required Security Questions

#### Q1: Can a different user, organization administrator, or cross-tenant user prepare, inspect, finalize, or roll back another mailbox's operation?
**Verdict:** SAFE.
- **Prepare (`recovery_flow.go:676-699`):** Extracts authenticated `userID` from session. Locks parent mailbox row and verifies `mailboxUserID == userID`. Organization owners, administrators, or cross-tenant actors cannot prepare a candidate for another user's mailbox (returns `403 Forbidden: only the mailbox owner can reactivate or replace mailbox cryptographic keys`).
- **Read Back (`recovery_flow.go:828-842, 877-880`):** Verifies `mailboxUserID == userID`. In addition, child record lookup enforces `recUserID == userID` and `mailbox_id == $2`. Even if an attacker guesses a valid `migration_id`, they receive `403 Forbidden`.
- **Finalize (`recovery_flow.go:975-998, 1024-1027`):** Rechecks mailbox ownership under lock (`mailboxUserID == userID`) and record ownership (`recUserID == userID`). Returns `403 Forbidden` if either does not match.
- **Rollback (`recovery_flow.go:1198-1218, 1238-1241`):** Rechecks mailbox ownership under lock (`mailboxUserID == userID`) and record ownership (`recUserID == userID`). Returns `403 Forbidden` on mismatch.
- **Evidence:** Tested and passed in `TestMailboxReactivateKeysAuthorization` and `TestStagedHistoricalKeyReactivationLifecycle` steps 2 & 4.

#### Q2: Are mailbox ownership and active status checked inside every transaction, under the correct mailbox-first lock?
**Verdict:** SAFE.
- In every transactional endpoint (`prepare`, `finalize`, `rollback`), the lock hierarchy strictly adheres to canonical ordering:
  1. Parent Lock: `SELECT user_id::text, is_active FROM mailboxes WHERE id = $1 FOR UPDATE`
  2. Child Lock: `SELECT id::text, user_id::text, status ... FROM mailbox_key_reactivations WHERE id = $1 AND mailbox_id = $2 FOR UPDATE`
- Both ownership (`mailboxUserID == userID`) and active status (`isActive == true`) are verified under the parent row lock before any candidate record is queried or modified. Deadlocks are mathematically prevented because all operations acquire the mailbox row lock first.

#### Q3: Can a pending operation be replayed, substituted, finalized after expiry, or used against a different mailbox?
**Verdict:** SAFE.
- **Replay / Concurrent Preparation:** The database schema enforces a partial unique index:
  ```sql
  CREATE UNIQUE INDEX uq_mailbox_pending_key_reactivation
      ON mailbox_key_reactivations(mailbox_id)
      WHERE status = 'pending';
  ```
  Only one pending operation can exist per mailbox at any instant.
- **Cross-Mailbox Substitution:** All queries filtering `mailbox_key_reactivations` bind both `id = $1 AND mailbox_id = $2`. A candidate registered under Mailbox A cannot be read, finalized, or rolled back through Mailbox B.
- **Finalize After Expiry:** Under lock in `finalize` (`recovery_flow.go:1053-1064`), the timestamp is checked:
  ```go
  if expiresAt.Before(now) {
      _, _ = tx.Exec(ctx, `UPDATE mailbox_key_reactivations SET status = 'rolled_back', rolled_back_at = $1, rollback_reason = 'ttl_expired_at_finalization' WHERE id = $2`, now, migID)
      _ = tx.Commit(ctx)
      http.Error(w, "reactivation operation expired and was rolled back", http.StatusConflict)
      return
  }
  ```
  Expired records are atomically transitioned to `rolled_back` and rejected with `409 Conflict`.

#### Q4: Is the candidate envelope cryptographically bound to the correct mailbox and operation?
**Verdict:** SAFE WITH HONEST TRUST BOUNDARY.
- The server does not possess user passwords or unsealed mailbox keys (zero-knowledge architecture). Therefore, the server validates envelope structural integrity via `validateCandidateWrappedSk` (verifying salt, envelope, and root markers), but cannot verify cryptographic key equality.
- Cryptographic binding is strictly established client-side in `historical_key_reactivation.ts`:
  1. Historical key is unsealed from `previous_wrapped_sk_user`.
  2. Candidate envelope is generated using production WASM with Argon2id + AES-256-GCM.
  3. Candidate is submitted to the server (`prepare`), assigning `migration_id`.
  4. Client reads back the stored candidate from the server (`pending`).
  5. Client unseals the server-returned candidate with the new password and performs a 32-byte constant-time comparison against the original historical secret (`constantTimeEqual`).
  6. Only if verification succeeds does the client request finalization.

#### Q5: Can a concurrent password change or password reset race with finalization?
**Verdict:** VULNERABLE (Finding F-01).
- If a password change occurs via `changePasswordHandler` or an exceptional reset occurs via `exceptionalRecoveryResetHandler` while a pending reactivation exists, the pending reactivation is not marked `rolled_back`. A subsequent `finalize` call will succeed and promote an envelope encrypted with the old password.

#### Q6: Do all password-change and reset paths invalidate pending operations?
**Verdict:** NO (Finding F-01).
- `recoveryFlowResetPasswordHandler` DOES invalidate pending reactivations (lines 428–433).
- `changePasswordHandler` and `exceptionalRecoveryResetHandler` DO NOT invalidate pending reactivations.

#### Q7: Can rollback restore stale key material over a newer legitimate key envelope?
**Verdict:** SAFE.
- `mailboxReactivateKeysRollbackHandler` (lines 1266–1280) updates **only** `mailbox_key_reactivations.status = 'rolled_back'`.
- It does not modify `mailboxes.wrapped_sk_user` or `mailboxes.previous_wrapped_sk_user`.
- If rollback is attempted on an already finalized operation, it returns `409 Conflict: cannot roll back a finalized migration` (lines 1261–1264).
- Rollback cannot overwrite or restore stale keys over active keys.

#### Q8: Are retries idempotent after lost responses, process crashes, and API restarts?
**Verdict:** SAFE.
- **Prepare Retry (`recovery_flow.go:731-744`):** If a client retries `prepare` with the exact same candidate envelope before expiry, the server recognizes the candidate under lock and returns the existing `migration_id` with HTTP 200.
- **Finalize Retry (`recovery_flow.go:1029-1041`):** If a client retries `finalize` after a dropped HTTP response, the server observes `status == 'finalized'`, commits, and returns HTTP 200 with `status: "finalized"`.
- **Rollback Retry (`recovery_flow.go:1243-1259`):** Repeated rollback calls for an already rolled-back record return HTTP 200 with `status: "rolled_back"`.

#### Q9: What happens when the API crashes between prepare, client verification, finalize, and rollback?
**Verdict:** SAFE.
- **Crash after Prepare:** The candidate sits in `mailbox_key_reactivations` with `status = 'pending'`. The `mailboxes` table is untouched. Client can resume via `GET /pending` or wait for TTL expiry.
- **Crash during Finalize:** All operations in `finalize` run inside a single PostgreSQL transaction (`tx.Begin`). If a crash occurs before `tx.Commit`, PostgreSQL automatically rolls back the transaction. The database remains in the pending state. The client can safely retry.
- **Crash between Verification and Rollback:** The client aborts without calling finalize. The pending record expires in 10 minutes and is safely invalidated.

#### Q10: Is there a real expiration reconciliation worker? Verify its startup wiring, interval, graceful shutdown, and behavior after restart.
**Verdict:** DEFICIENT (Finding F-02).
- There is NO background expiration worker or startup reconciliation wired in `main.go` for `mailbox_key_reactivations`. Expiration is strictly opportunistic.

#### Q11: Does automatic table provisioning conflict with migration 061 or conceal deployment failures?
**Verdict:** DEFICIENT (Finding F-03).
- The table structure in `ensureKeyReactivationsTable` is identical to Migration 061. However, executing dynamic DDL on every request conceals deployment failures if the API user lacks DDL permissions and causes database lock contention.

#### Q12: Can candidate or historical envelopes, passwords, or private keys leak through logs, errors, telemetry, browser storage, or network diagnostics?
**Verdict:** SAFE.
- **Logs:** Handlers log only `migration_id`, `mailbox_id`, and `user_id` to audit logs (lines 1115–1117).
- **Errors:** Error responses use static error strings (`invalid request body`, `malformed candidate envelope`).
- **Browser Storage:** Plaintext passwords and recovery secrets are never written to `localStorage` or `sessionStorage`. The active decrypted mailbox key is cached in `sessionStorage` (`byos_mailbox_sk_...`) for the duration of the browser session and cleared on logout.
- **Memory Hygiene:** In `historical_key_reactivation.ts`, all intermediate secret buffers are zeroed using `Uint8Array.fill(0)` immediately after comparison (lines 159, 205).

#### Q13: Does finalization remove only the intended historical envelope and preserve unrelated mailbox cryptographic state?
**Verdict:** SAFE.
- Finalization SQL (`recovery_flow.go:1074-1093`) updates `wrapped_sk_user = candidate`, sets `previous_wrapped_sk_user = NULL`, and updates `updated_at`.
- All other columns (`domain_id`, `org_id`, `storage_quota_bytes`, `storage_used_bytes`, `local_part`) are unaffected.

#### Q14: Can mailbox deletion, deactivation, or ownership changes race with pending reactivation?
**Verdict:** SAFE AT RUNTIME (Finding F-04).
- `deleteMailbox` sets `is_active = false`.
- All reactivation handlers check `is_active` under row lock and return `403 Forbidden` if deactivated.

#### Q15: Are database locks, constraints, unique indexes, and transaction boundaries sufficient to prevent inconsistent state?
**Verdict:** SAFE.
- Strict two-tier lock ordering (`mailboxes` parent first, `mailbox_key_reactivations` child second), foreign keys with `ON DELETE CASCADE`, check constraint `CHECK (status IN ('pending', 'finalized', 'rolled_back'))`, and partial unique index `uq_mailbox_pending_key_reactivation` prevent inconsistent state.

---

## 4. Concurrency and Crash-Recovery Analysis

### Concurrency Matrix

| Scenario | Thread 1 Action | Thread 2 Action | Resolution Order | Result |
|:---|:---|:---|:---|:---|
| **Simultaneous Prepare** | `prepare` Candidate A | `prepare` Candidate B | Thread 1 acquires mailbox lock first. Thread 2 blocks on mailbox lock. | Thread 1 creates pending record A. Thread 2 acquires lock, supersedes record A (marks rolled back), creates pending record B. Partial unique index is never violated. |
| **Prepare Identical Retry** | `prepare` Candidate A | `prepare` Candidate A | Thread 1 commits record A. Thread 2 acquires lock. | Thread 2 detects identical candidate under lock (`existingCand == wrappedSkUser`), commits without changes, returns HTTP 200 with existing `migration_id`. |
| **Finalize vs. Rollback Race** | `finalize` Migration 1 | `rollback` Migration 1 | Thread 1 acquires mailbox lock first. Thread 2 blocks on mailbox lock. | Thread 1 finalizes operation, commits. Thread 2 acquires lock, detects `status == 'finalized'`, returns `409 Conflict: cannot roll back a finalized migration`. Key promotion is preserved. |
| **Rollback vs. Finalize Race** | `rollback` Migration 1 | `finalize` Migration 1 | Thread 2 acquires mailbox lock first. Thread 1 blocks on mailbox lock. | Thread 2 rolls back operation, commits. Thread 1 acquires lock, detects `status == 'rolled_back'`, returns `409 Conflict: cannot finalize a rolled back reactivation`. Historical envelope is preserved. |
| **Deactivate vs. Finalize Race** | `deleteMailbox` | `finalize` Migration 1 | `deleteMailbox` acquires mailbox lock, sets `is_active = false`, commits. | `finalize` acquires mailbox lock, reads `is_active == false`, aborts immediately with `403 Forbidden: mailbox is deactivated`. |

### Crash-Recovery State Table

| Failure Point | System State Before Restart | State After Restart | Recovery Action Required |
|:---|:---|:---|:---|
| **Crash during Prepare before Commit** | Transaction rolled back by DB. | No pending record exists. Mailbox envelopes untouched. | Client receives 500/network drop, retries prepare safely. |
| **Crash between Prepare and Verify** | Pending record committed. Mailbox envelopes untouched. | Record sits in status `pending` with active TTL. | Client fetches candidate via `GET /pending`, resumes verification. |
| **Crash during Finalize before Commit** | Transaction rolled back by DB. | Record status remains `pending`. Mailbox envelopes untouched. | Client receives network drop, retries finalize. Transaction executes and commits. |
| **Crash during Finalize after Commit** | Transaction committed. `wrapped_sk_user` promoted. | Record status is `finalized`. `previous_wrapped_sk_user` cleared. | Client retries finalize, server detects `status == 'finalized'`, returns 200 OK idempotently. |
| **Crash during Rollback before Commit** | Transaction rolled back by DB. | Record status remains `pending`. Mailbox envelopes untouched. | Client retries rollback, or record expires via TTL. Historical keys remain preserved. |

---

## 5. Database Migration and Deployment Analysis

### Migration 061 Review (`infra/postgres/init/061_mailbox_key_reactivations.sql`)
1. **Schema Definition:**
   - Table `mailbox_key_reactivations` correctly defines `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
   - Foreign key constraints `mailbox_id REFERENCES mailboxes(id) ON DELETE CASCADE` and `user_id REFERENCES users(id) ON DELETE CASCADE` guarantee relational integrity.
   - Check constraint `CHECK (status IN ('pending', 'finalized', 'rolled_back'))` strictly bounds state transitions.
2. **Indexing:**
   - `uq_mailbox_pending_key_reactivation` (partial unique index on `mailbox_id WHERE status = 'pending'`): Enforces at most one active candidate per mailbox at the database engine level.
   - `idx_mailbox_key_reactivations_lookup`: Accelerates compound lookups on `(mailbox_id, user_id, status)`.
   - `idx_mailbox_key_reactivations_expiry`: Accelerates TTL checks on `(status, expires_at) WHERE status = 'pending'`.
3. **Isolation from Migration 060:**
   - Migration 061 is fully decoupled from `060_calendar_event_migrations.sql`. It introduces no shared tables or foreign key entanglements with the calendar subsystem.
4. **Active Database Safety:**
   - Migration 061 has NOT been applied to active database `byos`. The active database schema remains strictly in its pre-migration state.

---

## 6. Client-Side Cryptographic Verification Analysis

### Trust Boundary and Preflight Flow
In `apps/webmail/src/historical_key_reactivation.ts`:
1. **Password Policy Enforcement (`validatePasswordPolicy`):**
   Validates password length (8 to 128 characters) and rejects empty or whitespace-only inputs before invoking any cryptographic primitives or dispatching network calls.
2. **Confirmation Matching:**
   Validates `newPassword === confirmPassword`. Fails immediately if mismatched, preventing accidental key lock-out.
3. **Decryption of Historical Secret:**
   Invokes `autoUnwrapMailboxKey` or `unwrapMailboxKeyWithRecoveryPhrase` using production WebAssembly. Verifies recovered buffer is non-null and exactly 32 bytes.
4. **Candidate Envelope Derivation:**
   Generates a cryptographically random 16-byte salt (`crypto.getRandomValues`) and wraps the recovered 32-byte secret using `wasm.wasm_passphrase_wrap_key` (Argon2id KDF + AES-256-GCM). Preserves JSON metadata (`root_wrapped`, `signing_root_wrapped`, `xwing_root_wrapped`).
5. **Two-Way Local Verification:**
   Before dispatching any network request, the controller unseals the newly wrapped candidate using the proposed password and verifies 32-byte equality using `constantTimeEqual(originalSk, candidateSk)`.
6. **Read-Back Verification (`verifyReadBackCandidateEnvelope`):**
   The browser fetches the candidate envelope back from the server API via `fetchPending`. It unwraps the server-returned candidate with the new password and re-verifies 32-byte equality against the original secret using `constantTimeEqual`.
7. **Memory Wipe:**
   Verification secret buffers are wiped immediately using `candidateSk.fill(0)` in both preflight and read-back routines.

---

## 7. Logging and Secret-Exposure Analysis

### Audit and Diagnostic Review
- **Audit Logs:**
  In `services/api/recovery_flow.go:1115-1117`, finalization audit log records only:
  ```go
  auditLog(ctx, conn, "", userID, "reactivate_mailbox_keys_finalized", "mailbox", mailboxID, map[string]interface{}{
      "migration_id": migID,
  })
  ```
  No passwords, plaintext secrets, candidate envelopes, or wrapped keys are recorded.
- **HTTP Error Messages:**
  All error returns use fixed, generic strings (`"malformed candidate envelope: invalid JSON"`, `"invalid request body"`, `"reactivation record not found"`).
- **Browser DOM & Storage:**
  - Password inputs use HTML `type="password"`.
  - Signal variables for secrets in `SecurityTab.tsx` (`reactivateSecretInput`, `newPassForReactivate`, `confirmPassForReactivate`) are cleared upon modal dismissal or operation completion.
  - The unsealed mailbox secret is held only in `sessionStorage` (`byos_mailbox_sk_{mailbox_id}`), which is isolated to the active tab and cleared upon user logout.

---

## 8. Missing Test Cases

The following test cases should be added to the test suite to close adversarial gaps:

1. **Concurrent Password Change during Pending Reactivation (F-01 Regression Test):**
   Prepare a staged reactivation for Mailbox 1. While in status `pending`, call `changePasswordHandler` for the user. Assert that the pending reactivation record is marked `rolled_back` and cannot be finalized.
2. **Concurrent Exceptional Recovery Reset during Pending Reactivation (F-01 Regression Test):**
   Prepare a staged reactivation for Mailbox 1. Execute `exceptionalRecoveryResetHandler` for the user. Assert that the pending reactivation record is marked `rolled_back`.
3. **Lease Contention under High Concurrency:**
   Execute 50 concurrent `prepare` requests with differing candidate envelopes for the same mailbox. Verify that exactly one candidate emerges in status `pending` and 49 are rolled back with no unique constraint violations.
4. **Expired Candidate Reconciliation Test:**
   Simulate multiple expired pending reactivations across multiple mailboxes. Verify that the background janitor safely sweeps and marks them `rolled_back`.

---

## 9. Prioritized Remediation Plan

### Remediation Step 1 (Priority 1 - High): Invalidate Pending Reactivations on All Password Changes
**Files:** `services/api/recovery.go`, `services/api/recovery_flow.go`
Add invalidation logic inside the database transaction of both `changePasswordHandler` and `exceptionalRecoveryResetHandler`:
```go
_, _ = tx.Exec(ctx, `
    UPDATE mailbox_key_reactivations
    SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'password_changed_during_pending'
    WHERE user_id = $1 AND status = 'pending'
`, userID)
```

### Remediation Step 2 (Priority 2 - Medium): Add Background Expiration Janitor Worker
**Files:** `services/api/main.go`, `services/api/janitor.go`
Wire a 60-second background ticker in `startJanitor()` to clean up expired pending reactivations:
```go
_, _ = db.Exec(`
    UPDATE mailbox_key_reactivations
    SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'ttl_expired_background_reconciliation'
    WHERE status = 'pending' AND expires_at < NOW()
`)
```

### Remediation Step 3 (Priority 3 - Low): Remove Dynamic DDL from Handler Hot Paths
**Files:** `services/api/recovery_flow.go`
Remove calls to `ensureKeyReactivationsTable` from handlers. Validate table presence once during server initialization in `main.go`.

---

## 10. Raw Verification Evidence

### Go Integration Test Suite Output
Command:
```powershell
$env:TEST_DATABASE_URL='postgres://byos:byos_dev_password@localhost:5432/byos_recovery_disposable_20261024?sslmode=disable'; go test -v -run 'TestStagedHistoricalKeyReactivationLifecycle|TestMailboxReactivateKeysAuthorization|TestMailboxReactivateKeysAtomicPreservationAndIdempotency' ./services/api
```
Output:
```
=== RUN   TestMailboxReactivateKeysAuthorization
    recovery_flow_test.go:224: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAuthorization (0.30s)
=== RUN   TestMailboxReactivateKeysAtomicPreservationAndIdempotency
    recovery_flow_test.go:1566: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestMailboxReactivateKeysAtomicPreservationAndIdempotency (0.29s)
=== RUN   TestStagedHistoricalKeyReactivationLifecycle
    recovery_flow_test.go:1680: [test-db] Using test database 'byos_recovery_disposable_20261024' on host 'localhost'
--- PASS: TestStagedHistoricalKeyReactivationLifecycle (0.73s)
PASS
ok  	byos.email/services/api	2.939s
```

### Webmail Client-Side Cryptographic Preflight Test Suite Output
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

### Active Database "byos" Strict Read-Only Verification Output
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

### Git Working-Tree Verification Output
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
