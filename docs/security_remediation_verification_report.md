# BYOS Post-Implementation Security Verification Report

## 1. Executive Verdict

**VERDICT: BLOCKED / CHANGES REQUIRED**

The latest BYOS remediation changes successfully address critical isolation boundaries for organization recovery verification contacts and enforce mailbox ownership checks on `mailboxReactivateKeysHandler`. However, independent adversarial review identified two **Critical** vulnerabilities and two **High** severity vulnerabilities that violate zero-knowledge constraints and core security invariants:

1. **Critical - Zero-Knowledge Key Substitution Vulnerability in Exceptional Recovery**: The exceptional recovery reset handler permits arbitrary replacement of `mailbox_pk` and `wrapped_sk_user` upon presentation of an owner-generated authorization code without requiring the employee to independently prove possession of their Account Master Secret, recovery phrase, or an authorized device. Furthermore, the organization owner receives the plaintext authorization code directly in the approval API response, allowing a rogue owner to reset an employee's password and substitute an owner-controlled public key to intercept future incoming emails.
2. **Critical - Passkey Login Signature Verification Bypass**: The WebAuthn passkey login handler decodes `signature` and `client_data_json` from the client request but never verifies the cryptographic signature or user verification flags against the registered public key. Possession of a user's `credential_id` (which is returned in public login options) is sufficient to authenticate as that user.
3. **High - Password Change Handler Does Not Strictly Enforce Current Password**: `changePasswordHandler` guards current password validation with `if req.CurrentPassword != ""`. If an authenticated caller omits `current_password`, the verification is bypassed entirely.
4. **High - Missing Reauthentication / MFA Enforcement on Password Change**: Neither the backend nor the frontend requires or challenges for MFA (passkey or TOTP) during password changes, allowing session hijackers or malicious scripts to rotate credentials without the second factor.

---

## 2. Critical Findings

### Finding 1: Exceptional Recovery Permits Unauthenticated Key Substitution
- **Severity**: Critical
- **Location**: [`services/api/recovery_flow.go`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L946-L950), [`services/api/recovery_flow.go`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L1107-L1147)
- **Impact**: Breaks zero-knowledge private mailbox architecture. An organization owner (or attacker with the approval code) can substitute `mailbox_pk` and `wrapped_sk_user` for any employee mailbox without employee cryptographic proof, enabling eavesdropping on future inbound messages.
- **Evidence**:
  - In `exceptionalRecoveryApproveHandler` ([`services/api/recovery_flow.go:948`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L948)), the server returns `authorization_code` to the owner:
    ```go
    json.NewEncoder(w).Encode(map[string]interface{}{
        "success":            true,
        "authorization_code": authCode,
        "target_email":       targetEmail,
        "expires_at":         expiresAt.Format(time.RFC3339),
    })
    ```
  - In `exceptionalRecoveryResetHandler` ([`services/api/recovery_flow.go:1115-1130`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L1115-L1130)), the server accepts arbitrary `new_mailbox_pk` and `new_wrapped_sk_user`:
    ```go
    UPDATE mailboxes
    SET previous_wrapped_sk_user = ...,
        previous_key_archived_at = ...,
        wrapped_sk_user = $1,
        mailbox_sk_wrapped = $2,
        mailbox_pk = $3,
        updated_at = NOW()
    WHERE user_id = $4 AND is_active = true
    ```
  - No proof of Account Master Secret or signature from an authorized device is required.

