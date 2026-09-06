BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

# **BYOS Business Email** 

## **V1 Prototype & Pre-Launch Engineering Roadmap** 

##### **REVISED MASTER ROADMAP** 

**STATUS:** This revision incorporates the product, BYOS, frontend, infrastructure, email interoperability, organizationcontrol, pricing, recovery, and cryptographic decisions made since the original roadmap. The crypto protocol is treated as a pre-implementation gate until the final cross-feature review is approved. 

#### **Product Vision** 

Build a full business-email platform that feels like a normal professional email service from the outside, while using customer-controlled persistent storage and a privacy-first cryptographic architecture underneath. 

Customer provides persistent storage 

BYOS provides email infrastructure + mailbox experience + routing + encryption + administration + interoperability 

- Send and receive normal internet email with Gmail, Outlook, Yahoo, and other providers. 

- Use custom domains, business mailboxes, aliases, contacts, folders, labels, rules, attachments, signatures, and scheduled sending. 

- Use BYOS webmail and support standard desktop clients through SMTP/IMAP compatibility and the planned Bridge architecture. 

- Support organization-managed and private mailbox modes. 

- Keep persistent mailbox content encrypted in customer-controlled storage. 

- Give every paid plan the same core product rather than artificial feature walls. 

#### **Core Principle** 

Normal email on the outside. Customer-controlled storage underneath. Privacy-aware encryption and organization control at the core. 

###### **REVISED AUGUST 2026** 

BYOS V1 Roadmap  |  Page 1 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION MAP** 

### **Roadmap Map** 

Use this page as the navigation map for the V1 build. 

|**Phase**|**Sections**|**Outcome**|
|---|---|---|
|A. Product + Security Foundation|0-4|Product rules, threat model, crypto gate,<br>architecture, local lab|
|B. Mail Transport|5-8|Inbound/outbound SMTP, Rspamd,<br>queues, trust and reputation controls|
|C. BYOS + Data|9-12|Storage abstraction, onboarding,<br>management, cryptographic system|
|D. Mailbox Product|13-20|Organization model, auth/recovery,<br>search, contacts, scheduled send,<br>IMAP/Bridge, attachments|
|E. Reliability + Operations|21-24|Hardening, observability, backup/DR,<br>exit/recoverytooling|
|F. Commercialization|25-30|Pricing, private beta, security review,<br>production infra, scaling,<br>implementation order|



**SCOPE:** Post-V1 features such as native mobile apps, advanced calendar, full API, legal hold, advanced compliance controls, and browser-extension/native crypto should remain in a separate future backlog unless a real launch requirement moves them forward. 

BYOS V1 Roadmap  |  Page 2 

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

#### **Architecture rules that are now fixed** 

- Customer persistent mailbox storage is outside BYOS infrastructure. 

- Go is the infrastructure/backend language; web stacks are separate. 

- Astro + SolidJS + TailwindCSS is the public management site. 

- SolidJS + TypeScript + Tailwind is the interactive webmail client. 

- Rust/WASM is the client cryptographic core; TypeScript orchestrates UI/API work. 

- Postfix is the initial MTA and Rspamd is the initial filtering layer. 

- Cloudflare is the web/edge layer; Linux VPS infrastructure handles mail services. 

- No feature gating by plan. Plans primarily change mailbox capacity and legitimate usage limits. 

- Detailed anti-spam/reputation rules will be designed when SMTP is implemented, but the outbound trust engine is mandatory architecture. 

BYOS V1 Roadmap  |  Page 3 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**GATE:** Implementation gate: no production crypto implementation until the final V1 crypto review resolves scheduled-send delivery, root-secret compromise, organization recovery credentials, live-mail rotation concurrency, HPKE wire format, and the browser trust boundary. 

BYOS V1 Roadmap  |  Page 4 

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

BYOS V1 Roadmap  |  Page 5 

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
|Mail|Postfx + Rspamd|SMTP transport and fltering|



#### **Reproducibility requirement** 

docker compose up 

