import { Component, Show, createSignal, onMount, onCleanup } from "solid-js";
import {
  computeLaterToday,
  computeTomorrow,
  computeThisWeekend,
  computeNextWeek,
  formatTime12,
} from "../snooze";
import { t } from "../utils/i18n";

export interface SnoozeMenuProps {
  open: boolean;
  onClose: () => void;
  onSelect: (until: Date) => void;
  anchorEl?: HTMLElement | null;
}

export const SnoozeMenu: Component<SnoozeMenuProps> = (props) => {
  const [showCustom, setShowCustom] = createSignal(false);
  const [customValue, setCustomValue] = createSignal("");

  const laterToday = () => computeLaterToday();
  const tomorrow = () => computeTomorrow();
  const thisWeekend = () => computeThisWeekend();
  const nextWeek = () => computeNextWeek();

  // Helper to format ISO local string for datetime-local min attribute
  const minDateTime = () => {
    const d = new Date(Date.now() + 60000);
    const offset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 16);
  };

  const handleCustomSubmit = (e: Event) => {
    e.preventDefault();
    if (!customValue()) return;
    const selected = new Date(customValue());
    if (isNaN(selected.getTime()) || selected.getTime() <= Date.now()) {
      return;
    }
    props.onSelect(selected);
    setShowCustom(false);
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center sm:items-start sm:justify-start sm:p-0 bg-black/20 backdrop-blur-2xs"
        onClick={() => {
          setShowCustom(false);
          props.onClose();
        }}
      >
        <div
          class="bg-white dark:bg-[#1E2025] rounded-xl shadow-xl border border-[#E2DFD8] dark:border-[#2E3138] w-72 overflow-hidden text-xs text-[#1A1B1E] dark:text-[#F3F4F6] sm:absolute sm:top-24 sm:right-28 animate-fade-in"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={t("Snooze")}
        >
          <div class="px-3.5 py-2.5 border-b border-[#E2DFD8]/60 dark:border-[#2E3138] flex items-center justify-between font-semibold">
            <span class="flex items-center gap-2">
              <svg class="w-4 h-4 stroke-[#A27561] fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {t("Snooze until…")}
            </span>
            <button
              type="button"
              onClick={() => {
                setShowCustom(false);
                props.onClose();
              }}
              class="text-[#6E7075] hover:text-[#1A1B1E] dark:hover:text-white p-0.5 rounded cursor-pointer"
            >
              ✕
            </button>
          </div>

          <div class="p-1 space-y-0.5">
            <button
              type="button"
              onClick={() => props.onSelect(laterToday())}
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] flex items-center justify-between transition cursor-pointer"
            >
              <span>{t("Later today")}</span>
              <span class="text-[#6E7075] dark:text-[#878A8E] text-[11px]">
                {formatTime12(laterToday())}
              </span>
            </button>

            <button
              type="button"
              onClick={() => props.onSelect(tomorrow())}
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] flex items-center justify-between transition cursor-pointer"
            >
              <span>{t("Tomorrow")}</span>
              <span class="text-[#6E7075] dark:text-[#878A8E] text-[11px]">
                8:00 AM
              </span>
            </button>

            <button
              type="button"
              onClick={() => props.onSelect(thisWeekend())}
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] flex items-center justify-between transition cursor-pointer"
            >
              <span>{t("This weekend")}</span>
              <span class="text-[#6E7075] dark:text-[#878A8E] text-[11px]">
                Sat, 8:00 AM
              </span>
            </button>

            <button
              type="button"
              onClick={() => props.onSelect(nextWeek())}
              class="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] flex items-center justify-between transition cursor-pointer"
            >
              <span>{t("Next week")}</span>
              <span class="text-[#6E7075] dark:text-[#878A8E] text-[11px]">
                Mon, 8:00 AM
              </span>
            </button>

            <div class="border-t border-[#E2DFD8]/60 dark:border-[#2E3138] my-1 pt-1">
              <Show
                when={showCustom()}
                fallback={
                  <button
                    type="button"
                    onClick={() => setShowCustom(true)}
                    class="w-full text-left px-3 py-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] flex items-center justify-between text-[#A27561] font-medium transition cursor-pointer"
                  >
                    <span>{t("Pick date & time…")}</span>
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </button>
                }
              >
                <form onSubmit={handleCustomSubmit} class="p-2 space-y-2">
                  <input
                    type="datetime-local"
                    min={minDateTime()}
                    value={customValue()}
                    onInput={(e) => setCustomValue(e.currentTarget.value)}
                    required
                    class="w-full px-2 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-transparent text-xs text-[#1A1B1E] dark:text-white focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                  />
                  <div class="flex justify-end gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCustom(false)}
                      class="px-2 py-1 rounded-md text-[#6E7075] hover:text-[#1A1B1E] dark:hover:text-white text-xs cursor-pointer"
                    >
                      {t("Cancel")}
                    </button>
                    <button
                      type="submit"
                      class="px-2.5 py-1 rounded-md bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold cursor-pointer"
                    >
                      {t("Save")}
                    </button>
                  </div>
                </form>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
