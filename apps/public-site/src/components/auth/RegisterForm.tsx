import { Component, createSignal, For, Show } from "solid-js";

export const RegisterForm: Component = () => {
  const [orgName, setOrgName] = createSignal("");
  const [adminName, setAdminName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);

  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Mnemonic & Key Material Modal State
  const [showMnemonicModal, setShowMnemonicModal] = createSignal(false);
  const [mnemonic, setMnemonic] = createSignal("");
  const [mnemonicCopied, setMnemonicCopied] = createSignal(false);
  const [confirmedSaved, setConfirmedSaved] = createSignal(false);

  // Derived key material stored during modal step
  const [derivedOrgPk, setDerivedOrgPk] = createSignal("");
  const [derivedWrappedSk, setDerivedWrappedSk] = createSignal("");
  const [derivedSalt, setDerivedSalt] = createSignal("");

  const apiBase = () => {
    // If an explicit API URL is configured (production), use it.
    // Otherwise use an empty base so /v1 requests route through the
    // Vite dev-server proxy (astro.config.mjs → vite.server.proxy).
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_API_URL;
    return envUrl ?? "";
  };

  // Password Entropy & Strength Calculation
  const passwordStrength = () => {
    const pw = password();
    if (!pw) return { score: 0, label: "Empty", color: "bg-stone-300", width: "w-0" };
    let score = 0;
    if (pw.length >= 12) score += 1;
    if (pw.length >= 16) score += 1;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
    if (/\d/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;

    if (score <= 2) return { score, label: "Weak (Min. 12 chars required)", color: "bg-rose-500", width: "w-1/4" };
    if (score === 3) return { score, label: "Fair", color: "bg-amber-500", width: "w-2/4" };
    if (score === 4) return { score, label: "Good", color: "bg-emerald-500", width: "w-3/4" };
    return { score, label: "Strong", color: "bg-emerald-600", width: "w-full" };
  };

  const isFormValid = () => {
    return (
      orgName().trim().length >= 2 &&
      adminName().trim().length >= 2 &&
      email().includes("@") &&
      password().length >= 12 &&
      password() === confirmPassword()
    );
  };

  async function handleInitialSubmit(e: Event) {
    e.preventDefault();
    if (!isFormValid()) {
      if (password().length < 12) {
        setError("Password must be at least 12 characters.");
      } else if (password() !== confirmPassword()) {
        setError("Passwords do not match.");
      }
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Step 1: Initialize WASM Cryptography client-side
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");

      // Generate 24-word BIP-39 Sovereign Recovery Phrase
      const phrase = wasm.wasm_generate_mnemonic();
      setMnemonic(phrase);

      // Generate initial Ed25519 Organization Recovery Keypair
      const keypair = JSON.parse(wasm.wasm_generate_keypair()) as {
        secret_key: string;
        public_key: string;
      };

      // Wrap secret key under user's master password
      const salt = new Uint8Array(16);
      crypto.getRandomValues(salt);
      const saltHex = Array.from(salt)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const wrappedSk = wasm.wasm_passphrase_wrap_key(
        password(),
        saltHex,
        keypair.secret_key
      );

      setDerivedOrgPk(keypair.public_key);
      setDerivedWrappedSk(wrappedSk);
      setDerivedSalt(saltHex);

      // Open 24-word backup modal before completing registration
      setShowMnemonicModal(true);
    } catch (err: any) {
      console.error("WASM key generation error:", err);
      setError(err?.message || "Failed to initialize cryptographic material.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFinalizeRegistration() {
    if (!confirmedSaved()) return;
    setLoading(true);
    setError(null);

    try {
      const payload = {
        org_name: orgName().trim(),
        name: adminName().trim(),
        email: email().trim().toLowerCase(),
        password: password(),
        org_recovery_pk: derivedOrgPk(),
        wrapped_org_recovery_sk: derivedWrappedSk(),
        recovery_salt: derivedSalt(),
      };

      const response = await fetch(`${apiBase()}/v1/auth/register`, {
        method: "POST",
        credentials: "include", // Preserves HttpOnly session cookie
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 409) {
          throw new Error("This email address is already registered. Please sign in instead.");
        }
        throw new Error(errorText || `Registration failed with status ${response.status}`);
      }

      // Download recovery key backup text file
      const blob = new Blob([mnemonic()], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `byos-recovery-phrase-${orgName().toLowerCase().replace(/[^a-z0-9]/g, "-")}.txt`;
      link.click();
      URL.revokeObjectURL(link.href);

      // Automatically redirect to Control Panel Dashboard
      const host = typeof window !== "undefined" ? window.location.hostname : "127.0.0.1";
      const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
      window.location.href = `${protocol}//${host}:3000/dashboard`;
    } catch (err: any) {
      setShowMnemonicModal(false);
      setError(err?.message || "Registration request failed. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }

  function handleCopyMnemonic() {
    if (!mnemonic()) return;
    navigator.clipboard.writeText(mnemonic());
    setMnemonicCopied(true);
    setTimeout(() => setMnemonicCopied(false), 2500);
  }

  const phraseWords = () => mnemonic().trim().split(/\s+/);

  return (
    <div class="space-y-6">
      <Show when={error()}>
        <div
          role="alert"
          class="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between"
        >
          <span>{error()}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            class="text-rose-500 hover:text-rose-800 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      </Show>

      <form onSubmit={handleInitialSubmit} class="space-y-4">
        {/* Organization Name */}
        <div>
          <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
            Organization Name
          </label>
          <input
            type="text"
            required
            placeholder="Acme Corporation"
            value={orgName()}
            onInput={(e) => setOrgName(e.currentTarget.value)}
            class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white transition"
          />
        </div>

        {/* Administrator Full Name */}
        <div>
          <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
            Admin Full Name
          </label>
          <input
            type="text"
            required
            placeholder="Jane Doe"
            value={adminName()}
            onInput={(e) => setAdminName(e.currentTarget.value)}
            class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white transition"
          />
        </div>

        {/* Admin Work Email */}
        <div>
          <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
            Admin Work Email
          </label>
          <input
            type="email"
            required
            placeholder="jane@acme-corp.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white transition"
          />
        </div>

        {/* Master Password */}
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="text-xs font-semibold text-[#3C3D3E]">
              Master Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword())}
              class="text-[11px] text-[#6F7173] hover:text-[#3C3D3E] cursor-pointer"
            >
              {showPassword() ? "Hide" : "Show"}
            </button>
          </div>
          <input
            type={showPassword() ? "text" : "password"}
            required
            minLength={12}
            placeholder="Minimum 12 characters"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white transition font-mono"
          />

          {/* Password Entropy Bar */}
          <div class="mt-2 space-y-1">
            <div class="h-1.5 w-full bg-[#E2DFD8] rounded-full overflow-hidden">
              <div
                class={`h-full transition-all duration-300 ${passwordStrength().color} ${passwordStrength().width}`}
              ></div>
            </div>
            <div class="flex justify-between text-[10px] text-[#6F7173]">
              <span>Strength: {passwordStrength().label}</span>
              <span>Min. 12 characters</span>
            </div>
          </div>
        </div>

        {/* Confirm Password */}
        <div>
          <label class="block text-xs font-semibold text-[#3C3D3E] mb-1">
            Confirm Master Password
          </label>
          <input
            type={showPassword() ? "text" : "password"}
            required
            placeholder="Re-enter password"
            value={confirmPassword()}
            onInput={(e) => setConfirmPassword(e.currentTarget.value)}
            class="w-full px-3.5 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white transition font-mono"
          />
        </div>

        {/* Cryptographic Root Notice */}
        <div class="p-3 bg-[#F3ECE8] rounded-xl border border-[#9E725F]/30 text-xs text-[#3C3D3E] leading-relaxed flex items-start gap-2">
          <span class="text-base flex-shrink-0">🔐</span>
          <div>
            <span class="font-bold text-[#9E725F]">Zero-Knowledge Key Ceremony:</span> Your device will locally generate a 24-word recovery phrase and Ed25519 recovery key before submitting.
          </div>
        </div>

        {/* Submit CTA */}
        <button
          type="submit"
          disabled={loading() || !isFormValid()}
          class="w-full py-3 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2"
        >
          <Show when={loading()}>
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </Show>
          <span>{loading() ? "Initializing Cryptography…" : "Create Organization Account"}</span>
        </button>
      </form>

      {/* 24-Word Recovery Phrase Modal Dialog */}
      <Show when={showMnemonicModal()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div class="bg-white rounded-3xl border border-[#E2DFD8] shadow-2xl max-w-xl w-full p-6 sm:p-8 space-y-5 my-8">
            <div class="text-center space-y-1">
              <span class="text-2xl">🛡️</span>
              <h3 class="text-lg font-bold text-[#3C3D3E]">
                Save Your 24-Word Master Recovery Phrase
              </h3>
              <p class="text-xs text-[#6F7173]">
                This phrase is your organization's root sovereign key. Neither BYOS nor your cloud storage provider can recover your data without it.
              </p>
            </div>

            {/* 4-Column Numbered Word Grid */}
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-[#F8F7F4] p-4 rounded-2xl border border-[#E2DFD8]">
              <For each={phraseWords()}>
                {(word, idx) => (
                  <div class="flex items-center gap-2 p-2 rounded-xl bg-white border border-[#E2DFD8] text-xs">
                    <span class="text-[10px] font-mono text-[#6F7173] w-4 text-right">
                      {idx() + 1}.
                    </span>
                    <span class="font-mono font-bold text-[#3C3D3E] select-all truncate">
                      {word}
                    </span>
                  </div>
                )}
              </For>
            </div>

            {/* Actions Bar */}
            <div class="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleCopyMnemonic}
                class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9] transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>{mnemonicCopied() ? "✓ Copied!" : "📋 Copy All 24 Words"}</span>
              </button>

              <span class="text-[11px] text-[#6F7173] font-mono">
                BIP-39 Standard 256-Bit
              </span>
            </div>

            {/* Forced Confirmation Checkbox */}
            <div class="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
              <input
                type="checkbox"
                id="savedMnemonicCheck"
                checked={confirmedSaved()}
                onChange={(e) => setConfirmedSaved(e.currentTarget.checked)}
                class="w-4 h-4 mt-0.5 rounded text-[#9E725F] border-amber-300 focus:ring-[#9E725F] cursor-pointer"
              />
              <label for="savedMnemonicCheck" class="cursor-pointer text-xs font-medium leading-relaxed">
                I confirm that I have safely written down or stored these 24 words. I understand that without this phrase, organization recovery is cryptographically impossible.
              </label>
            </div>

            {/* Complete Registration Button */}
            <div class="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowMnemonicModal(false)}
                class="w-1/3 py-2.5 rounded-xl border border-[#E2DFD8] text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9] transition cursor-pointer"
              >
                Back
              </button>
              <button
                type="button"
                disabled={loading() || !confirmedSaved()}
                onClick={handleFinalizeRegistration}
                class="w-2/3 py-2.5 rounded-xl bg-[#9E725F] text-white text-xs font-bold hover:bg-[#865E4D] transition shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Show when={loading()}>
                  <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                </Show>
                <span>{loading() ? "Provisioning Organization…" : "Complete Registration →"}</span>
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
