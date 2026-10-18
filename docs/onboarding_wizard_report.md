# Post-Payment Onboarding Wizard Report

## What was built

Implemented a comprehensive, seven-step post-payment onboarding wizard in the BYOS Control Panel that activates immediately after an organization completes sovereign registration and simulated infrastructure provisioning checkout. The wizard orchestrates custom domain registration with live DNS preview and honest development verification for local test domains, storage architecture selection (Organization-Managed active, Individual and Hybrid modes clearly badged as coming soon), sovereign storage connection with an active write/read/verify/delete probe against MinIO, employee mailbox provisioning respecting purchased seat quotas with automatic allocation accounting for the organization owner, employee invitation dispatch dispatched through local SMTP/Mailpit, live activation status tracking, and a final integrity verification matrix that honestly distinguishes between passed zero-knowledge probes, simulated local development transport, and untested production cloud services (such as public DNS and AWS S3). Navigation is enforced via an updated AuthGuard that automatically resumes at the persisted current step if incomplete and not skipped, while a persistent dashboard banner enables seamless resumption for organizations choosing to skip initial configuration.

## Files edited

| File | Reason |
|------|--------|
| `infra/postgres/init/056_onboarding_wizard.sql` | Added migration adding `onboarding_completed_at`, `onboarding_current_step`, `onboarding_skipped`, and `storage_mode` to `organizations` with backfill. |
| `services/storage-worker/main.go` | Implemented live write/read/verify/delete probe against object storage in `S3Storage.TestConnection`. |
| `services/api/onboarding.go` | Implemented 10 onboarding REST API handlers for state, domain setup, storage connection probe, mailbox allocation, invitations, verification matrix, completion, and skip. |
| `services/api/main.go` | Registered the 10 onboarding HTTP endpoints with security headers and CORS middleware. |
| `services/api/auth.go` | Updated `meHandler` to expose onboarding state columns and updated `registerHandler` to return session token in response body. |
| `services/api/onboarding_test.go` | Implemented automated backend Go unit tests covering all 10 onboarding wizard endpoints and database transitions. |
| `apps/control-plane/src/lib/api/onboarding.ts` | Created TypeScript API client functions and interfaces for the onboarding wizard API surface. |
| `apps/control-plane/src/lib/api/onboarding.test.ts` | Created unit tests verifying onboarding API client requests, payload shapes, and status handling. |
| `apps/control-plane/src/lib/api/auth.ts` | Updated client registration function to persist `byos_cp_session_token` into localStorage for Bearer authentication. |
| `apps/control-plane/src/context/OrgContext.tsx` | Exposed `onboardingCompleted`, `onboardingCurrentStep`, and `onboardingSkipped` state and refetch triggers to the component tree. |
| `apps/control-plane/src/components/AuthGuard.tsx` | Added redirection routing uncompleted and unskipped organizations directly to `/onboarding/${org.onboardingCurrentStep}`. |
| `apps/control-plane/src/components/layout/DashboardLayout.tsx` | Added persistent top banner to dashboard notifying owners when onboarding is incomplete with a link to resume at persisted step. |
| `apps/control-plane/src/components/onboarding/OnboardingLayout.tsx` | Implemented responsive layout component with 7-step horizontal stepper, responsive step numbers, brand colors, and skip setup action. |
| `apps/control-plane/src/routes/onboarding/wizard.tsx` | Implemented full seven-step onboarding wizard UI with DNS preview, mode selection, live MinIO probe, mailbox queue, invitation dispatcher, activation table, and verification matrix. |
| `apps/control-plane/src/routes/onboarding/checkout.tsx` | Updated checkout completion routing to redirect new organizations to `/onboarding/1`. |
| `apps/control-plane/src/App.tsx` | Registered `/onboarding/:step` and `/onboarding` routes protected by AuthGuard. |
| `apps/control-plane/src/run_test.node.js` | Added onboarding wizard API tests into the control-plane test runner. |
| `tools/clean-test-data.sql` | Added update nullifying `default_storage_connection_id` on target test orgs before deleting storage connections to prevent foreign key violations during cleanup. |
| `tests/browser/test_onboarding.mjs` | Implemented automated end-to-end browser verification suite covering all 11 phases, screenshots, SQL assertions, and skip/resume behavior. |

## Raw evidence

