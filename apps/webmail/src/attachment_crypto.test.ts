import {
  encryptAttachmentBytes,
  decryptAttachmentBytes,
  bytesToHex,
  hexToBytes,
} from "./attachment_crypto";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runAttachmentCryptoTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  const key1 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key1[i] = i + 1;

  const key2 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key2[i] = 255 - i;

  const plaintext = new TextEncoder().encode("attachment-test-payload-secret-file-content");

  // 1. Plaintext != Uploaded bytes
  runTest("Plaintext is not equal to encrypted ciphertext envelope", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    assert(ciphertext.length > plaintext.length, "Ciphertext should include version, nonce, tag");
    const same =
      ciphertext.length === plaintext.length &&
      ciphertext.every((b, idx) => b === plaintext[idx]);
    assert(!same, "Plaintext bytes MUST NOT equal encrypted bytes");
  });

  // 2. Client decrypt round-trip
  runTest("Decrypt(ciphertext, correct_key) returns original plaintext", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    const decrypted = decryptAttachmentBytes(ciphertext, key1);
    assert(decrypted.length === plaintext.length, "Decrypted length match");
    const matches = decrypted.every((b, idx) => b === plaintext[idx]);
    assert(matches, "Decrypted content MUST match original plaintext");
  });

  // 3. Tamper detection
  runTest("Tampered ciphertext fails decryption", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0xff; // flip last byte

    let threw = false;
    try {
      decryptAttachmentBytes(tampered, key1);
    } catch {
      threw = true;
    }
    assert(threw, "Tampered ciphertext MUST fail decryption");
  });

  // 4. Wrong key detection
  runTest("Decrypting with wrong key fails", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    let threw = false;
    try {
      decryptAttachmentBytes(ciphertext, key2);
    } catch {
      threw = true;
    }
    assert(threw, "Decrypting with wrong key MUST throw error");
  });

  // 5. Storage and log leakage check
  runTest("No plaintext file bytes stored or logged", () => {
    const secretStr = "attachment-test-payload-secret-file-content";
    const loggedMsgs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      loggedMsgs.push(args.map((a) => String(a)).join(" "));
    };

    try {
      encryptAttachmentBytes(plaintext, key1);
    } finally {
      console.log = origLog;
    }

    const leakedInLog = loggedMsgs.some((m) => m.includes(secretStr));
    assert(!leakedInLog, "Plaintext MUST NOT be output to console logs");

    if (typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) {
          const val = localStorage.getItem(k) || "";
          assert(!val.includes(secretStr), "Plaintext MUST NOT be written to localStorage");
        }
      }
    }
  });

  return { passed, failed };
}
