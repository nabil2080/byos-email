import {
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  classifyCalendarPayload,
  type CalendarEventPlaintext,
} from "./calendar_crypto";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

export async function runCalendarCryptoTests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        res
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((e) => {
            console.error(`  ✗ ${name}:`, e);
            failed++;
          });
      } else {
        console.log(`  ✓ ${name}`);
        passed++;
      }
    } catch (e) {
      console.error(`  ✗ ${name}:`, e);
      failed++;
    }
  }

  const dummyKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) dummyKey[i] = i + 1;
  const mailboxId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

  const sampleEvent: CalendarEventPlaintext = {
    title: "Q4 Strategy Meeting",
    description: "Confidential roadmap discussion with stakeholders.",
    location: "Conference Room B / Video Call",
    meetingUrl: "https://meet.byos.local/room/q4-strategy",
    attendees: [
      { name: "Alice Smith", email: "alice@byos.local", status: "accepted", isOrganizer: true },
      { name: "Bob Jones", email: "bob@byos.local", status: "needs-action" },
    ],
    reminders: [{ minutesBefore: 15 }, { minutesBefore: 60 }],
    timezone: "America/New_York",
  };

  test("encrypt and decrypt roundtrip preserves all event metadata", () => {
    const ciphertextB64 = encryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, sampleEvent);
    assert(typeof ciphertextB64 === "string" && ciphertextB64.length > 0, "ciphertext should be non-empty base64");

    const decrypted = decryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, ciphertextB64);
    assert(decrypted.title === sampleEvent.title, `title mismatch: ${decrypted.title}`);
    assert(decrypted.description === sampleEvent.description, "description mismatch");
    assert(decrypted.location === sampleEvent.location, "location mismatch");
    assert(decrypted.meetingUrl === sampleEvent.meetingUrl, "meetingUrl mismatch");
    assert(decrypted.attendees?.length === 2, "attendees length mismatch");
    assert(decrypted.attendees?.[0].email === "alice@byos.local", "organizer email mismatch");
    assert(decrypted.reminders?.length === 2, "reminders count mismatch");
    assert(decrypted.timezone === "America/New_York", "timezone mismatch");
  });

  test("tampered ciphertext fails decryption gracefully with safe placeholder", () => {
    const ciphertextB64 = encryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, sampleEvent);
    // Tamper with middle byte
    const raw = atob(ciphertextB64);
    const tampered = raw.slice(0, 10) + String.fromCharCode(raw.charCodeAt(10) ^ 0xff) + raw.slice(11);
    const tamperedB64 = btoa(tampered);

    const decrypted = decryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, tamperedB64);
    assert(
      decrypted.title === "(Encrypted Event - Unable to Decrypt)",
      `expected safe placeholder, got: ${decrypted.title}`
    );
    assert(decrypted.description === "", "description should be empty on tampering");
  });

  test("wrong mailbox key fails decryption safely", () => {
    const ciphertextB64 = encryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, sampleEvent);
    const wrongKey = new Uint8Array(32);
    wrongKey.fill(0x99);

    const decrypted = decryptCalendarEventPayload(WasmCore, wrongKey, mailboxId, ciphertextB64);
    assert(
      decrypted.title === "(Encrypted Event - Unable to Decrypt)",
      `expected safe placeholder, got: ${decrypted.title}`
    );
  });

  test("encryptCalendarEventPayload throws on missing or null key (fails closed)", () => {
    let threw = false;
    try {
      (encryptCalendarEventPayload as any)(WasmCore, null, mailboxId, sampleEvent);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("Invalid or missing mailbox encryption key"), "should throw key error");
    }
    assert(threw, "encryptCalendarEventPayload must throw on null key");
  });

  test("encryptCalendarEventPayload throws on invalid key length (fails closed)", () => {
    let threw = false;
    try {
      encryptCalendarEventPayload(WasmCore, new Uint8Array(16), mailboxId, sampleEvent);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("Invalid or missing mailbox encryption key"), "should throw length error");
    }
    assert(threw, "encryptCalendarEventPayload must throw on 16-byte key");
  });

  test("encryptCalendarEventPayload throws on missing mailboxId (fails closed)", () => {
    let threw = false;
    try {
      encryptCalendarEventPayload(WasmCore, dummyKey, "", sampleEvent);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("Missing or invalid mailbox ID"), "should throw mailboxId error");
    }
    assert(threw, "encryptCalendarEventPayload must throw on empty mailboxId");
  });

  test("encryptCalendarEventPayload throws on WASM failure (never falls back to plaintext)", () => {
    let threw = false;
    const brokenWasm = {
      ...WasmCore,
      wasm_aes_gcm_encrypt: () => {
        throw new Error("WASM internal memory failure");
      },
    };
    try {
      encryptCalendarEventPayload(brokenWasm as any, dummyKey, mailboxId, sampleEvent);
    } catch (e: any) {
      threw = true;
      assert(e.message.includes("WASM internal memory failure"), "should propagate WASM error");
    }
    assert(threw, "encryptCalendarEventPayload must throw and never fall back");
  });

  test("decryptCalendarEventPayload refuses to interpret legacy Base64 JSON as decrypted", () => {
    const legacyPlaintextJson = JSON.stringify(sampleEvent);
    const legacyB64 = Buffer.from(legacyPlaintextJson).toString("base64");

    const decrypted = decryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, legacyB64);
    assert(
      decrypted.title === "(Encrypted Event - Unable to Decrypt)",
      `expected safe placeholder for legacy Base64 JSON, got: ${decrypted.title}`
    );
  });

  test("decryptCalendarEventPayload fails closed on cross-mailbox AAD mismatch", () => {
    const ciphertextB64 = encryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, sampleEvent);
    const differentBoxId = "b9999999-9999-9999-9999-999999999999";

    const decrypted = decryptCalendarEventPayload(WasmCore, dummyKey, differentBoxId, ciphertextB64);
    assert(
      decrypted.title === "(Encrypted Event - Unable to Decrypt)",
      `expected safe placeholder on AAD mismatch, got: ${decrypted.title}`
    );
  });

  test("classifyCalendarPayload accurately identifies envelope vs legacy JSON vs unknown", () => {
    const ciphertextB64 = encryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, sampleEvent);
    assert(classifyCalendarPayload(ciphertextB64) === "aes-gcm-envelope", "should classify valid envelope as aes-gcm-envelope");

    const legacyB64 = Buffer.from(JSON.stringify(sampleEvent)).toString("base64");
    assert(classifyCalendarPayload(legacyB64) === "legacy-plaintext-json", "should classify legacy Base64 JSON as legacy-plaintext-json");

    const rawJsonBytes = new TextEncoder().encode(JSON.stringify(sampleEvent));
    assert(classifyCalendarPayload(rawJsonBytes) === "legacy-plaintext-json", "should classify raw JSON bytes as legacy-plaintext-json");

    assert(classifyCalendarPayload("") === "unknown", "empty should be unknown");
    assert(classifyCalendarPayload(new Uint8Array(5)) === "unknown", "short non-JSON should be unknown");
  });

  return { passed, failed };
}
