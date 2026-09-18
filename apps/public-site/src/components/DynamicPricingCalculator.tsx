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
  redirectUrl?: string;
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

  function normalizeSeats(val: number): number {
    if (!Number.isFinite(val) || isNaN(val)) return minLimit();
    return Math.min(Math.max(minLimit(), Math.floor(val)), maxLimit());
  }

  const breakdown = createMemo(() => calculateGraduatedPricing(seats(), billingCycle()));

  createEffect(
    on(
      seats,
      (s) => {
        if (props.onSeatsChange) {
          props.onSeatsChange(s, breakdown());
        }
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      billingCycle,
      (c) => {
        if (props.onCycleChange) {
          props.onCycleChange(c, breakdown());
        }
      },
      { defer: true }
    )
  );

  function handleSliderChange(val: number) {
    const clamped = normalizeSeats(val);
    setSeats(clamped);
    setInputValue(String(clamped));
  }

  function handleInputChange(val: string) {
    setInputValue(val);
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed >= minLimit() && parsed <= maxLimit()) {
      setSeats(parsed);
    }
  }

  function handleInputBlur() {
    const parsed = parseInt(inputValue(), 10);
    const clamped = normalizeSeats(parsed);
    setSeats(clamped);
    setInputValue(String(clamped));
  }

  async function handleCta() {
    if (props.onCtaClick) {
      props.onCtaClick(seats(), breakdown());
      return;
    }
    if (props.redirectUrl) {
      if (typeof window !== "undefined") {
        try {
          const parsed = new URL(props.redirectUrl, window.location.origin);
          if (parsed.protocol === "http:" || parsed.protocol === "https:") {
            window.location.href = parsed.href;
          }
        } catch {
          // Invalid URL safely rejected
        }
      }
      return;
    }

    const envCpUrl =
      (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL ||
      "http://127.0.0.1:3000";
    const envApiUrl =
      (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_API_URL || "";

    let isLoggedIn = false;
    try {
      const res = await fetch(`${envApiUrl}/v1/auth/me`, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object" && typeof data.id === "string" && data.id.trim().length > 0) {
          isLoggedIn = true;
        }
      }
    } catch {
      // not logged in
    }

    const query = `seats=${seats()}&billing_cycle=${billingCycle()}`;
    const targetUrl = isLoggedIn
      ? `${envCpUrl}/onboarding/pricing?${query}`
      : `${envCpUrl}/login?redirect=${encodeURIComponent(`/onboarding/pricing?${query}`)}`;

    if (typeof window !== "undefined") {
      window.location.href = targetUrl;
    }
  }

  const presets = [10, 25, 50, 100, 250];

  return (
    <div
      class={`w-full rounded-3xl bg-white border border-[#E2DFD8] shadow-lg ${
        props.compact ? "p-5 space-y-4" : "p-6 sm:p-10 space-y-8"
      }`}
    >
      <div class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div class="flex items-center gap-2">
              <span class="inline-block w-2.5 h-2.5 rounded-full bg-[#9E725F] animate-pulse" />
              <h3 class="text-xl sm:text-2xl font-extrabold text-[#242424] tracking-tight">
                Infrastructure Capacity Provisioning
              </h3>
            </div>
            <p class="text-xs sm:text-sm text-[#6E6E6E] mt-1">
              Select your required sovereign mailbox capacity. Unit pricing scales dynamically with automatic ~5% compounding volume brackets.
            </p>
          </div>

          <div class="flex items-center gap-2.5 self-start sm:self-auto bg-[#F0EEE9] border border-[#D1C4B8] rounded-2xl px-4 py-2 shadow-xs">
            <label for="seat-input-pub" class="text-xs font-bold text-[#4A4A4A] uppercase tracking-wider">
              Mailboxes:
            </label>
            <input
              id="seat-input-pub"
              type="number"
              min={minLimit()}
              max="9999"
              value={inputValue()}
              onInput={(e) => handleInputChange(e.currentTarget.value)}
              onChange={() => handleInputBlur()}
              onBlur={handleInputBlur}
              class="w-24 bg-white font-mono font-extrabold text-center text-base text-[#242424] rounded-xl border border-[#D1C4B8] py-1.5 px-2 focus:border-[#A47764] focus:ring-2 focus:ring-[#A47764]/20 focus:outline-none transition-all"
            />
            <span class="text-xs font-semibold text-[#6E6E6E]">Seats</span>
          </div>
        </div>

        {/* UI: Pill-shaped Billing Cycle Toggle Switch */}
        <div class="flex items-center justify-center pt-2">
          <div class="inline-flex p-1 bg-[#F0EEE9] border border-[#D1C4B8] rounded-full text-xs sm:text-sm font-semibold shadow-xs">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              class={`px-5 py-2 rounded-full transition-all cursor-pointer ${
                billingCycle() === "monthly"
                  ? "bg-white text-[#242424] shadow-xs font-bold"
                  : "text-[#6E6E6E] hover:text-[#242424]"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("annual")}
              class={`px-5 py-2 rounded-full transition-all flex items-center gap-2 cursor-pointer ${
                billingCycle() === "annual"
                  ? "bg-[#9E725F] text-white shadow-xs font-bold"
                  : "text-[#6E6E6E] hover:text-[#242424]"
              }`}
            >
              <span>Annual</span>
              <span
                class={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  billingCycle() === "annual" ? "bg-white text-[#9E725F]" : "bg-[#9E725F]/15 text-[#9E725F]"
                }`}
              >
                2 Months Free
              </span>
            </button>
          </div>
        </div>

        <div class="space-y-3 pt-2">
          <div class="relative">
            <input
              type="range"
              min={minLimit()}
              max={maxLimit()}
              step="1"
              value={seats() > maxLimit() ? maxLimit() : seats()}
              onInput={(e) => handleSliderChange(parseInt(e.currentTarget.value, 10))}
              onChange={(e) => handleSliderChange(parseInt(e.currentTarget.value, 10))}
              class="w-full h-3 bg-[#EAE3DB] rounded-lg appearance-none cursor-pointer accent-[#9E725F] focus:outline-none"
            />
          </div>

          <div class="flex items-center justify-between pt-1">
            <span class="text-xs font-mono text-stone-500">Quick Capacity Presets:</span>
            <div class="flex flex-wrap gap-2">
              <For each={presets}>
                {(preset) => (
                  <button
                    type="button"
                    onClick={() => {
                      setSeats(preset);
                      setInputValue(String(preset));
                    }}
                    class={`px-3 py-1 rounded-full text-xs font-mono transition-colors cursor-pointer border ${
                      seats() === preset
                        ? "bg-[#9E725F] text-white border-[#9E725F] font-bold shadow-xs"
                        : "bg-[#FAF8F5] text-[#4A4A4A] border-[#D1C4B8] hover:border-[#9E725F] hover:text-[#242424]"
                    }`}
                  >
                    {preset} Seats
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic Waterfall Receipt */}
      <div class="space-y-3.5 pt-4 border-t border-[#E2DFD8]">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <svg class="w-4 h-4 text-[#9E725F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span class="text-xs font-bold uppercase tracking-wider text-[#242424]">
              Dynamic Waterfall Receipt
            </span>
          </div>
          <span class="text-xs font-mono text-[#6E6E6E]">
            {breakdown().lines.length} Tier{breakdown().lines.length === 1 ? "" : "s"} Unlocked
          </span>
        </div>

        <div class="overflow-hidden rounded-2xl border border-[#D1C4B8] bg-[#FAF8F5]">
          <table class="w-full text-left text-xs sm:text-sm border-collapse">
            <thead>
              <tr class="border-b border-[#D1C4B8] bg-[#EAE3DB] text-xs font-semibold text-[#4A4A4A] uppercase tracking-wider">
                <th class="py-3 px-4 sm:px-6">Volume Bracket</th>
                <th class="py-3 px-3 text-center">Allocated</th>
                <th class="py-3 px-3 text-center">Unit Rate</th>
                <th class="py-3 px-4 sm:px-6 text-right">
                  {billingCycle() === "annual" ? "Subtotal (Mo. Eq.)" : "Subtotal"}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#D1C4B8]/60 font-mono text-xs sm:text-sm">
              <For each={breakdown().lines}>
                {(line) => (
                  <tr class="hover:bg-white/70 transition-colors">
                    <td class="py-3.5 px-4 sm:px-6 font-sans">
                      <div class="font-bold text-[#242424] flex items-center gap-2 flex-wrap">
                        <span>{line.name}</span>
                        <span class="text-xs font-mono text-[#6E6E6E]">({line.rangeLabel})</span>
                        <Show when={line.discountBadge}>
                          <span class="bg-emerald-100 text-emerald-800 border border-emerald-300 text-[11px] font-mono font-bold px-2 py-0.5 rounded-full">
                            {line.discountBadge}
                          </span>
                        </Show>
                      </div>
                    </td>
                    <td class="py-3.5 px-3 text-center text-[#4A4A4A] font-medium">
                      {line.seatsInTier} {line.seatsInTier === 1 ? "seat" : "seats"}
                    </td>
                    <td class="py-3.5 px-3 text-center text-[#4A4A4A] font-medium">
                      ${line.unitRate.toFixed(2)}/mo
                    </td>
                    <td class="py-3.5 px-4 sm:px-6 text-right font-extrabold text-[#242424]">
                      <Show
                        when={billingCycle() === "annual"}
                        fallback={<span>${line.cost.toFixed(2)}</span>}
                      >
                        <div>
                          <span>${line.monthlyEquivalentCost.toFixed(2)}/mo</span>
                          <span class="block text-[11px] font-mono text-stone-400 font-normal">
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
        <div class="rounded-2xl bg-[#F0EEE9] border border-[#D1C4B8] p-4 text-xs sm:text-sm">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 text-[#242424]">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#9E725F]/20 text-[#9E725F] text-xs font-bold">✓</span>
              <span>
                <strong class="font-bold text-[#242424]">{breakdown().resourceLimits.maxDomains} Custom Domains Included</strong>
                <span class="text-stone-500 font-mono text-xs ml-1.5">(+${breakdown().resourceLimits.extraDomainPriceMonthly.toFixed(2)}/mo per extra domain)</span>
              </span>
            </div>
            <div class="flex items-center gap-2.5 text-[#242424]">
              <span class="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#9E725F]/20 text-[#9E725F] text-xs font-bold">✓</span>
              <span>
                <strong class="font-bold text-[#242424]">{breakdown().resourceLimits.maxAliases.toLocaleString()} Email Aliases</strong>
                <span class="text-stone-500 font-mono text-xs ml-1.5">({seats()} × 10)</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Highly Visible Annual Savings Success Banner */}
      <Show when={billingCycle() === "annual"}>
        <div class="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div class="flex items-center gap-2 text-emerald-950 text-xs sm:text-sm font-bold">
            <span>🎉 You are saving ${breakdown().annualSavings.toFixed(2)} per year</span>
          </div>
          <span class="text-xs font-mono text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1 rounded-full font-bold self-start sm:self-auto">
            2 Months Free Included (12 mos for price of 10)
          </span>
        </div>
      </Show>

      {/* Summary KPI Cards */}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        <div class="p-5 rounded-2xl bg-[#EAE3DB] border border-[#D1C4B8] flex items-center justify-between">
          <div>
            <span class="block text-xs uppercase tracking-wider text-[#4A4A4A] font-bold">
              Effective Blended Rate
            </span>
            <span class="text-xs text-[#6E6E6E]">
              {billingCycle() === "annual" ? "Annualized weighted average / box" : "Weighted average / mailbox"}
            </span>
          </div>
          <div class="text-right">
            <span class="text-2xl sm:text-3xl font-extrabold font-mono text-[#9E725F]">
              ${breakdown().blendedRate.toFixed(2)}
            </span>
            <span class="text-xs text-[#4A4A4A] font-mono"> /box/mo</span>
          </div>
        </div>

        <div class="p-5 rounded-2xl bg-[#9E725F]/15 border-2 border-[#9E725F] flex items-center justify-between">
          <div>
            <span class="block text-xs uppercase tracking-wider text-[#9E725F] font-extrabold">
              {billingCycle() === "annual" ? "Total Upfront Cost" : "Total Monthly Cost"}
            </span>
            <span class="text-xs text-[#4A4A4A]">
              {billingCycle() === "annual"
                ? `(Equivalent to $${breakdown().totalMonthlyCost.toFixed(2)} / month)`
                : `${seats()} total seats provisioned`}
            </span>
          </div>
          <div class="text-right">
            <span class="text-3xl sm:text-4xl font-extrabold font-mono text-[#242424]">
              ${breakdown().totalAmount.toFixed(2)}
            </span>
            <span class="text-xs text-[#4A4A4A] font-mono">
              {billingCycle() === "annual" ? " / year" : " / month"}
            </span>
          </div>
        </div>
      </div>

      {/* CTA Button */}
      <div class="pt-2">
        <button
          type="button"
          onClick={handleCta}
          class="w-full py-4 px-6 rounded-2xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-sm sm:text-base font-bold shadow-lg shadow-[#9E725F]/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <span>{props.ctaText || `Deploy Infrastructure Capacity with ${seats()} Mailboxes`}</span>
          <span>→</span>
        </button>
        <p class="text-center text-[11px] text-[#6E6E6E] mt-2">
          Zero markup on storage. Connect any S3/MinIO backend. Client-Side RFC 9180 HPKE Cryptography included.
        </p>
      </div>
    </div>
  );
};

export default DynamicPricingCalculator;
