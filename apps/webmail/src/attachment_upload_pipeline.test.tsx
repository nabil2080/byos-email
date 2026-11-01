import { describe, it, expect, vi } from "vitest";
import {
  uploadChunksConcurrently,
  calculateAggregateProgress,
  validateAttachmentSendReadiness,
  formatBytes,
  ChunkUploadItem,
} from "./attachment_upload_pipeline";

describe("uploadChunksConcurrently", () => {
  it("handles empty chunk array gracefully", async () => {
    let callCount = 0;
    await uploadChunksConcurrently("box1", [], {
      uploadFn: async () => {
        callCount++;
      },
    });
    expect(callCount).toBe(0);
  });

  it("uploads chunks concurrently respecting concurrency limits", async () => {
    const chunks: ChunkUploadItem[] = Array.from({ length: 10 }, (_, i) => ({
      storageRef: `mailboxes/box1/attachments/chunk_${i}`,
      data: new Uint8Array([i]),
    }));

    let activeCount = 0;
    let maxConcurrent = 0;
    const uploadedRefs: string[] = [];

    await uploadChunksConcurrently("box1", chunks, {
      concurrency: 3,
      uploadFn: async (_boxId, ref) => {
        activeCount++;
        maxConcurrent = Math.max(maxConcurrent, activeCount);
        // Simulate network latency
        await new Promise((r) => setTimeout(r, 20));
        uploadedRefs.push(ref);
        activeCount--;
      },
    });

    expect(maxConcurrent).toBeLessThanOrEqual(3);
    expect(uploadedRefs.length).toBe(10);
  });

  it("retries on transient failure with backoff and succeeds", async () => {
    const chunks: ChunkUploadItem[] = [
      { storageRef: "ref1", data: new Uint8Array([1]) },
    ];

    let attempts = 0;
    await uploadChunksConcurrently("box1", chunks, {
      maxRetries: 3,
      baseDelayMs: 10,
      uploadFn: async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("HTTP 502 Bad Gateway");
        }
      },
    });

    expect(attempts).toBe(3);
  });

  it("fails closed when retries are exhausted", async () => {
    const chunks: ChunkUploadItem[] = [
      { storageRef: "ref1", data: new Uint8Array([1]) },
    ];

    let attempts = 0;
    await expect(
      uploadChunksConcurrently("box1", chunks, {
        maxRetries: 2,
        baseDelayMs: 10,
        uploadFn: async () => {
          attempts++;
          throw new Error("Persistent 500 error");
        },
      }),
    ).rejects.toThrow("Persistent 500 error");

    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it("tracks upload progress accurately via onProgress", async () => {
    const chunks: ChunkUploadItem[] = Array.from({ length: 4 }, (_, i) => ({
      storageRef: `ref_${i}`,
      data: new Uint8Array([i]),
    }));

    const progressRecords: number[] = [];

    await uploadChunksConcurrently("box1", chunks, {
      concurrency: 2,
      onProgress: (completed, total) => {
        expect(total).toBe(4);
        progressRecords.push(completed);
      },
      uploadFn: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
    });

    expect(progressRecords).toContain(4);
    expect(progressRecords.length).toBe(4);
  });

  it("tracks byte-accurate progress with unequal chunk sizes", async () => {
    // 3 chunks representing a 2.5 MB file:
    // Chunk 0: 1,000,000 bytes (40%)
    // Chunk 1: 1,000,000 bytes (40% -> 80% total)
    // Chunk 2:   500,000 bytes (20% -> 100% total)
    const chunks: ChunkUploadItem[] = [
      { storageRef: "chunk_0", data: new Uint8Array(100), plaintextBytes: 1000000 },
      { storageRef: "chunk_1", data: new Uint8Array(100), plaintextBytes: 1000000 },
      { storageRef: "chunk_2", data: new Uint8Array(50), plaintextBytes: 500000 },
    ];

    const byteReports: Array<{ completed: number; total: number; percent: number }> = [];

    await uploadChunksConcurrently("box1", chunks, {
      concurrency: 1, // Sequential execution to verify exact progression
      onByteProgress: (completed, total, percent) => {
        byteReports.push({ completed, total, percent });
      },
      uploadFn: async () => {
        await new Promise((r) => setTimeout(r, 5));
      },
    });

    expect(byteReports.length).toBe(3);

    // After Chunk 0: exactly 1,000,000 of 2,500,000 (40%, NOT 33.3%)
    expect(byteReports[0]).toEqual({ completed: 1000000, total: 2500000, percent: 40 });

    // After Chunk 1: exactly 2,000,000 of 2,500,000 (80%, NOT 66.7%)
    expect(byteReports[1]).toEqual({ completed: 2000000, total: 2500000, percent: 80 });

    // After Chunk 2: exactly 2,500,000 of 2,500,000 (100%)
    expect(byteReports[2]).toEqual({ completed: 2500000, total: 2500000, percent: 100 });
  });

  it("retries do not double-count bytes transferred", async () => {
    const chunks: ChunkUploadItem[] = [
      { storageRef: "chunk_0", data: new Uint8Array(100), plaintextBytes: 500000 },
    ];

    let attempts = 0;
    const byteReports: number[] = [];

    await uploadChunksConcurrently("box1", chunks, {
      concurrency: 1,
      maxRetries: 2,
      baseDelayMs: 10,
      onByteProgress: (completed) => {
        byteReports.push(completed);
      },
      uploadFn: async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("Temporary network blip");
        }
      },
    });

    expect(attempts).toBe(2);
    // Only 1 successful confirmation report; byte count must be exactly 500,000, never 1,000,000
    expect(byteReports.length).toBe(1);
    expect(byteReports[0]).toBe(500000);
  });

  it("aborts immediately if AbortSignal is already aborted before starting", async () => {
    const chunks: ChunkUploadItem[] = [
      { storageRef: "ref1", data: new Uint8Array([1]) },
    ];
    const controller = new AbortController();
    controller.abort();

    let callCount = 0;
    await expect(
      uploadChunksConcurrently("box1", chunks, {
        signal: controller.signal,
        uploadFn: async () => {
          callCount++;
        },
      }),
    ).rejects.toThrow("Upload aborted");

    expect(callCount).toBe(0);
  });

  it("aborts in-flight upload when signal is aborted and halts remaining chunks", async () => {
    const chunks: ChunkUploadItem[] = Array.from({ length: 10 }, (_, i) => ({
      storageRef: `ref_${i}`,
      data: new Uint8Array([i]),
    }));

    const controller = new AbortController();
    let startedCount = 0;
    let completedCount = 0;

    const promise = uploadChunksConcurrently("box1", chunks, {
      concurrency: 1,
      signal: controller.signal,
      uploadFn: async (_boxId, _ref, _bytes, signal) => {
        startedCount++;
        if (startedCount === 2) {
          controller.abort();
        }
        if (signal?.aborted) {
          throw new DOMException("Upload aborted", "AbortError");
        }
        await new Promise((r) => setTimeout(r, 15));
        if (signal?.aborted) {
          throw new DOMException("Upload aborted", "AbortError");
        }
        completedCount++;
      },
    });

    await expect(promise).rejects.toThrow("Upload aborted");
    expect(startedCount).toBeLessThanOrEqual(2);
    expect(completedCount).toBeLessThan(10);
  });

  it("cancels pending exponential backoff retry immediately on abort without waiting", async () => {
    const chunks: ChunkUploadItem[] = [
      { storageRef: "ref1", data: new Uint8Array([1]) },
    ];

    const controller = new AbortController();
    const startTime = Date.now();

    const promise = uploadChunksConcurrently("box1", chunks, {
      concurrency: 1,
      maxRetries: 3,
      baseDelayMs: 1000, // Large delay that would take >1s if not interrupted
      signal: controller.signal,
      uploadFn: async () => {
        setTimeout(() => controller.abort(), 20);
        throw new Error("HTTP 502 Temporary Server Error");
      },
    });

    await expect(promise).rejects.toThrow("Upload aborted");
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(600);
  });

  it("supports retrying failed chunks independently without restarting completed chunks", async () => {
    const chunks: ChunkUploadItem[] = [
      { storageRef: "chunk_0", data: new Uint8Array([0]) },
      { storageRef: "chunk_1", data: new Uint8Array([1]) },
      { storageRef: "chunk_2", data: new Uint8Array([2]) },
    ];

    const succeededRefs = new Set<string>();
    let chunk1FailedOnce = false;

    // First attempt: chunk_1 fails
    await expect(
      uploadChunksConcurrently("box1", chunks, {
        concurrency: 1,
        maxRetries: 0,
        uploadFn: async (_box, ref) => {
          if (ref === "chunk_1" && !chunk1FailedOnce) {
            chunk1FailedOnce = true;
            throw new Error("Network timeout on chunk_1");
          }
          succeededRefs.add(ref);
        },
      }),
    ).rejects.toThrow("Network timeout on chunk_1");

    expect(succeededRefs.has("chunk_0")).toBe(true);
    expect(succeededRefs.has("chunk_1")).toBe(false);

    // Second attempt: only upload chunks that haven't succeeded yet
    const remainingChunks = chunks.filter((c) => !succeededRefs.has(c.storageRef));
    expect(remainingChunks.length).toBe(2);

    await uploadChunksConcurrently("box1", remainingChunks, {
      concurrency: 1,
      maxRetries: 1,
      uploadFn: async (_box, ref) => {
        succeededRefs.add(ref);
      },
    });

    expect(succeededRefs.size).toBe(3);
    expect(succeededRefs.has("chunk_1")).toBe(true);
    expect(succeededRefs.has("chunk_2")).toBe(true);
  });
});

