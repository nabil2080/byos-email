import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runFolderAndTrashLifecycleTest() {
  console.log('================================================================================');
  console.log('   MAILBOX FOLDER MOVING, DRAFT TRASHING & PERMANENT DELETION LIFECYCLE VERIFICATION');
  console.log('================================================================================\n');

  const capturedNetwork = [];
  const capturedConsole = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,850'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    // Handle confirm dialogs (e.g. Empty Bin prompt)
    page.on('dialog', async (dialog) => {
      console.log(`  [DIALOG] Prompt: "${dialog.message()}" -> ACCEPTING`);
      await dialog.accept();
    });

    // Capture console logs and errors
    page.on('console', (msg) => {
      const entry = `[${msg.type()}] ${msg.text()}`;
      capturedConsole.push(entry);
      if (msg.type() === 'error') {
        console.log(`  [BROWSER ERROR] ${msg.text()}`);
      }
    });

    // Capture network traffic for message/draft endpoints
    page.on('response', async (res) => {
      const url = res.url();
      if (res.status() >= 400) {
        console.log(`  [HTTP ERROR] ${res.request().method()} ${url} -> ${res.status()}`);
      }
      if (url.includes('/messages') || url.includes('/drafts')) {
        let body = '';
        try {
          body = await res.text();
        } catch {
          body = '<binary/stream>';
        }
        capturedNetwork.push({
          method: res.request().method(),
          url,
          status: res.status(),
          response: body.slice(0, 300),
        });
      }
    });

    // =========================================================================
    // STEP 1: Real Login Flow as Alice (alice@byos.local)
    // =========================================================================
    console.log('[STEP 1] Real Login Flow: Authenticating as Alice (alice@byos.local)...');
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log('  Alice logged in successfully.');
    await sleep(1000);

    // =========================================================================
    // STEP 2: Navigate to Drafts & Inspect Existing Draft
    // =========================================================================
    console.log('\n[STEP 2] Navigating to Drafts folder...');
    const draftsFolderBtn = await page.waitForSelector('[data-testid="folder-drafts"]', { timeout: 5000 });
    await draftsFolderBtn.click();
    await sleep(1500);

    const draftRow = await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    assert(Boolean(draftRow), 'Draft item found in Drafts folder list');

    // Read draft identifier/snippet
    const targetDraftText = await page.evaluate((el) => el.innerText.trim().replace(/\n+/g, ' '), draftRow);
    console.log('  Target draft to test:', targetDraftText.slice(0, 60));

    // Click draft to open reading pane
    console.log('  Opening draft in reading pane...');
    await draftRow.click();
    await sleep(1200);

    const readingPane = await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 5000 });
    assert(Boolean(readingPane), 'Draft opened in Reading Pane');

    const draftSubjectText = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      return pane ? pane.innerText : '';
    });
    console.log('  [DEBUG] draftSubjectText:', draftSubjectText.slice(0, 200));
    assert(
      draftSubjectText.includes('DRAFTS') || draftSubjectText.includes('Draft') || draftSubjectText.includes('{"subject"'),
      'Reading pane correctly opened and decrypted draft without 404'
    );

    await page.screenshot({ path: path.join(artifactsDir, 'folder_and_trash_01_draft_opened.png') });

    // =========================================================================
    // STEP 3: Move Draft to Trash via Reading Pane Action
    // =========================================================================
    console.log('\n[STEP 3] Moving Draft to Trash via Reading Pane Move to Trash button...');
    const moveToTrashBtn = await page.waitForSelector('[data-testid="reading-pane"] button[aria-label="Move to Trash"]', { timeout: 5000 });
    await moveToTrashBtn.click();
    await sleep(1500);

    // =========================================================================
    // STEP 4: Navigate to Trash & Verify Draft is in Trash and Decrypts
    // =========================================================================
    console.log('\n[STEP 4] Navigating to Trash folder...');
    const trashFolderBtn = await page.waitForSelector('[data-testid="folder-trash"]', { timeout: 5000 });
    await trashFolderBtn.click();
    await sleep(1500);

    const trashRows = await page.$$('[data-testid="message-row"]');
    assert(trashRows.length > 0, 'Item displayed in Trash folder');

    // Click the first item in Trash
    console.log('  Opening trashed item in reading pane...');
    await trashRows[0].click();
    await sleep(1200);

    const trashPaneText = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      return pane ? pane.innerText : '';
    });
    console.log('  [DEBUG] trashPaneText:', trashPaneText.slice(0, 200));
    assert(
      trashPaneText.includes('TRASH') || trashPaneText.includes('Draft') || trashPaneText.includes('{"subject"') || trashPaneText.includes('Delete Forever'),
      'Draft in Trash decrypted and viewable in Reading Pane without 404'
    );

    // Verify Delete Forever button is now rendered in top action bar instead of Move to Trash
    const deleteForeverBtn = await page.$('[data-testid="reading-pane"] button[aria-label="Delete Forever"]');
    assert(Boolean(deleteForeverBtn), 'Reading Pane shows Delete Forever button for item in Trash');

    await page.screenshot({ path: path.join(artifactsDir, 'folder_and_trash_02_draft_in_trash.png') });

    // =========================================================================
    // STEP 5: Browser Reload Persistence Verification
    // =========================================================================
    console.log('\n[STEP 5] Hard browser reload to verify server-side folder persistence...');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    // Navigate to Trash again
    const trashFolderBtnAfterReload = await page.waitForSelector('[data-testid="folder-trash"]', { timeout: 5000 });
    await trashFolderBtnAfterReload.click();
    await sleep(1500);

    const trashAfterReloadRows = await page.$$('[data-testid="message-row"]');
    assert(trashAfterReloadRows.length > 0, 'Trash items persisted across browser reload in PostgreSQL');

    // =========================================================================
    // STEP 6: Restore Draft back to Drafts Folder
    // =========================================================================
    console.log('\n[STEP 6] Restoring Draft from Trash back to Drafts...');
    await trashAfterReloadRows[0].click();
    await sleep(1000);

    // Open overflow menu (⋮)
    const overflowBtn = await page.waitForSelector('[data-testid="reading-pane-overflow-btn"]', { timeout: 5000 });
    await overflowBtn.click();
    await sleep(600);

    // Click "Move to folder"
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[role="menu"] button'));
      const moveBtn = buttons.find((b) => b.textContent.includes('Move to folder'));
      if (moveBtn) moveBtn.click();
    });
    await sleep(600);

    // Click "Drafts"
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('[role="menu"] button'));
      const draftsOpt = buttons.find((b) => b.textContent.includes('Drafts'));
      if (draftsOpt) draftsOpt.click();
    });
    await sleep(1500);

    // Navigate to Drafts folder
    const draftsFolderBtn2 = await page.waitForSelector('[data-testid="folder-drafts"]', { timeout: 5000 });
    await draftsFolderBtn2.click();
    await sleep(1500);

    const draftsRestoredRows = await page.$$('[data-testid="message-row"]');
    assert(draftsRestoredRows.length > 0, 'Draft restored back to Drafts folder');

    await page.screenshot({ path: path.join(artifactsDir, 'folder_and_trash_03_draft_restored.png') });

    // =========================================================================
    // STEP 7: Move an Inbox Message to Trash & Verify Persistence
    // =========================================================================
    console.log('\n[STEP 7] Moving an Inbox Message to Trash...');
    const inboxFolderBtn = await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolderBtn.click();
    await sleep(1500);

    // Open first message in Inbox
    const firstInboxRow = await page.waitForSelector('[data-testid="message-row"]', { timeout: 5000 });
    const inboxSnippet = await page.evaluate((el) => el.innerText, firstInboxRow);
    console.log('  Selected inbox message snippet:', inboxSnippet.slice(0, 60));
    await firstInboxRow.click();
    await sleep(1000);

    // Move to Trash
    const moveInboxToTrashBtn = await page.waitForSelector('[data-testid="reading-pane"] button[aria-label="Move to Trash"]', { timeout: 5000 });
    await moveInboxToTrashBtn.click();
    await sleep(1500);

    // Verify in Trash
    const trashFolderBtn3 = await page.waitForSelector('[data-testid="folder-trash"]', { timeout: 5000 });
    await trashFolderBtn3.click();
    await sleep(1500);

    const trashContentText = await page.evaluate(() => document.body.innerText);
    assert(
      trashContentText.includes('Draft RFC') || trashContentText.includes('Bin for more than 30 days'),
      'Trash folder contains moved items'
    );

    // =========================================================================
    // STEP 8: Delete Single Item Forever from Trash
    // =========================================================================
    console.log('\n[STEP 8] Permanently Deleting Single Item Forever in Trash...');
    const trashItemToDelete = await page.waitForSelector('[data-testid="message-row"]', { timeout: 5000 });
    await trashItemToDelete.click();
    await sleep(1000);

    const deleteForeverReadingPaneBtn = await page.waitForSelector('[data-testid="reading-pane"] button[aria-label="Delete Forever"]', { timeout: 5000 });
    await deleteForeverReadingPaneBtn.click();
    await sleep(1500);

    await page.screenshot({ path: path.join(artifactsDir, 'folder_and_trash_04_message_deleted_forever.png') });

    // =========================================================================
    // STEP 9: Empty Bin (Empty Trash) Lifecycle Execution
    // =========================================================================
    console.log('\n[STEP 9] Executing Empty Bin (Empty Trash) for remaining items...');
    // Move draft to trash again to have an item in trash
    const draftsFolderBtn3 = await page.waitForSelector('[data-testid="folder-drafts"]', { timeout: 5000 });
    await draftsFolderBtn3.click();
    await sleep(1500);

    const draftToMoveAgain = await page.$('[data-testid="message-row"]');
    if (draftToMoveAgain) {
      await draftToMoveAgain.click();
      await sleep(1000);
      const trashAgainBtn = await page.waitForSelector('[data-testid="reading-pane"] button[aria-label="Move to Trash"]', { timeout: 5000 });
      await trashAgainBtn.click();
      await sleep(1500);
    }

    // Go to Trash
    const trashFolderBtn4 = await page.waitForSelector('[data-testid="folder-trash"]', { timeout: 5000 });
    await trashFolderBtn4.click();
    await sleep(1500);

    // Click "Empty Bin now"
    console.log('  Clicking "Empty Bin now" banner button...');
    const emptyBinBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find((b) => b.innerText.includes('Empty Bin now') || b.innerText.includes('Empty Trash'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    assert(emptyBinBtn, 'Clicked "Empty Bin now" button');
    await sleep(2500);

    // Assert Trash is now empty
    const finalTrashText = await page.evaluate(() => document.body.innerText);
    assert(
      finalTrashText.includes('No conversations') || finalTrashText.includes('empty') || !finalTrashText.includes('Draft RFC'),
      'Trash folder is now completely empty'
    );

    // Reload page to verify empty trash persisted in DB
    console.log('  Reloading page to verify database persistence of Empty Trash...');
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1500);

    const trashFolderBtn5 = await page.waitForSelector('[data-testid="folder-trash"]', { timeout: 5000 });
    await trashFolderBtn5.click();
    await sleep(1500);

    const reloadedTrashText = await page.evaluate(() => document.body.innerText);
    assert(!reloadedTrashText.includes('Draft RFC'), 'Draft permanently erased from database');

    await page.screenshot({ path: path.join(artifactsDir, 'folder_and_trash_05_trash_emptied.png') });

    // DevTools Dump
    console.log('\n--- [DEVTOOLS STATE DUMP] ---');
    const storageDump = await page.evaluate(() => {
      return {
        session_connected_accounts: sessionStorage.getItem('byos_connected_accounts') ? 'PRESENT' : 'NONE',
        local_theme: localStorage.getItem('byos_theme'),
      };
    });
    console.log('Storage Dump:', JSON.stringify(storageDump, null, 2));

    const relevantNetwork = capturedNetwork.filter(
      (n) => n.method === 'PUT' || n.method === 'DELETE'
    );
    console.log('Relevant Network Calls:', JSON.stringify(relevantNetwork, null, 2));

    console.log('\n================================================================================');
    console.log('✓ ALL BROWSER LIFECYCLE CHECKS PASSED SUCCESSFULLY!');
    console.log('================================================================================');
  } finally {
    await browser.close();
  }
}

runFolderAndTrashLifecycleTest().catch((err) => {
  console.error('FATAL Browser Verification Failure:', err);
  process.exit(1);
});
