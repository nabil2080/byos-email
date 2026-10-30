# BYOS Passkey & WebAuthn Implementation Audit Report

## Executive Summary
This document provides an exhaustive security and architectural audit of the WebAuthn / Passkey subsystem across the BYOS platform (encompassing `services/api`, `apps/webmail`, and `apps/control-plane`). Although the local browser environment possesses the required client capabilities (`window.isSecureContext === true`, `navigator.credentials`, and platform authenticators via Windows Hello / Touch ID), the platform passkey subsystem was disabled and placed into a fail-closed posture due to fundamental cryptographic deficiencies in both registration and authentication verification handlers.

---

## 1. Browser Capability vs. Platform Reality

| Layer | Capability / Status | Assessment |
|-------|---------------------|------------|
| **Browser Environment** | `window.isSecureContext === true`<br>`!!navigator.credentials === true`<br>`PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable() === true` | **Capable**: The host client engine and OS authenticator support FIDO2/WebAuthn Level 2/3 ceremonies. |
| **Frontend Implementation** | Webmail (`SecurityTab.tsx`, `App.tsx`)<br>Control Panel (`security.tsx`, `login.tsx`) | **Incomplete / Misconfigured**: Encodes CBOR `attestationObject` directly as `public_key` hex; uses credential ID as OTP code in recovery; omits `authenticatorData` and `clientDataJSON` validation in client requests. |
| **Backend Implementation** | `services/api/passkeys.go` | **Critically Flawed**: Registration does not verify `clientDataJSON` or parse `attestationObject`; Login previously checked only credential ID without verifying digital signatures (Finding F-02), resulting in fail-closed HTTP 503 (`passkey_login_disabled`). |
| **End-to-End Verification** | Integration test suite | **Fail-Closed**: Tests assert HTTP 503 on login, zero session issuance, and rejection of password-only logins for passkey-only accounts (HTTP 403 `mfa_factor_unavailable`). |

---

## 2. Answers to Specific Audit Inquiries

### 1. Why Passkey Registration Was Disabled
- **File Locations**:
  - `apps/webmail/src/routes/settings/SecurityTab.tsx` (lines 1101-1123)
  - `apps/control-plane/src/routes/dashboard/security.tsx` (lines 927-949, 966-976)
  - `apps/webmail/src/routes/setup-account.tsx` (lines 846-857)
  - `services/api/invitations.go` (lines 507-515)
- **Root Cause**:
  1. **Login Asymmetry & Dead-End Enrollment**: Because passkey direct login was disabled with HTTP 503 (due to signature verification absence), allowing users to enroll a passkey created an immediate trap: accounts enrolling only a passkey could not log in with passkeys.
  2. **Mandatory MFA Policy Contradiction**: In an earlier release, passkey-only accounts were exempted from MFA OTP challenges because `"passkey"` was omitted from login challenge methods. When this bypass was resolved by rejecting passkey-only password logins with HTTP 403 (`mfa_factor_unavailable`), enrolling a passkey without TOTP would render an account un-loggable.
  3. **Backend Registration Blindness**: The backend registration handler (`passkeyRegisterHandler`) blindly stores an unverified hex string into `user_passkeys.public_key` without parsing `attestationObject` or validating `clientDataJSON`. Offering registration in the UI presented a deceptive illusion of security.

### 2. Why Passkey Login Returns `503 passkey_login_disabled`
- **File Location**: `services/api/passkeys.go` (lines 304-316)
- **Function**: `passkeyLoginHandler`
- **Root Cause**:
  - **Finding F-02 (Critical Authentication Bypass)**: Prior to the fail-safe, `passkeyLoginHandler` accepted `req.CredentialID`, `req.Signature`, and `req.ClientDataJSON`. However, the handler executed:
    ```go
    // Legacy flawed logic:
    err = conn.QueryRow(ctx, `
        SELECT p.id::text, p.user_id::text
        FROM user_passkeys p
        JOIN users u ON u.id = p.user_id
        WHERE p.credential_id=$1 AND u.is_active=true
    `, req.CredentialID).Scan(&passkeyID, &userID)
    // Issued session immediately without checking req.Signature!
    token, expires, err := createSession(ctx, conn, userID, 24*time.Hour, userAgent, ipAddress)
    ```
  - `req.Signature` and `req.ClientDataJSON` were completely ignored. Any caller who obtained a user's `credential_id` (which was exposed in public `login-options`) could log in as that user with dummy signature data.
  - In accordance with the security directive to never issue sessions without cryptographic assertion verification, the endpoint was locked down to fail-closed (`HTTP 503 Service Unavailable`, `passkey_login_disabled`) until full WebAuthn signature verification is implemented.

