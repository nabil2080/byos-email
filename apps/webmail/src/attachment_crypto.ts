import {
  wasm_aes_gcm_encrypt,
  wasm_aes_gcm_decrypt,
  wasm_hpke_seal,
  wasm_hpke_open,
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

// =============================================
// Attachment Encryption Protocol v2 (Release B2)
// =============================================

export const ATTACHMENT_CRYPTO_VERSION_V2 = 2;
export const ATTACHMENT_AAD_VERSION_V2 = 2;
export const ATTACHMENT_OWNER_WRAP_ALG_V2 = "HPKE-X25519-AES256GCM-v1";
export const ATTACHMENT_MAX_PATH_B_BYTES = 25 * 1024 * 1024; // 25 MiB aggregate plaintext
export const ATTACHMENT_MAX_PATH_B_COUNT = 100;

export interface EncryptedAttachmentV2Result {
  attachmentId: string;
  ciphertextBytes: Uint8Array;
  plaintextSizeBytes: number;
  ciphertextSizeBytes: number;
  plaintextSha256Hex: string;
  ciphertextSha256Hex: string;
  ownerPkSha256Hex: string;
  cekOwnerWrappedB64: string;
  ownerWrapAlg: string;
  ownerKeyVersion: number;
  cryptoVersion: number;
  blobAadVersion: number;
}

export interface OutboundAttachmentGrantV2 {
  attachment_id: string;
  position: number;
  disposition: "attachment" | "inline";
  content_id?: string;
  wrap_alg: string;
  outbound_key_id: string;
  outbound_key_epoch: number;
  cek_outbound_wrapped: string;
  metadata_sha256: string;
}

export function generateAttachmentUUIDv4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = bytesToHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function uuidToBytes16(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "").trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  return hexToBytes(hex);
}

export async function computeSha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
  return new Uint8Array(digest);
}

export async function computeSha256Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(await computeSha256Bytes(data));
}

export function sanitizeFilenameV2(name: string): string {
  let clean = name || "";
  const lastSlash = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  if (lastSlash >= 0) {
    clean = clean.slice(lastSlash + 1);
  }
  clean = clean.trim();
  let out = "";
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const ch = clean[i];
    if (code < 0x20 || code === 0x7f || ch === "/" || ch === "\\" || ch === '"' || ch === "'" || ch === ";") {
      out += "_";
    } else {
      out += ch;
    }
  }
  if (!out || out === "." || out === "..") {
    return "attachment.bin";
  }
  if (out.length > 255) {
    out = out.slice(0, 255);
  }
  return out;
}

export function canonicalMimeTypeV2(raw: string): string {
  const trimmed = (raw || "").trim().toLowerCase();
  if (!trimmed) {
    return "application/octet-stream";
  }
  const semi = trimmed.indexOf(";");
  const media = (semi >= 0 ? trimmed.slice(0, semi) : trimmed).trim();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(media)) {
    return "application/octet-stream";
  }
  return media;
}

export async function computeOutboundKeyIdHex(outboundPkBytes: Uint8Array): Promise<string> {
  if (outboundPkBytes.length !== 32) {
    throw new Error(`Outbound public key must be 32 bytes, got ${outboundPkBytes.length}`);
  }
  const prefix = new TextEncoder().encode("byos-outbound-pk-v1");
  const buf = new Uint8Array(prefix.length + 32);
  buf.set(prefix, 0);
  buf.set(outboundPkBytes, prefix.length);
  const digest = await computeSha256Bytes(buf);
  return bytesToHex(digest.slice(0, 8));
}

export function buildBlobAadV2(
  mailboxId: string,
  attachmentId: string,
  cryptoVersion: number = ATTACHMENT_CRYPTO_VERSION_V2,
  aadVersion: number = ATTACHMENT_AAD_VERSION_V2
): Uint8Array {
  const out = new Uint8Array(53);
  out.set(new TextEncoder().encode("byos-att-blob-v2"), 0);
  out.set(uuidToBytes16(mailboxId), 16);
  out.set(uuidToBytes16(attachmentId), 32);
  const view = new DataView(out.buffer);
  view.setUint32(48, cryptoVersion >>> 0, false);
  out[52] = aadVersion & 0xff;
  return out;
}

