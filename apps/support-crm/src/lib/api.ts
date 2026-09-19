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

const getAdminToken = (): string => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("byos_support_admin_token") || "mock-support-agent";
  }
  return "mock-support-agent";
};

async function adminFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${getAdminToken()}`);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMessage = `Request failed: HTTP ${res.status}`;
    try {
      const errText = await res.text();
      if (errText) errMessage = errText;
    } catch {
      // ignore
    }
    throw new Error(errMessage);
  }

  return res.json() as Promise<T>;
}

// 1. Fetch live organizations from PostgreSQL
export async function getOrganizations(): Promise<Organization[]> {
  const raw = await adminFetch<Organization[]>("/admin/v1/organizations");
  return raw.map((org) => ({
    ...org,
    org_uuid: org.id,
    plan_tier: org.plan,
    seat_count: org.seat_count || 10,
    storage_used_bytes: org.storage_used,
    storage_total_bytes: org.storage_quota,
  }));
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
  const raw = await adminFetch<AuditLogEntry[]>("/admin/v1/audit-logs");
  return raw.map((entry) => ({
    ...entry,
    admin_uuid: entry.admin_uuid || entry.actor_uuid || "admin_system",
    action: entry.action || entry.action_type || "UNKNOWN",
  }));
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
