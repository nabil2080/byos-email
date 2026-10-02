import {
  wasm_aes_gcm_encrypt,
  wasm_aes_gcm_decrypt,
  wasm_seal_xwing_envelope,
  wasm_open_xwing_envelope,
} from "./generated/crypto-core/byos_crypto_core.js";

export const CHUNK_SIZE = 1024 * 1024; // 1 MB (1,048,576 bytes)
export const MAX_ATTACHMENT_SIZE = 40 * 1024 * 1024; // 40 MB V1 total limit

export interface AttachmentWrappedKey {
  x25519_encapsulated: string; // base64 (32 bytes)
  mlkem_encrypted_key: string;  // base64
}

export interface AttachmentChunk {
  index: number;
  storage_ref: string;
  size_bytes: number;
}

export interface AttachmentEnvelope {
  attachment_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  iv: string; // base64 (12 bytes)
  wrapped_key: AttachmentWrappedKey;
  content_hash_sha256: string; // base64 (32 bytes)
  chunk_count: number;
  chunks: AttachmentChunk[];
}

export interface EncryptedChunkPayload {
  index: number;
  storageRef: string;
  data: Uint8Array;
}

export interface PreparedAttachment {
  recipientEnvelope: AttachmentEnvelope;
  recipientChunks: EncryptedChunkPayload[];
  senderEnvelope: AttachmentEnvelope;
  senderChunks: EncryptedChunkPayload[];
}

export interface DecryptedAttachmentResult {
  isCorrupted: boolean;
  data?: Uint8Array;
  filename?: string;
  mimeType?: string;
  error?: string;
}

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
  if (contentKey.length !== 32) {
    throw new Error("Content key must be exactly 32 bytes");
  }
  if (iv.length !== 12) {
    throw new Error("IV must be exactly 12 bytes");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    contentKey as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const ciphertextWithTag = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      cryptoKey,
      chunkPlaintext as unknown as BufferSource
    )
  );

  const out = new Uint8Array(1 + 12 + ciphertextWithTag.length);
  out[0] = 0x01; // Version 1
  out.set(iv, 1);
  out.set(ciphertextWithTag, 13);
  return out;
}

/**
 * Decrypts a single chunk using AES-256-GCM.
 * Supports 0x01 || nonce(12) || ciphertext+tag, or explicit IV fallback.
 */
export async function decryptChunk(
  encryptedChunk: Uint8Array,
  contentKey: Uint8Array,
  fallbackIV?: Uint8Array
): Promise<Uint8Array> {
  if (contentKey.length !== 32) {
    throw new Error("Content key must be exactly 32 bytes");
  }

  let iv: Uint8Array;
  let ciphertextWithTag: Uint8Array;

  if (encryptedChunk.length >= 29 && encryptedChunk[0] === 0x01) {
    iv = encryptedChunk.slice(1, 13);
    ciphertextWithTag = encryptedChunk.slice(13);
  } else if (fallbackIV && fallbackIV.length === 12) {
    iv = fallbackIV;
    ciphertextWithTag = encryptedChunk;
  } else if (encryptedChunk.length >= 28) {
    iv = encryptedChunk.slice(0, 12);
    ciphertextWithTag = encryptedChunk.slice(12);
  } else {
    throw new Error("Encrypted chunk payload is too short");
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    contentKey as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    cryptoKey,
    ciphertextWithTag as unknown as BufferSource
  );

  return new Uint8Array(decrypted);
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

  const sealFn =
    wasmSealOverride !== undefined
      ? wasmSealOverride
      : typeof wasm_seal_xwing_envelope === "function"
        ? wasm_seal_xwing_envelope
        : null;

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
  } catch (err) {
    throw new Error("Attachment encryption unavailable: WASM crypto core not loaded");
  }
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
  const openFn =
    wasmOpenOverride !== undefined
      ? wasmOpenOverride
      : typeof wasm_open_xwing_envelope === "function"
        ? wasm_open_xwing_envelope
        : null;

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
  } catch (err) {
    throw new Error("Attachment decryption unavailable: WASM crypto core not loaded");
  }
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
 * Prepares a file for Path A zero-knowledge sending:
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
  const {
    file,
    senderMailboxId,
    recipientMailboxId,
    recipientXWingPkHex,
    senderXWingPkHex,
    messageId,
  } = params;

  if (file.data.length > MAX_ATTACHMENT_SIZE) {
    throw new Error("Attachment exceeds maximum size of 40 MB");
  }

  const attachmentId = crypto.randomUUID();
  const contentHash = await computeSHA256(file.data);

  // Split into 1 MB chunks
  const chunkSlices: Uint8Array[] = [];
  if (file.data.length === 0) {
    chunkSlices.push(new Uint8Array(0));
  } else {
    for (let offset = 0; offset < file.data.length; offset += CHUNK_SIZE) {
      chunkSlices.push(file.data.subarray(offset, Math.min(offset + CHUNK_SIZE, file.data.length)));
    }
  }

  // === 1. Recipient Encryption ===
  const recipientKey = new Uint8Array(32);
  crypto.getRandomValues(recipientKey);
  const recipientBaseIV = new Uint8Array(12);
  crypto.getRandomValues(recipientBaseIV);

  const recipientChunks: EncryptedChunkPayload[] = [];
  const recipientMetaChunks: AttachmentChunk[] = [];

  for (let i = 0; i < chunkSlices.length; i++) {
    const chunkIV = new Uint8Array(12);
    crypto.getRandomValues(chunkIV);
    const encData = await encryptChunk(chunkSlices[i], recipientKey, chunkIV);
    const paddedIndex = String(i).padStart(3, "0");
    const storageRef = `mailboxes/${senderMailboxId}/path-a-attachments/${attachmentId}/chunk_${paddedIndex}.enc`;

    recipientChunks.push({
      index: i,
      storageRef,
      data: encData,
    });
    recipientMetaChunks.push({
      index: i,
      storage_ref: storageRef,
      size_bytes: encData.length,
    });
  }

  const recipientWrappedKey = await wrapAttachmentContentKey(
    recipientKey,
    recipientXWingPkHex,
    recipientMailboxId
  );
  // Hygiene: zero out sensitive key
  recipientKey.fill(0);

  const recipientEnvelope: AttachmentEnvelope = {
    attachment_id: attachmentId,
    filename: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.data.length,
    iv: bytesToBase64(recipientBaseIV),
    wrapped_key: recipientWrappedKey,
    content_hash_sha256: contentHash,
    chunk_count: chunkSlices.length,
    chunks: recipientMetaChunks,
  };

  // === 2. Sender Sent Copy Encryption (Fresh distinct key K_sender != K_recipient) ===
  const senderKey = new Uint8Array(32);
  crypto.getRandomValues(senderKey);
  const senderBaseIV = new Uint8Array(12);
  crypto.getRandomValues(senderBaseIV);

  const senderChunks: EncryptedChunkPayload[] = [];
  const senderMetaChunks: AttachmentChunk[] = [];
  const sentMsgId = messageId || "sent";

  for (let i = 0; i < chunkSlices.length; i++) {
    const chunkIV = new Uint8Array(12);
    crypto.getRandomValues(chunkIV);
    const encData = await encryptChunk(chunkSlices[i], senderKey, chunkIV);
    const paddedIndex = String(i).padStart(3, "0");
    const storageRef = `mailboxes/${senderMailboxId}/sent-attachments/${sentMsgId}/${attachmentId}/chunk_${paddedIndex}.enc`;

    senderChunks.push({
      index: i,
      storageRef,
      data: encData,
    });
    senderMetaChunks.push({
      index: i,
      storage_ref: storageRef,
      size_bytes: encData.length,
    });
  }

  const senderWrappedKey = await wrapAttachmentContentKey(
    senderKey,
    senderXWingPkHex,
    senderMailboxId
  );
  senderKey.fill(0);

  const senderEnvelope: AttachmentEnvelope = {
    attachment_id: attachmentId,
    filename: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.data.length,
    iv: bytesToBase64(senderBaseIV),
    wrapped_key: senderWrappedKey,
    content_hash_sha256: contentHash,
    chunk_count: chunkSlices.length,
    chunks: senderMetaChunks,
  };

  return {
    recipientEnvelope,
    recipientChunks,
    senderEnvelope,
    senderChunks,
  };
}

