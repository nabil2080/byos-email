import type * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";
import {
  CHUNK_SIZE,
  MAX_ATTACHMENT_SIZE,
  type AttachmentChunk,
  type AttachmentEnvelope,
  type AttachmentWrappedKey,
  type Argon2WrapPayload,
  type Argon2WrapResult,
  type Argon2UnwrapPayload,
  type Argon2UnwrapResult,
  type AutoUnwrapKeysPayload,
  type AutoUnwrapKeysResult,
  type XWingSealPayload,
  type XWingSealSignedPayload,
  type XWingSealResult,
  type XWingOpenPayload,
  type XWingOpenResult,
  type WrapAttachmentKeyPayload,
  type WrapAttachmentKeyResult,
  type UnwrapAttachmentKeyPayload,
  type UnwrapAttachmentKeyResult,
  type PreparePathAAttachmentPayload,
  type PreparePathAAttachmentResult,
  type DecryptPathAAttachmentPayload,
  type DecryptPathAAttachmentResult,
  type EncryptChunkPayload,
  type EncryptChunkResult,
  type DecryptChunkPayload,
  type DecryptChunkResult,
  type SerializedEncryptedChunk,
  zeroizeBuffer,
} from "./crypto_worker_protocol";

let wasmCache: typeof WasmCore | null = null;

export async function getWasmInstance(): Promise<typeof WasmCore> {
  if (!wasmCache) {
    wasmCache = await import("./generated/crypto-core/byos_crypto_core.js");
  }
  return wasmCache;
}

export function setWasmInstanceForTest(wasm: typeof WasmCore | null): void {
  wasmCache = wasm;
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

export async function computeSHA256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as unknown as BufferSource);
  return bytesToBase64(new Uint8Array(digest));
}

export function opPing(): { result: string; transferables: Transferable[] } {
  return { result: "PONG", transferables: [] };
}

// === Argon2id Operations ===

export async function opArgon2WrapKey(
  payload: Argon2WrapPayload
): Promise<{ result: Argon2WrapResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const envelopeHex = wasm.wasm_passphrase_wrap_key(
    payload.passphrase,
    payload.saltHex,
    payload.plaintextHex
  );
  return {
    result: { envelopeHex },
    transferables: [],
  };
}

export async function opArgon2UnwrapKey(
  payload: Argon2UnwrapPayload
): Promise<{ result: Argon2UnwrapResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const keyHex = wasm.wasm_passphrase_unwrap_key(
    payload.passphrase,
    payload.saltHex,
    payload.envelopeHex
  );
  const keyBytes = hexToBytes(keyHex);
  const keyBuffer = keyBytes.buffer as ArrayBuffer;
  return {
    result: { keyHex, keyBuffer },
    transferables: [keyBuffer],
  };
}

