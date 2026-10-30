# BYOS Security Architecture Audit: Control Panel, Webmail & Account Recovery

## Executive Summary

This document presents a comprehensive, read-only architectural and security audit of the BYOS platform across the **Public Website**, **Control Panel**, **Webmail**, backend API services (`services/api`), and underlying cryptographic subsystems (`byos_crypto_core` WASM and client-side implementations). 

The audit establishes the current state of authentication methods, mailbox provisioning, identity recovery, cryptographic key custody, password management, and administrative boundaries. It identifies existing architectural duplication, security boundaries, and implementation gaps to guide the planned refinement of the password-change and forgotten-password workflows.

---

# Section A: Current Architecture

```
 +---------------------------------------------------------------------------------------------------------+
 |                                            CLIENT TIER                                                  |
 +-------------------------------------+-----------------------------------+-------------------------------+
 |           Public Website            |           Control Panel           |            Webmail            |
 |         (apps/public-site)          |        (apps/control-plane)       |        (apps/webmail)         |
 |        Port 4321 / Astro SSG        |      Port 3000 / SolidJS SPA      |    Port 3001 / SolidJS SPA    |
 |                                     |                                   |                               |
 | - Marketing, product docs, pricing  | - Org registration & settings     | - Direct mailbox login        |
 | - Redirects login -> CP:3000/login  | - Domain DNS verification         | - Invitation setup ceremony   |
 | - Redirects signup -> CP:3000/signup| - Mailbox & admin provisioning    | - Message read/compose/crypto |
 |                                     | - Billing, seats, storage backend | - Personal settings & 2FA     |
 |                                     | - Admin active sessions audit     | - Password change & recovery  |
 |                                     | - Terminate user & delete mailbox | - Unsealed keys in memory     |
 +-------------------------------------+-----------------+-----------------+---------------+---------------+
                                                         |                                 |
                                             Credentials | Cookie: byos_cp_session         | Credentials: include
                                             include     | Origin: :3000                   | Cookie: byos_webmail_session
                                                         |                                 | Origin: :3001
                                                         v                                 v
 +---------------------------------------------------------------------------------------------------------+
 |                                          SHARED API SERVICE                                             |
 |                                            (services/api)                                               |
 |                                      Golang HTTP Router (Port 8080)                                     |
 |                                                                                                         |
 |  [Authentication Engine]        [2FA / TOTP / Passkeys]         [Recovery & Password Reset]              |
 |  - Argon2id password hash       - RFC 6238 TOTP engine          - Section 15 Ed25519 verifiers          |
 |  - SHA-256 session token hashes - WebAuthn FIDO2 credentials    - Proton-style Tier 1 OTP reset         |
 |  - Rate limiter (5/min, Redis)  - auth_challenges table         - Key archiving (previous_wrapped_sk)   |
 |                                                                                                         |
 |  [RBAC & Org Administration]    [Mailbox & Provisioning]        [Cryptographic Directory]               |
 |  - Owner/Admin/Member hierarchy - account_invitations (tokens)  - Public Key lookup & history           |
 |  - Cascading soft deletions     - Mailbox metadata & aliases    - Post-Quantum X-Wing & Ed25519 keys    |
 |  - Impersonation forbidden (403)- Zero-Knowledge private roots  - Message storage & chunked attachments |
 +-------------------------------------------------------+-------------------------------------------------+
                                                         |
                                                         v
 +---------------------------------------------------------------------------------------------------------+
 |                                           STORAGE TIER                                                  |
 |                                                                                                         |
 |  +-------------------------------------------------+   +---------------------------------------------+  |
 |  |          PostgreSQL Database (byos)             |   |                 Redis Cache                 |  |
 |  | - users (password_hash, 2fa, recovery contacts) |   | - Brute-force login rate limits (5/min)     |  |
 |  | - sessions (token_hash, IP, user_agent, expiry) |   | - Recovery rate limits (5/min per IP/scope) |  |
 |  | - user_passkeys (WebAuthn credentials)          |   | - Token revocation cache                    |  |
 |  | - auth_challenges (login 2fa & recovery otps)   |   | - Message queue & outbound rate limits      |  |
 |  | - mailboxes (wrapped_sk_user, mailbox_pk)       |   +---------------------------------------------+  |
 |  | - account_invitations (token_hash, status)      |                                                    |
 |  | - mailbox_settings (sealed recovery phrase)     |                                                    |
 |  +-------------------------------------------------+                                                    |
 +---------------------------------------------------------------------------------------------------------+
```

