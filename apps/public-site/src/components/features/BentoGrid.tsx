import { createSignal } from "solid-js";

export function BentoGrid() {
  // Cell 1: Provider selection & ping
  const [selectedProvider, setSelectedProvider] = createSignal<"r2" | "s3" | "gdrive">("r2");

  // Cell 4: Dual privacy mode toggle
  const [privacyMode, setPrivacyMode] = createSignal<"org" | "private">("org");

  const providers = {
    r2: {
      name: "Cloudflare R2",
      ping: "8ms",
      status: "Operational",
      egress: "$0.00 / GB (Free)",
      api: "S3-Compatible REST",
      badge: "Zero Egress Fees",
    },
    s3: {
      name: "Amazon Web Services (S3)",
      ping: "14ms",
      status: "Operational",
      egress: "Standard AWS Tier",
      api: "Native S3 API (SigV4)",
      badge: "Enterprise Standard",
    },
    gdrive: {
      name: "Google Drive / MinIO",
      ping: "11ms",
      status: "Operational",
      egress: "Direct API Egress",
      api: "S3 / Object REST",
      badge: "Self-Hosted / Workspace",
    },
  };

  return (
    <section id="features" class="py-20 px-6 max-w-7xl mx-auto scroll-mt-20">
      {/* Section Header */}
      <div class="text-center max-w-3xl mx-auto mb-14">
        <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
          High-Impact Architecture
        </span>
        <h2 class="text-3xl sm:text-5xl font-extrabold text-[#2B2C2D] mt-2 tracking-tight">
          Engineered for Sovereignty. <br class="hidden sm:inline" />
          <span class="text-[#9E725F]">Zero Sacrifices.</span>
        </h2>
        <p class="text-sm sm:text-base text-[#6F7173] mt-3">
          Everything modern organizations demand from high-volume email workflows, without handing custody to centralized cloud monopolies.
        </p>
      </div>

      {/* 4-Cell Bento Grid */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
        
        {/* Cell 1: Bring Your Own Storage (7 cols on lg) */}
        <div class="lg:col-span-7 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
                Storage Custody
              </span>
              <div class="flex items-center gap-2 text-xs font-mono text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>Live Latency: {providers[selectedProvider()].ping}</span>
              </div>
            </div>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D]">
              Bring Your Own Storage.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              <strong class="text-[#3C3D3E]">"Your Cloud, Your Rules."</strong> Mail is never locked into proprietary vendor silos. Store encrypted message objects directly in your own enterprise cloud bucket.
            </p>

            {/* Interactive Provider Switcher */}
            <div class="grid grid-cols-3 gap-2 mt-6">
              {(["r2", "s3", "gdrive"] as const).map((prov) => (
                <button
                  onClick={() => setSelectedProvider(prov)}
                  class={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                    selectedProvider() === prov
                      ? "border-[#9E725F] bg-[#F3ECE8]/50 shadow-2xs ring-1 ring-[#9E725F]/30"
                      : "border-[#E2DFD8] bg-[#FBFBFA] hover:border-[#9E725F]/40"
                  }`}
                >
                  <div class="text-xs font-bold text-[#3C3D3E] truncate">
                    {prov === "r2" ? "Cloudflare R2" : prov === "s3" ? "Amazon S3" : "Google / MinIO"}
                  </div>
                  <div class="text-[10px] font-mono text-[#9E725F] mt-1 flex items-center gap-1">
                    <span class="h-1 w-1 rounded-full bg-emerald-500"></span>
                    {providers[prov].ping}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Provider Detail Box */}
          <div class="mt-6 p-4 rounded-2xl bg-[#FBFBFA] border border-[#E2DFD8] font-mono text-xs text-[#3C3D3E] space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-[#6F7173]">Active Target:</span>
              <span class="font-bold text-[#9E725F]">{providers[selectedProvider()].name}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#6F7173]">Egress Cost:</span>
              <span class="text-emerald-700 font-semibold">{providers[selectedProvider()].egress}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#6F7173]">Storage Interface:</span>
              <span>{providers[selectedProvider()].api}</span>
            </div>
          </div>
        </div>

        {/* Cell 2: Device-Bound Privacy (5 cols on lg) */}
        <div class="lg:col-span-5 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
              Zero Plaintext
            </span>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D] mt-4">
              Device-Bound Privacy.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              <strong class="text-[#3C3D3E]">"Zero-Plaintext Escrow."</strong> Not even BYOS engineers can read your mail. Secret keys are derived in browser memory and unsealed strictly on your device.
            </p>
          </div>

          {/* Graphical Key Derivation Visual */}
          <div class="my-6 p-4 rounded-2xl bg-[#2B2C2D] border border-stone-800 text-stone-300 font-mono text-xs space-y-3">
            <div class="flex items-center justify-between text-[10px] text-stone-400 border-b border-stone-700 pb-2">
              <span>WASM CRYPTO ENGINE</span>
              <span class="text-emerald-400">IN-MEMORY ONLY</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[#9E725F] font-bold">1. BIP-39</span>
              <span class="text-stone-400">&rarr;</span>
              <span class="text-stone-200 truncate">24-word Sovereign Mnemonic</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[#9E725F] font-bold">2. Ed25519</span>
              <span class="text-stone-400">&rarr;</span>
              <span class="text-emerald-400 truncate">0x9f18a2... Keypair Derived</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[#9E725F] font-bold">3. Argon2id</span>
              <span class="text-stone-400">&rarr;</span>
              <span class="text-stone-300 truncate">AES-256-GCM Envelope Sealed</span>
            </div>
          </div>

          <div class="text-[11px] font-mono text-[#6F7173] flex items-center gap-2">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>Unsealed private keys never touch network packets.</span>
          </div>
        </div>

        {/* Cell 3: Seamless Client Bridge (5 cols on lg) */}
        <div class="lg:col-span-5 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
                Desktop &amp; Mobile
              </span>
              <div class="flex items-center gap-1.5 text-xs text-[#6F7173]">
                <span class="px-2 py-0.5 rounded bg-[#F8F7F4] border border-[#E2DFD8]">macOS</span>
                <span class="px-2 py-0.5 rounded bg-[#F8F7F4] border border-[#E2DFD8]">Windows</span>
                <span class="px-2 py-0.5 rounded bg-[#F8F7F4] border border-[#E2DFD8]">Linux</span>
              </div>
            </div>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D]">
              Seamless Client Bridge.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              <strong class="text-[#3C3D3E]">"Keep Your Favorite Apps."</strong> Connect Outlook, Apple Mail, or Thunderbird with zero configuration headaches via local loopback proxy.
            </p>
          </div>

          {/* Monospace Terminal Window */}
          <div class="my-6 rounded-2xl bg-[#2B2C2D] border border-stone-800 p-4 font-mono text-xs text-stone-300 space-y-2">
            <div class="flex items-center justify-between text-[10px] text-stone-400 border-b border-stone-700 pb-2">
              <div class="flex items-center gap-1.5">
                <span class="h-2.5 w-2.5 rounded-full bg-rose-500/80"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-amber-500/80"></span>
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500/80"></span>
                <span class="ml-2">byos-bridge.sh</span>
              </div>
              <span class="text-emerald-400">ACTIVE</span>
            </div>
            <div class="text-stone-400 text-[11px]">$ byos-bridge --daemon --listen 127.0.0.1:1143</div>
            <div class="text-emerald-400 text-[11px]">[OK] IMAP proxy listening on 127.0.0.1:1143 (STARTTLS)</div>
            <div class="text-emerald-400 text-[11px]">[OK] SMTP proxy listening on 127.0.0.1:1025 (STARTTLS)</div>
            <div class="text-stone-300 text-[11px]">[OK] Enclave key loaded from macOS Keychain</div>
          </div>

          <div class="flex items-center gap-3 text-xs text-[#6F7173]">
            <span class="font-bold text-[#3C3D3E]">Native Support:</span>
            <span>Apple Mail</span> &bull; <span>Outlook</span> &bull; <span>Thunderbird</span>
          </div>
        </div>

        {/* Cell 4: Dual Privacy Modes (7 cols on lg) */}
        <div class="lg:col-span-7 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
                Governance &amp; Privacy
              </span>

              {/* Mode Toggle Controls */}
              <div class="inline-flex rounded-xl bg-[#F8F7F4] border border-[#E2DFD8] p-1">
                <button
                  onClick={() => setPrivacyMode("org")}
                  class={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    privacyMode() === "org"
                      ? "bg-[#9E725F] text-white shadow-2xs"
                      : "text-[#6F7173] hover:text-[#3C3D3E]"
                  }`}
                >
                  Org-Managed
                </button>
                <button
                  onClick={() => setPrivacyMode("private")}
                  class={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    privacyMode() === "private"
                      ? "bg-[#9E725F] text-white shadow-2xs"
                      : "text-[#6F7173] hover:text-[#3C3D3E]"
                  }`}
                >
                  Strict Private
                </button>
              </div>
            </div>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D]">
              Dual Privacy Modes.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              <strong class="text-[#3C3D3E]">"Corporate Control Meets Sovereign Privacy."</strong> Run organization-managed mailboxes with business recovery, or strict zero-knowledge private accounts that even organization owners cannot inspect.
            </p>
          </div>

          {/* Interactive Card Showing Selected Privacy Mode */}
          <div class="my-6 p-5 rounded-2xl bg-[#FBFBFA] border border-[#E2DFD8] transition-all">
            {privacyMode() === "org" ? (
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-base">🏢</span>
                    <span class="font-bold text-sm text-[#3C3D3E]">Organization-Managed Mailbox</span>
                  </div>
                  <span class="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    Dual-Wrapped Key
                  </span>
                </div>
                <p class="text-xs text-[#6F7173]">
                  Decryption key is wrapped under user credentials AND the organization's recovery key. Ideal for general staff, operational compliance, and business continuity.
                </p>
                <div class="pt-2 flex items-center gap-4 text-[11px] font-mono text-[#6F7173]">
                  <span>Recovery Escrow: <strong class="text-emerald-700">Supported</strong></span>
                  <span>Impersonation: <strong class="text-rose-700">Audit-Logged</strong></span>
                </div>
              </div>
            ) : (
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-base">🛡️</span>
                    <span class="font-bold text-sm text-[#3C3D3E]">Strict Private Mailbox (Zero-Escrow)</span>
                  </div>
                  <span class="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    Single-Wrapped Key
                  </span>
                </div>
                <p class="text-xs text-[#6F7173]">
                  Decryption key is wrapped ONLY with the user's password. The organization recovery public key is excluded. Administrators cannot read messages under any circumstances.
                </p>
                <div class="pt-2 flex items-center gap-4 text-[11px] font-mono text-[#6F7173]">
                  <span>Admin Access: <strong class="text-rose-700">Forbidden (403)</strong></span>
                  <span>Escrow: <strong class="text-stone-700">None (Zero-Knowledge)</strong></span>
                </div>
              </div>
            )}
          </div>

          <div class="text-[11px] font-mono text-[#6F7173] flex items-center gap-2">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>Cryptographically isolated per mailbox. Never shared database sessions.</span>
          </div>
        </div>

      </div>
    </section>
  );
}
