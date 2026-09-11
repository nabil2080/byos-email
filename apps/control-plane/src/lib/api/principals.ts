function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface RecoveryPrincipal {
  id: string;
  user_id: string;
  org_id: string;
  principal_name: string;
  kdf_algorithm: string;
  kdf_version: number;
  kdf_salt: string;
  kdf_memory: number;
  kdf_iterations: number;
  kdf_parallelism: number;
  org_recovery_pk: string;
  org_recovery_sk_encrypted?: string;
  is_active: boolean;
  created_at: string;
  deactivated_at?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Request failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface EnrollPrincipalPayload {
  user_id: string;
  principal_name: string;
  kdf_algorithm: "argon2id";
  kdf_version: 1;
  kdf_salt: string;
  kdf_memory: 65536;
  kdf_iterations: 3;
  kdf_parallelism: 2;
  org_recovery_sk_encrypted: string;
  org_recovery_pk: string;
}

/**
 * Enroll a recovery principal. All crypto is client-side: the caller wraps
 * the org recovery secret under the passphrase first. The server pins the
 * frozen KDF profile and stores the envelope opaquely.
 */
export async function enrollPrincipal(
  orgId: string,
  payload: EnrollPrincipalPayload
): Promise<RecoveryPrincipal> {
  return request<RecoveryPrincipal>(`/v1/organizations/${orgId}/recovery-principals`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listPrincipals(orgId: string): Promise<RecoveryPrincipal[]> {
  const res = await request<{ principals: RecoveryPrincipal[] }>(
    `/v1/organizations/${orgId}/recovery-principals`,
    { method: "GET" }
  );
  return res.principals || [];
}

export async function getPrincipal(orgId: string, principalId: string): Promise<RecoveryPrincipal> {
  return request<RecoveryPrincipal>(
    `/v1/organizations/${orgId}/recovery-principals/${principalId}`,
    { method: "GET" }
  );
}

export async function revokePrincipal(
  orgId: string,
  principalId: string
): Promise<{ id: string; is_active: boolean }> {
  return request<{ id: string; is_active: boolean }>(
    `/v1/organizations/${orgId}/recovery-principals/${principalId}/revoke`,
    { method: "POST", body: JSON.stringify({}) }
  );
}
