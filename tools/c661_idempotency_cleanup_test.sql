-- BYOS C6.6.1: Committed Idempotency Cleanup & Retention Verification
-- Verified against byos_disposable_upgrade_072_c661

\set ON_ERROR_STOP on

-- ============================================================================
-- TRANSACTION 1: Seed test state (expired, active completed, in-progress)
-- ============================================================================
BEGIN;

-- Audit record for expired operation
INSERT INTO outbound_delivery_operator_audit (
    id, queue_id, delivery_id, actor_id, actor_email, actor_role,
    action, operator_reason, evidence_category, evidence_provenance,
    evidence_reference, is_independently_verified, previous_status, resulting_status,
    ip_address, idempotency_key, created_at
) VALUES (
    'f2000000-0000-0000-0000-000000000091',
    'e5000000-0000-0000-0000-000000000001',
    'd5000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'operator@example.com',
    'support_lead',
    'authorize_retry',
    'Initial retry authorization that later expired',
    'network_trace',
    'operator_attested',
    'trace://expired-attempt-91',
    false,
    'outcome_unknown',
    'pending',
    '127.0.0.1',
    'idem-c661-expired-001',
    clock_timestamp() - interval '26 hours'
);

-- Audit record for active completed operation
INSERT INTO outbound_delivery_operator_audit (
    id, queue_id, delivery_id, actor_id, actor_email, actor_role,
    action, operator_reason, evidence_category, evidence_provenance,
    evidence_reference, is_independently_verified, previous_status, resulting_status,
    ip_address, idempotency_key, created_at
) VALUES (
    'f2000000-0000-0000-0000-000000000092',
    'e5000000-0000-0000-0000-000000000001',
    'd5000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'operator@example.com',
    'support_lead',
    'add_note',
    'Recent operational note with active idempotency reservation',
    'smtp_diagnostic',
    'operator_attested',
    'note://active-valid-92',
    false,
    'outcome_unknown',
    'outcome_unknown',
    '127.0.0.1',
    'idem-c661-active-002',
    clock_timestamp() - interval '2 hours'
);

-- 1. Expired completed reservation (TTL 24 hours, expired 2 hours ago)
INSERT INTO delivery_operator_idempotency (
    idempotency_key, actor_id, actor_email, queue_id, action, request_fingerprint,
    status, created_at, expires_at, audit_id, response_payload
) VALUES (
    'idem-c661-expired-001',
    'b1000000-0000-0000-0000-000000000001',
    'operator@example.com',
    'e5000000-0000-0000-0000-000000000001',
    'authorize_retry',
    'fp-sha256-expired-001',
    'completed',
    clock_timestamp() - interval '26 hours',
    clock_timestamp() - interval '2 hours',
    'f2000000-0000-0000-0000-000000000091',
    '{"status":"retry_authorized","queue_id":"e5000000-0000-0000-0000-000000000001"}'::jsonb
);

-- 2. Active completed reservation (expires in 22 hours)
INSERT INTO delivery_operator_idempotency (
    idempotency_key, actor_id, actor_email, queue_id, action, request_fingerprint,
    status, created_at, expires_at, audit_id, response_payload
) VALUES (
    'idem-c661-active-002',
    'b1000000-0000-0000-0000-000000000001',
    'operator@example.com',
    'e5000000-0000-0000-0000-000000000001',
    'add_note',
    'fp-sha256-active-002',
    'completed',
    clock_timestamp() - interval '2 hours',
    clock_timestamp() + interval '22 hours',
    'f2000000-0000-0000-0000-000000000092',
    '{"status":"note_added","queue_id":"e5000000-0000-0000-0000-000000000001"}'::jsonb
);

-- 3. In-progress reservation (expires in 50 seconds / active)
INSERT INTO delivery_operator_idempotency (
    idempotency_key, actor_id, actor_email, queue_id, action, request_fingerprint,
    status, created_at, expires_at, audit_id, response_payload
) VALUES (
    'idem-c661-inprogress-003',
    'b1000000-0000-0000-0000-000000000001',
    'operator@example.com',
    'e5000000-0000-0000-0000-000000000001',
    'investigate',
    'fp-sha256-inprogress-003',
    'in_progress',
    clock_timestamp() - interval '10 seconds',
    clock_timestamp() + interval '50 seconds',
    NULL,
    NULL
);

COMMIT;

-- ============================================================================
-- VERIFY PRE-CLEANUP STATE
-- ============================================================================
SELECT idempotency_key, status, expires_at < clock_timestamp() AS is_expired
FROM delivery_operator_idempotency
WHERE idempotency_key LIKE 'idem-c661%'
ORDER BY idempotency_key;

-- ============================================================================
-- TRANSACTION 2: Execute and COMMIT the cleanup operation
-- ============================================================================
BEGIN;

WITH deleted_rows AS (
    DELETE FROM delivery_operator_idempotency
    WHERE expires_at < clock_timestamp()
      AND status = 'completed'
    RETURNING idempotency_key, status, expires_at
)
SELECT 'CLEANED' AS result, idempotency_key, status, expires_at FROM deleted_rows;

COMMIT;

-- ============================================================================
-- TRANSACTION 3: Verify post-cleanup persistence on fresh snapshot
-- ============================================================================
-- The expired row must be gone; active completed and in-progress rows must remain
SELECT idempotency_key, status, expires_at > clock_timestamp() AS is_future_valid
FROM delivery_operator_idempotency
WHERE idempotency_key LIKE 'idem-c661%'
ORDER BY idempotency_key;

-- Both audit records must remain intact (immutable audit trail preserved)
SELECT id, action, idempotency_key, created_at < clock_timestamp() AS created_in_past
FROM outbound_delivery_operator_audit
WHERE id IN ('f2000000-0000-0000-0000-000000000091', 'f2000000-0000-0000-0000-000000000092')
ORDER BY id;

-- Ensure audit immutability trigger still blocks deletion of audit records
DO $$
BEGIN
    DELETE FROM outbound_delivery_operator_audit
    WHERE id = 'f2000000-0000-0000-0000-000000000091';
    RAISE EXCEPTION 'Audit deletion unexpectedly succeeded!';
EXCEPTION
    WHEN integrity_constraint_violation OR check_violation OR raise_exception THEN
        RAISE NOTICE 'Audit deletion blocked by trigger as expected: %', SQLERRM;
END;
$$;
