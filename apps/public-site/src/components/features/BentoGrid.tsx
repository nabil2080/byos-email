import { createSignal } from "solid-js";

export function BentoGrid() {
  // Cell 1: Storage Provider selection
  const [selectedStorage, setSelectedStorage] = createSignal<"r2" | "s3" | "gdrive">("r2");

  // Cell 2: Device-level lock preview
  const [isUnlocked, setIsUnlocked] = createSignal(true);

  // Cell 4: Team permission role toggle
  const [teamRole, setTeamRole] = createSignal<"team" | "confidential">("team");

  const storageOptions = {
    r2: {
      name: "Cloudflare R2",
      cost: "$0.015 / GB",
      egress: "Free ($0 egress fees)",
      speed: "Fast (8ms)",
      desc: "Lowest overall cost for growing companies. No unexpected bandwidth bills.",
    },
    s3: {
      name: "Amazon AWS S3",
      cost: "~$0.023 / GB",
      egress: "Standard AWS tier",
      speed: "Ultra-Reliable (14ms)",
      desc: "The enterprise standard. Works with standard buckets, S3-IA, and Glacier archives.",
    },
    gdrive: {
      name: "Google Drive / MinIO",
      cost: "Your Existing Plan",
      egress: "Direct Google API",
      speed: "Fast (11ms)",
      desc: "Connect your existing Google Workspace or self-hosted MinIO storage server.",
    },
  };

  return (
    <section id="features" class="py-20 px-6 max-w-7xl mx-auto scroll-mt-20">
      {/* Section Header */}
      <div class="text-center max-w-3xl mx-auto mb-14">
        <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
          Simple, Fast, and Completely Yours
        </span>
        <h2 class="text-3xl sm:text-5xl font-extrabold text-[#2B2C2D] mt-2 tracking-tight">
          Everything You Need. <br class="hidden sm:inline" />
          <span class="text-[#9E725F]">Zero Sacrifices.</span>
        </h2>
        <p class="text-sm sm:text-base text-[#6F7173] mt-3">
          Modern business email without complex setup, high fees, or vendor lock-in.
        </p>
      </div>

      {/* 4-Cell Bento Grid */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-6">
        
        {/* Cell 1: Your Cloud Storage (7 cols on lg) */}
        <div class="lg:col-span-7 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
                Cloud Freedom
              </span>
              <div class="flex items-center gap-2 text-xs font-mono text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                <span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>0% Storage Markup</span>
              </div>
            </div>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D]">
              Store Emails in Your Own Cloud.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              Connect Cloudflare R2, Amazon S3, or Google Drive in seconds. You pay the raw cloud rates directly to your provider — we never mark up storage or penalize you for growing your team.
            </p>

            {/* Storage Provider Selector */}
            <div class="grid grid-cols-3 gap-2 mt-6">
              {(["r2", "s3", "gdrive"] as const).map((prov) => (
                <button
                  type="button"
                  onClick={() => setSelectedStorage(prov)}
                  class={`p-3 rounded-xl text-left border transition-all cursor-pointer ${
                    selectedStorage() === prov
                      ? "border-[#9E725F] bg-[#F3ECE8]/60 ring-1 ring-[#9E725F]/30"
                      : "border-[#E2DFD8] bg-[#FBFBFA] hover:border-[#9E725F]/40"
                  }`}
                >
                  <div class="text-xs font-bold text-[#3C3D3E] truncate">
                    {prov === "r2" ? "Cloudflare R2" : prov === "s3" ? "Amazon S3" : "Google Drive"}
                  </div>
                  <div class="text-[10px] font-mono text-[#9E725F] mt-1 flex items-center gap-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    <span>{storageOptions[prov].speed}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Provider Detail Box */}
          <div class="mt-6 p-4 rounded-2xl bg-[#FBFBFA] border border-[#E2DFD8] text-xs text-[#3C3D3E] space-y-2.5">
            <div class="flex items-center justify-between">
              <span class="text-[#6F7173]">Selected Cloud:</span>
              <span class="font-bold text-[#9E725F]">{storageOptions[selectedStorage()].name}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#6F7173]">Direct Cloud Cost:</span>
              <span class="text-emerald-700 font-bold">{storageOptions[selectedStorage()].cost}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#6F7173]">Data Transfer:</span>
              <span class="font-medium text-[#2B2C2D]">{storageOptions[selectedStorage()].egress}</span>
            </div>
            <div class="pt-2 border-t border-[#E2DFD8] text-[11px] text-[#6F7173]">
              {storageOptions[selectedStorage()].desc}
            </div>
          </div>
        </div>

        {/* Cell 2: True Privacy (5 cols on lg) */}
        <div class="lg:col-span-5 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
                True Privacy
              </span>
              <button
                type="button"
                onClick={() => setIsUnlocked(!isUnlocked())}
                class="text-[11px] font-medium text-[#9E725F] hover:text-[#865E4D] underline cursor-pointer"
              >
                {isUnlocked() ? "Simulate Server View" : "Simulate Your Device"}
              </button>
            </div>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D]">
              Private by Default.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              Your emails are locked on your device before they ever leave. Not even our servers or engineers can read them. Only you and your team hold the key.
            </p>
          </div>

          {/* Interactive Privacy State Visual */}
          <div class="my-6 p-4 rounded-2xl bg-[#2B2C2D] border border-stone-800 text-stone-300 text-xs space-y-3">
            <div class="flex items-center justify-between text-[10px] text-stone-400 border-b border-stone-700 pb-2">
              <span class="font-mono">MESSAGE PREVIEW</span>
              <span class={`font-bold px-2 py-0.5 rounded ${isUnlocked() ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-amber-950 text-amber-300 border border-amber-800"}`}>
                {isUnlocked() ? "ON YOUR DEVICE" : "ON THE SERVER"}
              </span>
            </div>

            {isUnlocked() ? (
              <div class="space-y-1.5 font-sans">
                <div class="text-stone-400 text-[11px]">Subject: <span class="text-white font-medium">Q3 Product Roadmap &amp; Hiring</span></div>
                <div class="text-stone-300 text-xs leading-relaxed bg-stone-800/60 p-2.5 rounded-xl border border-stone-700">
                  &quot;Hi Team, attached is our approved annual budget and hiring plan. All data is stored in our private cloud.&quot;
                </div>
                <div class="text-[10px] text-emerald-400 font-mono pt-1 flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>Unlocked securely on your screen</span>
                </div>
              </div>
            ) : (
              <div class="space-y-1.5 font-mono">
                <div class="text-stone-400 text-[11px]">Subject: <span class="text-stone-400">Locked &amp; Scrambled</span></div>
                <div class="text-amber-200/80 text-[11px] leading-relaxed bg-stone-900/80 p-2.5 rounded-xl border border-stone-700 truncate font-mono">
                  0x9f18a28e3b1c70...d4e8b9 [Encrypted Data]
                </div>
                <div class="text-[10px] text-amber-300 font-mono pt-1 flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  <span>Server sees only scrambled bits</span>
                </div>
              </div>
            )}
          </div>

          <div class="text-[11px] font-medium text-[#6F7173] flex items-center gap-2">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>Your private keys never leave your phone or computer.</span>
          </div>
        </div>

        {/* Cell 3: Keep Your Favorite Apps (5 cols on lg) */}
        <div class="lg:col-span-5 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
                Works Everywhere
              </span>
              <span class="text-xs text-[#6F7173] font-medium">Mac &bull; Windows &bull; iOS &bull; Android</span>
            </div>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D]">
              Keep Your Favorite Mail Apps.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              No learning curve for your employees. Connect seamlessly to Apple Mail, Microsoft Outlook, or Mozilla Thunderbird, or use our fast webmail client anywhere.
            </p>
          </div>

          {/* App Compatibility Badges */}
          <div class="my-6 grid grid-cols-2 gap-2.5">
            <div class="p-3 rounded-2xl bg-[#FBFBFA] border border-[#E2DFD8] flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-[#2B2C2D]">Apple Mail</div>
                <div class="text-[10px] text-[#6F7173]">Mac, iPhone &amp; iPad</div>
              </div>
            </div>

            <div class="p-3 rounded-2xl bg-[#FBFBFA] border border-[#E2DFD8] flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-[#2B2C2D]">Outlook</div>
                <div class="text-[10px] text-[#6F7173]">Windows &amp; macOS</div>
              </div>
            </div>

            <div class="p-3 rounded-2xl bg-[#FBFBFA] border border-[#E2DFD8] flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-[#2B2C2D]">Thunderbird</div>
                <div class="text-[10px] text-[#6F7173]">Open Source desktop</div>
              </div>
            </div>

            <div class="p-3 rounded-2xl bg-[#F3ECE8] border border-[#9E725F]/30 flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-xl bg-[#9E725F] text-white flex items-center justify-center shrink-0">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-bold text-[#2B2C2D]">BYOS Webmail</div>
                <div class="text-[10px] text-[#9E725F] font-medium">Included free</div>
              </div>
            </div>
          </div>

          <div class="text-[11px] font-medium text-[#6F7173] flex items-center gap-2">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>Standard IMAP and SMTP support. Works out of the box.</span>
          </div>
        </div>

        {/* Cell 4: Flexible Team Permissions (7 cols on lg) */}
        <div class="lg:col-span-7 bg-white rounded-3xl border border-[#E2DFD8] p-6 sm:p-8 shadow-xs flex flex-col justify-between hover:border-[#9E725F]/50 transition-all group">
          <div>
            <div class="flex items-center justify-between mb-4">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-full">
                Team Controls
              </span>

              {/* Mode Toggle Controls */}
              <div class="inline-flex rounded-xl bg-[#F8F7F4] border border-[#E2DFD8] p-1">
                <button
                  type="button"
                  onClick={() => setTeamRole("team")}
                  class={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    teamRole() === "team"
                      ? "bg-[#9E725F] text-white shadow-2xs"
                      : "text-[#6F7173] hover:text-[#3C3D3E]"
                  }`}
                >
                  Team Mailbox
                </button>
                <button
                  type="button"
                  onClick={() => setTeamRole("confidential")}
                  class={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    teamRole() === "confidential"
                      ? "bg-[#9E725F] text-white shadow-2xs"
                      : "text-[#6F7173] hover:text-[#3C3D3E]"
                  }`}
                >
                  Confidential Mailbox
                </button>
              </div>
            </div>

            <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D]">
              Flexible Team Permissions.
            </h3>
            <p class="text-xs sm:text-sm text-[#6F7173] mt-2 leading-relaxed">
              Maintain company business continuity while offering strict privacy for sensitive leadership accounts. Choose the right policy per mailbox with one click.
            </p>
          </div>

          {/* Interactive Card Showing Selected Team Mode */}
          <div class="my-6 p-5 rounded-2xl bg-[#FBFBFA] border border-[#E2DFD8] transition-all">
            {teamRole() === "team" ? (
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <div class="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center">
                      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    </div>
                    <div>
                      <span class="font-bold text-sm text-[#2B2C2D]">Team Mailbox (Standard)</span>
                      <div class="text-[10px] text-[#6F7173]">For sales, support, operations, and general staff</div>
                    </div>
                  </div>
                  <span class="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    Admin Recovery On
                  </span>
                </div>
                <p class="text-xs text-[#6F7173] leading-relaxed">
                  If an employee leaves the company or loses their laptop, organization administrators can safely restore access to the mailbox so no customer conversations are lost.
                </p>
                <div class="pt-2 flex items-center gap-4 text-[11px] font-medium text-[#6F7173]">
                  <span>Account Recovery: <strong class="text-emerald-700">Protected</strong></span>
                  <span>Audit Trail: <strong class="text-[#2B2C2D]">Automatic</strong></span>
                </div>
              </div>
            ) : (
              <div class="space-y-2.5">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <div class="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center">
                      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                    </div>
                    <div>
                      <span class="font-bold text-sm text-[#2B2C2D]">Confidential Mailbox (Strict)</span>
                      <div class="text-[10px] text-[#6F7173]">For founders, board members, legal counsel, and HR</div>
                    </div>
                  </div>
                  <span class="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                    100% Locked
                  </span>
                </div>
                <p class="text-xs text-[#6F7173] leading-relaxed">
                  The mailbox is locked strictly to the user's password. Even company owners and administrators cannot open or read messages under any circumstances.
                </p>
                <div class="pt-2 flex items-center gap-4 text-[11px] font-medium text-[#6F7173]">
                  <span>Admin Access: <strong class="text-rose-700">Blocked</strong></span>
                  <span>Privacy Level: <strong class="text-emerald-700">Highest Possible</strong></span>
                </div>
              </div>
            )}
          </div>

          <div class="text-[11px] font-medium text-[#6F7173] flex items-center gap-2">
            <span class="text-emerald-600 font-bold">✓</span>
            <span>Easily set policies per mailbox in your admin dashboard.</span>
          </div>
        </div>

      </div>
    </section>
  );
}

