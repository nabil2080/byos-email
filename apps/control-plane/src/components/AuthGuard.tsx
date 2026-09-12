import { Component, JSX, Show, createEffect, onMount } from "solid-js";
import { OrgProvider, useOrg } from "../context/OrgContext";

interface AuthGuardProps {
  children?: JSX.Element;
}

const AuthGuardContent: Component<AuthGuardProps> = (props) => {
  const org = useOrg();

  createEffect(() => {
    if (!org.isLoading) {
      if (!org.isAuthenticated) {
        // Not authenticated -> redirect to login
        const currentPath = window.location.pathname;
        const redirectUrl = currentPath && currentPath !== "/login" 
          ? `/login?redirect=${encodeURIComponent(currentPath)}` 
          : "/login";
        window.location.replace(redirectUrl);
      } else if (org.isMember) {
        // Role is member -> redirect to webmail
        const webmailBase = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL || "http://127.0.0.1:3001";
        window.location.replace(webmailBase);
      }
    }
  });

  return (
    <>
      <Show when={org.isLoading}>
        <div class="min-h-screen bg-[#F0EEE9] flex flex-col items-center justify-center p-6 text-center">
          <div class="w-12 h-12 rounded-xl bg-[#9E725F] flex items-center justify-center shadow-md mb-4 text-[#F0EEE9] font-mono font-bold text-lg animate-pulse">
            BYOS
          </div>
          <div class="flex items-center gap-2 text-[#3C3D3E] font-medium text-sm">
            <svg class="animate-spin h-4 w-4 text-[#9E725F]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Verifying administrative session…</span>
          </div>
        </div>
      </Show>

      <Show when={!org.isLoading && !org.isAuthenticated}>
        <div class="min-h-screen bg-[#F0EEE9] flex flex-col items-center justify-center p-6 text-center">
          <div class="w-10 h-10 rounded-lg bg-[#9E725F]/10 flex items-center justify-center mb-3 text-[#9E725F]">
            🔒
          </div>
          <h2 class="text-lg font-semibold text-[#3C3D3E]">Session Required</h2>
          <p class="text-sm text-[#6F7173] mt-1 max-w-sm">Redirecting you to sign in…</p>
          <a
            href="/login"
            class="mt-4 inline-flex items-center justify-center rounded-md bg-[#9E725F] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors"
          >
            Go to Sign In
          </a>
        </div>
      </Show>

      <Show when={!org.isLoading && org.isAuthenticated && org.isMember}>
        <div class="min-h-screen bg-[#F0EEE9] flex flex-col items-center justify-center p-6 text-center">
          <div class="max-w-md w-full bg-white rounded-xl border border-[#E2DFD8] p-8 shadow-sm">
            <div class="w-12 h-12 mx-auto rounded-full bg-[#F3ECE8] text-[#9E725F] flex items-center justify-center text-xl mb-4">
              ✉️
            </div>
            <h2 class="text-xl font-bold text-[#3C3D3E]">Member Account Detected</h2>
            <p class="mt-2 text-sm text-[#6F7173] leading-relaxed">
              The Control Panel is reserved for organization Owners and Administrators. Standard mailbox users access their inbox through Webmail.
            </p>
            <div class="mt-6 flex flex-col gap-2">
              <a
                href={(import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEBMAIL_URL || "http://127.0.0.1:3001"}
                class="w-full inline-flex items-center justify-center rounded-lg bg-[#9E725F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#865E4D] transition-colors"
              >
                Launch Webmail Client →
              </a>
              <button
                type="button"
                onClick={() => org.logout()}
                class="w-full inline-flex items-center justify-center rounded-lg border border-[#E2DFD8] px-4 py-2 text-xs font-medium text-[#6F7173] hover:bg-[#F0EEE9] transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </Show>

      <Show when={!org.isLoading && org.isAuthenticated && org.isAdmin}>
        {props.children}
      </Show>
    </>
  );
};

export const AuthGuard: Component<AuthGuardProps> = (props) => {
  return (
    <OrgProvider>
      <AuthGuardContent>{props.children}</AuthGuardContent>
    </OrgProvider>
  );
};

export default AuthGuard;