Expected: all local services boot from a clean machine and health checks pass without manual repair. 

BYOS V1 Roadmap  |  Page 6 

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

BYOS V1 Roadmap | Page 8

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
|Postfx|Established SMTP transfer and submission infrastructure. Do<br>not write SMTP transport from scratch.<br>|
|Rspamd|Spam/reputation/fltering layer, including SPF/DKIM/DMARC-<br>related checks andpolicyhooks.|
|Redis|Queues, short-lived state, rate-limit counters, caching where<br>appropriate.|
|PostgreSQL|Organization, mailbox, identity, metadata, audit, andjob state.|



BYOS V1 Roadmap  |  Page 9 

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

BYOS V1 Roadmap  |  Page 10 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 7** 

### **Outbound Email Pipeline** 

Webmail / SMTP client / approved API | v Authentication | v Outbound Trust & Abuse Engine | v Queue | v DKIM signing / delivery policy | v Outbound SMTP | v Gmail / Outlook / Yahoo / other providers 

#### **Required standards** 

- SPF 

- DKIM 

- DMARC 

- PTR / reverse DNS 

- TLS 

#### **Single outbound control path** 

SMTP credentials must never bypass the outbound policy layer. Mail originating from webmail, Outlook, Apple Mail, Thunderbird, CRM software, or a custom application must pass through the same trust and abuse controls. 

BYOS V1 Roadmap  |  Page 11 

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

#### **Design principle** 

All plans -> complete email features | 

- +-- safety limits -> protect shared infrastructure and IP reputation 

- +-- established customers may earn higher trust ceilings 

