import { Component, createSignal } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { DynamicPricingCalculator } from "../../components/DynamicPricingCalculator";
import { calculateGraduatedPricing, PricingBreakdown, BillingCycle } from "../../lib/pricing_math";

function getSingleParam(val: string | string[] | undefined, fallback = ""): string {
  if (Array.isArray(val)) return val[0] || fallback;
  return val || fallback;
}

const OnboardingPricingPage: Component = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialSeatsParam = () => {
    const raw = getSingleParam(searchParams.seats);
    const parsed = parseInt(raw, 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : 10;
  };
  const initialCycleParam = (): BillingCycle => {
    const raw = getSingleParam(searchParams.billing_cycle || searchParams.cycle).toLowerCase();
    return raw === "monthly" ? "monthly" : "annual";
  };

  const [seatCount, setSeatCount] = createSignal<number>(initialSeatsParam());
  const [billingCycle, setBillingCycle] = createSignal<BillingCycle>(initialCycleParam());
  const [pricing, setPricing] = createSignal<PricingBreakdown>(
    calculateGraduatedPricing(initialSeatsParam(), initialCycleParam())
  );

  const orgId = () => getSingleParam(searchParams.org_id);

  function handleSeatsChange(seats: number, breakdown: PricingBreakdown) {
    setSeatCount(seats);
    setBillingCycle(breakdown.billingCycle);
    setPricing(breakdown);
  }

  function handleContinue() {
    const targetOrg = orgId();
    const seats = seatCount();
    const cycle = billingCycle();
    const params = new URLSearchParams();
    if (targetOrg) params.set("org_id", targetOrg);
    params.set("seats", String(seats));
    params.set("billing_cycle", cycle);
    navigate(`/onboarding/checkout?${params.toString()}`);
  }

  return (
    <div class="min-h-screen bg-[#F0EEE9] text-[#3C3D3E] py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-4xl mx-auto space-y-8">
        {/* Header */}
        <div class="text-center space-y-3">
          <div class="inline-flex w-12 h-12 rounded-xl bg-[#9E725F] items-center justify-center text-[#F0EEE9] font-mono font-bold text-base shadow-sm">
            BYOS
          </div>
          <div class="inline-block px-3 py-1 rounded-full bg-[#FAF9F6] border border-[#E2DFD8] text-[11px] font-semibold text-[#9E725F] uppercase tracking-wider">
            Step 2 of 3 • Infrastructure Capacity Provisioning
          </div>
          <h1 class="text-2xl sm:text-4xl font-bold tracking-tight text-[#3C3D3E]">
            Provision Sovereign Mailbox Capacity
          </h1>
          <p class="text-xs sm:text-sm text-[#6F7173] max-w-xl mx-auto">
            Your Zero-Knowledge cryptographic keys have been generated and anchored. Provision the exact mailbox fleet scale required by your organization.
          </p>
        </div>

        {/* Dynamic Graduated Pricing Calculator */}
        <div class="pt-2">
          <DynamicPricingCalculator
            initialSeats={initialSeatsParam()}
            initialBillingCycle={initialCycleParam()}
            onSeatsChange={handleSeatsChange}
            onCycleChange={(c, b) => {
              setBillingCycle(c);
              setPricing(b);
            }}
            showCta={false}
          />
        </div>

        {/* Bottom Navigation & Checkout Action */}
        <div class="bg-white border border-[#E2DFD8] rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 class="text-sm font-bold text-[#3C3D3E]">
              Selected Capacity: {seatCount()} Dedicated Mailbox{seatCount() === 1 ? "" : "es"} ({billingCycle() === "annual" ? "Annual" : "Monthly"})
            </h3>
            <p class="text-xs text-[#6F7173] mt-0.5">
              {billingCycle() === "annual" ? (
                <>
                  Total Upfront: <strong class="text-[#9E725F] font-mono">${pricing().totalAmount.toFixed(2)}/yr</strong> (Equivalent to ${pricing().totalMonthlyCost.toFixed(2)}/mo, ${pricing().blendedRate.toFixed(2)} blended)
                </>
              ) : (
                <>
                  Monthly Infrastructure Total: <strong class="text-[#9E725F] font-mono">${pricing().totalMonthlyCost.toFixed(2)}/mo</strong> (${pricing().blendedRate.toFixed(2)} blended/mailbox)
                </>
              )}
            </p>
          </div>

          <div class="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => {
                setSeatCount(1);
                handleContinue();
              }}
              class="px-4 py-2.5 rounded-lg border border-[#E2DFD8] text-xs font-semibold text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#FAF9F6] transition-colors cursor-pointer"
            >
              Start with 1 Mailbox
            </button>
            <button
              type="button"
              onClick={handleContinue}
              class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-bold shadow-sm transition-colors cursor-pointer"
            >
              <span>
                Continue to Checkout with {seatCount()} Seats ({billingCycle() === "annual" ? `$${pricing().totalAmount.toFixed(2)}/yr` : `$${pricing().totalMonthlyCost.toFixed(2)}/mo`})
              </span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OnboardingPricingPage;
