import { getCpHeaders } from "./client";

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface BillingInfo {
  seat_count: number;
  subscription_status: string;
  billing_cycle?: "monthly" | "annual";
  monthly_usd: number;
  annual_usd: number;
  mailbox_limit: number;
  domain_limit: number;
  aliases_per_mail: number;
  used_mailboxes: number;
  used_domains: number;
  used_aliases: number;
  plan?: string;
  max_domains?: number;
  max_aliases?: number;
}

export interface CapacityInfo {
  seat_count: number;
  used_mailboxes: number;
  mailbox_limit: number;
  used_domains: number;
  domain_limit: number;
  used_aliases: number;
  aliases_per_mail: number;
}

export interface UpdateSeatsResponse {
  org_id: string;
  seat_count: number;
  monthly_total_cents: number;
  annual_total_cents: number;
}

export async function getBillingInfo(orgId: string): Promise<BillingInfo> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/billing`, {
    credentials: "include",
    headers: getCpHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch billing ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data.seat_count && !data.plan) {
    data.plan = `${data.seat_count} seats`;
  }
  return data as BillingInfo;
}

export async function updateSeats(orgId: string, seatCount: number): Promise<UpdateSeatsResponse> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/seats`, {
    method: "PATCH",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ seat_count: seatCount }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    let msg = `Failed to update seats ${res.status}`;
    if (data && data.error === "seat_count_below_active_mailboxes") {
      msg = `Cannot reduce seats below ${data.current_mailboxes} active mailbox${data.current_mailboxes === 1 ? "" : "es"}. Deactivate a mailbox before reducing seats.`;
    } else if (data && data.error) {
      msg = data.error;
    }
    const err = new Error(msg) as Error & { status: number; data?: any };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return (await res.json()) as UpdateSeatsResponse;
}

export async function getCapacity(orgId: string): Promise<CapacityInfo> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/capacity`, {
    credentials: "include",
    headers: getCpHeaders(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch capacity ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as CapacityInfo;
}

export async function updatePlan(orgId: string, _plan: string): Promise<BillingInfo> {
  return await getBillingInfo(orgId);
}

export async function updateCapacity(
  orgId: string,
  seatCount: number,
  _billingCycle: "monthly" | "annual" = "annual"
): Promise<BillingInfo> {
  await updateSeats(orgId, seatCount);
  return await getBillingInfo(orgId);
}
