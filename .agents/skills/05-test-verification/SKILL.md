Trigger

After implementation, bug fixes, infrastructure changes, or before claiming completion.

Evidence levels
L0: assumption
L1: static inspection
L2: build/typecheck
L3: unit test
L4: integration
L5: end-to-end
L6: production-like

Never report stronger evidence than actually exists.

Rules
Build ≠ feature verification.
Test file ≠ passing test.
Skipped test ≠ pass.
Mock ≠ real provider.
Browser feature requires browser verification.
Runtime claims require runtime execution.

Test positive + negative paths.

Stop

STOP completion if required tests did not execute.

If infrastructure is unavailable, report BLOCKED, not PASS.

Output
VERIFICATION
Build:
Unit:
Integration:
E2E:
Skipped:
Evidence level:
Unverified:
Result: VERIFIED / PARTIAL / BLOCKED