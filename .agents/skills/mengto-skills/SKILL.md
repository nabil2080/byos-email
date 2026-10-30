---
name: mengto-skills
description: >-
  Comprehensive design craftsmanship, UI/UX prompting, and web engineering skill library
  by Meng To (@MengTo/Skills), fully migrated into the BYOS architecture.
  Provides production-grade patterns for landing pages, pricing tables, anti-slop guidelines,
  design-first prompting, advanced Tailwind layouts, micro-interactions, SVG illustrations,
  and 3D/WebGL effects.
  Use when designing, building, or refining UI components in apps/webmail/, apps/control-plane/,
  or apps/public-site/.
argument-hint: "[web-design|ui|workflow|codex|illustration|3d]"
metadata:
  author: Meng To
  repository: https://github.com/mengto/skills
  adapted-for: BYOS Email Platform
  version: "1.0.0"
---

# Meng To Design Craftsmanship & Web Engineering Skills (BYOS Edition)

## When to Apply

Load this skill whenever:
- Designing or implementing SaaS marketing pages, landing pages, or pricing tables.
- Applying advanced layout techniques: container lines, corner lasers, progressive blur, border gradients, split layouts.
- Formulating design-first UI prompts or running anti-slop quality gates.
- Adding subtle micro-interactions, scroll triggers, or canvas/WebGL accents.
- Generating handcrafted SVG spot illustrations from defined style palettes.
- Building, refining, or reviewing frontend components across `apps/webmail/`, `apps/control-plane/`, or `apps/public-site/`.

---

## Non-Negotiable BYOS Core Technology Invariants

> [!IMPORTANT]
> All patterns from the upstream Meng To repository must be translated into the frozen BYOS technology stack. Never introduce React, Next.js, Vue, or unapproved styling libraries.

| Surface / Layer | Authorized Technology Stack | Architectural Scope | Key Invariants |
| :--- | :--- | :--- | :--- |
| **Dashboard & Mailbox UI** | `SolidJS + Vite + TailwindCSS` | Authenticated web applications (`apps/webmail`, `apps/control-plane`) | Zero-knowledge security boundary; reactive signals/stores; 380px split pane. |
| **Public Website** | `Astro + SolidJS + TailwindCSS` | Marketing, documentation, legal, and SEO (`apps/public-site`) | Static Astro layouts with interactive SolidJS client islands (`client:load`, `client:visible`). |
| **Client Crypto Core** | `Rust + WebAssembly` | In-browser zero-knowledge crypto (`byos_crypto_core`) | Strict isolation; UI components never touch plaintext keys directly. |

---

## Architectural & Style Alignment Rules

When adapting Meng To recipes, strictly enforce these platform guidelines:

### 1. SolidJS Reactivity Constraints (`08-solidjs-reactivity`)
- **Never Destructure Props:** Destructuring breaks Solid reactivity. Always use `props.propertyName` or `splitProps`.
- **Strict Control Flow:** Use `<For>` and `<Index>` for list rendering; `<Show>` for conditional blocks. Never use `.map()` or ternary expressions for large trees.
- **Reactive State:** Use `createSignal` for local primitives, `createStore` for structured objects. Never mutate state directly.
- **Canvas/GSAP Lifecycle:** Initialize animations/listeners in `onMount` and always clean up in `onCleanup(() => { ... })`.

### 2. Tailwind & Brand System Constraints (`09-tailwind-brand-system`)
- **Authorized BYOS Brand Palette:**
  - *Cloud Dancer Light (Surfaces):* `bg-[#F0EEE9]` (Canvas), `bg-white` (Cards/Surfaces).
  - *Mocha Mousse (Actions):* `bg-[#9E725F]` (Primary Action), `hover:bg-[#865E4D]`, `bg-[#F2E8E2]` (Soft Tint).
  - *Neutral Charcoal (Typography & Borders):* `text-[#3C3D3E]` (Primary Text), `text-[#6F7173]` (Muted Text), `border-[#E2DFD8]` (Borders).
