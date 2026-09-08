import { encryptAttachmentBytes } from "./attachment_crypto";

export interface UserMe {
  user_id: string;
  email: string;
  org_id: string;
  role: string;
}

export interface Mailbox {
  id: string;
  local_part: string;
  domain_id: string;
  mode: string;
}

export interface DraftMessage {
  id: string;
  mailbox_id: string;
  subject: string;
  recipient: string;
  encrypted_envelope: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AttachmentItem {
  id: string;
  mailbox_id: string;
  message_id?: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  encrypted: boolean;
  created_at: string;
}

export interface MessageMetadata {
  id: string;
  mailbox_id: string;
  direction: "received" | "sent";
  sender: string;
  recipients: string[];
  storage_object_id: string;
  content_key_hpke_wrapped: string;
  encryption_version: number;
  encryption_iv: string;
  aad_version: number;
  bundle_hash: string;
  received_at: string;
  sent_at?: string;
  status: "received" | "sent" | "draft";
  has_attachments: boolean;
  attachment_count: number;
}

export interface PrepareResponse {
  reservation_id: string;
  outbox_seq: number;
  encryption_version: number;
  aad_version: number;
  expires_at: string;
}

export interface OutboundPubkeyResponse {
  outbound_delivery_pk: string;
}

export interface SendPayload {
  reservation_id: string;
  mailbox_id: string;
  recipient: string;
  encrypted_message: string;
  send_token_wrapped: string;
  outbox_seq: number;
  encryption_version: number;
  aad_version: number;
  encryption_iv: string;
  attachment_ids?: string[];
}

export interface SchedulePayload extends SendPayload {
  scheduled_at: string;
}

function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const error = new Error(errorText || `API error ${response.status}`) as Error & { status: number };
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function fetchCurrentUser(): Promise<UserMe | null> {
  try {
    return await apiRequest<UserMe>("/v1/auth/me");
  } catch (err) {
    console.warn("fetchCurrentUser error, proceeding with session fallback:", err);
    return null;
  }
}

export async function fetchMailboxes(orgId: string): Promise<Mailbox[]> {
  try {
    const res = await apiRequest<{ mailboxes: Mailbox[] }>(`/v1/organizations/${orgId}/mailboxes`);
    return res.mailboxes || [];
  } catch (err) {
    console.warn("fetchMailboxes error:", err);
    return [];
  }
}

export async function fetchDrafts(mailboxId: string): Promise<DraftMessage[]> {
  try {
    const res = await apiRequest<{ drafts: DraftMessage[] }>(`/v1/mailboxes/${mailboxId}/drafts`);
    return res.drafts || [];
  } catch (err) {
    console.warn("fetchDrafts error:", err);
    return [];
  }
}

export async function createDraft(
  mailboxId: string,
  payload: { subject: string; recipient: string; encrypted_envelope: string }
): Promise<DraftMessage> {
  return apiRequest<DraftMessage>(`/v1/mailboxes/${mailboxId}/drafts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteDraft(mailboxId: string, draftId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/drafts/${draftId}`, {
    method: "DELETE",
  });
}

export async function fetchAttachments(mailboxId: string): Promise<AttachmentItem[]> {
  try {
    const res = await apiRequest<{ attachments: AttachmentItem[] }>(`/v1/mailboxes/${mailboxId}/attachments`);
    return res.attachments || [];
  } catch (err) {
    console.warn("fetchAttachments error:", err);
    return [];
  }
}

export async function fetchMessages(mailboxId: string): Promise<MessageMetadata[]> {
  const res = await apiRequest<{ messages: MessageMetadata[] }>(`/v1/mailboxes/${mailboxId}/messages`);
  return res.messages || [];
}

export async function uploadEncryptedAttachment(
  mailboxId: string,
  file: File,
  mailboxKey: Uint8Array,
  messageId?: string
): Promise<AttachmentItem> {
  const arrayBuffer = await file.arrayBuffer();
  const plaintextBytes = new Uint8Array(arrayBuffer);

  // Encrypt client-side using Section 12 WASM primitive before network transit
  const ciphertextBytes = encryptAttachmentBytes(plaintextBytes, mailboxKey);

  const formData = new FormData();
  const encryptedBlob = new Blob([ciphertextBytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
  formData.append("file", encryptedBlob, file.name);
  if (messageId) {
    formData.append("message_id", messageId);
  }

  const response = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/attachments`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Failed to upload attachment: status ${response.status}`);
  }

  return (await response.json()) as AttachmentItem;
}

export async function prepareOutbound(mailboxId: string): Promise<PrepareResponse> {
  return apiRequest<PrepareResponse>("/v1/outbound/prepare", {
    method: "POST",
    body: JSON.stringify({ mailbox_id: mailboxId }),
  });
}

export async function fetchOutboundPubkey(): Promise<string> {
  const res = await apiRequest<OutboundPubkeyResponse>("/v1/outbound/pubkey");
  if (!res.outbound_delivery_pk) {
    throw new Error("Outbound delivery key is not configured");
  }
  return res.outbound_delivery_pk;
}

export async function sendOutbound(payload: SendPayload): Promise<{ delivery_id: string; status: string }> {
  return apiRequest<{ delivery_id: string; status: string }>("/v1/outbound/send", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function scheduleOutbound(payload: SchedulePayload): Promise<{ delivery_id: string; scheduled_at: string; status: string }> {
  return apiRequest<{ delivery_id: string; scheduled_at: string; status: string }>("/v1/outbound/schedule", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