export async function opAutoUnwrapKeys(
  payload: AutoUnwrapKeysPayload
): Promise<{ result: AutoUnwrapKeysResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const trimmed = payload.wrappedSkUser.trim();
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

  const skHex = wasm.wasm_passphrase_unwrap_key(payload.password, saltHex, envelopeHex);
  const mailboxSkBytes = hexToBytes(skHex);
  if (mailboxSkBytes.length !== 32) {
    throw new Error("Unwrapped mailbox key is invalid length");
  }

  const searchKeyHex = wasm.wasm_derive_search_key(skHex);

  let signingSeedBuffer: ArrayBuffer | null = null;
  if (parsed && parsed.signing_salt && parsed.signing_envelope) {
    try {
      const seedHex = wasm.wasm_passphrase_unwrap_key(
        payload.password,
        parsed.signing_salt,
        parsed.signing_envelope
      );
      const seedBytes = hexToBytes(seedHex);
      if (seedBytes.length === 32) {
        signingSeedBuffer = seedBytes.buffer as ArrayBuffer;
      }
    } catch (e) {
      console.warn("[Worker Crypto] Failed unwrapping signing seed; signing disabled", e);
    }
  }

  let xwingSeedBuffer: ArrayBuffer | null = null;
  if (parsed && parsed.xwing_salt && parsed.xwing_envelope) {
    try {
      const seedHex = wasm.wasm_passphrase_unwrap_key(
        payload.password,
        parsed.xwing_salt,
        parsed.xwing_envelope
      );
      const seedBytes = hexToBytes(seedHex);
      if (seedBytes.length === 32) {
        xwingSeedBuffer = seedBytes.buffer as ArrayBuffer;
      }
    } catch (e) {
      console.warn("[Worker Crypto] Failed unwrapping X-Wing seed; Path A read disabled", e);
    }
  }

  const mailboxSkBuffer = mailboxSkBytes.buffer as ArrayBuffer;
  const transferables: Transferable[] = [mailboxSkBuffer];
  if (signingSeedBuffer) transferables.push(signingSeedBuffer);
  if (xwingSeedBuffer) transferables.push(xwingSeedBuffer);

  return {
    result: {
      mailboxSkBuffer,
      signingSeedBuffer,
      xwingSeedBuffer,
      searchKeyHex,
    },
    transferables,
  };
}

// === X-Wing Operations ===

export async function opXWingSealEnvelope(
  payload: XWingSealPayload
): Promise<{ result: XWingSealResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const envelopeJson = wasm.wasm_seal_xwing_envelope(
    payload.recipientXWingPkHex,
    payload.keyId,
    payload.keyEpoch,
    payload.plaintextHex
  );
  return {
    result: { envelopeJson },
    transferables: [],
  };
}

export async function opXWingSealEnvelopeSigned(
  payload: XWingSealSignedPayload
): Promise<{ result: XWingSealResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const envelopeJson = wasm.wasm_seal_xwing_envelope_signed(
    payload.recipientXWingPkHex,
    payload.keyId,
    payload.keyEpoch,
    payload.plaintextHex,
    payload.senderSigningSeedHex
  );
  return {
    result: { envelopeJson },
    transferables: [],
  };
}

export async function opXWingOpenEnvelope(
  payload: XWingOpenPayload
): Promise<{ result: XWingOpenResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const plaintextHex = wasm.wasm_open_xwing_envelope(
    payload.recipientXWingSkSeedHex,
    payload.envelopeJson
  );
  const plaintextBytes = hexToBytes(plaintextHex);
  const plaintextBuffer = plaintextBytes.buffer as ArrayBuffer;
  return {
    result: { plaintextHex, plaintextBuffer },
    transferables: [plaintextBuffer],
  };
}

export async function opWrapAttachmentKey(
  payload: WrapAttachmentKeyPayload
): Promise<{ result: WrapAttachmentKeyResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const contentKey = new Uint8Array(payload.contentKeyBuffer);
  try {
    if (contentKey.length !== 32) {
      throw new Error("Content key must be 32 bytes");
    }
    const contentKeyHex = bytesToHex(contentKey);
    const envelopeJson = wasm.wasm_seal_xwing_envelope(
      payload.recipientXWingPkHex,
      payload.mailboxId,
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
        result: {
          wrappedKey: {
            x25519_encapsulated: bytesToBase64(ctX),
            mlkem_encrypted_key: bytesToBase64(mlkemCombined),
          },
        },
        transferables: [],
      };
    }
    throw new Error("Invalid encapsulated key length from WASM");
  } finally {
    contentKey.fill(0);
    zeroizeBuffer(payload.contentKeyBuffer);
  }
}

