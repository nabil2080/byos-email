import { createSignal, onMount, onCleanup } from "solid-js";

export function BigIdeaSeparation() {
  const [progress, setProgress] = createSignal(0);
  const [reduce, setReduce] = createSignal(false);
  let sectionRef: HTMLDivElement | undefined;

  onMount(() => {
    setReduce(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    let ticking = false;
    const compute = () => {
      ticking = false;
      if (!sectionRef) return;
      const rect = sectionRef.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when section enters from bottom, 1 when it leaves top
      const total = rect.height + vh;
      const seen = vh - rect.top;
      const p = Math.min(1, Math.max(0, seen / total));
      setProgress(p);
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(compute);
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    compute();
    onCleanup(() => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    });
  });

  // Peak separation near the middle of the scroll window, reconnect at the ends
  const sep = () => {
    if (reduce()) return 34;
    const p = progress();
    const bell = Math.sin(Math.min(1, Math.max(0, (p - 0.15) / 0.7)) * Math.PI);
    return 8 + bell * 60;
  };

  return (
    <div ref={sectionRef} class="relative">
      <div class="relative mx-auto max-w-md">
        {/* Email layer */}
        <div
          class="relative z-20 card-editorial bg-white p-6 transition-transform duration-100 will-change-transform"
          style={{ transform: `translateY(-${sep()}px)` }}
        >
          <span class="eyebrow">Layer 1</span>
          <h3 class="mt-2 font-display text-xl font-bold text-[#2B2C2D]">Email service</h3>
          <p class="mt-1.5 text-sm text-[#6F7173]">BYOS provides the infrastructure.</p>
        </div>

        {/* Connector between layers */}
        <div class="relative z-10 flex justify-center" aria-hidden="true">
          <span
            class="block w-px bg-gradient-to-b from-[#9E725F]/50 to-[#9E725F]/20 transition-all duration-100"
            style={{ height: `${sep() * 1.4 + 14}px` }}
          ></span>
        </div>

        {/* Storage layer */}
        <div
          class="relative z-20 rounded-[18px] border border-[#9E725F]/25 bg-[#F3ECE8] p-6 transition-transform duration-100 will-change-transform"
          style={{ transform: `translateY(${sep()}px)` }}
        >
          <span class="eyebrow">Layer 2</span>
          <h3 class="mt-2 font-display text-xl font-bold text-[#2B2C2D]">Storage</h3>
          <p class="mt-1.5 text-sm text-[#6F7173]">You control the persistent storage.</p>
        </div>
      </div>
    </div>
  );
}
