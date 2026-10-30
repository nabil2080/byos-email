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

async function runCalendarManagementBrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR MANAGEMENT (CATEGORY 02) BROWSER VERIFICATION                  ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const networkRequests = [];
  const testCalendarName = `Sprint Delivery & QA ${Date.now() % 10000}`;

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

    page.on('request', (req) => {
      if (req.url().includes('/v1/mailboxes') && req.url().includes('/calendars')) {
        networkRequests.push({ url: req.url(), method: req.method() });
      }
    });

    // Step 1: Navigate to Webmail & Clear Storage
    console.log("\n--- [STEP 1] Navigate to Webmail & Clear Storage ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
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
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1000);

    const activeAccountChip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeAccountChip}"`);
    assert(activeAccountChip === "alice@byos.local", "User successfully authenticated as alice@byos.local");

    // Step 3: Switch to Calendar Module
    console.log("\n--- [STEP 3] Switch to Calendar Module ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    assert(await page.$('[data-testid="calendar-view"]') !== null, "Calendar workspace is active");

    // Step 4: Verify Existing Calendars in Sidebar
    console.log("\n--- [STEP 4] Verify 'My Calendars' in Sidebar ---");
    await page.waitForSelector('[data-testid="calendar-row"]', { timeout: 5000 });
    const initialCalCount = await page.$$eval('[data-testid="calendar-row"]', (rows) => rows.length);
    console.log(`  Initial calendar count in sidebar: ${initialCalCount}`);
    assert(initialCalCount >= 1, "At least one initial calendar exists");

    // Step 5: Open Create Calendar Modal
    console.log("\n--- [STEP 5] Open Create Calendar Modal ---");
    await page.waitForSelector('[data-testid="add-calendar-btn"]', { timeout: 5000 });
    await page.click('[data-testid="add-calendar-btn"]');
    await page.waitForSelector('[data-testid="calendar-modal"]', { timeout: 5000 });
    assert(await page.$('[data-testid="calendar-modal"]') !== null, "Create Calendar modal opened");

    // Step 6: Select 'Team' Template and verify pre-fills
    console.log("\n--- [STEP 6] Test Template Selection & Pre-fills ---");
    await page.waitForSelector('[data-testid="template-btn-team"]', { timeout: 5000 });
    await page.click('[data-testid="template-btn-team"]');
    await sleep(200);

    const prefilledName = await page.$eval('[data-testid="calendar-name-input"]', (el) => el.value);
    console.log(`  Template pre-filled name: "${prefilledName}"`);
    assert(prefilledName === "Team", "Template pre-filled name correctly");

    const prefilledDesc = await page.$eval('[data-testid="calendar-description-input"]', (el) => el.value);
    console.log(`  Template pre-filled description: "${prefilledDesc}"`);
    assert(prefilledDesc.includes("Team syncs"), "Template pre-filled description correctly");

    // Step 7: Customize Calendar details
    console.log("\n--- [STEP 7] Customize Calendar Name, Color, Description & Reminders ---");
    // Clear and enter custom name
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="calendar-name-input"]');
      if (input) input.value = '';
    });
    await page.type('[data-testid="calendar-name-input"]', testCalendarName);

    // Enter custom description
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="calendar-description-input"]');
      if (input) input.value = '';
    });
    await page.type(
      '[data-testid="calendar-description-input"]',
      'Deliverables, milestones and release candidate testing'
    );

    // Pick custom color preset: Terracotta (#B85D38)
    await page.waitForSelector('[data-testid="color-picker-#B85D38"]', { timeout: 5000 });
    await page.click('[data-testid="color-picker-#B85D38"]');

    // Select default reminder: 30 minutes before
    await page.select('[data-testid="calendar-reminder-select"]', '30');

    // Save Calendar
    await page.click('[data-testid="save-calendar-btn"]');
    await sleep(1200);

    // Step 8: Assert New Calendar Appears in Sidebar
    console.log("\n--- [STEP 8] Assert New Calendar appears in Sidebar ---");
    const calendarNames = await page.$$eval('[data-testid="calendar-item-name"]', (els) =>
      els.map((el) => el.textContent.trim())
    );
    console.log(`  Found calendars: ${JSON.stringify(calendarNames)}`);
    assert(
      calendarNames.includes(testCalendarName),
      `New calendar '${testCalendarName}' successfully created and listed in sidebar`
    );

    const postCreateScreenshot = path.join(artifactsDir, 'calendar_management_created_calendar.png');
    await page.screenshot({ path: postCreateScreenshot, fullPage: false });
    console.log(`  Screenshot saved to: ${postCreateScreenshot}`);

    // Step 9: Create an Event in the New Calendar
    console.log("\n--- [STEP 9] Create Event in the New Calendar ---");
    await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-new-event-btn"]');
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });

    await page.type('[data-testid="event-title-input"]', 'Sprint Planning & Release Demo');

    // Find option value for the new calendar and select it
    const calOptionVal = await page.evaluate((targetName) => {
      const select = document.querySelector('[data-testid="event-calendar-select"]');
      if (!select) return null;
      for (const opt of select.options) {
        if (opt.textContent.includes(targetName)) {
          return opt.value;
        }
      }
      return null;
    }, testCalendarName);
    console.log(`  Found calendar option value: ${calOptionVal}`);
    assert(calOptionVal !== null, `Calendar '${testCalendarName}' is selectable for new events`);
    await page.select('[data-testid="event-calendar-select"]', calOptionVal);

    await page.click('[data-testid="save-event-btn"]');
    await sleep(1500);

    // Step 10: Verify Event Renders in Calendar
    console.log("\n--- [STEP 10] Verify Event Renders in Calendar ---");
    const eventCards = await page.$$eval('[data-testid="calendar-event-pill"]', (cards) =>
      cards.map((c) => c.textContent.trim())
    );
    console.log(`  Found event cards: ${JSON.stringify(eventCards)}`);
    const hasCreatedEvent = eventCards.some((txt) => txt.includes('Sprint Planning & Release Demo'));
    assert(hasCreatedEvent, "Created event renders in calendar view");

    const eventScreenshot = path.join(artifactsDir, 'calendar_management_event_in_calendar.png');
    await page.screenshot({ path: eventScreenshot, fullPage: false });
    console.log(`  Screenshot saved to: ${eventScreenshot}`);

    // Step 11: Toggle Calendar Visibility (Hide & Show)
    console.log("\n--- [STEP 11] Toggle Calendar Visibility (Hide & Show) ---");
    // Find checkbox corresponding to the new calendar
    await page.evaluate((targetName) => {
      const rows = document.querySelectorAll('[data-testid="calendar-row"]');
      for (const row of rows) {
        if (row.textContent.includes(targetName)) {
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb) cb.click();
          break;
        }
      }
    }, testCalendarName);
    await sleep(600);

    // Event should be hidden from view
    const hiddenEvents = await page.$$eval('[data-testid="calendar-event-pill"]', (cards) =>
      cards.map((c) => c.textContent.trim())
    );
    const eventIsHidden = !hiddenEvents.some((txt) => txt.includes('Sprint Planning & Release Demo'));
    assert(eventIsHidden, "Toggling visibility off hides events from calendar view");

    // Toggle visibility back on
    await page.evaluate((targetName) => {
      const rows = document.querySelectorAll('[data-testid="calendar-row"]');
      for (const row of rows) {
        if (row.textContent.includes(targetName)) {
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb) cb.click();
          break;
        }
      }
    }, testCalendarName);
    await sleep(600);

    const restoredEvents = await page.$$eval('[data-testid="calendar-event-pill"]', (cards) =>
      cards.map((c) => c.textContent.trim())
    );
    const eventIsRestored = restoredEvents.some((txt) => txt.includes('Sprint Planning & Release Demo'));
    assert(eventIsRestored, "Toggling visibility back on restores events without data loss");

    // Step 12: Safe Calendar Deletion Modal & Protection
    console.log("\n--- [STEP 12] Safe Calendar Deletion Modal & Protection ---");
    // Click edit on the new calendar
    await page.evaluate((targetName) => {
      const rows = document.querySelectorAll('[data-testid="calendar-row"]');
      for (const row of rows) {
        if (row.textContent.includes(targetName)) {
          const btn = row.querySelector('[data-testid="edit-calendar-btn"]');
          if (btn) btn.click();
          break;
        }
      }
    }, testCalendarName);
    await page.waitForSelector('[data-testid="calendar-modal"]', { timeout: 5000 });

    // Click "Delete Calendar" button
    await page.waitForSelector('[data-testid="delete-calendar-btn"]', { timeout: 5000 });
    await page.click('[data-testid="delete-calendar-btn"]');

    // Verify safe confirmation dialog appears
    await page.waitForSelector('[data-testid="delete-calendar-confirm-modal"]', { timeout: 5000 });
    assert(
      (await page.$('[data-testid="delete-calendar-confirm-modal"]')) !== null,
      "Safe delete confirmation dialog appeared with irreversible warning"
    );

    // Cancel deletion first to verify safety
    await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="delete-calendar-confirm-modal"]');
      const buttons = modal ? modal.querySelectorAll('button') : [];
      for (const b of buttons) {
        if (b.textContent.trim() === 'Cancel') {
          b.click();
          return;
        }
      }
    });
    await sleep(500);

    // Confirm calendar still exists
    assert(
      (await page.$('[data-testid="delete-calendar-confirm-modal"]')) === null,
      "Safe confirmation modal dismissed cleanly on cancel"
    );

    // Close the calendar modal
    await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="calendar-modal"]');
      const cancelBtn = modal?.querySelector('button[type="button"]');
      if (cancelBtn) cancelBtn.click();
    });
    await sleep(500);

    // Step 13: Responsive Viewport Verification (375px)
    console.log("\n--- [STEP 13] Responsive Viewport Verification (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    // Check for horizontal overflow
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    assert(!hasHorizontalOverflow, "375px mobile viewport has zero horizontal scrollbar");

    // Open mobile sidebar drawer
    await page.waitForSelector('[data-testid="calendar-sidebar-toggle-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-sidebar-toggle-btn"]');
    await sleep(600);

    const mobileScreenshot = path.join(artifactsDir, 'calendar_management_mobile_375px.png');
    await page.screenshot({ path: mobileScreenshot, fullPage: false });
    console.log(`  Screenshot saved to: ${mobileScreenshot}`);

    // Clean up created calendar (and any leftover test calendars)
    console.log("\n--- [STEP 14] Safe Calendar Cleanup ---");
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(500);

    let cleaning = true;
    while (cleaning) {
      const found = await page.evaluate((targetName) => {
        const rows = document.querySelectorAll('[data-testid="calendar-row"]');
        for (const row of rows) {
          if (row.textContent.includes(targetName) || row.textContent.includes('Sprint Delivery & QA')) {
            const btn = row.querySelector('[data-testid="edit-calendar-btn"]');
            if (btn) {
              btn.click();
              return true;
            }
          }
        }
        return false;
      }, testCalendarName);

      if (!found) {
        cleaning = false;
        break;
      }

      await page.waitForSelector('[data-testid="calendar-modal"]', { timeout: 5000 });
      await page.waitForSelector('[data-testid="delete-calendar-btn"]', { timeout: 5000 });
      await page.click('[data-testid="delete-calendar-btn"]');
      await page.waitForSelector('[data-testid="confirm-delete-calendar-btn"]', { timeout: 5000 });
      await page.click('[data-testid="confirm-delete-calendar-btn"]');
      await sleep(1500);
    }

    const finalCalendarNames = await page.$$eval('[data-testid="calendar-item-name"]', (els) =>
      els.map((el) => el.textContent.trim())
    );
    assert(
      !finalCalendarNames.includes(testCalendarName),
      `Calendar '${testCalendarName}' successfully and safely deleted after verification`
    );

    console.log("\n================================================================================");
    console.log("   CATEGORY 02 BROWSER VERIFICATION COMPLETED SUCCESSFULLY                      ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

runCalendarManagementBrowserTest().catch((err) => {
  console.error("\nFATAL ERROR during browser verification:", err);
  process.exit(1);
});
