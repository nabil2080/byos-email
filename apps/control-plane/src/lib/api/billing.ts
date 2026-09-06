function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface BillingInfo {
  plan: string;
  monthly_usd: number;
  annual_usd: number;
  mailbox_limit: number;
  domain_limit: number;
  aliases_per_mail: number;
  used_mailboxes: number;
  used_domains: number;
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
