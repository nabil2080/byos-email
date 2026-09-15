-- Migration 021: Mailbox Invitations, Multi-Key Storage & Lifecycle Status
CREATE TABLE IF NOT EXISTS account_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    privacy_mode VARCHAR(32) NOT NULL CHECK (privacy_mode IN ('private', 'organization_managed')),
    mailbox_pk TEXT, -- Nullable for private mode until claimed by user
    wrapped_sk_org TEXT, -- Present only for org_managed
    temp_wrapped_sk TEXT, -- Present only for org_managed; wiped upon claim
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_invitations_token_hash ON account_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_org_id ON account_invitations(org_id);
CREATE INDEX IF NOT EXISTS idx_invitations_mailbox_id ON account_invitations(mailbox_id);

-- Alter tables to support pending activation state
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_activation', 'suspended'));

ALTER TABLE mailboxes ALTER COLUMN mailbox_sk_wrapped DROP NOT NULL;
ALTER TABLE mailboxes ALTER COLUMN mailbox_pk DROP NOT NULL;
ALTER TABLE mailboxes ALTER COLUMN root_secret_id DROP NOT NULL;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_activation', 'suspended'));
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS wrapped_sk_user TEXT;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS wrapped_sk_org TEXT;
