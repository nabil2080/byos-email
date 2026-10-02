-- Migration 043: Allow 'sent' status in scheduled_messages & drafts send_failed flag
ALTER TABLE scheduled_messages DROP CONSTRAINT IF EXISTS scheduled_messages_status_check;
ALTER TABLE scheduled_messages ADD CONSTRAINT scheduled_messages_status_check
  CHECK (status IN ('pending', 'executed', 'sent', 'cancelled', 'expired', 'failed'));

-- Backfill existing 'executed' rows
UPDATE scheduled_messages SET status = 'sent' WHERE status = 'executed' AND sent_at IS NOT NULL;
UPDATE scheduled_messages SET status = 'failed' WHERE status = 'executed' AND sent_at IS NULL;

-- Add send_failed column on drafts to avoid mutating subjects
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS send_failed BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_drafts_mailbox_send_failed ON drafts(mailbox_id) WHERE send_failed = true;

