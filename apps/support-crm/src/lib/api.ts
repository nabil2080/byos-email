// BYOS Support CRM API Client
// Strict Zero-Knowledge Administrative Boundary

export interface Organization {
  id: string;
  org_uuid?: string;
  name: string;
  plan: string;
  plan_tier?: string;
  seat_count: number;
  status: "active" | "suspended" | "grace_period";
  created_at: string;
  mailbox_count: number;
  storage_used: number;
  storage_quota: number;
  storage_used_bytes?: number;
  storage_total_bytes?: number;
}

export interface AuditLogEntry {
  id: string;
  admin_uuid: string;
  actor_uuid?: string;
  action: string;
  action_type?: string;
  target_uuid: string;
  metadata: any;
  timestamp: string;
}

export interface ActionResponse {
  success: boolean;
  audit_id: string;
  target_org_uuid?: string;
  status?: string;
  plan?: string;
  seat_count?: number;
  message?: string;
}

export interface HealthData {
  status: string;
  quota_used: number;
  quota_total: number;
  blob_count: number;
  billing_status: string;
  dkim_verified: boolean;
  spf_verified: boolean;
  active_connections: number;
}

/**
 * Executes an authenticated administrative API request.
 * Authentication tokens are strictly server-managed via HttpOnly cookies (byos_admin_session),
 * preventing token leakage through JavaScript persistent or session storage.
 */
async function adminFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(endpoint, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    if (res.status === 401 && import.meta.env?.DEV) {
      // In development, establish mock agent session cookie and retry once
      try {
        const initRes = await fetch("/admin/v1/auth/mock-login", {
          method: "POST",
          credentials: "include",
        });
        if (initRes.ok) {
          const retryRes = await fetch(endpoint, {
            ...options,
            credentials: "include",
            headers,
          });
          if (retryRes.ok) {
            return (await retryRes.json()) as Promise<T>;
          }
        }
      } catch {
        // Fall through to error reporting
      }
    }
    let errMessage = `Request failed: HTTP ${res.status}`;
    try {
      const errText = await res.text();
      if (errText) {
        try {
          const parsed = JSON.parse(errText);
          if (parsed && typeof parsed === "object" && typeof parsed.error === "string") {
            errMessage = parsed.error;
          } else {
            errMessage = errText;
          }
        } catch {
          errMessage = errText;
        }
      }
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }

  return res.json() as Promise<T>;
}

export async function logoutAdmin(): Promise<void> {
  await fetch("/admin/v1/auth/logout", {
    method: "POST",
    credentials: "include",
  }).catch(() => {});
}

// 1. Fetch live organizations from PostgreSQL
export async function getOrganizations(): Promise<Organization[]> {
  try {
    const raw = await adminFetch<Organization[]>("/admin/v1/organizations");
    return raw.map((org) => ({
      ...org,
      org_uuid: org.id,
      plan_tier: org.plan,
      seat_count: org.seat_count || 10,
      storage_used_bytes: org.storage_used,
      storage_total_bytes: org.storage_quota,
    }));
  } catch (err) {
    console.warn("Failed to load organizations:", err);
    return [];
  }
}

// 2. Suspend / Reactivate organization (Atomic DB transaction with immutable audit ledger)
export async function suspendOrganization(
  uuid: string,
  status: "suspended" | "active" = "suspended",
  reason?: string
): Promise<ActionResponse> {
  return adminFetch<ActionResponse>(`/admin/v1/organizations/${uuid}/suspend`, {
    method: "POST",
    body: JSON.stringify({
      status,
      reason: reason || `Admin intervention status set to ${status}`,
    }),
  });
}


// Suspend / Reactivate an individual customer user account & personal mailboxes
export async function suspendCustomer(
  userUuid: string,
  status: "suspended" | "active" = "suspended",
  reason?: string
): Promise<ActionResponse> {
  return adminFetch<ActionResponse>(`/admin/v1/customers/${userUuid}/suspend`, {
    method: "POST",
    body: JSON.stringify({
      status,
      reason: reason || `Admin intervention customer account set to ${status}`,
    }),
  });
}

// 3. Update subscription plan tier (Atomic DB transaction with immutable audit ledger)
export async function updatePlan(
  uuid: string,
  tier: string,
  reason?: string
): Promise<ActionResponse> {
  return adminFetch<ActionResponse>(`/admin/v1/organizations/${uuid}/plan`, {
    method: "POST",
    body: JSON.stringify({
      plan: tier,
      reason: reason || `Admin plan adjustment to ${tier}`,
    }),
  });
}

// 4. Adjust mailbox seat capacity (Atomic DB transaction with immutable audit ledger)
export async function updateCapacity(
  uuid: string,
  seatCount: number,
  reason?: string
): Promise<ActionResponse> {
  return adminFetch<ActionResponse>(`/admin/v1/organizations/${uuid}/capacity`, {
    method: "POST",
    body: JSON.stringify({
      seat_count: seatCount,
      reason: reason || `Admin capacity adjustment to ${seatCount} mailboxes`,
    }),
  });
}

