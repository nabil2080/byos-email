# BYOS Release C3: Fail-Closed Environment and Configuration Hardening Report

## What was built
Release C3 hardens the deployment, authentication, CORS, database, and client IP resolution configuration across the Core API (`services/api`) and Admin API (`services/admin-api`) services to enforce fail-closed security invariants. Development conveniences—including mock WebAuthn authentication bypass, permissive localhost and LAN CORS origins, default development database credentials, and legacy `X-User-Id` header authentication—now activate strictly and exclusively when `BYOS_ENV` is set to `development`. Any non-development environment (`production`, staging, unset, empty, or unknown strings) defaults strictly to secure, fail-closed operation, and conflicting configurations (such as enabling `BYOS_DEV_MODE=1` or `BYOS_LEGACY_AUTH_ENABLED=1` outside of development, or leaving required database DSNs unconfigured) cause the services to abort startup immediately with sanitized error diagnostics. Additionally, hardcoded development environment variables and database URLs were excised from the Admin API Dockerfile, and trusted-proxy client IP resolution was implemented using a right-to-left untrusted-hop selection algorithm over configurable trusted CIDR blocks.

## Files edited

| File | Reason |
|------|--------|
| `infra/docker-compose.yml` | Added explicit `BYOS_ENV: "development"` to `admin-api` service configuration for local development parity. |
| `services/admin-api/Dockerfile` | Removed baked-in dev credentials `ENV BYOS_DEV_MODE=1` and `ENV SUPPORT_DB_URL=...` from the container image. |
| `services/admin-api/env.go` | Created centralized environment inspection (`IsDevelopment`), fail-closed startup validation (`ValidateStartupEnv`), and support database DSN retrieval (`GetSupportDatabaseURL`). |
| `services/admin-api/main.go` | Wired startup environment validation, fail-closed DB initialization, restricted dev CORS origins to `IsDevelopment()`, and gated mock WebAuthn and mock login strictly to development mode. |
| `services/admin-api/main_test.go` | Updated dev-mode tests to explicitly configure `BYOS_ENV=development` and added unit test coverage for fail-closed startup validation, DB configuration, and mock WebAuthn rejection in production. |
| `services/api/env.go` | Created centralized environment inspection (`IsDevelopment`), fail-closed startup validation (`ValidateStartupEnv`), and database DSN retrieval (`GetDatabaseURL`, `getDatabaseDSN`). |
| `services/api/client_ip.go` | Implemented right-to-left untrusted-hop client IP resolution with immediate peer validation against configurable `BYOS_TRUSTED_PROXIES` CIDRs. |
| `services/api/auth.go` | Restricted `isLegacyAuthEnabled()` to development mode, connected `getClientIP()` to `GetClientIP()`, and replaced database fallback strings with centralized `GetDatabaseURL()` / `getDatabaseDSN()`. |
| `services/api/cors.go` | Restricted relaxed local development origins and default allowed origin fallbacks strictly to `IsDevelopment()`. |
| `services/api/main.go` | Added fail-closed `ValidateStartupEnv()` check on startup, and replaced database DSN fallbacks with centralized `GetDatabaseURL()` / `getDatabaseDSN()`. |
| `services/api/attachments.go` | Replaced hardcoded development database connection fallback with centralized `getDatabaseDSN()` and removed unused `os` import. |
| `services/api/attachments_test.go` | Preserved from Release C2 verification: attachment security header assertions. |
| `services/api/sessions.go` | Replaced hardcoded development database connection fallbacks with centralized `getDatabaseDSN()` and removed unused `os` import. |
| `services/api/startup_guard.go` | Replaced hardcoded development database fallback with centralized `getDatabaseDSN()` and restricted mailbox key mismatch check to `IsDevelopment()`. |
| `services/api/calendar_feed_proxy_test.go` | Added `t.Setenv("BYOS_ENV", "development")` to legacy auth tests to reflect the new strict environment gating. |
| `services/api/message_attachments_test.go` | Added `t.Setenv("BYOS_ENV", "development")` to CORS preflight test to test development origin allowance. |
| `services/api/env_test.go` | Created unit tests verifying `IsDevelopment`, `ValidateStartupEnv`, and `GetDatabaseURL` fail-closed behaviors across environments. |
| `services/api/client_ip_test.go` | Created table-driven unit tests verifying CIDR parsing, immediate peer untrusted rejection, right-to-left walk, IP spoofing resistance, and IPv6 handling. |
| `services/api/cors_test.go` | Added tests verifying origin allowance and CORS header fail-closed defaults across production, development, staging, and unset environments. |
| `services/api/legacy_auth_test.go` | Created unit tests verifying legacy `X-User-Id` header authentication is completely disabled in production and unset environments even if the legacy flag is set. |
| `docs/fail_closed_environment_hardening_release_c3_report.md` | Release C3 verification and compliance report. |