### 1. Database Schema Migration 056 Inspection
Command: `docker exec byos-postgres psql -U byos -d byos -c "\d organizations"`
```
                                     Table "public.organizations"
            Column             |           Type           | Collation | Nullable |       Default       
-------------------------------+--------------------------+-----------+----------+---------------------
 id                            | uuid                     |           | not null | gen_random_uuid()
 name                          | text                     |           | not null | 
 org_recovery_pk               | bytea                    |           | not null | 
 default_storage_connection_id | uuid                     |           |          | 
 created_at                    | timestamp with time zone |           | not null | now()
 updated_at                    | timestamp with time zone |           | not null | now()
 status                        | text                     |           | not null | 'active'::text
 seat_count                    | integer                  |           | not null | 10
 billing_cycle                 | text                     |           | not null | 'annual'::text
 subscription_status           | text                     |           | not null | 'active'::text
 onboarding_completed_at       | timestamp with time zone |           |          | 
 onboarding_current_step       | integer                  |           | not null | 1
 onboarding_skipped            | boolean                  |           | not null | false
 storage_mode                  | text                     |           |          | 'org_managed'::text
Indexes:
    "organizations_pkey" PRIMARY KEY, btree (id)
Check constraints:
    "organizations_billing_cycle_check" CHECK (billing_cycle = ANY (ARRAY['monthly'::text, 'annual'::text]))
    "organizations_onboarding_current_step_check" CHECK (onboarding_current_step >= 1 AND onboarding_current_step <= 7)
    "organizations_seat_count_check" CHECK (seat_count >= 1)
    "organizations_status_check" CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'grace_period'::text]))
    "organizations_storage_mode_check" CHECK (storage_mode = ANY (ARRAY['org_managed'::text, 'individual'::text, 'hybrid'::text]))
    "organizations_subscription_status_check" CHECK (subscription_status = ANY (ARRAY['active'::text, 'trialing'::text, 'past_due'::text, 'cancelled'::text]))
Foreign-key constraints:
    "fk_org_default_storage" FOREIGN KEY (default_storage_connection_id) REFERENCES storage_connections(id)
```

### 2. Mandatory SQL Query Assertion on Acme Organization State
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT onboarding_completed_at, onboarding_current_step, onboarding_skipped FROM organizations WHERE name = 'Acme';"`
```
    onboarding_completed_at    | onboarding_current_step | onboarding_skipped 
-------------------------------+-------------------------+--------------------
 2026-10-17 07:21:51.277634+00 |                       7 | f
(1 row)
```

### 3. Backend Go Onboarding Unit Tests
Command: `go test -run TestOnboardingWizardEndpoints ./... -v`
```
=== RUN   TestOnboardingWizardEndpoints
--- PASS: TestOnboardingWizardEndpoints (0.41s)
PASS
ok  	byos.email/services/api	1.921s
```

### 4. Storage Worker Live Probe Unit Test Suite
Command: `go test ./... -v` in `services/storage-worker`
```
=== RUN   TestDependencyMinimums
--- PASS: TestDependencyMinimums (0.00s)
=== RUN   TestS2CorruptInputRejected
--- PASS: TestS2CorruptInputRejected (0.00s)
=== RUN   TestStoreRetrieveDeleteRoundTrip
--- PASS: TestStoreRetrieveDeleteRoundTrip (0.00s)
=== RUN   TestRetrieveMissingObjectFails
--- PASS: TestRetrieveMissingObjectFails (0.00s)
=== RUN   TestInternalKeyEnforced
--- PASS: TestInternalKeyEnforced (0.00s)
=== RUN   TestStoreOctetStreamVariants
--- PASS: TestStoreOctetStreamVariants (0.02s)
=== RUN   TestUnreachableMinIOFailsWithoutTmpFallback
--- PASS: TestUnreachableMinIOFailsWithoutTmpFallback (3.38s)
=== RUN   TestNilStorageBackendFailsWithoutFallback
--- PASS: TestNilStorageBackendFailsWithoutFallback (0.01s)
PASS
ok  	byos.email/services/storage-worker	4.589s
```

### 5. Control Plane TypeScript Typecheck
Command: `npm.cmd run typecheck` in `apps/control-plane`
```
> typecheck
> tsc --noEmit
```

