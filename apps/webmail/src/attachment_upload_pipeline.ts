export interface ChunkUploadItem {
  storageRef: string;
  data: Uint8Array;
  plaintextBytes?: number;
}

export type ChunkUploadFn = (
  mailboxId: string,
  storageRef: string,
  chunkBytes: Uint8Array,
  signal?: AbortSignal,
) => Promise<void>;

export interface ChunkUploadOptions {
  concurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  onProgress?: (completedChunks: number, totalChunks: number) => void;
  onByteProgress?: (completedBytes: number, totalBytes: number, percent: number) => void;
  uploadFn?: ChunkUploadFn;
  signal?: AbortSignal;
}

export type AttachmentUploadStatus =
  | "idle"
  | "preparing"
  | "encrypting"
  | "uploading"
  | "completed"
  | "failed"
  | "cancelled";

export interface AttachmentUploadProgress {
  completedBytes: number;
  totalBytes: number;
  completedChunks: number;
  totalChunks: number;
  percent: number;
}

export interface AggregateUploadProgress {
  completedBytes: number;
  totalBytes: number;
  percent: number;
  completedChunks: number;
  totalChunks: number;
}

/**
 * Formats a byte count into a human-readable string (B, KB, MB).
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Calculates byte-accurate aggregate upload progress across multiple attachment items.
 * Weighted strictly by file byte size so large files are not distorted by smaller files.
 */
export function calculateAggregateProgress(
  items: Array<{
    uploadProgress?: Partial<AttachmentUploadProgress>;
    uploadStatus?: AttachmentUploadStatus;
    size_bytes?: number;
    byte_size?: number;
  }>,
): AggregateUploadProgress {
  if (items.length === 0) {
    return {
      completedBytes: 0,
      totalBytes: 0,
      percent: 100,
      completedChunks: 0,
      totalChunks: 0,
    };
  }

  let aggregateCompletedBytes = 0;
  let aggregateTotalBytes = 0;
  let aggregateCompletedChunks = 0;
  let aggregateTotalChunks = 0;

  for (const item of items) {
    const itemTotal = item.uploadProgress?.totalBytes ?? item.byte_size ?? item.size_bytes ?? 0;
    aggregateTotalBytes += itemTotal;

    if (item.uploadProgress && typeof item.uploadProgress.totalBytes === "number" && item.uploadProgress.totalBytes > 0) {
      // Use exact reported byte progress
      const reportedCompleted = item.uploadProgress.completedBytes ?? 0;
      aggregateCompletedBytes += Math.min(reportedCompleted, itemTotal);
      aggregateCompletedChunks += item.uploadProgress.completedChunks ?? 0;
      aggregateTotalChunks += item.uploadProgress.totalChunks ?? 1;
    } else if (item.uploadStatus === "completed") {
      // Completed items contribute 100% of their bytes
      aggregateCompletedBytes += itemTotal;
      aggregateCompletedChunks += 1;
      aggregateTotalChunks += 1;
    } else {
      // In-flight, failed, or cancelled items without progress contribute 0 completed bytes
      aggregateCompletedChunks += 0;
      aggregateTotalChunks += 1;
    }
  }

  const safeCompleted = Math.min(aggregateCompletedBytes, aggregateTotalBytes);
  const percent = aggregateTotalBytes > 0
    ? Math.min(100, Math.round((safeCompleted / aggregateTotalBytes) * 100))
    : 100;

  return {
    completedBytes: safeCompleted,
    totalBytes: aggregateTotalBytes,
    percent,
    completedChunks: aggregateCompletedChunks,
    totalChunks: aggregateTotalChunks,
  };
}

export interface AttachmentReadyCandidate {
  id: string;
  filename: string;
  uploadStatus?: AttachmentUploadStatus;
  uploadError?: string | null;
  encrypted?: boolean;
  size_bytes?: number;
  byte_size?: number;
}

export interface SendReadinessResult<T = unknown> {
  canSend: boolean;
  reason?: string;
  blockingAttachmentId?: string;
  validAttachments: T[];
}

/**
 * Centralized send-readiness validation for both normal compose and scheduled drafts.
 * Ensures:
 * 1. Every newly selected attachment must complete preparation, encryption, and upload.
 * 2. In-flight (preparing, encrypting, uploading, idle) states block sending.
 * 3. Failed attachments block sending until retried or removed.
 * 4. Cancelled attachments block sending until retried or removed.
 * 5. Existing draft attachments with encrypted=true normalize to completed and are validated.
 * 6. Duplicate attachments are detected and rejected.
 */
