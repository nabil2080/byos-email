-- BYOS Release C6.7: Comprehensive Security Boundary & Privilege-Bypass Audit
-- Tests privilege enforcement, trigger-bypass resistance, SECURITY DEFINER safety,
-- and least-privilege role boundaries on outbound_queue.

\set ON_ERROR_STOP off

-- Section 1: Check Views and Rules on outbound_queue
SELECT '=== SECTION 1: VIEWS AND RULES AUDIT ===' AS test_section;
SELECT schemaname, viewname, viewowner, definition 
FROM pg_views 
WHERE definition ILIKE '%outbound_queue%';

SELECT tablename, rulename, definition 
FROM pg_rules 
WHERE tablename = 'outbound_queue';

-- Section 2: Security Definer Functions Audit
SELECT '=== SECTION 2: SECURITY DEFINER FUNCTIONS AUDIT ===' AS test_section;
SELECT n.nspname, p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl 
FROM pg_proc p 
JOIN pg_namespace n ON p.pronamespace = n.oid 
WHERE p.prosecdef = true;

-- Section 3: Seed Test Rows in outbound_queue as superuser
SELECT '=== SEEDING TEST ROWS ===' AS test_section;
RESET ROLE;

-- Ensure prerequisite org, domain, user, and mailbox exist for foreign keys
INSERT INTO organizations (id, name, org_recovery_pk) 
VALUES ('f6700000-0000-0000-0000-0000000000a1', 'Security Audit Org', '\x01'::bytea) 
ON CONFLICT (id) DO NOTHING;

INSERT INTO domains (id, org_id, name) 
VALUES ('f6700000-0000-0000-0000-0000000000a2', 'f6700000-0000-0000-0000-0000000000a1', 'security-audit.local') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, org_id, email, password_hash, role) 
VALUES ('f6700000-0000-0000-0000-0000000000a3', 'f6700000-0000-0000-0000-0000000000a1', 'audit-user@security-audit.local', 'hash', 'admin') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO mailboxes (id, user_id, org_id, domain_id, local_part) 
VALUES ('f6700000-0000-0000-0000-0000000000a4', 'f6700000-0000-0000-0000-0000000000a3', 'f6700000-0000-0000-0000-0000000000a1', 'f6700000-0000-0000-0000-0000000000a2', 'audit-user') 
ON CONFLICT (id) DO NOTHING;

DELETE FROM outbound_queue WHERE id IN (
    'f6700000-0000-0000-0000-000000000001',
    'f6700000-0000-0000-0000-000000000002',
    'f6700000-0000-0000-0000-000000000003',
    'f6700000-0000-0000-0000-000000000004'
);

-- Seed row 1: outcome_unknown with cleared lease
INSERT INTO outbound_queue (
    id, mailbox_id, delivery_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped,
    status, attempts, max_attempts, next_attempt_at, expires_at,
    lease_token, lease_owner, lease_expires_at, claimed_at,
    smtp_phase, last_error, last_smtp_code,
    created_at, manual_retry_count, max_manual_retries
) VALUES (
    'f6700000-0000-0000-0000-000000000001',
    'f6700000-0000-0000-0000-0000000000a4',
    'f6700000-0000-0000-0000-000000000101',
    'f6700000-0000-0000-0000-0000000000a2',
    'test1@example.com',
    '\xdeadbeef', '\xfeedcafe',
    'outcome_unknown', 2, 5, now() - interval '10 minutes', now() + interval '1 day',
    NULL, NULL, NULL, NULL,
    NULL, 'Connection reset by peer', 421,
    now() - interval '1 hour', 0, 1
);

