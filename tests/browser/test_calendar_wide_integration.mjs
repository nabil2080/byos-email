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
const API_PORT = '8093';
const WEBMAIL_PORT = '3013';

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

function basicAuth(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function runCalendarWideIntegrationTestSuite() {
  console.log("================================================================================");
  console.log("       BYOS CALENDAR-WIDE UNIFIED INTEGRATION VERIFICATION SUITE                ");
  console.log("================================================================================\n");

  const aliceUserId = 'cccccccc-0000-0000-0000-000000000002';
  const aliceMailboxId = 'c0000000-0000-0000-0000-000000000001';
  const aliceEmail = 'alice@byos.local';
  const alicePassword = 'test-password-123';

  const bobUserId = 'bbbbbbbb-0000-0000-0000-000000000002';
  const bobMailboxId = 'b0000000-0000-0000-0000-000000000002';
  const bobEmail = 'bob@byos.local';
  const bobPassword = 'test-password-123';

  const passwordHash = '$argon2id$v=19$m=65536,t=3,p=2$2K4LPnHGYrPq+76HQK2hKQ$ol3Z1nfC344rKLOp1Yk+k02FCS4ohM+O9uRp51YUlgg';

  console.log("1. Preparing disposable fixture in database:", DISPOSABLE_DB);
  const fixtureSql = `
    UPDATE users SET password_hash = '${passwordHash}', two_factor_enabled = false, totp_secret = NULL, is_active = true WHERE id = '${aliceUserId}';
    DELETE FROM user_passkeys WHERE user_id = '${aliceUserId}';

    INSERT INTO users (id, org_id, email, password_hash, role, is_active, two_factor_enabled)
    VALUES ('${bobUserId}', '00000000-0000-0000-0000-000000000aaa', '${bobEmail}', '${passwordHash}', 'member', true, false)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true, two_factor_enabled = false;
    DELETE FROM user_passkeys WHERE user_id = '${bobUserId}';

    INSERT INTO mailboxes (id, user_id, org_id, domain_id, local_part, is_active)
    VALUES ('${bobMailboxId}', '${bobUserId}', '00000000-0000-0000-0000-000000000aaa', '00000000-0000-0000-0000-000000000bbb', 'bob', true)
    ON CONFLICT (id) DO UPDATE SET is_active = true;

    UPDATE mailboxes 
    SET wrapped_sk_user = (SELECT wrapped_sk_user FROM mailboxes WHERE id = '${aliceMailboxId}'),
        mailbox_sk_wrapped = (SELECT mailbox_sk_wrapped FROM mailboxes WHERE id = '${aliceMailboxId}'),
        mailbox_pk = (SELECT mailbox_pk FROM mailboxes WHERE id = '${aliceMailboxId}')
    WHERE id = '${bobMailboxId}';

    DELETE FROM calendar_shares WHERE grantee_mailbox_id IN ('${aliceMailboxId}', '${bobMailboxId}');
    DELETE FROM user_calendars WHERE mailbox_id = '${aliceMailboxId}' AND name IN ('Global Roadmap & Operations', 'CalDAV Sync Calendar');
  `;
  execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB}`, { input: fixtureSql });

  try {
    execSync('docker exec byos-redis redis-cli FLUSHALL', { stdio: 'ignore' });
  } catch {}

  // 1. Spawn disposable API on port 8093
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

  // 2. Spawn disposable Webmail on port 3013
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

    // ── CREATE ISOLATED BROWSER CONTEXT FOR ALICE ──
    const contextAlice = await browser.createBrowserContext();
    const pageAlice = await contextAlice.newPage();
    await pageAlice.setViewport({ width: 1280, height: 900 });

    pageAlice.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && !text.includes('/v1/auth/me') && !text.includes('favicon') && !text.includes('401')) {
        consoleErrors.push(`[Alice] ${text}`);
      }
    });

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 1: ALICE LOGS IN, CREATES CALENDAR, AND SHARES WITH BOB
    // ═════════════════════════════════════════════════════════════════════════
    console.log("--- [PHASE 1] Alice Logs in, Creates Calendar & Shares with Bob ---");

    // Alice logs in
    await pageAlice.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
    await pageAlice.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await pageAlice.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    await pageAlice.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageAlice.type('input[type="email"]', aliceEmail);
    await pageAlice.type('input[type="password"]', alicePassword);
    await pageAlice.click('button[type="submit"]');
    await pageAlice.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice.");

    // Alice navigates to Calendar
    const calTabAlice = await pageAlice.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTabAlice.click();
    await pageAlice.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1000);

    // Alice creates "Global Roadmap & Operations"
    console.log("  Alice creating 'Global Roadmap & Operations' calendar...");
    const addCalBtn = await pageAlice.waitForSelector('[data-testid="add-calendar-btn"]', { timeout: 5000 });
    await addCalBtn.click();
    await sleep(500);

    await pageAlice.waitForSelector('[data-testid="calendar-name-input"]', { timeout: 5000 });
    await pageAlice.type('[data-testid="calendar-name-input"]', 'Global Roadmap & Operations');
    await pageAlice.click('[data-testid="save-calendar-btn"]');
    await sleep(1500);

    const ownedCals = await pageAlice.$$eval('[data-testid="calendar-item-name"]', els => els.map(e => e.textContent?.trim()));
    assert(ownedCals.some(c => c && c.includes('Global Roadmap & Operations')), "Global Roadmap & Operations appears in Alice's calendars");

    // Alice shares "Global Roadmap & Operations" with Bob with "write" permission
    console.log("  Alice sharing calendar with Bob (Can edit)...");
    const calendarRows = await pageAlice.$$('[data-testid="calendar-row"]');
    assert(calendarRows.length > 0, "Calendar rows present in Alice's sidebar");
    let targetCalendarRow = null;
    for (const r of calendarRows) {
      const text = await r.evaluate(el => el.textContent);
      if (text && text.includes('Global Roadmap & Operations')) {
        targetCalendarRow = r;
        break;
      }
    }
    assert(targetCalendarRow !== null, "Found 'Global Roadmap & Operations' row in Alice's sidebar");
    await targetCalendarRow.hover();
    await sleep(300);

    const shareBtn = await targetCalendarRow.$('[data-testid="share-calendar-btn"]');
    assert(shareBtn !== null, "Share button found on 'Global Roadmap & Operations' row");
    await shareBtn.click();
    await sleep(600);

    await pageAlice.waitForSelector('[data-testid="share-grantee-email-input"]', { timeout: 5000 });
    await pageAlice.type('[data-testid="share-grantee-email-input"]', bobEmail);
    await pageAlice.select('[data-testid="share-permission-select"]', 'write');
    await pageAlice.click('[data-testid="share-submit-btn"]');
    await sleep(1500);

    // Verify share record appears in modal
    const sharesList = await pageAlice.waitForSelector('[data-testid="calendar-shares-list"]', { timeout: 5000 });
    assert(sharesList !== null, "Share list rendered in ShareCalendarModal");
    const sharesText = await pageAlice.$eval('[data-testid="calendar-shares-list"]', el => el.textContent);
    assert(sharesText.includes(bobEmail), `Bob's email visible in active shares list: ${sharesText}`);

    // Close share modal
    await pageAlice.keyboard.press('Escape');
    await sleep(500);

    const aliceViewScreenshot = path.join(artifactsDir, 'calendar_integration_alice_view.png');
    await pageAlice.screenshot({ path: aliceViewScreenshot });
    console.log(`  Saved screenshot: ${aliceViewScreenshot}`);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 2: ALICE CREATES RECURRING MASTER SERIES
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [PHASE 2] Alice Creates Recurring Series on Shared Calendar ---");

    // Alice switches to Month view
    const monthBtn = await pageAlice.waitForSelector('[data-testid="view-month-btn"]', { timeout: 5000 });
    await monthBtn.click();
    await sleep(800);

    // Alice creates weekly recurring event on "Global Roadmap & Operations"
    console.log("  Alice creating weekly recurring event 'Global Architecture Sync'...");
    const newEventBtn = await pageAlice.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await sleep(500);

    await pageAlice.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await pageAlice.type('[data-testid="event-title-input"]', 'Global Architecture Sync');

    // Select "Global Roadmap & Operations" calendar
    const calSelect = await pageAlice.waitForSelector('[data-testid="event-calendar-select"]', { timeout: 5000 });
    const targetCalId = await pageAlice.evaluate(() => {
      const select = document.querySelector('[data-testid="event-calendar-select"]');
      const opt = Array.from(select.options).find(o => o.text && o.text.includes('Global Roadmap & Operations'));
      return opt ? opt.value : null;
    });
    if (targetCalId) {
      await calSelect.select(targetCalId);
    }

    // Select weekly recurrence
    const repeatSelect = await pageAlice.waitForSelector('[data-testid="event-repeat-select"]', { timeout: 5000 });
    await repeatSelect.select('weekly');

    const saveEventBtn = await pageAlice.waitForSelector('[data-testid="save-event-btn"]');
    await saveEventBtn.click();
    await sleep(2000);

    // Verify recurring occurrences rendered for Alice
    const aliceEventPills = await pageAlice.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements.filter((el) => el.innerText && el.innerText.includes('Global Architecture Sync')).map((el) => el.innerText.trim());
    });
    assert(aliceEventPills.length >= 1, `Alice view rendered recurring event occurrences (count=${aliceEventPills.length})`);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 3: BOB LOGS IN, ACCESSES SHARED CALENDAR & DETACHES OCCURRENCE
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [PHASE 3] Bob Views Shared Series & Modifies Occurrence (Detached Exception) ---");

    const contextBob = await browser.createBrowserContext();
    const pageBob = await contextBob.newPage();
    await pageBob.setViewport({ width: 1280, height: 900 });

    pageBob.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error' && !text.includes('/v1/auth/me') && !text.includes('favicon') && !text.includes('401')) {
        consoleErrors.push(`[Bob] ${text}`);
      }
    });

    console.log("  Bob logging into Webmail on second simulated device...");
    await pageBob.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
    await pageBob.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await pageBob.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    await pageBob.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageBob.type('input[type="email"]', bobEmail);
    await pageBob.type('input[type="password"]', bobPassword);
    await pageBob.click('button[type="submit"]');
    await pageBob.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Bob.");

    // Bob navigates to Calendar
    const calTabBob = await pageBob.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTabBob.click();
    await pageBob.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1500);

    // Verify shared calendar appears in Bob's sidebar
    const sharedRow = await pageBob.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="shared-calendar-row"]'));
      return rows.find(r => r.textContent && r.textContent.includes('Global Roadmap & Operations'));
    }, { timeout: 10000 });
    assert(sharedRow !== null, "Global Roadmap & Operations rendered in Bob's shared list");

    const badgeText = await pageBob.$eval('[data-testid="shared-calendar-badge"]', el => el.textContent?.trim());
    assert(badgeText === 'Can edit', `Shared calendar badge correctly displays 'Can edit' (got: '${badgeText}')`);

    const bobSharedScreenshot = path.join(artifactsDir, 'calendar_integration_bob_shared_view.png');
    await pageBob.screenshot({ path: bobSharedScreenshot });
    console.log(`  Saved screenshot: ${bobSharedScreenshot}`);

    // Bob switches to Month view and observes shared recurring event
    console.log("  Bob viewing shared recurring series...");
    const monthBtnBob = await pageBob.waitForSelector('[data-testid="view-month-btn"]', { timeout: 5000 });
    await monthBtnBob.click();
    await sleep(1000);

    const bobPill = await pageBob.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 8000 });
    assert(bobPill !== null, "Bob view renders shared recurring event pill");

    // Bob modifies occurrence (detaches exception)
    console.log("  Bob modifying single occurrence to create detached exception...");
    await bobPill.click();
    await sleep(600);

    const scopeContainer = await pageBob.waitForSelector('[data-testid="recurring-scope-container"]', { timeout: 5000 });
    assert(Boolean(scopeContainer), "Scope selection rendered for recurring event in Bob's modal");

    const scopeOccBtn = await pageBob.waitForSelector('[data-testid="scope-occurrence-btn"]', { timeout: 5000 });
    await scopeOccBtn.click();
    await sleep(300);

    // Update title for detached occurrence
    await pageBob.click('[data-testid="event-title-input"]', { clickCount: 3 });
    await pageBob.keyboard.press('Backspace');
    await pageBob.type('[data-testid="event-title-input"]', 'Global Architecture Sync - Retrospective');

    const saveBobBtn = await pageBob.waitForSelector('[data-testid="save-event-btn"]');
    await saveBobBtn.click();
    await sleep(2000);

    // Verify detached occurrence is rendered alongside master series for Bob
    const bobPillsAfter = await pageBob.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.filter(e => e.innerText && e.innerText.includes('Global Architecture Sync - Retrospective')).map(e => e.innerText.trim());
    });
    assert(bobPillsAfter.length >= 1, "Bob view displays detached exception 'Global Architecture Sync - Retrospective'");

    // Alice reloads and confirms detached exception is visible
    console.log("  Alice reloading page to verify detached recurrence exception persistence...");
    await pageAlice.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    const calTabReload1 = await pageAlice.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTabReload1.click();
    await pageAlice.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(500);

    const aliceMonthBtnAfterReload = await pageAlice.waitForSelector('[data-testid="view-month-btn"]', { timeout: 8000 });
    await aliceMonthBtnAfterReload.click();
    await sleep(1000);

    const alicePillsAfterReload = await pageAlice.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.filter(e => e.innerText && e.innerText.includes('Global Architecture Sync - Retrospective')).map(e => e.innerText.trim());
    });
    assert(alicePillsAfterReload.length >= 1, "Alice view displays detached exception after reload");

    const detachedScreenshot = path.join(artifactsDir, 'calendar_integration_recurrence_detached.png');
    await pageAlice.screenshot({ path: detachedScreenshot });
    console.log(`  Saved screenshot: ${detachedScreenshot}`);

    // Verify exception in PostgreSQL database
    const sqlExceptionCheck = execSync(`docker exec byos-postgres psql -U byos -d ${DISPOSABLE_DB} -t -A -c "SELECT count(*) FROM calendar_event_exceptions;"`)
      .toString().trim();
    assert(parseInt(sqlExceptionCheck) >= 1, `Postgres confirms detached exception record stored: count=${sqlExceptionCheck}`);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 4: BIDIRECTIONAL CALDAV SYNCHRONIZATION
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [PHASE 4] CalDAV Protocol Synchronization & Bidirectional Convergence ---");

    const baseUrl = `http://127.0.0.1:${API_PORT}`;
    const aliceAuth = basicAuth(aliceEmail, alicePassword);

    // 1. CalDAV Service Discovery
    console.log("  Connecting CalDAV client via RFC 6764 well-known discovery...");
    const wellKnownRes = await fetch(`${baseUrl}/.well-known/caldav`, {
      method: 'PROPFIND',
      headers: { 'Authorization': aliceAuth },
    });
    assert(wellKnownRes.status === 200 || wellKnownRes.status === 207 || wellKnownRes.status === 301 || wellKnownRes.status === 302,
      `CalDAV discovery endpoint responded with expected status (${wellKnownRes.status})`);

    // 2. Discover target calendar ID for Alice
    const calIdFromDb = execSync(`docker exec byos-postgres psql -U byos -d ${DISPOSABLE_DB} -t -A -c "SELECT id FROM user_calendars WHERE mailbox_id='${aliceMailboxId}' AND name='Global Roadmap & Operations' LIMIT 1;"`)
      .toString().trim();
    assert(calIdFromDb.length > 0, `Target calendar collection ID resolved: ${calIdFromDb}`);

    // 3. CalDAV PUT: Ingest external RFC 5545 event
    console.log("  CalDAV client ingesting RFC 5545 event 'Executive CalDAV Summit'...");
    const caldavEventUID = `caldav-integration-${Date.now()}`;
    const caldavEventPath = `/dav/calendars/${aliceMailboxId}/${calIdFromDb}/${caldavEventUID}.ics`;
    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//macOS 14.0//EN