export function validateAttachmentSendReadiness<T extends AttachmentReadyCandidate>(
  attachments: T[] = [],
): SendReadinessResult<T> {
  const seenIds = new Set<string>();
  const validAttachments: T[] = [];

  for (const att of attachments) {
    if (!att || !att.id) {
      return {
        canSend: false,
        reason: "Attachment has invalid metadata (missing id).",
        validAttachments: [],
      };
    }

    if (seenIds.has(att.id)) {
      return {
        canSend: false,
        reason: `Duplicate attachment detected: "${att.filename || att.id}"`,
        blockingAttachmentId: att.id,
        validAttachments: [],
      };
    }
    seenIds.add(att.id);

    // Normalize status: existing draft attachments with encrypted=true default to "completed"
    const status: AttachmentUploadStatus =
      att.uploadStatus ?? (att.encrypted ? "completed" : "idle");

    if (status === "preparing") {
      return {
        canSend: false,
        reason: `Attachment "${att.filename || "file"}" is preparing. Please wait for completion.`,
        blockingAttachmentId: att.id,
        validAttachments: [],
      };
    }
    if (status === "encrypting") {
      return {
        canSend: false,
        reason: `Attachment "${att.filename || "file"}" is encrypting. Please wait for completion.`,
        blockingAttachmentId: att.id,
        validAttachments: [],
      };
    }
    if (status === "uploading") {
      return {
        canSend: false,
        reason: `Attachment "${att.filename || "file"}" is uploading. Please wait for completion.`,
        blockingAttachmentId: att.id,
        validAttachments: [],
      };
    }
    if (status === "idle") {
      return {
        canSend: false,
        reason: `Attachment "${att.filename || "file"}" has not started uploading.`,
        blockingAttachmentId: att.id,
        validAttachments: [],
      };
    }
    if (status === "failed") {
      return {
        canSend: false,
        reason: `Attachment "${att.filename || "file"}" failed to upload: ${att.uploadError || "unknown error"}. Please retry or remove it before sending.`,
        blockingAttachmentId: att.id,
        validAttachments: [],
      };
    }
    if (status === "cancelled") {
      return {
        canSend: false,
        reason: `Attachment "${att.filename || "file"}" was cancelled. Please retry or remove it before sending.`,
        blockingAttachmentId: att.id,
        validAttachments: [],
      };
    }

    if (status === "completed") {
      if (!att.filename) {
        return {
          canSend: false,
          reason: "Attachment has invalid metadata (missing filename).",
          blockingAttachmentId: att.id,
          validAttachments: [],
        };
      }
      validAttachments.push(att);
    }
  }

  return {
    canSend: true,
    validAttachments,
  };
}

/**
 * Uploads attachment chunks concurrently with bounded concurrency,
 * exponential backoff retry on transient errors, abort-signal cancellation,
 * and accurate byte-based progress tracking.
 */
export async function uploadChunksConcurrently(
  mailboxId: string,
  chunks: ChunkUploadItem[],
  options: ChunkUploadOptions = {},
): Promise<void> {
  if (chunks.length === 0) {
    return;
  }

  if (options.signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }

  const concurrency = Math.max(1, Math.min(options.concurrency ?? 4, 8));
  const maxRetries = Math.max(0, options.maxRetries ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 150;
  const uploadFn: ChunkUploadFn =
    options.uploadFn ??
    (async (boxId: string, ref: string, bytes: Uint8Array, sig?: AbortSignal) => {
      const { uploadAttachmentChunk } = await import("./api");
      return uploadAttachmentChunk(boxId, ref, bytes, undefined, sig);
    });

  const totalBytes = chunks.reduce(
    (sum, c) => sum + (c.plaintextBytes ?? c.data.length),
    0,
  );
  let completedBytes = 0;
  let completedCount = 0;
  let nextIndex = 0;
  let firstError: Error | null = null;

  async function uploadWithRetry(item: ChunkUploadItem): Promise<void> {
    let attempt = 0;
    while (true) {
      if (options.signal?.aborted) {
        throw new DOMException("Upload aborted", "AbortError");
      }
      try {
        await uploadFn(mailboxId, item.storageRef, item.data, options.signal);
        return;
      } catch (err: unknown) {
        const isAbort =
          options.signal?.aborted ||
          (err instanceof DOMException && err.name === "AbortError") ||
          (typeof err === "object" && err !== null && (err as { name?: string }).name === "AbortError");

        if (isAbort) {
          throw err instanceof Error ? err : new DOMException("Upload aborted", "AbortError");
        }

        attempt++;
        if (attempt > maxRetries) {
          throw err instanceof Error ? err : new Error(String(err));
        }

        // Exponential backoff with jitter, cancellable via AbortSignal
        const backoffMs = Math.min(
          baseDelayMs * 2 ** (attempt - 1) + Math.random() * 50,
          2000,
        );

        await new Promise<void>((resolve, reject) => {
          if (options.signal?.aborted) {
            reject(new DOMException("Upload aborted", "AbortError"));
            return;
          }
          const timer = setTimeout(() => {
            cleanup();
            resolve();
          }, backoffMs);
          const onAbort = () => {
            cleanup();
            reject(new DOMException("Upload aborted", "AbortError"));
          };
          function cleanup() {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
          }
          options.signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
  }

  async function worker(): Promise<void> {
    while (nextIndex < chunks.length && !firstError) {
      if (options.signal?.aborted) {
        if (!firstError) {
          firstError = new DOMException("Upload aborted", "AbortError");
        }
        break;
      }

      const currentIndex = nextIndex++;
      const item = chunks[currentIndex];

      try {
        await uploadWithRetry(item);
        completedCount++;
        completedBytes += item.plaintextBytes ?? item.data.length;
        const safeBytes = Math.min(completedBytes, totalBytes);
        const percent = totalBytes > 0 ? Math.min(100, Math.round((safeBytes / totalBytes) * 100)) : 100;

        if (options.onByteProgress) {
          options.onByteProgress(safeBytes, totalBytes, percent);
        }
        if (options.onProgress) {
          options.onProgress(completedCount, chunks.length);
        }
      } catch (err: unknown) {
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
