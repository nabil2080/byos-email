# Operational Runbook: Queue Backlog, Multi-Worker Operations, and Unknown-Outcome Investigation

## 1. Overview
When an outbound delivery experiences network drops, TLS resets, or socket timeouts during or immediately following the SMTP `DATA` terminator (`CRLF.CRLF`), the outbound worker cannot determine whether the remote MTA accepted the message. To prevent duplicate retransmission, the system transitions the row into `status = 'outcome_unknown'`.

This runbook guides Support Leads and Delivery Operators on investigating and safely reconciling these quarantined messages, while documenting multi-worker concurrency and lease recovery behaviors.

---

## 2. Multi-Worker Concurrency & Lease Fencing

### Atomic Claiming
- Independent outbound worker instances query `outbound_queue` concurrently using `FOR UPDATE SKIP LOCKED`.
- Competing workers claim disjoint sets of messages; no message is ever double-claimed or double-delivered.

### Automatic Lease Expiration & Reclaiming
- If a worker crashes or becomes unresponsive while processing a message, its lease expires (`lease_expires_at <= now()`).
- Another active worker will automatically reclaim the message without human intervention, incrementing the attempt count, provided `attempts + 1 < max_attempts` and `smtp_phase` has not reached `terminator_in_flight` or `accepted_by_mta`.

### Post-250 Checkpoint Recovery
- If a worker receives an SMTP 250 response and writes the `accepted_by_mta` checkpoint to the database, but crashes before completing final post-delivery settlement:
  - Durable acceptance reconciliation settles the message cleanly as `delivered`.
  - The message is NEVER resent, preventing duplicate emails.

### Least-Privilege Role Boundaries (Migration 075)
- Under database trigger `trg_enforce_support_agent_outbound_queue_boundaries`, support agents:
  - Can only reconcile items in `status = 'outcome_unknown'`.
  - Cannot transition items to `processing` (worker-exclusive state).
  - Cannot acquire or set worker lease fields (`lease_token`, `lease_owner`, `claimed_at`).
  - Cannot modify items with an active, unexpired worker lease.

---

## 3. Queue Health Monitoring & Alert Thresholds

### Key Metrics
Monitor via Prometheus `/admin/v1/queue/metrics`:
- `byos_outbound_queue_size{status="outcome_unknown"}`: Warning threshold > 5, Critical > 25.
- `byos_outbound_stale_leases`: Any value > 0 indicates a worker process died without releasing a lock.
- `byos_outbound_queue_oldest_seconds{status="outcome_unknown"}`: Warning > 3600s (1 hour).

### Support CRM Dashboard
Access Support CRM -> Delivery Operations Console (`/queue`):
- Filter by `Status: Unknown Outcome`.
- Review queue age, attempts, and latest error details.

---

## 4. Investigation Protocol

### Step 1: Examine SMTP Telemetry & Delivery Logs
1. Click on the quarantined queue item in the Delivery Operations Console.
2. Inspect the **Delivery History** log:
   - Identify the exact `smtp_phase` when failure occurred (e.g. `terminator_in_flight`).
   - Check the remote SMTP response code and error message.
   - Note the recipient domain and correlation ID.

### Step 2: Correlate with Remote Telemetry
1. Check outbound Postfix relay logs or AWS SES/ISP delivery dashboards.
2. If available, contact the receiving domain postmaster or inspect inbound MX bounce reports matching the Message-ID.
3. Determine whether the remote MTA committed the message to customer mailbox storage.

---

## 5. Reconciliation Action Matrix

| Remote Investigation Finding | Authorized Reconciliation Action | Required Evidence | Resulting Status |
|---|---|---|---|
| Remote MTA confirmed delivery or returned 250 OK | `resolve_accepted` | Remote server Message-ID, TLS delivery receipt, or postmaster confirmation | `delivered` |
| Remote MTA confirmed message was NOT received / connection dropped before commit | `authorize_retry` | Packet capture / network drop log / MTA negative confirmation | `pending` |
| Remote MTA confirmed 550 permanent reject or bounce | `resolve_bounced` | Authoritative 5xx DSN, bounce receipt, or diagnostic string | `bounced` |
| Inconclusive / under investigation | `add_note` | Ticket reference or internal note | `outcome_unknown` (unchanged) |

---

## 6. Executing Operator Actions in Delivery Console

### Authorizing Retransmission (`authorize_retry`)
- Permitted only when evidence confirms the remote MTA dropped the message prior to acceptance.
- Standard Support Agent: Allowed **1 manual retry** per message.
- Platform Administrator: May grant a **2nd exceptional retry** (hard database limit: `max_manual_retries = 2`).
- Messages older than 72 hours from creation cannot be retried (fails with HTTP 409).

### Resolving as Accepted (`resolve_accepted`)
- Permitted when remote MTA telemetry confirms receipt.
- Requires non-empty evidence reference (e.g., `receipt://mta-250-ok-msgid`).
- Transitions state immediately to `delivered` and prevents any duplicate resend.

### Resolving as Bounced (`resolve_bounced`)
- Permitted only with authoritative bounce confirmation.
- Overwriting existing `delivered` or remote MTA `accepted_by_mta` state is strictly blocked by the backend (HTTP 409).