- `-- enterprise may receive custom limits after verification 

**ANTI-ABUSE:** A customer connecting external software through SMTP must not be able to turn a Solo account into an unrestricted relay. The service sells mailbox capability, not an unlimited bulk-mail cannon. 

BYOS V1 Roadmap  |  Page 12 

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
|Business / Team|Organization-level object storage is preferred; S3-compatible<br>storage is theprimaryarchitecturepath.|
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

**PRICING PRINCIPLE:** Plans do not restrict storage technology. A Solo customer with sophisticated S3 infrastructure is still a valid customer. 

BYOS V1 Roadmap  |  Page 13 

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

BYOS V1 Roadmap  |  Page 14 

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

BYOS V1 Roadmap  |  Page 15 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 12** 

### **Cryptographic System** 

The core privacy architecture. Detailed protocol implementation is gated on the final V4.1 cross-feature review. 

#### **Target model** 



<!-- Start of picture text -->
Recovery mnemonic<br>      |<br>      v<br>Stable recovery root secret<br>      |<br>      v<br>Current rotatable mailbox key pair<br>      |<br>      v<br>Random per-message content key<br>      |<br>      v<br>AES-256-GCM encrypted mailbox content<br>      |<br>      v<br>Customer-controlled storage<br><!-- End of picture text -->

#### **Core rules** 

- Mailbox private keys are generated client-side and are never sent to the server unwrapped. 

- A stable recovery root survives ordinary mailbox-key rotation. 

- Per-message content keys are random and are wrapped for the current mailbox public key. 

- Persistent mailbox content is encrypted before customer storage. 

- Organization-managed mailboxes have an authorized organization recovery path. 

- Private mailboxes do not have automatic administrator decryption. 

- Authentication is separate from encryption keys. 

- The server transiently processes inbound plaintext before encryption, but must not persist plaintext mailbox content. 

#### **Proposed protocol primitives** 

|**Layer**|**Primitive / role**|
|---|---|
|Mailbox key|X25519 key pair, rotatable|
|Key wrapping|HPKE using a standardized RFC 9180 implementation; target<br>suite DHKEM(X25519, HKDF-SHA256) + AES-256-GCM|
|Message content|Random 32-byte content key+ AES-256-GCM|
|Derivation|HKDF-SHA256 for scoped sub-keys and recovery-root<br>derivation|
|Admin passphrase|Memory-hard KDF such as Argon2id; exact parameters frozen<br>before implementation|
|Client core|Rust/WASM crypto implementation with a stableJS API|



#### **Implementation gates still to resolve** 

- Scheduled Send without permanently exposing mailbox plaintext to the server 

- Recovery-root rotation when root material is compromised 

- Whether organization-managed employees receive independent mailbox recovery material 

- Cryptographic revocation behavior for removed recovery principals 

BYOS V1 Roadmap  |  Page 16 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

- Live-mail concurrency during long key rotations 

- Canonical HPKE wire format 

- Exact recovery mnemonic encoding/versioning 

- Browser trust-boundary mitigations 

BYOS V1 Roadmap  |  Page 17 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 13** 

### **Organization-Managed vs Private Mailbox** 

|**Property**|**Organization-managed**|**Private**|
|---|---|---|
|Normal user access|Yes|Yes|
|Device-based decryption|Yes|Yes|
|Organization recovery|Yes|No automatic recovery|
|Admin export|Yes, subject topolicy|No automatic export|
|Transfer after employee leaves|Yes, via authorized recovery/re-key fow|No admin transfer without user<br>cooperation|
|Business continuity|Strong|Dependent on user-controlled recovery|



#### **Mailbox creation UI** 

###### Mailbox privacy 

###### (o) Organization-managed 

Admin can access/recover according to organization policy. 

###### (o) Private 

Employee controls mailbox decryption; admin cannot automatically read it. 

**DESIGN:** Privacy mode should be treated as a cryptographic state. In V1, changing between private and organizationmanaged should require an explicit cryptographic migration/re-key flow, not a silent database flag flip. 

BYOS V1 Roadmap  |  Page 18 

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

BYOS V1 Roadmap  |  Page 19 

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

BYOS V1 Roadmap  |  Page 20 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 16** 

### **Local Search & Search Privacy** 

#### **Target architecture** 

Encrypted mailbox | v Local download | v Local decryption | v Local encrypted/indexed database | v Instant mailbox search 

#### **V1 search model** 

For privacy-sensitive fields such as subject terms, the client can compute keyed search tokens locally and send only the token to the server. The server can return message IDs, while the client performs decryption locally. 

#### **Accepted V1 leakage** 

|**Leakage**|**V1position**|
|---|---|
|Token equality|Accepted; server may see that the same search token was used<br>again.|
|Token value|Accepted; token does not directly reveal plaintext subject<br>words, but repeated-token behavior remains visible.|
|Match-set size|Accepted; server can see result counts.|
|Access patterns|Accepted; server can observe which encrypted message objects<br>are subsequentlyfetched.|
|Timing|Accepted; search time and API activityremain visible.|



**WORDING:** Do not claim that the server cannot tell two searches use the same word/token. The correct statement is that the server does not receive the plaintext search term. 

BYOS V1 Roadmap  |  Page 21 

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

BYOS V1 Roadmap  |  Page 22 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 18** 

### **Scheduled Sending** 

**REQUIREMENT:** Scheduled Send is V1 and must work while the user device is offline. 

Compose | v Schedule for future time | v Persist safely | v Scheduler | v Outbound Trust & Abuse Engine | v SMTP delivery 

#### **Critical cryptographic design question** 

The scheduled message must remain protected at rest, yet the server must be able to deliver it after the user device is offline. This means Scheduled Send cannot be treated as a normal client-only feature. 

#### **Pre-implementation decision required** 

- Define a narrowly scoped server delivery capability or an alternative mechanism that does not grant general mailbox decryption. 

- Define cancellation and editing. 

- Define attachment handling. 

- Define storage outage behavior. 

- Define exact server visibility at send time. 

- Run the same outbound abuse controls used for ordinary mail. 

BYOS V1 Roadmap  |  Page 23 

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

**ARCHITECTURE:** Bridge implementation can follow the stable mailbox/encryption protocol, but Bridge compatibility is an architectural V1 requirement and must not be accidentally designed out. 

BYOS V1 Roadmap  |  Page 24 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 20** 

### **Attachment System** 

#### **V1 limit** 

<mark>Maximum total message size: 40 MB</mark> 

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

BYOS V1 Roadmap  |  Page 25 

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

BYOS V1 Roadmap  |  Page 26 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 22** 

### **Monitoring & Observability** 

|**Tool / layer**|**Purpose**|
|---|---|
|Prometheus|Metrics|
|Grafana|Visualization / operational dashboards|
|Sentry|Application errors and diagnostics|
|External uptime monitoring|Availabilityfrom outside the infrastructure|



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

BYOS V1 Roadmap  |  Page 27 

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

BYOS V1 Roadmap  |  Page 28 

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

BYOS V1 Roadmap  |  Page 29 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 25**

### **Billing & Pricing**

#### **Pricing philosophy**

Every paid plan receives the same complete core BYOS email product. Customers pay for **resource capacity and scale**, not for artificial feature unlocks.

Core product functionality is not removed or disabled based on plan. Plan differences primarily determine the scale of resources available to the customer.

| **Plan**       | **Mailboxes** | **Domains** | **Aliases / Mailbox** | **Monthly** | **Annual** |
| -------------- | ------------: | ----------: | --------------------: | ----------: | ---------: |
| **Solo**       |             1 |           1 |                    10 |      **$3** |    **$31** |
| **Starter**    |             5 |           2 |                    15 |     **$14** |   **$143** |
| **Business**   |            10 |           3 |                    20 |     **$26** |   **$265** |
| **Team**       |            25 |           5 |                    30 |     **$60** |   **$612** |
| **Business+**  |            50 |          10 |                    40 |    **$110** | **$1,122** |
| **Enterprise** |           50+ |      Custom |                Custom |      Custom |     Custom |

#### **All plans include the core product**

* Custom domains
* SMTP
* IMAP/Bridge architecture
* BYOS storage connectors
* Encryption
* Search
* Contacts
* Aliases
* Rules
* Scheduled Send
* 2FA
* Google/Microsoft sign-in
* Core organization controls where applicable

#### **Resource limits**

Plans may impose quantitative resource limits without becoming feature gates.

* **Mailbox count** is limited according to the plan.
* **Domain count** is limited according to the plan.
* **Aliases are counted per mailbox** according to the plan.
* Enterprise resource limits are custom and may be established contractually.
* Resource limits apply to capacity and scale, not to whether the underlying feature exists.
* A customer reaching a resource limit may add capacity by upgrading the plan or, where supported, through an applicable Enterprise arrangement.
* Resource limits must be enforced consistently by the control plane and API.
* Resource limits must not silently disable or remove unrelated product functionality.

#### **What can vary**

* Mailbox capacity
* Domain capacity
* Alias capacity
* Legitimate usage ceilings
* Organization capacity
* Enterprise support and contract terms
* Anti-abuse limits required to protect shared infrastructure

**PRICING:** Storage technology is not a premium feature. A Solo customer can connect their own S3-compatible storage, while larger organizations can use the same storage capabilities at greater mailbox and organizational scale.


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

BYOS V1 Roadmap  |  Page 31 

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

#### **Launch sequence** 

Internal review -> findings -> fixes -> retest 

- -> independent security review -> private beta -> remediation -> production launch 

**SECURITY:** A bug bounty is a later layer, not a substitute for a security review and controlled private beta. 

BYOS V1 Roadmap  |  Page 32 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 28** 

### **Production Infrastructure** 

#### **Web / edge** 

Cloudflare |-- DNS |-- TLS |-- WAF / edge controls 

|-- static assets 

- `-- web application delivery 

