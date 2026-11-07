/**
 * ============================================================================
 * Verification Test: Calendar Line Continuity, Travel Banner, Mobile Header &
 * Month Slide Animation, Reading Pane Standard Actions
 * ============================================================================
 */

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

async function runVerification() {
  console.log("================================================================================");
  console.log("    CALENDAR LINE CONTINUITY, TRAVEL BANNER, ANIMATION & READING TOOLBAR AUDIT   ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // 1. Login as Alice
    console.log("--- 1. Authentication & Navigation ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await sleep(1500);

    // 2. Reading Pane Action Toolbar Audit (Standard 4 Icons + More Menu)
    console.log("\n--- 2. Reading Pane Action Toolbar Standards ---");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    await page.click('[data-testid="message-row"]');
    await sleep(600);

    const readingPaneActions = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      if (!pane) return null;
      const archiveBtn = pane.querySelector('button[aria-label="Archive message"]');
      const trashBtn = pane.querySelector('button[aria-label="Move to trash"]');
      const readBtn = pane.querySelector('button[aria-label="Mark as read"], button[aria-label="Mark as unread"]');
      const starBtn = pane.querySelector('button[aria-label="Star message"], button[aria-label="Unstar message"]');
      const moreBtn = pane.querySelector('[data-testid="reading-pane-overflow-btn"]');
      
      return {
        hasArchive: archiveBtn !== null,
        hasTrash: trashBtn !== null,
        hasReadToggle: readBtn !== null,
        hasStar: starBtn !== null,
        hasMoreMenu: moreBtn !== null,
      };
    });

    console.log("  Reading Pane Toolbar Actions:", readingPaneActions);
    assert(readingPaneActions?.hasArchive, "Reading pane contains standard Archive action");
    assert(readingPaneActions?.hasTrash, "Reading pane contains standard Move to Trash action");
    assert(readingPaneActions?.hasReadToggle, "Reading pane contains standard Mark Read/Unread action");
    assert(readingPaneActions?.hasStar, "Reading pane contains standard Star action");
    assert(readingPaneActions?.hasMoreMenu, "Reading pane contains standard More Actions (...) overflow button");

    const readingScreenshot = path.resolve(artifactsDir, 'reading_pane_standard_toolbar.png');
    await page.screenshot({ path: readingScreenshot });
    console.log(`  Saved screenshot: ${readingScreenshot}`);

    // 3. Switch to Calendar & Verify Hour Grid Line Continuity
    console.log("\n--- 3. Calendar Grid Line Continuity (Week & Day Views) ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 8000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1200);

    const weekGridAudit = await page.evaluate(() => {
      const gutter = document.querySelector('[data-testid="week-timeline-left-gutter"]');
      const slots = document.querySelectorAll('[data-testid="week-timeline-left-gutter"] ~ div .group\\/slot');
      const computedGutter = gutter ? window.getComputedStyle(gutter) : null;
      
      let allSlotsHaveBottomBorder = true;
      slots.forEach((s) => {
        const c = window.getComputedStyle(s);
        if (!c.borderBottomWidth || c.borderBottomWidth === '0px') {
          allSlotsHaveBottomBorder = false;
        }
      });

      return {
        hasGutter: gutter !== null,
        gutterBorderRight: computedGutter?.borderRight,
        gutterZIndex: computedGutter?.zIndex,
        slotCount: slots.length,
        allSlotsHaveBottomBorder,
      };
    });

    console.log("  Week View Grid Line Audit:", weekGridAudit);
    assert(weekGridAudit.hasGutter, "Week timeline gutter is present");
    assert(weekGridAudit.gutterBorderRight.includes('rgb(226, 223, 216)'), "Week gutter has continuous vertical divider border");
    assert(weekGridAudit.gutterZIndex === '10', "Week gutter has z-index 10 to prevent slot border overlap");
    assert(weekGridAudit.allSlotsHaveBottomBorder, "All week day slots have continuous horizontal bottom borders");

    // Switch to Day View and check continuity
    const dayBtn = await page.waitForSelector('[data-testid="view-day-btn"]', { timeout: 5000 });
    await dayBtn.click();
    await sleep(800);

    const dayGridAudit = await page.evaluate(() => {
      const gutter = document.querySelector('[data-testid="day-timeline-left-gutter"]');
      const slots = document.querySelectorAll('.group\\/slot');
      const computedGutter = gutter ? window.getComputedStyle(gutter) : null;

      let allSlotsHaveBottomBorder = true;
      slots.forEach((s) => {
        const c = window.getComputedStyle(s);
        if (!c.borderBottomWidth || c.borderBottomWidth === '0px') {
          allSlotsHaveBottomBorder = false;
        }
      });

      return {
        hasGutter: gutter !== null,
        gutterBorderRight: computedGutter?.borderRight,
        gutterZIndex: computedGutter?.zIndex,
        slotCount: slots.length,
        allSlotsHaveBottomBorder,
      };
    });

    console.log("  Day View Grid Line Audit:", dayGridAudit);
    assert(dayGridAudit.hasGutter, "Day timeline gutter is present");
    assert(dayGridAudit.gutterBorderRight.includes('rgb(226, 223, 216)'), "Day gutter has continuous vertical divider border");
    assert(dayGridAudit.gutterZIndex === '10', "Day gutter has z-index 10 to prevent slot border overlap");
    assert(dayGridAudit.allSlotsHaveBottomBorder, "All day slots have continuous horizontal bottom borders");

    const lineContinuityScreenshot = path.resolve(artifactsDir, 'calendar_hour_line_continuity.png');
    await page.screenshot({ path: lineContinuityScreenshot });
    console.log(`  Saved screenshot: ${lineContinuityScreenshot}`);

    // 4. Timezone Suggestion Banner Design Tokens & Colors Audit
    console.log("\n--- 4. Travel / Timezone Banner Design Tokens & Palette ---");
    // Trigger travel banner by setting primaryTimeZone to Europe/London when browser detects different timezone
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('byos_calendar_settings') || '{}');
      settings.primaryTimeZone = 'Europe/London';
      localStorage.setItem('byos_calendar_settings', JSON.stringify(settings));
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);
    // Switch to calendar
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 8000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1000);

    const bannerAudit = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="calendar-travel-timezone-banner"]');
      if (!banner) return { hasBanner: false };
      const comp = window.getComputedStyle(banner);
      const acceptBtn = banner.querySelector('[data-testid="accept-travel-tz-btn"]');
      const dismissBtn = banner.querySelector('[data-testid="dismiss-travel-tz-btn"]');
      const compAccept = acceptBtn ? window.getComputedStyle(acceptBtn) : null;
      const compDismiss = dismissBtn ? window.getComputedStyle(dismissBtn) : null;

      return {
        hasBanner: true,
        bgColor: comp.backgroundColor,
        borderBottom: comp.borderBottom,
        acceptBgColor: compAccept?.backgroundColor,
        acceptTextColor: compAccept?.color,
        acceptBorderRadius: compAccept?.borderRadius,
        dismissBgColor: compDismiss?.backgroundColor,
      };
    });

    console.log("  Travel Banner Style Audit:", bannerAudit);
    assert(bannerAudit.hasBanner, "Travel / Timezone update consent banner is visible");
    // #FAF9F5 is rgb(250, 249, 245)
    assert(bannerAudit.bgColor.includes('250, 249, 245'), "Banner uses canvas palette rgb(250, 249, 245)");
    // #9E725F is rgb(158, 114, 95)
    assert(bannerAudit.acceptBgColor.includes('158, 114, 95'), "Accept button uses mocha accent rgb(158, 114, 95)");

    const bannerScreenshot = path.resolve(artifactsDir, 'calendar_travel_timezone_banner_warm.png');
    await page.screenshot({ path: bannerScreenshot });
    console.log(`  Saved screenshot: ${bannerScreenshot}`);

    // 5. 375px Mobile Viewport: Avatar Removal & Mini Month Picker Animation
    console.log("\n--- 5. 375px Mobile Header & Month Slide Animation ---");
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await sleep(800);

    // Make sure we are on Calendar module on mobile
    const currentModule = await page.evaluate(() => {
      const cal = document.querySelector('[data-testid="calendar-view"]');
      const mobileHeader = document.querySelector('[data-testid="mobile-calendar-header"]');
      const bottomNavCal = document.querySelector('[data-testid="bottom-nav-calendar-tab"]');
      return { hasCal: cal !== null, hasHeader: mobileHeader !== null, hasBottomNavCal: bottomNavCal !== null };
    });
    console.log("  Mobile state check:", currentModule);
    if (!currentModule.hasCal && currentModule.hasBottomNavCal) {
      await page.click('[data-testid="bottom-nav-calendar-tab"]');
      await sleep(1000);
    }

    const mobileHeaderAudit = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="mobile-calendar-header"]');
      if (!header) return { hasHeader: false };
      // Check if avatar icon or human account icon exists in the header
      const userAvatars = header.querySelectorAll('[data-testid="profile-avatar"], [data-testid="account-icon"], svg path[d*="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"]');
      const monthBtn = header.querySelector('[data-testid="calendar-month-dropdown-btn"]');
      const todayBtn = header.querySelector('[data-testid="calendar-today-btn"]');
      const searchBtn = header.querySelector('[data-testid="calendar-mobile-search-toggle-btn"]');

      return {
        hasHeader: true,
        avatarCount: userAvatars.length,
        hasMonthBtn: monthBtn !== null,
        hasTodayBtn: todayBtn !== null,
        hasSearchBtn: searchBtn !== null,
      };
    });

    console.log("  Mobile Calendar Header Audit:", mobileHeaderAudit);
    assert(mobileHeaderAudit.hasHeader, "Mobile calendar header is rendered");
    assert(mobileHeaderAudit.avatarCount === 0, "Account human avatar icon is strictly REMOVED from phone header");
    assert(mobileHeaderAudit.hasMonthBtn, "Period title month dropdown trigger is present");
    assert(mobileHeaderAudit.hasTodayBtn, "Dynamic today button is present");

    // Open Mini-Month Picker Dropdown
    console.log("  Opening Mini-Month Picker dropdown...");
    const monthDropdownBtn = await page.waitForSelector('[data-testid="calendar-month-dropdown-btn"]', { timeout: 5000 });
    await monthDropdownBtn.click();
    await sleep(500);

    const dropdownOpen = await page.evaluate(() => {
      return document.querySelector('[data-testid="mobile-month-picker-dropdown"]') !== null;
    });
    assert(dropdownOpen, "Mini-month picker dropdown is opened");

    // Click Next Month and inspect animation classes
    console.log("  Navigating to next month and asserting slide animation...");
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="mobile-month-picker-dropdown"] button[aria-label="Next month"]');
      if (btn) btn.click();
    });
    await sleep(40); // check during animation

    const animCheck = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="mobile-month-picker-dropdown"] .grid-cols-7:not(.mb-1)');
      return {
        className: grid?.className,
        hasAnimClass: grid?.classList.contains('animate-month-slide-next') || grid?.classList.contains('animate-month-slide-prev'),
      };
    });

    console.log("  Next Month Animation Class check:", animCheck);
    assert(animCheck.hasAnimClass, "Month grid triggered .animate-month-slide-next CSS keyframe animation");

    await sleep(350); // let animation finish

    // Click Prev Month
    console.log("  Navigating to previous month and asserting slide animation...");
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="mobile-month-picker-dropdown"] button[aria-label="Previous month"]');
      if (btn) btn.click();
    });
    await sleep(40);

    const prevAnimCheck = await page.evaluate(() => {
      const grid = document.querySelector('[data-testid="mobile-month-picker-dropdown"] .grid-cols-7:not(.mb-1)');
      return {
        className: grid?.className,
        hasAnimClass: grid?.classList.contains('animate-month-slide-prev'),
      };
    });

    console.log("  Previous Month Animation Class check:", prevAnimCheck);
    assert(prevAnimCheck.hasAnimClass, "Month grid triggered .animate-month-slide-prev CSS keyframe animation");

    const mobileAnimScreenshot = path.resolve(artifactsDir, 'mobile_calendar_month_picker_slide.png');
    await page.screenshot({ path: mobileAnimScreenshot });
    console.log(`  Saved screenshot: ${mobileAnimScreenshot}`);

    console.log("\n================================================================================");
    console.log("   ALL 4 VISUAL REFINEMENT VERIFICATION TESTS PASSED SUCCESSFULLY!              ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error("FATAL ERROR IN TEST SUITE:", err);
  process.exit(1);
});
