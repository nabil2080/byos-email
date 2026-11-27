-- Migration 055: Convert Control Panel Billing from named plans to seat-based pricing
-- Roadmap Section 25: Graduated per-seat pricing, no named plans, no feature gating.

-- 1. Ensure seat_count exists and has valid constraint
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS seat_count INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_seat_count_check'
  ) THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_seat_count_check
      CHECK (seat_count >= 1);
  END IF;
END $$;

-- 2. Add subscription_status
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'organizations_subscription_status_check'
  ) THEN
    ALTER TABLE organizations ADD CONSTRAINT organizations_subscription_status_check
      CHECK (subscription_status IN ('active', 'trialing', 'past_due', 'cancelled'));
  END IF;
END $$;

-- 3. Backfill seat_count from existing plan values
-- enterprise is a custom tier in the old model; mapped to 50 as a floor.
-- If any enterprise org exists, verify seat_count matches their real capacity.
-- Enforce that seat_count cannot be lower than the active mailbox count.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'plan'
  ) THEN
    UPDATE organizations o
    SET seat_count = GREATEST(
      CASE o.plan
        WHEN 'solo' THEN 1
        WHEN 'starter' THEN 5
        WHEN 'business' THEN 10
        WHEN 'team' THEN 25
        WHEN 'business_plus' THEN 50
        WHEN 'enterprise' THEN 50
        ELSE 10
      END,
      COALESCE((SELECT COUNT(*) FROM mailboxes m WHERE m.org_id = o.id AND m.is_active = true), 0),
      1
    );
  END IF;
END $$;

-- 4. Drop plan column and check constraint from organizations
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE organizations DROP COLUMN IF EXISTS plan;

-- 5. Drop plan column and check constraint from mailboxes
ALTER TABLE mailboxes DROP CONSTRAINT IF EXISTS mailboxes_plan_check;
ALTER TABLE mailboxes DROP COLUMN IF EXISTS plan;

-- 6. Drop stored max_domains and max_aliases; computed from seat_count on read
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_max_domains_check;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_max_aliases_check;
ALTER TABLE organizations DROP COLUMN IF EXISTS max_domains;
ALTER TABLE organizations DROP COLUMN IF EXISTS max_aliases;

-- 7. Update column permissions for role_support_agent
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'role_support_agent') THEN
    GRANT SELECT (id, name, default_storage_connection_id, created_at, updated_at, status, seat_count, billing_cycle, subscription_status) ON organizations TO role_support_agent;
    GRANT UPDATE (status, updated_at, seat_count, billing_cycle, subscription_status) ON organizations TO role_support_agent;
  END IF;
END $$;
