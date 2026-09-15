import { Component } from "solid-js";
import { A } from "@solidjs/router";

const SettingsPage: Component = () => {
  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Settings & Security Governance
        </h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Manage organization members, zero-knowledge recovery keys, and enterprise cryptographic policies.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <A
          href="/dashboard/members"
          class="flex items-start gap-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs hover:border-[#9E725F] hover:shadow-sm transition-all group"
        >
          <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0 group-hover:bg-[#9E725F] group-hover:text-white transition-colors">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <div class="text-base font-bold text-[#3C3D3E] group-hover:text-[#9E725F] transition-colors">
              Organization Members
            </div>
            <div class="mt-1 text-xs text-[#6F7173] leading-relaxed">
              View and administer member roles (Owner, Admin, Member) and revoke accounts.
            </div>
          </div>
        </A>

        <A
          href="/dashboard/recovery"
          class="flex items-start gap-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs hover:border-[#9E725F] hover:shadow-sm transition-all group"
        >
          <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0 group-hover:bg-[#9E725F] group-hover:text-white transition-colors">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m21 2-2 2m-1.5 1.5L14 9l-1.5-1.5-2.5 2.5L11.5 11.5 10 13l2 2-6 6a2 2 0 0 1-2.83-2.83l6-6-1.5-1.5 1.5-1.5 2.5 2.5L13 10l3.5-3.5" />
              <circle cx="7.5" cy="16.5" r="1.5" />
            </svg>
          </div>
          <div>
            <div class="text-base font-bold text-[#3C3D3E] group-hover:text-[#9E725F] transition-colors">
              Recovery Phrase & Keys
            </div>
            <div class="mt-1 text-xs text-[#6F7173] leading-relaxed">
              Inspect organization root key enrollment and test zero-knowledge mailbox recovery.
            </div>
          </div>
        </A>

        <A
          href="/dashboard/security"
          class="flex items-start gap-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs hover:border-[#9E725F] hover:shadow-sm transition-all group"
        >
          <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0 group-hover:bg-[#9E725F] group-hover:text-white transition-colors">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
              <line x1="12" y1="18" x2="12.01" y2="18" />
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-base font-bold text-[#3C3D3E] group-hover:text-[#9E725F] transition-colors">
                Hardware & Trusted Devices
              </span>
              <span class="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-800 uppercase">
                Active
              </span>
            </div>
            <div class="mt-1 text-xs text-[#6F7173] leading-relaxed">
              FIDO2 / WebAuthn biometric sensors (Touch ID, Windows Hello) and physical security keys (YubiKey).
            </div>
          </div>
        </A>

        <div class="flex items-start gap-4 rounded-2xl border border-[#E2DFD8] bg-white/60 p-6 opacity-75">
          <div class="w-10 h-10 rounded-xl bg-[#F0EEE9] text-[#6F7173] flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-base font-bold text-[#3C3D3E]">Two-Factor Authentication</span>
              <span class="rounded bg-[#9E725F]/15 px-2 py-0.5 text-[10px] font-mono font-bold text-[#9E725F] uppercase">
                Enforced
              </span>
            </div>
            <div class="mt-1 text-xs text-[#6F7173] leading-relaxed">
              Mandatory challenge verification on recovery actions and administrative elevation.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
