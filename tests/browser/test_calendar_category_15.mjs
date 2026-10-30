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

async function runCalendarCategory15BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 15 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Accessibility, Interface, Global Hotkeys, Trash & Offline Experience)       ");
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

    page.on('console', (msg) => {
      console.log(`  [BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

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
    await sleep(1000);

    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    console.log("  Mounted Calendar View");
    assert(true, "Calendar view successfully rendered");

    // Step 4: Verify Network / Offline Status Badge
    console.log("\n--- [STEP 4] Verify Network / Offline Status Badge ---");
    await page.waitForSelector('[data-testid="calendar-network-status-badge"]', { timeout: 6000 });
    const badgeText = await page.$eval('[data-testid="calendar-network-status-badge"]', (el) => el.textContent.trim());
    console.log(`  Status badge text: "${badgeText}"`);
    assert(badgeText.includes("Online"), "Network badge indicates Online status");

    // Step 5: Verify Keyboard Shortcuts Modal & '?' Hotkey
    console.log("\n--- [STEP 5] Verify Keyboard Shortcuts Modal & Hotkey ---");
    await page.waitForSelector('[data-testid="calendar-shortcuts-help-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-shortcuts-help-btn"]');
    await sleep(400);

    await page.waitForSelector('[data-testid="calendar-shortcuts-modal"]', { timeout: 6000 });
    const modalTitle = await page.$eval('#shortcuts-dialog-title', (el) => el.textContent.trim());
    console.log(`  Shortcuts modal title: "${modalTitle}"`);
    assert(modalTitle.includes("Keyboard Shortcuts"), "Shortcuts modal rendered correctly");

    // Close via Escape key
    console.log("  Closing shortcuts modal via Escape key...");
    await page.keyboard.press('Escape');
    await sleep(400);
    const isModalOpen = await page.$('[data-testid="calendar-shortcuts-modal"]');
    assert(isModalOpen === null, "Shortcuts modal closed cleanly on Escape");

    // Reopen using global '?' hotkey
    console.log("  Reopening shortcuts modal via '?' hotkey...");
    await page.keyboard.press('?');
    await sleep(400);
    await page.waitForSelector('[data-testid="calendar-shortcuts-modal"]', { timeout: 5000 });
    assert(true, "Shortcuts modal reopened using '?' hotkey");

    // Close via Close button
    await page.click('[data-testid="calendar-shortcuts-close-btn"]');
    await sleep(400);

    // Step 6: Verify Global View Switching Hotkeys (3 -> Month, 2 -> Week, 1 -> Day)
    console.log("\n--- [STEP 6] Verify Global View Switching Hotkeys ---");
    // Switch to Month view with '3'
    console.log("  Pressing '3' to switch to Month view...");
    await page.keyboard.press('3');
    await sleep(500);
    const isMonthActive = await page.$eval('[data-testid="view-month-btn"]', (el) => el.classList.contains('bg-white') || el.classList.contains('dark:bg-[#1E1F23]'));
    assert(isMonthActive, "View switched to Month view via hotkey '3'");

    // Switch to Week view with '2'
    console.log("  Pressing '2' to switch to Week view...");
    await page.keyboard.press('2');
    await sleep(500);
    const isWeekActive = await page.$eval('[data-testid="view-week-btn"]', (el) => el.classList.contains('bg-white') || el.classList.contains('dark:bg-[#1E1F23]'));
    assert(isWeekActive, "View switched to Week view via hotkey '2'");

    // Switch to Day view with '1'
    console.log("  Pressing '1' to switch to Day view...");
    await page.keyboard.press('1');
    await sleep(500);
    const isDayActive = await page.$eval('[data-testid="view-day-btn"]', (el) => el.classList.contains('bg-white') || el.classList.contains('dark:bg-[#1E1F23]'));
    assert(isDayActive, "View switched to Day view via hotkey '1'");

    // Return to Week view
    await page.keyboard.press('w');
    await sleep(500);

    // Step 7: Verify Calendar Trash Modal Lifecycle
    console.log("\n--- [STEP 7] Verify Calendar Trash Modal Lifecycle ---");
    await page.waitForSelector('[data-testid="calendar-trash-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-trash-btn"]');
    await sleep(400);

    await page.waitForSelector('[data-testid="calendar-trash-modal"]', { timeout: 6000 });
    const trashTitle = await page.$eval('#calendar-trash-title', (el) => el.textContent.trim());
    console.log(`  Trash modal title: "${trashTitle}"`);
    assert(trashTitle.includes("Calendar Trash"), "Trash modal rendered with title");

    // Verify 30-day retention notice
    const trashNotice = await page.$eval('p.text-xs.text-\\[\\#9E9085\\]', (el) => el.textContent.trim());
    console.log(`  Trash notice: "${trashNotice}"`);
    assert(trashNotice.includes("30 days"), "30-day retention notice communicated clearly");

    // Verify empty state or items
    const emptyState = await page.$('[data-testid="trash-empty-state"]');
    assert(emptyState !== null, "Trash empty state is active for clean mailbox");

    // Close trash modal
    await page.click('[data-testid="calendar-trash-close-btn"]');
    await sleep(400);
    assert(await page.$('[data-testid="calendar-trash-modal"]') === null, "Trash modal closed");

    // Step 8: Verify Print Button & Density Container
    console.log("\n--- [STEP 8] Verify Print Button & View Density ---");
    await page.waitForSelector('[data-testid="calendar-print-btn"]', { timeout: 5000 });
    assert(true, "Print button rendered in calendar toolbar");

    const densityVal = await page.$eval('[data-density]', (el) => el.getAttribute('data-density'));
    console.log(`  Active view density attribute: "${densityVal}"`);
    assert(["compact", "cozy", "comfortable"].includes(densityVal), "Valid density attribute set on calendar view");

    // Screen reader announcer region
    const announcerExists = await page.$('[data-testid="calendar-screen-reader-announcer"]');
    assert(announcerExists !== null, "Screen reader polite announcer region is present in DOM");

    // Desktop screenshot
    const desktopScreenshotPath = path.resolve(artifactsDir, 'calendar_category_15_desktop.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Desktop screenshot saved: ${desktopScreenshotPath}`);
    assert(fs.existsSync(desktopScreenshotPath), "Desktop screenshot created successfully");

    // Step 9: Mobile 375px Viewport & Zero Horizontal Overflow Verification
    console.log("\n--- [STEP 9] Mobile 375px Viewport & Zero Horizontal Scroll ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(800);

    const hasHorizontalOverflow = await page.evaluate(() => {
      const scrollW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      return scrollW > clientW;
    });
    console.log(`  Horizontal overflow detected: ${hasHorizontalOverflow}`);
    assert(!hasHorizontalOverflow, "Responsive invariant met: zero horizontal overflow on 375px mobile viewport");

    // Mobile screenshot
    const mobileScreenshotPath = path.resolve(artifactsDir, 'calendar_category_15_mobile.png');
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`  Mobile screenshot saved: ${mobileScreenshotPath}`);
    assert(fs.existsSync(mobileScreenshotPath), "Mobile screenshot created successfully");

    // DevTools inspection
    console.log("\n--- [STEP 10] DevTools State Inspection ---");
    const storageKeys = await page.evaluate(() => {
      return {
        local: Object.keys(localStorage),
        session: Object.keys(sessionStorage),
      };
    });
    console.log(`  LocalStorage keys count: ${storageKeys.local.length}`);
    console.log(`  SessionStorage keys count: ${storageKeys.session.length}`);
    assert(storageKeys.session.length > 0, "Session storage contains active session tokens");

    console.log("\n================================================================================");
    console.log("   CATEGORY 15 END-TO-END BROWSER VERIFICATION: ALL 10 STEPS PASSED             ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory15BrowserTest().catch((err) => {
  console.error("FATAL ERROR in Category 15 browser verification:", err);
  process.exit(1);
});
