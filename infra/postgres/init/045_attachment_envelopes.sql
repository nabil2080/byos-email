-- 045_attachment_envelopes.sql
-- Add attachment_envelopes column to message_metadata for Path A zero-knowledge attachment envelopes.

ALTER TABLE message_metadata ADD COLUMN IF NOT EXISTS attachment_envelopes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE message_metadata ADD COLUMN IF NOT EXISTS sender_attachment_envelopes JSONB DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_message_metadata_attachments ON message_metadata USING GIN (attachment_envelopes) WHERE attachment_envelopes != '[]'::jsonb;
