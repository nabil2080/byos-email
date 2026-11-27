-- 050_focused_inbox_categories.sql
-- Add category_override column to message_metadata for Focused Inbox
ALTER TABLE message_metadata
  ADD COLUMN IF NOT EXISTS category_override TEXT;

-- Constraint to known set of categories
ALTER TABLE message_metadata
  DROP CONSTRAINT IF EXISTS message_metadata_category_check;

ALTER TABLE message_metadata
  ADD CONSTRAINT message_metadata_category_check
  CHECK (category_override IS NULL OR category_override IN
    ('primary', 'notifications', 'newsletters', 'social'));

-- Extend mail_rules action_type check to allow 'category' action
ALTER TABLE mail_rules
  DROP CONSTRAINT IF EXISTS check_mail_rules_action;

ALTER TABLE mail_rules
  ADD CONSTRAINT check_mail_rules_action
  CHECK (action_type IN ('move', 'label', 'mark_read', 'delete', 'category'));

-- Add action_category column to mail_rules
ALTER TABLE mail_rules
  ADD COLUMN IF NOT EXISTS action_category TEXT;

-- Constraint on mail_rules action_category
ALTER TABLE mail_rules
  DROP CONSTRAINT IF EXISTS check_mail_rules_category;

ALTER TABLE mail_rules
  ADD CONSTRAINT check_mail_rules_category
  CHECK (action_category IS NULL OR action_category IN
    ('primary', 'notifications', 'newsletters', 'social'));
