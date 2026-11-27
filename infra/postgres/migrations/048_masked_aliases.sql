CREATE TABLE IF NOT EXISTS masked_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
  alias_address TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_at TIMESTAMPTZ,
  reply_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_masked_aliases_mailbox
  ON masked_aliases (mailbox_id);

CREATE INDEX IF NOT EXISTS idx_masked_aliases_address
  ON masked_aliases (alias_address);

-- Reply mapping: when a message arrives at an alias, we remember the
-- original sender so replies can be routed back correctly.
CREATE TABLE IF NOT EXISTS masked_alias_reply_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_id UUID NOT NULL REFERENCES masked_aliases(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES message_metadata(id) ON DELETE CASCADE,
  original_sender TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS idx_masked_alias_reply_map_message
  ON masked_alias_reply_map (message_id);

CREATE INDEX IF NOT EXISTS idx_masked_alias_reply_map_alias
  ON masked_alias_reply_map (alias_id);
