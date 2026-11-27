# Operator Retry Governance, Idempotency Isolation & Evidence Integrity Report (Release C6.5.3)

## What was built
Release C6.5.3 implements durable operator retry governance, cryptographic request-bound idempotency isolation, server-controlled evidence provenance, and authoritative bounce-resolution integrity across the BYOS Delivery Operations pipeline. Database Migration 073 introduces dedicated manual retry tracking (`manual_retry_count`, `max_manual_retries`) with a database check constraint capping manual retries at two per message, establishes a dedicated `delivery_operator_idempotency` reservation table with SHA-256 request fingerprinting, and enforces database check constraints ensuring evidence verification flags require independent provenance. The administrative API enforces role-based retry allowances (maximum 1 manual retry for standard support agents, maximum 2 for platform administrators), enforces an absolute 72-hour lifetime ceiling from queue item creation, and caps max attempt escalation at 8 while ensuring operator-authorized retries remain claimable by the outbound worker. Idempotency keys are cryptographically bound to actor identity, queue ID, action, and request payload parameters, rejecting cross-actor reuse (HTTP 403), cross-resource reuse (HTTP 409), cross-action reuse (HTTP 409), and payload parameter mismatch (HTTP 409). The API strips client authority over verification claims, strictly defaulting all operator actions to `operator_attested` with `is_independently_verified = false`, and prevents `resolve_bounced` from overwriting remote MTA durable acceptance or delivered records. The Support CRM interface was enhanced to reflect retry budget limits, display authoritative bounce evidence inputs, expose cryptographic request fingerprints, and render real idempotency conflict alerts.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/migrations/073_operator_retry_governance_and_idempotency.sql` | Adds manual retry tracking columns, bounds check constraint, request fingerprinting, provenance check constraint, and dedicated operator idempotency table |
| `services/admin-api/handlers/queue_operations.go` | Implements retry governance limits, request fingerprinting, idempotency reservation/isolation, client provenance stripping, and bounce-resolution integrity checks |
| `services/admin-api/handlers/queue_operations_test.go` | Adds unit and integration tests covering retry allowances, idempotency isolation, client provenance stripping, and bounce resolution boundaries |
| `apps/support-crm/src/lib/api.ts` | Aligns TypeScript interfaces with Migration 073 fields and strips client-controlled verification fields from reconcile request DTO |
| `apps/support-crm/src/components/queue/DeliveryOperationsConsole.tsx` | Updates UI to display manual retry allowances, disable retries on budget exhaustion, collect authoritative bounce proof, and render request fingerprints |
| `services/outbound-worker/src/main.rs` | Adds database-backed integration test verifying worker claimability and boundary adherence of operator-authorized retries |
| `tools/seed_c65_queue.sql` | Updates test fixture seed with exhausted retry budget item and cleanses idempotency ledger between runs |
| `tests/browser/delivery_operations_c653_governance_verification.mjs` | Implements automated browser and API verification script exercising all four C6.5.3 pillars against live services |

## Raw evidence

### 1. Database Schema Inspection: Migration 073 Applied
The schema of `outbound_queue`, `delivery_operator_idempotency`, and `outbound_delivery_operator_audit` was inspected:
```
$ docker exec byos-postgres psql -U byos -d byos_test_isolation -c "\d outbound_queue"
                                 Table "public.outbound_queue"
         Column          |           Type           | Collation | Nullable |      Default      
