import { Component, createSignal, For, Show } from "solid-js";

type StepId = 1 | 2 | 3;
type StorageProvider = "s3" | "r2" | "gdrive";

export const HowItWorks: Component = () => {
  const [activeStep, setActiveStep] = createSignal<StepId>(1);
  const [selectedStorage, setSelectedStorage] = createSignal<StorageProvider>("r2");
  const [sampleDomain, setSampleDomain] = createSignal("acme-corp.com");
  const [isEncryptedUnlocked, setIsEncryptedUnlocked] = createSignal(false);

  const steps = [
    {
      step: 1 as StepId,
      title: "1. Connect Storage",
      subtitle: "Zero storage markup",
      icon: "💾",
    },
    {
      step: 2 as StepId,
      title: "2. Plug Your Domain",
      subtitle: "Instant DNS verification",
      icon: "🌐",
    },
    {
      step: 3 as StepId,
      title: "3. Device-Sealed Crypto",
      subtitle: "Zero server plaintext",
      icon: "🔐",
    },
  ];

  return (
    <div class="bg-white rounded-3xl border border-[#E2DFD8] shadow-sm overflow-hidden">
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
                    ? "bg-white text-[#3C3D3E]"
                    : "text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F3ECE8]/50"
                }`}
              >
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-base sm:text-lg">{s.icon}</span>
                  <span class="text-xs sm:text-sm font-bold truncate">{s.title}</span>
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
                Step 1: BYOS Infrastructure
              </span>
              <h3 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Bring Your Own Object Storage
              </h3>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1.5 max-w-2xl">
                Unlike legacy providers who lock your communications inside proprietary servers, BYOS connects directly to your cloud storage bucket. You pay AWS, Cloudflare, or Google pennies for storage — BYOS takes zero commission.
              </p>
            </div>

            {/* Storage Provider Selector */}
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedStorage("r2")}
                class={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                  selectedStorage() === "r2"
                    ? "border-[#9E725F] bg-[#F3ECE8] shadow-xs"
                    : "border-[#E2DFD8] bg-[#F8F7F4] hover:bg-white"
                }`}
              >
                <div class="text-xl mb-1">⚡ Cloudflare R2</div>
                <div class="text-xs font-bold text-[#3C3D3E]">Zero Egress Fees</div>
                <div class="text-[11px] text-[#6F7173] mt-0.5">$0.015 / GB-month</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStorage("s3")}
                class={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                  selectedStorage() === "s3"
                    ? "border-[#9E725F] bg-[#F3ECE8] shadow-xs"
                    : "border-[#E2DFD8] bg-[#F8F7F4] hover:bg-white"
                }`}
              >
                <div class="text-xl mb-1">📦 Amazon S3</div>
                <div class="text-xs font-bold text-[#3C3D3E]">Standard / Glacier</div>
                <div class="text-[11px] text-[#6F7173] mt-0.5">Enterprise Compliance</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedStorage("gdrive")}
                class={`p-4 rounded-2xl border text-left transition cursor-pointer ${
                  selectedStorage() === "gdrive"
                    ? "border-[#9E725F] bg-[#F3ECE8] shadow-xs"
                    : "border-[#E2DFD8] bg-[#F8F7F4] hover:bg-white"
                }`}
              >
                <div class="text-xl mb-1">📁 Google Drive / MinIO</div>
                <div class="text-xs font-bold text-[#3C3D3E]">Personal & Self-Hosted</div>
                <div class="text-[11px] text-[#6F7173] mt-0.5">Existing Workspace Storage</div>
              </button>
            </div>

            {/* Live Terminal / Preview */}
            <div class="p-4 sm:p-5 rounded-2xl bg-[#3C3D3E] text-white font-mono text-xs space-y-2">
              <div class="flex items-center justify-between text-stone-400 pb-2 border-b border-stone-700">
                <span>connection_diagnostic.json</span>
                <span class="text-emerald-400 font-bold">● CONNECTED (24ms)</span>
              </div>
              <div class="text-stone-300 space-y-1 pt-1">
                <div>provider: <span class="text-amber-300">"{selectedStorage().toUpperCase()}"</span></div>
                <div>bucket_target: <span class="text-stone-300">"s3://acme-corp-encrypted-mailboxes"</span></div>
                <div>access_control: <span class="text-emerald-300">"CUSTOMER_MANAGED_IAM"</span></div>
                <div>envelope_status: <span class="text-[#F0EEE9]">"AES-256-GCM client authenticated"</span></div>
              </div>
            </div>
          </div>
        </Show>

        {/* STEP 2: Plug Your Domain */}
        <Show when={activeStep() === 2}>
          <div class="space-y-6">
            <div>
              <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
                Step 2: DNS & Delivery
              </span>
              <h3 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Plug In Your Custom Business Domain
              </h3>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1.5 max-w-2xl">
                Point standard DNS records to the BYOS Sovereign Gateway. Automated SPF, DKIM, and DMARC verification ensures pristine 100% inbox delivery without complex server maintenance.
              </p>
            </div>

            {/* Domain Interactive Input */}
            <div class="flex items-center gap-3">
              <label class="text-xs font-bold text-[#3C3D3E] whitespace-nowrap">Your Domain:</label>
              <input
                type="text"
                value={sampleDomain()}
                onInput={(e) => setSampleDomain(e.currentTarget.value || "yourdomain.com")}
                placeholder="company.com"
                class="px-3.5 py-2 rounded-xl border border-[#E2DFD8] bg-[#F8F7F4] text-xs font-mono text-[#3C3D3E] focus:outline-none focus:ring-2 focus:ring-[#9E725F] focus:bg-white max-w-xs transition"
              />
            </div>

            {/* Records Table */}
            <div class="border border-[#E2DFD8] rounded-2xl overflow-hidden divide-y divide-[#E2DFD8] text-xs font-mono">
              <div class="p-3 bg-[#F8F7F4] font-bold text-[#6F7173] grid grid-cols-12">
                <span class="col-span-2">TYPE</span>
                <span class="col-span-3">HOST</span>
                <span class="col-span-5">TARGET VALUE</span>
                <span class="col-span-2 text-right">STATUS</span>
              </div>
              <div class="p-3 bg-white grid grid-cols-12 items-center text-[#3C3D3E]">
                <span class="col-span-2 font-bold text-[#9E725F]">MX</span>
                <span class="col-span-3 truncate">@</span>
                <span class="col-span-5 truncate text-[#6F7173]">10 mail.{sampleDomain()}</span>
                <span class="col-span-2 text-right text-emerald-700 font-bold">✓ Active</span>
              </div>
              <div class="p-3 bg-[#FAF9F7] grid grid-cols-12 items-center text-[#3C3D3E]">
                <span class="col-span-2 font-bold text-[#9E725F]">TXT (SPF)</span>
                <span class="col-span-3 truncate">@</span>
                <span class="col-span-5 truncate text-[#6F7173]">v=spf1 include:_spf.byos.email ~all</span>
                <span class="col-span-2 text-right text-emerald-700 font-bold">✓ Active</span>
              </div>
              <div class="p-3 bg-white grid grid-cols-12 items-center text-[#3C3D3E]">
                <span class="col-span-2 font-bold text-[#9E725F]">TXT (DKIM)</span>
                <span class="col-span-3 truncate">byos._domainkey</span>
                <span class="col-span-5 truncate text-[#6F7173]">v=DKIM1; k=rsa; p=MIIBIjANBgk...</span>
                <span class="col-span-2 text-right text-emerald-700 font-bold">✓ 2048-bit</span>
              </div>
            </div>
          </div>
        </Show>

        {/* STEP 3: Device-Sealed Crypto */}
        <Show when={activeStep() === 3}>
          <div class="space-y-6">
            <div>
              <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
                Step 3: End-to-End Cryptography
              </span>
              <h3 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] mt-1">
                Zero Server Plaintext. Sealed on Your Device.
              </h3>
              <p class="text-xs sm:text-sm text-[#6F7173] mt-1.5 max-w-2xl">
                BYOS utilizes RFC 9180 Hybrid Public Key Encryption (HPKE) and X25519/AES-256-GCM. Encryption occurs client-side before outbound mail leaves your device; decryption occurs strictly on your machine.
              </p>
            </div>

            {/* Interactive Lock Simulation */}
            <div class="p-6 rounded-2xl border border-[#E2DFD8] bg-[#F8F7F4] flex flex-col sm:flex-row items-center justify-between gap-6">
              <div class="space-y-2 text-xs">
                <div class="font-bold text-[#3C3D3E] text-sm flex items-center gap-2">
                  <span>{isEncryptedUnlocked() ? "🔓 Client Device Memory (Decrypted)" : "🔒 Opaque Encrypted Envelope"}</span>
                </div>
                <p class="text-[#6F7173] max-w-md">
                  {isEncryptedUnlocked()
                    ? "Plaintext message body is available only in transient browser RAM while your master key is unlocked."
                    : "BYOS servers and cloud storage see only randomized cryptographic ciphertext and authentication tags."}
                </p>
                <div class="font-mono text-[11px] p-2.5 rounded-xl bg-white border border-[#E2DFD8] text-[#3C3D3E]">
                  {isEncryptedUnlocked()
                    ? "Subject: Board Financial Update Q3\nBody: Revenue hit target; sovereign storage verified."
                    : "0x7f4a9b...c38e9d [AES-256-GCM / HPKE Sealed Payload]"}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsEncryptedUnlocked(!isEncryptedUnlocked())}
                class="px-5 py-3 rounded-xl bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition shadow-xs whitespace-nowrap cursor-pointer flex-shrink-0"
              >
                {isEncryptedUnlocked() ? "Lock Envelope (Simulate Server View)" : "Unlock Envelope (Client View)"}
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
              class="px-3.5 py-1.5 rounded-lg border border-[#E2DFD8] text-xs font-semibold text-[#3C3D3E] hover:bg-white transition cursor-pointer"
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
              href="/signup"
              class="px-4 py-1.5 rounded-lg bg-[#9E725F] text-white text-xs font-semibold hover:bg-[#865E4D] transition cursor-pointer"
            >
              Start Free Trial →
            </a>
          )}
        </div>
      </div>
    </div>
  );
};
