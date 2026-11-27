-- Worker claim query executed with worker_name variable
\set ON_ERROR_STOP on

BEGIN;

WITH candidates AS (
    SELECT id
    FROM outbound_queue
    WHERE expires_at > now()
      AND (smtp_phase IS NULL OR smtp_phase NOT IN ('accepted_by_mta', 'terminator_in_flight'))
      AND (
        (status = 'pending' AND next_attempt_at <= now())
        OR (
          status = 'processing'
          AND lease_expires_at <= now()
          AND COALESCE(smtp_phase, 'claimed') IN ('claimed', 'pre_data', 'data_streaming')
          AND attempts + 1 < max_attempts
        )
      )
      AND recipient LIKE 'concurrency.%@example.com'
    ORDER BY COALESCE(lease_expires_at, next_attempt_at) ASC, next_attempt_at ASC
    LIMIT 3
    FOR UPDATE SKIP LOCKED
)
UPDATE outbound_queue q
SET status = 'processing',
    lease_token = gen_random_uuid(),
    lease_owner = :'worker_name',
    claimed_at = now(),
    lease_expires_at = now() + interval '60 seconds',
    smtp_phase = 'claimed',
    attempts = CASE WHEN q.status = 'processing' THEN q.attempts + 1 ELSE q.attempts END
FROM candidates c
WHERE q.id = c.id
RETURNING q.id, q.recipient, q.status, q.lease_owner, q.lease_token;

-- Simulate small in-transaction delay to ensure overlap if started together
SELECT pg_sleep(0.5);

COMMIT;
