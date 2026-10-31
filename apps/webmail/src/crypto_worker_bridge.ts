import {
  CryptoWorkerOp,
  type WorkerMessage,
  type WorkerResponse,
  type AutoUnwrapKeysResult,
  type Argon2WrapResult,
  type Argon2UnwrapResult,
  type XWingSealResult,
  type XWingOpenResult,
  type WrapAttachmentKeyResult,
  type UnwrapAttachmentKeyResult,
  type PreparePathAAttachmentResult,
  type DecryptPathAAttachmentResult,
  type EncryptChunkResult,
  type DecryptChunkResult,
  type AttachmentEnvelope,
  type AttachmentWrappedKey,
  type PreparedAttachment,
  type DecryptedAttachmentResult,
  type EncryptedChunkPayload,
  zeroizeBuffer,
} from "./crypto_worker_protocol";
import {
  opPing,
  opArgon2WrapKey,
  opArgon2UnwrapKey,
  opAutoUnwrapKeys,
  opXWingSealEnvelope,
  opXWingSealEnvelopeSigned,
  opXWingOpenEnvelope,
  opWrapAttachmentKey,
  opUnwrapAttachmentKey,
  opPreparePathAAttachment,
  opDecryptPathAAttachment,
  opEncryptChunk,
  opDecryptChunk,
} from "./crypto_worker_ops";
import type { UnwrappedKeys } from "./message_crypto";

export interface WorkerLike {
  postMessage(message: any, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<any>) => void) | null;
  onerror?: ((error: any) => void) | null;
  terminate?: () => void;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: any;
}

function canCreateWorker(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  if (typeof Worker === "undefined") {
    return false;
  }
  // Prevent worker fork-bomb if evaluated in a worker global scope
  const g = globalThis as any;
  if (
    typeof g.WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    self instanceof g.WorkerGlobalScope
  ) {
    return false;
  }
  return true;
}

export class CryptoWorkerBridge {
  private worker: WorkerLike | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private workerFailed = false;
  private timeoutMs = 60000; // 60s timeout for large multi-MB crypto operations

  constructor() {
    this.initWorker();
  }

  private initWorker(): void {
    if (canCreateWorker() && !this.workerFailed) {
      try {
        const workerInstance = new Worker(new URL("./crypto_worker.ts", import.meta.url), {
          type: "module",
        });
        this.setWorker(workerInstance);
      } catch (e) {
        console.warn("[CryptoWorkerBridge] Worker creation failed, using direct in-process crypto:", e);
        this.worker = null;
        this.workerFailed = true;
      }
    } else {
      this.worker = null;
    }
  }

