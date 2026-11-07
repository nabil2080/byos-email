/**
 * ============================================================================
 * CHALLENGER M2: ADVERSARIAL MODULE SWITCHING & MORPHING PILL STRESS HARNESS
 * ============================================================================
 * 
 * Target: Milestone 2 (Module Switcher Morphing & Page-Turn Removal — R4)
 * 
 * Adversarial Verifications:
 * 1. 3D Book Page-turn removal check (no .page-turn-viewport, no rotateY keyframes)
 * 2. Morphing pill static coordinates (translateX 0%, 100%, 200%) & physical alignment
 * 3. 45-step rapid back-and-forth module jump burst with variable jitter
 * 4. Microtask/synchronous click flood race condition stress
 * 5. Single-mounting DOM invariance (zero duplicate module trees, exactly 1 active)
 * 6. Zero document scroll leakage (window.scrollY === 0 at all times)
 * 7. Customizer panel open-state collision during module switch
 * 8. Mobile viewport bottom-bar rapid switching stress (375x667)
 * 9. Running animation / residual timer audit
 * 10. Deep internal scroll switch containment
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

function recordResult(category, testName, passed, details = "") {
  const result = { category, testName, passed, details, timestamp: new Date().toISOString() };
  testResults.push(result);
  const statusStr = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${statusStr} [${category}] ${testName}`);
  if (details) {
    console.log(`         Details: ${typeof details === "object" ? JSON.stringify(details) : details}`);
  }
}

async function auditScrollContainment(page, contextLabel) {
  return await page.evaluate((label) => {
    const winScrollY = window.scrollY;
    const winScrollX = window.scrollX;
    const docScrollTop = document.documentElement.scrollTop;
    const bodyScrollTop = document.body.scrollTop;
    const docScrollHeight = document.documentElement.scrollHeight;
    const docClientHeight = document.documentElement.clientHeight;
    const bodyScrollHeight = document.body.scrollHeight;
    const bodyClientHeight = document.body.clientHeight;

    // Tolerance of 2px for sub-pixel zoom/scaling
    const isLeaking =
      winScrollY > 0 ||
      winScrollX > 0 ||
      docScrollTop > 0 ||
      bodyScrollTop > 0 ||
      docScrollHeight > docClientHeight + 2 ||
      bodyScrollHeight > bodyClientHeight + 2;

    return {
      label,
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
  }, contextLabel);
}

async function auditMountedModules(page) {
  return await page.evaluate(() => {
    const main = document.querySelector('main[data-testid="main-content"]');
    if (!main) return { foundMain: false, mainCount: 0, mountedModules: [] };

    const mainCount = document.querySelectorAll('main[data-testid="main-content"]').length;
    
    // Check specific module view containers
    const hasCalendar = !!main.querySelector('[data-testid="calendar-view"]') || !!main.querySelector('.fc') || !!document.querySelector('[data-testid="calendar-view"]');
    const hasNotes = !!main.querySelector('[data-testid="notes-view"]') || !!document.querySelector('[data-testid="notes-view"]');
    const hasMailList = !!main.querySelector('[data-testid="message-list"]') || !!document.querySelector('[data-testid="message-list"]');
    
    // Check direct children inside main
    const childDivs = Array.from(main.children);
    
    return {
      foundMain: true,
      mainCount,
      hasCalendar,
      hasNotes,
      hasMailList,
      childDivCount: childDivs.length,
      hasPageTurnClass: main.classList.contains("page-turn-viewport"),
    };
  });
}

async function auditPillPosition(page) {
  return await page.evaluate(() => {
    const switcher = document.querySelector('[data-testid="top-bar-module-switcher"]');
    const pill = document.querySelector('[data-testid="right-bar-morphing-pill"]');
    const mailBtn = document.querySelector('[data-testid="nav-emails-tab"]');
    const calBtn = document.querySelector('[data-testid="nav-calendar-tab"]');
    const notesBtn = document.querySelector('[data-testid="nav-notes-tab"]');

    if (!switcher || !pill || !mailBtn || !calBtn || !notesBtn) {
      return { found: false };
    }

    const switcherRect = switcher.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const mailRect = mailBtn.getBoundingClientRect();
    const calRect = calBtn.getBoundingClientRect();
    const notesRect = notesBtn.getBoundingClientRect();

    const pillStyle = window.getComputedStyle(pill);

    return {
      found: true,
      transformStyle: pill.style.transform,
      computedTransform: pillStyle.transform,
      transition: pillStyle.transition,
      pillRect: { left: pillRect.left, top: pillRect.top, width: pillRect.width, height: pillRect.height },
      mailRect: { left: mailRect.left, width: mailRect.width },
      calRect: { left: calRect.left, width: calRect.width },
      notesRect: { left: notesRect.left, width: notesRect.width },
      deltaToMail: Math.abs(pillRect.left - mailRect.left),
      deltaToCal: Math.abs(pillRect.left - calRect.left),
      deltaToNotes: Math.abs(pillRect.left - notesRect.left),
    };
  });
}

async function run() {
  console.log("================================================================================");
  console.log("  CHALLENGER M2: ADVERSARIAL MODULE SWITCHING & MORPHING PILL STRESS SUITE     ");
  console.log("================================================================================\n");

  const pageErrors = [];
  const consoleWarnings = [];

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

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleWarnings.push(msg.text());
    }
  });

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Authentication & Clean Setup
    // -------------------------------------------------------------------------
    console.log("--- [PHASE 1] Initial Authentication & Session Setup ---");
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
    await page.waitForSelector('[data-testid="top-bar-module-switcher"]', { timeout: 10000 });
    await sleep(1000);
    console.log("  Authenticated successfully.\n");

    // -------------------------------------------------------------------------
    // Phase 2: Structural Verification (Book Page-Turn Removal)
    // -------------------------------------------------------------------------
    console.log("--- [PHASE 2] Book Page-Turn Structural Removal Audit ---");
    const structuralAudit = await page.evaluate(() => {
      const main = document.querySelector('main[data-testid="main-content"]');
      const hasPageTurnClass = main ? main.classList.contains("page-turn-viewport") : false;

      // Scan all stylesheets for rotateY or page-turn rules
      const remainingRules = [];
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules || [])) {
            if (rule.name && (rule.name.includes("pageTurn") || rule.name.includes("page-turn"))) {
              remainingRules.push(rule.name);
            }
            if (rule.cssText && rule.cssText.includes("rotateY") && rule.cssText.includes("perspective")) {
              remainingRules.push(rule.cssText.slice(0, 60));
            }
          }
        } catch (e) {
          // cross-origin stylesheets ignore
        }
      }

      return {
        hasPageTurnClass,
        remainingRules,
      };
    });

    recordResult(
      "Structural",
      "Page-turn classes and keyframe elimination",
      !structuralAudit.hasPageTurnClass && structuralAudit.remainingRules.length === 0,
      `hasPageTurnClass=${structuralAudit.hasPageTurnClass}, remainingRules=${JSON.stringify(structuralAudit.remainingRules)}`
    );

    // -------------------------------------------------------------------------
    // Phase 3: Morphing Pill Coordinates & Alignment Precision (Mail -> Cal -> Notes -> Mail)
    // -------------------------------------------------------------------------
    console.log("\n--- [PHASE 3] Morphing Pill Static Alignment & Coordinates ---");
    
    // Step 3.1: Mail active
    const pillMail = await auditPillPosition(page);
    const mailScroll = await auditScrollContainment(page, "Mail Initial");
    recordResult(
      "MorphingPill",
      "Pill position in Mail mode (translateX 0% & delta < 2px)",
      pillMail.found && pillMail.transformStyle === "translateX(0%)" && pillMail.deltaToMail <= 2 && !mailScroll.isLeaking,
      `transformStyle=${pillMail.transformStyle}, deltaToMail=${pillMail.deltaToMail.toFixed(2)}px, scrollLeaking=${mailScroll.isLeaking}`
    );

    // Step 3.2: Switch to Calendar
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(350); // allow 250ms transition to complete
    const pillCal = await auditPillPosition(page);
    const calScroll = await auditScrollContainment(page, "Calendar Active");
    const calModules = await auditMountedModules(page);
    recordResult(
      "MorphingPill",
      "Pill position in Calendar mode (translateX 100% & delta < 2px)",
      pillCal.found && pillCal.transformStyle === "translateX(100%)" && pillCal.deltaToCal <= 2 && !calScroll.isLeaking,
      `transformStyle=${pillCal.transformStyle}, deltaToCal=${pillCal.deltaToCal.toFixed(2)}px, hasCal=${calModules.hasCalendar}, hasMail=${calModules.hasMailList}`
    );

    // Step 3.3: Switch to Notes
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(350);
    const pillNotes = await auditPillPosition(page);
    const notesScroll = await auditScrollContainment(page, "Notes Active");
    const notesModules = await auditMountedModules(page);
    recordResult(
      "MorphingPill",
      "Pill position in Notes mode (translateX 200% & delta < 2px)",
      pillNotes.found && pillNotes.transformStyle === "translateX(200%)" && pillNotes.deltaToNotes <= 2 && !notesScroll.isLeaking,
      `transformStyle=${pillNotes.transformStyle}, deltaToNotes=${pillNotes.deltaToNotes.toFixed(2)}px, hasNotes=${notesModules.hasNotes}`
    );

    // Step 3.4: Switch back to Mail
    await page.click('[data-testid="nav-emails-tab"]');
    await sleep(350);
    const pillMailReturn = await auditPillPosition(page);
    recordResult(
      "MorphingPill",
      "Pill return to Mail mode (translateX 0% & delta < 2px)",
      pillMailReturn.found && pillMailReturn.transformStyle === "translateX(0%)" && pillMailReturn.deltaToMail <= 2,
      `transformStyle=${pillMailReturn.transformStyle}, deltaToMail=${pillMailReturn.deltaToMail.toFixed(2)}px`
    );

    await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_pill_alignment_verified.png") });

    // -------------------------------------------------------------------------
    // Phase 4: 45-Jump Adversarial Rapid Switching Burst
    // -------------------------------------------------------------------------
    console.log("\n--- [PHASE 4] 45-Jump Rapid Module Switching Stress Burst ---");
    
    const jumpSequence = [
      "calendar", "notes", "mail", "notes", "calendar", "mail",
      "calendar", "mail", "calendar", "notes", "mail", "notes",
      "calendar", "notes", "mail", "calendar", "notes", "mail",
      "notes", "calendar", "notes", "mail", "calendar", "mail",
      "calendar", "notes", "mail", "notes", "calendar", "mail",
      "calendar", "mail", "calendar", "notes", "mail", "notes",
      "calendar", "notes", "mail", "calendar", "notes", "mail",
      "calendar", "notes", "mail"
    ]; // 45 jumps

    let scrollBreaches = 0;
    let duplicateMountErrors = 0;
    const errorsBeforeBurst = pageErrors.length;

    console.log(`  Executing ${jumpSequence.length} rapid module hops with dynamic jitter (0-80ms)...`);

    for (let i = 0; i < jumpSequence.length; i++) {
      const target = jumpSequence[i];
      const selector = target === "mail"
        ? '[data-testid="nav-emails-tab"]'
        : target === "calendar"
        ? '[data-testid="nav-calendar-tab"]'
        : '[data-testid="nav-notes-tab"]';

      // Perform click
      await page.click(selector);

      // Micro delay jitter: cycle through 0ms, 20ms, 40ms, 80ms
      const jitter = (i % 4) * 20;
      if (jitter > 0) {
        await sleep(jitter);
      }

      // Assert scroll containment on every 5th hop during the flight
      if (i % 5 === 0) {
        const scrollCheck = await auditScrollContainment(page, `Hop #${i} -> ${target}`);
        if (scrollCheck.isLeaking) {
          scrollBreaches++;
          console.error(`    [SCROLL LEAK DETECTED at hop ${i}]:`, scrollCheck);
        }

        const domCheck = await auditMountedModules(page);
        if (domCheck.mainCount !== 1) {
          duplicateMountErrors++;
          console.error(`    [DUPLICATE MAIN DETECTED at hop ${i}]: mainCount=${domCheck.mainCount}`);
        }
      }
    }

    // Allow UI to settle
    await sleep(400);

    const errorsAfterBurst = pageErrors.length;
    const finalPillState = await auditPillPosition(page);
    const finalDomState = await auditMountedModules(page);
    const finalScrollState = await auditScrollContainment(page, "Final Burst State");

    recordResult(
      "RapidStress",
      "45-Hop Module Switch Burst Zero-Error & Zero-Scroll",
      errorsAfterBurst === errorsBeforeBurst && scrollBreaches === 0 && duplicateMountErrors === 0 && !finalScrollState.isLeaking,
      `jumpsExecuted=${jumpSequence.length}, newErrors=${errorsAfterBurst - errorsBeforeBurst}, scrollBreaches=${scrollBreaches}, duplicateMainErrors=${duplicateMountErrors}`
    );

    recordResult(
      "RapidStress",
      "Final Pill Alignment after 45 Jumps (Settled at Mail)",
      finalPillState.transformStyle === "translateX(0%)" && finalPillState.deltaToMail <= 2,
      `transformStyle=${finalPillState.transformStyle}, deltaToMail=${finalPillState.deltaToMail.toFixed(2)}px`
    );

    recordResult(
      "RapidStress",
      "DOM Cleanliness after 45 Jumps (Only Mail active)",
      finalDomState.mainCount === 1 && finalDomState.hasMailList && !finalDomState.hasCalendar && !finalDomState.hasNotes,
      `mainCount=${finalDomState.mainCount}, hasMail=${finalDomState.hasMailList}, hasCal=${finalDomState.hasCalendar}, hasNotes=${finalDomState.hasNotes}`
    );

    await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_post_45_jumps.png") });

    // -------------------------------------------------------------------------
    // Phase 5: Microtask Flood / Synchronous Concurrent Clicks
    // -------------------------------------------------------------------------
    console.log("\n--- [PHASE 5] Microtask Flood & Synchronous Click Storm ---");
    const errorsBeforeFlood = pageErrors.length;

    // Dispatch 30 synchronous clicks in single browser task
    const floodResult = await page.evaluate(() => {
      const mail = document.querySelector('[data-testid="nav-emails-tab"]');
      const cal = document.querySelector('[data-testid="nav-calendar-tab"]');
      const notes = document.querySelector('[data-testid="nav-notes-tab"]');
      if (!mail || !cal || !notes) return { error: "Tabs not found" };

      for (let k = 0; k < 10; k++) {
        cal.click();
        notes.click();
        mail.click();
      }
      // Finish on Calendar
      cal.click();

      return {
        finishedClicking: true,
        pillTransformImmediate: document.querySelector('[data-testid="right-bar-morphing-pill"]')?.style?.transform,
      };
    });

    await sleep(350); // wait for CSS transition

    const errorsAfterFlood = pageErrors.length;
    const postFloodPill = await auditPillPosition(page);
    const postFloodDom = await auditMountedModules(page);
    const postFloodScroll = await auditScrollContainment(page, "Post Click Flood");

    recordResult(
      "ConcurrentStress",
      "Synchronous Click Flood Handled Without Exception",
      errorsAfterFlood === errorsBeforeFlood && !floodResult.error,
      `newErrors=${errorsAfterFlood - errorsBeforeFlood}, pillTransformImmediate=${floodResult.pillTransformImmediate}`
    );

    recordResult(
      "ConcurrentStress",
      "Post-Flood Settle on Calendar (translateX 100% & Single DOM Mount)",
      postFloodPill.transformStyle === "translateX(100%)" && postFloodDom.hasCalendar && !postFloodDom.hasMailList && !postFloodScroll.isLeaking,
      `transformStyle=${postFloodPill.transformStyle}, hasCalendar=${postFloodDom.hasCalendar}, hasMailList=${postFloodDom.hasMailList}, isLeaking=${postFloodScroll.isLeaking}`
    );

    // -------------------------------------------------------------------------
    // Phase 6: Customizer Panel Open State Collision During Module Switch
    // -------------------------------------------------------------------------
    console.log("\n--- [PHASE 6] Customizer Panel Open State Collision Stress ---");
    // Switch to mail
    await page.click('[data-testid="nav-emails-tab"]');
    await sleep(300);

    // Open customizer
    const customizerBtn = await page.$('[data-testid="top-bar-appearance-btn"]');
    if (customizerBtn) {
      await customizerBtn.click();
      await sleep(300);

      // Verify customizer panel is mounted
      const panelOpenBeforeSwitch = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="quick-settings-panel"]');
        const btn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        return {
          panelMounted: !!panel,
          btnExpanded: btn?.getAttribute("aria-expanded") === "true",
        };
      });

      // Immediately switch to Calendar while customizer is open
      await page.click('[data-testid="nav-calendar-tab"]');
      await sleep(350);

      // Check if customizer cleanly closed without unhandled errors
      const calCustomizerState = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="quick-settings-panel"]');
        const appearanceBtn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        return {
          panelMounted: !!panel,
          appearanceBtnMounted: !!appearanceBtn,
        };
      });

      // Switch back to Mail
      await page.click('[data-testid="nav-emails-tab"]');
      await sleep(350);

      // Check if appearance button is restored and in closed state
      const mailRestoredState = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="quick-settings-panel"]');
        const appearanceBtn = document.querySelector('[data-testid="top-bar-appearance-btn"]');
        return {
          panelMounted: !!panel,
          appearanceBtnMounted: !!appearanceBtn,
          isExpanded: appearanceBtn?.getAttribute("aria-expanded") === "true",
        };
      });

      recordResult(
        "PanelCollision",
        "Customizer Panel Auto-Closes on Module Switch to Calendar",
        panelOpenBeforeSwitch.panelMounted && !calCustomizerState.panelMounted,
        `panelOpenBefore=${panelOpenBeforeSwitch.panelMounted}, calPanelMounted=${calCustomizerState.panelMounted}`
      );

      recordResult(
        "PanelCollision",
        "Appearance Button Restores Clean Closed State on Return to Mail",
        mailRestoredState.appearanceBtnMounted && !mailRestoredState.isExpanded && !mailRestoredState.panelMounted,
        `appearanceBtnMounted=${mailRestoredState.appearanceBtnMounted}, isExpanded=${mailRestoredState.isExpanded}, panelMounted=${mailRestoredState.panelMounted}`
      );
    } else {
      recordResult("PanelCollision", "Customizer Button Found", false, "Appearance button missing");
    }

    // -------------------------------------------------------------------------
    // Phase 7: Mobile Viewport Bottom Bar Rapid Switch Stress (375x667)
    // -------------------------------------------------------------------------
    console.log("\n--- [PHASE 7] Mobile Viewport Bottom Bar Rapid Switch Stress (375x667) ---");
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await sleep(400);

    const mobileJumpSequence = [
      "calendar", "notes", "mail", "calendar", "notes", "mail",
      "notes", "calendar", "mail", "calendar", "mail", "notes",
      "calendar", "notes", "mail", "calendar", "notes", "mail",
      "calendar", "notes", "mail"
    ]; // 21 mobile jumps

    let mobileScrollBreaches = 0;
    const mobileErrorsBefore = pageErrors.length;

    for (let m = 0; m < mobileJumpSequence.length; m++) {
      const target = mobileJumpSequence[m];
      const sel = target === "mail"
        ? '[data-testid="bottom-nav-mail-tab"]'
        : target === "calendar"
        ? '[data-testid="bottom-nav-calendar-tab"]'
        : '[data-testid="bottom-nav-notes-tab"]';

      await page.click(sel);
      await sleep(35);

      if (m % 5 === 0) {
        const mScroll = await auditScrollContainment(page, `Mobile hop ${m} -> ${target}`);
        if (mScroll.isLeaking) {
          mobileScrollBreaches++;
        }
      }
    }

    await sleep(350);
    const mobileErrorsAfter = pageErrors.length;
    const mobileFinalScroll = await auditScrollContainment(page, "Mobile Final Burst State");
    const mobileFinalDom = await auditMountedModules(page);

    recordResult(
      "MobileStress",
      "Mobile Bottom Bar Rapid Module Switching (21 Hops)",
      mobileErrorsAfter === mobileErrorsBefore && mobileScrollBreaches === 0 && !mobileFinalScroll.isLeaking && mobileFinalDom.mainCount === 1,
      `hops=${mobileJumpSequence.length}, newErrors=${mobileErrorsAfter - mobileErrorsBefore}, scrollBreaches=${mobileScrollBreaches}`
    );

    await page.screenshot({ path: path.join(artifactsDir, "m2_challenger_mobile_module_switch.png") });

    // Restore desktop viewport
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(300);

    // -------------------------------------------------------------------------
    // Phase 8: Orphan Timer & Animation Leakage Audit
    // -------------------------------------------------------------------------
    console.log("\n--- [PHASE 8] Orphan Timer & Running Animation Leakage Audit ---");
    const animationLeakAudit = await page.evaluate(() => {
      const animations = document.getAnimations ? document.getAnimations() : [];
      const runningAnimations = animations.filter((a) => a.playState === "running");
      
      // Check if any element has stuck CSS transitions or infinite loops
      const runningPills = Array.from(document.querySelectorAll('[data-testid="right-bar-morphing-pill"]')).map((el) => {
        return {
          styleTransform: el.style.transform,
          computedTransform: window.getComputedStyle(el).transform,
        };
      });

      return {
        totalAnimations: animations.length,
        runningAnimationsCount: runningAnimations.length,
        runningDetails: runningAnimations.map((a) => ({
          targetTag: a.effect?.target?.tagName,
          playState: a.playState,
        })),
        runningPills,
      };
    });

    recordResult(
      "ResourceAudit",
      "Zero Stuck/Runaway Animations After Settling",
      animationLeakAudit.runningAnimationsCount === 0,
      `totalAnimations=${animationLeakAudit.totalAnimations}, runningAnimations=${animationLeakAudit.runningAnimationsCount}`
    );

    // -------------------------------------------------------------------------
    // Phase 9: Deep Internal Scroll Retention During Module Switching
    // -------------------------------------------------------------------------
    console.log("\n--- [PHASE 9] Deep Internal Scroll Containment Across Switches ---");
    // Switch to mail and simulate deep scroll
    await page.click('[data-testid="nav-emails-tab"]');
    await sleep(300);

    await page.evaluate(() => {
      const msgList = document.querySelector('[data-testid="message-list"]');
      if (msgList) {
        msgList.scrollTop = 300;
      }
    });

    const scrollMailDeep = await auditScrollContainment(page, "Mail Internal Scrolled");
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(350);

    const scrollCalAfterDeepMail = await auditScrollContainment(page, "Calendar After Deep Mail");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(350);

    const scrollNotesAfterCal = await auditScrollContainment(page, "Notes After Cal");
    await page.click('[data-testid="nav-emails-tab"]');
    await sleep(350);

    const scrollMailReturn = await auditScrollContainment(page, "Mail Return After Cycle");

    const deepCycleContainment =
      !scrollMailDeep.isLeaking &&
      !scrollCalAfterDeepMail.isLeaking &&
      !scrollNotesAfterCal.isLeaking &&
      !scrollMailReturn.isLeaking;

    recordResult(
      "DeepScrollIsolation",
      "Deep Internal List Scrolling Leaves Outer Document at 0px Across All Module Switches",
      deepCycleContainment,
      `mailDeepLeaking=${scrollMailDeep.isLeaking}, calLeaking=${scrollCalAfterDeepMail.isLeaking}, notesLeaking=${scrollNotesAfterCal.isLeaking}, mailReturnLeaking=${scrollMailReturn.isLeaking}`
    );

  } catch (err) {
    console.error("FATAL EXCEPTION DURING CHALLENGE RUN:", err);
    recordResult("Fatal", "Adversarial Stress Execution", false, err.message);
  } finally {
    await browser.close();
  }

  // ---------------------------------------------------------------------------
  // Summary & Structured Verdict
  // ---------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("  CHALLENGER M2: EMPIRICAL VERDICT SUMMARY                                      ");
  console.log("================================================================================");

  const totalPassed = testResults.filter((r) => r.passed).length;
  const totalFailed = testResults.filter((r) => !r.passed).length;
  const totalTests = testResults.length;

  console.log(`Total Adversarial Checks : ${totalTests}`);
  console.log(`Passed Checks            : ${totalPassed}`);
  console.log(`Failed Checks            : ${totalFailed}`);
  console.log(`Page Errors Encountered  : ${pageErrors.length}`);

  const verdict = totalFailed === 0 && pageErrors.length === 0 ? "CONFIRMED CORRECT" : "CHALLENGE_FAILED";
  console.log(`\nFINAL EMPIRICAL VERDICT   : [ ${verdict} ]\n`);

  const summaryReport = {
    verdict,
    totalTests,
    passed: totalPassed,
    failed: totalFailed,
    pageErrors,
    results: testResults,
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(artifactsDir, "m2_challenger_module_switch_summary.json"),
    JSON.stringify(summaryReport, null, 2)
  );

  return summaryReport;
}

run();
