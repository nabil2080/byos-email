function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface BillingInfo {
  plan: string;
  monthly_usd: number;
  annual_usd: number;
  mailbox_limit: number;
  seat_count?: number;
  billing_cycle?: "monthly" | "annual";
  max_domains?: number;
  max_aliases?: number;
  domain_limit: number;
  aliases_per_mail: number;
  used_mailboxes: number;
  used_domains: number;
  dodo_product_id?: string;
  dodo_price_id?: string;
}

export async function getBillingInfo(orgId: string): Promise<BillingInfo> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/billing`, {
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch billing ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as BillingInfo;
}

export async function updatePlan(orgId: string, plan: string): Promise<BillingInfo> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/billing/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to update plan ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as BillingInfo;
}

export async function updateCapacity(
  orgId: string,
  seatCount: number,
  billingCycle: "monthly" | "annual" = "annual"
): Promise<BillingInfo> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/billing/capacity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ seat_count: seatCount, billing_cycle: billingCycle }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to update capacity ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as BillingInfo;
}
