import { applySignature, applySignatureHtml } from "./signature.js";

// Known V1 Limitations:
// - Timer is wall-clock based; if the browser suspends JS entirely (e.g. mobile background), the send may fire slightly late.
// - If the user has multiple tabs open and one queues a send, the other tabs won't see the pending send until they refresh.
// - Attachments cannot be edited during the countdown — Undo restores the payload as-is.

export interface PendingSend {
  id: string;              // UUID for sessionStorage key
  expiresAt: number;       // Unix ms
  recipient: string;
  subject: string;
  bodyPlaintext: string;   // already signature-applied
  bodyHtml: string;        // already signature-applied
  attachments: any[];      // whatever shape composeAttachments returns
  scheduledTime: string;
  trackOpens: boolean;
  mailboxId: string;
  fromAlias?: string;
  cc?: string;
  bcc?: string;
}

export function buildPendingSendPayload(params: {
  to: string;
  subject: string;
  body: string;
  bodyHtml: string;
  boxId: string;
  signatureApplied: boolean;
  sigPlain?: string;
  sigHtml?: string;
  attachments?: any[];
  scheduledTime?: string;
  trackOpens?: boolean;
  id?: string;
  expiresAt?: number;
  fromAlias?: string;
  cc?: string;
  bcc?: string;
}): PendingSend | null {
  const to = params.to.trim();
  const subject = params.subject.trim();
  const body = params.body;
  if (!to || !subject || !body.trim() || !params.boxId) return null;

  const sigPlain = params.sigPlain ?? "";
  const sigHtml = params.sigHtml ?? "";
  const signedBody = params.signatureApplied
    ? body
    : applySignature(body, sigPlain);
  const signedHtml = params.signatureApplied
    ? params.bodyHtml
    : applySignatureHtml(params.bodyHtml, sigHtml);

  const id = params.id || (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36));

  return {
    id,
    expiresAt: params.expiresAt ?? (Date.now() + 5000),
    recipient: to,
    subject,
    bodyPlaintext: signedBody,
    bodyHtml: signedHtml,
    attachments: params.attachments ?? [],
    scheduledTime: params.scheduledTime ?? "",
    trackOpens: params.trackOpens ?? false,
    mailboxId: params.boxId,
    fromAlias: params.fromAlias,
    cc: params.cc?.trim() || undefined,
    bcc: params.bcc?.trim() || undefined,
  };
}

export function restoreComposeState(
  payload: PendingSend,
  setters: {
    setTo: (v: string) => void;
    setSubject: (v: string) => void;
    setBody: (v: string) => void;
    setBodyHtml: (v: string) => void;
    setAttachments: (v: any[]) => void;
    setScheduledTime: (v: string) => void;
    setTrackOpens: (v: boolean) => void;
    setSignatureApplied: (v: boolean) => void;
    setOpen: (v: boolean) => void;
    setFromAlias?: (v: string | null) => void;
    setCc?: (v: string) => void;
    setBcc?: (v: string) => void;
  }
) {
  setters.setTo(payload.recipient);
  if (setters.setCc) setters.setCc(payload.cc || "");
  if (setters.setBcc) setters.setBcc(payload.bcc || "");
  setters.setSubject(payload.subject);
  setters.setBody(payload.bodyPlaintext);
  setters.setBodyHtml(payload.bodyHtml);
  setters.setAttachments(payload.attachments || []);
  setters.setScheduledTime(payload.scheduledTime || "");
  setters.setTrackOpens(payload.trackOpens ?? false);
  setters.setSignatureApplied(true);
  if (setters.setFromAlias) setters.setFromAlias(payload.fromAlias || null);
  setters.setOpen(true);
}

export function undoPendingSend(
  payload: PendingSend,
  storage: Storage | { removeItem: (k: string) => void },
  onRestore: (payload: PendingSend) => void,
  clearPending: () => void
) {
  clearPending();
  try {
    storage.removeItem("byos_pending_send");
  } catch {}
  onRestore(payload);
}
