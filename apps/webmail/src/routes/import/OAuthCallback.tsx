import { Component, onMount } from "solid-js";

export const OAuthCallback: Component = () => {
  onMount(() => {
    try {
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.substring(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);

      const provider = params.get("provider");
      const mailboxId = params.get("mailbox_id");
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token") || undefined;
      const expiresIn = params.get("expires_in")
        ? parseInt(params.get("expires_in")!, 10)
        : 3600;
      const error = params.get("error");

      if (window.opener) {
        window.opener.postMessage(
          {
            type: "BYOS_OAUTH_CALLBACK",
            provider,
            mailboxId,
            accessToken,
            refreshToken,
            expiresIn,
            error,
          },
          window.location.origin
        );
      }

      // Close popup after brief delay
      setTimeout(() => {
        window.close();
      }, 300);
    } catch (err) {
      console.error("Failed to parse OAuth callback hash:", err);
    }
  });

  return (
    <div class="min-h-screen bg-[#F0EEE9] flex items-center justify-center p-4 font-sans text-center">
      <div class="bg-white p-6 rounded-2xl border border-[#E2DFD8] shadow-sm max-w-sm w-full space-y-3">
        <div class="w-10 h-10 rounded-full bg-[#F2E8E2] text-[#A27561] flex items-center justify-center mx-auto">
          <svg class="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        </div>
        <h2 class="text-sm font-bold text-[#1A1B1E]">Authorization Complete</h2>
        <p class="text-xs text-[#6E7075]">Returning to BYOS Webmail. You can close this window.</p>
      </div>
    </div>
  );
};
