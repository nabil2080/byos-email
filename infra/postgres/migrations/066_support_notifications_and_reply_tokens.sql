-- 066_support_notifications_and_reply_tokens.sql
-- BYOS Support Platform Phase 02: Outbound Notifications, Secure Reply Tokens & Inbound Reply Ingestion

-- 1. Notification Outbox (Transactional Outbox Pattern)
CREATE TABLE IF NOT EXISTS support_notification_outbox (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id          uuid NOT NULL UNIQUE,
    event_type        text NOT NULL CHECK (event_type IN ('ticket_created', 'agent_reply', 'customer_reply', 'ticket_assigned', 'ticket_reassigned', 'ticket_status_changed', 'ticket_resolved')),
    ticket_id         uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    ticket_number     text NOT NULL,
    recipient_email   text NOT NULL,
    recipient_name    text NOT NULL,
    subject           text NOT NULL,
    body_text         text NOT NULL,
    body_html         text NOT NULL,
    reply_to_address  text,
    status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
    attempts          int NOT NULL DEFAULT 0,
    max_attempts      int NOT NULL DEFAULT 5,
    last_error        text,
    next_attempt_at   timestamptz NOT NULL DEFAULT now(),
    delivered_at      timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_notification_outbox_queue 
    ON support_notification_outbox(status, next_attempt_at) 
    WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_support_notification_outbox_ticket 
    ON support_notification_outbox(ticket_id, created_at DESC);

-- 2. Scoped Reply Tokens (Only cryptographic SHA-256 hash stored; raw token NEVER stored)
CREATE TABLE IF NOT EXISTS support_reply_tokens (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id         uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    customer_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_email    text NOT NULL,
    token_hash        bytea NOT NULL UNIQUE,
    is_revoked        boolean NOT NULL DEFAULT false,
    expires_at        timestamptz NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_used_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_support_reply_tokens_lookup 
    ON support_reply_tokens(token_hash) 
    WHERE is_revoked = false;

CREATE INDEX IF NOT EXISTS idx_support_reply_tokens_ticket 
    ON support_reply_tokens(ticket_id);

-- 3. Inbound Deduplication & Idempotency
CREATE TABLE IF NOT EXISTS support_inbound_dedup (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id_hash    bytea NOT NULL UNIQUE,
    ticket_id          uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    ticket_message_id  uuid NOT NULL REFERENCES support_ticket_messages(id) ON DELETE CASCADE,
    sender_email       text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_inbound_dedup_hash 
    ON support_inbound_dedup(message_id_hash);

-- 4. Message Source Tagging (Web vs Email vs System)
ALTER TABLE support_ticket_messages 
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'email', 'system'));

-- 5. Least-Privilege Grants for role_support_agent (used by admin-api)
GRANT SELECT, INSERT, UPDATE ON support_notification_outbox TO role_support_agent;
GRANT SELECT, INSERT, UPDATE ON support_reply_tokens TO role_support_agent;
GRANT SELECT, INSERT ON support_inbound_dedup TO role_support_agent;
