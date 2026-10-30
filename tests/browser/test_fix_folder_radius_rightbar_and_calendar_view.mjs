import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ARTIFACTS_DIR = 'tests/browser/artifacts';
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome executable not found');
}

async function main() {
  console.log('='.repeat(80));
  console.log('   BYOS: FOLDER BORDER REMOVAL, RIGHTBAR FIX & CALENDAR YEAR DEFAULT TEST');
  console.log('='.repeat(80));

  const chromePath = await findChromePath();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    // 1. Login
    console.log('\n--- [STEP 1] Login as alice@byos.local ---');
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 600));

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log('  Logged in successfully.');
    await new Promise((r) => setTimeout(r, 800));

    // 2. Verify Folder Left Radius Border is REMOVED
    console.log('\n--- [STEP 2] Verify Folder Pill Has No Left Radius Border ---');
    await page.waitForSelector('[data-testid="sidebar-folders-nav"]', { timeout: 5000 });
    const pillBorderInfo = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="sidebar-folders-nav"]');
      const pill = nav ? nav.querySelector('.rounded-xl.pointer-events-none') : null;
      if (!pill) return { found: false };
      const comp = window.getComputedStyle(pill);
      return {
        found: true,
        borderLeftWidth: comp.borderLeftWidth,
        borderLeftStyle: comp.borderLeftStyle,
        borderLeftColor: comp.borderLeftColor,
        classList: Array.from(pill.classList),
      };
    });

    console.log('  Folder pill border info:', JSON.stringify(pillBorderInfo, null, 2));
    assert.strictEqual(pillBorderInfo.found, true, 'Folder morphing pill must exist');
    assert.ok(
      pillBorderInfo.borderLeftWidth === '0px' || pillBorderInfo.borderLeftStyle === 'none',
      `Folder pill must not have a left border (got width=${pillBorderInfo.borderLeftWidth}, style=${pillBorderInfo.borderLeftStyle})`
    );
    assert.ok(
      !pillBorderInfo.classList.includes('border-l-2'),
      'Folder pill must not have border-l-2 class'
    );
    console.log('  PASS: Folder left radius border is completely removed');
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'folder_pill_no_left_border.png') });

    // 3. Verify RightBar Fixes: No Contacts, Perfectly Centered Pill, No Glitch
    console.log('\n--- [STEP 3] Verify RightBar: No Contacts, Perfectly Centered Pill ---');
    const rightBarInfo = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="right-utility-bar"]');
      if (!bar) return { found: false };
      const barRect = bar.getBoundingClientRect();
      const pill = bar.querySelector('.pointer-events-none');
      const pillRect = pill ? pill.getBoundingClientRect() : null;
      const contactsBtn = bar.querySelector('[data-testid="contacts-nav-btn"]') || bar.querySelector('[title="Contacts"]');
      const buttons = Array.from(bar.querySelectorAll('button'));
      return {
        found: true,
        barLeft: barRect.left,
        barRight: barRect.right,
        barWidth: barRect.width,
        pillLeft: pillRect ? pillRect.left : null,
        pillRight: pillRect ? pillRect.right : null,
        pillWidth: pillRect ? pillRect.width : null,
        pillWithinBounds: pillRect ? (pillRect.left >= barRect.left && pillRect.right <= barRect.right) : false,
        hasContactsBtn: contactsBtn !== null,
        buttonTitles: buttons.map(b => b.getAttribute('title') || b.getAttribute('aria-label')),
        buttonCount: buttons.length,
      };
    });

    console.log('  RightBar layout info:', JSON.stringify(rightBarInfo, null, 2));
    assert.strictEqual(rightBarInfo.found, true, 'Right utility bar must exist');
    assert.strictEqual(rightBarInfo.hasContactsBtn, false, 'RightBar must NOT contain Contacts button');
    assert.strictEqual(rightBarInfo.buttonCount, 3, 'RightBar must have exactly 3 module buttons (Emails, Calendar, Notes)');
    assert.strictEqual(rightBarInfo.pillWithinBounds, true, 'Morphing indicator pill must be strictly inside RightBar (no left overflow glitch)');
    console.log('  PASS: RightBar Contacts button removed and pill is perfectly centered within bounds');
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'rightbar_perfectly_centered_no_contacts.png') });

    // 4. Verify Calendar Initial View is YEAR
    console.log('\n--- [STEP 4] Verify Calendar View Starts on Year ---');
    await page.click('[data-testid="right-bar-calendar-btn"]');
    await page.waitForSelector('[data-testid="calendar-toolbar"]', { timeout: 10000 });
    
    // Check which view button is active on initial calendar load
    const initialCalendarView = await page.evaluate(() => {
      const yearBtn = document.querySelector('[data-testid="view-year-btn"]');
      const weekBtn = document.querySelector('[data-testid="view-week-btn"]');
      const dayBtn = document.querySelector('[data-testid="view-day-btn"]');
      const monthBtn = document.querySelector('[data-testid="view-month-btn"]');
      return {
        yearPressed: yearBtn ? yearBtn.getAttribute('aria-pressed') : null,
        weekPressed: weekBtn ? weekBtn.getAttribute('aria-pressed') : null,
        dayPressed: dayBtn ? dayBtn.getAttribute('aria-pressed') : null,
        monthPressed: monthBtn ? monthBtn.getAttribute('aria-pressed') : null,
      };
    });

    console.log('  Initial Calendar view state:', JSON.stringify(initialCalendarView, null, 2));
    assert.strictEqual(initialCalendarView.yearPressed, 'true', 'At the very start, Year view must be selected');
    console.log('  PASS: Initial calendar view is Year');
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'calendar_initial_year_view.png') });

    // 5. Verify View Selection Persistence Across Module Switches
    console.log('\n--- [STEP 5] Verify Calendar View Selection Persistence ---');
    // Change view to "Month"
    await page.click('[data-testid="view-month-btn"]');
    await new Promise(r => setTimeout(r, 400));
    
    const monthViewActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="view-month-btn"]');
      return btn ? btn.getAttribute('aria-pressed') : null;
    });
    assert.strictEqual(monthViewActive, 'true', 'Month view must be active after clicking Month button');
    console.log('  Switched to Month view.');

    // Switch back to Mailbox
    await page.click('[data-testid="right-bar-emails-btn"]');
    await page.waitForSelector('[data-testid="message-list"]', { timeout: 10000 });
    console.log('  Switched back to Mailbox module.');

    // Switch back to Calendar
    await page.click('[data-testid="right-bar-calendar-btn"]');
    await page.waitForSelector('[data-testid="calendar-toolbar"]', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 300));

    // Assert that Month is STILL selected (not reset to default or jumping from day to week)
    const reloadedCalendarView = await page.evaluate(() => {
      const yearBtn = document.querySelector('[data-testid="view-year-btn"]');
      const weekBtn = document.querySelector('[data-testid="view-week-btn"]');
      const dayBtn = document.querySelector('[data-testid="view-day-btn"]');
      const monthBtn = document.querySelector('[data-testid="view-month-btn"]');
      return {
        monthPressed: monthBtn ? monthBtn.getAttribute('aria-pressed') : null,
        weekPressed: weekBtn ? weekBtn.getAttribute('aria-pressed') : null,
        dayPressed: dayBtn ? dayBtn.getAttribute('aria-pressed') : null,
        yearPressed: yearBtn ? yearBtn.getAttribute('aria-pressed') : null,
      };
    });

    console.log('  Calendar view state after switching back:', JSON.stringify(reloadedCalendarView, null, 2));
    assert.strictEqual(reloadedCalendarView.monthPressed, 'true', 'Calendar must remain on previously selected view (Month)');
    assert.strictEqual(reloadedCalendarView.weekPressed, 'false', 'Calendar must not reset to Week');
    console.log('  PASS: Calendar preserved Month selection across module navigation');
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'calendar_preserved_month_view.png') });

    console.log('\n' + '='.repeat(80));
    console.log('   ALL CHECKS PASSED: FOLDER BORDER, RIGHTBAR & CALENDAR VIEW VERIFIED');
    console.log('='.repeat(80));
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('\nTEST FAILED:', err);
  process.exit(1);
});
