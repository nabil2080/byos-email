# Full Codebase Security & Bug Audit Report

## What was built
A forensic, adversarial security and architectural audit of the entire BYOS repository (`byos-email`). The audit covers backend API services (`services/api`), Webmail client (`apps/webmail`), Control Plane client (`apps/control-plane`), cryptographic boundaries, database schemas, and migration sequences. It identifies 12 distinct vulnerabilities and architectural flaws ranging from Critical Broken Object Level Authorization (BOLA) across 12 mailbox subsystems to hardcoded authentication aliases, CalDAV cryptographic boundary failures, session revocation omissions, and 2FA lockout bugs.

## Files edited
| File | Reason |
|------|--------|
| docs/full_codebase_security_and_bug_audit.md | Comprehensive forensic security and bug audit report detailing all codebase vulnerabilities and architectural flaws |

## Vulnerability Severity Matrix

| ID | Title | Severity | Impact Area | Primary Affected Files |
|---|---|---|---|---|
| SEC-01 | Systemic Horizontal Privilege Escalation (BOLA) across 12 Mailbox Resource Subsystems | Critical | Authorization / Data Privacy | `services/api/messages.go`, `drafts.go`, `contacts.go`, `attachments.go`, `folders_labels.go`, `filters.go`, `rules.go`, `autoreply.go`, `snooze.go`, `devices.go`, `bridge.go`, `tracking.go` |
| SEC-02 | Hardcoded Production Authentication Alias / Testing Backdoor | Critical | Authentication | `services/api/auth.go:493` |
| SEC-03 | CalDAV Zero-Knowledge Boundary Breach via Deterministic Fallback Key & Cross-User Cryptographic Failure | High | Cryptography / Privacy | `services/api/caldav.go:411-418, 1503, 1642` |
| SEC-04 | CalDAV Basic Auth Brute-Force Rate Limit Absence & 2-Step Verification (2FA) Bypass | High | Authentication / MFA | `services/api/caldav.go:564-620` |
| SEC-05 | Incomplete Session Invalidation on Password Change (Omission of Redis Cache Eviction) | High | Session Management | `services/api/recovery.go:542-550` vs `services/api/sessions.go:164-173` |
| SEC-06 | Unrestricted Free Tier / Organization Seat & Resource Capacity Escalation | High | Business Logic / Billing | `services/api/billing.go:374-406` |
| SEC-07 | Spoofable IP Rate Limiting via `X-Forwarded-For` and IPv6 Address Splitting Bug | Medium | Rate Limiting / DoS | `services/api/auth.go:59-69, 430`, `services/api/passkeys.go:71-75`, `services/api/recovery.go:62-66` |
| SEC-08 | Control Plane FIDO2 / Passkey 2FA Permanent User Lockout | Medium | User Interface / MFA | `apps/control-plane/src/routes/login.tsx:185-230, 350-401` |
| SEC-09 | Sensitive Impersonation Session Token Exposure in URL Query Parameters | Medium | Credential Exposure | `apps/webmail/src/App.tsx:2700-2704` |
| SEC-10 | Duplicate and Colliding Database Migrations | Low | Schema Integrity | `infra/postgres/init/021_mailbox_invitations.sql`, `021_recovery_challenges.sql`, `023_mailbox_invitations.sql` |
| SEC-11 | Overly Permissive Content Security Policy (`connect-src *`) | Low | Defense-in-Depth | `services/api/security.go:55` |
| SEC-12 | Unrestricted Mailbox Creation by Regular Members | Medium | Access Control / Quota | `services/api/mailboxes.go:132, 177` |

---

## Detailed Vulnerability Analyses

### 1. SEC-01: Systemic Horizontal Privilege Escalation (BOLA) Across 12 Mailbox Resource Subsystems
- **Severity:** Critical (CVSS 8.8 - High Impact on Confidentiality & Integrity)
- **CWE:** CWE-639: Authorization Bypass Through User-Controlled Key; CWE-284: Improper Access Control
- **Location:**
  - `services/api/messages.go:99, 334, 483, 703, 974`
  - `services/api/drafts.go:79-82`
  - `services/api/contacts.go:88`
  - `services/api/attachments.go:72-74`
  - `services/api/folders_labels.go:65`
  - `services/api/filters.go:76, 298`
  - `services/api/rules.go:73`
  - `services/api/autoreply.go:60-73`
  - `services/api/snooze.go:59`
  - `services/api/devices.go:106`
  - `services/api/bridge.go:277`
  - `services/api/tracking.go:147`
