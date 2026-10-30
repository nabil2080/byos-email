import { apiBase, getCpHeaders } from "./client";

export interface AuthSessionResponse {
  id?: string;
  email?: string;
  org_id?: string;
  organization_id?: string;
  display_name?: string;
  role?: "owner" | "admin" | "member";
  plan?: string;
  token?: string;
  mailbox_id?: string;
  mailbox_local_part?: string;
  mailbox_mode?: string;
  wrapped_sk_user?: string;
  previous_wrapped_sk_user?: string;
  two_factor_required?: boolean;
  challenge_token?: string;
  methods?: string[];
  preferred_method?: string;
  destination_masked?: string;
  debug_code?: string;
}

export interface CheckEmailResponse {
  email: string;
  exists: boolean;
  already_logged_in: boolean;
  current_session: boolean;
  message: string;
}

export async function checkEmailAvailability(email: string): Promise<CheckEmailResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/check-email`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ email: email.trim() }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Check email failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as CheckEmailResponse;
}

export async function register(
  email: string,
  passwordVerifier: string,
  publicKey?: string,
  orgName?: string,
  recoveryEmail?: string,
  recoveryPhone?: string
): Promise<{ id: string; email: string; org_id: string; org_name: string }> {
  const payload: Record<string, string> = {
    email: email.trim(),
    password: passwordVerifier,
  };
  // Note: publicKey parameter is retained for call-site signature compatibility,
  // but org_recovery_pk is intentionally omitted because organization recovery keys are deprecated
  // and new organizations store org_recovery_pk = NULL.
  if (orgName) {
    payload.org_name = orgName;
  }
  if (recoveryEmail) {
    payload.recovery_email = recoveryEmail.trim();
  }
  if (recoveryPhone) {
    payload.recovery_phone = recoveryPhone.trim();
  }
  const res = await fetch(`${apiBase()}/v1/auth/register`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Register failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as { id: string; email: string; org_id: string; org_name: string; token?: string };
  if (data.token && typeof window !== "undefined") {
    localStorage.setItem("byos_cp_session_token", data.token);
  }
  return data;
}

export async function login(email: string, password: string): Promise<AuthSessionResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/login`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ email, password, client: "control-plane" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Login failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as AuthSessionResponse;
  if (data.token && typeof window !== "undefined") {
    localStorage.setItem("byos_cp_session_token", data.token);
  }
  return data;
}

export async function verifyLogin2FA(
  challengeToken: string,
  code: string
): Promise<AuthSessionResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/2fa/verify-login`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({
      challenge_token: challengeToken,
      code: code,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let errorMsg = text || `Verification failed ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) errorMsg = parsed.error;
    } catch {}
    const err = new Error(errorMsg) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const data = (await res.json()) as AuthSessionResponse;
  if (data.token && typeof window !== "undefined") {
    localStorage.setItem("byos_cp_session_token", data.token);
  }
  return data;
}

export async function sendLogin2FACode(
  challengeToken: string,
  method: "email" | "phone"
): Promise<{ success: boolean; method: string; destination_masked: string; debug_code?: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/2fa/send-code`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({
      challenge_token: challengeToken,
      method: method,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to send code: status ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as { success: boolean; method: string; destination_masked: string; debug_code?: string };
}

export async function logout(): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.removeItem("byos_cp_session_token");
  }
  const res = await fetch(`${apiBase()}/v1/auth/logout`, {
    method: "POST",
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Logout failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}

export async function me(): Promise<AuthSessionResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/me`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Not authenticated ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as AuthSessionResponse;
}

export interface UserPasskey {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  device_name: string;
  aaguid?: string;
  created_at: string;
  last_used_at?: string;
}

export interface PasskeyLoginOptionsResponse {
  challenge: string;
  rpId: string;
  timeout: number;
  userVerification: string;
  allowCredentials?: Array<{
    id: string;
    type: string;
  }>;
}

export interface PasskeyRegisterOptionsResponse {
  challenge: string;
  rp: {
    name: string;
    id: string;
  };
  user: {
    id: string;
    name: string;
    displayName: string;
  };
  pubKeyCredParams: Array<{
    type: string;
    alg: number;
  }>;
  authenticatorSelection: {
    authenticatorAttachment?: string;
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: string;
  };
  timeout: number;
  attestation: string;
}

