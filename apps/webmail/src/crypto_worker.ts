import {
  CryptoWorkerOp,
  type WorkerMessage,
  type WorkerResponse,
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

export type MessageSender = (response: WorkerResponse, transfer?: Transferable[]) => void;

/**
 * Handles an incoming message payload offloaded to the worker.
 */
export async function handleWorkerMessage(
  data: WorkerMessage,
  postMessage: MessageSender
): Promise<void> {
  const { id, type, payload } = data;

  try {
    let outcome: { result: unknown; transferables: Transferable[] };

    switch (type) {
      case CryptoWorkerOp.PING:
        outcome = opPing();
        break;

      case CryptoWorkerOp.ARGON2_WRAP_KEY:
        outcome = await opArgon2WrapKey(payload as any);
        break;

      case CryptoWorkerOp.ARGON2_UNWRAP_KEY:
        outcome = await opArgon2UnwrapKey(payload as any);
        break;

      case CryptoWorkerOp.AUTO_UNWRAP_KEYS:
        outcome = await opAutoUnwrapKeys(payload as any);
        break;

      case CryptoWorkerOp.XWING_SEAL_ENVELOPE:
        outcome = await opXWingSealEnvelope(payload as any);
        break;

      case CryptoWorkerOp.XWING_SEAL_ENVELOPE_SIGNED:
        outcome = await opXWingSealEnvelopeSigned(payload as any);
        break;

      case CryptoWorkerOp.XWING_OPEN_ENVELOPE:
        outcome = await opXWingOpenEnvelope(payload as any);
        break;

      case CryptoWorkerOp.XWING_WRAP_ATTACHMENT_KEY:
        outcome = await opWrapAttachmentKey(payload as any);
        break;

      case CryptoWorkerOp.XWING_UNWRAP_ATTACHMENT_KEY:
        outcome = await opUnwrapAttachmentKey(payload as any);
        break;

      case CryptoWorkerOp.ATTACHMENT_PREPARE_PATH_A:
        outcome = await opPreparePathAAttachment(payload as any);
        break;

      case CryptoWorkerOp.ATTACHMENT_DECRYPT_PATH_A:
        outcome = await opDecryptPathAAttachment(payload as any);
        break;

      case CryptoWorkerOp.ATTACHMENT_ENCRYPT_CHUNK:
        outcome = await opEncryptChunk(payload as any);
        break;

      case CryptoWorkerOp.ATTACHMENT_DECRYPT_CHUNK:
        outcome = await opDecryptChunk(payload as any);
        break;

      default:
        throw new Error(`Unknown CryptoWorker operation: ${type}`);
    }

    const response: WorkerResponse = {
      id,
      success: true,
      result: outcome.result,
    };

    if (outcome.transferables && outcome.transferables.length > 0) {
      postMessage(response, outcome.transferables);
    } else {
      postMessage(response);
    }
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
        ? err
        : "Unknown cryptographic error";

    const errorResponse: WorkerResponse = {
      id,
      success: false,
      error: errorMsg,
    };
    postMessage(errorResponse);
  }
}

// Bind event listener if running in a Web Worker context
if (
  typeof self !== "undefined" &&
  typeof (self as any).postMessage === "function" &&
  typeof (self as any).importScripts === "function"
) {
  self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    await handleWorkerMessage(event.data, (response, transfer) => {
      if (transfer && transfer.length > 0) {
        (self as any).postMessage(response, transfer);
      } else {
        (self as any).postMessage(response);
      }
    });
  };
}
