# BYOS Engineering Rules

1. Inspect before modifying.
2. Reuse existing code before creating new code.
3. Follow the roadmap and frozen specifications.
4. Never invent cryptographic protocols.
5. Never weaken authentication, authorization, privacy, or validation.
6. Build success does not prove feature correctness.
7. Test existence does not prove test execution.
8. Never claim runtime verification without executing it.
9. Keep changes minimal and task-scoped.
10. Before completion, verify and perform adversarial review.

## Skill routing

Implementation:

* `01-repository-forensics`
* `02-spec-compliance`
* relevant security/crypto skill
* `05-test-verification`
* `06-adversarial-review`

Security/crypto tasks:

* load `03-security-privacy`
* load `04-crypto-boundary`

Frontend/UI tasks:

* load `07-frontend-design`
* load `08-solidjs-reactivity`
* load `09-tailwind-brand-system`
* load `11-accessibility-a11y`
* load `kylezantos/responsive-craft`
* load `LottieFiles/motion-design-skill`

UI/Crypto Bridge tasks:

* load `10-wasm-ui-bridge`

Do not load every skill unless needed.

## Global UI/UX Constraints

* **Responsive Architecture:** All components (including data tables and complex sliders) must scale flawlessly down to a 375px mobile viewport using Tailwind responsive modifiers and `@container` variants. No horizontal scrolling permitted.
* **Motion Design:** Choreograph dynamic elements (e.g., expanding receipts, state changes) using a snappy, deliberate, and professional "infrastructure" motion archetype. Bouncy, playful, or over-exaggerated easing is strictly forbidden on this high-security zero-knowledge platform.

## Frozen

Treat Section 12 and Section 15 specifications as immutable unless explicitly authorized.