### Application Model Adherence & Deviations
1. **Public Website (`apps/public-site`):**
   - Strictly conforms to boundaries: Acts purely as marketing and documentation.
   - Both `/login` (`apps/public-site/src/pages/login.astro`) and `/signup` (`apps/public-site/src/pages/signup.astro`) issue 302 HTTP redirects to Control Panel (`http://localhost:3000/login` and `http://localhost:3000/signup`).
2. **Control Panel (`apps/control-plane`):**
   - Intended for Organization Owners and Administrators.
   - Enforces a client-side role check upon login (`apps/control-plane/src/routes/login.tsx#L58-L64`): If authenticated user has role `member`, Control Panel redirects them directly to Webmail (`http://127.0.0.1:3001`).
   - However, Control Panel currently duplicates the personal user security controls (Account Password Change, Active Sessions, 2FA, Recovery Contacts, Passkeys) at `/dashboard/security`. While administrators require credential management for their own admin login, employee mailbox owners never access this screen.
3. **Webmail (`apps/webmail`):**
   - Primary application for employee mailbox users.
   - Manages personal mailbox settings, email crypto, passkeys, TOTP, and password change/recovery.
   - Holds unsealed mailbox keys in browser memory (`mailboxKey` signal) and IndexedDB (`persistent_session.ts`).

---

# Section B: Existing Security Inventory

