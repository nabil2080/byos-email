# Support Platform Phase 01 Completion Report

## What was built
Phase 01 of the BYOS Customer Support Platform establishes a real, database-backed support ticket lifecycle connecting customer accounts in the Control Plane to internal support staff in the Support CRM. The platform introduces migration `064_support_ticketing_system.sql` with relational schemas for `support_agents`, `support_tickets`, and `support_ticket_messages` protected by least-privilege role permissions on `role_support_agent`. The backend provides customer endpoints in `services/api` (`/v1/support/tickets`) with strict customer isolation and redaction of internal notes, alongside staff administrative endpoints in `services/admin-api` (`/admin/v1/tickets`) featuring lifecycle updates, agent assignment, and atomic audit logging. The customer-facing Help Desk is implemented in `apps/control-plane` (`/dashboard/support`) with ticket creation, message threading, and customer replies, while `apps/support-crm` is transformed from static mocks into a live PostgreSQL-backed operations center with real ticket queue filtering, customer context cards, and staff internal notes.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/064_support_ticketing_system.sql` | Schema migration defining support_agents, support_tickets, support_ticket_messages with indexes and least-privilege role permissions. |
| `services/admin-api/main.go` | Registered real database-backed ticket routes replacing the mock tickets handler. |
| `services/admin-api/handlers/tickets.go` | Admin API handlers for listing, viewing, updating tickets, adding replies/notes, and support statistics. |
| `services/admin-api/handlers/tickets_test.go` | Comprehensive lifecycle integration tests for admin ticket management and audit logging. |
| `services/api/main.go` | Registered customer support ticket endpoints in standard API mux with security headers and CORS. |
| `services/api/support_tickets.go` | Customer API handlers for ticket creation, customer ticket listing, details, and customer replies. |
| `services/api/support_tickets_test.go` | Customer support ticket lifecycle tests validating ticket isolation and strict internal note redaction. |
| `apps/support-crm/src/lib/api.ts` | Added TypeScript interfaces and HTTP client methods for support tickets, agents, stats, and replies. |
| `apps/support-crm/src/App.tsx` | Replaced mock ticket data, removed fake YubiKey interaction and simulated ticker with live PostgreSQL ticket workspace. |
| `apps/control-plane/src/lib/api/support.ts` | API client module for customer support ticket operations in Control Plane. |
| `apps/control-plane/src/lib/api/support.test.ts` | Unit tests for customer support API client methods with mock fetch harness. |
| `apps/control-plane/src/run_test.node.js` | Registered support API client tests in the Control Plane test suite. |
| `apps/control-plane/src/routes/dashboard/support.tsx` | Customer Help Desk UI page with ticket creation modal, queue list, and conversational reply thread. |
| `apps/control-plane/src/App.tsx` | Registered `/dashboard/support` route in Control Plane router. |
| `apps/control-plane/src/components/layout/Sidebar.tsx` | Added Help & Support navigation item to dashboard sidebar and optimized email label truncation. |

## Raw evidence

### 1. Database Schema Migration Verification
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos_disposable_rehearsal -c "\d support_tickets"
```
Output:
```
                             Table "public.support_tickets"
      Column       |           Type           | Collation | Nullable |      Default      
-------------------+--------------------------+-----------+----------+-------------------
 id                | uuid                     |           | not null | gen_random_uuid()
 ticket_number     | text                     |           | not null | 
 customer_user_id  | uuid                     |           | not null | 
 org_id            | uuid                     |           |          | 
 subject           | text                     |           | not null | 
 product_area      | text                     |           | not null | 'other'::text
 category          | text                     |           | not null | 'general'::text
 priority          | text                     |           | not null | 'normal'::text
 status            | text                     |           | not null | 'new'::text
 assigned_agent_id | uuid                     |           |          | 
 first_response_at | timestamp with time zone |           |          | 
 resolved_at       | timestamp with time zone |           |          | 
 closed_at         | timestamp with time zone |           |          | 
 last_activity_at  | timestamp with time zone |           | not null | now()
 created_at        | timestamp with time zone |           | not null | now()
 updated_at        | timestamp with time zone |           | not null | now()
Indexes:
    "support_tickets_pkey" PRIMARY KEY, btree (id)
    "idx_support_tickets_assigned" btree (assigned_agent_id, status)
    "idx_support_tickets_customer" btree (customer_user_id, created_at DESC)
    "idx_support_tickets_org" btree (org_id, created_at DESC) WHERE org_id IS NOT NULL
    "idx_support_tickets_status" btree (status, priority, last_activity_at DESC)
    "support_tickets_ticket_number_key" UNIQUE CONSTRAINT, btree (ticket_number)
Check constraints:
    "support_tickets_priority_check" CHECK (priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))
    "support_tickets_product_area_check" CHECK (product_area = ANY (ARRAY['mail'::text, 'account'::text, 'security'::text, 'domains'::text, 'storage'::text, 'calendar'::text, 'org_mgmt'::text, 'billing'::text, 'bug_report'::text, 'feature_request'::text, 'other'::text]))
    "support_tickets_status_check" CHECK (status = ANY (ARRAY['new'::text, 'open'::text, 'pending_customer'::text, 'in_progress'::text, 'resolved'::text, 'closed'::text]))
Foreign-key constraints:
    "support_tickets_assigned_agent_id_fkey" FOREIGN KEY (assigned_agent_id) REFERENCES support_agents(id) ON DELETE SET NULL
    "support_tickets_customer_user_id_fkey" FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE RESTRICT
    "support_tickets_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL
Referenced by:
    TABLE "support_ticket_messages" CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
```

