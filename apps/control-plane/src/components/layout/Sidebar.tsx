import { Component } from "solid-js";
import { A, useLocation } from "@solidjs/router";

const nav = [
  { label: "Overview", href: "/dashboard", icon: "◈" },
  { label: "Domains", href: "/dashboard/domains", icon: "◐" },
  { label: "Mailboxes", href: "/dashboard/mailboxes", icon: "✉" },
  { label: "Storage", href: "/dashboard/storage", icon: "▦" },
  { label: "Settings", href: "/dashboard/settings", icon: "⚙" },
];

interface Props {
  currentPath?: string;
}

const Sidebar: Component<Props> = (props) => {
  const location = useLocation();
  const currentPath = () => props.currentPath ?? location.pathname;
  const isActive = (href: string) => currentPath().startsWith(href) && (href !== "/dashboard" || currentPath() === "/dashboard");
  return (
    <nav aria-label="Dashboard navigation" class="w-64 border-r border-slate-200 bg-white p-4 hidden lg:block">
      <div class="mb-6 text-sm font-semibold text-slate-900">Organization</div>
      <ul class="space-y-1">
        {nav.map((item) => (
          <li>
            <A
              href={item.href}
              end={item.href === "/dashboard"}
              activeClass="bg-slate-900 text-white"
              inactiveClass="text-slate-700 hover:bg-slate-100"
              class="flex items-center gap-2 rounded-md px-3 py-2 text-sm"
              aria-current={isActive(item.href) ? "page" : undefined}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </A>
          </li>
        ))}
      </ul>
    </nav>
  );
};

export default Sidebar;
