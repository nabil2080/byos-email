export interface ShortcutHandler {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  description: string;
  action: () => void;
  // If true, this shortcut fires even when focus is in a text field
  firesInInput?: boolean;
}

export function isTextInputElement(el: Element | null | any): boolean {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement && el.isContentEditable) return true;
  if (Boolean(el.isContentEditable)) return true;
  if (typeof el.closest === "function" && Boolean(el.closest('[contenteditable="true"]'))) return true;
  return false;
}

export function matchShortcut(
  e: KeyboardEvent | { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  shortcut: ShortcutHandler,
): boolean {
  if (e.key.toLowerCase() !== shortcut.key.toLowerCase()) return false;
  if (Boolean(shortcut.shift) !== Boolean(e.shiftKey)) return false;
  if (Boolean(shortcut.ctrl) !== Boolean(e.ctrlKey)) return false;
  if (Boolean(shortcut.meta) !== Boolean(e.metaKey)) return false;
  return true;
}
