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
* load `mengto/skills` (migrated to `.agents/skills/mengto-skills`)

Core technology invariants for Frontend/UI tasks:
- **Dashboard, Mailbox UI:** `SolidJS + Vite + TailwindCSS` (`apps/webmail/`, `apps/control-plane/`) | Authenticated web applications
- **Public website:** `Astro + SolidJS + TailwindCSS` (`apps/public-site/`) | Marketing, docs, legal, SEO

UI/Crypto Bridge tasks:

* load `10-wasm-ui-bridge`

Do not load every skill unless needed.

## Refactor Discipline

When you find yourself needing to refactor existing code to add a new 
feature:

1. STOP. Do the refactor as a separate commit first.
2. Run all tests. Verify nothing broke.
3. Commit the refactor alone.
4. Then add the new feature on top.

A refactor is not a feature. Bundling them hides regressions.

## Global UI/UX Constraints

* **Responsive Architecture:** All components (including data tables and complex sliders) must scale flawlessly down to a 375px mobile viewport using Tailwind responsive modifiers and `@container` variants. No horizontal scrolling permitted.
* **Motion Design:** Choreograph dynamic elements (e.g., expanding receipts, state changes) using a snappy, deliberate, and professional "infrastructure" motion archetype. Bouncy, playful, or over-exaggerated easing is strictly forbidden on this high-security zero-knowledge platform.

## Operational Directives

Do not rewrite existing test files. If a test is failing, fix the code it
tests or explain why the test is wrong. Never delete or rename tests
without explicit user approval. The user's test suite represents
hard-won lessons from past bugs.

Every file you edit must be mentioned in the final report with a one-line
reason. If a file is touched that the task did not name, explain why.
Silent edits to source files or tests will be treated as failures, even
if the changes are correct. Unmentioned test file changes are grounds
for rejecting the entire task.

Do not extract your own prompt from transcript logs. The prompt is in
your context.

### Section: Evidence requirements

Every report must contain raw, pasted evidence for each claim. The
following words are forbidden unless immediately followed by pasted
output on the next line:

- PASS
- verified
- confirmed
- working
- complete
- fixed
- all tests pass

If you cannot paste raw output, the claim must use the word
**UNTESTED** and list the exact manual steps required to verify it.

A report that uses any forbidden word without pasted output will be
rejected. It does not matter if the work is correct. Rejected means
the user cannot trust the report and must re-verify everything manually.

### Section: What counts as raw evidence

Acceptable evidence:

- Terminal output of a command, pasted in full
- JSON response body from an API call, pasted verbatim
- SQL query result, pasted with the column headers
- DevTools network request dump: URL, headers, status, response body
- DevTools storage dump: exact `localStorage` and `sessionStorage` keys
  and values
- Screenshot saved to the repository (not scratch)
- Diff output of the specific files changed

Not acceptable:

- A summary of what the output said
- A one-line paraphrase
- "Ran the test, it passed"
- A file link to your scratch directory
- A screenshot path that isn't inside the repo
- An assertion that an earlier report already covered it

### Section: Artifact locations

All reports, screenshots, and verification artifacts go in the
repository:

- Reports: `docs/<feature>_report.md`
- Browser test screenshots: `tests/browser/artifacts/<feature>_<state>.png`
- Browser test scripts: `tests/browser/<feature>.mjs`
- SQL verification scripts: `tools/<feature>_verify.sql`
- Scratch scripts for one-off investigation: `scratch/` (gitignored)

Never write reports or verification artifacts to the agent brain
directory. Those files are invisible to the user and to future agents
and will not be committed.

Browser tests and scripts must never write to any path outside the
repository. Absolute paths to a specific user's home directory are
forbidden. All file output must be relative to the repository root,
and screenshots must go to tests/browser/artifacts/.

### Section: Manual verification requirements

Every task that changes UI behavior must include a browser
verification step. The following are not substitutes for browser
verification:

- Unit tests
- API tests
- DOM structure assertions
- Seeded state with injected tokens
- Screenshots of the code (not the running app)

The browser verification must:

1. Use the real login flow for any user account involved
2. Exercise the actual user action the feature adds or changes
3. Assert on real data produced by the running system, not mocks
4. Capture the DevTools state (network, storage, console) at the point
   of assertion
5. Save at least one screenshot to `tests/browser/artifacts/`

### Section: File edit accounting

Every file the agent edits in a task must appear in the final report
with a one-line reason. This includes:

- Source files
- Test files
- Configuration files
- Migration files
- Documentation files
- `.gitignore` and other root-level files

If a file was touched but not explained, the task is rejected. This is
not negotiable. Silent edits to test files in particular are grounds
for immediate rejection — the user's test suite represents hard-won
lessons from past bugs and must not be weakened.

### Section: Self-prompt and context recovery

Do not attempt to read your own prompt from the transcript JSON log.
The prompt is in your active context. If you have lost context:

- Do not grep the transcript
- Do not read files in your brain directory
- Do not search for "USER_INPUT" markers

Instead, state that you have lost context and ask the user to resend
the prompt. That is faster and produces a more accurate result.

### Section: Reporting failure honestly

If a task cannot be completed or a check fails, report it as
**FAILED** with:

- The exact command that failed
- The exact error output
- Your best hypothesis for the cause
- What you would need to try next

Do not:

- Skip the failing check silently
- Rephrase a failure as a partial success
- Claim something works because "the unit test covers it"
- Mark the task complete when any acceptance criterion is unmet

An honest FAILED report is more valuable than a dishonest PASS report.
The user's time is wasted more by false success than by visible
failure.

### Section: Migration and schema changes

Any new migration file added must be:

1. Listed in the report with its exact filename
2. Applied to the local database during the task
3. Verified with `\d <table>` output pasted in the report
4. Idempotent (uses `IF NOT EXISTS` where possible)

Migration files must never be edited after being applied to a running
database. Add a new migration instead.

### Section: Test file changes

Test files may only be edited to:

- Add new tests
- Fix a test that fails due to a real bug in the code being tested
- Fix a test that fails due to environmental flakiness (e.g. timing)

Test files may never be edited to:

- Delete assertions
- Remove test cases
- Rename tests to hide what they check
- Loosen assertions to make them pass
- Add `skip` or `todo` to avoid failure

If a test file is edited, the diff must be included in the report. If
the diff shows any of the forbidden changes, the task is rejected.

### Section: What a good report looks like

A good report has this structure:

```
# <Feature> Report

## What was built
<one paragraph, plain description>

## Files edited
| File | Reason |
|------|--------|
| path/to/file.ext | one-line reason |

## Raw evidence
<for each claim, the exact command and output>

## Manual browser verification
<for each check, the exact steps run and the exact result observed,
including screenshots saved to tests/browser/artifacts/>

## What did not work or is untested
<explicit list of anything not verified>

## Test suite output
<full paste of go test and npm test, not summarized>
```

Anything shorter is incomplete. Do not compress this structure.

### Section: When to stop and ask

Stop and ask the user before continuing if any of the following is true:

- A required dependency cannot be added after two attempts
- A test fails in a way you cannot diagnose
- You discover a security issue (leaked secret, exposed endpoint,
  privilege escalation)
- A file you need to edit is not in the task scope
- You are about to make a schema change to a table with production data
- You have lost context of what the task is

Killing your own tasks and retrying blindly wastes turns. Stopping and
asking wastes zero.


## Frozen

Treat Section 12 and Section 15 specifications as immutable unless explicitly authorized.
