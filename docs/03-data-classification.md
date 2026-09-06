# Data Classification

## Objective

Classify every piece of data by sensitivity and define what BYOS can see.

## Classes

### Public

Examples:

- Public marketing content.
- Public documentation.
- Public pricing.
- Public MX/DNS records.

### Operational Metadata

Examples:

- Organization ID.
- User ID.
- Mailbox ID.
- Domain ID.
- Storage provider type.
- Job status.
- Queue status.
- Timestamps needed for system operation.

BYOS can normally see this data.

### Sensitive Metadata

Examples:

- Message subject.
- Sender.
- Recipients.
- Attachment filenames.
- IP addresses.
- User agent data.
- Audit event details.
- Storage bucket names.

BYOS access must be minimized, justified, and documented.

### Encrypted Customer Data

Examples:

- Message body.
- Attachments.
- Full MIME payload.
- Search index, if included.
- Contacts, if stored in mailbox data.
- Draft contents.

BYOS should not be able to read this from persistent storage.

### Secret / Key Material

Examples:

- Private keys.
- Recovery keys.
- Storage access secrets.
- OAuth refresh tokens.
- Session signing secrets.
- DKIM private keys.

This data needs special storage, access controls, audit logging, and rotation plans.

## Initial Field Rules

PostgreSQL may store:

- Organization records.
- User records.
- Mailbox records.
- Domain records.
- Alias records.
- Storage connection metadata.
- Encrypted references to sensitive secrets.
- Message routing metadata only when required.

PostgreSQL must not store:

- Readable message bodies.
- Readable attachments.
- Readable private mailbox keys.
- Unencrypted recovery material.

Customer storage stores:

- Encrypted mailbox objects.
- Encrypted attachments.
- Encrypted mailbox indexes only if approved by the crypto spec.

## What BYOS Can See In V1

Allowed:

- Organization account data.
- User account data.
- Mailbox IDs.
- Domain configuration.
- Storage provider configuration.
- Delivery job state.
- Abuse/rate-limit metadata.

Avoid or minimize:

- Subjects.
- Full recipient graphs.
- Attachment names.
- Content-derived search terms.

Never persist in readable form:

- Message bodies.
- Attachment contents.
- Mailbox private keys.
- Recovery secrets.

