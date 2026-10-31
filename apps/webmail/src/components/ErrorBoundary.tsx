import { Component, createSignal, JSX, Show, ErrorBoundary as SolidErrorBoundary } from "solid-js";

export interface AppErrorBoundaryProps {
  name?: string;
  fallbackTitle?: string;
  children: JSX.Element;
  onReset?: () => void;
}

export const AppErrorBoundary: Component<AppErrorBoundaryProps> = (props) => {
  return (
    <SolidErrorBoundary
      fallback={(err, reset) => {
        const [showDetails, setShowDetails] = createSignal(false);
        const errorMessage = () => (err instanceof Error ? err.message : String(err));
        const errorStack = () => (err instanceof Error && err.stack ? err.stack : "");

        const handleReset = () => {
          if (props.onReset) {
            props.onReset();
          }
          reset();
        };

        return (
          <div
            data-testid="app-error-boundary"
            class="flex-1 flex flex-col items-center justify-center p-6 sm:p-12 text-center bg-[#F0EEE9] dark:bg-[#121316] text-[#3C3D3E] dark:text-[#E2DFD8] min-h-[300px] h-full rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] m-2 transition-all duration-150"
          >
            <div class="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4 shadow-xs">
              <svg class="w-6 h-6 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 class="text-base font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
              {props.fallbackTitle || `${props.name || "View"} encountered a problem`}
            </h3>
            <p class="text-xs text-[#6F7173] dark:text-[#9CA3AF] max-w-md mb-6 leading-relaxed">
              We encountered an unexpected error while rendering this view. Your encrypted data remains safe and unmodified.
            </p>

            <div class="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReset}
                class="px-4 py-2 bg-[#9E725F] hover:bg-[#865E4D] text-white rounded-xl text-xs font-medium transition-all shadow-xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>Try Again</span>
              </button>

              <button
                type="button"
                onClick={() => setShowDetails(!showDetails())}
                class="px-3.5 py-2 bg-white dark:bg-[#1E1F23] hover:bg-[#F8F7F4] dark:hover:bg-[#2A2D35] text-[#3C3D3E] dark:text-[#D1D5DB] border border-[#E2DFD8] dark:border-[#2A2D35] rounded-xl text-xs font-medium transition-all shadow-2xs inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>{showDetails() ? "Hide Details" : "Technical Details"}</span>
              </button>
            </div>

            <Show when={showDetails()}>
              <div class="mt-6 w-full max-w-lg text-left bg-white dark:bg-[#18191D] p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs">
                <div class="text-[11px] font-mono text-rose-600 dark:text-rose-400 font-semibold break-all mb-2">
                  {errorMessage()}
                </div>
                <Show when={errorStack()}>
                  <pre class="text-[10px] font-mono text-[#6F7173] dark:text-[#9CA3AF] overflow-x-auto max-h-48 p-2 bg-[#F8F7F4] dark:bg-[#121316] rounded-lg">
                    {errorStack()}
                  </pre>
                </Show>
              </div>
            </Show>
          </div>
        );
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  );
};
