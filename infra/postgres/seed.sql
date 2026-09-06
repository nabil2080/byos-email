-- Seed data for dev test mailbox
INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('eaee2269-f0b9-4a15-bf99-785285f8d543', 'Test Org', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64')) ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id, org_id, email, display_name, password_hash, is_active) VALUES ('6ee985a3-cb80-466b-98f3-ac78472a8fe6', 'eaee2269-f0b9-4a15-bf99-785285f8d543', 'test@byos.local', 'Test User', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO domains (id, org_id, name, is_verified, dkim_selector, dkim_private_key_enc, dkim_public_key) VALUES ('ca1fbf8e-9561-4dc2-8657-dc1ceeee7800', 'eaee2269-f0b9-4a15-bf99-785285f8d543', 'byos.local', true, 'byos', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 'v=DKIM1; k=rsa; p=dummy') ON CONFLICT (id) DO NOTHING;
INSERT INTO root_secrets (id, version, root_secret_wrapped) VALUES ('b2047e85-17f6-4edc-b945-4c107d9b698c', 1, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_sk_version, mailbox_pk, is_active) VALUES ('0cb877dc-4206-4408-8709-1eac14129d6a', 'eaee2269-f0b9-4a15-bf99-785285f8d543', '6ee985a3-cb80-466b-98f3-ac78472a8fe6', 'ca1fbf8e-9561-4dc2-8657-dc1ceeee7800', 'local', 'private', 'b2047e85-17f6-4edc-b945-4c107d9b698c', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 1, decode('+0Zlg4kUR1C9t3GJJ2dwvwJ6VG2nyGvQtiwfEzElLTs=', 'base64'), true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage_connections (id, org_id, provider_type, bucket_name, endpoint, credentials_enc, is_active) VALUES ('d0a3f3c1-4b5e-4f6a-8c7d-9e0f1a2b3c4d', 'eaee2269-f0b9-4a15-bf99-785285f8d543', 'minio', 'byos-mailbox', 'minio:9000', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), true) ON CONFLICT (id) DO NOTHING;
INSERT INTO mailbox_storage (id, mailbox_id, storage_connection_id, object_prefix, status) VALUES ('e1f2a3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b', '0cb877dc-4206-4408-8709-1eac14129d6a', 'd0a3f3c1-4b5e-4f6a-8c7d-9e0f1a2b3c4d', 'mailboxes/local', 'active') ON CONFLICT (id) DO NOTHING;
-- Ensure outbound_worker_login has dev password (for local dev only, not for production)
-- This is also in dev-bootstrap, but ensure it here for fresh DB
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='outbound_worker_login') THEN
    EXECUTE 'ALTER ROLE outbound_worker_login WITH LOGIN PASSWORD ''byos_outbound_worker_dev''';
  END IF;
END $$;
