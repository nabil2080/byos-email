import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve(__dirname, "artifacts");

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runCalendarYearViewBrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: YEAR VIEW END-TO-END BROWSER VERIFICATION                     ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const uncaughtErrors = [];
  page.on("pageerror", (err) => {
    console.error(`[PAGE ERROR]: ${err.message}`);
    uncaughtErrors.push(err.message);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.warn(`[BROWSER CONSOLE ERROR]: ${msg.text()}`);
    }
  });

  try {
    // Step 1: Navigate to Webmail & Clear Storage
    console.log("--- [STEP 1] Navigate to Webmail & Clear Storage ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "networkidle2", timeout: 15000 });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(600);

    // Step 2: Real Login Flow
    console.log("\n--- [STEP 2] Real Login Flow for alice@byos.local ---");
    const emailInput = await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await emailInput.type("alice@byos.local");

    const passInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await passInput.type("test-password-123");
    await sleep(300);

    const submitBtn = await page.waitForSelector('button[type="submit"]', { timeout: 10000 });
    await submitBtn.click();

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

    // Step 4: Verify Year View switcher button is present
    console.log("\n--- [STEP 4] Switch to Year View Mode ---");
    const yearViewBtn = await page.waitForSelector('[data-testid="view-year-btn"]', { timeout: 5000 });
    assert(yearViewBtn !== null, "Year view toggle button is present in calendar toolbar");

    await yearViewBtn.click();
    await sleep(800);

    // Assert Year View container loaded
    const yearViewContainer = await page.waitForSelector('[data-testid="calendar-year-view"]', { timeout: 5000 });
    assert(yearViewContainer !== null, "Calendar Year View container rendered successfully");

    // Period title check: should be 4 digits
    const periodTitle = await page.$eval('h2.font-bold', (el) => el.textContent.trim());
    console.log(`  Year view period title: "${periodTitle}"`);
    assert(/^\d{4}$/.test(periodTitle), `Period title matches 4-digit year format (found: "${periodTitle}")`);

    // Step 5: Verify 12 Month Cards
    console.log("\n--- [STEP 5] Verify 12 Month Cards in Responsive Grid ---");
    for (let m = 0; m < 12; m++) {
      const monthCard = await page.$(`[data-testid="year-month-card-${m}"]`);
      assert(monthCard !== null, `Month card ${m} is rendered in the 12-month grid`);
    }
    console.log("  All 12 month cards (January through December) verified");

    // Save desktop screenshot
    const yearViewShot = path.join(artifactsDir, "calendar_year_view_desktop.png");
    await page.screenshot({ path: yearViewShot });
    console.log(`  Saved screenshot: ${yearViewShot}`);

    // Step 6: Navigation Chevrons in Year Mode
    console.log("\n--- [STEP 6] Year Navigation (Prev / Next Chevrons) ---");
    const initialYearNum = parseInt(periodTitle, 10);

    // Click Next
    await page.click('[data-testid="calendar-next-btn"]');
    await sleep(600);
    const nextYearTitle = await page.$eval('h2.font-bold', (el) => el.textContent.trim());
    console.log(`  After clicking Next: "${nextYearTitle}"`);
    assert(nextYearTitle === String(initialYearNum + 1), "Next chevron advanced by 1 full year");

    // Click Prev twice
    await page.click('[data-testid="calendar-prev-btn"]');
    await sleep(400);
    await page.click('[data-testid="calendar-prev-btn"]');
    await sleep(600);
    const prevYearTitle = await page.$eval('h2.font-bold', (el) => el.textContent.trim());
    console.log(`  After clicking Prev twice: "${prevYearTitle}"`);
    assert(prevYearTitle === String(initialYearNum - 1), "Prev chevron decremented by 1 full year");

    // Click Today to restore
    await page.click('[data-testid="calendar-today-btn"]');
    await sleep(600);
    const restoredYearTitle = await page.$eval('h2.font-bold', (el) => el.textContent.trim());
    assert(restoredYearTitle === String(new Date().getFullYear()), "Today button restored to current year");

    // Step 7: Month Card Title Drill-Down to Month View
    console.log("\n--- [STEP 7] Month Title Navigation to Month View ---");
    const marchMonthBtn = await page.waitForSelector('[data-testid="year-view-month-btn-2"]', { timeout: 5000 });
    await marchMonthBtn.click();
    await sleep(800);

    // Verify Month view is active and period title is March
    const currentMonthTitle = await page.$eval('h2.font-bold', (el) => el.textContent.trim());
    console.log(`  Period title after clicking March: "${currentMonthTitle}"`);
    assert(currentMonthTitle.includes("March"), "Navigated directly to Month view for March");

    // Return to Year view
    await page.click('[data-testid="view-year-btn"]');
    await sleep(800);

    // Step 8: Interactive Day Cell & Day Inspector
    console.log("\n--- [STEP 8] Interactive Day Cell & Day Inspector ---");
    // Find today's cell or the first available day cell
    const dayCells = await page.$$('[data-testid="year-day-cell"]');
    assert(dayCells.length > 0, "Year view contains interactive day cells");

    // Click a day cell to open Day Inspector
    await dayCells[15].click();
    await sleep(600);

    const dayInspector = await page.waitForSelector('[data-testid="year-day-inspector"]', { timeout: 5000 });
    assert(dayInspector !== null, "Day inspector popover opened on cell click");

    const inspectorEventsList = await page.waitForSelector('[data-testid="year-inspector-events-list"]', { timeout: 5000 });
    assert(inspectorEventsList !== null, "Events list rendered inside day inspector");

    const inspectorShot = path.join(artifactsDir, "calendar_year_view_day_inspector.png");
    await page.screenshot({ path: inspectorShot });
    console.log(`  Saved screenshot: ${inspectorShot}`);

    // Test Quick Action: New Event button opens Event Modal
    const addEventBtn = await page.waitForSelector('[data-testid="year-inspector-add-btn"]', { timeout: 5000 });
    await addEventBtn.click();
    await sleep(600);

    const eventModal = await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    assert(eventModal !== null, "New event modal opened from Year view inspector quick action");

    // Close event modal
    await page.click('[data-testid="event-modal-cancel-btn"], [data-testid="modal-close-btn"]').catch(async () => {
      await page.keyboard.press("Escape");
    });
    await sleep(500);

    // Step 9: Responsive Architecture - 375px Mobile Viewport Check
    console.log("\n--- [STEP 9] Responsive Architecture: 375px Mobile Viewport Check ---");
    await page.setViewport({ width: 375, height: 812 });
    await sleep(800);

    const overflowCheck = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        hasHorizontalOverflow: doc.scrollWidth > doc.clientWidth,
      };
    });

    console.log(`  Mobile viewport (375px): scrollWidth=${overflowCheck.scrollWidth}, clientWidth=${overflowCheck.clientWidth}`);
    assert(!overflowCheck.hasHorizontalOverflow, "Zero horizontal overflow at 375px mobile viewport in Year view");

    const mobileShot = path.join(artifactsDir, "calendar_year_view_mobile_375px.png");
    await page.screenshot({ path: mobileShot });
    console.log(`  Saved screenshot: ${mobileShot}`);

    // Restore desktop viewport
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(400);

    // Step 10: DevTools State & Page Error Verification
    console.log("\n--- [STEP 10] DevTools State & Stability Assertions ---");
    const devToolsState = await page.evaluate(() => {
      const storageKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        storageKeys.push(localStorage.key(i));
      }
      return {
        url: window.location.href,
        storageKeys,
      };
    });

    console.log(`  DevTools Storage State: ${devToolsState.storageKeys.length} localStorage keys present`);
    assert(uncaughtErrors.length === 0, `Zero page errors during full execution (errors: ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL YEAR VIEW BROWSER VERIFICATION CHECKS COMPLETED SUCCESSFULLY             ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarYearViewBrowserTest().catch((err) => {
  console.error("Year view browser verification failed:", err);
  process.exit(1);
});
