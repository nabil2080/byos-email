import { Component, Show } from "solid-js";
import { isOffline, isReconnecting, isBackOnline } from "../offline";

export const OfflineBanner: Component = () => {
  return (
    <Show when={isOffline() || isReconnecting() || isBackOnline()}>
      <div
        class="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[92%] sm:w-auto pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200"
        data-testid="offline-banner"
      >
        <Show when={isOffline()}>
          <div
            role="status"
            aria-live="polite"
            class="pointer-events-auto px-4 py-2.5 rounded-xl shadow-md border border-[#F59E0B]/40 bg-[#FEF3C7] dark:bg-[#2E2009] text-[#92400E] dark:text-[#FCD34D] flex items-center gap-3 text-xs sm:text-sm font-sans"
            data-testid="offline-status-banner"
          >
            <svg
              class="w-4 h-4 text-[#D97706] dark:text-[#F59E0B] flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              {/* Cloud-offline icon */}
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M3 3l18 18M10.5 4.5A6.5 6.5 0 0117 10h1a4 4 0 012.7 6.9M6.5 6.5A6.5 6.5 0 004 12a4 4 0 004 4h10"
              />
            </svg>
            <span class="font-medium">
              You are offline. Showing cached messages from this session. Changes will sync when reconnected.
            </span>
          </div>
        </Show>

        <Show when={isReconnecting()}>
          <div
            role="status"
            aria-live="polite"
            class="pointer-events-auto px-4 py-2.5 rounded-xl shadow-md border border-[#3B82F6]/40 bg-[#EFF6FF] dark:bg-[#1E293B] text-[#1E40AF] dark:text-[#93C5FD] flex items-center gap-3 text-xs sm:text-sm font-sans"
            data-testid="reconnecting-status-banner"
          >
            <svg
              class="w-4 h-4 text-[#3B82F6] animate-spin flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              {/* Sync/spinner icon */}
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span class="font-medium">
              Reconnecting... syncing changes.
            </span>
          </div>
        </Show>

        <Show when={isBackOnline()}>
          <div
            role="status"
            aria-live="polite"
            class="pointer-events-auto px-4 py-2.5 rounded-xl shadow-md border border-[#10B981]/40 bg-[#ECFDF5] dark:bg-[#064E3B]/40 text-[#065F46] dark:text-[#6EE7B7] flex items-center gap-3 text-xs sm:text-sm font-sans"
            data-testid="back-online-status-banner"
          >
            <svg
              class="w-4 h-4 text-[#10B981] flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              aria-hidden="true"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span class="font-medium">
              Back online. Pending changes synced.
            </span>
          </div>
        </Show>
      </div>
    </Show>
  );
};
