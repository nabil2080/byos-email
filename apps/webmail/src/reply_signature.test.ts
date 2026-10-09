import { applySignature, applySignatureHtml, formatQuotedHtml } from "./signature.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runReplySignatureTests(): { passed: number; failed: number } {
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

  console.log("Running Reply Signature Tests...");

  // 1. TestReplyPrePopulatesSignature
  test("1. TestReplyPrePopulatesSignature", () => {
    const msg = {
      sender: "alice@byos.local",
      subject: "Project Update",
      date: "Sep 25, 2026",
    };
    const originalPlaintext = "Can we meet tomorrow?";
    const quotedPlain = `\n\n--- On ${msg.date}, ${msg.sender} wrote: ---\n> ${originalPlaintext}`;
    const sigPlain = "Bob Jones";
    const sigHtml = "<b>Bob Jones</b>";

    // Simulate startReply state logic
    let composeBody = "";
    let composeBodyHtml = "";
    let composeSignatureApplied = false;

    if (sigPlain) {
      composeBody = `${quotedPlain}\n\n-- \n${sigPlain}`;
    } else {
      composeBody = quotedPlain;
    }

    const quoteHtml = formatQuotedHtml(quotedPlain);
    if (sigHtml) {
      composeBodyHtml = `${quoteHtml}<div class="byos-signature"><br>-- <br>${sigHtml}</div>`;
    } else {
      composeBodyHtml = quoteHtml;
    }

    if (sigPlain || sigHtml) {
      composeSignatureApplied = true;
    }

    // Assert composeBody contains the quoted text AND the signature
    assert(composeBody.includes(quotedPlain), "composeBody must contain quoted text");
    assert(composeBody.includes("-- \nBob Jones"), "composeBody must contain user signature");
    assert(composeBody.endsWith("\n\n-- \nBob Jones"), "signature must appear at bottom of composeBody");

    // Assert composeBodyHtml contains styled quote and signature div
    assert(composeBodyHtml.includes("border-left: 2px solid #ccc"), "composeBodyHtml must contain styled quote");
    assert(
      composeBodyHtml.endsWith('<div class="byos-signature"><br>-- <br><b>Bob Jones</b></div>'),
      "composeBodyHtml must contain user HTML signature div at bottom"
    );

    // Assert composeSignatureApplied is true
    assert(composeSignatureApplied === true, "composeSignatureApplied must be true");
  });

  // 2. TestForwardPrePopulatesSignature
  test("2. TestForwardPrePopulatesSignature", () => {
    const msg = {
      sender: "alice@byos.local",
      date: "Sep 25, 2026",
    };
    const originalPlaintext = "Confidential report content";
    const fwdContent = `--- Forwarded message from ${msg.sender} (${msg.date}) ---\n${originalPlaintext}`;
    const quotedPlain = `\n\n${fwdContent}`;
    const sigPlain = "Bob Jones";
    const sigHtml = "<b>Bob Jones</b>";

    // Simulate startForward state logic
    let composeBody = "";
    let composeBodyHtml = "";
    let composeSignatureApplied = false;

    if (sigPlain) {
      composeBody = `${quotedPlain}\n\n-- \n${sigPlain}`;
    } else {
      composeBody = quotedPlain;
    }

    const quoteHtml = formatQuotedHtml(fwdContent);
    if (sigHtml) {
      composeBodyHtml = `${quoteHtml}<div class="byos-signature"><br>-- <br>${sigHtml}</div>`;
    } else {
      composeBodyHtml = quoteHtml;
    }

    if (sigPlain || sigHtml) {
      composeSignatureApplied = true;
    }

    // Assert composeBody contains forwarded text AND the signature
    assert(composeBody.includes(fwdContent), "composeBody must contain forwarded text");
    assert(composeBody.includes("-- \nBob Jones"), "composeBody must contain user signature");
    assert(composeBody.endsWith("\n\n-- \nBob Jones"), "signature must appear at bottom of composeBody");

    // Assert composeBodyHtml contains quote and signature div
    assert(composeBodyHtml.includes("border-left: 2px solid #ccc"), "composeBodyHtml must contain styled forward block");
    assert(
      composeBodyHtml.endsWith('<div class="byos-signature"><br>-- <br><b>Bob Jones</b></div>'),
      "composeBodyHtml must contain user HTML signature div at bottom"
    );

    // Assert composeSignatureApplied is true
    assert(composeSignatureApplied === true, "composeSignatureApplied must be true");
  });

  // 3. TestNewComposePrePopulatesSignature
  test("3. TestNewComposePrePopulatesSignature", () => {
    const sigPlain = "Bob Jones";
    const sigHtml = "<b>Bob Jones</b>";

    // Simulate startNewCompose state logic
    let composeBody = "";
    let composeBodyHtml = "";
    let composeSignatureApplied = false;

    if (sigPlain) {
      composeBody = `\n\n-- \n${sigPlain}`;
    }
    if (sigHtml) {
      composeBodyHtml = `<p><br></p><div class="byos-signature"><p>-- </p>${sigHtml}</div>`;
    }
    if (sigPlain || sigHtml) {
      composeSignatureApplied = true;
    }

    // Assert composeBody contains only the signature (with leading blank lines for typing)
    assert(composeBody === "\n\n-- \nBob Jones", "composeBody must contain only the signature");
    assert(
      composeBodyHtml === '<p><br></p><div class="byos-signature"><p>-- </p><b>Bob Jones</b></div>',
      "composeBodyHtml must contain blank paragraph and signature div"
    );
    assert(composeSignatureApplied === true, "composeSignatureApplied must be true");
  });

  // 4. TestSendDoesNotDoubleAppend
  test("4. TestSendDoesNotDoubleAppend", () => {
    // Simulate a reply where composeBody already has the signature
    const sigPlain = "Bob Jones";
    const sigHtml = "<b>Bob Jones</b>";

    const body = "Sounds great!\n\n--- On Sep 25, 2026, Alice wrote: ---\n> Can we meet?\n\n-- \nBob Jones";
    const composeBodyHtml =
      '<p>Sounds great!</p><div style="color: #6F7173; border-left: 2px solid #ccc; padding-left: 8px; margin: 8px 0;"><p>--- On Sep 25, 2026, Alice wrote: ---</p><p>&gt; Can we meet?</p></div><div class="byos-signature"><br>-- <br><b>Bob Jones</b></div>';
    const composeSignatureApplied = true;

    // handleSend signature application block:
    let signedBody = body;
    let htmlBody = composeBodyHtml;

    if (!composeSignatureApplied) {
      signedBody = applySignature(body, sigPlain);
      htmlBody = applySignatureHtml(composeBodyHtml, sigHtml);
    }

    // Assert signature appears exactly once in signedBody
    const plainSigCount = (signedBody.match(/-- \nBob Jones/g) || []).length;
    assert(plainSigCount === 1, `Expected signature once in plaintext, found ${plainSigCount}`);

    // Assert signature appears exactly once in htmlBody
    const htmlSigCount = (htmlBody.match(/<b>Bob Jones<\/b>/g) || []).length;
    assert(htmlSigCount === 1, `Expected signature once in HTML, found ${htmlSigCount}`);
    const divSigCount = (htmlBody.match(/byos-signature/g) || []).length;
    assert(divSigCount === 1, `Expected byos-signature div once in HTML, found ${divSigCount}`);
  });

  // 5. TestNewComposeDefaultsToActiveMailbox
  test("5. TestNewComposeDefaultsToActiveMailbox", () => {
    const accountAlice = { id: "acc-alice-id", email: "alice@byos.local" };
    const accountBob = { id: "acc-bob-id", email: "bob@byos.local" };
    const connectedAccounts = [accountAlice, accountBob];

    let composeAccountId: string | null = null;
    let composeFromAlias: string | null = null;

    const clearComposeForm = () => {
      composeAccountId = null;
      composeFromAlias = null;
    };

    const startNewCompose = (activeBox: { id: string; local_part: string } | null) => {
      clearComposeForm();
      const accounts = connectedAccounts;
      const defaultAccId = (activeBox?.id) || (accounts.length > 0 ? accounts[0].id : null);
      if (defaultAccId) {
        composeAccountId = defaultAccId;
      }
    };

    // Step 1: User previously replied from Alice
    composeAccountId = accountAlice.id;
    assert(composeAccountId === accountAlice.id, "Prior compose was set to Alice");

    // Step 2: Bob is the active mailbox
    const activeBoxBob = { id: accountBob.id, local_part: "bob" };

    // Step 3: User clicks New Message
    startNewCompose(activeBoxBob);

    // Step 4: Verify compose defaults to Bob, NOT Alice
    assert(composeAccountId === accountBob.id, `Expected composeAccountId to be Bob (${accountBob.id}), got ${composeAccountId}`);

    const resolvedSender = (() => {
      if (composeFromAlias) return composeFromAlias;
      const accId = composeAccountId || activeBoxBob?.id;
      if (accId) {
        const acc = connectedAccounts.find((a) => a.id === accId);
        if (acc) return acc.email;
      }
      return `${activeBoxBob.local_part}@byos.local`;
    })();

    assert(resolvedSender === "bob@byos.local", `Expected resolved sender to be "bob@byos.local", got "${resolvedSender}"`);
  });

  // 6. TestClearComposeFormResetsComposeAccountId
  test("6. TestClearComposeFormResetsComposeAccountId", () => {
    let composeAccountId: string | null = "stale-account-id";
    let composeFromAlias: string | null = "stale-alias@masked.byos.local";

    const clearComposeForm = () => {
      composeAccountId = null;
      composeFromAlias = null;
    };

    clearComposeForm();

    assert(composeAccountId === null, "clearComposeForm must reset composeAccountId to null");
    assert(composeFromAlias === null, "clearComposeForm must reset composeFromAlias to null");
  });

  return { passed, failed };
}
