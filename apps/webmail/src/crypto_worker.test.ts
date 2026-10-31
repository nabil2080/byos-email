import { cryptoWorkerBridge, type WorkerLike } from "./crypto_worker_bridge";
import {
  CryptoWorkerOp,
  type WorkerMessage,
  zeroizeBuffer,
} from "./crypto_worker_protocol";
import {
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  computeSHA256,
} from "./crypto_worker_ops";
import { handleWorkerMessage } from "./crypto_worker";
import * as wasm from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

/**
 * Creates an authentic Web Worker message channel harness using Node/Browser MessageChannel.
 * Simulates a dedicated worker thread with true message transferables detachment.
 */
function createTestWorkerHarness() {
  const { port1, port2 } = new MessageChannel();

  // port2 represents the Web Worker execution context
  port2.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    await handleWorkerMessage(event.data, (response, transfer) => {
      if (transfer && transfer.length > 0) {
        port2.postMessage(response, transfer);
      } else {
        port2.postMessage(response);
      }
    });
  };

  // port1 represents the Worker handle in the main thread
  const workerLike: WorkerLike = {
    postMessage(message: any, transfer?: Transferable[]) {
      if (transfer && transfer.length > 0) {
        port1.postMessage(message, transfer);
      } else {
        port1.postMessage(message);
      }
    },
    set onmessage(fn: ((event: MessageEvent<any>) => void) | null) {
      port1.onmessage = fn;
    },
    get onmessage() {
      return port1.onmessage;
    },
    set onerror(fn: ((error: any) => void) | null) {
      (port1 as any).onerror = fn;
    },
    get onerror() {
      return (port1 as any).onerror;
    },
    terminate() {
      port1.close();
      port2.close();
    },
  };

  return {
    worker: workerLike,
    close: () => {
      port1.close();
      port2.close();
    },
  };
}

