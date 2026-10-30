# MFA Consistency and Exceptional Recovery Completion Report

## What was built
Remediated MFA enforcement contradictions, hardened the Section 15 recovery exception with negative adversarial guards, and validated zero-knowledge exceptional employee recovery end-to-end with genuine cryptographic primitives. Passkey login remains fail-closed with HTTP 503 (`passkey_login_disabled`) to prevent unverified credential authentication until full WebAuthn cryptographic assertion signature verification is integrated. To prevent an unsafe password-only authentication bypass for accounts whose only enrolled MFA factor is a passkey, the login handler actively detects passkey-only accounts requiring MFA and rejects authentication attempts with HTTP 403 (`mfa_factor_unavailable`). Password changes for passkey-only accounts similarly reject un-stepped-up modifications with HTTP 403 (`mfa_passkey_stepup_unavailable`), preventing silent factor omission. Employee onboarding in Webmail (`setup-account.tsx`) and API invitation claims (`invitations.go`) strictly require authenticator-app TOTP enrollment and reject standalone passkey enrollment until WebAuthn assertion verification is operational, while preserving all existing registered credentials in `user_passkeys`. The Section 15 password-change ceremony was proven secure against replay, cross-user, cross-session, wrong-operation, expiration, and invalid signature attacks. End-to-end exceptional recovery was demonstrated with real X25519 ECDH, AES-256-GCM, and Argon2id operations, proving historical messages remain intact and decryptable after client root recovery.

## Files edited
| File | Reason |
|------|--------|
| `services/api/auth.go` | Enforced HTTP 403 `mfa_factor_unavailable` on password login for accounts whose sole enrolled MFA factor is a passkey while WebAuthn verification is paused. |
| `services/api/recovery.go` | Enforced single-use session-bound authorization challenge for Section 15 password reset and HTTP 403 `mfa_passkey_stepup_unavailable` on password change for passkey-only accounts. |
| `services/api/invitations.go` | Enforced authenticator-app TOTP enrollment during employee onboarding, rejecting standalone passkey enrollment requests. |
| `services/api/passkeys.go` | Kept passkey login disabled with fail-closed HTTP 503 response and preserved existing user passkey credentials. |
| `services/api/passkeys_test.go` | Added regression test asserting passkey login endpoint fails closed with HTTP 503. |
| `services/api/recovery_flow.go` | Secured exceptional recovery zero-knowledge boundaries: prevented key substitution, removed authorization code leakage, prevented owner self-approval, and restricted contacts to owners. |
| `services/api/recovery_flow_test.go` | Added integration tests for passkey-only MFA rejection, Section 15 negative guards (replay, cross-user, cross-session, expiry, bad signature), and genuine cryptographic end-to-end recovery. |
| `services/api/recovery_test.go` | Added regression tests for password change current password validation, MFA step-up reauthentication, and multi-mailbox isolation. |
| `services/api/sessions.go` | Implemented caller session token hashing to exempt active session from bulk revocation. |
| `services/api/two_factor.go` | Enforced owner-only isolation for recovery contacts and prevented passkey removal from breaking 2FA state. |
| `services/api/main.go` | Registered routes for exceptional recovery requests, approvals, rejections, resets, and key reactivation. |
| `apps/webmail/src/routes/setup-account.tsx` | Restricted onboarding MFA setup to Authenticator App (TOTP) with verification notice, removing deceptive passkey option. |
| `apps/webmail/src/routes/settings/SecurityTab.tsx` | Added amber notice explaining passkey verification pause, disabled passkey registration button, and enforced TOTP step-up for password changes. |
| `apps/webmail/src/App.tsx` | Replaced deceptive passkey login and unlock buttons with pause notices and added exceptional recovery workflow UI. |
| `apps/webmail/src/api.ts` | Added exceptional recovery client endpoints, MFA parameter to changePassword, and purged plaintext passkey vault storage. |
| `apps/webmail/src/persistent_session.test.ts` | Added unit tests verifying passkey vault remediation and non-extractable session storage. |
| `apps/control-plane/src/routes/dashboard/security.tsx` | Added amber pause notice to Passkeys card, disabled registration button, redirected mailbox owners to Webmail for password changes, and removed plaintext authorization codes from approvals. |
| `apps/control-plane/src/routes/login.tsx` | Replaced deceptive active passkey sign-in button with informative pause notice explaining assertion upgrade. |
| `apps/control-plane/src/routes/dashboard/settings.tsx` | Added Security & Authentication navigation link. |
| `apps/control-plane/src/routes/register.tsx` | Added optional owner recovery email and recovery phone during organization setup. |
| `apps/control-plane/src/lib/api/auth.ts` | Extended password change client with MFA parameter and added mailbox detection to session response. |
| `apps/control-plane/src/run_test.node.js` | Registered test runner for active sessions and password change clients. |
| `apps/control-plane/src/lib/api/auth_sessions_pwd.test.ts` | Added unit tests for Control Panel password change and active session revocation API. |
| `docs/control_panel_2fa_report.md` | Documented Control Panel two-factor authentication architecture. |
| `docs/password_change_and_sessions_report.md` | Verification report for password change and active sessions implementation. |
| `docs/security_architecture_audit_report.md` | Read-only security audit report of BYOS authentication, account security, and recovery architecture. |
| `docs/security_remediation_implementation_report.md` | Updated implementation report with full file accounting and test executions. |
| `docs/security_remediation_verification_report.md` | Independent post-implementation security verification report identifying findings F-01 through F-08. |
| `docs/mfa_and_recovery_completion_report.md` | Focused completion report resolving MFA enforcement contradictions, Section 15 negative guards, and cryptographic recovery validation. |
| `tests/browser/test_control_plane_2fa.mjs` | Browser test script for Control Panel two-factor authentication flows. |
| `tests/browser/test_password_and_sessions.mjs` | Browser test script for password change and session revocation flows. |

