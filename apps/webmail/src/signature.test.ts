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

  // 7. applySignature skips if signature already present
  test("7. applySignature skips if signature already present", () => {
    const original = "Hello World\n\n-- \nAlice";
    const result = applySignature(original, "Alice");
    assert(result === original, "applySignature should not duplicate if already present");

    const newMsg = "Hello World";
    const resultNew = applySignature(newMsg, "Alice");
    assert(resultNew === "Hello World\n\n-- \nAlice", "applySignature should append if not present");
  });

  // 8. applySignatureHtml skips if byos-signature div already present
  test("8. applySignatureHtml skips if byos-signature div already present", () => {
    const htmlWithSig = '<p>Hello World</p><div class="byos-signature"><p>-- </p><b>Alice</b></div>';
    const result1 = applySignatureHtml(htmlWithSig, "<b>Alice</b>");
    assert(result1 === htmlWithSig, "applySignatureHtml should not duplicate if byos-signature present");

    const htmlWithoutSig = "<p>Hello World</p>";
    const result2 = applySignatureHtml(htmlWithoutSig, "<b>Alice</b>");
    assert(
      result2 === '<p>Hello World</p><div class="byos-signature"><br>-- <br><b>Alice</b></div>',
      `Unexpected applySignatureHtml result: ${result2}`
    );
  });

  return { passed, failed };
}
