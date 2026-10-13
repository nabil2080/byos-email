import {
  encryptRawEml,
  storeEncryptedStorageObject,
  importMessageMetadata,
  createImportJob,
  completeImportJob,
} from "./oauth_import";

export interface ImportOptions {
  mailboxId: string;
  mailboxKey: Uint8Array;
  provider: "gmail" | "outlook";
  accessToken: string;
  refreshToken?: string;
  folders?: string[]; // e.g. ["inbox", "sent", "archive", "trash"]
  dateRangeYears?: number; // default 2
  concurrency?: number; // capped at 5
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
  mockProviderBaseUrl?: string; // e.g. "http://127.0.0.1:9999"
}

export interface ImportProgress {
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  currentSubject?: string;
  percent: number;
  status: "running" | "paused" | "completed" | "failed" | "cancelled";
  errorMessage?: string;
}

export interface ImportSummary {
  jobId?: string;
  provider: string;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  status: "completed" | "cancelled" | "failed";
  errorMessage?: string;
}

/** Parses header fields from raw RFC 822 string */
export function parseRfc822Headers(raw: string): {
  from: string;
  to: string[];
  subject: string;
  date?: string;
  hasAttachments: boolean;
} {
  const headerBlock = raw.split(/\r?\n\r?\n/)[0] || "";
  const lines = headerBlock.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let currentKey = "";

  for (const line of lines) {
    if (/^\s+/.test(line) && currentKey) {
      headers[currentKey] += " " + line.trim();
    } else {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        currentKey = match[1].toLowerCase();
        headers[currentKey] = match[2].trim();
      }
    }
  }

  const from = headers["from"] || "unknown@source.local";
  const toRaw = [headers["to"] || "", headers["cc"] || ""].filter(Boolean).join(", ");
  const to = toRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const subject = headers["subject"] || "(No subject)";
  const ct = (headers["content-type"] || "").toLowerCase();
  const hasAttachments = ct.includes("multipart/mixed") || ct.includes("multipart/related");

  let dateISO: string | undefined;
  if (headers["date"]) {
    try {
      const d = new Date(headers["date"]);
      if (!isNaN(d.getTime())) {
        dateISO = d.toISOString();
      }
    } catch {}
  }

  return { from, to, subject, date: dateISO, hasAttachments };
}

