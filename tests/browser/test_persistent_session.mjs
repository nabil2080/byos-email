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

async function runPersistentSessionVerification() {
  console.log("================================================================================");
  console.log("   CHANGE 3: 30-DAY PERSISTENT SESSIONS & DEVICE KEY BROWSER VERIFICATION       ");
  console.log("================================================================================\n");

  const Alice = {
    email: "alice@byos.local",
    password: "test-password-123",
    userId: "cccccccc-0000-0000-0000-000000000002",
    mailboxId: "c0000000-0000-0000-0000-000000000001",
  };

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Step 1: Open Login Page
    console.log("--- [STEP 1] Navigate to Login Page and verify disclosure UI ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });

    // If already in a session, clear everything to start on login page
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 800));

    // Verify Checkbox and Disclosure exist
    const uiCheck = await page.evaluate(() => {
      const cb = document.querySelector('[data-testid="remember-device-checkbox"]');
      const disclosure = document.querySelector('[data-testid="remember-device-disclosure"]');
      return {
        hasCheckbox: !!cb,
        checkboxChecked: cb ? cb.checked : false,
        disclosureText: disclosure?.textContent?.trim(),
      };
    });

    console.log("UI Elements Check:", JSON.stringify(uiCheck, null, 2));
    if (!uiCheck.hasCheckbox) {
      throw new Error("Missing remember-device-checkbox on login form");
    }
    const expectedDisclosure = "Storing your key on this device means anyone with access to this browser profile can read your mail without your password. Do not enable on a shared computer.";
    if (!uiCheck.disclosureText?.includes(expectedDisclosure)) {
      throw new Error(`Disclosure text mismatch. Got: "${uiCheck.disclosureText}"`);
    }

    const shot1 = path.join(artifactsDir, "persistent_session_login_disclosure.png");
    await page.screenshot({ path: shot1 });
    console.log("✓ STEP 1 PASSED: Checkbox and required disclosure warning verified. Screenshot:", shot1);

    // Step 2: Log in with Remember Device checked
    console.log("\n--- [STEP 2] Log in with 'Remember this device for 30 days' checked ---");
    // Fill credentials
    await page.type('input[autocomplete="username"]', Alice.email);
    await page.type('input[autocomplete="current-password"]', Alice.password);

    // Click Remember Checkbox
    await page.click('[data-testid="remember-device-checkbox"]');
    await new Promise((r) => setTimeout(r, 300));

    // Submit form
    await page.click('button[type="submit"]');

    // Wait for inbox to load
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Inspect IndexedDB & LocalStorage
    const storageDump = await page.evaluate(async (uid) => {
      const persistentUserId = localStorage.getItem("byos_persistent_user_id");
      const persistentToken = localStorage.getItem(`byos_persistent_token_${uid}`);
      const activeSessionToken = sessionStorage.getItem("byos_active_session_token");

      // Check IndexedDB
      const openReq = indexedDB.open("byos_device_keystore", 1);
      const idbData = await new Promise((resolve) => {
        openReq.onsuccess = () => {
          try {
            const db = openReq.result;
            if (!db.objectStoreNames.contains("device_keys")) {
              resolve({ hasDeviceKey: false, hasSealedKeys: false });
              return;
            }
            const tx = db.transaction("device_keys", "readonly");
            const store = tx.objectStore("device_keys");
            const keyReq = store.get(`byos_device_key_${uid}`);
            const sealedReq = store.get(`byos_sealed_keys_${uid}`);
            let keyDone = false;
            let sealedDone = false;
            let keyRes = null;
            let sealedRes = null;
            keyReq.onsuccess = () => {
              keyRes = keyReq.result;
              keyDone = true;
              if (sealedDone) finish();
            };
            keyReq.onerror = () => {
              keyDone = true;
              if (sealedDone) finish();
            };
            sealedReq.onsuccess = () => {
              sealedRes = sealedReq.result;
              sealedDone = true;
              if (keyDone) finish();
            };
            sealedReq.onerror = () => {
              sealedDone = true;
              if (keyDone) finish();
            };
            function finish() {
              resolve({
                hasDeviceKey: Boolean(keyRes),
                keyExtractable: keyRes?.extractable,
                keyAlgorithm: keyRes?.algorithm?.name,
                hasSealedKeys: Boolean(sealedRes),
                sealedIvLen: sealedRes?.ivHex?.length,
                hasCiphertext: Boolean(sealedRes?.ciphertextHex),
              });
            }
          } catch (e) {
            resolve({ error: String(e) });
          }
        };
        openReq.onerror = () => resolve({ error: "Failed to open IDB" });
      });

      return {
        persistentUserId,
        hasPersistentToken: !!persistentToken,
        hasActiveSessionToken: !!activeSessionToken,
        idbData,
      };
    }, Alice.userId);

    console.log("Storage dump after persistent login:", JSON.stringify(storageDump, null, 2));
    if (storageDump.persistentUserId !== Alice.userId) {
      throw new Error(`Expected persistentUserId ${Alice.userId}, got ${storageDump.persistentUserId}`);
    }
    if (!storageDump.hasPersistentToken) {
      throw new Error("Missing byos_persistent_token_<userId> in localStorage");
    }
    if (!storageDump.idbData?.hasDeviceKey) {
      throw new Error("Missing byos_device_key in IndexedDB");
    }
    if (storageDump.idbData?.keyExtractable !== false) {
      throw new Error(`Device key MUST NOT be extractable! Got: ${storageDump.idbData?.keyExtractable}`);
    }
    if (!storageDump.idbData?.hasSealedKeys || !storageDump.idbData?.hasCiphertext) {
      throw new Error("Missing byos_sealed_keys in IndexedDB");
    }

    const shot2 = path.join(artifactsDir, "persistent_session_logged_in.png");
    await page.screenshot({ path: shot2 });
    console.log("✓ STEP 2 PASSED: Non-extractable device key & sealed keys verified in IndexedDB. Screenshot:", shot2);

    // Step 3: Simulate browser restart / fresh tab by clearing sessionStorage and reloading
    console.log("\n--- [STEP 3] Simulate tab/browser close (wipe sessionStorage) & reload ---");
    await page.evaluate(() => {
      sessionStorage.clear();
    });

    await page.reload({ waitUntil: 'networkidle2' });
    // Wait for auto-restore
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    const restoredCheck = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="account-chip-selector"]');
      const activeToken = sessionStorage.getItem("byos_active_session_token");
      const hasLoginInput = !!document.querySelector('input[autocomplete="username"]');
      return {
        hasChip: !!chip,
        hasActiveToken: !!activeToken,
        hasLoginInput,
      };
    });

    console.log("Restored session state:", JSON.stringify(restoredCheck, null, 2));
    if (!restoredCheck.hasChip || restoredCheck.hasLoginInput) {
      throw new Error("Session was not automatically restored without password prompt!");
    }
    if (!restoredCheck.hasActiveToken) {
      throw new Error("Session token was not repopulated in sessionStorage!");
    }

    const shot3 = path.join(artifactsDir, "persistent_session_auto_restored.png");
    await page.screenshot({ path: shot3 });
    console.log("✓ STEP 3 PASSED: Session automatically restored from device key without password prompt. Screenshot:", shot3);

    // Step 4: Explicit Logout
    console.log("\n--- [STEP 4] Explicit Logout & verify key purge ---");
    // Click account switcher to reveal logout, or click Settings / Logout
    await page.evaluate(() => {
      // Find sign out / log out button
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      const logoutBtn = buttons.find((b) => b.textContent?.includes("Sign out") || b.textContent?.includes("Log out"));
      if (logoutBtn) logoutBtn.click();
    });
    await new Promise((r) => setTimeout(r, 800));

    // If still in inbox, try opening dropdown
    const stillInInbox = await page.evaluate(() => !!document.querySelector('[data-testid="account-chip-selector"]'));
    if (stillInInbox) {
      await page.click('[data-testid="account-chip-selector"]');
      await new Promise((r) => setTimeout(r, 500));
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
        const logoutBtn = buttons.find((b) => b.textContent?.includes("Sign out") || b.textContent?.includes("Log out"));
        if (logoutBtn) logoutBtn.click();
      });
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Verify back on login page
    await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });

    // Verify all keys and tokens purged from localStorage and IndexedDB
    const postLogoutStorage = await page.evaluate(async (uid) => {
      const persistentUserId = localStorage.getItem("byos_persistent_user_id");
      const persistentToken = localStorage.getItem(`byos_persistent_token_${uid}`);
      const activeSessionToken = sessionStorage.getItem("byos_active_session_token");

      const openReq = indexedDB.open("byos_device_keystore", 1);
      const idbData = await new Promise((resolve) => {
        openReq.onsuccess = () => {
          try {
            const db = openReq.result;
            if (!db.objectStoreNames.contains("device_keys")) {
              resolve({ hasDeviceKey: false, hasSealedKeys: false });
              return;
            }
            const tx = db.transaction("device_keys", "readonly");
            const store = tx.objectStore("device_keys");
            const keyReq = store.get(`byos_device_key_${uid}`);
            const sealedReq = store.get(`byos_sealed_keys_${uid}`);
            let keyDone = false;
            let sealedDone = false;
            let keyRes = null;
            let sealedRes = null;
            keyReq.onsuccess = () => {
              keyRes = keyReq.result;
              keyDone = true;
              if (sealedDone) finish();
            };
            keyReq.onerror = () => {
              keyDone = true;
              if (sealedDone) finish();
            };
            sealedReq.onsuccess = () => {
              sealedRes = sealedReq.result;
              sealedDone = true;
              if (keyDone) finish();
            };
            sealedReq.onerror = () => {
              sealedDone = true;
              if (keyDone) finish();
            };
            function finish() {
              resolve({
                hasDeviceKey: Boolean(keyRes),
                hasSealedKeys: Boolean(sealedRes),
              });
            }
          } catch (e) {
            resolve({ error: String(e) });
          }
        };
        openReq.onerror = () => resolve({ error: "Failed to open IDB" });
      });

      return {
        persistentUserId,
        persistentToken,
        activeSessionToken,
        idbData,
      };
    }, Alice.userId);

    console.log("Storage dump post-logout:", JSON.stringify(postLogoutStorage, null, 2));
    if (postLogoutStorage.persistentUserId !== null) {
      throw new Error("byos_persistent_user_id must be null after logout");
    }
    if (postLogoutStorage.persistentToken !== null) {
      throw new Error("byos_persistent_token must be null after logout");
    }
    if (postLogoutStorage.idbData?.hasDeviceKey) {
      throw new Error("byos_device_key must be removed from IndexedDB on logout");
    }
    if (postLogoutStorage.idbData?.hasSealedKeys) {
      throw new Error("byos_sealed_keys must be removed from IndexedDB on logout");
    }

    const shot4 = path.join(artifactsDir, "persistent_session_logged_out.png");
    await page.screenshot({ path: shot4 });
    console.log("✓ STEP 4 PASSED: Explicit logout completely purged device key, sealed keys, and tokens. Screenshot:", shot4);

    // Step 5: Test Expired Token Shows Password Prompt & Purges IDB (test_expired_token_shows_password_prompt)
    console.log("\n--- [STEP 5] Test Expired Token Shows Password Prompt (test_expired_token_shows_password_prompt) ---");
    // Log in again with Remember Device checked
    await page.type('input[autocomplete="username"]', Alice.email);
    await page.type('input[autocomplete="current-password"]', Alice.password);
    await page.click('[data-testid="remember-device-checkbox"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Clear volatile sessionStorage and set expired timestamp in localStorage
    await page.evaluate((uid) => {
      sessionStorage.clear();
      const raw = localStorage.getItem(`byos_persistent_token_${uid}`);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          parsed.expiresAt = Date.now() - 10000; // 10s in the past
          localStorage.setItem(`byos_persistent_token_${uid}`, JSON.stringify(parsed));
        } catch {
          localStorage.setItem(`byos_persistent_token_${uid}`, JSON.stringify({ token: raw, expiresAt: Date.now() - 10000 }));
        }
      }
    }, Alice.userId);

    // Reload page
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));

    // Assert login form is displayed (not the inbox)
    const expiredCheck = await page.evaluate(async (uid) => {
      const hasLoginInput = !!document.querySelector('input[autocomplete="username"]');
      const hasChip = !!document.querySelector('[data-testid="account-chip-selector"]');
      const persistentUserId = localStorage.getItem("byos_persistent_user_id");
      const persistentToken = localStorage.getItem(`byos_persistent_token_${uid}`);

      const openReq = indexedDB.open("byos_device_keystore", 1);
      const idbData = await new Promise((resolve) => {
        openReq.onsuccess = () => {
          try {
            const db = openReq.result;
            if (!db.objectStoreNames.contains("device_keys")) {
              resolve({ hasDeviceKey: false, hasSealedKeys: false });
              return;
            }
            const tx = db.transaction("device_keys", "readonly");
            const store = tx.objectStore("device_keys");
            const keyReq = store.get(`byos_device_key_${uid}`);
            const sealedReq = store.get(`byos_sealed_keys_${uid}`);
            let keyDone = false;
            let sealedDone = false;
            let keyRes = null;
            let sealedRes = null;
            keyReq.onsuccess = () => {
              keyRes = keyReq.result;
              keyDone = true;
              if (sealedDone) finish();
            };
            keyReq.onerror = () => {
              keyDone = true;
              if (sealedDone) finish();
            };
            sealedReq.onsuccess = () => {
              sealedRes = sealedReq.result;
              sealedDone = true;
              if (keyDone) finish();
            };
            sealedReq.onerror = () => {
              sealedDone = true;
              if (keyDone) finish();
            };
            function finish() {
              resolve({
                hasDeviceKey: Boolean(keyRes),
                hasSealedKeys: Boolean(sealedRes),
              });
            }
          } catch (e) {
            resolve({ error: String(e) });
          }
        };
        openReq.onerror = () => resolve({ error: "Failed to open IDB" });
      });

      return {
        hasLoginInput,
        hasChip,
        persistentUserId,
        persistentToken,
        idbData,
      };
    }, Alice.userId);

    console.log("Expired token check result:", JSON.stringify(expiredCheck, null, 2));
    if (!expiredCheck.hasLoginInput || expiredCheck.hasChip) {
      throw new Error("Expired token failed to show password prompt login form!");
    }
    if (expiredCheck.persistentUserId !== null || expiredCheck.persistentToken !== null) {
      throw new Error("Expired token failed to purge localStorage entries!");
    }
    if (expiredCheck.idbData?.hasDeviceKey || expiredCheck.idbData?.hasSealedKeys) {
      throw new Error("Expired token failed to purge IndexedDB device keys!");
    }

    const shot5 = path.join(artifactsDir, "persistent_session_expired_prompt.png");
    await page.screenshot({ path: shot5 });
    console.log("✓ STEP 5 PASSED: Expired token displays password prompt & purges IndexedDB device keys. Screenshot:", shot5);

    // Step 6: Test Server-Side Revoked Token Shows Password Prompt (test_server_revoked_token_shows_password_prompt)
    console.log("\n--- [STEP 6] Test Server-Side Revoked Token Shows Password Prompt ---");
    // Log in again as Alice with Remember Device checked
    await page.type('input[autocomplete="username"]', Alice.email);
    await page.type('input[autocomplete="current-password"]', Alice.password);
    await page.click('[data-testid="remember-device-checkbox"]');
    await new Promise((r) => setTimeout(r, 300));
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1000));

    // In Postgres, manually delete Alice's session row to simulate server-side revocation:
    console.log("Manually revoking session in PostgreSQL...");
    execSql(`DELETE FROM sessions WHERE user_id = '${Alice.userId}';`);

    // Simulate tab close: clear volatile sessionStorage (leaving persistent tokens in IDB & localStorage)
    await page.evaluate(() => {
      sessionStorage.clear();
    });

    // Reload page
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    // Assert login form is displayed (not the inbox) and IDB/localStorage are purged
    const revokedCheck = await page.evaluate(async (uid) => {
      const hasLoginInput = !!document.querySelector('input[autocomplete="username"]');
      const hasChip = !!document.querySelector('[data-testid="account-chip-selector"]');
      const persistentUserId = localStorage.getItem("byos_persistent_user_id");
      const persistentToken = localStorage.getItem(`byos_persistent_token_${uid}`);

      const openReq = indexedDB.open("byos_device_keystore", 1);
      const idbData = await new Promise((resolve) => {
        openReq.onsuccess = () => {
          try {
            const db = openReq.result;
            if (!db.objectStoreNames.contains("device_keys")) {
              resolve({ hasDeviceKey: false, hasSealedKeys: false });
              return;
            }
            const tx = db.transaction("device_keys", "readonly");
            const store = tx.objectStore("device_keys");
            const keyReq = store.get(`byos_device_key_${uid}`);
            const sealedReq = store.get(`byos_sealed_keys_${uid}`);
            let keyDone = false;
            let sealedDone = false;
            let keyRes = null;
            let sealedRes = null;
            keyReq.onsuccess = () => {
              keyRes = keyReq.result;
              keyDone = true;
              if (sealedDone) finish();
            };
            keyReq.onerror = () => {
              keyDone = true;
              if (sealedDone) finish();
            };
            sealedReq.onsuccess = () => {
              sealedRes = sealedReq.result;
              sealedDone = true;
              if (keyDone) finish();
            };
            sealedReq.onerror = () => {
              sealedDone = true;
              if (keyDone) finish();
            };
            function finish() {
              resolve({
                hasDeviceKey: Boolean(keyRes),
                hasSealedKeys: Boolean(sealedRes),
              });
            }
          } catch (e) {
            resolve({ error: String(e) });
          }
        };
        openReq.onerror = () => resolve({ error: "Failed to open IDB" });
      });

      return {
        hasLoginInput,
        hasChip,
        persistentUserId,
        persistentToken,
        idbData,
      };
    }, Alice.userId);

    console.log("Revoked token check result:", JSON.stringify(revokedCheck, null, 2));
    if (!revokedCheck.hasLoginInput || revokedCheck.hasChip) {
      throw new Error("Server-revoked token failed to show password prompt login form!");
    }
    if (revokedCheck.persistentUserId !== null || revokedCheck.persistentToken !== null) {
      throw new Error("Server-revoked token failed to purge localStorage entries!");
    }
    if (revokedCheck.idbData?.hasDeviceKey || revokedCheck.idbData?.hasSealedKeys) {
      throw new Error("Server-revoked token failed to purge IndexedDB device keys!");
    }

    const shot6 = path.join(artifactsDir, "persistent_session_revoked_prompt.png");
    await page.screenshot({ path: shot6 });
    console.log("✓ STEP 6 PASSED: Server-revoked token displays password prompt & purges IndexedDB device keys. Screenshot:", shot6);

    console.log("\n================================================================================");
    console.log("       ALL PERSISTENT SESSION BROWSER VERIFICATION CHECKS PASSED!               ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

runPersistentSessionVerification().catch((err) => {
  console.error("Persistent session browser verification failed:", err);
  process.exit(1);
});
