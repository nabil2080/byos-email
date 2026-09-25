import {
  isTextInputElement,
  matchShortcut,
  ShortcutHandler,
} from "./keyboard_shortcuts.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runKeyboardShortcutsTests(): { passed: number; failed: number } {
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

  console.log("Running Keyboard Shortcuts Tests...");

  // 1. isTextInputElement returns true for input, textarea, contenteditable
  test("1. isTextInputElement returns true for input, textarea, contenteditable", () => {
    const inputEl = { tagName: "INPUT" } as any;
    assert(isTextInputElement(inputEl), "INPUT tag should return true");

    const textareaEl = { tagName: "TEXTAREA" } as any;
    assert(isTextInputElement(textareaEl), "TEXTAREA tag should return true");

    const contentEditableEl = {
      tagName: "DIV",
      isContentEditable: true,
    } as any;
    assert(isTextInputElement(contentEditableEl), "contenteditable DIV should return true");

    const nestedInEditableEl = {
      tagName: "SPAN",
      isContentEditable: false,
      closest: (sel: string) => (sel === '[contenteditable="true"]' ? {} : null),
    } as any;
    assert(isTextInputElement(nestedInEditableEl), "child inside contenteditable should return true");
  });

  // 2. isTextInputElement returns false for div, button, body
  test("2. isTextInputElement returns false for div, button, body", () => {
    const divEl = { tagName: "DIV", isContentEditable: false } as any;
    assert(!isTextInputElement(divEl), "normal DIV should return false");

    const buttonEl = { tagName: "BUTTON" } as any;
    assert(!isTextInputElement(buttonEl), "BUTTON should return false");

    const bodyEl = { tagName: "BODY" } as any;
    assert(!isTextInputElement(bodyEl), "BODY should return false");

    assert(!isTextInputElement(null), "null element should return false");
  });

  // 3. matchShortcut matches plain keys correctly
  test("3. matchShortcut matches plain keys correctly", () => {
    const composeShortcut: ShortcutHandler = {
      key: "c",
      description: "Compose",
      action: () => {},
    };

    assert(
      matchShortcut({ key: "c" }, composeShortcut),
      "lowercase 'c' should match"
    );
    assert(
      matchShortcut({ key: "C" }, composeShortcut),
      "case-insensitive 'C' with no shiftKey should match"
    );
    assert(
      !matchShortcut({ key: "x" }, composeShortcut),
      "'x' should not match compose shortcut"
    );

    const escapeShortcut: ShortcutHandler = {
      key: "Escape",
      description: "Close",
      action: () => {},
    };
    assert(
      matchShortcut({ key: "Escape" }, escapeShortcut),
      "'Escape' should match"
    );
    assert(
      matchShortcut({ key: "escape" }, escapeShortcut),
      "'escape' lowercase should match"
    );
  });

  // 4. matchShortcut respects shift, ctrl, meta modifiers
  test("4. matchShortcut respects shift, ctrl, meta modifiers", () => {
    const helpShortcut: ShortcutHandler = {
      key: "?",
      shift: true,
      description: "Help",
      action: () => {},
    };
    assert(
      matchShortcut({ key: "?", shiftKey: true }, helpShortcut),
      "'?' with shiftKey=true should match"
    );

    const ctrlShortcut: ShortcutHandler = {
      key: "k",
      ctrl: true,
      description: "Command Palette",
      action: () => {},
    };
    assert(
      matchShortcut({ key: "k", ctrlKey: true }, ctrlShortcut),
      "'k' with ctrlKey=true should match"
    );
    assert(
      !matchShortcut({ key: "k", ctrlKey: false }, ctrlShortcut),
      "'k' without ctrlKey should fail"
    );

    const metaShortcut: ShortcutHandler = {
      key: "k",
      meta: true,
      description: "Command Palette Mac",
      action: () => {},
    };
    assert(
      matchShortcut({ key: "k", metaKey: true }, metaShortcut),
      "'k' with metaKey=true should match"
    );
  });

  // 5. matchShortcut rejects when shift state mismatches
  test("5. matchShortcut rejects when shift state mismatches", () => {
    const composeShortcut: ShortcutHandler = {
      key: "c",
      description: "Compose",
      action: () => {},
    };
    assert(
      !matchShortcut({ key: "c", shiftKey: true }, composeShortcut),
      "unwanted shiftKey on 'c' should be rejected"
    );

    const helpShortcut: ShortcutHandler = {
      key: "?",
      shift: true,
      description: "Help",
      action: () => {},
    };
    assert(
      !matchShortcut({ key: "?", shiftKey: false }, helpShortcut),
      "missing shiftKey on '?' should be rejected"
    );
    assert(
      !matchShortcut({ key: "?" }, helpShortcut),
      "undefined shiftKey on '?' should be rejected"
    );
  });

  return { passed, failed };
}
