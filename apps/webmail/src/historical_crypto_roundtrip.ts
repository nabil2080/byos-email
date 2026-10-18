import { execSync } from "child_process";
import crypto from "crypto";
import {
  wasm_aes_gcm_encrypt,
  wasm_aes_gcm_decrypt,
  wasm_seal_xwing_envelope,
  wasm_open_xwing_envelope,
  wasm_xwing_public_key_from_seed,
} from "./generated/crypto-core/byos_crypto_core.js";

function runCmd(cmd: string): string {
  return execSync(cmd, { encoding: "utf8" });
}

function runPsql(db: string, sql: string): string {
  return execSync(`docker exec -i byos-postgres psql -U byos -d ${db}`, {
    input: sql,
    encoding: "utf8",
  });
}

export async function runHistoricalCryptoRoundtripTest(): Promise<void> {
  console.log("=== BYOS Historical Message Encryption & Decryption Roundtrip Test ===");
  const testDB = "byos_crypto_roundtrip";

  // 1. Setup disposable database from backup
  console.log(`[1/7] Initializing disposable database ${testDB} from backup...`);
  try {
    runCmd(`docker exec byos-postgres dropdb -U byos --if-exists ${testDB}`);
  } catch (_) {}
  runCmd(`docker exec byos-postgres createdb -U byos ${testDB}`);
  runCmd(`docker exec byos-postgres pg_restore -U byos -d ${testDB} --no-owner --no-privileges /tmp/byos_dev_backup.dump`);
  console.log("  ✓ Database created and pre-migration dump restored.");

  // 2. Generate Recipient X-Wing Keypair
  console.log("[2/7] Generating Recipient X-Wing Post-Quantum Keypair...");
  const seedBytes = crypto.randomBytes(32);
  const seedHex = seedBytes.toString("hex");
  const recipientPkHex = wasm_xwing_public_key_from_seed(seedHex);
  const recipientPkBytes = Buffer.from(recipientPkHex, "hex");
  console.log(`  ✓ Generated X-Wing Seed (32 bytes): ${seedHex.slice(0, 16)}...`);
  console.log(`  ✓ Derived X-Wing Public Key (${recipientPkBytes.length} bytes, expected 1216 bytes).`);
  if (recipientPkBytes.length !== 1216) {
    throw new Error(`Invalid X-Wing public key length: ${recipientPkBytes.length}`);
  }

  // 3. Create Org, Domain, and Private Mailbox in pre-migration database
  console.log("[3/7] Provisioning pre-migration Private mailbox with X-Wing public key...");
  const orgId = crypto.randomUUID();
  const domainId = crypto.randomUUID();
  const mailboxId = crypto.randomUUID();
  const domainName = `crypto-test-${Date.now()}.local`;

  runPsql(
    testDB,
    `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ('${orgId}', 'Crypto Test Org', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'));`
  );
  runPsql(
    testDB,
    `INSERT INTO domains (id, org_id, name, is_verified) VALUES ('${domainId}', '${orgId}', '${domainName}', true);`
  );
  runPsql(
    testDB,
    `INSERT INTO mailboxes (id, org_id, domain_id, local_part, mode, mailbox_xwing_pk, is_active) VALUES ('${mailboxId}', '${orgId}', '${domainId}', 'recipient', 'private', decode('${recipientPkHex}', 'hex'), true);`
  );
  console.log(`  ✓ Mailbox ${mailboxId} provisioned with mode='private'.`);

  // 4. Encrypt message and wrap content key under recipient's X-Wing PK
  console.log("[4/7] Encrypting historical message and sealing content key with HPKE-XWing...");
  const secretMessage = "CONFIDENTIAL HISTORICAL PAYLOAD: Post-quantum secrecy preserved across migration 058.";
  const payloadBytes = Buffer.from(secretMessage, "utf8");
  const cekBytes = crypto.randomBytes(32);
  const ivBytes = crypto.randomBytes(12);
  const aadBytes = Buffer.from("byos-canonical-aad-test-v1", "utf8");

  // Encrypt payload with AES-256-GCM using CEK
  const ciphertextHex = wasm_aes_gcm_encrypt(
    cekBytes.toString("hex"),
    payloadBytes.toString("hex"),
    aadBytes.toString("hex")
  );

  // Wrap CEK to recipient X-Wing PK
  const envelopeJson = wasm_seal_xwing_envelope(
    recipientPkHex,
    "key-id-1",
    1,
    cekBytes.toString("hex")
  );

  const messageId = crypto.randomUUID();
  const envelopeHex = Buffer.from(envelopeJson, "utf8").toString("hex");
  const ivHex = ivBytes.toString("hex");

  // Insert into message_metadata
  runPsql(
    testDB,
    `INSERT INTO message_metadata (
      id, mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
      storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
      encryption_iv, bundle_hash, status, wrapped_key_algorithm
    ) VALUES (
      '${messageId}', '${mailboxId}', '${domainId}', 'received', decode('AA==', 'base64'), 'sender@byos.local', ARRAY['recipient@${domainName}'],
      'storage-obj-${messageId}', decode('${envelopeHex}', 'hex'), 1,
      decode('${ivHex}', 'hex'), decode('AA==', 'base64'), 'received', 'HPKE-XWing-AES256GCM-v1'
    );`
  );
  console.log(`  ✓ Stored message ${messageId} in message_metadata with wrapped_key_algorithm='HPKE-XWing-AES256GCM-v1'.`);

  // 5. Pre-Migration Decryption Verification
  console.log("[5/7] Executing PRE-MIGRATION Decryption Verification...");
  const preMbxPkHex = runPsql(
    testDB,
    `SELECT encode(mailbox_xwing_pk, 'hex') FROM mailboxes WHERE id='${mailboxId}';`
  )
    .split("\n")[2]
    ?.trim();

  const preEnvelopeHex = runPsql(
    testDB,
    `SELECT encode(content_key_hpke_wrapped, 'hex') FROM message_metadata WHERE id='${messageId}';`
  )
    .split("\n")[2]
    ?.trim();

  const preEnvelopeJson = Buffer.from(preEnvelopeHex, "hex").toString("utf8");

  // Unwrap CEK using recipient seed
  const unwrappedCekHexPre = wasm_open_xwing_envelope(seedHex, preEnvelopeJson);
  if (unwrappedCekHexPre !== cekBytes.toString("hex")) {
    throw new Error("Pre-migration unwrapped CEK does not match original CEK!");
  }

  // Decrypt ciphertext
  const decryptedPayloadHexPre = wasm_aes_gcm_decrypt(
    unwrappedCekHexPre,
    ciphertextHex,
    aadBytes.toString("hex")
  );
  const decryptedTextPre = Buffer.from(decryptedPayloadHexPre, "hex").toString("utf8");
  const preHash = crypto.createHash("sha256").update(decryptedTextPre).digest("hex");

  console.log(`  ✓ PRE-MIGRATION Decrypted text: "${decryptedTextPre}"`);
  console.log(`  ✓ PRE-MIGRATION SHA-256: ${preHash}`);
  if (decryptedTextPre !== secretMessage) {
    throw new Error("Pre-migration decrypted text mismatch!");
  }

  // 6. Apply Migration 058
  console.log("[6/7] Applying Migration 058 (058_remove_org_managed_mailboxes.sql)...");
  runCmd(`docker cp ../../infra/postgres/init/058_remove_org_managed_mailboxes.sql byos-postgres:/tmp/058_remove_org_managed_mailboxes.sql`);
  const migOutput = runCmd(`docker exec byos-postgres psql -U byos -d ${testDB} -f /tmp/058_remove_org_managed_mailboxes.sql`);
  console.log("  ✓ Migration 058 applied successfully. Script output:");
  console.log(migOutput.trim().split("\n").map(l => "    " + l).join("\n"));

  // 7. Post-Migration Decryption Verification
  console.log("[7/7] Executing POST-MIGRATION Decryption Verification...");
  const postMbxPkHex = runPsql(
    testDB,
    `SELECT encode(mailbox_xwing_pk, 'hex') FROM mailboxes WHERE id='${mailboxId}';`
  )
    .split("\n")[2]
    ?.trim();

  if (postMbxPkHex !== preMbxPkHex) {
    throw new Error("Post-migration mailbox_xwing_pk does not match pre-migration key!");
  }
  console.log(`  ✓ Verified mailbox_xwing_pk is bit-for-bit identical after migration (1216 bytes).`);

  const postEnvelopeHex = runPsql(
    testDB,
    `SELECT encode(content_key_hpke_wrapped, 'hex') FROM message_metadata WHERE id='${messageId}';`
  )
    .split("\n")[2]
    ?.trim();

  const postEnvelopeJson = Buffer.from(postEnvelopeHex, "hex").toString("utf8");

  // Unwrap CEK using the exact same recipient seed
  const unwrappedCekHexPost = wasm_open_xwing_envelope(seedHex, postEnvelopeJson);
  if (unwrappedCekHexPost !== cekBytes.toString("hex")) {
    throw new Error("Post-migration unwrapped CEK does not match original CEK!");
  }

  // Decrypt ciphertext
  const decryptedPayloadHexPost = wasm_aes_gcm_decrypt(
    unwrappedCekHexPost,
    ciphertextHex,
    aadBytes.toString("hex")
  );
  const decryptedTextPost = Buffer.from(decryptedPayloadHexPost, "hex").toString("utf8");
  const postHash = crypto.createHash("sha256").update(decryptedTextPost).digest("hex");

  console.log(`  ✓ POST-MIGRATION Decrypted text: "${decryptedTextPost}"`);
  console.log(`  ✓ POST-MIGRATION SHA-256: ${postHash}`);

  if (decryptedTextPost !== secretMessage) {
    throw new Error("Post-migration decrypted text mismatch!");
  }
  if (postHash !== preHash) {
    throw new Error("Hash mismatch between pre-migration and post-migration decryption!");
  }

  console.log("\n========================================================");
  console.log("CRYPTOGRAPHIC VERIFICATION SUCCESSFUL:");
  console.log("Historical message encrypted with HPKE-XWing-AES256GCM-v1");
  console.log("before migration 058 decrypted bit-for-bit identically");
  console.log("after migration 058 with zero key loss or corruption.");
  console.log("========================================================");

  // Clean up disposable database
  runCmd(`docker exec byos-postgres dropdb -U byos ${testDB}`);
  console.log(`Disposable database ${testDB} dropped cleanly.`);
}

runHistoricalCryptoRoundtripTest().catch((err) => {
  console.error("Historical crypto test failed:", err);
  process.exit(1);
});
