function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface SearchResult {
  message_ids: string[];
}

export async function searchMailbox(mailboxId: string, tokenHex: string): Promise<string[]> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/search?token=${encodeURIComponent(tokenHex)}`, {
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Search failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as SearchResult;
  return data.message_ids;
}

export async function indexSearchToken(mailboxId: string, messageId: string, tokenHex: string): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/mailboxes/${mailboxId}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ message_id: messageId, token: tokenHex }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Index token failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}
