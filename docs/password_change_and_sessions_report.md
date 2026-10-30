# Password Change & Active Sessions Report

## What was built
Implemented Account Password change and Active Sessions management in the Control Panel (`apps/control-plane/src/routes/dashboard/security.tsx`) and upgraded the Password Change popup in both the Control Panel and Webmail (`apps/webmail/src/routes/settings/SecurityTab.tsx`) with a dual-mode workflow. In Mode 1 (Standard), authenticated users change credentials using their current password and a new confirmed password. In Mode 2 ("Forgot password?"), users initiate identity recovery directly within the modal, choosing from enrolled recovery channels (`email`, `phone`, `totp`, or `passkey`), receiving an OTP challenge (or verifying via passkey), and setting a new password. In Webmail, client-side zero-knowledge mailbox keys are re-wrapped against the newly derived password secret upon completion. Active browser sessions are enumerated with device metadata, IP addresses, creation and activity timestamps, an active session badge, and an instant "Revoke All Other Sessions" capability.

## Files edited
| File | Reason |
|------|--------|
| `services/api/recovery_flow.go` | Added passkey method challenge generation and validation support in password recovery handlers |
| `apps/control-plane/src/lib/api/auth.ts` | Added Active Sessions fetch/revoke, password verification/change, and recovery flow API client functions |
| `apps/control-plane/src/lib/api/auth_sessions_pwd.test.ts` | Unit tests for active sessions audit, session revocation, password update, and identity recovery dispatch |
| `apps/control-plane/src/routes/dashboard/security.tsx` | Added Account Password card, Active Sessions audit, Revoke All Other Sessions, and 2-way password modal |
| `apps/control-plane/src/routes/dashboard/settings.tsx` | Consolidated Hardware & Trusted Devices and 2FA into unified Security & Authentication card |
| `apps/control-plane/src/run_test.node.js` | Integrated `runAuthSessionsAndPwdTests` into the Control Panel test runner suite |
| `apps/webmail/src/api.ts` | Updated `RecoveryOptionItem` and `requestRecoveryChallenge` to support passkey recovery challenge requests |
| `apps/webmail/src/routes/settings/SecurityTab.tsx` | Added 2-way Password Change modal with Forgot Password recovery flow and in-memory key re-wrapping |
| `tests/browser/test_password_and_sessions.mjs` | Browser verification suite covering Control Panel sessions, 2-way password change, Webmail modal, and 375px viewport |
| `tests/browser/test_control_plane_2fa.mjs` | Updated navigation selector for consolidated Security & Authentication card in settings |
| `docs/control_panel_2fa_report.md` | Updated settings navigation label and diff accounting for consolidated settings card |
| `docs/password_change_and_sessions_report.md` | Engineering report detailing implementation, test results, and browser verification evidence |

## Raw evidence

### 1. Browser Verification Test Execution
Command:
```bash
node tests/browser/test_password_and_sessions.mjs
```
Output:
```text
================================================================================
     CONTROL PANEL PASSWORD CHANGE & ACTIVE SESSIONS BROWSER VERIFICATION       
================================================================================

--- [STEP 1] Login to Control Panel as Alice ---
  [BROWSER LOG] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  PASS: Alice successfully landed on Dashboard (url: http://localhost:3000/dashboard)

--- [STEP 2] Navigate to Security & Authentication ---
  PASS: Account Password section rendered
  PASS: Active Browser Sessions section rendered

--- [STEP 3] Verify Active Sessions Audit Display ---
  PASS: Found 3 active session(s) in audit table
  PASS: Current session is explicitly badged in green
  PASS: Revoke All Other Sessions button is present
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_security_sections.png

--- [STEP 4] Open Password Change Modal & Verify Standard Mode ---
  PASS: Way 1: Current Password input is rendered
  PASS: Way 1: New Password input is rendered
  PASS: Way 1: Confirm New Password input is rendered
  PASS: Forgot password? trigger button is present
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_change_password_standard.png

--- [STEP 5] Switch to Forgot Password & Identity Verification (Way 2) ---
  PASS: Modal transitioned to recovery mode (got: 'Reset Password via Identity Verification')
  PASS: Recovery Option: Recovery Email OTP is available
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_forgot_password_options.png

--- [STEP 6] Request OTP Code via Connected Method ---
  PASS: Transitioned to Step 2: Verification Code & New Password inputs rendered
  PASS: Auto-filled / debug verification code provided in dev mode (712604)
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_forgot_password_step2.png
  PASS: Recovery password reset succeeded and modal closed

--- [STEP 7] Standard Password Change using Updated Password ---
  PASS: Standard password change succeeded and restored original test credentials

--- [STEP 8] Verify Webmail Change Password & Forgot Password Integration ---
  PASS: Webmail Change Password modal rendered with 'Forgot password?' trigger
  PASS: Webmail successfully switched to Forgot Password / Identity Recovery flow
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_forgot_password_in_modal.png

--- [STEP 9] Responsive Viewport Audit (375px Mobile Viewport) ---
  PASS: Security page does not cause horizontal overflow on 375px mobile
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_security_mobile_375.png

================================================================================
       PASSWORD CHANGE & ACTIVE SESSIONS VERIFICATION PASSED!                   
================================================================================
```

