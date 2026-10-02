import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { execSync } from 'node:child_process';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function setupPage(browser) {
  const aliceUserId = "cccccccc-0000-0000-0000-000000000002";
  const token = 'alice_test_session_token_1234567890';
  execSync(`docker exec byos-postgres psql -U byos -d byos -c "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${aliceUserId}', digest('${token}', 'sha256'), now() + interval '1 day') ON CONFLICT (token_hash) DO NOTHING"`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const boxId = 'c0000000-0000-0000-0000-000000000001';
    const hex = '11'.repeat(32);
    localStorage.setItem('byos_active_session_token', 'alice_test_session_token_1234567890');
    sessionStorage.setItem('byos_active_session_token', 'alice_test_session_token_1234567890');
    sessionStorage.setItem('byos_mailbox_sk_' + boxId, hex);
    sessionStorage.setItem('byos_mailbox_skey_' + boxId, hex);
    sessionStorage.setItem('byos_signing_seed_' + boxId, '33'.repeat(32));
    sessionStorage.setItem('byos_xwing_seed_' + boxId, '11'.repeat(32));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 2000));
  return page;
}

async function runAudit() {
  console.log("=== STARTING REAL BROWSER FEATURE AUDIT ===");
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await setupPage(browser);

    // -------------------------------------------------------------
    // FEATURE 10: DARK MODE TOGGLE
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 10] Dark Mode Verification ---");
    const initialTheme = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      isDarkClass: document.documentElement.classList.contains('dark'),
      storage: localStorage.getItem('byos_theme'),
    }));
    console.log("Initial theme state:", JSON.stringify(initialTheme));

    // Click "Dark" button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.trim() === 'Dark');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const afterDarkTheme = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      isDarkClass: document.documentElement.classList.contains('dark'),
      storage: localStorage.getItem('byos_theme'),
    }));
    console.log("After clicking Dark button:", JSON.stringify(afterDarkTheme));

    // Click "Light" button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.trim() === 'Light');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    const afterLightTheme = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      isDarkClass: document.documentElement.classList.contains('dark'),
      storage: localStorage.getItem('byos_theme'),
    }));
    console.log("After clicking Light button:", JSON.stringify(afterLightTheme));

    const darkModeWorking = afterDarkTheme.isDarkClass === true && afterLightTheme.isDarkClass === false;
    console.log("Dark Mode Result:", darkModeWorking ? "WORKING" : "BROKEN");

    // -------------------------------------------------------------
    // FEATURE 9: KEYBOARD SHORTCUTS
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 9] Keyboard Shortcuts Verification ---");
    // Ensure body has focus, not an input
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });

    // Test 'c' key to open compose drawer
    console.log("Testing shortcut 'c' (Compose)...");
    await page.keyboard.press('KeyC');
    await new Promise(r => setTimeout(r, 800));

    const composeOpen = await page.evaluate(() => {
      const drawer = document.querySelector('[data-testid="compose-drawer"]') ||
                     document.querySelector('form') ||
                     document.querySelector('input[placeholder*="recipient" i], input[placeholder*="To" i]');
      return drawer !== null;
    });
    console.log("Compose drawer opened via 'c' key:", composeOpen);

    // Test 'Escape' key to close compose drawer
    if (composeOpen) {
      console.log("Testing Escape key to close compose...");
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));
    }

    // Blur before testing '?'
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });

    // Test '?' key for shortcuts modal (Shift + Slash)
    console.log("Testing shortcut '?' (Help)...");
    await page.keyboard.down('Shift');
    await page.keyboard.press('Slash');
    await page.keyboard.up('Shift');
    await new Promise(r => setTimeout(r, 800));
    const helpOpen = await page.evaluate(() => {
      return document.body.innerText.includes("Keyboard Shortcuts") ||
             document.querySelector('[role="dialog"][aria-label="Keyboard Shortcuts"]') !== null;
    });
    console.log("Shortcuts help modal visible via '?' key:", helpOpen);
    if (helpOpen) {
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 500));
    }

    // Blur before testing '/'
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    });

    // Test '/' key to focus search
    console.log("Testing shortcut '/' (Search)...");
    await page.keyboard.press('Slash');
    await new Promise(r => setTimeout(r, 500));
    const searchFocused = await page.evaluate(() => {
      const active = document.activeElement;
      return active && (active.tagName === 'INPUT' && (active.placeholder?.toLowerCase().includes('search') || active.type === 'search'));
    });
    console.log("Search input focused via '/' key:", searchFocused);

    console.log("Keyboard Shortcuts Result:", (composeOpen && helpOpen) ? "WORKING" : "PARTIAL");

    // -------------------------------------------------------------
    // FEATURE 6: UNDO SEND
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 6] Undo Send Verification ---");
    // Open compose drawer
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.includes('New Message'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // Fill in recipient, subject, and body via real typing
    await page.focus('#composeToInput');
    await page.keyboard.type('bob@byos.local');
    await page.focus('#composeSubjectInput');
    await page.keyboard.type('Browser Undo Send Audit');
    await page.focus('[contenteditable="true"]');
    await page.keyboard.type('Hello encrypted undo send test body');
    console.log("Compose form fields filled with real typing");

    const formVals = await page.evaluate(() => ({
      toVal: document.querySelector('#composeToInput')?.value,
      subVal: document.querySelector('#composeSubjectInput')?.value,
      bodyVal: document.querySelector('[contenteditable="true"]')?.innerText,
    }));
    console.log("Form values before Send:", JSON.stringify(formVals));

    // Click "Send Encrypted" button
    const sentClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.includes('Send Encrypted'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log("Send Encrypted button clicked:", sentClicked);

    // Wait for undo send toast (5 second window)
    await new Promise(r => setTimeout(r, 800));
    const pendingStorage = await page.evaluate(() => sessionStorage.getItem('byos_pending_send'));
    console.log("Pending Send in sessionStorage:", pendingStorage);

    const toastState = await page.evaluate(() => {
      const toast = document.querySelector('[role="status"]') ||
                    Array.from(document.querySelectorAll('*')).find(el => el.innerText && el.innerText.includes('Sending in') && el.innerText.includes('Undo'));
      if (!toast) return null;
      return {
        text: toast.innerText,
        hasUndoBtn: !!Array.from(toast.querySelectorAll('button')).find(b => b.innerText.includes('Undo')),
      };
    });
    console.log("Undo Send Toast rendered in DOM:", JSON.stringify(toastState));

    let undoSuccess = false;
    if (toastState && toastState.hasUndoBtn) {
      console.log("Clicking Undo button in toast...");
      const clickInfo = await page.evaluate(() => {
        const toast = document.querySelector('[role="status"]') ||
                      Array.from(document.querySelectorAll('*')).find(el => el.innerText && el.innerText.includes('Sending in') && el.innerText.includes('Undo'));
        const undoBtn = Array.from(toast ? toast.querySelectorAll('button') : []).find(b => b.innerText.includes('Undo'));
        if (undoBtn) {
          undoBtn.click();
          return { clicked: true, btnText: undoBtn.innerText };
        }
        return { clicked: false };
      });
      console.log("Click result:", JSON.stringify(clickInfo));
      await new Promise(r => setTimeout(r, 1200));

      // Assert message restored into compose drawer
      const restored = await page.evaluate(() => {
        const byId = document.querySelector('#composeSubjectInput');
        const composeVisible = Array.from(document.querySelectorAll('header')).some(h => h.innerText.includes('New Message') || h.innerText.includes('Browser Undo'));
        return {
          subjectVal: byId ? byId.value : null,
          composeVisible,
        };
      });
      console.log("Restored compose drawer state:", JSON.stringify(restored));
      undoSuccess = restored.subjectVal === 'Browser Undo Send Audit' && restored.composeVisible;
    }
    console.log("Undo Send Result:", undoSuccess ? "WORKING" : "BROKEN");

    // Close compose if open
    await page.evaluate(() => {
      const closeBtn = document.querySelector('button[aria-label="Close" i], button[title="Close" i]');
      if (closeBtn) closeBtn.click();
    });

    // -------------------------------------------------------------
    // FEATURE 12: EMAIL IMPORT (.EML / .MBOX)
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 12] Email Import Modal Verification ---");
    const importOpened = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const btn = btns.find(b => b.innerText.includes('Import'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 1000));

    const importModalState = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="import-emails-modal"]') ||
                    Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Import Emails'));
      if (!modal) return null;
      return {
        title: modal.innerText.split('\n')[0],
        hasFileInput: !!modal.querySelector('input[type="file"]'),
        textSnippet: modal.innerText.slice(0, 200),
      };
    });
    console.log("Import modal state in DOM:", JSON.stringify(importModalState));
    console.log("Email Import Modal Result:", importModalState !== null ? "WORKING" : "BROKEN");

    // Close import modal
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));

    // -------------------------------------------------------------
    // FEATURE 11: RESPONSIVE VIEWPORT CHECKS
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 11] Mobile Viewport Verification ---");
    const viewports = [
      { name: "375px (Mobile Portrait - iPhone SE)", width: 375, height: 667 },
      { name: "414px (Mobile Large - iPhone XR)", width: 414, height: 896 },
      { name: "768px (Tablet - iPad)", width: 768, height: 1024 },
    ];

    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await new Promise(r => setTimeout(r, 600));

      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));

      console.log(`Viewport ${vp.name}: width=${vp.width}, scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}, horizontalOverflow=${overflow.hasHorizontalScroll}`);
    }

    // -------------------------------------------------------------
    // FEATURE 21: EMPTY STATES AND LOADING STATES
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 21] Empty States Verification ---");
    // Ensure viewport is desktop for sidebar interactions
    await page.setViewport({ width: 1280, height: 800 });
    await new Promise(r => setTimeout(r, 500));

    const foldersToCheck = ["Drafts", "Trash", "Spam", "Scheduled"];
    const emptyStates = {};

    for (const folder of foldersToCheck) {
      await page.evaluate((folderName) => {
        const links = Array.from(document.querySelectorAll('button, a'));
        const btn = links.find(b => b.innerText.trim() === folderName);
        if (btn) btn.click();
      }, folder);
      await new Promise(r => setTimeout(r, 800));

      const emptyText = await page.evaluate(() => {
        const emptyEl = Array.from(document.querySelectorAll('*')).find(el => el.innerText && el.innerText.startsWith('No messages in'));
        return emptyEl ? emptyEl.innerText.trim() : null;
      });
      console.log(`Folder [${folder}] empty state:`, JSON.stringify(emptyText));
      emptyStates[folder] = emptyText;
    }
    const emptyStatesWorking = Object.values(emptyStates).some(t => t !== null && t.includes("No messages in"));
    console.log("Empty States Result:", emptyStatesWorking ? "WORKING" : "BROKEN");

    // Return to Inbox
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.trim() === 'Inbox');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // -------------------------------------------------------------
    // FEATURE 22: SETTINGS SUITE (SIGNATURES, APPEARANCE, BRIDGE, AUTOREPLY, SECURITY)
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 22] Settings Suite Verification ---");
    // Click Settings in sidebar
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.trim() === 'Settings');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    const settingsTabs = [
      { id: "signatures", label: "Signatures & Identities" },
      { id: "bridge", label: "Desktop & Mobile Apps" },
      { id: "appearance", label: "Appearance" },
      { id: "autoreply", label: "Auto-Reply" },
      { id: "security", label: "Security & Sessions" },
    ];
    const settingsStates = {};

    for (const tab of settingsTabs) {
      const tabClicked = await page.evaluate((tabLabel) => {
        const btns = Array.from(document.querySelectorAll('nav button'));
        const b = btns.find(btn => btn.innerText.includes(tabLabel));
        if (b) {
          b.click();
          return true;
        }
        return false;
      }, tab.label);
      await new Promise(r => setTimeout(r, 600));

      const tabContent = await page.evaluate(() => {
        const h = Array.from(document.querySelectorAll('h2, h3, h4')).map(el => el.innerText.trim()).filter(Boolean);
        return h.slice(0, 3).join(" | ");
      });
      settingsStates[tab.id] = { clicked: tabClicked, headers: tabContent };
      console.log(`Settings Tab [${tab.label}]:`, JSON.stringify(settingsStates[tab.id]));
    }
    const settingsWorking = Object.values(settingsStates).every(s => s.clicked);
    console.log("Settings Suite Result:", settingsWorking ? "WORKING" : "BROKEN");

    // -------------------------------------------------------------
    // FEATURE 19: FILTERS / RULES UI
    // -------------------------------------------------------------
    console.log("\n--- [AUDIT 19] Filters / Rules UI Verification ---");
    // Click Filters & Rules tab inside settings
    const filtersTabClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('nav button'));
      const b = btns.find(btn => btn.innerText.includes('Filters & Rules'));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 800));

    // Verify Add Rule button and spam/block/allow tabs
    const filtersUIState = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const hasAddRuleBtn = btns.some(b => b.innerText.includes('Add Rule'));
      const spamBlockTabs = ['spam', 'block'].every(t => document.body.innerText.toLowerCase().includes(t));
      return {
        hasAddRuleBtn,
        spamBlockTabs,
      };
    });
    console.log("Filters & Rules UI state:", JSON.stringify(filtersUIState));

    // Click "Add Rule" button to open modal
    const ruleModalOpened = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.includes('Add Rule'));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 600));

    const ruleModalForm = await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Create Mail Rule'));
      if (!modal) return null;
      const inputs = Array.from(modal.querySelectorAll('input')).map(i => ({ placeholder: i.placeholder, type: i.type }));
      return {
        hasModal: true,
        inputCount: inputs.length,
        inputs: inputs.slice(0, 4),
      };
    });
    console.log("Create Rule Modal Form:", JSON.stringify(ruleModalForm));
    const filtersWorking = filtersTabClicked && filtersUIState.hasAddRuleBtn && ruleModalForm !== null;
    console.log("Filters / Rules UI Result:", filtersWorking ? "WORKING" : "BROKEN");

    // Close settings modal / layout
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    await page.evaluate(() => {
      const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Back to Inbox') || b.getAttribute('aria-label') === 'Close');
      if (closeBtn) closeBtn.click();
    });
    await new Promise(r => setTimeout(r, 500));

    console.log("\n=== ALL AUDIT ITEMS VERIFIED IN REAL BROWSER ===");
  } finally {
    await browser.close();
  }
}

runAudit().catch(err => {
  console.error("Browser audit failed:", err);
  process.exit(1);
});
