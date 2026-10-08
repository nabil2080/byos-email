/**
 * session_isolation.ts
 *
 * Pure functions for session-generation-scoped storage.
 *
 * Problem being solved:
 *   `byos_connected_accounts` was written to localStorage and read back
 *   on every page load. Stale tokens from a prior login were restored to the
 *   sidebar with no server-side validation, causing 401 "unauthorized" errors
 *   on every API call.
 *
 * Design:
 *   - On fresh login: generate a new random session generation ID, clear all
 *     byos_* keys that don't match the new generation, write the new marker.
 *   - On startup: validate restored secondary accounts via a lightweight
 *     /v1/users/me/mailboxes probe before showing them in the sidebar.
 *   - On logout: clear all byos_* keys for the leaving account.
 *   - Tokens and keys always go to sessionStorage, not localStorage.
 *   - localStorage stores only the session generation marker and the
 *     stripped-key (no mailboxSkHex/sessionToken) account metadata so the
 *     sidebar can show avatars after a reload while validation runs.
 */

import { autoUnwrapKeys } from "./message_crypto";

export const SESSION_GENERATION_KEY = "byos_session_generation";

/** Generate a cryptographically random session generation ID. */
export function newSessionGeneration(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * All byos_* prefixes that hold sensitive per-account key material.
 * These must NEVER go to localStorage.
 */
const SENSITIVE_PREFIXES = [
  "byos_mailbox_sk_",
  "byos_mailbox_skey_",
  "byos_xwing_seed_",
  "byos_signing_seed_",
  "byos_keys_published_",
  "byos_signing_pubkey_published_",
  "byos_active_session_token",
  "byos_impersonation_token",
  "byos_pending_send",
];

/**
 * Clear every byos_* sensitive key from sessionStorage.
 * Call this at the start of a fresh login so stale key material is gone
 * before the new session's keys are written.
 */
export function clearAllSensitiveSessionKeys(storage: Storage = sessionStorage): void {
  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    if (SENSITIVE_PREFIXES.some((p) => key === p || key.startsWith(p))) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    storage.removeItem(key);
  }
}

/**
 * Clear all byos_* keys for a specific account (selective logout).
 */
export function clearAccountKeys(accountId: string, storage: Storage = sessionStorage): void {
  const perAccountPrefixes = [
    "byos_mailbox_sk_" + accountId,
    "byos_mailbox_skey_" + accountId,
    "byos_xwing_seed_" + accountId,
    "byos_signing_seed_" + accountId,
    "byos_signing_pubkey_published_" + accountId,
  ];
  // Also sweep the compound keys_published key (includes pubkey fingerprints)
  const toRemove: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    if (
      perAccountPrefixes.some((p) => key === p || key.startsWith(p)) ||
      key.startsWith("byos_keys_published_" + accountId)
    ) {
      toRemove.push(key);
    }
  }
  for (const key of toRemove) {
    storage.removeItem(key);
  }
}

/**
 * On fresh login: rotate the session generation, wipe everything from the
 * prior generation out of localStorage.
 *
 * Returns the new generation ID so the caller can namespace subsequent writes.
 */
export function rotateSessionGeneration(
  ls: Storage = localStorage,
  ss: Storage = sessionStorage,
): string {
  const gen = newSessionGeneration();
  // Clear the old connected-accounts list and generation marker from localStorage
  ls.removeItem("byos_connected_accounts");
  ls.removeItem(SESSION_GENERATION_KEY);
  // Clear all sensitive keys from sessionStorage (fresh session)
  clearAllSensitiveSessionKeys(ss);
  // Remove the stale sessionStorage account list too
  ss.removeItem("byos_connected_accounts");
  // Write the new generation marker to both stores
  ls.setItem(SESSION_GENERATION_KEY, gen);
  ss.setItem(SESSION_GENERATION_KEY, gen);
  return gen;
}

/**
 * Read the stored session generation.
 * Returns null if no generation is stored (first ever load or cleared).
 */
export function readSessionGeneration(
  ss: Storage = sessionStorage,
  ls: Storage = localStorage,
): string | null {
  return ss.getItem(SESSION_GENERATION_KEY) ?? ls.getItem(SESSION_GENERATION_KEY);
}

/**
 * Write the stripped (no token, no key material) account list to localStorage
 * for display purposes (avatars, email labels) while validation runs.
 *
 * NEVER write tokens or key material to localStorage.
 */
export function persistAccountListForDisplay(
  accounts: Array<{ id: string; email: string; displayName: string; role: string; privacyMode: string }>,
  ls: Storage = localStorage,
): void {
  const stripped = accounts.map((a) => ({
    id: a.id,
    email: a.email,
    displayName: a.displayName,
    role: a.role,
    privacyMode: a.privacyMode,
    // Intentionally no sessionToken, mailboxSkHex, searchKeyHex, xwingSeedHex
  }));
  try {
    ls.setItem("byos_connected_accounts", JSON.stringify(stripped));
  } catch {
    // Storage quota exceeded — silently ignore
  }
}

