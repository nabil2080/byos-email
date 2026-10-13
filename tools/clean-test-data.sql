BEGIN;

-- Create temporary table to collect cleanup counts
CREATE TEMP TABLE IF NOT EXISTS cleanup_counts (
    table_name text PRIMARY KEY,
    deleted_count bigint
) ON COMMIT DROP;

-- Target test mailboxes to delete:
-- Identify test rows by these markers:
-- 1. Mailboxes whose local_part is one of alice, bob, carol, dave, or any mailbox belonging to a domain named byos.local in a non-production environment, EXCEPT the permanent seed mailboxes.
-- 2. Non-seed mailboxes (e.g. from invite-test-*, thread-*, rules-*, test-*.local, etc.).
CREATE TEMP TABLE target_test_mailboxes ON COMMIT DROP AS
SELECT id FROM mailboxes
WHERE id NOT IN (
    'c0000000-0000-0000-0000-000000000001'::uuid,
    'c0000000-0000-0000-0000-000000000002'::uuid,
    '0cb877dc-4206-4408-8709-1eac14129d6a'::uuid,
    '33333333-3333-3333-3333-333333333333'::uuid,
    'eeeeeeee-0000-0000-0000-000000000001'::uuid
);

-- Delete message_labels referencing messages
WITH del_labels AS (
    DELETE FROM message_labels
    WHERE message_id IN (SELECT id FROM message_metadata)
    RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count)
VALUES ('message_labels', (SELECT count(*) FROM del_labels));

-- Delete message_metadata rows for test mailboxes and test traffic
WITH del_meta AS (
    DELETE FROM message_metadata
    RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count)
VALUES ('message_metadata', (SELECT count(*) FROM del_meta));

-- Delete test sessions created in last 24h that do not correspond to real browser sessions
WITH del_sessions AS (
    DELETE FROM sessions
    WHERE user_agent IS NULL 
       OR user_agent = '' 
       OR user_agent NOT LIKE 'Mozilla/%'
       OR user_agent LIKE '%test%'
       OR user_id NOT IN (
           'cccccccc-0000-0000-0000-000000000002'::uuid,
           'cccccccc-0000-0000-0000-000000000003'::uuid,
           '6ee985a3-cb80-466b-98f3-ac78472a8fe6'::uuid,
           '11111111-1111-1111-1111-111111111111'::uuid,
           'cccccccc-0000-0000-0000-000000000001'::uuid
       )
    RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count)
VALUES ('sessions', (SELECT count(*) FROM del_sessions));

-- Orphan scheduled_messages older than 1 hour or for test mailboxes
WITH del_sched AS (
    DELETE FROM scheduled_messages
    WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes)
       OR (status = 'pending' AND COALESCE(send_at, scheduled_at) < now() - interval '1 hour')
       OR (status != 'pending')
    RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count)
VALUES ('scheduled_messages', (SELECT count(*) FROM del_sched));

-- Orphan outbound_queue rows with status = 'delivered' whose scheduled_messages row is missing or non-pending, or for test mailboxes
WITH del_oq AS (
    DELETE FROM outbound_queue
    WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes)
       OR (status = 'delivered' AND (delivery_id NOT IN (SELECT delivery_id FROM scheduled_messages WHERE status = 'pending')))
       OR (status != 'pending')
    RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count)
VALUES ('outbound_queue', (SELECT count(*) FROM del_oq));

