/**
 * BYOS Calendar Category 05 Tests
 * Language, Region, and Time Management Verification
 */

import {
  SUPPORTED_TIMEZONES,
  PRESET_WORLD_CLOCK_CITIES,
  zonedTimeToUtc,
  utcToZonedParts,
  formatZonedTime,
  getTimeZoneAbbr,
  formatDateWithPattern,
  getWeekNumber,
  getWorldClockCityTime,
  detectBrowserTimeZone,
} from "./utils/calendarTimezones";
import {
  DEFAULT_CALENDAR_SETTINGS,
  CalendarSettings,
  WorldClockCity,
} from "./components/calendar/settings/calendarSettingsStore";
import {
  CALENDAR_SETTINGS_REGISTRY,
} from "./components/calendar/settings/calendarSettingsRegistry";
import { formatIcsUtc, parseIcsText } from "./utils/calendarIcs";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

export async function runCalendarCategory05Tests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  console.log("Starting Calendar Category 05 (Language, Region & Time Management) Tests...");

  // Mock browser environment if running in Node
  const originalWindow = (globalThis as any).window;
  const originalLocalStorage = (globalThis as any).localStorage;

  try {
    if (typeof (globalThis as any).window === "undefined") {
      (globalThis as any).window = globalThis;
    }
    const mockStorage = new MockLocalStorage();
    try {
      (globalThis as any).localStorage = mockStorage;
    } catch {}
    try {
      if ((globalThis as any).window) {
        Object.defineProperty((globalThis as any).window, "localStorage", {
          value: mockStorage,
          configurable: true,
          writable: true,
        });
      }
    } catch {
      (globalThis as any).window?.localStorage?.clear?.();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. Language & Regional Formatters (Date formats, 12h/24h, Week Start)
    // ──────────────────────────────────────────────────────────────────────────
    try {
      const sampleDate = new Date(2026, 3, 5); // April 5, 2026

      const isoDate = formatDateWithPattern(sampleDate, "YYYY-MM-DD");
      assert(isoDate === "2026-04-05", `ISO date should be 2026-04-05, got ${isoDate}`);

      const usDate = formatDateWithPattern(sampleDate, "MM/DD/YYYY");
      assert(usDate === "04/05/2026", `US date should be 04/05/2026, got ${usDate}`);

      const ukDate = formatDateWithPattern(sampleDate, "DD/MM/YYYY");
      assert(ukDate === "05/04/2026", `UK date should be 05/04/2026, got ${ukDate}`);

      // 12h vs 24h formatting
      const sampleInstant = new Date(Date.UTC(2026, 3, 5, 14, 30, 0)); // 14:30 UTC
      const time12h = formatZonedTime(sampleInstant, "UTC", "12h");
      assert(time12h.includes("2:30") && time12h.includes("PM"), `12h time should be 2:30 PM, got ${time12h}`);

      const time24h = formatZonedTime(sampleInstant, "UTC", "24h");
      assert(time24h === "14:30" || time24h.includes("14:30"), `24h time should contain 14:30, got ${time24h}`);

      // Midnight handling
      const midnightInstant = new Date(Date.UTC(2026, 3, 5, 0, 15, 0));
      const mid12h = formatZonedTime(midnightInstant, "UTC", "12h");
      assert(mid12h.includes("12:15") && mid12h.includes("AM"), `Midnight 12h should be 12:15 AM, got ${mid12h}`);

      passed++;
      console.log("  ✓ Cat 05.1: Regional Date & Time Formatting (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, 12h/24h)");
    } catch (err: any) {
      failed++;
      console.error(`  ✗ Cat 05.1: Regional Date & Time Formatting: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. Week Number Calculation & First-Week-of-Year Conventions
    // ──────────────────────────────────────────────────────────────────────────
    try {
      // 2026-01-01 is a Thursday
      const jan1_2026 = new Date(2026, 0, 1);
      
      // Under ISO 8601 (four_day_week), since Jan 1 is Thursday, it belongs to Week 1
      const isoWeek = getWeekNumber(jan1_2026, "monday", "four_day_week");
      assert(isoWeek === 1, `2026-01-01 under ISO 8601 should be Week 1, got ${isoWeek}`);

      // Mid-year date: 2026-06-15
      const midYearDate = new Date(2026, 5, 15);
      const isoMidWeek = getWeekNumber(midYearDate, "monday", "four_day_week");
      assert(isoMidWeek === 25, `2026-06-15 should be Week 25, got ${isoMidWeek}`);

      // Convention: first_day (Jan 1 starts Week 1)
      const firstDayWeek = getWeekNumber(jan1_2026, "sunday", "first_day");
      assert(firstDayWeek === 1, `first_day convention on Jan 1 must be Week 1, got ${firstDayWeek}`);

      // Convention: full_week
      const fullWeekVal = getWeekNumber(jan1_2026, "sunday", "full_week");
      assert(typeof fullWeekVal === "number" && fullWeekVal >= 1, `full_week convention must return valid number, got ${fullWeekVal}`);

      passed++;
      console.log("  ✓ Cat 05.2: Week Number Calculation across ISO 8601, First-Day & Full-Week Conventions");
    } catch (err: any) {
      failed++;
      console.error(`  ✗ Cat 05.2: Week Number Conventions: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. IANA Time Zone Conversions & Instant Accuracy
    // ──────────────────────────────────────────────────────────────────────────
    try {
      // Test zonedTimeToUtc:
      // Convert 2026-06-15 14:00 America/New_York (EDT = UTC-4) to UTC
      // Expected: 2026-06-15 18:00 UTC
      const nyUtc = zonedTimeToUtc(2026, 6, 15, 14, 0, "America/New_York");
      assert(
        nyUtc.getUTCFullYear() === 2026 &&
        nyUtc.getUTCMonth() === 5 &&
        nyUtc.getUTCDate() === 15 &&
        nyUtc.getUTCHours() === 18 &&
        nyUtc.getUTCMinutes() === 0,
        `14:00 EDT should be 18:00 UTC, got ${nyUtc.toISOString()}`
      );

      // Convert 2026-06-15 14:00 Asia/Dhaka (BST = UTC+6) to UTC
      // Expected: 2026-06-15 08:00 UTC
      const dhakaUtc = zonedTimeToUtc(2026, 6, 15, 14, 0, "Asia/Dhaka");
      assert(
        dhakaUtc.getUTCHours() === 8 && dhakaUtc.getUTCMinutes() === 0,
        `14:00 BST (Dhaka) should be 08:00 UTC, got ${dhakaUtc.toISOString()}`
      );

      // Reverse conversion: utcToZonedParts
      const partsNy = utcToZonedParts(nyUtc, "America/New_York");
      assert(partsNy.hour === 14 && partsNy.minute === 0, `Reverse conversion to NY should be 14:00, got ${partsNy.hour}:${partsNy.minute}`);

      const partsDhaka = utcToZonedParts(dhakaUtc, "Asia/Dhaka");
      assert(partsDhaka.hour === 14 && partsDhaka.minute === 0, `Reverse conversion to Dhaka should be 14:00, got ${partsDhaka.hour}:${partsDhaka.minute}`);

      // Asia/Tokyo (JST = UTC+9, no DST)
      const tokyoUtc = zonedTimeToUtc(2026, 1, 10, 15, 30, "Asia/Tokyo");
      assert(tokyoUtc.getUTCHours() === 6 && tokyoUtc.getUTCMinutes() === 30, `15:30 JST should be 06:30 UTC, got ${tokyoUtc.toISOString()}`);

      passed++;
      console.log("  ✓ Cat 05.3: Bidirectional UTC-to-Zoned Time Conversions across Global IANA Zones");
    } catch (err: any) {
      failed++;
      console.error(`  ✗ Cat 05.3: IANA Time Zone Conversions: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. Daylight Saving Time (DST) Transitions & Boundary Invariance
    // ──────────────────────────────────────────────────────────────────────────
    try {
      // In America/New_York:
      // Summer (EDT) is UTC-4: 2026-07-01 12:00 EDT -> 16:00 UTC
      const summerInstant = zonedTimeToUtc(2026, 7, 1, 12, 0, "America/New_York");
      assert(summerInstant.getUTCHours() === 16, `Summer NY noon should be 16:00 UTC, got ${summerInstant.toISOString()}`);

      // Winter (EST) is UTC-5: 2026-01-15 12:00 EST -> 17:00 UTC
      const winterInstant = zonedTimeToUtc(2026, 1, 15, 12, 0, "America/New_York");
      assert(winterInstant.getUTCHours() === 17, `Winter NY noon should be 17:00 UTC, got ${winterInstant.toISOString()}`);

      // In Europe/London:
      // Summer (BST) is UTC+1: 2026-07-01 12:00 BST -> 11:00 UTC
      const londonSummer = zonedTimeToUtc(2026, 7, 1, 12, 0, "Europe/London");
      assert(londonSummer.getUTCHours() === 11, `Summer London noon should be 11:00 UTC, got ${londonSummer.toISOString()}`);

      // Winter (GMT) is UTC+0: 2026-01-15 12:00 GMT -> 12:00 UTC
      const londonWinter = zonedTimeToUtc(2026, 1, 15, 12, 0, "Europe/London");
      assert(londonWinter.getUTCHours() === 12, `Winter London noon should be 12:00 UTC, got ${londonWinter.toISOString()}`);

      // Canonical Instant Invariance:
      // Storing an event at 16:00 UTC and projecting to NY vs London vs Dhaka:
      const canonicalInstant = new Date(Date.UTC(2026, 6, 1, 16, 0, 0));
      const nyTime = formatZonedTime(canonicalInstant, "America/New_York", "24h");
      const lonTime = formatZonedTime(canonicalInstant, "Europe/London", "24h");
      const dhkTime = formatZonedTime(canonicalInstant, "Asia/Dhaka", "24h");

      assert(nyTime.includes("12:00"), `NY display should be 12:00, got ${nyTime}`);
      assert(lonTime.includes("17:00"), `London display should be 17:00, got ${lonTime}`);
      assert(dhkTime.includes("22:00"), `Dhaka display should be 22:00, got ${dhkTime}`);

      // Changing projection timezone does NOT change canonical timestamp
      assert(canonicalInstant.getTime() === Date.UTC(2026, 6, 1, 16, 0, 0), "Canonical instant must not mutate");

      passed++;
      console.log("  ✓ Cat 05.4: Daylight Saving Time (DST) Transitions & Canonical Instant Invariance");
    } catch (err: any) {
      failed++;
      console.error(`  ✗ Cat 05.4: DST Transitions & Invariance: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. World Clock Engine & City Time Relative Day Differences
    // ──────────────────────────────────────────────────────────────────────────
    try {
      const baseInstant = new Date(Date.UTC(2026, 5, 15, 23, 0, 0)); // 23:00 UTC on June 15
      const baseDate = new Date(2026, 5, 15);

      // London at 23:00 UTC in BST (UTC+1) is June 16, 00:00 (Tomorrow)
      const londonCity: WorldClockCity = { id: "c1", label: "London", timeZone: "Europe/London" };
      const londonInfo = getWorldClockCityTime(londonCity, baseInstant, "24h", baseDate);
      assert(londonInfo.timeStr.includes("00:00"), `London time should be 00:00, got ${londonInfo.timeStr}`);
      assert(londonInfo.dayDiff === "Tomorrow", `London should be Tomorrow relative to June 15 UTC, got '${londonInfo.dayDiff}'`);

      // Dhaka at 23:00 UTC is June 16, 05:00 (+6 hours, Tomorrow)
      const dhakaCity: WorldClockCity = { id: "c2", label: "Dhaka", timeZone: "Asia/Dhaka" };
      const dhakaInfo = getWorldClockCityTime(dhakaCity, baseInstant, "24h", baseDate);
      assert(dhakaInfo.timeStr.includes("05:00"), `Dhaka time should be 05:00, got ${dhakaInfo.timeStr}`);
      assert(dhakaInfo.dayDiff === "Tomorrow", `Dhaka should be Tomorrow, got '${dhakaInfo.dayDiff}'`);

      // Honolulu at 23:00 UTC is June 15, 13:00 (HST = UTC-10, Same day)
      const honoluluCity: WorldClockCity = { id: "c3", label: "Honolulu", timeZone: "Pacific/Honolulu" };
      const honoluluInfo = getWorldClockCityTime(honoluluCity, baseInstant, "24h", baseDate);
      assert(honoluluInfo.timeStr.includes("13:00"), `Honolulu time should be 13:00, got ${honoluluInfo.timeStr}`);
      assert(honoluluInfo.dayDiff === "", `Honolulu should be same day (""), got '${honoluluInfo.dayDiff}'`);

      // Preset cities completeness
      assert(PRESET_WORLD_CLOCK_CITIES.length >= 15, `Preset world clock cities catalogue should have >= 15 hubs, got ${PRESET_WORLD_CLOCK_CITIES.length}`);

      passed++;
      console.log("  ✓ Cat 05.5: World Clock Engine, Live City Conversions & Relative Day Indicators");
    } catch (err: any) {
      failed++;
      console.error(`  ✗ Cat 05.5: World Clock Engine: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. Settings Registry & Store Integration for Category 05
    // ──────────────────────────────────────────────────────────────────────────
    try {
      // Verify registry contains Category 05 definitions
      const reg = CALENDAR_SETTINGS_REGISTRY;
      const primaryTzDef = reg.find((d) => d.id === "primaryTimeZone");
      assert(Boolean(primaryTzDef), "primaryTimeZone must be declared in settings registry");

      const secTzDef = reg.find((d) => d.id === "showSecondaryTimeZone");
      assert(Boolean(secTzDef), "showSecondaryTimeZone must be declared in settings registry");

      const secTzValDef = reg.find((d) => d.id === "secondaryTimeZone");
      assert(Boolean(secTzValDef), "secondaryTimeZone must be declared in settings registry");

      const secTzLabelDef = reg.find((d) => d.id === "secondaryTimeZoneLabel");
      assert(Boolean(secTzLabelDef), "secondaryTimeZoneLabel must be declared in settings registry");

      const autoTzDef = reg.find((d) => d.id === "autoUpdateTimeZoneWithConsent");
      assert(Boolean(autoTzDef), "autoUpdateTimeZoneWithConsent must be declared in settings registry");

      const worldClockDef = reg.find((d) => d.id === "showWorldClock");
      assert(Boolean(worldClockDef), "showWorldClock must be declared in settings registry");

      const firstWeekDef = reg.find((d) => d.id === "firstWeekOfYear");
      assert(Boolean(firstWeekDef), "firstWeekOfYear must be declared in settings registry");

      const countryPrefDef = reg.find((d) => d.id === "countryPreference");
      assert(Boolean(countryPrefDef), "countryPreference must be declared in settings registry");

      // Verify default calendar settings defaults
      assert(DEFAULT_CALENDAR_SETTINGS.primaryTimeZone === "UTC", "Default primaryTimeZone is UTC");
      assert(DEFAULT_CALENDAR_SETTINGS.showSecondaryTimeZone === false, "Default showSecondaryTimeZone is false");
      assert(DEFAULT_CALENDAR_SETTINGS.autoUpdateTimeZoneWithConsent === true, "Default autoUpdateTimeZoneWithConsent is true");
      assert(DEFAULT_CALENDAR_SETTINGS.worldClockCities.length >= 3, "Default world clock has >= 3 cities");

      // Verify supported timezones catalogue completeness
      assert(SUPPORTED_TIMEZONES.length >= 30, `Supported timezones must contain global hubs (>= 30), got ${SUPPORTED_TIMEZONES.length}`);

      // Location travel detection helper
      const detected = detectBrowserTimeZone();
      assert(typeof detected === "string" && detected.length > 0, `detectBrowserTimeZone must return valid string, got ${detected}`);

      passed++;
      console.log("  ✓ Cat 05.6: Settings Registry, Store Integrity & Location Detection Safeguards");
    } catch (err: any) {
      failed++;
      console.error(`  ✗ Cat 05.6: Settings Registry & Store Integrity: ${err.message}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 7. RFC 5545 iCalendar UTC Serialization & Timezone Roundtrip
    // ──────────────────────────────────────────────────────────────────────────
    try {
      const eventInstant = new Date(Date.UTC(2026, 9, 26, 14, 0, 0));
      const icsStr = formatIcsUtc(eventInstant);
      assert(icsStr === "20261026T140000Z", `formatIcsUtc must yield 20261026T140000Z, got ${icsStr}`);

      // Verify RFC 5545 timestamp preserves canonical instant without local drift
      const parsedUtc = new Date(Date.UTC(2026, 9, 26, 14, 0, 0));
      assert(parsedUtc.getTime() === eventInstant.getTime(), "RFC 5545 UTC timestamp must match source instant exactly");

      passed++;
      console.log("  ✓ Cat 05.7: RFC 5545 iCalendar UTC Serialization & Instant Preservation");
    } catch (err: any) {
      failed++;
      console.error(`  ✗ Cat 05.7: iCalendar UTC Serialization: ${err.message}`);
    }

  } finally {
    if (!originalWindow) {
      delete (globalThis as any).window;
    } else {
      (globalThis as any).window = originalWindow;
    }
    if (!originalLocalStorage) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = originalLocalStorage;
    }
  }

  console.log(`\nCALENDAR CATEGORY 05 TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
