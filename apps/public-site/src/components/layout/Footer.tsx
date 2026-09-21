export function Footer() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  const groups = [
    {
      title: "Product",
      links: [
        { label: "Features", href: "/#features" },
        { label: "Pricing", href: "/pricing" },
        { label: "Security", href: "/security" },
        { label: "Docs", href: "/docs" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "/#features" },
        { label: "Blog", href: "/blog" },
        { label: "Contact", href: "mailto:hello@byos.email" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: "/privacy" },
        { label: "Terms", href: "/privacy#terms" },
      ],
    },
    {
      title: "Account",
      links: [
        { label: "Sign In", href: `${cpUrl()}/login` },
        { label: "Get Started", href: `${cpUrl()}/register` },
      ],
    },
  ];

  const socials = [
    {
      label: "X",
      href: "https://x.com/byos_email",
      path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
    },
    {
      label: "GitHub",
      href: "https://github.com/byos-email",
      path: "M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z",
    },
    {
      label: "LinkedIn",
      href: "https://www.linkedin.com/company/byos-email",
      path: "M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.77v8.37H6.46v-8.37M7.84 6.2a1.62 1.62 0 1 0 1.63 1.62A1.63 1.63 0 0 0 7.84 6.2z",
    },
  ];

  return (
    <footer class="bg-[#3C3D3E] text-[#F0EEE9]">
      <div class="mx-auto max-w-7xl px-6 pt-16 pb-10">
        {/* Top grid */}
        <div class="grid grid-cols-2 gap-10 border-b border-white/10 pb-12 md:grid-cols-6">
          {/* Brand — spans 2 */}
          <div class="col-span-2">
            <a href="/" class="mb-4 inline-flex items-center gap-2.5 group" aria-label="BYOS home">
              <span class="rounded-lg bg-[#9E725F] px-2.5 py-1 font-mono text-xs font-bold tracking-wider text-white group-hover:bg-[#865E4D] transition-colors">
                BYOS
              </span>
              <span class="font-display text-lg font-bold tracking-tight text-[#F0EEE9]">
                Business Email
              </span>
            </a>
            <p class="max-w-xs text-sm leading-relaxed text-[#8B8E91]">
              Professional business email with customer-controlled storage and privacy-focused
              architecture.
            </p>
            <p class="mt-4 text-[11px] font-mono uppercase tracking-[0.18em] text-[#6F7173]">
              Your email. Your storage. Your control.
            </p>

            <div class="mt-6 flex items-center gap-3">
              {socials.map((s) => (
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={s.label}
                  class="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#F0EEE9] transition-all hover:border-[#9E725F] hover:bg-[#9E725F] hover:text-white"
                >
                  <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d={s.path} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Link groups */}
          {groups.map((group) => (
            <div>
              <h3 class="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#F0EEE9]">
                {group.title}
              </h3>
              <ul class="mt-4 space-y-2.5">
                {group.links.map((link) => (
                  <li>
                    <a
                      href={link.href}
                      class="text-sm text-[#8B8E91] transition-colors hover:text-[#9E725F]"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Large restrained wordmark */}
        <div class="pointer-events-none select-none py-10 text-center">
          <h2 class="font-display text-[13vw] font-extrabold leading-none tracking-tighter text-white/5 md:text-[9rem]">
            YOUR CONTROL
          </h2>
        </div>

        {/* Bottom bar */}
        <div class="flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 text-xs text-[#8B8E91] sm:flex-row">
          <span>&copy; 2026 BYOS Business Email. All rights reserved.</span>
          <span class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px]">
            <span class="h-1.5 w-1.5 rounded-full bg-[#9E725F]"></span>
            Privacy-focused architecture
          </span>
        </div>
      </div>
    </footer>
  );
}