## Raw evidence

### 1. Verification of Admin API Environment Hardening & Validation
The Admin API fail-closed environment validation and mock WebAuthn protections were verified:
```
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
```

### 2. Verification of Core API Environment Validation & Startup Guard
The Core API environment validation rules were verified:
```
=== RUN   TestIsDevelopment
=== RUN   TestIsDevelopment/Env_development
=== RUN   TestIsDevelopment/Env_DEVELOPMENT
=== RUN   TestIsDevelopment/Env__Development_
=== RUN   TestIsDevelopment/Env_production
=== RUN   TestIsDevelopment/Env_PRODUCTION
=== RUN   TestIsDevelopment/Env_staging
=== RUN   TestIsDevelopment/Env_test
=== RUN   TestIsDevelopment/Env_dev
=== RUN   TestIsDevelopment/Env_
=== RUN   TestIsDevelopment/Env_unknown
--- PASS: TestIsDevelopment (0.00s)
    --- PASS: TestIsDevelopment/Env_development (0.00s)
    --- PASS: TestIsDevelopment/Env_DEVELOPMENT (0.00s)
    --- PASS: TestIsDevelopment/Env__Development_ (0.00s)
    --- PASS: TestIsDevelopment/Env_production (0.00s)
    --- PASS: TestIsDevelopment/Env_PRODUCTION (0.00s)
    --- PASS: TestIsDevelopment/Env_staging (0.00s)
    --- PASS: TestIsDevelopment/Env_test (0.00s)
    --- PASS: TestIsDevelopment/Env_dev (0.00s)
    --- PASS: TestIsDevelopment/Env_ (0.00s)
    --- PASS: TestIsDevelopment/Env_unknown (0.00s)
=== RUN   TestValidateStartupEnv_CoreAPI
=== RUN   TestValidateStartupEnv_CoreAPI/dev_mode_valid_default
=== RUN   TestValidateStartupEnv_CoreAPI/dev_mode_with_dev_conveniences_enabled
=== RUN   TestValidateStartupEnv_CoreAPI/production_fails_if_dev_mode_enabled
=== RUN   TestValidateStartupEnv_CoreAPI/unset_env_fails_if_dev_mode_enabled
=== RUN   TestValidateStartupEnv_CoreAPI/production_fails_if_legacy_auth_enabled
=== RUN   TestValidateStartupEnv_CoreAPI/unset_env_fails_if_legacy_auth_enabled
=== RUN   TestValidateStartupEnv_CoreAPI/staging_fails_if_legacy_auth_enabled
=== RUN   TestValidateStartupEnv_CoreAPI/production_fails_if_DATABASE_URL_missing
=== RUN   TestValidateStartupEnv_CoreAPI/unset_env_fails_if_DATABASE_URL_missing
=== RUN   TestValidateStartupEnv_CoreAPI/production_valid_config_with_valid_proxy_CIDRs
=== RUN   TestValidateStartupEnv_CoreAPI/fails_on_invalid_trusted_proxy_CIDR
--- PASS: TestValidateStartupEnv_CoreAPI (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/dev_mode_valid_default (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/dev_mode_with_dev_conveniences_enabled (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/production_fails_if_dev_mode_enabled (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/unset_env_fails_if_dev_mode_enabled (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/production_fails_if_legacy_auth_enabled (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/unset_env_fails_if_legacy_auth_enabled (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/staging_fails_if_legacy_auth_enabled (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/production_fails_if_DATABASE_URL_missing (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/unset_env_fails_if_DATABASE_URL_missing (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/production_valid_config_with_valid_proxy_CIDRs (0.00s)
    --- PASS: TestValidateStartupEnv_CoreAPI/fails_on_invalid_trusted_proxy_CIDR (0.00s)
```

