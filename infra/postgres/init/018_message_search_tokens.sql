-- Section 16: Local Search & Search Privacy
-- Stores client-computed keyed search tokens per mailbox.
-- The server never sees plaintext subject terms — only opaque 32-byte tokens.
-- Accepted V1 leakage: token equality (same word → same token across messages in same mailbox),
-- access patterns (which messages are fetched after a search), result counts, timing.

CREATE TABLE IF NOT EXISTS search_tokens (
    id          uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    mailbox_id  uuid        NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    message_id  text        NOT NULL,  -- opaque reference to the stored message object key
    token       bytea       NOT NULL,  -- 32-byte HKDF-derived keyed token (client-computed)
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by mailbox + token (the primary search query path)
CREATE INDEX IF NOT EXISTS idx_search_tokens_mailbox_token
    ON search_tokens (mailbox_id, token);

-- Allow efficient deletion when a message is removed
CREATE INDEX IF NOT EXISTS idx_search_tokens_mailbox_message
    ON search_tokens (mailbox_id, message_id);

-- Prevent duplicate token registrations for the same message
CREATE UNIQUE INDEX IF NOT EXISTS idx_search_tokens_unique
    ON search_tokens (mailbox_id, message_id, token);
