# UI Engineering: Accessibility & Keyboard Navigation

## Trigger
Load this skill when designing interactive components, dropdowns, forms, or navigating lists.

## Core Directives

1. **Keyboard First:** All interactive elements must be accessible via keyboard. Implement global hotkeys (e.g., `/` for search, `R` for reply) and arrow-key navigation for the message list.
2. **Focus States:** Every button, input, and interactive `div` must have a visible focus ring using the brand palette (e.g., `focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50`).
3. **ARIA Semantics:** 
   - Add `aria-label` to all SVG icon buttons that lack text descriptions.
   - Use `aria-expanded` and `aria-haspopup` for dropdown toggles (Account Switcher, action menus).
   - Add `role="button"` and `tabindex="0"` to any `div` that is clickable but not a native `<button>`.
4. **Escape Key Handling:** Any open modal, dropdown, or compose drawer must intercept the `Escape` key and close cleanly, returning focus to the previous element.