// 5. Trigger verifier-based offline recovery flow (Atomic DB transaction, no password reset)
export async function triggerStateReset(
  uuid: string,
  reason?: string
): Promise<ActionResponse> {
  return adminFetch<ActionResponse>(`/admin/v1/organizations/${uuid}/state-reset`, {
    method: "POST",
    body: JSON.stringify({
      reason: reason || "Admin triggered zero-knowledge offline verifier recovery flow",
    }),
  });
}

// 6. Fetch read-only immutable audit logs
export async function getAuditLogs(): Promise<AuditLogEntry[]> {
  try {
    const raw = await adminFetch<AuditLogEntry[]>("/admin/v1/audit-logs");
    return raw.map((entry) => ({
      ...entry,
      admin_uuid: entry.admin_uuid || entry.actor_uuid || "admin_system",
      action: entry.action || entry.action_type || "UNKNOWN",
    }));
  } catch (err) {
    console.warn("Failed to load audit logs:", err);
    return [];
  }
}

// 7. Fetch mailbox health diagnostics
export async function getMailboxHealth(uuid: string): Promise<HealthData> {
  return adminFetch<HealthData>(`/admin/v1/mailboxes/${uuid}/health`);
}

// 8. Execute queue interventions
export async function executeIntervention(
  action: "replay_queue" | "revoke_session" | "state_reset",
  targetMailboxUuid: string,
  reason?: string
): Promise<ActionResponse> {
  return adminFetch<ActionResponse>("/admin/v1/interventions/execute", {
    method: "POST",
    body: JSON.stringify({
      action,
      target_mailbox_uuid: targetMailboxUuid,
      reason: reason || `Intervention ${action} dispatched`,
    }),
  });
}


// ─────────────────────────────────────────────────────────────
// Real Support Ticketing & Help Desk Endpoints
// ─────────────────────────────────────────────────────────────

export interface SupportAgent {
  id: string;
  email: string;
  display_name: string;
  role: string;
  is_active: boolean;
}

export interface SupportStats {
  new?: number;
  open?: number;
  new_tickets: number;
  open_tickets: number;
  in_progress: number;
  pending_customer: number;
  resolved: number;
  closed: number;
  unassigned: number;
  high_priority: number;
  total: number;
}

export interface TicketListItem {
  id: string;
  ticket_number: string;
  customer_user_id: string;
  customer_email: string;
  org_id?: string;
  org_name?: string;
  subject: string;
  product_area: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "new" | "open" | "pending_customer" | "in_progress" | "resolved" | "closed";
  assigned_agent_id?: string;
  assigned_agent_name?: string;
  first_response_at?: string;
  resolved_at?: string;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  snippet: string;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  author_type: "customer" | "agent" | "system";
  author_id: string;
  author_name: string;
  body: string;
  visibility: "public" | "internal";
  created_at: string;
}

export interface CustomerMetadata {
  user_id: string;
  email: string;
  display_name: string;
  account_status: string;
  created_at: string;
  org_id?: string;
  org_name?: string;
  org_plan?: string;
  org_status?: string;
  seat_count: number;
  mailbox_count: number;
  storage_used: number;
  ticket_count: number;
}

export interface TicketDetail {
  id: string;
  ticket?: any;
  ticket_number: string;
  customer_user_id: string;
  customer_email: string;
  org_id?: string;
  org_name?: string;
  subject: string;
  product_area: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "new" | "open" | "pending_customer" | "in_progress" | "resolved" | "closed";
  assigned_agent_id?: string;
  assigned_agent_name?: string;
  first_response_at?: string;
  resolved_at?: string;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
  customer: CustomerMetadata;
  messages: TicketMessage[];
  customer_typing?: boolean;
  agent_typing?: boolean;
}

export async function getTickets(params?: {
  status?: string;
  priority?: string;
  assigned_to?: string;
  search?: string;
  org_id?: string;
  page?: number;
  limit?: number;
}): Promise<{ tickets: TicketListItem[]; total: number; page: number; limit: number }> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.priority) q.set("priority", params.priority);
  if (params?.assigned_to) q.set("assigned_to", params.assigned_to);
  if (params?.search) q.set("search", params.search);
  if (params?.org_id) q.set("org_id", params.org_id);
  if (params?.page) q.set("page", String(params.page));
  if (params?.limit) q.set("limit", String(params.limit));
  const queryStr = q.toString() ? `?${q.toString()}` : "";
  return adminFetch<{ tickets: TicketListItem[]; total: number; page: number; limit: number }>(
    `/admin/v1/tickets${queryStr}`
  );
}

