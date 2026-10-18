import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import {
  UserPasskey,
  listPasskeys,
  fetchPasskeyRegisterOptions,
  registerPasskey,
  deletePasskey,
  TwoFactorStatus,
  TOTPSetupResponse,
  fetch2FAStatus,
  setupTOTP,
  verifyTOTP,
  disableTOTP,
  saveRecoveryMethods,
} from "../../lib/api/auth";
import { generateQRCodeSVG } from "../../utils/qr";

function base64URLToBuffer(base64URL: string): ArrayBuffer {
  const base64 = base64URL.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + "=".repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const SecurityPage: Component = () => {
  // Passkeys state
  const [passkeys, setPasskeys] = createSignal<UserPasskey[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = createSignal(true);
  const [addModalOpen, setAddModalOpen] = createSignal(false);
  const [deviceName, setDeviceName] = createSignal("");
  const [enrolling, setEnrolling] = createSignal(false);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);

  // 2FA state
  const [twoFactor, setTwoFactor] = createSignal<TwoFactorStatus | null>(null);
  const [loading2FA, setLoading2FA] = createSignal(true);

  // TOTP setup modal state
  const [totpModalOpen, setTotpModalOpen] = createSignal(false);
  const [totpSetupData, setTotpSetupData] = createSignal<TOTPSetupResponse | null>(null);
  const [totpCodeInput, setTotpCodeInput] = createSignal("");
  const [verifyingTOTP, setVerifyingTOTP] = createSignal(false);
  const [totpError, setTotpError] = createSignal<string | null>(null);

  // Disable 2FA modal state
  const [disableTotpModalOpen, setDisableTotpModalOpen] = createSignal(false);
  const [disableTotpPassword, setDisableTotpPassword] = createSignal("");
  const [disablingTotp, setDisablingTotp] = createSignal(false);
  const [disableTotpError, setDisableTotpError] = createSignal<string | null>(null);

  // Recovery email & phone state
  const [recoveryEmailInput, setRecoveryEmailInput] = createSignal("");
  const [recoveryPhoneInput, setRecoveryPhoneInput] = createSignal("");
  const [savingRecovery, setSavingRecovery] = createSignal(false);

  // Global notifications
  const [error, setError] = createSignal<string | null>(null);
  const [success, setSuccess] = createSignal<string | null>(null);

  function showSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }

  async function loadPasskeys() {
    setLoadingPasskeys(true);
    try {
      const list = await listPasskeys();
      setPasskeys(list);
    } catch (err) {
      console.warn("Failed to load passkeys:", err);
    } finally {
      setLoadingPasskeys(false);
    }
  }

  async function load2FA() {
    setLoading2FA(true);
    try {
      const status = await fetch2FAStatus();
      setTwoFactor(status);
      setRecoveryEmailInput(status.recovery_email || "");
      setRecoveryPhoneInput(status.recovery_phone || "");
    } catch (err) {
      console.warn("Failed to load 2FA status:", err);
    } finally {
      setLoading2FA(false);
    }
  }

  onMount(() => {
    loadPasskeys();
    load2FA();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (totpModalOpen()) setTotpModalOpen(false);
        if (disableTotpModalOpen()) setDisableTotpModalOpen(false);
        if (addModalOpen()) setAddModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // ── 2FA Handlers ──

  async function handleOpenTotpSetup() {
    setTotpError(null);
    setTotpCodeInput("");
    try {
      const data = await setupTOTP();
      setTotpSetupData(data);
      setTotpModalOpen(true);
    } catch (err: any) {
      setError(err?.message || "Failed to initiate TOTP setup.");
    }
  }

  async function handleVerifyTotp(e: Event) {
    e.preventDefault();
    if (!totpSetupData() || !totpCodeInput()) return;
    setVerifyingTOTP(true);
    setTotpError(null);
    try {
      const res = await verifyTOTP(totpSetupData()!.secret, totpCodeInput().trim());
      if (!res.valid) {
        throw new Error(res.error || "Invalid 6-digit verification code.");
      }
      setTotpModalOpen(false);
      setTwoFactor((prev) =>
        prev
          ? { ...prev, two_factor_enabled: true, has_totp: true }
          : {
              two_factor_enabled: true,
              has_totp: true,
              recovery_email: recoveryEmailInput(),
              recovery_phone: recoveryPhoneInput(),
            }
      );
      showSuccess("Authenticator App (2FA) successfully activated!");
    } catch (err: any) {
      setTotpError(err?.message || "Failed to verify authenticator code.");
    } finally {
      setVerifyingTOTP(false);
    }
  }

  async function handleDisableTotp(e: Event) {
    e.preventDefault();
    if (!disableTotpPassword()) return;
    setDisablingTotp(true);
    setDisableTotpError(null);
    try {
      const res = await disableTOTP(disableTotpPassword());
      if (!res.success) {
        throw new Error(res.error || "Failed to disable 2FA.");
      }
      setDisableTotpModalOpen(false);
      setDisableTotpPassword("");
      setTwoFactor((prev) => (prev ? { ...prev, two_factor_enabled: false, has_totp: false } : null));
      showSuccess("Two-factor authentication has been disabled.");
    } catch (err: any) {
      setDisableTotpError(err?.message || "Failed to disable 2FA.");
    } finally {
      setDisablingTotp(false);
    }
  }

  async function handleSaveRecoveryMethods(e: Event) {
    e.preventDefault();
    setSavingRecovery(true);
    setError(null);
    try {
      await saveRecoveryMethods(recoveryEmailInput().trim(), recoveryPhoneInput().trim());
      setTwoFactor((prev) =>
        prev
          ? {
              ...prev,
              recovery_email: recoveryEmailInput().trim(),
              recovery_phone: recoveryPhoneInput().trim(),
            }
          : null
      );
      showSuccess("Recovery verification contacts updated successfully.");
    } catch (err: any) {
      setError(err?.message || "Failed to save recovery methods.");
    } finally {
      setSavingRecovery(false);
    }
  }

  // ── Passkey Handlers ──

  async function handleEnrollPasskey(e: Event) {
    e.preventDefault();
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setError("WebAuthn / Passkeys are not supported by this browser.");
      return;
    }
    setEnrolling(true);
    setError(null);
    try {
      const opts = await fetchPasskeyRegisterOptions();

      const effectiveRpId =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? window.location.hostname
          : opts.rp?.id || window.location.hostname;

      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: base64URLToBuffer(opts.challenge),
          rp: {
            name: opts.rp?.name || "BYOS Control Panel",
            id: effectiveRpId,
          },
          user: {
            id: base64URLToBuffer(opts.user.id),
            name: opts.user.name,
            displayName: opts.user.displayName,
          },
          pubKeyCredParams: opts.pubKeyCredParams as any,
          authenticatorSelection: opts.authenticatorSelection as any,
          timeout: opts.timeout,
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

      await registerPasskey({
        credential_id: rawId,
        public_key: attestationHex,
        device_name: deviceName().trim() || "Touch ID / Windows Hello",
        challenge_token: opts.challenge,
      });

      setAddModalOpen(false);
      setDeviceName("");
      showSuccess("Passkey registered successfully! You can now log into Control Panel with 1-touch biometrics.");
      await loadPasskeys();
    } catch (err: any) {
      if (err?.name === "NotAllowedError" || err?.message?.includes("cancelled")) {
        setError("Passkey registration was cancelled or timed out.");
      } else {
        setError(err?.message || "Failed to enroll passkey.");
      }
    } finally {
      setEnrolling(false);
    }
  }

  async function handleDeletePasskey(id: string) {
    if (!confirm("Are you sure you want to revoke this passkey? You will not be able to use this device to sign in.")) {
      return;
    }
    setDeletingId(id);
    try {
      await deletePasskey(id);
      showSuccess("Passkey revoked.");
      await loadPasskeys();
    } catch (err: any) {
      setError(err?.message || "Failed to revoke passkey.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <a href="/dashboard/settings" class="text-xs font-semibold text-[#9E725F] hover:underline">
              ← Settings
            </a>
          </div>
          <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
            Security & Authentication Governance
          </h1>
          <p class="mt-1 text-sm text-[#6F7173]">
            Configure multi-factor authentication, trusted hardware keys, and account recovery options.
          </p>
        </div>
      </div>

      {/* Notifications */}
      <Show when={error()}>
        <div role="alert" class="rounded-xl bg-red-50 border border-red-200 p-4 text-xs text-red-800 flex items-center justify-between">
          <span>{error()}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error" class="text-red-500 hover:text-red-700 font-bold ml-2 cursor-pointer">✕</button>
        </div>
      </Show>
      <Show when={success()}>
        <div role="status" class="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-800 flex items-center justify-between">
          <span>{success()}</span>
          <button onClick={() => setSuccess(null)} aria-label="Dismiss success message" class="text-emerald-500 hover:text-emerald-700 font-bold ml-2 cursor-pointer">✕</button>
        </div>
      </Show>

      {/* ── SECTION 1: TWO-FACTOR AUTHENTICATION ── */}
      <div id="2fa-section" class="rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs">
        <div class="border-b border-[#E2DFD8] bg-[#FAF8F5] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 class="text-sm font-bold text-[#3C3D3E]">Two-Factor Authentication (2FA)</h2>
            <p class="text-xs text-[#6F7173]">
              Require a 6-digit verification code from your authenticator app in addition to your password.
            </p>
          </div>
          <Show
            when={!loading2FA()}
            fallback={<span class="text-xs text-[#6F7173]">Loading 2FA status…</span>}
          >
            <span
              data-testid="2fa-status-badge"
              class={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                twoFactor()?.two_factor_enabled
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              <span
                class={`w-2 h-2 rounded-full ${
                  twoFactor()?.two_factor_enabled ? "bg-emerald-500" : "bg-amber-500"
                }`}
              />
              <span>{twoFactor()?.two_factor_enabled ? "2FA Active" : "2FA Inactive"}</span>
            </span>
          </Show>
        </div>

        <div class="p-6 space-y-6">
          {/* Authenticator App (TOTP) Card */}
          <div class="p-4 rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div class="flex items-start sm:items-center gap-3.5">
              <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-[#3C3D3E]">Authenticator App (TOTP)</span>
                  <Show when={twoFactor()?.has_totp}>
                    <span class="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-800">
                      Configured
                    </span>
                  </Show>
                </div>
                <p class="text-xs text-[#6F7173] mt-0.5 max-w-md">
                  Scan a QR code with Google Authenticator, Microsoft Authenticator, Authy, or 1Password for time-based one-time codes.
                </p>
              </div>
            </div>

            <Show
              when={twoFactor()?.two_factor_enabled}
              fallback={
                <button
                  type="button"
                  data-testid="setup-totp-btn"
                  onClick={handleOpenTotpSetup}
                  class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors cursor-pointer self-start sm:self-auto shrink-0 focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30"
                >
                  Set Up Authenticator
                </button>
              }
            >
              <button
                type="button"
                data-testid="disable-totp-btn"
                onClick={() => {
                  setDisableTotpError(null);
                  setDisableTotpPassword("");
                  setDisableTotpModalOpen(true);
                }}
                class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-300 text-red-700 hover:bg-red-50 px-4 py-2 text-xs font-semibold transition-colors cursor-pointer self-start sm:self-auto shrink-0 focus:outline-none focus:ring-2 focus:ring-red-500/20"
              >
                Disable 2FA
              </button>
            </Show>
          </div>

          {/* Recovery Verification Contacts Form */}
          <form onSubmit={handleSaveRecoveryMethods} class="space-y-4 pt-2 border-t border-[#E2DFD8]">
            <div>
              <h3 class="text-xs font-bold text-[#3C3D3E]">Recovery Verification Contacts</h3>
              <p class="text-[11px] text-[#6F7173] mt-0.5">
                Used to deliver security verification codes if you lose access to your primary authenticator app.
              </p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                  Recovery Email Address
                </label>
                <input
                  type="email"
                  placeholder="backup@example.com"
                  value={recoveryEmailInput()}
                  onInput={(e) => setRecoveryEmailInput(e.currentTarget.value)}
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2 text-xs text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                  Recovery Phone (SMS)
                </label>
                <input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={recoveryPhoneInput()}
                  onInput={(e) => setRecoveryPhoneInput(e.currentTarget.value)}
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3.5 py-2 text-xs text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                />
              </div>
            </div>

            <div class="flex justify-end pt-1">
              <button
                type="submit"
                disabled={savingRecovery()}
                class="rounded-xl border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F3ECE8] hover:border-[#9E725F] transition-colors cursor-pointer disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30"
              >
                {savingRecovery() ? "Saving Contacts…" : "Save Recovery Contacts"}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ── SECTION 2: HARDWARE & TRUSTED DEVICES (PASSKEYS) ── */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs">
        <div class="border-b border-[#E2DFD8] bg-[#FAF8F5] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 class="text-sm font-bold text-[#3C3D3E]">Hardware & Trusted Devices</h2>
            <p class="text-xs text-[#6F7173]">
              Manage FIDO2 / WebAuthn biometric sensors (Touch ID, Windows Hello) and physical security keys (YubiKey).
            </p>
          </div>
          <button
            onClick={() => {
              setError(null);
              setDeviceName("");
              setAddModalOpen(true);
            }}
            class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors self-start sm:self-auto shrink-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Register New Passkey
          </button>
        </div>

        <Show when={loadingPasskeys()}>
          <div class="p-8 text-center text-xs text-[#6F7173]">Loading authenticators…</div>
        </Show>

        <Show when={!loadingPasskeys() && passkeys().length === 0}>
          <div class="p-12 text-center">
            <div class="w-12 h-12 rounded-2xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center mx-auto mb-3">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
              </svg>
            </div>
            <p class="text-sm font-bold text-[#3C3D3E]">No passkeys registered yet</p>
            <p class="text-xs text-[#6F7173] max-w-sm mx-auto mt-1 mb-4">
              Add your laptop's fingerprint reader, face unlock, or a physical YubiKey for fast, phishing-resistant sign-in.
            </p>
            <button
              onClick={() => {
                setError(null);
                setDeviceName("");
                setAddModalOpen(true);
              }}
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#9E725F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#865E4D] transition-colors cursor-pointer"
            >
              Enroll this device
            </button>
          </div>
        </Show>

        <Show when={!loadingPasskeys() && passkeys().length > 0}>
          <div class="divide-y divide-[#E2DFD8]">
            <For each={passkeys()}>
              {(pk) => (
                <div class="p-5 flex items-center justify-between hover:bg-[#FAF8F5]/50 transition-colors">
                  <div class="flex items-center gap-3.5">
                    <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0">
                      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
                      </svg>
                    </div>
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-bold text-[#3C3D3E]">{pk.device_name || "Hardware Key"}</span>
                        <span class="text-[10px] font-mono text-[#6F7173] bg-[#E2DFD8]/50 px-1.5 py-0.5 rounded">
                          {pk.credential_id.slice(0, 10)}…
                        </span>
                      </div>
                      <div class="mt-0.5 flex items-center gap-3 text-xs text-[#6F7173]">
                        <span>Registered {new Date(pk.created_at).toLocaleDateString()}</span>
                        <span>•</span>
                        <span>
                          {pk.last_used_at
                            ? `Last used ${new Date(pk.last_used_at).toLocaleDateString()}`
                            : "Never used"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeletePasskey(pk.id)}
                    disabled={deletingId() === pk.id}
                    class="rounded-lg border border-[#E2DFD8] px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {deletingId() === pk.id ? "Revoking…" : "Revoke"}
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* ── MODAL: SET UP AUTHENTICATOR APP (TOTP) ── */}
      <Show when={totpModalOpen() && totpSetupData()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="totp-setup-title"
            class="bg-white rounded-2xl border border-[#E2DFD8] shadow-xl max-w-md w-full p-6 space-y-4"
          >
            <div class="flex items-center justify-between">
              <h3 id="totp-setup-title" class="text-sm font-bold text-[#3C3D3E]">
                Set Up Authenticator App
              </h3>
              <button
                type="button"
                aria-label="Close setup modal"
                onClick={() => setTotpModalOpen(false)}
                class="text-[#6F7173] hover:text-[#3C3D3E] p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div class="space-y-4 text-xs text-[#6F7173]">
              <p>
                1. Scan this QR code with your authenticator app (Google Authenticator, Authy, Microsoft Authenticator):
              </p>

              {/* QR Code SVG Display */}
              <div class="flex justify-center p-4 bg-white rounded-xl border border-[#E2DFD8] shadow-2xs">
                <div innerHTML={generateQRCodeSVG(totpSetupData()!.otpauth_url, 200)} />
              </div>

              {/* Manual Key Display */}
              <div class="p-3 bg-[#FAF9F6] rounded-xl border border-[#E2DFD8] text-center space-y-1">
                <span class="text-[10px] uppercase tracking-wider font-mono text-[#6F7173]">
                  Or enter secret key manually:
                </span>
                <div class="font-mono font-bold text-xs text-[#9E725F] select-all break-all tracking-wider">
                  {totpSetupData()!.secret}
                </div>
              </div>

              {/* Code Verification Form */}
              <form onSubmit={handleVerifyTotp} class="space-y-3 pt-1">
                <label class="block text-xs font-semibold text-[#3C3D3E]">
                  2. Enter the 6-digit code generated by your app:
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  placeholder="123456"
                  value={totpCodeInput()}
                  onInput={(e) => setTotpCodeInput(e.currentTarget.value.replace(/\D/g, ""))}
                  class="w-full px-4 py-2.5 rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] text-center font-mono font-bold text-base text-[#3C3D3E] tracking-widest focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30"
                  autofocus
                />

                <Show when={totpError()}>
                  <div role="alert" class="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
                    {totpError()}
                  </div>
                </Show>

                <div class="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setTotpModalOpen(false)}
                    class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs font-medium cursor-pointer hover:bg-[#FAF9F6]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    data-testid="activate-2fa-btn"
                    disabled={verifyingTOTP() || totpCodeInput().length !== 6}
                    class="px-5 py-2 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition disabled:opacity-50 cursor-pointer shadow-2xs"
                  >
                    {verifyingTOTP() ? "Activating…" : "Activate 2FA"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </Show>

      {/* ── MODAL: DISABLE 2FA ── */}
      <Show when={disableTotpModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="disable-2fa-title"
            class="bg-white rounded-2xl border border-[#E2DFD8] shadow-xl max-w-md w-full p-6 space-y-4"
          >
            <h3 id="disable-2fa-title" class="text-sm font-bold text-[#3C3D3E]">
              Disable Two-Factor Authentication
            </h3>
            <p class="text-xs text-[#6F7173]">
              To disable 2FA, please re-enter your account password for verification.
            </p>

            <Show when={disableTotpError()}>
              <div role="alert" class="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl">
                {disableTotpError()}
              </div>
            </Show>

            <form onSubmit={handleDisableTotp} class="space-y-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1.5">
                  Account Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter current password"
                  value={disableTotpPassword()}
                  onInput={(e) => setDisableTotpPassword(e.currentTarget.value)}
                  class="w-full px-3.5 py-2 rounded-xl border border-[#E2DFD8] bg-[#FAF9F6] text-xs text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30"
                  autofocus
                />
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDisableTotpModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs font-medium cursor-pointer hover:bg-[#FAF9F6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="confirm-disable-2fa-btn"
                  disabled={disablingTotp() || !disableTotpPassword().trim()}
                  class="px-5 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition cursor-pointer disabled:opacity-50"
                >
                  {disablingTotp() ? "Disabling…" : "Confirm & Disable 2FA"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* ── MODAL: ENROLL PASSKEY ── */}
      <Show when={addModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="passkey-enroll-title"
            class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E2DFD8]"
          >
            <h3 id="passkey-enroll-title" class="text-lg font-bold text-[#3C3D3E]">
              Enroll Passkey / Biometric Authenticator
            </h3>
            <p class="mt-1 text-xs text-[#6F7173]">
              Your browser will prompt you to authenticate via Touch ID, Windows Hello, Face ID, or a FIDO2 hardware token.
            </p>

            <Show when={error()}>
              <div role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-800 border border-red-200">
                {error()}
              </div>
            </Show>

            <form onSubmit={handleEnrollPasskey} class="mt-5 space-y-4">
              <div>
                <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                  Device / Authenticator Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Work MacBook Pro, Office YubiKey"
                  value={deviceName()}
                  onInput={(e) => setDeviceName(e.currentTarget.value)}
                  class="block w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm text-[#3C3D3E] placeholder-[#6F7173]/50 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                  autofocus
                />
              </div>

              <div class="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={enrolling()}
                  onClick={() => setAddModalOpen(false)}
                  class="rounded-lg border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#6F7173] hover:bg-[#F3ECE8] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={enrolling()}
                  class="inline-flex items-center gap-1.5 rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 00.528 2.86" />
                  </svg>
                  {enrolling() ? "Touch your sensor…" : "Trigger Biometric Sensor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SecurityPage;
