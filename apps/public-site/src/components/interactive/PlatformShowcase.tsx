import { createSignal, For } from "solid-js";

export function PlatformShowcase() {
  const [tab, setTab] = createSignal<"webmail" | "domains" | "admin">("webmail");

  const mailboxNav = [
    { label: "Inbox", count: "24", active: true },
    { label: "Sent", count: "", active: false },
    { label: "Drafts", count: "3", active: false },
    { label: "Archive", count: "", active: false },
    { label: "Contacts", count: "", active: false },
  ];

  const emails = [
    { from: "Maria Chen", subj: "Q3 board deck — final review", time: "9:41 AM", unread: true },
    { from: "Billing", subj: "Invoice #2048 scheduled for processing", time: "8:12 AM", unread: false },
    { from: "Dev Team", subj: "Release notes v1.4 ready for review", time: "Yesterday", unread: false },
    { from: "Priya N.", subj: "Re: Contract redlines and security spec", time: "Yesterday", unread: false },
  ];

  const domainList = [
    { addr: "hello@acme.com", type: "Primary Mailbox", status: "Active" },
    { addr: "sales@acme.com", type: "Shared Alias", status: "Active" },
    { addr: "support@acme.com", type: "Team Alias", status: "Active" },
    { addr: "billing@acme.com", type: "Inbound Alias", status: "Active" },
  ];

  const adminControls = [
    { name: "Domain Management", desc: "MX, DKIM & SPF verification", badge: "Verified" },
    { name: "Mailbox Privacy Mode", desc: "Organization-managed or Private", badge: "Managed" },
    { name: "Storage Connections", desc: "Amazon S3, Google Drive, R2", badge: "Connected" },
    { name: "Team Provisioning", desc: "User access & role policies", badge: "12 Users" },
  ];

  const tabs: Array<{ id: "webmail" | "domains" | "admin"; label: string }> = [
    { id: "webmail", label: "Webmail Client" },
    { id: "domains", label: "Domains & Aliases" },
    { id: "admin", label: "Admin Console" },
  ];

  return (
    <div class="card-editorial bg-white p-6 sm:p-8 shadow-sm border border-[#E2DFD8]">
      {/* Tabs Header */}
      <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between border-b border-[#E2DFD8] pb-6 gap-4">
        <div>
          <span class="eyebrow">The Experience</span>
          <h3 class="mt-1 font-display text-2xl font-bold text-[#2B2C2D]">
            A complete, believable mailbox experience.
          </h3>
        </div>

        <div
          role="tablist"
          aria-label="Platform Showcase Sections"
          class="grid grid-cols-1 sm:grid-cols-3 gap-1.5 w-full sm:w-auto rounded-xl border border-[#E2DFD8] bg-[#F4F2EC] p-1.5"
        >
          <For each={tabs}>
            {(t) => (
              <button
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-controls={`panel-${t.id}`}
                aria-selected={tab() === t.id}
                onClick={() => setTab(t.id)}
                class={`px-4 py-2.5 min-h-[44px] rounded-lg text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E725F] focus-visible:ring-offset-2 ${
                  tab() === t.id
                    ? "bg-[#9E725F] text-white shadow-xs"
                    : "text-[#6F7173] hover:text-[#2B2C2D]"
                }`}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Tab 1: Webmail Client */}
      {tab() === "webmail" && (
        <div
          role="tabpanel"
          id="panel-webmail"
          aria-labelledby="tab-webmail"
          class="mt-6 rounded-2xl border border-[#E2DFD8] bg-[#FBFAF7] overflow-hidden shadow-xs"
        >
          <div class="flex items-center gap-2 border-b border-[#E2DFD8] bg-[#F4F2EC] px-4 py-3">
            <div class="flex gap-1.5">
              <span class="h-2.5 w-2.5 rounded-full bg-[#E2DFD8]"></span>
              <span class="h-2.5 w-2.5 rounded-full bg-[#E2DFD8]"></span>
              <span class="h-2.5 w-2.5 rounded-full bg-[#E2DFD8]"></span>
            </div>
            <span class="ml-3 text-xs font-mono text-[#6F7173]">BYOS Webmail — Inbox</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-12 min-h-[280px]">
            {/* Sidebar */}
            <div class="md:col-span-4 border-r border-[#E2DFD8] bg-[#F4F2EC]/50 p-3 space-y-1">
              <button
                type="button"
                class="w-full mb-3 min-h-[44px] px-3 py-2 btn-primary text-xs font-semibold rounded-lg flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9E725F] focus-visible:ring-offset-2"
              >
                <svg
                  class="h-4 w-4 stroke-2"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Compose Message
              </button>

              <For each={mailboxNav}>
                {(item) => (
                  <div
                    class={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium cursor-pointer ${
                      item.active
                        ? "bg-[#9E725F] text-white font-semibold"
                        : "text-[#3C3D3E] hover:bg-white/60"
                    }`}
                  >
                    <span>{item.label}</span>
                    {item.count && (
                      <span
                        class={`text-[10px] font-mono px-1.5 py-0.5 rounded-md ${
                          item.active ? "bg-white/20 text-white" : "bg-[#E2DFD8] text-[#6F7173]"
                        }`}
                      >
                        {item.count}
                      </span>
                    )}
                  </div>
                )}
              </For>
            </div>

            {/* Email list */}
            <div class="md:col-span-8 divide-y divide-[#E2DFD8] bg-white">
              <For each={emails}>
                {(e) => (
                  <div class="flex items-center gap-3 px-4 py-3.5 hover:bg-[#F3ECE8]/40 cursor-pointer transition-colors">
                    <span
                      class={`h-2 w-2 rounded-full shrink-0 ${
                        e.unread ? "bg-[#9E725F]" : "bg-transparent"
                      }`}
                    ></span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center justify-between">
                        <span
                          class={`text-xs ${
                            e.unread ? "font-bold text-[#2B2C2D]" : "font-medium text-[#3C3D3E]"
                          }`}
                        >
                          {e.from}
                        </span>
                        <span class="text-[10px] font-mono text-[#8B8E91]">{e.time}</span>
                      </div>
                      <p class="truncate text-xs text-[#6F7173] mt-0.5">{e.subj}</p>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Domains & Aliases */}
      {tab() === "domains" && (
        <div
          role="tabpanel"
          id="panel-domains"
          aria-labelledby="tab-domains"
          class="mt-6 rounded-2xl border border-[#E2DFD8] bg-white overflow-hidden shadow-xs"
        >
          <div class="flex items-center justify-between border-b border-[#E2DFD8] bg-[#F4F2EC] px-5 py-3.5">
            <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#2B2C2D]">
              Domain: acme.com
            </span>
            <span class="shrink-0 rounded-full border border-[#9E725F]/30 bg-[#F3ECE8] px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#865E4D]">
              DNS Active & Verified
            </span>
          </div>

          <div class="divide-y divide-[#E2DFD8]">
            <For each={domainList}>
              {(item) => (
                <div class="flex items-center justify-between px-5 py-4 hover:bg-[#FBFAF7] transition-colors">
                  <div class="flex items-center gap-3">
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F3ECE8] border border-[#9E725F]/20 text-[#9E725F] font-mono text-xs font-bold shrink-0">
                      @
                    </div>
                    <div>
                      <div class="text-sm font-mono font-bold text-[#2B2C2D]">{item.addr}</div>
                      <div class="text-xs text-[#6F7173]">{item.type}</div>
                    </div>
                  </div>
                  <span class="shrink-0 text-[11px] font-mono uppercase tracking-wider text-[#865E4D] font-semibold">
                    {item.status}
                  </span>
                </div>
              )}
            </For>
          </div>

          <div class="border-t border-[#E2DFD8] bg-[#F4F2EC]/60 px-5 py-3 text-xs text-[#6F7173] flex justify-between items-center">
            <span>DKIM 2048-bit RSA · SPF pass · DMARC p=reject</span>
            <span class="font-mono text-[#9E725F] font-semibold">+ Add Alias</span>
          </div>
        </div>
      )}

      {/* Tab 3: Admin Console */}
      {tab() === "admin" && (
        <div
          role="tabpanel"
          id="panel-admin"
          aria-labelledby="tab-admin"
          class="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <For each={adminControls}>
            {(ctrl) => (
              <div class="rounded-2xl border border-[#E2DFD8] bg-[#FBFAF7] p-5 hover:border-[#9E725F]/40 transition-all">
                <div class="flex items-center justify-between gap-2">
                  <h4 class="font-display text-base font-bold text-[#2B2C2D]">{ctrl.name}</h4>
                  <span class="shrink-0 rounded-md border border-[#9E725F]/20 bg-[#F3ECE8] px-2.5 py-0.5 text-[10px] font-mono font-bold text-[#865E4D]">
                    {ctrl.badge}
                  </span>
                </div>
                <p class="mt-2 text-xs text-[#6F7173] leading-relaxed">{ctrl.desc}</p>
              </div>
            )}
          </For>
        </div>
      )}
    </div>
  );
}
