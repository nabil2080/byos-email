import {
  loadSignature,
  loadSignatureHtml,
  saveSignature,
  saveSignatureHtml,
  clearSignature,
  applySignature,
  applySignatureHtml,
} from "./signature.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// MemoryStorage mock for Node environment
class MemoryStorage implements Storage {
  private store: Record<string, string> = {};
  get length() {
    return Object.keys(this.store).length;
  }
  clear(): void {
    this.store = {};
  }
  getItem(key: string): string | null {
    return this.store[key] !== undefined ? this.store[key] : null;
  }
  key(index: number): string | null {
    return Object.keys(this.store)[index] || null;
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
}

const mockStorage = new MemoryStorage();
(globalThis as any).window = globalThis;
(globalThis as any).localStorage = mockStorage;

export function runSignatureTests(): { passed: number; failed: number } {
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

  console.log("Running Signature Tests...");

  // 1. loadSignature returns stored plaintext
  test("1. loadSignature returns stored plaintext", () => {
    mockStorage.clear();
    mockStorage.setItem("byos.signature.box1", "Alice Plaintext Signature");
    assert(loadSignature("box1") === "Alice Plaintext Signature", "Plaintext signature did not match");
  });

  // 2. loadSignatureHtml returns stored HTML
  test("2. loadSignatureHtml returns stored HTML", () => {
    mockStorage.clear();
    const htmlSig = '<table style="color:red;"><tr><td>Alice</td></tr></table>';
    mockStorage.setItem("byos.signature.html.box1", htmlSig);
    assert(loadSignatureHtml("box1") === htmlSig, "HTML signature did not match");
  });

  // 3. loadSignatureHtml falls back to plaintext conversion when HTML is absent
  test("3. loadSignatureHtml falls back to plaintext conversion when HTML is absent", () => {
    mockStorage.clear();
    mockStorage.setItem("byos.signature.box1", "Line 1 <special &>\nLine 2");
    const fallbackHtml = loadSignatureHtml("box1");
    assert(
      fallbackHtml === "<p>Line 1 &lt;special &amp;&gt;</p><p>Line 2</p>",
      `Fallback HTML unexpected: ${fallbackHtml}`
    );
  });

  // 4. saveSignature with empty string removes the key
  test("4. saveSignature with empty string removes the key", () => {
    mockStorage.clear();
    saveSignature("box1", "Initial plain");
    assert(mockStorage.getItem("byos.signature.box1") === "Initial plain", "Should be saved");
    saveSignature("box1", "   ");
    assert(mockStorage.getItem("byos.signature.box1") === null, "Should be removed on empty string");
  });

  // 5. saveSignatureHtml with empty string removes the key
  test("5. saveSignatureHtml with empty string removes the key", () => {
    mockStorage.clear();
    saveSignatureHtml("box1", "<div>HTML</div>");
    assert(mockStorage.getItem("byos.signature.html.box1") === "<div>HTML</div>", "Should be saved");
    saveSignatureHtml("box1", "  \n  ");
    assert(mockStorage.getItem("byos.signature.html.box1") === null, "Should be removed on empty string");
  });

  // 6. clearSignature removes both keys
  test("6. clearSignature removes both keys", () => {
    mockStorage.clear();
    saveSignature("box1", "Text");
    saveSignatureHtml("box1", "<b>HTML</b>");
    clearSignature("box1");
    assert(mockStorage.getItem("byos.signature.box1") === null, "Plain key should be removed");
    assert(mockStorage.getItem("byos.signature.html.box1") === null, "HTML key should be removed");
  });

  // 7. applySignature appends signature to plaintext
  test("7. applySignature appends signature to plaintext", () => {
    const msg = "Hello World";
    const result = applySignature(msg, "Alice");
    assert(result === "Hello World\n\n-- \nAlice", "applySignature should append signature");

    const empty = applySignature(msg, "   ");
    assert(empty === msg, "applySignature should return original text if signature is empty");
  });

  // 8. applySignatureHtml appends byos-signature div to HTML
  test("8. applySignatureHtml appends byos-signature div to HTML", () => {
    const htmlWithoutSig = "<p>Hello World</p>";
    const result = applySignatureHtml(htmlWithoutSig, "<b>Alice</b>");
    assert(
      result === '<p>Hello World</p><div class="byos-signature"><br>-- <br><b>Alice</b></div>',
      `Unexpected applySignatureHtml result: ${result}`
    );

    const empty = applySignatureHtml(htmlWithoutSig, "   ");
    assert(empty === htmlWithoutSig, "applySignatureHtml should return original html if signature is empty");
  });

  // 9. Server hydration writes both keys to localStorage
  test("9. Server hydration writes both keys to localStorage", () => {
    mockStorage.clear();
    const serverSettings = {
      signature_plain: "Plain text",
      signature_html: "<b>HTML text</b>",
    };
    if (serverSettings.signature_plain !== undefined) {
      saveSignature("box1", serverSettings.signature_plain);
    }
    if (serverSettings.signature_html !== undefined) {
      saveSignatureHtml("box1", serverSettings.signature_html);
    }
    assert(loadSignature("box1") === "Plain text", "Hydrated plain matches");
    assert(loadSignatureHtml("box1") === "<b>HTML text</b>", "Hydrated HTML matches");
  });

  // 10. Server hydration with empty signature_html removes the key (does not leave stale data)
  test("10. Server hydration with empty signature_html removes the key", () => {
    mockStorage.clear();
    saveSignatureHtml("box1", "<p>Stale HTML</p>");
    assert(loadSignatureHtml("box1") === "<p>Stale HTML</p>", "Initial setup");
    const serverSettings = {
      signature_plain: "Updated plain",
      signature_html: "",
    };
    if (serverSettings.signature_plain !== undefined) {
      saveSignature("box1", serverSettings.signature_plain);
    }
    if (serverSettings.signature_html !== undefined) {
      saveSignatureHtml("box1", serverSettings.signature_html);
    }
    assert(mockStorage.getItem("byos.signature.html.box1") === null, "Stale HTML was removed");
    assert(loadSignatureHtml("box1") === "<p>Updated plain</p>", "Falls back to updated plain");
  });

  // 11. Server hydration with only signature_plain leaves signature_html absent
  test("11. Server hydration with only signature_plain leaves signature_html absent", () => {
    mockStorage.clear();
    const serverSettings = {
      signature_plain: "Solo plain",
      signature_html: undefined as string | undefined,
    };
    if (serverSettings.signature_plain !== undefined) {
      saveSignature("box1", serverSettings.signature_plain);
    }
    if (serverSettings.signature_html !== undefined) {
      saveSignatureHtml("box1", serverSettings.signature_html);
    }
    assert(mockStorage.getItem("byos.signature.html.box1") === null, "HTML key should remain absent");
    assert(loadSignatureHtml("box1") === "<p>Solo plain</p>", "Falls back to plain conversion");
  });

  return { passed, failed };
}
