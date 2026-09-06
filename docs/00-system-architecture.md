# System Architecture Specification

## Objective

Define every service, datastore, communication path, trust boundary, and piece of data the BYOS platform can access.

This document must be approved before serious implementation begins.

## Product Boundary

BYOS provides:

- Business email infrastructure.
- Mailbox application experience.
- Routing and delivery orchestration.
- Encryption and packaging before persistent storage.
- Organization and user administration.
- Storage connector management.
- Export and recovery tooling.

Customers provide:

- Persistent mailbox storage.
- Storage credentials or delegated access.
- Recovery material according to the selected policy.
- Domain DNS configuration.

## High-Level Local Architecture

```text
Control Plane
    |
    v
API Service ---- PostgreSQL
    |                 |
    |                 v
    |              Redis
    |
    +---- Storage Worker ---- MinIO
    |
    +---- Crypto Worker
    |
Postfix ---- Rspamd ---- Mail Router ---- Message Processor
                                      |
                                      v
                              Encrypted Object
                                      |
                                      v
                              Customer Storage

Webmail Client ---- API Service ---- Storage Worker ---- Customer Storage
       |
       v
Local Decryption
```

## Services

### Control Plane

Purpose:

- Public website.
- Signup and login.
- Organization administration.
- Domain management.
- User and mailbox provisioning.
- Storage connection setup.
- Security and recovery configuration.
- Billing later.

The control plane must not become a mailbox content processor.

### Webmail Client

Purpose:

- Inbox, sent, drafts, archive, spam, trash, folders, labels.
- Compose, reply, forward, attachments, signatures.
- Local decryption where practical.
- Local search/index where practical.
- Mailbox settings.

### API Service

Purpose:

- Organization and user APIs.
- Mailbox metadata APIs.
- Domain and storage configuration APIs.
- Authenticated access to worker orchestration.

### Mail Router

Purpose:

- Resolve inbound recipient to organization, domain, mailbox, aliases, and delivery policy.
- Hand off messages to processing and encryption.

### Storage Worker

Purpose:

- Abstract storage providers behind a stable interface.
- Implement MinIO/S3-compatible storage first.
- Later support Google Drive and other providers.

### Crypto Worker

Purpose:

- Coordinate encryption and key wrapping.
- Avoid storing readable private keys in the ordinary application database.
- Enforce crypto policy boundaries.

### Postfix

Purpose:

- Local SMTP receive/send infrastructure.
- Do not implement SMTP from scratch.

### Rspamd

Purpose:

- Spam and abuse filtering.
- SPF, DKIM, DMARC, and reputation checks where supported.

## Datastores

### PostgreSQL

Stores operational data:

- Organizations.
- Users.
- Mailboxes.
- Domains.
- Aliases.
- Storage connection metadata.
- Message metadata needed for routing and display.
- Policies.
- Audit logs.

PostgreSQL must not store readable mailbox contents.

### Redis

Stores ephemeral operational data:

- Queues.
- Rate limit counters.
- Short-lived locks.
- Temporary job state.

Redis must not store long-term readable mailbox contents.

### MinIO

Local stand-in for customer-controlled object storage.

Stores:

- Encrypted mailbox objects.
- Encrypted attachments.
- Encrypted indexes only if the crypto spec allows them.

## Trust Boundaries

- Internet email to SMTP gateway.
- SMTP gateway to internal routing.
- Application database to encrypted customer data.
- BYOS infrastructure to customer storage.
- Authenticated account access to mailbox decryption.
- Organization administrator access to private mailbox policies.

## First Vertical Slice

The first implementation target is:

```text
Local SMTP message
  -> Postfix
  -> Rspamd
  -> Mail Router
  -> Message Processor
  -> Crypto Worker
  -> Storage Worker
  -> MinIO encrypted object
  -> Webmail reads and decrypts
```

