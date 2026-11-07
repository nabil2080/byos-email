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

async function runMasterChallengerVerification() {
  console.log("================================================================================");
  console.log("     CHALLENGER 1: EMPIRICAL & STRESS VERIFICATION FOR R1, R5, R7, R8           ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();

  try {
    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 1: R7 Mobile FAB Alignment & R8 Mobile Modal Compression (375px)
    // ════════════════════════════════════════════════════════════════════════════
    console.log("--------------------------------------------------------------------------------");
    console.log(" PHASE 1: R7 (FAB Alignment) & R8 (Modal Compression) on Mobile (375px)");
    console.log("--------------------------------------------------------------------------------\n");

    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });

    console.log("--- [STEP 1] Login as Alice on 375px viewport ---");
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
    console.log("  Logged in successfully.");

    // Step 2: Measure Mobile Compose FAB
    console.log("\n--- [STEP 2] Inspect Mobile Compose FAB Metrics ---");
    await page.waitForSelector('[data-testid="mobile-compose-fab"]', { timeout: 10000 });
    const composeFabMetrics = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mobile-compose-fab"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        bottomOffset: Math.round(window.innerHeight - rect.bottom),
        rightOffset: Math.round(window.innerWidth - rect.right),
      };
    });

    console.log("  Compose FAB metrics:", JSON.stringify(composeFabMetrics, null, 2));
    assert(composeFabMetrics !== null, "Mobile Compose FAB exists in DOM");
    assert(composeFabMetrics.bottomOffset >= 60, "Compose FAB is floating above bottom navigation bar");
    const composeFabScreenshot = path.join(artifactsDir, 'challenger_r7_compose_fab.png');
    await page.screenshot({ path: composeFabScreenshot });
    console.log(`  Saved screenshot: ${composeFabScreenshot}`);

    // Step 3: Switch to Calendar and Measure Mobile Calendar FAB
    console.log("\n--- [STEP 3] Inspect Mobile Calendar FAB Metrics (R7) ---");
    await page.waitForSelector('[data-testid="bottom-nav-calendar-tab"]', { timeout: 10000 });
    await page.click('[data-testid="bottom-nav-calendar-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="mobile-calendar-fab"]', { timeout: 10000 });
    const calFabMetrics = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mobile-calendar-fab"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        bottomOffset: Math.round(window.innerHeight - rect.bottom),
        rightOffset: Math.round(window.innerWidth - rect.right),
        backgroundColor: style.backgroundColor,
      };
    });

    console.log("  Calendar FAB metrics:", JSON.stringify(calFabMetrics, null, 2));
    assert(calFabMetrics !== null, "Mobile Calendar FAB exists in DOM");
    assert(calFabMetrics.width === 48, `Calendar FAB width is exactly 48px (got ${calFabMetrics.width}px)`);
    assert(calFabMetrics.height === 48, `Calendar FAB height is exactly 48px (got ${calFabMetrics.height}px)`);

    const bottomDelta = Math.abs(calFabMetrics.bottomOffset - composeFabMetrics.bottomOffset);
    const rightDelta = Math.abs(calFabMetrics.rightOffset - composeFabMetrics.rightOffset);
    console.log(`  FAB vertical offset delta: ${bottomDelta}px (Calendar: ${calFabMetrics.bottomOffset}px, Compose: ${composeFabMetrics.bottomOffset}px)`);
    console.log(`  FAB horizontal offset delta: ${rightDelta}px (Calendar: ${calFabMetrics.rightOffset}px, Compose: ${composeFabMetrics.rightOffset}px)`);
    assert(bottomDelta <= 8, `Calendar FAB vertical offset (${calFabMetrics.bottomOffset}px) matches Compose FAB (${composeFabMetrics.bottomOffset}px) within containing-block margin`);

    const calFabScreenshot = path.join(artifactsDir, 'challenger_r7_calendar_fab.png');
    await page.screenshot({ path: calFabScreenshot });
    console.log(`  Saved screenshot: ${calFabScreenshot}`);

    // Step 4: R8 Modal Compression on Mobile
    console.log("\n--- [STEP 4] Verify Add Event Modal Initial Compression on Mobile (R8) ---");
    await page.evaluate(() => {
      const fab = document.querySelector('[data-testid="mobile-calendar-fab"]');
      if (fab) fab.click();
    });
    await sleep(800);

    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 10000 });
    const mobileModalInitial = await page.evaluate(() => {
      const titleInput = document.querySelector('[data-testid="event-title-input"]');
      const startDateInput = document.querySelector('[data-testid="event-start-date"]');
      const endDateInput = document.querySelector('[data-testid="event-end-date"]');
      const calSelect = document.querySelector('[data-testid="event-calendar-select"]');
      const moreBtn = document.querySelector('[data-testid="toggle-more-options-btn"]');
      const moreContainer = document.querySelector('[data-testid="more-options-container"]');
      const moreComputed = moreContainer ? window.getComputedStyle(moreContainer) : null;

      return {
        titleVisible: titleInput ? titleInput.offsetParent !== null : false,
        startDateVisible: startDateInput ? startDateInput.offsetParent !== null : false,
        endDateVisible: endDateInput ? endDateInput.offsetParent !== null : false,
        calendarSelectVisible: calSelect ? calSelect.offsetParent !== null : false,
        moreOptionsBtnVisible: moreBtn ? moreBtn.offsetParent !== null : false,
        moreOptionsBtnText: moreBtn ? moreBtn.innerText.trim() : null,
        moreOptionsAriaExpanded: moreBtn ? moreBtn.getAttribute('aria-expanded') : null,
        moreContainerMaxHeightClass: moreContainer ? moreContainer.className.includes('max-h-0') : false,
        moreContainerHeight: moreContainer ? moreContainer.offsetHeight : -1,
        moreContainerOpacity: moreComputed ? moreComputed.opacity : null,
        moreContainerPointerEvents: moreComputed ? moreComputed.pointerEvents : null,
      };
    });

    console.log("  Mobile modal initial compressed state:", JSON.stringify(mobileModalInitial, null, 2));
    assert(mobileModalInitial.titleVisible, "Title input is visible by default");
    assert(mobileModalInitial.startDateVisible, "Start Date input is visible by default");
    assert(mobileModalInitial.endDateVisible, "End Date input is visible by default");
    assert(mobileModalInitial.calendarSelectVisible, "Calendar select card is visible by default");
    assert(mobileModalInitial.moreOptionsBtnVisible, "'More options' toggle button is visible");
    assert(mobileModalInitial.moreOptionsAriaExpanded === "false", "'More options' aria-expanded is 'false' initially");
    assert(mobileModalInitial.moreContainerHeight === 0, "Secondary fields container height is 0px initially");
    assert(mobileModalInitial.moreContainerOpacity === "0", "Secondary fields container opacity is 0 initially");
    assert(mobileModalInitial.moreContainerPointerEvents === "none", "Secondary fields container has pointer-events: none initially");

    const compactMobileScreenshot = path.join(artifactsDir, 'challenger_r8_modal_compact_default.png');
    await page.screenshot({ path: compactMobileScreenshot });
    console.log(`  Saved screenshot: ${compactMobileScreenshot}`);

    // Close mobile modal
    await page.click('[data-testid="close-event-modal"]');
    await sleep(500);


    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 2: R1 Grid Continuity & R8 Desktop Modal Compression (1280x800)
    // ════════════════════════════════════════════════════════════════════════════
    console.log("\n--------------------------------------------------------------------------------");
    console.log(" PHASE 2: R1 Grid Continuity & R8 Desktop Modal Compression (1280x800)");
    console.log("--------------------------------------------------------------------------------\n");

    await page.setViewport({ width: 1280, height: 800, isMobile: false, hasTouch: false });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    // Navigate to Calendar
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1500);

    // Step 5: Desktop Modal Compression & Expansion
    console.log("--- [STEP 5] Verify Desktop Add Event Modal Compression & Expansion (R8) ---");
    await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-new-event-btn"]');
    await sleep(600);

    const desktopModalInitial = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="event-modal"]');
      const moreBtn = document.querySelector('[data-testid="toggle-more-options-btn"]');
      const moreC = document.querySelector('[data-testid="more-options-container"]');
      return {
        modalHeight: modal ? modal.offsetHeight : -1,
        moreOptionsText: moreBtn ? moreBtn.innerText.trim() : null,
        ariaExpanded: moreBtn ? moreBtn.getAttribute('aria-expanded') : null,
        moreContainerHeight: moreC ? moreC.offsetHeight : -1,
      };
    });

    console.log("  Desktop modal initial state:", JSON.stringify(desktopModalInitial, null, 2));
    assert(desktopModalInitial.ariaExpanded === "false", "Desktop modal 'More options' aria-expanded is 'false' initially");
    assert(desktopModalInitial.moreContainerHeight === 0, "Desktop secondary fields container height is 0px initially");
    const desktopCompactShot = path.join(artifactsDir, 'challenger_r8_desktop_modal_compact.png');
    await page.screenshot({ path: desktopCompactShot });
    console.log(`  Saved screenshot: ${desktopCompactShot}`);

    // Click "More options"
    await page.click('[data-testid="toggle-more-options-btn"]');
    await sleep(600);

    const desktopModalExpanded = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="event-modal"]');
      const moreBtn = document.querySelector('[data-testid="toggle-more-options-btn"]');
      const moreC = document.querySelector('[data-testid="more-options-container"]');
      const loc = document.querySelector('[data-testid="event-location-input"]');
      const desc = document.querySelector('[data-testid="event-description-input"]');
      return {
        modalHeight: modal ? modal.offsetHeight : -1,
        moreOptionsText: moreBtn ? moreBtn.innerText.trim() : null,
        ariaExpanded: moreBtn ? moreBtn.getAttribute('aria-expanded') : null,
        moreContainerHeight: moreC ? moreC.offsetHeight : -1,
        locationVisible: loc ? loc.offsetParent !== null : false,
        descriptionVisible: desc ? desc.offsetParent !== null : false,
      };
    });

    console.log("  Desktop modal expanded state:", JSON.stringify(desktopModalExpanded, null, 2));
    assert(desktopModalExpanded.ariaExpanded === "true", "Desktop modal 'More options' aria-expanded is 'true' after toggle");
    assert(desktopModalExpanded.moreContainerHeight > 100, `Desktop secondary container expanded (height: ${desktopModalExpanded.moreContainerHeight}px)`);
    assert(desktopModalExpanded.locationVisible, "Location input is visible when expanded");
    assert(desktopModalExpanded.descriptionVisible, "Description input is visible when expanded");

    const desktopExpandedShot = path.join(artifactsDir, 'challenger_r8_desktop_modal_expanded.png');
    await page.screenshot({ path: desktopExpandedShot });
    console.log(`  Saved screenshot: ${desktopExpandedShot}`);

    // Collapse and test auto-expansion on focus
    console.log("\n--- [STEP 6] Test onFocusIn Auto-Expansion on Secondary Field ---");
    await page.click('[data-testid="toggle-more-options-btn"]');
    await sleep(400);

    // Directly focus location input while container is collapsed
    await page.evaluate(() => {
      const loc = document.querySelector('[data-testid="event-location-input"]');
      if (loc) {
        loc.focus();
        loc.value = "Auditorium Room 204";
        loc.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(400);

    const autoExpandState = await page.evaluate(() => {
      const moreBtn = document.querySelector('[data-testid="toggle-more-options-btn"]');
      const moreC = document.querySelector('[data-testid="more-options-container"]');
      return {
        ariaExpanded: moreBtn ? moreBtn.getAttribute('aria-expanded') : null,
        hasExpandedClass: moreC ? moreC.className.includes('max-h-[3000px]') : false,
      };
    });
    assert(autoExpandState.ariaExpanded === "true", "onFocusIn auto-expanded aria-expanded to true");
    assert(autoExpandState.hasExpandedClass, "onFocusIn applied max-h-[3000px] expansion class");

    // Close modal cleanly after auto-expansion test
    await page.click('[data-testid="close-event-modal"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="event-modal"]') === null, { timeout: 5000 });
    assert(true, "Modal closed cleanly after auto-expansion test");

    // Step 7: R1 Day View Vertical Line Continuity
    console.log("\n--- [STEP 7] Stress-Test Day View Vertical Line Continuity (R1) ---");
    await page.keyboard.press('d');
    await sleep(800);

    await page.waitForSelector('[data-testid="day-timeline-left-gutter"]', { timeout: 5000 });
    const dayGutter = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const sp = el ? el.closest('.overflow-y-auto') : null;
      const style = window.getComputedStyle(el);
      return {
        styleHeight: el.style.height,
        offsetHeight: el.offsetHeight,
        scrollHeight: el.scrollHeight,
        borderRightWidth: style.borderRightWidth,
        borderRightStyle: style.borderRightStyle,
        parentScrollH: sp ? sp.scrollHeight : -1,
      };
    });

    console.log("  Day View gutter:", JSON.stringify(dayGutter, null, 2));
    assert(dayGutter.styleHeight === "1344px", "Day View gutter style.height is 1344px");
    assert(dayGutter.offsetHeight === 1344, "Day View gutter offsetHeight is 1344px");
    assert(dayGutter.borderRightWidth === "1px", "Day View gutter right border width is 1px");

    // Scroll to 00:00 (Top)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const sp = el.closest('.overflow-y-auto');
      if (sp) sp.scrollTop = 0;
    });
    await sleep(300);
    const dayTopShot = path.join(artifactsDir, 'challenger_r1_day_scroll_top_0000.png');
    await page.screenshot({ path: dayTopShot });
    console.log(`  Saved screenshot (Day Top 00:00): ${dayTopShot}`);

    // Scroll to 12:00 PM (Middle)
    console.log("  Scrolling Day View to 12:00 PM (scrollTop: 672px)...");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const sp = el.closest('.overflow-y-auto');
      if (sp) sp.scrollTop = 672;
    });
    await sleep(300);

    const dayMid = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const sp = el.closest('.overflow-y-auto');
      const rect = el.getBoundingClientRect();
      const parentRect = sp.getBoundingClientRect();
      return {
        scrollTop: sp.scrollTop,
        borderExtendsPastMidpoint: rect.bottom > parentRect.top + 300,
        gutterTotalHeight: el.offsetHeight,
      };
    });
    assert(dayMid.borderExtendsPastMidpoint, "Vertical dividing border extends continuously past 12:00 PM");
    assert(dayMid.gutterTotalHeight === 1344, "Gutter maintains full 1344px height while scrolled to 12 PM");
    const dayMidShot = path.join(artifactsDir, 'challenger_r1_day_scroll_mid_12pm.png');
    await page.screenshot({ path: dayMidShot });
    console.log(`  Saved screenshot (Day Mid 12:00 PM): ${dayMidShot}`);

    // Scroll to 23:00 (Bottom)
    console.log("  Scrolling Day View to 23:00 (bottom)...");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const sp = el.closest('.overflow-y-auto');
      if (sp) sp.scrollTop = sp.scrollHeight;
    });
    await sleep(300);
    const dayBottomShot = path.join(artifactsDir, 'challenger_r1_day_scroll_bottom_2300.png');
    await page.screenshot({ path: dayBottomShot });
    console.log(`  Saved screenshot (Day Bottom 23:00): ${dayBottomShot}`);

    // Step 8: R1 Week View Vertical Line Continuity
    console.log("\n--- [STEP 8] Stress-Test Week View Vertical Line Continuity (R1) ---");
    await page.keyboard.press('w');
    await sleep(800);

    await page.waitForSelector('[data-testid="week-timeline-left-gutter"]', { timeout: 5000 });
    const weekGutter = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="week-timeline-left-gutter"]');
      const style = window.getComputedStyle(el);
      return {
        styleHeight: el.style.height,
        offsetHeight: el.offsetHeight,
        borderRightWidth: style.borderRightWidth,
      };
    });

    console.log("  Week View gutter:", JSON.stringify(weekGutter, null, 2));
    assert(weekGutter.styleHeight === "1344px", "Week View gutter style.height is 1344px");
    assert(weekGutter.offsetHeight === 1344, "Week View gutter offsetHeight is 1344px");
    assert(weekGutter.borderRightWidth === "1px", "Week View gutter right border width is 1px");

    // Week Top (00:00)
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="week-timeline-left-gutter"]');
      const sp = el.closest('.overflow-y-auto');
      if (sp) sp.scrollTop = 0;
    });
    await sleep(300);
    const weekTopShot = path.join(artifactsDir, 'challenger_r1_week_scroll_top_0000.png');
    await page.screenshot({ path: weekTopShot });
    console.log(`  Saved screenshot (Week Top 00:00): ${weekTopShot}`);

    // Week Mid (12:00 PM)
    console.log("  Scrolling Week View to 12:00 PM (scrollTop: 672px)...");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="week-timeline-left-gutter"]');
      const sp = el.closest('.overflow-y-auto');
      if (sp) sp.scrollTop = 672;
    });
    await sleep(300);
    const weekMidShot = path.join(artifactsDir, 'challenger_r1_week_scroll_mid_12pm.png');
    await page.screenshot({ path: weekMidShot });
    console.log(`  Saved screenshot (Week Mid 12:00 PM): ${weekMidShot}`);

    // Week Bottom (23:00)
    console.log("  Scrolling Week View to 23:00 (bottom)...");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="week-timeline-left-gutter"]');
      const sp = el.closest('.overflow-y-auto');
      if (sp) sp.scrollTop = sp.scrollHeight;
    });
    await sleep(300);
    const weekBottomShot = path.join(artifactsDir, 'challenger_r1_week_scroll_bottom_2300.png');
    await page.screenshot({ path: weekBottomShot });
    console.log(`  Saved screenshot (Week Bottom 23:00): ${weekBottomShot}`);


    // ════════════════════════════════════════════════════════════════════════════
    // PHASE 3: R5 Timezone Prompt Banner Brand Styling Stress Test
    // ════════════════════════════════════════════════════════════════════════════
    console.log("\n--------------------------------------------------------------------------------");
    console.log(" PHASE 3: R5 Timezone Prompt Banner Brand Styling & Palette Verification");
    console.log("--------------------------------------------------------------------------------\n");

    console.log("--- [STEP 9] Trigger Timezone Prompt Banner ---");
    await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const settingsKey = keys.find(k => k.startsWith('byos_calendar_settings_')) || 'byos_calendar_settings_global';
      let currentSettings = {};
      try {
        currentSettings = JSON.parse(localStorage.getItem(settingsKey) || '{}');
      } catch {}

      currentSettings.autoUpdateTimeZoneWithConsent = true;
      currentSettings.primaryTimeZone = "Europe/London";
      localStorage.setItem(settingsKey, JSON.stringify(currentSettings));
    });

    // Mock Intl.DateTimeFormat for R5 Timezone Prompt verification
    await page.evaluateOnNewDocument(() => {
      const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions = function() {
        const opts = originalResolvedOptions.call(this);
        return { ...opts, timeZone: "Asia/Dhaka" };
      };
    });

    // Reload page to re-read calendar settings with mocked Intl timezone
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    // Switch to Calendar tab where banner is mounted
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="calendar-travel-timezone-banner"]', { timeout: 10000 });
    assert(true, "Timezone consent banner is rendering in the DOM");

    console.log("\n--- [STEP 10] DOM & CSS Inspection for Residual Blue Styles (R5) ---");
    const bannerInspection = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="calendar-travel-timezone-banner"]');
      if (!banner) return null;

      const acceptBtn = document.querySelector('[data-testid="accept-travel-tz-btn"]');
      const dismissBtn = document.querySelector('[data-testid="dismiss-travel-tz-btn"]');
      const icon = banner.querySelector('svg');

      const allElements = [banner, ...Array.from(banner.querySelectorAll('*'))];
      const allClasses = allElements.flatMap(el => Array.from(el.classList));
      const blueClasses = allClasses.filter(c =>
        c.includes('sky-') ||
        c.includes('blue-') ||
        c.includes('cyan-') ||
        c.includes('indigo-')
      );

      const bannerComputed = window.getComputedStyle(banner);
      const acceptComputed = acceptBtn ? window.getComputedStyle(acceptBtn) : null;
      const dismissComputed = dismissBtn ? window.getComputedStyle(dismissBtn) : null;
      const iconComputed = icon ? window.getComputedStyle(icon) : null;

      return {
        bannerText: banner.innerText.replace(/\s+/g, ' ').trim(),
        totalElementsInBanner: allElements.length,
        blueClassOccurrences: blueClasses,
        bannerBackgroundColor: bannerComputed.backgroundColor,
        bannerBorderBottomColor: bannerComputed.borderBottomColor,
        bannerColor: bannerComputed.color,
        acceptBtnBackgroundColor: acceptComputed ? acceptComputed.backgroundColor : null,
        acceptBtnColor: acceptComputed ? acceptComputed.color : null,
        dismissBtnBackgroundColor: dismissComputed ? dismissComputed.backgroundColor : null,
        dismissBtnBorderColor: dismissComputed ? dismissComputed.borderColor : null,
        iconColor: iconComputed ? iconComputed.color : null,
      };
    });

    console.log("  Banner inspection details:", JSON.stringify(bannerInspection, null, 2));

    assert(
      bannerInspection.bannerText.includes("Your device appears to be in Asia/Dhaka") &&
      (bannerInspection.bannerText.includes("UTC") || bannerInspection.bannerText.includes("Europe/London")),
      "Banner text accurately presents timezone prompt (Asia/Dhaka vs primary time zone)"
    );

    assert(
      bannerInspection.blueClassOccurrences.length === 0,
      `All blue/sky Tailwind classes are 100% eliminated (found: ${JSON.stringify(bannerInspection.blueClassOccurrences)})`
    );

    const isWarmBg =
      bannerInspection.bannerBackgroundColor === "rgb(240, 238, 233)" ||
      bannerInspection.bannerBackgroundColor === "rgb(30, 32, 37)";
    assert(isWarmBg, `Banner background color is strictly warm (#F0EEE9 / #1E2025): ${bannerInspection.bannerBackgroundColor}`);

    assert(
      bannerInspection.acceptBtnBackgroundColor === "rgb(158, 114, 95)",
      `Accept button background strictly matches brand mocha #9E725F: ${bannerInspection.acceptBtnBackgroundColor}`
    );

    const isWarmIcon =
      bannerInspection.iconColor === "rgb(158, 114, 95)" ||
      bannerInspection.iconColor === "rgb(212, 163, 143)";
    assert(isWarmIcon, `Globe icon color strictly adheres to warm brand palette: ${bannerInspection.iconColor}`);

    const bannerScreenshot = path.join(artifactsDir, 'challenger_r5_timezone_banner_warm.png');
    await page.screenshot({ path: bannerScreenshot });
    console.log(`  Saved screenshot (Warm Timezone Banner): ${bannerScreenshot}`);

    // Step 11: Test Banner Dismissal
    console.log("\n--- [STEP 11] Test Banner Dismiss Action ---");
    await page.click('[data-testid="dismiss-travel-tz-btn"]');
    await sleep(400);
    const bannerAfterDismiss = await page.$('[data-testid="calendar-travel-timezone-banner"]');
    assert(bannerAfterDismiss === null, "Banner is cleanly dismissed from DOM on clicking 'Keep Europe/London'");

    console.log("\n================================================================================");
    console.log("       ALL EMPIRICAL CHALLENGER STRESS VERIFICATIONS PASSED SUCCESSFULLY        ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runMasterChallengerVerification().catch((err) => {
  console.error("\nFATAL ERROR IN CHALLENGER VERIFICATION:", err);
  process.exit(1);
});
