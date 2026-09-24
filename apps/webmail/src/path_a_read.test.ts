import { decryptPathAEnvelope, hexToBase64, hexToBytes, extractCleanEmail } from "./message_crypto";
import { KeyDirectoryRecord } from "./api";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Test vector from crypto/envelope/testdata/envelope_signed_rust.json
const RUST_VECTOR = {
  envelope_json: JSON.stringify({
    alg: "HPKE-XWing-AES256GCM-v1",
    ciphertext: "IFKe3Dx0wcgbPXjjhYxVAAYmWYrwlm3hSKOhokcEc82Y5Df7FRaCN1YyJMMCWTga/37psFX0CHj8T2GM10vnwmWkrLafO9Ljo7HT",
    enc: "LIfiwhdUfLzXIK6UEkT84+fOJrtQXfcYhEyrq6C2q/Xk2xn/dzUymri2bzdosfVJJ3cWtFMk/C2tc/bLaDYfPDWVy0vIvg8jq5gNUx0MRWm8AeBiE4u6poEXJ7AmXg6VAP8yEgjGgpkq54robi6NOzDIvxgUYsU+XebYnUEwdXJ1RFUFfN0DOs1W3NwYn8178B+jVpmDx/W4U5bO2rO5NsxxNnyL0lNfp1vH/rRqNwTTe3CG3g1jbFeG/eyGNxqXMo97LHM1cF24IsewMbWNepQHL2I6bDhwXCqcAAavEp5D3UH2oK0a+YEBkVnYwyDY83m9HUZ1+NfU1ge/nAT2ZW+r6oHYFW77Ymku2fHcDfBhSFlkZuJVsTtXk0L/mwvutRHtrslKIbWMfR3SMdveqPHNDsZZpvoG6PUckrtLi2K1iDgFmhSC9zb1IJCSK2sLyjF1V9wDthEvl8w94rMHS3jaizTZfEuD7qIXNRzTzVx5sYdqAeOfnPazVEUT+BJx8ANXsdNMauXYH+xqSlE/6vdDMQzPt4MHTiLKyGPKNNgBDLKmRNRIFWxA67jIo6nBmrgn2TC56WQYb2QKgnZrKuCkQC3HCcIQl8JQFXP/8KKWtCgF7v9VcTPN8Zm0lMEDdnCk2mQi3KCF+vFpvoipP+WbsndNRqjUsX7AmJnaSuoBPEky5eY6ddQH6tvVZ5nH9PTZ0jn0pP38gJHXBL4chBag6HNtkpz1HwYUxN8HH6r+R9q0CcKr4N7H3Ny0Apiwzhw7KszZZqjb7AUeETXkds1pnG8QHgjhfS0Gw9pbQlVV8LeIkRE0xTzMxbPR8rW4WWPj30jz3aWK1iRS8B6dFXF3r3gHqlBpn57Xk0k+8deWwS/xfUUn1zww7vGshEdilV32yezy334j7dSXYU49C4acsWd0ekmh+x37KlxIHxYC+GlsA07s1Eo9hgl7ZwZ/Ob/NcvWltaPkc+7ydzoP9dAy1E8GemBEZeqxN7aEBKrj8N6vwPP7qUAnffm/yNmLaeLgtGx0BVOfV5J1P4+6KYB2oxaNuUxvVxLuOegCeEfaeiQZPCBFtcX9iMiWiem09xr30blb+3YyH702NGVMQ7ZFpycManlbuVQy/JhADizHf3IWQ8R3LPUHBvJsa/6Pynzmcd8vWbpMxF+cP7JdMTi4LZtQR9M1d56iTT/nZ0Jpk4kGWoGtyzHUuLBhguhrYInXdoUTlivHK12IQKvwcqLDb0RBC5JCx8kmfCbLjiS3kkR25k9ooWEQVN59Z9XPBKPG90/mZTNl8xDWL49quXVzZkD/yv133Een6Rxz7+jfCtSgmbDWU/QVzYnXrjwEWKSC8umHJCNrscu0f6M4e/cRRamLMOhvcModaUDzvvSUJUt82T4sNBN38LzcHL+3i3Tt+MuDYWc0NQEH1hQpO3+jOe4ZZ4x1q8DfhH2C40IKPdRGD5ECF4reCaDQm1ePnVH9mqiRiUmtyuJMcKgcRg==",
    key_epoch: 1,
    key_id: "a0000000-0000-0000-0000-000000000001",
    nonce: "d3d3d3d3d3d3d3d3",
    sig: "s9OhXjaMmIgxmF3NwEqAfH7cAyUMj27QH9LVEOCBrMiGpgdqtcEw+5lIjwgZfZxqA8jMRddp3kB+w0r8wWVcDQ==",
    v: 1,
  }),
  expected_plaintext: "Cross-language envelope signature verification test payload",
  recipient_seed_hex: "5555555555555555555555555555555555555555555555555555555555555555",
  sender_ed25519_pk_hex: "17cb79fb2b4120f2b1ec65e4198d6e08b28e813feb01e4a400839b85e18080ce",
};

