# Smoke Test Gaps & Pre-Release Manual Verification Guide

This document catalogs critical security, wire format, and runtime checks that are not exercised by the automated smoke test suite (`make smoke` / `smoke.ps1`), provides exact manual verification procedures for each check prior to release, and explains why each check is challenging or impractical to automate in local CI.

---

## 1. Real External SMTP Relay & Public Reputation Validation (DKIM / SPF / DMARC)

### What is not covered
The automated smoke test validates outbound delivery against local Mailpit. While Mailpit verifies RSA 2048-bit DKIM signatures, relaxed/relaxed canonicalization, and identity fields (`header.d` and `header.i`), it does not:
- Resolve public DNS TXT records (`byos._domainkey.<domain>`).
- Evaluate Sender Policy Framework (SPF) against public WAN IP addresses.
- Evaluate Domain-based Message Authentication, Reporting, and Conformance (DMARC) alignment and policy compliance.
- Test external MTA spam filters (e.g., Google Workspace, Microsoft 365, Yahoo Mail) or IP reputation deliverability.

### Manual pre-release verification steps
1. Configure `services/outbound-worker` to relay via a public egress IP or smarthost with public DNS delegation.
2. Publish production DNS records:
   - `v=DKIM1; k=rsa; p=<public_key>` at `byos._domainkey.<domain>`.
   - `v=spf1 ip4:<relay_ip> ~all` at `<domain>`.
   - `v=DMARC1; p=reject; sp=reject; rua=mailto:dmarc-reports@<domain>` at `_dmarc.<domain>`.
3. Send test outbound messages from both a standard mailbox and a masked alias to authentication testing reflectors:
   - `check-auth@verifier.port25.com`
   - `auth-results@verifier.dkim.org`
   - Test inboxes on Gmail and Outlook.com.
4. Inspect reflector reports and verify:
   - `SPF check: pass`
   - `DKIM check: pass` (with 0 selector / canonicalization errors)
   - `DMARC check: pass`
5. Verify messages land in the primary inbox without spam banners.

### Why it is hard to automate
Requires public WAN IP allocation with valid reverse DNS (PTR) records, live registrar DNS delegation, and access to external third-party email providers that actively rate limit and block automated headless traffic.

---

## 2. Hardware WebAuthn / Passkeys / FIDO2 Authenticator Flow

### What is not covered
Headless browser runners do not exercise physical WebAuthn / FIDO2 authenticators (such as USB YubiKeys, platform biometric sensors via Windows Hello, TouchID, or Android passkeys). Automated tests only test password login and virtual TOTP.

### Manual pre-release verification steps
1. In Webmail, navigate to **Settings > Security**.
2. Click **Add Security Key / Passkey**.
3. Insert a physical FIDO2 YubiKey or activate platform biometric prompt (Windows Hello / TouchID).
4. Complete user verification (PIN entry and touch gesture).
5. Log out of Webmail completely.
6. Select **Sign in with Passkey**, complete biometric / hardware touch, and confirm session loads without password entry.
7. Verify hardware credential attestation is recorded in `user_passkeys` in PostgreSQL.

### Why it is hard to automate
Platform biometric dialogs and physical touch interactions cannot be automated via standard headless Chrome without mocking the browser's credential manager, which fails to test real hardware security key firmware interactions.

---

## 3. Strict STARTTLS & TLS Cipher Negotiation from External MTAs

### What is not covered
The automated tests deliver inbound mail to port 25 via raw socket connections (`sendInboundSMTP`) without negotiating TLS or enforcing opportunistic STARTTLS.

### Manual pre-release verification steps
1. Using OpenSSL CLI against the public mail ingress endpoint:
   ```bash
   openssl s_client -starttls smtp -connect mail.byos.local:25 -tls1_3
   ```
2. Verify TLS certificate chain validity and hostname matching (`CN=mail.<domain>`).
3. Verify that insecure protocols (SSLv3, TLS 1.0, TLS 1.1) and weak ciphers (RC4, 3DES, CBC-mode ciphers) are rejected.
4. Verify Postfix logs confirm encrypted session establishment:
   ```
   postfix/smtpd: Anonymous TLS connection established from ...: TLSv1.3 with cipher TLS_AES_256_GCM_SHA384
   ```

### Why it is hard to automate
Requires public CA-signed X.509 certificates (Let's Encrypt / public CA) bound to public hostnames rather than local self-signed or plaintext test environments.

---

## 4. Third-Party S3 Storage Providers & WAN Latency / Partition Resiliency

### What is not covered
The smoke suite runs against local containerized MinIO over loopback. It does not test:
- Real latency and backoff when communicating with AWS S3, Cloudflare R2, or Google Cloud Storage.
- Handling of S3 HTTP 503 SlowDown throttling errors during multi-part attachment uploads.
- IAM credential revocation or bucket permission misconfigurations.

### Manual pre-release verification steps
1. Provision a staging organization configured with an AWS S3 or Cloudflare R2 bucket (`storage_connections` provider set to `s3`).
2. Upload a 35 MB Path A encrypted attachment from Webmail.
3. Observe chunked upload progress indicator and verify zero packet drop or timeout exceptions.
4. Temporarily revoke bucket PutObject permissions in the cloud console.
5. Attempt an upload in Webmail and assert that a clean, human-readable error toast appears rather than an unhandled UI crash or hung spinner.

### Why it is hard to automate
Requires recurring third-party cloud billing, external credentials in CI secrets, and network fault injection into external proprietary cloud infrastructure.

---

## 5. Cross-Engine Browser Cryptography (Safari WebKit & Firefox Gecko)

### What is not covered
The automated smoke test runs exclusively under headless Google Chrome (Chromium V8 engine). Differences in WebAssembly memory limits, Web Crypto subtle API quirks, and Safari iOS IndexedDB lifetime limits are not validated.

### Manual pre-release verification steps
1. Launch Safari (macOS / iOS) and Firefox (macOS / Windows / Linux).
2. Log into Alice and Bob accounts using real password credentials.
3. Send an end-to-end encrypted Path A email with attachment.
4. Verify X-Wing key derivation, Argon2id unwrap, and chunk AES-256-GCM decryption occur in <500ms without memory errors.
5. In Safari developer tools, inspect `sessionStorage` and confirm keys are purged upon logout.

### Why it is hard to automate
WebKit on Linux (WPE / Playwright WebKit) does not fully emulate iOS Mobile Safari's sandboxed storage and mobile memory pressure reclamation behavior.

---

## 6. Concurrent Multi-Device Session Epoch Invalidation

### What is not covered
Smoke tests verify password changes and session rotation within a single browser context, but do not execute simultaneous writes from two independent devices while a password rewrap is in flight.

### Manual pre-release verification steps
1. Open Session 1 (Desktop) and Session 2 (Mobile / separate browser) for `alice@byos.local`.
2. On Session 1, change the mailbox account password in **Settings > Security**.
3. Simultaneously on Session 2, trigger a draft save or outbound send.
4. Confirm Session 2 receives a `401 Unauthorized` or session invalidation notification and prompts to re-authenticate with the new password.
5. Confirm that old secret keys cannot decrypt messages sealed under the new epoch.

### Why it is hard to automate
Requires millisecond-accurate distributed concurrency orchestration across distinct browser instances with coordinated race condition injection.
