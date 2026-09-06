-- =============================================
-- BYOS V5.3 Schema
-- Dependency order: sequences → tables → FKs → indexes
-- =============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Sequences
CREATE SEQUENCE IF NOT EXISTS mailbox_message_seq START WITH 1 INCREMENT BY 1;

-- 2. Organizations
CREATE TABLE organizations (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        text NOT NULL,
    org_recovery_pk             bytea NOT NULL,
    default_storage_connection_id uuid,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- 3. Users
CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id),
    email           text NOT NULL UNIQUE,
    display_name    text,
    password_hash   text NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 4. Domains
CREATE TABLE domains (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id),
    name            text NOT NULL UNIQUE,
    is_verified     boolean NOT NULL DEFAULT false,
    verification_token text,
    dkim_selector   text NOT NULL DEFAULT 'byos',
    dkim_private_key_enc bytea,
    dkim_public_key  text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 5. Root secrets (one per mailbox, versioned rows)
CREATE TABLE root_secrets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version         integer NOT NULL DEFAULT 1,
    root_secret_wrapped bytea,
    created_at      timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz
);

-- 6. Mailboxes
CREATE TABLE mailboxes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id),
    user_id         uuid REFERENCES users(id),
    domain_id       uuid NOT NULL REFERENCES domains(id),
    local_part      text NOT NULL,
    mode            text NOT NULL CHECK (mode IN ('org_managed', 'private')),
    root_secret_id  uuid NOT NULL,
    mailbox_sk_wrapped     bytea NOT NULL,
    mailbox_sk_version     integer NOT NULL DEFAULT 1,
    mailbox_pk     bytea NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(domain_id, local_part)
);

-- 7. Aliases
CREATE TABLE aliases (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id),
    local_part      text NOT NULL,
    domain_id       uuid NOT NULL REFERENCES domains(id),
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(local_part, domain_id)
);

-- 8. Devices
CREATE TABLE devices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    device_name     text NOT NULL,
    device_pk       bytea NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 9. Device-mailbox access
CREATE TABLE device_mailbox_access (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id       uuid NOT NULL REFERENCES devices(id),
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id),
    wrapped_root_secret bytea NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    granted_at      timestamptz NOT NULL DEFAULT now(),
    revoked_at      timestamptz,
    UNIQUE(device_id, mailbox_id)
);

-- 10. Org recovery principals (org-level)
CREATE TABLE org_recovery_principals (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    org_id          uuid NOT NULL REFERENCES organizations(id),
    principal_name  text NOT NULL,
    kdf_algorithm   text NOT NULL DEFAULT 'argon2id',
    kdf_version     integer NOT NULL DEFAULT 1,
    kdf_salt        bytea NOT NULL,
    kdf_memory      integer NOT NULL,
    kdf_iterations  integer NOT NULL,
    kdf_parallelism integer NOT NULL,
    org_recovery_sk_encrypted bytea NOT NULL,
    org_recovery_pk bytea NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    deactivated_at  timestamptz
);

-- 11. Storage connections
CREATE TABLE storage_connections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id),
    provider_type   text NOT NULL,
    bucket_name     text NOT NULL,
    endpoint        text,
    region          text,
    credentials_enc bytea NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 12. Org default storage FK
ALTER TABLE organizations ADD CONSTRAINT fk_org_default_storage
    FOREIGN KEY (default_storage_connection_id) REFERENCES storage_connections(id);

-- 13. Mailbox storage mapping
CREATE TABLE mailbox_storage (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id          uuid NOT NULL REFERENCES mailboxes(id),
    storage_connection_id uuid NOT NULL REFERENCES storage_connections(id),
    object_prefix       text NOT NULL,
    status              text NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'migrating', 'archived')),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE(mailbox_id)
);

-- 14. Message metadata
CREATE TABLE message_metadata (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id),
    domain_id       uuid NOT NULL REFERENCES domains(id),
    message_seq     bigint NOT NULL DEFAULT nextval('mailbox_message_seq'),
    direction       text NOT NULL CHECK (direction IN ('received', 'sent')),
    delivery_identity bytea NOT NULL,
    sender          text NOT NULL,
    recipients      text[] NOT NULL,
    has_attachments boolean NOT NULL DEFAULT false,
    attachment_count integer NOT NULL DEFAULT 0,
    storage_object_id text NOT NULL,
    content_key_hpke_wrapped bytea NOT NULL,
    mailbox_sk_version integer NOT NULL,
    encryption_version integer NOT NULL DEFAULT 1,
    encryption_iv   bytea NOT NULL,
    aad_version     smallint NOT NULL DEFAULT 1,
    bundle_hash     bytea NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    status          text NOT NULL DEFAULT 'received'
      CHECK (status IN ('received', 'sent', 'draft')),
    UNIQUE(mailbox_id, message_seq),
    UNIQUE(mailbox_id, delivery_identity)
);

