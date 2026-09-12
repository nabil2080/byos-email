import { Component } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { useOrg } from "../../context/OrgContext";

const nav = [
  { label: "Overview", href: "/dashboard", icon: "📊" },
  { label: "Domains", href: "/dashboard/domains", icon: "🌐" },
  { label: "Mailboxes", href: "/dashboard/mailboxes", icon: "👥" },
  { label: "Storage", href: "/dashboard/storage", icon: "💾" },
  { label: "Billing", href: "/dashboard/billing", icon: "💳" },
  { label: "Settings", href: "/dashboard/settings", icon: "⚙️" },
];

interface Props {
  currentPath?: string;
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
      class="w-64 border-r border-[#E2DFD8] bg-white p-5 flex flex-col justify-between hidden lg:flex select-none"
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
                  class={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-all ${
                    active()
                      ? "bg-[#9E725F] text-white shadow-sm"
                      : "text-[#3C3D3E] hover:bg-[#F3ECE8] hover:text-[#9E725F]"
                  }`}
                  aria-current={active() ? "page" : undefined}
                >
                  <span class="text-base leading-none" aria-hidden="true">{item.icon}</span>
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
