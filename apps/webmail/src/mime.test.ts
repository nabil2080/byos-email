import { parseMime, getHeader } from "./mime.js";
import { buildMimeString } from "./App.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runMimeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running MIME Parser Tests...");

  // 1. Simple text/plain message — textPlain extracted, headers stripped
  test("1. Simple text/plain message — textPlain extracted, headers stripped", () => {
    const raw = [
      "From: alice@byos.local",
      "To: bob@byos.local",
      "Subject: Hello Plain",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "This is a simple plain text body.",
      "With multiple lines.",
    ].join("\r\n");

    const parsed = parseMime(raw);
    assert(
      parsed.textPlain === "This is a simple plain text body.\nWith multiple lines." ||
      parsed.textPlain === "This is a simple plain text body.\r\nWith multiple lines.",
      `Unexpected textPlain: ${parsed.textPlain}`
    );
    assert(parsed.textHtml === null, "textHtml should be null");
  });

  // 2. Simple text/html message — textHtml extracted
  test("2. Simple text/html message — textHtml extracted", () => {
    const raw = [
      "From: alice@byos.local",
      "To: bob@byos.local",
      "Subject: Hello HTML",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>This is a simple <strong>HTML</strong> body.</p>",
    ].join("\r\n");

    const parsed = parseMime(raw);
    assert(parsed.textPlain === null, "textPlain should be null");
    assert(
      parsed.textHtml === "<p>This is a simple <strong>HTML</strong> body.</p>",
      `Unexpected textHtml: ${parsed.textHtml}`
    );
  });

  // 3. multipart/alternative with plain+html — both extracted
  test("3. multipart/alternative with plain+html — both extracted", () => {
    const raw = buildMimeString({
      to: "bob@byos.local",
      subject: "Test Multipart",
      signedBody: "Plain body content\n-- \nAlice",
      htmlBody: "<p>HTML body content</p><p>-- </p><p>Alice</p>",
    });

    const parsed = parseMime(raw);
    assert(parsed.textPlain !== null, "textPlain should not be null");
    assert(parsed.textPlain!.includes("Plain body content"), "textPlain should include plaintext");
    assert(parsed.textHtml !== null, "textHtml should not be null");
    assert(parsed.textHtml!.includes("<p>HTML body content</p>"), "textHtml should include html");
  });

  // 4. multipart/alternative with only html — html only
  test("4. multipart/alternative with only html — html only", () => {
    const boundary = "----=_Part_only_html_123";
    const raw = [
      "To: bob@byos.local",
      "Subject: HTML Only",
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Only HTML content here</p>",
      `--${boundary}--`,
    ].join("\r\n");

    const parsed = parseMime(raw);
    assert(parsed.textPlain === null, `textPlain should be null, got: ${parsed.textPlain}`);
    assert(
      parsed.textHtml === "<p>Only HTML content here</p>",
      `Unexpected textHtml: ${parsed.textHtml}`
    );
  });

  // 5. Multipart with quoted boundary and nested parts
  test("5. Multipart with quoted boundary and nested parts", () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="outer-boundary-xyz"',
      "Subject: Nested Test",
      "",
      "--outer-boundary-xyz",
      'Content-Type: multipart/alternative; boundary="inner-boundary-abc"',
      "",
      "--inner-boundary-abc",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Nested plain text body",
      "--inner-boundary-abc",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Nested HTML body</p>",
      "--inner-boundary-abc--",
      "--outer-boundary-xyz--",
    ].join("\r\n");

    const parsed = parseMime(raw);
    assert(parsed.textPlain === "Nested plain text body", `Unexpected textPlain: ${parsed.textPlain}`);
    assert(parsed.textHtml === "<p>Nested HTML body</p>", `Unexpected textHtml: ${parsed.textHtml}`);
  });

  // 6. Malformed input (no headers) — falls back to treating whole input as plaintext
  test("6. Malformed input (no headers) — falls back to treating whole input as plaintext", () => {
    const raw = "This is a malformed raw message without any MIME headers at all.";
    const parsed = parseMime(raw);
    assert(parsed.textPlain === raw, `Expected plaintext fallback, got: ${parsed.textPlain}`);
    assert(parsed.textHtml === null, "textHtml should be null");
  });

  // 7. Real message with tracked pixel in HTML part — parsed correctly
  test("7. Real message with tracked pixel in HTML part — parsed correctly", () => {
    const raw = buildMimeString({
      to: "bob@byos.local",
      subject: "Tracked Message",
      signedBody: "Message with tracking pixel\n-- \nAlice",
      htmlBody: "<p>Message with tracking pixel</p><p>-- </p><p>Alice</p>",
      trackingToken: "tok_pixel_12345",
    });

    const parsed = parseMime(raw);
    assert(parsed.textPlain !== null, "textPlain should not be null");
    assert(parsed.textPlain!.includes("Message with tracking pixel"), "textPlain must match");
    assert(parsed.textHtml !== null, "textHtml should not be null");
    assert(parsed.textHtml!.includes("<p>Message with tracking pixel</p>"), "HTML content must match");
    assert(parsed.textHtml!.includes('src="'), "HTML should contain tracking pixel img tag");
    assert(parsed.textHtml!.includes("tok_pixel_12345"), "HTML should contain tracking token");
  });

  // 8. Direct text/calendar MIME message
  test("8. Direct text/calendar MIME message extracts calendarPart and method", () => {
    const raw = [
      "From: alice@byos.local",
      "To: bob@byos.local",
      "Subject: Invitation: Sync",
      'Content-Type: text/calendar; method=REQUEST; charset="utf-8"',
      "",
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "SUMMARY:Sync",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseMime(raw);
    assert(parsed.calendarPart != null, "calendarPart should not be null");
    assert(parsed.calendarPart!.method === "REQUEST", `Expected REQUEST, got: ${parsed.calendarPart!.method}`);
    assert(parsed.calendarPart!.rawIcs.includes("BEGIN:VCALENDAR"), "rawIcs should contain calendar data");
  });

  // 9. multipart/alternative with plain, html, and calendar
  test("9. multipart/alternative with plain, html, and calendar", () => {
    const boundary = "----=_Part_alt_cal_456";
    const raw = [
      "To: bob@byos.local",
      "Subject: Meeting Invitation",
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Please join our meeting.",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Please join our meeting.</p>",
      `--${boundary}`,
      'Content-Type: text/calendar; method=REQUEST; charset="utf-8"',
      "",
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:meet-1",
      "SUMMARY:Project Review",
      "END:VEVENT",
      "END:VCALENDAR",
      `--${boundary}--`,
    ].join("\r\n");

    const parsed = parseMime(raw);
    assert(parsed.textPlain === "Please join our meeting.", "textPlain mismatch");
    assert(parsed.textHtml === "<p>Please join our meeting.</p>", "textHtml mismatch");
    assert(parsed.calendarPart != null, "calendarPart should not be null");
    assert(parsed.calendarPart!.method === "REQUEST", "calendarPart method should be REQUEST");
    assert(parsed.calendarPart!.rawIcs.includes("UID:meet-1"), "calendarPart should contain VEVENT");
  });

  // 10. Inline BEGIN:VCALENDAR fallback in plaintext
  test("10. Inline BEGIN:VCALENDAR fallback in plaintext", () => {
    const raw = [
      "Subject: Calendar Invite",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Here is your invite:",
      "BEGIN:VCALENDAR",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      "UID:inline-1",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    const parsed = parseMime(raw);
    assert(parsed.calendarPart != null, "Should detect inline calendarPart");
    assert(parsed.calendarPart!.rawIcs.includes("UID:inline-1"), "Should extract inline VCALENDAR");
  });

  return { passed, failed };
}
