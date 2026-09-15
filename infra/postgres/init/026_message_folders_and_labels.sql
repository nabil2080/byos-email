-- Migration 026: Add folder and folder_id to message_metadata
ALTER TABLE message_metadata
    ADD COLUMN IF NOT EXISTS folder VARCHAR(32) NOT NULL DEFAULT 'inbox',
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES mailbox_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_message_metadata_folder ON message_metadata(mailbox_id, folder);
CREATE INDEX IF NOT EXISTS idx_message_metadata_folder_id ON message_metadata(mailbox_id, folder_id);