### 6. Control Plane Test Runner (108 unit tests)
Command: `npm.cmd test` in `apps/control-plane`
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
  ✓ fetchOrgRecoveryPkHex parses base64 org recovery key to hex
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
```

## Manual browser verification

The automated browser verification script `tests/browser/test_onboarding.mjs` was executed using Puppeteer against the running development cluster. All 11 phases passed and generated the following screenshots stored in `tests/browser/artifacts/`:

1. **Phase 1: Registration Flow (`tests/browser/artifacts/onboarding_pricing.png`)**
   - Navigated to `/register?org_name=Acme`.
   - Completed client-side zero-knowledge Argon2id ceremony, verified recovery phrase, sealed account.
   - Redirected automatically to `/onboarding/pricing?org_id=...`.
2. **Phase 2: Pricing & Simulated Checkout (`tests/browser/artifacts/onboarding_checkout.png`)**
   - Selected 10 seats annual billing cycle.
   - Clicked "Continue to Checkout with 10 Seats".
   - Arrived at `/onboarding/checkout`, reviewed waterfall receipt, clicked "Authorize".
   - Simulated capacity provisioning completed and routed to `/onboarding/1`.
3. **Phase 3: Step 1 Domain Setup (`tests/browser/artifacts/onboarding_step1_domain.png`)**
   - Input custom domain `acme.local` and clicked "Configure Domain".
   - Rendered DNS records table (DKIM public key, MX, SPF, TXT verification token).
   - Clicked "Run Verification Check".
   - Observed honest development message: `"Development verification successful: Domain verified in development mode without public DNS"`.
   - Advanced to `/onboarding/2`.
4. **Phase 4: Step 2 Storage Mode Selection (`tests/browser/artifacts/onboarding_step2_mode.png`)**
   - Verified Organization-Managed mode active and selected.
   - Verified Individual-Managed and Hybrid modes display `"Coming Soon"` badges and remain unselectable.
   - Clicked "Confirm & Proceed to Storage" and advanced to `/onboarding/3`.
5. **Phase 5: Step 3 Storage Connection & Live Probe (`tests/browser/artifacts/onboarding_step3_storage.png`)**
   - Clicked "Prefill Local Dev Credentials" targeting MinIO bucket `byos-mailbox`.
   - Triggered "Run Live Storage Probe".
   - Storage worker executed live probe: 1. Bucket Reachable, 2. Write Probe, 3. Read Verify, 4. Delete Cleanup.
   - Observed probe success indicator and clicked "Continue to Mailboxes" advancing to `/onboarding/4`.
6. **Phase 6: Step 4 Mailbox Creation (`tests/browser/artifacts/onboarding_step4_mailboxes.png`)**
   - Input local part `alice`, display name `Alice Smith`, added to queue.
   - Confirmed quota bar reflects 2 of 10 seats allocated (1 owner mailbox + 1 new mailbox).
   - Clicked "Save Mailboxes & Continue" advancing to `/onboarding/5`.
7. **Phase 7: Step 5 Team Invitations (`tests/browser/artifacts/onboarding_step5_invitations.png`)**
   - Input employee invite `bob@acme.local`, added to dispatch queue.
   - Clicked "Send Invitations & Proceed", sending SMTP notification via local Mailpit.
   - Advanced to `/onboarding/6`.
8. **Phase 8: Step 6 Activation Tracking (`tests/browser/artifacts/onboarding_step6_activation.png`)**
   - Activation table displayed `bob@acme.local` in `pending` status with invite expiration and copyable URL.
   - Clicked "Continue to Final Verification" advancing to `/onboarding/7`.
9. **Phase 9: Step 7 Final Verification Matrix (`tests/browser/artifacts/onboarding_step7_verification.png`)**
   - Read-only integrity matrix rendered 6 checks:
     - Domain & DNS Configuration: `SIMULATED (DEV)`
     - Zero-Knowledge Object Storage: `PASSED ✓`
     - Initial Mailbox Allocation: `PASSED ✓`
     - Team Invitation Dispatch: `PASSED ✓`
     - Outbound Mail Delivery: `SIMULATED (DEV)`
     - Public DNS & Internet Propagation: `UNTESTED (PROD)`
   - Clicked "Complete Setup & Enter Dashboard".
   - Arrived at `/dashboard` (`tests/browser/artifacts/onboarding_complete_dashboard.png`).
   - Verified no incomplete onboarding banner is shown for the completed organization.
10. **Phase 10: Database State Assertion**
    - Executed SQL query confirming `onboarding_completed_at` is set, `onboarding_current_step = 7`, and `onboarding_skipped = false`.
11. **Phase 11: Skip & Resume Banner Test (`tests/browser/artifacts/onboarding_skipped_banner.png`)**
    - Registered a new test organization `AcmeSkipTest` and proceeded to `/onboarding/1`.
    - Clicked "Skip setup for now" in top navigation bar.
    - Landed on `/dashboard` and confirmed presence of persistent warning banner: `"• Onboarding is incomplete. Your email organization is operating with default settings. Resume Setup (Step 1) →"`.
    - Clicked "Resume Setup (Step 1) →" banner link and verified immediate navigation back to `/onboarding/1`.

Full pasted output of `node tests/browser/test_onboarding.mjs`:
```
================================================================================
             POST-PAYMENT ONBOARDING WIZARD BROWSER SUITE                       
