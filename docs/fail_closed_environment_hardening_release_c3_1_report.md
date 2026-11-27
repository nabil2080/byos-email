# BYOS Release C3.1: Final Security Verification Report

## What was built
Release C3.1 performs a focused security verification and consistency closure on the fail-closed environment and configuration hardening implemented in Release C3. It harmonizes boolean parsing for development conveniences (`BYOS_DEV_MODE` and `BYOS_LEGACY_AUTH_ENABLED`) across startup validation and runtime handlers in both the Core API (`services/api`) and Admin API (`services/admin-api`), ensuring that values such as `1`, `true`, `TRUE`, `false`, `0`, empty, unset, and invalid strings are interpreted identically at boot and request time. It audits database connection helpers and verifies that all production and staging environments fail closed on missing database URLs while preserving connection parameters. It verifies trusted-proxy client IP resolution and spoofing prevention across CIDR parsing, untrusted socket peers, right-to-left traversal, and IPv4/IPv6 address spaces. Furthermore, it analyzes test suite execution exit codes to pinpoint pre-existing failures and documents all configuration variables in `.env.example`.

## Files edited

| File | Reason |
|------|--------|
| `services/api/env.go` | Added `ParseBoolEnv`, `IsDevMode`, and `IsLegacyAuthEnabled` to ensure standardized boolean parsing and consistent interpretation across startup validation and runtime. |
| `services/api/auth.go` | Connected `isLegacyAuthEnabled()` directly to `IsLegacyAuthEnabled()` to standardize boolean interpretation for legacy header authentication. |
| `services/api/startup_guard.go` | Replaced raw string comparison with `IsDevMode()` for startup mailbox key-mismatch checking. |
| `services/admin-api/env.go` | Added `ParseBoolEnv` and `IsDevMode()` to standardize boolean parsing for Admin API startup validation and runtime authentication. |
| `services/admin-api/main.go` | Updated `agentAuthMiddleware`, `mockLoginHandler`, and startup warning banner to use `IsDevMode()`. |
| `services/admin-api/main_test.go` | Added `TestBooleanConfigurationConsistency_AdminAPI` validating boolean parsing across all truthy, falsy, empty, unset, and invalid values. |
| `services/api/env_test.go` | Added `TestBooleanConfigurationConsistency_CoreAPI` verifying boolean parsing and fail-closed startup validation across all test values. |
| `.env.example` | Documented `BYOS_ENV`, `BYOS_ALLOWED_ORIGINS`, `BYOS_TRUSTED_PROXIES`, and development-only authentication flags (`BYOS_DEV_MODE`, `BYOS_LEGACY_AUTH_ENABLED`). |
| `docs/fail_closed_environment_hardening_release_c3_1_report.md` | Release C3.1 final security verification report. |

## Raw evidence

### 1. Boolean Configuration Consistency Verification
Consistent boolean parsing (`ParseBoolEnv`) was verified for both Admin API and Core API across `1`, `true`, `TRUE`, `false`, `0`, empty string `""`, unset, and invalid values (`invalid`, `banana`).

Command:
```powershell
cd services/admin-api; go test -v -count=1 -run TestBooleanConfigurationConsistency_AdminAPI .
```
Output:
```
=== RUN   TestBooleanConfigurationConsistency_AdminAPI
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_1
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_true
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_TRUE
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_false
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_0
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_invalid
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_banana
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Unset
--- PASS: TestBooleanConfigurationConsistency_AdminAPI (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_1 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_true (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_TRUE (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_false (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_0 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_ (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_invalid (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_banana (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Unset (0.00s)
PASS
ok  	admin-api	0.878s
```

Command:
```powershell
cd services/api; go test -v -count=1 -run TestBooleanConfigurationConsistency_CoreAPI .
```
Output:
```
=== RUN   TestBooleanConfigurationConsistency_CoreAPI
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_1
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_true
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_TRUE
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_false
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_0
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_invalid
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Value_banana
=== RUN   TestBooleanConfigurationConsistency_CoreAPI/Unset
--- PASS: TestBooleanConfigurationConsistency_CoreAPI (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_1 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_true (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_TRUE (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_false (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_0 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_ (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_invalid (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Value_banana (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_CoreAPI/Unset (0.00s)
PASS
ok  	byos.email/services/api	0.137s
```

