import { onMount } from "solid-js";

export function AnimatedHero() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  let stackRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!stackRef) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const layers = Array.from(stackRef.querySelectorAll<HTMLElement>("[data-layer]"));
    if (reduce) {
      layers.forEach((l) => l.classList.add("is-visible"));
      return;
    }
    // Foundation rises first, then each layer lands on top of it.
    layers.forEach((l, i) => window.setTimeout(() => l.classList.add("is-visible"), 380 + i * 170));
  });

  // Bottom of array = bottom of the visual stack (storage, the foundation).
  const layers = [
    { label: "Your domain", value: "company.com", tone: "dim" },
    { label: "BYOS", value: "Email infrastructure", tone: "dim" },
    { label: "Your mailbox", value: "you@company.com", tone: "mid" },
    { label: "Your storage", value: "S3 · Drive · R2 · Backblaze", tone: "bright" },
  ];

  return (
    <header class="relative overflow-hidden bg-no-repeat bg-cover rounded-[20px] md:rounded-[30px] mx-2 md:mx-4 min-h-[60vh] md:min-h-screen bg-[#1C1A18]">
      {/* Depth: warm glows + fine grid, clipped to the rounded panel */}
      <div class="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
        <div
          class="absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full blur-[150px] opacity-50 animate-orb-1"
          style={{ "background-color": "#9E725F" }}
        />
        <div
          class="absolute -left-24 bottom-0 h-[420px] w-[420px] rounded-full blur-[140px] opacity-30 animate-orb-2"
          style={{ "background-color": "#C89F8D" }}
        />
        <div class="absolute inset-0 opacity-[0.05] bg-editorial-dots [mask-image:radial-gradient(ellipse_60%_60%_at_50%_30%,#000_20%,transparent_75%)]" />
      </div>

      <div class="relative z-10 mx-auto max-w-7xl px-6 lg:px-10">
        <div class="grid items-center gap-14 py-28 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:pt-36 lg:pb-24">
          {/* Headline column */}
          <div>
            <span class="text-[11px] font-mono font-semibold uppercase tracking-[0.22em] text-[#C89F8D]">
              A new category of business email
            </span>

            <h1 class="hero-display mt-6 text-[#F0EEE9]">
              <span data-reveal-line style={{ "--line-delay": "60ms" }}>Business email.</span>
              <span data-reveal-line style={{ "--line-delay": "240ms" }} class="text-[#C89F8D]">
                Your way.
              </span>
            </h1>

            <p
              data-reveal-line
              style={{ "--line-delay": "440ms" }}
              class="mt-7 max-w-lg text-lg leading-relaxed text-[#F0EEE9]/65 sm:text-xl"
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
                class="link-underline inline-flex items-center gap-2 text-base font-semibold text-[#F0EEE9]"
              >
                See how it works
                <svg class="h-4 w-4 text-[#C89F8D]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>

          {/* The stack: storage is the foundation everything else sits on */}
          <div ref={stackRef} class="flex flex-col items-stretch">
            {layers.map((layer, i) => {
              const widths = ["w-[58%]", "w-[74%]", "w-[89%]", "w-full"];
              const isBright = layer.tone === "bright";
              return (
                <div
                  data-layer
                  class={`stack-layer mx-auto ${widths[i]} ${i > 0 ? "-mt-px" : ""} rounded-2xl border px-5 py-4 sm:px-6 sm:py-5 ${
                    isBright
                      ? "relative z-10 border-[#C89F8D]/40 bg-gradient-to-br from-[#9E725F] to-[#865E4D] shadow-[0_18px_40px_-12px_rgba(158,114,95,0.55)]"
                      : "border-white/10 bg-white/[0.04] backdrop-blur-sm"
                  }`}
                >
                  <div class="flex items-baseline justify-between gap-4">
                    <span class={`font-display text-lg sm:text-xl font-bold ${isBright ? "text-white" : "text-[#F0EEE9]"}`}>
                      {layer.label}
                    </span>
                    {isBright && (
                      <span class="shrink-0 text-[10px] font-mono uppercase tracking-widest text-white/85">
                        You control
                      </span>
                    )}
                  </div>
                  <p class={`mt-1 font-mono text-xs ${isBright ? "text-white/80" : "text-[#F0EEE9]/45"}`}>
                    {layer.value}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}