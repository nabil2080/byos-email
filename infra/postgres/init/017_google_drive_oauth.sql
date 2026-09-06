CREATE TABLE IF NOT EXISTS google_drive_oauth_states (
    state       text PRIMARY KEY,
    org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri text NOT NULL,
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_google_drive_oauth_states_expiry
  ON google_drive_oauth_states(expires_at);
