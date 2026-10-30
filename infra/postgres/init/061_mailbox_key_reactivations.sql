-- Migration 061: Staged Historical Key Reactivations
-- Provides transactional, staged, and recoverable workflow for historical mailbox key reactivation.
-- Enforces mailbox ownership, short expiry, and atomic finalization or rollback.

CREATE TABLE IF NOT EXISTS mailbox_key_reactivations (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id           uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    candidate_wrapped_sk text NOT NULL,
    candidate_mailbox_pk bytea,
    status               text NOT NULL CHECK (status IN ('pending', 'finalized', 'rolled_back')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    expires_at           timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
    finalized_at         timestamptz,
    rolled_back_at       timestamptz,
    rollback_reason      text
);

-- Partial unique index ensuring at most one active pending reactivation per mailbox
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_pending_key_reactivation
    ON mailbox_key_reactivations(mailbox_id)
    WHERE status = 'pending';

-- Fast lookup by mailbox, user, and status
CREATE INDEX IF NOT EXISTS idx_mailbox_key_reactivations_lookup
    ON mailbox_key_reactivations(mailbox_id, user_id, status);

-- Fast lookup for expiry checks
CREATE INDEX IF NOT EXISTS idx_mailbox_key_reactivations_expiry
    ON mailbox_key_reactivations(status, expires_at)
    WHERE status = 'pending';
