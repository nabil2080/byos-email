import {
  extractCleanEmail,
  extractDisplayName,
  extractUnsubscribeLink,
  isSenderUnsubscribed,
  unsubscribeSender,
  resubscribeSender,
  detectSubscriptions,
} from "./subscriptions_store";
import { DisplayMessage } from "./components/MessageList";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runSubscriptionsStoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Subscriptions Store & Unsubscribe Tests...");

  // Mock localStorage
  const storage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (k: string) => storage[k] || null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  };

  const origWindow = (globalThis as any).window;
  (globalThis as any).window = {
    localStorage: mockLocalStorage,
    dispatchEvent: () => true,
  };

  try {
    test("1. TestExtractCleanEmailAndDisplayName", () => {
      assert(extractCleanEmail('"The Daily" <news@daily.com>') === "news@daily.com", "Clean email extracted from RFC address");
      assert(extractCleanEmail("sub@brand.co.uk") === "sub@brand.co.uk", "Plain email preserved");
      assert(extractDisplayName('"The Daily" <news@daily.com>') === "The Daily", "Display name extracted");
      assert(extractDisplayName("support@tech.com") === "Support", "Local part capitalised when no display name");
    });

    test("2. TestExtractUnsubscribeLinkFromHeadersAndBody", () => {
      // From List-Unsubscribe header with http URL
      const link1 = extractUnsubscribeLink({ "list-unsubscribe": "<https://daily.com/unsub?id=99>" });
      assert(link1?.url === "https://daily.com/unsub?id=99", "Header HTTP URL extracted");

      // From List-Unsubscribe header with mailto
      const link2 = extractUnsubscribeLink({ "list-unsubscribe": "<mailto:unsub@daily.com?subject=unsubscribe>" });
      assert(link2?.mailto === "mailto:unsub@daily.com?subject=unsubscribe", "Header mailto extracted");

      // From HTML body anchor tag
      const link3 = extractUnsubscribeLink(undefined, '<p>Click <a href="https://service.com/opt-out/user">Unsubscribe here</a></p>');
      assert(link3?.url === "https://service.com/opt-out/user", "Body anchor unsubscribe URL extracted");

      // Ordinary email without unsubscribe headers/links returns null
      const linkOrdinary = extractUnsubscribeLink({}, "Hey Alice, let's catch up tomorrow afternoon!");
      assert(linkOrdinary === null, "Ordinary email without unsub returns null");
    });

    test("3. TestUnsubscribeAndResubscribeLifecycle", () => {
      const box = "box-test-1";
      const sender = "marketing@acme.com";

      assert(!isSenderUnsubscribed(box, sender), "Initially sender is subscribed");

      unsubscribeSender(box, sender, "Acme Store");
      assert(isSenderUnsubscribed(box, sender), "Sender is marked as unsubscribed");

      resubscribeSender(box, sender);
      assert(!isSenderUnsubscribed(box, sender), "Sender is restored to subscribed state");
    });

    test("4. TestDetectSubscriptionsAggregatesMessages", () => {
      const box = "box-test-2";
      const msgs: DisplayMessage[] = [
        {
          id: "m1",
          folder: "inbox",
          sender: '"Tech Weekly" <newsletter@tech.com>',
          recipient: "me@byos.local",
          subject: "Issue #42",
          snippet: "Top news this week",
          encryptedBody: "",
          date: "2026-10-25T10:00:00Z",
          read: true,
          starred: false,
          category: "newsletters",
        },
        {
          id: "m2",
          folder: "inbox",
          sender: '"Tech Weekly" <newsletter@tech.com>',
          recipient: "me@byos.local",
          subject: "Issue #43",
          snippet: "Unsubscribe at https://tech.com/unsub",
          encryptedBody: "",
          date: "2026-11-01T10:00:00Z",
          read: false,
          starred: true,
          category: "newsletters",
          decryptedContent: '<a href="https://tech.com/unsub">Unsubscribe</a>',
        },
        {
          id: "m3",
          folder: "inbox",
          sender: "Alice <alice@friend.com>",
          recipient: "me@byos.local",
          subject: "Hi!",
          snippet: "Personal mail",
          encryptedBody: "",
          date: "2026-11-01T11:00:00Z",
          read: true,
          starred: false,
          category: "primary",
        },
      ];

      const subs = detectSubscriptions(msgs, box);
      assert(subs.length === 1, `Expected 1 subscription, got ${subs.length}`);
      assert(subs[0].senderEmail === "newsletter@tech.com", "Identified newsletter sender");
      assert(subs[0].senderName === "Tech Weekly", "Identified newsletter name");
      assert(subs[0].messageCount === 2, "Aggregated 2 messages");
      assert(subs[0].unsubscribeUrl === "https://tech.com/unsub", "Found unsubscribe URL");
      assert(subs[0].status === "subscribed", "Status is active subscribed");
    });
  } finally {
    (globalThis as any).window = origWindow;
  }

  return { passed, failed };
}
