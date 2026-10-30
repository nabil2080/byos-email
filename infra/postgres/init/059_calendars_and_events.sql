-- Migration 059: Personal Calendars and Events (Zero-Knowledge)

CREATE TABLE IF NOT EXISTS user_calendars (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name               text NOT NULL,
    color              text NOT NULL DEFAULT '#9E725F',
    is_default         boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    calendar_id        uuid NOT NULL REFERENCES user_calendars(id) ON DELETE CASCADE,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    is_all_day         boolean NOT NULL DEFAULT false,
    rrule              text,
    status             text NOT NULL DEFAULT 'busy',
    encrypted_payload  bytea NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_event_times CHECK (end_time >= start_time)
);

CREATE INDEX IF NOT EXISTS idx_user_calendars_mailbox
    ON user_calendars(mailbox_id, is_default);

CREATE INDEX IF NOT EXISTS idx_calendar_events_mailbox_window
    ON calendar_events(mailbox_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar_id
    ON calendar_events(calendar_id);

-- Auto-update updated_at triggers
CREATE OR REPLACE FUNCTION update_calendar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_calendars_updated_at ON user_calendars;
CREATE TRIGGER trg_user_calendars_updated_at
    BEFORE UPDATE ON user_calendars
    FOR EACH ROW EXECUTE FUNCTION update_calendar_updated_at();

DROP TRIGGER IF EXISTS trg_calendar_events_updated_at ON calendar_events;
CREATE TRIGGER trg_calendar_events_updated_at
    BEFORE UPDATE ON calendar_events
    FOR EACH ROW EXECUTE FUNCTION update_calendar_updated_at();
