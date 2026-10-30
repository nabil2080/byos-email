import {
  enqueueOfflineAction,
  getOfflineQueue,
  syncOfflineQueue,
  clearOfflineQueue,
  OfflineActionType,
  OfflineQueuedAction,
} from "./components/calendar/offline/calendarOfflineSync";
import {
  moveEventToTrash,
  getTrashEvents,
  restoreEventFromTrash,
  emptyTrash,
  TrashEventRecord,
} from "./components/calendar/trash/calendarTrashStore";
import {
  saveTask,
  getTasks,
  toggleTaskComplete,
  deleteTask,
} from "./components/calendar/tasks/taskStore";
import {
  normalizeCalendarUrl,
  isValidCalendarUrl,
  fetchAndParseUrlFeed,
} from "./components/calendar/url/urlCalendarStore";
import { DecryptedEventRecord } from "./components/calendar/CalendarSidebar";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error("Assertion failed: " + msg);
  }
}

// In-memory mock localStorage for Node test runner
const memoryStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => (k in memoryStorage ? memoryStorage[k] : null),
  setItem: (k: string, v: string) => {
    memoryStorage[k] = String(v);
  },
  removeItem: (k: string) => {
    delete memoryStorage[k];
  },
  clear: () => {
    for (const k of Object.keys(memoryStorage)) delete memoryStorage[k];
  },
};

