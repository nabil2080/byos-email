-- Migration 063: Calendar Sharing and Permissions
-- Supports organizational calendar sharing with granular read and read-write permissions
-- and zero-knowledge encrypted key envelopes.

CREATE TABLE IF NOT EXISTS calendar_shares (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    calendar_id        uuid NOT NULL REFERENCES user_calendars(id) ON DELETE CASCADE,
    grantor_mailbox_id uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    grantee_mailbox_id uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    permission         text NOT NULL DEFAULT 'read',
    encrypted_key      text,
    status             text NOT NULL DEFAULT 'active',
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_calendar_share_permission CHECK (permission IN ('read', 'write')),
    CONSTRAINT chk_calendar_share_status CHECK (status IN ('active', 'revoked')),
    CONSTRAINT chk_calendar_share_distinct_mailboxes CHECK (grantor_mailbox_id <> grantee_mailbox_id),
    CONSTRAINT uq_calendar_shares_calendar_grantee UNIQUE (calendar_id, grantee_mailbox_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_shares_grantee
    ON calendar_shares(grantee_mailbox_id, status);

CREATE INDEX IF NOT EXISTS idx_calendar_shares_calendar
    ON calendar_shares(calendar_id, status);

CREATE INDEX IF NOT EXISTS idx_calendar_shares_grantor
    ON calendar_shares(grantor_mailbox_id);

DROP TRIGGER IF EXISTS trg_calendar_shares_updated_at ON calendar_shares;
CREATE TRIGGER trg_calendar_shares_updated_at
    BEFORE UPDATE ON calendar_shares
    FOR EACH ROW EXECUTE FUNCTION update_calendar_updated_at();
