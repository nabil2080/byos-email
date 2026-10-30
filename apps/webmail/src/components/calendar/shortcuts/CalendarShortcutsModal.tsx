import { Component, Show, For } from "solid-js";

interface CalendarShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
}

interface ShortcutCategory {
  title: string;
  shortcuts: ShortcutItem[];
}

export const CalendarShortcutsModal: Component<CalendarShortcutsModalProps> = (props) => {
  const categories: ShortcutCategory[] = [
    {
      title: "Calendar Views",
      shortcuts: [
        { keys: ["1", "d"], description: "Day view" },
        { keys: ["2", "w"], description: "Week view" },
        { keys: ["3", "m"], description: "Month view" },
        { keys: ["4", "y"], description: "Year view" },
        { keys: ["5", "a"], description: "Agenda view" },
      ],
    },
    {
      title: "Navigation",
      shortcuts: [
        { keys: ["t"], description: "Jump to today" },
        { keys: ["p", "k"], description: "Previous period" },
        { keys: ["n", "j"], description: "Next period" },
      ],
    },
    {
      title: "Actions & Overlays",
      shortcuts: [
        { keys: ["c"], description: "Create new event" },
        { keys: ["/"], description: "Search calendar" },
        { keys: ["b"], description: "Booking page & appointment schedules" },
        { keys: ["?"], description: "Open keyboard shortcuts" },
        { keys: ["Esc"], description: "Close modal / drawer / menu" },
      ],
    },
  ];

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && props.isOpen) {
      props.onClose();
    }
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        onKeyDown={handleKeyDown}
      >
        <div
          data-testid="calendar-shortcuts-modal"
          class="bg-[#1A1817] border border-[#302B27] rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh] text-[#E3DDD4] animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#302B27]">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-[#9E725F]/20 border border-[#9E725F]/30 flex items-center justify-center text-[#D19A66]">
                <kbd class="font-mono text-xs font-bold">?</kbd>
              </div>
              <h2 id="shortcuts-dialog-title" class="text-base font-semibold text-[#E3DDD4]">
                Keyboard Shortcuts
              </h2>
            </div>
            <button
              type="button"
              data-testid="calendar-shortcuts-close-btn"
              onClick={props.onClose}
              aria-label="Close shortcuts modal"
              class="p-1.5 text-[#9E9085] hover:text-[#E3DDD4] hover:bg-[#252220] rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div class="p-6 overflow-y-auto space-y-6">
            <For each={categories}>
              {(cat) => (
                <div>
                  <h3 class="text-xs font-semibold text-[#9E9085] uppercase tracking-wider mb-2.5">
                    {cat.title}
                  </h3>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <For each={cat.shortcuts}>
                      {(shortcut) => (
                        <div class="flex items-center justify-between p-2 rounded-lg bg-[#252220]/60 border border-[#302B27]/60">
                          <span class="text-xs text-[#E3DDD4]">{shortcut.description}</span>
                          <div class="flex items-center gap-1">
                            <For each={shortcut.keys}>
                              {(k) => (
                                <kbd class="px-2 py-0.5 text-[11px] font-mono font-medium text-[#E3DDD4] bg-[#1A1817] border border-[#423C36] rounded shadow-xs">
                                  {k}
                                </kbd>
                              )}
                            </For>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* Footer */}
          <div class="px-6 py-3 bg-[#171514] border-t border-[#302B27] text-xs text-[#9E9085] flex items-center justify-between rounded-b-xl">
            <span>Press <kbd class="font-mono text-[10px] bg-[#252220] px-1.5 py-0.5 rounded border border-[#423C36]">?</kbd> anywhere in calendar to reopen</span>
            <button
              type="button"
              onClick={props.onClose}
              class="px-3 py-1 bg-[#302B27] hover:bg-[#3D3732] text-[#E3DDD4] rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
