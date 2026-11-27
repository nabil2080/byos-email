-- Migration 033: B2B Infrastructure Seat Capacity & Support CRM Zero-Knowledge Security
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_count integer NOT NULL DEFAULT 10;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'organizations_seat_count_check'
    ) THEN
        ALTER TABLE organizations ADD CONSTRAINT organizations_seat_count_check 
        CHECK (seat_count >= 1);
    END IF;
END $$;

-- Maintain strict Zero-Knowledge column-level security:
-- role_support_agent must NEVER have SELECT privileges on cryptographic key columns (e.g. org_recovery_pk)
-- Grant column-level access to seat_count without exposing encryption keys
GRANT SELECT (id, name, default_storage_connection_id, created_at, updated_at, plan, status, seat_count) ON organizations TO role_support_agent;
GRANT UPDATE (plan, status, updated_at, seat_count) ON organizations TO role_support_agent;