/**
 * Decrypts an attachment from its envelope and chunk data.
 * Isolates chunk decryption and SHA-256 failures.
 */
export async function decryptPathAAttachment(
  envelope: AttachmentEnvelope,
  chunks: Uint8Array[],
  skSeedHex: string,
  mailboxId: string
): Promise<DecryptedAttachmentResult> {
  let contentKey: Uint8Array;
  try {
    contentKey = await unwrapAttachmentContentKey(
      envelope.wrapped_key,
      skSeedHex,
      mailboxId
    );
  } catch (err) {
    console.warn(`[PathA Attachment] Key unwrap failed for attachment_id=${envelope.attachment_id}`);
    return {
      isCorrupted: true,
      error: "Unable to unwrap attachment key",
      filename: envelope.filename,
      mimeType: envelope.mime_type,
    };
  }

  const decryptedChunks: Uint8Array[] = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      try {
        const decrypted = await decryptChunk(chunks[i], contentKey);
        decryptedChunks.push(decrypted);
      } catch (chunkErr) {
        console.warn(`[PathA Attachment] Decryption failed for attachment_id=${envelope.attachment_id} chunk_index=${i}`);
        return {
          isCorrupted: true,
          error: `Corrupted chunk at index ${i}`,
          filename: envelope.filename,
          mimeType: envelope.mime_type,
        };
      }
    }

    // Assemble plaintext
    const totalSize = decryptedChunks.reduce((acc, c) => acc + c.length, 0);
    const assembled = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of decryptedChunks) {
      assembled.set(chunk, offset);
      offset += chunk.length;
    }

    // Verify SHA-256
    const calculatedHash = await computeSHA256(assembled);
    if (calculatedHash !== envelope.content_hash_sha256) {
      console.warn(
        `[PathA Attachment] Hash mismatch for attachment_id=${envelope.attachment_id} (expected=${envelope.content_hash_sha256.slice(0, 16)}..., actual=${calculatedHash.slice(0, 16)}...)`
      );
      return {
        isCorrupted: true,
        error: "Attachment integrity verification failed (SHA-256 mismatch)",
        filename: envelope.filename,
        mimeType: envelope.mime_type,
      };
    }

    return {
      isCorrupted: false,
      data: assembled,
      filename: envelope.filename,
      mimeType: envelope.mime_type,
    };
  } finally {
    contentKey.fill(0);
  }
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
