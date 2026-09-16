export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chars.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE) as unknown as number[]));
  }
  return btoa(chars.join(""));
}

export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.trim();
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string: length must be even");
  }
  const parts = cleanHex.match(/.{1,2}/g);
  if (!parts) {
    return new Uint8Array(0);
  }
  return new Uint8Array(parts.map((b) => parseInt(b, 16)));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
