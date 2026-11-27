import { createSignal } from "solid-js";

const THREADS = [
  {
    id: 0,
    sender: "Elena Rostova",
    email: "elena@sequoia-partner.vc",
    subject: "Series A Term Sheet — Final Redline",
    time: "10:42 AM",
    msgId: "<0193a8f2-7c91@sequoia-partner.vc>",
    bucketKey: "s3://acme-vault/mbx_01/2026/11/msg_00891.env",
    kem: "X-Wing-Draft02-AES256GCM",
    body: "Mushfiqul,\n\nWe've accepted the governance terms and board observer clause. Because your mail vault runs on your own Cloudflare R2 bucket with client-side WASM sealing, our security diligence cleared in 24 hours.\n\nReady for signature whenever you are.",
    attachments: ["Series_A_Term_Sheet_vFinal.pdf.env (412 KB · AES-256-GCM)"],
  },
  {
    id: 1,
    sender: "Marcus Vance",
    email: "vance@audit-group.io",
    subject: "Cryptographic Boundary Audit Report",
    time: "Yesterday",
    msgId: "<0193a4d0-11b8@audit-group.io>",
    bucketKey: "s3://acme-vault/mbx_01/2026/11/msg_00890.env",
    kem: "X-Wing-Draft02-AES256GCM",
    body: "Team,\n\nConfirmed that canonical AAD binds mailbox_id (16B), message_seq (8B BE), and encryption_version (4B BE). Zero plaintext bodies or search terms were observed in PostgreSQL or Redis during inbound delivery.",
    attachments: ["BYOS_PenTest_Summary_2026.pdf.env (1.2 MB · AES-256-GCM)"],
  },
  {
    id: 2,
    sender: "Infrastructure Monitor",
    email: "alerts@company.com",
    subject: "Storage Bucket Sync & DKIM Status",
    time: "Nov 12",
    msgId: "<01939f12-90e1@company.com>",
    bucketKey: "s3://acme-vault/mbx_01/2026/11/msg_00889.env",
    kem: "HPKE-X25519-AES256GCM",
    body: "All 24 organization mailboxes are actively writing sealed envelopes to Cloudflare R2 (region: WNAM). Monthly raw storage bill across 84 GB: $1.26 ($0.00 BYOS markup).",
    attachments: [],
  },
];

