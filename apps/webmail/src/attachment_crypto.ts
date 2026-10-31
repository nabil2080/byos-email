import {
  wasm_aes_gcm_encrypt,
  wasm_aes_gcm_decrypt,
  wasm_seal_xwing_envelope,
  wasm_open_xwing_envelope,
} from "./generated/crypto-core/byos_crypto_core.js";
import { cryptoWorkerBridge } from "./crypto_worker_bridge";

import {
  CHUNK_SIZE,
  MAX_ATTACHMENT_SIZE,
  type AttachmentWrappedKey,
  type AttachmentChunk,
  type AttachmentEnvelope,
  type EncryptedChunkPayload,
  type PreparedAttachment,
  type DecryptedAttachmentResult,
} from "./crypto_worker_protocol";

export {
  CHUNK_SIZE,
  MAX_ATTACHMENT_SIZE,
  type AttachmentWrappedKey,
  type AttachmentChunk,
  type AttachmentEnvelope,
  type EncryptedChunkPayload,
  type PreparedAttachment,
  type DecryptedAttachmentResult,
};

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Computes SHA-256 hash of bytes and returns base64.
 */
export async function computeSHA256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
  return bytesToBase64(new Uint8Array(digest));
}

/**
 * Encrypts a single chunk using AES-256-GCM.
 * Wire format: 0x01 (version, 1 byte) || nonce (12 bytes) || ciphertext + tag (16 bytes).
 */
export async function encryptChunk(
  chunkPlaintext: Uint8Array,
  contentKey: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  return cryptoWorkerBridge.encryptChunk(chunkPlaintext, contentKey, iv);
}

/**
 * Decrypts a single chunk using AES-256-GCM offloaded to Web Worker.
 * Supports 0x01 || nonce(12) || ciphertext+tag, or explicit IV fallback.
 */
export async function decryptChunk(
  encryptedChunk: Uint8Array,
  contentKey: Uint8Array,
  fallbackIV?: Uint8Array
): Promise<Uint8Array> {
  return cryptoWorkerBridge.decryptChunk(encryptedChunk, contentKey, fallbackIV);
}

/**
 * Wraps a per-attachment AES-256 content key to a recipient's X-Wing public key.
 */
export async function wrapAttachmentContentKey(
  contentKey: Uint8Array,
  recipientXWingPkHex: string,
  mailboxId: string,
  wasmSealOverride?: typeof wasm_seal_xwing_envelope
): Promise<AttachmentWrappedKey> {
  if (contentKey.length !== 32) {
    throw new Error("Content key must be 32 bytes");
  }

  if (wasmSealOverride !== undefined) {
    const sealFn =
      typeof wasmSealOverride === "function" ? wasmSealOverride : null;
    if (!sealFn) {
      throw new Error("Attachment encryption unavailable: WASM crypto core not loaded");
    }

    try {
      const contentKeyHex = bytesToHex(contentKey);
      const envelopeJson = sealFn(
        recipientXWingPkHex,
        mailboxId,
        1,
        contentKeyHex
      );
      const env = JSON.parse(envelopeJson);
      const encBytes = base64ToBytes(env.enc);
      const nonceBytes = base64ToBytes(env.nonce);
      const ctBytes = base64ToBytes(env.ciphertext);

      if (encBytes.length === 1120) {
        const ctM = encBytes.slice(0, 1088);
        const ctX = encBytes.slice(1088);
        const mlkemCombined = new Uint8Array(1088 + nonceBytes.length + ctBytes.length);
        mlkemCombined.set(ctM, 0);
        mlkemCombined.set(nonceBytes, 1088);
        mlkemCombined.set(ctBytes, 1088 + nonceBytes.length);

        return {
          x25519_encapsulated: bytesToBase64(ctX),
          mlkem_encrypted_key: bytesToBase64(mlkemCombined),
        };
      }
      throw new Error("Invalid encapsulated key length from WASM");
    } catch (err: any) {
      if (err.message && err.message.includes("Invalid encapsulated key length")) throw err;
      throw new Error("Attachment encryption unavailable: WASM crypto core not loaded");
    }
  }

  return cryptoWorkerBridge.wrapAttachmentContentKey(
    contentKey,
    recipientXWingPkHex,
    mailboxId
  );
}

/**
 * Unwraps a per-attachment content key using the recipient's X-Wing secret seed.
 */
