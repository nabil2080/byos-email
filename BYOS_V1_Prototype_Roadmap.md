BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

# **BYOS Business Email** 

## **V1 Prototype & Pre-Launch Engineering Roadmap** 

##### **REVISED MASTER ROADMAP** 

**STATUS:** This revision incorporates the product, BYOS, frontend, infrastructure, email interoperability, organization control, pricing, recovery, cryptographic, privacy architecture, and end-to-end encryption decisions made since the original roadmap. The crypto protocol is treated as a pre-implementation gate until the final cross-feature review is approved. 

#### **Product Vision** 

Build a full business-email platform that feels like a normal professional email service from the outside, while using customer-controlled persistent storage and a privacy-first cryptographic architecture underneath. 

Customer provides persistent storage 

BYOS provides email infrastructure + mailbox experience + routing + encryption + administration + interoperability 

- Send and receive normal internet email with Gmail, Outlook, Yahoo, and other providers. 
- Use custom domains, business mailboxes, aliases, contacts, folders, labels, rules, attachments, signatures, and scheduled sending. 
- Use BYOS webmail and support standard desktop clients through SMTP/IMAP compatibility and the planned Bridge architecture. 
- Support organization-managed and private mailbox modes. 
- Keep persistent mailbox content encrypted in customer-controlled storage. 
- Give every paid seat the same core product rather than artificial feature walls. 

#### **Core Principle** 

Normal email on the outside. Customer-controlled storage underneath. Privacy-aware encryption and organization control at the core. 

###### **REVISED SEPTEMBER 2026** 

BYOS V1 Roadmap  |  Page 1 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION MAP** 

### **Roadmap Map** 

Use this page as the navigation map for the V1 build. 

|**Phase**|**Sections**|**Outcome**|
|---|---|---|
|P. Privacy Architecture|P|Threat model, honest scope, claims BYOS can and cannot make|
|A. Product + Security Foundation|0-4|Product rules, threat model, crypto gate, architecture, local lab|
|B. Mail Transport|5-8|Inbound/outbound SMTP, Rspamd, queues, trust and reputation controls, end-to-end encrypted internal mail|
|C. BYOS + Data|9-12|Storage abstraction, onboarding, management, cryptographic system|
|D. Mailbox Product|13-20|Organization model, auth/recovery, search, contacts, scheduled send, IMAP/Bridge, attachments|
|E. Reliability + Operations|21-24|Hardening, observability, backup/DR, exit/recovery tooling|
|F. Commercialization|25-30|Pricing, private beta, security review, production infra, scaling, implementation order|

**SCOPE:** Post-V1 features such as native mobile apps, advanced calendar, full API, legal hold, advanced compliance controls, and browser-extension/native crypto should remain in a separate future backlog unless a real launch requirement moves them forward. 

BYOS V1 Roadmap  |  Page 2 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION P** 

### **Privacy Architecture — What BYOS Can and Cannot See**

BYOS is built to withstand two distinct threats that ordinary email providers do not address.

**Threat 1 — Present-day trust failure.** A provider claims "we cannot read your mail" but technically can, or can be legally compelled to. This is closed by end-to-end encryption: if BYOS literally cannot decrypt internal mail, no warrant, no insider, and no breach can produce plaintext.

**Threat 2 — Future capture failure.** An attacker records encrypted mail today, waits for a quantum computer, then decrypts retroactively (harvest now, decrypt later). This is closed by post-quantum hybrid cryptography: mail captured in 2026 remains unreadable in 2040.

Neither alone is sufficient:

- **E2E without post-quantum** — unreadable today, but a future quantum computer can read anything ever sent.
- **Post-quantum without E2E** — safe from quantum decryption during transit, but the server still sees plaintext at the outbound worker.

**Together:** internal BYOS mail cannot be read by BYOS, by a subpoena, by a breach, or by a future quantum computer.

#### **Honest scope**

| Threat | Protected? |
|---|---|
| BYOS reads internal mail | Yes |
| Subpoena to BYOS for internal mail | Yes — nothing to hand over |
| Breach of BYOS servers exposes internal mail | Yes |
| Captured internal traffic decrypted by future quantum computer | Yes |
| Key substitution attack on the public key directory | No — V1 risk; V1.5 transparency log |
| Mailbox private key stolen from user device | No — long-lived key model |
| Metadata (who talks to whom, when) | No — documented in Section 16 |
| External mail (BYOS → Gmail/Outlook) | No — SMTP limitation |

#### **The claim BYOS can make**

> Internal BYOS mail is end-to-end encrypted with post-quantum hybrid cryptography. No one — not BYOS, not a future quantum computer — can read it. Your mailbox content lives encrypted in storage you control. External mail uses the same protections as any provider using TLS and SMTP.

#### **The claim BYOS cannot make**

> "All your email is quantum-safe." External mail is not.

BYOS V1 Roadmap  |  Page 3 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 0** 

### **Architecture, Threat Model & Product Rules** 

The mandatory design gate before production cryptography or production email infrastructure. 

Do not treat architecture as documentation after the fact. The threat model, cryptographic model, feature/crypto compatibility matrix, and trust boundaries must be defined before the final implementation is locked. 

#### **Required deliverables** 

1. System Architecture Specification: every service, data flow, trust boundary, and API relationship. 
2. Threat Model: attacks against web, API, mail, storage, identity, clients, devices, recovery, and abuse systems. 
3. Cryptographic Specification: key generation, encryption, recovery, device enrollment, rotation, organization recovery, and private/managed mailbox behavior. 
4. Data Classification: PUBLIC, OPERATIONAL METADATA, SENSITIVE METADATA, ENCRYPTED CUSTOMER DATA, SECRET/KEY MATERIAL. 
5. Feature/Crypto Compatibility Matrix: every V1 feature checked for plaintext requirements, offline behavior, metadata exposure, and security impact. 

#### **Threat scenarios to model** 