### 3. Backend WebAuthn Verification Flow Completeness & Security
- **Registration Verification Flow**:
  - `passkeyRegisterOptionsHandler` creates a 32-byte challenge in `auth_challenges` (`challenge_type = 'webauthn_register'`).
  - `passkeyRegisterHandler` checks that `challenge_token` exists and consumes it (`DELETE FROM auth_challenges`).
  - **Omissions / Vulnerabilities**:
    - **Missing `clientDataJSON`**: The handler does not receive or check `clientDataJSON`. It cannot assert `type === "webauthn.create"`, challenge equality, or origin matching.
    - **No Attestation Parsing**: The handler does not decode CBOR or inspect `attestationObject`. It does not extract `authData`, `rpIdHash`, flags, or `credentialPublicKey`.
    - **Corrupted Public Key Storage**: The database column `user_passkeys.public_key` receives the raw hex-encoded `attestationObject`, NOT an extracted public key (COSE, SPKI, or PEM).
- **Authentication Verification Flow**:
  - `passkeyLoginOptionsHandler` creates a challenge in `auth_challenges` (`challenge_type = 'webauthn_login'`).
  - `passkeyLoginHandler` returns HTTP 503.
  - **Omissions / Vulnerabilities**:
    - Zero cryptographic signature verification exists on the backend.
    - Zero authenticator data (`authData`) parsing or validation exists.
    - Zero origin or RP ID hash validation exists.
    - Zero signature counter validation exists.
  - **Verdict**: The backend WebAuthn registration and authentication flows are currently **INCOMPLETE and INSECURE**.

### 4. RP ID and Origin Validation in Local Development
- **File Location**: `services/api/passkeys.go` (lines 29-46)
- **Function**: `getRPID(r *http.Request)`
  ```go
  func getRPID(r *http.Request) string {
      host := ""
      if origin := r.Header.Get("Origin"); origin != "" {
          if u, err := url.Parse(origin); err == nil && u.Hostname() != "" {
              host = u.Hostname()
          }
      }
      if host == "" {
          host = r.Host
      }
      if strings.Contains(host, ":") {
          host = strings.Split(host, ":")[0]
      }
      if host == "" || host == "localhost" {
          return "localhost"
      }
      return host
  }
  ```
- **Local Development Assessment**:
  1. **The `127.0.0.1` Incompatibility**:
     - Under W3C WebAuthn Level 2/3 (§5.4.3), an RP ID MUST be a valid domain string according to RFC 5234. IPv4 and IPv6 addresses are not valid domain strings.
     - When navigating to `http://127.0.0.1:3000` or `http://127.0.0.1:3001`, `getRPID` yields `"127.0.0.1"`. Modern browsers (Chrome, Firefox, Safari) throw a `SecurityError` DOMException if `rp.id` is set to `"127.0.0.1"`.
     - Local development MUST use `http://localhost:3000` and `http://localhost:3001`, where `rpId` is `"localhost"`.
  2. **Multi-Port Origin Validation**:
     - Webmail runs on `http://localhost:3001`.
     - Control Panel runs on `http://localhost:3000`.
     - API runs on `http://127.0.0.1:8080` (or `http://localhost:8080`).
     - WebAuthn binds assertions to the client origin (`clientDataJSON.origin`). While both frontends can share RP ID `"localhost"`, the backend origin validator must explicitly allow both `http://localhost:3000` and `http://localhost:3001`. Currently, the backend has zero origin verification logic.

### 5. Challenge Security, Expiry, and Replay Protection
- **Entropy & Randomness**:
  - `generateRandomBase64URL(32)` utilizes `crypto/rand.Read` to produce 32 cryptographically secure random bytes (256 bits of entropy).
- **Expiration**:
  - Stored in `auth_challenges` with `expires_at = NOW() + INTERVAL '5 minutes'`.
  - Queries enforce `expires_at > NOW()`.
