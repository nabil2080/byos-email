/**
 * Mailbox API client – SolidJS dashboard
 * Wraps org-scoped mailbox endpoints.
 * Never exposes mailbox_sk_wrapped, private keys, ciphertext, or DEK.
 */

export interface Mailbox {
  id: string;
  local_part: string;
  domain_id: string;
  mode: string;
  localPart?: string;
  domainId?: string;
}

export interface Alias {
  id: string;
  local_part: string;
  domain_id: string;
  is_active: boolean;
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

export async function createMailbox(orgId: string, localPart: string, domainId: string, mode: "org_managed" | "private" = "org_managed"): Promise<Mailbox> {
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

export async function createAlias(mailboxId: string, alias: string): Promise<Alias> {
  return request<Alias>(`/v1/mailboxes/${mailboxId}/aliases`, {
    method: "POST",
    body: JSON.stringify({ alias }),
  });
}

export async function listAliases(mailboxId: string): Promise<Alias[]> {
  const body = await request<{ aliases: Alias[] }>(`/v1/mailboxes/${mailboxId}/aliases`, { method: "GET" });
  return body.aliases || [];
}
