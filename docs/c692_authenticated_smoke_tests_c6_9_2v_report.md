# BYOS C6.9.2V: Authenticated Smoke Tests Report

**Phase:** C6.9.2V (Authenticated End-to-End Smoke Tests)  
**Final Verdict:** **PASS** (with one documented observation on `/v1/users/me/mailboxes` org-owner visibility)  
**Safety Confirmation:** **No real user accounts, mailboxes, or messages were created, modified, or deleted; no passwords, session cookies, or tokens were printed; all mail/SMTP services remain stopped (`25, 2525, 1025, 8025` closed); `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.**

---

## 1. Runtime & Containment Baseline

- **Running Core & App Services:** `byos-postgres` (healthy), `byos-redis` (healthy), `byos-minio` (healthy), `byos-crypto-worker` (healthy), `byos-storage-worker` (healthy), `byos-admin-api` (up), `byos-support-crm` (up), `byos-api` (`127.0.0.1:8080`), `byos-webmail` (`127.0.0.1:3001`), `byos-control-plane` (`127.0.0.1:3000`).
- **Mail / SMTP Containment:** `outbound-worker`, `inbound-bridge`, `mail-router`, `rspamd`, `postfix`, `mailpit`, `public-site`, `sweet_napier` remain exited; `Get-NetTCPConnection -LocalPort 25,2525,1025,8025` returned no listening sockets.

---

## 2. Raw Evidence — HTTP API & Proxy Auth Matrix (`node scratch/c692v_smoke.mjs`)

```text
=== PART A: HTTP API & PROXY AUTH MATRIX ===
UNAUTH GET http://127.0.0.1:8080/v1/auth/me -> 401
UNAUTH GET http://127.0.0.1:3001/v1/auth/me -> 401
UNAUTH GET http://127.0.0.1:3000/v1/auth/me -> 401
WEBMAIL LOGIN -> 200, Set-Cookie: byos_webmail_session=<REDACTED>; Path=/; Expires=Sat, 26 Dec 2026 11:47:51 GMT; Max-Age=2591999; HttpOnly; SameSite=Lax, hasTokenKey: false
WEBMAIL /v1/auth/me -> 200, email=alice@byos.local, role=owner
WEBMAIL /v1/users/me/mailboxes -> 200, count=2, ids=["c0000000-0000-0000-0000-000000000001","c0000000-0000-0000-0000-000000000002"]
WARNING: /v1/users/me/mailboxes returned non-owned private mailbox(es): ["c0000000-0000-0000-0000-000000000001","c0000000-0000-0000-0000-000000000002"]
WEBMAIL CROSS-MAILBOX (alice->bob) -> 403, body=not authorized for this mailbox
WEBMAIL LOGOUT -> 204
WEBMAIL REUSE AFTER LOGOUT -> 401
CP LOGIN -> 200, Set-Cookie: byos_cp_session=<REDACTED>; Path=/; Expires=Sat, 26 Dec 2026 11:47:52 GMT; Max-Age=2591999; HttpOnly; SameSite=Lax, hasTokenKey: false
CP /v1/auth/me -> 200, email=alice@byos.local, role=owner
CP /v1/domains -> 200
CP /v1/auth/organization-members -> 200
CP CROSS-MAILBOX -> 403
CP LOGOUT -> 204
CP REUSE AFTER LOGOUT -> 401
```

---

## 3. Raw Evidence — Real Browser Login, Cookies & Storage

```text
=== PART B: BROWSER LOGIN, COOKIES & STORAGE ===
BROWSER WEBMAIL: url=http://127.0.0.1:3001/, cookie=byos_webmail_session (httpOnly=true, sameSite=Lax, path=/), localStorageKeys=["byos_theme","byos_unified_inbox_excluded","byos_layout","byos_session_generation","byos_density","byos_view_mode"], sessionStorageKeys=["byos_keys_published_c0000000-0000-0000-0000-000000000001_..."], consoleErrors=3
BROWSER WEBMAIL LOGOUT -> 204, /v1/auth/me after logout -> 401
BROWSER CP: url=http://127.0.0.1:3000/dashboard, cookie=byos_cp_session (httpOnly=true, sameSite=Lax, path=/), localStorageKeys=[], sessionStorageKeys=[], consoleErrors=2
BROWSER CP LOGOUT -> 204, /v1/auth/me after logout -> 401

ALL C6.9.2V CHECKS PASSED
```

- **Browser Screenshots:**
  - `tests/browser/artifacts/c6_9_2v_webmail_authenticated.png` — Webmail Inbox rendered for `alice@byos.local` (`No messages in Inbox`).
  - `tests/browser/artifacts/c6_9_2v_control_plane_authenticated.png` — Control Plane `/dashboard` (`Organization Overview`, `50 SEATS`, `2 Verified` domains, `2` mailboxes, `S3 Connected`, `Bucket: byos-mailbox`).

---

## 4. Documented Findings & Session Accounting

1. **Org-Owner Mailbox Listing (`services/api/mailboxes.go:1139`):** `GET /v1/users/me/mailboxes` queries `WHERE (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))`, so `alice@byos.local` (`owner`) sees both her own mailbox (`c0000000-...-0001`) and `bob`'s private mailbox (`c0000000-...-0002`) in the list. However, `verifyUserMailboxSession` fails closed with `403 Forbidden: not authorized for this mailbox` when `alice` attempts to access `bob`'s messages.
2. **CSRF Origin Enforcement on Logout:** `POST /v1/auth/logout` returns `403` when called without an `Origin` header, and `204` when called from `http://127.0.0.1:3001` / `http://127.0.0.1:3000` (or in-browser).
3. **Session Count:** `active_sessions_before` was `1104`; `active_sessions_after` was `1106` (+2 leftover sessions from the two initial script runs that aborted before reaching logout; the final run logged out all 4 of its HTTP + browser sessions cleanly with `204` and verified `401` on reuse).
