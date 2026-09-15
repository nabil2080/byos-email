/**
 * Mailbox API client – SolidJS dashboard
 * Wraps org-scoped mailbox endpoints.
 * Never exposes mailbox_sk_wrapped, private keys, ciphertext, or DEK.
 */

export interface Mailbox {
  id: string;
  local_part: string;
  domain_id: string;
  domain_name?: string;
  email?: string;
  mode: string;
  status?: string;
  wrapped_sk_org?: string;
  mailbox_sk_wrapped?: string;
  localPart?: string;
  domainId?: string;
}

export interface InviteMailboxRequest {
  address: string;
  name?: string;
  privacy_mode: "organization_managed" | "private" | "org_managed";
}

export interface InviteMailboxResponse {
  invitation_id: string;
  invite_url: string;
  mailbox_id: string;
  email: string;
  privacy_mode: string;
  expires_at: string;
}

export interface ImpersonateResponse {
  mailbox_id: string;
  target_user_id: string;
  wrapped_sk_org: string | null;
  session_token: string;
  webmail_url: string;
}

export interface Alias {
  id: string;
  local_part: string;
  domain_id: string;
  is_active: boolean;
}

export interface OrgAlias {
  id: string;
  mailbox_id: string;
  mailbox_local_part: string;
  mailbox_address?: string;
  local_part: string;
  domain_id: string;
  domain_name?: string;
  alias_address?: string;
  is_active: boolean;
  created_at?: string;
}

import { getCpHeaders } from "./client";

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
    ...getCpHeaders(),
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
  // Some endpoints return 201 with json, others 200
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  return {} as T;
}

export async function listMailboxes(orgId: string): Promise<Mailbox[]> {
  const body = await request<{ mailboxes: Mailbox[] }>(`/v1/organizations/${orgId}/mailboxes`, { method: "GET" });
  return body.mailboxes || [];
}

export async function getMailbox(mailboxId: string): Promise<Mailbox> {
  return request<Mailbox>(`/v1/mailboxes/${mailboxId}`, { method: "GET" });
}

export async function deleteMailbox(orgId: string, mailboxId: string): Promise<{ id: string; status: string }> {
  return request<{ id: string; status: string }>(`/v1/organizations/${orgId}/mailboxes/${mailboxId}`, {
    method: "DELETE",
  });
}

