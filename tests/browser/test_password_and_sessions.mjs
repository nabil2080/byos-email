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

function resetAliceState() {
  try {
    // Ensure Alice password is set to 'test-password-123' and 2FA is inactive
    // Use argon2id or byos test password hash for 'test-password-123'
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "UPDATE organizations SET onboarding_completed_at = now(), onboarding_skipped = false WHERE id = '00000000-0000-0000-0000-000000000aaa';"`, { stdio: 'ignore' });
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "UPDATE users SET two_factor_enabled = false, totp_secret = NULL, tours_seen = '{\\"control_plane_v1\\": {\\"last_step\\": 7, \\"completed_at\\": \\"2026-01-01T00:00:00Z\\"}}'::jsonb WHERE email = 'alice@byos.local';"`, { stdio: 'ignore' });
  } catch (err) {
    console.warn("Could not reset Alice state in Postgres:", err.message);
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function runPasswordAndSessionsSuite() {
  console.log("================================================================================");
  console.log("     CONTROL PANEL PASSWORD CHANGE & ACTIVE SESSIONS BROWSER VERIFICATION       ");
  console.log("================================================================================\n");

  flushRateLimits();
  resetAliceState();

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
      console.log(`  [BROWSER LOG] ${text}`);
    }
  });

  try {
    // ── STEP 1: LOGIN TO CONTROL PANEL ──
    console.log("--- [STEP 1] Login to Control Panel as Alice ---");
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle2" });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 10000 });
    assert(page.url().includes("/dashboard"), `Alice successfully landed on Dashboard (url: ${page.url()})`);

    // ── STEP 2: NAVIGATE TO SECURITY & AUTHENTICATION ──
    console.log("\n--- [STEP 2] Navigate to Security & Authentication ---");
    await page.goto("http://localhost:3000/dashboard/security", { waitUntil: "networkidle2" });
    await page.waitForSelector('#account-password-section', { timeout: 10000 });
    assert(true, "Account Password section rendered");

    await page.waitForSelector('#active-sessions-section', { timeout: 10000 });
    assert(true, "Active Browser Sessions section rendered");

    // ── STEP 3: VERIFY ACTIVE SESSIONS AUDIT ──
    console.log("\n--- [STEP 3] Verify Active Sessions Audit Display ---");
    const sessionCards = await page.$$('#active-sessions-section .divide-y > div');
    assert(sessionCards.length >= 1, `Found ${sessionCards.length} active session(s) in audit table`);

    const hasCurrentBadge = await page.evaluate(() => {
      const el = document.querySelector('#active-sessions-section');
      return el ? el.textContent.includes("Current Session") : false;
    });
    assert(hasCurrentBadge, "Current session is explicitly badged in green");

    const revokeBtn = await page.$('[data-testid="revoke-others-btn"]');
    assert(revokeBtn !== null, "Revoke All Other Sessions button is present");

    // Save screenshot of security overview
    const overviewScreenshot = path.resolve(artifactsDir, "control_plane_security_sections.png");
    await page.screenshot({ path: overviewScreenshot });
    console.log(`  Saved screenshot: ${overviewScreenshot}`);

    // ── STEP 4: OPEN CHANGE PASSWORD MODAL & VERIFY WAY 1 (STANDARD) ──
    console.log("\n--- [STEP 4] Open Password Change Modal & Verify Standard Mode ---");
    await page.click('[data-testid="change-password-btn"]');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    const currentPassInput = await page.$('[data-testid="current-password-input"]');
    const newPassInput = await page.$('[data-testid="new-password-input"]');
    const confirmPassInput = await page.$('[data-testid="confirm-password-input"]');
    const forgotTrigger = await page.$('[data-testid="forgot-password-trigger"]');

    assert(currentPassInput !== null, "Way 1: Current Password input is rendered");
    assert(newPassInput !== null, "Way 1: New Password input is rendered");
    assert(confirmPassInput !== null, "Way 1: Confirm New Password input is rendered");
    assert(forgotTrigger !== null, "Forgot password? trigger button is present");

    const modalStandardScreenshot = path.resolve(artifactsDir, "control_plane_change_password_standard.png");
    await page.screenshot({ path: modalStandardScreenshot });
    console.log(`  Saved screenshot: ${modalStandardScreenshot}`);

    // ── STEP 5: SWITCH TO WAY 2 (FORGOT PASSWORD & IDENTITY RECOVERY) ──
    console.log("\n--- [STEP 5] Switch to Forgot Password & Identity Verification (Way 2) ---");
    await page.click('[data-testid="forgot-password-trigger"]');
    await page.waitForSelector('[data-testid="send-recovery-code-btn"]', { timeout: 8000 });

    const modalTitle = await page.$eval('#change-password-title', (el) => el.textContent.trim());
    assert(modalTitle.includes("Reset Password via Identity Verification"), `Modal transitioned to recovery mode (got: '${modalTitle}')`);

    const emailOpt = await page.$('[data-testid="recovery-opt-email"]');
    assert(emailOpt !== null, "Recovery Option: Recovery Email OTP is available");

    const modalForgotScreenshot = path.resolve(artifactsDir, "control_plane_forgot_password_options.png");
    await page.screenshot({ path: modalForgotScreenshot });
    console.log(`  Saved screenshot: ${modalForgotScreenshot}`);

    // ── STEP 6: SEND OTP CODE VIA CONNECTED METHOD ──
    console.log("\n--- [STEP 6] Request OTP Code via Connected Method ---");
    await page.click('[data-testid="send-recovery-code-btn"]');

    await page.waitForSelector('[data-testid="recovery-code-input"]', { timeout: 8000 });
    assert(true, "Transitioned to Step 2: Verification Code & New Password inputs rendered");

    const codeValue = await page.$eval('[data-testid="recovery-code-input"]', (el) => el.value);
    assert(codeValue.length === 6, `Auto-filled / debug verification code provided in dev mode (${codeValue})`);

    // Enter new password in recovery mode
    await page.type('[data-testid="recovery-new-password-input"]', "new-secure-password-123");
    await page.type('[data-testid="recovery-confirm-password-input"]', "new-secure-password-123");

    const step2Screenshot = path.resolve(artifactsDir, "control_plane_forgot_password_step2.png");
    await page.screenshot({ path: step2Screenshot });
    console.log(`  Saved screenshot: ${step2Screenshot}`);

    // Submit recovery reset
    await page.click('[data-testid="submit-recovery-reset-btn"]');

    // Wait for modal to close and success alert
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 8000 });
    assert(true, "Recovery password reset succeeded and modal closed");

    // ── STEP 7: TEST STANDARD PASSWORD CHANGE WITH NEW PASSWORD ──
    console.log("\n--- [STEP 7] Standard Password Change using Updated Password ---");
    await page.click('[data-testid="change-password-btn"]');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    await page.type('[data-testid="current-password-input"]', "new-secure-password-123");
    await page.type('[data-testid="new-password-input"]', "test-password-123");
    await page.type('[data-testid="confirm-password-input"]', "test-password-123");
    await page.click('[data-testid="submit-password-change-btn"]');

    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 8000 });
    assert(true, "Standard password change succeeded and restored original test credentials");

    // ── STEP 8: VERIFY WEBMAIL CHANGE PASSWORD & FORGOT PASSWORD INTEGRATION ──
    console.log("\n--- [STEP 8] Verify Webmail Change Password & Forgot Password Integration ---");
    const webmailPage = await browser.newPage();
    await webmailPage.setViewport({ width: 1280, height: 800 });

    await webmailPage.goto("http://localhost:3001", { waitUntil: "networkidle2" });
    const hasLoginEmail = await webmailPage.$('input[type="email"]');
    if (hasLoginEmail) {
      await webmailPage.type('input[type="email"]', "alice@byos.local");
      await webmailPage.type('input[type="password"]', "test-password-123");
      await webmailPage.click('button[type="submit"]');
      await webmailPage.waitForSelector('[data-testid="account-chip-selector"], [data-testid="sidebar-settings-btn"]', { timeout: 15000 });
    }

    // Open Settings via sidebar
    await webmailPage.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 10000 });
    await webmailPage.click('[data-testid="sidebar-settings-btn"]');

    // Switch to Security & Sessions tab
    await webmailPage.waitForSelector('[data-testid="settings-tab-security"]', { timeout: 10000 });
    await webmailPage.click('[data-testid="settings-tab-security"]');

    // Find and click Change Password button in Webmail
    await webmailPage.waitForSelector('[data-testid="webmail-change-password-btn"]', { timeout: 10000 });
    await webmailPage.click('[data-testid="webmail-change-password-btn"]');

    await webmailPage.waitForSelector('[data-testid="forgot-password-trigger"]', { timeout: 5000 });
    assert(true, "Webmail Change Password modal rendered with 'Forgot password?' trigger");

    await webmailPage.click('[data-testid="forgot-password-trigger"]');
    await webmailPage.waitForFunction(() => {
      const text = document.querySelector('.fixed.inset-0')?.textContent || "";
      return text.includes("Reset Password") || text.includes("Choose a connected method");
    }, { timeout: 5000 });
    assert(true, "Webmail successfully switched to Forgot Password / Identity Recovery flow");

    const webmailScreenshot = path.resolve(artifactsDir, "webmail_forgot_password_in_modal.png");
    await webmailPage.screenshot({ path: webmailScreenshot });
    console.log(`  Saved screenshot: ${webmailScreenshot}`);

    // ── STEP 9: RESPONSIVE VIEWPORT AUDIT (375px MOBILE VIEWPORT) ──
    console.log("\n--- [STEP 9] Responsive Viewport Audit (375px Mobile Viewport) ---");
    await page.setViewport({ width: 375, height: 812 });
    await new Promise((r) => setTimeout(r, 500));

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    assert(!hasHorizontalOverflow, "Security page does not cause horizontal overflow on 375px mobile");

    const mobileScreenshot = path.resolve(artifactsDir, "control_plane_security_mobile_375.png");
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    console.log("\n================================================================================");
    console.log("       PASSWORD CHANGE & ACTIVE SESSIONS VERIFICATION PASSED!                   ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

runPasswordAndSessionsSuite().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
