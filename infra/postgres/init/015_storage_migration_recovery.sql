ALTER TABLE storage_migrations
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;

ALTER TABLE storage_migrations
  ADD COLUMN IF NOT EXISTS started_at timestamptz;
