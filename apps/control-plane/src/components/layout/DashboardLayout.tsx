import { Component, createSignal, JSX } from "solid-js";
import { useLocation } from "@solidjs/router";
import Sidebar from "./Sidebar";
import { useOrg } from "../../context/OrgContext";

interface Props {
  children?: JSX.Element;
}

const DashboardLayout: Component<Props> = (props) => {
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const location = useLocation();
  const org = useOrg();

  return (
    <div class="min-h-screen flex bg-[#F0EEE9] text-[#3C3D3E]">
      {/* Desktop sidebar */}
      <Sidebar currentPath={location.pathname} />

      {/* Mobile drawer */}
      {mobileOpen() && (
        <div class="fixed inset-0 z-40 lg:hidden">
          <div
            class="fixed inset-0 bg-[#3C3D3E]/40 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div class="fixed inset-y-0 left-0 w-64 bg-white shadow-2xl flex flex-col border-r border-[#E2DFD8]">
            <Sidebar currentPath={location.pathname} isMobile={true} />
            <button
              onClick={() => setMobileOpen(false)}
              class="absolute top-4 right-4 text-[#6F7173] hover:text-[#3C3D3E] p-1 text-sm font-bold"
              aria-label="Close navigation"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <div class="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Navbar */}
        <header class="flex items-center justify-between px-6 py-3.5 bg-white/80 backdrop-blur-md border-b border-[#E2DFD8] sticky top-0 z-30">
          <div class="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              class="lg:hidden rounded-lg p-2 text-[#3C3D3E] hover:bg-[#F3ECE8] transition-colors"
              aria-label="Open navigation"
            >
              ☰
            </button>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold uppercase tracking-wider text-[#9E725F] bg-[#9E725F]/10 px-2 py-0.5 rounded">
                BYOS
              </span>
              <span class="text-sm font-bold text-[#3C3D3E] hidden sm:inline">
                Admin Console
              </span>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <div class="hidden sm:flex items-center gap-2 text-xs text-[#6F7173]">
              <span class="font-medium text-[#3C3D3E]">{org.user?.email}</span>
              <span class="rounded bg-[#9E725F]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#9E725F] uppercase">
                {org.role || "Admin"}
              </span>
            </div>
            <a
              href={(import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL || "http://127.0.0.1:3001"}
              target="_blank"
              rel="noreferrer"
              class="inline-flex items-center gap-1.5 rounded-lg border border-[#E2DFD8] bg-[#F0EEE9]/70 px-3 py-1.5 text-xs font-medium text-[#3C3D3E] hover:bg-[#F3ECE8] hover:text-[#9E725F] transition-colors"
            >
              <span>Webmail</span>
              <span class="text-[10px]">↗</span>
            </a>
          </div>
        </header>

        {/* Dynamic Route Content */}
        <main class="flex-1 overflow-y-auto">{props.children}</main>
      </div>
    </div>
  );
};

export default DashboardLayout;
