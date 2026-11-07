import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artifactsDir = path.resolve(__dirname, 'artifacts');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runToolbarStandardVerification() {
  console.log("================================================================================");
  console.log("   READING PANE ACTION TOOLBAR: STANDARD 4-ACTION + OVERFLOW VERIFICATION     ");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Step 1: Login
    console.log("\n[Step 1] Logging in as alice@byos.local...");
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
    await sleep(1500);

    // Step 2: Open an email
    console.log("\n[Step 2] Opening email in reading pane...");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    await page.click('[data-testid="message-row"]');
    await sleep(800);

    // Step 3: Audit top action toolbar structure
    console.log("\n[Step 3] Auditing Reading Pane top toolbar structure...");
    const toolbarAudit = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      if (!pane) return null;

      // Find top toolbar container
      const topBar = pane.querySelector('div.border-b');
      const rightGroup = topBar ? topBar.children[1] : null;

      const directButtons = rightGroup ? Array.from(rightGroup.querySelectorAll(':scope > button, :scope > div.relative > button')) : [];
      const buttonLabels = directButtons.map(b => b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText.trim());

      const archiveBtn = pane.querySelector('button[aria-label="Archive message"]');
      const trashBtn = pane.querySelector('button[aria-label="Move to trash"], button[aria-label="Delete permanently"]');
      const readBtn = pane.querySelector('button[aria-label="Mark as read"], button[aria-label="Mark as unread"]');
      const starBtn = pane.querySelector('button[aria-label="Star message"], button[aria-label="Unstar message"]');
      const overflowBtn = pane.querySelector('[data-testid="reading-pane-overflow-btn"]');

      // Check that secondary actions are NOT exposed directly on the top bar
      const snoozeDirect = directButtons.find(b => b.getAttribute('aria-label') === 'Snooze message' || b.getAttribute('title') === 'Snooze');
      const spamDirect = directButtons.find(b => b.getAttribute('aria-label') === 'Report spam' || b.getAttribute('title') === 'Report Spam');
      const moveDirect = directButtons.find(b => b.getAttribute('aria-label') === 'Move to folder' || b.getAttribute('title') === 'Move to folder');
      const labelDirect = directButtons.find(b => b.getAttribute('aria-label') === 'Label message' || b.getAttribute('title') === 'Label as');

      return {
        topButtonsCount: directButtons.length,
        buttonLabels,
        hasArchive: archiveBtn !== null,
        hasTrash: trashBtn !== null,
        hasReadToggle: readBtn !== null,
        hasStar: starBtn !== null,
        hasOverflow: overflowBtn !== null,
        noSnoozeInDirectTopBar: snoozeDirect === undefined,
        noSpamInDirectTopBar: spamDirect === undefined,
        noMoveInDirectTopBar: moveDirect === undefined,
        noLabelInDirectTopBar: labelDirect === undefined,
      };
    });

    console.log("  Toolbar Audit Result:", JSON.stringify(toolbarAudit, null, 2));

    assert(toolbarAudit.hasArchive, "Primary triage: Archive button present");
    assert(toolbarAudit.hasTrash, "Primary triage: Move to Trash button present");
    assert(toolbarAudit.hasReadToggle, "Primary triage: Mark Read/Unread button present");
    assert(toolbarAudit.hasStar, "Primary triage: Star button present");
    assert(toolbarAudit.hasOverflow, "Primary triage: More Actions (⋮) overflow menu button present");

    assert(toolbarAudit.topButtonsCount === 5, `Direct toolbar items count is exactly 5 (4 triage + More), observed ${toolbarAudit.topButtonsCount}`);
    assert(toolbarAudit.noSnoozeInDirectTopBar, "Snooze is neatly tucked into More menu, not exposed across top strip");
    assert(toolbarAudit.noSpamInDirectTopBar, "Spam is neatly tucked into More menu, not exposed across top strip");
    assert(toolbarAudit.noMoveInDirectTopBar, "Move to is neatly tucked into More menu, not exposed across top strip");
    assert(toolbarAudit.noLabelInDirectTopBar, "Labels is neatly tucked into More menu, not exposed across top strip");

    const defaultScreenshot = path.join(artifactsDir, "reading_toolbar_decluttered.png");
    await page.screenshot({ path: defaultScreenshot });
    console.log(`  Saved screenshot: ${defaultScreenshot}`);

    // Step 4: Open More Actions (⋮) Menu and verify contents
    console.log("\n[Step 4] Opening More Actions (⋮) overflow menu...");
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(400);

    const moreMenuAudit = await page.evaluate(() => {
      const moreMenu = document.querySelector('[role="menu"][aria-label="More actions menu"]');
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const topBar = pane ? pane.querySelector('div.border-b') : null;
      if (!moreMenu || !topBar) return null;

      const isVisible = !moreMenu.classList.contains('hidden') && window.getComputedStyle(moreMenu).display !== 'none';
      const items = Array.from(moreMenu.querySelectorAll('[role="menuitem"]')).map(el => el.innerText.trim());
      const snoozeBtn = moreMenu.querySelector('[data-testid="reading-pane-snooze-btn"]');

      const menuRect = moreMenu.getBoundingClientRect();
      const barRect = topBar.getBoundingClientRect();

      // Check whether toolbar has a scrollbar (computed overflowY !== 'visible' and scrollHeight > clientHeight)
      const cs = window.getComputedStyle(topBar);
      const toolbarHasVerticalScroll = cs.overflowY !== 'visible' && topBar.scrollHeight > topBar.clientHeight;

      // Check whether an element in the dropdown is the topmost element hit by hit-testing
      const hitElement = document.elementFromPoint(menuRect.left + 30, menuRect.top + 30);
      const isTopmost = moreMenu.contains(hitElement);

      return {
        isVisible,
        itemCount: items.length,
        items,
        hasSnooze: snoozeBtn !== null,
        hasMoveTo: items.some(t => t.includes('Move to folder')),
        hasLabels: items.some(t => t.includes('Labels')),
        hasSpam: items.some(t => t.includes('Report spam')),
        hasPrint: items.some(t => t.includes('Print message')),
        hasDownloadEml: items.some(t => t.includes('Download (.eml)')),
        hasViewHeaders: items.some(t => t.includes('headers')),
        toolbarHasVerticalScroll,
        dropdownHeight: menuRect.height,
        dropdownExtendsBelowToolbar: menuRect.bottom > barRect.bottom,
        isTopmost,
      };
    });

    console.log("  More Actions Menu Audit:", JSON.stringify(moreMenuAudit, null, 2));

    assert(moreMenuAudit.isVisible, "More Actions overflow dropdown is visible");
    assert(!moreMenuAudit.toolbarHasVerticalScroll, "Top toolbar does NOT have a vertical scrollbar");
    assert(moreMenuAudit.dropdownHeight > 180, "More actions dropdown rendered with full height (not squished)");
    assert(moreMenuAudit.dropdownExtendsBelowToolbar, "More actions dropdown extends below the toolbar over content area");
    assert(moreMenuAudit.isTopmost, "More actions dropdown is topmost element (not covered or hidden by section below)");
    assert(moreMenuAudit.hasSnooze, "Dropdown contains Snooze option with testid");
    assert(moreMenuAudit.hasMoveTo, "Dropdown contains Move to folder option");
    assert(moreMenuAudit.hasLabels, "Dropdown contains Labels option");
    assert(moreMenuAudit.hasSpam, "Dropdown contains Report spam option");
    assert(moreMenuAudit.hasPrint, "Dropdown contains Print message option");
    assert(moreMenuAudit.hasDownloadEml, "Dropdown contains Download (.eml) option");
    assert(moreMenuAudit.hasViewHeaders, "Dropdown contains View headers option");

    const menuScreenshot = path.join(artifactsDir, "reading_toolbar_more_menu.png");
    await page.screenshot({ path: menuScreenshot });
    console.log(`  Saved screenshot: ${menuScreenshot}`);

    // Step 5: Test Move to folder submenu
    console.log("\n[Step 5] Testing Move to folder submenu navigation...");
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="menu"][aria-label="More actions menu"] [role="menuitem"]'));
      const moveBtn = items.find(el => el.innerText.includes('Move to folder'));
      if (moveBtn) moveBtn.click();
    });
    await sleep(300);

    const moveSubmenuText = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"][aria-label="More actions menu"]');
      return menu ? menu.innerText : "";
    });
    assert(moveSubmenuText.includes("Move to folder") && moveSubmenuText.includes("Inbox") && moveSubmenuText.includes("Archive") && moveSubmenuText.includes("Trash"), "Submenu renders folder destinations with back button");

    // Step 6: Test 375px mobile responsiveness
    console.log("\n[Step 6] Testing 375px mobile viewport responsiveness...");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const mobileAudit = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      if (!pane) return null;
      const topBar = pane.querySelector('div.border-b');
      const hasHorizontalScroll = topBar ? topBar.scrollWidth > topBar.clientWidth : false;
      return {
        topBarWidth: topBar?.clientWidth,
        topBarScrollWidth: topBar?.scrollWidth,
        hasHorizontalScroll,
      };
    });

    console.log("  Mobile 375px Audit:", JSON.stringify(mobileAudit, null, 2));
    assert(!mobileAudit.hasHorizontalScroll, "Reading pane action toolbar does not trigger horizontal scrolling on 375px mobile viewport");

    const mobileScreenshot = path.join(artifactsDir, "reading_toolbar_mobile_375px.png");
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    console.log("\n================================================================================");
    console.log("   ALL READING PANE TOOLBAR VERIFICATION CHECKS PASSED SUCCESSFULLY!            ");
    console.log("================================================================================");

  } finally {
    await browser.close();
  }
}

runToolbarStandardVerification().catch(err => {
  console.error("FATAL Toolbar Verification Failure:", err);
  process.exit(1);
});
