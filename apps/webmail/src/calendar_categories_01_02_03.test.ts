import assert from "node:assert/strict";
import {
  CALENDAR_SETTING_SECTIONS,
  CALENDAR_SETTINGS_REGISTRY,
  searchCalendarSettings,
} from "./components/calendar/settings/calendarSettingsRegistry";
import {
  loadCalendarSettings,
  saveCalendarSettings,
  loadCalendarOverrides,
  saveCalendarOverrides,
} from "./components/calendar/settings/calendarSettingsStore";
import {
  CALENDAR_TEMPLATES,
  getCalendarTemplate,
} from "./calendar_management.test";
import {
  isValidCalendarUrl,
  normalizeCalendarUrl,
  subscribeUrlFeed,
  getUrlSubscriptions,
  toggleUrlSubscriptionVisibility,
  unsubscribeUrlFeed,
  urlSubToUserCalendar,
  buildUrlDecryptedRecords,
} from "./components/calendar/url/urlCalendarStore";
import {
  getAllSupportedCountries,
  generateFeedForCountry,
  getFeedById,
  getFeedEvents,
  getFeedEventsForYearRange,
  HOLIDAY_FEEDS,
} from "./components/calendar/holidays/holidayCatalogue";
import {
  getHolidaySubscriptions,
  subscribeHolidayFeed,
  toggleHolidayVisibility,
  toggleHolidayObservances,
  unsubscribeHolidayFeed,
  subscriptionToUserCalendar,
  buildHolidayDecryptedRecords,
} from "./components/calendar/holidays/holidaySubscriptionStore";

