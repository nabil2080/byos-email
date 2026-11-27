-- Section 15: Account recovery challenge store
-- Challenges are server-random, single-use, short-lived. A challenge_id
-- that was never issued (anti-enumeration response) simply has no row, so
-- verification fails closed with the same error as an expired challenge.

CREATE TABLE IF NOT EXISTS recovery_challenges (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge_id    uuid NOT NULL UNIQUE,
    expires_at      timestamptz NOT NULL,
    consumed_at     timestamptz NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recovery_challenges_user
    ON recovery_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_challenges_expiry
    ON recovery_challenges(expires_at) WHERE consumed_at IS NULL;