### 2. Active Database Untouched Safety Verification
Command:
```powershell
docker exec byos-postgres psql -U byos -d byos -c "SELECT count(*) FROM attachments; SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';"
```
Output:
```
 count 
-------
     4
(1 row)

 count 
-------
    48
(1 row)
```

### 3. Customer Support API Integration Tests
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -count=1 -v -run TestCustomerSupportTicketLifecycleIntegration ./services/api
```
Output:
```
=== RUN   TestCustomerSupportTicketLifecycleIntegration
--- PASS: TestCustomerSupportTicketLifecycleIntegration (0.20s)
PASS
ok  	byos.email/services/api	0.335s
```

### 4. Admin API Support Ticket Integration Tests
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -count=1 -v -run TestAdminTicketLifecycleIntegration ./services/admin-api/handlers
```
Output:
```
=== RUN   TestAdminTicketLifecycleIntegration
--- PASS: TestAdminTicketLifecycleIntegration (0.07s)
PASS
ok  	admin-api/handlers	0.215s
```

### 5. Control Plane Support API Client Unit Tests
Command:
```powershell
cmd /c "cd apps\control-plane && npm test"
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
```

### 6. Support CRM Frontend Build Verification
Command:
```powershell
cmd /c "cd apps\support-crm && npm run build"
```
Output:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 10 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  0.47 kB │ gzip:  0.30 kB
dist/assets/index-CSENueYR.css  37.55 kB │ gzip:  7.50 kB
dist/assets/index-DlazYrRK.js   93.38 kB │ gzip: 25.40 kB
✓ built in 681ms
```

### 7. Control Plane Frontend Build Verification
Command:
```powershell
cmd /c "cd apps\control-plane && npm run build"
```
Output:
```
> build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 129 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  0.77 kB │ gzip:   0.49 kB
dist/assets/byos_crypto_core_bg-CrfUa_x6.wasm  601.30 kB │ gzip: 223.35 kB
dist/assets/index-Cb_mQlpK.css                  64.58 kB │ gzip:  12.18 kB
dist/assets/byos_crypto_core-BBfV2F2e.js         9.94 kB │ gzip:   2.29 kB
dist/assets/index-B2vvle2h.js                  464.22 kB │ gzip: 120.54 kB
✓ built in 2.08s
```

## Manual browser verification
**UNTESTED**
Manual browser end-to-end verification steps required:
1. Start PostgreSQL backend container, API service on `:8080`, Admin API on `:8081`.
2. Start Control Plane frontend on `:3000` and Support CRM on `:3002`.
3. Log into Control Plane as `alice@byos.local`. Navigate to "Help & Support" (`/dashboard/support`).
4. Click "New Support Ticket", fill subject "DNS Propagation delay on custom domain", product area "Domains & DNS", priority "High", and description. Submit the ticket.
5. Confirm ticket appears in the "My Support Requests" table with status `NEW`.
6. Open Support CRM on `:3002`, select "Support Tickets" tab.
7. Verify the ticket appears in the queue with matching ticket number, customer email, and high priority badge.
8. Open the ticket workspace in CRM: verify customer account context card displays email, org plan, seats, and mailbox count.
9. Post an internal staff note ("Checked cloudflare nameservers, awaiting customer zone reload"). Verify note appears with an amber lock badge.
10. Return to Control Plane browser: refresh ticket view and verify the internal note is strictly absent (zero-knowledge redaction).
11. In CRM, post a public reply ("We noticed NS delegation is incomplete.").
12. Return to Control Plane: verify public reply appears with "Support Agent" badge.
13. Submit a customer reply ("Updated NS records, thanks!").
14. In CRM: verify ticket status automatically transitions to `in_progress` and the customer reply is visible.

## What did not work or is untested
- Outbound SMTP email notifications and inbound email ticket ingestion are planned for Phase 02 and are currently UNTESTED.
- End-to-end browser execution was not run headless in this container session and remains UNTESTED until local dev servers are booted.

## Test suite output
Command:
```powershell
$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -count=1 ./services/api -v -run TestCustomerSupportTicketLifecycleIntegration; go test -count=1 ./services/admin-api/handlers -v -run TestAdminTicketLifecycleIntegration; cmd /c "cd apps\control-plane && npm test"
```
Output:
```
=== RUN   TestCustomerSupportTicketLifecycleIntegration
--- PASS: TestCustomerSupportTicketLifecycleIntegration (0.20s)
PASS
ok  	byos.email/services/api	0.335s
=== RUN   TestAdminTicketLifecycleIntegration
--- PASS: TestAdminTicketLifecycleIntegration (0.07s)
PASS
ok  	admin-api/handlers	0.215s

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
```
