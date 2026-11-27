# BYOS C6.9.2X: Private Mailbox Authorization & Session Isolation Remediation Report

## 1. Executive Summary & Final Verdict

**Final Verdict:** **CONDITIONAL PASS**

All C6.9.2X authorization and session-isolation code fixes (`GET /v1/users/me/mailboxes`, `GET /v1/organizations/{org_id}/mailboxes`, and strict client-context cookie isolation in `detectClient` / `extractSessionToken` / `clearSessionCookie`) are implemented and verified against `byos_test_isolation` via `go vet ./...`, targeted Go authorization/session/mailbox/TOTP tests (`ok byos.email/services/api 12.776s`), Webmail tests (`735 passed, 0 failed`), and Control Plane tests + production build.

The verdict is **CONDITIONAL PASS** (rather than `PASS`) because:
1. Per C6.9.2X safety boundaries, the running `byos-api` container (`cf4cf78ae28a`) was **not** rebuilt or restarted, so live HTTP traffic against `127.0.0.1:8080` still serves the pre-C6.9.2X binary until an authorized container rebuild/restart milestone.
2. In the full `go test ./...` run, 5 pre-existing unrelated tests failed (`startup_guard_test.go` and `support_tickets_test.go` due to `byos_test_isolation` DB naming guard / `BYOS_DEV_MODE` / FK constraint ordering).
3. Browser console diagnostic classification uncovered an unrelated Webmail defect (`ReferenceError: setActiveMailboxContext is not defined` at `apps/webmail/src/App.tsx:2503` / `2731`) to be fixed in a separate milestone.

---

## 2. Exact Root Causes

1. **`GET /v1/users/me/mailboxes` (`services/api/mailboxes.go:1139`):** Contained legacy org-owner expansion `WHERE (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))` without `m.mode = 'org_managed'`, causing `owner`/`admin` callers to receive other users' private mailbox metadata (`id`, `email`, `display_name`, `org_id`, `is_active`) in a personal `/users/me/` endpoint.
2. **`GET /v1/organizations/{org_id}/mailboxes` (`services/api/mailboxes.go:132-146`):** Verified only active org membership (`users WHERE id=$1 AND org_id=$2 AND is_active=true`) on `GET`, allowing a normal org `member` to invoke an administrative mailbox-directory route.
3. **Ambiguous Session-Cookie Fallback (`services/api/auth.go`, `services/api/sessions.go`):** When `detectClient(r)` returned `""`, `getSessionUserID`, `getCallerTokenHash`, and `logoutHandler` fell back across `byos_session` -> `byos_cp_session` -> `byos_webmail_session`, and `clearSessionCookie` cleared all three cookies on generic logout. `detectClient` also did not reject conflicting `X-BYOS-Client` vs `Origin`/`Referer` signals.

---

## 3. Files Changed & Reasons

| File | Reason |
|---|---|
| `services/api/mailboxes.go` | Restricted `userMailboxesHandler` to `WHERE m.user_id = $1` (preserving explicit session-linked mailboxes); enforced `isAdmin(userID, orgID, conn)` on `GET /v1/organizations/{org_id}/mailboxes`. |
| `services/api/auth.go` | Added conflict detection to `detectClient(r)`; introduced shared `extractSessionToken(r)` failing closed on `"conflict"` and restricting `""` to `byos_session` only; updated `setSessionCookie`, `clearSessionCookie`, `getSessionUserID`, and `logoutHandler` to eliminate cross-app cookie fallback. |
| `services/api/sessions.go` | Updated `getCallerTokenHash(r)` to delegate to `extractSessionToken(r)` so session listing/linking uses identical strict cookie isolation. |
| `services/api/user_mailboxes_test.go` | Added `TestUserMailboxesIsolation_PrivatePolicy` and `TestOrgMailboxesRoleEnforcement`. |
| `services/api/cookie_auth_test.go` | Updated `Generic_Logout_IsolatedToLegacyCookieOnly` and added `TestCrossAppCookieIsolationAndConflictFailClosed`. |
| `services/api/multi_account_session_test.go` | Added `X-BYOS-Client: webmail` to simulated Webmail requests carrying `byos_webmail_session`. |
| `services/api/totp_replay_test.go` | Added `X-BYOS-Client: webmail` to simulated Webmail requests carrying `byos_webmail_session`. |

