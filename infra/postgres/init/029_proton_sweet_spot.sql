-- 029_proton_sweet_spot.sql
-- Migration to adopt Proton-style Sweet Spot Architecture:
-- 1. Flatten mailboxes to private zero-knowledge by default
-- 2. Support historical key archiving when passwords reset
-- 3. WebAuthn / Passkeys for biometrics and hardware keys
-- 4. Auth challenges for passkeys & identity recovery verification

-- 1. Update mailboxes table
ALTER TABLE mailboxes ALTER COLUMN mode SET DEFAULT 'private';
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS previous_wrapped_sk_user TEXT;
ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS previous_key_archived_at TIMESTAMPTZ;

-- 2. Create user_passkeys table for WebAuthn / FIDO2 credentials
CREATE TABLE IF NOT EXISTS user_passkeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter BIGINT NOT NULL DEFAULT 0,
    device_name TEXT NOT NULL DEFAULT 'Security Key',
    aaguid TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_credential_id ON user_passkeys(credential_id);

-- 3. Create auth_challenges table for passkey handshakes & recovery codes
CREATE TABLE IF NOT EXISTS auth_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    challenge_type TEXT NOT NULL, -- 'webauthn_register', 'webauthn_login', 'recovery_reset'
    challenge_token TEXT UNIQUE NOT NULL,
    verification_code TEXT,
    destination TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_token ON auth_challenges(challenge_token);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expires_at);
