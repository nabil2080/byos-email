import { Component, createSignal, JSX, Show, onMount } from "solid-js";
import { useLocation } from "@solidjs/router";
import Sidebar from "./Sidebar";
import Header from "./Header";
import { useOrg } from "../../context/OrgContext";

interface Props {
  children?: JSX.Element;
}

const DashboardLayout: Component<Props> = (props) => {
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const [isCollapsed, setIsCollapsed] = createSignal(false);
  const location = useLocation();
  const org = useOrg();

  onMount(() => {
    try {
      const saved = localStorage.getItem("byos_cp_sidebar_collapsed");
      if (saved === "true") {
        setIsCollapsed(true);
      }
    } catch {}
  });

  const toggleSidebarCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("byos_cp_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  };

  return (
    <div class="h-screen flex bg-[#F0EEE9] text-[#3C3D3E] overflow-hidden p-2 sm:p-3 gap-2 sm:gap-3 select-none">
      {/* Desktop Navigation Sidebar (Unified on Canvas #F0EEE9) */}
      <Sidebar
        currentPath={location.pathname}
        collapsed={isCollapsed()}
      />

      {/* Mobile drawer with backdrop */}
      <Show when={mobileOpen()}>
        <div class="fixed inset-0 z-40 lg:hidden" data-testid="mobile-nav-drawer">
          <div
            class="fixed inset-0 bg-[#2B2C2D]/50 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div class="fixed inset-y-0 left-0 w-64 bg-[#F0EEE9] shadow-2xl flex flex-col border-r border-[#E2DFD8] z-50">
            <Sidebar
              currentPath={location.pathname}
              isMobile={true}
              onCloseMobile={() => setMobileOpen(false)}
            />
            <button
              onClick={() => setMobileOpen(false)}
              class="absolute top-3 right-3 text-[#6F7173] hover:text-[#3C3D3E] p-1.5 rounded-xl text-sm font-bold hover:bg-[#E8E5DF] transition-colors cursor-pointer"
              aria-label="Close navigation"
              data-testid="close-mobile-nav"
            >
              ✕
            </button>
          </div>
        </div>
      </Show>

      {/* Main Content Viewport Beside Sidebar */}
      <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden gap-1.5 sm:gap-2">
        {/* Top Navbar */}
        <Header
          isSidebarCollapsed={isCollapsed()}
          onToggleSidebarCollapse={toggleSidebarCollapse}
          onOpenMobileNav={() => setMobileOpen(true)}
        />

        {/* Persistent Onboarding Resume Banner */}
        <Show when={org.onboardingSkipped && !org.onboardingCompleted}>
          <div class="bg-[#F2E8E2] border border-[#9E725F]/30 rounded-xl px-4 py-2 flex items-center justify-between text-xs text-[#3C3D3E] shadow-2xs shrink-0 mx-0.5">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-[#9E725F] animate-pulse" />
              <span class="font-medium truncate">
                Onboarding is incomplete. Your email organization is operating with default settings.
              </span>
            </div>
            <a
              href={`/onboarding/${org.onboardingCurrentStep || 1}`}
              class="inline-flex items-center gap-1 font-bold text-[#9E725F] hover:text-[#865E4D] underline cursor-pointer shrink-0 ml-2"
            >
              Resume Setup (Step {org.onboardingCurrentStep || 1}) →
            </a>
          </div>
        </Show>

        {/* Main Workspace Card (Matching Webmail's Workspace Card Architecture) */}
        <div class="flex-1 min-h-0 rounded-2xl border border-[#E2DFD8] bg-white shadow-2xs overflow-hidden flex flex-col min-w-0">
          <main class="flex-1 overflow-y-auto custom-scrollbar">
            {props.children}
          </main>
        </div>
      </div>
    </div>
  );
};

export default DashboardLayout;
