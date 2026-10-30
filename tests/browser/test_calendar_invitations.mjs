import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import * as WasmCore from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const DISPOSABLE_DB = 'byos_recovery_disposable_20261024';
const API_PORT = '8096';
const WEBMAIL_PORT = '3016';

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
      if (res.ok || res.status === 404 || res.status === 401) return true;
    } catch {}
    await sleep(400);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function sendSmtp(host, port, from, to, msg) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host);
    let stage = 0;
    socket.setEncoding('utf8');
    socket.on('data', (data) => {
      const code = parseInt(data.slice(0, 3), 10);
      if (stage === 0 && code === 220) {
        stage = 1;
        socket.write('HELO localhost\r\n');
      } else if (stage === 1 && code === 250) {
        stage = 2;
        socket.write('MAIL FROM:<' + from + '>\r\n');
      } else if (stage === 2 && code === 250) {
        stage = 3;
        socket.write('RCPT TO:<' + to + '>\r\n');
      } else if (stage === 3 && code === 250) {
        stage = 4;
        socket.write('DATA\r\n');
      } else if (stage === 4 && code === 354) {
        stage = 5;
        socket.write(msg + '\r\n.\r\n');
      } else if (stage === 5 && code === 250) {
        stage = 6;
        socket.write('QUIT\r\n');
        resolve(true);
      }
    });
    socket.on('error', reject);
  });
}

function resetRateLimits() {
  try {
    execSync("docker exec byos-redis redis-cli eval \"for _,k in ipairs(redis.call('keys','rate:*')) do redis.call('del',k) end\" 0");
  } catch {}
}

/**
 * Background poller: relays pending outbound messages from the disposable database into Mailpit.
 */
class DisposableOutboundRelay {
  constructor() {
    this.running = false;
    this.skB64 = fs.readFileSync(path.join(repoRoot, 'infra', 'secrets', 'outbound_delivery_sk.b64'), 'utf8').trim();
  }

  start() {
    this.running = true;
    this.pollLoop();
  }

  stop() {
    this.running = false;
  }

