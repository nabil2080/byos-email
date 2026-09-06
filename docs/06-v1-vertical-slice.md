# V1 Vertical Slice

## Goal

Prove the smallest useful BYOS email loop without production complexity.

## Stage 1: Running Infrastructure

Required services:

- PostgreSQL
- Redis
- MinIO
- Postfix
- Rspamd
- API service

Success condition:

```text
All services are healthy.
The API service can report dependency readiness.
```

## Stage 2: Product Model

Create the first records:

- Organization.
- User.
- Mailbox.
- Storage connection.

Success condition:

```text
The API can create and read one organization, one user, one mailbox, and one MinIO storage connection.
```

## Stage 3: Message Ingest Boundary

Create a local message ingestion endpoint or queue handoff:

```text
Postfix
  -> mail-router
  -> message processor
```

Success condition:

```text
A local test email becomes an internal message package.
```

## Stage 4: Crypto Boundary

Create placeholder encryption behind the crypto boundary:

```text
plaintext message
  -> crypto-worker
  -> encrypted package
```

Success condition:

```text
No service after the crypto boundary needs plaintext message storage.
```

## Stage 5: Customer Storage

Store the encrypted package in MinIO using the storage-worker.

Success condition:

```text
The encrypted object exists in the customer-storage bucket.
```

## Stage 6: Webmail Read

Create a minimal webmail view that:

- Lists one mailbox.
- Lists one stored message.
- Retrieves the encrypted object.
- Decrypts through the approved boundary.
- Displays the message.

Success condition:

```text
The user can read the locally delivered test message.
```
