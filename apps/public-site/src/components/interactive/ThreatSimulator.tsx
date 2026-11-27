import { createSignal } from "solid-js";

const SCENARIOS = [
  {
    code: "01",
    title: "Server or Database Breach",
    goal: "Steal and inspect customer communications from central servers.",
    attackerSees: "Message-ID, In-Reply-To, and opaque CryptoEnvelope v1 pointers. Zero plaintext subjects, bodies, or attachments.",
    boundary: "Zero plaintext email bodies or attachments live in BYOS databases. Intruders find only sealed references without decryption keys.",
  },
  {
    code: "02",
    title: "Cloud Bucket Compromise",
    goal: "Access files inside your Cloudflare R2 or Amazon S3 bucket directly.",
    attackerSees: "Random-looking AES-256-GCM ciphertext blocks and X-Wing encapsulated key headers.",
    boundary: "Every message and attachment is individually sealed client-side. Without the device key, bucket objects are unreadable.",
  },
  {
    code: "03",
    title: "Lost or Stolen Device",
    goal: "Gain physical access to an employee's laptop or phone.",
    attackerSees: "Session invalidation error (401 Unauthorized) upon next API request.",
    boundary: "Organization admins can revoke active sessions instantly from the control panel, invalidating cached access immediately.",
  },
  {
    code: "04",
    title: "Rogue Server Administrator",
    goal: "An internal operator or rogue engineer trying to inspect customer mail.",
    attackerSees: "Zero key escrow. No master decryption keys exist anywhere in BYOS infrastructure.",
    boundary: "BYOS operators cannot decrypt your historical or incoming messages—even under administrative access.",
  },
];

export function ThreatSimulator() {
  const [selected, setSelected] = createSignal(0);
  const current = () => SCENARIOS[selected()];

  return (
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
      {/* Left: Scenario Selector */}
      <div class="lg:col-span-5 flex flex-col gap-3">
        {SCENARIOS.map((s, idx) => (
          <button
            type="button"
            onClick={() => setSelected(idx)}
            class={`text-left rounded-2xl border p-5 transition-all cursor-pointer ${
              selected() === idx
                ? "bg-[#F6F3ED] border-[#226192] shadow-sm"
                : "bg-transparent border-[#D8D3C9] hover:bg-[#F6F3ED]/60"
            }`}
          >
            <div class="flex items-center justify-between gap-3">
              <span class="font-display font-bold text-base text-[#18212A]">{s.title}</span>
              <span
                class={`font-mono text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                  selected() === idx
                    ? "bg-[#226192] text-[#EAE6DE]"
                    : "bg-[#D8D3C9]/50 text-[#55616D]"
                }`}
              >
                SCENARIO {s.code}
              </span>
            </div>
          </button>
        ))}
      </div>

      {/* Right: Interactive Inspection Console */}
      <div class="lg:col-span-7 rounded-[24px] bg-[#0B131B] text-[#EAE6DE] p-7 sm:p-9 flex flex-col justify-between shadow-lg">
        <div>
          <div class="flex items-center justify-between gap-3 pb-5 border-b border-white/10">
            <span class="font-mono text-xs uppercase tracking-[0.2em] text-[#EF8557]">
              Scenario {current().code} Inspection
            </span>
            <span class="rounded-full bg-[#226192]/30 border border-[#226192]/50 px-3 py-1 font-mono text-[11px] text-[#EAE6DE]">
              Zero-Knowledge Boundary
            </span>
          </div>

          <h3 class="mt-6 font-display text-2xl font-bold text-[#EAE6DE]">{current().title}</h3>
          <p class="mt-2 text-sm text-[#EAE6DE]/70">
            <strong class="text-[#EAE6DE]">Attacker goal:</strong> {current().goal}
          </p>

          <div class="mt-6 rounded-xl border border-[#EF8557]/35 bg-black/35 p-4 font-mono text-xs text-[#EF8557] leading-relaxed">
            <div class="text-[10px] uppercase tracking-wider text-[#EAE6DE]/50 mb-1">What the attacker sees</div>
            {current().attackerSees}
          </div>
        </div>

        <div class="mt-6 pt-5 border-t border-white/10 text-sm text-[#EAE6DE]/85 leading-relaxed">
          <strong class="text-[#EF8557]">BYOS guarantee:</strong> {current().boundary}
        </div>
      </div>
    </div>
  );
}