export async function fetchPasskeyLoginOptions(email?: string): Promise<PasskeyLoginOptionsResponse> {
  const url = email
    ? `${apiBase()}/v1/auth/passkeys/login-options?email=${encodeURIComponent(email)}`
    : `${apiBase()}/v1/auth/passkeys/login-options`;
  const res = await fetch(url, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch passkey options: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as PasskeyLoginOptionsResponse;
}

export async function loginWithPasskey(data: any): Promise<AuthSessionResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/passkeys/login`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Passkey login failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const result = (await res.json()) as AuthSessionResponse;
  if (result.token && typeof window !== "undefined") {
    localStorage.setItem("byos_cp_session_token", result.token);
  }
  return result;
}

export async function fetchPasskeyRegisterOptions(): Promise<PasskeyRegisterOptionsResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/passkeys/register-options`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch passkey registration options: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as PasskeyRegisterOptionsResponse;
}

export async function registerPasskey(data: any): Promise<UserPasskey> {
  const res = await fetch(`${apiBase()}/v1/auth/passkeys/register`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to register passkey: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as UserPasskey;
}

export async function fetchPasskeyStepUpOptions(): Promise<PasskeyLoginOptionsResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/passkeys/step-up-options`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch passkey step-up options: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as PasskeyLoginOptionsResponse;
}

export async function verifyPasskeyStepUp(payload: any): Promise<{ success: boolean; step_up_token: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/passkeys/step-up-verify`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Passkey step-up verification failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as { success: boolean; step_up_token: string };
}

export async function listPasskeys(): Promise<UserPasskey[]> {
  const res = await fetch(`${apiBase()}/v1/auth/passkeys`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    return [];
  }
  return (await res.json()) as UserPasskey[];
}

export async function deletePasskey(id: string): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/auth/passkeys/${id}`, {
    method: "DELETE",
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to delete passkey: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}

export interface TwoFactorStatus {
  two_factor_enabled: boolean;
  has_totp: boolean;
  recovery_email: string;
  recovery_phone: string;
}

export interface TOTPSetupResponse {
  secret: string;
  otpauth_url: string;
}

export async function fetch2FAStatus(): Promise<TwoFactorStatus> {
  const res = await fetch(`${apiBase()}/v1/auth/2fa/status`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to fetch 2FA status: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as TwoFactorStatus;
}

export async function setupTOTP(): Promise<TOTPSetupResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/2fa/totp/setup`, {
    method: "POST",
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to setup TOTP: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as TOTPSetupResponse;
}

export async function verifyTOTP(
  secret: string,
  code: string
): Promise<{ valid: boolean; message?: string; error?: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/2fa/totp/verify`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ secret, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { valid: false, error: data.error || `Verification failed: ${res.status}` };
  }
  return data as { valid: boolean; message?: string };
}

export async function disableTOTP(
  password: string
): Promise<{ success: boolean; error?: string; message?: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/2fa/totp/disable`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { success: false, error: data.error || `Disable 2FA failed: ${res.status}` };
  }
  return data as { success: boolean; message?: string };
}

