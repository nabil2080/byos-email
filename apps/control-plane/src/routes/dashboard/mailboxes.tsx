import { Component, createResource, createSignal, For, Show } from "solid-js";
import { useOrg } from "../../context/OrgContext";
import { listDomains } from "../../lib/api/domains";
import { listMailboxes, createMailbox, recoverMailboxSecret } from "../../lib/api/mailboxes";

const MailboxesPage: Component = () => {
  const org = useOrg();
  const [localPart, setLocalPart] = createSignal("");
  const [selectedDomainId, setSelectedDomainId] = createSignal("");
  const [selectedMode, setSelectedMode] = createSignal<"org_managed" | "private">("org_managed");
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);
  const [recoveryMailboxId, setRecoveryMailboxId] = createSignal("");
  const [recoveryKeyFile, setRecoveryKeyFile] = createSignal<File | null>(null);
  const [isRecovering, setIsRecovering] = createSignal(false);

  const [domains, { refetch: refetchDomains }] = createResource(
    () => org.orgId,
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
    () => org.orgId,
    async (id) => {
      if (!id) return [];
      try {
        return await listMailboxes(id);
      } catch (e: any) {
        if (e?.status === 403) throw e;
        return [];
      }
    }
  );

  async function handleCreate(e: Event) {
    e.preventDefault();
    const lp = localPart().trim();
    const domId = selectedDomainId().trim();
    const mode = selectedMode();
    if (!lp || !domId || !org.orgId) return;

    setIsCreating(true);
    setBanner(null);
    try {
      await createMailbox(org.orgId, lp, domId, mode);
      setLocalPart("");
      await refetch();
      await refetchDomains();
      setBanner({ kind: "success", text: `Mailbox ${lp} created successfully.` });
      setTimeout(() => setBanner(null), 4000);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : "";
      const status = e?.status;
      if (status === 409 || msg.includes("already exists")) {
        setBanner({ kind: "error", text: "Mailbox already exists for this domain." });
      } else if (status === 403) {
        setBanner({ kind: "error", text: "You don't have permission for this organization." });
      } else if (status === 400 && msg.includes("verified")) {
        setBanner({ kind: "error", text: "Domain not verified. Verify the domain before creating mailboxes." });
      } else if (status === 503 || msg.includes("storage_disconnected")) {
        setBanner({ kind: "error", text: "No active storage connected — please connect storage first." });
      } else if (status === 400) {
        setBanner({ kind: "error", text: "Invalid mailbox local-part." });
      } else {
        setBanner({ kind: "error", text: "Failed to create mailbox." });
      }
      setTimeout(() => setBanner(null), 6000);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRecovery(e: Event) {
    e.preventDefault();
    const file = recoveryKeyFile();
    const mailboxId = recoveryMailboxId();
    if (!file || !mailboxId || !org.orgId) return;

    setIsRecovering(true);
    setBanner(null);
    try {
      const mailboxSkHex = await recoverMailboxSecret(org.orgId, mailboxId, await file.text());
      const output = new Blob([mailboxSkHex], { type: "text/plain" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(output);
      link.download = `byos-mailbox-${mailboxId}-recovered-sk.hex`;
      link.click();
      URL.revokeObjectURL(link.href);
      setBanner({ kind: "success", text: "Mailbox secret key recovered and downloaded successfully." });
    } catch (e: any) {
      const status = e?.status;
      setBanner({
        kind: "error",
        text: status === 403
          ? "Private mailboxes cannot be recovered by the organization."
          : "Mailbox recovery failed. Ensure you uploaded the correct organization recovery key.",
      });
    } finally {
      setIsRecovering(false);
    }
  }

  const verifiedDomains = () => (domains() ?? []).filter((d) => d.is_verified || d.verified);

  const getDomainName = (domainId: string) => {
    const found = (domains() ?? []).find((d) => d.id === domainId);
    return found ? found.name : domainId.slice(0, 8);
  };

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header */}
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Mailbox Provisioning
        </h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Create and manage zero-knowledge encrypted mailboxes under verified organizational domains.
        </p>
      </div>

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

      {/* Creation Form Card */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs mb-8">
        <h3 class="text-sm font-bold text-[#3C3D3E] mb-1">Create New Mailbox</h3>
        <p class="text-xs text-[#6F7173] mb-4">
          Provision an employee mailbox. Choose Organization-managed for institutional key escrow or Private for user-exclusive sovereignty.
        </p>

        <form onSubmit={handleCreate} class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
              Local Part (Username)
            </label>
            <div class="flex items-center rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm focus-within:border-[#9E725F] focus-within:ring-2 focus-within:ring-[#9E725F]/20">
              <input
                type="text"
                required
                value={localPart()}
                onInput={(e) => setLocalPart(e.currentTarget.value)}
                placeholder="alice"
                class="w-full text-sm text-[#3C3D3E] focus:outline-none"
              />
              <span class="text-[#6F7173] font-mono text-xs">@</span>
            </div>
          </div>

          <div>
            <label class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
              Verified Domain
            </label>
            <select
              value={selectedDomainId()}
              onChange={(e) => setSelectedDomainId(e.currentTarget.value)}
              class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
            >
              <option value="">Select domain…</option>
              <For each={verifiedDomains()}>
                {(d) => <option value={d.id}>{d.name}</option>}
              </For>
            </select>
          </div>

          <div>
            <label class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
              Privacy Mode
            </label>
            <select
              value={selectedMode()}
              onChange={(e) => setSelectedMode(e.currentTarget.value as "org_managed" | "private")}
              class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
            >
              <option value="org_managed">Organization-managed</option>
              <option value="private">Private (Zero Escrow)</option>
            </select>
          </div>

          <div class="md:col-span-3 flex items-center justify-between pt-2">
            <Show when={verifiedDomains().length === 0 && !domains.loading}>
              <span class="text-xs text-amber-700">
                ⚠️ No verified domains available. Verify a domain in Domains tab first.
              </span>
            </Show>
            <span />
            <button
              type="submit"
              disabled={!localPart().trim() || !selectedDomainId() || isCreating()}
              class="rounded-lg bg-[#9E725F] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
            >
              {isCreating() ? "Provisioning…" : "Create Mailbox"}
            </button>
          </div>
        </form>
      </div>

      {/* Mailboxes List Card */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-white shadow-xs overflow-hidden mb-8">
        <div class="p-6 border-b border-[#E2DFD8] flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
              Provisioned Mailboxes
            </span>
            <span class="rounded-full bg-[#F0EEE9] px-2 py-0.5 font-mono text-[11px] font-bold text-[#3C3D3E]">
              {(mailboxes() || []).length}
            </span>
          </div>
        </div>

        <Show when={mailboxes.loading}>
          <div class="p-8 text-center text-xs text-[#6F7173]">Loading mailboxes…</div>
        </Show>

        <Show when={!mailboxes.loading && (mailboxes() ?? []).length === 0}>
          <div class="p-8 text-center text-xs text-[#6F7173]">
            No mailboxes provisioned yet. Create your first mailbox above.
          </div>
        </Show>

        <Show when={(mailboxes() ?? []).length > 0}>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-[#E2DFD8]">
              <thead class="bg-[#F0EEE9]/60 font-semibold text-[#6F7173] text-xs">
                <tr>
                  <th class="px-6 py-3 text-left">Email Address</th>
                  <th class="px-6 py-3 text-left">Privacy Mode</th>
                  <th class="px-6 py-3 text-left">Mailbox ID</th>
                  <th class="px-6 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#E2DFD8] bg-white text-xs text-[#3C3D3E]">
                <For each={mailboxes() ?? []}>
                  {(mb) => {
                    const lp = mb.local_part || (mb as any).localPart;
                    const dom = getDomainName(mb.domain_id || (mb as any).domainId);
                    return (
                      <tr class="hover:bg-[#F0EEE9]/30 transition-colors">
                        <td class="px-6 py-3.5 font-medium text-[#3C3D3E]">
                          {lp}@{dom}
                        </td>
                        <td class="px-6 py-3.5">
                          <span class={`rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase ${mb.mode === "org_managed" ? "bg-[#F3ECE8] text-[#9E725F]" : "bg-purple-100 text-purple-800"}`}>
                            {mb.mode === "org_managed" ? "Org Escrow" : "Private"}
                          </span>
                        </td>
                        <td class="px-6 py-3.5 font-mono text-[11px] text-[#6F7173]">
                          {mb.id.slice(0, 8)}…{mb.id.slice(-4)}
                        </td>
                        <td class="px-6 py-3.5 text-right">
                          <span class="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
                          </span>
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>

      {/* Institutional Recovery Card */}
      <div class="rounded-2xl border border-[#E2DFD8] bg-[#F0EEE9]/40 p-6 shadow-xs">
        <h3 class="text-sm font-bold text-[#3C3D3E] mb-1">
          Recover Organization-Managed Mailbox Key
        </h3>
        <p class="text-xs text-[#6F7173] mb-4">
          If an employee loses their device or credentials, an organization owner can restore access by uploading the master recovery key file downloaded during setup.
        </p>

        <form onSubmit={handleRecovery} class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={recoveryMailboxId()}
            onChange={(e) => setRecoveryMailboxId(e.currentTarget.value)}
            class="rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-xs text-[#3C3D3E] focus:border-[#9E725F] focus:outline-none"
          >
            <option value="">Select target mailbox…</option>
            <For each={(mailboxes() ?? []).filter((mb) => mb.mode === "org_managed")}>
              {(mb) => (
                <option value={mb.id}>
                  {mb.local_part} ({mb.id.slice(0, 8)}…)
                </option>
              )}
            </For>
          </select>

          <input
            type="file"
            accept=".hex,text/plain"
            onChange={(e) => setRecoveryKeyFile(e.currentTarget.files?.[0] ?? null)}
            class="rounded-lg border border-[#E2DFD8] bg-white px-3 py-1.5 text-xs text-[#3C3D3E] file:mr-2 file:rounded file:border-0 file:bg-[#9E725F]/10 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-[#9E725F]"
          />

          <div class="sm:col-span-2 pt-2">
            <button
              type="submit"
              disabled={!recoveryMailboxId() || !recoveryKeyFile() || isRecovering()}
              class="rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
            >
              {isRecovering() ? "Decrypting Root…" : "Recover & Download Mailbox Key"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MailboxesPage;