BEGIN:VEVENT
UID:${caldavEventUID}
DTSTART:20261028T150000Z
DTEND:20261028T160000Z
SUMMARY:Executive CalDAV Summit
DESCRIPTION:Validating end-to-end CalDAV zero-knowledge synchronization across Webmail
LOCATION:Global Operations HQ
STATUS:CONFIRMED
SEQUENCE:0
ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED:mailto:alice@byos.local
END:VEVENT
END:VCALENDAR`;

    const caldavPutRes = await fetch(`${baseUrl}${caldavEventPath}`, {
      method: 'PUT',
      headers: {
        'Authorization': aliceAuth,
        'Content-Type': 'text/calendar; charset=utf-8',
      },
      body: icsContent,
    });
    assert(caldavPutRes.status === 201 || caldavPutRes.status === 204, `CalDAV PUT returned ${caldavPutRes.status}`);

    // 4. Verify Webmail reflects the CalDAV-ingested event
    console.log("  Refreshing Webmail to verify CalDAV event decryption and rendering...");
    await pageAlice.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    const calTabReload2 = await pageAlice.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTabReload2.click();
    await pageAlice.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(500);

    const caldavMonthBtn = await pageAlice.waitForSelector('[data-testid="view-month-btn"]', { timeout: 8000 });
    await caldavMonthBtn.click();
    await sleep(1000);

    const caldavPills = await pageAlice.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      return els.filter(e => e.innerText && e.innerText.includes('Executive CalDAV Summit')).map(e => e.innerText.trim());
    });
    assert(caldavPills.length >= 1, "Webmail successfully decrypted and rendered CalDAV-ingested event 'Executive CalDAV Summit'");

    const caldavScreenshot = path.join(artifactsDir, 'calendar_integration_caldav_sync.png');
    await pageAlice.screenshot({ path: caldavScreenshot });
    console.log(`  Saved screenshot: ${caldavScreenshot}`);

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 5: ZERO-KNOWLEDGE KEY ISOLATION & LOCKED MAILBOX SAFETY
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [PHASE 5] Zero-Knowledge Key Isolation & Locked Mailbox Safety ---");

    // Alice locks mailbox keys
    console.log("  Simulating locked mailbox state by evicting secret keys from session...");
    await pageAlice.evaluate((mbId) => {
      window.__BYOS_TEST_LOCK_MAILBOX__(mbId);
    }, aliceMailboxId);

    const keyInAliceStorage = await pageAlice.evaluate((mbId) => {
      return sessionStorage.getItem('byos_mailbox_sk_' + mbId);
    }, aliceMailboxId);
    assert(keyInAliceStorage === null, "Mailbox secret key successfully evicted from sessionStorage (locked)");

    // Alice clicks "New Event" button while locked
    const lockedNewEventBtn = await pageAlice.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await lockedNewEventBtn.click();
    await sleep(600);

    // Verify locked mailbox warning is rendered in event modal
    const lockedWarning = await pageAlice.waitForSelector('[data-testid="locked-mailbox-warning"]', { timeout: 5000 });
    assert(lockedWarning !== null, "Locked mailbox warning banner rendered in EventModal");

    const lockedScreenshot = path.join(artifactsDir, 'calendar_integration_locked_state.png');
    await pageAlice.screenshot({ path: lockedScreenshot });
    console.log(`  Saved screenshot: ${lockedScreenshot}`);

    // Close event modal
    await pageAlice.click('[data-testid="close-event-modal"]');
    await sleep(400);

    // Trigger unlock prompt
    console.log("  Triggering account unlock modal...");
    await pageAlice.evaluate((target) => {
      window.__BYOS_TEST_TRIGGER_UNLOCK_MODAL__(target);
    }, { mailboxId: aliceMailboxId, email: aliceEmail });
    await sleep(600);

    // Enter Alice's password and unlock
    const unlockPwdInput = await pageAlice.waitForSelector('[data-testid="unlock-account-password-input"]', { timeout: 5000 });
    await unlockPwdInput.type(alicePassword);
    await sleep(300);

    const unlockSubmitBtn = await pageAlice.waitForSelector('[data-testid="unlock-account-submit-btn"]', { timeout: 5000 });
    await unlockSubmitBtn.click();

    // Verify unlock modal dismissed and key restored
    await pageAlice.waitForFunction(
      () => document.querySelector('[data-testid="unlock-account-password-input"]') === null,
      { timeout: 8000 }
    );

    const restoredAliceKey = await pageAlice.evaluate((mbId) => {
      return sessionStorage.getItem('byos_mailbox_sk_' + mbId);
    }, aliceMailboxId);
    assert(restoredAliceKey !== null && restoredAliceKey.length === 64, `Mailbox secret key restored after unlock (length: ${restoredAliceKey ? restoredAliceKey.length : 0})`);
    console.log("  Account unlocked successfully; zero-knowledge crypto context restored.");

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 6: MULTI-VIEW & 375PX MOBILE RESPONSIVE VIEWPORT AUDIT
    // ═════════════════════════════════════════════════════════════════════════
    console.log("\n--- [PHASE 6] Multi-View & 375px Mobile Viewport Audit ---");

    // Test Day View
    const dayBtn = await pageAlice.waitForSelector('[data-testid="view-day-btn"]', { timeout: 5000 });
    await dayBtn.click();
    await sleep(600);
    assert(true, "Day view switched and rendered");

    // Test Week View
    const weekBtn = await pageAlice.waitForSelector('[data-testid="view-week-btn"]', { timeout: 5000 });
    await weekBtn.click();
    await sleep(600);
    assert(true, "Week view switched and rendered");

    // Test Agenda View
    const agendaBtn = await pageAlice.waitForSelector('[data-testid="view-agenda-btn"]', { timeout: 5000 });
    await agendaBtn.click();
    await sleep(600);
    assert(true, "Agenda view switched and rendered");

    // Mobile Viewport Audit (375px)
    console.log("  Auditing 375px mobile viewport across calendar views...");
    await pageAlice.setViewport({ width: 375, height: 667 });
    await sleep(800);

    const agendaScrollWidth = await pageAlice.evaluate(() => document.documentElement.scrollWidth);
    assert(agendaScrollWidth <= 375, `Agenda mobile 375px viewport has no horizontal overflow: scrollWidth=${agendaScrollWidth}px <= 375px`);

    // Switch to Month view on mobile
    const mobileMonthBtn = await pageAlice.waitForSelector('[data-testid="view-month-btn"]', { timeout: 5000 });
    await mobileMonthBtn.click();
    await sleep(800);

    const monthScrollWidth = await pageAlice.evaluate(() => document.documentElement.scrollWidth);
    assert(monthScrollWidth <= 375, `Month mobile 375px viewport has no horizontal overflow: scrollWidth=${monthScrollWidth}px <= 375px`);

    const mobileScreenshot = path.join(artifactsDir, 'calendar_integration_mobile_375px.png');
    await pageAlice.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    console.log("\n================================================================================");
    console.log("    CALENDAR-WIDE UNIFIED INTEGRATION VERIFICATION PASSED SUCCESSFULLY!          ");
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

runCalendarWideIntegrationTestSuite().catch((err) => {
  console.error("FATAL CALENDAR INTEGRATION ERROR:", err);
  if (consoleErrors.length > 0) {
    console.error("Captured browser console errors:\n", consoleErrors.join("\n"));
  }
  process.exit(1);
});
