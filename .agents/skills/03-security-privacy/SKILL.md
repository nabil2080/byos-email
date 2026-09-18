Trigger

Any change involving auth, RBAC, organizations, mailboxes, storage, secrets, recovery, devices, attachments, email, APIs, uploads, logging, CORS, or rate limits.

Rules

Always test:

unauthenticated access
wrong user
wrong organization
inactive user
malformed input
dependency failure
direct API bypass

Never trust frontend authorization.

Never log/persist secrets.

Never allow plaintext to cross an unauthorized boundary.

Never introduce unsafe storage fallback.

Always preserve tenant isolation.

Stop

STOP for:

plaintext leakage
auth bypass
authorization bypass
cross-tenant access
secret exposure
weakened security control
Output
SECURITY
Auth:
Authorization:
Tenant isolation:
Secrets:
Plaintext exposure:
Failure handling:
Findings:
Release: PASS / BLOCKED