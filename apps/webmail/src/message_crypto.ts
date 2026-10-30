import { bytesToHex, hexToBytes } from "./attachment_crypto";
export { bytesToHex, hexToBytes };
import type * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";
import { lookupMailboxKeys, type KeyDirectoryRecord } from "./api";

// Client-side message/draft envelope handling (Section 12).
//
// Key custody: mailbox_sk lives only in a UI signal (memory). It is derived
// per unlock from the recovery mnemonic and cleared on mailbox switch,
// lock, and logout. It is never persisted, transmitted, or logged.
//
// Draft envelopes are opaque to the server (structural 0x01 check only):
//   AES-GCM(key=mailbox_sk, plaintext, aad=UTF8("byos-draft-v1") || mailbox_id16)
// Inbound messages use canonical AAD exclusively through
// wasm_canonical_aad — never reconstructed in TypeScript (frozen §13.3).

export const DRAFT_AAD_PREFIX = "byos-draft-v1";
export const CONTACT_AAD_PREFIX = "byos-contact-v1";

export function mailboxIdHex(mailboxId: string): string {
  const hex = mailboxId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error("Invalid mailbox ID");
  }
  return hex;
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chars.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE) as unknown as number[]));
  }
  return btoa(chars.join(""));
}

export function hexToBase64(hex: string): string {
  return bytesToBase64(hexToBytes(hex));
}

/** Derive the in-memory mailbox key. Throws with safe messages on bad input. */
export function unlockMailboxKey(
  wasm: typeof WasmCore,
  mnemonic: string,
  mailboxId: string,
  mailboxSkWrappedB64: string
): Uint8Array {
  const words = mnemonic.trim();
  if (!words) {
    throw new Error("Recovery phrase is required to unlock the mailbox.");
  }
  if (/^[0-9a-fA-F]{64}$/.test(words)) {
    return hexToBytes(words);
  }
  const rootHex: string = wasm.wasm_recover_root_secret(words);
  const skHex: string = wasm.wasm_unwrap_mailbox_key(
    rootHex,
    bytesToHex(base64ToBytes(mailboxSkWrappedB64)),
    mailboxIdHex(mailboxId)
  );
  const sk = hexToBytes(skHex);
  if (sk.length !== 32) {
    throw new Error("Mailbox key unwrap failed.");
  }
  return sk;
}

export interface UnwrappedKeys {
  mailboxSk: Uint8Array;
  signingSeed: Uint8Array | null;
  xwingSeed: Uint8Array | null;
}

/**
 * Automate password-based key unwrapping on login via Argon2id.
 * Unwraps mailbox_sk, signing_seed, and xwing_seed using wasm_passphrase_unwrap_key without 24-word phrase entry.
 */
export function autoUnwrapKeys(
  wasm: typeof WasmCore,
  password: string,
  wrappedSkUser: string
): UnwrappedKeys {
  const trimmed = wrappedSkUser.trim();
  if (!trimmed) {
    throw new Error("Missing wrapped_sk_user");
  }

  let saltHex = "";
  let envelopeHex = "";
  let parsed: any = null;

  if (trimmed.startsWith("{")) {
    try {
      parsed = JSON.parse(trimmed);
      saltHex = parsed.salt || parsed.salt_hex || "";
      envelopeHex = parsed.envelope || parsed.envelope_hex || "";
    } catch {
      throw new Error("Invalid wrapped_sk_user JSON payload");
    }
  } else if (trimmed.includes(":")) {
    const parts = trimmed.split(":");
    saltHex = parts[0];
    envelopeHex = parts[1];
  } else if (trimmed.length >= 32) {
    saltHex = trimmed.slice(0, 32);
    envelopeHex = trimmed.slice(32);
  } else {
    throw new Error("Invalid wrapped_sk_user format");
  }

  if (saltHex.length !== 32) {
    throw new Error("Invalid salt length: must be 16 bytes (32 hex characters)");
  }

  const skHex = wasm.wasm_passphrase_unwrap_key(password, saltHex, envelopeHex);
  const mailboxSk = hexToBytes(skHex);
  if (mailboxSk.length !== 32) {
    throw new Error("Unwrapped mailbox key is invalid length");
  }

  let signingSeed: Uint8Array | null = null;
  if (parsed && parsed.signing_salt && parsed.signing_envelope) {
    try {
      const seedHex = wasm.wasm_passphrase_unwrap_key(
        password,
        parsed.signing_salt,
        parsed.signing_envelope
      );
      const seed = hexToBytes(seedHex);
      if (seed.length === 32) {
        signingSeed = seed;
      }
    } catch (e) {
      // Legacy user or corrupted payload — degrade gracefully
      console.warn("Failed to unwrap signing seed; signing disabled", e);
    }
  }

  let xwingSeed: Uint8Array | null = null;
  if (parsed && parsed.xwing_salt && parsed.xwing_envelope) {
    try {
      const seedHex = wasm.wasm_passphrase_unwrap_key(
        password,
        parsed.xwing_salt,
        parsed.xwing_envelope,
      );
      const seed = hexToBytes(seedHex);
      if (seed.length === 32) {
        xwingSeed = seed;
      }
    } catch (e) {
      console.warn("Failed to unwrap X-Wing seed; Path A read disabled", e);
    }
  }

  return { mailboxSk, signingSeed, xwingSeed };
}