-------------------------+--------------------------+-----------+----------+-------------------
 id                      | uuid                     |           | not null | gen_random_uuid()
 delivery_id             | uuid                     |           | not null | 
 mailbox_id              | uuid                     |           | not null | 
 domain_id               | uuid                     |           | not null | 
 recipient               | text                     |           | not null | 
 encrypted_message       | bytea                    |           | not null | 
 send_token_hpke_wrapped | bytea                    |           | not null | 
 status                  | text                     |           | not null | 'pending'::text
 attempts                | integer                  |           | not null | 0
 max_attempts            | integer                  |           | not null | 5
 last_attempt_at         | timestamp with time zone |           |          | 
 next_attempt_at         | timestamp with time zone |           | not null | now()
 created_at              | timestamp with time zone |           | not null | now()
 delivered_at            | timestamp with time zone |           |          | 
 failed_at               | timestamp with time zone |           |          | 
 expires_at              | timestamp with time zone |           | not null | 
 outbox_seq              | bigint                   |           |          | 
 encryption_version      | integer                  |           |          | 1
 aad_version             | smallint                 |           |          | 1
 encryption_iv           | bytea                    |           |          | 
 reservation_id          | uuid                     |           |          | 
 lease_token             | uuid                     |           |          | 
 lease_owner             | text                     |           |          | 
 claimed_at              | timestamp with time zone |           |          | 
 lease_expires_at        | timestamp with time zone |           |          | 
 smtp_phase              | text                     |           |          | 
 last_smtp_code          | integer                  |           |          | 
 last_error              | text                     |           |          | 
 send_token_key_epoch    | integer                  |           |          | 1
 send_token_key_id       | text                     |           |          | 
 attachment_count        | integer                  |           | not null | 0
 reconciled_at           | timestamp with time zone |           |          | 
 reconciled_by           | text                     |           |          | 
 reconciliation_reason   | text                     |           |          | 
 manual_retry_count      | integer                  |           | not null | 0
 max_manual_retries      | integer                  |           | not null | 1
Indexes:
    "outbound_queue_pkey" PRIMARY KEY, btree (id)
    "idx_outbound_queue_claimable" btree (next_attempt_at) WHERE status = 'pending'::text
    "idx_outbound_queue_delivery" btree (delivery_id)
    "idx_outbound_queue_domain_status" btree (domain_id, status)
    "idx_outbound_queue_outbox_seq" btree (mailbox_id, outbox_seq)
    "idx_outbound_queue_outcome_unknown" btree (failed_at DESC) WHERE status = 'outcome_unknown'::text
    "idx_outbound_queue_pending_expiry" btree (expires_at) WHERE status = 'pending'::text
    "idx_outbound_queue_processing_lease" btree (lease_expires_at) WHERE status = 'processing'::text
    "idx_outbound_queue_reconciled" btree (reconciled_at DESC) WHERE reconciled_at IS NOT NULL
    "idx_outbound_queue_reservation" UNIQUE, btree (reservation_id)
    "idx_outbound_queue_status" btree (status, next_attempt_at)
    "idx_outbound_queue_status_created" btree (status, created_at DESC)
    "outbound_queue_delivery_id_key" UNIQUE CONSTRAINT, btree (delivery_id)
Check constraints:
    "chk_outbound_queue_attachment_count" CHECK (attachment_count >= 0 AND attachment_count <= 100)
    "chk_outbound_queue_manual_retry_bounds" CHECK (manual_retry_count >= 0 AND manual_retry_count <= max_manual_retries AND max_manual_retries <= 2)
    "outbound_queue_processing_lease_check" CHECK (status = 'processing'::text AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL OR status <> 'processing'::text AND lease_token IS NULL AND lease_expires_at IS NULL)
    "outbound_queue_smtp_phase_check" CHECK (smtp_phase IS NULL OR (smtp_phase = ANY (ARRAY['claimed'::text, 'pre_data'::text, 'data_streaming'::text, 'terminator_in_flight'::text, 'accepted_by_mta'::text])))
    "outbound_queue_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'accepted_by_mta'::text, 'delivered'::text, 'bounced'::text, 'expired'::text, 'outcome_unknown'::text]))
Foreign-key constraints:
    "outbound_queue_domain_id_fkey" FOREIGN KEY (domain_id) REFERENCES domains(id)
    "outbound_queue_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
    "outbound_queue_reservation_id_fkey" FOREIGN KEY (reservation_id) REFERENCES outbound_reservations(reservation_id)
Referenced by:
    TABLE "delivery_operator_idempotency" CONSTRAINT "delivery_operator_idempotency_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES outbound_queue(id) ON DELETE CASCADE
    TABLE "outbound_delivery_operator_audit" CONSTRAINT "outbound_delivery_operator_audit_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES outbound_queue(id) ON DELETE CASCADE
```

```
$ docker exec byos-postgres psql -U byos -d byos_test_isolation -c "\d delivery_operator_idempotency"
                                   Table "public.delivery_operator_idempotency"
       Column        |           Type           | Collation | Nullable |                 Default                  
