import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildEmlContent,
  formatRFC2822Date,
  uint8ArrayToBase64,
} from "./eml_export";

describe("eml_export", () => {
  it("formats date to RFC 2822 / 5322", () => {
    const d = new Date("2026-10-30T12:00:00Z");
    const formatted = formatRFC2822Date(d);
    assert(formatted.includes("2026"), "includes year");
    assert(formatted.includes("GMT") || formatted.includes("UTC"), "includes timezone");
  });

  it("encodes uint8Array to base64 with line wrapping", () => {
    const raw = new Uint8Array([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]); // "hello world"
    const b64 = uint8ArrayToBase64(raw);
    assert.strictEqual(b64, "aGVsbG8gd29ybGQ=");
  });

  it("builds plain-text-only EML correctly", () => {
    const eml = buildEmlContent({
      from: "alice@byos.local",
      to: "bob@byos.local",
      subject: "Hello Bob",
      date: new Date("2026-10-30T10:00:00Z"),
      messageId: "<msg123@byos.local>",
      bodyPlain: "This is a test plaintext message.",
    });

    assert(eml.includes("From: alice@byos.local\r\n"), "includes From header");
    assert(eml.includes("To: bob@byos.local\r\n"), "includes To header");
    assert(eml.includes("Subject: Hello Bob\r\n"), "includes Subject header");
    assert(eml.includes("Message-ID: <msg123@byos.local>\r\n"), "includes Message-ID");
    assert(eml.includes("MIME-Version: 1.0\r\n"), "includes MIME-Version");
    assert(eml.includes("Content-Type: text/plain; charset=utf-8\r\n"), "includes Content-Type");
    assert(eml.includes("This is a test plaintext message."), "includes body text");
  });

  it("builds multipart/alternative EML when both plain and html are provided", () => {
    const eml = buildEmlContent({
      from: "alice@byos.local",
      to: ["bob@byos.local", "carol@byos.local"],
      cc: "dave@byos.local",
      subject: "HTML Message",
      bodyPlain: "Plain version",
      bodyHtml: "<p>HTML version</p>",
    });

    assert(eml.includes("To: bob@byos.local, carol@byos.local\r\n"), "formats multiple recipients");
    assert(eml.includes("Cc: dave@byos.local\r\n"), "includes CC header");
    assert(eml.includes("Content-Type: multipart/alternative; boundary="), "includes multipart/alternative header");
    assert(eml.includes("Content-Type: text/plain; charset=utf-8"), "includes text/plain part");
    assert(eml.includes("Plain version"), "includes plain text");
    assert(eml.includes("Content-Type: text/html; charset=utf-8"), "includes text/html part");
    assert(eml.includes("<p>HTML version</p>"), "includes HTML body");
  });

  it("builds multipart/mixed EML when attachments are present", () => {
    const attachmentData = new TextEncoder().encode("file content here");
    const eml = buildEmlContent({
      from: "alice@byos.local",
      to: "bob@byos.local",
      subject: "With Attachment",
      bodyPlain: "Check the attached file.",
      attachments: [
        {
          filename: "test.txt",
          contentType: "text/plain",
          data: attachmentData,
        },
      ],
    });

    assert(eml.includes("Content-Type: multipart/mixed; boundary="), "includes multipart/mixed");
    assert(eml.includes('Content-Type: text/plain; name="test.txt"'), "includes attachment content-type");
    assert(eml.includes('Content-Disposition: attachment; filename="test.txt"'), "includes disposition");
    assert(eml.includes("Content-Transfer-Encoding: base64"), "includes base64 transfer encoding");
    const expectedB64 = uint8ArrayToBase64(attachmentData);
    assert(eml.includes(expectedB64), "includes base64 encoded attachment data");
  });
});
