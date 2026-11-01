# Security Remediation & Production Readiness Final Acceptance Report

## What was built
Remediated outstanding security audit findings across all four frontend applications (Public Site, Dashboard / Control Plane, Webmail, Support CRM) and backend microservices (Core API, Admin API). Converted Control Plane session authentication to strictly rely on server-managed `HttpOnly`, `SameSite=Lax`, `Secure` cookies (`byos_cp_session`) and completely removed persistent bearer token storage in `localStorage`. Eliminated inappropriate client-side Shannon entropy token gating in `apps/control-plane/src/lib/api/client.ts` in favor of authoritative server-side session hash validation. Hardened Admin API and Support CRM with constant-time token comparison, environment-restricted mock token boundaries, and scoped CORS headers. Isolated DOMPurify sanitizer hooks with deterministic cleanup to prevent cross-call hook retention, stripped dangerous CSS and redirection tags (`<style>`, `<head>`, `<meta>`) from email signatures, and upgraded DOMPurify to resolve upstream CVEs. Centralized database pool lifecycle management with configurable pool limits (`DB_POOL_MIN_CONNS`, `DB_POOL_MAX_CONNS`) and graceful shutdown hooks, implemented fail-closed HTTP 503 behavior on Redis rate-limiter outages for support tickets, and established rigorous test environment isolation guards prohibiting any destructive or mutating actions against the active `byos` database.

## Files edited
| File | Reason |
|------|--------|
| `apps/control-plane/src/lib/api/client.ts` | Removed client-side Shannon entropy gating ($H \ge 3.5$) and ceased reading bearer tokens from `localStorage`. |
| `apps/control-plane/src/lib/api/auth.ts` | Removed `localStorage.setItem("byos_cp_session_token", ...)` across registration, login, 2FA, passkeys, and recovery. |
| `apps/control-plane/src/context/OrgContext.tsx` | Removed legacy `localStorage.removeItem("byos_cp_session_token")` invocation upon logout. |
| `apps/control-plane/src/lib/api/client.test.ts` | Added unit tests verifying `getCpHeaders()` never attaches `localStorage` bearer tokens and entropy gating is removed. |
| `apps/support-crm/src/lib/api.ts` | Hardened `getAdminToken()` to prioritize ephemeral `sessionStorage` over persistent `localStorage`. |
| `services/api/auth.go` | Added configurable connection pool limits (`DB_POOL_MIN_CONNS`, `DB_POOL_MAX_CONNS`), `InitAuthDBPool`, and `CloseAuthDBPool`. |
| `services/api/support_tickets.go` | Hardened ticket creation and reply rate limiters to fail closed with HTTP 503 rather than failing open during Redis errors. |
| `apps/public-site/astro.config.mjs` | Hardened HSTS to avoid premature `includeSubDomains; preload` directives on development and unverified subdomains. |
| `apps/public-site/public/_headers` | Removed premature `preload` directive from public static headers. |
| `tests/browser/security_audit_verification.mjs` | Added environment isolation guards, negative safety test, scoped Redis clearing, and `HttpOnly` cookie assertions. |
| `apps/webmail/package.json` | Upgraded `dompurify` to `^3.4.17` to address upstream DOM XSS vulnerabilities (CVE-2024-45801). |
| `apps/webmail/src/composer_sanitizer.ts` | Added `try/finally` block to ensure deterministic `DOMPurify.removeHook` cleanup across sanitizer calls. |
| `apps/webmail/src/routes/settings/SignaturesTab.tsx` | Enforced tag stripping of `<style>`, `<head>`, and `<meta>` from user email signatures to prevent CSS injection. |
| `services/admin-api/main.go` | Added HTTP security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy, CSP), constant-time token comparison, and `ADMIN_ALLOWED_ORIGINS` CORS configuration. |
| `services/admin-api/main_test.go` | Added unit test coverage for production mock token rejection, genuine token validation, and CORS enforcement. |

## Raw evidence

