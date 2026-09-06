import {
  wasm_aes_gcm_encrypt,
  wasm_aes_gcm_decrypt,
} from "./generated/crypto-core/byos_crypto_core.js";

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

/**
 * Encrypts raw attachment bytes using Section 12 canonical AES-GCM WASM primitive.
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

/**
 * Decrypts encrypted attachment envelope bytes using Section 12 canonical AES-GCM WASM primitive.
 */
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
