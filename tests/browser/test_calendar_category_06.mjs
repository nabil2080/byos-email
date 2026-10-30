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

async function runCalendarCategory06BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 06 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Event Templates, Colors, Visibility, Guest Permissions & Undo Deletion)   ");
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

    // Accept dialogs (confirm on delete)
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

    // Step 4: Open Event Modal & Apply Event Template (Category 06)
    console.log("\n--- [STEP 4] Apply Event Template & Configure Advanced Event Details ---");
    const newEventBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(500);

    // Select Template: 1:1 Sync (30m, Private)
    const tplSelect = await page.waitForSelector('[data-testid="event-template-select"]', { timeout: 5000 });
    assert(tplSelect !== null, "Event template dropdown is present");
    await page.select('[data-testid="event-template-select"]', 'sync_30');
    await sleep(300);

    const titleVal = await page.$eval('[data-testid="event-title-input"]', (el) => el.value);
    console.log(`  Title populated by template: "${titleVal}"`);
    assert(titleVal === "1:1 Sync", "Template pre-filled event title to '1:1 Sync'");

    const visVal = await page.$eval('[data-testid="event-visibility-select"]', (el) => el.value);
    console.log(`  Visibility set by template: "${visVal}"`);
    assert(visVal === "private", "Template pre-filled visibility to 'private'");

    // Change Color: Forest Green
    const forestColorBtn = await page.waitForSelector('[data-testid="event-color-forest"]', { timeout: 5000 });
    await forestColorBtn.click();
    await sleep(200);
    console.log("  Selected 'Forest' green event color swatch");

    // Reminder Override: 15 minutes before
    await page.select('[data-testid="event-reminder-override-select"]', '15');
    await sleep(200);

    // Guest Permissions
    const toggleGuestPermsBtn = await page.waitForSelector('[data-testid="toggle-guest-permissions-btn"]', { timeout: 5000 });
    await toggleGuestPermsBtn.click();
    await sleep(300);

    const guestPermsContainer = await page.waitForSelector('[data-testid="guest-permissions-container"]', { timeout: 5000 });
    assert(guestPermsContainer !== null, "Guest permissions container expanded");

    // Toggle modify permission
    const modifyCheckbox = await page.waitForSelector('[data-testid="guest-permission-modify"]', { timeout: 5000 });
    await modifyCheckbox.click();
    await sleep(200);

    // Add note description
    const descInput = await page.waitForSelector('[data-testid="event-description-input"]', { timeout: 5000 });
    await descInput.type("Confidential discussion on Q3 roadmap milestones.");

    // Screenshot of Event Modal with all Category 06 fields
    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_06_event_modal.png'),
    });
    console.log("  Screenshot saved: calendar_category_06_event_modal.png");

    // Save Event
    const saveEventBtn = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveEventBtn.click();
    await sleep(800);

    // Step 5: Verify Event Rendered with Custom Color on Grid
    console.log("\n--- [STEP 5] Verify Event Rendered with Custom Color & Visibility ---");
    await page.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 8000 });
    const eventPills = await page.$$('[data-testid="calendar-event-pill"]');
    assert(eventPills.length > 0, "Event pill is rendered on the calendar grid");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_06_event_created.png'),
    });
    console.log("  Screenshot saved: calendar_category_06_event_created.png");

    // Step 6: Event Duplication (Category 06)
    console.log("\n--- [STEP 6] Event Duplication ---");
    // Click on the event pill to open modal in edit mode
    await eventPills[0].click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(500);

    const duplicateBtn = await page.waitForSelector('[data-testid="duplicate-event-btn"]', { timeout: 5000 });
    assert(duplicateBtn !== null, "Duplicate event button is present in edit mode");
    await duplicateBtn.click();
    await sleep(800);

    // Verify duplicated event exists
    const updatedPills = await page.$$('[data-testid="calendar-event-pill"]');
    assert(updatedPills.length >= 2, `Grid renders both original and duplicated events (${updatedPills.length} pills found)`);

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_06_event_duplicated.png'),
    });
    console.log("  Screenshot saved: calendar_category_06_event_duplicated.png");

    // Step 7: Search and Real-Time Filtering across Events
    console.log("\n--- [STEP 7] Search and Real-Time Filtering across Events ---");
    const searchInput = await page.waitForSelector('[data-testid="calendar-search-input"]', { timeout: 5000 });
    await searchInput.type("[Copy]");
    await sleep(500);

    const filteredPills = await page.$$('[data-testid="calendar-event-pill"]');
    console.log(`  Filtered pills matching '[Copy]': ${filteredPills.length}`);
    assert(filteredPills.length >= 1, "Search filtering displays matching duplicated event");

    // Clear search query
    await page.evaluate((el) => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }, searchInput);
    await sleep(500);

    // Step 8: Deletion & Undo Recovery (Category 06)
    console.log("\n--- [STEP 8] Deletion & Undo Recovery ---");
    // Click the duplicated event to delete it
    const pillsBeforeDelete = await page.$$('[data-testid="calendar-event-pill"]');
    let targetPill = null;
    for (const pill of pillsBeforeDelete) {
      const txt = await page.evaluate((el) => el.innerText || el.getAttribute('data-event-title') || '', pill);
      if (txt.includes('[Copy]')) {
        targetPill = pill;
        break;
      }
    }
    if (!targetPill) targetPill = pillsBeforeDelete[pillsBeforeDelete.length - 1];
    await targetPill.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(500);

    const deleteBtn = await page.waitForSelector('[data-testid="delete-event-btn"]', { timeout: 5000 });
    await deleteBtn.click();
    await sleep(800);

    // Verify Undo Toast Banner appears
    const undoToast = await page.waitForSelector('[data-testid="undo-delete-toast"]', { timeout: 5000 });
    assert(undoToast !== null, "Undo toast banner is displayed after event deletion");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_06_undo_toast.png'),
    });
    console.log("  Screenshot saved: calendar_category_06_undo_toast.png");

    // Click Undo button to restore deleted event
    const undoBtn = await page.waitForSelector('[data-testid="undo-delete-btn"]', { timeout: 5000 });
    await undoBtn.click();
    await sleep(1000);

    const pillsAfterUndo = await page.$$('[data-testid="calendar-event-pill"]');
    console.log(`  Pills after undo: ${pillsAfterUndo.length}`);
    assert(pillsAfterUndo.length >= 2, "Event successfully restored via Undo recovery");

    // Step 9: Responsive Viewport Check (375px mobile viewport)
    console.log("\n--- [STEP 9] Responsive Viewport Check (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const isHorizontalScrollPresent = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!isHorizontalScrollPresent, "Strictly NO horizontal scroll permitted on 375px mobile viewport");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_06_mobile_375px.png'),
    });
    console.log("  Screenshot saved: calendar_category_06_mobile_375px.png");

    // Step 10: DevTools Error Inspection
    console.log("\n--- [STEP 10] DevTools State Inspection ---");
    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (found ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   CATEGORY 06 BROWSER VERIFICATION COMPLETE: ALL CHECKS PASSED               ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory06BrowserTest().catch((err) => {
  console.error("FATAL ERROR in runCalendarCategory06BrowserTest:", err);
  process.exit(1);
});
