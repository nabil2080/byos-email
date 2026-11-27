-- ============================================================================
-- MIGRATION 072:
-- Release C6.5.2: Operator Reconciliation Safety, Evidence Provenance & Idempotency
-- ============================================================================
--
-- Context:
--   1. Adds evidence provenance tracking to outbound_delivery_operator_audit:
--      - evidence_provenance: ('operator_attested', 'independent_verified', 'insufficient')
--      - is_independently_verified: boolean distinguishing external operator attestation
--        from system-verified remote MTA records.
--      - idempotency_key: unique per-mutation token preventing duplicate operator retries
--        or resolutions from network retries, browser refreshes, or concurrent submissions.
--   2. Enforces unique idempotency constraint on non-null idempotency_key.
--   3. Maintains least-privilege grants for role_support_agent and outbound_worker isolation.
-- ============================================================================

-- 1. Extend outbound_delivery_operator_audit with provenance and idempotency columns
ALTER TABLE public.outbound_delivery_operator_audit
    ADD COLUMN IF NOT EXISTS evidence_provenance text NOT NULL DEFAULT 'operator_attested',
    ADD COLUMN IF NOT EXISTS is_independently_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS idempotency_key text;

-- 2. Add constraint for valid provenance categories if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_delivery_audit_provenance'
          AND conrelid = 'public.outbound_delivery_operator_audit'::regclass
    ) THEN
        ALTER TABLE public.outbound_delivery_operator_audit
            ADD CONSTRAINT chk_delivery_audit_provenance
            CHECK (evidence_provenance IN ('operator_attested', 'independent_verified', 'insufficient'));
    END IF;
END $$;

-- 3. Unique index for request idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_audit_idempotency
    ON public.outbound_delivery_operator_audit (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- 4. Role permissions
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_support_agent') THEN
        GRANT SELECT, INSERT ON public.outbound_delivery_operator_audit TO role_support_agent;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'outbound_worker') THEN
        REVOKE ALL ON public.outbound_delivery_operator_audit FROM outbound_worker;
    END IF;
END $$;
