-- Migration 068: Add folder and folder_id columns to drafts table
-- Allows drafts to be moved to trash, custom folders, or restored to drafts.

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS folder VARCHAR(32) NOT NULL DEFAULT 'drafts';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES mailbox_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_drafts_mailbox_folder ON drafts(mailbox_id, folder);
CREATE INDEX IF NOT EXISTS idx_drafts_mailbox_folder_id ON drafts(mailbox_id, folder_id);
