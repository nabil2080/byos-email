import {
  encryptAttachmentBytes,
  decryptAttachmentBytes,
  preparePathAAttachment,
  decryptPathAAttachment,
  wrapAttachmentContentKey,
  unwrapAttachmentContentKey,
  computeSHA256,
  bytesToHex,
  hexToBytes,
} from "./attachment_crypto";
import { wasm_xwing_public_key_from_seed } from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runAttachmentCryptoTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  const runAsyncTest = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  const key1 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key1[i] = i + 1;

  const key2 = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key2[i] = 255 - i;

  const plaintext = new TextEncoder().encode("attachment-test-payload-secret-file-content");

  // 1. Plaintext != Uploaded bytes
  runTest("Plaintext is not equal to encrypted ciphertext envelope", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    assert(ciphertext.length > plaintext.length, "Ciphertext should include version, nonce, tag");
    const same =
      ciphertext.length === plaintext.length &&
      ciphertext.every((b, idx) => b === plaintext[idx]);
    assert(!same, "Plaintext bytes MUST NOT equal encrypted bytes");
  });

  // 2. Client decrypt round-trip
  runTest("Decrypt(ciphertext, correct_key) returns original plaintext", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    const decrypted = decryptAttachmentBytes(ciphertext, key1);
    assert(decrypted.length === plaintext.length, "Decrypted length match");
    const matches = decrypted.every((b, idx) => b === plaintext[idx]);
    assert(matches, "Decrypted content MUST match original plaintext");
  });

  // 3. Tamper detection
  runTest("Tampered ciphertext fails decryption", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    const tampered = new Uint8Array(ciphertext);
    tampered[tampered.length - 1] ^= 0xff; // flip last byte

    let threw = false;
    try {
      decryptAttachmentBytes(tampered, key1);
    } catch {
      threw = true;
    }
    assert(threw, "Tampered ciphertext MUST fail decryption");
  });

  // 4. Wrong key detection
  runTest("Decrypting with wrong key fails", () => {
    const ciphertext = encryptAttachmentBytes(plaintext, key1);
    let threw = false;
    try {
      decryptAttachmentBytes(ciphertext, key2);
    } catch {
      threw = true;
    }
    assert(threw, "Decrypting with wrong key MUST throw error");
  });

  // 5. Storage and log leakage check
  runTest("No plaintext file bytes stored or logged", () => {
    const secretStr = "attachment-test-payload-secret-file-content";
    const loggedMsgs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      loggedMsgs.push(args.map((a) => String(a)).join(" "));
    };

    try {
      encryptAttachmentBytes(plaintext, key1);
    } finally {
      console.log = origLog;
    }

    const leakedInLog = loggedMsgs.some((m) => m.includes(secretStr));
    assert(!leakedInLog, "Plaintext MUST NOT be output to console logs");

    if (typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) {
          const val = localStorage.getItem(k) || "";
          assert(!val.includes(secretStr), "Plaintext MUST NOT be written to localStorage");
        }
      }
    }
  });

  // Common test identities with real X-Wing keys
  const senderMailboxId = "00000000-0000-0000-0000-000000000001";
  const recipientMailboxId = "00000000-0000-0000-0000-000000000002";

  const recipientSeed = new Uint8Array(32);
  recipientSeed.fill(0x55);
  const recipientSkSeedHex = bytesToHex(recipientSeed);
  const recipientPkHex = wasm_xwing_public_key_from_seed(recipientSkSeedHex);

  const senderSeed = new Uint8Array(32);
  senderSeed.fill(0x33);
  const senderSkSeedHex = bytesToHex(senderSeed);
  const senderPkHex = wasm_xwing_public_key_from_seed(senderSkSeedHex);

  // 6. test_attachment_encrypt_decrypt_roundtrip
  await runAsyncTest("test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash", async () => {
    const smallPayload = new Uint8Array(128 * 1024); // 128 KB
    for (let i = 0; i < smallPayload.length; i++) {
      smallPayload[i] = (i * 7 + 13) & 0xff;
    }

    const prep = await preparePathAAttachment({
      file: { name: "test_doc.pdf", type: "application/pdf", data: smallPayload },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    assert(prep.recipientEnvelope.chunk_count === 1, "Should have 1 chunk");
    assert(prep.recipientChunks.length === 1, "Should produce 1 encrypted chunk payload");
    assert(prep.recipientEnvelope.chunks[0].size_bytes === prep.recipientChunks[0].data.length, "Chunk size matches");
    assert(prep.senderEnvelope.wrapped_key.x25519_encapsulated !== prep.recipientEnvelope.wrapped_key.x25519_encapsulated, "Sender wrapped key must differ from recipient");

    // Simulate upload/download
    const storageMap = new Map<string, Uint8Array>();
    for (const chunk of prep.recipientChunks) {
      storageMap.set(chunk.storageRef, chunk.data);
    }

    const downloadedChunks: Uint8Array[] = [];
    for (const metaChunk of prep.recipientEnvelope.chunks) {
      const data = storageMap.get(metaChunk.storage_ref);
      assert(data !== undefined, `Storage ref ${metaChunk.storage_ref} must exist`);
      downloadedChunks.push(data!);
    }

    // Decrypt
    const result = await decryptPathAAttachment(
      prep.recipientEnvelope,
      downloadedChunks,
      recipientSkSeedHex,
      recipientMailboxId
    );

    assert(!result.isCorrupted, "Decryption should succeed without corruption");
    assert(result.data !== undefined, "Decrypted data must be defined");
    assert(result.data!.length === smallPayload.length, "Decrypted length matches original");
    const matches = result.data!.every((b, idx) => b === smallPayload[idx]);
    assert(matches, "Decrypted bytes must match original plaintext");

    const computedHash = await computeSHA256(result.data!);
    assert(computedHash === prep.recipientEnvelope.content_hash_sha256, "SHA-256 hash matches envelope hash");
  });

  // 7. test_attachment_chunking
  await runAsyncTest("test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble", async () => {
    const fiveMB = 5 * 1024 * 1024;
    const file5MB = new Uint8Array(fiveMB);
    for (let i = 0; i < file5MB.length; i += 1024) {
      file5MB[i] = (i / 1024) & 0xff;
    }

    const prep = await preparePathAAttachment({
      file: { name: "large_dataset.zip", type: "application/zip", data: file5MB },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    assert(prep.recipientEnvelope.chunk_count === 5, "5 MB file must produce exactly 5 chunks");
    assert(prep.recipientChunks.length === 5, "5 chunks generated in payload");
    assert(prep.recipientEnvelope.chunks.length === 5, "5 chunks listed in metadata");

    for (let i = 0; i < 5; i++) {
      const ch = prep.recipientEnvelope.chunks[i];
      assert(ch !== undefined, `Chunk ${i} exists`);
      assert(ch.index === i, `Chunk index ${i} matches`);
      assert(ch.storage_ref !== undefined && ch.storage_ref.includes(`chunk_00${i}.enc`), `Storage ref contains chunk index`);
    }

    // Decrypt and reassemble
    const downloadedChunks = prep.recipientChunks.map((c) => c.data);
    const result = await decryptPathAAttachment(
      prep.recipientEnvelope,
      downloadedChunks,
      recipientSkSeedHex,
      recipientMailboxId
    );

    assert(!result.isCorrupted, "5 MB decryption should not be corrupted");
    assert(result.data !== undefined, "Data defined");
    assert(result.data!.length === fiveMB, "Reassembled size matches 5 MB");
    const matches = result.data![0] === file5MB[0] && result.data![1024] === file5MB[1024] && result.data![fiveMB - 1] === file5MB[fiveMB - 1];
    assert(matches, "Reassembled content matches original");
  });

  // 8. test_attachment_corrupt_chunk_isolated
  await runAsyncTest("test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked", async () => {
    const file1Data = new Uint8Array(2 * 1024 * 1024); // 2 MB -> 2 chunks
    file1Data.fill(0x11);
    const file2Data = new Uint8Array(1024 * 1024); // 1 MB -> 1 chunk
    file2Data.fill(0x22);

    const prep1 = await preparePathAAttachment({
      file: { name: "file1.bin", type: "application/octet-stream", data: file1Data },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    const prep2 = await preparePathAAttachment({
      file: { name: "file2.bin", type: "application/octet-stream", data: file2Data },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    // Corrupt chunk 1 of attachment 1
    const chunks1 = prep1.recipientChunks.map((c) => new Uint8Array(c.data));
    chunks1[1][25] ^= 0xff; // flip byte in chunk 1 ciphertext

    const chunks2 = prep2.recipientChunks.map((c) => new Uint8Array(c.data));

    // Decrypt both
    const res1 = await decryptPathAAttachment(
      prep1.recipientEnvelope,
      chunks1,
      recipientSkSeedHex,
      recipientMailboxId
    );

    const res2 = await decryptPathAAttachment(
      prep2.recipientEnvelope,
      chunks2,
      recipientSkSeedHex,
      recipientMailboxId
    );

    assert(res1.isCorrupted === true, "Attachment 1 must be marked as corrupted");
    assert(res1.error !== undefined && res1.error.includes("index 1"), "Error specifically reports chunk index 1");
    assert(res2.isCorrupted === false, "Attachment 2 MUST NOT be affected by Attachment 1 corruption");
    assert(res2.data !== undefined && res2.data.length === file2Data.length, "Attachment 2 decrypts successfully");
    assert(res2.data![0] === 0x22, "Attachment 2 plaintext is intact");
  });

  // 9. test_attachment_iv_unique_per_chunk
  await runAsyncTest("test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct", async () => {
    const fiveMB = 5 * 1024 * 1024;
    const file5MB = new Uint8Array(fiveMB);
    file5MB.fill(0x42);

    const prep = await preparePathAAttachment({
      file: { name: "dataset.bin", type: "application/octet-stream", data: file5MB },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    assert(prep.recipientChunks.length === 5, "5 chunks produced");
    assert(prep.senderChunks.length === 5, "5 sender chunks produced");

    const ivSet = new Set<string>();
    // Recipient chunk IVs (bytes 1..13 in wire format: [0x01, iv(12), ciphertext+tag])
    for (let i = 0; i < prep.recipientChunks.length; i++) {
      const chunkData = prep.recipientChunks[i].data;
      assert(chunkData[0] === 0x01, "Wire format version byte is 0x01");
      const ivHex = bytesToHex(chunkData.slice(1, 13));
      assert(!ivSet.has(ivHex), `Recipient chunk ${i} IV must be globally unique`);
      ivSet.add(ivHex);
    }
    // Sender chunk IVs must also be distinct from each other and from recipient IVs
    for (let i = 0; i < prep.senderChunks.length; i++) {
      const chunkData = prep.senderChunks[i].data;
      assert(chunkData[0] === 0x01, "Wire format version byte is 0x01");
      const ivHex = bytesToHex(chunkData.slice(1, 13));
      assert(!ivSet.has(ivHex), `Sender chunk ${i} IV must be globally unique`);
      ivSet.add(ivHex);
    }

    assert(ivSet.size === 10, "All 10 chunk IVs (5 recipient + 5 sender) must be distinct");
  });

  // 10. test_attachment_hash_mismatch_marks_corrupted
  await runAsyncTest("test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output", async () => {
    const fileData = new Uint8Array(64 * 1024);
    fileData.fill(0x77);

    const prep = await preparePathAAttachment({
      file: { name: "verified.pdf", type: "application/pdf", data: fileData },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    const tamperedEnvelope = {
      ...prep.recipientEnvelope,
      content_hash_sha256: "dGFtcGVyZWRfaGFzaF92YWx1ZV8zMmJ5dGVzX2xvbmc=", // invalid hash
    };

    const downloadedChunks = prep.recipientChunks.map((c) => c.data);
    const result = await decryptPathAAttachment(
      tamperedEnvelope,
      downloadedChunks,
      recipientSkSeedHex,
      recipientMailboxId
    );

    assert(result.isCorrupted === true, "Attachment must be marked corrupted on hash mismatch");
    assert(result.error !== undefined && result.error.includes("SHA-256 mismatch"), "Error indicates SHA-256 mismatch");
    assert(result.data === undefined, "Corrupted attachment MUST NOT produce partial output");
  });

  // 11. test_attachment_empty_file_roundtrip
  await runAsyncTest("test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error", async () => {
    const emptyData = new Uint8Array(0);

    const prep = await preparePathAAttachment({
      file: { name: "empty.txt", type: "text/plain", data: emptyData },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    assert(prep.recipientEnvelope.chunk_count === 1, "0-byte file produces 1 chunk (empty plaintext)");
    assert(prep.recipientEnvelope.size_bytes === 0, "size_bytes is 0");
    assert(prep.recipientChunks.length === 1, "1 chunk payload produced");

    const downloadedChunks = prep.recipientChunks.map((c) => c.data);
    const result = await decryptPathAAttachment(
      prep.recipientEnvelope,
      downloadedChunks,
      recipientSkSeedHex,
      recipientMailboxId
    );

    assert(result.isCorrupted === false, "0-byte file must decrypt without corruption");
    assert(result.data !== undefined, "Data must be defined");
    assert(result.data!.length === 0, "Decrypted data must be 0 bytes");
    assert(result.filename === "empty.txt", "Filename must match empty.txt");
  });

  // 12. test_attachment_unicode_filename_roundtrip
  await runAsyncTest("test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte", async () => {
    const fileData = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const unicodeName = "résumé_über_groß.pdf";

    const prep = await preparePathAAttachment({
      file: { name: unicodeName, type: "application/pdf", data: fileData },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });

    assert(prep.recipientEnvelope.filename === unicodeName, "Envelope filename matches unicode name");

    const downloadedChunks = prep.recipientChunks.map((c) => c.data);
    const result = await decryptPathAAttachment(
      prep.recipientEnvelope,
      downloadedChunks,
      recipientSkSeedHex,
      recipientMailboxId
    );

    assert(result.isCorrupted === false, "Unicode file decryption succeeds");
    assert(result.filename === unicodeName, "Decrypted filename matches unicode name exactly");
    assert(result.data !== undefined && result.data.length === fileData.length, "Decrypted data matches");
    assert(result.data![0] === 0xde && result.data![3] === 0xef, "Decrypted bytes intact");
  });

  // 13. test_attachment_full_flow_roundtrip
  await runAsyncTest("test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match", async () => {
    const payloadSize = 2500 * 1024; // 2.5 MB -> 3 chunks
    const payload = new Uint8Array(payloadSize);
    for (let i = 0; i < payloadSize; i++) {
      payload[i] = (i * 31 + 7) & 0xff;
    }

    // 1. Prepare & Encrypt (generate keys, chunk, wrap)
    const prep = await preparePathAAttachment({
      file: { name: "complete_contract.pdf", type: "application/pdf", data: payload },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
      messageId: "msg-test-123",
    });

    assert(prep.recipientEnvelope.chunk_count === 3, "2.5 MB file split into 3 chunks");
    assert(prep.senderEnvelope.chunk_count === 3, "Sender sent copy split into 3 chunks");

    // 2. Mock storage upload
    const mockStorage = new Map<string, Uint8Array>();
    for (const ch of prep.recipientChunks) {
      mockStorage.set(ch.storageRef, ch.data);
    }
    for (const ch of prep.senderChunks) {
      mockStorage.set(ch.storageRef, ch.data);
    }

    // 3. Mock storage download (recipient)
    const recDownloaded: Uint8Array[] = [];
    for (const ch of prep.recipientEnvelope.chunks) {
      const data = mockStorage.get(ch.storage_ref);
      assert(data !== undefined, `Recipient chunk ${ch.storage_ref} found in storage`);
      recDownloaded.push(data!);
    }

    // 4. Decrypt recipient copy
    const recResult = await decryptPathAAttachment(
      prep.recipientEnvelope,
      recDownloaded,
      recipientSkSeedHex,
      recipientMailboxId
    );
    assert(!recResult.isCorrupted, "Recipient decryption must not be corrupted");
    assert(recResult.data !== undefined && recResult.data.length === payloadSize, "Recipient plaintext size matches");
    const recMatches = recResult.data!.every((b, idx) => b === payload[idx]);
    assert(recMatches, "Recipient plaintext matches original bytes byte-for-byte");
    const recHash = await computeSHA256(recResult.data!);
    assert(recHash === prep.recipientEnvelope.content_hash_sha256, "Recipient content hash matches");

    // 5. Mock storage download (sender sent copy)
    const senderDownloaded: Uint8Array[] = [];
    for (const ch of prep.senderEnvelope.chunks) {
      const data = mockStorage.get(ch.storage_ref);
      assert(data !== undefined, `Sender chunk ${ch.storage_ref} found in storage`);
      senderDownloaded.push(data!);
    }

    // 6. Decrypt sender sent copy with sender key
    const senderResult = await decryptPathAAttachment(
      prep.senderEnvelope,
      senderDownloaded,
      senderSkSeedHex,
      senderMailboxId
    );
    assert(!senderResult.isCorrupted, "Sender Sent-copy decryption must not be corrupted");
    assert(senderResult.data !== undefined && senderResult.data.length === payloadSize, "Sender plaintext size matches");
    const senderMatches = senderResult.data!.every((b, idx) => b === payload[idx]);
    assert(senderMatches, "Sender plaintext matches original bytes byte-for-byte");
    const senderHash = await computeSHA256(senderResult.data!);
    assert(senderHash === prep.senderEnvelope.content_hash_sha256, "Sender content hash matches");

    // 7. Verify ciphertext hashes differ between recipient and sender
    for (let i = 0; i < 3; i++) {
      const recChunkHash = await computeSHA256(recDownloaded[i]);
      const senderChunkHash = await computeSHA256(senderDownloaded[i]);
      assert(recChunkHash !== senderChunkHash, `Chunk ${i} ciphertext must differ between recipient and sender`);
    }
  });

  // 14. test_wasm_unavailable_throws_not_falls_back
  await runAsyncTest("test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable", async () => {
    const dummyKey = new Uint8Array(32);
    dummyKey.fill(0x42);

    let wrapThrew = false;
    try {
      await wrapAttachmentContentKey(
        dummyKey,
        recipientPkHex,
        recipientMailboxId,
        null as any // simulate unavailable WASM function
      );
    } catch (err: any) {
      wrapThrew = err.message.includes("Attachment encryption unavailable: WASM crypto core not loaded");
    }
    assert(wrapThrew, "wrapAttachmentContentKey must throw loudly when WASM is unavailable, never silently embed key");

    let unwrapThrew = false;
    try {
      await unwrapAttachmentContentKey(
        {
          x25519_encapsulated: "dummy",
          mlkem_encrypted_key: "dummy",
        },
        recipientSkSeedHex,
        recipientMailboxId,
        null as any // simulate unavailable WASM function
      );
    } catch (err: any) {
      unwrapThrew = err.message.includes("Attachment decryption unavailable: WASM crypto core not loaded");
    }
    assert(unwrapThrew, "unwrapAttachmentContentKey must throw loudly when WASM is unavailable, never silently return plaintext");
  });

  // 15. Content key generation produces 32 bytes
  runTest("Content key generation produces 32 bytes", () => {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    assert(key.length === 32, "Content key must be exactly 32 bytes (256 bits)");
    const nonZero = key.some((b) => b !== 0);
    assert(nonZero, "Random content key must not be all zeros");
  });

  // 16. Base IV generation produces 12 bytes
  runTest("Base IV generation produces 12 bytes", () => {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    assert(iv.length === 12, "Base IV must be exactly 12 bytes (96 bits)");
    const nonZero = iv.some((b) => b !== 0);
    assert(nonZero, "Random Base IV must not be all zeros");
  });

  // 17. Chunk IV generation produces 12 bytes
  runTest("Chunk IV generation produces 12 bytes", () => {
    const chunkIv = new Uint8Array(12);
    crypto.getRandomValues(chunkIv);
    assert(chunkIv.length === 12, "Chunk IV must be exactly 12 bytes (96 bits)");
    const nonZero = chunkIv.some((b) => b !== 0);
    assert(nonZero, "Random Chunk IV must not be all zeros");
  });

  // 18. Attachment encryption roundtrip: 1 byte
  await runAsyncTest("Attachment encryption roundtrip: 1 byte", async () => {
    const oneByte = new Uint8Array([0x42]);
    const prep = await preparePathAAttachment({
      file: { name: "byte.bin", type: "application/octet-stream", data: oneByte },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });
    const downloadedChunks = prep.recipientChunks.map((c) => c.data);
    const result = await decryptPathAAttachment(
      prep.recipientEnvelope,
      downloadedChunks,
      recipientSkSeedHex,
      recipientMailboxId
    );
    assert(!result.isCorrupted, "1 byte payload must not be marked corrupted");
    assert(result.data !== undefined && result.data.length === 1, "Decrypted length must be 1");
    assert(result.data![0] === 0x42, "Decrypted byte must match 0x42");
  });

  // 19. Attachment encryption roundtrip: 64 bytes
  await runAsyncTest("Attachment encryption roundtrip: 64 bytes", async () => {
    const sixtyFourBytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) sixtyFourBytes[i] = i ^ 0xaa;
    const prep = await preparePathAAttachment({
      file: { name: "block.bin", type: "application/octet-stream", data: sixtyFourBytes },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });
    const downloadedChunks = prep.recipientChunks.map((c) => c.data);
    const result = await decryptPathAAttachment(
      prep.recipientEnvelope,
      downloadedChunks,
      recipientSkSeedHex,
      recipientMailboxId
    );
    assert(!result.isCorrupted, "64 byte payload must not be marked corrupted");
    assert(result.data !== undefined && result.data.length === 64, "Decrypted length must be 64");
    assert(result.data!.every((b, idx) => b === sixtyFourBytes[idx]), "Decrypted bytes must match exactly");
  });

  // 20. Path A recipient cannot decrypt sender chunks
  await runAsyncTest("Path A recipient cannot decrypt sender chunks", async () => {
    const secretData = new TextEncoder().encode("secret-sender-copy-payload");
    const prep = await preparePathAAttachment({
      file: { name: "private.txt", type: "text/plain", data: secretData },
      senderMailboxId,
      recipientMailboxId,
      recipientXWingPkHex: recipientPkHex,
      senderXWingPkHex: senderPkHex,
    });
    // Attempt to decrypt sender chunks using recipient envelope & recipient private key
    const senderChunks = prep.senderChunks.map((c) => c.data);
    const result = await decryptPathAAttachment(
      prep.recipientEnvelope,
      senderChunks, // Sender chunks encrypted with K_sender, but recipient envelope has K_recipient
      recipientSkSeedHex,
      recipientMailboxId
    );
    assert(result.isCorrupted === true, "Recipient MUST NOT be able to decrypt sender chunks");
    assert(result.data === undefined, "Corrupted attempt must produce no plaintext data");
  });

  return { passed, failed };
}

