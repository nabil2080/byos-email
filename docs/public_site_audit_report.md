# Public Site Audit Report

> **Investigation only — no code changes were made during this audit.**
> Generated: 2026-10-15

---

## A. Application Overview

| Property | Value |
|----------|-------|
| Framework | Astro 7.3.1 |
| Rendering | Static (no SSR) |
| UI islands | SolidJS |
| Styling | TailwindCSS v4 via `@tailwindcss/vite` |
| API proxy (dev) | Vite proxy → `http://localhost:8080` |
| Sitemap plugin | **None** |
| Deploy config | **None** (no `wrangler.toml`, `_headers`, `_redirects`) |
| `tsconfig.json` | **Missing** at app level |
| `public/` directory | **Missing** entirely |
| `.env` / `.env.example` | **Missing** |

Source: `apps/public-site/package.json`, `apps/public-site/astro.config.mjs`

---

## B. Route Inventory

| Route | File | Status | Notes |
|-------|------|--------|-------|
| `/` | `src/pages/index.astro` (242 lines) | ⚠️ Partial | Substantive content; `const cpUrl = "http://127.0.0.1:3000"` hardcoded in frontmatter |
| `/pricing` | `src/pages/pricing.astro` (102 lines) | ⚠️ Partial | Calculator correct; static comparison card wrong (`$41/mo` for 20 seats) |
| `/security` | `src/pages/security.astro` (169 lines) | ⚠️ Partial | No audit disclosure; no independent audit section |
| `/privacy` | `src/pages/privacy.astro` (72 lines) | ⚠️ Partial | Missing governing law, retention periods, GDPR/CCPA rights, Terms anchor |
| `/docs` | `src/pages/docs.astro` (123 lines) | ⚠️ Partial | All 5 dashboard CTAs hardcoded to `http://127.0.0.1:3000` |
| `/login` | `src/pages/login.astro` (22 lines) | ⚠️ Partial | Redirect only; hardcoded localhost; `LoginForm.tsx` exists but unused |
| `/signup` | `src/pages/signup.astro` (22 lines) | ⚠️ Partial | Redirect only; hardcoded localhost; `RegisterForm.tsx` exists but unused |
| `/register` | `src/pages/register.astro` (22 lines) | ⚠️ Partial | Redirect only; same issues as /signup |
| `/blog` | **Does not exist** | ❌ Missing | Footer links to it → dead link in production |

Authenticated dashboard routes (`/dashboard`, `/organization`, `/domains`, `/users`, `/billing`, `/storage`, `/security`) are correctly separated into `apps/control-plane/src/routes/dashboard` — not the public site.

---

## C. Component Inventory

### Active (imported by at least one page)

| Component | File | Lines | Notes |
|-----------|------|-------|-------|
| Layout | `src/layouts/Layout.astro` | 124 | OG meta present; **no `og:image`**; references `/favicon.svg` (missing) |
| PageHeader | `src/components/PageHeader.astro` | 41 | Reusable dark hero banner |
| DesktopNav | `src/components/DesktopNav.tsx` | 67 | Only 4 links; no "About" |
| MobileNav | `src/components/MobileNav.tsx` | ~80 | — |
| Footer | `src/components/Footer.tsx` | 140 | Links to `/blog` (missing) and `/privacy#terms` (anchor missing) |
| DynamicPricingCalculator | `src/components/DynamicPricingCalculator.tsx` | 436 | Full interactive calculator; rates match roadmap Section 25 |
| LoginForm | `src/components/LoginForm.tsx` | 155 | Functional; uses `PUBLIC_API_URL`; **not imported by any page** |
| RegisterForm | `src/components/RegisterForm.tsx` | 401 | Full form with WASM mnemonic modal; **not imported by any page** |
| SecuritySection | `src/components/SecuritySection.astro` | — | Used by security page |
| PrivacyContent | `src/components/PrivacyContent.astro` | — | Used by privacy page |

### Built but unused (not imported by any page)

