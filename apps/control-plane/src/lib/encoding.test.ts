import { bytesToBase64, hexToBytes, bytesToHex } from "./encoding";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runEncodingTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  }

  console.log("Running Encoding Utility Tests...");

  test("hexToBytes converts valid hex string to Uint8Array", () => {
    const bytes = hexToBytes("deadbeef");
    assert(bytes.length === 4, "Expected 4 bytes");
    assert(bytes[0] === 0xde && bytes[1] === 0xad && bytes[2] === 0xbe && bytes[3] === 0xef, "Byte values mismatch");
  });

  test("hexToBytes throws error for odd length string", () => {
    let threw = false;
    try {
      hexToBytes("abc");
    } catch {
      threw = true;
    }
    assert(threw, "Expected error on odd hex string");
  });

  test("bytesToHex converts Uint8Array to hex string", () => {
    const hex = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    assert(hex === "deadbeef", "Expected deadbeef");
  });

  test("bytesToBase64 converts small and large Uint8Array chunks", () => {
    const helloBytes = new TextEncoder().encode("Hello, World!");
    const b64 = bytesToBase64(helloBytes);
    assert(b64 === btoa("Hello, World!"), "Base64 encoding mismatch");

    // Large buffer across chunk boundary (> 32KB)
    const largeBuffer = new Uint8Array(70000);
    for (let i = 0; i < largeBuffer.length; i++) {
      largeBuffer[i] = i % 256;
    }
    const largeB64 = bytesToBase64(largeBuffer);
    assert(largeB64.length > 0, "Expected non-empty base64 string");
  });

  return { passed, failed };
}
