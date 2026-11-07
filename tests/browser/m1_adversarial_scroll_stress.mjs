import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function auditOuterScroll(page, contextLabel) {
  const result = await page.evaluate(() => {
    // Attempt aggressive programmatic scrolling on window, doc, and body
    window.scrollTo(0, 9999);
    window.scrollBy(0, 5000);
    document.documentElement.scrollTop = 9999;
    document.body.scrollTop = 9999;

    const docEl = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const main = document.querySelector('main');

    const winScrollY = window.scrollY;
    const winScrollX = window.scrollX;
    const docScrollTop = docEl.scrollTop;
    const bodyScrollTop = body.scrollTop;

    const docOverflowY = docEl.scrollHeight > docEl.clientHeight;
    const docOverflowX = docEl.scrollWidth > docEl.clientWidth;
    const bodyOverflowY = body.scrollHeight > body.clientHeight;
    const bodyOverflowX = body.scrollWidth > body.clientWidth;

    const isLeaking =
      winScrollY > 0 ||
      winScrollX > 0 ||
      docScrollTop > 0 ||
      bodyScrollTop > 0 ||
      docOverflowY ||
      bodyOverflowY;

    return {
      winScrollY,
      winScrollX,
      docScrollTop,
      bodyScrollTop,
      docScrollHeight: docEl.scrollHeight,
      docClientHeight: docEl.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      rootScrollHeight: root ? root.scrollHeight : null,
      rootClientHeight: root ? root.clientHeight : null,
      mainScrollHeight: main ? main.scrollHeight : null,
      mainClientHeight: main ? main.clientHeight : null,
      docOverflowY,
      bodyOverflowY,
      isLeaking,
    };
  });

  console.log(`\n  [Scroll Audit: ${contextLabel}]`);
  console.log(`    Window scroll offset: (X=${result.winScrollX}px, Y=${result.winScrollY}px)`);
  console.log(`    Doc element: scrollHeight=${result.docScrollHeight}px, clientHeight=${result.docClientHeight}px, scrollTop=${result.docScrollTop}px`);
  console.log(`    Body element: scrollHeight=${result.bodyScrollHeight}px, clientHeight=${result.bodyClientHeight}px, scrollTop=${result.bodyScrollTop}px`);
  console.log(`    Root element: scrollHeight=${result.rootScrollHeight}px, clientHeight=${result.rootClientHeight}px`);
  console.log(`    Main element: scrollHeight=${result.mainScrollHeight}px, clientHeight=${result.mainClientHeight}px`);
  console.log(`    Containment verdict: ${result.isLeaking ? 'LEAK_DETECTED' : 'CONTAINED_OK'}`);

  if (result.isLeaking) {
    throw new Error(`CRITICAL: Outer document scroll containment breach detected in context: ${contextLabel}`);
  }

  return result;
}