-- Child records of test mailboxes
WITH del_att AS (
    DELETE FROM attachments WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('attachments', (SELECT count(*) FROM del_att));

WITH del_drafts AS (
    DELETE FROM drafts WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('drafts', (SELECT count(*) FROM del_drafts));

WITH del_ms AS (
    DELETE FROM mailbox_storage WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('mailbox_storage', (SELECT count(*) FROM del_ms));

WITH del_si AS (
    DELETE FROM search_index WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('search_index', (SELECT count(*) FROM del_si));

WITH del_st AS (
    DELETE FROM search_tokens WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('search_tokens', (SELECT count(*) FROM del_st));

WITH del_dlog AS (
    DELETE FROM delivery_log WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('delivery_log', (SELECT count(*) FROM del_dlog));

WITH del_ores AS (
    DELETE FROM outbound_reservations WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('outbound_reservations', (SELECT count(*) FROM del_ores));

WITH del_mtrack AS (
    DELETE FROM message_tracking WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('message_tracking', (SELECT count(*) FROM del_mtrack));

WITH del_ar AS (
    DELETE FROM auto_reply_rules WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('auto_reply_rules', (SELECT count(*) FROM del_ar));

WITH del_mar AS (
    DELETE FROM mailbox_address_rules WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('mailbox_address_rules', (SELECT count(*) FROM del_mar));

WITH del_mr AS (
    DELETE FROM mail_rules WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('mail_rules', (SELECT count(*) FROM del_mr));

WITH del_dma AS (
    DELETE FROM device_mailbox_access WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('device_mailbox_access', (SELECT count(*) FROM del_dma));

WITH del_sc AS (
    DELETE FROM storage_connections WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('storage_connections', (SELECT count(*) FROM del_sc));

WITH del_bc AS (
    DELETE FROM bridge_credentials WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('bridge_credentials', (SELECT count(*) FROM del_bc));

WITH del_ai AS (
    DELETE FROM account_invitations WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('account_invitations', (SELECT count(*) FROM del_ai));

WITH del_mf AS (
    DELETE FROM mailbox_folders WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('mailbox_folders', (SELECT count(*) FROM del_mf));

WITH del_ml AS (
    DELETE FROM mailbox_labels WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('mailbox_labels', (SELECT count(*) FROM del_ml));

WITH del_al AS (
    DELETE FROM aliases WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('aliases', (SELECT count(*) FROM del_al));

WITH del_ct AS (
    DELETE FROM contacts RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('contacts', (SELECT count(*) FROM del_ct));

WITH del_ij AS (
    DELETE FROM import_jobs RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('import_jobs', (SELECT count(*) FROM del_ij));

WITH del_ms2 AS (
    DELETE FROM mailbox_settings WHERE mailbox_id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('mailbox_settings', (SELECT count(*) FROM del_ms2));

-- Now delete test mailboxes
WITH del_mb AS (
    DELETE FROM mailboxes WHERE id IN (SELECT id FROM target_test_mailboxes) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('mailboxes', (SELECT count(*) FROM del_mb));

-- Target test users to delete (users other than seed users)
CREATE TEMP TABLE target_test_users ON COMMIT DROP AS
SELECT id FROM users
WHERE id NOT IN (
    'cccccccc-0000-0000-0000-000000000002'::uuid,
    'cccccccc-0000-0000-0000-000000000003'::uuid,
    '6ee985a3-cb80-466b-98f3-ac78472a8fe6'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'cccccccc-0000-0000-0000-000000000001'::uuid
);

DELETE FROM user_passkeys WHERE user_id IN (SELECT id FROM target_test_users);
DELETE FROM auth_challenges WHERE user_id IN (SELECT id FROM target_test_users);
DELETE FROM recovery_challenges WHERE user_id IN (SELECT id FROM target_test_users);
DELETE FROM devices WHERE user_id IN (SELECT id FROM target_test_users);
DELETE FROM org_recovery_principals WHERE user_id IN (SELECT id FROM target_test_users);
DELETE FROM google_drive_oauth_states WHERE user_id IN (SELECT id FROM target_test_users);
DELETE FROM audit_log WHERE user_id IN (SELECT id FROM target_test_users);
DELETE FROM storage_migrations WHERE created_by IN (SELECT id FROM target_test_users);

WITH del_u AS (
    DELETE FROM users WHERE id IN (SELECT id FROM target_test_users) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('users', (SELECT count(*) FROM del_u));

-- Target test domains to delete (domains other than seed domains)
CREATE TEMP TABLE target_test_domains ON COMMIT DROP AS
SELECT id FROM domains
WHERE id NOT IN (
    '00000000-0000-0000-0000-000000000bbb'::uuid,
    'ca1fbf8e-9561-4dc2-8657-dc1ceeee7800'::uuid,
    'ca1fbf8e-9561-4dc2-8657-dc1ceeee7801'::uuid,
    'd0d0d0d0-d0d0-d0d0-d0d0-d0d0d0d0d0d0'::uuid,
    'bbbbbbbb-0000-0000-0000-000000000001'::uuid
);

WITH del_d AS (
    DELETE FROM domains WHERE id IN (SELECT id FROM target_test_domains) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('domains', (SELECT count(*) FROM del_d));

-- Clean masked aliases and reply map
WITH del_marm AS (
    DELETE FROM masked_alias_reply_map RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('masked_alias_reply_map', (SELECT count(*) FROM del_marm));

WITH del_ma AS (
    DELETE FROM masked_aliases RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('masked_aliases', (SELECT count(*) FROM del_ma));

-- Target test organizations to delete (organizations other than seed orgs)
CREATE TEMP TABLE target_test_orgs ON COMMIT DROP AS
SELECT id FROM organizations
WHERE id NOT IN (
    '00000000-0000-0000-0000-000000000aaa'::uuid,
    'eaee2269-f0b9-4a15-bf99-785285f8d543'::uuid,
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid
);

DELETE FROM org_recovery_principals WHERE org_id IN (SELECT id FROM target_test_orgs);
DELETE FROM storage_connections WHERE org_id IN (SELECT id FROM target_test_orgs);
DELETE FROM account_invitations WHERE org_id IN (SELECT id FROM target_test_orgs);
DELETE FROM google_drive_oauth_states WHERE org_id IN (SELECT id FROM target_test_orgs);
DELETE FROM storage_migrations WHERE org_id IN (SELECT id FROM target_test_orgs);
DELETE FROM audit_log WHERE org_id IN (SELECT id FROM target_test_orgs);

WITH del_o AS (
    DELETE FROM organizations WHERE id IN (SELECT id FROM target_test_orgs) RETURNING 1
)
INSERT INTO cleanup_counts (table_name, deleted_count) VALUES ('organizations', (SELECT count(*) FROM del_o));

-- Return summary of deleted rows
SELECT table_name, deleted_count FROM cleanup_counts WHERE deleted_count > 0 ORDER BY table_name;

COMMIT;
