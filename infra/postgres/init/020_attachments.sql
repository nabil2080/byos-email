-- Section 20: Attachment System
-- Tracks encrypted attachments associated with mailboxes / messages.
-- V1 limit: total message size budget 40 MB.

CREATE TABLE IF NOT EXISTS attachments (
    id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    mailbox_id    uuid        NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    message_id    text        NULL,  -- optional reference to message / draft
    filename      text        NOT NULL,
    content_type  text        NOT NULL DEFAULT 'application/octet-stream',
    size_bytes    bigint      NOT NULL,
    storage_key   text        NOT NULL, -- object key in customer storage
    encrypted     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_mailbox
    ON attachments(mailbox_id);

CREATE INDEX IF NOT EXISTS idx_attachments_message
    ON attachments(mailbox_id, message_id) WHERE message_id IS NOT NULL;