/** Backwards-compatible convenience wrapper returning only mailboxSk */
export function autoUnwrapMailboxKey(
  wasm: typeof WasmCore,
  password: string,
  wrappedSkUser: string
): Uint8Array {
  return autoUnwrapKeys(wasm, password, wrappedSkUser).mailboxSk;
}

export function unwrapMailboxKeyWithRecoveryPhrase(
  wasm: typeof WasmCore,
  mnemonicPhrase: string,
  mailboxId: string,
  wrappedSkUser: string
): Uint8Array {
  const trimmed = wrappedSkUser.trim();
  if (!trimmed) {
    throw new Error("Missing wrapped mailbox key");
  }

  const rootHex = wasm.wasm_recover_root_secret(mnemonicPhrase.trim());
  const boxIdHex = mailboxIdHex(mailboxId);

  let targetEnvelopeHex = trimmed;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.root_wrapped) {
        targetEnvelopeHex = parsed.root_wrapped;
      }
    } catch {}
  }

  const skHex = wasm.wasm_unwrap_mailbox_key(rootHex, targetEnvelopeHex, boxIdHex);
  const sk = hexToBytes(skHex);
  if (sk.length !== 32) {
    throw new Error("Unwrapped mailbox key is invalid length");
  }
  return sk;
}

export function wrapMailboxKeyWithPassphrase(
  wasm: typeof WasmCore,
  password: string,
  mailboxSk: Uint8Array
): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = bytesToHex(salt);
  const skHex = bytesToHex(mailboxSk);
  const envelopeHex = wasm.wasm_passphrase_wrap_key(password, saltHex, skHex);
  return `${saltHex}:${envelopeHex}`;
}

export interface MessageDecryptInput {
  message_seq: number;
  encryption_version: number;
  encrypted_body: string;
  content_key_hpke_wrapped: string;
}

/** Decrypt an inbound message envelope to plaintext. Fails closed on any error. */
export function decryptMessageEnvelope(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array,
  mailboxId: string,
  input: MessageDecryptInput
): string {
  if (!Number.isInteger(input.message_seq) || input.message_seq < 0) {
    throw new Error("Invalid message sequence.");
  }
  const aad: string = wasm.wasm_canonical_aad(
    mailboxIdHex(mailboxId),
    BigInt(input.message_seq),
    input.encryption_version
  );
  const contentKeyHex: string = wasm.wasm_hpke_open(
    bytesToHex(mailboxKey),
    bytesToHex(base64ToBytes(input.content_key_hpke_wrapped)),
    aad
  );
  const plaintextHex: string = wasm.wasm_aes_gcm_decrypt(
    contentKeyHex,
    bytesToHex(base64ToBytes(input.encrypted_body)),
    aad
  );
  return new TextDecoder().decode(hexToBytes(plaintextHex));
}

