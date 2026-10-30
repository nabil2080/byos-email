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
  console.log("   BYOS MINIMAL EVENT MODAL & CATEGORIZED SETTINGS BROWSER AUDIT               ");
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

    // Step 1: Login
    console.log("--- [STEP 1] Login Flow for alice@byos.local ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Authenticated successfully as Alice");

    // Step 2: Navigate to Calendar
    console.log("\n--- [STEP 2] Switch to Calendar View ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);

    // Step 3: Open Add Event Popup & Verify Minimal Archetype
    console.log("\n--- [STEP 3] Open Add Event Popup & Verify Minimal Archetype ---");
    const newBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 8000 });
    await newBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 8000 });

    // Assert Title input is large and minimal
    const titleInput = await page.waitForSelector('[data-testid="event-title-input"]');
    assert(titleInput !== null, "Title input is present with prominent style");
    const titlePlaceholder = await page.$eval('[data-testid="event-title-input"]', el => el.getAttribute('placeholder'));
    assert(titlePlaceholder === "Add title", "Title placeholder is 'Add title' (Google Calendar style)");

    // Assert Event Type Pills directly below title
    const typeTabs = await page.waitForSelector('[data-testid="event-type-tabs"]');
    assert(typeTabs !== null, "Event type pills row is present");

    // Assert Iconic Rows: Date & Time, Location, Video Call, Guests, Description, Calendar
    assert(await page.$('[data-testid="event-start-date"]') !== null, "Date & Time card with start date is present");
    assert(await page.$('[data-testid="event-allday-checkbox"]') !== null, "All day toggle is present");
    assert(await page.$('[data-testid="event-location-input"]') !== null, "Location input row is present");
    assert(await page.$('[data-testid="add-video-call-btn"]') !== null, "Video conferencing row is present");
    assert(await page.$('[data-testid="send-invitations-checkbox"]') !== null, "Guests & invitations row is present");
    assert(await page.$('[data-testid="event-description-input"]') !== null, "Description row is present");
    assert(await page.$('[data-testid="event-calendar-select"]') !== null, "Calendar metadata row is present");
    assert(await page.$('[data-testid="event-color-picker"]') !== null, "Color swatch picker is present");
    assert(await page.$('[data-testid="save-event-btn"]') !== null, "Save pill button is present");

    // Fill minimal event info
    await page.type('[data-testid="event-title-input"]', "Strategy Sync with Team");
    await page.type('[data-testid="event-location-input"]', "Boardroom Alpha");
    await sleep(300);

    const desktopModalScreenshot = path.join(artifactsDir, 'minimal_event_modal_desktop.png');
    await page.screenshot({ path: desktopModalScreenshot });
    console.log(`  Saved screenshot: ${desktopModalScreenshot}`);

    // Step 4: 375px Mobile Viewport Check for Event Modal
    console.log("\n--- [STEP 4] 375px Mobile Viewport Check for Event Modal ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const mobileModalMetrics = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        hasDocOverflow: doc.scrollWidth > doc.clientWidth,
      };
    });
    console.log("  Mobile modal overflow metrics:", JSON.stringify(mobileModalMetrics));
    assert(!mobileModalMetrics.hasDocOverflow, "Zero horizontal document overflow on 375px mobile viewport");

    const mobileModalScreenshot = path.join(artifactsDir, 'minimal_event_modal_mobile_375px.png');
    await page.screenshot({ path: mobileModalScreenshot });
    console.log(`  Saved screenshot: ${mobileModalScreenshot}`);

    // Close modal
    await page.setViewport({ width: 1280, height: 800 });
    await page.click('[data-testid="close-event-modal"]');
    await sleep(500);

    // Step 5: Verify Categorized Calendar Settings
    console.log("\n--- [STEP 5] Verify Categorized Calendar Settings Navigation ---");
    const calSettingsBtn = await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await calSettingsBtn.click();
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    await sleep(500);

    // Verify Category Headers exist in Calendar Settings Nav
    const categoryHeaders = await page.$$eval('[data-testid="calendar-settings-nav"] div', (divs) =>
      divs.map((d) => d.textContent.trim()).filter((t) => t.length > 0)
    );
    console.log("  Calendar Settings Category Headers:", JSON.stringify(categoryHeaders));
    assert(categoryHeaders.some((h) => h.includes("General & Views")), "Category 'General & Views' is rendered");
    assert(categoryHeaders.some((h) => h.includes("Schedule & Availability")), "Category 'Schedule & Availability' is rendered");
    assert(categoryHeaders.some((h) => h.includes("Connections & Privacy")), "Category 'Connections & Privacy' is rendered");
    assert(categoryHeaders.some((h) => h.includes("Calendars & Subscriptions")), "Category 'Calendars & Subscriptions' is rendered");

    const calSettingsScreenshot = path.join(artifactsDir, 'categorized_calendar_settings_desktop.png');
    await page.screenshot({ path: calSettingsScreenshot });
    console.log(`  Saved screenshot: ${calSettingsScreenshot}`);

    // Close Calendar Settings
    await page.click('[data-testid="calendar-settings-close-btn"]');
    await sleep(500);

    // Switch back to Mail view (RightBar is only rendered in Mailbox view)
    const backToMailBtn = await page.waitForSelector('[data-testid="back-to-mail-btn"]', { timeout: 5000 });
    await backToMailBtn.click();
    await page.waitForSelector('[data-testid="main-content"]', { timeout: 5000 });
    await sleep(500);

    // Step 6: Verify Categorized Webmail Settings
    console.log("\n--- [STEP 6] Verify Categorized Webmail Settings Navigation ---");
    // Open Webmail Settings via Right Bar
    const settingsBtn = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await settingsBtn.click();
    await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 8000 });
    await sleep(600);

    // Verify Category Headers exist in Webmail Settings Navigation
    const webmailCategoryHeaders = await page.$$eval('[data-testid="settings-sidebar"] div', (divs) =>
      divs.map((d) => d.textContent.trim()).filter((t) => t.length > 0)
    );
    console.log("  Webmail Settings Category Headers:", JSON.stringify(webmailCategoryHeaders));
    assert(webmailCategoryHeaders.some((h) => h.includes("Account & Security")), "Category 'Account & Security' is rendered");
    assert(webmailCategoryHeaders.some((h) => h.includes("Mail & Appearance")), "Category 'Mail & Appearance' is rendered");
    assert(webmailCategoryHeaders.some((h) => h.includes("Integrations & Access")), "Category 'Integrations & Access' is rendered");

    const webmailSettingsScreenshot = path.join(artifactsDir, 'categorized_webmail_settings_desktop.png');
    await page.screenshot({ path: webmailSettingsScreenshot });
    console.log(`  Saved screenshot: ${webmailSettingsScreenshot}`);

    // Final Error Assertion
    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (found ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL MINIMAL EVENT MODAL & CATEGORIZED SETTINGS CHECKS PASSED                ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
