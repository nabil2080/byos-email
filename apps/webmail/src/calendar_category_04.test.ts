import assert from "node:assert/strict";
import {
  formatAlternateDate,
  getBengaliDate,
  toBengaliNumerals,
  AlternateCalendarSystem,
} from "./utils/alternateCalendar";
import {
  HOLIDAY_FEEDS,
  getFeedById,
  getFeedsByCategory,
  getFeedEvents,
  generateIccCricketEventsForYear,
  generateBangladeshTigersEventsForYear,
  generateWorldCup2026EventsForYear,
} from "./components/calendar/holidays/holidayCatalogue";
import {
  subscribeHolidayFeed,
  unsubscribeHolidayFeed,
  getHolidaySubscriptions,
  subscriptionToUserCalendar,
  buildHolidayDecryptedRecords,
} from "./components/calendar/holidays/holidaySubscriptionStore";
import { CALENDAR_SETTINGS_REGISTRY } from "./components/calendar/settings/calendarSettingsRegistry";
import { DEFAULT_CALENDAR_SETTINGS } from "./components/calendar/settings/calendarSettingsStore";

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

export async function runCalendarCategory04Tests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✗ ${name}:`, err.message);
    }
  }

  test("Cat 04.1: Alternate Calendar System - Bengali (Bangabda) calculations", () => {
    // Test Pohela Boishakh (Bengali New Year 1433)
    const pb2026 = new Date(2026, 3, 14); // 2026-04-14
    const resPb = getBengaliDate(pb2026);
    assert.equal(resPb.year, 1433, "2026-04-14 should be Bangabda year 1433");
    assert.equal(resPb.month, "Boishakh", "Month should be Boishakh");
    assert.equal(resPb.day, 1, "Day should be 1");
    assert.equal(resPb.dayBangla, "১", "Day in Bangla numerals should be ১");
    assert.equal(resPb.yearBangla, "১৪৩৩", "Year in Bangla numerals should be ১৪৩৩");

    // Test Choitro 30 (Last day of previous Bangabda year 1432)
    const lastDay1432 = new Date(2026, 3, 13); // 2026-04-13
    const resLast = getBengaliDate(lastDay1432);
    assert.equal(resLast.year, 1432, "2026-04-13 should belong to Bangabda 1432");
    assert.equal(resLast.month, "Choitro", "Month should be Choitro");
    assert.equal(resLast.day, 30, "Day should be 30 Choitro");

    // Test Leap year Falgun 30 handling (2028 is Gregorian leap year, Falgun has 30 days)
    const leapDay = new Date(2028, 1, 29); // 2028-02-29
    const resLeap = getBengaliDate(leapDay);
    assert.equal(resLeap.year, 1434, "2028-02-29 should be Bangabda 1434");
    assert.equal(resLeap.month, "Falgun", "Month should be Falgun");

    // Test formatting helper
    const altBengali = formatAlternateDate(pb2026, "bengali");
    assert.ok(altBengali, "Alternate date should be formatted");
    assert.equal(altBengali.system, "bengali");
    assert.equal(altBengali.dayText, "1");
    assert.equal(altBengali.badge, "1 Bois");
    assert.ok(altBengali.fullText.includes("1433 BE"));
    assert.ok(altBengali.fullText.includes("বঙ্গাব্দ"));
  });

  test("Cat 04.2: Alternate Calendar Systems - Multi-system format validation", () => {
    const d = new Date(2026, 3, 14); // 2026-04-14
    const systems: AlternateCalendarSystem[] = [
      "islamic",
      "hebrew",
      "chinese",
      "indian",
      "persian",
      "korean",
    ];

    for (const sys of systems) {
      const formatted = formatAlternateDate(d, sys);
      assert.ok(formatted, `System '${sys}' should format date`);
      assert.equal(formatted.system, sys);
      assert.ok(formatted.dayText.length > 0, `${sys} dayText should not be empty`);
      assert.ok(formatted.fullText.length > 0, `${sys} fullText should not be empty`);
      assert.ok(formatted.badge.length > 0, `${sys} badge should not be empty`);
    }

    // "none" system should return null
    assert.equal(formatAlternateDate(d, "none"), null);
  });

  test("Cat 04.3: Canonical Gregorian Event Instant Invariance", () => {
    const originalInstant = new Date("2026-04-14T10:30:00.000Z");
    const originalTime = originalInstant.getTime();

    // Project into all alternate calendar systems
    const allSystems: AlternateCalendarSystem[] = [
      "islamic",
      "hebrew",
      "chinese",
      "indian",
      "persian",
      "korean",
      "bengali",
    ];

    for (const sys of allSystems) {
      const res = formatAlternateDate(originalInstant, sys);
      assert.ok(res);
      // Crucial rule: original date instance and timestamp MUST remain completely unchanged
      assert.equal(
        originalInstant.getTime(),
        originalTime,
        `Projecting to ${sys} must not alter the canonical timestamp`
      );
      assert.equal(
        originalInstant.toISOString(),
        "2026-04-14T10:30:00.000Z",
        `Canonical ISO string must remain invariant for ${sys}`
      );
    }
  });

  test("Cat 04.4: Settings Registry & Store Configuration", () => {
    assert.equal(DEFAULT_CALENDAR_SETTINGS.alternateCalendar, "none");

    const altSetting = CALENDAR_SETTINGS_REGISTRY.find((s) => s.id === "alternateCalendar");
    assert.ok(altSetting, "alternateCalendar setting must be registered in CALENDAR_SETTINGS_REGISTRY");
    assert.equal(altSetting.sectionId, "view_options");
    assert.equal(altSetting.type, "select");
    assert.ok(altSetting.options && altSetting.options.length >= 8);

    const values = altSetting.options!.map((o) => o.value);
    assert.ok(values.includes("none"));
    assert.ok(values.includes("islamic"));
    assert.ok(values.includes("hebrew"));
    assert.ok(values.includes("chinese"));
    assert.ok(values.includes("indian"));
    assert.ok(values.includes("persian"));
    assert.ok(values.includes("korean"));
    assert.ok(values.includes("bengali"));
  });

  test("Cat 04.5: Special-Interest & Sports Feeds Catalogue Completeness", () => {
    // Check Moon phases feed
    const moonFeed = getFeedById("other-moon-phases", 2026);
    assert.ok(moonFeed, "Phases of the Moon feed must exist");
    assert.equal(moonFeed.category, "other");
    assert.ok(moonFeed.events.length >= 48, "Must generate lunar phases throughout 2026");
    assert.ok(moonFeed.events.some((e) => e.title.includes("Full Moon")));
    assert.ok(moonFeed.events.some((e) => e.title.includes("New Moon")));

    // Check all 8 Sports Feeds exist
    const expectedSports = [
      "sports-cricket-icc",
      "sports-cricket-tigers",
      "sports-football-premier",
      "sports-football-ucl",
      "sports-football-worldcup",
      "sports-basketball-nba",
      "sports-hockey-nhl",
      "sports-rugby-sixnations",
    ];

    const sportsFeeds = getFeedsByCategory("sports");
    assert.equal(sportsFeeds.length, 8, "All 8 curated sports feeds must be present");

    for (const sId of expectedSports) {
      const feed = getFeedById(sId, 2026);
      assert.ok(feed, `Sports feed '${sId}' must exist in catalogue`);
      assert.equal(feed.category, "sports");
      assert.ok(feed.provider && feed.provider.length > 0, `${sId} must document provider attribution`);
      assert.ok(feed.updateFrequency && feed.updateFrequency.length > 0, `${sId} must document updateFrequency`);
      assert.ok(feed.regionalApplicability && feed.regionalApplicability.length > 0, `${sId} must document regionalApplicability`);
      assert.ok(feed.events.length > 0, `${sId} must contain events for 2026`);
    }

    // Check FIFA World Cup 2026 details
    const wcEvents = generateWorldCup2026EventsForYear(2026);
    assert.ok(wcEvents.some((e) => e.title.includes("Opening Match (Mexico)")));
    assert.ok(wcEvents.some((e) => e.title.includes("Grand Final")));

    // Check Bangladesh Tigers events
    const tigersEvents = generateBangladeshTigersEventsForYear(2026);
    assert.ok(tigersEvents.some((e) => e.title.includes("Bangladesh Premier League")));
    assert.ok(tigersEvents.some((e) => e.title.includes("ICC T20 World Cup")));
  });

  test("Cat 04.6: Sports & Moon Feed Subscription Lifecycle", () => {
    const testMailbox = "mailbox-test-cat04";

    // Clean initial state
    const initialSubs = getHolidaySubscriptions(testMailbox);
    for (const s of initialSubs) {
      unsubscribeHolidayFeed(testMailbox, s.feedId);
    }

    // 1. Subscribe to Moon phases
    const moonSub = subscribeHolidayFeed(testMailbox, "other-moon-phases", {
      color: "#64748B",
      includeObservances: true,
    });
    assert.equal(moonSub.feedId, "other-moon-phases");

    // 2. Subscribe to ICC Cricket
    const iccSub = subscribeHolidayFeed(testMailbox, "sports-cricket-icc", {
      color: "#0284C7",
      includeObservances: true,
    });
    assert.equal(iccSub.feedId, "sports-cricket-icc");

    // 3. Verify duplicate prevention
    const dupSub = subscribeHolidayFeed(testMailbox, "sports-cricket-icc");
    assert.equal(dupSub.feedId, "sports-cricket-icc");
    const allCurrent = getHolidaySubscriptions(testMailbox);
    assert.equal(allCurrent.length, 2, "Duplicate subscription must not create extra entry");

    // 4. Test UserCalendar conversion
    const userCal = subscriptionToUserCalendar(iccSub);
    assert.equal(userCal.is_shared, true, "Subscribed feeds must be marked as shared");
    assert.equal(userCal.permission, "read", "Subscribed feeds must be read-only");
    assert.equal(userCal.mailbox_id, "byos-holidays");
    assert.ok(userCal.owner_email && userCal.owner_email.includes("International Cricket Council"));

    // 5. Build decrypted event records
    const start = new Date(2026, 0, 1);
    const end = new Date(2026, 11, 31);
    const records = buildHolidayDecryptedRecords(testMailbox, start, end);
    assert.ok(records.length > 0, "Decrypted event records should be generated for subscribed feeds");
    assert.ok(records.some((r) => r.calendarId === moonSub.calendarId));
    assert.ok(records.some((r) => r.calendarId === iccSub.calendarId));

    // 6. Clean unsubscription
    unsubscribeHolidayFeed(testMailbox, "other-moon-phases");
    unsubscribeHolidayFeed(testMailbox, "sports-cricket-icc");
    const postUnsub = getHolidaySubscriptions(testMailbox);
    assert.equal(postUnsub.length, 0, "Unsubscribe should cleanly remove feeds");
  });

  return { passed, failed };
}

// Run standalone if executed directly
if (typeof process !== "undefined" && process.argv[1]?.includes("calendar_category_04.test")) {
  runCalendarCategory04Tests().then(({ failed }) => {
    if (failed > 0) process.exit(1);
  });
}
