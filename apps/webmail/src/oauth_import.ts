import { apiBase, apiRequest } from "./api";
import { hexToBytes, mailboxIdHex } from "./message_crypto";

export interface OAuthTokens {
  provider: "gmail" | "outlook";
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // ms timestamp
}

export interface ImportJobItem {
  id: string;
  provider: string;
  status: "running" | "completed" | "failed" | "cancelled";
  total_messages: number;
  imported_messages: number;
  skipped_messages: number;
  failed_messages: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  created_at: string;
}

export interface ImportMessageMetadataPayload {
  source_provider: string;
  source_message_id: string;
  storage_object_id: string;
  sender: string;
  recipients?: string[];
  direction?: "received" | "sent";
  folder?: string;
  is_read?: boolean;
  is_starred?: boolean;
  has_attachments?: boolean;
  attachment_count?: number;
  size_bytes?: number;
  received_at?: string;
  sent_at?: string;
  content_key_hpke_wrapped?: string;
  encryption_iv?: string;
  bundle_hash?: string;
  wrapped_key_algorithm?: string;
  labels?: string[];
}

export interface ImportMessageResponse {
  status: "imported" | "already_imported";
  imported: boolean;
  reason?: string;
  message_id: string;
  message_seq?: number;
}

/** Compute AAD for draft / imported message envelope */
export function computeEnvelopeAad(mailboxId: string, prefix = "byos-draft-v1"): Uint8Array {
  const pre = new TextEncoder().encode(prefix);
  const mid = hexToBytes(mailboxIdHex(mailboxId));
  const aad = new Uint8Array(pre.length + mid.length);
  aad.set(pre, 0);
  aad.set(mid, pre.length);
  return aad;
}

/**
 * Encrypt a raw EML plaintext into a Section 12 AES-GCM envelope
 * [0x01 (version)] [12-byte IV] [Ciphertext + 16-byte Tag]
 */
export async function encryptRawEml(
  mailboxKey: Uint8Array,
  mailboxId: string,
  rawEml: string
): Promise<Uint8Array> {
  const plaintext = new TextEncoder().encode(rawEml);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = computeEnvelopeAad(mailboxId, "byos-draft-v1");

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    mailboxKey as unknown as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      additionalData: aad as unknown as BufferSource,
    },
    cryptoKey,
    plaintext as unknown as BufferSource
  );

  const ciphertext = new Uint8Array(ciphertextBuffer);
  const out = new Uint8Array(1 + 12 + ciphertext.length);
  out[0] = 0x01;
  out.set(iv, 1);
  out.set(ciphertext, 13);
  return out;
}

/**
 * Encrypt OAuth tokens client-side using mailbox key.
 * D1: Tokens are encrypted before upload to customer storage.
 */
export async function encryptTokenPayload(
  mailboxKey: Uint8Array,
  tokens: OAuthTokens
): Promise<Uint8Array> {
  const jsonStr = JSON.stringify(tokens);
  const data = new TextEncoder().encode(jsonStr);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    mailboxKey as unknown as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    cryptoKey,
    data as unknown as BufferSource
  );

  const ciphertext = new Uint8Array(ciphertextBuffer);
  const out = new Uint8Array(1 + 12 + ciphertext.length);
  out[0] = 0x01;
  out.set(iv, 1);
  out.set(ciphertext, 13);
  return out;
}

/** Decrypt OAuth tokens from client-side encrypted envelope */
export async function decryptTokenPayload(
  mailboxKey: Uint8Array,
  encryptedBytes: Uint8Array
): Promise<OAuthTokens> {
  if (encryptedBytes.length < 29 || encryptedBytes[0] !== 0x01) {
    throw new Error("Invalid encrypted token envelope");
  }

  const iv = encryptedBytes.subarray(1, 13);
  const ciphertext = encryptedBytes.subarray(13);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    mailboxKey as unknown as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"]
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    cryptoKey,
    ciphertext as unknown as BufferSource
  );

  const jsonStr = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(jsonStr) as OAuthTokens;
}

