-- Migration 075: Least-privilege hardening for role_support_agent on outbound_queue
-- Enforces that role_support_agent cannot tamper with worker-owned lease fields,
-- cannot claim or set 'processing' status, cannot mutate active worker leases,
-- and can only reconcile messages that are currently in 'outcome_unknown' status.

CREATE OR REPLACE FUNCTION enforce_support_agent_outbound_queue_boundaries()
RETURNS trigger AS $$
DECLARE
    is_support_agent boolean;
BEGIN
    -- Check if current user is role_support_agent (excluding superusers)
    SELECT current_user = 'role_support_agent' 
        OR (NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) 
            AND pg_has_role(current_user, 'role_support_agent', 'MEMBER'))
    INTO is_support_agent;

    IF is_support_agent THEN
        -- 1. Support agents can ONLY modify records currently in 'outcome_unknown' status
        IF OLD.status <> 'outcome_unknown' THEN
            RAISE EXCEPTION 'role_support_agent is restricted to reconciling outcome_unknown items only (current status: %)', OLD.status
                USING ERRCODE = 'insufficient_privilege';
        END IF;

        -- 2. Support agents can NEVER set status to 'processing' (worker-exclusive state)
        IF NEW.status = 'processing' THEN
            RAISE EXCEPTION 'role_support_agent cannot transition outbound_queue items to processing status'
                USING ERRCODE = 'insufficient_privilege';
        END IF;

        -- 3. Support agents can NEVER acquire or set non-NULL lease fields
        IF (NEW.lease_token IS DISTINCT FROM OLD.lease_token AND NEW.lease_token IS NOT NULL) OR
           (NEW.lease_owner IS DISTINCT FROM OLD.lease_owner AND NEW.lease_owner IS NOT NULL) OR
           (NEW.claimed_at IS DISTINCT FROM OLD.claimed_at AND NEW.claimed_at IS NOT NULL) OR
           (NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at AND NEW.lease_expires_at IS NOT NULL) THEN
            RAISE EXCEPTION 'role_support_agent cannot acquire or set lease fields (lease fields can only be cleared to NULL or preserved)'
                USING ERRCODE = 'insufficient_privilege';
        END IF;

        -- 4. Support agents can NEVER advance or set non-NULL smtp_phase
        IF NEW.smtp_phase IS DISTINCT FROM OLD.smtp_phase AND NEW.smtp_phase IS NOT NULL THEN
            RAISE EXCEPTION 'role_support_agent cannot set or advance smtp_phase (smtp_phase can only be cleared to NULL or preserved)'
                USING ERRCODE = 'insufficient_privilege';
        END IF;

        -- 5. Support agents can NEVER override an active, unexpired worker lease
        IF OLD.lease_token IS NOT NULL AND OLD.lease_expires_at > clock_timestamp() THEN
            RAISE EXCEPTION 'role_support_agent cannot modify an item with an active worker lease (lease expires at %)', OLD.lease_expires_at
                USING ERRCODE = 'object_in_use';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_support_agent_outbound_queue_boundaries ON outbound_queue;
CREATE TRIGGER trg_enforce_support_agent_outbound_queue_boundaries
BEFORE UPDATE ON outbound_queue
FOR EACH ROW
EXECUTE FUNCTION enforce_support_agent_outbound_queue_boundaries();
