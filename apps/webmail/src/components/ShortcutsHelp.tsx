import { Component, Show, For } from "solid-js";

interface ShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export const ShortcutsHelp: Component<ShortcutsHelpProps> = (props) => {
  const shortcuts = [
    { key: "c", description: "Compose" },
    { key: "r", description: "Reply" },
    { key: "f", description: "Forward" },
    { key: "e", description: "Archive" },
    { key: "j / k", description: "Next / previous message" },
    { key: "/", description: "Search" },
    { key: "?", description: "Show this help" },
    { key: "Esc", description: "Close" },
  ];

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fade-in"
        onClick={props.onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Shortcuts"
      >
        <div
          class="bg-white dark:bg-[#1E2025] rounded-2xl shadow-2xl border border-[#E2DFD8] dark:border-[#2E3138] p-6 max-w-md w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-base font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Keyboard Shortcuts</h2>
            <button
              type="button"
              onClick={props.onClose}
              class="text-[#6E7075] hover:text-[#1A1B1E] dark:text-[#878A8E] dark:hover:text-[#F3F4F6] p-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 cursor-pointer"
              aria-label="Close shortcuts help"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="space-y-2">
            <For each={shortcuts}>
              {(s) => (
                <div class="flex items-center justify-between text-sm py-1.5 border-b border-[#E2DFD8]/40 dark:border-[#2E3138]/40 last:border-b-0 text-[#3C3D3E] dark:text-[#C5C7CB]">
                  <span>{s.description}</span>
                  <kbd class="px-2 py-0.5 rounded-md bg-[#F0EEE9] dark:bg-[#2E3138] font-mono text-xs border border-[#E2DFD8] dark:border-[#383C44] text-[#1A1B1E] dark:text-[#F3F4F6] shadow-2xs">
                    {s.key}
                  </kbd>
                </div>
              )}
            </For>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            class="mt-6 w-full py-2.5 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold shadow-xs transition focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </Show>
  );
};
