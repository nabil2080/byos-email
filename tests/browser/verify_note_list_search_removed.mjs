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

async function runNotesSearchOptionRemovalVerification() {
  console.log("================================================================================");
  console.log("       VERIFY EXTRA SEARCH OPTION REMOVAL IN NOTES LIST                         ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  const consoleLogs = [];
  const networkLogs = [];

  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on('requestfinished', (req) => {
    networkLogs.push(`${req.method()} ${req.url()} -> ${req.response() ? req.response().status() : 'no response'}`);
  });

  try {
    await page.setViewport({ width: 1280, height: 800 });

    console.log("--- [STEP 1] Login as Alice on 1280x800 viewport ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await sleep(2500);

    // Switch to Notes module
    console.log("\n--- [STEP 2] Navigate to Notes Module ---");
    await page.waitForSelector('[data-testid="nav-notes-tab"]', { timeout: 10000 });
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="notes-list-pane"]', { timeout: 10000 });
    console.log("  Notes list pane loaded.");

    // ── STEP 3: Verify Header Search Bar Exists ──
    console.log("\n--- [STEP 3] Verify Primary Search Bar in Header ---");
    const headerSearchBar = await page.$('[data-testid="top-fixed-search-input"]');
    assert(headerSearchBar !== null, "Primary search bar in TopFixedBar header is present");

    // ── STEP 4: Assert Extra Search Option is Removed from Notes List ──
    console.log("\n--- [STEP 4] Verify Extra Search Options Removed from Notes List ---");
    const searchToggle = await page.$('[data-testid="notes-list-search-toggle"]');
    assert(searchToggle === null, "Extra notes list search toggle button ([data-testid=\"notes-list-search-toggle\"]) is completely removed from DOM");

    const searchInput = await page.$('[data-testid="notes-list-search-input"]');
    assert(searchInput === null, "Extra notes list collapsible search input ([data-testid=\"notes-list-search-input\"]) is completely removed from DOM");

    // ── STEP 5: Verify Remaining Note List Header Controls Intact ──
    console.log("\n--- [STEP 5] Verify Remaining Controls (Sort, Quick New Note) in Notes List ---");
    const sortBtn = await page.$('[data-testid="notes-list-sort-btn"]');
    assert(sortBtn !== null, "Sort button in notes list header is present and intact");

    const quickNewNoteBtn = await page.$('[data-testid="notes-list-new-note-btn"]');
    assert(quickNewNoteBtn !== null, "Quick new note button in notes list header is present and intact");

    const desktopScreenshot = path.join(artifactsDir, 'notes_list_no_extra_search_desktop.png');
    await page.screenshot({ path: desktopScreenshot });
    console.log(`  Saved screenshot: ${desktopScreenshot}`);

    // ── STEP 6: Exercise Search Functionality via Primary Header Search Bar ──
    console.log("\n--- [STEP 6] Test Note Filtering via Primary Header Search Bar ---");
    const initialNoteCount = await page.$$eval('[data-testid="notes-list-item"]', (els) => els.length);
    console.log(`  Initial note count: ${initialNoteCount}`);
    assert(initialNoteCount >= 1, "Notes are present in list");

    await page.type('[data-testid="top-fixed-search-input"]', "Security");
    await sleep(600);

    const filteredNoteCount = await page.$$eval('[data-testid="notes-list-item"]', (els) => els.length);
    console.log(`  Filtered note count for 'Security': ${filteredNoteCount}`);
    assert(filteredNoteCount === 1, "Header search bar filters notes to exact match");

    // Clear search
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="top-fixed-search-input"]');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(600);

    const restoredNoteCount = await page.$$eval('[data-testid="notes-list-item"]', (els) => els.length);
    console.log(`  Restored note count after clearing search: ${restoredNoteCount}`);
    assert(restoredNoteCount === initialNoteCount, "All notes restored after clearing search query");

    // ── STEP 7: Mobile Viewport Verification (375x667) ──
    console.log("\n--- [STEP 7] Verify on Mobile Viewport (375x667) ---");
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await sleep(1000);

    const mobileSearchToggle = await page.$('[data-testid="notes-list-search-toggle"]');
    assert(mobileSearchToggle === null, "Notes list search toggle button absent on mobile");

    const mobileSearchInput = await page.$('[data-testid="notes-list-search-input"]');
    assert(mobileSearchInput === null, "Notes list collapsible search input absent on mobile");

    const mobileHeaderSearch = await page.$('[data-testid="top-fixed-search-input"]');
    assert(mobileHeaderSearch !== null, "Primary header search bar is present on mobile");

    const mobileScreenshot = path.join(artifactsDir, 'notes_list_no_extra_search_mobile.png');
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    console.log("\n================================================================================");
    console.log(" ALL NOTES SEARCH REMOVAL VERIFICATIONS PASSED SUCCESSFULLY!                    ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runNotesSearchOptionRemovalVerification().catch((err) => {
  console.error("FATAL ERROR in runNotesSearchOptionRemovalVerification:", err);
  process.exit(1);
});