export async function opUnwrapAttachmentKey(
  payload: UnwrapAttachmentKeyPayload
): Promise<{ result: UnwrapAttachmentKeyResult; transferables: Transferable[] }> {
  const wasm = await getWasmInstance();
  const ctX = base64ToBytes(payload.wrappedKey.x25519_encapsulated);
  const mlkemCombined = base64ToBytes(payload.wrappedKey.mlkem_encrypted_key);

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
      key_id: payload.mailboxId,
      key_epoch: 1,
      enc: bytesToBase64(encBytes),
      nonce: bytesToBase64(nonceBytes),
      ciphertext: bytesToBase64(ctBytes),
      sig: null,
    };

    const plainHex = wasm.wasm_open_xwing_envelope(
      payload.recipientSkSeedHex,
      JSON.stringify(envelopeObj)
    );
    const plainBytes = hexToBytes(plainHex);
    const contentKeyBuffer = plainBytes.buffer as ArrayBuffer;
    return {
      result: { contentKeyBuffer },
      transferables: [contentKeyBuffer],
    };
  }
  throw new Error("Invalid wrapped key format");
}

// === AES-256-GCM Chunk Operations ===

export async function opEncryptChunk(
  payload: EncryptChunkPayload
): Promise<{ result: EncryptChunkResult; transferables: Transferable[] }> {
  const chunkPlaintext = new Uint8Array(payload.chunkPlaintextBuffer);
  const contentKey = new Uint8Array(payload.contentKeyBuffer);
  const iv = new Uint8Array(payload.ivBuffer);

  try {
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

    const encryptedChunkBuffer = out.buffer as ArrayBuffer;
    return {
      result: { encryptedChunkBuffer },
      transferables: [encryptedChunkBuffer],
    };
  } finally {
    contentKey.fill(0);
    zeroizeBuffer(payload.contentKeyBuffer);
    chunkPlaintext.fill(0);
    zeroizeBuffer(payload.chunkPlaintextBuffer);
  }
}

export async function opDecryptChunk(
  payload: DecryptChunkPayload
): Promise<{ result: DecryptChunkResult; transferables: Transferable[] }> {
  const encryptedChunk = new Uint8Array(payload.encryptedChunkBuffer);
  const contentKey = new Uint8Array(payload.contentKeyBuffer);
  const fallbackIV = payload.fallbackIVBuffer ? new Uint8Array(payload.fallbackIVBuffer) : undefined;

  try {
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

    const decryptedBytes = new Uint8Array(decrypted);
    const decryptedChunkBuffer = decryptedBytes.buffer as ArrayBuffer;
    return {
      result: { decryptedChunkBuffer },
      transferables: [decryptedChunkBuffer],
    };
  } finally {
    contentKey.fill(0);
    zeroizeBuffer(payload.contentKeyBuffer);
  }
}

// === Multi-chunk Attachment Pipeline ===

