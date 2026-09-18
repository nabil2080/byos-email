import { Component, createSignal, onMount, onCleanup, Show, For } from "solid-js";

interface UserProfile {
  id: string;
  email: string;
  org_id?: string;
  organization_id?: string;
  display_name?: string;
  role?: string;
  plan?: string;
}

export const HeaderUserNav: Component = () => {
  const [user, setUser] = createSignal<UserProfile | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [isOpen, setIsOpen] = createSignal(false);
  let dropdownRef: HTMLDivElement | undefined;

  const apiBase = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_API_URL;
    return envUrl ?? "";
  };

  const cpBase = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const checkAuth = async () => {
    try {
      const res = await fetch(`${apiBase()}/v1/auth/me`, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.id && data.email) {
          setUser(data);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    checkAuth();

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("click", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  const handleLogout = async () => {
    try {
      await fetch(`${apiBase()}/v1/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best effort
    }
    setUser(null);
    setIsOpen(false);
    // Reload or redirect to refresh state
    window.location.href = "/";
  };

  const sidebarLinks = [
    {
      label: "Dashboard",
      sublabel: "Organization Overview",
      href: () => `${cpBase()}/dashboard`,
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
      sublabel: "DNS & DKIM/SPF Configuration",
      href: () => `${cpBase()}/dashboard/domains`,
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
      sublabel: "End-to-End Encrypted Addresses",
      href: () => `${cpBase()}/dashboard/mailboxes`,
      icon: () => (
        <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
        </svg>
      ),
    },
    {
      label: "Team & Access",
      sublabel: "Members & Zero-Knowledge Roles",
      href: () => `${cpBase()}/dashboard/members`,
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
      sublabel: "BYO S3 / R2 Bucket Status",
      href: () => `${cpBase()}/dashboard/storage`,
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
      sublabel: "Capacity, Subscriptions & Invoices",
      href: () => `${cpBase()}/dashboard/billing`,
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
      sublabel: "Security, 2FA & Cryptographic Keys",
      href: () => `${cpBase()}/dashboard/settings`,
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

  return (
    <div class="relative" ref={dropdownRef}>
      <Show
        when={!loading() && user()}
        fallback={
          <div class="flex items-center gap-3">
            <a
              href={`${cpBase()}/login`}
              class="text-xs sm:text-sm font-semibold text-[#3C3D3E] hover:text-[#9E725F] px-3 py-1.5 transition-colors"
            >
              Sign In
            </a>
            <a
              href={`${cpBase()}/register`}
              class="rounded-xl bg-[#9E725F] px-4 py-2 text-xs sm:text-sm font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-all"
            >
              Start Free Trial
            </a>
          </div>
        }
      >
        {/* Logged-In User Header Pill */}
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen())}
            class="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-[#E2DFD8] bg-white hover:bg-[#FAF9F6] shadow-2xs transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/20"
            aria-expanded={isOpen()}
            aria-haspopup="true"
          >
            <div class="w-6 h-6 rounded-full bg-[#9E725F] text-white flex items-center justify-center font-bold text-[11px] shadow-xs">
              {(user()?.email || "U").charAt(0).toUpperCase()}
            </div>
            <span class="max-w-[140px] truncate text-xs font-medium text-[#3C3D3E]">
              {user()?.email}
            </span>
            <Show when={user()?.role}>
              <span class="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-[#9E725F]/10 text-[#9E725F]">
                {user()?.role}
              </span>
            </Show>
            <svg
              class={`w-3.5 h-3.5 text-[#6F7173] transition-transform duration-200 ${
                isOpen() ? "rotate-180" : ""
              }`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          <a
            href={`${cpBase()}/dashboard`}
            class="hidden sm:inline-flex rounded-xl bg-[#9E725F] px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-all items-center gap-1.5"
          >
            <span>Control Panel</span>
            <span>→</span>
          </a>
        </div>

        {/* Dropdown Menu */}
        <Show when={isOpen()}>
          <div class="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl bg-white p-2 shadow-xl border border-[#E2DFD8] ring-1 ring-black/5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Account Info Header */}
            <div class="p-3 border-b border-[#E2DFD8] bg-[#FAF9F6] rounded-xl mb-1.5">
              <div class="flex items-center gap-2.5">
                <div class="w-9 h-9 rounded-full bg-[#9E725F] text-white flex items-center justify-center font-bold text-sm shadow-xs shrink-0">
                  {(user()?.email || "U").charAt(0).toUpperCase()}
                </div>
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-bold text-[#3C3D3E] truncate">
                    {user()?.email}
                  </div>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <span class="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    <span class="text-[10px] font-mono text-[#6F7173] uppercase tracking-wider">
                      {user()?.role || "Member"} • {user()?.plan || "Active"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Sidebar Options */}
            <div class="py-1 space-y-0.5">
              <div class="px-2.5 py-1 text-[10px] font-semibold font-mono uppercase tracking-wider text-[#6F7173]/80">
                Control Panel Navigation
              </div>
              <For each={sidebarLinks}>
                {(link) => (
                  <a
                    href={link.href()}
                    class="group flex items-center gap-2.5 px-2.5 py-2 text-xs rounded-lg text-[#3C3D3E] hover:bg-[#F0EEE9] hover:text-[#9E725F] transition-colors"
                  >
                    <div class="text-[#6F7173] group-hover:text-[#9E725F] transition-colors">
                      {link.icon()}
                    </div>
                    <div class="flex flex-col min-w-0">
                      <span class="font-medium">{link.label}</span>
                      <span class="text-[10px] text-[#6F7173] truncate">{link.sublabel}</span>
                    </div>
                  </a>
                )}
              </For>
            </div>

            {/* Divider and Sign Out */}
            <div class="mt-1.5 pt-1.5 border-t border-[#E2DFD8]">
              <button
                type="button"
                onClick={handleLogout}
                class="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium rounded-lg text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
              >
                <svg class="w-4 h-4 text-rose-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span>Sign Out of Account</span>
              </button>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};