export async function runCryptoWorkerTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ✗ ${name}:`, e.message || e);
      failed++;
    }
  }

  console.log("Running Off-Thread Crypto Web Worker & Bridge Tests...");

  // Attach the real MessageChannel worker harness to test actual off-thread message passing
  const harness = createTestWorkerHarness();
  cryptoWorkerBridge.setWorker(harness.worker);
  assert(cryptoWorkerBridge.isWorkerActive() === true, "Worker bridge must be active with attached worker");

  try {
    // 1. Worker Ping Heartbeat over Message Channel
    await test("Worker bridge ping heartbeat succeeds over message channel", async () => {
      const ok = await cryptoWorkerBridge.ping();
      assert(ok === true, "Ping must return true across worker message port");
    });

    // 2. Argon2id Passphrase Wrap & Unwrap Roundtrip over Message Channel
    await test("Argon2id passphraseWrapKey & passphraseUnwrapKey roundtrip offloaded correctly", async () => {
      const password = "SuperSecretPassword123!";
      const saltBytes = new Uint8Array(16);
      crypto.getRandomValues(saltBytes);
      const saltHex = bytesToHex(saltBytes);

      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const secretHex = bytesToHex(secretBytes);

      const envelopeHex = await cryptoWorkerBridge.passphraseWrapKey(password, saltHex, secretHex);
      assert(typeof envelopeHex === "string" && envelopeHex.length > 0, "Envelope must be non-empty hex");

      const unwrappedHex = await cryptoWorkerBridge.passphraseUnwrapKey(password, saltHex, envelopeHex);
      assert(unwrappedHex === secretHex, "Unwrapped secret must match original secret byte-for-byte");

      // Negative test: wrong password fails closed
      let threw = false;
      try {
        await cryptoWorkerBridge.passphraseUnwrapKey("WrongPassword999!", saltHex, envelopeHex);
      } catch {
        threw = true;
      }
      assert(threw, "Unwrapping with wrong password must fail closed");
    });

    // 3. Automated Key Unwrapping (autoUnwrapKeys) over Message Channel
    await test("autoUnwrapKeys derives mailboxSk, signingSeed, xwingSeed, and searchKey off-thread", async () => {
      const password = "TargetUserMasterKey!2026";
      const saltBytes = new Uint8Array(16);
      crypto.getRandomValues(saltBytes);
      const saltHex = bytesToHex(saltBytes);

      const mailboxSk = new Uint8Array(32);
      mailboxSk.fill(0x11);
      const signingSeed = new Uint8Array(32);
      signingSeed.fill(0x22);
      const xwingSeed = new Uint8Array(32);
      xwingSeed.fill(0x33);

      const mbEnv = await cryptoWorkerBridge.passphraseWrapKey(password, saltHex, bytesToHex(mailboxSk));

      const sSalt = new Uint8Array(16);
      crypto.getRandomValues(sSalt);
      const sSaltHex = bytesToHex(sSalt);
      const sEnv = await cryptoWorkerBridge.passphraseWrapKey(password, sSaltHex, bytesToHex(signingSeed));

      const xSalt = new Uint8Array(16);
      crypto.getRandomValues(xSalt);
      const xSaltHex = bytesToHex(xSalt);
      const xEnv = await cryptoWorkerBridge.passphraseWrapKey(password, xSaltHex, bytesToHex(xwingSeed));

      const wrappedSkUser = JSON.stringify({
        salt: saltHex,
        envelope: mbEnv,
        signing_salt: sSaltHex,
        signing_envelope: sEnv,
        xwing_salt: xSaltHex,
        xwing_envelope: xEnv,
      });

      const res = await cryptoWorkerBridge.autoUnwrapKeys(password, wrappedSkUser);
      assert(res.mailboxSk.length === 32, "MailboxSk must be 32 bytes");
      assert(res.mailboxSk[0] === 0x11, "MailboxSk content matches");
      assert(res.signingSeed !== null && res.signingSeed[0] === 0x22, "Signing seed content matches");
      assert(res.xwingSeed !== null && res.xwingSeed[0] === 0x33, "X-Wing seed content matches");
      assert(typeof res.searchKeyHex === "string" && res.searchKeyHex.length === 64, "Search key hex is 32 bytes (64 hex chars)");
    });

    // 4. X-Wing Hybrid Envelope Encapsulation & Decapsulation over Message Channel
    await test("X-Wing hybrid envelope seal and open roundtrip via worker pipeline", async () => {
      const recipientSkSeed = new Uint8Array(32);
      crypto.getRandomValues(recipientSkSeed);
      const recipientSkSeedHex = bytesToHex(recipientSkSeed);
      const recipientPkHex = wasm.wasm_xwing_public_key_from_seed(recipientSkSeedHex);

      const senderSigningSeed = new Uint8Array(32);
      crypto.getRandomValues(senderSigningSeed);
      const senderSigningSeedHex = bytesToHex(senderSigningSeed);

      const plaintext = JSON.stringify({ subject: "Off-thread Crypto Test", body: "Hello Post-Quantum World!" });
      const plaintextHex = bytesToHex(new TextEncoder().encode(plaintext));

      const envelopeJson = await cryptoWorkerBridge.sealXwingEnvelopeSigned(
        recipientPkHex,
        "mailbox-test-123",
        1,
        plaintextHex,
        senderSigningSeedHex
      );

      assert(typeof envelopeJson === "string", "Envelope JSON must be string");
      const env = JSON.parse(envelopeJson);
      assert(env.v === 1, "Envelope version is 1");
      assert(env.alg === "HPKE-XWing-AES256GCM-v1", "Algorithm is HPKE-XWing-AES256GCM-v1");
      assert(typeof env.sig === "string" && env.sig.length > 0, "Envelope signature must be populated");

      // Open envelope off-thread
      const decryptedHex = await cryptoWorkerBridge.openXwingEnvelope(recipientSkSeedHex, envelopeJson);
      const decryptedText = new TextDecoder().decode(hexToBytes(decryptedHex));
      assert(decryptedText === plaintext, "Decrypted message matches original plaintext");

      // Negative test: wrong seed fails closed
      const wrongSeed = new Uint8Array(32);
      crypto.getRandomValues(wrongSeed);
      let openThrew = false;
      try {
        await cryptoWorkerBridge.openXwingEnvelope(bytesToHex(wrongSeed), envelopeJson);
      } catch {
        openThrew = true;
      }
      assert(openThrew, "Decryption with wrong recipient seed must fail closed");
    });

    // 5. Multi-Chunk AES-256-GCM Attachment Pipeline over Message Channel
    await test("Multi-chunk AES-256-GCM attachment prepare and decrypt roundtrip", async () => {
      const payloadSize = 2.5 * 1024 * 1024; // 2.5 MB -> 3 chunks
      const testData = new Uint8Array(Math.floor(payloadSize));
      for (let i = 0; i < testData.length; i++) {
        testData[i] = (i * 31) & 0xff;
      }

      const recipientSkSeed = new Uint8Array(32);
      crypto.getRandomValues(recipientSkSeed);
      const recipientSkSeedHex = bytesToHex(recipientSkSeed);
      const recipientPkHex = wasm.wasm_xwing_public_key_from_seed(recipientSkSeedHex);

      const senderSkSeed = new Uint8Array(32);
      crypto.getRandomValues(senderSkSeed);
      const senderSkSeedHex = bytesToHex(senderSkSeed);
      const senderPkHex = wasm.wasm_xwing_public_key_from_seed(senderSkSeedHex);

      const prep = await cryptoWorkerBridge.preparePathAAttachment({
        file: {
          name: "confidential_spec.pdf",
          type: "application/pdf",
          data: testData,
        },
        senderMailboxId: "sender-box-01",
        recipientMailboxId: "recipient-box-02",
        recipientXWingPkHex: recipientPkHex,
        senderXWingPkHex: senderPkHex,
        messageId: "msg-worker-test",
      });

      assert(prep.recipientChunks.length === 3, "Payload of 2.5 MB splits into exactly 3 chunks");
      assert(prep.senderChunks.length === 3, "Sender sent copy splits into 3 chunks");
      assert(prep.recipientEnvelope.chunk_count === 3, "Envelope chunk count is 3");
      assert(prep.recipientEnvelope.filename === "confidential_spec.pdf", "Filename matches");

      // Decrypt off-thread as recipient
      const recipientChunkData = prep.recipientChunks.map((c) => c.data);
      const decryptedResult = await cryptoWorkerBridge.decryptPathAAttachment(
        prep.recipientEnvelope,
        recipientChunkData,
        recipientSkSeedHex,
        "recipient-box-02"
      );

      assert(decryptedResult.isCorrupted === false, "Attachment must not be corrupted");
      assert(decryptedResult.data !== undefined, "Decrypted data must be present");
      assert(decryptedResult.data!.length === testData.length, "Decrypted byte count must match exactly");
      assert(decryptedResult.data![0] === testData[0], "First byte matches");
      assert(decryptedResult.data![1000] === testData[1000], "Middle byte matches");
      assert(decryptedResult.data![testData.length - 1] === testData[testData.length - 1], "Last byte matches");

      // Decrypt off-thread as sender Sent copy
      const senderChunkData = prep.senderChunks.map((c) => c.data);
      const senderDecrypted = await cryptoWorkerBridge.decryptPathAAttachment(
        prep.senderEnvelope,
        senderChunkData,
        senderSkSeedHex,
        "sender-box-01"
      );
      assert(senderDecrypted.isCorrupted === false, "Sender copy must not be corrupted");
      assert(senderDecrypted.data!.length === testData.length, "Sender decrypted byte count matches");
    });

    // 6. Attachment Tampered Chunk Isolation over Message Channel
    await test("Tampered attachment chunk is isolated and reports specific chunk index", async () => {
      const fileBytes = new Uint8Array(2 * 1024 * 1024); // 2 MB
      fileBytes.fill(0x5a);

      const recipientSkSeed = new Uint8Array(32);
      crypto.getRandomValues(recipientSkSeed);
      const recipientSkSeedHex = bytesToHex(recipientSkSeed);
      const recipientPkHex = wasm.wasm_xwing_public_key_from_seed(recipientSkSeedHex);

      const senderSkSeed = new Uint8Array(32);
      crypto.getRandomValues(senderSkSeed);
      const senderPkHex = wasm.wasm_xwing_public_key_from_seed(bytesToHex(senderSkSeed));

      const prep = await cryptoWorkerBridge.preparePathAAttachment({
        file: { name: "tamper_test.dat", type: "application/octet-stream", data: fileBytes },
        senderMailboxId: "s1",
        recipientMailboxId: "r1",
        recipientXWingPkHex: recipientPkHex,
        senderXWingPkHex: senderPkHex,
      });

      // Tamper chunk 1
      const chunks = prep.recipientChunks.map((c) => new Uint8Array(c.data));
      chunks[1][20] ^= 0xff; // Flip bit in chunk 1 ciphertext

      const res = await cryptoWorkerBridge.decryptPathAAttachment(
        prep.recipientEnvelope,
        chunks,
        recipientSkSeedHex,
        "r1"
      );

      assert(res.isCorrupted === true, "Tampered chunk must mark attachment as corrupted");
      assert(res.error !== undefined && res.error.includes("index 1"), "Error must report chunk index 1");
      assert(res.data === undefined, "Corrupted attachment must not return partial plaintext");
    });

    // 7. Message Channel Error Handling
    await test("Worker rejects invalid operations and returns structured error", async () => {
      let threw = false;
      try {
        await cryptoWorkerBridge.dispatch("INVALID_OP" as any, {});
      } catch (e: any) {
        threw = e.message.includes("Unknown CryptoWorker operation");
      }
      assert(threw, "Invalid operation must reject with unknown op error");
    });

    // 8. Worker Timeout Handling
    await test("Worker bridge enforces operation timeout and cleans pending request", async () => {
      // Create a dummy harness that never answers
      const hangingPort: WorkerLike = {
        postMessage() {},
        onmessage: null,
      };
      cryptoWorkerBridge.setWorker(hangingPort);
      cryptoWorkerBridge.setTimeoutMs(50); // 50ms test timeout

      let timedOut = false;
      try {
        await cryptoWorkerBridge.ping();
      } catch (err: any) {
        timedOut = err.message.includes("timed out");
      }
      assert(timedOut, "Hanging worker request must reject with timeout");

      // Restore working harness and default timeout
      cryptoWorkerBridge.setWorker(harness.worker);
      cryptoWorkerBridge.setTimeoutMs(60000);
    });

    // 9. Worker Crash / Error Event Handling
    await test("Worker error event triggers crash cleanup and rejects pending requests", async () => {
      const errChannel = new MessageChannel();
      let capturedOnError: ((e: any) => void) | null = null;

      const crashableWorker: WorkerLike = {
        postMessage() {},
        onmessage: null,
        set onerror(fn: any) {
          capturedOnError = fn;
        },
        get onerror() {
          return capturedOnError;
        },
      };

      cryptoWorkerBridge.setWorker(crashableWorker);
      assert(cryptoWorkerBridge.isWorkerActive() === true, "Worker is initially active");

      const pendingPromise = cryptoWorkerBridge.ping();

      // Trigger crash
      assert(capturedOnError !== null, "onerror callback was registered");
      capturedOnError!({ message: "Out of memory simulated crash" });

      let crashRejected = false;
      try {
        await pendingPromise;
      } catch (err: any) {
        crashRejected = err.message.includes("Out of memory simulated crash");
      }
      assert(crashRejected, "Pending request must reject with crash reason");
      assert(cryptoWorkerBridge.isWorkerActive() === false, "Bridge must mark worker inactive after crash");

      // Restore working harness
      cryptoWorkerBridge.setWorker(harness.worker);
    });

    // 10. Transferable ArrayBuffer Detachment Verification
    await test("Transferable ArrayBuffer detaches buffer on message channel dispatch", async () => {
      const { port1, port2 } = new MessageChannel();
      const sourceBuffer = new Uint8Array([10, 20, 30, 40, 50]).buffer;
      assert(sourceBuffer.byteLength === 5, "Initial buffer length is 5");

      let receivedLength = 0;
      const promise = new Promise<void>((resolve) => {
        port2.onmessage = (event) => {
          const received = event.data.buf as ArrayBuffer;
          receivedLength = received.byteLength;
          resolve();
        };
      });

      port1.postMessage({ buf: sourceBuffer }, [sourceBuffer]);
      assert(sourceBuffer.byteLength === 0, "Transferred ArrayBuffer MUST be detached (byteLength === 0)");

      await promise;
      assert(receivedLength === 5, "Receiver received transferred 5-byte buffer");
      port1.close();
      port2.close();
    });

    // 11. Zero-Knowledge Memory Safety: zeroizeBuffer
    await test("zeroizeBuffer wipes sensitive in-memory bytes to 0", () => {
      const key = new Uint8Array(32);
      key.fill(0xfe);
      assert(key[0] === 0xfe && key[31] === 0xfe, "Key has non-zero bytes");

      zeroizeBuffer(key);
      assert(key[0] === 0 && key[15] === 0 && key[31] === 0, "Key bytes are strictly zeroized");

      const buf = new Uint8Array([1, 2, 3, 4]).buffer;
      zeroizeBuffer(buf);
      const view = new Uint8Array(buf);
      assert(view[0] === 0 && view[3] === 0, "ArrayBuffer bytes are strictly zeroized");
    });

    // 12. Concurrent Dispatches over Message Channel
    await test("Dispatches multiple concurrent operations across the worker message channel without interference", async () => {
      const iterations = 8;
      const promises: Promise<string>[] = [];

      for (let i = 0; i < iterations; i++) {
        const p = (async () => {
          const pass = `Password_${i}_Secret!`;
          const saltHex = bytesToHex(new Uint8Array(16).fill(i + 1));
          const dataHex = bytesToHex(new Uint8Array(32).fill(i + 10));
          const env = await cryptoWorkerBridge.passphraseWrapKey(pass, saltHex, dataHex);
          const unwrapped = await cryptoWorkerBridge.passphraseUnwrapKey(pass, saltHex, env);
          assert(unwrapped === dataHex, `Concurrent operation ${i} unwrap must match original data`);
          return unwrapped;
        })();
        promises.push(p);
      }

      const results = await Promise.all(promises);
      assert(results.length === iterations, "All concurrent dispatches resolved successfully");
    });

    // 13. Direct Execution Fallback Mode
    await test("Direct execution fallback mode operates reliably when worker is disabled", async () => {
      // Disconnect worker to simulate worker-disabled environment
      cryptoWorkerBridge.setWorker(null);
      assert(cryptoWorkerBridge.isWorkerActive() === false, "Bridge worker is inactive in fallback mode");

      const pass = "FallbackModePassword456!";
      const saltHex = bytesToHex(new Uint8Array(16).fill(0x77));
      const dataHex = bytesToHex(new Uint8Array(32).fill(0x88));

      const env = await cryptoWorkerBridge.passphraseWrapKey(pass, saltHex, dataHex);
      const unwrapped = await cryptoWorkerBridge.passphraseUnwrapKey(pass, saltHex, env);
      assert(unwrapped === dataHex, "Direct fallback mode accurately executes cryptographic operations");
    });
  } finally {
    harness.close();
    cryptoWorkerBridge.setWorker(null);
  }

  return { passed, failed };
}
