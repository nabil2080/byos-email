import {
  validateMailboxKeyProvenance,
  findLegacyCalendarEvents,
  executeLegacyCalendarEventRecovery,
} from "./calendar_recovery";
import {
  encryptCalendarEventPayload,
  classifyCalendarPayload,
  CalendarEventPlaintext,
} from "./calendar_crypto";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";
import { CalendarEventItem } from "./api";

function assert(condition: unknown, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

export async function runCalendarRecoveryTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Calendar Recovery Tests...");

  const mailboxId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
  const otherMailboxId = "b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e";

  // Generate valid X25519 keypair A
  const kpAStr = WasmCore.wasm_generate_keypair();
  const kpA = JSON.parse(kpAStr) as { secret_key: string; public_key: string };
  const skA = hexToBytes(kpA.secret_key);
  const pkA = kpA.public_key;

  // Generate valid X25519 keypair B
  const kpBStr = WasmCore.wasm_generate_keypair();
  const kpB = JSON.parse(kpBStr) as { secret_key: string; public_key: string };
  const skB = hexToBytes(kpB.secret_key);
  const pkB = kpB.public_key;

  // 1. Mailbox Key Provenance
  await test("validateMailboxKeyProvenance: authentic key and matching pk succeeds", async () => {
    const res = await validateMailboxKeyProvenance(WasmCore, skA, mailboxId, pkA, mailboxId);
    assert(res.valid === true, "Should be valid for matching keypair and mailbox");
    assert(!res.error, "Should have no error");
  });

  await test("validateMailboxKeyProvenance: mailbox id mismatch rejects provenance", async () => {
    const res = await validateMailboxKeyProvenance(WasmCore, skA, mailboxId, pkA, otherMailboxId);
    assert(res.valid === false, "Must reject mismatched mailbox");
    assert(res.error?.includes("custody mismatch"), "Must describe custody mismatch");
  });

  await test("validateMailboxKeyProvenance: wrong public key fails mathematical pairing", async () => {
    const res = await validateMailboxKeyProvenance(WasmCore, skA, mailboxId, pkB, mailboxId);
    assert(res.valid === false, "Must reject mismatched public key");
    assert(res.error?.includes("not paired"), "Must describe pairing failure");
  });

  await test("validateMailboxKeyProvenance: invalid key length fails closed", async () => {
    const shortKey = new Uint8Array(16);
    const res = await validateMailboxKeyProvenance(WasmCore, shortKey, mailboxId, pkA, mailboxId);
    assert(res.valid === false, "Must reject 16-byte key");
    assert(res.error?.includes("must be 32 bytes"), "Must enforce 32-byte key");
  });

  await test("validateMailboxKeyProvenance: missing key or pk fails closed", async () => {
    const res1 = await validateMailboxKeyProvenance(WasmCore, null, mailboxId, pkA, mailboxId);
    assert(res1.valid === false, "Must reject null key");

    const res2 = await validateMailboxKeyProvenance(WasmCore, skA, mailboxId, null, mailboxId);
    assert(res2.valid === false, "Must reject null pk");
  });

  // 2. Identification of Legacy Events
  await test("findLegacyCalendarEvents: separates legacy plaintext JSON from encrypted envelopes", async () => {
    const legacyItem: CalendarEventItem = {
      id: "evt-legacy-1",
      mailbox_id: mailboxId,
      calendar_id: "cal-1",
      start_time: "2026-10-24T10:00:00Z",
      end_time: "2026-10-24T11:00:00Z",
      is_all_day: false,
      status: "confirmed",
      encrypted_payload: btoa(JSON.stringify({
        title: "Legacy Planning Session",
        description: "Unencrypted legacy record",
        location: "Room 101",
        attendees: [],
        reminders: [],
      })),
      created_at: "2026-10-24T00:00:00Z",
      updated_at: "2026-10-24T00:00:00Z",
    };

    const encryptedItem: CalendarEventItem = {
      id: "evt-enc-2",
      mailbox_id: mailboxId,
      calendar_id: "cal-1",
      start_time: "2026-10-24T12:00:00Z",
      end_time: "2026-10-24T13:00:00Z",
      is_all_day: false,
      status: "confirmed",
      encrypted_payload: encryptCalendarEventPayload(WasmCore, skA, mailboxId, {
        title: "Modern Encrypted Meeting",
        description: "AES-GCM encrypted",
        location: "Virtual",
        attendees: [],
        reminders: [],
      }),
      created_at: "2026-10-24T00:00:00Z",
      updated_at: "2026-10-24T00:00:00Z",
    };

    const legacyList = findLegacyCalendarEvents([legacyItem, encryptedItem]);
    assert(legacyList.length === 1, `Expected 1 legacy event, found ${legacyList.length}`);
    assert(legacyList[0].id === "evt-legacy-1", "Identified item must be the legacy event");
  });

  // 3. Execution Controller State Machine
  const originalFetch = globalThis.fetch;

  try {
    await test("executeLegacyCalendarEventRecovery: successful 4-phase recoverable workflow", async () => {
      const eventId = "evt-recover-1";
      const legacyPayloadB64 = btoa(JSON.stringify({
        title: "Quarterly Review",
        description: "Legacy plain event details",
        location: "Conf Room A",
        attendees: [{ name: "Alice", email: "alice@byos.local", role: "REQ-PARTICIPANT", partstat: "ACCEPTED" }],
        reminders: [{ trigger_minutes_before: 15 }],
      }));

      const eventItem: CalendarEventItem = {
        id: eventId,
        mailbox_id: mailboxId,
        calendar_id: "cal-1",
        start_time: "2026-10-24T14:00:00Z",
        end_time: "2026-10-24T15:00:00Z",
        is_all_day: false,
        status: "confirmed",
        encrypted_payload: legacyPayloadB64,
        created_at: "2026-10-24T00:00:00Z",
        updated_at: "2026-10-24T00:00:00Z",
      };

      let stageCalled: boolean = false;
      let finalizeCalled: boolean = false;
      let rollbackCalled: boolean = false;
      let stagedPayloadSent = "";

      let currentEventPayload = legacyPayloadB64;
      let currentETag = '"etag-sha-1111"';

      globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : input.url;
        const method = init?.method || "GET";
        const headers = init?.headers || {};

        if (url.includes(`/calendar-events/${eventId}`) && !url.includes("stage-migration") && !url.includes("finalize-migration") && !url.includes("rollback-migration")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ ETag: currentETag }),
            json: async () => ({
              ...eventItem,
              encrypted_payload: currentEventPayload,
            }),
          } as unknown as Response;
        }

        if (url.includes("stage-migration")) {
          stageCalled = true;
          assert(headers["If-Match"] === '"etag-sha-1111"', "Stage must pass If-Match");
          const body = JSON.parse(init.body);
          stagedPayloadSent = body.staged_encrypted_payload;
          currentEventPayload = stagedPayloadSent;
          currentETag = '"etag-sha-2222"';
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "staged",
              migration_id: "mig-test-1",
              expires_at: new Date(Date.now() + 60000).toISOString(),
            }),
          } as unknown as Response;
        }

        if (url.includes("finalize-migration")) {
          finalizeCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "finalized",
              finalized_at: new Date().toISOString(),
            }),
          } as unknown as Response;
        }

        if (url.includes("rollback-migration")) {
          rollbackCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "rolled_back",
              legacy_payload_restored: true,
            }),
          } as unknown as Response;
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }) as unknown as typeof fetch;

      const res = await executeLegacyCalendarEventRecovery(
        WasmCore,
        mailboxId,
        skA,
        pkA,
        mailboxId,
        eventItem
      );

      assert(res.success === true, `Expected recovery to succeed: ${res.error}`);
      assert((stageCalled as boolean) === true, "Stage migration must be called");
      assert((finalizeCalled as boolean) === true, "Finalize migration must be called on verified match");
      assert((rollbackCalled as boolean) === false, "Rollback must NOT be called on success");
      assert(classifyCalendarPayload(stagedPayloadSent) === "aes-gcm-envelope", "Staged payload must be AES-GCM envelope");
    });

    await test("executeLegacyCalendarEventRecovery: read-back verification mismatch triggers rollback", async () => {
      const eventId = "evt-recover-mismatch";
      const legacyPayloadB64 = btoa(JSON.stringify({
        title: "Security Sync",
        description: "Initial description",
        location: "Room B",
      }));

      const eventItem: CalendarEventItem = {
        id: eventId,
        mailbox_id: mailboxId,
        calendar_id: "cal-1",
        start_time: "2026-10-24T14:00:00Z",
        end_time: "2026-10-24T15:00:00Z",
        is_all_day: false,
        status: "confirmed",
        encrypted_payload: legacyPayloadB64,
        created_at: "2026-10-24T00:00:00Z",
        updated_at: "2026-10-24T00:00:00Z",
      };

      let rollbackCalled: boolean = false;
      let finalizeCalled: boolean = false;

      // Server will return a different payload on read-back
      const differentCiphertext = encryptCalendarEventPayload(WasmCore, skA, mailboxId, {
        title: "Tampered or Wrong Content",
        description: "Something else",
        location: "Unknown",
        attendees: [],
        reminders: [],
      });

      let getCount = 0;

      globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.includes(`/calendar-events/${eventId}`) && !url.includes("stage-migration") && !url.includes("finalize-migration") && !url.includes("rollback-migration")) {
          getCount++;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ ETag: getCount === 1 ? '"etag-mismatch-1"' : '"etag-mismatch-2"' }),
            json: async () => ({
              ...eventItem,
              encrypted_payload: getCount === 1 ? legacyPayloadB64 : differentCiphertext,
            }),
          } as unknown as Response;
        }

        if (url.includes("stage-migration")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: "staged", migration_id: "mig-test-mismatch", expires_at: new Date().toISOString() }),
          } as unknown as Response;
        }

        if (url.includes("rollback-migration")) {
          rollbackCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: "rolled_back", legacy_payload_restored: true }),
          } as unknown as Response;
        }

        if (url.includes("finalize-migration")) {
          finalizeCalled = true;
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }) as unknown as typeof fetch;

      const res = await executeLegacyCalendarEventRecovery(
        WasmCore,
        mailboxId,
        skA,
        pkA,
        mailboxId,
        eventItem
      );

      assert(res.success === false, "Recovery must fail on read-back mismatch");
      assert((rollbackCalled as boolean) === true, "Rollback must be called when read-back verification fails");
      assert((finalizeCalled as boolean) === false, "Finalize must never be called on mismatch");
      assert(res.error?.includes("verification mismatch"), "Error must state verification mismatch");
    });

    await test("executeLegacyCalendarEventRecovery: read-back decryption failure triggers rollback", async () => {
      const eventId = "evt-recover-decrypt-fail";
      const legacyPayloadB64 = btoa(JSON.stringify({
        title: "Product Demo",
        description: "Demo session",
        location: "Virtual",
      }));

      const eventItem: CalendarEventItem = {
        id: eventId,
        mailbox_id: mailboxId,
        calendar_id: "cal-1",
        start_time: "2026-10-24T14:00:00Z",
        end_time: "2026-10-24T15:00:00Z",
        is_all_day: false,
        status: "confirmed",
        encrypted_payload: legacyPayloadB64,
        created_at: "2026-10-24T00:00:00Z",
        updated_at: "2026-10-24T00:00:00Z",
      };

      let rollbackCalled: boolean = false;
      let getCount = 0;

      globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.includes(`/calendar-events/${eventId}`) && !url.includes("stage-migration") && !url.includes("finalize-migration") && !url.includes("rollback-migration")) {
          getCount++;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ ETag: '"etag-fail"' }),
            json: async () => ({
              ...eventItem,
              encrypted_payload: getCount === 1 ? legacyPayloadB64 : btoa("tampered_corrupt_payload_data_not_valid_envelope"),
            }),
          } as unknown as Response;
        }

        if (url.includes("stage-migration")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: "staged", migration_id: "mig-test-decrypt-fail", expires_at: new Date().toISOString() }),
          } as unknown as Response;
        }

        if (url.includes("rollback-migration")) {
          rollbackCalled = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({ status: "rolled_back", legacy_payload_restored: true }),
          } as unknown as Response;
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }) as unknown as typeof fetch;

      const res = await executeLegacyCalendarEventRecovery(
        WasmCore,
        mailboxId,
        skA,
        pkA,
        mailboxId,
        eventItem
      );

      assert(res.success === false, "Recovery must fail if read-back decryption fails");
      assert((rollbackCalled as boolean) === true, "Rollback must be called on decryption failure");
    });

    await test("executeLegacyCalendarEventRecovery: stage 412 Precondition Failed aborts cleanly without rollback", async () => {
      const eventId = "evt-recover-412";
      const legacyPayloadB64 = btoa(JSON.stringify({
        title: "Concurrent Edit Event",
        description: "Will conflict",
        location: "Virtual",
      }));

      const eventItem: CalendarEventItem = {
        id: eventId,
        mailbox_id: mailboxId,
        calendar_id: "cal-1",
        start_time: "2026-10-24T14:00:00Z",
        end_time: "2026-10-24T15:00:00Z",
        is_all_day: false,
        status: "confirmed",
        encrypted_payload: legacyPayloadB64,
        created_at: "2026-10-24T00:00:00Z",
        updated_at: "2026-10-24T00:00:00Z",
      };

      let rollbackCalled = false;

      globalThis.fetch = (async (input: any, init?: any) => {
        const url = typeof input === "string" ? input : input.url;

        if (url.includes(`/calendar-events/${eventId}`) && !url.includes("stage-migration")) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ ETag: '"stale-etag"' }),
            json: async () => ({
              ...eventItem,
            }),
          } as unknown as Response;
        }

        if (url.includes("stage-migration")) {
          return {
            ok: false,
            status: 412,
            text: async () => "Precondition Failed (412): ETag mismatch",
          } as unknown as Response;
        }

        if (url.includes("rollback-migration")) {
          rollbackCalled = true;
          return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
        }

        throw new Error(`Unexpected URL in test: ${url}`);
      }) as unknown as typeof fetch;

      const res = await executeLegacyCalendarEventRecovery(
        WasmCore,
        mailboxId,
        skA,
        pkA,
        mailboxId,
        eventItem
      );

      assert(res.success === false, "Recovery must fail on 412");
      assert(rollbackCalled === false, "Rollback must NOT be called if stage failed");
      assert(res.error?.includes("412") || res.error?.includes("Precondition Failed"), "Error must mention 412 or Precondition Failed");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  return { passed, failed };
}