## Raw evidence

### 1. Passkey Login Fail-Closed Status
Command:
```powershell
$env:DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 -run "TestPasskeyLoginFailClosed" ./services/api
```
Output:
```
=== RUN   TestPasskeyLoginFailClosed
--- PASS: TestPasskeyLoginFailClosed (0.00s)
PASS
ok  	byos.email/services/api	1.472s
```

### 2. Passkey-Only User Login Rejection (403 mfa_factor_unavailable) & Password Change Rejection (403 mfa_passkey_stepup_unavailable)
Command:
```powershell
$env:DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 -run "TestPasskeyOnlyUserMFAExperience" ./services/api
```
Output:
```
=== RUN   TestPasskeyOnlyUserMFAExperience
    recovery_flow_test.go:910: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestPasskeyOnlyUserMFAExperience (0.62s)
PASS
ok  	byos.email/services/api	2.099s
```

### 3. Preserved Registered Passkeys Table Schema
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

### 4. Section 15 Negative Guards Test Suite
Command:
```powershell
$env:DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 -run "TestSection15NegativeGuards" ./services/api
```
Output:
```
=== RUN   TestSection15NegativeGuards
    recovery_flow_test.go:1131: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestSection15NegativeGuards (0.48s)
PASS
ok  	byos.email/services/api	1.997s
```

### 5. Genuine Cryptographic End-to-End Recovery Test Suite
Command:
```powershell
$env:DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 -run "TestExceptionalCryptographicRecoveryEndToEnd" ./services/api
```
Output:
```
=== RUN   TestExceptionalCryptographicRecoveryEndToEnd
    recovery_flow_test.go:1307: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestExceptionalCryptographicRecoveryEndToEnd (0.37s)
PASS
ok  	byos.email/services/api	1.873s
```

