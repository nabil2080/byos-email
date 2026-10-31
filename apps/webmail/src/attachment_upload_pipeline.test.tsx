import { describe, it, expect, vi } from "vitest";
import { uploadChunksConcurrently, ChunkUploadItem } from "./attachment_upload_pipeline";

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
});