### 3. Verification of Centralized Database Configuration
Centralized database URL loading and elimination of silent fallbacks were verified:
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
```

### 4. Verification of Legacy Header Authentication Gating
Disabling legacy header auth in production, staging, and unset environments was verified:
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
```

### 5. Verification of Fail-Closed CORS Configuration
CORS origin allowlist strictness and fail-closed default behavior were verified:
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
```

### 6. Verification of Trusted-Proxy Client IP Resolution
Untrusted hop selection, immediate peer rejection, and IP spoofing prevention were verified:
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
```

### 7. Verification of Docker Compose Configuration
Docker compose configuration was checked using `docker compose -f infra/docker-compose.yml config --quiet`:
```
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"SMTP_HOST\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"OTP_HMAC_SECRET\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"TWILIO_FROM_NUMBER\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"BYOS_DEV_MODE\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"TWILIO_ACCOUNT_SID\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"TWILIO_AUTH_TOKEN\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"SMTP_USERNAME\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"SMTP_PASSWORD\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"SMS_GATEWAY_KEY\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"SMS_GATEWAY_URL\" variable is not set. Defaulting to a blank string."
time="2026-11-14T17:12:48+06:00" level=warning msg="The \"GREENWEB_TOKEN\" variable is not set. Defaulting to a blank string."
```
Exit code: 0. Valid Compose topology preserved.

## Manual browser verification
**UNTESTED**
Release C3 modifies backend environment parsing, server startup guards, CORS origin allowlists, database DSN resolvers, and reverse-proxy IP headers. It introduces no user-facing UI markup or client-side logic. Manual verification of the configuration controls can be performed using curl:
1. Start the API with `BYOS_ENV=production` and `BYOS_DEV_MODE=1`: verify process aborts with diagnostic `BYOS_DEV_MODE cannot be enabled when BYOS_ENV is not 'development'`.
2. Start the API with `BYOS_ENV=production` and `BYOS_LEGACY_AUTH_ENABLED=1`: verify process aborts with diagnostic `BYOS_LEGACY_AUTH_ENABLED cannot be enabled when BYOS_ENV is not 'development'`.
3. Start the API with `BYOS_ENV=production` without `DATABASE_URL`: verify process aborts with diagnostic `DATABASE_URL is required in non-development environments`.
4. Issue an `OPTIONS` request with `Origin: http://localhost:3000` to an API running under `BYOS_ENV=production` without `BYOS_ALLOWED_ORIGINS`: verify no `Access-Control-Allow-Origin` header is returned.

## What did not work or is untested
1. Integration tests requiring a live PostgreSQL instance with disposable credentials (`TEST_DATABASE_URL`) were skipped by `testing.Short()` / environment guards, as live databases must not be mutated during maintenance tasks.
2. An existing failure in `multi_account_session_test.go` (`5. Storage Store` returning 400 due to namespace enforcement introduced in earlier commit `6de964b`) was not modified, preserving task scope and refactor discipline.

## Test suite output

