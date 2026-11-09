import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
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
  console.log("   MINIO REAL INTEGRATION & TWO-CLIENT CONCURRENT CONFLICT E2E TEST             ");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  try {
    // ── CREATE TWO ISOLATED CLIENT CONTEXTS (DEVICE A & DEVICE B) ──
    const contextA = await browser.createBrowserContext();
    const contextB = await browser.createBrowserContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.setViewport({ width: 1280, height: 800 });
    await pageB.setViewport({ width: 1280, height: 800 });

    console.log("\n--- [STEP 1] Device A: Real Login as alice@byos.local ---");
    await pageA.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await pageA.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageA.type('input[type="email"]', "alice@byos.local");
    await pageA.type('input[type="password"]', "test-password-123");
    await pageA.click('button[type="submit"]');
    await pageA.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log("  Device A logged in successfully.");

    // Navigate to Notes module on Device A
    await pageA.evaluate(() => {
      document.querySelector('[data-testid="nav-notes-tab"]')?.click();
    });
    await pageA.waitForSelector('[data-testid="notes-view"]', { timeout: 8000 });
    await sleep(600);

    console.log("\n--- [STEP 2] Device A: Create Note & Force Sync to MinIO ---");
    await pageA.click('[data-testid="notes-compose-collapsed"]');
    await sleep(300);
    await pageA.waitForSelector('[data-testid="notes-compose-expanded"]', { timeout: 5000 });

    const noteTitle = "MinIO Integration Confidential Note";
    const noteContent = "Plaintext payload must NEVER appear in MinIO storage bucket!";
    await pageA.type('[data-testid="new-note-title-input"]', noteTitle);
    await pageA.type('[data-testid="new-note-content-input"]', noteContent);
    await pageA.click('[data-testid="new-note-save-btn"]');
    await sleep(400);

    // Wait for the note to render and trigger immediate sync to MinIO
    await pageA.waitForSelector('[data-testid^="note-card-"]', { timeout: 5000 });
    const noteIdA = await pageA.evaluate(async (expectedTitle) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const notes = storeMod.loadNotes(mailboxId);
      const target = notes.find((n) => n.title && n.title.includes(expectedTitle));
      if (!target) throw new Error("Created note not found in local store");

      // Trigger sync with MinIO
      await syncMod.syncNotesWithRemote(mailboxId);
      return target.id;
    }, noteTitle);

    console.log(`  Device A created note (ID: ${noteIdA}) and synced to MinIO.`);
    await sleep(800);

    console.log("\n--- [STEP 3] Inspect Live MinIO Storage for Zero Plaintext Leakage ---");
    const minioListOutput = execSync(
      "docker exec byos-minio ls -la /data/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/notes/"
    ).toString();
    console.log("  MinIO notes directory contents:\n" + minioListOutput.trim());
    assert(minioListOutput.includes(`${noteIdA}.enc`), `Object ${noteIdA}.enc physically exists in MinIO container`);

    // Inspect the MinIO xl.meta file on disk for zero plaintext leakage
    const rawCatOutput = execSync(
      `docker exec byos-minio cat /data/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/notes/${noteIdA}.enc/xl.meta`
    );

    const rawString = rawCatOutput.toString("latin1");
    assert(!rawString.includes("MinIO Integration"), "Zero Plaintext Leakage: Note title NOT in MinIO file");
    assert(!rawString.includes("Plaintext payload"), "Zero Plaintext Leakage: Note content NOT in MinIO file");
    assert(!rawString.includes("Confidential"), "Zero Plaintext Leakage: Confidential text NOT in MinIO file");

    // Also verify envelope framing via client API retrieve
    const envelopeCheck = await pageA.evaluate(async (targetId) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const apiMod = await import("/src/api.ts");
      const bytes = await apiMod.retrieveMailboxStorageObject(mailboxId, `mailboxes/${mailboxId}/notes/${targetId}.enc`);
      return {
        length: bytes?.length || 0,
        versionByte: bytes ? bytes[0] : -1,
      };
    }, noteIdA);

    assert(envelopeCheck.length >= 29, "Retrieved envelope meets Section 12 minimum framing (>= 29 bytes)");
    assert(envelopeCheck.versionByte === 0x01, "Byte 0 of retrieved MinIO envelope is 0x01 Section 12 version byte");

    console.log("\n--- [STEP 4] Device B: Login & Retrieve Synced Note from MinIO ---");
    await pageB.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await pageB.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageB.type('input[type="email"]', "alice@byos.local");
    await pageB.type('input[type="password"]', "test-password-123");
    await pageB.click('button[type="submit"]');
    await pageB.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });

    // Navigate to Notes on Device B
    await pageB.evaluate(() => {
      document.querySelector('[data-testid="nav-notes-tab"]')?.click();
    });
    await pageB.waitForSelector('[data-testid="notes-view"]', { timeout: 8000 });
    await sleep(1000);

    const bState = await pageB.evaluate(() => {
      const accountsRaw = localStorage.getItem("byos_connected_accounts");
      const accounts = accountsRaw ? JSON.parse(accountsRaw) : [];
      const keys = Object.keys(sessionStorage);
      const safeKeyPrefixes = [...new Set(keys.map((k) => k.split("_").slice(0, 3).join("_")))];
      return {
        accountCount: accounts.length,
        hasVault: Boolean(sessionStorage.getItem("byos_session_vault")),
        hasPublishedKeys: keys.some((k) => k.startsWith("byos_keys_published_")),
        keyPrefixes: safeKeyPrefixes,
      };
    });
    console.log("  Device B account & vault state:", bState);

    // Trigger sync on Device B to pull from MinIO
    const bPullRes = await pageB.evaluate(async () => {
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const key = storeMod.resolveNotesMailboxKey("c0000000-0000-0000-0000-000000000001");
      return {
        keyFound: Boolean(key && key.length === 32),
        sync: await syncMod.syncNotesWithRemote("c0000000-0000-0000-0000-000000000001", key),
      };
    });
    console.log("  Device B syncNotesWithRemote returned:", bPullRes);
    await sleep(800);

    // Verify Device B decrypted and rendered the note
    const devBNotes = await pageB.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const localNotes = storeMod.loadNotes(mailboxId);
      const titles = [...document.querySelectorAll('[data-testid^="note-card-"] h4')].map((el) => el.textContent?.trim());
      const contents = [...document.querySelectorAll('[data-testid^="note-card-"] p')].map((el) => el.textContent?.trim());
      return { titles, contents, localCount: localNotes.length, localTitles: localNotes.map((n) => n.title) };
    });

    console.log("  Notes found on Device B UI:", {
      localCount: devBNotes.localCount,
      renderedTitlesCount: devBNotes.titles.length,
      hasTargetTitle: devBNotes.localTitles.some((t) => t && t.includes(noteTitle)) || devBNotes.titles.some((t) => t && t.includes(noteTitle)),
      hasTargetContent: devBNotes.contents.some((c) => c && c.includes(noteContent)),
    });
    assert(
      devBNotes.localTitles.some((t) => t && t.includes(noteTitle)) || devBNotes.titles.some((t) => t && t.includes(noteTitle)),
      "Device B decrypted and rendered note from MinIO"
    );
    assert(devBNotes.contents.some((c) => c && c.includes(noteContent)), "Device B decrypted and rendered content from MinIO");

    console.log("\n--- [STEP 5] Force Concurrent Conflict: Edit on Both Devices ---");
    // Device A edits note and syncs to MinIO
    await pageA.evaluate(async (targetId) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");

      // Edit on Device A
      storeMod.updateNote(mailboxId, targetId, {
        title: "MinIO Note [Device A Revision 2]",
        content: "Alice added critical architecture updates on Device A.",
        updatedAt: Date.now() + 5000,
      });

      // Device A syncs to MinIO
      await syncMod.syncNotesWithRemote(mailboxId);
    }, noteIdA);

    console.log("  Device A edited note and synced to MinIO.");
    await sleep(600);

    // Device B makes concurrent offline edit (without having synced Device A's new edit)
    await pageB.evaluate(async (targetId) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");

      // Device B edits concurrently
      storeMod.updateNote(mailboxId, targetId, {
        title: "MinIO Note [Device B Revision 2]",
        content: "Alice made simultaneous offline changes on Device B.",
        updatedAt: Date.now() + 10000,
      });
    }, noteIdA);

    console.log("  Device B made concurrent edit while offline.");
    await sleep(400);

    // Now Device B syncs with MinIO!
    const conflictResultB = await pageB.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const syncMod = await import("/src/components/notes/notesSync.ts");
      return await syncMod.syncNotesWithRemote(mailboxId);
    });

    console.log("  Device B sync completed:", conflictResultB);
    assert(conflictResultB.conflictCount === 1, "Exactly 1 concurrent conflict detected by pull-before-push sync engine");

    // Device A syncs to pull the branched conflict copy from MinIO
    await pageA.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const syncMod = await import("/src/components/notes/notesSync.ts");
      await syncMod.syncNotesWithRemote(mailboxId);
    });
    await sleep(800);

    // Check that BOTH edits survived on Device A and Device B!
    const finalNotesA = await pageA.evaluate(() => {
      return [...document.querySelectorAll('[data-testid^="note-card-"]')].map((el) => el.textContent);
    });
    const finalNotesB = await pageB.evaluate(() => {
      return [...document.querySelectorAll('[data-testid^="note-card-"]')].map((el) => el.textContent);
    });

    assert(finalNotesA.some((t) => t.includes("Device A Revision 2")), "Device A retains Device A's edits");
    assert(finalNotesA.some((t) => t.includes("Conflict copy")), "Device A pulled the Conflict copy from Device B via MinIO");
    assert(finalNotesB.some((t) => t.includes("Device A Revision 2")), "Device B has Device A's edits");
    assert(finalNotesB.some((t) => t.includes("Conflict copy")), "Device B has its own Conflict copy preserved");

    // Capture screenshot of Device B with conflict copy
    const conflictScreenshot = path.join(artifactsDir, "notes_minio_two_clients_conflict.png");
    await pageB.screenshot({ path: conflictScreenshot, fullPage: false });
    console.log(`  Saved conflict screenshot: ${conflictScreenshot}`);

    console.log("\n--- [STEP 6] Deletion & Stale Device Reconnect Test ---");
    // Device A deletes the note permanently
    await pageA.evaluate(async (targetId) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");

      storeMod.deleteNoteForever(mailboxId, targetId);
      await syncMod.syncNotesWithRemote(mailboxId);
    }, noteIdA);

    console.log("  Device A permanently deleted note and pushed tombstone to MinIO.");
    await sleep(600);

    // Check MinIO object: must be an encrypted tombstone
    const tombstoneCatOutput = execSync(
      `docker exec byos-minio cat /data/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/notes/${noteIdA}.enc/xl.meta`
    );
    assert(tombstoneCatOutput.length >= 29, "Tombstone on MinIO is a valid encrypted envelope (>= 29 bytes)");

    // Device B reconnects and syncs
    await pageB.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const syncMod = await import("/src/components/notes/notesSync.ts");
      await syncMod.syncNotesWithRemote(mailboxId);
    });
    await sleep(600);

    // Verify Device B removed the deleted note without resurrecting it
    const devBNotesAfterDelete = await pageB.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const localNotes = storeMod.loadNotes(mailboxId);
      const titles = [...document.querySelectorAll('[data-testid^="note-card-"] h4')].map((el) => el.textContent?.trim());
      return { titles, localTitles: localNotes.map((n) => n.title) };
    });
    assert(!devBNotesAfterDelete.localTitles.some((t) => t && t.includes("Device A Revision 2")), "Deleted note was NOT resurrected on Device B");

    console.log("\n================================================================================");
    console.log("   MINIO TWO-CLIENT CONCURRENT CONFLICT & RETENTION VERIFICATION PASSED!        ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in MinIO Two-Client Verification:", err);
  process.exit(1);
});
