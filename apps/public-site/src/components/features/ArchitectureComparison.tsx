import { Component, createSignal, For } from "solid-js";

interface ComparisonItem {
  feature: string;
  traditional: string;
  byos: string;
  highlight: string;
}

export const ArchitectureComparison: Component = () => {
  const [activeTab, setActiveTab] = createSignal<"both" | "byos" | "traditional">("both");

  const comparisons: ComparisonItem[] = [
    {
      feature: "Where Your Emails Live",
      traditional: "Stored on big tech servers in proprietary closed databases.",
      byos: "Stored in your own Cloudflare R2, AWS S3, or Google Drive bucket.",
      highlight: "You own the storage",
    },
    {
      feature: "Who Can Read Your Messages",
      traditional: "Tech giants scan your inbox for indexing, spam models, and profiling.",
      byos: "Locked on your device. Nobody in between—not even BYOS—can read them.",
      highlight: "Complete privacy",
    },
    {
      feature: "Monthly Pricing",
      traditional: "$6 to $18 per person every month. Massive markup on basic disk space.",
      byos: "From $1.67/month per mailbox with annual billing and volume step-downs. Storage at cost ($0.015/GB).",
      highlight: "Save up to 80%",
    },
    {
      feature: "If You Ever Switch Providers",
      traditional: "Your communications are locked in vendor silos. Migration is a nightmare.",
      byos: "Your email files already live in your bucket. You keep your data forever.",
      highlight: "Zero vendor lock-in",
    },
    {
      feature: "Team & Domain Control",
      traditional: "Opaque admin panels that upsell expensive enterprise tiers for basic controls.",
      byos: "Clean sovereign control panel: add custom domains, mailboxes, and aliases in minutes.",
      highlight: "Simple modern admin",
    },
  ];

  return (
    <section class="py-16 sm:py-24 px-4 sm:px-6 max-w-7xl mx-auto">
      {/* Section Header */}
      <div class="text-center max-w-3xl mx-auto mb-12">
        <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
          Why Companies Are Switching
        </span>
        <h2 class="text-2xl sm:text-4xl lg:text-5xl font-extrabold text-[#2B2C2D] mt-2 tracking-tight">
          Traditional Email vs. BYOS
        </h2>
        <p class="text-xs sm:text-base text-[#6F7173] mt-3 max-w-xl mx-auto">
          See why forward-thinking companies are moving their business email to their own cloud storage.
        </p>

        {/* Mobile View Toggle */}
        <div class="flex items-center justify-center gap-1 mt-6 p-1 bg-white border border-[#E2DFD8] rounded-xl inline-flex shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveTab("both")}
            class={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab() === "both"
                ? "bg-[#9E725F] text-white"
                : "text-[#6F7173] hover:text-[#3C3D3E]"
            }`}
          >
            Side by Side
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("byos")}
            class={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab() === "byos"
                ? "bg-[#9E725F] text-white"
                : "text-[#6F7173] hover:text-[#3C3D3E]"
            }`}
          >
            BYOS Advantage
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("traditional")}
            class={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              activeTab() === "traditional"
                ? "bg-[#9E725F] text-white"
                : "text-[#6F7173] hover:text-[#3C3D3E]"
            }`}
          >
            Traditional Email
          </button>
        </div>
      </div>

      {/* Comparison Grid */}
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-5xl mx-auto">
        {/* Left Column: Traditional SaaS (Hidden if tab is byos) */}
        {(activeTab() === "both" || activeTab() === "traditional") && (
          <div
            class={`${
              activeTab() === "both" ? "lg:col-span-6" : "lg:col-span-12"
            } rounded-3xl border border-stone-300 bg-white p-6 sm:p-8 shadow-xs flex flex-col justify-between`}
          >
            <div>
              <div class="flex items-center justify-between pb-4 border-b border-stone-200">
                <div>
                  <span class="text-xs font-mono uppercase tracking-wider text-rose-700 font-bold">
                    The Old Way
                  </span>
                  <h3 class="text-xl font-bold text-[#2B2C2D] mt-0.5">
                    Traditional Big Tech Email
                  </h3>
                </div>
                <div class="w-8 h-8 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center font-bold text-sm">
                  ✕
                </div>
              </div>

              <div class="mt-6 space-y-5">
                <For each={comparisons}>
                  {(item) => (
                    <div class="p-3.5 rounded-2xl bg-[#FAF9F6] border border-stone-200/80">
                      <div class="text-xs font-bold text-stone-700">{item.feature}</div>
                      <div class="text-xs text-[#6F7173] mt-1 leading-relaxed">
                        {item.traditional}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class="mt-8 pt-4 border-t border-stone-200 text-xs text-stone-500 text-center">
              Punishes company growth with steep per-seat fees.
            </div>
          </div>
        )}

        {/* Right Column: BYOS Sovereign (Hidden if tab is traditional) */}
        {(activeTab() === "both" || activeTab() === "byos") && (
          <div
            class={`${
              activeTab() === "both" ? "lg:col-span-6" : "lg:col-span-12"
            } rounded-3xl border-2 border-[#9E725F] bg-[#FAF9F6] p-6 sm:p-8 shadow-md flex flex-col justify-between relative overflow-hidden`}
          >
            {/* Ambient Corner Accent */}
            <div class="absolute -top-16 -right-16 w-32 h-32 bg-[#9E725F]/15 rounded-full blur-2xl pointer-events-none" />

            <div>
              <div class="flex items-center justify-between pb-4 border-b border-[#E2DFD8]">
                <div>
                  <span class="text-xs font-mono uppercase tracking-wider text-[#9E725F] font-bold">
                    The Sovereign Way
                  </span>
                  <h3 class="text-xl font-bold text-[#2B2C2D] mt-0.5">
                    BYOS Business Email
                  </h3>
                </div>
                <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
                  ✓
                </div>
              </div>

              <div class="mt-6 space-y-5">
                <For each={comparisons}>
                  {(item) => (
                    <div class="p-3.5 rounded-2xl bg-white border border-[#E2DFD8] shadow-2xs group hover:border-[#9E725F]/50 transition-colors">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-bold text-[#2B2C2D]">{item.feature}</span>
                        <span class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                          {item.highlight}
                        </span>
                      </div>
                      <div class="text-xs text-[#3C3D3E] mt-1 leading-relaxed">
                        {item.byos}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class="mt-8 pt-4 border-t border-[#E2DFD8] text-xs text-[#9E725F] font-medium text-center">
              Built for businesses that care about ownership and honest pricing.
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
