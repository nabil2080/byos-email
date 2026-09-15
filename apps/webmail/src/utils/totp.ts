// RFC 6238 TOTP utilities for client-side setup and verification

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTOTPSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function formatTOTPSecret(secret: string): string {
  const clean = secret.replace(/\s+/g, "").toUpperCase();
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    chunks.push(clean.slice(i, i + 4));
  }
  return chunks.join(" ");
}

export function base32ToBytes(base32: string): Uint8Array {
  const clean = base32.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

export async function computeTOTPCode(secret: string, timestampSeconds?: number): Promise<string> {
  const keyBytes = base32ToBytes(secret);
  const time = timestampSeconds ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(time / 30);

  const counterBuffer = new ArrayBuffer(8);
  const counterView = new DataView(counterBuffer);
  counterView.setUint32(0, Math.floor(counter / 0x100000000), false);
  counterView.setUint32(4, counter & 0xffffffff, false);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as ArrayBufferView<ArrayBuffer>,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, counterBuffer);
  const hash = new Uint8Array(signature);

  const offset = hash[hash.length - 1] & 0x0f;
  const dataView = new DataView(hash.buffer, hash.byteOffset + offset, 4);
  const binary = dataView.getUint32(0, false) & 0x7fffffff;
  const otp = binary % 1000000;

  return otp.toString().padStart(6, "0");
}

export async function verifyTOTPClient(secret: string, code: string): Promise<boolean> {
  const cleanCode = code.trim();
  if (cleanCode.length !== 6) return false;

  const now = Math.floor(Date.now() / 1000);
  const windows = [now, now - 30, now + 30];

  for (const t of windows) {
    try {
      const expected = await computeTOTPCode(secret, t);
      if (expected === cleanCode) {
        return true;
      }
    } catch {
      // ignore calculation errors in loop
    }
  }

  return false;
}
