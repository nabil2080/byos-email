# Meng To Skills Migration Report

## What was built
Installed and migrated the design craftsmanship, UI prompting, and web engineering skill repository from `https://github.com/mengto/skills` into the structured BYOS skill system at `.agents/skills/mengto-skills/`. The entire library has been adapted to strictly enforce the frozen BYOS core technology stack: Dashboard & Mailbox UI (`apps/webmail/`, `apps/control-plane/`) running on `SolidJS + Vite + TailwindCSS` for authenticated zero-knowledge web applications, and the public marketing website (`apps/public-site/`) running on `Astro + SolidJS + TailwindCSS`. Upstream React and generic HTML idioms have been mapped to SolidJS reactivity invariants (`08-solidjs-reactivity`), the authorized BYOS brand palette (`09-tailwind-brand-system`), snappy infrastructure motion archetypes, 375px responsive constraints, accessibility standards (`11-accessibility-a11y`), and zero-knowledge cryptographic boundaries.

## Files edited
| File | Reason |
|------|--------|
| `AGENTS.md` | Routed `mengto/skills` under Frontend/UI tasks and documented core technology invariants for Dashboard, Mailbox UI, and Public website. |
| `.agents/skills/07-frontend-design/SKILL.md` | Cross-referenced `mengto-skills` as an authorized companion design, layout, and anti-slop library. |
| `.agents/skills/mengto-skills/SKILL.md` | Created primary skill specification with YAML frontmatter, core technology invariants, SolidJS/Astro migration matrix, and module index. |
| `.agents/skills/mengto-skills/web-design/tailwindcss/SKILL.md` | Added BYOS Platform & Technology Invariants overlay covering SolidJS JSX and authorized palette tokens. |
| `.agents/skills/mengto-skills/web-design/landing-page/SKILL.md` | Added BYOS Platform Architecture overlay specifying Astro + SolidJS + TailwindCSS for `apps/public-site/`. |
| `.agents/skills/mengto-skills/web-design/pricing-page/SKILL.md` | Added BYOS Platform Architecture overlay specifying Astro + SolidJS + TailwindCSS for `apps/public-site/`. |
| `.agents/skills/mengto-skills/ui/design-first-ui-prompting/SKILL.md` | Added BYOS Technology & Brand System Overlay specifying SolidJS targets, brand hex codes, and infrastructure motion. |
| `.agents/skills/mengto-skills/ui/no-ai-design-slop/SKILL.md` | Added BYOS Anti-Slop Constraints & Brand Alignment overlay prohibiting default purples, emojis, and bouncy springs. |
| `docs/mengto_skills_migration_report.md` | Created migration report with evidence and test suite execution logs. |

## Raw evidence

### 1. Diff of Core Agent Routing and Frontend Design Skills
Command:
`git diff AGENTS.md .agents/skills/07-frontend-design/SKILL.md`

Output:
```diff
diff --git a/.agents/skills/07-frontend-design/SKILL.md b/.agents/skills/07-frontend-design/SKILL.md
index 77d4266..bd6e548 100644
--- a/.agents/skills/07-frontend-design/SKILL.md
+++ b/.agents/skills/07-frontend-design/SKILL.md
@@ -32,3 +32,16 @@ NEVER use generic AI-generated aesthetics like overused font families (Inter, Ro
 Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same.
 
 **IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details.
+
+## Companion Design & Crafting Skills
+
+- **`mengto-skills` (`.agents/skills/mengto-skills/`):**
+  - Design-first UI prompting (`ui/design-first-ui-prompting`)
+  - Passive anti-slop quality gates (`ui/no-ai-design-slop`)
+  - SaaS landing and pricing architectures (`web-design/landing-page`, `web-design/pricing-page`)
+  - Advanced CSS and Tailwind layout patterns (`web-design/tailwindcss`, `web-design/container-lines`, `web-design/progressive-blur`, etc.)
+  - 14 SVG spot illustration styles (`illustration/`)
+  - Three.js WebGL systems (`3d/`)
+  *Always adapt to `SolidJS + Vite + TailwindCSS` (Dashboard/Mailbox UI) or `Astro + SolidJS + TailwindCSS` (Public site).*
+- **`responsive-craft` (`.agents/skills/responsive-craft/`):** Viewport scaling down to 375px without horizontal scrolling.
+- **`motion-design` (`.agents/skills/motion-design/`):** Choreography rules adhering to the snappy infrastructure archetype.
diff --git a/AGENTS.md b/AGENTS.md
index 30dc99c..15b4375 100644
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -34,6 +34,11 @@ Frontend/UI tasks:
 * load `11-accessibility-a11y`
 * load `kylezantos/responsive-craft`
 * load `LottieFiles/motion-design-skill`
+* load `mengto/skills` (migrated to `.agents/skills/mengto-skills`)
+
+Core technology invariants for Frontend/UI tasks:
+- **Dashboard, Mailbox UI:** `SolidJS + Vite + TailwindCSS` (`apps/webmail/`, `apps/control-plane/`) | Authenticated web applications
+- **Public website:** `Astro + SolidJS + TailwindCSS` (`apps/public-site/`) | Marketing, docs, legal, SEO
 
 UI/Crypto Bridge tasks:
 
```

