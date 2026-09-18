import { Component, createSignal } from "solid-js";
import { calculateGraduatedPricing } from "../../lib/pricing_math";

export const CostCalculator: Component = () => {
  const [mailboxCount, setMailboxCount] = createSignal(25);

  // Traditional SaaS: $10 / user / month (avg Google Workspace Business Standard / Microsoft 365)
  const legacyMonthlyCost = () => mailboxCount() * 10;
  const legacyAnnualCost = () => legacyMonthlyCost() * 12;

  // BYOS Graduated Capacity pricing with 5% compounding step-down brackets
  const byosMonthlyCost = () => {
    return calculateGraduatedPricing(mailboxCount()).totalMonthlyCost;
  };

  const byosStorageEstMonthly = () => {
    // Approx 2 GB per active business mailbox on R2/S3 @ $0.015/GB
    return Math.max(1, Math.round(mailboxCount() * 2 * 0.015));
  };

  const byosTotalMonthly = () => byosMonthlyCost() + byosStorageEstMonthly();
  const byosAnnualCost = () => byosTotalMonthly() * 12;

  const annualSavings = () => Math.max(0, legacyAnnualCost() - byosAnnualCost());
  const percentSaved = () =>
    Math.round((annualSavings() / (legacyAnnualCost() || 1)) * 100);

  const cpBase = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };
  const apiBase = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_API_URL;
    return envUrl ?? "";
  };

  async function handleCtaClick(e: MouseEvent) {
    e.preventDefault();
    let isLoggedIn = false;
    try {
      const res = await fetch(`${apiBase()}/v1/auth/me`, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.id) {
          isLoggedIn = true;
        }
      }
    } catch {}

    const query = `seats=${mailboxCount()}`;
    const targetUrl = isLoggedIn
      ? `${cpBase()}/onboarding/pricing?${query}`
      : `${cpBase()}/login?${query}`;
    if (typeof window !== "undefined") {
      window.location.href = targetUrl;
    }
  }

  return (
    <div class="bg-white rounded-3xl border border-[#E2DFD8] shadow-sm p-6 sm:p-10 space-y-8">
      {/* Header */}
      <div class="text-center max-w-xl mx-auto">
        <span class="text-xs uppercase tracking-widest font-mono text-[#9E725F] font-bold">
          Transparent Capacity Economics
        </span>
        <h3 class="text-2xl sm:text-3xl font-bold text-[#3C3D3E] mt-1.5">
          See How Much You Save on BYOS
        </h3>
        <p class="text-xs sm:text-sm text-[#6F7173] mt-2">
          Legacy email suites charge exponential per-seat fees that punish company growth. BYOS charges raw infrastructure capacity with compounding volume discounts.
        </p>
      </div>

      {/* Slider Controls */}
      <div class="max-w-xl mx-auto space-y-3">
        <div class="flex items-center justify-between">
          <label class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
            Number of Organization Mailboxes
          </label>
          <span class="text-lg font-mono font-bold text-[#9E725F] bg-[#F3ECE8] px-3 py-1 rounded-xl">
            {mailboxCount()} {mailboxCount() === 1 ? "Mailbox" : "Mailboxes"}
          </span>
        </div>

        <input
          type="range"
          min={1}
          max={200}
          value={mailboxCount()}
          onInput={(e) => setMailboxCount(parseInt(e.currentTarget.value, 10))}
          class="w-full h-2.5 bg-[#F0EEE9] rounded-lg appearance-none cursor-pointer accent-[#9E725F]"
        />

        <div class="flex justify-between text-[11px] font-mono text-[#6F7173]">
          <span>1 Solo</span>
          <button
            type="button"
            onClick={() => setMailboxCount(10)}
            class="hover:text-[#9E725F] underline cursor-pointer"
          >
            10 seats
          </button>
          <button
            type="button"
            onClick={() => setMailboxCount(25)}
            class="hover:text-[#9E725F] underline cursor-pointer"
          >
            25 seats
          </button>
          <button
            type="button"
            onClick={() => setMailboxCount(50)}
            class="hover:text-[#9E725F] underline cursor-pointer"
          >
            50 seats
          </button>
          <button
            type="button"
            onClick={() => setMailboxCount(100)}
            class="hover:text-[#9E725F] underline cursor-pointer"
          >
            100 seats
          </button>
          <span>200 Org</span>
        </div>
      </div>

      {/* Comparison Grid */}
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto pt-2">
        {/* Legacy SaaS Box */}
        <div class="p-6 rounded-2xl border border-rose-200 bg-rose-50/40 space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-rose-800 font-mono">
              Traditional SaaS (Google / M365)
            </span>
            <span class="text-xs text-rose-600 font-medium">Per-Seat Tax</span>
          </div>

          <div>
            <div class="text-3xl font-bold text-[#3C3D3E]">
              ${legacyMonthlyCost().toLocaleString()}
              <span class="text-xs font-normal text-[#6F7173]"> / month</span>
            </div>
            <div class="text-xs text-[#6F7173] font-mono mt-1">
              ${legacyAnnualCost().toLocaleString()} per year ($10.00 / user / mo)
            </div>
          </div>

          <ul class="text-xs text-[#6F7173] space-y-2 pt-2 border-t border-rose-200/60">
            <li class="flex items-center gap-2 text-rose-900">
              <span>✕</span> Proprietary storage lock-in
            </li>
            <li class="flex items-center gap-2 text-rose-900">
              <span>✕</span> Plaintext scanned for advertising / training
            </li>
            <li class="flex items-center gap-2 text-rose-900">
              <span>✕</span> Adding a teammate immediately increases bill
            </li>
          </ul>
        </div>

        {/* BYOS Box */}
        <div class="p-6 rounded-2xl border-2 border-[#9E725F] bg-[#F3ECE8]/40 space-y-4 relative shadow-sm">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-[#9E725F] font-mono">
              BYOS Sovereign Email
            </span>
            <span class="text-[11px] font-bold bg-[#9E725F] text-white px-2 py-0.5 rounded-full font-mono">
              SAVE {percentSaved()}%
            </span>
          </div>

          <div>
            <div class="text-3xl font-bold text-[#3C3D3E]">
              ${byosTotalMonthly().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span class="text-xs font-normal text-[#6F7173]"> / month</span>
            </div>
            <div class="text-xs text-[#6F7173] font-mono mt-1">
              ${byosAnnualCost().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per year (${byosMonthlyCost().toFixed(2)}/mo capacity + ~${byosStorageEstMonthly().toFixed(2)}/mo storage)
            </div>
          </div>

          <ul class="text-xs text-[#3C3D3E] space-y-2 pt-2 border-t border-[#E2DFD8]">
            <li class="flex items-center gap-2 text-emerald-800 font-medium">
              <span>✓</span> Zero storage markup (S3 / R2 / MinIO)
            </li>
            <li class="flex items-center gap-2 text-emerald-800 font-medium">
              <span>✓</span> Client-side sealed zero-knowledge encryption
            </li>
            <li class="flex items-center gap-2 text-emerald-800 font-medium">
              <span>✓</span> Fluid graduated capacity with volume discounts
            </li>
          </ul>
        </div>
      </div>

      {/* Big Annual Savings Banner */}
      <div class="max-w-2xl mx-auto p-5 rounded-2xl bg-[#9E725F] text-white text-center flex flex-col sm:flex-row items-center justify-between gap-4 shadow-md">
        <div class="text-left">
          <div class="text-xs uppercase tracking-wider font-mono opacity-90">
            Estimated Annual Savings
          </div>
          <div class="text-2xl sm:text-3xl font-black tracking-tight">
            ${annualSavings().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / year
          </div>
        </div>

        <a
          href={`${cpBase()}/login?seats=${mailboxCount()}`}
          onClick={handleCtaClick}
          class="px-5 py-2.5 rounded-xl bg-white text-[#9E725F] text-xs font-bold hover:bg-[#F0EEE9] transition shadow-xs whitespace-nowrap cursor-pointer"
        >
          Claim Your Savings →
        </a>
      </div>
    </div>
  );
};
