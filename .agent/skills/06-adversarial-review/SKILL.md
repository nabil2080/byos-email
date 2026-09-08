Trigger

After implementation and before declaring a security-sensitive or roadmap feature complete.

Mindset

Assume:

client is malicious
IDs can be swapped
requests can race
dependencies can fail
UI can be bypassed
previous assumptions may be wrong
Attack checks

Ask:

Can I bypass auth?
Can I cross organizations?
Can I access another user's resource?
Can I replay the request?
Can two concurrent requests violate an invariant?
What happens when DB/Redis/storage fails?
Can plaintext leak?
Can old keys still work?
Does metadata claim something that bytes do not prove?
Red flags

Investigate:
TODO, FIXME, TEMP, HACK, BYPASS, SKIP, MOCK, SAMPLE, FALLBACK, IGNORE ERROR, localStorage, X-User-Id.

Stop

BLOCK if:

critical security bypass exists
tenant isolation fails
plaintext can leak
concurrency breaks invariants
tests don't cover a critical attack
Output
ADVERSARIAL REVIEW
Attack cases:
Findings:
Concurrency:
Tenant isolation:
Failure handling:
Scope:
Verdict: APPROVE / CONDITIONS / CHANGES / BLOCK