import { Component, Show } from "solid-js";
import { getGlobalError, clearGlobalError } from "../errors";

export const GlobalErrorBanner: Component = () => {
  return (
    <Show when={getGlobalError()}>
      {(err) => (
        <div
          class="fixed top-4 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[92%] sm:w-auto pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200"
          data-testid="global-error-banner"
        >
          <div
            role="alert"
            aria-live="assertive"
            class="pointer-events-auto px-4 py-3 rounded-xl shadow-lg border border-[#F87171]/40 bg-[#FDF2F2] dark:bg-[#2A1515] text-[#991B1B] dark:text-[#FCA5A5] flex items-center justify-between gap-3 text-xs sm:text-sm font-sans"
          >
            <div class="flex items-center gap-2">
              <svg
                class="w-4 h-4 text-[#EF4444] flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span class="font-medium">{err().message}</span>
            </div>
            <button
              onClick={() => clearGlobalError()}
              class="text-[#991B1B]/70 hover:text-[#991B1B] dark:text-[#FCA5A5]/70 dark:hover:text-[#FCA5A5] p-1 rounded-md transition-colors cursor-pointer"
              aria-label="Dismiss error"
              data-testid="dismiss-global-error"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                aria-hidden="true"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </Show>
  );
};
