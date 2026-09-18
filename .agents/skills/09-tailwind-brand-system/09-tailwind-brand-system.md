# UI Engineering: Tailwind & Brand System Constraints

## Trigger
Load this skill when modifying layouts, typography, spacing, styling, or CSS classes across the application.

## Core Directives

1. **Strict Palette Enforcement:** Use only the authorized BYOS brand palette:
   - Cloud Dancer Light: `bg-[#F0EEE9]` (Canvas), `bg-white` (Surfaces)
   - Mocha Mousse: `bg-[#9E725F]` (Primary Action), `hover:bg-[#865E4D]`, `bg-[#F2E8E2]` (Soft/Tint)
   - Neutral Charcoal: `text-[#3C3D3E]` (Primary Text), `text-[#6F7173]` (Muted), `border-[#E2DFD8]` (Borders)
   - DO NOT invent hex codes. DO NOT use default Tailwind colors (e.g., `text-gray-500`) unless explicitly permitted.
2. **Layout Invariants:**
   - Maintain the 380px split-pane architecture. In split mode, the list is exactly `w-[380px]` and the reading pane is `flex-1`.
   - Prevent UI clipping by strictly managing `z-index` and using `flex-shrink-0` on badges, icons, and avatars.
3. **No External CSS:** Do not add custom CSS to stylesheets unless a feature is impossible to achieve with standard Tailwind utility classes (e.g., custom scrollbar pseudo-selectors).
4. **Clean SVG Stroke Icons:** Emojis are banned. All icons must be unified stroke SVGs (Lucide-style) styled with Tailwind text/stroke classes.