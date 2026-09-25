import { resolveTargetFolder } from "./mbox_labels.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runMboxLabelsTests(): { passed: number; failed: number } {
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

  console.log("Running Mbox Labels Tests...");
  const userEmail = "alice@byos.local";

  // 1. X-Gmail-Labels with "Sent" -> "sent"
  test('1. X-Gmail-Labels with "Sent" -> "sent"', () => {
    const raw = [
      "From: sender@example.com",
      "To: recipient@example.com",
      "Subject: Sent Label Test",
      "X-Gmail-Labels: Sent,Important",
      "",
      "Message body",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === "sent", `Expected 'sent', got '${folder}'`);
  });

  // 2. X-Gmail-Labels with "Spam" -> "spam"
  test('2. X-Gmail-Labels with "Spam" -> "spam"', () => {
    const raw = [
      "From: spammer@bad.org",
      "Subject: You won a prize",
      "X-Gmail-Labels: Spam",
      "",
      "Bad content",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === "spam", `Expected 'spam', got '${folder}'`);
  });

  // 3. X-Gmail-Labels with "Inbox,Important" -> "inbox"
  test('3. X-Gmail-Labels with "Inbox,Important" -> "inbox"', () => {
    const raw = [
      "From: boss@company.com",
      "Subject: Urgent",
      "X-Gmail-Labels: Inbox,Important",
      "",
      "Please review ASAP",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === "inbox", `Expected 'inbox', got '${folder}'`);
  });

  // 4. X-Gmail-Labels with "Archive" only -> "archive"
  test('4. X-Gmail-Labels with "Archive" only -> "archive"', () => {
    const raw = [
      "From: newsletter@site.com",
      "Subject: Weekly Roundup",
      "X-Gmail-Labels: Archive",
      "",
      "Weekly newsletter content",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === "archive", `Expected 'archive', got '${folder}'`);
  });

  // 5. No X-Gmail-Labels + From matches user email -> "sent"
  test('5. No X-Gmail-Labels + From matches user email -> "sent"', () => {
    const raw = [
      "From: Alice <alice@byos.local>",
      "To: bob@byos.local",
      "Subject: Hey Bob",
      "",
      "Catch up soon?",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === "sent", `Expected 'sent', got '${folder}'`);
  });

  // 6. No X-Gmail-Labels + From != user email -> null
  test('6. No X-Gmail-Labels + From != user email -> null', () => {
    const raw = [
      "From: Bob <bob@byos.local>",
      "To: alice@byos.local",
      "Subject: Hey Alice",
      "",
      "Sure thing!",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === null, `Expected null, got '${folder}'`);
  });

  // 7. Priority: message with both "Inbox" and "Spam" -> "spam" (spam wins)
  test('7. Priority: message with both "Inbox" and "Spam" -> "spam" (spam wins)', () => {
    const raw = [
      "From: tricky@phish.net",
      "Subject: Update Account",
      "X-Gmail-Labels: Inbox,Spam,Starred",
      "",
      "Click here",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === "spam", `Expected 'spam', got '${folder}'`);
  });

  // 8. Priority: message with both "Trash" and "Sent" -> "trash"
  test('8. Priority: message with both "Trash" and "Sent" -> "trash"', () => {
    const raw = [
      "From: alice@byos.local",
      "To: bob@byos.local",
      "Subject: Deleted Sent Email",
      "X-Gmail-Labels: Trash,Sent",
      "",
      "I deleted this after sending",
    ].join("\r\n");

    const folder = resolveTargetFolder(raw, userEmail);
    assert(folder === "trash", `Expected 'trash', got '${folder}'`);
  });

  return { passed, failed };
}
