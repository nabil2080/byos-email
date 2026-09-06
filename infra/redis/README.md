# Redis

Redis is used for ephemeral operational state only.

Allowed:

- Queues.
- Rate limit counters.
- Short-lived locks.
- Temporary job state.

Not allowed:

- Long-term readable mailbox contents.
- Readable private keys.