export function WorkspaceStage() {
  const [moduleTab, setModuleTab] = createSignal<"mail" | "calendar" | "notes">("mail");
  const [selectedThread, setSelectedThread] = createSignal(0);
  const [mailboxMode, setMailboxMode] = createSignal<"private" | "org">("private");
  const [inspectRaw, setInspectRaw] = createSignal(false);

  const thread = () => THREADS[selectedThread()];

  return (
    <div class="border border-[#D8D3C9] bg-[#F6F3ED] shadow-sm">
      {/* Top Window Chrome & Module Switcher */}
      <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#D8D3C9] bg-[#EAE6DE] px-5 py-3.5">
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-1.5">
            <span class="h-2.5 w-2.5 rounded-full bg-[#18212A]/25" />
            <span class="h-2.5 w-2.5 rounded-full bg-[#18212A]/25" />
            <span class="h-2.5 w-2.5 rounded-full bg-[#EF8557]" />
          </div>
          <span class="font-mono text-xs font-bold text-[#18212A]">
            apps/webmail — SolidJS + Rust WASM Client
          </span>
        </div>

        {/* Morphing Module Pill */}
        <div class="inline-flex border border-[#D8D3C9] bg-[#F6F3ED] p-1">
          {(["mail", "calendar", "notes"] as const).map((tab) => (
            <button
              type="button"
              onClick={() => setModuleTab(tab)}
              class={`px-3.5 py-1 font-mono text-xs uppercase tracking-wider transition-colors cursor-pointer ${
                moduleTab() === tab
                  ? "bg-[#226192] text-[#EAE6DE] font-bold"
                  : "text-[#55616D] hover:text-[#18212A]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Per-Mailbox Governance Mode */}
        <div class="flex items-center gap-2 font-mono text-xs">
          <span class="text-[#55616D] hidden sm:inline">MAILBOX MODE:</span>
          <button
            type="button"
            onClick={() => setMailboxMode(mailboxMode() === "private" ? "org" : "private")}
            class="border border-[#226192] bg-[#226192]/10 px-3 py-1 font-bold text-[#226192] hover:bg-[#226192] hover:text-[#EAE6DE] transition-colors cursor-pointer"
          >
            {mailboxMode() === "private" ? "PRIVATE (ZERO ADMIN ESCROW)" : "ORG-MANAGED (CONTINUITY)"}
          </button>
        </div>
      </div>

      {/* Main Interactive Stage */}
      {moduleTab() === "mail" && (
        <div class="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#D8D3C9] min-h-[420px]">
          {/* Left Col (4): Thread List */}
          <div class="lg:col-span-4 divide-y divide-[#D8D3C9] bg-[#EAE6DE]/40">
            {THREADS.map((t, idx) => (
              <button
                type="button"
                onClick={() => setSelectedThread(idx)}
                class={`w-full text-left p-5 transition-colors cursor-pointer ${
                  selectedThread() === idx
                    ? "bg-[#F6F3ED] border-l-4 border-l-[#226192]"
                    : "hover:bg-[#F6F3ED]/60"
                }`}
              >
                <div class="flex items-center justify-between font-mono text-[11px] text-[#55616D]">
                  <span class="font-bold text-[#18212A]">{t.sender}</span>
                  <span>{t.time}</span>
                </div>
                <div class="mt-1.5 font-display text-sm font-bold text-[#18212A] truncate">
                  {t.subject}
                </div>
                <div class="mt-2 font-mono text-[10px] text-[#226192] truncate">
                  {t.bucketKey}
                </div>
              </button>
            ))}
          </div>

          {/* Right Col (8): Sandboxed Reading Pane + Bucket Header Inspector */}
          <div class="lg:col-span-8 p-6 sm:p-8 flex flex-col justify-between bg-[#F6F3ED]">
            <div>
              <div class="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-[#D8D3C9]">
                <div>
                  <h3 class="font-display text-xl sm:text-2xl font-bold text-[#18212A]">
                    {thread().subject}
                  </h3>
                  <div class="mt-1 font-mono text-xs text-[#55616D]">
                    From: <strong class="text-[#18212A]">{thread().email}</strong> · {thread().msgId}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setInspectRaw(!inspectRaw())}
                  class={`px-3 py-1.5 font-mono text-xs border cursor-pointer transition-colors ${
                    inspectRaw()
                      ? "bg-[#0B131B] text-[#EF8557] border-[#0B131B]"
                      : "bg-[#EAE6DE] text-[#18212A] border-[#D8D3C9] hover:border-[#226192]"
                  }`}
                >
                  {inspectRaw() ? "Show Decrypted View" : "Inspect Server vs. Bucket View"}
                </button>
              </div>

              {inspectRaw() ? (
                <div class="mt-6 bg-[#0B131B] text-[#EAE6DE] p-5 font-mono text-xs space-y-2 border border-[#18212A]">
                  <div class="text-[#EF8557] font-bold">
                    {"// WHAT BYOS POSTGRES SEES (THREADING HEADERS ONLY):"}
                  </div>
                  <div>Message-ID: {thread().msgId}</div>
                  <div>Subject: [REDACTED — SEALED IN BUCKET]</div>
                  <div class="pt-3 text-[#226192] font-bold">
                    {"// WHAT YOUR CLOUD BUCKET STORES:"}
                  </div>
                  <div>URI: {thread().bucketKey}</div>
                  <div>Suite: {thread().kem}</div>
                </div>
              ) : (
                <div class="mt-6">
                  <p class="whitespace-pre-line text-sm sm:text-base text-[#18212A] leading-relaxed">
                    {thread().body}
                  </p>
                  {thread().attachments.length > 0 && (
                    <div class="mt-6 pt-4 border-t border-[#D8D3C9] flex flex-wrap gap-2">
                      {thread().attachments.map((att) => (
                        <span class="inline-flex items-center gap-2 border border-[#D8D3C9] bg-[#EAE6DE] px-3 py-1.5 font-mono text-xs text-[#18212A]">
                          <span class="h-2 w-2 rounded-full bg-[#226192]" />
                          {att}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div class="mt-8 pt-4 border-t border-[#D8D3C9] flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-[#55616D]">
              <span>SANDBOX: &lt;iframe sandbox&gt; ISOLATED</span>
              <span class="text-[#226192] font-semibold">OBJECT: {thread().bucketKey}</span>
            </div>
          </div>
        </div>
      )}

      {moduleTab() === "calendar" && (
        <div class="p-8 sm:p-10 min-h-[420px] flex flex-col justify-between">
          <div>
            <span class="eyebrow">Encrypted Calendar &amp; CalDAV</span>
            <h3 class="mt-2 font-display text-2xl font-bold text-[#18212A]">
              Zero-knowledge scheduling across Day, Week, and Month views.
            </h3>
            <p class="mt-2 text-sm text-[#55616D] max-w-2xl">
              Event titles, attendees, and meeting notes are sealed client-side before storage, with SSRF-hardened external ICS feed proxying.
            </p>

            <div class="mt-8 grid grid-cols-1 md:grid-cols-3 border border-[#D8D3C9] divide-y md:divide-y-0 md:divide-x divide-[#D8D3C9] bg-[#EAE6DE]/40 font-mono text-xs">
              <div class="p-5">
                <div class="text-[#226192] font-bold">MON NOV 16 · 09:30</div>
                <div class="mt-2 font-display text-base font-bold text-[#18212A]">Q4 Board Prep &amp; Key Ceremony</div>
                <div class="mt-1 text-[#55616D]">Sealed in R2 · 4 participants</div>
              </div>
              <div class="p-5">
                <div class="text-[#EF8557] font-bold">TUE NOV 17 · 14:00</div>
                <div class="mt-2 font-display text-base font-bold text-[#18212A]">Security Architecture Review</div>
                <div class="mt-1 text-[#55616D]">CalDAV Sync Active · End-to-End Sealed</div>
              </div>
              <div class="p-5">
                <div class="text-[#226192] font-bold">THU NOV 19 · 11:00</div>
                <div class="mt-2 font-display text-base font-bold text-[#18212A]">Domain Migration Cutover</div>
                <div class="mt-1 text-[#55616D]">Zero-Downtime MX Verification</div>
              </div>
            </div>
          </div>

          <div class="mt-8 pt-4 border-t border-[#D8D3C9] font-mono text-xs text-[#55616D]">
            PROTOCOL: CALDAV + CLIENT-SIDE CALENDAR RECOVERY
          </div>
        </div>
      )}

      {moduleTab() === "notes" && (
        <div class="p-8 sm:p-10 min-h-[420px] flex flex-col justify-between">
          <div>
            <span class="eyebrow">Sovereign Notes Vault</span>
            <h3 class="mt-2 font-display text-2xl font-bold text-[#18212A]">
              Encrypted executive notes stored in your same cloud bucket.
            </h3>
            <p class="mt-2 text-sm text-[#55616D] max-w-2xl">
              Organize sensitive recovery procedures, board memos, and credentials with client-side label discovery—never exposed in plaintext on our servers.
            </p>

            <div class="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="border border-[#D8D3C9] bg-[#EAE6DE]/50 p-5">
                <div class="flex justify-between font-mono text-[11px]">
                  <span class="text-[#226192] font-bold">#INFRASTRUCTURE</span>
                  <span class="text-[#55616D]">SEALED NOTE</span>
                </div>
                <div class="mt-2 font-display text-base font-bold text-[#18212A]">
                  S3 Bucket IAM Policy (Least-Privilege)
                </div>
                <p class="mt-1 text-xs text-[#55616D]">
                  Scoped PutObject / GetObject / DeleteObject credentials bound to prefix s3://acme-vault/byos/*
                </p>
              </div>
              <div class="border border-[#D8D3C9] bg-[#EAE6DE]/50 p-5">
                <div class="flex justify-between font-mono text-[11px]">
                  <span class="text-[#EF8557] font-bold">#GOVERNANCE</span>
                  <span class="text-[#55616D]">SEALED NOTE</span>
                </div>
                <div class="mt-2 font-display text-base font-bold text-[#18212A]">
                  Executive Mailbox Offboarding Runbook
                </div>
                <p class="mt-1 text-xs text-[#55616D]">
                  Instant session revocation + root rotation instructions for org-managed accounts.
                </p>
              </div>
            </div>
          </div>

          <div class="mt-8 pt-4 border-t border-[#D8D3C9] font-mono text-xs text-[#55616D]">
            STORAGE: UNIFIED CRYPTOENVELOPE V1 OBJECTS
          </div>
        </div>
      )}
    </div>
  );
}
