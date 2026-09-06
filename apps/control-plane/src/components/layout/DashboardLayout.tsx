import { Component, createSignal, JSX } from "solid-js";
import { useLocation } from "@solidjs/router";
import Sidebar from "./Sidebar";

interface Props {
  children?: JSX.Element;
}

const DashboardLayout: Component<Props> = (props) => {
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const location = useLocation();

  return (
    <div class="min-h-screen flex bg-slate-50">
      {/* Desktop sidebar */}
      <Sidebar currentPath={location.pathname} />
      {/* Mobile drawer */}
      {mobileOpen() && (
        <div class="fixed inset-0 z-40 lg:hidden">
          <div class="fixed inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div class="fixed inset-y-0 left-0 w-64 bg-white shadow-xl">
            <Sidebar currentPath={location.pathname} />
            <button
              onClick={() => setMobileOpen(false)}
              class="absolute top-4 right-4 text-slate-500"
              aria-label="Close navigation"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div class="flex-1 flex flex-col min-w-0">
        <header class="lg:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200 sticky top-0 z-30">
          <button
            onClick={() => setMobileOpen(true)}
            class="rounded-md p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Open navigation"
          >
            ☰
          </button>
          <span class="font-semibold text-slate-900">BYOS</span>
          <span class="w-8" />
        </header>
        <main class="flex-1">{props.children}</main>
      </div>
    </div>
  );
};

export default DashboardLayout;
