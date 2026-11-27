import { createSignal, onMount, onCleanup } from "solid-js";

export function StickyNav() {
  const [showSticky, setShowSticky] = createSignal<boolean>(false);
  const [pathname, setPathname] = createSignal("/");

  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://localhost:3000";
  };

  const navLinks = [
    { label: "Features", href: "/#features" },
    { label: "Architecture", href: "/#the-idea" },
    { label: "Pricing", href: "/pricing" },
    { label: "Security", href: "/security" },
    { label: "Support", href: "/support" },
  ];

  onMount(() => {
    setPathname(window.location.pathname);
    const onScroll = () => {
      setShowSticky(window.scrollY > 140);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    onCleanup(() => window.removeEventListener("scroll", onScroll));
  });

  const isActive = (href: string) =>
    href.startsWith("/#") ? false : pathname() === href || pathname() === `${href}/`;

  return (
    <div class="relative z-50">
      <nav
        aria-label="Primary sticky"
        class={`fixed left-1/2 -translate-x-1/2 top-[15px] px-6 py-3 rounded-[22px] border border-[#D8D3C9] sticky-nav duration-500 w-full hidden lg:block transition-all max-w-[900px] ${
          showSticky()
            ? "opacity-100 translate-y-0 pointer-events-auto shadow-[0_12px_40px_-16px_rgba(43,44,45,0.22)]"
            : "opacity-0 -translate-y-4 pointer-events-none"
        }`}
        style={{
          "background-color": "rgba(234, 230, 222, 0.86)",
        }}
      >
        <div class="flex items-center justify-between px-2">
          <a href="/" class="flex items-center gap-2 group shrink-0" aria-label="BYOS home">
            <div class="flex items-center justify-center bg-[#226192] text-white px-2 py-0.5 rounded-lg text-xs font-mono font-bold tracking-wider shadow-xs group-hover:bg-[#1B4E76] transition-colors">
              BYOS
            </div>
            <div class="flex flex-col leading-tight">
              <span class="font-bold text-xs tracking-tight text-[#18212A]">Business Email</span>
              <span class="text-[9px] font-mono uppercase tracking-[0.2em] text-[#55616D]">Your control</span>
            </div>
          </a>

          <div class="flex items-center gap-6">
            {navLinks.map((link) => (
              <a
                href={link.href}
                class={`text-xs font-medium transition-colors py-1 ${
                  isActive(link.href)
                    ? "text-[#226192] font-semibold"
                    : "text-[#18212A] hover:text-[#226192]"
                }`}
              >
                {link.label}
              </a>
            ))}
          </div>

          <div class="flex items-center gap-3">
            <a
              href={`${cpUrl()}/login`}
              class="text-xs font-medium text-[#18212A] hover:text-[#226192] px-2 py-1 transition-colors"
            >
              Sign In
            </a>
            <a
              href={`${cpUrl()}/signup`}
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