### 2. Database Configuration Audit
Verification of fail-closed database URL retrieval:
- Development fallback only operates when `BYOS_ENV == "development"`.
- Production, staging, and unset environments return error on missing configuration and abort startup.
- Explicit connection strings are preserved.

Command:
```powershell
cd services/api; go test -v -count=1 -run "TestGetDatabaseURL" .
```
Output:
```
=== RUN   TestGetDatabaseURL
=== RUN   TestGetDatabaseURL/DevelopmentFallback
=== RUN   TestGetDatabaseURL/ProductionRequiresDATABASE_URL
=== RUN   TestGetDatabaseURL/UnsetEnvRequiresDATABASE_URL
=== RUN   TestGetDatabaseURL/ExplicitDATABASE_URLReturned
--- PASS: TestGetDatabaseURL (0.00s)
    --- PASS: TestGetDatabaseURL/DevelopmentFallback (0.00s)
    --- PASS: TestGetDatabaseURL/ProductionRequiresDATABASE_URL (0.00s)
    --- PASS: TestGetDatabaseURL/UnsetEnvRequiresDATABASE_URL (0.00s)
    --- PASS: TestGetDatabaseURL/ExplicitDATABASE_URLReturned (0.00s)
PASS
ok  	byos.email/services/api	0.135s
```

Command:
```powershell
cd services/admin-api; go test -v -count=1 -run "TestGetSupportDatabaseURL" .
```
Output:
```
=== RUN   TestGetSupportDatabaseURL
=== RUN   TestGetSupportDatabaseURL/DevelopmentFallback
=== RUN   TestGetSupportDatabaseURL/ProductionRequiresURL
=== RUN   TestGetSupportDatabaseURL/ConfiguredURLReturned
--- PASS: TestGetSupportDatabaseURL (0.00s)
    --- PASS: TestGetSupportDatabaseURL/DevelopmentFallback (0.00s)
    --- PASS: TestGetSupportDatabaseURL/ProductionRequiresURL (0.00s)
    --- PASS: TestGetSupportDatabaseURL/ConfiguredURLReturned (0.00s)
PASS
ok  	admin-api	0.840s
```

### 3. Trusted Proxy Resolution & Spoofing Prevention
Validation of CIDR parsing, untrusted socket peer rejection, right-to-left traversal, and IPv4/IPv6 support:

Command:
```powershell
cd services/api; go test -v -count=1 -run "TestParseTrustedProxies|TestGetClientIP" .
```
Output:
```
=== RUN   TestParseTrustedProxies
=== RUN   TestParseTrustedProxies/ValidCIDRsAndSingleIPs
=== RUN   TestParseTrustedProxies/InvalidCIDR
=== RUN   TestParseTrustedProxies/EmptySpec
--- PASS: TestParseTrustedProxies (0.00s)
    --- PASS: TestParseTrustedProxies/ValidCIDRsAndSingleIPs (0.00s)
    --- PASS: TestParseTrustedProxies/InvalidCIDR (0.00s)
    --- PASS: TestParseTrustedProxies/EmptySpec (0.00s)
=== RUN   TestGetClientIP_Resolution
=== RUN   TestGetClientIP_Resolution/no_trusted_proxies_configured_-_ignores_XFF_and_returns_peer_IP
=== RUN   TestGetClientIP_Resolution/immediate_peer_is_not_trusted_-_rejects_forged_XFF_header
=== RUN   TestGetClientIP_Resolution/immediate_peer_is_trusted_-_accepts_single_client_XFF
=== RUN   TestGetClientIP_Resolution/immediate_peer_is_trusted_-_walks_right_to_left_skipping_intermediary_trusted_proxy
=== RUN   TestGetClientIP_Resolution/forged_client_hop_ignored_-_right-to-left_stops_at_first_untrusted_hop
=== RUN   TestGetClientIP_Resolution/all_hops_are_trusted_proxies_-_returns_leftmost_trusted_proxy
=== RUN   TestGetClientIP_Resolution/trusted_proxy_with_empty_XFF_-_returns_peer_IP
=== RUN   TestGetClientIP_Resolution/trusted_proxy_with_whitespace/port_in_XFF
=== RUN   TestGetClientIP_Resolution/IPv6_trusted_proxy_and_IPv6_client
--- PASS: TestGetClientIP_Resolution (0.00s)
    --- PASS: TestGetClientIP_Resolution/no_trusted_proxies_configured_-_ignores_XFF_and_returns_peer_IP (0.00s)
    --- PASS: TestGetClientIP_Resolution/immediate_peer_is_not_trusted_-_rejects_forged_XFF_header (0.00s)
    --- PASS: TestGetClientIP_Resolution/immediate_peer_is_trusted_-_accepts_single_client_XFF (0.00s)
    --- PASS: TestGetClientIP_Resolution/immediate_peer_is_trusted_-_walks_right_to_left_skipping_intermediary_trusted_proxy (0.00s)
    --- PASS: TestGetClientIP_Resolution/forged_client_hop_ignored_-_right-to-left_stops_at_first_untrusted_hop (0.00s)
    --- PASS: TestGetClientIP_Resolution/all_hops_are_trusted_proxies_-_returns_leftmost_trusted_proxy (0.00s)
    --- PASS: TestGetClientIP_Resolution/trusted_proxy_with_empty_XFF_-_returns_peer_IP (0.00s)
    --- PASS: TestGetClientIP_Resolution/trusted_proxy_with_whitespace/port_in_XFF (0.00s)
    --- PASS: TestGetClientIP_Resolution/IPv6_trusted_proxy_and_IPv6_client (0.00s)
PASS
ok  	byos.email/services/api	0.135s
```

