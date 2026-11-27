DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'storage_connections_provider_check') THEN
    ALTER TABLE storage_connections DROP CONSTRAINT storage_connections_provider_check;
  END IF;
  ALTER TABLE storage_connections
    ADD CONSTRAINT storage_connections_provider_check
    CHECK (provider IN ('minio','s3','google_drive_mock','google_drive'));
END $$;
