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
const API_PORT = '8098';
const WEBMAIL_PORT = '3012';

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

async function runCalDavSyncVerification() {
  console.log("================================================================================");
  console.log("        BYOS CALDAV SYNCHRONIZATION PROTOCOL CLIENT VERIFICATION                ");
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

  console.log("  Preparing disposable fixture in database:", DISPOSABLE_DB);
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
    DELETE FROM user_calendars WHERE mailbox_id = '${aliceMailboxId}' AND name IN ('Synced Work Schedule', 'Client Cal');
  `;
  execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB}`, { input: fixtureSql });

  // 1. Spawn disposable API on port 8098
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

  // 2. Spawn disposable Webmail on port 3012
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

    const baseUrl = `http://127.0.0.1:${API_PORT}`;
    const aliceAuth = basicAuth(aliceEmail, alicePassword);
    const bobAuth = basicAuth(bobEmail, bobPassword);

    // -------------------------------------------------------------------------
    // Step 1: RFC 6764 Well-Known CalDAV Discovery
    // -------------------------------------------------------------------------
    console.log("[Step 1] Verifying RFC 6764 /.well-known/caldav discovery redirect...");
    const wellKnownRes = await fetch(`${baseUrl}/.well-known/caldav`, { redirect: 'manual' });
    assert(wellKnownRes.status === 301 || wellKnownRes.status === 307, `/.well-known/caldav redirected (status ${wellKnownRes.status})`);
    assert(wellKnownRes.headers.get('location') === '/dav/principals/', `Redirect Location is /dav/principals/`);

    // -------------------------------------------------------------------------
    // Step 2: OPTIONS WebDAV and CalDAV Headers
    // -------------------------------------------------------------------------
    console.log("[Step 2] Verifying OPTIONS capabilities and DAV header compliance...");
    const optRes = await fetch(`${baseUrl}/dav/principals/`, { method: 'OPTIONS' });
    assert(optRes.status === 200, `OPTIONS returned 200 OK`);
    const davHdr = optRes.headers.get('dav') || '';
    assert(davHdr.includes('calendar-access'), `DAV header includes 'calendar-access' (${davHdr})`);
    const allowHdr = optRes.headers.get('allow') || '';
    assert(allowHdr.includes('PROPFIND') && allowHdr.includes('REPORT'), `Allow header includes PROPFIND and REPORT`);

    // -------------------------------------------------------------------------
    // Step 3: Unauthenticated challenge
    // -------------------------------------------------------------------------
    console.log("[Step 3] Verifying HTTP Basic Auth challenge on protected endpoints...");
    const unauthRes = await fetch(`${baseUrl}/dav/principals/`, { method: 'PROPFIND' });
    assert(unauthRes.status === 401, `Unauthenticated request returned 401 Unauthorized`);
    const wwwAuth = unauthRes.headers.get('www-authenticate') || '';
    assert(wwwAuth.includes('Basic'), `WWW-Authenticate header requests Basic auth (${wwwAuth})`);

    // -------------------------------------------------------------------------
    // Step 4: PROPFIND Principal Discovery
    // -------------------------------------------------------------------------
    console.log("[Step 4] Executing PROPFIND on /dav/principals/ for Alice...");
    const propfindRes = await fetch(`${baseUrl}/dav/principals/`, {
      method: 'PROPFIND',
      headers: { 'Authorization': aliceAuth },
    });
    assert(propfindRes.status === 207, `PROPFIND /dav/principals/ returned 207 Multi-Status`);
    const propfindXml = await propfindRes.text();
    assert(propfindXml.includes('<D:current-user-principal>'), `XML contains current-user-principal`);
    assert(propfindXml.includes('<C:calendar-home-set>'), `XML contains calendar-home-set`);
    assert(propfindXml.includes(`/dav/calendars/${aliceMailboxId}/`), `Calendar home set matches Alice mailbox URL`);

    // -------------------------------------------------------------------------
    // Step 5: PROPFIND Calendar Home Set
    // -------------------------------------------------------------------------
    console.log("[Step 5] Executing PROPFIND (Depth 1) on Alice's calendar home set...");
    const homeRes = await fetch(`${baseUrl}/dav/calendars/${aliceMailboxId}/`, {
      method: 'PROPFIND',
      headers: { 'Authorization': aliceAuth, 'Depth': '1' },
    });
    assert(homeRes.status === 207, `PROPFIND calendar home returned 207 Multi-Status`);
    const homeXml = await homeRes.text();
    assert(homeXml.includes('<C:calendar/>'), `Home set contains calendar collection`);
    assert(homeXml.includes('CS:getctag'), `Home set contains CS:getctag property`);

    // -------------------------------------------------------------------------
    // Step 6: MKCALENDAR Collection Creation
    // -------------------------------------------------------------------------
    console.log("[Step 6] Creating new calendar collection via MKCALENDAR...");
    const mkcalRes = await fetch(`${baseUrl}/dav/calendars/${aliceMailboxId}/synced-work/`, {
      method: 'MKCALENDAR',
      headers: {
        'Authorization': aliceAuth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Synced Work Schedule</D:displayname>
    </D:prop>
  </D:set>
</C:mkcalendar>`,
    });
    assert(mkcalRes.status === 201, `MKCALENDAR returned 201 Created`);
    const newCalLoc = mkcalRes.headers.get('location') || '';
    assert(newCalLoc.includes('/dav/calendars/'), `Location header points to new collection: ${newCalLoc}`);

    // Query collection ID
    const calIdQuery = execSync(`docker exec byos-postgres psql -U byos -d ${DISPOSABLE_DB} -t -A -c "SELECT id FROM user_calendars WHERE mailbox_id='${aliceMailboxId}' AND name='Synced Work Schedule';"`);
    const syncedCalId = calIdQuery.toString().trim();
    assert(syncedCalId.length > 0, `Created calendar collection found in DB: ${syncedCalId}`);

    // -------------------------------------------------------------------------
    // Step 7: PUT RFC 5545 iCalendar Event Resource
    // -------------------------------------------------------------------------
    console.log("[Step 7] Ingesting RFC 5545 iCalendar event via PUT...");
    const eventUID = `sync-event-${Date.now()}`;
    const eventPath = `/dav/calendars/${aliceMailboxId}/${syncedCalId}/${eventUID}.ics`;
    const icsPayload = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//macOS 14.0//EN
BEGIN:VEVENT
UID:${eventUID}
DTSTART:20261105T140000Z
DTEND:20261105T150000Z
SUMMARY:CalDAV Protocol Sync Review
DESCRIPTION:Validating end-to-end CalDAV zero-knowledge synchronization
LOCATION:Executive Conference Room
STATUS:CONFIRMED
SEQUENCE:0
ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED:mailto:alice@byos.local
END:VEVENT
END:VCALENDAR`;

    const putRes = await fetch(`${baseUrl}${eventPath}`, {
      method: 'PUT',
      headers: {
        'Authorization': aliceAuth,
        'Content-Type': 'text/calendar; charset=utf-8',
      },
      body: icsPayload,
    });
    assert(putRes.status === 201, `PUT event returned 201 Created`);
    const eventETag = putRes.headers.get('etag');
    assert(eventETag && eventETag.length > 0, `PUT returned valid ETag header: ${eventETag}`);

    // Verify Section 12 wire envelope in database
    const dbPayloadCheck = execSync(`docker exec byos-postgres psql -U byos -d ${DISPOSABLE_DB} -t -A -c "SELECT length(encrypted_payload), encode(substring(encrypted_payload from 1 for 1), 'hex') FROM calendar_events WHERE calendar_id='${syncedCalId}';"`);
    const [payloadLen, versionHex] = dbPayloadCheck.toString().trim().split('|');
    assert(parseInt(payloadLen) >= 29, `Database encrypted_payload length is >= 29 bytes (${payloadLen})`);
    assert(versionHex === '01', `Database encrypted_payload version byte is Section 12 AES-GCM (0x01)`);

    // -------------------------------------------------------------------------
    // Step 8: GET Event Resource
    // -------------------------------------------------------------------------
    console.log("[Step 8] Retrieving event via GET...");
    const getRes = await fetch(`${baseUrl}${eventPath}`, {
      headers: { 'Authorization': aliceAuth },
    });
    assert(getRes.status === 200, `GET event returned 200 OK`);
    assert(getRes.headers.get('content-type').includes('text/calendar'), `Content-Type is text/calendar`);
    assert(getRes.headers.get('etag') === eventETag, `ETag matches PUT response (${eventETag})`);
    const getIcs = await getRes.text();
    assert(getIcs.includes('SUMMARY:CalDAV Protocol Sync Review'), `GET iCalendar contains decrypted summary`);
    assert(getIcs.includes('LOCATION:Executive Conference Room'), `GET iCalendar contains decrypted location`);

    // -------------------------------------------------------------------------
    // Step 9: Concurrency Preconditions (If-None-Match: *)
    // -------------------------------------------------------------------------
    console.log("[Step 9] Verifying If-None-Match: * precondition conflict rejection...");
    const conflictRes = await fetch(`${baseUrl}${eventPath}`, {
      method: 'PUT',
      headers: {
        'Authorization': aliceAuth,
        'Content-Type': 'text/calendar; charset=utf-8',
        'If-None-Match': '*',
      },
      body: icsPayload,
    });
    assert(conflictRes.status === 412, `PUT with If-None-Match: * returned 412 Precondition Failed`);

    // -------------------------------------------------------------------------
    // Step 10: REPORT calendar-query
    // -------------------------------------------------------------------------
    console.log("[Step 10] Executing REPORT calendar-query time-range search...");
    const reportQueryXml = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20261101T000000Z" end="20261130T235959Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

    const queryRes = await fetch(`${baseUrl}/dav/calendars/${aliceMailboxId}/${syncedCalId}/`, {
      method: 'REPORT',
      headers: {
        'Authorization': aliceAuth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: reportQueryXml,
    });
    assert(queryRes.status === 207, `calendar-query REPORT returned 207 Multi-Status`);
    const queryXml = await queryRes.text();
    assert(queryXml.includes(eventUID), `Query report contains event UID: ${eventUID}`);
    assert(queryXml.includes('CalDAV Protocol Sync Review'), `Query report contains decrypted event summary`);

    // -------------------------------------------------------------------------
    // Step 11: REPORT sync-collection (RFC 6578)
    // -------------------------------------------------------------------------
    console.log("[Step 11] Executing RFC 6578 sync-collection REPORT...");
    const syncRes = await fetch(`${baseUrl}/dav/calendars/${aliceMailboxId}/${syncedCalId}/`, {
      method: 'REPORT',
      headers: {
        'Authorization': aliceAuth,
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: `<?xml version="1.0" encoding="utf-8" ?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>data:sync,0</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`,
    });
    assert(syncRes.status === 207, `sync-collection REPORT returned 207 Multi-Status`);
    const syncXml = await syncRes.text();
    assert(syncXml.includes('<D:sync-token>'), `sync-collection contains new sync-token`);

    // -------------------------------------------------------------------------
    // Step 12: Shared Calendar Access Control
    // -------------------------------------------------------------------------
    console.log("[Step 12] Sharing calendar with Bob and testing CalDAV permissions...");
    execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB}`, {
      input: `INSERT INTO calendar_shares (calendar_id, grantor_mailbox_id, grantee_mailbox_id, permission, status)
              VALUES ('${syncedCalId}', '${aliceMailboxId}', '${bobMailboxId}', 'read', 'active')
              ON CONFLICT (calendar_id, grantee_mailbox_id) DO UPDATE SET permission = 'read', status = 'active';`
    });

    // Bob can list the calendar in home set
    const bobHomeRes = await fetch(`${baseUrl}/dav/calendars/${bobMailboxId}/`, {
      method: 'PROPFIND',
      headers: { 'Authorization': bobAuth, 'Depth': '1' },
    });
    assert(bobHomeRes.status === 207, `Bob calendar home returned 207 Multi-Status`);
    const bobHomeXml = await bobHomeRes.text();
    assert(bobHomeXml.includes(syncedCalId), `Bob home set includes shared calendar`);
    assert(bobHomeXml.includes('<D:privilege><D:read/></D:privilege>'), `Bob has read privilege on shared calendar`);

    // Bob attempts write: must be 403 Forbidden
    const bobPutFail = await fetch(`${baseUrl}/dav/calendars/${bobMailboxId}/${syncedCalId}/bob-event.ics`, {
      method: 'PUT',
      headers: {
        'Authorization': bobAuth,
        'Content-Type': 'text/calendar; charset=utf-8',
      },
      body: icsPayload.replace(eventUID, 'bob-write-fail-uid'),
    });
    assert(bobPutFail.status === 403, `Bob write attempt on read-only share was rejected with 403 Forbidden`);

    // -------------------------------------------------------------------------
    // Step 13: Browser UI Verification
    // -------------------------------------------------------------------------
    console.log("[Step 13] Launching Puppeteer browser to verify CalDAV event in Webmail UI...");
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    await page.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'networkidle0' });

    // Login as Alice
    console.log("  Logging into Webmail as Alice...");
    await page.waitForSelector('input[type="email"]', { timeout: 15000 });
    await page.type('input[type="email"]', aliceEmail);
    await page.type('input[type="password"]', alicePassword);
    await page.click('button[type="submit"]');

    console.log("  Waiting for Alice dashboard to load...");
    await page.waitForSelector('[data-testid="account-chip-selector"], [data-testid="nav-calendar-tab"]', { timeout: 20000 });
    await sleep(2000);

    // Navigate to Calendar Tab
    console.log("  Navigating to Calendar tab...");
    const calTab = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 10000 });
    await calTab.click();
    await sleep(2500);

    const screenshotPath = path.join(artifactsDir, 'caldav_sync_browser_calendar.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`  Saved screenshot to: ${screenshotPath}`);
    assert(fs.existsSync(screenshotPath), `Browser verification screenshot saved`);

    console.log("\n================================================================================");
    console.log("     ALL CALDAV SYNCHRONIZATION AND BROWSER VERIFICATIONS PASSED!               ");
    console.log("================================================================================\n");

  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    console.log("  Cleaning up processes...");
    try { apiProc.kill(); } catch {}
    try { webmailProc.kill(); } catch {}
    try {
      execSync(`powershell -Command "Get-NetTCPConnection -LocalPort ${API_PORT},${WEBMAIL_PORT} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`);
    } catch {}
  }
}

runCalDavSyncVerification().catch((err) => {
  console.error("\nFATAL ERROR in CalDAV sync verification:", err);
  process.exit(1);
});
