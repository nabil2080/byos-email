# WebAuthn "Invalid Domain" Runtime Investigation Report

## What was built
Investigated the local BYOS passkey registration runtime failure ("Invalid domain"), identified the browser WebAuthn API security boundary mismatch caused by accessing the application via `http://127.0.0.1:3000` with RP ID `localhost`, eliminated silent IP coercion across frontend passkey handlers, added clear user warnings against IP-based WebAuthn access, and renamed the misleading "Trigger Biometric Sensor" button to "Create Passkey" ("Verifying with Windows Hello…").

## Files edited
| File | Reason |
|------|--------|
| `apps/control-plane/src/routes/dashboard/security.tsx` | Renamed button to "Create Passkey", removed silent 127.0.0.1 coercion, added explicit warning when visiting via IP. |
| `apps/control-plane/src/routes/login.tsx` | Removed silent 127.0.0.1 hostname rewrite during passkey login. |
| `apps/webmail/src/routes/settings/SecurityTab.tsx` | Renamed button to "Create Passkey", removed silent 127.0.0.1 coercion, added explicit IP warning. |
| `apps/webmail/src/App.tsx` | Removed silent 127.0.0.1 hostname rewrite during Webmail passkey login. |
| `tests/browser/domain_reproduction.mjs` | Automated script reproducing and verifying browser WebAuthn RP ID domain matching behavior. |

## Raw evidence

### 1. Registration-Options API Handler and WebAuthn Configuration
Handler: `passkeyRegisterOptionsHandler` in `services/api/passkeys.go` using `getWebAuthnConfig(r)` from `services/api/webauthn_config.go`.
Command:
```powershell
curl.exe -s -X GET http://localhost:8080/v1/auth/passkeys/register-options -H "Authorization: Bearer DW96dTUOKN-cLAklydpxtgKxePr45N3jWeHRG5sf1rM" -H "Origin: http://localhost:3000"
```
Output:
```json
{"authenticatorSelection":{"requireResidentKey":false,"residentKey":"preferred","userVerification":"preferred"},"challenge":"oOOZiJekAuk-EWF2zYSDVf6x3gacq9r69Hy1ZZOgEaM","pubKeyCredParams":[{"alg":-7,"type":"public-key"},{"alg":-257,"type":"public-key"},{"alg":-8,"type":"public-key"}],"rp":{"id":"localhost","name":"BYOS Secure Email"},"timeout":60000,"user":{"displayName":"alice@byos.local","id":"Y2NjY2NjY2MtMDAwMC0wMDAwLTAwMDAtMDAwMDAwMDAwMDAy","name":"alice@byos.local"}}
```

### 2. Exact RP ID Returned
The exact RP ID in the registration options payload is:
`"localhost"`

### 3. Actual Browser Origin Used
The browser was navigating to `http://127.0.0.1:3000`.

### 4. RP ID and Origin Matching
While `http://127.0.0.1:3000` is present in CORS `BYOS_ALLOWED_ORIGINS`, per W3C WebAuthn §5.4.3, Relying Party identifiers must be an effective domain or registrable domain suffix of the origin host. The W3C specification expressly forbids IP addresses as RP IDs, and the browser refuses to associate RP ID `localhost` with the host `127.0.0.1`.

### 5. Environment Variables & Runtime Configuration in byos-api Container
Command:
```powershell
docker exec byos-api printenv
```
Output:
```text
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HOSTNAME=e45eed0e35fb
BYOS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,http://localhost:3001,http://127.0.0.1:3002,http://localhost:3002,http://127.0.0.1:3003,http://localhost:3003,http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:4321,http://localhost:4321,http://127.0.0.1:5173,http://localhost:5173
DATABASE_URL=postgres://byos:byos_dev_password@postgres:5432/byos
REDIS_ADDR=redis:6379
RSPAMD_ADDR=rspamd:11334
BYOS_DEV_MODE=
STORAGE_HEALTH_INTERVAL=300
CRYPTO_WORKER_URL=http://crypto-worker:8084
STORAGE_WORKER_INTERNAL_KEY_FILE=/run/secrets/storage_worker_internal_key
OUTBOUND_DELIVERY_PK_FILE=/run/secrets/outbound_delivery_pk
MINIO_ADDR=minio:9000
POSTFIX_ADDR=postfix:25
BYOS_ENV=development
BYOS_LEGACY_AUTH_ENABLED=false
INTERNAL_API_KEY_FILE=/run/secrets/internal_api_key
HOME=/
```

### 6. Running Container Source Inspection
Command:
```powershell
docker inspect byos-api --format '{{.Created}} | Image: {{.Image}}'
docker exec byos-api ls -la /app/api
```
Output:
```text
2026-10-18T16:42:50.228128349Z | Image: sha256:f161d2e3775793d5c8359d2401eb6dab0969f9a6bbe839feeabbe2640e42ca29
-rwxr-xr-x    1 root     root      19518561 Oct 18 16:42 /app/api
```
The running container was built on Oct 18 16:42:50 UTC and is running the pre-remediation binary.