/** Fetch with D3 rate limit handling: respects 429 Retry-After and 503 exponential backoff */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  let attempts = 0;
  const backoffDelays = [5000, 15000, 45000];

  while (true) {
    if (signal?.aborted) {
      throw new DOMException("Import aborted", "AbortError");
    }

    const res = await fetch(url, { ...init, signal });

    if (res.status === 429) {
      const retryHeader = res.headers.get("Retry-After");
      let delayMs = 5000;
      if (retryHeader) {
        const parsedSec = parseInt(retryHeader, 10);
        if (!isNaN(parsedSec) && parsedSec > 0) {
          delayMs = parsedSec * 1000;
        }
      }
      attempts++;
      if (attempts > 3) {
        throw new Error(`Rate limit exceeded (HTTP 429) after ${attempts} retries`);
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (res.status === 503) {
      if (attempts >= backoffDelays.length) {
        throw new Error(`Provider unavailable (HTTP 503) after exponential backoff`);
      }
      const delayMs = backoffDelays[attempts];
      attempts++;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    return res;
  }
}

/** Decode base64url string to text */
function decodeBase64Url(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

interface ProviderMessageItem {
  id: string;
  folderHint?: string;
  isReadHint?: boolean;
  isStarredHint?: boolean;
}

/** List messages from Gmail API */
async function listGmailMessages(
  baseUrl: string,
  accessToken: string,
  dateRangeYears: number,
  signal?: AbortSignal
): Promise<ProviderMessageItem[]> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - dateRangeYears);
  const afterStr = `${cutoffDate.getFullYear()}/${String(cutoffDate.getMonth() + 1).padStart(2, "0")}/${String(
    cutoffDate.getDate()
  ).padStart(2, "0")}`;

  const query = encodeURIComponent(`after:${afterStr}`);
  let url = `${baseUrl}/users/me/messages?q=${query}&maxResults=100`;
  const items: ProviderMessageItem[] = [];

  while (url) {
    const res = await fetchWithBackoff(
      url,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      signal
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Gmail messages: ${res.status} ${err}`);
    }

    const data = await res.json();
    if (data.messages && Array.isArray(data.messages)) {
      for (const m of data.messages) {
        items.push({ id: m.id });
      }
    }

    if (data.nextPageToken) {
      url = `${baseUrl}/users/me/messages?q=${query}&maxResults=100&pageToken=${encodeURIComponent(
        data.nextPageToken
      )}`;
    } else {
      break;
    }
  }

  return items;
}

/** Fetch a single raw RFC 822 message from Gmail */
async function fetchGmailMessageRaw(
  baseUrl: string,
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
): Promise<{ rawEml: string; labelIds: string[] }> {
  const url = `${baseUrl}/users/me/messages/${encodeURIComponent(messageId)}?format=raw`;
  const res = await fetchWithBackoff(
    url,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    signal
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch Gmail message ${messageId}: ${res.status} ${err}`);
  }

  const data = await res.json();
  const rawEml = decodeBase64Url(data.raw || "");
  const labelIds = (data.labelIds as string[]) || [];
  return { rawEml, labelIds };
}

/** List messages from Outlook / Microsoft Graph API */
async function listOutlookMessages(
  baseUrl: string,
  accessToken: string,
  dateRangeYears: number,
  signal?: AbortSignal
): Promise<ProviderMessageItem[]> {
  const cutoffDate = new Date();
  cutoffDate.setFullYear(cutoffDate.getFullYear() - dateRangeYears);
  const filter = encodeURIComponent(`receivedDateTime ge ${cutoffDate.toISOString()}`);
  let url = `${baseUrl}/me/messages?$select=id,isRead,flag,parentFolderId&$top=50&$filter=${filter}`;
  const items: ProviderMessageItem[] = [];

  while (url) {
    const res = await fetchWithBackoff(
      url,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      signal
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to list Outlook messages: ${res.status} ${err}`);
    }

    const data = await res.json();
    if (data.value && Array.isArray(data.value)) {
      for (const m of data.value) {
        items.push({
          id: m.id,
          isReadHint: m.isRead,
          isStarredHint: m.flag?.flagStatus === "flagged",
        });
      }
    }

    if (data["@odata.nextLink"]) {
      url = data["@odata.nextLink"];
    } else {
      break;
    }
  }

  return items;
}

/** Fetch a single raw RFC 822 MIME message from Outlook */
async function fetchOutlookMessageRaw(
  baseUrl: string,
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
): Promise<{ rawEml: string }> {
  const url = `${baseUrl}/me/messages/${encodeURIComponent(messageId)}/$value`;
  const res = await fetchWithBackoff(
    url,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    signal
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch Outlook message ${messageId}: ${res.status} ${err}`);
  }

  const rawEml = await res.text();
  return { rawEml };
}

/**
 * Main import runner.
 * Coordinates fetching, concurrency throttling (D3 max 5), client-side encryption (D2),
 * customer storage upload, and metadata ingestion (D5).
 */
export async function runImport(options: ImportOptions): Promise<ImportSummary> {
  const concurrency = Math.min(Math.max(options.concurrency || 5, 1), 5); // D3: capped at 5
  const dateRangeYears = options.dateRangeYears || 2;
  const signal = options.signal;

  let gmailBaseUrl = "https://gmail.googleapis.com/gmail/v1";
  let outlookBaseUrl = "https://graph.microsoft.com/v1.0";

  const isDevOrTest =
    Boolean((import.meta as any).env?.DEV) ||
    (typeof process !== "undefined" && process.env?.NODE_ENV !== "production");

  const mockUrl =
    options.mockProviderBaseUrl ||
    (isDevOrTest && typeof window !== "undefined" && (window as any).__BYOS_MOCK_IMPORT_URL__) ||
    (isDevOrTest && typeof localStorage !== "undefined" ? localStorage.getItem("byos_mock_import_url") : null);

  if (mockUrl) {
    gmailBaseUrl = `${mockUrl}/gmail/v1`;
    outlookBaseUrl = `${mockUrl}/v1.0`;
  }

  // 1. List messages from provider
  let messageItems: ProviderMessageItem[] = [];
  try {
    if (options.provider === "gmail") {
      messageItems = await listGmailMessages(
        gmailBaseUrl,
        options.accessToken,
        dateRangeYears,
        signal
      );
    } else {
      messageItems = await listOutlookMessages(
        outlookBaseUrl,
        options.accessToken,
        dateRangeYears,
        signal
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      provider: options.provider,
      total: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      status: signal?.aborted ? "cancelled" : "failed",
      errorMessage: msg,
    };
  }

  const total = messageItems.length;
  let jobId: string | undefined;

  try {
    jobId = await createImportJob(options.mailboxId, options.provider, total);
  } catch (err) {
    console.warn("Failed to create import job row:", err);
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  options.onProgress?.({
    total,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    percent: 0,
    status: "running",
  });

  // Concurrency pool (worker queue)
  let queueIndex = 0;

  async function worker(): Promise<void> {
    while (queueIndex < messageItems.length) {
      if (signal?.aborted) {
        return;
      }

      const idx = queueIndex++;
      const item = messageItems[idx];

      try {
        let rawEml = "";
        let folder = "inbox";
        let isRead = true;
        let isStarred = false;
        const labels: string[] = [];

        if (options.provider === "gmail") {
          const fetched = await fetchGmailMessageRaw(
            gmailBaseUrl,
            options.accessToken,
            item.id,
            signal
          );
          rawEml = fetched.rawEml;

          // Map Gmail labels
          if (fetched.labelIds.includes("SENT")) folder = "sent";
          else if (fetched.labelIds.includes("TRASH")) folder = "trash";
          else if (fetched.labelIds.includes("SPAM")) folder = "spam";
          else if (!fetched.labelIds.includes("INBOX")) folder = "archive";

          isRead = !fetched.labelIds.includes("UNREAD");
          isStarred = fetched.labelIds.includes("STARRED");

          for (const lid of fetched.labelIds) {
            if (!["INBOX", "SENT", "TRASH", "SPAM", "UNREAD", "STARRED", "IMPORTANT"].includes(lid)) {
              labels.push(lid);
            }
          }
        } else {
          const fetched = await fetchOutlookMessageRaw(
            outlookBaseUrl,
            options.accessToken,
            item.id,
            signal
          );
          rawEml = fetched.rawEml;
          if (item.isReadHint !== undefined) isRead = item.isReadHint;
          if (item.isStarredHint !== undefined) isStarred = item.isStarredHint;
        }

        // Parse headers from raw RFC 822
        const parsed = parseRfc822Headers(rawEml);
        const storageKey = `mailboxes/${options.mailboxId}/imported/${options.provider}/${item.id}.eml.enc`;

        // D2: Encrypt raw message client-side with user's mailbox key
        const encryptedBytes = await encryptRawEml(options.mailboxKey, options.mailboxId, rawEml);

        // Upload to customer storage
        await storeEncryptedStorageObject(options.mailboxId, storageKey, encryptedBytes);

        // Insert metadata row via API
        const metaRes = await importMessageMetadata(options.mailboxId, {
          source_provider: options.provider,
          source_message_id: item.id,
          storage_object_id: storageKey,
          sender: parsed.from,
          recipients: parsed.to,
          folder,
          is_read: isRead,
          is_starred: isStarred,
          has_attachments: parsed.hasAttachments,
          attachment_count: parsed.hasAttachments ? 1 : 0,
          size_bytes: encryptedBytes.length,
          received_at: parsed.date || new Date().toISOString(),
          wrapped_key_algorithm: "byos-imported-v1",
          labels,
        });

        if (metaRes.imported) {
          imported++;
        } else {
          skipped++;
        }

        processed++;
        options.onProgress?.({
          total,
          processed,
          imported,
          skipped,
          failed,
          currentSubject: parsed.subject,
          percent: Math.round((processed / total) * 100),
          status: "running",
        });
      } catch (itemErr: unknown) {
        if (signal?.aborted) return;
        failed++;
        processed++;
        console.warn(`Failed to import message ${item.id}:`, itemErr);
        options.onProgress?.({
          total,
          processed,
          imported,
          skipped,
          failed,
          percent: Math.round((processed / total) * 100),
          status: "running",
        });
      }
    }
  }

  // Spawn pool workers up to concurrency cap
  const workerCount = Math.min(concurrency, messageItems.length || 1);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  const finalStatus: "completed" | "cancelled" | "failed" = signal?.aborted
    ? "cancelled"
    : failed === total && total > 0
    ? "failed"
    : "completed";

  if (jobId) {
    try {
      await completeImportJob(jobId, finalStatus, imported, skipped, failed);
    } catch (err) {
      console.warn("Failed to complete import job row:", err);
    }
  }

  options.onProgress?.({
    total,
    processed,
    imported,
    skipped,
    failed,
    percent: 100,
    status: finalStatus,
  });

  return {
    jobId,
    provider: options.provider,
    total,
    imported,
    skipped,
    failed,
    status: finalStatus,
  };
}
