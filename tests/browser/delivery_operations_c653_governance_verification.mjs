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

async function runC653Verification() {
  console.log('========================================================================');
  console.log('--- Starting BYOS Release C6.5.3 Governance & Integrity Verification ---');
  console.log('========================================================================');

  // ─────────────────────────────────────────────────────────────────
  // PILLAR 1: Bounded Manual Retry Governance (API & UI)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Pillar 1] Testing Bounded Manual Retry Governance...');

  // 1. Direct API call on grace.exhausted@retrylimit.com (manual_retry_count = 1, max_manual_retries = 1)
  const exhaustedRetryRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000008/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'authorize_retry',
      operator_reason: 'exceeded allowance test',
      evidence_category: 'recipient_inbound_log',
      evidence_reference: 'LOG-999',
      duplicate_risk_acknowledged: true
    })
  });
  assert(exhaustedRetryRes.status === 409, `Exhausted retry rejected with HTTP ${exhaustedRetryRes.status} (expected 409)`);
  const exhaustedRetryJson = await exhaustedRetryRes.json();
  assert(exhaustedRetryJson.error.includes('manual retry limit reached'), `Rejection cited retry allowance: ${exhaustedRetryJson.error}`);

  // ─────────────────────────────────────────────────────────────────
  // PILLAR 2: Bounce-Resolution Integrity & Acceptance Blocking (API)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Pillar 2] Testing Bounce-Resolution Integrity & Acceptance Blocking...');

  // 1. resolve_bounced without evidence -> 400 Bad Request
  const bounceNoEvidRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'resolve_bounced',
      operator_reason: 'missing evidence test'
    })
  });
  assert(bounceNoEvidRes.status === 400, `resolve_bounced without evidence rejected with HTTP ${bounceNoEvidRes.status} (expected 400)`);
  const bounceNoEvidJson = await bounceNoEvidRes.json();
  assert(bounceNoEvidJson.error.includes('requires authoritative bounce evidence_category'), `Rejection error correctly states: ${bounceNoEvidJson.error}`);

  // 2. resolve_bounced on alice.accepted@remote.org (has smtp_phase = 'accepted_by_mta') -> 409 Conflict
  const bounceAcceptedRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000007/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'resolve_bounced',
      operator_reason: 'accidental bounce attempt on accepted message',
      evidence_category: 'smtp_5xx_rejection',
      evidence_reference: '550 User Unknown'
    })
  });
  assert(bounceAcceptedRes.status === 409, `resolve_bounced on accepted_by_mta rejected with HTTP ${bounceAcceptedRes.status} (expected 409)`);
  const bounceAcceptedJson = await bounceAcceptedRes.json();
  assert(bounceAcceptedJson.error.includes('remote MTA has already durably accepted this message'), `Rejection cited durable remote MTA acceptance: ${bounceAcceptedJson.error}`);

  // ─────────────────────────────────────────────────────────────────
  // PILLAR 3: Request-Bound Idempotency Isolation (API)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Pillar 3] Testing Request-Bound Idempotency Isolation...');
  const baseKey = 'c653-iso-' + Date.now();
  const validBasePayload = {
    action: 'add_note',
    operator_reason: 'Base idempotency reservation test',
    idempotency_key: baseKey
  };

  // 1. Initial reservation & completion -> 200
  const initRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(validBasePayload)
  });
  assert(initRes.status === 200, `Initial mutation succeeded with HTTP ${initRes.status}`);
  const initJson = await initRes.json();
  assert(!initJson.idempotent_replay, 'Initial execution was not a replay');

  // 2. Identical replay with same actor, queue item, action, parameters -> 200 with idempotent_replay: true
  const replayRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(validBasePayload)
  });
  assert(replayRes.status === 200, `Identical replay succeeded with HTTP ${replayRes.status}`);
  const replayJson = await replayRes.json();
  assert(replayJson.idempotent_replay === true, 'Replay returned idempotent_replay: true');
  assert(replayJson.audit_id === initJson.audit_id, 'Replay returned matching audit_id');

  // 3. Payload parameter mismatch on same key -> 409 Conflict
  const mismatchPayload = {
    action: 'add_note',
    operator_reason: 'Tampered reason with same idempotency key',
    idempotency_key: baseKey
  };
  const mismatchRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(mismatchPayload)
  });
  assert(mismatchRes.status === 409, `Payload parameter mismatch rejected with HTTP ${mismatchRes.status} (expected 409)`);
  const mismatchJson = await mismatchRes.json();
  assert(mismatchJson.error.includes('key reused with different request payload parameters'), `Rejection cited fingerprint mismatch: ${mismatchJson.error}`);

  // 4. Action mismatch on same key -> 409 Conflict
  const actionMismatchPayload = {
    action: 'resolve_bounced',
    operator_reason: 'Action change test',
    evidence_category: 'smtp_5xx_rejection',
    evidence_reference: '550-TEST',
    idempotency_key: baseKey
  };
  const actionMismatchRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(actionMismatchPayload)
  });
  assert(actionMismatchRes.status === 409, `Action mismatch rejected with HTTP ${actionMismatchRes.status} (expected 409)`);
  const actionMismatchJson = await actionMismatchRes.json();
  assert(actionMismatchJson.error.includes('key was used for a different reconciliation action'), `Rejection cited action mismatch: ${actionMismatchJson.error}`);

  // 5. Cross-resource reuse on same key -> 409 Conflict
  const crossQueueRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000002/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(validBasePayload)
  });
  assert(crossQueueRes.status === 409, `Cross-resource key reuse rejected with HTTP ${crossQueueRes.status} (expected 409)`);
  const crossQueueJson = await crossQueueRes.json();
  assert(crossQueueJson.error.includes('key was used for a different queue message'), `Rejection cited resource mismatch: ${crossQueueJson.error}`);

  // 6. Cross-actor reuse on same key -> 403 Forbidden
  const crossActorRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-admin', // mock-admin maps to mock-platform-admin actor
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(validBasePayload)
  });
  assert(crossActorRes.status === 403, `Cross-actor key reuse rejected with HTTP ${crossActorRes.status} (expected 403)`);
  const crossActorJson = await crossActorRes.json();
  assert(crossActorJson.error.includes('key was issued to a different authenticated operator'), `Rejection cited actor mismatch: ${crossActorJson.error}`);

  // ─────────────────────────────────────────────────────────────────
  // PILLAR 4: Server-Controlled Evidence Provenance (API)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Pillar 4] Testing Server-Controlled Evidence Provenance...');

  // 1. Client attempting to supply evidence_provenance -> 400 Bad Request
  const clientProvRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'add_note',
      operator_reason: 'Tampered provenance test',
      evidence_provenance: 'independent_verified'
    })
  });
  assert(clientProvRes.status === 400, `Client-supplied evidence_provenance rejected with HTTP ${clientProvRes.status} (expected 400)`);
  const clientProvJson = await clientProvRes.json();
  assert(clientProvJson.error.includes('is server-controlled and cannot be set by clients'), `Rejection cited forbidden client verification metadata: ${clientProvJson.error}`);

  // 2. Client attempting to supply is_independently_verified: true -> 400 Bad Request
  const clientVerifRes = await fetch('http://127.0.0.1:8087/admin/v1/queue/messages/e5000000-0000-0000-0000-000000000001/reconcile', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-support-agent',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'add_note',
      operator_reason: 'Tampered is_independently_verified test',
      is_independently_verified: true
    })
  });
  assert(clientVerifRes.status === 400, `Client-supplied is_independently_verified rejected with HTTP ${clientVerifRes.status} (expected 400)`);

  // ─────────────────────────────────────────────────────────────────
  // BROWSER UI VERIFICATION (Support CRM UI)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Browser UI] Launching Puppeteer browser verification in Support CRM...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  page.on('console', (msg) => console.log('  [BROWSER CONSOLE]', msg.text()));

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
  await sleep(1500);

  // ── UI CHECK 1: Exhausted Manual Retry Governance ──
  console.log('\n[UI Check 1] Verifying Bounded Manual Retry Governance in UI...');
  // Find grace.exhausted@retrylimit.com (manual_retry_count: 1, max_manual_retries: 1)
  const clickedGrace = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const targetRow = rows.find((r) => r.innerText.includes('grace.exhausted@retrylimit.com'));
    if (targetRow) {
      const btn = targetRow.querySelector('button');
      btn?.click();
      return true;
    }
    return false;
  });
  assert(clickedGrace, 'Opened detail modal for grace.exhausted@retrylimit.com (exhausted retry budget)');
  await sleep(1000);

  // Switch to Actions tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  // Select "Add Note" action
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const noteBtn = btns.find((b) => b.innerText.includes('Add Note'));
    noteBtn?.click();
  });
  await sleep(400);

  // Assert warning banner rendered & action button disabled
  const graceUiText = await page.evaluate(() => document.body.innerText);
  assert(graceUiText.includes('Manual Retry Limit Reached:'), 'Exhausted retry banner rendered');
  assert(graceUiText.includes('This message has consumed its allowed operator retry budget (1 of 1). Additional retries cannot be authorized.'), 'Banner explains bounded retry governance and budget consumption');

  const isRetryBtnDisabled = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const retryBtn = btns.find((b) => b.innerText.includes('Authorize Retry'));
    return retryBtn ? retryBtn.disabled : false;
  });
  assert(isRetryBtnDisabled === true, 'Authorize Retry action button is strictly disabled when budget is exhausted');

  await page.screenshot({ path: path.join(artifactsDir, 'c653_retry_governance_exhausted.png') });
  console.log('Saved tests/browser/artifacts/c653_retry_governance_exhausted.png');

  // Close modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('button[aria-label="Close modal"]');
    closeBtn?.click();
  });
  await sleep(600);

  // ── UI CHECK 2: Bounce-Resolution Integrity with Evidence ──
  console.log('\n[UI Check 2] Verifying Bounce-Resolution Integrity with Evidence in UI...');
  // Find eve.reconcile@secure.io
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
  assert(clickedEve, 'Opened detail modal for eve.reconcile@secure.io');
  await sleep(1000);

  // Switch to Actions tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  // Select "Add Note" action
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const noteBtn = btns.find((b) => b.innerText.includes('Add Note'));
    noteBtn?.click();
  });
  await sleep(400);

  // Select "Mark Bounced"
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const bounceBtn = btns.find((b) => b.innerText.includes('Mark Bounced'));
    bounceBtn?.click();
  });
  await sleep(500);

  // Populate evidence fields
  await page.evaluate(() => {
    const select = document.querySelector('select');
    if (select) {
      select.value = 'smtp_5xx_rejection';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const input = document.querySelector('input[placeholder*="550"]');
    if (input) {
      input.value = '550 5.1.1 User unknown - Target MX rejection receipt';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Verified NDR received from destination MX during post-incident investigation.';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(400);

  // Capture screenshot of filled bounce reconciliation form
  await page.screenshot({ path: path.join(artifactsDir, 'c653_bounce_resolution_evidence.png') });
  console.log('Saved tests/browser/artifacts/c653_bounce_resolution_evidence.png');

  // Submit reconciliation
  await page.evaluate(() => {
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(
      (b) => b.innerText.includes('Resolve as Bounced')
    );
    submitBtn?.click();
  });
  await sleep(1500);

  // Switch to Audit tab to verify evidence integrity & fingerprint
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const auditTab = tabs.find((b) => b.innerText.includes('Audit Trail'));
    auditTab?.click();
  });
  await sleep(800);

  const eveAuditText = await page.evaluate(() => document.body.innerText);
  assert(eveAuditText.includes('resolve_bounced'), 'Audit trail records action "resolve_bounced"');
  assert(eveAuditText.includes('Provenance: Operator-attested external evidence (unverified by BYOS)'), 'Audit displays server-enforced operator-attested provenance');
  assert(eveAuditText.includes('Fingerprint:'), 'Audit displays request_fingerprint');

  await page.screenshot({ path: path.join(artifactsDir, 'c653_audit_trail_evidence_integrity.png') });
  console.log('Saved tests/browser/artifacts/c653_audit_trail_evidence_integrity.png');

  // Close modal
  await page.evaluate(() => {
    const closeBtn = document.querySelector('button[aria-label="Close modal"]');
    closeBtn?.click();
  });
  await sleep(600);

  // ── UI CHECK 3: Idempotency Isolation Conflict Banner in UI ──
  console.log('\n[UI Check 3] Verifying Idempotency Conflict Banner in UI...');
  // Open detail modal for dave.investigation@target.net
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
  await sleep(1000);

  // Switch to Actions tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button'));
    const recTab = tabs.find((b) => b.innerText.includes('Investigation & Actions'));
    recTab?.click();
  });
  await sleep(600);

  // Select "Add Note" action
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const noteBtn = btns.find((b) => b.innerText.includes('Add Note'));
    noteBtn?.click();
  });
  await sleep(400);

  // Trigger an idempotency conflict using the real UI form submission:
  // Override crypto.randomUUID to return baseKey (which was already completed for a different payload)
  await page.evaluate((conflictingKey) => {
    try {
      Crypto.prototype.randomUUID = () => conflictingKey;
    } catch (e) {}
    try {
      window.crypto.randomUUID = () => conflictingKey;
    } catch (e) {}
    const textarea = document.querySelector('textarea');
    if (textarea) {
      textarea.value = 'Mismatched reason submitted through real UI form causing idempotency conflict';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, baseKey);
  await sleep(400);

  // Click "Record Investigation Note" submit button
  await page.evaluate(() => {
    const allBtns = Array.from(document.querySelectorAll('button')).map((b) => b.innerText.trim());
    console.log('  ALL BUTTONS ON PAGE:', JSON.stringify(allBtns));
    const submitBtn = Array.from(document.querySelectorAll('button[type="submit"]')).find(
      (b) => b.innerText.includes('Record Investigation Note')
    );
    console.log('  FOUND SUBMIT BTN?', !!submitBtn, submitBtn ? submitBtn.innerText : 'none');
    submitBtn?.click();
  });
  await sleep(1500);

  const conflictBannerText = await page.evaluate(() => document.body.innerText);
  console.log('  [DEBUG UI TEXT]', conflictBannerText.slice(0, 300));
  assert(conflictBannerText.includes('Idempotency Conflict:'), 'Real UI rendered idempotency conflict error banner');
  assert(conflictBannerText.includes('key reused with different request payload parameters'), 'Conflict error banner cited payload mismatch');

  await page.screenshot({ path: path.join(artifactsDir, 'c653_idempotency_isolation_conflict.png') });
  console.log('Saved tests/browser/artifacts/c653_idempotency_isolation_conflict.png');

  await browser.close();
  console.log('\n========================================================================');
  console.log('--- ALL C6.5.3 GOVERNANCE & INTEGRITY VERIFICATION CHECKS PASSED ---');
  console.log('========================================================================');
}

runC653Verification().catch((err) => {
  console.error('C6.5.3 Verification failed:', err);
  process.exit(1);
});
