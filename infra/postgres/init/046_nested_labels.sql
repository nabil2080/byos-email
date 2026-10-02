-- 046_nested_labels.sql
-- Adds parent_label_id and sort_order to mailbox_labels for hierarchical/nested labels.

ALTER TABLE mailbox_labels
  ADD COLUMN IF NOT EXISTS parent_label_id UUID REFERENCES mailbox_labels(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_mailbox_labels_parent
  ON mailbox_labels (mailbox_id, parent_label_id);

CREATE INDEX IF NOT EXISTS idx_mailbox_labels_sort
  ON mailbox_labels (mailbox_id, parent_label_id, sort_order);

-- Drop previous whole-mailbox unique index so sibling uniqueness applies instead
DROP INDEX IF EXISTS idx_mailbox_labels_unique_name;

-- Sibling uniqueness: A label name is unique among its siblings under the same parent
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_labels_sibling_name
  ON mailbox_labels (mailbox_id, COALESCE(parent_label_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name::text));
