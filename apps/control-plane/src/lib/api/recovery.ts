function apiBase(): string {
  return (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE || "";
}

export interface RecoveryEnrollResponse {
  id: string;
  recovery_enrolled: boolean;
}

export interface RecoveryChallenge {
  challenge_id: string;
  expires_at: string;
}

/**
 * Enroll a recovery verifier (Ed25519 public key derived from mnemonic entropy).
 * The server stores only the public key; the private key never leaves the browser.
 * recovery_auth_pk must be base64-encoded 32 bytes.
 */
export async function enrollRecovery(recoveryAuthPk: string): Promise<RecoveryEnrollResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/recovery-enroll`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ recovery_auth_pk: recoveryAuthPk }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Enroll failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as RecoveryEnrollResponse;
}

/**
 * Request a challenge for mnemonic-based recovery (pre-login).
 * Does not require authentication.
 */
export async function getRecoveryChallenge(email: string): Promise<RecoveryChallenge> {
  const res = await fetch(`${apiBase()}/v1/auth/recovery-challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Challenge failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as RecoveryChallenge;
}

export interface RecoveryVerifyResponse {
  id: string;
  email: string;
  org_id: string;
}

/**
 * Prove possession of the mnemonic-derived key by submitting an Ed25519
 * signature over the canonical challenge message. On success the server sets
 * the session cookie (account access restored; no mailbox keys involved).
 * Signature must be base64-encoded 64 bytes.
 */
export async function verifyRecovery(challengeId: string, signature: string): Promise<RecoveryVerifyResponse> {
  const res = await fetch(`${apiBase()}/v1/auth/recovery-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ challenge_id: challengeId, signature }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Recovery failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as RecoveryVerifyResponse;
}

/**
 * Set a new account password for the session owner (e.g. after recovery).
 * Authentication only — mailbox keys are untouched.
 */
export async function changePassword(newPassword: string): Promise<void> {
  const res = await fetch(`${apiBase()}/v1/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ new_password: newPassword }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(text || `Password change failed ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
}