/**
 * Rule 5: Format a user-facing session expired error message naming the specific account.
 */
export function formatSessionExpiredError(email: string): string {
  return `Your session for ${email} has expired. Sign in again to continue.`;
}

/**
 * Validate an account's session token by calling a probe function (e.g. GET /v1/users/me/mailboxes or /v1/auth/me).
 * Returns false on 401/403 or missing token, true otherwise.
 */
export async function validateRestoredAccount(
  account: { id: string; email: string; sessionToken?: string },
  probeFn: (token: string) => Promise<unknown>,
): Promise<boolean> {
  if (!account.sessionToken) {
    return false;
  }
  try {
    await probeFn(account.sessionToken);
    return true;
  } catch (err: any) {
    const status = err?.status ?? err?.statusCode;
    if (status === 401 || status === 403) {
      return false;
    }
    // Network or server errors should not prematurely discard the account
    return true;
  }
}

/**
 * Remove a stale or expired account from memory and storage, cleaning up all keys.
 */
export function removeStaleAccount<T extends { id: string; email: string }>(
  accountId: string,
  accounts: T[],
  ss: Storage = sessionStorage,
  ls: Storage = localStorage,
): T[] {
  clearAccountKeys(accountId, ss);
  const remaining = accounts.filter((a) => a.id !== accountId);
  try {
    ss.setItem("byos_connected_accounts", JSON.stringify(remaining));
  } catch {}
  persistAccountListForDisplay(remaining as any, ls);
  return remaining;
}

/**
 * Resolves the signing seed for a given account from storage.
 * Rule 2 & Rule 6: Per-account lookup, never relying on a global signal.
 */
export function getSigningSeedFor(accountId: string, storage?: Storage): Uint8Array | null {
  if (!accountId) return null;
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return null;
  const hex = store.getItem("byos_signing_seed_" + accountId);
  if (!hex) return null;
  try {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return null;
    return new Uint8Array(matches.map((b) => parseInt(b, 16)));
  } catch {
    return null;
  }
}

/**
 * Resolves the mailbox secret key for a given account from storage.
 * Rule 2 & Rule 6: Per-account lookup, never relying on a global signal.
 */
export function getMailboxKeyFor(accountId: string, storage?: Storage): Uint8Array | null {
  if (!accountId) return null;
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return null;
  const hex = store.getItem("byos_mailbox_sk_" + accountId);
  if (!hex) return null;
  try {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return null;
    return new Uint8Array(matches.map((b) => parseInt(b, 16)));
  } catch {
    return null;
  }
}

/**
 * Resolves the X-Wing seed for a given account from storage.
 * Rule 2 & Rule 6: Per-account lookup, never relying on a global signal.
 */
export function getXWingSeedFor(accountId: string, storage?: Storage): Uint8Array | null {
  if (!accountId) return null;
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return null;
  const hex = store.getItem("byos_xwing_seed_" + accountId);
  if (!hex) return null;
  try {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return null;
    return new Uint8Array(matches.map((b) => parseInt(b, 16)));
  } catch {
    return null;
  }
}

/**
 * Shared key unseal function for both login and switch/unlock flows.
 * Rule 3 & Rule 6: Single shared unseal function persisting keys only in sessionStorage.
 */
export async function unsealAccountKeys(
  accountId: string,
  password: string,
  wrappedSkUser?: string,
  storage?: Storage,
): Promise<{
  mailboxSk: Uint8Array;
  signingSeed: Uint8Array | null;
  xwingSeed: Uint8Array | null;
  searchKeyHex: string;
}> {
  if (!wrappedSkUser) {
    throw new Error("Missing wrapped key material for account");
  }
  const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
  const unwrapped = autoUnwrapKeys(wasm, password, wrappedSkUser);

  const skBytes = unwrapped.mailboxSk;
  const skHex = Array.from(skBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const searchKeyHex = wasm.wasm_derive_search_key(skHex);

  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (store) {
    store.setItem("byos_mailbox_sk_" + accountId, skHex);
    store.setItem("byos_mailbox_skey_" + accountId, searchKeyHex);

    if (unwrapped.signingSeed) {
      const seedHex = Array.from(unwrapped.signingSeed, (b) => b.toString(16).padStart(2, "0")).join("");
      store.setItem("byos_signing_seed_" + accountId, seedHex);
    } else {
      store.removeItem("byos_signing_seed_" + accountId);
    }

    if (unwrapped.xwingSeed) {
      const xwingHex = Array.from(unwrapped.xwingSeed, (b) => b.toString(16).padStart(2, "0")).join("");
      store.setItem("byos_xwing_seed_" + accountId, xwingHex);
    } else {
      store.removeItem("byos_xwing_seed_" + accountId);
    }
  }

  return {
    mailboxSk: unwrapped.mailboxSk,
    signingSeed: unwrapped.signingSeed,
    xwingSeed: unwrapped.xwingSeed,
    searchKeyHex,
  };
}

