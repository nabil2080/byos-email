-- Seed demo organization for start_dev.ps1 login
INSERT INTO organizations (id, name, org_recovery_pk) 
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Demo Org', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64')) 
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, org_id, email, display_name, password_hash, is_active) 
VALUES ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin@demo.local', 'Demo Admin', '$2a$10$cOrfAvsNZWa7ZDXmw0swd.XNWUnrqbQSOnMzWwQCuUiDZZlTJdTaO', true) 
ON CONFLICT (id) DO NOTHING;

INSERT INTO domains (id, org_id, name, is_verified, dkim_selector, dkim_private_key_enc, dkim_public_key) 
VALUES ('d0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'demo.local', true, 'byos', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 'v=DKIM1; k=rsa; p=dummy') 
ON CONFLICT (id) DO NOTHING;

INSERT INTO root_secrets (id, version, root_secret_wrapped) 
VALUES ('22222222-2222-2222-2222-222222222222', 1, NULL) 
ON CONFLICT (id) DO NOTHING;

INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_sk_version, mailbox_pk, is_active) 
VALUES ('33333333-3333-3333-3333-333333333333', 'dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'admin', 'private', '22222222-2222-2222-2222-222222222222', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 1, decode('+0Zlg4kUR1C9t3GJJ2dwvwJ6VG2nyGvQtiwfEzElLTs=', 'base64'), true) 
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage_connections (id, org_id, provider, provider_type, bucket_name, endpoint, credentials_enc, config, encrypted, status, is_active) 
VALUES ('44444444-4444-4444-4444-444444444444', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'minio', 'minio', 'byos-mailbox', 'minio:9000', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), '{"endpoint": "minio:9000", "bucket": "byos-mailbox", "access_key_id": "minioadmin", "secret_access_key": "minioadmin"}', true, 'active', true) 
ON CONFLICT (id) DO NOTHING;

INSERT INTO mailbox_storage (id, mailbox_id, storage_connection_id, object_prefix, status) 
VALUES ('55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'mailboxes/demo', 'active') 
ON CONFLICT (id) DO NOTHING;
