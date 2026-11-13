/**
 * Browser Verification Script for Webmail Critical Workflows:
 * 1. Compose empty body/subject validation error.
 * 2. ReadingPane action buttons (Reply, Forward, missing Reply All).
 * 3. ReadingPane 'View headers' card (missing raw RFC 5322 MIME headers).
 * 4. Folder-scoped search behavior.
 */

import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve(__dirname, "artifacts");

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log("=== STARTING BROWSER CRITICAL UI VERIFICATION ===");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setCacheEnabled(false);

  try {
    console.log("1. Logging into Webmail as Alice...");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await sleep(1000);

    const hasLogin = await page.$('input[type="email"]');
    if (hasLogin) {
      await page.type('input[type="email"]', "alice@byos.local");
      await page.type('input[type="password"]', "test-password-123");
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
      await sleep(1000);
    }
    console.log("  ✓ Logged in successfully.");

    // -------------------------------------------------------------------------
    // Test 1: Compose Empty Body / Subject Blocked
    // -------------------------------------------------------------------------
    console.log("2. Testing Compose blocked send with empty body...");
    const composeBtn = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn.click();
    await sleep(500);

    // Fill in recipient and subject, leave body blank
    const toInput = await page.waitForSelector('input[placeholder*="recipient@"]', { timeout: 5000 });
    await toInput.type("bob@byos.local");
    await page.keyboard.press("Enter");

    const subjectInput = await page.waitForSelector('#composeSubjectInput', { timeout: 5000 });
    await subjectInput.type("Empty Body Test");

    const sendBtn = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtn.click();
    await sleep(800);

    const errorBannerText = await page.evaluate(() => {
      const el = document.querySelector('[class*="bg-rose-50"]');
      return el ? el.textContent.trim() : null;
    });

    console.log(`  Observed compose error banner: "${errorBannerText}"`);
    await page.screenshot({
      path: path.join(artifactsDir, "webmail_compose_blocked_empty_body.png"),
      clip: { x: 300, y: 100, width: 800, height: 700 },
    });
    console.log("  ✓ Screenshot saved: webmail_compose_blocked_empty_body.png");

    // Close compose drawer
    await page.keyboard.press("Escape");
    await sleep(500);

    // -------------------------------------------------------------------------
    // Test 2: ReadingPane Action Buttons (Check Reply All)
    // -------------------------------------------------------------------------
    console.log("3. Inspecting ReadingPane action buttons...");
    const messageRows = await page.$$('[data-testid="message-row"]');
    if (messageRows.length > 0) {
      await messageRows[0].click();
      await sleep(800);

      const readingPaneButtons = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('footer button, [data-testid="reading-pane"] button'));
        return btns.map((b) => b.textContent.trim()).filter(Boolean);
      });
      console.log("  Observed ReadingPane buttons:", readingPaneButtons);

      const hasReplyAll = readingPaneButtons.some((b) => b.toLowerCase().includes("reply all"));
      console.log(`  Reply All present in ReadingPane: ${hasReplyAll}`);

      await page.screenshot({
        path: path.join(artifactsDir, "webmail_reading_pane_no_reply_all.png"),
        clip: { x: 500, y: 0, width: 940, height: 900 },
      });
      console.log("  ✓ Screenshot saved: webmail_reading_pane_no_reply_all.png");

      // -------------------------------------------------------------------------
      // Test 3: ReadingPane 'View headers' Details Dropdown
      // -------------------------------------------------------------------------
      console.log("4. Inspecting 'View headers' menu action...");
      // Click more actions menu in reading pane
      const moreBtn = await page.$('button[title*="More"], button[aria-label*="More"]');
      if (moreBtn) {
        await moreBtn.click();
        await sleep(400);

        const viewHeadersBtn = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('[role="menuitem"], button'));
          const target = items.find((el) => el.textContent.includes("headers") || el.textContent.includes("View headers"));
          if (target) {
            target.click();
            return true;
          }
          return false;
        });

        await sleep(500);
        console.log(`  Clicked 'View headers': ${viewHeadersBtn}`);

        const headerCardContent = await page.evaluate(() => {
          const popup = document.querySelector('.grid-cols-\\[50px_1fr\\]')?.parentElement;
          return popup ? popup.textContent.trim().replace(/\s+/g, " ") : null;
        });
        console.log(`  Rendered 'View headers' card content: "${headerCardContent}"`);

        await page.screenshot({
          path: path.join(artifactsDir, "webmail_view_headers_modal.png"),
          clip: { x: 500, y: 50, width: 600, height: 400 },
        });
        console.log("  ✓ Screenshot saved: webmail_view_headers_modal.png");
      }
    }

    // -------------------------------------------------------------------------
    // Test 4: Search Scoping
    // -------------------------------------------------------------------------
    console.log("5. Testing Search scoping...");
    const searchInput = await page.$('input[placeholder*="Search"]');
    if (searchInput) {
      await searchInput.type("from:alice");
      await page.keyboard.press("Enter");
      await sleep(600);

      const matchedRowsCount = (await page.$$('[data-testid="message-row"]')).length;
      console.log(`  Query 'from:alice' returned rows: ${matchedRowsCount}`);

      await page.screenshot({
        path: path.join(artifactsDir, "webmail_search_folder_scoped.png"),
        clip: { x: 200, y: 0, width: 800, height: 600 },
      });
      console.log("  ✓ Screenshot saved: webmail_search_folder_scoped.png");
    }

    console.log("\n=== ALL BROWSER CRITICAL UI VERIFICATIONS COMPLETED SUCCESSFULLY ===");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Browser verification error:", err);
  process.exit(1);
});