### 6. Focused Password Change & Zero-Knowledge Envelopes Test Suite
Command:
```powershell
$env:DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 -run "TestChangePassword" ./services/api
```
Output:
```
=== RUN   TestChangePasswordWithWrappedSkUser
    recovery_test.go:14: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestChangePasswordWithWrappedSkUser (0.40s)
=== RUN   TestChangePasswordRejectsMissingWrappedSkForMailboxOwner
    recovery_test.go:70: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestChangePasswordRejectsMissingWrappedSkForMailboxOwner (0.29s)
=== RUN   TestChangePasswordCurrentPasswordVerification
    recovery_test.go:126: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestChangePasswordCurrentPasswordVerification (0.50s)
=== RUN   TestChangePasswordAllowsPureAdminWithoutMailbox
    recovery_test.go:211: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestChangePasswordAllowsPureAdminWithoutMailbox (0.34s)
=== RUN   TestChangePasswordInvalidWrappedSkUser
    recovery_test.go:251: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestChangePasswordInvalidWrappedSkUser (0.15s)
=== RUN   TestChangePasswordMFAEnforcement
    recovery_test.go:283: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestChangePasswordMFAEnforcement (0.52s)
=== RUN   TestChangePasswordMultiMailboxIsolation
    recovery_test.go:357: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestChangePasswordMultiMailboxIsolation (0.47s)
PASS
ok  	byos.email/services/api	4.127s
```

## Migration Path for Existing Passkey-Only Users

During the period where WebAuthn assertion signature verification is disabled and fails closed with HTTP 503, accounts that registered passkeys prior to the pause must not be granted a password-only bypass. The platform provides two secure, non-destructive migration paths that preserve mandatory MFA:

1. **Active Session In-Place Enrollment (Recommended):**
   - Users with an existing active browser session navigate to Settings -> Security in Webmail or Control Panel.
   - The user views the informational notice explaining the verification upgrade and uses the active session to enroll an Authenticator App (TOTP).
   - Once enrolled, the user's password login immediately challenges for a TOTP code, and password changes accept TOTP step-up authentication.
   - Registered passkey records in `user_passkeys` remain intact and will resume functionality automatically once assertion verification is restored.

2. **Owner-Approved Exceptional Recovery (For Locked/Logged-Out Users):**
   - If a passkey-only user does not have an active session, they cannot authenticate with password alone (HTTP 403 `mfa_factor_unavailable`).
   - The user initiates Exceptional Recovery from the login screen, submitting their email and organization ID.
   - The organization owner inspects the request in Control Panel (Settings -> Security & Authentication) and approves it. The owner never sees or receives user passwords or authorization codes.
   - The employee enters the approval challenge token and sets a new password.
   - Upon logging into Webmail, the employee provides their 24-word Account Master Secret (BIP-39 recovery phrase). The client unwraps `root_wrapped`, recovers `mailbox_sk`, rewraps it under the new password, and reactivates historical email encryption keys.
   - The employee enrolls an Authenticator App (TOTP) during the reactivation flow to satisfy mandatory MFA.

3. **Section 15 Verifier Recovery (For Organization Owners):**
   - If the affected user is the organization owner, exceptional recovery is blocked (HTTP 403). The owner executes the Section 15 ceremony using their sovereign Ed25519 recovery keypair.
   - The client signs the single-use challenge and submits to `/v1/auth/recovery/verify`.
   - The server issues a single-use session-bound authorization challenge (`section15_recovery_pwd_reset`), allowing the owner to reset their credentials and enroll TOTP.

## Manual browser verification
Direct end-to-end browser execution modifying or resetting live application data was designated UNTESTED to strictly respect the repository safety rule forbidding modifications, migrations, or data cleanups against the live development database `byos`.

Manual steps required to test all updated flows in a browser:
1. **Passkey-Disabled Notice Validation:**
   - Navigate to `http://localhost:3000/login` (Control Panel).
   - Observe that the form displays the informational notice: "Passkey Sign-in Temporarily Paused". Ensure that no active passkey button is clickable.
   - Navigate to `http://localhost:3001/` (Webmail).
   - Observe that the login form displays the informational notice: "Passkey Sign-in Temporarily Paused", directing the user to sign in using their account password.
2. **Setup Account Authenticator-Only Enforcement:**
   - Obtain an invitation link for a new employee mailbox (`/setup-account?token=...`).
   - In Step 1, enter a 12+ character password.
   - In Step 2, download or copy the 24-word recovery phrase, check the confirmation checkbox, and click Next.
   - In Step 3, observe that only the Authenticator App (TOTP) setup is presented, along with an informative notice that passkey enrollment is temporarily paused.
   - Scan the QR code or enter the secret in an authenticator app, verify the 6-digit code, and finalize onboarding.