-- Seed row 2: processing with ACTIVE worker lease
INSERT INTO outbound_queue (
    id, mailbox_id, delivery_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped,
    status, attempts, max_attempts, next_attempt_at, expires_at,
    lease_token, lease_owner, lease_expires_at, claimed_at,
    smtp_phase, last_error, last_smtp_code,
    created_at, manual_retry_count, max_manual_retries
) VALUES (
    'f6700000-0000-0000-0000-000000000002',
    'f6700000-0000-0000-0000-0000000000a4',
    'f6700000-0000-0000-0000-000000000102',
    'f6700000-0000-0000-0000-0000000000a2',
    'test2@example.com',
    '\xdeadbeef', '\xfeedcafe',
    'processing', 1, 5, now() + interval '10 minutes', now() + interval '1 day',
    gen_random_uuid(), 'worker-node-2', now() + interval '5 minutes', now(),
    'terminator_in_flight', 'Timeout waiting for 250 OK', 451,
    now() - interval '30 minutes', 0, 1
);

-- Seed row 3: pending message (worker-claimable)
INSERT INTO outbound_queue (
    id, mailbox_id, delivery_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped,
    status, attempts, max_attempts, next_attempt_at, expires_at,
    lease_token, lease_owner, lease_expires_at, claimed_at,
    smtp_phase, last_error, last_smtp_code,
    created_at, manual_retry_count, max_manual_retries
) VALUES (
    'f6700000-0000-0000-0000-000000000003',
    'f6700000-0000-0000-0000-0000000000a4',
    'f6700000-0000-0000-0000-000000000103',
    'f6700000-0000-0000-0000-0000000000a2',
    'test3@example.com',
    '\xdeadbeef', '\xfeedcafe',
    'pending', 0, 5, now() - interval '1 minute', now() + interval '1 day',
    NULL, NULL, NULL, NULL,
    NULL, NULL, NULL,
    now() - interval '10 minutes', 0, 1
);

-- Seed row 4: delivered message
INSERT INTO outbound_queue (
    id, mailbox_id, delivery_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped,
    status, attempts, max_attempts, next_attempt_at, expires_at,
    lease_token, lease_owner, lease_expires_at, claimed_at,
    smtp_phase, last_error, last_smtp_code,
    created_at, manual_retry_count, max_manual_retries
) VALUES (
    'f6700000-0000-0000-0000-000000000004',
    'f6700000-0000-0000-0000-0000000000a4',
    'f6700000-0000-0000-0000-000000000104',
    'f6700000-0000-0000-0000-0000000000a2',
    'test4@example.com',
    '\xdeadbeef', '\xfeedcafe',
    'delivered', 1, 5, now() - interval '10 minutes', now() + interval '1 day',
    NULL, NULL, NULL, NULL,
    NULL, NULL, 250,
    now() - interval '1 hour', 0, 1
);

-- Section 4: Trigger Bypass Resistance Tests as role_support_agent
SELECT '=== SECTION 4: TRIGGER BYPASS ATTEMPTS BY role_support_agent ===' AS test_section;
SET ROLE role_support_agent;
SELECT current_user AS active_role;

-- 4.1: Attempt to disable the boundary trigger
ALTER TABLE outbound_queue DISABLE TRIGGER trg_enforce_support_agent_outbound_queue_boundaries;

-- 4.2: Attempt to drop the boundary trigger
DROP TRIGGER trg_enforce_support_agent_outbound_queue_boundaries ON outbound_queue;

-- 4.3: Attempt to alter table owner
ALTER TABLE outbound_queue OWNER TO role_support_agent;

-- 4.4: Attempt to set session_replication_role to replica (bypass triggers)
SET session_replication_role = replica;

-- 4.5: Attempt to redefine or drop the trigger function
CREATE OR REPLACE FUNCTION enforce_support_agent_outbound_queue_boundaries() RETURNS trigger AS $$
BEGIN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION enforce_support_agent_outbound_queue_boundaries();

-- Section 5: Boundary Violation Tests as role_support_agent
SELECT '=== SECTION 5: BOUNDARY VIOLATION TESTS BY role_support_agent ===' AS test_section;

-- 5.1: Attempt to modify a non-outcome_unknown record (pending record 3)
UPDATE outbound_queue
SET status = 'delivered'
WHERE id = 'f6700000-0000-0000-0000-000000000003';

-- 5.2: Attempt to transition outcome_unknown (row 1) to worker-exclusive 'processing' status
UPDATE outbound_queue
SET status = 'processing'
WHERE id = 'f6700000-0000-0000-0000-000000000001';

