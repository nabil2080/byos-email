import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./attachment_crypto", () => ({
  encryptAttachmentBytes: vi.fn(),
  decryptAttachmentBytes: vi.fn(),
}));

import { uploadAttachmentChunk } from "./api";

describe("uploadAttachmentChunk (Raw Binary Transfer)", () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ status: "stored", object_key: "test-ref", size_bytes: 4 }),
      text: async () => JSON.stringify({ status: "stored", object_key: "test-ref", size_bytes: 4 }),
    });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends raw binary body with application/octet-stream and X-Object-Key header", async () => {
    const mailboxId = "mbx-uuid-123";
    const storageRef = `mailboxes/${mailboxId}/attachments/msg-1/chunk_000.enc`;
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);

    await uploadAttachmentChunk(mailboxId, storageRef, payload, "test-token-xyz");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toContain(`/v1/mailboxes/${mailboxId}/attachment-chunks`);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(init.headers["X-Object-Key"]).toBe(storageRef);
    expect(init.headers["Authorization"]).toBe("Bearer test-token-xyz");
    expect(init.headers["X-BYOS-Client"]).toBe("webmail");

    // Must NOT be JSON string
    expect(typeof init.body).not.toBe("string");
    // Body must match payload bytes directly
    expect(init.body).toEqual(payload);
  });

  it("correctly handles Uint8Array view with nonzero byteOffset and restricted byteLength", async () => {
    const mailboxId = "mbx-uuid-456";
    const storageRef = `mailboxes/${mailboxId}/attachments/msg-2/chunk_001.enc`;

    // Create an ArrayBuffer with prefix and suffix garbage bytes
    const backingBuffer = new ArrayBuffer(16);
    const fullView = new Uint8Array(backingBuffer);
    fullView.set([0x00, 0x11, 0x22, 0x33, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44, 0x33]);

    // Construct a sub-view offset by 4 bytes with length 5 (exact bytes: [0xaa, 0xbb, 0xcc, 0xdd, 0xee])
    const subView = new Uint8Array(backingBuffer, 4, 5);
    expect(subView.byteOffset).toBe(4);
    expect(subView.byteLength).toBe(5);

    await uploadAttachmentChunk(mailboxId, storageRef, subView, "test-token-abc");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];

    // Transmitted bytes must be exactly the 5 sub-view bytes
    const transmitted = new Uint8Array(init.body);
    expect(transmitted.length).toBe(5);
    expect(Array.from(transmitted)).toEqual([0xaa, 0xbb, 0xcc, 0xdd, 0xee]);
  });

  it("preserves full-buffer Uint8Array directly without unnecessary copies", async () => {
    const mailboxId = "mbx-uuid-789";
    const storageRef = `mailboxes/${mailboxId}/attachments/msg-3/chunk_002.enc`;
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

    await uploadAttachmentChunk(mailboxId, storageRef, payload, "token-123");

    const [, init] = fetchMock.mock.calls[0];
    // Exact instance identity preserved when offset is 0 and length equals buffer length
    expect(init.body).toBe(payload);
  });

  it("throws with error status when backend responds with failure", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "object_key outside mailbox scope",
    });

    const mailboxId = "mbx-uuid-123";
    const invalidStorageRef = "mailboxes/other-mailbox/secret.enc";
    const payload = new Uint8Array([1, 2, 3]);

    await expect(
      uploadAttachmentChunk(mailboxId, invalidStorageRef, payload, "test-token")
    ).rejects.toThrow(/outside mailbox scope/);
  });
});
