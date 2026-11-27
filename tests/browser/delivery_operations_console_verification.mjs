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

async function runDeliveryOperationsVerification() {
  console.log('================================================================');
  console.log('--- Starting C6.5.1 Delivery Operations Console Verification ---');
  console.log('================================================================');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO F: Server-Side Authorization & Zero-Knowledge Verification
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Scenario F] Testing Server-Side Authorization & Zero-Knowledge Enforcement...');

  // Unauthenticated API request must be rejected with HTTP 401
  const unauthRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/overview');
  assert(unauthRes.status === 401, `Unauthenticated GET /admin/v1/queue/overview rejected with HTTP ${unauthRes.status}`);

  const unauthListRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages');
  assert(unauthListRes.status === 401, `Unauthenticated GET /admin/v1/queue/messages rejected with HTTP ${unauthListRes.status}`);

  const unauthReconcileRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000003/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'add_note', operator_reason: 'unauthorized test' })
  });
  assert(unauthReconcileRes.status === 401, `Unauthenticated POST reconcile rejected with HTTP ${unauthReconcileRes.status}`);

  // Perform dev login to inspect zero-knowledge payload
  const loginRes = await fetch('http://127.0.0.1:8087/admin/v1/auth/mock-login', { method: 'POST' });
  assert(loginRes.ok, `Dev mock login returned HTTP ${loginRes.status}`);
  const cookieHeader = loginRes.headers.get('set-cookie') || '';
  const tokenMatch = cookieHeader.match(/byos_admin_session=([^;]+)/);
  const sessionToken = tokenMatch ? tokenMatch[1] : 'mock-support-agent';

  // Fetch messages directly and assert absence of ciphertext
  const listDataRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages?limit=10', {
    headers: { 'Cookie': `byos_admin_session=${sessionToken}` }
  });
  assert(listDataRes.ok, `Authenticated GET /admin/v1/queue/messages returned HTTP ${listDataRes.status}`);
  const rawJsonText = await listDataRes.text();
  assert(!rawJsonText.includes('encrypted_message'), 'Zero-Knowledge invariant: encrypted_message NEVER present in JSON response');
  assert(!rawJsonText.includes('send_token_hpke_wrapped'), 'Zero-Knowledge invariant: send_token_hpke_wrapped NEVER present in JSON response');
  assert(!rawJsonText.includes('raw_body'), 'Zero-Knowledge invariant: raw_body not present in JSON response');

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO A: Queue Overview & Console Launch in Support CRM
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Scenario A] Navigating to Support CRM and opening Delivery Operations Console...');
  await page.goto('http://localhost:3003', { waitUntil: 'networkidle0' });
  await sleep(1000);

  // Assert basic CRM layout loaded
  const initialText = await page.evaluate(() => document.body.innerText);
  assert(initialText.includes('sarah.support@byos.local'), 'Operator Sarah Chen identity displayed');
  assert(initialText.includes('Delivery Queue'), 'Delivery Queue navigation button rendered');

  // Switch to Delivery Queue Tab
  console.log('Switching to Delivery Queue tab...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('aside nav button'));
    const qBtn = btns.find((b) => b.innerText.includes('Delivery Queue'));
    qBtn?.click();
  });
  await sleep(1200);

  // Assert Queue Overview elements
  const queuePageText = await page.evaluate(() => document.body.innerText);
  assert(queuePageText.includes('QUEUE STATUS'), 'Queue Status header rendered');
  assert(queuePageText.includes('Pending'), 'Pending KPI card rendered');
  assert(queuePageText.includes('Outcome Unknown') || queuePageText.includes('Unknown'), 'Outcome Unknown KPI card rendered');
  assert(queuePageText.includes('Delivered'), 'Delivered KPI card rendered');
  assert(queuePageText.includes('Bounced'), 'Bounced KPI card rendered');
  assert(queuePageText.includes('dave.investigation@target.net'), 'Seeded ambiguous outcome_unknown record rendered in table');
  assert(queuePageText.includes('eve.reconcile@secure.io'), 'Seeded durable outcome_unknown record rendered in table');
  assert(queuePageText.includes('carol.partner@enterprise.org'), 'Seeded processing record rendered in table');

  await page.screenshot({ path: path.join(artifactsDir, 'delivery_console_overview.png') });
  console.log('Saved delivery_console_overview.png');

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO B: Filtering and Detail View Investigation
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Scenario B] Testing table filtering and opening ambiguous outcome_unknown item...');
  await page.evaluate(() => {
    const filterBtns = Array.from(document.querySelectorAll('button'));
    const unkBtn = filterBtns.find((b) => b.innerText.toLowerCase() === 'outcome unknown');
    unkBtn?.click();
  });
  await sleep(600);

  // Click Investigate on dave.investigation@target.net
  const clickedInvestigate = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const targetRow = rows.find((r) => r.innerText.includes('dave.investigation@target.net'));
    if (targetRow) {
      const btn = targetRow.querySelector('button');
      btn?.click();
      return true;
    }
    return false;
  });
  assert(clickedInvestigate, 'Clicked Investigate for dave.investigation@target.net');
  await sleep(800);

  // Switch to Metadata tab to inspect full envelope telemetry
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const metaTab = tabs.find((b) => b.innerText.trim() === 'Metadata');
    metaTab?.click();
  });
  await sleep(400);

  // Assert Modal opened with metadata
  const modalText = await page.evaluate(() => document.body.innerText);
  assert(modalText.includes('Envelope:'), 'Envelope detail modal rendered');
  assert(modalText.includes('dave.investigation@target.net'), 'Recipient matches selected envelope');
  assert(modalText.includes('QUEUE ID'), 'Queue ID metadata rendered');
  assert(modalText.includes('DELIVERY ID'), 'Delivery ID metadata rendered');

  await page.screenshot({ path: path.join(artifactsDir, 'delivery_console_investigation_detail.png') });
  console.log('Saved delivery_console_investigation_detail.png');

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO C: Unknown Outcome Investigation & Adding Note
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Scenario C] Testing Investigation & Actions tab and adding non-mutating operator note...');
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  const actionTabText = await page.evaluate(() => document.body.innerText);
  assert(actionTabText.includes("The remote mail server's acceptance has not been conclusively established"), 'Warning banner for outcome_unknown rendered');
  assert(actionTabText.includes('AMBIGUOUS (Terminator in Flight)'), 'Evidence classification correctly marks ambiguous phase');

  // Add an operator investigation note
  await page.evaluate(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Investigated downstream MTA. Remote peer dropped socket without returning 250 OK or 4xx code.';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Submit Note
  await page.evaluate(() => {
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(
      (b) => b.innerText.includes('Record Investigation Note')
    );
    submitBtn?.click();
  });
  await sleep(1000);

  // Assert Audit tab is now active and contains the note
  const auditTabText = await page.evaluate(() => document.body.innerText);
  assert(auditTabText.includes('add_note'), 'Audit log contains action "add_note"');
  assert(auditTabText.includes('Investigated downstream MTA'), 'Audit log contains operator reason text');

  await page.screenshot({ path: path.join(artifactsDir, 'delivery_console_note_added.png') });
  console.log('Saved delivery_console_note_added.png');

  // Close modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('button[aria-label="Close modal"]');
    closeBtn?.click();
  });
  await sleep(500);

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO D: Evidence-Based Acceptance Reconciliation
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Scenario D] Testing authoritative acceptance reconciliation for eve.reconcile@secure.io...');
  const clickedEve = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const targetRow = rows.find((r) => r.innerText.includes('eve.reconcile@secure.io'));
    if (targetRow) {
      const btn = targetRow.querySelector('button');
      btn?.click();
      return true;
    }
    return false;
  });
  assert(clickedEve, 'Opened modal for eve.reconcile@secure.io');
  await sleep(800);

  // Switch to Investigation & Actions
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  // Select "Confirm Accepted"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const confirmBtn = btns.find((b) => b.innerText.includes('Confirm Accepted'));
    confirmBtn?.click();
  });
  await sleep(400);

  // Fill in evidence and reason
  await page.evaluate(() => {
    const select = document.querySelector('select');
    if (select) {
      select.value = 'mta_log_receipt';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const input = document.querySelector('input[placeholder*="Queue ID"]');
    if (input) {
      input.value = 'Postfix Queue ID 4X8mK9';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Authoritative mail gateway logs confirmed 250 OK message acceptance under Queue ID 4X8mK9.';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Submit acceptance
  await page.evaluate(() => {
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(
      (b) => b.innerText.includes('Confirm Acceptance')
    );
    submitBtn?.click();
  });
  await sleep(1200);

  // Assert modal transitioned to audit with resolve_accepted
  const postAcceptAuditText = await page.evaluate(() => document.body.innerText);
  assert(postAcceptAuditText.includes('resolve_accepted'), 'Audit trail records action "resolve_accepted"');
  assert(postAcceptAuditText.includes('outcome_unknown ➔ delivered'), 'Audit trail records transition "outcome_unknown ➔ delivered"');

  await page.screenshot({ path: path.join(artifactsDir, 'delivery_console_reconciled_accepted.png') });
  console.log('Saved delivery_console_reconciled_accepted.png');

  // Close modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('button[aria-label="Close modal"]');
    closeBtn?.click();
  });
  await sleep(500);

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO E: Explicit Retransmission Authorization
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Scenario E] Testing explicit retransmission authorization for dave.investigation@target.net...');
  const clickedDaveAgain = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const targetRow = rows.find((r) => r.innerText.includes('dave.investigation@target.net'));
    if (targetRow) {
      const btn = targetRow.querySelector('button');
      btn?.click();
      return true;
    }
    return false;
  });
  assert(clickedDaveAgain, 'Re-opened modal for dave.investigation@target.net');
  await sleep(800);

  // Switch to Investigation & Actions
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  // Select "Authorize Retry"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const retryBtn = btns.find((b) => b.innerText.includes('Authorize Retry'));
    retryBtn?.click();
  });
  await sleep(400);

  const retryFormText = await page.evaluate(() => document.body.innerText);
  assert(retryFormText.includes('Duplicate Delivery Acknowledgment:'), 'Duplicate delivery acknowledgment warning displayed');

  // Attempt submit without checkbox -> assert validation catches it
  await page.evaluate(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Attempt without ack';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(
      (b) => b.innerText.includes('Authorize Retransmission')
    );
    submitBtn?.click();
  });
  await sleep(400);
  const validationErrorText = await page.evaluate(() => document.body.innerText);
  assert(validationErrorText.includes('explicitly acknowledge the duplicate delivery risk'), 'Validation prevents retry without duplicate risk acknowledgment');

  // Check the checkbox and fill in evidence
  await page.evaluate(() => {
    const checkbox = document.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const select = document.querySelector('select');
    if (select) {
      select.value = 'recipient_inbound_log';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const input = document.querySelector('input[placeholder*="Queue ID"]');
    if (input) {
      input.value = 'Customer Support Ticket #8921';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Recipient IT department confirmed non-receipt in edge exchange logs. Retransmission authorized.';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Submit retry authorization
  await page.evaluate(() => {
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(
      (b) => b.innerText.includes('Authorize Retransmission')
    );
    submitBtn?.click();
  });
  await sleep(1200);

  // Assert audit record
  const postRetryAuditText = await page.evaluate(() => document.body.innerText);
  assert(postRetryAuditText.includes('authorize_retry'), 'Audit trail records action "authorize_retry"');
  assert(postRetryAuditText.includes('outcome_unknown ➔ pending'), 'Audit trail records transition "outcome_unknown ➔ pending"');

  await page.screenshot({ path: path.join(artifactsDir, 'delivery_console_retry_authorized.png') });
  console.log('Saved delivery_console_retry_authorized.png');

  // ─────────────────────────────────────────────────────────────────
  // SCENARIO G: Audit History Verification
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Scenario G] Verifying full immutable operator audit ledger display...');
  await page.screenshot({ path: path.join(artifactsDir, 'delivery_console_audit_trail.png') });
  console.log('Saved delivery_console_audit_trail.png');

  await browser.close();
  console.log('\n================================================================');
  console.log('--- ALL C6.5.1 DELIVERY OPERATIONS VERIFICATION CHECKS PASSED ---');
  console.log('================================================================');
}

runDeliveryOperationsVerification().catch((err) => {
  console.error('Delivery Operations Verification failed:', err);
  process.exit(1);
});
