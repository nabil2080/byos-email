-- Adds X-Wing storage support.
-- Both wrapped-key formats begin with version byte 0x01, so the 
-- wrapped_key_algorithm column is the ONLY way to distinguish them.
ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS wrapped_key_algorithm text NOT NULL
  DEFAULT 'HPKE-X25519-AES256GCM-v1';

ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS mailbox_xwing_pk bytea;
