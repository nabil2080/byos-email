function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface Attachment {
  id: string;
  mailbox_id: string;
  message_id?: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  encrypted: boolean;
  created_at: string;
}

export async function getAttachments(mailboxId: string, messageId?: string): Promise<Attachment[]> {
  let url = `${apiBase()}/v1/mailboxes/${mailboxId}/attachments`;
  if (messageId) {
    url += `?message_id=${encodeURIComponent(messageId)}`;
  }
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch attachments ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as { attachments: Attachment[] };
  return data.attachments;
}

export async function createAttachmentMetadata(
  mailboxId: string,
  filename: string,
  sizeBytes: number,
  contentType: string = "application/octet-stream",
  messageId?: string
): Promise<Attachment> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      filename,
      size_bytes: sizeBytes,
      content_type: contentType,
      message_id: messageId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to create attachment ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as Attachment;
}

export async function deleteAttachment(mailboxId: string, attachmentId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/attachments/${attachmentId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to delete attachment ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}
