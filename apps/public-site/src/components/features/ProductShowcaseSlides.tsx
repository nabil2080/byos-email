import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";

interface SlideData {
  id: number;
  badge: string;
  title: string;
  description: string;
  ctaText: string;
  ctaLink: string;
}

export const ProductShowcaseSlides: Component = () => {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://localhost:3000";
  };

  const [currentSlide, setCurrentSlide] = createSignal(0);
  const [isPlaying, setIsPlaying] = createSignal(true);
  const [storageSelected, setStorageSelected] = createSignal<"r2" | "s3" | "drive">("r2");
  const [privacyView, setPrivacyView] = createSignal<"clean" | "scrambled">("clean");
  const [sliderSeats, setSliderSeats] = createSignal(25);

  const slides: SlideData[] = [
    {
      id: 0,
      badge: "The Webmail App",
      title: "A clean, fast inbox your team will love.",
      description: "Search instantly, read threads without clutter, and organize mailboxes with labels and folders. Everything works smoothly in your browser on desktop and mobile.",
      ctaText: "Explore Webmail",
      ctaLink: `${cpUrl()}/login`,
    },
    {
      id: 1,
      badge: "Cloud Storage",
      title: "Store emails in Cloudflare R2, AWS S3, or Google Drive.",
      description: "Pick your favorite cloud provider. Pay pennies for storage directly to AWS or Cloudflare with zero markup from us. You keep your files forever.",
      ctaText: "Connect Your Storage",
      ctaLink: `${cpUrl()}/login`,
    },
    {
      id: 2,
      badge: "True Privacy",
      title: "Nobody reads your emails. Not even us.",
      description: "Emails are locked directly on your device before they touch any server. Even if someone inspected our database or your cloud bucket, they see only scrambled files.",
      ctaText: "See How Privacy Works",
      ctaLink: "/security",
    },
    {
      id: 3,
      badge: "Deliverability",
      title: "Your company domain. Straight to the inbox.",
      description: "Add your domain in under 3 minutes with automated DNS checks. Built-in digital signatures ensure your messages land in the primary inbox, not spam.",
      ctaText: "Set Up Custom Domain",
      ctaLink: `${cpUrl()}/login`,
    },
    {
      id: 4,
      badge: "Honest Pricing",
      title: "Fair volume pricing that rewards growth.",
      description: "No expensive per-seat markups or feature paywalls. As your team adds mailboxes, you automatically unlock compounding 5% volume discounts.",
      ctaText: "Calculate Your Savings",
      ctaLink: "/pricing",
    },
  ];

  let autoPlayInterval: ReturnType<typeof setInterval> | null = null;

  function nextSlide() {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  }

  function prevSlide() {
    setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
  }

  function startAutoPlay() {
    if (autoPlayInterval) clearInterval(autoPlayInterval);
    autoPlayInterval = setInterval(() => {
      if (isPlaying()) {
        nextSlide();
      }
    }, 7000);
  }

  onMount(() => {
    startAutoPlay();
    onCleanup(() => {
      if (autoPlayInterval) clearInterval(autoPlayInterval);
    });
  });

  return (
    <section id="product-tour" class="py-16 sm:py-24 px-4 sm:px-6 max-w-7xl mx-auto scroll-mt-20">
      {/* Header */}
      <div class="text-center max-w-3xl mx-auto mb-10">
        <span class="text-xs uppercase tracking-widest font-mono text-[#226192] font-bold">
          Product Tour
        </span>
        <h2 class="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-[#18212A] mt-2 tracking-tight">
          Everything You Need. Nothing You Don't.
        </h2>
        <p class="text-xs sm:text-base text-[#55616D] mt-3">
          Explore how BYOS gives your business complete ownership of your email communications.
        </p>
      </div>

      {/* Interactive Tabs Header */}
      <div class="flex items-center justify-start sm:justify-center overflow-x-auto no-scrollbar gap-2 mb-8 pb-2">
        <For each={slides}>
          {(slide, idx) => (
            <button
              type="button"
              onClick={() => {
                setCurrentSlide(idx());
                setIsPlaying(false);
              }}
              class={`px-4 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 shrink-0 ${
                currentSlide() === idx()
                  ? "bg-[#226192] text-white shadow-sm ring-2 ring-[#226192]/20"
                  : "bg-[#F6F3ED] text-[#55616D] hover:text-[#18212A] border border-[#D8D3C9]"
              }`}
            >
              <span
                class={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  currentSlide() === idx() ? "bg-[#F6F3ED]/20 text-white" : "bg-stone-100 text-stone-600"
                }`}
              >
                {idx() + 1}
              </span>
              <span>{slide.badge}</span>
            </button>
          )}
        </For>
      </div>

      {/* Main Slide Card */}
      <div
        class="bg-[#F6F3ED] rounded-3xl border border-[#D8D3C9] shadow-md overflow-hidden relative"
        onMouseEnter={() => setIsPlaying(false)}
        onMouseLeave={() => setIsPlaying(true)}
      >
        <div class="grid grid-cols-1 lg:grid-cols-12 min-h-[480px]">
          {/* Left Column: Slide Description */}
          <div class="lg:col-span-5 p-6 sm:p-10 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-[#D8D3C9] bg-[#FAF9F6]">
            <div>
              <div class="inline-block px-3 py-1 rounded-full text-xs font-mono font-semibold bg-[#E2E7EB] text-[#226192] mb-4">
                Feature {currentSlide() + 1} of {slides.length} • {slides[currentSlide()].badge}
              </div>
              <h3 class="text-xl sm:text-3xl font-extrabold text-[#18212A] tracking-tight leading-snug">
                {slides[currentSlide()].title}
              </h3>
              <p class="mt-4 text-xs sm:text-sm text-[#55616D] leading-relaxed">
                {slides[currentSlide()].description}
              </p>
            </div>

            <div class="mt-8 pt-6 border-t border-[#D8D3C9]/80 flex flex-wrap items-center justify-between gap-4">
              <a
                href={slides[currentSlide()].ctaLink}
                class="inline-flex items-center gap-2 rounded-xl bg-[#226192] hover:bg-[#1B4E76] px-5 py-2.5 text-xs font-semibold text-white shadow-2xs transition-colors cursor-pointer"
              >
                <span>{slides[currentSlide()].ctaText}</span>
                <span>→</span>
              </a>

              {/* Slider Arrows */}
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={prevSlide}
                  aria-label="Previous Slide"
                  class="w-8 h-8 rounded-lg border border-[#D8D3C9] bg-[#F6F3ED] hover:bg-[#EAE6DE] flex items-center justify-center text-xs text-[#18212A] shadow-2xs transition-colors cursor-pointer"
                >
                  ←
                </button>
                <button
                  type="button"
                  onClick={nextSlide}
                  aria-label="Next Slide"
                  class="w-8 h-8 rounded-lg border border-[#D8D3C9] bg-[#F6F3ED] hover:bg-[#EAE6DE] flex items-center justify-center text-xs text-[#18212A] shadow-2xs transition-colors cursor-pointer"
                >
                  →
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Realistic Interactive Mockup UI */}
          <div class="lg:col-span-7 p-4 sm:p-8 bg-[#EAE6DE]/50 flex items-center justify-center">
            {/* Slide 0 Mockup: Clean Webmail App */}
            <Show when={currentSlide() === 0}>
              <div class="w-full max-w-lg bg-[#F6F3ED] rounded-2xl border border-[#D8D3C9] shadow-sm overflow-hidden animate-slide-right">
                {/* Mockup Window Titlebar */}
                <div class="px-4 py-2.5 bg-[#FAF9F6] border-b border-[#D8D3C9] flex items-center justify-between text-xs">
                  <div class="flex items-center gap-1.5">
                    <span class="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                    <span class="ml-2 font-mono text-[11px] text-[#55616D]">mail.byos.email</span>
                  </div>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                    100% Private
                  </span>
                </div>

                {/* Mockup Body */}
                <div class="grid grid-cols-12 text-xs divide-x divide-[#D8D3C9]">
                  {/* Left Mailbox Nav */}
                  <div class="col-span-4 p-3 space-y-1 bg-[#FAF9F6]">
                    <div class="px-2 py-1.5 rounded-lg bg-[#226192] text-white font-medium text-[11px] flex justify-between">
                      <span>Inbox</span>
                      <span class="bg-[#F6F3ED]/20 px-1.5 rounded text-[10px]">3</span>
                    </div>
                    <div class="px-2 py-1.5 rounded-lg text-[#55616D] hover:bg-[#F6F3ED] text-[11px]">Sent</div>
                    <div class="px-2 py-1.5 rounded-lg text-[#55616D] hover:bg-[#F6F3ED] text-[11px]">Drafts</div>
                    <div class="px-2 py-1.5 rounded-lg text-[#55616D] hover:bg-[#F6F3ED] text-[11px]">Archive</div>
                    <div class="pt-4 border-t border-[#D8D3C9] text-[10px] text-stone-400 font-mono">
                      Cloudflare R2: 1.2 GB
                    </div>
                  </div>

                  {/* Right Email Thread */}
                  <div class="col-span-8 p-3.5 space-y-3 bg-[#F6F3ED]">
                    <div class="border-b border-[#D8D3C9] pb-2">
                      <div class="font-bold text-xs text-[#18212A]">Final Agreement & Architecture</div>
                      <div class="text-[11px] text-[#55616D]">From: sarah@acme.corp</div>
                    </div>
                    <p class="text-[11px] text-[#18212A] leading-relaxed">
                      "Team, we verified the custom domain and connected our R2 bucket. All employee emails are arriving safely and zero data is held on third-party servers."
                    </p>
                    <div class="p-2 rounded-lg bg-[#FAF9F6] border border-[#D8D3C9] flex items-center justify-between text-[11px]">
                      <span class="font-medium text-[#18212A]">📎 agreement_v2.pdf</span>
                      <span class="text-stone-400">184 KB</span>
                    </div>
                  </div>
                </div>
              </div>
            </Show>

            {/* Slide 1 Mockup: Cloud Storage Connector */}
            <Show when={currentSlide() === 1}>
              <div class="w-full max-w-lg bg-[#F6F3ED] rounded-2xl border border-[#D8D3C9] shadow-sm p-5 space-y-4 animate-slide-right">
                <div class="flex items-center justify-between pb-3 border-b border-[#D8D3C9]">
                  <span class="text-xs font-bold text-[#18212A]">Connected Cloud Storage</span>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold flex items-center gap-1">
                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Live Connection
                  </span>
                </div>

                {/* Storage Provider Selector Buttons */}
                <div class="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setStorageSelected("r2")}
                    class={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      storageSelected() === "r2"
                        ? "border-[#226192] bg-[#E2E7EB] ring-1 ring-[#226192]/30"
                        : "border-[#D8D3C9] bg-[#FAF9F6]"
                    }`}
                  >
                    <div class="text-xs font-bold text-[#18212A]">Cloudflare R2</div>
                    <div class="text-[10px] text-emerald-700 font-mono mt-0.5">$0.00 Egress</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStorageSelected("s3")}
                    class={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      storageSelected() === "s3"
                        ? "border-[#226192] bg-[#E2E7EB] ring-1 ring-[#226192]/30"
                        : "border-[#D8D3C9] bg-[#FAF9F6]"
                    }`}
                  >
                    <div class="text-xs font-bold text-[#18212A]">Amazon S3</div>
                    <div class="text-[10px] text-[#55616D] font-mono mt-0.5">$0.015/GB</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStorageSelected("drive")}
                    class={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      storageSelected() === "drive"
                        ? "border-[#226192] bg-[#E2E7EB] ring-1 ring-[#226192]/30"
                        : "border-[#D8D3C9] bg-[#FAF9F6]"
                    }`}
                  >
                    <div class="text-xs font-bold text-[#18212A]">Google Drive</div>
                    <div class="text-[10px] text-[#55616D] font-mono mt-0.5">Workspace</div>
                  </button>
                </div>

                {/* Bucket Details */}
                <div class="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#D8D3C9] text-xs font-mono space-y-1.5">
                  <div class="flex justify-between">
                    <span class="text-[#55616D]">Target Bucket:</span>
                    <span class="text-[#18212A] font-bold">company-email-vault</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-[#55616D]">Storage Ping Latency:</span>
                    <span class="text-emerald-700 font-bold">8ms (Direct API)</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-[#55616D]">Markup Paid to BYOS:</span>
                    <span class="text-emerald-700 font-bold">$0.00 (Zero markup)</span>
                  </div>
                </div>

                <div class="text-[11px] text-[#55616D] text-center pt-1">
                  ✓ Files stream straight from internet to your bucket without intermediate retention.
                </div>
              </div>
            </Show>

            {/* Slide 2 Mockup: True Privacy Demonstration */}
            <Show when={currentSlide() === 2}>
              <div class="w-full max-w-lg bg-[#F6F3ED] rounded-2xl border border-[#D8D3C9] shadow-sm p-5 space-y-4 animate-slide-right">
                <div class="flex items-center justify-between pb-3 border-b border-[#D8D3C9]">
                  <span class="text-xs font-bold text-[#18212A]">Visual Privacy Inspector</span>
                  {/* View Mode Toggle */}
                  <div class="flex items-center gap-1 bg-[#EAE6DE] p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setPrivacyView("clean")}
                      class={`px-2 py-0.5 text-[10px] font-semibold rounded ${
                        privacyView() === "clean" ? "bg-[#226192] text-white" : "text-[#55616D]"
                      }`}
                    >
                      On Your Device
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrivacyView("scrambled")}
                      class={`px-2 py-0.5 text-[10px] font-semibold rounded ${
                        privacyView() === "scrambled" ? "bg-[#226192] text-white" : "text-[#55616D]"
                      }`}
                    >
                      On The Server
                    </button>
                  </div>
                </div>

                {privacyView() === "clean" ? (
                  <div class="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs space-y-2">
                    <div class="flex items-center gap-1.5 font-bold text-emerald-900">
                      <span>✓</span>
                      <span>Decrypted Only on Authorized Laptops / Phones</span>
                    </div>
                    <div class="bg-[#F6F3ED] p-3 rounded-lg border border-emerald-100 text-stone-800 font-sans leading-relaxed">
                      "Financial Audit Q3: All quarterly tax receipts and employee stock documents are confirmed."
                    </div>
                    <div class="text-[11px] text-emerald-700">
                      Your master key unlocks messages locally in browser memory.
                    </div>
                  </div>
                ) : (
                  <div class="p-4 rounded-xl bg-stone-900 text-stone-300 border border-stone-800 text-xs space-y-2">
                    <div class="flex items-center gap-1.5 font-bold text-amber-400 font-mono text-[11px]">
                      <span>🔒</span>
                      <span>Locked Raw Storage File</span>
                    </div>
                    <div class="bg-stone-950 p-3 rounded-lg border border-stone-800 font-mono text-[11px] text-stone-400 break-all">
                      5b9e01f82c448d...a83f9e01c448d21b0e (Scrambled unreadable file)
                    </div>
                    <div class="text-[11px] text-stone-400">
                      Even BYOS operators or cloud hosts cannot read a single sentence.
                    </div>
                  </div>
                )}

                <div class="text-[11px] text-[#55616D] text-center">
                  Private keys never leave your devices.
                </div>
              </div>
            </Show>

            {/* Slide 3 Mockup: Deliverability & Custom Domain */}
            <Show when={currentSlide() === 3}>
              <div class="w-full max-w-lg bg-[#F6F3ED] rounded-2xl border border-[#D8D3C9] shadow-sm p-5 space-y-3.5 animate-slide-right">
                <div class="flex items-center justify-between pb-3 border-b border-[#D8D3C9]">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold text-[#18212A]">Domain DNS Inspector</span>
                    <span class="text-[11px] font-mono text-[#55616D]">acme-corp.com</span>
                  </div>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                    10/10 Deliverability
                  </span>
                </div>

                <div class="space-y-2 text-xs">
                  <div class="p-2.5 rounded-xl bg-[#FAF9F6] border border-[#D8D3C9] flex items-center justify-between">
                    <div>
                      <div class="font-bold text-[#18212A]">MX Record (Incoming Mail)</div>
                      <div class="text-[10px] font-mono text-[#55616D]">mail.byos.email • Priority 10</div>
                    </div>
                    <span class="text-emerald-700 font-bold text-xs">Verified ✓</span>
                  </div>

                  <div class="p-2.5 rounded-xl bg-[#FAF9F6] border border-[#D8D3C9] flex items-center justify-between">
                    <div>
                      <div class="font-bold text-[#18212A]">SPF Protection (Anti-Spoofing)</div>
                      <div class="text-[10px] font-mono text-[#55616D]">v=spf1 include:byos.email ~all</div>
                    </div>
                    <span class="text-emerald-700 font-bold text-xs">Verified ✓</span>
                  </div>

                  <div class="p-2.5 rounded-xl bg-[#FAF9F6] border border-[#D8D3C9] flex items-center justify-between">
                    <div>
                      <div class="font-bold text-[#18212A]">DKIM Digital Signature</div>
                      <div class="text-[10px] font-mono text-[#55616D]">2048-bit domain key signature</div>
                    </div>
                    <span class="text-emerald-700 font-bold text-xs">Verified ✓</span>
                  </div>

                  <div class="p-2.5 rounded-xl bg-[#FAF9F6] border border-[#D8D3C9] flex items-center justify-between">
                    <div>
                      <div class="font-bold text-[#18212A]">DMARC Policy Enforcement</div>
                      <div class="text-[10px] font-mono text-[#55616D]">p=reject (Full impersonation block)</div>
                    </div>
                    <span class="text-emerald-700 font-bold text-xs">Active ✓</span>
                  </div>
                </div>

                <div class="text-[11px] text-[#55616D] text-center pt-1">
                  Guaranteed inbox placement across Gmail, Outlook, Apple Mail, and corporate relays.
                </div>
              </div>
            </Show>

            {/* Slide 4 Mockup: Capacity & Savings Preview */}
            <Show when={currentSlide() === 4}>
              <div class="w-full max-w-lg bg-[#F6F3ED] rounded-2xl border border-[#D8D3C9] shadow-sm p-5 space-y-4 animate-slide-right">
                <div class="flex items-center justify-between pb-3 border-b border-[#D8D3C9]">
                  <span class="text-xs font-bold text-[#18212A]">Interactive Savings Preview</span>
                  <span class="text-xs font-mono font-bold text-[#226192] bg-[#E2E7EB] px-2.5 py-0.5 rounded-lg">
                    {sliderSeats()} Mailboxes
                  </span>
                </div>

                <div class="space-y-2">
                  <div class="flex justify-between text-xs text-[#55616D]">
                    <span>Drag slider to see cost</span>
                    <span class="font-bold text-[#18212A]">{sliderSeats()} seats</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="100"
                    value={sliderSeats()}
                    onInput={(e) => setSliderSeats(parseInt(e.currentTarget.value, 10))}
                    class="w-full h-2 bg-[#D8D3C9] rounded-lg appearance-none cursor-pointer accent-[#226192]"
                  />
                </div>

                <div class="grid grid-cols-2 gap-3 pt-2">
                  <div class="p-3 rounded-xl bg-[#FAF9F6] border border-[#D8D3C9]">
                    <div class="text-[11px] text-[#55616D]">BYOS Capacity:</div>
                    <div class="text-lg font-bold text-[#18212A]">
                      ${(sliderSeats() * 2.7).toFixed(2)}
                      <span class="text-[11px] font-normal text-[#55616D]">/mo</span>
                    </div>
                    <div class="text-[10px] text-emerald-700 mt-1">Automatic 5% volume step-downs</div>
                  </div>

                  <div class="p-3 rounded-xl bg-rose-50/60 border border-rose-200">
                    <div class="text-[11px] text-rose-800">Big Tech Suite:</div>
                    <div class="text-lg font-bold text-rose-900">
                      ${(sliderSeats() * 12).toFixed(2)}
                      <span class="text-[11px] font-normal text-rose-700">/mo</span>
                    </div>
                    <div class="text-[10px] text-rose-700 mt-1">$12 to $18/user markup</div>
                  </div>
                </div>

                <div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                  <div class="text-xs font-bold text-emerald-900">
                    Estimated Savings: ${(sliderSeats() * 9.3 * 12).toLocaleString(undefined, { maximumFractionDigits: 0 })} / year
                  </div>
                  <div class="text-[11px] text-emerald-700 mt-0.5">
                    Keep your savings or invest in growing your business.
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </section>
  );
};
