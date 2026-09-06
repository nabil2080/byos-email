CREATE TABLE IF NOT EXISTS storage_migrations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              uuid NOT NULL REFERENCES organizations(id),
    source_connection_id uuid NOT NULL REFERENCES storage_connections(id),
    target_provider     text NOT NULL,
    target_config_enc   text NOT NULL,
    target_bucket_name  text NOT NULL DEFAULT '',
    object_prefix       text NOT NULL,
    status              text NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending','running','completed','failed')),
    objects_copied      integer NOT NULL DEFAULT 0,
    error_code          text,
    created_by          uuid NOT NULL REFERENCES users(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz
);

CREATE INDEX IF NOT EXISTS idx_storage_migrations_org
  ON storage_migrations(org_id, created_at DESC);

ALTER TABLE storage_migrations ADD COLUMN IF NOT EXISTS target_connection_id uuid REFERENCES storage_connections(id);
ALTER TABLE storage_migrations ADD COLUMN IF NOT EXISTS cutover_applied boolean NOT NULL DEFAULT false;
