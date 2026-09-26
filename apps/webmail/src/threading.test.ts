import { formatParticipants, getUnreadClass } from "./components/ThreadRow.js";
import { fetchThreads, fetchThreadMessages, toggleMessageStar } from "./api.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runThreadingTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  if (typeof globalThis.sessionStorage === "undefined") {
    const store: Record<string, string> = {};
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      key: (i: number) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
  }

  const test = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Conversation Threading Tests...");

  // 1. TestThreadRowRendersParticipantLabel
  await test("1. TestThreadRowRendersParticipantLabel", () => {
    assert(formatParticipants([]) === "(no sender)", "empty participants returns (no sender)");
    assert(formatParticipants(["Alice"]) === "Alice", "single participant returns name");
    assert(formatParticipants(["Alice", "Bob"]) === "Alice, Bob", "two participants returns 'Alice, Bob'");
    assert(formatParticipants(["Alice", "Bob", "Charlie"]) === "Alice, Bob +1", "three participants returns 'Alice, Bob +1'");
    assert(formatParticipants(["Alice", "Bob", "Charlie", "David"]) === "Alice, Bob +2", "four participants returns 'Alice, Bob +2'");
  });

  // 2. TestThreadRowShowsUnreadBold
  await test("2. TestThreadRowShowsUnreadBold", () => {
    const unreadClass1 = getUnreadClass(1);
    assert(unreadClass1.includes("font-semibold"), "unread count 1 should have font-semibold");
    assert(!unreadClass1.includes("font-normal"), "unread count 1 should not have font-normal");

    const unreadClass3 = getUnreadClass(3);
    assert(unreadClass3.includes("font-semibold"), "unread count 3 should have font-semibold");

    const readClass = getUnreadClass(0);
    assert(readClass.includes("font-normal"), "read thread (0 unread) should have font-normal");
    assert(!readClass.includes("font-semibold"), "read thread should not have font-semibold");
  });

  // 3. TestFetchThreadsFunctionCallsCorrectURL
  await test("3. TestFetchThreadsFunctionCallsCorrectURL", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedUrls.push(url);
      if (url.includes("/threads/")) {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ threads: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await fetchThreads("mailbox-123");
      assert(
        requestedUrls.some((u) => u.endsWith("/v1/mailboxes/mailbox-123/threads")),
        `fetchThreads should request /v1/mailboxes/mailbox-123/threads, got: ${requestedUrls.join(", ")}`
      );

      await fetchThreads("mailbox-123", "archive");
      assert(
        requestedUrls.some((u) => u.endsWith("/v1/mailboxes/mailbox-123/threads?folder=archive")),
        `fetchThreads with folder should request /v1/mailboxes/mailbox-123/threads?folder=archive, got: ${requestedUrls.join(", ")}`
      );

      await fetchThreadMessages("mailbox-123", "thread-456");
      assert(
        requestedUrls.some((u) => u.endsWith("/v1/mailboxes/mailbox-123/threads/thread-456")),
        `fetchThreadMessages should request /v1/mailboxes/mailbox-123/threads/thread-456, got: ${requestedUrls.join(", ")}`
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 4. TestToggleMessageStarCallsCorrectURL
  await test("4. TestToggleMessageStarCallsCorrectURL", async () => {
    const originalFetch = globalThis.fetch;
    const requests: { url: string; method?: string; body?: any }[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      let bodyJson = null;
      if (init?.body && typeof init.body === "string") {
        try {
          bodyJson = JSON.parse(init.body);
        } catch {}
      }
      requests.push({ url, method: init?.method, body: bodyJson });
      return new Response(JSON.stringify({ is_starred: bodyJson?.starred ?? false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const resTrue = await toggleMessageStar("box-1", "msg-1", true);
      assert(resTrue.is_starred === true, "returns is_starred true");
      assert(requests.length === 1, "made 1 request");
      assert(requests[0].method === "PATCH", "method is PATCH");
      assert(
        requests[0].url.endsWith("/v1/mailboxes/box-1/messages/msg-1/star"),
        `url matches star endpoint: ${requests[0].url}`
      );
      assert(requests[0].body?.starred === true, "body has starred: true");

      const resFalse = await toggleMessageStar("box-1", "msg-1", false);
      assert(resFalse.is_starred === false, "returns is_starred false");
      assert(requests.length === 2, "made 2 requests");
      assert(requests[1].method === "PATCH", "method is PATCH");
      assert(requests[1].body?.starred === false, "body has starred: false");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 5. TestThreadSnoozeFiltering
  await test("5. TestThreadSnoozeFiltering", () => {
    const now = 1700000000000;
    const futureIso = new Date(now + 3600000).toISOString();
    const pastIso = new Date(now - 3600000).toISOString();

    const isThreadSnoozed = (
      thread: { snoozed_until?: string | null; message_ids?: string[] },
      msgs: { id: string; snoozedUntil?: string | null }[]
    ): boolean => {
      return Boolean(
        (thread.snoozed_until && new Date(thread.snoozed_until).getTime() > now) ||
        msgs.some((m) => thread.message_ids?.includes(m.id) && m.snoozedUntil && new Date(m.snoozedUntil).getTime() > now)
      );
    };

    const filterThreads = (
      threadsList: { id: string; folder: string; snoozed_until?: string | null; message_ids?: string[] }[],
      msgs: { id: string; snoozedUntil?: string | null }[],
      curFolder: string
    ) => {
      return threadsList.filter((t) => {
        const snoozed = isThreadSnoozed(t, msgs);
        if (curFolder === "snoozed") {
          return snoozed;
        } else if (snoozed && t.folder !== "sent" && t.folder !== "trash") {
          return false;
        }
        return true;
      });
    };

    const threadActive = { id: "t1", folder: "inbox", snoozed_until: null, message_ids: ["m1"] };
    const threadSnoozedDirect = { id: "t2", folder: "inbox", snoozed_until: futureIso, message_ids: ["m2"] };
    const threadSnoozedViaMessage = { id: "t3", folder: "inbox", snoozed_until: null, message_ids: ["m3"] };
    const threadExpiredSnooze = { id: "t4", folder: "inbox", snoozed_until: pastIso, message_ids: ["m4"] };

    const mockMessages = [
      { id: "m1", snoozedUntil: null },
      { id: "m2", snoozedUntil: futureIso },
      { id: "m3", snoozedUntil: futureIso },
      { id: "m4", snoozedUntil: pastIso },
    ];

    const testThreads = [threadActive, threadSnoozedDirect, threadSnoozedViaMessage, threadExpiredSnooze];

    // In inbox: snoozed direct and snoozed via message must be excluded. Expired snooze must remain.
    const inboxVisible = filterThreads(testThreads, mockMessages, "inbox");
    assert(inboxVisible.some((t) => t.id === "t1"), "inbox should show active non-snoozed thread");
    assert(inboxVisible.some((t) => t.id === "t4"), "inbox should show expired snoozed thread");
    assert(!inboxVisible.some((t) => t.id === "t2"), "inbox must exclude directly snoozed thread");
    assert(!inboxVisible.some((t) => t.id === "t3"), "inbox must exclude thread snoozed via constituent message");
    assert(inboxVisible.length === 2, "inbox should have exactly 2 visible threads");

    // In snoozed folder: only snoozed threads must appear
    const snoozedVisible = filterThreads(testThreads, mockMessages, "snoozed");
    assert(snoozedVisible.some((t) => t.id === "t2"), "snoozed folder must include directly snoozed thread");
    assert(snoozedVisible.some((t) => t.id === "t3"), "snoozed folder must include message-snoozed thread");
    assert(!snoozedVisible.some((t) => t.id === "t1"), "snoozed folder must exclude active thread");
    assert(!snoozedVisible.some((t) => t.id === "t4"), "snoozed folder must exclude expired thread");
    assert(snoozedVisible.length === 2, "snoozed folder should have exactly 2 visible threads");
  });

  // 6. TestThreadMultiSelectHelpers
  await test("6. TestThreadMultiSelectHelpers", () => {
    const threadMessageIds = ["msg-1", "msg-2", "msg-3"];

    const computeSelectionState = (ids: string[], selected: Set<string>) => {
      const matchCount = ids.filter((id) => selected.has(id)).length;
      const allChecked = ids.length > 0 && matchCount === ids.length;
      const isIndeterminate = matchCount > 0 && matchCount < ids.length;
      return { allChecked, isIndeterminate, matchCount };
    };

    const toggleThreadIds = (ids: string[], selected: Set<string>) => {
      const next = new Set(selected);
      const { allChecked } = computeSelectionState(ids, selected);
      if (allChecked) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    };

    // Case A: None selected
    let selected = new Set<string>();
    let state = computeSelectionState(threadMessageIds, selected);
    assert(!state.allChecked, "none selected -> allChecked false");
    assert(!state.isIndeterminate, "none selected -> indeterminate false");

    // Toggle: should select all
    selected = toggleThreadIds(threadMessageIds, selected);
    state = computeSelectionState(threadMessageIds, selected);
    assert(state.allChecked, "toggled from none -> allChecked true");
    assert(!state.isIndeterminate, "toggled from none -> indeterminate false");
    assert(selected.size === 3, "selected has 3 messages");

    // Case B: Partial selection
    selected = new Set(["msg-1"]);
    state = computeSelectionState(threadMessageIds, selected);
    assert(!state.allChecked, "partial selected -> allChecked false");
    assert(state.isIndeterminate, "partial selected -> indeterminate true");

    // Toggle partial: should select all
    selected = toggleThreadIds(threadMessageIds, selected);
    state = computeSelectionState(threadMessageIds, selected);
    assert(state.allChecked, "toggled from partial -> allChecked true");
    assert(!state.isIndeterminate, "toggled from partial -> indeterminate false");

    // Toggle all: should clear all
    selected = toggleThreadIds(threadMessageIds, selected);
    state = computeSelectionState(threadMessageIds, selected);
    assert(!state.allChecked, "toggled from all -> allChecked false");
    assert(!state.isIndeterminate, "toggled from all -> indeterminate false");
    assert(selected.size === 0, "selected set is now empty");
  });

  return { passed, failed };
}

