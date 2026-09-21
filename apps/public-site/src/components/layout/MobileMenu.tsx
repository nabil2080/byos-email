import { createSignal, Show, onMount, onCleanup } from "solid-js";

export function MobileMenu() {
  const [isOpen, setIsOpen] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;

  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const toggleMenu = () => setIsOpen(!isOpen());
  const closeMenu = () => setIsOpen(false);

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const links = [
    { label: "Features", href: "/#features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Security", href: "/security" },
    { label: "Docs", href: "/docs" },
  ];

  return (
    <div class="lg:hidden relative" ref={menuRef}>
      <button
        type="button"
        onClick={toggleMenu}
        class="p-2 rounded-xl border border-[#E2DFD8] bg-white text-[#2B2C2D] hover:bg-[#FAF9F6] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#9E725F]/40 cursor-pointer"
        aria-label="Toggle menu"
        aria-expanded={isOpen()}
      >
        <Show
          when={isOpen()}
          fallback={
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          }
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Show>
      </button>

      <Show when={isOpen()}>
        <div class="fixed inset-x-0 top-[61px] bg-[#F0EEE9]/95 backdrop-blur-lg border-b border-[#E2DFD8] shadow-xl z-50 p-6 space-y-4">
          <nav class="flex flex-col space-y-1" aria-label="Mobile">
            {links.map((link) => (
              <a
                href={link.href}
                onClick={closeMenu}
                class="text-base font-semibold text-[#2B2C2D] hover:text-[#9E725F] transition-colors py-2.5 px-3 rounded-xl hover:bg-white/60"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div class="pt-4 border-t border-[#E2DFD8] flex flex-col gap-2.5">
            <a
              href={`${cpUrl()}/login`}
              class="w-full text-center py-2.5 rounded-xl border border-[#E2DFD8] bg-white text-xs font-bold text-[#2B2C2D] hover:bg-[#FAF9F6] transition-colors shadow-2xs"
            >
              Sign In
            </a>
            <a
              href={`${cpUrl()}/register`}
              class="w-full text-center py-2.5 rounded-xl bg-[#9E725F] text-white text-xs font-bold hover:bg-[#865E4D] transition-colors shadow-xs"
            >
              Get Started
            </a>
          </div>

          <div class="pt-1 flex items-center gap-2 text-[11px] text-[#6F7173] font-mono">
            <span class="h-1.5 w-1.5 rounded-full bg-[#9E725F]"></span>
            <span>Your email. Your storage. Your control.</span>
          </div>
        </div>
      </Show>
    </div>
  );
}