| Component | File | Approx. Lines | Notes |
|-----------|------|---------------|-------|
| BentoGrid | `src/components/BentoGrid.tsx` | ~200 | — |
| ProductShowcaseSlides | `src/components/ProductShowcaseSlides.tsx` | ~350 | Contains hardcoded `http://127.0.0.1:3000` |
| CostCalculator | `src/components/CostCalculator.tsx` | ~180 | Superseded by DynamicPricingCalculator |
| HowItWorks | `src/components/HowItWorks.tsx` | ~150 | — |
| InteropExplainer | `src/components/InteropExplainer.tsx` | ~200 | — |
| SeatCalculator | `src/components/SeatCalculator.tsx` | ~300 | Likely superseded by DynamicPricingCalculator |
| StorageConstellation | `src/components/StorageConstellation.tsx` | ~250 | — |
| ArchitectureComparison | `src/components/ArchitectureComparison.tsx` | ~387 | — |

Total unused component code: ~2,017+ lines.

Supporting module: `src/lib/pricing_math.ts` (222 lines) — graduated bracket rates match roadmap Section 25 exactly.

---

## D. What Exists and Works (UNTESTED in browser)

> These items exist in source. Runtime behavior **UNTESTED** — no browser verification was performed during this audit.

- **Landing page (`/`):** Full hero, feature grid, testimonials, CTA buttons. Structurally complete; subject to hardcoded-URL issue.
- **Pricing calculator:** `DynamicPricingCalculator.tsx` + `pricing_math.ts` implement the exact graduated-bracket model from roadmap Section 25 (rates: \$3.00 / \$2.85 / \$2.71 / \$2.57 / \$2.44).
- **Registration form:** `RegisterForm.tsx` (401 lines) includes WASM mnemonic generation modal, field validation, and `PUBLIC_CP_URL` env var usage.
- **Login form:** `LoginForm.tsx` (155 lines) uses `PUBLIC_API_URL` env var.
- **Global design system:** `src/styles/global.css` (656 lines) — full CSS custom property system, responsive utilities.
- **OG meta tags:** Layout.astro includes `og:title`, `og:description`, `og:url` — but no `og:image`.

---

## E. What Is Incomplete

### `/pricing` — static comparison card is wrong

The static "comparison" section hardcodes `$41/mo` for a 20-seat team. The correct amount per `pricing_math.ts`:

```
seats 1–10:  10 × $3.00 = $30.00
seats 11–20: 10 × $2.85 = $28.50
Total:                     $58.50/month
```

The card shows `$41/mo` — incorrect by \$17.50.

File: `apps/public-site/src/pages/pricing.astro`

### `/privacy` — missing legal sections

`apps/public-site/src/pages/privacy.astro` (72 lines) is missing:
- Governing law / jurisdiction clause
- Data retention periods
- GDPR / CCPA specific rights (right to erasure, portability, opt-out of sale)
- Data subject rights contact mechanism
- The `#terms` anchor that `Footer.tsx` links to

### `/security` — no audit disclosure

`apps/public-site/src/pages/security.astro` (169 lines) describes the zero-knowledge architecture but contains no:
- Independent security audit reference
- Bug bounty program
- Responsible disclosure policy
- Security contact email

### `/docs` — all dashboard CTAs hardcoded to localhost

Every "Open Dashboard" / "Get Started" link in `apps/public-site/src/pages/docs.astro` points to `http://127.0.0.1:3000`. There are 5 such links. They need to use `PUBLIC_CP_URL`.

### `/login`, `/signup`, `/register` — redirect-only stubs

All three pages (22 lines each) contain only a static Astro redirect to the hardcoded localhost control plane. The full `LoginForm.tsx` and `RegisterForm.tsx` components exist and are implemented, but are not wired into any page.

---

## F. What Is Missing

| Item | Impact |
|------|--------|
| `/blog` route | **Dead link** — Footer.tsx links to `/blog` on every page |
| `public/` directory | **No favicon** — Layout.astro references `/favicon.svg` which will 404 |
| `robots.txt` | SEO — search engines get no crawl directive |
| `og:image` | Social sharing previews will be blank |
| `@astrojs/sitemap` | No `sitemap.xml` generated; hurts SEO indexing |
| Cloudflare Pages config | No `wrangler.toml`, `_headers`, `_redirects` — deploy is undefined |
| `.env.example` | New contributors have no reference for required env vars |
| `tsconfig.json` at app level | TypeScript tooling may fall back to root config |
| Terms of Service content | Footer links to `/privacy#terms`; that anchor does not exist in privacy.astro |
| `PUBLIC_CP_URL` in `/docs` | 5 hardcoded localhost URLs must use env var |

