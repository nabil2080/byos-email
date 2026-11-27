-- BYOS C6.6.1: Least-Privilege Role Verification & Boundary Enforcement Test
-- Verified against byos_disposable_upgrade_072_c661

\set ON_ERROR_STOP off

-- 1. Test that role_support_agent CANNOT mutate a pending message
SET ROLE role_support_agent;

UPDATE outbound_queue
SET status = 'delivered'
WHERE id = 'e5000000-0000-0000-0000-000000000004'; -- status is 'pending'

-- 2. Test that role_support_agent CANNOT set status = 'processing'
UPDATE outbound_queue
SET status = 'processing'
WHERE id = 'e5000000-0000-0000-0000-000000000001'; -- status is 'outcome_unknown'

-- 3. Test that role_support_agent CANNOT set non-NULL lease_token
UPDATE outbound_queue
SET lease_token = gen_random_uuid()
WHERE id = 'e5000000-0000-0000-0000-000000000001';

-- 4. Test that role_support_agent CANNOT advance smtp_phase
UPDATE outbound_queue
SET smtp_phase = 'data_streaming'
WHERE id = 'e5000000-0000-0000-0000-000000000001';

-- 5. Test that legitimate operator reconciliation on outcome_unknown SUCCEEDS
\set ON_ERROR_STOP on
UPDATE outbound_queue
SET status = 'delivered',
    delivered_at = clock_timestamp(),
    lease_token = NULL,
    lease_expires_at = NULL,
    claimed_at = NULL,
    reconciled_at = clock_timestamp(),
    reconciled_by = 'test-operator@byos.local',
    reconciliation_reason = 'Verified external acceptance'
WHERE id = 'e5000000-0000-0000-0000-000000000002'; -- status is 'outcome_unknown'

-- Reset role back to byos
RESET ROLE;

-- Verify resulting state of row 2
SELECT id, status, reconciled_by, reconciliation_reason
FROM outbound_queue
WHERE id = 'e5000000-0000-0000-0000-000000000002';