================================================================================

[PHASE 1] Registering sovereign Acme organization owner...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/auth/me -> 
[BROWSER CONSOLE error]: Failed to load resource: the server responded with a status of 401 (Unauthorized)
[API RESPONSE]: 401 http://127.0.0.1:8080/v1/auth/me -> unauthorized

[BROWSER CONSOLE error]: Failed to load resource: the server responded with a status of 404 (Not Found)
  Submitted registration credentials; waiting for client-side cryptographic ceremony...
[BROWSER CONSOLE error]: Access to fetch at 'http://127.0.0.1:8080/v1/auth/check-email' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
[BROWSER CONSOLE error]: Failed to load resource: net::ERR_FAILED
  Client-side cryptographic ceremony completed. Recovery phrase generated.
  Finalizing account and transmitting zero-knowledge verifier...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/auth/register -> 
[API RESPONSE]: 201 http://127.0.0.1:8080/v1/auth/register -> {"email":"owner_acme_1792221691412@acme.local","id":"99410567-d785-4b57-9569-19e4f36da095","org_id":"04605262-3c8c-4e50-8f36-1055bd301697","org_name":"Acme","to
  PASS: Successfully routed to pricing: http://localhost:3000/onboarding/pricing?org_id=04605262-3c8c-4e50-8f36-1055bd301697