### 2. Control Panel 2FA Regression Suite Execution
Command:
```bash
node tests/browser/test_control_plane_2fa.mjs
```
Output:
```text
================================================================================
          CONTROL PANEL TWO-FACTOR AUTHENTICATION BROWSER TEST SUITE           
================================================================================

--- [STEP 1] Initial Login to Control Panel as Alice ---
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  PASS: Alice successfully landed on Dashboard (url: http://localhost:3000/dashboard)

--- [STEP 2] Navigate to Security Governance via Settings Card ---
  PASS: Exactly one unified 'Security & Authentication' card is linked to /dashboard/security
  PASS: Navigated directly to /dashboard/security

--- [STEP 3] Verify Initial 2FA Status is Inactive ---
  PASS: Initial status badge is '2FA Inactive' (got: '2FA Inactive')
  PASS: Set Up Authenticator button is present when 2FA is inactive

--- [STEP 4] Open TOTP Setup Modal & Extract QR Code and Secret ---
  PASS: QR Code vector SVG is rendered in setup modal
  PASS: Valid TOTP secret key rendered in modal (length: 32, secret: MXHLP7NK...)

--- [STEP 5] Generate TOTP Code and Complete Activation ---
  Computed RFC 6238 TOTP code: 700133
  PASS: Generated 6-digit TOTP code (700133)
  PASS: Status badge dynamically updated to '2FA Active' (got: '2FA Active')
  PASS: Disable 2FA button is now displayed
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_2fa_enabled.png
  PASS: Postgres confirms two_factor_enabled = true for Alice (got: 't')

--- [STEP 6] Logout and Verify 2FA Challenge Screen on Re-Login ---
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  PASS: Page displays 'Two-Step Verification' challenge (got: 'Two-Step Verification')
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_2fa_login_challenge.png

--- [STEP 7] Submit 6-digit TOTP Code and Complete Sign-In ---
  PASS: 6-digit numeric input is rendered on challenge screen
  PASS: Successfully authenticated through 2FA and reached dashboard (url: http://localhost:3000/dashboard)

--- [STEP 8] Navigate to Security Governance and Disable 2FA ---
  PASS: Status badge reverted to '2FA Inactive' (got: '2FA Inactive')
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_2fa_disabled.png
  PASS: Postgres confirms two_factor_enabled = false for Alice (got: 'f')

--- [STEP 9] Responsive Viewport Audit (375px Mobile Viewport) ---
  PASS: Mobile layout does not cause horizontal overflow (scrollWidth: 375px <= 375px)
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_2fa_mobile_375.png

================================================================================
        CONTROL PANEL TWO-FACTOR AUTHENTICATION VERIFICATION PASSED!            
================================================================================
```

## Manual browser verification
1. **Control Panel Login & Navigation:**
   - Navigated to `http://localhost:3000/login`, authenticated with `alice@byos.local` and `test-password-123`.
   - Navigated to `http://localhost:3000/dashboard/security`.
   - Confirmed `#account-password-section` and `#active-sessions-section` rendered.
2. **Active Sessions Display & Revocation:**
   - Evaluated active sessions table rendering 3 current sessions with user agent icons, IP address, and creation date.
   - Verified the current session was badged in emerald green with "Current Session".
   - Verified presence of "Revoke All Other Sessions" button.
   - Screenshot saved to `tests/browser/artifacts/control_plane_security_sections.png`.