- **Analysis:**
  In all 12 listed subsystems, the database query authenticates ownership solely by matching the user's organization against the mailbox's organization (`WHERE u.org_id = m.org_id` or `userOrgID == mailboxOrgID`). The queries fail to verify that `m.user_id = u.id` or that `u.role IN ('admin', 'owner')`.
  For example, in `services/api/messages.go:99`:
  ```go
  var authorized string
  if err := conn.QueryRow(ctx, `SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`, mailboxID, userID).Scan(&authorized); err != nil {
      http.Error(w, "forbidden", http.StatusForbidden)
      return
  }
  ```
  And in `services/api/drafts.go:74-82`:
  ```go
  err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
  if mailboxOrgID != userOrgID {
      http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
      return "", "", "", "", false
  }
  ```
  And in `services/api/snooze.go:58-61`:
  ```go
  SELECT EXISTS (
      SELECT 1 FROM mailboxes m
      JOIN users u ON (u.id = m.user_id OR u.org_id = m.org_id)
      WHERE m.id = $1 AND u.id = $2 AND m.is_active = true
  )
  ```
  By contrast, `services/api/aliases.go:180` and `services/api/calendar.go:570` implement the correct check:
  `WHERE (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))`
- **Root Cause & Forensic Timeline:**
  Early repository milestones treated mailboxes as organization-shared entities. In `services/api/drafts_test.go:390`, a legacy test explicitly documents this obsolete assumption:
  ```go
  func TestDraftSameOrgMemberAllowed(t *testing.T) {
      // Documents the established mailbox access model: any active same-org
      // member may use the mailbox (cf. mailboxGetHandler org check).
  ```
  However, Migration 058 (`058_remove_org_managed_mailboxes.sql`) formally deprecated organization-managed shared mailboxes, mandating that all mailboxes be private zero-knowledge personal accounts (`mailboxes.mode = 'private'`).
  While newer subsystems such as `calendar.go` (`resolveCalendarMailboxOwner`) and `aliases.go` implemented strict owner isolation:
  `WHERE (m.user_id = $1 OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner')))`
  the legacy endpoints across messages, drafts, contacts, attachments, folders, filters, rules, autoreply, snooze, devices, bridge, and tracking were never upgraded to enforce `m.user_id = u.id`. The obsolete tests (`TestDraftSameOrgMemberAllowed`) actively codified this horizontal privilege escalation into the test suite.
- **Consequence:**
  Any authenticated regular member of an organization can:
  1. Read message metadata, subject lines, participants, thread graphs, and encrypted storage object references of all other employees (including executive and HR mailboxes).
  2. Read, create, overwrite, or delete draft emails belonging to other users.
  3. Extract, modify, or delete all personal address book contacts.
  4. Access, list, download, or delete attachments across all organization mailboxes.
  5. Delete folders, apply labels, snooze emails, and mark messages read/unread for other mailboxes.
  6. Generate bridge credentials to connect external clients to export ciphertext bundles from arbitrary mailboxes.
- **Recommended Remediation:**
  Refactor all mailbox authorization queries to enforce mailbox ownership or administrative delegation:
  ```sql
  WHERE m.id = $1 AND u.id = $2 AND u.is_active = true
    AND (m.user_id = u.id OR u.role IN ('admin', 'owner'))
  ```

---

### 2. SEC-02: Hardcoded Production Authentication Alias / Testing Backdoor
- **Severity:** Critical (CVSS 9.1 - High Impact on Authentication Integrity)
- **CWE:** CWE-798: Use of Hard-coded Credentials; CWE-912: Hidden Functionality
- **Location:** `services/api/auth.go:493`
- **Analysis:**
  Inside `loginHandler`, the SQL query that retrieves user credentials contains an explicit testing alias:
  ```sql
  WHERE LOWER(u.email) = $1 
     OR LOWER(m.local_part || '@' || d.name) = $1
     OR LOWER(a.local_part || '@' || ad.name) = $1
     OR ($1 = 'admin@testorg.byos' AND LOWER(u.email) = 'admin@demo.local')
  ORDER BY (LOWER(u.email) = $1) DESC
  LIMIT 1
  ```
