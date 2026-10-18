# Control Panel Seat-Based Billing Conversion Report

## What was built
Converted the Control Panel Billing section and supporting backend services from the legacy named-plan pricing model (Solo, Starter, Business, Team, Business+, Enterprise) to the graduated per-seat bracket model specified in Roadmap Section 25. Under this model, there are no named plans and no feature gating—every seat receives the complete product. Pricing is calculated using graduated marginal tax brackets (1–10 seats at $3.00/seat/mo, 11–25 seats at $2.85/seat/mo, 26–50 seats at $2.71/seat/mo, 51–100 seats at $2.57/seat/mo, and 101+ seats at $2.44/seat/mo), with annual billing offering a 16.7% discount (12 months for the price of 10). Resource limits are computed dynamically from provisioned seat count on read without storing static caps: Mailboxes (1 per seat exact), Domains (max(1, ceil(seats / 5))), Aliases (max(5, seats * 2)), and Unlimited customer-controlled storage. The frontend provides an interactive seat stepper, live waterfall breakdown, bracket guidance hint, billing cycle toggle, capacity usage progress bars, and prevents reducing seat capacity below active mailboxes.

## Files edited
| File | Reason |
|------|--------|
| `apps/control-plane/src/components/layout/Sidebar.tsx` | Display seat count and subscription status badge instead of named plan cards in navigation sidebar |
| `apps/control-plane/src/context/OrgContext.tsx` | Expose seatCount and subscriptionStatus in organization context and guard against dashboard unmounting during refetches |
| `apps/control-plane/src/lib/api/billing.ts` | Provide API client functions for seat adjustment and capacity queries with authorization header injection |
| `apps/control-plane/src/lib/pricing_math.test.ts` | Unit tests for 5-tier graduated pricing math, billing cycle discounts, and dynamic resource cap formulas |
| `apps/control-plane/src/lib/pricing_math.ts` | Core mathematical engine for graduated seat brackets, annual discounts, and dynamic resource caps |
| `apps/control-plane/src/routes/dashboard/billing.tsx` | Redesigned billing view with seat stepper, waterfall breakdown, cycle switch, capacity meters, and downgrade constraints |
| `apps/control-plane/src/routes/dashboard/index.tsx` | Display provisioned seat count and active mailbox utilization in dashboard overview cards |
| `apps/control-plane/src/routes/dashboard/mailboxes.tsx` | Replace named plan badges with seat capacity indicators in mailbox list header |
| `apps/public-site/src/lib/pricing_math.ts` | Synchronize pricing constants and dynamic limit formulas between public site and control plane |
| `infra/postgres/init/055_seat_based_pricing.sql` | Migration dropping plan, max_domains, and max_aliases columns and adding seat_count and subscription_status |
| `services/admin-api/handlers/organizations.go` | Calculate seat pricing and dynamic capacity caps in admin organization management endpoints |
| `services/admin-api/handlers/organizations_test.go` | Update admin organization tests for seat pricing and dropped plan columns |
| `services/admin-api/handlers/pricing.go` | Go implementation of graduated seat pricing calculations and dynamic cap formulas |
| `services/admin-api/handlers/seat_billing_test.go` | Unit tests for seat updates, floor validations, and capacity caps in admin-api |
| `services/api/aliases_test.go` | Update test fixture queries to insert seat_count instead of dropped plan column |
| `services/api/auth.go` | Update auth session queries to return seat_count and subscription_status instead of plan |
| `services/api/billing.go` | Implement PATCH /v1/organizations/{org_id}/seats and GET /v1/organizations/{org_id}/capacity endpoints |
| `services/api/billing_test.go` | Unit tests for seat updates, active mailbox floor enforcement, and seat zero rejection |
| `services/api/bridge.go` | Remove queries selecting dropped plan column in bridge handlers |
| `services/api/domains.go` | Enforce domain quotas dynamically from seat_count and remove dropped plan/max_domains references |
| `services/api/invitations.go` | Enforce seat mailbox quota dynamically during account invitation creation |
| `services/api/invitations_test.go` | Update invitation test fixtures to initialize seat_count on test organizations |
| `services/api/mailboxes.go` | Enforce mailbox quota (seats) and alias quota (max(5, seats*2)) dynamically from seat_count |
| `services/api/main.go` | Register HTTP routes for organization seat update and capacity retrieval |
| `services/api/outbound.go` | Remove queries selecting dropped plan column in outbound handlers |
| `services/api/passkeys.go` | Update passkey auth queries to return seat_count and subscription_status |
| `services/api/recovery_flow.go` | Update recovery session queries to return seat_count and subscription_status |
| `services/api/sessions_test.go` | Update session test fixtures to insert seat_count instead of dropped plan column |
| `services/api/settings_test.go` | Update settings test fixtures to insert seat_count instead of dropped plan column |
| `services/api/two_factor.go` | Update two-factor auth queries to return seat_count and subscription_status |
| `services/api/user_mailboxes_test.go` | Update user mailbox test fixtures to insert seat_count instead of dropped plan column |
| `smoke.ps1` | Add test_control_plane_billing.mjs to smoke test suite (16 tests total) |
| `tests/browser/test_control_plane_billing.mjs` | Browser automation suite verifying seat stepper, breakdown, annual discount, capacity meters, and limits |
| `tests/browser/test_public_site.mjs` | Support Docker port 3002 in public site browser test |
| `tools/seat_billing_verify.sql` | SQL verification script checking schema changes, constraints, and org data |
| `.dockerignore` | Configure ignore patterns for Docker build contexts across services |
| `apps/control-plane/Dockerfile` | Docker container build definition for Control Panel web application |
| `apps/control-plane/vite.config.ts` | Configure Control Panel dev and preview host bindings for container access |
| `apps/public-site/Dockerfile` | Docker container build definition for Public Website Astro application |
| `apps/public-site/astro.config.mjs` | Configure Public Site host bindings and server port for Docker integration |
| `apps/support-crm/Dockerfile` | Docker container build definition for Support CRM web application |
| `apps/support-crm/vite.config.ts` | Configure Support CRM dev and preview host bindings for container access |
| `apps/webmail/Dockerfile` | Docker container build definition for Webmail client application |
| `apps/webmail/src/App.tsx` | Remove blocking blur requirement on login button during credential entry |
| `apps/webmail/vite.config.ts` | Configure Webmail dev and preview host bindings for container access |
| `docs/dev_startup_docker_report.md` | Documentation report for containerized application startup architecture |
| `infra/docker-compose.yml` | Compose definitions uniting all 4 frontends and backend services into unified stack |
| `services/admin-api/Dockerfile` | Docker container build definition for Admin API Go service |
| `start_dev.bat` | Windows batch launcher for development environment startup |
| `start_dev.ps1` | PowerShell startup script orchestrating Docker and service verification |

