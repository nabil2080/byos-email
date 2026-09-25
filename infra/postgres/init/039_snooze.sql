-- Snooze support: hide a message from inbox until a specified time.

ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_message_metadata_snoozed
  ON message_metadata (mailbox_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;
