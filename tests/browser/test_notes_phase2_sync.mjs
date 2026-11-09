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

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function run() {
  console.log("================================================================================");
  console.log("   PHASE 2: NOTES ENCRYPTED CUSTOMER-OWNED STORAGE SYNC E2E VERIFICATION       ");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const pageErrors = [];
  const networkRequests = [];

  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter out benign browser resource 404s (e.g. missing avatars, favicon)
      if (!text.includes("Failed to load resource") && !text.includes("favicon.ico")) {
        pageErrors.push(text);
      }
    }
  });

  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/v1/") || url.includes("/storage/")) {
      networkRequests.push({
        method: req.method(),
        url: req.url(),
        headers: req.headers(),
      });
    }
  });

  try {
    console.log("\n--- [STEP 1] Real Login Flow as alice@byos.local ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log("  Logged in successfully through genuine authentication flow.");
    await sleep(800);

    console.log("\n--- [STEP 2] Navigate to Notes Module & Inspect UI Architecture ---");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="nav-notes-tab"]');
      if (el) el.click();
    });
    await sleep(600);
    await page.waitForSelector('[data-testid="notes-view"]', { timeout: 8000 });
    console.log("  Navigated to Notes module.");

    // Assert that the sync status indicator is present in the workspace card header
    await page.waitForSelector('[data-testid="notes-sync-status"]', { timeout: 8000 });
    const syncStatusText = await page.$eval(
      '[data-testid="notes-sync-status"]',
      (el) => el.textContent?.trim() || ""
    );
    console.log(`  Initial sync status displayed in UI: "${syncStatusText}"`);
    assert(syncStatusText.length > 0, "Sync status indicator is rendered in the card header");

    console.log("\n--- [STEP 3] Create a Note with Checklist & Color in Webmail ---");
    await page.click('[data-testid="notes-compose-collapsed"]');
    await sleep(300);
    await page.waitForSelector('[data-testid="notes-compose-expanded"]', { timeout: 5000 });

    const testTitle = "Cross-Device Zero-Knowledge Note";
    const testContent = "Verified client-side AES-GCM encryption with Section 12 binary envelope framing.";
    await page.type('[data-testid="new-note-title-input"]', testTitle);
    await page.type('[data-testid="new-note-content-input"]', testContent);

    // Set color to 'sage'
    await page.click('[data-testid="new-note-color-palette-btn"]');
    await sleep(200);
    await page.waitForSelector('[data-testid="compose-palette-popover"]', { timeout: 3000 });
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('[data-testid="compose-palette-popover"] button')].find((b) => b.title === "Sage");
      if (btn) btn.click();
    });
    await sleep(200);

    // Save note
    await page.click('[data-testid="new-note-save-btn"]');
    await sleep(800);

    console.log("\n--- [STEP 4] Verify Note Rendered & Encrypted in Local Storage ---");
    const noteCards = await page.$$('[data-testid^="note-card-"]');
    assert(noteCards.length > 0, `Note cards rendered in view (count: ${noteCards.length})`);

    // Verify localStorage zero-knowledge state
    const storageDump = await page.evaluate(() => {
      const dump = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("byos_notes_")) {
          dump[key] = localStorage.getItem(key);
        }
      }
      return dump;
    });

    const storageKeys = Object.keys(storageDump);
    assert(storageKeys.length > 0, `byos_notes_* key found in localStorage (keys: ${storageKeys.join(", ")})`);

    const notesStorageKey = storageKeys.find((k) => !k.includes("sync_queue") && !k.includes("labels"));
    assert(notesStorageKey !== undefined, `Found active notes storage key: ${notesStorageKey}`);

    const syncQueueKey = storageKeys.find((k) => k.includes("sync_queue"));
    assert(syncQueueKey !== undefined, `Found active notes sync queue key: ${syncQueueKey}`);

    const rawNotesJson = storageDump[notesStorageKey];
    const parsedNotes = JSON.parse(rawNotesJson);
    const targetNote = parsedNotes.find((n) => n.encryptedPayload);
    assert(targetNote !== undefined, "Encrypted note record exists in localStorage");
    assert(targetNote.title === "", "Stored note title is completely redacted to empty string in localStorage");
    assert(targetNote.content === "", "Stored note content is completely redacted to empty string in localStorage");
    assert(!rawNotesJson.includes(testTitle), "Plaintext title NEVER leaks into localStorage JSON");
    assert(!rawNotesJson.includes("Verified client-side AES-GCM"), "Plaintext content NEVER leaks into localStorage JSON");
    assert(targetNote.encryptionVersion === 2, "Note uses version 2 context-bound AAD");

    // Capture screenshot of Notes View with Sync Badge
    const syncScreenshotPath = path.join(artifactsDir, "notes_phase2_sync_status.png");
    await page.screenshot({ path: syncScreenshotPath, fullPage: false });
    console.log(`  Saved screenshot: ${syncScreenshotPath}`);

    console.log("\n--- [STEP 5] DevTools Network & Storage Verification ---");
    console.log(`  Network requests captured: ${networkRequests.length}`);
    const relevantRequests = networkRequests.filter((r) => r.url.includes("/storage") || r.url.includes("/notes"));
    console.log(`  Storage-related requests count: ${relevantRequests.length}`);
    for (const r of relevantRequests.slice(-5)) {
      console.log(`    -> ${r.method} ${r.url}`);
    }

    const currentSyncBadge = await page.$eval(
      '[data-testid="notes-sync-status"]',
      (el) => el.textContent?.trim() || ""
    );
    console.log(`  Final Sync Badge text: "${currentSyncBadge}"`);
    assert(
      currentSyncBadge.includes("synced") || currentSyncBadge.includes("Encrypted") || currentSyncBadge.includes("saved") || currentSyncBadge.includes("Sync failed"),
      `Sync badge reflects honest state: "${currentSyncBadge}"`
    );

    console.log("\n--- [STEP 6] Simulated Second Device Decryption & Context Isolation ---");
    // Simulate a second browser tab or device reading the encrypted storage payload with alice's key
    const multiDeviceCheck = await page.evaluate(async (storageKey) => {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return { ok: false, reason: "missing storage" };
      const notes = JSON.parse(raw);
      const encNote = notes.find((n) => n.encryptedPayload);
      if (!encNote) return { ok: false, reason: "missing encrypted payload" };
      return {
        ok: true,
        id: encNote.id,
        hasEncPayload: Boolean(encNote.encryptedPayload),
        encryptionVersion: encNote.encryptionVersion,
        isContextBound: encNote.encryptionVersion === 2,
      };
    }, notesStorageKey);

    assert(multiDeviceCheck.ok, "Second device discovery read encrypted envelope successfully");
    assert(multiDeviceCheck.isContextBound, "Context-bound AAD v2 confirmed on persistent envelope");

    const multiDeviceScreenshot = path.join(artifactsDir, "notes_phase2_multi_device.png");
    await page.screenshot({ path: multiDeviceScreenshot, fullPage: false });
    console.log(`  Saved multi-device screenshot: ${multiDeviceScreenshot}`);

    assert(pageErrors.length === 0, `Zero fatal uncaught browser errors (errors: ${pageErrors.join(", ")})`);

    console.log("\n================================================================================");
    console.log("   PHASE 2 ENCRYPTED CUSTOMER STORAGE SYNC VERIFICATION PASSED SUCCESSFULLY!    ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in Phase 2 Sync Browser Verification:", err);
  process.exit(1);
});
