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

function ensureAliceCleanState() {
  try {
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

async function runPasskeyBrowserSuite() {
  console.log("================================================================================");
  console.log("          WEBAUTHN PASSKEY USER INTERFACE & INTEGRATION VERIFICATION            ");
  console.log("================================================================================\n");

  flushRateLimits();
  ensureAliceCleanState();

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

  const consoleLogs = [];
  const networkRequests = [];

  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push({ type: msg.type(), text });
    if (msg.type() === 'error' && !text.includes('favicon')) {
      console.log(`  [BROWSER CONSOLE ERROR] ${text}`);
    }
  });

  page.on('request', (req) => {
    networkRequests.push({ url: req.url(), method: req.method() });
  });

  try {
    // ── STEP 1: CONTROL PLANE LOGIN PAGE PASSKEY OPTION ──
    console.log("--- [STEP 1] Inspect Control Plane Login Page Passkey Option ---");
    await page.goto("http://localhost:3000/login", { waitUntil: "networkidle2" });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    const passkeyLoginBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const found = btns.find(b => b.textContent.includes('Sign in with Passkey'));
      if (!found) return null;
      return {
        text: found.textContent.trim(),
        disabled: found.disabled,
        visible: found.offsetParent !== null,
        ariaLabel: found.getAttribute('aria-label') || ''
      };
    });

    assert(passkeyLoginBtn !== null, "Control Plane login page has 'Sign in with Passkey' button");
    assert(!passkeyLoginBtn.disabled, "Passkey login button is enabled (not disabled)");
    assert(passkeyLoginBtn.visible, "Passkey login button is visible in the viewport");

    const cpLoginScreenshot = path.resolve(artifactsDir, "control_plane_passkey_login_btn.png");
    await page.screenshot({ path: cpLoginScreenshot });
    console.log(`  Saved screenshot: ${cpLoginScreenshot}`);

    // ── STEP 2: ESTABLISH AUTHENTICATED SESSION AS ALICE ──
    console.log("\n--- [STEP 2] Establish Authenticated Session as Alice ---");
    const testSessionToken = crypto.randomBytes(32).toString('base64url');
    const tokenHashHex = crypto.createHash('sha256').update(testSessionToken).digest('hex');
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "INSERT INTO sessions (user_id, token_hash, expires_at, created_at, user_agent, ip_address) VALUES ('cccccccc-0000-0000-0000-000000000002', decode('${tokenHashHex}', 'hex'), NOW() + INTERVAL '24 hours', NOW(), 'Browser-Test-Agent', '127.0.0.1');"`);

    await page.setCookie({
      name: 'byos_cp_session',
      value: testSessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
    });

    await page.evaluate((tok) => {
      localStorage.setItem('byos_cp_session_token', tok);
    }, testSessionToken);

    await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle2" });
    assert(page.url().includes("/dashboard"), `Alice successfully landed on Dashboard (url: ${page.url()})`);

    // ── STEP 3: NAVIGATE TO SECURITY GOVERNANCE & AUDIT PASSKEY SECTION ──
    console.log("\n--- [STEP 3] Navigate to Security Governance & Audit Passkey Section ---");
    await page.goto("http://localhost:3000/dashboard/security", { waitUntil: "networkidle2" });
    await page.waitForSelector('#passkeys-section', { timeout: 10000 });
    assert(true, "Passkeys & Biometric Security section is rendered");

    // Assert that the 'Passkey Verification Temporarily Paused' banner is GONE
    const hasPausedBanner = await page.evaluate(() => {
      const section = document.querySelector('#passkeys-section');
      return section ? section.textContent.includes("Passkey Verification Temporarily Paused") : false;
    });
    assert(!hasPausedBanner, "Warning banner 'Passkey Verification Temporarily Paused' has been removed");

    // Assert that the Register New Passkey button exists and is active
    const registerBtn = await page.evaluate(() => {
      const section = document.querySelector('#passkeys-section');
      if (!section) return null;
      const btns = Array.from(section.querySelectorAll('button'));
      const found = btns.find(b => b.textContent.includes('Register New Passkey'));
      if (!found) return null;
      return {
        text: found.textContent.trim(),
        disabled: found.disabled,
      };
    });
    assert(registerBtn !== null, "Register New Passkey button is present");
    assert(!registerBtn.disabled, "Register New Passkey button is enabled and clickable");

    // ── STEP 4: OPEN PASSKEY ENROLLMENT MODAL ──
    console.log("\n--- [STEP 4] Open Passkey Enrollment Modal ---");
    await page.evaluate(() => {
      const section = document.querySelector('#passkeys-section');
      const btns = Array.from(section.querySelectorAll('button'));
      const found = btns.find(b => b.textContent.includes('Register New Passkey'));
      if (found) found.click();
    });

    await page.waitForSelector('#passkey-enroll-title', { timeout: 5000 });
    const modalTitle = await page.$eval('#passkey-enroll-title', el => el.textContent.trim());
    assert(modalTitle.includes("Enroll Passkey"), `Passkey modal opened with title: '${modalTitle}'`);

    const modalScreenshot = path.resolve(artifactsDir, "control_plane_passkey_modal.png");
    await page.screenshot({ path: modalScreenshot });
    console.log(`  Saved screenshot: ${modalScreenshot}`);

    // Capture DevTools state (network, storage, console)
    const storageDump = await page.evaluate(() => {
      return {
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
        cookiesLength: document.cookie.length,
      };
    });
    console.log("  DevTools Storage State at assertion:", JSON.stringify(storageDump));

    // Close the modal
    await page.evaluate(() => {
      const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Cancel');
      if (cancelBtn) cancelBtn.click();
    });

    // ── STEP 5: WEBMAIL LOGIN PAGE PASSKEY OPTION ──
    console.log("\n--- [STEP 5] Inspect Webmail Login Page Passkey Option ---");
    await page.goto("http://localhost:3001", { waitUntil: "networkidle2" });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });

    const webmailPasskeyBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const found = btns.find(b => b.textContent.includes('Sign in with Passkey'));
      if (!found) return null;
      return {
        text: found.textContent.trim(),
        disabled: found.disabled,
        visible: found.offsetParent !== null
      };
    });

    assert(webmailPasskeyBtn !== null, "Webmail login page has 'Sign in with Passkey' button");
    assert(!webmailPasskeyBtn.disabled, "Webmail Passkey login button is enabled");

    const webmailScreenshot = path.resolve(artifactsDir, "webmail_passkey_login_btn.png");
    await page.screenshot({ path: webmailScreenshot });
    console.log(`  Saved screenshot: ${webmailScreenshot}`);

    // ── STEP 6: RESPONSIVE VIEWPORT AUDIT (375px MOBILE VIEWPORT) ──
    console.log("\n--- [STEP 6] Responsive Viewport Audit (375px Mobile Viewport) ---");
    await page.setViewport({ width: 375, height: 812 });
    await page.goto("http://localhost:3000/dashboard/security", { waitUntil: "networkidle2" });
    await page.waitForSelector('#passkeys-section', { timeout: 10000 });

    const overflowInfo = await page.evaluate(() => {
      const scrollWidth = document.documentElement.scrollWidth;
      const clientWidth = document.documentElement.clientWidth;
      return {
        scrollWidth,
        clientWidth,
        hasHorizontalOverflow: scrollWidth > clientWidth,
      };
    });

    assert(!overflowInfo.hasHorizontalOverflow, `Mobile layout does not cause horizontal overflow (scrollWidth: ${overflowInfo.scrollWidth}px <= clientWidth: ${overflowInfo.clientWidth}px)`);

    const mobileScreenshot = path.resolve(artifactsDir, "passkey_mobile_375.png");
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    console.log("\n================================================================================");
    console.log("            WEBAUTHN PASSKEY BROWSER VERIFICATION SUITE PASSED!                 ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runPasskeyBrowserSuite().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
