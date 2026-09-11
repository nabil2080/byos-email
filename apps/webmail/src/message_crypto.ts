import { bytesToHex, hexToBytes } from "./attachment_crypto";
import type * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

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
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

function envelopeAadHex(mailboxId: string, prefix: string): string {
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
