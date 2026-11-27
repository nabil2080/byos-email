import { type Component, createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";

export interface FaqItem {
  id: string;
  category: "general" | "security" | "how_to_use" | "payment";
  categoryLabel: string;
  question: string;
  shortSnippet: string;
  tags: string[];
  iconType?: "sad" | "bug" | "warning" | "business" | "default";
  answer: {
    lead: string;
    paragraphs?: string[];
    steps?: string[];
    table?: {
      headers: string[];
      rows: string[][];
    };
    callout?: {
      type: "note" | "tip" | "warning";
      text: string;
    };
    actionLink?: {
      label: string;
      href: string;
      isExternal?: boolean;
    };
  };
}

// ---------------------------------------------------------------------------
// 4 Primary Featured Quick-Action Items (Exact match to Reference Design)
// ---------------------------------------------------------------------------
export const FEATURED_ACTION_ITEMS: FaqItem[] = [
  {
    id: "action-cannot-access-account",
    category: "general",
    categoryLabel: "General questions",
    iconType: "sad",
    question: "I can't access my account",
    shortSnippet: "Resolving login locks, 24-word recovery phrase unwrapping, passkey re-enrollment, and clock skew.",
    tags: ["cannot access", "locked out", "login error", "password", "recovery phrase", "bip39", "passkey", "yubikey"],
    answer: {
      lead: "Because BYOS uses client-side zero-knowledge encryption, our servers never store your password or master private key in plaintext. If you are locked out, follow these recovery procedures:",
      steps: [
        "Check Your Device System Clock: Zero-knowledge WebAuthn passkeys and cryptographic session headers reject timestamps off by >60 seconds. Ensure your computer or phone has automatic network time synchronization enabled.",
        "Use Your 24-Word Recovery Phrase: On the login screen, click 'Recover with Phrase'. Enter your 24 BIP-39 words in sequence. Your browser will recalculate your cryptographic root seed locally and unwrap your master mailbox key.",
        "Passkey / Hardware Token Selection: If prompted for biometric or security key sign-in, make sure you choose the enrolled device (Touch ID, Windows Hello, or USB YubiKey).",
        "Clear Browser Cache & Service Worker: If you recently upgraded your browser or experienced network drops, clear site cookies and reload to initialize a fresh WebAssembly crypto runtime."
      ],
      callout: {
        type: "warning",
        text: "Strict Zero-Knowledge Notice: BYOS Support staff cannot reset your password, bypass cryptographic locks, or recover your lost master key. Only your 24-word recovery phrase or an enrolled passkey can unlock your mailbox."
      },
      actionLink: {
        label: "Launch Emergency Key Recovery Portal →",
        href: "http://localhost:3000/dashboard/recovery"
      }
    }
  },
  {
    id: "action-found-a-bug",
    category: "general",
    categoryLabel: "General questions",
    iconType: "bug",
    question: "I have found a bug",
    shortSnippet: "Submit an authenticated Help Desk ticket, attach browser console diagnostics, and track patch resolution.",
    tags: ["bug", "issue", "error", "crash", "console", "ticket", "help desk", "report"],
    answer: {
      lead: "We appreciate your help keeping BYOS rock-solid. Authenticated organization members and administrators can report bugs directly to our core engineering team.",
      steps: [
        "Open Help Desk in Control Panel: Navigate to Dashboard > Help & Support and click 'Open Support Ticket'.",
        "Select Category: Choose 'Bug / Technical Defect' and select the affected product area (Webmail, Control Panel, Storage Bucket, DNS Routing).",
        "Include Diagnostic Details: Paste any error messages, browser console logs (F12 > Console), and reproduction steps. Never include private encryption keys or customer passwords in bug reports.",
        "Two-Way Status Tracking: You will receive an immediate confirmation email with a cryptographic reply address (`reply+token@support.byos.local`). You can reply directly from your email client or track ticket updates live."
      ],
      callout: {
        type: "tip",
        text: "Our core engineering team monitors High and Critical bug tickets 24/7 with immediate triage and hotfix deployments."
      },
      actionLink: {
        label: "Open a Support Ticket in Help Desk →",
        href: "http://localhost:3000/dashboard/support"
      }
    }
  },
  {
    id: "action-report-abuse",
    category: "security",
    categoryLabel: "Security and Privacy",
    iconType: "warning",
    question: "I would like to report abuse",
    shortSnippet: "Zero-tolerance spam and phishing policy, rapid DKIM key revocation, and ISP abuse coordination.",
    tags: ["abuse", "spam", "phishing", "malware", "spoofing", "dmarc", "report abuse"],
    answer: {
      lead: "BYOS enforces an absolute zero-tolerance policy against spam, phishing, credential harvesting, malware distribution, or unsolicited bulk email.",
      paragraphs: [
        "If you receive an abusive email originating from a BYOS domain or user account, please forward the entire message including full, unedited RFC 822 email headers to abuse@byos.local.",
        "To obtain raw headers in Gmail: Click the three dots (⋮) > 'Show original'. In Outlook: File > Properties > Internet headers. In Apple Mail: View > Message > Raw Source."
      ],
      steps: [
        "Immediate Automated Quarantine: Domains flagged with authenticated abuse evidence are quarantined within 15 minutes.",
        "DKIM & Route Revocation: Cryptographic signing keys associated with spamming accounts are permanently revoked.",
        "Account Suspension: The originating tenant organization is suspended and upstream network coordinators are notified."
      ],
      callout: {
        type: "note",
        text: "For urgent abuse emergencies involving credential theft or ongoing cyber threats, contact our Trust & Safety response team directly at abuse@byos.local."
      },
      actionLink: {
        label: "Review BYOS Security & Acceptable Use Policy →",
        href: "/security"
      }
    }
  },
  {
    id: "action-business-request",
    category: "how_to_use",
    categoryLabel: "How to use BYOS",
    iconType: "business",
    question: "I have a business request",
    shortSnippet: "Enterprise SLAs (99.99%), custom compliance MSAs (HIPAA BAA, SOC 2), dedicated clusters, and on-premise air-gap.",
    tags: ["business", "enterprise", "sales", "sla", "hipaa", "soc 2", "contract", "on-premise", "cluster"],
    answer: {
      lead: "We partner with security-conscious enterprises, healthcare providers, legal practices, and sovereign institutions worldwide.",
      paragraphs: [
        "Whether you require a dedicated isolated tenant cluster, custom Business Associate Agreements (BAA) for HIPAA compliance, SOC 2 Type II audit attestations, or fully air-gapped on-premise Kubernetes deployments, our solutions engineering team is ready to assist.",
        "We also provide white-glove migration engineering to transition thousands of legacy mailboxes from Microsoft 365 or Google Workspace with zero downtime and verified cryptographic key custody."
      ],
      table: {
        headers: ["Enterprise Tier", "SLA Guarantee", "Compliance & Deployment"],
        rows: [
          ["Business Standard", "99.9% Uptime", "Multi-tenant sovereign cloud, automated backups"],
          ["Enterprise Dedicated", "99.99% Uptime", "Isolated tenant VPC, custom HIPAA BAA & SOC 2"],
          ["Sovereign Air-Gap", "Custom SLA", "Self-hosted Kubernetes, customer KMS keys, air-gapped"]
        ]
      },
      actionLink: {
        label: "Contact Enterprise Solutions: enterprise@byos.local →",
        href: "mailto:enterprise@byos.local",
        isExternal: true
      }
    }
  }
];

// ---------------------------------------------------------------------------
// Comprehensive Knowledge Base FAQs (4 Core Categories)
// ---------------------------------------------------------------------------
export const FAQ_ITEMS: FaqItem[] = [
  // =========================================================================
  // 1. General questions
  // =========================================================================
  {
    id: "dns-records-setup",
    category: "general",
    categoryLabel: "General questions",
    question: "What DNS records are required to connect my company custom domain?",
    shortSnippet: "Exact MX, SPF, DKIM, and DMARC DNS records required for 100% inbox delivery.",
    tags: ["dns", "mx", "spf", "dkim", "dmarc", "cloudflare", "namecheap", "godaddy", "domain verification"],
    answer: {
      lead: "To route incoming email and guarantee 100% deliverability, add the following standard DNS records at your domain registrar or DNS host (Cloudflare, Namecheap, GoDaddy, AWS Route 53):",
      table: {
        headers: ["Record Type", "Host / Name", "Value / Target", "Priority / TTL"],
        rows: [
          ["MX", "@ (root)", "mail.byos.local", "10 (Auto TTL)"],
          ["TXT", "@ (root)", "v=spf1 include:_spf.byos.local ~all", "Auto TTL"],
          ["TXT", "byos._domainkey", "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ...", "Auto TTL"],
          ["TXT", "_dmarc", "v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@byos.local", "Auto TTL"]
        ]
      },
      paragraphs: [
        "Once added, return to your Control Panel > Domains and click 'Verify DNS Records'. Our system will perform real-time DNS queries against your authoritative nameservers."
      ],
      actionLink: {
        label: "Configure Domains in Control Panel →",
        href: "http://localhost:3000/dashboard/domains"
      }
    }
  },
  {
    id: "domain-verification-timing",
    category: "general",
    categoryLabel: "General questions",
    question: "How long does domain verification take after updating DNS?",
    shortSnippet: "DNS propagation expectations, TTL recommendations, and instant manual verification probe.",
    tags: ["propagation", "timing", "ttl", "verify domain", "nameservers"],
    answer: {
      lead: "Domain verification typically takes between 60 seconds and 15 minutes, depending on your DNS provider's Time-To-Live (TTL) configuration.",
      paragraphs: [
        "If you use modern cloud DNS providers like Cloudflare, AWS Route 53, or Vercel DNS, propagation is near-instantaneous (under 2 minutes). For older registrars with default 24-hour TTLs, changes may take a few hours.",
        "You can click the 'Check DNS Now' button in Dashboard > Domains to trigger an immediate verification probe without waiting for scheduled background checks."
      ]
    }
  },
  {
    id: "multiple-domains-catchall",
    category: "general",
    categoryLabel: "General questions",
    question: "Can I connect multiple custom domains and configure a catch-all address?",
    shortSnippet: "Multi-domain management, domain aliasing, and wildcard catch-all routing.",
    tags: ["catch-all", "multiple domains", "aliases", "wildcard", "routing"],
    answer: {
      lead: "Yes. Organizations can add unlimited custom domains based on provisioned seat capacity.",
      paragraphs: [
        "You can configure a catch-all mailbox for any verified domain, ensuring that any email sent to a typo or non-existent address (e.g. `billing-inquiries@yourdomain.com`) is safely captured and routed to your designated administrative inbox instead of bouncing."
      ]
    }
  },
  {
    id: "spam-folder-deliverability",
    category: "general",
    categoryLabel: "General questions",
    question: "Why are my outgoing emails landing in recipients' spam folders?",
    shortSnippet: "Diagnosing SPF, DKIM, and DMARC alignment, IP reputation, and domain warmup.",
    tags: ["spam", "junk", "deliverability", "inbox", "warmup", "blacklisted", "spam score"],
    answer: {
      lead: "Over 95% of deliverability issues are caused by missing or misconfigured email authentication records.",
      steps: [
        "Check your SPF Record: Ensure you do not have multiple SPF records (RFC 7208 strictly forbids multiple TXT records starting with v=spf1). Merge them into one.",
        "Verify DKIM Alignment: Make sure the DKIM public key in your DNS matches the cryptographic key provisioned for your domain in BYOS.",
        "Publish DMARC: Modern email providers like Google and Yahoo require an active DMARC policy for all bulk and business senders.",
        "Warm up New Domains: If your domain was registered recently, avoid sending hundreds of cold emails immediately. Build reputation gradually over 2-3 weeks."
      ]
    }
  },
  {
    id: "stay-signed-in",
    category: "general",
    categoryLabel: "General questions",
    question: "Can I stay signed in across multiple browsers or mobile devices?",
    shortSnippet: "Session isolation and persistent encrypted device authorizations.",
    tags: ["session", "devices", "mobile", "concurrent", "stay signed in", "timeout"],
    answer: {
      lead: "Yes. BYOS provides cryptographically isolated sessions across all your workstations, laptops, and mobile devices.",
      paragraphs: [
        "Each device maintains an independent encrypted session token with granular revocation controls. You can view all active sessions, IP locations, and device types in Settings > Active Sessions, and terminate unauthorized devices remotely with one click."
      ]
    }
  },
  {
    id: "migrating-old-emails",
    category: "general",
    categoryLabel: "General questions",
    question: "How do I migrate my old emails from Google Workspace, Microsoft 365, or Fastmail?",
    shortSnippet: "Seamless one-click IMAP/Mbox migration with zero downtime.",
    tags: ["migrate", "migration", "import", "imap", "mbox", "google workspace", "microsoft 365", "transfer"],
    answer: {
      lead: "You can migrate your entire email history into BYOS without interrupting active mail delivery.",
      steps: [
        "Log into BYOS Webmail and navigate to Settings > Import & Export.",
        "Select 'IMAP Migration' and enter your existing provider credentials (or generated App Password).",
        "Select the folders you wish to import (Inbox, Sent, Archive, Custom Folders).",
        "Click 'Start Migration'. BYOS will fetch your historical messages, encrypt each one with your client key, and index them into your storage bucket."
      ]
    }
  },

  // =========================================================================
  // 2. Security and Privacy
  // =========================================================================
  {
    id: "zero-knowledge-how-it-works",
    category: "security",
    categoryLabel: "Security and Privacy",
    question: "How does BYOS zero-knowledge encryption work compared to standard email?",
    shortSnippet: "Post-quantum HPKE, client-side WebAssembly cryptography, and encrypted search tokens.",
    tags: ["hpke", "kyber", "xwing", "quantum", "encryption", "privacy", "zero knowledge", "e2ee"],
    answer: {
      lead: "Traditional email providers like Google Workspace or Microsoft 365 encrypt emails 'at rest' using server-held keys, meaning administrators, AI scanners, and government subpoenas can read your emails in plaintext.",
      paragraphs: [
        "BYOS executes client-side WebAssembly cryptography directly in your browser. Messages are encrypted using Hybrid Public Key Encryption (HPKE) combining Kyber-768 post-quantum key encapsulation with X25519 and AES-256-GCM authenticated cipher.",
        "When an email arrives or is sent, the BYOS backend stores only opaque binary ciphertext. Neither BYOS employees, data center operators, nor cloud storage providers have the capability to decrypt your communications."
      ],
      callout: {
        type: "tip",
        text: "All cryptographic primitives are compiled from open-source audited Rust code into client-side WebAssembly (WASM), verifying mathematical zero-knowledge boundaries."
      },
      actionLink: {
        label: "Read Cryptographic Architecture Whitepaper →",
        href: "/security"
      }
    }
  },
  {
    id: "path-a-external-recipients",
    category: "security",
    categoryLabel: "Security and Privacy",
    question: "How do I send an encrypted email to someone who doesn't use BYOS?",
    shortSnippet: "Zero-knowledge Path A recipient delivery with password protection and ephemeral decrypt.",
    tags: ["path a", "external email", "gmail", "yahoo", "password protected", "otp", "decrypt portal"],
    answer: {
      lead: "You can securely communicate with anyone on Earth, even if they use standard plaintext providers like Gmail, Yahoo, or Outlook.",
      paragraphs: [
        "When composing an email to an external recipient in BYOS Webmail, toggle 'Password Protection' and establish a shared passphrase or delivery pin.",
        "The external recipient receives a clean notification email directing them to an authenticated zero-knowledge web portal. Upon entering the shared passphrase, their browser derives the AES-256 decryption key using client-side Argon2id and decrypts the message and attachments without installing any software."
      ]
    }
  },
  {
    id: "data-scanning-ai-training",
    category: "security",
    categoryLabel: "Security and Privacy",
    question: "Does BYOS scan my emails, serve ads, or train AI models on my data?",
    shortSnippet: "Strict non-interference guarantee: zero advertising, zero telemetry, and zero model training.",
    tags: ["ai", "training", "ads", "advertising", "privacy policy", "scanning", "telemetry"],
    answer: {
      lead: "Strictly and categorically NO. BYOS is a paid infrastructure software platform, not an ad-supported surveillance service.",
      paragraphs: [
        "We do not scan your emails, index keywords on our servers, serve targeted ads, or feed customer communications into machine learning or large language models.",
        "Because our encryption architecture is zero-knowledge, it is mathematically impossible for our servers to inspect the contents of your emails, calendar events, or attachments even if compelled."
      ]
    }
  },
  {
    id: "passkey-hardware-keys",
    category: "security",
    categoryLabel: "Security and Privacy",
    question: "How do passkeys and hardware keys (FIDO2 / YubiKey) work with BYOS?",
    shortSnippet: "Learn how WebAuthn passkeys deliver phishing-resistant biometric and hardware authentication.",
    tags: ["passkey", "yubikey", "fido2", "webauthn", "biometrics", "touch id", "face id", "hardware key", "2fa"],
    answer: {
      lead: "BYOS supports passwordless biometric sign-in via FIDO2 / WebAuthn passkeys (Apple Touch ID, Face ID, Windows Hello, and hardware security keys like YubiKey).",
      paragraphs: [
        "When you enroll a passkey in Dashboard > Security, a cryptographic public-private key pair is generated on your secure enclave or hardware token. The private key never leaves your device.",
        "Passkeys protect your account against sophisticated phishing attacks, credential replay, and MITM interception. You can enroll up to 10 hardware keys or devices per mailbox seat."
      ],
      steps: [
        "Log in to your Control Panel or Webmail account.",
        "Navigate to Settings > Security > Passkeys & Hardware Keys.",
        "Click 'Add Passkey' and touch your biometric sensor or hardware token.",
        "Name your key (e.g. 'Work YubiKey 5C') and save your configuration."
      ],
      actionLink: {
        label: "Manage Passkeys in Settings →",
        href: "http://localhost:3000/dashboard/settings"
      }
    }
  },
  {
    id: "lost-password-recovery",
    category: "security",
    categoryLabel: "Security and Privacy",
    question: "I lost my account password. How can I recover access?",
    shortSnippet: "Understand zero-knowledge password recovery using your 24-word recovery phrase.",
    tags: ["password", "forgot password", "recovery", "bip39", "seed phrase", "reset", "login"],
    answer: {
      lead: "Because BYOS uses client-side zero-knowledge encryption, our servers never store or see your password in plaintext. Your password derives the cryptographic key that unlocks your master private key.",
      paragraphs: [
        "If you forget your password, you must use your 24-word BIP-39 recovery phrase generated when your mailbox was provisioned. On the login screen, click 'Recover with Phrase', enter your email, and input your 24 words in sequence.",
        "Your browser locally recalculates your cryptographic root seed and unwraps your historical mailbox keys. Once verified, you will be prompted to set a new password."
      ],
      callout: {
        type: "warning",
        text: "Important: Because of our strict zero-knowledge architecture, BYOS Support staff cannot reset your password, bypass cryptographic locks, or recover lost private keys for you."
      },
      actionLink: {
        label: "Open Key Recovery in Control Panel →",
        href: "http://localhost:3000/dashboard/recovery"
      }
    }
  },

  // =========================================================================
  // 3. How to use BYOS
  // =========================================================================
  {
    id: "bring-your-own-storage-s3-r2",
    category: "how_to_use",
    categoryLabel: "How to use BYOS",
    question: "Where are my emails and attachments stored, and how does BYOS storage work?",
    shortSnippet: "Connecting Cloudflare R2, Amazon S3, Google Cloud, or MinIO with zero storage markups.",
    tags: ["s3", "r2", "cloudflare", "minio", "bucket", "object storage", "zero markup", "aws"],
    answer: {
      lead: "With BYOS ('Bring Your Own Storage'), you own and control the physical repository where your encrypted ciphertext lives.",
      paragraphs: [
        "Instead of paying inflated storage markups ($10 to $20/user/mo) to email providers, you connect your own standard S3-compatible bucket (such as Cloudflare R2 with $0 egress fees, Amazon S3, Backblaze B2, or self-hosted MinIO).",
        "All data written to your bucket is pre-encrypted with client-side authenticated cipher before transport. Even if someone obtains read access to your cloud storage bucket, they see only indecipherable encrypted blobs."
      ],
      actionLink: {
        label: "Connect Cloud Storage in Dashboard →",
        href: "http://localhost:3000/dashboard/storage"
      }
    }
  },
  {
    id: "attachment-size-limits",
    category: "how_to_use",
    categoryLabel: "How to use BYOS",
    question: "What is the maximum attachment size limit for outgoing and incoming mail?",
    shortSnippet: "Up to 100MB per message with multi-threaded Web Worker client-side chunking.",
    tags: ["attachments", "file size", "100mb", "limit", "upload", "chunking"],
    answer: {
      lead: "BYOS supports message attachments up to 100MB per email — 4x larger than Gmail and Outlook's 25MB threshold.",
      paragraphs: [
        "Our upload architecture uses background Web Workers to encrypt files in parallel binary chunks with automatic retry and resumable streaming directly into your connected storage bucket.",
        "When sending to external recipients whose mail servers cannot accept 100MB emails, BYOS automatically converts heavy attachments into secure zero-knowledge download portals."
      ]
    }
  },
  {
    id: "email-client-configuration",
    category: "how_to_use",
    categoryLabel: "How to use BYOS",
    question: "How do I configure my email client or mobile device with BYOS?",
    shortSnippet: "Setting up IMAP/SMTP bridge, OAuth app passwords, and mobile PWA installation.",
    tags: ["imap", "smtp", "client", "thunderbird", "apple mail", "outlook", "ios", "android"],
    answer: {
      lead: "BYOS offers both a responsive progressive web app (PWA) and secure bridge connectors for third-party email clients.",
      paragraphs: [
        "You can install BYOS Webmail directly on iOS and Android devices by opening the webmail URL in Safari or Chrome and tapping 'Add to Home Screen' for an offline-ready, native-feeling app experience.",
        "For desktop email clients (Thunderbird, Apple Mail), we provide the BYOS Local Crypto Bridge, which runs locally on your machine and transparently decrypts and encrypts messages over local loopback IMAP/SMTP."
      ]
    }
  },
  {
    id: "custom-folders-rules",
    category: "how_to_use",
    categoryLabel: "How to use BYOS",
    question: "How do custom folders, rules, and spam filters work in BYOS Webmail?",
    shortSnippet: "Client-side encrypted filter rules, folder organization, and automated triage.",
    tags: ["folders", "rules", "filters", "organization", "labels", "sorting"],
    answer: {
      lead: "Organize your workflow with nested folders and deterministic client-side filter rules.",
      steps: [
        "Create Custom Folders: Right-click the folder sidebar in Webmail and select 'New Folder' to create nested color-coded directories.",
        "Configure Automation Rules: Go to Settings > Mail Filters. Define condition triggers based on sender address, subject keywords, or header tags.",
        "Automated Actions: Route incoming messages automatically to designated folders, apply custom priority tags, or mark messages as read.",
        "Encrypted Execution: Unlike traditional servers that parse rules in plaintext, BYOS filter rules operate over blinded search tokens, preserving complete privacy."
      ]
    }
  },

  // =========================================================================
  // 4. Payment
  // =========================================================================
  {
    id: "per-seat-pricing-tiers",
    category: "payment",
    categoryLabel: "Payment",
    question: "How does transparent per-seat pricing work, and what is the storage markup?",
    shortSnippet: "Graduated volume brackets, annual discounts, and zero percent storage markups.",
    tags: ["pricing", "cost", "seats", "annual", "discount", "graduated", "bill", "subscription"],
    answer: {
      lead: "BYOS charges transparent, graduated rates for mailbox seats. Storage carries 0% markup.",
      table: {
        headers: ["Seat Bracket", "Monthly Rate", "Annual Rate (Save 17%)"],
        rows: [
          ["Seats 1 – 10", "$3.00 / seat / mo", "$2.50 / seat / mo"],
          ["Seats 11 – 25", "$2.85 / seat / mo", "$2.38 / seat / mo"],
          ["Seats 26 – 50", "$2.70 / seat / mo", "$2.25 / seat / mo"],
          ["Seats 51 – 100", "$2.50 / seat / mo", "$2.08 / seat / mo"],
          ["Seats 101+", "$2.20 / seat / mo", "$1.83 / seat / mo"]
        ]
      },
      paragraphs: [
        "Because you bring your own storage, storage costs are paid directly to your cloud infrastructure provider at raw wholesale rates (e.g. $0.015/GB/mo on Cloudflare R2 with free bandwidth). A company with 20 users and 500GB of email typically saves over $1,200/year compared to Google Workspace."
      ],
      actionLink: {
        label: "Calculate Your Savings on Pricing Page →",
        href: "/pricing"
      }
    }
  },
  {
    id: "add-remove-seats",
    category: "payment",
    categoryLabel: "Payment",
    question: "Can I add or remove seats at any time, and how is billing prorated?",
    shortSnippet: "Instant seat provisioning, prorated billing adjustments, and capacity management.",
    tags: ["add seats", "remove seats", "prorated", "upgrade", "downgrade", "capacity"],
    answer: {
      lead: "Yes. You have full control over your organization's seat allocation.",
      paragraphs: [
        "When you add seats, they are instantly available for new mailbox invitations. Upgrades during a billing cycle are automatically prorated to the exact day. When removing unassigned seats, your next invoice reflects the reduced capacity without cancellation penalties."
      ],
      actionLink: {
        label: "Manage Organization Seats in Billing →",
        href: "http://localhost:3000/dashboard/billing"
      }
    }
  },
  {
    id: "payment-methods-accepted",
    category: "payment",
    categoryLabel: "Payment",
    question: "What payment methods do you accept (Credit Card, Wire, Invoicing)?",
    shortSnippet: "Major credit cards, SEPA direct debit, ACH bank transfers, and automated PDF tax invoices.",
    tags: ["payment methods", "credit card", "stripe", "wire transfer", "ach", "sepa", "invoice", "vat"],
    answer: {
      lead: "We support a wide range of international payment methods for organizations of all sizes.",
      paragraphs: [
        "We accept Visa, Mastercard, American Express, and Discover with PCI-compliant tokenized processing.",
        "For teams with 25+ seats on annual billing plans, we offer invoice payment via ACH bank transfer, SEPA direct debit, or domestic wire transfer with custom PO numbers and formal tax invoicing."
      ]
    }
  }
];

export const CATEGORIES = [
  { id: "general", label: "General questions", icon: "question" },
  { id: "security", label: "Security and Privacy", icon: "shield" },
  { id: "how_to_use", label: "How to use BYOS", icon: "gear" },
  { id: "payment", label: "Payment", icon: "card" },
] as const;

export const SupportFaqHub: Component = () => {
  const [selectedCategory, setSelectedCategory] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal<string>("");
  const [expandedId, setExpandedId] = createSignal<string | null>("action-cannot-access-account");
  const [helpfulFeedback, setHelpfulFeedback] = createSignal<Record<string, boolean>>({});

  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://localhost:3000";
  };

  let searchInputRef: HTMLInputElement | undefined;

  // Global shortcut handler (/ and Ctrl+K / Cmd+K focuses search)
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" && (e.target as HTMLElement)?.tagName !== "INPUT" && (e.target as HTMLElement)?.tagName !== "TEXTAREA") ||
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")
      ) {
        e.preventDefault();
        searchInputRef?.focus();
        searchInputRef?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const toggleCategory = (catId: string) => {
    if (selectedCategory() === catId) {
      setSelectedCategory(null);
    } else {
      setSelectedCategory(catId);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const markHelpful = (id: string, isHelpful: boolean) => {
    setHelpfulFeedback((prev) => ({ ...prev, [id]: isHelpful }));
  };

  const resetFilters = () => {
    setSelectedCategory(null);
    setSearchQuery("");
  };

  // Filtered FAQs when searching or category selected
  const activeQuestions = createMemo(() => {
    const query = searchQuery().toLowerCase().trim();
    const cat = selectedCategory();

    // When searching, search across both featured action items and all FAQs
    if (query) {
      const allItems = [...FEATURED_ACTION_ITEMS, ...FAQ_ITEMS];
      return allItems.filter((item) => {
        const inQuestion = item.question.toLowerCase().includes(query);
        const inSnippet = item.shortSnippet.toLowerCase().includes(query);
        const inTags = item.tags.some((t) => t.toLowerCase().includes(query));
        const inLead = item.answer.lead.toLowerCase().includes(query);
        const inParagraphs = item.answer.paragraphs?.some((p) => p.toLowerCase().includes(query)) || false;
        return inQuestion || inSnippet || inTags || inLead || inParagraphs;
      });
    }

    // When a category is selected, return all FAQs in that category (plus matching featured items)
    if (cat) {
      const matchingFeatured = FEATURED_ACTION_ITEMS.filter((item) => item.category === cat);
      const matchingCategory = FAQ_ITEMS.filter((item) => item.category === cat);
      return [...matchingFeatured, ...matchingCategory];
    }

    // Default: Show the 4 prominent featured action items
    return FEATURED_ACTION_ITEMS;
  });

  // Render Category Icon (Burgundy outline style matching Reference Image)
  const renderCategoryIcon = (icon: string) => {
    switch (icon) {
      case "question":
        return (
          <svg class="w-6 h-6 stroke-[#800020] fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      case "shield":
        return (
          <svg class="w-6 h-6 stroke-[#800020] fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <polyline points="9 12 11 14 15 10" />
          </svg>
        );
      case "gear":
        return (
          <svg class="w-6 h-6 stroke-[#800020] fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        );
      case "card":
        return (
          <svg class="w-6 h-6 stroke-[#800020] fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
        );
      default:
        return null;
    }
  };

  // Render Left Accordion Icon
  const renderItemIcon = (type?: string) => {
    switch (type) {
      case "sad":
        return (
          <svg class="w-5 h-5 stroke-[#800020] fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <path d="M16 16s-1.5-2-4-2-4 2-4 2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        );
      case "bug":
        return (
          <svg class="w-5 h-5 stroke-[#800020] fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
            <rect width="8" height="14" x="8" y="6" rx="4" />
            <path d="m19 7-3 2" />
            <path d="m5 7 3 2" />
            <path d="m19 19-3-2" />
            <path d="m5 19 3-2" />
            <path d="M20 13h-4" />
            <path d="M4 13h4" />
            <path d="m10 4 1 2" />
            <path d="m14 4-1 2" />
          </svg>
        );
      case "warning":
        return (
          <svg class="w-5 h-5 stroke-[#800020] fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
      case "business":
        return (
          <svg class="w-5 h-5 stroke-[#800020] fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
            <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
            <path d="M9 22v-4h6v4" />
            <path d="M8 6h.01" />
            <path d="M16 6h.01" />
            <path d="M12 6h.01" />
            <path d="M12 10h.01" />
            <path d="M12 14h.01" />
            <path d="M16 10h.01" />
            <path d="M16 14h.01" />
            <path d="M8 10h.01" />
            <path d="M8 14h.01" />
          </svg>
        );
      default:
        return (
          <svg class="w-5 h-5 stroke-[#800020] fill-none stroke-[1.8] shrink-0" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        );
    }
  };

  return (
    <div class="w-full max-w-4xl mx-auto px-4 sm:px-6 select-none">
      {/* ─────────────────────────────────────────────────────────────────────────
          1. Main Title: "How can we help you?" (Burgundy / Wine Header)
      ────────────────────────────────────────────────────────────────────────── */}
      <div class="text-center mb-6 sm:mb-8">
        <h1 class="text-2xl sm:text-4xl font-extrabold text-[#800020] tracking-tight">
          How can we help you?
        </h1>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────
          2. Centered Search Box: "Please enter your question"
      ────────────────────────────────────────────────────────────────────────── */}
      <div class="relative max-w-lg mx-auto mb-10 sm:mb-12">
        <div class="relative flex items-center">
          <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#878A8E]">
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          <input
            ref={(el) => (searchInputRef = el)}
            type="text"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Please enter your question"
            aria-label="Please enter your question"
            class="w-full pl-10 pr-20 py-2.5 sm:py-3 text-xs sm:text-sm bg-[#F6F3ED] rounded-md sm:rounded-lg border border-[#DDD8CE] shadow-2xs text-[#1A1B1E] placeholder:text-[#999B9E] focus:outline-none focus:ring-1 focus:ring-[#800020] focus:border-[#800020] transition-all"
          />

          <div class="absolute inset-y-0 right-0 pr-2.5 flex items-center gap-1.5">
            <Show when={searchQuery()}>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                class="text-[#878A8E] hover:text-[#1A1B1E] p-1 rounded text-xs font-bold transition cursor-pointer"
                aria-label="Clear search query"
              >
                ✕
              </button>
            </Show>
            <kbd class="hidden sm:inline-flex items-center text-[10px] font-mono font-medium text-[#878A8E] bg-[#F5F2EB] border border-[#DDD8CE] rounded px-1.5 py-0.5 pointer-events-none">
              /
            </kbd>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────
          3. Subtitle: "Frequently Asked Questions"
      ────────────────────────────────────────────────────────────────────────── */}
      <div class="text-center mb-6">
        <h2 class="text-base sm:text-xl font-bold text-[#1A1B1E] tracking-tight">
          Frequently Asked Questions
        </h2>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────
          4. 4 Category Cards (Horizontal Grid, Burgundy Borders)
      ────────────────────────────────────────────────────────────────────────── */}
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8 sm:mb-10">
        <For each={CATEGORIES}>
          {(cat) => {
            const isSelected = () => selectedCategory() === cat.id;

            return (
              <button
                type="button"
                onClick={() => toggleCategory(cat.id)}
                aria-pressed={isSelected()}
                class={`flex flex-col items-center justify-center p-4 sm:p-5 rounded-lg border text-center transition-all duration-150 cursor-pointer group focus:outline-none focus:ring-2 focus:ring-[#800020]/30 ${
                  isSelected()
                    ? "bg-[#FFF9F9] border-2 border-[#800020] shadow-xs"
                    : "bg-[#F6F3ED] border-[#800020] hover:bg-[#FFFDFC] hover:shadow-xs"
                }`}
              >
                <div class="mb-2.5 transition-transform duration-150 group-hover:scale-105">
                  {renderCategoryIcon(cat.icon)}
                </div>
                <span
                  class={`text-xs sm:text-sm font-semibold tracking-tight transition-colors ${
                    isSelected() ? "text-[#800020] font-bold" : "text-[#1A1B1E] group-hover:text-[#800020]"
                  }`}
                >
                  {cat.label}
                </span>
              </button>
            );
          }}
        </For>
      </div>

      {/* Active Filter Notification Bar */}
      <Show when={selectedCategory() || searchQuery()}>
        <div class="mb-5 flex items-center justify-between p-3 rounded-lg bg-[#FAF7F2] border border-[#D8D3C9] text-xs">
          <div class="flex items-center gap-2 text-[#18212A]">
            <span class="font-medium">
              <Show
                when={searchQuery()}
                fallback={`Showing questions in "${CATEGORIES.find((c) => c.id === selectedCategory())?.label}"`}
              >
                Search results for <span class="font-bold text-[#800020]">"{searchQuery()}"</span> ({activeQuestions().length} found)
              </Show>
            </span>
          </div>
          <button
            type="button"
            onClick={resetFilters}
            class="text-xs font-semibold text-[#800020] hover:underline cursor-pointer"
          >
            Clear filter ✕
          </button>
        </div>
      </Show>

      {/* ─────────────────────────────────────────────────────────────────────────
          5. Accordion List (Clean Cards, Left Icon, Down Chevron on Right)
      ────────────────────────────────────────────────────────────────────────── */}
      <div class="space-y-3 mb-12 sm:mb-16">
        <Show
          when={activeQuestions().length > 0}
          fallback={
            <div class="text-center py-10 rounded-xl bg-[#F6F3ED] border border-[#D8D3C9] p-6 text-xs sm:text-sm text-[#55616D]">
              <p class="font-medium text-[#1A1B1E] mb-1">No matching questions found</p>
              <p class="mb-4">Try searching for keywords like "recovery phrase", "DNS", "storage", or "pricing".</p>
              <button
                type="button"
                onClick={resetFilters}
                class="px-3.5 py-1.5 rounded-lg bg-[#800020] text-white text-xs font-semibold hover:bg-[#6A001A] transition cursor-pointer"
              >
                View all common questions
              </button>
            </div>
          }
        >
          <For each={activeQuestions()}>
            {(item) => {
              const isExpanded = () => expandedId() === item.id;
              const feedback = () => helpfulFeedback()[item.id];

              return (
                <div
                  class={`rounded-lg bg-[#F6F3ED] border transition-all duration-150 overflow-hidden ${
                    isExpanded()
                      ? "border-[#800020] shadow-xs"
                      : "border-[#D8D3C9] hover:border-[#800020]/50"
                  }`}
                >
                  {/* Accordion Header Row */}
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    aria-expanded={isExpanded()}
                    class="w-full px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between text-left cursor-pointer focus:outline-none"
                  >
                    <div class="flex items-center gap-3 sm:gap-4 pr-3">
                      {renderItemIcon(item.iconType)}
                      <span class="text-xs sm:text-sm font-semibold text-[#1A1B1E] tracking-tight">
                        {item.question}
                      </span>
                    </div>

                    <div
                      class={`shrink-0 w-5 h-5 flex items-center justify-center text-[#800020] transition-transform duration-200 ${
                        isExpanded() ? "rotate-180" : ""
                      }`}
                    >
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </button>

                  {/* Accordion Expandable Answer Body */}
                  <Show when={isExpanded()}>
                    <div class="px-4 sm:px-6 pb-5 pt-1 border-t border-[#EAE6DE] bg-[#FFFDFC] text-xs sm:text-sm text-[#18212A] leading-relaxed space-y-4">
                      {/* Lead Paragraph */}
                      <p class="font-medium text-[#1A1B1E] pt-2">{item.answer.lead}</p>

                      {/* Additional Paragraphs */}
                      <Show when={item.answer.paragraphs}>
                        <For each={item.answer.paragraphs}>
                          {(p) => <p class="text-[#555759]">{p}</p>}
                        </For>
                      </Show>

                      {/* Step-by-Step Instructions */}
                      <Show when={item.answer.steps}>
                        <ol class="space-y-2 pl-4 list-decimal marker:font-bold marker:text-[#800020] text-[#555759]">
                          <For each={item.answer.steps}>
                            {(step) => <li class="pl-1">{step}</li>}
                          </For>
                        </ol>
                      </Show>

                      {/* Clean Technical / Pricing Table */}
                      <Show when={item.answer.table}>
                        <div class="overflow-x-auto rounded-lg border border-[#D8D3C9] bg-[#F6F3ED]">
                          <table class="w-full text-left text-xs">
                            <thead class="bg-[#FAF7F2] border-b border-[#D8D3C9] text-[#1A1B1E] font-bold">
                              <tr>
                                <For each={item.answer.table!.headers}>
                                  {(h) => <th class="px-3.5 py-2">{h}</th>}
                                </For>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-[#D8D3C9]">
                              <For each={item.answer.table!.rows}>
                                {(row) => (
                                  <tr class="hover:bg-[#FAF9F6]">
                                    <For each={row}>
                                      {(cell, idx) => (
                                        <td
                                          class={`px-3.5 py-2 ${
                                            idx() === 0 ? "font-mono font-semibold text-[#800020]" : "text-[#555759]"
                                          }`}
                                        >
                                          {cell}
                                        </td>
                                      )}
                                    </For>
                                  </tr>
                                )}
                              </For>
                            </tbody>
                          </table>
                        </div>
                      </Show>

                      {/* Callout Notice */}
                      <Show when={item.answer.callout}>
                        <div
                          class={`p-3 rounded-lg text-xs flex items-start gap-2.5 ${
                            item.answer.callout!.type === "warning"
                              ? "bg-amber-50/80 border border-amber-200/80 text-amber-900"
                              : item.answer.callout!.type === "tip"
                              ? "bg-emerald-50/80 border border-emerald-200/80 text-emerald-900"
                              : "bg-[#F5F2EB] border border-[#DDD8CE] text-[#18212A]"
                          }`}
                        >
                          <svg class="w-4 h-4 shrink-0 mt-0.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          <span>{item.answer.callout!.text}</span>
                        </div>
                      </Show>

                      {/* Direct Control Panel Link */}
                      <Show when={item.answer.actionLink}>
                        <div class="pt-1">
                          <a
                            href={item.answer.actionLink!.href.replace("http://localhost:3000", cpUrl())}
                            target={item.answer.actionLink!.isExternal ? "_blank" : undefined}
                            rel={item.answer.actionLink!.isExternal ? "noreferrer" : undefined}
                            class="inline-flex items-center gap-1.5 text-xs font-bold text-[#800020] hover:underline"
                          >
                            {item.answer.actionLink!.label}
                          </a>
                        </div>
                      </Show>

                      {/* Was this answer helpful? */}
                      <div class="pt-3 border-t border-[#D8D3C9]/60 flex items-center justify-between text-xs text-[#878A8E]">
                        <span>Was this answer helpful?</span>
                        <div class="flex items-center gap-2">
                          <Show
                            when={feedback() === undefined}
                            fallback={
                              <span class="text-xs font-medium text-emerald-700">
                                ✓ Thanks for your feedback!
                              </span>
                            }
                          >
                            <button
                              type="button"
                              onClick={() => markHelpful(item.id, true)}
                              class="px-2.5 py-1 rounded border border-[#DDD8CE] hover:border-[#800020] hover:text-[#800020] transition text-[11px] font-medium cursor-pointer"
                            >
                              👍 Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => markHelpful(item.id, false)}
                              class="px-2.5 py-1 rounded border border-[#DDD8CE] hover:border-[#800020] hover:text-[#800020] transition text-[11px] font-medium cursor-pointer"
                            >
                              👎 No
                            </button>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────
          6. Direct Support Escalation Banner
      ────────────────────────────────────────────────────────────────────────── */}
      <div class="rounded-2xl border border-[#D8D3C9] bg-[#F6F3ED] p-6 sm:p-8 shadow-2xs">
        <div class="max-w-xl mb-6">
          <span class="text-[11px] font-mono font-bold uppercase tracking-wider text-[#800020]">
            Direct Support Channels
          </span>
          <h3 class="mt-1 text-lg sm:text-xl font-extrabold text-[#1A1B1E] tracking-tight">
            Still have questions or need technical assistance?
          </h3>
          <p class="mt-1 text-xs text-[#55616D] leading-relaxed">
            Our engineering and trust team provides dedicated support for custom storage setups, domain routing, and enterprise migrations.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          {/* Help Desk */}
          <div class="p-4 rounded-xl bg-[#FAF8F5] border border-[#D8D3C9] flex flex-col justify-between space-y-3 hover:border-[#800020]/40 transition">
            <div>
              <div class="w-7 h-7 rounded-lg bg-[#F5E6E8] text-[#800020] flex items-center justify-center mb-2">
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h4 class="font-bold text-xs sm:text-sm text-[#1A1B1E]">Customer Help Desk</h4>
              <p class="text-[11px] text-[#55616D] mt-1 leading-relaxed">
                Open a database-backed support ticket inside your Control Panel with live status tracking.
              </p>
            </div>
            <a
              href={`${cpUrl()}/dashboard/support`}
              class="inline-flex items-center gap-1 text-xs font-bold text-[#800020] hover:underline"
            >
              Open Help Desk Ticket &rarr;
            </a>
          </div>

          {/* Direct Email */}
          <div class="p-4 rounded-xl bg-[#FAF8F5] border border-[#D8D3C9] flex flex-col justify-between space-y-3 hover:border-[#800020]/40 transition">
            <div>
              <div class="w-7 h-7 rounded-lg bg-[#F5E6E8] text-[#800020] flex items-center justify-center mb-2">
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <h4 class="font-bold text-xs sm:text-sm text-[#1A1B1E]">Direct Email Support</h4>
              <p class="text-[11px] text-[#55616D] mt-1 leading-relaxed">
                Email our support team directly. Inbound replies are authenticated and synced with your tickets.
              </p>
            </div>
            <a
              href="mailto:support@byos.local"
              class="inline-flex items-center gap-1 text-xs font-bold text-[#800020] hover:underline"
            >
              support@byos.local &rarr;
            </a>
          </div>

          {/* Security Disclosure */}
          <div class="p-4 rounded-xl bg-[#FAF8F5] border border-[#D8D3C9] flex flex-col justify-between space-y-3 hover:border-[#800020]/40 transition">
            <div>
              <div class="w-7 h-7 rounded-lg bg-[#F5E6E8] text-[#800020] flex items-center justify-center mb-2">
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h4 class="font-bold text-xs sm:text-sm text-[#1A1B1E]">Security & Vulnerability</h4>
              <p class="text-[11px] text-[#55616D] mt-1 leading-relaxed">
                Report security concerns, abusive senders, or cryptographic findings to our Trust & Safety team.
              </p>
            </div>
            <a
              href="/security"
              class="inline-flex items-center gap-1 text-xs font-bold text-[#800020] hover:underline"
            >
              Security Policy &rarr;
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupportFaqHub;
