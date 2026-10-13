import {
  generateDeviceKey,
  sealKeysWithDeviceKey,
  unsealKeysWithDeviceKey,
  savePersistentSession,
  restorePersistentSession,
  clearPersistentSession,
  openDeviceKeyStore,
  UnsealedSessionPayload,
  DEVICE_KEYSTORE_DB,
  DEVICE_STORE_NAME,
} from "./persistent_session";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

function createMockRequest<T>(getResult: () => T): any {
  let successFn: any = null;
  let errorFn: any = null;
  const req: any = {
    result: undefined,
    error: null,
    get onsuccess() {
      return successFn;
    },
    set onsuccess(fn: any) {
      successFn = fn;
      if (fn) {
        Promise.resolve().then(() => {
          try {
            req.result = getResult();
            fn({ target: req });
          } catch (e) {
            req.error = e;
            if (errorFn) errorFn(e);
          }
        });
      }
    },
    get onerror() {
      return errorFn;
    },
    set onerror(fn: any) {
      errorFn = fn;
    },
  };
  return req;
}

class MockIDBStore {
  data = new Map<string, any>();
  get(key: string): any {
    return createMockRequest(() => this.data.get(key));
  }
  put(value: any, key: string): any {
    this.data.set(key, value);
    return createMockRequest(() => key);
  }
  delete(key: string): any {
    this.data.delete(key);
    return createMockRequest(() => undefined);
  }
}

class MockIDBDatabase {
  stores = new Map<string, MockIDBStore>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };
  createObjectStore(name: string) {
    const s = new MockIDBStore();
    this.stores.set(name, s);
    return s;
  }
  transaction(storeName: string, mode: string) {
    let s = this.stores.get(storeName);
    if (!s) {
      s = new MockIDBStore();
      this.stores.set(storeName, s);
    }
    return {
      objectStore: () => s,
    };
  }
}

class MockIDBFactory {
  databases = new Map<string, MockIDBDatabase>();
  open(name: string, version?: number): any {
    return createMockRequest(() => {
      let db = this.databases.get(name);
      if (!db) {
        db = new MockIDBDatabase();
        this.databases.set(name, db);
      }
      return db;
    });
  }
}

class MockLocalStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

