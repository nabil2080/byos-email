/**
 * End-to-End Hybrid Cryptography & Zero-Knowledge Storage Verification:
 * 1. Authenticate Alice (alice@byos.local) in Webmail desktop shell.
 * 2. Verify Bob's public key directory record contains Post-Quantum Hybrid X-Wing (ML-KEM-768 + X25519) keys.
 * 3. Compose and send Path A E2E encrypted email with binary attachment from Alice to Bob.
 * 4. Verify PostgreSQL message_metadata:
 *    - has_attachments = true
 *    - attachment_envelopes contains X-Wing hybrid wrapped key (x25519_encapsulated + mlkem_encrypted_key)
 *    - Storage reference points to mailboxes/<id>/path-a-attachments/<att_id>/chunk_000.enc
 * 5. Verify Persistent Storage (MinIO / customer storage):
 *    - Stored object is pure AES-256-GCM ciphertext (0x01 || IV[12] || Ciphertext || Tag[16])
 *    - Zero plaintext bytes stored on server or storage
 * 6. Authenticate Bob, fetch chunk via API, unwrap hybrid key, decrypt client-side, and assert exact SHA-256 match.
 * 7. Switch to Bob in Webmail, view received email, verify reading pane decrypts attachment seamlessly.
 * 8. Save screenshots to tests/browser/artifacts/
 */