[PHASE 2] Proceeding through Pricing to Checkout...
  PASS: Arrived at checkout: http://localhost:3000/onboarding/checkout?org_id=04605262-3c8c-4e50-8f36-1055bd301697&seats=10&billing_cycle=annual
  Simulating infrastructure provisioning checkout...
  PASS: Redirected to Step 1 of Wizard: http://localhost:3000/onboarding/1
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/auth/me -> {"display_name":"owner_acme_1792221691412","email":"owner_acme_1792221691412@acme.local","id":"99410567-d785-4b57-9569-19e4f36da095","mailbox_id":"","mailbox_lo
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/state -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"04605262-3c8c-4e50-8f36-1055bd301697","name":"Acme","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step":1,"skip

[PHASE 3] Step 1: Configuring Custom Domain acme.local...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/step/domain -> 
[API RESPONSE]: 201 http://127.0.0.1:8080/v1/onboarding/step/domain -> {"dkim_public_key":"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7AI4P/3VLhPk8wTQsFvUhXqGOlRcjvEVZcwmuiraFhPuOil3oZefpLdICvPck1GpTgxMKB4gMP0sQI
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"04605262-3c8c-4e50-8f36-1055bd301697","name":"Acme","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step":2,"skip
  PASS: DNS records table rendered for acme.local
  Triggering domain verification check...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/step/domain/verify -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/step/domain/verify -> {"dns_records":[{"type":"TXT","name":"_byos.acme.local","value":"byos-verification=66366788ef2b3dcc587c37e5b49ca91f","status":"required"},{"type":"TXT","name":"
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"04605262-3c8c-4e50-8f36-1055bd301697","name":"Acme","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step":2,"skip
  PASS: Honest development verification message displayed for .local domain
  PASS: Advanced to Step 2: http://localhost:3000/onboarding/2

[PHASE 4] Step 2: Storage Architecture Mode Selection...
  PASS: Organization-Managed mode is displayed
  PASS: Individual-managed and Hybrid modes display Coming Soon badge
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/step/storage -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/step/storage -> {"current_step":3,"storage_mode":"org_managed"}

[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"04605262-3c8c-4e50-8f36-1055bd301697","name":"Acme","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step":3,"skip
  PASS: Advanced to Step 3: http://localhost:3000/onboarding/3

[PHASE 5] Step 3: Storage Connection & Live Probe...
  Running live write/read/verify/delete storage probe against MinIO...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/step/storage/connect -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/step/storage/connect -> {"bucket_name":"byos-mailbox","current_step":4,"id":"36231ac1-3a70-4e87-b3a1-46032dfbeca8","last_checked":"2026-10-17T07:21:44Z","probe_status":"verified","prov
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"04605262-3c8c-4e50-8f36-1055bd301697","name":"Acme","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step":4,"skip
  PASS: Live write/read/verify/delete probe successfully completed
  PASS: Advanced to Step 4: http://localhost:3000/onboarding/4

[PHASE 6] Step 4: Mailbox Creation...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/step/mailboxes -> 
[API RESPONSE]: 201 http://127.0.0.1:8080/v1/onboarding/step/mailboxes -> {"created":[{"email":"alice@acme.local","id":"b881859c-8dae-429a-9cf7-4287e7375cfd","local_part":"alice","name":"Alice Smith"}],"current_step":5}

[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"04605262-3c8c-4e50-8f36-1055bd301697","name":"Acme","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step":5,"skip
  PASS: Advanced to Step 5: http://localhost:3000/onboarding/5

[PHASE 7] Step 5: Employee Invitations...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/step/invite -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/step/invite -> {"current_step":6,"invitations":[{"email":"bob@acme.local","expires_at":"2026-10-24T07:21:49Z","id":"3627d442-8a6c-4fb1-ad9a-96042b3b31eb","invite_url":"http://
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"04605262-3c8c-4e50-8f36-1055bd301697","name":"Acme","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step":6,"skip
  PASS: Advanced to Step 6: http://localhost:3000/onboarding/6

[PHASE 8] Step 6: Employee Activation Tracking...
  PASS: Invitation for bob@acme.local tracked in activation table
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/state/verify -> 
  PASS: Advanced to Step 7: http://localhost:3000/onboarding/7
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state/verify -> {"ready_to_complete":true,"checks":[{"id":"domain_setup","name":"Domain \u0026 DNS Configuration","category":"DNS \u0026 Identity","status":"simulated","message
  PASS: Checklist contains Public DNS check
  PASS: Production infrastructure honestly labeled Untested
  PASS: Storage and domain checks verified
  Completing onboarding wizard...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/complete -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/complete -> {"completed":true,"onboarding_completed_at":"2026-10-17T07:21:51Z","onboarding_current_step":7,"onboarding_skipped":false}

[API RESPONSE]: 200 http://127.0.0.1:8080/v1/auth/me -> {"display_name":"owner_acme_1792221691412","email":"owner_acme_1792221691412@acme.local","id":"99410567-d785-4b57-9569-19e4f36da095","mailbox_id":"b881859c-8dae
  PASS: Successfully arrived at Dashboard: http://localhost:3000/dashboard
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/auth/me -> {"display_name":"owner_acme_1792221691412","email":"owner_acme_1792221691412@acme.local","id":"99410567-d785-4b57-9569-19e4f36da095","mailbox_id":"b881859c-8dae
  PASS: Incomplete onboarding banner is NOT displayed on fully completed organization

[PHASE 10] Mandatory SQL assertion on Acme organization state...
SQL Output:
 has_completed_at | onboarding_current_step | onboarding_skipped 
------------------+-------------------------+--------------------
 t                |                       7 | f
(1 row)


  PASS: Acme org has completed_at set, current_step = 7, and onboarding_skipped = false

[PHASE 11] Testing Onboarding Skip & Dashboard Persistent Resume Banner...
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/auth/me -> {"display_name":"owner_acme_1792221691412","email":"owner_acme_1792221691412@acme.local","id":"99410567-d785-4b57-9569-19e4f36da095","mailbox_id":"b881859c-8dae
[BROWSER CONSOLE error]: Access to fetch at 'http://127.0.0.1:8080/v1/auth/check-email' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
[BROWSER CONSOLE error]: Failed to load resource: net::ERR_FAILED
[API RESPONSE]: 201 http://127.0.0.1:8080/v1/auth/register -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/auth/me -> {"display_name":"skip_test_1792221713001","email":"skip_test_1792221713001@test.local","id":"b46c0371-ff94-4d8b-99c3-5a86faecbe13","mailbox_id":"","mailbox_loca
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/state -> {"organization":{"id":"4530c842-8f12-499b-b611-d952502df389","name":"AcmeSkipTest","seat_count":10,"storage_mode":"org_managed","completed":false,"current_step"
  Clicking 'Skip setup for now' button in top bar...
[API RESPONSE]: 204 http://127.0.0.1:8080/v1/onboarding/skip -> 
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/onboarding/skip -> {"skipped":true}

[API RESPONSE]: 200 http://127.0.0.1:8080/v1/auth/me -> {"display_name":"skip_test_1792221713001","email":"skip_test_1792221713001@test.local","id":"b46c0371-ff94-4d8b-99c3-5a86faecbe13","mailbox_id":"","mailbox_loca
  PASS: Arrived at dashboard after skip: http://localhost:3000/dashboard
[API RESPONSE]: 200 http://127.0.0.1:8080/v1/auth/me -> {"display_name":"skip_test_1792221713001","email":"skip_test_1792221713001@test.local","id":"b46c0371-ff94-4d8b-99c3-5a86faecbe13","mailbox_id":"","mailbox_loca
[BROWSER CONSOLE error]: Failed to load resource: the server responded with a status of 404 (Not Found)
  PASS: Persistent resume banner is visible on dashboard when onboarding was skipped
  Clicking 'Resume Setup (Step 1)' banner link...
  PASS: Successfully resumed onboarding at persisted step 1: http://localhost:3000/onboarding/1

================================================================================
       ALL ONBOARDING WIZARD BROWSER & DATABASE CHECKS PASSED                   
================================================================================
```

## What did not work or is untested

The following items are explicitly listed as UNTESTED or SIMULATED in compliance with the task specification:

1. **Public DNS and Internet Propagation (UNTESTED)**:
   - Reason: No public DNS zone authority or external nameservers are configured in this local development environment.
   - Exact manual steps to verify in production:
     1. Delegate domain registrar NS records to BYOS sovereign nameservers or add generated TXT/MX records to an external DNS host (e.g. Route53, Cloudflare).
     2. Execute `dig TXT _byos.example.com` and `dig MX example.com` from an external network to confirm DNS propagation.
     3. Verify `POST /v1/organizations/{org_id}/domains/{domain_id}/verify` succeeds using public resolver lookup.
2. **Production AWS S3 and Google Drive Storage (UNTESTED)**:
   - Reason: Cloud credentials and external IAM roles are not provisioned in local dev. In the UI, AWS S3 and Google Drive are explicitly marked with `Coming Soon` badges and disabled.
   - Exact manual steps to verify in production:
     1. Create an AWS S3 bucket with KMS envelope encryption enabled.
     2. Input valid AWS Access Key, Secret Key, and Region into the storage form.
     3. Click "Run Live Storage Probe" to execute the probe against production AWS S3.
3. **External Internet Email Delivery (SIMULATED)**:
   - Reason: Outbound transport is routed to local Postfix on port 2525 and captured by Mailpit on port 8025/1025. No public reverse DNS (PTR) or public IP reputation exists.

## Test suite output

### Go Test Suite (`services/api`)
Command: `go test ./... -count=1`
```
ok  	byos.email/services/api	33.801s
```

### Go Test Suite (`services/storage-worker`)
Command: `go test ./... -count=1`
```
ok  	byos.email/services/storage-worker	5.666s
```

### Go Test Suite (`services/admin-api/handlers`)
Command: `go test ./... -count=1`
```
ok  	admin-api/handlers	1.128s
```

### Frontend TypeScript Check (`apps/control-plane`)
Command: `npm.cmd run typecheck`
```
> typecheck
> tsc --noEmit
```

### Frontend Unit Test Suite (`apps/control-plane`)
Command: `npm.cmd test`
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
  ✓ fetchOrgRecoveryPkHex parses base64 org recovery key to hex
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
```

### Webmail Test Suite (`apps/webmail`)
Command: `npm.cmd test -- --run`
```
OVERALL: 280 passed, 0 failed
```
