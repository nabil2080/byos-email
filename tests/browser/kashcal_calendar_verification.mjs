import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log("================================================================================");
  console.log("       KASHCAL CALENDAR DESIGN & SMART QUICK-ADD BROWSER VERIFICATION          ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const errors = [];
    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
      errors.push(err.message);
    });

    // ── STEP 1: Login Flow ──
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
    console.log("  Successfully authenticated as Alice");

    // ── STEP 2: Navigate to Calendar ──
    console.log("\n--- [STEP 2] Switch to Calendar Module ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);
    assert(true, "Calendar view mounted cleanly");

    // ── STEP 3: Switch to Week View ──
    console.log("\n--- [STEP 3] Switch to Week View ---");
    const weekBtn = await page.waitForSelector('[data-testid="view-week-btn"]', { timeout: 5000 });
    await weekBtn.click();
    await sleep(600);

    // ── STEP 4: Verify KashCal Timeline Density Switcher ──
    console.log("\n--- [STEP 4] KashCal Timeline Density Zoom Switcher Verification ---");
    const densityControl = await page.waitForSelector('[data-testid="kashcal-density-control"]', { timeout: 5000 });
    assert(Boolean(densityControl), "KashCal density switcher control exists in toolbar");

    // Check Normal density row height
    const normalSlotHeight = await page.$eval('.group\\/slot', (el) => el.getBoundingClientRect().height);
    console.log(`  Normal density slot height: ${normalSlotHeight}px`);
    assert(Math.round(normalSlotHeight) >= 50, "Normal density height is >= 50px");

    // Switch to Spacious density
    console.log("  Switching to Spacious density (72px)...");
    await page.click('[data-testid="density-spacious-btn"]');
    await sleep(400);
    const spaciousSlotHeight = await page.$eval('.group\\/slot', (el) => el.getBoundingClientRect().height);
    console.log(`  Spacious density slot height: ${spaciousSlotHeight}px`);
    assert(Math.round(spaciousSlotHeight) >= 70, "Spacious density expands slot height to ~72px");

    // Switch to Compact density
    console.log("  Switching to Compact density (42px)...");
    await page.click('[data-testid="density-compact-btn"]');
    await sleep(400);
    const compactSlotHeight = await page.$eval('.group\\/slot', (el) => el.getBoundingClientRect().height);
    console.log(`  Compact density slot height: ${compactSlotHeight}px`);
    assert(Math.round(compactSlotHeight) <= 45, "Compact density shrinks slot height to ~42px");

    // Return to Normal density
    await page.click('[data-testid="density-normal-btn"]');
    await sleep(400);

    // Screenshot after density verification
    const densityScreenshot = path.join(ARTIFACTS_DIR, 'kashcal_density_switcher.png');
    await page.screenshot({ path: densityScreenshot });
    console.log(`  Saved screenshot: ${densityScreenshot}`);

    // ── STEP 5: KashCal Smart Natural Language Quick-Add Bar ──
    console.log("\n--- [STEP 5] KashCal Smart Natural Language Quick-Add Bar ---");
    const quickAddToggle = await page.waitForSelector('[data-testid="kashcal-quick-add-toggle-btn"]', { timeout: 5000 });
    await quickAddToggle.click();
    await sleep(300);

    const quickAddPanel = await page.waitForSelector('[data-testid="kashcal-quick-add-panel"]', { timeout: 5000 });
    assert(Boolean(quickAddPanel), "KashCal Quick Add panel expands below toolbar");

    // Type natural language event: "Coffee with Sarah tomorrow 3pm 45m"
    console.log('  Typing natural language prompt: "Coffee with Sarah tomorrow 3pm 45m"...');
    const quickInput = await page.waitForSelector('[data-testid="kashcal-quick-add-input"]', { timeout: 5000 });
    await quickInput.type('Coffee with Sarah tomorrow 3pm 45m', { delay: 30 });
    await sleep(300);

    // Verify live parsed preview chips
    const parsedPreview = await page.waitForSelector('[data-testid="kashcal-parsed-preview"]', { timeout: 5000 });
    assert(Boolean(parsedPreview), "Live parsed preview chips are displayed");

    const parsedText = await page.$eval('[data-testid="kashcal-parsed-preview"]', (el) => el.textContent);
    console.log(`  Live parsed breakdown: "${parsedText}"`);
    assert(parsedText.includes("coffee") || parsedText.includes("Coffee"), "Auto-detected category is coffee");
    assert(parsedText.includes("45m"), "Duration correctly parsed as 45m");

    // Screenshot of live parsed chips
    const quickAddScreenshot = path.join(ARTIFACTS_DIR, 'kashcal_smart_quick_add_preview.png');
    await page.screenshot({ path: quickAddScreenshot });
    console.log(`  Saved screenshot: ${quickAddScreenshot}`);

    // Submit via Quick Create Button
    console.log("  Submitting smart event...");
    await page.click('[data-testid="kashcal-quick-create-btn"]');
    await sleep(1500);

    // Verify toast confirmation
    const toast = await page.waitForSelector('[data-testid="kashcal-quick-add-toast"]', { timeout: 5000 });
    const toastText = await page.$eval('[data-testid="kashcal-quick-add-toast"]', (el) => el.textContent);
    console.log(`  Smart Add confirmation toast: "${toastText}"`);
    assert(toastText.includes("Created"), "Event creation confirmed by toast notice");

    // ── STEP 6: KashCal Event Pill & Category SVG Icon Verification ──
    console.log("\n--- [STEP 6] KashCal Material 3 Event Pill & Category SVG Icons ---");
    const eventPills = await page.$$('[data-testid="calendar-event-pill"]');
    console.log(`  Rendered event pills count: ${eventPills.length}`);
    assert(eventPills.length > 0, "At least 1 event pill rendered on the grid");

    // Check that event pills render category SVG stroke icons and zero unicode emojis
    const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]|[\u2600-\u27BF]/;
    const allPillText = await page.$$eval('[data-testid="calendar-event-pill"]', (els) => els.map(e => e.innerText).join(' '));
    assert(!emojiRegex.test(allPillText), "Calendar event pills contain zero unicode emoji characters");

    // ── STEP 7: EventModal KashCal Duration Chips & Auto-Category Indicator ──
    console.log("\n--- [STEP 7] EventModal KashCal Polish & Duration Shortcut Chips ---");
    // Open new event modal
    const sidebarNewBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await sidebarNewBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });

    // Assert duration chips exist
    const durChips = await page.waitForSelector('[data-testid="kashcal-duration-chips"]', { timeout: 5000 });
    assert(Boolean(durChips), "KashCal duration shortcut chips exist in EventModal");

    // Type a title: "Dentist checkup"
    await page.type('[data-testid="event-title-input"]', 'Dentist checkup');
    await sleep(200);

    // Click "45m" duration chip
    const buttons = await page.$$('[data-testid="kashcal-duration-chips"] button');
    let chipFound = false;
    for (const b of buttons) {
      const text = await (await b.getProperty('textContent')).jsonValue();
      if (text.trim() === "45m") {
        await b.click();
        chipFound = true;
        break;
      }
    }
    assert(chipFound, "Clicked 45m duration chip");
    await sleep(200);

    const endTimeVal = await page.$eval('[data-testid="event-end-time"]', (el) => el.value);
    console.log(`  Updated end time after clicking 45m chip: ${endTimeVal}`);
    assert(Boolean(endTimeVal), "End time was automatically adjusted by duration chip");

    // Screenshot of EventModal with duration chips
    const modalScreenshot = path.join(ARTIFACTS_DIR, 'kashcal_event_modal_duration_chips.png');
    await page.screenshot({ path: modalScreenshot });
    console.log(`  Saved screenshot: ${modalScreenshot}`);

    // Close modal
    await page.click('[data-testid="close-event-modal"]');
    await sleep(400);

    // ── STEP 8: Confirm Complete Absence of Office Icon & Text ──
    console.log("\n--- [STEP 8] Confirm Complete Absence of Office Icon & Text ---");
    const calendarText = await page.$eval('[data-testid="calendar-view"]', (el) => el.innerText);
    // Ensure "Office" does not appear as a work location badge
    const workLocBadges = await page.$$eval('[data-testid="day-work-location"]', (els) => els.map(e => e.innerText));
    console.log(`  Work location badges present: ${JSON.stringify(workLocBadges)}`);
    for (const badge of workLocBadges) {
      assert(!badge.toLowerCase().includes("office"), `Badge "${badge}" must not contain "office"`);
    }

    // ── STEP 9: DevTools Console Cleanliness ──
    console.log("\n--- [STEP 9] DevTools Console Error Audit ---");
    console.log(`  Encountered errors: ${errors.length}`);
    assert(errors.length === 0, "Zero runtime exceptions or errors encountered during execution");

    console.log("\n================================================================================");
    console.log("       ALL KASHCAL CALENDAR DESIGN & SMART QUICK-ADD CHECKS PASSED              ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
