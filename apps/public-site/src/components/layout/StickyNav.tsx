import { createSignal, onMount, onCleanup } from "solid-js";

export function StickyNav() {
  const [showSticky, setShowSticky] = createSignal<boolean>(false);

  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const navLinks = [
    { label: "Features", href: "/#features" },
    { label: "Pricing", href: "/pricing" },
    { label: "Security", href: "/security" },
    { label: "Docs", href: "/docs" },
  ];

  onMount(() => {
    const onScroll = () => {
      setShowSticky(window.scrollY > 140);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    onCleanup(() => window.removeEventListener("scroll", onScroll));
  });

  return (
    <div class="relative z-50">
      <nav
        aria-label="Primary sticky"
        class={`fixed left-1/2 -translate-x-1/2 top-[15px] px-6 py-3 rounded-[22px] border border-[#E2DFD8] sticky-nav duration-500 w-full hidden lg:block transition-all max-w-[880px] ${
          showSticky()
            ? "opacity-100 translate-y-0 pointer-events-auto shadow-[0_10px_40px_-16px_rgba(43,44,45,0.22)]"
            : "opacity-0 -translate-y-4 pointer-events-none"
        }`}
        style={{
          "background-color": "rgba(240, 238, 233, 0.82)",
        }}
      >
        <div class="flex items-center justify-between px-2">
          <a href="/" class="flex items-center gap-2 group shrink-0" aria-label="BYOS home">
            <div class="flex items-center justify-center bg-[#9E725F] text-white px-2 py-0.5 rounded-lg text-xs font-mono font-bold tracking-wider shadow-xs group-hover:bg-[#865E4D] transition-colors">
              BYOS
            </div>
            <div class="flex flex-col leading-tight">
              <span class="font-bold text-xs tracking-tight text-[#2B2C2D]">Business Email</span>
              <span class="text-[8px] font-mono uppercase tracking-[0.2em] text-[#6F7173]">Your control</span>
            </div>
          </a>

          <div class="flex items-center gap-7">
            {navLinks.map((link) => (
              <a
                href={link.href}
                class="text-xs font-medium text-[#2B2C2D] transition-colors hover:text-[#9E725F] py-1"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div class="flex items-center gap-3">
            <a
              href={`${cpUrl()}/login`}
              class="text-xs font-medium text-[#2B2C2D] hover:text-[#9E725F] px-2 py-1 transition-colors"
            >
              Sign In
            </a>
            <a
              href={`${cpUrl()}/register`}
              class="px-4 py-1.5 text-xs font-semibold btn-primary shadow-xs"
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>
    </div>
  );
}
