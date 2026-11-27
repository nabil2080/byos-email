import { computeReplyRecipients, isValidEmailAddress, extractEmail } from "./reply_recipients.js";
import type { DisplayMessage } from "./App.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runReplyRecipientsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      const res = fn();
      if (res && typeof res.then === "function") {
        return res
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ ${name}:`, err);
            failed++;
          });
      }
      console.log(`  ✓ ${name}`);
      passed++;
      return Promise.resolve();
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
      return Promise.resolve();
    }
  };

  console.log("Running Phase 5: Reply and Reply All Tests...");

  await test("Phase 5.1: Reply uses Reply-To when present and valid", () => {
    const msg: Partial<DisplayMessage> = {
      sender: "Alice <alice@example.com>",
      replyTo: "Security Team <security@example.com>",
      recipients: ["Bob <bob@byos.local>"],
    };

    const res = computeReplyRecipients(msg, "bob@byos.local", false);
    assert(res.to === "Security Team <security@example.com>", "To should be Reply-To");
    assert(res.cc === "", "Cc should be empty for Reply");
  });

  await test("Phase 5.2: Reply falls back to From when Reply-To is absent", () => {
    const msg: Partial<DisplayMessage> = {
      sender: "Alice <alice@example.com>",
      replyTo: undefined,
      recipients: ["Bob <bob@byos.local>"],
    };

    const res = computeReplyRecipients(msg, "bob@byos.local", false);
    assert(res.to === "Alice <alice@example.com>", "To should fall back to From");
    assert(res.cc === "", "Cc should be empty for Reply");
  });

  await test("Phase 5.3: Reply falls back safely to From when Reply-To is malformed", () => {
    const malformedCases = [
      "Not An Email",
      "@missinglocal.com",
      "missingdomain@",
      "   ",
      "<invalid-bracket",
      "invalid@domain-without-tld",
    ];

    for (const badReplyTo of malformedCases) {
      const msg: Partial<DisplayMessage> = {
        sender: "Alice <alice@example.com>",
        replyTo: badReplyTo,
        recipients: ["Bob <bob@byos.local>"],
      };

      const res = computeReplyRecipients(msg, "bob@byos.local", false);
      assert(
        res.to === "Alice <alice@example.com>",
        `Expected fallback to From for malformed replyTo: ${badReplyTo}`
      );
      assert(res.cc === "", "Cc should be empty for Reply");
    }
  });

  await test("Phase 5.4: Reply All targets Reply-To and retains intended To and Cc recipients", () => {
    const msg: Partial<DisplayMessage> = {
      sender: "Alice <alice@example.com>",
      replyTo: "Triage <triage@external.org>",
      recipients: [
        "Bob <bob@byos.local>",
        "Carol <carol@byos.local>",
        "Dave <dave@byos.local>",
      ],
    };

    // User replying is Bob
    const res = computeReplyRecipients(msg, "bob@byos.local", true);
    assert(res.to === "Triage <triage@external.org>", "To should target Reply-To");
    assert(
      res.cc === "Carol <carol@byos.local>, Dave <dave@byos.local>",
      "Carol and Dave should be in Cc, Bob excluded"
    );
  });

  await test("Phase 5.5: Reply All excludes the user's own mailbox address", () => {
    const msg: Partial<DisplayMessage> = {
      sender: "Alice <alice@example.com>",
      recipients: [
        "User Own Mailbox <user@byos.local>",
        "Partner <partner@example.com>",
      ],
    };

    const res = computeReplyRecipients(msg, "user@byos.local", true);
    assert(res.to === "Alice <alice@example.com>", "To should target sender");
    assert(res.cc === "Partner <partner@example.com>", "Partner should be in Cc");
    assert(
      !res.cc.toLowerCase().includes("user@byos.local"),
      "User's own email must never appear in Reply All Cc list"
    );
  });

  await test("Phase 5.6: Reply All does not duplicate the primary reply target in Cc", () => {
    const msg: Partial<DisplayMessage> = {
      sender: "Alice <alice@example.com>",
      replyTo: "Alice <alice@example.com>",
      recipients: [
        "Alice <alice@example.com>",
        "Colleague <colleague@example.com>",
      ],
    };

    const res = computeReplyRecipients(msg, "me@byos.local", true);
    assert(res.to === "Alice <alice@example.com>", "To is Alice");
    assert(res.cc === "Colleague <colleague@example.com>", "Alice not duplicated in Cc");
  });

  await test("Phase 5.7: BCC recipients are strictly not exposed or copied into Reply All", () => {
    const msg: Partial<DisplayMessage> = {
      sender: "Alice <alice@example.com>",
      replyTo: undefined,
      recipients: [
        "Visible To <visible-to@byos.local>",
        "Visible Cc <visible-cc@byos.local>",
      ],
    };

    const res = computeReplyRecipients(msg, "visible-to@byos.local", true);
    assert(res.to === "Alice <alice@example.com>", "To is sender");
    assert(res.cc === "Visible Cc <visible-cc@byos.local>", "Cc retains visible CC");
    assert(!res.cc.includes("secret-bcc"), "BCC must not appear in Reply All Cc");
  });

  await test("Phase 5.8: extractEmail and isValidEmailAddress helper utilities", () => {
    assert(extractEmail("Alice <ALICE@Example.COM>") === "alice@example.com", "normalized lowercase");
    assert(extractEmail("plain@example.com") === "plain@example.com", "plain email");
    assert(extractEmail('"Quoted Name" <quoted@example.com>') === "quoted@example.com", "quoted name");

    assert(isValidEmailAddress("valid@domain.org") === true, "valid domain");
    assert(isValidEmailAddress("Display Name <valid@domain.org>") === true, "valid display name");
    assert(isValidEmailAddress("no-domain") === false, "no domain");
    assert(isValidEmailAddress("") === false, "empty string");
  });

  return { passed, failed };
}
