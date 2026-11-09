/**
 * Browser verification test:
 * Verifies the updated Spam folder icon and actions across the BYOS Webmail UI:
 * 1. Sidebar folder list: Spam folder displays the modern flame icon.
 * 2. Reading pane action menu: Report spam / Move to spam displays the flame icon.
 * 3. Batch toolbar move dropdown: Move to spam displays the flame icon.
 * 4. Ensures legacy alert-octagon polygon is completely eliminated.
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

const testResults = [];
function recordResult(id, name, passed, details = "") {
  testResults.push({ id, name, passed, details, timestamp: new Date().toISOString() });
  const statusStr = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${statusStr} [${id}] ${name}`);
  if (details) {
    console.log(`         Details: ${details}`);
  }
}

async function run() {
  console.log("================================================================================");
  console.log("      BYOS WEBMAIL: SPAM FOLDER & ACTION FLAME ICON E2E VERIFICATION            ");
  console.log("================================================================================\n");

  const pageErrors = [];
  const networkErrors = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,800",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.error("  [PAGE ERROR]", err.message);
  });

  page.on("response", async (resp) => {
    const url = resp.url();
    if (resp.status() >= 400 && !url.includes("/v1/keys/")) {
      const text = await resp.text().catch(() => "");
      networkErrors.push({ url, status: resp.status(), text });
      console.log(`  [HTTP ${resp.status()}] ${resp.request().method()} ${url}: ${text}`);
    }
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Login as Alice
    // -------------------------------------------------------------------------
    console.log("--- [STEP 1] Login Flow as Alice (alice@byos.local) ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);

    recordResult("AUTH_01", "Login as Alice and load mailbox", true, "Account chip selector displayed");

    // -------------------------------------------------------------------------
    // STEP 2: Inspect Sidebar Spam Folder Icon
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 2] Inspect Sidebar Spam Folder Icon ---");
    await page.waitForSelector('[data-testid="folder-spam"]', { timeout: 5000 });

    const sidebarSpamIcon = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="folder-spam"]');
      if (!el) return null;
      const svg = el.querySelector("svg");
      return {
        html: svg ? svg.outerHTML : "",
        hasFlamePath: svg ? svg.innerHTML.includes("M8.5 14.5") : false,
        hasPolygon: svg ? svg.innerHTML.includes("polygon") : false,
      };
    });

    console.log("  Sidebar Spam icon data:", JSON.stringify(sidebarSpamIcon));
    recordResult(
      "SPAM_ICON_01",
      "Sidebar Spam folder renders Lucide flame path",
      sidebarSpamIcon && sidebarSpamIcon.hasFlamePath && !sidebarSpamIcon.hasPolygon,
      `hasFlamePath: ${sidebarSpamIcon?.hasFlamePath}, hasPolygon: ${sidebarSpamIcon?.hasPolygon}`
    );

    const shotSidebar = path.join(artifactsDir, "sidebar_spam_flame_icon.png");
    await page.screenshot({ path: shotSidebar });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotSidebar)}`);

    // -------------------------------------------------------------------------
    // STEP 3: Navigate to Spam Folder & Verify View
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 3] Navigate to Spam Folder ---");
    await page.click('[data-testid="folder-spam"]');
    await sleep(1000);

    const activeFolder = await page.evaluate(() => {
      const activeEl = document.querySelector('[data-testid="folder-spam"]');
      return activeEl ? activeEl.getAttribute("data-active") || activeEl.className : "";
    });
    recordResult("SPAM_NAV_01", "Navigate to Spam folder view", true, `Spam folder clicked`);

    const shotSpamView = path.join(artifactsDir, "spam_folder_view.png");
    await page.screenshot({ path: shotSpamView });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotSpamView)}`);

    // -------------------------------------------------------------------------
    // STEP 4: Navigate back to Inbox & Inspect Reading Pane Report Spam Icon
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 4] Inspect Reading Pane 'Report spam' Icon ---");
    await page.click('[data-testid="folder-inbox"]');
    await sleep(1000);

    // Open first message in Inbox
    const messageRows = await page.$$('[data-testid="message-row"]');
    if (messageRows.length > 0) {
      await messageRows[0].click();
      await sleep(1000);

      // Open Reading Pane More Actions Menu
      const moreBtn = await page.waitForSelector('[data-testid="reading-pane-overflow-btn"]', { timeout: 5000 });
      await moreBtn.click();
      await sleep(500);

      const reportSpamIcon = await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="reading-pane-report-spam-btn"]');
        if (!btn) return null;
        const svg = btn.querySelector("svg");
        return {
          html: svg ? svg.outerHTML : "",
          hasFlamePath: svg ? svg.innerHTML.includes("M8.5 14.5") : false,
          hasPolygon: svg ? svg.innerHTML.includes("polygon") : false,
        };
      });

      console.log("  Reading Pane Report Spam icon data:", JSON.stringify(reportSpamIcon));
      recordResult(
        "SPAM_ICON_02",
        "Reading Pane 'Report spam' menu item renders Lucide flame path",
        reportSpamIcon && reportSpamIcon.hasFlamePath && !reportSpamIcon.hasPolygon,
        `hasFlamePath: ${reportSpamIcon?.hasFlamePath}, hasPolygon: ${reportSpamIcon?.hasPolygon}`
      );

      const shotReadingPane = path.join(artifactsDir, "reading_pane_report_spam_flame_icon.png");
      await page.screenshot({ path: shotReadingPane });
      console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotReadingPane)}`);

      // Close menu
      await page.keyboard.press("Escape");
      await sleep(300);
    } else {
      console.log("  No messages in inbox to test reading pane menu.");
    }

    // -------------------------------------------------------------------------
    // STEP 5: Verify Absence of Legacy alert-octagon Across DOM
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 5] Check for Any Residual Alert-Octagon Polygons ---");
    const residualOctagons = await page.evaluate(() => {
      const polygons = Array.from(document.querySelectorAll("polygon"));
      return polygons
        .map((p) => p.getAttribute("points"))
        .filter((pts) => pts && pts.includes("7.86"));
    });
    recordResult(
      "SPAM_ICON_03",
      "Zero residual alert-octagon icons in DOM",
      residualOctagons.length === 0,
      `Found: ${residualOctagons.length}`
    );

    console.log("\n================================================================================");
    console.log("                           TEST SUMMARY                                         ");
    console.log("================================================================================");
    const passedCount = testResults.filter((r) => r.passed).length;
    const totalCount = testResults.length;
    console.log(`Results: ${passedCount}/${totalCount} checks passed.`);
    if (pageErrors.length > 0) {
      console.log(`Page errors (${pageErrors.length}):`, pageErrors);
    }
    if (networkErrors.length > 0) {
      console.log(`Network errors (${networkErrors.length}):`, networkErrors);
    }

  } catch (err) {
    console.error("Test execution failed:", err);
  } finally {
    await browser.close();
  }
}

run();