3. **Passkey-Only User Login Rejection:**
   - In a test environment with a user that only has a registered passkey and no TOTP, submit password login at `/v1/auth/login`.
   - Observe HTTP 403 Forbidden with error `mfa_factor_unavailable`.
4. **Section 15 Password Reset Operation Binding:**
   - Perform a recovery verify ceremony generating a Section 15 authorization challenge.
   - Change the password using the returned recovery session without providing `current_password`. Observe HTTP 204 No Content.
   - Immediately attempt a second password change without `current_password` on the same session. Observe HTTP 400 Bad Request (`current_password is required`).
5. **Exceptional Recovery Lifecycle:**
   - From Webmail login, click "Forgot Password" -> "Exceptional Recovery".
   - Submit employee email and organization ID. Record the generated challenge token.
   - Log in to Control Panel as the organization owner, navigate to Settings -> Security & Authentication, locate the request, and click "Approve". Note that no plaintext authorization code is displayed to the owner.
   - Return to Webmail, submit the challenge token with a new password, and verify password reset.
   - Log in with the new password. When prompted that the mailbox is locked, enter the 24-word recovery phrase to unlock and reactivate historical keys.

## What did not work or is untested
1. UNTESTED: Automated browser interaction executing data mutations against the live `byos` database, because modifying or cleaning the live database is forbidden by repository safety rules.
2. UNTESTED: Full WebAuthn cryptographic assertion signature verification (the passkey login endpoint remains fail-closed with HTTP 503 until an audited WebAuthn library is integrated).
3. UNTESTED: Live cellular SMS delivery for recovery contact codes, as carrier gateways require third-party API credentials not present in local development.

## Test suite output

### 1. Full Services API Go Test Suite Paste
Command:
```powershell
$env:DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; $env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -count=1 ./services/api
```
Output:
```
ok  	byos.email/services/api	53.670s
```

