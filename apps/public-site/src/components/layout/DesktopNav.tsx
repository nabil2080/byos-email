export function DesktopNav() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const navLinks = [
    { label: "Home", href: "/" },
    { label: "Features", href: "/#features" },
    { label: "How It Works", href: "/#how-it-works" },
    { label: "Pricing", href: "/pricing" },
    { label: "Security", href: "/security" },
    { label: "Docs", href: "/docs" },
  ];

  return (
    <div class="relative w-full">
      <nav
        class="desktop-nav absolute -top-[1px] left-1/2 -translate-x-1/2 z-30 px-6 py-6 hidden lg:block rounded-b-[30px] duration-500 w-full transition-all max-w-[860px]"
        style={{
          "background-color": "var(--background, #F0EEE9)",
        }}
      >
        {/* Top Navbar Row */}
        <div class="flex items-center justify-between px-2">
          {/* Logo Badge */}
          <a href="/" class="flex items-center gap-2.5 group shrink-0">
            <div class="flex items-center justify-center bg-[#9E725F] text-white px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider shadow-xs group-hover:bg-[#865E4D] transition-colors">
              BYOS
            </div>
            <div class="flex flex-col">
              <span class="font-bold text-sm tracking-tight text-[#2B2C2D]">Business Email</span>
              <span class="text-[9px] font-mono uppercase tracking-widest text-[#9E725F] font-semibold -mt-0.5">Zero Markup</span>
            </div>
          </a>

          {/* Center Navigation Links (Clean, Direct Links - No Dropdowns) */}
          <div class="flex items-center gap-6">
            {navLinks.map((link) => (
              <a
                href={link.href}
                class="text-sm font-medium transition-colors text-[#2B2C2D] hover:text-[#9E725F] shine-effect py-1"
              >
                {link.label}
              </a>
            ))}
          </div>

          {/* Right Action Controls */}
          <div class="flex items-center gap-3">
            <a
              href={`${cpUrl()}/login`}
              class="text-xs font-medium text-[#2B2C2D] hover:text-[#9E725F] px-2 py-1 transition-colors"
            >
              Sign In
            </a>
            <a
              href={`${cpUrl()}/register`}
              class="px-5 py-2 text-xs font-semibold btn-primary shine-effect shadow-xs"
            >
              Start Free Trial
            </a>
          </div>
        </div>
      </nav>
    </div>
  );
}