---

## 4. Authorization Policy Decisions

- **`GET /v1/users/me/mailboxes`:** Strictly user-scoped (`m.user_id = $1`) plus explicit session-linked mailboxes (`getLinkedMailboxIDsForSession`). Organization `owner`/`admin` roles grant zero implicit visibility into other users' private mailboxes.
- **`GET /v1/organizations/{org_id}/mailboxes`:** Retained for Control Plane organization administration (`apps/control-plane/src/lib/api/mailboxes.ts:99` used by `dashboard/index.tsx` and `dashboard/mailboxes.tsx`), returning only administrative metadata (`id`, `local_part`, `domain_id`, `domain_name`, `email`, `mode`, `status` — no keys or message contents), and now strictly enforces `isAdmin(userID, orgID, conn)` (`admin`/`owner` only, `403 Forbidden` for `member` and unrelated orgs).

---

## 5. Cookie-Selection Behavior (Before vs After)

| Client Context (`detectClient(r)`) | Before (C6.9.2W) | After (C6.9.2X) |
|---|---|---|
| `"webmail"` | `byos_webmail_session` only | `byos_webmail_session` only |
| `"control-plane"` | `byos_cp_session` only | `byos_cp_session` only |
| `""` (Unknown / CLI / test) | `byos_session` -> `byos_cp_session` -> `byos_webmail_session`; logout cleared all three | `byos_session` only (CLI/test legacy compatibility); logout clears `byos_session` only |
| `"conflict"` (`X-BYOS-Client` vs `Origin`/`Referer`) | `X-BYOS-Client` silently won | Fails closed (`extractSessionToken` returns `""`, `setSessionCookie`/`clearSessionCookie` are no-ops) |

---

## 6. Regression Tests & Verification Output

- **`services/api` `go vet` & Targeted Auth/Session/Mailbox/TOTP Suite (`TEST_DATABASE_URL=.../byos_test_isolation`):**
  ```text
  ok  	byos.email/services/api	12.776s
  ```
  Covers `TestTOTP_ReplayPrevention_FullLifecycle_9Properties`, `TestMultiAccount_*`, `TestSession*`, `TestMailbox*`, `TestCrossAppCookieIsolationAndConflictFailClosed`, `TestLogoutCookieClearing`, `TestUserMailboxesIsolation_PrivatePolicy`, `TestOrgMailboxesRoleEnforcement`, `TestListUserMailboxesReturnsAll`, `TestRejectOrgManagedMailboxCreation`, `TestPrivateMailboxAccessAndListingDoesNotExposeKey`, and `TestC5_*`.
- **Full `services/api` `go test ./...`:** Exited `1` due to 5 pre-existing unrelated failures (`TestStartupWarnDetectsKeyMismatch`, `TestCleanTestDataRemovesTestRows`, `TestCleanTestDataPreservesSeed`, `TestKeyMismatchCheckRunsWithDevMode`, `TestCustomerSupportTicketLifecycleIntegration` — `byos_test_isolation` DB name guard / `BYOS_DEV_MODE` / FK constraint).
- **Webmail (`apps/webmail` `npm.cmd test`):** `OVERALL: 735 passed, 0 failed`.
- **Control Plane (`apps/control-plane` `npm.cmd test` + `npm.cmd run build`):** All suites passed (`4+14+71+4+9+6+33+5+5+5+7+9+3` assertions) and `vite build` succeeded (`dist/index.html`, `built in 6.01s`).
- **`byos_keys_published_*` Review:** Verified in `apps/webmail/src/App.tsx:2711-2718` and `session_isolation.ts:399` — stores `"1"` keyed by `boxId` + public key hex fingerprints only (zero private keys/tokens), cleared on fresh login (`rotateSessionGeneration()`) and per-account sweep.