-- 5.3: Attempt to acquire or set non-NULL lease_token on outcome_unknown (row 1)
UPDATE outbound_queue
SET lease_token = gen_random_uuid()
WHERE id = 'f6700000-0000-0000-0000-000000000001';

-- 5.4: Attempt to set or advance smtp_phase on outcome_unknown (row 1)
UPDATE outbound_queue
SET smtp_phase = 'data_streaming'
WHERE id = 'f6700000-0000-0000-0000-000000000001';

-- 5.5: Attempt to override an ACTIVE worker lease (row 2: currently in 'processing' with active lease)
UPDATE outbound_queue
SET status = 'pending',
    lease_token = NULL,
    lease_expires_at = NULL,
    claimed_at = NULL,
    next_attempt_at = now(),
    manual_retry_count = manual_retry_count + 1,
    reconciled_at = clock_timestamp(),
    reconciled_by = 'rogue-operator@byos.local',
    reconciliation_reason = 'Attempting to override active worker'
WHERE id = 'f6700000-0000-0000-0000-000000000002';

-- Section 6: Legitimate Reconciliation by role_support_agent
SELECT '=== SECTION 6: LEGITIMATE OPERATOR RECONCILIATION ===' AS test_section;

-- 6.1: Legitimate retry reconciliation on row 1 (outcome_unknown with expired/cleared lease)
UPDATE outbound_queue
SET status = 'pending',
    lease_token = NULL,
    lease_expires_at = NULL,
    claimed_at = NULL,
    smtp_phase = NULL,
    next_attempt_at = clock_timestamp(),
    manual_retry_count = manual_retry_count + 1,
    reconciled_at = clock_timestamp(),
    reconciled_by = 'support-lead@byos.local',
    reconciliation_reason = 'Authorized manual retry after peer reset'
WHERE id = 'f6700000-0000-0000-0000-000000000001'
RETURNING id, status, manual_retry_count, next_attempt_at, reconciled_by, reconciliation_reason;

-- Section 7: Outbound Worker Role Privilege Tests
SELECT '=== SECTION 7: OUTBOUND WORKER PRIVILEGES ===' AS test_section;
SET ROLE outbound_worker_login;
SELECT current_user AS active_role;

-- 7.1: Attempt schema alteration by outbound worker (must fail: not owner)
ALTER TABLE outbound_queue DROP COLUMN status;
DROP TRIGGER trg_enforce_support_agent_outbound_queue_boundaries ON outbound_queue;

-- 7.2: Outbound worker claims pending message (row 3) atomically
UPDATE outbound_queue
SET status = 'processing',
    lease_token = gen_random_uuid(),
    lease_owner = 'worker-node-c67',
    lease_expires_at = clock_timestamp() + interval '5 minutes',
    claimed_at = clock_timestamp(),
    attempts = attempts + 1
WHERE id = 'f6700000-0000-0000-0000-000000000003'
RETURNING id, status, lease_owner, attempts;

-- 7.3: Outbound worker updates smtp_phase during delivery
UPDATE outbound_queue
SET smtp_phase = 'pre_data'
WHERE id = 'f6700000-0000-0000-0000-000000000003'
RETURNING id, status, smtp_phase;

-- 7.4: Outbound worker marks completed upon final 250 OK
UPDATE outbound_queue
SET status = 'delivered',
    delivered_at = clock_timestamp(),
    smtp_phase = NULL,
    last_smtp_code = 250,
    lease_token = NULL,
    lease_owner = NULL,
    lease_expires_at = NULL,
    claimed_at = NULL
WHERE id = 'f6700000-0000-0000-0000-000000000003'
RETURNING id, status, delivered_at, last_smtp_code;

-- Clean up
RESET ROLE;
DELETE FROM outbound_queue WHERE id IN (
    'f6700000-0000-0000-0000-000000000001',
    'f6700000-0000-0000-0000-000000000002',
    'f6700000-0000-0000-0000-000000000003',
    'f6700000-0000-0000-0000-000000000004'
);
SELECT '=== AUDIT COMPLETE ===' AS test_section;