export async function unwrapAttachmentContentKey(
  wrappedKey: AttachmentWrappedKey,
  recipientSkSeedHex: string,
  mailboxId: string,
  wasmOpenOverride?: typeof wasm_open_xwing_envelope
): Promise<Uint8Array> {
  if (wasmOpenOverride !== undefined) {
    const openFn =
      typeof wasmOpenOverride === "function" ? wasmOpenOverride : null;
    if (!openFn) {
      throw new Error("Attachment decryption unavailable: WASM crypto core not loaded");
    }

    try {
      const ctX = base64ToBytes(wrappedKey.x25519_encapsulated);
      const mlkemCombined = base64ToBytes(wrappedKey.mlkem_encrypted_key);

      if (ctX.length === 32 && mlkemCombined.length >= 1100) {
        const ctM = mlkemCombined.slice(0, 1088);
        const nonceBytes = mlkemCombined.slice(1088, 1100);
        const ctBytes = mlkemCombined.slice(1100);

        const encBytes = new Uint8Array(1120);
        encBytes.set(ctM, 0);
        encBytes.set(ctX, 1088);

        const envelopeObj = {
          v: 1,
          alg: "HPKE-XWing-AES256GCM-v1",
          key_id: mailboxId,
          key_epoch: 1,
          enc: bytesToBase64(encBytes),
          nonce: bytesToBase64(nonceBytes),
          ciphertext: bytesToBase64(ctBytes),
          sig: null,
        };

        const plainHex = openFn(
          recipientSkSeedHex,
          JSON.stringify(envelopeObj)
        );
        return hexToBytes(plainHex);
      }
      throw new Error("Invalid wrapped key format");
    } catch (err: any) {
      if (err.message && err.message.includes("Invalid wrapped key format")) throw err;
      throw new Error("Attachment decryption unavailable: WASM crypto core not loaded");
    }
  }

  return cryptoWorkerBridge.unwrapAttachmentContentKey(
    wrappedKey,
    recipientSkSeedHex,
    mailboxId
  );
}

/**
 * ARCHITECTURAL DESIGN NOTE (Section 9):
 * In accordance with the Section 9 storage architecture (Proton-equivalent model),
 * received attachment chunks are stored under the sender's customer storage namespace:
 *   mailboxes/${senderMailboxId}/path-a-attachments/${attachmentId}/chunk_${paddedIndex}.enc
 * Recipients read through the proxy without exposing storage credentials.
 * Sent copy chunks are stored under:
 *   mailboxes/${senderMailboxId}/sent-attachments/${sentMsgId}/${attachmentId}/chunk_${paddedIndex}.enc
 * End-to-end zero-knowledge encryption is strictly preserved: the server only stores and serves
 * AES-256-GCM ciphertext chunks and wrapped keys without access to plaintext or content keys.
 *
 * Prepares a file for Path A zero-knowledge sending offloaded to Web Worker:
 * 1. Generates fresh random 256-bit content key K_recipient with CSPRNG.
 * 2. Splits into 1 MB chunks, encrypts each chunk independently with unique IV.
 * 3. Wraps K_recipient to recipient's X-Wing public key via WASM crypto core.
 * 4. Generates a distinct random 256-bit content key K_sender for Sent copy.
 * 5. Splits into 1 MB chunks, encrypts independently with unique IVs.
 * 6. Wraps K_sender to sender's X-Wing public key via WASM crypto core.
 */
export async function preparePathAAttachment(params: {
  file: { name: string; type: string; data: Uint8Array };
  senderMailboxId: string;
  recipientMailboxId: string;
  recipientXWingPkHex: string;
  senderXWingPkHex: string;
  messageId?: string;
}): Promise<PreparedAttachment> {
  if (params.file.data.length > MAX_ATTACHMENT_SIZE) {
    throw new Error("Attachment exceeds maximum size of 40 MB");
  }

  return cryptoWorkerBridge.preparePathAAttachment(params);
}

/**
 * Decrypts an attachment from its envelope and chunk data offloaded to Web Worker.
 * Isolates chunk decryption and SHA-256 failures.
 */
export async function decryptPathAAttachment(
  envelope: AttachmentEnvelope,
  chunks: Uint8Array[],
  skSeedHex: string,
  mailboxId: string
): Promise<DecryptedAttachmentResult> {
  return cryptoWorkerBridge.decryptPathAAttachment(
    envelope,
    chunks,
    skSeedHex,
    mailboxId
  );
}

/**
 * Legacy Path B attachment helpers preserved for backward compatibility
 */
export function encryptAttachmentBytes(
  plaintextBytes: Uint8Array,
  keyBytes: Uint8Array,
  aadBytes: Uint8Array = new Uint8Array(0)
): Uint8Array {
  if (keyBytes.length !== 32) {
    throw new Error("Mailbox encryption key must be exactly 32 bytes");
  }
  const keyHex = bytesToHex(keyBytes);
  const plaintextHex = bytesToHex(plaintextBytes);
  const aadHex = bytesToHex(aadBytes);

  const envelopeHex = wasm_aes_gcm_encrypt(keyHex, plaintextHex, aadHex);
  return hexToBytes(envelopeHex);
}

export function decryptAttachmentBytes(
  envelopeBytes: Uint8Array,
  keyBytes: Uint8Array,
  aadBytes: Uint8Array = new Uint8Array(0)
): Uint8Array {
  if (keyBytes.length !== 32) {
    throw new Error("Mailbox encryption key must be exactly 32 bytes");
  }
  const keyHex = bytesToHex(keyBytes);
  const envelopeHex = bytesToHex(envelopeBytes);
  const aadHex = bytesToHex(aadBytes);

  const plaintextHex = wasm_aes_gcm_decrypt(keyHex, envelopeHex, aadHex);
  return hexToBytes(plaintextHex);
}
