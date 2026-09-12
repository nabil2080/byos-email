import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useOrg } from "../../context/OrgContext";
import { listDomains, verifyDomain, Domain } from "../../lib/api/domains";
import DomainWizard from "../../components/domains/DomainWizard";

const DomainsPage: Component = () => {
  const org = useOrg();
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [verifyingId, setVerifyingId] = createSignal<string | null>(null);
  const [expandedDomainId, setExpandedDomainId] = createSignal<string | null>(null);

  // Wizard state
  const [wizardOpen, setWizardOpen] = createSignal(false);
  const [selectedDomain, setSelectedDomain] = createSignal<Domain | null>(null);
  const [wizardStep, setWizardStep] = createSignal(1);

  const [domains, { refetch }] = createResource(
    () => org.orgId,
    async (id) => {
      if (!id) return [];
      try {
        return await listDomains(id);
      } catch (e: any) {
        if (e?.status === 403) throw e;
        if (e?.status === 404) return [];
        throw e;
      }
    }
  );

  function openNewDomainWizard() {
    setSelectedDomain(null);
    setWizardStep(1);
    setWizardOpen(true);
  }

  function openExistingDomainWizard(domain: Domain, step = 2) {
    setSelectedDomain(domain);
    setWizardStep(step);
    setWizardOpen(true);
  }

  async function handleVerify(domainId: string) {
    if (!org.orgId) return;
    setVerifyingId(domainId);
    setBanner(null);
    try {
      await verifyDomain(org.orgId, domainId);
      await refetch();
      setBanner({ kind: "success", text: "Domain DNS verified successfully." });
      setTimeout(() => setBanner(null), 4000);
    } catch (e: any) {
      const status = e?.status;
      if (status === 403) {
        setBanner({ kind: "error", text: "You do not have permission to verify this domain." });
      } else if (status === 404) {
        setBanner({ kind: "error", text: "Domain not found." });
      } else {
        setBanner({ kind: "error", text: "DNS verification failed. TXT record not found yet." });
      }
      setTimeout(() => setBanner(null), 6000);
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div class="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
            Custom Domains
          </h1>
          <p class="mt-1 text-sm text-[#6F7173]">
            Configure and cryptographically verify sending domains for organization mailboxes.
          </p>
        </div>

        <button
          type="button"
          onClick={openNewDomainWizard}
          class="inline-flex items-center gap-2 rounded-lg bg-[#9E725F] px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors self-start sm:self-auto"
        >
          <span class="text-sm leading-none">+</span>
          <span>Add Custom Domain</span>
        </button>
      </div>

      {/* Alert Banner */}
      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            class={`mb-6 rounded-xl p-4 text-xs border ${
              b().kind === "success"
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : "bg-red-50 text-red-800 border-red-200"
            }`}
          >
            {b().text}
          </div>
        )}
      </Show>

      {/* Main Card */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-white shadow-xs overflow-hidden">
        <div class="p-6 border-b border-[#E2DFD8] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
              Configured Domains
            </span>
            <span class="rounded-full bg-[#F0EEE9] px-2 py-0.5 font-mono text-[11px] font-bold text-[#3C3D3E]">
              {(domains() || []).length}
            </span>
          </div>

          <button
            type="button"
            onClick={() => refetch()}
            class="text-xs text-[#9E725F] hover:text-[#865E4D] font-medium hover:underline flex items-center gap-1"
          >
            <span>↻</span> Refresh
          </button>
        </div>

        {/* Loading State */}
        <Show when={domains.loading}>
          <div class="p-12 text-center text-xs text-[#6F7173]">
            Loading organization domains…
          </div>
        </Show>

        {/* Error State */}
        <Show when={domains.error}>
          <div class="p-12 text-center text-xs text-red-700">
            Failed to load domain configurations.
          </div>
        </Show>

        {/* Empty State */}
        <Show when={!domains.loading && (domains() ?? []).length === 0}>
          <div class="p-12 text-center">
            <div class="w-12 h-12 mx-auto rounded-full bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center text-xl mb-3">
              🌐
            </div>
            <h3 class="text-sm font-bold text-[#3C3D3E]">No custom domains configured</h3>
            <p class="mt-1 text-xs text-[#6F7173] max-w-sm mx-auto">
              Add your domain to begin receiving corporate emails on your own self-sovereign storage.
            </p>
            <button
              type="button"
              onClick={openNewDomainWizard}
              class="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors"
            >
              <span>+ Add Your First Domain</span>
            </button>
          </div>
        </Show>

        {/* Domains List */}
        <Show when={(domains() ?? []).length > 0}>
          <ul class="divide-y divide-[#E2DFD8]">
            <For each={domains() ?? []}>
              {(d) => {
                const isVerified = () => d.is_verified || d.verified;
                return (
                  <li class="p-5 hover:bg-[#F0EEE9]/30 transition-colors">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div class="flex items-center gap-3">
                          <span class="font-bold text-base text-[#3C3D3E]">{d.name}</span>
                          <span
                            class={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              isVerified()
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            <span>{isVerified() ? "✓" : "⏳"}</span>
                            <span>{isVerified() ? "Verified" : "Pending Verification"}</span>
                          </span>
                        </div>

                        {/* Security status tags */}
                        <div class="mt-2 flex items-center gap-2 text-[11px] text-[#6F7173]">
                          <span class="rounded bg-[#F0EEE9] px-2 py-0.5 font-mono text-[10px] text-[#3C3D3E]">
                            MX: {isVerified() ? "Configured" : "Required"}
                          </span>
                          <span class="rounded bg-[#F0EEE9] px-2 py-0.5 font-mono text-[10px] text-[#3C3D3E]">
                            SPF: {isVerified() ? "Valid" : "Pending"}
                          </span>
                          <span class="rounded bg-[#F0EEE9] px-2 py-0.5 font-mono text-[10px] text-[#3C3D3E]">
                            DKIM: RSA-2048
                          </span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div class="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => setExpandedDomainId(expandedDomainId() === d.id ? null : d.id)}
                          class="rounded-lg border border-[#E2DFD8] bg-white px-3 py-1.5 text-xs font-semibold text-[#3C3D3E] hover:bg-[#F0EEE9] transition-colors"
                        >
                          {expandedDomainId() === d.id ? "Hide DNS Records" : "View DNS Records"}
                        </button>

                        <Show when={!isVerified()}>
                          <button
                            type="button"
                            onClick={() => openExistingDomainWizard(d, 2)}
                            class="rounded-lg border border-[#9E725F] bg-[#F3ECE8] px-3 py-1.5 text-xs font-semibold text-[#9E725F] hover:bg-[#9E725F] hover:text-white transition-colors"
                          >
                            Setup Wizard →
                          </button>
                          <button
                            type="button"
                            onClick={() => handleVerify(d.id)}
                            disabled={verifyingId() === d.id}
                            class="rounded-lg bg-[#9E725F] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
                          >
                            {verifyingId() === d.id ? "Verifying…" : "Verify Now"}
                          </button>
                        </Show>
                      </div>
                    </div>

                    {/* Inline DNS table accordion */}
                    <Show when={expandedDomainId() === d.id && (d.dns_records ?? []).length > 0}>
                      <div class="mt-4 border-t border-[#E2DFD8] pt-4 text-xs">
                        <div class="flex items-center justify-between mb-2">
                          <p class="font-bold text-[#3C3D3E]">Required DNS Records</p>
                          <button
                            type="button"
                            onClick={() => openExistingDomainWizard(d, 4)}
                            class="text-xs text-[#9E725F] hover:underline font-semibold"
                          >
                            Open Setup Guide in Wizard ↗
                          </button>
                        </div>
                        <div class="overflow-x-auto rounded-lg border border-[#E2DFD8]">
                          <table class="min-w-full divide-y divide-[#E2DFD8]">
                            <thead class="bg-[#F0EEE9]/60 font-semibold text-[#6F7173]">
                              <tr>
                                <th class="px-3 py-2 text-left">Type</th>
                                <th class="px-3 py-2 text-left">Host / Name</th>
                                <th class="px-3 py-2 text-left">Value</th>
                                <th class="px-3 py-2 text-left">Priority</th>
                              </tr>
                            </thead>
                            <tbody class="divide-y divide-[#E2DFD8] bg-white font-mono text-[11px]">
                              <For each={d.dns_records ?? []}>
                                {(r) => (
                                  <tr>
                                    <td class="whitespace-nowrap px-3 py-2 font-bold text-[#9E725F]">
                                      {r.type}
                                    </td>
                                    <td class="whitespace-nowrap px-3 py-2 text-[#3C3D3E] select-all">
                                      {r.name}
                                    </td>
                                    <td class="max-w-xs truncate px-3 py-2 text-[#6F7173] select-all" title={r.value}>
                                      {r.value}
                                    </td>
                                    <td class="whitespace-nowrap px-3 py-2 text-[#6F7173]">
                                      {r.priority ?? "—"}
                                    </td>
                                  </tr>
                                )}
                              </For>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </div>

      {/* Modal Wizard */}
      <DomainWizard
        isOpen={wizardOpen()}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => refetch()}
        initialDomain={selectedDomain()}
        initialStep={wizardStep()}
      />
    </div>
  );
};

export default DomainsPage;
