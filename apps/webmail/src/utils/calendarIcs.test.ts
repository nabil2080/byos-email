import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMime } from "../mime.js";
import {
  parseIcs,
  generateIcs,
  generateRsvpReplyIcs,
  unescapeIcsText,
  escapeIcsText,
  foldIcsLine,
  parseIcsDate,
  cleanEmail,
  verifyInvitationAuthenticity,
  groupSeriesEvents,
  parseIcsOffset,
  formatIcsOffset,
  convertLocalToUtc,
  formatIcsLocalTime,
  generateVTimeZone,
} from "./calendarIcs.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

export function runCalendarIcsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}:`, e);
      failed++;
    }
  };

  console.log("Running Calendar ICS & Invitation Tests...");

  // 1. Text escaping and unescaping
  test("unescapeIcsText handles commas, semicolons, backslashes, and newlines", () => {
    const raw = "Meeting with Alice\\, Bob\\; and Charlie\\\\\\nNext line\\NThird line";
    const unescaped = unescapeIcsText(raw);
    assert(
      unescaped === "Meeting with Alice, Bob; and Charlie\\\nNext line\nThird line",
      `Expected unescaped text, got: ${unescaped}`
    );
  });

  test("escapeIcsText escapes special characters", () => {
    const raw = "Review: 1, 2; test\\backslash\nnew line";
    const escaped = escapeIcsText(raw);
    assert(escaped.includes("\\,"), "comma not escaped");
    assert(escaped.includes("\\;"), "semicolon not escaped");
    assert(escaped.includes("\\\\"), "backslash not escaped");
    assert(escaped.includes("\\n"), "newline not escaped");
  });

  // 2. Line folding and unfolding
  test("foldIcsLine folds lines > 75 characters", () => {
    const longLine =
      "DESCRIPTION:This is an extremely long calendar event description that definitely exceeds seventy-five octets in length and must be folded by the RFC 5545 serializer.";
    const folded = foldIcsLine(longLine);
    assert(folded.includes("\r\n "), "Line folding delimiter missing");
    // Verify each line chunk length <= 76 (75 + space)
    const lines = folded.split("\r\n ");
    assert(lines[0].length <= 75, "First chunk exceeds 75 octets");
  });

  // 3. Date parsing
  test("parseIcsDate parses UTC and all-day dates", () => {
    const utc = parseIcsDate("20261020T143000Z");
    assert(!utc.isAllDay, "Should not be all-day");
    assert(utc.date.getUTCFullYear() === 2026, "Year mismatch");
    assert(utc.date.getUTCMonth() === 9, "Month mismatch"); // 0-indexed Oct = 9
    assert(utc.date.getUTCDate() === 20, "Date mismatch");
    assert(utc.date.getUTCHours() === 14, "Hour mismatch");
    assert(utc.date.getUTCMinutes() === 30, "Minute mismatch");

    const allDay = parseIcsDate("20261021");
    assert(allDay.isAllDay, "Should be all-day");
    assert(allDay.date.getUTCFullYear() === 2026, "All-day year mismatch");
    assert(allDay.date.getUTCDate() === 21, "All-day date mismatch");
  });

  // 4. Clean email
  test("cleanEmail strips mailto: and angle brackets", () => {
    assert(cleanEmail("mailto:alice@byos.local") === "alice@byos.local", "mailto: not stripped");
    assert(cleanEmail("<bob@byos.local>") === "bob@byos.local", "brackets not stripped");
  });

  // 5. Generate and Parse Roundtrip
  test("generateIcs and parseIcs full roundtrip with attendees and organizer", () => {
    const start = new Date(Date.UTC(2026, 9, 21, 10, 0, 0));
    const end = new Date(Date.UTC(2026, 9, 21, 11, 0, 0));
    const icsString = generateIcs({
      uid: "test-event-uuid-12345",
      sequence: 1,
      method: "REQUEST",
      title: "Quarterly Planning & Review",
      description: "Discussing Q4 roadmap and architecture deliverables.",
      location: "Conference Room A",
      meetingUrl: "https://meet.byos.local/q4-review",
      startTime: start,
      endTime: end,
      isAllDay: false,
      organizer: {
        name: "Alice Smith",
        email: "alice@byos.local",
      },
      attendees: [
        {
          name: "Bob Jones",
          email: "bob@byos.local",
          role: "REQ-PARTICIPANT",
          partstat: "NEEDS-ACTION",
          rsvp: true,
        },
      ],
    });

    assert(icsString.includes("BEGIN:VCALENDAR"), "Missing BEGIN:VCALENDAR");
    assert(icsString.includes("METHOD:REQUEST"), "Missing METHOD:REQUEST");
    assert(icsString.includes("UID:test-event-uuid-12345"), "Missing UID");

    const parsed = parseIcs(icsString);
    assert(parsed.method === "REQUEST", `Expected REQUEST method, got ${parsed.method}`);
    assert(parsed.isInvitation === true, "Should be flagged as an invitation");
    assert(parsed.events.length === 1, "Expected 1 event");

    const ev = parsed.events[0];
    assert(ev.uid === "test-event-uuid-12345", `UID mismatch: ${ev.uid}`);
    assert(ev.sequence === 1, `Sequence mismatch: ${ev.sequence}`);
    assert(ev.summary === "Quarterly Planning & Review", `Summary mismatch: ${ev.summary}`);
    assert(Boolean(ev.description?.includes("Discussing Q4 roadmap")), "Description mismatch");
    assert(ev.location === "Conference Room A", `Location mismatch: ${ev.location}`);
    assert(ev.url === "https://meet.byos.local/q4-review", `URL mismatch: ${ev.url}`);
    assert(ev.startTime.getTime() === start.getTime(), "Start time mismatch");
    assert(ev.endTime.getTime() === end.getTime(), "End time mismatch");
    assert(ev.organizer?.name === "Alice Smith", `Organizer name mismatch: ${ev.organizer?.name}`);
    assert(ev.organizer?.email === "alice@byos.local", `Organizer email mismatch: ${ev.organizer?.email}`);
    assert(ev.attendees.length === 1, "Attendee length mismatch");
    assert(ev.attendees[0].name === "Bob Jones", `Attendee name mismatch: ${ev.attendees[0].name}`);
    assert(ev.attendees[0].email === "bob@byos.local", `Attendee email mismatch: ${ev.attendees[0].email}`);
    assert(ev.attendees[0].partstat === "NEEDS-ACTION", "Attendee status mismatch");
    assert(ev.attendees[0].rsvp === true, "Attendee RSVP mismatch");
  });

  // 6. Generate RSVP Reply
  test("generateRsvpReplyIcs formats RFC 5546 iTIP reply", () => {
    const start = new Date(Date.UTC(2026, 9, 21, 10, 0, 0));
    const end = new Date(Date.UTC(2026, 9, 21, 11, 0, 0));
    const replyIcs = generateRsvpReplyIcs({
      uid: "test-event-uuid-12345",
      sequence: 1,
      title: "Quarterly Planning & Review",
      startTime: start,
      endTime: end,
      organizer: {
        name: "Alice Smith",
        email: "alice@byos.local",
      },
      responder: {
        name: "Bob Jones",
        email: "bob@byos.local",
        status: "ACCEPTED",
      },
    });

    assert(replyIcs.includes("METHOD:REPLY"), "Missing METHOD:REPLY");
    assert(replyIcs.includes("UID:test-event-uuid-12345"), "Missing UID");
    assert(replyIcs.includes("PARTSTAT=ACCEPTED"), "Missing PARTSTAT=ACCEPTED");
    assert(replyIcs.includes("STATUS:CONFIRMED"), "Missing STATUS:CONFIRMED");

    const parsed = parseIcs(replyIcs);
    assert(parsed.method === "REPLY", `Expected REPLY method, got ${parsed.method}`);
    assert(parsed.isInvitation === true, "Reply should be flagged as invitation event");
    assert(parsed.events[0].attendees[0].partstat === "ACCEPTED", "Attendee should be ACCEPTED");
  });

  // 7. Malformed ICS handling
  test("parseIcs safely handles malformed, truncated, or empty input", () => {
    const empty = parseIcs("");
    assert(empty.events.length === 0, "Empty string should produce 0 events");
    assert(!empty.isInvitation, "Empty string should not be invitation");

    const truncated = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Truncated Event\r\n";
    const res = parseIcs(truncated);
    assert(res.events.length === 0, "Unclosed VEVENT should not produce incomplete event");

    const missingUid =
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Missing UID\r\nDTSTART:20261021T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR";
    const res2 = parseIcs(missingUid);
    assert(res2.events.length === 1, "Should create 1 event");
    assert(res2.events[0].uid.startsWith("ics-fallback-"), "Should assign fallback UID");
  });

  // 8. Distinguish invitation from ordinary calendar file
  test("Distinguish invitation (METHOD:REQUEST) from ordinary published calendar", () => {
    const ordinary = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:ordinary-1",
      "SUMMARY:Holiday",
      "DTSTART:20261225",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsedOrdinary = parseIcs(ordinary);
    assert(!parsedOrdinary.isInvitation, "Ordinary calendar without attendees/method should NOT be invitation");

    const invitation = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:invite-1",
      "SUMMARY:Team Sync",
      "DTSTART:20261022T090000Z",
      "ORGANIZER:mailto:lead@byos.local",
      "ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:dev@byos.local",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsedInvite = parseIcs(invitation);
    assert(parsedInvite.isInvitation, "METHOD:REQUEST with organizer and attendee MUST be an invitation");
  });

  // 9. Organizer update increments sequence and retains stable UID
  test("9. Organizer update increments sequence and retains stable UID", () => {
    const v0 = generateIcs({
      uid: "stable-uid-999",
      sequence: 0,
      title: "Kickoff Sync",
      startTime: new Date("2026-10-22T10:00:00Z"),
      endTime: new Date("2026-10-22T11:00:00Z"),
      organizer: { email: "alice@byos.local" },
      attendees: [{ email: "bob@byos.local" }],
    });
    const parsedV0 = parseIcs(v0).events[0];
    assert(parsedV0.sequence === 0, "Initial sequence should be 0");
    assert(parsedV0.uid === "stable-uid-999", "UID should match");

    const v1 = generateIcs({
      uid: "stable-uid-999",
      sequence: 1,
      title: "Kickoff Sync (Rescheduled)",
      startTime: new Date("2026-10-22T14:00:00Z"),
      endTime: new Date("2026-10-22T15:00:00Z"),
      organizer: { email: "alice@byos.local" },
      attendees: [{ email: "bob@byos.local" }],
    });
    const parsedV1 = parseIcs(v1).events[0];
    assert(parsedV1.sequence === 1, "Updated sequence should be 1");
    assert(parsedV1.uid === "stable-uid-999", "UID MUST remain stable across updates");
  });

  // 10. Genuine stale REQUEST rejection: stored revision is newer than incoming
  test("10. Stale update rejected: incoming revision older than stored revision", () => {
    const existing = {
      uid: "stable-uid-999",
      sequence: 2,
      organizer: { email: "alice@byos.local" },
      myRsvpStatus: "accepted",
    };
    const staleIncoming = {
      uid: "stable-uid-999",
      sequence: 1, // older than stored revision 2
      summary: "Stale Invite",
      startTime: new Date(),
      endTime: new Date(),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer: { email: "alice@byos.local" },
      attendees: [],
    };
    const result = verifyInvitationAuthenticity(staleIncoming, existing);
    assert(!result.valid, "Stale update MUST be rejected");
    assert(result.isStale === true, "isStale flag must be set for genuine stale revision");
    assert(!result.isInvalidInput, "isInvalidInput must NOT be set — this is a valid seq, just older");
    assert(result.reason!.includes("Stale update"), "Reason must describe stale update");
    assert(result.reason!.includes("v1"), "Reason must name incoming revision");
    assert(result.reason!.includes("v2"), "Reason must name stored revision");
  });

  // 11. Organizer mismatch rejected by verifyInvitationAuthenticity
  test("11. Organizer mismatch rejected by verifyInvitationAuthenticity", () => {
    const existing = {
      uid: "joint-meeting-101",
      sequence: 0,
      organizer: { email: "charlie@byos.local" },
      myRsvpStatus: "accepted",
    };
    const spoofedIncoming = {
      uid: "joint-meeting-101",
      sequence: 1,
      summary: "Hijacked Meeting",
      startTime: new Date(),
      endTime: new Date(),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer: { email: "attacker@evil.local" }, // different organizer!
      attendees: [],
    };
    const result = verifyInvitationAuthenticity(spoofedIncoming, existing);
    assert(!result.valid, "Organizer mismatch MUST be rejected");
    assert(result.isOrganizerMismatch === true, "isOrganizerMismatch flag should be true");
    assert(result.reason!.includes("Organizer mismatch"), "Reason should mention organizer mismatch");
  });

  // 12. Duplicate RSVP response detected
  test("12. Duplicate RSVP response detected without duplicate side-effects", () => {
    const existing = {
      uid: "event-dup-102",
      sequence: 0,
      organizer: { email: "alice@byos.local" },
      myRsvpStatus: "accepted",
    };
    const incoming = {
      uid: "event-dup-102",
      sequence: 0,
      summary: "Existing Event",
      startTime: new Date(),
      endTime: new Date(),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer: { email: "alice@byos.local" },
      attendees: [],
    };
    const result = verifyInvitationAuthenticity(incoming, existing, "ACCEPTED");
    assert(result.valid, "Valid event");
    assert(result.isDuplicate === true, "Should be flagged as duplicate RSVP");
  });

  // 13. Cancellation followed by older REQUEST is rejected
  test("13. Cancellation followed by older REQUEST is rejected", () => {
    const cancelledExisting = {
      uid: "evt-cancel-seq",
      sequence: 2,
      organizer: { email: "alice@byos.local" },
      myRsvpStatus: "declined",
    };
    const oldRequest = {
      uid: "evt-cancel-seq",
      sequence: 0,
      summary: "Old Request",
      startTime: new Date(),
      endTime: new Date(),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer: { email: "alice@byos.local" },
      attendees: [],
    };
    const res = verifyInvitationAuthenticity(oldRequest, cancelledExisting);
    assert(!res.valid, "Older request arriving after cancellation MUST be rejected");
    assert(res.isStale === true, "Must flag as stale");
  });

  // 14. Single-instance recurrence exception (RECURRENCE-ID) parsed
  test("14. Single-instance recurrence exception (RECURRENCE-ID) parsed", () => {
    const recurringExceptionIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:series-recurring-001",
      "SEQUENCE:2",
      "RECURRENCE-ID;VALUE=DATE-TIME:20261021T140000Z",
      "DTSTART:20261021T150000Z",
      "DTEND:20261021T160000Z",
      "SUMMARY:Standup (Shifted by 1 hour)",
      "ORGANIZER:mailto:lead@byos.local",
      "ATTENDEE:mailto:dev@byos.local",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(recurringExceptionIcs);
    assert(parsed.events.length === 1, "Should parse 1 exception event");
    const ev = parsed.events[0];
    assert(ev.recurrenceId === "20261021T140000Z", `Expected recurrenceId, got: ${ev.recurrenceId}`);
    assert(ev.sequence === 2, "Sequence should be 2");
  });

  // 15. Timezone-aware timestamp and Daylight-Saving transition
  test("15. Timezone-aware timestamp and Daylight-Saving transition", () => {
    const tzIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:tz-event-1",
      "DTSTART;TZID=America/New_York:20261101T013000",
      "DTEND;TZID=America/New_York:20261101T023000",
      "SUMMARY:DST Fall Back Meeting",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(tzIcs);
    assert(parsed.events.length === 1, "Should parse event");
    assert(parsed.events[0].timezone === "America/New_York", "TZID America/New_York preserved");
  });

  // 16. Parser resilience: reject oversized input (>512KB)
  test("16. Parser resilience: reject oversized input (>512KB)", () => {
    const hugeString = "BEGIN:VCALENDAR\r\n" + "X-PADDING: " + "A".repeat(513 * 1024) + "\r\nEND:VCALENDAR";
    const parsed = parseIcs(hugeString);
    assert(parsed.events.length === 0, "Oversized input must safely produce 0 events");
  });

  // 17. Parser resilience: sanitize dangerous URL schemes (javascript:)
  test("17. Parser resilience: sanitize dangerous URL schemes (javascript:)", () => {
    const dangerousIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:xss-url-1",
      "SUMMARY:Malicious Link",
      "URL:javascript:alert(document.cookie)",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(dangerousIcs);
    assert(parsed.events.length === 1, "Event parsed");
    assert(parsed.events[0].url === undefined, "javascript: URL scheme MUST be stripped");

    const safeIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:safe-url-1",
      "SUMMARY:Safe Link",
      "URL:https://meet.byos.local/room-42",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const parsedSafe = parseIcs(safeIcs);
    assert(parsedSafe.events[0].url === "https://meet.byos.local/room-42", "HTTPS URL preserved");
  });

  // 18. Parser resilience: sanitize ASCII control characters in summary and description
  test("18. Parser resilience: sanitize ASCII control characters", () => {
    const controlCharIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:ctrl-char-1",
      "SUMMARY:Meeting\x00\x07\x1BTitle",
      "DESCRIPTION:Notes\x08with\x1Fcontrol",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(controlCharIcs);
    assert(parsed.events[0].summary === "MeetingTitle", "Control chars stripped from summary");
    assert(parsed.events[0].description === "Noteswithcontrol", "Control chars stripped from description");
  });

  // 19. Parser resilience: duplicate UID property takes first valid UID
  test("19. Parser resilience: duplicate UID property takes first valid UID", () => {
    const dupUidIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:first-authoritative-uid",
      "UID:second-overriding-uid",
      "SUMMARY:Duplicate UID Test",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(dupUidIcs);
    assert(parsed.events[0].uid === "first-authoritative-uid", "First UID property MUST be retained");
  });

  // 20. RFC 6047 MIME fixtures roundtrip for REQUEST, REPLY, CANCEL
  test("20. RFC 6047 MIME fixtures roundtrip for REQUEST, REPLY, CANCEL", () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const fixtureDir = path.resolve(currentDir, "../../../../tests/fixtures/calendar");

    // REQUEST
    const reqPath = path.join(fixtureDir, "invite_request.eml");
    assert(fs.existsSync(reqPath), "invite_request.eml fixture exists");
    const rawReq = fs.readFileSync(reqPath, "utf-8");
    const parsedReqMime = parseMime(rawReq);
    assert(parsedReqMime.calendarPart != null, "Request calendarPart extracted");
    assert(parsedReqMime.calendarPart!.method === "REQUEST", "Request method is REQUEST");
    const parsedReqIcs = parseIcs(parsedReqMime.calendarPart!.rawIcs);
    assert(parsedReqIcs.events.length === 1, "Parsed request has 1 event");
    assert(parsedReqIcs.events[0].uid === "meet-arch-sync-20261021-001", "Request UID matches");
    assert(parsedReqIcs.events[0].sequence === 0, "Request sequence is 0");
    assert(parsedReqIcs.events[0].status === "CONFIRMED", "Request status is CONFIRMED");

    // REPLY
    const repPath = path.join(fixtureDir, "invite_reply.eml");
    assert(fs.existsSync(repPath), "invite_reply.eml fixture exists");
    const rawRep = fs.readFileSync(repPath, "utf-8");
    const parsedRepMime = parseMime(rawRep);
    assert(parsedRepMime.calendarPart != null, "Reply calendarPart extracted");
    assert(parsedRepMime.calendarPart!.method === "REPLY", "Reply method is REPLY");
    const parsedRepIcs = parseIcs(parsedRepMime.calendarPart!.rawIcs);
    assert(parsedRepIcs.events[0].attendees[0].partstat === "ACCEPTED", "Attendee accepted in reply");

    // CANCEL
    const canPath = path.join(fixtureDir, "invite_cancel.eml");
    assert(fs.existsSync(canPath), "invite_cancel.eml fixture exists");
    const rawCan = fs.readFileSync(canPath, "utf-8");
    const parsedCanMime = parseMime(rawCan);
    assert(parsedCanMime.calendarPart != null, "Cancel calendarPart extracted");
    assert(parsedCanMime.calendarPart!.method === "CANCEL", "Cancel method is CANCEL");
    const parsedCanIcs = parseIcs(parsedCanMime.calendarPart!.rawIcs);
    assert(parsedCanIcs.events[0].status === "CANCELLED", "Event status is CANCELLED");
    assert(parsedCanIcs.events[0].sequence === 1, "Cancel sequence is 1");
  });

  // ---------------------------------------------------------------------------
  // 21. BYOS policy: negative SEQUENCE is rejected as unsupported input
  //     (Distinct from stale — this is a policy rejection, not an older revision)
  // ---------------------------------------------------------------------------
  test("21. BYOS policy: negative SEQUENCE rejected as invalid input (not a stale-revision check)", () => {
    const negSeqEvent = {
      uid: "neg-seq-test@example.invalid",
      sequence: -1,
      summary: "Policy Violation",
      startTime: new Date(),
      endTime: new Date(),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer: { email: "org@example.invalid" },
      attendees: [],
    };
    // Called without existing event — the rejection must fire before any existing-state lookup.
    const result = verifyInvitationAuthenticity(negSeqEvent, null);
    assert(!result.valid, "Negative SEQUENCE must be rejected");
    assert(result.isInvalidInput === true, "isInvalidInput must be set — this is a policy rejection, not a stale revision");
    assert(!result.isStale, "isStale must NOT be set — we have no stored revision to compare against");
    assert(result.reason!.toLowerCase().includes("byos policy"), "Reason must attribute this to BYOS policy, not RFC mandate");
    assert(result.reason!.includes("-1"), "Reason must identify the offending sequence value");
  });

  // ---------------------------------------------------------------------------
  // 22. Full stale REQUEST lifecycle using stored-event state
  //     UID: phase51-stale-test@example.invalid / Organizer: organizer@example.invalid
  //     Stored at seq 3; older revision 2 must be rejected; newer 4 must be accepted;
  //     duplicate 4 must be idempotent; older CANCEL must be rejected; valid CANCEL (seq 5) accepted.
  // ---------------------------------------------------------------------------
  test("22. Full stale REQUEST lifecycle: seq3 stored → seq2 rejected → seq4 accepted → dup seq4 idempotent → old CANCEL rejected → valid CANCEL accepted", () => {
    const uid = "phase51-stale-test@example.invalid";
    const organizer = { email: "organizer@example.invalid" };

    // State: event already persisted at revision 3 with our RSVP = ACCEPTED.
    const storedAtSeq3 = {
      uid,
      sequence: 3,
      organizer,
      myRsvpStatus: "accepted",
    };

    const makeEvent = (seq: number, status: "CONFIRMED" | "CANCELLED" = "CONFIRMED") => ({
      uid,
      sequence: seq,
      summary: `Stale lifecycle event (v${seq})`,
      startTime: new Date("2026-11-01T10:00:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      status,
      organizer,
      attendees: [] as any[],
    });

    // A. Incoming REQUEST at seq 2 (older than stored seq 3) → isStale, not isInvalidInput
    const r2 = verifyInvitationAuthenticity(makeEvent(2), storedAtSeq3, "ACCEPTED");
    assert(!r2.valid, "Seq 2 < stored seq 3: MUST be rejected");
    assert(r2.isStale === true, "Must be flagged as genuine stale revision");
    assert(!r2.isInvalidInput, "Seq 2 is a valid non-negative integer — not a policy rejection");
    assert(r2.reason!.includes("v2"), "Reason must cite incoming seq");
    assert(r2.reason!.includes("v3"), "Reason must cite stored seq");

    // B. Incoming REQUEST at seq 4 (newer than stored seq 3) → accepted
    const r4 = verifyInvitationAuthenticity(makeEvent(4), storedAtSeq3, "ACCEPTED");
    assert(r4.valid, "Seq 4 > stored seq 3: MUST be accepted");
    assert(!r4.isStale, "Must NOT be stale");
    assert(!r4.isDuplicate, "Must NOT be duplicate — new revision");

    // Update stored state to reflect that seq 4 was processed.
    const storedAtSeq4 = { uid, sequence: 4, organizer, myRsvpStatus: "accepted" };

    // C. Duplicate delivery of seq 4 with same RSVP response → isDuplicate
    const rDup = verifyInvitationAuthenticity(makeEvent(4), storedAtSeq4, "ACCEPTED");
    assert(rDup.valid, "Duplicate delivery must not hard-reject (valid=true)");
    assert(rDup.isDuplicate === true, "Must be flagged as duplicate delivery");
    assert(!rDup.isStale, "Duplicate is same revision, not older");

    // D. Older CANCEL arriving at seq 2 after seq 4 is stored → isStale (not isInvalidInput)
    const rOldCancel = verifyInvitationAuthenticity(makeEvent(2, "CANCELLED"), storedAtSeq4);
    assert(!rOldCancel.valid, "Old CANCEL (seq 2 < stored seq 4) MUST be rejected");
    assert(rOldCancel.isStale === true, "Old CANCEL must be flagged as stale revision");
    assert(!rOldCancel.isInvalidInput, "Seq 2 is valid — policy reject flag must NOT be set");

    // E. Valid CANCEL at seq 5 (incremented above stored 4) → accepted
    const rValidCancel = verifyInvitationAuthenticity(makeEvent(5, "CANCELLED"), storedAtSeq4);
    assert(rValidCancel.valid, "CANCEL at seq 5 > stored seq 4 MUST be accepted");
    assert(!rValidCancel.isStale, "Must NOT be stale");
    assert(!rValidCancel.isDuplicate, "Must NOT be duplicate");
  });

  // ---------------------------------------------------------------------------
  // 23. REPLY method: attendee echoes organizer sequence — stale check must NOT apply
  //     RFC 5546 §3.2.3: the attendee's REPLY carries the sequence from the invitation
  //     they are responding to. Treating it as an organizer-sequence update would
  //     incorrectly flag a reply to an older version as a stale RSVP.
  // ---------------------------------------------------------------------------
  test("23. REPLY method: attendee response with organizer's sequence is accepted, not treated as stale", () => {
    // Organizer sent REQUEST at seq 2. Attendee replies echoing seq 2.
    // The attendee has NOT incremented the sequence — that is correct per RFC 5546.
    // verifyInvitationAuthenticity is called for REPLY without proposedRsvp to signal
    // this is not an organizer-managed state change.
    const stored = {
      uid: "reply-seq-test@example.invalid",
      sequence: 2,
      organizer: { email: "org@example.invalid" },
      myRsvpStatus: "needs-action",
    };
    const attendeeReply = {
      uid: "reply-seq-test@example.invalid",
      sequence: 2, // Attendee echoes organizer's seq 2 — NOT incrementing it
      summary: "Team Sync",
      startTime: new Date("2026-11-02T09:00:00Z"),
      endTime: new Date("2026-11-02T10:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer: { email: "org@example.invalid" },
      attendees: [{ email: "attendee@example.invalid", name: "Attendee", partstat: "ACCEPTED" as const, rsvp: false }],
    };

    // No proposedRsvp argument — this is an inbound REPLY being correlated, not an RSVP action.
    const result = verifyInvitationAuthenticity(attendeeReply, stored);
    assert(result.valid, "REPLY echoing organizer seq 2 must be valid — attendee must not increment");
    assert(!result.isStale, "Must NOT be flagged stale — same seq is expected for a REPLY");
    assert(!result.isDuplicate, "Without proposedRsvp, duplicate check does not apply");

    // Verify that a REPLY arriving with an attendee-fabricated higher sequence is also
    // structurally valid (we cannot reject it as stale — the sequence is not lower).
    // The attendee violates RFC 5546 but we still accept the RSVP action.
    const inflatedReply = { ...attendeeReply, sequence: 3 };
    const inflatedResult = verifyInvitationAuthenticity(inflatedReply, stored);
    assert(inflatedResult.valid, "Inflated attendee seq must not be rejected as stale by BYOS");
  });

  // ---------------------------------------------------------------------------
  // 24. REQUEST update: organizer revision increment retains UID and increments sequence
  //     (extends test 9 with authenticity check on each revision)
  // ---------------------------------------------------------------------------
  test("24. REQUEST updates v0 → v1 → v2 accepted by verifyInvitationAuthenticity at each step", () => {
    const uid = "auth-request-update-seq@example.invalid";
    const organizer = { email: "chair@example.invalid" };

    const makeReq = (seq: number) => ({
      uid,
      sequence: seq,
      summary: `Meeting Update v${seq}`,
      startTime: new Date("2026-11-10T14:00:00Z"),
      endTime: new Date("2026-11-10T15:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer,
      attendees: [] as any[],
    });

    // Step 1: v0 arrives, no stored event yet
    const r0 = verifyInvitationAuthenticity(makeReq(0), null, "ACCEPTED");
    assert(r0.valid, "Initial REQUEST v0 must be accepted (no existing event)");

    // Step 2: v1 arrives, stored at v0
    const stored0 = { uid, sequence: 0, organizer, myRsvpStatus: "accepted" };
    const r1 = verifyInvitationAuthenticity(makeReq(1), stored0, "ACCEPTED");
    assert(r1.valid, "REQUEST v1 > stored v0 must be accepted");
    assert(!r1.isStale, "v1 must not be stale");
    assert(!r1.isDuplicate, "v1 is a new revision — not duplicate");

    // Step 3: v2 arrives, stored at v1
    const stored1 = { uid, sequence: 1, organizer, myRsvpStatus: "accepted" };
    const r2 = verifyInvitationAuthenticity(makeReq(2), stored1, "ACCEPTED");
    assert(r2.valid, "REQUEST v2 > stored v1 must be accepted");
  });

  // ---------------------------------------------------------------------------
  // 25. CANCEL: organizer sequence must be higher than last REQUEST
  // ---------------------------------------------------------------------------
  test("25. CANCEL sequence must exceed stored REQUEST sequence", () => {
    const uid = "cancel-seq-check@example.invalid";
    const organizer = { email: "org@example.invalid" };
    const stored = { uid, sequence: 2, organizer, myRsvpStatus: "accepted" };

    // CANCEL with seq 1 (lower than stored 2) → stale
    const oldCancel = {
      uid, sequence: 1, summary: "Old Cancel",
      startTime: new Date(), endTime: new Date(),
      isAllDay: false, status: "CANCELLED" as const, organizer, attendees: [] as any[],
    };
    const rOld = verifyInvitationAuthenticity(oldCancel, stored);
    assert(!rOld.valid, "CANCEL at seq 1 < stored seq 2 must be rejected");
    assert(rOld.isStale === true, "Must be flagged stale");

    // CANCEL with seq 3 (higher than stored 2) → accepted
    const newCancel = { ...oldCancel, sequence: 3, status: "CANCELLED" as const };
    const rNew = verifyInvitationAuthenticity(newCancel, stored);
    assert(rNew.valid, "CANCEL at seq 3 > stored seq 2 must be accepted");
    assert(!rNew.isStale, "Must not be stale");
  });

  // ---------------------------------------------------------------------------
  // 26. Recurring event: correlation by UID + RECURRENCE-ID
  //     A single-instance exception carries RECURRENCE-ID identifying the master occurrence.
  //     A stale exception (lower seq on same RECURRENCE-ID) must still be rejected.
  // ---------------------------------------------------------------------------
  test("26. Recurring event: RECURRENCE-ID parsed; stale exception rejected; fresh exception accepted", () => {
    const masterUid = "recurring-master@example.invalid";

    // A recurring exception arriving at seq 1, RECURRENCE-ID identifies the specific occurrence.
    const exceptionIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${masterUid}`,
      "SEQUENCE:1",
      "RECURRENCE-ID;VALUE=DATE-TIME:20261105T090000Z",
      "DTSTART:20261105T100000Z",
      "DTEND:20261105T110000Z",
      "SUMMARY:Weekly Standup (Shifted)",
      "ORGANIZER:mailto:lead@example.invalid",
      "ATTENDEE:mailto:member@example.invalid",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(exceptionIcs);
    assert(parsed.events.length === 1, "Exception VEVENT parsed");
    const ev = parsed.events[0];
    assert(ev.uid === masterUid, "UID preserved from master");
    assert(ev.recurrenceId === "20261105T090000Z", `RECURRENCE-ID parsed: ${ev.recurrenceId}`);
    assert(ev.sequence === 1, "Exception sequence is 1");

    // Stale exception: same UID and RECURRENCE-ID but seq 0 < stored seq 1
    const storedAtSeq1 = { uid: masterUid, sequence: 1, organizer: { email: "lead@example.invalid" }, myRsvpStatus: "accepted" };
    const staleException = { ...ev, sequence: 0 };
    const rStale = verifyInvitationAuthenticity(staleException, storedAtSeq1, "ACCEPTED");
    assert(!rStale.valid, "Stale exception must be rejected");
    assert(rStale.isStale === true, "Must be flagged as stale revision");

    // Fresh exception: seq 2 > stored seq 1
    const freshException = { ...ev, sequence: 2 };
    const rFresh = verifyInvitationAuthenticity(freshException, storedAtSeq1, "ACCEPTED");
    assert(rFresh.valid, "Fresh exception at seq 2 > stored seq 1 must be accepted");
    assert(!rFresh.isStale, "Must not be stale");
  });

  // ---------------------------------------------------------------------------
  // 27. Organizer authorization: full pipeline simulation with stored organizer state
  //     Simulates what handleRsvpInvitation does: fetch existing, decrypt organizer,
  //     then call verifyInvitationAuthenticity with real existing-event context.
  //     This is an integration test of the security boundary at the helper level.
  // ---------------------------------------------------------------------------
  test("27. Organizer authorization: pipeline integration — stored organizer blocks hijack, correct organizer proceeds", () => {
    const uid = "auth-pipeline@example.invalid";
    const trustedOrg = { email: "trusted-chair@example.invalid" };

    // Simulated existing event as returned by decryptCalendarEventPayload
    const persistedDetails = {
      uid,
      sequence: 1,
      organizer: trustedOrg,
      myRsvpStatus: "needs-action",
    };

    const validUpdate = {
      uid,
      sequence: 2,
      summary: "Legit Update",
      startTime: new Date("2026-11-15T14:00:00Z"),
      endTime: new Date("2026-11-15T15:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED" as const,
      organizer: trustedOrg, // same trusted organizer
      attendees: [] as any[],
    };

    const hijackAttempt = {
      ...validUpdate,
      organizer: { email: "attacker@malicious.invalid" }, // different organizer
    };

    // Valid update from trusted organizer
    const rValid = verifyInvitationAuthenticity(validUpdate, persistedDetails, "ACCEPTED");
    assert(rValid.valid, "Trusted organizer update must be accepted");
    assert(!rValid.isOrganizerMismatch, "No mismatch for trusted organizer");

    // Hijack attempt from different organizer
    const rHijack = verifyInvitationAuthenticity(hijackAttempt, persistedDetails, "ACCEPTED");
    assert(!rHijack.valid, "Organizer hijack must be rejected");
    assert(rHijack.isOrganizerMismatch === true, "isOrganizerMismatch must be set");
    assert(rHijack.reason!.includes("attacker@malicious.invalid"), "Reason must name the offending organizer");
    assert(rHijack.reason!.includes("trusted-chair@example.invalid"), "Reason must name the trusted organizer");

    // Locked-mailbox simulation: no persisted details available (existingDetails = null)
    // When no existing event can be retrieved (mailbox locked), organizer verification
    // cannot be performed — handleRsvpInvitation fails closed by returning without
    // applying the RSVP. This test confirms the helper returns valid=true (no false reject)
    // but the caller remains responsible for blocking the action when mKey is absent.
    const rLockedMailbox = verifyInvitationAuthenticity(hijackAttempt, null, "ACCEPTED");
    assert(rLockedMailbox.valid, "Without existing state, helper cannot detect organizer mismatch");
    // This result is intentionally valid=true because the helper has no stored organizer to compare.
    // The calling function (handleRsvpInvitation) handles the locked-mailbox case by failing closed
    // before this helper result is acted upon — verified in the browser test locked-mailbox step.
  });


  test("generateIcs exports multi-component series with EXDATE and detached VEVENT exceptions", () => {
    const start = new Date("2026-10-05T10:00:00Z");
    const end = new Date("2026-10-05T11:00:00Z");
    const exdate = new Date("2026-10-12T10:00:00Z");

    const excRecurrenceId = new Date("2026-10-19T10:00:00Z");
    const excStart = new Date("2026-10-19T14:00:00Z");
    const excEnd = new Date("2026-10-19T15:00:00Z");

    const ics = generateIcs({
      uid: "series-uid-100",
      title: "Weekly Engineering Sync",
      startTime: start,
      endTime: end,
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
      exdates: [exdate],
      exceptions: [
        {
          recurrenceId: excRecurrenceId,
          startTime: excStart,
          endTime: excEnd,
          title: "Rescheduled Engineering Sync",
          status: "CONFIRMED",
        },
      ],
      organizer: { name: "Alice Lead", email: "alice@byos.local" },
    });

    assert(ics.includes("UID:series-uid-100"), "Must include UID");
    assert(ics.includes("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO"), "Must include RRULE");
    assert(ics.includes("EXDATE:20261012T100000Z"), "Must include EXDATE");
    assert(ics.includes("RECURRENCE-ID:20261019T100000Z"), "Must include RECURRENCE-ID for exception");
    assert(ics.includes("SUMMARY:Rescheduled Engineering Sync"), "Must include exception title");

    // Parse back
    const parsed = parseIcs(ics);
    assert(parsed.events.length === 2, `Expected 2 VEVENT components, got ${parsed.events.length}`);
    const { series } = groupSeriesEvents(parsed.events);
    assert(series.length === 1, "Expected 1 grouped series");
    assert(Boolean(series[0].master.rrule?.includes("WEEKLY")), "Master has RRULE");
    assert(series[0].cancelledRecurrenceIds.length >= 1, "Cancelled occurrence recorded");
    assert(series[0].exceptions.length === 1, "Detached exception recorded");
    assert(series[0].exceptions[0].summary === "Rescheduled Engineering Sync", "Exception summary preserved");
  });

  // -------------------------------------------------------------------------
  // Milestone 2: Time-zone and ICS Interoperability Tests
  // -------------------------------------------------------------------------

  test("VTIMEZONE parsing extracts standard and daylight definitions", () => {
    const icsWithTz = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Example Corp//EN",
      "BEGIN:VTIMEZONE",
      "TZID:America/New_York",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0400",
      "TZNAME:EDT",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "TZOFFSETFROM:-0400",
      "TZOFFSETTO:-0500",
      "TZNAME:EST",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:tz-parse-001",
      "DTSTART;TZID=America/New_York:20260715T100000",
      "DTEND;TZID=America/New_York:20260715T110000",
      "SUMMARY:Summer Standup",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(icsWithTz);
    assert(Boolean(parsed.timezones), "timezones object should be populated");
    assert("America/New_York" in parsed.timezones!, "America/New_York timezone definition present");

    const tzDef = parsed.timezones!["America/New_York"];
    assert(tzDef.tzid === "America/New_York", "TZID matches");
    assert(tzDef.subcomponents.length === 2, `Expected 2 subcomponents, got ${tzDef.subcomponents.length}`);

    const dst = tzDef.subcomponents.find((c) => c.type === "DAYLIGHT");
    const std = tzDef.subcomponents.find((c) => c.type === "STANDARD");
    assert(Boolean(dst), "DAYLIGHT subcomponent present");
    assert(Boolean(std), "STANDARD subcomponent present");
    assert(dst!.tzoffsetto === -240, `EDT offset should be -240 minutes, got ${dst!.tzoffsetto}`);
    assert(std!.tzoffsetto === -300, `EST offset should be -300 minutes, got ${std!.tzoffsetto}`);
    assert(dst!.tzname === "EDT", "EDT name matches");
    assert(std!.tzname === "EST", "EST name matches");

    assert(parsed.events.length === 1, "Event parsed");
    assert(parsed.events[0].timezone === "America/New_York", "Event timezone recorded");
    // 10:00 EDT (UTC-4) -> 14:00 UTC
    assert(parsed.events[0].startTime.toISOString() === "2026-07-15T14:00:00.000Z", "Start time converted to UTC accurately");
  });

  test("Daylight Saving Time (DST) transitions convert local times to accurate UTC timestamps across hemispheres", () => {
    // 1. US Eastern: Summer (EDT, UTC-4) vs Winter (EST, UTC-5)
    const edtDate = convertLocalToUtc(2026, 7, 15, 10, 0, 0, "America/New_York");
    assert(edtDate.toISOString() === "2026-07-15T14:00:00.000Z", `Expected 14:00Z for 10:00 EDT, got ${edtDate.toISOString()}`);

    const estDate = convertLocalToUtc(2026, 1, 15, 10, 0, 0, "America/New_York");
    assert(estDate.toISOString() === "2026-01-15T15:00:00.000Z", `Expected 15:00Z for 10:00 EST, got ${estDate.toISOString()}`);

    // 2. Europe/London: Summer (BST, UTC+1) vs Winter (GMT, UTC+0)
    const bstDate = convertLocalToUtc(2026, 7, 15, 10, 0, 0, "Europe/London");
    assert(bstDate.toISOString() === "2026-07-15T09:00:00.000Z", `Expected 09:00Z for 10:00 BST, got ${bstDate.toISOString()}`);

    const gmtDate = convertLocalToUtc(2026, 1, 15, 10, 0, 0, "Europe/London");
    assert(gmtDate.toISOString() === "2026-01-15T10:00:00.000Z", `Expected 10:00Z for 10:00 GMT, got ${gmtDate.toISOString()}`);

    // 3. Australia/Sydney (Southern Hemisphere): Summer in January (AEDT, UTC+11) vs Winter in July (AEST, UTC+10)
    const aedtDate = convertLocalToUtc(2026, 1, 15, 10, 0, 0, "Australia/Sydney");
    assert(aedtDate.toISOString() === "2026-01-14T23:00:00.000Z", `Expected 23:00Z prev day for 10:00 AEDT, got ${aedtDate.toISOString()}`);

    const aestDate = convertLocalToUtc(2026, 7, 15, 10, 0, 0, "Australia/Sydney");
    assert(aestDate.toISOString() === "2026-07-15T00:00:00.000Z", `Expected 00:00Z for 10:00 AEST, got ${aestDate.toISOString()}`);
  });

  test("Custom VTIMEZONE with non-IANA TZID converts local timestamps correctly", () => {
    const customTzIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:Enterprise/CentralOffice",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "TZOFFSETFROM:-0600",
      "TZOFFSETTO:-0500",
      "TZNAME:CDT",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0600",
      "TZNAME:CST",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:custom-tz-event-1",
      "DTSTART;TZID=Enterprise/CentralOffice:20260610T090000",
      "DTEND;TZID=Enterprise/CentralOffice:20260610T100000",
      "SUMMARY:Central Office Meeting",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(customTzIcs);
    assert(parsed.events.length === 1, "Parsed event with custom timezone");
    const ev = parsed.events[0];
    assert(ev.timezone === "Enterprise/CentralOffice", "Preserved custom TZID");
    // June 10 is inside Daylight Saving (CDT: UTC-5). 09:00 CDT -> 14:00 UTC.
    assert(ev.startTime.toISOString() === "2026-06-10T14:00:00.000Z", `Expected 14:00Z for 09:00 CDT, got ${ev.startTime.toISOString()}`);
  });

  test("Floating time events preserve floating representation without Z or TZID", () => {
    const floatingIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:floating-event-001",
      "DTSTART:20261025T083000",
      "DTEND:20261025T093000",
      "SUMMARY:Morning Yoga (Floating)",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(floatingIcs);
    assert(parsed.events.length === 1, "Parsed floating event");
    const ev = parsed.events[0];
    assert(ev.isFloating === true, "Marked as floating event");
    assert(ev.timezone === undefined, "Floating event has no timezone");

    // Export with isFloating: true
    const exported = generateIcs({
      uid: "floating-event-001",
      title: "Morning Yoga (Floating)",
      startTime: ev.startTime,
      endTime: ev.endTime,
      isFloating: true,
      organizer: { email: "yoga@byos.local" },
    });

    assert(exported.includes("DTSTART:20261025T083000\r\n"), "Exported DTSTART has no Z and no TZID");
    assert(exported.includes("DTEND:20261025T093000\r\n"), "Exported DTEND has no Z and no TZID");
    assert(!exported.includes("BEGIN:VTIMEZONE"), "Floating event does not emit VTIMEZONE");

    // Re-parse roundtrip
    const reParsed = parseIcs(exported);
    assert(reParsed.events.length === 1, "Re-parsed exported floating event");
    assert(reParsed.events[0].isFloating === true, "Re-parsed event remains floating");
  });

  test("All-day events format compliant non-inclusive DTEND and preserve all-day semantics", () => {
    // 1-day all-day event
    const start = new Date(Date.UTC(2026, 9, 25, 0, 0, 0));
    const end = new Date(Date.UTC(2026, 9, 25, 0, 0, 0));

    const ics1 = generateIcs({
      uid: "allday-1day-001",
      title: "Company Holiday",
      startTime: start,
      endTime: end,
      isAllDay: true,
      organizer: { email: "hr@byos.local" },
    });

    assert(ics1.includes("DTSTART;VALUE=DATE:20261025"), "DTSTART formatted as DATE value");
    // Non-inclusive RFC 5545 rule: 1-day all-day event ends next day (20261026)
    assert(ics1.includes("DTEND;VALUE=DATE:20261026"), "DTEND formatted as non-inclusive next day");

    const parsed1 = parseIcs(ics1);
    assert(parsed1.events[0].isAllDay === true, "Parsed event is all-day");

    // 3-day all-day conference (Oct 25 to Oct 27)
    const multiStart = new Date(Date.UTC(2026, 9, 25, 0, 0, 0));
    const multiEnd = new Date(Date.UTC(2026, 9, 28, 0, 0, 0)); // exclusive DTEND Oct 28
    const ics2 = generateIcs({
      uid: "allday-multiday-002",
      title: "Developer Summit",
      startTime: multiStart,
      endTime: multiEnd,
      isAllDay: true,
      organizer: { email: "events@byos.local" },
    });

    assert(ics2.includes("DTSTART;VALUE=DATE:20261025"), "Multi-day start date");
    assert(ics2.includes("DTEND;VALUE=DATE:20261028"), "Multi-day exclusive end date");

    const parsed2 = parseIcs(ics2);
    assert(parsed2.events[0].isAllDay === true, "Multi-day parsed as all-day");
  });

  test("generateVTimeZone emits compliant RFC 5545 VTIMEZONE block for various zones", () => {
    // US Eastern (DST with North America transition rules)
    const nyTz = generateVTimeZone("America/New_York").join("\r\n");
    assert(nyTz.includes("BEGIN:VTIMEZONE"), "Includes BEGIN:VTIMEZONE");
    assert(nyTz.includes("TZID:America/New_York"), "Includes TZID");
    assert(nyTz.includes("BEGIN:DAYLIGHT"), "Includes DAYLIGHT block");
    assert(nyTz.includes("BEGIN:STANDARD"), "Includes STANDARD block");
    assert(nyTz.includes("TZOFFSETTO:-0400"), "Includes EDT offset");
    assert(nyTz.includes("TZOFFSETTO:-0500"), "Includes EST offset");
    assert(nyTz.includes("END:VTIMEZONE"), "Includes END:VTIMEZONE");

    // Asia/Tokyo (No DST, single STANDARD block)
    const tokyoTz = generateVTimeZone("Asia/Tokyo").join("\r\n");
    assert(tokyoTz.includes("TZID:Asia/Tokyo"), "Includes Tokyo TZID");
    assert(tokyoTz.includes("BEGIN:STANDARD"), "Includes Tokyo STANDARD block");
    assert(!tokyoTz.includes("BEGIN:DAYLIGHT"), "Tokyo has no DAYLIGHT block");
    assert(tokyoTz.includes("TZOFFSETTO:+0900"), "Includes JST offset +0900");

    // Europe/London (DST with European transition rules)
    const londonTz = generateVTimeZone("Europe/London").join("\r\n");
    assert(londonTz.includes("TZID:Europe/London"), "Includes London TZID");
    assert(londonTz.includes("BEGIN:DAYLIGHT"), "Includes London DAYLIGHT block");
    assert(londonTz.includes("BEGIN:STANDARD"), "Includes London STANDARD block");
  });

  test("Full round-trip export and import with timezone, DST, and detached exceptions", () => {
    const masterStart = new Date("2026-10-05T14:00:00Z"); // 10:00 EDT
    const masterEnd = new Date("2026-10-05T15:00:00Z");   // 11:00 EDT
    const exdate = new Date("2026-10-12T14:00:00Z");

    const excRecurrenceId = new Date("2026-10-19T14:00:00Z");
    const excStart = new Date("2026-10-19T18:00:00Z");    // 14:00 EDT
    const excEnd = new Date("2026-10-19T19:00:00Z");      // 15:00 EDT

    const ics = generateIcs({
      uid: "tz-series-full-roundtrip-01",
      title: "Weekly Cross-Atlantic Sync",
      startTime: masterStart,
      endTime: masterEnd,
      timezone: "America/New_York",
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
      exdates: [exdate],
      exceptions: [
        {
          recurrenceId: excRecurrenceId,
          startTime: excStart,
          endTime: excEnd,
          title: "Cross-Atlantic Sync (Afternoon Session)",
          status: "CONFIRMED",
          timezone: "America/New_York",
        },
      ],
      organizer: { name: "Alice Lead", email: "alice@byos.local" },
      attendees: [{ name: "Bob Dev", email: "bob@byos.local" }],
    });

    // Verify VTIMEZONE block was emitted
    assert(ics.includes("BEGIN:VTIMEZONE"), "Emitted VTIMEZONE block");
    assert(ics.includes("TZID:America/New_York"), "Emitted America/New_York TZID");

    // Verify DTSTART;TZID was emitted with local time (10:00:00)
    assert(ics.includes("DTSTART;TZID=America/New_York:20261005T100000"), "Emitted local DTSTART with TZID");
    assert(ics.includes("DTEND;TZID=America/New_York:20261005T110000"), "Emitted local DTEND with TZID");

    // Verify EXDATE;TZID was emitted
    assert(ics.includes("EXDATE;TZID=America/New_York:20261012T100000"), "Emitted local EXDATE with TZID");

    // Verify RECURRENCE-ID;TZID was emitted for the detached exception
    assert(ics.includes("RECURRENCE-ID;TZID=America/New_York:20261019T100000"), "Emitted local RECURRENCE-ID with TZID");
    assert(ics.includes("DTSTART;TZID=America/New_York:20261019T140000"), "Emitted local detached exception start");

    // Parse back
    const parsed = parseIcs(ics);
    assert(parsed.events.length === 2, `Expected 2 events parsed, got ${parsed.events.length}`);

    const master = parsed.events.find((e) => !e.recurrenceId);
    const exc = parsed.events.find((e) => Boolean(e.recurrenceId));

    assert(Boolean(master), "Master event found");
    assert(Boolean(exc), "Detached exception found");

    // Master UTC converted accurately: 10:00 EDT -> 14:00 UTC
    assert(master!.startTime.toISOString() === "2026-10-05T14:00:00.000Z", "Master start converted to exact UTC point");
    assert(master!.endTime.toISOString() === "2026-10-05T15:00:00.000Z", "Master end converted to exact UTC point");
    assert(master!.timezone === "America/New_York", "Master timezone preserved");

    // Detached exception UTC converted accurately: 14:00 EDT -> 18:00 UTC
    assert(exc!.startTime.toISOString() === "2026-10-19T18:00:00.000Z", "Exception start converted to exact UTC point");
    assert(exc!.summary === "Cross-Atlantic Sync (Afternoon Session)", "Exception summary preserved");

    // Grouping series
    const { series } = groupSeriesEvents(parsed.events);
    assert(series.length === 1, "Series grouped successfully");
    assert(series[0].exceptions.length === 1, "Detached exception attached to series");
    assert(series[0].cancelledRecurrenceIds.length >= 1, "EXDATE parsed into cancelledRecurrenceIds");
  });

  return { passed, failed };
}
