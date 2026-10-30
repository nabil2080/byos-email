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
  console.log("   TRACK 1: NOTES ZERO-KNOWLEDGE ENCRYPTION & QUOTA RESILIENCE VERIFICATION   ");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  try {
    console.log("\n--- [STEP 1] Login as alice@byos.local ---");
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
    console.log("  Logged into Webmail successfully.");
    await sleep(800);

    console.log("\n--- [STEP 2] Navigate to Notes Module ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(600);
    await page.waitForSelector('[data-testid="notes-view"]', { timeout: 8000 });
    console.log("  Navigated to Notes module.");

    console.log("\n--- [STEP 3] Test Selection-Aware Markdown Formatting in Composer ---");
    // Click collapsed composer to expand
    await page.click('[data-testid="notes-compose-collapsed"]');
    await sleep(300);
    await page.waitForSelector('[data-testid="notes-compose-expanded"]', { timeout: 5000 });

    // Open formatting toolbar
    await page.click('[data-testid="compose-formatting-btn"]');
    await sleep(200);
    await page.waitForSelector('[data-testid="compose-formatting-bar"]', { timeout: 5000 });
    console.log("  Formatting bar is visible.");

    // Fill title
    await page.type('[data-testid="new-note-title-input"]', "ZK Confidential Architecture");

    // Fill content
    const fullText = "Design notes for Zero-Knowledge Webmail.";
    await page.type('[data-testid="new-note-content-input"]', fullText);

    // Select 'Zero-Knowledge Webmail' using page.evaluate to set selection range
    const targetSubstring = "Zero-Knowledge Webmail";
    const startIndex = fullText.indexOf(targetSubstring);
    const endIndex = startIndex + targetSubstring.length;

    await page.evaluate((s, e) => {
      const textarea = document.querySelector('[data-testid="new-note-content-input"]');
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(s, e);
      }
    }, startIndex, endIndex);
    await sleep(100);

    // Click Bold button
    await page.click('[data-testid="compose-format-bold-btn"]');
    await sleep(200);

    // Verify textarea content formatted ONLY the selection
    const formattedContent = await page.$eval(
      '[data-testid="new-note-content-input"]',
      (el) => el.value
    );
    console.log(`  Formatted textarea value: "${formattedContent}"`);
    assert(
      formattedContent === "Design notes for **Zero-Knowledge Webmail**.",
      `Selection bold formatting matched expected output (got '${formattedContent}')`
    );

    console.log("\n--- [STEP 4] Test IndexedDB Media Resilience with Drawing ---");
    // Open three-dot menu and click Add drawing
    await page.click('[data-testid="new-note-more-menu-btn"]');
    await sleep(200);
    await page.waitForSelector('[data-testid="compose-more-menu-popover"]', { timeout: 5000 });
    await page.click('[data-testid="menu-add-drawing-btn"]');
    await sleep(300);

    await page.waitForSelector('[data-testid="drawing-modal"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="drawing-canvas"]', { timeout: 5000 });

    // Draw a stroke
    const canvas = await page.$('[data-testid="drawing-canvas"]');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 40, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 70);
    await page.mouse.move(box.x + 200, box.y + 110);
    await page.mouse.up();
    await sleep(200);

    // Save drawing
    await page.click('[data-testid="save-drawing-btn"]');
    await sleep(300);

    // Verify drawing thumbnail present in composer
    const hasDrawingThumbnail = await page.$('[data-testid="notes-compose-expanded"] img[alt="Drawing"]');
    assert(hasDrawingThumbnail !== null, "Drawing thumbnail displayed in composer");

    // Save note
    await page.click('[data-testid="new-note-save-btn"]');
    await sleep(600);

    console.log("\n--- [STEP 5] Verify Zero-Knowledge AES-GCM Encryption in localStorage ---");
    const storageAudit = await page.evaluate(() => {
      let notesKey = "";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("byos_notes_")) {
          notesKey = k;
          break;
        }
      }
      const rawJson = notesKey ? localStorage.getItem(notesKey) : null;
      let targetNote = null;
      if (rawJson) {
        const parsed = JSON.parse(rawJson);
        targetNote = parsed.find((n) => n.encryptedPayload);
      }
      return {
        notesKey,
        rawJson,
        targetNote,
      };
    });

    console.log(`  Storage key found: ${storageAudit.notesKey}`);
    assert(storageAudit.targetNote !== null, "Encrypted note record exists in localStorage");
    assert(typeof storageAudit.targetNote.encryptedPayload === "string", "Note has non-empty encryptedPayload hex string");
    assert(storageAudit.targetNote.encryptedPayload.length > 50, "encryptedPayload has sufficient ciphertext length");

    // Plaintext redaction assertions
    assert(storageAudit.targetNote.title === "", "Raw stored note title is completely redacted to empty string");
    assert(storageAudit.targetNote.content === "", "Raw stored note content is completely redacted to empty string");
    assert(
      !storageAudit.rawJson.includes("ZK Confidential Architecture"),
      "Plaintext title 'ZK Confidential Architecture' NEVER leaked to localStorage JSON"
    );
    assert(
      !storageAudit.rawJson.includes("Design notes for **Zero-Knowledge Webmail**."),
      "Plaintext content NEVER leaked to localStorage JSON"
    );

    // Drawing offloaded assertion
    const rawDrawingRef = storageAudit.targetNote.drawings?.[0];
    console.log(`  Stored drawing ref in localStorage: ${rawDrawingRef}`);
    assert(
      rawDrawingRef && rawDrawingRef.startsWith("idb:drawing_"),
      `Drawing is stored as IndexedDB pointer '${rawDrawingRef}', NOT as raw base64 data`
    );
    assert(
      !storageAudit.rawJson.includes("data:image/png;base64"),
      "Raw base64 data URL does NOT leak into localStorage, preventing QuotaExceededError"
    );

    console.log("\n--- [STEP 6] Verify IndexedDB Media Persistence ---");
    const idbValue = await page.evaluate(async (pointer) => {
      return new Promise((resolve) => {
        const req = indexedDB.open("byos_notes_media_db", 1);
        req.onerror = () => resolve(null);
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction("media", "readonly");
          const store = tx.objectStore("media");
          const getReq = store.get(pointer);
          getReq.onsuccess = (ev) => {
            resolve(ev.target.result ? ev.target.result.dataUrl : null);
          };
          getReq.onerror = () => resolve(null);
        };
      });
    }, rawDrawingRef);

    assert(
      idbValue !== null && idbValue.startsWith("data:image/png;base64,"),
      "Drawing dataUrl retrieved successfully from IndexedDB byos_notes_media_db"
    );

    console.log("\n--- [STEP 7] Verify Seamless Decryption in UI ---");
    // Verify the decrypted title is visible on the rendered card
    const cardTitle = await page.evaluate(() => {
      const titles = Array.from(document.querySelectorAll('[data-testid="notes-view"] h4'));
      return titles.map((t) => t.textContent?.trim()).find((t) => t === "ZK Confidential Architecture");
    });
    assert(
      cardTitle === "ZK Confidential Architecture",
      "Decrypted note title is seamlessly rendered in NotesView grid"
    );

    await page.screenshot({ path: path.join(artifactsDir, "notes_zk_encrypted_card.png") });
    console.log("  Saved screenshot: notes_zk_encrypted_card.png");

    console.log("\n--- [STEP 8] Test Edit Note Modal Parity (Reminders & Checklist Toggle) ---");
    // Find and click the note card to open edit modal
    const noteCard = await page.evaluateHandle(() => {
      const titles = Array.from(document.querySelectorAll('[data-testid="notes-view"] h4'));
      const el = titles.find((t) => t.textContent?.trim() === "ZK Confidential Architecture");
      return el ? el.closest('[data-testid^="note-card-"]') : null;
    });

    if (noteCard) {
      await noteCard.click();
      await sleep(400);

      await page.waitForSelector('[data-testid="edit-note-modal"]', { timeout: 5000 });
      console.log("  Edit note modal opened.");

      // Test Reminder picker in edit modal
      await page.click('[data-testid="edit-note-reminder-btn"]');
      await sleep(200);
      await page.waitForSelector('[data-testid="edit-note-reminder-popover"]', { timeout: 5000 });
      await page.click('[data-testid="edit-reminder-later-today-btn"]');
      await sleep(200);

      // Verify reminder chip is visible
      const reminderChip = await page.$('[data-testid="edit-note-reminder-preview"]');
      assert(reminderChip !== null, "Reminder chip successfully added and displayed in edit note modal");

      // Test Checklist toggle in edit modal
      await page.click('[data-testid="edit-note-toggle-checklist-btn"]');
      await sleep(300);

      // Verify checklist items appear in edit modal
      const checklistItems = await page.$$('[data-testid="edit-note-checklist-item"]');
      console.log(`  Checklist items count in edit modal: ${checklistItems.length}`);
      assert(checklistItems.length > 0, "Checklist mode toggled and items rendered in edit modal");

      await page.screenshot({ path: path.join(artifactsDir, "notes_edit_modal_reminder_checklist.png") });
      console.log("  Saved screenshot: notes_edit_modal_reminder_checklist.png");

      // Close edit modal
      await page.click('[data-testid="edit-note-save-btn"]');
      await sleep(500);
      console.log("  Edit note modal saved and closed.");
    }

    // Check page errors
    const fatalErrors = pageErrors.filter((e) => !e.includes("Failed to load resource"));
    assert(fatalErrors.length === 0, `Zero fatal uncaught page errors (got ${fatalErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL TRACK 1 ZK ENCRYPTION & RESILIENCE AUDITS PASSED SUCCESSFULLY!          ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test run failed:", err);
  process.exit(1);
});