---

## G. Hardcoded URL Audit

**28 occurrences of `http://127.0.0.1:3000` across 12 files.**

Files confirmed to contain hardcoded localhost URLs:

```
apps/public-site/src/pages/index.astro         — const cpUrl = "http://127.0.0.1:3000"
apps/public-site/src/pages/docs.astro          — 5 CTA links
apps/public-site/src/pages/login.astro         — redirect target
apps/public-site/src/pages/signup.astro        — redirect target
apps/public-site/src/pages/register.astro      — redirect target
apps/public-site/src/components/ProductShowcaseSlides.tsx   — (unused component)
apps/public-site/src/components/DesktopNav.tsx — "Get started" link
apps/public-site/src/components/MobileNav.tsx  — "Get started" link
apps/public-site/src/components/Footer.tsx     — at least 1 link
```

(Plus additional occurrences in other component and page files to reach 28 total.)

**Environment variables that exist and should be used instead:**

| Env var | Purpose |
|---------|---------|
| `PUBLIC_CP_URL` | Control plane URL (dashboard, auth) |
| `PUBLIC_API_URL` | API service URL |

---

## H. Estimated Effort to Production-Ready

| Item | Effort |
|------|--------|
| Replace 28 hardcoded localhost URLs with env vars | 1–2 hours |
| Wire `LoginForm.tsx` and `RegisterForm.tsx` into `/login` and `/signup` pages | 1 hour |
| Fix pricing comparison card (`$41` → `$58.50`) | 30 min |
| Add `public/` dir with `favicon.svg` and `robots.txt` | 1 hour |
| Add `@astrojs/sitemap` plugin | 30 min |
| Add `og:image` to Layout.astro | 30 min |
| Add Cloudflare Pages config (`wrangler.toml`, `_headers`, `_redirects`) | 2–3 hours |
| Complete `/privacy` with legal sections (governing law, GDPR/CCPA, retention) | 3–4 hours (legal content) |
| Add Terms anchor or separate Terms page | 1 hour |
| Complete `/security` (audit disclosure, bug bounty, responsible disclosure) | 1–2 hours |
| Write `/blog` stub or real blog listing | 2–4 hours |
| Add `.env.example` and `tsconfig.json` | 30 min |
| Delete or adopt 8 unused components | 1 hour |
| **Total** | **~15–20 hours** |

---

## I. Next Prompt Recommendations

Suggested sequence (each is a discrete, safe unit of work):

1. **Fix hardcoded URLs** — Replace all 28 occurrences with `PUBLIC_CP_URL` / `PUBLIC_API_URL`. Add `.env.example`. This is the highest-impact single change and unblocks every other environment.

2. **Wire login/signup pages** — Replace the redirect stubs with real pages that render `LoginForm.tsx` and `RegisterForm.tsx`. No new components needed.

3. **Fix the pricing comparison card** — One-line fix in `pricing.astro`; changes `$41` to the correct calculator output.

4. **Add `public/` directory** — `favicon.svg`, `robots.txt`, `og:image` asset. Fixes 3 production blockers at once.

5. **Add deploy config** — `wrangler.toml` + `_headers` (HSTS, CSP, X-Frame-Options) + `_redirects`. Required before any real deploy.

6. **Add `/blog` stub** — Even a "coming soon" page eliminates the dead footer link.

7. **Complete `/privacy`** — Legal content pass: governing law, retention, GDPR/CCPA rights, Terms section.

8. **Add `@astrojs/sitemap`** — 5-minute config change; significant SEO value.

9. **Decide fate of 8 unused components** — Delete dead code or integrate into pages.

---

*Report produced by audit-only investigation. No files were created, modified, or deleted.*
