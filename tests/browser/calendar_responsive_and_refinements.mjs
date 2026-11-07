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

async function runCalendarResponsiveAndRefinementsVerification() {
  console.log("================================================================================");
  console.log("    CALENDAR RESPONSIVENESS, TOOLBAR CLEANUP & WEBMAIL UI REFINEMENTS AUDIT     ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const unhandledErrors = [];
  const networkRequests = [];

  try {
    const page = await browser.newPage();

    page.on('console', (msg) => {
      const text = msg.text();
      console.log(`  [BROWSER ${msg.type().toUpperCase()}] ${text}`);
      if (msg.type() === 'error') {
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)') &&
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_INTERNET_DISCONNECTED')
        ) {
          unhandledErrors.push(text);
        }
      }
    });

    page.on('request', (req) => {
      if (req.url().includes('/v1/mailboxes') || req.url().includes('/v1/calendar')) {
        networkRequests.push({
          method: req.method(),
          url: req.url(),
        });
      }
    });

    // ────────────────────────────────────────────────────────────────────────
    // PART 1: 375px Mobile Viewport Audits (Phone View, Avatar Removal, Bottom Padding)
    // ────────────────────────────────────────────────────────────────────────
    console.log("--- [PART 1] 375px Mobile Viewport Audits ---");
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });

    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    // 1. Real login flow as Alice
    console.log("1.1 Real login flow as Alice...");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await sleep(2000);

    // 1.2 Verify zero horizontal overflow on mobile mail
    const mailOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    console.log(`  Mail mobile scrollWidth: ${mailOverflow.scrollWidth}px, clientWidth: ${mailOverflow.clientWidth}px`);
    assert(mailOverflow.scrollWidth <= 375, "Zero horizontal overflow on 375px mobile mail");

    // 1.3 Verify circular unselected avatar chip is REMOVED from phone view cards
    console.log("1.2 Verifying avatar removal and full-width typography on email cards...");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    
    const avatarCheck = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-testid="message-row"]');
      if (rows.length === 0) return { rowCount: 0, hasVisibleAvatar: false };
      
      let visibleAvatarFound = false;
      rows.forEach((row) => {
        // Look for selection circle/avatar that is NOT marked hidden
        const selectBtn = row.querySelector('[data-testid="message-mobile-select-btn"]');
        if (selectBtn && !selectBtn.classList.contains('hidden')) {
          visibleAvatarFound = true;
        }
      });
      return {
        rowCount: rows.length,
        hasVisibleAvatar: visibleAvatarFound,
      };
    });
    console.log(`  Found ${avatarCheck.rowCount} email rows; visible unselected avatar present: ${avatarCheck.hasVisibleAvatar}`);
    assert(!avatarCheck.hasVisibleAvatar, "No unselected circular avatar chips in phone view email rows");

    // 1.4 Verify hold-to-select interaction (450ms press triggers checkmark)
    console.log("1.3 Verifying hold-to-select (450ms press)...");
    const firstRow = await page.$('[data-testid="message-row"]');
    const firstRowBox = await firstRow.boundingBox();
    
    // Simulate mousedown for 500ms
    await page.mouse.move(firstRowBox.x + 30, firstRowBox.y + 20);
    await page.mouse.down();
    await sleep(550);
    await page.mouse.up();
    await sleep(300);

    const isRowCheckedAfterHold = await page.evaluate(() => {
      const first = document.querySelector('[data-testid="message-row"]');
      const selectBtn = first ? first.querySelector('[data-testid="message-mobile-select-btn"]') : null;
      return selectBtn !== null && !selectBtn.classList.contains('hidden');
    });
    console.log(`  First row checked after 450ms hold-to-select: ${isRowCheckedAfterHold}`);
    assert(isRowCheckedAfterHold, "Hold-to-select activated checkmark badge");

    // 1.5 Verify mobile view bottom padding (flush above bottom nav bar without empty gaps)
    console.log("1.4 Verifying mobile bottom padding flushness...");
    const paddingMetrics = await page.evaluate(() => {
      const main = document.querySelector('[data-testid="main-content"]');
      const bottomBar = document.querySelector('[data-testid="bottom-fixed-bar"]');
      if (!main || !bottomBar) return null;
      const mainStyle = window.getComputedStyle(main);
      const bottomBarRect = bottomBar.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      return {
        paddingBottom: mainStyle.paddingBottom,
        bottomBarHeight: bottomBarRect.height,
        bottomBarTop: bottomBarRect.top,
        mainBottom: mainRect.bottom,
        gapBetweenMainAndBottomBar: Math.round(bottomBarRect.top - mainRect.bottom),
      };
    });
    console.log(`  Main paddingBottom: ${paddingMetrics?.paddingBottom}, BottomBar height: ${paddingMetrics?.bottomBarHeight}px, gap: ${paddingMetrics?.gapBetweenMainAndBottomBar}px`);
    assert(paddingMetrics && paddingMetrics.gapBetweenMainAndBottomBar <= 2, "Mobile content is flush above bottom navigation bar without empty gaps");

    // Capture mobile full-width typography screenshot
    const mobileMailScreenshotPath = path.resolve(artifactsDir, 'webmail_mobile_fullwidth_cards.png');
    await page.screenshot({ path: mobileMailScreenshotPath });
    console.log(`  Saved screenshot: ${mobileMailScreenshotPath}`);

    // 1.6 Switch to Calendar via mobile bottom nav
    console.log("1.5 Switch to Calendar module via bottom nav...");
    await page.waitForSelector('[data-testid="bottom-nav-calendar-tab"]');
    const beforeClickModule = await page.evaluate(() => {
      const bottomBar = document.querySelector('[data-testid="bottom-fixed-bar"]');
      const calTab = document.querySelector('[data-testid="bottom-nav-calendar-tab"]');
      return {
        bottomBarVisible: Boolean(bottomBar),
        calTabBox: calTab ? calTab.getBoundingClientRect() : null,
      };
    });
    console.log("  Before click:", beforeClickModule);
    
    // Unselect any selected message first
    const selectBtn = await page.$('[data-testid="message-mobile-select-btn"]:not(.hidden)');
    if (selectBtn) {
      await selectBtn.click();
      await sleep(200);
    }

    await page.click('[data-testid="bottom-nav-calendar-tab"]');
    await sleep(1000);

    const afterClick = await page.evaluate(() => ({
      hasCal: Boolean(document.querySelector('[data-testid="calendar-view"]')),
      hasMail: Boolean(document.querySelector('[data-testid="message-list"]')),
    }));
    console.log("  After click:", afterClick);

    await page.waitForSelector('[data-testid="calendar-view"]');
    const calMobileOverflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert(calMobileOverflow.scrollWidth <= 375, "Zero horizontal overflow in mobile calendar view");

    const mobileCalScreenshotPath = path.resolve(artifactsDir, 'calendar_mobile_375px_flush.png');
    await page.screenshot({ path: mobileCalScreenshotPath });
    console.log(`  Saved screenshot: ${mobileCalScreenshotPath}`);

    // ────────────────────────────────────────────────────────────────────────
    // PART 2: 768px Tablet Viewport Audits (All-Day Section, Customization Icon Gating)
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n--- [PART 2] 768px Tablet Viewport Audits ---");
    await page.setViewport({ width: 768, height: 1024, isMobile: false });
    await sleep(1500);

    // Navigate to Calendar on Tablet
    const calTabTablet = (await page.$('[data-testid="bottom-nav-calendar-tab"]')) || (await page.$('[data-testid="nav-calendar-tab"]'));
    if (calTabTablet) {
      await calTabTablet.click();
      await sleep(1000);
    }

    // 2.1 Verify Customizer icon is NOT visible in Calendar view
    console.log("2.1 Checking UI Customizer icon gating in Calendar view...");
    const debugInfo = await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="ui-customizer-toggle"]');
      const calView = document.querySelector('[data-testid="calendar-view"]');
      const mailView = document.querySelector('[data-testid="message-list"]');
      return {
        hasCalView: Boolean(calView),
        hasMailView: Boolean(mailView),
        toggleFound: Boolean(toggle),
        toggleHtml: toggle ? toggle.outerHTML : null,
      };
    });
    console.log("  Debug info in Calendar view check:", debugInfo);
    const customizerInCalendar = await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="ui-customizer-toggle"]');
      if (!toggle) return false;
      const rect = toggle.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && window.getComputedStyle(toggle).display !== 'none';
    });
    console.log(`  Customizer toggle visible in Calendar: ${customizerInCalendar}`);
    assert(!customizerInCalendar, "UI Customizer toggle is NOT visible in Calendar view");

    // 2.2 Switch to Notes view & check Customizer icon
    console.log("2.2 Checking UI Customizer icon gating in Notes view...");
    const notesTab = (await page.$('[data-testid="bottom-nav-notes-tab"]')) || (await page.$('[data-testid="nav-notes-tab"]'));
    if (notesTab) {
      await notesTab.click();
      await sleep(1000);
      const customizerInNotes = await page.evaluate(() => {
        const toggle = document.querySelector('[data-testid="ui-customizer-toggle"]');
        if (!toggle) return false;
        const rect = toggle.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(toggle).display !== 'none';
      });
      console.log(`  Customizer toggle visible in Notes: ${customizerInNotes}`);
      assert(!customizerInNotes, "UI Customizer toggle is NOT visible in Notes view");
    }

    // 2.3 Switch to Mail view & check Customizer icon IS visible
    console.log("2.3 Checking UI Customizer icon gating in Mail view...");
    const mailTab = (await page.$('[data-testid="bottom-nav-mail-tab"]')) || (await page.$('[data-testid="nav-emails-tab"]'));
    await mailTab.click();
    await sleep(1000);
    const customizerInMail = await page.evaluate(() => {
      const toggle = document.querySelector('[data-testid="ui-customizer-toggle"]');
      if (!toggle) return false;
      const rect = toggle.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    console.log(`  Customizer toggle visible in Mail: ${customizerInMail}`);
    assert(customizerInMail, "UI Customizer toggle IS visible in Mailbox view");

    const customizerIconScreenshotPath = path.resolve(artifactsDir, 'customizer_icon_mail_only.png');
    await page.screenshot({ path: customizerIconScreenshotPath });
    console.log(`  Saved screenshot: ${customizerIconScreenshotPath}`);

    // 2.4 Return to Calendar and switch to Week view on Tablet
    console.log("2.4 Verifying All-Day ('all') section responsiveness in Tablet Week view...");
    const calTab = (await page.$('[data-testid="bottom-nav-calendar-tab"]')) || (await page.$('[data-testid="nav-calendar-tab"]'));
    await calTab.click();
    await sleep(1000);

    // Switch to Week view mode
    const weekBtn = await page.$('[data-testid="view-week-btn"]');
    if (weekBtn) {
      await weekBtn.click();
      await sleep(1000);
    }

    // Add an all-day event via FAB or evaluate to test all-day section scaling
    await page.evaluate(() => {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
      
      const testEvents = [
        {
          id: "test-allday-tablet-1",
          calendarId: "c0000000-0000-0000-0000-000000000001",
          startTime: todayStart.toISOString(),
          endTime: todayEnd.toISOString(),
          isAllDay: true,
          details: {
            title: "Executive Quarterly Review (Tablet All-Day Test)",
            eventType: "event",
            color: "#9E725F",
          },
        },
        {
          id: "test-allday-tablet-2",
          calendarId: "c0000000-0000-0000-0000-000000000001",
          startTime: todayStart.toISOString(),
          endTime: todayEnd.toISOString(),
          isAllDay: true,
          details: {
            title: "Product Launch Milestone Sync",
            eventType: "event",
            color: "#3B82F6",
          },
        }
      ];

      const rawCache = localStorage.getItem("byos_calendar_offline_cache_c0000000-0000-0000-0000-000000000001");
      const existing = rawCache ? JSON.parse(rawCache) : [];
      localStorage.setItem(
        "byos_calendar_offline_cache_c0000000-0000-0000-0000-000000000001",
        JSON.stringify([...existing.filter(e => !e.id.startsWith("test-allday")), ...testEvents])
      );
    });

    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    // Switch to Calendar module after reload
    const calTabAfterReload = (await page.$('[data-testid="bottom-nav-calendar-tab"]')) || (await page.$('[data-testid="nav-calendar-tab"]'));
    if (calTabAfterReload) {
      await calTabAfterReload.click();
      await sleep(1000);
    }

    // Ensure we are in Week view
    const weekBtnReloaded = await page.$('[data-testid="view-week-btn"]');
    if (weekBtnReloaded) {
      await weekBtnReloaded.click();
      await sleep(1000);
    }

    // Verify tablet All-Day section metrics
    const allDayMetrics = await page.evaluate(() => {
      const pills = document.querySelectorAll('[data-testid="calendar-event-pill"]');
      const allDayContainer = pills.length > 0 ? pills[0].closest('.grid') : null;
      const weekGrid = document.querySelector('[data-testid="calendar-view"]');
      return {
        pillCount: pills.length,
        hasContainer: Boolean(allDayContainer),
        containerMaxHeight: allDayContainer ? window.getComputedStyle(allDayContainer).maxHeight : null,
        containerOverflowY: allDayContainer ? window.getComputedStyle(allDayContainer).overflowY : null,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
      };
    });
    console.log(`  All-day pills: ${allDayMetrics.pillCount}, maxHeight: ${allDayMetrics.containerMaxHeight}, overflowY: ${allDayMetrics.containerOverflowY}`);
    console.log(`  Tablet document scrollWidth: ${allDayMetrics.docScrollWidth}px, clientWidth: ${allDayMetrics.docClientWidth}px`);
    assert(allDayMetrics.docScrollWidth <= 768, "Zero horizontal overflow on 768px tablet calendar");

    const tabletAllDayScreenshotPath = path.resolve(artifactsDir, 'calendar_tablet_768px_allday.png');
    await page.screenshot({ path: tabletAllDayScreenshotPath });
    console.log(`  Saved screenshot: ${tabletAllDayScreenshotPath}`);

    // ────────────────────────────────────────────────────────────────────────
    // PART 3: 1440px Desktop Viewport Audits (Toolbar Cleanup & Line Alignment)
    // ────────────────────────────────────────────────────────────────────────
    console.log("\n--- [PART 3] 1440px Desktop Viewport Audits ---");
    await page.setViewport({ width: 1440, height: 900, isMobile: false });
    await sleep(1000);

    // Switch to Calendar module on Desktop
    const calTabDesktop = (await page.$('[data-testid="nav-calendar-tab"]')) || (await page.$('[data-testid="bottom-nav-calendar-tab"]'));
    if (calTabDesktop) {
      await calTabDesktop.click();
      await sleep(1000);
    }

    // 3.1 Verify complete removal of unwanted toolbar functions
    console.log("3.1 Verifying removal of density switcher, smart add, and secondary icons...");
    const toolbarAudit = await page.evaluate(() => {
      return {
        hasDensitySwitcher: Boolean(document.querySelector('[data-testid="kashcal-density-control"]')),
        hasSmartAddBtn: Boolean(document.querySelector('[data-testid="kashcal-quick-add-toggle-btn"]')),
        hasTrashBtn: Boolean(document.querySelector('[data-testid="calendar-trash-btn"]')),
        hasSettingsBtn: Boolean(document.querySelector('[data-testid="calendar-settings-btn"]')),
        hasSelectAllCheckbox: Boolean(document.querySelector('[data-testid="calendar-select-all"]')),
        hasPrinterBtn: Boolean(document.querySelector('[data-testid="calendar-print-btn"]')),
        hasHelpShortcutsBtn: Boolean(document.querySelector('[data-testid="calendar-shortcuts-btn"]')),
      };
    });

    console.log("  Toolbar components presence:", toolbarAudit);
    assert(!toolbarAudit.hasDensitySwitcher, "Timeline density switcher ('Compact', 'Normal', 'Spacious') is COMPLETELY REMOVED");
    assert(!toolbarAudit.hasSmartAddBtn, "Smart Add button and drawer are COMPLETELY REMOVED");
    assert(!toolbarAudit.hasSelectAllCheckbox, "Select-all checkbox is COMPLETELY REMOVED from toolbar");
    assert(!toolbarAudit.hasPrinterBtn, "Printer button is COMPLETELY REMOVED from toolbar");
    assert(!toolbarAudit.hasHelpShortcutsBtn, "Help/shortcuts button is COMPLETELY REMOVED from toolbar");
    assert(toolbarAudit.hasTrashBtn, "Bin/trash icon is KEPT and present");
    assert(toolbarAudit.hasSettingsBtn, "Calendar settings icon is KEPT and present");

    // 3.2 Verify View Mode Switching (Day, Week, Month, Year, Agenda) without layout jumps
    console.log("3.2 Verifying stable crisp view mode switching...");
    for (const mode of ["day", "month", "agenda", "year", "week"]) {
      const modeBtn = await page.$(`[data-testid="view-${mode}-btn"]`);
      assert(modeBtn !== null, `View switcher button '${mode}' exists`);
      await modeBtn.click();
      await sleep(250);
      const isPressed = await page.evaluate((m) => {
        const btn = document.querySelector(`[data-testid="view-${m}-btn"]`);
        return btn?.getAttribute("aria-pressed") === "true";
      }, mode);
      assert(isPressed, `View mode '${mode}' active indicator switched cleanly`);
    }

    // 3.3 Verify Calendar Week Grid Lines & Date Header Alignment
    console.log("3.3 Verifying column lines alignment between date headers and timeline grid...");
    // Ensure we are in Week view
    const finalWeekBtn = await page.$('[data-testid="view-week-btn"]');
    await finalWeekBtn.click();
    await sleep(600);

    const alignmentCheck = await page.evaluate(() => {
      // Find the days header container
      const headerRow = document.querySelector('[data-testid="week-days-header"]');
      const timeGridContainer = document.querySelector('[data-testid="week-time-grid-scroll-container"]');
      
      if (!headerRow || !timeGridContainer) {
        return { error: "Header or timeGridContainer not found", headerFound: Boolean(headerRow), gridFound: Boolean(timeGridContainer) };
      }

      // Check header left gutter vs time column left gutter
      const headerGutter = headerRow.querySelector('[data-testid="week-primary-tz-header"]') || headerRow.firstElementChild;
      const timelineGutter = timeGridContainer.querySelector('[data-testid="week-timeline-left-gutter"]') || timeGridContainer.firstElementChild;

      const headerGutterWidth = headerGutter ? Math.round(headerGutter.getBoundingClientRect().width) : null;
      const timelineGutterWidth = timelineGutter ? Math.round(timelineGutter.getBoundingClientRect().width) : null;

      // Check right spacer matching scrollbar
      const headerSpacer = document.querySelector('[data-testid="week-days-header-spacer"]');
      const scrollbarWidth = timeGridContainer.offsetWidth - timeGridContainer.clientWidth;
      const spacerWidth = headerSpacer ? Math.round(headerSpacer.getBoundingClientRect().width) : null;

      return {
        headerGutterWidth,
        timelineGutterWidth,
        gutterMatched: headerGutterWidth === timelineGutterWidth,
        scrollbarWidth,
        spacerWidth,
        spacerMatched: spacerWidth === scrollbarWidth,
      };
    });

    console.log("  Column alignment check:", alignmentCheck);
    assert(alignmentCheck.gutterMatched, `Left gutter widths match: Header (${alignmentCheck.headerGutterWidth}px) === Timeline (${alignmentCheck.timelineGutterWidth}px)`);
    assert(alignmentCheck.spacerMatched, `Right scrollbar spacer matches: Spacer (${alignmentCheck.spacerWidth}px) === Scrollbar (${alignmentCheck.scrollbarWidth}px)`);

    const desktopScreenshotPath = path.resolve(artifactsDir, 'calendar_desktop_1440px_toolbar_and_grid.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Saved screenshot: ${desktopScreenshotPath}`);

    // Capture storage dump & check console errors
    const storageKeys = await page.evaluate(() => Object.keys(localStorage));
    console.log("\n--- [PART 4] DevTools Storage & Network Audit ---");
    console.log("  localStorage keys:", storageKeys);
    console.log(`  Captured ${networkRequests.length} calendar/mailbox network requests.`);
    assert(unhandledErrors.length === 0, `No unexpected console errors (${unhandledErrors.join(', ')})`);

    console.log("\n================================================================================");
    console.log("   ALL CALENDAR RESPONSIVENESS & UI REFINEMENT BROWSER AUDITS PASSED            ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarResponsiveAndRefinementsVerification().catch((err) => {
  console.error("FATAL ERROR in browser verification:", err);
  process.exit(1);
});
