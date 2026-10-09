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

---

## 7. Mobile Responsive Viewports (375px) & Touch Navigation

### What is not covered
Automated browser tests execute on desktop viewport (1280x800) with synthetic mouse clicks. They do not validate:
- Layout reflow down to 375px mobile viewports (e.g. iPhone SE / Android compact).
- Responsive collapsing of the sidebar into mobile slide-out drawer or bottom navigation bar.
- Touch gesture ergonomics (pinch-to-zoom prevention, touch target minimum sizes of 44x44px).
- Horizontal scroll prevention (`overflow-x: hidden`) on data tables, compose modal, and message reading panes.
- Virtual on-screen keyboard occlusion of compose inputs and action buttons.

### Manual pre-release verification steps
1. Open Chrome DevTools in device emulation mode set to **iPhone SE (375 x 667)** and physical mobile devices (iOS Safari & Android Chrome).
2. Verify that no horizontal scrollbars appear on any page (`window.innerWidth === document.documentElement.clientWidth`).
3. Open the sidebar navigation menu: confirm drawer opens smoothly with a backdrop overlay and closes on backdrop tap.
4. Open the Compose drawer: verify the composer takes full mobile screen, sender dropdown is touch-friendly, and virtual keyboard does not obscure Send or Discard actions.
5. In the message list and reading pane, verify attachment pills and action buttons have at least 44x44px touch targets.

### Why it is hard to automate
Headless desktop Chromium emulation does not fully simulate software keyboard viewport resize/reposition behaviors (`visualViewport`), hardware safe area insets (`env(safe-area-inset-*)`), or real touch gesture friction.

---

## 8. Accessibility (a11y) & Screen Reader Assistive Technology

### What is not covered
The automated tests check DOM selectors and CSS attributes, but do not validate assistive technology compliance under WCAG 2.1 AA:
- Keyboard focus traps in modal dialogs (Create Alias modal, Add Mailbox modal, Settings dialog).
- Visible focus rings (`focus-visible`) across all interactive elements.
- Screen reader announcements via live regions (`aria-live="polite"`) for background events (new mail notifications, upload progress, encryption status).
- ARIA semantics on custom interactive widgets (e.g., account switcher dropdown, folder tree, compose attachment pills).
- Color contrast ratios in dark and light themes (minimum 4.5:1 for normal text, 3:1 for large text and UI components).

### Manual pre-release verification steps
1. Enable screen readers (NVDA on Windows, VoiceOver on macOS/iOS, TalkBack on Android).
2. Navigate the entire application using keyboard only (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Esc`, Arrow keys):
   - Confirm focus is trapped within open modals and returns to trigger element on close.
   - Confirm high-contrast focus rings are visible on every focused element.
3. Verify screen readers announce:
   - Account switcher state ("Account menu, collapsed/expanded, Alice active").
   - Decryption badges ("Verified Sovereign Outbound", "Received via custom alias").
   - Form validation errors immediately when inputs become invalid.
4. Run axe-core / Lighthouse Accessibility audit across all routes and verify 0 critical/serious violations.

### Why it is hard to automate
Simulating assistive speech synthesis, operating system accessibility APIs (IAccessible2, AT-SPI, NSAccessibility), and user navigation workflows requires manual testing with assistive software rather than DOM-level test runners.

