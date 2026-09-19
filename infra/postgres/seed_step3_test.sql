-- Step 3 verification seed data
-- Test mailbox: test@byos.local
-- X25519 keypair (TEST ONLY - do not use in production)
--   PK: 23a8bc085eceaaaccec9eabba0ebd82c2d97dbd67c207436442b9e2e8916d277
--   SK: stored in infra/secrets/step3_test_mailbox_sk.hex (gitignored)
--
-- Run once against the running postgres container:
--   docker exec -i byos-postgres psql -U byos -d byos < infra/postgres/seed_step3_test.sql

BEGIN;

INSERT INTO organizations (id, name, org_recovery_pk)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001'::uuid,
        'Test Org',
        '\x00'::bytea)
ON CONFLICT (id) DO NOTHING;

INSERT INTO domains (id, org_id, name, is_verified)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001'::uuid,
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
        'byos.local',
        true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, org_id, email, display_name, password_hash)
VALUES ('cccccccc-0000-0000-0000-000000000001'::uuid,
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
        'test@byos.local',
        'Test User',
        'unused-test-hash')
ON CONFLICT (id) DO NOTHING;

INSERT INTO root_secrets (id)
VALUES ('dddddddd-0000-0000-0000-000000000001'::uuid)
ON CONFLICT (id) DO NOTHING;

-- mailbox_pk = 32-byte raw X25519 public key
INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode,
                       root_secret_id, mailbox_sk_wrapped, mailbox_sk_version, mailbox_pk)
VALUES ('eeeeeeee-0000-0000-0000-000000000001'::uuid,
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
        'cccccccc-0000-0000-0000-000000000001'::uuid,
        'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
        'test',
        'org_managed',
        'dddddddd-0000-0000-0000-000000000001'::uuid,
        '\x00'::bytea,
        1,
        '\x23a8bc085eceaaaccec9eabba0ebd82c2d97dbd67c207436442b9e2e8916d277'::bytea)
ON CONFLICT (id) DO NOTHING;

-- MinIO default storage connection (uses worker's built-in MinIO config)
INSERT INTO storage_connections (id, org_id, provider_type, bucket_name,
                                  endpoint, credentials_enc)
VALUES ('ffffffff-0000-0000-0000-000000000001'::uuid,
        'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
        's3',
        'byos-mailbox',
        'minio:9000',
        '\x00'::bytea)
ON CONFLICT (id) DO NOTHING;

-- mailbox → storage mapping (object_prefix = mailboxes/<mailbox-id>)
INSERT INTO mailbox_storage (mailbox_id, storage_connection_id, object_prefix, status)
VALUES ('eeeeeeee-0000-0000-0000-000000000001'::uuid,
        'ffffffff-0000-0000-0000-000000000001'::uuid,
        'mailboxes/eeeeeeee-0000-0000-0000-000000000001',
        'active')
ON CONFLICT (mailbox_id) DO NOTHING;

COMMIT;

-- Verify
SELECT 'mailbox' AS entity, id::text, local_part || '@' || (SELECT name FROM domains WHERE id = domain_id) AS address
FROM mailboxes WHERE id = 'eeeeeeee-0000-0000-0000-000000000001'::uuid;
