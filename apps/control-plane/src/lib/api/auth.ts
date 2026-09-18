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
  orgRecoveryPk: string,
  wrappedOrgRecoverySk?: string,
  recoverySalt?: string
): Promise<{ id: string; email: string; org_id: string; org_name: string }> {
  const payload: Record<string, string> = {
    email: email.trim(),
    password: passwordVerifier,
    org_recovery_pk: orgRecoveryPk,
  };
  if (wrappedOrgRecoverySk) {
    payload.wrapped_org_recovery_sk = wrappedOrgRecoverySk;
  }
  if (recoverySalt) {
    payload.recovery_salt = recoverySalt;
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
  return (await res.json()) as { id: string; email: string; org_id: string; org_name: string };
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

export async function loginWithPasskey(data: {
  credential_id: string;
  challenge_token: string;
  signature: string;
  client_data_json: string;
}): Promise<AuthSessionResponse> {
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

export async function registerPasskey(data: {
  credential_id: string;
  public_key: string;
  device_name: string;
  challenge_token: string;
  aaguid?: string;
}): Promise<UserPasskey> {
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
