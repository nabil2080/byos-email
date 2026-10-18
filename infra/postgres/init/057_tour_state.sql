-- Migration 057: Add tours_seen JSONB to users table for product tour state persistence
-- Stores per-tour records (e.g. control_plane_v1, webmail_v1)
-- Format: {"<tour_id>": {"completed_at": string|null, "skipped_at": string|null, "last_step": int}}

ALTER TABLE users ADD COLUMN IF NOT EXISTS tours_seen JSONB NOT NULL DEFAULT '{}'::jsonb;