### Finding 2: Passkey Login Skips Signature and Authenticator Verification
- **Severity**: Critical
- **Location**: [`services/api/passkeys.go`](file:///f:/Codex/byos-email/services/api/passkeys.go#L306-L380)
- **Impact**: Total authentication bypass for passkey accounts. An attacker who queries `/v1/auth/passkeys/login-options?email=victim@byos.local` receives the victim's `credential_id` and can immediately call `/v1/auth/passkeys/login` with dummy signature data to obtain an active session cookie.
- **Evidence**:
  - In `passkeyLoginHandler` ([`services/api/passkeys.go:307-310`](file:///f:/Codex/byos-email/services/api/passkeys.go#L307-L310)), `Signature` and `ClientDataJSON` are decoded into `req`:
    ```go
    var req struct {
        CredentialID   string `json:"credential_id"`
        ChallengeToken string `json:"challenge_token"`
        Signature      string `json:"signature"`
        ClientDataJSON string `json:"client_data_json"`
    }
    ```
  - `req.Signature` and `req.ClientDataJSON` are never parsed, checked, or cryptographically validated against `p.public_key`. The handler executes:
    ```go
    err = conn.QueryRow(ctx, `
        SELECT p.id::text, p.user_id::text
        FROM user_passkeys p
        JOIN users u ON u.id = p.user_id
        WHERE p.credential_id=$1 AND u.is_active=true
    `, req.CredentialID).Scan(&passkeyID, &userID)
    ...
    token, expires, err := createSession(ctx, conn, userID, 24*time.Hour, userAgent, ipAddress)
    ```

---

## 3. Exceptional Recovery Security Trace

### Flow Trace: Request -> Approval -> Redemption -> Database Mutation
1. **Employee Request**: `POST /v1/auth/recovery/request-exceptional` ([`services/api/recovery_flow.go:719`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L719)) inserts an `auth_challenges` record with `challenge_type = 'exceptional_reset_pending'`.
2. **Owner Review**: `GET /v1/organizations/{org_id}/exceptional-recovery` ([`services/api/recovery_flow.go:798`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L798)) queries challenges for that organization. Enforces `isOwner(userID, orgID, conn)`.
3. **Owner Approval**: `POST /v1/organizations/{org_id}/exceptional-recovery/{id}/approve` ([`services/api/recovery_flow.go:873`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L873)) sets `challenge_type = 'exceptional_reset_approved'`, generates a 12-character alphanumeric code, sets 24-hour expiration, and returns the code in the response payload.
4. **Code Redemption**: `POST /v1/auth/recovery/reset-with-approval` ([`services/api/recovery_flow.go:1022`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L1022)) validates the authorization code against `auth_challenges`, immediately deletes the challenge to prevent replay, hashes `new_password`, updates `users.password_hash`, archives `mailboxes.wrapped_sk_user` to `mailboxes.previous_wrapped_sk_user`, and records `previous_key_archived_at = NOW()`.

### Explicit Architectural Inquiries
- **Can an owner-approved code alone change an employee's password?**
  Yes. Presenting the email, valid authorization code, and a new password successfully updates `users.password_hash`.
- **Can it change `wrapped_sk_user`?**
  Yes. If `new_wrapped_sk_user` is provided, line 1125 / line 1142 directly updates `mailboxes.wrapped_sk_user`.
- **Can it replace any mailbox public key, root key, X-Wing key, signing key, or other cryptographic material?**
  Yes. Lines 1108-1127 decode `new_mailbox_pk` and execute `UPDATE mailboxes SET mailbox_pk = $3`. It does not modify X-Wing or root secrets directly, but replacing `mailbox_pk` alters recipient encryption.
- **Does the employee need to independently prove possession of their Account Master Secret or an authorized device before an existing mailbox key envelope can be rewrapped?**
  No. There is zero cryptographic challenge, signature check, or master secret validation.
- **Is the new wrapped key generated client-side?**
  The server accepts whatever string is supplied in the request body. If generated by a legitimate client, it is client-generated; if forged by an attacker, the server accepts it without validation.
- **Does the server ever receive plaintext private keys or the Account Master Secret?**
  No. The server receives wrapped strings and public key hex strings only.
- **What exactly is stored in `previous_wrapped_sk_user`?**
  The raw text previously in `mailboxes.wrapped_sk_user`.
- **Can an administrator read, restore, or manipulate that archived envelope?**
  Administrators cannot manipulate it via API because `mailboxReactivateKeysHandler` restricts access to `mailboxUserID == userID`. However, administrators with direct database access can read the ciphertext envelope.
- **Can the employee lose access to historical messages as a result of this flow?**
  Yes. If `new_wrapped_sk_user` is not provided (or wraps a brand new key pair), `wrapped_sk_user` is set to NULL (or a new key), leaving old messages decryptable only with the previous password or recovery phrase.
- **Is the authorization employee-specific, short-lived, single-use, and protected against replay?**
  Yes. It is tied to the target user ID, expires in 24 hours, and the challenge row is deleted before committing. Replay attempts return HTTP 401 Unauthorized.
- **Can an owner approve their own recovery request or approve a request outside their organization?**
  - Cross-organization: Blocked. The query joins `users u ON u.id = c.user_id WHERE u.org_id = $2` and verifies `isOwner(callerUserID, orgID)`.
  - Self-approval: Not blocked. `exceptionalRecoveryApproveHandler` does not check `c.user_id != callerUserID`.
- **What happens when the employee has no Account Master Secret and no authorized device?**
  The current endpoint still allows password reset and key replacement. Under strict zero-knowledge architecture, the password can be reset, but historical keys must remain archived and locked until unlocked with the recovery phrase.

---

## 4. Password-Change Cryptographic Trace

### Webmail Flow Trace
1. **Current Password Validation**: In [`apps/webmail/src/routes/settings/SecurityTab.tsx:385`](file:///f:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx#L385), `verifyAccountPassword(curr)` calls `/v1/auth/verify-password`.
2. **Key Resolution**: Checks `props.mailboxKey` and `sessionStorage.getItem("byos_mailbox_sk_" + props.mailbox.id)`.
3. **Locked Mailbox Guard**: If key is not in memory and `props.mailbox.wrapped_sk_user` is non-empty, line 501 throws: `"Mailbox is currently locked. Please unlock your mailbox before changing your password so your encryption keys can be preserved."`
4. **Client-Side Derivation & Re-wrapping**: Generates random 16-byte salt, derives wrapping key from `next` password, calls `wasm.wasm_passphrase_wrap_key`, preserves `root_wrapped`, and packages JSON envelope.
5. **API Submission**: Calls `changeAccountPassword(next, newWrappedPayload, curr)`.

### Backend Processing (`services/api/recovery.go:292-410`)
1. **Session Resolution**: Resolves session via cookie.
2. **Current Password Check Gap**: Line 337 only checks `current_password` if `req.CurrentPassword != ""`. If omitted by an API caller, the check is skipped.
3. **Mailbox Key Requirement**: Lines 352-366 count mailboxes with existing `wrapped_sk_user`. If count > 0 and `wrappedSkUser` is omitted, returns HTTP 400.
4. **Atomic Transaction**: Begins transaction, updates `users.password_hash`, updates `mailboxes.wrapped_sk_user`, revokes other sessions (`token_hash != currentHash`), and commits.

### Control Panel Alternate Path
- [`apps/control-plane/src/routes/dashboard/security.tsx:341`](file:///f:/Codex/byos-email/apps/control-plane/src/routes/dashboard/security.tsx#L341) calls `changeAccountPassword(next, curr)`, which omits `wrapped_sk_user`.
- For users with active mailboxes, the backend returns HTTP 400.
- For users without mailboxes (pure administrators), the password is changed without key envelopes.
- Control Panel has no cryptographic key unwrapping/rewrapping routines.

---

## 5. Passkey Vault and Existing-User Impact

### Repository Search Results
- `byos_passkey_vault`: Removed from active storage paths. Only references remain in:
  - Startup purging routines in [`apps/webmail/src/App.tsx:210`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L210) and [`apps/webmail/src/routes/settings/SecurityTab.tsx:84`](file:///f:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx#L84).
  - Deletion handler in [`apps/webmail/src/routes/settings/SecurityTab.tsx:878`](file:///f:/Codex/byos-email/apps/webmail/src/routes/settings/SecurityTab.tsx#L878).
  - Regression unit tests in [`apps/webmail/src/persistent_session.test.ts:316`](file:///f:/Codex/byos-email/apps/webmail/src/persistent_session.test.ts#L316).
- No unencrypted mailbox private keys are written to `localStorage`.
- `sessionStorage` continues to hold active in-memory session keys (`byos_mailbox_sk_<mailboxId>`), which are cleared on tab close.
- Device-bound persistent sessions store sealed keys in IndexedDB encrypted under a non-extractable AES-GCM CryptoKey (`byos_device_key_<userId>`). Device revocation invalidates the session token on the server, causing `/v1/auth/me` to reject the session and purge storage.

### Impact on Existing Users
Removing the passkey vault does not cause key loss because authoritative copies remain encrypted on the server in `mailboxes.wrapped_sk_user`. However, users who previously logged in via passkeys without entering their password will find their mailbox locked until they enter their password or restore a persistent session.

---

## 6. Owner Recovery Contact Isolation

### Architecture Verification
1. **Registration**: [`services/api/auth.go:120-136`](file:///f:/Codex/byos-email/services/api/auth.go#L120-L136) accepts optional `recovery_email` and `recovery_phone` for owners only, enforcing `recovery_email != email`.
2. **Management Endpoints**: [`services/api/two_factor.go:382`](file:///f:/Codex/byos-email/services/api/two_factor.go#L382), [`services/api/two_factor.go:489`](file:///f:/Codex/byos-email/services/api/two_factor.go#L489), and [`services/api/two_factor.go:578`](file:///f:/Codex/byos-email/services/api/two_factor.go#L578) strictly check `if role != "owner"` and return HTTP 403 Forbidden.
3. **Employee Invitation Activation**: [`services/api/invitations.go:508-514`](file:///f:/Codex/byos-email/services/api/invitations.go#L508-L514) removes writing `recovery_email` and `recovery_phone` to `users`. Step 3 in [`apps/webmail/src/routes/setup-account.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/routes/setup-account.tsx) configures TOTP only.
4. **Employee UI**: "Recovery Verification Contacts" form is removed from Webmail Settings.
5. **Fallback Prevention**: [`services/api/recovery_flow.go:119`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L119) rejects `email` or `phone` recovery requests with HTTP 403 Forbidden if `role != "owner"`.

---

## 7. MFA Enforcement

### Architecture Verification
- **Login Check**: In [`services/api/auth.go:520`](file:///f:/Codex/byos-email/services/api/auth.go#L520):
  ```go
  hasMFA := twoFactorEnabled || (totpSecret != nil && *totpSecret != "") || passkeyCount > 0
  ```
  Either an enrolled passkey OR an authenticator app (TOTP) triggers the 2FA requirement.
- **Dynamic Recalculation**:
  - In `passkeys.go:545`, deleting a passkey recalculates `two_factor_enabled` based on whether TOTP or other passkeys remain.
  - In `two_factor.go:338`, disabling TOTP preserves `two_factor_enabled = true` if passkeys exist.
- **Defect Identified**: Passkey login does not verify cryptographic signatures (see Finding 2).

---

## 8. Authorization Regression Findings

- `mailboxReactivateKeysHandler`: Strictly enforces `mailboxUserID == userID` ([`services/api/recovery_flow.go:564`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L564)). Non-owners receive HTTP 403 Forbidden.
- `rootRotationHandler`: Strictly enforces `ownerUserID == userID` ([`services/api/root_rotation.go:107`](file:///f:/Codex/byos-email/services/api/root_rotation.go#L107)). Administrators receive HTTP 403 Forbidden.
- `mailboxImpersonateHandler`: Hardcoded to reject private mailbox impersonation with HTTP 403 Forbidden ([`services/api/invitations.go:643`](file:///f:/Codex/byos-email/services/api/invitations.go#L643)).
- `keyPublishHandler`: Restricts public key updates to `WHERE user_id = $1` ([`services/api/keys.go:354`](file:///f:/Codex/byos-email/services/api/keys.go#L354)).

---

## 9. Test Coverage and Missing Tests

### Tests Added in Latest Remediation
1. `TestMailboxReactivateKeysAuthorization` in `recovery_flow_test.go`: Real DB, checks 403 for owner/admin/other-member, checks DB unchanged, checks 200 for owner.
2. `TestOwnerOnlyRecoveryContactIsolation` in `recovery_flow_test.go`: Real DB, checks 403 on GET/POST/send-code for non-owners, checks options masking, checks 403 on request.
3. `TestExceptionalRecoveryLifecycle` in `recovery_flow_test.go`: Real DB, tests request -> list -> approve -> reset flow, cross-org rejection, replay prevention, and DB key archiving.
4. `TestMFAConsistencyAndPasskeyPolicy` in `recovery_flow_test.go`: Real DB, tests TOTP disable while passkey exists and passkey deletion state.
5. `TestChangePasswordWithWrappedSkUser` in `recovery_test.go`: Real DB, tests atomic password and key update and session rotation.
6. `TestChangePasswordRejectsMissingWrappedSkForMailboxOwner` in `recovery_test.go`: Real DB, tests 400 rejection and DB state preservation.
7. `TestChangePasswordCurrentPasswordVerification` in `recovery_test.go`: Real DB, tests 401 rejection on wrong password.
8. `TestChangePasswordAllowsPureAdminWithoutMailbox` in `recovery_test.go`: Real DB, tests admin password change.
9. `TestChangePasswordInvalidWrappedSkUser` in `recovery_test.go`: Real DB, tests malformed JSON envelope rejection.
10. `persistent_session.test.ts` (Tests 7 & 8): Mock storage, checks legacy vault purging and key decoupling.

### Missing Tests
1. **Critical**: Negative test for passkey login signature tampering or spoofing (currently absent because verification does not exist).
2. **Critical**: Negative test asserting that an owner approval code cannot replace `mailbox_pk` without employee cryptographic signature.
3. **High**: Test asserting that omitting `current_password` during password change is rejected with HTTP 401 Unauthorized for normal sessions.
4. **High**: Test asserting that changing a password requires MFA reauthentication when 2FA is enabled.
5. **Medium**: Test verifying that a user with multiple mailboxes does not corrupt secondary mailbox keys during password change.

---

## 10. Remaining Blockers

1. **Passkey signature verification missing**: Total authentication bypass on passkey login must be resolved before production deployment.
2. **Exceptional recovery zero-knowledge boundary**: Allowing owner approval to replace `mailbox_pk` and `wrapped_sk_user` without independent employee cryptographic proof violates Section 15 zero-knowledge guarantees.
3. **Optional `current_password`**: Authenticated password changes must unconditionally require the current password unless explicitly coming through an authenticated recovery challenge.
4. **Missing MFA on password change**: Reauthentication via TOTP or passkey must be required during password changes.

---

## 11. Recommended Fixes, Prioritized by Severity

### Priority 1 (Critical) - Restrict Exceptional Recovery to Authentication Reset Only
- In `exceptionalRecoveryResetHandler` ([`services/api/recovery_flow.go:1022`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L1022)):
  - Remove `new_mailbox_pk` from the request schema and SQL queries. Owner approval must NEVER be able to modify `mailbox_pk`.
  - Do NOT accept `new_wrapped_sk_user` without employee proof of their Account Master Secret / recovery phrase.
  - If the employee does not have their Account Master Secret, the handler should reset `users.password_hash`, set `mailboxes.wrapped_sk_user = NULL`, archive the old key to `previous_wrapped_sk_user`, and prompt the user to restore from recovery phrase upon login.
  - Do not return `authorization_code` in the owner approve response ([`services/api/recovery_flow.go:948`](file:///f:/Codex/byos-email/services/api/recovery_flow.go#L948)). Instead, send it directly to the employee or generate an out-of-band verification token.

### Priority 2 (Critical) - Implement Cryptographic Signature Verification for Passkeys
- In `passkeyLoginHandler` ([`services/api/passkeys.go:300`](file:///f:/Codex/byos-email/services/api/passkeys.go#L300)):
  - Parse `ClientDataJSON` and verify that `challenge` matches `ChallengeToken` and `origin` matches the expected RP ID.
  - Parse the WebAuthn authenticator data, verify user presence (`UP`) and user verification (`UV`) flags.
  - Verify `Signature` over `authenticatorData || sha256(clientDataJSON)` using the stored `user_passkeys.public_key`.

### Priority 3 (High) - Unconditionally Enforce Current Password on Password Change
- In `changePasswordHandler` ([`services/api/recovery.go:336`](file:///f:/Codex/byos-email/services/api/recovery.go#L336)):
  - Require `req.CurrentPassword` unconditionally. If `req.CurrentPassword == ""`, return HTTP 400 Bad Request ("current_password is required").
  - If an account recovery flow needs to bypass `current_password`, create a distinct endpoint (e.g. `POST /v1/auth/recovery/change-password`) accessible strictly via a single-use validated recovery challenge token.

### Priority 4 (High) - Enforce MFA Reauthentication on Password Change
- In `changePasswordHandler` ([`services/api/recovery.go:292`](file:///f:/Codex/byos-email/services/api/recovery.go#L292)):
  - Check if the user has 2FA enabled. If enabled, require a valid TOTP code or WebAuthn assertion before committing the password change.
- In `SecurityTab.tsx` and `security.tsx`:
  - Prompt the user for their 2FA factor in the password change dialog when 2FA is active on the account.
