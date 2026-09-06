# BYOS Email

BYOS Email is a business email platform prototype where the customer controls persistent mailbox storage while the application provides email infrastructure, mailbox experience, encryption, routing, administration, and interoperability.

## Current Phase

This repository is in the V1 prototype and pre-launch engineering phase.

The first milestone is not a full production mail service. The first milestone is a reproducible local platform:

```text
docker compose up
```

That local stack should eventually prove this core loop:

```text
Create organization
Create mailbox
Receive local test email
Process message
Encrypt message package
Store encrypted object in customer-controlled storage
Open webmail
Decrypt and read message
```

## Start Order

1. Finish and approve the system architecture.
2. Finish and approve the threat model.
3. Finish and approve the cryptographic specification.
4. Finish and approve the data classification.
5. Build the local Docker environment.
6. Build the smallest vertical slice of the email pipeline.

## Repository Layout

```text
docs/       Product, architecture, threat model, crypto, and data rules.
infra/      Local infrastructure: PostgreSQL, Redis, MinIO, Postfix, Rspamd.
services/   Go services for API, routing, storage, crypto orchestration, and workers.
apps/       User-facing applications: control plane and webmail.
packages/   Shared libraries for types, crypto boundaries, and storage connectors.
```

## V1 Prototype Scope

- One organization.
- One custom domain in local development.
- One user.
- One mailbox.
- One storage provider: MinIO first.
- Local inbound email test.
- Local outbound email test.
- Encrypted message object stored in customer storage.
- Basic webmail read and compose experience.

## Not In The First Milestone

- Production SMTP reputation.
- Real Gmail or Outlook sending.
- Billing.
- Full IMAP compatibility.
- Advanced search.
- Mobile apps.
- Complex key recovery.

