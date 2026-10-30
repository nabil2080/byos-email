import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const API_PORT = 8094;
const WEBMAIL_PORT = 3014;

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

async function executeActiveCalendarRecovery() {
  console.log("================================================================================");
  console.log("     ACTIVE BYOS CALENDAR LEGACY RECOVERY BROWSER VERIFICATION SUITE            ");
  console.log("================================================================================\n");

  let webmailProc = null;
  let browser = null;

  try {
    // 1. Start Webmail Vite instance on port 3014
    console.log(`1. Launching Webmail on port ${WEBMAIL_PORT} connected to API on port ${API_PORT}...`);
    webmailProc = spawn('cmd.exe', ['/c', 'npx', 'vite', '--port', String(WEBMAIL_PORT), '--strictPort'], {
      cwd: path.resolve(__dirname, '../../apps/webmail'),
      env: {
        ...process.env,
        VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
        VITE_API_BASE: '',
      },
      stdio: 'ignore',
    });

    // 2. Wait for Webmail to become ready
    console.log("2. Waiting for Webmail to become ready...");
    let ready = false;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${WEBMAIL_PORT}`);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (_) {}
      await sleep(1000);
    }
    assert(ready, "Webmail service ready on port " + WEBMAIL_PORT);

    // 3. Launch Puppeteer browser
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    const consoleLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      consoleLogs.push(`[${msg.type()}] ${text}`);
      if (text.includes('recovery') || text.includes('migration') || text.includes('calendar') || msg.type() === 'error') {
        console.log(`  [Console ${msg.type()}] ${text}`);
      }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 1: Real login flow as Alice on active byos
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [STEP 1] Real login as Alice on active byos database ---");
    await page.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice.");

    // Check for Historical Messages Locked banner or Reactivate Keys
    const hasHistoricalLocked = await page.evaluate(() => {
      return document.body.innerText.includes("Historical Messages Locked");
    });

    if (hasHistoricalLocked) {
      console.log("  Reactivating historical keys via Security settings...");
      const clickedBanner = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reactivate Keys'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      assert(clickedBanner, "Found and clicked Reactivate Keys button in banner");
      await sleep(1000);

      const clickedOldKeys = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reactivate Old Keys'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      assert(clickedOldKeys, "Found and clicked Reactivate Old Keys button in Security settings");
      await sleep(500);

      await page.waitForSelector('textarea[placeholder*="24 words"]', { timeout: 5000 });
      await page.type('textarea[placeholder*="24 words"]', 'test-password-123');
      await page.type('input[placeholder="Enter your current password"]', 'test-password-123');
      await sleep(500);

      const unlockSubmitBtn = await page.evaluateHandle(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.find(b => b.innerText.includes('Unlock Historical Messages'));
      });
      assert(unlockSubmitBtn, "Found Unlock Historical Messages submit button");
      await unlockSubmitBtn.click();

      // Wait for key material to be unsealed
      await page.waitForFunction(() => {
        const sk = sessionStorage.getItem('byos_mailbox_sk_c0000000-0000-0000-0000-000000000001');
        return Boolean(sk && sk.length === 64);
      }, { timeout: 15000 });

      console.log("  Historical keys reactivated and restored to sessionStorage.");

      // Close settings view
      await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
      await page.click('[data-testid="settings-back-to-inbox-btn"]');
      await sleep(500);
    } else {
      console.log("  Mailbox key already active in session.");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 2: Navigate to Calendar module and detect 3 legacy events
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [STEP 2] Navigate to Calendar tab and detect 3 legacy events ---");
    const calTab = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTab.click();
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(2000);

    await page.waitForSelector('[data-testid="calendar-legacy-upgrade-banner"]', { timeout: 10000 });
    const bannerText = await page.$eval('[data-testid="calendar-legacy-upgrade-banner"]', el => el.innerText.trim());
    console.log(`  Calendar legacy banner detected: "${bannerText.replace(/\n/g, ' ')}"`);
    assert(bannerText.includes("3 legacy unencrypted calendar events detected"), "Legacy banner detects exactly 3 unencrypted events");

    const detectedScreenshot = path.join(artifactsDir, 'active_calendar_recovery_1_detected.png');
    await page.screenshot({ path: detectedScreenshot });
    console.log(`  Saved screenshot: ${detectedScreenshot}`);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 3: Execute non-destructive recovery upgrade workflow
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [STEP 3] Execute Upgrade to End-to-End Encryption ---");
    const upgradeBtn = await page.evaluateHandle(() => {
      const banner = document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]');
      if (!banner) return null;
      return Array.from(banner.querySelectorAll('button')).find(b => b.innerText.includes('Upgrade to End-to-End Encryption'));
    });
    assert(upgradeBtn, "Found Upgrade to End-to-End Encryption button");
    await upgradeBtn.click();

    console.log("  Executing non-destructive 4-phase recovery workflow across all 3 events...");
    await page.waitForSelector('[data-testid="calendar-legacy-upgrade-success"]', { timeout: 20000 });

    const successText = await page.$eval('[data-testid="calendar-legacy-upgrade-success"]', el => el.innerText.trim());
    console.log(`  Upgrade success banner: "${successText.replace(/\n/g, ' ')}"`);
    assert(successText.includes("Successfully upgraded 3 legacy calendar event(s)"), "Success banner confirms all 3 legacy events finalized");

    const successScreenshot = path.join(artifactsDir, 'active_calendar_recovery_2_success.png');
    await page.screenshot({ path: successScreenshot });
    console.log(`  Saved screenshot: ${successScreenshot}`);

    // Assert that the legacy upgrade banner is removed
    const legacyBannerStillPresent = await page.evaluate(() => {
      return Boolean(document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]'));
    });
    assert(!legacyBannerStillPresent, "Legacy upgrade banner dismissed from DOM");

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 4: Reload page and verify clean calendar state & decrypted events
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [STEP 4] Reload page and verify clean calendar state ---");
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2000);

    const calTabAfterReload = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTabAfterReload.click();
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1500);

    const legacyBannerAfterReload = await page.evaluate(() => {
      return Boolean(document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]'));
    });
    assert(!legacyBannerAfterReload, "Zero legacy records detected after page reload");

    // Switch to Month view to inspect all 3 events
    const monthBtn = await page.waitForSelector('[data-testid="view-month-btn"]', { timeout: 5000 });
    await monthBtn.click();
    await sleep(1000);

    const eventPills = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.filter(e => e.innerText && (e.innerText.includes('BYOS Architecture Review') || e.innerText.includes('Phase 5 Architecture Sync'))).map(e => e.innerText.trim());
    });
    assert(eventPills.length >= 2, `Events decrypted and rendered cleanly in Month view (rendered count: ${eventPills.length})`);

    const reloadedScreenshot = path.join(artifactsDir, 'active_calendar_recovery_3_reloaded_decrypted.png');
    await page.screenshot({ path: reloadedScreenshot });
    console.log(`  Saved screenshot: ${reloadedScreenshot}`);

    // ═════════════════════════════════════════════════════════════════════════
    // STEP 5: Database Invariant Verification
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [STEP 5] Database Invariant Verification on active byos ---");

    const totalCount = execSync('docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT count(*) FROM calendar_events;"').toString().trim();
    assert(totalCount === '3', `Total calendar_events count is exactly 3 (got: ${totalCount})`);

    const encryptedCount = execSync('docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT count(*) FROM calendar_events WHERE encode(substr(encrypted_payload, 1, 1), \'hex\') = \'01\';"').toString().trim();
    assert(encryptedCount === '3', `All 3 calendar_events are encrypted AES-256-GCM wire envelopes with version 0x01 (got: ${encryptedCount})`);

    const plaintextCount = execSync('docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT count(*) FROM calendar_events WHERE encode(substr(encrypted_payload, 1, 1), \'escape\') = \'{\';"').toString().trim();
    assert(plaintextCount === '0', `Zero unencrypted plaintext JSON records remain (got: ${plaintextCount})`);

    const migrationsFinalized = execSync('docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT count(*) FROM calendar_event_migrations WHERE status = \'finalized\' AND legacy_payload IS NULL;"').toString().trim();
    assert(migrationsFinalized === '3', `All 3 migrations are finalized with legacy plaintext purged (legacy_payload IS NULL) (got: ${migrationsFinalized})`);

    console.log("\n================================================================================");
    console.log("    ACTIVE BYOS CALENDAR LEGACY RECOVERY COMPLETED SUCCESSFULLY!                ");
    console.log("================================================================================\n");

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (webmailProc && !webmailProc.killed) {
      execSync(`taskkill /PID ${webmailProc.pid} /T /F 2>nul || exit 0`, { shell: 'cmd.exe' });
    }
  }
}

executeActiveCalendarRecovery().catch((err) => {
  console.error("FATAL ACTIVE RECOVERY ERROR:", err);
  process.exit(1);
});