| Feature / Method | Enrolled Where | Managed Where | Verified Where | API Endpoints | Database Tables & Fields | Availability | Shared Between CP & Webmail? | Bypasses / Boundary Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Email + Password** | CP `/signup` or Webmail `/setup-account` | CP `/dashboard/security` & Webmail `SecurityTab.tsx` | Backend `auth.go` (`verifyPassword`) | `POST /v1/auth/login`<br>`POST /v1/auth/register`<br>`POST /v1/auth/verify-password`<br>`POST /v1/auth/change-password` | `users.password_hash`<br>`users.email` | Admins & Employees | Yes (single user identity store) | Argon2id ($argon2id$v=19$m=65536,t=3,p=2). Webmail hashes client-side before transmission. |
| **Google Auth (SSO)** | **NOT IMPLEMENTED** | N/A | N/A | None | None | None | N/A | Google OAuth exists **only** for Google Drive storage integration (`storage.go`) and Gmail mailbox import (`oauth_import.ts`), not account login. |
| **Microsoft Auth (SSO)** | **NOT IMPLEMENTED** | N/A | N/A | None | None | None | N/A | No Microsoft OAuth SSO exists. Only IMAP/Outlook migration import. |
| **Two-Factor Authentication (2FA)** | Webmail `/setup-account`, CP `/dashboard/security`, Webmail `SecurityTab.tsx` | CP `/dashboard/security` & Webmail `SecurityTab.tsx` | Backend `auth.go` (`loginHandler`) & `two_factor.go` | `GET /v1/auth/2fa/status`<br>`POST /v1/auth/2fa/verify-login`<br>`POST /v1/auth/2fa/send-code` | `users.two_factor_enabled`<br>`auth_challenges` table | Admins & Employees | Yes | Can use TOTP, SMS phone OTP, or recovery email OTP. Migration 031 sets default enabled for new accounts. |
| **TOTP Authenticator** | CP `/dashboard/security` & Webmail `SecurityTab.tsx` | CP `/dashboard/security` & Webmail `SecurityTab.tsx` | Backend `two_factor.go` (`validateTOTP`) | `POST /v1/auth/2fa/totp/setup`<br>`POST /v1/auth/2fa/totp/verify`<br>`POST /v1/auth/2fa/totp/disable` | `users.totp_secret` (TEXT, 20-byte base32) | Admins & Employees | Yes | RFC 6238 standard TOTP with ±30s clock drift tolerance. Disabling requires current account password. |
| **WebAuthn / Passkeys** | CP `/dashboard/security` & Webmail `SecurityTab.tsx` | CP `/dashboard/security` & Webmail `SecurityTab.tsx` | Backend `passkeys.go` (`passkeyLoginHandler`) | `GET /v1/auth/passkeys/register-options`<br>`POST /v1/auth/passkeys/register`<br>`GET /v1/auth/passkeys/login-options`<br>`POST /v1/auth/passkeys/login`<br>`DELETE /v1/auth/passkeys/{id}` | `user_passkeys`<br>(`credential_id`, `public_key`, `counter`, `device_name`) | Admins & Employees | Yes | **Critical Distinction:** Passkeys authenticate the user to the server to issue an HTTP session cookie/token. Passkeys **do not** derive or unlock mailbox private encryption keys. (Webmail stores unsealed keys in `localStorage` under `byos_passkey_vault_<credId>` as a workaround). |
| **Authentication Backup Codes** | **NOT IMPLEMENTED** | N/A | N/A | None | None | None | N/A | No static 8-digit or 10-pack emergency recovery codes exist. Dynamic 6-digit OTPs are used instead. |
| **Active Sessions** | Auto-issued on login/register/claim | CP `/dashboard/security` & Webmail `SecurityTab.tsx` | Backend `auth.go` (`getSessionUserID`) | `GET /v1/auth/sessions`<br>`POST /v1/auth/sessions/revoke-others`<br>`POST /v1/auth/logout` | `sessions`<br>(`token_hash`, `expires_at`, `revoked_at`, `ip_address`, `user_agent`, `last_active_at`) | Admins & Employees | Yes | 32-byte cryptographically secure tokens. Stored strictly as SHA-256 `token_hash`. Partitioned cookies: `byos_cp_session` and `byos_webmail_session`. |
| **Login Notifications** | **NOT IMPLEMENTED** | N/A | N/A | None | `audit_log` table (logs `login` action only) | None | N/A | No outbound email or in-app alert is dispatched when a user logs in from an unrecognized device or IP. |
| **New-Device Authentication** | Backend `devices.go` (`deviceEnrollHandler`) | None in UI | Backend `devices.go` | `POST /v1/auth/device-enroll`<br>`POST /v1/auth/device-revoke` | `devices`<br>`device_mailbox_access` | Available in API, **uncalled by frontends** | N/A | Webmail uses client-side IndexedDB persistent session sealing (`persistent_session.ts`) instead of the server-side device enrollment endpoints. |
| **Rate Limiting & Lockout** | Auto-enforced in Redis | Redis cache TTL | Backend `auth.go` & `recovery.go` (`rateLuaScript`) | Enforced on `/login`, `/recovery-challenge`, `/recovery-verify` | Redis keys:<br>`auth:login:ip:*`<br>`auth:login:email:*`<br>`auth:recovery:*` | Global | Yes | Fails **closed**: If Redis is unavailable, requests return 503 Service Unavailable to prevent brute-force attacks during outages. Limits: 5 attempts/minute per IP and email. |
| **Session Reauthentication** | Modal triggers in CP & Webmail | In-dialog prompts | Backend `auth.go` (`verifyPasswordHandler`) | `POST /v1/auth/verify-password` | Evaluates `users.password_hash` | Admins & Employees | Yes | Verifies current password before enabling sensitive actions (revealing recovery phrase, changing password). |

---

# Section C: Current Password-Change Flow

### 1. Control Panel Flow (`apps/control-plane/src/routes/dashboard/security.tsx`)
```
[User clicks "Change Password"]
             │
             ├── Mode 1: Standard Change ──> Inputs: Current Password, New Password, Confirm New Password
             │                                   │
             │                                   ├── POST /v1/auth/verify-password (checks current password)
             │                                   └── POST /v1/auth/change-password { new_password }
             │                                           │
             │                                           ├── Hashes new password (Argon2id)
             │                                           ├── Updates users.password_hash
             │                                           ├── Revokes all OTHER sessions in sessions table
             │                                           └── Returns 204 No Content
             │
             └── Mode 2: "Forgot password?" ──> (Switches in-place to Identity Recovery Flow; see Section D)
```

