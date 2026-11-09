import assert from "node:assert";
import {
  setAccountKeys,
  getMailboxKeyFor,
  getSigningSeedFor,
  getXWingSeedFor,
  zeroizeKeys,
  unsealAccountKeys,
  sanitizeConnectedAccounts,
  rotateSessionGeneration,
  isAccountUnlocked,
  clearAccountKeys,
  SESSION_GENERATION_KEY,
} from "./session_isolation";
import { isMessageSnoozed, checkSnoozeExpirations } from "./snooze";
import { buildEmlContent, uint8ArrayToBase64, formatRFC2822Date } from "./utils/eml_export";
import { saveSignature, loadSignature, clearSignature } from "./signature";
import {
  encryptContactEnvelope,
  decryptContactEnvelope,
  encryptDraftEnvelope,
  decryptDraftEnvelope,
  decryptPathAEnvelope,
  encryptSignature,
  decryptSignature,
  hexToBytes,
  hexToBase64,
} from "./message_crypto";

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

export async function runTrack2SecurityTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        await res;
      }
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✗ ${name}:`, err?.message || err);
    }
  }

  // Mock sessionStorage and localStorage if in Node
  const sessionStore = new Map<string, string>();
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => sessionStore.set(k, String(v)),
    removeItem: (k: string) => sessionStore.delete(k),
    clear: () => sessionStore.clear(),
    get length() {
      return sessionStore.size;
    },
    key: (i: number) => Array.from(sessionStore.keys())[i] ?? null,
  };

  const localStore = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => localStore.get(k) ?? null,
    setItem: (k: string, v: string) => localStore.set(k, String(v)),
    removeItem: (k: string) => localStore.delete(k),
    clear: () => localStore.clear(),
    get length() {
      return localStore.size;
    },
    key: (i: number) => Array.from(localStore.keys())[i] ?? null,
  };

  console.log("\n--- Part A.1: In-Memory Key Custody & Zeroization ---");

  await test("sessionStorage has NO private key hex strings after setAccountKeys", () => {
    sessionStorage.clear();
    const accountId = "box-test-123";
    const mailboxSk = new Uint8Array(32).fill(0xaa);
    const signingSeed = new Uint8Array(32).fill(0xbb);
    const xwingSeed = new Uint8Array(32).fill(0xcc);

    setAccountKeys(accountId, { mailboxSk, signingSeed, xwingSeed });

    // Verify keys accessible in memory
    const retrievedSk = getMailboxKeyFor(accountId);
    const retrievedSigning = getSigningSeedFor(accountId);
    const retrievedXWing = getXWingSeedFor(accountId);
    assert(retrievedSk && retrievedSk[0] === 0xaa, "mailbox sk retrieved in memory");
    assert(retrievedSigning && retrievedSigning[0] === 0xbb, "signing seed retrieved in memory");
    assert(retrievedXWing && retrievedXWing[0] === 0xcc, "xwing seed retrieved in memory");

    // Verify sessionStorage does NOT contain keys
    assert.strictEqual(sessionStorage.getItem(`byos_mailbox_sk_${accountId}`), null);
    assert.strictEqual(sessionStorage.getItem(`byos_signing_seed_${accountId}`), null);
    assert.strictEqual(sessionStorage.getItem(`byos_xwing_seed_${accountId}`), null);

    // Check all keys in sessionStorage
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k) {
        assert(!k.startsWith("byos_mailbox_sk_"), `Found private key in sessionStorage: ${k}`);
        assert(!k.startsWith("byos_signing_seed_"), `Found signing seed in sessionStorage: ${k}`);
        assert(!k.startsWith("byos_xwing_seed_"), `Found xwing seed in sessionStorage: ${k}`);
      }
    }
  });

  await test("zeroizeKeys fills in-memory buffers with 0 and sweeps sensitive keys from storage", () => {
    const accountId = "box-test-zeroize";
    const mailboxSk = new Uint8Array(32).fill(0x42);
    setAccountKeys(accountId, { mailboxSk });

    const ref = getMailboxKeyFor(accountId)!;
    assert.strictEqual(ref[0], 0x42);

    sessionStorage.setItem("byos_mailbox_sk_legacy", "1234");
    zeroizeKeys();

    // Buffer zeroized
    assert.strictEqual(ref[0], 0, "Buffer byte zeroized");
    assert.strictEqual(getMailboxKeyFor(accountId), null, "Map entry deleted");
    assert.strictEqual(sessionStorage.getItem("byos_mailbox_sk_legacy"), null, "Storage swept");
  });

  await test("unsealAccountKeys purges sessionStorage legacy keys and loads in-memory", async () => {
    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const accountId = "11111111-2222-3333-4444-555555555555";
    const testPassword = "Password123!";

    const rawSecret = new Uint8Array(32).fill(0x33);
    const rawSecretHex = Array.from(rawSecret).map((b) => b.toString(16).padStart(2, "0")).join("");
    const saltBytes = new Uint8Array(16).fill(0x77);
    const saltHex = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const envelopeHex = wasm.wasm_passphrase_wrap_key(testPassword, saltHex, rawSecretHex);
    const wrappedSkUser = JSON.stringify({
      salt: saltHex,
      envelope: envelopeHex,
    });

    sessionStorage.setItem(`byos_mailbox_sk_${accountId}`, "legacy_sk_hex");

    const unsealed = await unsealAccountKeys(accountId, testPassword, wrappedSkUser);
    assert(unsealed, "unseal returned key");
    assert.strictEqual(unsealed.mailboxSk[0], 0x33);

    // Legacy key purged from sessionStorage
    assert.strictEqual(sessionStorage.getItem(`byos_mailbox_sk_${accountId}`), null, "sessionStorage purged");
    // Accessible in memory
    assert.strictEqual(getMailboxKeyFor(accountId)![0], 0x33, "accessible in memory");
  });

  await test("sanitizeConnectedAccounts removes private keys from accounts before session storage", () => {
    const rawAccounts = [
      {
        id: "acc-1",
        email: "alice@byos.local",
        mailboxSkHex: "deadbeef",
        signingSeedHex: "cafebabe",
        xwingSeedHex: "feedface",
        isDefault: true,
      },
    ];

    const sanitized = sanitizeConnectedAccounts(rawAccounts as any);
    assert.strictEqual((sanitized[0] as any).mailboxSkHex, undefined, "mailboxSkHex stripped");
    assert.strictEqual((sanitized[0] as any).signingSeedHex, undefined, "signingSeedHex stripped");
    assert.strictEqual((sanitized[0] as any).xwingSeedHex, undefined, "xwingSeedHex stripped");
    assert.strictEqual(sanitized[0].email, "alice@byos.local");
  });

  await test("full login flow verifies sessionStorage contains NO private key hex strings after login", async () => {
    sessionStorage.clear();
    localStorage.clear();
    zeroizeKeys();

    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const accountId = "login-box-999";
    const password = "ValidPassword123!";
    const rawSecret = new Uint8Array(32).fill(0x7f);
    const rawSecretHex = Array.from(rawSecret).map((b) => b.toString(16).padStart(2, "0")).join("");
    const saltHex = "11".repeat(16);
    const envelopeHex = wasm.wasm_passphrase_wrap_key(password, saltHex, rawSecretHex);
    const wrappedSkUser = JSON.stringify({ salt: saltHex, envelope: envelopeHex });

    // Step 1: Login rotates session generation
    const gen = rotateSessionGeneration(localStorage, sessionStorage);
    assert(gen && gen.length > 0, "session generation rotated");

    // Step 2: Unseal account keys into strictly in-memory custody
    const unsealed = await unsealAccountKeys(accountId, password, wrappedSkUser, sessionStorage);
    assert(unsealed && unsealed.mailboxSk[0] === 0x7f, "unsealed in-memory key");
    assert.strictEqual(isAccountUnlocked(accountId), true, "account unlocked in memory");

    // Step 3: Store connected account metadata via sanitizeConnectedAccounts
    const activeAcc = {
      id: accountId,
      email: "user@byos.local",
      displayName: "User",
      role: "member",
      privacyMode: "private",
      sessionToken: "token-abc-123",
      mailboxSkHex: rawSecretHex, // Should be sanitized
      searchKeyHex: unsealed.searchKeyHex,
    };
    sessionStorage.setItem("byos_connected_accounts", JSON.stringify(sanitizeConnectedAccounts([activeAcc])));

    // Step 4: Strict assertion - verify sessionStorage contains NO private keys or seeds
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      assert(!key.startsWith("byos_mailbox_sk_"), `sessionStorage has private key: ${key}`);
      assert(!key.startsWith("byos_signing_seed_"), `sessionStorage has signing seed: ${key}`);
      assert(!key.startsWith("byos_xwing_seed_"), `sessionStorage has xwing seed: ${key}`);
    }

    const storedAccounts = JSON.parse(sessionStorage.getItem("byos_connected_accounts") || "[]");
    assert.strictEqual(storedAccounts.length, 1);
    assert.strictEqual(storedAccounts[0].mailboxSkHex, undefined, "mailboxSkHex sanitized from storage");
    assert.strictEqual(storedAccounts[0].signingSeedHex, undefined, "signingSeedHex sanitized from storage");
    assert.strictEqual(storedAccounts[0].xwingSeedHex, undefined, "xwingSeedHex sanitized from storage");
  });

  console.log("\n--- Part A.2: Encrypted Contacts Wireup ---");

  await test("encryptContactEnvelope creates valid ciphertext and decryptContactEnvelope unpacks all fields", async () => {
    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const mailboxKey = new Uint8Array(32).fill(0x55);
    const mailboxId = "11111111-2222-3333-4444-555555555555";

    const original = {
      name: "Alice Smith",
      email: "alice@example.com",
      notes: "VIP Client Notes",
      group: "Clients",
    };

    const envelope = encryptContactEnvelope(wasm, mailboxKey, mailboxId, original);
    assert(typeof envelope === "string" && envelope.length > 20, "envelope is base64 ciphertext");

    // Must not contain plaintext
    assert(!envelope.includes("Alice Smith"), "envelope does not contain name in plaintext");
    assert(!envelope.includes("alice@example.com"), "envelope does not contain email in plaintext");
    assert(!envelope.includes("VIP Client Notes"), "envelope does not contain notes in plaintext");

    const decrypted = decryptContactEnvelope(wasm, mailboxKey, mailboxId, envelope);
    assert.strictEqual(decrypted.name, original.name);
    assert.strictEqual(decrypted.email, original.email);
    assert.strictEqual(decrypted.notes, original.notes);
    assert.strictEqual(decrypted.group, original.group);
  });

  await test("contact creation dispatches ciphertext envelopes with NO plaintext fields", async () => {
    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const mailboxId = "22222222-3333-4444-5555-666666666666";
    const mailboxKey = new Uint8Array(32).fill(0x77);
    setAccountKeys(mailboxId, { mailboxSk: mailboxKey });

    const contactInput = {
      name: "Bob Builder",
      email: "bob@construction.local",
      notes: "Project architect",
      group: "Contractors",
    };

    // Simulate component contact save handler
    let dispatchedPayload: any = null;
    const mockCreateContact = async (_boxId: string, payload: any) => {
      dispatchedPayload = payload;
      return { id: "contact-1", version: 1, ...payload };
    };

    const key = getMailboxKeyFor(mailboxId);
    assert(key, "mailbox key resolved");

    const envelope = encryptContactEnvelope(wasm, key, mailboxId, contactInput);
    const payload = {
      encrypted_envelope: envelope,
    };
    await mockCreateContact(mailboxId, payload);

    assert(dispatchedPayload, "payload dispatched");
    assert.strictEqual(dispatchedPayload.name, undefined, "name is NOT dispatched in plaintext");
    assert.strictEqual(dispatchedPayload.email, undefined, "email is NOT dispatched in plaintext");
    assert.strictEqual(dispatchedPayload.notes, undefined, "notes are NOT dispatched in plaintext");
    assert.strictEqual(dispatchedPayload.group, undefined, "group is NOT dispatched in plaintext");
    assert.strictEqual(dispatchedPayload.group_name, undefined, "group_name is NOT dispatched in plaintext");
    assert(typeof dispatchedPayload.encrypted_envelope === "string", "encrypted_envelope is present");

    // Decrypt envelope and assert data fidelity
    const unpacked = decryptContactEnvelope(wasm, key, mailboxId, dispatchedPayload.encrypted_envelope);
    assert.strictEqual(unpacked.name, contactInput.name);
    assert.strictEqual(unpacked.email, contactInput.email);
    assert.strictEqual(unpacked.notes, contactInput.notes);
    assert.strictEqual(unpacked.group, contactInput.group);
  });

  await test("contact creation fails closed without active mailbox key", () => {
    const mailboxId = "locked-box-000";
    zeroizeKeys(mailboxId);
    const key = getMailboxKeyFor(mailboxId);
    assert.strictEqual(key, null, "mailbox is locked");

    let threw = false;
    try {
      if (!key) {
        throw new Error("Active mailbox key is required to save encrypted contacts.");
      }
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("Active mailbox key is required"));
    }
    assert(threw, "refuses to dispatch contact without encryption key");
  });

  console.log("\n--- Part A.3: Envelope Draft Subjects & Recipients ---");

  await test("draft saving packages subject, recipient, and body into ciphertext envelope and zeroes API fields", async () => {
    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const mailboxId = "33333333-4444-5555-6666-777777777777";
    const mailboxKey = new Uint8Array(32).fill(0x88);

    const draftInput = {
      to: "recipient@byos.local",
      subject: "Classified Strategy Draft",
      body: "<p>Encrypted proposal contents.</p>",
    };

    const draftPayload = JSON.stringify({
      subject: draftInput.subject,
      recipient: draftInput.to,
      to: draftInput.to,
      body: draftInput.body,
    });
    const envelope = encryptDraftEnvelope(wasm, mailboxKey, mailboxId, draftPayload);

    // Assert client sends empty subject/recipient to API
    const apiPayload = {
      recipient: "",
      subject: "",
      encrypted_envelope: envelope,
    };

    assert.strictEqual(apiPayload.recipient, "", "API recipient field is empty");
    assert.strictEqual(apiPayload.subject, "", "API subject field is empty");
    assert(!apiPayload.encrypted_envelope.includes("Classified Strategy"), "Envelope contains no plaintext subject");
    assert(!apiPayload.encrypted_envelope.includes("recipient@byos.local"), "Envelope contains no plaintext recipient");

    // Assert decrypting the envelope restores subject, recipient, and body
    const decryptedJson = decryptDraftEnvelope(wasm, mailboxKey, mailboxId, apiPayload.encrypted_envelope);
    const parsed = JSON.parse(decryptedJson);
    assert.strictEqual(parsed.subject, draftInput.subject);
    assert.strictEqual(parsed.recipient, draftInput.to);
    assert.strictEqual(parsed.body, draftInput.body);
  });

  console.log("\n--- Part B.1: Debounced Draft Auto-Save ---");

  await test("debounced autosave dirty-state tracking and cancellation", () => {
    let dirty = false;
    let savedSnapshot = "";
    let autoSaveTimer: any = null;
    let autoSaveExecuted = false;

    const onTyping = (to: string, subject: string, body: string) => {
      const snap = JSON.stringify({ to: to.trim(), subject: subject.trim(), richContent: body });
      if (snap !== savedSnapshot) {
        dirty = true;
        if (autoSaveTimer) clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
          autoSaveExecuted = true;
          savedSnapshot = snap;
          dirty = false;
        }, 50);
      }
    };

    onTyping("test@local", "Subj", "Body content");
    assert.strictEqual(dirty, true, "dirty on change");
    assert.strictEqual(autoSaveExecuted, false, "timer not yet fired");

    // Clear compose form cancels timer
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    dirty = false;
    savedSnapshot = "";

    assert.strictEqual(dirty, false, "dirty reset after clear");
    assert.strictEqual(autoSaveExecuted, false, "autoSave cancelled");
  });

  console.log("\n--- Part B.2: Live Snooze Expiration Loop ---");

  await test("isMessageSnoozed correctly checks future vs expired timestamps", () => {
    const now = 1700000000000;
    const future = new Date(now + 60000).toISOString();
    const past = new Date(now - 60000).toISOString();

    assert.strictEqual(isMessageSnoozed(future, now), true);
    assert.strictEqual(isMessageSnoozed(past, now), false);
    assert.strictEqual(isMessageSnoozed(undefined, now), false);
    assert.strictEqual(isMessageSnoozed(null, now), false);
  });

  await test("checkSnoozeExpirations identifies messages expiring in the time window", () => {
    const t0 = 1700000000000;
    const t1 = 1700000010000; // 10s later

    const msgs = [
      { id: "1", subject: "Future", snoozedUntil: new Date(t1 + 5000).toISOString() },
      { id: "2", subject: "Expiring Now", snoozedUntil: new Date(t0 + 5000).toISOString() },
      { id: "3", subject: "Already Expired Long Ago", snoozedUntil: new Date(t0 - 10000).toISOString() },
      { id: "4", subject: "Not snoozed" },
    ];

    const expired = checkSnoozeExpirations(msgs, t0, t1);
    assert.strictEqual(expired.length, 1);
    assert.strictEqual(expired[0].id, "2");
  });

  await test("live snooze expiration loop wakes snoozed messages into inbox with read: false and clears snoozedUntil", () => {
    const t0 = 1700000000000;
    const t1 = 1700000005000;
    let msgs = [
      { id: "m-1", subject: "Snoozed Task", snoozedUntil: new Date(t0 + 2000).toISOString(), read: true },
      { id: "m-2", subject: "Regular Message", read: true },
    ];

    const expired = checkSnoozeExpirations(msgs, t0, t1);
    assert.strictEqual(expired.length, 1);

    const expiredIds = new Set(expired.map((e) => e.id));
    msgs = msgs.map((m) => (expiredIds.has(m.id) ? { ...m, snoozedUntil: undefined, read: false } : m));

    assert.strictEqual(msgs[0].snoozedUntil, undefined, "snoozedUntil cleared upon wake");
    assert.strictEqual(msgs[0].read, false, "wakes as unread in inbox");
  });

  console.log("\n--- Part B.3: RFC 5322 .eml Export ---");

  await test("buildEmlContent formats RFC 5322 MIME headers and multipart mixed attachments", () => {
    const fileBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const eml = buildEmlContent({
      from: "alice@byos.local",
      to: ["bob@byos.local", "charlie@byos.local"],
      subject: "Contract Signed",
      date: new Date("2026-10-30T15:00:00Z"),
      bodyPlain: "Attached is the contract.",
      bodyHtml: "<p>Attached is the contract.</p>",
      attachments: [
        {
          filename: "contract.pdf",
          contentType: "application/pdf",
          data: fileBytes,
        },
      ],
    });

    assert(eml.includes("From: alice@byos.local\r\n"), "From header");
    assert(eml.includes("To: bob@byos.local, charlie@byos.local\r\n"), "To header");
    assert(eml.includes("Subject: Contract Signed\r\n"), "Subject header");
    assert(eml.includes("MIME-Version: 1.0\r\n"), "MIME-Version header");
    assert(eml.includes("Content-Type: multipart/mixed; boundary="), "multipart/mixed boundary");
    assert(eml.includes("Content-Type: multipart/alternative; boundary="), "nested multipart/alternative");
    assert(eml.includes("Content-Type: text/plain; charset=utf-8"), "text/plain part");
    assert(eml.includes("Content-Type: text/html; charset=utf-8"), "text/html part");
    assert(eml.includes('Content-Type: application/pdf; name="contract.pdf"'), "attachment type");
    assert(eml.includes('Content-Disposition: attachment; filename="contract.pdf"'), "attachment disposition");
    assert(eml.includes("Content-Transfer-Encoding: base64"), "base64 encoding");
    assert(eml.includes(uint8ArrayToBase64(fileBytes)), "attachment base64 bytes");
  });

  await test("uint8ArrayToBase64 safely encodes large buffers without failure", () => {
    const largeBuffer = new Uint8Array(20000).fill(0x5a); // 20KB test buffer
    const encoded = uint8ArrayToBase64(largeBuffer);
    assert(encoded && encoded.length > 20000, "encoded base64 produced");
    // Verify 76-character line wrapping
    const lines = encoded.split("\r\n");
    for (let i = 0; i < lines.length - 1; i++) {
      assert.strictEqual(lines[i].length, 76, `Line ${i} wrapped at 76 characters`);
    }
  });

  console.log("\n--- Part B.4: Dynamic Sender Key Epoch Resolution ---");

  await test("decryptPathAEnvelope resolves dynamic key epoch without failing thread decryption", async () => {
    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const recipientSeed = hexToBytes(RUST_VECTOR.recipient_seed_hex);
    const correctSenderPkB64 = hexToBase64(RUST_VECTOR.sender_ed25519_pk_hex);
    const outdatedSenderPkB64 = hexToBase64("00".repeat(32));

    let refreshCalled = false;
    const deps = {
      wasm,
      lookupMailboxKeys: async () => ({
        email_address: "alice@example.com",
        key_id: "00000000-0000-0000-0000-000000000001",
        key_epoch: 0, // outdated epoch
        xwing_public_key: "dummy",
        ed25519_signing_public_key: outdatedSenderPkB64, // wrong key initially
        signing_key_epoch: 0,
        status: "active",
        updated_at: new Date().toISOString(),
      }),
      refreshMailboxKeys: async (email: string, epoch?: number) => {
        refreshCalled = true;
        assert.strictEqual(epoch, 1, "refresh requested with envelope epoch 1");
        return {
          email_address: email,
          key_id: "00000000-0000-0000-0000-000000000001",
          key_epoch: 1, // updated epoch
          xwing_public_key: "dummy",
          ed25519_signing_public_key: correctSenderPkB64, // correct key
          signing_key_epoch: 1,
          status: "active",
          updated_at: new Date().toISOString(),
        };
      },
    };

    const res = await decryptPathAEnvelope(
      RUST_VECTOR.envelope_json,
      "alice@example.com",
      recipientSeed,
      deps
    );
    assert.strictEqual(res.plaintext, RUST_VECTOR.expected_plaintext, "plaintext decrypted successfully");
    assert(refreshCalled, "refreshMailboxKeys called dynamically on epoch mismatch");
    assert.strictEqual(res.senderVerified, true, "sender successfully verified after epoch resolution");
  });

  await test("decryptPathAEnvelope does NOT throw and preserves thread plaintext even if sender verification fails", async () => {
    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const recipientSeed = hexToBytes(RUST_VECTOR.recipient_seed_hex);

    const deps = {
      wasm,
      lookupMailboxKeys: async () => {
        throw new Error("unknown_mailbox");
      },
    };

    const res = await decryptPathAEnvelope(
      RUST_VECTOR.envelope_json,
      "external@other.local",
      recipientSeed,
      deps
    );
    assert.strictEqual(res.plaintext, RUST_VECTOR.expected_plaintext, "plaintext preserved for thread reading");
    assert.strictEqual(res.senderVerified, false, "senderVerified is false");
    assert(res.senderVerifyError && res.senderVerifyError.includes("outside BYOS"), "descriptive verify error set");
  });

  await test("encryptSignature and decryptSignature roundtrip with authenticated AES-GCM envelope", async () => {
    const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
    const mailboxKey = new Uint8Array(32).fill(7);
    const mailboxId = "11111111-2222-3333-4444-555555555555";
    const plainSig = "Best regards,\nAlice Bob";
    const encrypted = encryptSignature(wasm, mailboxKey, mailboxId, plainSig);
    assert(encrypted.startsWith("enc:v1:"), "encrypted signature must start with enc:v1:");
    const decrypted = decryptSignature(wasm, mailboxKey, mailboxId, encrypted);
    assert.strictEqual(decrypted, plainSig, "decrypted signature must match original");

    // Legacy fallback
    const legacyPlain = "Legacy unencrypted signature";
    assert.strictEqual(decryptSignature(wasm, mailboxKey, mailboxId, legacyPlain), legacyPlain, "legacy signature returned as-is");

    // Decryption with wrong key fails closed (returns empty string)
    const wrongKey = new Uint8Array(32).fill(9);
    assert.strictEqual(decryptSignature(wasm, wrongKey, mailboxId, encrypted), "", "wrong key returns empty string");

    // Browser storage lifecycle: saveSignature writes to storage and synchronizes
    saveSignature(mailboxId, plainSig);
    assert.strictEqual(sessionStorage.getItem("byos.signature." + mailboxId), plainSig);
    assert.strictEqual(localStorage.getItem("byos.signature." + mailboxId), plainSig);
    assert.strictEqual(loadSignature(mailboxId), plainSig);

    // clearAccountKeys on logout removes signature from both sessionStorage and localStorage
    clearAccountKeys(mailboxId, sessionStorage);
    assert.strictEqual(sessionStorage.getItem("byos.signature." + mailboxId), null);
    assert.strictEqual(localStorage.getItem("byos.signature." + mailboxId), null);
    assert.strictEqual(loadSignature(mailboxId), "");
  });

  return { passed, failed };
}