### 1. Multi-Application Browser Security Audit & Environment Guard Verification
Command:
`node tests/browser/security_audit_verification.mjs`
Output:
```
================================================================================
             BYOS COMPREHENSIVE SECURITY AUDIT VERIFICATION SUITE               
================================================================================


--- STAGE 0: Environment Safety Guard & Negative Test ---
  [PASS] Negative safety guard triggered as expected: SAFETY_VIOLATION: Refusing to mutate active database "byos". Tests must use a disposable test database (e.g. byos_test) or run in non-mutating assertion mode.
  [PASS] Negative safety test PASSED: Mutating setup against active database byos is strictly rejected
  [SETUP] Running in non-mutating mode against existing state (no psql mutations on active byos)
--- STAGE 1: Public Site Security Audit (Port 3002) ---
1.1 Verifying Public Site HTTP Security Headers...
  [PASS] Public Site returned HTTP 200 OK
  [PASS] X-Frame-Options is DENY (got: DENY)
  [PASS] X-Content-Type-Options is nosniff (got: nosniff)
  [PASS] Referrer-Policy is strict-origin-when-cross-origin (got: strict-origin-when-cross-origin)
  [PASS] Strict-Transport-Security enforces max-age=31536000 (got: max-age=31536000)
  [PASS] Permissions-Policy restricts sensitive hardware APIs (got: camera=(), microphone=(), geolocation=(), payment=())
  [PASS] Content-Security-Policy enforces default-src 'self' (got: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:8080 http://localhost:8080 https:;)
1.2 Navigating to Public Site in Chrome...
  [PASS] Public Site brand and security messaging rendered
  Found navigation links: BYOS
Business Email
YOUR CONTROL, Features, About, Pricing, Security, Support, Sign In, Get Started, BYOS
Business Email
YOUR CONTROL, Features, About, Pricing, Security, Support, Sign In, Get Started
  [PASS] Public Site navigation bar rendered
  [PASS] Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\security_audit_public_site.png

--- STAGE 2: Dashboard / Control Plane Security Audit (Port 3000) ---
2.1 Verifying Control Plane Security Headers via proxied /health endpoint...
  [PASS] Control Plane /health returned HTTP 200 OK
  [PASS] Control Plane X-Frame-Options is DENY (got: DENY)
  [PASS] Control Plane X-Content-Type-Options is nosniff (got: nosniff)
  [PASS] Control Plane Referrer-Policy is strict-origin-when-cross-origin (got: strict-origin-when-cross-origin)
  [PASS] Control Plane CSP enforces default-src 'self'
2.2 Verifying Removal of Client-Side Shannon Entropy Gating...
  [PASS] Client-side Shannon entropy token gating is removed; session validation is strictly server-authoritative
2.3 Authenticating as Alice (alice@byos.local)...
  Successfully navigated to /dashboard
  [PASS] Alice session token is NOT stored in localStorage (secured via HttpOnly cookie byos_cp_session)
  [PASS] Found session cookie byos_cp_session in browser cookie jar
  [PASS] Session cookie byos_cp_session is marked HttpOnly
  [PASS] Session cookie byos_cp_session has SameSite=Lax
  [PASS] Dashboard displays authenticated user email alice@byos.local
  [PASS] Dashboard main container rendered
  [PASS] Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\security_audit_control_plane.png

--- STAGE 3: Webmail Security Audit (Port 3001) ---
3.1 Verifying Webmail Security Headers via proxied /v1/health...
  [PASS] Webmail X-Frame-Options is DENY (got: DENY)
  [PASS] Webmail X-Content-Type-Options is nosniff (got: nosniff)
  [PASS] Webmail Referrer-Policy is strict-origin-when-cross-origin
3.2 Navigating to Webmail for Sanitization Hardening Verification...
  [PASS] Sanitizer hook blocks remote image when allowRemoteImages is false
  [PASS] Sanitizer hook does NOT leak or block remote image when allowRemoteImages is true
  [PASS] Stress test: 10 repeated alternating sanitize calls showed zero hook accumulation
  [PASS] Signature Sanitizer completely strips <style> tag and CSS injection rules
  [PASS] Signature Sanitizer completely strips <head> tag
  [PASS] Signature Sanitizer completely strips <meta> tag and http-equiv refresh redirect
  [PASS] Signature Sanitizer preserves legitimate signature content and formatting
3.3 Mounting Webmail Interface with Alice Session...
  Logging in as Alice on Webmail...
  [PASS] Webmail mounted with active Alice session
  [PASS] Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\security_audit_webmail.png

--- STAGE 4: Support CRM & Admin API Security Audit ---
4.1 Verifying Admin API HTTP Security Headers (Port 8087)...
  [PASS] Admin API X-Frame-Options is DENY (got: DENY)
  [PASS] Admin API X-Content-Type-Options is nosniff (got: nosniff)
  [PASS] Admin API Referrer-Policy is strict-origin-when-cross-origin
  [PASS] Admin API HSTS enforces max-age=63072000
  [PASS] Admin API CSP is configured
4.2 Verifying Support CRM Proxied Security Headers (Port 3003)...
  [PASS] Support CRM Proxied X-Frame-Options is DENY
  [PASS] Support CRM Proxied X-Content-Type-Options is nosniff
4.3 Testing Admin API Production Mode Token Validation (rejection of mock token)...
  Production Admin API response status for mock token: 401
  Production Admin API response body: Unauthorized: mock WebAuthn disabled in production
  [PASS] Admin API rejects mock-support-agent in production with HTTP 401 Unauthorized (got: 401)
  [PASS] Admin API returns explicit production mock token rejection message
  [PASS] Admin API rejects invalid bearer token with HTTP 401 (got: 401)
  [PASS] Admin API returns explicit invalid agent credentials message
4.4 Testing Support CRM Client Production Token Fallback Prevention...
  [PASS] Support CRM getAdminToken() returns empty string in production when unauthenticated
  [PASS] Support CRM adminFetch() throws Authentication Required in production without stored token
  [PASS] Error message directs user to sign in rather than leaking mock access
  [PASS] Support CRM accepts genuine agent bearer tokens in production
  [PASS] Support CRM restricts mock-support-agent fallback strictly to development
4.5 Verifying Support CRM UI Rendering in Chrome...
  [PASS] Support CRM displays operator email sarah.support@byos.local
  [PASS] Support CRM displays operator role Tier 2 Operator
  [PASS] Support CRM displays Support Tickets navigation tab
  [PASS] Support CRM displays Organizations navigation tab
  [PASS] Support CRM displays Audit Logs navigation tab
  [PASS] Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\security_audit_support_crm.png

================================================================================
         ALL 4 APPLICATION & ADMIN API SECURITY CHECKS PASSED                   
================================================================================
Verification Artifacts Generated:
  1. Public Site:   F:\Codex\byos-email\tests\browser\artifacts\security_audit_public_site.png (217506 bytes)
  2. Control Plane: F:\Codex\byos-email\tests\browser\artifacts\security_audit_control_plane.png (122431 bytes)
  3. Webmail:       F:\Codex\byos-email\tests\browser\artifacts\security_audit_webmail.png (109569 bytes)
  4. Support CRM:   F:\Codex\byos-email\tests\browser\artifacts\security_audit_support_crm.png (70529 bytes)

Security audit verification completed successfully with exit code 0.
```