export async function runCalendarTrack3Tests(): Promise<{ passed: number; failed: number }> {
  // Ensure mock localStorage and window are available in Node environment
  const originalLocalStorage = (globalThis as any).localStorage;
  const originalFetch = (globalThis as any).fetch;
  (globalThis as any).localStorage = mockLocalStorage;
  if (typeof (globalThis as any).window === "undefined") {
    (globalThis as any).window = globalThis;
  }

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      mockLocalStorage.clear();
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${name}:`, err.message);
      failed++;
    }
  }

  const mailboxId = "mbx-track3-test-1234";
  const dummyMailboxKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) dummyMailboxKey[i] = (i * 3 + 7) % 256;

  console.log("\nRunning Calendar Track 3 Verification Tests...");

  // ─────────────────────────────────────────────────────────────
  // 1. External Calendar Feed CORS Proxy & Fallback Tests
  // ─────────────────────────────────────────────────────────────
  await test("Track 3.1: External Calendar URL normalization converts webcal:// to https://", () => {
    assert(
      normalizeCalendarUrl("webcal://example.com/calendar.ics") === "https://example.com/calendar.ics",
      "webcal scheme converted to https"
    );
    assert(
      normalizeCalendarUrl("https://example.com/feed.ics") === "https://example.com/feed.ics",
      "https scheme untouched"
    );
    assert(
      isValidCalendarUrl("webcal://test.com/cal"),
      "webcal is valid calendar URL"
    );
  });

  await test("Track 3.2: URL feed fetcher routes through /v1/calendar/feed-proxy and falls back to direct fetch", async () => {
    let proxyCalled = false;
    let directCalled = false;

    const sampleIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BYOS Test//EN",
      "X-WR-CALNAME:Subscribed Team Feed",
      "BEGIN:VEVENT",
      "UID:evt-proxy-1",
      "SUMMARY:Proxy Fetched Architecture Review",
      "DTSTART:20261105T100000Z",
      "DTEND:20261105T110000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    // Case A: Proxy succeeds
    (globalThis as any).fetch = async (url: string, init?: any) => {
      if (url.includes("/v1/calendar/feed-proxy")) {
        proxyCalled = true;
        return {
          ok: true,
          status: 200,
          text: async () => sampleIcs,
        } as Response;
      }
      return {
        ok: false,
        status: 404,
      } as Response;
    };

    const res1 = await fetchAndParseUrlFeed("https://external.local/calendar.ics");
    assert(proxyCalled, "Feed fetcher queried /v1/calendar/feed-proxy endpoint");
    assert(res1.events.length === 1, "Parsed 1 event from proxy response");
    assert(res1.events[0].summary === "Proxy Fetched Architecture Review", "Event summary matches");

    // Case B: Proxy fails -> falls back to direct fetch
    proxyCalled = false;
    (globalThis as any).fetch = async (url: string) => {
      if (url.includes("/v1/calendar/feed-proxy")) {
        proxyCalled = true;
        // Simulate proxy failure (e.g. proxy unreachable or 502)
        return {
          ok: false,
          status: 502,
          statusText: "Bad Gateway",
        } as Response;
      }
      directCalled = true;
      return {
        ok: true,
        status: 200,
        text: async () => sampleIcs,
      } as Response;
    };

    const res2 = await fetchAndParseUrlFeed("https://external.local/calendar.ics");
    assert(proxyCalled, "Proxy was attempted first");
    assert(directCalled, "Fallback to direct fetch succeeded when proxy returned non-200");
    assert(res2.events.length === 1, "Parsed event via direct fallback");
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Offline Recurring Event Exception Sync Tests
  // ─────────────────────────────────────────────────────────────
  await test("Track 3.3: OfflineActionType supports create_exception, update_exception, delete_exception", () => {
    clearOfflineQueue(mailboxId);

    // Queue create_exception
    const item1 = enqueueOfflineAction(mailboxId, {
      actionType: "create_exception",
      calendarId: "cal-1",
      eventId: "parent-event-1",
      payload: {
        recurrence_id: "2026-11-10T09:00:00Z",
        is_cancelled: false,
        start_time: "2026-11-10T10:00:00Z",
        end_time: "2026-11-10T11:00:00Z",
        encrypted_payload: "ciphertext-1",
      },
    });
    assert(item1.actionType === "create_exception", "ActionType is create_exception");
    assert(item1.syncStatus === "queued_locally", "Status is queued_locally");

    // Queue update_exception
    const item2 = enqueueOfflineAction(mailboxId, {
      actionType: "update_exception",
      calendarId: "cal-1",
      eventId: "parent-event-1",
      exceptionId: "ex-existing-1",
      payload: {
        exceptionId: "ex-existing-1",
        start_time: "2026-11-10T11:00:00Z",
        end_time: "2026-11-10T12:00:00Z",
        encrypted_payload: "ciphertext-2",
      },
    });
    assert(item2.actionType === "update_exception", "ActionType is update_exception");
    assert(item2.exceptionId === "ex-existing-1", "exceptionId is preserved on queued action");

    // Queue delete_exception
    const item3 = enqueueOfflineAction(mailboxId, {
      actionType: "delete_exception",
      calendarId: "cal-1",
      eventId: "parent-event-1",
      exceptionId: "ex-existing-1",
      payload: { exceptionId: "ex-existing-1" },
    });
    assert(item3.actionType === "delete_exception", "ActionType is delete_exception");

    const queue = getOfflineQueue(mailboxId);
    assert(queue.length === 3, "Queue contains all 3 queued exception actions");
  });

  await test("Track 3.4: syncOfflineQueue replays recurrence exception actions and clears queue", async () => {
    clearOfflineQueue(mailboxId);

    enqueueOfflineAction(mailboxId, {
      actionType: "create_exception",
      calendarId: "cal-1",
      eventId: "parent-event-1",
      payload: {
        recurrence_id: "2026-11-10T09:00:00Z",
        is_cancelled: true,
        encrypted_payload: "enc-cancel",
      },
    });

    enqueueOfflineAction(mailboxId, {
      actionType: "update_exception",
      calendarId: "cal-1",
      eventId: "parent-event-1",
      exceptionId: "ex-id-2",
      payload: {
        exceptionId: "ex-id-2",
        start_time: "2026-11-11T14:00:00Z",
        end_time: "2026-11-11T15:00:00Z",
        encrypted_payload: "enc-mod",
      },
    });

    enqueueOfflineAction(mailboxId, {
      actionType: "delete_exception",
      calendarId: "cal-1",
      eventId: "parent-event-1",
      exceptionId: "ex-id-3",
      payload: { exceptionId: "ex-id-3" },
    });

    const createCalls: any[] = [];
    const updateCalls: any[] = [];
    const deleteCalls: any[] = [];

    const syncResult = await syncOfflineQueue(mailboxId, {
      createExceptionFn: async (mId, eId, payload) => {
        createCalls.push({ mId, eId, payload });
        return { id: "ex-created", parent_event_id: eId, ...payload };
      },
      updateExceptionFn: async (mId, eId, exId, payload) => {
        updateCalls.push({ mId, eId, exId, payload });
        return { id: exId, parent_event_id: eId, ...payload };
      },
      deleteExceptionFn: async (mId, eId, exId) => {
        deleteCalls.push({ mId, eId, exId });
      },
    });

    assert(syncResult.synced === 3, `Expected 3 synced actions, got ${syncResult.synced}`);
    assert(syncResult.conflicts === 0, "No conflicts");
    assert(syncResult.errors === 0, "No errors");
    assert(syncResult.remaining === 0, "Queue completely emptied");

    assert(createCalls.length === 1, "createExceptionFn called once");
    assert(createCalls[0].payload.is_cancelled === true, "createExceptionFn called with cancelled payload");

    assert(updateCalls.length === 1, "updateExceptionFn called once");
    assert(updateCalls[0].exId === "ex-id-2", "updateExceptionFn received correct exceptionId");

    assert(deleteCalls.length === 1, "deleteExceptionFn called once");
    assert(deleteCalls[0].exId === "ex-id-3", "deleteExceptionFn received correct exceptionId");

    assert(getOfflineQueue(mailboxId).length === 0, "Persistent queue has 0 remaining items");
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Encrypted Calendar Trash Storage Tests
  // ─────────────────────────────────────────────────────────────
  await test("Track 3.5: moveEventToTrash encrypts details with AES-GCM and eliminates plaintext leakage in localStorage", () => {
    emptyTrash(mailboxId);

    const secretTitle = "Super Secret Zero-Knowledge Strategy";
    const secretDescription = "Unreleased cryptographic protocol blueprint and keys";
    const secretLocation = "Secure Vault Room 42";

    const dummyEvent: DecryptedEventRecord = {
      id: "ev-secret-trash-1",
      calendarId: "cal-personal",
      startTime: new Date("2026-11-20T10:00:00Z"),
      endTime: new Date("2026-11-20T11:00:00Z"),
      isAllDay: false,
      details: {
        title: secretTitle,
        description: secretDescription,
        location: secretLocation,
        timezone: "America/New_York",
      },
    };

    const record = moveEventToTrash(mailboxId, dummyEvent, "Classified Calendar", dummyMailboxKey);
    assert(Boolean(record.trashId), "Assigned unique trash ID");

    // Inspect the raw localStorage string to verify ZERO plaintext leakage
    const rawStorageKey = "byos_calendar_trash_" + mailboxId;
    const rawStorage = mockLocalStorage.getItem(rawStorageKey);
    assert(Boolean(rawStorage), "Trash key exists in localStorage");

    assert(!rawStorage!.includes(secretTitle), "Raw localStorage MUST NOT contain plaintext title");
    assert(!rawStorage!.includes(secretDescription), "Raw localStorage MUST NOT contain plaintext description");
    assert(!rawStorage!.includes(secretLocation), "Raw localStorage MUST NOT contain plaintext location");
    assert(rawStorage!.includes("encryptedDetails"), "Raw localStorage contains encryptedDetails envelope");

    // Decrypt using getTrashEvents with correct key
    const loaded = getTrashEvents(mailboxId, dummyMailboxKey);
    assert(loaded.length === 1, "1 event loaded from trash");
    assert(loaded[0].event.details.title === secretTitle, "Decrypted title matches original");
    assert(loaded[0].event.details.description === secretDescription, "Decrypted description matches original");
    assert(loaded[0].event.details.location === secretLocation, "Decrypted location matches original");

    // Key required: without key, details are masked
    const loadedWithoutKey = getTrashEvents(mailboxId, null);
    assert(loadedWithoutKey.length === 1, "Event still listed in trash");
    assert(
      loadedWithoutKey[0].event.details.title.includes("Key Required") || loadedWithoutKey[0].event.details.title.includes("Encrypted"),
      "Title is masked when key is not provided"
    );

    // Restore from trash returns unmasked decrypted record
    const restored = restoreEventFromTrash(mailboxId, record.trashId, dummyMailboxKey);
    assert(Boolean(restored), "Event successfully restored");
    assert(restored!.event.details.title === secretTitle, "Restored event details decrypted");
    assert(getTrashEvents(mailboxId, dummyMailboxKey).length === 0, "Item removed from trash after restore");
  });

  await test("Track 3.6: Calendar trash supports legacy unencrypted fallback", () => {
    emptyTrash(mailboxId);

    // Seed legacy unencrypted trash record directly into storage
    const rawKey = "byos_calendar_trash_" + mailboxId;
    const legacyRecord = {
      trashId: "trash-legacy-1",
      originalEventId: "ev-legacy-1",
      mailboxId,
      calendarId: "cal-legacy",
      calendarName: "Legacy",
      deletedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      event: {
        id: "ev-legacy-1",
        calendarId: "cal-legacy",
        startTime: new Date("2026-11-20T10:00:00Z").toISOString(),
        endTime: new Date("2026-11-20T11:00:00Z").toISOString(),
        isAllDay: false,
        details: {
          title: "Legacy Plaintext Meeting",
          description: "Old format record",
        },
      },
    };

    mockLocalStorage.setItem(rawKey, JSON.stringify([legacyRecord]));

    // Read back with getTrashEvents
    const items = getTrashEvents(mailboxId, dummyMailboxKey);
    assert(items.length === 1, "Loaded legacy item");
    assert(items[0].event.details.title === "Legacy Plaintext Meeting", "Legacy title preserved intact");
    assert(items[0].event.details.description === "Old format record", "Legacy description preserved intact");
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Encrypted Tasks Storage Tests
  // ─────────────────────────────────────────────────────────────
  await test("Track 3.7: saveTask encrypts task title and description with AES-GCM when key is available", () => {
    const taskTitle = "Audit Post-Quantum X-Wing Envelopes";
    const taskDesc = "Verify Section 12 ML-KEM-768 ciphertext validation and zero-knowledge storage";

    const task = saveTask(
      mailboxId,
      {
        listId: "list-1",
        title: taskTitle,
        description: taskDesc,
        priority: "high",
        completed: false,
      },
      dummyMailboxKey
    );

    assert(Boolean(task.id), "Task assigned ID");
    assert(task.title === taskTitle, "Returned task in memory has clear title");
    assert(task.description === taskDesc, "Returned task in memory has clear description");
    assert(Boolean(task.encryptedTitle), "Task item has encryptedTitle envelope");
    assert(Boolean(task.encryptedDescription), "Task item has encryptedDescription envelope");

    // Inspect raw localStorage under byos_calendar_tasks_<mailboxId>
    const rawKey = "byos_calendar_tasks_" + mailboxId;
    const rawTasks = mockLocalStorage.getItem(rawKey);
    assert(Boolean(rawTasks), "Tasks key exists in storage");

    assert(!rawTasks!.includes(taskTitle), "Raw storage MUST NOT contain plaintext task title");
    assert(!rawTasks!.includes(taskDesc), "Raw storage MUST NOT contain plaintext task description");
    assert(rawTasks!.includes("encryptedTitle"), "Raw storage contains encryptedTitle property");

    // Decrypt via getTasks with active key
    const loadedTasks = getTasks(mailboxId, dummyMailboxKey);
    assert(loadedTasks.length === 1, "Loaded 1 task");
    assert(loadedTasks[0].title === taskTitle, "Loaded task title decrypted correctly");
    assert(loadedTasks[0].description === taskDesc, "Loaded task description decrypted correctly");

    // Toggle complete preserves encryption
    const toggled = toggleTaskComplete(mailboxId, task.id, dummyMailboxKey);
    assert(toggled.completed === true, "Task marked complete");
    assert(Boolean(toggled.encryptedTitle), "Encrypted title preserved after toggle");

    // Delete task
    deleteTask(mailboxId, task.id, dummyMailboxKey);
    assert(getTasks(mailboxId, dummyMailboxKey).length === 0, "Task deleted from store");
  });

  await test("Track 3.8: taskStore supports legacy unencrypted fallback", () => {
    // When saveTask is called without any key, it stores plaintext as legacy fallback
    const legacyTask = saveTask(
      mailboxId,
      {
        listId: "list-1",
        title: "Legacy Plaintext Reminder",
        description: "Public task note",
        priority: "low",
        completed: false,
      },
      null
    );

    assert(legacyTask.encryptedTitle === undefined, "No encryptedTitle on legacy task");

    const loaded = getTasks(mailboxId, null);
    assert(loaded.length === 1, "Loaded 1 legacy task");
    assert(loaded[0].title === "Legacy Plaintext Reminder", "Legacy title preserved");
    assert(loaded[0].description === "Public task note", "Legacy description preserved");
  });

  // Cleanup
  (globalThis as any).localStorage = originalLocalStorage;
  (globalThis as any).fetch = originalFetch;

  console.log(`\nCALENDAR TRACK 3 TESTS: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
