import { Component } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { useOrg } from "../../context/OrgContext";

const nav = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: () => (
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    label: "Domains",
    href: "/dashboard/domains",
    icon: () => (
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <path d="M12 3a14.5 14.5 0 0 1 4 9 14.5 14.5 0 0 1-4 9 14.5 14.5 0 0 1-4-9 14.5 14.5 0 0 1 4-9z" />
      </svg>
    ),
  },
  {
    label: "Mailboxes",
    href: "/dashboard/mailboxes",
    icon: () => (
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    ),
  },
  {
    label: "Team & Access",
    href: "/dashboard/members",
    icon: () => (
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: "Storage",
    href: "/dashboard/storage",
    icon: () => (
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    label: "Billing",
    href: "/dashboard/billing",
    icon: () => (
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2.5" />
        <line x1="2" y1="10" x2="22" y2="10" />
        <line x1="6" y1="15" x2="10" y2="15" />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: () => (
      <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
      </svg>
    ),
  },
];

interface Props {
  currentPath?: string;
  isMobile?: boolean;
}

const Sidebar: Component<Props> = (props) => {
  const location = useLocation();
  const org = useOrg();
  const currentPath = () => props.currentPath ?? location.pathname;
  const isActive = (href: string) =>
    href === "/dashboard"
      ? currentPath() === "/dashboard"
      : currentPath().startsWith(href);

  return (
    <aside
      aria-label="Administrative navigation"
      class={`w-64 shrink-0 border-r border-[#E2DFD8] bg-white p-5 flex flex-col justify-between select-none ${
        props.isMobile ? "h-full flex" : "hidden lg:flex sticky top-0 h-screen overflow-y-auto"
      }`}
    >
      <div>
        {/* Brand Header */}
        <div class="flex items-center gap-3 pb-6 border-b border-[#E2DFD8]">
          <div class="w-9 h-9 rounded-lg bg-[#9E725F] flex items-center justify-center text-[#F0EEE9] font-mono font-bold text-xs tracking-wider shadow-sm">
            BYOS
          </div>
          <div class="flex flex-col">
            <span class="font-bold text-sm tracking-tight text-[#3C3D3E]">Control Panel</span>
            <span class="text-[10px] font-mono uppercase tracking-widest text-[#9E725F] font-semibold">
              Self-Sovereign
            </span>
          </div>
        </div>

        {/* Section Label */}
        <div class="mt-6 mb-2 px-3 text-[11px] font-bold tracking-wider uppercase text-[#6F7173]">
          Management
        </div>

        {/* Navigation List */}
        <ul class="space-y-1">
          {nav.map((item) => {
            const active = () => isActive(item.href);
            return (
              <li>
                <A
                  href={item.href}
                  end={item.href === "/dashboard"}
                  class={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-all group ${
                    active()
                      ? "bg-[#9E725F] text-white shadow-sm"
                      : "text-[#3C3D3E] hover:bg-[#F3ECE8] hover:text-[#9E725F]"
                  }`}
                  aria-current={active() ? "page" : undefined}
                >
                  <span class={`transition-colors ${active() ? "text-white" : "text-[#6F7173] group-hover:text-[#9E725F]"}`}>
                    {item.icon()}
                  </span>
                  <span>{item.label}</span>
                </A>
              </li>
            );
          })}
        </ul>
      </div>

      {/* User & Org Footer */}
      <div class="pt-4 border-t border-[#E2DFD8]">
        <div class="rounded-xl bg-[#F0EEE9]/70 border border-[#E2DFD8] p-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-[#3C3D3E] truncate max-w-[120px]">
              {org.user?.email || "Admin"}
            </span>
            <span class="rounded bg-[#9E725F]/15 px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase text-[#9E725F]">
              {org.role || "Admin"}
            </span>
          </div>
          <div class="mt-1 flex items-center justify-between text-[11px] text-[#6F7173]">
            <span class="capitalize">{org.plan} Plan</span>
            <button
              type="button"
              onClick={() => org.logout()}
              class="text-xs text-[#9E725F] hover:text-[#865E4D] font-medium hover:underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
