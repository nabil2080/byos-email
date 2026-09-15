export function Footer() {
  return (
    <footer class="relative pt-16 sm:pt-20 text-[#3C3D3E] bg-white border-t border-[#E2DFD8] mt-24">
      <div class="mx-auto max-w-7xl px-6 pb-12">
        {/* 5-Column Enterprise Grid */}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-14 border-b border-[#E2DFD8]">
          
          {/* Column 1: Brand & Infrastructure Beacon (Takes 1.5 col equivalent or 1 col on 5-col grid) */}
          <div class="lg:col-span-1 space-y-4">
            <a href="/" class="flex items-center gap-2.5 group">
              <div class="bg-[#9E725F] text-white px-2.5 py-1 rounded-lg text-xs font-mono font-bold tracking-wider group-hover:bg-[#865E4D] transition-colors">
                BYOS
              </div>
              <span class="font-bold text-base tracking-tight text-[#3C3D3E]">Business Email</span>
            </a>
            <p class="text-xs text-[#6F7173] leading-relaxed">
              The sovereign business email platform. Customer-controlled storage underneath; normal email on the outside.
            </p>
            
            {/* Live Infrastructure Beacon */}
            <div class="pt-2">
              <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#F8F7F4] border border-[#E2DFD8] text-[11px] font-mono text-[#3C3D3E] shadow-2xs">
                <span class="relative flex h-2 w-2">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <span>All Systems Operational</span>
              </div>
              <div class="text-[10px] font-mono text-[#6F7173] mt-1 pl-1">
                Postfix MTA &bull; S3 Sync Active
              </div>
            </div>
          </div>

          {/* Column 2: Product */}
          <div class="space-y-3">
            <h4 class="text-xs font-mono uppercase tracking-wider text-[#9E725F] font-bold">
              Product
            </h4>
            <ul class="space-y-2.5 text-xs text-[#6F7173]">
              <li>
                <a href="/" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Webmail Client
                </a>
              </li>
              <li>
                <a href="/#how-it-works" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  BYOS Storage Architecture
                </a>
              </li>
              <li>
                <a href="/docs#bridge" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Desktop IMAP/SMTP Bridge
                </a>
              </li>
              <li>
                <a href="/pricing" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Pricing &amp; Capacity Tiers
                </a>
              </li>
              <li>
                <a href="/docs#changelog" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Changelog &amp; Releases
                </a>
              </li>
            </ul>
          </div>

          {/* Column 3: Security & Cryptography */}
          <div class="space-y-3">
            <h4 class="text-xs font-mono uppercase tracking-wider text-[#9E725F] font-bold">
              Security &amp; Crypto
            </h4>
            <ul class="space-y-2.5 text-xs text-[#6F7173]">
              <li>
                <a href="/security#threat-model" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Threat Model &amp; Whitepaper
                </a>
              </li>
              <li>
                <a href="/security#audit" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Independent Audit Gate
                </a>
              </li>
              <li>
                <a href="/security#protocol" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Zero-Knowledge Protocol
                </a>
              </li>
              <li>
                <a href="/docs#cli-export" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Open-Source CLI Export Tool
                </a>
              </li>
              <li>
                <a href="/security#disclosure" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Responsible Disclosure
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Resources & Legal */}
          <div class="space-y-3">
            <h4 class="text-xs font-mono uppercase tracking-wider text-[#9E725F] font-bold">
              Resources &amp; Legal
            </h4>
            <ul class="space-y-2.5 text-xs text-[#6F7173]">
              <li>
                <a href="/docs" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Documentation &amp; Guides
                </a>
              </li>
              <li>
                <a href="/docs#migration" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Migration Assistance
                </a>
              </li>
              <li>
                <a href="/privacy" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Privacy Policy (GDPR/HIPAA)
                </a>
              </li>
              <li>
                <a href="/privacy#terms" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="/privacy#subprocessors" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Subprocessors &amp; DPA
                </a>
              </li>
            </ul>
          </div>

          {/* Column 5: Direct Connect */}
          <div class="space-y-3">
            <h4 class="text-xs font-mono uppercase tracking-wider text-[#9E725F] font-bold">
              Direct Connect
            </h4>
            <ul class="space-y-2.5 text-xs text-[#6F7173]">
              <li>
                <a href="mailto:support@byos.email" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors flex items-center gap-1.5">
                  <span>Support Help Desk</span>
                  <span class="text-[10px] text-[#9E725F]">&rarr;</span>
                </a>
              </li>
              <li>
                <a href="https://github.com/byos-email" target="_blank" rel="noopener noreferrer" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors flex items-center gap-1.5">
                  <span>GitHub Repository</span>
                  <span class="text-[10px] text-[#9E725F]">↗</span>
                </a>
              </li>
              <li>
                <a href="https://status.byos.email" target="_blank" rel="noopener noreferrer" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors flex items-center gap-1.5">
                  <span>Status Page (status.byos.email)</span>
                  <span class="text-[10px] text-[#9E725F]">↗</span>
                </a>
              </li>
              <li>
                <a href="/login" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Control Panel Login
                </a>
              </li>
              <li>
                <a href="/signup" class="hover:text-[#3C3D3E] hover:underline underline-offset-4 transition-colors">
                  Create Organization
                </a>
              </li>
            </ul>
          </div>

        </div>

        {/* Footer Bottom Bar */}
        <div class="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6F7173]">
          <div>
            &copy; 2026 BYOS Email Technologies Ltd. All rights reserved.
          </div>

          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F3ECE8] text-[#9E725F] font-mono text-[10px] font-semibold border border-[#9E725F]/20">
              <span class="h-1.5 w-1.5 rounded-full bg-[#9E725F]"></span>
              <span>Cloud Dancer &amp; Mocha Mousse System</span>
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
