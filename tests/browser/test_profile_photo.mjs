import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const Alice = {
  userId: "cccccccc-0000-0000-0000-000000000002",
  mailboxId: "c0000000-0000-0000-0000-000000000001",
  email: "alice@byos.local",
  token: "alice_manual_test_session_token_123",
  xwingSeed: "11".repeat(32),
  signingSeed: "33".repeat(32),
};

const Bob = {
  userId: "cccccccc-0000-0000-0000-000000000003",
  mailboxId: "c0000000-0000-0000-0000-000000000002",
  email: "bob@byos.local",
  token: "bob_manual_test_session_token_123",
  xwingSeed: "22".repeat(32),
  signingSeed: "44".repeat(32),
};

Alice.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Alice.xwingSeed);
Alice.signingPkHex = wasm.wasm_signing_public_key_from_seed(Alice.signingSeed);
Bob.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Bob.xwingSeed);
Bob.signingPkHex = wasm.wasm_signing_public_key_from_seed(Bob.signingSeed);

function execSql(sql) {
  const cmd = `docker exec byos-postgres psql -U byos -d byos -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: 'utf-8' });
}

async function sendPathAMessage({ sender, recipient, subject, body }) {
  const mimeStr = `From: ${sender.email}\r\nTo: ${recipient.email}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`;
  const mimeHex = Array.from(new TextEncoder().encode(mimeStr)).map((b) => b.toString(16).padStart(2, '0')).join('');

  const recEnv = wasm.wasm_seal_xwing_envelope_signed(recipient.xwingPkHex, recipient.mailboxId, 1, mimeHex, sender.signingSeed);
  const senderEnv = wasm.wasm_seal_xwing_envelope_signed(sender.xwingPkHex, sender.mailboxId, 1, mimeHex, sender.signingSeed);

  const res = await fetch("http://localhost:8080/v1/outbound/send-internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${sender.token}`,
    },
    body: JSON.stringify({
      envelope_json: recEnv,
      sender_envelope_json: senderEnv,
      recipient: recipient.email,
      sender_mailbox_id: sender.mailboxId,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to send internal Path A message: ${res.status} ${errText}`);
  }
  return await res.json();
}

async function runProfilePhotoVerification() {
  console.log("================================================================================");
  console.log("     CHANGE 1: PROFILE PHOTO & FALLBACK AVATAR BROWSER VERIFICATION             ");
  console.log("================================================================================\n");

  // Step 0: Ensure DB state for Alice and clear any old profile photo
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${Alice.userId}', digest('${Alice.token}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL`);
  execSql(`UPDATE mailboxes SET profile_photo_ref = NULL, profile_photo_updated_at = NOW(), mailbox_xwing_pk = decode('${Alice.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Alice.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Alice.mailboxId}'`);

  // Seed a message from Alice to Alice so Alice's own message row and reading pane can be viewed
  console.log("Seeding message from Alice to Alice for avatar verification...");
  await sendPathAMessage({
    sender: Alice,
    recipient: Alice,
    subject: "Avatar Verification Message",
    body: "Checking avatar in message row and reading pane.",
  });

  // Create temporary test image in artifacts
  // Valid 1x1 sample PNG
  const testImagePath = path.join(artifactsDir, "test_avatar_sample.png");
  const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  fs.writeFileSync(testImagePath, Buffer.from(pngBase64, 'base64'));

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });

    // Login Alice
    console.log("Setting up Alice session in browser...");
    await page.evaluate((al) => {
      localStorage.setItem('byos_active_session_token', al.token);
      sessionStorage.setItem('byos_active_session_token', al.token);

      sessionStorage.setItem('byos_mailbox_sk_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_mailbox_skey_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_signing_seed_' + al.mailboxId, al.signingSeed);
      sessionStorage.setItem('byos_xwing_seed_' + al.mailboxId, al.xwingSeed);

      const accounts = [
        {
          id: al.mailboxId,
          email: al.email,
          displayName: "Alice",
          role: "owner",
          privacyMode: "private",
          sessionToken: al.token,
          mailboxSkHex: al.xwingSeed,
          searchKeyHex: al.xwingSeed,
          isLocked: false,
        },
      ];
      sessionStorage.setItem('byos_connected_accounts', JSON.stringify(accounts));
      localStorage.setItem('byos_connected_accounts_display', JSON.stringify([{ id: al.mailboxId, email: al.email, displayName: "Alice" }]));
    }, Alice);

    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1000));

    // --- CHECK 1: Fallback Avatar when no photo set ---
    console.log("\n--- [CHECK 1] Verify Fallback Avatar renders initial 'A' and deterministic color ---");
    const check1 = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="account-chip-selector"]');
      const chipInitial = chip?.querySelector('[data-testid="avatar-fallback-initial"]')?.textContent?.trim();
      const chipImg = chip?.querySelector('[data-testid="avatar-photo-img"]');
      const chipAvatar = chip?.querySelector('[data-testid="account-chip-dot"]');
      const chipBg = chipAvatar ? window.getComputedStyle(chipAvatar).backgroundColor : null;

      const messageRowAvatar = document.querySelector('[data-testid="message-row-avatar"]');
      const messageRowInitial = messageRowAvatar?.querySelector('[data-testid="avatar-fallback-initial"]')?.textContent?.trim();

      return {
        hasChip: !!chip,
        chipInitial,
        hasChipImg: !!chipImg,
        chipBg,
        messageRowInitial,
      };
    });

    console.log("Check 1 Fallback Avatar state:", JSON.stringify(check1, null, 2));
    if (check1.chipInitial !== "A") {
      throw new Error(`Expected fallback initial 'A', got "${check1.chipInitial}"`);
    }
    if (check1.hasChipImg) {
      throw new Error("Must NOT render photo img when no photo is set");
    }
    if (!check1.chipBg) {
      throw new Error("Expected fallback avatar to have background color");
    }

    const fallbackShotPath = path.join(artifactsDir, "profile_photo_fallback.png");
    await page.screenshot({ path: fallbackShotPath });
    console.log("✓ CHECK 1 PASSED: Fallback initial 'A' and background color verified. Screenshot saved:", fallbackShotPath);

    // --- CHECK 2: Upload photo in Settings -> Account ---
    console.log("\n--- [CHECK 2] Upload photo in Settings → Account ---");
    // Click Settings in sidebar
    await page.evaluate(() => {
      const settingsBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((el) => el.textContent?.includes("Settings"));
      if (settingsBtns.length > 0) settingsBtns[0].click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Verify Settings is open on Account tab
    const hasPhotoSection = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="profile-photo-section"]');
    });
    if (!hasPhotoSection) {
      throw new Error("Profile photo section not found in Settings!");
    }

    page.on('console', (msg) => console.log('  [BROWSER CONSOLE]', msg.type(), msg.text()));
    page.on('pageerror', (err) => console.log('  [BROWSER ERROR]', err));

    // Upload file via hidden input
    const fileInput = await page.$('[data-testid="profile-photo-file-input"]');
    if (!fileInput) throw new Error("File input not found");
    await fileInput.uploadFile(testImagePath);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="profile-photo-file-input"]');
      if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Wait for upload and toast
    console.log("Waiting for photo upload & client-side encryption...");
    await new Promise((r) => setTimeout(r, 2000));

    const check2Settings = await page.evaluate(() => {
      const previewImg = document.querySelector('[data-testid="settings-avatar-preview"] [data-testid="avatar-photo-img"]');
      const removeBtn = document.querySelector('[data-testid="remove-photo-btn"]');
      const errorMsg = document.querySelector('[data-testid="photo-error-message"]')?.textContent;
      const fileInputFiles = document.querySelector('[data-testid="profile-photo-file-input"]')?.files?.length;
      return {
        hasPreviewImg: !!previewImg,
        previewSrc: previewImg?.getAttribute("src")?.substring(0, 30),
        hasRemoveBtn: !!removeBtn,
        errorMsg,
        fileInputFiles,
      };
    });

    console.log("Check 2 Settings state:", JSON.stringify(check2Settings, null, 2));
    if (!check2Settings.hasPreviewImg) {
      throw new Error("Expected photo img preview to appear in Settings after upload!");
    }
    if (!check2Settings.hasRemoveBtn) {
      throw new Error("Expected 'Remove photo' button to be visible when photo is set!");
    }

    // Close Settings and return to inbox
    await page.evaluate(() => {
      const backBtn = document.querySelector('[data-testid="settings-back-to-inbox-btn"]');
      if (backBtn) backBtn.click();
    });
    await new Promise((r) => setTimeout(r, 800));

    // Verify sidebar chip has photo img
    const check2Sidebar = await page.evaluate(() => {
      const chipImg = document.querySelector('[data-testid="account-chip-selector"] [data-testid="avatar-photo-img"]');
      return {
        hasChipPhoto: !!chipImg,
        chipPhotoSrc: chipImg?.getAttribute("src")?.substring(0, 30),
      };
    });
    console.log("Check 2 Sidebar Photo state:", JSON.stringify(check2Sidebar, null, 2));
    if (!check2Sidebar.hasChipPhoto) {
      throw new Error("Expected sidebar chip to display photo img after upload!");
    }

    // Open reading pane by clicking message row
    await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-testid="message-row"]');
      if (rows.length > 0) rows[0].click();
    });
    await new Promise((r) => setTimeout(r, 800));

    const check2ReadingPane = await page.evaluate(() => {
      const readingAvatarImg = document.querySelector('[data-testid="reading-pane-avatar"] [data-testid="avatar-photo-img"]');
      return {
        hasReadingPhoto: !!readingAvatarImg,
      };
    });
    console.log("Check 2 Reading Pane Photo state:", JSON.stringify(check2ReadingPane, null, 2));
    if (!check2ReadingPane.hasReadingPhoto) {
      throw new Error("Expected reading pane header avatar to display photo img!");
    }

    const activeShotPath = path.join(artifactsDir, "profile_photo_active.png");
    await page.screenshot({ path: activeShotPath });
    console.log("✓ CHECK 2 PASSED: Photo uploaded, encrypted, and displayed across chip and reading pane. Screenshot saved:", activeShotPath);

    // --- CHECK 3: Remove photo in Settings ---
    console.log("\n--- [CHECK 3] Remove photo in Settings → verify fallback returns ---");
    // Open Settings again
    await page.evaluate(() => {
      const settingsBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((el) => el.textContent?.includes("Settings"));
      if (settingsBtns.length > 0) settingsBtns[0].click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Click Remove photo button
    await page.evaluate(() => {
      const removeBtn = document.querySelector('[data-testid="remove-photo-btn"]');
      if (removeBtn) removeBtn.click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    const check3Settings = await page.evaluate(() => {
      const previewInitial = document.querySelector('[data-testid="settings-avatar-preview"] [data-testid="avatar-fallback-initial"]')?.textContent?.trim();
      const removeBtn = document.querySelector('[data-testid="remove-photo-btn"]');
      return {
        previewInitial,
        hasRemoveBtn: !!removeBtn,
      };
    });
    console.log("Check 3 Settings after removal:", JSON.stringify(check3Settings, null, 2));
    if (check3Settings.previewInitial !== "A") {
      throw new Error(`Expected fallback initial 'A' in settings preview, got "${check3Settings.previewInitial}"`);
    }
    if (check3Settings.hasRemoveBtn) {
      throw new Error("Remove photo button must disappear after photo removal!");
    }

    // Close Settings and return to inbox
    await page.evaluate(() => {
      const backBtn = document.querySelector('[data-testid="settings-back-to-inbox-btn"]');
      if (backBtn) backBtn.click();
    });
    await new Promise((r) => setTimeout(r, 800));

    // Verify sidebar chip returns to fallback initial "A"
    const check3Sidebar = await page.evaluate(() => {
      const chipInitial = document.querySelector('[data-testid="account-chip-selector"] [data-testid="avatar-fallback-initial"]')?.textContent?.trim();
      const chipImg = document.querySelector('[data-testid="account-chip-selector"] [data-testid="avatar-photo-img"]');
      return {
        chipInitial,
        hasChipImg: !!chipImg,
      };
    });
    console.log("Check 3 Sidebar after removal:", JSON.stringify(check3Sidebar, null, 2));
    if (check3Sidebar.chipInitial !== "A") {
      throw new Error(`Expected sidebar chip to return to fallback 'A', got "${check3Sidebar.chipInitial}"`);
    }
    if (check3Sidebar.hasChipImg) {
      throw new Error("Sidebar chip must not have img after photo removal!");
    }

    const removedShotPath = path.join(artifactsDir, "profile_photo_removed.png");
    await page.screenshot({ path: removedShotPath });
    console.log("✓ CHECK 3 PASSED: Photo removed, fallback initial 'A' restored everywhere. Screenshot saved:", removedShotPath);

    console.log("\n================================================================================");
    console.log("          ALL PROFILE PHOTO BROWSER VERIFICATION CHECKS PASSED!                 ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runProfilePhotoVerification().catch((err) => {
  console.error("Profile photo browser verification failed:", err);
  process.exit(1);
});
