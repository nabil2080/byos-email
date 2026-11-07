import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runAdversarialChallenge() {
  console.log("================================================================================");
  console.log("  CHALLENGER 1: EMPIRICAL ADVERSARIAL VERIFICATION — MILESTONE 1");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const failureLog = [];

  try {
    const page = await browser.newPage();

    // Start with desktop viewport for initial auth
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await sleep(1500);

    const hasEmailInput = await page.$('input[type="email"]');
    if (hasEmailInput) {
      console.log("[Auth] Authenticating as alice@byos.local...");
      await page.type('input[type="email"]', 'alice@byos.local');
      await page.type('input[type="password"]', 'test-password-123');
      await page.click('button[type="submit"]');
      await sleep(2500);
    }

    const testCases = [
      {
        name: "iphone5_320x568",
        width: 320,
        height: 568,
        isMobile: true,
        hasTouch: true,
        artifact: "tests/browser/artifacts/m1_challenger_320x568.png",
        description: "iPhone 5/SE1 Extreme Small Viewport",
      },
      {
        name: "android_360x740",
        width: 360,
        height: 740,
        isMobile: true,
        hasTouch: true,
        artifact: "tests/browser/artifacts/m1_challenger_360x740.png",
        description: "Android Standard Viewport (Galaxy S8/S9/mid-tier)",
      },
      {
        name: "ipad_pro_1024x1366",
        width: 1024,
        height: 1366,
        isMobile: true,
        hasTouch: true,
        artifact: "tests/browser/artifacts/m1_challenger_1024x1366.png",
        description: "iPad Pro Portrait Large Aspect Ratio",
      },
      {
        name: "desktop_qhd_2560x1440",
        width: 2560,
        height: 1440,
        isMobile: false,
        hasTouch: false,
        artifact: "tests/browser/artifacts/m1_challenger_2560x1440.png",
        description: "QHD 1440p High-Resolution Ultrawide Desktop",
      },
      {
        name: "mobile_landscape_667x375",
        width: 667,
        height: 375,
        isMobile: true,
        hasTouch: true,
        artifact: "tests/browser/artifacts/m1_challenger_667x375_landscape.png",
        description: "Mobile Landscape Orientation Switch (Extreme Height Constraint)",
      },
    ];

    for (const tc of testCases) {
      console.log(`\n--------------------------------------------------------------------------------`);
      console.log(`[TEST SUITE] Viewport: ${tc.name} (${tc.width}x${tc.height}) — ${tc.description}`);
      console.log(`--------------------------------------------------------------------------------`);

      await page.setViewport({
        width: tc.width,
        height: tc.height,
        isMobile: tc.isMobile,
        hasTouch: tc.hasTouch,
      });
      await sleep(1000);

      const modules = ['mail', 'calendar', 'notes'];

      for (const mod of modules) {
        // Module switch
        await page.evaluate((m) => {
          if (m === 'mail') {
            const el = document.querySelector('[data-testid="nav-emails-tab"]') ||
                       document.querySelector('[data-testid="bottom-nav-mail-tab"]');
            if (el) el.click();
          } else if (m === 'calendar') {
            const el = document.querySelector('[data-testid="nav-calendar-tab"]') ||
                       document.querySelector('[data-testid="bottom-nav-calendar-tab"]');
            if (el) el.click();
          } else if (m === 'notes') {
            const el = document.querySelector('[data-testid="nav-notes-tab"]') ||
                       document.querySelector('[data-testid="bottom-nav-notes-tab"]');
            if (el) el.click();
          }
        }, mod);
        await sleep(1000);

        // ATTACK 1: Programmatic Scroll Injection on window, docEl, body
        const progResult = await page.evaluate(() => {
          window.scrollTo(0, 1000);
          window.scrollBy(0, 500);
          document.documentElement.scrollTop = 1000;
          document.body.scrollTop = 1000;

          const docEl = document.documentElement;
          const body = document.body;
          const root = document.getElementById('root');

          return {
            windowScrollY: window.scrollY,
            windowScrollX: window.scrollX,
            docScrollTop: docEl.scrollTop,
            bodyScrollTop: body.scrollTop,
            docScrollHeight: docEl.scrollHeight,
            docClientHeight: docEl.clientHeight,
            bodyScrollHeight: body.scrollHeight,
            bodyClientHeight: body.clientHeight,
            rootScrollHeight: root ? root.scrollHeight : null,
            rootClientHeight: root ? root.clientHeight : null,
          };
        });

        // ATTACK 2: Synthetic Wheel Scroll Injection on outer viewport margin
        try {
          await page.mouse.move(5, 5);
          await page.mouse.wheel({ deltaY: 800 });
          await sleep(200);
        } catch (e) {
          // Touch device ignores mouse wheel
        }

        // ATTACK 3: Synthetic Touch Swipe Injection (if touch enabled)
        if (tc.hasTouch) {
          try {
            await page.touchscreen.touchStart(10, Math.floor(tc.height * 0.7));
            await page.touchscreen.touchMove(10, Math.floor(tc.height * 0.2));
            await page.touchscreen.touchEnd();
            await sleep(300);
          } catch (e) {
            console.warn(`Touch injection warning on ${tc.name}:`, e.message);
          }
        }

        // Final measurements after all attacks
        const postAttackResult = await page.evaluate(() => {
          const docEl = document.documentElement;
          const body = document.body;
          const root = document.getElementById('root');

          return {
            windowScrollY: window.scrollY,
            windowScrollX: window.scrollX,
            docScrollTop: docEl.scrollTop,
            bodyScrollTop: body.scrollTop,
            docScrollHeight: docEl.scrollHeight,
            docClientHeight: docEl.clientHeight,
            bodyScrollHeight: body.scrollHeight,
            bodyClientHeight: body.clientHeight,
            rootScrollHeight: root ? root.scrollHeight : null,
            rootClientHeight: root ? root.clientHeight : null,
            docOverflow: docEl.scrollHeight > docEl.clientHeight,
            bodyOverflow: body.scrollHeight > body.clientHeight,
            hasScrolled: window.scrollY > 0 || docEl.scrollTop > 0 || body.scrollTop > 0,
          };
        });

        console.log(`  Module [${mod.toUpperCase()}]:`);
        console.log(`    Doc: scrollHeight=${postAttackResult.docScrollHeight}px, clientHeight=${postAttackResult.docClientHeight}px (Overflow: ${postAttackResult.docOverflow})`);
        console.log(`    Body: scrollHeight=${postAttackResult.bodyScrollHeight}px, clientHeight=${postAttackResult.bodyClientHeight}px (Overflow: ${postAttackResult.bodyOverflow})`);
        console.log(`    Root: scrollHeight=${postAttackResult.rootScrollHeight}px, clientHeight=${postAttackResult.rootClientHeight}px`);
        console.log(`    Scroll Offsets: window.scrollY=${postAttackResult.windowScrollY}px, doc.scrollTop=${postAttackResult.docScrollTop}px, body.scrollTop=${postAttackResult.bodyScrollTop}px`);

        const isContained = !postAttackResult.docOverflow &&
                            !postAttackResult.bodyOverflow &&
                            !postAttackResult.hasScrolled;

        console.log(`    Adversarial Scroll Containment Status: ${isContained ? "CONTAINED (0px outer scroll)" : "LEAK DETECTED"}`);

        if (!isContained) {
          failureLog.push({
            viewport: tc.name,
            module: mod,
            details: postAttackResult,
          });
        }
      }

      // Capture screenshot after testing all modules for this viewport
      await page.screenshot({ path: tc.artifact, fullPage: false });
      console.log(`[Artifact] Screenshot captured: ${tc.artifact}`);
    }

    // Comprehensive Internal Scrollability Test across Extreme Layouts
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[STRESS HARNESS] Internal Independent Scrollability under Edge Viewports`);
    console.log(`--------------------------------------------------------------------------------`);

    // 1. Mobile SE (320x568) Mail List Internal Scroll
    await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="bottom-nav-mail-tab"]') ||
                 document.querySelector('[data-testid="nav-emails-tab"]');
      if (el) el.click();
    });
    await sleep(800);

    const mailSmallScroll = await page.evaluate(() => {
      // Find visible scrollable container in mail list
      const candidates = Array.from(document.querySelectorAll('.overflow-y-auto'));
      const listEl = candidates.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.height > 50 && el.scrollHeight > el.clientHeight;
      });

      if (!listEl) return { found: false };
      const before = listEl.scrollTop;
      listEl.scrollTop = before + 150;
      const after = listEl.scrollTop;
      return {
        found: true,
        scrollHeight: listEl.scrollHeight,
        clientHeight: listEl.clientHeight,
        scrolled: after > before,
        delta: after - before,
        outerDocScrollY: window.scrollY,
      };
    });
    console.log("  320x568 Mail List Internal Scroll:", mailSmallScroll);
    if (!mailSmallScroll.found || !mailSmallScroll.scrolled || mailSmallScroll.outerDocScrollY !== 0) {
      failureLog.push({ test: "320x568 Mail List Internal Scroll", details: mailSmallScroll });
    }

    // 2. Landscape (667x375) Calendar Internal Scroll
    await page.setViewport({ width: 667, height: 375, isMobile: true, hasTouch: true });
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="bottom-nav-calendar-tab"]') ||
                 document.querySelector('[data-testid="nav-calendar-tab"]');
      if (el) el.click();
    });
    await sleep(800);

    const calLandscapeScroll = await page.evaluate(() => {
      // Find visible calendar scroll container (agenda view or grid)
      const candidates = Array.from(document.querySelectorAll('[data-testid="calendar-agenda-view"], [data-testid="calendar-view"] .overflow-y-auto, .overflow-y-auto'));
      const visibleGrid = candidates.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.height > 50 && el.scrollHeight > el.clientHeight;
      });

      if (!visibleGrid) return { found: false };
      const before = visibleGrid.scrollTop;
      visibleGrid.scrollTop = before > 0 ? before - 200 : before + 200;
      const after = visibleGrid.scrollTop;
      return {
        found: true,
        scrollHeight: visibleGrid.scrollHeight,
        clientHeight: visibleGrid.clientHeight,
        scrolled: after !== before,
        before,
        after,
        outerDocScrollY: window.scrollY,
      };
    });
    console.log("  667x375 Landscape Calendar Internal Scroll:", calLandscapeScroll);
    if (!calLandscapeScroll.found || !calLandscapeScroll.scrolled || calLandscapeScroll.outerDocScrollY !== 0) {
      failureLog.push({ test: "667x375 Landscape Calendar Internal Scroll", details: calLandscapeScroll });
    }

    // 3. Landscape (667x375) Notes View Internal Scroll
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="bottom-nav-notes-tab"]') ||
                 document.querySelector('[data-testid="nav-notes-tab"]');
      if (el) el.click();
    });
    await sleep(800);

    const notesLandscapeScroll = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('[data-testid="notes-view"] .overflow-y-auto, .overflow-y-auto'));
      const visibleNotes = candidates.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.height > 50;
      });

      if (!visibleNotes) return { found: false };
      const computed = window.getComputedStyle(visibleNotes);
      return {
        found: true,
        scrollHeight: visibleNotes.scrollHeight,
        clientHeight: visibleNotes.clientHeight,
        overflowY: computed.overflowY,
        minHeight: computed.minHeight,
        outerDocScrollY: window.scrollY,
      };
    });
    console.log("  667x375 Landscape Notes Scroll Containment:", notesLandscapeScroll);
    if (!notesLandscapeScroll.found || notesLandscapeScroll.outerDocScrollY !== 0) {
      failureLog.push({ test: "667x375 Landscape Notes Scroll Containment", details: notesLandscapeScroll });
    }

    // 4. Tablet Portrait (1024x1366) Calendar Day/Week Grid Scroll
    await page.setViewport({ width: 1024, height: 1366, isMobile: true, hasTouch: true });
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="nav-calendar-tab"]') ||
                 document.querySelector('[data-testid="bottom-nav-calendar-tab"]');
      if (el) el.click();
    });
    await sleep(800);

    const calTabletScroll = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('.overflow-y-auto'));
      const visibleGrid = candidates.find(el => {
        const rect = el.getBoundingClientRect();
        return rect.height > 200 && el.scrollHeight > el.clientHeight;
      });

      if (!visibleGrid) return { found: false };
      const before = visibleGrid.scrollTop;
      visibleGrid.scrollTop = before + 300;
      const after = visibleGrid.scrollTop;
      return {
        found: true,
        scrollHeight: visibleGrid.scrollHeight,
        clientHeight: visibleGrid.clientHeight,
        scrolled: after > before,
        before,
        after,
        outerDocScrollY: window.scrollY,
      };
    });
    console.log("  1024x1366 Tablet Calendar Internal Scroll:", calTabletScroll);
    if (!calTabletScroll.found || !calTabletScroll.scrolled || calTabletScroll.outerDocScrollY !== 0) {
      failureLog.push({ test: "1024x1366 Tablet Calendar Internal Scroll", details: calTabletScroll });
    }

    console.log(`\n================================================================================`);
    if (failureLog.length === 0) {
      console.log("  VERDICT: CONFIRMED CORRECT — ALL ADVERSARIAL CHALLENGES DEFEATED");
      console.log("  Zero outer document scroll leaks detected across all edge viewports.");
      console.log("================================================================================");
    } else {
      console.error("  VERDICT: CHALLENGE_FAILED — Failures detected:");
      console.error(JSON.stringify(failureLog, null, 2));
      console.log("================================================================================");
      process.exit(1);
    }

  } catch (err) {
    console.error("Adversarial execution error:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runAdversarialChallenge();
