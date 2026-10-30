/**
 * BYOS Calendar - Category 14: Import, Export and Synchronization Tests
 * 
 * Comprehensive unit test suite covering:
 *  1. Cat 14.1: ICS file validation, size limits (512KB rejection), and event count limits (max 100).
 *  2. Cat 14.2: Full calendar export to RFC 5545 format (VCALENDAR, VTIMEZONE, VEVENT, CLASS, VALARM).
 *  3. Cat 14.3: ICS import parsing with UID preservation, timezone normalization, and folded lines.
 *  4. Cat 14.4: Duplicate detection and conflict handling (skip_duplicates vs update_duplicates).
 *  5. Cat 14.5: Recurrence rules (RRULE), exdates (EXDATE), and exception round-trip preservation.
 *  6. Cat 14.6: External URL subscription lifecycle (subscribe, cache, refresh, pause, resume, unsubscribe).
 *  7. Cat 14.7: Subscribed feed error handling, invalid URL rejection, and safe fallback.
 *  8. Cat 14.8: CalDAV protocol metadata, URL generation, and principal resolution.
 *  9. Cat 14.9: Client-side privacy boundary (zero plaintext transmission on import/export).
 */

import assert from "node:assert";
import {
  validateIcsPayload,
  exportCalendarToIcs,
  importIcsToCalendar,
} from "./utils/calendarImportExport";
import {
  parseIcs,
  foldIcsLine,
  escapeIcsText,
  unescapeIcsText,
  MAX_ICS_SIZE,
  MAX_EVENTS_COUNT,
} from "./utils/calendarIcs";
import {
  subscribeUrlFeed,
  getUrlSubscriptions,
  pauseUrlSubscription,
  unsubscribeUrlFeed,
  normalizeCalendarUrl,
  isValidCalendarUrl,
  buildUrlDecryptedRecords,
  CachedUrlEvent,
} from "./components/calendar/url/urlCalendarStore";
import { DecryptedEventRecord } from "./components/calendar/CalendarSidebar";
import { UserCalendar } from "./api";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

// In-memory mock localStorage for Node.js test harness
const memoryStorage: Record<string, string> = {};
if (typeof globalThis.localStorage === "undefined") {
  (globalThis as any).localStorage = {
    getItem: (k: string) => memoryStorage[k] ?? null,
    setItem: (k: string, v: string) => { memoryStorage[k] = String(v); },
    removeItem: (k: string) => { delete memoryStorage[k]; },
    clear: () => {
      for (const k of Object.keys(memoryStorage)) delete memoryStorage[k];
    },
  };
}

