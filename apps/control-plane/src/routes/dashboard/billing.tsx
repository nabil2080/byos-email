import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useOrg } from "../../context/OrgContext";
import { getBillingInfo, updatePlan, BillingInfo } from "../../lib/api/billing";

const PLANS = [
  { key: "solo", name: "Solo", monthly: 3, annual: 31, mailboxes: 1, domains: 1, aliases: 10 },
  { key: "starter", name: "Starter", monthly: 14, annual: 143, mailboxes: 5, domains: 2, aliases: 15 },
  { key: "business", name: "Business", monthly: 26, annual: 265, mailboxes: 10, domains: 3, aliases: 20 },
  { key: "team", name: "Team", monthly: 60, annual: 612, mailboxes: 25, domains: 5, aliases: 30 },
  { key: "business_plus", name: "Business+", monthly: 110, annual: 1122, mailboxes: 50, domains: 10, aliases: 40 },
  { key: "enterprise", name: "Enterprise", monthly: 0, annual: 0, mailboxes: "Custom", domains: "Custom", aliases: "Custom" },
];

const BillingPage: Component = () => {
  const org = useOrg();
  const [billing, { refetch }] = createResource<BillingInfo>(() => (org.orgId ? getBillingInfo(org.orgId) : null!));
  const [updating, setUpdating] = createSignal<string | null>(null);
  const [banner, setBanner] = createSignal<{ type: "ok" | "err"; msg: string } | null>(null);

  async function handleSelectPlan(planKey: string) {
    if (!org.orgId || updating()) return;
    setUpdating(planKey);
    setBanner(null);
    try {
      await updatePlan(org.orgId, planKey);
      await refetch();
      await org.refetch();
      setBanner({ type: "ok", msg: `Organization plan updated to ${planKey.toUpperCase()}` });
    } catch (err: any) {
      setBanner({ type: "err", msg: err instanceof Error ? err.message : "Failed to change plan." });
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Billing & Resource Quotas
        </h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Every plan includes zero-knowledge cryptography, customer-controlled persistent storage, and sovereign mail exchange. Plans scale resource capacity.
        </p>
      </div>

      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            class={`mb-6 rounded-xl p-4 text-xs border ${
              b().type === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            {b().msg}
          </div>
        )}
      </Show>

      {/* Current Usage Banner */}
      <Show when={billing()}>
        {(info) => (
          <div class="mb-8 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
                Current Active Tier
              </span>
              <div class="text-2xl font-bold text-[#3C3D3E] capitalize mt-0.5">
                {info().plan.replace("_", "+")}
              </div>
              <div class="mt-1 text-xs text-[#6F7173]">
                ${info().monthly_usd}/mo (${info().annual_usd}/yr billed annually)
              </div>
            </div>
            <div class="flex gap-6 border-t md:border-t-0 md:border-l border-[#E2DFD8] pt-4 md:pt-0 md:pl-6 w-full md:w-auto justify-around">
              <div>
                <div class="text-xs font-medium text-[#6F7173]">Mailbox Capacity</div>
                <div class="text-xl font-bold text-[#3C3D3E] mt-0.5">
                  {info().used_mailboxes} / {info().mailbox_limit}
                </div>
              </div>
              <div>
                <div class="text-xs font-medium text-[#6F7173]">Domain Capacity</div>
                <div class="text-xl font-bold text-[#3C3D3E] mt-0.5">
                  {info().used_domains} / {info().domain_limit}
                </div>
              </div>
              <div>
                <div class="text-xs font-medium text-[#6F7173]">Aliases / Box</div>
                <div class="text-xl font-bold text-[#3C3D3E] mt-0.5">
                  {info().aliases_per_mail}
                </div>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Plans Grid */}
      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        <For each={PLANS}>
          {(p) => {
            const isCurrent = () => billing()?.plan === p.key;
            return (
              <div
                class={`flex flex-col justify-between rounded-2xl border p-6 transition-all ${
                  isCurrent()
                    ? "border-[#9E725F] bg-white shadow-md ring-2 ring-[#9E725F]/20"
                    : "border-[#E2DFD8] bg-white hover:border-[#9E725F]/40 shadow-xs"
                }`}
              >
                <div>
                  <div class="flex items-center justify-between">
                    <h3 class="text-base font-bold text-[#3C3D3E]">{p.name}</h3>
                    <Show when={isCurrent()}>
                      <span class="rounded-full bg-[#F3ECE8] px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#9E725F] uppercase">
                        Current
                      </span>
                    </Show>
                  </div>
                  <div class="mt-4">
                    <span class="text-3xl font-extrabold text-[#3C3D3E]">
                      {p.monthly ? `$${p.monthly}` : "Custom"}
                    </span>
                    <span class="text-sm font-medium text-[#6F7173]">{p.monthly ? "/mo" : ""}</span>
                  </div>
                  <div class="mt-1 text-xs text-[#6F7173]">
                    {p.annual ? `$${p.annual}/yr billed annually` : "Contact sales for enterprise"}
                  </div>

                  <ul class="mt-6 space-y-2.5 text-xs text-[#3C3D3E]">
                    <li class="flex items-center gap-2">
                      <span class="text-[#9E725F] font-bold">✓</span> {p.mailboxes} Mailbox{p.mailboxes === 1 ? "" : "es"}
                    </li>
                    <li class="flex items-center gap-2">
                      <span class="text-[#9E725F] font-bold">✓</span> {p.domains} Custom Domain{p.domains === 1 ? "" : "s"}
                    </li>
                    <li class="flex items-center gap-2">
                      <span class="text-[#9E725F] font-bold">✓</span> {p.aliases} Aliases per Mailbox
                    </li>
                    <li class="flex items-center gap-2 font-medium">
                      <span class="text-[#9E725F] font-bold">✓</span> Full Zero-Knowledge E2EE
                    </li>
                    <li class="flex items-center gap-2 font-medium">
                      <span class="text-[#9E725F] font-bold">✓</span> Customer-Owned S3 / MinIO
                    </li>
                  </ul>
                </div>

                <div class="mt-6 pt-4 border-t border-[#E2DFD8]">
                  <button
                    disabled={isCurrent() || !org.isOwner || !!updating()}
                    onClick={() => handleSelectPlan(p.key)}
                    class={`w-full rounded-lg py-2.5 text-xs font-semibold transition-all ${
                      isCurrent()
                        ? "bg-[#F0EEE9] text-[#6F7173] cursor-default"
                        : "bg-[#9E725F] text-white hover:bg-[#865E4D] shadow-xs"
                    }`}
                  >
                    {updating() === p.key
                      ? "Updating…"
                      : isCurrent()
                      ? "Active Tier"
                      : !org.isOwner
                      ? "Owner Only"
                      : "Select Tier"}
                  </button>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <p class="text-xs text-[#6F7173]">
        No artificial security tiers: All core cryptography, persistent storage sovereignty, and IMAP/SMTP bridge capabilities are included on all plans.
      </p>
    </div>
  );
};

export default BillingPage;
