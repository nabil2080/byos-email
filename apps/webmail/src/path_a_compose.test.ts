import { tryPathASend, buildMimeString } from "./App";
import { bytesToBase64 } from "./message_crypto";
import { KeyDirectoryRecord, InternalSendRequest, InternalSendResponse } from "./api";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runPathAComposeTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Path A Compose & tryPathASend Tests...");

  const validSigningSeed = new Uint8Array(32);
  validSigningSeed.fill(0x33);

  const validXwingBytes = new Uint8Array(1216);
  validXwingBytes.fill(0x55);
  const validXwingB64 = bytesToBase64(validXwingBytes);

  const baseRecord: KeyDirectoryRecord = {
    email_address: "alice@example.com",
    key_id: "00000000-0000-0000-0000-000000000001",
    key_epoch: 1,
    xwing_public_key: validXwingB64,
    ed25519_signing_public_key: "ed-pk",
    signing_key_epoch: 1,
    status: "active",
    updated_at: new Date().toISOString(),
  };

  // 1. tryPathASend returns fallback on 404 lookup
  await test("1. tryPathASend returns fallback on 404 lookup", async () => {
    const res = await tryPathASend(
      {
        recipient: "external@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => {
          const err = new Error("Not found") as Error & { status: number };
          err.status = 404;
          throw err;
        },
      }
    );
    assert(res.kind === "fallback", `expected kind 'fallback', got ${res.kind}`);
  });

  // 2. tryPathASend returns fallback on network error during lookup
  await test("2. tryPathASend returns fallback on network error during lookup", async () => {
    const res = await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => {
          throw new Error("NetworkError: Failed to fetch");
        },
      }
    );
    assert(res.kind === "fallback", `expected kind 'fallback', got ${res.kind}`);
  });

  // 3. tryPathASend returns fallback when record has no xwing_public_key
  await test("3. tryPathASend returns fallback when record has no xwing_public_key", async () => {
    const res = await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => ({
          ...baseRecord,
          xwing_public_key: "",
        }),
      }
    );
    assert(res.kind === "fallback", `expected kind 'fallback', got ${res.kind}`);
  });

  // 4. tryPathASend returns fallback when xwing_public_key has wrong length
  await test("4. tryPathASend returns fallback when xwing_public_key has wrong length", async () => {
    const badLengthBytes = new Uint8Array(32); // 32 bytes instead of 1216
    const res = await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => ({
          ...baseRecord,
          xwing_public_key: bytesToBase64(badLengthBytes),
        }),
      }
    );
    assert(res.kind === "fallback", `expected kind 'fallback', got ${res.kind}`);
  });

  // 5. tryPathASend returns sent on successful submission
  await test("5. tryPathASend returns sent on successful submission", async () => {
    let capturedReq: InternalSendRequest | null = null;
    const res = await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => baseRecord,
        sealSignedEnvelope: async () => JSON.stringify({ v: 1, sig: "mock-sig" }),
        sendInternal: async (req) => {
          capturedReq = req;
          return {
            delivery_id: "del-uuid-1",
            message_id: "msg-uuid-1",
            status: "delivered",
            message_seq: 10,
          };
        },
      }
    );
    assert(res.kind === "sent", `expected kind 'sent', got ${res.kind}`);
    if (res.kind === "sent") {
      assert(res.messageId === "msg-uuid-1", `expected messageId 'msg-uuid-1', got ${res.messageId}`);
    }
    assert(capturedReq !== null, "sendInternal should have been called");
    assert(capturedReq!.recipient === "alice@example.com", "recipient matches");
    assert(capturedReq!.sender_mailbox_id === "box-1", "sender_mailbox_id matches");
  });

  // 6. tryPathASend returns failed when server rejects envelope
  await test("6. tryPathASend returns failed when server rejects envelope", async () => {
    const res = await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => baseRecord,
        sealSignedEnvelope: async () => JSON.stringify({ v: 1, sig: "mock-sig" }),
        sendInternal: async () => {
          throw new Error("invalid_signature");
        },
      }
    );
    assert(res.kind === "failed", `expected kind 'failed', got ${res.kind}`);
    if (res.kind === "failed") {
      assert(res.error.includes("invalid_signature"), `expected error to mention invalid_signature, got ${res.error}`);
    }
  });

  // 7. tryPathASend returns failed when local WASM throws
  await test("7. tryPathASend returns failed when local WASM throws", async () => {
    const res = await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => baseRecord,
        sealSignedEnvelope: async () => {
          throw new Error("WASM signature error");
        },
        sendInternal: async () => {
          throw new Error("should not be reached");
        },
      }
    );
    assert(res.kind === "failed", `expected kind 'failed', got ${res.kind}`);
    if (res.kind === "failed") {
      assert(res.error.includes("Local encryption failed"), `expected error to mention local encryption, got ${res.error}`);
      assert(res.error.includes("WASM signature error"), `expected error to mention WASM signature error, got ${res.error}`);
    }
  });

  // 8. buildMimeString helper verification
  await test("8. buildMimeString produces valid plain MIME and multipart MIME", async () => {
    const plain = buildMimeString({
      to: "bob@example.com",
      subject: "Hello",
      signedBody: "Plain body",
      htmlBody: "",
    });
    assert(plain.includes("To: bob@example.com"), "plain includes To");
    assert(plain.includes("Content-Type: text/plain; charset=utf-8"), "plain Content-Type");
    assert(plain.includes("Plain body"), "plain body included");

    const rich = buildMimeString({
      to: "bob@example.com",
      subject: "Hello",
      signedBody: "Plain body",
      htmlBody: "<p>Rich body</p>",
      body: "Plain body",
    });
    assert(rich.includes("Content-Type: multipart/alternative"), "rich is multipart/alternative");
    assert(rich.includes("<p>Rich body</p>"), "rich html included");
    assert(rich.includes("Plain body"), "rich plain body included");
  });

  // 9. tryPathASend with senderXwingSeed produces sender_envelope_json in send payload
  await test("9. tryPathASend with senderXwingSeed produces sender_envelope_json in send payload", async () => {
    let capturedReq: InternalSendRequest | null = null;
    const validSenderXwingSeed = new Uint8Array(32);
    validSenderXwingSeed.fill(0x77);

    const res = await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: hi\r\n\r\nBody",
        signingSeed: validSigningSeed,
        senderXwingSeed: validSenderXwingSeed,
      },
      {
        lookupMailboxKeys: async () => baseRecord,
        sealSignedEnvelope: async (_pk, keyId) => JSON.stringify({ v: 1, key_id: keyId, sig: "mock-sig" }),
        sendInternal: async (req) => {
          capturedReq = req;
          return {
            delivery_id: "del-uuid-1",
            message_id: "msg-uuid-1",
            status: "delivered",
            message_seq: 10,
          };
        },
      }
    );
    assert(res.kind === "sent", `expected kind 'sent', got ${res.kind}`);
    assert(capturedReq !== null, "sendInternal should have been called");
    assert(typeof capturedReq!.sender_envelope_json === "string", "sender_envelope_json is present");
    assert(capturedReq!.sender_envelope_json!.includes("box-1"), "sender_envelope_json has sender key_id");
  });

  // 10. test_path_a_send_with_attachments_signs_correct_payload
  await test("10. test_path_a_send_with_attachments_signs_correct_payload: signed byte range is identical with and without attachments", async () => {
    let capturedSignedPayloadNoAtt: string | null = null;
    let capturedSignedPayloadWithAtt: string | null = null;

    const mockSeal = async (
      _pk: string,
      _keyId: string,
      _epoch: number,
      plaintextHex: string,
      _signingSeedHex: string
    ) => {
      return JSON.stringify({ v: 1, key_id: _keyId, ptHexLen: plaintextHex.length, sig: "mock-sig" });
    };

    // Send without attachments
    await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: test payload\r\n\r\nHello World",
        signingSeed: validSigningSeed,
      },
      {
        lookupMailboxKeys: async () => baseRecord,
        sealSignedEnvelope: async (_pk, _keyId, _epoch, ptHex, _seed) => {
          capturedSignedPayloadNoAtt = ptHex;
          return JSON.stringify({ v: 1, key_id: _keyId, sig: "sig1" });
        },
        sendInternal: async () => ({
          delivery_id: "del-1",
          message_id: "msg-1",
          status: "delivered",
          message_seq: 1,
        }),
      }
    );

    // Send with attachments
    const dummyAtt = {
      attachment_id: "att-123",
      filename: "test.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      iv: "dummy-iv",
      wrapped_key: {
        x25519_encapsulated: "encap",
        mlkem_encrypted_key: "mlkem",
      },
      content_hash_sha256: "hash",
      chunk_count: 1,
      chunks: [{ index: 0, storage_ref: "path-a-attachments/box-1/att-123/chunk_000.enc", size_bytes: 1024 }],
    };

    await tryPathASend(
      {
        recipient: "alice@example.com",
        senderMailboxId: "box-1",
        mimeMessage: "Subject: test payload\r\n\r\nHello World",
        signingSeed: validSigningSeed,
        attachmentEnvelopes: [dummyAtt],
        senderAttachmentEnvelopes: [dummyAtt],
      },
      {
        lookupMailboxKeys: async () => baseRecord,
        sealSignedEnvelope: async (_pk, _keyId, _epoch, ptHex, _seed) => {
          capturedSignedPayloadWithAtt = ptHex;
          return JSON.stringify({ v: 1, key_id: _keyId, sig: "sig2" });
        },
        sendInternal: async () => ({
          delivery_id: "del-2",
          message_id: "msg-2",
          status: "delivered",
          message_seq: 2,
        }),
      }
    );

    assert(capturedSignedPayloadNoAtt !== null, "captured signed payload without attachments");
    assert(capturedSignedPayloadWithAtt !== null, "captured signed payload with attachments");
    assert(
      capturedSignedPayloadNoAtt === capturedSignedPayloadWithAtt,
      "signed payload byte range must be identical whether attachments are present or absent"
    );
  });

  return { passed, failed };
}

