import {
  generateTOTPSecret,
  formatTOTPSecret,
  base32ToBytes,
  computeTOTPCode,
  verifyTOTPClient,
} from "./totp.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runTotpTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const runTest = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  // 1. generateTOTPSecret
  await runTest("generateTOTPSecret creates a valid base32 string", () => {
    const secret = generateTOTPSecret();
    assert(typeof secret === "string", "Secret should be a string");
    assert(secret.length === 32, "Secret should be 32 characters long");
    assert(/^[A-Z2-7]+$/.test(secret), "Secret should contain only valid base32 characters");
  });

  // 2. formatTOTPSecret
  await runTest("formatTOTPSecret formats base32 string into 4-character chunks", () => {
    const secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const formatted = formatTOTPSecret(secret);
    assert(formatted === "ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567", "Should format with spaces every 4 characters");

    // Also tests cleaning up spaces
    const messy = " aBc d\tef ";
    assert(formatTOTPSecret(messy) === "ABCD EF", "Should clean up whitespace and uppercase");
  });

  // 3. base32ToBytes
  await runTest("base32ToBytes converts base32 string to Uint8Array correctly", () => {
    // JBSWY3DPEBLW64TMMQQQ -> "Hello World!" -> [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33]
    const base32 = "JBSWY3DPEBLW64TMMQQQ";
    const expected = new Uint8Array([72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100, 33]);

    const bytes = base32ToBytes(base32);
    assert(bytes.length === expected.length, "Lengths should match");
    for (let i = 0; i < bytes.length; i++) {
      assert(bytes[i] === expected[i], `Byte at index ${i} should match`);
    }

    // Ignores spaces and '='
    const withPaddingAndSpaces = "JBSW Y3DP EBLW 64TM MQQQ===";
    const bytes2 = base32ToBytes(withPaddingAndSpaces);
    assert(bytes2.length === expected.length, "Padded length should match");
    for (let i = 0; i < bytes2.length; i++) {
      assert(bytes2[i] === expected[i], `Byte at index ${i} should match in padded version`);
    }
  });

  // 4. computeTOTPCode (Standard RFC 6238 Test Vectors using Secret: "12345678901234567890" -> Base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
  await runTest("computeTOTPCode matches RFC 6238 standard test vectors", async () => {
    // Base32 representation of ASCII string "12345678901234567890" (20 bytes key)
    const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    // RFC 6238 test values for SHA1:
    // T = 59s -> counter = 1 -> OTP = "287082"
    const code59 = await computeTOTPCode(rfcSecret, 59);
    assert(code59 === "287082", `Expected '287082' for T=59, got '${code59}'`);

    // T = 1111111109s -> counter = 37037036 -> OTP = "081804"
    const code1111111109 = await computeTOTPCode(rfcSecret, 1111111109);
    assert(code1111111109 === "081804", `Expected '081804' for T=1111111109, got '${code1111111109}'`);

    // T = 1111111111s -> counter = 37037037 -> OTP = "050471"
    const code1111111111 = await computeTOTPCode(rfcSecret, 1111111111);
    assert(code1111111111 === "050471", `Expected '050471' for T=1111111111, got '${code1111111111}'`);

    // T = 2000000000s -> counter = 66666666 -> OTP = "279037"
    const code2000000000 = await computeTOTPCode(rfcSecret, 2000000000);
    assert(code2000000000 === "279037", `Expected '279037' for T=2000000000, got '${code2000000000}'`);
  });

  // 5. verifyTOTPClient
  await runTest("verifyTOTPClient handles time tolerance windows", async () => {
    const secret = generateTOTPSecret();
    const now = Math.floor(Date.now() / 1000);

    // Current code
    const currentCode = await computeTOTPCode(secret, now);
    assert(await verifyTOTPClient(secret, currentCode), "Should verify current code");

    // Code from previous window (-30s)
    const pastCode = await computeTOTPCode(secret, now - 30);
    assert(await verifyTOTPClient(secret, pastCode), "Should verify past code (-30s window)");

    // Code from next window (+30s)
    const futureCode = await computeTOTPCode(secret, now + 30);
    assert(await verifyTOTPClient(secret, futureCode), "Should verify future code (+30s window)");

    // Code too old (-60s)
    const tooOldCode = await computeTOTPCode(secret, now - 65);
    // Note: If now - 65 lands on a window boundary, it could rarely be -60s, but it's 2 windows back
    assert(!(await verifyTOTPClient(secret, tooOldCode)), "Should reject code older than 1 window");

    // Invalid code length
    assert(!(await verifyTOTPClient(secret, "123")), "Should reject non-6-digit code");
    assert(!(await verifyTOTPClient(secret, "abcdef")), "Should reject non-matching code");
  });

  return { passed, failed };
}
