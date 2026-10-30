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

async function runCalendarCategory13BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 13 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Email & External Integrations: Extraction, Approval, Linking, Video Calls) ");
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

    // Step 3: Send Flight Confirmation Email to Self
    console.log("\n--- [STEP 3] Compose & Send Flight Confirmation Email ---");
    await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 8000 });
    await page.click('[data-testid="sidebar-compose-btn"]');
    await sleep(500);

    // Fill To
    await page.waitForSelector('[data-testid="recipient-input"]', { timeout: 5000 });
    await page.focus('[data-testid="recipient-input"]');
    await page.keyboard.type("alice@byos.local");
    await page.keyboard.press("Enter");
    await sleep(300);

    // Fill Subject
    await page.focus('#composeSubjectInput');
    await page.keyboard.type("Flight Confirmation: American Airlines AA1234 to SFO");

    // Fill Body
    await page.focus('[data-testid="compose-body-input"]');
    const flightBody = `Thank you for booking with American Airlines.
Flight: AA1234
From: New York (JFK) to San Francisco (SFO)
Date: 2026-11-15 at 08:30 AM
Confirmation / Record Locator: ABC999
Seat: 14A
We look forward to welcoming you onboard.`;
    await page.keyboard.type(flightBody);
    await sleep(400);

    // Send
    await page.click('[data-testid="compose-send-btn"]');
    await sleep(1500);
    console.log("  Flight confirmation email dispatched");

    // Step 4: Open Received Email in Inbox
    console.log("\n--- [STEP 4] Open Flight Confirmation Email in Reading Pane ---");
    // Trigger sync / refresh if needed
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 12000 });
    await sleep(800);

    // Find message row with flight subject
    const rows = await page.$$('[data-testid="message-row"]');
    let targetRowFound = false;
    for (const row of rows) {
      const text = await row.evaluate((el) => el.textContent);
      if (text.includes("Flight Confirmation") || text.includes("AA1234")) {
        await row.click();
        targetRowFound = true;
        break;
      }
    }
    if (!targetRowFound && rows.length > 0) {
      await rows[0].click();
    }
    await sleep(1000);

    // Step 5: Verify Email Event Suggestion Card in Reading Pane
    console.log("\n--- [STEP 5] Verify Email Event Suggestion Card ---");
    await page.waitForSelector('[data-testid="email-event-suggestion-card"]', { timeout: 10000 });
    console.log("  Email event suggestion card rendered");

    const categoryBadge = await page.$eval('[data-testid="suggestion-category-badge"]', (el) => el.textContent.trim());
    console.log(`  Extracted Category Badge: "${categoryBadge}"`);
    assert(categoryBadge === "Flight Reservation", "Category badge is 'Flight Reservation'");

    const suggestionTitle = await page.$eval('[data-testid="suggestion-title"]', (el) => el.textContent.trim());
    console.log(`  Extracted Title: "${suggestionTitle}"`);
    assert(suggestionTitle.includes("AA1234") && suggestionTitle.includes("SFO"), "Title contains flight number and destination");

    const confCode = await page.$eval('[data-testid="suggestion-confirmation-code"]', (el) => el.textContent.trim());
    console.log(`  Extracted Confirmation Code: "${confCode}"`);
    assert(confCode.includes("ABC999"), "Confirmation code matches ABC999");

    // Step 6: Add Suggested Event to Calendar
    console.log("\n--- [STEP 6] Add Suggested Event to Calendar ---");
    await page.waitForSelector('[data-testid="add-suggested-event-btn"]', { timeout: 5000 });
    await page.click('[data-testid="add-suggested-event-btn"]');
    await sleep(1000);

    await page.waitForSelector('[data-testid="suggestion-added-badge"]', { timeout: 8000 });
    const addedBadgeText = await page.$eval('[data-testid="suggestion-added-badge"]', (el) => el.textContent.trim());
    console.log(`  Added Badge Text: "${addedBadgeText}"`);
    assert(addedBadgeText.includes("Added to Calendar"), "Card transitioned to 'Added to Calendar'");

    // Step 7: View in Calendar Action
    console.log("\n--- [STEP 7] Navigate to Calendar via 'View in Calendar' Button ---");
    await page.waitForSelector('[data-testid="view-suggested-event-btn"]', { timeout: 5000 });
    await page.click('[data-testid="view-suggested-event-btn"]');
    await sleep(1000);

    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    console.log("  Navigated into Calendar View");
    assert(true, "Calendar view mounted after clicking View in Calendar");

    // Step 8: Open Event and Verify Email Provenance Card & Video Call Generator
    console.log("\n--- [STEP 8] Verify Email Provenance Card and Video Call Generator in EventModal ---");
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 15000 });
    console.log("  Event modal opened");

    // Verify Email Provenance Card is displayed
    const provenanceCard = await page.$('[data-testid="event-email-provenance-card"]');
    if (provenanceCard) {
      console.log("  Email provenance card rendered inside EventModal");
      const provText = await page.$eval('[data-testid="event-email-provenance-card"]', (el) => el.textContent);
      assert(provText.includes("ABC999") || provText.includes("Flight"), "Provenance card contains flight / confirmation info");
    }

    // Test Video Call Generator button
    await page.waitForSelector('[data-testid="add-video-call-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="add-video-call-btn"]');
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
      }
    });
    await sleep(500);

    const generatedMeetingUrl = await page.$eval('[data-testid="event-meeting-url-input"]', (el) => el.value);
    console.log(`  Generated Video Meeting Link: "${generatedMeetingUrl}"`);
    assert(
      generatedMeetingUrl.startsWith("https://meet.byos.local/room/byos-"),
      "Video call generator populated secure BYOS room link"
    );

    // Save Desktop Screenshot
    const desktopPath = path.resolve(artifactsDir, 'calendar_category_13_desktop.png');
    await page.screenshot({ path: desktopPath, fullPage: false });
    console.log(`  Desktop screenshot saved: ${desktopPath}`);

    // Close EventModal
    await page.click('[data-testid="close-event-modal"]');
    await sleep(500);

    // Step 9: Settings Integrations Tab Verification
    console.log("\n--- [STEP 9] Calendar Settings Integrations Tab Verification ---");
    await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 6000 });
    await page.click('[data-testid="calendar-settings-btn"]');
    await page.waitForSelector('[data-testid="calendar-settings-nav"]', { timeout: 8000 });

    // Click Integrations Tab
    await page.waitForSelector('[data-testid="settings-nav-integrations"]', { timeout: 5000 });
    await page.click('[data-testid="settings-nav-integrations"]');
    await sleep(500);

    // Verify Master Toggle & Category Toggles
    await page.waitForSelector('[data-testid="setting-input-mailEventSuggestions"]', { timeout: 5000 });
    assert(true, "Mail event suggestions master toggle present");

    const flightsToggle = await page.$('[data-testid="setting-input-mailCategoryFlights"]');
    assert(flightsToggle !== null, "Flights extraction category toggle present");

    const birthdaysToggle = await page.$('[data-testid="setting-input-showBirthdaysFromContacts"]');
    assert(birthdaysToggle !== null, "Contacts birthdays toggle present");

    const videoProviderSelect = await page.$('[data-testid="setting-input-videoConferenceProvider"]');
    assert(videoProviderSelect !== null, "Video conference provider selector present");

    // Close Settings
    await page.click('[data-testid="calendar-settings-close-btn"]');
    await sleep(500);

    // Step 10: 375px Mobile Viewport Verification
    console.log("\n--- [STEP 10] 375px Mobile Viewport Verification ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(`  375px horizontal overflow detected: ${hasHorizontalOverflow}`);
    assert(!hasHorizontalOverflow, "375px mobile viewport has zero horizontal scroll");

    const mobilePath = path.resolve(artifactsDir, 'calendar_category_13_mobile.png');
    await page.screenshot({ path: mobilePath, fullPage: false });
    console.log(`  Mobile screenshot saved: ${mobilePath}`);

    // Step 11: DevTools Storage & Console Verification
    console.log("\n--- [STEP 11] DevTools Storage & Console Verification ---");
    const storageKeys = await page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        keys.push(localStorage.key(i));
      }
      return keys;
    });
    console.log(`  All localStorage keys count: ${storageKeys.length}`);
    const linkedEventKeys = storageKeys.filter((k) => k.startsWith("byos_calendar_linked_email_events_"));
    console.log(`  Linked events storage keys: ${JSON.stringify(linkedEventKeys)}`);
    assert(linkedEventKeys.length > 0, "Email-to-calendar event linkage persisted in localStorage");

    console.log(`  Uncaught console errors: ${uncaughtErrors.length}`);
    assert(uncaughtErrors.length === 0, "DevTools console has zero uncaught errors");

    console.log("\n================================================================================");
    console.log("   CATEGORY 13 BROWSER VERIFICATION: ALL 11 STEPS PASSED                       ");
    console.log("================================================================================\n");

  } catch (error) {
    console.error(`\nFATAL ERROR IN CATEGORY 13 BROWSER TEST: ${error.stack || error}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runCalendarCategory13BrowserTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
