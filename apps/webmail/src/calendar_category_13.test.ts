/**
 * BYOS Calendar - Category 13: Email and External Integrations Tests
 * 
 * Comprehensive unit test suite covering:
 *  1. Flight reservation extraction (airline, flight #, route, departure/arrival times, PNR).
 *  2. Hotel booking extraction (property name, check-in/out, address, confirmation #).
 *  3. Restaurant reservation extraction (dining venue, party size, date/time, confirmation).
 *  4. Ticket & Webinar registration extraction (venue, seat, order #, join URL).
 *  5. Cancellation email detection and status flagging.
 *  6. Client-side privacy boundary & individual category disable toggles.
 *  7. Suggestion store, deduplication, dismiss lifecycle, and email-to-calendar linking.
 *  8. Video-conferencing URL generation (BYOS Secure Room, Jitsi, Custom template).
 *  9. Contacts birthday extraction and annual recurring calendar event projection.
 */

import assert from "node:assert";
import {
  extractEventFromEmail,
  DetectedEmailEvent,
  EmailExtractionOptions,
} from "./utils/calendarEmailExtractor";
import {
  getIntegrationSettings,
  saveIntegrationSettings,
  getDismissedSuggestionIds,
  dismissSuggestion,
  getLinkedEmailEvents,
  linkEmailToCalendarEvent,
  unlinkEmailEvent,
  generateVideoMeetingUrl,
  DEFAULT_INTEGRATIONS_SETTINGS,
} from "./components/calendar/integrations/calendarIntegrationsStore";
import {
  extractBirthdayFromContact,
  generateContactBirthdayEvents,
} from "./utils/calendarContactsIntegration";
import { ContactItem } from "./api";

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