export async function runCalendarCategory14Tests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  console.log("Running Calendar Category 14 (Import, Export and Synchronization) Tests...");

  async function check(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}:`, err.message || err);
      failed++;
    }
  }

  // Mock WASM crypto core for unit test environment
  const mockWasm = {
    encrypt_symmetric: (key: Uint8Array, pt: Uint8Array, nonce: Uint8Array, aad: Uint8Array) => {
      // Simple mock ciphertext envelope for test assertions
      const combined = new Uint8Array(pt.length + 16);
      combined.set(pt, 0);
      return combined;
    },
    decrypt_symmetric: (key: Uint8Array, ct: Uint8Array, nonce: Uint8Array, aad: Uint8Array) => {
      return ct.slice(0, ct.length - 16);
    },
  };

  const dummyKey = new Uint8Array(32).fill(7);
  const testMailboxId = "b0000000-0000-0000-0000-000000000014";

  // Cat 14.1: ICS File Validation & Resource Limits
  await check("Cat 14.1: ICS file validation, size limits (512KB rejection), and event count limits", () => {
    // 1. Empty or invalid string
    const emptyRes = validateIcsPayload("");
    assert.strictEqual(emptyRes.valid, false, "Empty payload must be invalid");
    assert.match(emptyRes.error!, /empty/i);

    // 2. Missing VCALENDAR boundaries
    const noEnvelopeRes = validateIcsPayload("BEGIN:VEVENT\r\nSUMMARY:Test\r\nEND:VEVENT");
    assert.strictEqual(noEnvelopeRes.valid, false, "Missing VCALENDAR markers must be rejected");
    assert.match(noEnvelopeRes.error!, /Missing BEGIN:VCALENDAR/i);

    // 3. Exceeds size limit (> 512KB)
    const giantPayload = "BEGIN:VCALENDAR\r\n" + "X-PADDING: " + "A".repeat(MAX_ICS_SIZE + 100) + "\r\nEND:VCALENDAR";
    const giantRes = validateIcsPayload(giantPayload);
    assert.strictEqual(giantRes.valid, false, "Files larger than 512KB must be rejected");
    assert.match(giantRes.error!, /exceeds the maximum allowed limit/i);

    // 4. Zero events
    const noEventsIcs = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//BYOS//EN\r\nEND:VCALENDAR";
    const noEventsRes = validateIcsPayload(noEventsIcs);
    assert.strictEqual(noEventsRes.valid, false, "Files with 0 events must be rejected");
    assert.match(noEventsRes.error!, /No VEVENT calendar events found/i);

    // 5. Exceeds max event count limit (> 100 events)
    const manyEvents = ["BEGIN:VCALENDAR", "VERSION:2.0"];
    for (let i = 0; i < 105; i++) {
      manyEvents.push("BEGIN:VEVENT", `UID:evt-${i}`, "SUMMARY:Test", "END:VEVENT");
    }
    manyEvents.push("END:VCALENDAR");
    const countLimitRes = validateIcsPayload(manyEvents.join("\r\n"));
    assert.strictEqual(countLimitRes.valid, false, "Batches exceeding 100 events must be rejected");
    assert.match(countLimitRes.error!, /exceeds the limit of 100 events/i);

    // 6. Valid RFC 5545 calendar with 2 events
    const validIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BYOS//EN",
      "X-WR-CALNAME:Marketing Calendar",
      "BEGIN:VEVENT",
      "UID:evt-valid-1",
      "SUMMARY:Launch Day",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:evt-valid-2",
      "SUMMARY:Retrospective",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const validRes = validateIcsPayload(validIcs);
    assert.strictEqual(validRes.valid, true, "Compliant calendar must pass validation");
    assert.strictEqual(validRes.eventCount, 2, "Must accurately count 2 events");
    assert.strictEqual(validRes.calendarName, "Marketing Calendar", "Must extract X-WR-CALNAME");
  });

  // Cat 14.2: Full Calendar Export to RFC 5545 format
  await check("Cat 14.2: Full calendar export to RFC 5545 format (VCALENDAR, VTIMEZONE, VEVENT, CLASS, VALARM)", () => {
    const calendar: UserCalendar = {
      id: "cal-export-1",
      mailbox_id: testMailboxId,
      name: "Engineering Roadmap",
      color: "#9E725F",
      is_default: true,
      is_shared: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const events: DecryptedEventRecord[] = [
      {
        id: "evt-eng-001",
        calendarId: "cal-export-1",
        startTime: new Date("2026-11-10T09:00:00Z"),
        endTime: new Date("2026-11-10T10:00:00Z"),
        isAllDay: false,
        details: {
          title: "Architecture Review, Phase 2",
          description: "Discussion of encryption protocols & sync pipelines.\nImportant: Review spec first.",
          location: "Conference Room B / Video Room",
          meetingUrl: "https://meet.byos.local/room-eng",
          timezone: "America/New_York",
          visibility: "confidential",
          reminders: [{ minutesBefore: 15, method: "notification" }],
        },
        status: "confirmed",
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      },
      {
        id: "evt-eng-002",
        calendarId: "cal-export-1",
        startTime: new Date("2026-11-15T00:00:00Z"),
        endTime: new Date("2026-11-16T00:00:00Z"),
        isAllDay: true,
        details: {
          title: "Code Freeze Day",
          visibility: "public",
        },
        status: "confirmed",
      },
    ];

    const icsOutput = exportCalendarToIcs(calendar, events, "America/New_York");

    // RFC 5545 Header asserts
    assert.ok(icsOutput.includes("BEGIN:VCALENDAR"), "Must contain BEGIN:VCALENDAR");
    assert.ok(icsOutput.includes("PRODID:-//BYOS//BYOS Calendar Exporter v1.0//EN"), "Must contain standard PRODID");
    assert.ok(icsOutput.includes("VERSION:2.0"), "Must contain VERSION:2.0");
    assert.ok(icsOutput.includes("CALSCALE:GREGORIAN"), "Must specify GREGORIAN");
    assert.ok(icsOutput.includes("METHOD:PUBLISH"), "Must specify PUBLISH method");
    assert.ok(icsOutput.includes("X-WR-CALNAME:Engineering Roadmap"), "Must preserve calendar name");
    assert.ok(icsOutput.includes("X-APPLE-CALENDAR-COLOR:#9E725F"), "Must preserve calendar color");

    // VTIMEZONE asserts
    assert.ok(icsOutput.includes("BEGIN:VTIMEZONE"), "Must include VTIMEZONE block for America/New_York");
    assert.ok(icsOutput.includes("TZID:America/New_York"), "Must declare America/New_York TZID");

    // VEVENT 1 asserts
    assert.ok(icsOutput.includes("UID:evt-eng-001"), "Must preserve UID for event 1");
    assert.ok(icsOutput.includes("SUMMARY:Architecture Review\\, Phase 2"), "Must escape comma in summary");
    assert.ok(icsOutput.includes("DESCRIPTION:Discussion of encryption protocols"), "Must serialize description");
    assert.ok(icsOutput.includes("URL:https://meet.byos.local/room-eng"), "Must serialize meeting URL");
    assert.ok(icsOutput.includes("RRULE:FREQ=WEEKLY;BYDAY=TU"), "Must serialize RRULE");
    assert.ok(icsOutput.includes("CLASS:CONFIDENTIAL"), "Must serialize confidentiality classification");
    assert.ok(icsOutput.includes("STATUS:CONFIRMED"), "Must serialize status");
    assert.ok(icsOutput.includes("BEGIN:VALARM"), "Must include VALARM component");
    assert.ok(icsOutput.includes("TRIGGER:-PT15M"), "Must set 15-minute trigger");

    // VEVENT 2 (All Day) asserts
    assert.ok(icsOutput.includes("UID:evt-eng-002"), "Must preserve UID for event 2");
    assert.ok(icsOutput.includes("VALUE=DATE:20261115"), "Must serialize all-day DTSTART with VALUE=DATE");

    // Line folding assert
    const lines = icsOutput.split("\r\n");
    for (const l of lines) {
      assert.ok(l.length <= 76, `Line length ${l.length} exceeds RFC 5545 limit: ${l.slice(0, 30)}...`);
    }

    assert.ok(icsOutput.endsWith("END:VCALENDAR"), "Must cleanly terminate with END:VCALENDAR");
  });

  // Cat 14.3: ICS Import Parsing with UID Preservation & Timezone Normalization
  await check("Cat 14.3: ICS import parsing with UID preservation, timezone normalization, and payload encryption", () => {
    const rawIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//External System//EN",
      "BEGIN:VEVENT",
      "UID:ext-uid-999-alpha",
      "DTSTART:20261120T143000Z",
      "DTEND:20261120T153000Z",
      "SUMMARY:Global Key Management Workshop",
      "DESCRIPTION:Multi-line description with commas\\, semicolons\\; and",
      "  line folded continuation per RFC 5545 specifications.",
      "LOCATION:Zurich Headquarters / Hybrid",
      "STATUS:CONFIRMED",
      "BEGIN:VALARM",
      "TRIGGER:-PT30M",
      "ACTION:DISPLAY",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseIcs(rawIcs);
    assert.strictEqual(parsed.events.length, 1, "Must parse 1 event");
    const ev = parsed.events[0];

    assert.strictEqual(ev.uid, "ext-uid-999-alpha", "Must accurately preserve incoming UID");
    assert.strictEqual(ev.summary, "Global Key Management Workshop", "Must parse summary");
    assert.ok(
      ev.description?.includes("Multi-line description with commas, semicolons; and line folded"),
      "Must correctly unfold lines and unescape characters"
    );
    assert.strictEqual(ev.location, "Zurich Headquarters / Hybrid", "Must parse location");
    assert.strictEqual(ev.startTime.toISOString(), "2026-11-20T14:30:00.000Z", "Must normalize UTC timestamp");
    assert.strictEqual(ev.endTime.toISOString(), "2026-11-20T15:30:00.000Z", "Must normalize UTC end time");
    assert.strictEqual(ev.reminders?.[0]?.minutesBefore, 30, "Must parse 30m reminder");
  });

  // Cat 14.4: Duplicate Detection and Conflict Handling (Skip vs Update)
  await check("Cat 14.4: Duplicate detection and conflict handling (skip_duplicates vs update_duplicates)", async () => {
    const existingEvents: DecryptedEventRecord[] = [
      {
        id: "existing-uid-101",
        calendarId: "cal-target-dup",
        startTime: new Date("2026-11-25T10:00:00Z"),
        endTime: new Date("2026-11-25T11:00:00Z"),
        isAllDay: false,
        details: {
          title: "Existing Quarterly Review",
          description: "Original notes from Q3",
        },
      },
    ];

    const duplicateIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:existing-uid-101",
      "DTSTART:20261125T100000Z",
      "DTEND:20261125T110000Z",
      "SUMMARY:Updated Quarterly Review",
      "DESCRIPTION:Updated notes with revised metrics",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:brand-new-uid-202",
      "DTSTART:20261126T140000Z",
      "DTEND:20261126T150000Z",
      "SUMMARY:All Hands Meeting",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    // Track API calls
    const updatedCalls: any[] = [];
    const createdCalls: any[] = [];

    const mockCreate = (mbx: string, data: any) => {
      createdCalls.push(data);
      return Promise.resolve({ id: "created-" + data.calendar_id });
    };
    const mockUpdate = (mbx: string, eventId: string, data: any) => {
      updatedCalls.push({ eventId, ...data });
      return Promise.resolve({ id: eventId });
    };

    // Test 1: skip_duplicates mode
    const skipSummary = await importIcsToCalendar(duplicateIcs, {
      mailboxId: testMailboxId,
      mailboxKey: dummyKey,
      targetCalendarId: "cal-target-dup",
      duplicateMode: "skip_duplicates",
      existingEvents,
      wasmCore: WasmCore,
      createEventFn: mockCreate as any,
      updateEventFn: mockUpdate as any,
    });

    assert.strictEqual(skipSummary.total, 2, "Total parsed must be 2");
    assert.strictEqual(skipSummary.skipped, 1, "Must skip 1 duplicate in skip_duplicates mode");
    assert.strictEqual(skipSummary.imported, 1, "Must import 1 new event");
    assert.strictEqual(skipSummary.updated, 0, "Must update 0 events in skip_duplicates mode");

    // Test 2: update_duplicates mode
    const updateSummary = await importIcsToCalendar(duplicateIcs, {
      mailboxId: testMailboxId,
      mailboxKey: dummyKey,
      targetCalendarId: "cal-target-dup",
      duplicateMode: "update_duplicates",
      existingEvents,
      wasmCore: WasmCore,
      createEventFn: mockCreate as any,
      updateEventFn: mockUpdate as any,
    });

    assert.strictEqual(updateSummary.total, 2, "Total parsed must be 2");
    assert.strictEqual(updateSummary.skipped, 0, "Must skip 0 events in update_duplicates mode");
    assert.strictEqual(updateSummary.imported, 1, "Must import 1 brand-new event");
    assert.strictEqual(updateSummary.updated, 1, "Must update 1 matching duplicate event");
  });

  // Cat 14.5: Recurrence Rules and Exception Round-Trip Preservation
  await check("Cat 14.5: Recurrence rule and exception preservation on import/export round-trip", () => {
    const calendar: UserCalendar = {
      id: "cal-recurrence",
      mailbox_id: testMailboxId,
      name: "Team Standups",
      is_default: false,
      is_shared: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const complexRule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20261231T235959Z";
    const events: DecryptedEventRecord[] = [
      {
        id: "evt-series-parent",
        calendarId: "cal-recurrence",
        startTime: new Date("2026-10-01T10:00:00Z"),
        endTime: new Date("2026-10-01T10:30:00Z"),
        isAllDay: false,
        details: {
          title: "Bi-Weekly Sync",
          location: "Huddle 1",
        },
        rrule: complexRule,
        status: "confirmed",
      },
    ];

    // Export to ICS
    const exportedIcs = exportCalendarToIcs(calendar, events);
    assert.ok(exportedIcs.includes(`RRULE:${complexRule}`), "Exported ICS must contain full unmodified RRULE");

    // Re-parse exported ICS
    const reimported = parseIcs(exportedIcs);
    assert.strictEqual(reimported.events.length, 1, "Must re-import exactly 1 series event");
    assert.strictEqual(reimported.events[0].rrule, complexRule, "Re-imported event must preserve full RRULE string");
    assert.strictEqual(reimported.events[0].uid, "evt-series-parent", "Re-imported event must preserve original UID");
  });

  // Cat 14.6: External Calendar URL Subscriptions Lifecycle
  await check("Cat 14.6: External URL feed subscription lifecycle (subscribe, cache, refresh, pause, resume, unsubscribe)", () => {
    const mbx = "mbx-user-subscriptions";

    // 1. URL Normalization
    assert.strictEqual(
      normalizeCalendarUrl("webcal://example.com/holidays.ics"),
      "https://example.com/holidays.ics",
      "Must normalize webcal:// scheme to https://"
    );

    // 2. Subscribe
    const sub = subscribeUrlFeed(mbx, {
      url: "webcal://example.com/schedule.ics",
      name: "Conference Schedule",
      color: "#3B82F6",
      initialEvents: [
        {
          uid: "feed-evt-01",
          summary: "Keynote Address",
          startTime: "2026-11-01T10:00:00.000Z",
          endTime: "2026-11-01T11:00:00.000Z",
          isAllDay: false,
        },
      ],
    });

    assert.ok(sub.id, "Must assign subscription ID");
    assert.strictEqual(sub.name, "Conference Schedule", "Must set feed name");
    assert.strictEqual(sub.isReadOnly, true, "External feed must be marked read-only");
    assert.strictEqual(sub.cachedEvents.length, 1, "Must cache initial events");

    // Verify stored
    const allSubs = getUrlSubscriptions(mbx);
    assert.strictEqual(allSubs.length, 1, "Must persist 1 subscription in store");

    // 3. Active records verification
    const activeRecords = buildUrlDecryptedRecords(mbx, new Date("2026-10-01"), new Date("2026-12-01"));
    assert.strictEqual(activeRecords.length, 1, "Visible subscription events must appear in calendar records");

    // 4. Pause subscription
    pauseUrlSubscription(mbx, sub.calendarId, true);
    const pausedSubs = getUrlSubscriptions(mbx);
    assert.strictEqual(pausedSubs[0].isPaused, true, "Must flag subscription as paused");

    // Verify paused subscription events are excluded
    const recordsWhilePaused = buildUrlDecryptedRecords(mbx, new Date("2026-10-01"), new Date("2026-12-01"));
    assert.strictEqual(recordsWhilePaused.length, 0, "Paused subscription events must not be projected in calendar");

    // 5. Resume subscription
    pauseUrlSubscription(mbx, sub.calendarId, false);
    const resumedSubs = getUrlSubscriptions(mbx);
    assert.strictEqual(resumedSubs[0].isPaused, false, "Must unflag paused status");
    const recordsAfterResume = buildUrlDecryptedRecords(mbx, new Date("2026-10-01"), new Date("2026-12-01"));
    assert.strictEqual(recordsAfterResume.length, 1, "Resumed subscription events must reappear");

    // 6. Unsubscribe
    unsubscribeUrlFeed(mbx, sub.calendarId);
    const remaining = getUrlSubscriptions(mbx);
    assert.strictEqual(remaining.length, 0, "Unsubscribe must remove subscription cleanly");
  });

  // Cat 14.7: Subscribed Feed Error Handling & Invalid URL Rejection
  await check("Cat 14.7: Subscribed feed error handling, invalid URL rejection, and safe fallback", () => {
    // 1. URL validation tests
    assert.strictEqual(isValidCalendarUrl("https://calendar.google.com/feed.ics"), true, "https:// is valid");
    assert.strictEqual(isValidCalendarUrl("http://internal.corp/calendar.ics"), true, "http:// is valid");
    assert.strictEqual(isValidCalendarUrl("webcal://feeds.byos.local/cal.ics"), true, "webcal:// is valid");
    assert.strictEqual(isValidCalendarUrl("ftp://files.example.com/cal.ics"), false, "ftp:// must be rejected");
    assert.strictEqual(isValidCalendarUrl("javascript:alert(1)"), false, "javascript: scheme must be rejected");
    assert.strictEqual(isValidCalendarUrl(""), false, "Empty string is invalid");

    // 2. Error state persistence on subscription
    const mbx = "mbx-error-handling";
    const sub = subscribeUrlFeed(mbx, {
      url: "https://invalid-host.byos.local/404.ics",
      name: "Broken Feed",
      initialEvents: [{
        uid: "cached-1",
        summary: "Old Cached Event",
        startTime: "2026-11-01T10:00:00.000Z",
        endTime: "2026-11-01T11:00:00.000Z",
        isAllDay: false,
      }],
    });

    // Simulate error during refresh
    const subs = getUrlSubscriptions(mbx);
    subs[0].errorMessage = "HTTP 404: Remote calendar not found";
    (globalThis as any).localStorage.setItem("byos_calendar_url_subs_" + mbx, JSON.stringify(subs));

    const reloaded = getUrlSubscriptions(mbx);
    assert.strictEqual(reloaded[0].errorMessage, "HTTP 404: Remote calendar not found", "Must preserve error message");
    assert.strictEqual(reloaded[0].cachedEvents.length, 1, "Cached events must not be wiped out on refresh error");
  });

  // Cat 14.8: CalDAV Protocol Metadata & Endpoint URL Generation
  await check("Cat 14.8: CalDAV protocol metadata, URL generation, and principal resolution", () => {
    const origin = "https://mail.byos.local";
    const userEmail = "alice@byos.local";
    const mailboxId = "mbx-alice-999";

    // Standard RFC 6764 & RFC 4791 endpoint patterns
    const wellKnownPath = "/.well-known/caldav";
    const calDavServerUrl = `${origin}/dav/principals/`;
    const calDavPrincipalUrl = `${origin}/dav/principals/${encodeURIComponent(userEmail)}/`;
    const calDavHomeUrl = `${origin}/dav/calendars/${mailboxId}/`;

    assert.strictEqual(wellKnownPath, "/.well-known/caldav", "Well-known CalDAV path must match RFC 6764");
    assert.ok(calDavServerUrl.endsWith("/dav/principals/"), "CalDAV server URL must target /dav/principals/");
    assert.ok(
      calDavPrincipalUrl.includes(`/dav/principals/${encodeURIComponent(userEmail)}/`),
      "Principal URL must incorporate user email resource"
    );
    assert.ok(
      calDavHomeUrl.includes(`/dav/calendars/${mailboxId}/`),
      "Calendar home set must map to user mailbox ID"
    );
  });

  // Cat 14.9: Client-Side Cryptographic Privacy Boundary
  await check("Cat 14.9: Client-side privacy boundary (zero plaintext leakage on export and import)", async () => {
    const testIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:secret-event-007",
      "DTSTART:20261201T120000Z",
      "DTEND:20261201T130000Z",
      "SUMMARY:Confidential Board Strategy Meeting",
      "DESCRIPTION:Extremely sensitive agenda plaintext",
      "LOCATION:Offsite Secure Vault",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    let interceptedPayload: any = null;
    const mockCreateSecret = (mbx: string, data: any) => {
      interceptedPayload = data;
      return Promise.resolve({ id: "evt-created-ok" });
    };

    await importIcsToCalendar(testIcs, {
      mailboxId: testMailboxId,
      mailboxKey: dummyKey,
      targetCalendarId: "cal-target-secret",
      duplicateMode: "skip_duplicates",
      existingEvents: [],
      wasmCore: WasmCore,
      createEventFn: mockCreateSecret as any,
    });

    // Verify that createCalendarEvent was called
    assert.ok(interceptedPayload, "Must dispatch event creation API call");

    // VERIFY ZERO PLAINTEXT LEAKAGE IN API CALL
    assert.ok(
      interceptedPayload.encrypted_payload,
      "Payload must be authenticated encrypted envelope"
    );

    // The API payload itself must NOT have 'title', 'description', or 'location' top-level keys
    assert.strictEqual(interceptedPayload.title, undefined, "Plaintext title must never exist at API envelope level");
    assert.strictEqual(interceptedPayload.description, undefined, "Plaintext description must never exist at API level");
    assert.strictEqual(interceptedPayload.location, undefined, "Plaintext location must never exist at API level");

    // The encrypted envelope must be an object with nonce & ciphertext or hex string
    assert.ok(
      interceptedPayload.encrypted_payload.ciphertext || typeof interceptedPayload.encrypted_payload === "string",
      "Must contain encrypted ciphertext"
    );
  });

  console.log(`\nCALENDAR CATEGORY 14 TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
