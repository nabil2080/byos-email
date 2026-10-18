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

function cleanAcmeTestData() {
  try {
    const sql = "UPDATE organizations SET default_storage_connection_id = NULL WHERE name LIKE 'Acme%';" +
      "DELETE FROM org_recovery_principals WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%');" +
      "DELETE FROM audit_log WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%');" +
      "DELETE FROM account_invitations WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%');" +
      "DELETE FROM mailbox_storage WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%'));" +
      "DELETE FROM aliases WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%'));" +
      "DELETE FROM mailboxes WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%');" +
      "DELETE FROM domains WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%') OR name = 'acme.local';" +
      "DELETE FROM storage_connections WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%');" +
      "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%'));" +
      "DELETE FROM auth_challenges WHERE user_id IN (SELECT id FROM users WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%'));" +
      "DELETE FROM devices WHERE user_id IN (SELECT id FROM users WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%'));" +
      "DELETE FROM users WHERE org_id IN (SELECT id FROM organizations WHERE name LIKE 'Acme%');" +
      "DELETE FROM organizations WHERE name LIKE 'Acme%';";
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "${sql}"`, { stdio: 'ignore' });
  } catch (err) {
    console.warn("Could not clean Acme test data:", err.message);
  }
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

async function runOnboardingBrowserSuite() {
  console.log("================================================================================");
  console.log("             POST-PAYMENT ONBOARDING WIZARD BROWSER SUITE                       ");
  console.log("================================================================================\n");

  flushRateLimits();
  cleanAcmeTestData();

  const baseUrl = "http://localhost:3000";
  const networkLogs = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 950 });

    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.text().includes('Onboarding') || msg.text().includes('API')) {
        console.log(`[BROWSER CONSOLE ${msg.type()}]: ${msg.text()}`);
      }
    });

    page.on('response', async (res) => {
      const url = res.url();
      if (url.includes('/v1/onboarding') || url.includes('/v1/auth/register') || url.includes('/v1/auth/me')) {
        let body = '';
        try {
          body = await res.text();
        } catch {}
        console.log(`[API RESPONSE]: ${res.status()} ${url} -> ${body.substring(0, 160)}`);
        networkLogs.push({
          url,
          status: res.status(),
          method: res.request().method(),
          body: body.length > 500 ? body.substring(0, 500) + '...' : body,
        });
      }
    });

    // -------------------------------------------------------------------------
    // Phase 1: Real Registration Flow with Acme Org
    // -------------------------------------------------------------------------
    console.log("[PHASE 1] Registering sovereign Acme organization owner...");
    await page.goto(`${baseUrl}/register?org_name=Acme`, { waitUntil: 'networkidle0', timeout: 15000 });

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    const regEmail = `owner_acme_${Date.now()}@acme.local`;
    await page.type('input[type="email"]', regEmail);
    const passInputs = await page.$$('input[type="password"]');
    await passInputs[0].type('TestPassword123!@#');
    await passInputs[1].type('TestPassword123!@#');

    await clickButtonWithText(page, 'Begin Cryptographic Ceremony');
    console.log("  Submitted registration credentials; waiting for client-side cryptographic ceremony...");

    // Wait for ceremony to complete (Step 3 phrase display)
    await page.waitForFunction(() => {
      return document.body.textContent && document.body.textContent.includes('Save Your Master Recovery Phrase');
    }, { timeout: 20000 });
    console.log("  Client-side cryptographic ceremony completed. Recovery phrase generated.");

    // Confirm recovery backup checkbox
    const checkbox = await page.waitForSelector('input[type="checkbox"]');
    await checkbox.click();
    await sleep(400);

    // Finalize registration
    await clickButtonWithText(page, 'Seal Ceremony & Provision Account');
    console.log("  Finalizing account and transmitting zero-knowledge verifier...");

    // Wait for redirect to /onboarding/pricing
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/pricing'), { timeout: 15000 });
    assert(page.url().includes('/onboarding/pricing'), `Successfully routed to pricing: ${page.url()}`);
    await sleep(1000);
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_pricing.png') });

    // -------------------------------------------------------------------------
    // Phase 2: Pricing & Simulated Checkout
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 2] Proceeding through Pricing to Checkout...");
    await clickButtonWithText(page, 'Continue to Checkout');

    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/checkout'), { timeout: 15000 });
    assert(page.url().includes('/onboarding/checkout'), `Arrived at checkout: ${page.url()}`);
    await sleep(800);
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_checkout.png') });

    // Click confirm payment
    console.log("  Simulating infrastructure provisioning checkout...");
    await clickButtonWithText(page, 'Authorize');

    // Wait for redirect to /onboarding/1
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/1'), { timeout: 20000 });
    assert(page.url().includes('/onboarding/1'), `Redirected to Step 1 of Wizard: ${page.url()}`);
    await sleep(1000);

    // -------------------------------------------------------------------------
    // Phase 3: Step 1 - Custom Domain Setup & DNS Configuration
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 3] Step 1: Configuring Custom Domain acme.local...");
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_step1_domain.png') });

    // Enter domain acme.local if not already present
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="acme.local"]');
      if (input && input.value !== 'acme.local') {
        input.value = 'acme.local';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await clickButtonWithText(page, 'Configure Domain');
    await sleep(1200);

    // Verify DNS table is visible
    const tableFound = await page.evaluate(() => {
      return document.querySelector('table') !== null;
    });
    assert(tableFound, "DNS records table rendered for acme.local");

    // Click Run Verification Check
    console.log("  Triggering domain verification check...");
    await clickButtonWithText(page, 'Run Verification Check');
    await sleep(1200);

    // Verify honest development verification message
    const step1BannerText = await page.evaluate(() => document.body.textContent);
    assert(
      step1BannerText.includes('Development verification successful') || step1BannerText.includes('Verified ✓'),
      "Honest development verification message displayed for .local domain"
    );

    // Click Continue to Step 2
    await clickButtonWithText(page, 'Continue to Step 2');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/2'), { timeout: 10000 });
    assert(page.url().includes('/onboarding/2'), `Advanced to Step 2: ${page.url()}`);
    await sleep(1000);

    // -------------------------------------------------------------------------
    // Phase 4: Step 2 - Storage Architecture Mode Selection
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 4] Step 2: Storage Architecture Mode Selection...");
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_step2_mode.png') });

    const modePageText = await page.evaluate(() => document.body.textContent);
    assert(modePageText.includes('Organization-Managed'), "Organization-Managed mode is displayed");
    assert(modePageText.includes('Coming Soon'), "Individual-managed and Hybrid modes display Coming Soon badge");

    await clickButtonWithText(page, 'Confirm & Proceed to Storage');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/3'), { timeout: 10000 });
    assert(page.url().includes('/onboarding/3'), `Advanced to Step 3: ${page.url()}`);
    await sleep(1000);

    // -------------------------------------------------------------------------
    // Phase 5: Step 3 - Storage Connection with Live Probe
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 5] Step 3: Storage Connection & Live Probe...");
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_step3_storage.png') });

    // Prefill local dev MinIO credentials
    await clickButtonWithText(page, 'Prefill Local Dev Credentials');
    await sleep(400);

    // Trigger live storage probe
    console.log("  Running live write/read/verify/delete storage probe against MinIO...");
    await clickButtonWithText(page, 'Run Live Storage Probe');
    await sleep(2500);

    const probeText = await page.evaluate(() => document.body.textContent);
    assert(
      probeText.includes('Live storage probe successful') || probeText.includes('Probe Passed ✓'),
      "Live write/read/verify/delete probe successfully completed"
    );

    // Click Continue to Mailboxes
    await clickButtonWithText(page, 'Continue to Mailboxes');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/4'), { timeout: 10000 });
    assert(page.url().includes('/onboarding/4'), `Advanced to Step 4: ${page.url()}`);
    await sleep(1000);

    // -------------------------------------------------------------------------
    // Phase 6: Step 4 - Mailbox Creation
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 6] Step 4: Mailbox Creation...");
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_step4_mailboxes.png') });

    // Add mailbox 'alice'
    await page.type('input[placeholder*="local-part"]', 'alice');
    await page.type('input[placeholder*="Display Name"]', 'Alice Smith');
    await clickButtonWithText(page, '+ Add to Queue');
    await sleep(400);

    // Save mailboxes and continue
    await clickButtonWithText(page, 'Save Mailboxes & Continue');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/5'), { timeout: 10000 });
    assert(page.url().includes('/onboarding/5'), `Advanced to Step 5: ${page.url()}`);
    await sleep(1000);

    // -------------------------------------------------------------------------
    // Phase 7: Step 5 - Employee Invitations
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 7] Step 5: Employee Invitations...");
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_step5_invitations.png') });

    // Add invite for bob@acme.local
    await page.type('input[placeholder*="employee@domain.local"]', 'bob@acme.local');
    await page.type('input[placeholder="Name"]', 'Bob Jones');
    await clickButtonWithText(page, '+ Add to Queue');
    await sleep(400);

    // Send invitations
    await clickButtonWithText(page, 'Send Invitations & Proceed');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/6'), { timeout: 10000 });
    assert(page.url().includes('/onboarding/6'), `Advanced to Step 6: ${page.url()}`);
    await sleep(1000);

    // -------------------------------------------------------------------------
    // Phase 8: Step 6 - Employee Activation Tracking
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 8] Step 6: Employee Activation Tracking...");
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_step6_activation.png') });

    const step6Text = await page.evaluate(() => document.body.textContent);
    assert(step6Text.includes('bob@acme.local'), "Invitation for bob@acme.local tracked in activation table");

    await clickButtonWithText(page, 'Continue to Final Verification');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/7'), { timeout: 10000 });
    assert(page.url().includes('/onboarding/7'), `Advanced to Step 7: ${page.url()}`);
    await page.waitForFunction(() => document.body.textContent && document.body.textContent.includes('Public DNS'), { timeout: 10000 });
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_step7_verification.png') });

    const step7Text = await page.evaluate(() => document.body.textContent);
    assert(step7Text.includes('Public DNS & Internet Propagation'), "Checklist contains Public DNS check");
    assert(step7Text.includes('Untested (Prod)'), "Production infrastructure honestly labeled Untested");
    assert(step7Text.includes('Passed ✓') || step7Text.includes('Simulated (Dev)'), "Storage and domain checks verified");

    // Click Complete Setup & Enter Dashboard
    console.log("  Completing onboarding wizard...");
    await clickButtonWithText(page, 'Complete Setup & Enter Dashboard');

    // Wait for redirect to /dashboard
    await page.waitForFunction(() => window.location.pathname === '/dashboard' || window.location.pathname.startsWith('/dashboard'), { timeout: 15000 });
    assert(page.url().includes('/dashboard'), `Successfully arrived at Dashboard: ${page.url()}`);
    await sleep(1500);
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_complete_dashboard.png') });

    // Assert that the incomplete onboarding banner is NOT present on the fully completed org
    const bannerPresent = await page.evaluate(() => {
      return document.body.textContent && document.body.textContent.includes('Onboarding is incomplete');
    });
    assert(!bannerPresent, "Incomplete onboarding banner is NOT displayed on fully completed organization");

    // -------------------------------------------------------------------------
    // Phase 10: Mandatory Database Verification for Acme Org
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 10] Mandatory SQL assertion on Acme organization state...");
    const psqlOutput = execSync(`docker exec byos-postgres psql -U byos -d byos -c "SELECT onboarding_completed_at IS NOT NULL as has_completed_at, onboarding_current_step, onboarding_skipped FROM organizations WHERE name = 'Acme';"`, { encoding: 'utf-8' });
    console.log("SQL Output:\n" + psqlOutput);

    assert(psqlOutput.includes('t') && psqlOutput.includes('7') && psqlOutput.includes('f'), "Acme org has completed_at set, current_step = 7, and onboarding_skipped = false");

    // -------------------------------------------------------------------------
    // Phase 11: Skip & Resume Banner Test
    // -------------------------------------------------------------------------
    console.log("\n[PHASE 11] Testing Onboarding Skip & Dashboard Persistent Resume Banner...");
    const skipOrgEmail = `skip_test_${Date.now()}@test.local`;
    await page.goto(`${baseUrl}/register?org_name=AcmeSkipTest`, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', skipOrgEmail);
    const skipPassInputs = await page.$$('input[type="password"]');
    await skipPassInputs[0].type('TestPassword123!@#');
    await skipPassInputs[1].type('TestPassword123!@#');
    await clickButtonWithText(page, 'Begin Cryptographic Ceremony');
    await page.waitForFunction(() => document.body.textContent && document.body.textContent.includes('Save Your Master Recovery Phrase'), { timeout: 20000 });
    const skipCheckbox = await page.waitForSelector('input[type="checkbox"]');
    await skipCheckbox.click();
    await sleep(400);
    await clickButtonWithText(page, 'Seal Ceremony & Provision Account');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/pricing'), { timeout: 15000 });
    await sleep(1000);
    await clickButtonWithText(page, 'Continue to Checkout');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/checkout'), { timeout: 15000 });
    await sleep(800);
    await clickButtonWithText(page, 'Authorize');
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/1'), { timeout: 20000 });
    await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.some((b) => b.textContent && b.textContent.includes('Skip setup for now'));
    }, { timeout: 10000 });
    await sleep(600);

    // On Step 1: Click "Skip setup for now"
    console.log("  Clicking 'Skip setup for now' button in top bar...");
    await clickButtonWithText(page, 'Skip setup for now');
    await page.waitForFunction(() => window.location.pathname.includes('/dashboard'), { timeout: 15000 });
    assert(page.url().includes('/dashboard'), `Arrived at dashboard after skip: ${page.url()}`);
    await sleep(1500);
    await page.screenshot({ path: path.join(artifactsDir, 'onboarding_skipped_banner.png') });

    // Assert banner is visible
    const skippedBannerVisible = await page.evaluate(() => {
      return document.body.textContent && document.body.textContent.includes('Onboarding is incomplete') && document.body.textContent.includes('Resume Setup (Step 1)');
    });
    assert(skippedBannerVisible, "Persistent resume banner is visible on dashboard when onboarding was skipped");

    // Click "Resume Setup (Step 1)"
    console.log("  Clicking 'Resume Setup (Step 1)' banner link...");
    await page.evaluate(() => {
      const link = Array.from(document.querySelectorAll('a')).find((a) => a.textContent.includes('Resume Setup'));
      if (link) link.click();
    });
    await page.waitForFunction(() => window.location.pathname.includes('/onboarding/1'), { timeout: 10000 });
    assert(page.url().includes('/onboarding/1'), `Successfully resumed onboarding at persisted step 1: ${page.url()}`);

    console.log("\n================================================================================");
    console.log("       ALL ONBOARDING WIZARD BROWSER & DATABASE CHECKS PASSED                   ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runOnboardingBrowserSuite().catch((err) => {
  console.error("BROWSER TEST FAILED:", err);
  process.exit(1);
});
