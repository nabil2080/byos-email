-- Support CRM Organization Management & Status Persistence
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_status_check'
    ) THEN
        ALTER TABLE organizations ADD CONSTRAINT organizations_status_check 
        CHECK (status = ANY (ARRAY['active'::text, 'suspended'::text, 'grace_period'::text]));
    END IF;
END $$;

-- Enforce strict Zero-Knowledge column-level security:
-- role_support_agent must NEVER have SELECT privileges on cryptographic key columns (e.g. org_recovery_pk)
REVOKE SELECT ON organizations FROM role_support_agent;
GRANT SELECT (id, name, default_storage_connection_id, created_at, updated_at, plan, status) ON organizations TO role_support_agent;
GRANT UPDATE (plan, status, updated_at) ON organizations TO role_support_agent;

-- Extend audit ledger for organization-level entity mutations
ALTER TABLE support_audit_logs ADD COLUMN IF NOT EXISTS target_org_uuid uuid;
ALTER TABLE support_audit_logs ADD COLUMN IF NOT EXISTS admin_actor_uuid uuid;
GRANT SELECT, INSERT ON support_audit_logs TO role_support_agent;

