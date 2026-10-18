import { Component, Show, For } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { useOrg } from "../../context/OrgContext";

export interface NavItem {
  label: string;
  href: string;
  dataTestId: string;
  icon: () => any;
}

const nav: NavItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    dataTestId: "nav-overview",
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
    dataTestId: "nav-domains",
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
    dataTestId: "nav-mailboxes",
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
    dataTestId: "nav-members",
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
    dataTestId: "nav-storage",
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
    dataTestId: "nav-billing",
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
    dataTestId: "nav-settings",
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
  collapsed?: boolean;
  onCloseMobile?: () => void;
}

const Sidebar: Component<Props> = (props) => {
  const location = useLocation();
  const org = useOrg();
  const currentPath = () => props.currentPath ?? location.pathname;
  const isCollapsed = () => !props.isMobile && Boolean(props.collapsed);

  const isActive = (href: string) =>
    href === "/dashboard"
      ? currentPath() === "/dashboard"
      : currentPath().startsWith(href);

  return (
    <aside
      aria-label="Administrative navigation"
      data-testid="sidebar"
      class={`shrink-0 border-r border-[#E2DFD8] bg-white flex flex-col justify-between select-none transition-all duration-200 ease-in-out ${
        props.isMobile
          ? "h-full w-64 p-5 flex"
          : isCollapsed()
          ? "w-[72px] p-3 hidden lg:flex sticky top-0 h-screen overflow-y-auto"
          : "w-64 p-5 hidden lg:flex sticky top-0 h-screen overflow-y-auto"
      }`}
    >
      <div>
        {/* Brand Header */}
        <div
          class={`flex items-center pb-5 border-b border-[#E2DFD8] ${
            isCollapsed() ? "justify-center" : "gap-3"
          }`}
        >
          <div
            class="w-9 h-9 rounded-xl bg-[#9E725F] flex items-center justify-center text-[#F0EEE9] font-mono font-bold text-xs tracking-wider shadow-sm shrink-0"
            title="BYOS Self-Sovereign Platform"
          >
            BYOS
          </div>
          <Show when={!isCollapsed()}>
            <div class="flex flex-col min-w-0">
              <span class="font-bold text-sm tracking-tight text-[#3C3D3E] truncate">
                Control Panel
              </span>
              <span class="text-[9px] font-mono uppercase tracking-widest text-[#9E725F] font-semibold truncate">
                Self-Sovereign
              </span>
            </div>
          </Show>
        </div>

        {/* Section Label */}
        <Show when={!isCollapsed()}>
          <div class="mt-5 mb-2 px-3 text-[11px] font-bold tracking-wider uppercase text-[#6F7173]">
            Management
          </div>
        </Show>
        <Show when={isCollapsed()}>
          <div class="my-3 border-t border-[#E2DFD8]/60" />
        </Show>

        {/* Navigation List */}
        <nav aria-label="Main menu">
          <ul class="space-y-1">
            <For each={nav}>
              {(item) => {
                const active = () => isActive(item.href);
                return (
                  <li>
                    <A
                      href={item.href}
                      data-testid={item.dataTestId}
                      end={item.href === "/dashboard"}
                      onClick={() => props.onCloseMobile?.()}
                      title={isCollapsed() ? item.label : undefined}
                      class={`flex items-center rounded-xl text-sm font-medium transition-all group focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 ${
                        isCollapsed()
                          ? "justify-center p-2.5"
                          : "gap-3 px-3.5 py-2.5"
                      } ${
                        active()
                          ? "bg-[#9E725F] text-white shadow-xs font-semibold"
                          : "text-[#3C3D3E] hover:bg-[#F3ECE8] hover:text-[#9E725F]"
                      }`}
                      aria-current={active() ? "page" : undefined}
                    >
                      <span
                        class={`transition-colors shrink-0 ${
                          active() ? "text-white" : "text-[#6F7173] group-hover:text-[#9E725F]"
                        }`}
                      >
                        {item.icon()}
                      </span>
                      <Show when={!isCollapsed()}>
                        <span class="truncate">{item.label}</span>
                      </Show>
                    </A>
                  </li>
                );
              }}
            </For>
          </ul>
        </nav>
      </div>

      {/* User & Org Footer */}
      <div class="pt-4 border-t border-[#E2DFD8]">
        <Show when={!isCollapsed()}>
          <div class="rounded-xl bg-[#F0EEE9]/70 border border-[#E2DFD8] p-3 text-xs">
            <div class="flex items-center justify-between">
              <span
                class="font-semibold text-[#3C3D3E] truncate max-w-[130px]"
                title={org.user?.email || "Admin"}
              >
                {org.user?.email || "Admin"}
              </span>
              <span class="rounded bg-[#9E725F]/15 px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase text-[#9E725F]">
                {org.role || "Admin"}
              </span>
            </div>
            <div class="mt-1 flex items-center justify-between text-[11px] text-[#6F7173]">
              <span class="font-mono">
                {org.seatCount || 1} Seat{(org.seatCount || 1) === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => org.logout()}
                class="text-xs text-[#9E725F] hover:text-[#865E4D] font-medium hover:underline focus:outline-none"
              >
                Sign out
              </button>
            </div>
          </div>
        </Show>

        <Show when={isCollapsed()}>
          <div class="flex flex-col items-center gap-2">
            <div
              class="w-8 h-8 rounded-full bg-[#9E725F]/15 text-[#9E725F] flex items-center justify-center text-xs font-mono font-bold uppercase"
              title={`${org.user?.email || "Admin"} (${org.role || "Admin"})`}
            >
              {org.user?.email ? org.user.email[0].toUpperCase() : "A"}
            </div>
            <button
              type="button"
              onClick={() => org.logout()}
              class="p-1.5 rounded-lg text-[#6F7173] hover:text-[#9E725F] hover:bg-[#F3ECE8] text-xs transition-colors"
              title="Sign out"
              aria-label="Sign out"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </Show>
      </div>
    </aside>
  );
};

export default Sidebar;
