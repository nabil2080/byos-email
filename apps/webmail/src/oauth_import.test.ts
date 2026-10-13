import {
  encryptTokenPayload,
  decryptTokenPayload,
  encryptRawEml,
  computeEnvelopeAad,
  OAuthTokens,
} from "./oauth_import";
import { parseRfc822Headers, fetchWithBackoff } from "./import_worker";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

export async function runOAuthImportTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ✗ ${name}: ${e.message}`);
      failed++;
    }
  }

  // 1. Token Encryption Roundtrip
  await test("encryptTokenPayload and decryptTokenPayload round-trip", async () => {
    const mailboxKey = crypto.getRandomValues(new Uint8Array(32));
    const originalTokens: OAuthTokens = {
      provider: "gmail",
      accessToken: "ya29.mock_access_token_12345",
      refreshToken: "1//mock_refresh_token_67890",
      expiresAt: Date.now() + 3600 * 1000,
    };

    const encrypted = await encryptTokenPayload(mailboxKey, originalTokens);
    assert(encrypted.length > 29, "Encrypted payload must have envelope overhead");
    assert(encrypted[0] === 0x01, "Version byte must be 0x01");

    const decrypted = await decryptTokenPayload(mailboxKey, encrypted);
    assert(decrypted.provider === originalTokens.provider, "Provider matches");
    assert(decrypted.accessToken === originalTokens.accessToken, "Access token matches");
    assert(decrypted.refreshToken === originalTokens.refreshToken, "Refresh token matches");
    assert(decrypted.expiresAt === originalTokens.expiresAt, "ExpiresAt matches");
  });

  // 2. Tampered ciphertext rejection
  await test("Tampered token ciphertext is rejected by decryptTokenPayload", async () => {
    const mailboxKey = crypto.getRandomValues(new Uint8Array(32));
    const originalTokens: OAuthTokens = {
      provider: "outlook",
      accessToken: "mock_outlook_access_token",
      expiresAt: Date.now() + 3600 * 1000,
    };

    const encrypted = await encryptTokenPayload(mailboxKey, originalTokens);
    const tampered = new Uint8Array(encrypted);
    // Flip a bit in the ciphertext portion
    tampered[tampered.length - 1] ^= 0xff;

    let threw = false;
    try {
      await decryptTokenPayload(mailboxKey, tampered);
    } catch {
      threw = true;
    }
    assert(threw, "Tampered ciphertext must fail decryption");
  });

  // 3. Section 12 EML envelope structure
  await test("encryptRawEml generates Section 12 AES-GCM envelope", async () => {
    const mailboxKey = crypto.getRandomValues(new Uint8Array(32));
    const mailboxId = "00000000-0000-0000-0000-000000000001";
    const rawEml = "From: alice@test.org\r\nTo: bob@test.org\r\nSubject: Test\r\n\r\nHello World";

    const encrypted = await encryptRawEml(mailboxKey, mailboxId, rawEml);
    assert(encrypted[0] === 0x01, "Envelope header version must be 0x01");
    // IV length is 12 bytes
    const iv = encrypted.subarray(1, 13);
    assert(iv.length === 12, "IV length must be 12 bytes");
    // Ciphertext + tag (16 bytes)
    const ct = encrypted.subarray(13);
    assert(ct.length > 16, "Ciphertext + tag must be present");

    // Decrypt using SubtleCrypto directly with envelope AAD to verify correctness
    const aad = computeEnvelopeAad(mailboxId, "byos-draft-v1");
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      mailboxKey as unknown as BufferSource,
      "AES-GCM",
      false,
      ["decrypt"]
    );
    const decryptedBuf = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
      },
      cryptoKey,
      ct as unknown as BufferSource
    );
    const recovered = new TextDecoder().decode(decryptedBuf);
    assert(recovered === rawEml, "Decrypted EML must match original raw string exactly");
  });

  // 4. RFC 822 Header Parsing
  await test("parseRfc822Headers extracts From, To, Cc, Subject, Date, and attachments", () => {
    const raw = [
      "From: Jane Doe <jane@example.com>",
      "To: John Doe <john@example.com>, Jack <jack@example.com>",
      "Cc: Boss <boss@example.com>",
      "Subject: Quarterly Review 2026",
      "Date: Wed, 15 Jan 2026 10:00:00 +0000",
      'Content-Type: multipart/mixed; boundary="boundary123"',
      "",
      "This is body text",
    ].join("\r\n");

    const parsed = parseRfc822Headers(raw);
    assert(parsed.from === "Jane Doe <jane@example.com>", "From header parsed");
    assert(parsed.to.length === 3, "To and Cc parsed into recipient list (3 items)");
    assert(parsed.to[0] === "John Doe <john@example.com>", "First recipient matches");
    assert(parsed.to[2] === "Boss <boss@example.com>", "Cc recipient included");
    assert(parsed.subject === "Quarter Review 2026" || parsed.subject === "Quarterly Review 2026", "Subject matches");
    assert(parsed.hasAttachments === true, "Multipart/mixed indicates attachments");
    assert(parsed.date !== undefined && parsed.date.includes("2026-01-15"), "Date parsed to ISO string");
  });

  // 5. fetchWithBackoff respects 429 Retry-After delay
  await test("fetchWithBackoff respects 429 Retry-After header", async () => {
    const origFetch = globalThis.fetch;
    let callCount = 0;
    const start = Date.now();

    // Mock fetch that returns 429 on first call, 200 on second call
    globalThis.fetch = (async (url: any, init: any) => {
      callCount++;
      if (callCount === 1) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": "1" }, // 1 second
        });
      }
      return new Response("OK", { status: 200 });
    }) as any;

    try {
      const res = await fetchWithBackoff("https://mock.provider/api", {});
      const elapsed = Date.now() - start;
      assert(res.status === 200, "Eventual response is 200");
      assert(callCount === 2, "Called twice");
      assert(elapsed >= 900, `Waited Retry-After period (elapsed: ${elapsed}ms >= 900ms)`);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // 6. fetchWithBackoff handles AbortSignal
  await test("fetchWithBackoff aborts immediately when signal triggered", async () => {
    const controller = new AbortController();
    controller.abort();

    let threw = false;
    try {
      await fetchWithBackoff("https://mock.provider/api", {}, controller.signal);
    } catch (e: any) {
      threw = e.name === "AbortError";
    }
    assert(threw, "AbortSignal aborts fetchWithBackoff with AbortError");
  });

  return { passed, failed };
}