## Raw evidence

### Check 1: GET /v1/organizations/{org_id}/billing
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/billing', { headers: { 'Authorization': 'Bearer ' + process.argv[1] } }).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))" "<token>"
```
Output:
```json
{
  "seat_count": 20,
  "subscription_status": "active",
  "billing_cycle": "annual",
  "monthly_usd": 58.5,
  "annual_usd": 585,
  "mailbox_limit": 20,
  "domain_limit": 4,
  "aliases_per_mail": 40,
  "used_mailboxes": 2,
  "used_domains": 2,
  "used_aliases": 0
}
```

### Check 2: PATCH /v1/organizations/{org_id}/seats to 25 seats
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/seats', { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + process.argv[1], 'Content-Type': 'application/json' }, body: JSON.stringify({ seat_count: 25 }) }).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))" "<token>"
```
Output:
```json
{
  "annual_total_cents": 72750,
  "monthly_total_cents": 7275,
  "org_id": "00000000-0000-0000-0000-000000000aaa",
  "seat_count": 25
}
```
Audit log entry written in PostgreSQL:
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "SELECT org_id, user_id, action, resource_type, details, created_at FROM audit_log WHERE action = 'update_seats' ORDER BY created_at DESC LIMIT 1;"
```
Output:
```
                org_id                |               user_id                |    action    | resource_type |      details       |          created_at           
--------------------------------------+--------------------------------------+--------------+---------------+--------------------+-------------------------------
 00000000-0000-0000-0000-000000000aaa | cccccccc-0000-0000-0000-000000000002 | update_seats | organization  | {"seat_count": 25} | 2026-10-16 17:51:43.056312+00
