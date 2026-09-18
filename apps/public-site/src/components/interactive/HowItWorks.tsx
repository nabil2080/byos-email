import { Component, createSignal, For, Show } from "solid-js";

type StepId = 1 | 2 | 3;
type StorageProvider = "r2" | "s3" | "gdrive";

export const HowItWorks: Component = () => {
  const [activeStep, setActiveStep] = createSignal<StepId>(1);
  const [selectedStorage, setSelectedStorage] = createSignal<StorageProvider>("r2");
  const [sampleDomain, setSampleDomain] = createSignal("acme-corp.com");
  const [isTestEmailSent, setIsTestEmailSent] = createSignal(false);

  const steps = [
    {
      step: 1 as StepId,
      title: "1. Connect Cloud Storage",
      subtitle: "0% markup on storage",
      icon: (
        <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      ),
    },
    {
      step: 2 as StepId,
      title: "2. Add Your Domain",
      subtitle: "Instant DNS verification",
      icon: (
        <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
    },
    {
      step: 3 as StepId,
      title: "3. Start Emailing",
      subtitle: "Private & secure inbox",
      icon: (
        <svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      ),
    },
  ];

  return (
    <div class="bg-white rounded-3xl border border-[#E2DFD8] shadow-xs overflow-hidden">
      {/* Step Tabs Header */}
      <div class="grid grid-cols-3 border-b border-[#E2DFD8] bg-[#F8F7F4]">
        <For each={steps}>
          {(s) => {
            const isActive = () => activeStep() === s.step;
            return (
              <button
                type="button"
                onClick={() => setActiveStep(s.step)}
                class={`p-4 sm:p-6 text-left transition relative cursor-pointer ${
                  isActive()
                    ? "bg-white text-[#2B2C2D]"
                    : "text-[#6F7173] hover:text-[#2B2C2D] hover:bg-[#F3ECE8]/50"
                }`}
              >
                <div class="flex items-center gap-2.5 mb-1 text-[#9E725F]">
                  {s.icon}
                  <span class="text-xs sm:text-sm font-bold truncate text-[#2B2C2D]">{s.title}</span>
                </div>
                <div class="text-[11px] sm:text-xs text-[#6F7173] truncate hidden sm:block">
                  {s.subtitle}
                </div>
                {isActive() && (
                  <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-[#9E725F]"></div>
                )}
              </button>
            );
          }}
        </For>
      </div>

      {/* Step Content Body */}
      <div class="p-6 sm:p-10">
        {/* STEP 1: Connect Storage */}
        <Show when={activeStep() === 1}>
          <div class="space-y-6">
            <div>
              <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
                Step 1: Storage Freedom
              </span>
              <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D] mt-1">
                Connect Your Cloud Storage in One Click
              </h3>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1.5 max-w-2xl leading-relaxed">
                Choose where your emails live. Connect your own Cloudflare R2, Amazon S3, or Google Drive bucket. You pay your provider directly at commodity rates — we take zero cut.
              </p>
            </div>

            {/* Storage Provider Selector */}
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedStorage("r2")}
                class={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                  selectedStorage() === "r2"
                    ? "border-[#9E725F] bg-[#F3ECE8] shadow-xs ring-1 ring-[#9E725F]/30"
                    : "border-[#E2DFD8] bg-[#F8F7F4] hover:bg-white"
                }`}
              >
                <div class="font-bold text-sm text-[#2B2C2D] flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                  <span>Cloudflare R2</span>
                </div>
                <div class="text-xs font-semibold text-emerald-800 mt-1.5">$0.015 / GB &bull; $0 Egress</div>
                <div class="text-[11px] text-[#6F7173] mt-0.5">Best for growing startups &amp; teams</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStorage("s3")}
                class={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                  selectedStorage() === "s3"
                    ? "border-[#9E725F] bg-[#F3ECE8] shadow-xs ring-1 ring-[#9E725F]/30"
                    : "border-[#E2DFD8] bg-[#F8F7F4] hover:bg-white"
                }`}
              >
                <div class="font-bold text-sm text-[#2B2C2D] flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                  <span>Amazon AWS S3</span>
                </div>
                <div class="text-xs font-semibold text-[#2B2C2D] mt-1.5">~$0.023 / GB</div>
                <div class="text-[11px] text-[#6F7173] mt-0.5">Standard, IA, and Glacier compliance</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStorage("gdrive")}
                class={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                  selectedStorage() === "gdrive"
                    ? "border-[#9E725F] bg-[#F3ECE8] shadow-xs ring-1 ring-[#9E725F]/30"
                    : "border-[#E2DFD8] bg-[#F8F7F4] hover:bg-white"
                }`}
              >
                <div class="font-bold text-sm text-[#2B2C2D] flex items-center gap-2">
                  <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                  <span>Google Drive / MinIO</span>
                </div>
                <div class="text-xs font-semibold text-[#2B2C2D] mt-1.5">Existing Workspace</div>
                <div class="text-[11px] text-[#6F7173] mt-0.5">Connect personal or self-hosted drive</div>
              </button>
            </div>

            {/* Live Connection Card */}
            <div class="p-4 sm:p-5 rounded-2xl bg-[#2B2C2D] text-white text-xs space-y-2.5">
              <div class="flex items-center justify-between text-stone-400 pb-2 border-b border-stone-700">
                <span class="font-medium text-stone-300">Cloud Storage Connection Test</span>
                <span class="text-emerald-400 font-bold flex items-center gap-1.5">
                  <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span>Connected (0% markup)</span>
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-stone-300 pt-1">
                <div>
                  <div class="text-[10px] text-stone-400">Provider</div>
                  <div class="font-semibold text-white mt-0.5">
                    {selectedStorage() === "r2" ? "Cloudflare R2" : selectedStorage() === "s3" ? "Amazon S3" : "Google Drive"}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] text-stone-400">Storage Custody</div>
                  <div class="font-semibold text-emerald-300 mt-0.5">100% Customer Owned</div>
                </div>
                <div>
                  <div class="text-[10px] text-stone-400">Monthly Surcharge</div>
                  <div class="font-semibold text-emerald-300 mt-0.5">$0.00 (Zero markup)</div>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* STEP 2: Add Your Domain */}
        <Show when={activeStep() === 2}>
          <div class="space-y-6">
            <div>
              <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
                Step 2: Instant Setup
              </span>
              <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D] mt-1">
                Add Your Company Domain Name
              </h3>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1.5 max-w-2xl leading-relaxed">
                Type in your business domain. We automatically generate standard DNS records (MX, SPF, DKIM) that ensure 100% inbox deliverability with zero spam penalties.
              </p>
            </div>

            {/* Domain Interactive Input */}
            <div class="flex items-center gap-3">
              <label class="text-xs font-bold text-[#2B2C2D] whitespace-nowrap">Your Company Domain:</label>
              <input
                type="text"
                value={sampleDomain()}
                onInput={(e) => setSampleDomain(e.currentTarget.value || "acme-corp.com")}
                placeholder="company.com"
                class="px-3.5 py-2 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs font-medium text-[#2B2C2D] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white max-w-xs transition"
              />
            </div>

            {/* Records Table */}
            <div class="border border-[#E2DFD8] rounded-2xl overflow-hidden divide-y divide-[#E2DFD8] text-xs">
              <div class="p-3 bg-[#F8F7F4] font-bold text-[#6F7173] grid grid-cols-12 font-mono text-[11px]">
                <span class="col-span-2">RECORD</span>
                <span class="col-span-3">HOST</span>
                <span class="col-span-5">PURPOSE</span>
                <span class="col-span-2 text-right">STATUS</span>
              </div>
              <div class="p-3 bg-white grid grid-cols-12 items-center text-[#2B2C2D]">
                <span class="col-span-2 font-bold text-[#9E725F] font-mono">MX</span>
                <span class="col-span-3 truncate font-mono text-xs">@</span>
                <span class="col-span-5 truncate text-[#6F7173]">Direct email delivery</span>
                <span class="col-span-2 text-right text-emerald-700 font-bold">✓ Verified</span>
              </div>
              <div class="p-3 bg-[#FAF9F7] grid grid-cols-12 items-center text-[#2B2C2D]">
                <span class="col-span-2 font-bold text-[#9E725F] font-mono">SPF</span>
                <span class="col-span-3 truncate font-mono text-xs">@</span>
                <span class="col-span-5 truncate text-[#6F7173]">Spam &amp; spoof protection</span>
                <span class="col-span-2 text-right text-emerald-700 font-bold">✓ Verified</span>
              </div>
              <div class="p-3 bg-white grid grid-cols-12 items-center text-[#2B2C2D]">
                <span class="col-span-2 font-bold text-[#9E725F] font-mono">DKIM</span>
                <span class="col-span-3 truncate font-mono text-xs">byos._domainkey</span>
                <span class="col-span-5 truncate text-[#6F7173]">Authentic sender signature</span>
                <span class="col-span-2 text-right text-emerald-700 font-bold">✓ Verified</span>
              </div>
            </div>
          </div>
        </Show>

        {/* STEP 3: Start Emailing */}
        <Show when={activeStep() === 3}>
          <div class="space-y-6">
            <div>
              <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
                Step 3: Ready to Go
              </span>
              <h3 class="text-xl sm:text-2xl font-bold text-[#2B2C2D] mt-1">
                Open Your Inbox &amp; Start Emailing
              </h3>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1.5 max-w-2xl leading-relaxed">
                Log into our fast webmail app, or connect Apple Mail, Outlook, or Thunderbird on your laptop and phone. Your emails stay private, fast, and completely yours.
              </p>
            </div>

            {/* Interactive Email Test Simulator */}
            <div class="p-6 rounded-2xl border border-[#E2DFD8] bg-[#F8F7F4] flex flex-col sm:flex-row items-center justify-between gap-6">
              <div class="space-y-2 text-xs">
                <div class="font-bold text-[#2B2C2D] text-sm flex items-center gap-2">
                  <svg class="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <span>Ready for Daily Business Email</span>
                </div>
                <p class="text-[#6F7173] max-w-md leading-relaxed">
                  Send and receive customer emails just like normal. Underneath, your company owns every single message object without relying on proprietary vendor databases.
                </p>
                <div class="p-3 rounded-xl bg-white border border-[#E2DFD8] text-[#2B2C2D] space-y-1">
                  <div class="font-semibold text-[11px] text-emerald-800">
                    {isTestEmailSent() ? "✓ Test email sent successfully to your domain!" : "Simulate sending your first test email:"}
                  </div>
                  <div class="text-[11px] text-[#6F7173]">
                    To: <span class="font-medium text-[#2B2C2D]">alex@{sampleDomain()}</span> &bull; Status: Inbox delivery confirmed
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsTestEmailSent(!isTestEmailSent())}
                class="px-5 py-3 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition shadow-xs whitespace-nowrap cursor-pointer flex-shrink-0"
              >
                {isTestEmailSent() ? "Reset Test Email" : "Send Test Message →"}
              </button>
            </div>
          </div>
        </Show>
      </div>

      {/* Footer step navigation CTA */}
      <div class="px-6 sm:px-10 py-4 bg-[#F8F7F4] border-t border-[#E2DFD8] flex items-center justify-between">
        <div class="text-xs text-[#6F7173]">
          Step {activeStep()} of 3: {steps[activeStep() - 1].title}
        </div>
        <div class="flex items-center gap-2">
          {activeStep() > 1 && (
            <button
              type="button"
              onClick={() => setActiveStep((prev) => (prev - 1) as StepId)}
              class="px-3.5 py-1.5 rounded-lg border border-[#E2DFD8] text-xs font-semibold text-[#2B2C2D] hover:bg-white transition cursor-pointer"
            >
              ← Back
            </button>
          )}
          {activeStep() < 3 ? (
            <button
              type="button"
              onClick={() => setActiveStep((prev) => (prev + 1) as StepId)}
              class="px-4 py-1.5 rounded-lg bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition cursor-pointer"
            >
              Next Step →
            </button>
          ) : (
            <a
              href="/pricing"
              class="px-4 py-1.5 rounded-lg bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition cursor-pointer"
            >
              See Pricing &amp; Plans →
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