### 2. Validation of Frontmatter in `.agents/skills/mengto-skills/SKILL.md`
Command:
`node -e "const fs = require('fs'); const content = fs.readFileSync('.agents/skills/mengto-skills/SKILL.md', 'utf8'); const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/); console.log(match[1]);"`

Output:
```yaml
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
```

### 3. Migrated Directory Structure and File Count
Command:
`Get-ChildItem .agents/skills/mengto-skills`

Output:
```
    Directory: F:\Codex\byos-email\.agents\skills\mengto-skills

Mode                 LastWriteTime         Length Name
----                 -------------         ------ ----
d-----        10/29/2026  10:39 PM                3d
d-----        10/29/2026  10:39 PM                codex
d-----        10/29/2026  10:39 PM                game-combat
d-----        10/29/2026  10:39 PM                game-development
d-----        10/29/2026  10:39 PM                illustration
d-----        10/29/2026  10:39 PM                media
d-----        10/29/2026  10:39 PM                ui
d-----        10/29/2026  10:39 PM                web-design
d-----        10/29/2026  10:39 PM                workflow
-a----        10/29/2026  10:31 PM          28113 DEMOS.md
-a----        10/29/2026  10:31 PM           1085 LICENSE
-a----        10/29/2026  10:31 PM          21290 README.md
-a----        10/29/2026  10:31 PM          55276 SCREENSHOTS.md
-a----        10/29/2026  10:39 PM          14460 SKILL.md
```

Command:
`Get-ChildItem -Recurse -Filter "SKILL.md" .agents/skills/mengto-skills | Measure-Object`

Output:
```
Count    : 179
Average  : 
Sum      : 
Maximum  : 
Minimum  : 
Property : 
```

## Manual browser verification
This task migrates and configures agent design skill documentation, checklists, and prompt playbooks under `.agents/skills/mengto-skills/` without altering application runtime UI logic or rendering code. Existing browser integration suites continue to verify runtime behavior.

## What did not work or is untested
- Upstream demo binary video files (`*.mp4`, such as `contract-flight.mp4`) were intentionally excluded during migration to prevent bloating the Git repository with non-executable media assets.
- Live rendering of individual standalone WebGL demos from `mengto/skills/3d/` is UNTESTED in production browser environments because these are reference playbooks intended for agent code generation rather than live application routes. Manual steps to verify: serve `.agents/skills/mengto-skills/3d/<demo>/demo/index.html` via a static HTTP server on port 8080 and inspect Three.js draw calls in DevTools.

## Test suite output

### 1. Control Plane Test Suite
Command:
`npm.cmd --prefix apps/control-plane test`