export async function getTicketDetail(ticketId: string): Promise<TicketDetail> {
  const resp = await adminFetch<any>(`/admin/v1/tickets/${ticketId}`);
  if (resp && resp.ticket) {
    return {
      ticket: resp.ticket,
      ...resp.ticket,
      customer: resp.customer || {},
      messages: resp.messages || [],
      customer_typing: Boolean(resp.customer_typing),
      agent_typing: Boolean(resp.agent_typing),
    };
  }
  return resp;
}

export async function recordAgentTyping(ticketId: string): Promise<void> {
  try {
    await adminFetch(`/admin/v1/tickets/${ticketId}/typing`, { method: "POST" });
  } catch {
    // Non-blocking typing signal
  }
}

export async function addTicketMessage(
  ticketId: string,
  body: string,
  visibility: "public" | "internal" = "public"
): Promise<TicketMessage> {
  return adminFetch<TicketMessage>(`/admin/v1/tickets/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, visibility }),
  });
}

export async function updateTicket(
  ticketId: string,
  updates: {
    status?: string;
    priority?: string;
    assigned_agent_id?: string | null;
  }
): Promise<{ success: boolean; ticket: any }> {
  return adminFetch<{ success: boolean; ticket: any }>(`/admin/v1/tickets/${ticketId}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export async function getSupportAgents(): Promise<SupportAgent[]> {
  try {
    const resp = await adminFetch<{ agents: SupportAgent[] }>("/admin/v1/support-agents");
    return resp.agents || [];
  } catch (err) {
    console.warn("Failed to load support agents:", err);
    return [];
  }
}

export const fetchSupportStats = getSupportStats;
export async function getSupportStats(): Promise<SupportStats> {
  try {
    const raw = await adminFetch<any>("/admin/v1/support/stats");
    return {
      new_tickets: raw?.new ?? raw?.new_tickets ?? 0,
      open_tickets: raw?.open ?? raw?.open_tickets ?? 0,
      new: raw?.new ?? raw?.new_tickets ?? 0,
      open: raw?.open ?? raw?.open_tickets ?? 0,
      total: raw?.total ?? 0,
      in_progress: raw?.in_progress ?? 0,
      pending_customer: raw?.pending_customer ?? 0,
      resolved: raw?.resolved ?? 0,
      closed: raw?.closed ?? 0,
      unassigned: raw?.unassigned ?? 0,
      high_priority: raw?.high_priority ?? 0,
    };
  } catch (err) {
    console.warn("Failed to load support stats:", err);
    return {
      new_tickets: 0,
      open_tickets: 0,
      new: 0,
      open: 0,
      total: 0,
      in_progress: 0,
      pending_customer: 0,
      resolved: 0,
      closed: 0,
      unassigned: 0,
      high_priority: 0,
    };
  }
}

export type TicketDetailResponse = TicketDetail;

export async function fetchTickets(params?: {
  status?: string;
  priority?: string;
  assigned_to?: string;
  search?: string;
  org_id?: string;
  page?: number;
  limit?: number;
}): Promise<TicketListItem[]> {
  const result = await getTickets(params);
  return result?.tickets || [];
}

export const fetchTicketDetail = getTicketDetail;

export async function updateTicketStatus(ticketId: string, status: string): Promise<any> {
  return updateTicket(ticketId, { status });
}

export async function updateTicketPriority(ticketId: string, priority: string): Promise<any> {
  return updateTicket(ticketId, { priority });
}

export async function assignTicketAgent(ticketId: string, agentId: string | null): Promise<any> {
  return updateTicket(ticketId, { assigned_agent_id: agentId });
}

export async function sendTicketReply(params: {
  ticketId: string;
  body: string;
  visibility?: "public" | "internal";
  authorName?: string;
}): Promise<any> {
  return addTicketMessage(params.ticketId, params.body, params.visibility || "public");
}

export const fetchSupportAgents = getSupportAgents;

// ============================================================================
// Release C6.5 / C6.5.1: Outbound Delivery Operations & Queue Observability
// ============================================================================

export interface QueueOverviewResponse {
  status: "healthy" | "degraded" | "critical";
  counts: {
    pending: number;
    processing: number;
    retry_scheduled: number;
    outcome_unknown: number;
    delivered: number;
    bounced: number;
    expired: number;
    delivered_24h: number;
    bounced_24h: number;
    expired_24h: number;
    [key: string]: number;
  };
  oldest_age_seconds: {
    pending: number;
    processing: number;
    outcome_unknown: number;
    [key: string]: number;
  };
  timestamp: string;
}

export interface QueueMessageItem {
  id: string;
  delivery_id: string;
  mailbox_id: string;
  domain_id: string;
  recipient: string;
  status: "pending" | "processing" | "outcome_unknown" | "delivered" | "bounced" | "expired" | string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  created_at: string;
  delivered_at?: string;
  failed_at?: string;
  expires_at: string;
  lease_token?: string;
  lease_owner?: string;
  claimed_at?: string;
  lease_expires_at?: string;
  is_lease_active: boolean;
  smtp_phase?: string;
  last_smtp_code?: number;
  last_error?: string;
  reconciled_at?: string;
  reconciled_by?: string;
  reconciliation_reason?: string;
  manual_retry_count?: number;
  max_manual_retries?: number;
}

export interface QueueMessageListResponse {
  messages: QueueMessageItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface DeliveryLogHistoryItem {
  id: string;
  delivery_id: string;
  direction: string;
  status: string;
  smtp_code?: number;
  smtp_message?: string;
  attempted_at: string;
  lease_token?: string;
  smtp_phase?: string;
}

export interface OperatorAuditItem {
  id: string;
  created_at: string;
  actor_id: string;
  actor_email: string;
  actor_role: string;
  action: "investigate" | "add_note" | "resolve_accepted" | "authorize_retry" | "resolve_bounced" | string;
  queue_id: string;
  delivery_id: string;
  previous_status: string;
  resulting_status: string;
  resolution_category?: string;
  operator_reason: string;
  evidence_category?: string;
  evidence_reference?: string;
  evidence_provenance?: "operator_attested" | "independent_verified" | "insufficient" | string;
  is_independently_verified?: boolean;
  idempotency_key?: string;
  request_fingerprint?: string;
  ip_address?: string;
  user_agent?: string;
}

export interface QueueMessageDetailResponse {
  message: QueueMessageItem;
  delivery_logs: DeliveryLogHistoryItem[];
  audit_trail: OperatorAuditItem[];
}

export interface ReconcileRequest {
  action: "resolve_accepted" | "authorize_retry" | "resolve_bounced" | "add_note";
  operator_reason: string;
  resolution_category?: string;
  evidence_category?: string;
  evidence_reference?: string;
  duplicate_risk_acknowledged?: boolean;
  idempotency_key?: string;
}

export interface ReconcileResponse {
  success: boolean;
  action: string;
  queue_id: string;
  delivery_id: string;
  previous_status: string;
  resulting_status: string;
  reconciled_at: string;
  reconciled_by: string;
  audit_id: string;
  evidence_provenance?: string;
  is_independently_verified?: boolean;
  idempotent_replay?: boolean;
}

export interface QueueAlertItem {
  type: "stale_lease" | "stuck_pending" | "outcome_unknown_quarantine" | string;
  severity: "warning" | "critical" | string;
  count: number;
  message: string;
  sample_ids: string[];
}

export interface QueueAlertsResponse {
  status: "healthy" | "warning" | "critical" | string;
  alerts: QueueAlertItem[];
}

export async function fetchQueueOverview(): Promise<QueueOverviewResponse> {
  return adminFetch<QueueOverviewResponse>("/admin/v1/queue/overview");
}

export async function fetchQueueMessages(params?: {
  status?: string;
  recipient?: string;
  domain_id?: string;
  limit?: number;
  offset?: number;
}): Promise<QueueMessageListResponse> {
  const query = new URLSearchParams();
  if (params?.status && params.status !== "all") query.set("status", params.status);
  if (params?.recipient) query.set("recipient", params.recipient);
  if (params?.domain_id) query.set("domain_id", params.domain_id);
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.offset !== undefined) query.set("offset", String(params.offset));
  const qs = query.toString();
  return adminFetch<QueueMessageListResponse>(`/admin/v1/queue/messages${qs ? `?${qs}` : ""}`);
}

export async function fetchQueueMessageDetail(id: string): Promise<QueueMessageDetailResponse> {
  return adminFetch<QueueMessageDetailResponse>(`/admin/v1/queue/messages/${encodeURIComponent(id)}`);
}

export async function fetchQueueMessageAudit(id: string): Promise<{
  queue_id: string;
  audit_count: number;
  audit_trail: OperatorAuditItem[];
}> {
  return adminFetch<{
    queue_id: string;
    audit_count: number;
    audit_trail: OperatorAuditItem[];
  }>(`/admin/v1/queue/messages/${encodeURIComponent(id)}/audit`);
}

export async function reconcileQueueMessage(
  id: string,
  req: ReconcileRequest
): Promise<ReconcileResponse> {
  const headers: Record<string, string> = {};
  if (req.idempotency_key) {
    headers["Idempotency-Key"] = req.idempotency_key;
  }
  return adminFetch<ReconcileResponse>(`/admin/v1/queue/messages/${encodeURIComponent(id)}/reconcile`, {
    method: "POST",
    headers,
    body: JSON.stringify(req),
  });
}

export async function fetchQueueAlerts(): Promise<QueueAlertsResponse> {
  return adminFetch<QueueAlertsResponse>("/admin/v1/queue/alerts");
}

