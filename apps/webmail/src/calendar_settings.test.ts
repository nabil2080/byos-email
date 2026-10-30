import assert from "node:assert/strict";
import {
  CALENDAR_SETTING_SECTIONS,
  CALENDAR_SETTINGS_REGISTRY,
  searchCalendarSettings,
  CalendarSettingSectionId,
} from "./components/calendar/settings/calendarSettingsRegistry";
import {
  DEFAULT_CALENDAR_SETTINGS,
  loadCalendarSettings,
  saveCalendarSettings,
  loadCalendarOverrides,
  saveCalendarOverrides,
  resolveEffectiveReminder,
  CalendarSettings,
} from "./components/calendar/settings/calendarSettingsStore";

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

// Setup simulated window environment if needed
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

export async function runCalendarSettingsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res && typeof (res as any).then === "function") {
        return (res as any)
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err: any) => {
            console.error(`  ✗ ${name}:`, err);
            failed++;
          });
      } else {
        console.log(`  ✓ ${name}`);
        passed++;
      }
    } catch (err: any) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  }

  // 1. Registry sections
  test("1. Registry specifies exactly the 10 sections from Section 4.1", () => {
    const expectedSectionIds: CalendarSettingSectionId[] = [
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

    assert.equal(CALENDAR_SETTING_SECTIONS.length, 10);
    for (const expectedId of expectedSectionIds) {
      const found = CALENDAR_SETTING_SECTIONS.find((s) => s.id === expectedId);
      assert.ok(found, `Section ${expectedId} must exist in registry`);
      assert.ok(found.title.length > 0, `Section ${expectedId} must have non-empty title`);
      assert.ok(found.description.length > 0, `Section ${expectedId} must have non-empty description`);
    }
  });

  // 2. Setting definitions valid
  test("2. Every setting in registry belongs to a valid section and has valid scope", () => {
    const sectionIds = new Set(CALENDAR_SETTING_SECTIONS.map((s) => s.id));
    const validScopes = new Set(["global", "calendar", "event"]);

    assert.ok(CALENDAR_SETTINGS_REGISTRY.length >= 20, "Registry must contain comprehensive settings definitions");

    for (const setting of CALENDAR_SETTINGS_REGISTRY) {
      assert.ok(
        sectionIds.has(setting.sectionId),
        `Setting ${setting.id} has invalid section ${setting.sectionId}`
      );
      assert.ok(
        validScopes.has(setting.scope),
        `Setting ${setting.id} has invalid scope ${setting.scope}`
      );
      assert.ok(setting.label.length > 0, `Setting ${setting.id} must have a label`);
      assert.ok(setting.description.length > 0, `Setting ${setting.id} must have a description`);
      assert.ok(Array.isArray(setting.keywords), `Setting ${setting.id} must have keywords array`);
    }
  });

  // 3. Search and filtering
  test("3. Search/filtering finds settings by label, description, and keywords", () => {
    const timeFormatResults = searchCalendarSettings("time format");
    assert.ok(timeFormatResults.some((s) => s.id === "timeFormat"));

    const weekStartResults = searchCalendarSettings("first day");
    assert.ok(weekStartResults.some((s) => s.id === "weekStart"));

    const workingResults = searchCalendarSettings("working hours");
    assert.ok(workingResults.some((s) => s.id === "workingHoursEnabled"));
    assert.ok(workingResults.some((s) => s.id === "workHoursStart"));

    const allResults = searchCalendarSettings("");
    assert.equal(allResults.length, CALENDAR_SETTINGS_REGISTRY.length);

    const emptyResults = searchCalendarSettings("xyznonexistentkeyword123");
    assert.equal(emptyResults.length, 0);
  });

  // 4. Load defaults
  test("4. loadCalendarSettings returns default values when storage is empty", () => {
    (globalThis as any).localStorage.clear();
    const settings = loadCalendarSettings("test_mbox_1");

    assert.equal(settings.language, "en");
    assert.equal(settings.timeFormat, "12h");
    assert.equal(settings.weekStart, "sunday");
    assert.equal(settings.defaultView, "week");
    assert.equal(settings.defaultDuration, 30);
    assert.equal(settings.defaultReminderMinutes, 10);
    assert.equal(settings.showWeekends, true);
    assert.equal(settings.workingHoursEnabled, false);
    assert.deepEqual(settings.workingDays, [1, 2, 3, 4, 5]);
    assert.equal(settings.offlineStorageEnabled, true);
  });

  // 5. Save and reload
  await test("5. saveCalendarSettings and loadCalendarSettings persist and restore preferences", async () => {
    (globalThis as any).localStorage.clear();
    const customSettings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      timeFormat: "24h",
      weekStart: "monday",
      defaultView: "month",
      defaultDuration: 45,
      showWeekends: false,
      workingHoursEnabled: true,
      workHoursStart: "08:30",
      workHoursEnd: "16:30",
    };

    const saveResult = await saveCalendarSettings(customSettings, "test_mbox_save");
    assert.ok(saveResult.success, "Save must succeed");

    const reloaded = loadCalendarSettings("test_mbox_save");
    assert.equal(reloaded.timeFormat, "24h");
    assert.equal(reloaded.weekStart, "monday");
    assert.equal(reloaded.defaultView, "month");
    assert.equal(reloaded.defaultDuration, 45);
    assert.equal(reloaded.showWeekends, false);
    assert.equal(reloaded.workingHoursEnabled, true);
    assert.equal(reloaded.workHoursStart, "08:30");
    assert.equal(reloaded.workHoursEnd, "16:30");
  });

  // 6. Three-level configuration scope separation
  test("6. Three-level configuration scope separation: global vs calendar vs event", () => {
    (globalThis as any).localStorage.clear();

    const globalDefault = 10;

    saveCalendarOverrides("mbox_scope", "cal_important", {
      defaultReminderMinutes: 30,
      colorOverride: "#B85D38",
    });

    const calOverrides = loadCalendarOverrides("mbox_scope", "cal_important");
    assert.equal(calOverrides.defaultReminderMinutes, 30);
    assert.equal(calOverrides.colorOverride, "#B85D38");

    const otherCal = loadCalendarOverrides("mbox_scope", "cal_general");
    assert.equal(otherCal.defaultReminderMinutes, undefined);

    // Precedence resolution:
    // Case A: Event override takes highest priority
    const effectiveA = resolveEffectiveReminder(globalDefault, calOverrides.defaultReminderMinutes, [15, 60]);
    assert.deepEqual(effectiveA, [15, 60]);

    // Case B: In absence of event override, calendar-level override applies
    const effectiveB = resolveEffectiveReminder(globalDefault, calOverrides.defaultReminderMinutes, undefined);
    assert.deepEqual(effectiveB, [30]);

    // Case C: In absence of both event and calendar override, global default applies
    const effectiveC = resolveEffectiveReminder(globalDefault, otherCal.defaultReminderMinutes, undefined);
    assert.deepEqual(effectiveC, [10]);
  });

  // 7. World clock cities
  await test("7. World clock cities configuration can be modified and restored", async () => {
    (globalThis as any).localStorage.clear();
    const settings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      worldClockCities: [
        { id: "c1", label: "Paris", timeZone: "Europe/Paris" },
        { id: "c2", label: "Tokyo", timeZone: "Asia/Tokyo" },
      ],
    };

    await saveCalendarSettings(settings, "mbox_worldclock");
    const loaded = loadCalendarSettings("mbox_worldclock");

    assert.equal(loaded.worldClockCities.length, 2);
    assert.equal(loaded.worldClockCities[0].label, "Paris");
    assert.equal(loaded.worldClockCities[0].timeZone, "Europe/Paris");
    assert.equal(loaded.worldClockCities[1].label, "Tokyo");
    assert.equal(loaded.worldClockCities[1].timeZone, "Asia/Tokyo");
  });

  return { passed, failed };
}

// Standalone execution support
if (process.argv[1]?.endsWith("calendar_settings.test.ts") || process.argv[1]?.endsWith("calendar_settings.test.js")) {
  runCalendarSettingsTests().then(({ passed, failed }) => {
    console.log(`\nCALENDAR SETTINGS TESTS: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  });
}