  /**
   * Sets or attaches an active worker or port (e.g. for testing with MessageChannel or worker pooling).
   */
  public setWorker(worker: WorkerLike | null, terminatePrevious: boolean = false): void {
    if (terminatePrevious && this.worker && this.worker !== worker) {
      try {
        this.worker.terminate?.();
      } catch {}
    }
    this.worker = worker;
    this.workerFailed = false;

    if (this.worker) {
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleResponse(event.data);
      };
      this.worker.onerror = (err: any) => {
        const msg = err?.message || String(err || "Worker error");
        console.warn("[CryptoWorkerBridge] Worker error encountered:", msg);
        this.handleWorkerCrash(new Error(`Crypto worker error: ${msg}`));
      };
    }
  }

  public isWorkerActive(): boolean {
    return this.worker !== null;
  }

  public restartWorker(): void {
    this.terminate();
    this.workerFailed = false;
    this.initWorker();
  }

  public setTimeoutMs(timeout: number): void {
    this.timeoutMs = timeout;
  }

  private handleResponse(response: WorkerResponse): void {
    if (!response || !response.id) return;
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timer);

    if (response.success) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error(response.error || "Crypto worker operation failed"));
    }
  }

  public handleWorkerCrash(err: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pendingRequests.delete(id);
    }
    if (this.worker) {
      try {
        this.worker.terminate?.();
      } catch {}
      this.worker = null;
    }
    this.workerFailed = true;
  }

  public terminate(): void {
    if (this.worker) {
      try {
        this.worker.terminate?.();
      } catch {}
      this.worker = null;
    }
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Worker terminated"));
    }
    this.pendingRequests.clear();
  }

  /**
   * Internal direct in-process execution fallback
   */
  public async executeDirect<T, R>(type: CryptoWorkerOp, payload: T): Promise<R> {
    switch (type) {
      case CryptoWorkerOp.PING:
        return "PONG" as unknown as R;
      case CryptoWorkerOp.ARGON2_WRAP_KEY:
        return (await opArgon2WrapKey(payload as any)).result as unknown as R;
      case CryptoWorkerOp.ARGON2_UNWRAP_KEY:
        return (await opArgon2UnwrapKey(payload as any)).result as unknown as R;
      case CryptoWorkerOp.AUTO_UNWRAP_KEYS:
        return (await opAutoUnwrapKeys(payload as any)).result as unknown as R;
      case CryptoWorkerOp.XWING_SEAL_ENVELOPE:
        return (await opXWingSealEnvelope(payload as any)).result as unknown as R;
      case CryptoWorkerOp.XWING_SEAL_ENVELOPE_SIGNED:
        return (await opXWingSealEnvelopeSigned(payload as any)).result as unknown as R;
      case CryptoWorkerOp.XWING_OPEN_ENVELOPE:
        return (await opXWingOpenEnvelope(payload as any)).result as unknown as R;
      case CryptoWorkerOp.XWING_WRAP_ATTACHMENT_KEY:
        return (await opWrapAttachmentKey(payload as any)).result as unknown as R;
      case CryptoWorkerOp.XWING_UNWRAP_ATTACHMENT_KEY:
        return (await opUnwrapAttachmentKey(payload as any)).result as unknown as R;
      case CryptoWorkerOp.ATTACHMENT_PREPARE_PATH_A:
        return (await opPreparePathAAttachment(payload as any)).result as unknown as R;
      case CryptoWorkerOp.ATTACHMENT_DECRYPT_PATH_A:
        return (await opDecryptPathAAttachment(payload as any)).result as unknown as R;
      case CryptoWorkerOp.ATTACHMENT_ENCRYPT_CHUNK:
        return (await opEncryptChunk(payload as any)).result as unknown as R;
      case CryptoWorkerOp.ATTACHMENT_DECRYPT_CHUNK:
        return (await opDecryptChunk(payload as any)).result as unknown as R;
      default:
        throw new Error(`Unknown CryptoWorker operation: ${type}`);
    }
  }

  /**
   * Dispatches an operation across the request/response channel with transferable objects.
   */
  public async dispatch<T, R>(
    type: CryptoWorkerOp,
    payload: T,
    transferables: Transferable[] = []
  ): Promise<R> {
    if (!this.worker) {
      return this.executeDirect<T, R>(type, payload);
    }

    const id = crypto.randomUUID();
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Crypto worker operation timed out for ${type}`));
      }, this.timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      const message: WorkerMessage<T> = { id, type, payload };
      try {
        if (transferables.length > 0) {
          this.worker!.postMessage(message, transferables);
        } else {
          this.worker!.postMessage(message);
        }
      } catch (postErr) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        // Fallback to direct execution on serialization failure
        this.executeDirect<T, R>(type, payload).then(resolve).catch(reject);
      }
    });
  }

  // === Public API Methods ===

  public async ping(): Promise<boolean> {
    const res = await this.dispatch<void, string>(CryptoWorkerOp.PING, undefined);
    return res === "PONG";
  }

  public async passphraseWrapKey(
    passphrase: string,
    saltHex: string,
    plaintextHex: string
  ): Promise<string> {
    const res = await this.dispatch<{ passphrase: string; saltHex: string; plaintextHex: string }, Argon2WrapResult>(
      CryptoWorkerOp.ARGON2_WRAP_KEY,
      { passphrase, saltHex, plaintextHex }
    );
    return res.envelopeHex;
  }

  public async passphraseUnwrapKey(
    passphrase: string,
    saltHex: string,
    envelopeHex: string
  ): Promise<string> {
    const res = await this.dispatch<{ passphrase: string; saltHex: string; envelopeHex: string }, Argon2UnwrapResult>(
      CryptoWorkerOp.ARGON2_UNWRAP_KEY,
      { passphrase, saltHex, envelopeHex }
    );
    return res.keyHex;
  }

  public async autoUnwrapKeys(
    password: string,
    wrappedSkUser: string
  ): Promise<UnwrappedKeys & { searchKeyHex: string }> {
    const res = await this.dispatch<{ password: string; wrappedSkUser: string }, AutoUnwrapKeysResult>(
      CryptoWorkerOp.AUTO_UNWRAP_KEYS,
      { password, wrappedSkUser }
    );

    const mailboxSk = new Uint8Array(res.mailboxSkBuffer);
    const signingSeed = res.signingSeedBuffer ? new Uint8Array(res.signingSeedBuffer) : null;
    const xwingSeed = res.xwingSeedBuffer ? new Uint8Array(res.xwingSeedBuffer) : null;

    return {
      mailboxSk,
      signingSeed,
      xwingSeed,
      searchKeyHex: res.searchKeyHex,
    };
  }

  public async sealXwingEnvelope(
    recipientXWingPkHex: string,
    keyId: string,
    keyEpoch: number,
    plaintextHex: string
  ): Promise<string> {
    const res = await this.dispatch<
      { recipientXWingPkHex: string; keyId: string; keyEpoch: number; plaintextHex: string },
      XWingSealResult
    >(CryptoWorkerOp.XWING_SEAL_ENVELOPE, {
      recipientXWingPkHex,
      keyId,
      keyEpoch,
      plaintextHex,
    });
    return res.envelopeJson;
  }

  public async sealXwingEnvelopeSigned(
    recipientXWingPkHex: string,
    keyId: string,
    keyEpoch: number,
    plaintextHex: string,
    senderSigningSeedHex: string
  ): Promise<string> {
    const res = await this.dispatch<
      {
        recipientXWingPkHex: string;
        keyId: string;
        keyEpoch: number;
        plaintextHex: string;
        senderSigningSeedHex: string;
      },
      XWingSealResult
    >(CryptoWorkerOp.XWING_SEAL_ENVELOPE_SIGNED, {
      recipientXWingPkHex,
      keyId,
      keyEpoch,
      plaintextHex,
      senderSigningSeedHex,
    });
    return res.envelopeJson;
  }

  public async openXwingEnvelope(
    recipientXWingSkSeedHex: string,
    envelopeJson: string
  ): Promise<string> {
    const res = await this.dispatch<
      { recipientXWingSkSeedHex: string; envelopeJson: string },
      XWingOpenResult
    >(CryptoWorkerOp.XWING_OPEN_ENVELOPE, {
      recipientXWingSkSeedHex,
      envelopeJson,
    });
    return res.plaintextHex;
  }

  public async wrapAttachmentContentKey(
    contentKey: Uint8Array,
    recipientXWingPkHex: string,
    mailboxId: string
  ): Promise<AttachmentWrappedKey> {
    // Zero-knowledge memory safety: copy into transferable buffer
    const contentKeyBuffer = contentKey.buffer.slice(
      contentKey.byteOffset,
      contentKey.byteOffset + contentKey.byteLength
    ) as ArrayBuffer;

    try {
      const res = await this.dispatch<
        { contentKeyBuffer: ArrayBuffer; recipientXWingPkHex: string; mailboxId: string },
        WrapAttachmentKeyResult
      >(
        CryptoWorkerOp.XWING_WRAP_ATTACHMENT_KEY,
        {
          contentKeyBuffer,
          recipientXWingPkHex,
          mailboxId,
        },
        [contentKeyBuffer]
      );

      return res.wrappedKey;
    } finally {
      zeroizeBuffer(contentKeyBuffer);
    }
  }

  public async unwrapAttachmentContentKey(
    wrappedKey: AttachmentWrappedKey,
    recipientSkSeedHex: string,
    mailboxId: string
  ): Promise<Uint8Array> {
    const res = await this.dispatch<
      { wrappedKey: AttachmentWrappedKey; recipientSkSeedHex: string; mailboxId: string },
      UnwrapAttachmentKeyResult
    >(CryptoWorkerOp.XWING_UNWRAP_ATTACHMENT_KEY, {
      wrappedKey,
      recipientSkSeedHex,
      mailboxId,
    });

    return new Uint8Array(res.contentKeyBuffer);
  }

  public async encryptChunk(
    chunkPlaintext: Uint8Array,
    contentKey: Uint8Array,
    iv: Uint8Array
  ): Promise<Uint8Array> {
    const chunkPlaintextBuffer = chunkPlaintext.buffer.slice(
      chunkPlaintext.byteOffset,
      chunkPlaintext.byteOffset + chunkPlaintext.byteLength
    ) as ArrayBuffer;
    const contentKeyBuffer = contentKey.buffer.slice(
      contentKey.byteOffset,
      contentKey.byteOffset + contentKey.byteLength
    ) as ArrayBuffer;
    const ivBuffer = iv.buffer.slice(
      iv.byteOffset,
      iv.byteOffset + iv.byteLength
    ) as ArrayBuffer;

    try {
      const res = await this.dispatch<
        { chunkPlaintextBuffer: ArrayBuffer; contentKeyBuffer: ArrayBuffer; ivBuffer: ArrayBuffer },
        EncryptChunkResult
      >(
        CryptoWorkerOp.ATTACHMENT_ENCRYPT_CHUNK,
        {
          chunkPlaintextBuffer,
          contentKeyBuffer,
          ivBuffer,
        },
        [chunkPlaintextBuffer, contentKeyBuffer, ivBuffer]
      );

      return new Uint8Array(res.encryptedChunkBuffer);
    } finally {
      zeroizeBuffer(contentKeyBuffer);
    }
  }

  public async decryptChunk(
    encryptedChunk: Uint8Array,
    contentKey: Uint8Array,
    fallbackIV?: Uint8Array
  ): Promise<Uint8Array> {
    const encryptedChunkBuffer = encryptedChunk.buffer.slice(
      encryptedChunk.byteOffset,
      encryptedChunk.byteOffset + encryptedChunk.byteLength
    ) as ArrayBuffer;
    const contentKeyBuffer = contentKey.buffer.slice(
      contentKey.byteOffset,
      contentKey.byteOffset + contentKey.byteLength
    ) as ArrayBuffer;
    const fallbackIVBuffer = fallbackIV
      ? (fallbackIV.buffer.slice(
          fallbackIV.byteOffset,
          fallbackIV.byteOffset + fallbackIV.byteLength
        ) as ArrayBuffer)
      : undefined;

    const transferables: Transferable[] = [encryptedChunkBuffer, contentKeyBuffer];
    if (fallbackIVBuffer) transferables.push(fallbackIVBuffer);

    try {
      const res = await this.dispatch<
        { encryptedChunkBuffer: ArrayBuffer; contentKeyBuffer: ArrayBuffer; fallbackIVBuffer?: ArrayBuffer },
        DecryptChunkResult
      >(
        CryptoWorkerOp.ATTACHMENT_DECRYPT_CHUNK,
        {
          encryptedChunkBuffer,
          contentKeyBuffer,
          fallbackIVBuffer,
        },
        transferables
      );

      return new Uint8Array(res.decryptedChunkBuffer);
    } finally {
      zeroizeBuffer(contentKeyBuffer);
    }
  }

  public async preparePathAAttachment(params: {
    file: { name: string; type: string; data: Uint8Array };
    senderMailboxId: string;
    recipientMailboxId: string;
    recipientXWingPkHex: string;
    senderXWingPkHex: string;
    messageId?: string;
    zeroizeSourceData?: boolean;
  }): Promise<PreparedAttachment> {
    const dataBuffer = params.file.data.buffer.slice(
      params.file.data.byteOffset,
      params.file.data.byteOffset + params.file.data.byteLength
    ) as ArrayBuffer;

    try {
      const res = await this.dispatch<any, PreparePathAAttachmentResult>(
        CryptoWorkerOp.ATTACHMENT_PREPARE_PATH_A,
        {
          file: {
            name: params.file.name,
            type: params.file.type,
            dataBuffer,
          },
          senderMailboxId: params.senderMailboxId,
          recipientMailboxId: params.recipientMailboxId,
          recipientXWingPkHex: params.recipientXWingPkHex,
          senderXWingPkHex: params.senderXWingPkHex,
          messageId: params.messageId,
        },
        [dataBuffer]
      );

      const recipientChunks: EncryptedChunkPayload[] = res.recipientChunks.map((c) => ({
        index: c.index,
        storageRef: c.storageRef,
        data: new Uint8Array(c.dataBuffer),
      }));

      const senderChunks: EncryptedChunkPayload[] = res.senderChunks.map((c) => ({
        index: c.index,
        storageRef: c.storageRef,
        data: new Uint8Array(c.dataBuffer),
      }));

      if (params.zeroizeSourceData) {
        params.file.data.fill(0);
      }

      return {
        recipientEnvelope: res.recipientEnvelope,
        recipientChunks,
        senderEnvelope: res.senderEnvelope,
        senderChunks,
      };
    } finally {
      zeroizeBuffer(dataBuffer);
    }
  }

  public async decryptPathAAttachment(
    envelope: AttachmentEnvelope,
    chunks: Uint8Array[],
    skSeedHex: string,
    mailboxId: string
  ): Promise<DecryptedAttachmentResult> {
    const chunkBuffers: ArrayBuffer[] = chunks.map(
      (c) => c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer
    );

    const res = await this.dispatch<any, DecryptPathAAttachmentResult>(
      CryptoWorkerOp.ATTACHMENT_DECRYPT_PATH_A,
      {
        envelope,
        chunks: chunkBuffers,
        skSeedHex,
        mailboxId,
      },
      [...chunkBuffers]
    );

    return {
      isCorrupted: res.isCorrupted,
      data: res.dataBuffer ? new Uint8Array(res.dataBuffer) : undefined,
      filename: res.filename,
      mimeType: res.mimeType,
      error: res.error,
    };
  }
}

// Export singleton instance
export const cryptoWorkerBridge = new CryptoWorkerBridge();
