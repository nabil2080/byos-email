# Threat Model

## Objective

Define what happens when each important part of the system is compromised or misused.

This document must be approved before serious implementation begins.

## Assets

- Readable mailbox contents.
- Attachments.
- Private keys.
- Recovery material.
- Organization policy.
- Storage credentials.
- Authentication credentials.
- Mail routing metadata.
- Billing and account metadata.
- Domain reputation.

## Threat Scenarios

### Web Server Compromise

Risks:

- Attacker modifies webmail code.
- Attacker attempts to capture credentials or decrypted content.
- Attacker accesses operational metadata.

Required controls:

- Strong deployment integrity.
- CSP and frontend hardening.
- Audit logging.
- Short-lived sessions.
- Separation of auth and encryption keys.

### Mail Server Compromise

Risks:

- Attacker reads messages during temporary processing.
- Attacker injects, drops, delays, or rewrites messages.
- Attacker abuses outbound mail.

Required controls:

- Minimize readable processing time.
- Queue integrity checks.
- Abuse limits.
- Delivery audit logs.
- Separate persistent storage encryption.

### Database Leak

Risks:

- Organization, user, domain, mailbox, and metadata exposure.
- Storage connection metadata exposure.

Required controls:

- No readable mailbox bodies in PostgreSQL.
- No readable private keys in PostgreSQL.
- Encrypt sensitive metadata where practical.
- Classify every field.

### Storage Provider Compromise

Risks:

- Attacker obtains encrypted mailbox objects.
- Attacker deletes or corrupts customer data.

Required controls:

- Encrypt before persistent storage.
- Integrity verification for stored objects.
- Versioning and backup strategy.
- Independent export and recovery tool.

### Employee Account Compromise

Risks:

- Attacker reads that employee's accessible mail.
- Attacker sends abusive outbound mail.
- Attacker exports data.

Required controls:

- 2FA.
- Device/session management.
- Per-mailbox rate limits.
- Suspicious activity detection.
- Recovery and suspension workflow.

### Customer Credentials Stolen

Risks:

- Attacker changes organization configuration.
- Attacker adds users or storage connections.
- Attacker attempts recovery flows.

Required controls:

- Step-up authentication for sensitive operations.
- Admin audit logs.
- Recovery material separation.
- Notification for critical changes.

### Lost Device

Risks:

- Local decrypted cache exposure.
- Device key exposure.

Required controls:

- Device revocation.
- Session revocation.
- Encrypted local cache.
- Key rotation policy where needed.

### Lost Recovery Material

Risks:

- Customer cannot recover encrypted mailbox data.

Required controls:

- Clear recovery warnings.
- Organization-managed recovery option.
- Private mailbox mode warning.
- Tested export/recovery tooling.

### Malicious Customer Abuses SMTP

Risks:

- Platform IP/domain reputation damage.
- Spam, phishing, malware distribution.

Required controls:

- Outbound policy layer.
- Rate limits by mailbox, organization, recipient, and time window.
- DKIM, SPF, DMARC enforcement.
- Investigation and suspension workflow.

## Open Decisions

- Exact encryption design.
- Exact recovery model.
- Whether webmail can safely perform all decryption locally in V1.
- Which metadata must be encrypted.
- Retention behavior for organization-managed mailboxes.

