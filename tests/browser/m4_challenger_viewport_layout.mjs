/**
 * ============================================================================
 * Milestone 4 Adversarial Challenge: Reading Section Toolbar Simplification
 * ============================================================================
 * 
 * Challenger 2: Multi-Viewport Responsiveness & Cross-Test Backward Compatibility
 * 
 * Aggressive Empirical Verification:
 * 1. Multi-Viewport Layout (Desktop 1280px, Tablet 768px, Mobile 375px):
 *    - Zero horizontal toolbar scroll / spill
 *    - Zero document body scrolling (scrollY = 0, scrollHeight <= clientHeight)
 * 2. Dropdown Menu Clipping & Bounding Bounds:
 *    - Dropdown menu extends vertically past toolbar bottom bounds
 *    - Computed overflow inspection (no clipping boundary)
 *    - elementFromPoint hit-testing below toolbar edge to verify menu renders above message content
 *    - z-index validation against reading pane body
 *    - Complete secondary action presence (Snooze, Move, Label, Spam, Print, Download EML, Headers)
 * 3. Submenu Navigation & Isolation (Move to folder, Label as)
 * 4. Keyboard Escape isolation (Escape dismisses open menu without exiting email reading view)
 * 5. Backward Compatibility (test_unified_inbox_browser.mjs Snooze trigger pattern)
 */

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const challengeResults = [];

function recordTest(id, name, passed, details = "") {
  challengeResults.push({ id, name, passed, details, timestamp: new Date().toISOString() });
  const statusStr = passed ? "PASS" : "FAIL";
  console.log(`  [${statusStr}] [${id}] ${name}`);
  if (details) {
    console.log(`         Details: ${typeof details === "object" ? JSON.stringify(details) : details}`);
  }
}

