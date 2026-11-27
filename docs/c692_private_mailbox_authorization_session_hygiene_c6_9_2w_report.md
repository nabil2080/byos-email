# BYOS C6.9.2W: Private Mailbox Directory Authorization & Session Hygiene Audit Report

**Phase:** C6.9.2W (Read-Only Security & Session Hygiene Audit)  
**Final Verdict:** **CONDITIONAL PASS** (Authentication and message-level private-mailbox isolation work and fail closed with `403`, but legacy org-owner visibility in `GET /v1/users/me/mailboxes`, fallback cookie ambiguity when `detectClient(r) == ""`, two leftover unrevoked smoke-test sessions, and unlogged C6.9.2V console errors require remediation/cleanup in a separate C6.9.2X milestone.)  
**Safety Confirmation:** **Strictly read-only — no source code modified, no sessions revoked, no database mutations, no new login attempts, no containers started/stopped/restarted, no secrets/tokens/hashes printed, all mail/SMTP ports (`25, 2525, 1025, 8025`) closed, `BYOS_BACKUP_REMOTE_ENABLED=false` unchanged.**

---

## 1. Runtime Baseline

| Container | ID | Status | Ports |
|---|---|---|---|
| `byos-postgres` | `72e2b4cee994` | `Up 4 hours (healthy)` | `127.0.0.1:5432->5432/tcp` |
| `byos-redis` | `7199c4dceb5f` | `Up 4 hours (healthy)` | `127.0.0.1:6379->6379/tcp` |
| `byos-minio` | `227c39d14808` | `Up 4 hours (healthy)` | `127.0.0.1:9000-9001->9000-9001/tcp` |
| `byos-crypto-worker` | `4273f343ed78` | `Up 4 hours (healthy)` | `8084/tcp` |
| `byos-storage-worker` | `5423ae92f754` | `Up 4 hours (healthy)` | `8083/tcp` |
| `byos-admin-api` | `9142b1228c80` | `Up 4 hours` | `127.0.0.1:8087->8087/tcp` |
| `byos-support-crm` | `da70e9e2b0f4` | `Up 4 hours` | `127.0.0.1:3003->3003/tcp` |
| `byos-api` | `cf4cf78ae28a` | `Up About an hour` | `127.0.0.1:8080->8080/tcp` |
| `byos-webmail` | `382308900a82` | `Up About an hour` | `127.0.0.1:3001->3001/tcp` |
| `byos-control-plane` | `6ad4ea19667f` | `Up About an hour` | `127.0.0.1:3000->3000/tcp` |
| Excluded/One-shot | `1702eb9f77e0`, `f399ff5592be`, `a14bce40a487`, `2db15b1d6278`, `aeb6297be7fb`, `1e033ca556e8`, `93ee134bcf9f`, `f833023698ad`, `41e62c251776`, `4b0a180f2dc6` | `Exited` | None (`25, 2525, 1025, 8025` closed) |

---

## 2. Private Mailbox Directory Visibility (`GET /v1/users/me/mailboxes`)

### A. Trace of Implementation
- Route `/v1/users/me/mailboxes` (`services/api/main.go:364`) dispatches to `userMailboxesHandler` (`services/api/mailboxes.go:1095-1193`).
- `userMailboxesHandler` queries `users` (`org_id`, `role`, `is_active`) and executes (`services/api/mailboxes.go:1139`):
  ```sql
  WHERE (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))
  ```
- It then appends any session-linked mailboxes (`getLinkedMailboxIDsForSession`, `services/api/mailboxes.go:1160-1187`).

### B. Verified Ownership (Read-Only SQL)
| Field | Alice Mailbox | Bob Mailbox |
|---|---|---|
| Mailbox ID | `c0000000-0000-0000-0000-000000000001` | `c0000000-0000-0000-0000-000000000002` |
| Owner `user_id` | `cccccccc-0000-0000-0000-000000000002` | `cccccccc-0000-0000-0000-000000000003` |
| Mailbox `mode` | `private` | `private` |
| `org_id` | `00000000-0000-0000-0000-000000000aaa` | `00000000-0000-0000-0000-000000000aaa` |
| Returned to Alice | Yes | Yes (because Alice has `role = 'owner'`) |

