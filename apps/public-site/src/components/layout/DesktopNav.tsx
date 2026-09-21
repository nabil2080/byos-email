export function DesktopNav() {
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

  return (
    <div class="relative w-full">
      <nav
        aria-label="Primary"
        class="desktop-nav absolute -top-[1px] left-1/2 -translate-x-1/2 z-30 px-6 py-6 hidden lg:block rounded-b-[30px] duration-500 w-full transition-all max-w-[880px]"
        style={{
          "background-color": "var(--background, #F0EEE9)",
        }}
      >
        <div class="flex items-center justify-between px-2">
          {/* Logo */}
          <a href="/" class="flex items-center gap-2.5 group shrink-0" aria-label="BYOS home">
            <div class="flex items-center justify-center bg-[#9E725F] text-white px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider shadow-xs group-hover:bg-[#865E4D] transition-colors">
              BYOS
            </div>
            <div class="flex flex-col leading-tight">
              <span class="font-bold text-sm tracking-tight text-[#2B2C2D]">Business Email</span>
              <span class="text-[9px] font-mono uppercase tracking-[0.2em] text-[#6F7173] -mt-0.5">Your control</span>
            </div>
          </a>

          {/* Center links */}
          <div class="flex items-center gap-8">
            {navLinks.map((link) => (
              <a
                href={link.href}
                class="relative text-sm font-medium text-[#2B2C2D] transition-colors hover:text-[#9E725F] py-1 after:absolute after:left-0 after:-bottom-0.5 after:h-px after:w-0 after:bg-[#9E725F] after:transition-all after:duration-300 hover:after:w-full"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Right actions */}
          <div class="flex items-center gap-3">
            <a
              href={`${cpUrl()}/login`}
              class="text-sm font-medium text-[#2B2C2D] hover:text-[#9E725F] px-2 py-1 transition-colors"
            >
              Sign In
            </a>
            <a
              href={`${cpUrl()}/register`}
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
