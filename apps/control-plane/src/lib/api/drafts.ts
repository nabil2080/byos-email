export interface Draft {
  id: string;
  mailbox_id: string;
  subject: string;
  recipient: string;
  encrypted_envelope: string;
  version: number;
  created_at: string;
  updated_at: string;
}

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const error = new Error((await response.text().catch(() => "")) || `Request failed ${response.status}`) as Error & {
      status: number;
      body?: unknown;
    };
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listDrafts(mailboxId: string): Promise<Draft[]> {
  return request<{ drafts: Draft[] }>(`/v1/mailboxes/${mailboxId}/drafts`).then((body) => body.drafts || []);
}

export function createDraft(
  mailboxId: string,
  payload: Pick<Draft, "subject" | "recipient" | "encrypted_envelope">,
): Promise<Draft> {
  return request<Draft>(`/v1/mailboxes/${mailboxId}/drafts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateDraft(
  mailboxId: string,
  draftId: string,
  payload: Pick<Draft, "subject" | "recipient" | "encrypted_envelope"> & { version: number },
): Promise<Draft> {
  return request<Draft>(`/v1/mailboxes/${mailboxId}/drafts/${draftId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteDraft(mailboxId: string, draftId: string): Promise<void> {
  return request<void>(`/v1/mailboxes/${mailboxId}/drafts/${draftId}`, { method: "DELETE" });
}
