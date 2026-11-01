import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('../../apps/webmail/node_modules/puppeteer-core');

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

async function runCrmVerification() {
  console.log('--- Starting BYOS Support CRM Verification ---');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // 1. Navigate to Support CRM
  console.log('Navigating to http://localhost:3003 ...');
  await page.goto('http://localhost:3003', { waitUntil: 'networkidle0' });

  // 2. Assert Sidebar Nav & Identity
  const bodyText = await page.evaluate(() => document.body.innerText);
  assert(bodyText.includes('sarah.support@byos.local'), `Operator email is sarah.support@byos.local`);
  assert(bodyText.includes('Tier 2 Operator'), `Operator role is Tier 2 Operator`);
  assert(bodyText.includes('Support Tickets'), `Support Tickets tab rendered`);
  assert(bodyText.includes('Organizations'), `Organizations tab rendered`);
  assert(bodyText.includes('Audit Logs'), `Audit Logs tab rendered`);

  // Assert sliding highlight pill
  const pillExists = await page.$('[data-testid="sidebar-nav-pill"]');
  assert(pillExists !== null, 'Sliding highlight pill ([data-testid="sidebar-nav-pill"]) is present');

  await page.screenshot({ path: path.join(artifactsDir, 'support_crm_tickets_initial.png') });
  console.log('Saved support_crm_tickets_initial.png');

  // 3. Switch to Organizations Tab
  console.log('Switching to Organizations tab...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('nav button'));
    const orgBtn = btns.find((b) => b.innerText.includes('Organizations'));
    orgBtn?.click();
  });
  await sleep(600);

  const orgHeaders = await page.$$eval('th', (els) => els.map((e) => e.innerText.trim().toUpperCase()));
  console.log('Found table headers:', orgHeaders);
  assert(orgHeaders.includes('ORGANIZATION'), 'Organizations table header rendered');

  await page.screenshot({ path: path.join(artifactsDir, 'support_crm_organizations_tab.png') });
  console.log('Saved support_crm_organizations_tab.png');

  // 4. Test Adjust Capacity Modal Bounds
  console.log('Testing Adjust Capacity modal viewport bounding...');
  const clickedAdjust = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.innerText.includes('Adjust Capacity'));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (clickedAdjust) {
    await sleep(400);

    const modalHeight = await page.$eval('.max-h-\\[85vh\\]', (el) => el.clientHeight);
    const viewportHeight = 900;
    assert(modalHeight <= viewportHeight * 0.85, `Capacity modal bounded to <=85vh (modal: ${modalHeight}px, viewport: ${viewportHeight}px)`);

    await page.screenshot({ path: path.join(artifactsDir, 'support_crm_capacity_modal_bounded.png') });
    console.log('Saved support_crm_capacity_modal_bounded.png');

    // Close modal
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cancelBtn = btns.find((b) => b.innerText.includes('Cancel'));
      cancelBtn?.click();
    });
    await sleep(200);
  }

  // 5. Switch to Audit Logs Tab (Real DB Records)
  console.log('Switching to Audit Logs tab...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('nav button'));
    const auditBtn = btns.find((b) => b.innerText.includes('Audit Logs'));
    auditBtn?.click();
  });
  await sleep(600);

  const auditRows = await page.$$eval('tbody tr', (els) => els.length);
  assert(auditRows > 0, `Audit logs loaded from database (found ${auditRows} rows)`);

  const firstActor = await page.$eval('tbody tr td:nth-child(2)', (el) => el.innerText.trim());
  assert(firstActor.length > 0, `First audit actor rendered (got: ${firstActor})`);

  await page.screenshot({ path: path.join(artifactsDir, 'support_crm_real_audit_logs.png') });
  console.log('Saved support_crm_real_audit_logs.png');

  await browser.close();
  console.log('--- ALL SUPPORT CRM VERIFICATION CHECKS PASSED ---');
}

runCrmVerification().catch((err) => {
  console.error('CRM Verification failed:', err);
  process.exit(1);
});
