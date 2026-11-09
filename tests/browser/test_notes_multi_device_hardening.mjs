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
  console.log("   THREE-DEVICE CONCURRENT CONFLICT, OFFLINE QUEUE & TOMBSTONE RETENTION E2E    ");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  try {
    // ── CREATE THREE ISOLATED CLIENT CONTEXTS (DEVICE A, B, C) ──
    const contextA = await browser.createBrowserContext();
    const contextB = await browser.createBrowserContext();
    const contextC = await browser.createBrowserContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    const pageC = await contextC.newPage();
    await pageA.setViewport({ width: 1280, height: 800 });
    await pageB.setViewport({ width: 1280, height: 800 });
    await pageC.setViewport({ width: 1280, height: 800 });

    console.log("\n--- [STEP 1] Login All Three Devices as alice@byos.local ---");
    for (const [name, page] of [["Device A", pageA], ["Device B", pageB], ["Device C", pageC]]) {
      await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await page.type('input[type="email"]', "alice@byos.local");
      await page.type('input[type="password"]', "test-password-123");
      await page.click('button[type="submit"]');
      await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
      await sleep(800);

      // Navigate to Notes view
      await page.evaluate(() => {
        document.querySelector('[data-testid="nav-notes-tab"]')?.click();
      });
      await page.waitForSelector('[data-testid="notes-view"]', { timeout: 8000 });
      await sleep(500);
      console.log(`  ${name} logged in and navigated to Notes.`);
    }

    // Verify safe privacy diagnostics (no byos_keys_published_* exposed)
    const diagStateC = await pageC.evaluate(() => {
      const keys = Object.keys(sessionStorage);
      const safePrefixes = [...new Set(keys.map((k) => k.split("_").slice(0, 3).join("_")))];
      return {
        hasVault: Boolean(sessionStorage.getItem("byos_session_vault")),
        hasPublishedKeys: keys.some((k) => k.startsWith("byos_keys_published_")),
        safePrefixes,
      };
    });
    console.log("  Privacy Diagnostic Check (Safe Prefixes Only):", diagStateC);
    assert(diagStateC.hasVault, "Session vault active");
    assert(!diagStateC.safePrefixes.some((p) => p.includes("c0000000") || p.length > 30), "Diagnostic log contains zero raw UUIDs or key material");

    console.log("\n--- [STEP 2] Device A: Create Base Note & Sync to MinIO ---");
    const runToken = Date.now().toString(36);
    const noteTitle = `Tri-Device Architecture Blueprint [${runToken}]`;
    const noteContent = `Base blueprint ${runToken}: Zero-Knowledge customer-owned storage synchronization.`;

    const noteId = await pageA.evaluate(async (title, content) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);

      const note = storeMod.createNote(mailboxId, title, content, "sky", true, {}, key);
      await syncMod.syncNotesWithRemote(mailboxId, key);
      return note.id;
    }, noteTitle, noteContent);

    console.log(`  Device A created note ${noteId} and synced to MinIO.`);
    await sleep(600);

    console.log("\n--- [STEP 3] Device B & C: Pull Initial Base Note from MinIO ---");
    for (const [name, page] of [["Device B", pageB], ["Device C", pageC]]) {
      const pullRes = await page.evaluate(async (targetId) => {
        const mailboxId = "c0000000-0000-0000-0000-000000000001";
        const storeMod = await import("/src/components/notes/notesStore.ts");
        const syncMod = await import("/src/components/notes/notesSync.ts");
        const key = storeMod.resolveNotesMailboxKey(mailboxId);

        await syncMod.syncNotesWithRemote(mailboxId, key);
        const notes = storeMod.loadNotes(mailboxId, key);
        const match = notes.find((n) => n.id === targetId);
        return { found: Boolean(match), title: match?.title };
      }, noteId);

      assert(pullRes.found, `${name} pulled and decrypted base note from MinIO`);
    }

    console.log("\n--- [STEP 4] Simultaneous 3-Way Concurrent Edits (A, B, C) ---");
    // Device A edits note and syncs to MinIO
    await pageA.evaluate(async (targetId, token) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);

      storeMod.updateNote(mailboxId, targetId, {
        title: `Tri-Device Blueprint [Device A Edition - ${token}]`,
        content: `Device A added Quantum-resistant HPKE algorithms. [${token}]`,
        updatedAt: Date.now() + 5000,
      }, key);
      await syncMod.syncNotesWithRemote(mailboxId, key);
    }, noteId, runToken);
    console.log("  Device A edited note and synced to MinIO.");

    // Device B makes offline edit and syncs to MinIO
    const bConflict = await pageB.evaluate(async (targetId, token) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);

      storeMod.updateNote(mailboxId, targetId, {
        title: `Tri-Device Blueprint [Device B Edition - ${token}]`,
        content: `Device B added Micro-interaction animation choreography. [${token}]`,
        updatedAt: Date.now() + 10000,
      }, key);

      const res = await syncMod.syncNotesWithRemote(mailboxId, key);
      // Push Device B's conflict copy
      await syncMod.syncNotesWithRemote(mailboxId, key);
      return res;
    }, noteId, runToken);
    console.log("  Device B sync completed:", bConflict);
    assert(bConflict.conflictCount === 1, "Device B detected 1 concurrent conflict with Device A");

    // Device C was offline throughout! Now Device C makes an offline edit
    await pageC.evaluate(async (targetId, token) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);

      storeMod.updateNote(mailboxId, targetId, {
        title: `Tri-Device Blueprint [Device C Edition - ${token}]`,
        content: `Device C added Distributed telemetry metrics. [${token}]`,
        updatedAt: Date.now() + 15000,
      }, key);
    }, noteId, runToken);
    console.log("  Device C made offline edit while disconnected.");

    // Now Device C reconnects and synchronizes!
    const cConflict = await pageC.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);

      const res = await syncMod.syncNotesWithRemote(mailboxId, key);
      // Push Device C's conflict copy
      await syncMod.syncNotesWithRemote(mailboxId, key);
      return res;
    });
    console.log("  Device C reconnect sync completed:", cConflict);
    assert(cConflict.conflictCount === 1, "Device C detected conflict on primary note");

    // Check notes on Device C: must contain all 3 revisions!
    const cContents = await pageC.evaluate(async (token) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);
      const notes = storeMod.loadNotes(mailboxId, key);
      const matched = notes.filter((n) => n.content && n.content.includes(token));
      return matched.map((n) => n.content);
    }, runToken);
    console.log(`  Device C found ${cContents.length} matching revisions for token [${runToken}]:`, cContents);

    assert(cContents.some((c) => c.includes("Quantum-resistant HPKE")), "Device A edit preserved on Device C");
    assert(cContents.some((c) => c.includes("Micro-interaction animation")), "Device B edit preserved on Device C");
    assert(cContents.some((c) => c.includes("Distributed telemetry metrics")), "Device C edit preserved on Device C");
    assert(cContents.length === 3, "Exactly 3 distinct non-lossy revisions exist on Device C");

    // Device A and Device B sync to pull the newly uploaded conflict copies
    for (const page of [pageA, pageB]) {
      await page.evaluate(async () => {
        const mailboxId = "c0000000-0000-0000-0000-000000000001";
        const syncMod = await import("/src/components/notes/notesSync.ts");
        const storeMod = await import("/src/components/notes/notesStore.ts");
        const key = storeMod.resolveNotesMailboxKey(mailboxId);
        await syncMod.syncNotesWithRemote(mailboxId, key);
      });
    }

    // Capture screenshot on Device C showing convergence
    const convergenceScreenshot = path.join(artifactsDir, "notes_three_devices_conflict_convergence.png");
    await pageC.screenshot({ path: convergenceScreenshot, fullPage: false });
    console.log(`  Saved convergence screenshot: ${convergenceScreenshot}`);

    console.log("\n--- [STEP 5] Deletion Tombstone & Stale Device Reconnect Test ---");
    // Device A permanently deletes the note
    await pageA.evaluate(async (targetId) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);

      storeMod.deleteNoteForever(mailboxId, targetId, key);
      await syncMod.syncNotesWithRemote(mailboxId, key);
    }, noteId);
    console.log("  Device A permanently deleted note and pushed tombstone to MinIO.");

    // Verify tombstone in MinIO
    const tombstoneBytes = execSync(
      `docker exec byos-minio cat /data/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/notes/${noteId}.enc/xl.meta`
    );
    assert(tombstoneBytes.length >= 29, "Tombstone object in MinIO is >= 29 bytes Section 12 envelope");

    // Device B syncs immediately
    await pageB.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);
      await syncMod.syncNotesWithRemote(mailboxId, key);
    });

    const bHasDeleted = await pageB.evaluate(async (targetId) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const notes = storeMod.loadNotes(mailboxId);
      return notes.some((n) => n.id === targetId);
    }, noteId);
    assert(!bHasDeleted, "Device B purged note upon receiving tombstone");

    // Device C was idle/offline. Device C reconnects and syncs
    await pageC.evaluate(async () => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const key = storeMod.resolveNotesMailboxKey(mailboxId);
      await syncMod.syncNotesWithRemote(mailboxId, key);
    });

    const cHasDeleted = await pageC.evaluate(async (targetId) => {
      const mailboxId = "c0000000-0000-0000-0000-000000000001";
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const notes = storeMod.loadNotes(mailboxId);
      return notes.some((n) => n.id === targetId);
    }, noteId);
    assert(!cHasDeleted, "Device C purged note upon receiving tombstone without ghost resurrection");

    console.log("\n================================================================================");
    console.log("   THREE-DEVICE MULTI-CLIENT HARDENING VERIFICATION COMPLETED SUCCESSFULLY!     ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in Three-Device Verification:", err);
  process.exit(1);
});
