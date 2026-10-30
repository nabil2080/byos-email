import { Component } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { recordTourReset } from "../../tours/runner";
import { CONTROL_PLANE_V1_ID } from "../../tours/control_plane_v1";

const SettingsPage: Component = () => {
  const navigate = useNavigate();

  const handleRestartTour = async () => {
    await recordTourReset(CONTROL_PLANE_V1_ID);
    navigate("/dashboard?tour=restart");
  };

  return (
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="mb-8">
        <h1 class="text-2xl font-bold tracking-tight text-[#3C3D3E]">
          Settings & Security Governance
        </h1>
        <p class="mt-1 text-sm text-[#6F7173]">
          Manage organization members and enterprise cryptographic policies.
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
          href="/dashboard/security"
          data-testid="settings-security-card"
          class="flex items-start gap-4 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs hover:border-[#9E725F] hover:shadow-sm transition-all group"
        >
          <div class="w-10 h-10 rounded-xl bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center shrink-0 group-hover:bg-[#9E725F] group-hover:text-white transition-colors">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-base font-bold text-[#3C3D3E] group-hover:text-[#9E725F] transition-colors">
                Security & Authentication
              </span>
              <span class="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-800 uppercase">
                Active
              </span>
            </div>
            <div class="mt-1 text-xs text-[#6F7173] leading-relaxed">
              Manage Two-Factor Authentication (TOTP), recovery contacts, and FIDO2 / WebAuthn trusted hardware keys.
            </div>
          </div>
        </A>
      </div>

      {/* Guided Product Tour Replay Section */}
      <div class="mt-8 rounded-2xl border border-[#E2DFD8] bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-base font-bold text-[#3C3D3E]">Guided Product Tour</h2>
          <p class="mt-1 text-xs text-[#6F7173] leading-relaxed max-w-xl">
            Replay the step-by-step orientation walkthrough highlighting sovereign management features, verified domains, and security controls.
          </p>
        </div>
        <button
          type="button"
          data-testid="restart-tour-btn"
          onClick={handleRestartTour}
          class="inline-flex items-center justify-center gap-2 rounded-xl bg-[#9E725F] px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#865E4D] transition-colors cursor-pointer shrink-0"
        >
          <span>Restart Tour</span>
        </button>
      </div>
    </div>
  );
};

export default SettingsPage;
