import { Component, createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { importEmail, MailboxFolder } from "../../api";
import { streamMbox } from "../../mbox_stream";
import { runWithConcurrency } from "../../import_queue";
import { resolveTargetFolder, ByosFolder } from "../../mbox_labels";

export const UPLOAD_CONCURRENCY = 4;

export interface ImportEmailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mailboxId: string;
  folders: MailboxFolder[];
  userEmail?: string;
  onSuccess: () => void;
}

interface ParsedEmailItem {
  id: string;
  fileName: string;
  subject: string;
  sender: string;
  date: string;
  sizeBytes: number;
  rawB64: string;
  targetFolder?: ByosFolder | null;
  status: "pending" | "importing" | "imported" | "duplicate" | "error";
  errorMsg?: string;
}

export const ImportEmailsModal: Component<ImportEmailsModalProps> = (props) => {
  const [items, setItems] = createSignal<ParsedEmailItem[]>([]);
  const [targetFolder, setTargetFolder] = createSignal<string>("inbox");
  const [markAsRead, setMarkAsRead] = createSignal<boolean>(true);
  const [isProcessingFiles, setIsProcessingFiles] = createSignal<boolean>(false);
  const [isImporting, setIsImporting] = createSignal<boolean>(false);
  const [importProgress, setImportProgress] = createSignal<{ current: number; total: number }>({ current: 0, total: 0 });
  const [importStats, setImportStats] = createSignal<{ rate: number; etaSeconds: number | null }>({ rate: 0, etaSeconds: null });
  const [importSummary, setImportSummary] = createSignal<{ imported: number; duplicates: number; failed: number } | null>(null);
  const [isDragging, setIsDragging] = createSignal<boolean>(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [accordionOpen, setAccordionOpen] = createSignal<boolean>(false);

  // Tab unload protection while import is active
  createEffect(() => {
    if (isImporting()) {
      const handler = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "Import is in progress. Are you sure you want to leave?";
      };
      window.addEventListener("beforeunload", handler);
      onCleanup(() => window.removeEventListener("beforeunload", handler));
    }
  });

  createEffect(() => {
    if (props.isOpen) {
      setItems([]);
      setTargetFolder("inbox");
      setMarkAsRead(true);
      setIsProcessingFiles(false);
      setIsImporting(false);
      setImportProgress({ current: 0, total: 0 });
      setImportStats({ rate: 0, etaSeconds: null });
      setImportSummary(null);
      setErrorMessage(null);
      setAccordionOpen(false);
    }
  });

  function extractHeader(headersText: string, headerName: string): string {
    const regex = new RegExp(`^${headerName}:\\s*(.*)$`, "im");
    const match = headersText.match(regex);
    if (!match) return "";
    return match[1].trim();
  }

  function parseRFC822(rawText: string, rawBytes: Uint8Array, fileName: string): ParsedEmailItem {
    const headerEndIdx = rawText.search(/\r?\n\r?\n/);
    const headers = headerEndIdx !== -1 ? rawText.substring(0, headerEndIdx) : rawText;

    const subjectRaw = extractHeader(headers, "Subject");
    const fromRaw = extractHeader(headers, "From");
    const dateRaw = extractHeader(headers, "Date");

    const CHUNK_SIZE = 0x8000;
    let binary = "";
    for (let i = 0; i < rawBytes.length; i += CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, Array.from(rawBytes.subarray(i, i + CHUNK_SIZE)));
    }
    const b64 = btoa(binary);

    return {
      id: Math.random().toString(36).substring(2, 11),
      fileName,
      subject: subjectRaw || "(No Subject)",
      sender: fromRaw || "Unknown Sender",
      date: dateRaw || "Unknown Date",
      sizeBytes: rawBytes.byteLength,
      rawB64: b64,
      status: "pending",
    };
  }

  async function handleFiles(files: FileList | File[]) {
    if (!files || files.length === 0) return;
    setIsProcessingFiles(true);
    setErrorMessage(null);

    const newItems: ParsedEmailItem[] = [];
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { fatal: false });

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const lowerName = file.name.toLowerCase();

        if (lowerName.endsWith(".mbox")) {
          let count = 0;
          for await (const parsedMsg of streamMbox(file)) {
            count++;
            const msgBytes = encoder.encode(parsedMsg.raw);
            const item = parseRFC822(parsedMsg.raw, msgBytes, `${file.name} #${count}`);
            item.targetFolder = resolveTargetFolder(parsedMsg.raw, props.userEmail || "");
            newItems.push(item);
          }
        } else {
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          const text = decoder.decode(bytes);
          const item = parseRFC822(text, bytes, file.name);
          item.targetFolder = resolveTargetFolder(text, props.userEmail || "");
          newItems.push(item);
        }
      }

      setItems((prev) => [...prev, ...newItems]);
    } catch (err: any) {
      setErrorMessage("Failed to parse some email files: " + (err?.message || String(err)));
    } finally {
      setIsProcessingFiles(false);
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function handleFileInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      handleFiles(input.files);
      input.value = "";
    }
  }

  function removeItem(id: string) {
    if (isImporting()) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function clearAll() {
    if (isImporting()) return;
    setItems([]);
    setImportSummary(null);
    setErrorMessage(null);
  }

  async function runImportBatch(itemsToImport: ParsedEmailItem[]) {
    if (itemsToImport.length === 0 || isImporting()) return;

    setIsImporting(true);
    setErrorMessage(null);
    setImportProgress({ current: 0, total: itemsToImport.length });
    setImportStats({ rate: 0, etaSeconds: null });

    const startTime = Date.now();
    let completedCount = 0;

    const statsTimer = setInterval(() => {
      const elapsedSec = (Date.now() - startTime) / 1000;
      if (elapsedSec > 0 && completedCount > 0) {
        const rate = completedCount / elapsedSec;
        const remaining = itemsToImport.length - completedCount;
        const etaSeconds = rate > 0 ? Math.ceil(remaining / rate) : null;
        setImportStats({ rate: Number(rate.toFixed(1)), etaSeconds });
      }
    }, 1000);

    const folder = targetFolder();
    const read = markAsRead();

    try {
      await runWithConcurrency(
        itemsToImport,
        UPLOAD_CONCURRENCY,
        async (item) => {
          setItems((prev) =>
            prev.map((it) => (it.id === item.id ? { ...it, status: "importing" } : it))
          );

          const effectiveFolder = item.targetFolder || folder;

          try {
            const res = await importEmail(props.mailboxId, item.rawB64, effectiveFolder, read);
            if (res.status === "already_imported") {
              setItems((prev) =>
                prev.map((it) =>
                  it.id === item.id ? { ...it, status: "duplicate", errorMsg: undefined } : it
                )
              );
            } else {
              setItems((prev) =>
                prev.map((it) =>
                  it.id === item.id ? { ...it, status: "imported", errorMsg: undefined } : it
                )
              );
            }
          } catch (err: any) {
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? { ...it, status: "error", errorMsg: err?.message || "Import failed" }
                  : it
              )
            );
          }
        },
        (completed, total) => {
          completedCount = completed;
          setImportProgress({ current: completed, total });
        },
      );
    } finally {
      clearInterval(statsTimer);
      setIsImporting(false);
    }

    const currentItems = items();
    const imported = currentItems.filter((i) => i.status === "imported").length;
    const duplicates = currentItems.filter((i) => i.status === "duplicate").length;
    const failed = currentItems.filter((i) => i.status === "error").length;

    setImportSummary({ imported, duplicates, failed });

    if (imported > 0) {
      props.onSuccess();
    }
  }

  function startImport() {
    runImportBatch(items());
  }

  function retryFailed() {
    const failedItems = items().filter((i) => i.status === "error");
    if (failedItems.length > 0) {
      runImportBatch(failedItems);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function formatEta(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s remaining`;
    }
    const mins = Math.floor(seconds / 60);
    const remainingSecs = seconds % 60;
    return `${mins}m ${remainingSecs}s remaining`;
  }

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-2 sm:p-4">
        <div
          class="w-full max-w-2xl rounded-xl sm:rounded-2xl bg-white dark:bg-[#1E2025] shadow-2xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 font-sans max-h-[92vh]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-emails-title"
        >
          {/* Header */}
          <div class="px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between shrink-0">
            <div class="flex items-center gap-2.5">
              <div class="p-2 rounded-xl bg-[#F0EEE9] dark:bg-[#26282E] text-[#9E725F]">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <div>
                <h3 id="import-emails-title" class="font-semibold text-base text-[#2B2C2D] dark:text-[#F3F4F6]">
                  Import Emails
                </h3>
                <p class="text-xs text-[#6F7173] dark:text-[#878A8E]">
                  Import .eml or .mbox archives with end-to-end zero-knowledge encryption
                </p>
              </div>
            </div>
            <button
              onClick={props.onClose}
              disabled={isImporting()}
              class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer p-1.5 rounded-lg hover:bg-[#F0EEE9]/60 dark:hover:bg-[#26282E] transition disabled:opacity-40"
              aria-label="Close dialog"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div class="p-6 overflow-y-auto space-y-5 flex-1">
            <Show when={errorMessage()}>
              <div class="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 text-sm flex items-start gap-2.5">
                <svg class="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>{errorMessage()}</span>
              </div>
            </Show>

            <Show when={importSummary()}>
              {(summary) => (
                <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[#2B2C2D] dark:text-[#F3F4F6] text-sm space-y-1.5">
                  <div class="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                    Import process complete
                  </div>
                  <div class="text-xs text-[#6F7173] dark:text-[#878A8E] flex flex-wrap items-center gap-4 mt-1">
                    <span><strong>{summary().imported}</strong> imported</span>
                    <Show when={summary().duplicates > 0}>
                      <span><strong>{summary().duplicates}</strong> already existed</span>
                    </Show>
                    <Show when={summary().failed > 0}>
                      <span class="text-red-600 dark:text-red-400"><strong>{summary().failed}</strong> failed</span>
                      <button
                        type="button"
                        onClick={retryFailed}
                        disabled={isImporting()}
                        class="px-2.5 py-0.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition cursor-pointer disabled:opacity-50"
                      >
                        Retry failed ({summary().failed})
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </Show>

            {/* Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              class={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
                isDragging()
                  ? "border-[#9E725F] bg-[#9E725F]/5 dark:bg-[#9E725F]/10"
                  : "border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#9E725F]/50 bg-[#F0EEE9]/30 dark:bg-[#26282E]/30"
              }`}
            >
              <input
                type="file"
                id="file-import-input"
                multiple
                accept=".eml,.mbox,message/rfc822"
                onChange={handleFileInputChange}
                class="hidden"
                disabled={isImporting() || isProcessingFiles()}
              />
              <label
                for="file-import-input"
                class="cursor-pointer flex flex-col items-center justify-center gap-2"
              >
                <div class="w-12 h-12 rounded-full bg-[#F0EEE9] dark:bg-[#26282E] flex items-center justify-center text-[#9E725F] shadow-xs">
                  <Show
                    when={isProcessingFiles()}
                    fallback={
                      <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    }
                  >
                    <svg class="w-6 h-6 animate-spin text-[#9E725F]" fill="none" viewBox="0 0 24 24">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                  </Show>
                </div>
                <div class="space-y-1">
                  <p class="text-sm font-medium text-[#2B2C2D] dark:text-[#F3F4F6]">
                    <span class="text-[#9E725F] hover:underline font-semibold">Click to browse</span> or drag and drop
                  </p>
                  <p class="text-xs text-[#6F7173] dark:text-[#878A8E]">
                    Supports individual <strong>.eml</strong> files or <strong>.mbox</strong> mail archives (streamed up to multi-GB)
                  </p>
                </div>
              </label>
            </div>

            {/* Migration Quick Guide Accordion */}
            <div class="rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden bg-[#F0EEE9]/30 dark:bg-[#26282E]/30">
              <button
                type="button"
                onClick={() => setAccordionOpen(!accordionOpen())}
                class="w-full px-4 py-2.5 flex items-center justify-between text-left text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F0EEE9]/60 dark:hover:bg-[#26282E] transition cursor-pointer"
                aria-expanded={accordionOpen()}
              >
                <div class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-[#9E725F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Migration Instructions (Gmail, Outlook, Apple Mail)</span>
                </div>
                <svg
                  class={`w-4 h-4 text-[#6F7173] dark:text-[#878A8E] transition-transform duration-150 ${
                    accordionOpen() ? "rotate-180" : ""
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <Show when={accordionOpen()}>
                <div class="px-4 py-3 border-t border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#6F7173] dark:text-[#878A8E] space-y-3 bg-white dark:bg-[#1E2025]">
                  <div>
                    <p class="font-semibold text-[#2B2C2D] dark:text-[#F3F4F6] mb-1">
                      Gmail (Google Takeout)
                    </p>
                    <ol class="list-decimal list-inside space-y-0.5 text-[11px] leading-relaxed">
                      <li>Go to <a href="https://takeout.google.com" target="_blank" rel="noreferrer" class="text-[#9E725F] hover:underline">takeout.google.com</a> &rarr; click <strong>Deselect all</strong>.</li>
                      <li>Check <strong>Mail</strong>, choose .zip format, and click <strong>Create export</strong>.</li>
                      <li>Download and extract the zip archive; drop the <code class="px-1 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#26282E]">.mbox</code> file here.</li>
                      <li>Gmail labels (Sent, Archive, Spam, Trash) are automatically routed to their BYOS folders.</li>
                    </ol>
                  </div>
                  <div>
                    <p class="font-semibold text-[#2B2C2D] dark:text-[#F3F4F6] mb-1">
                      Microsoft Outlook
                    </p>
                    <p class="text-[11px] leading-relaxed">
                      Drag messages directly out of Outlook into this window as <code class="px-1 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#26282E]">.eml</code> files, or sync your account in Mozilla Thunderbird to export an entire mailbox to <code class="px-1 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#26282E]">.mbox</code>.
                    </p>
                  </div>
                  <div>
                    <p class="font-semibold text-[#2B2C2D] dark:text-[#F3F4F6] mb-1">
                      Apple Mail (macOS)
                    </p>
                    <p class="text-[11px] leading-relaxed">
                      In Apple Mail, right-click any mailbox &rarr; select <strong>Export Mailbox...</strong> &rarr; drop the resulting <code class="px-1 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#26282E]">.mbox</code> file here.
                    </p>
                  </div>
                </div>
              </Show>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#F0EEE9]/40 dark:bg-[#26282E]/40 p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138]">
              <div>
                <label class="block text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] mb-1.5 uppercase tracking-wider">
                  Default Target Folder
                </label>
                <select
                  value={targetFolder()}
                  onChange={(e) => setTargetFolder(e.currentTarget.value)}
                  disabled={isImporting()}
                  class="w-full text-sm rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] px-3 py-2 text-[#2B2C2D] dark:text-[#F3F4F6] focus:outline-hidden focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                >
                  <option value="inbox">Inbox</option>
                  <option value="archive">Archive</option>
                  <For each={props.folders}>
                    {(f) => (
                      <Show when={f.name.toLowerCase() !== "inbox" && f.name.toLowerCase() !== "archive"}>
                        <option value={f.name}>{f.name}</option>
                      </Show>
                    )}
                  </For>
                </select>
                <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] mt-1">
                  Used when Gmail labels or sender heuristics do not specify a folder.
                </p>
              </div>

              <div class="flex items-start sm:items-center pt-2 sm:pt-4">
                <label class="flex items-center gap-2.5 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={markAsRead()}
                    onChange={(e) => setMarkAsRead(e.currentTarget.checked)}
                    disabled={isImporting()}
                    class="rounded border-[#E2DFD8] dark:border-[#2E3138] text-[#9E725F] focus:ring-[#9E725F] h-4 w-4 cursor-pointer"
                  />
                  <span>Mark imported emails as read</span>
                </label>
              </div>
            </div>

            <Show when={items().length > 0}>
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <h4 class="text-xs font-semibold uppercase tracking-wider text-[#6F7173] dark:text-[#878A8E]">
                    Messages to import ({items().length})
                  </h4>
                  <Show when={!isImporting()}>
                    <button
                      onClick={clearAll}
                      class="text-xs text-red-600 dark:text-red-400 hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Clear list
                    </button>
                  </Show>
                </div>

                <div class="max-h-60 overflow-y-auto rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] divide-y divide-[#E2DFD8] dark:divide-[#2E3138] bg-white dark:bg-[#1E2025]">
                  <For each={items()}>
                    {(item) => (
                      <div class="p-3 text-xs flex items-center justify-between gap-3 hover:bg-[#F0EEE9]/30 dark:hover:bg-[#26282E]/30 transition">
                        <div class="min-w-0 flex-1 space-y-0.5">
                          <div class="flex items-center gap-2">
                            <span class="font-medium text-[#2B2C2D] dark:text-[#F3F4F6] truncate max-w-xs">
                              {item.subject}
                            </span>
                            <Show when={item.targetFolder && item.targetFolder !== targetFolder()}>
                              <span class="px-1.5 py-0.5 text-[10px] rounded bg-[#9E725F]/15 text-[#9E725F] dark:text-[#D1AFA0] font-medium capitalize shrink-0">
                                &rarr; {item.targetFolder}
                              </span>
                            </Show>
                            <span class="text-[10px] text-[#6F7173] dark:text-[#878A8E] shrink-0">
                              ({formatSize(item.sizeBytes)})
                            </span>
                          </div>
                          <div class="text-[#6F7173] dark:text-[#878A8E] truncate">
                            From: {item.sender} &bull; {item.date}
                          </div>
                        </div>

                        <div class="shrink-0 flex items-center gap-2">
                          <Show when={item.status === "pending"}>
                            <span class="px-2 py-0.5 text-[11px] rounded-md bg-gray-100 dark:bg-gray-800 text-[#6F7173] dark:text-[#878A8E]">
                              Ready
                            </span>
                          </Show>
                          <Show when={item.status === "importing"}>
                            <span class="px-2 py-0.5 text-[11px] rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                              </svg>
                              Importing...
                            </span>
                          </Show>
                          <Show when={item.status === "imported"}>
                            <span class="px-2 py-0.5 text-[11px] rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                              ✓ Imported
                            </span>
                          </Show>
                          <Show when={item.status === "duplicate"}>
                            <span class="px-2 py-0.5 text-[11px] rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                              Already exists
                            </span>
                          </Show>
                          <Show when={item.status === "error"}>
                            <span class="px-2 py-0.5 text-[11px] rounded-md bg-red-500/10 text-red-600 dark:text-red-400 font-medium" title={item.errorMsg}>
                              Error
                            </span>
                          </Show>

                          <Show when={!isImporting()}>
                            <button
                              onClick={() => removeItem(item.id)}
                              class="text-[#6F7173] hover:text-red-600 p-1 rounded-md transition cursor-pointer"
                              title="Remove"
                            >
                              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Progress & Speed / ETA Area */}
            <Show when={isImporting()}>
              <div class="space-y-1.5">
                <div class="flex justify-between items-center text-xs text-[#6F7173] dark:text-[#878A8E]">
                  <span class="flex items-center gap-2">
                    <span>Encrypting & importing emails...</span>
                    <Show when={importStats().rate > 0}>
                      <span class="text-[11px] px-1.5 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#26282E] text-[#9E725F] font-mono">
                        {importStats().rate} msg/s
                      </span>
                    </Show>
                  </span>
                  <span class="flex items-center gap-2">
                    <Show when={importStats().etaSeconds !== null && importStats().etaSeconds! > 0}>
                      <span class="text-[11px]">
                        {formatEta(importStats().etaSeconds!)} &bull;
                      </span>
                    </Show>
                    <span>
                      {importProgress().current} of {importProgress().total} (
                      {Math.round((importProgress().current / Math.max(1, importProgress().total)) * 100)}%)
                    </span>
                  </span>
                </div>
                <div class="w-full bg-[#E2DFD8] dark:bg-[#2E3138] h-2 rounded-full overflow-hidden">
                  <div
                    class="bg-[#9E725F] h-2 transition-all duration-200"
                    style={{
                      width: `${(importProgress().current / Math.max(1, importProgress().total)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="px-6 py-4 border-t border-[#E2DFD8] dark:border-[#2E3138] bg-[#F0EEE9]/30 dark:bg-[#26282E]/30 flex items-center justify-between shrink-0">
            <div class="text-xs text-[#6F7173] dark:text-[#878A8E]">
              <Show when={items().length > 0}>
                {items().length} email{items().length > 1 ? "s" : ""} selected
              </Show>
            </div>
            <div class="flex items-center gap-3">
              <Show when={!isImporting() && items().some((i) => i.status === "error")}>
                <button
                  type="button"
                  onClick={retryFailed}
                  class="px-3.5 py-2 text-sm font-medium text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/10 rounded-xl cursor-pointer transition"
                >
                  Retry failed ({items().filter((i) => i.status === "error").length})
                </button>
              </Show>
              <button
                type="button"
                onClick={props.onClose}
                disabled={isImporting()}
                class="px-4 py-2 text-sm font-medium text-[#2B2C2D] dark:text-[#F3F4F6] bg-[#F0EEE9]/80 dark:bg-[#26282E] hover:bg-[#E2DFD8] dark:hover:bg-[#2F323A] rounded-xl cursor-pointer transition disabled:opacity-50"
              >
                {importSummary() ? "Done" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={startImport}
                disabled={items().length === 0 || isImporting() || isProcessingFiles() || Boolean(importSummary())}
                class="px-5 py-2 text-sm font-medium text-white bg-[#9E725F] hover:bg-[#886151] rounded-xl cursor-pointer transition disabled:opacity-50 flex items-center gap-2 shadow-xs"
              >
                <Show
                  when={isImporting()}
                  fallback={
                    <span>
                      {importSummary() ? "Import Completed" : `Import ${items().length > 0 ? items().length + " " : ""}Email${items().length === 1 ? "" : "s"}`}
                    </span>
                  }
                >
                  <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                  <span>Importing...</span>
                </Show>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