### 2. Control Panel Client Suite Paste
Command:
```cmd
npm test
```
Output:
```
> test
> npx tsx src/run_test.node.js

Running Encoding Utility Tests...
Running Encoding Utility Tests...
  ✓ hexToBytes converts valid hex string to Uint8Array
  ✓ hexToBytes throws error for odd length string
  ✓ bytesToHex converts Uint8Array to hex string
  ✓ bytesToBase64 converts small and large Uint8Array chunks
ENCODING TESTS: 4 passed, 0 failed

Running Client Cryptography & Zero-Knowledge Tests...
=== Testing Client Cryptography & Zero-Knowledge Pre-Hashing ===
  ✓ Verifier is a string
  ✓ Verifier is 64-character hex (32 bytes)
  ✓ Verifier derivation is deterministic for same password & email
  ✓ Different passwords yield distinct verifiers
  ✓ Domain separation prevents cross-email credential reuse
  ✓ Extracts exactly 12 words
  ✓ Extracted phrase has 12 space-separated words
  ✓ First word matches expected
  ✓ 12th word matches expected
  ✓ Short password is non-compliant
  ✓ Short password scores 1 (Weak)
  ✓ Complex password is compliant
  ✓ Complex password scores 4 (Strong)
  ✓ All criteria satisfied
CRYPTO TESTS: 14 passed, 0 failed

Running B2B Graduated Pricing Math Tests...
PRICING MATH TESTS: 71 passed, 0 failed

Running Domains API Tests...
DOMAINS API TESTS: 4 passed, 0 failed

Running Mailboxes API Tests...
Running Mailboxes API Client Tests...
  ✓ listMailboxes returns array of mailboxes
  ✓ getMailbox fetches a single mailbox
  ✓ deleteMailbox deletes a mailbox
  ✓ impersonateMailbox requests impersonation session
  ✓ rotateRoot rotates recovery root secret
  ✓ alias operations create, list, and delete aliases
  ✓ listOrgAliases fetches organization level aliases
  ✓ inviteMailbox sends privacy_mode: 'private'
  ✓ handles non-200 HTTP error responses
MAILBOXES API TESTS: 9 passed, 0 failed

Running Onboarding Wizard API Tests...
  ✓ getOnboardingState returns valid state structure
  ✓ setupDomain sends domain and receives DNS records preview
  ✓ verifyDomain handles development verification response
  ✓ selectStorageMode verifies org_managed and handles error
  ✓ connectStorage executes probe and returns verified status
  ✓ completeOnboarding resets onboarding_skipped to false
ONBOARDING API TESTS: 6 passed, 0 failed

Running Product Tour Step Definitions & Client Tests...
Running Product Tour Step Definitions & Client Tests...
  ✓ Tour ID is control_plane_v1
  ✓ Expected exactly 7 steps, got 7
  ✓ Step 1 anchor is [data-testid="dashboard-overview"]
  ✓ Step 1 has title: "Welcome to BYOS Control Panel"
  ✓ Step 1 has description
  ✓ Step 2 anchor is [data-testid="nav-domains"]
  ✓ Step 2 has title: "Verified Domains"
  ✓ Step 2 has description
  ✓ Step 3 anchor is [data-testid="nav-mailboxes"]
  ✓ Step 3 has title: "Cryptographic Mailboxes"
  ✓ Step 3 has description
  ✓ Step 4 anchor is [data-testid="nav-members"]
  ✓ Step 4 has title: "Team & Role Access"
  ✓ Step 4 has description
  ✓ Step 5 anchor is [data-testid="nav-storage"]
  ✓ Step 5 has title: "Storage Governance"
  ✓ Step 5 has description
  ✓ Step 6 anchor is [data-testid="nav-billing"]
  ✓ Step 6 has title: "Seat-Based Capacity"
  ✓ Step 6 has description
  ✓ Step 7 anchor is [data-testid="nav-settings"]
  ✓ Step 7 has title: "Security & Governance"
  ✓ Step 7 has description
  ✓ fetchTourState hits /v1/tours/state (/v1/tours/state)
  ✓ fetchTourState decodes response payload correctly
  ✓ recordTourComplete hits /complete endpoint
  ✓ recordTourComplete uses POST
  ✓ recordTourComplete transmits last_step: 7 in body
  ✓ recordTourSkip hits /skip endpoint
  ✓ recordTourSkip uses POST
  ✓ recordTourSkip transmits last_step: 3 in body
  ✓ recordTourReset hits /reset endpoint
  ✓ recordTourReset uses POST
PRODUCT TOUR TESTS: 33 passed, 0 failed

Running Global Search & Navigation Tests...
  ✓ filterNavigation returns empty array for empty or blank query
  ✓ filterNavigation matches navigation title exactly and fuzzily
  ✓ filterNavigation matches navigation keywords
  ✓ searchOrganization returns navigation without API call when query is empty
  ✓ NAVIGATION_DESTINATIONS covers all main Control Panel destinations
SEARCH TESTS: 5 passed, 0 failed

Running Client TOTP Utility Tests...
TOTP TESTS: 5 passed, 0 failed

Running 2FA API Client Tests...
2FA API TESTS: 5 passed, 0 failed

Running Active Sessions & Password Recovery API Tests...
SESSIONS & PWD RECOVERY TESTS: 7 passed, 0 failed
```

