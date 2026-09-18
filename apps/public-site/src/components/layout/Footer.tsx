export function Footer() {
  const cpUrl = () => {
    const envUrl = (import.meta as unknown as { env: Record<string, string> }).env?.PUBLIC_CP_URL;
    return envUrl || "http://127.0.0.1:3000";
  };

  return (
    <footer class="relative spacer text-[#2B2C2D]">
      {/* Dark section overlapping the top with visible radius */}
      <div class="relative -top-[30px] h-[30px] rounded-b-[20px] md:rounded-b-[24px] bg-[#2B2C2D] shadow-xl w-full" />

      <div class="max-w-7xl mx-auto px-6 pt-12 pb-16 relative z-10">
        {/* 5-Column Grid */}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-12 border-b border-[#E2DFD8]">
          {/* Company Info - Span 2 Columns */}
          <div class="lg:col-span-2 space-y-4">
            <div class="mb-6">
              <a href="/" class="flex items-center gap-2.5 group mb-3">
                <div class="bg-[#9E725F] text-white px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider group-hover:bg-[#865E4D] transition-colors shadow-2xs">
                  BYOS
                </div>
                <h3 class="text-xl font-bold tracking-tight text-[#2B2C2D]">
                  BYOS Email Technologies
                </h3>
              </a>
              <p class="text-[#6F7173] mb-5 text-xs sm:text-sm leading-relaxed max-w-md">
                Engineering business email sovereignty with zero storage markup. Store email directly in your Cloudflare R2, AWS S3, or Google Drive with end-to-end device-locked encryption.
              </p>

              {/* Social Icon Squircle Buttons with Glassmorphism Blur */}
              <div class="flex items-center space-x-3">
                {/* Twitter / X */}
                <a
                  href="https://x.com/byos_email"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="w-10 h-10 rounded-[20px] text-[#2B2C2D] flex items-center justify-center bg-white/50 border border-[#E2DFD8] backdrop-blur-sm hover:bg-[#9E725F] hover:text-white hover:border-[#9E725F] transition-all shadow-2xs cursor-pointer"
                  aria-label="Follow us on Twitter"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                </a>

                {/* GitHub */}
                <a
                  href="https://github.com/byos-email"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="w-10 h-10 rounded-[20px] text-[#2B2C2D] flex items-center justify-center bg-white/50 border border-[#E2DFD8] backdrop-blur-sm hover:bg-[#9E725F] hover:text-white hover:border-[#9E725F] transition-all shadow-2xs cursor-pointer"
                  aria-label="GitHub Repository"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
                  </svg>
                </a>

                {/* LinkedIn */}
                <a
                  href="https://www.linkedin.com/company/byos-email"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="w-10 h-10 rounded-[20px] text-[#2B2C2D] flex items-center justify-center bg-white/50 border border-[#E2DFD8] backdrop-blur-sm hover:bg-[#9E725F] hover:text-white hover:border-[#9E725F] transition-all shadow-2xs cursor-pointer"
                  aria-label="Follow us on LinkedIn"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.77v8.37H6.46v-8.37M7.84 6.2a1.62 1.62 0 1 0 1.63 1.62A1.63 1.63 0 0 0 7.84 6.2z"/>
                  </svg>
                </a>

                {/* Discord / Community */}
                <a
                  href="https://discord.gg/byos"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="w-10 h-10 rounded-[20px] text-[#2B2C2D] flex items-center justify-center bg-white/50 border border-[#E2DFD8] backdrop-blur-sm hover:bg-[#9E725F] hover:text-white hover:border-[#9E725F] transition-all shadow-2xs cursor-pointer"
                  aria-label="Join our Discord community"
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Information Links */}
          <div>
            <h4 class="text-base font-bold text-[#2B2C2D] mb-4 border-b border-[#E2DFD8] pb-2">
              Information
            </h4>
            <ul class="space-y-2.5 text-xs text-[#6F7173]">
              <li>
                <a href="/security" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Security Overview
                </a>
              </li>
              <li>
                <a href="/security#architecture" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Device Key Security
                </a>
              </li>
              <li>
                <a href="/privacy" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Zero-Knowledge Charter
                </a>
              </li>
              <li>
                <a href="/docs" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Setup Guides
                </a>
              </li>
              <li>
                <a href="/privacy#terms" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h4 class="text-base font-bold text-[#2B2C2D] mb-4 border-b border-[#E2DFD8] pb-2">
              Quick Links
            </h4>
            <ul class="space-y-2.5 text-xs text-[#6F7173]">
              <li>
                <a href="/" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Home
                </a>
              </li>
              <li>
                <a href="/#how-it-works" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  How It Works
                </a>
              </li>
              <li>
                <a href="/pricing" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Pricing &amp; Calculator
                </a>
              </li>
              <li>
                <a href="/#features" class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Features &amp; Apps
                </a>
              </li>
              <li>
                <a href={`${cpUrl()}/login`} class="hover:text-[#9E725F] transition-colors block py-0.5">
                  Control Panel Sign In
                </a>
              </li>
            </ul>
          </div>

          {/* Contact Us */}
          <div>
            <h4 class="text-base font-bold text-[#2B2C2D] mb-4 border-b border-[#E2DFD8] pb-2">
              Contact Us
            </h4>
            <address class="not-italic space-y-3 text-[#6F7173] text-xs mb-5">
              {/* Address */}
              <div class="flex items-start">
                <svg class="w-4 h-4 mr-2.5 mt-0.5 shrink-0 text-[#9E725F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span class="leading-relaxed">
                  548 Market St, Suite 300<br />
                  San Francisco, CA 94104<br />
                  United States
                </span>
              </div>

              {/* Phone */}
              <div class="flex items-center">
                <svg class="w-4 h-4 mr-2.5 shrink-0 text-[#9E725F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                <span>+1 (415) 890-2967</span>
              </div>

              {/* Email */}
              <div class="flex items-center">
                <svg class="w-4 h-4 mr-2.5 shrink-0 text-[#9E725F]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>support@byos.email</span>
              </div>
            </address>

            {/* Action CTA with Shine Effect */}
            <div class="mt-4">
              <a
                href="/pricing"
                class="inline-flex items-center px-4 py-2 bg-[#2B2C2D] text-white rounded-[10px] hover:rounded-[14px] hover:bg-[#9E725F] transition-all duration-300 shine-effect text-xs font-semibold shadow-xs"
              >
                <span>Calculate Capacity</span>
                <svg class="w-3.5 h-3.5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* Huge Reveal Text Statement at Bottom */}
        <div class="flex">
          <div class="w-full justify-center text-center flex items-end z-0 h-[28vh] sm:h-[35vh] lg:h-[40vh] mb-[15px] pointer-events-none select-none">
            <h2 class="text-[44px] sm:text-[80px] lg:text-[115px] font-extrabold leading-none reveal-text text-[#2B2C2D]/10 tracking-tighter">
              BUSINESS EMAIL YOU OWN
            </h2>
          </div>
        </div>

        {/* Footer Bottom Bar */}
        <div class="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6F7173] border-t border-[#E2DFD8]">
          <div>
            &copy; 2026 BYOS Email Technologies. All rights reserved.
          </div>

          <div class="flex items-center gap-3">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white border border-[#E2DFD8] text-[11px] font-mono text-[#2B2C2D] shadow-2xs">
              <span class="relative flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>All Systems Operational</span>
            </div>

            <span class="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F3ECE8] text-[#9E725F] font-mono text-[10px] font-semibold border border-[#9E725F]/20">
              Private by Default &bull; 0% Storage Markup
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
