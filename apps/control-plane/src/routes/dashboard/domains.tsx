import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useAuth } from "../../lib/auth/context";
import { listDomains, createDomain, verifyDomain } from "../../lib/api/domains";

const DomainsPage: Component = () => {
  const { orgId } = useAuth();
  const [newDomain, setNewDomain] = createSignal("");
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);
  const [verifyingId, setVerifyingId] = createSignal<string | null>(null);

  const [domains, { refetch }] = createResource(
    () => orgId,
    async (id) => {
      if (!id) return [];
      try {
        return await listDomains(id);
      } catch (e) {
        if (e instanceof Error && (e as unknown as { status: number }).status === 403) throw e;
        if (e instanceof Error && (e as unknown as { status: number }).status === 404) return [];
        throw e;
      }
    }
  );

  async function handleAdd() {
    const name = newDomain().trim().toLowerCase();
    if (!name || !orgId) return;
    setIsCreating(true);
    setBanner(null);
    try {
      await createDomain(orgId, name);
      setNewDomain("");
      await refetch();
      setBanner({ kind: "success", text: `Domain ${name} added.` });
      setTimeout(() => setBanner(null), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const status = (e as unknown as { status: number }).status;
      if (status === 409 || msg.includes("already exists")) {
        setBanner({ kind: "error", text: "Domain already exists." });
      } else if (status === 403) {
        setBanner({ kind: "error", text: "You don't have permission for this organization." });
      } else if (status === 400) {
        setBanner({ kind: "error", text: "Invalid domain format." });
      } else {
        setBanner({ kind: "error", text: "Failed to add domain." });
      }
      setTimeout(() => setBanner(null), 5000);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleVerify(domainId: string) {
    if (!orgId) return;
    setVerifyingId(domainId);
    setBanner(null);
    try {
      await verifyDomain(orgId, domainId);
      await refetch();
      setBanner({ kind: "success", text: "Domain verified." });
      setTimeout(() => setBanner(null), 4000);
    } catch (e) {
      const status = (e as unknown as { status: number }).status;
      if (status === 403) setBanner({ kind: "error", text: "You don't have permission." });
      else if (status === 404) setBanner({ kind: "error", text: "Domain not found." });
      else setBanner({ kind: "error", text: "Failed to verify domain." });
      setTimeout(() => setBanner(null), 5000);
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div class="mb-6">
        <h1 class="text-2xl font-semibold text-slate-900">Domains</h1>
        <p class="mt-1 text-sm text-slate-500">Add and verify domains for your organization. Only verified domains can be used for mailboxes.</p>
      </div>

      <Show when={banner()}>
        {(b) => (
          <div
            role="alert"
            aria-live="polite"
            class={`mb-4 rounded-md p-3 text-sm ${b().kind === "success" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}
          >
            {b().text}
          </div>
        )}
      </Show>

      <Show when={!orgId}>
        <p class="text-sm text-slate-500">No organization selected.</p>
      </Show>

      <Show when={!!orgId}>
        <div class="rounded-lg border border-slate-200 bg-white shadow-sm p-6">
          <h3 class="text-sm font-medium text-slate-900">Domains</h3>

          <Show when={domains.loading}>
            <p class="mt-3 text-sm text-slate-400">Loading…</p>
          </Show>

          <Show when={domains.error}>
            <p class="mt-3 text-sm text-red-600">Unable to load domains.</p>
          </Show>

          <Show when={!domains.loading && (domains() ?? []).length === 0}>
            <p class="mt-3 text-sm text-slate-500">No domains yet. Add one below.</p>
          </Show>

          <Show when={(domains() ?? []).length > 0}>
            <ul class="mt-3 space-y-2">
              <For each={domains() ?? []}>
                {(d) => (
                  <li class="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <div class="flex flex-col">
                      <span class="text-sm font-medium text-slate-900">{d.name}</span>
                      <span class={`text-xs ${d.is_verified || d.verified ? "text-emerald-600" : "text-amber-600"}`}>
                        {d.is_verified || d.verified ? "Verified" : "Pending verification"}
                      </span>
                    </div>
                    <Show when={!d.is_verified && !d.verified}>
                      <button
                        onClick={() => handleVerify(d.id)}
                        disabled={verifyingId() === d.id}
                        class="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                      >
                        {verifyingId() === d.id ? "Verifying…" : "Verify"}
                      </button>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <div class="mt-6 border-t border-slate-200 pt-4">
            <h4 class="text-xs font-medium text-slate-600">Add Domain</h4>
            <div class="mt-2 flex gap-2">
              <input
                value={newDomain()}
                onInput={(e) => setNewDomain(e.currentTarget.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                placeholder="example.com"
                class="block flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none"
              />
              <button
                onClick={handleAdd}
                disabled={!newDomain().trim() || isCreating()}
                class="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {isCreating() ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default DomainsPage;
