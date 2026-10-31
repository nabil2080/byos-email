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

export enum CryptoWorkerOp {
  PING = "PING",
  ARGON2_WRAP_KEY = "ARGON2_WRAP_KEY",
  ARGON2_UNWRAP_KEY = "ARGON2_UNWRAP_KEY",
  AUTO_UNWRAP_KEYS = "AUTO_UNWRAP_KEYS",
  XWING_SEAL_ENVELOPE = "XWING_SEAL_ENVELOPE",
  XWING_SEAL_ENVELOPE_SIGNED = "XWING_SEAL_ENVELOPE_SIGNED",
  XWING_OPEN_ENVELOPE = "XWING_OPEN_ENVELOPE",
  XWING_WRAP_ATTACHMENT_KEY = "XWING_WRAP_ATTACHMENT_KEY",
  XWING_UNWRAP_ATTACHMENT_KEY = "XWING_UNWRAP_ATTACHMENT_KEY",
  ATTACHMENT_PREPARE_PATH_A = "ATTACHMENT_PREPARE_PATH_A",
  ATTACHMENT_DECRYPT_PATH_A = "ATTACHMENT_DECRYPT_PATH_A",
  ATTACHMENT_ENCRYPT_CHUNK = "ATTACHMENT_ENCRYPT_CHUNK",
  ATTACHMENT_DECRYPT_CHUNK = "ATTACHMENT_DECRYPT_CHUNK",
}

export interface WorkerMessage<T = unknown> {
  id: string;
  type: CryptoWorkerOp;
  payload: T;
}

export interface WorkerResponse<R = unknown> {
  id: string;
  success: boolean;
  result?: R;
  error?: string;
}

export interface Argon2WrapPayload {
  passphrase: string;
  saltHex: string;
  plaintextHex: string;
}

export interface Argon2WrapResult {
  envelopeHex: string;
}

export interface Argon2UnwrapPayload {
  passphrase: string;
  saltHex: string;
  envelopeHex: string;
}

export interface Argon2UnwrapResult {
  keyHex: string;
  keyBuffer: ArrayBuffer;
}

export interface AutoUnwrapKeysPayload {
  password: string;
  wrappedSkUser: string;
}

export interface AutoUnwrapKeysResult {
  mailboxSkBuffer: ArrayBuffer;
  signingSeedBuffer: ArrayBuffer | null;
  xwingSeedBuffer: ArrayBuffer | null;
  searchKeyHex: string;
}

export interface XWingSealPayload {
  recipientXWingPkHex: string;
  keyId: string;
  keyEpoch: number;
  plaintextHex: string;
}

export interface XWingSealSignedPayload extends XWingSealPayload {
  senderSigningSeedHex: string;
}

export interface XWingSealResult {
  envelopeJson: string;
}

export interface XWingOpenPayload {
  recipientXWingSkSeedHex: string;
  envelopeJson: string;
}

export interface XWingOpenResult {
  plaintextHex: string;
  plaintextBuffer: ArrayBuffer;
}

export interface WrapAttachmentKeyPayload {
  contentKeyBuffer: ArrayBuffer;
  recipientXWingPkHex: string;
  mailboxId: string;
}

export interface WrapAttachmentKeyResult {
  wrappedKey: AttachmentWrappedKey;
}

export interface UnwrapAttachmentKeyPayload {
  wrappedKey: AttachmentWrappedKey;
  recipientSkSeedHex: string;
  mailboxId: string;
}

export interface UnwrapAttachmentKeyResult {
  contentKeyBuffer: ArrayBuffer;
}

export interface PreparePathAAttachmentPayload {
  file: {
    name: string;
    type: string;
    dataBuffer: ArrayBuffer;
  };
  senderMailboxId: string;
  recipientMailboxId: string;
  recipientXWingPkHex: string;
  senderXWingPkHex: string;
  messageId?: string;
}

export interface SerializedEncryptedChunk {
  index: number;
  storageRef: string;
  dataBuffer: ArrayBuffer;
}

export interface PreparePathAAttachmentResult {
  recipientEnvelope: AttachmentEnvelope;
  recipientChunks: SerializedEncryptedChunk[];
  senderEnvelope: AttachmentEnvelope;
  senderChunks: SerializedEncryptedChunk[];
}

export interface DecryptPathAAttachmentPayload {
  envelope: AttachmentEnvelope;
  chunks: ArrayBuffer[];
  skSeedHex: string;
  mailboxId: string;
}

export interface DecryptPathAAttachmentResult {
  isCorrupted: boolean;
  dataBuffer?: ArrayBuffer;
  filename?: string;
  mimeType?: string;
  error?: string;
}

export interface EncryptChunkPayload {
  chunkPlaintextBuffer: ArrayBuffer;
  contentKeyBuffer: ArrayBuffer;
  ivBuffer: ArrayBuffer;
}

export interface EncryptChunkResult {
  encryptedChunkBuffer: ArrayBuffer;
}

export interface DecryptChunkPayload {
  encryptedChunkBuffer: ArrayBuffer;
  contentKeyBuffer: ArrayBuffer;
  fallbackIVBuffer?: ArrayBuffer;
}

export interface DecryptChunkResult {
  decryptedChunkBuffer: ArrayBuffer;
}

/**
 * Explicitly zeroes sensitive byte memory across ArrayBuffer or Uint8Array.
 */
export function zeroizeBuffer(buf: ArrayBuffer | Uint8Array | null | undefined): void {
  if (!buf) return;
  if (buf instanceof Uint8Array) {
    buf.fill(0);
  } else if (buf instanceof ArrayBuffer) {
    if (!buf.detached && buf.byteLength > 0) {
      new Uint8Array(buf).fill(0);
    }
  }
}
