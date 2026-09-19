Trigger

Before adding, deleting, replacing, refactoring, or declaring a feature missing/complete.

Rules
Search before creating.
Reuse existing code.
Trace the full path: UI → API → auth → authorization → DB → worker → storage.
Search implementation, tests, migrations, and docs.
Do not trust filenames or previous agent claims.
Stop

STOP if:

duplicate implementations exist
canonical implementation is unclear
docs and code conflict
required behavior cannot be located
Output
FORENSICS
Existing:
Path:
Tests:
Classification:
Change surface:
Unknowns:
Decision: PROCEED / INVESTIGATE / STOP