- **Prohibited:** Never invent random hex codes or default to generic purple gradients. Emojis are strictly banned; use clean Lucide-style single-stroke SVGs.
- **Mailbox Split-Pane Invariant:** In split mode, the message list is exactly `w-[380px]` and the reading pane is `flex-1`.

### 3. Global Motion Archetype (`AGENTS.md`)
- **Archetype:** Snappy, deliberate, and professional **"infrastructure"** motion.
- **Durations:** Micro-interactions: 100ms–200ms; state transitions: 200ms–300ms.
- **Easing:** Linear, standard `ease-out`, or subtle decel curves (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Prohibited:** Bouncy, playful, elastic, or cartoonish springs are **strictly forbidden** on this zero-knowledge email platform.

### 4. Responsive Mobile Architecture (`AGENTS.md` & `responsive-craft`)
- All components must scale down to a **375px mobile viewport** without horizontal scrolling (`overflow-x-hidden`).
- Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) and component-level container queries (`@container`).

### 5. Accessibility & Semantics (`11-accessibility-a11y`)
- Keyboard first: Every interactive element must be keyboard-focusable with visible focus rings (`focus:ring-2 focus:ring-[#9E725F]/50`).
- ARIA semantics: Add `aria-label` to icon-only buttons, `aria-expanded` to popovers, and handle the `Escape` key cleanly.

### 6. Zero-Knowledge Cryptographic Isolation (`04-crypto-boundary`, `10-wasm-ui-bridge`)
- Background shaders, WebGL canvases, and UI animations must remain strictly decoupled from encryption buffers and private keys.

---

## Technology Migration Matrix: Upstream Patterns → BYOS

| Upstream / Meng To Pattern | BYOS Mailbox & Dashboard (`apps/webmail`, `apps/control-plane`) | BYOS Public Site (`apps/public-site`) |
| :--- | :--- | :--- |
| **Framework** | SolidJS + Vite | Astro + SolidJS |
| **Component Syntax** | `.tsx` with Solid JSX (`class=`, not `className=`) | `.astro` layouts/pages with `.tsx` Solid islands |
| **State Management** | `const [val, setVal] = createSignal(initial)` | Static props in Astro; `createSignal` in client islands |
| **List Iteration** | `<For each={items()}>{(item) => <Item {...item} />}</For>` | Static array `.map()` in Astro; `<For>` in Solid islands |
| **Conditionals** | `<Show when={isOpen()} fallback={<Fallback />}>...</Show>` | Native JS `if` in Astro; `<Show>` in Solid islands |
| **Island Directives** | N/A (pure SPA) | `<PricingWidget client:visible />`, `<Demo client:idle />` |
| **Styling** | Tailwind CSS with BYOS tokens (`bg-[#F0EEE9]`, `text-[#3C3D3E]`) | Tailwind CSS with BYOS tokens (`bg-[#F0EEE9]`, `text-[#3C3D3E]`) |
| **GSAP / Motion** | GSAP with `onMount` and `onCleanup(ctx.revert)` | Native CSS transitions or client island with `onMount` |
| **Three.js / WebGL** | Mount into ref `<div>` in `onMount`, dispose in `onCleanup` | Background WebGL island with `client:idle` |

---

## Code Translation Examples

### Upstream React / Next.js Pattern:
```tsx
// DO NOT USE THIS IN BYOS:
import { useState, useEffect } from 'react';

export function UpstreamPricingCard({ title, price, features }) {
  const [active, setActive] = useState(false);
  return (
    <div className={`p-6 rounded-xl ${active ? 'bg-indigo-600' : 'bg-zinc-900'}`}>
      <h3 className="text-xl font-bold">{title}</h3>
      <p className="text-3xl">${price}/mo</p>
      <ul>
        {features.map((f, i) => <li key={i}>{f}</li>)}
      </ul>
      <button onClick={() => setActive(!active)}>Select</button>
    </div>
  );
}
```

