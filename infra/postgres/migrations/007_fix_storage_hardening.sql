-- Fix for 006 hardening: narrow provider check, revoke over-broad grants, no encryption logic
-- This is schema-only, no DEK needed

-- Narrow provider check: remove premature google_drive
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_connections_provider_check') THEN
    ALTER TABLE storage_connections DROP CONSTRAINT storage_connections_provider_check;
  END IF;
END $$;
ALTER TABLE storage_connections ADD CONSTRAINT storage_connections_provider_check CHECK (provider IN ('minio','s3','google_drive_mock'));

-- Revoke over-broad grants that 006 may have added
REVOKE ALL ON TABLE storage_connections FROM outbound_worker;
REVOKE ALL ON TABLE mailbox_storage FROM outbound_worker;

-- Ensure storage_connections remains readable by byos superuser (already) and future storage_worker role
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='storage_worker') THEN
    GRANT SELECT ON storage_connections TO storage_worker;
    GRANT SELECT ON mailbox_storage TO storage_worker;
  END IF;
END $$;
