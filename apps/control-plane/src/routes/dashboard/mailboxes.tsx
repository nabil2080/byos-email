import { Component, createEffect, createResource, createSignal, For, Show } from "solid-js";
import { useOrg } from "../../context/OrgContext";
import { listDomains } from "../../lib/api/domains";
import {
  listMailboxes,
  inviteMailbox,
  impersonateMailbox,
  InviteMailboxResponse,
  recoverMailboxSecret,
  listOrgAliases,
  createAlias,
  deleteAlias,
  deleteMailbox,
  Mailbox,
} from "../../lib/api/mailboxes";
import { getBillingInfo } from "../../lib/api/billing";

const MailboxesPage: Component = () => {
  const org = useOrg();
  const [activeTab, setActiveTab] = createSignal<"mailboxes" | "aliases">("mailboxes");
  const [localPart, setLocalPart] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [selectedDomainId, setSelectedDomainId] = createSignal("");
  const [selectedMode, setSelectedMode] = createSignal<"org_managed" | "private">("private");
  const [createdInvite, setCreatedInvite] = createSignal<InviteMailboxResponse | null>(null);
  const [copiedLink, setCopiedLink] = createSignal(false);
  const [isAccessing, setIsAccessing] = createSignal<string | null>(null);
  const [knownInvites, setKnownInvites] = createSignal<Record<string, string>>({});
  const [banner, setBanner] = createSignal<{ kind: "success" | "error"; text: string } | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);
  const [recoveryMailboxId, setRecoveryMailboxId] = createSignal("");
  const [recoveryKeyFile, setRecoveryKeyFile] = createSignal<File | null>(null);
  const [isRecovering, setIsRecovering] = createSignal(false);
  const [deleteTargetMailbox, setDeleteTargetMailbox] = createSignal<Mailbox | null>(null);
  const [isDeletingMailbox, setIsDeletingMailbox] = createSignal(false);

  // Alias state
  const [aliasLocalPart, setAliasLocalPart] = createSignal("");
  const [aliasTargetMailboxId, setAliasTargetMailboxId] = createSignal("");
  const [aliasDomainId, setAliasDomainId] = createSignal("");
  const [isCreatingAlias, setIsCreatingAlias] = createSignal(false);
  const [isDeletingAlias, setIsDeletingAlias] = createSignal("");

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

  const [mailboxes, { refetch: refetchMailboxes }] = createResource(
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

  const [aliases, { refetch: refetchAliases }] = createResource(
    () => org.orgId,
    async (id) => {
      if (!id) return [];
      try {
        return await listOrgAliases(id);
      } catch {
        return [];
      }
    }
  );

  const [billing, { refetch: refetchBilling }] = createResource(
    () => org.orgId,
    async (id) => {
      if (!id) return null;
      try {
        return await getBillingInfo(id);
      } catch {
        return null;
      }
    }
  );

  const verifiedDomains = () => (domains() ?? []).filter((d) => d.is_verified || d.verified);

  // Auto-select first verified domain if none selected
  createEffect(() => {
    const vd = verifiedDomains();
    if (vd.length > 0 && !selectedDomainId()) {
      setSelectedDomainId(vd[0].id);
    }
    if (vd.length > 0 && !aliasDomainId()) {
      setAliasDomainId(vd[0].id);
    }
  });

  // Auto-select first mailbox for alias creation if none selected
  createEffect(() => {
    const mbs = mailboxes() ?? [];
    if (mbs.length > 0 && !aliasTargetMailboxId()) {
      setAliasTargetMailboxId(mbs[0].id);
    }
  });

  const mailboxCount = () => (mailboxes() ?? []).length;
  const aliasCount = () => (aliases() ?? []).length;
  const mailboxLimit = () => billing()?.mailbox_limit ?? 1;
  const isQuotaFull = () => {
    const b = billing();
    if (!b) return false;
    return b.used_mailboxes >= b.mailbox_limit;
  };

  async function handleCreate(e: Event) {
    e.preventDefault();
    const lp = localPart().trim();
    const domId = selectedDomainId().trim();
    const mode = selectedMode();
    const domName = getDomainName(domId);
    if (!lp || !domId || !org.orgId || !domName) return;

    if (isQuotaFull()) {
      setBanner({
        kind: "error",
        text: `Plan mailbox limit reached (${mailboxCount()}/${mailboxLimit()}). Upgrade your subscription in Billing to provision additional mailboxes.`,
      });
      return;
    }

    setIsCreating(true);
    setBanner(null);
    try {
      const email = `${lp}@${domName}`;
      const inviteResp = await inviteMailbox(org.orgId, {
        address: email,
        name: displayName().trim() || lp,
        privacy_mode: mode,
      });
      setCreatedInvite(inviteResp);
      setKnownInvites((prev) => ({
        ...prev,
        [inviteResp.mailbox_id]: inviteResp.invite_url,
        [email]: inviteResp.invite_url,
      }));
      setLocalPart("");
      setDisplayName("");
      await refetchMailboxes();
      await refetchDomains();
      await refetchBilling();
      setBanner({ kind: "success", text: `Invitation generated for ${email}. Share the setup link below.` });
    } catch (e: any) {
      let msg = e instanceof Error ? e.message : "";
      let errorDetail = "";
      try {
        const parsed = JSON.parse(msg);
        if (parsed.error) {
          errorDetail = parsed.error;
        }
      } catch {}

      const status = e?.status;
      if (status === 402 || errorDetail === "mailbox_limit_reached" || msg.includes("mailbox_limit_reached")) {
        setBanner({
          kind: "error",
          text: `Plan mailbox limit reached (${mailboxCount()}/${mailboxLimit()}). Upgrade to a higher tier in Billing to provision more mailboxes.`,
        });
      } else if (status === 409 || msg.includes("already exists") || errorDetail.includes("already exists")) {
        setBanner({ kind: "error", text: "Mailbox username or email already exists for this organization." });
      } else if (status === 403) {
        setBanner({ kind: "error", text: "You don't have permission to manage mailboxes for this organization." });
      } else if (status === 400 && (msg.includes("verified") || errorDetail.includes("verified"))) {
        setBanner({ kind: "error", text: "Domain not verified. Verify the domain in the Domains tab first." });
      } else if (status === 503 || msg.includes("storage_disconnected") || errorDetail.includes("storage_disconnected")) {
        setBanner({ kind: "error", text: "No active storage connected — please connect storage in the Storage tab first." });
      } else if (status === 400 && (msg.includes("local_part") || errorDetail.includes("local_part"))) {
        setBanner({ kind: "error", text: "Invalid mailbox username (cannot contain spaces, @, or special symbols)." });
      } else {
        setBanner({ kind: "error", text: errorDetail || msg || "Failed to create mailbox." });
      }
      setTimeout(() => setBanner(null), 7000);
    } finally {
      setIsCreating(false);
    }
  }

  async function handleAccessMailbox(mb: Mailbox) {
    if (!org.orgId) return;
    if (mb.mode === "private") {
      setBanner({ kind: "error", text: "Private mailboxes cannot be accessed by administrators." });
      return;
    }
    setIsAccessing(mb.id);
    try {
      const res = await impersonateMailbox(org.orgId, mb.id);
      window.open(res.webmail_url, "_blank");
    } catch (err: any) {
      setBanner({ kind: "error", text: err?.message || "Failed to access mailbox." });
    } finally {
      setIsAccessing(null);
    }
  }

  function handleCopyInvite(url: string) {
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  }

  async function handleDeleteMailbox() {
    const target = deleteTargetMailbox();
    if (!target || !org.orgId) return;
    setIsDeletingMailbox(true);
    try {
      await deleteMailbox(org.orgId, target.id);
      const name = target.email || target.local_part || "Mailbox";
      setDeleteTargetMailbox(null);
      setBanner({
        kind: "success",
        text: `Mailbox ${name} was successfully deleted.`,
      });
      await refetchMailboxes();
      await refetchAliases();
      await refetchBilling();
    } catch (err: any) {
      setBanner({
        kind: "error",
        text: err?.message || "Failed to delete mailbox.",
      });
    } finally {
      setIsDeletingMailbox(false);
    }
  }

  async function handleCreateAlias(e: Event) {
    e.preventDefault();
    const mbId = aliasTargetMailboxId().trim();
    const lp = aliasLocalPart().trim();
    const domId = aliasDomainId().trim();
    if (!mbId || !lp || !domId) return;

    setIsCreatingAlias(true);
    setBanner(null);
    try {
      await createAlias(mbId, lp, domId);
      setAliasLocalPart("");
      await refetchAliases();
      setBanner({ kind: "success", text: `Alias ${lp}@${getDomainName(domId)} created successfully.` });
      setTimeout(() => setBanner(null), 4000);
    } catch (e: any) {
      let msg = e instanceof Error ? e.message : "";
      let errorDetail = "";
      try {
        const parsed = JSON.parse(msg);
        if (parsed.error) errorDetail = parsed.error;
      } catch {}
      const status = e?.status;
      if (status === 402 || errorDetail === "alias_limit_reached" || msg.includes("alias_limit_reached")) {
        setBanner({
          kind: "error",
          text: `Alias limit reached for this mailbox. Upgrade your plan in Billing to add more aliases.`,
        });
      } else if (status === 409 || msg.includes("already exists") || errorDetail.includes("already exists")) {
        setBanner({ kind: "error", text: "This email alias already exists on this domain." });
      } else if (status === 400 && (msg.includes("local_part") || errorDetail.includes("local_part"))) {
        setBanner({ kind: "error", text: "Invalid alias username (cannot contain spaces, @, or special symbols)." });
      } else {
        setBanner({ kind: "error", text: errorDetail || msg || "Failed to create alias." });
      }
      setTimeout(() => setBanner(null), 7000);
    } finally {
      setIsCreatingAlias(false);
    }
  }

  async function handleDeleteAlias(mailboxId: string, aliasId: string, address: string) {
    if (!confirm(`Are you sure you want to delete alias ${address}? Incoming emails to this address will bounce.`)) {
      return;
    }
    setIsDeletingAlias(aliasId);
    try {
      await deleteAlias(mailboxId, aliasId);
      await refetchAliases();
      setBanner({ kind: "success", text: `Alias ${address} deleted.` });
      setTimeout(() => setBanner(null), 3000);
    } catch (e: any) {
      setBanner({ kind: "error", text: "Failed to delete alias." });
      setTimeout(() => setBanner(null), 5000);
    } finally {
      setIsDeletingAlias("");
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

  const getDomainName = (domainId: string) => {
    const found = (domains() ?? []).find((d) => d.id === domainId);
    return found ? found.name : domainId.slice(0, 8);
  };

  return (
    <div class="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page Header & Quota Card */}
      <div class="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
            Mailbox Provisioning
          </h1>
          <p class="mt-1 text-sm text-[#6F7173]">
            Create and manage zero-knowledge encrypted mailboxes under verified organizational domains.
          </p>
        </div>

        <Show when={billing()}>
          {(b) => (
            <div class="flex items-center gap-3 bg-white border border-[#E2DFD8] rounded-xl px-4 py-2.5 shadow-xs shrink-0">
              <div class="text-right">
                <div class="text-[10px] font-bold uppercase tracking-wider text-[#6F7173]">
                  {b().plan.toUpperCase()} PLAN
                </div>
                <div class="text-xs font-semibold text-[#3C3D3E]">
                  <span class={isQuotaFull() ? "text-amber-600 font-bold" : "text-[#9E725F] font-bold"}>
                    {mailboxCount()}
                  </span>
                  <span class="text-[#6F7173]"> / {b().mailbox_limit} mailboxes</span>
                </div>
              </div>
              <div class="w-16 bg-[#F0EEE9] h-2 rounded-full overflow-hidden">
                <div
                  class={`h-full transition-all ${
                    isQuotaFull() ? "bg-amber-500" : "bg-[#9E725F]"
                  }`}
                  style={{
                    width: `${Math.min(100, Math.round((mailboxCount() / (b().mailbox_limit || 1)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </Show>
      </div>

      {/* View Switcher Tabs */}
      <div class="flex items-center gap-2 mb-6 border-b border-[#E2DFD8] pb-3">
        <button
          type="button"
          onClick={() => setActiveTab("mailboxes")}
          class={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab() === "mailboxes"
              ? "bg-[#9E725F] text-white shadow-xs"
              : "text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F3ECE8]"
          }`}
        >
          <span>Mailboxes</span>
          <span
            class={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold ${
              activeTab() === "mailboxes"
                ? "bg-white/20 text-white"
                : "bg-[#F0EEE9] text-[#6F7173]"
            }`}
          >
            {mailboxCount()}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("aliases")}
          class={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeTab() === "aliases"
              ? "bg-[#9E725F] text-white shadow-xs"
              : "text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F3ECE8]"
          }`}
        >
          <span>Email Aliases</span>
          <span
            class={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold ${
              activeTab() === "aliases"
                ? "bg-white/20 text-white"
                : "bg-[#F0EEE9] text-[#6F7173]"
            }`}
          >
            {aliasCount()}
          </span>
        </button>
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

      {/* Mailboxes Tab */}
      <Show when={activeTab() === "mailboxes"}>
        {/* Creation Form or Invite Success Card */}
        <Show
          when={createdInvite()}
          fallback={
            <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs mb-8">
              <h3 class="text-sm font-bold text-[#3C3D3E] mb-1">Create New Mailbox</h3>
              <p class="text-xs text-[#6F7173] mb-4">
                Provision a user mailbox with a single-use onboarding invitation. The invited user sets their own password and initializes their client-side keys.
              </p>

              <Show when={isQuotaFull()}>
                <div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-800 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-sm">⚠️</span>
                    <span>
                      <strong>Plan Limit Reached:</strong> Your {billing()?.plan || "current"} plan allows up to {mailboxLimit()} mailbox(es).
                      Upgrade your subscription to provision additional mailboxes.
                    </span>
                  </div>
                  <a
                    href="/dashboard/billing"
                    class="font-bold text-amber-900 underline hover:text-amber-950 whitespace-nowrap ml-4 text-[11px]"
                  >
                    Upgrade in Billing →
                  </a>
                </div>
              </Show>

              <form onSubmit={handleCreate} class="space-y-4">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                      Display Name
                    </label>
                    <input
                      type="text"
                      disabled={isQuotaFull()}
                      value={displayName()}
                      onInput={(e) => setDisplayName(e.currentTarget.value)}
                      placeholder="Alice Smith"
                      class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                      Local Part (Username)
                    </label>
                    <div class="flex items-center rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm focus-within:border-[#9E725F] focus-within:ring-2 focus-within:ring-[#9E725F]/20">
                      <input
                        type="text"
                        required
                        disabled={isQuotaFull()}
                        value={localPart()}
                        onInput={(e) => setLocalPart(e.currentTarget.value)}
                        placeholder="alice"
                        class="w-full text-sm text-[#3C3D3E] focus:outline-none disabled:bg-transparent disabled:text-[#6F7173]"
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
                      disabled={isQuotaFull()}
                      onChange={(e) => setSelectedDomainId(e.currentTarget.value)}
                      class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none disabled:opacity-60"
                    >
                      <option value="">Select domain…</option>
                      <For each={verifiedDomains()}>
                        {(d) => <option value={d.id}>{d.name}</option>}
                      </For>
                    </select>
                  </div>
                </div>

                {/* Zero-Knowledge Privacy Architecture Guarantee */}
                <div class="rounded-xl border border-emerald-200/80 bg-emerald-50/60 p-4 flex items-center gap-3.5">
                  <div class="w-9 h-9 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0 text-emerald-700">
                    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                  </div>
                  <div>
                    <div class="text-xs font-bold text-emerald-950 flex items-center gap-2">
                      <span>Zero-Knowledge End-to-End Encryption</span>
                      <span class="rounded-full bg-emerald-100/90 text-emerald-800 text-[10px] font-mono font-bold px-2 py-0.5 border border-emerald-200">
                        Default
                      </span>
                    </div>
                    <p class="text-[11px] text-emerald-800/90 mt-0.5 leading-relaxed">
                      Mailbox private keys are generated and held exclusively by the user. Administrators cannot read or decrypt employee messages.
                    </p>
                  </div>
                </div>

                <div class="flex items-center justify-between pt-2">
                  <Show when={verifiedDomains().length === 0 && !domains.loading}>
                    <span class="text-xs text-amber-700 flex items-center gap-1.5">
                      <svg class="w-3.5 h-3.5 stroke-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      No verified domains available. Verify a domain in Domains tab first.
                    </span>
                  </Show>
                  <span />
                  <button
                    type="submit"
                    disabled={!localPart().trim() || !selectedDomainId() || isCreating() || isQuotaFull()}
                    class="rounded-lg bg-[#9E725F] px-6 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] disabled:opacity-50 transition-colors"
                  >
                    {isCreating() ? "Generating Invitation…" : isQuotaFull() ? "Limit Reached" : "Generate Setup Link"}
                  </button>
                </div>
              </form>
            </div>
          }
        >
          {(invite) => (
            <div class="rounded-2xl border border-emerald-300 bg-emerald-50/40 p-6 shadow-xs mb-8">
              <div class="flex items-start justify-between">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-800 font-bold">
                    <svg class="w-5 h-5 stroke-emerald-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-[#3C3D3E]">Mailbox Created — Share Setup Link</h3>
                    <p class="text-xs text-[#6F7173]">
                      Onboarding invitation generated for <strong class="text-[#3C3D3E] font-mono">{invite().email}</strong> (
                      {invite().privacy_mode === "private" ? "Private Mode" : "Organization-Managed"}
                      ).
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCreatedInvite(null)}
                  class="text-xs font-semibold text-[#6F7173] hover:text-[#3C3D3E] px-3 py-1.5 rounded-lg border border-[#E2DFD8] bg-white shadow-2xs hover:bg-[#F0EEE9]"
                >
                  + Create Another
                </button>
              </div>

              <div class="mt-4 p-4 bg-white rounded-xl border border-[#E2DFD8]">
                <label class="block text-[10px] font-bold uppercase tracking-wider text-[#6F7173] mb-1.5">
                  Single-Use Activation Link (Expires in 7 Days)
                </label>
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    readonly
                    value={invite().invite_url}
                    class="flex-1 font-mono text-xs bg-[#F0EEE9]/50 border border-[#E2DFD8] rounded-lg px-3 py-2 text-[#3C3D3E] select-all focus:outline-none"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyInvite(invite().invite_url)}
                    class={`px-4 py-2 text-xs font-semibold rounded-lg transition-all ${
                      copiedLink()
                        ? "bg-emerald-600 text-white"
                        : "bg-[#9E725F] hover:bg-[#865E4D] text-white shadow-xs"
                    }`}
                  >
                    {copiedLink() ? "Copied!" : "Copy Link"}
                  </button>
                </div>
              </div>

              <div class="mt-4 rounded-xl bg-amber-50/90 border border-amber-200 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
                <svg class="w-4 h-4 shrink-0 stroke-amber-700 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <div class="leading-relaxed">
                  <strong>User Key Initialization:</strong> The user must open this link to set their own password and initialize their client-side cryptographic keys. Administrators cannot set passwords for users.
                </div>
              </div>
            </div>
          )}
        </Show>

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
                    <th class="px-6 py-3 text-left">Status</th>
                    <th class="px-6 py-3 text-left">Aliases</th>
                    <th class="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[#E2DFD8] bg-white text-xs text-[#3C3D3E]">
                  <For each={mailboxes() ?? []}>
                    {(mb) => {
                      const lp = mb.local_part || (mb as any).localPart;
                      const dom = mb.domain_name || getDomainName(mb.domain_id || (mb as any).domainId);
                      const emailAddr = mb.email || `${lp}@${dom}`;
                      const isPending = mb.status === "pending_activation";
                      const aliasTargetCount = () => (aliases() ?? []).filter((a) => a.mailbox_id === mb.id).length;
                      const pendingInviteUrl = () => knownInvites()[mb.id] || knownInvites()[emailAddr];

                      return (
                        <tr class="hover:bg-[#F0EEE9]/30 transition-colors">
                          <td class="px-6 py-3.5">
                            <div class="font-medium text-[#3C3D3E]">{emailAddr}</div>
                            <div class="font-mono text-[10px] text-[#6F7173] mt-0.5">
                              {mb.id.slice(0, 8)}…{mb.id.slice(-4)}
                            </div>
                          </td>
                          <td class="px-6 py-3.5">
                            <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase bg-emerald-50 text-emerald-800 border border-emerald-200">
                              <svg class="w-3 h-3 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                              </svg>
                              Zero-Knowledge
                            </span>
                          </td>
                          <td class="px-6 py-3.5">
                            <Show
                              when={isPending}
                              fallback={
                                <span class="inline-flex items-center gap-1.5 text-emerald-700 font-semibold text-[11px]">
                                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                  Active
                                </span>
                              }
                            >
                              <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-bold text-amber-700">
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                Pending Activation
                              </span>
                            </Show>
                          </td>
                          <td class="px-6 py-3.5">
                            <div class="flex items-center gap-2">
                              <span class="font-mono text-[11px] text-[#6F7173]">
                                {aliasTargetCount()}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setAliasTargetMailboxId(mb.id);
                                  setActiveTab("aliases");
                                }}
                                class="text-[11px] font-semibold text-[#9E725F] hover:text-[#865E4D] hover:underline"
                              >
                                + Add Alias
                              </button>
                            </div>
                          </td>
                          <td class="px-6 py-3.5 text-right">
                            <div class="flex items-center justify-end gap-2">
                              <Show when={isPending}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const url = pendingInviteUrl();
                                    if (url) {
                                      handleCopyInvite(url);
                                    } else {
                                      setBanner({
                                        kind: "error",
                                        text: "Invitation URL was generated earlier. For security, re-invite or check your records.",
                                      });
                                    }
                                  }}
                                  class="text-[11px] font-semibold text-[#9E725F] hover:text-[#865E4D] border border-[#E2DFD8] rounded-md px-2.5 py-1 bg-white hover:bg-[#F3ECE8] transition-colors"
                                >
                                  Copy Setup Link
                                </button>
                              </Show>
                              <button
                                type="button"
                                onClick={() => setDeleteTargetMailbox(mb)}
                                class="rounded-md border border-rose-200 bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 px-2.5 py-1 text-[11px] font-semibold transition-colors shadow-2xs cursor-pointer"
                                title="Delete Mailbox"
                              >
                                Delete
                              </button>
                            </div>
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

        {/* Delete Mailbox Confirmation Modal */}
        <Show when={deleteTargetMailbox()}>
          {(mb) => (
            <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
              <div class="w-full max-w-md bg-white rounded-2xl border border-[#E2DFD8] shadow-2xl p-6 space-y-4 font-sans">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-full bg-rose-100 border border-rose-200 flex items-center justify-center text-rose-600">
                    <svg class="w-5 h-5 stroke-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </div>
                  <div>
                    <h3 class="text-sm font-bold text-[#3C3D3E]">Delete Mailbox</h3>
                    <p class="text-xs text-[#6F7173]">Decommission mailbox and revoke credentials</p>
                  </div>
                </div>

                <div class="p-3.5 bg-rose-50/80 border border-rose-200 rounded-xl text-xs text-rose-900 leading-relaxed space-y-2">
                  <p>
                    Are you sure you want to delete <strong class="font-mono">{mb().email || mb().local_part}</strong>?
                  </p>
                  <ul class="list-disc pl-4 space-y-1 text-[11px] text-rose-700">
                    <li>Mailbox routing and outbound sending will be permanently disabled.</li>
                    <li>Active sessions and device credentials will be immediately revoked.</li>
                    <li>Associated aliases will be released.</li>
                  </ul>
                </div>

                <div class="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    disabled={isDeletingMailbox()}
                    onClick={() => setDeleteTargetMailbox(null)}
                    class="px-4 py-2 text-xs font-semibold text-[#6F7173] hover:text-[#3C3D3E] rounded-lg border border-[#E2DFD8] hover:bg-[#F0EEE9] transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isDeletingMailbox()}
                    onClick={handleDeleteMailbox}
                    class="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isDeletingMailbox() ? "Deleting…" : "Delete Mailbox"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Show>

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
      </Show>

      {/* Aliases Tab */}
      <Show when={activeTab() === "aliases"}>
        {/* Create Alias Card */}
        <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs mb-8">
          <div class="flex items-center justify-between mb-1">
            <h3 class="text-sm font-bold text-[#3C3D3E]">Create New Email Alias</h3>
            <span class="rounded-full bg-[#F3ECE8] px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#9E725F]">
              Max {billing()?.aliases_per_mail ?? 20} per mailbox
            </span>
          </div>
          <p class="text-xs text-[#6F7173] mb-4">
            Provision an alternate address (such as <code class="bg-[#F0EEE9] px-1 py-0.5 rounded text-[#9E725F] font-mono text-[11px]">support@</code>, <code class="bg-[#F0EEE9] px-1 py-0.5 rounded text-[#9E725F] font-mono text-[11px]">billing@</code>, or <code class="bg-[#F0EEE9] px-1 py-0.5 rounded text-[#9E725F] font-mono text-[11px]">team@</code>) that automatically delivers incoming emails to a primary employee mailbox.
          </p>

          <form onSubmit={handleCreateAlias} class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                Alias Username
              </label>
              <div class="flex items-center rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm focus-within:border-[#9E725F] focus-within:ring-2 focus-within:ring-[#9E725F]/20">
                <input
                  type="text"
                  required
                  value={aliasLocalPart()}
                  onInput={(e) => setAliasLocalPart(e.currentTarget.value)}
                  placeholder="support"
                  class="w-full text-sm text-[#3C3D3E] focus:outline-none"
                />
                <span class="text-[#6F7173] font-mono text-xs">@</span>
              </div>
            </div>

            <div>
              <label class="block text-[11px] font-bold uppercase text-[#6F7173] mb-1">
                Domain
              </label>
              <select
                value={aliasDomainId()}
                onChange={(e) => setAliasDomainId(e.currentTarget.value)}
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
                Forward To (Target Mailbox)
              </label>
              <select
                value={aliasTargetMailboxId()}
                onChange={(e) => setAliasTargetMailboxId(e.currentTarget.value)}
                class="w-full rounded-lg border border-[#E2DFD8] bg-white px-3 py-2 text-sm text-[#3C3D3E] focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 focus:outline-none"
              >
                <option value="">Select target mailbox…</option>
                <For each={mailboxes() ?? []}>
                  {(mb) => (
                    <option value={mb.id}>
                      {mb.local_part}@{getDomainName(mb.domain_id)}
                    </option>
                  )}
                </For>
              </select>
            </div>

            {/* Live Routing Preview Pill */}
            <Show when={aliasLocalPart().trim() && aliasDomainId() && aliasTargetMailboxId()}>
              <div class="md:col-span-3 bg-[#F0EEE9]/70 rounded-xl p-3 border border-[#E2DFD8] flex items-center gap-2 text-xs">
                <span class="text-[10px] font-mono font-bold uppercase tracking-wider text-[#9E725F]">
                  Routing Preview:
                </span>
                <span class="font-semibold text-[#3C3D3E]">
                  {aliasLocalPart().trim()}@{getDomainName(aliasDomainId())}
                </span>
                <span class="text-[#9E725F] font-bold">➔</span>
                <span class="font-semibold text-[#3C3D3E]">
                  {(() => {
                    const mb = (mailboxes() ?? []).find((m) => m.id === aliasTargetMailboxId());
                    return mb ? `${mb.local_part}@${getDomainName(mb.domain_id)}` : "";
                  })()}
                </span>
              </div>
            </Show>

            <div class="md:col-span-3 flex items-center justify-between pt-2">
              <span class="text-xs text-[#6F7173]">
                Aliases do not incur additional seat costs and share the storage and keys of the target mailbox.
              </span>
              <button
                type="submit"
                disabled={!aliasLocalPart().trim() || !aliasDomainId() || !aliasTargetMailboxId() || isCreatingAlias()}
                class="rounded-lg bg-[#9E725F] px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] disabled:opacity-50 transition-colors shrink-0"
              >
                {isCreatingAlias() ? "Creating…" : "Create Alias"}
              </button>
            </div>
          </form>
        </div>

        {/* Configured Aliases List Card */}
        <div class="rounded-2xl border border-[#E2DFD8] bg-white shadow-xs overflow-hidden mb-8">
          <div class="p-6 border-b border-[#E2DFD8] flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
                Configured Email Aliases
              </span>
              <span class="rounded-full bg-[#F0EEE9] px-2 py-0.5 font-mono text-[11px] font-bold text-[#3C3D3E]">
                {(aliases() || []).length}
              </span>
            </div>
          </div>

          <Show when={aliases.loading}>
            <div class="p-8 text-center text-xs text-[#6F7173]">Loading aliases…</div>
          </Show>

          <Show when={!aliases.loading && (aliases() ?? []).length === 0}>
            <div class="p-8 text-center text-xs text-[#6F7173]">
              No email aliases configured yet. Create your first alias above to route messages to any primary mailbox.
            </div>
          </Show>

          <Show when={(aliases() ?? []).length > 0}>
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-[#E2DFD8]">
                <thead class="bg-[#F0EEE9]/60 font-semibold text-[#6F7173] text-xs">
                  <tr>
                    <th class="px-6 py-3 text-left">Alias Address</th>
                    <th class="px-6 py-3 text-left">Routes To (Primary Mailbox)</th>
                    <th class="px-6 py-3 text-left">Status</th>
                    <th class="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[#E2DFD8] bg-white text-xs text-[#3C3D3E]">
                  <For each={aliases() ?? []}>
                    {(a) => {
                      const aliasAddr = a.alias_address || `${a.local_part}@${a.domain_name || getDomainName(a.domain_id)}`;
                      const targetAddr = a.mailbox_address || `${a.mailbox_local_part}@${getDomainName(a.domain_id)}`;
                      return (
                        <tr class="hover:bg-[#F0EEE9]/30 transition-colors">
                          <td class="px-6 py-3.5 font-semibold text-[#3C3D3E]">
                            {aliasAddr}
                          </td>
                          <td class="px-6 py-3.5 text-[#6F7173]">
                            <span class="inline-flex items-center gap-1.5">
                              <span class="text-[#9E725F]">➔</span>
                              <span class="font-medium text-[#3C3D3E]">{targetAddr}</span>
                            </span>
                          </td>
                          <td class="px-6 py-3.5">
                            <span class="inline-flex items-center gap-1 text-emerald-700 font-semibold text-[11px]">
                              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Active
                            </span>
                          </td>
                          <td class="px-6 py-3.5 text-right">
                            <button
                              type="button"
                              disabled={isDeletingAlias() === a.id}
                              onClick={() => handleDeleteAlias(a.mailbox_id, a.id, aliasAddr)}
                              class="text-xs text-red-600 hover:text-red-800 font-medium hover:underline disabled:opacity-50"
                            >
                              {isDeletingAlias() === a.id ? "Deleting…" : "Delete"}
                            </button>
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
      </Show>
    </div>
  );
};

export default MailboxesPage;