### 2. Control Plane Unit Tests (No Bearer Token in LocalStorage, No Shannon Gating)
Command:
`npm.cmd --prefix apps/control-plane test`
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

Running Customer Support & Help Desk API Tests...
  ✓ fetchCustomerTickets returns 1 ticket
  ✓ Ticket number matches
  ✓ createCustomerTicket creates ticket
  ✓ Transmits priority correctly
  ✓ Message author_type is customer
  ✓ fetchCustomerTicketDetail returns ticket
  ✓ Messages array populated
  ✓ addCustomerTicketReply returns created message
  ✓ Transmits reply body
SUPPORT API TESTS: 9 passed, 0 failed

Running Control Plane Client & Entropy Tests...
Running Control Plane API Client & Secure Header Tests...
  ✓ test_get_cp_headers_structure
  ✓ test_get_cp_headers_never_reads_localstorage_bearer_tokens
  ✓ test_no_client_side_shannon_entropy_gating_in_auth_flow
CLIENT & ENTROPY TESTS: 3 passed, 0 failed
```

### 3. Admin API Unit & Security Test Execution
Command:
`cd services/admin-api && go test -count=1 -v ./...`
Output:
```
=== RUN   TestMockLoginEndpointDisabledInProduction
--- PASS: TestMockLoginEndpointDisabledInProduction (0.00s)
=== RUN   TestMockWebAuthnMiddlewareBlocksInProduction
--- PASS: TestMockWebAuthnMiddlewareBlocksInProduction (0.00s)
=== RUN   TestMockLoginEndpointEnabledInDevMode
--- PASS: TestMockLoginEndpointEnabledInDevMode (0.00s)
=== RUN   TestMockWebAuthnMiddlewareInDevMode
--- PASS: TestMockWebAuthnMiddlewareInDevMode (0.00s)
=== RUN   TestSecurityHeaders
--- PASS: TestSecurityHeaders (0.00s)
=== RUN   TestAdminAllowedOrigins
=== RUN   TestAdminAllowedOrigins/DevModeLocalOrigins
=== RUN   TestAdminAllowedOrigins/DevModeUnauthorizedOrigin
=== RUN   TestAdminAllowedOrigins/ConfiguredAllowedOrigins
--- PASS: TestAdminAllowedOrigins (0.00s)
    --- PASS: TestAdminAllowedOrigins/DevModeLocalOrigins (0.00s)
    --- PASS: TestAdminAllowedOrigins/DevModeUnauthorizedOrigin (0.00s)
    --- PASS: TestAdminAllowedOrigins/ConfiguredAllowedOrigins (0.00s)