### Migrated BYOS SolidJS + Tailwind Pattern:
```tsx
// AUTHORIZED BYOS IMPLEMENTATION:
import { createSignal, For, Show } from 'solid-js';

interface PricingCardProps {
  title: string;
  price: string;
  features: string[];
  popular?: boolean;
}

export function PricingCard(props: PricingCardProps) {
  const [selected, setSelected] = createSignal(false);

  return (
    <div
      class={`p-6 rounded-lg border transition-colors duration-200 ${
        selected()
          ? 'bg-white border-[#9E725F] shadow-sm'
          : 'bg-[#F0EEE9]/40 border-[#E2DFD8] hover:border-[#9E725F]/40'
      }`}
    >
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-semibold text-[#3C3D3E]">{props.title}</h3>
        <Show when={props.popular}>
          <span class="text-[11px] font-medium tracking-wide uppercase px-2 py-0.5 rounded bg-[#F2E8E2] text-[#9E725F]">
            Recommended
          </span>
        </Show>
      </div>
      <div class="mb-6">
        <span class="text-3xl font-bold text-[#3C3D3E]">${props.price}</span>
        <span class="text-sm text-[#6F7173]"> / month</span>
      </div>
      <ul class="space-y-2 mb-6">
        <For each={props.features}>
          {(feature) => (
            <li class="flex items-center gap-2 text-sm text-[#6F7173]">
              <svg class="w-4 h-4 text-[#9E725F] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{feature}</span>
            </li>
          )}
        </For>
      </ul>
      <button
        type="button"
        onClick={() => setSelected(!selected())}
        class="w-full py-2.5 px-4 rounded text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 bg-[#9E725F] hover:bg-[#865E4D] text-white"
      >
        {selected() ? 'Selected' : 'Choose Plan'}
      </button>
    </div>
  );
}
```

---

## Migrated Module Catalog & Directory Navigation

All 176+ skill modules are cataloged within this directory. Load the narrowest matching reference before coding:

### 1. UI & Prompting Architecture (`ui/`)
- [`ui/design-first-ui-prompting/SKILL.md`](./ui/design-first-ui-prompting/SKILL.md): Spec-driven UI prompting skeleton (Goal → Format → Layout → Type → Color → Constraints).
- [`ui/no-ai-design-slop/SKILL.md`](./ui/no-ai-design-slop/SKILL.md): Passive quality gates to eradicate generic AI aesthetics, random purple gradients, and clichéd layouts.
- [`ui/audit-ai-design-slop/SKILL.md`](./ui/audit-ai-design-slop/SKILL.md): Comprehensive rubric for scoring design quality and catching interface defects.

### 2. Web Design & SaaS Craftsmanship (`web-design/`)
- **Foundations:**
  - [`web-design/tailwindcss/SKILL.md`](./web-design/tailwindcss/SKILL.md): Utility-first composition adapted to SolidJS and BYOS brand tokens.
  - [`web-design/landing-page/SKILL.md`](./web-design/landing-page/SKILL.md): High-converting SaaS landing page structure (Headline → Proof → Problem → Solution → Primary CTA).
  - [`web-design/pricing-page/SKILL.md`](./web-design/pricing-page/SKILL.md): Uncertainty-reducing pricing tables with annual/monthly toggles and feature comparisons.
  - [`web-design/build-awwwards-quality-sites/SKILL.md`](./web-design/build-awwwards-quality-sites/SKILL.md): High-craft execution guidelines.
- **Layout Systems:**
  - [`web-design/split-layout-technical/SKILL.md`](./web-design/split-layout-technical/SKILL.md): Split-screen interfaces (harmonized with BYOS 380px mailbox split).
  - [`web-design/container-lines/SKILL.md`](./web-design/container-lines/SKILL.md): Subtle 1px structural gridlines (`border-[#E2DFD8]`).
  - [`web-design/nested-container-frames/SKILL.md`](./web-design/nested-container-frames/SKILL.md): Multi-tier framed containers.
  - [`web-design/editorial-tech/SKILL.md`](./web-design/editorial-tech/SKILL.md): Editorial typographic pacing.
