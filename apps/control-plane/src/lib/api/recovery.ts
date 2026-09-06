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
