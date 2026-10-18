import { Component, createResource, createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { useOrg } from "../../context/OrgContext";
import { getBillingInfo, updateSeats, BillingInfo } from "../../lib/api/billing";
import { calculateGraduatedPricing, BillingCycle } from "../../lib/pricing_math";

function getBracketHint(seats: number): string {
  if (seats <= 10) {
    return "You're in the 1–10 seat bracket. Additional seats cost $3.00 each until you reach 10.";
  }
  if (seats <= 25) {
    return "You're in the 11–25 seat bracket. Additional seats cost $2.85 each until you reach 25.";
  }
  if (seats <= 50) {
    return "You're in the 26–50 seat bracket. Additional seats cost $2.71 each until you reach 50.";
  }
  if (seats <= 100) {
    return "You're in the 51–100 seat bracket. Additional seats cost $2.57 each until you reach 100.";
  }
  return "You're in the 101+ seat bracket. Additional seats cost $2.44 each.";
}

const BillingPage: Component = () => {
  const org = useOrg();
  const [billing, { refetch }] = createResource<BillingInfo>(() => (org.orgId ? getBillingInfo(org.orgId) : null!));

  const [seats, setSeats] = createSignal<number>(2);
  const [cycle, setCycle] = createSignal<BillingCycle>("monthly");
  const [isDirty, setIsDirty] = createSignal<boolean>(false);
  const [updating, setUpdating] = createSignal<boolean>(false);
  const [banner, setBanner] = createSignal<{ type: "ok" | "err"; msg: string } | null>(null);

  // Sync initial seat count and billing cycle from server once loaded
  createEffect(() => {
    const info = billing();
    if (info && !isDirty()) {
      const serverSeats = info.seat_count || org.seatCount || 1;
      setSeats(serverSeats);
      if (info.billing_cycle === "annual" || info.billing_cycle === "monthly") {
        setCycle(info.billing_cycle);
      }
    }
  });

  const pricing = createMemo(() => calculateGraduatedPricing(seats(), cycle()));
  const bracketHint = createMemo(() => getBracketHint(seats()));

  const activeMailboxes = createMemo(() => billing()?.used_mailboxes || 1);
  const minSeatsAllowed = createMemo(() => Math.max(1, activeMailboxes()));

  const canDecrement = createMemo(() => seats() > minSeatsAllowed());
  const canSave = createMemo(() => {
    if (!org.isOwner || updating()) return false;
    const currentServerSeats = billing()?.seat_count || org.seatCount;
    return seats() !== currentServerSeats && seats() >= minSeatsAllowed();
  });

  function handleIncrement() {
    setIsDirty(true);
    setSeats((prev) => Math.min(10000, prev + 1));
  }

  function handleDecrement() {
    if (!canDecrement()) return;
    setIsDirty(true);
    setSeats((prev) => Math.max(minSeatsAllowed(), prev - 1));
  }

  function handleSeatInput(val: string) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      setIsDirty(true);
      setSeats(Math.max(1, Math.min(10000, parsed)));
    }
  }

  async function handleSaveChanges() {
    if (!org.orgId || !canSave()) return;
    setUpdating(true);
    setBanner(null);
    try {
      await updateSeats(org.orgId, seats());
      setBanner({
        type: "ok",
        msg: `Organization seat capacity successfully updated to ${seats()} seat${seats() === 1 ? "" : "s"}.`,
      });
      setIsDirty(false);
      refetch();
      org.refetch();
    } catch (err: any) {
      setBanner({
        type: "err",
        msg: err instanceof Error ? err.message : "Failed to update seat count.",
      });
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Billing & Seat Allocation
        </h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Every seat includes zero-knowledge cryptography, customer-controlled persistent storage, and sovereign mail exchange. Pricing follows a graduated per-seat volume bracket.
        </p>
      </div>

      {/* Banner */}
      <Show when={banner()}>
        <div
          id="billing-alert-banner"
          role="alert"
          class={`mb-6 rounded-xl p-4 text-xs border flex items-center justify-between ${
            banner()?.type === "ok"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-red-50 text-red-800 border-red-200"
          }`}
        >
          <span>{banner()?.msg}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            class="ml-4 font-bold text-xs opacity-70 hover:opacity-100"
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      </Show>

      {/* Main Interactive Grid */}
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
        {/* Left Column: Seat Stepper, Cycle Toggle, Price Breakdown */}
        <div class="lg:col-span-7 space-y-6">
          {/* Seat Stepper Card */}
          <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 class="text-base font-bold text-[#3C3D3E]">Provisioned Seats</h2>
                <p class="text-xs text-[#6F7173] mt-0.5">
                  1 mailbox per seat, exact. Scaled sovereign capacity.
                </p>
              </div>

              {/* Cycle Toggle */}
              <div class="inline-flex rounded-lg border border-[#E2DFD8] bg-[#F0EEE9]/60 p-0.5 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setCycle("monthly")}
                  class={`rounded-md px-3 py-1.5 transition-colors ${
                    cycle() === "monthly"
                      ? "bg-white text-[#3C3D3E] shadow-xs"
                      : "text-[#6F7173] hover:text-[#3C3D3E]"
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCycle("annual")}
                  class={`rounded-md px-3 py-1.5 transition-colors ${
                    cycle() === "annual"
                      ? "bg-white text-[#9E725F] shadow-xs"
                      : "text-[#6F7173] hover:text-[#3C3D3E]"
                  }`}
                >
                  Annual (Save 16.7%)
                </button>
              </div>
            </div>

            {/* Stepper Control */}
            <div class="mt-6 flex items-center gap-4">
              <div class="flex items-center rounded-xl border border-[#E2DFD8] bg-white p-1 shadow-xs">
                <button
                  type="button"
                  aria-label="Decrease seat count"
                  disabled={!canDecrement()}
                  onClick={handleDecrement}
                  title={
                    !canDecrement()
                      ? `Deactivate a mailbox before reducing seats below ${minSeatsAllowed()}.`
                      : "Decrease seats"
                  }
                  class={`flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold transition-colors ${
                    canDecrement()
                      ? "bg-[#F0EEE9] text-[#3C3D3E] hover:bg-[#E2DFD8]"
                      : "bg-[#F0EEE9]/50 text-[#6F7173]/40 cursor-not-allowed"
                  }`}
                >
                  −
                </button>

                <input
                  type="number"
                  min={minSeatsAllowed()}
                  max="10000"
                  value={seats()}
                  onInput={(e) => handleSeatInput(e.currentTarget.value)}
                  class="h-10 w-20 text-center font-mono text-xl font-bold text-[#3C3D3E] focus:outline-hidden"
                  aria-label="Seat count input"
                />

                <button
                  type="button"
                  aria-label="Increase seat count"
                  onClick={handleIncrement}
                  class="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F0EEE9] text-lg font-bold text-[#3C3D3E] hover:bg-[#E2DFD8] transition-colors"
                >
                  +
                </button>
              </div>

              <div>
                <span class="text-xl font-bold text-[#3C3D3E]">
                  {seats()} Seat{seats() === 1 ? "" : "s"}
                </span>
                <span class="block text-xs text-[#6F7173]">
                  {activeMailboxes()} currently active
                </span>
              </div>
            </div>

            {/* Bracket Hint */}
            <div class="mt-4 rounded-xl bg-[#F0EEE9]/50 border border-[#E2DFD8]/80 p-3 text-xs text-[#6F7173] flex items-start gap-2">
              <svg
                class="w-4 h-4 text-[#9E725F] shrink-0 mt-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span>{bracketHint()}</span>
            </div>
          </div>

          {/* Pricing Waterfall & Breakdown */}
          <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
            <div class="flex items-center justify-between mb-4 border-b border-[#E2DFD8] pb-3">
              <h2 class="text-sm font-bold uppercase tracking-wider text-[#6F7173]">
                Graduated Cost Breakdown
              </h2>
              <span class="rounded bg-[#F2E8E2] px-2 py-0.5 text-[11px] font-mono font-bold text-[#9E725F]">
                {cycle() === "annual" ? "Annual Billing (2 Mo Free)" : "Monthly Billing"}
              </span>
            </div>

            {/* Waterfall Table */}
            <div class="divide-y divide-[#E2DFD8]/60 text-xs text-[#3C3D3E]">
              <For each={pricing().lines}>
                {(line) => (
                  <div class="py-2.5 flex items-center justify-between">
                    <div>
                      <span class="font-semibold text-[#3C3D3E]">
                        {line.seatsInTier} seat{line.seatsInTier === 1 ? "" : "s"}
                      </span>
                      <span class="text-[#6F7173] mx-1.5">×</span>
                      <span class="font-mono text-[#6F7173]">${line.unitRate.toFixed(2)}</span>
                      <span class="text-[#6F7173] ml-1">({line.rangeLabel})</span>
                    </div>
                    <div class="font-mono font-bold text-[#3C3D3E]">
                      ${line.cost.toFixed(2)}/mo
                    </div>
                  </div>
                )}
              </For>
            </div>

            {/* Summary Totals */}
            <div class="mt-4 border-t border-[#E2DFD8] pt-4 space-y-2 text-xs">
              <div class="flex justify-between text-[#6F7173]">
                <span>Graduated Monthly Subtotal</span>
                <span class="font-mono">${pricing().baseMonthlyTotal.toFixed(2)}/mo</span>
              </div>

              <div class="flex justify-between text-[#6F7173]">
                <span>Zero-Knowledge Sovereign Tax</span>
                <span class="font-mono">$0.00</span>
              </div>

              <Show when={cycle() === "annual"}>
                <div class="flex justify-between text-emerald-700 font-medium bg-emerald-50 rounded-lg p-2 border border-emerald-200/60">
                  <span>Annual Prepay Discount (16.7% / 2 Months Free)</span>
                  <span class="font-mono">-${(pricing().baseMonthlyTotal * 2).toFixed(2)}</span>
                </div>
              </Show>

              <div class="pt-2 border-t border-[#E2DFD8] flex items-baseline justify-between">
                <div>
                  <span class="text-base font-bold text-[#3C3D3E]">
                    {cycle() === "annual" ? "Annual Total" : "Monthly Total"}
                  </span>
                  <Show when={cycle() === "annual"}>
                    <span class="block text-[11px] text-[#6F7173]">
                      Billed once per year (${pricing().totalMonthlyCost.toFixed(2)}/mo effective)
                    </span>
                  </Show>
                </div>
                <div class="text-right">
                  <span class="font-mono text-2xl font-extrabold text-[#3C3D3E]">
                    ${cycle() === "annual" ? pricing().annualTotal.toFixed(2) : pricing().baseMonthlyTotal.toFixed(2)}
                  </span>
                  <span class="text-xs text-[#6F7173] font-medium ml-1">
                    {cycle() === "annual" ? "/year" : "/month"}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Button */}
            <div class="mt-6 pt-4 border-t border-[#E2DFD8]">
              <button
                type="button"
                disabled={!canSave()}
                onClick={handleSaveChanges}
                class={`w-full rounded-xl py-3 text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-2 ${
                  canSave()
                    ? "bg-[#9E725F] text-white hover:bg-[#865E4D]"
                    : "bg-[#F0EEE9] text-[#6F7173] cursor-not-allowed"
                }`}
              >
                <Show when={updating()}>
                  <svg
                    class="animate-spin h-4 w-4 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    />
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8v8H4z"
                    />
                  </svg>
                </Show>
                <span>
                  {updating()
                    ? "Saving Changes…"
                    : !org.isOwner
                    ? "Owner Permissions Required to Alter Seats"
                    : seats() === (billing()?.seat_count || org.seatCount)
                    ? "Current Allocation"
                    : `Update Seat Capacity to ${seats()} Seats`}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Capacity & Resource Quotas */}
        <div class="lg:col-span-5 space-y-6">
          <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
            <h2 class="text-base font-bold text-[#3C3D3E] mb-1">
              Resource Capacity
            </h2>
            <p class="text-xs text-[#6F7173] mb-6">
              Capacity scales deterministically from your provisioned seat count ({seats()}).
            </p>

            <div class="space-y-5">
              {/* Mailboxes */}
              <div>
                <div class="flex items-center justify-between text-xs mb-1.5">
                  <span class="font-semibold text-[#3C3D3E]">Mailboxes</span>
                  <span class="font-mono text-[#6F7173]">
                    {billing()?.used_mailboxes || 0} / {seats()}
                  </span>
                </div>
                <div class="h-2.5 w-full rounded-full bg-[#F0EEE9] overflow-hidden">
                  <div
                    class={`h-full rounded-full transition-all ${
                      (billing()?.used_mailboxes || 0) >= seats()
                        ? "bg-red-500"
                        : (billing()?.used_mailboxes || 0) / seats() >= 0.8
                        ? "bg-amber-500"
                        : "bg-[#9E725F]"
                    }`}
                    style={{
                      width: `${Math.min(100, Math.round(((billing()?.used_mailboxes || 0) / seats()) * 100))}%`,
                    }}
                  />
                </div>
                <span class="text-[11px] text-[#6F7173] mt-1 block">
                  1 mailbox per seat exact
                </span>
              </div>

              {/* Custom Domains */}
              <div>
                <div class="flex items-center justify-between text-xs mb-1.5">
                  <span class="font-semibold text-[#3C3D3E]">Custom Domains</span>
                  <span class="font-mono text-[#6F7173]">
                    {billing()?.used_domains || 0} / {pricing().resourceLimits.maxDomains}
                  </span>
                </div>
                <div class="h-2.5 w-full rounded-full bg-[#F0EEE9] overflow-hidden">
                  <div
                    class="h-full rounded-full bg-[#9E725F] transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((billing()?.used_domains || 0) / pricing().resourceLimits.maxDomains) * 100))}%`,
                    }}
                  />
                </div>
                <span class="text-[11px] text-[#6F7173] mt-1 block">
                  Formula: max(1, ⌈seats / 5⌉)
                </span>
              </div>

              {/* Aliases */}
              <div>
                <div class="flex items-center justify-between text-xs mb-1.5">
                  <span class="font-semibold text-[#3C3D3E]">Masked Aliases</span>
                  <span class="font-mono text-[#6F7173]">
                    {billing()?.used_aliases || 0} / {pricing().resourceLimits.maxAliases}
                  </span>
                </div>
                <div class="h-2.5 w-full rounded-full bg-[#F0EEE9] overflow-hidden">
                  <div
                    class="h-full rounded-full bg-[#9E725F] transition-all"
                    style={{
                      width: `${Math.min(100, Math.round(((billing()?.used_aliases || 0) / pricing().resourceLimits.maxAliases) * 100))}%`,
                    }}
                  />
                </div>
                <span class="text-[11px] text-[#6F7173] mt-1 block">
                  Formula: max(5, seats × 2)
                </span>
              </div>

              {/* Encrypted Storage */}
              <div class="rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 p-3.5 text-xs">
                <div class="flex items-center justify-between font-semibold text-[#3C3D3E]">
                  <span>Persistent Storage</span>
                  <span class="text-[#9E725F] font-bold">Unlimited</span>
                </div>
                <p class="text-[11px] text-[#6F7173] mt-1">
                  Customer-controlled persistent object store (S3/MinIO compatible). No artificial capacity restrictions.
                </p>
              </div>

              {/* Zero-Knowledge Features */}
              <div class="rounded-xl border border-[#E2DFD8] bg-[#F0EEE9]/40 p-3.5 text-xs">
                <div class="font-semibold text-[#3C3D3E] mb-2">
                  Zero-Knowledge Invariants (All Seats)
                </div>
                <ul class="space-y-1.5 text-[11px] text-[#6F7173]">
                  <li class="flex items-center gap-1.5">
                    <span class="text-[#9E725F] font-bold">✓</span>
                    <span>Client-side WASM crypto (AES-256-GCM / Argon2id)</span>
                  </li>
                  <li class="flex items-center gap-1.5">
                    <span class="text-[#9E725F] font-bold">✓</span>
                    <span>Self-custodied root key recovery ceremony</span>
                  </li>
                  <li class="flex items-center gap-1.5">
                    <span class="text-[#9E725F] font-bold">✓</span>
                    <span>IMAP/SMTP desktop bridge with local loopback</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BillingPage;