(1 row)
```

### Check 3: PATCH /v1/organizations/{org_id}/seats with seat_count < active_mailboxes
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/seats', { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + process.argv[1], 'Content-Type': 'application/json' }, body: JSON.stringify({ seat_count: 1 }) }).then(r => { console.log('Status: ' + r.status); return r.json(); }).then(d => console.log(JSON.stringify(d, null, 2)))" "<token>"
```
Output:
```
Status: 400
{
  "current_mailboxes": 2,
  "error": "seat_count_below_active_mailboxes"
}
```

### Check 4: PATCH /v1/organizations/{org_id}/seats with seat_count = 0
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/seats', { method: 'PATCH', headers: { 'Authorization': 'Bearer ' + process.argv[1], 'Content-Type': 'application/json' }, body: JSON.stringify({ seat_count: 0 }) }).then(r => { console.log('Status: ' + r.status); return r.text(); }).then(console.log)" "<token>"
```
Output:
```
Status: 400
seat_count must be between 1 and 10000
```

### Check 5: GET /v1/organizations/{org_id}/capacity
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/capacity', { headers: { 'Authorization': 'Bearer ' + process.argv[1] } }).then(r => r.json()).then(d => console.log(JSON.stringify(d, null, 2)))" "<token>"
```
Output:
```json
{
  "aliases": {
    "cap": 50,
    "used": 0
  },
  "domains": {
    "cap": 5,
    "used": 2
  },
  "mailboxes": {
    "cap": 25,
    "used": 2
  },
  "storage": {
    "cap": null,
    "note": "customer-controlled",
    "used": null
  }
}
```

### Check 6: Price calculation matches pricing_math.ts across test points
Command:
```powershell
node scratch/execute_checks.mjs
```
Output:
```
Seats:   2 | Monthly: $6.00 (expected $6.00) [MATCH] | Annual: $60.00 (expected $60.00) [MATCH]
Seats:   5 | Monthly: $15.00 (expected $15.00) [MATCH] | Annual: $150.00 (expected $150.00) [MATCH]
Seats:  10 | Monthly: $30.00 (expected $30.00) [MATCH] | Annual: $300.00 (expected $300.00) [MATCH]
Seats:  20 | Monthly: $58.50 (expected $58.50) [MATCH] | Annual: $585.00 (expected $585.00) [MATCH]
Seats:  50 | Monthly: $140.50 (expected $140.50) [MATCH] | Annual: $1405.00 (expected $1405.00) [MATCH]
Seats: 100 | Monthly: $269.00 (expected $269.00) [MATCH] | Annual: $2690.00 (expected $2690.00) [MATCH]
```

### Check 7: Quota enforcement - Mailbox creation fails when mailboxes = seats
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/mailboxes', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.argv[1], 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '11111111-2222-3333-4444-555555555555', domain_id: '00000000-0000-0000-0000-000000000bbb', local_part: 'quotatest', mode: 'private', mailbox_sk_wrapped: '00'.repeat(61), mailbox_pk: '00'.repeat(32) }) }).then(r => { console.log('Status: ' + r.status); return r.json(); }).then(d => console.log(JSON.stringify(d, null, 2)))" "<token>"
```
Output:
```
Status: 402
{
  "error": "mailbox_limit_reached",
  "limit": 2,
  "seat_count": 2
}
```

### Check 8: Quota enforcement - Domain creation fails when domains = max(1, ceil(seats/5))
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/domains', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.argv[1], 'Content-Type': 'application/json' }, body: JSON.stringify({ domain: 'quota-test-domain.org' }) }).then(r => { console.log('Status: ' + r.status); return r.json(); }).then(d => console.log(JSON.stringify(d, null, 2)))" "<token>"
```
Output:
```
Status: 402
{
  "error": "domain_limit_reached",
  "limit": 1,
  "seat_count": 2
}
```

### Check 9: Quota enforcement - Alias creation fails when aliases = max(5, seats*2)
Command:
```powershell
node -e "fetch('http://127.0.0.1:8080/v1/mailboxes/c0000000-0000-0000-0000-000000000001/aliases', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.argv[1], 'Content-Type': 'application/json' }, body: JSON.stringify({ alias: 'excess_alias@byos.local' }) }).then(r => { console.log('Status: ' + r.status); return r.json(); }).then(d => console.log(JSON.stringify(d, null, 2)))" "<token>"
```
Output:
```
Status: 402
{
  "error": "alias_limit_reached",
  "limit": 5,
  "seat_count": 2
}
```

