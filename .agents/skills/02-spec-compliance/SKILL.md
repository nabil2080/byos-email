---
name: 02-spec-compliance
description: Specification compliance and authority hierarchy verification. Use before changing product behavior, APIs, DB, crypto, auth, recovery, storage, email routing, or declaring roadmap completion.
---

# 02 - Specification Compliance

## Trigger

Before changing product behavior, APIs, DB, crypto, auth, recovery, storage, email routing, or declaring a roadmap item complete.

## Rules

Authority order:

1. Frozen specifications
2. Approved reconciliation
3. V1 roadmap
4. Tests
5. Existing implementation
6. Agent assumptions

Never silently resolve conflicts.

Never implement deferred work unless explicitly requested.

Never change frozen protocols without explicit approval.

## Stop

STOP if:

frozen spec would change
requirements conflict
scope is ambiguous and security-relevant
completion cannot be proven

## Output
SPEC CHECK
Requirements:
Frozen boundaries:
Deferred:
Implementation:
Risk: LOW / MEDIUM / HIGH / BLOCKER
Decision: PROCEED / STOP
