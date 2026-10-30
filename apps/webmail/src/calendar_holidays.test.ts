import assert from "node:assert/strict";
import {
  HOLIDAY_FEEDS,
  getAvailableFeeds,
  getFeedById,
  getFeedsByCategory,
  getFeedEvents,
} from "./components/calendar/holidays/holidayCatalogue";
import {
  getHolidaySubscriptions,
  subscribeHolidayFeed,
  updateHolidaySubscription,
  updateHolidaySubscriptionColor,
  toggleHolidayVisibility,
  toggleHolidayObservances,
  hideHolidayEvent,
  restoreHolidayEvent,
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

export async function runCalendarHolidayTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("Starting Holiday and Religious Calendars (Category 03) Tests...");

  test("1. Holiday feeds catalogue completeness & categorisation", () => {
    assert.ok(HOLIDAY_FEEDS.length >= 8, `Expected at least 8 feeds, got ${HOLIDAY_FEEDS.length}`);

    const regional = getFeedsByCategory("country");
    const religious = getFeedsByCategory("religion");

    const regionalIds = regional.map((f) => f.id);
    assert.ok(regionalIds.includes("holiday-bd"), "Expected Bangladesh feed in regional catalogue");
    assert.ok(regionalIds.includes("holiday-us"), "Expected US feed in regional catalogue");
    assert.ok(regionalIds.includes("holiday-gb"), "Expected UK feed in regional catalogue");

    const religiousIds = religious.map((f) => f.id);
    assert.ok(religiousIds.includes("religion-islam"), "Expected Islam feed in religious catalogue");
    assert.ok(religiousIds.includes("religion-christianity"), "Expected Christianity feed in religious catalogue");
    assert.ok(religiousIds.includes("religion-hinduism"), "Expected Hinduism feed in religious catalogue");
    assert.ok(religiousIds.includes("religion-buddhism"), "Expected Buddhism feed in religious catalogue");
    assert.ok(religiousIds.includes("religion-judaism"), "Expected Judaism feed in religious catalogue");

    for (const feed of HOLIDAY_FEEDS) {
      assert.ok(feed.id.length > 0, "Feed ID must not be empty");
      assert.ok(feed.name.length > 0, "Feed name must not be empty");
      assert.ok(feed.provider.length > 0, "Feed provider attribution required");
      assert.ok(feed.lastUpdated.length > 0, "Feed lastUpdated required");
      assert.ok(feed.defaultColor.startsWith("#"), "Feed default color must be hex");
      assert.ok(feed.events.length > 0, `Feed ${feed.id} must define at least one event`);
    }
  });

  test("2. Bangladesh national holidays and regional observances focus", () => {
    const bdFeed = getFeedById("holiday-bd");
    assert.ok(bdFeed, "Bangladesh feed must be present");
    assert.strictEqual(bdFeed.countryCode, "BD");
    assert.strictEqual(
      bdFeed.provider,
      "Ministry of Public Administration, Government of the People's Republic of Bangladesh"
    );

    const events = bdFeed.events;
    const names = events.map((e) => e.title);

    // Core national holidays
    assert.ok(
      names.some((n) => n.includes("Language Martyrs' Day") || n.includes("Shaheed Dibosh")),
      "Language Martyrs' Day missing"
    );
    assert.ok(
      names.some((n) => n.includes("Independence and National Day")),
      "Independence Day missing"
    );
    assert.ok(
      names.some((n) => n.includes("Pohela Boishakh")),
      "Pohela Boishakh missing"
    );
    assert.ok(
      names.some((n) => n.includes("Victory Day")),
      "Victory Day missing"
    );

    // Check Language Martyrs' Day details
    const feb21 = events.find((e) => e.id === "bd-lang-martyrs-2026");
    assert.ok(feb21);
    assert.strictEqual(feb21.dateType, "fixed");
    assert.strictEqual(feb21.isObservance, false);
    assert.strictEqual(feb21.date, "2026-02-21");

    // Check Bengali New Year
    const apr14 = events.find((e) => e.id === "bd-pohela-boishakh-2026");
    assert.ok(apr14);
    assert.strictEqual(apr14.dateType, "fixed");
    assert.strictEqual(apr14.date, "2026-04-14");

    // Check observances (Armed Forces Day, Martyred Intellectuals Day)
    const nov21 = events.find((e) => e.id === "bd-armed-forces-day-2026");
    assert.ok(nov21);
    assert.strictEqual(nov21.isObservance, true);

    const dec14 = events.find((e) => e.id === "bd-martyred-intellectuals-2026");
    assert.ok(dec14);
    assert.strictEqual(dec14.isObservance, true);
  });

  test("3. Religious honesty: provisional moon-sighting vs fixed vs calculated dates", () => {
    const islamFeed = getFeedById("religion-islam");
    assert.ok(islamFeed);
    assert.ok(islamFeed.disclaimer, "Astronomical moon-sighting disclaimer required");

    // Provisional moon-sighting dates
    const ramadan = islamFeed.events.find((e) => e.id === "islam-ramadan-start-2026");
    assert.ok(ramadan);
    assert.strictEqual(ramadan.dateType, "provisional");
    assert.ok(ramadan.provisionalNote?.toLowerCase().includes("moon sighting"));

    const eidFitr = islamFeed.events.find((e) => e.id === "islam-eid-ul-fitr-2026");
    assert.ok(eidFitr);
    assert.strictEqual(eidFitr.dateType, "provisional");
    assert.ok(eidFitr.regionalDifferences, "Regional differences explanation required");

    // Christianity: Easter is calculated, Christmas is fixed
    const christFeed = getFeedById("religion-christianity");
    assert.ok(christFeed);

    const easter = christFeed.events.find((e) => e.id === "chris-easter-sunday-2026");
    assert.ok(easter);
    assert.strictEqual(easter.dateType, "calculated");

    const xmas = christFeed.events.find((e) => e.id === "chris-christmas-day-2026");
    assert.ok(xmas);
    assert.strictEqual(xmas.dateType, "fixed");
    assert.strictEqual(xmas.date, "2026-12-25");

    // Judaism: Yom Kippur is calculated lunar
    const judFeed = getFeedById("religion-judaism");
    assert.ok(judFeed);
    const yomKippur = judFeed.events.find((e) => e.id === "jewish-yom-kippur-2026");
    assert.ok(yomKippur);
    assert.strictEqual(yomKippur.dateType, "calculated");
  });

  test("4. Subscription store: subscribe, deduplication, color, visibility, hide/restore", () => {
    const mailboxId = "mb-test-cat03-holidays";

    // Clean previous
    unsubscribeHolidayFeed(mailboxId, "holiday-bd");
    unsubscribeHolidayFeed(mailboxId, "religion-islam");

    assert.strictEqual(getHolidaySubscriptions(mailboxId).length, 0);

    // 1. Subscribe to Bangladesh holidays
    const subBd = subscribeHolidayFeed(mailboxId, "holiday-bd", {
      color: "#006A4E",
      includeObservances: false,
    });
    assert.ok(subBd);
    assert.strictEqual(subBd.feedId, "holiday-bd");
    assert.strictEqual(subBd.calendarId, "holiday-holiday-bd");
    assert.strictEqual(subBd.color, "#006A4E");
    assert.strictEqual(subBd.includeObservances, false);
    assert.strictEqual(subBd.isVisible, true);
    assert.strictEqual(getHolidaySubscriptions(mailboxId).length, 1);

    // 2. Prevent duplicate subscription on re-subscribe
    const subBdAgain = subscribeHolidayFeed(mailboxId, "holiday-bd", {
      color: "#1E824C",
      includeObservances: true,
    });
    assert.strictEqual(getHolidaySubscriptions(mailboxId).length, 1, "Duplicate subscription should not be created");
    assert.strictEqual(subBdAgain.color, "#1E824C");
    assert.strictEqual(subBdAgain.includeObservances, true);

    // 3. Update color
    updateHolidaySubscriptionColor(mailboxId, "holiday-bd", "#047857");
    let currentSubs = getHolidaySubscriptions(mailboxId);
    assert.strictEqual(currentSubs[0].color, "#047857");

    // 4. Toggle visibility
    toggleHolidayVisibility(mailboxId, "holiday-bd");
    currentSubs = getHolidaySubscriptions(mailboxId);
    assert.strictEqual(currentSubs[0].isVisible, false);

    toggleHolidayVisibility(mailboxId, "holiday-bd");
    currentSubs = getHolidaySubscriptions(mailboxId);
    assert.strictEqual(currentSubs[0].isVisible, true);

    // 5. Hide and restore individual entry
    hideHolidayEvent(mailboxId, "holiday-bd", "bd-lang-martyrs-2026");
    currentSubs = getHolidaySubscriptions(mailboxId);
    assert.ok(currentSubs[0].hiddenEventIds.includes("bd-lang-martyrs-2026"));

    restoreHolidayEvent(mailboxId, "holiday-bd", "bd-lang-martyrs-2026");
    currentSubs = getHolidaySubscriptions(mailboxId);
    assert.ok(!currentSubs[0].hiddenEventIds.includes("bd-lang-martyrs-2026"));

    // 6. Toggle observances
    toggleHolidayObservances(mailboxId, "holiday-bd");
    currentSubs = getHolidaySubscriptions(mailboxId);
    assert.strictEqual(currentSubs[0].includeObservances, false);

    // 7. Subscribe second feed (Islam)
    subscribeHolidayFeed(mailboxId, "religion-islam", { color: "#15803d" });
    assert.strictEqual(getHolidaySubscriptions(mailboxId).length, 2);

    // 8. Unsubscribe
    unsubscribeHolidayFeed(mailboxId, "holiday-bd");
    assert.strictEqual(getHolidaySubscriptions(mailboxId).length, 1);
    assert.strictEqual(getHolidaySubscriptions(mailboxId)[0].feedId, "religion-islam");

    unsubscribeHolidayFeed(mailboxId, "religion-islam");
    assert.strictEqual(getHolidaySubscriptions(mailboxId).length, 0);
  });

  test("5. Projection to UserCalendar & DecryptedEventRecord generation", () => {
    const mailboxId = "mb-test-cat03-projection";

    // Subscribe to Bangladesh feed
    const sub = subscribeHolidayFeed(mailboxId, "holiday-bd", {
      color: "#006A4E",
      includeObservances: true,
    });

    // Verify UserCalendar projection
    const userCal = subscriptionToUserCalendar(sub);
    assert.strictEqual(userCal.id, "holiday-holiday-bd");
    assert.strictEqual(userCal.name, "Bangladesh Holidays");
    assert.strictEqual(userCal.color, "#006A4E");
    assert.strictEqual(userCal.is_shared, true, "Must be tagged as shared/other calendar");
    assert.strictEqual(userCal.permission, "read", "Must be read-only permission");
    assert.strictEqual(
      userCal.owner_email,
      "Ministry of Public Administration, Government of the People's Republic of Bangladesh"
    );

    // Verify buildHolidayDecryptedRecords for Year 2026
    const windowStart = new Date(2026, 0, 1);
    const windowEnd = new Date(2026, 11, 31, 23, 59, 59);

    const records = buildHolidayDecryptedRecords(mailboxId, windowStart, windowEnd);
    assert.ok(records.length > 0, "Should generate holiday event records for 2026");

    for (const r of records) {
      assert.strictEqual(r.isHoliday, true, "Record must have isHoliday=true");
      assert.strictEqual(r.calendarId, "holiday-holiday-bd");
      assert.strictEqual(r.isAllDay, true, "Holidays should default to all-day");
      assert.ok(r.holidayMeta, "holidayMeta required");
      assert.strictEqual(r.holidayMeta?.provider, userCal.owner_email);
      assert.ok(["fixed", "calculated", "provisional"].includes(r.holidayMeta?.dateType || ""));
    }

    // Hide Pohela Boishakh and check filtering
    hideHolidayEvent(mailboxId, "holiday-bd", "bd-pohela-boishakh-2026");
    const recordsAfterHide = buildHolidayDecryptedRecords(mailboxId, windowStart, windowEnd);
    const foundHidden = recordsAfterHide.find((r) => r.details.title.includes("Pohela Boishakh"));
    assert.strictEqual(foundHidden, undefined, "Hidden event must not appear in generated records");

    // Restore and check it returns
    restoreHolidayEvent(mailboxId, "holiday-bd", "bd-pohela-boishakh-2026");
    const recordsAfterRestore = buildHolidayDecryptedRecords(mailboxId, windowStart, windowEnd);
    const foundRestored = recordsAfterRestore.find((r) => r.details.title.includes("Pohela Boishakh"));
    assert.ok(foundRestored, "Restored event must appear again");

    // Clean up
    unsubscribeHolidayFeed(mailboxId, "holiday-bd");
  });

  return { passed, failed };
}
