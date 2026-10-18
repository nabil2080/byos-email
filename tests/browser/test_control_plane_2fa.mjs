import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

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

function ensureAliceClean2FAState() {
  try {
    // Reset Alice to 2FA inactive, ensure org completed and tours seen so no onboarding redirect or tour popover interferes
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "UPDATE organizations SET onboarding_completed_at = now(), onboarding_skipped = false WHERE id = '00000000-0000-0000-0000-000000000aaa';"`, { stdio: 'ignore' });
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "UPDATE users SET two_factor_enabled = false, totp_secret = NULL, tours_seen = '{\\"control_plane_v1\\": {\\"last_step\\": 7, \\"completed_at\\": \\"2026-01-01T00:00:00Z\\"}}'::jsonb WHERE email = 'alice@byos.local';"`, { stdio: 'ignore' });
  } catch (err) {
    console.warn("Could not set Alice state in Postgres:", err.message);
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runControlPlane2FASuite() {
  console.log("================================================================================");
  console.log("          CONTROL PANEL TWO-FACTOR AUTHENTICATION BROWSER TEST SUITE           ");
  console.log("================================================================================\n");

  flushRateLimits();
  ensureAliceClean2FAState();

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1280,800',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' && !text.includes('favicon')) {
      console.log(`  [BROWSER ERROR] ${text}`);
    }
  });

  try {
    // ── STEP 1: INITIAL LOGIN ──
    console.log("--- [STEP 1] Initial Login to Control Panel as Alice ---");
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle2" });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 10000 });
    const currentUrl = page.url();
    assert(currentUrl.includes("/dashboard"), `Alice successfully landed on Dashboard (url: ${currentUrl})`);

    // ── STEP 2: NAVIGATE TO SECURITY VIA SETTINGS ──
    console.log("\n--- [STEP 2] Navigate to Security Governance via Settings Card ---");
    await page.goto("http://localhost:3000/dashboard/settings", { waitUntil: "networkidle2" });
    await page.waitForSelector('a[href="/dashboard/security"]', { timeout: 10000 });

    // Click Two-Factor Authentication link/card
    const tfaLinks = await page.$$('a[href="/dashboard/security"]');
    assert(tfaLinks.length >= 1, "Two-Factor Authentication card is linked to /dashboard/security");
    await tfaLinks[tfaLinks.length - 1].click();

    await page.waitForFunction(() => window.location.pathname === "/dashboard/security", { timeout: 8000 });
    assert(page.url().includes("/dashboard/security"), "Navigated directly to /dashboard/security");

    // ── STEP 3: VERIFY INITIAL 2FA STATUS (INACTIVE) ──
    console.log("\n--- [STEP 3] Verify Initial 2FA Status is Inactive ---");
    await page.waitForSelector('[data-testid="2fa-status-badge"]', { timeout: 5000 });
    const initialBadgeText = await page.$eval('[data-testid="2fa-status-badge"]', (el) => el.textContent.trim());
    assert(initialBadgeText.includes("2FA Inactive"), `Initial status badge is '2FA Inactive' (got: '${initialBadgeText}')`);

    const setupBtn = await page.$('[data-testid="setup-totp-btn"]');
    assert(setupBtn !== null, "Set Up Authenticator button is present when 2FA is inactive");

    // ── STEP 4: OPEN TOTP SETUP MODAL & EXTRACT SECRET ──
    console.log("\n--- [STEP 4] Open TOTP Setup Modal & Extract QR Code and Secret ---");
    await page.click('[data-testid="setup-totp-btn"]');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    const qrCodeSvg = await page.$('[role="dialog"] svg');
    assert(qrCodeSvg !== null, "QR Code vector SVG is rendered in setup modal");

    const secretText = await page.$eval('[role="dialog"] .select-all', (el) => el.textContent.trim());
    assert(secretText.length >= 16, `Valid TOTP secret key rendered in modal (length: ${secretText.length}, secret: ${secretText.slice(0, 8)}...)`);

    // ── STEP 5: GENERATE VALID 6-DIGIT TOTP CODE & ACTIVATE ──
    console.log("\n--- [STEP 5] Generate TOTP Code and Complete Activation ---");
    const totpCode = getTOTPCode(secretText);
    console.log(`  Computed RFC 6238 TOTP code: ${totpCode}`);
    assert(totpCode.length === 6, `Generated 6-digit TOTP code (${totpCode})`);

    const codeInput = await page.$('[role="dialog"] input[inputmode="numeric"]');
    await codeInput.type(totpCode);

    await page.click('[data-testid="activate-2fa-btn"]');

    // Wait for modal to close and status badge to update to Active
    await page.waitForFunction(
      () => {
        const badge = document.querySelector('[data-testid="2fa-status-badge"]');
        return badge && badge.textContent.includes("2FA Active");
      },
      { timeout: 8000 }
    );

    const activeBadgeText = await page.$eval('[data-testid="2fa-status-badge"]', (el) => el.textContent.trim());
    assert(activeBadgeText.includes("2FA Active"), `Status badge dynamically updated to '2FA Active' (got: '${activeBadgeText}')`);

    const disableBtn = await page.$('[data-testid="disable-totp-btn"]');
    assert(disableBtn !== null, "Disable 2FA button is now displayed");

    // Save screenshot of enabled 2FA state
    const enabledScreenshot = path.resolve(artifactsDir, "control_plane_2fa_enabled.png");
    await page.screenshot({ path: enabledScreenshot });
    console.log(`  Saved screenshot: ${enabledScreenshot}`);

    // Verify in PostgreSQL
    const sqlCheckActive = execSync(`docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT two_factor_enabled FROM users WHERE email='alice@byos.local';"`)
      .toString().trim();
    assert(sqlCheckActive === 't', `Postgres confirms two_factor_enabled = true for Alice (got: '${sqlCheckActive}')`);

    // ── STEP 6: VERIFY 2FA CHALLENGE UPON RE-LOGIN ──
    console.log("\n--- [STEP 6] Logout and Verify 2FA Challenge Screen on Re-Login ---");
    // Clear cookies & localStorage/sessionStorage
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');

    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle2" });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    flushRateLimits();
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    // Wait for 2FA Challenge screen
    await page.waitForFunction(
      () => document.body.textContent.includes("2-Step Verification Active") || document.body.textContent.includes("Two-Step Verification"),
      { timeout: 8000 }
    );

    const headingText = await page.$eval('h1', (el) => el.textContent.trim());
    assert(headingText.includes("Two-Step Verification"), `Page displays 'Two-Step Verification' challenge (got: '${headingText}')`);

    // Save screenshot of 2FA login challenge screen
    const challengeScreenshot = path.resolve(artifactsDir, "control_plane_2fa_login_challenge.png");
    await page.screenshot({ path: challengeScreenshot });
    console.log(`  Saved screenshot: ${challengeScreenshot}`);

    // ── STEP 7: SUBMIT TOTP CODE ON CHALLENGE & COMPLETE LOGIN ──
    console.log("\n--- [STEP 7] Submit 6-digit TOTP Code and Complete Sign-In ---");
    const freshCode = getTOTPCode(secretText);
    const challengeCodeInput = await page.$('input[inputmode="numeric"]');
    assert(challengeCodeInput !== null, "6-digit numeric input is rendered on challenge screen");
    await challengeCodeInput.type(freshCode);

    await page.click('button[type="submit"]');
    await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 10000 });

    const post2FAUrl = page.url();
    assert(post2FAUrl.includes("/dashboard"), `Successfully authenticated through 2FA and reached dashboard (url: ${post2FAUrl})`);

    // ── STEP 8: DISABLE 2FA ──
    console.log("\n--- [STEP 8] Navigate to Security Governance and Disable 2FA ---");
    await page.goto("http://localhost:3000/dashboard/security", { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="disable-totp-btn"]', { timeout: 8000 });

    await page.click('[data-testid="disable-totp-btn"]');
    await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: 5000 });

    await page.type('[role="dialog"] input[type="password"]', "test-password-123");
    await page.click('[data-testid="confirm-disable-2fa-btn"]');

    // Wait for modal to close and status badge to revert to Inactive
    await page.waitForFunction(
      () => {
        const badge = document.querySelector('[data-testid="2fa-status-badge"]');
        return badge && badge.textContent.includes("2FA Inactive");
      },
      { timeout: 8000 }
    );

    const revertedBadgeText = await page.$eval('[data-testid="2fa-status-badge"]', (el) => el.textContent.trim());
    assert(revertedBadgeText.includes("2FA Inactive"), `Status badge reverted to '2FA Inactive' (got: '${revertedBadgeText}')`);

    // Save screenshot of disabled 2FA state
    const disabledScreenshot = path.resolve(artifactsDir, "control_plane_2fa_disabled.png");
    await page.screenshot({ path: disabledScreenshot });
    console.log(`  Saved screenshot: ${disabledScreenshot}`);

    // Verify in PostgreSQL
    const sqlCheckInactive = execSync(`docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT two_factor_enabled FROM users WHERE email='alice@byos.local';"`)
      .toString().trim();
    assert(sqlCheckInactive === 'f', `Postgres confirms two_factor_enabled = false for Alice (got: '${sqlCheckInactive}')`);

    // ── STEP 9: RESPONSIVE VIEWPORT TEST (375px) ──
    console.log("\n--- [STEP 9] Responsive Viewport Audit (375px Mobile Viewport) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const overflowWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert(overflowWidth <= 375, `Mobile layout does not cause horizontal overflow (scrollWidth: ${overflowWidth}px <= 375px)`);

    const mobileScreenshot = path.resolve(artifactsDir, "control_plane_2fa_mobile_375.png");
    await page.screenshot({ path: mobileScreenshot, fullPage: true });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    console.log("\n================================================================================");
    console.log("        CONTROL PANEL TWO-FACTOR AUTHENTICATION VERIFICATION PASSED!            ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runControlPlane2FASuite().catch((err) => {
  console.error("FATAL BROWSER TEST ERROR:", err);
  process.exit(1);
});