#### **Email / backend** 

Linux VPS |-- Postfix |-- Rspamd |-- Go services |-- queues / workers 

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

BYOS V1 Roadmap  |  Page 33 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 29** 

### **Scaling Model** 

|**Scale**|**Likely evolution**|
|---|---|
|0-1,000 mailboxes|Small production cluster, strong monitoring, conservative<br>outbound reputationpolicy.|
|1,000-10,000|Additional SMTP gateways, worker capacity, queue scaling,<br>database capacity, reputation segmentation.|
|10,000-50,000|Multiple SMTP gateways, queue/worker clusters, stronger<br>database strategy, more advanced deliveryisolation.|
|50,000+|High availability, database replicas, multiple regions where<br>justifed, advanced IP pools, dedicated enterprise<br>infrastructure.|



**SCALE:** Scaling decisions should be driven by measured bottlenecks, not by premature complexity. BYOS removes much of the mailbox-object storage burden, but bandwidth, metadata, queueing, indexing, CPU, and outbound reputation still scale with usage. 

BYOS V1 Roadmap  |  Page 34 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION 30** 

### **Implementation Order - Where We Start** 

This is the operational sequence to hand to OpenCode and use as the project checklist. 

#### **Step 0 - Freeze the architecture gate** 

- Complete the final security/crypto compatibility review. 

