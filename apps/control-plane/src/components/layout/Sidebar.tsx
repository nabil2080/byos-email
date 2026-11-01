import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from "solid-js";
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
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
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
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
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
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
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
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
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
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
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
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
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
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    label: "Help & Support",
    href: "/dashboard/support",
    dataTestId: "nav-support",
    icon: () => (
      <svg class="w-4 h-4 shrink-0 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="10" r="0.8" fill="currentColor" />
        <circle cx="8" cy="10" r="0.8" fill="currentColor" />
        <circle cx="16" cy="10" r="0.8" fill="currentColor" />
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

  // Morphing sliding highlight pill tracking active route (matching Webmail folder design)
  const [navPillStyle, setNavPillStyle] = createSignal<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0,
  });
  const navRefs = new Map<string, HTMLElement>();
  let navContainerRef: HTMLElement | undefined;

  const activeNavKey = () => {
    const path = currentPath();
    const matched = nav.find((item) =>
      item.href === "/dashboard"
        ? path === "/dashboard"
        : path.startsWith(item.href)
    );
    return matched ? matched.href : null;
  };

  const updateNavPill = () => {
    const key = activeNavKey();
    if (!key) {
      setNavPillStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const el = navRefs.get(key);
    const container = navContainerRef;
    if (el && container) {
      const elRect = el.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setNavPillStyle({
        top: elRect.top - containerRect.top,
        height: elRect.height,
        opacity: 1,
      });
    } else if (el) {
      setNavPillStyle({
        top: el.offsetTop,
        height: el.offsetHeight,
        opacity: 1,
      });
    } else {
      setNavPillStyle((prev) => ({ ...prev, opacity: 0 }));
    }
  };

  createEffect(() => {
    // Re-run whenever active route, path, or collapsed state changes
    currentPath();
    isCollapsed();
    requestAnimationFrame(() => {
      updateNavPill();
    });
  });

  onMount(() => {
    setTimeout(updateNavPill, 30);
    setTimeout(updateNavPill, 100);
    setTimeout(updateNavPill, 250);
    window.addEventListener("resize", updateNavPill);
    onCleanup(() => {
      window.removeEventListener("resize", updateNavPill);
    });
  });

  const isActive = (href: string) =>
    href === "/dashboard"
      ? currentPath() === "/dashboard"
      : currentPath().startsWith(href);

  return (
    <aside
      aria-label="Administrative navigation"
      data-testid="sidebar"
      class={`shrink-0 bg-[#F0EEE9] flex flex-col justify-between select-none transition-all duration-200 ease-in-out h-full ${
        props.isMobile
          ? "w-64 p-3 flex"
          : isCollapsed()
          ? "w-[72px] px-1.5 pt-0 pb-0 hidden lg:flex"
          : "w-64 px-1.5 pt-0 pb-0 hidden lg:flex"
      }`}
    >
      <div class="space-y-3 flex-1 min-h-0 overflow-y-auto custom-scrollbar px-1">
        {/* Top-Left App Brand Header (Matching Webmail Brand Style & Header Height) */}
        <div
          class={`flex items-center h-12 min-h-[48px] ${
            isCollapsed() ? "justify-center" : "justify-between px-1"
          }`}
        >
          <div class="flex items-center gap-2">
            <div
              class="w-6 h-6 rounded-xl bg-gradient-to-b from-[#A27561] via-[#986A57] to-[#8E6351] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30 shrink-0"
              title="BYOS Self-Sovereign Platform"
            >
              B
            </div>
            <Show when={!isCollapsed()}>
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="text-sm font-semibold text-[#1A1B1E] tracking-tight truncate">
                    BYOS Control Panel
                  </span>
                </div>
                <span class="text-[9px] font-mono uppercase tracking-widest text-[#9E725F] font-semibold truncate leading-none">
                  Self-Sovereign
                </span>
              </div>
            </Show>
            <Show when={isCollapsed()}>
              {/* Accessible hidden text for tests and screen readers */}
              <span class="sr-only">BYOS Control Panel Self-Sovereign</span>
            </Show>
          </div>
        </div>

        {/* Section Label */}
        <Show when={!isCollapsed()}>
          <div class="pt-2 px-2 text-[11px] font-bold tracking-wider uppercase text-[#878A8E]">
            Management
          </div>
        </Show>
        <Show when={isCollapsed()}>
          <div class="my-2 border-t border-[#E2DFD8]/60" />
        </Show>

        {/* Navigation List with Morphing Sliding Highlight Pill */}
        <nav
          ref={(el) => (navContainerRef = el)}
          aria-label="Main menu"
          class="relative"
        >
          {/* Morphing Sliding Highlight Pill (matches Webmail folder morphing design) */}
          <div
            data-testid="sidebar-nav-pill"
            class="absolute left-0 right-0 rounded-xl bg-gradient-to-r from-[#9E725F] to-[#8E6351] shadow-xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
            style={{
              top: `${navPillStyle().top}px`,
              height: `${navPillStyle().height}px`,
              opacity: navPillStyle().opacity,
            }}
          />

          <ul class="space-y-1 relative z-10">
            <For each={nav}>
              {(item) => {
                const active = () => isActive(item.href);
                return (
                  <li>
                    <A
                      ref={(el) => {
                        if (el) {
                          navRefs.set(item.href, el);
                          if (active()) {
                            updateNavPill();
                          }
                        }
                      }}
                      href={item.href}
                      data-testid={item.dataTestId}
                      end={item.href === "/dashboard"}
                      onClick={() => props.onCloseMobile?.()}
                      title={isCollapsed() ? item.label : undefined}
                      class={`relative z-10 flex items-center rounded-xl text-[13px] font-medium transition-colors duration-150 group focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 cursor-pointer ${
                        isCollapsed()
                          ? "justify-center p-2.5"
                          : "gap-2.5 px-3 py-2"
                      } ${
                        active()
                          ? "text-white font-semibold"
                          : "text-[#55575B] hover:bg-black/5 hover:text-[#1A1B1E]"
                      }`}
                      aria-current={active() ? "page" : undefined}
                    >
                      <span
                        class={`transition-colors shrink-0 ${
                          active() ? "text-white" : "text-[#6E7075] group-hover:text-[#9E725F]"
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

      {/* User Identity & Org Card at Bottom (Aligned with Main Section Height & Baseline) */}
      <div class="mt-auto pt-2 px-1 shrink-0">
        <Show when={!isCollapsed()}>
          <div class="rounded-2xl bg-white border border-[#DDD8CE] p-3 shadow-2xs transition-colors hover:border-[#9E725F]/30">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-7 h-7 rounded-xl bg-[#F2E8E2] text-[#9E725F] font-bold text-xs flex items-center justify-center shrink-0">
                  {org.user?.email ? org.user.email[0].toUpperCase() : "A"}
                </div>
                <span
                  class="font-semibold text-[13px] text-[#1A1B1E] truncate"
                  title={org.user?.email || "Admin"}
                >
                  {org.user?.email || "Admin"}
                </span>
              </div>
              <span class="rounded-md bg-[#F2E8E2] px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase text-[#9E725F] shrink-0">
                {org.role || "Admin"}
              </span>
            </div>
            <div class="mt-2.5 pt-2 border-t border-[#E2DFD8]/60 flex items-center justify-between text-xs text-[#55575B]">
              <span class="font-mono">
                {org.seatCount || 1} Seat{(org.seatCount || 1) === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => org.logout()}
                class="text-xs text-[#55575B] hover:text-[#9E725F] font-medium hover:underline cursor-pointer focus:outline-none"
              >
                Sign out
              </button>
            </div>
          </div>
        </Show>

        <Show when={isCollapsed()}>
          <div class="flex flex-col items-center gap-2 py-1">
            <div
              class="w-8 h-8 rounded-xl bg-[#F2E8E2] text-[#9E725F] font-mono font-bold text-xs flex items-center justify-center cursor-pointer shadow-2xs"
              title={`${org.user?.email || "Admin"} (${org.role || "Admin"}) • ${org.seatCount || 1} Seat(s)`}
            >
              {org.user?.email ? org.user.email[0].toUpperCase() : "A"}
            </div>
            <button
              type="button"
              onClick={() => org.logout()}
              class="w-8 h-8 rounded-xl bg-white border border-[#DDD8CE] flex items-center justify-center text-[#55575B] hover:text-red-600 hover:border-red-300 shadow-2xs transition-all cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
            {/* Accessible text for automated tests and screen readers */}
            <span class="sr-only">
              {org.user?.email || "Admin"} {org.seatCount || 1} Seats
            </span>
          </div>
        </Show>
      </div>
    </aside>
  );
};

export default Sidebar;
