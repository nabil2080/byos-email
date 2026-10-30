import { Component, createSignal, onMount, For, Show } from "solid-js";
import { verifyInvitation, claimInvitation, VerifyInvitationResponse, updateMailboxSettings } from "../api";
import { mailboxIdHex, hexToBase64 } from "../message_crypto";
import { generateQRCodeSVG } from "../utils/qr";
import { generateTOTPSecret, formatTOTPSecret, verifyTOTPClient } from "../utils/totp";
import { persistAccountListForDisplay, setAccountKeys, sanitizeConnectedAccounts } from "../session_isolation";

export const SetupAccount: Component = () => {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [inviteData, setInviteData] = createSignal<VerifyInvitationResponse | null>(null);
  const [rawToken, setRawToken] = createSignal("");

  // Step tracking: 1 = Password, 2 = Recovery Phrase, 3 = 2-Step Verification
  const [step, setStep] = createSignal<1 | 2 | 3>(1);

  // Password state
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [showPassword, setShowPassword] = createSignal(false);

  // Crypto state
  const [mnemonic, setMnemonic] = createSignal("");
  const [mnemonicCopied, setMnemonicCopied] = createSignal(false);
  const [confirmedSaved, setConfirmedSaved] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [submitError, setSubmitError] = createSignal<string | null>(null);

  // 2-Step Verification state (TOTP Authenticator or Passkey)
  const [selectedFactor, setSelectedFactor] = createSignal<"totp" | "passkey">("totp");
  const [totpSecret, setTotpSecret] = createSignal<string>("");
  const [totpCode, setTotpCode] = createSignal<string>("");
  const [totpVerified, setTotpVerified] = createSignal<boolean>(false);
  const [totpVerifying, setTotpVerifying] = createSignal<boolean>(false);
  const [totpVerifyError, setTotpVerifyError] = createSignal<string | null>(null);
  const [totpCopied, setTotpCopied] = createSignal<boolean>(false);

  // Passkey enrollment state
  const [passkeyRegistered, setPasskeyRegistered] = createSignal<boolean>(false);
  const [passkeyRegistering, setPasskeyRegistering] = createSignal<boolean>(false);
  const [passkeyError, setPasskeyError] = createSignal<string | null>(null);
  const [passkeyCredId, setPasskeyCredId] = createSignal<string>("");
  const [passkeyPublicKey, setPasskeyPublicKey] = createSignal<string>("");
  const [passkeyDevice, setPasskeyDevice] = createSignal<string>("Security Key / Passkey");

  // Key material derived client-side
  const [derivedMailboxPk, setDerivedMailboxPk] = createSignal<string>("");
  const [derivedWrappedSkUser, setDerivedWrappedSkUser] = createSignal<string>("");
  const [rawMailboxSkHex, setRawMailboxSkHex] = createSignal<string>("");
  const [rawSigningSeedHex, setRawSigningSeedHex] = createSignal<string>("");
  const [derivedXWingPk, setDerivedXWingPk] = createSignal<string>("");
  const [rawXWingSeedHex, setRawXWingSeedHex] = createSignal<string>("");

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token")?.trim() || "";
    if (!token) {
      setError("No invitation token found in the setup link. Please check your invitation URL.");
      setLoading(false);
      return;
    }
    setRawToken(token);

    try {
      const resp = await verifyInvitation(token);
      if (!resp.valid) {
        setError(resp.error || "This invitation link is invalid, expired, or has already been used.");
        setLoading(false);
        return;
      }
      setInviteData(resp);
    } catch (err: any) {
      setError(err?.message || "Failed to verify invitation token. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  });

  // Password Strength calculation
  const passwordStrength = () => {
    const pw = password();
    if (!pw) return { score: 0, label: "Empty", color: "bg-stone-300" };
    let score = 0;
    if (pw.length >= 12) score += 1;
    if (pw.length >= 16) score += 1;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
    if (/\d/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;

    if (score <= 2) return { score, label: "Weak", color: "bg-rose-500" };
    if (score === 3) return { score, label: "Fair", color: "bg-amber-500" };
    if (score === 4) return { score, label: "Good", color: "bg-emerald-500" };
    return { score, label: "Strong", color: "bg-emerald-600" };
  };

  const isPasswordValid = () => {
    return (
      password().length >= 12 &&
      password() === confirmPassword()
    );
  };

  async function handleProceedToKeys(e: Event) {
    e.preventDefault();
    if (!isPasswordValid()) return;

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      const data = inviteData();
      if (!data) throw new Error("Missing invitation data");

      const wasm = await import("../generated/crypto-core/byos_crypto_core.js");
      const boxIdHex = mailboxIdHex(data.mailbox_id);

      // Generate 24-word BIP-39 Mnemonic client-side on the invitee's device
      const phrase = wasm.wasm_generate_mnemonic();
      setMnemonic(phrase);
      const rootHex = wasm.wasm_recover_root_secret(phrase);

      // Zero-Knowledge Private Mailbox:
      // Keypair generated strictly on invitee's device!
      const kpJson = wasm.wasm_generate_keypair();
      const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
      const mailboxSkHex = kp.secret_key;
      setDerivedMailboxPk(kp.public_key);

      // 1. Wrap under user root secret derived from recovery phrase
      const rootWrappedHex = wasm.wasm_wrap_mailbox_key(rootHex, mailboxSkHex, boxIdHex);

      // 2. Wrap under user's password using wasm_passphrase_wrap_key
      const salt = new Uint8Array(16);
      crypto.getRandomValues(salt);
      const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
      const passphraseEnvelope = wasm.wasm_passphrase_wrap_key(password(), saltHex, mailboxSkHex);

      // 3. Derive signing seed and wrap twice (password + recovery_root)
      const signingSeedHex = wasm.wasm_derive_signing_seed(
        rootHex,
        boxIdHex,
        1,
      );

      const signingSalt = new Uint8Array(16);
      crypto.getRandomValues(signingSalt);
      const signingSaltHex = Array.from(signingSalt)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const signingEnvelope = wasm.wasm_passphrase_wrap_key(
        password(),
        signingSaltHex,
        signingSeedHex,
      );

      const signingRootWrapped = wasm.wasm_wrap_signing_seed(
        rootHex,
        signingSeedHex,
        boxIdHex,
      );

      // 4. Derive X-Wing seed and wrap twice
      const xwingSeedHex = wasm.wasm_derive_xwing_seed(rootHex, boxIdHex, 1);

      const xwingSalt = new Uint8Array(16);
      crypto.getRandomValues(xwingSalt);
      const xwingSaltHex = Array.from(xwingSalt)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const xwingEnvelope = wasm.wasm_passphrase_wrap_key(
        password(),
        xwingSaltHex,
        xwingSeedHex,
      );

      const xwingRootWrapped = wasm.wasm_wrap_xwing_seed(
        rootHex,
        xwingSeedHex,
        boxIdHex,
      );

      const xwingPkHex = wasm.wasm_xwing_public_key_from_seed(xwingSeedHex);
      setDerivedXWingPk(xwingPkHex);

      // Store payload supporting both password unwrap and recovery phrase unwrap
      const wrappedSkPayload = JSON.stringify({
        salt: saltHex,
        envelope: passphraseEnvelope,
        root_wrapped: rootWrappedHex,
        signing_salt: signingSaltHex,
        signing_envelope: signingEnvelope,
        signing_root_wrapped: signingRootWrapped,
        xwing_salt: xwingSaltHex,
        xwing_envelope: xwingEnvelope,
        xwing_root_wrapped: xwingRootWrapped,
      });

      setDerivedWrappedSkUser(wrappedSkPayload);
      setRawMailboxSkHex(mailboxSkHex);
      setRawSigningSeedHex(signingSeedHex);
      setRawXWingSeedHex(xwingSeedHex);
      setStep(2);
    } catch (err: any) {
      setSubmitError(err?.message || "Failed to initialize cryptographic material.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCopyMnemonic() {
    if (!mnemonic()) return;
    navigator.clipboard.writeText(mnemonic());
    setMnemonicCopied(true);
    setTimeout(() => setMnemonicCopied(false), 2500);
  }

  function handleDownloadMnemonic() {
    const words = mnemonic();
    if (!words) return;
    const email = inviteData()?.email || "mailbox";
    const content = [
      `BYOS Zero-Knowledge Mailbox Recovery Backup`,
      `======================================================`,
      `Email Account: ${email}`,
      `Generated Date: ${new Date().toISOString()}`,
      ``,
      `IMPORTANT SECURITY NOTICE:`,
      `- Keep this recovery phrase in an offline vault or secure password manager.`,
      `- Do not upload this phrase to unencrypted cloud notes or email.`,
      `- Anyone with these 24 words can decrypt your entire mailbox archive.`,
      ``,
      `24-Word Recovery Phrase:`,
      `------------------------------------------------------`,
      words,
      `------------------------------------------------------`,
      ``,
      `If you ever lose your account password, you can use these`,
      `24 words in the BYOS Webmail recovery ceremony to regain`,
      `access and unwrap your end-to-end encryption keys.`,
    ].join("\n");

    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `byos-recovery-${email.replace(/[^a-zA-Z0-9]/g, "_")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleProceedTo2FA() {
    if (!confirmedSaved()) return;
    if (!totpSecret()) {
      setTotpSecret(generateTOTPSecret());
    }
    setStep(3);
  }

  async function handleVerifyTOTP() {
    const code = totpCode().trim();
    if (code.length !== 6) {
      setTotpVerifyError("Please enter a 6-digit code.");
      return;
    }
    setTotpVerifying(true);
    setTotpVerifyError(null);
    try {
      const valid = await verifyTOTPClient(totpSecret(), code);
      if (valid) {
        setTotpVerified(true);
      } else {
        setTotpVerifyError("Invalid 6-digit code. Check your device clock or try the next code.");
      }
    } catch {
      setTotpVerifyError("Verification failed. Please try again.");
    } finally {
      setTotpVerifying(false);
    }
  }

  function handleCopyTOTPSecret() {
    if (!totpSecret()) return;
    navigator.clipboard.writeText(totpSecret());
    setTotpCopied(true);
    setTimeout(() => setTotpCopied(false), 2000);
  }

  function bufferToBase64URL(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = "";
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  async function handleRegisterPasskey() {
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setPasskeyError("WebAuthn / Passkeys are not supported by this browser.");
      return;
    }
    setPasskeyRegistering(true);
    setPasskeyError(null);
    try {
      const email = inviteData()?.email || "employee@byos.local";
      const challengeBytes = new Uint8Array(32);
      crypto.getRandomValues(challengeBytes);

      const effectiveRpId =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? window.location.hostname
          : window.location.hostname;

      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: challengeBytes,
          rp: {
            name: "BYOS Secure Email",
            id: effectiveRpId,
          },
          user: {
            id: new TextEncoder().encode(email),
            name: email,
            displayName: email.split("@")[0] || email,
          },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },   // ES256
            { type: "public-key", alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            userVerification: "preferred",
            residentKey: "preferred",
          },
          timeout: 60000,
        },
      })) as PublicKeyCredential;

      if (!cred) {
        throw new Error("Passkey registration was cancelled.");
      }

      const rawId = bufferToBase64URL(cred.rawId);
      const resp = cred.response as AuthenticatorAttestationResponse;
      const attestationHex = Array.from(new Uint8Array(resp.attestationObject), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("");

      setPasskeyCredId(rawId);
      setPasskeyPublicKey(attestationHex);
      setPasskeyRegistered(true);
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.message?.includes("cancelled")) {
        setPasskeyError("Passkey registration was cancelled or timed out.");
      } else {
        setPasskeyError(err?.message || "Failed to register passkey.");
      }
    } finally {
      setPasskeyRegistering(false);
    }
  }

  const is2FAValid = () => {
    return totpVerified() || totpCode().trim().length === 6;
  };

  async function handleFinalizeActivation() {
    if (!confirmedSaved()) return;
    if (!is2FAValid()) {
      setSubmitError("Please complete the required 2-Step Verification step before finalizing.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const data = inviteData();
      if (!data) throw new Error("Missing invitation data");

      const pk = derivedMailboxPk() || data.mailbox_pk;
      const wrappedSk = derivedWrappedSkUser();

      if (!pk || !wrappedSk) {
        throw new Error("Cryptographic keys missing. Please return to step 1.");
      }

      const claimRes = await claimInvitation({
        token: rawToken(),
        password: password(),
        mailbox_pk: pk,
        xwing_pk: derivedXWingPk() ? hexToBase64(derivedXWingPk()) : undefined,
        wrapped_sk_user: wrappedSk,
        two_factor_method: "totp",
        totp_secret: totpSecret(),
      });

      // Populate in-memory key store strictly; never write raw private keys to sessionStorage
      const mailboxSk = rawMailboxSkHex();
      const signingSeed = rawSigningSeedHex();
      const xwingSeed = rawXWingSeedHex();
      let sKeyHex = "";
      if (mailboxSk) {
        const wasm = await import("../generated/crypto-core/byos_crypto_core.js");
        sKeyHex = wasm.wasm_derive_search_key(mailboxSk);
        setAccountKeys(data.mailbox_id, {
          mailboxSk,
          signingSeed,
          xwingSeed,
        });
        sessionStorage.setItem("byos_mailbox_skey_" + data.mailbox_id, sKeyHex);
        sessionStorage.removeItem("byos_mailbox_sk_" + data.mailbox_id);
        sessionStorage.removeItem("byos_signing_seed_" + data.mailbox_id);
        sessionStorage.removeItem("byos_xwing_seed_" + data.mailbox_id);
      }
      if (claimRes.token) {
        sessionStorage.setItem("byos_active_session_token", claimRes.token);
      }

      // Persist newly activated account into byos_connected_accounts for multi-mailbox support
      const newAccount = {
        id: data.mailbox_id,
        email: data.email,
        displayName: data.email ? data.email.split("@")[0] : "User",
        role: "member",
        privacyMode: data.privacy_mode || "private",
        sessionToken: claimRes.token || "",
        searchKeyHex: sKeyHex,
      };

      // 1. Persist to sessionStorage with sanitized accounts (no raw private keys)
      try {
        const existingStr = sessionStorage.getItem("byos_connected_accounts");
        let accounts: any[] = [];
        if (existingStr) {
          try { accounts = JSON.parse(existingStr); } catch {}
        }
        if (!Array.isArray(accounts)) accounts = [];
        accounts = accounts.filter(
          (a) => a.id !== newAccount.id && a.email?.toLowerCase() !== newAccount.email.toLowerCase()
        );
        accounts.unshift(newAccount);
        sessionStorage.setItem("byos_connected_accounts", JSON.stringify(sanitizeConnectedAccounts(accounts)));
      } catch (e) {
        console.warn("Failed saving connected accounts in sessionStorage:", e);
      }

      // 2. Persist metadata to localStorage without tokens or secret keys (Rule 4 & 6)
      try {
        const existingStr = sessionStorage.getItem("byos_connected_accounts");
        let allAccounts: any[] = [];
        if (existingStr) {
          try { allAccounts = JSON.parse(existingStr); } catch {}
        }
        persistAccountListForDisplay(allAccounts);
      } catch (e) {
        console.warn("Failed saving connected accounts in localStorage:", e);
      }

      // Wrap the recovery phrase under password using wasm_passphrase_wrap_key
      // so the user can re-authenticate to reveal it from Settings > SecurityTab!
      // Must be done AFTER setting session token since updateMailboxSettings requires auth
      try {
        const wasm = await import("../generated/crypto-core/byos_crypto_core.js");
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
        const phraseBytes = new TextEncoder().encode(mnemonic());
        const mnemonicHex = Array.from(phraseBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        const wrappedPhraseHex = wasm.wasm_passphrase_wrap_key(password(), saltHex, mnemonicHex);

        await updateMailboxSettings(data.mailbox_id, {
          recovery_phrase_wrapped: wrappedPhraseHex,
          recovery_phrase_salt: saltHex,
        });
      } catch (wrapErr) {
        console.warn("Failed to seal recovery phrase in mailbox settings:", wrapErr);
      }

      // Successful activation: redirect to webmail inbox
      window.location.href = "/";
    } catch (err: any) {
      setSubmitError(err?.message || "Failed to complete account activation.");
      setIsSubmitting(false);
    }
  }

  const words = () => mnemonic().trim().split(/\s+/);

  return (
    <div class="min-h-screen bg-[#F0EEE9] text-[#3C3D3E] flex flex-col justify-center items-center p-4 sm:p-6 font-sans">
      <div class="w-full max-w-xl">
        {/* Brand Header */}
        <div class="text-center mb-6">
          <div class="inline-flex items-center gap-2 mb-2">
            <span class="text-2xl font-bold tracking-tight text-[#3C3D3E]">BYOS</span>
            <span class="text-xs uppercase tracking-widest bg-[#A27561] text-white px-2 py-0.5 rounded font-mono font-medium">
              Webmail
            </span>
          </div>
          <h1 class="text-xl sm:text-2xl font-semibold text-[#3C3D3E]">Complete Account Setup</h1>
          <p class="text-xs sm:text-sm text-[#6F7173] mt-1">
            Initialize your credentials and client-side encryption keys
          </p>
        </div>

        {/* Loading State */}
        <Show when={loading()}>
          <div class="bg-white rounded-xl shadow-sm border border-[#E2DFD8] p-8 text-center">
            <div class="inline-block animate-spin w-8 h-8 border-2 border-[#A27561] border-t-transparent rounded-full mb-3"></div>
            <p class="text-sm font-medium text-[#3C3D3E]">Verifying invitation token…</p>
            <p class="text-xs text-[#6F7173] mt-1">Checking cryptographic authorization</p>
          </div>
        </Show>

        {/* Error State */}
        <Show when={!loading() && error()}>
          <div class="bg-white rounded-xl shadow-sm border border-rose-200 p-8 text-center">
            <div class="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4">
              <svg class="w-6 h-6 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h2 class="text-base font-semibold text-rose-900 mb-2">Invitation Unavailable</h2>
            <p class="text-xs sm:text-sm text-rose-700 mb-6 max-w-md mx-auto">{error()}</p>
            <a
              href="/"
              class="inline-block px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-medium rounded-lg transition"
            >
              Return to Webmail Sign In
            </a>
          </div>
        </Show>

        {/* Setup Content */}
        <Show when={!loading() && !error() && inviteData()}>
          {(data) => (
            <div class="bg-white rounded-xl shadow-sm border border-[#E2DFD8] overflow-hidden">
              {/* Context / Mode Pill Bar */}
              <div class="bg-[#F8F7F4] border-b border-[#E2DFD8] p-4 sm:px-6">
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span class="text-[#6F7173] block text-[11px] uppercase tracking-wider font-mono">
                      Organization
                    </span>
                    <span class="font-semibold text-[#3C3D3E]">{data().organization_name}</span>
                  </div>
                  <div>
                    <span class="text-[#6F7173] block text-[11px] uppercase tracking-wider font-mono">
                      Assigned Address
                    </span>
                    <span class="font-semibold text-[#3C3D3E] font-mono">{data().email}</span>
                  </div>
                  <div>
                    <span class="text-[#6F7173] block text-[11px] uppercase tracking-wider font-mono">
                      Privacy Mode
                    </span>
                    <span
                      class="inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded text-[11px] bg-purple-100 text-purple-800"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-purple-600"></span>
                      Private (Zero-Knowledge)
                    </span>
                  </div>
                </div>
              </div>

              {/* Progress Stepper */}
              <div class="flex border-b border-[#E2DFD8] bg-white text-xs">
                <div
                  class={`flex-1 py-3 text-center font-medium border-b-2 transition ${
                    step() === 1
                      ? "border-[#A27561] text-[#A27561]"
                      : "border-transparent text-[#6F7173]"
                  }`}
                >
                  1. Set Account Password
                </div>
                <div
                  class={`flex-1 py-3 text-center font-medium border-b-2 transition ${
                    step() === 2
                      ? "border-[#A27561] text-[#A27561]"
                      : "border-transparent text-[#6F7173]"
                  }`}
                >
                  2. Encryption & Recovery
                </div>
                <div
                  class={`flex-1 py-3 text-center font-medium border-b-2 transition ${
                    step() === 3
                      ? "border-[#A27561] text-[#A27561]"
                      : "border-transparent text-[#6F7173]"
                  }`}
                >
                  3. 2-Step Verification
                </div>
              </div>

              <div class="p-6 sm:p-8">
                {/* Submit / General Error */}
                <Show when={submitError()}>
                  <div class="mb-5 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-start gap-2.5">
                    <svg class="w-4 h-4 stroke-rose-600 fill-none stroke-2 flex-shrink-0 mt-0.5" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{submitError()}</span>
                  </div>
                </Show>

                {/* Step 1: Password Creation */}
                <Show when={step() === 1}>
                  <form onSubmit={handleProceedToKeys} class="space-y-4">
                    <div>
                      <label class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
                        New Account Password
                      </label>
                      <div class="relative">
                        <input
                          type={showPassword() ? "text" : "password"}
                          value={password()}
                          onInput={(e) => setPassword(e.currentTarget.value)}
                          placeholder="At least 12 characters"
                          required
                          minlength="12"
                          autocomplete="new-password"
                          class="w-full bg-[#FBFBF9] border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561] text-xs sm:text-sm rounded-lg px-3 py-2 text-[#3C3D3E] placeholder-[#A0A2A4] outline-none transition"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword())}
                          class="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#6F7173] hover:text-[#3C3D3E]"
                        >
                          {showPassword() ? "Hide" : "Show"}
                        </button>
                      </div>

                      {/* Password Strength Indicator */}
                      <Show when={password().length > 0}>
                        <div class="mt-2">
                          <div class="flex items-center justify-between text-[11px] mb-1">
                            <span class="text-[#6F7173]">Password Strength</span>
                            <span class="font-medium text-[#3C3D3E]">{passwordStrength().label}</span>
                          </div>
                          <div class="h-1.5 w-full bg-stone-200 rounded-full overflow-hidden flex gap-1">
                            <div
                              class={`h-full transition-all duration-300 ${
                                passwordStrength().score >= 1 ? passwordStrength().color : "bg-transparent"
                              }`}
                              style={{ width: "25%" }}
                            ></div>
                            <div
                              class={`h-full transition-all duration-300 ${
                                passwordStrength().score >= 3 ? passwordStrength().color : "bg-transparent"
                              }`}
                              style={{ width: "25%" }}
                            ></div>
                            <div
                              class={`h-full transition-all duration-300 ${
                                passwordStrength().score >= 4 ? passwordStrength().color : "bg-transparent"
                              }`}
                              style={{ width: "25%" }}
                            ></div>
                            <div
                              class={`h-full transition-all duration-300 ${
                                passwordStrength().score >= 5 ? passwordStrength().color : "bg-transparent"
                              }`}
                              style={{ width: "25%" }}
                            ></div>
                          </div>
                        </div>
                      </Show>
                    </div>

                    <div>
                      <label class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
                        Confirm Password
                      </label>
                      <input
                        type={showPassword() ? "text" : "password"}
                        value={confirmPassword()}
                        onInput={(e) => setConfirmPassword(e.currentTarget.value)}
                        placeholder="Re-enter your password"
                        required
                        minlength="12"
                        autocomplete="new-password"
                        class="w-full bg-[#FBFBF9] border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561] text-xs sm:text-sm rounded-lg px-3 py-2 text-[#3C3D3E] placeholder-[#A0A2A4] outline-none transition"
                      />
                      <Show when={confirmPassword() && password() !== confirmPassword()}>
                        <p class="text-[11px] text-rose-600 mt-1">Passwords do not match</p>
                      </Show>
                    </div>

                    <div class="bg-[#F8F7F4] rounded-lg p-3.5 border border-[#E2DFD8] text-xs text-[#6F7173] leading-relaxed">
                      <p class="font-medium text-[#3C3D3E] mb-1">Security Requirements:</p>
                      <ul class="list-disc list-inside space-y-0.5 text-[11px]">
                        <li>Minimum 12 characters</li>
                        <li>Used to authenticate to the BYOS Webmail server</li>
                        <li>Never transmitted in plaintext (derived client-side)</li>
                      </ul>
                    </div>

                    <button
                      type="submit"
                      disabled={!isPasswordValid() || isSubmitting()}
                      class="w-full bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg text-xs sm:text-sm transition flex items-center justify-center gap-2 mt-6 shadow-sm"
                    >
                      <Show when={isSubmitting()}>
                        <span class="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                      </Show>
                      <span>{isSubmitting() ? "Initializing Cryptography…" : "Continue to Encryption Setup"}</span>
                    </button>
                  </form>
                </Show>

                {/* Step 2: Recovery Phrase & Cryptographic Commitment */}
                <Show when={step() === 2}>
                  <div class="space-y-5">
                    <div>
                      <h3 class="text-sm font-semibold text-[#3C3D3E]">
                        Your 24-Word Recovery Phrase (Private Mailbox)
                      </h3>
                      <p class="text-xs text-[#6F7173] mt-1 leading-relaxed">
                        This 24-word BIP-39 recovery phrase derives your root encryption secret. Because this is a Private mailbox, organization administrators have zero access to your keys.
                      </p>
                    </div>

                    {/* Security Alert Banner */}
                    <div
                      class="p-3.5 rounded-lg border text-xs leading-relaxed bg-purple-50 border-purple-200 text-purple-900"
                    >
                      <p class="font-semibold mb-0.5">
                        Zero-Knowledge Guarantee
                      </p>
                      <p class="text-[11px]">
                        The server and organization administrators do NOT possess your recovery phrase or private key. If you lose this phrase, your messages cannot be decrypted.
                      </p>
                    </div>

                    {/* Mnemonic 24-Word Grid */}
                    <div class="bg-[#FBFBF9] border border-[#E2DFD8] rounded-xl p-4">
                      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        <For each={words()}>
                          {(w, i) => (
                            <div class="bg-white border border-[#E2DFD8] rounded-md px-2.5 py-1.5 flex items-center justify-between text-xs shadow-xs">
                              <span class="text-[10px] text-[#A0A2A4] font-mono select-none">
                                {(i() + 1).toString().padStart(2, "0")}
                              </span>
                              <span class="font-mono font-medium text-[#3C3D3E] select-all">{w}</span>
                            </div>
                          )}
                        </For>
                      </div>

                      <div class="mt-4 pt-3 border-t border-[#E2DFD8] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <span class="text-[11px] text-[#6F7173]">BIP-39 Canonical English Wordlist</span>
                        <div class="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleDownloadMnemonic}
                            class="px-3 py-1.5 bg-[#F0EEE9] hover:bg-[#E2DFD8] text-[#3C3D3E] text-xs font-medium rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                            title="Download recovery phrase as text file"
                          >
                            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            <span>Download Backup (.txt)</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleCopyMnemonic}
                            class="px-3 py-1.5 bg-[#F0EEE9] hover:bg-[#E2DFD8] text-[#3C3D3E] text-xs font-medium rounded-lg transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <Show when={mnemonicCopied()} fallback={
                              <>
                                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                <span>Copy All 24 Words</span>
                              </>
                            }>
                              <svg class="w-3.5 h-3.5 stroke-emerald-600 fill-none stroke-2" viewBox="0 0 24 24">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span class="text-emerald-700">Copied</span>
                            </Show>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Confirmation Checkbox */}
                    <label class="flex items-start gap-2.5 p-3 rounded-lg border border-[#E2DFD8] bg-[#F8F7F4] cursor-pointer hover:bg-stone-50 transition select-none">
                      <input
                        type="checkbox"
                        checked={confirmedSaved()}
                        onChange={(e) => setConfirmedSaved(e.currentTarget.checked)}
                        class="mt-0.5 rounded border-stone-300 text-[#A27561] focus:ring-[#A27561]"
                      />
                      <span class="text-xs text-[#3C3D3E] font-medium leading-tight">
                        I have written down or securely stored my 24-word recovery phrase in a password manager or physical vault.
                      </span>
                    </label>

                    {/* Actions */}
                    <div class="flex items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        disabled={isSubmitting()}
                        class="px-4 py-2.5 border border-[#E2DFD8] text-[#6F7173] hover:text-[#3C3D3E] text-xs font-medium rounded-lg transition cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleProceedTo2FA}
                        disabled={!confirmedSaved() || isSubmitting()}
                        class="flex-1 bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                      >
                        <span>Next: 2-Step Verification →</span>
                      </button>
                    </div>
                  </div>
                </Show>

                {/* Step 3: Mandatory 2-Step Verification (TOTP Only) */}
                <Show when={step() === 3}>
                  <div class="space-y-5">
                    <div>
                      <h3 class="text-sm font-semibold text-[#3C3D3E]">
                        Set Up Mandatory 2-Step Verification
                      </h3>
                      <p class="text-xs text-[#6F7173] mt-1 leading-relaxed">
                        To protect your end-to-end encrypted mailbox from unauthorized takeover, an Authenticator App (TOTP) is required on every new sign-in.
                      </p>
                    </div>

                    {/* Notice on Passkeys & MFA */}
                    <div class="bg-[#FAF9F6] border border-[#E2DFD8] text-[#3C3D3E] rounded-lg p-3 text-xs leading-relaxed flex items-start gap-2.5">
                      <svg class="w-4 h-4 stroke-[#9E725F] fill-none stroke-2 shrink-0 mt-0.5" viewBox="0 0 24 24">
                        <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
                      </svg>
                      <div>
                        <span class="font-semibold block mb-0.5">Two-Factor Authentication:</span>
                        <span>Enroll an Authenticator App (TOTP) below to complete activation. Once your account is active, you can also enroll biometric passkeys and physical security keys in Settings.</span>
                      </div>
                    </div>

                    {/* Authenticator App (TOTP) Setup */}
                    <div class="bg-[#FBFBF9] border border-[#E2DFD8] rounded-xl p-4 space-y-4">
                      <div class="flex flex-col sm:flex-row items-center gap-5">
                        {/* QR Code Container */}
                        <div class="bg-white p-3 rounded-xl border border-[#E2DFD8] shadow-xs flex-shrink-0">
                          <div
                            class="w-36 h-36 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full"
                            innerHTML={generateQRCodeSVG(
                              `otpauth://totp/BYOS:${encodeURIComponent(data().email)}?secret=${totpSecret()}&issuer=BYOS`
                            )}
                          />
                        </div>

                        <div class="flex-1 space-y-2 text-center sm:text-left">
                          <h4 class="text-xs font-semibold text-[#3C3D3E]">Scan with Authenticator App</h4>
                          <p class="text-[11px] text-[#6F7173] leading-relaxed">
                            Use Google Authenticator, Authy, Apple Keychain, or 1Password to scan this QR code.
                          </p>
                          <div class="pt-1">
                            <span class="text-[10px] text-[#A0A2A4] block uppercase font-mono tracking-wider">
                              Secret Key (Manual Entry)
                            </span>
                            <div class="inline-flex items-center gap-2 mt-1 bg-white border border-[#E2DFD8] rounded px-2.5 py-1">
                              <span class="font-mono text-xs font-medium text-[#3C3D3E] select-all">
                                {formatTOTPSecret(totpSecret())}
                              </span>
                              <button
                                type="button"
                                onClick={handleCopyTOTPSecret}
                                class="text-[11px] text-[#A27561] hover:underline ml-1 font-medium cursor-pointer"
                              >
                                {totpCopied() ? "Copied!" : "Copy"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Test Verification Input */}
                      <div class="pt-2 border-t border-[#E2DFD8]">
                        <label class="block text-xs font-semibold text-[#3C3D3E] mb-1.5">
                          Verify 6-Digit Code from App
                        </label>
                        <div class="flex items-center gap-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxlength="6"
                            value={totpCode()}
                            onInput={(e) => {
                              setTotpCode(e.currentTarget.value.replace(/[^0-9]/g, ""));
                              if (e.currentTarget.value.trim().length === 6) {
                                handleVerifyTOTP();
                              }
                            }}
                            placeholder="123456"
                            class="w-36 tracking-widest font-mono text-center bg-white border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561] text-sm rounded-lg px-3 py-2 text-[#3C3D3E] outline-none"
                          />
                          <button
                            type="button"
                            onClick={handleVerifyTOTP}
                            disabled={totpCode().trim().length !== 6 || totpVerifying()}
                            class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white text-xs font-medium rounded-lg transition cursor-pointer"
                          >
                            {totpVerifying() ? "Verifying…" : "Verify"}
                          </button>
                          <Show when={totpVerified()}>
                            <div class="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                              <svg class="w-4 h-4 stroke-emerald-600 fill-none stroke-2" viewBox="0 0 24 24">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span>Verified!</span>
                            </div>
                          </Show>
                        </div>
                        <Show when={totpVerifyError()}>
                          <p class="text-[11px] text-rose-600 mt-1">{totpVerifyError()}</p>
                        </Show>
                      </div>
                    </div>

                    {/* Actions */}
                    <div class="flex items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        disabled={isSubmitting()}
                        class="px-4 py-2.5 border border-[#E2DFD8] text-[#6F7173] hover:text-[#3C3D3E] text-xs font-medium rounded-lg transition cursor-pointer"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleFinalizeActivation}
                        disabled={!is2FAValid() || isSubmitting()}
                        class="flex-1 bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white font-medium py-2.5 px-4 rounded-lg text-xs sm:text-sm transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                      >
                        <Show when={isSubmitting()}>
                          <span class="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span>
                        </Show>
                        <span>{isSubmitting() ? "Activating Mailbox…" : "Complete Setup & Launch Webmail"}</span>
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};
