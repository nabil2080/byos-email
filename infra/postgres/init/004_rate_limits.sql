-- V1 Rate Limits for Outbound Trust Engine (Section 8)
-- Adds plan columns, rate_limits table, retry_after for scheduled

-- 1. Plan columns (default solo) for per-plan limits
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'solo' CHECK (plan IN ('solo','starter','business','team','business_plus','enterprise'));
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'solo' CHECK (plan IN ('solo','starter','business','team','business_plus','enterprise'));

-- 2. Scheduler retry_after for deferred promotion (no status change, just defer)
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS retry_after timestamptz;

-- 3. Rate limits table (use time_window to avoid reserved keyword)
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name TEXT NOT NULL CHECK (plan_name IN ('solo','starter','business','team','business_plus','enterprise')),
  scope TEXT NOT NULL CHECK (scope IN ('mailbox','org','recipients')),
  time_window TEXT NOT NULL CHECK (time_window IN ('minute','hour','day','recipients')),
  limit_value INTEGER NOT NULL CHECK (limit_value > 0),
  UNIQUE(plan_name, scope, time_window)
);

-- Seed defaults (spec table)
-- recipients per message
INSERT INTO rate_limits (plan_name, scope, time_window, limit_value) VALUES
('solo','recipients','recipients',100),
('starter','recipients','recipients',100),
('business','recipients','recipients',200),
('team','recipients','recipients',200),
('business_plus','recipients','recipients',500),
('enterprise','recipients','recipients',1000)
ON CONFLICT (plan_name, scope, time_window) DO NOTHING;

-- mailbox minute/hour/day
INSERT INTO rate_limits (plan_name, scope, time_window, limit_value) VALUES
('solo','mailbox','minute',5),
('solo','mailbox','hour',50),
('solo','mailbox','day',200),
('starter','mailbox','minute',10),
('starter','mailbox','hour',100),
('starter','mailbox','day',400),
('business','mailbox','minute',20),
('business','mailbox','hour',200),
('business','mailbox','day',800),
('team','mailbox','minute',30),
('team','mailbox','hour',300),
('team','mailbox','day',1200),
('business_plus','mailbox','minute',50),
('business_plus','mailbox','hour',500),
('business_plus','mailbox','day',2000),
('enterprise','mailbox','minute',100),
('enterprise','mailbox','hour',1000),
('enterprise','mailbox','day',5000)
ON CONFLICT (plan_name, scope, time_window) DO NOTHING;

-- org minute/hour/day
INSERT INTO rate_limits (plan_name, scope, time_window, limit_value) VALUES
('solo','org','minute',10),
('solo','org','hour',100),
('solo','org','day',400),
('starter','org','minute',20),
('starter','org','hour',200),
('starter','org','day',800),
('business','org','minute',40),
('business','org','hour',400),
('business','org','day',1600),
('team','org','minute',60),
('team','org','hour',600),
('team','org','day',2400),
('business_plus','org','minute',100),
('business_plus','org','hour',1000),
('business_plus','org','day',4000),
('enterprise','org','minute',200),
('enterprise','org','hour',2000),
('enterprise','org','day',10000)
ON CONFLICT (plan_name, scope, time_window) DO NOTHING;

-- Grants
GRANT SELECT ON rate_limits TO outbound_worker;
GRANT SELECT ON organizations TO outbound_worker;
-- Extend column grants for plan
GRANT SELECT (plan) ON TABLE mailboxes TO outbound_worker;
GRANT SELECT (plan) ON TABLE organizations TO outbound_worker;
-- Ensure scheduled_messages retry_after is accessible (already GRANT SELECT,INSERT,UPDATE on scheduled_messages from 003)
-- Create index for retry_after polling
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_retry ON scheduled_messages(retry_after) WHERE status='pending';
