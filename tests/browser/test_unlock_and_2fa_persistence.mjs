import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const DISPOSABLE_DB = 'byos_recovery_disposable_20261024';
const API_PORT = '8097';
const WEBMAIL_PORT = '3015';

const consoleErrors = [];

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

function base32ToBuffer(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = base32.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function getTOTPCode(secret, timeSeconds = Math.floor(Date.now() / 1000)) {
  const key = base32ToBuffer(secret);
  const counter = Math.floor(timeSeconds / 30);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

async function runUnlockAnd2FAPersistenceBrowserTest() {
  console.log("================================================================================");
  console.log("   MAILBOX UNLOCK & 2FA REMOVAL PERSISTENCE END-TO-END BROWSER TEST            ");
  console.log("================================================================================\n");

  const aliceUserId = 'cccccccc-0000-0000-0000-000000000002';
  const aliceMailboxId = 'c0000000-0000-0000-0000-000000000001';
  const aliceEmail = 'alice@byos.local';
  const alicePassword = 'test-password-123';
  const passwordHash = '$argon2id$v=19$m=65536,t=3,p=2$2K4LPnHGYrPq+76HQK2hKQ$ol3Z1nfC344rKLOp1Yk+k02FCS4ohM+O9uRp51YUlgg';

  console.log("1. Preparing disposable fixture in database:", DISPOSABLE_DB);
  const fixtureSql = `
    UPDATE users 
    SET password_hash = '${passwordHash}', 
        two_factor_enabled = false, 
        totp_secret = NULL, 
        is_active = true 
    WHERE id = '${aliceUserId}';

    DELETE FROM user_passkeys WHERE user_id = '${aliceUserId}';
  `;
  execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB}`, { input: fixtureSql });

  // Flush redis rate limits
  try {
    execSync('docker exec byos-redis redis-cli FLUSHALL', { stdio: 'ignore' });
  } catch {}

  // 1. Spawn disposable API on port 8097
  console.log(`2. Starting disposable API on port ${API_PORT}...`);
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

  // 2. Spawn disposable Webmail on port 3015
  console.log(`3. Starting disposable Webmail on port ${WEBMAIL_PORT}...`);
  const webmailProc = spawn('cmd.exe', ['/c', 'npm.cmd', 'run', 'dev', '--', '--port', WEBMAIL_PORT, '--host', '127.0.0.1'], {
    cwd: path.join(repoRoot, 'apps', 'webmail'),
    env: {
      ...process.env,
      VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
    },
    stdio: 'ignore',
  });

  let browser;

  try {
    console.log("4. Waiting for API and Webmail to become ready...");
    await waitForHttp(`http://127.0.0.1:${API_PORT}/v1/health`);
    await waitForHttp(`http://127.0.0.1:${WEBMAIL_PORT}`);
    console.log("  Disposable test services ready.\n");

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-setuid-sandbox',
        '--window-size=1280,900',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && !text.includes('/v1/auth/me') && !text.includes('favicon') && !text.includes('401')) {
        consoleErrors.push(text);
      }
    });

    // Capture network responses for verification audit
    const networkLog = [];
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/v1/auth/') || url.includes('/v1/mailboxes')) {
        let body = '';
        try {
          body = await response.text();
        } catch {}
        networkLog.push({
          method: response.request().method(),
          url: url,
          status: response.status(),
          body: body.length > 300 ? body.slice(0, 300) + '...' : body,
        });
      }
    });

    // ── STEP 1: INITIAL LOGIN ──
    console.log("--- [STEP 1] Initial Login to Webmail as Alice ---");
    await page.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', aliceEmail);
    await page.type('input[type="password"]', alicePassword);
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice into Webmail.");

    // ── STEP 2: NAVIGATE TO SETTINGS -> SECURITY TAB ──
    console.log("\n--- [STEP 2] Navigate to Settings -> Security ---");
    const settingsBtn = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 8000 });
    await settingsBtn.click();
    await sleep(500);

    const securityTab = await page.waitForSelector('[data-testid="settings-tab-security"]', { timeout: 8000 });
    await securityTab.click();
    await sleep(800);

    // Verify initial 2FA status is "2FA Inactive" and button is "Set Up Authenticator"
    const initial2FABadge = await page.waitForFunction(
      () => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.find((s) => s.textContent && (s.textContent.includes('2FA Inactive') || s.textContent.includes('2FA Active')));
      },
      { timeout: 8000 }
    );
    const initialBadgeText = await initial2FABadge.evaluate((el) => el.textContent.trim());
    assert(initialBadgeText.includes('2FA Inactive'), `Initial 2FA status is '2FA Inactive' (got: '${initialBadgeText}')`);

    const setupBtn = await page.waitForSelector('button ::-p-text(Set Up Authenticator)', { timeout: 5000 });
    assert(setupBtn !== null, "Set Up Authenticator button is present when 2FA is inactive");

    // ── STEP 3: ENROLL TOTP (SETUP 2FA) ──
    console.log("\n--- [STEP 3] Enroll TOTP Authenticator ---");
    await setupBtn.click();
    await sleep(800);

    // Extract secret key from setup modal
    await page.waitForFunction(() => {
      const modal = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('Set Up Authenticator App'))?.closest('.fixed');
      return !!modal?.querySelector('.select-all');
    }, { timeout: 6000 });
    const secretText = await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('Set Up Authenticator App'))?.closest('.fixed');
      return modal?.querySelector('.select-all')?.textContent?.trim() || '';
    });
    console.log(`  Extracted TOTP secret: ${secretText}`);
    assert(secretText.length >= 16, `Valid TOTP secret key rendered in modal (length: ${secretText.length})`);

    const totpCode = getTOTPCode(secretText);
    console.log(`  Generated RFC 6238 TOTP code: ${totpCode}`);
    assert(totpCode.length === 6, `Generated 6-digit TOTP code (${totpCode})`);

    const codeInput = await page.waitForSelector('input[maxlength="6"]', { timeout: 5000 });
    await codeInput.type(totpCode);
    await sleep(300);

    const activateBtn = await page.waitForSelector('button ::-p-text(Activate 2FA)', { timeout: 5000 });
    await activateBtn.click();

    // Wait for modal to close and badge to become "2FA Active"
    await page.waitForFunction(
      () => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.some((s) => s.textContent && s.textContent.includes('2FA Active'));
      },
      { timeout: 8000 }
    );
    console.log("  TOTP activated successfully. Status dynamically changed to '2FA Active'.");

    // Verify "Disable 2FA" button is now present
    const disableBtn = await page.waitForSelector('button ::-p-text(Disable 2FA)', { timeout: 5000 });
    assert(disableBtn !== null, "Disable 2FA button is displayed when 2FA is active");

    const configuredScreenshot = path.join(artifactsDir, 'webmail_2fa_configured.png');
    await page.screenshot({ path: configuredScreenshot });
    console.log(`  Saved screenshot: ${configuredScreenshot}`);

    // Verify DB state confirms 2FA enabled
    const sqlActive = execSync(`docker exec byos-postgres psql -U byos -d ${DISPOSABLE_DB} -t -A -c "SELECT two_factor_enabled FROM users WHERE id='${aliceUserId}';"`)
      .toString().trim();
    assert(sqlActive === 't', `Postgres confirms two_factor_enabled = true for Alice (got: '${sqlActive}')`);

    // ── STEP 4: DISABLE 2FA ──
    console.log("\n--- [STEP 4] Disable 2FA with Password Confirmation ---");
    await disableBtn.click();
    await sleep(600);

    // Wait for disable modal
    const pwdInput = await page.waitForSelector('input[placeholder="Account password"]', { timeout: 5000 });
    await pwdInput.type(alicePassword);
    await sleep(300);

    const confirmDisableBtn = await page.waitForSelector('button ::-p-text(Confirm & Disable 2FA)', { timeout: 5000 });
    await confirmDisableBtn.click();

    // Wait for modal to close and badge to revert to "2FA Inactive"
    await page.waitForFunction(
      () => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.some((s) => s.textContent && s.textContent.includes('2FA Inactive'));
      },
      { timeout: 8000 }
    );
    console.log("  2FA disabled successfully. Status dynamically changed to '2FA Inactive'.");

    const setupBtnReappeared = await page.waitForSelector('button ::-p-text(Set Up Authenticator)', { timeout: 5000 });
    assert(setupBtnReappeared !== null, "Set Up Authenticator button reappeared after disabling 2FA");

    // Verify DB state confirms 2FA disabled
    const sqlInactive = execSync(`docker exec byos-postgres psql -U byos -d ${DISPOSABLE_DB} -t -A -c "SELECT two_factor_enabled FROM users WHERE id='${aliceUserId}';"`)
      .toString().trim();
    assert(sqlInactive === 'f', `Postgres confirms two_factor_enabled = false for Alice (got: '${sqlInactive}')`);

    // ── STEP 5: TEST RELOAD PERSISTENCE (ISSUE 2 VERIFICATION) ──
    console.log("\n--- [STEP 5] Page Reload: Verify 2FA Does NOT Reappear as Active ---");
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    // Re-open settings -> security tab
    const settingsBtnAfterReload = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 8000 });
    await settingsBtnAfterReload.click();
    await sleep(500);

    const secTabAfterReload = await page.waitForSelector('[data-testid="settings-tab-security"]', { timeout: 8000 });
    await secTabAfterReload.click();
    await sleep(800);

    // Assert that badge is STILL '2FA Inactive' and button is STILL 'Set Up Authenticator'
    const badgeAfterReload = await page.waitForFunction(
      () => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.find((s) => s.textContent && (s.textContent.includes('2FA Inactive') || s.textContent.includes('2FA Active')));
      },
      { timeout: 8000 }
    );
    const badgeTextAfterReload = await badgeAfterReload.evaluate((el) => el.textContent.trim());
    assert(badgeTextAfterReload.includes('2FA Inactive'), `2FA remains inactive after page reload (got: '${badgeTextAfterReload}')`);

    const setupBtnAfterReload = await page.waitForSelector('button ::-p-text(Set Up Authenticator)', { timeout: 5000 });
    assert(setupBtnAfterReload !== null, "Set Up Authenticator button persists after reload");

    // Query 2FA API status from page to confirm server returned two_factor_enabled = false
    const apiStatus = await page.evaluate(async () => {
      const token = sessionStorage.getItem('byos_active_session_token');
      const res = await fetch('/v1/auth/2fa/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return await res.json();
    });
    console.log("  /v1/auth/2fa/status response:", JSON.stringify(apiStatus));
    assert(apiStatus.two_factor_enabled === false, "Server reports two_factor_enabled = false");
    assert(apiStatus.has_totp === false, "Server reports has_totp = false");
    assert(apiStatus.has_passkey === false, "Server reports has_passkey = false");

    const disabledAfterReloadScreenshot = path.join(artifactsDir, 'webmail_2fa_disabled_after_reload.png');
    await page.screenshot({ path: disabledAfterReloadScreenshot });
    console.log(`  Saved screenshot: ${disabledAfterReloadScreenshot}`);

    // ── STEP 6: TEST MAILBOX UNLOCK WITH 2FA ACTIVE (ISSUE 1 VERIFICATION) ──
    console.log("\n--- [STEP 6] Test Mailbox Unlock with 2FA Active ---");
    // 6a. Re-enable TOTP so 2FA is active
    await setupBtnAfterReload.click();
    await sleep(800);

    await page.waitForFunction(() => {
      const modal = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('Set Up Authenticator App'))?.closest('.fixed');
      return !!modal?.querySelector('.select-all');
    }, { timeout: 6000 });
    const secretText2 = await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes('Set Up Authenticator App'))?.closest('.fixed');
      return modal?.querySelector('.select-all')?.textContent?.trim() || '';
    });
    const totpCode2 = getTOTPCode(secretText2);
    const codeInput2 = await page.waitForSelector('input[maxlength="6"]', { timeout: 5000 });
    await codeInput2.type(totpCode2);
    await sleep(300);

    const activateBtn2 = await page.waitForSelector('button ::-p-text(Activate 2FA)', { timeout: 5000 });
    await activateBtn2.click();

    await page.waitForFunction(
      () => {
        const spans = Array.from(document.querySelectorAll('span'));
        return spans.some((s) => s.textContent && s.textContent.includes('2FA Active'));
      },
      { timeout: 8000 }
    );
    console.log("  2FA re-activated on Alice's account.");

    // 6b. Close Settings and return to Inbox
    const backBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backBtn.click();
    await sleep(800);

    // 6c. Simulate locked mailbox state:
    // Remove secret keys from session memory & storage to simulate locked keys
    console.log("  Simulating locked mailbox keys in session memory...");
    await page.evaluate((mbId) => {
      if (typeof window.__BYOS_TEST_LOCK_MAILBOX__ === 'function') {
        window.__BYOS_TEST_LOCK_MAILBOX__(mbId);
      } else {
        sessionStorage.removeItem('byos_mailbox_sk_' + mbId);
        sessionStorage.removeItem('byos_xwing_seed_' + mbId);
      }
    }, aliceMailboxId);

    // Verify in sessionStorage that key is gone
    const keyInStorage = await page.evaluate((mbId) => {
      return sessionStorage.getItem('byos_mailbox_sk_' + mbId);
    }, aliceMailboxId);
    assert(keyInStorage === null, "Mailbox secret key successfully evicted from sessionStorage (locked)");

    // Open account switcher dropdown
    const chipSelector = await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 5000 });
    await chipSelector.click();
    await sleep(500);

    // Click Alice's account row in dropdown to trigger unlock prompt
    const aliceAccountRow = await page.waitForSelector(`[data-testid="account-dropdown-${aliceMailboxId}"]`, { timeout: 5000 });
    await aliceAccountRow.click();
    await sleep(600);

    // Verify Unlock Modal is presented
    const unlockModalHeading = await page.waitForFunction(
      () => {
        const h3s = Array.from(document.querySelectorAll('h3'));
        return h3s.some(h => h.textContent && h.textContent.includes('Unlock') && h.textContent.includes('alice@byos.local'));
      },
      { timeout: 8000 }
    );
    assert(unlockModalHeading !== null, "Unlock modal appeared: 'Unlock alice@byos.local'");

    const unlockModalScreenshot = path.join(artifactsDir, 'webmail_unlock_modal_with_2fa.png');
    await page.screenshot({ path: unlockModalScreenshot });
    console.log(`  Saved screenshot: ${unlockModalScreenshot}`);

    // Enter Alice's password into unlock modal
    const unlockPwdInput = await page.waitForSelector('[data-testid="unlock-account-password-input"]', { timeout: 5000 });
    await unlockPwdInput.type(alicePassword);
    await sleep(300);

    // Submit unlock
    const unlockSubmitBtn = await page.waitForSelector('[data-testid="unlock-account-submit-btn"]', { timeout: 5000 });
    await unlockSubmitBtn.click();

    // Assert that unlock succeeds:
    // 1. Modal closes (unlock-account-password-input disappears)
    // 2. No error banner [data-testid="unlock-account-error"]
    // 3. sessionStorage now has byos_mailbox_sk_<aliceMailboxId> restored!
    await page.waitForFunction(
      () => {
        return document.querySelector('[data-testid="unlock-account-password-input"]') === null;
      },
      { timeout: 10000 }
    );
    console.log("  Unlock modal dismissed successfully.");

    const restoredKey = await page.evaluate((mbId) => {
      return sessionStorage.getItem('byos_mailbox_sk_' + mbId);
    }, aliceMailboxId);
    assert(restoredKey !== null && restoredKey.length === 64, `Mailbox secret key restored in sessionStorage (length: ${restoredKey ? restoredKey.length : 0})`);

    const unlockSuccessScreenshot = path.join(artifactsDir, 'webmail_unlock_success.png');
    await page.screenshot({ path: unlockSuccessScreenshot });
    console.log(`  Saved screenshot: ${unlockSuccessScreenshot}`);

    // ── STEP 7: MOBILE 375PX RESPONSIVE AUDIT ──
    console.log("\n--- [STEP 7] Mobile 375px Viewport Audit ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(800);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(scrollWidth <= 375, `Mobile 375px viewport has no horizontal overflow: scrollWidth=${scrollWidth}px <= 375px`);

    const mobileScreenshot = path.join(artifactsDir, 'webmail_unlock_mobile_375px.png');
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    // Dump storage and network state for evidence report
    const storageDump = await page.evaluate((mbId) => {
      return {
        hasSessionToken: !!sessionStorage.getItem('byos_active_session_token'),
        hasMailboxSk: !!sessionStorage.getItem('byos_mailbox_sk_' + mbId),
        activeAccount: localStorage.getItem('byos_active_account_id'),
      };
    }, aliceMailboxId);
    console.log("  Storage Dump at completion:", JSON.stringify(storageDump));

    console.log("\n================================================================================");
    console.log("     ALL BROWSER PERSISTENCE & UNLOCK CHECKS PASSED SUCCESSFULLY!               ");
    console.log("================================================================================\n");

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (apiProc && !apiProc.killed) {
      apiProc.kill();
    }
    if (webmailProc && !webmailProc.killed) {
      execSync(`taskkill /PID ${webmailProc.pid} /T /F 2>nul || exit 0`, { shell: 'cmd.exe' });
    }
  }
}

runUnlockAnd2FAPersistenceBrowserTest().catch((err) => {
  console.error("FATAL BROWSER TEST ERROR:", err);
  if (consoleErrors.length > 0) {
    console.error("Browser console errors:\n", consoleErrors.join("\n"));
  }
  process.exit(1);
});
