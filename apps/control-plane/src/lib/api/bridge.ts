function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface BridgeCredential {
  id: string;
  label: string;
  token?: string; // Present only on initial creation
  created_at: string;
  last_used_at?: string;
}

export async function getBridgeCredentials(mailboxId: string): Promise<BridgeCredential[]> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/bridge/credentials`, {
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch bridge credentials ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as { credentials: BridgeCredential[] };
  return data.credentials;
}

export async function createBridgeCredential(mailboxId: string, label: string): Promise<BridgeCredential> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/bridge/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ label }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to create bridge credential ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as BridgeCredential;
}

export async function revokeBridgeCredential(mailboxId: string, credentialId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/bridge/credentials/${credentialId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to revoke bridge credential ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}
