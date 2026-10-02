import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import * as wasm from "../apps/webmail/src/generated/crypto-core/byos_crypto_core.js";
import {
  preparePathAAttachment,
  decryptPathAAttachment,
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  computeSHA256,
} from "../apps/webmail/src/attachment_crypto.ts";

const API_BASE = "http://127.0.0.1:8080";

function execSql(sql) {
  const cmd = `docker exec byos-postgres psql -U byos -d byos -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function execDocker(cmd) {
  return execSync(`docker exec byos-minio sh -c "${cmd.replace(/"/g, '\\"')}"`, { encoding: "utf8" }).trim();
}

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json };
}

async function main() {
  console.log("=== BYOS Path A Manual Verification Flow ===");

  // Setup Accounts: Alice (sender) and Bob (recipient)
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

  console.log("[Setup] Updating Alice and Bob keys and active sessions in PostgreSQL...");
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Alice.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Alice.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Alice.mailboxId}'`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Bob.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Bob.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Bob.mailboxId}'`);

  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${Alice.userId}', digest('${Alice.token}', 'sha256'), now() + interval '1 day') ON CONFLICT (token_hash) DO NOTHING`);
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${Bob.userId}', digest('${Bob.token}', 'sha256'), now() + interval '1 day') ON CONFLICT (token_hash) DO NOTHING`);

  const aliceHeaders = { "Cookie": `byos_session=${Alice.token}`, "Content-Type": "application/json" };
  const bobHeaders = { "Cookie": `byos_session=${Bob.token}`, "Content-Type": "application/json" };

  // =========================================================================
  // STEP 1: Send a BYOS-to-BYOS message with a 100 KB PDF.
  // =========================================================================
  console.log("\n--- STEP 1: Send BYOS-to-BYOS message with 100 KB PDF ---");
  const pdf100KB = new Uint8Array(100 * 1024);
  const pdfHeader = Buffer.from("%PDF-1.4\n%Manual Verification 100KB\n");
  pdf100KB.set(pdfHeader, 0);
  for (let i = pdfHeader.length; i < pdf100KB.length; i++) {
    pdf100KB[i] = (i * 31 + 17) & 0xff;
  }
  const originalSHA256 = await computeSHA256(pdf100KB);
  console.log(`Original 100 KB PDF size: ${pdf100KB.length} bytes, SHA-256: ${originalSHA256}`);

  const prep1 = await preparePathAAttachment({
    file: { name: "test_report_100kb.pdf", type: "application/pdf", data: pdf100KB },
    senderMailboxId: Alice.mailboxId,
    recipientMailboxId: Bob.mailboxId,
    recipientXWingPkHex: Bob.xwingPkHex,
    senderXWingPkHex: Alice.xwingPkHex,
  });

  console.log(`Uploading ${prep1.recipientChunks.length} recipient chunk and ${prep1.senderChunks.length} sender chunk...`);
  for (const ch of prep1.recipientChunks) {
    const upRes = await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ object_key: ch.storageRef, data: bytesToBase64(ch.data) }),
    });
    if (upRes.status !== 200) throw new Error(`Recipient chunk upload failed: ${upRes.status} ${upRes.text}`);
  }
  for (const ch of prep1.senderChunks) {
    const upRes = await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ object_key: ch.storageRef, data: bytesToBase64(ch.data) }),
    });
    if (upRes.status !== 200) throw new Error(`Sender chunk upload failed: ${upRes.status} ${upRes.text}`);
  }

  const mime1 = "Subject: Manual Test 100KB Attachment\nFrom: alice@byos.local\nTo: bob@byos.local\n\nHello Bob, please find the 100KB security report attached.";
  const mimeHex1 = bytesToHex(Buffer.from(mime1));
  const recEnv1 = wasm.wasm_seal_xwing_envelope_signed(Bob.xwingPkHex, Bob.mailboxId, 1, mimeHex1, Alice.signingSeed);
  const senderEnv1 = wasm.wasm_seal_xwing_envelope_signed(Alice.xwingPkHex, Alice.mailboxId, 1, mimeHex1, Alice.signingSeed);

  const sendRes1 = await apiFetch("/v1/outbound/send-internal", {
    method: "POST",
    headers: aliceHeaders,
    body: JSON.stringify({
      envelope_json: recEnv1,
      sender_envelope_json: senderEnv1,
      recipient: Bob.email,
      sender_mailbox_id: Alice.mailboxId,
      attachment_envelopes: [prep1.recipientEnvelope],
      sender_attachment_envelopes: [prep1.senderEnvelope],
    }),
  });

  if (sendRes1.status !== 201) throw new Error(`Send failed: ${sendRes1.status} ${sendRes1.text}`);
  const msg1Id = sendRes1.json.message_id;
  console.log(`Message delivered securely! message_id: ${msg1Id}, delivery_id: ${sendRes1.json.delivery_id}`);

  // Confirm recipient inbox displays attachment
  const attRes1 = await apiFetch(`/v1/mailboxes/${Bob.mailboxId}/messages/${msg1Id}/attachments`, {
    method: "GET",
    headers: bobHeaders,
  });
  if (attRes1.status !== 200) throw new Error(`Fetch attachments failed: ${attRes1.status} ${attRes1.text}`);
  const bobAttachments1 = attRes1.json.attachments;
  console.log(`Recipient inbox shows ${bobAttachments1.length} attachment(s):`, bobAttachments1[0].filename, `(${bobAttachments1[0].size_bytes} bytes)`);
  if (bobAttachments1.length !== 1 || bobAttachments1[0].size_bytes !== 102400) {
    throw new Error("Recipient inbox attachment count or size mismatch!");
  }
  console.log("✓ STEP 1 PASS: Recipient's inbox successfully received and displays 100 KB PDF attachment.");

  // =========================================================================
  // STEP 2: Download from recipient's inbox. File opens correctly.
  // =========================================================================
  console.log("\n--- STEP 2: Download from recipient inbox & verify plaintext ---");
  const ch0Res = await apiFetch(`/v1/mailboxes/${Bob.mailboxId}/messages/${msg1Id}/attachments/${bobAttachments1[0].attachment_id}/chunks/0`, {
    method: "GET",
    headers: { "Cookie": `byos_session=${Bob.token}` },
  });
  if (ch0Res.status !== 200) throw new Error(`Fetch recipient chunk failed: ${ch0Res.status} ${ch0Res.text}`);
  const recChunkBytes = new Uint8Array(Buffer.from(ch0Res.text, "binary")); // wait, binary or arrayBuffer?

  // Node fetch arrayBuffer
  const ch0ResRaw = await fetch(`${API_BASE}/v1/mailboxes/${Bob.mailboxId}/messages/${msg1Id}/attachments/${bobAttachments1[0].attachment_id}/chunks/0`, {
    headers: { "Cookie": `byos_session=${Bob.token}` },
  });
  const recChunkBuf = new Uint8Array(await ch0ResRaw.arrayBuffer());

  const decBobResult = await decryptPathAAttachment(
    bobAttachments1[0],
    [recChunkBuf],
    Bob.xwingSeed,
    Bob.mailboxId
  );

  if (decBobResult.isCorrupted || !decBobResult.data) {
    throw new Error(`Recipient decryption failed: ${decBobResult.error}`);
  }
  const decBobHash = await computeSHA256(decBobResult.data);
  const matchBob = Buffer.compare(decBobResult.data, pdf100KB) === 0;
  console.log(`Decrypted recipient data size: ${decBobResult.data.length} bytes, SHA-256: ${decBobHash}`);
  console.log(`Byte-for-byte exact match with original PDF: ${matchBob}`);
  if (!matchBob) throw new Error("Recipient decrypted data does NOT match original!");
  console.log("✓ STEP 2 PASS: Download from recipient inbox opens correctly (byte-for-byte match).");

  // =========================================================================
  // STEP 3: Open Sent. Download attachment from Sent copy.
  // =========================================================================
  console.log("\n--- STEP 3: Download from Sent copy & verify fresh encryption ---");
  // Get sender's Sent message ID
  const sentRowId = execSql(`SELECT id FROM message_metadata WHERE mailbox_id='${Alice.mailboxId}' AND folder='sent' ORDER BY received_at DESC LIMIT 1`);
  console.log(`Alice Sent folder message_id: ${sentRowId}`);

  const sentAttRes = await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/messages/${sentRowId}/attachments`, {
    method: "GET",
    headers: aliceHeaders,
  });
  if (sentAttRes.status !== 200) throw new Error(`Fetch Sent attachments failed: ${sentAttRes.status} ${sentAttRes.text}`);
  const sentAttachments = sentAttRes.json.attachments;
  console.log(`Sent copy shows ${sentAttachments.length} attachment(s):`, sentAttachments[0].filename);

  const sentCh0Raw = await fetch(`${API_BASE}/v1/mailboxes/${Alice.mailboxId}/messages/${sentRowId}/attachments/${sentAttachments[0].attachment_id}/chunks/0`, {
    headers: { "Cookie": `byos_session=${Alice.token}` },
  });
  const sentChunkBuf = new Uint8Array(await sentCh0Raw.arrayBuffer());

  const decSentResult = await decryptPathAAttachment(
    sentAttachments[0],
    [sentChunkBuf],
    Alice.xwingSeed,
    Alice.mailboxId
  );

  if (decSentResult.isCorrupted || !decSentResult.data) {
    throw new Error(`Sent decryption failed: ${decSentResult.error}`);
  }
  const matchSent = Buffer.compare(decSentResult.data, pdf100KB) === 0;
  console.log(`Decrypted Sent copy size: ${decSentResult.data.length} bytes, SHA-256: ${await computeSHA256(decSentResult.data)}`);
  console.log(`Byte-for-byte exact match with original PDF: ${matchSent}`);

  const recChunkSHA = crypto.createHash("sha256").update(recChunkBuf).digest("hex");
  const sentChunkSHA = crypto.createHash("sha256").update(sentChunkBuf).digest("hex");
  console.log(`Recipient Chunk Ciphertext SHA-256: ${recChunkSHA}`);
  console.log(`Sender Chunk Ciphertext SHA-256:    ${sentChunkSHA}`);
  console.log(`Ciphertext SHA-256 differ: ${recChunkSHA !== sentChunkSHA}`);

  if (!matchSent) throw new Error("Sent decrypted data does NOT match original!");
  if (recChunkSHA === sentChunkSHA) throw new Error("Sent chunk reused recipient ciphertext!");
  console.log("✓ STEP 3 PASS: Download from Sent copy opens correctly under K_sender.");

  // =========================================================================
  // STEP 4: Send with 5 MB file. Confirm 5 chunks in envelope.
  // =========================================================================
  console.log("\n--- STEP 4: Send 5 MB file & confirm exactly 5 chunks ---");
  const size5MB = 5 * 1024 * 1024;
  const data5MB = new Uint8Array(size5MB);
  for (let i = 0; i < size5MB; i += 4096) {
    data5MB[i] = (i ^ 0x5a) & 0xff;
  }
  console.log(`Preparing 5 MB file (${size5MB} bytes)...`);

  const prep5MB = await preparePathAAttachment({
    file: { name: "dataset_5mb.bin", type: "application/octet-stream", data: data5MB },
    senderMailboxId: Alice.mailboxId,
    recipientMailboxId: Bob.mailboxId,
    recipientXWingPkHex: Bob.xwingPkHex,
    senderXWingPkHex: Alice.xwingPkHex,
  });

  console.log(`Chunk count in recipient envelope: ${prep5MB.recipientEnvelope.chunk_count}`);
  console.log(`Chunks array length: ${prep5MB.recipientEnvelope.chunks.length}`);
  if (prep5MB.recipientEnvelope.chunk_count !== 5 || prep5MB.recipientEnvelope.chunks.length !== 5) {
    throw new Error(`Expected exactly 5 chunks for 5 MB file, got ${prep5MB.recipientEnvelope.chunks.length}`);
  }

  for (let i = 0; i < 5; i++) {
    console.log(`  Chunk ${i}: size_bytes=${prep5MB.recipientEnvelope.chunks[i].size_bytes}, storage_ref=${prep5MB.recipientEnvelope.chunks[i].storage_ref}`);
    // upload recipient chunk
    await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ object_key: prep5MB.recipientChunks[i].storageRef, data: bytesToBase64(prep5MB.recipientChunks[i].data) }),
    });
    // upload sender chunk
    await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
      method: "POST",
      headers: aliceHeaders,
      body: JSON.stringify({ object_key: prep5MB.senderChunks[i].storageRef, data: bytesToBase64(prep5MB.senderChunks[i].data) }),
    });
  }

  const mime2 = "Subject: 5MB Large Attachment Test\nFrom: alice@byos.local\nTo: bob@byos.local\n\n5MB file attached.";
  const mimeHex2 = bytesToHex(Buffer.from(mime2));
  const recEnv2 = wasm.wasm_seal_xwing_envelope_signed(Bob.xwingPkHex, Bob.mailboxId, 1, mimeHex2, Alice.signingSeed);
  const senderEnv2 = wasm.wasm_seal_xwing_envelope_signed(Alice.xwingPkHex, Alice.mailboxId, 1, mimeHex2, Alice.signingSeed);

  const sendRes2 = await apiFetch("/v1/outbound/send-internal", {
    method: "POST",
    headers: aliceHeaders,
    body: JSON.stringify({
      envelope_json: recEnv2,
      sender_envelope_json: senderEnv2,
      recipient: Bob.email,
      sender_mailbox_id: Alice.mailboxId,
      attachment_envelopes: [prep5MB.recipientEnvelope],
      sender_attachment_envelopes: [prep5MB.senderEnvelope],
    }),
  });
  if (sendRes2.status !== 201) throw new Error(`5MB Send failed: ${sendRes2.status} ${sendRes2.text}`);
  const msg2Id = sendRes2.json.message_id;

  const attRes2 = await apiFetch(`/v1/mailboxes/${Bob.mailboxId}/messages/${msg2Id}/attachments`, {
    method: "GET",
    headers: bobHeaders,
  });
  const att5MB = attRes2.json.attachments[0];
  console.log(`Retrieved envelope from recipient inbox: chunk_count=${att5MB.chunk_count}, chunks.length=${att5MB.chunks.length}`);
  if (att5MB.chunk_count !== 5 || att5MB.chunks.length !== 5) {
    throw new Error(`Recipient envelope does not contain 5 chunks!`);
  }

  console.log("Fetching and reassembling all 5 chunks from storage...");
  const downloadedChunks = [];
  for (let i = 0; i < 5; i++) {
    const raw = await fetch(`${API_BASE}/v1/mailboxes/${Bob.mailboxId}/messages/${msg2Id}/attachments/${att5MB.attachment_id}/chunks/${i}`, {
      headers: { "Cookie": `byos_session=${Bob.token}` },
    });
    downloadedChunks.push(new Uint8Array(await raw.arrayBuffer()));
  }

  const dec5MB = await decryptPathAAttachment(att5MB, downloadedChunks, Bob.xwingSeed, Bob.mailboxId);
  if (dec5MB.isCorrupted || !dec5MB.data) throw new Error(`5MB decryption failed: ${dec5MB.error}`);
  const match5MB = Buffer.compare(dec5MB.data, data5MB) === 0;
  console.log(`Decrypted 5 MB data: ${dec5MB.data.length} bytes, exact match: ${match5MB}`);
  if (!match5MB) throw new Error("5MB reassembled data does not match original!");
  console.log("✓ STEP 4 PASS: 5 MB file chunked into exactly 5 chunks, sent, and decrypted byte-for-byte.");

  // =========================================================================
  // STEP 5: Corrupt one chunk in MinIO. Confirm only that attachment shows corrupted.
  // =========================================================================
  console.log("\n--- STEP 5: Corrupt one chunk in MinIO & verify failure isolation ---");
  const dataA = new Uint8Array(50 * 1024).fill(0xaa);
  const dataB = new Uint8Array(50 * 1024).fill(0xbb);

  const prepA = await preparePathAAttachment({
    file: { name: "intact_A.bin", type: "application/octet-stream", data: dataA },
    senderMailboxId: Alice.mailboxId,
    recipientMailboxId: Bob.mailboxId,
    recipientXWingPkHex: Bob.xwingPkHex,
    senderXWingPkHex: Alice.xwingPkHex,
  });

  const prepB = await preparePathAAttachment({
    file: { name: "intact_B.bin", type: "application/octet-stream", data: dataB },
    senderMailboxId: Alice.mailboxId,
    recipientMailboxId: Bob.mailboxId,
    recipientXWingPkHex: Bob.xwingPkHex,
    senderXWingPkHex: Alice.xwingPkHex,
  });

  // Upload A
  await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
    method: "POST",
    headers: aliceHeaders,
    body: JSON.stringify({ object_key: prepA.recipientChunks[0].storageRef, data: bytesToBase64(prepA.recipientChunks[0].data) }),
  });
  await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
    method: "POST",
    headers: aliceHeaders,
    body: JSON.stringify({ object_key: prepA.senderChunks[0].storageRef, data: bytesToBase64(prepA.senderChunks[0].data) }),
  });
  // Upload B
  await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
    method: "POST",
    headers: aliceHeaders,
    body: JSON.stringify({ object_key: prepB.recipientChunks[0].storageRef, data: bytesToBase64(prepB.recipientChunks[0].data) }),
  });
  await apiFetch(`/v1/mailboxes/${Alice.mailboxId}/attachment-chunks`, {
    method: "POST",
    headers: aliceHeaders,
    body: JSON.stringify({ object_key: prepB.senderChunks[0].storageRef, data: bytesToBase64(prepB.senderChunks[0].data) }),
  });

  const mime3 = "Subject: Dual Attachments Isolation Test\nFrom: alice@byos.local\nTo: bob@byos.local\n\nTwo attachments.";
  const mimeHex3 = bytesToHex(Buffer.from(mime3));
  const recEnv3 = wasm.wasm_seal_xwing_envelope_signed(Bob.xwingPkHex, Bob.mailboxId, 1, mimeHex3, Alice.signingSeed);
  const senderEnv3 = wasm.wasm_seal_xwing_envelope_signed(Alice.xwingPkHex, Alice.mailboxId, 1, mimeHex3, Alice.signingSeed);

  const sendRes3 = await apiFetch("/v1/outbound/send-internal", {
    method: "POST",
    headers: aliceHeaders,
    body: JSON.stringify({
      envelope_json: recEnv3,
      sender_envelope_json: senderEnv3,
      recipient: Bob.email,
      sender_mailbox_id: Alice.mailboxId,
      attachment_envelopes: [prepA.recipientEnvelope, prepB.recipientEnvelope],
      sender_attachment_envelopes: [prepA.senderEnvelope, prepB.senderEnvelope],
    }),
  });
  if (sendRes3.status !== 201) throw new Error(`Dual send failed: ${sendRes3.status}`);
  const msg3Id = sendRes3.json.message_id;

  const dualAttRes = await apiFetch(`/v1/mailboxes/${Bob.mailboxId}/messages/${msg3Id}/attachments`, {
    method: "GET",
    headers: bobHeaders,
  });
  const envA = dualAttRes.json.attachments[0];
  const envB = dualAttRes.json.attachments[1];
  console.log(`Recipient received 2 attachments: [0]=${envA.filename}, [1]=${envB.filename}`);

  console.log(`Corrupting MinIO ciphertext for Attachment A (${prepA.recipientChunks[0].storageRef})...`);
  // Corrupt MinIO chunk directly in bucket byos-mailbox
  execDocker(`echo "TAMPERED_CIPHERTEXT_CORRUPTED" | mc pipe local/byos-mailbox/${prepA.recipientChunks[0].storageRef}`);
  console.log("Chunk corrupted in MinIO storage.");

  // Fetch chunk A and chunk B
  const rawChunkA = await fetch(`${API_BASE}/v1/mailboxes/${Bob.mailboxId}/messages/${msg3Id}/attachments/${envA.attachment_id}/chunks/0`, {
    headers: { "Cookie": `byos_session=${Bob.token}` },
  });
  const bufA = new Uint8Array(await rawChunkA.arrayBuffer());

  const rawChunkB = await fetch(`${API_BASE}/v1/mailboxes/${Bob.mailboxId}/messages/${msg3Id}/attachments/${envB.attachment_id}/chunks/0`, {
    headers: { "Cookie": `byos_session=${Bob.token}` },
  });
  const bufB = new Uint8Array(await rawChunkB.arrayBuffer());

  const decA = await decryptPathAAttachment(envA, [bufA], Bob.xwingSeed, Bob.mailboxId);
  const decB = await decryptPathAAttachment(envB, [bufB], Bob.xwingSeed, Bob.mailboxId);

  console.log("Decryption Result for Attachment A:", {
    isCorrupted: decA.isCorrupted,
    error: decA.error,
    filename: decA.filename,
  });
  console.log("Decryption Result for Attachment B:", {
    isCorrupted: decB.isCorrupted,
    dataSize: decB.data?.length,
    filename: decB.filename,
    matchesOriginal: decB.data ? Buffer.compare(decB.data, dataB) === 0 : false,
  });

  if (!decA.isCorrupted) throw new Error("Expected Attachment A to be flagged as corrupted!");
  if (decB.isCorrupted || !decB.data || Buffer.compare(decB.data, dataB) !== 0) {
    throw new Error("Expected Attachment B to decrypt cleanly and uncorrupted!");
  }

  console.log("✓ STEP 5 PASS: Corrupting one chunk in MinIO flags only that attachment as corrupted; second attachment decrypts successfully without error propagation.");

  console.log("\n=======================================================");
  console.log("ALL 5 MANUAL VERIFICATION CHECKS PASSED WITH FULL PROOF!");
  console.log("=======================================================");
}

main().catch((err) => {
  console.error("FATAL ERROR in manual verification:", err);
  process.exit(1);
});
