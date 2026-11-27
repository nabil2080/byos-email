-- Migration 024: Mailbox Settings & Session Metadata
CREATE TABLE IF NOT EXISTS mailbox_settings (
    mailbox_id UUID PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
    display_name TEXT,
    signature_plain TEXT,
    signature_html TEXT,
    insert_signature_on_reply BOOLEAN NOT NULL DEFAULT true,
    recovery_phrase_wrapped TEXT,
    recovery_phrase_salt TEXT,
    density VARCHAR(20) NOT NULL DEFAULT 'cozy',
    layout_mode VARCHAR(20) NOT NULL DEFAULT 'split',
    theme VARCHAR(20) NOT NULL DEFAULT 'cloud_dancer',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_settings_id ON mailbox_settings(mailbox_id);

-- Add metadata columns to sessions for active device and session management
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
