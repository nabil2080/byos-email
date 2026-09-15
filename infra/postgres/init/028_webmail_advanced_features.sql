-- Migration 028: Webmail Advanced Features
-- 2FA / recovery verification, regional settings, filters, address lists, and open tracking

-- 1. Add 2FA & recovery methods to users
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS totp_secret TEXT,
    ADD COLUMN IF NOT EXISTS recovery_email TEXT,
    ADD COLUMN IF NOT EXISTS recovery_phone TEXT;

-- 2. Add language, time format, and week start to mailbox_settings
ALTER TABLE mailbox_settings
    ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS time_format VARCHAR(10) NOT NULL DEFAULT '12h',
    ADD COLUMN IF NOT EXISTS week_start VARCHAR(15) NOT NULL DEFAULT 'sunday';

-- 3. Mailbox Custom & Sieve Filters
CREATE TABLE IF NOT EXISTS mailbox_filters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    filter_type VARCHAR(20) NOT NULL DEFAULT 'custom', -- 'custom' or 'sieve'
    rules_json JSONB,                                  -- GUI filter: { match: 'all'|'any', conditions: [...], actions: [...] }
    sieve_script TEXT,                                 -- raw RFC 5228 script
    priority INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_filters_mailbox ON mailbox_filters(mailbox_id, priority ASC);

-- 4. Spam, Block, and Allow Lists
CREATE TABLE IF NOT EXISTS mailbox_address_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    list_type VARCHAR(20) NOT NULL,                    -- 'spam', 'block', 'allow'
    target_type VARCHAR(20) NOT NULL DEFAULT 'address', -- 'address' or 'domain'
    value TEXT NOT NULL,                               -- e.g. user@domain.com or @spamsite.com
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mailbox_address_rules_lookup ON mailbox_address_rules(mailbox_id, list_type);
CREATE INDEX IF NOT EXISTS idx_mailbox_address_rules_value ON mailbox_address_rules(mailbox_id, value);

-- 5. Message Open Tracking
CREATE TABLE IF NOT EXISTS message_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id UUID NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    tracking_token VARCHAR(64) NOT NULL UNIQUE,
    subject TEXT,
    recipient TEXT,
    open_count INT NOT NULL DEFAULT 0,
    first_opened_at TIMESTAMPTZ,
    last_opened_at TIMESTAMPTZ,
    last_user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_tracking_token ON message_tracking(tracking_token);
CREATE INDEX IF NOT EXISTS idx_message_tracking_mailbox ON message_tracking(mailbox_id);
