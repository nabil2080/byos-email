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

async function runC652Verification() {
  console.log('================================================================');
  console.log('--- Starting BYOS Release C6.5.2 Reconciliation Verification ---');
  console.log('================================================================');

  // ─────────────────────────────────────────────────────────────────
  // PART 1: Server-Side RBAC Enforcement & Anti-Spoofing
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Pillar 4] Testing Server-Side RBAC Enforcement & Anti-Spoofing Defenses...');

  // 1. Unauthenticated request -> 401
  const unauthRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/overview');
  assert(unauthRes.status === 401, `Unauthenticated request returned HTTP ${unauthRes.status} (expected 401)`);

  // 2. Ordinary User Role -> 403 Forbidden
  const ordUserRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/overview', {
    headers: { 'Authorization': 'Bearer mock-ordinary-user' }
  });
  assert(ordUserRes.status === 403, `Ordinary user role rejected with HTTP ${ordUserRes.status} (expected 403)`);

  // 3. Organization Admin Role -> 403 Forbidden
  const orgAdminRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/overview', {
    headers: { 'Authorization': 'Bearer mock-org-admin' }
  });
  assert(orgAdminRes.status === 403, `Org admin role rejected with HTTP ${orgAdminRes.status} (expected 403)`);

  // 4. Read-Only Operator: Read allowed (200), Mutation forbidden (403)
  const roReadRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/overview', {
    headers: { 'Authorization': 'Bearer mock-readonly-operator' }
  });
  assert(roReadRes.status === 200, `Read-only operator read succeeded with HTTP ${roReadRes.status} (expected 200)`);

  const roMutateRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-readonly-operator',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'add_note', operator_reason: 'unauthorized read-only attempt' })
  });
  assert(roMutateRes.status === 403, `Read-only operator mutation rejected with HTTP ${roMutateRes.status} (expected 403)`);
  const roMutateBody = await roMutateRes.json();
  assert(roMutateBody.error.includes('read-only operator cannot perform queue mutations'), 'Rejection cited read-only operator restriction');

  // 5. Header Spoofing Defeated: Read-only token with forged X-Operator-Role: platform_admin -> 403
  const spoofRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-readonly-operator',
      'Content-Type': 'application/json',
      'X-Operator-Role': 'platform_admin',
      'X-Operator-Email': 'attacker@evil.com',
      'X-Operator-Id': 'attacker-1'
    },
    body: JSON.stringify({ action: 'add_note', operator_reason: 'spoofed header attempt' })
  });
  assert(spoofRes.status === 403, `Spoofed X-Operator-Role header defeated! Returned HTTP ${spoofRes.status} (expected 403)`);

  // 6. Support Agent: Authorized mutation -> 200
  const supportMutateRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'add_note', operator_reason: 'legitimate support agent review' })
  });
  assert(supportMutateRes.status === 200, `Support agent mutation authorized with HTTP ${supportMutateRes.status} (expected 200)`);

  // ─────────────────────────────────────────────────────────────────
  // PART 2: Browser Verification in Support CRM UI
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Pillar 1 & 2 & 3] Launching Puppeteer browser verification...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // Navigate to Support CRM
  await page.goto('http://localhost:3003', { waitUntil: 'networkidle0' });
  await sleep(1000);

  // Switch to Delivery Queue
  console.log('Navigating to Delivery Queue Console...');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('aside nav button'));
    const qBtn = btns.find((b) => b.innerText.includes('Delivery Queue'));
    qBtn?.click();
  });
  await sleep(1200);

  // ── CHECK A: Active Worker Lease Conflict ──
  console.log('\n[Pillar 2 Check] Testing Active Worker Lease Conflict...');
  // Find carol.partner@enterprise.org (which holds an active lease in 'processing')
  const clickedActiveLease = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const targetRow = rows.find((r) => r.innerText.includes('carol.partner@enterprise.org'));
    if (targetRow) {
      const btn = targetRow.querySelector('button');
      btn?.click();
      return true;
    }
    return false;
  });
  assert(clickedActiveLease, 'Opened detail modal for carol.partner@enterprise.org (active lease)');
  await sleep(800);

  // Switch to Actions tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  // Try to submit a note or resolve action
  await page.evaluate(() => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Attempting reconcile on active lease';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Try direct API call to assert lease fencing error message
  const leaseConflictRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000003/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'resolve_bounced', operator_reason: 'conflict test' })
  });
  assert(leaseConflictRes.status === 409, `Reconciliation on active worker lease returned HTTP ${leaseConflictRes.status} (expected 409)`);
  const leaseConflictJson = await leaseConflictRes.json();
  assert(leaseConflictJson.error.includes('active worker lease held'), `Conflict error correctly reports: ${leaseConflictJson.error}`);

  await page.screenshot({ path: path.join(artifactsDir, 'c652_active_lease_conflict.png') });
  console.log('Saved c652_active_lease_conflict.png');

  // Close modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('button[aria-label="Close modal"]');
    closeBtn?.click();
  });
  await sleep(500);

  // ── CHECK B: Retransmission Blocked for Confirmed Remote MTA Acceptance ──
  console.log('\n[Pillar 1 Check] Testing Retransmission Prevention on Confirmed Acceptance...');
  // Direct API call on alice.accepted@remote.org (has smtp_phase = 'accepted_by_mta')
  const retryAcceptedRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000007/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'authorize_retry',
      operator_reason: 'accidental duplicate attempt',
      evidence_category: 'mta_log_receipt',
      evidence_reference: 'MTA-TEST',
      duplicate_risk_acknowledged: true
    })
  });
  assert(retryAcceptedRes.status === 409, `Retry on accepted_by_mta returned HTTP ${retryAcceptedRes.status} (expected 409)`);
  const retryAcceptedJson = await retryAcceptedRes.json();
  assert(retryAcceptedJson.error.includes('remote MTA has already durably accepted this message'), 'Conflict correctly blocked retransmission of accepted message');

  // ── CHECK C: Authorize Retry Warning Banner & Evidence Disclaimer in UI ──
  console.log('\n[Pillars 1 & 3 Check] Verifying Retry Warning Banner and Evidence Disclaimer in UI...');
  const clickedDave = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const targetRow = rows.find((r) => r.innerText.includes('dave.investigation@target.net'));
    if (targetRow) {
      const btn = targetRow.querySelector('button');
      btn?.click();
      return true;
    }
    return false;
  });
  assert(clickedDave, 'Opened detail modal for dave.investigation@target.net');
  await sleep(800);

  // Switch to Actions tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  // Click "Authorize Retry"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const retryBtn = btns.find((b) => b.innerText.includes('Authorize Retry'));
    retryBtn?.click();
  });
  await sleep(400);

  // Assert Warning Banner and Disclaimer text
  const modalUiText = await page.evaluate(() => document.body.innerText);
  assert(modalUiText.includes('The original message may already have been accepted by the remote mail server. Retrying could result in duplicate delivery.'), 'Specific retry warning banner displayed');
  assert(modalUiText.includes('External evidence reference supplied by an authorized operator. BYOS has not independently verified the referenced external record.'), 'External evidence disclaimer displayed');

  await page.screenshot({ path: path.join(artifactsDir, 'c652_retry_warning_banner.png') });
  console.log('Saved c652_retry_warning_banner.png');

  // ── CHECK D: Retransmission Authorization & Provenance Badge ──
  console.log('\n[Pillar 3 Check] Executing retry authorization and verifying provenance badge...');
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
      input.value = 'Edge Exchange Log Ref #E99182';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Recipient IT staff confirmed message was not received. Retransmission authorized by support.';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  // Submit retry
  await page.evaluate(() => {
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(
      (b) => b.innerText.includes('Authorize Retransmission')
    );
    submitBtn?.click();
  });
  await sleep(1500);

  // Switch to Audit tab to inspect Provenance badge
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const auditTab = tabs.find((b) => b.innerText.trim() === 'Audit Trail');
    auditTab?.click();
  });
  await sleep(600);

  const auditUiText = await page.evaluate(() => document.body.innerText);
  assert(auditUiText.includes('authorize_retry'), 'Audit trail records action "authorize_retry"');
  assert(auditUiText.includes('Provenance: Operator-attested external evidence (unverified by BYOS)'), 'Audit trail displays unverified operator-attested provenance badge');

  await page.screenshot({ path: path.join(artifactsDir, 'c652_provenance_badge_audit.png') });
  console.log('Saved c652_provenance_badge_audit.png');

  // ── CHECK E: Mutation Idempotency via API ──
  console.log('\n[Idempotency Check] Testing Idempotency-Key replay protection...');
  const idempKey = 'c652-idemp-' + Date.now();
  const idempPayload = {
    action: 'resolve_accepted',
    operator_reason: 'Idempotency test execution',
    evidence_category: 'mta_log_receipt',
    evidence_reference: 'MTA-IDEMP-01',
    idempotency_key: idempKey
  };

  // Execution 1: Mutates eve.reconcile@secure.io to delivered
  const idemp1Res = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000002/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(idempPayload)
  });
  assert(idemp1Res.status === 200, `First execution succeeded with HTTP ${idemp1Res.status}`);
  const idemp1Json = await idemp1Res.json();
  assert(!idemp1Json.idempotent_replay, 'First execution was not an idempotent replay');

  // Execution 2: Replays with same Idempotency-Key -> Returns 200 with idempotent_replay: true
  const idemp2Res = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000002/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(idempPayload)
  });
  assert(idemp2Res.status === 200, `Replay execution returned HTTP ${idemp2Res.status} (expected 200)`);
  const idemp2Json = await idemp2Res.json();
  assert(idemp2Json.idempotent_replay === true, 'Replay execution returned idempotent_replay: true');
  assert(idemp2Json.audit_id === idemp1Json.audit_id, 'Replay returned the exact original audit record ID');

  await browser.close();
  console.log('\n================================================================');
  console.log('--- ALL C6.5.2 OPERATOR RECONCILIATION VERIFICATION CHECKS PASSED ---');
  console.log('================================================================');
}

runC652Verification().catch((err) => {
  console.error('C6.5.2 Verification failed:', err);
  process.exit(1);
});
