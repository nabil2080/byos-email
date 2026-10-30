import { Component, createSignal, Show } from "solid-js";
import { Mailbox, UserMe } from "../../api";
import { createCalendarSettings } from "../../components/calendar/settings/calendarSettingsStore";

interface CalendarTabProps {
  mailbox: Mailbox;
  currentUser?: UserMe | null;
  onSwitchToCalendar?: () => void;
}

export const CalendarTab: Component<CalendarTabProps> = (props) => {
  const [showResetConfirm, setShowResetConfirm] = createSignal(false);
  const [resetSuccessMessage, setResetSuccessMessage] = createSignal<string | null>(null);

  const calSettings = createCalendarSettings(() => props.mailbox.id);

  const handleConfirmReset = async () => {
    await calSettings.resetToDefaults();
    setShowResetConfirm(false);
    setResetSuccessMessage("Calendar preferences restored to system defaults.");
    setTimeout(() => setResetSuccessMessage(null), 4000);
  };

  return (
    <div
      class="h-full flex flex-col min-h-0 bg-white dark:bg-[#1E1F23] rounded-2xl overflow-hidden border border-[#E2DFD8] dark:border-[#2A2D35] shadow-2xs"
      data-testid="settings-calendar-tab-content"
    >
      {/* Informational Hero: Calendar Settings Location Notice */}
      <div class="p-8 sm:p-10 flex flex-col items-center justify-center text-center my-auto">
        <div class="w-16 h-16 rounded-2xl bg-[#F3ECE8] dark:bg-[#2D2522] border border-[#9E725F]/20 flex items-center justify-center text-[#9E725F] dark:text-[#D4A38F] mb-5 shadow-2xs">
          <svg class="w-8 h-8 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>

        <h3 class="text-base sm:text-lg font-bold text-[#1A1B1E] dark:text-[#ECEBE8] tracking-tight mb-2">
          Calendar settings are configured in the Calendar tab
        </h3>

        <p class="text-xs sm:text-sm text-[#6F7173] dark:text-[#878A8E] max-w-md leading-relaxed mb-6">
          To configure your calendar view options, working hours, event reminders, time zones, and holiday subscriptions, open the Calendar workspace and click the settings gear icon in the toolbar.
        </p>

        <Show when={props.onSwitchToCalendar}>
          <button
            type="button"
            onClick={props.onSwitchToCalendar}
            data-testid="calendar-settings-go-to-calendar-btn"
            class="px-5 py-2.5 rounded-xl bg-[#9E725F] hover:bg-[#8F6452] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer flex items-center gap-2"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>Open Calendar Workspace</span>
          </button>
        </Show>

        <Show when={resetSuccessMessage()}>
          <div class="mt-4 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
            {resetSuccessMessage()}
          </div>
        </Show>
      </div>

      {/* Advanced Maintenance: Reset Calendar Configuration */}
      <div class="border-t border-[#E2DFD8] dark:border-[#2A2D35] px-6 py-4 bg-[#F8F7F4] dark:bg-[#18191D]/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 flex-shrink-0">
        <div>
          <h4 class="text-xs font-semibold text-[#1A1B1E] dark:text-[#ECEBE8]">
            Calendar Preferences Maintenance
          </h4>
          <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
            Reset view defaults, week start, and time format preferences for mailbox <span class="font-mono text-[#1A1B1E] dark:text-[#ECEBE8]">{props.mailbox.local_part}</span>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowResetConfirm(true)}
          data-testid="calendar-settings-reset-btn"
          class="px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900/50 transition-colors cursor-pointer flex-shrink-0"
        >
          Reset to defaults
        </button>
      </div>

      {/* Reset Confirmation Modal */}
      <Show when={showResetConfirm()}>
        <div
          class="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4"
          data-testid="calendar-settings-reset-confirm"
        >
          <div class="bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] p-6 max-w-sm w-full shadow-xl">
            <h4 class="text-sm font-bold text-[#1A1B1E] dark:text-[#ECEBE8] mb-2">
              Reset calendar settings to defaults?
            </h4>
            <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mb-5 leading-relaxed">
              This will restore all calendar options to their default values (e.g. week view, Sunday week start, 12h time format).
            </p>
            <div class="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                data-testid="calendar-settings-cancel-reset-btn"
                class="px-3.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] text-xs font-medium text-[#6F7173] dark:text-[#878A8E] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReset}
                data-testid="calendar-settings-confirm-reset-btn"
                class="px-3.5 py-1.5 rounded-xl bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors cursor-pointer shadow-xs"
              >
                Reset to defaults
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
