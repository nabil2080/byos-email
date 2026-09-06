# Cryptographic Specification

## Objective

Define the key hierarchy, encryption flow, recovery behavior, mailbox privacy modes, device registration, key rotation, and what BYOS can never store in readable form.

Do not implement cryptography before this document is approved.

## Core Principle

Mailbox contents must be encrypted before they are written to customer-controlled persistent storage.

```text
Incoming email
  -> Temporary server processing
  -> Message encryption
  -> Encrypted object package
  -> Customer storage
```

```text
Customer device
  -> Download encrypted object
  -> Use authorized key material
  -> Decrypt locally where practical
  -> Display readable message
```

## Hard Rule

Readable private keys must not be stored in the normal application database.

## Required Key Concepts

- User identity key.
- Mailbox encryption key.
- Organization key.
- Device key.
- Recovery key.
- Public key.
- Private key.
- Key wrapping key.
- Key rotation generation.

## Mailbox Privacy Modes

### Organization-Managed

The organization has authorized access or recovery capability according to policy.

Use case:

- Business continuity.
- Employee termination.
- Compliance retention.

### Private

The administrator cannot automatically decrypt the mailbox.

Use case:

- Executive or sensitive mailbox.
- Personal or high-privacy mailbox.

The UI must explain this clearly during mailbox creation.

## Encryption Package

Each stored message object should include:

- Object version.
- Organization ID.
- Mailbox ID.
- Message ID.
- Encryption algorithm.
- Key generation.
- Nonce/IV.
- Ciphertext.
- Authentication tag or integrity metadata.
- Wrapped mailbox key reference.
- Minimal routing/display metadata allowed by the data classification spec.

## V1 Temporary Decision

For the local prototype, create an explicit fake crypto boundary first:

```text
crypto-worker/encrypt(message) -> encrypted package
crypto-worker/decrypt(package) -> message
```

Replace internals only after this spec is approved.

This prevents the rest of the platform from being built around plaintext storage.

## Open Decisions

- Algorithms and libraries.
- Browser-side versus server-side decryption boundaries.
- Recovery material format.
- Multi-device provisioning.
- Organization-managed recovery mechanics.
- Key rotation process.
- Admin access approval/audit requirements.

