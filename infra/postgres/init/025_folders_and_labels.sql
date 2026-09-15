-- Migration 025: Mailbox Folders and Labels
CREATE TABLE IF NOT EXISTS mailbox_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    parent_id UUID REFERENCES mailbox_folders(id) ON DELETE CASCADE,
    notify BOOLEAN NOT NULL DEFAULT true,
    color VARCHAR(16) DEFAULT '#9E725F',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_folders_mailbox ON mailbox_folders(mailbox_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_folders_unique_name ON mailbox_folders(mailbox_id, LOWER(name));

CREATE TABLE IF NOT EXISTS mailbox_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    color VARCHAR(16) NOT NULL DEFAULT '#9E725F',
    color_name VARCHAR(32) NOT NULL DEFAULT 'Mocha',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_labels_mailbox ON mailbox_labels(mailbox_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_labels_unique_name ON mailbox_labels(mailbox_id, LOWER(name));

CREATE TABLE IF NOT EXISTS message_labels (
    message_id UUID NOT NULL REFERENCES message_metadata(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES mailbox_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_message_labels_label ON message_labels(label_id);
