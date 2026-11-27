CREATE TABLE IF NOT EXISTS contacts (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    encrypted_envelope bytea NOT NULL,
    version            integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_mailbox_updated
  ON contacts(mailbox_id, updated_at DESC, id ASC);
