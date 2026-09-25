import {
  buildPendingSendPayload,
  restoreComposeState,
  undoPendingSend,
  PendingSend,
} from "./undo_send.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runUndoSendTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("Running Undo Send Tests...");

  // 1. TestPrepareSendPayloadEmptyRecipient
  test("1. TestPrepareSendPayloadEmptyRecipient", () => {
    const emptyTo = buildPendingSendPayload({
      to: "   ",
      subject: "Hello",
      body: "Test body",
      bodyHtml: "<p>Test body</p>",
      boxId: "box-123",
      signatureApplied: false,
    });
    assert(emptyTo === null, "payload with empty recipient should be null");

    const emptySubject = buildPendingSendPayload({
      to: "bob@byos.local",
      subject: "   ",
      body: "Test body",
      bodyHtml: "<p>Test body</p>",
      boxId: "box-123",
      signatureApplied: false,
    });
    assert(emptySubject === null, "payload with empty subject should be null");

    const emptyBody = buildPendingSendPayload({
      to: "bob@byos.local",
      subject: "Hello",
      body: "   ",
      bodyHtml: "",
      boxId: "box-123",
      signatureApplied: false,
    });
    assert(emptyBody === null, "payload with empty body should be null");

    const emptyBox = buildPendingSendPayload({
      to: "bob@byos.local",
      subject: "Hello",
      body: "Test body",
      bodyHtml: "<p>Test body</p>",
      boxId: "",
      signatureApplied: false,
    });
    assert(emptyBox === null, "payload with empty boxId should be null");
  });

  // 2. TestPrepareSendPayloadAppliesSignature
  test("2. TestPrepareSendPayloadAppliesSignature", () => {
    // When composeSignatureApplied = false: signature appended
    const unappliedPayload = buildPendingSendPayload({
      to: "bob@byos.local",
      subject: "Report",
      body: "Here is the report.",
      bodyHtml: "<p>Here is the report.</p>",
      boxId: "box-123",
      signatureApplied: false,
      sigPlain: "Alice Smith\nSecurity Team",
      sigHtml: "<b>Alice Smith</b><br>Security Team",
    });
    assert(unappliedPayload !== null, "unappliedPayload should not be null");
    assert(
      unappliedPayload!.bodyPlaintext.includes("-- \nAlice Smith\nSecurity Team"),
      "plaintext should have signature appended when unapplied"
    );
    assert(
      unappliedPayload!.bodyHtml.includes('<div class="byos-signature">'),
      "html should have byos-signature div appended when unapplied"
    );

    // When composeSignatureApplied = true: signature not appended again
    const preAppliedPlain = "Here is the report.\n\n-- \nAlice Smith\nSecurity Team";
    const preAppliedHtml = '<p>Here is the report.</p><div class="byos-signature"><br>-- <br><b>Alice Smith</b></div>';
    const appliedPayload = buildPendingSendPayload({
      to: "bob@byos.local",
      subject: "Report",
      body: preAppliedPlain,
      bodyHtml: preAppliedHtml,
      boxId: "box-123",
      signatureApplied: true,
      sigPlain: "Alice Smith\nSecurity Team",
      sigHtml: "<b>Alice Smith</b><br>Security Team",
    });
    assert(appliedPayload !== null, "appliedPayload should not be null");
    assert(
      appliedPayload!.bodyPlaintext === preAppliedPlain,
      "plaintext should not have duplicate signature when signatureApplied is true"
    );
    assert(
      appliedPayload!.bodyHtml === preAppliedHtml,
      "html should not have duplicate signature when signatureApplied is true"
    );
  });

  // 3. TestRestoreComposeFromPayload
  test("3. TestRestoreComposeFromPayload", () => {
    const payload: PendingSend = {
      id: "send-123",
      expiresAt: Date.now() + 5000,
      recipient: "charlie@byos.local",
      subject: "Project Update",
      bodyPlaintext: "Update details\n\n-- \nBob",
      bodyHtml: "<p>Update details</p>",
      attachments: [{ id: "att-1", filename: "doc.pdf" } as any],
      scheduledTime: "2026-09-30T10:00:00Z",
      trackOpens: true,
      mailboxId: "box-456",
    };

    const restoredState: Record<string, any> = {};
    restoreComposeState(payload, {
      setTo: (v) => { restoredState.to = v; },
      setSubject: (v) => { restoredState.subject = v; },
      setBody: (v) => { restoredState.body = v; },
      setBodyHtml: (v) => { restoredState.bodyHtml = v; },
      setAttachments: (v) => { restoredState.attachments = v; },
      setScheduledTime: (v) => { restoredState.scheduledTime = v; },
      setTrackOpens: (v) => { restoredState.trackOpens = v; },
      setSignatureApplied: (v) => { restoredState.signatureApplied = v; },
      setOpen: (v) => { restoredState.open = v; },
    });

    assert(restoredState.to === "charlie@byos.local", "restores recipient");
    assert(restoredState.subject === "Project Update", "restores subject");
    assert(restoredState.body === "Update details\n\n-- \nBob", "restores bodyPlaintext");
    assert(restoredState.bodyHtml === "<p>Update details</p>", "restores bodyHtml");
    assert(restoredState.attachments.length === 1, "restores attachments");
    assert(restoredState.scheduledTime === "2026-09-30T10:00:00Z", "restores scheduledTime");
    assert(restoredState.trackOpens === true, "restores trackOpens");
    assert(restoredState.signatureApplied === true, "sets signatureApplied to true");
    assert(restoredState.open === true, "reopens compose drawer");
  });

  // 4. TestUndoRemovesPendingSend
  test("4. TestUndoRemovesPendingSend", () => {
    const payload: PendingSend = {
      id: "send-789",
      expiresAt: Date.now() + 5000,
      recipient: "david@byos.local",
      subject: "Meeting",
      bodyPlaintext: "Can we meet?",
      bodyHtml: "<p>Can we meet?</p>",
      attachments: [],
      scheduledTime: "",
      trackOpens: false,
      mailboxId: "box-789",
    };

    const mockStorage: Record<string, string> = {
      byos_pending_send: JSON.stringify(payload),
    };
    let currentPending: PendingSend | null = payload;
    let restoredPayload: PendingSend | null = null;

    undoPendingSend(
      payload,
      {
        removeItem: (k: string) => { delete mockStorage[k]; },
      },
      (p) => { restoredPayload = p; },
      () => { currentPending = null; }
    );

    assert(currentPending === null, "pendingSend signal is cleared to null");
    assert(!mockStorage["byos_pending_send"], "sessionStorage byos_pending_send is removed");
    assert((restoredPayload as PendingSend | null)?.id === "send-789", "onRestore is called with original payload");
  });

  return { passed, failed };
}
