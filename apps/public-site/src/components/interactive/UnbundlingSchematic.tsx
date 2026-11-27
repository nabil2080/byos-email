import { createSignal } from "solid-js";

const STAGES = [
  {
    id: 0,
    code: "STAGE 01 // LEGACY BUNDLED LOCK-IN",
    title: "Traditional email bundles the pipe and the vault.",
    summary:
      "Google Workspace and Microsoft 365 force your mail routing and your multi-year archive into the same vendor cloud—charging 300–800% storage markups and holding the keys.",
    pipeStatus: "Vendor Controlled",
    vaultStatus: "Locked in Vendor Cloud ($7–$18/seat)",
    decoupled: false,
  },
  {
    id: 1,
    code: "STAGE 02 // THE ARCHITECTURAL SPLIT",
    title: "BYOS cuts the cord between routing and storage.",
    summary:
      "Incoming mail passes transiently through BYOS in RAM for spam filtering and envelope sealing, then routes straight out of our infrastructure.",
    pipeStatus: "BYOS Blind Relay (RAM Only)",
    vaultStatus: "Decoupled via Provider-Neutral S3/R2/Drive API",
    decoupled: true,
  },
  {
    id: 2,
    code: "STAGE 03 // SOVEREIGN CUSTODY & EXIT",
    title: "Your bucket holds the archive. Your device holds the key.",
    summary:
      "Every sealed message lands in your own AWS S3, Cloudflare R2, Google Drive, or Backblaze B2 account at raw commodity cost (~$0.015/GB). Leave anytime with zero migration.",
    pipeStatus: "Replaceable Delivery Pipe",
    vaultStatus: "100% Owned in Your Cloud Bucket (0% Markup)",
    decoupled: true,
  },
];

