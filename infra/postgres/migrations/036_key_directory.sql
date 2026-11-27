ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS mailbox_ed25519_pk bytea,
  ADD COLUMN IF NOT EXISTS key_epoch integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS signing_key_epoch integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS key_status text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_mailboxes_lower_local_part
  ON mailboxes (lower(local_part));
