import { Component, JSX, Show, For } from "solid-js";

interface StepMeta {
  number: number;
  title: string;
  shortTitle: string;
}

const STEPS: StepMeta[] = [
  { number: 1, title: "Domain Setup", shortTitle: "Domain" },
  { number: 2, title: "Storage Mode", shortTitle: "Mode" },
  { number: 3, title: "Storage Connection", shortTitle: "Storage" },
  { number: 4, title: "Mailbox Creation", shortTitle: "Mailbox" },
  { number: 5, title: "Team Invitations", shortTitle: "Team" },
  { number: 6, title: "Activation Tracking", shortTitle: "Activation" },
  { number: 7, title: "System Verification", shortTitle: "Verify" },
];

interface OnboardingLayoutProps {
  currentStep: number;
  completedSteps: number[];
  onSkip?: () => void;
  isSkipping?: boolean;
  children?: JSX.Element;
}

export const OnboardingLayout: Component<OnboardingLayoutProps> = (props) => {
  const currentStepMeta = () => STEPS.find((s) => s.number === props.currentStep) || STEPS[0];

  return (
    <div class="min-h-screen bg-[#F0EEE9] text-[#3C3D3E] flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header class="bg-white border-b border-[#E2DFD8] sticky top-0 z-30 px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-[#9E725F] flex items-center justify-center text-white font-mono font-bold text-xs shadow-xs">
            BYOS
          </div>
          <div>
            <div class="text-xs font-bold text-[#3C3D3E] uppercase tracking-wider">
              Control Panel
            </div>
            <div class="text-[11px] text-[#6F7173]">
              Post-Payment Onboarding
            </div>
          </div>
        </div>

        {/* Step Indicator on Mobile */}
        <div class="sm:hidden text-xs font-medium text-[#6F7173]">
          Step <span class="font-bold text-[#3C3D3E]">{props.currentStep}</span> of 7
        </div>

        {/* Header Actions */}
        <div class="flex items-center gap-3">
          <Show when={props.onSkip}>
            <button
              type="button"
              onClick={() => props.onSkip?.()}
              disabled={props.isSkipping}
              class="inline-flex items-center gap-1 text-xs font-medium text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F0EEE9] px-3 py-1.5 rounded-lg border border-[#E2DFD8] transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
            >
              <span>{props.isSkipping ? "Skipping…" : "Skip setup for now"}</span>
              <span class="text-[10px]">→</span>
            </button>
          </Show>
        </div>
      </header>

      {/* Stepper Navigation Strip */}
      <nav aria-label="Onboarding Progress" class="bg-white/70 backdrop-blur-xs border-b border-[#E2DFD8] px-4 sm:px-8 py-3 overflow-x-auto">
        <div class="max-w-4xl mx-auto">
          {/* Mobile progress display */}
          <div class="sm:hidden flex items-center justify-between gap-2 text-xs">
            <span class="font-bold text-[#9E725F]">
              {props.currentStep}. {currentStepMeta().title}
            </span>
            <div class="flex-1 max-w-[120px] bg-[#E2DFD8] h-1.5 rounded-full overflow-hidden">
              <div
                class="bg-[#9E725F] h-full transition-all duration-300"
                style={{ width: `${(props.currentStep / 7) * 100}%` }}
              />
            </div>
          </div>

          {/* Desktop full horizontal stepper */}
          <ol class="hidden sm:flex items-center justify-between list-none p-0 m-0">
            <For each={STEPS}>
              {(step, idx) => {
                const isCompleted = () => props.completedSteps.includes(step.number) || props.currentStep > step.number;
                const isCurrent = () => props.currentStep === step.number;

                return (
                  <li class="flex items-center flex-1 last:flex-none">
                    <div class="flex items-center gap-2">
                      <div
                        class={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-all duration-200 flex-shrink-0 ${
                          isCompleted()
                            ? "bg-[#9E725F] text-white"
                            : isCurrent()
                            ? "bg-[#9E725F] text-white ring-4 ring-[#9E725F]/20"
                            : "bg-[#F0EEE9] text-[#6F7173] border border-[#E2DFD8]"
                        }`}
                        aria-current={isCurrent() ? "step" : undefined}
                      >
                        <Show
                          when={isCompleted()}
                          fallback={<span>{step.number}</span>}
                        >
                          <svg class="w-3.5 h-3.5 stroke-[2.5]" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </Show>
                      </div>
                      <span
                        class={`text-xs font-medium whitespace-nowrap hidden md:inline ${
                          isCurrent()
                            ? "text-[#3C3D3E] font-bold"
                            : isCompleted()
                            ? "text-[#3C3D3E]"
                            : "text-[#6F7173]"
                        }`}
                      >
                        {step.shortTitle}
                      </span>
                    </div>

                    <Show when={idx() < STEPS.length - 1}>
                      <div
                        class={`flex-1 h-0.5 mx-2 min-w-[12px] transition-colors duration-200 ${
                          isCompleted() ? "bg-[#9E725F]" : "bg-[#E2DFD8]"
                        }`}
                      />
                    </Show>
                  </li>
                );
              }}
            </For>
          </ol>
        </div>
      </nav>

      {/* Main Container */}
      <main class="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-8 flex flex-col justify-start">
        {props.children}
      </main>

      {/* Footer */}
      <footer class="mt-auto border-t border-[#E2DFD8] bg-white py-4 px-6 text-center text-xs text-[#6F7173]">
        <div class="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>BYOS Sovereign Zero-Knowledge Email Infrastructure</span>
          <span class="font-mono text-[11px]">Strict Local Verification Mode</span>
        </div>
      </footer>
    </div>
  );
};

export default OnboardingLayout;