export function buildOwnerWrapAadV2(
  mailboxId: string,
  attachmentId: string,
  ownerKeyVersion: number,
  cryptoVersion: number = ATTACHMENT_CRYPTO_VERSION_V2
): Uint8Array {
  const out = new Uint8Array(53);
  out.set(new TextEncoder().encode("byos-att-ownr-v2"), 0);
  out.set(uuidToBytes16(mailboxId), 16);
  out.set(uuidToBytes16(attachmentId), 32);
  const view = new DataView(out.buffer);
  view.setUint32(48, ownerKeyVersion >>> 0, false);
  out[52] = cryptoVersion & 0xff;
  return out;
}

export async function computeMetadataSha256V2(params: {
  filename: string;
  contentType: string;
  sizeBytes: number;
  plaintextSha256Bytes: Uint8Array;
  disposition?: "attachment" | "inline";
  contentId?: string;
}): Promise<Uint8Array> {
  if (params.plaintextSha256Bytes.length !== 32) {
    throw new Error("plaintextSha256Bytes must be 32 bytes");
  }
  const encoder = new TextEncoder();
  const domain = encoder.encode("byos-att-meta-v2");
  const fnameBytes = encoder.encode(sanitizeFilenameV2(params.filename));
  const mimeBytes = encoder.encode(canonicalMimeTypeV2(params.contentType));
  const cidBytes = encoder.encode(params.contentId || "");
  const dispTag = params.disposition === "inline" ? 0x02 : 0x01;

  const totalLen =
    domain.length +
    4 + fnameBytes.length +
    4 + mimeBytes.length +
    8 +
    32 +
    1 +
    4 + cidBytes.length;

  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);
  let off = 0;

  buf.set(domain, off); off += domain.length;
  view.setUint32(off, fnameBytes.length >>> 0, false); off += 4;
  buf.set(fnameBytes, off); off += fnameBytes.length;
  view.setUint32(off, mimeBytes.length >>> 0, false); off += 4;
  buf.set(mimeBytes, off); off += mimeBytes.length;
  view.setBigUint64(off, BigInt(params.sizeBytes), false); off += 8;
  buf.set(params.plaintextSha256Bytes, off); off += 32;
  buf[off++] = dispTag;
  view.setUint32(off, cidBytes.length >>> 0, false); off += 4;
  buf.set(cidBytes, off);

  return computeSha256Bytes(buf);
}

export function buildOutboundWrapAadV2(params: {
  mailboxId: string;
  outboxSeq: number;
  attachmentId: string;
  outboundKeyIdHex: string;
  outboundKeyEpoch: number;
  cryptoVersion?: number;
  metadataSha256Bytes: Uint8Array;
}): Uint8Array {
  const keyIdBytes = hexToBytes(params.outboundKeyIdHex);
  if (keyIdBytes.length !== 8) {
    throw new Error("outboundKeyIdHex must decode to 8 bytes");
  }
  if (params.metadataSha256Bytes.length !== 32) {
    throw new Error("metadataSha256Bytes must be 32 bytes");
  }
  const out = new Uint8Array(101);
  out.set(new TextEncoder().encode("byos-att-outb-v2"), 0);
  out.set(uuidToBytes16(params.mailboxId), 16);
  const view = new DataView(out.buffer);
  view.setBigUint64(32, BigInt(params.outboxSeq), false);
  out.set(uuidToBytes16(params.attachmentId), 40);
  out.set(keyIdBytes, 56);
  view.setUint32(64, params.outboundKeyEpoch >>> 0, false);
  out[68] = (params.cryptoVersion ?? ATTACHMENT_CRYPTO_VERSION_V2) & 0xff;
  out.set(params.metadataSha256Bytes, 69);
  return out;
}

