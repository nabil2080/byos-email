# Real Email and SMS OTP Delivery Implementation Report

## What was built
Implemented production-grade outbound transactional email and SMS OTP delivery for BYOS local development and production environments. Created a unified outbound delivery subsystem supporting authenticated SMTP providers (STARTTLS/TLS) with branded multipart MIME templates and an extensible SMS provider interface supporting Twilio, Greenweb Bangladesh (local direct BTRC aggregator), Generic HTTP REST gateways, and Mock test modes. Enforced strict development recipient allowlisting restricting outbound delivery exclusively to `abdullahrawha30@gmail.com` and `+8801617856836` with Bangladesh E.164 phone normalization. Rebuilt OTP lifecycle security with 6-digit cryptographic randomness (`crypto/rand`), 5-minute expiration, 5 maximum verification attempts, 60-second resend cooldowns, HMAC-SHA256 database protection preventing plaintext code storage or logging, and constant-time comparison (`subtle.ConstantTimeCompare`).

## Files edited
| File | Reason |
|------|--------|
| `services/api/otp_delivery.go` | New outbound OTP subsystem supporting authenticated SMTP, SMS providers (Twilio, Greenweb, Generic, Mock), E.164 normalization, allowlist checks, HMAC hashing, cooldowns, and rate limiting. |
| `services/api/otp_delivery_test.go` | Comprehensive automated test suite for OTP generation, allowlist checks, Twilio submission/rejection, Greenweb submission, cooldowns, attempt invalidation, and database integration. |
| `services/api/auth.go` | Integrated `DispatchOTP` into `loginHandler` for 2FA challenge creation, eliminating plaintext logging and enforcing HMAC challenge persistence. |
| `services/api/two_factor.go` | Integrated `DispatchOTP` and `VerifyChallengeOTP` into `login2FASendCodeHandler`, `recoveryContactSendCodeHandler`, `recoveryContactConfirmHandler`, and `login2FAVerifyHandler`. |
| `services/api/recovery_flow.go` | Integrated `DispatchOTP` and HMAC verification into `recoveryFlowRequestHandler` and `recoveryFlowResetPasswordHandler`. |
| `infra/docker-compose.yml` | Added environment variable passthroughs for SMTP, SMS gateways, allowlists, and delivery mode. |
| `.env.example` | Documented required environment variables for live SMTP, Twilio, and Greenweb Bangladesh OTP delivery. |
| `tests/manual_otp_delivery_test.mjs` | Standalone manual verification script for sending real test OTPs to allowlisted email and phone destinations upon user credential supply and approval. |

## Raw evidence

### 1. Bangladesh E.164 Normalization and Development Allowlist
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; cd services/api; go test -v -count=1 -run 'TestBangladeshE164Normalization|TestDevRecipientAllowlistEnforcement' .
```
Output:
```text
=== RUN   TestBangladeshE164Normalization
--- PASS: TestBangladeshE164Normalization (0.00s)
=== RUN   TestDevRecipientAllowlistEnforcement
--- PASS: TestDevRecipientAllowlistEnforcement (0.00s)
PASS
ok  	byos.email/services/api	0.076s
```

### 2. Cryptographic Randomness and HMAC-SHA256 Storage Verification
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; cd services/api; go test -v -count=1 -run 'TestCryptographicOTPGenerationAndHMAC' .
```
Output:
```text
=== RUN   TestCryptographicOTPGenerationAndHMAC
--- PASS: TestCryptographicOTPGenerationAndHMAC (0.00s)
PASS
ok  	byos.email/services/api	0.074s
```

### 3. SMS Gateway Submission, Rejection, and Timeout Handling
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; cd services/api; go test -v -count=1 -run 'TestTwilioSMSProviderSubmissionAndRejection|TestGreenwebSMSProviderSubmission|TestGenericHTTPSMSProvider' .
```
Output:
```text
=== RUN   TestTwilioSMSProviderSubmissionAndRejection
--- PASS: TestTwilioSMSProviderSubmissionAndRejection (0.20s)
=== RUN   TestGreenwebSMSProviderSubmission
--- PASS: TestGreenwebSMSProviderSubmission (0.00s)
=== RUN   TestGenericHTTPSMSProvider
--- PASS: TestGenericHTTPSMSProvider (0.00s)
PASS
ok  	byos.email/services/api	0.278s
```

### 4. Resend Cooldown, Maximum Attempts, and Rate Limiting
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; cd services/api; go test -v -count=1 -run 'TestResendCooldownEnforcement|TestMaximumVerificationAttemptsInvalidation|TestOTPRateLimiting' .
```
Output:
```text
=== RUN   TestResendCooldownEnforcement
--- PASS: TestResendCooldownEnforcement (0.01s)
=== RUN   TestMaximumVerificationAttemptsInvalidation
--- PASS: TestMaximumVerificationAttemptsInvalidation (0.01s)
=== RUN   TestOTPRateLimiting
--- PASS: TestOTPRateLimiting (0.01s)
PASS
ok  	byos.email/services/api	0.088s
```

