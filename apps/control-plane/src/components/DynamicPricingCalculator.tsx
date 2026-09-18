import { createSignal, createMemo, createEffect, on, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { calculateGraduatedPricing } from "../lib/pricing_math";
import type { PricingBreakdown, BillingCycle } from "../lib/pricing_math";

export interface DynamicPricingCalculatorProps {
  initialSeats?: number;
  initialBillingCycle?: BillingCycle;
  onSeatsChange?: (seats: number, breakdown: PricingBreakdown) => void;
  onCycleChange?: (cycle: BillingCycle, breakdown: PricingBreakdown) => void;
  showCta?: boolean;
  ctaText?: string;
  onCtaClick?: (seats: number, breakdown: PricingBreakdown) => void;
  compact?: boolean;
  minSeats?: number;
  maxSliderSeats?: number;
}

export const DynamicPricingCalculator: Component<DynamicPricingCalculatorProps> = (props) => {
  const minLimit = () => props.minSeats || 1;
  const maxLimit = () => props.maxSliderSeats || 250;

  const [seats, setSeats] = createSignal<number>(props.initialSeats || 10);
  const [inputValue, setInputValue] = createSignal<string>(String(props.initialSeats || 10));
  const [billingCycle, setBillingCycle] = createSignal<BillingCycle>(props.initialBillingCycle || "annual");

  // Sync if initialSeats prop updates externally (strictly defer and track props.initialSeats only)
  createEffect(
    on(
      () => props.initialSeats,
      (newInitial) => {
        if (newInitial !== undefined && newInitial > 0 && newInitial !== seats()) {
          setSeats(newInitial);
          setInputValue(String(newInitial));
        }
      },
      { defer: true }
    )
  );

  // Sync if initialBillingCycle prop updates externally
  createEffect(
    on(
      () => props.initialBillingCycle,
      (newCycle) => {
        if (newCycle && newCycle !== billingCycle()) {
          setBillingCycle(newCycle);
        }
      },
      { defer: true }
    )
  );

  const breakdown = createMemo(() => calculateGraduatedPricing(seats(), billingCycle()));

  createEffect(
    on(
      [seats, billingCycle],
      ([s, c]) => {
        const b = breakdown();
        if (props.onSeatsChange) {
          props.onSeatsChange(s, b);
        }
        if (props.onCycleChange) {
          props.onCycleChange(c, b);
        }
      }
    )
  );

  function handleSliderChange(val: number) {
    const clamped = Math.max(minLimit(), val);
    setSeats(clamped);
    setInputValue(String(clamped));
  }

  function handleInputChange(val: string) {
    setInputValue(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= minLimit()) {
      setSeats(parsed);
    }
  }

  function handleInputBlur() {
    const parsed = parseInt(inputValue(), 10);
    if (isNaN(parsed) || parsed < minLimit()) {
      setSeats(minLimit());
      setInputValue(String(minLimit()));
    } else {
      setSeats(parsed);
      setInputValue(String(parsed));
    }
  }

  const presets = [10, 25, 50, 100, 250];

  return (
    <div
      class={`w-full rounded-2xl bg-white border border-[#E2DFD8] shadow-sm ${
        props.compact ? "p-4 space-y-4" : "p-6 sm:p-8 space-y-6"
      }`}
    >
      {/* Top Header & Interactive Inputs */}
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <span class="inline-block w-2 h-2 rounded-full bg-[#9E725F] animate-pulse" />
              <h3 class={`font-bold text-[#3C3D3E] tracking-tight ${props.compact ? "text-sm" : "text-base sm:text-lg"}`}>
                Infrastructure Capacity Provisioning
              </h3>
            </div>
            <p class="text-xs text-[#6F7173] mt-0.5">
              Fluid graduated pricing with 5% compounding step-down brackets.
            </p>
          </div>

          {/* Synchronized Direct Numeric Input */}
          <div class="flex items-center gap-2 self-start sm:self-auto bg-[#F0EEE9]/80 border border-[#E2DFD8] rounded-xl px-3 py-1.5 shadow-2xs">
            <label for="seat-input" class="text-xs font-semibold text-[#6F7173] uppercase tracking-wider">
              Mailboxes:
            </label>
            <input
              id="seat-input"
              type="number"
              min={minLimit()}
              max="9999"
              value={inputValue()}
              onInput={(e) => handleInputChange(e.currentTarget.value)}
              onChange={() => handleInputBlur()}
              onBlur={handleInputBlur}
              class="w-20 bg-white font-mono font-bold text-center text-sm text-[#3C3D3E] rounded-lg border border-[#E2DFD8] py-1 px-2 focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none transition-all"
            />
            <span class="text-xs font-medium text-stone-500">Seats</span>
          </div>
        </div>

        {/* UI: Pill-shaped Billing Cycle Toggle Switch */}
        <div class="flex items-center justify-center pt-1">
          <div class="inline-flex p-1 bg-[#F0EEE9] border border-[#E2DFD8] rounded-full text-xs font-semibold shadow-2xs">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              class={`px-4 py-1.5 rounded-full transition-all cursor-pointer ${
                billingCycle() === "monthly"
                  ? "bg-white text-[#3C3D3E] shadow-xs font-bold"
                  : "text-[#6F7173] hover:text-[#3C3D3E]"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("annual")}
              class={`px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
                billingCycle() === "annual"
                  ? "bg-[#9E725F] text-white shadow-xs font-bold"
                  : "text-[#6F7173] hover:text-[#3C3D3E]"
              }`}
            >
              <span>Annual</span>
              <span
                class={`text-[10px] px-1.5 py-0.2 rounded-full font-bold uppercase tracking-wider ${
                  billingCycle() === "annual" ? "bg-white text-[#9E725F]" : "bg-[#9E725F]/15 text-[#9E725F]"
                }`}
              >
                2 Months Free
              </span>
            </button>
          </div>
        </div>

        {/* Continuous Horizontal Slider */}
        <div class="space-y-2 pt-2">
          <div class="relative">
            <input
              type="range"
              min={minLimit()}
              max={maxLimit()}
              step="1"
              value={seats() > maxLimit() ? maxLimit() : seats()}
              onInput={(e) => handleSliderChange(parseInt(e.currentTarget.value, 10))}
              onChange={(e) => handleSliderChange(parseInt(e.currentTarget.value, 10))}
              class="w-full h-2.5 bg-[#E2DFD8] rounded-lg appearance-none cursor-pointer accent-[#9E725F] focus:outline-none"
            />
          </div>

          {/* Preset Buttons */}
          <div class="flex items-center justify-between pt-1">
            <span class="text-[11px] font-mono text-stone-400">Presets:</span>
            <div class="flex flex-wrap gap-1.5">
              <For each={presets}>
                {(preset) => (
                  <button
                    type="button"
                    onClick={() => {
                      setSeats(preset);
                      setInputValue(String(preset));
                    }}
                    class={`px-2.5 py-0.5 rounded-full text-xs font-mono transition-colors cursor-pointer border ${
                      seats() === preset
                        ? "bg-[#9E725F] text-white border-[#9E725F] font-bold shadow-2xs"
                        : "bg-[#FAF9F6] text-[#6F7173] border-[#E2DFD8] hover:border-[#9E725F] hover:text-[#3C3D3E]"
                    }`}
                  >
                    {preset}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Waterfall Receipt */}
      <div class="space-y-3 pt-2 border-t border-[#E2DFD8]">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <svg class="w-4 h-4 text-[#9E725F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span class="text-xs font-bold uppercase tracking-wider text-[#3C3D3E]">
              Dynamic Waterfall Receipt
            </span>
          </div>
          <span class="text-[11px] font-mono text-stone-500">
            {breakdown().lines.length} Tier{breakdown().lines.length === 1 ? "" : "s"} Unlocked
          </span>
        </div>

        {/* Unlocked Brackets Table */}
        <div class="overflow-hidden rounded-xl border border-[#E2DFD8] bg-[#FAF9F6]">
          <table class="w-full text-left text-xs border-collapse">
            <thead>
              <tr class="border-b border-[#E2DFD8] bg-[#F0EEE9]/60 text-[11px] font-semibold text-stone-500 uppercase tracking-wider">
                <th class="py-2.5 px-3.5">Bracket / Tier</th>
                <th class="py-2.5 px-3 text-center">Allocated</th>
                <th class="py-2.5 px-3 text-center">Unit Rate</th>
                <th class="py-2.5 px-3 text-right">
                  {billingCycle() === "annual" ? "Subtotal (Mo. Eq.)" : "Subtotal"}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#E2DFD8]/60 font-mono text-xs">
              <For each={breakdown().lines}>
                {(line) => (
                  <tr class="hover:bg-white/60 transition-colors">
                    <td class="py-2.5 px-3.5 font-sans">
                      <div class="font-semibold text-[#3C3D3E] flex items-center gap-1.5 flex-wrap">
                        <span>{line.name}</span>
                        <span class="text-[11px] font-mono text-stone-400">({line.rangeLabel})</span>
                        <Show when={line.discountBadge}>
                          <span class="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full">
                            {line.discountBadge}
                          </span>
                        </Show>
                      </div>
                    </td>
                    <td class="py-2.5 px-3 text-center text-stone-700 font-medium">
                      {line.seatsInTier} {line.seatsInTier === 1 ? "seat" : "seats"}
                    </td>
                    <td class="py-2.5 px-3 text-center text-stone-600 font-medium">
                      ${line.unitRate.toFixed(2)}/mo
                    </td>
                    <td class="py-2.5 px-3 text-right font-bold text-[#3C3D3E]">
                      <Show
                        when={billingCycle() === "annual"}
                        fallback={<span>${line.cost.toFixed(2)}</span>}
                      >
                        <div>
                          <span>${line.monthlyEquivalentCost.toFixed(2)}/mo</span>
                          <span class="block text-[10px] font-mono text-stone-400 font-normal">
                            ${line.annualCost.toFixed(2)}/yr
                          </span>
                        </div>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>

        {/* Reactive Resource Limits Feature Strip */}
        <div class="rounded-xl bg-[#FAF9F6] border border-[#E2DFD8] p-3 text-xs">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div class="flex items-center gap-2 text-[#3C3D3E]">
              <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#9E725F]/15 text-[#9E725F] text-[11px] font-bold">✓</span>
              <span>
                <strong class="font-bold text-[#3C3D3E]">{breakdown().resourceLimits.maxDomains} Custom Domains Included</strong>
                <span class="text-stone-500 font-mono text-[11px] ml-1.5">(+${breakdown().resourceLimits.extraDomainPriceMonthly.toFixed(2)}/mo per extra domain)</span>
              </span>
            </div>
            <div class="flex items-center gap-2 text-[#3C3D3E]">
              <span class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[#9E725F]/15 text-[#9E725F] text-[11px] font-bold">✓</span>
              <span>
                <strong class="font-bold text-[#3C3D3E]">{breakdown().resourceLimits.maxAliases.toLocaleString()} Email Aliases</strong>
                <span class="text-stone-500 font-mono text-[11px] ml-1.5">({seats()} × 10)</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Highly Visible Annual Savings Success Banner */}
      <Show when={billingCycle() === "annual"}>
        <div class="p-3.5 rounded-xl bg-emerald-50/90 border border-emerald-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-emerald-900 text-xs font-bold">
            <span>🎉 You are saving ${breakdown().annualSavings.toFixed(2)} per year</span>
          </div>
          <span class="text-[11px] font-mono text-emerald-800 bg-emerald-100/80 border border-emerald-300/60 px-2.5 py-0.5 rounded-full font-semibold self-start sm:self-auto">
            2 Months Free Included
          </span>
        </div>
      </Show>

      {/* Summary KPI Cards & Blended Rate */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        {/* Blended Rate Card */}
        <div class="p-3.5 rounded-xl bg-[#F0EEE9]/60 border border-[#E2DFD8] flex items-center justify-between">
          <div>
            <span class="block text-[11px] uppercase tracking-wider text-[#6F7173] font-semibold">
              Effective Blended Rate
            </span>
            <span class="text-[10px] text-stone-400">
              {billingCycle() === "annual" ? "Annualized weighted average / box" : "Weighted average / mailbox"}
            </span>
          </div>
          <div class="text-right">
            <span class="text-xl font-bold font-mono text-[#9E725F]">
              ${breakdown().blendedRate.toFixed(2)}
            </span>
            <span class="text-xs text-stone-500 font-mono"> /box/mo</span>
          </div>
        </div>

        {/* Total Cost Card */}
        <div class="p-3.5 rounded-xl bg-[#9E725F]/10 border border-[#9E725F]/30 flex items-center justify-between">
          <div>
            <span class="block text-[11px] uppercase tracking-wider text-[#9E725F] font-bold">
              {billingCycle() === "annual" ? "Total Upfront Cost" : "Total Monthly Cost"}
            </span>
            <span class="text-[10px] text-stone-500">
              {billingCycle() === "annual"
                ? `(Equivalent to $${breakdown().totalMonthlyCost.toFixed(2)} / month)`
                : `${seats()} total seats provisioned`}
            </span>
          </div>
          <div class="text-right">
            <span class="text-2xl font-bold font-mono text-[#3C3D3E]">
              ${breakdown().totalAmount.toFixed(2)}
            </span>
            <span class="text-xs text-stone-500 font-mono">
              {billingCycle() === "annual" ? " / year" : " / month"}
            </span>
          </div>
        </div>
      </div>

      {/* Optional CTA Button */}
      <Show when={props.showCta}>
        <div class="pt-2">
          <button
            type="button"
            onClick={() => {
              if (props.onCtaClick) {
                props.onCtaClick(seats(), breakdown());
              }
            }}
            class="w-full py-3 px-4 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs sm:text-sm font-bold shadow-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <span>{props.ctaText || "Deploy Infrastructure Capacity"}</span>
            <span>→</span>
          </button>
        </div>
      </Show>
    </div>
  );
};

export default DynamicPricingCalculator;

