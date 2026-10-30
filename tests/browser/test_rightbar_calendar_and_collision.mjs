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

async function run() {
  console.log("================================================================================");
  console.log("   BYOS: RIGHTBAR, CALENDAR OVERLAPPING COLLISION & CONTACTS AUDIT              ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const uncaughtErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
      uncaughtErrors.push(err.message);
    });

    console.log("--- [STEP 1] Login Flow for alice@byos.local ---");
    let targetPort = 3001;
    for (const port of [3001, 3002, 3003]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        if (res.ok) {
          targetPort = port;
          break;
        }
      } catch {}
    }
    const appUrl = `http://127.0.0.1:${targetPort}`;
    console.log(`  Connecting to Webmail at ${appUrl}`);

    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
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

    // =========================================================================
    // STEP 2: Verify Calendar Button in Top Right of Search Bar
    // =========================================================================
    console.log("\n--- [STEP 2] Verify Calendar Tab Button in Top Right of Search Bar ---");
    const calTabBtn = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    assert(calTabBtn !== null, "Calendar tab button is rendered in top right of search bar");

    // Verify search bar is to the left of the calendar tab button
    const searchLayoutPosition = await page.evaluate(() => {
      const calBtn = document.querySelector('[data-testid="nav-calendar-tab"]');
      const searchBar = document.querySelector('[data-testid="search-bar"]');
      if (!calBtn || !searchBar) return null;
      const calRect = calBtn.getBoundingClientRect();
      const searchRect = searchBar.getBoundingClientRect();
      return {
        calLeft: calRect.left,
        searchLeft: searchRect.left,
        searchRight: searchRect.right,
        isSearchLeftOfCalendar: searchRect.left < calRect.left,
      };
    });
    console.log("  Search & Calendar relative layout:", JSON.stringify(searchLayoutPosition));
    assert(searchLayoutPosition?.isSearchLeftOfCalendar, "Search bar is on the left and Calendar tab button is to its right");

    // =========================================================================
    // STEP 3: Verify RightBar Structure in Mailbox View
    // =========================================================================
    console.log("\n--- [STEP 3] Verify RightBar in Mailbox View ---");
    const rightBarInMail = await page.$('[data-testid="right-utility-bar"]');
    assert(rightBarInMail !== null, "Right utility bar is visible in Mailbox view");

    // Verify Customization icon is the painting palette
    const appearanceBtn = await page.$('[data-testid="right-bar-appearance-btn"]');
    assert(appearanceBtn !== null, "Customizer button is present on RightBar");
    const hasPaletteSvg = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="right-bar-appearance-btn"]');
      if (!btn) return false;
      const path = btn.querySelector('path');
      return path && path.getAttribute('d')?.includes('M12 2C6.5');
    });
    assert(hasPaletteSvg, "Customizer button renders the artist painting palette SVG icon");

    // Verify Single-Icon Light / Dark switch in RightBar
    const themeToggleBtn = await page.$('[data-testid="right-bar-theme-toggle"]');
    assert(themeToggleBtn !== null, "Single-icon theme toggle button is present on RightBar");

    // Test Theme Toggle Action
    const initialIsDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    console.log(`  Initial theme isDark: ${initialIsDark}`);
    await page.click('[data-testid="right-bar-theme-toggle"]');
    await sleep(400);

    const toggledIsDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    console.log(`  After toggle theme isDark: ${toggledIsDark}`);
    assert(toggledIsDark !== initialIsDark, "Theme toggle successfully switched between light and dark mode");

    // Toggle back
    await page.click('[data-testid="right-bar-theme-toggle"]');
    await sleep(400);

    // =========================================================================
    // STEP 4: Verify Contacts Trigger in RightBar Works
    // =========================================================================
    console.log("\n--- [STEP 4] Verify Contacts Trigger in RightBar Works ---");
    const contactsBtn = await page.$('[data-testid="contacts-nav-btn"]');
    assert(contactsBtn !== null, "Contacts button is present on RightBar");

    await page.click('[data-testid="contacts-nav-btn"]');
    await page.waitForSelector('[data-testid="contacts-modal"]', { timeout: 6000 });
    console.log("  Contacts modal opened successfully");
    assert(true, "Clicking Contacts in RightBar successfully opens Contacts modal");

    // Capture screenshot of Contacts modal
    const contactsScreenshot = path.resolve(artifactsDir, 'rightbar_contacts_modal_working.png');
    await page.screenshot({ path: contactsScreenshot });
    console.log(`  Saved screenshot: ${contactsScreenshot}`);

    // Close Contacts modal
    await page.click('[data-testid="contacts-close-btn"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="contacts-modal"]') === null, { timeout: 5000 });
    await sleep(400);

    // Capture screenshot of Mailbox with sleek RightBar
    const mailboxScreenshot = path.resolve(artifactsDir, 'mailbox_sleek_rightbar.png');
    await page.screenshot({ path: mailboxScreenshot });
    console.log(`  Saved screenshot: ${mailboxScreenshot}`);

    // =========================================================================
    // STEP 5: Switch to Calendar & Verify RightBar Is Removed in Calendar View
    // =========================================================================
    console.log("\n--- [STEP 5] Switch to Calendar & Verify RightBar Is Removed ---");
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 8000 });
    await sleep(800);

    const rightBarInCal = await page.$('[data-testid="right-utility-bar"]');
    assert(rightBarInCal === null, "Right utility bar is completely removed / hidden in Calendar view");

    // =========================================================================
    // STEP 6: Verify Event Collision & Readable Card Layout in WeekView
    // =========================================================================
    console.log("\n--- [STEP 6] Verify Event Collision & Readable Card Layout ---");
    const weekBtn = await page.waitForSelector('[data-testid="view-week-btn"]', { timeout: 5000 });
    await weekBtn.click();
    await sleep(800);

    const pillsMetrics = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('[data-testid="calendar-event-pill"]'));
      return pills.map((p) => {
        const rect = p.getBoundingClientRect();
        return {
          text: p.textContent?.trim() || "",
          width: rect.width,
          styleWidth: p.style.width,
          minWidth: window.getComputedStyle(p).minWidth,
          zIndex: window.getComputedStyle(p).zIndex,
        };
      });
    });

    console.log(`  Total rendered event pills in active week view: ${pillsMetrics.length}`);
    if (pillsMetrics.length > 0) {
      console.log("  Sample event pill metrics:", JSON.stringify(pillsMetrics.slice(0, 5)));
      // Check that NO pill has width less than 35px (no squished toothpick slivers)
      const tinyPills = pillsMetrics.filter((p) => p.width < 35);
      console.log(`  Tiny squished pills (< 35px): ${tinyPills.length}`);
      assert(tinyPills.length === 0, "Zero tiny squished pills (< 35px) rendered in Week view");
    }

    // Capture screenshot of Calendar Week view
    const calendarScreenshot = path.resolve(artifactsDir, 'calendar_week_collision_resolved.png');
    await page.screenshot({ path: calendarScreenshot });
    console.log(`  Saved screenshot: ${calendarScreenshot}`);

    // =========================================================================
    // STEP 7: Verify Switch Back to Mail
    // =========================================================================
    console.log("\n--- [STEP 7] Switch Back to Mail View ---");
    const backToMailBtn = await page.waitForSelector('[data-testid="back-to-mail-btn"]', { timeout: 5000 });
    await backToMailBtn.click();
    await page.waitForSelector('[data-testid="main-content"]', { timeout: 5000 });
    await sleep(600);

    const rightBarBackInMail = await page.$('[data-testid="right-utility-bar"]');
    assert(rightBarBackInMail !== null, "Right utility bar is restored upon returning to Mailbox view");

    // Final Error Assertion
    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (found ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL RIGHTBAR, CALENDAR COLLISION & CONTACTS AUDITS PASSED                    ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