export async function opPreparePathAAttachment(
  payload: PreparePathAAttachmentPayload
): Promise<{ result: PreparePathAAttachmentResult; transferables: Transferable[] }> {
  const fileData = new Uint8Array(payload.file.dataBuffer);
  if (fileData.length > MAX_ATTACHMENT_SIZE) {
    throw new Error("Attachment exceeds maximum size of 40 MB");
  }

  const chunkSlices: Uint8Array[] = [];
  const recipientKey = new Uint8Array(32);
  const senderKey = new Uint8Array(32);

  try {
    const attachmentId = crypto.randomUUID();
    const contentHash = await computeSHA256(fileData);

    // Split into 1 MB chunks
    if (fileData.length === 0) {
      chunkSlices.push(new Uint8Array(0));
    } else {
      for (let offset = 0; offset < fileData.length; offset += CHUNK_SIZE) {
        chunkSlices.push(fileData.subarray(offset, Math.min(offset + CHUNK_SIZE, fileData.length)));
      }
    }

    const transferables: Transferable[] = [];

    // 1. Recipient Encryption
    crypto.getRandomValues(recipientKey);
    const recipientBaseIV = new Uint8Array(12);
    crypto.getRandomValues(recipientBaseIV);

    const recipientChunks: SerializedEncryptedChunk[] = [];
    const recipientMetaChunks: AttachmentChunk[] = [];

    for (let i = 0; i < chunkSlices.length; i++) {
      const chunkIV = new Uint8Array(12);
      crypto.getRandomValues(chunkIV);

      const chunkPlaintextBuffer = chunkSlices[i].buffer.slice(
        chunkSlices[i].byteOffset,
        chunkSlices[i].byteOffset + chunkSlices[i].byteLength
      ) as ArrayBuffer;
      const contentKeyBuffer = recipientKey.buffer.slice(0) as ArrayBuffer;
      const ivBuffer = chunkIV.buffer.slice(0) as ArrayBuffer;

      const { result } = await opEncryptChunk({
        chunkPlaintextBuffer,
        contentKeyBuffer,
        ivBuffer,
      });

      const paddedIndex = String(i).padStart(3, "0");
      const storageRef = `mailboxes/${payload.senderMailboxId}/path-a-attachments/${attachmentId}/chunk_${paddedIndex}.enc`;

      recipientChunks.push({
        index: i,
        storageRef,
        dataBuffer: result.encryptedChunkBuffer,
      });
      transferables.push(result.encryptedChunkBuffer);

      recipientMetaChunks.push({
        index: i,
        storage_ref: storageRef,
        size_bytes: result.encryptedChunkBuffer.byteLength,
      });
    }

    const { result: recWrapResult } = await opWrapAttachmentKey({
      contentKeyBuffer: recipientKey.buffer.slice(0) as ArrayBuffer,
      recipientXWingPkHex: payload.recipientXWingPkHex,
      mailboxId: payload.recipientMailboxId,
    });

    const recipientEnvelope: AttachmentEnvelope = {
      attachment_id: attachmentId,
      filename: payload.file.name,
      mime_type: payload.file.type || "application/octet-stream",
      size_bytes: fileData.length,
      iv: bytesToBase64(recipientBaseIV),
      wrapped_key: recWrapResult.wrappedKey,
      content_hash_sha256: contentHash,
      chunk_count: chunkSlices.length,
      chunks: recipientMetaChunks,
    };

    // 2. Sender Sent Copy Encryption (Fresh distinct key K_sender != K_recipient)
    crypto.getRandomValues(senderKey);
    const senderBaseIV = new Uint8Array(12);
    crypto.getRandomValues(senderBaseIV);

    const senderChunks: SerializedEncryptedChunk[] = [];
    const senderMetaChunks: AttachmentChunk[] = [];
    const sentMsgId = payload.messageId || "sent";

    for (let i = 0; i < chunkSlices.length; i++) {
      const chunkIV = new Uint8Array(12);
      crypto.getRandomValues(chunkIV);

      const chunkPlaintextBuffer = chunkSlices[i].buffer.slice(
        chunkSlices[i].byteOffset,
        chunkSlices[i].byteOffset + chunkSlices[i].byteLength
      ) as ArrayBuffer;
      const contentKeyBuffer = senderKey.buffer.slice(0) as ArrayBuffer;
      const ivBuffer = chunkIV.buffer.slice(0) as ArrayBuffer;

      const { result } = await opEncryptChunk({
        chunkPlaintextBuffer,
        contentKeyBuffer,
        ivBuffer,
      });

      const paddedIndex = String(i).padStart(3, "0");
      const storageRef = `mailboxes/${payload.senderMailboxId}/sent-attachments/${sentMsgId}/${attachmentId}/chunk_${paddedIndex}.enc`;

      senderChunks.push({
        index: i,
        storageRef,
        dataBuffer: result.encryptedChunkBuffer,
      });
      transferables.push(result.encryptedChunkBuffer);

      senderMetaChunks.push({
        index: i,
        storage_ref: storageRef,
        size_bytes: result.encryptedChunkBuffer.byteLength,
      });
    }

    const { result: sendWrapResult } = await opWrapAttachmentKey({
      contentKeyBuffer: senderKey.buffer.slice(0) as ArrayBuffer,
      recipientXWingPkHex: payload.senderXWingPkHex,
      mailboxId: payload.senderMailboxId,
    });

    const senderEnvelope: AttachmentEnvelope = {
      attachment_id: attachmentId,
      filename: payload.file.name,
      mime_type: payload.file.type || "application/octet-stream",
      size_bytes: fileData.length,
      iv: bytesToBase64(senderBaseIV),
      wrapped_key: sendWrapResult.wrappedKey,
      content_hash_sha256: contentHash,
      chunk_count: chunkSlices.length,
      chunks: senderMetaChunks,
    };

    return {
      result: {
        recipientEnvelope,
        recipientChunks,
        senderEnvelope,
        senderChunks,
      },
      transferables,
    };
  } finally {
    recipientKey.fill(0);
    senderKey.fill(0);
    fileData.fill(0);
    zeroizeBuffer(payload.file.dataBuffer);
    for (const chunk of chunkSlices) {
      chunk.fill(0);
    }
  }
}

