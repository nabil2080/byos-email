-- Migration 054: OAuth Mailbox Import
-- Adds source tracking to message_metadata and import_jobs table

ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'native',
  ADD COLUMN IF NOT EXISTS source_provider TEXT,
  ADD COLUMN IF NOT EXISTS source_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_metadata_source_unique
  ON message_metadata (mailbox_id, source_provider, source_message_id)
  WHERE source_provider IS NOT NULL AND source_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  total_messages INT NOT NULL DEFAULT 0,
  imported_messages INT NOT NULL DEFAULT 0,
  skipped_messages INT NOT NULL DEFAULT 0,
  failed_messages INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_mailbox
  ON import_jobs (mailbox_id, created_at DESC);
