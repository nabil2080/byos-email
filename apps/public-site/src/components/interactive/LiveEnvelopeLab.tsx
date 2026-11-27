import { createSignal, createMemo } from "solid-js";

const PRESETS = [
  {
    label: "Board Deck",
    subject: "Q4 Board Deck — Confidential",
    body: "Attached are the Q4 unit economics and runway projections prior to Friday's vote.",
  },
  {
    label: "Term Sheet",
    subject: "Series A Term Sheet (Redline v3)",
    body: "Please review the revised liquidation preference and board seat clauses before signing.",
  },
  {
    label: "Payroll",
    subject: "November Payroll Wire Approval",
    body: "Total disbursement $142,800 across 24 team members. Approve before 4:00 PM UTC.",
  },
];

function deterministicHex(input: string, length: number): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  const chars = "0123456789abcdef";
  let out = "";
  let seed = (h1 >>> 0) ^ (h2 >>> 0);
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed ^ (i + 17), 1664525) + 1013904223) >>> 0;
    out += chars[seed & 15];
  }
  return out;
}

export function LiveEnvelopeLab() {
  const [subject, setSubject] = createSignal(PRESETS[0].subject);
  const [body, setBody] = createSignal(PRESETS[0].body);
  const [breachMode, setBreachMode] = createSignal(false);

  const envelope = createMemo(() => {
    const raw = `${subject()}::${body()}`;
    const kemHex = deterministicHex(`kem:${raw}`, 32);
    const cipherHex = deterministicHex(`aead:${raw}`, 64);
    const msgId = `<${deterministicHex(`id:${raw}`, 12)}@company.com>`;
    return { kemHex, cipherHex, msgId };
  });

  return (
    <div class="rounded-[26px] border border-[#D8D3C9] bg-[#F6F3ED] p-6 sm:p-10 shadow-sm">
      {/* Header row */}
      <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-6 pb-8 border-b border-[#D8D3C9]">
        <div>
          <span class="eyebrow">Live Zero-Knowledge Lab</span>
          <h2 class="mt-3 font-display text-3xl sm:text-4xl font-bold text-[#18212A] leading-tight">
            See what we see.{" "}
            <span class="font-editorial-serif font-normal text-[#226192]">And what we never can.</span>
          </h2>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          {PRESETS.map((p) => (
            <button
              type="button"
              onClick={() => {
                setSubject(p.subject);
                setBody(p.body);
              }}
              class={`px-3.5 py-1.5 rounded-full text-xs font-mono transition-all cursor-pointer border ${
                subject() === p.subject
                  ? "bg-[#226192] text-[#EAE6DE] border-[#226192]"
                  : "bg-[#EAE6DE]/70 text-[#18212A] border-[#D8D3C9] hover:border-[#226192]/50"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setBreachMode(!breachMode())}
            class={`px-3.5 py-1.5 rounded-full text-xs font-mono font-semibold transition-all cursor-pointer border ${
              breachMode()
                ? "bg-[#EF8557] text-[#0B131B] border-[#EF8557] shadow-xs"
                : "bg-[#0B131B] text-[#EAE6DE] border-[#0B131B] hover:bg-[#18212A]"
            }`}
          >
            {breachMode() ? "Breach Sim: ACTIVE" : "Simulate Bucket Breach"}
          </button>
        </div>
      </div>

      {/* 3-Column Live Pipeline */}
      <div class="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 1. Your Device (Plaintext) */}
        <div class="rounded-2xl border border-[#D8D3C9] bg-[#EAE6DE]/60 p-5 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="font-mono text-[11px] font-bold uppercase tracking-wider text-[#226192]">
                01 · Your Device (WASM)
              </span>
              <span class="rounded-full bg-[#226192]/10 px-2.5 py-0.5 font-mono text-[10px] text-[#226192]">
                Plaintext
              </span>
            </div>

            <label class="block mt-4">
              <span class="font-mono text-[10px] uppercase tracking-wider text-[#55616D]">Subject</span>
              <input
                type="text"
                value={subject()}
                onInput={(e) => setSubject(e.currentTarget.value)}
                class="mt-1 w-full rounded-xl border border-[#D8D3C9] bg-[#F6F3ED] px-3 py-2 text-sm font-medium text-[#18212A] focus:outline-none focus:border-[#226192]"
              />
            </label>

            <label class="block mt-3">
              <span class="font-mono text-[10px] uppercase tracking-wider text-[#55616D]">Body</span>
              <textarea
                rows={3}
                value={body()}
                onInput={(e) => setBody(e.currentTarget.value)}
                class="mt-1 w-full rounded-xl border border-[#D8D3C9] bg-[#F6F3ED] px-3 py-2 text-xs text-[#18212A] leading-relaxed focus:outline-none focus:border-[#226192]"
              />
            </label>
          </div>

          <div class="mt-4 pt-3 border-t border-[#D8D3C9] font-mono text-[11px] text-[#55616D]">
            Key custody: <strong class="text-[#18212A]">Browser memory only</strong>
          </div>
        </div>

        {/* 2. BYOS Routing Server */}
        <div class="rounded-2xl border border-[#D8D3C9] bg-[#0B131B] text-[#EAE6DE] p-5 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between">
              <span class="font-mono text-[11px] font-bold uppercase tracking-wider text-[#EF8557]">
                02 · BYOS Routing Server
              </span>
              <span class="rounded-full bg-[#EF8557]/15 px-2.5 py-0.5 font-mono text-[10px] text-[#EF8557]">
                Blind Relay
              </span>
            </div>

            <div class="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-3.5 font-mono text-[11px] space-y-1.5 leading-relaxed">
              <div>
                <span class="text-[#EAE6DE]/50">from:</span> ceo@company.com
              </div>
              <div>
                <span class="text-[#EAE6DE]/50">to:</span> board@company.com
              </div>
              <div class="truncate">
                <span class="text-[#EAE6DE]/50">message_id:</span> {envelope().msgId}
              </div>
              <div class="pt-1 text-[#EF8557]">
                subject: [SEALED IN ENVELOPE]
              </div>
              <div class="text-[#EF8557]">
                body: [ZERO ACCESS]
              </div>
            </div>
          </div>

          <div class="mt-4 pt-3 border-t border-white/10 font-mono text-[11px] text-[#EAE6DE]/60">
            Reads threading headers only — never content.
          </div>
        </div>

        {/* 3. Your Storage Bucket */}
        <div
          class={`rounded-2xl border p-5 flex flex-col justify-between transition-all duration-300 ${
            breachMode()
              ? "border-[#EF8557] bg-[#0B131B] text-[#EAE6DE] shadow-[0_18px_40px_-14px_rgba(239,133,87,0.35)]"
              : "border-[#226192]/40 bg-[#E2E7EB]/65 text-[#18212A]"
          }`}
        >
          <div>
            <div class="flex items-center justify-between">
              <span
                class={`font-mono text-[11px] font-bold uppercase tracking-wider ${
                  breachMode() ? "text-[#EF8557]" : "text-[#226192]"
                }`}
              >
                03 · Your Bucket (S3 / R2)
              </span>
              <span
                class={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold ${
                  breachMode()
                    ? "bg-[#EF8557] text-[#0B131B]"
                    : "bg-[#226192] text-[#EAE6DE]"
                }`}
              >
                {breachMode() ? "Attacker View" : "X-Wing + AES-256"}
              </span>
            </div>

            <div
              class={`mt-4 rounded-xl border p-3.5 font-mono text-[11px] break-all leading-relaxed ${
                breachMode()
                  ? "border-[#EF8557]/35 bg-black/40 text-[#EF8557]"
                  : "border-[#226192]/20 bg-[#F6F3ED] text-[#18212A]"
              }`}
            >
              <div class="opacity-60 mb-1">{"// CryptoEnvelope v1 (X-Wing-Draft02-AES256GCM)"}</div>
              <div>kem_ct: 0x{envelope().kemHex}…</div>
              <div class="mt-1">ciphertext: 0x{envelope().cipherHex}…</div>
            </div>
          </div>

          <div
            class={`mt-4 pt-3 border-t font-mono text-[11px] ${
              breachMode()
                ? "border-white/10 text-[#EAE6DE]/80"
                : "border-[#226192]/20 text-[#55616D]"
            }`}
          >
            {breachMode()
              ? "Result: 0 bytes of plaintext recoverable without your device key."
              : "Stored in your own cloud account at raw commodity cost."}
          </div>
        </div>
      </div>
    </div>
  );
}
