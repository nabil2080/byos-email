import {
  classifyMessage,
  resolveMessageCategory,
  getMessageCategoryOverride,
  setMessageCategoryOverride,
  clearMessageCategoryOverride,
  SOCIAL_DOMAINS,
  ClassifierInput,
} from "./focused_inbox";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runFocusedInboxTests(): { passed: number; failed: number } {
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

  console.log("Running Focused Inbox Classifier Tests...");

  // 1. Primary Classification
  test("1. TestPrimaryClassificationForDirectHumanMail", () => {
    const input: ClassifierInput = {
      senderEmail: "alice@example.org",
      senderDisplayName: "Alice Smith",
      subject: "Lunch tomorrow?",
      headers: {},
    };
    const cat = classifyMessage(input);
    assert(cat === "primary", `Expected primary, got ${cat}`);
  });

  // 2. Newsletters Classification
  test("2. TestNewslettersClassificationHeaders", () => {
    // List-Unsubscribe
    const unsubCat = classifyMessage({
      senderEmail: "marketing@brand.com",
      subject: "Summer Sale!",
      headers: { "list-unsubscribe": "<mailto:unsub@brand.com>" },
    });
    assert(unsubCat === "newsletters", `Expected newsletters for List-Unsubscribe, got ${unsubCat}`);

    // List-Id
    const listIdCat = classifyMessage({
      senderEmail: "news@daily.com",
      subject: "Daily Headlines",
      headers: { "list-id": "<daily.news.list>" },
    });
    assert(listIdCat === "newsletters", `Expected newsletters for List-Id, got ${listIdCat}`);

    // Precedence: list
    const precListCat = classifyMessage({
      senderEmail: "group@lists.org",
      subject: "Meeting Notes",
      headers: { precedence: "list" },
    });
    assert(precListCat === "newsletters", `Expected newsletters for Precedence: list, got ${precListCat}`);

    // Auto-Submitted: auto-generated with newsletter local part
    const autoNewsCat = classifyMessage({
      senderEmail: "weekly-digest@tech.io",
      subject: "Tech Roundup",
      headers: { "auto-submitted": "auto-generated" },
    });
    assert(autoNewsCat === "newsletters", `Expected newsletters for Auto-Submitted + digest, got ${autoNewsCat}`);
  });

  // 3. Social Classification
  test("3. TestSocialClassificationForSocialDomains", () => {
    for (const domain of SOCIAL_DOMAINS) {
      const cat = classifyMessage({
        senderEmail: `notifications@${domain}`,
        subject: "Someone followed you",
        headers: {},
      });
      assert(cat === "social", `Expected social for ${domain}, got ${cat}`);
    }

    // Subdomain matching
    const subCat = classifyMessage({
      senderEmail: "mailer@sub.linkedin.com",
      subject: "New connection request",
      headers: {},
    });
    assert(subCat === "social", `Expected social for sub.linkedin.com, got ${subCat}`);
  });

  // 4. Notifications Classification
  test("4. TestNotificationsClassificationSignals", () => {
    // Transactional subjects
    const subjects = [
      "Your order confirmation #12345",
      "Here is your receipt",
      "Password reset request",
      "Please verify your email",
      "Your package is shipping today",
      "Package delivered to porch",
      "Payment received from Client",
      "New invoice #999 attached",
    ];

    for (const sub of subjects) {
      const cat = classifyMessage({
        senderEmail: "billing@acme.com",
        subject: sub,
        headers: {},
      });
      assert(cat === "notifications", `Expected notifications for subject "${sub}", got ${cat}`);
    }

    // Precedence: bulk with no-reply sender
    const bulkNoReply = classifyMessage({
      senderEmail: "no-reply@store.com",
      subject: "Account update",
      headers: { precedence: "bulk" },
    });
    assert(bulkNoReply === "notifications", `Expected notifications for Precedence: bulk + no-reply, got ${bulkNoReply}`);

    // Auto-Submitted: auto-generated (without newsletter sender)
    const autoGen = classifyMessage({
      senderEmail: "system@cloud.com",
      subject: "CPU threshold alert",
      headers: { "auto-submitted": "auto-generated" },
    });
    assert(autoGen === "notifications", `Expected notifications for Auto-Submitted auto-generated, got ${autoGen}`);
  });

  // 5. Precedence Order: Newsletters wins before Social, Social wins before Notifications
  test("5. TestClassificationPrecedenceOrder", () => {
    // Social domain with List-Unsubscribe should classify as newsletters (Rule 1 > Rule 2)
    const socialNewsletter = classifyMessage({
      senderEmail: "digest@facebook.com",
      subject: "Weekly Groups Digest",
      headers: { "list-unsubscribe": "<https://facebook.com/unsub>" },
    });
    assert(socialNewsletter === "newsletters", `Expected newsletters to win over social, got ${socialNewsletter}`);

    // Social domain with notification subject should classify as social (Rule 2 > Rule 3)
    const socialNotification = classifyMessage({
      senderEmail: "security@twitter.com",
      subject: "Password reset for your account",
      headers: {},
    });
    assert(socialNotification === "social", `Expected social to win over notifications, got ${socialNotification}`);
  });

  // 6. Overrides: Session Manual Override and Server Rule Override
  test("6. TestOverridesPrecedence", () => {
    // Mock sessionStorage
    const storage: Record<string, string> = {};
    const mockSessionStorage = {
      getItem: (k: string) => storage[k] || null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
    };

    const originalWindow = (globalThis as any).window;
    (globalThis as any).window = { sessionStorage: mockSessionStorage };

    try {
      const msgId = "test-msg-123";
      const input: ClassifierInput = {
        senderEmail: "friend@domain.com",
        subject: "Hello",
        headers: {},
      };

      // Default without override -> primary
      let cat = resolveMessageCategory(msgId, null, input);
      assert(cat === "primary", `Expected primary, got ${cat}`);

      // Server override -> notifications
      cat = resolveMessageCategory(msgId, "notifications", input);
      assert(cat === "notifications", `Expected server override notifications, got ${cat}`);

      // Manual override -> social (beats server override and classifier)
      setMessageCategoryOverride(msgId, "social");
      assert(getMessageCategoryOverride(msgId) === "social", "Manual override should be saved");
      cat = resolveMessageCategory(msgId, "notifications", input);
      assert(cat === "social", `Expected manual override social to beat server override, got ${cat}`);

      // Clear manual override -> back to server override
      clearMessageCategoryOverride(msgId);
      cat = resolveMessageCategory(msgId, "notifications", input);
      assert(cat === "notifications", `Expected server override after clear, got ${cat}`);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });

  return { passed, failed };
}