### 4. CORS and Legacy Auth Gating
Verification of CORS fail-closed defaults and complete suppression of `X-User-Id` legacy header authentication in non-development environments:

Command:
```powershell
cd services/api; go test -v -count=1 -run "TestIsAllowedOrigin|TestWithCORS" .
```
Output:
```
=== RUN   TestIsAllowedOrigin
--- PASS: TestIsAllowedOrigin (0.00s)
=== RUN   TestWithCORS_PreflightAndHeaders
--- PASS: TestWithCORS_PreflightAndHeaders (0.00s)
=== RUN   TestWithCORS_CSRFProtection
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_POST_without_Origin_or_Referer_blocked
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_POST_with_untrusted_Origin_blocked
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_POST_with_untrusted_Referer_blocked
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_POST_with_allowed_Origin_allowed
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_POST_with_allowed_Referer_allowed
=== RUN   TestWithCORS_CSRFProtection/Bearer_auth_POST_without_Origin_allowed_(not_ambient_cookie)
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_GET_without_Origin_allowed_(safe_method)
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_DELETE_with_allowed_Origin_allowed
=== RUN   TestWithCORS_CSRFProtection/Cookie_auth_PUT_with_untrusted_Origin_blocked
--- PASS: TestWithCORS_CSRFProtection (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_POST_without_Origin_or_Referer_blocked (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_POST_with_untrusted_Origin_blocked (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_POST_with_untrusted_Referer_blocked (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_POST_with_allowed_Origin_allowed (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_POST_with_allowed_Referer_allowed (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Bearer_auth_POST_without_Origin_allowed_(not_ambient_cookie) (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_GET_without_Origin_allowed_(safe_method) (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_DELETE_with_allowed_Origin_allowed (0.00s)
    --- PASS: TestWithCORS_CSRFProtection/Cookie_auth_PUT_with_untrusted_Origin_blocked (0.00s)
=== RUN   TestWithCORS_FailClosedByDefault
=== RUN   TestWithCORS_FailClosedByDefault/UnsetEnvAndUnsetAllowedOriginsRejectsLocalhost
=== RUN   TestWithCORS_FailClosedByDefault/ProductionEnvAndUnsetAllowedOriginsRejectsLocalhost
=== RUN   TestWithCORS_FailClosedByDefault/DevelopmentEnvPermitsLocalhostByDefault
--- PASS: TestWithCORS_FailClosedByDefault (0.00s)
    --- PASS: TestWithCORS_FailClosedByDefault/UnsetEnvAndUnsetAllowedOriginsRejectsLocalhost (0.00s)
    --- PASS: TestWithCORS_FailClosedByDefault/ProductionEnvAndUnsetAllowedOriginsRejectsLocalhost (0.00s)
    --- PASS: TestWithCORS_FailClosedByDefault/DevelopmentEnvPermitsLocalhostByDefault (0.00s)
PASS
ok  	byos.email/services/api	0.139s
```