export async function runPathAReadTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Path A Read & Signature Verification Tests...");

  const recipientSeed = hexToBytes(RUST_VECTOR.recipient_seed_hex);
  const senderPkB64 = hexToBase64(RUST_VECTOR.sender_ed25519_pk_hex);

  const senderRecord: KeyDirectoryRecord = {
    email_address: "alice@example.com",
    key_id: "00000000-0000-0000-0000-000000000001",
    key_epoch: 1,
    xwing_public_key: "dummy",
    ed25519_signing_public_key: senderPkB64,
    signing_key_epoch: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  // 1. decryptPathAEnvelope returns plaintext + verified=true on the Rust vector
  await test("1. decryptPathAEnvelope returns plaintext + verified=true on the Rust vector", async () => {
    const res = await decryptPathAEnvelope(
      RUST_VECTOR.envelope_json,
      "Alice <alice@example.com>",
      recipientSeed,
      {
        lookupMailboxKeys: async () => senderRecord,
      }
    );
    assert(res.plaintext === RUST_VECTOR.expected_plaintext, `plaintext matches expected, got: ${res.plaintext}`);
    assert(res.senderVerified === true, "senderVerified is true");
    assert(!res.senderVerifyError, `no error expected, got: ${res.senderVerifyError}`);
  });

  // 2. Returns verified=false when signature is tampered
  await test("2. Returns verified=false when signature is tampered", async () => {
    const env = JSON.parse(RUST_VECTOR.envelope_json);
    // Flip a character in sig base64
    const originalSig = env.sig;
    env.sig = originalSig[0] === "A" ? "B" + originalSig.slice(1) : "A" + originalSig.slice(1);
    const tamperedJson = JSON.stringify(env);

    const res = await decryptPathAEnvelope(
      tamperedJson,
      "alice@example.com",
      recipientSeed,
      {
        lookupMailboxKeys: async () => senderRecord,
      }
    );
    assert(res.plaintext === RUST_VECTOR.expected_plaintext, "plaintext decrypts despite bad sig");
    assert(res.senderVerified === false, "senderVerified is false");
    assert(res.senderVerifyError === "Signature does not match sender", `got error: ${res.senderVerifyError}`);
  });

  // 3. Returns verified=false when sender has no ed25519 key in directory
  await test("3. Returns verified=false when sender has no ed25519 key in directory", async () => {
    const res = await decryptPathAEnvelope(
      RUST_VECTOR.envelope_json,
      "alice@example.com",
      recipientSeed,
      {
        lookupMailboxKeys: async () => ({
          ...senderRecord,
          ed25519_signing_public_key: "",
        }),
      }
    );
    assert(res.plaintext === RUST_VECTOR.expected_plaintext, "plaintext decrypts");
    assert(res.senderVerified === false, "senderVerified is false");
    assert(res.senderVerifyError === "Sender has no published signing key", `got error: ${res.senderVerifyError}`);
  });

  // 4. Throws when envelope JSON is malformed
  await test("4. Throws when envelope JSON is malformed", async () => {
    let threw = false;
    try {
      await decryptPathAEnvelope("not valid json", "alice@example.com", recipientSeed);
    } catch {
      threw = true;
    }
    assert(threw, "expected error on malformed JSON");
  });

  // 5. Throws when recipient seed is wrong length
  await test("5. Throws when recipient seed is wrong length", async () => {
    let threw = false;
    try {
      const badSeed = new Uint8Array(16); // 16 bytes instead of 32
      await decryptPathAEnvelope(RUST_VECTOR.envelope_json, "alice@example.com", badSeed);
    } catch {
      threw = true;
    }
    assert(threw, "expected error on wrong seed length");
  });

  // 6. Handles empty string envelope gracefully
  await test("6. Handles empty string envelope gracefully", async () => {
    let threw = false;
    try {
      await decryptPathAEnvelope("", "alice@example.com", recipientSeed);
    } catch {
      threw = true;
    }
    assert(threw, "expected error on empty envelope string");
  });

  // 7. extractCleanEmail helper test
  await test("7. extractCleanEmail extracts RFC and plain addresses correctly", async () => {
    assert(extractCleanEmail("Alice <alice@byos.local>") === "alice@byos.local", "Name <email>");
    assert(extractCleanEmail("<alice@byos.local>") === "alice@byos.local", "<email>");
    assert(extractCleanEmail("alice@byos.local") === "alice@byos.local", "plain email");
    assert(extractCleanEmail("  alice@byos.local  ") === "alice@byos.local", "trimmed email");
  });

  // 8. decryptPathAEnvelope handles unknown_mailbox error with a friendly message
  await test("8. decryptPathAEnvelope handles unknown_mailbox error with a friendly message", async () => {
    const res = await decryptPathAEnvelope(
      RUST_VECTOR.envelope_json,
      "external@gmail.com",
      recipientSeed,
      {
        lookupMailboxKeys: async () => {
          throw new Error('{"error":"unknown_mailbox","message":"unknown mailbox"}');
        },
      }
    );
    assert(!res.senderVerified, "senderVerified should be false");
    assert(
      res.senderVerifyError === "This message came from outside BYOS. Its sender cannot be cryptographically verified.",
      `unexpected error: ${res.senderVerifyError}`
    );
  });

  return { passed, failed };
}