- Resolve Scheduled Send, root rotation, organization recovery credentials, recovery-principal revocation, live-mail key rotation concurrency, HPKE wire format, and browser trust assumptions. 

#### **Step 1 - Build the local laboratory** 

Docker PostgreSQL Redis MinIO Postfix Rspamd Go services Test utilities 

#### **Step 2 - Implement the final Rust/WASM crypto core** 

- Use an established HPKE implementation; do not hand-roll HPKE. 

- Implement recovery-root logic, mailbox keys, message-key wrapping, AES-GCM, HKDF, and exact wireformat serialization. 

- Validate against official test vectors and project-specific test vectors. 

#### **Step 3 - Complete the inbound vertical slice** 

External test sender -> SMTP -> Postfix -> Rspamd -> Go router -> encrypt -> MinIO -> webmail client -> local decrypt -> display message 

**MILESTONE:** Success condition: the stored mailbox object is unreadable plaintext, while the authorized client can decrypt and display the message. 

#### **Step 4 - Implement outbound mail** 

Webmail / SMTP client -> authentication -> outbound trust engine -> queue -> Postfix -> external mailbox 

#### **Step 5 - Implement BYOS** 

- Start with MinIO locally. 

- Add S3 / S3-compatible storage. 

- Add Google Drive. 

BYOS V1 Roadmap  |  Page 35 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

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

BYOS V1 Roadmap  |  Page 36 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

#### **Step 11 - Private beta** 

<mark>5 -> 10 -> 25 -> 50 -> 100 businesses</mark> 

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



<!-- Start of picture text -->
                                  INTERNET<br>
                                     |<br>
                               +-----v------+<br>
                               | CLOUDFLARE |<br>
                               +-----+------+<br>
                                     |<br>
             +-----------------------+-----------------------+<br>             |                       |                       |<br>       +-----v------+          +-----v------+          +-----v------+<br>       | PUBLIC     |          | DASHBOARD  |          | MAILBOX   |<br>       | WEBSITE    |          | SolidJS    |          | SolidJS   |<br>       | Astro      |          | Vite       |          | Vite      |<br>       | SolidJS    |          | TailwindCSS|          | TailwindCSS|<br>       +-----+------+          +-----+------+          +-----+------+<br>             |                       |                       |<br>             +-----------------------+-----------------------+<br>                                     |<br>                                  HTTPS/API<br>                                     |<br>                               +-----v------+<br>                               | GO PLATFORM|<br>                               +-----+------+<br>                                     |<br>                  +------------------+------------------+<br>                  |                                     |<br>            +-----v------+                         +----v-----+<br>            | MAIL       |                         | DATA      |<br>            | Postfix    |                         | Postgres  |<br>            | Rspamd     |                         | Redis     |<br>            | Queue      |                         +----------+<br>            +-----+------+<br>                  |<br>                  v<br>          Customer-controlled storage<br>          Google Drive / S3 / S3-compatible<br><!-- End of picture text -->

#### **Client crypto boundary** 

SolidJS / TypeScript | v Rust/WASM crypto core | +-- recovery root +-- X25519 / HPKE +-- AES-256-GCM +-- HKDF +-- recovery / key serialization 

