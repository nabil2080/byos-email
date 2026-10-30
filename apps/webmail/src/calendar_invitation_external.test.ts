import { sendMimeWithFallback, SendMimeFallbackDeps } from "./App.js";
import { generateIcs, generateRsvpReplyIcs, verifyInvitationAuthenticity, ParsedIcsEvent, parseIcs } from "./utils/calendarIcs.js";
import { encryptCalendarEventPayload, decryptCalendarEventPayload, CalendarEventPlaintext } from "./calendar_crypto.js";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";
import { KeyDirectoryRecord, InternalSendRequest, InternalSendResponse, PrepareResponse, SendPayload } from "./api.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

export async function runCalendarInvitationExternalTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ✗ ${name}:`, e.message || e);
      failed++;
    }
  }

  console.log("Running Calendar External Invitations & Fallback Delivery Tests...");

  const validSigningSeed = new Uint8Array(32);
  validSigningSeed.fill(0x55);

  const validXwingSeed = new Uint8Array(32);
  validXwingSeed.fill(0x77);

  const senderMailboxId = "c0000000-0000-0000-0000-000000000001";

  // ---------------------------------------------------------------------------
  // 1. sendMimeWithFallback routes to Path A for internal recipient with active X-Wing key
  // ---------------------------------------------------------------------------
  await test("1. sendMimeWithFallback: routes to Path A (E2E) for internal recipient", async () => {
    let internalSendCalled = false;
    let outboundSendCalled = false;

    const mockDeps: SendMimeFallbackDeps = {
      tryPathASend: async (params) => {
        internalSendCalled = true;
        return { kind: "sent", messageId: "msg-internal-101" };
      },
      fetchOutboundPubkey: async () => {
        throw new Error("Should not be called");
      },
      prepareOutbound: async () => {
        throw new Error("Should not be called");
      },
      sendOutbound: async () => {
        outboundSendCalled = true;
        return { delivery_id: "del-outbound-1", status: "queued" };
      },
    };

    const res = await sendMimeWithFallback(
      {
        recipient: "bob@byos.local",
        senderMailboxId,
        mimeMessage: "Subject: Team Sync\r\n\r\nMeeting details",
        signingSeed: validSigningSeed,
        senderXwingSeed: validXwingSeed,
      },
      mockDeps
    );

    assert(res.kind === "sent", "Send result should be 'sent'");
    assert(res.transport === "path_a", "Transport should be 'path_a'");
    assert(res.deliveryId === "msg-internal-101", "Delivery ID should match messageId");
    assert(internalSendCalled, "Path A send should have been invoked");
    assert(!outboundSendCalled, "Path B send must not be invoked for internal recipient");
  });

  // ---------------------------------------------------------------------------
  // 2. sendMimeWithFallback falls back to Path B for external recipient (404 lookup)
  // ---------------------------------------------------------------------------
  await test("2. sendMimeWithFallback: falls back to Path B for external recipient", async () => {
    let prepareCalled = false;
    let outboundCalled = false;
    let capturedSendPayload: SendPayload | null = null;

    const mockDeps: SendMimeFallbackDeps = {
      tryPathASend: async () => {
        // Simulates 404 lookup in key directory for external recipient
        return { kind: "fallback" };
      },
      fetchOutboundPubkey: async () => {
        return "mock_outbound_pubkey_hex_1234567890abcdef";
      },
      prepareOutbound: async (mailboxId) => {
        prepareCalled = true;
        return {
          reservation_id: "res-uuid-9999",
          outbox_seq: 42,
          encryption_version: 1,
          aad_version: 1,
          expires_at: new Date(Date.now() + 60000).toISOString(),
        };
      },
      sealOutbound: async (pubkey, mailboxIdHex, seq, plaintextB64) => {
        return {
          ciphertext: "mock_ciphertext_bytes",
          send_token_wrapped: "mock_wrapped_token",
          iv: "mock_iv_12bytes",
        };
      },
      sendOutbound: async (payload) => {
        outboundCalled = true;
        capturedSendPayload = payload;
        return { delivery_id: "del-outbound-external-01", status: "queued" };
      },
    };

    const res = await sendMimeWithFallback(
      {
        recipient: "partner@external-corp.com",
        senderMailboxId,
        mimeMessage: "Subject: Project Kickoff\r\n\r\nExternal invite",
        signingSeed: validSigningSeed,
        senderXwingSeed: validXwingSeed,
      },
      mockDeps
    );

    assert(res.kind === "sent", "Send result should be 'sent'");
    assert(res.transport === "path_b", "Transport should be 'path_b'");
    assert(res.deliveryId === "del-outbound-external-01", "Delivery ID should match outbound delivery ID");
    assert(prepareCalled, "prepareOutbound should be called");
    assert(outboundCalled, "sendOutbound should be called");
    assert(capturedSendPayload !== null, "SendPayload must not be null");
    assert(capturedSendPayload!.recipient === "partner@external-corp.com", "Recipient must match external address");
    assert(capturedSendPayload!.reservation_id === "res-uuid-9999", "Reservation ID must match");
    assert(capturedSendPayload!.outbox_seq === 42, "Outbox sequence must match reservation");
  });

  // ---------------------------------------------------------------------------
  // 3. sendMimeWithFallback fails closed on local cryptographic error
  // ---------------------------------------------------------------------------
  await test("3. sendMimeWithFallback: fails closed on local crypto error", async () => {
    const mockDeps: SendMimeFallbackDeps = {
      tryPathASend: async () => {
        return { kind: "failed", error: "Local encryption failed: signature generation error" };
      },
      prepareOutbound: async () => {
        throw new Error("Outbound must not be attempted when Path A failed with error");
      },
    };

    const res = await sendMimeWithFallback(
      {
        recipient: "alice@byos.local",
        senderMailboxId,
        mimeMessage: "Subject: Broken Crypto",
        signingSeed: new Uint8Array(16), // Corrupt seed length
      },
      mockDeps
    );

    assert(res.kind === "failed", "Result should be 'failed'");
    assert(res.transport === "path_a", "Failed transport should be 'path_a'");
    assert(Boolean(res.error?.includes("Local encryption failed")), "Error message preserved");
  });

  // ---------------------------------------------------------------------------
  // 4. sendMimeWithFallback handles Path B outbound API rejection
  // ---------------------------------------------------------------------------
  await test("4. sendMimeWithFallback: reports failure on Path B server rejection", async () => {
    const mockDeps: SendMimeFallbackDeps = {
      tryPathASend: async () => ({ kind: "fallback" }),
      fetchOutboundPubkey: async () => "mock_pk",
      prepareOutbound: async () => ({
        reservation_id: "res-uuid-fail",
        outbox_seq: 1,
        encryption_version: 1,
        aad_version: 1,
        expires_at: new Date().toISOString(),
      }),
      sealOutbound: async () => ({
        ciphertext: "ct",
        send_token_wrapped: "stw",
        iv: "iv",
      }),
      sendOutbound: async () => {
        throw new Error("HTTP 429: Outbound sending rate limit exceeded");
      },
    };

    const res = await sendMimeWithFallback(
      {
        recipient: "spammer-target@external.com",
        senderMailboxId,
        mimeMessage: "Subject: Rate Limit Test",
        signingSeed: validSigningSeed,
      },
      mockDeps
    );

    assert(res.kind === "failed", "Result should be 'failed'");
    assert(res.transport === "path_b", "Transport should be 'path_b'");
    assert(Boolean(res.error && res.error.toLowerCase().includes("rate limit exceeded")), `Expected rate limit error, got: ${res.error}`);
  });

  // ---------------------------------------------------------------------------
  // 5. Outbound Invitation Email Formatting (RFC 5545 METHOD:REQUEST)
  // ---------------------------------------------------------------------------
  await test("5. Outbound invitation formatting: compliant RFC 5545 REQUEST", () => {
    const start = new Date("2026-11-15T14:00:00Z");
    const end = new Date("2026-11-15T15:00:00Z");
    const ics = generateIcs({
      uid: "meet-ext-101",
      sequence: 0,
      method: "REQUEST",
      title: "Quarterly Strategy Review",
      description: "Discussion of Q4 roadmap and security milestones.",
      location: "Virtual Room 10",
      meetingUrl: "https://meet.byos.local/q4",
      startTime: start,
      endTime: end,
      organizer: { name: "Alice", email: "alice@byos.local" },
      attendees: [
        { name: "Bob", email: "bob@byos.local", role: "REQ-PARTICIPANT", partstat: "NEEDS-ACTION", rsvp: true },
        { name: "External Partner", email: "partner@external.com", role: "REQ-PARTICIPANT", partstat: "NEEDS-ACTION", rsvp: true },
      ],
    });

    assert(ics.includes("METHOD:REQUEST"), "Must contain METHOD:REQUEST");
    assert(ics.includes("UID:meet-ext-101"), "Must contain UID");
    assert(ics.includes("SEQUENCE:0"), "Initial sequence must be 0");
    assert(ics.includes("SUMMARY:Quarterly Strategy Review"), "Must include SUMMARY");
    assert(ics.includes("mailto:alice@byos.local"), "Must include ORGANIZER email");
    assert(ics.includes("partner@external.com"), "Must include external attendee email");
    assert(ics.includes("bob@byos.local"), "Must include internal attendee email");

    // Also parse back to verify roundtrip preservation despite 75-octet line folding
    const parsed = parseIcs(ics);
    assert(parsed.events.length === 1, "Parsed exactly 1 event");
    const ev = parsed.events[0];
    assert(ev.attendees.some((a: any) => a.email === "partner@external.com" && a.rsvp === true), "Parsed attendee partner@external.com with RSVP=TRUE");
  });

  // ---------------------------------------------------------------------------
  // 6. Event update sequence increment & subject prefixing
  // ---------------------------------------------------------------------------
  await test("6. Event update sequence increment: SEQUENCE monotonically increments", () => {
    const start = new Date("2026-11-15T14:00:00Z");
    const end = new Date("2026-11-15T15:00:00Z");

    const v0 = generateIcs({
      uid: "meet-ext-101",
      sequence: 0,
      method: "REQUEST",
      title: "Quarterly Strategy Review",
      startTime: start,
      endTime: end,
      organizer: { email: "alice@byos.local" },
    });
    assert(v0.includes("SEQUENCE:0"), "v0 sequence is 0");

    const v1 = generateIcs({
      uid: "meet-ext-101",
      sequence: 1,
      method: "REQUEST",
      title: "Quarterly Strategy Review (Updated Time)",
      startTime: new Date("2026-11-15T15:00:00Z"),
      endTime: new Date("2026-11-15T16:00:00Z"),
      organizer: { email: "alice@byos.local" },
    });
    assert(v1.includes("SEQUENCE:1"), "v1 sequence is 1");

    const v2 = generateIcs({
      uid: "meet-ext-101",
      sequence: 2,
      method: "REQUEST",
      title: "Quarterly Strategy Review (Final Room)",
      startTime: new Date("2026-11-15T15:00:00Z"),
      endTime: new Date("2026-11-15T16:00:00Z"),
      organizer: { email: "alice@byos.local" },
    });
    assert(v2.includes("SEQUENCE:2"), "v2 sequence is 2");

    // Check subject prefixing logic
    const getSubject = (title: string, seq: number) => `${seq > 0 ? "Updated Invitation: " : "Invitation: "}${title}`;
    assert(getSubject("Strategy Sync", 0) === "Invitation: Strategy Sync", "v0 has 'Invitation:' prefix");
    assert(getSubject("Strategy Sync", 1) === "Updated Invitation: Strategy Sync", "v1 has 'Updated Invitation:' prefix");
    assert(getSubject("Strategy Sync", 2) === "Updated Invitation: Strategy Sync", "v2 has 'Updated Invitation:' prefix");
  });

  // ---------------------------------------------------------------------------
  // 7. Event cancellation dispatch (METHOD:CANCEL with sequence increment)
  // ---------------------------------------------------------------------------
  await test("7. Cancellation dispatch: METHOD:CANCEL with incremented sequence", () => {
    const cancelIcs = generateIcs({
      uid: "meet-ext-101",
      sequence: 3, // Prior was 2
      method: "CANCEL",
      status: "CANCELLED",
      title: "Quarterly Strategy Review",
      startTime: new Date("2026-11-15T15:00:00Z"),
      endTime: new Date("2026-11-15T16:00:00Z"),
      organizer: { email: "alice@byos.local" },
      attendees: [
        { email: "partner@external.com", partstat: "DECLINED" },
      ],
    });

    assert(cancelIcs.includes("METHOD:CANCEL"), "Cancellation must specify METHOD:CANCEL");
    assert(cancelIcs.includes("STATUS:CANCELLED"), "Status must be CANCELLED");
    assert(cancelIcs.includes("SEQUENCE:3"), "Cancellation sequence must exceed prior revisions");
  });

  // ---------------------------------------------------------------------------
  // 8. Occurrence cancellation dispatch includes RECURRENCE-ID
  // ---------------------------------------------------------------------------
  await test("8. Occurrence cancellation dispatch: includes RECURRENCE-ID", () => {
    const recurrenceId = "20261115T150000Z";
    const cancelOccurrenceIcs = generateIcs({
      uid: "series-recur-202",
      sequence: 2,
      recurrenceId,
      method: "CANCEL",
      status: "CANCELLED",
      title: "Weekly Engineering Standup",
      startTime: new Date("2026-11-15T15:00:00Z"),
      endTime: new Date("2026-11-15T16:00:00Z"),
      organizer: { email: "alice@byos.local" },
      attendees: [
        { email: "partner@external.com", partstat: "DECLINED" },
      ],
    });

    assert(cancelOccurrenceIcs.includes("METHOD:CANCEL"), "Contains METHOD:CANCEL");
    assert(cancelOccurrenceIcs.includes("STATUS:CANCELLED"), "Contains STATUS:CANCELLED");
    assert(cancelOccurrenceIcs.includes("RECURRENCE-ID:20261115T150000Z"), "Must include RECURRENCE-ID");
  });

  // ---------------------------------------------------------------------------
  // 9. Outbound RSVP reply formatting (RFC 5546 METHOD:REPLY)
  // ---------------------------------------------------------------------------
  await test("9. Outbound RSVP reply formatting: compliant RFC 5546 REPLY", () => {
    const replyIcs = generateRsvpReplyIcs({
      uid: "meet-ext-101",
      sequence: 2,
      title: "Quarterly Strategy Review",
      startTime: new Date("2026-11-15T15:00:00Z"),
      endTime: new Date("2026-11-15T16:00:00Z"),
      organizer: { name: "External Organizer", email: "organizer@external-firm.com" },
      responder: {
        name: "Alice Smith",
        email: "alice@byos.local",
        status: "ACCEPTED",
      },
    });

    assert(replyIcs.includes("METHOD:REPLY"), "Must contain METHOD:REPLY");
    assert(replyIcs.includes("UID:meet-ext-101"), "UID must match invitation");
    assert(replyIcs.includes("SEQUENCE:2"), "Sequence must match invitation");
    assert(replyIcs.includes("PARTSTAT=ACCEPTED"), "Must specify PARTSTAT=ACCEPTED");
    assert(replyIcs.includes("mailto:alice@byos.local"), "Must include responder email");
    assert(replyIcs.includes("organizer@external-firm.com"), "Organizer matches external organizer");

    const parsed = parseIcs(replyIcs);
    assert(parsed.method === "REPLY", "Parsed method is REPLY");
    assert(parsed.events.length === 1, "Parsed exactly 1 event");
    assert(parsed.events[0].attendees.some((a) => a.email === "alice@byos.local" && a.partstat === "ACCEPTED"), "Parsed responder attendee with ACCEPTED");
  });

  // ---------------------------------------------------------------------------
  // 10. External RSVP dispatch pipeline simulation
  // ---------------------------------------------------------------------------
  await test("10. External RSVP dispatch pipeline: routes via Path B to external organizer", async () => {
    let outboundSent = false;
    let deliveredRecipient = "";
    let deliveredMime = "";

    const mockDeps: SendMimeFallbackDeps = {
      tryPathASend: async () => ({ kind: "fallback" }), // External organizer has no BYOS X-Wing key
      fetchOutboundPubkey: async () => "outbound_pubkey_test",
      prepareOutbound: async () => ({
        reservation_id: "res-rsvp-456",
        outbox_seq: 88,
        encryption_version: 1,
        aad_version: 1,
        expires_at: new Date().toISOString(),
      }),
      sealOutbound: async (pk, mbox, seq, plaintextB64) => ({
        ciphertext: "sealed_rsvp_ciphertext",
        send_token_wrapped: "wrapped_token",
        iv: "iv_12345678",
      }),
      sendOutbound: async (payload) => {
        outboundSent = true;
        deliveredRecipient = payload.recipient;
        return { delivery_id: "del-rsvp-delivered-99", status: "queued" };
      },
    };

    const replyIcs = generateRsvpReplyIcs({
      uid: "meet-ext-101",
      sequence: 1,
      title: "Executive Board Meeting",
      startTime: new Date("2026-12-01T10:00:00Z"),
      endTime: new Date("2026-12-01T11:00:00Z"),
      organizer: { email: "ceo@external-board.org" },
      responder: {
        email: "alice@byos.local",
        status: "ACCEPTED",
      },
    });

    const boundary = "----=_Part_rsvp_test_12345";
    const mimeReply = [
      "From: alice@byos.local",
      "To: ceo@external-board.org",
      "Subject: Accepted: Executive Board Meeting",
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Alice has accepted the invitation.",
      `--${boundary}`,
      'Content-Type: text/calendar; method=REPLY; charset="utf-8"',
      "",
      replyIcs.trim(),
      `--${boundary}--`,
    ].join("\r\n");

    const res = await sendMimeWithFallback(
      {
        recipient: "ceo@external-board.org",
        senderMailboxId,
        mimeMessage: mimeReply,
        signingSeed: validSigningSeed,
      },
      mockDeps
    );

    assert(res.kind === "sent", "RSVP dispatch should succeed");
    assert(res.transport === "path_b", "Must use Path B for external organizer");
    assert(outboundSent, "sendOutbound was executed");
    assert(deliveredRecipient === "ceo@external-board.org", "Recipient is external organizer");
  });

  return { passed, failed };
}
