import { createSignal, createMemo } from "solid-js";
import { calculateGraduatedPricing, type BillingCycle } from "../../lib/pricing_math";

const CLOUD_RATES = [
  { id: "r2", label: "Cloudflare R2", ratePerGb: 0.015, note: "$0.00 egress" },
  { id: "s3", label: "Amazon S3", ratePerGb: 0.023, note: "Standard tier" },
  { id: "b2", label: "Backblaze B2", ratePerGb: 0.006, note: "Archive tier" },
  { id: "minio", label: "Self-Hosted MinIO", ratePerGb: 0.0, note: "Your hardware" },
];

export function CfoLedger() {
  const [seats, setSeats] = createSignal(25);
  const [gbPerSeat, setGbPerSeat] = createSignal(15);
  const [cycle, setCycle] = createSignal<BillingCycle>("annual");
  const [cloudIdx, setCloudIdx] = createSignal(0);

  const byos = createMemo(() => calculateGraduatedPricing(seats(), cycle()));
  const cloud = createMemo(() => CLOUD_RATES[cloudIdx()]);

  const totalStorageGb = createMemo(() => seats() * gbPerSeat());
  const rawStorageMonthly = createMemo(() =>
    Math.round(totalStorageGb() * cloud().ratePerGb * 100) / 100
  );
  const byosCombinedMonthly = createMemo(() =>
    Math.round((byos().totalMonthlyCost + rawStorageMonthly()) * 100) / 100
  );
  const byosCombinedAnnual = createMemo(() =>
    Math.round(byosCombinedMonthly() * 12 * 100) / 100
  );

  // Competitor benchmarks (Google Business Standard $14/seat for >30GB or Starter $7.20/seat)
  const googleMonthly = createMemo(() => seats() * (gbPerSeat() > 30 ? 14.0 : 7.2));
  const googleAnnual = createMemo(() => Math.round(googleMonthly() * 12));
  const m365Monthly = createMemo(() => seats() * 6.0);
  const m365Annual = createMemo(() => Math.round(m365Monthly() * 12));

  const annualSavingsVsGoogle = createMemo(() =>
    Math.max(0, Math.round(googleAnnual() - byosCombinedAnnual()))
  );

  return (
    <div class="border border-[#D8D3C9] bg-[#F6F3ED]">
      {/* Top Controls Rail */}
      <div class="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#D8D3C9] border-b border-[#D8D3C9]">
        {/* Col 1-5: Seat Count Slider */}
        <div class="lg:col-span-5 p-6 sm:p-7">
          <div class="flex items-center justify-between font-mono text-xs">
            <span class="text-[#55616D] uppercase tracking-wider">01 // PROVISIONED SEATS</span>
            <span class="font-bold text-lg text-[#18212A]">{seats()} Mailboxes</span>
          </div>
          <input
            type="range"
            min={1}
            max={200}
            value={seats()}
            onInput={(e) => setSeats(parseInt(e.currentTarget.value, 10) || 1)}
            class="seat-slider w-full mt-4"
          />
          <div class="mt-2 flex justify-between font-mono text-[10px] text-[#55616D]">
            <span>1 Seat</span>
            <span>25 Seats</span>
            <span>100 Seats</span>
            <span>200 Seats</span>
          </div>
        </div>

        {/* Col 6-9: Storage Per Seat & Bucket Provider */}
        <div class="lg:col-span-4 p-6 sm:p-7">
          <div class="flex items-center justify-between font-mono text-xs">
            <span class="text-[#55616D] uppercase tracking-wider">02 // STORAGE / SEAT</span>
            <span class="font-bold text-[#226192]">
              {gbPerSeat()} GB ({totalStorageGb()} GB Total)
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={100}
            step={5}
            value={gbPerSeat()}
            onInput={(e) => setGbPerSeat(parseInt(e.currentTarget.value, 10) || 5)}
            class="seat-slider w-full mt-4"
          />
          <div class="mt-3 flex flex-wrap gap-1.5">
            {CLOUD_RATES.map((c, idx) => (
              <button
                type="button"
                onClick={() => setCloudIdx(idx)}
                class={`px-2 py-0.5 font-mono text-[10px] border cursor-pointer transition-colors ${
                  cloudIdx() === idx
                    ? "bg-[#226192] text-[#EAE6DE] border-[#226192]"
                    : "bg-[#EAE6DE] text-[#18212A] border-[#D8D3C9]"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Col 10-12: Billing Cycle Toggle */}
        <div class="lg:col-span-3 p-6 sm:p-7 flex flex-col justify-between bg-[#EAE6DE]/50">
          <div class="font-mono text-xs text-[#55616D] uppercase tracking-wider">
            03 // BILLING CYCLE
          </div>
          <div class="grid grid-cols-2 border border-[#D8D3C9] bg-[#F6F3ED] p-1 mt-3">
            <button
              type="button"
              onClick={() => setCycle("annual")}
              class={`py-1.5 font-mono text-xs cursor-pointer transition-colors ${
                cycle() === "annual"
                  ? "bg-[#0B131B] text-[#EAE6DE] font-bold"
                  : "text-[#55616D]"
              }`}
            >
              Annual (-17%)
            </button>
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              class={`py-1.5 font-mono text-xs cursor-pointer transition-colors ${
                cycle() === "monthly"
                  ? "bg-[#0B131B] text-[#EAE6DE] font-bold"
                  : "text-[#55616D]"
              }`}
            >
              Monthly
            </button>
          </div>
          <div class="mt-2 font-mono text-[10px] text-[#226192]">
            Blended rate: ${byos().blendedRate.toFixed(2)} / seat / mo
          </div>
        </div>
      </div>

      {/* Main Ledger Comparison Table */}
      <div class="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#D8D3C9]">
        {/* Left Col (7): Graduated Bracket Waterfall */}
        <div class="lg:col-span-7 p-6 sm:p-8">
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs font-bold uppercase tracking-wider text-[#226192]">
              BYOS Graduated Capacity Waterfall
            </span>
            <span class="font-mono text-[11px] text-[#55616D]">
              Includes {byos().resourceLimits.maxDomains} custom domains &amp; {byos().resourceLimits.maxAliases} aliases
            </span>
          </div>

          <div class="mt-4 border border-[#D8D3C9] divide-y divide-[#D8D3C9] font-mono text-xs">
            {byos().lines.map((line) => (
              <div class="flex items-center justify-between px-4 py-2.5 bg-[#EAE6DE]/30">
                <div>
                  <span class="font-bold text-[#18212A]">{line.name}</span>{" "}
                  <span class="text-[#55616D]">({line.rangeLabel})</span>
                </div>
                <div class="text-[#18212A]">
                  {line.seatsInTier} &times; ${line.unitRate.toFixed(2)} ={" "}
                  <strong>${line.monthlyEquivalentCost.toFixed(2)}/mo</strong>
                </div>
              </div>
            ))}
            <div class="flex items-center justify-between px-4 py-2.5 bg-[#F6F3ED]">
              <div>
                <span class="font-bold text-[#226192]">Raw Cloud Bucket ({cloud().label})</span>{" "}
                <span class="text-[#55616D]">({totalStorageGb()} GB &times; ${cloud().ratePerGb}/GB)</span>
              </div>
              <div class="font-bold text-[#226192]">
                ${rawStorageMonthly().toFixed(2)}/mo (0% Markup)
              </div>
            </div>
          </div>
        </div>

        {/* Right Col (5): Total Cost & Competitor Delta */}
        <div class="lg:col-span-5 bg-[#0B131B] text-[#EAE6DE] p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between font-mono text-xs">
              <span class="text-[#EF8557] font-bold uppercase tracking-wider">
                TOTAL COMBINED RUN-RATE
              </span>
              <span class="text-[#EAE6DE]/60">{seats()} SEATS + {totalStorageGb()} GB</span>
            </div>

            <div class="mt-4 flex items-baseline gap-2">
              <span class="font-display text-4xl sm:text-5xl font-bold text-[#EAE6DE]">
                ${byosCombinedMonthly().toFixed(2)}
              </span>
              <span class="font-mono text-xs text-[#EAE6DE]/60">/ month combined</span>
            </div>

            <div class="mt-6 space-y-2.5 border-t border-white/10 pt-4 font-mono text-xs">
              <div class="flex justify-between text-[#EAE6DE]/70">
                <span>Google Workspace ({seats()} seats):</span>
                <span>${googleMonthly().toFixed(2)}/mo (${googleAnnual()}/yr)</span>
              </div>
              <div class="flex justify-between text-[#EAE6DE]/70">
                <span>Microsoft 365 ({seats()} seats):</span>
                <span>${m365Monthly().toFixed(2)}/mo (${m365Annual()}/yr)</span>
              </div>
              <div class="flex justify-between text-[#EF8557] font-bold pt-2 border-t border-white/10">
                <span>Estimated Annual Savings:</span>
                <span>Save ${annualSavingsVsGoogle().toLocaleString()} / year</span>
              </div>
            </div>
          </div>

          <div class="mt-6 pt-4 border-t border-white/10 flex items-center justify-between">
            <a href="/signup" class="px-5 py-2.5 btn-primary text-xs font-bold shine-effect">
              Provision {seats()} Seats →
            </a>
            <a href="/pricing" class="font-mono text-xs text-[#EAE6DE]/75 hover:text-[#EF8557] transition-colors">
              Full Pricing Dossier →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
