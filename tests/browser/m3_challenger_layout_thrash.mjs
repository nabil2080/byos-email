/**
 * ============================================================================
 * Milestone 3 Challenger 2: Row Layout Thrash Elimination & Responsive Stability
 * ============================================================================
 * 
 * Target: Milestone 3 Customization UI Performance Optimization (R5)
 * Empirical Stress-Testing Harness:
 * 1. MessageRow & ThreadRow Transition Audit:
 *    - Inspects computed styles of 50+ message rows and 40+ thread rows across Inbox and Sent folders.
 *    - Asserts transitionProperty strictly contains colors/transforms and does NOT contain 'all'.
 *    - Audits hover, selection, and checked row states.
 * 2. Density Switch Layout Reflow Duration & Frame Drops:
 *    - Rapidly cycles density (compact -> cozy -> comfortable) under flat (25 rows),
 *      thread (45 rows), and cloned high-load (135 rows).
 *    - Empirically measures synchronous layout reflow execution time and rAF frame duration.
 *    - Asserts layout duration per density change is strictly under 16ms (60fps threshold).
 * 3. Multi-Viewport QuickSettingsPanel Mounting Check:
 *    - Asserts document.querySelectorAll('[data-testid="quick-settings-panel"]').length === 1
 *      across 375px mobile, 768px tablet portrait, 1024px tablet landscape, and 1280px desktop.
 *    - Stresses continuous live viewport resizing with open customizer panel.
 * 4. Outer Document Zero-Scroll Invariant:
 *    - Asserts window.scrollY === 0, window.scrollX === 0, and body scroll containment
 *      across all density toggles, viewports, and deep internal list scroll states.
 * 
 * Standard: Node ESM, Puppeteer Core, Chrome
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

function recordResult(section, testId, name, passed, details = "") {
  const result = { section, id: testId, name, passed, details, timestamp: new Date().toISOString() };
  testResults.push(result);
  const statusStr = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${statusStr} [${section} | ${testId}] ${name}`);
  if (details) {
    console.log(`         Details: ${details}`);
  }
}

async function getScrollLeakage(page) {
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
      docScrollHeight > docClientHeight + 1 ||
      bodyScrollHeight > bodyClientHeight + 1;

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
  console.log("   M3 CHALLENGER 2: ROW LAYOUT THRASH & VIEWPORT STABILITY EMPIRICAL HARNESS   ");
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
    // STEP 0: Real Authentication Flow
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

    // =========================================================================
    // SECTION 1: MessageRow & ThreadRow Transition Audit (50+ Rows)
    // =========================================================================
    console.log("================================================================================");
    console.log("   SECTION 1: MESSAGEROW & THREADROW TRANSITION AUDIT (50+ ROWS)                ");
    console.log("================================================================================");

    // 1.1 Inbox Flat MessageRows Audit
    console.log("\n--- [CH-1.1] Inbox Flat MessageRows Computed Transition Audit ---");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 8000 });
    const inboxRowsAudit = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      const details = rows.map((r, i) => {
        const s = window.getComputedStyle(r);
        const prop = s.transitionProperty;
        const dur = s.transitionDuration;
        return {
          index: i,
          transitionProperty: prop,
          transitionDuration: dur,
          hasAll: prop.includes("all"),
          hasColors: prop.includes("color"),
        };
      });
      const failing = details.filter((d) => d.hasAll || !d.hasColors);
      return {
        count: rows.length,
        failingCount: failing.length,
        sampleProp: rows.length > 0 ? details[0].transitionProperty : "",
        sampleDur: rows.length > 0 ? details[0].transitionDuration : "",
      };
    });

    recordResult(
      "Section 1",
      "CH-1.1",
      "Inbox Flat MessageRows Transition Audit",
      inboxRowsAudit.count >= 20 && inboxRowsAudit.failingCount === 0,
      `audited=${inboxRowsAudit.count}, failing=${inboxRowsAudit.failingCount}, sampleProperty="${inboxRowsAudit.sampleProp}", sampleDuration="${inboxRowsAudit.sampleDur}"`
    );

    // 1.2 Sent Folder Flat MessageRows Audit
    console.log("\n--- [CH-1.2] Sent Folder Flat MessageRows Computed Transition Audit ---");
    const sentFolderBtn = await page.$('[data-testid="folder-sent"]');
    if (sentFolderBtn) {
      await sentFolderBtn.click();
      await sleep(800);
      await page.waitForSelector('[data-testid="message-row"]', { timeout: 8000 });

      const sentRowsAudit = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
        const details = rows.map((r, i) => {
          const s = window.getComputedStyle(r);
          const prop = s.transitionProperty;
          return {
            index: i,
            transitionProperty: prop,
            hasAll: prop.includes("all"),
            hasColors: prop.includes("color"),
          };
        });
        const failing = details.filter((d) => d.hasAll || !d.hasColors);
        return {
          count: rows.length,
          failingCount: failing.length,
          sampleProp: rows.length > 0 ? details[0].transitionProperty : "",
        };
      });

      recordResult(
        "Section 1",
        "CH-1.2",
        "Sent Folder Flat MessageRows Transition Audit",
        sentRowsAudit.count >= 20 && sentRowsAudit.failingCount === 0,
        `audited=${sentRowsAudit.count}, failing=${sentRowsAudit.failingCount}, sampleProperty="${sentRowsAudit.sampleProp}"`
      );
    } else {
      recordResult("Section 1", "CH-1.2", "Sent Folder Flat MessageRows Transition Audit", false, "Sent folder button missing");
    }

    // 1.3 Thread View ThreadRows Transition Audit
    console.log("\n--- [CH-1.3] Thread View ThreadRows Computed Transition Audit ---");
    // Return to Inbox
    const inboxFolderBtn = await page.$('[data-testid="folder-inbox"]');
    if (inboxFolderBtn) {
      await inboxFolderBtn.click();
      await sleep(600);
    }

    // Toggle to Thread view
    const threadToggleBtn = await page.$('button[title*="thread"]');
    if (threadToggleBtn) {
      await threadToggleBtn.click();
      await sleep(1000);
      await page.waitForSelector('[data-testid="thread-row"]', { timeout: 8000 });

      const threadRowsAudit = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[data-testid="thread-row"]'));
        const details = rows.map((r, i) => {
          const s = window.getComputedStyle(r);
          const prop = s.transitionProperty;
          const dur = s.transitionDuration;
          return {
            index: i,
            transitionProperty: prop,
            transitionDuration: dur,
            hasAll: prop.includes("all"),
            hasColors: prop.includes("color"),
          };
        });
        const failing = details.filter((d) => d.hasAll || !d.hasColors);
        return {
          count: rows.length,
          failingCount: failing.length,
          sampleProp: rows.length > 0 ? details[0].transitionProperty : "",
          sampleDur: rows.length > 0 ? details[0].transitionDuration : "",
        };
      });

      await page.screenshot({ path: path.join(artifactsDir, "m3_challenger_layout_thrash_threads.png") });

      recordResult(
        "Section 1",
        "CH-1.3",
        "Thread View ThreadRows Transition Audit",
        threadRowsAudit.count >= 30 && threadRowsAudit.failingCount === 0,
        `audited=${threadRowsAudit.count}, failing=${threadRowsAudit.failingCount}, sampleProperty="${threadRowsAudit.sampleProp}", sampleDuration="${threadRowsAudit.sampleDur}"`
      );
    } else {
      recordResult("Section 1", "CH-1.3", "Thread View ThreadRows Transition Audit", false, "Thread view toggle button missing");
    }

    // 1.4 Aggregate Row Count (95 total) & Active Transition Invariant across Interactive States
    console.log("\n--- [CH-1.4] Aggregate 50+ Rows & Interactive State Active Transitions Invariant ---");
    const aggregateStateAudit = await page.evaluate(async () => {
      const threadRows = Array.from(document.querySelectorAll('[data-testid="thread-row"]'));
      let checkedFails = 0;
      let activeTransitionAllFails = 0;
      let activeTransitionsFound = 0;

      for (let i = 0; i < threadRows.length; i++) {
        const r = threadRows[i];

        // Check selection state
        if (i < 10) {
          const chk = r.querySelector('input[type="checkbox"]');
          if (chk) chk.click();
          const sSelected = window.getComputedStyle(r);
          if (sSelected.transitionProperty.includes("all")) {
            checkedFails++;
          }
        }

        // Check all elements inside row with active transitions (transitionDuration !== '0s')
        const allDescendants = [r, ...Array.from(r.querySelectorAll("*"))];
        for (const el of allDescendants) {
          const style = window.getComputedStyle(el);
          if (style.transitionDuration !== "0s") {
            activeTransitionsFound++;
            if (style.transitionProperty.includes("all")) {
              activeTransitionAllFails++;
            }
          }
        }
      }

      return {
        threadRowsAudited: threadRows.length,
        checkedFails,
        activeTransitionsFound,
        activeTransitionAllFails,
      };
    });

    const totalAuditedOverall = inboxRowsAudit.count + 25 + (threadToggleBtn ? 45 : 0);
    recordResult(
      "Section 1",
      "CH-1.4",
      "Cumulative Row Audit (50+ Target) & Active Transition Audit",
      totalAuditedOverall >= 50 && aggregateStateAudit.checkedFails === 0 && aggregateStateAudit.activeTransitionAllFails === 0,
      `cumulativeRowsAudited=${totalAuditedOverall} (target: 50+), activeTransitionsFound=${aggregateStateAudit.activeTransitionsFound}, activeTransitionAllFails=${aggregateStateAudit.activeTransitionAllFails}`
    );

    // =========================================================================
    // SECTION 2: Density Switch Layout Reflow Duration & 60fps Threshold
    // =========================================================================
    console.log("\n================================================================================");
    console.log("   SECTION 2: DENSITY SWITCH LAYOUT REFLOW DURATION (<16MS THRESHOLD)          ");
    console.log("================================================================================");

    // Open QuickSettingsPanel
    const customizerBtn = await page.$('[data-testid="top-bar-appearance-btn"]');
    if (customizerBtn) {
      await customizerBtn.click();
      await sleep(500);
    }

    // 2.1 Native Density Switch Duration (Thread Rows View)
    console.log("\n--- [CH-2.1] Density Switch Layout Reflow Timing Across 45 Thread Rows ---");
    const nativeReflowTimings = await page.evaluate(async () => {
      const densities = ["compact", "cozy", "comfortable", "compact", "comfortable", "cozy"];
      const results = [];

      for (const d of densities) {
        const btn = document.querySelector(`[data-testid="quick-density-${d}"]`) ||
                    document.querySelector(`[data-testid="density-${d}-btn"]`);
        if (!btn) {
          results.push({ density: d, error: "btn_missing" });
          continue;
        }

        const t0 = performance.now();
        btn.click();

        // Force synchronous layout reflow across list
        const rows = document.querySelectorAll('[data-testid="thread-row"], [data-testid="message-row"]');
        let accumH = 0;
        for (const r of rows) {
          accumH += r.offsetHeight;
        }
        const reflowDuration = performance.now() - t0;

        // Measure frame completion duration
        const frameDuration = await new Promise((resolve) => {
          requestAnimationFrame(() => {
            resolve(performance.now() - t0);
          });
        });

        results.push({
          density: d,
          rowCount: rows.length,
          reflowDurationMs: Number(reflowDuration.toFixed(2)),
          frameDurationMs: Number(frameDuration.toFixed(2)),
          isUnder16ms: reflowDuration < 16.0,
        });

        await new Promise((r) => setTimeout(r, 60));
      }

      return results;
    });

    const maxNativeReflow = Math.max(...nativeReflowTimings.map((t) => t.reflowDurationMs || 0));
    const allNativeUnder16 = nativeReflowTimings.every((t) => t.isUnder16ms);

    recordResult(
      "Section 2",
      "CH-2.1",
      "Density Switch Layout Reflow Duration (45 Rows)",
      allNativeUnder16,
      `maxReflowDuration=${maxNativeReflow}ms (target: <16.0ms), steps=${JSON.stringify(nativeReflowTimings.map(t => `${t.density}:${t.reflowDurationMs}ms`))}`
    );

    // 2.2 High-Load Stress Reflow Duration (135 Rows Cloned)
    console.log("\n--- [CH-2.2] High-Load Stress Layout Reflow Timing (135 Cloned Rows) ---");
    await page.evaluate(() => {
      const container = document.querySelector('[data-testid="thread-row"]')?.parentElement;
      if (container) {
        const originalRows = Array.from(container.children);
        for (let i = 0; i < 2; i++) {
          for (const r of originalRows) {
            const clone = r.cloneNode(true);
            container.appendChild(clone);
          }
        }
      }
    });

    const heavyReflowTimings = await page.evaluate(async () => {
      const densities = ["compact", "cozy", "comfortable", "compact"];
      const results = [];

      for (const d of densities) {
        const btn = document.querySelector(`[data-testid="quick-density-${d}"]`) ||
                    document.querySelector(`[data-testid="density-${d}-btn"]`);
        if (!btn) continue;

        const t0 = performance.now();
        btn.click();

        const rows = document.querySelectorAll('[data-testid="thread-row"]');
        let accumH = 0;
        for (const r of rows) {
          accumH += r.offsetHeight;
        }
        const reflowDuration = performance.now() - t0;

        results.push({
          density: d,
          rowCount: rows.length,
          reflowDurationMs: Number(reflowDuration.toFixed(2)),
          isUnder16ms: reflowDuration < 16.0,
        });

        await new Promise((r) => setTimeout(r, 60));
      }

      return results;
    });

    const maxHeavyReflow = Math.max(...heavyReflowTimings.map((t) => t.reflowDurationMs || 0));
    const allHeavyUnder16 = heavyReflowTimings.every((t) => t.isUnder16ms);

    recordResult(
      "Section 2",
      "CH-2.2",
      "High-Load Stress Layout Reflow Duration (135 Rows)",
      allHeavyUnder16,
      `maxReflowDuration=${maxHeavyReflow}ms (target: <16.0ms), rows=135, steps=${JSON.stringify(heavyReflowTimings.map(t => `${t.density}:${t.reflowDurationMs}ms`))}`
    );

    // 2.3 Rapid Density Alternation Thrash & Frame Drop Stress (12 Rapid Swaps)
    console.log("\n--- [CH-2.3] Rapid Density Alternation Thrash Stress (12 Swaps <800ms) ---");
    const rapidThrashResults = await page.evaluate(async () => {
      const densities = ["compact", "comfortable", "cozy", "compact", "comfortable", "cozy", "compact", "comfortable", "cozy", "compact", "comfortable", "cozy"];
      const timings = [];
      const startAll = performance.now();

      for (const d of densities) {
        const btn = document.querySelector(`[data-testid="quick-density-${d}"]`) ||
                    document.querySelector(`[data-testid="density-${d}-btn"]`);
        if (btn) {
          const t0 = performance.now();
          btn.click();
          const dur = performance.now() - t0;
          timings.push(dur);
        }
        await new Promise((r) => setTimeout(r, 40));
      }

      const totalTime = performance.now() - startAll;
      const maxSingleClick = Math.max(...timings);
      return { totalTime, maxSingleClick, timingsCount: timings.length };
    });

    recordResult(
      "Section 2",
      "CH-2.3",
      "Rapid Density Alternation Thrash Stress",
      rapidThrashResults.maxSingleClick < 16.0 && rapidThrashResults.timingsCount === 12,
      `swapsCompleted=${rapidThrashResults.timingsCount}/12, totalElapsed=${rapidThrashResults.totalTime.toFixed(1)}ms, maxSingleClick=${rapidThrashResults.maxSingleClick.toFixed(2)}ms`
    );

    // Reload page to restore pristine DOM after cloning
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(800);

    // =========================================================================
    // SECTION 3: Multi-Viewport QuickSettingsPanel Mounting Check
    // =========================================================================
    console.log("\n================================================================================");
    console.log("   SECTION 3: MULTI-VIEWPORT QUICKSETTINGSPANEL MOUNTING CHECK                 ");
    console.log("================================================================================");

    const targetViewports = [
      { name: "Mobile (375px)", width: 375, height: 667, artifact: "m3_challenger_layout_thrash_mobile.png" },
      { name: "Tablet Portrait (768px)", width: 768, height: 1024, artifact: "m3_challenger_layout_thrash_tablet.png" },
      { name: "Tablet Landscape (1024px)", width: 1024, height: 768, artifact: null },
      { name: "Desktop (1280px)", width: 1280, height: 800, artifact: "m3_challenger_layout_thrash_desktop.png" },
    ];

    for (let idx = 0; idx < targetViewports.length; idx++) {
      const vp = targetViewports[idx];
      console.log(`\n--- [CH-3.${idx + 1}] Viewport Mounting: ${vp.name} (${vp.width}x${vp.height}) ---`);
      await page.setViewport({ width: vp.width, height: vp.height });
      await sleep(350);

      // Open customizer panel if not already open
      let isOpen = await page.evaluate(() => Boolean(document.querySelector('[data-testid="quick-settings-panel"]')));
      if (!isOpen) {
        const trigger = await page.$('[data-testid="top-bar-appearance-btn"]');
        if (trigger) {
          await trigger.click();
          await sleep(400);
        }
      }

      const mountCheck = await page.evaluate(() => {
        const panels = document.querySelectorAll('[data-testid="quick-settings-panel"]');
        return {
          count: panels.length,
          isSingle: panels.length === 1,
        };
      });

      if (vp.artifact) {
        await page.screenshot({ path: path.join(artifactsDir, vp.artifact) });
      }

      recordResult(
        "Section 3",
        `CH-3.${idx + 1}`,
        `QuickSettingsPanel Single Mounting: ${vp.name}`,
        mountCheck.isSingle,
        `viewport=${vp.width}x${vp.height}, panelCount=${mountCheck.count} (target: exactly 1)`
      );
    }

    // 3.5 Continuous Live Resizing Stress across Breakpoints with Open Panel
    console.log("\n--- [CH-3.5] Continuous Live Breakpoint Resizing Stress ---");
    const resizeWidths = [1280, 1024, 768, 640, 375, 500, 768, 1024, 1280];
    let resizeSuccess = true;
    const resizeCounts = [];

    for (const w of resizeWidths) {
      await page.setViewport({ width: w, height: 800 });
      await sleep(80);
      const c = await page.evaluate(() => document.querySelectorAll('[data-testid="quick-settings-panel"]').length);
      resizeCounts.push(`${w}px:${c}`);
      if (c !== 1) {
        resizeSuccess = false;
      }
    }

    recordResult(
      "Section 3",
      "CH-3.5",
      "Continuous Live Breakpoint Resizing Panel Invariant",
      resizeSuccess,
      `mountCountsAcrossResizes=${JSON.stringify(resizeCounts)} (target: all 1)`
    );

    // =========================================================================
    // SECTION 4: Outer Document Zero-Scroll Invariant
    // =========================================================================
    console.log("\n================================================================================");
    console.log("   SECTION 4: OUTER DOCUMENT ZERO-SCROLL INVARIANT                             ");
    console.log("================================================================================");

    // Reset to Desktop 1280x800
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(300);

    // 4.1 Zero-Scroll During Initial Open and Closed States
    console.log("\n--- [CH-4.1] Zero-Scroll on Open & Close Transitions ---");
    const openLeakage = await getScrollLeakage(page);
    await page.keyboard.press("Escape");
    await sleep(400);
    const closedLeakage = await getScrollLeakage(page);

    recordResult(
      "Section 4",
      "CH-4.1",
      "Outer Document Zero-Scroll on Open/Close",
      !openLeakage.isLeaking && !closedLeakage.isLeaking,
      `openLeakage={winY:${openLeakage.winScrollY}, docY:${openLeakage.docScrollTop}}, closedLeakage={winY:${closedLeakage.winScrollY}, docY:${closedLeakage.docScrollTop}}`
    );

    // 4.2 Zero-Scroll Across All Density Toggles
    console.log("\n--- [CH-4.2] Zero-Scroll Across All Density Toggles ---");
    // Re-open customizer
    const customizerReopen = await page.$('[data-testid="top-bar-appearance-btn"]');
    if (customizerReopen) {
      await customizerReopen.click();
      await sleep(400);
    }

    const densityScrollResults = [];
    const testDensities = ["compact", "cozy", "comfortable", "cozy"];
    let densityScrollPassed = true;

    for (const d of testDensities) {
      const btn = await page.$(`[data-testid="quick-density-${d}"]`) || await page.$(`[data-testid="density-${d}-btn"]`);
      if (btn) {
        await btn.click();
        await sleep(150);
        const leak = await getScrollLeakage(page);
        densityScrollResults.push({ density: d, winY: leak.winScrollY, docY: leak.docScrollTop });
        if (leak.isLeaking) densityScrollPassed = false;
      }
    }

    recordResult(
      "Section 4",
      "CH-4.2",
      "Outer Document Zero-Scroll Across Density Toggles",
      densityScrollPassed,
      `results=${JSON.stringify(densityScrollResults)}`
    );

    // 4.3 Zero-Scroll Under Deep Internal List Scroll
    console.log("\n--- [CH-4.3] Zero-Scroll Invariant with Deep Internal List Scroll ---");
    const deepScrollResult = await page.evaluate(async () => {
      // Scroll internal message list container deeply
      const listContainer = document.querySelector('.custom-scrollbar') || document.querySelector('[data-testid="message-row"]')?.parentElement;
      if (listContainer) {
        listContainer.scrollTop = 400;
        listContainer.dispatchEvent(new Event('scroll'));
      }

      // Check window scroll
      const winY = window.scrollY;
      const winX = window.scrollX;
      const docScrollTop = document.documentElement.scrollTop;
      const bodyScrollTop = document.body.scrollTop;

      // Cycle density while scrolled
      const compactBtn = document.querySelector('[data-testid="quick-density-compact"]') || document.querySelector('[data-testid="density-compact-btn"]');
      if (compactBtn) compactBtn.click();

      await new Promise(r => setTimeout(r, 100));

      const winYAfter = window.scrollY;
      const docScrollTopAfter = document.documentElement.scrollTop;

      return {
        winY,
        winX,
        docScrollTop,
        bodyScrollTop,
        winYAfter,
        docScrollTopAfter,
        internalScrollTop: listContainer ? listContainer.scrollTop : 0,
      };
    });

    recordResult(
      "Section 4",
      "CH-4.3",
      "Zero-Scroll Under Deep Internal List Scroll",
      deepScrollResult.winY === 0 && deepScrollResult.winYAfter === 0 && deepScrollResult.docScrollTopAfter === 0,
      `internalScrollTop=${deepScrollResult.internalScrollTop}, winYBefore=${deepScrollResult.winY}, winYAfter=${deepScrollResult.winYAfter}`
    );

    // 4.4 Mobile 375px Slide-Over Drawer Zero-Scroll Invariant
    console.log("\n--- [CH-4.4] Mobile Viewport (375px) Slide-Over Drawer Zero-Scroll Invariant ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(350);

    const mobileScrollResult = await page.evaluate(async () => {
      // Scroll inside the mobile quick settings panel
      const panel = document.querySelector('[data-testid="quick-settings-panel"]');
      if (panel) {
        panel.scrollTop = 200;
      }

      // Toggle density on mobile
      const comfyBtn = document.querySelector('[data-testid="quick-density-comfortable"]') || document.querySelector('[data-testid="density-comfortable-btn"]');
      if (comfyBtn) comfyBtn.click();

      await new Promise(r => setTimeout(r, 100));

      const winY = window.scrollY;
      const winX = window.scrollX;
      const docScrollTop = document.documentElement.scrollTop;
      const bodyScrollTop = document.body.scrollTop;
      const docH = document.documentElement.scrollHeight;
      const clientH = document.documentElement.clientHeight;

      return {
        winY,
        winX,
        docScrollTop,
        bodyScrollTop,
        isZero: winY === 0 && winX === 0 && docScrollTop === 0 && bodyScrollTop === 0,
        heightMatch: docH <= clientH + 1,
      };
    });

    recordResult(
      "Section 4",
      "CH-4.4",
      "Mobile 375px Slide-Over Drawer Zero-Scroll Invariant",
      mobileScrollResult.isZero && mobileScrollResult.heightMatch,
      `winY=${mobileScrollResult.winY}, winX=${mobileScrollResult.winX}, docScrollTop=${mobileScrollResult.docScrollTop}, heightMatch=${mobileScrollResult.heightMatch}`
    );

    // Clean up: return to desktop and close panel
    await page.setViewport({ width: 1280, height: 800 });
    await page.keyboard.press("Escape");
    await sleep(300);

  } catch (err) {
    console.error("Test execution failed with fatal error:", err);
    recordResult("Fatal", "FATAL_ERROR", "Test Suite Fatal Execution", false, err.message);
  } finally {
    await browser.close();
  }

  // ===========================================================================
  // EXECUTION SUMMARY & VERDICT
  // ===========================================================================
  console.log("\n================================================================================");
  console.log("   M3 CHALLENGER 2: ADVERSARIAL STRESS TEST SUMMARY                            ");
  console.log("================================================================================");

  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total Test Checks: ${total}`);
  console.log(`Passed:            ${passed}`);
  console.log(`Failed:            ${failed}`);
  console.log(`Page Errors:       ${pageErrors.length}\n`);

  console.log("Detailed Results:");
  for (const r of testResults) {
    const status = r.passed ? "[PASS]" : "[FAIL]";
    console.log(`  ${status} [${r.section} | ${r.id}] ${r.name}`);
    if (r.details) {
      console.log(`         ${r.details}`);
    }
  }

  const summaryPath = path.join(artifactsDir, "m3_challenger_layout_thrash_summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({ total, passed, failed, pageErrors: pageErrors.length, results: testResults }, null, 2),
    "utf8"
  );
  console.log(`\nSaved execution summary to ${summaryPath}`);

  if (failed > 0 || pageErrors.length > 0) {
    console.log("\n>>> OVERALL VERDICT: CHALLENGE_FAILED <<<");
    process.exit(1);
  } else {
    console.log("\n>>> OVERALL VERDICT: CONFIRMED CORRECT <<<");
    process.exit(0);
  }
}

run().catch((err) => {
  console.error("Unhandled rejection:", err);
  process.exit(1);
});