### Check 10: Database Schema Verification
Command:
```powershell
Get-Content tools/seat_billing_verify.sql | docker exec -i byos-postgres psql -U byos -d byos
```
Output:
```
     column_name     | data_type | column_default | is_nullable 
---------------------+-----------+----------------+-------------
 seat_count          | integer   | 10             | NO
 subscription_status | text      | 'active'::text | NO
(2 rows)

 column_name | data_type | is_nullable 
-------------+-----------+-------------
(0 rows)

            conname             |   pg_get_constraintdef    
--------------------------------+---------------------------
 organizations_seat_count_check | CHECK ((seat_count >= 1))
(1 row)

                  id                  |                          name                           | seat_count | subscription_status | billing_cycle 
--------------------------------------+---------------------------------------------------------+------------+---------------------+---------------
 00000000-0000-0000-0000-000000000aaa | Smoke Test Org                                          |         20 | active              | annual
 8d0ff141-f082-418f-836f-8ed63b986e23 | Test Org 0bc6c1ac-a637-49bc-87dd-ddd12df3d6af           |         10 | active              | annual
 60cad3ea-74ba-4342-a564-2c5fe7ada224 | Test Org 1f8d9640-b4d8-4243-a1eb-be61ede3a65a           |         10 | active              | annual
 4be4b8b1-f49a-4ff5-b125-f748669833c7 | Test Org 21854b19-72e6-4b86-8c01-b0fe78f7c92d           |         10 | active              | annual
 f826cad4-16c0-4dae-abda-e14989ece33d | Test Org 29bede0a-40c3-4685-a85b-af68ee675b44           |         10 | active              | annual
 b583469d-9628-4ad7-b113-c980fcb5239c | Test Org 30af4919-69fe-4b09-8c8d-8eb76f0a6ca5           |         10 | active              | annual
 42a246d0-54ae-4e6f-89dd-29cab5b5f271 | Test Org 5755aab8-d1fe-4462-ab38-ca410b46ec94           |         10 | active              | annual
 2c88f219-1fdf-4d52-9349-7a10c87dfa09 | Test Org dccbedda-1ebb-4a70-9ad7-158c61f2515b           |         10 | active              | annual
 5aba19dd-1074-49a3-a0e6-b8e4cbd67f1a | Test Org df5e327d-93ef-40e9-a74f-87c097fd09a0           |         10 | active              | annual
 fa3aa0fb-c4b2-45f8-852b-9f5812c0c51d | Test Org ef4890fb-571c-4522-9949-6628860736be           |         20 | active              | annual
 fd381eb5-fceb-4ce0-8c4c-59a9aa5a77c6 | Test Org other-org-bfbd10b7-bc7a-44df-838f-f59e3846bcda |         10 | active              | annual
 14a68b92-8954-4918-87a7-d1df4586ee81 | Threading Org 14a68b92                                  |         10 | active              | annual
 1cf11963-b4aa-4b5d-90f1-5f9b39e6bdb5 | Threading Org 1cf11963                                  |         10 | active              | annual
 3508e610-3928-4074-82bb-b7c3ef84af3a | Threading Org 3508e610                                  |         10 | active              | annual
 43eee436-f481-458c-bbaf-e932ef36dc16 | Threading Org 43eee436                                  |         10 | active              | annual
 4f93915e-b4a6-433f-8eee-5123c8211635 | Threading Org 4f93915e                                  |         10 | active              | annual
 6165c85c-0f16-4fe5-90e2-51524b8566cf | Threading Org 6165c85c                                  |         10 | active              | annual
 66e3eccb-82ea-4e96-8e1f-fd89f529ee19 | Threading Org 66e3eccb                                  |         10 | active              | annual
 785df102-300e-4958-bf83-6e1b89ad7e7d | Threading Org 785df102                                  |         10 | active              | annual
 8eef5099-ad4e-49b0-81c3-faf0ce7abfb8 | Threading Org 8eef5099                                  |         10 | active              | annual
 8f1d2039-fa99-43be-ba24-db83734851eb | Threading Org 8f1d2039                                  |         10 | active              | annual
 b8ffef9c-3bd7-493e-894d-ce82e22439a0 | Threading Org b8ffef9c                                  |         10 | active              | annual
 d65b81e1-a703-4b7a-bb99-8c000b03a999 | Threading Org d65b81e1                                  |         10 | active              | annual
 dd7c057f-a8a0-4e5b-86c2-e1e7163ef81d | Threading Org dd7c057f                                  |         10 | active              | annual
 efcdfc3c-2b9a-41be-b861-22537adfe8ba | Threading Org efcdfc3c                                  |         10 | active              | annual
 f51806e6-89b4-4a66-9408-dc52f430b89c | Threading Org f51806e6                                  |         10 | active              | annual
(26 rows)
```

