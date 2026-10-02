-- 047_scheduled_attachments.sql
-- Add attachment_envelopes and sender_attachment_envelopes to scheduled_messages
-- for zero-knowledge end-to-end encrypted Path A scheduled attachments.

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS attachment_envelopes JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sender_attachment_envelopes JSONB DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_attachments
  ON scheduled_messages USING GIN (attachment_envelopes)
  WHERE attachment_envelopes != '[]'::jsonb;
