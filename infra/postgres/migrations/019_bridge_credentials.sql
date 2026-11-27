-- Section 19: IMAP / SMTP Bridge credentials table
-- Stores SHA-256 hashes of bridge access tokens generated for desktop client connections.

CREATE TABLE IF NOT EXISTS bridge_credentials (
    id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    mailbox_id  uuid        NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    label       text        NOT NULL,  -- e.g. "MacBook Pro Outlook", "Thunderbird"
    token_hash  bytea       NOT NULL UNIQUE, -- SHA-256 hash of opaque token
    created_at  timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NULL,
    revoked_at  timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_bridge_credentials_mailbox
    ON bridge_credentials(mailbox_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_credentials_token_hash
    ON bridge_credentials(token_hash) WHERE revoked_at IS NULL;