- **CSS Effects & Visual Details:**
  - [`web-design/css-border-gradient/SKILL.md`](./web-design/css-border-gradient/SKILL.md): Delicate, non-intrusive gradient borders.
  - [`web-design/progressive-blur/SKILL.md`](./web-design/progressive-blur/SKILL.md): Multi-layer backdrop filters for clean scrims.
  - [`web-design/beautiful-shadows/SKILL.md`](./web-design/beautiful-shadows/SKILL.md): Restrained multi-stop ambient shadows.
  - [`web-design/css-alpha-masking/SKILL.md`](./web-design/css-alpha-masking/SKILL.md): Clean alpha gradients.
- **Motion & Scroll Storytelling:**
  - [`web-design/animation-on-scroll/SKILL.md`](./web-design/animation-on-scroll/SKILL.md): Viewport-triggered reveals (snappy infrastructure archetype).
  - [`web-design/cinematic-gsap-lenis-motion-system/SKILL.md`](./web-design/cinematic-gsap-lenis-motion-system/SKILL.md): Controlled timeline choreography.
- **Canvas & WebGL:**
  - [`web-design/cobejs/SKILL.md`](./web-design/cobejs/SKILL.md): Lightweight canvas globe visualization.
  - [`web-design/globe-gl/SKILL.md`](./web-design/globe-gl/SKILL.md): ThreeJS 3D globe data layers.
  - [`web-design/threejs/SKILL.md`](./web-design/threejs/SKILL.md): Three.js scene architecture and lifecycle cleanup.

### 3. Illustration & Drawing Kits (`illustration/`)
- 14 distinct SVG spot illustration styles with exact geometric drawing kits, palettes, and lint rules:
  - `illustration-flat`, `illustration-outlined-cartoon`, `illustration-vintage-emblem`, `illustration-one-line`, `illustration-isometric-mono`, etc.

### 4. 3D WebGL Materials & Shaders (`3d/`)
- 16 procedural shader and material guides:
  - `3d-ultra-realistic-water`, `3d-underwater-god-rays`, `3d-virtual-tour`, `3d-metal-material`, `3d-sky-rays`, etc.

### 5. Workflows & Quality Automation (`workflow/` & `codex/`)
- [`workflow/workflow-progress-screenshots/SKILL.md`](./workflow/workflow-progress-screenshots/SKILL.md): Automated verification screenshot capture.
- [`workflow/workflow-score-to-target/SKILL.md`](./workflow/workflow-score-to-target/SKILL.md): Iterative rubric scoring to hit target quality.
- [`codex/html-to-interaction-prompts/SKILL.md`](./codex/html-to-interaction-prompts/SKILL.md): Deconstruct HTML sections into reusable prompt specs.
- [`codex/video-to-superprompt/SKILL.md`](./codex/video-to-superprompt/SKILL.md): Convert motion references into precise implementation prompts.

---

## Step-by-Step Implementation Workflow

1. **Step 1: Check Target Surface & Technology**
   - Identify whether modifying `apps/webmail/` (SolidJS + Vite + Tailwind), `apps/control-plane/` (SolidJS + Vite + Tailwind), or `apps/public-site/` (Astro + SolidJS + Tailwind).
2. **Step 2: Read Specific Meng To Submodule**
   - Open the corresponding `SKILL.md` in `web-design/`, `ui/`, etc.
3. **Step 3: Translate to SolidJS & BYOS Brand Tokens**
   - Convert React idioms to SolidJS signals, stores, and `<For>`/`<Show>`.
   - Apply BYOS palette (`#F0EEE9`, `#9E725F`, `#3C3D3E`, `#E2DFD8`).
4. **Step 4: Verify Infrastructure Motion & 375px Viewport**
   - Ensure snappy 150-250ms duration; test on 375px mobile viewport with zero horizontal scroll.
5. **Step 5: Verify Accessibility & Security**
   - Ensure keyboard navigability and visible focus rings; verify zero-knowledge crypto boundary remains untouched.
