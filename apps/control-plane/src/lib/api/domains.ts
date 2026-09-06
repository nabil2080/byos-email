/**
 * Domain API client – SolidJS dashboard
 * Wraps org-scoped domain endpoints.
 * Never exposes credentials, ciphertext, or DEK.
 */

export interface Domain {
  id: string;
  name: string;
  is_verified: boolean;
  verified?: boolean;
}

function getAuthHeader(): Record<string, string> {
  const userId =
    (typeof window !== "undefined" && (window as unknown as { __BYOS_USER_ID?: string }).__BYOS_USER_ID) || "";
  return userId ? { "X-User-Id": userId } : {};
}

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getAuthHeader(),
    ...(init?.headers as Record<string, string>),
  };
  const res = await fetch(`${apiBase()}${path}`, { credentials: "include", ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Request failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export async function listDomains(orgId: string): Promise<Domain[]> {
  const body = await request<{ domains: Domain[] }>(`/v1/organizations/${orgId}/domains`, { method: "GET" });
  // Normalize is_verified / verified
  return (body.domains || []).map((d) => ({
    id: d.id,
    name: d.name,
    is_verified: (d as unknown as { is_verified: boolean }).is_verified ?? d.verified ?? false,
    verified: (d as unknown as { is_verified: boolean }).is_verified ?? d.verified ?? false,
  }));
}

export async function createDomain(orgId: string, domain: string): Promise<Domain> {
  return request<Domain>(`/v1/organizations/${orgId}/domains`, {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
}

export async function verifyDomain(orgId: string, domainId: string): Promise<{ status: string; domain: string }> {
  return request<{ status: string; domain: string }>(`/v1/organizations/${orgId}/domains/${domainId}/verify`, {
    method: "POST",
  });
}
