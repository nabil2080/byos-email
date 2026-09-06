# BYOS Bridge Architecture Specification (Section 19)

## Purpose
Allow standard email clients (Outlook, Apple Mail, Thunderbird) to send and receive encrypted BYOS email without modifying client software or compromising the BYOS encryption model.

## Architecture & Data Flow

```
+------------------+         +---------------------+         +---------------------+         +----------------+
|  Standard Client |  IMAP / |     BYOS Bridge     |  HTTPS  |     BYOS API        |  HTTPS  | Customer S3/   |
| (Outlook, Apple  |  SMTP   |   (Local Daemon /   | --------> (Authentication,    | --------> Object Storage|
| Mail, Thunderbird)--------->  Client Proxy)      |         |  Metadata, Queue)   |         | (Encrypted)    |
+------------------+         +---------------------+         +---------------------+         +----------------+
                                       |
                                       v
                              +------------------+
                              | Client Crypto    |
                              | Core (WASM/Rust) |
                              +------------------+
```

1. **Local Bridge Application**: Runs locally on the user's computer or trusted local environment as a lightweight proxy.
2. **IMAP Server Interface**: Listens on `127.0.0.1:1143` (IMAP) and `127.0.0.1:1025` (SMTP submission).
3. **Bridge Credentials**: The control plane generates scoped bridge access tokens (`byos_bridge_<random>`). The server stores a SHA-256 hash of the token.
4. **Local Decryption & Key Handling**: The local Bridge application uses the user's stored recovery root/mailbox key to perform local decryption of IMAP messages and local HPKE encryption of outbound SMTP mail.
5. **Zero Plaintext at Rest on Server**: The server never sees unwrapped mailbox keys or plaintext email during Bridge operations.

## Security Controls
- Bridge credentials are per-mailbox and per-device scoped.
- Tokens can be instantly revoked from the control plane.
- Local Bridge listens strictly on loopback (`127.0.0.1`) to prevent unauthorized local network access.
