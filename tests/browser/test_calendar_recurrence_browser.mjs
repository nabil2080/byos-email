import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const DISPOSABLE_DB = 'byos_recovery_disposable_20261024';
const API_PORT = '8094';
const WEBMAIL_PORT = '3010';

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

async function waitForHttp(url, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {}
    await sleep(400);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function runCalendarRecurrenceBrowserTest() {
  console.log("================================================================================");
  console.log("     BYOS CALENDAR RECURRENCE & DETACHED EXCEPTIONS BROWSER TEST                ");
  console.log("================================================================================\n");

  const aliceUserId = 'cccccccc-0000-0000-0000-000000000002';
  const alicePasswordHash = '$argon2id$v=19$m=65536,t=3,p=2$2K4LPnHGYrPq+76HQK2hKQ$ol3Z1nfC344rKLOp1Yk+k02FCS4ohM+O9uRp51YUlgg';

  console.log("  Preparing disposable fixture in database:", DISPOSABLE_DB);
  const fixtureSql = `
    UPDATE users SET password_hash = '${alicePasswordHash}', two_factor_enabled = false, totp_secret = NULL, is_active = true WHERE id = '${aliceUserId}';
    DELETE FROM user_passkeys WHERE user_id = '${aliceUserId}';
  `;
  execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB}`, { input: fixtureSql });

  // 1. Spawn disposable API on port 8094
  console.log(`  Starting disposable API on port ${API_PORT}...`);
  const apiProc = spawn(path.join(repoRoot, 'scratch', 'disposable_api.exe'), [], {
    env: {
      ...process.env,
      API_PORT: API_PORT,
      PORT: API_PORT,
      DATABASE_URL: `postgres://byos:byos_dev_password@localhost:5432/${DISPOSABLE_DB}?sslmode=disable`,
      REDIS_ADDR: 'localhost:6379',
      JWT_SECRET: 'dev_jwt_secret_key_change_in_production_12345',
      BYOS_DEV_MODE: 'true',
    },
    stdio: 'ignore',
  });

  // 2. Spawn disposable Webmail on port 3010
  console.log(`  Starting disposable Webmail on port ${WEBMAIL_PORT}...`);
  const webmailProc = spawn('cmd.exe', ['/c', 'npm.cmd', 'run', 'dev', '--', '--port', WEBMAIL_PORT, '--host', '127.0.0.1'], {
    cwd: path.join(repoRoot, 'apps', 'webmail'),
    env: {
      ...process.env,
      VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
    },
    stdio: 'ignore',
  });

  let browser;
  const consoleErrors = [];

  try {
    console.log("  Waiting for API and Webmail to become ready...");
    await waitForHttp(`http://127.0.0.1:${API_PORT}/v1/health`);
    await waitForHttp(`http://127.0.0.1:${WEBMAIL_PORT}`);
    console.log("  Disposable test services ready.\n");

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)')
        ) {
          consoleErrors.push(text);
        }
      }
    });

    // STEP 1: Log in as Alice
    console.log("--- [STEP 1] Login as Alice ---");
    await page.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
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

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice.");

    // STEP 2: Navigate to Calendar
    console.log("\n--- [STEP 2] Navigate to Calendar View ---");
    const calendarNavBtn = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calendarNavBtn.click();
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1500);

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recurrence_initial.png') });
    assert(true, "Navigated to Calendar View");

    // STEP 3: Switch to Month View to see multiple recurring occurrences clearly
    console.log("\n--- [STEP 3] Switch to Month View ---");
    const monthBtn = await page.waitForSelector('[data-testid="view-month-btn"]', { timeout: 5000 });
    await monthBtn.click();
    await sleep(1000);

    // STEP 4: Create a recurring event
    console.log("\n--- [STEP 4] Create Weekly Recurring Event ---");
    const newEventBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await sleep(500);

    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await page.type('[data-testid="event-title-input"]', 'Weekly Architecture Sync');

    // Select weekly recurrence
    const repeatSelect = await page.waitForSelector('[data-testid="event-repeat-select"]', { timeout: 5000 });
    await repeatSelect.select('weekly');

    // Save event
    const saveBtn = await page.waitForSelector('[data-testid="save-event-btn"]');
    await saveBtn.click();
    await sleep(2000);

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recurrence_series_created.png') });
    console.log("  Created weekly recurring event.");

    // STEP 5: Verify occurrences exist in DOM
    const eventPills = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements
        .filter((el) => el.innerText && el.innerText.includes('Weekly Architecture Sync'))
        .map((el) => el.innerText.trim());
    });
    console.log(`  Found occurrences in view: count=${eventPills.length}`);
    assert(eventPills.length >= 1, "Recurring series occurrences rendered in calendar");

    // STEP 6: Edit one occurrence (detached exception)
    console.log("\n--- [STEP 6] Edit Single Occurrence (Detached Exception) ---");
    // Click on an occurrence pill
    const occurrencePill = await page.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 10000 });
    await occurrencePill.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 10000 });
    await sleep(500);

    // Verify scope selector is visible
    const scopeContainer = await page.waitForSelector('[data-testid="recurring-scope-container"]', { timeout: 5000 });
    assert(Boolean(scopeContainer), "Scope selection container visible for recurring event");

    // Select 'Only this event'
    const scopeOccBtn = await page.waitForSelector('[data-testid="scope-occurrence-btn"]', { timeout: 5000 });
    await scopeOccBtn.click();
    await sleep(300);

    // Change title
    await page.click('[data-testid="event-title-input"]', { clickCount: 3 });
    await page.type('[data-testid="event-title-input"]', 'Architecture Sync - Detached Exception');

    // Save detached exception
    const modalSaveBtn = await page.waitForSelector('[data-testid="save-event-btn"]');
    await modalSaveBtn.click();
    await sleep(2000);

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recurrence_exception_saved.png') });
    console.log("  Successfully saved detached exception.");

    // Verify both titles now exist in the calendar view
    const updatedPills = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasException: text.includes('Architecture Sync - Detached Exception'),
        hasSeries: text.includes('Weekly Architecture Sync'),
      };
    });

    assert(updatedPills.hasException, "Detached exception title rendered in calendar");
    assert(updatedPills.hasSeries, "Master series occurrences remain rendered in calendar");

    assert(consoleErrors.length === 0, `Zero unexpected console errors (errors: ${consoleErrors.join(', ')})`);
    console.log("\nAll browser recurrence acceptance checks passed successfully!");
  } finally {
    if (browser) await browser.close();
    try {
      apiProc.kill();
    } catch {}
    try {
      webmailProc.kill();
      execSync(`taskkill /F /IM node.exe /FI "WINDOWTITLE eq npm*"`, { stdio: 'ignore' });
    } catch {}
  }
}

runCalendarRecurrenceBrowserTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
