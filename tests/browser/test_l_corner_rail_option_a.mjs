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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('='.repeat(80));
  console.log('   BYOS: L-CORNER RAIL OPTION A CONTINUOUS CONTAINER VERIFICATION TEST');
  console.log('='.repeat(80));

  const chromePath = await findChromePath();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    // 1. Login
    console.log('\n--- [STEP 1] Login as alice@byos.local ---');
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
    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log('  Logged in successfully.');
    await sleep(800);

    // 2. Verify L-Corner Rail Geometry & Elements
    console.log('\n--- [STEP 2] Verify L-Corner Rail Geometry & Consolidated 5 Icons ---');
    const railInfo = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="l-corner-rail"]') || document.querySelector('[data-testid-secondary="l-corner-rail"]');
      if (!rail) return { found: false };
      const svg = rail.querySelector('svg');
      const buttons = Array.from(rail.querySelectorAll('button')).map((b) => ({
        testId: b.getAttribute('data-testid'),
        title: b.getAttribute('title') || b.getAttribute('aria-label'),
      }));
      const rect = rail.getBoundingClientRect();
      return {
        found: true,
        width: rect.width,
        height: rect.height,
        hasSvg: Boolean(svg),
        buttons,
      };
    });

    console.log('  Rail Info:', JSON.stringify(railInfo, null, 2));
    assert(railInfo.found, 'L-Corner Rail element must be found in DOM');
    assert(railInfo.width === 136, `L-Corner Rail width must be 136px (got ${railInfo.width})`);
    assert(railInfo.height === 180, `L-Corner Rail height must be 180px (got ${railInfo.height})`);
    assert(railInfo.hasSvg, 'L-Corner Rail must contain SVG continuous background');
    assert(railInfo.buttons.length === 5, `L-Corner Rail must contain exactly 5 buttons (got ${railInfo.buttons.length})`);
    console.log('  PASS: L-Corner Rail hosts exactly 5 icons in continuous shape');

    // Screenshot default state
    const lightScreenshot = path.join(ARTIFACTS_DIR, 'l_corner_rail_option_a_light.png');
    await page.screenshot({ path: lightScreenshot });
    console.log(`  Saved screenshot: ${lightScreenshot}`);

    // 3. Hover State & Tooltip Test
    console.log('\n--- [STEP 3] Test Hover State & Tooltip ---');
    await page.hover('[data-testid="right-bar-calendar-btn"]');
    await sleep(300);
    const tooltipText = await page.evaluate(() => {
      const calendarBtn = document.querySelector('[data-testid="right-bar-calendar-btn"]');
      const parent = calendarBtn ? calendarBtn.parentElement : null;
      const tooltip = parent ? parent.querySelector('.animate-fade-in') : null;
      return tooltip ? tooltip.textContent.trim() : null;
    });
    console.log(`  Observed tooltip text on calendar hover: '${tooltipText}'`);
    assert(tooltipText === 'Calendar', `Tooltip on hover must display 'Calendar' (got '${tooltipText}')`);
    console.log('  PASS: Hover state displays animated tooltip');

    const hoverScreenshot = path.join(ARTIFACTS_DIR, 'l_corner_rail_option_a_hover.png');
    await page.screenshot({ path: hoverScreenshot });
    console.log(`  Saved screenshot: ${hoverScreenshot}`);

    // 4. Switch to Calendar via Vertical Arm & Check Morphing Pill
    console.log('\n--- [STEP 4] Switch Module to Calendar & Verify Morphing Pill ---');
    await page.click('[data-testid="right-bar-calendar-btn"]');
    await sleep(600);
    const calPillTop = await page.evaluate(() => {
      const pill = document.querySelector('[data-testid="right-bar-morphing-pill"]');
      return pill ? pill.style.top : null;
    });
    console.log(`  Morphing pill top on Calendar module: ${calPillTop}`);
    assert(calPillTop === '96px', `Morphing pill top must be 96px for Calendar (got '${calPillTop}')`);
    console.log('  PASS: Morphing pill slid smoothly to Calendar (96px)');

    // 5. Test Dark Mode Switcher in Horizontal Arm
    console.log('\n--- [STEP 5] Test Theme Switcher in Horizontal Arm ---');
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'cloud_dancer');
    await page.click('[data-testid="top-bar-theme-toggle"]');
    await sleep(500);
    const switchedTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'cloud_dancer');
    console.log(`  Theme switched from ${initialTheme} to ${switchedTheme}`);
    assert(switchedTheme === 'dark', `Theme must switch to dark (got '${switchedTheme}')`);
    console.log('  PASS: Dark mode activated via L-Corner Rail theme toggle');

    const darkScreenshot = path.join(ARTIFACTS_DIR, 'l_corner_rail_option_a_dark.png');
    await page.screenshot({ path: darkScreenshot });
    console.log(`  Saved screenshot: ${darkScreenshot}`);

    // Toggle back to light
    await page.click('[data-testid="top-bar-theme-toggle"]');
    await sleep(500);

    // 6. Test Palette (UI Customizer) in Horizontal Arm
    console.log('\n--- [STEP 6] Test UI Customizer Toggle & Coexistence ---');
    await page.click('[data-testid="top-bar-appearance-btn"]');
    await sleep(500);
    const customizerVisible = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="quick-settings-panel"]');
      return Boolean(panel);
    });
    assert(customizerVisible, 'QuickSettingsPanel must open via L-Corner Rail appearance button');
    console.log('  PASS: UI Customizer opened via L-Corner Rail palette button');

    const customizerScreenshot = path.join(ARTIFACTS_DIR, 'l_corner_rail_option_a_customizer.png');
    await page.screenshot({ path: customizerScreenshot });
    console.log(`  Saved screenshot: ${customizerScreenshot}`);

    // Close Customizer
    await page.click('[data-testid="top-bar-appearance-btn"]');
    await sleep(400);

    // Switch back to Mailbox
    await page.click('[data-testid="right-bar-emails-btn"]');
    await sleep(600);
    const mailPillTop = await page.evaluate(() => {
      const pill = document.querySelector('[data-testid="right-bar-morphing-pill"]');
      return pill ? pill.style.top : null;
    });
    console.log(`  Morphing pill top on Mailbox module: ${mailPillTop}`);
    assert(mailPillTop === '54px', `Morphing pill top must be 54px for Mailbox (got '${mailPillTop}')`);
    console.log('  PASS: Morphing pill slid smoothly back to Mailbox (54px)');

    console.log('\n' + '='.repeat(80));
    console.log('   ALL CHECKS PASSED: L-CORNER RAIL OPTION A FULLY VERIFIED!');
    console.log('='.repeat(80));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\nFATAL ERROR in browser verification:', err);
  process.exit(1);
});