- **Consequence:**
  In a production environment, logging in with `admin@testorg.byos` targets the `admin@demo.local` account. Hardcoded test email mappings in production database queries create unmaintained backdoors and unpredictable authentication behaviors.
- **Recommended Remediation:**
  Remove `OR ($1 = 'admin@testorg.byos' AND LOWER(u.email) = 'admin@demo.local')` completely. Test suites must register their own test accounts dynamically.

---

### 3. SEC-03: CalDAV Zero-Knowledge Boundary Breach via Deterministic Fallback Key & Cross-User Cryptographic Failure
- **Severity:** High (CVSS 7.5 - High Impact on Confidentiality)
- **CWE:** CWE-321: Use of Hard-coded Cryptographic Key; CWE-327: Use of a Broken or Risky Cryptographic Algorithm
- **Location:** `services/api/caldav.go:411-418, 1503, 1642`
- **Analysis:**
  1. `getEffectiveMailboxKey` in `caldav.go` specifies:
     ```go
     func getEffectiveMailboxKey(mailboxSk []byte, mailboxID string) []byte {
         if len(mailboxSk) == 32 {
             return mailboxSk
         }
         // Deterministic fallback key for tests/unwrapped environments
         h := sha256.Sum256([]byte("byos-caldav-deterministic-key:" + mailboxID))
         return h[:]
     }
     ```
     When CalDAV requests authenticate via session tokens (Bearer tokens / cookies) where the client cannot send the user's unwrapped private key to the server, `user.MailboxSk` is nil. The server falls back to computing `sha256("byos-caldav-deterministic-key:" + mailboxID)`. Any event created under this flow is encrypted with a server-derivable static key, violating Section 12/15 Zero-Knowledge guarantees.
  2. In shared calendar scenarios, when User B modifies an event on User A's shared calendar via CalDAV:
     ```go
     encPayload, err := encryptCalendarEventPayloadGo(user.MailboxSk, cal.MailboxID, pt)
     ```
     The payload is encrypted using User B's mailbox key with User A's `cal.MailboxID` in the AAD. When User A opens Webmail, User A attempts decryption using User A's mailbox key, causing AEAD authentication tag failure. The event renders as `"(Encrypted Event)"` and cannot be decrypted by the calendar owner.
- **Recommended Remediation:**
  1. CalDAV must mandate dedicated per-client App Passwords that wrap/unwrap the user's mailbox key, or require Webmail-synchronized key wrapping rather than server-side static fallback derivation.
  2. Implement per-calendar symmetrical shared keys wrapped with recipient public keys (as designed in Webmail calendar sharing), rather than encrypting directly with the actor's personal mailbox private key.

---

### 4. SEC-04: CalDAV Basic Auth Brute-Force Rate Limit Absence & 2-Step Verification (2FA) Bypass
- **Severity:** High (CVSS 7.5 - High Impact on Authentication Security)
- **CWE:** CWE-307: Improper Restriction of Excessive Authentication Attempts; CWE-308: Use of Single-factor Authentication
- **Location:** `services/api/caldav.go:564-620`
- **Analysis:**
  1. Unlike `loginHandler` in `auth.go` (which enforces a Redis rate limit of 5 failed attempts per minute per IP and email), `authenticateCalDav` performs zero rate limiting on failed HTTP Basic authentication attempts.
  2. `authenticateCalDav` checks password validity via `verifyPassword(passwordHash, password)` and directly returns a valid session without checking `two_factor_enabled` or verifying whether the account has enrolled TOTP or Passkey factors.
- **Consequence:**
  Attackers can execute unthrottled brute-force dictionary attacks against user passwords over `/dav/...`. Additionally, an attacker with a compromised password can access calendars and mailbox data via CalDAV without being prompted for 2FA, completely bypassing multi-factor authentication.
