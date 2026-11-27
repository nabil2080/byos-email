-- ============================================================================
-- MIGRATION 074:
-- Release C6.6: Support Role Column-Level Permissions for Retry Governance
-- ============================================================================
--
-- Context:
--   1. Migration 073 introduced manual_retry_count and max_manual_retries on
--      outbound_queue.
--   2. Operator reconciliation in services/admin-api (run as role_support_agent)
--      requires SELECT on manual_retry_count and max_manual_retries, and
--      UPDATE on manual_retry_count, max_manual_retries, max_attempts, expires_at,
--      last_smtp_code, and last_error.
--   3. Migration 071 previously granted column-level permissions on outbound_queue
--      but did not cover the C6.5.3 columns and bounce/retry update fields.
--   4. Grant the missing least-privilege column permissions to role_support_agent.
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_support_agent') THEN
        -- Grant SELECT on retry governance columns
        GRANT SELECT (
            manual_retry_count,
            max_manual_retries
        ) ON public.outbound_queue TO role_support_agent;

        -- Grant UPDATE on retry governance and error settlement columns
        GRANT UPDATE (
            manual_retry_count,
            max_manual_retries,
            max_attempts,
            expires_at,
            last_smtp_code,
            last_error
        ) ON public.outbound_queue TO role_support_agent;
    END IF;
END $$;