### 2. Webmail Flow (`apps/webmail/src/routes/settings/SecurityTab.tsx`)
```
[Employee clicks "Change Password" in Settings > Security]
             │
             ├── Inputs: Current Password, New Password, Confirm New Password
             │
             ├── 1. Verification:
             │      POST /v1/auth/verify-password { password: currentPassword }
             │
             ├── 2. Client-Side Cryptographic Key Re-Wrapping:
             │      IF mailboxKey() is currently in memory (unlocked):
             │          - Extracts raw mailboxSkBytes (32 bytes).
             │          - Generates 16-byte random salt.
             │          - Calls wasm.wasm_passphrase_wrap_key(newPassword, saltHex, skHex).
             │          - Re-wraps signingSeed under newPassword.
             │          - Re-wraps xwingSeed under newPassword.
             │          - Preserves existing root_wrapped envelopes.
             │          - Builds serialized JSON payload: wrapped_sk_user.
             │      ELSE:
             │          - Emits console warning; skips re-wrapping (VULNERABILITY: see below).
             │
             ├── 3. Server Submission:
             │      POST /v1/auth/change-password { new_password, wrapped_sk_user }
             │          │
             │          ├── Updates users.password_hash with Argon2id hash.
             │          ├── IF wrapped_sk_user provided:
             │          │       UPDATE mailboxes SET wrapped_sk_user=$1, mailbox_sk_wrapped=$1
             │          │       WHERE user_id=$2 AND is_active=true
             │          ├── Revokes all OTHER active sessions:
             │          │       UPDATE sessions SET revoked_at=now() 
             │          │       WHERE user_id=$1 AND token_hash != current_token_hash
             │          └── Returns 204 No Content.
             │
             └── 4. Memory Updates:
                    - Updates props.mailbox.wrapped_sk_user in memory.
                    - Mailbox remains unlocked and usable in current session.
```

### Key Differences & Cryptographic Risks
- **Desynchronization Hazard:** If an employee changes their password in Control Panel (or in Webmail while their mailbox is locked / key not in memory), `wrapped_sk_user` is **not** updated in the database. When the employee subsequently attempts to log into Webmail using the new password, `autoUnwrapKeys` fails because the stored key envelope is still encrypted with the old password.
- **Factor Re-authentication:** The standard flow currently requires only the `Current Password`. It does not demand proof of an enrolled passkey or TOTP authenticator as a mandatory second step of Mode 1.

---

# Section D: Current Forgotten-Password Flow

```
[Employee clicks "Forgot password?" on Webmail Login Screen or Modal]
                                   │
                                   v
             [Step 1: Discover Enrolled Recovery Channels]
             GET /v1/auth/recovery/options?email=<email>
             - Returns available methods: ['email', 'phone', 'totp', 'passkey'] with masked destinations.
             - Anti-enumeration: Returns generic masked email for non-existent users.
                                   │
                                   v
             [Step 2: Request Identity Challenge]
             POST /v1/auth/recovery/request { email, method }
             - If method == 'email' or 'phone': Generates 6-digit numeric OTP, inserts into auth_challenges.
             - If method == 'totp': Inserts challenge_type='recovery_reset_totp'.
             - If method == 'passkey': Inserts challenge_type='recovery_reset_passkey'.
             - Returns { challenge_token, expires_at (10 min), mailbox_id, wrapped_sk_user }.
                                   │
                                   v
             [Step 3: Verification & Password Reset Submission]
             POST /v1/auth/recovery/reset-password
             Payload: { challenge_token, code, new_password, new_mailbox_pk?, new_wrapped_sk_user? }
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
    Case A: Employee has 24-word         Case B: Employee does NOT have
    Account Master Secret                24-word Recovery Phrase
    (Historical Data Preserved)          (Historical Data Locked)
                    │                             │
    - Calls wasm_recover_root_secret()   - Generates brand new keypair:
    - Unwraps old key using root         - Calls wasm_generate_keypair()
    - Re-wraps old key under newPass     - Wraps new key under newPass
    - Sends new_wrapped_sk_user          - Sends new_mailbox_pk AND
    - new_mailbox_pk is OMITTED          - new_wrapped_sk_user
                    │                             │
                    └──────────────┬──────────────┘
                                   │
                                   v
             [Server-Side Atomic Execution (recovery_flow.go)]
             1. Validates challenge_token and single-use code/passkey.
             2. Immediately deletes challenge from auth_challenges.
             3. Hashes new_password with Argon2id -> updates users.password_hash.
             4. Mailbox Key Handling:
                - If Case A (new_wrapped_sk_user provided, new_mailbox_pk omitted):
                  Updates mailboxes.wrapped_sk_user, clears previous_wrapped_sk_user.
                - If Case B (new_mailbox_pk provided):
                  Moves current wrapped_sk_user -> mailboxes.previous_wrapped_sk_user.
                  Sets mailboxes.previous_key_archived_at = NOW().
                  Updates mailboxes.mailbox_pk = new_mailbox_pk.
                  Sets mailboxes.wrapped_sk_user = new_wrapped_sk_user.
                - If no key payload provided:
                  Archives existing key into previous_wrapped_sk_user;
                  Sets mailboxes.wrapped_sk_user = NULL (mailbox completely locked).
             5. Revokes ALL existing sessions: UPDATE sessions SET revoked_at=NOW().
             6. Issues brand new authenticated session cookie & token.
```

