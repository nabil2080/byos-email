import { Component, createSignal, createMemo, onMount, onCleanup, Show } from "solid-js";
import { useLocation } from "@solidjs/router";
import { useOrg } from "../../context/OrgContext";
import GlobalSearch from "./GlobalSearch";

interface HeaderProps {
  onToggleSidebarCollapse?: () => void;
  isSidebarCollapsed?: boolean;
  onOpenMobileNav?: () => void;
}

export const Header: Component<HeaderProps> = (props) => {
  const org = useOrg();
  const location = useLocation();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [accountMenuOpen, setAccountMenuOpen] = createSignal(false);

  // Platform-specific keyboard shortcut label (⌘K on Mac, Ctrl+K on Windows/Linux)
  const shortcutLabel = createMemo(() => {
    if (typeof navigator !== "undefined" && navigator.platform?.toUpperCase().includes("MAC")) {
      return "⌘K";
    }
    return "Ctrl K";
  });

  // Dynamic route-derived breadcrumbs
  const breadcrumbs = createMemo(() => {
    const path = location.pathname;
    if (path === "/dashboard" || path === "/dashboard/") {
      return { parent: "Dashboard", current: "Overview" };
    }
    if (path.startsWith("/dashboard/domains")) {
      return { parent: "Dashboard", current: "Domains" };
    }
    if (path.startsWith("/dashboard/mailboxes")) {
      return { parent: "Dashboard", current: "Mailboxes" };
    }
    if (path.startsWith("/dashboard/members")) {
      return { parent: "Dashboard", current: "Team & Access" };
    }
    if (path.startsWith("/dashboard/storage")) {
      return { parent: "Dashboard", current: "Storage" };
    }
    if (path.startsWith("/dashboard/billing")) {
      return { parent: "Dashboard", current: "Billing" };
    }
    if (path.startsWith("/dashboard/settings")) {
      return { parent: "Dashboard", current: "Settings" };
    }
    if (path.startsWith("/dashboard/recovery")) {
      return { parent: "Dashboard", current: "Key Recovery" };
    }
    if (path.startsWith("/dashboard/security")) {
      return { parent: "Dashboard", current: "Security" };
    }
    return { parent: "Dashboard", current: "Overview" };
  });

  // Global hotkey handler for Ctrl+K / Cmd+K
  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setSearchOpen((prev) => !prev);
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleGlobalKeyDown);
  });

  return (
    <>
      <header
        class="h-14 px-4 sm:px-6 bg-white/95 backdrop-blur-md border-b border-[#E2DFD8] flex items-center justify-between sticky top-0 z-30 transition-all"
        data-testid="app-header"
      >
        {/* Left: Mobile Nav Toggle + Desktop Sidebar Collapse + Breadcrumbs */}
        <div class="flex items-center gap-3 shrink-0">
          {/* Mobile hamburger */}
          <button
            type="button"
            onClick={props.onOpenMobileNav}
            class="lg:hidden p-1.5 rounded-lg text-[#3C3D3E] hover:bg-[#F3ECE8] transition-colors"
            aria-label="Open mobile navigation"
            data-testid="mobile-nav-toggle"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={props.onToggleSidebarCollapse}
            class="hidden lg:flex p-1.5 rounded-lg text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F0EEE9] transition-colors"
            aria-label={props.isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={props.isSidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
            data-testid="sidebar-collapse-toggle"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
              <path d={props.isSidebarCollapsed ? "m14 9 3 3-3 3" : "m16 9-3 3 3 3"} />
            </svg>
          </button>

          {/* Breadcrumb Hierarchy */}
          <div class="flex items-center gap-1.5 text-xs select-none" data-testid="header-breadcrumbs">
            <span class="text-[#6F7173] font-medium hidden sm:inline">
              {breadcrumbs().parent}
            </span>
            <span class="text-[#E2DFD8] hidden sm:inline">/</span>
            <span class="text-[#3C3D3E] font-semibold tracking-tight">
              {breadcrumbs().current}
            </span>
          </div>
        </div>

        {/* Center: Global Search Trigger Button */}
        <div class="flex-1 min-w-0 max-w-md mx-2 sm:mx-4">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            class="w-full flex items-center justify-between px-3 py-1.5 rounded-xl bg-[#F0EEE9]/70 hover:bg-[#F3ECE8] border border-[#E2DFD8] text-xs text-[#6F7173] hover:text-[#3C3D3E] transition-all group focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30"
            data-testid="header-search-trigger"
            aria-label="Open global search"
          >
            <div class="flex items-center gap-2 truncate">
              <svg
                class="w-3.5 h-3.5 text-[#6F7173] group-hover:text-[#9E725F] shrink-0 transition-colors"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span class="truncate">Search mailboxes, domains, people...</span>
            </div>
            <kbd class="hidden sm:inline-flex items-center text-[10px] font-mono text-[#6F7173] bg-white px-1.5 py-0.5 rounded border border-[#E2DFD8] shadow-xs">
              {shortcutLabel()}
            </kbd>
          </button>
        </div>

        {/* Right: User Identity, Role Badge, Webmail Shortcut & Account */}
        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* User Details (visible on desktop viewports) */}
          <div class="hidden lg:flex items-center gap-2 text-xs">
            <span class="font-medium text-[#3C3D3E] max-w-[140px] truncate" title={org.user?.email || "Admin"}>
              {org.user?.email || "Admin"}
            </span>
            <span class="rounded-md bg-[#9E725F]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#9E725F] uppercase tracking-wide">
              {org.role || "Admin"}
            </span>
          </div>

          {/* Webmail Navigation Shortcut */}
          <a
            href={(import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL || "http://127.0.0.1:3001"}
            target="_blank"
            rel="noreferrer"
            class="inline-flex items-center gap-1.5 rounded-lg border border-[#E2DFD8] bg-[#F0EEE9]/80 px-2.5 py-1 text-xs font-medium text-[#3C3D3E] hover:bg-[#F3ECE8] hover:text-[#9E725F] transition-colors"
            title="Open BYOS Sovereign Webmail in new tab"
            data-testid="header-webmail-link"
          >
            <span class="hidden sm:inline">Webmail</span>
            <span class="text-[10px] font-mono text-[#9E725F]">↗</span>
          </a>

          {/* Account Menu Trigger */}
          <div class="relative">
            <button
              type="button"
              onClick={() => setAccountMenuOpen((prev) => !prev)}
              class="w-7 h-7 rounded-full bg-[#9E725F] text-[#F0EEE9] flex items-center justify-center text-xs font-bold font-mono shadow-xs hover:bg-[#865E4D] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40"
              aria-label="User account menu"
              data-testid="header-user-avatar"
            >
              {org.user?.email ? org.user.email[0].toUpperCase() : "A"}
            </button>

            {/* Dropdown Menu */}
            <Show when={accountMenuOpen()}>
              <div
                class="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-[#E2DFD8] py-2 z-50 text-xs animate-in fade-in zoom-in-95"
                data-testid="header-account-dropdown"
              >
                <div class="px-3 py-2 border-b border-[#E2DFD8]">
                  <div class="font-semibold text-[#3C3D3E] truncate">{org.user?.email}</div>
                  <div class="text-[11px] text-[#6F7173] capitalize mt-0.5">
                    {org.role} • {org.seatCount} Seat{org.seatCount === 1 ? "" : "s"}
                  </div>
                </div>

                <a
                  href="/dashboard/settings"
                  onClick={() => setAccountMenuOpen(false)}
                  class="flex items-center gap-2 px-3 py-2 text-[#3C3D3E] hover:bg-[#F3ECE8] hover:text-[#9E725F] transition-colors"
                >
                  <svg class="w-3.5 h-3.5 text-[#6F7173]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  <span>Account & Tour Settings</span>
                </a>

                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    org.logout();
                  }}
                  class="w-full flex items-center gap-2 px-3 py-2 text-[#9E725F] hover:bg-[#F3ECE8] text-left transition-colors font-medium border-t border-[#E2DFD8]/50 mt-1"
                >
                  <svg class="w-3.5 h-3.5 text-[#9E725F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>Sign out</span>
                </button>
              </div>
            </Show>
          </div>
        </div>
      </header>

      {/* Global Search Command Palette Modal */}
      <GlobalSearch isOpen={searchOpen()} onClose={() => setSearchOpen(false)} />
    </>
  );
};

export default Header;
