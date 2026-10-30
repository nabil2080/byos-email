-- Staged Historical-Key Reactivation Verification Script
-- Run against disposable database: byos_recovery_disposable_20261024

\echo '=== Mailbox Key Reactivations Table Schema ==='
\d mailbox_key_reactivations

\echo '=== Active vs Historical Key Envelopes in Mailboxes ==='
SELECT id, local_part, is_active, 
       wrapped_sk_user IS NOT NULL AS has_active_sk,
       previous_wrapped_sk_user IS NOT NULL AS has_historical_sk,
       previous_key_archived_at
FROM mailboxes
ORDER BY created_at DESC
LIMIT 5;

\echo '=== Pending & Finalized Staged Key Reactivations ==='
SELECT id, mailbox_id, user_id, status, created_at, expires_at, finalized_at, rolled_back_at, rollback_reason
FROM mailbox_key_reactivations
ORDER BY created_at DESC
LIMIT 5;
