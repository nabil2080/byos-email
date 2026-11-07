import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runM1Verification() {
  console.log("=============================================================");
  console.log("  MILESTONE 1: VIEWPORT HEIGHT & SCROLL CONTAINMENT AUDIT");
  console.log("=============================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();

    const viewports = [
      { name: "desktop_1280x800", width: 1280, height: 800, artifact: "tests/browser/artifacts/m1_layout_desktop.png" },
      { name: "tablet_768x1024", width: 768, height: 1024, artifact: "tests/browser/artifacts/m1_layout_tablet.png" },
      { name: "mobile_375x667", width: 375, height: 667, isMobile: true, hasTouch: true, artifact: "tests/browser/artifacts/m1_layout_mobile.png" },
    ];

    for (const vp of viewports) {
      console.log(`\n>>> VIEWPORT: ${vp.name} (${vp.width}x${vp.height}) <<<`);
      await page.setViewport(vp);
      await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
      await sleep(1500);

      // Authenticate if login form presented
      const hasEmailInput = await page.$('input[type="email"]');
      if (hasEmailInput) {
        await page.type('input[type="email"]', 'alice@byos.local');
        await page.type('input[type="password"]', 'test-password-123');
        await page.click('button[type="submit"]');
        await sleep(2500);
      }

      // Capture view screenshot
      await page.screenshot({ path: vp.artifact });
      console.log(`Screenshot saved to: ${vp.artifact}`);

      const modules = ['mail', 'calendar', 'notes'];

      for (const mod of modules) {
        // Switch module
        await page.evaluate((m) => {
          if (m === 'mail') {
            const el = document.querySelector('[data-testid="nav-emails-tab"]') || document.querySelector('[data-testid="bottom-nav-mail-tab"]');
            if (el) el.click();
          } else if (m === 'calendar') {
            const el = document.querySelector('[data-testid="nav-calendar-tab"]') || document.querySelector('[data-testid="bottom-nav-calendar-tab"]');
            if (el) el.click();
          } else if (m === 'notes') {
            const el = document.querySelector('[data-testid="nav-notes-tab"]') || document.querySelector('[data-testid="bottom-nav-notes-tab"]');
            if (el) el.click();
          }
        }, mod);
        await sleep(1000);

        // Evaluate outer window scroll containment
        const scrollCheck = await page.evaluate(() => {
          // Attempt programmatic outer scroll
          window.scrollTo(0, 500);
          document.documentElement.scrollTop = 500;
          document.body.scrollTop = 500;

          const docEl = document.documentElement;
          const body = document.body;
          const root = document.getElementById('root');
          const main = document.querySelector('main');

          return {
            windowScrollY: window.scrollY,
            docScrollTop: docEl.scrollTop,
            bodyScrollTop: body.scrollTop,
            docScrollHeight: docEl.scrollHeight,
            docClientHeight: docEl.clientHeight,
            bodyScrollHeight: body.scrollHeight,
            bodyClientHeight: body.clientHeight,
            rootScrollHeight: root?.scrollHeight,
            rootClientHeight: root?.clientHeight,
            mainScrollHeight: main?.scrollHeight,
            mainClientHeight: main?.clientHeight,
            hasDocOverflow: docEl.scrollHeight > docEl.clientHeight,
            hasBodyOverflow: body.scrollHeight > body.clientHeight,
            hasScrollOffset: window.scrollY > 0 || docEl.scrollTop > 0 || body.scrollTop > 0,
          };
        });

        console.log(`\n  Module: [${mod.toUpperCase()}]`);
        console.log(`    Doc Dimensions: scrollHeight=${scrollCheck.docScrollHeight}px, clientHeight=${scrollCheck.docClientHeight}px`);
        console.log(`    Body Dimensions: scrollHeight=${scrollCheck.bodyScrollHeight}px, clientHeight=${scrollCheck.bodyClientHeight}px`);
        console.log(`    Root Dimensions: scrollHeight=${scrollCheck.rootScrollHeight}px, clientHeight=${scrollCheck.rootClientHeight}px`);
        console.log(`    Main Dimensions: scrollHeight=${scrollCheck.mainScrollHeight}px, clientHeight=${scrollCheck.mainClientHeight}px`);
        console.log(`    Scroll Offsets: windowScrollY=${scrollCheck.windowScrollY}px, docScrollTop=${scrollCheck.docScrollTop}px, bodyScrollTop=${scrollCheck.bodyScrollTop}px`);
        console.log(`    Outer Body Scrollable: ${scrollCheck.hasDocOverflow || scrollCheck.hasBodyOverflow || scrollCheck.hasScrollOffset ? "FAIL (Leaking)" : "PASS (Zero Document Scroll)"}`);

        if (scrollCheck.hasDocOverflow || scrollCheck.hasBodyOverflow || scrollCheck.hasScrollOffset) {
          throw new Error(`Outer scroll containment failure on ${mod} at ${vp.name}`);
        }
      }
    }

    // Detailed Independent Scroll Checks on Desktop
    console.log(`\n=============================================================`);
    console.log(`  INDEPENDENT INTERNAL SCROLL VERIFICATION`);
    console.log(`=============================================================`);
    await page.setViewport({ width: 1280, height: 800 });

    // 1. Mail list independent scroll
    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-emails-tab"]')?.click();
    });
    await sleep(1000);

    const mailScroll = await page.evaluate(() => {
      const listEl = document.querySelector('[data-testid="message-list"] .overflow-y-auto');
      if (!listEl) return { found: false };
      const initialScroll = listEl.scrollTop;
      listEl.scrollTop = 250;
      const afterScroll = listEl.scrollTop;
      return {
        found: true,
        scrollHeight: listEl.scrollHeight,
        clientHeight: listEl.clientHeight,
        initialScroll,
        afterScroll,
        scrolledInternally: afterScroll > 0,
        outerDocScrollY: window.scrollY,
        docScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
      };
    });
    console.log("  [Mail MessageList Independent Scroll]:", mailScroll);
    if (!mailScroll.scrolledInternally || mailScroll.outerDocScrollY !== 0) {
      throw new Error("Mail MessageList failed independent scrolling check");
    }

    // 2. Calendar timeline grid independent scroll
    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-calendar-tab"]')?.click();
    });
    await sleep(1000);

    // Switch to Day view if available
    await page.evaluate(() => {
      const dayBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Day') || b.textContent.includes('Week'));
      if (dayBtn) dayBtn.click();
    });
    await sleep(1000);

    const calScroll = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="calendar-view"] .overflow-y-auto') ||
                   document.querySelector('[data-testid="week-time-grid-scroll-container"]') ||
                   document.querySelector('.custom-scrollbar.overflow-y-auto');
      if (!grid) return { found: false };
      const initialScroll = grid.scrollTop;
      grid.scrollTop = 350;
      const afterScroll = grid.scrollTop;
      return {
        found: true,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
        initialScroll,
        afterScroll,
        scrolledInternally: afterScroll > 0,
        outerDocScrollY: window.scrollY,
        docScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
      };
    });
    console.log("  [Calendar TimeGrid Independent Scroll]:", calScroll);
    if (!calScroll.scrolledInternally || calScroll.outerDocScrollY !== 0) {
      throw new Error("Calendar TimeGrid failed independent scrolling check");
    }

    // 3. Notes View scroll container containment
    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-notes-tab"]')?.click();
    });
    await sleep(1000);

    const notesContainment = await page.evaluate(() => {
      const notesBody = document.querySelector('[data-testid="notes-view"] .overflow-y-auto') ||
                        document.querySelector('.custom-scrollbar.overflow-y-auto') ||
                        document.querySelector('[data-testid="main-content"] .overflow-y-auto');
      if (!notesBody) return { found: false };
      const computed = window.getComputedStyle(notesBody);
      return {
        found: true,
        scrollHeight: notesBody.scrollHeight,
        clientHeight: notesBody.clientHeight,
        overflowY: computed.overflowY,
        minHeight: computed.minHeight,
        outerDocScrollY: window.scrollY,
        docScrollTop: document.documentElement.scrollTop,
        bodyScrollTop: document.body.scrollTop,
      };
    });
    console.log("  [Notes View Scroll Containment]:", notesContainment);
    if (!notesContainment.found || notesContainment.outerDocScrollY !== 0) {
      throw new Error("Notes View failed scroll containment check");
    }

    console.log(`\n=============================================================`);
    console.log(`  ALL MILESTONE 1 VERIFICATION CHECKS PASSED WITH ZERO ERRORS`);
    console.log(`=============================================================`);

  } catch (err) {
    console.error("Verification failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runM1Verification();
