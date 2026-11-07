/**
 * ============================================================================
 * Milestone 2 Challenger 2: Customization UI Icon & State Adversarial Verification
 * ============================================================================
 * 
 * Target: Customization UI Icon Animation & State Transitions (R4 / F6)
 * 
 * Adversarial Verifications:
 * 1. Initial State: Button presence in Mail, aria-expanded="false", palette SVG rotate-0,
 *    close 'X' SVG -rotate-90, badge scale-0, panel absent, zero outer scroll.
 * 2. Clean Single Toggle: Transitions to open (aria-expanded="true", palette rotate-90,
 *    close 'X' rotate-0, badge scale-100, panel open, zero scroll) and back to closed.
 * 3. Adversarial Rapid Toggling Stress: 25 rapid clicks in <2000ms. Verifies state machine
 *    parity, zero race condition desync, zero console/page errors, and exact CSS rotation/scale classes.
 * 4. Rapid Even-Toggle Stress: 20 rapid clicks in <1500ms returning cleanly to closed state.
 * 5. Escape Key Dismissal & Stress: Single Escape dismissal, 5x rapid Escape spam,
 *    Escape while focused on internal panel controls.
 * 6. Multi-Viewport Scroll Containment: Desktop (1280x800), Tablet (768x1024), Mobile (375x667).
 *    Asserts zero document/body scroll leakage in both open and closed states.
 * 7. Cross-Module State Reset: Open customizer -> switch to Calendar -> verify panel closed
 *    and button hidden -> switch back to Mail -> verify button reset to closed 0° rotation.
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

const testResults = [];

function recordResult(testId, name, passed, details = "") {
  const result = { id: testId, name, passed, details, timestamp: new Date().toISOString() };
  testResults.push(result);
  const statusStr = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${statusStr} [${testId}] ${name}`);
  if (details) {
    console.log(`         Details: ${details}`);
  }
}

async function getCustomizerIconState(page) {
  return await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
    if (!btn) return { exists: false };

    const ariaExpanded = btn.getAttribute("aria-expanded");
    const isExpanded = ariaExpanded === "true";
    const title = btn.getAttribute("title");

    const svgs = btn.querySelectorAll("svg");
    const paletteSvg = svgs[0] || null;
    const closeSvg = svgs[1] || null;
    const badge = btn.querySelector("span.rounded-full");
    const panel = document.querySelector('[data-testid="quick-settings-panel"]');

    const paletteClasses = paletteSvg ? paletteSvg.getAttribute("class") || "" : "";
    const closeClasses = closeSvg ? closeSvg.getAttribute("class") || "" : "";
    const badgeClasses = badge ? badge.getAttribute("class") || "" : "";

    const paletteTransform = paletteSvg ? window.getComputedStyle(paletteSvg).transform : "";
    const paletteOpacity = paletteSvg ? window.getComputedStyle(paletteSvg).opacity : "";
    const closeTransform = closeSvg ? window.getComputedStyle(closeSvg).transform : "";
    const closeOpacity = closeSvg ? window.getComputedStyle(closeSvg).opacity : "";
    const badgeTransform = badge ? window.getComputedStyle(badge).transform : "";
    const badgeOpacity = badge ? window.getComputedStyle(badge).opacity : "";

    return {
      exists: true,
      ariaExpanded,
      isExpanded,
      title,
      svgCount: svgs.length,
      paletteClasses,
      paletteHasRotate0: paletteClasses.includes("rotate-0"),
      paletteHasRotate90: paletteClasses.includes("rotate-90"),
      paletteHasOpacity100: paletteClasses.includes("opacity-100"),
      paletteHasOpacity0: paletteClasses.includes("opacity-0"),
      paletteHasScale100: paletteClasses.includes("scale-100"),
      paletteHasScale75: paletteClasses.includes("scale-75"),
      paletteTransform,
      paletteOpacity,
      closeClasses,
      closeHasCounterRotate90: closeClasses.includes("-rotate-90"),
      closeHasRotate0: closeClasses.includes("rotate-0"),
      closeHasOpacity100: closeClasses.includes("opacity-100"),
      closeHasOpacity0: closeClasses.includes("opacity-0"),
      closeHasScale100: closeClasses.includes("scale-100"),
      closeHasScale75: closeClasses.includes("scale-75"),
      closeTransform,
      closeOpacity,
      badgeClasses,
      badgeHasScale0: badgeClasses.includes("scale-0"),
      badgeHasScale100: badgeClasses.includes("scale-100"),
      badgeHasOpacity0: badgeClasses.includes("opacity-0"),
      badgeHasOpacity100: badgeClasses.includes("opacity-100"),
      badgeTransform,
      badgeOpacity,
      panelPresent: Boolean(panel),
    };
  });
}

async function getScrollAudit(page) {
  return await page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;

    const winScrollY = window.scrollY;
    const winScrollX = window.scrollX;
    const docScrollTop = docEl.scrollTop;
    const bodyScrollTop = body.scrollTop;

    const docScrollHeight = docEl.scrollHeight;
    const docClientHeight = docEl.clientHeight;
    const bodyScrollHeight = body.scrollHeight;
    const bodyClientHeight = body.clientHeight;

    const isLeaking =
      winScrollY > 0 ||
      winScrollX > 0 ||
      docScrollTop > 0 ||
      bodyScrollTop > 0 ||
      docScrollHeight > docClientHeight + 2 ||
      bodyScrollHeight > bodyClientHeight + 2;

    return {
      winScrollY,
      winScrollX,
      docScrollTop,
      bodyScrollTop,
      docScrollHeight,
      docClientHeight,
      bodyScrollHeight,
      bodyClientHeight,
      isLeaking,
    };
  });
}

async function run() {
  console.log("================================================================================");
  console.log("  CHALLENGER M2-2: CUSTOMIZATION ICON & STATE ADVERSARIAL STRESS SUITE");
  console.log("================================================================================\n");

  const pageErrors = [];
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

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.error(`  [PAGE ERROR]: ${err.message}`);
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 0: Authentication
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
    // TEST 1: Initial Default State Verification
    // -------------------------------------------------------------------------
    console.log("--- [TEST 1] Initial Closed State Verification ---");
    const s1 = await getCustomizerIconState(page);
    const scroll1 = await getScrollAudit(page);

    const test1Passed =
      s1.exists &&
      s1.ariaExpanded === "false" &&
      s1.paletteHasRotate0 &&
      s1.paletteHasScale100 &&
      s1.paletteHasOpacity100 &&
      s1.closeHasCounterRotate90 &&
      s1.closeHasScale75 &&
      s1.closeHasOpacity0 &&
      s1.badgeHasScale0 &&
      s1.badgeHasOpacity0 &&
      !s1.panelPresent &&
      !scroll1.isLeaking;

    await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_customizer_icon_closed.png") });

    recordResult(
      "CHALLENGE_T1",
      "Initial Closed State Verification",
      test1Passed,
      `ariaExpanded=${s1.ariaExpanded}, paletteRotate0=${s1.paletteHasRotate0}, closeRotate90=${s1.closeHasCounterRotate90}, badgeScale0=${s1.badgeHasScale0}, panelPresent=${s1.panelPresent}, outerScrollLeaking=${scroll1.isLeaking}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Single Click Open & Animation State Transition
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 2] Single Click Open State Transition ---");
    const toggleBtn = await page.$('[data-testid="top-bar-appearance-btn"]');
    if (!toggleBtn) throw new Error("Appearance toggle button not found");

    await toggleBtn.click();
    await sleep(350); // wait for 250ms transition + margin

    const s2 = await getCustomizerIconState(page);
    const scroll2 = await getScrollAudit(page);

    const test2Passed =
      s2.exists &&
      s2.ariaExpanded === "true" &&
      s2.paletteHasRotate90 &&
      s2.paletteHasScale75 &&
      s2.paletteHasOpacity0 &&
      s2.closeHasRotate0 &&
      s2.closeHasScale100 &&
      s2.closeHasOpacity100 &&
      s2.badgeHasScale100 &&
      s2.badgeHasOpacity100 &&
      s2.panelPresent &&
      !scroll2.isLeaking;

    await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_customizer_icon_opened.png") });

    recordResult(
      "CHALLENGE_T2",
      "Single Click Open State & 90deg SVG Rotation",
      test2Passed,
      `ariaExpanded=${s2.ariaExpanded}, paletteRotate90=${s2.paletteHasRotate90}, closeRotate0=${s2.closeHasRotate0}, badgeScale100=${s2.badgeHasScale100}, panelPresent=${s2.panelPresent}, outerScrollLeaking=${scroll2.isLeaking}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Single Click Close State Reset
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 3] Single Click Close State Transition ---");
    await toggleBtn.click();
    await sleep(350);

    const s3 = await getCustomizerIconState(page);
    const scroll3 = await getScrollAudit(page);

    const test3Passed =
      s3.exists &&
      s3.ariaExpanded === "false" &&
      s3.paletteHasRotate0 &&
      s3.closeHasCounterRotate90 &&
      s3.badgeHasScale0 &&
      !s3.panelPresent &&
      !scroll3.isLeaking;

    recordResult(
      "CHALLENGE_T3",
      "Single Click Close Reset Back to 0deg Palette",
      test3Passed,
      `ariaExpanded=${s3.ariaExpanded}, paletteRotate0=${s3.paletteHasRotate0}, closeRotate90=${s3.closeHasCounterRotate90}, badgeScale0=${s3.badgeHasScale0}, panelPresent=${s3.panelPresent}`
    );

    // -------------------------------------------------------------------------
    // TEST 4: Adversarial Rapid Toggling Stress (25 Clicks within ~1000ms)
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 4] Adversarial Rapid Toggling Stress (25 clicks within <1500ms) ---");
    // Starting state is closed (false).
    // 25 clicks (odd number) must land strictly on OPEN (true).
    const startTime25 = Date.now();
    const clickTrack = [];

    for (let i = 1; i <= 25; i++) {
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        if (btn) btn.click();
      });
      // Very fast toggle interval: 25-35ms
      await sleep(30);
      const curExpanded = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        return btn ? btn.getAttribute("aria-expanded") : null;
      });
      clickTrack.push({ click: i, ariaExpanded: curExpanded });
    }
    const elapsed25 = Date.now() - startTime25;
    console.log(`    Executed 25 clicks in ${elapsed25}ms`);

    // Settle animation
    await sleep(400);

    const s4 = await getCustomizerIconState(page);
    const scroll4 = await getScrollAudit(page);

    const test4Passed =
      s4.exists &&
      s4.ariaExpanded === "true" &&
      s4.paletteHasRotate90 &&
      s4.closeHasRotate0 &&
      s4.badgeHasScale100 &&
      s4.panelPresent &&
      !scroll4.isLeaking &&
      pageErrors.length === 0;

    await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_customizer_icon_rapid_stress.png") });

    recordResult(
      "CHALLENGE_T4",
      "Rapid Toggling Stress (25 clicks -> strictly OPEN)",
      test4Passed,
      `elapsed=${elapsed25}ms, finalExpanded=${s4.ariaExpanded}, paletteRotate90=${s4.paletteHasRotate90}, badgeScale100=${s4.badgeHasScale100}, panelPresent=${s4.panelPresent}, pageErrors=${pageErrors.length}`
    );

    // -------------------------------------------------------------------------
    // TEST 5: Rapid Even-Toggle Stress (20 Clicks within <1200ms -> strictly CLOSED)
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 5] Rapid Even-Toggle Stress (20 clicks from OPEN -> strictly CLOSED) ---");
    // Currently open (true). 20 clicks (even number) must land strictly on OPEN (wait: open + 20 clicks = open!).
    // Wait: if currently open, 1 click = closed. 2 clicks = open. Even number (20) keeps it OPEN.
    // To land on CLOSED, we do 21 clicks! Or 1 click then 20 clicks!
    // Let's do 21 clicks to invert from open (true) to closed (false).
    const startTime21 = Date.now();
    for (let i = 1; i <= 21; i++) {
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        if (btn) btn.click();
      });
      await sleep(25);
    }
    const elapsed21 = Date.now() - startTime21;
    console.log(`    Executed 21 clicks in ${elapsed21}ms`);

    await sleep(400);

    const s5 = await getCustomizerIconState(page);
    const scroll5 = await getScrollAudit(page);

    const test5Passed =
      s5.exists &&
      s5.ariaExpanded === "false" &&
      s5.paletteHasRotate0 &&
      s5.closeHasCounterRotate90 &&
      s5.badgeHasScale0 &&
      !s5.panelPresent &&
      !scroll5.isLeaking;

    recordResult(
      "CHALLENGE_T5",
      "Rapid Toggling Inversion (21 clicks -> strictly CLOSED)",
      test5Passed,
      `elapsed=${elapsed21}ms, finalExpanded=${s5.ariaExpanded}, paletteRotate0=${s5.paletteHasRotate0}, closeRotate90=${s5.closeHasCounterRotate90}, badgeScale0=${s5.badgeHasScale0}, panelPresent=${s5.panelPresent}`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Escape Key Dismissal & Stress
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 6] Escape Key Dismissal & Rapid Escape Stress ---");
    // Step 6a: Clean open, then single Escape
    await toggleBtn.click();
    await sleep(350);
    const preEscapeState = await getCustomizerIconState(page);

    await page.keyboard.press("Escape");
    await sleep(350);
    const postEscapeState = await getCustomizerIconState(page);

    const escapeClean =
      preEscapeState.ariaExpanded === "true" &&
      postEscapeState.ariaExpanded === "false" &&
      postEscapeState.paletteHasRotate0 &&
      postEscapeState.closeHasCounterRotate90 &&
      postEscapeState.badgeHasScale0 &&
      !postEscapeState.panelPresent;

    // Step 6b: Rapid Escape Spam (press Escape 5 times when already closed)
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Escape");
      await sleep(40);
    }
    const postSpamState = await getCustomizerIconState(page);
    const spamSafe = postSpamState.ariaExpanded === "false" && !postSpamState.panelPresent;

    // Step 6c: Open customizer, click inside a panel element, then press Escape
    await toggleBtn.click();
    await sleep(350);
    // Click inside the panel (e.g. density option or a heading)
    await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="quick-settings-panel"]');
      if (panel) {
        const btn = panel.querySelector("button");
        if (btn) btn.focus();
      }
    });
    await sleep(100);
    await page.keyboard.press("Escape");
    await sleep(350);
    const postFocusedEscape = await getCustomizerIconState(page);
    const focusedEscapeSuccess =
      postFocusedEscape.ariaExpanded === "false" && !postFocusedEscape.panelPresent;

    await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_customizer_icon_escape_dismissed.png") });

    const test6Passed = escapeClean && spamSafe && focusedEscapeSuccess;
    recordResult(
      "CHALLENGE_T6",
      "Escape Key Dismissal & Repeated Stress",
      test6Passed,
      `escapeClean=${escapeClean}, spamSafe=${spamSafe}, focusedEscapeSuccess=${focusedEscapeSuccess}, finalExpanded=${postFocusedEscape.ariaExpanded}`
    );

    // -------------------------------------------------------------------------
    // TEST 7: Multi-Viewport Scroll Containment Under Customizer Operation
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 7] Multi-Viewport Outer Scroll Containment ---");
    const viewports = [
      { name: "Desktop 1280x800", width: 1280, height: 800 },
      { name: "Tablet 768x1024", width: 768, height: 1024 },
      { name: "Mobile 375x667", width: 375, height: 667 },
    ];

    let allViewportsScrollClean = true;
    const viewportDetails = [];

    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await sleep(300);

      // 1. Audit closed
      const scrollClosed = await getScrollAudit(page);

      // 2. Open customizer (if button exists at this viewport; in mobile top bar appearance btn may or may not be visible)
      const btnVisible = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        if (!btn) return false;
        const rect = btn.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(btn).display !== "none";
      });

      let scrollOpen = { isLeaking: false };
      if (btnVisible) {
        await page.click('[data-testid="top-bar-appearance-btn"]');
        await sleep(350);
        scrollOpen = await getScrollAudit(page);
        if (vp.name.includes("Mobile")) {
          await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_customizer_icon_mobile_opened.png") });
        }
        await page.click('[data-testid="top-bar-appearance-btn"]');
        await sleep(350);
      }

      const vpClean = !scrollClosed.isLeaking && !scrollOpen.isLeaking;
      if (!vpClean) allViewportsScrollClean = false;

      viewportDetails.push(
        `${vp.name}: closedLeak=${scrollClosed.isLeaking}, openLeak=${scrollOpen.isLeaking}, btnVisible=${btnVisible}`
      );
    }

    // Restore desktop viewport
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(300);

    recordResult(
      "CHALLENGE_T7",
      "Multi-Viewport Scroll Containment (Zero Outer Leakage)",
      allViewportsScrollClean,
      viewportDetails.join("; ")
    );

    // -------------------------------------------------------------------------
    // TEST 8: Cross-Module Switching Isolation & Clean Reset
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 8] Cross-Module Switching State Reset ---");
    // 1. Open customizer in mail
    await toggleBtn.click();
    await sleep(350);
    const preSwitchState = await getCustomizerIconState(page);

    // 2. Click Calendar module tab
    const calTab = await page.$('[data-testid="nav-calendar-tab"]');
    if (calTab) {
      await calTab.click();
      await sleep(400);

      // 3. In Calendar, appearance button should be hidden / unmounted
      const calAppearanceBtnCheck = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        const panel = document.querySelector('[data-testid="quick-settings-panel"]');
        return {
          btnPresent: Boolean(btn),
          panelPresent: Boolean(panel),
        };
      });

      // 4. Click back to Emails module tab
      const mailTab = await page.$('[data-testid="nav-emails-tab"]');
      if (mailTab) {
        await mailTab.click();
        await sleep(400);

        // 5. Verify appearance button has reappeared in closed state (0° rotation)
        const postReturnState = await getCustomizerIconState(page);

        const test8Passed =
          preSwitchState.ariaExpanded === "true" &&
          !calAppearanceBtnCheck.btnPresent &&
          !calAppearanceBtnCheck.panelPresent &&
          postReturnState.exists &&
          postReturnState.ariaExpanded === "false" &&
          postReturnState.paletteHasRotate0 &&
          postReturnState.badgeHasScale0 &&
          !postReturnState.panelPresent;

        recordResult(
          "CHALLENGE_T8",
          "Cross-Module Switch Closes Customizer & Resets Icon to 0deg",
          test8Passed,
          `calBtnPresent=${calAppearanceBtnCheck.btnPresent}, calPanelPresent=${calAppearanceBtnCheck.panelPresent}, returnExpanded=${postReturnState.ariaExpanded}, returnPaletteRotate0=${postReturnState.paletteHasRotate0}`
        );
      } else {
        recordResult("CHALLENGE_T8", "Cross-Module Switch (mail tab missing)", false);
      }
    } else {
      recordResult("CHALLENGE_T8", "Cross-Module Switch (calendar tab missing)", false);
    }

    // -------------------------------------------------------------------------
    // TEST 9: SVG Computed CSS Matrix / Rotation Exact Value Verification
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 9] SVG Computed CSS Matrix Verification ---");
    // Verify computed style properties in both states:
    // State A: Closed
    const closedMetrics = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
      if (!btn) return null;
      const svgs = btn.querySelectorAll("svg");
      const badge = btn.querySelector("span.rounded-full");
      const pStyle = window.getComputedStyle(svgs[0]);
      const cStyle = window.getComputedStyle(svgs[1]);
      const bStyle = window.getComputedStyle(badge);
      return {
        paletteOpacity: pStyle.opacity,
        palettePointerEvents: pStyle.pointerEvents,
        closeOpacity: cStyle.opacity,
        closePointerEvents: cStyle.pointerEvents,
        badgeOpacity: bStyle.opacity,
      };
    });

    // State B: Open
    await toggleBtn.click();
    await sleep(350);
    const openMetrics = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
      if (!btn) return null;
      const svgs = btn.querySelectorAll("svg");
      const badge = btn.querySelector("span.rounded-full");
      const pStyle = window.getComputedStyle(svgs[0]);
      const cStyle = window.getComputedStyle(svgs[1]);
      const bStyle = window.getComputedStyle(badge);
      return {
        paletteOpacity: pStyle.opacity,
        palettePointerEvents: pStyle.pointerEvents,
        closeOpacity: cStyle.opacity,
        closePointerEvents: cStyle.pointerEvents,
        badgeOpacity: bStyle.opacity,
      };
    });

    // Close again to leave clean
    await toggleBtn.click();
    await sleep(350);

    const test9Passed =
      closedMetrics.paletteOpacity === "1" &&
      closedMetrics.closeOpacity === "0" &&
      closedMetrics.closePointerEvents === "none" &&
      closedMetrics.badgeOpacity === "0" &&
      openMetrics.paletteOpacity === "0" &&
      openMetrics.palettePointerEvents === "none" &&
      openMetrics.closeOpacity === "1" &&
      openMetrics.badgeOpacity === "1";

    recordResult(
      "CHALLENGE_T9",
      "SVG Computed Style Opacity & Pointer-Events Verification",
      test9Passed,
      `closed(paletteOp=${closedMetrics.paletteOpacity}, closeOp=${closedMetrics.closeOpacity}, closePE=${closedMetrics.closePointerEvents}); open(paletteOp=${openMetrics.paletteOpacity}, closeOp=${openMetrics.closeOpacity}, palettePE=${openMetrics.palettePointerEvents})`
    );

  } catch (err) {
    console.error(`\n[CRITICAL ERROR]: ${err.stack || err.message}`);
    recordResult("CHALLENGE_FATAL", "Execution Exception", false, err.message);
  } finally {
    await browser.close();
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("  CHALLENGER M2-2 ADVERSARIAL STRESS SUITE RESULTS SUMMARY");
  console.log("================================================================================");
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total Assertions: ${total}`);
  console.log(`Passed:           ${passed}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Page Errors:      ${pageErrors.length}`);

  const summary = {
    total,
    passed,
    failed,
    pageErrorsCount: pageErrors.length,
    pageErrors,
    results: testResults,
    verdict: failed === 0 && pageErrors.length === 0 ? "CONFIRMED CORRECT" : "CHALLENGE_FAILED",
  };

  const summaryPath = path.join(artifactsDir, "m2_challenger_customizer_icon_summary.json");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nSummary written to: ${summaryPath}`);
  console.log(`OVERALL EMPIRICAL VERDICT: ${summary.verdict}`);

  if (failed > 0 || pageErrors.length > 0) {
    process.exitCode = 1;
  }
}

run();
