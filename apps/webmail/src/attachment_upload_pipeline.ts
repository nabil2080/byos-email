export interface ChunkUploadItem {
  storageRef: string;
  data: Uint8Array;
}

export type ChunkUploadFn = (mailboxId: string, storageRef: string, chunkBytes: Uint8Array) => Promise<void>;

export interface ChunkUploadOptions {
  concurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  onProgress?: (completed: number, total: number) => void;
  uploadFn?: ChunkUploadFn;
}

/**
 * Uploads attachment chunks concurrently with bounded concurrency,
 * exponential backoff retry on transient errors, and progress tracking.
 */
export async function uploadChunksConcurrently(
  mailboxId: string,
  chunks: ChunkUploadItem[],
  options: ChunkUploadOptions = {},
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 150;
  const uploadFn: ChunkUploadFn =
    options.uploadFn ??
    (async (boxId: string, ref: string, bytes: Uint8Array) => {
      const { uploadAttachmentChunk } = await import("./api");
      return uploadAttachmentChunk(boxId, ref, bytes);
    });

  let completedCount = 0;
  let nextIndex = 0;
  let firstError: Error | null = null;

  async function uploadWithRetry(item: ChunkUploadItem): Promise<void> {
    let attempt = 0;
    while (true) {
      try {
        await uploadFn(mailboxId, item.storageRef, item.data);
        return;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) {
          throw err instanceof Error ? err : new Error(String(err));
        }
        // Exponential backoff with jitter
        const backoffMs = Math.min(
          baseDelayMs * 2 ** (attempt - 1) + Math.random() * 50,
          2000,
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < chunks.length && !firstError) {
      const currentIndex = nextIndex++;
      const item = chunks[currentIndex];

      try {
        await uploadWithRetry(item);
        completedCount++;
        if (options.onProgress) {
          options.onProgress(completedCount, chunks.length);
        }
      } catch (err) {
        if (!firstError) {
          firstError = err instanceof Error ? err : new Error(String(err));
        }
        break;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, chunks.length) },
    () => worker(),
  );

  await Promise.all(workers);

  if (firstError) {
    throw firstError;
  }
}