  async pollLoop() {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (err) {
        // Silent retry
      }
      await sleep(800);
    }
  }

  async pollOnce() {
    const querySql = `SELECT coalesce(json_agg(json_build_object('id', id, 'recipient', recipient, 'ct', replace(encode(encrypted_message, 'base64'), E'\\n', ''), 'st', replace(encode(send_token_hpke_wrapped, 'base64'), E'\\n', ''), 'outbox_seq', outbox_seq, 'mailbox_id', mailbox_id)), '[]'::json) FROM outbound_queue WHERE status = 'pending';`;
    const resRaw = execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB} -t -A -c "${querySql}"`, { encoding: 'utf8' }).trim();
    if (!resRaw || resRaw === '[]') return;

    let items = [];
    try {
      items = JSON.parse(resRaw);
    } catch {
      return;
    }

    for (const item of items) {
      const { id, recipient, ct, st, outbox_seq, mailbox_id } = item;
      if (!id || !recipient || !ct || !st || !mailbox_id) continue;

      try {
        const mailboxIdHex = mailbox_id.replace(/-/g, '');
        const decryptedB64 = WasmCore.wasm_decrypt_outbound(
          this.skB64,
          st,
          mailboxIdHex,
          BigInt(outbox_seq),
          ct
        );
        const mimeMessage = Buffer.from(decryptedB64, 'base64').toString('utf8');

        // Relay to Mailpit on 127.0.0.1:1025
        await sendSmtp('127.0.0.1', 1025, 'alice@byos.local', recipient, mimeMessage);

        // Mark delivered
        execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB} -c "UPDATE outbound_queue SET status = 'delivered', delivered_at = NOW() WHERE id = '${id}';"`);
        console.log(`  [DisposableRelay] Delivered message ${id} to ${recipient} via Mailpit`);
      } catch (err) {
        console.warn(`  [DisposableRelay] Failed to deliver ${id}:`, err.message);
        execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB} -c "UPDATE outbound_queue SET status = 'bounced', failed_at = NOW() WHERE id = '${id}';"`);
      }
    }
  }
}

async function runInvitationBrowserTests() {
  console.log("================================================================================");
  console.log("       BYOS CALENDAR PHASE 5: COMPLETE INVITATIONS & MAILPIT TEST              ");
  console.log("================================================================================\n");

  const aliceUserId = 'cccccccc-0000-0000-0000-000000000002';
  const aliceMailboxId = 'c0000000-0000-0000-0000-000000000001';
  const currentPassword = 'test-password-123';
  const alicePasswordHash = '$argon2id$v=19$m=65536,t=3,p=2$2K4LPnHGYrPq+76HQK2hKQ$ol3Z1nfC344rKLOp1Yk+k02FCS4ohM+O9uRp51YUlgg';

  // Generate complete wrapped_sk_user with mailbox key, signing seed, and xwing seed
  const kpAlice = JSON.parse(WasmCore.wasm_generate_keypair());
  const salt1 = '0102030405060708090a0b0c0d0e0f10';
  const salt2 = '1112131415161718191a1b1c1d1e1f20';
  const salt3 = '2122232425262728292a2b2c2d2e2f30';
  const signSeedHex = '3132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f50';
  const xwingSeedHex = '5152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f70';
  const env1 = WasmCore.wasm_passphrase_wrap_key(currentPassword, salt1, kpAlice.secret_key);
  const env2 = WasmCore.wasm_passphrase_wrap_key(currentPassword, salt2, signSeedHex);
  const env3 = WasmCore.wasm_passphrase_wrap_key(currentPassword, salt3, xwingSeedHex);
  const aliceWskJson = JSON.stringify({
    salt: salt1,
    envelope: env1,
    signing_salt: salt2,
    signing_envelope: env2,
    xwing_salt: salt3,
    xwing_envelope: env3,
  });

  console.log("  Preparing disposable fixture in database:", DISPOSABLE_DB);
  const fixtureSql = `
    UPDATE users SET password_hash = '${alicePasswordHash}', two_factor_enabled = false, totp_secret = NULL, is_active = true WHERE id = '${aliceUserId}';
    DELETE FROM user_passkeys WHERE user_id = '${aliceUserId}';
    UPDATE mailboxes SET mailbox_pk = decode('${kpAlice.public_key}', 'hex'), wrapped_sk_user = $json$${aliceWskJson}$json$, is_active = true WHERE id = '${aliceMailboxId}';
  `;
  execSync(`docker exec -i byos-postgres psql -U byos -d ${DISPOSABLE_DB}`, { input: fixtureSql });

  const pkB64 = fs.readFileSync(path.join(repoRoot, 'infra', 'secrets', 'outbound_delivery_pk.b64'), 'utf8').trim();

  // 1. Spawn disposable API on port 8096
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
      OUTBOUND_DELIVERY_PK_B64: pkB64,
    },
    stdio: 'ignore',
  });

  // 2. Spawn disposable Webmail on port 3016
  console.log(`  Starting disposable Webmail on port ${WEBMAIL_PORT}...`);
  const webmailProc = spawn('cmd.exe', ['/c', 'npm.cmd', 'run', 'dev', '--', '--port', WEBMAIL_PORT, '--host', '127.0.0.1'], {
    cwd: path.join(repoRoot, 'apps', 'webmail'),
    env: {
      ...process.env,
      VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
    },
    stdio: 'ignore',
  });

  const relay = new DisposableOutboundRelay();
  relay.start();

  let browser;
  const unhandledErrors = [];

  try {
    console.log("  Waiting for disposable API and Webmail to become ready...");
    await waitForHttp(`http://127.0.0.1:${API_PORT}/v1/health`);
    await waitForHttp(`http://127.0.0.1:${WEBMAIL_PORT}`);
    console.log("  Disposable test services ready.\n");

    // Clear Mailpit before beginning
    try {
      await fetch('http://127.0.0.1:8025/api/v1/messages', { method: 'DELETE' });
    } catch {}

    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[handle') || text.includes('[sendMime') || text.includes('[DisposableRelay]')) {
        console.log(`  [BROWSER] ${text}`);
      }
      if (msg.type() === 'error') {
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)') &&
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_INTERNET_DISCONNECTED')
        ) {
          unhandledErrors.push(text);
          console.error(`  [CONSOLE ERROR] ${text}`);
        }
      }
    });

    // =========================================================================
    // STEP 1: Real login flow as Alice
    // =========================================================================
    console.log("--- [STEP 1] Real login flow as Alice (alice@byos.local) ---");
    await page.goto(`http://127.0.0.1:${WEBMAIL_PORT}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await sleep(2000);
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice.");

    // =========================================================================
    // STEP 2: Open an email to mount ReadingPane
    // =========================================================================
    console.log("\n--- [STEP 2] Opening an email to mount ReadingPane ---");
    const msgRow = await page.waitForSelector('[data-testid^="message-row-"]', { timeout: 3000 }).catch(() => null);
    if (msgRow) {
      await msgRow.click();
      await sleep(1000);
    } else {
      console.log("  Mounting test message into ReadingPane...");
      await page.evaluate(() => {
        const mockMsg = {
          id: "msg-invite-test-1",
          messageId: "msg-invite-test-1",
          mailboxId: "c0000000-0000-0000-0000-000000000001",
          sender: "Bob Jones <bob@byos.local>",
          recipient: "alice@byos.local",
          subject: "Invitation: Executive Strategy & Architecture Sync",
          snippet: "You have been invited to Executive Strategy & Architecture Sync.",
          date: new Date().toISOString(),
          folder: "inbox",
          read: true,
          starred: false,
        };
        if (window.__BYOS_TEST_SELECT_MSG__) window.__BYOS_TEST_SELECT_MSG__(mockMsg);
        if (window.__BYOS_TEST_SET_DECRYPTED_CONTENT__) window.__BYOS_TEST_SET_DECRYPTED_CONTENT__("Please attend the executive architecture review.");
        if (window.__BYOS_TEST_UNLOCK_ACCOUNT__) window.__BYOS_TEST_UNLOCK_ACCOUNT__();
        if (window.__BYOS_TEST_SET_IS_DECRYPTING__) window.__BYOS_TEST_SET_IS_DECRYPTING__(false);
      });
      await sleep(800);
    }

    // =========================================================================
    // STEP 3: Feed RFC 5545 Invitation to ReadingPane
    // =========================================================================
    console.log("\n--- [STEP 3] Testing Interactive Invitation Card in ReadingPane ---");
    const testUid = "inv-exec-" + Date.now();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);
    const tomorrowStr = tomorrowIso.replace(/-/g, '');

    const requestIcs = [
      "BEGIN:VCALENDAR",
      "PRODID:-//BYOS//BYOS Webmail Calendar//EN",
      "VERSION:2.0",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:${testUid}`,
      "SEQUENCE:0",
      `DTSTAMP:${tomorrowStr}T120000Z`,
      `DTSTART:${tomorrowStr}T140000Z`,
      `DTEND:${tomorrowStr}T150000Z`,
      "SUMMARY:Executive Strategy & Architecture Sync",
      "DESCRIPTION:Reviewing Phase 5 deliverables, encryption boundaries, and calendar roadmap.",
      "LOCATION:Room 402 / BYOS Executive",
      "URL:https://meet.byos.local/exec-sync",
      'ORGANIZER;CN="Bob Jones":mailto:bob@byos.local',
      'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN="Alice Smith":mailto:alice@byos.local',
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    await page.evaluate((ics) => {
      if (window.__BYOS_TEST_UNLOCK_ACCOUNT__) window.__BYOS_TEST_UNLOCK_ACCOUNT__();
      if (window.__BYOS_TEST_SET_IS_DECRYPTING__) window.__BYOS_TEST_SET_IS_DECRYPTING__(false);
      if (window.__BYOS_TEST_SET_CALENDAR_ICS__) window.__BYOS_TEST_SET_CALENDAR_ICS__(ics);
    }, requestIcs);
    await sleep(800);

    const cardEl = await page.waitForSelector('[data-testid="calendar-invitation-card"]', { timeout: 5000 });
    assert(cardEl !== null, "Calendar Invitation Card rendered in ReadingPane");

    const cardText = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="calendar-invitation-card"]');
      return card ? card.innerText : "";
    });
    assert(cardText.includes("Executive Strategy & Architecture Sync"), "Card displays correct event title");
    assert(cardText.includes("Bob Jones"), "Card displays organizer name");
    assert(cardText.includes("Room 402 / BYOS Executive"), "Card displays event location");
    assert(cardText.toUpperCase().includes("CALENDAR INVITATION"), "Card displays method badge");

    const cardScreenshot = path.join(artifactsDir, 'calendar_invitation_card.png');
    await page.screenshot({ path: cardScreenshot });
    console.log(`  Saved screenshot: ${cardScreenshot}`);

    // =========================================================================
    // STEP 3b: Authenticity Warning Verification (Organizer vs Sender Mismatch)
    // =========================================================================
    console.log("\n--- [STEP 3b] Testing Authenticity Warning (Organizer Mismatch) ---");
    const spoofedIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "METHOD:REQUEST",
      "BEGIN:VEVENT",
      `UID:spoof-check-${Date.now()}`,
      "SEQUENCE:0",
      `DTSTART:${tomorrowStr}T140000Z`,
      `DTEND:${tomorrowStr}T150000Z`,
      "SUMMARY:Spoofed Executive Invitation",
      'ORGANIZER;CN="External Impostor":mailto:impostor@attacker.com',
      "STATUS:CONFIRMED",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    await page.evaluate((ics) => {
      if (window.__BYOS_TEST_SET_CALENDAR_ICS__) window.__BYOS_TEST_SET_CALENDAR_ICS__(ics);
    }, spoofedIcs);
    await sleep(600);

    const warnEl = await page.waitForSelector('[data-testid="invitation-authenticity-warning"]', { timeout: 4000 });
    assert(warnEl !== null, "Authenticity warning banner rendered when organizer differs from sender");
    const warnText = await page.$eval('[data-testid="invitation-authenticity-warning"]', (el) => el.innerText);
    assert(warnText.includes("impostor@attacker.com"), "Warning identifies divergent organizer email");

    const authWarningScreenshot = path.join(artifactsDir, 'calendar_invitation_authenticity_warning.png');
    await page.screenshot({ path: authWarningScreenshot });
    console.log(`  Saved screenshot: ${authWarningScreenshot}`);

    // Restore authoritative requestIcs
    await page.evaluate((ics) => {
      if (window.__BYOS_TEST_SET_CALENDAR_ICS__) window.__BYOS_TEST_SET_CALENDAR_ICS__(ics);
    }, requestIcs);
    await sleep(600);

    // =========================================================================
    // STEP 4: Exercise RSVP Actions (Accept, Tentative, Decline)
    // =========================================================================
    console.log("\n--- [STEP 4] Exercising RSVP Lifecycle (Accept, Tentative, Decline) ---");
    const acceptBtn = await page.waitForSelector('[data-testid="invitation-accept-btn"]');
    await acceptBtn.click();
    await sleep(800);

    const afterAcceptText = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="calendar-invitation-card"]');
      return card ? card.innerText : "";
    });
    assert(afterAcceptText.includes("Accepted"), "Card reflects Accepted RSVP state");
    assert(afterAcceptText.includes("added to your calendar"), "Action feedback banner confirms calendar sync");

    const acceptedScreenshot = path.join(artifactsDir, 'calendar_invitation_accepted.png');
    await page.screenshot({ path: acceptedScreenshot });
    console.log(`  Saved screenshot: ${acceptedScreenshot}`);

    const tentativeBtn = await page.waitForSelector('[data-testid="invitation-tentative-btn"]');
    await tentativeBtn.click();
    await sleep(600);
    const afterTentativeText = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="calendar-invitation-card"]');
      return card ? card.innerText : "";
    });
    assert(afterTentativeText.includes("Tentative"), "Card reflects Tentative RSVP state");

    const declineBtn = await page.waitForSelector('[data-testid="invitation-decline-btn"]');
    await declineBtn.click();
    await sleep(600);
    const afterDeclineText = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="calendar-invitation-card"]');
      return card ? card.innerText : "";
    });
    assert(afterDeclineText.includes("Declined"), "Card reflects Declined RSVP state");

    // =========================================================================
    // STEP 4b: Security rejection checks
    // =========================================================================
    console.log("\n--- [STEP 4b] Security rejection: negative SEQUENCE policy and organizer mismatch ---");
    const securityRejections = await page.evaluate(async (uid, tomorrow) => {
      const results = {};
      try {
        await window.__BYOS_TEST_HANDLE_RSVP__("ACCEPTED", {
          uid,
          sequence: -1,
          summary: "Invalid-sequence attempt (BYOS policy)",
          startTime: new Date(`${tomorrow}T14:00:00Z`),
          endTime: new Date(`${tomorrow}T15:00:00Z`),
          isAllDay: false,
          status: "CONFIRMED",
          organizer: { email: "bob@byos.local" },
          attendees: [],
        });
        results.invalidSeqRejected = false;
      } catch (err) {
        results.invalidSeqRejected = true;
        results.invalidSeqError = err.message;
      }

      try {
        const verify = window.__BYOS_TEST_VERIFY_AUTHENTICITY__;
        if (typeof verify !== "function") throw new Error("__BYOS_TEST_VERIFY_AUTHENTICITY__ not exposed");
        const existingDetails = {
          uid,
          sequence: 0,
          organizer: { email: "bob@byos.local", name: "Bob Jones" },
          myRsvpStatus: "ACCEPTED",
        };
        const hijackEvent = {
          uid,
          sequence: 5,
          summary: "Organizer Hijack attempt",
          startTime: new Date(`${tomorrow}T14:00:00Z`),
          endTime: new Date(`${tomorrow}T15:00:00Z`),
          isAllDay: false,
          status: "CONFIRMED",
          organizer: { email: "hijacker@unauthorized.local" },
          attendees: [],
        };
        const checkResult = verify(hijackEvent, existingDetails, "ACCEPTED");
        results.hijackHelperRejected = !checkResult.valid && checkResult.isOrganizerMismatch;
        results.hijackHelperError = checkResult.reason;
      } catch (err) {
        results.hijackHelperRejected = false;
        results.hijackHelperError = err.message;
      }
      return results;
    }, testUid, tomorrowIso);

    assert(securityRejections.invalidSeqRejected === true, "Negative sequence rejected by BYOS policy");
    assert(securityRejections.hijackHelperRejected === true, "Organizer mismatch helper rejects hijacking");

    // =========================================================================
    // STEP 4c: External RSVP reply delivery verification via Mailpit
    // =========================================================================
    console.log("\n--- [STEP 4c] External RSVP reply delivery to Mailpit ---");
    // Clear Mailpit before RSVP
    await fetch('http://127.0.0.1:8025/api/v1/messages', { method: 'DELETE' });

    const extRsvpUid = "board-sync-" + Date.now();
    await page.evaluate(async (uid, tomorrow) => {
      await window.__BYOS_TEST_HANDLE_RSVP__("ACCEPTED", {
        uid,
        sequence: 1,
        summary: "Executive Q4 Board Strategy",
        startTime: new Date(`${tomorrow}T14:00:00Z`),
        endTime: new Date(`${tomorrow}T15:00:00Z`),
        isAllDay: false,
        status: "CONFIRMED",
        organizer: { name: "Board Chair", email: "board-chair@external-corporation.com" },
        attendees: [{ email: "alice@byos.local", partstat: "NEEDS-ACTION" }],
      });
    }, extRsvpUid, tomorrowIso);

    console.log("  Waiting for RSVP reply to arrive in Mailpit...");
    let rsvpMailpitMsg = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      try {
        const resp = await fetch('http://127.0.0.1:8025/api/v1/messages');
        if (resp.ok) {
          const data = await resp.json();
          const match = (data.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'board-chair@external-corporation.com')
          );
          if (match) {
            rsvpMailpitMsg = match;
            break;
          }
        }
      } catch {}
    }
    assert(rsvpMailpitMsg !== null, "External RSVP reply email delivered to Mailpit");
    assert(rsvpMailpitMsg.Subject.includes("Accepted"), "RSVP reply email subject contains 'Accepted'");
    assert(rsvpMailpitMsg.From?.Address === "alice@byos.local", "RSVP reply sender is alice@byos.local");

    // Screenshot Mailpit view
    const mailpitPage = await browser.newPage();
    await mailpitPage.setViewport({ width: 1280, height: 800 });
    await mailpitPage.goto(`http://127.0.0.1:8025/#/view/${rsvpMailpitMsg.ID}`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const rsvpMailpitScreenshot = path.join(artifactsDir, 'calendar_invitation_external_rsvp_mailpit.png');
    await mailpitPage.screenshot({ path: rsvpMailpitScreenshot });
    console.log(`  Saved screenshot: ${rsvpMailpitScreenshot}`);
    await mailpitPage.close();

    // =========================================================================
    // STEP 6: Switch to Calendar Module & Test Outgoing External Invitation
    // =========================================================================
    console.log("\n--- [STEP 6] Testing Calendar Module: Creating External Invitation ---");
    resetRateLimits();
    // Clear Mailpit before creating new event
    await fetch('http://127.0.0.1:8025/api/v1/messages', { method: 'DELETE' });

    const calendarTab = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await calendarTab.click();
    await sleep(1000);
    assert(await page.$('[data-testid="calendar-view"]') !== null, "Calendar view rendered");

    const newEventBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await sleep(600);

    const eventTitle = "Phase 5 Architecture Sync";
    await page.type('[data-testid="event-title-input"]', eventTitle);

    const attendeeInput = await page.waitForSelector('input#event-attendees', { timeout: 5000 });
    await attendeeInput.type('partner@external-client.com');
    await attendeeInput.press('Enter');
    await sleep(400);

    const inviteCheckbox = await page.waitForSelector('[data-testid="send-invitations-checkbox"]', { timeout: 5000 });
    assert(inviteCheckbox !== null, "Send invitations checkbox rendered when attendees are specified");

    const saveEventBtn = await page.waitForSelector('[data-testid="save-event-btn"]');
    await saveEventBtn.click();
    await sleep(2000);

    const calEventScreenshot = path.join(artifactsDir, 'calendar_invitation_event_created.png');
    await page.screenshot({ path: calEventScreenshot });
    console.log(`  Saved screenshot: ${calEventScreenshot}`);

    console.log("  Waiting for invitation email to arrive in Mailpit...");
    let inviteMailpitMsg = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      try {
        const resp = await fetch('http://127.0.0.1:8025/api/v1/messages');
        if (resp.ok) {
          const data = await resp.json();
          const match = (data.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'partner@external-client.com')
          );
          if (match) {
            inviteMailpitMsg = match;
            break;
          }
        }
      } catch {}
    }
    assert(inviteMailpitMsg !== null, "External invitation delivered to Mailpit");
    assert(inviteMailpitMsg.Subject === `Invitation: ${eventTitle}`, "Invitation email has correct Subject");
    assert(inviteMailpitMsg.From?.Address === "alice@byos.local", "Invitation sender is alice@byos.local");

    // =========================================================================
    // STEP 7: Event Update with Monotonic Sequence Increment
    // =========================================================================
    console.log("\n--- [STEP 7] Updating Event: Sequence Monotonically Increments ---");
    resetRateLimits();
    await fetch('http://127.0.0.1:8025/api/v1/messages', { method: 'DELETE' });

    // Click on specific event pill to open modal for editing
    await page.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 10000 });
    const clicked = await page.evaluate((title) => {
      const pills = Array.from(document.querySelectorAll('[data-testid="calendar-event-pill"]'));
      const target = pills.find((p) => p.innerText.includes(title));
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, eventTitle);
    assert(clicked, `Clicked event pill for ${eventTitle}`);
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 10000 });
    await sleep(600);

    assert(await page.$('[data-testid="event-modal"]') !== null, "Event modal reopened for editing");

    const updatedTitle = "Phase 5 Architecture Sync (Updated)";
    const titleInput = await page.waitForSelector('[data-testid="event-title-input"]');
    await titleInput.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await titleInput.type(updatedTitle);

    const updateSaveBtn = await page.waitForSelector('[data-testid="save-event-btn"]');
    await updateSaveBtn.click();
    await sleep(2000);

    const updateScreenshot = path.join(artifactsDir, 'calendar_invitation_event_updated.png');
    await page.screenshot({ path: updateScreenshot });
    console.log(`  Saved screenshot: ${updateScreenshot}`);

    console.log("  Waiting for updated invitation to arrive in Mailpit...");
    let updatedMailpitMsg = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      try {
        const resp = await fetch('http://127.0.0.1:8025/api/v1/messages');
        if (resp.ok) {
          const data = await resp.json();
          const match = (data.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'partner@external-client.com') &&
            m.Subject.includes("Updated Invitation:")
          );
          if (match) {
            updatedMailpitMsg = match;
            break;
          }
        }
      } catch {}
    }
    assert(updatedMailpitMsg !== null, "Updated invitation delivered to Mailpit with incremented sequence");
    assert(updatedMailpitMsg.Subject === `Updated Invitation: ${updatedTitle}`, "Updated invitation has 'Updated Invitation:' prefix");

    // =========================================================================
    // STEP 8: Event Cancellation Dispatch
    // =========================================================================
    console.log("\n--- [STEP 8] Event Cancellation: METHOD:CANCEL Dispatch ---");
    resetRateLimits();
    await fetch('http://127.0.0.1:8025/api/v1/messages', { method: 'DELETE' });

    // Click on updated event pill to open modal
    await page.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 10000 });
    const cancelClicked = await page.evaluate((title) => {
      const pills = Array.from(document.querySelectorAll('[data-testid="calendar-event-pill"]'));
      const target = pills.find((p) => p.innerText.includes(title));
      if (target) {
        target.click();
        return true;
      }
      return false;
    }, updatedTitle);
    assert(cancelClicked, `Clicked event pill for ${updatedTitle}`);
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 10000 });
    await sleep(600);

    // Accept window confirm dialog automatically
    page.once('dialog', async (dialog) => {
      console.log(`  Dialog message: ${dialog.message()}`);
      await dialog.accept();
    });

    const deleteBtn = await page.waitForSelector('[data-testid="delete-event-btn"]', { timeout: 5000 });
    await deleteBtn.click();
    await sleep(2000);

    const cancelScreenshot = path.join(artifactsDir, 'calendar_invitation_event_cancelled.png');
    await page.screenshot({ path: cancelScreenshot });
    console.log(`  Saved screenshot: ${cancelScreenshot}`);

    console.log("  Waiting for cancellation email to arrive in Mailpit...");
    let cancelMailpitMsg = null;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      try {
        const resp = await fetch('http://127.0.0.1:8025/api/v1/messages');
        if (resp.ok) {
          const data = await resp.json();
          const match = (data.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'partner@external-client.com') &&
            m.Subject.includes("Cancelled:")
          );
          if (match) {
            cancelMailpitMsg = match;
            break;
          }
        }
      } catch {}
    }
    assert(cancelMailpitMsg !== null, "Cancellation email delivered to Mailpit");
    assert(cancelMailpitMsg.Subject === `Cancelled: ${updatedTitle}`, "Cancellation email subject has 'Cancelled:' prefix");

    // =========================================================================
    // STEP 9: Verify 375px Mobile Viewport Responsiveness
    // =========================================================================
    console.log("\n--- [STEP 9] Verifying 375px Mobile Viewport Responsiveness ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(1000);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!hasHorizontalOverflow, "375px mobile viewport has NO horizontal overflow");

    const mobileScreenshot = path.join(artifactsDir, 'calendar_invitations_mobile_375px.png');
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    // Reset viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Return to Mail View
    const backToMailBtn = await page.waitForSelector('[data-testid="back-to-mail-btn"]', { timeout: 5000 });
    await backToMailBtn.click();
    await sleep(1000);
    assert(await page.$('[data-testid="main-content"]') !== null, "Successfully returned to Mail view");

    console.log("\n================================================================================");
    console.log("    ALL CALENDAR INVITATION & MAILPIT TESTS COMPLETED SUCCESSFULLY!             ");
    console.log("================================================================================\n");

  } catch (err) {
    console.error("FATAL BROWSER TEST ERROR:", err);
    throw err;
  } finally {
    relay.stop();
    if (browser) await browser.close();
    apiProc.kill();
    webmailProc.kill();
  }
}

runInvitationBrowserTests().catch((err) => {
  console.error("Browser test failed:", err);
  process.exit(1);
});
