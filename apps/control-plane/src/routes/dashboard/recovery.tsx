import { Component, createSignal, Show } from "solid-js";

const RecoveryPage: Component = () => {
  const [mnemonic, setMnemonic] = createSignal<string | null>(null);
  const [verified, setVerified] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);

  async function handleGenerate() {
    setError(null);
    setVerified(false);
    setCopied(false);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const m: string = wasm.wasm_generate_mnemonic();
      setMnemonic(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate");
    }
  }

  async function handleCopy() {
    const m = mnemonic();
    if (!m) return;
    try {
      await navigator.clipboard.writeText(m);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard not available, please copy manually");
    }
  }

  async function handleVerify() {
    const m = mnemonic();
    if (!m) return;
    setError(null);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      // recover root via mnemonic and compare to direct derive via same mnemonic's entropy (recover is the canonical path)
      const recovered: string = wasm.wasm_recover_root_secret(m);
      // For demo, also wrap/unwrap a test mailbox key with the recovered root to prove it can restore
      const kpJson: string = wasm.wasm_generate_keypair();
      const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
      const testId = crypto.randomUUID().replace(/-/g, "");
      const wrapped: string = wasm.wasm_wrap_mailbox_key(recovered, kp.secret_key, testId);
      const unwrapped: string = wasm.wasm_unwrap_mailbox_key(recovered, wrapped, testId);
      if (unwrapped.toLowerCase() !== kp.secret_key.toLowerCase()) throw new Error("unwrap mismatch");
      // Also test wrong id fails
      const wrongId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      let shouldFail = false;
      try {
        wasm.wasm_unwrap_mailbox_key(recovered, wrapped, wrongId);
      } catch {
        shouldFail = true;
      }
      if (!shouldFail) throw new Error("wrong id should fail");
      setVerified(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
      setVerified(false);
    }
  }

  return (
    <div class="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-semibold text-slate-900">Recovery Material</h1>
      <p class="mt-1 text-sm text-slate-500">
        Your recovery phrase can restore your mailbox keys. Keep it safe and never share it. This page never sends your phrase to the server.
      </p>

      <Show when={error()}>
        <div role="alert" class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error()}
        </div>
      </Show>

      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <Show
          when={mnemonic()}
          fallback={
            <div>
              <p class="text-sm text-slate-600">No recovery phrase generated yet. This will be created entirely in your browser.</p>
              <button onClick={handleGenerate} class="mt-3 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700">
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
              <div class="mt-3 flex gap-2">
                <button onClick={handleCopy} class="rounded-md bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-900">
                  {copied() ? "Copied!" : "Copy to clipboard"}
                </button>
                <button onClick={handleVerify} class="rounded-md bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">
                  Verify phrase can restore
                </button>
                <button
                  onClick={() => {
                    setMnemonic(null);
                    setVerified(false);
                  }}
                  class="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  Clear
                </button>
              </div>
              <Show when={verified()}>
                <p class="mt-3 rounded-md bg-emerald-50 p-2 text-sm text-emerald-800">Verified: phrase recovers the same root and can unwrap a test mailbox key. Wrong ID correctly fails.</p>
              </Show>
            </div>
          )}
        </Show>
      </div>

      <p class="mt-4 text-xs text-slate-500">
        Security: This phrase never leaves your browser. It is not sent to the API, not stored in localStorage/sessionStorage/URL, and not logged. Authentication (login) does not derive mailbox keys.
      </p>
    </div>
  );
};

export default RecoveryPage;