describe("calculateAggregateProgress", () => {
  it("calculates progress correctly across empty and single items", () => {
    expect(calculateAggregateProgress([])).toEqual({
      completedBytes: 0,
      totalBytes: 0,
      percent: 100,
      completedChunks: 0,
      totalChunks: 0,
    });

    expect(
      calculateAggregateProgress([
        {
          uploadStatus: "uploading",
          uploadProgress: {
            completedBytes: 500,
            totalBytes: 1000,
            completedChunks: 2,
            totalChunks: 4,
            percent: 50,
          },
        },
      ]),
    ).toEqual({
      completedBytes: 500,
      totalBytes: 1000,
      percent: 50,
      completedChunks: 2,
      totalChunks: 4,
    });
  });

  it("weights aggregate progress accurately by file size across significantly different attachments", () => {
    // File A: 2,500,000 bytes (50% complete = 1,250,000 bytes)
    // File B:    10,000 bytes (100% complete = 10,000 bytes)
    // Total = 2,510,000 bytes; completed = 1,260,000 bytes.
    // Weighted percent = 1,260,000 / 2,510,000 = 50.2% -> 50%
    const items = [
      {
        uploadStatus: "uploading" as const,
        uploadProgress: {
          completedBytes: 1250000,
          totalBytes: 2500000,
          completedChunks: 1,
          totalChunks: 2,
          percent: 50,
        },
      },
      {
        uploadStatus: "completed" as const,
        uploadProgress: {
          completedBytes: 10000,
          totalBytes: 10000,
          completedChunks: 1,
          totalChunks: 1,
          percent: 100,
        },
      },
    ];

    const result = calculateAggregateProgress(items);
    expect(result.completedBytes).toBe(1260000);
    expect(result.totalBytes).toBe(2510000);
    expect(result.percent).toBe(50);
  });

  it("updates aggregate totals consistently when an attachment is removed during upload", () => {
    const itemA = {
      id: "a",
      uploadStatus: "uploading" as const,
      uploadProgress: {
        completedBytes: 500000,
        totalBytes: 1000000,
        completedChunks: 1,
        totalChunks: 2,
        percent: 50,
      },
    };
    const itemB = {
      id: "b",
      uploadStatus: "completed" as const,
      uploadProgress: {
        completedBytes: 100000,
        totalBytes: 100000,
        completedChunks: 1,
        totalChunks: 1,
        percent: 100,
      },
    };

    let items = [itemA, itemB];
    let agg = calculateAggregateProgress(items);
    expect(agg.totalBytes).toBe(1100000);
    expect(agg.completedBytes).toBe(600000);
    expect(agg.percent).toBe(55);

    // Remove itemA: only itemB remains
    items = items.filter((i) => i.id !== "a");
    agg = calculateAggregateProgress(items);
    expect(agg.totalBytes).toBe(100000);
    expect(agg.completedBytes).toBe(100000);
    expect(agg.percent).toBe(100);
  });
});

