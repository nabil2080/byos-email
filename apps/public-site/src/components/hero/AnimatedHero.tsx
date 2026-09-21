import { onMount } from "solid-js";

export function AnimatedHero() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  let indexRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!indexRef) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const thread = indexRef.querySelector<HTMLElement>(".hero-thread");
    const rows = Array.from(indexRef.querySelectorAll<HTMLElement>("[data-flow]"));
    if (reduce) {
      thread?.classList.add("is-visible");
      rows.forEach((r) => r.classList.add("is-visible"));
      return;
    }
    window.setTimeout(() => thread?.classList.add("is-visible"), 300);
    rows.forEach((r, i) => window.setTimeout(() => r.classList.add("is-visible"), 520 + i * 200));
  });

  const rows = [
    { n: "01", label: "Your domain", value: "company.com" },
    { n: "02", label: "BYOS", value: "Email infrastructure" },
    { n: "03", label: "Your mailbox", value: "you@company.com" },
  ];

  return (
    <header class="relative overflow-hidden bg-[#F0EEE9]">
      {/* Atmosphere — a single faint warm bleed and a masked dot field */}
      <div class="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div
          class="absolute -right-40 -top-40 h-[560px] w-[560px] rounded-full blur-[160px] opacity-40 animate-orb-1"
          style={{ "background-color": "#C89F8D" }}
        />
        <div class="absolute bottom-0 left-0 h-[380px] w-[55%] bg-editorial-dots opacity-50 [mask-image:radial-gradient(ellipse_at_bottom_left,#000_10%,transparent_70%)]" />
      </div>

      <div class="relative z-10 mx-auto max-w-7xl px-6 lg:px-10">
        {/* Masthead rule */}
        <div class="flex items-center justify-between border-b border-[#E2DFD8] py-4 text-[11px] font-mono uppercase tracking-[0.2em] text-[#6F7173]">
          <span>BYOS &middot; Business Email</span>
          <span class="hidden sm:inline">Your email &middot; Your storage &middot; Your control</span>
          <span class="sm:hidden">Vol. 01</span>
        </div>

        {/* Main composition */}
        <div class="grid items-center gap-14 py-16 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:py-24">
          {/* Headline column */}
          <div>
            <span class="eyebrow">A new category of business email</span>

            <h1 class="hero-display mt-6 text-[#2B2C2D]">
              <span data-reveal-line style={{ "--line-delay": "60ms" }}>Business email.</span>
              <span data-reveal-line style={{ "--line-delay": "240ms" }} class="text-[#9E725F]">
                Your way.
              </span>
            </h1>

            <p
              data-reveal-line
              style={{ "--line-delay": "440ms" }}
              class="mt-7 max-w-lg text-lg leading-relaxed text-[#6F7173] sm:text-xl"
            >
              Professional business email with customer-controlled storage and privacy designed
              into the experience.
            </p>

            <div
              data-reveal-line
              style={{ "--line-delay": "600ms" }}
              class="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4"
            >
              <a
                href={`${cpUrl()}/register`}
                class="px-7 py-3.5 btn-primary text-base font-semibold"
              >
                Get Started
              </a>
              <a
                href="/#how-it-works"
                class="link-underline inline-flex items-center gap-2 text-base font-semibold text-[#2B2C2D]"
              >
                See how it works
                <svg class="h-4 w-4 text-[#9E725F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>

          {/* Editorial index of the BYOS model */}
          <div ref={indexRef} class="relative">
            <div class="flex items-center justify-between border-b border-[#E2DFD8] pb-3">
              <span class="text-[11px] font-mono uppercase tracking-[0.2em] text-[#6F7173]">
                The BYOS model
              </span>
              <span class="text-[11px] font-mono text-[#8B8E91]">01 &mdash; 04</span>
            </div>

            <div class="relative pl-8 pt-2">
              {/* the thread */}
              <span
                class="hero-thread absolute left-[9px] top-6 bottom-16 w-px bg-gradient-to-b from-[#9E725F] via-[#9E725F]/60 to-[#9E725F]/25"
                aria-hidden="true"
              ></span>

              {rows.map((row) => (
                <div
                  data-flow
                  class="reveal-node relative flex items-baseline justify-between gap-4 border-b border-[#E2DFD8] py-5"
                >
                  <span
                    class="absolute -left-8 top-6 h-[11px] w-[11px] rounded-full border-2 border-[#F0EEE9] bg-[#9E725F]"
                    aria-hidden="true"
                  ></span>
                  <div class="flex items-baseline gap-4">
                    <span class="font-mono text-xs text-[#8B8E91]">{row.n}</span>
                    <span class="font-display text-xl font-bold text-[#2B2C2D]">{row.label}</span>
                  </div>
                  <span class="font-mono text-xs text-[#6F7173]">{row.value}</span>
                </div>
              ))}

              {/* Storage — the emphasis row */}
              <div data-flow class="reveal-node relative pt-6">
                <span
                  class="absolute -left-8 top-8 h-[11px] w-[11px] rounded-full border-2 border-[#F0EEE9] bg-[#9E725F] ring-4 ring-[#9E725F]/15"
                  aria-hidden="true"
                ></span>
                <div class="flex items-baseline justify-between gap-4">
                  <div class="flex items-baseline gap-4">
                    <span class="font-mono text-xs text-[#8B8E91]">04</span>
                    <span class="font-display text-xl font-bold text-[#2B2C2D]">Your storage</span>
                  </div>
                  <span class="text-[11px] font-mono uppercase tracking-widest text-[#9E725F]">
                    You control
                  </span>
                </div>
                <div class="mt-4 flex flex-wrap gap-2">
                  {["Amazon S3", "Google Drive", "Cloudflare R2", "S3-compatible"].map((tag) => (
                    <span class="rounded-md border border-[#E2DFD8] bg-white/70 px-2.5 py-1 font-mono text-[11px] text-[#3C3D3E]">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