export async function opDecryptPathAAttachment(
  payload: DecryptPathAAttachmentPayload
): Promise<{ result: DecryptPathAAttachmentResult; transferables: Transferable[] }> {
  let contentKeyBuffer: ArrayBuffer;
  try {
    const unwrapRes = await opUnwrapAttachmentKey({
      wrappedKey: payload.envelope.wrapped_key,
      recipientSkSeedHex: payload.skSeedHex,
      mailboxId: payload.mailboxId,
    });
    contentKeyBuffer = unwrapRes.result.contentKeyBuffer;
  } catch (err) {
    console.warn(`[Worker Crypto] Key unwrap failed for attachment_id=${payload.envelope.attachment_id}`);
    return {
      result: {
        isCorrupted: true,
        error: "Unable to unwrap attachment key",
        filename: payload.envelope.filename,
        mimeType: payload.envelope.mime_type,
      },
      transferables: [],
    };
  }

  const contentKey = new Uint8Array(contentKeyBuffer);
  const decryptedChunks: Uint8Array[] = [];
  let isFailure = true;

  try {
    for (let i = 0; i < payload.chunks.length; i++) {
      try {
        const { result: decRes } = await opDecryptChunk({
          encryptedChunkBuffer: payload.chunks[i],
          contentKeyBuffer: contentKeyBuffer.slice(0),
        });
        decryptedChunks.push(new Uint8Array(decRes.decryptedChunkBuffer));
      } catch (chunkErr) {
        console.warn(`[Worker Crypto] Decryption failed for attachment_id=${payload.envelope.attachment_id} chunk_index=${i}`);
        return {
          result: {
            isCorrupted: true,
            error: `Corrupted chunk at index ${i}`,
            filename: payload.envelope.filename,
            mimeType: payload.envelope.mime_type,
          },
          transferables: [],
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
    if (calculatedHash !== payload.envelope.content_hash_sha256) {
      console.warn(
        `[Worker Crypto] Hash mismatch for attachment_id=${payload.envelope.attachment_id} (expected=${payload.envelope.content_hash_sha256.slice(0, 16)}..., actual=${calculatedHash.slice(0, 16)}...)`
      );
      assembled.fill(0);
      return {
        result: {
          isCorrupted: true,
          error: "Attachment integrity verification failed (SHA-256 mismatch)",
          filename: payload.envelope.filename,
          mimeType: payload.envelope.mime_type,
        },
        transferables: [],
      };
    }

    isFailure = false;
    const assembledBuffer = assembled.buffer as ArrayBuffer;
    return {
      result: {
        isCorrupted: false,
        dataBuffer: assembledBuffer,
        filename: payload.envelope.filename,
        mimeType: payload.envelope.mime_type,
      },
      transferables: [assembledBuffer],
    };
  } finally {
    contentKey.fill(0);
    zeroizeBuffer(contentKeyBuffer);
    if (isFailure) {
      for (const chunk of decryptedChunks) {
        chunk.fill(0);
      }
    }
  }
}
