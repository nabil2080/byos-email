-- Migration 062: Calendar Recurrence Exceptions
-- Supports detached recurrence exceptions (modified occurrences and cancellations)
-- for RFC 5545 compliant recurring calendar events.

CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_event_id    uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    calendar_id        uuid NOT NULL REFERENCES user_calendars(id) ON DELETE CASCADE,
    recurrence_id      text NOT NULL,
    is_cancelled       boolean NOT NULL DEFAULT false,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    is_all_day         boolean NOT NULL DEFAULT false,
    status             text NOT NULL DEFAULT 'busy',
    encrypted_payload  bytea NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_exception_times CHECK (end_time >= start_time),
    CONSTRAINT uq_event_exception_recurrence_id UNIQUE (parent_event_id, recurrence_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_exceptions_parent
    ON calendar_event_exceptions(parent_event_id);

CREATE INDEX IF NOT EXISTS idx_calendar_event_exceptions_mailbox_window
    ON calendar_event_exceptions(mailbox_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_calendar_event_exceptions_calendar_id
    ON calendar_event_exceptions(calendar_id);

DROP TRIGGER IF EXISTS trg_calendar_event_exceptions_updated_at ON calendar_event_exceptions;
CREATE TRIGGER trg_calendar_event_exceptions_updated_at
    BEFORE UPDATE ON calendar_event_exceptions
    FOR EACH ROW EXECUTE FUNCTION update_calendar_updated_at();
