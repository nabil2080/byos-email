import { execSync } from "node:child_process";
import crypto from "node:crypto";
import * as wasm from "../apps/webmail/src/generated/crypto-core/byos_crypto_core.js";

const API_BASE = "http://127.0.0.1:8080";

const Alice = {
  userId: "cccccccc-0000-0000-0000-000000000002",
  mailboxId: "c0000000-0000-0000-0000-000000000001",
  email: "alice@byos.local",
  token: "alice_manual_test_session_token_123",
  xwingSeed: "ea01f553ee1988202f1c41f1d3d478afdf7ef0cddf611a28d2e3c2c3af42b13a",
  signingSeed: "006848f2e6583e34ab8a011d53b48f167c3bb3b50b7f59aa5fef669be8d99eff",
};

const Bob = {
  userId: "cccccccc-0000-0000-0000-000000000003",
  mailboxId: "c0000000-0000-0000-0000-000000000002",
  email: "bob@byos.local",
  token: "bob_manual_test_session_token_123",
  xwingSeed: "f74ba1810c540588f4ccce97eaa0efc82937c060c63453496147d6430183e376",
  signingSeed: "d2f874cbca57aa4df01b579d5fa48a8c3358721f0a73ede153fabadc9c4ee59a",
};

Alice.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Alice.xwingSeed);
Alice.signingPkHex = wasm.wasm_signing_public_key_from_seed(Alice.signingSeed);
Bob.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Bob.xwingSeed);
Bob.signingPkHex = wasm.wasm_signing_public_key_from_seed(Bob.signingSeed);

