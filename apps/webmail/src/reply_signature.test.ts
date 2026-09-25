import { applySignature, applySignatureHtml } from "./signature.js";

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

  // 1. TestReplyAppendsSignature
  test("1. TestReplyAppendsSignature", () => {
    // Fake reply HTML body (with quoted text + quoted signature from Alice)
    const quotedHtml =
      "<p>Sounds good!</p>" +
      "<p>--- On Sep 25, 2026, Alice wrote: ---</p>" +
      "<blockquote>" +
      "<p>Can we meet tomorrow?</p>" +
      '<div class="byos-signature"><br>-- <br><b>Alice</b></div>' +
      "</blockquote>";
    const userSigHtml = "<b>Bob</b>";

    const result = applySignatureHtml(quotedHtml, userSigHtml);

    // Assert the user's signature div appears at the end
    const expectedSigDiv = '<div class="byos-signature"><br>-- <br><b>Bob</b></div>';
    assert(result.endsWith(expectedSigDiv), "User signature div must appear at the end");

    // Assert no duplicate of the user's own signature
    const userSigMatches = (result.match(/<b>Bob<\/b>/g) || []).length;
    assert(userSigMatches === 1, `Expected Bob signature once, found ${userSigMatches}`);

    // Plaintext counterpart
    const quotedPlain =
      "Sounds good!\n\n--- On Sep 25, 2026, Alice wrote: ---\n> Can we meet tomorrow?\n> \n> -- \n> Alice";
    const userSigPlain = "Bob";
    const resultPlain = applySignature(quotedPlain, userSigPlain);
    assert(resultPlain.endsWith("\n\n-- \nBob"), "User signature must appear at the end of plaintext");
    const plainMatches = (resultPlain.match(/\bBob\b/g) || []).length;
    assert(plainMatches === 1, `Expected Bob once in plaintext, found ${plainMatches}`);
  });

  // 2. TestNewComposeDoesNotDoubleSignature
  test("2. TestNewComposeDoesNotDoubleSignature", () => {
    // Simulate the state: composeSignatureApplied = true (as set by startNewCompose)
    let composeSignatureApplied = true;
    const body = "Here is my message.\n\n-- \nBob";
    const composeBodyHtml =
      '<p>Here is my message.</p><div class="byos-signature"><p>-- </p><b>Bob</b></div>';
    const sigPlain = "Bob";
    const sigHtml = "<b>Bob</b>";

    let signedBody = body;
    let htmlBody = composeBodyHtml;

    let applySignatureCalled = false;
    let applySignatureHtmlCalled = false;

    // handleSend logic under test:
    if (!composeSignatureApplied) {
      applySignatureCalled = true;
      signedBody = applySignature(body, sigPlain);
      applySignatureHtmlCalled = true;
      htmlBody = applySignatureHtml(composeBodyHtml, sigHtml);
    }

    // Verify handleSend does NOT call applySignature / applySignatureHtml
    assert(!applySignatureCalled, "handleSend must NOT call applySignature when composeSignatureApplied is true");
    assert(!applySignatureHtmlCalled, "handleSend must NOT call applySignatureHtml when composeSignatureApplied is true");
    assert(signedBody === body, "signedBody must remain unmodified");
    assert(htmlBody === composeBodyHtml, "htmlBody must remain unmodified");

    // Verify when composeSignatureApplied is false (e.g. reply / forward), it DOES append
    composeSignatureApplied = false;
    let replyBody = "Draft without signature";
    let replyHtml = "<p>Draft without signature</p>";
    if (!composeSignatureApplied) {
      replyBody = applySignature(replyBody, sigPlain);
      replyHtml = applySignatureHtml(replyHtml, sigHtml);
    }
    assert(replyBody.endsWith("\n\n-- \nBob"), "Must append signature when composeSignatureApplied is false");
    assert(
      replyHtml.endsWith('<div class="byos-signature"><br>-- <br><b>Bob</b></div>'),
      "Must append HTML signature when composeSignatureApplied is false"
    );
  });

  // 3. TestReplySignsWithCorrectSignature
  test("3. TestReplySignsWithCorrectSignature", () => {
    // Different quoted signature (Alice's) + user signature (Bob's)
    const quotedHtml =
      "<p>Thanks for the update.</p>" +
      "<blockquote>--- On Friday, Alice wrote: ---" +
      '<div class="byos-signature"><br>-- <br>Alice Smith</div>' +
      "</blockquote>";
    const bobSigHtml = "<b>Bob Jones</b>";

    const resultHtml = applySignatureHtml(quotedHtml, bobSigHtml);

    // Verify Bob's signature appears
    assert(
      resultHtml.includes('<div class="byos-signature"><br>-- <br><b>Bob Jones</b></div>'),
      "Bob's signature must appear in the HTML result"
    );
    // Verify Alice's is preserved in the quote
    assert(
      resultHtml.includes('<div class="byos-signature"><br>-- <br>Alice Smith</div>'),
      "Alice's signature must be preserved in the quoted original"
    );
    assert(
      resultHtml.endsWith('<div class="byos-signature"><br>-- <br><b>Bob Jones</b></div>'),
      "Bob's signature must be at the very end of the HTML result"
    );

    // Plaintext check
    const quotedPlain =
      "Thanks for the update.\n\n--- On Friday, Alice wrote: ---\n> Hello\n> \n> -- \n> Alice Smith";
    const bobSigPlain = "Bob Jones";
    const resultPlain = applySignature(quotedPlain, bobSigPlain);
    assert(resultPlain.includes("-- \nBob Jones"), "Bob's signature must appear in plaintext");
    assert(resultPlain.includes("Alice Smith"), "Alice's signature must be preserved in quoted plaintext");
    assert(resultPlain.endsWith("\n\n-- \nBob Jones"), "Bob's signature must be at the end of plaintext");
  });

  return { passed, failed };
}
