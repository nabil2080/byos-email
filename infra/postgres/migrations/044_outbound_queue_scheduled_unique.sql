-- Migration 044: Ensure unique constraint on outbound_queue.delivery_id for idempotent scheduling promotions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'outbound_queue_delivery_id_key'
          AND conrelid = 'outbound_queue'::regclass
    ) THEN
        ALTER TABLE outbound_queue ADD CONSTRAINT outbound_queue_delivery_id_key UNIQUE (delivery_id);
    END IF;
END $$;
