import { Component, createSignal, Show, For, onMount } from "solid-js";
import { register, checkEmailAvailability, me, logout } from "../lib/api/auth";
import {
  evaluatePasswordStrength,
  performCryptographicCeremony,
  CeremonyResult,
} from "../lib/crypto/client_crypto";

type CeremonyStep = 1 | 2 | 3 | 4;

const RegisterPage: Component = () => {
  const [currentStep, setCurrentStep] = createSignal<CeremonyStep>(1);
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);

  // Step 2 & 3 State
  const [generationProgress, setGenerationProgress] = createSignal(0);
  const [generationStatus, setGenerationStatus] = createSignal("");
  const [ceremonyData, setCeremonyData] = createSignal<CeremonyResult | null>(null);
  const [hasConfirmedBackup, setHasConfirmedBackup] = createSignal(false);
  const [copiedPhrase, setCopiedPhrase] = createSignal(false);

  // Network & Error State
  const [error, setError] = createSignal<string | null>(null);
  const [networkLoading, setNetworkLoading] = createSignal(false);
  const [activeSessionUser, setActiveSessionUser] = createSignal<{ email: string; id: string } | null>(null);

  onMount(async () => {
    try {
      const session = await me();
      if (session && session.id && session.email) {
        setActiveSessionUser({ email: session.email, id: session.id });
      }
    } catch {
      // Unauthenticated / guest session
    }
  });

  const passwordStrength = () => evaluatePasswordStrength(password());

  // Step 1 -> Step 2: Trigger Cryptographic Ceremony
  async function handleBeginCeremony(e: Event) {
    e.preventDefault();
    setError(null);

    const em = email().trim().toLowerCase();
    if (!em || !em.includes("@")) {
      setError("Please enter a valid work or organization email address.");
      return;
    }

    if (!passwordStrength().isCompliant) {
      setError("Password must meet the minimum security strength criteria (at least 10 characters with mixed character classes).");
      return;
    }

    if (password() !== confirmPassword()) {
      setError("Passwords do not match. Please re-enter your password.");
      return;
    }

    setNetworkLoading(true);
    try {
      const check = await checkEmailAvailability(em);
      if (check.already_logged_in) {
        setError(`The email "${em}" is already logged in on this browser. Please access your Control Panel or log out first.`);
        setNetworkLoading(false);
        return;
      }
      if (check.exists) {
        setError(`The email "${em}" is already registered. Please sign in instead.`);
        setNetworkLoading(false);
        return;
      }
    } catch (err: any) {
      if (err?.status === 400) {
        setError("Please enter a valid work or organization email address.");
        setNetworkLoading(false);
        return;
      }
      console.warn("Email pre-check notice:", err);
    } finally {
      setNetworkLoading(false);
    }

    // Advance to Step 2: Client-Side Generation
    setCurrentStep(2);
    setGenerationProgress(10);
    setGenerationStatus("Initializing WebAssembly Crypto Core…");

    try {
      const result = await performCryptographicCeremony(
        em,
        password(),
        (status, percent) => {
          setGenerationStatus(status);
          setGenerationProgress(percent);
        }
      );

      setCeremonyData(result);
      // Brief pause to allow user to register completion before showing Step 3
      await new Promise((r) => setTimeout(r, 400));
      setCurrentStep(3);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cryptographic generation failed.";
      setError(msg);
      setCurrentStep(1);
    }
  }

  // Step 3 Actions: Copy and Download
  async function handleCopyPhrase() {
    const data = ceremonyData();
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.recoveryPhrase);
      setCopiedPhrase(true);
      setTimeout(() => setCopiedPhrase(false), 2500);
    } catch {
      setError("Clipboard access denied. Please write down the 12 words manually.");
    }
  }

  function handleDownloadBackup() {
    const data = ceremonyData();
    if (!data) return;
    const em = email().trim();
    const dateStr = new Date().toISOString().slice(0, 10);
    const content = [
      `BYOS Self-Sovereign Email — Zero-Knowledge Recovery Phrase`,
      `============================================================`,
      `Account: ${em}`,
      `Created: ${new Date().toUTCString()}`,
      `Public Identity Key: ${data.publicKey}`,
      ``,
      `CRITICAL SECURITY NOTICE:`,
      `BYOS servers never hold your private key or password. These 12 words`,
      `are the sole mathematical verifier capable of reconstituting your root`,
      `cryptographic credentials. Store this file in an offline vault.`,
      ``,
      `12-Word Recovery Phrase:`,
      `${data.recoveryPhrase}`,
      `============================================================`,
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `byos-recovery-phrase-${em.replace(/[^a-z0-9]/gi, "_")}-${dateStr}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Step 3 -> Step 4: Transmit Zero-Knowledge Payload
  async function handleFinalizeRegistration() {
    const data = ceremonyData();
    if (!data || !hasConfirmedBackup()) return;

    setError(null);
    setCurrentStep(4);
    setNetworkLoading(true);

    try {
      const em = email().trim().toLowerCase();
      // Transmit ONLY public key, encrypted private key, and PBKDF2 password verifier
      const res = await register(
        em,
        data.passwordVerifier,
        data.publicKey,
        data.wrappedPrivateKey,
        data.recoverySalt
      );

      // Successfully registered & session established. Route to Onboarding Pricing
      const currentParams = new URLSearchParams(window.location.search);
      const seatsParam = currentParams.get("seats");
      const cycleParam = currentParams.get("billing_cycle") || currentParams.get("cycle");
      const targetQuery = new URLSearchParams({ org_id: res.org_id });
      if (seatsParam) {
        targetQuery.set("seats", seatsParam);
      }
      if (cycleParam) {
        targetQuery.set("billing_cycle", cycleParam);
      }
      window.location.replace(`/onboarding/pricing?${targetQuery.toString()}`);
    } catch (err: any) {
      const status = (err as unknown as { status: number })?.status;
      if (status === 409) {
        setError("This email address is already registered. Please sign in instead.");
      } else if (status === 400) {
        setError("Invalid cryptographic parameters or malformed verifier.");
      } else {
        setError(err?.message || "Registration failed. Please check network connection.");
      }
      setNetworkLoading(false);
      setCurrentStep(3);
    }
  }

  return (
    <div class="min-h-screen bg-[#F0EEE9] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 text-[#3C3D3E]">
      <div class="sm:mx-auto sm:w-full sm:max-w-xl text-center mb-6">
        <div class="inline-flex w-12 h-12 rounded-xl bg-[#9E725F] items-center justify-center text-[#F0EEE9] font-mono font-bold text-base shadow-sm mb-3">
          BYOS
        </div>
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-[#3C3D3E]">
          {currentStep() === 1 && "Create Your Sovereign Account"}
          {currentStep() === 2 && "Client-Side Cryptographic Ceremony"}
          {currentStep() === 3 && "Save Your Master Recovery Phrase"}
          {currentStep() === 4 && "Sealing Zero-Knowledge Account"}
        </h1>
        <p class="mt-2 text-xs sm:text-sm text-[#6F7173] max-w-md mx-auto">
          {currentStep() === 1 && "No phone numbers, names, or corporate tracking. Only your email and local cryptographic keys."}
          {currentStep() === 2 && "Generating Ed25519 keypairs and executing local Argon2id key derivation in WebAssembly."}
          {currentStep() === 3 && "These 12 words form your immutable emergency root. Keep them completely offline."}
          {currentStep() === 4 && "Transmitting public identity and encrypted credentials to the decentralized cluster."}
        </p>

        {/* Step Indicator Bar */}
        <div class="flex items-center justify-center gap-2 mt-5">
          <For each={[1, 2, 3, 4]}>
            {(step) => (
              <div class="flex items-center">
                <div
                  class={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                    currentStep() === step
                      ? "bg-[#9E725F] text-white ring-4 ring-[#9E725F]/20"
                      : currentStep() > step
                      ? "bg-[#9E725F]/20 text-[#9E725F]"
                      : "bg-white border border-[#E2DFD8] text-stone-400"
                  }`}
                >
                  {currentStep() > step ? "✓" : step}
                </div>
                {step < 4 && (
                  <div
                    class={`w-8 sm:w-12 h-0.5 mx-1 transition-all ${
                      currentStep() > step ? "bg-[#9E725F]" : "bg-[#E2DFD8]"
                    }`}
                  />
                )}
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="sm:mx-auto sm:w-full sm:max-w-xl">
        <div class="bg-white py-8 px-6 sm:px-10 shadow-sm border border-[#E2DFD8] rounded-2xl">
          <Show when={error()}>
            <div
              role="alert"
              class="mb-6 rounded-lg bg-rose-50 p-3.5 text-xs text-rose-800 border border-rose-200 flex items-start gap-2.5"
            >
              <svg class="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{error()}</span>
            </div>
          </Show>

          {/* ============================================================ */}
          {/* STEP 1: CREDENTIALS (Email + Password with Strict Strength)   */}
          {/* ============================================================ */}
          <Show when={currentStep() === 1}>
            <Show when={activeSessionUser()}>
              <div class="mb-5 rounded-xl bg-amber-50/90 border border-amber-200 p-3.5 text-xs text-amber-900 flex flex-col gap-2">
                <div class="flex items-center gap-2 font-semibold text-amber-800">
                  <svg class="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Active Session Detected</span>
                </div>
                <p class="text-[11px] text-amber-800">
                  You are currently signed in as <span class="font-mono font-bold text-amber-950">{activeSessionUser()?.email}</span>. If you wish to create a separate sovereign organization, you can continue below or sign out.
                </p>
                <div class="flex items-center gap-2 pt-1">
                  <a
                    href="/dashboard"
                    class="inline-flex items-center px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-800 text-white font-medium text-[11px] transition-colors"
                  >
                    Go to Control Panel →
                  </a>
                  <button
                    type="button"
                    onClick={async () => {
                      await logout();
                      setActiveSessionUser(null);
                    }}
                    class="inline-flex items-center px-2.5 py-1 rounded border border-amber-300 bg-white hover:bg-amber-50 text-amber-900 font-medium text-[11px] transition-colors cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            </Show>
            <form onSubmit={handleBeginCeremony} class="space-y-5">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                  Desired Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email()}
                  onInput={(e) => setEmail(e.currentTarget.value)}
                  placeholder="founder@yourdomain.com"
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
                />
                <p class="mt-1 text-[11px] text-[#6F7173]">
                  Used as your primary administrative identity. No personal KYC data collected.
                </p>
              </div>

              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173]">
                    Master Passphrase
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword())}
                    class="text-[11px] text-[#9E725F] hover:underline font-medium focus:outline-none"
                  >
                    {showPassword() ? "Hide" : "Show"}
                  </button>
                </div>
                <input
                  type={showPassword() ? "text" : "password"}
                  required
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder="••••••••••••••••"
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
                />

                {/* Password Strength Meter */}
                <div class="mt-2.5 space-y-2">
                  <div class="flex items-center justify-between text-[11px]">
                    <span class="text-[#6F7173]">Passphrase Entropy:</span>
                    <span
                      class={`font-semibold ${
                        passwordStrength().score >= 4
                          ? "text-emerald-700"
                          : passwordStrength().score === 3
                          ? "text-[#9E725F]"
                          : passwordStrength().score === 2
                          ? "text-amber-700"
                          : "text-rose-600"
                      }`}
                    >
                      {passwordStrength().label}
                    </span>
                  </div>

                  {/* 4-Segment Strength Bar */}
                  <div class="grid grid-cols-4 gap-1.5 h-1.5">
                    <div
                      class={`rounded-full transition-all ${
                        passwordStrength().score >= 1
                          ? passwordStrength().score === 1
                            ? "bg-rose-500"
                            : "bg-[#9E725F]"
                          : "bg-stone-200"
                      }`}
                    />
                    <div
                      class={`rounded-full transition-all ${
                        passwordStrength().score >= 2
                          ? passwordStrength().score === 2
                            ? "bg-amber-500"
                            : "bg-[#9E725F]"
                          : "bg-stone-200"
                      }`}
                    />
                    <div
                      class={`rounded-full transition-all ${
                        passwordStrength().score >= 3 ? "bg-[#9E725F]" : "bg-stone-200"
                      }`}
                    />
                    <div
                      class={`rounded-full transition-all ${
                        passwordStrength().score >= 4 ? "bg-emerald-600" : "bg-stone-200"
                      }`}
                    />
                  </div>

                  {/* Checklist */}
                  <div class="grid grid-cols-2 gap-1.5 pt-1 text-[11px] text-[#6F7173]">
                    <div class="flex items-center gap-1.5">
                      <span class={passwordStrength().hasLength ? "text-emerald-600" : "text-stone-300"}>
                        {passwordStrength().hasLength ? "✓" : "○"}
                      </span>
                      <span>10+ characters</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class={passwordStrength().hasUpper ? "text-emerald-600" : "text-stone-300"}>
                        {passwordStrength().hasUpper ? "✓" : "○"}
                      </span>
                      <span>Uppercase letter</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class={passwordStrength().hasLower ? "text-emerald-600" : "text-stone-300"}>
                        {passwordStrength().hasLower ? "✓" : "○"}
                      </span>
                      <span>Lowercase letter</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class={passwordStrength().hasNumber ? "text-emerald-600" : "text-stone-300"}>
                        {passwordStrength().hasNumber ? "✓" : "○"}
                      </span>
                      <span>Numeric digit</span>
                    </div>
                    <div class="flex items-center gap-1.5 col-span-2">
                      <span class={passwordStrength().hasSpecial ? "text-emerald-600" : "text-stone-300"}>
                        {passwordStrength().hasSpecial ? "✓" : "○"}
                      </span>
                      <span>Special symbol (!@#$%^&*)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                  Confirm Master Passphrase
                </label>
                <input
                  type={showPassword() ? "text" : "password"}
                  required
                  value={confirmPassword()}
                  onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                  placeholder="••••••••••••••••"
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2.5 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
                />
              </div>

              {/* Zero-Knowledge Guarantees Badge */}
              <div class="rounded-xl bg-[#FAF9F6] border border-[#E2DFD8] p-3.5 space-y-1.5 text-xs text-[#3C3D3E]">
                <div class="flex items-center gap-1.5 font-semibold text-[#9E725F]">
                  <svg class="w-4 h-4 text-[#9E725F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Zero-Knowledge Boundary Assurance</span>
                </div>
                <p class="text-[11px] text-[#6F7173] leading-relaxed">
                  Your plaintext password is never sent across the network. It will be pre-hashed locally via PBKDF2/Argon2 before transmission, and used to locally seal your private keys.
                </p>
              </div>

              <button
                type="submit"
                disabled={!passwordStrength().isCompliant || password() !== confirmPassword() || networkLoading()}
                class="w-full inline-flex justify-center items-center gap-2 rounded-lg bg-[#9E725F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#865E4D] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30 disabled:opacity-40 transition-colors cursor-pointer"
              >
                {networkLoading() ? "Verifying Email…" : "Begin Cryptographic Ceremony →"}
              </button>
            </form>
          </Show>

          {/* ============================================================ */}
          {/* STEP 2: CLIENT-SIDE WASM GENERATION (Loading State)          */}
          {/* ============================================================ */}
          <Show when={currentStep() === 2}>
            <div class="py-8 space-y-6 text-center">
              <div class="relative w-20 h-20 mx-auto flex items-center justify-center">
                <div class="absolute inset-0 rounded-full border-4 border-[#E2DFD8] border-t-[#9E725F] animate-spin" />
                <div class="w-12 h-12 rounded-full bg-[#9E725F]/10 flex items-center justify-center text-[#9E725F]">
                  <svg class="w-6 h-6 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
                  </svg>
                </div>
              </div>

              <div class="space-y-2">
                <h3 class="text-base font-bold text-[#3C3D3E]">
                  Synthesizing Cryptographic Material
                </h3>
                <p class="text-xs font-mono text-[#9E725F]">
                  {generationStatus()}
                </p>
              </div>

              {/* Progress Track */}
              <div class="w-full bg-[#F0EEE9] rounded-full h-2 overflow-hidden border border-[#E2DFD8]">
                <div
                  class="bg-[#9E725F] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${generationProgress()}%` }}
                />
              </div>

              <div class="bg-[#FAF9F6] border border-[#E2DFD8] rounded-xl p-3.5 text-left font-mono text-[11px] space-y-1 text-[#6F7173]">
                <div class="flex items-center justify-between text-stone-700 font-semibold border-b border-[#E2DFD8] pb-1">
                  <span>WASM Operations</span>
                  <span>Status</span>
                </div>
                <div class="flex items-center justify-between">
                  <span>• Entropy generation (CSPRNG):</span>
                  <span class="text-emerald-700">COMPLETED</span>
                </div>
                <div class="flex items-center justify-between">
                  <span>• X25519/Ed25519 asymmetric pair:</span>
                  <span class={generationProgress() >= 35 ? "text-emerald-700" : "text-amber-600 animate-pulse"}>
                    {generationProgress() >= 35 ? "READY" : "PROCESSING…"}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span>• BIP-39 12-word phrase:</span>
                  <span class={generationProgress() >= 55 ? "text-emerald-700" : "text-stone-400"}>
                    {generationProgress() >= 55 ? "SEALED" : "PENDING"}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span>• Argon2id (m=64MB, t=3, p=2):</span>
                  <span class={generationProgress() >= 75 ? "text-emerald-700" : "text-stone-400"}>
                    {generationProgress() >= 75 ? "WRAPPED" : "PENDING"}
                  </span>
                </div>
                <div class="flex items-center justify-between">
                  <span>• PBKDF2-SHA256 verifier:</span>
                  <span class={generationProgress() >= 90 ? "text-emerald-700" : "text-stone-400"}>
                    {generationProgress() >= 90 ? "CALCULATED" : "PENDING"}
                  </span>
                </div>
              </div>
            </div>
          </Show>

          {/* ============================================================ */}
          {/* STEP 3: RECOVERY PHRASE DISPLAY & CONFIRMATION               */}
          {/* ============================================================ */}
          <Show when={currentStep() === 3 && ceremonyData()}>
            <div class="space-y-6">
              <div class="bg-amber-50/80 border border-amber-200 rounded-xl p-3.5 text-xs text-amber-900 space-y-1">
                <div class="flex items-center gap-1.5 font-bold text-amber-800">
                  <svg class="w-4 h-4 text-amber-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <span>12-Word Master Recovery Phrase</span>
                </div>
                <p class="text-[11px] text-amber-800 leading-normal">
                  Write down these 12 words in order. Without them, account recovery is mathematically impossible if your password is lost. BYOS staff cannot reset your access.
                </p>
              </div>

              {/* 12-Word Card Grid */}
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 p-4 rounded-xl bg-[#FAF9F6] border border-[#E2DFD8]">
                <For each={ceremonyData()?.recoveryWords || []}>
                  {(word, idx) => (
                    <div class="flex items-center gap-2 bg-white border border-[#E2DFD8] rounded-lg px-3 py-2 shadow-2xs font-mono text-xs">
                      <span class="text-stone-400 select-none text-[10px] w-4 text-right">
                        {idx() + 1}.
                      </span>
                      <span class="font-bold text-[#3C3D3E] select-all">
                        {word}
                      </span>
                    </div>
                  )}
                </For>
              </div>

              {/* Copy & Download Buttons */}
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCopyPhrase}
                  class="flex-1 inline-flex justify-center items-center gap-1.5 py-2 px-3 rounded-lg border border-[#E2DFD8] bg-white hover:bg-[#F0EEE9] text-xs font-semibold text-[#3C3D3E] shadow-2xs transition-colors cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 text-[#9E725F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10a2 2 0 00-2 2v3a2 2 0 002 2h10a2 2 0 002-2v-3a2 2 0 00-2-2z" />
                  </svg>
                  <span>{copiedPhrase() ? "Copied to Clipboard!" : "Copy 12 Words"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  class="flex-1 inline-flex justify-center items-center gap-1.5 py-2 px-3 rounded-lg border border-[#E2DFD8] bg-white hover:bg-[#F0EEE9] text-xs font-semibold text-[#3C3D3E] shadow-2xs transition-colors cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 text-[#9E725F]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download Backup .txt</span>
                </button>
              </div>

              {/* Mandatory Acknowledgment Checkbox */}
              <div class="pt-2 border-t border-[#E2DFD8]">
                <label class="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hasConfirmedBackup()}
                    onChange={(e) => setHasConfirmedBackup(e.currentTarget.checked)}
                    class="mt-0.5 rounded border-[#E2DFD8] text-[#9E725F] focus:ring-[#9E725F]/30 h-4 w-4 cursor-pointer"
                  />
                  <span class="text-xs text-[#3C3D3E] leading-relaxed">
                    <span class="font-semibold text-stone-900">I have saved this phrase safely</span> in an offline vault or password manager. I understand that without these 12 words, lost accounts cannot be recovered.
                  </span>
                </label>
              </div>

              <div class="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  class="flex-1 inline-flex justify-center items-center py-2.5 px-4 rounded-lg border border-[#E2DFD8] bg-white hover:bg-[#F0EEE9] text-sm font-semibold text-[#3C3D3E] shadow-2xs transition-colors cursor-pointer"
                >
                  ← Back to Step 1
                </button>
                <button
                  type="button"
                  disabled={!hasConfirmedBackup() || networkLoading()}
                  onClick={handleFinalizeRegistration}
                  class="flex-2 inline-flex justify-center items-center rounded-lg bg-[#9E725F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#865E4D] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30 disabled:opacity-40 transition-colors cursor-pointer"
                >
                  {networkLoading() ? "Provisioning…" : "Seal Ceremony & Provision Account →"}
                </button>
              </div>
            </div>
          </Show>

          {/* ============================================================ */}
          {/* STEP 4: NETWORK PAYLOAD TRANSMISSION                         */}
          {/* ============================================================ */}
          <Show when={currentStep() === 4}>
            <div class="py-10 space-y-6 text-center">
              <div class="w-16 h-16 mx-auto rounded-full bg-[#9E725F]/10 flex items-center justify-center text-[#9E725F]">
                <svg class="w-8 h-8 animate-pulse stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>

              <div class="space-y-2">
                <h3 class="text-base font-bold text-[#3C3D3E]">
                  Provisioning Zero-Knowledge Account
                </h3>
                <p class="text-xs text-[#6F7173] max-w-sm mx-auto">
                  Transmitting public identity and encrypted vault parameters. Plaintext password is never revealed.
                </p>
              </div>

              <div class="bg-[#FAF9F6] border border-[#E2DFD8] rounded-xl p-3.5 text-left font-mono text-[11px] text-[#6F7173] space-y-1.5">
                <div class="text-[10px] text-stone-400 uppercase tracking-wider font-semibold">
                  Network Wire Payload:
                </div>
                <div class="truncate">
                  <span class="text-stone-800 font-semibold">org_recovery_pk:</span> {ceremonyData()?.publicKey.slice(0, 16)}…
                </div>
                <div class="truncate">
                  <span class="text-stone-800 font-semibold">wrapped_private_key:</span> {ceremonyData()?.wrappedPrivateKey.slice(0, 16)}…
                </div>
                <div class="truncate">
                  <span class="text-stone-800 font-semibold">password_verifier:</span> {ceremonyData()?.passwordVerifier.slice(0, 16)}… (PBKDF2)
                </div>
                <div class="text-emerald-700 font-semibold pt-1">
                  ✓ Plaintext Passphrase: NOT TRANSMITTED
                </div>
              </div>
            </div>
          </Show>

          <div class="mt-6 pt-6 border-t border-[#E2DFD8] text-center text-xs text-[#6F7173]">
            Already registered with your cryptographic keys?{" "}
            <a
              href={`/login${typeof window !== "undefined" ? window.location.search : ""}`}
              class="font-semibold text-[#9E725F] hover:text-[#865E4D] hover:underline"
            >
              Sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
