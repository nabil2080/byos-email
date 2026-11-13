import {
  encryptAttachmentBytes,
  decryptAttachmentBytes,
  encryptAttachmentV2,
  decryptAttachmentV2,
  sanitizeFilenameV2,
  canonicalMimeTypeV2,
  AttachmentEnvelope,
  AttachmentWrappedKey,
  AttachmentChunk,
  type PreparedAttachment,
  type OutboundAttachmentGrantV2,
} from "./attachment_crypto";

export type {
  AttachmentEnvelope,
  AttachmentWrappedKey,
  AttachmentChunk,
  PreparedAttachment,
  OutboundAttachmentGrantV2,
};

export interface UserMe {
  id?: string;
  user_id: string;
  email: string;
  org_id: string;
  role: string;
  plan?: string;
  display_name?: string;
  mailbox_id?: string;
  mailbox_local_part?: string;
  mailbox_mode?: string;
  wrapped_sk_user?: string;
  previous_wrapped_sk_user?: string;
  profile_photo_ref?: string | null;
}

export interface Mailbox {
  id: string;
  local_part: string;
  domain_id: string;
  mode: string;
  display_name?: string;
  public_key?: string;
  wrapped_sk_user?: string;
  previous_wrapped_sk_user?: string;
  profile_photo_ref?: string | null;
  profile_photo_updated_at?: string;
}

export interface DraftMessage {
  id: string;
  mailbox_id: string;
  subject: string;
  recipient: string;
  encrypted_envelope: string;
  version: number;
  send_failed?: boolean;
  folder?: string;
  folder_id?: string;
  attachment_ids?: string[];
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
  byte_size?: number;
  plaintext_size_bytes?: number;
  ciphertext_size_bytes?: number;
  encrypted: boolean;
  created_at: string;
  crypto_version?: number;
  cek_owner_wrapped?: string;
  owner_wrap_alg?: string;
  owner_key_version?: number;
  owner_pk_sha256?: string;
  blob_aad_version?: number;
  plaintext_sha256?: string;
  ciphertext_sha256?: string;
  rawFile?: File;
  isPathA?: boolean;
  envelope?: AttachmentEnvelope;
  uploadStatus?: "idle" | "preparing" | "encrypting" | "uploading" | "completed" | "failed" | "cancelled";
  uploadProgress?: {
    completedBytes: number;
    totalBytes: number;
    completedChunks: number;
    totalChunks: number;
    percent: number;
  };
  uploadError?: string | null;
  abortController?: AbortController;
  uploadAttemptId?: string;
  preparedPathA?: PreparedAttachment;
}

export interface MessageMetadata {
  id: string;
  mailbox_id: string;
  message_seq: number;
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
  folder?: string;
  folder_id?: string | null;
  label_ids?: string[];
  is_read?: boolean;
  is_starred?: boolean;
  snoozed_until?: string;
  size_bytes?: number;
  subject?: string;
  draft_storage_ref?: string;
  send_at?: string;
  scheduled_at?: string;
  reply_via_alias?: string;
  alias_label?: string;
  category_override?: string | null;
}

export interface ThreadSummary {
  thread_id: string;
  message_count: number;
  unread_count: number;
  latest_at: string;
  participants: string[];
  recipients?: string[];
  message_ids: string[];
  is_starred: boolean;
  folder: string;
  has_attachments: boolean;
  snoozed_until?: string | null;
}

export interface MessageBodyResponse {
  encrypted_body: string;
  content_key_hpke_wrapped: string;
  encryption_iv: string;
  aad_version: number;
  bundle_hash: string;
  encryption_version: number;
  message_seq: number;
  xwing_envelope_json?: string;
}

export interface MailboxDetail {
  mailbox_id: string;
  mode: string;
  mailbox_pk: string;
  mailbox_sk_wrapped: string;
  mailbox_sk_version: number;
  wrapped_sk_user?: string;
  previous_wrapped_sk_user?: string;
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
  key_id?: string;
  key_epoch?: number;
  algorithm?: string;
  valid_until?: string;
  min_accepted_epoch?: number;
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
  send_token_key_epoch?: number;
  send_token_key_id?: string;
  attachment_ids?: string[];
  attachments?: OutboundAttachmentGrantV2[];
  alias_id?: string;
  client_queue_id?: string;
}

export interface SchedulePayload extends SendPayload {
  scheduled_at: string;
  draft_envelope?: string;
  draft_storage_ref?: string;
  subject?: string;
}

export interface SchedulePathARequest {
  mailbox_id: string;
  recipient: string;
  envelope_json: string;
  deliver_at: string; // RFC3339
  draft_envelope?: string;
  draft_storage_ref?: string;
  subject?: string;
  attachment_envelopes?: AttachmentEnvelope[];
  sender_attachment_envelopes?: AttachmentEnvelope[];
}

export async function schedulePathA(
  req: SchedulePathARequest,
): Promise<{ id: string; scheduled_at: string; status: string }> {
  return apiRequest<{ id: string; scheduled_at: string; status: string }>(
    "/v1/outbound/schedule-path-a",
    {
      method: "POST",
      body: JSON.stringify(req),
    },
  );
}

export async function cancelScheduledMessage(
  mailboxId: string,
  id: string,
): Promise<{ status: string; draft_id?: string }> {
  return apiRequest<{ status: string; draft_id?: string }>(
    `/v1/mailboxes/${mailboxId}/scheduled/${id}/cancel`,
    {
      method: "POST",
    },
  );
}

export interface UpdateScheduledPayload {
  scheduled_at?: string;
  draft_envelope?: string;
  draft_storage_ref?: string;
  subject?: string;
}

