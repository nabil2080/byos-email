import assert from "node:assert";
import { parseNaturalLanguageEvent, detectCategory } from "./kashcalParser.js";

export async function runKashcalParserTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✗ ${name}: ${err?.message}`);
    }
  }

  const refDate = new Date(2026, 10, 5, 10, 0, 0); // Thursday Nov 5, 2026 10:00 AM

  test("parses category keywords correctly", () => {
    assert.strictEqual(detectCategory("Coffee with Sarah"), "coffee");
    assert.strictEqual(detectCategory("Lunch with team at pizzeria"), "food");
    assert.strictEqual(detectCategory("Team sync 1:1"), "meeting");
    assert.strictEqual(detectCategory("Flight to London Heathrow"), "flight");
    assert.strictEqual(detectCategory("Quick phone call with client"), "call");
    assert.strictEqual(detectCategory("Dentist checkup"), "health");
    assert.strictEqual(detectCategory("Morning gym workout"), "workout");
    assert.strictEqual(detectCategory("Alice birthday party"), "party");
    assert.strictEqual(detectCategory("Focus time coding session"), "focus");
    assert.strictEqual(detectCategory("Read books"), "focus");
    assert.strictEqual(detectCategory("Random generic task"), "general");
  });

  test("parses 'Coffee with Sarah tomorrow 3pm'", () => {
    const res = parseNaturalLanguageEvent("Coffee with Sarah tomorrow 3pm", refDate);
    assert.strictEqual(res.title, "Coffee with Sarah");
    assert.strictEqual(res.category, "coffee");
    assert.strictEqual(res.hasExplicitDate, true);
    assert.strictEqual(res.hasExplicitTime, true);
    assert.strictEqual(res.startDate.getDate(), 6); // Nov 6
    assert.strictEqual(res.startDate.getMonth(), 10); // Nov
    assert.strictEqual(res.startDate.getHours(), 15);
    assert.strictEqual(res.startDate.getMinutes(), 0);
    assert.strictEqual(res.durationMinutes, 60);
    assert.strictEqual(res.endDate.getHours(), 16);
  });

  test("parses 'Design review Friday 10am 45m'", () => {
    const res = parseNaturalLanguageEvent("Design review Friday 10am 45m", refDate);
    assert.strictEqual(res.category, "meeting");
    assert.strictEqual(res.hasExplicitDate, true);
    assert.strictEqual(res.hasExplicitTime, true);
    assert.strictEqual(res.startDate.getDate(), 6); // Nov 6 (next Friday)
    assert.strictEqual(res.startDate.getHours(), 10);
    assert.strictEqual(res.durationMinutes, 45);
    assert.strictEqual(res.endDate.getHours(), 10);
    assert.strictEqual(res.endDate.getMinutes(), 45);
  });

  test("parses time range 'Team standup 2pm-3:30pm'", () => {
    const res = parseNaturalLanguageEvent("Team standup 2pm-3:30pm", refDate);
    assert.strictEqual(res.category, "meeting");
    assert.strictEqual(res.hasExplicitTime, true);
    assert.strictEqual(res.startDate.getHours(), 14);
    assert.strictEqual(res.startDate.getMinutes(), 0);
    assert.strictEqual(res.endDate.getHours(), 15);
    assert.strictEqual(res.endDate.getMinutes(), 30);
    assert.strictEqual(res.durationMinutes, 90);
  });

  test("parses explicit date 'Dentist appointment Nov 12 at 2pm'", () => {
    const res = parseNaturalLanguageEvent("Dentist appointment Nov 12 at 2pm", refDate);
    assert.strictEqual(res.category, "health");
    assert.strictEqual(res.hasExplicitDate, true);
    assert.strictEqual(res.startDate.getMonth(), 10); // Nov
    assert.strictEqual(res.startDate.getDate(), 12);
    assert.strictEqual(res.startDate.getHours(), 14);
  });

  test("parses all-day event 'Alice Birthday Nov 20 all-day'", () => {
    const res = parseNaturalLanguageEvent("Alice Birthday Nov 20 all-day", refDate);
    assert.strictEqual(res.category, "party");
    assert.strictEqual(res.isAllDay, true);
    assert.strictEqual(res.startDate.getDate(), 20);
  });

  return { passed, failed };
}