export async function encryptAttachmentV2(params: {
  plaintextBytes: Uint8Array;
  mailboxId: string;
  mailboxPkBytes: Uint8Array;
  ownerKeyVersion: number;
  attachmentId?: string;
}): Promise<EncryptedAttachmentV2Result> {
  if (params.mailboxPkBytes.length !== 32) {
    throw new Error(`Mailbox public key must be 32 bytes, got ${params.mailboxPkBytes.length}`);
  }
  if (!Number.isInteger(params.ownerKeyVersion) || params.ownerKeyVersion <= 0) {
    throw new Error("ownerKeyVersion must be a positive integer");
  }
  const attachmentId = params.attachmentId || generateAttachmentUUIDv4();
  const cek = new Uint8Array(32);
  crypto.getRandomValues(cek);
  try {
    const [plaintextSha256Hex, ownerPkSha256Hex] = await Promise.all([
      computeSha256Hex(params.plaintextBytes),
      computeSha256Hex(params.mailboxPkBytes),
    ]);
    const blobAad = buildBlobAadV2(
      params.mailboxId,
      attachmentId,
      ATTACHMENT_CRYPTO_VERSION_V2,
      ATTACHMENT_AAD_VERSION_V2
    );
    const ownerWrapAad = buildOwnerWrapAadV2(
      params.mailboxId,
      attachmentId,
      params.ownerKeyVersion,
      ATTACHMENT_CRYPTO_VERSION_V2
    );

    const cekHex = bytesToHex(cek);
    const ciphertextHex = wasm_aes_gcm_encrypt(
      cekHex,
      bytesToHex(params.plaintextBytes),
      bytesToHex(blobAad)
    );
    const ciphertextBytes = hexToBytes(ciphertextHex);
    const ciphertextSha256Hex = await computeSha256Hex(ciphertextBytes);

    const cekOwnerWrappedHex = wasm_hpke_seal(
      bytesToHex(params.mailboxPkBytes),
      cekHex,
      bytesToHex(ownerWrapAad)
    );
    const cekOwnerWrappedB64 = bytesToBase64(hexToBytes(cekOwnerWrappedHex));

    return {
      attachmentId,
      ciphertextBytes,
      plaintextSizeBytes: params.plaintextBytes.length,
      ciphertextSizeBytes: ciphertextBytes.length,
      plaintextSha256Hex,
      ciphertextSha256Hex,
      ownerPkSha256Hex,
      cekOwnerWrappedB64,
      ownerWrapAlg: ATTACHMENT_OWNER_WRAP_ALG_V2,
      ownerKeyVersion: params.ownerKeyVersion,
      cryptoVersion: ATTACHMENT_CRYPTO_VERSION_V2,
      blobAadVersion: ATTACHMENT_AAD_VERSION_V2,
    };
  } finally {
    cek.fill(0);
  }
}

export async function decryptAttachmentV2(params: {
  ciphertextBytes: Uint8Array;
  mailboxId: string;
  attachmentId: string;
  mailboxSkBytes: Uint8Array;
  cekOwnerWrappedB64: string;
  ownerKeyVersion: number;
  expectedPlaintextSha256Hex?: string;
  expectedSizeBytes?: number;
  cryptoVersion?: number;
  blobAadVersion?: number;
}): Promise<Uint8Array> {
  if (params.mailboxSkBytes.length !== 32) {
    throw new Error("Mailbox secret key must be exactly 32 bytes");
  }
  const cryptoVersion = params.cryptoVersion ?? ATTACHMENT_CRYPTO_VERSION_V2;
  const blobAadVersion = params.blobAadVersion ?? ATTACHMENT_AAD_VERSION_V2;
  const ownerWrapAad = buildOwnerWrapAadV2(
    params.mailboxId,
    params.attachmentId,
    params.ownerKeyVersion,
    cryptoVersion
  );
  const cekWrappedBytes = base64ToBytes(params.cekOwnerWrappedB64);
  const cekHex = wasm_hpke_open(
    bytesToHex(params.mailboxSkBytes),
    bytesToHex(cekWrappedBytes),
    bytesToHex(ownerWrapAad)
  );
  const cekBytes = hexToBytes(cekHex);
  try {
    if (cekBytes.length !== 32) {
      throw new Error("Unwrapped CEK is not 32 bytes");
    }
    const blobAad = buildBlobAadV2(
      params.mailboxId,
      params.attachmentId,
      cryptoVersion,
      blobAadVersion
    );
    const plaintextHex = wasm_aes_gcm_decrypt(
      bytesToHex(cekBytes),
      bytesToHex(params.ciphertextBytes),
      bytesToHex(blobAad)
    );
    const plaintextBytes = hexToBytes(plaintextHex);
    if (
      typeof params.expectedSizeBytes === "number" &&
      plaintextBytes.length !== params.expectedSizeBytes
    ) {
      throw new Error(
        `Attachment size mismatch: expected ${params.expectedSizeBytes}, got ${plaintextBytes.length}`
      );
    }
    if (params.expectedPlaintextSha256Hex) {
      const actualHex = await computeSha256Hex(plaintextBytes);
      if (actualHex !== params.expectedPlaintextSha256Hex.toLowerCase()) {
        throw new Error("Attachment plaintext SHA-256 verification failed");
      }
    }
    return plaintextBytes;
  } finally {
    cekBytes.fill(0);
  }
}

