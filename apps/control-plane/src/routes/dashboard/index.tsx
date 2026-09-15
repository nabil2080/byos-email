import { Component, createResource, createSignal, Show } from "solid-js";
import { A } from "@solidjs/router";
import { useOrg } from "../../context/OrgContext";
import { listDomains } from "../../lib/api/domains";
import { listMailboxes } from "../../lib/api/mailboxes";
import { getStorageConnection } from "../../lib/api/storage";

const DashboardOverview: Component = () => {
  const org = useOrg();
  const [copiedOrgId, setCopiedOrgId] = createSignal(false);

  const handleCopyOrgId = async () => {
    if (!org.orgId) return;
    try {
      await navigator.clipboard.writeText(org.orgId);
      setCopiedOrgId(true);
      setTimeout(() => setCopiedOrgId(false), 2000);
    } catch {
      // Fallback
    }
  };

  const [domains] = createResource(
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

  const [mailboxes] = createResource(
    () => org.orgId,
    async (id) => {
      if (!id) return [];
      try {
        return await listMailboxes(id);
      } catch {
        return [];
      }
    }
  );

  const [storage] = createResource(
    () => org.orgId,
    async (id) => {
      if (!id) return null;
      try {
        return await getStorageConnection(id);
      } catch {
        return null;
      }
    }
  );

  const verifiedDomainsCount = () =>
    (domains() || []).filter((d) => d.is_verified || d.verified).length;

  return (
    <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Banner / Org Header */}
      <div class="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
              Organization Overview
            </h1>
            <span class="rounded-full bg-[#9E725F]/15 px-3 py-0.5 text-xs font-mono font-bold uppercase text-[#9E725F]">
              {org.plan} Plan
            </span>
          </div>
          <p class="mt-1 text-sm text-[#6F7173]">
            Sovereign administrative control plane for encrypted corporate communications.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <A
            href="/dashboard/domains"
            class="inline-flex items-center gap-2 rounded-lg bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors"
          >
            <span>+ Add Domain</span>
          </A>
          <A
            href="/dashboard/mailboxes"
            class="inline-flex items-center gap-2 rounded-lg border border-[#E2DFD8] bg-white px-4 py-2 text-xs font-semibold text-[#3C3D3E] shadow-xs hover:bg-[#F3ECE8] hover:text-[#9E725F] transition-colors"
          >
            <span>+ New Mailbox</span>
          </A>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
        {/* Domains Metric */}
        <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
              Custom Domains
            </span>
            <span class="w-8 h-8 rounded-lg bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </span>
          </div>
          <div class="my-4">
            <div class="text-3xl font-bold text-[#3C3D3E]">
              {domains.loading ? "…" : (domains() || []).length}
            </div>
            <div class="mt-1 text-xs text-[#6F7173] flex items-center gap-2">
              <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>{verifiedDomainsCount()} Verified</span>
              <span class="text-[#E2DFD8]">|</span>
              <span>{(domains() || []).length - verifiedDomainsCount()} Pending</span>
            </div>
          </div>
          <A
            href="/dashboard/domains"
            class="text-xs font-semibold text-[#9E725F] hover:text-[#865E4D] hover:underline inline-flex items-center gap-1"
          >
            Manage DNS & Domains →
          </A>
        </div>

        {/* Mailboxes Metric */}
        <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
              Mailboxes
            </span>
            <span class="w-8 h-8 rounded-lg bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </span>
          </div>
          <div class="my-4">
            <div class="text-3xl font-bold text-[#3C3D3E]">
              {mailboxes.loading ? "…" : (mailboxes() || []).length}
            </div>
            <div class="mt-1 text-xs text-[#6F7173]">
              Zero-knowledge client encrypted
            </div>
          </div>
          <A
            href="/dashboard/mailboxes"
            class="text-xs font-semibold text-[#9E725F] hover:text-[#865E4D] hover:underline inline-flex items-center gap-1"
          >
            Manage Mailboxes →
          </A>
        </div>

        {/* Storage Metric */}
        <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs flex flex-col justify-between">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold uppercase tracking-wider text-[#6F7173]">
              Persistent Storage
            </span>
            <span class="w-8 h-8 rounded-lg bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </span>
          </div>
          <div class="my-4">
            <div class="text-lg font-bold text-[#3C3D3E] capitalize truncate">
              {storage.loading
                ? "Checking…"
                : storage()?.provider
                ? `${storage()?.provider} Connected`
                : "Not Configured"}
            </div>
            <div class="mt-1 text-xs text-[#6F7173]">
              {storage()?.bucket_name ? `Bucket: ${storage()?.bucket_name}` : "Customer-controlled S3 / MinIO"}
            </div>
          </div>
          <A
            href="/dashboard/storage"
            class="text-xs font-semibold text-[#9E725F] hover:text-[#865E4D] hover:underline inline-flex items-center gap-1"
          >
            Configure Storage →
          </A>
        </div>
      </div>

      {/* Quick Launch & Security Status Section */}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Organization Information Card */}
        <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs">
          <h2 class="text-base font-bold text-[#3C3D3E] mb-4">
            Organization Identity & Cryptography
          </h2>
          <div class="space-y-3 font-mono text-xs">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-[#F0EEE9]/60 border border-[#E2DFD8] gap-2">
              <span class="text-[#6F7173]">Organization ID:</span>
              <div class="flex items-center gap-2">
                <span class="text-[#3C3D3E] font-semibold select-all break-all">
                  {org.orgId || "—"}
                </span>
                <Show when={org.orgId}>
                  <button
                    type="button"
                    onClick={handleCopyOrgId}
                    title="Copy Organization ID"
                    aria-label="Copy Organization ID"
                    class="p-1.5 rounded-md hover:bg-[#F3ECE8] text-[#6F7173] hover:text-[#9E725F] transition-colors shrink-0"
                  >
                    <Show when={copiedOrgId()} fallback={
                      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                      </svg>
                    }>
                      <span class="inline-flex items-center gap-1 text-[11px] font-sans font-medium text-emerald-700">
                        <svg class="w-3.5 h-3.5 stroke-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Copied
                      </span>
                    </Show>
                  </button>
                </Show>
              </div>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-[#F0EEE9]/60 border border-[#E2DFD8] gap-1">
              <span class="text-[#6F7173]">Authenticated Role:</span>
              <span class="text-[#9E725F] font-bold uppercase">{org.role || "Admin"}</span>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg bg-[#F0EEE9]/60 border border-[#E2DFD8] gap-1">
              <span class="text-[#6F7173]">Root Key Rotation:</span>
              <span class="text-emerald-700 font-semibold">Active & Enrolled</span>
            </div>
          </div>
        </div>

        {/* Quick Help & Next Steps Card */}
        <div class="rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h2 class="text-base font-bold text-[#3C3D3E] mb-2">
              Getting Started Checklist
            </h2>
            <p class="text-xs text-[#6F7173] mb-4">
              Complete the following steps to ensure end-to-end email delivery and storage sovereignty:
            </p>
            <ul class="space-y-2.5 text-xs text-[#3C3D3E]">
              <li class="flex items-center gap-2.5">
                <span class={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${verifiedDomainsCount() > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {verifiedDomainsCount() > 0 ? "✓" : "1"}
                </span>
                <span>Add and verify your custom DNS TXT/MX records</span>
              </li>
              <li class="flex items-center gap-2.5">
                <span class={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${storage()?.provider ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {storage()?.provider ? "✓" : "2"}
                </span>
                <span>Connect your S3, MinIO, or Cloud persistent storage bucket</span>
              </li>
              <li class="flex items-center gap-2.5">
                <span class={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${(mailboxes() || []).length > 0 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {(mailboxes() || []).length > 0 ? "✓" : "3"}
                </span>
                <span>Create employee mailboxes and assign cryptographic keys</span>
              </li>
            </ul>
          </div>
          <div class="mt-6 pt-4 border-t border-[#E2DFD8] flex items-center justify-between text-xs">
            <span class="text-[#6F7173]">Need architecture documentation?</span>
            <A href="/dashboard/settings" class="font-semibold text-[#9E725F] hover:underline">
              System Settings →
            </A>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardOverview;