### C. Intended Privacy Policy & Assessment
- Per `docs/crypto_audit_and_private_mailbox_migration_report.md` and Migration 058, organization-managed mailboxes were removed (`mailboxes_mode_check` enforces `mode = 'private'`), and `isMailboxAuthorizedForSession` (`services/api/auth.go:1090`) enforces `(m.user_id = u.id OR (m.mode = 'org_managed' AND u.role IN ('admin', 'owner')))` — effectively owner-only (or explicitly session-linked) for private mailboxes, which is why Alice's request to Bob's messages failed closed with `403`.
- **Legacy Behavior in `userMailboxesHandler`:** Line 1139 lacks `m.mode = 'org_managed'` (and `/v1/users/me/mailboxes` is a user-scoped Webmail mailbox-switcher endpoint, unlike Control Plane's org directory `GET /v1/organizations/{org_id}/mailboxes` at `services/api/mailboxes.go:138`).
- **Exposure:** `UserMailboxItem` (`services/api/mailboxes.go:1087-1093`) exposes `id`, `email`, `display_name`, `org_id`, and `is_active` (no storage or encryption metadata). In `apps/webmail/src/App.tsx:2748-2783`, Webmail filters `boxes.find((b) => b.id === user.mailbox_id)` so the UI does not select Bob's mailbox, but the API still leaks Bob's mailbox ID, email, and display name over the wire to Alice.
- **Related Endpoint Note:** `GET /v1/organizations/{org_id}/mailboxes` (`services/api/mailboxes.go:132-175`) checks org membership (`users WHERE id=$1 AND org_id=$2 AND is_active=true`) without checking `isAdmin` on `GET` (only on `POST`), meaning any org `member` can list org mailbox metadata (`id`, `local_part`, `domain_id`, `domain_name`, `email`, `mode`, `status`).

---

## 3. Leftover Sessions Reconciliation (Read-Only SQL)

```sql
SELECT id, user_id, created_at, expires_at, last_active_at, revoked_at, LEFT(COALESCE(user_agent,''), 40) AS ua
FROM sessions
WHERE user_id = 'cccccccc-0000-0000-0000-000000000002'
  AND created_at > NOW() - INTERVAL '3 hours'
ORDER BY created_at DESC;
```

- **4 cleanly revoked C6.9.2V final-run sessions:** `af0f3e73-92ea-4529-9f70-5320a3ef666f`, `f167d3c5-9dde-4fea-9b3d-b46705f54c92`, `df8fe824-1e01-462b-bd33-9576d64597dd`, `f1c65ea6-655e-4149-9511-a28a354972c1` (all have `revoked_at` set within seconds of creation).
- **2 positively identified leftover test-created sessions (`revoked_at IS NULL`, `ua = 'node'`):**
  1. `ae4a79c7-d267-4a47-917a-acbed2fe212c` (`created_at: 2026-11-26 11:45:16.139907+00`, `expires_at: 2026-12-26 11:45:16.138839+00`) — matches aborted C6.9.2V run #1 (`Webmail mailboxes mismatch`).
  2. `8385e661-8b1e-4fa9-86dc-8c6572cd3643` (`created_at: 2026-11-26 11:47:03.098653+00`, `expires_at: 2026-12-26 11:47:03.09774+00`) — matches aborted C6.9.2V run #2 (`WEBMAIL LOGOUT -> 403` before `Origin` header fix).
- **Recommended Narrow Cleanup (for C6.9.2X):** `UPDATE sessions SET revoked_at = NOW() WHERE id IN ('ae4a79c7-d267-4a47-917a-acbed2fe212c', '8385e661-8b1e-4fa9-86dc-8c6572cd3643') AND user_id = 'cccccccc-0000-0000-0000-000000000002' AND revoked_at IS NULL;`

---

## 4. Webmail vs Control Plane Cookie Isolation

- **`detectClient(r)` (`services/api/auth.go:137-157`):** Determines `"control-plane"` (`X-BYOS-Client: control-plane|control_plane|admin`, or `Origin`/`Referer` containing `:3000`) or `"webmail"` (`X-BYOS-Client: webmail`, or `Origin`/`Referer` containing `:3001`), else `""`.
- **When `client` is `"control-plane"` or `"webmail"`:** `getSessionUserID` (`services/api/auth.go:344-351`), `getCallerTokenHash` (`services/api/sessions.go:32-39`), and `logoutHandler` (`services/api/auth.go:910-917`) strictly read only `byos_cp_session` or `byos_webmail_session` respectively. Thus, a Webmail cookie cannot authenticate a Control Plane browser/client request, and vice versa.
- **Ambiguity / Fail-Open Risk when `client == ""`:** When `detectClient(r)` returns `""` (no `X-BYOS-Client`, `Origin`, or `Referer` with `:3000`/`:3001`), `getSessionUserID`, `getCallerTokenHash`, and `logoutHandler` fall back to: `byos_session` -> `byos_cp_session` -> `byos_webmail_session` (`services/api/auth.go:353-359`). Because `Domain` is unset (host-only `127.0.0.1` shared across ports `3000`, `3001`, `8080`), a non-browser or header-stripped request carrying both cookies does not fail closed.
- **Vite Proxies:** `apps/webmail/vite.config.ts:16-19` proxies `/v1` and `/api/v1` to `http://127.0.0.1:8080`; `apps/control-plane/vite.config.ts:13-20` proxies `/v1` and `/health` with `changeOrigin: true` (browser `Origin`/`Referer` headers still identify `:3000`/`:3001`).

---

## 5. Webmail `sessionStorage` Key-Publication State

- **Module & Key (`apps/webmail/src/App.tsx:2711-2718`):** `publishKeysOnce` sets `sessionStorage.setItem("byos_keys_published_" + boxId + "_" + signingPubHex + "_" + xwingPubHex, "1")`.
- **Sensitivity:** Stored value is `"1"` (non-sensitive idempotency flag); key suffix uses public key hex fingerprints (`signingPubHex`, `xwingPubHex`), **no private keys or auth tokens**.
- **Cleanup & Rotation Safety:** Cleared on fresh login via `rotateSessionGeneration()` (`App.tsx:2730`) and per-account sweep (`apps/webmail/src/session_isolation.ts:399`). Because the key embeds the public key fingerprints, rotating keys produces a new key name and does not skip publication.

---

## 6. Browser-Console Errors (C6.9.2V)

- `scratch/c692v_smoke.mjs` logged only `consoleErrors.length` (`3` on Webmail, `2` on Control Plane) and did not persist the error strings to `task-31548.log`.
- **Classification:** **Unknown / Unclassified** (original error text unavailable without re-running authenticated browser login, which is prohibited in read-only C6.9.2W).

---

## 7. Regression Test Recommendations & Proposed C6.9.2X Milestone

- **Existing Coverage:** `services/api/cookie_auth_test.go` (cookie selection/clearing by `X-BYOS-Client`), `services/api/user_mailboxes_test.go` (multi-mailbox listing for single user), `apps/webmail/src/multi_account.test.ts` (`byos_keys_published_*` idempotency and cleanup).
- **Recommended Additions (for C6.9.2X):**
  1. `userMailboxesHandler` test: `owner`/`admin` in `Smoke Test Org` must NOT receive `bob`'s `private` mailbox in `GET /v1/users/me/mailboxes` (`m.user_id = $1` only).
  2. Cross-app cookie isolation test: `byos_webmail_session` rejected on `X-BYOS-Client: control-plane` (`401`), `byos_cp_session` rejected on `X-BYOS-Client: webmail` (`401`), and decide/test whether `client == ""` should reject `byos_cp_session`/`byos_webmail_session`.
  3. Browser smoke test capturing exact `console.error` messages and asserting `0` unexpected runtime errors.
- **Proposed C6.9.2X Scope:**
  - Fix `services/api/mailboxes.go:1139` (`WHERE m.user_id = $1`), review `GET /v1/organizations/{org_id}/mailboxes` role check (`mailboxes.go:132`), optionally tighten `detectClient(r) == ""` cookie fallback in `services/api/auth.go` & `sessions.go`, revoke the 2 identified leftover test sessions (`ae4a79c7-...`, `8385e661-...`), and run targeted Go + browser regression tests.
