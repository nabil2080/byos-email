# BYOS C6.9.2U: Authenticated Test Readiness & Fixture Audit Report

**Phase:** C6.9.2U (Read-Only Authenticated Test Readiness & Fixture Audit)  
**Final Verdict:** **PASS** (suitable isolated local test fixtures, exact route/cookie mappings, and a safe read-only authenticated test plan exist; awaiting explicit approval `APPROVE C6.9.2V AUTHENTICATED SMOKE TESTS`)  
**Safety Confirmation:** **No login attempts were performed; no sessions were created; no accounts or mailboxes were created or modified; all mail/SMTP services remain stopped; `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.**

---

## 1. Runtime Baseline

- **Running Core & App Services:** `byos-postgres` (`72e2b4cee994`, `healthy`), `byos-redis` (`7199c4dceb5f`, `healthy`), `byos-minio` (`227c39d14808`, `healthy`), `byos-crypto-worker` (`4273f343ed78`, `healthy`), `byos-storage-worker` (`5423ae92f754`, `healthy`), `byos-admin-api` (`9142b1228c80`, `running`), `byos-support-crm` (`da70e9e2b0f4`, `running`), `byos-api` (`cf4cf78ae28a`, `127.0.0.1:8080`), `byos-webmail` (`382308900a82`, `127.0.0.1:3001`), `byos-control-plane` (`6ad4ea19667f`, `127.0.0.1:3000`).
- **Stopped / Excluded:** `outbound-worker`, `inbound-bridge`, `mail-router`, `rspamd`, `postfix`, `mailpit`, `public-site`, `sweet_napier`; ports `25`, `2525`, `1025`, `8025` closed (`EXCLUDED_PORTS_CLOSED`).

---

## 2. Available Local Test Fixtures (Redacted — No Credentials Printed)

| Fixture Identifier | Role / Org | Intended App | Local Auth Path | Synthetic Data | Safe Without Mutating Real Data |
|---|---|---|---|---|---|
| `alice@byos.local` (`cccccccc-0000-0000-0000-000000000002`), mailbox `c0000000-0000-0000-0000-000000000001` (`mode: private`) | `owner` (`Smoke Test Org`, `two_factor_enabled: false`) | Webmail & Control Plane | Yes (`POST /v1/auth/login`, documented local dev fixture) | Yes (`Smoke Test Org`) | Yes (read-only checks + logout cleanup) |
| `bob@byos.local` (`cccccccc-0000-0000-0000-000000000003`), mailbox `c0000000-0000-0000-0000-000000000002` (`mode: private`) | `owner` (`Smoke Test Org`, `two_factor_enabled: false`) | Webmail (cross-mailbox boundary test) | Yes (`POST /v1/auth/login`, documented local dev fixture) | Yes (`Smoke Test Org`) | Yes (used only as non-owned mailbox target for `alice`) |

*(Note: Both fixtures have `role: owner`, so role-based `member` vs `owner` rejection is not directly testable without a separate `member` fixture; private-mailbox isolation IS directly testable using `alice` -> `bob`'s private mailbox `c0000000-0000-0000-0000-000000000002`.)*

---

## 3. Authentication Flow, Cookies & Authorization Boundaries (`services/api/auth.go`)

- **Routes:** `POST /v1/auth/login`, `GET /v1/auth/me`, `POST /v1/auth/logout`, `GET /v1/users/me/mailboxes`, `GET /v1/auth/sessions`, `GET /v1/auth/organization-members`, `GET /v1/domains`.
- **Session & Cookie Design (`setSessionCookie`, lines 159–200; `loginHandler`, lines 742–795):**
  - Generates a 32-byte random token, stores only its SHA-256 `token_hash` in PostgreSQL `sessions`, and **omits the token from the JSON response** (`resp` returns user/org/mailbox metadata + `wrapped_sk_user` only).
  - Sets client-isolated cookies: `byos_webmail_session` (Webmail), `byos_cp_session` (Control Plane), or `byos_session` (CLI/test fallback), all with `HttpOnly: true`, `SameSite: Lax`, `Path: "/"`, and `Secure: IsCookieSecure()` (`false` on local HTTP dev, `true` when `BYOS_ENV=production`).
  - `apps/control-plane/src` uses `localStorage` only for UI sidebar state (`byos_cp_sidebar_collapsed`), never auth tokens.
  - `POST /v1/auth/logout` invalidates the `sessions` row and clears the client cookie (`MaxAge: -1`).
- **Private-Mailbox Enforcement (`verifyUserMailboxSession`, lines 1149–1163):** Enforces `X-BYOS-Active-Mailbox` matching and `isMailboxAuthorizedForSession` (returns `403 Forbidden: "not authorized for this mailbox"` if `alice` accesses `bob`'s private mailbox).

---

## 4. Proposed Authenticated Test Matrix (Not Executed — For C6.9.2V)

| Test | Endpoint / Target | Expected Result |
|---|---|---|
| Login using `alice@byos.local` | `POST /v1/auth/login` (Webmail + Control Plane) | `200`, `Set-Cookie` (`HttpOnly`, `SameSite=Lax`, `Path=/`), no `token` in JSON |
| `GET /v1/auth/me` without session | `127.0.0.1:8080`, `3001`, `3000` | `401 Unauthorized` |
| `GET /v1/auth/me` with valid session | `127.0.0.1:3001/v1/auth/me`, `127.0.0.1:3000/v1/auth/me` | `200` (`alice@byos.local`, `role: owner`) |
| Access protected Webmail page | `http://127.0.0.1:3001/` (`GET /v1/users/me/mailboxes`) | Authorized (`200`, private mailbox `c0000000-...-0001` only) |
| Access protected Control Plane page | `http://127.0.0.1:3000/dashboard` (`GET /v1/domains`, `/v1/auth/organization-members`) | Authorized (`200`, `owner` role) |
| Access unauthorized private/org resource | `alice` -> `bob` mailbox `c0000000-...-0002` or non-owned org | `403 Forbidden` (or `404` as designed) |
| Logout | `POST /v1/auth/logout` | `204` / `200`, session invalidated in `sessions`, cookie cleared |
| Reuse invalidated session | `GET /v1/auth/me` with prior cookie | `401 Unauthorized` |
| Inspect browser storage & cookies | DevTools `localStorage` / `sessionStorage` / cookies | Zero auth tokens in storage; `HttpOnly` cookie attributes present |

- **Temporary Session Cleanup:** Each login inserts a temporary row into PostgreSQL `sessions` (and an `audit_log` entry). `POST /v1/auth/logout` revokes the session row at the end of the test, leaving zero active test sessions.