export async function sealOutboundAttachmentGrantV2(params: {
  mailboxId: string;
  mailboxSkBytes: Uint8Array;
  attachmentId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  plaintextSha256Hex: string;
  cekOwnerWrappedB64: string;
  ownerKeyVersion: number;
  outboxSeq: number;
  outboundPkB64: string;
  outboundKeyEpoch: number;
  outboundKeyIdHex?: string;
  position: number;
  disposition?: "attachment" | "inline";
  contentId?: string;
}): Promise<OutboundAttachmentGrantV2> {
  if (params.mailboxSkBytes.length !== 32) {
    throw new Error("Mailbox secret key must be exactly 32 bytes");
  }
  const outboundPkBytes = base64ToBytes(params.outboundPkB64);
  if (outboundPkBytes.length !== 32) {
    throw new Error(`Outbound delivery public key must be 32 bytes, got ${outboundPkBytes.length}`);
  }
  const computedKeyIdHex = await computeOutboundKeyIdHex(outboundPkBytes);
  if (params.outboundKeyIdHex && params.outboundKeyIdHex.toLowerCase() !== computedKeyIdHex) {
    throw new Error("Outbound delivery key_id mismatch against public key");
  }

  const plaintextShaBytes = hexToBytes(params.plaintextSha256Hex);
  const disposition = params.disposition === "inline" ? "inline" : "attachment";
  const contentId = params.contentId || "";
  const metadataShaBytes = await computeMetadataSha256V2({
    filename: params.filename,
    contentType: params.contentType,
    sizeBytes: params.sizeBytes,
    plaintextSha256Bytes: plaintextShaBytes,
    disposition,
    contentId,
  });

  const ownerWrapAad = buildOwnerWrapAadV2(
    params.mailboxId,
    params.attachmentId,
    params.ownerKeyVersion,
    ATTACHMENT_CRYPTO_VERSION_V2
  );
  const cekHex = wasm_hpke_open(
    bytesToHex(params.mailboxSkBytes),
    bytesToHex(base64ToBytes(params.cekOwnerWrappedB64)),
    bytesToHex(ownerWrapAad)
  );
  const cekBytes = hexToBytes(cekHex);
  try {
    if (cekBytes.length !== 32) {
      throw new Error("Unwrapped attachment CEK is not 32 bytes");
    }
    const outboundWrapAad = buildOutboundWrapAadV2({
      mailboxId: params.mailboxId,
      outboxSeq: params.outboxSeq,
      attachmentId: params.attachmentId,
      outboundKeyIdHex: computedKeyIdHex,
      outboundKeyEpoch: params.outboundKeyEpoch,
      cryptoVersion: ATTACHMENT_CRYPTO_VERSION_V2,
      metadataSha256Bytes: metadataShaBytes,
    });
    const cekOutboundWrappedHex = wasm_hpke_seal(
      bytesToHex(outboundPkBytes),
      bytesToHex(cekBytes),
      bytesToHex(outboundWrapAad)
    );
    return {
      attachment_id: params.attachmentId,
      position: params.position,
      disposition,
      content_id: contentId || undefined,
      wrap_alg: ATTACHMENT_OWNER_WRAP_ALG_V2,
      outbound_key_id: computedKeyIdHex,
      outbound_key_epoch: params.outboundKeyEpoch,
      cek_outbound_wrapped: bytesToBase64(hexToBytes(cekOutboundWrappedHex)),
      metadata_sha256: bytesToHex(metadataShaBytes),
    };
  } finally {
    cekBytes.fill(0);
  }
}
