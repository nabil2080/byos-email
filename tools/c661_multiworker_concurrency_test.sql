-- BYOS C6.6.1: Multi-Worker Concurrency & Atomic Claiming Verification
-- Verified against byos_test_isolation

\set ON_ERROR_STOP on

-- Clean up any residual test data from previous runs
DELETE FROM outbound_queue WHERE recipient LIKE 'concurrency.%@example.com';

-- Seed 6 pending messages for concurrent claiming
INSERT INTO outbound_queue (
    id, delivery_id, mailbox_id, domain_id, recipient,
    encrypted_message, send_token_hpke_wrapped, status,
    attempts, max_attempts, created_at, next_attempt_at, expires_at,
    manual_retry_count, max_manual_retries
)
SELECT 
    ('c6610000-0000-0000-0000-00000000000' || s)::uuid,
    ('d6610000-0000-0000-0000-00000000000' || s)::uuid,
    'c0000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000bbb',
    'concurrency.' || s || '@example.com',
    '\x01020304', '\x05060708',
    'pending',
    0, 5,
    clock_timestamp(),
    clock_timestamp() - interval '1 minute',
    clock_timestamp() + interval '24 hours',
    0, 1
FROM generate_series(1, 6) AS s;

-- Verify all 6 rows are in pending status
SELECT id, recipient, status, attempts, lease_owner, lease_token
FROM outbound_queue
WHERE recipient LIKE 'concurrency.%@example.com'
ORDER BY recipient;
