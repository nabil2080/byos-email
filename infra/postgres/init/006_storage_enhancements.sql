-- BYOS Storage Architecture (Section 9) - Local-First
-- Enhances storage_connections for multi-provider, config JSONB, status, metrics

-- Add provider column (canonical) if not exists; sync from provider_type for backward compat
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS provider TEXT;
UPDATE storage_connections SET provider = provider_type WHERE provider IS NULL;
-- Ensure provider has default and check
ALTER TABLE storage_connections ALTER COLUMN provider SET DEFAULT 'minio';
-- Add check constraint if not exists (use DO block to avoid duplicate) — only minimal providers, no real google_drive yet
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_connections_provider_check') THEN
    ALTER TABLE storage_connections ADD CONSTRAINT storage_connections_provider_check CHECK (provider IN ('minio','s3','google_drive_mock'));
  END IF;
END $$;

-- Config JSONB for provider-specific settings
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
-- For existing rows, populate config from legacy columns
UPDATE storage_connections SET config = jsonb_build_object(
  'endpoint', COALESCE(endpoint, ''),
  'bucket', COALESCE(bucket_name, ''),
  'region', COALESCE(region, ''),
  'provider', COALESCE(provider, provider_type)
) WHERE config = '{}' AND bucket_name IS NOT NULL;

-- Status, health, metrics
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','error','deleted'));
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS last_checked TIMESTAMPTZ;
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS used_bytes BIGINT NOT NULL DEFAULT 0;
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT false;

-- Optional direct mailbox link for faster lookup (nullable, for index requirement)
ALTER TABLE storage_connections ADD COLUMN IF NOT EXISTS mailbox_id UUID REFERENCES mailboxes(id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_storage_connections_mailbox_id ON storage_connections(mailbox_id) WHERE mailbox_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_storage_connections_org ON storage_connections(org_id);
CREATE INDEX IF NOT EXISTS idx_storage_connections_provider ON storage_connections(provider);

-- Ensure default MinIO connection exists for local dev (idempotent)
-- This will be created by API auto-create as well, but we seed a placeholder org for dev if needed
-- No hard seed here to avoid FK issues; API will auto-create on first mailbox.

-- Grants: keep least privilege — storage_connections is NOT for outbound_worker
-- storage-worker uses byos superuser (not outbound_worker_login), so no extra grant needed for outbound_worker
-- Explicitly ensure outbound_worker cannot read storage (defense)
REVOKE ALL ON TABLE storage_connections FROM outbound_worker;
REVOKE ALL ON TABLE mailbox_storage FROM outbound_worker;
-- Optional: grant to dedicated storage_worker role if it exists (future)
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='storage_worker') THEN
    GRANT SELECT ON storage_connections TO storage_worker;
    GRANT SELECT ON mailbox_storage TO storage_worker;
  END IF;
END $$;
