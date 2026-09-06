-- V5.3 outbound reservation + AAD persistence
CREATE SEQUENCE IF NOT EXISTS outbound_message_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS outbound_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  mailbox_id uuid NOT NULL REFERENCES mailboxes(id),
  outbox_seq BIGINT NOT NULL DEFAULT nextval('outbound_message_seq'),
  encryption_version INTEGER NOT NULL DEFAULT 1,
  aad_version SMALLINT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','consumed','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  delivery_id uuid UNIQUE, -- exactly one delivery per reservation (idempotent retry, see below)
  UNIQUE(mailbox_id, outbox_seq)
);
CREATE INDEX IF NOT EXISTS idx_outbound_reservations_mailbox ON outbound_reservations(mailbox_id);
CREATE INDEX IF NOT EXISTS idx_outbound_reservations_user ON outbound_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_reservations_status ON outbound_reservations(status, expires_at);

-- Extend outbound_queue to store immutable AAD fields and link to reservation for idempotency
-- Safe migration: add nullable first, backfill from defaults, then validate (existing DB expected empty)
ALTER TABLE outbound_queue
  ADD COLUMN IF NOT EXISTS outbox_seq BIGINT,
  ADD COLUMN IF NOT EXISTS encryption_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS aad_version SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS encryption_iv BYTEA,
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES outbound_reservations(reservation_id);

-- Backfill existing rows (if any) with deterministic defaults (outbox_seq from delivery_id hash or sequence would be better, but dev DB is expected empty)
-- For robustness, allow nullable initially; application will always provide values for new rows.
-- Enforce NOT NULL only after verifying no NULLs remain (future migration)
-- Exactly one outbound delivery per reservation (idempotent retry) — reservation_id is nullable so multiple NULLs allowed, but non-NULL values must be unique
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_queue_reservation ON outbound_queue(reservation_id);
CREATE INDEX IF NOT EXISTS idx_outbound_queue_outbox_seq ON outbound_queue(mailbox_id, outbox_seq);

-- Least privilege: dedicated group role for outbound-worker (only outbound tables + minimal mailbox/domain lookup)
-- Production: password injected via Docker secret /run/secrets/outbound_worker_db_password (not committed)
-- This migration creates group role without login; dev bootstrap (dev-bootstrap/001_outbound_worker_dev_password.sql, gitignored) may set dev login role
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='outbound_worker') THEN
    CREATE ROLE outbound_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='outbound_worker_login') THEN
    CREATE ROLE outbound_worker_login WITH LOGIN;
  END IF;
END $$;
-- Login role inherits group privileges; production password via Docker secret /run/secrets/outbound_worker_db_password
GRANT outbound_worker TO outbound_worker_login;
GRANT CONNECT ON DATABASE byos TO outbound_worker;
GRANT USAGE ON SCHEMA public TO outbound_worker;
GRANT USAGE ON SEQUENCE outbound_message_seq, mailbox_message_seq TO outbound_worker;
GRANT SELECT, INSERT, UPDATE ON outbound_queue TO outbound_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON outbound_reservations TO outbound_worker;
GRANT SELECT, INSERT ON delivery_log TO outbound_worker;
-- Narrow domain access: only columns needed for routing/DKIM (no verification_token, dkim_public_key if not needed)
GRANT SELECT (id, org_id, name, dkim_selector, dkim_private_key_enc) ON TABLE domains TO outbound_worker;
-- Only non-secret columns on mailboxes (no mailbox_sk_wrapped, mailbox_pk, root_secret_id)
GRANT SELECT (id, org_id, user_id, domain_id, local_part, mode, mailbox_sk_version, is_active, created_at, updated_at) ON TABLE mailboxes TO outbound_worker;
-- Explicitly deny access to sensitive tables/columns
REVOKE ALL ON TABLE root_secrets FROM outbound_worker;
REVOKE ALL ON TABLE message_metadata FROM outbound_worker;
REVOKE ALL ON TABLE device_mailbox_access FROM outbound_worker;
REVOKE ALL ON TABLE org_recovery_principals FROM outbound_worker;
REVOKE ALL ON TABLE storage_connections FROM outbound_worker;
