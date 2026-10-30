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

async function runCalendarCategory14BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 14 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Import, Export and Synchronization: ICS, Webcal Feeds & CalDAV Protocol)   ");
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

    // Step 4: Open Calendar Settings Modal
    console.log("\n--- [STEP 4] Open Calendar Settings Modal ---");
    await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 6000 });
    await page.click('[data-testid="calendar-settings-btn"]');
    await page.waitForSelector('[data-testid="calendar-settings-nav"]', { timeout: 8000 });
    console.log("  Calendar settings navigation drawer rendered");

    // Step 5: Verify & Exercise Import & Export Panel
    console.log("\n--- [STEP 5] Verify & Exercise Import & Export Panel ---");
    await page.waitForSelector('[data-testid="settings-nav-import_export"]', { timeout: 5000 });
    await page.click('[data-testid="settings-nav-import_export"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="settings-import-export-panel"]', { timeout: 6000 });
    console.log("  Import & Export settings panel displayed");

    // Verify Import Card Controls
    await page.waitForSelector('[data-testid="ics-import-card"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="ics-import-file-input"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="ics-import-calendar-select"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="ics-duplicate-handling"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="ics-import-submit-btn"]', { timeout: 5000 });
    assert(true, "All ICS import controls rendered");

    // Upload ICS file fixture
    const icsFilePath = path.resolve(__dirname, '../fixtures/test_import_event.ics');
    assert(fs.existsSync(icsFilePath), "ICS test fixture file exists");

    const fileInput = await page.$('[data-testid="ics-import-file-input"]');
    await fileInput.uploadFile(icsFilePath);
    await sleep(500);

    // Verify duplicate handling options
    await page.select('[data-testid="ics-duplicate-handling"]', 'update_duplicates');
    await sleep(300);

    // Execute Import
    console.log("  Clicking Import submit button...");
    await page.click('[data-testid="ics-import-submit-btn"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="ics-import-result"]', { timeout: 10000 });
    const importResultText = await page.$eval('[data-testid="ics-import-result"]', (el) => el.textContent.trim());
    console.log(`  Import Result Banner: "${importResultText}"`);
    assert(importResultText.includes("Successfully imported"), "Import banner confirms successful event import");

    // Verify Export Card Controls
    await page.waitForSelector('[data-testid="ics-export-card"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="ics-export-calendar-select"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="ics-export-submit-btn"]', { timeout: 5000 });

    // Execute Export
    console.log("  Clicking Export submit button...");
    await page.click('[data-testid="ics-export-submit-btn"]');
    await sleep(800);

    await page.waitForSelector('[data-testid="ics-export-result"]', { timeout: 8000 });
    const exportResultText = await page.$eval('[data-testid="ics-export-result"]', (el) => el.textContent.trim());
    console.log(`  Export Result Banner: "${exportResultText}"`);
    assert(exportResultText.includes("Exported"), "Export banner confirms file generation and export");

    // Step 6: Verify External Calendar Subscriptions Management
    console.log("\n--- [STEP 6] Verify External URL Feed Subscriptions Management ---");
    await page.waitForSelector('[data-testid="settings-nav-add_from_url"]', { timeout: 5000 });
    await page.click('[data-testid="settings-nav-add_from_url"]');
    await sleep(600);

    // Exercise URL subscription through the live UI form
    console.log("  Subscribing to external feed via URL input...");
    await page.waitForSelector('[data-testid="subscribe-url-input"]', { timeout: 5000 });
    await page.type('[data-testid="subscribe-url-input"]', 'https://conferences.byos.local/us-tech-events-2026.ics');
    await sleep(300);
    await page.click('[data-testid="subscribe-url-submit"]');
    await sleep(800);

    // Verify Subscribed Feeds Card
    await page.waitForSelector('[data-testid="subscribed-feeds-card"]', { timeout: 6000 });
    console.log("  Subscribed feeds management card rendered");

    await page.waitForSelector('[data-testid^="subscribed-feed-item-"]', { timeout: 5000 });
    const feedName = await page.$eval('[data-testid="feed-name"]', (el) => el.textContent.trim());
    console.log(`  Feed Name: "${feedName}"`);
    assert(feedName.includes("us-tech-events-2026"), "Subscribed feed name derived from URL");

    const statusBadge = await page.$eval('[data-testid="feed-status-badge"]', (el) => el.textContent.trim());
    console.log(`  Feed Status: "${statusBadge}"`);
    assert(statusBadge === "Read-Only", "External feed marked Read-Only");

    // Pause Feed
    await page.click('[data-testid^="feed-pause-btn-"]');
    await sleep(500);
    const pausedBadge = await page.$eval('[data-testid="feed-status-badge"]', (el) => el.textContent.trim());
    console.log(`  Feed Status after Pause: "${pausedBadge}"`);
    assert(pausedBadge === "Paused", "Feed transitions to Paused status");

    const pauseBtnText = await page.$eval('[data-testid^="feed-pause-btn-"]', (el) => el.textContent.trim());
    assert(pauseBtnText === "Resume", "Button toggles to Resume");

    // Resume Feed
    await page.click('[data-testid^="feed-pause-btn-"]');
    await sleep(500);
    const resumedBadge = await page.$eval('[data-testid="feed-status-badge"]', (el) => el.textContent.trim());
    assert(resumedBadge === "Read-Only", "Feed transitions back to Read-Only on resume");

    // Unsubscribe Feed
    await page.click('[data-testid^="feed-unsubscribe-btn-"]');
    await sleep(600);
    const noFeedsMsg = await page.$('[data-testid="no-subscribed-feeds"]');
    assert(noFeedsMsg !== null, "Feed successfully unsubscribed and list shows empty placeholder");

    // Step 7: Verify CalDAV Protocol Information Card
    console.log("\n--- [STEP 7] Verify CalDAV Synchronization Protocol Card ---");
    await page.waitForSelector('[data-testid="settings-nav-offline_sync"]', { timeout: 5000 });
    await page.click('[data-testid="settings-nav-offline_sync"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="caldav-info-card"]', { timeout: 6000 });
    console.log("  CalDAV Protocol Information Card displayed");

    const caldavStatus = await page.$eval('[data-testid="caldav-status-badge"]', (el) => el.textContent.trim());
    console.log(`  CalDAV Status Badge: "${caldavStatus}"`);
    assert(caldavStatus.includes("Ready (RFC 4791 / RFC 6578)"), "Status badge confirms RFC 4791/6578 compliance");

    const serverUrl = await page.$eval('[data-testid="caldav-server-url"]', (el) => el.textContent.trim());
    console.log(`  CalDAV Server Endpoint: "${serverUrl}"`);
    assert(serverUrl.includes("/dav/principals/"), "CalDAV Server URL targets /dav/principals/");

    const principalUrl = await page.$eval('[data-testid="caldav-principal-url"]', (el) => el.textContent.trim());
    console.log(`  CalDAV Principal URL: "${principalUrl}"`);
    assert(principalUrl.includes("/dav/principals/alice%40byos.local/"), "Principal URL contains user email");

    const instructionsText = await page.$eval('[data-testid="caldav-client-instructions"]', (el) => el.textContent);
    assert(instructionsText.includes("Apple Calendar"), "Includes Apple Calendar setup guide");
    assert(instructionsText.includes("Thunderbird"), "Includes Thunderbird setup guide");
    assert(instructionsText.includes("DAVx⁵"), "Includes Android DAVx⁵ setup guide");

    // Step 8: Desktop Screenshot Capture
    console.log("\n--- [STEP 8] Desktop Screenshot Capture ---");
    const desktopPath = path.resolve(artifactsDir, 'calendar_category_14_desktop.png');
    await page.screenshot({ path: desktopPath, fullPage: false });
    console.log(`  Desktop screenshot saved: ${desktopPath}`);
    assert(fs.existsSync(desktopPath), "Desktop screenshot created");

    // Step 9: 375px Mobile Viewport & Responsiveness Verification
    console.log("\n--- [STEP 9] 375px Mobile Viewport & Responsiveness Verification ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(`  375px horizontal overflow detected: ${hasHorizontalOverflow}`);
    assert(!hasHorizontalOverflow, "375px mobile viewport has zero horizontal scroll");

    const mobilePath = path.resolve(artifactsDir, 'calendar_category_14_mobile.png');
    await page.screenshot({ path: mobilePath, fullPage: false });
    console.log(`  Mobile screenshot saved: ${mobilePath}`);
    assert(fs.existsSync(mobilePath), "Mobile screenshot created");

    // Close settings modal
    await page.click('[data-testid="calendar-settings-close-btn"]');
    await sleep(500);

    // Step 10: DevTools Audit (Network, Storage, Console)
    console.log("\n--- [STEP 10] DevTools Storage, Network & Console Audit ---");
    const storageDump = await page.evaluate(() => {
      const s = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        s[k] = localStorage.getItem(k);
      }
      return s;
    });
    console.log(`  localStorage keys count: ${Object.keys(storageDump).length}`);

    // Verify private key is never in localStorage
    for (const key of Object.keys(storageDump)) {
      assert(!key.includes("mailbox_sk_"), `Private key must NOT be leaked into localStorage: ${key}`);
    }

    console.log(`  DevTools console uncaught errors: ${uncaughtErrors.length}`);
    assert(uncaughtErrors.length === 0, "Zero uncaught errors in browser console");

    console.log("\n================================================================================");
    console.log("   CATEGORY 14 BROWSER VERIFICATION: ALL 10 STEPS PASSED                       ");
    console.log("================================================================================\n");

  } catch (error) {
    console.error(`\nFATAL ERROR IN CATEGORY 14 BROWSER TEST: ${error.stack || error}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runCalendarCategory14BrowserTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
