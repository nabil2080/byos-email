-- Migration 060: Calendar Event Migrations Staging and Preservation
-- Provides transactional, non-destructive staging for legacy calendar plaintext recovery.
-- Foreign keys enforce ON DELETE RESTRICT on active staged migrations to prevent accidental data loss.

CREATE TABLE IF NOT EXISTS calendar_event_migrations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id           uuid NOT NULL REFERENCES calendar_events(id) ON DELETE RESTRICT,
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE RESTRICT,
    legacy_payload     bytea,
    staged_payload     bytea NOT NULL,
    status             text NOT NULL CHECK (status IN ('staged', 'finalized', 'rolled_back')),
    etag               text NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
    finalized_at       timestamptz,
    rolled_back_at     timestamptz,
    rollback_reason    text
);

-- Partial unique index ensuring at most one active staged migration per event
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_event_active_migration
    ON calendar_event_migrations(event_id)
    WHERE status = 'staged';

-- Fast lookup by mailbox, event, and status
CREATE INDEX IF NOT EXISTS idx_calendar_event_migrations_lookup
    ON calendar_event_migrations(mailbox_id, event_id, status);

-- Fast lookup for expiration sweeper worker
CREATE INDEX IF NOT EXISTS idx_calendar_event_migrations_expiry
    ON calendar_event_migrations(status, expires_at)
    WHERE status = 'staged';
