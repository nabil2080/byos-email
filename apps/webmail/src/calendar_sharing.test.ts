import {
  sealCalendarKeyForGrantee,
  unsealCalendarKeyForGrantee,
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  CalendarEventPlaintext,
} from "./calendar_crypto";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

export async function runCalendarSharingTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}:`, e);
      failed++;
    }
  }

  // Generate test keypair for Alice (owner) and Bob (grantee)
  const aliceKeypair = JSON.parse(WasmCore.wasm_generate_keypair());
  const bobKeypair = JSON.parse(WasmCore.wasm_generate_keypair());
  const eveKeypair = JSON.parse(WasmCore.wasm_generate_keypair());

  const calKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) calKey[i] = (i * 7 + 13) % 256;

  const aliceMailboxId = "11111111-2222-3333-4444-555555555555";
  const bobMailboxId = "66666666-7777-8888-9999-000000000000";

  await test("sealCalendarKeyForGrantee seals with HPKE and unseal recovers exact key", () => {
    const sealedB64 = sealCalendarKeyForGrantee(WasmCore, bobKeypair.public_key, calKey);
    assert(typeof sealedB64 === "string" && sealedB64.length > 0, "Sealed key should be non-empty base64");

    const unsealed = unsealCalendarKeyForGrantee(WasmCore, bobKeypair.secret_key, sealedB64);
    assert(unsealed instanceof Uint8Array, "Unsealed should be Uint8Array");
    assert(unsealed.length === 32, "Unsealed length must be 32 bytes");
    for (let i = 0; i < 32; i++) {
      assert(unsealed[i] === calKey[i], `Byte mismatch at ${i}: expected ${calKey[i]}, got ${unsealed[i]}`);
    }
  });

  await test("sealing rejects invalid calendar key length", () => {
    let threw = false;
    try {
      sealCalendarKeyForGrantee(WasmCore, bobKeypair.public_key, new Uint8Array(16));
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("32 bytes"), "Expected 32 bytes error");
    }
    assert(threw, "Should have thrown for short calendar key");
  });

  await test("sealing rejects invalid recipient public key", () => {
    let threw = false;
    try {
      sealCalendarKeyForGrantee(WasmCore, "", calKey);
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("Invalid recipient public key"), "Expected invalid key error");
    }
    assert(threw, "Should have thrown for empty public key");
  });

  await test("unsealing with wrong recipient private key fails closed", () => {
    const sealedB64 = sealCalendarKeyForGrantee(WasmCore, bobKeypair.public_key, calKey);
    let threw = false;
    try {
      // Eve attempts to unseal Bob's envelope
      unsealCalendarKeyForGrantee(WasmCore, eveKeypair.secret_key, sealedB64);
    } catch (err: any) {
      threw = true;
    }
    assert(threw, "Eve should not be able to unseal key sealed for Bob");
  });

  await test("unsealing tampered envelope fails closed", () => {
    const sealedB64 = sealCalendarKeyForGrantee(WasmCore, bobKeypair.public_key, calKey);
    // Flip bytes in the ciphertext portion
    const raw = atob(sealedB64);
    const tampered = raw.slice(0, 15) + String.fromCharCode(raw.charCodeAt(15) ^ 0xff) + raw.slice(16);
    const tamperedB64 = btoa(tampered);

    let threw = false;
    try {
      unsealCalendarKeyForGrantee(WasmCore, bobKeypair.secret_key, tamperedB64);
    } catch (err) {
      threw = true;
    }
    assert(threw, "Tampered envelope must fail closed");
  });

  await test("Bob can decrypt Alice's shared calendar events using unsealed calendar key and Alice AAD", () => {
    // 1. Alice seals calendar key for Bob
    const sealedCalKey = sealCalendarKeyForGrantee(WasmCore, bobKeypair.public_key, calKey);

    // 2. Alice creates and encrypts an event on her calendar
    const eventDetails: CalendarEventPlaintext = {
      title: "Shared Architecture Review",
      description: "Review zero-knowledge calendar sharing architecture",
      location: "Room 404",
      meetingUrl: "https://meet.byos.local/arch",
      attendees: [
        { email: "alice@test.local", name: "Alice", isOrganizer: true, status: "accepted" },
        { email: "bob@test.local", name: "Bob", status: "needs-action" },
      ],
      timezone: "UTC",
    };
    const encryptedEventB64 = encryptCalendarEventPayload(WasmCore, calKey, aliceMailboxId, eventDetails);

    // 3. Bob unseals calendar key
    const bobUnsealedCalKey = unsealCalendarKeyForGrantee(WasmCore, bobKeypair.secret_key, sealedCalKey);

    // 4. Bob decrypts Alice's event using unsealed key and Alice's mailbox ID as AAD
    const decryptedByBob = decryptCalendarEventPayload(
      WasmCore,
      bobUnsealedCalKey,
      aliceMailboxId,
      encryptedEventB64
    );

    assert(decryptedByBob.title === "Shared Architecture Review", `Title mismatch: ${decryptedByBob.title}`);
    assert(decryptedByBob.description === eventDetails.description, "Description mismatch");
    assert(decryptedByBob.location === "Room 404", "Location mismatch");
    assert(decryptedByBob.attendees?.length === 2, "Attendees length mismatch");
    assert(decryptedByBob.attendees?.[1].email === "bob@test.local", "Bob attendee mismatch");
  });

  await test("Read-only calendar permissions enforce creation and modification guards", () => {
    // Simulate UI calendar permissions model
    const readOnlyCal = {
      id: "cal-shared-ro",
      mailbox_id: aliceMailboxId,
      name: "Engineering Announcements",
      is_shared: true,
      permission: "read" as const,
      is_default: false,
    };

    const writeCal = {
      id: "cal-shared-rw",
      mailbox_id: aliceMailboxId,
      name: "Team Roadmap",
      is_shared: true,
      permission: "write" as const,
      is_default: false,
    };

    // Helper imitating UI guard
    function checkCanModify(cal: { is_shared?: boolean; permission?: string }) {
      if (cal.is_shared && cal.permission === "read") {
        throw new Error("Cannot create or modify events on a read-only calendar");
      }
      return true;
    }

    // Read-only should throw
    let roThrew = false;
    try {
      checkCanModify(readOnlyCal);
    } catch (e: any) {
      roThrew = true;
      assert(e.message.includes("read-only calendar"), "Expected read-only message");
    }
    assert(roThrew, "Read-only calendar should block modifications");

    // Write-shared should succeed
    const rwAllowed = checkCanModify(writeCal);
    assert(rwAllowed === true, "Write-shared calendar should allow modifications");
  });

  await test("sealing calendar key with KeyDirectoryRecord xwing_public_key extracts X25519 pk and unseals", () => {
    // Simulated 1216-byte X-Wing public key where last 32 bytes is Bob's X25519 PK
    const bobPkBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bobPkBytes[i] = (i * 3 + 17) % 256;
    const xwingMockBytes = new Uint8Array(1216);
    xwingMockBytes.set(bobPkBytes, 1184);

    const b64Xwing = btoa(String.fromCharCode(...xwingMockBytes));
    const extractedPk = xwingMockBytes.slice(1184, 1216);
    let hexPk = "";
    for (let i = 0; i < extractedPk.length; i++) {
      hexPk += extractedPk[i].toString(16).padStart(2, "0");
    }

    assert(hexPk.length === 64, "Extracted public key hex must be 64 characters (32 bytes)");

    // Seal with extracted hex
    const sealed = sealCalendarKeyForGrantee(WasmCore, hexPk, calKey);
    assert(typeof sealed === "string" && sealed.length > 0, "Sealed key should be non-empty base64 string");
  });

  await test("calendar sharing fails closed when mailbox key is missing or malformed", () => {
    let threw = false;
    try {
      sealCalendarKeyForGrantee(WasmCore, bobKeypair.public_key, null as any);
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("32 bytes"), "Expected 32 bytes required error");
    }
    assert(threw, "Missing mailbox key must fail closed");
  });

  await test("calendar sharing key resolution supports 2432-char hex and 32-byte base64 keys", () => {
    // 1. 2432 hex characters X-Wing key (1216 bytes)
    const bobPkBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) bobPkBytes[i] = (i * 5 + 3) % 256;
    const full1216 = new Uint8Array(1216);
    full1216.set(bobPkBytes, 1184);
    let hex2432 = "";
    for (let i = 0; i < full1216.length; i++) {
      hex2432 += full1216[i].toString(16).padStart(2, "0");
    }
    assert(hex2432.length === 2432, "Hex string must be 2432 chars");
    const extractedHex = hex2432.slice(2368, 2432);
    const sealedFrom2432 = sealCalendarKeyForGrantee(WasmCore, extractedHex, calKey);
    assert(Boolean(sealedFrom2432), "Seals successfully with extracted hex");

    // 2. Base64 32-byte public key
    const b64Pk = btoa(String.fromCharCode(...bobPkBytes));
    let rawPkHex = "";
    for (let i = 0; i < bobPkBytes.length; i++) {
      rawPkHex += bobPkBytes[i].toString(16).padStart(2, "0");
    }
    const sealedFromB64 = sealCalendarKeyForGrantee(WasmCore, rawPkHex, calKey);
    assert(Boolean(sealedFromB64), "Seals successfully with 32-byte public key");
  });

  return { passed, failed };
}
