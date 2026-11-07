import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('../../apps/webmail/node_modules/puppeteer-core');

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
  return new Promise((r) => setTimeout(r, ms));
}

async function runCalendarUserExperienceDemo() {
  console.log('================================================================================');
  console.log('       CALENDAR USER EXPERIENCE & INTERACTIVE DEMO AUDIT                        ');
  console.log('================================================================================\n');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Step 1: Login
    console.log('--- [STEP 1] Login & Navigation ---');
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
    await sleep(2500);

    // Step 2: Switch to Calendar Module
    console.log('--- [STEP 2] Switch to Calendar Module ---');
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    const calTab = await page.$('[data-testid="nav-calendar-tab"]');
    assert(calTab !== null, 'Calendar module tab exists in top bar');
    await calTab.click();
    await sleep(800);

    const hasCalView = await page.$('[data-testid="calendar-view"]');
    assert(hasCalView !== null, 'CalendarView mounted successfully');

    // Step 3: Verify Clean Modern Toolbar (No density switcher, no Smart Add, no clutter)
    console.log('--- [STEP 3] Verify Clean Modern Toolbar ---');
    const densitySwitcher = await page.$('[data-testid="kashcal-density-switcher"]');
    const smartAdd = await page.$('[data-testid="kashcal-quick-add-btn"]');
    const trashBtn = await page.$('[data-testid="calendar-trash-btn"]');
    const settingsBtn = await page.$('[data-testid="calendar-settings-btn"]');

    assert(densitySwitcher === null, 'Density switcher is completely removed');
    assert(smartAdd === null, 'Smart Add button is completely removed');
    assert(trashBtn !== null, 'Trash bin button is available');
    assert(settingsBtn !== null, 'Settings button is available');

    // Step 4: Capture Week View with Clean Aligned Grid
    console.log('--- [STEP 4] Capture User Week View ---');
    const weekBtn = await page.$('[data-testid="view-week-btn"]');
    if (weekBtn) await weekBtn.click();
    await sleep(600);

    const weekScreenshotPath = path.join(artifactsDir, 'calendar_user_demo_week.png');
    await page.screenshot({ path: weekScreenshotPath });
    console.log(`  Saved: ${weekScreenshotPath}`);

    // Step 5: Switch to Month View and Capture
    console.log('--- [STEP 5] Capture User Month View ---');
    const monthBtn = await page.$('[data-testid="view-month-btn"]');
    assert(monthBtn !== null, 'Month view button exists');
    await monthBtn.click();
    await sleep(600);

    const monthScreenshotPath = path.join(artifactsDir, 'calendar_user_demo_month.png');
    await page.screenshot({ path: monthScreenshotPath });
    console.log(`  Saved: ${monthScreenshotPath}`);

    // Step 6: Switch to Day View and Capture
    console.log('--- [STEP 6] Capture User Day View ---');
    const dayBtn = await page.$('[data-testid="view-day-btn"]');
    assert(dayBtn !== null, 'Day view button exists');
    await dayBtn.click();
    await sleep(600);

    const dayScreenshotPath = path.join(artifactsDir, 'calendar_user_demo_day.png');
    await page.screenshot({ path: dayScreenshotPath });
    console.log(`  Saved: ${dayScreenshotPath}`);

    // Step 7: Switch to Agenda (Schedule) View and Capture
    console.log('--- [STEP 7] Capture User Agenda View ---');
    const agendaBtn = await page.$('[data-testid="view-agenda-btn"]');
    assert(agendaBtn !== null, 'Agenda view button exists');
    await agendaBtn.click();
    await sleep(600);

    const agendaScreenshotPath = path.join(artifactsDir, 'calendar_user_demo_agenda.png');
    await page.screenshot({ path: agendaScreenshotPath });
    console.log(`  Saved: ${agendaScreenshotPath}`);

    console.log('\n================================================================================');
    console.log('       ALL CALENDAR USER EXPERIENCE DEMO CHECKS PASSED                          ');
    console.log('================================================================================');
  } finally {
    await browser.close();
  }
}

runCalendarUserExperienceDemo().catch((err) => {
  console.error('Fatal error in user experience demo:', err);
  process.exit(1);
});
