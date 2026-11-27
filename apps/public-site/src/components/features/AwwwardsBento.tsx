import { createSignal } from "solid-js";

const STORAGE_PROVIDERS = [
  { name: "Amazon S3", cost: "~$0.023 / GB", model: "Enterprise standard", region: "Global regions" },
  { name: "Cloudflare R2", cost: "~$0.015 / GB", model: "$0 egress fees", region: "Edge distributed" },
  { name: "Google Drive", cost: "Existing quota", model: "OAuth workspace", region: "Zero setup" },
  { name: "Backblaze B2", cost: "~$0.006 / GB", model: "Lowest archive cost", region: "S3-compatible" },
  { name: "Self-Hosted MinIO", cost: "Your hardware", model: "100% on-premise", region: "Private cloud" },
];

export function AwwwardsBento() {
  const [selectedStorage, setSelectedStorage] = createSignal(0);
  const [accountMode, setAccountMode] = createSignal<"org" | "private">("private");
  const [workspaceTab, setWorkspaceTab] = createSignal<"mail" | "calendar" | "notes">("mail");

  const storage = () => STORAGE_PROVIDERS[selectedStorage()];

  return (
    <div class="grid gap-5 lg:grid-cols-6">
      {/* 1. Interactive Storage Selector (spans 4) */}
      <div class="lg:col-span-4 card-editorial card-spotlight card-hover-elevate p-7 sm:p-9 flex flex-col justify-between">
        <div>
          <div class="flex items-center justify-between gap-4">
            <h3 class="font-display text-2xl font-bold text-[#18212A]">Storage, your choice</h3>
            <span class="rounded-full border border-[#226192]/30 bg-[#E2E7EB] px-3 py-1 font-mono text-[11px] font-semibold text-[#226192]">
              0% markup
            </span>
          </div>
          <p class="mt-3 max-w-xl text-sm text-[#55616D] leading-relaxed">
            Click a provider to inspect how BYOS connects without locking your archive inside our servers.
          </p>

          <div class="mt-6 flex flex-wrap gap-2">
            {STORAGE_PROVIDERS.map((p, i) => (
              <button
                type="button"
                onClick={() => setSelectedStorage(i)}
                class={`rounded-xl border px-3.5 py-2 font-mono text-xs transition-all cursor-pointer ${
                  selectedStorage() === i
                    ? "bg-[#226192] text-[#EAE6DE] border-[#226192] shadow-xs"
                    : "bg-[#EAE6DE]/60 text-[#18212A] border-[#D8D3C9] hover:border-[#226192]/50"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div class="mt-6 grid grid-cols-3 gap-3 rounded-2xl border border-[#D8D3C9] bg-[#EAE6DE]/50 p-4 font-mono text-xs">
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[#55616D]">Provider Rate</div>
            <div class="mt-1 font-bold text-[#18212A]">{storage().cost}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[#55616D]">Advantage</div>
            <div class="mt-1 font-bold text-[#226192]">{storage().model}</div>
          </div>
          <div>
            <div class="text-[10px] uppercase tracking-wider text-[#55616D]">Deployment</div>
            <div class="mt-1 font-bold text-[#18212A]">{storage().region}</div>
          </div>
        </div>
      </div>

      {/* 2. Interactive Account Mode Toggle (spans 2) */}
      <div class="lg:col-span-2 card-editorial card-spotlight card-hover-elevate p-7 sm:p-8 flex flex-col justify-between">
        <div>
          <h3 class="font-display text-xl font-bold text-[#18212A]">Two account modes</h3>
          <div class="mt-4 inline-flex rounded-xl border border-[#D8D3C9] bg-[#EAE6DE]/70 p-1">
            <button
              type="button"
              onClick={() => setAccountMode("private")}
              class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                accountMode() === "private"
                  ? "bg-[#226192] text-[#EAE6DE]"
                  : "text-[#55616D] hover:text-[#18212A]"
              }`}
            >
              Private
            </button>
            <button
              type="button"
              onClick={() => setAccountMode("org")}
              class={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                accountMode() === "org"
                  ? "bg-[#226192] text-[#EAE6DE]"
                  : "text-[#55616D] hover:text-[#18212A]"
              }`}
            >
              Org-Managed
            </button>
          </div>
          <p class="mt-4 text-sm text-[#55616D] leading-relaxed">
            {accountMode() === "private"
              ? "Stronger separation from admin access. Only the mailbox holder holds decryption keys."
              : "Designed for business continuity and compliance with delegated recovery."}
          </p>
        </div>
        <div class="mt-5 pt-3 border-t border-[#D8D3C9] font-mono text-[11px] text-[#226192]">
          Set independently per mailbox
        </div>
      </div>

      {/* 3. Full Encrypted Workspace Preview (spans 3) */}
      <div class="lg:col-span-3 card-editorial card-spotlight card-hover-elevate p-7 sm:p-8">
        <div class="flex items-center justify-between gap-3">
          <h3 class="font-display text-xl font-bold text-[#18212A]">A full workspace</h3>
          <div class="inline-flex gap-1 rounded-lg border border-[#D8D3C9] bg-[#EAE6DE]/70 p-1">
            {(["mail", "calendar", "notes"] as const).map((tab) => (
              <button
                type="button"
                onClick={() => setWorkspaceTab(tab)}
                class={`px-2.5 py-1 rounded-md font-mono text-[11px] capitalize transition-colors cursor-pointer ${
                  workspaceTab() === tab
                    ? "bg-[#EF8557] text-[#0B131B] font-bold"
                    : "text-[#55616D] hover:text-[#18212A]"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        <div class="mt-4 rounded-xl border border-[#D8D3C9] bg-[#EAE6DE]/50 p-4 font-mono text-xs text-[#18212A]">
          {workspaceTab() === "mail" && (
            <div class="space-y-1.5">
              <div class="flex justify-between">
                <span class="font-bold">Encrypted Inbox &amp; Rules</span>
                <span class="text-[#226192]">WASM Sealed</span>
              </div>
              <p class="text-[#55616D]">Folders, labels, scheduled send, signatures, and sandboxed HTML reading.</p>
            </div>
          )}
          {workspaceTab() === "calendar" && (
            <div class="space-y-1.5">
              <div class="flex justify-between">
                <span class="font-bold">Private Calendar &amp; CalDAV</span>
                <span class="text-[#226192]">Zero-Knowledge</span>
              </div>
              <p class="text-[#55616D]">Day/week/month views, encrypted event payloads, and feed sync.</p>
            </div>
          )}
          {workspaceTab() === "notes" && (
            <div class="space-y-1.5">
              <div class="flex justify-between">
                <span class="font-bold">Encrypted Notes</span>
                <span class="text-[#226192]">Client-Side</span>
              </div>
              <p class="text-[#55616D]">Labeled workspace notes stored alongside your sealed mail vault.</p>
            </div>
          )}
        </div>
      </div>

      {/* 4. Compatibility & Exit (spans 3) */}
      <div class="lg:col-span-3 card-editorial card-spotlight card-hover-elevate p-7 sm:p-8 flex flex-col justify-between">
        <div>
          <h3 class="font-display text-xl font-bold text-[#18212A]">Works with your client. Own your exit.</h3>
          <p class="mt-3 text-sm text-[#55616D] leading-relaxed">
            Use our webmail or connect Outlook, Apple Mail, and Thunderbird. Because your sealed archive already sits in your own bucket, you're never locked in.
          </p>
        </div>
        <div class="mt-5 flex flex-wrap gap-2">
          {["Apple Mail", "Outlook", "Thunderbird", "Built-in Webmail"].map((c) => (
            <span class="rounded-full border border-[#D8D3C9] bg-[#EAE6DE]/60 px-3 py-1 text-xs font-medium text-[#18212A]">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