## Manual browser verification
Executed browser verification test suite `tests/browser/test_control_plane_billing.mjs` against the running Control Panel on port 3000 and Core API on port 8080:

1. **Real Authentication:** Logged in as Alice (`alice@byos.local` / `test-password-123`) using the sovereign login flow.
2. **Monthly Breakdown Assertion:** Loaded `/dashboard/billing` with 20 seats; verified interactive input displays 20, monthly tier breakdown renders Tier 1 (10 × $3.00) and Tier 2 (10 × $2.85), total shows $58.50/month, and dynamic guidance hint displays: `"You're in the 11–25 seat bracket. Additional seats cost $2.85 each until you reach 25."`.
   Screenshot saved: `tests/browser/artifacts/billing_monthly_20_seats.png`
3. **Annual Cycle Toggle:** Switched cycle toggle to Annual; verified total updates to $585.00/year (10 × $58.50) with prepay discount -$117.00 (2 months free).
   Screenshot saved: `tests/browser/artifacts/billing_annual_20_seats.png`
4. **Capacity Calculations:** Verified dynamic resource meters: Mailboxes `2 / 20`, Domains `2 / 4` (`max(1, ceil(20/5))`), Aliases `0 / 40` (`max(5, 20*2)`), and Storage indicated as Unlimited (customer-controlled).
   Screenshot saved: `tests/browser/artifacts/billing_capacity.png`
5. **Interactive Seat Stepping & Persistence:** Stepped seats up from 20 to 26; verified dynamic bracket hint transitioned to Tier 3 (26–50) with $2.71 rate. Clicked "Save Seat Changes"; received HTTP 200 and observed instant success alert banner. Reloaded page and verified 26 seats persisted across full browser page refresh.
6. **Active Mailbox Floor Constraint:** Tested reduction to 2 seats (matching the 2 active mailboxes for Alice and Bob). Verified decrement button became disabled with tooltip: `"Deactivate a mailbox before reducing seats below 2."`.
   Screenshot saved: `tests/browser/artifacts/billing_decrement_disabled.png`
7. **Clean State Restoration:** Restored seat count back to 20 seats.

Command:
```powershell
node tests/browser/test_control_plane_billing.mjs
```
Output:
```
================================================================================
             CONTROL PANEL SEAT-BASED BILLING BROWSER INTEGRATION TEST          
================================================================================

--- [STEP 1] Real login flow as Alice (alice@byos.local) ---
  Active account: "alice@byos.local"
  PASS: Alice logged in successfully via real credentials

--- [STEP 2] Navigate to Control Panel Billing Page ---
  PASS: Control Panel Billing page loaded successfully

[STEP 3] Verifying Monthly graduated breakdown for 20 seats...
  PASS: Seat count input shows 20 (got 20)
  PASS: Breakdown contains: 10 seats × $3.00
  PASS: Breakdown contains: 10 seats × $2.85
  PASS: Breakdown contains total: $58.50/month
  PASS: Bracket hint correctly identifies 11–25 tier
  PASS: Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\billing_monthly_20_seats.png

[STEP 4] Toggling to Annual billing cycle...
  PASS: Annual total shows $585.00 (10 × $58.50)
  PASS: Annual discount line shows -$117.00 (2 months free)
  PASS: Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\billing_annual_20_seats.png

[STEP 5] Verifying Capacity panel calculations...
  PASS: Mailbox capacity shows 2 / 20
  PASS: Domain capacity shows / 4
  PASS: Masked alias capacity shows / 40
  PASS: Storage is marked Unlimited
  PASS: Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\billing_capacity.png

[STEP 6] Stepping seats up to 26 (enters Tier 3: 26–50)...
  PASS: Bracket hint dynamically updated to 26–50 bracket
  PASS: Breakdown includes Tier 3 unit rate $2.71

[STEP 7] Saving seat changes to 26 seats...
  PASS: Success banner displayed: "Organization seat capacity successfully updated to 26 seats.✕"

[STEP 8] Reloading page to verify persistence...
  PASS: Seat count 26 persisted across reload (got 26)

[STEP 9] Testing decrement boundary against active mailboxes (2)...
  PASS: Decrement button is disabled when seats equal active mailboxes
  PASS: Tooltip warns about active mailboxes: "Deactivate a mailbox before reducing seats below 2."
  PASS: Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\billing_decrement_disabled.png

[STEP 10] Restoring seat count back to 20...

================================================================================
                        DEVTOOLS STATE AUDIT                                    
================================================================================
Console Errors Captured: 0
Relevant Network Requests Dump: 26
  [PATCH] http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/seats -> Status 200
  [GET] http://127.0.0.1:8080/v1/organizations/00000000-0000-0000-0000-000000000aaa/billing -> Status 200

================================================================================
             ALL CONTROL PANEL BILLING BROWSER CHECKS PASSED                    
================================================================================
>>> RESULT: PASS (test_control_plane_billing.mjs) in 11.3s
```

