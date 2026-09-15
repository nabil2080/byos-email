import { encryptAttachmentBytes, decryptAttachmentBytes } from "./attachment_crypto";

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
}

export interface Mailbox {
  id: string;
  local_part: string;
  domain_id: string;
  mode: string;
  public_key?: string;
  wrapped_sk_user?: string;
  previous_wrapped_sk_user?: string;
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
  byte_size?: number;
  encrypted: boolean;
  created_at: string;
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
}

export interface MessageBodyResponse {
  encrypted_body: string;
  content_key_hpke_wrapped: string;
  encryption_iv: string;
  aad_version: number;
  bundle_hash: string;
  encryption_version: number;
  message_seq: number;
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

export function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
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

export interface ConnectedAccount {
  id: string;             // mailbox_id
  email: string;          // e.g. billing@testorg.byos
  displayName: string;
  role: string;
  privacyMode: string;
  sessionToken: string;   // Auth token for this mailbox
  mailboxSkHex: string;   // Unsealed private key in memory
  searchKeyHex: string;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const impersonationToken =
    typeof window !== "undefined" ? sessionStorage.getItem("byos_impersonation_token") : null;
  const activeToken =
    typeof window !== "undefined" ? sessionStorage.getItem("byos_active_session_token") : null;
  const authHeaders: Record<string, string> = {};
  if (activeToken) {
    authHeaders["Authorization"] = `Bearer ${activeToken}`;
  } else if (impersonationToken) {
    authHeaders["Authorization"] = `Bearer ${impersonationToken}`;
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
}

/** Password login. The session travels in an HttpOnly cookie set by the
    server; the password itself is never stored — cleared after the request. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** Server-side session revocation. Callers must still clear local state even
    when this throws (network failure must not keep a signed-in UI alive). */
export async function logout(): Promise<void> {
  await apiRequest<void>("/v1/auth/logout", { method: "POST" });
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

export async function updateDraft(
  mailboxId: string,
  draftId: string,
  payload: { subject: string; recipient: string; encrypted_envelope: string; version: number }
): Promise<DraftMessage> {
  return apiRequest<DraftMessage>(`/v1/mailboxes/${mailboxId}/drafts/${draftId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export interface ContactItem {
  id: string;
  mailbox_id: string;
  encrypted_envelope: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function fetchContacts(mailboxId: string): Promise<ContactItem[]> {
  try {
    const res = await apiRequest<{ contacts: ContactItem[] }>(`/v1/mailboxes/${mailboxId}/contacts`);
    return res.contacts || [];
  } catch (err) {
    console.warn("fetchContacts error:", err);
    return [];
  }
}

export async function createContact(
  mailboxId: string,
  payload: { encrypted_envelope: string }
): Promise<ContactItem> {
  return apiRequest<ContactItem>(`/v1/mailboxes/${mailboxId}/contacts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateContact(
  mailboxId: string,
  contactId: string,
  payload: { encrypted_envelope: string; version: number }
): Promise<ContactItem> {
  return apiRequest<ContactItem>(`/v1/mailboxes/${mailboxId}/contacts/${contactId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteContact(mailboxId: string, contactId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/contacts/${contactId}`, {
    method: "DELETE",
  });
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
}

export async function fetchFolders(mailboxId: string): Promise<MailboxFolder[]> {
  try {
    const res = await apiRequest<{ folders: MailboxFolder[] }>(`/v1/mailboxes/${mailboxId}/folders`);
    return res.folders || [];
  } catch (err) {
    console.warn("fetchFolders error:", err);
    return [];
  }
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

export async function fetchLabels(mailboxId: string): Promise<MailboxLabel[]> {
  try {
    const res = await apiRequest<{ labels: MailboxLabel[] }>(`/v1/mailboxes/${mailboxId}/labels`);
    return res.labels || [];
  } catch (err) {
    console.warn("fetchLabels error:", err);
    return [];
  }
}

export async function createLabel(
  mailboxId: string,
  payload: { name: string; color?: string; color_name?: string }
): Promise<MailboxLabel> {
  return apiRequest<MailboxLabel>(`/v1/mailboxes/${mailboxId}/labels`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateLabel(
  mailboxId: string,
  labelId: string,
  payload: { name: string; color?: string; color_name?: string }
): Promise<MailboxLabel> {
  return apiRequest<MailboxLabel>(`/v1/mailboxes/${mailboxId}/labels/${labelId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteLabel(mailboxId: string, labelId: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/labels/${labelId}`, {
    method: "DELETE",
  });
}

export async function updateMessageFolder(
  mailboxId: string,
  messageId: string,
  folder: string,
  folderId?: string | null
): Promise<{ status: string; message_id: string; folder: string; folder_id?: string }> {
  return apiRequest<{ status: string; message_id: string; folder: string; folder_id?: string }>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/folder`,
    {
      method: "PUT",
      body: JSON.stringify({ folder, folder_id: folderId ?? null }),
    }
  );
}

export async function attachMessageLabel(
  mailboxId: string,
  messageId: string,
  labelId: string
): Promise<{ status: string; message_id: string; label_id: string }> {
  return apiRequest<{ status: string; message_id: string; label_id: string }>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/labels`,
    {
      method: "POST",
      body: JSON.stringify({ label_id: labelId }),
    }
  );
}

export async function detachMessageLabel(
  mailboxId: string,
  messageId: string,
  labelId: string
): Promise<void> {
  return apiRequest<void>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/labels/${labelId}`,
    {
      method: "DELETE",
    }
  );
}

export async function setMessageRead(
  mailboxId: string,
  messageId: string,
  read: boolean
): Promise<void> {
  return apiRequest<void>(
    `/v1/mailboxes/${mailboxId}/messages/${messageId}/read`,
    {
      method: "PUT",
      body: JSON.stringify({ read }),
    }
  );
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

export async function fetchMailboxDetail(mailboxId: string): Promise<MailboxDetail> {
  return apiRequest<MailboxDetail>(`/v1/mailboxes/${mailboxId}`);
}

export async function fetchMessages(mailboxId: string): Promise<MessageMetadata[]> {
  const res = await apiRequest<{ messages: MessageMetadata[] }>(`/v1/mailboxes/${mailboxId}/messages`);
  return res.messages || [];
}

export async function fetchMessageBody(mailboxId: string, messageId: string): Promise<MessageBodyResponse> {
  return apiRequest<MessageBodyResponse>(`/v1/mailboxes/${mailboxId}/messages/${messageId}/body`);
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

export async function downloadAttachment(mailboxId: string, attachmentId: string): Promise<Blob> {
  const response = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/attachments/${attachmentId}?download=true`, {
    credentials: "include",
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
  mailboxKey: Uint8Array
): Promise<Blob> {
  const encryptedBlob = await downloadAttachment(mailboxId, attachmentId);
  const encryptedBytes = new Uint8Array(await encryptedBlob.arrayBuffer());

  // Decrypt client-side using Section 12 WASM primitive.
  // slice() copies into an exact-size ArrayBuffer-backed view so the Blob
  // can never alias bytes outside the decrypted range.
  const decryptedBytes = decryptAttachmentBytes(encryptedBytes, mailboxKey);

  return new Blob([decryptedBytes.slice().buffer as ArrayBuffer], { type: encryptedBlob.type });
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

export interface SearchTokensResponse {
  message_ids: string[];
}

export async function searchMailboxTokens(mailboxId: string, tokenHex: string): Promise<string[]> {
  const res = await apiRequest<SearchTokensResponse>(
    `/v1/mailboxes/${mailboxId}/search?token=${encodeURIComponent(tokenHex)}`
  );
  return res.message_ids || [];
}

export async function indexSearchToken(mailboxId: string, messageId: string, tokenHex: string): Promise<void> {
  return apiRequest<void>(`/v1/mailboxes/${mailboxId}/search`, {
    method: "POST",
    body: JSON.stringify({ message_id: messageId, token: tokenHex }),
  });
}

export interface VerifyInvitationResponse {
  valid: boolean;
  error?: string;
  invitation_id: string;
  email: string;
  organization_id: string;
  organization_name: string;
  mailbox_id: string;
  privacy_mode: "organization_managed" | "private";
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
  two_factor_method?: "totp" | "phone" | "email";
  totp_secret?: string;
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

export async function fetchMailboxSettings(mailboxId: string): Promise<MailboxSettings> {
  return apiRequest<MailboxSettings>(`/v1/mailboxes/${mailboxId}/settings`);
}

export async function updateMailboxSettings(
  mailboxId: string,
  settings: Partial<MailboxSettings>
): Promise<MailboxSettings> {
  return apiRequest<MailboxSettings>(`/v1/mailboxes/${mailboxId}/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function fetchActiveSessions(): Promise<SessionItem[]> {
  const res = await apiRequest<{ sessions: SessionItem[] }>("/v1/auth/sessions");
  return res.sessions || [];
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

export async function fetchMailboxAliases(mailboxId: string): Promise<MailboxAlias[]> {
  try {
    const res = await apiRequest<{ aliases: MailboxAlias[] }>(`/v1/mailboxes/${mailboxId}/aliases`);
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
  recovery_email: string;
  recovery_phone: string;
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

export async function changeAccountPassword(newPassword: string): Promise<void> {
  return apiRequest<void>("/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword }),
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

export async function fetchFilters(mailboxId: string): Promise<FilterItem[]> {
  return apiRequest<FilterItem[]>(`/v1/mailboxes/${mailboxId}/filters`);
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

export async function fetchAddressRules(mailboxId: string, listType?: string): Promise<AddressRuleItem[]> {
  const url = listType
    ? `/v1/mailboxes/${mailboxId}/address-rules?list_type=${encodeURIComponent(listType)}`
    : `/v1/mailboxes/${mailboxId}/address-rules`;
  return apiRequest<AddressRuleItem[]>(url);
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

export async function fetchTrackingList(mailboxId: string): Promise<MessageTrackingItem[]> {
  return apiRequest<MessageTrackingItem[]>(`/v1/mailboxes/${mailboxId}/tracking`);
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

export async function registerPasskey(data: {
  credential_id: string;
  public_key: string;
  device_name: string;
  challenge_token: string;
  aaguid?: string;
}): Promise<UserPasskey> {
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

export async function loginWithPasskey(data: {
  credential_id: string;
  challenge_token: string;
  signature: string;
  client_data_json: string;
}): Promise<{ token: string; user?: any; [key: string]: any }> {
  return apiRequest<{ token: string; user?: any }>("/v1/auth/passkeys/login", {
    method: "POST",
    body: JSON.stringify(data),
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
  method: "email" | "phone" | "totp" = "email"
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
  type: "email" | "phone" | "totp";
  destination_masked: string;
}

export async function fetchRecoveryOptions(
  email: string
): Promise<{ email: string; methods: RecoveryOptionItem[] }> {
  return apiRequest<{ email: string; methods: RecoveryOptionItem[] }>(
    `/v1/auth/recovery/options?email=${encodeURIComponent(email)}`
  );
}