- **Consumption & Single-Use**:
  - Registration challenges are deleted immediately upon retrieval: `DELETE FROM auth_challenges WHERE id = $1`.
  - Replay of the registration challenge is prevented.
- **Flaw in Challenge-to-User Binding**:
  - When `passkeyLoginOptionsHandler` is invoked without an `email` query parameter (resident key / discoverable credential flow), the challenge row in `auth_challenges` has `user_id = NULL`.
  - The login handler checked only that the challenge token existed in `auth_challenges`, allowing any generated challenge to be paired with any victim's credential ID.

### 6. Credential IDs, Public Keys, User Verification, and Signature Counters
- **Credential IDs**:
  - Stored in `user_passkeys.credential_id` (`TEXT UNIQUE NOT NULL`).
  - Indexed via `idx_user_passkeys_credential_id`.
  - Handled as base64url-encoded string. Correctly uniquely constrained in database.
- **Public Keys**:
  - **Critical Defect**: The column `user_passkeys.public_key` stores the hex-encoded `attestationObject` from the browser, NOT the actual public key!
  - No COSE key extraction occurs. No DER or SPKI public key encoding is generated.
- **User Verification (UV)**:
  - Options handlers request `"userVerification": "preferred"`.
  - The backend never parses `authenticatorData` flags. Bit 2 (`UV` - User Verification) and Bit 0 (`UP` - User Presence) are never checked.
- **Signature Counters**:
  - The database contains `user_passkeys.counter BIGINT NOT NULL DEFAULT 0`.
  - **Defect**: The backend updated the counter via `counter = counter + 1` in SQL rather than extracting the authenticator's 4-byte `signCount` from `authenticatorData` and verifying monotonic increments. Cloned authenticator detection was completely absent.

### 7. Coexistence with Mandatory TOTP MFA Policy
- **Product Policy**: Either an enrolled passkey OR an enrolled authenticator app (TOTP) satisfies mandatory MFA.
- **Current Behavior**:
  - Because passkey login is paused (503), passkey-only accounts attempting password login are rejected with HTTP 403 (`mfa_factor_unavailable`).
  - This fail-closed check prevents password-only authentication from silently undermining the mandatory MFA requirement.
- **Future Safe Coexistence Model**:
  - **Primary Passwordless Login**: Authenticating via passkey (`POST /v1/auth/passkeys/login`) satisfies both possession (the hardware key) and biometric/PIN user verification in a single ceremony. This fulfills multi-factor security without requesting TOTP.
  - **Password Login with Passkey Second Factor**: If an account enters a password, the challenge methods can include `passkey` (in addition to `totp`), allowing the user to perform a WebAuthn assertion as their second factor.
  - **Step-Up Authentication**: Password resets and key reactivations can accept either a fresh TOTP code OR a fresh WebAuthn assertion challenge.

### 8. Lockout Risk for Existing Passkey-Only Accounts
- **Database Status**:
  - Executed query against `byos` and `byos_disposable_rehearsal`:
    ```sql
    SELECT u.id, u.email, u.role, (u.totp_secret IS NOT NULL AND u.totp_secret != '') as has_totp, COUNT(p.id) as passkey_count 
    FROM users u 
    LEFT JOIN user_passkeys p ON p.user_id = u.id 
    GROUP BY u.id, u.email, u.role, u.totp_secret 
    HAVING COUNT(p.id) > 0;
    ```
    Result: `0 rows`.
  - There are currently zero passkey credentials registered in the local development database. No existing local accounts are locked out.
- **Theoretical Lockout Profile**:
  - In an environment where accounts enrolled only a passkey prior to the pause, those users cannot authenticate via passkey (503) or password (403 `mfa_factor_unavailable`).
  - **Recovery Resolution**: Such accounts must be resolved via:
    1. Active session in-place TOTP enrollment (if a browser session is still active).
    2. Owner-approved Exceptional Recovery (for employee accounts).
    3. Section 15 offline recovery phrase ceremony (for organization owners).

---

## 3. Test Evidence

### Passkey Fail-Closed and Passkey-Only MFA Tests
Command:
```powershell
$env:DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 -run "TestPasskey" ./services/api
```
Output:
```
=== RUN   TestPasskeyLoginFailClosed
--- PASS: TestPasskeyLoginFailClosed (0.00s)
=== RUN   TestPasskeyOnlyUserMFAExperience
    recovery_flow_test.go:910: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestPasskeyOnlyUserMFAExperience (0.70s)
PASS
ok  	byos.email/services/api	2.282s
```