export function envelopeAadHex(mailboxId: string, prefix: string): string {
  const pre = new TextEncoder().encode(prefix);
  const mid = hexToBytes(mailboxIdHex(mailboxId));
  const aad = new Uint8Array(pre.length + mid.length);
  aad.set(pre, 0);
  aad.set(mid, pre.length);
  return bytesToHex(aad);
}

function draftAadHex(mailboxId: string): string {
  return envelopeAadHex(mailboxId, DRAFT_AAD_PREFIX);
}

/** Encrypt draft plaintext to the base64 envelope the drafts API stores opaquely. */
export function encryptDraftEnvelope(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array,
  mailboxId: string,
  plaintext: string
): string {
  const envelopeHex: string = wasm.wasm_aes_gcm_encrypt(
    bytesToHex(mailboxKey),
    bytesToHex(new TextEncoder().encode(plaintext)),
    draftAadHex(mailboxId)
  );
  return bytesToBase64(hexToBytes(envelopeHex));
}

/** Decrypt a stored draft envelope back to plaintext. */
export function decryptDraftEnvelope(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array,
  mailboxId: string,
  envelopeB64: string
): string {
  const plaintextHex: string = wasm.wasm_aes_gcm_decrypt(
    bytesToHex(mailboxKey),
    bytesToHex(base64ToBytes(envelopeB64)),
    draftAadHex(mailboxId)
  );
  return new TextDecoder().decode(hexToBytes(plaintextHex));
}

export interface ContactPlaintext {
  name: string;
  email: string;
  notes: string;
}

/** Encrypt a contact record to the base64 envelope the contacts API stores opaquely. */
export function encryptContactEnvelope(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array,
  mailboxId: string,
  contact: ContactPlaintext
): string {
  const envelopeHex: string = wasm.wasm_aes_gcm_encrypt(
    bytesToHex(mailboxKey),
    bytesToHex(new TextEncoder().encode(JSON.stringify(contact))),
    envelopeAadHex(mailboxId, CONTACT_AAD_PREFIX)
  );
  return bytesToBase64(hexToBytes(envelopeHex));
}

/** Decrypt a stored contact envelope. The AAD prefix domain-separates
    contacts from drafts: a draft envelope never decrypts here and vice versa. */
export function decryptContactEnvelope(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array,
  mailboxId: string,
  envelopeB64: string
): ContactPlaintext {
  const plaintextHex: string = wasm.wasm_aes_gcm_decrypt(
    bytesToHex(mailboxKey),
    bytesToHex(base64ToBytes(envelopeB64)),
    envelopeAadHex(mailboxId, CONTACT_AAD_PREFIX)
  );
  const parsed = JSON.parse(new TextDecoder().decode(hexToBytes(plaintextHex))) as Partial<ContactPlaintext>;
  return {
    name: typeof parsed.name === "string" ? parsed.name : "",
    email: typeof parsed.email === "string" ? parsed.email : "",
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
  };
}

/** Derive the 32-byte mailbox search key (hex) from the recovery phrase.
    The recovery phrase and derived search key never leave the browser. */
export function deriveSearchKeyFromMnemonic(wasm: typeof WasmCore, mnemonic: string): string {
  const words = mnemonic.trim();
  if (/^[0-9a-fA-F]{64}$/.test(words)) {
    return wasm.wasm_derive_search_key(words);
  }
  const rootHex = wasm.wasm_recover_root_secret(words);
  return wasm.wasm_derive_search_key(rootHex);
}

/** Compute HMAC-SHA256 search token (hex) for a normalized keyword term (Section 16).
    Search key and search terms never leave the client. */
export async function computeSearchToken(searchKeyHex: string, term: string): Promise<string> {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return "";
  const keyBytes = hexToBytes(searchKeyHex);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(normalized));
  return bytesToHex(new Uint8Array(sig));
}

/** Extract unique keywords from text for search token generation. */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && w.length <= 64);
  return Array.from(new Set(words));
}

/** Extracts clean email address from "Name <user@domain.com>" or plain "user@domain.com". */
export function extractCleanEmail(sender: string): string {
  const match = sender.match(/<([^>]+)>/);
  return (match ? match[1] : sender).trim();
}