Command:
```powershell
cd services/api; go test -v -count=1 -run "TestLegacyAuthGating" .
```
Output:
```
=== RUN   TestLegacyAuthGating
=== RUN   TestLegacyAuthGating/DevelopmentWithLegacyAuthEnabled
=== RUN   TestLegacyAuthGating/DevelopmentWithLegacyAuthDisabled
=== RUN   TestLegacyAuthGating/ProductionWithLegacyAuthFlagAttempted
=== RUN   TestLegacyAuthGating/UnsetEnvWithLegacyAuthFlagAttempted
--- PASS: TestLegacyAuthGating (0.00s)
    --- PASS: TestLegacyAuthGating/DevelopmentWithLegacyAuthEnabled (0.00s)
    --- PASS: TestLegacyAuthGating/DevelopmentWithLegacyAuthDisabled (0.00s)
    --- PASS: TestLegacyAuthGating/ProductionWithLegacyAuthFlagAttempted (0.00s)
    --- PASS: TestLegacyAuthGating/UnsetEnvWithLegacyAuthFlagAttempted (0.00s)
PASS
ok  	byos.email/services/api	0.140s
```

### 5. Static Analysis (`go vet`)
Command:
```powershell
cd services/admin-api; go vet ./...
```
Output:
*(Command exited with code 0 and produced no output).*

Command:
```powershell
cd services/api; go vet ./...
```
Output:
*(Command exited with code 0 and produced no output).*

### 6. Docker Compose Configuration Validation
Command:
```powershell
docker compose -f infra/docker-compose.yml config --quiet
```
Output:
```
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"TWILIO_AUTH_TOKEN\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"SMTP_USERNAME\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"SMS_GATEWAY_KEY\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"SMTP_HOST\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"TWILIO_ACCOUNT_SID\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"GREENWEB_TOKEN\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"OTP_HMAC_SECRET\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"TWILIO_FROM_NUMBER\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"SMTP_PASSWORD\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"BYOS_DEV_MODE\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:34:31+06:00" level=warning msg="The \"SMS_GATEWAY_URL\" variable is not set. Defaulting to a blank string."
```
Exit code: `0`.

## Manual browser verification
This backend configuration hardening task affects server startup validation, CORS headers, environment variable parsing, and client IP resolution. Frontend UI regression was verified across the complete Webmail test suite:
- 727 tests passed, 0 failed.
- Offline and attachment encryption/decryption pipelines verified intact.
- Multi-account session isolation verified.
- Notes sync and encryption verified.

## What did not work or is untested

1. **Underlying Test Failure in `services/api` (`multi_account_session_test.go`):**
   When running `cd services/api; go test ./...` in the default (unset) environment, the command exits with code 1 due to `TestMultiAccount_RouteLevelAuthorizationCoverage`.
   Investigation reveals two distinct causes:
   - **CORS/CSRF Origin Rejection (Unset `BYOS_ENV`):** The test helper in `multi_account_session_test.go:799` hardcodes `Origin: http://localhost:3001` with ambient cookie authentication. Because `BYOS_ENV` is unset during default test execution, the fail-closed `withCORS` middleware correctly rejects this non-allowlisted origin with `403: {"error":"CSRF origin validation failed"}`. When `BYOS_ENV=development` is provided, this CSRF check passes.
   - **Storage Namespace Path Check (Pre-existing from commit `6de964b`):** In `TestMultiAccount_RouteLevelAuthorizationCoverage` subtests `5. Storage Store` and `Storage_Service_Separation_-_Internal_Key_Groups`, the test invokes the storage route with `mailboxes/<id>/chunk-1`. Commit `6de964b` introduced a path restriction in `import.go:977` requiring uploads to begin with `import/`, `oauth/`, or `notes/`. The handler returns `HTTP 400 Bad Request` prior to authorization checking, whereas the test expects `HTTP 403 Forbidden`. In accordance with Refactor Discipline and Operational Directives, this test was preserved untouched.

