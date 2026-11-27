-- Verification test for Phase 5: Idempotency Retention and Cleanup Validation
-- Run against byos_disposable_upgrade_c66

BEGIN;

-- 1. Create a queue item for testing
INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    manual_retry_count, max_manual_retries
) VALUES (
    'e5000000-0000-0000-0000-000000000088',
    'd5000000-0000-0000-0000-000000000088',
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'idempotency.test@example.com',
    '\x01020304', '\x05060708',
    'outcome_unknown',
    2, 5,
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '30 minutes',
    clock_timestamp() + interval '23 hours',
    1, 1 -- manual retry already exhausted (1/1)
) ON CONFLICT (id) DO NOTHING;

-- 2. Insert an audit record
INSERT INTO outbound_delivery_operator_audit (
    id, queue_id, delivery_id, actor_id, actor_email, actor_role,
    action, operator_reason, evidence_category, evidence_provenance,
    evidence_reference, is_independently_verified, previous_status, resulting_status,
    ip_address, idempotency_key, created_at
) VALUES (
    'f2000000-0000-0000-0000-000000000088',
    'e5000000-0000-0000-0000-000000000088',
    'd5000000-0000-0000-0000-000000000088',
    'b1000000-0000-0000-0000-000000000001',
    'admin@example.com',
    'support_lead',
    'authorize_retry',
    'First manual retry authorized',
    'network_trace',
    'operator_attested',
    'trace://net-drop-88',
    false,
    'outcome_unknown',
    'pending',
    '127.0.0.1',
    'idem-c66-expired-key-88',
    clock_timestamp() - interval '25 hours'
) ON CONFLICT (id) DO NOTHING;

-- 3. Insert an expired idempotency record (TTL was 24 hours, expired 1 hour ago)
INSERT INTO delivery_operator_idempotency (
    idempotency_key, actor_id, actor_email, queue_id, action, request_fingerprint,
    status, created_at, expires_at, audit_id, response_payload
) VALUES (
    'idem-c66-expired-key-88',
    'b1000000-0000-0000-0000-000000000001',
    'admin@example.com',
    'e5000000-0000-0000-0000-000000000088',
    'authorize_retry',
    'fp-sha256-dummy-fingerprint',
    'completed',
    clock_timestamp() - interval '25 hours',
    clock_timestamp() - interval '1 hour', -- EXPIRED
    'f2000000-0000-0000-0000-000000000088',
    '{"status":"retry_authorized","queue_id":"e5000000-0000-0000-0000-000000000088"}'::jsonb
);

COMMIT;