async function runChallengerSuite() {
  console.log("================================================================================");
  console.log("   MILESTONE 4 EMPIRICAL CHALLENGER: MULTI-VIEWPORT & CROSS-SUITE VERIFICATION  ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--window-size=1280,800",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // -------------------------------------------------------------------------
    // STEP 0: Real Sovereign Login Flow as Alice
    // -------------------------------------------------------------------------
    console.log("--- [STEP 0] Authentication Flow for alice@byos.local ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1000);
    console.log("  Successfully authenticated as Alice.\n");

    // -------------------------------------------------------------------------
    // STEP 1: Open Reading Pane
    // -------------------------------------------------------------------------
    console.log("--- [STEP 1] Navigate to Email Reading Pane ---");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    const row = await page.$('[data-testid="message-row"]');
    if (!row) throw new Error("No message row found to open reading pane");
    await row.click();

    await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="reading-pane-overflow-btn"]', { timeout: 10000 });
    await sleep(800);
    console.log("  Reading pane open and toolbar rendered.\n");

    // -------------------------------------------------------------------------
    // CHALLENGE 1: Multi-Viewport Layout Responsiveness (375px, 768px, 1280px)
    // -------------------------------------------------------------------------
    console.log("================================================================================");
    console.log("   CHALLENGE 1: MULTI-VIEWPORT RESPONSIVENESS & SCROLL INVARIANTS               ");
    console.log("================================================================================");

    const viewports = [
      { name: "desktop", width: 1280, height: 800, file: "m4_challenger_desktop_1280.png" },
      { name: "tablet", width: 768, height: 1024, file: "m4_challenger_tablet_768.png" },
      { name: "mobile", width: 375, height: 667, file: "m4_challenger_mobile_375.png" },
    ];

    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await sleep(600);

      const metrics = await page.evaluate((vpWidth) => {
        const doc = document.documentElement;
        const body = document.body;
        const overflowBtn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
        const toolbar = overflowBtn ? overflowBtn.closest('div.border-b') : null;

        const bodyStyle = window.getComputedStyle(body);
        const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;

        return {
          windowScrollY: window.scrollY,
          windowScrollX: window.scrollX,
          docScrollHeight: doc.scrollHeight,
          docClientHeight: doc.clientHeight,
          docScrollWidth: doc.scrollWidth,
          docClientWidth: doc.clientWidth,
          bodyOverflow: bodyStyle.overflow,
          toolbarFound: Boolean(toolbar),
          toolbarScrollWidth: toolbar ? toolbar.scrollWidth : 0,
          toolbarClientWidth: toolbar ? toolbar.clientWidth : 0,
          toolbarRectWidth: toolbarRect ? toolbarRect.width : 0,
          toolbarOverflowX: toolbar ? window.getComputedStyle(toolbar).overflowX : null,
          toolbarOverflowY: toolbar ? window.getComputedStyle(toolbar).overflowY : null,
        };
      }, vp.width);

      // Save screenshot for each viewport
      const screenshotPath = path.resolve(artifactsDir, vp.file);
      await page.screenshot({ path: screenshotPath });

      // Outer window zero-scroll assertion
      const zeroWindowScroll = metrics.windowScrollY === 0 && metrics.windowScrollX === 0;
      const noDocSpill = metrics.docScrollHeight <= metrics.docClientHeight + 1;
      const noHorizontalWindowSpill = metrics.docScrollWidth <= metrics.docClientWidth + 1;

      recordTest(
        `CH1.1_${vp.name}`,
        `Zero-Scroll & Containment on ${vp.name} (${vp.width}x${vp.height})`,
        zeroWindowScroll && noDocSpill && noHorizontalWindowSpill,
        {
          scrollY: metrics.windowScrollY,
          scrollX: metrics.windowScrollX,
          docScrollH: metrics.docScrollHeight,
          docClientH: metrics.docClientHeight,
          docScrollW: metrics.docScrollWidth,
          docClientW: metrics.docClientWidth,
          bodyOverflow: metrics.bodyOverflow,
        }
      );

      // Desktop specific toolbar horizontal constraint
      if (vp.name === "desktop") {
        const desktopNoToolbarSpill = metrics.toolbarScrollWidth <= metrics.toolbarClientWidth + 1;
        recordTest(
          "CH1.2_desktop_toolbar_spill",
          "Desktop Toolbar Horizontal Boundary Containment",
          desktopNoToolbarSpill,
          {
            toolbarScrollWidth: metrics.toolbarScrollWidth,
            toolbarClientWidth: metrics.toolbarClientWidth,
            toolbarRectWidth: metrics.toolbarRectWidth,
          }
        );
      }
    }

    // Reset viewport back to desktop 1280x800 for detailed dropdown checks
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(400);

    // -------------------------------------------------------------------------
    // CHALLENGE 2: Dropdown Menu Vertical Clipping, Geometry & Hit-Testing
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 2: DROPDOWN CLIPPING, GEOMETRY & HIT-TESTING                      ");
    console.log("================================================================================");

    // Click More Actions button to open dropdown
    const overflowBtn = await page.waitForSelector('[data-testid="reading-pane-overflow-btn"]', { timeout: 5000 });
    await overflowBtn.click();
    await sleep(400);

    // Capture screenshot of open dropdown
    const dropdownScreenshot = path.resolve(artifactsDir, "m4_challenger_dropdown_open.png");
    await page.screenshot({ path: dropdownScreenshot });

    const dropdownGeometry = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
      const toolbar = btn ? btn.closest('div.border-b') : null;
      const menu = document.querySelector('[role="menu"][aria-label="More actions menu"]');
      const readingPane = document.querySelector('[data-testid="reading-pane"]');

      if (!toolbar || !menu) {
        return { error: "Toolbar or Menu element not found in DOM" };
      }

      const toolbarRect = toolbar.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const toolbarStyle = window.getComputedStyle(toolbar);
      const menuStyle = window.getComputedStyle(menu);

      // Hit-test at a point clearly BELOW the toolbar bottom edge but inside the menu
      const hitTestX = menuRect.left + menuRect.width / 2;
      const hitTestY = toolbarRect.bottom + 25; // 25px below toolbar edge
      const elementAtHitPoint = document.elementFromPoint(hitTestX, hitTestY);
      const isMenuAtHitPoint = menu.contains(elementAtHitPoint);

      // Check all expected secondary items
      const itemLabels = Array.from(menu.querySelectorAll('[role="menuitem"], button')).map(b => b.innerText.trim());

      const hasSnooze = Boolean(menu.querySelector('[data-testid="reading-pane-snooze-btn"]'));
      const hasMove = itemLabels.some(t => t.includes("Move to folder"));
      const hasLabel = itemLabels.some(t => t.includes("Label as"));
      const hasSpam = itemLabels.some(t => t.includes("Report spam"));
      const hasPrint = itemLabels.some(t => t.includes("Print message"));
      const hasDownload = itemLabels.some(t => t.includes("Download (.eml)"));
      const hasHeaders = itemLabels.some(t => t.includes("View headers") || t.includes("Hide headers"));

      return {
        toolbarRect: { top: toolbarRect.top, bottom: toolbarRect.bottom, height: toolbarRect.height },
        menuRect: { top: menuRect.top, bottom: menuRect.bottom, height: menuRect.height, left: menuRect.left, right: menuRect.right },
        menuExtendsPastToolbar: menuRect.bottom > toolbarRect.bottom,
        toolbarOverflowX: toolbarStyle.overflowX,
        toolbarOverflowY: toolbarStyle.overflowY,
        menuZIndex: parseInt(menuStyle.zIndex || "0", 10),
        hitTestY,
        hitTestX,
        isMenuAtHitPoint,
        hitElementTag: elementAtHitPoint ? elementAtHitPoint.tagName : null,
        hitElementText: elementAtHitPoint ? (elementAtHitPoint.innerText || "").slice(0, 30) : null,
        itemsFound: itemLabels,
        hasSnooze,
        hasMove,
        hasLabel,
        hasSpam,
        hasPrint,
        hasDownload,
        hasHeaders,
      };
    });

    recordTest(
      "CH2.1_dropdown_extends_past_toolbar",
      "Dropdown Extends Downward Past Toolbar Bottom Edge",
      dropdownGeometry.menuExtendsPastToolbar,
      {
        toolbarBottom: dropdownGeometry.toolbarRect?.bottom,
        menuBottom: dropdownGeometry.menuRect?.bottom,
        verticalSpillDistance: (dropdownGeometry.menuRect?.bottom || 0) - (dropdownGeometry.toolbarRect?.bottom || 0),
      }
    );

    const noClippingOverflow = dropdownGeometry.toolbarOverflowX !== "hidden" &&
                               dropdownGeometry.toolbarOverflowX !== "scroll" &&
                               dropdownGeometry.toolbarOverflowX !== "auto" &&
                               dropdownGeometry.toolbarOverflowY !== "hidden" &&
                               dropdownGeometry.toolbarOverflowY !== "scroll" &&
                               dropdownGeometry.toolbarOverflowY !== "auto";

    recordTest(
      "CH2.2_toolbar_no_clipping_overflow",
      "Toolbar Establishes No Clipping Boundary (overflow is visible/relative)",
      noClippingOverflow,
      {
        computedOverflowX: dropdownGeometry.toolbarOverflowX,
        computedOverflowY: dropdownGeometry.toolbarOverflowY,
      }
    );

    recordTest(
      "CH2.3_dropdown_elementFromPoint_hit_test",
      "Dropdown Renders Above Content & Is Not Vertically Cropped (Hit-Test)",
      dropdownGeometry.isMenuAtHitPoint,
      {
        hitTestCoords: `(${dropdownGeometry.hitTestX}, ${dropdownGeometry.hitTestY})`,
        hitElement: `<${dropdownGeometry.hitElementTag}> "${dropdownGeometry.hitElementText}"`,
        isMenuContains: dropdownGeometry.isMenuAtHitPoint,
      }
    );

    const allSecondaryItemsPresent = dropdownGeometry.hasSnooze &&
                                     dropdownGeometry.hasMove &&
                                     dropdownGeometry.hasLabel &&
                                     dropdownGeometry.hasSpam &&
                                     dropdownGeometry.hasPrint &&
                                     dropdownGeometry.hasDownload &&
                                     dropdownGeometry.hasHeaders;

    recordTest(
      "CH2.4_all_secondary_actions_present",
      "All 7 Secondary Actions Consolidated Inside Overflow Menu",
      allSecondaryItemsPresent,
      {
        hasSnooze: dropdownGeometry.hasSnooze,
        hasMove: dropdownGeometry.hasMove,
        hasLabel: dropdownGeometry.hasLabel,
        hasSpam: dropdownGeometry.hasSpam,
        hasPrint: dropdownGeometry.hasPrint,
        hasDownload: dropdownGeometry.hasDownload,
        hasHeaders: dropdownGeometry.hasHeaders,
        totalItemsFound: dropdownGeometry.itemsFound?.length,
      }
    );

    // -------------------------------------------------------------------------
    // CHALLENGE 3: Nested Submenus Navigation (Move to folder & Label as)
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 3: NESTED SUBMENUS NAVIGATION STRESS TEST                         ");
    console.log("================================================================================");

    // Submenu 1: Move to folder
    const moveBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="menu"] button'));
      const target = btns.find(b => b.innerText.includes("Move to folder"));
      if (target) { target.click(); return true; }
      return false;
    });
    await sleep(300);

    const moveSubmenuAudit = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"][aria-label="More actions menu"]');
      const title = menu ? menu.querySelector('span.font-semibold')?.innerText : null;
      const backBtn = menu ? menu.querySelector('button[aria-label="Back to more actions"]') : null;
      const folderOptions = menu ? Array.from(menu.querySelectorAll('button')).map(b => b.innerText.trim()) : [];
      return {
        hasTitle: title === "Move to folder",
        hasBackBtn: Boolean(backBtn),
        folderCount: folderOptions.length,
      };
    });

    recordTest(
      "CH3.1_move_to_folder_submenu",
      "Nested 'Move to folder' Submenu Renders with Back Navigation",
      moveSubmenuAudit.hasTitle && moveSubmenuAudit.hasBackBtn,
      moveSubmenuAudit
    );

    // Click Back button in move submenu
    await page.evaluate(() => {
      const backBtn = document.querySelector('[role="menu"] button[aria-label="Back to more actions"]');
      if (backBtn) backBtn.click();
    });
    await sleep(300);

    // Submenu 2: Label as
    const labelBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="menu"] button'));
      const target = btns.find(b => b.innerText.includes("Label as"));
      if (target) { target.click(); return true; }
      return false;
    });
    await sleep(300);

    const labelSubmenuAudit = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"][aria-label="More actions menu"]');
      const title = menu ? menu.querySelector('span.font-semibold')?.innerText : null;
      const backBtn = menu ? menu.querySelector('button[aria-label="Back to more actions"]') : null;
      return {
        hasTitle: title === "Label as",
        hasBackBtn: Boolean(backBtn),
      };
    });

    recordTest(
      "CH3.2_label_as_submenu",
      "Nested 'Label as' Submenu Renders with Back Navigation",
      labelSubmenuAudit.hasTitle && labelSubmenuAudit.hasBackBtn,
      labelSubmenuAudit
    );

    // Click Back button in label submenu
    await page.evaluate(() => {
      const backBtn = document.querySelector('[role="menu"] button[aria-label="Back to more actions"]');
      if (backBtn) backBtn.click();
    });
    await sleep(300);

    // -------------------------------------------------------------------------
    // CHALLENGE 4: Keyboard Escape Key Isolation
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 4: KEYBOARD ESCAPE KEY ISOLATION STRESS TEST                      ");
    console.log("================================================================================");

    // Currently More menu is open. Press Escape.
    await page.keyboard.press("Escape");
    await sleep(400);

    const afterEscapeAudit = await page.evaluate(() => {
      const readingPane = document.querySelector('[data-testid="reading-pane"]');
      const overflowBtn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
      const menu = document.querySelector('[role="menu"][aria-label="More actions menu"]');
      const menuStyle = menu ? window.getComputedStyle(menu) : null;
      const isMenuHidden = menu ? (menu.classList.contains("hidden") || menuStyle.display === "none" || menuStyle.opacity === "0") : true;

      return {
        readingPaneStillOpen: Boolean(readingPane),
        overflowAriaExpanded: overflowBtn ? overflowBtn.getAttribute("aria-expanded") : null,
        isMenuHidden,
      };
    });

    recordTest(
      "CH4.1_escape_closes_menu_not_pane",
      "Escape Dismisses Overflow Menu While ReadingPane Remains Open",
      afterEscapeAudit.readingPaneStillOpen && afterEscapeAudit.isMenuHidden && afterEscapeAudit.overflowAriaExpanded === "false",
      afterEscapeAudit
    );

    // -------------------------------------------------------------------------
    // CHALLENGE 5: Snooze Backward Compatibility (Unified Inbox Test Pattern)
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 5: SNOOZE BACKWARD COMPATIBILITY (AUTOMATED E2E PATTERN)           ");
    console.log("================================================================================");

    // In test_unified_inbox_browser.mjs line 425:
    // It queries [data-testid="reading-pane-snooze-btn"] and invokes .click() directly on the DOM node while menu is closed!
    const snoozeClickResult = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="reading-pane-snooze-btn"]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });

    await sleep(600);

    // Capture screenshot of Snooze Dialog
    const snoozeScreenshot = path.resolve(artifactsDir, "m4_challenger_snooze_dialog.png");
    await page.screenshot({ path: snoozeScreenshot });

    const snoozeDialogAudit = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Snooze Message"]');
      if (!dialog) return { found: false };

      const buttons = Array.from(dialog.querySelectorAll('button')).map(b => b.innerText.trim());
      const hasTomorrow = buttons.some(t => t.includes("Tomorrow"));
      const hasLaterToday = buttons.some(t => t.includes("Later today"));
      const hasThisWeekend = buttons.some(t => t.includes("This weekend"));
      const hasNextWeek = buttons.some(t => t.includes("Next week"));

      return {
        found: true,
        presets: buttons,
        hasTomorrow,
        hasLaterToday,
        hasThisWeekend,
        hasNextWeek,
      };
    });

    recordTest(
      "CH5.1_snooze_dom_click_backward_compatibility",
      "Direct [data-testid='reading-pane-snooze-btn'].click() Launches Snooze Dialog",
      snoozeClickResult && snoozeDialogAudit.found,
      {
        snoozeBtnClicked: snoozeClickResult,
        dialogFound: snoozeDialogAudit.found,
        presetCount: snoozeDialogAudit.presets?.length,
        hasTomorrow: snoozeDialogAudit.hasTomorrow,
        hasLaterToday: snoozeDialogAudit.hasLaterToday,
      }
    );

    // Press Escape to close Snooze Dialog
    await page.keyboard.press("Escape");
    await sleep(400);

    const afterSnoozeEscape = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="Snooze Message"]');
      const readingPane = document.querySelector('[data-testid="reading-pane"]');
      return {
        dialogClosed: !dialog,
        readingPaneStillOpen: Boolean(readingPane),
      };
    });

    recordTest(
      "CH5.2_escape_closes_snooze_not_pane",
      "Escape Closes Snooze Dialog While ReadingPane Remains Open",
      afterSnoozeEscape.dialogClosed && afterSnoozeEscape.readingPaneStillOpen,
      afterSnoozeEscape
    );

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGER SUITE EXECUTION SUMMARY                                          ");
    console.log("================================================================================");

    const totalTests = challengeResults.length;
    const passedTests = challengeResults.filter(r => r.passed).length;
    const failedTests = challengeResults.filter(r => !r.passed).length;

    console.log(`Total Assertions: ${totalTests}`);
    console.log(`Passed:           ${passedTests}`);
    console.log(`Failed:           ${failedTests}`);

    const summaryPath = path.resolve(artifactsDir, "m4_challenger_viewport_layout_summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(challengeResults, null, 2), "utf8");
    console.log(`Saved execution summary to ${summaryPath}\n`);

    if (failedTests > 0) {
      console.error(`CHALLENGE FAILED: ${failedTests} assertions did not pass.`);
      process.exitCode = 1;
    } else {
      console.log("CHALLENGE PASSED 100%: All responsive layout, clipping, and backward compatibility invariants verified!");
    }

  } catch (err) {
    console.error("Fatal Challenger Error:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runChallengerSuite().catch(console.error);
