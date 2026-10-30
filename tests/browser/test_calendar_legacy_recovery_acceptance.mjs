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

async function runCalendarAcceptanceTest() {
  console.log("================================================================================");
  console.log("     BYOS CALENDAR LEGACY RECOVERY REAL BROWSER ACCEPTANCE VERIFICATION         ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
  });

  const consoleLogs = [];
  const networkRequests = [];
  const migrationApiCalls = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on('console', (msg) => {
      const entry = `[BROWSER CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`;
      consoleLogs.push(entry);
      if (msg.type() === 'error' || msg.text().includes('Recovery') || msg.text().includes('Migration') || msg.text().includes('calendar')) {
        console.log(`  ${entry}`);
      }
    });

    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/stage-migration') || url.includes('/finalize-migration') || url.includes('/rollback-migration') || url.includes('/migration-status') || url.includes('/reactivate-keys')) {
        const method = req.method();
        const postData = req.postData();
        migrationApiCalls.push({ type: 'request', method, url, postData });
        console.log(`  [MIGRATION API REQ] ${method} ${url}`);
      }
    });

    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/stage-migration') || url.includes('/finalize-migration') || url.includes('/rollback-migration') || url.includes('/migration-status') || url.includes('/reactivate-keys')) {
        const status = res.status();
        let body = '';
        try {
          body = await res.text();
        } catch (_) {}
        migrationApiCalls.push({ type: 'response', status, url, body });
        console.log(`  [MIGRATION API RES] ${status} ${url} -> ${body}`);
      }
    });

    // =========================================================================
    // STEP 1: Real login flow as Alice
    // =========================================================================
    console.log("\n--- [STEP 1] Navigate to Webmail and perform real login as Alice ---");
    await page.goto('http://127.0.0.1:3005', { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await sleep(2000);
    console.log(`  Current page URL after login submit: ${page.url()}`);

    // Wait for app interface
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged into Webmail as Alice.");

    // Assert that the Historical Messages Locked banner is visible
    const lockedBannerText = await page.evaluate(() => {
      const banner = document.querySelector('button');
      return document.body.innerText;
    });
    assert(lockedBannerText.includes("Historical Messages Locked"), "Historical Messages Locked banner displayed upon login");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recovery_1_locked_banner.png') });
    console.log("  Screenshot saved: calendar_recovery_1_locked_banner.png");

    // =========================================================================
    // STEP 2: Reactivate historical keys via Settings modal
    // =========================================================================
    console.log("\n--- [STEP 2] Unseal historical mailbox keys via Reactivate Keys flow ---");
    // Click "Reactivate Keys" button in banner
    const clickedBanner = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reactivate Keys'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    assert(clickedBanner, "Found and clicked Reactivate Keys button in banner");
    await sleep(1000);

    // Now on Security tab, click "Reactivate Old Keys" button to open modal
    const clickedOldKeys = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reactivate Old Keys'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    assert(clickedOldKeys, "Found and clicked Reactivate Old Keys button in Security settings");
    await sleep(500);

    // Wait for the modal textarea and password input
    await page.waitForSelector('textarea[placeholder*="24 words"]', { timeout: 5000 });
    await page.type('textarea[placeholder*="24 words"]', 'test-password-123');
    await page.type('input[placeholder="Enter your current password"]', 'test-password-123');
    await sleep(500);

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recovery_2_key_reactivation_modal.png') });
    console.log("  Screenshot saved: calendar_recovery_2_key_reactivation_modal.png");

    // Click Unlock Historical Messages submit button
    const unlockSubmitBtn = await page.evaluateHandle(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find(b => b.innerText.includes('Unlock Historical Messages'));
    });
    assert(unlockSubmitBtn, "Found Unlock Historical Messages submit button");
    await unlockSubmitBtn.click();

    // Wait for reactivation API call to succeed and key stored
    await page.waitForFunction(() => {
      const sk = sessionStorage.getItem('byos_mailbox_sk_c0000000-0000-0000-0000-000000000001');
      return Boolean(sk && sk.length === 64);
    }, { timeout: 15000 });

    // Verify sessionStorage has mailbox secret key
    const sessionSk = await page.evaluate(() => {
      return sessionStorage.getItem('byos_mailbox_sk_c0000000-0000-0000-0000-000000000001');
    });
    assert(Boolean(sessionSk && sessionSk.length === 64), "Mailbox key restored to sessionStorage (32 bytes hex)");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recovery_3_unlocked_security.png') });
    console.log("  Screenshot saved: calendar_recovery_3_unlocked_security.png");

    // Close settings view (click Back to Inbox)
    await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await page.click('[data-testid="settings-back-to-inbox-btn"]');
    await sleep(500);

    // =========================================================================
    // STEP 3: Switch to Calendar module and detect 3 legacy events
    // =========================================================================
    console.log("\n--- [STEP 3] Switch to Calendar module and assert legacy upgrade banner ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(2000);

    // Wait for legacy upgrade banner
    await page.waitForSelector('[data-testid="calendar-legacy-upgrade-banner"]', { timeout: 10000 });
    const bannerContent = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]');
      return el ? el.innerText : '';
    });
    console.log(`  Calendar legacy banner text: "${bannerContent.replace(/\n/g, ' ')}"`);
    assert(bannerContent.includes("3 legacy unencrypted calendar events detected"), "Legacy banner detects exactly 3 unencrypted events");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recovery_4_legacy_banner_detected.png') });
    console.log("  Screenshot saved: calendar_recovery_4_legacy_banner_detected.png");

    // =========================================================================
    // STEP 4: Execute Legacy Calendar Event Recovery
    // =========================================================================
    console.log("\n--- [STEP 4] Click 'Upgrade to End-to-End Encryption' and execute recovery workflow ---");
    const upgradeBtn = await page.evaluateHandle(() => {
      const banner = document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]');
      if (!banner) return null;
      return Array.from(banner.querySelectorAll('button')).find(b => b.innerText.includes('Upgrade to End-to-End Encryption'));
    });
    assert(upgradeBtn, "Found Upgrade to End-to-End Encryption button");
    await upgradeBtn.click();

    // Wait for migration success banner
    console.log("  Waiting for recovery workflow to complete across all 3 legacy events...");
    try {
      await page.waitForSelector('[data-testid="calendar-legacy-upgrade-success"]', { timeout: 15000 });
    } catch (waitErr) {
      const errBannerText = await page.evaluate(() => {
        const errEl = document.querySelector('[data-testid="calendar-legacy-upgrade-error"]');
        const bannerEl = document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]');
        return {
          errorBanner: errEl ? errEl.innerText : null,
          banner: bannerEl ? bannerEl.innerText : null,
          bodySnippet: document.body.innerText.slice(0, 500)
        };
      });
      console.log("  [DEBUG AT FAILURE]", JSON.stringify(errBannerText, null, 2));
      await page.screenshot({ path: path.join(artifactsDir, 'calendar_recovery_failure_debug.png') });
      console.log("  Screenshot saved: calendar_recovery_failure_debug.png");
      console.log("  [ALL CONSOLE LOGS]");
      for (const log of consoleLogs) {
        console.log("    ", log);
      }
      throw waitErr;
    }

    const successContent = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-legacy-upgrade-success"]');
      return el ? el.innerText : '';
    });
    console.log(`  Upgrade success banner text: "${successContent.replace(/\n/g, ' ')}"`);
    assert(successContent.includes("Successfully upgraded 3 legacy calendar event(s)"), "Success banner confirms 3 legacy events migrated to E2EE");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recovery_5_upgrade_success.png') });
    console.log("  Screenshot saved: calendar_recovery_5_upgrade_success.png");

    // Assert that the legacy upgrade banner is now hidden
    const legacyBannerStillPresent = await page.evaluate(() => {
      return Boolean(document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]'));
    });
    assert(!legacyBannerStillPresent, "Legacy upgrade banner is no longer displayed after upgrade");

    // =========================================================================
    // STEP 5: Page reload & verify zero legacy records detected and clean decrypt
    // =========================================================================
    console.log("\n--- [STEP 5] Reload page and verify clean calendar state ---");
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);

    // Check module or switch back to calendar if necessary
    const currentTab = await page.evaluate(() => {
      const calTab = document.querySelector('[data-testid="nav-calendar-tab"]');
      return calTab ? calTab.classList.contains('bg-white') : false;
    });
    if (!currentTab) {
      await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
      await page.click('[data-testid="nav-calendar-tab"]');
      await sleep(2000);
    }

    const legacyBannerAfterReload = await page.evaluate(() => {
      return Boolean(document.querySelector('[data-testid="calendar-legacy-upgrade-banner"]'));
    });
    assert(!legacyBannerAfterReload, "Zero legacy records detected after page reload");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_recovery_6_reloaded_decrypted.png') });
    console.log("  Screenshot saved: calendar_recovery_6_reloaded_decrypted.png");

    console.log("\n================================================================================");
    console.log("             ALL BROWSER ACCEPTANCE CHECKS SUCCEEDED!                           ");
    console.log("================================================================================\n");

    return {
      success: true,
      migrationApiCalls,
      consoleLogs: consoleLogs.slice(-30),
    };

  } finally {
    await browser.close();
  }
}

runCalendarAcceptanceTest()
  .then((res) => {
    fs.writeFileSync(path.join(artifactsDir, 'acceptance_summary.json'), JSON.stringify(res, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error("Browser Acceptance Test FAILED:", err);
    process.exit(1);
  });
