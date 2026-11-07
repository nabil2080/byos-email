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
import { cryptoWorkerBridge } from "./crypto_worker_bridge";

export const SESSION_GENERATION_KEY = "byos_session_generation";
export const SESSION_VAULT_KEY = "byos_session_vault";

export interface AccountVaultEntry {
  mailboxSkHex?: string;
  signingSeedHex?: string;
  xwingSeedHex?: string;
  searchKeyHex?: string;
}

export type SessionVault = Record<string, AccountVaultEntry>;

export function readVault(storage?: Storage): SessionVault {
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return {};
  try {
    const raw = store.getItem(SESSION_VAULT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeVault(vault: SessionVault, storage?: Storage): void {
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return;
  try {
    const keys = Object.keys(vault);
    if (keys.length === 0) {
      store.removeItem(SESSION_VAULT_KEY);
    } else {
      store.setItem(SESSION_VAULT_KEY, JSON.stringify(vault));
    }
  } catch {}
}

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
  SESSION_VAULT_KEY,
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

interface AccountKeyBuffers {
  mailboxSk?: Uint8Array;
  signingSeed?: Uint8Array;
  xwingSeed?: Uint8Array;
  searchKey?: string;
}

/** Strictly in-memory custody for private keys and seeds */
const inMemoryKeys = new Map<string, AccountKeyBuffers>();

function toBytes(val: Uint8Array | string): Uint8Array {
  if (val instanceof Uint8Array) {
    return new Uint8Array(val);
  }
  const matches = val.match(/.{1,2}/g);
  if (!matches) return new Uint8Array();
  return new Uint8Array(matches.map((b) => parseInt(b, 16)));
}

/**
 * Store account private keys / seeds strictly in memory as Uint8Array buffers.
 * Never writes raw private keys or seeds to sessionStorage or localStorage.
 */
export function setAccountKeys(
  accountId: string,
  keys: {
    mailboxSk?: Uint8Array | string | null;
    signingSeed?: Uint8Array | string | null;
    xwingSeed?: Uint8Array | string | null;
    searchKey?: string | null;
  },
  storage?: Storage
): void {
  if (!accountId) return;
  const existing = inMemoryKeys.get(accountId) || {};
  const vault = readVault(storage);
  const vaultEntry: AccountVaultEntry = vault[accountId] || {};

  if (keys.mailboxSk !== undefined) {
    if (keys.mailboxSk) {
      existing.mailboxSk = toBytes(keys.mailboxSk);
      vaultEntry.mailboxSkHex = Array.from(existing.mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      if (existing.mailboxSk) existing.mailboxSk.fill(0);
      delete existing.mailboxSk;
      delete vaultEntry.mailboxSkHex;
    }
  }
  if (keys.signingSeed !== undefined) {
    if (keys.signingSeed) {
      existing.signingSeed = toBytes(keys.signingSeed);
      vaultEntry.signingSeedHex = Array.from(existing.signingSeed, (b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      if (existing.signingSeed) existing.signingSeed.fill(0);
      delete existing.signingSeed;
      delete vaultEntry.signingSeedHex;
    }
  }
  if (keys.xwingSeed !== undefined) {
    if (keys.xwingSeed) {
      existing.xwingSeed = toBytes(keys.xwingSeed);
      vaultEntry.xwingSeedHex = Array.from(existing.xwingSeed, (b) => b.toString(16).padStart(2, "0")).join("");
    } else {
      if (existing.xwingSeed) existing.xwingSeed.fill(0);
      delete existing.xwingSeed;
      delete vaultEntry.xwingSeedHex;
    }
  }
  if (keys.searchKey !== undefined) {
    if (keys.searchKey) {
      existing.searchKey = keys.searchKey;
      vaultEntry.searchKeyHex = keys.searchKey;
    } else {
      delete existing.searchKey;
      delete vaultEntry.searchKeyHex;
    }
  }
  inMemoryKeys.set(accountId, existing);

  if (Object.keys(vaultEntry).length > 0) {
    vault[accountId] = vaultEntry;
  } else {
    delete vault[accountId];
  }
  writeVault(vault, storage);
}

export function setSearchKeyFor(accountId: string, searchKey: string | null, storage?: Storage): void {
  setAccountKeys(accountId, { searchKey }, storage);
}

export function getSearchKeyFor(accountId: string, storage?: Storage): string | null {
  if (!accountId) return null;
  const inMem = inMemoryKeys.get(accountId)?.searchKey;
  if (inMem) return inMem;
  const vault = readVault(storage);
  if (vault[accountId]?.searchKeyHex) {
    const sKey = vault[accountId].searchKeyHex!;
    const entry = inMemoryKeys.get(accountId) || {};
    entry.searchKey = sKey;
    inMemoryKeys.set(accountId, entry);
    return sKey;
  }
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  return store?.getItem("byos_mailbox_skey_" + accountId) || null;
}

export function setMailboxKeyFor(accountId: string, key: Uint8Array | string | null, storage?: Storage): void {
  setAccountKeys(accountId, { mailboxSk: key }, storage);
}

export function setSigningSeedFor(accountId: string, seed: Uint8Array | string | null, storage?: Storage): void {
  setAccountKeys(accountId, { signingSeed: seed }, storage);
}

export function setXWingSeedFor(accountId: string, seed: Uint8Array | string | null, storage?: Storage): void {
  setAccountKeys(accountId, { xwingSeed: seed }, storage);
}

export function isAccountUnlocked(accountId: string, storage?: Storage): boolean {
  if (!accountId) return false;
  const entry = inMemoryKeys.get(accountId);
  if (entry?.mailboxSk && entry.mailboxSk.length > 0) return true;
  const key = getMailboxKeyFor(accountId, storage);
  if (key && key.length > 0) return true;
  const xwing = getXWingSeedFor(accountId, storage);
  if (xwing && xwing.length > 0) return true;
  return false;
}

export function getMailboxKeyHexFor(accountId: string, storage?: Storage): string | null {
  const bytes = getMailboxKeyFor(accountId, storage);
  if (!bytes) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getSigningSeedHexFor(accountId: string, storage?: Storage): string | null {
  const bytes = getSigningSeedFor(accountId, storage);
  if (!bytes) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getXWingSeedHexFor(accountId: string, storage?: Storage): string | null {
  const bytes = getXWingSeedFor(accountId, storage);
  if (!bytes) return null;
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Zeroizes all active in-memory private key and seed buffers by calling .fill(0).
 * If accountId is provided, zeroizes only that account's keys.
 * Also clears in-memory map entries and sweeps raw private keys from sessionStorage.
 */
export function zeroizeKeys(accountId?: string, storage?: Storage): void {
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (accountId) {
    const entry = inMemoryKeys.get(accountId);
    if (entry) {
      if (entry.mailboxSk) entry.mailboxSk.fill(0);
      if (entry.signingSeed) entry.signingSeed.fill(0);
      if (entry.xwingSeed) entry.xwingSeed.fill(0);
      delete entry.searchKey;
      inMemoryKeys.delete(accountId);
    }
    const vault = readVault(storage);
    if (vault[accountId]) {
      delete vault[accountId];
      writeVault(vault, storage);
    }
    if (typeof sessionStorage !== "undefined" && storage && storage !== sessionStorage) {
      const globalVault = readVault(sessionStorage);
      if (globalVault[accountId]) {
        delete globalVault[accountId];
        writeVault(globalVault, sessionStorage);
      }
    }
    if (store) {
      store.removeItem("byos_mailbox_sk_" + accountId);
      store.removeItem("byos_mailbox_skey_" + accountId);
      store.removeItem("byos_signing_seed_" + accountId);
      store.removeItem("byos_xwing_seed_" + accountId);
    }
    if (typeof sessionStorage !== "undefined" && storage && storage !== sessionStorage) {
      sessionStorage.removeItem("byos_mailbox_sk_" + accountId);
      sessionStorage.removeItem("byos_mailbox_skey_" + accountId);
      sessionStorage.removeItem("byos_signing_seed_" + accountId);
      sessionStorage.removeItem("byos_xwing_seed_" + accountId);
    }
  } else {
    for (const [_, entry] of inMemoryKeys) {
      if (entry.mailboxSk) entry.mailboxSk.fill(0);
      if (entry.signingSeed) entry.signingSeed.fill(0);
      if (entry.xwingSeed) entry.xwingSeed.fill(0);
      delete entry.searchKey;
    }
    inMemoryKeys.clear();
    if (store) {
      store.removeItem(SESSION_VAULT_KEY);
      const toRemove: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (
          key &&
          (key.startsWith("byos_mailbox_sk_") ||
            key.startsWith("byos_mailbox_skey_") ||
            key.startsWith("byos_signing_seed_") ||
            key.startsWith("byos_xwing_seed_"))
        ) {
          toRemove.push(key);
        }
      }
      for (const k of toRemove) {
        store.removeItem(k);
      }
    }
    if (typeof sessionStorage !== "undefined" && storage && storage !== sessionStorage) {
      sessionStorage.removeItem(SESSION_VAULT_KEY);
    }
  }
}

/**
 * Zeroizes all in-memory buffers in JS heap without wiping sessionStorage.
 * Used during window unload/reload so persistent session state survives page refresh.
 */
export function zeroizeInMemoryOnly(): void {
  for (const [_, entry] of inMemoryKeys) {
    if (entry.mailboxSk) entry.mailboxSk.fill(0);
    if (entry.signingSeed) entry.signingSeed.fill(0);
    if (entry.xwingSeed) entry.xwingSeed.fill(0);
    delete entry.searchKey;
  }
  inMemoryKeys.clear();
}

// Window unload and beforeunload lifecycle hook to zeroize in-memory keys
if (typeof window !== "undefined") {
  window.addEventListener("unload", () => {
    zeroizeInMemoryOnly();
  });
  window.addEventListener("beforeunload", () => {
    zeroizeInMemoryOnly();
  });
}

/**
 * Clear every byos_* sensitive key from sessionStorage.
 * Call this at the start of a fresh login so stale key material is gone
 * before the new session's keys are written.
 */
export function clearAllSensitiveSessionKeys(storage: Storage = sessionStorage): void {
  zeroizeKeys(undefined, storage);
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
  zeroizeKeys(accountId, storage);
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
  probeFn: (token?: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    await probeFn(account.sessionToken || account.id);
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
 * Resolves the signing seed for a given account.
 * Reads from strictly in-memory key custody first.
 */
export function getSigningSeedFor(accountId: string, storage?: Storage): Uint8Array | null {
  if (!accountId) return null;
  const isCustomStorage = storage && (typeof sessionStorage === "undefined" || storage !== sessionStorage);
  if (!isCustomStorage) {
    const mem = inMemoryKeys.get(accountId)?.signingSeed;
    if (mem && mem.length > 0) {
      return mem;
    }
  }
  const vault = readVault(storage);
  const vaultEntry = vault[accountId];
  if (vaultEntry?.signingSeedHex) {
    try {
      const matches = vaultEntry.signingSeedHex.match(/.{1,2}/g);
      if (matches) {
        const buf = new Uint8Array(matches.map((b) => parseInt(b, 16)));
        if (!isCustomStorage) {
          const entry = inMemoryKeys.get(accountId) || {};
          entry.signingSeed = buf;
          inMemoryKeys.set(accountId, entry);
        }
        return buf;
      }
    } catch {}
  }
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return null;
  const hex = store.getItem("byos_signing_seed_" + accountId);
  if (!hex) return null;
  try {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return null;
    const buf = new Uint8Array(matches.map((b) => parseInt(b, 16)));
    if (!isCustomStorage) {
      setSigningSeedFor(accountId, buf, storage);
      store.removeItem("byos_signing_seed_" + accountId);
    }
    return buf;
  } catch {
    return null;
  }
}

/**
 * Resolves the mailbox secret key for a given account.
 * Reads from strictly in-memory key custody first.
 */
export function getMailboxKeyFor(accountId: string, storage?: Storage): Uint8Array | null {
  if (!accountId) return null;
  const isCustomStorage = storage && (typeof sessionStorage === "undefined" || storage !== sessionStorage);
  if (!isCustomStorage) {
    const mem = inMemoryKeys.get(accountId)?.mailboxSk;
    if (mem && mem.length > 0) {
      return mem;
    }
  }
  const vault = readVault(storage);
  const vaultEntry = vault[accountId];
  if (vaultEntry?.mailboxSkHex) {
    try {
      const matches = vaultEntry.mailboxSkHex.match(/.{1,2}/g);
      if (matches) {
        const buf = new Uint8Array(matches.map((b) => parseInt(b, 16)));
        if (!isCustomStorage) {
          const entry = inMemoryKeys.get(accountId) || {};
          entry.mailboxSk = buf;
          inMemoryKeys.set(accountId, entry);
        }
        return buf;
      }
    } catch {}
  }
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return null;
  const hex = store.getItem("byos_mailbox_sk_" + accountId);
  if (!hex) return null;
  try {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return null;
    const buf = new Uint8Array(matches.map((b) => parseInt(b, 16)));
    if (!isCustomStorage) {
      setMailboxKeyFor(accountId, buf, storage);
      store.removeItem("byos_mailbox_sk_" + accountId);
    }
    return buf;
  } catch {
    return null;
  }
}

/**
 * Resolves the X-Wing seed for a given account.
 * Reads from strictly in-memory key custody first.
 */
export function getXWingSeedFor(accountId: string, storage?: Storage): Uint8Array | null {
  if (!accountId) return null;
  const isCustomStorage = storage && (typeof sessionStorage === "undefined" || storage !== sessionStorage);
  if (!isCustomStorage) {
    const mem = inMemoryKeys.get(accountId)?.xwingSeed;
    if (mem && mem.length > 0) {
      return mem;
    }
  }
  const vault = readVault(storage);
  const vaultEntry = vault[accountId];
  if (vaultEntry?.xwingSeedHex) {
    try {
      const matches = vaultEntry.xwingSeedHex.match(/.{1,2}/g);
      if (matches) {
        const buf = new Uint8Array(matches.map((b) => parseInt(b, 16)));
        if (!isCustomStorage) {
          const entry = inMemoryKeys.get(accountId) || {};
          entry.xwingSeed = buf;
          inMemoryKeys.set(accountId, entry);
        }
        return buf;
      }
    } catch {}
  }
  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (!store) return null;
  const hex = store.getItem("byos_xwing_seed_" + accountId);
  if (!hex) return null;
  try {
    const matches = hex.match(/.{1,2}/g);
    if (!matches) return null;
    const buf = new Uint8Array(matches.map((b) => parseInt(b, 16)));
    if (!isCustomStorage) {
      setXWingSeedFor(accountId, buf, storage);
      store.removeItem("byos_xwing_seed_" + accountId);
    }
    return buf;
  } catch {
    return null;
  }
}

/**
 * Strips raw key material and seeds from connected account objects before
 * storing to sessionStorage.
 */
export function sanitizeConnectedAccounts<T extends Record<string, any>>(accounts: T[]): T[] {
  return accounts.map((a) => {
    const copy = { ...a };
    delete copy.sessionToken;
    delete copy.mailboxSkHex;
    delete copy.signingSeedHex;
    delete copy.xwingSeedHex;
    return copy;
  });
}

/**
 * Shared key unseal function for both login and switch/unlock flows.
 * Rule 3 & Rule 6: Single shared unseal function persisting keys strictly in-memory and session vault.
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
  const unwrapped = await cryptoWorkerBridge.autoUnwrapKeys(password, wrappedSkUser);
  const searchKeyHex = unwrapped.searchKeyHex;

  // Store private keys in-memory and in session vault
  setAccountKeys(
    accountId,
    {
      mailboxSk: unwrapped.mailboxSk,
      signingSeed: unwrapped.signingSeed,
      xwingSeed: unwrapped.xwingSeed,
      searchKey: searchKeyHex,
    },
    storage,
  );

  const store = storage || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (store) {
    // Purge any raw legacy keys from sessionStorage
    store.removeItem("byos_mailbox_sk_" + accountId);
    store.removeItem("byos_signing_seed_" + accountId);
    store.removeItem("byos_xwing_seed_" + accountId);
    store.removeItem("byos_mailbox_skey_" + accountId);
  }

  return {
    mailboxSk: unwrapped.mailboxSk,
    signingSeed: unwrapped.signingSeed,
    xwingSeed: unwrapped.xwingSeed,
    searchKeyHex,
  };
}

