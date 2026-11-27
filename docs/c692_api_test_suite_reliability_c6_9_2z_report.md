# BYOS C6.9.2Z: API Test Suite Reliability & Failure Remediation Report

## 1. Executive Summary

**Final Verdict:** **CONDITIONAL PASS**

All five targeted API tests (`TestStartupWarnDetectsKeyMismatch`, `TestKeyMismatchCheckRunsWithDevMode`, `TestCleanTestDataRemovesTestRows`, `TestCleanTestDataPreservesSeed`, and `TestCustomerSupportTicketLifecycleIntegration`) plus `TestKeyMismatchCheckSkippedWithoutDevMode` and `go vet ./...` **PASS** (`ok byos.email/services/api 0.986s`) against the dedicated disposable database `byos_disposable_c692z`.

The verdict is **CONDITIONAL PASS** (rather than `PASS`) because the full `services/api` `go test ./...` run exited `1` (`91.550s`) due to unrelated pre-existing test-environment dependencies (`path_a_attachments_test.go`, `message_attachments_test.go` needing `BYOS_ENV=development` for CSRF origin allowlist; `post_migration_workflow_test.go:348` checking `byos_unmigrated`; and `recovery_flow_test.go`).

---

## 2. Exact Root Causes & HEAD vs Working-Tree Comparison

- **Commit / Branch / Go:** `ffd46923e1360f2825cd0f27e5b434a1942c2be3` / `main` / `go version go1.27.0 windows/amd64`.

| Test | `HEAD` (`ffd4692`) | Pre-Fix Working Tree | Root Cause |
|---|---|---|---|
| `TestStartupWarnDetectsKeyMismatch` | PASS | FAIL | `services/api/startup_guard.go:290` uses `IsDevMode()` (`BYOS_ENV == "development"` AND `ParseBoolEnv(BYOS_DEV_MODE)` per `env.go:30-32`), whereas `startup_guard_test.go:54` only set `BYOS_DEV_MODE=1` without `BYOS_ENV=development`. |
| `TestKeyMismatchCheckRunsWithDevMode` | PASS | FAIL | Same `startup_guard_test.go:337` missing `t.Setenv("BYOS_ENV", "development")`. |
| `TestCleanTestDataRemovesTestRows` | FAIL | FAIL | `tools/clean-test-data.sql` deleted `users` not in a hardcoded 5-UUID list even when surviving `mailboxes` (`c0000000-...-0001` owned by `b1000000-...-0001` in `byos_test_isolation`) or `support_tickets` still referenced them (`mailboxes_user_id_fkey` / `support_tickets_customer_user_id_fkey`, SQLSTATE `23503`). |
| `TestCleanTestDataPreservesSeed` | FAIL | FAIL | Same `tools/clean-test-data.sql` FK dependency gap. |
| `TestCustomerSupportTicketLifecycleIntegration` | FAIL | FAIL | (1) `byos_test_isolation` lacks `"disposable"` in DB name (`support_tickets_test.go:33` safety guard); (2) `support_tickets_test.go:67` attached `byos_cp_session` without `X-BYOS-Client: control-plane` (returning `401` after C6.9.2X strict cookie isolation). |

---

## 3. Source Files Modified & Reasons

| File | Reason |
|---|---|
| `services/api/startup_guard_test.go` | Added `t.Setenv("BYOS_ENV", "development")` to dev-mode tests and expanded `TestKeyMismatchCheckSkippedWithoutDevMode` with `Unset`, `Production_With_DevFlag`, `Staging_With_DevFlag`, `UnsetEnv_With_DevFlag`, and `DevEnv_InvalidDevFlag` subtests verifying fail-closed behavior. |
| `tools/clean-test-data.sql` | Excluded users/domains/orgs still referenced by surviving `mailboxes` (and deleted `support_ticket_messages`/`support_tickets` for `target_test_users` when present) before deleting `users`, preserving `mailboxes_user_id_fkey` and seed rows. |
| `services/api/support_tickets_test.go` | Added `req.Header.Set("X-BYOS-Client", "control-plane")` in `createAuthCustomerRequest` alongside `byos_cp_session` while preserving the `"disposable"` DB guard at line 33. |

---

## 4. Disposable Database & Verification Evidence

- **Disposable DB Provisioned:** `byos_disposable_c692z` (`CREATE DATABASE byos_disposable_c692z TEMPLATE byos_test_isolation;` — full 60-table schema, contains `"disposable"`).
- **Targeted 5 Tests + `go vet ./...` (`TEST_DATABASE_URL=.../byos_disposable_c692z`):**
  ```text
  === RUN   TestStartupWarnDetectsKeyMismatch
  --- PASS: TestStartupWarnDetectsKeyMismatch (0.16s)
  === RUN   TestCleanTestDataRemovesTestRows
  --- PASS: TestCleanTestDataRemovesTestRows (0.14s)
  === RUN   TestCleanTestDataPreservesSeed
  --- PASS: TestCleanTestDataPreservesSeed (0.07s)
  === RUN   TestKeyMismatchCheckSkippedWithoutDevMode
  --- PASS: TestKeyMismatchCheckSkippedWithoutDevMode (0.14s)
  === RUN   TestKeyMismatchCheckRunsWithDevMode
  --- PASS: TestKeyMismatchCheckRunsWithDevMode (0.16s)
  === RUN   TestCustomerSupportTicketLifecycleIntegration
  --- PASS: TestCustomerSupportTicketLifecycleIntegration (0.16s)
  PASS
  ok  	byos.email/services/api	0.986s
  ```
- **Full `services/api` `go test ./...` on `byos_disposable_c692z`:** Exited `1` (`91.550s`) due to unrelated pre-existing test-environment dependencies (`path_a_attachments_test.go` / `message_attachments_test.go` CSRF origin without `BYOS_ENV=development`, `TestRegistrationCompatibilityPreAndPostMigration` expecting `byos_unmigrated`, and `recovery_flow_test.go`).
- **Active Development Database (`byos`) Untouched:**
  ```text
   current_database | users_cnt | mb_cnt 
  ------------------+-----------+--------
   byos             |         2 |      2
  (1 row)
  ```
- **Infrastructure Safety:** No containers restarted/recreated; mail ports `25, 2525, 1025, 8025` remain closed; `BYOS_BACKUP_REMOTE_ENABLED=false` unchanged.
