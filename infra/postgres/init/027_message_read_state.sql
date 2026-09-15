-- Migration 027: Persist read/unread state per message
-- Adds is_read column to message_metadata with default FALSE (unread)

ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