export interface PathADecryptResult {
  plaintext: string;
  senderVerified: boolean;
  senderVerifyError?: string;
}

export interface PathAReadDeps {
  lookupMailboxKeys?: (email: string) => Promise<KeyDirectoryRecord>;
  wasm?: typeof WasmCore;
}

export async function decryptPathAEnvelope(
  envelopeJson: string,
  senderEmail: string,
  recipientXWingSeed: Uint8Array,
  deps?: PathAReadDeps,
): Promise<PathADecryptResult> {
  // Input validation
  if (!recipientXWingSeed || recipientXWingSeed.length !== 32) {
    throw new Error(
      "Failed to decrypt end-to-end message: key unwrap: recipient X-Wing seed is missing or invalid length",
    );
  }
  if (!envelopeJson || !envelopeJson.trim()) {
    throw new Error(
      "Failed to decrypt end-to-end message: envelope parse: envelope JSON is empty",
    );
  }

  const recipientSeedHex = bytesToHex(recipientXWingSeed);
  const wasm = deps?.wasm ?? (await import("./generated/crypto-core/byos_crypto_core.js"));

  // 1. Decrypt
  let plaintextHex: string;
  try {
    plaintextHex = wasm.wasm_open_xwing_envelope(recipientSeedHex, envelopeJson);
  } catch (e: unknown) {
    const rawMsg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
        ? e
        : JSON.stringify(e) || String(e);
    const step =
      rawMsg.includes("Format") ||
      rawMsg.includes("Json") ||
      rawMsg.includes("Base64") ||
      rawMsg.includes("syntax")
        ? "envelope parse"
        : rawMsg.includes("KeyLength") || rawMsg.includes("NonceLength")
        ? "key unwrap"
        : "content decrypt";
    throw new Error(`Failed to decrypt end-to-end message: ${step}: ${rawMsg}`);
  }
  const plaintext = new TextDecoder().decode(hexToBytes(plaintextHex));

  // 2. Verify
  let senderVerified = false;
  let senderVerifyError: string | undefined;
  try {
    const lookupFn = deps?.lookupMailboxKeys ?? lookupMailboxKeys;
    const cleanSender = extractCleanEmail(senderEmail);
    const senderRecord = await lookupFn(cleanSender);

    if (!senderRecord || !senderRecord.ed25519_signing_public_key) {
      senderVerifyError = "Sender has no published signing key";
    } else {
      const senderPkHex = bytesToHex(
        base64ToBytes(senderRecord.ed25519_signing_public_key),
      );
      const env = JSON.parse(envelopeJson);
      if (!env.sig) {
        senderVerifyError = "Envelope has no signature";
      } else {
        const encBytes = base64ToBytes(env.enc);
        const nonceBytes = base64ToBytes(env.nonce);
        const ctBytes = base64ToBytes(env.ciphertext);
        const sigBytes = base64ToBytes(env.sig);

        const aadHex = wasm.wasm_build_envelope_aad_hex(
          env.v,
          env.alg,
          env.key_id,
          env.key_epoch,
          bytesToHex(encBytes),
          bytesToHex(nonceBytes),
        );

        const verified = wasm.wasm_verify_signature(
          senderPkHex,
          aadHex,
          bytesToHex(ctBytes),
          bytesToHex(sigBytes),
        );

        senderVerified = verified;
        if (!verified) {
          senderVerifyError = "Signature does not match sender";
        }
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // apiRequest throws the raw response body for non-2xx. When the 
    // sender is not in the key directory (external address or unknown 
    // BYOS user), the server returns {"error":"unknown_mailbox"...}.
    // Surface a readable message instead of raw JSON.
    if (
      msg.includes("unknown_mailbox") ||
      msg.includes("unknown mailbox") ||
      msg.includes("not found")
    ) {
      senderVerifyError =
        "This message came from outside BYOS. Its sender cannot be cryptographically verified.";
    } else {
      senderVerifyError = msg;
    }
  }

  return { plaintext, senderVerified, senderVerifyError };
}