=== RUN   TestRealAgentTokenValidation
--- PASS: TestRealAgentTokenValidation (0.00s)
PASS
ok  	admin-api	0.636s
=== RUN   TestAdminDomainQuotaEnforcement
    organizations_test.go:55: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAdminDomainQuotaEnforcement (0.00s)
=== RUN   TestAdminAdjustCapacityLimits
    organizations_test.go:146: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAdminAdjustCapacityLimits (0.00s)
=== RUN   TestAdminZeroKnowledgeIsolation
    organizations_test.go:196: skipping support db test: SUPPORT_DB_URL environment variable is not set
--- SKIP: TestAdminZeroKnowledgeIsolation (0.00s)
=== RUN   TestUpdateSeatCountValid
    seat_billing_test.go:16: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestUpdateSeatCountValid (0.00s)
=== RUN   TestUpdateSeatCountBelowMailboxes
    seat_billing_test.go:63: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestUpdateSeatCountBelowMailboxes (0.00s)
=== RUN   TestUpdateSeatCountZero
    seat_billing_test.go:117: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestUpdateSeatCountZero (0.00s)
=== RUN   TestCapacityCapsFromSeatCount
--- PASS: TestCapacityCapsFromSeatCount (0.00s)
=== RUN   TestCapacityCapsMinimums
--- PASS: TestCapacityCapsMinimums (0.00s)
=== RUN   TestPriceComputationMatches
--- PASS: TestPriceComputationMatches (0.00s)
=== RUN   TestAdminTicketLifecycleIntegration
    tickets_test.go:17: skipping admin integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAdminTicketLifecycleIntegration (0.00s)
PASS
ok  	admin-api/handlers	0.088s
```

### 4. Mail Router Unit Test Suite
Command:
`cd services/mail-router && go test -count=1 -v ./...`
Output:
```
=== RUN   TestAliasRoutingRewritesRecipient
    aliases_inbound_test.go:165: skipping integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAliasRoutingRewritesRecipient (0.00s)
=== RUN   TestAliasRoutingRejectsUnknown
    aliases_inbound_test.go:198: skipping integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAliasRoutingRejectsUnknown (0.00s)
=== RUN   TestAliasRoutingRejectsDisabled
    aliases_inbound_test.go:216: skipping integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAliasRoutingRejectsDisabled (0.00s)
=== RUN   TestAliasReplyMapInserted
    aliases_inbound_test.go:236: skipping integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAliasReplyMapInserted (0.00s)
=== RUN   TestDependencyMinimums
--- PASS: TestDependencyMinimums (0.00s)
=== RUN   TestNormalizeAddress
--- PASS: TestNormalizeAddress (0.00s)
=== RUN   TestSplitAddress
--- PASS: TestSplitAddress (0.00s)
=== RUN   TestNormalizeMessageID
--- PASS: TestNormalizeMessageID (0.00s)
=== RUN   TestDeliveryIdentityDeterminism
--- PASS: TestDeliveryIdentityDeterminism (0.00s)
=== RUN   TestEnvOrDefault
--- PASS: TestEnvOrDefault (0.00s)
=== RUN   TestHealthHandler
--- PASS: TestHealthHandler (0.00s)
=== RUN   TestInboundHandlerValidation
--- PASS: TestInboundHandlerValidation (0.00s)
PASS
ok  	byos.email/services/mail-router	0.131s
```

### 5. Core API Unit Test Suite
Command:
`cd services/api && go test -count=1 ./...`
Output:
```
ok  	byos.email/services/api	0.638s
```

### 6. Webmail Unit & Zero-Knowledge Security Tests
Command:
`npm.cmd --prefix apps/webmail test`
Summary Output:
```
OVERALL: 613 passed, 0 failed
```

### 7. Dependency Vulnerability Audits
Command:
`npm.cmd --prefix apps/public-site audit --json`
Summary Output:
```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0,
      "total": 0
    }
  }
}
```

Command:
`npm.cmd --prefix apps/support-crm audit --json`
Summary Output:
```json
{
  "auditReportVersion": 2,
  "vulnerabilities": {},
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0,
      "total": 0
    }
  }
}
```

Command:
`npm.cmd --prefix apps/control-plane audit --json`
Summary Output:
```json
{
  "auditReportVersion": 2,
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 2,
      "high": 0,
      "critical": 0,
      "total": 2
    }
  }
}
```
*Note: Both moderate advisories in `apps/control-plane` reside in dev dependency `vite-plugin-top-level-await -> uuid` (<11.1.1) used exclusively during build bundling, not included in production client-side runtime.*

Command:
`npm.cmd --prefix apps/webmail audit --json`
Summary Output:
```json
{
  "auditReportVersion": 2,
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 3,
      "moderate": 2,
      "high": 0,
      "critical": 0,
      "total": 5
    }
  }
}
```
*Note: High and critical vulnerabilities in Webmail (including DOMPurify CVE-2024-45801) have been eliminated. Remaining entries are 3 low severity (`date-holidays -> deepmerge`) and 2 moderate build-time entries (`vite-plugin-top-level-await -> uuid`).*

## Manual browser verification
Browser verification script `tests/browser/security_audit_verification.mjs` was executed against all four running application instances and verified:

1. **Negative Safety Guard:** Executed `assertTestEnvironmentSafety('byos')`, confirming immediate rejection with `SAFETY_VIOLATION`. Verified setup operates in non-mutating mode without modifying PostgreSQL table rows or issuing Redis `FLUSHALL`.
2. **Public Site (`http://localhost:3002`):** Navigated to `/`, validated HTTP response headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000`, `Permissions-Policy`, `Content-Security-Policy`). Verified brand headings, hero copy, and navigation links. Captured screenshot:
   `tests/browser/artifacts/security_audit_public_site.png` (217,506 bytes).