function execSql(sql) {
  return execSync("docker exec -i byos-postgres psql -U byos -d byos", { input: sql, encoding: "utf8" }).trim();
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

async function computeSHA256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
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

function wrapAttachmentKey(contentKey, recipientXWingPkHex, mailboxId) {
  const contentKeyHex = bytesToHex(contentKey);
  const envelopeJson = wasm.wasm_seal_xwing_envelope(
    recipientXWingPkHex,
    mailboxId,
    1,
    contentKeyHex
  );
  const env = JSON.parse(envelopeJson);
  const encBytes = base64ToBytes(env.enc);
  const nonceBytes = base64ToBytes(env.nonce);
  const ctBytes = base64ToBytes(env.ciphertext);

  const ctM = encBytes.slice(0, 1088);
  const ctX = encBytes.slice(1088);
  const mlkemCombined = new Uint8Array(1088 + nonceBytes.length + ctBytes.length);
  mlkemCombined.set(ctM, 0);
  mlkemCombined.set(nonceBytes, 1088);
  mlkemCombined.set(ctBytes, 1088 + nonceBytes.length);

  return {
    x25519_encapsulated: bytesToBase64(ctX),
    mlkem_encrypted_key: bytesToBase64(mlkemCombined),
  };
}

function encryptChunk(chunkPlaintext, contentKey, iv) {
  const cipher = crypto.createCipheriv("aes-256-gcm", contentKey, iv);
  const ct = Buffer.concat([cipher.update(chunkPlaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const ciphertextWithTag = Buffer.concat([ct, tag]);

  const out = new Uint8Array(1 + 12 + ciphertextWithTag.length);
  out[0] = 0x01; // Version 1
  out.set(iv, 1);
  out.set(ciphertextWithTag, 13);
  return out;
}

const CHUNK_SIZE = 1024 * 1024; // 1 MB

async function preparePathAAttachment(params) {
  const fileData = params.file.data;
  const attachmentId = crypto.randomUUID();
  const contentHash = await computeSHA256(fileData);

  const chunkSlices = [];
  if (fileData.length === 0) {
    chunkSlices.push(new Uint8Array(0));
  } else {
    for (let offset = 0; offset < fileData.length; offset += CHUNK_SIZE) {
      chunkSlices.push(fileData.subarray(offset, Math.min(offset + CHUNK_SIZE, fileData.length)));
    }
  }

  // 1. Recipient encryption
  const recipientKey = crypto.randomBytes(32);
  const recipientBaseIV = crypto.randomBytes(12);
  const recipientChunks = [];
  const recipientMetaChunks = [];

  for (let i = 0; i < chunkSlices.length; i++) {
    const chunkIV = crypto.randomBytes(12);
    const encChunk = encryptChunk(chunkSlices[i], recipientKey, chunkIV);
    const paddedIndex = String(i).padStart(3, "0");
    const storageRef = `mailboxes/${params.senderMailboxId}/path-a-attachments/${attachmentId}/chunk_${paddedIndex}.enc`;

    recipientChunks.push({
      index: i,
      storageRef,
      data: encChunk,
    });
    recipientMetaChunks.push({
      index: i,
      storage_ref: storageRef,
      size_bytes: encChunk.length,
    });
  }

  const recWrappedKey = wrapAttachmentKey(
    recipientKey,
    params.recipientXWingPkHex,
    params.recipientMailboxId
  );

  const recipientEnvelope = {
    attachment_id: attachmentId,
    filename: params.file.name,
    mime_type: params.file.type || "application/octet-stream",
    size_bytes: fileData.length,
    iv: bytesToBase64(recipientBaseIV),
    wrapped_key: recWrappedKey,
    content_hash_sha256: contentHash,
    chunk_count: chunkSlices.length,
    chunks: recipientMetaChunks,
  };

  // 2. Sender sent copy encryption (distinct key K_sender)
  const senderKey = crypto.randomBytes(32);
  const senderBaseIV = crypto.randomBytes(12);
  const senderChunks = [];
  const senderMetaChunks = [];

  for (let i = 0; i < chunkSlices.length; i++) {
    const chunkIV = crypto.randomBytes(12);
    const encChunk = encryptChunk(chunkSlices[i], senderKey, chunkIV);
    const paddedIndex = String(i).padStart(3, "0");
    const sentMsgId = params.messageId || attachmentId;
    const storageRef = `mailboxes/${params.senderMailboxId}/sent-attachments/${sentMsgId}/${attachmentId}/chunk_${paddedIndex}.enc`;

    senderChunks.push({
      index: i,
      storageRef,
      data: encChunk,
    });
    senderMetaChunks.push({
      index: i,
      storage_ref: storageRef,
      size_bytes: encChunk.length,
    });
  }

  const sendWrappedKey = wrapAttachmentKey(
    senderKey,
    params.senderXWingPkHex,
    params.senderMailboxId
  );

  const senderEnvelope = {
    attachment_id: attachmentId,
    filename: params.file.name,
    mime_type: params.file.type || "application/octet-stream",
    size_bytes: fileData.length,
    iv: bytesToBase64(senderBaseIV),
    wrapped_key: sendWrappedKey,
    content_hash_sha256: contentHash,
    chunk_count: chunkSlices.length,
    chunks: senderMetaChunks,
  };

  return {
    recipientEnvelope,
    recipientChunks,
    senderEnvelope,
    senderChunks,
  };
}

async function uploadChunks(uploaderMailboxId, uploaderToken, chunks) {
  for (const ch of chunks) {
    const res = await apiFetch(`/v1/mailboxes/${uploaderMailboxId}/attachment-chunks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${uploaderToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        object_key: ch.storageRef,
        data: bytesToBase64(ch.data),
      }),
    });
    if (res.status !== 200) {
      throw new Error(`Chunk upload failed: ${res.status} ${res.text} for ${ch.storageRef}`);
    }
  }
}

async function seedMessage(opts) {
  const senderIsAlice = opts.folder === "sent";
  const sender = senderIsAlice ? Alice : Bob;
  const recipient = senderIsAlice ? Bob : Alice;

  const recipientAttachmentEnvelopes = [];
  const senderAttachmentEnvelopes = [];

  if (opts.attachments && opts.attachments.length > 0) {
    for (const att of opts.attachments) {
      const prep = await preparePathAAttachment({
        file: { name: att.filename, type: att.contentType, data: att.data },
        senderMailboxId: sender.mailboxId,
        recipientMailboxId: recipient.mailboxId,
        recipientXWingPkHex: recipient.xwingPkHex,
        senderXWingPkHex: sender.xwingPkHex,
      });

      await uploadChunks(sender.mailboxId, sender.token, prep.recipientChunks);
      await uploadChunks(sender.mailboxId, sender.token, prep.senderChunks);

      recipientAttachmentEnvelopes.push(prep.recipientEnvelope);
      senderAttachmentEnvelopes.push(prep.senderEnvelope);
    }
  }

  const mimeHex = bytesToHex(Buffer.from(opts.mimeContent, "utf8"));
  const recEnv = wasm.wasm_seal_xwing_envelope_signed(
    recipient.xwingPkHex,
    recipient.mailboxId,
    1,
    mimeHex,
    sender.signingSeed
  );
  const senderEnv = wasm.wasm_seal_xwing_envelope_signed(
    sender.xwingPkHex,
    sender.mailboxId,
    1,
    mimeHex,
    sender.signingSeed
  );

  const sendPayload = {
    envelope_json: recEnv,
    sender_envelope_json: senderEnv,
    recipient: recipient.email,
    sender_mailbox_id: sender.mailboxId,
  };

  if (recipientAttachmentEnvelopes.length > 0) {
    sendPayload.attachment_envelopes = recipientAttachmentEnvelopes;
    sendPayload.sender_attachment_envelopes = senderAttachmentEnvelopes;
  }

  const sendRes = await apiFetch("/v1/outbound/send-internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sender.token}`,
    },
    body: JSON.stringify(sendPayload),
  });

  if (sendRes.status !== 201) {
    throw new Error(`Failed to send seed message "${opts.subject}": ${sendRes.status} ${sendRes.text}`);
  }

  const msgId = sendRes.json.message_id;

  // Update message_metadata in PostgreSQL
  const fullSender = `${opts.senderDisplay} <${opts.senderAddress}>`;
  const folder = opts.folder || "inbox";
  const isRead = opts.isRead ? "true" : "false";
  const isStarred = opts.isStarred ? "true" : "false";
  const categoryClause = opts.category ? `, category_override = '${opts.category}'` : "";
  const msgIdClause = opts.messageIdHeader ? `, message_id = '${opts.messageIdHeader}'` : "";
  const inReplyToClause = opts.inReplyTo ? `, in_reply_to = '${opts.inReplyTo}'` : "";
  const threadClause = opts.threadId ? `, thread_id = '${opts.threadId}'` : "";
  const dateInterval = opts.dateOffsetMs !== undefined ? `now() - interval '${Math.max(0, Math.round(opts.dateOffsetMs / 1000))} seconds'` : "now()";

  const updateSql = `
    UPDATE message_metadata
    SET sender = '${fullSender.replace(/'/g, "''")}',
        folder = '${folder}',
        is_read = ${isRead},
        is_starred = ${isStarred},
        received_at = ${dateInterval}
        ${categoryClause}
        ${msgIdClause}
        ${inReplyToClause}
        ${threadClause}
    WHERE id = '${msgId}';
  `;

  execSql(updateSql);
  return msgId;
}

// Generate realistic mock PDF bytes
function generateMockPdf(title, sizeBytes) {
  const buf = new Uint8Array(sizeBytes);
  const header = Buffer.from(`%PDF-1.4\n%${title}\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  buf.set(header, 0);
  for (let i = header.length; i < sizeBytes - 32; i++) {
    buf[i] = (i * 37 + 19) & 0xff;
  }
  const trailer = Buffer.from("\n%%EOF\n");
  buf.set(trailer, sizeBytes - trailer.length);
  return buf;
}

// Generate realistic mock PNG bytes
function generateMockPng(width, height, sizeBytes) {
  const buf = new Uint8Array(sizeBytes);
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  buf.set(sig, 0);
  // IHDR chunk
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); // length
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  ihdr[16] = 8; // bit depth
  ihdr[17] = 6; // truecolor with alpha
  ihdr[18] = 0; // deflate
  ihdr[19] = 0; // filter
  ihdr[20] = 0; // interlace
  ihdr.writeUInt32BE(0x12345678, 21); // dummy CRC
  buf.set(ihdr, 8);

  for (let i = 33; i < sizeBytes - 12; i++) {
    buf[i] = (i * 17 + 23) & 0xff;
  }

  // IEND chunk
  const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  buf.set(iend, sizeBytes - 12);
  return buf;
}

// Generate realistic mock ZIP bytes
function generateMockZip(comment, sizeBytes) {
  const buf = new Uint8Array(sizeBytes);
  // Local file header signature: PK\x03\x04
  buf.set([0x50, 0x4b, 0x03, 0x04], 0);
  for (let i = 4; i < sizeBytes - 22; i++) {
    buf[i] = (i * 41 + 13) & 0xff;
  }
  // End of central directory record signature: PK\x05\x06
  buf.set([0x50, 0x4b, 0x05, 0x06], sizeBytes - 22);
  return buf;
}

async function main() {
  console.log("================================================================================");
  console.log("BYOS Full Dummy Email Seeder — All Variations");
  console.log("================================================================================");

  // 1. Ensure sessions & cryptographic keys
  console.log("[1/4] Ensuring active user sessions and public keys in PostgreSQL...");
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${Alice.userId}', digest('${Alice.token}', 'sha256'), now() + interval '7 days') ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '7 days';`);
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${Bob.userId}', digest('${Bob.token}', 'sha256'), now() + interval '7 days') ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '7 days';`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Alice.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Alice.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Alice.mailboxId}'`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Bob.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Bob.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Bob.mailboxId}'`);

  // Clear previous test messages for Alice so inbox is pristine with seeded variations
  console.log("[2/4] Resetting previous messages and drafts for Alice...");
  execSql(`DELETE FROM message_metadata WHERE mailbox_id = '${Alice.mailboxId}';`);
  execSql(`DELETE FROM drafts WHERE mailbox_id = '${Alice.mailboxId}';`);

  console.log("[3/4] Seeding 20 diverse dummy email variations...");

  // ===========================================================================
  // 1. GitHub Security Advisory (Newsletter, RFC 2369 & 8058 One-Click, Code blocks)
  // ===========================================================================
  console.log("  → 1. GitHub Security Advisory (RFC 2369 / 8058 One-Click, syntax highlighted code)");
  const ghsaHtml = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 680px; color: #1f2328; line-height: 1.5;">
  <div style="border-bottom: 1px solid #d0d7de; padding-bottom: 12px; margin-bottom: 16px;">
    <h2 style="margin: 0; color: #1f2328; font-size: 20px;">[Security Advisory] Critical vulnerability GHSA-798x-w497-2856 in jsonwebtoken</h2>
    <div style="margin-top: 8px;">
      <span style="background-color: #cf222e; color: #ffffff; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: bold;">CRITICAL 9.8</span>
      <span style="margin-left: 8px; color: #656d76; font-size: 12px; font-family: monospace;">CVE-2026-38291</span>
    </div>
  </div>
  <p>A verification bypass vulnerability has been identified in <code>jsonwebtoken</code> prior to version <code>9.0.2</code> when validating asymmetric signatures under specific algorithm confusion scenarios.</p>
  <h3 style="font-size: 15px; margin-top: 20px;">Remediation</h3>
  <p>Upgrade to version <strong>9.0.2</strong> or later immediately:</p>
  <pre style="background: #f6f8fa; border: 1px solid #d0d7de; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px;"><code>npm install jsonwebtoken@9.0.2 --save-exact</code></pre>
  <h3 style="font-size: 15px; margin-top: 20px;">References</h3>
  <ul>
    <li><a href="https://github.com/advisories/GHSA-798x-w497-2856" style="color: #0969da;">GitHub Advisory Database: GHSA-798x-w497-2856</a></li>
    <li><a href="https://nvd.nist.gov/vuln/detail/CVE-2026-38291" style="color: #0969da;">NIST National Vulnerability Database</a></li>
  </ul>
  <hr style="border: none; border-top: 1px solid #d0d7de; margin-top: 28px;" />
  <p style="font-size: 11px; color: #656d76;">
    You are receiving this because you watch security alerts on your repository.
    <a href="https://github.com/notifications/unsubscribe/ghsa-798x-w497-2856" style="color: #0969da;">Unsubscribe from this advisory</a>.
  </p>
</div>`;

  await seedMessage({
    senderDisplay: "GitHub Security",
    senderAddress: "notifications@github.com",
    recipientAddress: Alice.email,
    subject: "[Security Advisory] Critical vulnerability GHSA-798x-w497-2856 in jsonwebtoken",
    mimeContent: [
      "Subject: [Security Advisory] Critical vulnerability GHSA-798x-w497-2856 in jsonwebtoken",
      "From: GitHub Security <notifications@github.com>",
      `To: ${Alice.email}`,
      "List-Id: <security-advisories.github.com>",
      "List-Unsubscribe: <https://github.com/notifications/unsubscribe/ghsa-798x-w497-2856>, <mailto:unsub-ghsa@github.com?subject=unsubscribe>",
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
      "Content-Type: text/html; charset=utf-8",
      "",
      ghsaHtml,
    ].join("\n"),
    category: "newsletters",
    isRead: false,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 30, // 30 mins ago
  });

  // ===========================================================================
  // 2. The Pragmatic Engineer (Newsletter, Substack unsubscribe, Starred)
  // ===========================================================================
  console.log("  → 2. The Pragmatic Engineer (Newsletter, Substack unsubscribe, Starred, Read)");
  const peHtml = `
<div style="font-family: Georgia, serif; max-width: 640px; color: #292929; line-height: 1.6; font-size: 16px;">
  <h1 style="font-size: 26px; line-height: 1.3; color: #111;">State of Software Engineering Compensation in 2026</h1>
  <p style="color: #757575; font-size: 13px; font-family: sans-serif;">By Gergely Orosz • Nov 7, 2026 • 8 min read</p>
  <p>Welcome to this week's issue of The Pragmatic Engineer. Today we examine findings from our annual compensation survey of 4,200 tech professionals across North America, Europe, and Asia-Pacific.</p>
  <h3 style="font-family: sans-serif; font-size: 18px; margin-top: 24px;">Key Takeaways:</h3>
  <ol>
    <li><strong>Staff & Principal Engineering:</strong> Total compensation has stabilized with higher proportions of base pay and transparent milestone vesting.</li>
    <li><strong>Zero-Knowledge & Cryptography Premium:</strong> Engineers specializing in post-quantum algorithms (ML-KEM, SLH-DSA) and authenticated enclaves see 20-25% higher offers.</li>
    <li><strong>Return-to-Office Divergence:</strong> High-performing distributed organizations continue to win top senior talent over rigid mandate models.</li>
  </ol>
  <hr style="border: 0; border-top: 1px solid #e5e5e5; margin: 32px 0 16px 0;" />
  <p style="font-size: 12px; color: #888; font-family: sans-serif;">
    You're receiving this email because you subscribed to The Pragmatic Engineer.
    <a href="https://pragmaticengineer.com/unsubscribe?token=pe_sub_992182" style="color: #a27561;">Unsubscribe here</a>.
  </p>
</div>`;

  await seedMessage({
    senderDisplay: "Gergely Orosz",
    senderAddress: "newsletter@pragmaticengineer.com",
    recipientAddress: Alice.email,
    subject: "The Pulse: State of Software Engineering Compensation in 2026",
    mimeContent: [
      "Subject: The Pulse: State of Software Engineering Compensation in 2026",
      "From: Gergely Orosz <newsletter@pragmaticengineer.com>",
      `To: ${Alice.email}`,
      "List-Id: <newsletter.pragmaticengineer.com>",
      "List-Unsubscribe: <https://pragmaticengineer.com/unsubscribe?token=pe_sub_992182>",
      "Content-Type: text/html; charset=utf-8",
      "",
      peHtml,
    ].join("\n"),
    category: "newsletters",
    isRead: true,
    isStarred: true,
    dateOffsetMs: 1000 * 60 * 180, // 3 hours ago
  });

  // ===========================================================================
  // 3. TLDR Tech Daily Digest (Newsletter, Mailto Unsubscribe)
  // ===========================================================================
  console.log("  → 3. TLDR Daily Tech (Newsletter, Mailto unsubscribe, Unread)");
  const tldrHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #222; font-size: 14px; line-height: 1.5;">
  <div style="background: #000; color: #fff; padding: 12px 16px; border-radius: 8px 8px 0 0;">
    <h2 style="margin: 0; font-size: 18px; font-weight: bold; letter-spacing: 1px;">TLDR TECH 2026-11-07</h2>
  </div>
  <div style="border: 1px solid #e2e8f0; border-top: none; padding: 16px; border-radius: 0 0 8px 8px;">
    <h3 style="color: #a27561; margin-top: 0;">HEADLINES & TRENDS</h3>
    <p><strong>IETF Finalizes Post-Quantum Hybrid TLS 1.3 RFC (3 min read)</strong><br/>
    The Internet Engineering Task Force has ratified the final standard for X-Wing and ML-KEM-768 hybrid key encapsulation, standardizing post-quantum security across consumer browsers.</p>
    <p><strong>Next-Gen Autonomous Agent Orchestration (4 min read)</strong><br/>
    DeepMind and partner labs unveil coordinated agent ecosystems featuring isolated sandboxes and zero-knowledge memory safety.</p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
    <p style="font-size: 11px; color: #64748b;">
      To unsubscribe via email, click <a href="mailto:unsubscribe@tldr.tech?subject=unsub_49201">here</a> or email unsubscribe@tldr.tech.
    </p>
  </div>
</div>`;

  await seedMessage({
    senderDisplay: "TLDR Tech",
    senderAddress: "dan@tldr.tech",
    recipientAddress: Alice.email,
    subject: "TLDR Tech 2026-11-07: Anthropic release, Post-Quantum TLS 1.3 RFC, and Linux 6.18 kernel",
    mimeContent: [
      "Subject: TLDR Tech 2026-11-07: Anthropic release, Post-Quantum TLS 1.3 RFC, and Linux 6.18 kernel",
      "From: TLDR Tech <dan@tldr.tech>",
      `To: ${Alice.email}`,
      "List-Id: <daily.tldr.tech>",
      "List-Unsubscribe: <mailto:unsubscribe@tldr.tech?subject=unsub_49201>",
      "Content-Type: text/html; charset=utf-8",
      "",
      tldrHtml,
    ].join("\n"),
    category: "newsletters",
    isRead: false,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 360, // 6 hours ago
  });

  // ===========================================================================
  // 4. Stripe Billing Receipt (Subscription / Invoicing table)
  // ===========================================================================
  console.log("  → 4. Stripe Billing Receipt (Receipt Table, Currency formatting, Read)");
  const stripeHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 580px; color: #374151; font-size: 14px; line-height: 1.6;">
  <div style="border-bottom: 2px solid #635bff; padding-bottom: 8px; margin-bottom: 20px;">
    <h2 style="margin: 0; color: #111827; font-size: 20px;">Receipt for Invoice #INV-2026-11-0089</h2>
    <span style="color: #6b7280; font-size: 12px;">Paid Nov 6, 2026</span>
  </div>
  <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
    <thead>
      <tr style="border-bottom: 1px solid #e5e7eb; text-align: left; font-size: 12px; color: #6b7280;">
        <th style="padding: 8px 0;">DESCRIPTION</th>
        <th style="padding: 8px 0; text-align: right;">AMOUNT</th>
      </tr>
    </thead>
    <tbody>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 10px 0;">Dedicated Post-Quantum HSM Security Module</td>
        <td style="padding: 10px 0; text-align: right; font-family: monospace;">$350.00</td>
      </tr>
      <tr style="border-bottom: 1px solid #f3f4f6;">
        <td style="padding: 10px 0;">Zero-Knowledge Storage Cluster (10 TB Tier)</td>
        <td style="padding: 10px 0; text-align: right; font-family: monospace;">$70.00</td>
      </tr>
      <tr style="font-weight: bold; font-size: 15px; border-top: 2px solid #111827;">
        <td style="padding: 12px 0;">Amount Paid</td>
        <td style="padding: 12px 0; text-align: right; font-family: monospace;">$420.00 USD</td>
      </tr>
    </tbody>
  </table>
  <p style="font-size: 12px; color: #6b7280;">Payment method: Mastercard ending in •••• 4242</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0 12px 0;" />
  <p style="font-size: 11px; color: #9ca3af;">
    Need to modify your payment method or subscription? <a href="https://billing.stripe.com/p/session/unsub_9182a87bc1" style="color: #635bff;">Manage billing subscription</a>.
  </p>
</div>`;

  await seedMessage({
    senderDisplay: "Stripe Invoicing",
    senderAddress: "invoices@stripe.com",
    recipientAddress: Alice.email,
    subject: "Receipt for BYOS Cloud Infrastructure Services (Invoice #INV-2026-11-0089)",
    mimeContent: [
      "Subject: Receipt for BYOS Cloud Infrastructure Services (Invoice #INV-2026-11-0089)",
      "From: Stripe Invoicing <invoices@stripe.com>",
      `To: ${Alice.email}`,
      "List-Id: <billing.stripe.com>",
      "List-Unsubscribe: <https://billing.stripe.com/p/session/unsub_9182a87bc1>",
      "Content-Type: text/html; charset=utf-8",
      "",
      stripeHtml,
    ].join("\n"),
    category: "primary",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 24, // 1 day ago
  });

  // ===========================================================================
  // 5. 1-on-1 Personal: Bob Stone (Zero False Positive for Unsubscribe, Starred)
  // ===========================================================================
  console.log("  → 5. Personal: Bob Stone (1-on-1, NO unsubscribe button, Starred, Unread)");
  const bobBody = `Hey Alice,

I just finished testing the new offline password unlock flow on mobile viewport. The responsive cards look super clean and snappy, and the unwrap latency is virtually zero thanks to the off-thread web worker!

One quick thought: do you think we should add a small status pill in the reading pane header indicating when post-quantum hybrid mode is active? Users who care about Section 15 compliance would love to see that confirmation in real-time.

Let's grab a coffee at 2 PM if you're free to chat through it!

Best,
Bob`;

  await seedMessage({
    senderDisplay: "Bob Stone",
    senderAddress: "bob@byos.local",
    recipientAddress: Alice.email,
    subject: "Feedback on the new cryptographic key unwrap UX",
    mimeContent: [
      "Subject: Feedback on the new cryptographic key unwrap UX",
      "From: Bob Stone <bob@byos.local>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      bobBody,
    ].join("\n"),
    category: "primary",
    isRead: false,
    isStarred: true,
    dateOffsetMs: 1000 * 60 * 45, // 45 mins ago
  });

  // ===========================================================================
  // 6. 1-on-1 Personal: Sarah Jenkins (Design System Token audit)
  // ===========================================================================
  console.log("  → 6. Personal: Sarah Jenkins (1-on-1, NO unsubscribe button, Read)");
  const sarahBody = `Hi Alice,

Attached is my review on the warm stone palette (#18191D, #FAF9F6, #A27561) and WCAG AAA compliance.

Overall, the contrast ratio on dark mode background hits 7.8:1, well above the 4.5:1 requirement. The active pills and icon strokes in the reading pane feel very grounded and deliberate—no excessive bouncy animations, just crisp infrastructure-grade motion.

Let me know if you need any additional SVG glyphs optimized for high DPI displays.

Cheers,
Sarah`;

  await seedMessage({
    senderDisplay: "Sarah Jenkins",
    senderAddress: "sarah.jenkins@designsystems.io",
    recipientAddress: Alice.email,
    subject: "Design System Token audit for dark mode contrast",
    mimeContent: [
      "Subject: Design System Token audit for dark mode contrast",
      "From: Sarah Jenkins <sarah.jenkins@designsystems.io>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      sarahBody,
    ].join("\n"),
    category: "primary",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 18, // 18 hours ago
  });

  // ===========================================================================
  // 7. 1-on-1 Personal: David Chen (Q4 Roadmap)
  // ===========================================================================
  console.log("  → 7. Personal: David Chen (1-on-1, NO unsubscribe button, Read)");
  const davidBody = `Hi Alice,

Let's finalize our Q4 zero-knowledge milestones before Friday's executive sync.

Key deliverables for our sprint cycle:
1. Full Path A post-quantum hybrid envelope roll-out with ML-KEM-768
2. Zero-knowledge encrypted attachment streaming up to 40 MB
3. Subscriptions manager with verified RFC 2369 / RFC 8058 one-click handling
4. Native calendar RSVP and invitation integration

Great job on the progress so far. The test coverage and benchmark stability are top tier.

Best regards,
David Chen
Engineering Manager, BYOS`;

  await seedMessage({
    senderDisplay: "David Chen",
    senderAddress: "david.chen@byos.local",
    recipientAddress: Alice.email,
    subject: "Q4 Engineering Roadmap & Team Objectives",
    mimeContent: [
      "Subject: Q4 Engineering Roadmap & Team Objectives",
      "From: David Chen <david.chen@byos.local>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      davidBody,
    ].join("\n"),
    category: "primary",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 48, // 2 days ago
  });

  // ===========================================================================
  // 8. Calendar Invitation 1: BYOS Sprint 42 Planning & PQC Review (RSVP Card)
  // ===========================================================================
  console.log("  → 8. Calendar Invitation: Sprint 42 Planning (text/calendar RSVP Card, Unread)");
  const cal1Boundary = "----=_Part_Cal_Sprint42_99";
  const icsSprint42 = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BYOS Mail//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:sprint-42-planning@byos.local",
    "DTSTAMP:20261107T100000Z",
    "DTSTART:20261110T140000Z",
    "DTEND:20261110T150000Z",
    "SUMMARY:BYOS Sprint 42 Planning & PQC Review",
    "LOCATION:Room 402 / Meet (meet.byos.local/sprint42)",
    "DESCRIPTION:Bi-weekly team sprint planning and architecture sync for post-quantum hybrid rollout.",
    "ORGANIZER;CN=David Chen:mailto:david.chen@byos.local",
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Alice Cooper:mailto:${Alice.email}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const cal1Mime = [
    "Subject: Invitation: BYOS Sprint 42 Planning & PQC Review",
    "From: David Chen <david.chen@byos.local>",
    `To: ${Alice.email}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${cal1Boundary}"`,
    "",
    `--${cal1Boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "You have been invited to BYOS Sprint 42 Planning & PQC Review on Nov 10, 2026 at 14:00 UTC.",
    `--${cal1Boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>You have been invited to <strong>BYOS Sprint 42 Planning & PQC Review</strong>.</p><p>Location: Room 402 / Meet</p>",
    `--${cal1Boundary}`,
    'Content-Type: text/calendar; method=REQUEST; charset="utf-8"',
    "",
    icsSprint42,
    `--${cal1Boundary}--`,
  ].join("\r\n");

  await seedMessage({
    senderDisplay: "David Chen",
    senderAddress: "david.chen@byos.local",
    recipientAddress: Alice.email,
    subject: "Invitation: BYOS Sprint 42 Planning & PQC Review",
    mimeContent: cal1Mime,
    category: "primary",
    isRead: false,
    isStarred: true,
    dateOffsetMs: 1000 * 60 * 120, // 2 hours ago
  });

  // ===========================================================================
  // 9. Calendar Invitation 2: Lunch & Learn (RSVP Card, Read)
  // ===========================================================================
  console.log("  → 9. Calendar Invitation: Lunch & Learn ZK Proofs (text/calendar RSVP Card, Read)");
  const cal2Boundary = "----=_Part_Cal_LunchLearn_88";
  const icsLunchLearn = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BYOS Mail//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    "UID:lunch-and-learn-zkp@byos.local",
    "DTSTAMP:20261107T110000Z",
    "DTSTART:20261112T123000Z",
    "DTEND:20261112T133000Z",
    "SUMMARY:Lunch & Learn: Introduction to Bulletproofs and Groth16",
    "LOCATION:Cafeteria Stage B / Stream (stream.byos.local/zkp)",
    "DESCRIPTION:Interactive hands-on session exploring zero-knowledge range proofs and non-interactive arguments.",
    "ORGANIZER;CN=Security Guild:mailto:guild@byos.local",
    `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=Alice Cooper:mailto:${Alice.email}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const cal2Mime = [
    "Subject: Invitation: Lunch & Learn — Introduction to Bulletproofs and Groth16",
    "From: Security Guild <guild@byos.local>",
    `To: ${Alice.email}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${cal2Boundary}"`,
    "",
    `--${cal2Boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Join us for Lunch & Learn on Bulletproofs and Groth16 ZK proofs.",
    `--${cal2Boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>Join us for <strong>Lunch & Learn: Introduction to Bulletproofs and Groth16</strong> on Nov 12, 2026.</p>",
    `--${cal2Boundary}`,
    'Content-Type: text/calendar; method=REQUEST; charset="utf-8"',
    "",
    icsLunchLearn,
    `--${cal2Boundary}--`,
  ].join("\r\n");

  await seedMessage({
    senderDisplay: "Security Guild",
    senderAddress: "guild@byos.local",
    recipientAddress: Alice.email,
    subject: "Invitation: Lunch & Learn — Introduction to Bulletproofs and Groth16",
    mimeContent: cal2Mime,
    category: "primary",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 20, // 20 hours ago
  });

  // ===========================================================================
  // 10. Encrypted PDF Attachment: Enterprise Security SLA Agreement
  // ===========================================================================
  console.log("  → 10. Encrypted Attachment: Enterprise Security SLA (application/pdf, ~85 KB)");
  const pdfBytes = generateMockPdf("Enterprise_Security_SLA_2026", 86500);
  await seedMessage({
    senderDisplay: "Legal & Compliance",
    senderAddress: "legal@byos.local",
    recipientAddress: Alice.email,
    subject: "Executed Agreement: Enterprise Security SLA 2026-2027",
    mimeContent: [
      "Subject: Executed Agreement: Enterprise Security SLA 2026-2027",
      "From: Legal & Compliance <legal@byos.local>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Alice,\n\nAttached is the fully executed Enterprise Security SLA agreement for 2026-2027.\n\nKey terms covered:\n- 99.99% uptime guarantee for client-side zero-knowledge storage retrieval\n- Hardware security module (HSM) root isolation guarantees\n- Annual SOC 2 Type II audit report compliance\n\nPlease keep this document in your records.\n\nRegards,\nLegal & Compliance Operations",
    ].join("\n"),
    attachments: [
      {
        filename: "Enterprise_Security_SLA_2026.pdf",
        contentType: "application/pdf",
        data: pdfBytes,
      },
    ],
    category: "primary",
    isRead: true,
    isStarred: true,
    dateOffsetMs: 1000 * 60 * 60 * 30, // 30 hours ago
  });

  // ===========================================================================
  // 11. Encrypted PNG Image Attachment: System Architecture Vector Diagram
  // ===========================================================================
  console.log("  → 11. Encrypted Attachment: System Architecture Diagram (image/png, ~45 KB)");
  const pngBytes = generateMockPng(1920, 1080, 46200);
  await seedMessage({
    senderDisplay: "UI Team",
    senderAddress: "design@byos.local",
    recipientAddress: Alice.email,
    subject: "System Architecture & Brand Asset Pack v3.2",
    mimeContent: [
      "Subject: System Architecture & Brand Asset Pack v3.2",
      "From: UI Team <design@byos.local>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hi Alice,\n\nAttached is the high-resolution vector architecture diagram for the zero-knowledge security documentation.\n\nIncludes:\n- Post-quantum hybrid envelope flow diagram (300 DPI)\n- Light / Dark theme tokens for app branding\n- Verified badge iconography\n\nLet us know if you need any adjustments to the vector layers!\n\nDesign Systems Team",
    ].join("\n"),
    attachments: [
      {
        filename: "system_architecture_diagram.png",
        contentType: "image/png",
        data: pngBytes,
      },
    ],
    category: "primary",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 40, // 40 hours ago
  });

  // ===========================================================================
  // 12. Dual Encrypted Attachments: Security Audit JSON + Raw Kernel Dump ZIP
  // ===========================================================================
  console.log("  → 12. Dual Encrypted Attachments: Audit Dump (JSON + ZIP archives)");
  const auditJsonStr = JSON.stringify(
    {
      scan_id: "scan-20261107-prod",
      cluster: "prod-us-east-byos-01",
      scanned_containers: 48,
      vulnerabilities: { critical: 0, high: 0, medium: 0, low: 2 },
      cis_benchmark: { passed: 142, failed: 0, score: "100%" },
      pqc_ciphersuites_enforced: true,
      timestamp: new Date().toISOString(),
    },
    null,
    2
  );
  const jsonBytes = Buffer.from(auditJsonStr, "utf8");
  const zipBytes = generateMockZip("kernel-core-dump", 28400);

  await seedMessage({
    senderDisplay: "DevOps Automation",
    senderAddress: "devops@byos.local",
    recipientAddress: Alice.email,
    subject: "Automated Nightly Vulnerability Audit Log - Nov 7",
    mimeContent: [
      "Subject: Automated Nightly Vulnerability Audit Log - Nov 7",
      "From: DevOps Automation <devops@byos.local>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Automated Nightly Security & Compliance Scan\nCluster: prod-us-east-byos-01\nTimestamp: 2026-11-07T04:00:00Z\n\nSummary:\n- Container Images Scanned: 48\n- Critical Vulnerabilities: 0\n- High Vulnerabilities: 0\n- CIS Benchmark Score: 100%\n\nAttached files:\n1. security_audit_report.json — Complete JSON structured vulnerability report\n2. raw_kernel_core_dump.zip — Kernel debug symbols and memory boundary logs\n\nThis is an automated system message.",
    ].join("\n"),
    attachments: [
      {
        filename: "security_audit_report.json",
        contentType: "application/json",
        data: jsonBytes,
      },
      {
        filename: "raw_kernel_core_dump.zip",
        contentType: "application/zip",
        data: zipBytes,
      },
    ],
    category: "primary",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 8, // 8 hours ago
  });

  // ===========================================================================
  // 13. Cloudflare Radar Report (Remote Tracking & Privacy Shield Banner)
  // ===========================================================================
  console.log("  → 13. Cloudflare Radar Report (Remote Tracking & Privacy Shield Banner, Unread)");
  const cloudflareHtml = `
<div style="font-family: -apple-system, sans-serif; max-width: 600px; color: #1e293b; font-size: 14px; line-height: 1.6;">
  <h2 style="color: #0f172a; margin-top: 0;">Cloudflare Radar Weekly Insights</h2>
  <p>Our weekly analysis of global Internet traffic trends, routing anomalies, and cryptographic protocol transitions.</p>
  <img src="https://img.shields.io/badge/pqc-adoption_surge_340%25-blue.svg" alt="PQC Surge Badge" style="max-width: 100%; border-radius: 8px; margin: 12px 0;" />
  <p>Post-quantum cryptography adoption across major networks has expanded rapidly following the ratification of Kyber/ML-KEM standards.</p>
  <img src="https://via.placeholder.com/640x220.png?text=Global+TLS+1.3+PQC+Handshake+Volume" alt="Traffic Trend Graph" style="max-width: 100%; border-radius: 8px; margin: 12px 0;" />
  <img src="https://radar.cloudflare.com/track/pixel_open_2026.png?id=9928174" width="1" height="1" alt="" style="display: none;" />
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 12px 0;" />
  <p style="font-size: 11px; color: #64748b;">
    Cloudflare, Inc., 101 Townsend St, San Francisco, CA.
    <a href="https://radar.cloudflare.com/unsubscribe?id=9928174" style="color: #f6821f;">Unsubscribe</a>.
  </p>
</div>`;

  await seedMessage({
    senderDisplay: "Cloudflare Radar",
    senderAddress: "insights@radar.cloudflare.com",
    recipientAddress: Alice.email,
    subject: "Weekly Internet Trends: PQC Adoption Rises 340% Across Major CDNs",
    mimeContent: [
      "Subject: Weekly Internet Trends: PQC Adoption Rises 340% Across Major CDNs",
      "From: Cloudflare Radar <insights@radar.cloudflare.com>",
      `To: ${Alice.email}`,
      "List-Id: <radar-insights.cloudflare.com>",
      "List-Unsubscribe: <https://radar.cloudflare.com/unsubscribe?id=9928174>",
      "Content-Type: text/html; charset=utf-8",
      "",
      cloudflareHtml,
    ].join("\n"),
    category: "newsletters",
    isRead: false,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 12, // 12 hours ago
  });

  // ===========================================================================
  // 14-16. Multi-Turn Thread (Database migration window for v2.4 upgrade)
  // ===========================================================================
  console.log("  → 14-16. Multi-Turn Thread (3 messages with In-Reply-To / References)");
  const threadId = "aaaaaaaa-0000-0000-0000-000000000001";
  const msg1IdHeader = "<thread-db-mig-01@byos.local>";
  const msg2IdHeader = "<thread-db-mig-02@byos.local>";
  const msg3IdHeader = "<thread-db-mig-03@byos.local>";

  // Message 1 from Bob in Inbox
  await seedMessage({
    senderDisplay: "Bob Stone",
    senderAddress: "bob@byos.local",
    recipientAddress: Alice.email,
    subject: "Database migration window for v2.4 upgrade",
    mimeContent: [
      "Subject: Database migration window for v2.4 upgrade",
      "From: Bob Stone <bob@byos.local>",
      `To: ${Alice.email}`,
      `Message-ID: ${msg1IdHeader}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hi Alice,\n\nWe are planning the PostgreSQL 17 upgrade and schema migration for Saturday at 02:00 UTC. The expected downtime is under 90 seconds while the connection pool pauses transactions.\n\nDoes this window conflict with any running client-side cryptographic benchmarks or stress tests?\n\nBest,\nBob",
    ].join("\n"),
    folder: "inbox",
    isRead: true,
    isStarred: false,
    messageIdHeader: msg1IdHeader,
    threadId: threadId,
    dateOffsetMs: 1000 * 60 * 60 * 24, // 24 hours ago
  });

  // Message 2 from Alice in Sent
  await seedMessage({
    senderDisplay: "Alice Cooper",
    senderAddress: "alice@byos.local",
    recipientAddress: Bob.email,
    subject: "Re: Database migration window for v2.4 upgrade",
    mimeContent: [
      "Subject: Re: Database migration window for v2.4 upgrade",
      "From: Alice Cooper <alice@byos.local>",
      `To: ${Bob.email}`,
      `Message-ID: ${msg2IdHeader}`,
      `In-Reply-To: ${msg1IdHeader}`,
      `References: ${msg1IdHeader}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hi Bob,\n\nSaturday 02:00 UTC works perfectly for me.\n\nI will pause our automated load testing harness and off-thread crypto stress runs from 01:45 to 02:30 UTC so we don't trigger spurious latency alerts during the switchover.\n\nLet me know if you need an extra pair of eyes during the rollout.\n\nThanks,\nAlice",
    ].join("\n"),
    folder: "sent",
    isRead: true,
    isStarred: false,
    messageIdHeader: msg2IdHeader,
    inReplyTo: msg1IdHeader,
    threadId: threadId,
    dateOffsetMs: 1000 * 60 * 60 * 20, // 20 hours ago
  });

  // Message 3 from Bob in Inbox
  await seedMessage({
    senderDisplay: "Bob Stone",
    senderAddress: "bob@byos.local",
    recipientAddress: Alice.email,
    subject: "Re: Database migration window for v2.4 upgrade",
    mimeContent: [
      "Subject: Re: Database migration window for v2.4 upgrade",
      "From: Bob Stone <bob@byos.local>",
      `To: ${Alice.email}`,
      `Message-ID: ${msg3IdHeader}`,
      `In-Reply-To: ${msg2IdHeader}`,
      `References: ${msg1IdHeader} ${msg2IdHeader}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Awesome, thanks Alice!\n\nThe maintenance notification is scheduled, and the standby replica is pre-warmed. I'll drop a message in the #infra-announcements channel right as the migration finishes.\n\nHave a great weekend!\nBob",
    ].join("\n"),
    folder: "inbox",
    isRead: false,
    isStarred: false,
    messageIdHeader: msg3IdHeader,
    inReplyTo: msg2IdHeader,
    threadId: threadId,
    dateOffsetMs: 1000 * 60 * 60 * 16, // 16 hours ago
  });

  // ===========================================================================
  // 17. Archive Folder: HR Open Enrollment Confirmation
  // ===========================================================================
  console.log("  → 17. Archive Folder: HR Open Enrollment Confirmation (folder: archive)");
  await seedMessage({
    senderDisplay: "BYOS People Operations",
    senderAddress: "hr@byos.local",
    recipientAddress: Alice.email,
    subject: "Annual Open Enrollment Confirmation (2026-2027)",
    mimeContent: [
      "Subject: Annual Open Enrollment Confirmation (2026-2027)",
      "From: BYOS People Operations <hr@byos.local>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Dear Alice,\n\nThis email confirms that your annual benefit selections for the 2026-2027 plan year have been received and processed.\n\nCoverages:\n- Comprehensive Health & Dental Plan\n- 401(k) Matching Contribution (6%)\n- Annual Learning & Development Stipend ($2,500)\n\nYour updated benefit elections take effect on January 1, 2027.\n\nBest regards,\nBYOS People Operations Team",
    ].join("\n"),
    folder: "archive",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 24 * 14, // 14 days ago
  });

  // ===========================================================================
  // 18. Spam Folder: Phishing Token Airdrop
  // ===========================================================================
  console.log("  → 18. Spam Folder: Phishing Token Airdrop (folder: spam)");
  await seedMessage({
    senderDisplay: "Fast Wealth Alerts",
    senderAddress: "promotions@crypto-moon-yields-889.xyz",
    recipientAddress: Alice.email,
    subject: "URGENT: Claim your 50,000 $TOKEN airdrop before midnight!",
    mimeContent: [
      "Subject: URGENT: Claim your 50,000 $TOKEN airdrop before midnight!",
      "From: Fast Wealth Alerts <promotions@crypto-moon-yields-889.xyz>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "CONGRATULATIONS! Your wallet address was selected in our grand staking raffle!\nClaim your 50,000 $TOKEN rewards immediately by connecting your private keys at:\nhttp://malicious-crypto-claim-airdrop-site.fake/claim\n\nHurry! Offer expires in 2 hours!",
    ].join("\n"),
    folder: "spam",
    isRead: false,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 180, // 3 hours ago
  });

  // ===========================================================================
  // 19. Trash Folder: Office Supplies Receipt
  // ===========================================================================
  console.log("  → 19. Trash Folder: Office Supplies Order #8921 (folder: trash)");
  await seedMessage({
    senderDisplay: "Office Supplies Vendor",
    senderAddress: "orders@office-supplies-vendor.com",
    recipientAddress: Alice.email,
    subject: "Order #8921 Shipped - Ergonomic monitor arms and keycaps",
    mimeContent: [
      "Subject: Order #8921 Shipped - Ergonomic monitor arms and keycaps",
      "From: Office Supplies Vendor <orders@office-supplies-vendor.com>",
      `To: ${Alice.email}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Thank you for your order!\n\nOrder #8921 has shipped via Express Delivery.\nItems:\n- 1x Dual Ergonomic Gas-Spring Monitor Arm (Matte Black)\n- 1x PBT Double-shot Custom Mechanical Keycaps (Warm Stone)\n\nTracking Number: 1Z9999999999999999\nEstimated Delivery: Tuesday, Nov 11",
    ].join("\n"),
    folder: "trash",
    isRead: true,
    isStarred: false,
    dateOffsetMs: 1000 * 60 * 60 * 24 * 5, // 5 days ago
  });

  // ===========================================================================
  // 20. Encrypted Draft in drafts Table
  // ===========================================================================
  console.log("  → 20. Encrypted Draft in drafts table");
  const draftPayload = JSON.stringify({
    to: "security-working-group@ietf.org",
    subject: "Draft RFC: Ephemeral Hybrid Renegotiation Protocol for Zero-Knowledge Mailboxes",
    body: "To the IETF Security Working Group,\n\nPlease find below our draft proposal for standardizing ephemeral post-quantum session renegotiation in zero-knowledge mail architectures.\n\nAbstract:\nThis document specifies an authenticated key agreement extension allowing lightweight clients to re-encrypt stored root key wrappers without transmitting plaintext secret key material to server intermediaries.",
  });

  const draftKeyHex = Alice.xwingSeed;
  const draftAad = bytesToHex(Buffer.from(`byos:draft:${Alice.mailboxId.replace(/-/g, "").toLowerCase()}`));
  const encryptedDraftEnvelope = wasm.wasm_aes_gcm_encrypt(
    draftKeyHex,
    bytesToHex(Buffer.from(draftPayload, "utf8")),
    draftAad
  );

  execSql(`
    INSERT INTO drafts (id, mailbox_id, subject, recipient, encrypted_envelope, version, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      '${Alice.mailboxId}',
      'Draft RFC: Ephemeral Hybrid Renegotiation Protocol for Zero-Knowledge Mailboxes',
      'security-working-group@ietf.org',
      decode('${encryptedDraftEnvelope}', 'hex'),
      1,
      now() - interval '2 hours',
      now() - interval '1 hour'
    );
  `);

  console.log("[4/4] Verifying seeded message counts in PostgreSQL...");
  const counts = execSql(`
    SELECT folder, count(*)
    FROM message_metadata
    WHERE mailbox_id = '${Alice.mailboxId}'
    GROUP BY folder
    ORDER BY folder;
  `);
  console.log("Folder distribution for Alice (alice@byos.local):");
  console.log(counts);

  const draftCount = execSql(`SELECT count(*) FROM drafts WHERE mailbox_id = '${Alice.mailboxId}';`);
  console.log(`Drafts count: ${draftCount}`);

  console.log("\n✓ SUCCESS: All 20 dummy email variations seeded successfully!");
}

main().catch((err) => {
  console.error("FATAL Seeding Error:", err);
  process.exit(1);
});