export async function runCalendarCategory13Tests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  console.log("Running Calendar Category 13 (Email and External Integrations) Tests...");

  function check(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ✗ ${name}: ${e?.message || e}`);
      failed++;
    }
  }

  // 1. Flight extraction
  check("Cat 13.1: Flight reservation extraction", () => {
    const email = {
      id: "msg_flight_01",
      subject: "Your flight confirmation - AA 1234 to San Francisco",
      body: `Thank you for booking with American Airlines.
Flight: AA1234
From: New York (JFK) to San Francisco (SFO)
Date: October 30, 2026 at 08:30 AM
Confirmation / Record Locator: ABC999
We look forward to welcoming you onboard.`,
    };

    const event = extractEventFromEmail(email);
    assert(event !== null, "Flight event should be detected");
    assert(event?.category === "flight", "Category should be flight");
    assert(event?.confirmationCode === "ABC999", `PNR code should be ABC999, got ${event?.confirmationCode}`);
    assert(event?.location?.includes("JFK") && event?.location?.includes("SFO"), "Location should include route");
    assert(event?.provider === "American Airlines", `Provider should be American Airlines, got ${event?.provider}`);
    assert(event?.confidence === "high", "Confidence should be high for flight with PNR");
    assert(!event?.isCancellation, "Should not be marked as cancellation");
  });

  // 2. Hotel extraction
  check("Cat 13.2: Hotel booking extraction", () => {
    const email = {
      id: "msg_hotel_01",
      subject: "Reservation Confirmation: Hyatt Regency San Francisco",
      body: `Dear Guest,
Thank you for choosing Hyatt.
Property Location: 5 Embarcadero Center, San Francisco, CA 94111
Check-in: 2026-11-05
Check-out: 2026-11-08
Confirmation Number: HY-87654321
Room: Deluxe King with Bay View.`,
    };

    const event = extractEventFromEmail(email);
    assert(event !== null, "Hotel event should be detected");
    assert(event?.category === "hotel", "Category should be hotel");
    assert(event?.confirmationCode === "HY-87654321", `Confirmation should be HY-87654321, got ${event?.confirmationCode}`);
    assert(event?.location?.includes("Embarcadero Center"), "Location should contain address");
    assert(event?.provider === "Hyatt", `Provider should be Hyatt, got ${event?.provider}`);
    assert(!event?.isCancellation, "Should not be marked as cancellation");
  });

  // 3. Restaurant extraction
  check("Cat 13.3: Restaurant dining reservation extraction", () => {
    const email = {
      id: "msg_rest_01",
      subject: "OpenTable Reservation Confirmation: The French Laundry",
      body: `Your table is booked!
Restaurant: The French Laundry on 2026-11-12
Time: 19:30
Party of 4
Confirmation: OT-5544
We look forward to serving you.`,
    };

    const event = extractEventFromEmail(email);
    assert(event !== null, "Restaurant event should be detected");
    assert(event?.category === "restaurant", "Category should be restaurant");
    assert(event?.confirmationCode === "OT-5544", `Confirmation should be OT-5544, got ${event?.confirmationCode}`);
    assert(event?.title.includes("The French Laundry"), "Title should include restaurant name");
    assert(event?.title.includes("Table for 4"), "Title should indicate party size");
  });

  // 4. Ticket & Webinar extraction
  check("Cat 13.4: Ticket and Webinar event extraction", () => {
    // Ticket
    const ticketEmail = {
      id: "msg_ticket_01",
      subject: "Eventbrite: Zero-Knowledge Cryptography Summit Tickets",
      body: `Here are your admission tickets for ZK Summit 2026.
Venue: Moscone West Center, San Francisco
Date: 2026-11-20
Time: 09:00 AM
Order #: EVT-998877
Please show this barcode at the door.`,
    };
    const ticketEvent = extractEventFromEmail(ticketEmail);
    assert(ticketEvent !== null, "Ticket should be detected");
    assert(ticketEvent?.category === "ticket", "Category should be ticket");
    assert(ticketEvent?.confirmationCode === "EVT-998877", "Ticket order number should match");

    // Webinar
    const webinarEmail = {
      id: "msg_webinar_01",
      subject: "Confirmation: Privacy Architecture Online Workshop",
      body: `You are registered for Privacy Architecture Workshop.
Date: 2026-11-25
Time: 14:00
Join URL: https://byos.zoom.us/j/9876543210
Webinar ID: 9876543210`,
    };
    const webinarEvent = extractEventFromEmail(webinarEmail);
    assert(webinarEvent !== null, "Webinar should be detected");
    assert(webinarEvent?.category === "event", "Category should be event");
    assert(webinarEvent?.meetingUrl === "https://byos.zoom.us/j/9876543210", "Meeting URL should be extracted");
  });

  // 5. Cancellation detection
  check("Cat 13.5: Cancellation email detection and status flagging", () => {
    const cancelledEmail = {
      id: "msg_cancel_01",
      subject: "Cancellation Notice: Flight AA1234",
      body: `Important: Your reservation has been cancelled.
Flight: AA1234
From: New York (JFK) to San Francisco (SFO)
Confirmation: ABC999
A refund has been initiated.`,
    };

    const event = extractEventFromEmail(cancelledEmail);
    assert(event !== null, "Event should still be extracted to allow updating/removing calendar event");
    assert(event?.isCancellation === true, "isCancellation flag must be true");
    assert(event?.title.startsWith("[CANCELLED]"), `Title should have [CANCELLED] prefix, got: ${event?.title}`);
  });

  // 6. Privacy boundary & disable toggles
  check("Cat 13.6: Client-side privacy boundary and individual category disable toggles", () => {
    const email = {
      id: "msg_disabled_test",
      subject: "Flight Confirmation: UA 456",
      body: "Flight: UA456 from ORD to LAX on 2026-12-01 with United Airlines. PNR: UAA123",
    };

    // Disabled globally
    const disabledGlobal = extractEventFromEmail(email, { enabled: false });
    assert(disabledGlobal === null, "Extraction must fail-closed when enabled is false");

    // Flights disabled specifically
    const disabledFlights = extractEventFromEmail(email, {
      enabled: true,
      categories: { flights: false, hotels: true },
    });
    assert(disabledFlights === null, "Flight extraction must be suppressed when flights category is disabled");

    // Flights enabled
    const enabledFlights = extractEventFromEmail(email, {
      enabled: true,
      categories: { flights: true, hotels: false },
    });
    assert(enabledFlights !== null, "Flight extraction should succeed when flights category is enabled");
  });

  // 7. Store, deduplication & link lifecycle
  check("Cat 13.7: Suggestion store, deduplication, and email-to-calendar linking", () => {
    const testBoxId = "test_box_cat13";

    // Clear test keys
    localStorage.removeItem(`byos_calendar_dismissed_suggestions_${testBoxId}`);
    localStorage.removeItem(`byos_calendar_linked_email_events_${testBoxId}`);

    // Verify dismissed list
    assert(getDismissedSuggestionIds(testBoxId).length === 0, "Initial dismissed list should be empty");
    dismissSuggestion(testBoxId, "sugg_123");
    assert(getDismissedSuggestionIds(testBoxId).includes("sugg_123"), "Dismissed ID should be stored");

    // Verify linking email to calendar event
    const record = {
      messageId: "msg_xyz",
      eventId: "cal_evt_789",
      calendarId: "primary",
      category: "flight" as const,
      confirmationCode: "ABC111",
      title: "Flight AA 100",
      addedAt: new Date().toISOString(),
    };
    linkEmailToCalendarEvent(testBoxId, record);

    const linked = getLinkedEmailEvents(testBoxId);
    assert(linked["msg_xyz"] !== undefined, "Linked record should exist");
    assert(linked["msg_xyz"].eventId === "cal_evt_789", "Event ID must match linked record");

    // Unlink
    unlinkEmailEvent(testBoxId, "msg_xyz");
    const unlinked = getLinkedEmailEvents(testBoxId);
    assert(unlinked["msg_xyz"] === undefined, "Linked record should be removed upon unlinking");
  });

  // 8. Video conferencing URL generator
  check("Cat 13.8: Video-conferencing URL generation across providers", () => {
    // BYOS Room
    const byosUrl = generateVideoMeetingUrl("byos_room", "Team Sync");
    assert(byosUrl.startsWith("https://meet.byos.local/room/byos-team-sync-"), `BYOS Room URL formatted correctly: ${byosUrl}`);

    // Jitsi Meet
    const jitsiUrl = generateVideoMeetingUrl("jitsi", "Client Briefing");
    assert(jitsiUrl.startsWith("https://meet.jit.si/byos-client-briefing-"), `Jitsi URL formatted correctly: ${jitsiUrl}`);

    // Custom Template
    const customUrl = generateVideoMeetingUrl("custom", "Board Meeting", "https://conf.company.org/secure/{roomId}");
    assert(customUrl.startsWith("https://conf.company.org/secure/board-meeting-"), `Custom template URL substituted correctly: ${customUrl}`);

    // None (Disabled)
    const noneUrl = generateVideoMeetingUrl("none");
    assert(noneUrl === "", "Disabled provider returns empty string");
  });

  // 9. Contact birthdays integration
  check("Cat 13.9: Contact birthday extraction and annual calendar event projection", () => {
    const contacts: ContactItem[] = [
      {
        id: "contact_alice",
        mailbox_id: "box_1",
        name: "Alice Smith",
        email: "alice@example.com",
        notes: "Key collaborator. Birthday: 1992-05-15",
        version: 1,
        created_at: "",
        updated_at: "",
      },
      {
        id: "contact_bob",
        mailbox_id: "box_1",
        name: "Bob Jones",
        email: "bob@example.com",
        notes: "DOB: 10/30/1988",
        version: 1,
        created_at: "",
        updated_at: "",
      },
      {
        id: "contact_charlie",
        mailbox_id: "box_1",
        name: "Charlie Brown",
        email: "charlie@example.com",
        notes: "No birthday specified here.",
        version: 1,
        created_at: "",
        updated_at: "",
      },
    ];

    // Extract individual birthdays
    const bdayAlice = extractBirthdayFromContact(contacts[0]);
    assert(bdayAlice !== null, "Alice's birthday should be extracted");
    assert(bdayAlice?.birthMonth === 4 && bdayAlice?.birthDay === 15, "Alice birth date should be May 15");
    assert(bdayAlice?.birthYear === 1992, "Alice birth year should be 1992");

    const bdayBob = extractBirthdayFromContact(contacts[1]);
    assert(bdayBob !== null, "Bob's birthday should be extracted");
    assert(bdayBob?.birthMonth === 9 && bdayBob?.birthDay === 30, "Bob birth date should be Oct 30");

    const bdayCharlie = extractBirthdayFromContact(contacts[2]);
    assert(bdayCharlie === null, "Charlie with no birthday should return null");

    // Project annual events across 2026-2027
    const projectedEvents = generateContactBirthdayEvents(contacts, 2026, 2027);
    assert(projectedEvents.length === 4, `Expected 4 events (2 contacts * 2 years), got ${projectedEvents.length}`);

    const alice2026 = projectedEvents.find((e) => e.id === "bday_contact_alice_2026");
    assert(alice2026 !== null, "Alice 2026 event should exist");
    assert(alice2026?.isAllDay === true, "Birthday events must be all-day");
    assert(alice2026?.calendarId === "contacts_birthdays", "Must belong to contacts_birthdays calendar");
    assert(alice2026?.details.title.includes("Alice Smith's Birthday (34th)"), `Title should include calculated age (34th), got: ${alice2026?.details.title}`);
  });

  return { passed, failed };
}