export async function recoverMailboxSecret(orgId: string, mailboxId: string, recoverySkHex: string): Promise<string> {
  const material = await request<{ mailbox_id: string; root_secret_wrapped: string }>(
    `/v1/organizations/${orgId}/mailboxes/${mailboxId}/recovery-material`,
    { method: "GET" },
  );
  const mailbox = await getMailbox(mailboxId);
  const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
  const wrappedRoot = atob(material.root_secret_wrapped);
  const wrappedRootHex = Array.from(wrappedRoot, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  const rootSecretHex = wasm.wasm_hpke_open(recoverySkHex.trim(), wrappedRootHex, "");
  const mailboxIdHex = mailboxId.replace(/-/g, "");
  if (!mailbox.mailbox_sk_wrapped) throw new Error("mailbox wrapped key unavailable");
  const wrappedMailboxKey = atob(mailbox.mailbox_sk_wrapped);
  const wrappedMailboxKeyHex = Array.from(wrappedMailboxKey, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  return wasm.wasm_unwrap_mailbox_key(rootSecretHex, wrappedMailboxKeyHex, mailboxIdHex);
}

export async function createMailbox(orgId: string, localPart: string, domainId: string, mode: "org_managed" | "private" = "private"): Promise<Mailbox> {
  // Client-side canonical mailbox crypto: generate UUID BEFORE wrapping (AAD binding)
  const mailboxId = crypto.randomUUID();
  const mailboxIdHex = mailboxId.replace(/-/g, "");
  // Entropy -> derive_root_secret
  const entropy = new Uint8Array(32);
  crypto.getRandomValues(entropy);
  const entropyHex = Array.from(entropy, (b) => b.toString(16).padStart(2, "0")).join("");
  // Import generated WASM bindings (bundler target)
  const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
  const rootSecretHex: string = wasm.wasm_derive_root_secret(entropyHex);
  const kpJson: string = wasm.wasm_generate_keypair();
  const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
  const mailboxPkHex = kp.public_key;
  const mailboxSkHex = kp.secret_key;
  if (mode === "org_managed") {
    // Fetch org recovery public key (public material only) — required for HPKE seal
    const orgData = await request<{ id: string; name: string; org_recovery_pk: string }>(
      `/v1/organizations/${orgId}`,
      { method: "GET" },
    );
    const orgRecoveryPkB64: string = orgData.org_recovery_pk;
    if (!orgRecoveryPkB64 || orgRecoveryPkB64.length < 10) throw new Error("organization recovery key not available");
    // base64 -> hex for WASM
    const orgRecoveryPkHex = (() => {
      const bin = atob(orgRecoveryPkB64);
      return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    })();
    if (orgRecoveryPkHex.length !== 64) throw new Error("invalid org recovery pk");
    // HPKE seal root_secret to org_recovery_pk (empty AAD = canonical empty)
    const rootSecretWrappedHex: string = wasm.wasm_hpke_seal(orgRecoveryPkHex, rootSecretHex, "");
    // Wrap mailbox_sk with root_secret and mailbox_id (canonical AAD = mailbox_id||"mailbox-sk-v1" inside WASM)
    const mailboxSkWrappedHex: string = wasm.wasm_wrap_mailbox_key(rootSecretHex, mailboxSkHex, mailboxIdHex);
    // POST only wrapped material + public key + id + metadata; never send root_secret, mailbox_sk, entropy, mnemonic, org_recovery_sk
    return request<Mailbox>(`/v1/organizations/${orgId}/mailboxes`, {
      method: "POST",
      body: JSON.stringify({
        id: mailboxId,
        local_part: localPart,
        domain_id: domainId,
        mode: "org_managed",
        root_secret_wrapped: rootSecretWrappedHex,
        mailbox_sk_wrapped: mailboxSkWrappedHex,
        mailbox_pk: mailboxPkHex,
      }),
    });
  } else {
    // Private mode: skip org recovery key fetch and HPKE seal
    // Wrap mailbox_sk with root_secret and mailbox_id (canonical AAD = mailbox_id||"mailbox-sk-v1" inside WASM)
    // Root remains user-recoverable via Section 15 material; NOT sealed to org
    const mailboxSkWrappedHex: string = wasm.wasm_wrap_mailbox_key(rootSecretHex, mailboxSkHex, mailboxIdHex);
    // POST only wrapped material + public key + id + metadata; root_secret_wrapped intentionally omitted
    return request<Mailbox>(`/v1/organizations/${orgId}/mailboxes`, {
      method: "POST",
      body: JSON.stringify({
        id: mailboxId,
        local_part: localPart,
        domain_id: domainId,
        mode: "private",
        mailbox_sk_wrapped: mailboxSkWrappedHex,
        mailbox_pk: mailboxPkHex,
      }),
    });
  }
}

export async function inviteMailbox(orgId: string, req: InviteMailboxRequest): Promise<InviteMailboxResponse> {
  const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");

  if (req.privacy_mode === "organization_managed" || req.privacy_mode === "org_managed") {
    // 1. Generate provisional keypair locally in browser
    const kpJson: string = wasm.wasm_generate_keypair();
    const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };

    // 2. Fetch org recovery public key for HPKE seal
    const orgData = await request<{ id: string; name: string; org_recovery_pk: string }>(
      `/v1/organizations/${orgId}`,
      { method: "GET" },
    );
    const orgRecoveryPkB64: string = orgData.org_recovery_pk;
    if (!orgRecoveryPkB64 || orgRecoveryPkB64.length < 10) throw new Error("organization recovery key not available");
    const bin = atob(orgRecoveryPkB64);
    const orgRecoveryPkHex = Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

    // 3. HPKE seal mailbox_sk to org_recovery_pk (wrapped_sk_org)
    const wrappedSkOrgHex = wasm.wasm_hpke_seal(orgRecoveryPkHex, kp.secret_key, "");

    // 4. Generate random 32-byte activation token & seal mailbox_sk under token (temp_wrapped_sk)
    const tokenBytes = new Uint8Array(32);
    crypto.getRandomValues(tokenBytes);
    const tokenHex = Array.from(tokenBytes, (b) => b.toString(16).padStart(2, "0")).join("");
    const tempWrappedSkHex = wasm.wasm_aes_gcm_encrypt(tokenHex, kp.secret_key, "");

    return request<InviteMailboxResponse>(`/v1/organizations/${orgId}/mailboxes/invite`, {
      method: "POST",
      body: JSON.stringify({
        address: req.address,
        name: req.name || req.address.split("@")[0],
        privacy_mode: "organization_managed",
        token: tokenHex,
        mailbox_pk: kp.public_key,
        wrapped_sk_org: wrappedSkOrgHex,
        temp_wrapped_sk: tempWrappedSkHex,
      }),
    });
  } else {
    // Private mode: Zero key material generated or submitted by administrator device!
    return request<InviteMailboxResponse>(`/v1/organizations/${orgId}/mailboxes/invite`, {
      method: "POST",
      body: JSON.stringify({
        address: req.address,
        name: req.name || req.address.split("@")[0],
        privacy_mode: "private",
      }),
    });
  }
}

export async function impersonateMailbox(orgId: string, mailboxId: string): Promise<ImpersonateResponse> {
  return request<ImpersonateResponse>(`/v1/organizations/${orgId}/mailboxes/${mailboxId}/impersonate`, {
    method: "POST",
  });
}

export interface RootRotationResult {
  mailbox_id: string;
  root_secret_id: string;
  version: number;
}

/**
 * Rotate a mailbox recovery root (Section 15). Root-only: the mailbox key is
 * untouched, so existing messages keep decrypting. For private mailboxes the
 * wrap is omitted (server stores NULL); for org-managed pass the new HPKE
 * sealed wrap. The caller must re-enroll the recovery verifier afterwards —
 * it derives from the old root.
 */
export async function rotateRoot(
  orgId: string,
  mailboxId: string,
  rootSecretWrappedHex?: string
): Promise<RootRotationResult> {
  return request<RootRotationResult>(
    `/v1/organizations/${orgId}/mailboxes/${mailboxId}/rotate-root`,
    {
      method: "POST",
      body: JSON.stringify(rootSecretWrappedHex ? { root_secret_wrapped: rootSecretWrappedHex } : {}),
    }
  );
}

export async function createAlias(
  mailboxId: string,
  localPartOrFullAlias: string,
  domainId?: string
): Promise<Alias> {
  const body = domainId
    ? { local_part: localPartOrFullAlias, domain_id: domainId }
    : { alias: localPartOrFullAlias };
  return request<Alias>(`/v1/mailboxes/${mailboxId}/aliases`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteAlias(mailboxId: string, aliasId: string): Promise<void> {
  await request<void>(`/v1/mailboxes/${mailboxId}/aliases/${aliasId}`, {
    method: "DELETE",
  });
}

/**
 * Fetch the organization's PUBLIC recovery key (base64 → hex) for HPKE
 * sealing. Public material only; never handles secrets.
 */
export async function fetchOrgRecoveryPkHex(orgId: string): Promise<string> {
  const orgData = await request<{ id: string; name: string; org_recovery_pk: string }>(
    `/v1/organizations/${orgId}`,
    { method: "GET" }
  );
  const b64: string = orgData.org_recovery_pk;
  if (!b64 || b64.length < 10) throw new Error("organization recovery key not available");
  const bin = atob(b64);
  const hex = Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  if (hex.length !== 64) throw new Error("invalid org recovery pk");
  return hex;
}

export async function listAliases(mailboxId: string): Promise<Alias[]> {
  const body = await request<{ aliases: Alias[] }>(`/v1/mailboxes/${mailboxId}/aliases`, { method: "GET" });
  return body.aliases || [];
}

export async function listOrgAliases(orgId: string): Promise<OrgAlias[]> {
  const body = await request<{ aliases: OrgAlias[] }>(`/v1/organizations/${orgId}/aliases`, { method: "GET" });
  return body.aliases || [];
}