3. **Control Plane / Dashboard (`http://localhost:3000`):** Verified removal of client-side Shannon entropy token gating. Completed login as `alice@byos.local`. Queried `localStorage.getItem("byos_cp_session_token")` and confirmed it is `null`. Queried browser cookies and confirmed `byos_cp_session` exists with `HttpOnly: true` and `SameSite: Lax`. Confirmed `/dashboard` mounts and displays authenticated user `alice@byos.local`. Captured screenshot:
   `tests/browser/artifacts/security_audit_control_plane.png` (122,431 bytes).
4. **Webmail (`http://localhost:3001`):** Navigated to `/`, injected DOMPurify and verified hook isolation across repeated alternating runs. Confirmed `<style>`, `<head>`, and `<meta>` tags are stripped from signatures. Mounted mailbox interface with active Alice session. Captured screenshot:
   `tests/browser/artifacts/security_audit_webmail.png` (109,569 bytes).
5. **Support CRM & Admin API (`http://localhost:3003` & `http://localhost:8087`):** Tested Admin API production mode by spawning instance with `BYOS_DEV_MODE=0` and asserting `mock-support-agent` is rejected with HTTP 401. Tested Support CRM client throwing authentication error in production without credentials. Verified Support CRM UI rendering operator Sarah Chen (Tier 2). Captured screenshot:
   `tests/browser/artifacts/security_audit_support_crm.png` (70,529 bytes).

## What did not work or is untested
1. **Live External SMTP Delivery to Third-Party Mail Exchanges:** UNTESTED. External SMTP delivery to external domains (Gmail, Yahoo, Outlook) requires public MX and SPF/DKIM DNS records; verified locally using internal loopback and Mailpit SMTP.
2. **PostgreSQL Live Integration Tests Requiring `TEST_DATABASE_URL`:** Tests in `services/api`, `services/admin-api`, and `services/mail-router` that check for a disposable integration database skip when `TEST_DATABASE_URL` is unset, protecting the active `byos` database from test mutations.

## Test suite output

### 1. Control Plane Test Suite (`apps/control-plane`)
```
Running Encoding Utility Tests...
ENCODING TESTS: 4 passed, 0 failed

Running Client Cryptography & Zero-Knowledge Tests...
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

Running Customer Support & Help Desk API Tests...
SUPPORT API TESTS: 9 passed, 0 failed

Running Control Plane Client & Entropy Tests...
  ✓ test_get_cp_headers_structure
  ✓ test_get_cp_headers_never_reads_localstorage_bearer_tokens
  ✓ test_no_client_side_shannon_entropy_gating_in_auth_flow
CLIENT & ENTROPY TESTS: 3 passed, 0 failed
```

### 2. Admin API Test Suite (`services/admin-api`)
```
ok  	admin-api	0.636s
ok  	admin-api/handlers	0.088s
```

### 3. Mail Router Test Suite (`services/mail-router`)
```
ok  	byos.email/services/mail-router	0.131s
```

### 4. Core API Test Suite (`services/api`)
```
ok  	byos.email/services/api	0.638s
```

### 5. Webmail Test Suite (`apps/webmail`)
```
OVERALL: 613 passed, 0 failed
```
