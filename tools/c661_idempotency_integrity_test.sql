-- BYOS C6.6.1: Idempotency Isolation and Constraint Integrity Verification
-- Verified against byos_disposable_upgrade_072_c661

\set ON_ERROR_STOP off

-- ============================================================================
-- TRANSACTION 4: Failed transaction isolation test
-- Verify check constraint enforcement fails safely and rolls back without
-- affecting previously committed idempotency cleanup records.
-- ============================================================================
BEGIN;

-- Attempt an illegal queue state exceeding manual retry bounds (manual_retry_count > max_manual_retries)
UPDATE outbound_queue
SET manual_retry_count = 2, max_manual_retries = 1
WHERE id = 'e5000000-0000-0000-0000-000000000001';

-- Attempt an illegal idempotency insertion inside same transaction
INSERT INTO delivery_operator_idempotency (
    idempotency_key, actor_id, actor_email, queue_id, action, request_fingerprint,
    status, created_at, expires_at
) VALUES (
    'idem-c661-illegal-rollback-004',
    'b1000000-0000-0000-0000-000000000001',
    'operator@example.com',
    'e5000000-0000-0000-0000-000000000001',
    'authorize_retry',
    'fp-illegal',
    'completed',
    clock_timestamp(),
    clock_timestamp() + interval '24 hours'
);

-- Transaction aborted due to constraint error
COMMIT;

\set ON_ERROR_STOP on

-- Verify that the aborted transaction did not mutate outbound_queue
SELECT id, status, manual_retry_count, max_manual_retries
FROM outbound_queue
WHERE id = 'e5000000-0000-0000-0000-000000000001';

-- Verify that the illegal idempotency key was rolled back
SELECT COUNT(*) AS illegal_key_count
FROM delivery_operator_idempotency
WHERE idempotency_key = 'idem-c661-illegal-rollback-004';

-- Verify that the committed records from previous cleanup still exist
SELECT idempotency_key, status
FROM delivery_operator_idempotency
WHERE idempotency_key LIKE 'idem-c661%'
ORDER BY idempotency_key;
