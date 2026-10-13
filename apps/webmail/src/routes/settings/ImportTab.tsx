import { Component, createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { Mailbox } from "../../api";
import {
  OAuthTokens,
  ImportJobItem,
  listImportJobs,
  storeTokens,
  loadTokens,
  beginImportOAuth,
} from "../../oauth_import";
import { runImport, ImportProgress, ImportSummary } from "../../import_worker";

interface ImportTabProps {
  mailbox: Mailbox;
  mailboxKey: Uint8Array | null;
  onFinish?: () => void;
  mockProviderBaseUrl?: string;
}

export const ImportTab: Component<ImportTabProps> = (props) => {
  // Wizard steps: 1: Provider Select, 2: Authorize, 3: Configure, 4: Progress, 5: Summary
  const [step, setStep] = createSignal<1 | 2 | 3 | 4 | 5>(1);
  const [provider, setProvider] = createSignal<"gmail" | "outlook">("gmail");
  const [tokens, setTokens] = createSignal<OAuthTokens | null>(null);
  const [isAuthorizing, setIsAuthorizing] = createSignal(false);
  const [authError, setAuthError] = createSignal<string | null>(null);

  // Configuration options
  const [dateRangeYears, setDateRangeYears] = createSignal<number>(2);
  const [concurrency, setConcurrency] = createSignal<number>(5);
  const [importFolders, setImportFolders] = createSignal<Record<string, boolean>>({
    inbox: true,
    sent: true,
    archive: true,
    trash: true,
  });

  // Active import progress & control
  const [abortController, setAbortController] = createSignal<AbortController | null>(null);
  const [progress, setProgress] = createSignal<ImportProgress>({
    total: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    percent: 0,
    status: "running",
  });
  const [summary, setSummary] = createSignal<ImportSummary | null>(null);

  // Job history
  const [jobs, setJobs] = createSignal<ImportJobItem[]>([]);
  const [loadingJobs, setLoadingJobs] = createSignal(false);

  // Load past jobs
  const fetchJobs = async () => {
    setLoadingJobs(true);
    try {
      const history = await listImportJobs(props.mailbox.id);
      setJobs(history);
    } catch (err) {
      console.warn("Failed to list import jobs:", err);
    } finally {
      setLoadingJobs(false);
    }
  };

  onMount(() => {
    fetchJobs();

    // Check for cached tokens if mailboxKey is available
    if (props.mailboxKey) {
      loadTokens(props.mailbox.id, props.mailboxKey, provider()).then((saved) => {
        if (saved && saved.expiresAt > Date.now()) {
          setTokens(saved);
          setStep(3);
        }
      });
    }

    // Listen for OAuth callback postMessage from popup
    const handleMessage = async (e: MessageEvent) => {
      if (!e.data || e.data.type !== "BYOS_OAUTH_CALLBACK") return;
      if (e.origin !== window.location.origin) return;

      setIsAuthorizing(false);
      if (e.data.error) {
        setAuthError(`Authorization failed: ${e.data.error}`);
        return;
      }

      if (e.data.accessToken) {
        const receivedTokens: OAuthTokens = {
          provider: (e.data.provider || provider()) as "gmail" | "outlook",
          accessToken: e.data.accessToken,
          refreshToken: e.data.refreshToken,
          expiresAt: Date.now() + (e.data.expiresIn || 3600) * 1000,
        };
        setTokens(receivedTokens);
        setAuthError(null);

        // Encrypt and store tokens client-side
        if (props.mailboxKey) {
          try {
            await storeTokens(props.mailbox.id, props.mailboxKey, receivedTokens.provider, receivedTokens);
          } catch (err) {
            console.warn("Failed to persist encrypted tokens:", err);
          }
        }

        // Advance to configure step
        setStep(3);
      }
    };

    window.addEventListener("message", handleMessage);
    onCleanup(() => {
      window.removeEventListener("message", handleMessage);
    });
  });

  // Start OAuth popup authorization
  const handleStartAuth = async (selectedProvider: "gmail" | "outlook") => {
    setProvider(selectedProvider);
    setIsAuthorizing(true);
    setAuthError(null);

    try {
      const mockBase =
        props.mockProviderBaseUrl ||
        (typeof window !== "undefined" &&
          ((window as any).__BYOS_MOCK_IMPORT_URL__ ||
            localStorage.getItem("byos_mock_import_url")));

      let authUrl: string;
      if (mockBase) {
        authUrl = `${mockBase}/oauth/authorize?provider=${selectedProvider}&mailbox_id=${props.mailbox.id}`;
      } else {
        const res = await beginImportOAuth(selectedProvider, props.mailbox.id);
        authUrl = res.auth_url;
      }

      const width = 600;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      const popup = window.open(
        authUrl,
        "byos_oauth_popup",
        `width=${width},height=${height},left=${left},top=${top},status=0,toolbar=0,menubar=0`
      );

      if (!popup || popup.closed || typeof popup.closed === "undefined") {
        setIsAuthorizing(false);
        setAuthError("Popup blocked. Please allow popups for this site and try again.");
      }
    } catch (err: unknown) {
      setIsAuthorizing(false);
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  };

  // Launch live import
  const handleLaunchImport = async () => {
    const currentTokens = tokens();
    if (!currentTokens) {
      setAuthError("No authorization tokens available. Please authorize first.");
      setStep(2);
      return;
    }
    if (!props.mailboxKey) {
      setAuthError("Mailbox is locked. Please enter your recovery phrase or password to unlock keys.");
      return;
    }

    const controller = new AbortController();
    setAbortController(controller);
    setStep(4);

    const activeFolders = Object.keys(importFolders()).filter((k) => importFolders()[k]);

    try {
      const mockBase =
        props.mockProviderBaseUrl ||
        (typeof window !== "undefined" &&
          ((window as any).__BYOS_MOCK_IMPORT_URL__ ||
            localStorage.getItem("byos_mock_import_url")));

      const result = await runImport({
        mailboxId: props.mailbox.id,
        mailboxKey: props.mailboxKey,
        provider: provider(),
        accessToken: currentTokens.accessToken,
        refreshToken: currentTokens.refreshToken,
        folders: activeFolders,
        dateRangeYears: dateRangeYears(),
        concurrency: concurrency(),
        signal: controller.signal,
        mockProviderBaseUrl: mockBase || undefined,
        onProgress: (p) => setProgress(p),
      });

      setSummary(result);
      setStep(5);
      fetchJobs();
    } catch (err: unknown) {
      setSummary({
        provider: provider(),
        total: progress().total,
        imported: progress().imported,
        skipped: progress().skipped,
        failed: progress().failed,
        status: "failed",
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      setStep(5);
      fetchJobs();
    }
  };

  // Cancel live import
  const handleCancelImport = () => {
    if (abortController()) {
      abortController()!.abort();
    }
  };

  return (
    <div data-testid="import-wizard" class="space-y-6">
      {/* Header */}
      <div class="border-b border-[#E2DFD8] dark:border-[#2E3138] pb-4">
        <h1 class="text-xl font-bold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">
          Direct Mailbox Import (OAuth 2.0)
        </h1>
        <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-1 leading-relaxed">
          Import your entire inbox, sent, archive, and trash messages from Gmail or Outlook with client-side zero-knowledge encryption.
        </p>
      </div>

      {/* Zero-knowledge callout banner */}
      <div class="bg-[#F2E8E2] dark:bg-[#2D2522] border border-[#A27561]/30 rounded-xl p-4 flex items-start gap-3">
        <div class="p-1 rounded-lg bg-[#A27561] text-white flex-shrink-0 mt-0.5">
          <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        </div>
        <div class="text-xs text-[#3C3D3E] dark:text-[#E2DFD8] leading-relaxed">
          <span class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6] block mb-0.5">End-to-End Browser Encryption:</span>
          OAuth tokens and messages never touch BYOS servers in plaintext. All emails are fetched directly in your browser, encrypted with your private mailbox key, and stored directly to your private customer storage.
        </div>
      </div>

      {/* Step Indicator */}
      <div class="flex items-center justify-between border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#18191D] rounded-xl p-3 text-xs">
        <div class={`flex items-center gap-2 ${step() === 1 ? "text-[#A27561] font-bold" : "text-[#6E7075]"}`}>
          <span class="w-5 h-5 rounded-full border flex items-center justify-center text-[10px]">1</span>
          <span>Provider</span>
        </div>
        <span class="text-[#E2DFD8] dark:text-[#2E3138]">→</span>
        <div class={`flex items-center gap-2 ${step() === 2 ? "text-[#A27561] font-bold" : "text-[#6E7075]"}`}>
          <span class="w-5 h-5 rounded-full border flex items-center justify-center text-[10px]">2</span>
          <span>Authorize</span>
        </div>
        <span class="text-[#E2DFD8] dark:text-[#2E3138]">→</span>
        <div class={`flex items-center gap-2 ${step() === 3 ? "text-[#A27561] font-bold" : "text-[#6E7075]"}`}>
          <span class="w-5 h-5 rounded-full border flex items-center justify-center text-[10px]">3</span>
          <span>Configure</span>
        </div>
        <span class="text-[#E2DFD8] dark:text-[#2E3138]">→</span>
        <div class={`flex items-center gap-2 ${step() === 4 ? "text-[#A27561] font-bold" : "text-[#6E7075]"}`}>
          <span class="w-5 h-5 rounded-full border flex items-center justify-center text-[10px]">4</span>
          <span>Progress</span>
        </div>
        <span class="text-[#E2DFD8] dark:text-[#2E3138]">→</span>
        <div class={`flex items-center gap-2 ${step() === 5 ? "text-[#A27561] font-bold" : "text-[#6E7075]"}`}>
          <span class="w-5 h-5 rounded-full border flex items-center justify-center text-[10px]">5</span>
          <span>Done</span>
        </div>
      </div>

      {/* Error alert */}
      <Show when={authError()}>
        <div class="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200 p-3 rounded-xl text-xs flex items-center gap-2">
          <svg class="w-4 h-4 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{authError()}</span>
        </div>
      </Show>

      {/* ── STEP 1: Provider Select ── */}
      <Show when={step() === 1}>
        <div class="space-y-4">
          <h2 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
            Select Source Provider
          </h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Google / Gmail Card */}
            <div
              data-testid="provider-card-gmail"
              onClick={() => {
                setProvider("gmail");
                if (tokens() && tokens()!.provider === "gmail" && tokens()!.expiresAt > Date.now()) {
                  setStep(3);
                } else {
                  setStep(2);
                }
              }}
              class="border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#18191D] hover:border-[#A27561] hover:bg-[#FAF9F6] dark:hover:bg-[#202227] p-5 rounded-xl cursor-pointer transition flex flex-col justify-between gap-4"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 flex items-center justify-center text-rose-600">
                  <svg class="w-5 h-5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div>
                  <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Google Gmail</h3>
                  <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA]">OAuth 2.0 readonly import</p>
                </div>
              </div>
              <p class="text-xs text-[#464748] dark:text-[#A1A1AA] leading-relaxed">
                Connect via Google OAuth popup to import your Gmail messages, labels, and attachments.
              </p>
              <button
                type="button"
                class="w-full py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-lg transition"
              >
                Select Gmail
              </button>
            </div>

            {/* Microsoft / Outlook Card */}
            <div
              data-testid="provider-card-outlook"
              onClick={() => {
                setProvider("outlook");
                setStep(2);
              }}
              class="border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#18191D] hover:border-[#A27561] hover:bg-[#FAF9F6] dark:hover:bg-[#202227] p-5 rounded-xl cursor-pointer transition flex flex-col justify-between gap-4"
            >
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center text-blue-600">
                  <svg class="w-5 h-5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div>
                  <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Microsoft Outlook</h3>
                  <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA]">Microsoft Graph API import</p>
                </div>
              </div>
              <p class="text-xs text-[#464748] dark:text-[#A1A1AA] leading-relaxed">
                Connect via Microsoft Identity to import Outlook.com or Office 365 mailbox messages.
              </p>
              <button
                type="button"
                class="w-full py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-lg transition"
              >
                Select Outlook
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* ── STEP 2: Authorize Popup ── */}
      <Show when={step() === 2}>
        <div class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl p-6 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Authorize {provider() === "gmail" ? "Google Gmail" : "Microsoft Outlook"}
            </h2>
            <button
              onClick={() => setStep(1)}
              class="text-xs text-[#A27561] hover:underline"
            >
              Change Provider
            </button>
          </div>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] leading-relaxed">
            Click the button below to open the secure OAuth authorization popup. Your source credentials and OAuth tokens are never sent to BYOS servers.
          </p>
          <div class="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              type="button"
              data-testid="authorize-popup-btn"
              disabled={isAuthorizing()}
              onClick={() => handleStartAuth(provider())}
              class="w-full sm:w-auto px-6 py-2.5 bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-2 shadow-2xs"
            >
              <Show when={isAuthorizing()} fallback={<span>Authorize with {provider() === "gmail" ? "Google" : "Microsoft"}</span>}>
                <svg class="animate-spin w-4 h-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Waiting for popup...</span>
              </Show>
            </button>
          </div>
        </div>
      </Show>

      {/* ── STEP 3: Configure & Folder Mapping ── */}
      <Show when={step() === 3}>
        <div class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl p-6 space-y-5">
          <h2 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
            Configure Import Settings
          </h2>

          {/* Date range selection */}
          <div class="space-y-2">
            <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Date Range (Default: Last 2 Years)
            </label>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <For each={[
                { label: "Last 6 Months", val: 0.5 },
                { label: "Last 1 Year", val: 1 },
                { label: "Last 2 Years", val: 2 },
                { label: "All Time (5 Yrs)", val: 5 },
              ]}>
                {(opt) => (
                  <button
                    type="button"
                    onClick={() => setDateRangeYears(opt.val)}
                    class={`p-2.5 rounded-lg border text-xs font-medium transition text-center ${
                      dateRangeYears() === opt.val
                        ? "border-[#A27561] bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-bold"
                        : "border-[#E2DFD8] dark:border-[#2E3138] text-[#464748] dark:text-[#A1A1AA] hover:bg-[#FAF9F6]"
                    }`}
                  >
                    {opt.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Folders to import */}
          <div class="space-y-2">
            <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Folders to Import
            </label>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <For each={[
                { id: "inbox", label: "Inbox" },
                { id: "sent", label: "Sent" },
                { id: "archive", label: "Archive" },
                { id: "trash", label: "Trash" },
              ]}>
                {(f) => (
                  <label class="flex items-center gap-2 p-2.5 border border-[#E2DFD8] dark:border-[#2E3138] rounded-lg cursor-pointer hover:bg-[#FAF9F6] text-xs">
                    <input
                      type="checkbox"
                      checked={importFolders()[f.id]}
                      onChange={(e) => {
                        setImportFolders({
                          ...importFolders(),
                          [f.id]: e.currentTarget.checked,
                        });
                      }}
                      class="rounded text-[#A27561] focus:ring-[#A27561]"
                    />
                    <span class="text-[#1A1B1E] dark:text-[#F3F4F6]">{f.label}</span>
                  </label>
                )}
              </For>
            </div>
          </div>

          {/* Concurrency limit (D3: max 5) */}
          <div class="space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Parallel Fetch Concurrency:</span>
              <span class="font-mono text-[#A27561] font-bold">{concurrency()} parallel workers</span>
            </div>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={concurrency()}
              onInput={(e) => setConcurrency(parseInt(e.currentTarget.value, 10))}
              class="w-full accent-[#A27561]"
            />
            <p class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">
              Capped at 5 parallel fetches per provider to prevent provider rate limits (D3).
            </p>
          </div>

          {/* Action buttons */}
          <div class="flex items-center justify-end gap-3 pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138]">
            <button
              type="button"
              onClick={() => setStep(2)}
              class="px-4 py-2 text-xs font-semibold text-[#6E7075] hover:text-[#1A1B1E]"
            >
              Back
            </button>
            <button
              type="button"
              data-testid="start-import-btn"
              onClick={handleLaunchImport}
              class="px-6 py-2.5 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-bold rounded-xl transition shadow-2xs"
            >
              Start Mailbox Import
            </button>
          </div>
        </div>
      </Show>

      {/* ── STEP 4: Live Progress with D4 Warning Banner ── */}
      <Show when={step() === 4}>
        <div class="space-y-4">
          {/* D4 Warning Banner */}
          <div
            data-testid="tab-warning-banner"
            class="bg-amber-500 text-white p-3.5 rounded-xl text-xs font-bold flex items-center justify-between gap-3 shadow-sm animate-pulse"
          >
            <div class="flex items-center gap-2">
              <svg class="w-5 h-5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Import is in progress. Please keep this tab open until the import is complete.</span>
            </div>
            <button
              type="button"
              onClick={handleCancelImport}
              class="px-3 py-1 bg-white text-amber-900 rounded-lg text-xs font-bold hover:bg-amber-100 transition flex-shrink-0"
            >
              Cancel
            </button>
          </div>

          {/* Progress Card */}
          <div class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl p-6 space-y-5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                Importing {provider() === "gmail" ? "Gmail" : "Outlook"} Messages...
              </span>
              <span class="font-mono text-sm font-bold text-[#A27561]">{progress().percent}%</span>
            </div>

            {/* Progress Bar */}
            <div class="w-full bg-[#E2DFD8] dark:bg-[#2E3138] h-3 rounded-full overflow-hidden">
              <div
                class="bg-[#A27561] h-full transition-all duration-300"
                style={{ width: `${progress().percent}%` }}
              />
            </div>

            {/* Live Stats */}
            <div class="grid grid-cols-4 gap-2 text-center">
              <div class="p-3 bg-[#FAF9F6] dark:bg-[#202227] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138]">
                <div class="text-[10px] text-[#6E7075] uppercase font-mono">Total</div>
                <div class="text-base font-bold text-[#1A1B1E] dark:text-[#F3F4F6] mt-0.5">{progress().total}</div>
              </div>
              <div class="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-900/50">
                <div class="text-[10px] text-emerald-700 uppercase font-mono">Imported</div>
                <div class="text-base font-bold text-emerald-600 mt-0.5">{progress().imported}</div>
              </div>
              <div class="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-900/50">
                <div class="text-[10px] text-amber-700 uppercase font-mono">Skipped</div>
                <div class="text-base font-bold text-amber-600 mt-0.5">{progress().skipped}</div>
              </div>
              <div class="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-lg border border-rose-200 dark:border-rose-900/50">
                <div class="text-[10px] text-rose-700 uppercase font-mono">Failed</div>
                <div class="text-base font-bold text-rose-600 mt-0.5">{progress().failed}</div>
              </div>
            </div>

            <Show when={progress().currentSubject}>
              <div class="text-xs text-[#6E7075] dark:text-[#A1A1AA] truncate">
                <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Current:</span> {progress().currentSubject}
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* ── STEP 5: Summary ── */}
      <Show when={step() === 5}>
        <div class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl p-6 space-y-5">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <h2 class="text-base font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                {summary()?.status === "cancelled" ? "Import Cancelled" : "Import Completed"}
              </h2>
              <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">
                {summary()?.status === "cancelled"
                  ? "Import was stopped before finishing."
                  : "All selected messages have been processed and encrypted."}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-3 text-center py-2">
            <div class="p-3 bg-emerald-50 dark:bg-emerald-950/30 rounded-xl border border-emerald-200">
              <div class="text-[10px] text-emerald-700 font-mono uppercase">Imported</div>
              <div class="text-lg font-bold text-emerald-700 mt-0.5">{summary()?.imported ?? progress().imported}</div>
            </div>
            <div class="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200">
              <div class="text-[10px] text-amber-700 font-mono uppercase">Skipped (Duplicate)</div>
              <div class="text-lg font-bold text-amber-700 mt-0.5">{summary()?.skipped ?? progress().skipped}</div>
            </div>
            <div class="p-3 bg-rose-50 dark:bg-rose-950/30 rounded-xl border border-rose-200">
              <div class="text-[10px] text-rose-700 font-mono uppercase">Failed</div>
              <div class="text-lg font-bold text-rose-700 mt-0.5">{summary()?.failed ?? progress().failed}</div>
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138]">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setTokens(null);
              }}
              class="px-4 py-2 text-xs font-semibold text-[#6E7075] hover:text-[#1A1B1E]"
            >
              Start Another Import
            </button>
            <button
              type="button"
              data-testid="return-inbox-btn"
              onClick={() => {
                props.onFinish?.();
              }}
              class="px-6 py-2.5 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-bold rounded-xl transition shadow-2xs"
            >
              Return to Inbox
            </button>
          </div>
        </div>
      </Show>

      {/* ── Past Import Jobs History ── */}
      <div class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl p-5 space-y-3">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase font-mono tracking-wider">
            Past Import Jobs
          </h3>
          <button
            onClick={fetchJobs}
            class="text-[11px] text-[#A27561] hover:underline"
          >
            Refresh
          </button>
        </div>

        <Show
          when={jobs().length > 0}
          fallback={
            <div class="text-xs text-[#6E7075] italic py-2">
              {loadingJobs() ? "Loading import history..." : "No past imports found."}
            </div>
          }
        >
          <div class="divide-y divide-[#E2DFD8] dark:divide-[#2E3138] text-xs">
            <For each={jobs()}>
              {(j) => (
                <div class="py-2.5 flex items-center justify-between gap-4">
                  <div>
                    <div class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] capitalize flex items-center gap-2">
                      <span>{j.provider} Import</span>
                      <span
                        class={`text-[10px] px-1.5 py-0.5 rounded uppercase font-mono ${
                          j.status === "completed"
                            ? "bg-emerald-100 text-emerald-800"
                            : j.status === "failed"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {j.status}
                      </span>
                    </div>
                    <div class="text-[11px] text-[#6E7075] mt-0.5">
                      {new Date(j.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div class="text-right text-[11px] font-mono text-[#464748] dark:text-[#A1A1AA]">
                    <div>Imported: {j.imported_messages}</div>
                    <div>Skipped: {j.skipped_messages}</div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
