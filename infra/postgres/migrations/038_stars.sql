-- Persist starred state for messages.
-- Until now, starring was client-only and lost on reload. This migration
-- makes the state durable across sessions and devices.

ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_message_metadata_starred
  ON message_metadata (mailbox_id, is_starred)
  WHERE is_starred = true;
