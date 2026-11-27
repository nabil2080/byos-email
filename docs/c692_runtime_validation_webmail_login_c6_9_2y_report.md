# BYOS C6.9.2Y: Webmail Login Repair, Session Boundary Verification & Runtime Validation Report

**Phase:** C6.9.2Y (Webmail Login Repair, Session Boundary Verification & Live Runtime Validation)  
**Current Status / Verdict:** **PASS** (**Approval Gate A** for `api` + `webmail` rebuild/recreate and **Approval Gate B** for 2-session cleanup are both approved, executed, and verified.)

---

## 1. Executive Summary

- **Task A (Webmail `setActiveMailboxContext`):** Verified that `apps/webmail/src/App.tsx:44` already imports `setActiveMailboxContext` from `apps/webmail/src/api.ts:313` (`handleLogin` is at `App.tsx:3535-3591`), and `apps/webmail` passes both `npm.cmd test` (`735 passed, 0 failed`) and `npm.cmd run build` (`built in 10.14s`). The `ReferenceError` at `http://127.0.0.1:3001/src/App.tsx:2503` occurred because the running `byos-webmail` container (`382308900a82`) has `Mounts: []` and is serving an older baked Docker image (`byos-email-webmail`).
- **Task B (Client-Context & Cookie Isolation):** Verified `detectClient(r)` + `extractSessionToken(r)` + `clearSessionCookie(w, r)` in `services/api/auth.go` and `services/api/sessions.go`. Added 4 header-spoofing/conflict subtests (`Header_Webmail_Origin_CP`, `Header_CP_Origin_Webmail`, `Origin_CP_Referer_Webmail`, `Origin_Webmail_Referer_CP`) to `TestCrossAppCookieIsolationAndConflictFailClosed` in `services/api/cookie_auth_test.go`; all passed (`ok byos.email/services/api 0.599s`).
- **Task C (5 Full API Test Failures & Baseline Comparison):** Ran all 5 tests on an isolated `HEAD` (`ffd4692`) git worktree (`scratch/baseline_head`, later removed) against `byos_test_isolation`. Proved **none** of the 5 failures were introduced by C6.9.2X or C6.9.2Y.
- **Task D (2 Leftover Alice Sessions):** Read-only SQL confirmed both sessions (`ae4a79c7-d267-4a47-917a-acbed2fe212c`, `8385e661-8b1e-4fa9-86dc-8c6572cd3643`) remain unrevoked (`revoked_at IS NULL`) and unused since creation. Exact 2-row SQL prepared for **Approval Gate B**.
- **Task E (Runtime API Deployment Plan):** Inspected `infra/docker-compose.yml` (`api`, container `byos-api`, image `byos-email-api`, `127.0.0.1:8080->8080/tcp`) and `/health`. Prepared API-only build/recreate plan (`--no-deps`) for **Approval Gate A** (noting `webmail` / `byos-webmail` also needs rebuild to clear the stale baked image).

---

## 2. Webmail Login Root Cause & Verification (Task A)

- `apps/webmail/src/api.ts:313-319` exports `setActiveMailboxContext` and `getActiveMailboxContext`.
- `apps/webmail/src/App.tsx:44` imports `setActiveMailboxContext`; `handleLogin` (`App.tsx:3535-3591`) clears it (`setActiveMailboxContext(null)` at `3546`) before login, `bootstrapSession` resets it on fresh password login (`2731`), sets it to `targetBox.id` (`2866`) / `account.id` (`2958`), and clears it on logout (`3923`, `4022`, `4094`, `4177`).
- **Local Verification:** `apps/webmail` `npm.cmd test` (`735 passed, 0 failed`, including `multi_account.test.ts:659-673` for `setActiveMailboxContext`/`getActiveMailboxContext`, fresh-login generation rotation, and logout cleanup) and `npm.cmd run build` (`vite build`, `built in 10.14s`) both pass.
- **Why Live Browser Failed:** `docker inspect byos-webmail --format "{{json .Mounts}}"` is `[]` (no bind mount), so `byos-webmail` is running a stale baked image predating the `App.tsx` import/refactor.

---

## 3. Client-Context, Cookie Isolation & Header-Spoofing Findings (Task B)

