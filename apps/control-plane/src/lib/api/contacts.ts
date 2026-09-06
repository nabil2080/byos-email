export interface Contact {
  id: string;
  mailbox_id: string;
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
    headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!response.ok) throw new Error((await response.text().catch(() => "")) || `Request failed ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function listContacts(mailboxId: string): Promise<Contact[]> {
  return request<{ contacts: Contact[] }>(`/v1/mailboxes/${mailboxId}/contacts`).then((body) => body.contacts || []);
}

export function createContact(mailboxId: string, encryptedEnvelope: string): Promise<Contact> {
  return request<Contact>(`/v1/mailboxes/${mailboxId}/contacts`, {
    method: "POST",
    body: JSON.stringify({ encrypted_envelope: encryptedEnvelope }),
  });
}

export function updateContact(mailboxId: string, contact: Contact, encryptedEnvelope: string): Promise<Contact> {
  return request<Contact>(`/v1/mailboxes/${mailboxId}/contacts/${contact.id}`, {
    method: "PUT",
    body: JSON.stringify({ encrypted_envelope: encryptedEnvelope, version: contact.version }),
  });
}

export function deleteContact(mailboxId: string, contactId: string): Promise<void> {
  return request<void>(`/v1/mailboxes/${mailboxId}/contacts/${contactId}`, { method: "DELETE" });
}