### 7. Origin of "Invalid domain"
The error originates directly from Chromium's internal WebAuthn implementation inside `navigator.credentials.create()`, throwing `DOMException: SecurityError: This is an invalid domain.` (code 18).

### 8. Verification of navigator.credentials.create() Execution
Command:
```powershell
node tests/browser/domain_reproduction.mjs
```
Output:
```text
Testing origin http://127.0.0.1:3000 with rp.id 'localhost':
Result (127.0.0.1): {"name":"SecurityError","message":"This is an invalid domain.","code":18}

Testing origin http://localhost:3000 with rp.id 'localhost':
Result (localhost): {"name":"NotAllowedError","message":"The operation either timed out or was not allowed. See: https://www.w3.org/TR/webauthn-2/#sctn-privacy-considerations-client.","code":0}
```

### 9. Distinguishing RP ID/Origin from Authenticator/Windows Hello Errors
Because Chromium throws `SecurityError: This is an invalid domain.` synchronously during client argument validation, execution never reached the platform authenticator or Windows Hello. When tested on `http://localhost:3000`, the domain check passed immediately.

## Manual browser verification
Executed `node tests/browser/test_passkeys_browser.mjs` using headless Chrome:
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

--- [STEP 2] Real Login to Control Panel as Alice ---
  PASS: Alice successfully landed on Dashboard (url: http://localhost:3000/dashboard)

--- [STEP 3] Navigate to Security Governance & Audit Passkey Section ---
  [BROWSER CONSOLE ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
  PASS: Passkeys & Biometric Security section is rendered
  PASS: Warning banner 'Passkey Verification Temporarily Paused' has been removed
  PASS: Register New Passkey button is present
  PASS: Register New Passkey button is enabled and clickable

--- [STEP 4] Open Passkey Enrollment Modal ---
  PASS: Passkey modal opened with title: 'Enroll Passkey / Biometric Authenticator'
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\control_plane_passkey_modal.png
  DevTools Storage State at assertion: {"localStorageKeys":["byos_cp_session_token"],"sessionStorageKeys":[],"cookiesLength":0}

--- [STEP 5] Inspect Webmail Login Page Passkey Option ---
  PASS: Webmail login page has 'Sign in with Passkey' button
  PASS: Webmail Passkey login button is enabled
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\webmail_passkey_login_btn.png

--- [STEP 6] Responsive Viewport Audit (375px Mobile Viewport) ---
  [BROWSER CONSOLE ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
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
- **UNTESTED**: Actual Windows Hello platform biometric signature generation by a human user in a live browser window, because automated CI and headless Chromium do not have access to the user's interactive Windows Hello biometric hardware.

## Test suite output

### Control Panel Test Suite (`apps/control-plane`)
Command:
```powershell
cmd /c npm test
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

### Webmail Test Suite (`apps/webmail`)
Command:
```powershell
cmd /c npm test
```
Output:
```text
SCHEDULED FOLDER TESTS: 15 passed, 0 failed
DISPLAY PARTY TESTS: 9 passed, 0 failed
NESTED LABELS TESTS: 4 passed, 0 failed
API ERROR HANDLING TESTS: 4 passed, 0 failed
UNIFIED INBOX TESTS: 19 passed, 0 failed
MASKED EMAIL TESTS: 11 passed, 0 failed
FOCUSED INBOX TESTS: 6 passed, 0 failed
OFFLINE SUPPORT TESTS: 7 passed, 0 failed
COMPOSER SANITIZER TESTS: 9 passed, 0 failed
CONTACTS MANAGEMENT TESTS: 7 passed, 0 failed
SIDEBAR BORDERLESS TESTS: 2 passed, 0 failed
PROFILE PHOTO TESTS: 4 passed, 0 failed
PERSISTENT SESSION TESTS: 8 passed, 0 failed
OAUTH IMPORT TESTS: 6 passed, 0 failed
OVERALL: 282 passed, 0 failed
```

### Go API Test Suite (Disposable DB)
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v ./... -run "Passkey|WebAuthn"
```
Output:
```text
=== RUN   TestWebAuthnConfiguration
--- PASS: TestWebAuthnConfiguration (0.00s)
=== RUN   TestPasskeyLoginUnauthenticatedFailures
--- PASS: TestPasskeyLoginUnauthenticatedFailures (0.00s)
=== RUN   TestPasskeyEndpointsRequireAuth
--- PASS: TestPasskeyEndpointsRequireAuth (0.00s)
=== RUN   TestPasskeyCloneWarningDetection
--- PASS: TestPasskeyCloneWarningDetection (0.00s)
=== RUN   TestPasskeyIntegrationWithDisposableDB
    passkeys_test.go:371: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestPasskeyIntegrationWithDisposableDB (0.34s)
=== RUN   TestMFAConsistencyAndPasskeyPolicy
    recovery_flow_test.go:653: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestMFAConsistencyAndPasskeyPolicy (0.27s)
=== RUN   TestPasskeyOnlyUserMFAExperience
    recovery_flow_test.go:910: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestPasskeyOnlyUserMFAExperience (0.73s)
PASS
ok  	byos.email/services/api	2.859s
```
