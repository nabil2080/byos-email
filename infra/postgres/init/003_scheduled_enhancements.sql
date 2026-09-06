-- V5.3 Scheduled Sending enhancements
-- Adds reservation linkage and AAD persistence to scheduled_messages
-- Keeps outbound_message_seq as single source for outbox_seq (allocated via prepare)

-- Extend scheduled_messages with V5.3 AAD / reservation linkage
ALTER TABLE scheduled_messages
  ADD COLUMN IF NOT EXISTS reservation_id uuid REFERENCES outbound_reservations(reservation_id),
  ADD COLUMN IF NOT EXISTS outbox_seq BIGINT,
  ADD COLUMN IF NOT EXISTS encryption_version INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS aad_version SMALLINT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS encryption_iv BYTEA;

-- Ensure delivery_id uniqueness (scheduled_messages.delivery_id was not UNIQUE in 001_init)
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_messages_delivery_unique ON scheduled_messages(delivery_id);
-- Exactly one scheduled delivery per reservation (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_messages_reservation ON scheduled_messages(reservation_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_outbox_seq ON scheduled_messages(mailbox_id, outbox_seq);
-- Scheduler needs pending+scheduled_at lookup efficiently
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_pending_at ON scheduled_messages(status, scheduled_at) WHERE status='pending';

-- Least privilege: outbound_worker needs to poll/promote scheduled_messages
GRANT SELECT, INSERT, UPDATE ON scheduled_messages TO outbound_worker;
GRANT USAGE ON SEQUENCE outbound_message_seq TO outbound_worker;
-- Explicitly keep denies from 002 (redundant safety)
REVOKE ALL ON TABLE root_secrets FROM outbound_worker;
REVOKE ALL ON TABLE message_metadata FROM outbound_worker;
REVOKE ALL ON TABLE device_mailbox_access FROM outbound_worker;
REVOKE ALL ON TABLE org_recovery_principals FROM outbound_worker;
REVOKE ALL ON TABLE storage_connections FROM outbound_worker;
