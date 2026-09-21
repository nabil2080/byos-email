import { createSignal, createMemo, For, Show } from "solid-js";
import {
  calculateGraduatedPricing,
  TIER_BRACKETS,
  type BillingCycle,
} from "../../lib/pricing_math";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const presets = [10, 25, 50, 100];

export function SeatCalculator() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const [seats, setSeats] = createSignal(25);
  const [cycle, setCycle] = createSignal<BillingCycle>("monthly");

  const pricing = createMemo(() => calculateGraduatedPricing(seats(), cycle()));

  const primary = createMemo(() => {
    const p = pricing();
    return cycle() === "annual" ? p.annualTotal : p.baseMonthlyTotal;
  });

  return (
    <div class="grid lg:grid-cols-[0.95fr_1.05fr] gap-6 lg:gap-8 items-stretch">
      {/* Controls */}
      <div class="card-editorial p-6 sm:p-8 flex flex-col">
        <div class="flex items-baseline justify-between">
          <div>
            <span class="eyebrow">Team size</span>
            <div class="mt-2 flex items-end gap-2">
              <span class="font-display text-5xl font-extrabold text-[#2B2C2D] tabular-nums">
                {seats()}
              </span>
              <span class="text-sm text-[#6F7173] mb-1.5">seats</span>
            </div>
          </div>

          {/* Billing toggle */}
          <div
            class="inline-flex rounded-full border border-[#E2DFD8] bg-[#F3ECE8] p-1"
            role="group"
            aria-label="Billing cycle"
          >
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              class={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                cycle() === "monthly" ? "bg-[#9E725F] text-white shadow-xs" : "text-[#6F7173]"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle("annual")}
              class={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                cycle() === "annual" ? "bg-[#9E725F] text-white shadow-xs" : "text-[#6F7173]"
              }`}
            >
              Annual
            </button>
          </div>
        </div>

        <div class="mt-7">
          <input
            type="range"
            min="1"
            max="250"
            value={seats()}
            onInput={(e) => setSeats(parseInt(e.currentTarget.value, 10))}
            class="seat-slider w-full"
            aria-label="Number of seats"
          />
          <div class="mt-3 flex items-center justify-between text-[11px] font-mono text-[#6F7173]">
            <span>1</span>
            <span>250+</span>
          </div>
        </div>

        <div class="mt-6 flex flex-wrap gap-2">
          <For each={presets}>
            {(p) => (
              <button
                type="button"
                onClick={() => setSeats(p)}
                class={`px-3.5 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                  seats() === p
                    ? "border-[#9E725F] bg-[#9E725F] text-white"
                    : "border-[#E2DFD8] bg-white text-[#3C3D3E] hover:border-[#9E725F]/40"
                }`}
              >
                {p} seats
              </button>
            )}
          </For>
        </div>

        <p class="mt-auto pt-7 text-xs leading-relaxed text-[#6F7173]">
          Pricing is graduated and marginal: each seat is charged at the rate for the bracket it
          falls into, so your rate improves as you grow rather than jumping between plans.
        </p>
      </div>

      {/* Summary */}
      <div class="rounded-[18px] bg-[#3C3D3E] text-[#F0EEE9] p-6 sm:p-8 flex flex-col">
        <div class="flex items-baseline justify-between">
          <span class="text-[11px] font-mono uppercase tracking-[0.2em] text-[#F0EEE9]/60">
            {cycle() === "annual" ? "Billed annually" : "Billed monthly"}
          </span>
          <Show when={cycle() === "annual"}>
            <span class="rounded-full bg-[#9E725F] px-2.5 py-1 text-[10px] font-semibold text-white">
              10 months upfront
            </span>
          </Show>
        </div>

        <div class="mt-3 flex items-end gap-2">
          <span class="font-display text-5xl sm:text-6xl font-extrabold tabular-nums">
            ${fmt(primary())}
          </span>
          <span class="mb-2 text-sm text-[#F0EEE9]/60">
            {cycle() === "annual" ? "/ year" : "/ month"}
          </span>
        </div>

        <div class="mt-1 text-sm text-[#F0EEE9]/70">
          <Show
            when={cycle() === "annual"}
            fallback={<span>${fmt(pricing().blendedRate)} blended per seat / month</span>}
          >
            <span>
              ${fmt(pricing().totalMonthlyCost)} / month equivalent &middot; two months included
            </span>
          </Show>
        </div>

        {/* Bracket waterfall */}
        <div class="mt-6 rounded-[14px] border border-white/10 bg-white/5 divide-y divide-white/10">
          <For each={pricing().lines}>
            {(line) => (
              <div class="flex items-center justify-between px-4 py-2.5 text-sm">
                <div class="flex flex-col">
                  <span class="text-[#F0EEE9]/90">{line.rangeLabel}</span>
                  <span class="text-[11px] font-mono text-[#F0EEE9]/50">
                    {line.seatsInTier} &times; ${line.unitRate.toFixed(2)}
                  </span>
                </div>
                <span class="tabular-nums text-[#F0EEE9]/90">${fmt(line.cost)}/mo</span>
              </div>
            )}
          </For>
        </div>

        <div class="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div class="rounded-[12px] border border-white/10 bg-white/5 px-4 py-3">
            <div class="text-[11px] font-mono uppercase tracking-widest text-[#F0EEE9]/50">
              Domains
            </div>
            <div class="mt-1 font-semibold">{pricing().resourceLimits.maxDomains} included</div>
          </div>
          <div class="rounded-[12px] border border-white/10 bg-white/5 px-4 py-3">
            <div class="text-[11px] font-mono uppercase tracking-widest text-[#F0EEE9]/50">
              Aliases
            </div>
            <div class="mt-1 font-semibold">{pricing().resourceLimits.maxAliases} included</div>
          </div>
        </div>

        <a
          href={`${cpUrl()}/register`}
          class="mt-6 inline-flex items-center justify-center rounded-[10px] bg-[#9E725F] px-6 py-3.5 text-sm font-semibold text-white transition-all hover:bg-[#865E4D]"
        >
          Get Started with {seats()} seats
        </a>
      </div>
    </div>
  );
}
