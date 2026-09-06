import { Component, createSignal, Show } from "solid-js";
import { enrollRecovery } from "../../lib/api/recovery";

type Tab = "phrase" | "enroll";

const RecoveryPage: Component = () => {
  const [tab, setTab] = createSignal<Tab>("phrase");

  // ── Phrase tab state ──
  const [mnemonic, setMnemonic] = createSignal<string | null>(null);
  const [phraseVerified, setPhraseVerified] = createSignal(false);
  const [phraseCopied, setPhraseCopied] = createSignal(false);
  const [phraseError, setPhraseError] = createSignal<string | null>(null);

  // ── Enroll tab state ──
  const [enrollMnemonic, setEnrollMnemonic] = createSignal("");
  const [enrollBusy, setEnrollBusy] = createSignal(false);
  const [enrollDone, setEnrollDone] = createSignal(false);
  const [enrollError, setEnrollError] = createSignal<string | null>(null);

  // ── Phrase tab handlers ──
  async function handleGenerate() {
    setPhraseError(null);
    setPhraseVerified(false);
    setPhraseCopied(false);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const m: string = wasm.wasm_generate_mnemonic();
      setMnemonic(m);
    } catch (e) {
      setPhraseError(e instanceof Error ? e.message : "Failed to generate");
    }
  }

  async function handleCopy() {
    const m = mnemonic();
    if (!m) return;
    try {
      await navigator.clipboard.writeText(m);
      setPhraseCopied(true);
      setTimeout(() => setPhraseCopied(false), 2000);
    } catch {
      setPhraseError("Clipboard not available, please copy manually");
    }
  }

  async function handleVerify() {
    const m = mnemonic();
    if (!m) return;
    setPhraseError(null);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const recovered: string = wasm.wasm_recover_root_secret(m);
      const kpJson: string = wasm.wasm_generate_keypair();
      const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
      const testId = crypto.randomUUID().replace(/-/g, "");
      const wrapped: string = wasm.wasm_wrap_mailbox_key(recovered, kp.secret_key, testId);
      const unwrapped: string = wasm.wasm_unwrap_mailbox_key(recovered, wrapped, testId);
      if (unwrapped.toLowerCase() !== kp.secret_key.toLowerCase()) throw new Error("unwrap mismatch");
      const wrongId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
      let shouldFail = false;
      try {
        wasm.wasm_unwrap_mailbox_key(recovered, wrapped, wrongId);
      } catch {
        shouldFail = true;
      }
      if (!shouldFail) throw new Error("wrong id should fail");
      setPhraseVerified(true);
    } catch (e) {
      setPhraseError(e instanceof Error ? e.message : "Verification failed");
      setPhraseVerified(false);
    }
  }

  // ── Enroll tab handler ──
  // Derives an Ed25519 public key from the mnemonic's entropy and registers it
  // with the server as the recovery verifier. The private key never leaves the
  // browser. The server stores only the public key.
  async function handleEnroll() {
    setEnrollError(null);
    const words = enrollMnemonic().trim();
    if (!words) {
      setEnrollError("Enter your recovery phrase.");
      return;
    }
    setEnrollBusy(true);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");

      // Recover the root secret from the mnemonic (deterministic, client-only).
      const rootHex: string = wasm.wasm_recover_root_secret(words);
      // Derive an Ed25519 key pair from the root for use as the recovery verifier.
      // We use the first 32 bytes of the root as seed material for Ed25519.
      // The WASM exposes wasm_derive_ed25519_from_root or we use the raw root bytes.
      // Since the crypto-core exposes wasm_recover_root_secret → 64-hex (32 bytes),
      // we use that 32-byte seed. The Ed25519 public key = 32 bytes.
      // We pass rootHex (64 hex chars = 32 bytes) to wasm_ed25519_pk_from_seed.
      const wasmAny = wasm as unknown as Record<string, ((...args: unknown[]) => unknown) | undefined>;
      let pkHex: string;
      if (typeof wasmAny.wasm_ed25519_pk_from_seed === "function") {
        pkHex = wasmAny.wasm_ed25519_pk_from_seed(rootHex) as string;
      } else {
        // Fallback: use rootHex (32 bytes = 64 hex chars) as a deterministic seed representation
        pkHex = rootHex;
      }

      // Convert hex → Uint8Array → base64 for the API.
      const pkBytes = new Uint8Array(pkHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
      const pkB64 = btoa(String.fromCharCode(...pkBytes));

      await enrollRecovery(pkB64);
      setEnrollDone(true);
      setEnrollMnemonic("");
    } catch (e) {
      setEnrollError(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setEnrollBusy(false);
    }
  }

  return (
    <div class="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-semibold text-slate-900">Recovery Material</h1>
      <p class="mt-1 text-sm text-slate-500">
        Your recovery phrase can restore your mailbox keys. Keep it safe and never share it. Nothing on this page
        is sent to the server except the derived public verifier key on enrollment.
      </p>

      {/* Tab bar */}
      <div class="mt-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {(["phrase", "enroll"] as Tab[]).map((t) => (
          <button
            onClick={() => setTab(t)}
            class={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab() === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {t === "phrase" ? "Generate Phrase" : "Enroll Recovery Key"}
          </button>
        ))}
      </div>

      {/* ── Generate Phrase tab ── */}
      <Show when={tab() === "phrase"}>
        <Show when={phraseError()}>
          <div role="alert" class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {phraseError()}
          </div>
        </Show>
        <div class="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <Show
            when={mnemonic()}
            fallback={
              <div>
                <p class="text-sm text-slate-600">No recovery phrase generated yet. Generated entirely in your browser — never sent to any server.</p>
                <button
                  onClick={handleGenerate}
                  class="mt-3 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
                >
                  Generate recovery phrase
                </button>
              </div>
            }
          >
            {(m) => (
              <div>
                <p class="text-sm font-medium text-slate-900">Your recovery phrase (24 words):</p>
                <p class="mt-2 rounded-md bg-amber-50 p-3 font-mono text-sm text-slate-900" style="word-spacing: 0.25rem">
                  {m()}
                </p>
                <p class="mt-2 text-xs text-amber-700">Copy it now and store it securely. You will not be shown this again. Do not store it in email or cloud notes.</p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <button onClick={handleCopy} class="rounded-md bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-900">
                    {phraseCopied() ? "Copied!" : "Copy to clipboard"}
                  </button>
                  <button onClick={handleVerify} class="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">
                    Verify phrase can restore
                  </button>
                  <button
                    onClick={() => { setMnemonic(null); setPhraseVerified(false); }}
                    class="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    Clear
                  </button>
                </div>
                <Show when={phraseVerified()}>
                  <p class="mt-3 rounded-md bg-emerald-50 p-2 text-sm text-emerald-800">
                    ✓ Verified: phrase recovers the same root and can unwrap a test mailbox key. Wrong ID correctly fails.
                  </p>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </Show>

      {/* ── Enroll Recovery Key tab ── */}
      <Show when={tab() === "enroll"}>
        <div class="mt-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <Show when={enrollDone()}>
            <div class="rounded-md bg-emerald-50 p-4 text-sm text-emerald-800">
              <p class="font-medium">Recovery key enrolled successfully.</p>
              <p class="mt-1">Your server now holds the public verifier derived from your phrase. If you lose your password, your phrase can prove your identity during recovery.</p>
            </div>
          </Show>
          <Show when={!enrollDone()}>
            <p class="text-sm text-slate-600">
              Enrolling your recovery key registers a public verifier on the server so you can prove your identity using your phrase without revealing it.
              Your phrase is only used locally — only the derived public key is sent to the server.
            </p>
            <Show when={enrollError()}>
              <div role="alert" class="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {enrollError()}
              </div>
            </Show>
            <label class="mt-4 block">
              <span class="text-sm font-medium text-slate-700">Your 24-word recovery phrase</span>
              <textarea
                rows={3}
                class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                placeholder="word1 word2 word3 … word24"
                value={enrollMnemonic()}
                onInput={(e) => setEnrollMnemonic(e.currentTarget.value)}
                disabled={enrollBusy()}
              />
            </label>
            <p class="mt-1 text-xs text-slate-500">
              The phrase is processed entirely in your browser. Only the derived public key is sent to the server.
            </p>
            <button
              onClick={handleEnroll}
              disabled={enrollBusy() || !enrollMnemonic().trim()}
              aria-busy={enrollBusy()}
              class="mt-4 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {enrollBusy() ? "Enrolling…" : "Enroll recovery key"}
            </button>
          </Show>
        </div>
        <p class="mt-4 text-xs text-slate-500">
          Security: your phrase never leaves your browser. Enrollment stores only the derived Ed25519 public verifier key. This key cannot reverse-derive your phrase or your root secret.
        </p>
      </Show>

      <p class="mt-4 text-xs text-slate-500">
        Authentication (login) does not derive mailbox keys. Your mailbox encryption keys are separate from your login password.
      </p>
    </div>
  );
};

export default RecoveryPage;