export function UnbundlingSchematic() {
  const [stageIdx, setStageIdx] = createSignal(1);
  const current = () => STAGES[stageIdx()];

  return (
    <div class="border border-[#D8D3C9] bg-[#F6F3ED]">
      {/* Stage Selector Rail */}
      <div class="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#D8D3C9] border-b border-[#D8D3C9]">
        {STAGES.map((st, idx) => (
          <button
            type="button"
            onClick={() => setStageIdx(idx)}
            onMouseEnter={() => setStageIdx(idx)}
            class={`text-left p-6 transition-colors cursor-pointer ${
              stageIdx() === idx
                ? "bg-[#EAE6DE] border-b-2 border-b-[#226192]"
                : "bg-[#F6F3ED] hover:bg-[#EAE6DE]/50"
            }`}
          >
            <div class="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#226192]">
              {st.code}
            </div>
            <div class="mt-2 font-display text-base font-bold text-[#18212A]">
              {st.title}
            </div>
          </button>
        ))}
      </div>

      {/* Interactive Blueprint Schematic Stage */}
      <div class="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#D8D3C9]">
        {/* Left Col (5): Architectural Explanation */}
        <div class="lg:col-span-5 p-8 sm:p-10 flex flex-col justify-between">
          <div>
            <span class="eyebrow">{current().code}</span>
            <h3 class="mt-3 font-display text-2xl sm:text-3xl font-bold text-[#18212A] leading-tight">
              {current().title}
            </h3>
            <p class="mt-4 text-sm sm:text-base text-[#55616D] leading-relaxed">
              {current().summary}
            </p>
          </div>

          <div class="mt-8 space-y-3 pt-6 border-t border-[#D8D3C9] font-mono text-xs">
            <div class="flex items-center justify-between">
              <span class="text-[#55616D]">DELIVERY PIPE:</span>
              <span class="font-bold text-[#18212A]">{current().pipeStatus}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-[#55616D]">PERSISTENT VAULT:</span>
              <span class="font-bold text-[#226192]">{current().vaultStatus}</span>
            </div>
          </div>
        </div>

        {/* Right Col (7): Live Animated SVG Circuit Blueprint */}
        <div class="lg:col-span-7 bg-[#0B131B] text-[#EAE6DE] p-8 sm:p-10 flex flex-col justify-between relative overflow-hidden">
          <div class="pointer-events-none absolute inset-0 bg-editorial-dots opacity-15" aria-hidden="true" />

          <div class="relative z-10 flex items-center justify-between font-mono text-[11px] text-[#EAE6DE]/60">
            <span>SCHEMATIC // DATA ROUTING TOPOLOGY</span>
            <span class="text-[#EF8557]">
              {current().decoupled ? "STATUS: DECOUPLED (BYOS)" : "STATUS: MONOLITHIC LOCK-IN"}
            </span>
          </div>

          {/* SVG Topology Diagram */}
          <div class="relative z-10 my-8">
            <svg viewBox="0 0 640 220" class="w-full h-auto overflow-visible">
              {/* Background structural grid lines */}
              <line x1="0" y1="110" x2="640" y2="110" stroke="rgba(234,230,222,0.12)" stroke-dasharray="4 4" />

              {/* Node 1: Custom Domain */}
              <rect x="10" y="74" width="140" height="72" fill="#0B131B" stroke="#EAE6DE" stroke-width="1.2" />
              <text x="24" y="100" fill="#EF8557" font-family="JetBrains Mono, monospace" font-size="10">
                01 // DOMAIN
              </text>
              <text x="24" y="122" fill="#EAE6DE" font-family="Space Grotesk, sans-serif" font-size="14" font-weight="bold">
                company.com
              </text>

              {/* Connector 1 -> 2 */}
              <line x1="150" y1="110" x2="235" y2="110" stroke="#226192" stroke-width="2" />

              {/* Node 2: Delivery Pipe */}
              <rect x="235" y="64" width="165" height="92" fill="#132536" stroke="#226192" stroke-width="1.5" />
              <text x="250" y="92" fill="#EAE6DE" font-family="JetBrains Mono, monospace" font-size="10">
                02 // DELIVERY PIPE
              </text>
              <text x="250" y="115" fill="#EAE6DE" font-family="Space Grotesk, sans-serif" font-size="14" font-weight="bold">
                {current().decoupled ? "BYOS Blind Relay" : "Vendor Monolith"}
              </text>
              <text x="250" y="136" fill="rgba(234,230,222,0.65)" font-family="JetBrains Mono, monospace" font-size="10">
                {current().decoupled ? "RAM Only · Zero Escrow" : "Holds Keys & Archive"}
              </text>

              {/* Connector 2 -> 3 */}
              <line
                x1="400"
                y1="110"
                x2="475"
                y2="110"
                stroke={current().decoupled ? "#EF8557" : "rgba(234,230,222,0.3)"}
                stroke-width="2"
                stroke-dasharray={current().decoupled ? "6 4" : "none"}
              />

              {/* Node 3: Persistent Vault (physically shifts right when decoupled) */}
              <g
                style={{
                  transform: current().decoupled ? "translateX(8px)" : "translateX(-18px)",
                  transition: "transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <rect
                  x="475"
                  y="64"
                  width="150"
                  height="92"
                  fill="#0B131B"
                  stroke={current().decoupled ? "#EF8557" : "rgba(234,230,222,0.35)"}
                  stroke-width="2"
                />
                <text x="490" y="92" fill="#EF8557" font-family="JetBrains Mono, monospace" font-size="10">
                  03 // STORAGE VAULT
                </text>
                <text x="490" y="115" fill="#EAE6DE" font-family="Space Grotesk, sans-serif" font-size="14" font-weight="bold">
                  {current().decoupled ? "Your Bucket" : "Vendor Locked"}
                </text>
                <text x="490" y="136" fill="rgba(234,230,222,0.7)" font-family="JetBrains Mono, monospace" font-size="10">
                  {current().decoupled ? "S3 · R2 · Drive · B2" : "$7–$18/mo Markup"}
                </text>
              </g>
            </svg>
          </div>

          <div class="relative z-10 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[11px] text-[#EAE6DE]/65">
            <span>PROTOCOL: SMTP / JMAP / CALDAV</span>
            <span>VAULT FORMAT: CRYPTOENVELOPE V1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
