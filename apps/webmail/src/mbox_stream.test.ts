import { streamMbox } from "./mbox_stream.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runMboxStreamTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Mbox Stream Tests...");

  // 1. Parse a 3-message mbox -> yields 3 messages in order
  await test("1. Parse a 3-message mbox -> yields 3 messages in order", async () => {
    const mboxContent = [
      "From alice@byos.local Mon Jan 01 00:00:00 2026",
      "From: alice@byos.local",
      "To: bob@byos.local",
      "Subject: Message One",
      "",
      "This is message 1 body.",
      "",
      "From bob@byos.local Tue Jan 02 00:00:00 2026",
      "From: bob@byos.local",
      "To: alice@byos.local",
      "Subject: Message Two",
      "",
      "This is message 2 body.",
      "",
      "From carol@byos.local Wed Jan 03 00:00:00 2026",
      "From: carol@byos.local",
      "To: bob@byos.local",
      "Subject: Message Three",
      "",
      "This is message 3 body.",
    ].join("\n");

    const file = new File([mboxContent], "three_messages.mbox", { type: "text/plain" });
    const messages = [];
    for await (const msg of streamMbox(file)) {
      messages.push(msg);
    }

    assert(messages.length === 3, `Expected 3 messages, got ${messages.length}`);
    assert(messages[0].fromLine.includes("alice@byos.local"), "Message 1 fromLine mismatch");
    assert(messages[0].raw.includes("Subject: Message One"), "Message 1 subject mismatch");
    assert(messages[0].raw.includes("This is message 1 body."), "Message 1 body mismatch");

    assert(messages[1].fromLine.includes("bob@byos.local"), "Message 2 fromLine mismatch");
    assert(messages[1].raw.includes("Subject: Message Two"), "Message 2 subject mismatch");
    assert(messages[1].raw.includes("This is message 2 body."), "Message 2 body mismatch");

    assert(messages[2].fromLine.includes("carol@byos.local"), "Message 3 fromLine mismatch");
    assert(messages[2].raw.includes("Subject: Message Three"), "Message 3 subject mismatch");
    assert(messages[2].raw.includes("This is message 3 body."), "Message 3 body mismatch");
  });

  // 2. Message boundary detection works with CRLF
  await test("2. Message boundary detection works with CRLF", async () => {
    const crlfMbox = [
      "From user1@test.com Thu Feb 01 10:00:00 2026",
      "From: user1@test.com",
      "Subject: CRLF Test 1",
      "",
      "Line 1\r\nLine 2",
      "",
      "From user2@test.com Thu Feb 01 11:00:00 2026",
      "From: user2@test.com",
      "Subject: CRLF Test 2",
      "",
      "Second message body",
    ].join("\r\n");

    const file = new File([crlfMbox], "crlf.mbox");
    const messages = [];
    for await (const msg of streamMbox(file)) {
      messages.push(msg);
    }

    assert(messages.length === 2, `Expected 2 messages, got ${messages.length}`);
    assert(messages[0].raw.includes("Subject: CRLF Test 1"), "Msg 1 subject mismatch");
    assert(messages[0].raw.includes("Line 1\r\nLine 2"), "Msg 1 body mismatch");
    assert(messages[1].raw.includes("Subject: CRLF Test 2"), "Msg 2 subject mismatch");
    assert(messages[1].raw.includes("Second message body"), "Msg 2 body mismatch");
  });

  // 3. Message boundary detection works with LF only
  await test("3. Message boundary detection works with LF only", async () => {
    const lfMbox = [
      "From user1@test.com Thu Feb 01 10:00:00 2026",
      "From: user1@test.com",
      "Subject: LF Test 1",
      "",
      "Line 1\nLine 2",
      "",
      "From user2@test.com Thu Feb 01 11:00:00 2026",
      "From: user2@test.com",
      "Subject: LF Test 2",
      "",
      "Second message body",
    ].join("\n");

    const file = new File([lfMbox], "lf.mbox");
    const messages = [];
    for await (const msg of streamMbox(file)) {
      messages.push(msg);
    }

    assert(messages.length === 2, `Expected 2 messages, got ${messages.length}`);
    assert(messages[0].raw.includes("Subject: LF Test 1"), "Msg 1 subject mismatch");
    assert(messages[0].raw.includes("Line 1\nLine 2"), "Msg 1 body mismatch");
    assert(messages[1].raw.includes("Subject: LF Test 2"), "Msg 2 subject mismatch");
    assert(messages[1].raw.includes("Second message body"), "Msg 2 body mismatch");
  });

  // 4. mboxrd unescaping works (>From -> From)
  await test("4. mboxrd unescaping works (>From -> From)", async () => {
    const escapedMbox = [
      "From sender@test.com Mon Mar 01 12:00:00 2026",
      "From: sender@test.com",
      "Subject: Escaped Lines",
      "",
      ">From the beginning of time,",
      ">>From another perspective,",
      "Normal line",
    ].join("\n");

    const file = new File([escapedMbox], "escaped.mbox");
    const messages = [];
    for await (const msg of streamMbox(file)) {
      messages.push(msg);
    }

    assert(messages.length === 1, `Expected 1 message, got ${messages.length}`);
    assert(messages[0].raw.includes("From the beginning of time,"), "Failed to unescape >From");
    assert(messages[0].raw.includes(">From another perspective,"), "Failed to unescape >>From");
    assert(!messages[0].raw.includes(">>From another perspective,"), "Double escape should be reduced by 1 '>'");
  });

  // 5. A very large message (simulate 2MB) yields correctly
  await test("5. A very large message (simulate 2MB) yields correctly", async () => {
    const lineOf100Bytes = "0123456789".repeat(10) + "\n";
    // 21000 lines * 101 bytes = ~2.12MB
    const bigBody = lineOf100Bytes.repeat(21000);
    const bigMbox = [
      "From large@test.com Fri Apr 01 00:00:00 2026",
      "From: large@test.com",
      "Subject: Large Message 2MB",
      "",
      bigBody,
    ].join("\n");

    const file = new File([bigMbox], "large.mbox");
    const messages = [];
    for await (const msg of streamMbox(file)) {
      messages.push(msg);
    }

    assert(messages.length === 1, `Expected 1 message, got ${messages.length}`);
    assert(messages[0].raw.includes("Subject: Large Message 2MB"), "Large message header missing");
    assert(messages[0].raw.length >= 2 * 1024 * 1024, `Expected message size >= 2MB, got ${messages[0].raw.length}`);
  });

  // 6. AbortSignal stops iteration cleanly
  await test("6. AbortSignal stops iteration cleanly", async () => {
    const multiMsg = [
      "From msg1@test.com Sat May 01 00:00:00 2026",
      "Subject: Msg 1",
      "",
      "Body 1",
      "",
      "From msg2@test.com Sat May 01 01:00:00 2026",
      "Subject: Msg 2",
      "",
      "Body 2",
      "",
      "From msg3@test.com Sat May 01 02:00:00 2026",
      "Subject: Msg 3",
      "",
      "Body 3",
    ].join("\n");

    const controller = new AbortController();
    const file = new File([multiMsg], "abort.mbox");
    const messages = [];

    for await (const msg of streamMbox(file, controller.signal)) {
      messages.push(msg);
      // Abort immediately after receiving the first message
      controller.abort();
    }

    assert(messages.length === 1, `Expected exactly 1 message before abort, got ${messages.length}`);
    assert(messages[0].raw.includes("Subject: Msg 1"), "First message subject mismatch");
  });

  // 7. Custom .mbox import encryption pipeline (zero-knowledge Section 12 binary envelope)
  await test("7. Custom .mbox import encryption pipeline (AES-GCM zero-knowledge roundtrip)", async () => {
    const rawMbox = [
      "From alice@byos.local Mon Jan 01 00:00:00 2026",
      "From: alice@byos.local",
      "To: bob@byos.local",
      "Subject: Confidential Project Alpha",
      "Message-ID: <alpha-001@byos.local>",
      "Date: Mon, 01 Jan 2026 12:00:00 +0000",
      "",
      "This is top secret proprietary customer correspondence.",
      "",
      "From bob@byos.local Tue Jan 02 00:00:00 2026",
      "From: bob@byos.local",
      "To: alice@byos.local",
      "Subject: Re: Confidential Project Alpha",
      "Message-ID: <alpha-002@byos.local>",
      "Date: Tue, 02 Jan 2026 14:00:00 +0000",
      "",
      "Acknowledged and received securely.",
    ].join("\n");

    const file = new File([rawMbox], "inbox.mbox");
    const mailboxKey = new Uint8Array(32).fill(7);
    const mailboxId = "11111111-2222-3333-4444-555555555555";

    // Dynamic import of encryptRawEml
    const { encryptRawEml, computeEnvelopeAad } = await import("./oauth_import.js");
    const { parseRfc822Headers } = await import("./import_worker.js");

    const processedMessages: { subject: string; envelope: Uint8Array; originalRaw: string }[] = [];

    for await (const item of streamMbox(file)) {
      const parsed = parseRfc822Headers(item.raw);
      const envelope = await encryptRawEml(mailboxKey, mailboxId, item.raw);
      processedMessages.push({
        subject: parsed.subject,
        envelope,
        originalRaw: item.raw,
      });
    }

    assert(processedMessages.length === 2, `Expected 2 messages, got ${processedMessages.length}`);
    assert(processedMessages[0].subject === "Confidential Project Alpha", "First subject parsed correctly");
    assert(processedMessages[1].subject === "Re: Confidential Project Alpha", "Second subject parsed correctly");

    for (const msg of processedMessages) {
      // 1. Must use Section 12 binary envelope framing (0x01)
      assert(msg.envelope[0] === 0x01, "Envelope must start with 0x01 framing byte");
      // 2. Minimum length: 1 framing + 12 IV + 16 Tag = 29 bytes
      assert(msg.envelope.length >= 29, "Envelope must satisfy minimum length");
      // 3. Plaintext must never appear in raw ciphertext envelope
      const rawEnvelopeStr = new TextDecoder("utf-8", { fatal: false }).decode(msg.envelope);
      assert(!rawEnvelopeStr.includes("Confidential Project Alpha"), "Plaintext subject leaked in envelope");
      assert(!rawEnvelopeStr.includes("top secret proprietary"), "Plaintext body leaked in envelope");

      // 4. Verify client-side decryption with authenticated AAD
      const iv = msg.envelope.subarray(1, 13);
      const ciphertext = msg.envelope.subarray(13);
      const aad = computeEnvelopeAad(mailboxId, "byos-draft-v1");

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        mailboxKey as unknown as BufferSource,
        "AES-GCM",
        false,
        ["decrypt"],
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as unknown as BufferSource, additionalData: aad as unknown as BufferSource },
        cryptoKey,
        ciphertext as unknown as BufferSource,
      );

      const plaintext = new TextDecoder().decode(decrypted);
      assert(plaintext === msg.originalRaw, "Decrypted message must match original RFC 822 text exactly");
    }
  });

  return { passed, failed };
}
