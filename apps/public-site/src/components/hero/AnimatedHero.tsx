import { createSignal, For } from "solid-js";

// NOTE FOR CODE REVIEWER: The site navigation is provided globally by DesktopNav in Layout.astro.
// Top padding on header ensures DesktopNav sits cleanly above the hero section without overlapping hero titles or badges.
export function AnimatedHero() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const [activeStep, setActiveStep] = createSignal(3);

  const steps = [
    { id: 0, num: "01", title: "Custom Domain", desc: "Your business identity", tag: "company.com" },
    { id: 1, num: "02", title: "BYOS Platform", desc: "Mail routing & infrastructure", tag: "MTA & Router" },
    { id: 2, num: "03", title: "Encrypted Mailbox", desc: "Webmail & client access", tag: "you@company.com" },
    { id: 3, num: "04", title: "Your Storage", desc: "Customer-controlled data", tag: "S3 · Drive · R2" },
  ];

  return (
    <header class="relative overflow-hidden bg-[#F0EEE9] pt-24 pb-16 lg:pt-32 lg:pb-24">
      {/* Background ambient lighting */}
      <div class="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div
          class="absolute -top-32 right-1/4 h-[500px] w-[500px] rounded-full blur-[140px] opacity-35 animate-orb-1"
          style={{ "background-color": "#C89F8D" }}
        />
        <div class="absolute inset-0 bg-editorial-dots opacity-40 [mask-image:radial-gradient(ellipse_at_top_center,#000_20%,transparent_75%)]" />
      </div>

      <div class="relative z-10 mx-auto max-w-7xl px-6 lg:px-8">
        {/* Hero Content Grid */}
        <div class="grid items-center gap-12 lg:grid-cols-12 lg:gap-16 pt-2 lg:pt-4">
          {/* Left Column: Headlines & CTA */}
          <div class="lg:col-span-7">
            <div class="inline-flex items-center gap-2 rounded-full border border-[#9E725F]/30 bg-[#F3ECE8] px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-[#865E4D]">
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-[#9E725F]"></span>
              <span>Privacy-First Architecture &middot; Decoupled Storage</span>
            </div>

            <h1 class="mt-6 font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-[#2B2C2D] leading-[1.06]">
              Business email. <br />
              <span class="text-[#9E725F]">Your storage underneath.</span>
            </h1>

            <p class="mt-6 max-w-2xl text-lg sm:text-xl text-[#6F7173] leading-relaxed font-normal">
              A clean, modern email platform designed for privacy. Keep your domain, your addresses,
              and your full webmail experience — while storing all encrypted mailbox content on storage
              you own.
            </p>

            {/* Action Buttons */}
            <div class="mt-10 flex flex-wrap items-center gap-4">
              <a
                href={`${cpUrl()}/register`}
                class="px-8 py-3.5 btn-primary text-base font-semibold shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E725F] focus-visible:ring-offset-2"
              >
                Get Started
              </a>
              <a
                href="#how-it-works"
                class="px-7 py-3.5 rounded-[10px] border border-[#E2DFD8] bg-white/80 text-base font-semibold text-[#2B2C2D] transition-all hover:bg-white hover:border-[#9E725F]/40 hover:shadow-xs flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E725F] focus-visible:ring-offset-2"
              >
                Explore Architecture
                <svg class="h-4 w-4 text-[#9E725F] stroke-2" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </a>
            </div>

            {/* Key feature pills */}
            <div class="mt-12 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-[#6F7173] border-t border-[#E2DFD8]/70 pt-6">
              <div class="flex items-center gap-2">
                <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#9E725F]/15 text-[#9E725F] text-[10px] font-bold">✓</span>
                <span>No Vendor Lock-in</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#9E725F]/15 text-[#9E725F] text-[10px] font-bold">✓</span>
                <span>Zero Feature-Gating</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#9E725F]/15 text-[#9E725F] text-[10px] font-bold">✓</span>
                <span>Standard SMTP/IMAP</span>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Architecture Card */}
          <div class="lg:col-span-5">
            <div class="card-editorial bg-white p-6 sm:p-7 shadow-sm border border-[#E2DFD8]">
              <div class="flex items-center justify-between border-b border-[#E2DFD8] pb-4">
                <div class="flex items-center gap-2">
                  <span class="h-2.5 w-2.5 shrink-0 rounded-full bg-[#9E725F]"></span>
                  <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#2B2C2D]">
                    How BYOS Works
                  </span>
                </div>
                <span class="text-[11px] font-mono text-[#8B8E91]">Interactive Flow</span>
              </div>

              {/* Stack of Steps */}
              <div class="mt-5 space-y-3">
                <For each={steps}>
                  {(s) => (
                    <button
                      type="button"
                      aria-pressed={activeStep() === s.id}
                      onClick={() => setActiveStep(s.id)}
                      class={`w-full text-left transition-all duration-150 rounded-xl p-4 border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E725F] focus-visible:ring-offset-2 ${
                        activeStep() === s.id
                          ? "border-[#9E725F] bg-[#F3ECE8] shadow-xs"
                          : "border-[#E2DFD8] bg-[#FBFAF7] hover:border-[#9E725F]/40 hover:bg-white"
                      }`}
                    >
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-3 min-w-0">
                          <span
                            class={`text-xs font-mono font-bold shrink-0 ${
                              activeStep() === s.id ? "text-[#9E725F]" : "text-[#8B8E91]"
                            }`}
                          >
                            {s.num}
                          </span>
                          <span class="font-display font-bold text-sm text-[#2B2C2D] truncate">
                            {s.title}
                          </span>
                        </div>
                        <span
                          class={`shrink-0 text-[10px] font-mono px-2 py-0.5 rounded-md border ${
                            activeStep() === s.id
                              ? "border-[#9E725F]/30 bg-white text-[#865E4D] font-bold"
                              : "border-[#E2DFD8] bg-white text-[#6F7173]"
                          }`}
                        >
                          {s.tag}
                        </span>
                      </div>
                      <p class="mt-1.5 text-xs text-[#6F7173] pl-7">
                        {s.desc}
                      </p>
                    </button>
                  )}
                </For>
              </div>

              {/* Detail Panel for selected step */}
              <div class="mt-5 rounded-xl border border-[#9E725F]/20 bg-[#F4F2EC] p-4 text-xs">
                <div class="flex items-center justify-between text-[#865E4D] font-mono font-bold">
                  <span>STEP {steps[activeStep()].num} HIGHLIGHT</span>
                  <span class="shrink-0">{activeStep() === 3 ? "CUSTOMER OWNED" : "BYOS MANAGED"}</span>
                </div>
                <p class="mt-1.5 text-[#3C3D3E] leading-relaxed">
                  {activeStep() === 0 && "Connect your company domain with standard MX & DKIM records in minutes."}
                  {activeStep() === 1 && "High-performance Postfix + Rspamd routing with outbound trust and abuse engine."}
                  {activeStep() === 2 && "Full webmail interface with search, contacts, attachments, rules, and signatures."}
                  {activeStep() === 3 && "Encrypted mailbox data is written directly to your Amazon S3, Google Drive, or R2 storage."}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
