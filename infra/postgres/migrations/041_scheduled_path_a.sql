-- Scheduled Send for Path A (end-to-end encrypted).
-- Path A rows store the full X-Wing envelope JSON and are delivered by a
-- Go goroutine in services/api without decryption.
-- Path B rows use the existing encrypted_message + send_token columns.

ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS is_path_a BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS envelope_json TEXT;

-- Path A rows legitimately have NULL for Path B columns.
ALTER TABLE scheduled_messages
  ALTER COLUMN encrypted_message DROP NOT NULL,
  ALTER COLUMN send_token_hpke_wrapped DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_path_a_due
  ON scheduled_messages (scheduled_at)
  WHERE status = 'pending' AND is_path_a = true;
