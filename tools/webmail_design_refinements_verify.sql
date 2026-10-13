-- tools/webmail_design_refinements_verify.sql
-- Verification script for Webmail design refinements (Migration 053 profile_photos)

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'mailboxes' AND column_name IN ('profile_photo_ref', 'profile_photo_updated_at')
ORDER BY column_name;