### Missing Organization Owner Approval
- **Finding:** Organization Owner approval for forgotten-password resets **does not exist anywhere** in the current backend or frontend. Any user with access to an enrolled recovery channel (`recovery_email`, `recovery_phone`, `totp`, or `passkey`) can reset their login credentials and rotate keys unilaterally.
- **Fallback Procedure:** If an employee loses both their passkey and authenticator and lacks an active recovery contact, there is no administrative fallback. The employee is permanently locked out.

---

# Section E: Recovery Verification Contacts Audit

### 1. Database Storage
- **Columns:** `users.recovery_email` (TEXT, NULL) and `users.recovery_phone` (TEXT, NULL).
- **Ownership:** Strongly bound to the individual `users` identity record (`users.id`). They do **not** belong to the `mailboxes` table or `organizations` table.

### 2. Backend API Surface
- `GET /v1/auth/2fa/recovery-methods`: Returns `recovery_email` and `recovery_phone` for the caller's session.
- `POST /v1/auth/2fa/recovery-methods`: Updates `recovery_email` and `recovery_phone` for the caller's session.
- `GET /v1/auth/2fa/status`: Includes `recovery_email` and `recovery_phone` in the response payload.
- `POST /v1/auth/invitations/claim`: Accepts `recovery_email` and `recovery_phone` and saves them to the newly activated user row.
- `GET /v1/auth/recovery/options`: Returns masked recovery contacts to unauthenticated callers during identity discovery.
- `POST /v1/auth/recovery/request`: Sends OTP codes to `recovery_email` or `recovery_phone`.
- `POST /v1/auth/login`: Dispatches login 2FA verification codes to recovery contacts if configured.

### 3. Frontend Locations & Duplication
- **Control Panel (`apps/control-plane/src/routes/dashboard/security.tsx`):** Renders "Recovery Contacts" form (Recovery Email, Recovery Phone) for the logged-in administrator.
- **Webmail Settings (`apps/webmail/src/routes/settings/SecurityTab.tsx`):** Renders "Recovery Verification Contacts" under the "Mailbox Settings" layout.
- **Webmail Setup Wizard (`apps/webmail/src/routes/setup-account.tsx`):** Prompts for recovery phone or recovery email during initial employee activation.

### 4. Administrator Capabilities & Privacy
- Organization administrators **cannot** view, edit, or delete an employee's recovery verification contacts. The member listing endpoint (`GET /v1/auth/organization-members`) explicitly projects only `id`, `email`, `display_name`, `role`, and `is_active`.
- Employees do not need Control Panel access to manage recovery contacts; they manage them in Webmail.

### 5. Operational Status & Proposed Disposition
- **Status:** **ACTUALLY USED.** These contacts are not cosmetic; they actively receive 6-digit OTP codes for login 2FA challenges and password reset challenges.
- **Proposed Direction:**
  - Removing recovery contacts from Webmail's "Mailbox Settings" is architecturally sound because recovery contacts are an **Account Identity** property, not an encrypted mailbox property.
  - However, because employees only use Webmail, removing the fields entirely from Webmail would leave employees unable to view or update their recovery channels.
  - **Recommendation:** Keep recovery contact management in Webmail, but conceptually re-group the UI under an explicit "Account Security & Login" section, distinct from "Mailbox Cryptography & Keys". Do not drop database columns, as login 2FA and OTP recovery directly depend on them.

---

# Section F: Control Panel vs Webmail Responsibility Matrix

