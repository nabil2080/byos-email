import {
  generateTOTPSecret,
  formatTOTPSecret,
  base32ToBytes,
  computeTOTPCode,
  verifyTOTPClient,
} from "./totp.js"; // Use .js for node execution compatibility if needed, though tsx handles it

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
    const withPadding = "JBSWY3DPEBLW64TMMQQQ====";
    const bytes2 = base32ToBytes(withPadding);
    assert(bytes2.length === expected.length, "Padding should be ignored");
  });

  // 4. computeTOTPCode
  await runTest("computeTOTPCode generates correct format", async () => {
    const secret = "JBSWY3DPEBLW64TMMQQQ";
    const code0 = await computeTOTPCode(secret, 0);
    assert(typeof code0 === "string", "Code should be string");
    assert(code0.length === 6, "Code should be 6 digits");
    assert(/^[0-9]{6}$/.test(code0), "Code should contain only numbers");
  });

  // 5. verifyTOTPClient
  await runTest("verifyTOTPClient returns true for correct code in window", async () => {
    const secret = generateTOTPSecret();
    const now = Math.floor(Date.now() / 1000);
    const code = await computeTOTPCode(secret, now);

    const isValid = await verifyTOTPClient(secret, code);
    assert(isValid === true, "Should return true for correct code");

    const isInvalid = await verifyTOTPClient(secret, "000000");
    // Small chance it's actually 000000, so we check if it was actually that code
    assert(isInvalid === false || code === "000000", "Should return false for incorrect code");
  });

  return { passed, failed };
}
