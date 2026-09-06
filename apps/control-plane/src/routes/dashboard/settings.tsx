import { Component } from "solid-js";
import { A } from "@solidjs/router";

const SettingsPage: Component = () => {
  return (
    <div class="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 class="text-2xl font-semibold text-slate-900">Settings</h1>
      <p class="mt-1 text-sm text-slate-500">
        Account, security, and organization configuration.
      </p>

      <div class="mt-6 grid gap-4">
        <A
          href="/dashboard/recovery"
          class="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-sky-300 hover:shadow-md transition-shadow"
        >
          <span class="text-2xl" aria-hidden="true">🔑</span>
          <div>
            <div class="font-medium text-slate-900">Recovery Phrase</div>
            <div class="mt-0.5 text-sm text-slate-500">
              Generate and verify your mailbox recovery phrase. Keep this safe — it is the only way to
              recover encrypted mailbox content if you lose access.
            </div>
          </div>
        </A>

        <A
          href="/dashboard/members"
          class="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm hover:border-sky-300 hover:shadow-md transition-shadow"
        >
          <span class="text-2xl" aria-hidden="true">👥</span>
          <div>
            <div class="font-medium text-slate-900">Organization Members</div>
            <div class="mt-0.5 text-sm text-slate-500">
              View and manage the members of your organization. Owners can change roles and terminate users.
            </div>
          </div>
        </A>

        <div class="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm opacity-60 cursor-not-allowed">
          <span class="text-2xl" aria-hidden="true">📱</span>
          <div>
            <div class="font-medium text-slate-900">Trusted Devices</div>
            <div class="mt-0.5 text-sm text-slate-500">
              Manage devices that can access your encrypted mailbox. Device enrollment is available via
              the recovery page. Revocation is available per-device.
            </div>
            <div class="mt-1 text-xs text-amber-700 font-medium">Coming next</div>
          </div>
        </div>

        <div class="flex items-start gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm opacity-60 cursor-not-allowed">
          <span class="text-2xl" aria-hidden="true">🔒</span>
          <div>
            <div class="font-medium text-slate-900">Two-Factor Authentication</div>
            <div class="mt-0.5 text-sm text-slate-500">
              Add an extra layer of protection to your account login.
            </div>
            <div class="mt-1 text-xs text-amber-700 font-medium">Coming next</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
