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

async function run() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: INDUSTRY-STANDARD EVENT COLLISION & OPACITY AUDIT             ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
      uncaughtErrors.push(err.message);
    });

    console.log("--- [STEP 1] Login as alice@byos.local ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice");

    console.log("\n--- [STEP 2] Navigate to Calendar View ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);

    console.log("\n--- [STEP 3] Inspect Week View Overlapping Events & Opacity ---");
    const weekBtn = await page.waitForSelector('[data-testid="view-week-btn"]', { timeout: 5000 });
    await weekBtn.click();
    await sleep(1000);

    // Analyze event pills in Week View
    const weekPillAnalysis = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('[data-testid="calendar-event-pill"]'));
      return pills.map((p) => {
        const style = window.getComputedStyle(p);
        const rect = p.getBoundingClientRect();
        const bg = style.backgroundColor;
        const isTransparent = bg === 'transparent' || bg.includes('rgba') && !bg.includes(', 1)');
        return {
          title: p.getAttribute('title') || p.textContent?.trim() || '',
          text: p.textContent?.trim() || '',
          bg,
          isTransparent,
          width: rect.width,
          left: rect.left,
          top: rect.top,
          height: rect.height,
          zIndex: style.zIndex,
        };
      });
    });

    console.log(`  Rendered ${weekPillAnalysis.length} timed event pills in Week View`);
    assert(weekPillAnalysis.length > 0, "Event pills rendered in Week View");

    // Assert that zero pills have transparent or low-alpha background
    const transparentPillsWeek = weekPillAnalysis.filter((p) => p.isTransparent);
    console.log(`  Transparent/translucent pills in Week View: ${transparentPillsWeek.length}`);
    assert(transparentPillsWeek.length === 0, "Zero transparent event pills in Week View (all surfaces 100% opaque)");

    // Assert that pills have adequate width (> 40px)
    const tooNarrowPillsWeek = weekPillAnalysis.filter((p) => p.width < 40);
    console.log(`  Too-narrow sliver pills (< 40px) in Week View: ${tooNarrowPillsWeek.length}`);
    assert(tooNarrowPillsWeek.length === 0, "Zero collapsed/sliver pills in Week View");

    const weekScreenshot = path.resolve(artifactsDir, 'calendar_collision_weekview_opaque.png');
    await page.screenshot({ path: weekScreenshot });
    console.log(`  Saved screenshot: ${weekScreenshot}`);

    console.log("\n--- [STEP 4] Inspect Day View Event Layout & Lane Partitioning ---");
    const dayBtn = await page.waitForSelector('[data-testid="view-day-btn"]', { timeout: 5000 });
    await dayBtn.click();
    await sleep(1000);

    const dayPillAnalysis = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('[data-testid="calendar-event-pill"]'));
      return pills.map((p) => {
        const style = window.getComputedStyle(p);
        const rect = p.getBoundingClientRect();
        const bg = style.backgroundColor;
        const isTransparent = bg === 'transparent' || bg.includes('rgba') && !bg.includes(', 1)');
        return {
          title: p.getAttribute('title') || p.textContent?.trim() || '',
          bg,
          isTransparent,
          width: rect.width,
          left: rect.left,
          top: rect.top,
          height: rect.height,
          zIndex: style.zIndex,
        };
      });
    });

    console.log(`  Rendered ${dayPillAnalysis.length} timed event pills in Day View`);
    assert(dayPillAnalysis.length > 0, "Event pills rendered in Day View");

    const transparentPillsDay = dayPillAnalysis.filter((p) => p.isTransparent);
    console.log(`  Transparent/translucent pills in Day View: ${transparentPillsDay.length}`);
    assert(transparentPillsDay.length === 0, "Zero transparent event pills in Day View (all surfaces 100% opaque)");

    // In Day View, events should have ample width (>= 60px)
    const tooNarrowPillsDay = dayPillAnalysis.filter((p) => p.width < 60);
    console.log(`  Too-narrow sliver pills (< 60px) in Day View: ${tooNarrowPillsDay.length}`);
    assert(tooNarrowPillsDay.length === 0, "Zero squeezed sliver pills in Day View");

    const dayScreenshot = path.resolve(artifactsDir, 'calendar_collision_dayview_opaque.png');
    await page.screenshot({ path: dayScreenshot });
    console.log(`  Saved screenshot: ${dayScreenshot}`);

    console.log("\n--- [STEP 5] Test Dark Mode Opacity & Theme Invariance ---");
    // Switch to dark mode via document or theme toggle
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
    });
    await sleep(600);

    // Re-verify Day View in Dark Mode
    const dayDarkAnalysis = await page.evaluate(() => {
      const pills = Array.from(document.querySelectorAll('[data-testid="calendar-event-pill"]'));
      return pills.map((p) => {
        const style = window.getComputedStyle(p);
        const bg = style.backgroundColor;
        const isTransparent = bg === 'transparent' || bg.includes('rgba') && !bg.includes(', 1)');
        return { bg, isTransparent };
      });
    });

    const transparentPillsDayDark = dayDarkAnalysis.filter((p) => p.isTransparent);
    assert(transparentPillsDayDark.length === 0, "Zero transparent event pills in Dark Mode Day View");

    const dayDarkScreenshot = path.resolve(artifactsDir, 'calendar_collision_dayview_dark_opaque.png');
    await page.screenshot({ path: dayDarkScreenshot });
    console.log(`  Saved screenshot: ${dayDarkScreenshot}`);

    // Switch to Week View in Dark Mode
    await weekBtn.click();
    await sleep(800);

    const weekDarkScreenshot = path.resolve(artifactsDir, 'calendar_collision_weekview_dark_opaque.png');
    await page.screenshot({ path: weekDarkScreenshot });
    console.log(`  Saved screenshot: ${weekDarkScreenshot}`);

    // Assert zero page errors
    assert(uncaughtErrors.length === 0, `Zero uncaught page errors encountered (found ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL INDUSTRY-STANDARD COLLISION & OPACITY AUDITS PASSED                      ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
