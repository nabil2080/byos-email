-- 051_client_queue_id.sql
-- Add client_queue_id column to message_metadata for offline send deduplication
ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS client_queue_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_metadata_client_queue
  ON message_metadata (mailbox_id, client_queue_id)
  WHERE client_queue_id IS NOT NULL;
