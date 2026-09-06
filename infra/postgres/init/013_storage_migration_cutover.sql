ALTER TABLE storage_migrations ADD COLUMN IF NOT EXISTS target_bucket_name text NOT NULL DEFAULT '';
ALTER TABLE storage_migrations ADD COLUMN IF NOT EXISTS target_connection_id uuid REFERENCES storage_connections(id);
ALTER TABLE storage_migrations ADD COLUMN IF NOT EXISTS cutover_applied boolean NOT NULL DEFAULT false;
