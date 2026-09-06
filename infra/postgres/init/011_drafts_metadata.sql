-- Step 8 Drafts (Slice B): recipient metadata + optimistic-concurrency version.
-- recipient: Category 3 server-readable compose metadata (same convention as
-- outbound_queue/scheduled_messages recipient columns).
-- version: groundwork for autosave / multi-device optimistic concurrency
-- (enforced in Slice C). Existing rows become version 1.

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS recipient TEXT NOT NULL DEFAULT '';

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drafts_version_check'
  ) THEN
    ALTER TABLE drafts ADD CONSTRAINT drafts_version_check
    CHECK (version >= 1);
  END IF;
END $$;

-- Supports draft listing ordered by recency per mailbox.
CREATE INDEX IF NOT EXISTS idx_drafts_mailbox_updated ON drafts(mailbox_id, updated_at DESC);
