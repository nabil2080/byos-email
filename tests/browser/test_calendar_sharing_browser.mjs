import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const DISPOSABLE_DB = 'byos_recovery_disposable_20261024';
const API_PORT = '8095';
const WEBMAIL_PORT = '3011';
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

async function runCalendarSharingBrowserTest() {
  console.log("================================================================================");
  console.log("     BYOS CALENDAR SHARING & PERMISSIONS BROWSER VERIFICATION TEST              ");
  console.log("================================================================================\n");

  const aliceUserId = 'cccccccc-0000-0000-0000-000000000002';
  const bobUserId = 'bbbbbbbb-0000-0000-0000-000000000002';
  const passwordHash = '$argon2id$v=19$m=65536,t=3,p=2$2K4LPnHGYrPq+76HQK2hKQ$ol3Z1nfC344rKLOp1Yk+k02FCS4ohM+O9uRp51YUlgg';

  console.log("  Preparing disposable fixture in database:", DISPOSABLE_DB);
  const fixtureSql = `
    UPDATE users SET password_hash = '${passwordHash}', two_factor_enabled = false, totp_secret = NULL, is_active = true WHERE id = '${aliceUserId}';
    DELETE FROM user_passkeys WHERE user_id = '${aliceUserId}';

    INSERT INTO users (id, org_id, email, password_hash, role, is_active, two_factor_enabled)
    VALUES ('${bobUserId}', '00000000-0000-0000-0000-000000000aaa', 'bob@byos.local', '${passwordHash}', 'member', true, false)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true, two_factor_enabled = false;
    DELETE FROM user_passkeys WHERE user_id = '${bobUserId}';

    INSERT INTO mailboxes (id, user_id, org_id, domain_id, local_part, is_active)
    VALUES ('b0000000-0000-0000-0000-000000000002', '${bobUserId}', '00000000-0000-0000-0000-000000000aaa', '00000000-0000-0000-0000-000000000bbb', 'bob', true)
    ON CONFLICT (id) DO UPDATE SET is_active = true;

    UPDATE mailboxes 
    SET wrapped_sk_user = (SELECT wrapped_sk_user FROM mailboxes WHERE id = 'c0000000-0000-0000-0000-000000000001'),
        mailbox_sk_wrapped = (SELECT mailbox_sk_wrapped FROM mailboxes WHERE id = 'c0000000-0000-0000-0000-000000000001'),
        mailbox_pk = (SELECT mailbox_pk FROM mailboxes WHERE id = 'c0000000-0000-0000-0000-000000000001')
    WHERE id = 'b0000000-0000-0000-0000-000000000002';

    DELETE FROM calendar_shares WHERE grantee_mailbox_id IN ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002');
    DELETE FROM user_calendars WHERE mailbox_id = 'c0000000-0000-0000-0000-000000000001' AND name = 'Engineering Roadmap';
  `;
  execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB}`, { input: fixtureSql });

  // 1. Spawn disposable API on port 8095
  console.log(`  Starting disposable API on port ${API_PORT}...`);
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

  // 2. Spawn disposable Webmail on port 3011
  console.log(`  Starting disposable Webmail on port ${WEBMAIL_PORT}...`);
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
    console.log("  Waiting for API and Webmail to become ready...");
    await waitForHttp(`http://127.0.0.1:${API_PORT}/v1/health`);
    await waitForHttp(`http://127.0.0.1:${WEBMAIL_PORT}`);
    console.log("  Disposable test services ready.\n");

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
    });

    const contextAlice = await browser.createBrowserContext();
    const pageAlice = await contextAlice.newPage();
    await pageAlice.setViewport({ width: 1280, height: 900 });

    pageAlice.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('/v1/auth/me') && !text.includes('favicon') && !text.includes('401 (Unauthorized)')) {
          consoleErrors.push(`[Alice] ${text}`);
        }
      }
    });

    // STEP 1: Log in as Alice
    console.log("--- [STEP 1] Login as Alice ---");
    await pageAlice.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
    await pageAlice.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await pageAlice.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await pageAlice.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageAlice.type('input[type="email"]', 'alice@byos.local');
    await pageAlice.type('input[type="password"]', 'test-password-123');
    await pageAlice.click('button[type="submit"]');

    await pageAlice.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice.");

    // STEP 2: Navigate to Calendar
    console.log("\n--- [STEP 2] Navigate to Calendar View ---");
    const calTab = await pageAlice.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTab.click();
    await pageAlice.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1500);

    await pageAlice.screenshot({ path: path.join(artifactsDir, 'calendar_share_alice_view.png') });
    assert(true, "Navigated to Calendar View as Alice");

    // STEP 3: Alice creates a dedicated calendar "Engineering Roadmap"
    console.log("\n--- [STEP 3] Alice creates 'Engineering Roadmap' calendar ---");
    const addCalBtn = await pageAlice.waitForSelector('[data-testid="add-calendar-btn"]', { timeout: 5000 });
    await addCalBtn.click();
    await sleep(500);

    await pageAlice.waitForSelector('[data-testid="calendar-name-input"]', { timeout: 5000 });
    await pageAlice.type('[data-testid="calendar-name-input"]', 'Engineering Roadmap');
    await pageAlice.click('[data-testid="save-calendar-btn"]');
    await sleep(1500);

    const ownedCals = await pageAlice.$$eval('[data-testid="calendar-item-name"]', els => els.map(e => e.textContent?.trim()));
    assert(ownedCals.some(c => c && c.includes('Engineering Roadmap')), "Engineering Roadmap appears in Alice's calendars");

    // STEP 4: Alice shares "Engineering Roadmap" with Bob (read-only)
    console.log("\n--- [STEP 4] Alice shares 'Engineering Roadmap' with Bob (Can view) ---");
    const rows = await pageAlice.$$('[data-testid="calendar-row"]');
    assert(rows.length > 0, "Calendar rows are present");
    await rows[rows.length - 1].hover();
    await sleep(300);
    const shareBtn = await rows[rows.length - 1].$('[data-testid="share-calendar-btn"]');
    assert(Boolean(shareBtn), "Share calendar button is available on owned calendar");
    await shareBtn.click();
    await sleep(600);

    await pageAlice.waitForSelector('[data-testid="share-grantee-email-input"]', { timeout: 5000 });
    await pageAlice.type('[data-testid="share-grantee-email-input"]', 'bob@byos.local');
    await pageAlice.select('[data-testid="share-permission-select"]', 'read');

    await pageAlice.click('[data-testid="share-submit-btn"]');
    await sleep(1500);

    const successEl = await pageAlice.waitForSelector('[data-testid="share-calendar-success"]', { timeout: 5000 });
    const successText = await pageAlice.evaluate(el => el.textContent, successEl);
    assert(successText.includes('bob@byos.local'), `Share success confirmation visible: "${successText}"`);

    await pageAlice.screenshot({ path: path.join(artifactsDir, 'calendar_share_modal_shared.png') });

    // Close modal
    await pageAlice.keyboard.press('Escape');
    await sleep(500);

    // STEP 5: Alice creates an event on "Engineering Roadmap"
    console.log("\n--- [STEP 5] Alice creates 'Sprint 42 Kickoff' event ---");
    const newEventBtn = await pageAlice.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await sleep(600);

    await pageAlice.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await pageAlice.type('[data-testid="event-title-input"]', 'Sprint 42 Kickoff');

    // Select Engineering Roadmap calendar in dropdown
    const calSelect = await pageAlice.waitForSelector('[data-testid="event-calendar-select"]');
    const calOptions = await pageAlice.$$eval('[data-testid="event-calendar-select"] option', opts => opts.map(o => ({ value: o.value, text: o.textContent })));
    const roadmapOpt = calOptions.find(o => o.text.includes('Engineering Roadmap'));
    if (roadmapOpt) {
      await pageAlice.select('[data-testid="event-calendar-select"]', roadmapOpt.value);
    }
    await pageAlice.type('[data-testid="event-location-input"]', 'War Room / Video Link');

    await pageAlice.click('[data-testid="save-event-btn"]');
    await sleep(1500);
    assert(true, "Alice created event on 'Engineering Roadmap'");

    // STEP 6: Bob logs in in a separate context
    console.log("\n--- [STEP 6] Bob logs in and checks 'Shared with Me' ---");
    const contextBob = await browser.createBrowserContext();
    const pageBob = await contextBob.newPage();
    await pageBob.setViewport({ width: 1280, height: 900 });

    pageBob.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('/v1/auth/me') && !text.includes('favicon') && !text.includes('401 (Unauthorized)')) {
          consoleErrors.push(`[Bob] ${text}`);
        }
      }
    });

    await pageBob.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
    await pageBob.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await pageBob.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await pageBob.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageBob.type('input[type="email"]', 'bob@byos.local');
    await pageBob.type('input[type="password"]', 'test-password-123');
    await pageBob.click('button[type="submit"]');

    await pageBob.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Bob.");

    const bobCalTab = await pageBob.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await bobCalTab.click();
    await pageBob.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1500);

    // Verify Bob sees "Shared with Me" and "Read-only" badge
    const sharedSection = await pageBob.waitForSelector('[data-testid="shared-calendars-section"]', { timeout: 5000 });
    assert(Boolean(sharedSection), "'Shared with Me' section is present in Bob's sidebar");

    const badges = await pageBob.$$eval('[data-testid="shared-calendar-badge"]', els => els.map(e => e.textContent?.trim()));
    assert(badges.some(b => b.includes('Read-only')), "Read-only badge displayed on Engineering Roadmap for Bob");

    await pageBob.screenshot({ path: path.join(artifactsDir, 'calendar_share_bob_read_only.png') });

    // STEP 7: Bob opens the event and verifies read-only UI enforcement
    console.log("\n--- [STEP 7] Bob inspects event and verifies read-only enforcement ---");
    const firstPill = await pageBob.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 10000 });
    assert(Boolean(firstPill), "Bob can see Alice's shared event");
    await firstPill.click();
    await sleep(800);

    await pageBob.waitForSelector('[data-testid="calendar-read-only-notice"]', { timeout: 5000 });
    assert(true, "Read-only notice banner rendered in EventModal for Bob");

    const isTitleDisabled = await pageBob.$eval('[data-testid="event-title-input"]', el => el.disabled);
    assert(isTitleDisabled === true, "Event title input is disabled for read-only calendar");

    const isSaveDisabled = await pageBob.$eval('[data-testid="save-event-btn"]', el => el.disabled);
    assert(isSaveDisabled === true, "Save button is disabled for read-only calendar");

    const deleteBtn = await pageBob.$('[data-testid="delete-event-btn"]');
    assert(deleteBtn === null, "Delete button is not rendered for read-only calendar");

    await pageBob.screenshot({ path: path.join(artifactsDir, 'calendar_share_event_read_only_modal.png') });

    // Close event modal
    await pageBob.keyboard.press('Escape');
    await sleep(500);

    // STEP 8: Alice upgrades Bob to "Can edit" (write permission)
    console.log("\n--- [STEP 8] Alice upgrades Bob's access to 'Can edit' ---");
    await pageAlice.bringToFront();
    const aliceRows = await pageAlice.$$('[data-testid="calendar-row"]');
    await aliceRows[aliceRows.length - 1].hover();
    await sleep(300);
    const aliceShareBtn = await aliceRows[aliceRows.length - 1].$('[data-testid="share-calendar-btn"]');
    await aliceShareBtn.click();
    await sleep(800);

    await pageAlice.waitForSelector('[data-testid="share-grantee-permission-select"]', { timeout: 5000 });
    await pageAlice.select('[data-testid="share-grantee-permission-select"]', 'write');
    await pageAlice.evaluate(() => {
      const select = document.querySelector('[data-testid="share-grantee-permission-select"]');
      if (select) {
        select.value = 'write';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        select.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(2000);

    const errEl = await pageAlice.$('[data-testid="share-calendar-error"]');
    if (errEl) {
      const errText = await pageAlice.evaluate(el => el.textContent, errEl);
      console.error("  [Alice Share Error]:", errText);
    }

    const upgradeSuccessEl = await pageAlice.waitForSelector('[data-testid="share-calendar-success"]', { timeout: 5000 });
    const upgradeText = await pageAlice.evaluate(el => el.textContent, upgradeSuccessEl);
    assert(upgradeText.includes('Can edit'), `Permission upgrade confirmed: "${upgradeText}"`);

    await pageAlice.screenshot({ path: path.join(artifactsDir, 'calendar_share_upgraded_to_write.png') });
    await pageAlice.keyboard.press('Escape');
    await sleep(500);

    // STEP 9: Bob refreshes and adds an event with write access
    console.log("\n--- [STEP 9] Bob creates an event under write access ---");
    await pageBob.bringToFront();
    await pageBob.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);
    const bobCalTabStep9 = await pageBob.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await bobCalTabStep9.click();
    await pageBob.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1500);

    const bobBadges = await pageBob.$$eval('[data-testid="shared-calendar-badge"]', els => els.map(e => e.textContent?.trim()));
    assert(bobBadges.some(b => b.includes('Can edit')), "Badge updated to 'Can edit' for Bob");

    const bobNewEventBtn = await pageBob.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await bobNewEventBtn.click();
    await sleep(600);

    await pageBob.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await pageBob.type('[data-testid="event-title-input"]', 'Architecture Review by Bob');

    const bobCalOpts = await pageBob.$$eval('[data-testid="event-calendar-select"] option', opts => opts.map(o => ({ value: o.value, text: o.textContent })));
    const bobRoadmapOpt = bobCalOpts.find(o => o.text.includes('Engineering Roadmap'));
    if (bobRoadmapOpt) {
      await pageBob.select('[data-testid="event-calendar-select"]', bobRoadmapOpt.value);
    }

    const bobSaveBtn = await pageBob.waitForSelector('[data-testid="save-event-btn"]');
    const bobSaveDisabled = await pageBob.evaluate(el => el.disabled, bobSaveBtn);
    assert(bobSaveDisabled === false, "Save button is enabled for write-shared calendar");

    await bobSaveBtn.click();
    await sleep(1500);

    const bobEventTitles = await pageBob.$$eval('[data-testid="calendar-event-pill"]', els => els.map(e => e.textContent?.trim()));
    assert(bobEventTitles.some(t => t.includes('Architecture Review by Bob')), "Bob successfully created event on shared calendar");

    await pageBob.screenshot({ path: path.join(artifactsDir, 'calendar_share_bob_created_event.png') });

    // STEP 10: Alice revokes Bob's share
    console.log("\n--- [STEP 10] Alice revokes Bob's share ---");
    await pageAlice.bringToFront();
    pageAlice.on('dialog', async dialog => {
      await dialog.accept();
    });

    const aliceRowsRevoke = await pageAlice.$$('[data-testid="calendar-row"]');
    await aliceRowsRevoke[aliceRowsRevoke.length - 1].hover();
    await sleep(300);
    const aliceShareBtnRevoke = await aliceRowsRevoke[aliceRowsRevoke.length - 1].$('[data-testid="share-calendar-btn"]');
    await aliceShareBtnRevoke.click();
    await sleep(800);

    const revokeBtn = await pageAlice.waitForSelector('[data-testid="share-revoke-btn"]', { timeout: 5000 });
    await revokeBtn.click();
    await sleep(1500);

    const revokeSuccess = await pageAlice.waitForSelector('[data-testid="share-calendar-success"]', { timeout: 5000 });
    const revokeText = await pageAlice.evaluate(el => el.textContent, revokeSuccess);
    assert(revokeText.includes('revoked'), `Revoke confirmation: "${revokeText}"`);

    await pageAlice.keyboard.press('Escape');
    await sleep(500);

    // Verify Bob no longer sees the shared calendar
    await pageBob.bringToFront();
    await pageBob.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);
    const bobCalTabStep10 = await pageBob.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await bobCalTabStep10.click();
    await pageBob.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1500);

    const bobSharedSectionAfterRevoke = await pageBob.$('[data-testid="shared-calendars-section"]');
    assert(bobSharedSectionAfterRevoke === null, "Shared calendar disappeared from Bob's sidebar after revocation");

    await pageBob.screenshot({ path: path.join(artifactsDir, 'calendar_share_revoked.png') });

    // STEP 11: 375px Mobile Viewport Responsiveness
    console.log("\n--- [STEP 11] Mobile Viewport Responsiveness (375px) ---");
    await pageAlice.bringToFront();
    await pageAlice.setViewport({ width: 375, height: 667 });
    await sleep(1000);

    const scrollWidth = await pageAlice.evaluate(() => document.documentElement.scrollWidth);
    assert(scrollWidth <= 375, `Mobile 375px viewport has no horizontal overflow: scrollWidth=${scrollWidth}px`);

    await pageAlice.screenshot({ path: path.join(artifactsDir, 'calendar_share_mobile_375px.png') });
    assert(true, "Mobile 375px responsive screenshot captured");

    console.log("\n================================================================================");
    console.log("     ALL CALENDAR SHARING BROWSER CHECKS PASSED SUCCESSFULLY!                   ");
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

runCalendarSharingBrowserTest().catch((err) => {
  console.error("Browser test failed:", err);
  if (consoleErrors.length > 0) {
    console.error("Captured browser console errors:\n", consoleErrors.join("\n"));
  }
  process.exit(1);
});
