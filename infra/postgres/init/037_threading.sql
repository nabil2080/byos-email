-- Conversation threading support.
-- Adds message_id / in_reply_to (plaintext, extracted at ingest before
-- encryption) and thread_id (server-computed UUID grouping).
--
-- PRIVACY: this discloses the reply graph (message B replies to message A).
-- See roadmap Section 16.

ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS in_reply_to text,
  ADD COLUMN IF NOT EXISTS thread_id uuid NOT NULL DEFAULT gen_random_uuid();

-- Fast thread lookup within a mailbox
CREATE INDEX IF NOT EXISTS idx_message_metadata_thread
  ON message_metadata (mailbox_id, thread_id);

-- Fast parent lookup for computing thread_id at ingest
CREATE INDEX IF NOT EXISTS idx_message_metadata_msgid
  ON message_metadata (mailbox_id, message_id)
  WHERE message_id IS NOT NULL;

-- Fast In-Reply-To matching
CREATE INDEX IF NOT EXISTS idx_message_metadata_inreply
  ON message_metadata (mailbox_id, in_reply_to)
  WHERE in_reply_to IS NOT NULL;
