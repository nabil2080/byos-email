/**
 * Persistent Sessions V1 (Change 3)
 * Non-extractable AES-GCM CryptoKey stored in IndexedDB under byos_device_key_<userId>
 * Sealed mailbox keys stored in IndexedDB under byos_sealed_keys_<userId>
 * Persistent session token stored in localStorage under byos_persistent_token_<userId>
 */

export const DEVICE_KEYSTORE_DB = "byos_device_keystore";
export const DEVICE_KEYSTORE_VERSION = 1;
export const DEVICE_STORE_NAME = "device_keys";

export interface SealedKeysData {
  ivHex: string;
  ciphertextHex: string;
  createdAt: number;
}

export interface UnsealedSessionPayload {
  userId: string;
  mailboxId: string;
  mailboxSkHex: string;
  searchKeyHex?: string;
  signingSeedHex?: string;
  xwingSeedHex?: string;
  sessionToken: string;
  email: string;
  connectedAccounts?: any[];
}

export function getIDB(): IDBFactory | undefined {
  if (typeof indexedDB !== "undefined") return indexedDB;
  if (typeof globalThis !== "undefined" && (globalThis as any).indexedDB) {
    return (globalThis as any).indexedDB;
  }
  return undefined;
}

export function openDeviceKeyStore(): Promise<IDBDatabase> {
  const idb = getIDB();
  if (!idb) {
    return Promise.reject(new Error("IndexedDB is not supported in this environment"));
  }

  return new Promise((resolve, reject) => {
    const req = idb.open(DEVICE_KEYSTORE_DB, DEVICE_KEYSTORE_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DEVICE_STORE_NAME)) {
        db.createObjectStore(DEVICE_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open device keystore DB"));
  });
}

export async function storeInIDB(key: string, value: any): Promise<void> {
  const db = await openDeviceKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE_NAME, "readwrite");
    const store = tx.objectStore(DEVICE_STORE_NAME);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error(`Failed to store key ${key}`));
  });
}

export async function getFromIDB<T>(key: string): Promise<T | null> {
  const db = await openDeviceKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE_NAME, "readonly");
    const store = tx.objectStore(DEVICE_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error || new Error(`Failed to get key ${key}`));
  });
}

export async function deleteFromIDB(key: string): Promise<void> {
  const db = await openDeviceKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEVICE_STORE_NAME, "readwrite");
    const store = tx.objectStore(DEVICE_STORE_NAME);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error(`Failed to delete key ${key}`));
  });
}

/**
 * Generate a non-extractable AES-GCM 256-bit CryptoKey.
 * Setting extractable to false ensures the raw key bytes can never be exported or read by scripts.
 */
export async function generateDeviceKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false, // non-extractable!
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt the session keys payload using the device CryptoKey.
 */
export async function sealKeysWithDeviceKey(
  deviceKey: CryptoKey,
  payload: UnsealedSessionPayload
): Promise<SealedKeysData> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    deviceKey,
    plaintext
  );
  const ciphertextHex = Array.from(new Uint8Array(ciphertextBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ivHex = Array.from(iv)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    ivHex,
    ciphertextHex,
    createdAt: Date.now(),
  };
}

/**
 * Decrypt the sealed session keys using the device CryptoKey.
 */
export async function unsealKeysWithDeviceKey(
  deviceKey: CryptoKey,
  sealed: SealedKeysData
): Promise<UnsealedSessionPayload> {
  const iv = new Uint8Array(sealed.ivHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const ciphertext = new Uint8Array(sealed.ciphertextHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    deviceKey,
    ciphertext
  );
  const json = new TextDecoder().decode(plaintextBuffer);
  return JSON.parse(json) as UnsealedSessionPayload;
}

/**
 * Save persistent session for a user:
 * 1. Generate non-extractable device key
 * 2. Seal keys with device key
 * 3. Store device key under `byos_device_key_<userId>` in IndexedDB
 * 4. Store sealed keys under `byos_sealed_keys_<userId>` in IndexedDB
 * 5. Store 30-day token under `byos_persistent_token_<userId>` in localStorage
 * 6. Store `byos_persistent_user_id` in localStorage
 */
export async function savePersistentSession(payload: UnsealedSessionPayload): Promise<void> {
  const deviceKey = await generateDeviceKey();
  const sealed = await sealKeysWithDeviceKey(deviceKey, payload);

  await storeInIDB(`byos_device_key_${payload.userId}`, deviceKey);
  await storeInIDB(`byos_sealed_keys_${payload.userId}`, sealed);

  if (typeof localStorage !== "undefined") {
    localStorage.setItem(`byos_persistent_token_${payload.userId}`, payload.sessionToken);
    localStorage.setItem("byos_persistent_user_id", payload.userId);
  }
}

/**
 * Restore persistent session:
 * Reads localStorage persistent user ID and token, unseals keys via IndexedDB device key.
 */
export async function restorePersistentSession(): Promise<UnsealedSessionPayload | null> {
  if (typeof localStorage === "undefined") return null;
  const userId = localStorage.getItem("byos_persistent_user_id");
  if (!userId) return null;

  const token = localStorage.getItem(`byos_persistent_token_${userId}`);
  if (!token) return null;

  try {
    const deviceKey = await getFromIDB<CryptoKey>(`byos_device_key_${userId}`);
    if (!deviceKey) return null;

    const sealed = await getFromIDB<SealedKeysData>(`byos_sealed_keys_${userId}`);
    if (!sealed) return null;

    const unsealed = await unsealKeysWithDeviceKey(deviceKey, sealed);
    // Ensure token matches
    unsealed.sessionToken = token;

    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("byos_active_session_token", token);
      if (unsealed.mailboxId && unsealed.mailboxSkHex) {
        sessionStorage.setItem("byos_mailbox_sk_" + unsealed.mailboxId, unsealed.mailboxSkHex);
        sessionStorage.setItem("byos_mailbox_skey_" + unsealed.mailboxId, unsealed.searchKeyHex || "");
      }
      if (unsealed.mailboxId && unsealed.signingSeedHex) {
        sessionStorage.setItem("byos_signing_seed_" + unsealed.mailboxId, unsealed.signingSeedHex);
      }
      if (unsealed.mailboxId && unsealed.xwingSeedHex) {
        sessionStorage.setItem("byos_xwing_seed_" + unsealed.mailboxId, unsealed.xwingSeedHex);
      }
    }

    return unsealed;
  } catch (err) {
    console.warn("Failed restoring persistent session from IndexedDB:", err);
    return null;
  }
}

/**
 * Clear persistent session for a user or current persistent user.
 * Explicit logout must remove device key, sealed keys, and localStorage persistent token.
 */
export async function clearPersistentSession(userId?: string): Promise<void> {
  const targetUserId =
    userId ||
    (typeof localStorage !== "undefined" ? localStorage.getItem("byos_persistent_user_id") : null);

  if (targetUserId) {
    try {
      await deleteFromIDB(`byos_device_key_${targetUserId}`);
      await deleteFromIDB(`byos_sealed_keys_${targetUserId}`);
    } catch (e) {
      console.warn("Error deleting from device keystore:", e);
    }

    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(`byos_persistent_token_${targetUserId}`);
    }
  }

  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("byos_persistent_user_id");
  }
}
