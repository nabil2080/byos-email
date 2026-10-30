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

async function runCalendarCategory07BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 07 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Recurrence Rules, Weekday Toggles, Detached Exceptions & Cancellations)   ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message);
      console.error(`  [PAGE ERROR]: ${err.message}`);
    });

    // Accept confirm dialogs
    page.on('dialog', async (dialog) => {
      console.log(`  [DIALOG] Prompt: "${dialog.message()}", accepting...`);
      await dialog.accept();
    });

    // Step 1: Navigate to Webmail & Clear Storage
    console.log("\n--- [STEP 1] Navigate to Webmail & Clear Storage ---");
    let baseUrl = 'http://127.0.0.1:3001';
    for (const port of [3001, 3002, 3003]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        if (res.ok) {
          baseUrl = `http://127.0.0.1:${port}`;
          break;
        }
      } catch {}
    }
    console.log(`  Target server: ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    // Step 2: Real Login Flow for alice@byos.local
    console.log("\n--- [STEP 2] Real Login Flow for alice@byos.local ---");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await sleep(300);
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(800);
    const activeAccountChip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeAccountChip}"`);
    assert(activeAccountChip === "alice@byos.local", "User authenticated as alice@byos.local");

    // Step 3: Navigate to Calendar View
    console.log("\n--- [STEP 3] Navigate to Calendar View ---");
    const calendarNavBtn = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 8000 });
    await calendarNavBtn.click();
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);
    console.log("  Calendar interface loaded");

    // Step 4: Open Event Modal and Configure Weekly Recurring Event
    console.log("\n--- [STEP 4] Configure Weekly Recurrence with Custom Weekdays & Count ---");
    const newEventBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(400);

    // Title
    const titleInput = await page.waitForSelector('[data-testid="event-title-input"]', { timeout: 5000 });
    await titleInput.type('Engineering Standup');

    // Select Repeat: Weekly
    const repeatSelect = await page.waitForSelector('[data-testid="event-repeat-select"]', { timeout: 5000 });
    await repeatSelect.select('weekly');
    await sleep(300);

    // Verify Custom Recurrence Panel is visible
    const customPanel = await page.waitForSelector('[data-testid="custom-recurrence-panel"]', { timeout: 5000 });
    assert(customPanel !== null, "Custom recurrence panel is open");

    // Toggle Wednesday and Friday
    const weDayBtn = await page.waitForSelector('[data-testid="recurrence-byday-WE"]', { timeout: 5000 });
    await weDayBtn.click();
    const frDayBtn = await page.waitForSelector('[data-testid="recurrence-byday-FR"]', { timeout: 5000 });
    await frDayBtn.click();
    console.log("  Configured recurrence days: Monday, Wednesday, Friday");

    // Set End Condition: After 6 occurrences
    const countRadio = await page.waitForSelector('[data-testid="recurrence-end-count"]', { timeout: 5000 });
    await countRadio.click();
    const countInput = await page.waitForSelector('[data-testid="recurrence-count-input"]', { timeout: 5000 });
    await page.evaluate((el) => { el.value = '6'; el.dispatchEvent(new Event('input', { bubbles: true })); }, countInput);
    console.log("  Configured termination: After 6 occurrences");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_07_event_modal.png'),
    });
    console.log("  Screenshot saved: calendar_category_07_event_modal.png");

    // Save Event
    const saveEventBtn = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveEventBtn.click();
    await sleep(1000);

    // Step 5: Verify Recurring Events on Grid with Repeat Icons
    console.log("\n--- [STEP 5] Verify Recurring Occurrences Rendered with Repeat Icons ---");
    await page.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 8000 });
    const pills = await page.$$('[data-testid="calendar-event-pill"]');
    assert(pills.length >= 1, `Calendar grid rendered event occurrences (found ${pills.length} pills)`);

    const repeatIcons = await page.$$('[data-testid="recurring-event-icon"]');
    assert(repeatIcons.length >= 1, `Recurring event pills display repeat icon badge (found ${repeatIcons.length})`);

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_07_event_created_series.png'),
    });
    console.log("  Screenshot saved: calendar_category_07_event_created_series.png");

    // Step 6: Detach and Modify a Single Occurrence
    console.log("\n--- [STEP 6] Detach and Modify Single Occurrence ('Only this event') ---");
    // Find pills that belong to Engineering Standup
    const standupPills = await page.$$eval('[data-testid="calendar-event-pill"]', (els) => {
      return els.map((el, i) => ({ index: i, text: el.textContent })).filter((item) => item.text.includes('Engineering Standup'));
    });
    console.log(`  Found ${standupPills.length} standup occurrence pills`);
    assert(standupPills.length >= 1, "Standup recurring pills found on grid");

    const allPills = await page.$$('[data-testid="calendar-event-pill"]');
    await allPills[standupPills[0].index].click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(500);

    // Ensure scope container is visible
    const scopeContainer = await page.waitForSelector('[data-testid="recurring-scope-container"]', { timeout: 5000 });
    assert(scopeContainer !== null, "Recurring scope choice container is present in edit mode");

    // Click "Only this event"
    const scopeOccurrenceBtn = await page.waitForSelector('[data-testid="scope-occurrence-btn"]', { timeout: 5000 });
    await scopeOccurrenceBtn.click();
    await sleep(200);

    // Change title for this occurrence
    const editTitleInput = await page.waitForSelector('[data-testid="event-title-input"]', { timeout: 5000 });
    await page.evaluate((el) => { el.value = ''; }, editTitleInput);
    await editTitleInput.type('Engineering Standup (Sprint Retrospective)');

    // Select color swatch
    const colorSwatches = await page.$$('[data-testid^="color-swatch-"]');
    if (colorSwatches.length > 2) {
      await colorSwatches[2].click();
    }

    // Save detached occurrence
    const saveDetachedBtn = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveDetachedBtn.click();
    await sleep(1000);

    // Verify exception indicator
    const exceptionBadges = await page.$$('[data-testid="exception-event-badge"]');
    assert(exceptionBadges.length >= 1, "Detached modified occurrence displays exception badge");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_07_detached_occurrence.png'),
    });
    console.log("  Screenshot saved: calendar_category_07_detached_occurrence.png");

    // Step 7: Cancel a Single Occurrence
    console.log("\n--- [STEP 7] Cancel Single Occurrence ('Only this event' -> Delete) ---");
    const updatedStandupPills = await page.$$eval('[data-testid="calendar-event-pill"]', (els) => {
      return els.map((el, i) => ({ index: i, text: el.textContent })).filter((item) => item.text.includes('Engineering Standup'));
    });
    const pillCountBeforeCancel = updatedStandupPills.length;
    console.log(`  Standup pills before cancel: ${pillCountBeforeCancel}`);

    const currentPills = await page.$$('[data-testid="calendar-event-pill"]');
    const cancelTargetIdx = updatedStandupPills[updatedStandupPills.length - 1].index;
    await currentPills[cancelTargetIdx].click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(500);

    // Select "Only this event"
    const scopeOccBtn = await page.waitForSelector('[data-testid="scope-occurrence-btn"]', { timeout: 5000 });
    await scopeOccBtn.click();
    await sleep(200);

    // Delete occurrence
    const deleteBtn = await page.waitForSelector('[data-testid="delete-event-btn"]', { timeout: 5000 });
    await deleteBtn.click();
    await sleep(1000);

    const standupPillsAfterCancel = await page.$$eval('[data-testid="calendar-event-pill"]', (els) => {
      return els.map((el, i) => ({ index: i, text: el.textContent })).filter((item) => item.text.includes('Engineering Standup'));
    });
    console.log(`  Standup pills before cancel: ${pillCountBeforeCancel}, after cancel: ${standupPillsAfterCancel.length}`);
    assert(standupPillsAfterCancel.length < pillCountBeforeCancel, "Cancelled occurrence is successfully suppressed from calendar");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_07_cancelled_occurrence.png'),
    });
    console.log("  Screenshot saved: calendar_category_07_cancelled_occurrence.png");

    // Step 8: Responsive Mobile Viewport (375px)
    console.log("\n--- [STEP 8] Responsive Viewport Check (375px mobile) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const isHorizontalScrollPresent = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!isHorizontalScrollPresent, "Strictly NO horizontal scroll permitted on 375px mobile viewport");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_07_mobile_375px.png'),
    });
    console.log("  Screenshot saved: calendar_category_07_mobile_375px.png");

    // Step 9: DevTools State Inspection
    console.log("\n--- [STEP 9] DevTools State Inspection ---");
    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (found ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   CATEGORY 07 BROWSER VERIFICATION COMPLETE: ALL CHECKS PASSED               ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

runCalendarCategory07BrowserTest().catch((err) => {
  console.error("FATAL ERROR in runCalendarCategory07BrowserTest:", err);
  process.exit(1);
});
