import { formatParticipants, getUnreadClass } from "./components/ThreadRow.js";
import { fetchThreads, fetchThreadMessages } from "./api.js";

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

  return { passed, failed };
}
