import { Component, For, Show, createSignal, createEffect, onCleanup } from "solid-js";
import {
  ActiveCalendarReminderAlert,
  formatRelativeReminderTime,
} from "../../utils/calendarNotifications";

export interface CalendarNotificationBannerProps {
  alerts: ActiveCalendarReminderAlert[];
  defaultSnoozeMinutes?: number;
  autoDismissMs?: number;
  onDismiss: (alertId: string) => void;
  onSnooze: (alertId: string, minutes: number) => void;
  onSelectEvent?: (eventId: string) => void;
}

interface ToastItemProps {
  alert: ActiveCalendarReminderAlert;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onDismiss: (alertId: string) => void;
  onSnooze: (alertId: string, minutes: number) => void;
  onSelectEvent?: (eventId: string) => void;
  autoDismissMs?: number;
}

const CalendarReminderToastItem: Component<ToastItemProps> = (props) => {
  const [isHovered, setIsHovered] = createSignal(false);
  const autoDismissDelay = () => props.autoDismissMs ?? 6000;

  createEffect(() => {
    // If the snooze menu is open or mouse is hovered over the toast, pause auto-dismiss
    if (props.isMenuOpen || isHovered()) {
      return;
    }

    const timer = setTimeout(() => {
      props.onDismiss(props.alert.alertId);
    }, autoDismissDelay());

    onCleanup(() => clearTimeout(timer));
  });

  return (
    <div
      class="pointer-events-auto p-3.5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg text-[#2B2C2D] dark:text-[#ECEBE8] animate-in fade-in slide-in-from-bottom-2 duration-200 transition-all overflow-hidden"
      data-testid="calendar-reminder-toast"
      data-alert-id={props.alert.alertId}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div class="flex items-start gap-3">
        {/* Bell Icon Badge */}
        <div class="w-8 h-8 rounded-xl bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796] flex items-center justify-center shrink-0">
          <svg class="w-4 h-4 fill-none stroke-current stroke-2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
          </svg>
        </div>

        {/* Content */}
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-1">
            <span class="text-[10px] font-bold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796]">
              {formatRelativeReminderTime(props.alert.startTime)}
            </span>
            <button
              type="button"
              onClick={() => props.onDismiss(props.alert.alertId)}
              class="text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] p-0.5 rounded cursor-pointer"
              title="Dismiss"
              data-testid="reminder-dismiss-btn"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <h4
            class={`text-xs font-bold leading-snug truncate mt-0.5 ${
              props.onSelectEvent ? "cursor-pointer hover:underline" : ""
            }`}
            onClick={() => props.onSelectEvent && props.onSelectEvent(props.alert.eventId)}
            data-testid="reminder-title"
          >
            {props.alert.title}
          </h4>

          <Show when={props.alert.location}>
            <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E] truncate mt-0.5 flex items-center gap-1">
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span class="truncate">{props.alert.location}</span>
            </p>
          </Show>

          {/* Actions */}
          <div class="flex items-center gap-2 mt-2 pt-2 border-t border-[#F0EEE9] dark:border-[#2A2D35]">
            {/* Snooze Dropdown/Button */}
            <div class="relative">
              <button
                type="button"
                onClick={props.onToggleMenu}
                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#F0EEE9] dark:bg-[#2A2D35] hover:bg-[#E2DFD8] dark:hover:bg-[#343842] text-[#2B2C2D] dark:text-[#ECEBE8] flex items-center gap-1 cursor-pointer transition-colors"
                data-testid="reminder-snooze-btn"
              >
                <span>Snooze</span>
                <svg class="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              <Show when={props.isMenuOpen}>
                <div
                  class="absolute left-0 bottom-full mb-1 w-32 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg py-1 z-70 animate-in fade-in duration-100"
                  data-testid="reminder-snooze-menu"
                >
                  <button
                    type="button"
                    onClick={() => {
                      props.onSnooze(props.alert.alertId, 5);
                      props.onCloseMenu();
                    }}
                    class="w-full text-left px-3 py-1.5 text-xs text-[#2B2C2D] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] cursor-pointer"
                    data-testid="snooze-option-5m"
                  >
                    5 minutes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onSnooze(props.alert.alertId, 10);
                      props.onCloseMenu();
                    }}
                    class="w-full text-left px-3 py-1.5 text-xs text-[#2B2C2D] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] cursor-pointer"
                    data-testid="snooze-option-10m"
                  >
                    10 minutes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      props.onSnooze(props.alert.alertId, 15);
                      props.onCloseMenu();
                    }}
                    class="w-full text-left px-3 py-1.5 text-xs text-[#2B2C2D] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] cursor-pointer"
                    data-testid="snooze-option-15m"
                  >
                    15 minutes
                  </button>
                </div>
              </Show>
            </div>

            <Show when={props.onSelectEvent}>
              <button
                type="button"
                onClick={() => props.onSelectEvent!(props.alert.eventId)}
                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[#9E725F] text-white hover:bg-[#865F4F] transition-colors cursor-pointer"
                data-testid="reminder-view-event-btn"
              >
                View
              </button>
            </Show>

            <button
              type="button"
              onClick={() => props.onDismiss(props.alert.alertId)}
              class="ml-auto text-[11px] text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const CalendarNotificationBanner: Component<CalendarNotificationBannerProps> = (props) => {
  const [snoozeMenuOpenId, setSnoozeMenuOpenId] = createSignal<string | null>(null);

  return (
    <Show when={props.alerts && props.alerts.length > 0}>
      <div
        class="fixed bottom-4 right-4 z-40 max-w-sm w-full space-y-2 pointer-events-none px-2 sm:px-0 overflow-visible"
        role="alert"
        aria-live="assertive"
        data-testid="calendar-reminder-container"
      >
        <For each={props.alerts.slice(0, 3)}>
          {(alert) => (
            <CalendarReminderToastItem
              alert={alert}
              isMenuOpen={snoozeMenuOpenId() === alert.alertId}
              onToggleMenu={() =>
                setSnoozeMenuOpenId(snoozeMenuOpenId() === alert.alertId ? null : alert.alertId)
              }
              onCloseMenu={() => setSnoozeMenuOpenId(null)}
              onDismiss={props.onDismiss}
              onSnooze={props.onSnooze}
              onSelectEvent={props.onSelectEvent}
              autoDismissMs={props.autoDismissMs}
            />
          )}
        </For>
      </div>
    </Show>
  );
};