### Table Schema Inspection: `user_passkeys`
Command:
```powershell
docker exec -i byos-postgres psql -U byos -d byos_disposable_rehearsal -c "\d user_passkeys"
```
Output:
```
                              Table "public.user_passkeys"
    Column     |           Type           | Collation | Nullable |       Default        
---------------+--------------------------+-----------+----------+----------------------
 id            | uuid                     |           | not null | gen_random_uuid()
 user_id       | uuid                     |           | not null | 
 credential_id | text                     |           | not null | 
 public_key    | text                     |           | not null | 
 counter       | bigint                   |           | not null | 0
 device_name   | text                     |           | not null | 'Security Key'::text
 aaguid        | text                     |           |          | 
 created_at    | timestamp with time zone |           | not null | now()
 last_used_at  | timestamp with time zone |           |          | 
Indexes:
    "user_passkeys_pkey" PRIMARY KEY, btree (id)
    "idx_user_passkeys_credential_id" btree (credential_id)
    "idx_user_passkeys_user_id" btree (user_id)
    "user_passkeys_credential_id_key" UNIQUE CONSTRAINT, btree (credential_id)
Foreign-key constraints:
    "user_passkeys_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

---

## 4. Minimum Changes Required to Safely Restore Passkeys

To restore passkey registration and authentication in local development and production without compromising zero-knowledge security or authentication integrity, the following changes are required:

### 1. Adopt an Audited Go WebAuthn Library
- Hand-rolling CBOR decoding, COSE public key extraction, and WebAuthn assertion signature validation violates BYOS Rule 4 ("Never invent cryptographic protocols").
- Introduce a maintained standard library: `github.com/go-webauthn/webauthn`.
- Configure the relying party:
  - Local Dev: `RPID: "localhost"`, `RPOrigins: []string{"http://localhost:3000", "http://localhost:3001"}`.
  - Production: `RPID: "byos.email"`, `RPOrigins: []string{"https://app.byos.email", "https://mail.byos.email"}`.

### 2. Correct Backend Registration (`passkeyRegisterHandler`)
- Accept the standard WebAuthn creation response payload from the client:
  - `credential_id` (base64url)
  - `client_data_json` (base64url)
  - `attestation_object` (base64url)
- Invoke `webauthn.CreateCredential(user, sessionData, parsedResponse)`.
- Extract and store:
  - Credential ID bytes
  - Parsed public key (COSE or standard PKIX/SPKI format)
  - Initial `signCount` from `authData`
  - Authenticator AAGUID

### 3. Implement Cryptographic Assertion Verification (`passkeyLoginHandler`)
- Accept the standard WebAuthn assertion response payload from the client:
  - `credential_id` (base64url)
  - `client_data_json` (base64url)
  - `authenticator_data` (base64url)
  - `signature` (base64url)
  - `user_handle` (base64url)
- Look up the credential in `user_passkeys` by `credential_id`.
- Validate the assertion:
  1. Verify client data type is `"webauthn.get"`.
  2. Verify challenge matches the unexpired challenge in `auth_challenges`.
  3. Verify origin matches the calling frontend.
  4. Verify RP ID hash matches SHA-256 of the configured RP ID.
  5. Verify User Presence (UP) bit is set.
  6. Verify User Verification (UV) bit if required.
  7. Verify digital signature using the stored credential public key over `authenticatorData || clientDataHash`.
  8. Verify `signCount > stored_counter` (unless both are 0). Reject if counter decrements or fails to advance.
- Only upon successful cryptographic verification, update `counter = newSignCount`, record `last_used_at`, and issue an authenticated session.

### 5. Update Frontend Payloads
- In `SecurityTab.tsx`, `security.tsx`, `App.tsx`, and `login.tsx`:
  - Transmit the exact WebAuthn JSON objects (`clientDataJSON`, `attestationObject` / `authenticatorData`, `signature`) rather than manual hex-string conversions.
  - Standardize local URLs to `http://localhost:3000` and `http://localhost:3001` so that the browser does not reject `rpId: "127.0.0.1"`.
- Once end-to-end validation succeeds, re-enable "+ Add Passkey" buttons and remove the temporary pause notices.