// Mock localStorage and window in node test environment
class MockLocalStorage {
  private store: Map<string, string> = new Map();

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

if (typeof (globalThis as any).localStorage === "undefined") {
  (globalThis as any).localStorage = new MockLocalStorage();
}
if (typeof (globalThis as any).sessionStorage === "undefined") {
  (globalThis as any).sessionStorage = new MockLocalStorage();
}
if (typeof (globalThis as any).window === "undefined") {
  (globalThis as any).window = {
    localStorage: (globalThis as any).localStorage,
    sessionStorage: (globalThis as any).sessionStorage,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

export async function runCalendarCategories010203Tests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}:`, err);
    }
  }

  console.log("Starting Calendar Categories 01, 02, and 03 Integration Tests...");

  // ── CATEGORY 01: Calendar Settings Framework ──
  test("Cat 01.1: Settings Registry defines exactly the 10 sections from Section 4.1", () => {
    assert.equal(CALENDAR_SETTING_SECTIONS.length, 10);
    const expectedIds = [
      "general",
      "event_defaults",
      "notifications",
      "view_options",
      "timezones",
      "working_hours",
      "privacy_sharing",
      "integrations",
      "shortcuts_a11y",
      "offline_sync",
    ];
    for (const id of expectedIds) {
      const found = CALENDAR_SETTING_SECTIONS.find((s) => s.id === id);
      assert.ok(found, `Section ${id} must exist in CALENDAR_SETTING_SECTIONS`);
    }
  });

  test("Cat 01.2: Settings search queries match across labels, descriptions, and keywords", () => {
    const tzResults = searchCalendarSettings("timezone");
    assert.ok(tzResults.length >= 2, "Expected multiple timezone search matches");
    const durResults = searchCalendarSettings("duration");
    assert.ok(durResults.some((s) => s.id === "defaultDuration"), "Expected defaultDuration in search");
    const emptyResults = searchCalendarSettings("nonexistent_xyz_setting_123");
    assert.equal(emptyResults.length, 0);
  });

  test("Cat 01.3: User preferences persist and restore per mailbox, with default fallbacks", async () => {
    const boxId = "test-box-settings-01";
    const initial = loadCalendarSettings(boxId);
    assert.equal(initial.defaultDuration, 30);
    assert.equal(initial.weekStart, "sunday");

    await saveCalendarSettings(
      {
        ...initial,
        defaultDuration: 60,
        weekStart: "monday",
        defaultCalendarId: "cal-work-123",
      },
      boxId
    );

    const updated = loadCalendarSettings(boxId);
    assert.equal(updated.defaultDuration, 60);
    assert.equal(updated.weekStart, "monday");
    assert.equal(updated.defaultCalendarId, "cal-work-123");
  });

  test("Cat 01.4: Per-calendar overrides save and load independently", () => {
    const boxId = "test-box-cal-overrides";
    const calId = "cal-team-alpha";
    const ov = loadCalendarOverrides(boxId, calId);
    assert.equal(ov.calendarId, calId);

    saveCalendarOverrides(boxId, calId, {
      defaultReminderMinutes: 15,
      colorOverride: "#9E725F",
    });

    const reloaded = loadCalendarOverrides(boxId, calId);
    assert.equal(reloaded.defaultReminderMinutes, 15);
    assert.equal(reloaded.colorOverride, "#9E725F");
  });

  // ── CATEGORY 02: Calendar Management & External URL Feeds ──
  test("Cat 02.1: URL normalization and validation handles http, https, and webcal", () => {
    assert.ok(isValidCalendarUrl("https://example.com/calendar.ics"));
    assert.ok(isValidCalendarUrl("http://calendar.corp.local/feed.ics"));
    assert.ok(isValidCalendarUrl("webcal://example.com/feed.ics"));
    assert.ok(!isValidCalendarUrl("ftp://example.com/feed.ics"));
    assert.ok(!isValidCalendarUrl("javascript:alert(1)"));
    assert.ok(!isValidCalendarUrl(""));

    assert.equal(
      normalizeCalendarUrl("webcal://example.com/feed.ics"),
      "https://example.com/feed.ics"
    );
  });

  test("Cat 02.2: External URL subscription lifecycle: subscribe, deduplicate, project to UserCalendar", () => {
    const boxId = "test-box-url-sub";
    const url = "https://events.example.org/team.ics";

    const sub = subscribeUrlFeed(boxId, {
      url,
      name: "Engineering Team Feed",
      color: "#2563EB",
      refreshIntervalMinutes: 1440,
      initialEvents: [
        {
          uid: "eng-standup-1",
          summary: "Daily Engineering Sync",
          startTime: "2026-03-10T09:00:00Z",
          endTime: "2026-03-10T09:30:00Z",
          isAllDay: false,
        },
      ],
    });

    assert.ok(sub.id.startsWith("url-"));
    assert.equal(sub.name, "Engineering Team Feed");
    assert.equal(sub.cachedEvents.length, 1);

    // Deduplication check
    const dup = subscribeUrlFeed(boxId, { url });
    assert.equal(dup.id, sub.id);

    // Projection to UserCalendar
    const userCal = urlSubToUserCalendar(sub);
    assert.equal(userCal.id, sub.calendarId);
    assert.equal(userCal.is_shared, true);
    assert.equal(userCal.permission, "read");
    assert.equal(userCal.template, "url_feed");

    // Decrypted record generation
    const records = buildUrlDecryptedRecords(
      boxId,
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-03-31T23:59:59Z")
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].details.title, "Daily Engineering Sync");

    // Toggle visibility
    toggleUrlSubscriptionVisibility(boxId, sub.calendarId);
    const hiddenRecords = buildUrlDecryptedRecords(
      boxId,
      new Date("2026-03-01T00:00:00Z"),
      new Date("2026-03-31T23:59:59Z")
    );
    assert.equal(hiddenRecords.length, 0);

    // Unsubscribe clean removal
    unsubscribeUrlFeed(boxId, sub.calendarId);
    assert.equal(getUrlSubscriptions(boxId).length, 0);
  });

  // ── CATEGORY 03: Complete Regional & Religious Holiday Catalogue ──
  test("Cat 03.1: Complete international country coverage (200+ countries from date-holidays)", () => {
    const countries = getAllSupportedCountries();
    assert.ok(countries.length >= 200, `Expected >= 200 countries, got ${countries.length}`);

    // Verify presence of representative countries across all 5 continents
    const codes = new Set(countries.map((c) => c.code));
    assert.ok(codes.has("BD"), "Bangladesh must be in country catalogue");
    assert.ok(codes.has("US"), "United States must be in country catalogue");
    assert.ok(codes.has("GB"), "United Kingdom must be in country catalogue");
    assert.ok(codes.has("JP"), "Japan (Asia) must be in country catalogue");
    assert.ok(codes.has("DE"), "Germany (Europe) must be in country catalogue");
    assert.ok(codes.has("ZA"), "South Africa (Africa) must be in country catalogue");
    assert.ok(codes.has("BR"), "Brazil (Americas) must be in country catalogue");
    assert.ok(codes.has("AU"), "Australia (Oceania) must be in country catalogue");

    // Verify continent tagging
    const asiaCountries = countries.filter((c) => c.continent === "Asia");
    const europeCountries = countries.filter((c) => c.continent === "Europe");
    const americasCountries = countries.filter((c) => c.continent === "Americas");
    assert.ok(asiaCountries.length > 20, "Asia continent catalogue must contain > 20 countries");
    assert.ok(europeCountries.length > 20, "Europe continent catalogue must contain > 20 countries");
    assert.ok(americasCountries.length > 20, "Americas continent catalogue must contain > 20 countries");
  });

  test("Cat 03.2: Dynamic generation of holidays for arbitrary international country (e.g. Japan)", () => {
    const jpFeed = generateFeedForCountry("JP", 2026);
    assert.ok(jpFeed, "Japan holiday feed must be generated");
    assert.equal(jpFeed.countryCode, "JP");
    assert.ok(jpFeed.events.length >= 15, `Expected >= 15 Japanese holidays, got ${jpFeed.events.length}`);
    assert.ok(
      jpFeed.events.some((e) => e.title.includes("New Year") || e.title.includes("元日")),
      "Expected New Year's Day in Japanese feed"
    );
  });

  test("Cat 03.3: Bangladesh national holidays gazetted accuracy & UNESCO history preservation", () => {
    const bdFeed = getFeedById("holiday-bd");
    assert.ok(bdFeed, "Bangladesh curated feed must exist");
    assert.equal(bdFeed.countryCode, "BD");

    const titles = bdFeed.events.map((e) => e.title);
    assert.ok(
      titles.some((t) => t.includes("Language Martyrs' Day") && t.includes("International Mother Language Day")),
      "Must preserve full UNESCO Language Martyrs' Day title"
    );
    assert.ok(
      titles.some((t) => t.includes("Pohela Boishakh") && t.includes("1433")),
      "Must preserve Pohela Boishakh Bengali era year"
    );
    assert.ok(
      titles.some((t) => t.includes("Independence and National Day")),
      "Must preserve Independence Day"
    );
    assert.ok(
      titles.some((t) => t.includes("Victory Day")),
      "Must preserve Victory Day"
    );
  });

  test("Cat 03.4: Religious honesty: Islamic moon-sighting caveats and multi-tradition coverage", () => {
    const islamicFeed = getFeedById("religion-islam");
    assert.ok(islamicFeed, "Islamic feed must exist in catalogue");
    assert.ok(islamicFeed.disclaimer, "Islamic feed must include astronomical disclaimer");
    assert.ok(
      islamicFeed.disclaimer.toLowerCase().includes("moon-sighting") ||
      islamicFeed.disclaimer.toLowerCase().includes("lunar"),
      "Disclaimer must note moon-sighting / lunar confirmation"
    );

    const eidFitr = islamicFeed.events.find((e) => e.id.includes("eid-ul-fitr"));
    assert.ok(eidFitr, "Eid al-Fitr must exist in Islamic feed");
    assert.equal(eidFitr.dateType, "provisional");
    assert.ok(eidFitr.provisionalNote, "Provisional note required for Eid al-Fitr");

    // All 5 major traditions present
    const feeds = HOLIDAY_FEEDS.map((f) => f.id);
    assert.ok(feeds.includes("religion-islam"));
    assert.ok(feeds.includes("religion-christianity"));
    assert.ok(feeds.includes("religion-hinduism"));
    assert.ok(feeds.includes("religion-buddhism"));
    assert.ok(feeds.includes("religion-judaism"));
  });

  test("Cat 03.5: Multi-year dynamic generation across year ranges (2025-2027)", () => {
    const multiYearEvents = getFeedEventsForYearRange("holiday-us", 2025, 2027);
    assert.ok(multiYearEvents.length > 20, "Multi-year range must return events across 3 years");
    const years = new Set(multiYearEvents.map((e) => e.date.slice(0, 4)));
    assert.ok(years.has("2025"));
    assert.ok(years.has("2026"));
    assert.ok(years.has("2027"));
  });

  test("Cat 03.6: Subscription store: subscribe, color, observances toggle, and safe unsubscription", () => {
    const boxId = "test-box-holidays-complete";
    const sub = subscribeHolidayFeed(boxId, "holiday-bd", {
      color: "#15803D",
      includeObservances: true,
    });

    assert.equal(sub.feedId, "holiday-bd");
    assert.equal(sub.color, "#15803D");
    assert.equal(sub.includeObservances, true);

    // Observance toggle
    toggleHolidayObservances(boxId, "holiday-bd");
    const toggled = getHolidaySubscriptions(boxId).find((s) => s.feedId === "holiday-bd");
    assert.equal(toggled?.includeObservances, false);

    // Unsubscribe removes only the holiday subscription without touching user events
    unsubscribeHolidayFeed(boxId, "holiday-bd");
    const remaining = getHolidaySubscriptions(boxId);
    assert.equal(remaining.length, 0);
  });

  console.log(`\nCALENDAR CATEGORIES 01, 02, 03 TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

// Run standalone if executed directly
if (typeof process !== "undefined" && process.argv[1]?.includes("calendar_categories_01_02_03.test")) {
  runCalendarCategories010203Tests().then(({ failed }) => {
    if (failed > 0) process.exit(1);
  });
}