export async function updateScheduledMessage(
  mailboxId: string,
  id: string,
  payload: UpdateScheduledPayload,
): Promise<{ id: string; status: string }> {
  return apiRequest<{ id: string; status: string }>(
    `/v1/mailboxes/${mailboxId}/scheduled/${id}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export interface ScheduledDraftResponse {
  id: string;
  mailbox_id: string;
  draft_storage_ref: string;
  encrypted_envelope: string;
  send_at: string;
  status: string;
}

export async function fetchScheduledDraft(
  mailboxId: string,
  id: string,
  token?: string,
): Promise<ScheduledDraftResponse> {
  return apiRequest<ScheduledDraftResponse>(
    `/v1/mailboxes/${mailboxId}/scheduled/${id}`,
    undefined,
    token,
  );
}

export function apiBase(): string {
  const envBase = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE;
  if (envBase) return envBase;
  if (typeof window === "undefined") return "http://localhost";
  return "";
}

export function getTrackingPixelUrl(token: string): string {
  const base = apiBase();
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}/v1/track/${encodeURIComponent(token)}.gif`;
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}${base}/v1/track/${encodeURIComponent(token)}.gif`;
  }
  return `/v1/track/${encodeURIComponent(token)}.gif`;
}

let currentActiveMailboxId: string | null = null;

export function setActiveMailboxContext(mailboxId: string | null) {
  currentActiveMailboxId = mailboxId;
}

export function getActiveMailboxContext(): string | null {
  return currentActiveMailboxId;
}

export interface ConnectedAccount {
  id: string;             // mailbox_id
  email: string;          // e.g. billing@testorg.byos
  displayName: string;
  role: string;
  privacyMode: string;
  sessionToken?: string;  // Deprecated/optional — sessions are server-managed via HttpOnly cookies
  mailboxSkHex?: string;  // Unsealed private key in memory (optional if locked)
  searchKeyHex?: string;  // Search index key (optional if locked)
  signingSeedHex?: string;
  xwingSeedHex?: string;
  isLocked?: boolean;
  profile_photo_ref?: string;
}

export interface UserMailboxSummary {
  id: string;
  email: string;
  display_name: string;
  org_id: string;
  is_active: boolean;
}

export async function fetchUserMailboxes(token?: string): Promise<UserMailboxSummary[]> {
  const res = await apiRequest<{ mailboxes: UserMailboxSummary[] }>("/v1/users/me/mailboxes", undefined, token);
  return res.mailboxes || [];
}

export async function uploadProfilePhoto(
  encryptedBytes: Uint8Array,
  token?: string
): Promise<{ photo_ref: string; updated_at: string }> {
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (currentActiveMailboxId) {
    authHeaders["X-BYOS-Active-Mailbox"] = currentActiveMailboxId;
  }

  const response = await fetch(`${apiBase()}/v1/users/me/profile-photo`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-BYOS-Client": "webmail",
      ...authHeaders,
    },
    body: encryptedBytes as unknown as BodyInit,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to upload profile photo");
  }

  return response.json();
}

export async function getProfilePhoto(token?: string): Promise<Uint8Array> {
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (currentActiveMailboxId) {
    authHeaders["X-BYOS-Active-Mailbox"] = currentActiveMailboxId;
  }

  const response = await fetch(`${apiBase()}/v1/users/me/profile-photo`, {
    method: "GET",
    credentials: "include",
    headers: {
      "X-BYOS-Client": "webmail",
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to get profile photo");
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function deleteProfilePhoto(token?: string): Promise<void> {
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (currentActiveMailboxId) {
    authHeaders["X-BYOS-Active-Mailbox"] = currentActiveMailboxId;
  }

  const response = await fetch(`${apiBase()}/v1/users/me/profile-photo`, {
    method: "DELETE",
    credentials: "include",
    headers: {
      "X-BYOS-Client": "webmail",
      ...authHeaders,
    },
  });

  if (!response.ok && response.status !== 204) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to delete profile photo");
  }
}

export function getAccountColor(id: string): string {
  if (!id) return "hsl(20, 25%, 50%)";
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

export async function apiRequest<T>(path: string, init?: RequestInit, token?: string): Promise<T> {
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (!(init?.headers as Record<string, string> | undefined)?.["X-BYOS-Active-Mailbox"]) {
    const mbxMatch = path.match(/^\/v1\/mailboxes\/([0-9a-fA-F-]+)/);
    if (mbxMatch && mbxMatch[1]) {
      authHeaders["X-BYOS-Active-Mailbox"] = mbxMatch[1];
    } else if (currentActiveMailboxId && !path.startsWith("/v1/auth/")) {
      authHeaders["X-BYOS-Active-Mailbox"] = currentActiveMailboxId;
    }
  }

  const response = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-BYOS-Client": "webmail",
      ...authHeaders,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    let errorCode: string | undefined;
    try {
      const parsed = JSON.parse(errorText);
      errorCode = parsed?.error || parsed?.code;
    } catch {}

    const error = new Error(errorText || `API error ${response.status}`) as Error & {
      status: number;
      code?: string;
      retryAfter?: number;
      headers?: Headers;
    };
    error.status = response.status;
    if (errorCode) {
      error.code = errorCode;
    }
    const retryAfterHeader = response.headers?.get ? response.headers.get("Retry-After") : undefined;
    if (retryAfterHeader) {
      const parsedSec = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsedSec) && parsedSec >= 0) {
        error.retryAfter = parsedSec;
      } else {
        const parsedDate = Date.parse(retryAfterHeader);
        if (!isNaN(parsedDate)) {
          const diffMs = parsedDate - Date.now();
          error.retryAfter = Math.max(0, Math.ceil(diffMs / 1000));
        }
      }
    }
    error.headers = response.headers;
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
  } catch (err: any) {
    if (err?.status === 401 || err?.status === 403) {
      return null;
    }
    console.warn("fetchCurrentUser server/network error:", err);
    throw err;
  }
}

export interface LoginResponse {
  id?: string;
  email?: string;
  org_id?: string;
  organization_id?: string;
  role?: string;
  plan?: string;
  token?: string;
  mailbox_id?: string;
  mailbox_local_part?: string;
  mailbox_mode?: string;
  wrapped_sk_user?: string;
  previous_wrapped_sk_user?: string;
  two_factor_required?: boolean;
  challenge_token?: string;
  methods?: string[];
  preferred_method?: string;
  destination_masked?: string;
  debug_code?: string;
  profile_photo_ref?: string | null;
}

/** Password login. The session travels in an HttpOnly cookie set by the
    server; the password itself is never stored — cleared after the request. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  setActiveMailboxContext(null);
  return apiRequest<LoginResponse>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** Server-side session revocation. Callers must still clear local state even
    when this throws (network failure must not keep a signed-in UI alive). */
export async function logout(): Promise<void> {
  setActiveMailboxContext(null);
  await apiRequest<void>("/v1/auth/logout", { method: "POST" });
}

/** Link an additional authenticated mailbox account to the active session server-side. */
export async function linkAccount(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/v1/auth/linked-accounts", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** Unlink a secondary mailbox account from the active session server-side. */
export async function unlinkAccount(mailboxId: string): Promise<void> {
  await apiRequest<void>(`/v1/auth/linked-accounts/${mailboxId}`, {
    method: "DELETE",
  });
}

export async function fetchMailboxes(orgId: string): Promise<Mailbox[]> {
  const res = await apiRequest<{ mailboxes: Mailbox[] }>(`/v1/organizations/${orgId}/mailboxes`);
  return res.mailboxes || [];
}

export async function fetchDrafts(mailboxId: string, token?: string): Promise<DraftMessage[]> {
  const res = await apiRequest<{ drafts: DraftMessage[] }>(`/v1/mailboxes/${mailboxId}/drafts`, undefined, token);
  return res.drafts || [];
}

export async function createDraft(
  mailboxId: string,
  payload: { subject: string; recipient: string; encrypted_envelope: string; attachment_ids?: string[] },
  token?: string
): Promise<DraftMessage> {
  return apiRequest<DraftMessage>(`/v1/mailboxes/${mailboxId}/drafts`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function deleteDraft(mailboxId: string, draftId: string, token?: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/drafts/${draftId}`, {
    method: "DELETE",
  }, token);
}

