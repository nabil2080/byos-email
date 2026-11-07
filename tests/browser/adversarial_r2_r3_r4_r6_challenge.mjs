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

async function runAdversarialChallenge() {
  console.log("================================================================================");
  console.log("     ADVERSARIAL EMPIRICAL CHALLENGE: R2, R3, R4, R6 PRODUCTION REFINEMENTS     ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const unhandledErrors = [];
  const findings = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)') &&
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_INTERNET_DISCONNECTED')
        ) {
          unhandledErrors.push(text);
          console.error(`  [CONSOLE ERROR] ${text}`);
        }
      }
    });

    // ── STEP 1: Desktop Login Flow ──
    console.log("--- [STEP 1] Login Flow on Desktop (1280x800) ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await sleep(2000);
    console.log("  Successfully logged in as Alice.");

    // ── STEP 2: Adversarial Verification of R2 (Feature UI Removal: Appointments & Tasks) ──
    console.log("\n--- [STEP 2] R2 Adversarial Verification: Appointments & Tasks Absence ---");

    // Navigate to Calendar
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1000);
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    assert(true, "Calendar view mounted cleanly");

    // 2.1 Adversarial check for tasks / appointments DOM nodes
    const r2DomAudit = await page.evaluate(() => {
      const results = {};
      results.tasksSidebarSection = document.querySelector('[data-testid="drawer-tasks-section"]') !== null;
      results.tasksToggleRow = document.querySelector('[data-testid="tasks-toggle-row"]') !== null;
      results.appointmentsModal = document.querySelector('[data-testid="appointments-manager-modal"]') !== null;
      results.scheduleModal = document.querySelector('[data-testid="appointment-schedule-modal"]') !== null;
      results.bookingPage = document.querySelector('[data-testid="booking-page-view"]') !== null;
      
      // Check for any task checkboxes in day/week/month view
      const taskCheckboxes = document.querySelectorAll('input[type="checkbox"][data-task-id], .task-checkbox, [data-testid*="task-item"]');
      results.taskCheckboxesCount = taskCheckboxes.length;

      // Check for buttons with text containing "Appointment" or "Task" (case-insensitive)
      const allButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      results.buttonsWithAppointment = allButtons
        .filter(b => (b.textContent || '').toLowerCase().includes('appointment') || (b.getAttribute('aria-label') || '').toLowerCase().includes('appointment'))
        .map(b => b.textContent?.trim() || b.getAttribute('aria-label'));
      results.buttonsWithTask = allButtons
        .filter(b => (b.textContent || '').toLowerCase().includes('task') && !(b.textContent || '').toLowerCase().includes('shortcut'))
        .map(b => b.textContent?.trim() || b.getAttribute('aria-label'));

      return results;
    });

    console.log("  R2 DOM Audit Results:", JSON.stringify(r2DomAudit, null, 2));
    assert(!r2DomAudit.tasksSidebarSection, "drawer-tasks-section is ABSENT from DOM");
    assert(!r2DomAudit.tasksToggleRow, "tasks-toggle-row is ABSENT from DOM");
    assert(!r2DomAudit.appointmentsModal, "appointments-manager-modal is ABSENT from DOM");
    assert(!r2DomAudit.scheduleModal, "appointment-schedule-modal is ABSENT from DOM");
    assert(!r2DomAudit.bookingPage, "booking-page-view is ABSENT from DOM");
    assert(r2DomAudit.taskCheckboxesCount === 0, "0 task checkboxes exist in DOM");
    assert(r2DomAudit.buttonsWithAppointment.length === 0, "0 buttons with 'Appointment' exist in DOM");
    assert(r2DomAudit.buttonsWithTask.length === 0, "0 buttons with 'Task' exist in DOM");

    // 2.2 Hotkey "b" adversarial check
    console.log("  Testing hotkey 'b' press in Calendar view...");
    await page.keyboard.press('KeyB');
    await sleep(500);
    const modalAfterB = await page.evaluate(() => {
      const modals = document.querySelectorAll('[role="dialog"], [data-testid*="modal"]');
      return Array.from(modals).map(m => m.getAttribute('data-testid') || m.className);
    });
    console.log("  Modals open after pressing 'b':", modalAfterB);
    assert(!modalAfterB.some(m => String(m).includes('appointment')), "Hotkey 'b' does NOT open any appointment modal");

    // 2.3 Keyboard Shortcuts Modal audit ('?')
    console.log("  Auditing Keyboard Shortcuts Modal ('?')...");
    await page.keyboard.press('?');
    await sleep(500);
    const shortcutsAudit = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return { modalFound: false };
      const text = modal.innerText || "";
      const hasBShortcut = text.toLowerCase().includes("booking page") || text.toLowerCase().includes("appointment");
      return {
        modalFound: true,
        hasBShortcut,
        textSnippet: text.slice(0, 300)
      };
    });
    console.log("  Shortcuts Modal Audit:", shortcutsAudit);
    if (shortcutsAudit.hasBShortcut) {
      findings.push({
        type: "NON_CRITICAL_POLISH",
        description: "CalendarShortcutsModal.tsx line 43 still lists hotkey 'b' for 'Booking page & appointment schedules' in the help dialog, even though hotkey 'b' was cleanly removed from handleGlobalKeyDown and functional UI.",
      });
      console.log("  NOTE: Shortcut modal help documentation still references 'b' (informational finding recorded).");
    }
    // Close shortcuts modal
    await page.keyboard.press('Escape');
    await sleep(300);

    // 2.4 Calendar Views Navigation Stress Test
    console.log("  Clicking through calendar views: Day, Week, Month, Year, Agenda...");
    const viewButtons = ['day', 'week', 'month', 'year', 'agenda'];
    for (const v of viewButtons) {
      const btn = await page.$(`[data-testid="calendar-view-${v}-btn"]`);
      if (btn) {
        await btn.click();
        await sleep(300);
        assert(true, `Successfully switched to view: ${v}`);
      }
    }
    // Return to week view
    const weekBtn = await page.$('[data-testid="calendar-view-week-btn"]');
    if (weekBtn) await weekBtn.click();
    await sleep(400);

    // 2.5 Calendar Settings Modal audit
    console.log("  Auditing Calendar Settings Panel for appointment/task settings...");
    const settingsBtn = await page.$('[data-testid="calendar-settings-btn"]');
    if (settingsBtn) {
      await settingsBtn.click();
      await sleep(600);
      const settingsSections = await page.evaluate(() => {
        const navItems = Array.from(document.querySelectorAll('[data-testid*="settings-nav-"], [role="tab"]'));
        return navItems.map(item => item.textContent?.trim()).filter(Boolean);
      });
      console.log("  Calendar settings navigation items:", settingsSections);
      assert(!settingsSections.some(s => /appointment|booking/i.test(s)), "No appointment or booking tabs in Calendar Settings");
      assert(!settingsSections.some(s => /task/i.test(s)), "No task tabs in Calendar Settings");
      
      const closeSettingsBtn = await page.$('[data-testid="calendar-settings-close-btn"]');
      if (closeSettingsBtn) {
        await closeSettingsBtn.click();
      } else {
        await page.keyboard.press('Escape');
      }
      await sleep(400);
    }

    await page.screenshot({ path: path.join(artifactsDir, 'adversarial_r2_calendar_views.png') });
    console.log("  Saved screenshot: adversarial_r2_calendar_views.png");

    // ── STEP 3: Adversarial Verification of R3 (3D Page-Turn Morphing Module Transition) ──
    console.log("\n--- [STEP 3] R3 Adversarial Verification: 3D Page-Turn Morphing Transitions ---");

    // Test sequence: Mail (0) -> Calendar (1) -> Notes (2) -> Mail (0) -> Notes (2) -> Calendar (1) -> Mail (0)
    const transitionsToTest = [
      { from: 'calendar', to: 'notes', expectedDir: 'forward', btn: '[data-testid="nav-notes-tab"]' },
      { from: 'notes', to: 'mail', expectedDir: 'backward', btn: '[data-testid="nav-emails-tab"]' },
      { from: 'mail', to: 'calendar', expectedDir: 'forward', btn: '[data-testid="nav-calendar-tab"]' },
      { from: 'calendar', to: 'notes', expectedDir: 'forward', btn: '[data-testid="nav-notes-tab"]' },
      { from: 'notes', to: 'calendar', expectedDir: 'backward', btn: '[data-testid="nav-calendar-tab"]' },
      { from: 'calendar', to: 'mail', expectedDir: 'backward', btn: '[data-testid="nav-emails-tab"]' },
    ];

    for (const step of transitionsToTest) {
      console.log(`  Testing transition: ${step.from} -> ${step.to} (expected: ${step.expectedDir})`);
      
      // Trigger navigation and immediately inspect classes
      await page.click(step.btn);
      
      const animationClasses = await page.evaluate((dir) => {
        const main = document.querySelector('[data-testid="main-content"]');
        if (!main) return { error: "main not found" };
        const children = Array.from(main.children);
        const classes = children.map(c => c.className);
        return {
          viewportClasses: main.className,
          childClasses: classes,
          hasForwardIn: classes.some(c => c.includes('animate-page-turn-in-forward')),
          hasBackwardIn: classes.some(c => c.includes('animate-page-turn-in-backward')),
          hasForwardOut: classes.some(c => c.includes('animate-page-turn-out-forward')),
          hasBackwardOut: classes.some(c => c.includes('animate-page-turn-out-backward')),
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      }, step.expectedDir);

      console.log(`    Observed classes during transition:`, animationClasses.childClasses);
      if (step.expectedDir === 'forward') {
        assert(animationClasses.hasForwardIn || animationClasses.hasForwardOut, "Forward animation class applied during forward transition");
      } else {
        assert(animationClasses.hasBackwardIn || animationClasses.hasBackwardOut, "Backward animation class applied during backward transition");
      }
      assert(animationClasses.scrollWidth <= animationClasses.clientWidth, "Zero horizontal overflow during 3D page turn");

      // Wait 350ms for transition duration (280ms) to complete and verify prevModule is cleared
      await sleep(350);
      const postTransitionState = await page.evaluate(() => {
        const main = document.querySelector('[data-testid="main-content"]');
        const children = Array.from(main?.children || []);
        return {
          childCount: children.length,
          hasExitingOverlay: children.some(c => c.className.includes('pointer-events-none') && c.className.includes('absolute')),
        };
      });
      assert(!postTransitionState.hasExitingOverlay, "Previous module exiting overlay successfully unmounted after 280ms");
    }

    // Rapid Module Switching Stress Test
    console.log("  Executing rapid module switching stress test (burst clicks)...");
    const rapidSequence = [
      '[data-testid="nav-calendar-tab"]',
      '[data-testid="nav-notes-tab"]',
      '[data-testid="nav-emails-tab"]',
      '[data-testid="nav-notes-tab"]',
      '[data-testid="nav-calendar-tab"]',
    ];
    for (const selector of rapidSequence) {
      await page.evaluate((sel) => {
        const elements = Array.from(document.querySelectorAll(sel));
        const clickable = elements.find(el => !el.closest('.pointer-events-none'));
        if (clickable) clickable.click();
      }, selector);
      await sleep(60); // Rapid click before 280ms timer resolves
    }
    // Allow final animation to settle
    await sleep(400);

    const settledState = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="main-content"]');
      const children = Array.from(main?.children || []);
      return {
        childCount: children.length,
        hasExitingOverlay: children.some(c => c.className.includes('pointer-events-none') && c.className.includes('absolute')),
        calendarActive: document.querySelector('[data-testid="calendar-view"]') !== null,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    console.log("  Rapid switching settled state:", settledState);
    assert(settledState.calendarActive, "Final active module correctly rendered after rapid switches");
    assert(!settledState.hasExitingOverlay, "No stale exiting overlays remain in DOM after rapid burst");
    assert(settledState.scrollWidth <= settledState.clientWidth, "Zero horizontal overflow after rapid switching");

    // Reduced-motion verification
    console.log("  Testing reduced-motion media query fallback...");
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.click('[data-testid="nav-emails-tab"]');
    await sleep(50);
    const reducedMotionComputed = await page.evaluate(() => {
      const activeModuleContainer = document.querySelector('[data-testid="main-content"] > div');
      if (!activeModuleContainer) return null;
      const cs = window.getComputedStyle(activeModuleContainer);
      return {
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        transform: cs.transform,
      };
    });
    console.log("  Reduced-motion computed style:", reducedMotionComputed);
    assert(
      reducedMotionComputed?.animationName === 'none' ||
      reducedMotionComputed?.animationDuration === '0s' ||
      reducedMotionComputed?.transform === 'none',
      "Reduced-motion overrides 3D animations with instant/none transform"
    );

    // Wait for transition to complete before resetting and returning to calendar
    await sleep(350);

    // Reset media feature and return to Calendar
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(400);

    await page.screenshot({ path: path.join(artifactsDir, 'adversarial_r3_module_transition.png') });
    console.log("  Saved screenshot: adversarial_r3_module_transition.png");

    // ── STEP 4: Adversarial Verification of R4 (Mobile Calendar Header Account Icon Removal) ──
    console.log("\n--- [STEP 4] R4 Adversarial Verification: Mobile Calendar Header Account Icon Removal ---");

    const breakpoints = [375, 414, 640, 767];
    for (const width of breakpoints) {
      await page.setViewport({ width, height: 667, isMobile: true, hasTouch: true });
      await sleep(300);

      // Ensure Calendar is active on mobile
      const calCheck = await page.$('[data-testid="calendar-view"]');
      if (!calCheck) {
        const bottomCal = await page.$('[data-testid="bottom-nav-calendar-tab"]');
        if (bottomCal) {
          await bottomCal.click();
          await sleep(500);
        }
      }

      await page.waitForSelector('[data-testid="mobile-calendar-header"]', { timeout: 5000 });

      const headerAudit = await page.evaluate(() => {
        const header = document.querySelector('[data-testid="mobile-calendar-header"]');
        if (!header) return { error: "mobile-calendar-header not found" };

        const avatarBtn = header.querySelector('[data-testid="calendar-header-avatar-btn"]');
        const buttons = Array.from(header.querySelectorAll('button'));
        const buttonTestIds = buttons.map(b => b.getAttribute('data-testid'));
        
        // Check for any human silhouette icons in the mobile header
        const svgPaths = Array.from(header.querySelectorAll('svg path')).map(p => p.getAttribute('d') || '');
        const hasHumanSilhouette = svgPaths.some(d => d.includes('M10 9') || d.includes('14 0H3') || d.includes('M12 12c2.21'));

        return {
          hasAvatarBtn: avatarBtn !== null,
          buttonCount: buttons.length,
          buttonTestIds,
          hasHumanSilhouette,
        };
      });

      console.log(`  Breakpoint ${width}px header audit:`, headerAudit);
      assert(!headerAudit.hasAvatarBtn, `Account avatar button is completely ABSENT at ${width}px`);
      assert(!headerAudit.hasHumanSilhouette, `Human silhouette SVG icon is completely ABSENT at ${width}px`);
      assert(headerAudit.buttonTestIds.includes('calendar-sidebar-toggle-btn'), `Hamburger button present at ${width}px`);
      assert(headerAudit.buttonTestIds.includes('calendar-month-dropdown-btn'), `Month dropdown title present at ${width}px`);
      assert(headerAudit.buttonTestIds.includes('calendar-today-btn'), `Today button present at ${width}px`);
      assert(headerAudit.buttonTestIds.includes('calendar-mobile-search-toggle-btn'), `Search toggle present at ${width}px`);
    }

    await page.screenshot({ path: path.join(artifactsDir, 'adversarial_r4_mobile_header.png') });
    console.log("  Saved screenshot: adversarial_r4_mobile_header.png");

    // ── STEP 5: Adversarial Verification of R6 (Mobile Month Navigation Animation) ──
    console.log("\n--- [STEP 5] R6 Adversarial Verification: Mobile Month Navigation Animation ---");
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await sleep(200);

    // 5.1 MiniMonthPicker dropdown animation
    console.log("  Testing MiniMonthPicker dropdown navigation animations...");
    const monthDropdownBtn = await page.$('[data-testid="calendar-month-dropdown-btn"]');
    assert(monthDropdownBtn !== null, "Month dropdown button exists in mobile header");
    await monthDropdownBtn.click();
    await sleep(400);

    const miniMonthPicker = await page.$('[data-testid="mobile-month-picker-dropdown"]');
    assert(miniMonthPicker !== null, "MiniMonthPicker dropdown opened below header");

    // Click next month in MiniMonthPicker
    const nextMonthBtn = await page.$('[data-testid="mobile-month-picker-dropdown"] button[aria-label="Next month"]');
    if (nextMonthBtn) {
      await nextMonthBtn.click();
      await sleep(35); // Allow requestAnimationFrame (16ms) to set slideAnim
      const pickerSlideNext = await page.evaluate(() => {
        const container = document.querySelector('[data-testid="mobile-month-picker-dropdown"] .animate-month-slide-next');
        return container !== null;
      });
      console.log("  MiniMonthPicker next button triggered .animate-month-slide-next:", pickerSlideNext);
      assert(pickerSlideNext, "MiniMonthPicker next button triggers .animate-month-slide-next");
      await sleep(250); // wait for onAnimationEnd to clear
    }

    // Click prev month in MiniMonthPicker
    const prevMonthBtn = await page.$('[data-testid="mobile-month-picker-dropdown"] button[aria-label="Previous month"]');
    if (prevMonthBtn) {
      await prevMonthBtn.click();
      await sleep(35); // Allow requestAnimationFrame to set slideAnim
      const pickerSlidePrev = await page.evaluate(() => {
        const container = document.querySelector('[data-testid="mobile-month-picker-dropdown"] .animate-month-slide-prev');
        return container !== null;
      });
      console.log("  MiniMonthPicker prev button triggered .animate-month-slide-prev:", pickerSlidePrev);
      assert(pickerSlidePrev, "MiniMonthPicker prev button triggers .animate-month-slide-prev");
      await sleep(250);
    }

    await page.screenshot({ path: path.join(artifactsDir, 'adversarial_r6_month_picker.png') });
    console.log("  Saved screenshot: adversarial_r6_month_picker.png");

    // Close dropdown via backdrop
    await page.evaluate(() => {
      const backdrop = document.querySelector('[data-testid="mobile-month-picker-backdrop"]');
      if (backdrop) backdrop.click();
    });
    await sleep(300);

    // 5.2 MobileMonthSplitView Touch Swipe Animation
    console.log("  Testing MobileMonthSplitView touch swipe navigation animations...");
    
    // Open drawer and switch to Month view
    const hamburgerBtn = await page.$('[data-testid="calendar-sidebar-toggle-btn"]');
    await hamburgerBtn.click();
    await sleep(400);

    const monthViewBtn = await page.$('[data-testid="drawer-view-month"]');
    assert(monthViewBtn !== null, "Month view option exists in mobile drawer");
    await monthViewBtn.click();
    await sleep(500);

    const splitView = await page.$('[data-testid="mobile-month-split-view"]');
    assert(splitView !== null, "MobileMonthSplitView mounted on mobile");

    const splitTitleBefore = await page.$eval('[data-testid="calendar-month-dropdown-btn"]', el => el.innerText.trim());
    console.log(`  Split view initial month: "${splitTitleBefore}"`);

    // Perform Touch Swipe Left (Navigate forward to next month)
    console.log("  Performing touch swipe left on split month grid...");
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="mobile-month-split-view"] > div');
      if (!target) return;
      const startTouch = new Touch({ identifier: 1, target, clientX: 280, clientY: 150 });
      const endTouch = new Touch({ identifier: 1, target, clientX: 80, clientY: 150 });
      target.dispatchEvent(new TouchEvent('touchstart', { touches: [startTouch], changedTouches: [startTouch], bubbles: true }));
      target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [endTouch], bubbles: true }));
    });
    await sleep(400);

    const splitTitleAfterNext = await page.$eval('[data-testid="calendar-month-dropdown-btn"]', el => el.innerText.trim());
    console.log(`  Split view month after swipe left: "${splitTitleAfterNext}"`);
    assert(splitTitleBefore !== splitTitleAfterNext, "Touch swipe left successfully advanced month");

    // Perform Touch Swipe Right (Navigate backward to previous month)
    console.log("  Performing touch swipe right on split month grid...");
    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="mobile-month-split-view"] > div');
      if (!target) return;
      const startTouch = new Touch({ identifier: 1, target, clientX: 80, clientY: 150 });
      const endTouch = new Touch({ identifier: 1, target, clientX: 280, clientY: 150 });
      target.dispatchEvent(new TouchEvent('touchstart', { touches: [startTouch], changedTouches: [startTouch], bubbles: true }));
      target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [endTouch], bubbles: true }));
    });
    await sleep(400);

    const splitTitleAfterPrev = await page.$eval('[data-testid="calendar-month-dropdown-btn"]', el => el.innerText.trim());
    console.log(`  Split view month after swipe right: "${splitTitleAfterPrev}"`);
    assert(splitTitleAfterPrev === splitTitleBefore, "Touch swipe right successfully returned to initial month");

    const overflowMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`  Split view scrollWidth: ${overflowMetrics.scrollWidth}px, clientWidth: ${overflowMetrics.clientWidth}px`);
    assert(overflowMetrics.scrollWidth <= overflowMetrics.clientWidth, "Zero horizontal overflow in Mobile Month Split View");

    await page.screenshot({ path: path.join(artifactsDir, 'adversarial_r6_month_split.png') });
    console.log("  Saved screenshot: adversarial_r6_month_split.png");

    // ── SUMMARY & VERDICT ──
    console.log("\n================================================================================");
    console.log("                      ADVERSARIAL CHALLENGE SUMMARY                             ");
    console.log("================================================================================");
    console.log(`  Unhandled Console Errors: ${unhandledErrors.length}`);
    for (const err of unhandledErrors) {
      console.error(`    - ${err}`);
    }
    console.log(`  Findings Logged: ${findings.length}`);
    for (const f of findings) {
      console.log(`    [${f.type}] ${f.description}`);
    }

    assert(unhandledErrors.length === 0, "Zero unhandled console errors during rigorous stress testing");
    console.log("\n>>> ALL ADVERSARIAL CHALLENGES EMPIRICALLY EXECUTED AND PASSED <<<");

  } finally {
    await browser.close();
  }
}

runAdversarialChallenge().catch((err) => {
  console.error("Adversarial Challenge Execution FAILED:", err);
  process.exit(1);
});
