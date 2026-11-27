-- Section 4 / Section 30: Auto-reply unique mailbox constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'auto_reply_rules_mailbox_id_key'
    ) THEN
        ALTER TABLE auto_reply_rules ADD CONSTRAINT auto_reply_rules_mailbox_id_key UNIQUE (mailbox_id);
    END IF;
END $$;