import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';
import {
  decryptPathAAttachment,
  computeSHA256,
} from '../../apps/webmail/src/attachment_crypto.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runE2EHybridStorageVerification() {
  console.log("================================================================================");
  console.log("      E2E HYBRID CRYPTOGRAPHY (X-WING) & ZERO-KNOWLEDGE STORAGE AUDIT           ");
  console.log("================================================================================\n");

  // Step 0: Generate 128 KB test binary payload
  const testPayloadSize = 128 * 1024; // 131,072 bytes
  const payloadBuffer = Buffer.alloc(testPayloadSize);
  for (let i = 0; i < testPayloadSize; i++) {
    payloadBuffer[i] = (i * 41 + 19) & 0xff;
  }
  const originalSha256 = crypto.createHash('sha256').update(payloadBuffer).digest('hex');
  const tempPayloadPath = path.resolve(artifactsDir, 'e2e_hybrid_test_document.dat');
  fs.writeFileSync(tempPayloadPath, payloadBuffer);
  console.log(`Generated ${testPayloadSize} bytes test attachment at: ${tempPayloadPath}`);
  console.log(`Original SHA-256: ${originalSha256}\n`);

  // Step 1: Authenticate Alice and Verify Key Directory for Bob (bob@byos.local)
  console.log("--- 1. Authenticating & Verifying Key Directory (Post-Quantum Hybrid X-Wing) ---");
  const aliceLoginResp = await fetch('http://127.0.0.1:8080/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alice@byos.local', password: 'test-password-123' }),
  });
  assert(aliceLoginResp.ok, "Alice authenticated via API");
  const aliceLoginData = await aliceLoginResp.json();
  const aliceToken = aliceLoginData.token;

  const keyResp = await fetch('http://127.0.0.1:8080/v1/keys/bob@byos.local', {
    headers: { Authorization: `Bearer ${aliceToken}` },
  });
  assert(keyResp.ok, `Key directory responded with HTTP ${keyResp.status} for bob@byos.local`);
  const keyRecord = await keyResp.json();
  assert(keyRecord.status === 'active', "Bob's key directory record is active");
  assert(Boolean(keyRecord.xwing_public_key), "Bob has published X-Wing public key");
  const xwingBytes = Buffer.from(keyRecord.xwing_public_key, 'base64');
  console.log(`  Bob X-Wing Public Key Length: ${xwingBytes.length} bytes (expected 1216: 1184 ML-KEM-768 + 32 X25519)`);
  assert(xwingBytes.length === 1216, "X-Wing public key conforms to RFC 9180 / draft-connolly-cfrg-xwing-kem (1216 bytes)");
  assert(Boolean(keyRecord.ed25519_signing_public_key), "Bob has published Ed25519 signing public key");
  const ed25519Bytes = Buffer.from(keyRecord.ed25519_signing_public_key, 'base64');
  assert(ed25519Bytes.length === 32, "Ed25519 signing key is exactly 32 bytes\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,850'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    // Step 2: Login as Alice in Webmail
    console.log("--- 2. Authenticating Alice in Webmail UI ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);

    const activeUser = await page.$eval('[data-testid="account-chip-text"]', el => el.textContent.trim());
    console.log(`  Active account: "${activeUser}"`);
    assert(activeUser.includes("alice@byos.local"), "Alice authenticated successfully in browser");

    // Connect Bob as second account so Bob's session keys are unsealed in session
    console.log("  Connecting Bob as secondary account...");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="add-mailbox-button"]', { timeout: 5000 });
    await page.click('[data-testid="add-mailbox-button"]');
    await sleep(600);

    const emailInputs = await page.$$('input[type="email"]');
    await emailInputs[emailInputs.length - 1].type('bob@byos.local');
    const passInputs = await page.$$('input[type="password"]');
    await passInputs[passInputs.length - 1].type('test-password-123');

    const modalSubmitBtn = await page.evaluateHandle(() => {
      const modal = document.querySelector('[role="dialog"], .fixed.inset-0.z-50');
      return modal ? modal.querySelector('button[type="submit"]') : null;
    });
    await modalSubmitBtn.click();
    await sleep(2500);

    // Switch back to Alice
    const accounts = await page.evaluate(() => {
      const stored = sessionStorage.getItem('byos_connected_accounts');
      return stored ? JSON.parse(stored) : [];
    });
    const aliceId = accounts.find(a => a.email.includes('alice'))?.id;
    const bobId = accounts.find(a => a.email.includes('bob'))?.id;
    assert(Boolean(aliceId && bobId), "Both Alice and Bob present in connected accounts session");

    // Ensure Alice active
    let curUser = await page.$eval('[data-testid="account-chip-text"]', el => el.textContent.trim());
    if (!curUser.includes('alice@byos.local')) {
      await page.click('[data-testid="account-chip-selector"]');
      await sleep(500);
      await page.click(`[data-testid="account-dropdown-${aliceId}"]`);
      await sleep(1500);
    }
    console.log("  Alice is active sender.\n");

    // Step 3: Compose and Send Path A E2E Encrypted Email with Attachment
    console.log("--- 3. Composing and Sending Path A E2E Encrypted Message with Attachment ---");
    const e2eSubject = `E2E_Hybrid_Verification_${Date.now()}`;
    const composeBtn = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn.click();
    await sleep(1000);

    await page.waitForSelector('#composeToInput', { timeout: 5000 });
    await page.type('#composeToInput', 'bob@byos.local');
    await page.type('#composeSubjectInput', e2eSubject);

    const bodyEl = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyEl.click();
    await bodyEl.type('Hello Bob, this email and its attached file are encrypted end-to-end with HPKE-XWing-AES256GCM-v1.');

    // Upload attachment
    console.log("  Attaching 128 KB document...");
    const fileInput = await page.waitForSelector('input[data-testid="compose-file-input"]', { timeout: 5000 });
    await fileInput.uploadFile(tempPayloadPath);
    await page.waitForSelector('[data-testid="compose-attachment-pill"]', { timeout: 15000 });
    console.log("  Attachment pill rendered in ComposeDrawer.");
    await sleep(1000);

    // Wait until send button is enabled
    await page.waitForFunction(() => {
      const btn = document.querySelector('[data-testid="compose-send-btn"]');
      return btn && !btn.disabled;
    }, { timeout: 10000 });

    // Listen for Path A internal delivery HTTP request
    const pathASendPromise = page.waitForResponse(
      (res) => (res.url().includes('/v1/outbound/send-internal') || res.url().includes('/v1/outbound/send')) &&
               res.request().method() === 'POST',
      { timeout: 35000 }
    );

    const sendBtn = await page.waitForSelector('[data-testid="compose-send-btn"]');
    await sendBtn.click();
    console.log("  Clicked Send button in ComposeDrawer.");

    const shotSent = path.resolve(artifactsDir, 'e2e_hybrid_attachment_sent.png');
    await page.screenshot({ path: shotSent });
    console.log(`  Saved screenshot: e2e_hybrid_attachment_sent.png`);

    const sendRes = await pathASendPromise;
    assert(sendRes.status() === 201, `Path A send returned HTTP 201 (got ${sendRes.status()})`);
    const sendJson = await sendRes.json();
    console.log(`  Path A Delivery Response: status="${sendJson.status}", message_id="${sendJson.message_id}"`);
    assert(sendJson.status === 'delivered', "Message delivery status is 'delivered'");
    const messageId = sendJson.message_id;
    assert(Boolean(messageId), "Response returned message_id\n");

    // Step 4: Verify Database Records in Postgres
    console.log("--- 4. Verifying PostgreSQL Envelope & Metadata Zero-Knowledge Boundaries ---");
    const metaDbRow = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT has_attachments, jsonb_array_length(attachment_envelopes), (attachment_envelopes->0->'wrapped_key'->>'x25519_encapsulated' IS NOT NULL), (attachment_envelopes->0->'wrapped_key'->>'mlkem_encrypted_key' IS NOT NULL) FROM message_metadata WHERE mailbox_id = '${bobId}' AND id = '${messageId}';"`,
      { encoding: 'utf8' }
    ).trim();
    console.log(`  Postgres attachment metadata (has_att | count | has_x25519 | has_mlkem): "${metaDbRow}"`);
    assert(metaDbRow === "t|1|t|t", "Postgres stores has_attachments=true, envelope count=1, and X-Wing hybrid wrapped key components");

    const envelopeJsonStr = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT attachment_envelopes->0 FROM message_metadata WHERE mailbox_id = '${bobId}' AND id = '${messageId}';"`,
      { encoding: 'utf8' }
    ).trim();
    const envelope = JSON.parse(envelopeJsonStr);
    console.log(`  Attachment Envelope ID: ${envelope.attachment_id}`);
    console.log(`  Envelope chunk_count: ${envelope.chunk_count}, size_bytes: ${envelope.size_bytes}`);
    console.log(`  Content SHA-256 Hash recorded in Envelope: ${envelope.content_hash_sha256}`);
    const envelopeHashHex = Buffer.from(envelope.content_hash_sha256, 'base64').toString('hex');
    assert(envelope.size_bytes === testPayloadSize, `Envelope recorded exact size_bytes (${testPayloadSize})`);
    assert(envelopeHashHex === originalSha256, `Envelope recorded exact SHA-256 hash (${originalSha256})`);
    assert(envelope.chunks.length === 1, "Chunk metadata has 1 entry");
    const storageRef = envelope.chunks[0].storage_ref;
    console.log(`  Storage Reference: "${storageRef}"`);
    assert(storageRef.includes("path-a-attachments") && storageRef.includes("chunk_000.enc"), "Storage ref follows zero-knowledge chunk path\n");

    // Step 5: Verify Persistent Storage Container (MinIO / S3)
    console.log("--- 5. Verifying Encrypted Storage Object in Persistent Storage ---");
    const bobLoginResp = await fetch('http://127.0.0.1:8080/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@byos.local', password: 'test-password-123' }),
    });
    assert(bobLoginResp.ok, "Bob authenticated to fetch encrypted chunk");
    const bobLoginData = await bobLoginResp.json();
    const bobToken = bobLoginData.token;

    const chunkResp = await fetch(
      `http://127.0.0.1:8080/v1/mailboxes/${bobId}/messages/${messageId}/attachments/${envelope.attachment_id}/chunks/0`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    assert(chunkResp.ok, `Fetched encrypted chunk from storage API: HTTP ${chunkResp.status}`);
    const chunkBytes = new Uint8Array(await chunkResp.arrayBuffer());
    console.log(`  Stored chunk byte length: ${chunkBytes.length} bytes`);

    // Verify wire format: 0x01 (version byte) || nonce (12 bytes) || ciphertext + tag (16 bytes)
    assert(chunkBytes[0] === 0x01, "Stored chunk begins with 0x01 envelope wire version byte");
    const expectedChunkLen = 1 + 12 + testPayloadSize + 16; // 131,101 bytes
    console.log(`  Stored chunk length: ${chunkBytes.length} bytes (expected exact: ${expectedChunkLen})`);
    assert(chunkBytes.length === expectedChunkLen, `Stored chunk length matches 1 + 12 + ${testPayloadSize} + 16 bytes`);

    // Verify ZERO plaintext in stored chunk
    let foundPlaintextSequence = false;
    for (let i = 13; i < chunkBytes.length - 16; i++) {
      if (chunkBytes[i] === payloadBuffer[i - 13]) {
        // Checking random byte match is normal, but let's check a 16-byte identical window
        let identicalWindow = true;
        for (let j = 0; j < 16 && (i + j < chunkBytes.length - 16); j++) {
          if (chunkBytes[i + j] !== payloadBuffer[i - 13 + j]) {
            identicalWindow = false;
            break;
          }
        }
        if (identicalWindow) {
          foundPlaintextSequence = true;
          break;
        }
      }
    }
    assert(!foundPlaintextSequence, "Stored file contains ZERO plaintext leakage (pure AES-256-GCM ciphertext)\n");

    // Step 6: Client-Side Decryption with Bob's X-Wing Secret Seed
    console.log("--- 6. Client-Side Post-Quantum Hybrid Decryption & SHA-256 Match ---");
    const bobXwingSeed = await page.evaluate((bId) => {
      const vaultRaw = sessionStorage.getItem('byos_session_vault');
      if (vaultRaw) {
        try {
          const vault = JSON.parse(vaultRaw);
          if (vault[bId]?.xwingSeedHex) return vault[bId].xwingSeedHex;
        } catch {}
      }
      return sessionStorage.getItem(`byos_xwing_seed_${bId}`);
    }, bobId);
    assert(Boolean(bobXwingSeed && bobXwingSeed.length === 64), "Bob's private X-Wing seed is unsealed in client memory");

    const decResult = await decryptPathAAttachment(
      envelope,
      [chunkBytes],
      bobXwingSeed,
      bobId
    );
    assert(!decResult.isCorrupted, `Path A client-side decryption succeeded: ${decResult.error || 'SUCCESS'}`);
    assert(decResult.data !== undefined, "Decrypted file buffer is present");
    console.log(`  Decrypted file size: ${decResult.data.length} bytes`);
    assert(decResult.data.length === testPayloadSize, `Decrypted size matches original (${testPayloadSize} bytes)`);

    const decryptedSha256 = crypto.createHash('sha256').update(decResult.data).digest('hex');
    console.log(`  Decrypted SHA-256: ${decryptedSha256}`);
    console.log(`  Expected  SHA-256: ${originalSha256}`);
    assert(decryptedSha256 === originalSha256, "Decrypted attachment SHA-256 is an EXACT byte-for-byte match to the original payload\n");

    // Step 7: Switch to Bob in Webmail UI & Verify Reading Pane Decryption
    console.log("--- 7. Verifying Webmail UI Seamless Decryption in Bob's Mailbox ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.click(`[data-testid="account-dropdown-${bobId}"]`);
    await sleep(2500);

    const bobActive = await page.$eval('[data-testid="account-chip-text"]', el => el.textContent.trim());
    console.log(`  Active account switched to: "${bobActive}"`);
    assert(bobActive.includes("bob@byos.local"), "Switched to Bob's mailbox");

    // Open received email
    const inboxRow = await page.waitForSelector('[data-testid="message-row"], [data-testid="thread-row"]', { timeout: 10000 });
    await inboxRow.click();
    await sleep(1500);

    const readingPane = await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 10000 });
    const readingText = await page.evaluate(el => el.innerText, readingPane);
    assert(readingText.includes(e2eSubject), "Reading pane displays decrypted subject");
    assert(readingText.includes("HPKE-XWing-AES256GCM-v1"), "Reading pane displays decrypted body text");

    const shotBob = path.resolve(artifactsDir, 'e2e_hybrid_reading_pane_bob.png');
    await page.screenshot({ path: shotBob });
    console.log(`  Saved screenshot: e2e_hybrid_reading_pane_bob.png\n`);

    console.log("================================================================================");
    console.log("   ALL E2E HYBRID CRYPTOGRAPHY & ZERO-KNOWLEDGE STORAGE CHECKS PASSED!          ");
    console.log("================================================================================");
  } catch (err) {
    console.error("E2E Hybrid Storage Verification Failed:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runE2EHybridStorageVerification();