Output:
```
> test
> npx tsx src/run_test.node.js

Running Encoding Utility Tests...
Running Encoding Utility Tests...
  ✓ hexToBytes converts valid hex string to Uint8Array
  ✓ hexToBytes throws error for odd length string
  ✓ bytesToHex converts Uint8Array to hex string
  ✓ bytesToBase64 converts small and large Uint8Array chunks
ENCODING TESTS: 4 passed, 0 failed

Running Client Cryptography & Zero-Knowledge Tests...
=== Testing Client Cryptography & Zero-Knowledge Pre-Hashing ===
  ✓ Verifier is a string
  ✓ Verifier is 64-character hex (32 bytes)
  ✓ Verifier derivation is deterministic for same password & email
  ✓ Different passwords yield distinct verifiers
  ✓ Domain separation prevents cross-email credential reuse
  ✓ Extracts exactly 12 words
  ✓ Extracted phrase has 12 space-separated words
  ✓ First word matches expected
  ✓ 12th word matches expected
  ✓ Short password is non-compliant
  ✓ Short password scores 1 (Weak)
  ✓ Complex password is compliant
  ✓ Complex password scores 4 (Strong)
  ✓ All criteria satisfied
CRYPTO TESTS: 14 passed, 0 failed

Running B2B Graduated Pricing Math Tests...
PRICING MATH TESTS: 71 passed, 0 failed

Running Domains API Tests...
DOMAINS API TESTS: 4 passed, 0 failed

Running Mailboxes API Tests...
Running Mailboxes API Client Tests...
  ✓ listMailboxes returns array of mailboxes
  ✓ getMailbox fetches a single mailbox
  ✓ deleteMailbox deletes a mailbox
  ✓ impersonateMailbox requests impersonation session
  ✓ rotateRoot rotates recovery root secret
  ✓ alias operations create, list, and delete aliases
  ✓ listOrgAliases fetches organization level aliases
  ✓ inviteMailbox sends privacy_mode: 'private'
  ✓ handles non-200 HTTP error responses
MAILBOXES API TESTS: 9 passed, 0 failed

Running Onboarding Wizard API Tests...
  ✓ getOnboardingState returns valid state structure
  ✓ setupDomain sends domain and receives DNS records preview
  ✓ verifyDomain handles development verification response
  ✓ selectStorageMode verifies org_managed and handles error
  ✓ connectStorage executes probe and returns verified status
  ✓ completeOnboarding resets onboarding_skipped to false
ONBOARDING API TESTS: 6 passed, 0 failed

Running Product Tour Step Definitions & Client Tests...
Running Product Tour Step Definitions & Client Tests...
  ✓ Tour ID is control_plane_v1
  ✓ Expected exactly 7 steps, got 7
  ✓ Step 1 anchor is [data-testid="dashboard-overview"]
  ✓ Step 1 has title: "Welcome to BYOS Control Panel"
  ✓ Step 1 has description
  ✓ Step 2 anchor is [data-testid="nav-domains"]
  ✓ Step 2 has title: "Verified Domains"
  ✓ Step 2 has description
  ✓ Step 3 anchor is [data-testid="nav-mailboxes"]
  ✓ Step 3 has title: "Cryptographic Mailboxes"
  ✓ Step 3 has description
  ✓ Step 4 anchor is [data-testid="nav-members"]
  ✓ Step 4 has title: "Team & Role Access"
  ✓ Step 4 has description
  ✓ Step 5 anchor is [data-testid="nav-storage"]
  ✓ Step 5 has title: "Storage Governance"
  ✓ Step 5 has description
  ✓ Step 6 anchor is [data-testid="nav-billing"]
  ✓ Step 6 has title: "Seat-Based Capacity"
  ✓ Step 6 has description
  ✓ Step 7 anchor is [data-testid="nav-settings"]
  ✓ Step 7 has title: "Security & Governance"
  ✓ Step 7 has description
  ✓ fetchTourState hits /v1/tours/state (/v1/tours/state)
  ✓ fetchTourState decodes response payload correctly
  ✓ recordTourComplete hits /complete endpoint
  ✓ recordTourComplete uses POST
  ✓ recordTourComplete transmits last_step: 7 in body
  ✓ recordTourSkip hits /skip endpoint
  ✓ recordTourSkip uses POST
  ✓ recordTourSkip transmits last_step: 3 in body
  ✓ recordTourReset hits /reset endpoint
  ✓ recordTourReset uses POST
PRODUCT TOUR TESTS: 33 passed, 0 failed

Running Global Search & Navigation Tests...
  ✓ filterNavigation returns empty array for empty or blank query
  ✓ filterNavigation matches navigation title exactly and fuzzily
  ✓ filterNavigation matches navigation keywords
  ✓ searchOrganization returns navigation without API call when query is empty
  ✓ NAVIGATION_DESTINATIONS covers all main Control Panel destinations
SEARCH TESTS: 5 passed, 0 failed

Running Client TOTP Utility Tests...
TOTP TESTS: 5 passed, 0 failed

Running 2FA API Client Tests...
2FA API TESTS: 5 passed, 0 failed

Running Active Sessions & Password Recovery API Tests...
SESSIONS & PWD RECOVERY TESTS: 7 passed, 0 failed
```

### 2. Public Site Typecheck Suite
Command:
`npm.cmd --prefix apps/public-site run typecheck`

Output:
```
> byos-public-site@0.1.0 typecheck
> tsc --noEmit
```

### 3. Webmail Test Suite Summary
Command:
`npm.cmd --prefix apps/webmail test`

Output:
```
OVERALL: 550 passed, 0 failed
```

### 4. Go Test Suite
Command:
`go test ./...` (root) & `cd services/api; go test ./...`

Output:
```
ok  	byos.email/crypto/core	(cached)
ok  	byos.email/crypto/envelope	(cached)
ok  	byos.email/crypto/hpke	0.768s
?   	byos.email/scratch	[no test files]
ok  	byos.email/services/api	(cached)
```