/** Store encrypted tokens in customer storage */
export async function storeTokens(
  mailboxId: string,
  mailboxKey: Uint8Array,
  provider: "gmail" | "outlook",
  tokens: OAuthTokens
): Promise<void> {
  const encrypted = await encryptTokenPayload(mailboxKey, tokens);
  const objectKey = `mailboxes/${mailboxId}/oauth/${provider}.enc`;
  await storeEncryptedStorageObject(mailboxId, objectKey, encrypted);
}

/** Load and decrypt tokens from customer storage */
export async function loadTokens(
  mailboxId: string,
  mailboxKey: Uint8Array,
  provider: "gmail" | "outlook"
): Promise<OAuthTokens | null> {
  const objectKey = `mailboxes/${mailboxId}/oauth/${provider}.enc`;
  const raw = await retrieveEncryptedStorageObject(mailboxId, objectKey);
  if (!raw || raw.length === 0) return null;

  try {
    return await decryptTokenPayload(mailboxKey, raw);
  } catch (err) {
    console.warn("Failed to decrypt stored OAuth tokens:", err);
    return null;
  }
}

/** Store encrypted blob to customer storage via API gateway */
export async function storeEncryptedStorageObject(
  mailboxId: string,
  objectKey: string,
  data: Uint8Array
): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/storage/store`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Object-Key": objectKey,
      "X-BYOS-Client": "webmail",
      "X-BYOS-Active-Mailbox": mailboxId,
    },
    credentials: "include",
    body: data as unknown as BodyInit,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to store storage object: ${res.status} ${errText}`);
  }
}

/** Retrieve encrypted blob from customer storage via API gateway */
export async function retrieveEncryptedStorageObject(
  mailboxId: string,
  objectKey: string
): Promise<Uint8Array | null> {
  const res = await fetch(
    `${apiBase()}/v1/mailboxes/${mailboxId}/storage/retrieve?key=${encodeURIComponent(objectKey)}`,
    {
      method: "GET",
      headers: {
        "X-BYOS-Client": "webmail",
        "X-BYOS-Active-Mailbox": mailboxId,
      },
      credentials: "include",
    }
  );

  if (res.status === 404) return null;
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to retrieve storage object: ${res.status} ${errText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/** Request OAuth authorization URL from backend */
export async function beginImportOAuth(
  provider: "gmail" | "outlook",
  mailboxId: string
): Promise<{ auth_url: string; state: string }> {
  return apiRequest<{ auth_url: string; state: string }>("/v1/import/begin", {
    method: "POST",
    body: JSON.stringify({ provider, mailbox_id: mailboxId }),
  });
}

/** Create new import job row */
export async function createImportJob(
  mailboxId: string,
  provider: string,
  totalMessages: number
): Promise<string> {
  const res = await apiRequest<{ job_id: string; status: string }>("/v1/import/jobs", {
    method: "POST",
    body: JSON.stringify({
      mailbox_id: mailboxId,
      provider,
      total_messages: totalMessages,
    }),
  });
  return res.job_id;
}

/** Mark import job completed / failed / cancelled */
export async function completeImportJob(
  jobId: string,
  status: "completed" | "failed" | "cancelled",
  imported: number,
  skipped: number,
  failed: number,
  errorMessage?: string
): Promise<void> {
  await apiRequest<{ job_id: string; status: string }>("/v1/import/complete", {
    method: "POST",
    body: JSON.stringify({
      job_id: jobId,
      status,
      imported_messages: imported,
      skipped_messages: skipped,
      failed_messages: failed,
      error_message: errorMessage || "",
    }),
  });
}

/** List past import jobs for mailbox */
export async function listImportJobs(mailboxId: string): Promise<ImportJobItem[]> {
  const res = await apiRequest<{ jobs: ImportJobItem[] }>(`/v1/import/jobs?mailbox_id=${encodeURIComponent(mailboxId)}`);
  return res.jobs || [];
}

/** Insert imported message metadata into Postgres (idempotent) */
export async function importMessageMetadata(
  mailboxId: string,
  payload: ImportMessageMetadataPayload
): Promise<ImportMessageResponse> {
  return apiRequest<ImportMessageResponse>(`/v1/mailboxes/${mailboxId}/import-message`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
