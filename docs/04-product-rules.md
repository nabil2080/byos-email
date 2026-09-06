# Product Rules

## Objective

Record product decisions that implementation must respect.

## Core Product Promise

BYOS should feel like a normal professional business email service from the outside while using customer-controlled persistent storage underneath.

Users should be able to:

- Send to Gmail, Outlook, Yahoo, and other normal mail systems.
- Receive mail from normal internet email providers.
- Use BYOS webmail.
- Eventually use Outlook, Apple Mail, Thunderbird, and compatible clients.
- Use custom domains.
- Manage employees and mailboxes.
- Schedule email.
- Manage contacts, aliases, folders, rules, and settings.
- Connect customer-controlled storage.

## V1 Prototype Product Rules

- Keep user and mailbox as separate concepts.
- Support organization-managed and private mailbox modes in the model.
- Start with one organization, one user, one mailbox.
- Start with MinIO as local customer storage.
- Treat storage as an abstraction from day one.
- Do not build provider-specific assumptions into mailbox logic.
- Authentication is separate from mailbox encryption.
- Password reset must not automatically recover encrypted mailbox data.

## Employee Termination Flow

```text
Terminate user
  -> Disable authentication
  -> Disable SMTP submission
  -> Disable IMAP access
  -> Preserve mailbox
  -> Apply organization retention policy
  -> Archive, transfer, or delete according to policy
```

The cryptographic transfer/recovery behavior must be defined in the crypto spec.

## Anti-Abuse Rule

Every subscription can have the same core email features, but no subscription gets unlimited abusive sending capability.

Usage controls protect the whole service.

