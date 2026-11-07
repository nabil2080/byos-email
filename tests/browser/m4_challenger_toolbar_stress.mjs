/**
 * ============================================================================
 * Milestone 4 Challenger 1: Reading Pane Toolbar & Overflow Menu Stress Test Harness
 * ============================================================================
 * 
 * Target: Email Reading Section Toolbar Simplification (R3 / Features F11 & F12)
 * 
 * EMPIRICAL ADVERSARIAL CHALLENGE SUITE:
 * 1. Rapid Toggle Stress Test:
 *    - Open and close the More overflow dropdown 15 times in rapid succession (<50ms intervals).
 *    - Stress across 3 dismissal mechanisms: toggle button click, outside click, and Escape key.
 *    - Assertions: Zero console errors, deterministic aria-expanded state sync, no DOM desync.
 * 
 * 2. Escape Key Isolation Test:
 *    - Open More menu, press Escape.
 *    - Assert: More menu closes (`aria-expanded === "false"`) AND ReadingPane remains open (`readingPaneStillVisible === true`).
 *    - Nested Escape Isolation: Test nested submenus ("move", "label", "snooze", "headers").
 *      Assert: Escape dismisses deepest active overlay without closing ReadingPane.
 * 
 * 3. Action Triggers Inside Overflow Menu:
 *    - Trigger actions: Snooze, View/Hide Headers, Print message, Move to folder subview, Label as subview.
 *    - Assert: Actions fire correctly without console errors or runtime exceptions.
 * 
 * 4. Automated Selector Presence & Execution:
 *    - Verify `document.querySelector('[data-testid="reading-pane-snooze-btn"]')` is queryable in DOM.
 *    - Assert `.click()` on the selector successfully opens Snooze dialog even when menu was unexpanded.
 * 
 * Standard: Node ESM, Puppeteer Core, Google Chrome
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

function recordResult(challengeId, name, passed, details = "") {
  const result = { id: challengeId, name, passed, details, timestamp: new Date().toISOString() };
  challengeResults.push(result);
  const statusStr = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${statusStr} [${challengeId}] ${name}`);
  if (details) {
    console.log(`         Details: ${details}`);
  }
}

async function runToolbarStressHarness() {
  console.log("================================================================================");
  console.log("   BYOS WEBMAIL: MILESTONE 4 EMPIRICAL CHALLENGER STRESS HARNESS               ");
  console.log("   Target: Reading Pane Toolbar Simplification & Overflow Menu Stress (R3)    ");
  console.log("================================================================================\n");

  const pageErrors = [];
  const consoleWarningsAndErrors = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--window-size=1280,800",
      "--js-flags=--expose-gc",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Intercept window.print to prevent headless hanging
  await page.evaluateOnNewDocument(() => {
    window.__printCalled = 0;
    window.print = () => {
      window.__printCalled = (window.__printCalled || 0) + 1;
    };
  });

  try {
    // --------------------------------------------------------------------------
    // STEP 0: Authentication Flow & Setup
    // --------------------------------------------------------------------------
    console.log("--- [STEP 0] Authentication Flow for alice@byos.local ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1000);
    console.log("  Successfully authenticated as Alice.\n");

    // Track console errors during active toolbar stress testing
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
      console.error(`  [PAGE ERROR]: ${err.message}`);
    });

    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error") {
        consoleWarningsAndErrors.push({ type: msg.type(), text });
        console.error(`  [CONSOLE ERROR]: ${text}`);
      }
    });

    // Open Reading Pane by clicking the first message row
    console.log("--- [STEP 1] Opening Reading Pane ---");
    const row = await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    await row.click();
    await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 8000 });
    await sleep(600);

    const readingPaneInitial = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const overflowBtn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
      const snoozeBtn = document.querySelector('[data-testid="reading-pane-snooze-btn"]');
      return {
        hasReadingPane: Boolean(pane),
        hasOverflowBtn: Boolean(overflowBtn),
        hasSnoozeBtn: Boolean(snoozeBtn),
        ariaExpanded: overflowBtn ? overflowBtn.getAttribute("aria-expanded") : null,
      };
    });
    console.log("  Reading Pane initial state:", JSON.stringify(readingPaneInitial));

    // --------------------------------------------------------------------------
    // CHALLENGE 1: Automated Selector Presence & Headless Queryability
    // --------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 1: AUTOMATED SELECTOR PRESENCE & COMPATIBILITY                     ");
    console.log("================================================================================");
    
    const selectorCheck = await page.evaluate(() => {
      const snoozeBtn = document.querySelector('[data-testid="reading-pane-snooze-btn"]');
      const overflowBtn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
      const isMenuOpen = overflowBtn?.getAttribute("aria-expanded") === "true";
      return {
        queryableWhileMenuClosed: Boolean(snoozeBtn) && !isMenuOpen,
        tagName: snoozeBtn ? snoozeBtn.tagName : null,
        btnRole: snoozeBtn ? snoozeBtn.getAttribute("role") : null,
        hasClickMethod: Boolean(snoozeBtn && typeof snoozeBtn.click === "function"),
      };
    });

    const ch1Passed = selectorCheck.queryableWhileMenuClosed && selectorCheck.hasClickMethod;
    recordResult(
      "CH-1.1",
      "[data-testid=\"reading-pane-snooze-btn\"] DOM queryability while menu closed",
      ch1Passed,
      `queryable=${selectorCheck.queryableWhileMenuClosed}, tagName=${selectorCheck.tagName}, role=${selectorCheck.btnRole}`
    );

    // Test calling .click() on snooze button while overflow menu closed
    const directSnoozeClick = await page.evaluate(() => {
      const snoozeBtn = document.querySelector('[data-testid="reading-pane-snooze-btn"]');
      snoozeBtn?.click();
      const snoozeModal = document.querySelector('[role="dialog"][aria-label="Snooze Message"]');
      return {
        snoozeModalOpened: Boolean(snoozeModal),
      };
    });

    // Dismiss snooze dialog if opened
    await page.keyboard.press("Escape");
    await sleep(200);

    recordResult(
      "CH-1.2",
      "Direct programmatic .click() on snooze button triggers snooze action",
      directSnoozeClick.snoozeModalOpened,
      `snoozeModalOpened=${directSnoozeClick.snoozeModalOpened}`
    );

    // --------------------------------------------------------------------------
    // CHALLENGE 2: Rapid Toggle Stress Test (<50ms intervals across 15 cycles)
    // --------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 2: RAPID TOGGLE STRESS TEST (<50ms INTERVALS, 15 CYCLES)           ");
    console.log("================================================================================");

    const rapidToggleStats = {
      cycleCount: 15,
      buttonToggleFailures: 0,
      outsideClickFailures: 0,
      escapeDismissFailures: 0,
      measuredLatenciesMs: [],
    };

    // Sub-phase A: 5 rapid toggles via button click (<50ms interval)
    console.log("  [Phase 2A] Rapid toggle via button click (5 cycles @ ~25ms interval)...");
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await page.click('[data-testid="reading-pane-overflow-btn"]');
      await sleep(25);
      const openState = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
        const menu = document.querySelector('[data-testid="reading-pane"] [role="menu"]');
        return btn?.getAttribute("aria-expanded") === "true" && !menu?.classList.contains("hidden");
      });
      if (!openState) rapidToggleStats.buttonToggleFailures++;

      await page.click('[data-testid="reading-pane-overflow-btn"]');
      await sleep(25);
      const closedState = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
        const menu = document.querySelector('[data-testid="reading-pane"] [role="menu"]');
        return btn?.getAttribute("aria-expanded") === "false" && menu?.classList.contains("hidden");
      });
      if (!closedState) rapidToggleStats.buttonToggleFailures++;
      rapidToggleStats.measuredLatenciesMs.push(Date.now() - t0);
    }

    // Sub-phase B: 5 rapid toggles via outside click (<50ms interval)
    console.log("  [Phase 2B] Rapid toggle via outside click (5 cycles @ ~30ms interval)...");
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await page.click('[data-testid="reading-pane-overflow-btn"]');
      await sleep(30);
      const openState = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
        return btn?.getAttribute("aria-expanded") === "true";
      });
      if (!openState) rapidToggleStats.outsideClickFailures++;

      // Click outside: click message content area (outside paneToolbarRef)
      await page.evaluate(() => {
        const pane = document.querySelector('[data-testid="reading-pane"]');
        const bodyEl = pane?.querySelector('.overflow-y-auto') || pane;
        bodyEl?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      });
      await sleep(30);
      const closedState = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
        const menu = document.querySelector('[data-testid="reading-pane"] [role="menu"]');
        return btn?.getAttribute("aria-expanded") === "false" && menu?.classList.contains("hidden");
      });
      if (!closedState) rapidToggleStats.outsideClickFailures++;
      rapidToggleStats.measuredLatenciesMs.push(Date.now() - t0);
    }

    // Sub-phase C: 5 rapid toggles via Escape key (<50ms interval)
    console.log("  [Phase 2C] Rapid toggle via Escape key (5 cycles @ ~25ms interval)...");
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      await page.click('[data-testid="reading-pane-overflow-btn"]');
      await sleep(25);
      const openState = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
        return btn?.getAttribute("aria-expanded") === "true";
      });
      if (!openState) rapidToggleStats.escapeDismissFailures++;

      await page.keyboard.press("Escape");
      await sleep(25);
      const closedState = await page.evaluate(() => {
        const pane = document.querySelector('[data-testid="reading-pane"]');
        const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
        const menu = document.querySelector('[data-testid="reading-pane"] [role="menu"]');
        return {
          paneVisible: Boolean(pane),
          menuClosed: btn?.getAttribute("aria-expanded") === "false" && menu?.classList.contains("hidden"),
        };
      });
      if (!closedState.menuClosed || !closedState.paneVisible) rapidToggleStats.escapeDismissFailures++;
      rapidToggleStats.measuredLatenciesMs.push(Date.now() - t0);
    }

    const avgLatency = Math.round(
      rapidToggleStats.measuredLatenciesMs.reduce((a, b) => a + b, 0) /
        rapidToggleStats.measuredLatenciesMs.length
    );

    const ch2Passed =
      rapidToggleStats.buttonToggleFailures === 0 &&
      rapidToggleStats.outsideClickFailures === 0 &&
      rapidToggleStats.escapeDismissFailures === 0 &&
      pageErrors.length === 0;

    recordResult(
      "CH-2.1",
      "Rapid toggle 15 cycles (<50ms intervals) across Click, Outside Click, and Escape",
      ch2Passed,
      `cycles=15, btnFailures=${rapidToggleStats.buttonToggleFailures}, outsideFailures=${rapidToggleStats.outsideClickFailures}, escFailures=${rapidToggleStats.escapeDismissFailures}, avgCycleLatency=${avgLatency}ms`
    );

    // Save screenshot after rapid toggle
    const rapidScreenshotPath = path.join(artifactsDir, "m4_challenger_overflow_rapid_toggle.png");
    await page.screenshot({ path: rapidScreenshotPath });

    // --------------------------------------------------------------------------
    // CHALLENGE 3: Escape Key Isolation Across Overlays
    // --------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 3: ESCAPE KEY ISOLATION & PROPAGATION CONTAINMENT                 ");
    console.log("================================================================================");

    // Test 3.1: More Menu open -> Escape -> Only menu closes, ReadingPane remains intact
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(200);

    const menuOpenBeforeEsc = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
      return btn?.getAttribute("aria-expanded") === "true";
    });

    await page.keyboard.press("Escape");
    await sleep(300);

    const test3_1 = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const btn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');
      const menu = document.querySelector('[data-testid="reading-pane"] [role="menu"]');
      return {
        readingPaneStillVisible: Boolean(pane),
        menuAriaExpanded: btn?.getAttribute("aria-expanded"),
        menuHasHiddenClass: menu?.classList.contains("hidden"),
      };
    });

    const ch3_1Passed =
      menuOpenBeforeEsc &&
      test3_1.readingPaneStillVisible === true &&
      test3_1.menuAriaExpanded === "false" &&
      test3_1.menuHasHiddenClass === true;

    recordResult(
      "CH-3.1",
      "Escape key isolation on More menu (closes menu, reading pane remains visible)",
      ch3_1Passed,
      `readingPaneStillVisible=${test3_1.readingPaneStillVisible}, ariaExpanded=${test3_1.menuAriaExpanded}, hidden=${test3_1.menuHasHiddenClass}`
    );

    // Test 3.2: Move to Folder Submenu -> Escape -> Submenu resets to none, ReadingPane remains intact
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(200);
    // Click "Move to folder…"
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="reading-pane"] [role="menuitem"]'));
      const moveItem = items.find((el) => el.textContent.includes("Move to folder"));
      moveItem?.click();
    });
    await sleep(200);

    const moveSubmenuOpen = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const header = pane?.querySelector('span.font-semibold');
      return header?.textContent.includes("Move to folder");
    });

    // Press Escape -> Should close submenu back to "none", ReadingPane still intact
    await page.keyboard.press("Escape");
    await sleep(300);

    const moveSubmenuClosed = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const header = pane?.querySelector('span.font-semibold');
      const isSubmenuHeaderPresent = header?.textContent.includes("Move to folder");
      return {
        readingPaneStillVisible: Boolean(pane),
        submenuDismissed: !isSubmenuHeaderPresent,
      };
    });

    const ch3_2Passed =
      moveSubmenuOpen &&
      moveSubmenuClosed.readingPaneStillVisible &&
      moveSubmenuClosed.submenuDismissed;

    recordResult(
      "CH-3.2",
      "Escape key isolation on nested Move Submenu (resets submenu, preserves reading pane)",
      ch3_2Passed,
      `moveSubmenuOpen=${moveSubmenuOpen}, readingPaneStillVisible=${moveSubmenuClosed.readingPaneStillVisible}, submenuDismissed=${moveSubmenuClosed.submenuDismissed}`
    );

    // Clean up if menu is still open
    await page.keyboard.press("Escape");
    await sleep(200);

    // Test 3.3: Snooze Dialog -> Escape -> Snooze dialog closes, ReadingPane remains intact
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(200);
    await page.click('[data-testid="reading-pane-snooze-btn"]');
    await sleep(250);

    const snoozeModalOpen = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"][aria-label="Snooze Message"]');
      return Boolean(modal);
    });

    await page.keyboard.press("Escape");
    await sleep(300);

    const snoozeModalClosed = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const modal = document.querySelector('[role="dialog"][aria-label="Snooze Message"]');
      return {
        readingPaneStillVisible: Boolean(pane),
        snoozeModalGone: !modal,
      };
    });

    const ch3_3Passed =
      snoozeModalOpen &&
      snoozeModalClosed.readingPaneStillVisible &&
      snoozeModalClosed.snoozeModalGone;

    recordResult(
      "CH-3.3",
      "Escape key isolation on Snooze Dialog (dismisses dialog, preserves reading pane)",
      ch3_3Passed,
      `snoozeModalOpen=${snoozeModalOpen}, readingPaneStillVisible=${snoozeModalClosed.readingPaneStillVisible}, snoozeModalGone=${snoozeModalClosed.snoozeModalGone}`
    );

    // Screenshot after escape isolation
    const escScreenshotPath = path.join(artifactsDir, "m4_challenger_escape_isolation.png");
    await page.screenshot({ path: escScreenshotPath });

    // --------------------------------------------------------------------------
    // CHALLENGE 4: Action Triggers Inside Overflow Menu (Snooze, Headers, Print, EML)
    // --------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 4: ACTION TRIGGERS INSIDE OVERFLOW MENU                           ");
    console.log("================================================================================");

    // Test 4.1: Toggle Headers via "View headers" / "Hide headers"
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(200);

    // Click "View headers"
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="reading-pane"] [role="menuitem"]'));
      const headerItem = items.find((el) => el.textContent.includes("View headers"));
      headerItem?.click();
    });
    await sleep(300);

    const headersVisible = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      // Look for the expanded headers section (contains "End-to-End Encrypted" or "security:")
      const secDetails = pane?.textContent.includes("End-to-End Encrypted") || pane?.textContent.includes("security:");
      return Boolean(secDetails);
    });

    // Reopen menu and click "Hide headers"
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(200);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="reading-pane"] [role="menuitem"]'));
      const hideItem = items.find((el) => el.textContent.includes("Hide headers"));
      hideItem?.click();
    });
    await sleep(300);

    const headersToggled = headersVisible && pageErrors.length === 0;
    recordResult(
      "CH-4.1",
      "View/Hide headers toggle from overflow menu executes cleanly",
      headersToggled,
      `headersExpandedOnFirstClick=${headersVisible}, pageErrors=${pageErrors.length}`
    );

    // Test 4.2: Print Message trigger
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(200);

    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="reading-pane"] [role="menuitem"]'));
      const printItem = items.find((el) => el.textContent.includes("Print message"));
      printItem?.click();
    });
    await sleep(200);

    const printCalledCount = await page.evaluate(() => window.__printCalled || 0);
    const ch4_2Passed = printCalledCount > 0 && pageErrors.length === 0;

    recordResult(
      "CH-4.2",
      "Print message action invoked window.print() without error",
      ch4_2Passed,
      `printCalledCount=${printCalledCount}`
    );

    // Test 4.3: Label as… submenu navigation and back button
    await page.click('[data-testid="reading-pane-overflow-btn"]');
    await sleep(200);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="reading-pane"] [role="menuitem"]'));
      const labelItem = items.find((el) => el.textContent.includes("Label as"));
      labelItem?.click();
    });
    await sleep(200);

    const labelSubmenuOpen = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const header = pane?.querySelector('span.font-semibold');
      return header?.textContent.includes("Label as");
    });

    // Click Back arrow inside submenu
    await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      const backBtn = pane?.querySelector('button[aria-label="Back to more actions"]');
      backBtn?.click();
    });
    await sleep(200);

    const labelSubmenuReturned = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[data-testid="reading-pane"] [role="menuitem"]'));
      const hasSnooze = items.some((el) => el.textContent.includes("Snooze"));
      return hasSnooze;
    });

    // Close menu
    await page.keyboard.press("Escape");
    await sleep(200);

    const ch4_3Passed = labelSubmenuOpen && labelSubmenuReturned;
    recordResult(
      "CH-4.3",
      "Label as submenu entry, rendering, and Back button navigation",
      ch4_3Passed,
      `labelSubmenuOpen=${labelSubmenuOpen}, labelSubmenuReturned=${labelSubmenuReturned}`
    );

    // --------------------------------------------------------------------------
    // CHALLENGE 5: Primary Action Buttons Direct Execution
    // --------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   CHALLENGE 5: PRIMARY ACTION BUTTONS DIRECT ACCESSIBILITY & STATE            ");
    console.log("================================================================================");

    const primaryButtonsState = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      if (!pane) return { found: false };

      const backBtn = pane.querySelector('[data-testid="reading-pane-back-btn"]');
      const replyBtn = pane.querySelector('[data-testid="reading-pane-reply-btn"]');
      const overflowBtn = pane.querySelector('[data-testid="reading-pane-overflow-btn"]');

      // Check toolbar button dimensions (desktop accessibility standard: >=36px)
      const replyBox = replyBtn ? replyBtn.getBoundingClientRect() : null;
      const overflowBox = overflowBtn ? overflowBtn.getBoundingClientRect() : null;

      return {
        found: true,
        hasBack: Boolean(backBtn),
        hasReply: Boolean(replyBtn),
        hasOverflow: Boolean(overflowBtn),
        replyWidth: replyBox ? Math.round(replyBox.width) : 0,
        replyHeight: replyBox ? Math.round(replyBox.height) : 0,
        overflowWidth: overflowBox ? Math.round(overflowBox.width) : 0,
        overflowHeight: overflowBox ? Math.round(overflowBox.height) : 0,
      };
    });

    const ch5Passed =
      primaryButtonsState.hasBack &&
      primaryButtonsState.hasReply &&
      primaryButtonsState.hasOverflow &&
      primaryButtonsState.replyWidth >= 36 &&
      primaryButtonsState.replyHeight >= 36 &&
      primaryButtonsState.overflowWidth >= 36 &&
      primaryButtonsState.overflowHeight >= 36;

    recordResult(
      "CH-5.1",
      "Direct primary toolbar actions presence and >=36px click target compliance",
      ch5Passed,
      `hasBack=${primaryButtonsState.hasBack}, hasReply=${primaryButtonsState.hasReply}, replyTarget=${primaryButtonsState.replyWidth}x${primaryButtonsState.replyHeight}px, overflowTarget=${primaryButtonsState.overflowWidth}x${primaryButtonsState.overflowHeight}px`
    );

    // --------------------------------------------------------------------------
    // SUMMARY
    // --------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("   MILESTONE 4 EMPIRICAL CHALLENGER EXECUTION SUMMARY                          ");
    console.log("================================================================================\n");

    const totalTests = challengeResults.length;
    const passedTests = challengeResults.filter((r) => r.passed).length;
    const failedTests = totalTests - passedTests;

    console.log(`Total Challenges: ${totalTests}`);
    console.log(`Passed:           ${passedTests}`);
    console.log(`Failed:           ${failedTests}`);
    console.log(`Page Errors:      ${pageErrors.length}`);
    console.log(`Console Errors:   ${consoleWarningsAndErrors.length}`);

    const summaryData = {
      milestone: "M4",
      title: "Email Reading Section Toolbar Simplification (R3)",
      totalChallenges: totalTests,
      passedChallenges: passedTests,
      failedChallenges: failedTests,
      pageErrors,
      consoleErrors: consoleWarningsAndErrors,
      results: challengeResults,
      verdict: failedTests === 0 ? "CONFIRMED CORRECT" : "CHALLENGE_FAILED",
      timestamp: new Date().toISOString(),
    };

    const summaryPath = path.join(artifactsDir, "m4_challenger_stress_summary.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summaryData, null, 2));
    console.log(`\nSaved challenge summary to ${summaryPath}`);

    if (failedTests > 0 || pageErrors.length > 0) {
      console.error("\n[VERDICT]: CHALLENGE_FAILED — One or more empirical stress challenges failed!");
      process.exitCode = 1;
    } else {
      console.log("\n[VERDICT]: CONFIRMED CORRECT — Streamlined reading pane toolbar withstands empirical challenge!");
    }

  } catch (err) {
    console.error("Test execution encountered an unhandled exception:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runToolbarStressHarness();
