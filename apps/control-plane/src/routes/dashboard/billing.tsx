import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useOrgId } from "../../lib/auth/context";
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
  const orgId = useOrgId();
  const [billing, { refetch }] = createResource<BillingInfo>(() => (orgId ? getBillingInfo(orgId) : null!));
  const [updating, setUpdating] = createSignal<string | null>(null);
  const [banner, setBanner] = createSignal<{ type: "ok" | "err"; msg: string } | null>(null);

  async function handleSelectPlan(planKey: string) {
    if (!orgId || updating()) return;
    setUpdating(planKey);
    setBanner(null);
    try {
      await updatePlan(orgId, planKey);
      await refetch();
      setBanner({ type: "ok", msg: `Organization plan updated to ${planKey.toUpperCase()}` });
    } catch (err) {
      setBanner({ type: "err", msg: err instanceof Error ? err.message : "Failed to change plan." });
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold text-slate-900">Billing & Subscription Plans</h1>
          <p class="mt-1 text-sm text-slate-500">
            Every plan receives the complete core BYOS email product. Plans determine resource capacity and scale, not features.
          </p>
        </div>
      </div>

      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            class={`mt-4 rounded-md p-3 text-sm ${
              b().type === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
            }`}
          >
            {b().msg}
          </div>
        )}
      </Show>

      {/* Current Usage Banner */}
      <Show when={billing()}>
        {(info) => (
          <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div>
              <span class="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Plan</span>
              <div class="text-2xl font-bold text-slate-900 capitalize mt-0.5">{info().plan.replace("_", "+")}</div>
              <div class="mt-1 text-xs text-slate-500">
                ${info().monthly_usd}/mo billed monthly (${info().annual_usd}/yr billed annually)
              </div>
            </div>
            <div class="flex gap-6 border-t md:border-t-0 md:border-l border-slate-200 pt-4 md:pt-0 md:pl-6">
              <div>
                <div class="text-xs font-medium text-slate-500">Mailbox Capacity</div>
                <div class="text-lg font-bold text-slate-800 mt-0.5">
                  {info().used_mailboxes} / {info().mailbox_limit}
                </div>
              </div>
              <div>
                <div class="text-xs font-medium text-slate-500">Domain Capacity</div>
                <div class="text-lg font-bold text-slate-800 mt-0.5">
                  {info().used_domains} / {info().domain_limit}
                </div>
              </div>
              <div>
                <div class="text-xs font-medium text-slate-500">Aliases per Mailbox</div>
                <div class="text-lg font-bold text-slate-800 mt-0.5">{info().aliases_per_mail}</div>
              </div>
            </div>
          </div>
        )}
      </Show>

      {/* Plans Grid */}
      <div class="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <For each={PLANS}>
          {(p) => {
            const isCurrent = () => billing()?.plan === p.key;
            return (
              <div
                class={`flex flex-col justify-between rounded-xl border p-6 transition-all ${
                  isCurrent()
                    ? "border-sky-500 bg-sky-50/20 shadow-md ring-2 ring-sky-500/20"
                    : "border-slate-200 bg-white hover:border-slate-300 shadow-sm"
                }`}
              >
                <div>
                  <div class="flex items-center justify-between">
                    <h3 class="text-lg font-bold text-slate-900">{p.name}</h3>
                    <Show when={isCurrent()}>
                      <span class="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-semibold text-sky-800">
                        Active Plan
                      </span>
                    </Show>
                  </div>
                  <div class="mt-4">
                    <span class="text-3xl font-extrabold text-slate-900">
                      {p.monthly ? `$${p.monthly}` : "Custom"}
                    </span>
                    <span class="text-sm font-medium text-slate-500">{p.monthly ? "/mo" : ""}</span>
                  </div>
                  <div class="mt-1 text-xs text-slate-500">
                    {p.annual ? `$${p.annual}/yr billed annually` : "Contact sales for pricing"}
                  </div>

                  <ul class="mt-6 space-y-2.5 text-xs text-slate-600">
                    <li class="flex items-center gap-2">
                      <span class="text-emerald-600">✓</span> {p.mailboxes} Mailbox{p.mailboxes === 1 ? "" : "es"}
                    </li>
                    <li class="flex items-center gap-2">
                      <span class="text-emerald-600">✓</span> {p.domains} Custom Domain{p.domains === 1 ? "" : "s"}
                    </li>
                    <li class="flex items-center gap-2">
                      <span class="text-emerald-600">✓</span> {p.aliases} Aliases per Mailbox
                    </li>
                    <li class="flex items-center gap-2 text-slate-700 font-medium">
                      <span class="text-emerald-600">✓</span> Full Security & Encryption
                    </li>
                    <li class="flex items-center gap-2 text-slate-700 font-medium">
                      <span class="text-emerald-600">✓</span> S3 / Google Drive BYOS
                    </li>
                  </ul>
                </div>

                <div class="mt-6 pt-4 border-t border-slate-100">
                  <button
                    disabled={isCurrent() || !!updating()}
                    onClick={() => handleSelectPlan(p.key)}
                    class={`w-full rounded-lg py-2 text-xs font-semibold transition-all ${
                      isCurrent()
                        ? "bg-slate-100 text-slate-400 cursor-default"
                        : "bg-slate-900 text-white hover:bg-slate-800"
                    }`}
                  >
                    {updating() === p.key ? "Updating…" : isCurrent() ? "Current Plan" : "Select Plan"}
                  </button>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <p class="mt-6 text-xs text-slate-500">
        No feature gating: Storage choice (S3, MinIO, Google Drive) and core features are available across all tiers. You only pay for scale.
      </p>
    </div>
  );
};

export default BillingPage;