async function runAdversarialScrollHarness() {
  console.log('=============================================================================');
  console.log('  EMPIRICAL ADVERSARIAL STRESS HARNESS: SCROLL CONTAINMENT (MILESTONE 1)');
  console.log('=============================================================================');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const summary = {
    totalTests: 0,
    passed: 0,
    failed: 0,
    details: [],
  };

  function recordResult(testName, passed, info) {
    summary.totalTests++;
    if (passed) summary.passed++;
    else summary.failed++;
    summary.details.push({ testName, passed, info });
    console.log(`\n>>> [TEST ${summary.totalTests}]: ${testName} => ${passed ? 'PASSED' : 'FAILED'}`);
    if (info) console.log(`    Info: ${JSON.stringify(info, null, 2)}`);
  }

  try {
    const page = await browser.newPage();

    // Set standard desktop viewport initially
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // Authenticate if needed
    const hasEmailInput = await page.$('input[type="email"]');
    if (hasEmailInput) {
      console.log('Logging in with alice@byos.local...');
      await page.type('input[type="email"]', 'alice@byos.local');
      await page.type('input[type="password"]', 'test-password-123');
      await page.click('button[type="submit"]');
      await sleep(3000);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // STRESS TEST 1: Mail MessageList Heavy Dataset (300 Injected Items) & Overscroll Chaining
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n-----------------------------------------------------------------------------');
    console.log(' STRESS TEST 1: Mailbox MessageList Heavy Dataset & Overscroll Chaining');
    console.log('-----------------------------------------------------------------------------');

    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-emails-tab"]')?.click();
    });
    await sleep(1000);

    // Stress: Inject 300 additional synthetic message rows into the message list scroll container
    const injectResult = await page.evaluate(() => {
      const scrollEl = document.querySelector('[data-testid="message-list"] .overflow-y-auto');
      if (!scrollEl) return { error: 'Scroll element not found' };

      const initialScrollHeight = scrollEl.scrollHeight;
      const initialClientHeight = scrollEl.clientHeight;

      const frag = document.createDocumentFragment();
      for (let i = 0; i < 300; i++) {
        const item = document.createElement('div');
        item.className = 'stress-injected-row px-4 py-3 border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between bg-white dark:bg-[#1E2025] hover:bg-[#FAF9F5] select-none';
        item.style.height = '64px';
        item.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="w-2.5 h-2.5 rounded-full bg-[#A27561]"></span>
            <div class="flex flex-col">
              <span class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Stress Test Sender #${i + 1} &lt;stress${i}@byos.local&gt;</span>
              <span class="text-xs text-[#6F7173] dark:text-[#878A8E] truncate max-w-md">Stress testing internal scroll containment with 300 synthetic items. Subject #${i + 1}</span>
            </div>
          </div>
          <span class="text-xs font-mono text-[#878A8E]">12:${(i % 60).toString().padStart(2, '0')} PM</span>
        `;
        frag.appendChild(item);
      }
      scrollEl.appendChild(frag);

      return {
        initialScrollHeight,
        afterScrollHeight: scrollEl.scrollHeight,
        initialClientHeight,
        afterClientHeight: scrollEl.clientHeight,
      };
    });

    console.log('  Heavy dataset injection metrics:', injectResult);

    // Test scrolling internal container through multiple positions
    const scrollOps = await page.evaluate(async () => {
      const scrollEl = document.querySelector('[data-testid="message-list"] .overflow-y-auto');
      if (!scrollEl) return { error: 'Scroll element not found' };

      const ops = [];
      scrollEl.scrollTop = 3000;
      ops.push({ target: 3000, actual: scrollEl.scrollTop });

      scrollEl.scrollTop = 12000;
      ops.push({ target: 12000, actual: scrollEl.scrollTop });

      scrollEl.scrollTop = scrollEl.scrollHeight;
      const maxScroll = scrollEl.scrollTop;
      ops.push({ target: 'max', actual: maxScroll, scrollHeight: scrollEl.scrollHeight });

      scrollEl.scrollTop = 0;
      ops.push({ target: 0, actual: scrollEl.scrollTop });

      return ops;
    });

    console.log('  Internal scroll jumps performed:', scrollOps);

    // Aggressive mouse wheel overscroll at boundary
    const scrollContainerBox = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="message-list"] .overflow-y-auto');
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    await page.mouse.move(scrollContainerBox.x, scrollContainerBox.y);
    // Boundary overscroll upward
    await page.mouse.wheel({ deltaY: -1500 });
    await sleep(200);

    // Boundary overscroll downward
    await page.evaluate(() => {
      const scrollEl = document.querySelector('[data-testid="message-list"] .overflow-y-auto');
      scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    await sleep(100);
    await page.mouse.wheel({ deltaY: 2500 });
    await sleep(200);

    const mailAudit = await auditOuterScroll(page, 'Mailbox 300-Item Heavy Dataset & Boundary Overscroll');
    await page.screenshot({ path: 'tests/browser/artifacts/m1_stress_mail_large_list.png' });

    recordResult('Mailbox Large Dataset Internal Scroll & Overscroll Containment', !mailAudit.isLeaking, {
      injectResult,
      scrollOps,
      outerScrollY: mailAudit.winScrollY,
    });

    // Clean up injected items so standard state is restored
    await page.evaluate(() => {
      document.querySelectorAll('.stress-injected-row').forEach((el) => el.remove());
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STRESS TEST 2: Calendar Full 24-Hour Day/Week Timeline Grid Under Stress
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n-----------------------------------------------------------------------------');
    console.log(' STRESS TEST 2: Calendar Full 24-Hour Day & Week Timeline Grid Under Stress');
    console.log('-----------------------------------------------------------------------------');

    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-calendar-tab"]')?.click();
    });
    await sleep(1500);

    // Switch to Day view
    await page.evaluate(() => {
      const dayBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Day');
      if (dayBtn) dayBtn.click();
    });
    await sleep(1500);

    // Verify 24-hour Day View time grid
    const dayGridMetrics = await page.evaluate(() => {
      const gutter = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const grid = gutter ? gutter.parentElement : document.querySelector('[data-testid="calendar-view"] .overflow-y-auto');
      if (!grid) return { error: 'Day grid not found' };

      const initialScroll = grid.scrollTop;
      // Scroll to evening hours (approx 900px)
      grid.scrollTop = 900;
      const scrolledToEvening = grid.scrollTop;

      // Scroll to 11:59 PM (maximum bottom)
      grid.scrollTop = grid.scrollHeight;
      const scrolledToMax = grid.scrollTop;

      return {
        initialScroll,
        scrolledToEvening,
        scrolledToMax,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
        has24hContent: grid.scrollHeight >= 1344, // 24 hours * 56px = 1344px
      };
    });

    console.log('  Day View 24h timeline grid metrics:', dayGridMetrics);

    // Boundary wheel stress on Day Grid
    const dayGridBox = await page.evaluate(() => {
      const gutter = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const grid = gutter ? gutter.parentElement : document.querySelector('[data-testid="calendar-view"] .overflow-y-auto');
      const rect = grid.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(dayGridBox.x, dayGridBox.y);
    await page.mouse.wheel({ deltaY: -2000 }); // Top overscroll
    await sleep(100);
    await page.mouse.wheel({ deltaY: 3000 });  // Bottom overscroll
    await sleep(200);

    const dayAudit = await auditOuterScroll(page, 'Calendar Day View 24h Grid');
    await page.screenshot({ path: 'tests/browser/artifacts/m1_stress_calendar_day_24h.png' });

    recordResult('Calendar Day View 24h Grid Scroll & Boundary Containment', !dayAudit.isLeaking && dayGridMetrics.scrolledToMax > 0 && dayGridMetrics.has24hContent, {
      dayGridMetrics,
      outerScrollY: dayAudit.winScrollY,
    });

    // Switch to Week view
    await page.evaluate(() => {
      const weekBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Week');
      if (weekBtn) weekBtn.click();
    });
    await sleep(1500);

    const weekGridMetrics = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="week-time-grid-scroll-container"]');
      if (!grid) return { error: 'Week grid not found' };

      const initialScroll = grid.scrollTop;
      grid.scrollTop = 900;
      const scrolledMid = grid.scrollTop;
      grid.scrollTop = grid.scrollHeight;
      const scrolledMax = grid.scrollTop;

      return {
        initialScroll,
        scrolledMid,
        scrolledMax,
        scrollHeight: grid.scrollHeight,
        clientHeight: grid.clientHeight,
        has24hContent: grid.scrollHeight >= 1344,
      };
    });

    console.log('  Week View 24h timeline grid metrics:', weekGridMetrics);

    // Boundary wheel stress on Week Grid
    const weekGridBox = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="week-time-grid-scroll-container"]');
      const rect = grid.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(weekGridBox.x, weekGridBox.y);
    await page.mouse.wheel({ deltaY: -2000 });
    await sleep(100);
    await page.mouse.wheel({ deltaY: 3000 });
    await sleep(200);

    const weekAudit = await auditOuterScroll(page, 'Calendar Week View 24h Grid');
    await page.screenshot({ path: 'tests/browser/artifacts/m1_stress_calendar_week_24h.png' });

    recordResult('Calendar Week View 24h Grid Scroll & Boundary Containment', !weekAudit.isLeaking && weekGridMetrics.scrolledMax > 0 && weekGridMetrics.has24hContent, {
      weekGridMetrics,
      outerScrollY: weekAudit.winScrollY,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STRESS TEST 3: Reading Pane Massive Message Body & Toolbar Pinning
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n-----------------------------------------------------------------------------');
    console.log(' STRESS TEST 3: Reading Pane Massive Message Body & Toolbar Pinning');
    console.log('-----------------------------------------------------------------------------');

    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-emails-tab"]')?.click();
    });
    await sleep(1500);

    // Open first message to display Reading Pane
    await page.waitForSelector('[data-testid="message-row"], [data-testid="thread-row"]', { timeout: 8000 });
    await page.click('[data-testid="message-row"], [data-testid="thread-row"]');
    await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 8000 });
    await sleep(1000);

    // Inject 100 massive paragraphs into reading pane content body
    const readingPaneMetrics = await page.evaluate(() => {
      const readingPane = document.querySelector('[data-testid="reading-pane"]');
      if (!readingPane) return { error: 'Reading pane not found' };

      const contentArea = readingPane.querySelector('.overflow-y-auto');
      if (!contentArea) return { error: 'Reading pane scroll area not found' };

      const initialScrollHeight = contentArea.scrollHeight;
      const initialClientHeight = contentArea.clientHeight;

      const frag = document.createDocumentFragment();
      for (let i = 0; i < 80; i++) {
        const p = document.createElement('p');
        p.className = 'stress-injected-para my-4 text-sm leading-relaxed text-[#1A1B1E] dark:text-[#F3F4F6]';
        p.textContent = `Paragraph ${i + 1}: Adversarial layout stress verification for BYOS zero-knowledge email client. Testing that internal reading pane scrolls independently without displacing the top action toolbar, top fixed app bar, or leaking scroll offsets to document body. Repeating padding text: cryptographic guarantees require exact viewport bounding.`;
        frag.appendChild(p);
      }
      contentArea.appendChild(frag);

      const afterScrollHeight = contentArea.scrollHeight;
      const afterClientHeight = contentArea.clientHeight;

      // Scroll to middle and bottom
      contentArea.scrollTop = 2500;
      const scrolledMid = contentArea.scrollTop;

      contentArea.scrollTop = contentArea.scrollHeight;
      const scrolledBottom = contentArea.scrollTop;

      // Check toolbar position: toolbar should be pinned at top (rect.top >= 0 and within reading pane)
      const toolbar = readingPane.querySelector('[data-testid="reading-pane-back-btn"]')?.parentElement?.parentElement;
      const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;

      return {
        initialScrollHeight,
        afterScrollHeight,
        initialClientHeight,
        afterClientHeight,
        scrolledMid,
        scrolledBottom,
        toolbarTop: toolbarRect?.top,
        toolbarVisible: toolbarRect ? toolbarRect.top >= 0 && toolbarRect.bottom > toolbarRect.top : false,
      };
    });

    console.log('  Reading Pane massive content metrics:', readingPaneMetrics);

    // Boundary wheel events on Reading Pane
    const rpBox = await page.evaluate(() => {
      const rp = document.querySelector('[data-testid="reading-pane"] .overflow-y-auto');
      const rect = rp.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(rpBox.x, rpBox.y);
    await page.mouse.wheel({ deltaY: -2000 });
    await sleep(100);
    await page.mouse.wheel({ deltaY: 3000 });
    await sleep(200);

    const rpAudit = await auditOuterScroll(page, 'Reading Pane 80-Paragraph Long Body');
    await page.screenshot({ path: 'tests/browser/artifacts/m1_stress_reading_pane_long_content.png' });

    recordResult('Reading Pane Long Body Scroll & Toolbar Pinning', !rpAudit.isLeaking && readingPaneMetrics.scrolledBottom > 0 && readingPaneMetrics.toolbarVisible, {
      readingPaneMetrics,
      outerScrollY: rpAudit.winScrollY,
    });

    // Close reading pane
    await page.click('[data-testid="reading-pane-back-btn"]');
    await sleep(1000);

    // ─────────────────────────────────────────────────────────────────────────
    // STRESS TEST 4: Notes Module Long Dataset & Scroll Containment
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n-----------------------------------------------------------------------------');
    console.log(' STRESS TEST 4: Notes Module Long Dataset & Scroll Containment');
    console.log('-----------------------------------------------------------------------------');

    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-notes-tab"]')?.click();
    });
    await sleep(1500);

    const notesMetrics = await page.evaluate(() => {
      const notesBody = document.querySelector('[data-testid="notes-view"] .overflow-y-auto') ||
                        document.querySelector('[data-testid="main-content"] .overflow-y-auto');
      if (!notesBody) return { error: 'Notes scroll container not found' };

      const initialScrollHeight = notesBody.scrollHeight;
      const initialClientHeight = notesBody.clientHeight;

      const frag = document.createDocumentFragment();
      for (let i = 0; i < 50; i++) {
        const card = document.createElement('div');
        card.className = 'stress-note-card p-4 my-3 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xs';
        card.style.height = '120px';
        card.innerHTML = `<h4 class="font-bold text-sm">Stress Test Note #${i + 1}</h4><p class="text-xs text-[#878A8E] mt-2">Testing that notes workspace scrolls smoothly under large datasets without leaking offsets to the document body.</p>`;
        frag.appendChild(card);
      }
      notesBody.appendChild(frag);

      notesBody.scrollTop = 3000;
      const scrolledMid = notesBody.scrollTop;
      notesBody.scrollTop = notesBody.scrollHeight;
      const scrolledMax = notesBody.scrollTop;

      return {
        initialScrollHeight,
        afterScrollHeight: notesBody.scrollHeight,
        initialClientHeight,
        afterClientHeight: notesBody.clientHeight,
        scrolledMid,
        scrolledMax,
      };
    });

    console.log('  Notes heavy dataset metrics:', notesMetrics);

    const notesAudit = await auditOuterScroll(page, 'Notes Module 50-Card Dataset');
    await page.screenshot({ path: 'tests/browser/artifacts/m1_stress_notes_long_content.png' });

    recordResult('Notes Module Long Dataset Scroll & Containment', !notesAudit.isLeaking && notesMetrics.scrolledMax > 0, {
      notesMetrics,
      outerScrollY: notesAudit.winScrollY,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // STRESS TEST 5: Small / Empty Dataset Layout Stability (No Collapsing/Over-expansion)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n-----------------------------------------------------------------------------');
    console.log(' STRESS TEST 5: Small / Empty Dataset Layout Stability');
    console.log('-----------------------------------------------------------------------------');

    await page.evaluate(() => {
      document.querySelector('[data-testid="nav-emails-tab"]')?.click();
    });
    await sleep(1500);

    // Switch to Spam or Trash folder (which is typically empty or low count)
    const emptyFolderCheck = await page.evaluate(async () => {
      const spamLink = document.querySelector('[data-testid="folder-spam"]');
      if (spamLink) spamLink.click();
    });
    await sleep(1500);

    const emptyStateMetrics = await page.evaluate(() => {
      const scrollEl = document.querySelector('[data-testid="message-list"] .overflow-y-auto');
      const listRoot = document.querySelector('[data-testid="message-list"]');
      const mainEl = document.querySelector('main');
      if (!scrollEl || !listRoot) return { error: 'Message list not found' };

      const listRect = listRoot.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const mainRect = mainEl?.getBoundingClientRect();

      return {
        listHeight: listRect.height,
        scrollElHeight: scrollRect.height,
        mainHeight: mainRect?.height,
        isNotCollapsed: listRect.height > 200,
        isNotOverExpanded: listRect.height <= (mainRect?.height || 9999),
        scrollHeight: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
        hasUnwantedScrollbar: scrollEl.scrollHeight > scrollEl.clientHeight,
      };
    });

    console.log('  Empty dataset layout stability metrics:', emptyStateMetrics);

    const emptyAudit = await auditOuterScroll(page, 'Empty Message List State');
    await page.screenshot({ path: 'tests/browser/artifacts/m1_stress_mail_empty_folder.png' });

    recordResult('Small / Empty Dataset Container Geometry & Stability',
      !emptyAudit.isLeaking &&
      emptyStateMetrics.isNotCollapsed &&
      emptyStateMetrics.isNotOverExpanded,
      {
        emptyStateMetrics,
        outerScrollY: emptyAudit.winScrollY,
      }
    );

    // Return to Inbox
    await page.evaluate(() => {
      document.querySelector('[data-testid="folder-inbox"]')?.click();
    });
    await sleep(1000);

    // ─────────────────────────────────────────────────────────────────────────
    // STRESS TEST 6: Extreme Viewport Geometries
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n-----------------------------------------------------------------------------');
    console.log(' STRESS TEST 6: Extreme Viewport Geometries (Ultra-Short, Mobile Landscape, Ultra-Tall)');
    console.log('-----------------------------------------------------------------------------');

    const extremeViewports = [
      { name: 'ultra_short_1024x320', width: 1024, height: 320, artifact: 'tests/browser/artifacts/m1_stress_ultra_short_320px.png' },
      { name: 'mobile_landscape_667x375', width: 667, height: 375, isMobile: true, artifact: 'tests/browser/artifacts/m1_stress_mobile_landscape_375px.png' },
      { name: 'ultra_tall_1080x1600', width: 1080, height: 1600, artifact: 'tests/browser/artifacts/m1_stress_ultra_tall_1600px.png' },
    ];

    for (const vp of extremeViewports) {
      console.log(`\nTesting Extreme Viewport: ${vp.name} (${vp.width}x${vp.height})...`);
      await page.setViewport(vp);
      await sleep(1000);

      const audit = await auditOuterScroll(page, `Extreme Viewport: ${vp.name}`);
      await page.screenshot({ path: vp.artifact });

      recordResult(`Extreme Viewport Containment: ${vp.name}`, !audit.isLeaking, {
        viewport: `${vp.width}x${vp.height}`,
        docScrollHeight: audit.docScrollHeight,
        docClientHeight: audit.docClientHeight,
        outerScrollY: audit.winScrollY,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FINAL VERDICT & SUMMARY
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n=============================================================================');
    console.log('  ADVERSARIAL STRESS HARNESS SUMMARY & EMPIRICAL VERDICT');
    console.log('=============================================================================');
    console.log(`  Total Tests Run: ${summary.totalTests}`);
    console.log(`  Passed:          ${summary.passed}`);
    console.log(`  Failed:          ${summary.failed}`);

    if (summary.failed > 0) {
      console.error(`\nOVERALL VERDICT: CHALLENGE_FAILED (${summary.failed} tests failed)`);
      process.exit(1);
    } else {
      console.log('\nOVERALL VERDICT: CONFIRMED CORRECT (Zero scroll leakage, robust internal containment)');
      process.exit(0);
    }

  } catch (err) {
    console.error('\nCRITICAL FAILURE IN ADVERSARIAL STRESS HARNESS:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runAdversarialScrollHarness();
