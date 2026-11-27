import { createSignal, onMount, onCleanup } from "solid-js";
import { FlutedGlassCanvas } from "./FlutedGlassCanvas";

export function AnimatedHero() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://localhost:3000";
  };

  let headerRef: HTMLElement | undefined;
  let stackRef: HTMLDivElement | undefined;
  let ctaRef: HTMLAnchorElement | undefined;

  const [tilt, setTilt] = createSignal({ rx: 0, ry: 0 });
  const [ctaOffset, setCtaOffset] = createSignal({ x: 0, y: 0 });
  const [activeLayer, setActiveLayer] = createSignal<number>(3);

  onMount(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (stackRef) {
      const layers = Array.from(stackRef.querySelectorAll<HTMLElement>("[data-layer]"));
      if (reduce) {
        layers.forEach((l) => l.classList.add("is-visible"));
      } else {
        layers.forEach((l, i) =>
          window.setTimeout(() => l.classList.add("is-visible"), 300 + i * 140)
        );
      }
    }

    if (reduce || !headerRef) return;

    const onPointerMove = (e: PointerEvent) => {
      if (!headerRef) return;
      const rect = headerRef.getBoundingClientRect();
      const dx = (e.clientX - rect.left) / rect.width - 0.5;
      const dy = (e.clientY - rect.top) / rect.height - 0.5;
      setTilt({ rx: -dy * 6, ry: dx * 8 });
    };

    const onPointerLeave = () => {
      setTilt({ rx: 0, ry: 0 });
    };

    const onCtaMove = (e: PointerEvent) => {
      if (!ctaRef) return;
      const r = ctaRef.getBoundingClientRect();
      const mx = (e.clientX - (r.left + r.width / 2)) * 0.22;
      const my = (e.clientY - (r.top + r.height / 2)) * 0.22;
      setCtaOffset({ x: mx, y: my });
    };
    const onCtaLeave = () => setCtaOffset({ x: 0, y: 0 });

    headerRef.addEventListener("pointermove", onPointerMove, { passive: true });
    headerRef.addEventListener("pointerleave", onPointerLeave, { passive: true });
    ctaRef?.addEventListener("pointermove", onCtaMove, { passive: true });
    ctaRef?.addEventListener("pointerleave", onCtaLeave, { passive: true });

    onCleanup(() => {
      headerRef?.removeEventListener("pointermove", onPointerMove);
      headerRef?.removeEventListener("pointerleave", onPointerLeave);
      ctaRef?.removeEventListener("pointermove", onCtaMove);
      ctaRef?.removeEventListener("pointerleave", onCtaLeave);
    });
  });

  const layers = [
    { label: "Your domain", value: "company.com", step: "01", tone: "dim" },
    { label: "BYOS", value: "Zero-knowledge mail routing", step: "02", tone: "dim" },
    { label: "Your mailbox", value: "you@company.com", step: "03", tone: "mid" },
    { label: "Your storage", value: "S3 · Drive · R2 · Backblaze", step: "04", tone: "bright" },
  ];

  return (
    <header
      ref={headerRef}
      class="relative overflow-hidden rounded-[22px] md:rounded-[32px] mx-2 md:mx-4 min-h-[68vh] lg:min-h-[min(92vh,880px)] flex items-center bg-[#0B131B] shadow-[0_30px_90px_-30px_rgba(11,19,27,0.72)]"
    >
      {/* 1. Soft CSS fallback glow + Real-Time WebGL Fluted Glass Shader */}
      <div class="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div
          class="absolute left-1/3 top-1/4 h-[520px] w-[520px] rounded-full blur-[140px] opacity-65"
          style={{ background: "radial-gradient(circle, #226192 0%, transparent 72%)" }}
        />
        <div
          class="absolute -bottom-32 left-1/2 h-[480px] w-[480px] rounded-full blur-[130px] opacity-65"
          style={{ background: "radial-gradient(circle, #EF8557 0%, transparent 72%)" }}
        />
        <FlutedGlassCanvas />
        <div class="absolute inset-0 backdrop-blur-[1px]" />
      </div>

      {/* 2. Micro film grain */}
      <div class="pointer-events-none absolute inset-0 z-[2] film-grain opacity-[0.04]" aria-hidden="true" />

      {/* 3. Hero Foreground Content */}
      <div class="relative z-10 w-full mx-auto max-w-7xl px-6 lg:px-12">
        <div class="grid items-center gap-12 py-24 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16 lg:pt-32 lg:pb-24">
          {/* Headline column */}
          <div>
            <div class="inline-flex items-center gap-2.5 rounded-full border border-[#EAE6DE]/20 bg-[#0B131B]/45 backdrop-blur-md px-4 py-1.5 text-[11px] font-mono font-semibold uppercase tracking-[0.2em] text-[#EAE6DE]">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#EF8557] opacity-75" />
                <span class="relative inline-flex rounded-full h-2 w-2 bg-[#EF8557]" />
              </span>
              <span>A new category of business email</span>
            </div>

            <h1 class="hero-display mt-6 text-[#EAE6DE]">
              <span data-reveal-line style={{ "--line-delay": "60ms" }}>
                Business email.
              </span>
              <span
                data-reveal-line
                style={{ "--line-delay": "240ms" }}
                class="bg-gradient-to-r from-[#EF8557] via-[#EAE6DE] to-[#EF8557] bg-clip-text text-transparent animate-text-shimmer"
              >
                Your way.
              </span>
            </h1>

            <p
              data-reveal-line
              style={{ "--line-delay": "420ms" }}
              class="mt-7 max-w-lg text-lg leading-relaxed text-[#EAE6DE]/80 sm:text-xl"
            >
              Professional business email with customer-controlled storage and zero-knowledge
              encryption designed into the experience.
            </p>

            <div
              data-reveal-line
              style={{ "--line-delay": "580ms" }}
              class="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4"
            >
              <a
                ref={ctaRef}
                href={`${cpUrl()}/signup`}
                class="px-7 py-3.5 btn-primary text-base font-semibold shine-effect transition-transform duration-200 ease-out"
                style={{
                  transform: `translate3d(${ctaOffset().x}px, ${ctaOffset().y}px, 0)`,
                }}
              >
                Get Started
              </a>
              <a
                href="/#how-it-works"
                class="group link-underline inline-flex items-center gap-2 text-base font-semibold text-[#EAE6DE]"
              >
                See how it works
                <svg class="h-4 w-4 text-[#EF8557] transition-transform duration-300 group-hover:translate-x-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>

          {/* Interactive 3D-tilting Architecture Stack */}
          <div class="relative" style={{ perspective: "1100px" }}>
            <div
              ref={stackRef}
              class="relative flex flex-col items-stretch transition-transform duration-200 ease-out will-change-transform"
              style={{
                transform: `rotateX(${tilt().rx}deg) rotateY(${tilt().ry}deg)`,
              }}
            >
              {/* Animated vertical signal beam behind the stack */}
              <div
                class="pointer-events-none absolute left-1/2 top-4 bottom-4 w-px -translate-x-1/2 overflow-hidden z-0"
                aria-hidden="true"
              >
                <div class="h-full w-full bg-white/10" />
                <div class="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-transparent via-[#EF8557] to-transparent animate-beam-vertical" />
              </div>

              {layers.map((layer, i) => {
                const widths = ["w-[64%]", "w-[77%]", "w-[90%]", "w-full"];
                const isBright = layer.tone === "bright";
                const isFocused = activeLayer() === i;
                return (
                  <button
                    type="button"
                    data-layer
                    onMouseEnter={() => setActiveLayer(i)}
                    onFocus={() => setActiveLayer(i)}
                    class={`stack-layer text-left mx-auto ${widths[i]} ${i > 0 ? "-mt-px" : ""} rounded-2xl border px-5 py-4 sm:px-6 sm:py-5 transition-all duration-300 cursor-pointer ${
                      isBright
                        ? "relative z-20 border-[#EF8557]/60 bg-gradient-to-br from-[#226192]/95 to-[#164468]/95 backdrop-blur-md shadow-[0_22px_50px_-12px_rgba(34,97,146,0.55)]"
                        : isFocused
                          ? "relative z-10 border-[#EF8557]/45 bg-[#0B131B]/55 backdrop-blur-md shadow-[0_14px_34px_-12px_rgba(0,0,0,0.5)] -translate-y-0.5"
                          : "relative z-10 border-[#EAE6DE]/15 bg-[#0B131B]/35 backdrop-blur-md hover:border-[#EAE6DE]/30"
                    }`}
                  >
                    <div class="flex items-baseline justify-between gap-4">
                      <span class={`font-display text-lg sm:text-xl font-bold ${isBright ? "text-[#EAE6DE]" : "text-[#EAE6DE]"}`}>
                        {layer.label}
                      </span>
                      {isBright ? (
                        <span class="shrink-0 text-[10px] font-mono uppercase tracking-widest text-[#EF8557]">
                          You control
                        </span>
                      ) : (
                        <span class="shrink-0 text-[10px] font-mono text-[#EAE6DE]/55">
                          {layer.step}
                        </span>
                      )}
                    </div>
                    <p class={`mt-1 font-mono text-xs ${isBright ? "text-[#EAE6DE]/85" : "text-[#EAE6DE]/60"}`}>
                      {layer.value}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 4. Bottom Scroll Indicator */}
      <a
        href="#the-idea"
        aria-label="Scroll to architecture"
        class="hidden md:flex absolute bottom-6 left-1/2 -translate-x-1/2 z-10 items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] text-[#EAE6DE]/60 hover:text-[#EF8557] transition-colors"
      >
        <span>Scroll</span>
        <span class="h-4 w-px bg-[#EF8557]/70 animate-pulse-subtle" />
      </a>
    </header>
  );
}