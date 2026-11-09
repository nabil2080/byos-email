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
  console.log("   BYOS: PHASE 3 NOTES UI/UX VISUAL VERIFICATION & SCREENSHOT CAPTURE          ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
      uncaughtErrors.push(err.message);
    });

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

    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log("  Logged into Webmail successfully.");
    await sleep(800);

    console.log("\n--- [STEP 2] Navigate to Notes View ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="notes-view"]', { timeout: 5000 });
    await sleep(400);

    // 1. Full Notes workspace
    const workspaceImgPath = path.join(artifactsDir, 'notes_phase3_workspace.png');
    await page.screenshot({ path: workspaceImgPath });
    assert(fs.existsSync(workspaceImgPath), "1. notes_phase3_workspace.png captured");

    console.log("\n--- [STEP 3] Expand Quick Composer ---");
    await page.click('[data-testid="compose-new-list-btn"]');
    await sleep(300);
    await page.waitForSelector('[data-testid="notes-compose-expanded"]', { timeout: 5000 });
    console.log("  notes-compose-expanded is visible");

    await page.type('[data-testid="new-note-title-input"]', "ZK Key Derivation Architecture");
    console.log("  typed title");

    // Toggle pin in composer
    await page.click('[data-testid="new-note-pin-btn"]');
    await sleep(150);

    // Pick Sage color from palette
    await page.click('[data-testid="new-note-color-palette-btn"]');
    await sleep(200);

    // 2. Expanded quick composer
    const composerImgPath = path.join(artifactsDir, 'notes_phase3_composer_expanded.png');
    await page.screenshot({ path: composerImgPath });
    assert(fs.existsSync(composerImgPath), "2. notes_phase3_composer_expanded.png captured");

    // Close palette by selecting Sage color
    const sageBtn = await page.$('[data-testid="compose-palette-popover"] button[title="Sage"]');
    if (sageBtn) {
      await sageBtn.click();
      await sleep(150);
    }

    // Type checklist item
    const listInputs = await page.$$('[data-testid="notes-compose-expanded"] input[placeholder="List item"]');
    if (listInputs.length > 0) {
      await listInputs[0].type("Verify client-side zero-knowledge root key boundary");
      await sleep(150);
    }

    // Save note
    await page.click('[data-testid="new-note-save-btn"]');
    await sleep(500);

    console.log("\n--- [STEP 4] Individual Note Cards Details ---");
    // 3. Individual note cards
    const cardDetailsImgPath = path.join(artifactsDir, 'notes_phase3_card_details.png');
    await page.screenshot({ path: cardDetailsImgPath });
    assert(fs.existsSync(cardDetailsImgPath), "3. notes_phase3_card_details.png captured");

    console.log("\n--- [STEP 5] Note Editing Experience Modal ---");
    // Click note title or card to open edit modal
    const welcomeCard = await page.$('[data-testid="note-card-note-welcome"]');
    if (welcomeCard) {
      console.log("  Clicking Welcome note card");
      await welcomeCard.click();
    } else {
      console.log("  Clicking first card header");
      await page.click('[data-testid^="note-card-"] h4');
    }
    await sleep(400);

    await page.waitForSelector('[data-testid="edit-note-modal"]', { timeout: 5000 });

    // 4. Note editing experience
    const editModalImgPath = path.join(artifactsDir, 'notes_phase3_edit_modal.png');
    await page.screenshot({ path: editModalImgPath });
    assert(fs.existsSync(editModalImgPath), "4. notes_phase3_edit_modal.png captured");

    // Close modal via Escape key
    await page.keyboard.press('Escape');
    await sleep(400);

    console.log("\n--- [STEP 6] Navigation and Labels ---");
    // Open edit labels modal from sidebar
    await page.click('[data-testid="notes-nav-edit-labels"]');
    await sleep(350);
    await page.waitForSelector('[data-testid="edit-labels-modal"]', { timeout: 5000 });

    // 5. Navigation and labels
    const navLabelsImgPath = path.join(artifactsDir, 'notes_phase3_navigation_labels.png');
    await page.screenshot({ path: navLabelsImgPath });
    assert(fs.existsSync(navLabelsImgPath), "5. notes_phase3_navigation_labels.png captured");

    // Close labels modal
    await page.click('[data-testid="edit-labels-done-btn"]');
    await sleep(300);

    console.log("\n--- [STEP 7] Search Results ---");
    // Type search query
    await page.type('#webmail-search-input', 'Architecture');
    await sleep(400);

    // 6. Search results
    const searchResultsImgPath = path.join(artifactsDir, 'notes_phase3_search_results.png');
    await page.screenshot({ path: searchResultsImgPath });
    assert(fs.existsSync(searchResultsImgPath), "6. notes_phase3_search_results.png captured");

    // Clear search
    await page.evaluate(() => {
      const input = document.querySelector('#webmail-search-input');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(300);

    console.log("\n--- [STEP 8] Empty State ---");
    // Navigate to Archive (empty initially)
    await page.click('[data-testid="notes-nav-archive"]');
    await sleep(400);
    await page.waitForSelector('[data-testid="notes-empty-state"]', { timeout: 5000 });

    // 8. Empty state
    const emptyStateImgPath = path.join(artifactsDir, 'notes_phase3_empty_state.png');
    await page.screenshot({ path: emptyStateImgPath });
    assert(fs.existsSync(emptyStateImgPath), "8. notes_phase3_empty_state.png captured");

    console.log("\n--- [STEP 9] Mobile Viewport (375px) ---");
    // Navigate back to Notes
    await page.click('[data-testid="notes-nav-notes"]');
    await sleep(300);

    // Set mobile viewport 375x667
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await sleep(500);

    // Check no horizontal overflow
    const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const bodyClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    console.log(`  Mobile viewport check: scrollWidth=${bodyScrollWidth}, clientWidth=${bodyClientWidth}`);
    assert(bodyScrollWidth <= bodyClientWidth + 1, "No horizontal scroll on 375px mobile viewport");

    // 7. Mobile layout
    const mobileImgPath = path.join(artifactsDir, 'notes_phase3_mobile_375px.png');
    await page.screenshot({ path: mobileImgPath });
    assert(fs.existsSync(mobileImgPath), "7. notes_phase3_mobile_375px.png captured");

    console.log("\n================================================================================");
    console.log("   ALL 8 PHASE 3 SCREENSHOTS SUCCESSFULLY CAPTURED AND VERIFIED                 ");
    console.log("================================================================================");

    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (got ${uncaughtErrors.length})`);
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