---

## 7. Browser Console Errors & Classification (`node scratch/c692x_console_diag.mjs`)

```text
=== WEBMAIL CONSOLE ERRORS (3) ===
[1] text="Permissions policy violation: unload is not allowed in this document." url=http://127.0.0.1:3001/src/session_isolation.ts:142
[2] text="Failed to load resource: the server responded with a status of 401 (Unauthorized)" url=http://127.0.0.1:3001/v1/auth/me:0
[3] text="[handleLogin error] ReferenceError: setActiveMailboxContext is not defined" url=http://127.0.0.1:3001/src/App.tsx:2503
WEBMAIL LOGOUT -> 204
=== CONTROL_PLANE CONSOLE ERRORS (2) ===
[1] text="Failed to load resource: the server responded with a status of 401 (Unauthorized)" url=http://127.0.0.1:8080/v1/auth/me:0
[2] text="Failed to load resource: the server responded with a status of 401 (Unauthorized)" url=http://127.0.0.1:8080/v1/auth/me:0
CONTROL_PLANE LOGOUT -> 204
```

- **Webmail #1:** Expected local-development/browser condition (Permissions Policy blocks `unload` listener).
- **Webmail #2, Control Plane #1 & #2:** Expected unauthenticated `401` on initial `/v1/auth/me` check prior to login.
- **Webmail #3:** **Application defect** (`setActiveMailboxContext(null)` called in `bootstrapSession` at `apps/webmail/src/App.tsx:2731` is undefined, caught in `handleLogin` at `App.tsx:2503`) — documented for a separate Webmail fix milestone.

---

## 8. Read-Only Status of the Two Leftover Sessions

```text
                  id                  |               user_id                |          created_at           |          expires_at           | revoked_at |  ua  
--------------------------------------+--------------------------------------+-------------------------------+-------------------------------+------------+------
 ae4a79c7-d267-4a47-917a-acbed2fe212c | cccccccc-0000-0000-0000-000000000002 | 2026-11-26 11:45:16.139907+00 | 2026-12-26 11:45:16.138839+00 |            | node
 8385e661-8b1e-4fa9-86dc-8c6572cd3643 | cccccccc-0000-0000-0000-000000000002 | 2026-11-26 11:47:03.098653+00 | 2026-12-26 11:47:03.09774+00  |            | node
(2 rows)
```

- Both remain unrevoked (`revoked_at IS NULL`) per C6.9.2X read-only DB boundary.
- **Exact Cleanup Recommendation:**
  ```sql
  UPDATE sessions
  SET revoked_at = NOW()
  WHERE id IN ('ae4a79c7-d267-4a47-917a-acbed2fe212c', '8385e661-8b1e-4fa9-86dc-8c6572cd3643')
    AND user_id = 'cccccccc-0000-0000-0000-000000000002'
    AND revoked_at IS NULL;
  ```

---

## 9. Database & Container Safety Confirmation

- No containers were started, stopped, restarted, or recreated.
- `Get-NetTCPConnection -LocalPort 25,2525,1025,8025` returned no listening sockets (all 4 mail ports remain closed).
- `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged; no database schema or active records were modified.

---

## 10. Recommended Next Milestone (C6.9.2Y)

1. Rebuild and restart `byos-api` so live `127.0.0.1:8080` serves the C6.9.2X fixes, and re-run live HTTP/browser cross-app cookie & `/v1/users/me/mailboxes` smoke checks.
2. Execute the targeted 2-row session revocation SQL for `ae4a79c7-...` and `8385e661-...`.
3. Fix the undefined `setActiveMailboxContext(null)` call in `apps/webmail/src/App.tsx:2731`.
