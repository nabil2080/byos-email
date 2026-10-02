-- Migration 042: Scheduled draft customer storage reference and metadata
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS draft_storage_ref TEXT;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT '';
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS send_at TIMESTAMPTZ;
ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

UPDATE scheduled_messages SET send_at = scheduled_at WHERE send_at IS NULL;

-- Remove orphan or unrecoverable rows without a valid customer storage reference
DELETE FROM scheduled_messages WHERE draft_storage_ref IS NULL OR draft_storage_ref = '' OR draft_storage_ref NOT LIKE 'mailboxes/%';

-- Enforce NOT NULL on draft_storage_ref
ALTER TABLE scheduled_messages ALTER COLUMN draft_storage_ref SET NOT NULL;

-- Add check constraint ensuring storage keys follow the customer storage pattern
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'scheduled_messages_draft_storage_ref_valid'
  ) THEN
    ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_draft_storage_ref_valid
    CHECK (draft_storage_ref <> '' AND draft_storage_ref LIKE 'mailboxes/%');
  END IF;
END $$;
