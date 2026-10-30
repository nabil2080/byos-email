import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOverlappingEventsVerification() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: OVERLAPPING EVENTS COLLISION & MINIMAL SETTINGS AUDIT        ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
    });

    console.log("--- [STEP 1] Login as alice@byos.local ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Authenticated successfully as Alice");

    console.log("\n--- [STEP 2] Switch to Calendar View ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);

    console.log("\n--- [STEP 3] Switch to Week View ---");
    const weekBtn = await page.waitForSelector('[data-testid="view-week-btn"]', { timeout: 5000 });
    await weekBtn.click();
    await sleep(800);

    // Create 3 overlapping events on today:
    // Event 1: Executive Strategy Sync (10:00 - 11:30)
    // Event 2: 1:1 Sync (10:00 - 11:00)
    // Event 3: Engineering Standup (10:30 - 12:00)
    console.log("\n--- [STEP 4] Create 3 Overlapping Timed Events ---");
    const createEvent = async (title, startHour, startMin, endHour, endMin) => {
      const createBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
      await createBtn.click();
      await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
      await sleep(300);

      // Fill Title
      await page.type('[data-testid="event-title-input"]', title);

      // Set Start/End Time
      const sH = String(startHour).padStart(2, '0');
      const sM = String(startMin).padStart(2, '0');
      const eH = String(endHour).padStart(2, '0');
      const eM = String(endMin).padStart(2, '0');

      await page.evaluate((s, e) => {
        const sInput = document.querySelector('[data-testid="event-start-time-input"]');
        const eInput = document.querySelector('[data-testid="event-end-time-input"]');
        if (sInput) {
          sInput.value = s;
          sInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (eInput) {
          eInput.value = e;
          eInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, `${sH}:${sM}`, `${eH}:${eM}`);

      // Save Event
      await page.click('[data-testid="save-event-btn"]');
      await page.waitForFunction(() => document.querySelector('[data-testid="event-modal"]') === null, { timeout: 8000 });
      await sleep(800);
    };

    await createEvent("Executive Strategy Sync", 10, 0, 11, 30);
    await createEvent("1:1 Sync", 10, 0, 11, 0);
    await createEvent("Engineering Standup", 10, 30, 12, 0);
    console.log("  Successfully saved 3 overlapping events");

    console.log("\n--- [STEP 5] Verify Side-by-Side Collision Layout in WeekView ---");
    const pillsInfo = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('[data-testid="calendar-event-pill"]'));
      return pills
        .map((p) => {
          const rect = p.getBoundingClientRect();
          const text = p.textContent || "";
          return {
            text,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            top: rect.top,
            height: rect.height,
            styleLeft: p.style.left,
            styleWidth: p.style.width,
          };
        })
        .filter((p) =>
          p.text.includes("Executive Strategy Sync") ||
          p.text.includes("1:1 Sync") ||
          p.text.includes("Engineering Standup")
        );
    });

    console.log("  Detected Overlapping Event Pills:", pillsInfo);
    assert(pillsInfo.length >= 3, "At least 3 overlapping event pills rendered in DOM");

    // Assert that style.width is distributed into parallel lanes (not 100% full width)
    const hasParallelLanes = pillsInfo.some((p) => p.styleWidth && !p.styleWidth.includes("100%"));
    assert(hasParallelLanes, "Overlapping events have lane-divided width styles (side-by-side)");

    // Capture WeekView screenshot
    const weekScreenshot = path.resolve(artifactsDir, 'calendar_overlapping_events_weekview.png');
    await page.screenshot({ path: weekScreenshot });
    console.log(`  Saved screenshot: ${weekScreenshot}`);

    console.log("\n--- [STEP 6] Verify Side-by-Side Collision Layout in DayView ---");
    const dayBtn = await page.waitForSelector('[data-testid="view-day-btn"]', { timeout: 5000 });
    await dayBtn.click();
    await sleep(800);

    const dayScreenshot = path.resolve(artifactsDir, 'calendar_overlapping_events_dayview.png');
    await page.screenshot({ path: dayScreenshot });
    console.log(`  Saved screenshot: ${dayScreenshot}`);

    console.log("\n--- [STEP 7] Verify Minimal Clean Calendar Settings Surface ---");
    await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="calendar-settings-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 10000 });
    await sleep(600);

    // Verify unified grouped card surface
    const settingItemsCount = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid^="setting-item-"]').length;
    });
    console.log(`  Rendered setting items in active view: ${settingItemsCount}`);
    assert(settingItemsCount >= 5, "Settings are cleanly rendered in unified section list");

    // Verify scope badges are eliminated
    const badgeCount = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('span')).filter(s =>
        s.textContent?.includes("Global preference") ||
        s.textContent?.includes("Calendar default") ||
        s.textContent?.includes("Event override")
      ).length;
    });
    console.log(`  Internal engineering scope badges count: ${badgeCount}`);
    assert(badgeCount === 0, "Zero internal engineering scope badges rendered (clean Google Calendar surface)");

    const settingsScreenshot = path.resolve(artifactsDir, 'calendar_settings_minimal_clean.png');
    await page.screenshot({ path: settingsScreenshot });
    console.log(`  Saved screenshot: ${settingsScreenshot}`);

    console.log("\n================================================================================");
    console.log("   ALL OVERLAPPING EVENT COLLISION & CLEAN SETTINGS AUDITS PASSED                ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

runOverlappingEventsVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
