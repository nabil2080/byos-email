-- Migration 056: Post-Payment Onboarding Wizard State

ALTER TABLE organizations 
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_current_step INTEGER NOT NULL DEFAULT 1 
    CHECK (onboarding_current_step BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS onboarding_skipped BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storage_mode TEXT DEFAULT 'org_managed' 
    CHECK (storage_mode IN ('org_managed', 'individual', 'hybrid'));

-- Wire default_storage_connection_id for organizations that already have an active storage connection
UPDATE organizations o
SET default_storage_connection_id = (
  SELECT s.id 
  FROM storage_connections s 
  WHERE s.org_id = o.id AND s.status = 'active' 
  ORDER BY s.created_at ASC 
  LIMIT 1
)
WHERE o.default_storage_connection_id IS NULL;

-- Backfill: Only mark an organization complete if it legitimately satisfies all requirements:
-- active mailbox >= 1, verified domain >= 1, and active storage connection >= 1.
UPDATE organizations o
SET onboarding_completed_at = now(),
    onboarding_current_step = 7,
    onboarding_skipped = false,
    storage_mode = 'org_managed'
WHERE EXISTS (SELECT 1 FROM mailboxes m WHERE m.org_id = o.id AND m.is_active = true)
  AND EXISTS (SELECT 1 FROM domains d WHERE d.org_id = o.id AND d.is_verified = true)
  AND EXISTS (SELECT 1 FROM storage_connections s WHERE s.org_id = o.id AND s.status = 'active');
