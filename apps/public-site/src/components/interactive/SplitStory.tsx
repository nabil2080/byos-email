import { createSignal } from "solid-js";

const CHAPTERS = [
  {
    step: "01",
    title: "Your domain, untouched",
    subtitle: "DNS & MX ownership",
    copy: "Point your MX, SPF, and 2048-bit DKIM records once. Your company identity (you@company.com) stays portable forever.",
    badge: "RFC 6376 · DKIM",
    visualTitle: "company.com",
    visualDesc: "MX → mx.byos.email · DKIM verified · Zero mail-server ops",
    accent: "blue",
  },
  {
    step: "02",
    title: "Blind delivery & threading",
    subtitle: "Zero-knowledge relay",
    copy: "BYOS handles inbound SMTP, spam filtering, and conversation threading without ever storing plaintext bodies in central databases.",
    badge: "Zero Plaintext DB",
    visualTitle: "BYOS Relay",
    visualDesc: "Reads Message-ID & In-Reply-To · Never sees Subject or Body",
    accent: "blue",
  },
  {
    step: "03",
    title: "Post-quantum client sealing",
    subtitle: "Rust WASM crypto engine",
    copy: "Messages are sealed with X-Wing (ML-KEM-768 + X25519) and AES-256-GCM. Only your device derives the decryption key via Argon2id.",
    badge: "X-Wing + AES-256-GCM",
    visualTitle: "Client WASM Vault",
    visualDesc: "Private keys never leave your browser or device memory",
    accent: "coral",
  },
  {
    step: "04",
    title: "Your storage, your exit",
    subtitle: "Provider-neutral buckets",
    copy: "Sealed objects land directly in your Amazon S3, Cloudflare R2, Google Drive, or Backblaze B2 bucket. Leave anytime with 100% of your archive.",
    badge: "0% Storage Markup",
    visualTitle: "Your Cloud Bucket",
    visualDesc: "s3://company-mail-vault · Direct provider billing (~$0.015/GB)",
    accent: "coral",
  },
];

export function SplitStory() {
  const [active, setActive] = createSignal(0);
  const current = () => CHAPTERS[active()];

  return (
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-start">
      {/* Left: Interactive Chapter List */}
      <div class="lg:col-span-6 space-y-3">
        {CHAPTERS.map((ch, idx) => {
          const isSelected = () => active() === idx;
          return (
            <button
              type="button"
              onClick={() => setActive(idx)}
              onMouseEnter={() => setActive(idx)}
              class={`w-full text-left rounded-2xl border p-6 transition-all duration-300 cursor-pointer ${
                isSelected()
                  ? "bg-[#F6F3ED] border-[#226192] shadow-[0_14px_34px_-16px_rgba(34,97,146,0.28)]"
                  : "bg-transparent border-[#D8D3C9] hover:bg-[#F6F3ED]/60"
              }`}
            >
              <div class="flex items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                  <span
                    class={`font-mono text-xs font-bold px-2.5 py-1 rounded-lg transition-colors ${
                      isSelected()
                        ? "bg-[#226192] text-[#EAE6DE]"
                        : "bg-[#D8D3C9]/50 text-[#55616D]"
                    }`}
                  >
                    {ch.step}
                  </span>
                  <h3 class="font-display text-lg sm:text-xl font-bold text-[#18212A]">
                    {ch.title}
                  </h3>
                </div>
                <span class="font-mono text-[10px] uppercase tracking-wider text-[#55616D]">
                  {ch.subtitle}
                </span>
              </div>
              <p class="mt-3 text-sm text-[#55616D] leading-relaxed pl-11">
                {ch.copy}
              </p>
            </button>
          );
        })}
      </div>

      {/* Right: Sticky Morphing Architectural Stage */}
      <div class="lg:col-span-6 lg:sticky lg:top-28">
        <div class="relative overflow-hidden rounded-[28px] bg-[#0B131B] text-[#EAE6DE] p-8 sm:p-10 min-h-[420px] flex flex-col justify-between shadow-[0_28px_70px_-28px_rgba(11,19,27,0.65)]">
          {/* Ambient glow reacting to active chapter */}
          <div
            class="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full blur-[110px] transition-all duration-700"
            style={{
              "background-color": current().accent === "coral" ? "#EF8557" : "#226192",
              opacity: "0.45",
            }}
            aria-hidden="true"
          />
          <div class="pointer-events-none absolute inset-0 bg-editorial-dots opacity-15" aria-hidden="true" />

          <div class="relative z-10 flex items-center justify-between">
            <span class="font-mono text-xs uppercase tracking-[0.2em] text-[#EF8557]">
              Step {current().step} / 04
            </span>
            <span class="rounded-full border border-[#EAE6DE]/20 bg-white/[0.06] px-3 py-1 font-mono text-[11px] text-[#EAE6DE]">
              {current().badge}
            </span>
          </div>

          <div class="relative z-10 my-10">
            <div class="rounded-2xl border border-[#EAE6DE]/15 bg-white/[0.05] backdrop-blur-md p-6 sm:p-7">
              <div class="flex items-center gap-3">
                <span
                  class={`h-3 w-3 rounded-full ${
                    current().accent === "coral" ? "bg-[#EF8557]" : "bg-[#226192]"
                  }`}
                />
                <span class="font-display text-2xl sm:text-3xl font-bold text-[#EAE6DE]">
                  {current().visualTitle}
                </span>
              </div>
              <p class="mt-3 font-mono text-xs sm:text-sm text-[#EAE6DE]/75 leading-relaxed">
                {current().visualDesc}
              </p>
            </div>
          </div>

          {/* Step progress bar */}
          <div class="relative z-10 grid grid-cols-4 gap-2">
            {CHAPTERS.map((_, i) => (
              <button
                type="button"
                aria-label={`Jump to step ${i + 1}`}
                onClick={() => setActive(i)}
                class={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                  active() === i
                    ? "bg-[#EF8557]"
                    : i < active()
                      ? "bg-[#226192]"
                      : "bg-white/15 hover:bg-white/30"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
