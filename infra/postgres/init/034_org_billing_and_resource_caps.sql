-- Migration 034: Organization Billing Cycle & Dynamic Resource Capping (max_domains, max_aliases)
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'annual';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_domains integer NOT NULL DEFAULT 3;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_aliases integer NOT NULL DEFAULT 100;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_billing_cycle_check'
    ) THEN
        ALTER TABLE organizations ADD CONSTRAINT organizations_billing_cycle_check 
        CHECK (billing_cycle IN ('monthly', 'annual'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_max_domains_check'
    ) THEN
        ALTER TABLE organizations ADD CONSTRAINT organizations_max_domains_check 
        CHECK (max_domains >= 1);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_max_aliases_check'
    ) THEN
        ALTER TABLE organizations ADD CONSTRAINT organizations_max_aliases_check 
        CHECK (max_aliases >= 10);
    END IF;
END $$;

-- Compute and backfill limits for existing organizations based on their seat_count:
-- Aliases: seat_count * 10
-- Domains: <= 10 -> 3; 11-25 -> 5; >= 26 -> 10
UPDATE organizations
SET 
  max_domains = CASE 
    WHEN COALESCE(seat_count, 10) >= 26 THEN 10
    WHEN COALESCE(seat_count, 10) >= 11 THEN 5
    ELSE 3
  END,
  max_aliases = COALESCE(seat_count, 10) * 10,
  billing_cycle = COALESCE(billing_cycle, 'annual');

-- Grant column-level access to support role preserving Zero-Knowledge boundaries:
GRANT SELECT (id, name, default_storage_connection_id, created_at, updated_at, plan, status, seat_count, billing_cycle, max_domains, max_aliases) ON organizations TO role_support_agent;
GRANT UPDATE (plan, status, updated_at, seat_count, billing_cycle, max_domains, max_aliases) ON organizations TO role_support_agent;
GRANT INSERT ON domains TO role_support_agent;
