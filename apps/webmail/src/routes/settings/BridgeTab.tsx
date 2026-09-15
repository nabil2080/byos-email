import { Component, createSignal, onMount, For, Show } from "solid-js";
import {
  Mailbox,
  UserMe,
  BridgeCredential,
  listBridgeCredentials,
  createBridgeCredential,
  revokeBridgeCredential,
} from "../../api";

interface BridgeTabProps {
  mailbox: Mailbox;
  currentUser: UserMe | null;
}

export const BridgeTab: Component<BridgeTabProps> = (props) => {
  const [loading, setLoading] = createSignal(true);
  const [credentials, setCredentials] = createSignal<BridgeCredential[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [revokingId, setRevokingId] = createSignal<string | null>(null);

  // Generate Modal State
  const [showModal, setShowModal] = createSignal(false);
  const [tokenLabel, setTokenLabel] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [generatedToken, setGeneratedToken] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  const mailboxAddress = () => {
    const domain = props.currentUser?.email.split("@")[1] || "byos.local";
    return `${props.mailbox.local_part}@${domain}`;
  };

  async function loadCredentials() {
    try {
      setLoading(true);
      const list = await listBridgeCredentials(props.mailbox.id);
      setCredentials(list);
    } catch (err: any) {
      setError(err?.message || "Failed to load bridge credentials.");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadCredentials();
  });

  async function handleCreateToken(e: Event) {
    e.preventDefault();
    if (!tokenLabel().trim()) return;
    setCreating(true);
    setError(null);
    try {
      const cred = await createBridgeCredential(props.mailbox.id, tokenLabel().trim());
      setGeneratedToken(cred.token || "token-generated");
      setTokenLabel("");
      await loadCredentials();
    } catch (err: any) {
      setError(err?.message || "Failed to generate bridge credential.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Are you sure you want to revoke this bridge credential? External clients using this password will be disconnected.")) {
      return;
    }
    setRevokingId(id);
    try {
      await revokeBridgeCredential(props.mailbox.id, id);
      setCredentials((prev) => prev.filter((c) => c.id !== id));
    } catch (err: any) {
      setError(err?.message || "Failed to revoke credential.");
    } finally {
      setRevokingId(null);
    }
  }

  function handleCopyToken() {
    if (!generatedToken()) return;
    navigator.clipboard.writeText(generatedToken()!);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Bridge & External Clients</h3>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-1">
            Connect standard desktop and mobile mail apps via the local BYOS Bridge.
          </p>
        </div>
        <button
          onClick={() => {
            setGeneratedToken(null);
            setShowModal(true);
          }}
          class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-2 cursor-pointer"
        >
          <span>+</span>
          <span>Generate Client Password</span>
        </button>
      </div>

      <Show when={error()}>
        <div class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{error()}</span>
          <button onClick={() => setError(null)} class="text-rose-500 hover:text-rose-800 dark:hover:text-rose-200 p-0.5 cursor-pointer" title="Dismiss">
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </Show>

      {/* Bridge Server Connection Configuration */}
      <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
            Bridge Connection Settings
          </h4>
          <span class="text-[11px] font-mono text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-900/50 inline-flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Bridge Service Active</span>
          </span>
        </div>

        <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">
          Use these exact parameters to configure Thunderbird, Apple Mail, or Microsoft Outlook.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {/* IMAP Card */}
          <div class="p-4 rounded-xl bg-[#F8F7F4] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] space-y-2 font-mono text-xs">
            <div class="text-[11px] font-bold text-[#A27561] dark:text-[#D4A38F] uppercase tracking-wider">
              Incoming Mail (IMAP)
            </div>
            <div class="space-y-1 text-[#464748] dark:text-[#E2DFD8]">
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Server:</span>
                <span class="font-semibold select-all">127.0.0.1</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Port:</span>
                <span class="font-semibold select-all">1143</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Security:</span>
                <span class="font-semibold">STARTTLS / SSL</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Username:</span>
                <span class="font-semibold select-all">{mailboxAddress()}</span>
              </div>
            </div>
          </div>

          {/* SMTP Card */}
          <div class="p-4 rounded-xl bg-[#F8F7F4] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] space-y-2 font-mono text-xs">
            <div class="text-[11px] font-bold text-[#A27561] dark:text-[#D4A38F] uppercase tracking-wider">
              Outgoing Mail (SMTP)
            </div>
            <div class="space-y-1 text-[#464748] dark:text-[#E2DFD8]">
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Server:</span>
                <span class="font-semibold select-all">127.0.0.1</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Port:</span>
                <span class="font-semibold select-all">1025</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Security:</span>
                <span class="font-semibold">STARTTLS</span>
              </div>
              <div class="flex justify-between">
                <span class="text-[#6E7075] dark:text-[#A1A1AA]">Username:</span>
                <span class="font-semibold select-all">{mailboxAddress()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Bridge Credentials List */}
      <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
        <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
          Authorized Client Passwords
        </h4>

        <Show when={loading()}>
          <div class="p-8 text-center">
            <div class="inline-block animate-spin w-5 h-5 border-2 border-[#A27561] border-t-transparent rounded-full mb-2"></div>
            <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">Loading credentials…</p>
          </div>
        </Show>

        <Show when={!loading() && credentials().length === 0}>
          <div class="p-8 text-center rounded-xl bg-[#F8F7F4] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] border-dashed">
            <p class="text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6]">No external client passwords configured</p>
            <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] mt-1">
              Generate a client-specific password to authenticate desktop email clients securely.
            </p>
          </div>
        </Show>

        <Show when={!loading() && credentials().length > 0}>
          <div class="divide-y divide-[#E2DFD8] dark:divide-[#2E3138] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden">
            <For each={credentials()}>
              {(cred) => (
                <div class="p-4 flex items-center justify-between hover:bg-[#F8F7F4] dark:hover:bg-[#18191D] transition">
                  <div>
                    <div class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">{cred.label}</div>
                    <div class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA] font-mono mt-0.5">
                      Created: {new Date(cred.created_at).toLocaleDateString()}
                      {cred.last_used_at
                        ? ` • Last used: ${new Date(cred.last_used_at).toLocaleDateString()}`
                        : " • Never used"}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(cred.id)}
                    disabled={revokingId() === cred.id}
                    class="px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-medium transition disabled:opacity-50 cursor-pointer"
                  >
                    {revokingId() === cred.id ? "Revoking…" : "Revoke Access"}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Generate Password Modal */}
      <Show when={showModal()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-md w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                {generatedToken() ? "Client Password Generated" : "Generate External Client Password"}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                class="text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] p-1 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
                aria-label="Close dialog"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <Show when={!generatedToken()}>
              <form onSubmit={handleCreateToken} class="space-y-4">
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">
                  Give this password a recognizable name so you can identify and revoke it later.
                </p>
                <div>
                  <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                    Device or Application Name
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Work MacBook Thunderbird"
                    value={tokenLabel()}
                    onInput={(e) => setTokenLabel(e.currentTarget.value)}
                    required
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
                  />
                </div>
                <div class="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    class="px-4 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#464748] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating() || !tokenLabel().trim()}
                    class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer"
                  >
                    {creating() ? "Generating…" : "Generate Password"}
                  </button>
                </div>
              </form>
            </Show>

            <Show when={generatedToken()}>
              <div class="space-y-4">
                <div class="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
                  <svg class="w-4 h-4 stroke-amber-600 dark:stroke-amber-400 fill-none stroke-2 flex-shrink-0 mt-0.5" viewBox="0 0 24 24">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  <div>
                    <span class="font-bold block mb-0.5">Save this password now!</span>
                    <span class="text-amber-800 dark:text-amber-300">This credential will not be shown again. Use it as your IMAP and SMTP password in your email app.</span>
                  </div>
                </div>

                <div class="p-3 bg-[#F8F7F4] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between font-mono text-xs">
                  <span class="select-all font-bold text-[#A27561] dark:text-[#D4A38F] break-all">{generatedToken()}</span>
                  <button
                    onClick={handleCopyToken}
                    class="ml-3 px-3 py-1.5 rounded-lg bg-[#A27561] text-white text-[11px] font-semibold hover:bg-[#8F6452] transition flex-shrink-0 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Show when={copied()} fallback={
                      <>
                        <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        <span>Copy</span>
                      </>
                    }>
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2 text-white" viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Copied!</span>
                    </Show>
                  </button>
                </div>

                <div class="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    class="px-5 py-2 rounded-xl bg-[#464748] dark:bg-[#2E3138] text-white text-xs font-semibold hover:bg-stone-800 dark:hover:bg-[#3E424B] transition cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