export async function updateDraft(
  mailboxId: string,
  draftId: string,
  payload: { subject: string; recipient: string; encrypted_envelope: string; version: number; attachment_ids?: string[] },
  token?: string
): Promise<DraftMessage> {
  return apiRequest<DraftMessage>(`/v1/mailboxes/${mailboxId}/drafts/${draftId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  }, token);
}

export interface ContactItem {
  id: string;
  mailbox_id: string;
  name?: string;
  email?: string;
  notes?: string;
  group_name?: string;
  encrypted_envelope?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function fetchContacts(
  mailboxId: string,
  search?: string,
  group?: string,
  token?: string
): Promise<ContactItem[]> {
  const params = new URLSearchParams();
  if (search) params.append("search", search);
  if (group) params.append("group", group);
  const qs = params.toString();
  const url = `/v1/mailboxes/${mailboxId}/contacts${qs ? `?${qs}` : ""}`;
  const res = await apiRequest<{ contacts: ContactItem[] }>(url, undefined, token);
  return res.contacts || [];
}

export async function createContact(
  mailboxId: string,
  payload: {
    name?: string;
    email?: string;
    notes?: string;
    group_name?: string;
    encrypted_envelope?: string;
  }
): Promise<ContactItem> {
  return apiRequest<ContactItem>(`/v1/mailboxes/${mailboxId}/contacts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateContact(
  mailboxId: string,
  contactId: string,
  payload: {
    name?: string;
    email?: string;
    notes?: string;
    group_name?: string;
    encrypted_envelope?: string;
    version?: number;
  }
): Promise<ContactItem> {
  return apiRequest<ContactItem>(`/v1/mailboxes/${mailboxId}/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteContact(mailboxId: string, contactId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/contacts/${contactId}`, {
    method: "DELETE",
  });
}

export async function importContacts(
  mailboxId: string,
  payload: { format: "csv" | "vcard"; data: string }
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  return apiRequest<{ imported: number; skipped: number; errors: string[] }>(
    `/v1/mailboxes/${mailboxId}/contacts/import`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export function getExportContactsUrl(mailboxId: string, format: "csv" | "vcard"): string {
  return `/v1/mailboxes/${mailboxId}/contacts/export?format=${format}`;
}

export interface MailboxFolder {
  id: string;
  mailbox_id: string;
  name: string;
  parent_id?: string;
  notify: boolean;
  color?: string;
  created_at: string;
}

export interface MailboxLabel {
  id: string;
  mailbox_id: string;
  name: string;
  color: string;
  color_name: string;
  created_at: string;
  parent_label_id?: string | null;
  sort_order?: number;
  path?: string;
  unread_count?: number;
}

export async function fetchFolders(mailboxId: string, token?: string): Promise<MailboxFolder[]> {
  const res = await apiRequest<{ folders: MailboxFolder[] }>(`/v1/mailboxes/${mailboxId}/folders`, undefined, token);
  return res.folders || [];
}

export async function createFolder(
  mailboxId: string,
  payload: { name: string; parent_id?: string | null; notify?: boolean; color?: string }
): Promise<MailboxFolder> {
  return apiRequest<MailboxFolder>(`/v1/mailboxes/${mailboxId}/folders`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateFolder(
  mailboxId: string,
  folderId: string,
  payload: { name: string; parent_id?: string | null; notify?: boolean; color?: string }
): Promise<MailboxFolder> {
  return apiRequest<MailboxFolder>(`/v1/mailboxes/${mailboxId}/folders/${folderId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteFolder(mailboxId: string, folderId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/folders/${folderId}`, {
    method: "DELETE",
  });
}

export async function fetchLabels(mailboxId: string, token?: string): Promise<MailboxLabel[]> {
  const res = await apiRequest<{ labels: MailboxLabel[] }>(`/v1/mailboxes/${mailboxId}/labels`, undefined, token);
  return res.labels || [];
}

export async function createLabel(
  mailboxId: string,
  payload: {
    name: string;
    color?: string;
    color_name?: string;
    parent_label_id?: string | null;
    sort_order?: number;
  }
): Promise<MailboxLabel> {
  return apiRequest<MailboxLabel>(`/v1/mailboxes/${mailboxId}/labels`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateLabel(
  mailboxId: string,
  labelId: string,
  payload: {
    name?: string;
    color?: string;
    color_name?: string;
    parent_label_id?: string | null;
    sort_order?: number;
  }
): Promise<MailboxLabel> {
  return apiRequest<MailboxLabel>(`/v1/mailboxes/${mailboxId}/labels/${labelId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export const patchLabel = updateLabel;

export async function deleteLabel(mailboxId: string, labelId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/labels/${labelId}`, {
    method: "DELETE",
  });
}

export async function updateMessageFolder(
  mailboxId: string,
  messageId: string,
  folder: string,
  folderId?: string | null,
  token?: string
): Promise<{ status: string; message_id: string; folder: string; folder_id?: string }> {
  return apiRequest<{ status: string; message_id: string; folder: string; folder_id?: string }>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/folder`,
    {
      method: "PUT",
      body: JSON.stringify({ folder, folder_id: folderId ?? null }),
    },
    token
  );
}

export async function deleteMessage(mailboxId: string, messageId: string, token?: string): Promise<void> {
  return apiRequest<void>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}`,
    {
      method: "DELETE",
    },
    token
  );
}

export async function emptyTrash(mailboxId: string, token?: string): Promise<{ status: string; deleted_count: number }> {
  return apiRequest<{ status: string; deleted_count: number }>(
    `/v1/mailboxes/${mailboxId}/messages/trash`,
    {
      method: "DELETE",
    },
    token
  );
}

export async function attachMessageLabel(
  mailboxId: string,
  messageId: string,
  labelId: string,
  token?: string
): Promise<{ status: string; message_id: string; label_id: string }> {
  return apiRequest<{ status: string; message_id: string; label_id: string }>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/labels`,
    {
      method: "POST",
      body: JSON.stringify({ label_id: labelId }),
    },
    token
  );
}

export async function detachMessageLabel(
  mailboxId: string,
  messageId: string,
  labelId: string,
  token?: string
): Promise<void> {
  return apiRequest<void>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/labels/${labelId}`,
    {
      method: "DELETE",
    },
    token
  );
}

export async function setMessageRead(
  mailboxId: string,
  messageId: string,
  read: boolean,
  token?: string
): Promise<void> {
  return apiRequest<void>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/read`,
    {
      method: "PUT",
      body: JSON.stringify({ read }),
    },
    token
  );
}

export async function toggleMessageStar(
  mailboxId: string,
  messageId: string,
  starred: boolean,
  token?: string
): Promise<{ is_starred: boolean }> {
  return apiRequest<{ is_starred: boolean }>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/star`,
    {
      method: "PATCH",
      body: JSON.stringify({ starred }),
    },
    token
  );
}

export async function fetchAttachments(mailboxId: string, token?: string): Promise<AttachmentItem[]> {
  const res = await apiRequest<{ attachments: AttachmentItem[] }>(`/v1/mailboxes/${mailboxId}/attachments`, undefined, token);
  return res.attachments || [];
}

export async function fetchMailboxDetail(mailboxId: string, token?: string): Promise<MailboxDetail> {
  return apiRequest<MailboxDetail>(`/v1/mailboxes/${mailboxId}`, undefined, token);
}

export async function fetchMessages(mailboxId: string, folder?: string, token?: string): Promise<MessageMetadata[]> {
  const url = folder
    ? `/v1/mailboxes/${mailboxId}/messages?folder=${encodeURIComponent(folder)}`
    : `/v1/mailboxes/${mailboxId}/messages`;
  const res = await apiRequest<{ messages: MessageMetadata[] }>(url, undefined, token);
  return res.messages || [];
}

export async function snoozeMessage(
  mailboxId: string,
  messageId: string,
  snoozedUntil: string | null,
  token?: string
): Promise<{ snoozed_until: string | null }> {
  return apiRequest(`/v1/mailboxes/${mailboxId}/messages/${messageId}/snooze`, {
    method: "POST",
    body: JSON.stringify({ snoozed_until: snoozedUntil }),
  }, token);
}

export async function fetchThreads(
  mailboxId: string,
  folder?: string,
  token?: string
): Promise<ThreadSummary[]> {
  const url = folder
    ? `/v1/mailboxes/${mailboxId}/threads?folder=${encodeURIComponent(folder)}`
    : `/v1/mailboxes/${mailboxId}/threads`;
  const resp = await apiRequest<{ threads: ThreadSummary[] }>(url, undefined, token);
  return resp.threads || [];
}

export async function fetchThreadMessages(
  mailboxId: string,
  threadId: string,
  token?: string
): Promise<MessageMetadata[]> {
  const resp = await apiRequest<{ messages: MessageMetadata[] }>(
    `/v1/mailboxes/${mailboxId}/threads/${threadId}`,
    undefined,
    token
  );
  return resp.messages || [];
}

export async function fetchMessageBody(mailboxId: string, messageId: string, token?: string): Promise<MessageBodyResponse> {
  return apiRequest<MessageBodyResponse>(`/v1/mailboxes/${mailboxId}/messages/${messageId}/body`, undefined, token);
}

export interface UploadAttachmentV2Options {
  mailboxPkBytes: Uint8Array;
  ownerKeyVersion: number;
  attachmentId?: string;
}

export async function fetchAttachmentMetadata(
  mailboxId: string,
  attachmentId: string,
  token?: string,
): Promise<AttachmentItem> {
  return apiRequest<AttachmentItem>(
    `/v1/mailboxes/${mailboxId}/attachments/${attachmentId}`,
    undefined,
    token,
  );
}

export async function uploadEncryptedAttachment(
  mailboxId: string,
  file: File,
  mailboxKey: Uint8Array,
  messageId?: string,
  token?: string,
  signal?: AbortSignal,
  v2Options?: UploadAttachmentV2Options,
): Promise<AttachmentItem> {
  const arrayBuffer = await file.arrayBuffer();
  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }
  const plaintextBytes = new Uint8Array(arrayBuffer);

  const formData = new FormData();
  if (v2Options && v2Options.mailboxPkBytes?.length === 32 && v2Options.ownerKeyVersion > 0) {
    const v2 = await encryptAttachmentV2({
      plaintextBytes,
      mailboxId,
      mailboxPkBytes: v2Options.mailboxPkBytes,
      ownerKeyVersion: v2Options.ownerKeyVersion,
      attachmentId: v2Options.attachmentId,
    });
    if (signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    const cleanName = sanitizeFilenameV2(file.name);
    const cleanMime = canonicalMimeTypeV2(file.type);
    const encryptedBlob = new Blob([v2.ciphertextBytes.buffer as ArrayBuffer], {
      type: "application/octet-stream",
    });
    formData.append("file", encryptedBlob, cleanName);
    formData.append("crypto_version", String(v2.cryptoVersion));
    formData.append("attachment_id", v2.attachmentId);
    formData.append("filename", cleanName);
    formData.append("content_type", cleanMime);
    formData.append("plaintext_size_bytes", String(v2.plaintextSizeBytes));
    formData.append("blob_aad_version", String(v2.blobAadVersion));
    formData.append("owner_wrap_alg", v2.ownerWrapAlg);
    formData.append("owner_key_version", String(v2.ownerKeyVersion));
    formData.append("owner_pk_sha256", v2.ownerPkSha256Hex);
    formData.append("cek_owner_wrapped", v2.cekOwnerWrappedB64);
    formData.append("plaintext_sha256", v2.plaintextSha256Hex);
    formData.append("ciphertext_sha256", v2.ciphertextSha256Hex);
  } else {
    // Encrypt client-side using Section 12 WASM primitive before network transit (v1 fallback)
    const ciphertextBytes = encryptAttachmentBytes(plaintextBytes, mailboxKey);
    if (signal?.aborted) {
      throw new DOMException("Upload aborted", "AbortError");
    }
    const encryptedBlob = new Blob([ciphertextBytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
    formData.append("file", encryptedBlob, file.name);
  }
  if (messageId) {
    formData.append("message_id", messageId);
  }

  const headers: Record<string, string> = { "X-BYOS-Client": "webmail" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const activeMb = mailboxId || currentActiveMailboxId;
  if (activeMb) {
    headers["X-BYOS-Active-Mailbox"] = activeMb;
  }

  const response = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/attachments`, {
    method: "POST",
    credentials: "include",
    headers,
    body: formData,
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const err = new Error(errorText || `Failed to upload attachment: status ${response.status}`) as Error & {
      status?: number;
    };
    err.status = response.status;
    throw err;
  }

  return (await response.json()) as AttachmentItem;
}

export async function downloadAttachment(mailboxId: string, attachmentId: string, token?: string): Promise<Blob> {
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (mailboxId) {
    authHeaders["X-BYOS-Active-Mailbox"] = mailboxId;
  } else if (currentActiveMailboxId) {
    authHeaders["X-BYOS-Active-Mailbox"] = currentActiveMailboxId;
  }

  const response = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/attachments/${attachmentId}?download=true`, {
    credentials: "include",
    headers: {
      "X-BYOS-Client": "webmail",
      ...authHeaders,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Failed to download attachment: status ${response.status}`);
  }

  return await response.blob();
}

export async function downloadAndDecryptAttachment(
  mailboxId: string,
  attachmentId: string,
  mailboxKey: Uint8Array,
  token?: string,
  attachmentMeta?: Partial<AttachmentItem>,
): Promise<Blob> {
  let meta = attachmentMeta;
  if (!meta) {
    try {
      meta = await fetchAttachmentMetadata(mailboxId, attachmentId, token);
    } catch {
      meta = undefined;
    }
  }

  const encryptedBlob = await downloadAttachment(mailboxId, attachmentId, token);
  const encryptedBytes = new Uint8Array(await encryptedBlob.arrayBuffer());

  if (meta?.crypto_version === 2 && meta.cek_owner_wrapped) {
    const decryptedBytes = await decryptAttachmentV2({
      ciphertextBytes: encryptedBytes,
      mailboxId,
      attachmentId,
      mailboxSkBytes: mailboxKey,
      cekOwnerWrappedB64: meta.cek_owner_wrapped,
      ownerKeyVersion: meta.owner_key_version || 1,
      expectedPlaintextSha256Hex: meta.plaintext_sha256,
      expectedSizeBytes: meta.size_bytes,
      cryptoVersion: meta.crypto_version,
      blobAadVersion: meta.blob_aad_version || 2,
    });
    return new Blob([decryptedBytes.slice().buffer as ArrayBuffer], {
      type: meta.content_type || encryptedBlob.type || "application/octet-stream",
    });
  }

  // Decrypt client-side using Section 12 WASM primitive (v1 fallback).
  // slice() copies into an exact-size ArrayBuffer-backed view so the Blob
  // can never alias bytes outside the decrypted range.
  const decryptedBytes = decryptAttachmentBytes(encryptedBytes, mailboxKey);

  return new Blob([decryptedBytes.slice().buffer as ArrayBuffer], {
    type: meta?.content_type || encryptedBlob.type,
  });
}

export async function deleteAttachment(mailboxId: string, attachmentId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/attachments/${attachmentId}`, {
    method: "DELETE",
  });
}

export interface ImportEmailResponse {
  status: "imported" | "already_imported";
  message_id: string;
  message_seq?: number;
  storage_object_id: string;
}

export async function importEmail(
  mailboxId: string,
  rawEmlB64: string,
  folder?: string,
  isRead?: boolean
): Promise<ImportEmailResponse> {
  return apiRequest<ImportEmailResponse>(`/v1/mailboxes/${mailboxId}/messages/import`, {
    method: "POST",
    body: JSON.stringify({
      raw_eml: rawEmlB64,
      folder: folder || "inbox",
      is_read: isRead ?? false,
    }),
  });
}

export async function prepareOutbound(mailboxId: string, token?: string): Promise<PrepareResponse> {
  return apiRequest<PrepareResponse>("/v1/outbound/prepare", {
    method: "POST",
    body: JSON.stringify({ mailbox_id: mailboxId }),
  }, token);
}

export async function fetchOutboundPubkeyDetail(token?: string): Promise<OutboundPubkeyResponse> {
  const res = await apiRequest<OutboundPubkeyResponse>("/v1/outbound/pubkey", undefined, token);
  if (!res.outbound_delivery_pk) {
    throw new Error("Outbound delivery key is not configured");
  }
  return res;
}

export async function fetchOutboundPubkey(token?: string): Promise<string> {
  const res = await fetchOutboundPubkeyDetail(token);
  return res.outbound_delivery_pk;
}

export async function sendOutbound(payload: SendPayload, token?: string): Promise<{ delivery_id: string; status: string }> {
  return apiRequest<{ delivery_id: string; status: string }>("/v1/outbound/send", {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function scheduleOutbound(payload: SchedulePayload): Promise<{ delivery_id: string; scheduled_at: string; status: string }> {
  return apiRequest<{ delivery_id: string; scheduled_at: string; status: string }>("/v1/outbound/schedule", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface SearchTokensResponse {
  message_ids: string[];
}

export async function searchMailboxTokens(mailboxId: string, tokenHex: string, token?: string): Promise<string[]> {
  const res = await apiRequest<SearchTokensResponse>(
    `/v1/mailboxes/${mailboxId}/search?token=${encodeURIComponent(tokenHex)}`,
    undefined,
    token
  );
  return res.message_ids || [];
}

export async function indexSearchToken(mailboxId: string, messageId: string, tokenHex: string, token?: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/search`, {
    method: "POST",
    body: JSON.stringify({ message_id: messageId, token: tokenHex }),
  }, token);
}

export interface VerifyInvitationResponse {
  valid: boolean;
  error?: string;
  invitation_id: string;
  email: string;
  organization_id: string;
  organization_name: string;
  mailbox_id: string;
  privacy_mode: "private";
  expires_at: string;
  mailbox_pk?: string;
  wrapped_sk_org?: string;
  temp_wrapped_sk?: string;
}

export interface ClaimInvitationRequest {
  token: string;
  password?: string;
  password_hash?: string;
  salt?: string;
  wrapped_sk_user: string;
  mailbox_pk?: string;
  xwing_pk?: string;
  two_factor_method?: "totp" | "passkey" | "phone" | "email";
  totp_secret?: string;
  passkey_cred_id?: string;
  passkey_public_key?: string;
  passkey_device?: string;
  recovery_email?: string;
  recovery_phone?: string;
}

export interface ClaimInvitationResponse {
  success: boolean;
  user_id: string;
  email: string;
  org_id: string;
  mailbox_id: string;
  privacy_mode: string;
  token?: string;
}

export async function verifyInvitation(token: string): Promise<VerifyInvitationResponse> {
  return apiRequest<VerifyInvitationResponse>(`/v1/auth/invitations/verify?token=${encodeURIComponent(token)}`);
}

export async function claimInvitation(req: ClaimInvitationRequest): Promise<ClaimInvitationResponse> {
  return apiRequest<ClaimInvitationResponse>("/v1/auth/invitations/claim", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export interface MailboxSettings {
  mailbox_id: string;
  display_name: string;
  signature_plain: string;
  signature_html: string;
  insert_signature_on_reply: boolean;
  recovery_phrase_wrapped?: string;
  recovery_phrase_salt?: string;
  density: "compact" | "cozy" | "comfortable";
  layout_mode: "split" | "full";
  theme: "cloud_dancer" | "dark";
  language?: string;
  time_format?: "12h" | "24h";
  week_start?: "sunday" | "monday" | "saturday";
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}

export interface SessionItem {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

export interface AutoReplyRule {
  id?: string;
  mailbox_id: string;
  is_active: boolean;
  subject_template: string;
  body_template: string;
  reply_all: boolean;
  allowed_senders: string[];
  blocked_senders: string[];
  start_time?: string;
  end_time?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BridgeCredential {
  id: string;
  label: string;
  token?: string;
  created_at: string;
  last_used_at?: string | null;
}

export interface MailboxAlias {
  id: string;
  local_part: string;
  domain_id: string;
  domain_name?: string;
  is_active: boolean;
  created_at?: string;
}

export async function fetchMailboxSettings(mailboxId: string, token?: string): Promise<MailboxSettings> {
  return apiRequest<MailboxSettings>(`/v1/mailboxes/${mailboxId}/settings`, undefined, token);
}

export async function updateMailboxSettings(
  mailboxId: string,
  settings: Partial<MailboxSettings>,
  token?: string
): Promise<MailboxSettings> {
  return apiRequest<MailboxSettings>(`/v1/mailboxes/${mailboxId}/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  }, token);
}

export async function fetchActiveSessions(): Promise<SessionItem[]> {
  const res = await apiRequest<{ sessions: SessionItem[] }>("/v1/auth/sessions");
  return res.sessions || [];
}

export interface OrgMember {
  id: string;
  email: string;
  display_name: string;
  role: "owner" | "admin" | "member";
  is_active: boolean;
  has_mailbox?: boolean;
}

export async function fetchOrganizationMembers(): Promise<OrgMember[]> {
  try {
    const res = await apiRequest<{ members: OrgMember[] }>("/v1/auth/organization-members");
    return res.members || [];
  } catch {
    return [];
  }
}

export async function revokeOtherSessions(): Promise<{ success: boolean; revoked_count: number }> {
  return apiRequest<{ success: boolean; revoked_count: number }>("/v1/auth/sessions/revoke-others", {
    method: "POST",
  });
}

export async function verifyAccountPassword(password: string): Promise<{ valid: boolean; error?: string }> {
  return apiRequest<{ valid: boolean; error?: string }>("/v1/auth/verify-password", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function fetchAutoReplyRule(mailboxId: string): Promise<AutoReplyRule> {
  return apiRequest<AutoReplyRule>(`/v1/mailboxes/${mailboxId}/auto-reply`);
}

export async function updateAutoReplyRule(mailboxId: string, rule: Partial<AutoReplyRule>): Promise<AutoReplyRule> {
  return apiRequest<AutoReplyRule>(`/v1/mailboxes/${mailboxId}/auto-reply`, {
    method: "PUT",
    body: JSON.stringify(rule),
  });
}

export async function listBridgeCredentials(mailboxId: string): Promise<BridgeCredential[]> {
  const res = await apiRequest<{ credentials: BridgeCredential[] }>(`/v1/mailboxes/${mailboxId}/bridge/credentials`);
  return res.credentials || [];
}

export async function createBridgeCredential(mailboxId: string, label: string): Promise<BridgeCredential> {
  return apiRequest<BridgeCredential>(`/v1/mailboxes/${mailboxId}/bridge/credentials`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export async function revokeBridgeCredential(mailboxId: string, credentialId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/bridge/credentials/${credentialId}`, {
    method: "DELETE",
  });
}

export async function fetchMailboxAliases(mailboxId: string, token?: string): Promise<MailboxAlias[]> {
  try {
    const res = await apiRequest<{ aliases: MailboxAlias[] }>(`/v1/mailboxes/${mailboxId}/aliases`, undefined, token);
    return res.aliases || [];
  } catch (err) {
    console.warn("fetchMailboxAliases error:", err);
    return [];
  }
}

// ── Password Change & 2-Step Verification (2FA) ──

export interface TwoFactorStatus {
  two_factor_enabled: boolean;
  has_totp: boolean;
  recovery_email?: string;
  recovery_phone?: string;
  has_passkey?: boolean;
  is_owner?: boolean;
}

export interface TOTPSetupResponse {
  secret: string;
  otpauth_url: string;
}

export async function fetch2FAStatus(): Promise<TwoFactorStatus> {
  return apiRequest<TwoFactorStatus>("/v1/auth/2fa/status");
}

export async function setupTOTP(): Promise<TOTPSetupResponse> {
  return apiRequest<TOTPSetupResponse>("/v1/auth/2fa/totp/setup", {
    method: "POST",
  });
}

export async function verifyTOTP(secret: string, code: string): Promise<{ valid: boolean; error?: string }> {
  return apiRequest<{ valid: boolean; error?: string }>("/v1/auth/2fa/totp/verify", {
    method: "POST",
    body: JSON.stringify({ secret, code }),
  });
}

export async function disableTOTP(password: string): Promise<{ success: boolean; error?: string }> {
  return apiRequest<{ success: boolean; error?: string }>("/v1/auth/2fa/totp/disable", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function saveRecoveryMethods(recoveryEmail: string, recoveryPhone: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>("/v1/auth/2fa/recovery-methods", {
    method: "POST",
    body: JSON.stringify({ recovery_email: recoveryEmail, recovery_phone: recoveryPhone }),
  });
}

export async function changeAccountPassword(
  newPassword: string,
  wrappedSkUser?: string,
  currentPassword?: string,
  mfaCode?: string,
  mailboxId?: string
): Promise<void> {
  const payload: Record<string, string> = { new_password: newPassword };
  if (wrappedSkUser) {
    payload.wrapped_sk_user = wrappedSkUser;
  }
  if (currentPassword) {
    payload.current_password = currentPassword;
  }
  if (mfaCode) {
    payload.mfa_code = mfaCode;
  }
  if (mailboxId) {
    payload.mailbox_id = mailboxId;
  }
  return apiRequest<void>("/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface ExceptionalRecoveryRequestResponse {
  request_id: string;
  challenge_token: string;
  expires_at: string;
}

export async function requestExceptionalRecovery(
  orgId: string,
  email: string
): Promise<ExceptionalRecoveryRequestResponse> {
  return apiRequest<ExceptionalRecoveryRequestResponse>(`/v1/organizations/${encodeURIComponent(orgId)}/exceptional-recovery`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPasswordWithExceptionalApproval(
  challengeToken: string,
  newPassword: string
): Promise<{ status: string; message: string }> {
  return apiRequest<{ status: string; message: string }>("/v1/auth/recovery/exceptional-reset", {
    method: "POST",
    body: JSON.stringify({
      challenge_token: challengeToken,
      new_password: newPassword,
    }),
  });
}


// ── Custom Filters & Sieve Filters ──

export interface FilterCondition {
  field: "from" | "to" | "subject" | "attachment";
  comparator: "contains" | "is" | "starts_with" | "ends_with" | "not_contains";
  value: string;
}

export interface FilterActions {
  folder?: string;
  folder_id?: string;
  label_ids?: string[];
  mark_read?: boolean;
  star?: boolean;
}

export interface FilterRulesJSON {
  match: "all" | "any";
  conditions: FilterCondition[];
  actions: FilterActions;
}

export interface MailRule {
  id: string;
  mailbox_id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match_sender?: string | null;
  match_recipient?: string | null;
  match_has_attachments?: boolean | null;
  match_min_size_bytes?: number | null;
  action_type: "move" | "label" | "mark_read" | "delete" | "category";
  action_folder?: string | null;
  action_label_id?: string | null;
  action_category?: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchRules(mailboxId: string, token?: string): Promise<MailRule[]> {
  return apiRequest<MailRule[]>(`/v1/mailboxes/${mailboxId}/rules`, undefined, token);
}

export async function createRule(
  mailboxId: string,
  rule: Partial<MailRule>
): Promise<MailRule> {
  return apiRequest<MailRule>(`/v1/mailboxes/${mailboxId}/rules`, {
    method: "POST",
    body: JSON.stringify(rule),
  });
}

export async function updateRule(
  mailboxId: string,
  ruleId: string,
  rule: Partial<MailRule>
): Promise<MailRule> {
  return apiRequest<MailRule>(`/v1/mailboxes/${mailboxId}/rules/${ruleId}`, {
    method: "PUT",
    body: JSON.stringify(rule),
  });
}

export async function deleteRule(mailboxId: string, ruleId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/rules/${ruleId}`, {
    method: "DELETE",
  });
}

export interface FilterItem {
  id: string;
  mailbox_id: string;
  name: string;
  filter_type: "custom" | "sieve";
  rules_json?: FilterRulesJSON;
  sieve_script?: string;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function fetchFilters(mailboxId: string, token?: string): Promise<FilterItem[]> {
  return apiRequest<FilterItem[]>(`/v1/mailboxes/${mailboxId}/filters`, undefined, token);
}

export async function createFilter(
  mailboxId: string,
  filter: {
    name: string;
    filter_type: "custom" | "sieve";
    rules_json?: FilterRulesJSON;
    sieve_script?: string;
    priority?: number;
    is_active?: boolean;
  }
): Promise<FilterItem> {
  return apiRequest<FilterItem>(`/v1/mailboxes/${mailboxId}/filters`, {
    method: "POST",
    body: JSON.stringify(filter),
  });
}

export async function updateFilter(
  mailboxId: string,
  filterId: string,
  filter: Partial<FilterItem>
): Promise<FilterItem> {
  return apiRequest<FilterItem>(`/v1/mailboxes/${mailboxId}/filters/${filterId}`, {
    method: "PUT",
    body: JSON.stringify(filter),
  });
}

export async function deleteFilter(mailboxId: string, filterId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/filters/${filterId}`, {
    method: "DELETE",
  });
}

// ── Spam, Block, and Allow Lists ──

export interface AddressRuleItem {
  id: string;
  mailbox_id: string;
  list_type: "spam" | "block" | "allow";
  target_type: "address" | "domain";
  value: string;
  created_at: string;
}

export async function fetchAddressRules(mailboxId: string, listType?: string, token?: string): Promise<AddressRuleItem[]> {
  const url = listType
    ? `/v1/mailboxes/${mailboxId}/address-rules?list_type=${encodeURIComponent(listType)}`
    : `/v1/mailboxes/${mailboxId}/address-rules`;
  return apiRequest<AddressRuleItem[]>(url, undefined, token);
}

export async function createAddressRule(
  mailboxId: string,
  rule: { list_type: "spam" | "block" | "allow"; target_type?: "address" | "domain"; value: string }
): Promise<AddressRuleItem> {
  return apiRequest<AddressRuleItem>(`/v1/mailboxes/${mailboxId}/address-rules`, {
    method: "POST",
    body: JSON.stringify(rule),
  });
}

export async function deleteAddressRule(mailboxId: string, ruleId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/address-rules/${ruleId}`, {
    method: "DELETE",
  });
}

// ── Message Open Tracking ──

export interface MessageTrackingItem {
  id: string;
  mailbox_id: string;
  tracking_token: string;
  subject: string;
  recipient: string;
  open_count: number;
  first_opened_at?: string;
  last_opened_at?: string;
  created_at: string;
}

export async function registerTracking(
  mailboxId: string,
  trackingToken: string,
  subject: string,
  recipient: string
): Promise<MessageTrackingItem> {
  return apiRequest<MessageTrackingItem>(`/v1/mailboxes/${mailboxId}/tracking`, {
    method: "POST",
    body: JSON.stringify({ tracking_token: trackingToken, subject, recipient }),
  });
}

export async function fetchTrackingList(mailboxId: string, token?: string): Promise<MessageTrackingItem[]> {
  return apiRequest<MessageTrackingItem[]>(`/v1/mailboxes/${mailboxId}/tracking`, undefined, token);
}

export async function fetchTrackingItem(mailboxId: string, token: string): Promise<MessageTrackingItem> {
  return apiRequest<MessageTrackingItem>(`/v1/mailboxes/${mailboxId}/tracking/${encodeURIComponent(token)}`);
}

// ── WebAuthn / Passkeys (FIDO2 Biometrics & Hardware Keys) ──

export interface UserPasskey {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  device_name: string;
  aaguid?: string;
  created_at: string;
  last_used_at?: string;
}

export interface PasskeyRegisterOptionsResponse {
  challenge: string;
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  authenticatorSelection: { residentKey?: string; userVerification?: string };
  timeout: number;
}

export interface PasskeyLoginOptionsResponse {
  challenge: string;
  rpId: string;
  userVerification: string;
  timeout: number;
  allowCredentials?: Array<{ type: string; id: string }>;
}

export async function fetchPasskeyRegisterOptions(): Promise<PasskeyRegisterOptionsResponse> {
  return apiRequest<PasskeyRegisterOptionsResponse>("/v1/auth/passkeys/register-options");
}

export async function registerPasskey(data: any): Promise<UserPasskey> {
  return apiRequest<UserPasskey>("/v1/auth/passkeys/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function fetchPasskeyLoginOptions(email?: string): Promise<PasskeyLoginOptionsResponse> {
  const url = email
    ? `/v1/auth/passkeys/login-options?email=${encodeURIComponent(email)}`
    : "/v1/auth/passkeys/login-options";
  return apiRequest<PasskeyLoginOptionsResponse>(url);
}

export async function loginWithPasskey(data: any): Promise<{ token: string; user?: any; [key: string]: any }> {
  return apiRequest<{ token: string; user?: any }>("/v1/auth/passkeys/login", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function fetchPasskeyStepUpOptions(): Promise<PasskeyLoginOptionsResponse> {
  return apiRequest<PasskeyLoginOptionsResponse>("/v1/auth/passkeys/step-up-options");
}

export async function verifyPasskeyStepUp(payload: any): Promise<{ success: boolean; step_up_token: string }> {
  return apiRequest<{ success: boolean; step_up_token: string }>("/v1/auth/passkeys/step-up-verify", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listPasskeys(): Promise<UserPasskey[]> {
  return apiRequest<UserPasskey[]>("/v1/auth/passkeys");
}

export async function deletePasskey(id: string): Promise<void> {
  return apiRequest<void>(`/v1/auth/passkeys/${id}`, {
    method: "DELETE",
  });
}

// ── Two-Tier Recovery Flow & Key Reactivation ──

export interface RecoveryRequestResponse {
  challenge_token: string;
  method: string;
  destination_masked: string;
  expires_at: string;
  mailbox_id?: string;
  wrapped_sk_user?: string;
  debug_code?: string;
}

export async function requestRecoveryChallenge(
  email: string,
  method: "email" | "phone" | "totp" | "passkey" = "email"
): Promise<RecoveryRequestResponse> {
  return apiRequest<RecoveryRequestResponse>("/v1/auth/recovery/request", {
    method: "POST",
    body: JSON.stringify({ email, method }),
  });
}

export async function resetPasswordWithRecovery(
  challengeToken: string,
  code: string,
  newPassword: string,
  newMailboxPk?: string,
  newWrappedSkUser?: string
): Promise<{ token: string; user?: any; [key: string]: any }> {
  return apiRequest<{ token: string; user?: any }>("/v1/auth/recovery/reset-password", {
    method: "POST",
    body: JSON.stringify({
      challenge_token: challengeToken,
      code,
      new_password: newPassword,
      new_mailbox_pk: newMailboxPk || undefined,
      new_wrapped_sk_user: newWrappedSkUser || undefined,
    }),
  });
}

export interface PrepareReactivationResponse {
  migration_id: string;
  mailbox_id: string;
  status: string;
  expires_at: string;
}

export interface PendingReactivationResponse {
  migration_id: string;
  mailbox_id: string;
  status: string;
  candidate_wrapped_sk: string;
  candidate_mailbox_pk?: string;
  expires_at: string;
}

export interface FinalizeReactivationResponse {
  success: boolean;
  migration_id: string;
  mailbox_id: string;
  status: string;
  message: string;
}

export interface RollbackReactivationResponse {
  success: boolean;
  migration_id: string;
  mailbox_id: string;
  status: string;
  restored_at?: string;
}

export async function prepareHistoricalKeyReactivation(
  mailboxId: string,
  candidateWrappedSk: string,
  mailboxPk?: string
): Promise<PrepareReactivationResponse> {
  return apiRequest<PrepareReactivationResponse>(`/v1/mailboxes/${mailboxId}/reactivate-keys/prepare`, {
    method: "POST",
    body: JSON.stringify({
      wrapped_sk_user: candidateWrappedSk,
      mailbox_pk: mailboxPk || undefined,
    }),
  });
}

export async function fetchPendingHistoricalKeyReactivation(
  mailboxId: string,
  migrationId?: string
): Promise<PendingReactivationResponse> {
  const url = migrationId
    ? `/v1/mailboxes/${mailboxId}/reactivate-keys/${migrationId}`
    : `/v1/mailboxes/${mailboxId}/reactivate-keys/pending`;
  return apiRequest<PendingReactivationResponse>(url, {
    method: "GET",
  });
}

export async function finalizeHistoricalKeyReactivation(
  mailboxId: string,
  migrationId: string
): Promise<FinalizeReactivationResponse> {
  return apiRequest<FinalizeReactivationResponse>(`/v1/mailboxes/${mailboxId}/reactivate-keys/finalize`, {
    method: "POST",
    body: JSON.stringify({
      migration_id: migrationId,
    }),
  });
}

export async function rollbackHistoricalKeyReactivation(
  mailboxId: string,
  migrationId: string,
  reason?: string
): Promise<RollbackReactivationResponse> {
  return apiRequest<RollbackReactivationResponse>(`/v1/mailboxes/${mailboxId}/reactivate-keys/rollback`, {
    method: "POST",
    body: JSON.stringify({
      migration_id: migrationId,
      reason: reason || "client_verification_failed",
    }),
  });
}

export async function reactivateHistoricalKeys(
  mailboxId: string,
  wrappedSkUser: string,
  mailboxPk?: string
): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(`/v1/mailboxes/${mailboxId}/reactivate-keys`, {
    method: "POST",
    body: JSON.stringify({
      wrapped_sk_user: wrappedSkUser,
      mailbox_pk: mailboxPk || undefined,
    }),
  });
}

export async function verifyLogin2FA(challengeToken: string, code: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/v1/auth/2fa/verify-login", {
    method: "POST",
    body: JSON.stringify({
      challenge_token: challengeToken,
      code: code,
    }),
  });
}

export async function sendLogin2FACode(
  challengeToken: string,
  method: "email" | "phone"
): Promise<{
  success: boolean;
  method: string;
  destination_masked: string;
  debug_code?: string;
}> {
  return apiRequest<{
    success: boolean;
    method: string;
    destination_masked: string;
    debug_code?: string;
  }>("/v1/auth/2fa/send-code", {
    method: "POST",
    body: JSON.stringify({
      challenge_token: challengeToken,
      method: method,
    }),
  });
}

export interface RecoveryOptionItem {
  type: "email" | "phone" | "totp" | "passkey";
  destination_masked: string;
}

export type RecoveryMethodOption = RecoveryOptionItem;

export async function fetchRecoveryOptions(
  email: string
): Promise<{ email: string; methods: RecoveryOptionItem[] }> {
  return apiRequest<{ email: string; methods: RecoveryOptionItem[] }>(
    `/v1/auth/recovery/options?email=${encodeURIComponent(email)}`
  );
}
export interface KeyDirectoryRecord {
  email_address: string;
  key_id: string;
  key_epoch: number;
  xwing_public_key: string;
  ed25519_signing_public_key: string;
  signing_key_epoch: number;
  status: string;
  updated_at: string;
}

export async function lookupMailboxKeys(
  email: string,
): Promise<KeyDirectoryRecord> {
  return apiRequest<KeyDirectoryRecord>(
    `/v1/keys/${encodeURIComponent(email)}`,
  );
}

export async function publishMailboxKeys(
  payload: {
    xwing_public_key?: string;
    ed25519_signing_public_key: string;
  },
  token?: string,
  mailboxId?: string,
): Promise<{ status: string; key_epoch: number; signing_key_epoch: number }> {
  const headers: Record<string, string> = {};
  if (mailboxId) {
    headers["X-BYOS-Active-Mailbox"] = mailboxId;
  }
  return apiRequest("/v1/keys/me", {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  }, token);
}

export interface InternalSendRequest {
  envelope_json: string;
  sender_envelope_json?: string;
  recipient: string;
  sender_mailbox_id: string;
  attachment_envelopes?: AttachmentEnvelope[];
  sender_attachment_envelopes?: AttachmentEnvelope[];
  alias_id?: string;
  sender_email?: string;
  client_queue_id?: string;
}

export interface InternalSendResponse {
  delivery_id: string;
  message_id: string;
  status: "delivered" | "already_delivered";
  message_seq: number;
}

export async function sendInternal(
  req: InternalSendRequest,
  token?: string,
): Promise<InternalSendResponse> {
  return apiRequest<InternalSendResponse>("/v1/outbound/send-internal", {
    method: "POST",
    body: JSON.stringify(req),
  }, token);
}

export async function uploadAttachmentChunk(
  mailboxId: string,
  storageRef: string,
  chunkBytes: Uint8Array,
  token?: string,
  signal?: AbortSignal,
): Promise<void> {
  const body =
    chunkBytes.byteOffset === 0 && chunkBytes.byteLength === chunkBytes.buffer.byteLength
      ? chunkBytes
      : chunkBytes.slice();

  await apiRequest(
    `/v1/mailboxes/${mailboxId}/attachment-chunks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Object-Key": storageRef,
      },
      body: body as unknown as BodyInit,
      signal,
    },
    token,
  );
}

export async function fetchMessageAttachmentEnvelopes(
  mailboxId: string,
  messageId: string,
  token?: string,
): Promise<AttachmentEnvelope[]> {
  try {
    const res = await apiRequest<{ attachments: AttachmentEnvelope[] }>(
      `/v1/mailboxes/${mailboxId}/messages/${messageId}/attachments`,
      undefined,
      token,
    );
    return res.attachments || [];
  } catch (err) {
    console.warn("fetchMessageAttachmentEnvelopes error:", err);
    return [];
  }
}

export async function fetchMessageAttachmentChunk(
  mailboxId: string,
  messageId: string,
  attachmentId: string,
  chunkIndex: number,
  token?: string,
): Promise<Uint8Array> {
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (mailboxId) {
    authHeaders["X-BYOS-Active-Mailbox"] = mailboxId;
  } else if (currentActiveMailboxId) {
    authHeaders["X-BYOS-Active-Mailbox"] = currentActiveMailboxId;
  }

  const response = await fetch(
    `${apiBase()}/v1/mailboxes/${mailboxId}/messages/${messageId}/attachments/${attachmentId}/chunks/${chunkIndex}`,
    {
      credentials: "include",
      headers: {
        "X-BYOS-Client": "webmail",
        ...authHeaders,
      },
    },
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Failed to fetch chunk ${chunkIndex}: ${response.status} ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export interface MaskedAliasItem {
  id: string;
  alias_address: string;
  label: string;
  is_enabled: boolean;
  created_at: string;
  disabled_at: string | null;
  reply_count: number;
}

export interface MaskedAliasesResponse {
  aliases: MaskedAliasItem[];
}

export async function fetchMaskedAliases(token?: string): Promise<MaskedAliasesResponse> {
  return apiRequest<MaskedAliasesResponse>("/v1/users/me/aliases", undefined, token);
}

export interface CreateMaskedAliasOptions {
  label?: string;
  local_part?: string;
}

export async function createMaskedAlias(
  arg1?: string | CreateMaskedAliasOptions,
  arg2?: string,
  arg3?: string
): Promise<MaskedAliasItem> {
  let label = "";
  let localPart: string | undefined;
  let token: string | undefined;

  if (typeof arg1 === "object" && arg1 !== null) {
    label = arg1.label || "";
    localPart = arg1.local_part;
    token = arg2;
  } else {
    label = arg1 || "";
    if (arg3 !== undefined) {
      localPart = arg2;
      token = arg3;
    } else {
      token = arg2;
    }
  }

  const payload: { label: string; local_part?: string } = { label };
  if (localPart && localPart.trim()) {
    payload.local_part = localPart.trim();
  }

  try {
    return await apiRequest<MaskedAliasItem>("/v1/users/me/aliases", {
      method: "POST",
      body: JSON.stringify(payload),
    }, token);
  } catch (err: any) {
    if (err?.status === 409) {
      let parsed: any;
      try {
        parsed = JSON.parse(err.message);
      } catch {}
      if (parsed?.error === "alias_taken" || err.message?.includes("alias_taken") || err.message?.includes("alias already exists")) {
        const error = new Error("That alias is already taken. Try a different name.") as Error & { status: number };
        error.status = 409;
        throw error;
      }
    } else if (err?.status === 400) {
      let parsed: any;
      try {
        parsed = JSON.parse(err.message);
      } catch {}
      if (parsed?.error === "invalid_local_part" && parsed?.message) {
        const error = new Error(parsed.message) as Error & { status: number };
        error.status = 400;
        throw error;
      }
    }
    throw err;
  }
}

export const createAlias = createMaskedAlias;

export async function updateMaskedAlias(
  aliasId: string,
  payload: { label?: string; is_enabled?: boolean },
  token?: string
): Promise<MaskedAliasItem> {
  return apiRequest<MaskedAliasItem>(`/v1/users/me/aliases/${aliasId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, token);
}

export async function deleteMaskedAlias(aliasId: string, token?: string): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(`/v1/users/me/aliases/${aliasId}`, {
    method: "DELETE",
  }, token);
}

// ── Calendar Subsystem ──

export interface UserCalendar {
  id: string;
  mailbox_id: string;
  name: string;
  color?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  is_shared?: boolean;
  permission?: "owner" | "read" | "write";
  owner_email?: string;
  encrypted_key?: string;
  share_id?: string;
  template?: string;
  description?: string;
}

export interface CalendarShare {
  id: string;
  calendar_id: string;
  grantor_mailbox_id: string;
  grantee_mailbox_id: string;
  grantee_email: string;
  permission: "read" | "write";
  encrypted_key?: string;
  status: "active" | "revoked";
  created_at: string;
  updated_at: string;
}

export interface CalendarEventExceptionItem {
  id: string;
  parent_event_id: string;
  mailbox_id: string;
  calendar_id: string;
  recurrence_id: string;
  is_cancelled: boolean;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  status: string;
  encrypted_payload: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventItem {
  id: string;
  mailbox_id: string;
  calendar_id: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  rrule?: string;
  status: string;
  encrypted_payload: string;
  exceptions?: CalendarEventExceptionItem[];
  created_at: string;
  updated_at: string;
}

export async function fetchCalendars(mailboxId: string, token?: string): Promise<UserCalendar[]> {
  return apiRequest<UserCalendar[]>(`/v1/mailboxes/${mailboxId}/calendars`, undefined, token);
}

export async function createCalendar(
  mailboxId: string,
  payload: { name: string; color?: string; is_default?: boolean },
  token?: string
): Promise<UserCalendar> {
  return apiRequest<UserCalendar>(`/v1/mailboxes/${mailboxId}/calendars`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function updateCalendar(
  mailboxId: string,
  calendarId: string,
  payload: { name?: string; color?: string; is_default?: boolean },
  token?: string
): Promise<UserCalendar> {
  return apiRequest<UserCalendar>(`/v1/mailboxes/${mailboxId}/calendars/${calendarId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, token);
}

export async function deleteCalendar(mailboxId: string, calendarId: string, token?: string): Promise<void> {
  await apiRequest<void>(`/v1/mailboxes/${mailboxId}/calendars/${calendarId}`, {
    method: "DELETE",
  }, token);
}

export async function fetchCalendarShares(
  mailboxId: string,
  calendarId: string,
  token?: string
): Promise<CalendarShare[]> {
  return apiRequest<CalendarShare[]>(
    `/v1/mailboxes/${mailboxId}/calendars/${calendarId}/shares`,
    undefined,
    token
  );
}

export async function shareCalendar(
  mailboxId: string,
  calendarId: string,
  payload: { grantee_email: string; permission: "read" | "write"; encrypted_key?: string },
  token?: string
): Promise<CalendarShare> {
  return apiRequest<CalendarShare>(
    `/v1/mailboxes/${mailboxId}/calendars/${calendarId}/shares`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function updateCalendarShare(
  mailboxId: string,
  calendarId: string,
  shareId: string,
  payload: { permission?: "read" | "write"; status?: "active" | "revoked" },
  token?: string
): Promise<CalendarShare> {
  return apiRequest<CalendarShare>(
    `/v1/mailboxes/${mailboxId}/calendars/${calendarId}/shares/${shareId}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function revokeCalendarShare(
  mailboxId: string,
  calendarId: string,
  shareId: string,
  token?: string
): Promise<void> {
  await apiRequest<void>(
    `/v1/mailboxes/${mailboxId}/calendars/${calendarId}/shares/${shareId}`,
    {
      method: "DELETE",
    },
    token
  );
}

export async function fetchCalendarEvents(
  mailboxId: string,
  start?: string,
  end?: string,
  calendarId?: string,
  token?: string
): Promise<CalendarEventItem[]> {
  const params = new URLSearchParams();
  if (start) params.append("start", start);
  if (end) params.append("end", end);
  if (calendarId) params.append("calendar_id", calendarId);
  const qs = params.toString();
  return apiRequest<CalendarEventItem[]>(`/v1/mailboxes/${mailboxId}/calendar-events${qs ? `?${qs}` : ""}`, undefined, token);
}

export interface CreateCalendarEventInput {
  calendar_id: string;
  start_time: string;
  end_time: string;
  is_all_day?: boolean;
  rrule?: string;
  status?: string;
  encrypted_payload: string;
  exceptions?: CalendarEventExceptionItem[];
}

export interface UpdateCalendarEventInput {
  calendar_id?: string;
  start_time?: string;
  end_time?: string;
  is_all_day?: boolean;
  rrule?: string;
  status?: string;
  encrypted_payload?: string;
}

export async function createCalendarEvent(
  mailboxId: string,
  payload: CreateCalendarEventInput,
  token?: string
): Promise<CalendarEventItem> {
  return apiRequest<CalendarEventItem>(`/v1/mailboxes/${mailboxId}/calendar-events`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function updateCalendarEvent(
  mailboxId: string,
  eventId: string,
  payload: UpdateCalendarEventInput,
  token?: string
): Promise<CalendarEventItem> {
  return apiRequest<CalendarEventItem>(`/v1/mailboxes/${mailboxId}/calendar-events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, token);
}

export async function deleteCalendarEvent(mailboxId: string, eventId: string, token?: string): Promise<void> {
  await apiRequest<void>(`/v1/mailboxes/${mailboxId}/calendar-events/${eventId}`, {
    method: "DELETE",
  }, token);
}


export async function fetchCalendarEventExceptions(
  mailboxId: string,
  eventId: string,
  token?: string
): Promise<CalendarEventExceptionItem[]> {
  return apiRequest<CalendarEventExceptionItem[]>(`/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/exceptions`, undefined, token);
}

export async function createCalendarEventException(
  mailboxId: string,
  eventId: string,
  payload: {
    recurrence_id: string;
    is_cancelled: boolean;
    start_time: string;
    end_time: string;
    is_all_day?: boolean;
    status?: string;
    encrypted_payload: string;
  },
  token?: string
): Promise<CalendarEventExceptionItem> {
  return apiRequest<CalendarEventExceptionItem>(`/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/exceptions`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function updateCalendarEventException(
  mailboxId: string,
  eventId: string,
  exceptionId: string,
  payload: {
    is_cancelled?: boolean;
    start_time?: string;
    end_time?: string;
    is_all_day?: boolean;
    status?: string;
    encrypted_payload?: string;
  },
  token?: string
): Promise<CalendarEventExceptionItem> {
  return apiRequest<CalendarEventExceptionItem>(`/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/exceptions/${exceptionId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  }, token);
}

export async function deleteCalendarEventException(
  mailboxId: string,
  eventId: string,
  exceptionId: string,
  token?: string
): Promise<void> {
  await apiRequest<void>(`/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/exceptions/${exceptionId}`, {
    method: "DELETE",
  }, token);
}

export interface StagedMigrationResponse {
  migration_id: string;
  event_id: string;
  status: string;
  expires_at: string;
  updated_at: string;
  etag: string;
}

export interface FinalizedMigrationResponse {
  migration_id: string;
  event_id: string;
  status: string;
  finalized_at: string;
}

export interface RollbackMigrationResponse {
  migration_id: string;
  event_id: string;
  status: string;
  restored_at: string;
}

export interface MigrationStatusResponse {
  event_id: string;
  has_active_migration: boolean;
  migration_id?: string;
  status?: string;
  expires_at?: string;
}

export async function apiRequestWithHeaders<T>(
  path: string,
  init?: RequestInit,
  token?: string
): Promise<{ data: T; headers: Headers }> {
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders["Authorization"] = `Bearer ${token}`;
  }
  if (!(init?.headers as Record<string, string> | undefined)?.["X-BYOS-Active-Mailbox"]) {
    const mbxMatch = path.match(/^\/v1\/mailboxes\/([0-9a-fA-F-]+)/);
    if (mbxMatch && mbxMatch[1]) {
      authHeaders["X-BYOS-Active-Mailbox"] = mbxMatch[1];
    } else if (currentActiveMailboxId && !path.startsWith("/v1/auth/")) {
      authHeaders["X-BYOS-Active-Mailbox"] = currentActiveMailboxId;
    }
  }

  const response = await fetch(`${apiBase()}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-BYOS-Client": "webmail",
      ...authHeaders,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    let errorCode: string | undefined;
    try {
      const parsed = JSON.parse(errorText);
      errorCode = parsed?.error || parsed?.code;
    } catch {}

    const error = new Error(errorText || `API error ${response.status}`) as Error & {
      status: number;
      code?: string;
      retryAfter?: number;
      headers?: Headers;
    };
    error.status = response.status;
    if (errorCode) {
      error.code = errorCode;
    }
    const retryAfterHeader = response.headers?.get ? response.headers.get("Retry-After") : undefined;
    if (retryAfterHeader) {
      const parsedSec = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsedSec) && parsedSec >= 0) {
        error.retryAfter = parsedSec;
      } else {
        const parsedDate = Date.parse(retryAfterHeader);
        if (!isNaN(parsedDate)) {
          const diffMs = parsedDate - Date.now();
          error.retryAfter = Math.max(0, Math.ceil(diffMs / 1000));
        }
      }
    }
    error.headers = response.headers;
    throw error;
  }

  const data = (response.status === 204 ? undefined : await response.json()) as T;
  return { data, headers: response.headers };
}

export async function fetchCalendarEventWithETag(
  mailboxId: string,
  eventId: string,
  token?: string
): Promise<{ event: CalendarEventItem; etag: string }> {
  const res = await apiRequestWithHeaders<CalendarEventItem>(
    `/v1/mailboxes/${mailboxId}/calendar-events/${eventId}`,
    { method: "GET" },
    token
  );
  const etag = res.headers.get("ETag") || "";
  return { event: res.data, etag };
}

export async function stageCalendarEventMigration(
  mailboxId: string,
  eventId: string,
  stagedPayload: string,
  ifMatchEtag: string,
  token?: string
): Promise<StagedMigrationResponse> {
  const res = await apiRequestWithHeaders<StagedMigrationResponse>(
    `/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/stage-migration`,
    {
      method: "POST",
      headers: {
        "If-Match": ifMatchEtag,
      },
      body: JSON.stringify({ staged_encrypted_payload: stagedPayload }),
    },
    token
  );
  return res.data;
}

export async function finalizeCalendarEventMigration(
  mailboxId: string,
  eventId: string,
  migrationId: string,
  token?: string
): Promise<FinalizedMigrationResponse> {
  return apiRequest<FinalizedMigrationResponse>(
    `/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/finalize-migration`,
    {
      method: "POST",
      body: JSON.stringify({ migration_id: migrationId }),
    },
    token
  );
}

export async function rollbackCalendarEventMigration(
  mailboxId: string,
  eventId: string,
  migrationId: string,
  reason: string,
  token?: string
): Promise<RollbackMigrationResponse> {
  return apiRequest<RollbackMigrationResponse>(
    `/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/rollback-migration`,
    {
      method: "POST",
      body: JSON.stringify({ migration_id: migrationId, reason }),
    },
    token
  );
}

export async function fetchCalendarEventMigrationStatus(
  mailboxId: string,
  eventId: string,
  token?: string
): Promise<MigrationStatusResponse> {
  return apiRequest<MigrationStatusResponse>(
    `/v1/mailboxes/${mailboxId}/calendar-events/${eventId}/migration-status`,
    { method: "GET" },
    token
  );
}

/** Store an encrypted object in customer-owned storage via the storage gateway */
export async function storeMailboxStorageObject(
  mailboxId: string,
  objectKey: string,
  data: Uint8Array,
  token?: string,
  signal?: AbortSignal
): Promise<{ status: string; object_key: string; size_bytes: number }> {
  const base = apiBase();
  const activeToken = token || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("byos_active_session_token")) || undefined;
  const res = await fetch(`${base}/v1/mailboxes/${mailboxId}/storage/store`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Object-Key": objectKey,
      "X-BYOS-Client": "webmail",
      "X-BYOS-Active-Mailbox": mailboxId,
      ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
    },
    credentials: "include",
    body: data as unknown as BodyInit,
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to store storage object (${res.status}): ${errText}`);
  }
  return res.json();
}

/** Retrieve an encrypted object from customer-owned storage via the storage gateway */
export async function retrieveMailboxStorageObject(
  mailboxId: string,
  objectKey: string,
  token?: string,
  signal?: AbortSignal
): Promise<Uint8Array | null> {
  const base = apiBase();
  const activeToken = token || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("byos_active_session_token")) || undefined;
  const res = await fetch(
    `${base}/v1/mailboxes/${mailboxId}/storage/retrieve?key=${encodeURIComponent(objectKey)}`,
    {
      method: "GET",
      headers: {
        "X-BYOS-Client": "webmail",
        "X-BYOS-Active-Mailbox": mailboxId,
        ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
      },
      credentials: "include",
      signal,
    }
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to retrieve storage object (${res.status}): ${errText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/** List objects in customer-owned storage under a prefix */
export async function listMailboxStorageObjects(
  mailboxId: string,
  prefix: string,
  token?: string,
  signal?: AbortSignal
): Promise<{ objects: string[]; count: number }> {
  const base = apiBase();
  const activeToken = token || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("byos_active_session_token")) || undefined;
  const res = await fetch(
    `${base}/v1/mailboxes/${mailboxId}/storage/list?prefix=${encodeURIComponent(prefix)}`,
    {
      method: "GET",
      headers: {
        "X-BYOS-Client": "webmail",
        "X-BYOS-Active-Mailbox": mailboxId,
        ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
      },
      credentials: "include",
      signal,
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to list storage objects (${res.status}): ${errText}`);
  }
  return res.json();
}

/** Delete an object from customer-owned storage */
export async function deleteMailboxStorageObject(
  mailboxId: string,
  objectKey: string,
  token?: string,
  signal?: AbortSignal
): Promise<boolean> {
  const base = apiBase();
  const activeToken = token || (typeof sessionStorage !== "undefined" && sessionStorage.getItem("byos_active_session_token")) || undefined;
  const res = await fetch(`${base}/v1/mailboxes/${mailboxId}/storage/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Object-Key": objectKey,
      "X-BYOS-Client": "webmail",
      "X-BYOS-Active-Mailbox": mailboxId,
      ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
    },
    credentials: "include",
    body: JSON.stringify({ object_key: objectKey }),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Failed to delete storage object (${res.status}): ${errText}`);
  }
  return true;
}
