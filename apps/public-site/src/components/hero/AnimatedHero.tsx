import { createSignal } from "solid-js";

export function AnimatedHero() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const stats = [
    { value: "0%", label: "Storage Markup" },
    { value: "$0.015", label: "/GB / month (At Cost)" },
    { value: "100%", label: "Device-Locked Privacy" },
    { value: "< 10ms", label: "Direct S3/R2 Sync" },
  ];

  return (
    <header class="relative pt-0 pb-12 w-full bg-[#F0EEE9]">
      {/* Framed Card Wrapper */}
      <div class="bg-[#2B2C2D] rounded-[20px] md:rounded-[30px] mx-2 md:mx-4 relative overflow-hidden min-h-[70vh] md:min-h-[82vh] lg:min-h-[86vh] flex items-center shadow-xl border border-[#3C3D3E]">
        {/* Dynamic Cryptographic Grid & Data Routing Orbs Background */}
        <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          {/* Glowing Orbs */}
          <div
            class="absolute top-1/4 left-1/4 w-[480px] sm:w-[640px] h-[360px] sm:h-[480px] rounded-full blur-[120px] opacity-25 animate-orb-1 -translate-x-1/2 -translate-y-1/2"
            style={{ "background-color": "#9E725F" }}
          />
          <div
            class="absolute top-1/2 right-1/4 w-[400px] sm:w-[540px] h-[320px] sm:h-[420px] rounded-full blur-[130px] opacity-20 animate-orb-2 translate-x-1/4 translate-y-1/4"
            style={{ "background-color": "#C89F8D" }}
          />
          <div
            class="absolute bottom-1/4 left-1/2 w-[380px] sm:w-[500px] h-[300px] sm:h-[380px] rounded-full blur-[110px] opacity-15 animate-orb-3 -translate-x-1/2"
            style={{ "background-color": "#8B8E91" }}
          />
          
          {/* Dot Grid */}
          <div class="absolute inset-0 crypto-dot-grid opacity-20" />
        </div>

        {/* Ambient Dark Gradient Overlays for High Contrast Text */}
        <div class="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/30 z-10 pointer-events-none"></div>
        <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent z-10 pointer-events-none"></div>

        {/* Main Content */}
        <div class="container mx-auto px-6 sm:px-10 lg:px-16 relative z-20 py-16 sm:py-24 lg:py-32">
          <div class="w-full max-w-[90%] md:max-w-[80%] lg:max-w-[75%]">
            {/* Pill Badge */}
            <div class="mb-4 md:mb-6">
              <span class="px-3 py-1.5 md:px-4 md:py-2 bg-[#9E725F] text-[#F3ECE8] rounded-full text-xs md:text-sm font-semibold tracking-wide inline-flex items-center gap-2 shadow-xs">
                <span class="relative flex h-2 w-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>Zero Storage Markup &bull; Sovereign Email</span>
              </span>
            </div>

            {/* Giant Impact Headline */}
            <h1 class="text-[#F0EEE9] mb-4 text-3xl sm:text-4xl md:text-5xl lg:text-[72px] xl:text-[84px] font-extrabold leading-[1.08] tracking-tight">
              Business Email You <br class="hidden sm:inline" />
              <span class="text-[#D8A793]">Actually Own.</span>
            </h1>

            {/* Clear Human Subtitle */}
            <p class="text-[#F0EEE9]/85 mb-6 md:mb-8 text-base sm:text-lg md:text-xl lg:text-2xl max-w-2xl font-normal leading-relaxed">
              Connect your own Cloudflare R2, AWS S3, or Google Drive. Get professional webmail and custom domains with zero-knowledge encryption—at pure infrastructure cost.
            </p>

            {/* CTA Buttons Row */}
            <div class="flex flex-col sm:flex-row flex-wrap gap-3 md:gap-4 mt-6 md:mt-10">
              <a
                href={`${cpUrl()}/login`}
                class="px-6 py-2.5 md:px-8 md:py-3.5 btn-primary text-base md:text-lg shine-effect text-center font-semibold shadow-md"
              >
                Start 14-Day Free Trial &rarr;
              </a>
              <a
                href="/pricing"
                class="px-6 py-2.5 md:px-8 md:py-3.5 btn-second text-base md:text-lg shine-effect text-center font-semibold shadow-md"
              >
                Calculate Savings
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Overlapping Stats Bar */}
      <div class="container mx-auto px-4 mt-4 md:-mt-14 relative z-20">
        <div class="bg-white rounded-xl md:rounded-2xl shadow-xl border border-[#E2DFD8] p-4 md:p-6 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {stats.map((stat) => (
            <div class="text-center">
              <div class="text-xl md:text-2xl lg:text-3xl font-extrabold text-[#2B2C2D]">
                {stat.value}
              </div>
              <div class="text-xs md:text-sm text-[#6F7173] mt-1 font-medium">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