### 3. Webmail Client Suite Paste
Command:
```cmd
npm test
```
Output:
```
  ✓ 3. MessageRow formatSmartDate formats scheduled dates correctly
  ✓ 4. DisplayMessage folder supports 'scheduled'
  ✓ 5. Scheduled message error placeholders conform to specification
  ✓ 6. Folder threading support accurately distinguishes flat-by-design folders
  ✓ 7. Edit then discard leaves scheduled item untouched
  ✓ 8. Edit then save with body change updates same row in place
  ✓ 9. Edit then save with time change updates send_at on same row
  ✓ 10. Edit then save with no changes preserves all attributes without orphan drafts
  ✓ 11. Failed schedule surfaces specific backend error step, not generic wrapper
  ✓ 12. Schedule send with locked mailbox key surfaces actionable unlock message
  ✓ 13. Real-time event message.deleted removes scheduled item from list live
  ✓ 14. Real-time event message.created adds delivered sent copy to Sent folder live
  ✓ 15. Delivery failure event moves message to Drafts with sendFailed marker live
SCHEDULED FOLDER TESTS: 15 passed, 0 failed

Running Display Party Tests...
Running Display Party & Sent Folder Tests...
  ✓ 1. formatAddress extracts clean display name or email
  ✓ 2. Inbox row renders sender, not recipient
  ✓ 3. Archive, spam, trash, and search rows render sender
  ✓ 4. Sent row renders recipient, not sender
  ✓ 5. Sent row with multiple recipients renders first +N
  ✓ 6. Drafts row with no recipient renders 'No recipient'
  ✓ 7. Scheduled folder renders recipient(s) and first +N
  ✓ 8. Threaded Sent row renders the recipient of the latest message
  ✓ 9. Sent folder rows are never treated as unread
DISPLAY PARTY TESTS: 9 passed, 0 failed

Running Nested Labels Tests...
  PASS: test_sidebar_renders_tree
  PASS: test_parent_click_filters_descendants
  PASS: test_expand_state_persists
  PASS: test_reparent_cycle_blocked_ui
NESTED LABELS TESTS: 4 passed, 0 failed

Running API Error Handling Tests...
Running API Error Handling Tests...
  ✓ test_api_error_propagates_not_swallowed: fetchMailboxes throws on 500
  ✓ test_api_error_propagates_not_swallowed: fetchDrafts, fetchFolders, fetchLabels, fetchContacts throw on 500
  ✓ test_successful_return_shape: api client returns data on 200
  ✓ test_global_error_banner_renders: set and clear global error signal
API ERROR HANDLING TESTS: 4 passed, 0 failed

Running Unified Inbox Tests...
Running Unified Inbox Tests...
  ✓ test_unified_inbox_merges_accounts
  ✓ test_account_chip_renders
  ✓ test_reply_uses_message_account
  ✓ test_unified_search_deduplicates
  ✓ test_snooze_uses_correct_account_endpoint
  ✓ test_multi_sse_routing
  ✓ test_account_chip_shows_current_selection
  ✓ test_dropdown_lists_all_accounts
  ✓ test_selecting_account_updates_folders
  ✓ test_selecting_all_inboxes_shows_aggregate
  ✓ test_account_chip_color_matches_selection
  ✓ test_key_resolution_uses_owning_mailbox
  ✓ test_key_locked_prompts_for_correct_account
  ✓ test_unlock_retries_decrypt
  ✓ test_global_key_signal_never_used_in_unified_path
  ✓ test_popup_hides_all_inboxes_with_one_account
  ✓ test_popup_shows_all_inboxes_with_two_accounts
  ✓ test_popup_shows_all_inboxes_with_three_accounts
  ✓ test_selection_resets_on_account_removal
UNIFIED INBOX TESTS: 19 passed, 0 failed

Running Masked Email Tests...
Running Masked Email Tests...
  ✓ 1. TestBuildMimeStringIncludesAliasHeaders
  ✓ 2. TestBuildPendingSendPayloadWithFromAlias
  ✓ 3. TestRestoreComposeStateWithFromAlias
  ✓ 4. TestMaskedAliasAPIFunctions
  ✓ 5. TestMaskedAliasRateLimitErrorHandling
  ✓ 6. TestMessageMetadataReplyViaAlias
  ✓ 7. test_custom_alias_validation_shows_errors
  ✓ 8. test_custom_alias_preview_updates
  ✓ 9. test_custom_alias_409_shows_friendly_error
  ✓ 10. test_random_mode_hides_custom_input
  ✓ 11. TestCreateCustomAliasAPI
MASKED EMAIL TESTS: 11 passed, 0 failed

Running Focused Inbox Tests...
Running Focused Inbox Classifier Tests...
  ✓ 1. TestPrimaryClassificationForDirectHumanMail
  ✓ 2. TestNewslettersClassificationHeaders
  ✓ 3. TestSocialClassificationForSocialDomains
  ✓ 4. TestNotificationsClassificationSignals
  ✓ 5. TestClassificationPrecedenceOrder
  ✓ 6. TestOverridesPrecedence
FOCUSED INBOX TESTS: 6 passed, 0 failed

Running Offline Support Tests...
  ✓ 1. Cache stores 50 messages, prunes older
  ✓ 2. Cached content is ciphertext, not plaintext
  ✓ 3. Unsealed keys NOT present in IndexedDB
  ✓ 4. Send queue persists items with client_queue_id UUID
  ✓ 5. Queue replay sends items in FIFO order
[send_queue] Failed to replay item 00000000-0000-0000-0000-000000000005: Error: invalid recipient rejected by server
    at sendInternal (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:380:17)
    at replayQueue (F:\Codex\byos-email\apps\webmail\src\send_queue.ts:158:15)
    at async <anonymous> (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:375:7)
    at async test (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:200:7)
    at async runOfflineTests (F:\Codex\byos-email\apps\webmail\src\offline.test.ts:357:5)
    at async main (file:///F:/Codex/byos-email/apps/webmail/src/run_test.node.js:188:22)
  ✓ 6. Replay handles server 200 (removes item) and server error (marks failed)
  ✓ 7. Clear offline cache deletes all stores and SW caches
OFFLINE SUPPORT TESTS: 7 passed, 0 failed

Running Composer Sanitizer Tests...
Running Composer Sanitizer Tests...
  ✓ test_sanitize_strips_script_tags
  ✓ test_sanitize_strips_onclick_handlers
  ✓ test_sanitize_strips_javascript_hrefs
  ✓ test_sanitize_allows_safe_tags
  ✓ test_sanitize_allows_byos_storage_images
  ✓ test_sanitize_blocks_remote_images_by_default
  ✓ test_sanitize_preserves_table_structure
  ✓ test_sanitize_preserves_code_blocks
  ✓ test_paste_from_word_strips_wrapper_html
COMPOSER SANITIZER TESTS: 9 passed, 0 failed

Running Contacts Management Tests...
Running Contacts Management & Autocomplete Tests...
  ✓ test_contact_list_renders
  ✓ test_contact_search_filters
  ✓ test_contact_create_validates_email
  ✓ test_contact_delete_confirms
  ✓ test_autocomplete_shows_matches
  ✓ test_autocomplete_adds_chip
  ✓ test_autocomplete_deduplicates
CONTACTS MANAGEMENT TESTS: 7 passed, 0 failed

Running Sidebar Borderless Tests...
Running Sidebar Borderless Tests...
  ✓ test_sidebar_has_no_border
  ✓ test_sidebar_and_main_share_background
SIDEBAR BORDERLESS TESTS: 2 passed, 0 failed

Running Profile Photo Tests...
Running Profile Photo & Avatar Tests...
  ✓ test_fallback_avatar_renders_initial_and_color
  ✓ test_sidebar_renders_photo_when_set
  ✓ test_sidebar_renders_fallback_when_no_photo
  ✓ test_photo_crypto_roundtrip
PROFILE PHOTO TESTS: 4 passed, 0 failed

Running Persistent Session Tests...
Running Persistent Session Tests...
  ✓ 1. Device key is non-extractable AES-GCM 256-bit
  ✓ 2. Key sealing and unsealing roundtrip preserves all sensitive fields
  ✓ 3. Tampered ciphertext rejects decryption
  ✓ 4. Full lifecycle: savePersistentSession, restorePersistentSession, clearPersistentSession
[persistent-session] Token has expired. Purging persistent session.
  ✓ 5. Expired token rejects restoration and purges storage
[persistent-session] Token rejected by server (HTTP 401). Purging persistent session.
  ✓ 6. Server rejection (401 revoked) rejects restoration and purges storage
  ✓ 7. Plaintext passkey vault remediation: purges legacy entries and forbids plaintext storage
  ✓ 8. Separation between passkey authentication and mailbox decryption
PERSISTENT SESSION TESTS: 8 passed, 0 failed

Running OAuth Import Tests...
  ✓ encryptTokenPayload and decryptTokenPayload round-trip
  ✓ Tampered token ciphertext is rejected by decryptTokenPayload
  ✓ encryptRawEml generates Section 12 AES-GCM envelope
  ✓ parseRfc822Headers extracts From, To, Cc, Subject, Date, and attachments
  ✓ fetchWithBackoff respects 429 Retry-After header
  ✓ fetchWithBackoff aborts immediately when signal triggered
OAUTH IMPORT TESTS: 6 passed, 0 failed

OVERALL: 282 passed, 0 failed
```