export async function saveRecoveryMethods(
  recoveryEmail: string,
  recoveryPhone: string
): Promise<{ success: boolean }> {
  const res = await fetch(`${apiBase()}/v1/auth/2fa/recovery-methods`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({
      recovery_email: recoveryEmail,
      recovery_phone: recoveryPhone,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Failed to save recovery methods: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as { success: boolean };
}

// ── Active Sessions & Password Management ──

export interface SessionItem {
  id: string;
  ip_address: string;
  user_agent: string;
  created_at: string;
  last_active_at: string;
  is_current: boolean;
}

export async function fetchActiveSessions(): Promise<SessionItem[]> {
  const res = await fetch(`${apiBase()}/v1/auth/sessions`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to fetch sessions: status ${res.status}`);
  }
  const data = await res.json();
  return data.sessions || [];
}

export async function revokeOtherSessions(): Promise<{ success: boolean; revoked_count: number }> {
  const res = await fetch(`${apiBase()}/v1/auth/sessions/revoke-others`, {
    method: "POST",
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to revoke sessions: status ${res.status}`);
  }
  return await res.json();
}

export async function verifyAccountPassword(password: string): Promise<{ valid: boolean; error?: string }> {
  const res = await fetch(`${apiBase()}/v1/auth/verify-password`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let errorMsg = text || `Verification failed: status ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) errorMsg = parsed.error;
    } catch {}
    return { valid: false, error: errorMsg };
  }
  return await res.json();
}

export async function changeAccountPassword(
  newPassword: string,
  currentPassword?: string,
  mfaCode?: string
): Promise<void> {
  const payload: Record<string, string> = { new_password: newPassword };
  if (currentPassword) {
    payload.current_password = currentPassword;
  }
  if (mfaCode) {
    payload.mfa_code = mfaCode;
  }
  const res = await fetch(`${apiBase()}/v1/auth/change-password`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let errorMsg = text || `Failed to change password: status ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) errorMsg = parsed.error;
    } catch {}
    throw new Error(errorMsg);
  }
}

// ── Password Recovery & Identity Reset ──

export interface RecoveryMethodOption {
  type: "email" | "phone" | "totp" | "passkey";
  destination_masked: string;
}

export interface RecoveryOptionsResponse {
  email: string;
  methods: RecoveryMethodOption[];
}

export interface RecoveryRequestResponse {
  challenge_token: string;
  method: string;
  destination_masked: string;
  expires_at: string;
  mailbox_id?: string;
  wrapped_sk_user?: string;
  debug_code?: string;
}

export async function fetchRecoveryOptions(email: string): Promise<RecoveryOptionsResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/recovery/options?email=${encodeURIComponent(email)}`, {
    headers: getCpHeaders(),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to fetch recovery options: status ${res.status}`);
  }
  return await res.json();
}

export async function requestRecoveryChallenge(
  email: string,
  method: "email" | "phone" | "totp" | "passkey"
): Promise<RecoveryRequestResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/recovery/request`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({ email, method }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let errorMsg = text || `Failed to request recovery challenge: status ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) errorMsg = parsed.error;
    } catch {}
    throw new Error(errorMsg);
  }
  return await res.json();
}

export async function resetPasswordWithRecovery(
  challengeToken: string,
  code: string,
  newPassword: string
): Promise<{ token?: string; [key: string]: any }> {
  const res = await fetch(`${apiBase()}/v1/auth/recovery/reset-password`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
    body: JSON.stringify({
      challenge_token: challengeToken,
      code,
      new_password: newPassword,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let errorMsg = text || `Password reset failed: status ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      if (parsed.error) errorMsg = parsed.error;
    } catch {}
    throw new Error(errorMsg);
  }
  const data = await res.json();
  if (data.token && typeof window !== "undefined") {
    localStorage.setItem("byos_cp_session_token", data.token);
  }
  return data;
}

export interface ExceptionalRecoveryRequestItem {
  id: string;
  user_id: string;
  email: string;
  display_name: string;
  created_at: string;
  expires_at: string;
}

export async function fetchExceptionalRecoveryRequests(orgId: string): Promise<ExceptionalRecoveryRequestItem[]> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/exceptional-recovery`, {
    method: "GET",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to fetch exceptional recovery requests: ${res.status}`);
  }
  const data = await res.json();
  return data.requests || [];
}

export async function approveExceptionalRecoveryRequest(
  orgId: string,
  requestId: string
): Promise<{ success: boolean; target_email: string; expires_at: string; message: string }> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/exceptional-recovery/${requestId}/approve`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to approve recovery request: ${res.status}`);
  }
  return await res.json();
}

export async function rejectExceptionalRecoveryRequest(
  orgId: string,
  requestId: string
): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${apiBase()}/v1/organizations/${orgId}/exceptional-recovery/${requestId}/reject`, {
    method: "POST",
    headers: getCpHeaders({ "Content-Type": "application/json" }),
    credentials: "include",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Failed to reject recovery request: ${res.status}`);
  }
  return await res.json();
}