export async function runPersistentSessionTests() {
  console.log("Running Persistent Session Tests...");
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  // Test 1: Device key generation is non-extractable
  await test("1. Device key is non-extractable AES-GCM 256-bit", async () => {
    const key = await generateDeviceKey();
    assert(key.type === "secret", "Key should be a secret key");
    assert((key.algorithm as any).name === "AES-GCM", "Key algorithm must be AES-GCM");
    assert((key.algorithm as any).length === 256, "Key length must be 256-bit");
    assert(key.extractable === false, "Key MUST NOT be extractable");

    // Attempting to export must throw
    let exportFailed = false;
    try {
      await crypto.subtle.exportKey("raw", key);
    } catch (err: any) {
      exportFailed = true;
    }
    assert(exportFailed, "crypto.subtle.exportKey must fail on non-extractable device key");
  });

  // Test 2: Key sealing & unsealing roundtrip
  await test("2. Key sealing and unsealing roundtrip preserves all sensitive fields", async () => {
    const key = await generateDeviceKey();
    const payload: UnsealedSessionPayload = {
      userId: "user-1234",
      mailboxId: "box-5678",
      mailboxSkHex: "deadbeef0102030405060708090a0b0c",
      searchKeyHex: "cafebebe0102030405060708090a0b0c",
      signingSeedHex: "11223344556677889900aabbccddeeff",
      xwingSeedHex: "ffeeddccbbaa00998877665544332211",
      sessionToken: "session-token-xyz-30-days",
      email: "alice@byos.local",
    };

    const sealed = await sealKeysWithDeviceKey(key, payload);
    assert(typeof sealed.ivHex === "string" && sealed.ivHex.length === 24, "IV must be 12 bytes hex (24 chars)");
    assert(typeof sealed.ciphertextHex === "string" && sealed.ciphertextHex.length > 0, "Ciphertext must be non-empty hex");

    const unsealed = await unsealKeysWithDeviceKey(key, sealed);
    assert(unsealed.userId === payload.userId, "userId must match");
    assert(unsealed.mailboxId === payload.mailboxId, "mailboxId must match");
    assert(unsealed.mailboxSkHex === payload.mailboxSkHex, "mailboxSkHex must match");
    assert(unsealed.searchKeyHex === payload.searchKeyHex, "searchKeyHex must match");
    assert(unsealed.signingSeedHex === payload.signingSeedHex, "signingSeedHex must match");
    assert(unsealed.xwingSeedHex === payload.xwingSeedHex, "xwingSeedHex must match");
    assert(unsealed.sessionToken === payload.sessionToken, "sessionToken must match");
    assert(unsealed.email === payload.email, "email must match");
  });

  // Test 3: Tampering with ciphertext causes unseal to fail
  await test("3. Tampered ciphertext rejects decryption", async () => {
    const key = await generateDeviceKey();
    const payload: UnsealedSessionPayload = {
      userId: "u1",
      mailboxId: "m1",
      mailboxSkHex: "11223344",
      sessionToken: "tok",
      email: "a@b.com",
    };
    const sealed = await sealKeysWithDeviceKey(key, payload);

    // Tamper ciphertext
    const tampered = {
      ...sealed,
      ciphertextHex: (sealed.ciphertextHex.startsWith("aa") ? "bb" : "aa") + sealed.ciphertextHex.substring(2),
    };

    let failedDecrypt = false;
    try {
      await unsealKeysWithDeviceKey(key, tampered);
    } catch {
      failedDecrypt = true;
    }
    assert(failedDecrypt, "Decryption must fail when ciphertext is modified");
  });

  // Test 4: End-to-end persistent session save, restore, and clear
  await test("4. Full lifecycle: savePersistentSession, restorePersistentSession, clearPersistentSession", async () => {
    const prevIDB = (globalThis as any).indexedDB;
    const prevStorage = (globalThis as any).localStorage;

    const mockIDB = new MockIDBFactory();
    const mockStorage = new MockLocalStorage();
    (globalThis as any).indexedDB = mockIDB;
    (globalThis as any).localStorage = mockStorage;

    try {
      const payload: UnsealedSessionPayload = {
        userId: "user-persistent-99",
        mailboxId: "mailbox-persistent-99",
        mailboxSkHex: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
        searchKeyHex: "f9e8d7c6b5a439281706f5e4d3c2b1a0",
        signingSeedHex: "1234567890abcdef1234567890abcdef",
        xwingSeedHex: "abcdef1234567890abcdef1234567890",
        sessionToken: "persisted-session-token-30-days",
        email: "persistent@byos.local",
      };

      // Save
      await savePersistentSession(payload);

      // Verify localStorage entries
      assert(mockStorage.getItem("byos_persistent_user_id") === payload.userId, "byos_persistent_user_id must be stored");
      const rawStored = mockStorage.getItem(`byos_persistent_token_${payload.userId}`);
      assert(rawStored !== null, "Persistent token must be stored");
      const parsedStored = JSON.parse(rawStored!);
      assert(parsedStored.token === payload.sessionToken, "Persistent token must match payload");
      assert(typeof parsedStored.expiresAt === "number" && parsedStored.expiresAt > Date.now(), "Token must have future expiresAt");

      // Restore
      const restored = await restorePersistentSession();
      assert(restored !== null, "Persistent session should restore");
      assert(restored!.userId === payload.userId, "Restored userId matches");
      assert(restored!.mailboxSkHex === payload.mailboxSkHex, "Restored mailboxSkHex matches");
      assert(restored!.searchKeyHex === payload.searchKeyHex, "Restored searchKeyHex matches");
      assert(restored!.sessionToken === payload.sessionToken, "Restored sessionToken matches");

      // Clear
      await clearPersistentSession(payload.userId);

      // Verify cleanup
      assert(mockStorage.getItem("byos_persistent_user_id") === null, "byos_persistent_user_id must be cleared");
      assert(mockStorage.getItem(`byos_persistent_token_${payload.userId}`) === null, "Persistent token must be cleared");

      const restoredAfterClear = await restorePersistentSession();
      assert(restoredAfterClear === null, "Restoration after clear must return null");
    } finally {
      (globalThis as any).indexedDB = prevIDB;
      (globalThis as any).localStorage = prevStorage;
    }
  });

  // Test 5: Expired persistent token rejects restoration and cleans up storage
  await test("5. Expired token rejects restoration and purges storage", async () => {
    const prevIDB = (globalThis as any).indexedDB;
    const prevStorage = (globalThis as any).localStorage;

    const mockIDB = new MockIDBFactory();
    const mockStorage = new MockLocalStorage();
    (globalThis as any).indexedDB = mockIDB;
    (globalThis as any).localStorage = mockStorage;

    try {
      const payload: UnsealedSessionPayload = {
        userId: "user-expired-11",
        mailboxId: "mailbox-expired-11",
        mailboxSkHex: "deadbeefcafebabe1122334455667788",
        sessionToken: "expired-test-token",
        email: "expired@byos.local",
      };

      await savePersistentSession(payload);

      // Overwrite token with expired timestamp
      mockStorage.setItem(
        `byos_persistent_token_${payload.userId}`,
        JSON.stringify({ token: payload.sessionToken, expiresAt: Date.now() - 5000 })
      );

      // Attempt restore
      const restored = await restorePersistentSession();
      assert(restored === null, "Expired persistent token must reject restoration");

      // Verify automatic cleanup
      assert(mockStorage.getItem("byos_persistent_user_id") === null, "User ID must be purged on expired restore");
      assert(mockStorage.getItem(`byos_persistent_token_${payload.userId}`) === null, "Token must be purged on expired restore");
    } finally {
      (globalThis as any).indexedDB = prevIDB;
      (globalThis as any).localStorage = prevStorage;
    }
  });

  // Test 6: Server rejection (e.g. 401 revoked) rejects restoration and purges storage
  await test("6. Server rejection (401 revoked) rejects restoration and purges storage", async () => {
    const prevIDB = (globalThis as any).indexedDB;
    const prevStorage = (globalThis as any).localStorage;
    const prevFetch = (globalThis as any).fetch;
    const prevWindow = (globalThis as any).window;

    const mockIDB = new MockIDBFactory();
    const mockStorage = new MockLocalStorage();
    (globalThis as any).indexedDB = mockIDB;
    (globalThis as any).localStorage = mockStorage;
    (globalThis as any).window = {
      location: { origin: "http://127.0.0.1:3001", href: "http://127.0.0.1:3001/" },
    };
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    try {
      const payload: UnsealedSessionPayload = {
        userId: "user-revoked-22",
        mailboxId: "mailbox-revoked-22",
        mailboxSkHex: "1122334455667788deadbeefcafebabe",
        sessionToken: "server-revoked-token",
        email: "revoked@byos.local",
      };

      await savePersistentSession(payload);

      // Attempt restore with server returning 401
      const restored = await restorePersistentSession();
      assert(restored === null, "Server-rejected persistent session must return null");

      // Verify automatic cleanup
      assert(mockStorage.getItem("byos_persistent_user_id") === null, "User ID must be purged on server rejection");
      assert(mockStorage.getItem(`byos_persistent_token_${payload.userId}`) === null, "Token must be purged on server rejection");
    } finally {
      (globalThis as any).indexedDB = prevIDB;
      (globalThis as any).localStorage = prevStorage;
      (globalThis as any).fetch = prevFetch;
      (globalThis as any).window = prevWindow;
    }
  });

  console.log(`PERSISTENT SESSION TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