| Feature | Current Location | Intended Location | Who Controls It | Employee Capabilities | Administrator / Owner Capabilities |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Org Registration & Domains** | Control Panel | Control Panel | Org Owner / Admin | None | Registers org, manages verified domains, configures DKIM. |
| **Mailbox Provisioning** | Control Panel | Control Panel | Org Owner / Admin | None | Invites employee (`/invite`) or provisions mailbox. |
| **Activation Links** | Control Panel | Control Panel | Org Owner / Admin | Consumes link at `/setup-account` | Generates invitation link with token. |
| **Mailbox Deletion / Suspension** | Control Panel | Control Panel | Org Owner / Admin | None | Soft-deletes / suspends mailbox (`DELETE /mailboxes/{id}`). |
| **User Termination** | Control Panel | Control Panel | Org Owner Only | None | Terminates user, revokes all sessions and credentials. |
| **Mailbox Reading & Sending** | Webmail | Webmail | Employee (Mailbox Owner) | Full zero-knowledge composition & decryption | **Strictly Forbidden (403 Forbidden).** |
| **24-Word Recovery Phrase** | Webmail (`setup-account.tsx` & `SecurityTab.tsx`) | Webmail | Employee | Generates, downloads paper backup, reveals in settings | **Cannot view or access.** |
| **Mailbox Key Rotation (Root)** | Webmail & API | Webmail | Employee | Rotates root anchor | **Forbidden (403 Forbidden).** |
| **Standard Password Change** | CP & Webmail | Webmail (for employee), CP (for admin only) | User | Changes password; rewraps mailbox keys | Cannot view or change employee password. |
| **Forgotten-Password Request** | Webmail & CP | Webmail (Login & Settings) | Employee | Initiates recovery request via enrolled factors | Approves/rejects reset request in CP (Target Policy). |
| **Password Reset Approval** | **Missing** | Control Panel | Org Owner | Submits request to org owner | Receives reset request; approves or rejects. |
| **2FA / TOTP Enrollment** | CP & Webmail | Webmail (employee), CP (admin) | User | Enrolls authenticator app with QR code | Cannot view secret or disable employee 2FA. |
| **Passkey Enrollment** | CP & Webmail | Webmail (employee), CP (admin) | User | Registers FIDO2 biometric or hardware key | Cannot view or delete employee passkeys. |
| **Active Sessions Audit** | CP & Webmail | Webmail (employee), CP (admin) | User | Views own active sessions, revokes others | Terminates all sessions only by terminating user. |
| **Recovery Contacts** | CP, Webmail, Setup | Webmail (employee), CP (admin) | User | Enrolls/updates recovery email & phone | Cannot view or modify employee recovery contacts. |

---

# Section G: Gap Analysis

| Feature / Area | Status | Architectural & Security Analysis |
| :--- | :--- | :--- |
| **Private Zero-Knowledge Mailboxes** | **Already Implemented** | Migration 058 successfully removed `wrapped_sk_org` and legacy org-managed mailboxes. All mailboxes enforce mode `private`. |
| **Client-Side Key Generation** | **Already Implemented** | Generated strictly on the user's client using `byos_crypto_core` WASM during `/setup-account`. Private keys never cross the wire unsealed. |
| **Account Master Secret (24-word)** | **Already Implemented** | Generated client-side via BIP-39 mnemonic. Derives root secret, Ed25519 signing seed, X-Wing seed, and recovery verifiers. Sealed under password in `mailbox_settings`. |
| **Two-Factor Authentication (2FA)** | **Already Implemented** | Fully operational RFC 6238 TOTP, SMS phone OTP, and email OTP support across backend and both frontends. |
| **WebAuthn / Passkeys** | **Partially Implemented / Security Concern** | Passkeys authenticate user accounts to the server. However, passkeys do not cryptographically derive or unwrap mailbox keys. Webmail currently saves unsealed private keys in browser `localStorage` (`byos_passkey_vault_<credId>`) to achieve 1-touch unlock, which is a plaintext key exposure risk in browser storage. |
| **Google & Microsoft SSO** | **Missing** | No social or enterprise identity provider authentication exists. (Google/Microsoft integrations are limited to storage backend and email import). |
| **Authentication Backup Codes** | **Missing** | No static emergency backup codes (e.g. 10 single-use recovery codes) are generated during 2FA setup. |
| **Organization Owner Reset Approval** | **Missing** | No approval mechanism exists in Control Panel for employee forgotten-password requests. Recovery OTPs currently allow unilateral account reset. |
| **Employee Reset Fallback Procedure** | **Missing** | When an employee loses access to their authenticator and passkey and has no recovery contact, there is no administrative path to restore account access without compromising mailbox zero-knowledge. |
| **Key Rewrapping on Locked Password Change**| **Security Concern** | If an account password is changed while the mailbox key is not in memory (e.g., changed in Control Panel, or while locked in Webmail), `wrapped_sk_user` is not updated. The mailbox becomes locked on next login. |
| **Recovery Contacts Location** | **Duplicated / Incorrectly Located** | Recovery contacts are presented under "Mailbox Settings" in Webmail despite being identity-level attributes on `users`. |
| **Key Reactivation Administrative Hole** | **Security Concern** | In `services/api/recovery_flow.go#L555`, the `mailboxReactivateKeysHandler` SQL query includes `OR org_id IN (SELECT org_id FROM users WHERE id=$5 AND role IN ('admin', 'owner'))`, allowing an administrator to update key material on an employee's private mailbox. |
| **Direct User Provisioning Password Exposure**| **Security Concern** | `POST /v1/auth/organization-members` generates or accepts a cleartext temporary password visible to the admin, bypassing the zero-knowledge invitation ceremony (`/invite`). |

