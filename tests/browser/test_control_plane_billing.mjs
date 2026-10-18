import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function flushRateLimits() {
  try {
    execSync('docker exec byos-redis redis-cli FLUSHALL', { stdio: 'ignore' });
  } catch {}
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

async function clickButtonWithText(page, text) {
  const clicked = await page.evaluate((btnText) => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent && b.textContent.includes(btnText));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
  if (!clicked) {
    throw new Error(`Button containing text "${text}" not found`);
  }
}

async function runBillingBrowserTest() {
  console.log("================================================================================");
  console.log("             CONTROL PANEL SEAT-BASED BILLING BROWSER SUITE                     ");
  console.log("================================================================================\n");

  flushRateLimits();
  const baseUrl = "http://localhost:3000";
  const networkLogs = [];
  const consoleErrors = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 950 });

    page.on('console', (msg) => {
      console.log(`[BROWSER CONSOLE ${msg.type()}]: ${msg.text()}`);
    });

    page.on('pageerror', (err) => {
      console.log(`[PAGE ERROR]: ${err.message}`);
    });

    page.on('requestfailed', (req) => {
      console.log(`[REQUEST FAILED]: ${req.method()} ${req.url()} (${req.failure()?.errorText})`);
    });

    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/v1/')) {
        let body = '';
        try {
          body = await res.text();
        } catch {}
        console.log(`[API RESPONSE]: ${res.status()} ${url} -> ${body.substring(0, 200)}`);
        networkLogs.push({
          url,
          status: res.status(),
          method: res.request().method(),
          body: body.length > 500 ? body.substring(0, 500) + '...' : body,
        });
      }
    });

    // 1. Real Login Flow
    console.log("[STEP 1] Performing real login as organization owner (alice@byos.local)...");
    await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle0', timeout: 15000 });

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');

    const submitBtn = await page.waitForSelector('button[type="submit"]');
    await submitBtn.click();

    await sleep(2000);
    const afterClickUrl = page.url();
    console.log(`[LOGIN] URL after submit click: ${afterClickUrl}`);
    await page.waitForFunction(() => window.location.pathname.includes('/dashboard'), { timeout: 15000 });
    assert(page.url().includes('/dashboard'), `Navigated to dashboard: ${page.url()}`);

    // Verify localStorage token
    const token = await page.evaluate(() => localStorage.getItem('byos_cp_session_token'));
    assert(!!token, `Local storage session token exists: ${token ? token.substring(0, 10) + '...' : 'none'}`);

    // 2. Navigate to Billing
    console.log("\n[STEP 2] Navigating to /dashboard/billing...");
    await page.goto(`${baseUrl}/dashboard/billing`, { waitUntil: 'networkidle0', timeout: 15000 });

    await page.waitForSelector('h1', { timeout: 10000 });
    const heading = await page.$eval('h1', (el) => el.textContent.trim());
    assert(heading.includes('Billing & Seat Allocation'), `Billing heading matches: "${heading}"`);

    // Ensure seat count starts at 20 for test consistency
    const seatInput = await page.waitForSelector('input[aria-label="Seat count input"]');
    let currentSeats = await page.evaluate((el) => el.value, seatInput);

    if (currentSeats !== '20') {
      console.log(`[SETUP] Setting initial seat count from ${currentSeats} to 20...`);
      await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Seat count input"]');
        input.value = '20';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await sleep(300);
      await clickButtonWithText(page, 'Update Seat Capacity');
      await sleep(1000);
      await page.reload({ waitUntil: 'networkidle0' });
    }

    // 3. Verify Monthly Breakdown for 20 seats
    console.log("\n[STEP 3] Verifying Monthly graduated breakdown for 20 seats...");
    await page.waitForSelector('input[aria-label="Seat count input"]');
    const seatsVal = await page.$eval('input[aria-label="Seat count input"]', (el) => el.value);
    assert(seatsVal === '20', `Seat count input shows 20 (got ${seatsVal})`);

    const pageContent = await page.content();
    assert(pageContent.includes('10 seats') && pageContent.includes('$3.00'), "Breakdown contains: 10 seats × $3.00");
    assert(pageContent.includes('$2.85'), "Breakdown contains: 10 seats × $2.85");
    assert(pageContent.includes('$58.50'), "Breakdown contains total: $58.50/month");

    // Check bracket hint
    assert(
      pageContent.includes("You're in the 11–25 seat bracket"),
      "Bracket hint correctly identifies 11–25 tier"
    );

    const monthlyScreenshot = path.resolve(artifactsDir, 'billing_monthly_20_seats.png');
    await page.screenshot({ path: monthlyScreenshot, fullPage: true });
    assert(fs.existsSync(monthlyScreenshot), `Saved screenshot: ${monthlyScreenshot}`);

    // 4. Toggle to Annual Billing
    console.log("\n[STEP 4] Toggling to Annual billing cycle...");
    await clickButtonWithText(page, 'Annual (Save 16.7%)');
    await sleep(500);

    const annualContent = await page.content();
    assert(annualContent.includes('$585.00'), "Annual total shows $585.00 (10 × $58.50)");
    assert(annualContent.includes('-$117.00'), "Annual discount line shows -$117.00 (2 months free)");

    const annualScreenshot = path.resolve(artifactsDir, 'billing_annual_20_seats.png');
    await page.screenshot({ path: annualScreenshot, fullPage: true });
    assert(fs.existsSync(annualScreenshot), `Saved screenshot: ${annualScreenshot}`);

    // 5. Capacity Panel Checks
    console.log("\n[STEP 5] Verifying Capacity panel calculations...");
    // Mailboxes: 2 / 20
    assert(annualContent.includes('2 / 20'), "Mailbox capacity shows 2 / 20");
    // Domains: ceil(20 / 5) = 4
    assert(annualContent.includes('/ 4') && annualContent.includes('Custom Domains'), "Domain capacity shows / 4");
    // Aliases: 20 * 2 = 40
    assert(annualContent.includes('/ 40') && annualContent.includes('Masked Aliases'), "Masked alias capacity shows / 40");
    // Persistent Storage Unlimited
    assert(annualContent.includes('Unlimited') && annualContent.includes('Persistent Storage'), "Storage is marked Unlimited");

    const capacityScreenshot = path.resolve(artifactsDir, 'billing_capacity.png');
    await page.screenshot({ path: capacityScreenshot, fullPage: true });
    assert(fs.existsSync(capacityScreenshot), `Saved screenshot: ${capacityScreenshot}`);

    // 6. Test Stepper & Increase to 26 Seats
    console.log("\n[STEP 6] Stepping seats up to 26 (enters Tier 3: 26–50)...");
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Seat count input"]');
      input.value = '26';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);

    const steppedContent = await page.content();
    assert(
      steppedContent.includes("You're in the 26–50 seat bracket"),
      "Bracket hint dynamically updated to 26–50 bracket"
    );
    assert(steppedContent.includes('$2.71'), "Breakdown includes Tier 3 unit rate $2.71");

    // 7. Save Seat Changes
    console.log("\n[STEP 7] Saving seat changes to 26 seats...");
    await clickButtonWithText(page, 'Update Seat Capacity to 26 Seats');
    await sleep(1000);

    const bannerHtml = await page.evaluate(() => {
      const b = document.querySelector('[role="alert"]');
      return b ? b.outerHTML : 'NOT_FOUND. Body text: ' + document.body.innerText.substring(0, 300);
    });
    console.log(`[STEP 7 DEBUG] banner element: ${bannerHtml}`);

    await page.waitForSelector('div[role="alert"]', { timeout: 8000 });
    const alertText = await page.$eval('div[role="alert"]', (el) => el.textContent.trim());
    assert(alertText.includes('26 seats'), `Success banner displayed: "${alertText}"`);

    // 8. Verify Persistence After Page Reload
    console.log("\n[STEP 8] Reloading page to verify persistence...");
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('input[aria-label="Seat count input"]');
    const persistedSeats = await page.$eval('input[aria-label="Seat count input"]', (el) => el.value);
    assert(persistedSeats === '26', `Seat count 26 persisted across reload (got ${persistedSeats})`);

    // 9. Decrement constraint test
    console.log("\n[STEP 9] Testing decrement boundary against active mailboxes (2)...");
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Seat count input"]');
      input.value = '2';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    await clickButtonWithText(page, 'Update Seat Capacity to 2 Seats');
    await sleep(1000);

    const decrementBtn = await page.waitForSelector('button[aria-label="Decrease seat count"]');
    const isDisabled = await page.evaluate((el) => el.disabled, decrementBtn);
    const titleAttr = await page.evaluate((el) => el.getAttribute('title'), decrementBtn);
    assert(isDisabled, "Decrement button is disabled when seats equal active mailboxes");
    assert(
      titleAttr.includes('Deactivate a mailbox before reducing seats below 2'),
      `Tooltip warns about active mailboxes: "${titleAttr}"`
    );

    const decrementScreenshot = path.resolve(artifactsDir, 'billing_decrement_disabled.png');
    await page.screenshot({ path: decrementScreenshot, fullPage: true });
    assert(fs.existsSync(decrementScreenshot), `Saved screenshot: ${decrementScreenshot}`);

    // 10. Clean up: reset seats back to 20
    console.log("\n[STEP 10] Restoring seat count back to 20...");
    await page.evaluate(() => {
      const input = document.querySelector('input[aria-label="Seat count input"]');
      input.value = '20';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    await clickButtonWithText(page, 'Update Seat Capacity to 20 Seats');
    await sleep(1000);

    // Summary of DevTools state
    console.log("\n================================================================================");
    console.log("                        DEVTOOLS STATE AUDIT                                    ");
    console.log("================================================================================");
    console.log(`Console Errors Captured: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      consoleErrors.forEach((e) => console.log(`  - ${e}`));
    }
    console.log(`Relevant Network Requests Dump: ${networkLogs.length}`);
    networkLogs.slice(-6).forEach((req) => {
      console.log(`  [${req.method}] ${req.url} -> Status ${req.status}`);
      console.log(`    Response: ${req.body}`);
    });

    console.log("\n================================================================================");
    console.log("             ALL CONTROL PANEL BILLING BROWSER CHECKS PASSED                    ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runBillingBrowserTest().catch((err) => {
  console.error("\nFATAL TEST ERROR:", err);
  process.exit(1);
});
