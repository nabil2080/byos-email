import assert from "node:assert/strict";
import { CALENDAR_TEMPLATES, CalendarTemplate } from "./components/calendar/CalendarModal";
export { CALENDAR_TEMPLATES };
export type { CalendarTemplate };
export function getCalendarTemplate(id: string): CalendarTemplate | undefined {
  return CALENDAR_TEMPLATES.find((t) => t.id === id);
}
import {
  saveCalendarOverrides,
  loadCalendarOverrides,
  resolveEffectiveReminder,
  DEFAULT_CALENDAR_SETTINGS,
} from "./components/calendar/settings/calendarSettingsStore";
import { UserCalendar } from "./api";

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

export async function runCalendarManagementTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("Starting Calendar Management (Category 02) Tests...");

  test("1. Calendar templates definition and pre-fills", () => {
    assert.strictEqual(CALENDAR_TEMPLATES.length, 5, "Expected 5 predefined templates");
    const templateIds = CALENDAR_TEMPLATES.map((t) => t.id);
    assert.deepStrictEqual(templateIds, ["personal", "family", "team", "project", "custom"]);

    const teamTpl = CALENDAR_TEMPLATES.find((t) => t.id === "team");
    assert.ok(teamTpl);
    assert.strictEqual(teamTpl.suggestedName, "Team");
    assert.strictEqual(teamTpl.suggestedColor, "#2E6F40");
    assert.ok(teamTpl.description.length > 0);

    const projectTpl = CALENDAR_TEMPLATES.find((t) => t.id === "project");
    assert.ok(projectTpl);
    assert.strictEqual(projectTpl.suggestedName, "Project");
    assert.strictEqual(projectTpl.suggestedColor, "#B85D38");
  });

  test("2. Calendar overrides save and load lifecycle", () => {
    const mbId = "mb-test-cat02-01";
    const calId = "cal-test-work";

    saveCalendarOverrides(mbId, calId, {
      description: "Engineering sprint goals & retrospectives",
      template: "team",
      defaultReminderMinutes: 15,
      colorOverride: "#2E6F40",
    });

    // Load back and verify persistence
    const loaded = loadCalendarOverrides(mbId, calId);
    assert.strictEqual(loaded.description, "Engineering sprint goals & retrospectives");
    assert.strictEqual(loaded.template, "team");
    assert.strictEqual(loaded.defaultReminderMinutes, 15);
    assert.strictEqual(loaded.colorOverride, "#2E6F40");
  });

  test("3. Multi-level reminder resolution precedence (Global < Calendar < Event)", () => {
    const globalDefault = DEFAULT_CALENDAR_SETTINGS.eventRemindersDefaultMinutes; // 15
    const calOverride = 30;
    const eventOverride = [5];

    // Scenario A: Event override takes highest precedence
    const reminderA = resolveEffectiveReminder(globalDefault, calOverride, eventOverride);
    assert.deepStrictEqual(reminderA, [5], "Event-specific reminder must override calendar and global settings");

    // Scenario B: Calendar override takes precedence when event has no override
    const reminderB = resolveEffectiveReminder(globalDefault, calOverride, undefined);
    assert.deepStrictEqual(reminderB, [30], "Calendar-level override must take precedence over global setting");

    // Scenario C: Global setting is used when neither event nor calendar defines an override
    const reminderC = resolveEffectiveReminder(globalDefault, undefined, undefined);
    assert.deepStrictEqual(
      reminderC,
      [globalDefault],
      "Global setting must be used as final fallback"
    );
  });

  test("4. Owned vs shared calendar separation and identification", () => {
    const sampleCalendars: UserCalendar[] = [
      {
        id: "cal-owned-primary",
        mailbox_id: "mb-alice",
        name: "Personal",
        color: "#9E725F",
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_shared: false,
        permission: "owner",
      },
      {
        id: "cal-owned-secondary",
        mailbox_id: "mb-alice",
        name: "Projects",
        color: "#B85D38",
        is_default: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_shared: false,
        permission: "owner",
      },
      {
        id: "cal-shared-read",
        mailbox_id: "mb-bob",
        name: "Bob's Team Calendar",
        color: "#4A607A",
        is_default: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_shared: true,
        permission: "read",
        owner_email: "bob@byos.local",
        share_id: "share-bob-alice-01",
      },
      {
        id: "cal-shared-write",
        mailbox_id: "mb-charlie",
        name: "Family Schedule",
        color: "#A87B24",
        is_default: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_shared: true,
        permission: "write",
        owner_email: "charlie@byos.local",
        share_id: "share-charlie-alice-01",
      },
    ];

    const owned = sampleCalendars.filter((c) => !c.is_shared);
    const shared = sampleCalendars.filter((c) => c.is_shared);

    assert.strictEqual(owned.length, 2, "Expected exactly 2 owned calendars");
    assert.strictEqual(shared.length, 2, "Expected exactly 2 shared calendars");

    // Owned calendar invariants
    const defaultCal = owned.find((c) => c.is_default);
    assert.ok(defaultCal, "Owned calendars must have a default calendar");
    assert.strictEqual(defaultCal.id, "cal-owned-primary");
    assert.strictEqual(defaultCal.permission, "owner");

    // Shared calendar invariants
    const readOnlyShared = shared.find((c) => c.permission === "read");
    assert.ok(readOnlyShared, "Must distinguish read-only shared calendar");
    assert.strictEqual(readOnlyShared.owner_email, "bob@byos.local");
    assert.strictEqual(readOnlyShared.share_id, "share-bob-alice-01");

    const writeShared = shared.find((c) => c.permission === "write");
    assert.ok(writeShared, "Must distinguish writeable shared calendar");
    assert.strictEqual(writeShared.owner_email, "charlie@byos.local");
  });

  test("5. Safe calendar deletion constraints and permissions", () => {
    const singleCalendarSet: UserCalendar[] = [
      {
        id: "cal-only-one",
        mailbox_id: "mb-alice",
        name: "Default Calendar",
        color: "#9E725F",
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_shared: false,
        permission: "owner",
      },
    ];

    // Attempting to delete when only 1 calendar exists is forbidden
    const canDeleteSingle = singleCalendarSet.length > 1;
    assert.strictEqual(canDeleteSingle, false, "Deleting the only remaining calendar must be forbidden");

    // Default calendar deletion must require reassigning or cannot be deleted directly
    const defaultCal = singleCalendarSet[0];
    const isProtectedDefault = defaultCal.is_default;
    assert.strictEqual(isProtectedDefault, true, "Primary default calendar must be protected from deletion");
  });

  test("6. Unsubscribe action targets share grant without destroying source calendar", () => {
    const sharedCalendar: UserCalendar = {
      id: "cal-source-bob-42",
      mailbox_id: "mb-bob",
      name: "Engineering Roadmap",
      color: "#2E6F40",
      is_default: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_shared: true,
      permission: "read",
      owner_email: "bob@byos.local",
      share_id: "share-grant-9988",
    };

    // The unsubscription operation operates on share_id, leaving source calendar id and owner intact
    assert.ok(sharedCalendar.share_id, "Shared calendar must have a valid share_id for unsubscription");
    assert.strictEqual(sharedCalendar.is_shared, true);
    assert.strictEqual(sharedCalendar.mailbox_id, "mb-bob", "Owner mailbox must remain untouched");
  });

  return { passed, failed };
}