---

# Section H: Cryptographic & Authentication Separation

```
                          +------------------------+
                          |   24-Word Recovery     |
                          | Account Master Secret  |
                          +-----------+------------+
                                      |
                      wasm_recover_root_secret()
                                      |
                                      v
                          +------------------------+
                          |      Root Secret       |
                          +-----+------------+-----+
                                |            |
         wasm_wrap_mailbox_key()|            | wasm_derive_signing_seed()
                                |            | wasm_derive_xwing_seed()
                                v            v
+------------------+     +--------------+  +---------------+
| Account Password |     |  Mailbox SK  |  | Signing Seed  |
+--------+---------+     |   (X25519)   |  | & X-Wing Seed |
         |               +------+-------+  +-------+-------+
         |                      |                  |
         |                      +--------+---------+
         |                               |
         | wasm_passphrase_wrap_key()    |
         +-------------------------------+
                         |
                         v
         +-------------------------------+
         |        wrapped_sk_user        |
         | (Stored in DB: mailboxes row) |
         +-------------------------------+

  ====================== CRYPTOGRAPHIC BOUNDARY ======================
  The following credentials CANNOT decrypt or recover Mailbox Keys:

  [Passkey Credential] ──> Proves WebAuthn challenge ──> Server Session Only
  [TOTP 6-digit Code]  ──> Proves RFC 6238 time sync  ──> Server Session Only
  [Recovery Phone OTP] ──> Proves SMS channel control ──> Server Session Only
  [Recovery Email OTP] ──> Proves email channel control─> Server Session Only
  [Admin / Org Owner]  ──> Manages billing & seats    ──> CANNOT DECRYPT (403)
```

### Decoupling Rules:
1. **Login Authentication != Mailbox Decryption:** A valid server session token (issued via password, passkey, TOTP, or recovery OTP) grants access to API endpoints only. It cannot decrypt stored emails without `mailbox_sk`.
2. **Account Reset != Mailbox Key Overwrite:** Resetting an account password must never destroy the historical key envelope. If the employee does not have their 24-word recovery phrase, the old envelope must be moved to `previous_wrapped_sk_user`, keeping historical emails recoverable once the phrase or old password is provided.
3. **Passkey Isolation:** Passkeys must be recognized as hardware authentication credentials, not cryptographic key storage. Raw private keys must not be stored in `localStorage` under passkey vaults.

---

# Section I: Recommended Implementation Plan

### 1. Backend / API Changes (`services/api`)
- **Implement Reset Approval Workflow:**
  - Create table `password_reset_requests` (`id`, `user_id`, `org_id`, `status` ['pending', 'approved', 'rejected'], `requested_at`, `approved_by`, `token_hash`, `expires_at`).
  - Add `POST /v1/auth/recovery/request-reset`: Called by employee from Webmail when they lack standard 2FA factors or when policy mandates owner approval.
  - Add `GET /v1/organizations/{org_id}/reset-requests` and `POST /v1/organizations/{org_id}/reset-requests/{id}/approve` (and `/reject`): Restricted to Organization Owner.
  - Approve action issues a single-use, 24-hour reset authorization token delivered to the verified employee channel. The Owner **never** sees or chooses the employee's new password.
