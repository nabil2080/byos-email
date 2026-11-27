# Proposed Migrations Directory (Historical Archive)

## Status of Proposed Migrations

- `proposed_069_outbound_queue_lease_and_outcomes.sql`: Canonically integrated and versioned as `infra/postgres/migrations/069_outbound_queue_lease_and_outcomes.sql`.
- `proposed_070_attachment_encryption_v2_and_delivery.sql`: Canonically integrated and versioned as `infra/postgres/migrations/070_attachment_encryption_v2_and_delivery.sql`.
- `proposed_068_encrypt_legacy_contacts_and_signatures.sql`: Retained as proposed/unapplied pending client-side backfill completion.

All active and release migrations are managed canonically in `infra/postgres/migrations/` and executed via `byos-migrate`.
