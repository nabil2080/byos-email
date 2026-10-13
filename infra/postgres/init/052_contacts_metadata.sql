-- Migration 052: Contact Management Metadata
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS group_name TEXT,
  ALTER COLUMN encrypted_envelope DROP NOT NULL;

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_contacts_updated_at();

-- Case-insensitive unique constraint per mailbox
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_mailbox_email_lower
  ON contacts(mailbox_id, LOWER(email)) WHERE email IS NOT NULL;

-- Composite index for fast listing and search
CREATE INDEX IF NOT EXISTS idx_contacts_mailbox_group_name
  ON contacts(mailbox_id, group_name);
