-- ============================================================================
-- MIGRATION 073:
-- Release C6.5.3: Operator Retry Governance, Idempotency Isolation & Evidence Integrity
-- ============================================================================
--
-- Context:
--   1. Manual retry governance on outbound_queue:
--      - manual_retry_count: Track operator-authorized retransmissions independently
--        of automated retry attempts.
--      - max_manual_retries: Hard policy ceiling (default 1 for support agents,
--        maximum 2 for platform admin exceptional authorizations).
--      - Check constraint enforcing bounds: manual_retry_count <= max_manual_retries <= 2.
--   2. Request-bound idempotency on delivery_operator_idempotency:
--      - Explicit reservation table binding key to actor, resource, action, and
--        cryptographic request fingerprint.
--      - Prevents duplicate execution, cross-actor replay, and payload mismatch.
--   3. Evidence provenance integrity:
--      - Add request_fingerprint to outbound_delivery_operator_audit.
--      - Enforce is_independently_verified = false unless provenance is independent_verified.
--   4. Role isolation:
--      - role_support_agent granted access to idempotency table.
--      - outbound_worker denied access to audit and idempotency records.
-- ============================================================================

-- 1. Extend outbound_queue with manual retry governance columns
ALTER TABLE public.outbound_queue
    ADD COLUMN IF NOT EXISTS manual_retry_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS max_manual_retries integer NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_outbound_queue_manual_retry_bounds'
          AND conrelid = 'public.outbound_queue'::regclass
    ) THEN
        ALTER TABLE public.outbound_queue
            ADD CONSTRAINT chk_outbound_queue_manual_retry_bounds
            CHECK (manual_retry_count >= 0 AND manual_retry_count <= max_manual_retries AND max_manual_retries <= 2);
    END IF;
END $$;

-- 2. Extend outbound_delivery_operator_audit with request fingerprint and integrity constraint
ALTER TABLE public.outbound_delivery_operator_audit
    ADD COLUMN IF NOT EXISTS request_fingerprint text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_audit_provenance_verification'
          AND conrelid = 'public.outbound_delivery_operator_audit'::regclass
    ) THEN
        ALTER TABLE public.outbound_delivery_operator_audit
            ADD CONSTRAINT chk_audit_provenance_verification
            CHECK (is_independently_verified = false OR evidence_provenance = 'independent_verified');
    END IF;
END $$;

-- 3. Dedicated request-bound idempotency reservation table
CREATE TABLE IF NOT EXISTS public.delivery_operator_idempotency (
    idempotency_key text PRIMARY KEY,
    actor_id text NOT NULL,
    actor_email text NOT NULL,
    queue_id uuid NOT NULL REFERENCES public.outbound_queue(id) ON DELETE CASCADE,
    action text NOT NULL,
    request_fingerprint text NOT NULL,
    status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
    created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamp with time zone NOT NULL DEFAULT (clock_timestamp() + interval '24 hours'),
    audit_id uuid REFERENCES public.outbound_delivery_operator_audit(id),
    response_payload jsonb
);

CREATE INDEX IF NOT EXISTS idx_delivery_operator_idempotency_queue
    ON public.delivery_operator_idempotency (queue_id, action);

CREATE INDEX IF NOT EXISTS idx_delivery_operator_idempotency_expires
    ON public.delivery_operator_idempotency (expires_at);

-- 4. Role permissions and worker isolation
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_support_agent') THEN
        GRANT SELECT, INSERT, UPDATE ON public.delivery_operator_idempotency TO role_support_agent;
        GRANT SELECT, INSERT ON public.outbound_delivery_operator_audit TO role_support_agent;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'outbound_worker') THEN
        REVOKE ALL ON public.delivery_operator_idempotency FROM outbound_worker;
        REVOKE ALL ON public.outbound_delivery_operator_audit FROM outbound_worker;
    END IF;
END $$;