### 5. Disposable Database End-to-End Integration & Single-Use Consumption
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; cd services/api; go test -v -count=1 -run 'TestDispatchAndVerifyOTPEndToEnd' .
```
Output:
```text
=== RUN   TestDispatchAndVerifyOTPEndToEnd
2026/10/20 13:21:43 [OTP DISPATCH] (MOCK) Email OTP dispatched to a***0@gmail.com
--- PASS: TestDispatchAndVerifyOTPEndToEnd (0.04s)
PASS
ok  	byos.email/services/api	0.106s
```

## Manual browser verification
Browser suite `tests/browser/test_passkeys_browser.mjs` was executed to verify UI stability across Control Panel, settings, enrollment modals, and responsive mobile layouts:
Command:
```powershell
node tests/browser/test_passkeys_browser.mjs
```
Output:
```text
================================================================================
          WEBAUTHN PASSKEY USER INTERFACE & INTEGRATION VERIFICATION            
================================================================================

--- [STEP 1] Inspect Control Plane Login Page Passkey Option ---
  [BROWSER CONSOLE ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  PASS: Control Plane login page has 'Sign in with Passkey' button
  PASS: Passkey login button is enabled (not disabled)
  PASS: Passkey login button is visible in the viewport
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_passkey_login_btn.png

--- [STEP 2] Establish Authenticated Session as Alice ---
  PASS: Alice successfully landed on Dashboard (url: http://localhost:3000/dashboard)

--- [STEP 3] Navigate to Security Governance & Audit Passkey Section ---
  PASS: Passkeys & Biometric Security section is rendered
  PASS: Warning banner 'Passkey Verification Temporarily Paused' has been removed
  PASS: Register New Passkey button is present
  PASS: Register New Passkey button is enabled and clickable

--- [STEP 4] Open Passkey Enrollment Modal ---
  PASS: Passkey modal opened with title: 'Enroll Passkey / Biometric Authenticator'
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_passkey_modal.png
  DevTools Storage State at assertion: {"localStorageKeys":["byos_cp_session_token"],"sessionStorageKeys":[],"cookiesLength":59}

--- [STEP 5] Inspect Webmail Login Page Passkey Option ---
  PASS: Webmail login page has 'Sign in with Passkey' button
  PASS: Webmail Passkey login button is enabled
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_passkey_login_btn.png

--- [STEP 6] Responsive Viewport Audit (375px Mobile Viewport) ---
  PASS: Mobile layout does not cause horizontal overflow (scrollWidth: 375px <= clientWidth: 375px)
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\passkey_mobile_375.png

================================================================================
            WEBAUTHN PASSKEY BROWSER VERIFICATION SUITE PASSED!                 
================================================================================
```

Screenshots recorded in repository:
- `tests/browser/artifacts/control_plane_passkey_login_btn.png`
- `tests/browser/artifacts/control_plane_passkey_modal.png`
- `tests/browser/artifacts/webmail_passkey_login_btn.png`
- `tests/browser/artifacts/passkey_mobile_375.png`

## What did not work or is untested
- **UNTESTED**: Actual outbound network transmission to external SMTP and SMS telco networks during automated test runs. Automated tests run in mock mode with mock transport servers to prevent real charges or unexpected dispatches per instructions.
- The manual live delivery script `tests/manual_otp_delivery_test.mjs` has NOT been executed yet, per the instruction: *"Do not run this manual test until I have supplied the required provider credentials and explicitly approved the test sends."*

---

## Bangladesh SMS Gateways & Operator Analysis

Before activating an external SMS provider, here is the full analysis of supported gateways:

| Provider | Bangladesh Coverage | Sender ID Requirements | Authentication | Costs & Accounts |
|---|---|---|---|---|
| **Twilio** | Grameenphone, Robi/Airtel (`016`), Banglalink, Teletalk | Uses global shared routing pools or international numbers by default. Custom alphanumeric masking requires BTRC business document registration. | HTTP Basic Auth (`AccountSid` + `AuthToken`) | ~$0.0585 - $0.0650 USD / SMS. Requires funded Twilio account. |
| **Greenweb Bangladesh** (`api.greenweb.com.bd`) | 100% direct interconnects with Grameenphone, Robi, Banglalink, Teletalk | Non-masking available immediately. Alphanumeric masking requires Trade License submission per BTRC. | Simple API Token (`token=<API_TOKEN>`) | ~0.35 BDT (~$0.003 USD) / SMS. Instant local bKash/Nagad/Card top-up. |
| **Infobip** | All 4 Bangladesh operators | Pre-registered alphanumeric sender ID | API Key (`Authorization: App <KEY>`) | ~$0.045 - $0.055 USD / SMS. Enterprise contract. |
| **Generic HTTP** | Dependent on configured gateway (e.g. SSL Wireless SMS+, BulkSMSBD) | Configurable | Configurable HTTP header | Depends on upstream gateway. |

---

## Configuration & Credentials Required for Live Delivery

To enable live delivery, add the following variables to your local git-ignored `.env` file in the repository root:

```env
# 1. Enable Live Delivery Mode
OTP_DELIVERY_MODE=live
OTP_DEV_ALLOWED_EMAILS=abdullahrawha30@gmail.com
OTP_DEV_ALLOWED_PHONE_NUMBERS=+8801617856836
OTP_HMAC_SECRET=your-secure-otp-hmac-secret-string

# 2. Authenticated SMTP Provider (e.g., Gmail App Password, SendGrid, Amazon SES, Resend)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASSWORD=your-16-character-app-password
SMTP_FROM_ADDRESS=noreply@byos.local
SMTP_FROM_NAME="BYOS Security"
SMTP_ENCRYPTION=starttls

# 3. SMS Gateway (Option A: Twilio)
OTP_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+1234567890

# (Option B: Greenweb Bangladesh)
# OTP_SMS_PROVIDER=greenweb
# GREENWEB_TOKEN=your_greenweb_api_token
```

---

## Test suite output

### Go API OTP Test Suite (Disposable DB)
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; cd services/api; go test -v -count=1 -run 'TestBangladesh|TestDevRecipient|TestCryptographic|TestTwilio|TestGreenweb|TestGenericHTTP|TestEmailOTP|TestResendCooldown|TestMaximumVerification|TestOTPRateLimiting|TestDispatchAndVerify' .
```
Output:
```text
=== RUN   TestBangladeshE164Normalization
--- PASS: TestBangladeshE164Normalization (0.00s)
=== RUN   TestDevRecipientAllowlistEnforcement
--- PASS: TestDevRecipientAllowlistEnforcement (0.00s)
=== RUN   TestCryptographicOTPGenerationAndHMAC
--- PASS: TestCryptographicOTPGenerationAndHMAC (0.00s)
=== RUN   TestTwilioSMSProviderSubmissionAndRejection
--- PASS: TestTwilioSMSProviderSubmissionAndRejection (0.20s)
=== RUN   TestGreenwebSMSProviderSubmission
--- PASS: TestGreenwebSMSProviderSubmission (0.00s)
=== RUN   TestGenericHTTPSMSProvider
--- PASS: TestGenericHTTPSMSProvider (0.00s)
=== RUN   TestEmailOTPTemplateRendering
--- PASS: TestEmailOTPTemplateRendering (0.00s)
=== RUN   TestResendCooldownEnforcement
--- PASS: TestResendCooldownEnforcement (0.01s)
=== RUN   TestMaximumVerificationAttemptsInvalidation
--- PASS: TestMaximumVerificationAttemptsInvalidation (0.01s)
=== RUN   TestOTPRateLimiting
--- PASS: TestOTPRateLimiting (0.01s)
=== RUN   TestDispatchAndVerifyOTPEndToEnd
2026/10/20 13:21:43 [OTP DISPATCH] (MOCK) Email OTP dispatched to a***0@gmail.com
--- PASS: TestDispatchAndVerifyOTPEndToEnd (0.04s)
PASS
ok  	byos.email/services/api	1.826s
```

### Control Panel Test Suite (`apps/control-plane`)
Command:
```powershell
cd apps/control-plane; cmd /c npm test
```
Output:
```text
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
MAILBOXES API TESTS: 9 passed, 0 failed

Running Onboarding Wizard API Tests...
ONBOARDING API TESTS: 6 passed, 0 failed

Running Product Tour Step Definitions & Client Tests...
PRODUCT TOUR TESTS: 33 passed, 0 failed

Running Global Search & Navigation Tests...
SEARCH TESTS: 5 passed, 0 failed

Running Client TOTP Utility Tests...
TOTP TESTS: 5 passed, 0 failed

Running 2FA API Client Tests...
2FA API TESTS: 5 passed, 0 failed

Running Active Sessions & Password Recovery API Tests...
SESSIONS & PWD RECOVERY TESTS: 7 passed, 0 failed
```

---

## Instructions for Executing the Manual Live Delivery Test

Once you have added your real provider credentials (SMTP and Twilio/Greenweb) to your `.env` and restarted the API container with `docker compose -f infra/docker-compose.yml up -d api`, run the interactive manual delivery verification script:

```powershell
node tests/manual_otp_delivery_test.mjs
```

1. The script will prompt you for explicit approval before initiating external network requests.
2. It sends one real Email OTP to `abdullahrawha30@gmail.com` via your configured SMTP server.
3. You will enter the 6-digit code received in your Gmail inbox to confirm verification.
4. It sends one real SMS OTP to `+8801617856836` via your configured SMS provider.
5. You will enter the 6-digit code received on your phone to complete verification.