-- 15. Search index
CREATE TABLE search_index (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id),
    message_seq     bigint NOT NULL,
    token_hash      bytea NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(mailbox_id, message_seq, token_hash)
);

-- 16. Scheduled messages
CREATE TABLE scheduled_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id),
    domain_id       uuid NOT NULL REFERENCES domains(id),
    recipient       text NOT NULL,
    encrypted_message   bytea NOT NULL,
    send_token_hpke_wrapped bytea NOT NULL,
    send_token_hash bytea NOT NULL,
    scheduled_at    timestamptz NOT NULL,
    status          text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'executed', 'cancelled', 'expired', 'failed')),
    delivery_id     uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    expires_at      timestamptz NOT NULL
);

-- 17. Outbound queue
CREATE TABLE outbound_queue (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id     uuid NOT NULL UNIQUE,
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id),
    domain_id       uuid NOT NULL REFERENCES domains(id),
    recipient       text NOT NULL,
    encrypted_message   bytea NOT NULL,
    send_token_hpke_wrapped bytea NOT NULL,
    status          text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'accepted_by_mta', 'delivered', 'bounced', 'expired')),
    attempts        integer NOT NULL DEFAULT 0,
    max_attempts    integer NOT NULL DEFAULT 5,
    last_attempt_at timestamptz,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,
    failed_at       timestamptz,
    expires_at      timestamptz NOT NULL
);

-- 18. Auto-reply rules
CREATE TABLE auto_reply_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id      uuid NOT NULL REFERENCES mailboxes(id),
    is_active       boolean NOT NULL DEFAULT true,
    subject_template    text NOT NULL,
    body_template       text NOT NULL,
    reply_all           boolean NOT NULL DEFAULT false,
    allowed_senders     text[],
    blocked_senders     text[],
    start_time          timestamptz,
    end_time            timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 17. Drafts
CREATE TABLE drafts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id          uuid NOT NULL REFERENCES mailboxes(id),
    subject             text,
    encrypted_envelope  bytea NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 18. Delivery log
CREATE TABLE delivery_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id     uuid NOT NULL,
    direction       text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    mailbox_id      uuid REFERENCES mailboxes(id),
    domain_id       uuid REFERENCES domains(id),
    sender          text,
    recipient       text,
    status          text NOT NULL,
    smtp_code       integer,
    smtp_message    text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- 20. Audit log
CREATE TABLE audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          uuid NOT NULL REFERENCES organizations(id),
    user_id         uuid REFERENCES users(id),
    action          text NOT NULL,
    resource_type   text NOT NULL,
    resource_id     uuid,
    details         jsonb,
    ip_address      inet,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- Indexes
-- =============================================
CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_mailboxes_org ON mailboxes(org_id);
CREATE INDEX idx_mailboxes_user ON mailboxes(user_id);
CREATE INDEX idx_mailboxes_domain ON mailboxes(domain_id);
CREATE INDEX idx_aliases_mailbox ON aliases(mailbox_id);
CREATE INDEX idx_devices_user ON devices(user_id);
CREATE INDEX idx_device_mailbox_access_device ON device_mailbox_access(device_id);
CREATE INDEX idx_device_mailbox_access_mailbox ON device_mailbox_access(mailbox_id);
CREATE INDEX idx_org_recovery_principals_user ON org_recovery_principals(user_id);
CREATE INDEX idx_org_recovery_principals_org ON org_recovery_principals(org_id);
CREATE INDEX idx_mailbox_storage_mailbox ON mailbox_storage(mailbox_id);
CREATE INDEX idx_message_metadata_mailbox ON message_metadata(mailbox_id);
CREATE INDEX idx_message_metadata_received ON message_metadata(mailbox_id, received_at);
CREATE INDEX idx_message_metadata_identity ON message_metadata(mailbox_id, delivery_identity);
CREATE INDEX idx_search_index_mailbox ON search_index(mailbox_id);
CREATE INDEX idx_search_index_token ON search_index(token_hash);
CREATE INDEX idx_scheduled_messages_status ON scheduled_messages(status, scheduled_at);
CREATE INDEX idx_scheduled_messages_delivery ON scheduled_messages(delivery_id);
CREATE INDEX idx_outbound_queue_status ON outbound_queue(status, next_attempt_at);
CREATE INDEX idx_outbound_queue_delivery ON outbound_queue(delivery_id);
CREATE INDEX idx_drafts_mailbox ON drafts(mailbox_id);
CREATE INDEX idx_delivery_log_delivery ON delivery_log(delivery_id);
CREATE INDEX idx_audit_log_org ON audit_log(org_id, created_at);