- **Authoritative vs Hint Signals:** `X-BYOS-Client` is a caller-supplied hint; `Origin`/`Referer` (`:3000` vs `:3001`) are browser-enforced origin signals (validated against `BYOS_ALLOWED_ORIGINS` / localhost in `services/api/cors.go`). Authentication always depends on a valid server-side `sessions` token hash.
- **Header-Spoofing / Conflict Defense (`services/api/auth.go:137-169`):** If `X-BYOS-Client: webmail` is sent with `Origin: http://127.0.0.1:3000` (or vice-versa, or conflicting `Origin` vs `Referer`), `detectClient(r)` returns `"conflict"`, `extractSessionToken(r)` returns `""` (fail closed), and `clearSessionCookie` clears nothing.
- **Generic `byos_session` Compatibility:** Preserved strictly when `detectClient(r) == ""` for CLI/Go test scripts (`api_test.go`, `attachments_test.go`, `root_rotation.go:160`), with zero fallback to `byos_cp_session` or `byos_webmail_session`.

---

## 4. Five Full API Test Failures & Baseline Comparison (Task C)

| Test | `HEAD` (`ffd4692`) | Working Tree | Classification | Exact Cause |
|---|---|---|---|---|
| `TestStartupWarnDetectsKeyMismatch` | PASS (0.16s) | FAIL (0.10s) | **Existing baseline failure (pre-C6.9.2X working tree)** | Pre-C6.9.2X `git diff` in `services/api/startup_guard.go:290` changed `os.Getenv("BYOS_DEV_MODE") == "1"` to `IsDevMode()`, which does not recognize `t.Setenv("BYOS_DEV_MODE", "1")`. |
| `TestKeyMismatchCheckRunsWithDevMode` | PASS (0.16s) | FAIL (0.09s) | **Existing baseline failure (pre-C6.9.2X working tree)** | Same `startup_guard.go:290` `IsDevMode()` vs `BYOS_DEV_MODE=1` mismatch. |
| `TestCleanTestDataRemovesTestRows` | FAIL (0.36s) | FAIL (0.40s) | **Existing baseline failure** | `mailboxes_user_id_fkey` violation (SQLSTATE `23503`) in cleanup SQL ordering. |
| `TestCleanTestDataPreservesSeed` | FAIL (0.32s) | FAIL (0.38s) | **Existing baseline failure** | `mailboxes_user_id_fkey` violation (SQLSTATE `23503`) in cleanup SQL ordering. |
| `TestCustomerSupportTicketLifecycleIntegration` | FAIL (0.01s) | FAIL (0.01s) | **Test-environment configuration failure** | `support_tickets_test.go:33` requires DB name containing `"disposable"` (`byos_test_isolation` rejected). |

---

## 5. Two Leftover Alice Sessions (Task D — Read-Only Verification)

```text
                  id                  |               user_id                |          created_at           |        last_active_at         |          expires_at           | revoked_at |  ua  
--------------------------------------+--------------------------------------+-------------------------------+-------------------------------+------------+------
 ae4a79c7-d267-4a47-917a-acbed2fe212c | cccccccc-0000-0000-0000-000000000002 | 2026-11-26 11:45:16.139907+00 | 2026-11-26 11:45:16.139907+00 | 2026-12-26 11:45:16.138839+00 |            | node
 8385e661-8b1e-4fa9-86dc-8c6572cd3643 | cccccccc-0000-0000-0000-000000000002 | 2026-11-26 11:47:03.098653+00 | 2026-11-26 11:47:03.098653+00 | 2026-12-26 11:47:03.09774+00  |            | node
(2 rows)
```

- **Status:** Both belong to `alice@byos.local`, remain active (`revoked_at IS NULL`), and `last_active_at == created_at` (unused since creation). **Not revoked yet — awaiting Approval Gate B.**

---

## 6. Runtime API Deployment Plan (Task E — Awaiting Approval Gate A)

- **Compose File:** `infra/docker-compose.yml`
- **Target Service & Container:** Compose service `api` -> container `byos-api` (image `byos-email-api`, `127.0.0.1:8080->8080/tcp`). *(Note: `webmail` -> `byos-webmail`, image `byos-email-webmail`, also has stale baked code and should be rebuilt/recreated if live Webmail login verification is desired.)*
- **Pre-Deployment `/health`:** `{"status":"degraded","services":{"minio":"up","postfix":"down","postgres":"up","redis":"up","rspamd":"down"}}`.
- **Proposed Commands (API-only, `--no-deps`):**
  1. `docker compose -f infra/docker-compose.yml build api`
  2. `docker compose -f infra/docker-compose.yml up -d --no-deps --force-recreate api`
  3. Verify `Invoke-RestMethod http://127.0.0.1:8080/health` and run live authenticated smoke checks.
