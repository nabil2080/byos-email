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
    <div class="min-h-screen flex bg-[#F0EEE9] text-[#3C3D3E]">
      {/* Desktop sidebar */}
      <Sidebar
        currentPath={location.pathname}
        collapsed={isCollapsed()}
      />

      {/* Mobile drawer */}
      {mobileOpen() && (
        <div class="fixed inset-0 z-40 lg:hidden" data-testid="mobile-nav-drawer">
          <div
            class="fixed inset-0 bg-[#2B2C2D]/50 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div class="fixed inset-y-0 left-0 w-64 bg-white shadow-2xl flex flex-col border-r border-[#E2DFD8] z-50">
            <Sidebar
              currentPath={location.pathname}
              isMobile={true}
              onCloseMobile={() => setMobileOpen(false)}
            />
            <button
              onClick={() => setMobileOpen(false)}
              class="absolute top-4 right-4 text-[#6F7173] hover:text-[#3C3D3E] p-1.5 rounded-lg text-sm font-bold hover:bg-[#F0EEE9]"
              aria-label="Close navigation"
              data-testid="close-mobile-nav"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      <div class="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Top Navbar */}
        <Header
          isSidebarCollapsed={isCollapsed()}
          onToggleSidebarCollapse={toggleSidebarCollapse}
          onOpenMobileNav={() => setMobileOpen(true)}
        />

        {/* Persistent Onboarding Resume Banner */}
        <Show when={org.onboardingSkipped && !org.onboardingCompleted}>
          <div class="bg-[#F2E8E2] border-b border-[#9E725F]/30 px-4 sm:px-6 py-2.5 flex items-center justify-between text-xs text-[#3C3D3E] shadow-2xs">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-[#9E725F] animate-pulse" />
              <span class="font-medium">
                Onboarding is incomplete. Your email organization is operating with default settings.
              </span>
            </div>
            <a
              href={`/onboarding/${org.onboardingCurrentStep || 1}`}
              class="inline-flex items-center gap-1 font-bold text-[#9E725F] hover:text-[#865E4D] underline cursor-pointer"
            >
              Resume Setup (Step {org.onboardingCurrentStep || 1}) →
            </a>
          </div>
        </Show>

        {/* Main Content Container with max width and responsive padding */}
        <main class="flex-1 overflow-y-auto">
          <div class="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