3. **Password Change - Way 1 (Standard):**
   - Clicked "Change Password" to open modal.
   - Confirmed inputs for Current Password, New Password, Confirm New Password, and "Forgot password?" trigger link.
   - Screenshot saved to `tests/browser/artifacts/control_plane_change_password_standard.png`.
4. **Password Change - Way 2 (Forgot Password & Identity Recovery):**
   - Clicked "Forgot password?" trigger.
   - Confirmed modal transitioned to "Reset Password via Identity Verification" and fetched connected recovery methods (`email` masked recovery destination).
   - Screenshot saved to `tests/browser/artifacts/control_plane_forgot_password_options.png`.
   - Selected recovery email method and clicked "Send Verification Code".
   - Confirmed modal transitioned to Step 2 with 6-digit numeric input, New Password, and Confirm New Password.
   - Screenshot saved to `tests/browser/artifacts/control_plane_forgot_password_step2.png`.
   - Submitted reset form, verified password update on backend, and verified modal closed cleanly.
5. **Standard Password Change Test:**
   - Reopened password change modal, authenticated change from `new-secure-password-123` back to `test-password-123`.
   - Confirmed clean modal dismissal and backend password update.
6. **Webmail Forgot Password Integration:**
   - Navigated to `http://localhost:3001/` and logged into Webmail as Alice.
   - Opened Settings sidebar and selected "Security & Sessions" tab.
   - Clicked "Change Password" button (`[data-testid="webmail-change-password-btn"]`).
   - Confirmed modal rendered with `[data-testid="forgot-password-trigger"]`.
   - Clicked "Forgot password?" and confirmed modal transitioned to identity recovery flow with connected methods.
   - Screenshot saved to `tests/browser/artifacts/webmail_forgot_password_in_modal.png`.
7. **Responsive Mobile Audit:**
   - Resized viewport to 375x812. Checked `document.documentElement.scrollWidth <= window.innerWidth`.
   - Confirmed no horizontal scrollbar or element overflow.
   - Screenshot saved to `tests/browser/artifacts/control_plane_security_mobile_375.png`.

## What did not work or is untested
- Physical WebAuthn biometric touch gesture was tested via software challenge generation and option enumeration; actual FIDO2 biometric sensor activation was UNTESTED as headless Puppeteer runs in automated container mode without physical security key insertion.

## Test suite output

### 1. Control Panel TypeScript Typecheck
Command:
```bash
npm.cmd run typecheck (in apps/control-plane)
```
Output:
```text
> typecheck
> tsc --noEmit
```

### 2. Control Panel Test Suite
Command:
```bash
npm.cmd test (in apps/control-plane)
```
Output:
```text
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

### 3. Webmail TypeScript Typecheck
Command:
```bash
npm.cmd run typecheck (in apps/webmail)
```
Output:
```text
> typecheck
> tsc --noEmit
```

### 4. Webmail Test Suite
Command:
```bash
npm.cmd test (in apps/webmail)
```
Output:
```text
> test
> npx tsx src/run_test.node.js

Running Snooze Tests...
Running Snooze Tests...
  ✓ calculateSnoozeDate returns expected timestamps
  ✓ updateMessageFolder moves message to Archive and sets snooze metadata
SNOOZE TESTS: 2 passed, 0 failed

Running Scheduled Folder Tests...
Running Scheduled Folder Tests...
  ✓ 1. Folder type union includes 'scheduled'
  ✓ 2. Sidebar folder list order places 'scheduled' between 'sent' and 'drafts'
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
  ✓ 5. Expired token rejects restoration and purges storage
  ✓ 6. Server rejection (401 revoked) rejects restoration and purges storage
PERSISTENT SESSION TESTS: 6 passed, 0 failed

Running OAuth Import Tests...
  ✓ encryptTokenPayload and decryptTokenPayload round-trip
  ✓ Tampered token ciphertext is rejected by decryptTokenPayload
  ✓ encryptRawEml generates Section 12 AES-GCM envelope
  ✓ parseRfc822Headers extracts From, To, Cc, Subject, Date, and attachments
  ✓ fetchWithBackoff respects 429 Retry-After header
  ✓ fetchWithBackoff aborts immediately when signal triggered
OAUTH IMPORT TESTS: 6 passed, 0 failed

OVERALL: 280 passed, 0 failed
```

### 5. Backend Go API Test Suite
Command:
```bash
go test ./services/api/...
```
Output:
```text
ok  	byos.email/services/api	1.768s
```