describe("validateAttachmentSendReadiness", () => {
  it("permits sending when all attachments are completed or list is empty", () => {
    expect(validateAttachmentSendReadiness([]).canSend).toBe(true);

    const res = validateAttachmentSendReadiness([
      { id: "1", filename: "invoice.pdf", uploadStatus: "completed" },
      { id: "2", filename: "photo.jpg", uploadStatus: "completed" },
    ]);
    expect(res.canSend).toBe(true);
    expect(res.validAttachments.length).toBe(2);
  });

  it("blocks sending during preparing, encrypting, uploading, or idle states", () => {
    expect(
      validateAttachmentSendReadiness([
        { id: "1", filename: "f1.pdf", uploadStatus: "preparing" },
      ]).canSend,
    ).toBe(false);

    expect(
      validateAttachmentSendReadiness([
        { id: "1", filename: "f1.pdf", uploadStatus: "encrypting" },
      ]).canSend,
    ).toBe(false);

    expect(
      validateAttachmentSendReadiness([
        { id: "1", filename: "f1.pdf", uploadStatus: "uploading" },
      ]).canSend,
    ).toBe(false);

    expect(
      validateAttachmentSendReadiness([
        { id: "1", filename: "f1.pdf", uploadStatus: "idle" },
      ]).canSend,
    ).toBe(false);
  });

  it("blocks sending on failed attachment with specific error reason", () => {
    const res = validateAttachmentSendReadiness([
      { id: "1", filename: "bad.zip", uploadStatus: "failed", uploadError: "Storage unavailable" },
    ]);
    expect(res.canSend).toBe(false);
    expect(res.reason).toContain("failed to upload: Storage unavailable");
    expect(res.blockingAttachmentId).toBe("1");
  });

  it("blocks sending on cancelled attachment until removed or retried", () => {
    let list = [
      { id: "1", filename: "ok.pdf", uploadStatus: "completed" as const },
      { id: "2", filename: "stop.zip", uploadStatus: "cancelled" as const },
    ];

    let res = validateAttachmentSendReadiness(list);
    expect(res.canSend).toBe(false);
    expect(res.reason).toContain("was cancelled");

    // Remove the cancelled item
    list = list.filter((a) => a.id !== "2");
    res = validateAttachmentSendReadiness(list);
    expect(res.canSend).toBe(true);
    expect(res.validAttachments.length).toBe(1);
  });

  it("detects and rejects duplicate attachment IDs", () => {
    const res = validateAttachmentSendReadiness([
      { id: "same-id", filename: "file.pdf", uploadStatus: "completed" },
      { id: "same-id", filename: "file_copy.pdf", uploadStatus: "completed" },
    ]);
    expect(res.canSend).toBe(false);
    expect(res.reason).toContain("Duplicate attachment detected");
  });

  it("permits previously completed draft attachments with encrypted=true", () => {
    const res = validateAttachmentSendReadiness([
      { id: "draft-id-1", filename: "contract.pdf", encrypted: true },
    ]);
    expect(res.canSend).toBe(true);
    expect(res.validAttachments.length).toBe(1);
  });
});

describe("formatBytes", () => {
  it("formats byte values cleanly", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});
