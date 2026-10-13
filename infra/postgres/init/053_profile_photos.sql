-- Migration 053: Profile Photos
-- Adds profile_photo_ref and profile_photo_updated_at to mailboxes table

ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS profile_photo_ref TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_updated_at TIMESTAMPTZ;