### Admin API (`cd services/admin-api && go test -v -count=1 ./...`)
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
PASS
ok  	admin-api	0.835s
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
ok  	admin-api/handlers	0.084s
```

### Webmail Test Suite (`cd apps/webmail && npm test`)
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:19216) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 37 passed, 0 failed

Running Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed

Running Off-Thread Crypto Web Worker & Bridge Tests...
CRYPTO WORKER BRIDGE TESTS: 12 passed, 0 failed

Running Subscriptions & Unsubscribe Store Tests...
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed

Running Image Privacy Store Tests...
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed

Running KashCal Natural Language Event Parser Tests...
KASHCAL PARSER TESTS: 6 passed, 0 failed

Running Translator & Localization Tests...
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed

Running Folder & Trash Lifecycle Tests...
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 727 passed, 0 failed
```

## Test file diffs

```diff
diff --git a/services/admin-api/main_test.go b/services/admin-api/main_test.go
index 8a1a7ec..01c3def 100644
--- a/services/admin-api/main_test.go
+++ b/services/admin-api/main_test.go
@@ -51,7 +51,8 @@ func TestMockWebAuthnMiddlewareBlocksInProduction(t *testing.T) {
 }
 
 func TestMockLoginEndpointEnabledInDevMode(t *testing.T) {
-	// Assert that when BYOS_DEV_MODE is "1", /admin/v1/auth/mock-login returns 200 and token
+	// Assert that when BYOS_DEV_MODE is "1" and BYOS_ENV is "development", /admin/v1/auth/mock-login returns 200 and token
+	t.Setenv("BYOS_ENV", "development")
 	t.Setenv("BYOS_DEV_MODE", "1")
 
 	req := httptest.NewRequest(http.MethodGet, "/admin/v1/auth/mock-login", nil)
@@ -73,6 +74,7 @@ func TestMockLoginEndpointEnabledInDevMode(t *testing.T) {
 }
 
 func TestMockWebAuthnMiddlewareInDevMode(t *testing.T) {
+	t.Setenv("BYOS_ENV", "development")
 	t.Setenv("BYOS_DEV_MODE", "1")
 
 	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
@@ -154,6 +156,7 @@ func TestAdminAllowedOrigins(t *testing.T) {
 
 	// Subtest 1: Dev mode local origin matching
 	t.Run("DevModeLocalOrigins", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "development")
 		t.Setenv("BYOS_DEV_MODE", "1")
 		t.Setenv("ADMIN_ALLOWED_ORIGINS", "")
 
@@ -172,6 +175,7 @@ func TestAdminAllowedOrigins(t *testing.T) {
 
 	// Subtest 2: Dev mode unauthorized origin rejection
 	t.Run("DevModeUnauthorizedOrigin", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "development")
 		t.Setenv("BYOS_DEV_MODE", "1")
 		t.Setenv("ADMIN_ALLOWED_ORIGINS", "")
 
@@ -434,4 +438,115 @@ func TestAdminCookieSecurityConfiguration(t *testing.T) {
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
diff --git a/services/api/calendar_feed_proxy_test.go b/services/api/calendar_feed_proxy_test.go
index 9ed8273..48d6088 100644
--- a/services/api/calendar_feed_proxy_test.go
+++ b/services/api/calendar_feed_proxy_test.go
@@ -21,6 +21,7 @@ func TestCalendarFeedProxy_Unauthorized(t *testing.T) {
 }
 
 func TestCalendarFeedProxy_MissingOrInvalidURL(t *testing.T) {
+	t.Setenv("BYOS_ENV", "development")
 	t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "true")
 	testUserID := "11111111-1111-1111-1111-111111111111"
 
@@ -53,6 +54,7 @@ func TestCalendarFeedProxy_MissingOrInvalidURL(t *testing.T) {
 }
 
 func TestCalendarFeedProxy_SSRFProtection(t *testing.T) {
+	t.Setenv("BYOS_ENV", "development")
 	t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "true")
 	testUserID := "11111111-1111-1111-1111-111111111111"
 
diff --git a/services/api/cors_test.go b/services/api/cors_test.go
index f390ea0..144db6c 100644
--- a/services/api/cors_test.go
+++ b/services/api/cors_test.go
@@ -32,6 +32,14 @@ func TestIsAllowedOrigin(t *testing.T) {
 		{"http://127.0.0.1:8080", "development", true},
 		{"http://evil.com", "development", false},
 		{"http://localhost:3000", "production", false},
+		{"http://localhost:3000", "", false},
+		{"http://localhost:3000", "staging", false},
+		{"http://192.168.1.50:3000", "development", true},
+		{"http://192.168.1.50:3000", "production", false},
+		{"http://192.168.1.50:3000", "", false},
+		{"https://tunnel.trycloudflare.com", "development", true},
+		{"https://tunnel.trycloudflare.com", "production", false},
+		{"https://tunnel.trycloudflare.com", "", false},
 	}
 
 	for _, tc := range cases {
@@ -226,3 +234,51 @@ func TestWithCORS_CSRFProtection(t *testing.T) {
 		})
 	}
 }
+
+func TestWithCORS_FailClosedByDefault(t *testing.T) {
+	dummyHandler := func(w http.ResponseWriter, r *http.Request) {
+		w.WriteHeader(http.StatusOK)
+	}
+
+	t.Run("UnsetEnvAndUnsetAllowedOriginsRejectsLocalhost", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "")
+		t.Setenv("BYOS_ALLOWED_ORIGINS", "")
+
+		req := httptest.NewRequest(http.MethodOptions, "/v1/test", nil)
+		req.Header.Set("Origin", "http://localhost:3000")
+		rec := httptest.NewRecorder()
+		withCORS(dummyHandler)(rec, req)
+
+		if origin := rec.Header().Get("Access-Control-Allow-Origin"); origin != "" {
+			t.Errorf("expected empty Access-Control-Allow-Origin in unset env, got %q", origin)
+		}
+	})
+
+	t.Run("ProductionEnvAndUnsetAllowedOriginsRejectsLocalhost", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "production")
+		t.Setenv("BYOS_ALLOWED_ORIGINS", "")
+
+		req := httptest.NewRequest(http.MethodOptions, "/v1/test", nil)
+		req.Header.Set("Origin", "http://localhost:3000")
+		rec := httptest.NewRecorder()
+		withCORS(dummyHandler)(rec, req)
+
+		if origin := rec.Header().Get("Access-Control-Allow-Origin"); origin != "" {
+			t.Errorf("expected empty Access-Control-Allow-Origin in production without config, got %q", origin)
+		}
+	})
+
+	t.Run("DevelopmentEnvPermitsLocalhostByDefault", func(t *testing.T) {
+		t.Setenv("BYOS_ENV", "development")
+		t.Setenv("BYOS_ALLOWED_ORIGINS", "")
+
+		req := httptest.NewRequest(http.MethodOptions, "/v1/test", nil)
+		req.Header.Set("Origin", "http://localhost:3000")
+		rec := httptest.NewRecorder()
+		withCORS(dummyHandler)(rec, req)
+
+		if origin := rec.Header().Get("Access-Control-Allow-Origin"); origin != "http://localhost:3000" {
+			t.Errorf("expected Access-Control-Allow-Origin: http://localhost:3000 in dev mode, got %q", origin)
+		}
+	})
+}
diff --git a/services/api/message_attachments_test.go b/services/api/message_attachments_test.go
index c6da3a9..2e385a2 100644
--- a/services/api/message_attachments_test.go
+++ b/services/api/message_attachments_test.go
@@ -133,6 +133,7 @@ func TestUploadAttachmentChunk_ScopeIsolation(t *testing.T) {
 
 // 5. CORS preflight allows X-Object-Key
 func TestUploadAttachmentChunk_CORSPreflight(t *testing.T) {
+	t.Setenv("BYOS_ENV", "development")
 	mux := setupAttachmentChunkTestMux()
 	mailboxID := uuid.New().String()
 
```

## Conclusion
ACCEPTED
