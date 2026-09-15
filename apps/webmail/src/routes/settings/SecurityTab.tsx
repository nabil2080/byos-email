import { Component, createSignal, onMount, For, Show } from "solid-js";
import {
  Mailbox,
  UserMe,
  MailboxSettings,
  SessionItem,
  TwoFactorStatus,
  TOTPSetupResponse,
  UserPasskey,
  fetchMailboxSettings,
  fetchActiveSessions,
  revokeOtherSessions,
  verifyAccountPassword,
  fetch2FAStatus,
  setupTOTP,
  verifyTOTP,
  disableTOTP,
  saveRecoveryMethods,
  changeAccountPassword,
  fetchPasskeyRegisterOptions,
  registerPasskey,
  listPasskeys,
  deletePasskey,
  reactivateHistoricalKeys,
} from "../../api";
import {
  unwrapMailboxKeyWithRecoveryPhrase,
  autoUnwrapMailboxKey,
  wrapMailboxKeyWithPassphrase,
} from "../../message_crypto";
import { generateQRCodeSVG } from "../../utils/qr";

interface SecurityTabProps {
  mailbox: Mailbox;
  currentUser: UserMe | null;
}

export const SecurityTab: Component<SecurityTabProps> = (props) => {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [successMsg, setSuccessMsg] = createSignal<string | null>(null);
  const [settings, setSettings] = createSignal<MailboxSettings | null>(null);
  const [sessions, setSessions] = createSignal<SessionItem[]>([]);
  const [twoFactor, setTwoFactor] = createSignal<TwoFactorStatus | null>(null);

  // Password change form state
  const [changePasswordModalOpen, setChangePasswordModalOpen] = createSignal(false);
  const [currentPasswordInput, setCurrentPasswordInput] = createSignal("");
  const [newPasswordInput, setNewPasswordInput] = createSignal("");
  const [confirmPasswordInput, setConfirmPasswordInput] = createSignal("");
  const [changingPassword, setChangingPassword] = createSignal(false);
  const [changePasswordError, setChangePasswordError] = createSignal<string | null>(null);

  // 2FA Setup state
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

  // Key Export state
  const [exportPublicKeyModalOpen, setExportPublicKeyModalOpen] = createSignal(false);
  const [exportPrivateKeyModalOpen, setExportPrivateKeyModalOpen] = createSignal(false);
  const [exportPasswordInput, setExportPasswordInput] = createSignal("");
  const [exportingPrivateKey, setExportingPrivateKey] = createSignal(false);
  const [exportPrivateKeyError, setExportPrivateKeyError] = createSignal<string | null>(null);
  const [unwrappedPrivateKey, setUnwrappedPrivateKey] = createSignal<string | null>(null);
  const [copiedKey, setCopiedKey] = createSignal(false);

  // Recovery phrase reveal modal
  const [revealModalOpen, setRevealModalOpen] = createSignal(false);
  const [verifyPasswordInput, setVerifyPasswordInput] = createSignal("");
  const [verifying, setVerifying] = createSignal(false);
  const [verifyError, setVerifyError] = createSignal<string | null>(null);
  const [revealedPhrase, setRevealedPhrase] = createSignal<string | null>(null);
  const [copiedPhrase, setCopiedPhrase] = createSignal(false);

  // WebAuthn Passkeys State
  const [passkeys, setPasskeys] = createSignal<UserPasskey[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = createSignal(false);
  const [addPasskeyModalOpen, setAddPasskeyModalOpen] = createSignal(false);
  const [newPasskeyName, setNewPasskeyName] = createSignal("");
  const [addingPasskey, setAddingPasskey] = createSignal(false);
  const [passkeyError, setPasskeyError] = createSignal<string | null>(null);
  const [deletingPasskeyId, setDeletingPasskeyId] = createSignal<string | null>(null);

  // Historical Key Reactivation State (Proton Tier 2)
  const [reactivateModalOpen, setReactivateModalOpen] = createSignal(false);
  const [reactivateSecretInput, setReactivateSecretInput] = createSignal("");
  const [newPassForReactivate, setNewPassForReactivate] = createSignal("");
  const [reactivating, setReactivating] = createSignal(false);
  const [reactivateError, setReactivateError] = createSignal<string | null>(null);

  function base64URLToBuffer(base64URL: string): ArrayBuffer {
    const base64 = base64URL.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
    const raw = atob(base64 + pad);
    const buffer = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      buffer[i] = raw.charCodeAt(i);
    }
    return buffer.buffer as ArrayBuffer;
  }

  function bufferToBase64URL(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = "";
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  async function loadPasskeys() {
    try {
      setLoadingPasskeys(true);
      const list = await listPasskeys();
      setPasskeys(list);
    } catch {
      // Non-critical
    } finally {
      setLoadingPasskeys(false);
    }
  }

  async function handleEnrollPasskey(e: Event) {
    e.preventDefault();
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setPasskeyError("WebAuthn / Passkeys are not supported by this browser.");
      return;
    }
    setAddingPasskey(true);
    setPasskeyError(null);
    try {
      const opts = await fetchPasskeyRegisterOptions();
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: base64URLToBuffer(opts.challenge),
          rp: opts.rp,
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
        device_name: newPasskeyName().trim() || "Touch ID / Windows Hello",
        challenge_token: opts.challenge,
      });

      // Store device-bound mailbox key in local vault for 1-touch automatic unlock
      if (typeof window !== "undefined") {
        const skHex = sessionStorage.getItem("byos_mailbox_sk_" + props.mailbox.id);
        const sKeyHex = sessionStorage.getItem("byos_mailbox_skey_" + props.mailbox.id);
        if (skHex) {
          localStorage.setItem(`byos_passkey_vault_${rawId}`, JSON.stringify({
            mailbox_id: props.mailbox.id,
            mailbox_sk_hex: skHex,
            search_key_hex: sKeyHex || "",
          }));
        }
      }

      setAddPasskeyModalOpen(false);
      setNewPasskeyName("");
      showSuccess("Passkey registered! You can now log in with 1-touch authentication.");
      await loadPasskeys();
    } catch (err: any) {
      setPasskeyError(err?.message || "Failed to enroll passkey.");
    } finally {
      setAddingPasskey(false);
    }
  }

  async function handleDeletePasskey(id: string) {
    if (!confirm("Are you sure you want to remove this passkey device?")) return;
    setDeletingPasskeyId(id);
    try {
      const target = passkeys().find((p) => p.id === id);
      if (target && typeof window !== "undefined") {
        localStorage.removeItem(`byos_passkey_vault_${target.credential_id}`);
      }
      await deletePasskey(id);
      showSuccess("Passkey removed.");
      await loadPasskeys();
    } catch (err: any) {
      setError(err?.message || "Failed to remove passkey.");
    } finally {
      setDeletingPasskeyId(null);
    }
  }

  async function handleReactivateKeys(e: Event) {
    e.preventDefault();
    const secret = reactivateSecretInput().trim();
    const currentPass = newPassForReactivate().trim();
    if (!secret || !currentPass) {
      setReactivateError("Please provide both the secret and your current login password.");
      return;
    }

    const prevWrapped = props.mailbox.previous_wrapped_sk_user || props.currentUser?.previous_wrapped_sk_user;
    if (!prevWrapped) {
      setReactivateError("No historical wrapped key material found.");
      return;
    }

    setReactivating(true);
    setReactivateError(null);
    try {
      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      let mailboxSk: Uint8Array | null = null;

      if (secret.split(/\s+/).length >= 12) {
        mailboxSk = unwrapMailboxKeyWithRecoveryPhrase(wasm, secret, props.mailbox.id, prevWrapped);
      } else {
        mailboxSk = autoUnwrapMailboxKey(wasm, secret, prevWrapped);
      }

      if (!mailboxSk || mailboxSk.length !== 32) {
        throw new Error("Unable to decrypt historical key with provided credentials.");
      }

      const newWrappedSk = wrapMailboxKeyWithPassphrase(wasm, currentPass, mailboxSk);
      await reactivateHistoricalKeys(props.mailbox.id, newWrappedSk);

      const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem("byos_mailbox_sk_" + props.mailbox.id, skHex);

      setReactivateModalOpen(false);
      setReactivateSecretInput("");
      setNewPassForReactivate("");
      showSuccess("Historical key material successfully reactivated! Old messages are unlocked.");
      await loadData();
    } catch (err: any) {
      setReactivateError(err?.message || "Failed to unlock historical key.");
    } finally {
      setReactivating(false);
    }
  }

  // Session revoking state
  const [revokingSessions, setRevokingSessions] = createSignal(false);

  async function loadData() {
    try {
      setLoading(true);
      const [s, sessList, tfa] = await Promise.all([
        fetchMailboxSettings(props.mailbox.id),
        fetchActiveSessions(),
        fetch2FAStatus().catch(() => null),
      ]);
      setSettings(s);
      setSessions(sessList);
      if (tfa) {
        setTwoFactor(tfa);
        setRecoveryEmailInput(tfa.recovery_email || "");
        setRecoveryPhoneInput(tfa.recovery_phone || "");
      }
      await loadPasskeys();
    } catch (err: any) {
      setError(err?.message || "Failed to load security settings.");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadData();
  });

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  async function handleRevokeOthers() {
    if (!confirm("Are you sure you want to sign out all other devices and browser sessions?")) {
      return;
    }
    setRevokingSessions(true);
    setError(null);
    try {
      const res = await revokeOtherSessions();
      showSuccess(`Successfully revoked ${res.revoked_count} active session(s).`);
      const updated = await fetchActiveSessions();
      setSessions(updated);
    } catch (err: any) {
      setError(err?.message || "Failed to revoke other sessions.");
    } finally {
      setRevokingSessions(false);
    }
  }

  // ── Password Change Handler ──
  async function handleChangePassword(e: Event) {
    e.preventDefault();
    setChangePasswordError(null);

    const curr = currentPasswordInput().trim();
    const next = newPasswordInput().trim();
    const conf = confirmPasswordInput().trim();

    if (!curr) {
      setChangePasswordError("Current password is required.");
      return;
    }
    if (next.length < 8) {
      setChangePasswordError("New password must be at least 8 characters long.");
      return;
    }
    if (next !== conf) {
      setChangePasswordError("New password and confirmation do not match.");
      return;
    }

    setChangingPassword(true);
    try {
      // 1. Verify current password
      const verifyRes = await verifyAccountPassword(curr);
      if (!verifyRes.valid) {
        throw new Error(verifyRes.error || "Current password is incorrect.");
      }

      // 2. Submit new password
      await changeAccountPassword(next);
      setChangePasswordModalOpen(false);
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      showSuccess("Account password successfully changed. Other active sessions were rotated.");
    } catch (err: any) {
      setChangePasswordError(err?.message || "Failed to change password.");
    } finally {
      setChangingPassword(false);
    }
  }

  // ── 2FA TOTP Setup ──
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
      setTwoFactor((prev) => (prev ? { ...prev, two_factor_enabled: true, has_totp: true } : null));
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

  // ── Recovery Methods Save ──
  async function handleSaveRecoveryMethods(e: Event) {
    e.preventDefault();
    setSavingRecovery(true);
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
      showSuccess("Recovery email & phone updated successfully.");
    } catch (err: any) {
      setError(err?.message || "Failed to save recovery methods.");
    } finally {
      setSavingRecovery(false);
    }
  }

  // ── Key Exports ──
  function getArmoredPublicKey(): string {
    const pk = props.mailbox.public_key || "";
    return [
      "-----BEGIN BYOS PUBLIC KEY BLOCK-----",
      "Version: BYOS V5.3 (HPKE/X25519 Zero-Knowledge)",
      `Comment: Mailbox <${props.mailbox.local_part}>`,
      `Fingerprint: ${props.mailbox.public_key ? props.mailbox.public_key.match(/.{1,4}/g)?.join(" ") : "none"}`,
      "",
      pk,
      "-----END BYOS PUBLIC KEY BLOCK-----",
    ].join("\n");
  }

  function handleDownloadPublicKey() {
    const text = getArmoredPublicKey();
    const blob = new Blob([text], { type: "application/pgp-keys" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.mailbox.local_part}_public.asc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleExportPrivateKey(e: Event) {
    e.preventDefault();
    if (!exportPasswordInput()) return;
    setExportingPrivateKey(true);
    setExportPrivateKeyError(null);

    try {
      const verifyRes = await verifyAccountPassword(exportPasswordInput());
      if (!verifyRes.valid) {
        throw new Error(verifyRes.error || "Incorrect password.");
      }

      // Check sessionStorage for cached secret key first
      let skHex = sessionStorage.getItem("byos_mailbox_sk_" + props.mailbox.id);

      // If not in session, unwrap from wrapped key via WASM
      if (!skHex) {
        const s = settings();
        if (s?.recovery_phrase_wrapped && s?.recovery_phrase_salt) {
          const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
          const unwrappedHex = wasm.wasm_passphrase_unwrap_key(
            exportPasswordInput(),
            s.recovery_phrase_salt,
            s.recovery_phrase_wrapped
          );
          skHex = unwrappedHex;
        }
      }

      if (!skHex) {
        throw new Error("Unable to locate or unseal the private key for this mailbox.");
      }

      setUnwrappedPrivateKey(skHex);
      setExportPasswordInput("");
    } catch (err: any) {
      setExportPrivateKeyError(err?.message || "Failed to decrypt private key.");
    } finally {
      setExportingPrivateKey(false);
    }
  }

  function getArmoredPrivateKey(): string {
    const sk = unwrappedPrivateKey() || "";
    return [
      "-----BEGIN BYOS PRIVATE KEY BLOCK-----",
      "Version: BYOS V5.3 (HPKE/X25519 Zero-Knowledge)",
      `Comment: Mailbox <${props.mailbox.local_part}>`,
      "WARNING: DO NOT SHARE THIS KEY WITH ANYONE. THIS SECRET DECRYPTS ALL YOUR MESSAGES.",
      "",
      sk,
      "-----END BYOS PRIVATE KEY BLOCK-----",
    ].join("\n");
  }

  function handleDownloadPrivateKey() {
    const text = getArmoredPrivateKey();
    const blob = new Blob([text], { type: "application/x-pem-file" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.mailbox.local_part}_private.key`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadRecoveryPhrase() {
    if (!revealedPhrase()) return;
    const text = [
      "BYOS Zero-Knowledge Mailbox Recovery Material",
      `Mailbox: ${props.mailbox.local_part}`,
      `Exported: ${new Date().toISOString()}`,
      "",
      "Keep this 24-word recovery phrase secure and strictly confidential.",
      "With these words, anyone can reconstruct your root encryption keys.",
      "",
      revealedPhrase(),
    ].join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.mailbox.local_part}_recovery_phrase.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function hexToString(hex: string): string {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
    return new TextDecoder().decode(bytes);
  }

  async function handleRevealPhrase(e: Event) {
    e.preventDefault();
    if (!verifyPasswordInput()) return;
    setVerifying(true);
    setVerifyError(null);

    try {
      const verifyRes = await verifyAccountPassword(verifyPasswordInput());
      if (!verifyRes.valid) {
        throw new Error(verifyRes.error || "Incorrect password");
      }

      const s = settings();
      if (!s?.recovery_phrase_wrapped || !s?.recovery_phrase_salt) {
        throw new Error("No wrapped recovery phrase found for this mailbox.");
      }

      const wasm = await import("../../generated/crypto-core/byos_crypto_core.js");
      const unwrappedHex = wasm.wasm_passphrase_unwrap_key(
        verifyPasswordInput(),
        s.recovery_phrase_salt,
        s.recovery_phrase_wrapped
      );

      const phrase = hexToString(unwrappedHex);
      setRevealedPhrase(phrase);
      setVerifyPasswordInput("");
    } catch (err: any) {
      setVerifyError(err?.message || "Failed to verify password or unseal recovery phrase.");
    } finally {
      setVerifying(false);
    }
  }

  function handleCopyPhrase() {
    if (!revealedPhrase()) return;
    navigator.clipboard.writeText(revealedPhrase()!);
    setCopiedPhrase(true);
    setTimeout(() => setCopiedPhrase(false), 2500);
  }

  const phraseWords = () => (revealedPhrase() ? revealedPhrase()!.trim().split(/\s+/) : []);

  const pkFingerprint = () => {
    const pk = props.mailbox.public_key;
    if (!pk) return "No public key registered";
    return pk.match(/.{1,4}/g)?.join(" ") || pk;
  };

  return (
    <div class="space-y-6 pb-12">
      <div>
        <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Security & Custody</h3>
        <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-1">
          Password authentication, two-factor verification, key exports, and active devices.
        </p>
      </div>

      <Show when={error()}>
        <div class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{error()}</span>
          <button onClick={() => setError(null)} class="text-rose-500 hover:text-rose-800 p-1 cursor-pointer">✕</button>
        </div>
      </Show>

      <Show when={successMsg()}>
        <div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <svg class="w-4 h-4 stroke-emerald-600 stroke-2 fill-none" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{successMsg()}</span>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-8 border border-[#E2DFD8] dark:border-[#2E3138] text-center">
          <div class="inline-block animate-spin w-6 h-6 border-2 border-[#A27561] border-t-transparent rounded-full mb-2"></div>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">Loading cryptographic security settings…</p>
        </div>
      </Show>

      <Show when={!loading()}>
        <div class="space-y-6">
          {/* 1. Account Password Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Account Password
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Change your account login password. Revokes other active browser sessions upon update.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setChangePasswordError(null);
                  setCurrentPasswordInput("");
                  setNewPasswordInput("");
                  setConfirmPasswordInput("");
                  setChangePasswordModalOpen(true);
                }}
                class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Change Password</span>
              </button>
            </div>
          </div>

          {/* 2. Two-Step Verification (2FA) Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-5">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Two-Step Verification (2FA)
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Protect your account with an Authenticator app (TOTP) and backup recovery contacts.
                </p>
              </div>
              <span
                class={`text-[11px] font-mono font-medium px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${
                  twoFactor()?.two_factor_enabled
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                    : "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                }`}
              >
                <span class={`w-1.5 h-1.5 rounded-full ${twoFactor()?.two_factor_enabled ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                <span>{twoFactor()?.two_factor_enabled ? "2FA Active" : "2FA Inactive"}</span>
              </span>
            </div>

            {/* Authenticator App Option */}
            <div class="p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] flex items-center justify-between">
              <div class="space-y-0.5">
                <div class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] flex items-center gap-2">
                  <span>Authenticator App (TOTP)</span>
                  <Show when={twoFactor()?.has_totp}>
                    <span class="text-[10px] font-mono px-2 py-0.2 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300">
                      Configured
                    </span>
                  </Show>
                </div>
                <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA]">
                  Scan a QR code with Google Authenticator, Authy, or Microsoft Authenticator for 6-digit one-time codes.
                </p>
              </div>

              <Show
                when={twoFactor()?.two_factor_enabled}
                fallback={
                  <button
                    type="button"
                    onClick={handleOpenTotpSetup}
                    class="px-3.5 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition cursor-pointer shadow-xs"
                  >
                    Set Up Authenticator
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    setDisableTotpError(null);
                    setDisableTotpPassword("");
                    setDisableTotpModalOpen(true);
                  }}
                  class="px-3.5 py-2 border border-rose-300 dark:border-rose-900 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold rounded-xl transition cursor-pointer"
                >
                  Disable 2FA
                </button>
              </Show>
            </div>

            {/* Recovery Email & Phone Form */}
            <form onSubmit={handleSaveRecoveryMethods} class="space-y-3 pt-1">
              <div class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                Recovery Verification Contacts
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA] mb-1">
                    Recovery Email Address
                  </label>
                  <input
                    type="email"
                    placeholder="backup@example.com"
                    value={recoveryEmailInput()}
                    onInput={(e) => setRecoveryEmailInput(e.currentTarget.value)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                  />
                </div>
                <div>
                  <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA] mb-1">
                    Recovery Phone (SMS)
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 (555) 000-0000"
                    value={recoveryPhoneInput()}
                    onInput={(e) => setRecoveryPhoneInput(e.currentTarget.value)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                  />
                </div>
              </div>
              <div class="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={savingRecovery()}
                  class="px-4 py-2 border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] rounded-xl hover:bg-[#F3ECE8] dark:hover:bg-[#252830] transition cursor-pointer disabled:opacity-50"
                >
                  {savingRecovery() ? "Saving Contacts…" : "Save Recovery Contacts"}
                </button>
              </div>
            </form>
          </div>

          {/* 3. Passkeys & Biometric Authentication Card (WebAuthn / FIDO2) */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Biometrics & Hardware Keys (Passkeys)
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Log in instantly with Touch ID, Face ID, Windows Hello, or FIDO2 security keys (YubiKey).
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPasskeyError(null);
                  setNewPasskeyName("");
                  setAddPasskeyModalOpen(true);
                }}
                class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z" />
                </svg>
                <span>+ Add Passkey</span>
              </button>
            </div>

            <Show when={passkeys().length === 0}>
              <div class="p-4 rounded-xl border border-dashed border-[#E2DFD8] dark:border-[#2E3138] text-center text-xs text-[#6E7075] dark:text-[#A1A1AA]">
                No passkeys registered yet. Add a biometric passkey or security key for 1-touch login.
              </div>
            </Show>

            <Show when={passkeys().length > 0}>
              <div class="divide-y divide-[#E2DFD8] dark:divide-[#2E3138] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden bg-[#F8F7F4] dark:bg-[#18191D]">
                <For each={passkeys()}>
                  {(pk) => (
                    <div class="p-3.5 flex items-center justify-between text-xs">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-center text-[#A27561]">
                          <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <path d="M12 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3z" />
                            <path d="M17 18v1a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-1c0-2.5 4-3.5 5-3.5s5 1 5 3.5z" />
                          </svg>
                        </div>
                        <div>
                          <div class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6] flex items-center gap-2">
                            <span>{pk.device_name}</span>
                            <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300">
                              Active
                            </span>
                          </div>
                          <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                            Added {new Date(pk.created_at).toLocaleDateString()} {pk.last_used_at ? `• Last used ${new Date(pk.last_used_at).toLocaleDateString()}` : ""}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleDeletePasskey(pk.id)}
                        disabled={deletingPasskeyId() === pk.id}
                        class="text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:underline px-2 py-1 cursor-pointer disabled:opacity-50"
                      >
                        {deletingPasskeyId() === pk.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* 4. Historical Key Decryption & Reactivation Card (Proton Tier 2) */}
          <Show when={props.mailbox.previous_wrapped_sk_user || props.currentUser?.previous_wrapped_sk_user}>
            <div class="rounded-2xl p-6 border-2 border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/30 shadow-xs space-y-3">
              <div class="flex items-start justify-between gap-4">
                <div class="flex items-start gap-3">
                  <div class="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/60 border border-amber-300 dark:border-amber-700 flex items-center justify-center shrink-0 text-amber-700 dark:text-amber-300 mt-0.5">
                    <svg class="w-5 h-5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <div>
                    <h4 class="text-xs font-bold text-amber-950 dark:text-amber-200 uppercase tracking-wider font-mono">
                      Historical Messages Locked
                    </h4>
                    <p class="text-xs text-amber-800 dark:text-amber-300 mt-0.5 leading-relaxed">
                      Your account password was reset using a recovery verification method. Following the Proton zero-knowledge privacy model, historical encrypted messages remain locked until you decrypt them with your 24-word recovery phrase or previous password.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setReactivateError(null);
                    setReactivateSecretInput("");
                    setNewPassForReactivate("");
                    setReactivateModalOpen(true);
                  }}
                  class="px-4 py-2 bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold rounded-xl transition shadow-xs whitespace-nowrap cursor-pointer"
                >
                  Reactivate Old Keys
                </button>
              </div>
            </div>
          </Show>

          {/* 5. Key Management & Export Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Email Encryption Keys & Export
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Export sovereign cryptographic keys for use in external mail clients, PGP software, or audit backups.
                </p>
              </div>
              <span
                class={`text-[11px] font-mono font-medium px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${
                  props.mailbox.mode === "private"
                    ? "bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border-purple-200 dark:border-purple-900/50"
                    : "bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-900/50"
                }`}
              >
                <span>{props.mailbox.mode === "private" ? "Private (Zero-Knowledge)" : "Organization-Managed"}</span>
              </span>
            </div>

            <div class="p-4 rounded-xl bg-[#F8F7F4] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] space-y-1.5">
              <div class="text-[11px] font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
                Mailbox Public Fingerprint
              </div>
              <div class="font-mono text-xs text-[#A27561] dark:text-[#D4A38F] break-all select-all font-semibold">
                {pkFingerprint()}
              </div>
            </div>

            <div class="flex flex-wrap gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setExportPublicKeyModalOpen(true)}
                class="px-4 py-2 border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] rounded-xl hover:bg-[#F3ECE8] dark:hover:bg-[#252830] transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Export Public Key (.asc)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setUnwrappedPrivateKey(null);
                  setExportPasswordInput("");
                  setExportPrivateKeyError(null);
                  setExportPrivateKeyModalOpen(true);
                }}
                class="px-4 py-2 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-semibold rounded-xl transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <span>Export Private Key (.key)</span>
              </button>
            </div>
          </div>

          {/* 4. Recovery Phrase Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Account Master Secret (24-Word Phrase)
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Your master root secret. Unlocks and derives your mailbox encryption keys across new devices.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setRevealedPhrase(null);
                  setVerifyPasswordInput("");
                  setVerifyError(null);
                  setRevealModalOpen(true);
                }}
                class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path d="m21 2-2 2m-1.5 1.5L16 7m-1.5 1.5L13 10m-1.5 1.5L10 13l-4 4-4-4 4-4 7.5-7.5" />
                  <circle cx="7.5" cy="16.5" r="1.5" />
                </svg>
                <span>Reveal & Export Phrase</span>
              </button>
            </div>
          </div>

          {/* 5. Active Sessions & Security Audit Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Active Webmail Sessions
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Audit logged-in devices and sign out other sessions.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRevokeOthers}
                disabled={revokingSessions() || sessions().filter((s) => !s.is_current).length === 0}
                class="px-4 py-2 border border-rose-300 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl text-xs font-semibold transition disabled:opacity-40 cursor-pointer"
              >
                {revokingSessions() ? "Revoking…" : "Revoke All Other Sessions"}
              </button>
            </div>

            <div class="divide-y divide-[#E2DFD8] dark:divide-[#2E3138] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden">
              <For each={sessions()}>
                {(sess) => (
                  <div class="p-4 flex items-center justify-between hover:bg-[#F8F7F4] dark:hover:bg-[#18191D] transition">
                    <div class="space-y-1">
                      <div class="flex items-center gap-2">
                        <span class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] font-mono">
                          {sess.ip_address || "127.0.0.1"}
                        </span>
                        <Show when={sess.is_current}>
                          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 font-mono">
                            CURRENT SESSION
                          </span>
                        </Show>
                      </div>
                      <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] truncate max-w-md font-sans">
                        {sess.user_agent || "Webmail Client"}
                      </div>
                      <div class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA] font-mono">
                        Started: {new Date(sess.created_at).toLocaleString()}
                        {sess.last_active_at && ` • Active: ${new Date(sess.last_active_at).toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* ── MODALS ── */}

      {/* 1. Change Password Modal */}
      <Show when={changePasswordModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-md w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6] flex items-center gap-2">
                <svg class="w-4 h-4 stroke-[#A27561] fill-none stroke-2" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>Change Password</span>
              </h3>
              <button
                onClick={() => setChangePasswordModalOpen(false)}
                class="text-[#6E7075] hover:text-[#1A1B1E] p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleChangePassword} class="space-y-3.5">
              <Show when={changePasswordError()}>
                <div class="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-700 dark:text-rose-300 text-xs rounded-xl">
                  {changePasswordError()}
                </div>
              </Show>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter current password"
                  value={currentPasswordInput()}
                  onInput={(e) => setCurrentPasswordInput(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  New Password (min 8 chars)
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter new password"
                  value={newPasswordInput()}
                  onInput={(e) => setNewPasswordInput(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Confirm new password"
                  value={confirmPasswordInput()}
                  onInput={(e) => setConfirmPasswordInput(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setChangePasswordModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs text-[#464748] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingPassword()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer"
                >
                  {changingPassword() ? "Changing Password…" : "Update Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* 2. TOTP Setup Modal with QR Code */}
      <Show when={totpModalOpen() && totpSetupData()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-md w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                Set Up Authenticator App
              </h3>
              <button onClick={() => setTotpModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <div class="space-y-4 text-xs text-[#6E7075] dark:text-[#A1A1AA]">
              <p>
                1. Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):
              </p>

              {/* QR Code SVG Display */}
              <div class="flex justify-center p-4 bg-white rounded-xl border border-[#E2DFD8] shadow-2xs">
                <div innerHTML={generateQRCodeSVG(totpSetupData()!.otpauth_url, 200)} />
              </div>

              <div class="p-2.5 bg-[#F8F7F4] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-center space-y-1">
                <span class="text-[10px] uppercase tracking-wider font-mono text-[#878A8E]">Or enter key manually:</span>
                <div class="font-mono font-bold text-xs text-[#A27561] select-all break-all">
                  {totpSetupData()!.secret}
                </div>
              </div>

              <form onSubmit={handleVerifyTotp} class="space-y-3 pt-1">
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
                  2. Enter the 6-digit code from your app:
                </label>
                <input
                  type="text"
                  maxlength="6"
                  required
                  placeholder="000000"
                  value={totpCodeInput()}
                  onInput={(e) => setTotpCodeInput(e.currentTarget.value.replace(/\D/g, ""))}
                  class="w-full px-4 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-center font-mono font-bold text-base text-[#1A1B1E] dark:text-[#F3F4F6] tracking-widest focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />

                <Show when={totpError()}>
                  <div class="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
                    {totpError()}
                  </div>
                </Show>

                <div class="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setTotpModalOpen(false)}
                    class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs font-medium cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={verifyingTOTP() || totpCodeInput().length !== 6}
                    class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer"
                  >
                    {verifyingTOTP() ? "Activating…" : "Activate 2FA"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </Show>

      {/* 3. Disable TOTP Modal */}
      <Show when={disableTotpModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
              Disable Two-Factor Authentication
            </h3>
            <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">
              To disable 2FA, please re-enter your account password.
            </p>

            <Show when={disableTotpError()}>
              <div class="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
                {disableTotpError()}
              </div>
            </Show>

            <form onSubmit={handleDisableTotp} class="space-y-3">
              <input
                type="password"
                required
                placeholder="Account password"
                value={disableTotpPassword()}
                onInput={(e) => setDisableTotpPassword(e.currentTarget.value)}
                class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
              />

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDisableTotpModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={disablingTotp()}
                  class="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 cursor-pointer"
                >
                  {disablingTotp() ? "Disabling…" : "Confirm & Disable 2FA"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* 4. Export Public Key Modal */}
      <Show when={exportPublicKeyModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-lg w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                Export Public Encryption Key
              </h3>
              <button onClick={() => setExportPublicKeyModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">
              Your public key can be safely shared with anyone so they can encrypt messages addressed to you.
            </p>

            <textarea
              readonly
              rows={8}
              class="w-full p-3 font-mono text-xs rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-[#1A1B1E] dark:text-[#F3F4F6] select-all"
              value={getArmoredPublicKey()}
            />

            <div class="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(getArmoredPublicKey());
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2500);
                }}
                class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs font-medium cursor-pointer"
              >
                {copiedKey() ? "Copied!" : "Copy to Clipboard"}
              </button>
              <button
                type="button"
                onClick={handleDownloadPublicKey}
                class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] cursor-pointer"
              >
                Download (.asc)
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 5. Export Private Key Modal (Password Gated) */}
      <Show when={exportPrivateKeyModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-lg w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6] flex items-center gap-2">
                <span class="text-amber-600">⚠️</span>
                <span>Export Sovereign Private Key</span>
              </h3>
              <button onClick={() => setExportPrivateKeyModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <Show when={!unwrappedPrivateKey()}>
              <form onSubmit={handleExportPrivateKey} class="space-y-4">
                <div class="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200 text-xs">
                  <span class="font-bold block mb-1">Strict Confidentiality Warning:</span>
                  Never share your private key or store it unencrypted. Anyone with this key can decrypt all past and future sovereign messages sent to this mailbox.
                </div>

                <Show when={exportPrivateKeyError()}>
                  <div class="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
                    {exportPrivateKeyError()}
                  </div>
                </Show>

                <div>
                  <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                    Re-Enter Account Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Enter account password"
                    value={exportPasswordInput()}
                    onInput={(e) => setExportPasswordInput(e.currentTarget.value)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
                  />
                </div>

                <div class="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setExportPrivateKeyModalOpen(false)}
                    class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={exportingPrivateKey() || !exportPasswordInput()}
                    class="px-5 py-2 rounded-xl bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700 cursor-pointer disabled:opacity-50"
                  >
                    {exportingPrivateKey() ? "Unwrapping…" : "Decrypt & Reveal"}
                  </button>
                </div>
              </form>
            </Show>

            <Show when={unwrappedPrivateKey()}>
              <div class="space-y-4">
                <div class="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 text-rose-800 dark:text-rose-300 text-xs font-medium">
                  This private key was unwrapped strictly inside your browser's WebAssembly sandbox. It was never sent to the server.
                </div>

                <textarea
                  readonly
                  rows={8}
                  class="w-full p-3 font-mono text-xs rounded-xl border border-rose-300 dark:border-rose-900 bg-[#F8F7F4] dark:bg-[#18191D] text-rose-900 dark:text-rose-200 select-all"
                  value={getArmoredPrivateKey()}
                />

                <div class="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(getArmoredPrivateKey());
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2500);
                    }}
                    class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs font-medium cursor-pointer"
                  >
                    {copiedKey() ? "Copied!" : "Copy Private Key"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPrivateKey}
                    class="px-5 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 cursor-pointer"
                  >
                    Download (.key)
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* 6. Reveal Recovery Phrase Modal */}
      <Show when={revealModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-lg w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6] flex items-center gap-2">
                <svg class="w-4 h-4 stroke-[#A27561] fill-none stroke-2" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <span>{revealedPhrase() ? "Recovery Phrase" : "Re-Authenticate Password"}</span>
              </h3>
              <button onClick={() => setRevealModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <Show when={!revealedPhrase()}>
              <form onSubmit={handleRevealPhrase} class="space-y-4">
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">
                  To reveal your 24-word recovery phrase, re-enter your account password.
                </p>

                <Show when={verifyError()}>
                  <div class="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
                    {verifyError()}
                  </div>
                </Show>

                <div>
                  <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                    Account Password
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="Enter your account password"
                    value={verifyPasswordInput()}
                    onInput={(e) => setVerifyPasswordInput(e.currentTarget.value)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
                  />
                </div>

                <div class="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRevealModalOpen(false)}
                    class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={verifying() || !verifyPasswordInput()}
                    class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] cursor-pointer"
                  >
                    {verifying() ? "Verifying…" : "Reveal Phrase"}
                  </button>
                </div>
              </form>
            </Show>

            <Show when={revealedPhrase()}>
              <div class="space-y-4">
                <div class="grid grid-cols-3 sm:grid-cols-4 gap-2 bg-[#F8F7F4] dark:bg-[#18191D] p-3.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138]">
                  <For each={phraseWords()}>
                    {(word, idx) => (
                      <div class="flex items-center gap-1.5 p-1.5 rounded-lg bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] text-xs">
                        <span class="text-[10px] text-[#6E7075] font-mono w-4 text-right">{idx() + 1}.</span>
                        <span class="font-mono font-bold text-[#1A1B1E] dark:text-[#F3F4F6] select-all">{word}</span>
                      </div>
                    )}
                  </For>
                </div>

                <div class="flex items-center justify-between pt-2">
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={handleCopyPhrase}
                      class="px-3.5 py-2 rounded-xl border border-[#E2DFD8] text-xs font-semibold cursor-pointer"
                    >
                      {copiedPhrase() ? "Copied!" : "Copy Words"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadRecoveryPhrase}
                      class="px-3.5 py-2 rounded-xl border border-[#E2DFD8] text-xs font-semibold cursor-pointer"
                    >
                      Download (.txt)
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRevealedPhrase(null);
                      setRevealModalOpen(false);
                    }}
                    class="px-5 py-2 rounded-xl bg-[#464748] text-white text-xs font-semibold cursor-pointer"
                  >
                    Done & Lock
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      {/* Add Passkey Modal */}
      <Show when={addPasskeyModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div class="w-full max-w-md bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl p-6 space-y-4 font-sans">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-[#F3ECE8] dark:bg-[#252830] text-[#A27561] flex items-center justify-center">
                  <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z" />
                  </svg>
                </div>
                <h4 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Register Biometric Passkey</h4>
              </div>
              <button onClick={() => setAddPasskeyModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] leading-relaxed">
              When prompted by your browser, verify your identity with Touch ID, Face ID, Windows Hello, or insert your hardware security key.
            </p>

            <Show when={passkeyError()}>
              <div class="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
                {passkeyError()}
              </div>
            </Show>

            <form onSubmit={handleEnrollPasskey} class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Device / Key Label
                </label>
                <input
                  type="text"
                  placeholder="e.g. MacBook Pro Touch ID, Windows Hello, YubiKey"
                  value={newPasskeyName()}
                  onInput={(e) => setNewPasskeyName(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddPasskeyModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingPasskey()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {addingPasskey() ? "Authenticating…" : "Activate Passkey"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* Reactivate Historical Keys Modal */}
      <Show when={reactivateModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div class="w-full max-w-md bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl p-6 space-y-4 font-sans">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                  <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h4 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Reactivate Historical Messages</h4>
              </div>
              <button onClick={() => setReactivateModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] leading-relaxed">
              Enter either your <strong>24-word recovery phrase</strong> or your <strong>previous account password</strong> to unseal your historical mailbox encryption keys. They will be seamlessly re-encrypted under your current login password.
            </p>

            <Show when={reactivateError()}>
              <div class="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl">
                {reactivateError()}
              </div>
            </Show>

            <form onSubmit={handleReactivateKeys} class="space-y-3">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  24-Word Recovery Phrase or Previous Password
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Enter 24 words separated by spaces, or previous password"
                  value={reactivateSecretInput()}
                  onInput={(e) => setReactivateSecretInput(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] font-mono focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Current Account Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter your current password"
                  value={newPassForReactivate()}
                  onInput={(e) => setNewPassForReactivate(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReactivateModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reactivating() || !reactivateSecretInput() || !newPassForReactivate()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {reactivating() ? "Unsealing & Re-wrapping…" : "Unlock Historical Messages"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};
