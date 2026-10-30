---
name: tailwindcss
description: Use when designing/implementing UI with Tailwind CSS (layout, typography, responsive, theming, component patterns). Includes quick recipes and conventions for clean, consistent web design.
---

# Tailwind CSS — Utility-first Styling Skill (BYOS Edition)

## BYOS Platform & Technology Invariants

> [!IMPORTANT]
> Within the BYOS platform, Tailwind CSS is applied across two dedicated stacks:
> - **Dashboard & Mailbox UI (`apps/webmail/`, `apps/control-plane/`):** `SolidJS + Vite + TailwindCSS`
> - **Public Website (`apps/public-site/`):** `Astro + SolidJS + TailwindCSS`
>
> In all BYOS components, always enforce:
> 1. **SolidJS JSX:** Use `class="..."` (never `className`). Never interpolate dynamic class names that break static analysis.
> 2. **Authorized Palette (`09-tailwind-brand-system`):**
>    - Canvas: `bg-[#F0EEE9]`
>    - Card/Surface: `bg-white`
>    - Primary Action: `bg-[#9E725F]` (`hover:bg-[#865E4D]`, tint `bg-[#F2E8E2]`)
>    - Text: `text-[#3C3D3E]` (Primary), `text-[#6F7173]` (Muted)
>    - Borders: `border-[#E2DFD8]`
> 3. **Infrastructure Motion:** Snappy transitions (`duration-150` to `duration-250`, `ease-out`). No bouncy spring animations.
> 4. **Mobile Scale:** Flawless scaling down to 375px without horizontal scrolling.

## When to use
- Rapid UI building with consistent spacing/typography scales
- Design systems where composition beats bespoke CSS
- Component-driven apps (SolidJS in Webmail/Control-Plane; Astro + SolidJS in Public-Site)

## Key concepts & patterns
- Utilities compose in HTML/JSX: `class="flex gap-4 p-6 bg-[#F0EEE9] text-[#3C3D3E]"`
- Responsive variants: `sm: md: lg: xl:` etc.
- State variants: `hover:`, `focus:`, `active:`, `disabled:`, `group-hover:`, `peer-checked:`
- Arbitrary values (use sparingly): `w-[380px]` (standard split mailbox list), `bg-[#F0EEE9]`, `bg-[#9E725F]`
- Dark mode patterns: `dark:` with class-based strategy
- Extracting repeated patterns:
  - Prefer components (SolidJS / Astro components) first
  - Then `@apply` for small reusable patterns (avoid overuse)
- Build pipeline:
  - Tailwind scans “content” files for class names and generates CSS (zero-runtime)

## Common pitfalls
- Classes not generated in production
  - Ensure content paths include all templates/components.
  - Avoid building class names dynamically (e.g. `"text-" + color`) unless safelisted.
- Overusing `@apply` and losing the utility-first benefits
- Conflicting styles due to class order assumptions
- Huge HTML class lists with no structure
  - Use component composition; break into subcomponents; use `clsx/cva` when needed.

## Quick recipes

### 1) A clean CTA button (BYOS Brand Spec)
```html
<button class="inline-flex items-center justify-center rounded-md px-4 py-2
               bg-[#9E725F] text-white font-medium text-sm
               hover:bg-[#865E4D] active:bg-[#724e3f]
               focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50
               transition-colors duration-150">
  Get started
</button>
```

### 2) Responsive hero layout (BYOS Spec)
```html
<section class="mx-auto max-w-6xl px-6 py-16 bg-[#F0EEE9]">
  <div class="grid gap-10 lg:grid-cols-2 lg:items-center">
    <div>
      <h1 class="text-4xl font-semibold tracking-tight text-[#3C3D3E] sm:text-5xl">
        Private, verifiable email for teams.
      </h1>
      <p class="mt-4 text-[#6F7173] text-lg">
        Zero-knowledge encryption with client-side keys and full CalDAV interoperability.
      </p>
    </div>
    <div class="rounded-xl border border-[#E2DFD8] bg-white p-6 shadow-sm">
      <!-- media -->
    </div>
  </div>
</section>
```

### 3) Handling dynamic classnames safely in SolidJS
Prefer mapping:
```js
const toneClass = {
  success: "bg-emerald-600 text-white",
  danger: "bg-rose-600 text-white",
  primary: "bg-[#9E725F] text-white",
}[props.tone];
```

## What to ask the user
- Framework/build tool (Vite + SolidJS in apps/webmail; Astro + SolidJS in apps/public-site)?
- Do we need a design system (tokens, component library) or a one-off page?
- Accessibility constraints (`11-accessibility-a11y`)?