- **Expected Impact & Rollback:** Brief (<5s) `127.0.0.1:8080` API restart only; PostgreSQL, Redis, MinIO, Admin API, Support CRM, volumes, and stopped mail services remain untouched. Rollback via `docker compose -f infra/docker-compose.yml up -d --no-deps --force-recreate api` after restoring previous image/code if needed.

---

## 7. Live Runtime Verification Results (Post-Approval Gate A)

- **Containers Recreated (`--no-deps --force-recreate api webmail`):**
  - `byos-api` (`b4ee18e53e74`, `Up 32 seconds`, `127.0.0.1:8080->8080/tcp`)
  - `byos-webmail` (`5369fd608d84`, `Up 31 seconds`, `127.0.0.1:3001->3001/tcp`)
  - `byos-postgres`, `byos-redis`, `byos-minio`, `byos-crypto-worker`, `byos-storage-worker`, `byos-admin-api`, `byos-support-crm`, `byos-control-plane` untouched (`Up 4-7 hours`).
  - `/health`: `{"status":"degraded","services":{"minio":"up","postfix":"down","postgres":"up","redis":"up","rspamd":"down"}}`.
  - Mail ports `25, 2525, 1025, 8025` remain closed; `BYOS_BACKUP_REMOTE_ENABLED=false` unchanged.
- **Live HTTP & Browser Verification (`node scratch/c692y_live_verify.mjs`):**
  ```text
  === LIVE HTTP API & ISOLATION CHECKS ===
  ALICE LOGIN -> 200, hasTokenKey=false, cookie=byos_webmail_session(<REDACTED>)
  ALICE /v1/users/me/mailboxes -> 200, ids=["c0000000-0000-0000-0000-000000000001"]
  ALICE -> BOB MAILBOX -> 403
  COOKIE ISOLATION: wm->cp=401, conflict=401, unknown=401
  ALICE LOGOUT -> 204, REUSE -> 401
  BOB /v1/users/me/mailboxes -> 200, ids=["c0000000-0000-0000-0000-000000000002"]
  BOB -> ALICE MAILBOX -> 403
  BOB LOGOUT -> 204, REUSE -> 401

  === LIVE BROWSER WEBMAIL LOGIN CHECK ===
  BROWSER WEBMAIL: cookie=byos_webmail_session(httpOnly=true,sameSite=Lax), errors=[...], localStorageKeys=[...]
  BROWSER WEBMAIL LOGOUT -> 204, /v1/auth/me after -> 401

  ALL LIVE C6.9.2Y CHECKS PASSED
  ```
- **Screenshot:** `tests/browser/artifacts/c6_9_2y_webmail_live_login.png` — Webmail Inbox rendered for `alice@byos.local` with zero `ReferenceError: setActiveMailboxContext is not defined`.

---

## 8. Gate B: Targeted Two-Session Cleanup & Safety Confirmation

- **Pre-Update Ownership Check:** Verified both `ae4a79c7-d267-4a47-917a-acbed2fe212c` and `8385e661-8b1e-4fa9-86dc-8c6572cd3643` belonged to `alice@byos.local` (`cccccccc-0000-0000-0000-000000000002`) with `revoked_at IS NULL`.
- **Execution & Post-Verification (`UPDATE 2`):**
  ```text
  UPDATE 2
                    id                  |               user_id                |          created_at           |          revoked_at           
  --------------------------------------+--------------------------------------+-------------------------------+-------------------------------
   ae4a79c7-d267-4a47-917a-acbed2fe212c | cccccccc-0000-0000-0000-000000000002 | 2026-11-26 11:45:16.139907+00 | 2026-11-26 16:01:24.800048+00
   8385e661-8b1e-4fa9-86dc-8c6572cd3643 | cccccccc-0000-0000-0000-000000000002 | 2026-11-26 11:47:03.098653+00 | 2026-11-26 16:01:24.800048+00
  (2 rows)
  ```
- Only `api` (`byos-api`) and `webmail` (`byos-webmail`) were rebuilt/recreated per **Approval Gate A**; no other containers or volumes were touched; mail ports (`25, 2525, 1025, 8025`) remain closed; `BYOS_BACKUP_REMOTE_ENABLED=false` unchanged.
