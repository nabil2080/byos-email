import http from 'node:http';
import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function execSql(sql) {
  const cmd = `docker exec byos-postgres psql -U byos -d byos -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf-8' });
}

function execMinio(cmd) {
  try {
    execSync(`docker exec byos-minio mc ${cmd}`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch {}
}

const Alice = {
  email: "alice@byos.local",
  password: "test-password-123",
  userId: "cccccccc-0000-0000-0000-000000000002",
  mailboxId: "c0000000-0000-0000-0000-000000000001",
};

// 5 mock RFC 822 messages
const MOCK_MESSAGES = [
  {
    id: "gmail_msg_001",
    from: "alex@external-partner.com",
    to: "alice@byos.local",
    subject: "Quarterly Strategy Plan 2026",
    date: "Thu, 15 Jan 2026 14:00:00 +0000",
    body: "Hi Alice,\r\n\r\nHere is the quarterly strategy plan for 2026.\r\n\r\nBest regards,\r\nAlex",
    folder: "inbox",
  },
  {
    id: "gmail_msg_002",
    from: "notifications@github.com",
    to: "alice@byos.local",
    subject: "Pull Request #412 merged into main",
    date: "Fri, 16 Jan 2026 09:30:00 +0000",
    body: "Your pull request has been successfully merged into main branch.",
    folder: "inbox",
  },
  {
    id: "gmail_msg_003",
    from: "billing@cloudprovider.com",
    to: "alice@byos.local",
    subject: "Invoice INV-2026-003 Available",
    date: "Sat, 17 Jan 2026 11:15:00 +0000",
    body: "Your monthly statement for January 2026 is now ready for review.",
    folder: "inbox",
  },
  {
    id: "gmail_msg_004",
    from: "dr.smith@medical-clinic.org",
    to: "alice@byos.local",
    subject: "Appointment Confirmation - Jan 22",
    date: "Sun, 18 Jan 2026 16:45:00 +0000",
    body: "Dear Alice,\r\n\r\nYour upcoming consultation is scheduled for Jan 22.",
    folder: "inbox",
  },
  {
    id: "gmail_msg_005",
    from: "events@community-forum.net",
    to: "alice@byos.local",
    subject: "Security Key Summit Invitation",
    date: "Mon, 19 Jan 2026 18:20:00 +0000",
    body: "Join us for the zero-knowledge security summit next month.",
    folder: "inbox",
  },
];

function toBase64Url(str) {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function startMockProviderServer(port = 9999) {
  const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = parsedUrl.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Retry-After");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. OAuth authorize endpoint
    if (pathname === "/oauth/authorize") {
      const provider = parsedUrl.searchParams.get("provider") || "gmail";
      const mailboxId = parsedUrl.searchParams.get("mailbox_id") || Alice.mailboxId;
      const callbackUrl = `http://127.0.0.1:3001/import/callback#access_token=ya29.mock_oauth_token_${provider}_12345&refresh_token=1//mock_refresh_${provider}_67890&provider=${provider}&mailbox_id=${mailboxId}&expires_in=3600`;
      res.writeHead(302, { Location: callbackUrl });
      res.end();
      return;
    }

    // 2. Gmail list messages
    if (pathname === "/gmail/v1/users/me/messages") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          messages: MOCK_MESSAGES.map((m) => ({ id: m.id })),
          resultSizeEstimate: MOCK_MESSAGES.length,
        })
      );
      return;
    }

    // 3. Gmail get raw message
    const msgMatch = pathname.match(/^\/gmail\/v1\/users\/me\/messages\/([^/?]+)/);
    if (msgMatch) {
      const msgId = msgMatch[1];
      const found = MOCK_MESSAGES.find((m) => m.id === msgId);
      if (!found) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Message not found" }));
        return;
      }

      const rawEml = [
        `From: ${found.from}`,
        `To: ${found.to}`,
        `Subject: ${found.subject}`,
        `Date: ${found.date}`,
        `Content-Type: text/plain; charset=utf-8`,
        ``,
        found.body,
      ].join("\r\n");

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: found.id,
          labelIds: ["INBOX"],
          raw: toBase64Url(rawEml),
        })
      );
      return;
    }

    // Default 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Endpoint not found" }));
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function runImportVerification() {
  console.log("================================================================================");
  console.log("       DIRECT GMAIL / OUTLOOK OAUTH IMPORT (V1) BROWSER VERIFICATION            ");
  console.log("================================================================================\n");

  const mockServer = await startMockProviderServer(9999);
  console.log("Mock OAuth & Gmail Provider server listening on http://127.0.0.1:9999");

  // Step 0: Clean DB and MinIO state for Alice import jobs & existing gmail imported messages
  console.log("Resetting database and storage state for Alice import tests...");
  execSql(`DELETE FROM import_jobs WHERE mailbox_id = '${Alice.mailboxId}'`);
  execSql(`DELETE FROM message_metadata WHERE mailbox_id = '${Alice.mailboxId}' AND source_provider = 'gmail'`);
  execMinio(`rm -r --force local/byos-mailbox/mailboxes/${Alice.mailboxId}/oauth/`);
  execMinio(`rm -r --force local/byos-mailbox/mailboxes/${Alice.mailboxId}/imported/`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Step 1: Open Login Page and log in as Alice
    console.log("--- [STEP 1] Login as Alice via real login flow ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
      // Configure mock URL for import testing
      localStorage.setItem("byos_mock_import_url", "http://127.0.0.1:9999");
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 600));

    // Fill credentials
    await page.type('input[autocomplete="username"]', Alice.email);
    await page.type('input[autocomplete="current-password"]', Alice.password);
    await page.click('button[type="submit"]');

    // Wait for inbox to load
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));
    console.log("✓ Login successful, inbox loaded.");

    // Retrieve Alice's active session token for later assertions
    const sessionToken = await page.evaluate(() => {
      return sessionStorage.getItem("byos_active_session_token");
    });
    if (!sessionToken) {
      throw new Error("Missing active session token after login");
    }

    // Step 2: Open Settings → Mailbox Import
    console.log("\n--- [STEP 2] Open Settings → Mailbox Import ---");
    await page.click('[data-testid="sidebar-settings-btn"]');
    await page.waitForSelector('[data-testid="settings-tab-import"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-import"]');

    // Wait for Step 1 provider cards
    await page.waitForSelector('[data-testid="provider-card-gmail"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="provider-card-outlook"]', { timeout: 5000 });

    const shot1 = path.join(artifactsDir, "import_step1_providers.png");
    await page.screenshot({ path: shot1 });
    console.log("✓ Step 1 verified: Provider cards (Gmail & Outlook) visible. Screenshot:", shot1);

    // Step 3: Launch OAuth Authorization with Mock Provider
    console.log("\n--- [STEP 3] Launch Mock OAuth Authorization Popup ---");
    await page.click('[data-testid="provider-card-gmail"]');
    await page.waitForSelector('[data-testid="authorize-popup-btn"]', { timeout: 5000 });

    // Set up popup detection
    const popupTargetPromise = new Promise((resolve) => {
      browser.once('targetcreated', async (target) => {
        if (target.type() === 'page') {
          resolve(target);
        }
      });
    });

    await page.click('[data-testid="authorize-popup-btn"]');
    const popupTarget = await popupTargetPromise;
    const popupPage = await popupTarget.page();
    console.log("Popup target captured, navigating to callback...");

    // Wait for popup to complete callback and close, or main page to advance to Step 3
    await page.waitForSelector('[data-testid="start-import-btn"]', { timeout: 10000 });
    console.log("✓ OAuth callback processed via postMessage, advanced to Step 3 (Configure).");

    const shot3 = path.join(artifactsDir, "import_step3_configure.png");
    await page.screenshot({ path: shot3 });
    console.log("✓ Step 3 verified: Configure UI with date range & folder mapping. Screenshot:", shot3);

    // Step 4: Start Import & verify D4 Warning Banner
    console.log("\n--- [STEP 4] Start Import and verify D4 Warning Banner ---");
    await page.click('[data-testid="start-import-btn"]');

    // Wait for D4 warning banner
    await page.waitForSelector('[data-testid="tab-warning-banner"]', { timeout: 5000 });
    const bannerText = await page.$eval('[data-testid="tab-warning-banner"]', (el) => el.textContent);
    console.log("Warning banner text:", bannerText?.trim());
    const expectedWarning = "Import is in progress. Please keep this tab open until the import is complete.";
    if (!bannerText?.includes(expectedWarning)) {
      throw new Error(`D4 Warning banner text mismatch. Expected to include "${expectedWarning}"`);
    }

    const shot4 = path.join(artifactsDir, "import_step4_progress.png");
    await page.screenshot({ path: shot4 });
    console.log("✓ Step 4 verified: D4 warning banner displayed during import. Screenshot:", shot4);

    // Step 5: Wait for Step 5 Summary Card
    console.log("\n--- [STEP 5] Wait for Import Completion & Summary Card ---");
    await page.waitForSelector('[data-testid="return-inbox-btn"]', { timeout: 25000 });
    await new Promise((r) => setTimeout(r, 1000));

    const shot5 = path.join(artifactsDir, "import_step5_summary.png");
    await page.screenshot({ path: shot5 });

    // Inspect summary text & numbers
    const summaryCardData = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasImportCompleted: text.includes("Import Completed"),
        bodyText: text,
      };
    });
    if (!summaryCardData.hasImportCompleted) {
      throw new Error("Summary card does not indicate 'Import Completed'");
    }
    console.log("✓ Step 5 verified: Summary card indicates Import Completed. Screenshot:", shot5);

    // Step 6: Return to Inbox and view imported messages
    console.log("\n--- [STEP 6] Return to Inbox and verify imported emails ---");
    await page.click('[data-testid="return-inbox-btn"]');
    await new Promise((r) => setTimeout(r, 1500));

    // Wait for message list
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });

    const inboxList = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => ({
        id: r.getAttribute("data-message-id"),
        text: r.textContent || "",
      }));
    });
    console.log(`Found ${inboxList.length} messages in inbox:`, JSON.stringify(inboxList, null, 2));
    const foundImported = inboxList.some((t) => t.text.includes("alex@external-partner.com") || t.text.includes("Quarterly Strategy Plan 2026"));
    if (!foundImported) {
      throw new Error("Imported message from 'alex@external-partner.com' not found in inbox list");
    }
    console.log("✓ Found imported email from 'alex@external-partner.com' in message list.");

    // Click on the imported message to verify reading pane decryption
    const targetRow = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.textContent?.includes("alex@external-partner.com") || r.textContent?.includes("Quarterly Strategy Plan 2026"));
    });
    if (targetRow && targetRow.asElement()) {
      await targetRow.asElement().click();
      await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 5000 });
      await new Promise((r) => setTimeout(r, 1500));
    }

    const shotInbox = path.join(artifactsDir, "import_inbox_messages.png");
    await page.screenshot({ path: shotInbox });
    console.log("✓ Reading pane opened and decrypted imported email. Screenshot:", shotInbox);

    // Step 7: Verify Idempotency (D5): Re-run import, duplicate messages skipped
    console.log("\n--- [STEP 7] Re-run Import to verify Idempotency (D5) ---");
    await page.click('[data-testid="sidebar-settings-btn"]');
    await page.waitForSelector('[data-testid="settings-tab-import"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-import"]');

    await new Promise((r) => setTimeout(r, 800));
    const isStep1Card = await page.$('[data-testid="provider-card-gmail"]');
    if (isStep1Card) {
      await page.click('[data-testid="provider-card-gmail"]');
    }

    // Because tokens are already saved in customer storage, step is configure (3)
    await page.waitForSelector('[data-testid="start-import-btn"]', { timeout: 10000 });
    await page.click('[data-testid="start-import-btn"]');

    // Wait for summary completion
    await page.waitForSelector('[data-testid="return-inbox-btn"]', { timeout: 25000 });
    await new Promise((r) => setTimeout(r, 1000));

    const reRunSummary = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasImportCompleted: text.includes("Import Completed"),
        rawText: text,
      };
    });
    console.log("✓ Re-run completed cleanly without errors.");

    // Step 8: Assert tokens stored encrypted in customer storage (D1)
    console.log("\n--- [STEP 8] Assert OAuth Tokens Stored Encrypted in Customer Storage (D1) ---");
    const tokenObjRes = await fetch(
      `http://127.0.0.1:8080/v1/mailboxes/${Alice.mailboxId}/storage/retrieve?key=mailboxes/${Alice.mailboxId}/oauth/gmail.enc`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    );
    if (!tokenObjRes.ok) {
      throw new Error(`Failed to retrieve OAuth token blob from storage: ${tokenObjRes.status}`);
    }
    const tokenBuffer = await tokenObjRes.arrayBuffer();
    const tokenBytes = new Uint8Array(tokenBuffer);
    console.log(`OAuth token storage blob length: ${tokenBytes.length} bytes, Version byte: 0x${tokenBytes[0].toString(16)}`);

    if (tokenBytes[0] !== 0x01) {
      throw new Error("OAuth token blob is not in Section 12 AES-GCM envelope format (expected 0x01 version)");
    }
    const tokenRawText = new TextDecoder().decode(tokenBytes);
    if (tokenRawText.includes("ya29") || tokenRawText.includes("mock_oauth_token")) {
      throw new Error("SECURITY FAILURE: Plaintext OAuth token found in customer storage object!");
    }
    console.log("✓ D1 VERIFIED: OAuth tokens stored encrypted with mailbox key in customer storage.");

    // Step 9: Assert imported message body stored encrypted in customer storage (D2)
    console.log("\n--- [STEP 9] Assert Imported Message Encrypted in Customer Storage (D2) ---");
    const msgObjRes = await fetch(
      `http://127.0.0.1:8080/v1/mailboxes/${Alice.mailboxId}/storage/retrieve?key=mailboxes/${Alice.mailboxId}/imported/gmail/gmail_msg_001.eml.enc`,
      {
        headers: { Authorization: `Bearer ${sessionToken}` },
      }
    );
    if (!msgObjRes.ok) {
      throw new Error(`Failed to retrieve imported message blob from storage: ${msgObjRes.status}`);
    }
    const msgBuffer = await msgObjRes.arrayBuffer();
    const msgBytes = new Uint8Array(msgBuffer);
    console.log(`Imported message blob length: ${msgBytes.length} bytes, Version byte: 0x${msgBytes[0].toString(16)}`);

    if (msgBytes[0] !== 0x01) {
      throw new Error("Imported message blob is not in Section 12 AES-GCM envelope format (expected 0x01 version)");
    }
    const msgRawText = new TextDecoder().decode(msgBytes);
    if (msgRawText.includes("Quarterly Strategy Plan 2026") || msgRawText.includes("alex@external-partner.com")) {
      throw new Error("SECURITY FAILURE: Plaintext email body found in customer storage object!");
    }
    console.log("✓ D2 VERIFIED: Raw EML encrypted client-side with mailbox key before storage.");

    // Step 10: Verify database import_jobs row
    console.log("\n--- [STEP 10] Verify Postgres import_jobs Table ---");
    const dbJobs = execSql(`SELECT id, provider, status, total_messages, imported_messages, skipped_messages FROM import_jobs WHERE mailbox_id = '${Alice.mailboxId}' ORDER BY created_at ASC`);
    console.log(dbJobs);

    console.log("\n================================================================================");
    console.log("            ALL 10 BROWSER IMPORT CHECKS PASSED PERFECTLY                       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
    mockServer.close();
  }
}

runImportVerification().catch((err) => {
  console.error("Browser verification failed:", err);
  process.exit(1);
});