---------------------+--------------------------+-----------+----------+------------------------------------------
 idempotency_key     | text                     |           | not null | 
 actor_id            | text                     |           | not null | 
 actor_email         | text                     |           | not null | 
 queue_id            | uuid                     |           | not null | 
 action              | text                     |           | not null | 
 request_fingerprint | text                     |           | not null | 
 status              | text                     |           | not null | 'in_progress'::text
 created_at          | timestamp with time zone |           | not null | clock_timestamp()
 expires_at          | timestamp with time zone |           | not null | clock_timestamp() + '24:00:00'::interval
 audit_id            | uuid                     |           |          | 
 response_payload    | jsonb                    |           |          | 
Indexes:
    "delivery_operator_idempotency_pkey" PRIMARY KEY, btree (idempotency_key)
    "idx_delivery_operator_idempotency_expires" btree (expires_at)
    "idx_delivery_operator_idempotency_queue" btree (queue_id, action)
Check constraints:
    "delivery_operator_idempotency_status_check" CHECK (status = ANY (ARRAY['in_progress'::text, 'completed'::text]))
Foreign-key constraints:
    "delivery_operator_idempotency_audit_id_fkey" FOREIGN KEY (audit_id) REFERENCES outbound_delivery_operator_audit(id)
    "delivery_operator_idempotency_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES outbound_queue(id) ON DELETE CASCADE
```

```
$ docker exec byos-postgres psql -U byos -d byos_test_isolation -c "\d outbound_delivery_operator_audit"
                             Table "public.outbound_delivery_operator_audit"
          Column           |           Type           | Collation | Nullable |          Default          
---------------------------+--------------------------+-----------+----------+---------------------------
 id                        | uuid                     |           | not null | gen_random_uuid()
 created_at                | timestamp with time zone |           | not null | clock_timestamp()
 actor_id                  | text                     |           | not null | 
 actor_email               | text                     |           | not null | 
 actor_role                | text                     |           | not null | 
 action                    | text                     |           | not null | 
 queue_id                  | uuid                     |           | not null | 
 delivery_id               | uuid                     |           | not null | 
 previous_status           | text                     |           | not null | 
 resulting_status          | text                     |           | not null | 
 resolution_category       | text                     |           |          | 
 operator_reason           | text                     |           | not null | 
 evidence_category         | text                     |           |          | 
 evidence_reference        | text                     |           |          | 
 ip_address                | text                     |           |          | 
 user_agent                | text                     |           |          | 
 evidence_provenance       | text                     |           | not null | 'operator_attested'::text
 is_independently_verified | boolean                  |           | not null | false
 idempotency_key           | text                     |           |          | 
 request_fingerprint       | text                     |           |          | 
Indexes:
    "outbound_delivery_operator_audit_pkey" PRIMARY KEY, btree (id)
    "idx_delivery_audit_created_at" btree (created_at DESC)
    "idx_delivery_audit_delivery_id" btree (delivery_id, created_at DESC)
    "idx_delivery_audit_idempotency" UNIQUE, btree (idempotency_key) WHERE idempotency_key IS NOT NULL
    "idx_delivery_audit_queue_id" btree (queue_id, created_at DESC)
Check constraints:
    "chk_audit_provenance_verification" CHECK (is_independently_verified = false OR evidence_provenance = 'independent_verified'::text)
    "chk_delivery_audit_action" CHECK (action = ANY (ARRAY['investigate'::text, 'add_note'::text, 'resolve_accepted'::text, 'authorize_retry'::text, 'resolve_bounced'::text]))
    "chk_delivery_audit_provenance" CHECK (evidence_provenance = ANY (ARRAY['operator_attested'::text, 'independent_verified'::text, 'insufficient'::text]))
Foreign-key constraints:
    "outbound_delivery_operator_audit_queue_id_fkey" FOREIGN KEY (queue_id) REFERENCES outbound_queue(id) ON DELETE CASCADE
Referenced by:
    TABLE "delivery_operator_idempotency" CONSTRAINT "delivery_operator_idempotency_audit_id_fkey" FOREIGN KEY (audit_id) REFERENCES outbound_delivery_operator_audit(id)
Triggers:
    trg_prevent_delivery_audit_modification BEFORE DELETE OR UPDATE ON outbound_delivery_operator_audit FOR EACH ROW EXECUTE FUNCTION prevent_delivery_audit_modification()