- Compromised web server 
- Compromised API 
- Database leak 
- Customer storage compromise 
- Stolen credentials 
- Lost/stolen device 
- Compromised browser/client 
- Malicious administrator or recovery principal 
- SMTP credential abuse 
- Storage outage 
- Partial key rotation 
- Scheduled-send compromise 
- Compromised outbound worker (can read all external outgoing plaintext, modify messages before DKIM signing, suppress delivery)
- Key substitution attack on the public key directory (server lies about a recipient's public key)

#### **Architecture rules that are now fixed** 

- Customer persistent mailbox storage is outside BYOS infrastructure. 
- Go is the infrastructure/backend language; web stacks are separate. 
- Astro + SolidJS + TailwindCSS is the public management site. 
- SolidJS + TypeScript + Tailwind is the interactive webmail client. 
- Rust/WASM is the client cryptographic core; TypeScript orchestrates UI/API work. 
- Postfix is the initial MTA and Rspamd is the initial filtering layer. 
- Cloudflare is the web/edge layer; Linux VPS infrastructure handles mail services. 
- Amazon SES is the outbound relay for external mail. Internal BYOS-to-BYOS mail does not pass through SES.
- Internal BYOS-to-BYOS mail is end-to-end encrypted. The outbound worker never decrypts internal mail.
- A public key directory maps BYOS email addresses to X-Wing public keys.
- Sender signing keys (Ed25519) are separate from mailbox encryption keys and are covered by the recovery root.
- No feature gating by plan. Plans primarily change mailbox capacity and legitimate usage limits. 
- Detailed anti-spam/reputation rules will be designed when SMTP is implemented, but the outbound trust engine is mandatory architecture. 

BYOS V1 Roadmap  |  Page 4 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**GATE:** Implementation gate: no production crypto implementation until the final V1 crypto review resolves scheduled-send delivery, root-secret compromise, organization recovery credentials, live-mail rotation concurrency, HPKE wire format, and the browser trust boundary. 

BYOS V1 Roadmap  |  Page 5 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 1** 

### **Product & Organization Model** 

#### **Organization hierarchy** 

Organization |-- Owners |-- Administrators |-- Users |-- Mailboxes |-- Domains |-- Aliases |-- Storage connections |-- Policies `-- Billing 

User and mailbox are separate concepts. A single employee can have multiple addresses that share a mailbox, while organization-level policies apply independently of mailbox-level encryption state. 

#### **Mailbox privacy modes** 

|**Mode**|**Meaning**|**Admin capability**|
|---|---|---|
|Organization-managed|Business-controlled mailbox with<br>authorized organizational<br>recovery/access.|Can recover and act according to<br>organization policy.|
|Private|Mailbox where the organization does not<br>have automatic decryption capability.|Can block/archive/delete, but cannot<br>automaticallyrecover or export contents.|

#### **Employee termination** 

Terminate -> disable authentication 

- -> disable SMTP submission 
- -> disable IMAP/Bridge access 
- -> preserve mailbox 
- -> apply retention policy -> transfer / archive / delete according to mailbox mode and policy 

**POLICY:** Private mailbox transfer/export is not an administrator capability in V1. The organization may request that the user export information before termination. 

BYOS V1 Roadmap  |  Page 6 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 2** 

### **Local Development Environment** 

#### **Goal** 

Build the entire platform as a reproducible local laboratory before introducing production services or real customer mail. 

- Docker Desktop |-- PostgreSQL 
- |-- Redis 
- |-- MinIO (S3-compatible) |-- Postfix 
- |-- Rspamd 
- |-- Go services 
- `-- test utilities 

#### **Development toolchain** 

|**Layer**|**Technology**|**Purpose**|
|---|---|---|
|Version control|Git + GitHub|Source control, review, history|
|Containers|Docker + Docker Compose|Reproducible local infrastructure|
|Backend|Go|Email/infrastructure/services|
|Frontend build/runtime|TypeScript + Astro/Vite|Web applications|
|Dashboard, Mailbox UI|SolidJS + Vite + TailwindCSS|Authenticated web applications|
|Public website|Astro + SolidJS + TailwindCSS|Marketing, documentation, legal, and SEO experience|
|Crypto|Rust + WebAssembly<br>|Client cryptographic core<br>|
|Mail|Postfix + Rspamd|SMTP transport and filtering|

#### **Reproducibility requirement** 

docker compose up 

Expected: all local services boot from a clean machine and health checks pass without manual repair. 

BYOS V1 Roadmap  |  Page 7 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

## **SECTION 3**

### **Public Website / Dashboard**

#### **Frontend Architecture**

**Public Website**

* Astro
* SolidJS
* TypeScript
* TailwindCSS
* Vite (provided by Astro)
* Cloudflare web/edge deployment

**Authenticated Dashboard**

* SolidJS
* TypeScript
* Vite
* TailwindCSS
* Cloudflare web/edge deployment

#### **Public Website Responsibilities**

* Marketing pages
* Pricing
* Security
* Documentation
* Legal and privacy pages
* Blog / public content
* Authentication entry points
* SEO and structured public content
* Interactive SolidJS islands where interaction is needed

#### **Authenticated Dashboard Responsibilities**

* Organizations and administrators
* User and mailbox provisioning
* Custom domain management
* Storage management
* Billing and subscriptions
* Security settings
* Account-level configuration

#### **Suggested Routes**

**Public Website**

`/`
`/pricing`
`/security`
`/privacy`
`/docs`
`/blog`
`/login`
`/signup`

**Authenticated Dashboard**

`/dashboard`
`/organization`
`/domains`
`/users`
`/billing`
`/storage`
`/security`

#### **Application Boundary**

The public website is a content-first Astro application. Interactive behavior is added through SolidJS islands rather than turning the entire public site into a client-rendered application.

The authenticated dashboard is a separate SolidJS + Vite application optimized for highly interactive organization and account management.

The public website and dashboard manage business state, permissions, account configuration, and organization administration. They are not the mailbox data processor. The mailbox application handles encrypted mailbox interaction and client-side mailbox operations.

#### **Tooling Boundary**

Astro uses Vite internally. The dashboard and mailbox use Vite directly. JavaScript tooling is **not** an application/backend runtime in this architecture. It is used only for the Astro/Vite build and package workflow. All platform backend services remain Go.

## **SECTION 4**

### **Webmail / Mailbox Client**

#### **Stack**

* SolidJS
* TypeScript
* TailwindCSS
* Vite
* Rust/WASM crypto core

#### **Core V1 Mailbox Experience**

| **Area**            | **V1 capabilities**                                     |
| ------------------- | ------------------------------------------------------- |
| **Mailbox**         | Inbox, Sent, Drafts, Archive, Spam, Trash               |
| **Organization**    | Folders, labels, threads, starred, read/unread          |
| **Message actions** | Compose, reply, reply all, forward, signatures          |
| **Data**            | Attachments, inline images, contacts, aliases           |
| **Automation**      | Filters/rules, forwarding, auto-reply, scheduled send   |
| **Privacy**         | Local decryption, local search/index, security settings |

#### **Application Model**

The public website, authenticated dashboard, and webmail are separate applications with intentionally different rendering models. The dashboard and webmail share the same primary interactive frontend technology:

* **Dashboard:** SolidJS + TypeScript + Vite + TailwindCSS
* **Mailbox / Webmail Client:** SolidJS + TypeScript + Vite + TailwindCSS

This allows shared frontend conventions and tooling while maintaining a clear separation between business administration and mailbox processing.

#### **Rendering Model**

**Public Website** → Astro static/SSR/hybrid rendering as appropriate, with SolidJS islands for interactivity

**Authenticated Dashboard** → interactive SolidJS + Vite application

**Mailbox** → interactive SolidJS application + local cryptographic processing + local mailbox index

The dashboard manages business state and permissions, while the mailbox application handles encrypted mailbox interaction.

**TRUST:** The webmail application must assume the browser is trusted to execute the delivered client code in V1. A fully compromised origin can modify JavaScript and potentially extract client-held secrets. This is a documented residual risk, not something Rust/WASM alone eliminates.

BYOS V1 Roadmap | Page 9

BYOS BUSINESS EMAIL | V1 PROTOTYPE ROADMAP

**SECTION 5** 

### **Email Infrastructure Foundation** 

#### **Backend language** 

Go is the infrastructure/application language for the email platform. It remains separate from the frontend language choices. 

#### **Go responsibilities** 

- Mail routing 
- Mailbox resolution 
- API services where appropriate 
- Storage connectors 
- Workers 
- Schedulers 
- Encryption orchestration 
- Queue processing 
- Mail synchronization 
- Administrative automation 

#### **Mail transfer components** 

|**Component**|**Role**|
|---|---|
|Postfix|Established SMTP transfer and submission infrastructure. Do<br>not write SMTP transport from scratch.<br>|
|Rspamd|Spam/reputation/filtering layer, including SPF/DKIM/DMARC-<br>related checks and policy hooks.|
|Amazon SES|Outbound relay for external mail. Provides clean IP ranges,<br>tenant management, and reputation isolation.|
|Redis|Queues, short-lived state, rate-limit counters, caching where<br>appropriate.|
|PostgreSQL|Organization, mailbox, identity, metadata, audit, and job state.|

BYOS V1 Roadmap  |  Page 10 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 6** 

### **Inbound Email Pipeline** 

Gmail / Outlook / Yahoo / any internet mail server | v DNS MX | v BYOS SMTP Gateway | v TLS / connection checks | v Postfix | v Rspamd | v Mail routing / MIME parse | v Encrypt + package | v Customer-controlled storage 

#### **Requirements** 

- SMTP reception 
- TLS 
- MX handling 
- Domain verification 
- Mailbox routing 
- MIME parsing 
- Attachment handling 
- Spam filtering 
- Malware/security policy 
- Bounce handling 
- Retry behavior 
- Message IDs 
- Delivery state 

**PRIVACY:** Inbound SMTP necessarily creates a transient plaintext processing window. The service must parse, route, and encrypt immediately, with no intentional plaintext persistence in database or object storage. 

BYOS V1 Roadmap  |  Page 11 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 7** 

### **Outbound Email Pipeline** 

Outbound mail follows one of two paths depending on whether the recipient is a BYOS user.

#### **Path A — Internal (BYOS to BYOS): end-to-end encrypted**

```
Sender's client
    ↓ look up recipient public key in directory
    ↓ encrypt to recipient's X-Wing public key
    ↓ sign with sender's Ed25519 private key (sig field)
    ↓ submit encrypted envelope
Outbound worker
    ↓ reads only envelope metadata (key_id, alg)
    ↓ routes without decrypting
Recipient's inbound path
    ↓ stored in recipient's customer storage
Recipient's client
    ↓ decrypts with recipient's private key
    ↓ verifies sender's signature
    ↓ displays plaintext
```

The outbound worker never sees plaintext for internal mail.

#### **Path B — External (BYOS to non-BYOS): relay with plaintext window**

```
Sender's client
    ↓ encrypt to outbound worker's public key
Outbound worker
    ↓ decrypts (transient plaintext window)
    ↓ DKIM signs
    ↓ submits to Amazon SES
Amazon SES
    ↓ delivers to Gmail / Outlook / Yahoo / other providers
```

External mail must pass through a transient plaintext window because SMTP and DKIM require plaintext. This is unavoidable for interoperability with traditional email.

#### **Required standards** 

- SPF 
- DKIM 
- DMARC 
- PTR / reverse DNS 
- TLS 

#### **Single outbound control path** 

SMTP credentials must never bypass the outbound policy layer. Mail originating from webmail, Outlook, Apple Mail, Thunderbird, CRM software, or a custom application must pass through the same trust and abuse controls. 

**PRIVACY:** The transient plaintext window applies only to Path B (external mail). Path A (internal BYOS-to-BYOS mail) is end-to-end encrypted and never decrypted by BYOS infrastructure. The outbound worker must:

- Not persist plaintext to disk, database, or object storage
- Log all message transformations for audit
- Minimize time plaintext is held in memory
- Be subject to the same hardening requirements as the inbound path
- Never decrypt Path A envelopes

BYOS V1 Roadmap  |  Page 12 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 7.5** 

### **Internal Mail End-to-End Encryption**

Internal mail between two BYOS users is end-to-end encrypted with post-quantum hybrid cryptography. The outbound worker routes it without decrypting.

#### **Components**

| Component | Purpose |
|---|---|
| Public key directory | Maps BYOS email address → X-Wing public key + key epoch |
| Signing key pair (Ed25519) | Per mailbox, covered by recovery root, used to sign envelopes |
| Envelope `sig` field | `base64(Ed25519_Sign(sender_signing_key, AAD \|\| ciphertext))` |
| Signature binding | Signature commits to recipient `key_id` to prevent replay |

#### **Flow**

1. Sender's client looks up recipient's current public key and key epoch.
2. Client encrypts to the recipient's X-Wing public key.
3. Client signs the message with the sender's Ed25519 private key.
4. Client populates envelope fields including `sig`, then submits.
5. Outbound worker reads `key_id` and `alg` only, routes without decryption.
6. Recipient's client fetches the envelope, decrypts, and verifies the signature.

#### **Key substitution risk**

The server hosts the public key directory. A compromised or coerced server could substitute a different public key for a recipient, causing the sender to encrypt to the server instead of the intended recipient. This is the one weakness of a server-hosted directory, and post-quantum cryptography does not mitigate it — the attacker is the directory itself.

**V1 position:** Accepted. Documented in Section 16.

**V1.5 mitigation:** Append-only key transparency log. Senders verify that the public key they received is consistent with what the log recorded.

#### **Forwarding behavior**

When a BYOS user forwards internal mail to an external recipient, the client decrypts the message, re-encrypts it for the external path, and submits through Path B.

#### **Interaction with the Bridge (Section 19)**

For internal mail, the Bridge performs client-side decryption and signature verification, then serves plaintext to standard desktop clients over localhost IMAP.

BYOS V1 Roadmap  |  Page 13 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 7.6**

### **Two Cryptographic Formats**

BYOS uses two distinct cryptographic formats for two distinct purposes.

**Format 1 — Storage encryption (binary)**

Used for inbound external mail (from Gmail, Outlook, etc.) that has been
received in plaintext by the inbound pipeline. The server re-encrypts it
for storage in customer-controlled storage.

- Purpose: encrypt at-rest for storage
- Format: `version(1) || nonce(12) || ciphertext+tag(N)`
- Wrapped content key: stored separately in `message_metadata.content_key_hpke_wrapped` in Postgres
- Algorithm: DHKEM(X25519, HKDF-SHA256) + AES-256-GCM
- Used by: `crypto-worker` (server-side), for all inbound mail

**Format 2 — End-to-end envelope (JSON)**

Used for internal BYOS-to-BYOS mail where the sender's client encrypts to
the recipient's public key, and the outbound worker routes without
decrypting.

- Purpose: end-to-end encryption between BYOS users
- Format: JSON with fields `v, alg, key_id, key_epoch, enc, nonce, ciphertext, sig`
- Wrapped content key: embedded in the envelope's `enc` field
- Algorithm: X-Wing hybrid KEM (X25519 + ML-KEM-768) via HPKE + AES-256-GCM
- Used by: client (Rust/WASM) for internal mail composition, and
  outbound worker for routing without decryption

The formats are intentionally separate:
- Storage encryption solves at-rest confidentiality for mail that BYOS
  has already seen in plaintext.
- End-to-end encryption solves confidentiality for mail that BYOS should
  never see in plaintext.

A future V1.5 goal is to unify them if doing so does not compromise the
E2E guarantee.

BYOS V1 Roadmap  |  Page 13a

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP

**SECTION 8** 

### **Outbound Trust, Abuse & Reputation Engine** 

This is mandatory infrastructure, not a premium-plan feature. Detailed thresholds will be tuned during SMTP implementation and private beta. 

#### **Required controls** 

- Per-mailbox limits 
- Organization limits 
- Per-minute limits 
- Hourly limits 
- Rolling daily limits 
- Recipients-per-message limits 
- Burst detection 
- New-recipient anomaly detection 
- Account reputation 
- Domain reputation 
- IP reputation 
- Automatic throttling 
- Temporary suspension 
- Abuse investigation 
- Account recovery after compromise 

#### **Outbound relay**

External mail (Path B) is relayed through Amazon SES. SES provides:

- Clean, curated IP ranges with globally maintained reputation
- Tenant management for per-customer reputation isolation
- Automatic abuse detection and per-tenant suspension
- Global delivery infrastructure

Internal mail (Path A) does not pass through SES and is not subject to its content policies.

#### **Design principle** 

All seats -> complete email features | 

- +-- safety limits -> protect shared infrastructure and IP reputation 
- +-- established customers may earn higher trust ceilings 
- `-- enterprise may receive custom limits after verification 

**ANTI-ABUSE:** A customer connecting external software through SMTP must not be able to turn a small account into an unrestricted relay. The service sells mailbox capability, not an unlimited bulk-mail cannon. 

BYOS V1 Roadmap  |  Page 14 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 9** 

### **BYOS Storage Architecture** 

#### **Core principle** 

Persistent mailbox storage belongs to the customer. BYOS must use a storage abstraction so adding or replacing a provider does not require redesigning the mailbox system. 

|Storage Interface<br>|<br>+--------------+--------------+|
|---|
||              |              ||
|<br>Google Drive      S3       Other S3-compatible|
||              |              ||
|<br>+--------------+--------------+|
||<br>Encrypted mailbox|

#### **V1 storage priorities** 

|**Customer type**|**Default direction**|
|---|---|
|Solo / small user|Google Drive is a convenient option; customer may also use S3-<br>compatible storage.|
|Business / Team|Organization-level object storage is preferred; S3-compatible<br>storage is the primary architecture path.|
|Technical users|Direct S3 or custom S3-compatible endpoint is supported where<br>available.|

#### **Planned connectors** 

- Google Drive 
- Amazon S3 / S3-compatible 
- Google Cloud Storage 
- Cloudflare R2 
- Backblaze 
- Wasabi 
- MinIO 
- Other compatible providers 

**PRICING PRINCIPLE:** Plans do not restrict storage technology. A small customer with sophisticated S3 infrastructure is still a valid customer. 

BYOS V1 Roadmap  |  Page 15 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 10** 

### **BYOS Customer Experience** 

#### **Solo onboarding** 

- Create account -> Create mailbox -> Connect storage -> Choose provider -> Authorize -> Generate keys -> Save recovery material -> Mailbox ready 

#### **Business onboarding** 

- Create organization -> Add domain -> Choose organization storage -> Connect storage -> Create users -> Create mailboxes -> Apply privacy policy -> Mailbox ready 

#### **Storage modes** 

|**Mode**|**Use case**|
|---|---|
|Organization storage|One company storage source for many mailboxes;<br>recommended for larger organizations.|
|Individual storage|A single mailbox owns its own storage connection; useful for<br>Solo or technical users.|
|Hybrid|Central organization storage plus selected individual mailbox<br>storage.|

**UX:** Do not force 50 employees through 50 separate personal-drive authorizations. Organization storage should be the normal business path. 

BYOS V1 Roadmap  |  Page 16 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 11** 

### **Storage Management Layer** 

#### **Customer dashboard** 

Storage -----------------------------Provider: Amazon S3 Status: Healthy Used: 182 GB Available: 818 GB Total: 1 TB Last check: 2 minutes ago 

#### **Required functions** 

- Connect 
- Disconnect 
- Reconnect 
- Test connection 
- Capacity monitoring 
- Health monitoring 
- Authorization-failure detection 
- Credential rotation 
- Provider change 
- Storage migration 
- Failure reporting 

#### **Storage failure behavior** 

Storage outages must never silently become message loss. Inbound processing, queueing, retry, scheduled send, and mailbox access need explicit failure states and customer-visible status. 

BYOS V1 Roadmap  |  Page 17 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 12** 

### **Cryptographic System** 

The core privacy architecture. Detailed protocol implementation is gated on the final cross-feature review. 

#### **Target model** 

Recovery mnemonic
      |
      v
Stable recovery root secret
      |
      v
    ├── Current rotatable mailbox encryption key pair (X-Wing)
    └── Current rotatable mailbox signing key pair (Ed25519)
      |
      v
Random per-message content key
      |
      v
AES-256-GCM encrypted mailbox content
      |
      v
Customer-controlled storage

#### **Core rules** 

- Mailbox private keys are generated client-side and are never sent to the server unwrapped. 
- A stable recovery root survives ordinary mailbox-key rotation. 
- Per-message content keys are random and are wrapped for the current mailbox public key. 
- Persistent mailbox content is encrypted before customer storage. 
- Organization-managed mailboxes have an authorized organization recovery path. 
- Private mailboxes do not have automatic administrator decryption. 
- Authentication is separate from encryption keys. 
- The server transiently processes inbound plaintext before encryption, but must not persist plaintext mailbox content. 

#### **Protocol primitives** 

| Layer | Primitive / role |
|---|---|
| Mailbox encryption key | X-Wing hybrid KEM: X25519 + ML-KEM-768 (FIPS 203), rotatable |
| Mailbox signing key | Ed25519, derived from recovery root, covered by recovery |
| Key wrapping | HPKE (RFC 9180) with X-Wing KEM, hybrid combiner per draft-connolly-cfrg-xwing-kem |
| Message content | Random 32-byte content key + AES-256-GCM |
| Envelope authentication | AES-256-GCM with AAD binding v, alg, key_id, key_epoch, enc, nonce |
| Sender signature | Ed25519 over `AAD \|\| ciphertext`, stored in envelope `sig` field |
| Derivation | HKDF-SHA256 for scoped sub-keys and recovery-root derivation |
| Admin passphrase | Memory-hard KDF such as Argon2id; exact parameters frozen before implementation |
| Client core | Rust/WASM crypto implementation with a stable JS API |
| Server core | Go crypto implementation, byte-identical wire format to Rust |

#### **Key hierarchy**

```
Recovery mnemonic
    ↓
Stable recovery root secret
    ↓
    ├── Mailbox encryption key pair (X-Wing, rotatable)
    └── Mailbox signing key pair (Ed25519, rotatable)
        ↓
    Random per-message content key
        ↓
    AES-256-GCM encrypted mailbox content
        ↓
    Customer-controlled storage
```

#### **V1 implementation status**

The crypto core is implemented in both Go (server) and Rust/WASM (client). Both implementations are verified byte-for-byte identical across 14 cross-language test vectors. External verification includes X-Wing draft-10 Appendix C and RFC 9180 Appendix A.1.1.

**Storage path (Format 1):** implemented and verified end-to-end in Step 3.
Uses X25519-only classical HPKE for content key wrapping. The hybrid X-Wing
path is implemented in crypto-core and verified against external test
vectors but is not yet wired into the storage pipeline.

**E2E path (Format 2):** spec complete at docs/crypto/envelope-v1-spec.md;
implementation of the client-side encryption and outbound worker routing
is pending.

#### **Implementation gates still to resolve** 

- Recovery-root rotation when root material is compromised 
- Whether organization-managed employees receive independent mailbox recovery material 
- Cryptographic revocation behavior for removed recovery principals 
- Live-mail concurrency during long key rotations 
- Exact recovery mnemonic encoding/versioning 
- Browser trust-boundary mitigations 

BYOS V1 Roadmap  |  Page 18 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 13** 

### **Organization-Managed vs Private Mailbox** 

|**Property**|**Organization-managed**|**Private**|
|---|---|---|
|Normal user access|Yes|Yes|
|Device-based decryption|Yes|Yes|
|Organization recovery|Yes|No automatic recovery|
|Admin export|Yes, subject to policy|No automatic export|
|Transfer after employee leaves|Yes, via authorized recovery/re-key flow|No admin transfer without user<br>cooperation|
|Business continuity|Strong|Dependent on user-controlled recovery|

#### **Mailbox creation UI** 

###### Mailbox privacy 

###### (o) Organization-managed 

Admin can access/recover according to organization policy. 

###### (o) Private 

Employee controls mailbox decryption; admin cannot automatically read it. 

**DESIGN:** Privacy mode should be treated as a cryptographic state. In V1, changing between private and organization-managed should require an explicit cryptographic migration/re-key flow, not a silent database flag flip. 

BYOS V1 Roadmap  |  Page 19 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 14** 

### **Account Authentication** 

- Email + password 
- Google login 
- Microsoft login 
- Optional two-step verification 
- Passkeys as a later enhancement 

#### **Trust separation** 

Authentication credential != Mailbox encryption key != Recovery secret 

Password reset and identity recovery restore account access. They do not automatically imply access to encrypted mailbox content. 

BYOS V1 Roadmap  |  Page 20 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 15** 

### **Account & Mailbox Recovery** 

#### **Account recovery** 

- Forgot login -> verified recovery email / identity -> restore account access 

#### **Mailbox recovery** 

PRIVATE device OR recovery material -> recover current mailbox keys 

ORGANIZATION-MANAGED authorized organization recovery principal -> recover mailbox according to policy 

#### **Stable recovery root** 

The recovery material derives a stable root secret rather than directly deriving the current mailbox private key. The current mailbox key can rotate while the recovery root remains stable. 

**SECURITY:** Recovery-root rotation must exist as a distinct security operation. If the root secret or recovery credential is compromised, ordinary mailbox-key rotation is not sufficient by itself. 

BYOS V1 Roadmap  |  Page 21 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 16** 

### **Local Search & Search Privacy** 

#### **Target architecture** 

Encrypted mailbox | v Local download | v Local decryption | v Local encrypted/indexed database | v Instant mailbox search 

#### **V1 search model** 

For privacy-sensitive fields such as subject terms, the client can compute keyed search tokens locally and send only the token to the server. The server can return message IDs, while the client performs decryption locally. 

#### **Accepted V1 leakage** 

|**Leakage**|**V1 position**|
|---|---|
|Token equality|Accepted; server may see that the same search token was used<br>again.|
|Token value|Accepted; token does not directly reveal plaintext subject<br>words, but repeated-token behavior remains visible.|
|Match-set size|Accepted; server can see result counts.|
|Access patterns|Accepted; server can observe which encrypted message objects<br>are subsequently fetched.|
|Timing|Accepted; search time and API activity remain visible.|
|Outbound plaintext (external mail only)|Accepted. The outbound worker decrypts external mail for DKIM signing and SES delivery. Internal BYOS-to-BYOS mail is end-to-end encrypted and never decrypted by BYOS infrastructure. External mail cannot be E2E due to SMTP limitations.|
|Key substitution attack|Accepted in V1. The server hosts the public key directory. A compromised or coerced server could substitute a different public key for a recipient, causing the sender to encrypt to the server instead. V1.5 mitigation: append-only key transparency log.|

**WORDING:** Do not claim that the server cannot tell two searches use the same word/token. The correct statement is that the server does not receive the plaintext search term. 

#### **Accepted V1 Cryptographic Envelope Metadata Leakage**

Per `docs/crypto/envelope-v1-spec.md`, persistent customer mailbox storage contains ciphertext encrypted under AES-256-GCM. The server and storage provider can observe only the following non-plaintext operational envelope metadata without decrypting:

|**Envelope Metadata**|**V1 Position & Threat Boundary**|
|---|---|
|Envelope version (`v`)|Accepted; required for protocol version routing and migrations.|
|Algorithm identifier (`alg`)|Accepted; required to route payload to proper KEM decapsulator.|
|Mailbox identifier (`key_id`)|Accepted; stable mailbox identifier required for storage partitioning.|
|Key epoch (`key_epoch`)|Accepted; reveals key rotation index and frequency.|
|KEM encapsulation length (`enc`)|Accepted; varies by algorithm (32B for X25519 vs 1120B for X-Wing).|
|Nonce (`nonce`)|Accepted; 12-byte public GCM nonce.|
|Ciphertext length|Accepted; reveals approximate plaintext size (mitigated in V2 via padding).|

**BOUNDARY ASSURANCE:** The server and storage provider never observe subject lines, message bodies, attachments, headers, recipient private keys, recovery mnemonics, or shared secret keys.

BYOS V1 Roadmap  |  Page 22 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 17** 

### **Drafts & Contacts** 

#### **Drafts** 

- Encrypted storage 
- Autosave 
- Multi-device synchronization 
- Attachment handling 
- Recovery 

#### **Contacts** 

- Customer-controlled storage as encrypted data 
- Client-side management 
- Separation between private address-book data and operational sender/recipient data 

**PRIVACY:** All features that normally feel "small" in an email client are treated as real mailbox data when they contain customer content. 

BYOS V1 Roadmap  |  Page 23 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 18** 

### **Scheduled Sending** 

**REQUIREMENT:** Scheduled Send is V1 and must work while the user device is offline. 

#### **Implementation: client-side pre-encryption**

```
Compose
    ↓ client encrypts to recipient's public key (Path A) or outbound worker's key (Path B)
    ↓ client signs the envelope (Path A only)
    ↓ client stores fully-formed encrypted envelope
Scheduler
    ↓ delivers at time T without decrypting
Outbound Trust & Abuse Engine
    ↓ applies same controls as ordinary mail
SMTP delivery
```

#### **Trade-off**

The user cannot edit a scheduled message after going offline. Editing requires coming back online.

This satisfies the "works while client is offline" requirement because the client was online when the message was composed. The server only needs to deliver the pre-formed envelope.

#### **Requirements**

- The client must pre-encrypt and pre-sign all scheduled mail at compose time.
- The server must not require decryption to deliver scheduled mail.
- Cancellation is allowed while online; after going offline, the message is delivered as scheduled.
- The same outbound trust and abuse controls apply to scheduled mail.
- Attachment handling follows the same client-side encryption path.

BYOS V1 Roadmap  |  Page 24 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 19** 

### **IMAP / SMTP Client Compatibility** 

#### **Requirement** 

Customers must be able to use normal external mail clients. The architecture must not trap users inside the webmail UI. 

Outlook / Apple Mail / Thunderbird / other client | v BYOS Bridge | v Local decryption + IMAP/SMTP | v Encrypted mailbox | v Customer storage 

#### **Scope** 

- Internet SMTP interoperability 
- Client submission support 
- IMAP-compatible mailbox access 
- Bridge protocol design 
- Credential and session management 
- Local decryption 

#### **End-to-end encryption for internal mail**

For internal BYOS-to-BYOS mail, the Bridge performs client-side decryption and signature verification, then serves plaintext to standard desktop clients over localhost IMAP. The Bridge never asks the server to decrypt internal mail.

**ARCHITECTURE:** Bridge implementation can follow the stable mailbox/encryption protocol, but Bridge compatibility is an architectural V1 requirement and must not be accidentally designed out. 

BYOS V1 Roadmap  |  Page 25 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 20** 

### **Attachment System** 

#### **V1 limit** 

Maximum total message size: 40 MB 

- Upload 
- Download 
- Inline images 
- MIME parsing 
- Encrypted storage 
- Attachment metadata 
- Download authorization 
- Cleanup 
- Failure recovery 

Treat 40 MB as the complete message payload budget in V1 rather than assuming every external provider accepts a 40 MB individual attachment. A future secure file-sharing feature can handle larger transfers. 

BYOS V1 Roadmap  |  Page 26 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 21** 

### **Security & Application Hardening** 

#### **Application security** 

- Secure cookies 
- CSRF protection 
- XSS defenses 
- SQL injection protection 
- SSRF protection 
- Strict authorization 
- Rate limiting 
- Secure headers 
- Dependency scanning 
- Secret management 
- Session management 

#### **Infrastructure security** 

- Firewall 
- Hardened SSH 
- Restricted service exposure 
- Service isolation 
- Security updates 
- Backups 
- Restore testing 
- Secrets outside source control 

#### **Key security** 

- Key rotation 
- Recovery-root rotation 
- Device revocation 
- Recovery protection 
- Storage credential rotation 
- Least-privilege storage access 

#### **Browser trust** 

V1 acknowledges that a fully compromised server delivering malicious JavaScript can potentially steal secrets used by the web client. Mitigations include strong deployment controls, reproducible builds, code auditing, strict CSP where appropriate, key verification flows, and a future separately trusted browser extension/native client. 

BYOS V1 Roadmap  |  Page 27 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 22** 

### **Monitoring & Observability** 

|**Tool / layer**|**Purpose**|
|---|---|
|Prometheus|Metrics|
|Grafana|Visualization / operational dashboards|
|Sentry|Application errors and diagnostics|
|External uptime monitoring|Availability from outside the infrastructure|

#### **Monitor** 

- SMTP gateways 
- Mail queues 
- Workers 
- PostgreSQL 
- Redis 
- Cloudflare edge/services 
- Storage connectors 
- Authentication 
- Outbound delivery 
- Bounce rates 
- Abuse events 
- CPU / RAM / network / disk 

**OPERATIONS:** Monitoring must include customer-impacting storage and delivery failures, not just server health. 

BYOS V1 Roadmap  |  Page 28 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 23** 

### **Backup & Disaster Recovery** 

#### **Back up** 

- Control-plane database 
- Service configuration 
- Operational metadata 
- Cryptographic metadata that is intentionally recoverable 
- Infrastructure configuration 

#### **Do not build** 

- A giant BYOS-owned plaintext mailbox archive merely to simplify backups. 

#### **Required restore test** 

Database destroyed | v Restore backup | v System operational | v Verify mail flow + organization state + recovery paths 

BYOS V1 Roadmap  |  Page 29 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 24** 

### **Independent Exit / Recovery Tool** 

A major trust feature is the ability for a customer to leave without being permanently dependent on the SaaS platform. 

Customer storage + recovery material | v Independent recovery/export application | v Mailbox export / migration 

#### **Requirements** 

- Works without a live SaaS dependency 
- Exports mailbox data 
- Respects encryption and recovery rules 
- Supports organization-managed archive/recovery use cases 
- Has explicit documentation and test vectors 

**TRUST:** The export path is part of the product promise, not merely an internal engineering utility. 

BYOS V1 Roadmap  |  Page 30 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 25**

### **Billing & Pricing**

#### **Pricing philosophy**

Every seat receives the same complete BYOS email product. Customers pay per seat, with the per-seat price declining as seat count grows through graduated marginal brackets. There are no named plans and no artificial feature walls. The minimum subscription is 10 seats.

#### **Graduated bracket pricing**

| Seats | Per-seat/month | Notes |
|---|---:|---|
| 1–10 | $3.00 | Minimum subscription is 10 seats |
| 11–25 | $2.85 | Marginal rate on seats 11–25 only |
| 26–50 | $2.71 | Marginal rate on seats 26–50 only |
| 51–100 | $2.57 | Marginal rate on seats 51–100 only |
| 101+ | $2.44 | Custom pricing available for large organizations |

Bracket semantics are graduated and marginal, like income tax brackets. A 25-seat organization pays:

- 10 seats × $3.00 = $30.00
- 15 seats × $2.85 = $42.75
- **Total: $72.75/month**

A 100-seat organization pays:

- 10 × $3.00 = $30.00
- 15 × $2.85 = $42.75
- 25 × $2.71 = $67.75
- 50 × $2.57 = $128.50
- **Total: $269.00/month**

#### **Annual billing**

Annual billing is 10 months upfront, equivalent to a 16.7% discount. The annual price is calculated by applying the same graduated brackets to the monthly total, then multiplying by 10.

#### **All seats include the core product**

- Custom domains
- SMTP
- IMAP/Bridge architecture
- BYOS storage connectors
- End-to-end encrypted internal mail
- Post-quantum hybrid cryptography
- Search
- Contacts
- Aliases
- Rules
- Scheduled Send
- 2FA
- Google/Microsoft sign-in
- Organization controls

#### **What varies with seat count**

- Per-seat price (via graduated bracket)
- Organization resource caps (domains, aliases — tied to seat_count)
- Support and contract terms for 101+ seats

**PRICING:** Storage technology is not a premium feature. A 10-seat organization can connect their own S3-compatible storage at the same tier as any larger organization.

BYOS V1 Roadmap  |  Page 31 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 26** 

### **Private Beta** 

#### **Staged rollout** 

5-10 trusted testers -> 10-25 businesses 

- -> 25-50 businesses -> 100 businesses 

#### **Measure at every stage** 

- Delivery reliability 
- Spam placement 
- Storage failures 
- Encryption failures 
- Recovery success 
- Onboarding completion 
- Account termination flows 
- Scheduled send 
- SMTP/IMAP client compatibility 
- Support volume 
- Infrastructure load 

**ROLLOUT:** Do not jump from a working prototype to thousands of customers. Email reputation, storage edge cases, recovery, and client interoperability need real-world observation. 

BYOS V1 Roadmap  |  Page 32 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 27** 

### **Security Review & Launch Gate** 

#### **Independent review focus** 

- Cryptography 
- Key management 
- Authentication 
- Storage authorization 
- SMTP security 
- Tenant isolation 
- Administrator access 
- Recovery 
- Web-client trust boundary 
- Scheduled-send security 
- Device revocation 
- Root-rotation behavior 
- Outbound worker trust boundary and plaintext handling
- Key substitution attack against the public key directory
- E2E path integrity (outbound worker must not decrypt internal mail)
- Scheduled send client-side pre-encryption correctness
- Signature binding to recipient key_id
- Signing key coverage in recovery root

#### **Launch sequence** 

Internal review -> findings -> fixes -> retest 

- -> independent security review -> private beta -> remediation -> production launch 

**SECURITY:** A bug bounty is a later layer, not a substitute for a security review and controlled private beta. 

BYOS V1 Roadmap  |  Page 33 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 28** 

### **Production Infrastructure** 

#### **Web / edge** 

Cloudflare |-- DNS |-- TLS |-- WAF / edge controls 

|-- static assets 

- `-- web application delivery 

#### **Email / backend** 

Linux VPS |-- Postfix |-- Rspamd |-- Go services |-- queues / workers 

|-- Outbound relay (Amazon SES) for external mail

- `-- supporting mail infrastructure 

#### **Data** 

PostgreSQL Redis Customer mailbox storage Google Drive / S3 / S3-compatible 

#### **Production principles** 

- Start small 
- Keep components replaceable 
- Use infrastructure-as-code as complexity grows 
- Keep secrets outside source control 
- Separate public web traffic from mail infrastructure 
- Do not expose internal services directly to the internet unless required 

BYOS V1 Roadmap  |  Page 34 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 29** 

### **Scaling Model** 

|**Scale**|**Likely evolution**|
|---|---|
|0-1,000 mailboxes|Small production cluster, strong monitoring, conservative<br>outbound reputation policy.|
|1,000-10,000|Additional SMTP gateways, worker capacity, queue scaling,<br>database capacity, reputation segmentation.|
|10,000-50,000|Multiple SMTP gateways, queue/worker clusters, stronger<br>database strategy, more advanced delivery isolation.|
|50,000+|High availability, database replicas, multiple regions where<br>justified, advanced IP pools, dedicated enterprise<br>infrastructure.|

**SCALE:** Scaling decisions should be driven by measured bottlenecks, not by premature complexity. BYOS removes much of the mailbox-object storage burden, but bandwidth, metadata, queueing, indexing, CPU, and outbound reputation still scale with usage. 

BYOS V1 Roadmap  |  Page 35 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 30** 

### **Implementation Order - Where We Start** 

This is the operational sequence to hand to the coding agent and use as the project checklist. 

#### **Step 0 - Freeze the architecture gate** 

- Complete the final security/crypto compatibility review. 
- Resolve scheduled send, root rotation, organization recovery credentials, recovery-principal revocation, live-mail key rotation concurrency, HPKE wire format, and browser trust assumptions. 

#### **Step 1 - Build the local laboratory** 

Docker PostgreSQL Redis MinIO Postfix Rspamd Go services Test utilities 

#### **Step 2 - Implement the final Rust/WASM crypto core** 

- Use an established HPKE implementation; do not hand-roll HPKE. 
- Implement recovery-root logic, mailbox keys, message-key wrapping, AES-GCM, HKDF, and exact wireformat serialization. 
- Validate against official test vectors and project-specific test vectors. 

#### **Step 3 - Complete the inbound vertical slice** 

External test sender -> SMTP -> Postfix -> Rspamd -> Go router -> encrypt -> MinIO -> webmail client -> local decrypt -> display message 

**MILESTONE:** Success condition: the stored mailbox object is unreadable plaintext, while the authorized client can decrypt and display the message. 

#### **Step 4 - Implement outbound mail with two paths** 

- Path A: internal BYOS-to-BYOS, end-to-end encrypted, outbound worker never decrypts 
- Path B: external, decrypted for DKIM signing, relayed via Amazon SES 

#### **Step 5 - Implement BYOS** 

- Start with MinIO locally. 
- Add S3 / S3-compatible storage. 
- Add Google Drive. 
- Keep a provider-neutral storage interface. 

#### **Step 6 - Build the web applications** 

Public Website: Astro + SolidJS + TailwindCSS + Vite (via Astro) Dashboard: SolidJS + TypeScript + Vite + TailwindCSS Mailbox: SolidJS + TypeScript + Vite + TailwindCSS Crypto: Rust/WASM shared client module 

#### **Step 7 - Build organizations & administration** 

- Organizations 
- Owners/admins 
- Users 
- Mailboxes 
- Domains 
- Aliases 
- Privacy modes 
- Storage management 
- Termination/recovery 
- Security events 

#### **Step 8 - Complete core mailbox features** 

- Drafts 
- Contacts 
- Search 
- Attachments 
- Labels 
- Filters 
- Forwarding 
- Auto-reply 
- Scheduled Send 
- Signatures 

#### **Step 9 - Implement IMAP/SMTP Bridge compatibility** 

Do this after the mailbox/encryption protocol is stable, while preserving the compatibility requirement from the beginning. 

#### **Step 10 - Reliability, hardening, and adversarial testing** 

- Monitoring 
- Backups 
- Disaster recovery 
- Crypto vectors 
- Storage failure tests 
- Rotation interruption tests 
- Concurrent incoming-mail tests 
- Recovery tests 
- Abuse tests 
- Tenant isolation tests 
- Key substitution tests 

BYOS V1 Roadmap  |  Page 36 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

#### **Step 11 - Private beta** 

5 -> 10 -> 25 -> 50 -> 100 businesses 

#### **Step 12 - Public launch** 

- Core product works 
- Email interoperability works 
- BYOS works 
- Encryption/recovery validated 
- Security review complete 
- Monitoring and backups validated 
- Abuse controls validated 
- Private beta stable 

BYOS V1 Roadmap  |  Page 37 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION A** 

### **Appendix A - Current Architecture Snapshot** 

                                  INTERNET
                                     |
                               +-----v------+
                               | CLOUDFLARE |
                               +-----+------+
                                     |
             +-----------------------+-----------------------+
             |                       |                       |
       +-----v------+          +-----v------+          +-----v------+
       | PUBLIC     |          | DASHBOARD  |          | MAILBOX   |
       | WEBSITE    |          | SolidJS    |          | SolidJS   |
       | Astro      |          | Vite       |          | Vite      |
       | SolidJS    |          | TailwindCSS|          | TailwindCSS|
       +-----+------+          +-----+------+          +-----+------+
             |                       |                       |
             +-----------------------+-----------------------+
                                     |
                                  HTTPS/API
                                     |
                               +-----v------+
                               | GO PLATFORM|
                               +-----+------+
                                     |
                  +------------------+------------------+
                  |                                     |
            +-----v------+                         +----v-----+
            | MAIL       |                         | DATA      |
            | Postfix    |                         | Postgres  |
            | Rspamd     |                         | Redis     |
            | Queue      |                         +----------+
            +-----+------+
                  |
                  +--→ Outbound relay (Amazon SES) → External recipients
                  |
                  v
          Customer-controlled storage
          Google Drive / S3 / S3-compatible

#### **Client crypto boundary** 

SolidJS / TypeScript | v Rust/WASM crypto core | +-- recovery root +-- X-Wing (X25519 + ML-KEM-768) +-- Ed25519 signing key +-- AES-256-GCM +-- HKDF +-- recovery / key serialization 

BYOS V1 Roadmap  |  Page 38 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION B** 

### **Appendix B - Locked Product Decisions** 

|**Decision**|**Current choice**|
|---|---|
|Product model|Full business email + customer-controlled persistent storage.|
|BYOS|Organization, individual, and hybrid storage supported.|
|Pricing|Graduated per-seat brackets, 10-seat minimum, no named plans|
|Frontend split|Astro + SolidJS + TailwindCSS public website; SolidJS + Vite + TailwindCSS dashboard and mailbox.|
|Infrastructure language|Go.|
|Client crypto|Rust/WASM.|
|Mail transfer|Postfix.|
|Filtering|Rspamd.|
|Web edge|Cloudflare.|
|Mailbox storage|Customer-controlled storage.|
|Internal mail encryption|End-to-end between BYOS users|
|External mail encryption|TLS in transit; transient plaintext at outbound worker|
|Outbound relay|Amazon SES|
|Sender authentication|Ed25519 signature over AAD \|\| ciphertext|
|Key directory trust|Server-hosted, trust-the-server in V1|
|Key transparency|V1.5 backlog item|
|Attachment limit|40 MB total message size in V1.|
|Mailbox modes|Organization-managed + Private.|
|Scheduled Send|V1; client-side pre-encryption; works while client is offline.|
|SMTP/IMAP|Standard interoperability required; Bridge architecture planned.|
|Search|Client-oriented privacy model with acknowledged token/access-pattern leakage in V1.|
|Recovery|Separate account recovery from mailbox recovery; stable recovery-root model.|
|Organization recovery|Multiple authorized recovery principals; exact revocation behavior must be explicit.|
|Outbound safety|Unified trust/reputation engine for webmail, SMTP clients, and approved APIs.|
|Exit|Independent mailbox export/recovery capability.|

BYOS V1 Roadmap  |  Page 39 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION C** 

### **Appendix C - V1 Acceptance Checklist** 

|**Gate**|**Pass condition**|
|---|---|
|Architecture|Threat model, crypto spec, feature compatibility matrix<br>approved.|
|Crypto|Test vectors and recovery-after-rotation pass; no global<br>mailbox decryption key exists.|
|Inbound|External message received, filtered, encrypted, stored,<br>retrieved, and decrypted by authorized client.|
|Outbound (Path A)|Internal BYOS-to-BYOS mail is end-to-end encrypted; outbound worker does not decrypt.|
|Outbound (Path B)|External delivery works with SPF/DKIM/DMARC/PTR/TLS and<br>trust controls via SES.|
|BYOS|Customer storage can be connected, health-checked, recovered,<br>and changed.|
|Organization|Admins/users/domains/mailboxes/privacy modes/termination<br>behave correctly.|
|Webmail|Core mailbox functions work with local decrypt/search<br>architecture.|
|Client compatibility|SMTP/IMAP Bridge architecture is stable and protocol-<br>compatible.|
|Reliability|Backups restore; storage/queue/server failures have tested<br>behavior.|
|Security|Independent review complete; findings fixed and retested.|
|Privacy claims|Public security documentation matches actual behavior.|
|Beta|Staged private beta produces acceptable delivery, reliability,<br>recovery, and support metrics.|
|Launch|All launch conditions are met before public signup is enabled.|

BYOS V1 Roadmap  |  Page 40 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION D** 

### **Appendix D - Post-V1 Future Backlog** 

- Key transparency log for the public key directory (V1.5)
- External mail E2E via S/MIME or PGP (V2, if demand)
- Browser-extension crypto boundary for stronger protection against compromised web origins. 
- Native desktop client and stronger offline support. 
- Native mobile applications and push notifications. 
- Mailbox migration/import tooling from existing providers. 
- Shared mailbox/delegation enhancements. 
- Passkeys. 
- Calendar integration. 
- API and deeper business integrations. 
- Retention and advanced archival/legal-hold features. 
- Additional storage providers and advanced data-residency controls. 
- Advanced enterprise compliance features. 
- Private-information-retrieval or stronger search-privacy techniques if justified by demand. 
- Ciphertext length padding to reduce plaintext size leakage [V2 backlog] 

BYOS V1 Roadmap  |  Page 41 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

### **Final V1 Position** 

The V1 product is a complete business-email service with normal internet interoperability, customer-controlled persistent storage, end-to-end encrypted internal mail with post-quantum hybrid cryptography, organization administration, recovery, scheduled sending, and a path to standard desktop clients. The architecture is intentionally split so each major concern has a clear home: Astro + SolidJS for the public website, SolidJS + Vite for the dashboard and mailbox, Rust/WASM for client cryptography, and Go/Postfix/Rspamd/Amazon SES for the mail platform.

PAY FOR CAPACITY. CHOOSE YOUR STORAGE. USE NORMAL EMAIL. KEEP CONTROL OF YOUR DATA. 

**CANONICAL:** This roadmap is the canonical V1 project plan. Detailed cryptographic protocol files may expand or refine the crypto sections, but product-wide decisions recorded here should not be silently changed during implementation. 

BYOS V1 Roadmap  |  Page 42