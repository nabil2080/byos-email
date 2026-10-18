-- Verification script for Seat-Based Billing Migration (055_seat_based_pricing.sql)

-- 1. Check organizations table structure for seat_count and absence of dropped columns
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'organizations'
  AND column_name IN ('seat_count', 'subscription_status', 'plan', 'max_domains', 'max_aliases')
ORDER BY column_name;

-- 2. Check mailboxes table structure for absence of plan column
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'mailboxes'
  AND column_name = 'plan';

-- 3. Check seat_count check constraint on organizations
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'organizations'::regclass
  AND conname LIKE '%seat%';

-- 4. Check active organizations and their seat counts and subscription status
SELECT id, name, seat_count, subscription_status, billing_cycle
FROM organizations
ORDER BY name;
