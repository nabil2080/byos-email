import { createSignal, onMount } from "solid-js";

export function DesktopNav() {
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
  });

  const isActive = (href: string) =>
    href.startsWith("/#") ? false : pathname() === href || pathname() === `${href}/`;

  return (
    <div class="relative w-full">
      <nav
        aria-label="Primary"
        class="desktop-nav absolute -top-[1px] left-1/2 -translate-x-1/2 z-30 px-6 py-5 hidden lg:block rounded-b-[28px] duration-500 w-full transition-all max-w-[900px]"
        style={{
          "background-color": "var(--background, #EAE6DE)",
        }}
      >
        <div class="flex items-center justify-between px-2">
          {/* Logo */}
          <a href="/" class="flex items-center gap-2.5 group shrink-0" aria-label="BYOS home">
            <div class="flex items-center justify-center bg-[#226192] text-white px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider shadow-xs group-hover:bg-[#1B4E76] transition-colors">
              BYOS
            </div>
            <div class="flex flex-col leading-tight">
              <span class="font-bold text-sm tracking-tight text-[#18212A]">Business Email</span>
              <span class="text-[10px] font-mono uppercase tracking-[0.2em] text-[#55616D] -mt-0.5">Your control</span>
            </div>
          </a>

          {/* Center links */}
          <div class="flex items-center gap-7">
            {navLinks.map((link) => (
              <a
                href={link.href}
                class={`relative text-sm font-medium transition-colors py-1 after:absolute after:left-0 after:-bottom-0.5 after:h-px after:bg-[#226192] after:transition-all after:duration-300 ${
                  isActive(link.href)
                    ? "text-[#226192] after:w-full"
                    : "text-[#18212A] hover:text-[#226192] after:w-0 hover:after:w-full"
                }`}
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Right actions */}
          <div class="flex items-center gap-3">
            <a
              href={`${cpUrl()}/login`}
              class="text-sm font-medium text-[#18212A] hover:text-[#226192] px-2.5 py-1 transition-colors"
            >
              Sign In
            </a>
            <a
              href={`${cpUrl()}/signup`}
              class="px-5 py-2 text-xs font-semibold btn-primary shadow-xs"
            >
              Get Started
            </a>
          </div>
        </div>
      </nav>
    </div>
  );
}
