-- ============================================================================
-- MIGRATION 071:
-- Release C6.5: Outbound Delivery Operations, Unknown-Outcome Reconciliation & Queue Observability
-- ============================================================================
--
-- Context:
--   1. Adds operator reconciliation metadata columns to outbound_queue:
--      reconciled_at, reconciled_by, reconciliation_reason.
--   2. Establishes the immutable operator delivery audit ledger:
--      outbound_delivery_operator_audit, capturing all manual operator
--      investigations, acceptance confirmations, retries, and rejections
--      with operator identity, reason, and external evidence references.
--   3. Adds an immutability trigger preventing UPDATE and DELETE mutations
--      on outbound_delivery_operator_audit.
--   4. Creates targeted operational indexes for queue health monitoring,
--      filtering, and audit traversal.
--   5. Applies least-privilege role permissions for role_support_agent and
--      explicitly restricts outbound_worker from operator audit access.
-- ============================================================================

-- 1. Extend outbound_queue with reconciliation tracking columns
ALTER TABLE public.outbound_queue
    ADD COLUMN IF NOT EXISTS reconciled_at          timestamptz,
    ADD COLUMN IF NOT EXISTS reconciled_by          text,
    ADD COLUMN IF NOT EXISTS reconciliation_reason  text;

-- 2. Create the immutable operator delivery audit ledger
CREATE TABLE IF NOT EXISTS public.outbound_delivery_operator_audit (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor_id             text NOT NULL,
    actor_email          text NOT NULL,
    actor_role           text NOT NULL,
    action               text NOT NULL,
    queue_id             uuid NOT NULL REFERENCES public.outbound_queue(id) ON DELETE CASCADE,
    delivery_id          uuid NOT NULL,
    previous_status      text NOT NULL,
    resulting_status     text NOT NULL,
    resolution_category  text,
    operator_reason      text NOT NULL,
    evidence_category    text,
    evidence_reference   text,
    ip_address           text,
    user_agent           text,
    CONSTRAINT chk_delivery_audit_action CHECK (action IN (
        'investigate',
        'add_note',
        'resolve_accepted',
        'authorize_retry',
        'resolve_bounced'
    ))
);

-- 3. Immutability trigger for outbound_delivery_operator_audit
CREATE OR REPLACE FUNCTION public.prevent_delivery_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'outbound_delivery_operator_audit is immutable. UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_delivery_audit_modification ON public.outbound_delivery_operator_audit;
CREATE TRIGGER trg_prevent_delivery_audit_modification
BEFORE UPDATE OR DELETE ON public.outbound_delivery_operator_audit
FOR EACH ROW EXECUTE FUNCTION public.prevent_delivery_audit_modification();

-- 4. Create performance indexes for queue operations and observability
CREATE INDEX IF NOT EXISTS idx_delivery_audit_queue_id
    ON public.outbound_delivery_operator_audit (queue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_audit_delivery_id
    ON public.outbound_delivery_operator_audit (delivery_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_audit_created_at
    ON public.outbound_delivery_operator_audit (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_status_created
    ON public.outbound_queue (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_domain_status
    ON public.outbound_queue (domain_id, status);

CREATE INDEX IF NOT EXISTS idx_outbound_queue_reconciled
    ON public.outbound_queue (reconciled_at DESC)
    WHERE reconciled_at IS NOT NULL;

-- 5. Least-privilege role permissions
DO $$
BEGIN
    -- Permissions for role_support_agent
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_support_agent') THEN
        -- Grant audit ledger access
        GRANT SELECT, INSERT ON public.outbound_delivery_operator_audit TO role_support_agent;

        -- Grant safe column-level SELECT on outbound_queue
        GRANT SELECT (
            id, delivery_id, mailbox_id, domain_id, recipient, status,
            attempts, max_attempts, next_attempt_at, created_at,
            delivered_at, failed_at, expires_at, lease_token, lease_owner,
            claimed_at, lease_expires_at, smtp_phase, last_smtp_code,
            last_error, reconciled_at, reconciled_by, reconciliation_reason
        ) ON public.outbound_queue TO role_support_agent;

        -- Grant safe UPDATE on outbound_queue for reconciliation transitions
        GRANT UPDATE (
            status, next_attempt_at, delivered_at, failed_at, smtp_phase,
            lease_token, lease_expires_at, claimed_at,
            reconciled_at, reconciled_by, reconciliation_reason
        ) ON public.outbound_queue TO role_support_agent;

        -- Grant access to delivery_log for reading history and writing operator resolutions
        GRANT SELECT, INSERT ON public.delivery_log TO role_support_agent;
    END IF;

    -- Outbound worker must NEVER access operator audit logs
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'outbound_worker') THEN
        REVOKE ALL ON public.outbound_delivery_operator_audit FROM outbound_worker;
    END IF;
END $$;