- **Recommended Remediation:**
  1. Add Redis-backed rate limiting to `authenticateCalDav` mirroring `auth.go`.
  2. Require CalDAV clients to use Application-Specific Passwords generated from within an authenticated 2FA session, and reject primary account passwords if 2FA is active.

---

### 5. SEC-05: Incomplete Session Invalidation on Password Change (Omission of Redis Cache Eviction)
- **Severity:** High (CVSS 7.4 - High Impact on Session Integrity)
- **CWE:** CWE-613: Insufficient Session Expiration
- **Location:** `services/api/recovery.go:542-550` vs `services/api/sessions.go:164-173`
- **Analysis:**
  In `services/api/sessions.go:revokeOtherSessionsHandler`, when sessions are revoked, both the PostgreSQL database and the Redis cache are updated:
  ```go
  // Purge in Redis (Safeguard 1)
  if redisClient != nil {
      ctx2 := context.Background()
      for _, h := range hashesToRevoke {
          hexHash := hex.EncodeToString(h)
          redisClient.Del(ctx2, "auth:session:"+hexHash)
          redisClient.Del(ctx2, "session:"+hexHash)
      }
      redisClient.Del(ctx2, "auth:user_sessions:"+userID)
  }
  ```
  However, in `services/api/recovery.go:changePasswordHandler`:
  ```go
  if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash != $2 AND revoked_at IS NULL`, userID, currentHash); err != nil {
      http.Error(w, "failed to rotate sessions", http.StatusInternalServerError)
      return
  }
  ```
  It executes the database update but completely omits purging the Redis keys.
- **Consequence:**
  If session validation is performed by caching layers or edge gateways via Redis (`auth:session:<hash>`), revoked sessions remain valid until their Redis TTL expires, allowing stolen session tokens to persist after a password reset.
- **Recommended Remediation:**
  Extract session revocation logic into a shared helper function `revokeUserSessions(ctx, conn, redisClient, userID, preserveHash)` and call it uniformly in both `sessions.go` and `recovery.go`.

---

### 6. SEC-06: Unrestricted Free Tier / Organization Seat & Resource Capacity Escalation
- **Severity:** High (CVSS 7.1 - High Impact on Integrity & Billing)
- **CWE:** CWE-285: Improper Authorization; CWE-840: Business Logic Errors
- **Location:** `services/api/billing.go:374-406`
- **Analysis:**
  In `billingHandler` (`POST /v1/organizations/{org_id}/billing/plan`):
  ```go
  _, err := conn.Exec(ctx, `UPDATE organizations SET seat_count=$1, billing_cycle=$2, updated_at=now() WHERE id=$3`, targetSeats, cycle, orgID)
  ```
  The endpoint updates `seat_count` directly in the database up to 10,000 seats without integrating with a payment processor (Stripe, payment webhook, invoice verification).
- **Consequence:**
  Any organization administrator can grant their organization enterprise-tier capacity (10,000 mailboxes, 10,000 domains) without payment or authorization.
- **Recommended Remediation:**
  Do not update `organizations.seat_count` directly on client request. Issue a Stripe Checkout Session or payment intent, and only increment `seat_count` upon receiving an authenticated payment webhook (`invoice.paid` / `checkout.session.completed`).

---

### 7. SEC-07: Spoofable IP Rate Limiting via `X-Forwarded-For` and IPv6 Address Splitting Bug
- **Severity:** Medium (CVSS 5.3 - Medium Impact on Availability / Rate Limiting)
- **CWE:** CWE-345: Insufficient Verification of Data Authenticity; CWE-1286: Improper Input Validation
- **Location:**
  - `services/api/auth.go:59-69, 430`
  - `services/api/passkeys.go:71-75`
  - `services/api/recovery.go:62-66`
- **Analysis:**
  Across authentication, passkey verification, and account recovery:
  ```go
  ip := r.RemoteAddr
  if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
      ip = strings.Split(fwd, ",")[0]
  }
  ip = strings.TrimSpace(strings.Split(ip, ":")[0])
  ```
  1. `X-Forwarded-For` is accepted unconditionally from any caller. An attacker can set arbitrary values (`X-Forwarded-For: 1.1.1.1`, `1.1.1.2`, ...) to bypass per-IP rate limits entirely.
  2. `strings.Split(ip, ":")[0]` truncates IPv6 addresses. An IPv6 address like `[::1]:port` or `[2001:db8::1]:port` is split on `:`, returning `"["`. All IPv6 clients collapse into a single Redis key (`auth:login:ip:[`), leading to shared rate limit exhaustion and denial of service.
- **Recommended Remediation:**
  Use Go's `net.SplitHostPort(r.RemoteAddr)` for host/port extraction. Only evaluate `X-Forwarded-For` if `r.RemoteAddr` matches a configured trusted reverse proxy IP address.

---

### 8. SEC-08: Control Plane FIDO2 / Passkey 2FA Permanent User Lockout
- **Severity:** Medium (CVSS 6.5 - Medium Impact on Availability & UX)
- **CWE:** CWE-287: Improper Authentication; CWE-308: Use of Single-factor Authentication
- **Location:** `apps/control-plane/src/routes/login.tsx:185-230, 350-401`
- **Analysis:**
  When `loginHandler` indicates that 2FA is required (`two_factor_required: true`), the Control Plane login view displays a challenge modal. However, the modal is hardcoded to render only a 6-digit numeric input:
  ```tsx
  <input
    type="text"
    inputmode="numeric"
    maxlength="6"
    value={twoFactorCode()}
    onInput={(e) => setTwoFactorCode(e.currentTarget.value.replace(/[^0-9]/g, ""))}
    ...
  />
  ```
  The submission handler `handleVerify2FA` requires a 6-digit code:
  ```ts
  const code = twoFactorCode().trim();
  if (!challenge || !code) {
    setError("Please enter your 6-digit verification code.");
    return;
  }
  ```
  No WebAuthn API invocation (`navigator.credentials.get`) or Passkey prompt is implemented in the Control Plane challenge UI.
- **Consequence:**
  If an administrator configures a Passkey/FIDO2 hardware key as their second factor without having TOTP or email backup enabled, they cannot satisfy the second factor in the Control Plane and are permanently locked out of password sign-in.
- **Recommended Remediation:**
  Implement WebAuthn assertion triggering in `login.tsx` when `challenge.methods` contains `"passkey"`, matching the flow implemented in Webmail.

---

### 9. SEC-09: Sensitive Impersonation Session Token Exposure in URL Query Parameters
- **Severity:** Medium (CVSS 5.3 - Medium Impact on Credential Exposure)
- **CWE:** CWE-598: Use of GET Request with Sensitive Data in Query String; CWE-200: Exposure of Sensitive Information
- **Location:** `apps/webmail/src/App.tsx:2700-2704`
- **Analysis:**
  In `App.tsx`:
  ```ts
  if (urlParams.get("impersonate") === "1") {
    setIsImpersonating(true);
    setImpersonateMailboxId(urlParams.get("mailbox_id"));
    setImpersonateEmail(urlParams.get("email"));
    const token = urlParams.get("session_token");
    if (token) {
      sessionStorage.setItem("byos_impersonation_token", token);
    }
  }
  ```
  The token is read from `?session_token=...` into `sessionStorage`, but the URL query string is not sanitized or removed from `window.location`.
- **Consequence:**
  The sensitive session token remains visible in the browser address bar, is stored in browser history and logs, and is transmitted via the `Referer` header to third-party assets or external links clicked within the application.
- **Recommended Remediation:**
  Sanitize the URL immediately after reading the token using `window.history.replaceState({}, document.title, window.location.pathname)`.

---

### 10. SEC-10: Duplicate and Colliding Database Migrations
- **Severity:** Low (CVSS 3.1 - Low Impact on Schema Consistency)
- **CWE:** CWE-710: Improper Adherence to Coding Standards
- **Location:**
  - `infra/postgres/init/021_mailbox_invitations.sql`
  - `infra/postgres/init/021_recovery_challenges.sql`
  - `infra/postgres/init/023_mailbox_invitations.sql`
- **Analysis:**
  1. `021_mailbox_invitations.sql` and `021_recovery_challenges.sql` share migration sequence number `021_`.
  2. `021_mailbox_invitations.sql` and `023_mailbox_invitations.sql` are identical duplicate files.
- **Consequence:**
  Lexicographical execution in Docker entrypoint scripts can lead to race conditions or non-deterministic schema initialization if container volumes are re-initialized.
- **Recommended Remediation:**
  Remove `023_mailbox_invitations.sql` and rename `021_recovery_challenges.sql` to a unique sequence number.

---

### 11. SEC-11: Overly Permissive Content Security Policy (`connect-src *`)
- **Severity:** Low (Defense-in-Depth)
- **CWE:** CWE-1021: Improper Restriction of Rendered UI Layers or External Endpoints
- **Location:** `services/api/security.go:55`
- **Analysis:**
  `withSecurityHeaders` configures CSP:
  ```go
  w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: https:; connect-src 'self' http: https:;")
  ```
  Setting `connect-src 'self' http: https:;` allows connections to any external domain via `fetch` or `XMLHttpRequest`.
- **Consequence:**
  If an XSS vulnerability occurs in email rendering, the attacker can exfiltrate stolen plaintexts or keys to any external command-and-control server without CSP blocking the network request.
- **Recommended Remediation:**
  Restrict `connect-src` to `'self'` and explicitly allowlisted storage endpoints.

---

### 12. SEC-12: Unrestricted Mailbox Creation by Regular Members
- **Severity:** Medium (CVSS 5.3 - Medium Impact on Resource Management)
- **CWE:** CWE-285: Improper Authorization
- **Location:** `services/api/mailboxes.go:132, 177`
- **Analysis:**
  In `POST /v1/organizations/{org_id}/mailboxes`:
  ```go
  var memberID string
  err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
  if err != nil {
      http.Error(w, "not authorized for this organization", http.StatusForbidden)
      return
  }
  ```
  The endpoint verifies that the user belongs to the organization, but does not check `isAdmin(userID, orgID, conn)` or `role IN ('admin', 'owner')`.
- **Consequence:**
  Any standard employee can create arbitrary mailboxes under the organization's validated domains, exhausting the organization's seat allocation without administrative consent.
- **Recommended Remediation:**
  Add `if !isAdmin(userID, orgID, conn) { http.Error(w, "admin role required", http.StatusForbidden); return }`.

---

## Raw evidence

Database calendar events count verification:
```
 count 
-------
     3
(1 row)
```

Webmail test suite execution output:
```
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 39 passed, 0 failed

Running MIME Serialization Tests...
MIME SERIALIZATION TESTS: 18 passed, 0 failed

Running End-to-End Key Discovery Tests...
KEY DIRECTORY TESTS: 5 passed, 0 failed

Running Focused Inbox Classifier Tests...
FOCUSED INBOX CLASSIFIER TESTS: 30 passed, 0 failed

Running Historical Key Reactivation & Preflight Tests...
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions & Interoperability Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

Running Calendar External Invitations & Fallback Delivery Tests...
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 7 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 409 passed, 0 failed
```

Duplicate migration file comparison output (`fc.exe`):
```
Comparing files INFRA\POSTGRES\INIT\021_mailbox_invitations.sql and INFRA\POSTGRES\INIT\023_MAILBOX_INVITATIONS.SQL
***** INFRA\POSTGRES\INIT\021_mailbox_invitations.sql
-- Migration 021: Mailbox Invitations, Multi-Key Storage & Lifecycle Status
CREATE TABLE IF NOT EXISTS account_invitations (
***** INFRA\POSTGRES\INIT\023_MAILBOX_INVITATIONS.SQL
-- Migration 023: Mailbox Invitations, Multi-Key Storage & Lifecycle Status
CREATE TABLE IF NOT EXISTS account_invitations (
*****
```

---

## Manual browser verification
This audit is an architectural and vulnerability assessment rather than a functional UI feature deployment. Runtime verification of these vulnerabilities is listed below:

- **SEC-01 (BOLA across Mailboxes):** UNTESTED in browser; evidenced by static code audit of `services/api/messages.go:99`, `drafts.go:79-82`, `contacts.go:88`, `attachments.go:72-74`. Manual validation requires logging into Webmail as Bob (`bob@byos.local`), issuing a GET request to `/v1/mailboxes/<alice_mailbox_id>/messages` with Bob's session cookie, and observing that Alice's message metadata returns with HTTP 200.
- **SEC-02 (Hardcoded Auth Backdoor):** UNTESTED in browser; evidenced by inspection of `services/api/auth.go:493`. Manual validation requires submitting `POST /v1/auth/login` with email `admin@testorg.byos` and `admin@demo.local`'s password, observing successful authentication.
- **SEC-03 (CalDAV Key Boundary Breach):** UNTESTED in browser; evidenced by inspection of `services/api/caldav.go:411-418`. Manual validation requires creating an event via CalDAV with session authentication and inspecting `calendar_events.encrypted_payload` in PostgreSQL to observe deterministic key encryption.
- **SEC-04 (CalDAV Rate Limit & 2FA Bypass):** UNTESTED in browser; evidenced by inspection of `services/api/caldav.go:564-620`. Manual validation requires issuing 20 consecutive HTTP Basic auth requests to `/dav/principals` with invalid credentials and observing no HTTP 429 response.
- **SEC-05 (Session Eviction Omission):** UNTESTED in browser; evidenced by comparing `recovery.go:547` with `sessions.go:164-173`. Manual validation requires calling `/v1/auth/change-password` and checking that Redis key `auth:session:<hash>` still exists.
- **SEC-06 (Seat Escalation):** UNTESTED in browser; evidenced by inspection of `services/api/billing.go:374`. Manual validation requires calling `POST /v1/organizations/<id>/billing/plan` with `{"seats": 500}` and observing `organizations.seat_count = 500` without payment.
- **SEC-07 (IP Rate Limit Spoofing & IPv6 Splitting):** UNTESTED in browser; evidenced by inspection of `services/api/auth.go:59-69`. Manual validation requires sending requests with spoofed `X-Forwarded-For` headers to evaluate bypass of the 5/min limit.
- **SEC-08 (Control Plane Passkey 2FA Lockout):** UNTESTED in browser; evidenced by inspection of `apps/control-plane/src/routes/login.tsx:350-401`. Manual validation requires enrolling a passkey on an admin user, attempting login on the Control Plane, and observing that no WebAuthn prompt is displayed.
- **SEC-09 (Session Token in URL):** UNTESTED in browser; evidenced by inspection of `apps/webmail/src/App.tsx:2700-2704`. Manual validation requires loading `http://localhost:3001/?impersonate=1&session_token=test_tok` and inspecting `window.location.search`.
- **SEC-10 (Duplicate Migrations):** UNTESTED in browser; evidenced by file system directory listing and `fc.exe` comparison.
- **SEC-11 (Permissive CSP):** UNTESTED in browser; evidenced by inspection of `services/api/security.go:55`.
- **SEC-12 (Unrestricted Mailbox Creation):** UNTESTED in browser; evidenced by inspection of `services/api/mailboxes.go:132`.

---

## What did not work or is untested
- Active exploit weaponization was deliberately omitted in accordance with security guidelines and AGENTS.md rules. All findings are documented forensically with root-cause source code references.
- Remediation patches are UNTESTED because this task is strictly an audit and inventory report; no production backend source code modifications were executed during this turn.

---

## Test suite output

Webmail unit test suite (`npm.cmd --prefix apps/webmail test`):
```
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 39 passed, 0 failed

Running MIME Serialization Tests...
MIME SERIALIZATION TESTS: 18 passed, 0 failed

Running End-to-End Key Discovery Tests...
KEY DIRECTORY TESTS: 5 passed, 0 failed

Running Focused Inbox Classifier Tests...
FOCUSED INBOX CLASSIFIER TESTS: 30 passed, 0 failed

Running Historical Key Reactivation & Preflight Tests...
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed

Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Calendar Recurrence Exceptions & Interoperability Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed

Running Calendar External Invitations & Fallback Delivery Tests...
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 7 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 409 passed, 0 failed
```
