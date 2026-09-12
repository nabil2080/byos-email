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
          <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center text-lg shrink-0 group-hover:bg-[#9E725F] group-hover:text-white transition-colors">
            👥
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
          <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center text-lg shrink-0 group-hover:bg-[#9E725F] group-hover:text-white transition-colors">
            🔑
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

        <div class="flex items-start gap-4 rounded-2xl border border-[#E2DFD8] bg-white/60 p-6 opacity-75">
          <div class="w-10 h-10 rounded-xl bg-[#F0EEE9] text-[#6F7173] flex items-center justify-center text-lg shrink-0">
            📱
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-base font-bold text-[#3C3D3E]">Hardware & Trusted Devices</span>
              <span class="rounded bg-[#9E725F]/15 px-2 py-0.5 text-[10px] font-mono font-bold text-[#9E725F] uppercase">
                Phase 2
              </span>
            </div>
            <div class="mt-1 text-xs text-[#6F7173] leading-relaxed">
              FIDO2 / WebAuthn hardware token attestation and per-device cryptographic key revocation.
            </div>
          </div>
        </div>

        <div class="flex items-start gap-4 rounded-2xl border border-[#E2DFD8] bg-white/60 p-6 opacity-75">
          <div class="w-10 h-10 rounded-xl bg-[#F0EEE9] text-[#6F7173] flex items-center justify-center text-lg shrink-0">
            🔒
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
