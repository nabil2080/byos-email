# Operational Runbook: Idempotency Management and Retry Exhaustion

## 1. Overview
This runbook guides operators on managing request-bound idempotency retention, maintaining index health, and resolving retry-exhausted messages (`manual_retry_count >= max_manual_retries`).

---

## 2. Idempotency Key Retention & Cleanup Policy

### Retention Architecture
- Operator mutations in Support CRM / Admin API record a reservation in table `delivery_operator_idempotency`.
- Each record has an expiration timestamp: `expires_at = clock_timestamp() + interval '24 hours'`.
- Status transitions: `in_progress` during active API execution, updated to `completed` upon transaction commit.
- Index `idx_delivery_operator_idempotency_expires` enables efficient cleanup sweeps without table scans.

### Scheduled Pruning Sweep
To purge expired idempotency reservations without touching audit records:
```sql
BEGIN;
DELETE FROM public.delivery_operator_idempotency
WHERE expires_at < clock_timestamp()
  AND status = 'completed';
COMMIT;
```
*Note: In-progress reservations must never be cleaned up before expiration. Foreign key constraints on `delivery_operator_idempotency` reference `outbound_delivery_operator_audit(id)`, but deletion from idempotency cache does NOT cascade to or delete audit log entries. The audit ledger remains permanently immutable under trigger `trg_prevent_delivery_audit_modification`.*

### Transaction Isolation Rule
Cleanup operations must be executed in their own dedicated transaction block. Never bundle cleanup deletes with application queue mutations in the same transaction, as constraint violations on application tables would cause transactional rollback of the cleanup.

### Vacuum and Index Maintenance
Run periodic vacuuming:
```sql
VACUUM (ANALYZE) public.delivery_operator_idempotency;
```

---

## 3. Investigating Retry Exhaustion

### Detection
When a message reaches `manual_retry_count >= max_manual_retries` (typically 1 for standard support agents, 2 for administrators), any further retransmission authorization is rejected with HTTP 409:
`"manual retry limit reached for this message (max 1 for standard agents, 2 for admins)"`

The database check constraint `chk_outbound_queue_manual_retry_bounds` guarantees that `manual_retry_count` can never exceed `max_manual_retries`.

### Investigation Steps
1. Review the operator audit log in Support CRM for previous retry attempts:
   - Identify who authorized previous retries and what justification was provided.
   - Inspect delivery logs to see why repeated attempts failed (e.g. repeated remote firewall drops, invalid SPF/DKIM, recipient mailbox full).
2. If the recipient domain persistently resets connections:
   - Verify sender domain DKIM alignment and IP reputation on public blocklists.
   - Escalate to network/infrastructure engineering.
3. If delivery is determined impossible:
   - Mark as `resolve_bounced` with diagnostic justification to notify the sender.