- **Fix Security Vulnerability in Key Reactivation:**
  - In `services/api/recovery_flow.go` (`mailboxReactivateKeysHandler`), remove `OR org_id IN (...)` to ensure **only** `user_id = $5` (the mailbox owner) can reactivate or update mailbox key material.
- **Enforce Mandatory Mailbox Key Archiving:**
  - In `recoveryFlowResetPasswordHandler`, if `new_wrapped_sk_user` is not supplied, always move `wrapped_sk_user` to `previous_wrapped_sk_user` with a timestamp before setting `wrapped_sk_user = NULL`. Never overwrite or orphan historical envelopes.

### 2. Control Panel Changes (`apps/control-plane`)
- **Add Password Reset Approvals Screen:**
  - In `apps/control-plane/src/routes/dashboard/`, add an "Account Resets" tab or badge under Security Governance where owners can review and approve/reject pending employee reset requests.
- **Clean Up Redundant Personal Settings:**
  - Remove personal mailbox-specific cryptographic controls from Control Panel.
  - Clarify that `/dashboard/security` in Control Panel manages **Organization Administrator Security** only.

### 3. Webmail Changes (`apps/webmail`)
- **Refactor Password Change Ceremony (`SecurityTab.tsx`):**
  - Require the user to re-authenticate with their active 2FA factor (TOTP code or Passkey) before confirming an ordinary password change.
  - If the mailbox is locked, block the password change and prompt the user to unlock the mailbox first, preventing key-password desynchronization.
- **Eliminate Plaintext Passkey Vault:**
  - Remove `localStorage.setItem('byos_passkey_vault_' + rawId, ...)` from `SecurityTab.tsx` and `App.tsx`.
  - Replace with proper device key wrapping using Web Crypto non-extractable keys in IndexedDB (`persistent_session.ts`) or WebAuthn PRF extension where supported.
- **Streamline Forgotten-Password Experience:**
  - Add explicit "Request Administrator Approval" fallback option in the Webmail login recovery modal for employees who have lost access to their 2FA factors.

### 4. Database Schema Migrations
- Migration file (e.g., `059_password_reset_approvals.sql`):
  ```sql
  CREATE TABLE IF NOT EXISTS password_reset_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'consumed')),
      request_token_hash BYTEA NOT NULL UNIQUE,
      authorization_token_hash BYTEA UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ,
      resolved_by UUID REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_reset_requests_org ON password_reset_requests(org_id, status);
  ```

---

# Section J: Acceptance Criteria for Future Implementation

1. **Ordinary Password Change Verification:**
   - [ ] Employee can change account password in Webmail by providing current password and verifying with their enrolled 2FA factor (TOTP or passkey).
   - [ ] Mailbox key envelope (`wrapped_sk_user`) is rewrapped with the new password.
   - [ ] On next login with the new password, mailbox unlocks automatically and existing historical emails decrypt cleanly without prompting for the 24-word phrase.
   - [ ] All other active browser sessions for the user are terminated immediately.
2. **Approved Forgotten-Password Flow Verification:**
   - [ ] Employee locked out of their account can submit a reset request from Webmail login.
   - [ ] Organization Owner sees the pending reset request in Control Panel with employee email and request timestamp.
   - [ ] Owner approves the reset. The owner **never** sees, enters, or receives the employee's new password.
   - [ ] Employee receives a one-time reset authorization via their verified channel.
   - [ ] Employee sets their own new password in Webmail.
   - [ ] Resetting the password grants account login, but historical emails remain locked until the employee enters their 24-word Account Master Secret or uses an existing authorized device.
3. **Cryptographic & Tenant Isolation Verification:**
   - [ ] Organization administrators and owners cannot access, impersonate, or decrypt a Private employee mailbox (`HTTP 403 Forbidden`).
   - [ ] An administrator cannot call `/reactivate-keys` on an employee's mailbox.
   - [ ] Unsealed private keys (`mailbox_sk`) are never written in plaintext to browser `localStorage`.
   - [ ] Rate limits fail closed upon Redis failure on all recovery endpoints.
