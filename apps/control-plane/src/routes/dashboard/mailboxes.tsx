import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useAuth } from "../../lib/auth/context";
import { listDomains } from "../../lib/api/domains";
import { listMailboxes, createMailbox } from "../../lib/api/mailboxes";

const MailboxesPage: Component = () => {
  const { orgId } = useAuth();
  const [localPart, setLocalPart] = createSignal("");
  const [selectedDomainId, setSelectedDomainId] = createSignal("");
  const [selectedMode, setSelectedMode] = createSignal<"org_managed" | "private">("org_managed");
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);

  const [domains, { refetch: refetchDomains }] = createResource(
    () => orgId,
    async (id) => {
      if (!id) return [];
      try {
        return await listDomains(id);
      } catch {
        return [];
      }
    }
  );

  const [mailboxes, { refetch }] = createResource(
    () => orgId,
    async (id) => {
      if (!id) return [];
      try {
        return await listMailboxes(id);
      } catch (e) {
        const status = (e as unknown as { status: number }).status;
        if (status === 403) throw e;
        return [];
      }
    }
  );

  async function handleCreate() {
    const lp = localPart().trim();
    const domId = selectedDomainId().trim();
    const mode = selectedMode();
    if (!lp || !domId || !orgId) return;
    setIsCreating(true);
    setBanner(null);
    try {
      await createMailbox(orgId, lp, domId, mode);
      setLocalPart("");
      await refetch();
      await refetchDomains();
      setBanner({ kind: "success", text: `Mailbox ${lp} created.` });
      setTimeout(() => setBanner(null), 4000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const status = (e as unknown as { status: number }).status;
      if (status === 409 || msg.includes("already exists")) setBanner({ kind: "error", text: "Mailbox already exists for this domain." });
      else if (status === 403) setBanner({ kind: "error", text: "You don't have permission for this organization." });
      else if (status === 400 && msg.includes("verified")) setBanner({ kind: "error", text: "Domain not verified." });
      else if (status === 503 || msg.includes("storage_disconnected")) setBanner({ kind: "error", text: "No active storage for organization — connect storage first." });
      else if (status === 400) setBanner({ kind: "error", text: "Invalid mailbox request." });
      else setBanner({ kind: "error", text: "Failed to create mailbox." });
      setTimeout(() => setBanner(null), 6000);
    } finally {
      setIsCreating(false);
    }
  }

  const verifiedDomains = () => (domains() ?? []).filter((d) => d.is_verified || d.verified);

  return (
    <div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div class="mb-6">
        <h1 class="text-2xl font-semibold text-slate-900">Mailboxes</h1>
        <p class="mt-1 text-sm text-slate-500">Provision org-managed mailboxes under verified domains. Storage is selected automatically from your organization's active connection.</p>
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
          <h3 class="text-sm font-medium text-slate-900">Create Mailbox</h3>
          <p class="mt-1 text-xs text-slate-500">Only verified domains are listed. Select mode: Organization-managed (root sealed to org recovery key) or Private (root user-recoverable, no org sealing).</p>

          <div class="mt-3 grid grid-cols-2 gap-2">
            <input
              value={localPart()}
              onInput={(e) => setLocalPart(e.currentTarget.value)}
              placeholder="local-part (e.g. alice)"
              class="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none"
            />
            <select
              value={selectedDomainId()}
              onChange={(e) => setSelectedDomainId(e.currentTarget.value)}
              class="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none"
            >
              <option value="">Select verified domain</option>
              <For each={verifiedDomains()}>
                {(d) => <option value={d.id}>{d.name}</option>}
              </For>
            </select>
            <select
              value={selectedMode()}
              onChange={(e) => setSelectedMode(e.currentTarget.value as "org_managed" | "private")}
              class="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none"
            >
              <option value="org_managed">Organization-managed</option>
              <option value="private">Private</option>
            </select>
          </div>

          <Show when={verifiedDomains().length === 0 && !domains.loading}>
            <p class="mt-2 text-xs text-amber-600">No verified domains — verify a domain first.</p>
          </Show>

          <button
            onClick={handleCreate}
            disabled={!localPart().trim() || !selectedDomainId() || !selectedMode() || isCreating()}
            class="mt-3 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {isCreating() ? "Creating…" : "Create mailbox"}
          </button>
        </div>

        <div class="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm p-6">
          <h3 class="text-sm font-medium text-slate-900">Mailboxes</h3>

          <Show when={mailboxes.loading}>
            <p class="mt-3 text-sm text-slate-400">Loading…</p>
          </Show>

          <Show when={mailboxes.error}>
            <p class="mt-3 text-sm text-red-600">Unable to load mailboxes.</p>
          </Show>

          <Show when={!mailboxes.loading && (mailboxes() ?? []).length === 0}>
            <p class="mt-3 text-sm text-slate-500">No mailboxes yet.</p>
          </Show>

          <Show when={(mailboxes() ?? []).length > 0}>
            <div class="mt-3 overflow-x-auto">
              <table class="w-full rounded-md border border-slate-200">
                <thead>
                  <tr class="border-b border-slate-200 text-xs text-slate-500">
                    <th class="p-2 text-left">Local Part</th>
                    <th class="p-2 text-left">Domain</th>
                    <th class="p-2 text-left">Mode</th>
                    <th class="p-2 text-left">ID</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={mailboxes() ?? []}>
                    {(mb) => (
                      <tr class="border-b border-slate-200 text-sm">
                        <td class="p-2 font-medium text-slate-900">{mb.local_part || (mb as unknown as { localPart: string }).localPart}</td>
                        <td class="p-2 text-slate-600">{mb.domain_id || (mb as unknown as { domainId: string }).domainId}</td>
                        <td class="p-2">
                          <span class="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">{mb.mode}</span>
                        </td>
                        <td class="p-2 font-mono text-xs text-slate-500">{mb.id.slice(0, 8)}…</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default MailboxesPage;
