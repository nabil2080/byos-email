-- 065_support_typing_indicator.sql
-- Add typing indicator timestamps to support_tickets

ALTER TABLE support_tickets 
    ADD COLUMN IF NOT EXISTS customer_typing_at timestamptz,
    ADD COLUMN IF NOT EXISTS agent_typing_at timestamptz;
