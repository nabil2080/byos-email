import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import {
  UserPasskey,
  listPasskeys,
  fetchPasskeyRegisterOptions,
  registerPasskey,
  deletePasskey,
  fetchPasskeyStepUpOptions,
  verifyPasskeyStepUp,
  TwoFactorStatus,
  TOTPSetupResponse,
  fetch2FAStatus,
  setupTOTP,
  verifyTOTP,
  disableTOTP,
  saveRecoveryMethods,
  SessionItem,
  fetchActiveSessions,
  revokeOtherSessions,
  verifyAccountPassword,
  changeAccountPassword,
  RecoveryMethodOption,
  fetchRecoveryOptions,
  requestRecoveryChallenge,
  resetPasswordWithRecovery,
  me,
  ExceptionalRecoveryRequestItem,
  fetchExceptionalRecoveryRequests,
  approveExceptionalRecoveryRequest,
  rejectExceptionalRecoveryRequest,
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

  // User email state
  const [currentUserEmail, setCurrentUserEmail] = createSignal("");

  // Sessions state
  const [sessions, setSessions] = createSignal<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = createSignal(true);
  const [revokingSessions, setRevokingSessions] = createSignal(false);

  // Password change form state (2 ways: standard & forgot)
  const [changePasswordModalOpen, setChangePasswordModalOpen] = createSignal(false);
  const [passwordChangeMode, setPasswordChangeMode] = createSignal<"standard" | "forgot">("standard");
  const [currentPasswordInput, setCurrentPasswordInput] = createSignal("");
  const [newPasswordInput, setNewPasswordInput] = createSignal("");
  const [confirmPasswordInput, setConfirmPasswordInput] = createSignal("");
  const [mfaCodeInput, setMfaCodeInput] = createSignal("");
  const [userHasMailbox, setUserHasMailbox] = createSignal(false);
  const [changingPassword, setChangingPassword] = createSignal(false);
  const [changePasswordError, setChangePasswordError] = createSignal<string | null>(null);

  // Forgot Password / OTP State
  const [recoveryOptions, setRecoveryOptions] = createSignal<RecoveryMethodOption[]>([]);
  const [loadingRecoveryOptions, setLoadingRecoveryOptions] = createSignal(false);
  const [selectedRecoveryMethod, setSelectedRecoveryMethod] = createSignal<"email" | "phone" | "totp" | "passkey">("email");
  const [recoveryChallengeToken, setRecoveryChallengeToken] = createSignal<string | null>(null);
  const [recoveryDestinationMasked, setRecoveryDestinationMasked] = createSignal<string | null>(null);
  const [recoveryOtpCode, setRecoveryOtpCode] = createSignal("");
  const [recoveryStep, setRecoveryStep] = createSignal<1 | 2>(1);
  const [sendingRecovery, setSendingRecovery] = createSignal(false);
  const [resettingPassword, setResettingPassword] = createSignal(false);

  // Exceptional Employee Recovery Queue State
  const [currentOrgId, setCurrentOrgId] = createSignal("");
  const [currentUserRole, setCurrentUserRole] = createSignal("");
  const [exceptionalRequests, setExceptionalRequests] = createSignal<ExceptionalRecoveryRequestItem[]>([]);
  const [loadingExceptional, setLoadingExceptional] = createSignal(false);
  const [actioningRequestId, setActioningRequestId] = createSignal<string | null>(null);

  function showSuccess(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  }

  function formatSessionAgent(ua: string): { browser: string; os: string; icon: string } {
    let browser = "Web Browser";
    let os = "Desktop";
    let icon = "laptop";

    if (/chrome/i.test(ua) && !/edg/i.test(ua)) browser = "Chrome";
    else if (/edg/i.test(ua)) browser = "Edge";
    else if (/firefox/i.test(ua)) browser = "Firefox";
    else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = "Safari";

    if (/windows/i.test(ua)) os = "Windows";
    else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
    else if (/android/i.test(ua)) { os = "Android"; icon = "smartphone"; }
    else if (/iphone|ipad|ipod/i.test(ua)) { os = "iOS"; icon = "smartphone"; }
    else if (/linux/i.test(ua)) os = "Linux";

    return { browser, os, icon };
  }

  function formatSessionDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
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

  async function loadSessions() {
    setLoadingSessions(true);
    try {
      const list = await fetchActiveSessions();
      setSessions(list);
    } catch (err) {
      console.warn("Failed to load sessions:", err);
    } finally {
      setLoadingSessions(false);
    }
  }

  async function loadExceptionalRequests(orgId: string) {
    if (!orgId) return;
    setLoadingExceptional(true);
    try {
      const list = await fetchExceptionalRecoveryRequests(orgId);
      setExceptionalRequests(list);
    } catch (err) {
      console.warn("Failed to load exceptional recovery requests:", err);
    } finally {
      setLoadingExceptional(false);
    }
  }

  async function handleApproveExceptional(reqId: string) {
    const orgId = currentOrgId();
    if (!orgId) return;
    setActioningRequestId(reqId);
    setError(null);
    try {
      await approveExceptionalRecoveryRequest(orgId, reqId);
      showSuccess("Recovery request approved. The employee may now complete their password reset directly in Webmail.");
      await loadExceptionalRequests(orgId);
    } catch (err: any) {
      setError(err?.message || "Failed to approve recovery request.");
    } finally {
      setActioningRequestId(null);
    }
  }

  async function handleRejectExceptional(reqId: string) {
    const orgId = currentOrgId();
    if (!orgId) return;
    if (!confirm("Are you sure you want to reject this employee recovery request?")) return;
    setActioningRequestId(reqId);
    setError(null);
    try {
      await rejectExceptionalRecoveryRequest(orgId, reqId);
      showSuccess("Recovery request rejected.");
      await loadExceptionalRequests(orgId);
    } catch (err: any) {
      setError(err?.message || "Failed to reject recovery request.");
    } finally {
      setActioningRequestId(null);
    }
  }

  async function loadUser() {
    try {
      const u = await me();
      if (u?.email) setCurrentUserEmail(u.email);
      if (u?.org_id) setCurrentOrgId(u.org_id);
      if (u?.role) setCurrentUserRole(u.role);
      if (u?.mailbox_id || u?.wrapped_sk_user) {
        setUserHasMailbox(true);
      }
      if (u?.role === "owner" && u?.org_id) {
        loadExceptionalRequests(u.org_id);
      }
    } catch {}
  }

  onMount(() => {
    loadPasskeys();
    load2FA();
    loadSessions();
    loadUser();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (totpModalOpen()) setTotpModalOpen(false);
        if (disableTotpModalOpen()) setDisableTotpModalOpen(false);
        if (addModalOpen()) setAddModalOpen(false);
        if (changePasswordModalOpen()) setChangePasswordModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  // ── Session Revocation Handler ──

  async function handleRevokeOthers() {
    if (!confirm("Are you sure you want to sign out all other devices and browser sessions?")) {
      return;
    }
    setRevokingSessions(true);
    setError(null);
    try {
      const res = await revokeOtherSessions();
      showSuccess(`Successfully revoked ${res.revoked_count} active session(s).`);
      await loadSessions();
    } catch (err: any) {
      setError(err?.message || "Failed to revoke other sessions.");
    } finally {
      setRevokingSessions(false);
    }
  }

  // ── Password Change Handlers (Standard & Forgot) ──

  function handleOpenChangePassword() {
    setChangePasswordError(null);
    setPasswordChangeMode("standard");
    setCurrentPasswordInput("");
    setNewPasswordInput("");
    setConfirmPasswordInput("");
    setMfaCodeInput("");
    setRecoveryOtpCode("");
    setRecoveryChallengeToken(null);
    setRecoveryStep(1);
    setChangePasswordModalOpen(true);
  }

  async function handleChangePasswordStandard(e: Event) {
    e.preventDefault();
    setChangePasswordError(null);
    const curr = currentPasswordInput().trim();
    const next = newPasswordInput().trim();
    const conf = confirmPasswordInput().trim();
    const mfa = mfaCodeInput().trim();

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
      const verifyRes = await verifyAccountPassword(curr);
      if (!verifyRes.valid) {
        throw new Error(verifyRes.error || "Current password is incorrect.");
      }
      await changeAccountPassword(next, curr, mfa || undefined);
      setChangePasswordModalOpen(false);
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      setMfaCodeInput("");
      showSuccess("Account password successfully changed. Other active sessions were rotated.");
      await loadSessions();
    } catch (err: any) {
      setChangePasswordError(err?.message || "Failed to change password.");
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleSwitchToForgotPassword() {
    setPasswordChangeMode("forgot");
    setChangePasswordError(null);
    setRecoveryStep(1);
    setRecoveryChallengeToken(null);
    setRecoveryDestinationMasked(null);
    setRecoveryOtpCode("");
    setNewPasswordInput("");
    setConfirmPasswordInput("");

    let em = currentUserEmail();
    if (!em) {
      try {
        const u = await me();
        if (u?.email) {
          em = u.email;
          setCurrentUserEmail(u.email);
        }
      } catch {}
    }

    if (em) {
      setLoadingRecoveryOptions(true);
      try {
        const resp = await fetchRecoveryOptions(em);
        setRecoveryOptions(resp.methods || []);
        if (resp.methods && resp.methods.length > 0) {
          setSelectedRecoveryMethod(resp.methods[0].type);
        }
      } catch (err) {
        console.warn("Could not fetch recovery options:", err);
      } finally {
        setLoadingRecoveryOptions(false);
      }
    }
  }

  async function handleSendRecoveryChallenge(e: Event) {
    e.preventDefault();
    setChangePasswordError(null);
    const em = currentUserEmail();
    if (!em) {
      setChangePasswordError("Account email could not be determined.");
      return;
    }
    const method = selectedRecoveryMethod();
    setSendingRecovery(true);
    try {
      const resp = await requestRecoveryChallenge(em, method);
      setRecoveryChallengeToken(resp.challenge_token);
      setRecoveryDestinationMasked(resp.destination_masked);

      if (method === "passkey") {
        if (typeof window !== "undefined" && window.PublicKeyCredential) {
          try {
            const opts = await fetchPasskeyStepUpOptions();
            const currentHost = window.location.hostname;
            const effectiveRpId = (opts.rpId && (opts.rpId === currentHost || currentHost.endsWith("." + opts.rpId))) ? opts.rpId : currentHost;
            const allowCreds = opts.allowCredentials?.map((c) => ({
              id: base64URLToBuffer(c.id),
              type: "public-key" as const,
            }));

            const assertion = (await navigator.credentials.get({
              publicKey: {
                challenge: base64URLToBuffer(opts.challenge),
                rpId: effectiveRpId,
                userVerification: (opts.userVerification || "required") as any,
                timeout: opts.timeout || 60000,
                allowCredentials: allowCreds && allowCreds.length > 0 ? allowCreds : undefined,
              },
            })) as PublicKeyCredential;

            if (!assertion) {
              throw new Error("Passkey step-up was cancelled.");
            }

            const rawId = bufferToBase64URL(assertion.rawId);
            const resp2 = assertion.response as AuthenticatorAssertionResponse;
            const clientDataB64 = bufferToBase64URL(resp2.clientDataJSON);
            const authDataB64 = bufferToBase64URL(resp2.authenticatorData);
            const sigB64 = bufferToBase64URL(resp2.signature);
            const userHandleB64 = resp2.userHandle ? bufferToBase64URL(resp2.userHandle) : undefined;

            const payload = {
              id: assertion.id,
              rawId: rawId,
              type: assertion.type,
              response: {
                clientDataJSON: clientDataB64,
                authenticatorData: authDataB64,
                signature: sigB64,
                userHandle: userHandleB64,
              },
            };

            const verifyRes = await verifyPasskeyStepUp(payload);
            if (verifyRes.step_up_token) {
              setRecoveryOtpCode(verifyRes.step_up_token);
              setRecoveryStep(2);
              showSuccess("Passkey verified. Enter your new password below.");
              return;
            }
          } catch (pkErr: any) {
            console.warn("Passkey assertion error:", pkErr);
            setChangePasswordError(pkErr?.message || "Passkey verification failed.");
            return;
          }
        }
      }

      setRecoveryStep(2);
      if (resp.debug_code) {
        setRecoveryOtpCode(resp.debug_code);
      }
    } catch (err: any) {
      setChangePasswordError(err?.message || "Failed to send verification code.");
    } finally {
      setSendingRecovery(false);
    }
  }

  async function handleResetPasswordWithRecovery(e: Event) {
    e.preventDefault();
    setChangePasswordError(null);
    const token = recoveryChallengeToken();
    const code = recoveryOtpCode().trim();
    const next = newPasswordInput().trim();
    const conf = confirmPasswordInput().trim();

    if (!token) {
      setChangePasswordError("Recovery session expired. Please start over.");
      return;
    }
    if (!code) {
      setChangePasswordError("Verification code is required.");
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

    setResettingPassword(true);
    try {
      await resetPasswordWithRecovery(token, code, next);
      setChangePasswordModalOpen(false);
      setPasswordChangeMode("standard");
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmPasswordInput("");
      setRecoveryOtpCode("");
      setRecoveryChallengeToken(null);
      showSuccess("Account password successfully reset! Active sessions updated.");
      await loadSessions();
    } catch (err: any) {
      setChangePasswordError(err?.message || "Failed to reset password.");
    } finally {
      setResettingPassword(false);
    }
  }

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
    if (window.location.hostname === "127.0.0.1") {
      setError("WebAuthn requires accessing the site via 'http://localhost:3000' rather than '127.0.0.1'. W3C WebAuthn standards forbid IP addresses as Relying Party domains.");
      return;
    }
    setEnrolling(true);
    setError(null);
    try {
      const opts = await fetchPasskeyRegisterOptions();

      const currentHost = window.location.hostname;
      const effectiveRpId = (opts.rp?.id && (opts.rp.id === currentHost || currentHost.endsWith("." + opts.rp.id))) ? opts.rp.id : currentHost;

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
      const clientDataB64 = bufferToBase64URL(resp.clientDataJSON);
      const attestationB64 = bufferToBase64URL(resp.attestationObject);
      const transports = typeof resp.getTransports === "function" ? resp.getTransports() : [];

      await registerPasskey({
        id: cred.id,
        rawId: rawId,
        type: cred.type,
        response: {
          clientDataJSON: clientDataB64,
          attestationObject: attestationB64,
          transports: transports,
        },
        device_name: deviceName().trim() || "Touch ID / Windows Hello",
        credential_id: cred.id,
        challenge_token: opts.challenge || (opts as any).challenge_token,
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

      {/* ── SECTION: ACCOUNT PASSWORD ── */}
      <div id="account-password-section" class="rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs">
        <div class="px-6 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-sm font-bold text-[#3C3D3E]">Account Password</h2>
            <p class="text-xs text-[#6F7173] mt-0.5">
              Change your account login password. Revokes other active browser sessions upon update.
            </p>
          </div>
          <button
            type="button"
            data-testid="change-password-btn"
            onClick={handleOpenChangePassword}
            class="inline-flex items-center gap-2 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors cursor-pointer shrink-0"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>Change Password</span>
          </button>
        </div>
      </div>

      {/* ── SECTION: ACTIVE SESSIONS ── */}
      <div id="active-sessions-section" class="rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs">
        <div class="border-b border-[#E2DFD8] bg-[#FAF8F5] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 class="text-sm font-bold text-[#3C3D3E]">Active Browser Sessions</h2>
            <p class="text-xs text-[#6F7173]">
              Audit logged-in devices and sign out other sessions.
            </p>
          </div>
          <button
            type="button"
            data-testid="revoke-others-btn"
            disabled={revokingSessions() || sessions().filter((s) => !s.is_current).length === 0}
            onClick={handleRevokeOthers}
            class="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
              <line x1="12" y1="2" x2="12" y2="12" />
            </svg>
            <span>{revokingSessions() ? "Revoking…" : "Revoke All Other Sessions"}</span>
          </button>
        </div>

        <div class="p-6">
          <Show
            when={!loadingSessions()}
            fallback={<div class="text-xs text-[#6F7173] py-2">Loading active sessions…</div>}
          >
            <div class="divide-y divide-[#E2DFD8] rounded-xl border border-[#E2DFD8] overflow-hidden">
              <For each={sessions()}>
                {(session) => {
                  const agent = formatSessionAgent(session.user_agent);
                  return (
                    <div class="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white hover:bg-[#FAF9F6] transition-colors">
                      <div class="flex items-start sm:items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0">
                          <Show
                            when={agent.icon === "smartphone"}
                            fallback={
                              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                                <line x1="8" y1="21" x2="16" y2="21" />
                                <line x1="12" y1="17" x2="12" y2="21" />
                              </svg>
                            }
                          >
                            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                              <line x1="12" y1="18" x2="12.01" y2="18" />
                            </svg>
                          </Show>
                        </div>
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-[#3C3D3E]">
                              {agent.browser} on {agent.os}
                            </span>
                            <Show when={session.is_current}>
                              <span class="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-800">
                                Current Session
                              </span>
                            </Show>
                          </div>
                          <div class="mt-0.5 text-[11px] text-[#6F7173] font-mono">
                            IP: {session.ip_address} • Last Active: {formatSessionDate(session.last_active_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </div>

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
      <div id="passkeys-section" class="rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs">
        <div class="border-b border-[#E2DFD8] bg-[#FAF8F5] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 class="text-sm font-bold text-[#3C3D3E]">Hardware & Trusted Devices</h2>
            <p class="text-xs text-[#6F7173]">
              Manage FIDO2 / WebAuthn biometric sensors (Touch ID, Windows Hello) and physical security keys (YubiKey).
            </p>
          </div>
          <button
            onClick={() => setAddModalOpen(true)}
            class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] px-4 py-2 text-xs font-semibold text-white shadow-xs self-start sm:self-auto shrink-0 transition cursor-pointer"
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
              onClick={() => setAddModalOpen(true)}
              class="inline-flex items-center gap-1.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition cursor-pointer"
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

      {/* ── SECTION: EMPLOYEE EXCEPTIONAL RECOVERY QUEUE ── */}
      <Show when={currentUserRole() === "owner"}>
        <div id="exceptional-recovery-section" class="rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs">
          <div class="border-b border-[#E2DFD8] bg-[#FAF8F5] px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-sm font-bold text-[#3C3D3E]">Employee Exceptional Recovery Queue</h2>
                <Show when={exceptionalRequests().length > 0}>
                  <span class="rounded-full bg-amber-100 text-amber-900 px-2.5 py-0.5 text-[10px] font-bold">
                    {exceptionalRequests().length} Pending
                  </span>
                </Show>
              </div>
              <p class="text-xs text-[#6F7173] mt-0.5">
                Review and authorize out-of-band identity recovery for employees who lost their 2FA factors or credentials.
              </p>
            </div>
            <button
              type="button"
              onClick={() => currentOrgId() && loadExceptionalRequests(currentOrgId())}
              disabled={loadingExceptional()}
              class="inline-flex items-center gap-1.5 rounded-xl border border-[#E2DFD8] px-3.5 py-2 text-xs font-semibold text-[#3C3D3E] hover:bg-stone-50 transition-colors disabled:opacity-50 cursor-pointer self-start sm:self-auto shrink-0"
            >
              <svg class={`w-3.5 h-3.5 ${loadingExceptional() ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>{loadingExceptional() ? "Refreshing…" : "Refresh Queue"}</span>
            </button>
          </div>

          <div class="p-6">
            <Show
              when={!loadingExceptional()}
              fallback={<div class="text-xs text-[#6F7173] py-2">Loading pending requests…</div>}
            >
              <Show
                when={exceptionalRequests().length > 0}
                fallback={
                  <div class="text-center py-8">
                    <div class="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-2">
                      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    </div>
                    <p class="text-xs font-bold text-[#3C3D3E]">No Pending Employee Recovery Requests</p>
                    <p class="text-[11px] text-[#6F7173] max-w-sm mx-auto mt-1">
                      When an employee loses access to their account and requests exceptional assistance, their request will be listed here for owner approval.
                    </p>
                  </div>
                }
              >
                <div class="divide-y divide-[#E2DFD8] rounded-xl border border-[#E2DFD8] overflow-hidden">
                  <For each={exceptionalRequests()}>
                    {(req) => (
                      <div class="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white hover:bg-[#FAF9F6] transition-colors">
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-bold text-[#3C3D3E]">
                              {req.display_name || req.email}
                            </span>
                            <span class="rounded bg-stone-100 text-stone-700 font-mono px-2 py-0.5 text-[10px]">
                              {req.email}
                            </span>
                          </div>
                          <div class="mt-1 text-[11px] text-[#6F7173] font-mono">
                            Requested: {formatSessionDate(req.created_at)} • Expires: {formatSessionDate(req.expires_at)}
                          </div>
                        </div>

                        <div class="flex items-center gap-2 self-start sm:self-auto">
                          <button
                            type="button"
                            disabled={actioningRequestId() === req.id}
                            onClick={() => handleApproveExceptional(req.id)}
                            class="inline-flex items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                          >
                            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>{actioningRequestId() === req.id ? "Approving…" : "Approve Reset"}</span>
                          </button>
                          <button
                            type="button"
                            disabled={actioningRequestId() === req.id}
                            onClick={() => handleRejectExceptional(req.id)}
                            class="inline-flex items-center gap-1 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            <span>Reject</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </Show>


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
                  {enrolling() ? "Verifying with Windows Hello…" : "Create Passkey"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* ── MODAL: CHANGE PASSWORD (2 WAYS: STANDARD & FORGOT/RECOVERY) ── */}
      <Show when={changePasswordModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-password-title"
            class="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E2DFD8]"
          >
            <div class="flex items-center justify-between pb-3 border-b border-[#E2DFD8]">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-lg bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center">
                  <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </div>
                <h3 id="change-password-title" class="text-base font-bold text-[#3C3D3E]">
                  {passwordChangeMode() === "standard"
                    ? "Change Account Password"
                    : "Reset Password via Identity Verification"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setChangePasswordModalOpen(false)}
                aria-label="Close dialog"
                class="rounded-lg p-1 text-[#6F7173] hover:bg-[#F3ECE8] hover:text-[#3C3D3E] cursor-pointer"
              >
                ✕
              </button>
            </div>

            <Show when={changePasswordError()}>
              <div role="alert" class="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-800 border border-red-200">
                {changePasswordError()}
              </div>
            </Show>

            {/* WAY 1: STANDARD PASSWORD CHANGE */}
            <Show when={passwordChangeMode() === "standard"}>
              <Show
                when={!userHasMailbox()}
                fallback={
                  <div class="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-3">
                    <div class="flex items-center gap-2 font-bold text-amber-800">
                      <svg class="w-4 h-4 text-amber-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Mailbox Owner Account Detected</span>
                    </div>
                    <p class="leading-relaxed">
                      Your account is linked to an encrypted BYOS mailbox. Because your mailbox key envelope must be re-wrapped client-side using WebAssembly cryptography to keep your emails accessible, password changes for mailbox owners must be performed directly in Webmail.
                    </p>
                    <div class="pt-1 flex items-center justify-between">
                      <a
                        href="/webmail"
                        class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition-colors"
                      >
                        Open Webmail Security Settings →
                      </a>
                      <button
                        type="button"
                        onClick={() => setChangePasswordModalOpen(false)}
                        class="px-3.5 py-2 rounded-xl border border-[#E2DFD8] text-xs font-semibold text-[#6F7173] hover:bg-[#F3ECE8] transition-colors cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                }
              >
                <form onSubmit={handleChangePasswordStandard} class="mt-4 space-y-4">
                  <div>
                    <div class="flex items-center justify-between mb-1">
                      <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173]">
                        Current Password
                      </label>
                      <button
                        type="button"
                        data-testid="forgot-password-trigger"
                        onClick={handleSwitchToForgotPassword}
                        class="text-xs text-[#9E725F] hover:underline font-semibold cursor-pointer"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <input
                      type="password"
                      required
                      data-testid="current-password-input"
                      placeholder="Enter current account password"
                      value={currentPasswordInput()}
                      onInput={(e) => setCurrentPasswordInput(e.currentTarget.value)}
                      class="block w-full rounded-xl border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                      autofocus
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                      New Password (min 8 chars)
                    </label>
                    <input
                      type="password"
                      required
                      data-testid="new-password-input"
                      placeholder="Enter new strong password"
                      value={newPasswordInput()}
                      onInput={(e) => setNewPasswordInput(e.currentTarget.value)}
                      class="block w-full rounded-xl border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      required
                      data-testid="confirm-password-input"
                      placeholder="Repeat new password"
                      value={confirmPasswordInput()}
                      onInput={(e) => setConfirmPasswordInput(e.currentTarget.value)}
                      class="block w-full rounded-xl border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                    />
                  </div>

                  <Show when={twoFactor()?.has_totp || passkeys().length > 0}>
                    <div>
                      <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                        Two-Factor Authenticator Code (MFA)
                      </label>
                      <input
                        type="text"
                        required
                        data-testid="mfa-code-input"
                        placeholder="6-digit authenticator code"
                        value={mfaCodeInput()}
                        onInput={(e) => setMfaCodeInput(e.currentTarget.value.replace(/\D/g, ""))}
                        class="block w-full rounded-xl border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none font-mono"
                      />
                    </div>
                  </Show>

                  <div class="flex items-center justify-end gap-2.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setChangePasswordModalOpen(false)}
                      class="rounded-xl border border-[#E2DFD8] px-4 py-2 text-xs font-semibold text-[#6F7173] hover:bg-[#F3ECE8] transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      data-testid="submit-password-change-btn"
                      disabled={changingPassword()}
                      class="rounded-xl bg-[#9E725F] px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      {changingPassword() ? "Updating…" : "Update Password"}
                    </button>
                  </div>
                </form>
              </Show>
            </Show>

            {/* WAY 2: FORGOT PASSWORD (OTP & CONNECTED IDENTITY VERIFICATION) */}
            <Show when={passwordChangeMode() === "forgot"}>
              <div class="mt-4 space-y-4">
                {/* STEP 1: CHOOSE CONNECTED VERIFICATION METHOD */}
                <Show when={recoveryStep() === 1}>
                  <p class="text-xs text-[#6F7173]">
                    Choose a connected method to verify your account identity:
                  </p>

                  <Show
                    when={!loadingRecoveryOptions()}
                    fallback={<div class="py-4 text-xs text-[#6F7173]">Loading verification methods…</div>}
                  >
                    <div class="space-y-2">
                      <For each={recoveryOptions()}>
                        {(opt) => {
                          const isSelected = selectedRecoveryMethod() === opt.type;
                          return (
                            <button
                              type="button"
                              data-testid={`recovery-opt-${opt.type}`}
                              onClick={() => setSelectedRecoveryMethod(opt.type)}
                              class={`w-full p-3.5 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                                isSelected
                                  ? "border-[#9E725F] bg-[#FAF8F5] ring-2 ring-[#9E725F]/20"
                                  : "border-[#E2DFD8] bg-white hover:border-[#9E725F]/50"
                              }`}
                            >
                              <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-lg bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0">
                                  <Show when={opt.type === "email"}>
                                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <rect x="2" y="4" width="20" height="16" rx="2" />
                                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                                    </svg>
                                  </Show>
                                  <Show when={opt.type === "phone"}>
                                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                                      <line x1="12" y1="18" x2="12.01" y2="18" />
                                    </svg>
                                  </Show>
                                  <Show when={opt.type === "totp"}>
                                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <circle cx="12" cy="12" r="10" />
                                      <polyline points="12 6 12 12 16 14" />
                                    </svg>
                                  </Show>
                                  <Show when={opt.type === "passkey"}>
                                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                      <path d="m9 12 2 2 4-4" />
                                    </svg>
                                  </Show>
                                </div>
                                <div>
                                  <div class="text-xs font-bold text-[#3C3D3E]">
                                    {opt.type === "email" && "Recovery Email OTP"}
                                    {opt.type === "phone" && "Phone / SMS OTP"}
                                    {opt.type === "totp" && "Authenticator App (TOTP)"}
                                    {opt.type === "passkey" && "Hardware Security Key / Passkey"}
                                  </div>
                                  <div class="text-[11px] text-[#6F7173] font-mono">
                                    {opt.destination_masked}
                                  </div>
                                </div>
                              </div>
                              <div class={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                isSelected ? "border-[#9E725F] bg-[#9E725F]" : "border-[#E2DFD8]"
                              }`}>
                                <Show when={isSelected}>
                                  <div class="w-1.5 h-1.5 rounded-full bg-white" />
                                </Show>
                              </div>
                            </button>
                          );
                        }}
                      </For>
                    </div>

                    <div class="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPasswordChangeMode("standard");
                          setChangePasswordError(null);
                        }}
                        class="text-xs font-semibold text-[#9E725F] hover:underline cursor-pointer"
                      >
                        ← Back to standard password change
                      </button>

                      <button
                        type="button"
                        data-testid="send-recovery-code-btn"
                        disabled={sendingRecovery() || recoveryOptions().length === 0}
                        onClick={handleSendRecoveryChallenge}
                        class="rounded-xl bg-[#9E725F] px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {sendingRecovery() ? "Sending…" : "Send Verification Code"}
                      </button>
                    </div>
                  </Show>
                </Show>

                {/* STEP 2: VERIFY CODE & SET NEW PASSWORD */}
                <Show when={recoveryStep() === 2}>
                  <form onSubmit={handleResetPasswordWithRecovery} class="space-y-4">
                    <div class="p-3 bg-[#FAF8F5] rounded-xl border border-[#E2DFD8] text-xs text-[#6F7173]">
                      <span class="font-semibold text-[#3C3D3E]">Target Destination: </span>
                      <span class="font-mono text-[#9E725F]">{recoveryDestinationMasked()}</span>
                    </div>

                    <div>
                      <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                        {selectedRecoveryMethod() === "passkey" ? "Security Key Credential" : "6-Digit Verification Code"}
                      </label>
                      <input
                        type="text"
                        required
                        data-testid="recovery-code-input"
                        placeholder={selectedRecoveryMethod() === "passkey" ? "Passkey Credential ID" : "e.g. 123456"}
                        value={recoveryOtpCode()}
                        onInput={(e) => setRecoveryOtpCode(e.currentTarget.value)}
                        class="block w-full rounded-xl border border-[#E2DFD8] bg-white px-3 py-2 text-xs font-mono text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                        autofocus
                      />
                    </div>

                    <div>
                      <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                        New Password (min 8 chars)
                      </label>
                      <input
                        type="password"
                        required
                        data-testid="recovery-new-password-input"
                        placeholder="Enter new strong password"
                        value={newPasswordInput()}
                        onInput={(e) => setNewPasswordInput(e.currentTarget.value)}
                        class="block w-full rounded-xl border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label class="block text-xs font-semibold uppercase tracking-wider text-[#6F7173] mb-1">
                        Confirm New Password
                      </label>
                      <input
                        type="password"
                        required
                        data-testid="recovery-confirm-password-input"
                        placeholder="Repeat new password"
                        value={confirmPasswordInput()}
                        onInput={(e) => setConfirmPasswordInput(e.currentTarget.value)}
                        class="block w-full rounded-xl border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
                      />
                    </div>

                    <div class="flex items-center justify-between pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRecoveryStep(1);
                          setChangePasswordError(null);
                        }}
                        class="text-xs font-semibold text-[#9E725F] hover:underline cursor-pointer"
                      >
                        ← Back
                      </button>

                      <button
                        type="submit"
                        data-testid="submit-recovery-reset-btn"
                        disabled={resettingPassword()}
                        class="rounded-xl bg-[#9E725F] px-5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {resettingPassword() ? "Resetting…" : "Reset & Set New Password"}
                      </button>
                    </div>
                  </form>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default SecurityPage;
