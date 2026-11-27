-- Retire the old mailbox_filters table. It stored rules that were never
-- evaluated at ingest time. Replaced by mail_rules with a stricter schema.

DROP TABLE IF EXISTS mailbox_filters CASCADE;

CREATE TABLE IF NOT EXISTS mail_rules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    priority integer NOT NULL DEFAULT 0,
    match_sender text,
    match_recipient text,
    match_has_attachments boolean,
    match_min_size_bytes bigint,
    action_type text NOT NULL,
    action_folder text,
    action_label_id uuid REFERENCES mailbox_labels(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT check_mail_rules_action CHECK (action_type IN ('move', 'label', 'mark_read', 'delete'))
);

CREATE INDEX IF NOT EXISTS idx_mail_rules_mailbox
  ON mail_rules (mailbox_id, enabled, priority ASC);

-- Add size_bytes to message_metadata so client-side rule
-- testing can evaluate min_size on existing messages
ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS size_bytes bigint NOT NULL DEFAULT 0;