BYOS V1 Roadmap  |  Page 38 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION B** 

### **Appendix B - Locked Product Decisions** 

|**Decision**|**Current choice**|
|---|---|
|Product model|Full business email + customer-controlledpersistent storage.|
|BYOS|Organization, individual, and hybrid storage supported.|
|Pricing|No featuregating; capacity-based tiers.|
|Frontend split|Astro + SolidJS + TailwindCSS public website; SolidJS + Vite + TailwindCSS dashboard and mailbox.|
|Infrastructure language|Go.|
|Client crypto|Rust/WASM.<br>|
|Mail transfer|Postfx.|
|Filtering|Rspamd.<br>|
|Web edge|Cloudfare.|
|Mailbox storage|Customer-controlled storage.|
|Attachment limit|40 MB total message size in V1.|
|Mailbox modes|Organization-managed + Private.<br>|
|Scheduled Send|V1; works while client is ofine; crypto designgate required.|
|SMTP/IMAP|Standard interoperability required; Bridge architecture<br>planned.|
|Search|Client-oriented privacy model with acknowledged token/access-<br>pattern leakage in V1.|
|Recovery|Separate account recovery from mailbox recovery; stable<br>recoveryroot model.|
|Organization recovery|Multiple authorized recovery principals; exact revocation<br>behavior must be explicit.<br>|
|Outbound safety|Unifed trust/reputation engine for webmail, SMTP clients, and<br>approved APIs.|
|Exit|Independent mailbox export/recoverycapability.|



BYOS V1 Roadmap  |  Page 39 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION C** 

### **Appendix C - V1 Acceptance Checklist** 

|**Gate**|**Pass condition**|
|---|---|
|Architecture|Threat model, crypto spec, feature compatibility matrix<br>approved.|
|Crypto|Test vectors and recovery-after-rotation pass; no global<br>mailbox decryption keyexists.<br>|
|Inbound|External message received, fltered, encrypted, stored,<br>retrieved, and decrypted byauthorized client.|
|Outbound|External delivery works with SPF/DKIM/DMARC/PTR/TLS and<br>trust controls.|
|BYOS|Customer storage can be connected, health-checked, recovered,<br>and changed.|
|Organization|Admins/users/domains/mailboxes/privacy modes/termination<br>behave correctly.|
|Webmail|Core mailbox functions work with local decrypt/search<br>architecture.|
|Client compatibility|SMTP/IMAP Bridge architecture is stable and protocol-<br>compatible.|
|Reliability|Backups restore; storage/queue/server failures have tested<br>behavior.<br>|
|Security|Independent review complete; fndings fxed and retested.|
|Beta|Staged private beta produces acceptable delivery, reliability,<br>recovery, and support metrics.|
|Launch|All launch conditions are met beforepublic signupis enabled.|



BYOS V1 Roadmap  |  Page 40 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

**SECTION D** 

### **Appendix D - Post-V1 Future Backlog** 

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

BYOS V1 Roadmap  |  Page 41 

BYOS BUSINESS EMAIL  |  V1 PROTOTYPE ROADMAP 

### **Final V1 Position** 

The V1 product is a complete business-email service with normal internet interoperability, customercontrolled persistent storage, privacy-aware mailbox encryption, organization administration, recovery, scheduled sending, and a path to standard desktop clients. The architecture is intentionally split so each major concern has a clear home: Astro + SolidJS for the public website, SolidJS + Vite for the dashboard and mailbox, Rust/WASM for client cryptography, and Go/Postfix/Rspamd for the mail platform. 

PAY FOR CAPACITY. CHOOSE YOUR STORAGE. USE NORMAL EMAIL. KEEP CONTROL OF YOUR DATA. 

**CANONICAL:** This roadmap is the canonical V1 project plan. Detailed cryptographic protocol files may expand or refine the crypto sections, but product-wide decisions recorded here should not be silently changed during implementation. 

BYOS V1 Roadmap  |  Page 42 