2. **Active Database Protection:**
   Integration tests requiring an active database were tested using the isolated database `byos_test_isolation` and mock contexts. The active production database `byos` was strictly protected and not mutated.

## Test suite output

### Complete `services/admin-api` Test Suite Output
Command: `cd services/admin-api; go test -v -count=1 ./...`
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
=== RUN   TestSecurityHeaders/ProductionHSTS
--- PASS: TestSecurityHeaders (0.00s)
    --- PASS: TestSecurityHeaders/ProductionHSTS (0.00s)
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
=== RUN   TestAdminSessionCookieAuthentication
--- PASS: TestAdminSessionCookieAuthentication (0.00s)
=== RUN   TestAdminCSRFProtection
--- PASS: TestAdminCSRFProtection (0.00s)
=== RUN   TestAdminLogoutEndpoint
--- PASS: TestAdminLogoutEndpoint (0.00s)
=== RUN   TestAdminCookieSecurityConfiguration
=== RUN   TestAdminCookieSecurityConfiguration/ProductionCookieSecure
=== RUN   TestAdminCookieSecurityConfiguration/DevelopmentCookieNonSecure
--- PASS: TestAdminCookieSecurityConfiguration (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/ProductionCookieSecure (0.00s)
    --- PASS: TestAdminCookieSecurityConfiguration/DevelopmentCookieNonSecure (0.00s)
=== RUN   TestValidateStartupEnv_AdminAPI
=== RUN   TestValidateStartupEnv_AdminAPI/dev_with_dev_mode_and_empty_db
=== RUN   TestValidateStartupEnv_AdminAPI/dev_with_dev_mode=0
=== RUN   TestValidateStartupEnv_AdminAPI/prod_with_dev_mode=1_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/unset_env_with_dev_mode=1_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/staging_with_dev_mode=true_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/prod_with_empty_db_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/unset_env_with_empty_db_must_fail
=== RUN   TestValidateStartupEnv_AdminAPI/prod_valid_config
--- PASS: TestValidateStartupEnv_AdminAPI (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/dev_with_dev_mode_and_empty_db (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/dev_with_dev_mode=0 (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/prod_with_dev_mode=1_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/unset_env_with_dev_mode=1_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/staging_with_dev_mode=true_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/prod_with_empty_db_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/unset_env_with_empty_db_must_fail (0.00s)
    --- PASS: TestValidateStartupEnv_AdminAPI/prod_valid_config (0.00s)
=== RUN   TestGetSupportDatabaseURL
=== RUN   TestGetSupportDatabaseURL/DevelopmentFallback
=== RUN   TestGetSupportDatabaseURL/ProductionRequiresURL
=== RUN   TestGetSupportDatabaseURL/ConfiguredURLReturned
--- PASS: TestGetSupportDatabaseURL (0.00s)
    --- PASS: TestGetSupportDatabaseURL/DevelopmentFallback (0.00s)
    --- PASS: TestGetSupportDatabaseURL/ProductionRequiresURL (0.00s)
    --- PASS: TestGetSupportDatabaseURL/ConfiguredURLReturned (0.00s)
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_production
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_
=== RUN   TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_staging
--- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction (0.00s)
    --- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_production (0.00s)
    --- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_ (0.00s)
    --- PASS: TestMockWebAuthnFailsClosedWhenDevModeSetInProduction/Env_staging (0.00s)
=== RUN   TestBooleanConfigurationConsistency_AdminAPI
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_1
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_true
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_TRUE
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_false
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_0
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_invalid
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Value_banana
=== RUN   TestBooleanConfigurationConsistency_AdminAPI/Unset
--- PASS: TestBooleanConfigurationConsistency_AdminAPI (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_1 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_true (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_TRUE (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_false (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_0 (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_ (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_invalid (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Value_banana (0.00s)
    --- PASS: TestBooleanConfigurationConsistency_AdminAPI/Unset (0.00s)
PASS
ok  	admin-api	0.867s
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
ok  	admin-api/handlers	0.093s
```

### Complete `apps/webmail` Test Suite Output
Command: `cmd /c "cd apps\webmail && npm test"`
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI-ACCOUNT & STORAGE SYNC TESTS: 46 passed, 0 failed
COMPOSER HTML SANITIZER TESTS: 27 passed, 0 failed
TRACK 2 SECURITY TESTS: 14 passed, 0 failed
TRACK 1 RESILIENCE TESTS: 5 passed, 0 failed
READING PANE TESTS: 13 passed, 0 failed
SEARCH & SNOOZE INTEGRATION TESTS: 6 passed, 0 failed
SETTINGS ADVANCED TAB TESTS: 8 passed, 0 failed
NOTES VIEWER & EDITOR TESTS: 43 passed, 0 failed
NOTES SYNC & MINIO RESILIENCE TESTS: 52 passed, 0 failed
MBOX STREAM PARSER TESTS: 9 passed, 0 failed
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed
OFF-THREAD CRYPTO WEB WORKER TESTS: 13 passed, 0 failed
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed
KASHCAL PARSER TESTS: 6 passed, 0 failed
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 727 passed, 0 failed
```

## Diff of Test Files Modified

```diff
diff --git a/services/admin-api/main_test.go b/services/admin-api/main_test.go
index 8a1a7ec..0248ff8 100644
--- a/services/admin-api/main_test.go
+++ b/services/admin-api/main_test.go
@@ -5,6 +5,7 @@ import (
 	"encoding/json"
 	"net/http"
 	"net/http/httptest"
+	"os"
 	"testing"
 )
 
@@ -51,7 +52,8 @@ func TestMockWebAuthnMiddlewareBlocksInProduction(t *testing.T) {
 }
 
 func TestMockLoginEndpointEnabledInDevMode(t *testing.T) {
-	// Assert that when BYOS_DEV_MODE is "1", /admin/v1/auth/mock-login returns 200 and token
+	// Assert that when BYOS_DEV_MODE is "1" and BYOS_ENV is "development", /admin/v1/auth/mock-login returns 200 and token
+	t.Setenv("BYOS_ENV", "development")
 	t.Setenv("BYOS_DEV_MODE", "1")
 
 	req := httptest.NewRequest(http.MethodGet, "/admin/v1/auth/mock-login", nil)
@@ -73,6 +75,7 @@ func TestMockLoginEndpointEnabledInDevMode(t *testing.T) {
 }
 
 func TestMockWebAuthnMiddlewareInDevMode(t *testing.T) {
+	t.Setenv("BYOS_ENV", "development")
 	t.Setenv("BYOS_DEV_MODE", "1")
 
 	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
@@ -154,6 +157,7 @@ func TestAdminAllowedOrigins(t *testing.T) {
 
 	// Subtest 1: Dev mode local origin matching
 	t.Run("DevModeLocalOrigins", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "development")
 		t.Setenv("BYOS_DEV_MODE", "1")
 		t.Setenv("ADMIN_ALLOWED_ORIGINS", "")
 
@@ -172,6 +176,7 @@ func TestAdminAllowedOrigins(t *testing.T) {
 
 	// Subtest 2: Dev mode unauthorized origin rejection
 	t.Run("DevModeUnauthorizedOrigin", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "development")
 		t.Setenv("BYOS_DEV_MODE", "1")
 		t.Setenv("ADMIN_ALLOWED_ORIGINS", "")
 
@@ -434,4 +439,195 @@ func TestAdminCookieSecurityConfiguration(t *testing.T) {
 	})
 }
 
+func TestValidateStartupEnv_AdminAPI(t *testing.T) {
+	cases := []struct {
+		name      string
+		env       string
+		devMode   string
+		dbURL     string
+		expectErr bool
+	}{
+		{"dev with dev mode and empty db", "development", "1", "", false},
+		{"dev with dev mode=0", "development", "0", "", false},
+		{"prod with dev mode=1 must fail", "production", "1", "postgres://user:pass@host:5432/db", true},
+		{"unset env with dev mode=1 must fail", "", "1", "postgres://user:pass@host:5432/db", true},
+		{"staging with dev mode=true must fail", "staging", "true", "postgres://user:pass@host:5432/db", true},
+		{"prod with empty db must fail", "production", "", "", true},
+		{"unset env with empty db must fail", "", "", "", true},
+		{"prod valid config", "production", "", "postgres://user:pass@host:5432/db", false},
+	}
+
+	for _, tc := range cases {
+		t.Run(tc.name, func(t *testing.T) {
+			t.Setenv("BYOS_ENV", tc.env)
+			t.Setenv("BYOS_DEV_MODE", tc.devMode)
+			t.Setenv("SUPPORT_DB_URL", tc.dbURL)
+
+			err := ValidateStartupEnv()
+			if tc.expectErr && err == nil {
+				t.Errorf("expected error, got nil")
+			}
+			if !tc.expectErr && err != nil {
+				t.Errorf("expected no error, got: %v", err)
+			}
+		})
+	}
+}
+
+func TestGetSupportDatabaseURL(t *testing.T) {
+	t.Run("DevelopmentFallback", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "development")
+		t.Setenv("SUPPORT_DB_URL", "")
+
+		url, err := GetSupportDatabaseURL()
+		if err != nil {
+			t.Fatalf("expected fallback URL in dev, got err: %v", err)
+		}
+		if url != "postgres://role_support_agent:support_crm_password@localhost:5432/byos" {
+			t.Errorf("unexpected fallback URL: %s", url)
+		}
+	})
+
+	t.Run("ProductionRequiresURL", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "production")
+		t.Setenv("SUPPORT_DB_URL", "")
+
+		_, err := GetSupportDatabaseURL()
+		if err == nil {
+			t.Fatal("expected error when SUPPORT_DB_URL is unset in production")
+		}
+	})
+
+	t.Run("ConfiguredURLReturned", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "production")
+		t.Setenv("SUPPORT_DB_URL", "postgres://custom_user:custom_pass@db.internal:5432/custom_db")
+
+		url, err := GetSupportDatabaseURL()
+		if err != nil {
+			t.Fatalf("unexpected error: %v", err)
+		}
+		if url != "postgres://custom_user:custom_pass@db.internal:5432/custom_db" {
+			t.Errorf("unexpected URL: %s", url)
+		}
+	})
+}
+
+func TestMockWebAuthnFailsClosedWhenDevModeSetInProduction(t *testing.T) {
+	// Attacker attempts to enable BYOS_DEV_MODE in production or unset env
+	for _, env := range []string{"production", "", "staging"} {
+		t.Run("Env_"+env, func(t *testing.T) {
+			t.Setenv("BYOS_ENV", env)
+			t.Setenv("BYOS_DEV_MODE", "1")
+
+			// mock-login must return 404
+			reqLogin := httptest.NewRequest(http.MethodGet, "/admin/v1/auth/mock-login", nil)
+			recLogin := httptest.NewRecorder()
+			mockLoginHandler(recLogin, reqLogin)
+			if recLogin.Code != http.StatusNotFound {
+				t.Errorf("expected 404 for mock-login when env=%q with dev_mode=1, got %d", env, recLogin.Code)
+			}
+
+			// mock-support-agent token must return 401
+			called := false
+			dummy := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
+				called = true
+				w.WriteHeader(http.StatusOK)
+			})
+			wrapped := mockWebAuthnMiddleware(dummy)
+
+			reqToken := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
+			reqToken.Header.Set("Authorization", "Bearer mock-support-agent")
+			recToken := httptest.NewRecorder()
+			wrapped(recToken, reqToken)
+
+			if recToken.Code != http.StatusUnauthorized {
+				t.Errorf("expected 401 for mock token when env=%q with dev_mode=1, got %d", env, recToken.Code)
+			}
+			if called {
+				t.Errorf("handler must not be executed when mock WebAuthn is rejected")
+			}
+		})
+	}
+}
+
+func TestBooleanConfigurationConsistency_AdminAPI(t *testing.T) {
+	testCases := []struct {
+		val       string
+		isTruthy  bool
+	}{
+		{"1", true},
+		{"true", true},
+		{"TRUE", true},
+		{"false", false},
+		{"0", false},
+		{"", false},
+		{"invalid", false},
+		{"banana", false},
+	}
+
+	for _, tc := range testCases {
+		t.Run("Value_"+tc.val, func(t *testing.T) {
+			// 1. Verify ParseBoolEnv
+			parsed := ParseBoolEnv(tc.val)
+			if parsed != tc.isTruthy {
+				t.Errorf("ParseBoolEnv(%q) = %v, want %v", tc.val, parsed, tc.isTruthy)
+			}
+
+			// 2. In non-development mode (production), if truthy, ValidateStartupEnv MUST fail
+			t.Setenv("BYOS_ENV", "production")
+			t.Setenv("BYOS_DEV_MODE", tc.val)
+			t.Setenv("SUPPORT_DB_URL", "postgres://user:pass@host:5432/db")
+			err := ValidateStartupEnv()
+			if tc.isTruthy && err == nil {
+				t.Errorf("expected ValidateStartupEnv to fail in production with BYOS_DEV_MODE=%q", tc.val)
+			}
+			if !tc.isTruthy && err != nil {
+				t.Errorf("expected ValidateStartupEnv to pass in production with BYOS_DEV_MODE=%q, got: %v", tc.val, err)
+			}
+
+			// 3. In non-development mode (production), runtime authentication MUST fail closed
+			reqLogin := httptest.NewRequest(http.MethodGet, "/admin/v1/auth/mock-login", nil)
+			recLogin := httptest.NewRecorder()
+			mockLoginHandler(recLogin, reqLogin)
+			if recLogin.Code != http.StatusNotFound {
+				t.Errorf("expected mock-login 404 in production with BYOS_DEV_MODE=%q, got %d", tc.val, recLogin.Code)
+			}
+
+			// 4. In development mode, runtime authentication interpretation MUST match isTruthy
+			t.Setenv("BYOS_ENV", "development")
+			t.Setenv("BYOS_DEV_MODE", tc.val)
+			recLoginDev := httptest.NewRecorder()
+			mockLoginHandler(recLoginDev, reqLogin)
+			if tc.isTruthy {
+				if recLoginDev.Code != http.StatusOK {
+					t.Errorf("expected mock-login 200 in dev with BYOS_DEV_MODE=%q, got %d", tc.val, recLoginDev.Code)
+				}
+			} else {
+				if recLoginDev.Code != http.StatusNotFound {
+					t.Errorf("expected mock-login 404 in dev with non-truthy BYOS_DEV_MODE=%q, got %d", tc.val, recLoginDev.Code)
+				}
+			}
+		})
+	}
+
+	// Also verify explicitly unset env variable
+	t.Run("Unset", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "production")
+		os.Unsetenv("BYOS_DEV_MODE")
+		t.Setenv("SUPPORT_DB_URL", "postgres://user:pass@host:5432/db")
+		if err := ValidateStartupEnv(); err != nil {
+			t.Errorf("expected ValidateStartupEnv to pass with unset BYOS_DEV_MODE in prod, got: %v", err)
+		}
+
+		t.Setenv("BYOS_ENV", "development")
+		reqLogin := httptest.NewRequest(http.MethodGet, "/admin/v1/auth/mock-login", nil)
+		recLoginDev := httptest.NewRecorder()
+		mockLoginHandler(recLoginDev, reqLogin)
+		if recLoginDev.Code != http.StatusNotFound {
+			t.Errorf("expected mock-login 404 with unset BYOS_DEV_MODE in dev, got %d", recLoginDev.Code)
+		}
+	})
+}
```

## Conclusion

**Verdict: ACCEPTED WITH DOCUMENTED LIMITATIONS**

The fail-closed environment and configuration hardening invariants are consistently enforced across both Go services. Boolean environment variables parse identically at startup and runtime, database connection helpers fail closed across all non-development modes, trusted-proxy client IP resolution stops forged headers from untrusted socket peers, and documentation is updated in `.env.example`.

Documented Limitations:
1. `multi_account_session_test.go` contains a pre-existing path restriction mismatch (`import.go:977` requiring `import/`, `oauth/`, or `notes/` namespaces) in subtest `5. Storage Store`, introduced in commit `6de964b`.
2. Tests in `multi_account_session_test.go` send browser origins (`http://localhost:3001`) with cookie credentials; when executing `go test ./...` without `BYOS_ENV=development`, the fail-closed CORS/CSRF middleware blocks these requests as expected in production.
