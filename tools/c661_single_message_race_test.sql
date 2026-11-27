-- Single-message concurrent claim race
\set ON_ERROR_STOP on

BEGIN;

WITH candidates AS (
    SELECT id
    FROM outbound_queue
    WHERE id = 'c6610000-0000-0000-0000-000000000001'
      AND expires_at > now()
      AND status = 'pending'
    FOR UPDATE SKIP LOCKED
)
UPDATE outbound_queue q
SET status = 'processing',
    lease_token = gen_random_uuid(),
    lease_owner = :'worker_name',
    claimed_at = now(),
    lease_expires_at = now() + interval '60 seconds',
    smtp_phase = 'claimed',
    attempts = q.attempts + 1
FROM candidates c
WHERE q.id = c.id
RETURNING q.id, q.recipient, q.status, q.lease_owner;

SELECT pg_sleep(0.3);

COMMIT;
