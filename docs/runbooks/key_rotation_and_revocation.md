# Operational Runbook: Send-Token Key Rotation and Revocation

## 1. Overview
BYOS outbound messages use HPKE-sealed send-tokens. The outbound worker unseals send-tokens using private keys stored in the worker keyring. To support zero-downtime key rotation and key compromise response, the system supports multi-epoch keyrings.

---

## 2. Keyring Architecture & Key Lifecycle

Each key entry in `/run/secrets/outbound_delivery_keyring.json` has four potential statuses:
- `active`: Key used to encrypt new messages and available for decryption. Exactly one key should be `active`.
- `decrypt_only`: Historical key retained to decrypt older in-flight messages or operator-authorized retries.
- `pending`: Pre-staged key for future activation (omitted from worker decryption table).
- `retired`: Revoked or deactivated key (omitted from worker decryption table; fails closed).

### Historical Key Resolution & Operator Retries
When an operator authorizes a retry for an older message created under Epoch 1 while the system has rotated to Epoch 2:
1. The outbound worker inspects `send_token_key_epoch` (and optional `send_token_key_id`) from the queue item.
2. The worker selects the matching key from the keyring (`status = 'decrypt_only'` or `'active'`).
3. If the key is marked `'retired'` or missing entirely, the worker fails closed immediately without leaking plaintext.

---

## 3. Scheduled Key Rotation Procedure

### Phase 1: Generate New Keypair
Generate a new X25519 delivery keypair:
```bash
# Using byos-crypto-client CLI or native tool:
crypto-client generate-delivery-keypair
```
Record:
- `key_epoch`: Current epoch + 1 (e.g., Epoch 2).
- `key_id`: SHA-256 public key hex identifier (`outbound_key_id_hex`).
- `sk_b64`: Base64-encoded 32-byte private key.
- `pk_b64`: Base64-encoded 32-byte public key.

### Phase 2: Update Worker Keyring
Update `/run/secrets/outbound_delivery_keyring.json`:
1. Demote current active key to `"status": "decrypt_only"`.
2. Add new key with `"status": "active"`.

Example:
```json
{
  "keys": [
    {
      "key_epoch": 1,
      "key_id": "a1b2c3d4e5f6...",
      "sk_b64": "...",
      "status": "decrypt_only"
    },
    {
      "key_epoch": 2,
      "key_id": "f6e5d4c3b2a1...",
      "sk_b64": "...",
      "status": "active"
    }
  ]
}
```

### Phase 3: Reload Worker Process
Restart or reload the outbound worker to load the new keyring:
```bash
docker restart byos-outbound-worker
```
Verify worker log confirms loading multi-epoch keys:
```
INFO loaded outbound delivery keyring with 2 usable keys (max_epoch=2)
```

### Phase 4: Update Public Key in Application Services
Publish the new public key (`pk_b64`, `epoch: 2`) to the frontend and API sending services. New drafts and queue items will now be encrypted under Epoch 2. Older queue items retain `send_token_key_epoch = 1` and continue to decrypt under Epoch 1.

---

## 4. Emergency Key Revocation Procedure (Key Compromise)

If a private key is compromised:
1. Immediately update `/run/secrets/outbound_delivery_keyring.json` and change the compromised key's status to `"retired"`.
2. Add a fresh emergency key as `"active"`.
3. Restart `byos-outbound-worker`.
4. Any in-flight messages encrypted with the retired key will fail decryption closed and move to retry/quarantine.
5. Notify affected tenants and re-encrypt or cancel pending items via operator intervention.