```

### 2. Bounded Manual Retry Governance: Allowance Exhaustion
Attempting an operator retry when the message's manual retry allowance has been consumed returns HTTP 409 Conflict:
```
$ curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer mock-support-agent" -H "Content-Type: application/json" -d "{\"action\":\"authorize_retry\",\"operator_reason\":\"exceeded allowance test\",\"evidence_category\":\"recipient_inbound_log\",\"evidence_reference\":\"LOG-999\",\"duplicate_risk_acknowledged\":true}" http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000008/reconcile
{"error":"manual retry limit reached: maximum 1 operator retry allowed per message"}
HTTP_STATUS:409
```

### 3. Bounce-Resolution Integrity: Authoritative Evidence Mandated
Attempting to mark a message bounced without evidence returns HTTP 400 Bad Request:
```
$ curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer mock-support-agent" -H "Content-Type: application/json" -d "{\"action\":\"resolve_bounced\",\"operator_reason\":\"missing evidence test\"}" http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile
{"error":"resolve_bounced requires authoritative bounce evidence_category (e.g. smtp_5xx_rejection, dsn_bounce_report) and evidence_reference; insufficient evidence cannot authorize bounce resolution"}
HTTP_STATUS:400
```

### 4. Bounce-Resolution Integrity: Durable Remote Acceptance Overwrite Blocked
Calling `resolve_bounced` on a message with `smtp_phase = 'accepted_by_mta'` returns HTTP 409 Conflict:
```
$ curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer mock-support-agent" -H "Content-Type: application/json" -d "{\"action\":\"resolve_bounced\",\"operator_reason\":\"overwrite attempt\",\"evidence_category\":\"smtp_5xx_rejection\",\"evidence_reference\":\"550 User Unknown\"}" http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000007/reconcile
{"error":"cannot resolve as bounced: remote MTA has already durably accepted this message; cannot overwrite accepted/delivered state with bounce"}
HTTP_STATUS:409
```

### 5. Server-Controlled Evidence Provenance: Client Claims Rejected
Sending client-supplied verification metadata triggers immediate rejection with HTTP 400 Bad Request:
```
$ curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer mock-support-agent" -H "Content-Type: application/json" -d "{\"action\":\"add_note\",\"operator_reason\":\"Tampered provenance test\",\"evidence_provenance\":\"independent_verified\"}" http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile
{"error":"unsupported client field: evidence_provenance is server-controlled and cannot be set by clients"}
HTTP_STATUS:400
```

```
$ curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer mock-support-agent" -H "Content-Type: application/json" -d "{\"action\":\"add_note\",\"operator_reason\":\"Tampered is_independently_verified test\",\"is_independently_verified\":true}" http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile
{"error":"unsupported client field: is_independently_verified is server-controlled and cannot be set by clients"}
HTTP_STATUS:400
```

### 6. Request-Bound Idempotency Isolation: Fingerprint & Actor Fencing
Executing duplicate request with mismatched parameters on same idempotency key returns HTTP 409 Conflict:
```
$ curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer mock-support-agent" -H "Content-Type: application/json" -d "{\"action\":\"add_note\",\"operator_reason\":\"Tampered reason\",\"idempotency_key\":\"c653-iso-1732432543000\"}" http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile
{"error":"idempotency key conflict: key reused with different request payload parameters"}
HTTP_STATUS:409
```

Cross-actor reuse of an idempotency key returns HTTP 403 Forbidden:
```
$ curl.exe -s -w "\nHTTP_STATUS:%{http_code}\n" -H "Authorization: Bearer mock-admin" -H "Content-Type: application/json" -d "{\"action\":\"add_note\",\"operator_reason\":\"Original reason\",\"idempotency_key\":\"c653-iso-1732432543000\"}" http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile
{"error":"idempotency key conflict: key was issued to a different authenticated operator"}
HTTP_STATUS:403
```

## Manual browser verification
The automated Puppeteer test suite `tests/browser/delivery_operations_c653_governance_verification.mjs` was executed against live instances of `admin-api` (port 8087) and `support-crm` (port 3003) backed by the isolated test database `byos_test_isolation`.

Terminal output of the browser verification suite:
```
$ node.exe tests/browser/delivery_operations_c653_governance_verification.mjs
========================================================================
--- Starting BYOS Release C6.5.3 Governance & Integrity Verification ---
========================================================================

[Pillar 1] Testing Bounded Manual Retry Governance...
  PASS: Exhausted retry rejected with HTTP 409 (expected 409)
  PASS: Rejection cited retry allowance: manual retry limit reached: maximum 1 operator retry allowed per message

[Pillar 2] Testing Bounce-Resolution Integrity & Acceptance Blocking...
  PASS: resolve_bounced without evidence rejected with HTTP 400 (expected 400)
  PASS: Rejection error correctly states: resolve_bounced requires authoritative bounce evidence_category (e.g. smtp_5xx_rejection, dsn_bounce_report) and evidence_reference; insufficient evidence cannot authorize bounce resolution
  PASS: resolve_bounced on accepted_by_mta rejected with HTTP 409 (expected 409)
  PASS: Rejection cited durable remote MTA acceptance: cannot resolve as bounced: remote MTA has already durably accepted this message; cannot overwrite accepted/delivered state with bounce

[Pillar 3] Testing Request-Bound Idempotency Isolation...
  PASS: Initial mutation succeeded with HTTP 200
  PASS: Initial execution was not a replay
  PASS: Identical replay succeeded with HTTP 200
  PASS: Replay returned idempotent_replay: true
  PASS: Replay returned matching audit_id
  PASS: Payload parameter mismatch rejected with HTTP 409 (expected 409)
  PASS: Rejection cited fingerprint mismatch: idempotency key conflict: key reused with different request payload parameters
  PASS: Action mismatch rejected with HTTP 409 (expected 409)
  PASS: Rejection cited action mismatch: idempotency key conflict: key was used for a different reconciliation action
  PASS: Cross-resource key reuse rejected with HTTP 409 (expected 409)
  PASS: Rejection cited resource mismatch: idempotency key conflict: key was used for a different queue message
  PASS: Cross-actor key reuse rejected with HTTP 403 (expected 403)
  PASS: Rejection cited actor mismatch: idempotency key conflict: key was issued to a different authenticated operator

[Pillar 4] Testing Server-Controlled Evidence Provenance...
  PASS: Client-supplied evidence_provenance rejected with HTTP 400 (expected 400)
  PASS: Rejection cited forbidden client verification metadata: unsupported client field: evidence_provenance is server-controlled and cannot be set by clients
  PASS: Client-supplied is_independently_verified rejected with HTTP 400 (expected 400)

[Browser UI] Launching Puppeteer browser verification in Support CRM...
Navigating to Delivery Queue Console...

[UI Check 1] Verifying Bounded Manual Retry Governance in UI...
  PASS: Opened detail modal for grace.exhausted@retrylimit.com (exhausted retry budget)
  PASS: Exhausted retry banner rendered
  PASS: Banner explains bounded retry governance and budget consumption
  PASS: Authorize Retry action button is strictly disabled when budget is exhausted
Saved tests/browser/artifacts/c653_retry_governance_exhausted.png

[UI Check 2] Verifying Bounce-Resolution Integrity with Evidence in UI...
  PASS: Opened detail modal for eve.reconcile@secure.io
Saved tests/browser/artifacts/c653_bounce_resolution_evidence.png
  PASS: Audit trail records action "resolve_bounced"
  PASS: Audit displays server-enforced operator-attested provenance
  PASS: Audit displays request_fingerprint
Saved tests/browser/artifacts/c653_audit_trail_evidence_integrity.png

[UI Check 3] Verifying Idempotency Conflict Banner in UI...
  PASS: Opened detail modal for dave.investigation@target.net
  PASS: Real UI rendered idempotency conflict error banner
  PASS: Conflict error banner cited payload mismatch
Saved tests/browser/artifacts/c653_idempotency_isolation_conflict.png

========================================================================
--- ALL C6.5.3 GOVERNANCE & INTEGRITY VERIFICATION CHECKS PASSED ---
========================================================================
```

Verification artifacts captured and saved to repository:
- Exhausted retry budget warning & disabled button: [c653_retry_governance_exhausted.png](file:///f:/Codex/byos-email/tests/browser/artifacts/c653_retry_governance_exhausted.png)
- Authoritative bounce reconciliation form: [c653_bounce_resolution_evidence.png](file:///f:/Codex/byos-email/tests/browser/artifacts/c653_bounce_resolution_evidence.png)
- Audit trail evidence integrity & request fingerprint badge: [c653_audit_trail_evidence_integrity.png](file:///f:/Codex/byos-email/tests/browser/artifacts/c653_audit_trail_evidence_integrity.png)
- Real UI idempotency conflict banner: [c653_idempotency_isolation_conflict.png](file:///f:/Codex/byos-email/tests/browser/artifacts/c653_idempotency_isolation_conflict.png)

## What did not work or is untested
- **Production Key Vault Rotation for Manual Retries**: Key unwrapping during manual retry uses active send-token keys; historical key rotation older than 72 hours requires operator ticket escalation and was **UNTESTED** against rotated multi-epoch test fixtures.
- **Physical Multi-Node In-Progress Race Verification**: Race condition handling between concurrent operators attempting simultaneous reservations with identical idempotency keys within sub-millisecond windows was tested via unit transaction concurrency tests; hardware multi-node cluster verification across distinct physical availability zones was **UNTESTED** and requires multi-node deployment.

## Test suite output

### Admin API Handlers Test Suite Output
```
$ go test -v -count=1 ./services/admin-api/handlers -run "TestQueueOperations"
=== RUN   TestQueueOperations_InputValidation
=== RUN   TestQueueOperations_InputValidation/Invalid_Action
=== RUN   TestQueueOperations_InputValidation/Missing_Operator_Reason
=== RUN   TestQueueOperations_InputValidation/resolve_accepted_Missing_Evidence_Category
=== RUN   TestQueueOperations_InputValidation/authorize_retry_Missing_Duplicate_Risk_Acknowledgment
=== RUN   TestQueueOperations_InputValidation/Invalid_UUID_in_Path
--- PASS: TestQueueOperations_InputValidation (0.00s)
    --- PASS: TestQueueOperations_InputValidation/Invalid_Action (0.00s)
    --- PASS: TestQueueOperations_InputValidation/Missing_Operator_Reason (0.00s)
    --- PASS: TestQueueOperations_InputValidation/resolve_accepted_Missing_Evidence_Category (0.00s)
    --- PASS: TestQueueOperations_InputValidation/authorize_retry_Missing_Duplicate_Risk_Acknowledgment (0.00s)
    --- PASS: TestQueueOperations_InputValidation/Invalid_UUID_in_Path (0.00s)
=== RUN   TestQueueOperations_OverviewMetrics
--- PASS: TestQueueOperations_OverviewMetrics (0.36s)
=== RUN   TestQueueOperations_ListAndZeroKnowledge
--- PASS: TestQueueOperations_ListAndZeroKnowledge (0.25s)
=== RUN   TestQueueOperations_DetailAndHistory
--- PASS: TestQueueOperations_DetailAndHistory (0.26s)
=== RUN   TestQueueOperations_ReconcileResolveAccepted
--- PASS: TestQueueOperations_ReconcileResolveAccepted (0.26s)
=== RUN   TestQueueOperations_ReconcileAuthorizeRetry
--- PASS: TestQueueOperations_ReconcileAuthorizeRetry (0.28s)
=== RUN   TestQueueOperations_ReconcileAddNote
--- PASS: TestQueueOperations_ReconcileAddNote (0.27s)
=== RUN   TestQueueOperations_ReconcileFencingConflicts
--- PASS: TestQueueOperations_ReconcileFencingConflicts (0.24s)
=== RUN   TestQueueOperations_AlertsDetection
--- PASS: TestQueueOperations_AlertsDetection (0.29s)
=== RUN   TestQueueOperations_PrometheusMetrics
--- PASS: TestQueueOperations_PrometheusMetrics (0.39s)
=== RUN   TestQueueOperations_AuditLedgerImmutability
--- PASS: TestQueueOperations_AuditLedgerImmutability (0.40s)
=== RUN   TestQueueOperations_AuthorizationRBAC
=== RUN   TestQueueOperations_AuthorizationRBAC/Unauthenticated_Request_Blocked
=== RUN   TestQueueOperations_AuthorizationRBAC/Ordinary_User_Role_Blocked
=== RUN   TestQueueOperations_AuthorizationRBAC/Org_Admin_Role_Blocked
=== RUN   TestQueueOperations_AuthorizationRBAC/Read-Only_Operator_Read_Allowed,_Mutation_Blocked
=== RUN   TestQueueOperations_AuthorizationRBAC/Header_Spoofing_Attack_Defeated
=== RUN   TestQueueOperations_AuthorizationRBAC/Support_Agent_and_Platform_Admin_Allowed
--- PASS: TestQueueOperations_AuthorizationRBAC (0.31s)
    --- PASS: TestQueueOperations_AuthorizationRBAC/Unauthenticated_Request_Blocked (0.00s)
    --- PASS: TestQueueOperations_AuthorizationRBAC/Ordinary_User_Role_Blocked (0.00s)
    --- PASS: TestQueueOperations_AuthorizationRBAC/Org_Admin_Role_Blocked (0.00s)
    --- PASS: TestQueueOperations_AuthorizationRBAC/Read-Only_Operator_Read_Allowed,_Mutation_Blocked (0.02s)
    --- PASS: TestQueueOperations_AuthorizationRBAC/Header_Spoofing_Attack_Defeated (0.00s)
    --- PASS: TestQueueOperations_AuthorizationRBAC/Support_Agent_and_Platform_Admin_Allowed (0.03s)
=== RUN   TestQueueOperations_LeaseSafetyAndFencing
=== RUN   TestQueueOperations_LeaseSafetyAndFencing/Scenario_A:_Active_Worker_Lease_Rejected
=== RUN   TestQueueOperations_LeaseSafetyAndFencing/Scenario_B:_Quarantined_Unknown_Outcome_Reconciled
=== RUN   TestQueueOperations_LeaseSafetyAndFencing/Scenario_C/D:_Concurrent_Worker_Claim_/_Non-Unknown_Status
=== RUN   TestQueueOperations_LeaseSafetyAndFencing/Scenario_E:_Concurrent_Operator_Reconciliation_Race
--- PASS: TestQueueOperations_LeaseSafetyAndFencing (0.33s)
    --- PASS: TestQueueOperations_LeaseSafetyAndFencing/Scenario_A:_Active_Worker_Lease_Rejected (0.02s)
    --- PASS: TestQueueOperations_LeaseSafetyAndFencing/Scenario_B:_Quarantined_Unknown_Outcome_Reconciled (0.04s)
    --- PASS: TestQueueOperations_LeaseSafetyAndFencing/Scenario_C/D:_Concurrent_Worker_Claim_/_Non-Unknown_Status (0.01s)
    --- PASS: TestQueueOperations_LeaseSafetyAndFencing/Scenario_E:_Concurrent_Operator_Reconciliation_Race (0.01s)
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Authorize_Retry_Claimability_Enhancements
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Retransmission_Blocked_When_Remote_MTA_Already_Accepted
=== RUN   TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Retransmission_Blocked_When_delivery_log_Already_Has_Delivered
--- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary (0.32s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Authorize_Retry_Claimability_Enhancements (0.06s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Retransmission_Blocked_When_Remote_MTA_Already_Accepted (0.01s)
    --- PASS: TestQueueOperations_RetryClaimabilityAndAcceptanceBoundary/Retransmission_Blocked_When_delivery_log_Already_Has_Delivered (0.02s)
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency/Evidence_Provenance_Default_and_Verification_Flag
=== RUN   TestQueueOperations_EvidenceProvenanceAndIdempotency/Idempotency_Replay_on_Duplicate_Request
--- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency (0.42s)
    --- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency/Evidence_Provenance_Default_and_Verification_Flag (0.05s)
    --- PASS: TestQueueOperations_EvidenceProvenanceAndIdempotency/Idempotency_Replay_on_Duplicate_Request (0.09s)
=== RUN   TestQueueOperations_C653_ManualRetryGovernance
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/First_Manual_Retry_Accepted
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/Second_Manual_Retry_Rejected_Under_Default_Policy
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/Platform_Admin_Exceptional_2nd_Retry_and_Absolute_Ceiling
=== RUN   TestQueueOperations_C653_ManualRetryGovernance/Absolute_72-Hour_Lifetime_Ceiling_Rejection
--- PASS: TestQueueOperations_C653_ManualRetryGovernance (0.41s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/First_Manual_Retry_Accepted (0.06s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/Second_Manual_Retry_Rejected_Under_Default_Policy (0.01s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/Platform_Admin_Exceptional_2nd_Retry_and_Absolute_Ceiling (0.04s)
    --- PASS: TestQueueOperations_C653_ManualRetryGovernance/Absolute_72-Hour_Lifetime_Ceiling_Rejection (0.01s)
=== RUN   TestQueueOperations_C653_RequestIdempotencyIsolation
--- PASS: TestQueueOperations_C653_RequestIdempotencyIsolation (0.32s)
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_evidence_provenance_Rejected
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_is_independently_verified_Rejected
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/resolve_accepted_with_Insufficient_Evidence_Rejected
=== RUN   TestQueueOperations_C653_ServerControlledEvidenceProvenance/Normal_Operator-Attested_Evidence_Records_Correct_Provenance
--- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance (0.28s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_evidence_provenance_Rejected (0.00s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/Client_Submitting_is_independently_verified_Rejected (0.00s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/resolve_accepted_with_Insufficient_Evidence_Rejected (0.00s)
    --- PASS: TestQueueOperations_C653_ServerControlledEvidenceProvenance/Normal_Operator-Attested_Evidence_Records_Correct_Provenance (0.03s)
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity/Missing_Evidence_on_resolve_bounced_Rejected
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity/Overwriting_Durable_MTA_Acceptance_with_Bounce_Blocked
=== RUN   TestQueueOperations_C653_BounceResolutionIntegrity/Valid_Authoritative_Bounce_Evidence_Successfully_Resolves
--- PASS: TestQueueOperations_C653_BounceResolutionIntegrity (0.29s)
    --- PASS: TestQueueOperations_C653_BounceResolutionIntegrity/Missing_Evidence_on_resolve_bounced_Rejected (0.01s)
    --- PASS: TestQueueOperations_C653_BounceResolutionIntegrity/Overwriting_Durable_MTA_Acceptance_with_Bounce_Blocked (0.02s)
    --- PASS: TestQueueOperations_C653_BounceResolutionIntegrity/Valid_Authoritative_Bounce_Evidence_Successfully_Resolves (0.04s)
PASS
ok  	admin-api/handlers	5.951s
```

### Migration Bootstrap Test Output
```
$ go test -v -count=1 ./tools/byos-migrate -run "TestPhase4_FreshDatabaseBootstrap"
=== RUN   TestPhase4_FreshDatabaseBootstrap
2026/11/24 12:16:45 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7037
2026/11/24 12:16:45 [BASELINE] Database is empty (0 user tables). Proceeding with fresh migration sequence.
2026/11/24 12:16:45 Found 72 pending migration(s) to apply.
2026/11/24 12:16:45 Applying migration 001 (001_init.sql)...
2026/11/24 12:16:45 [APPLIED] 001 (001_init.sql) in 576ms
...
2026/11/24 12:16:48 Applying migration 073 (073_operator_retry_governance_and_idempotency.sql)...
2026/11/24 12:16:48 [APPLIED] 073 (073_operator_retry_governance_and_idempotency.sql) in 50ms
2026/11/24 12:16:48 Successfully applied 72 migration(s). Database schema is now fully upgraded.
2026/11/24 12:16:48 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7037
2026/11/24 12:16:49 [LOCK] Acquired session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7046
2026/11/24 12:16:49 Database schema is up to date (version 073). No pending migrations.
2026/11/24 12:16:49 [LOCK] Released session-level advisory lock (lock ID: 4780962453531182930) on backend PID 7046
--- PASS: TestPhase4_FreshDatabaseBootstrap (4.25s)
PASS
ok  	byos-migrate	4.523s
```

### Outbound Worker Integration Test Output
```
$ docker run --rm -v "${PWD}:/app" -w /app/services/outbound-worker -e OUTBOUND_TEST_PG_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation?sslmode=disable" --network host rustlang/rust:nightly-slim cargo test test_pg_c653_bounded_manual_retry_and_worker_claim -- --nocapture
     Running unittests src/main.rs (target/debug/build/byos-outbound-worker/4447ec4a37598133/out/byos_outbound_worker-4447ec4a37598133)

running 1 test
test pg_tests::test_pg_c653_bounded_manual_retry_and_worker_claim ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 85 filtered out; finished in 4.49s
```

### Support CRM Frontend Production Build Output
```
$ npm.cmd --prefix apps/support-crm run build

> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 9 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.47 kB │ gzip:  0.30 kB
dist/assets/index-B-nCBKWg.css   45.60 kB │ gzip:  8.73 kB
dist/assets/index-B30AHLx_.js   121.09 kB │ gzip: 31.18 kB
✓ built in 1.94s
```