## What did not work or is untested
- **External Payment Processors:** Explicitly not built, per roadmap specification. All pricing and seat adjustments operate purely in-engine without Stripe or external billing webhooks.
- **Invoice PDF Generation:** Explicitly excluded from task scope; local calculation and breakdown display only.

## Test suite output

### Control Panel Frontend Test Suite
Command:
```powershell
npm.cmd --prefix apps/control-plane test
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
  ✓ fetchOrgRecoveryPkHex parses base64 org recovery key to hex
  ✓ handles non-200 HTTP error responses
MAILBOXES API TESTS: 9 passed, 0 failed
```

### Admin API Test Suite
Command:
```powershell
go test -v ./...
```
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
PASS
ok  	admin-api	0.702s
=== RUN   TestAdminDomainQuotaEnforcement
--- PASS: TestAdminDomainQuotaEnforcement (0.07s)
=== RUN   TestAdminAdjustCapacityLimits
--- PASS: TestAdminAdjustCapacityLimits (0.02s)
=== RUN   TestAdminZeroKnowledgeIsolation
--- PASS: TestAdminZeroKnowledgeIsolation (0.01s)
=== RUN   TestUpdateSeatCountValid
--- PASS: TestUpdateSeatCountValid (0.02s)
=== RUN   TestUpdateSeatCountBelowMailboxes
--- PASS: TestUpdateSeatCountBelowMailboxes (0.11s)
=== RUN   TestUpdateSeatCountZero
--- PASS: TestUpdateSeatCountZero (0.00s)
=== RUN   TestCapacityCapsFromSeatCount
--- PASS: TestCapacityCapsFromSeatCount (0.00s)
=== RUN   TestCapacityCapsMinimums
--- PASS: TestCapacityCapsMinimums (0.00s)
=== RUN   TestPriceComputationMatches
--- PASS: TestPriceComputationMatches (0.00s)
PASS
ok  	admin-api/handlers	1.262s
```

### Core API Test Suite
Command:
```powershell
go test -count=1 ./...
```
Output:
```
ok  	byos.email/services/api	34.454s
```

### Full 16-Test End-to-End Smoke Suite
Command:
```powershell
powershell -ExecutionPolicy Bypass -File .\smoke.ps1
```
Output:
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (14.7s)
  [PASS] test_sidebar_restructure.mjs        PASS (13.9s)
  [PASS] test_unified_inbox_browser.mjs      PASS (25.9s)
  [PASS] test_account_switch_crypto.mjs      PASS (61.9s)
  [PASS] test_masked_email.mjs               PASS (44.4s)
  [PASS] test_alias_custom.mjs               PASS (38s)
  [PASS] test_compose_default_account.mjs    PASS (12.5s)
  [PASS] test_wire_integrity.mjs             PASS (75.5s)
  [PASS] test_focused_inbox.mjs              PASS (30.9s)
  [PASS] test_offline.mjs                    PASS (31.6s)
  [PASS] test_composer.mjs                   PASS (21.7s)
  [PASS] test_contacts.mjs                   PASS (14.3s)
  [PASS] test_import.mjs                     PASS (13.8s)
  [PASS] test_sent_folder_display.mjs        PASS (15.3s)
  [PASS] test_public_site.mjs                PASS (7.7s)
  [PASS] test_control_plane_billing.mjs      PASS (11.3s)
================================================================================

SMOKE SUITE PASSED: All 16 tests passed cleanly.
```
