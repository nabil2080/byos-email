import { Component, Show, For, createSignal, createEffect } from "solid-js";

export type CalendarViewMode = "day" | "3days" | "week" | "month" | "year" | "agenda";

interface CalendarToolbarProps {
  viewMode: CalendarViewMode;
  onChangeViewMode: (mode: CalendarViewMode) => void;
  periodTitle: string;
  onToday: () => void;
  onPrev: () => void;
  onNext: () => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenMobileSidebar?: () => void;
  onSwitchToMail?: () => void;
  onOpenSettings?: () => void;
  isOnline?: boolean;
  offlineQueueCount?: number;
  onSyncOffline?: () => void;
  onPrint?: () => void;
  onOpenTrash?: () => void;
  onOpenShortcuts?: () => void;
  hideRedundantTopBarItems?: boolean;
}

export const CalendarToolbar: Component<CalendarToolbarProps> = (props) => {
  const isOffline = () => props.isOnline === false;
  const hasPendingSync = () => (props.offlineQueueCount || 0) > 0;

  const viewModes: CalendarViewMode[] = ["day", "week", "month", "year", "agenda"];
  const viewLabels: Record<CalendarViewMode, string> = {
    day: "Day",
    "3days": "3 Days",
    week: "Week",
    month: "Month",
    year: "Year",
    agenda: "Agenda",
  };

  return (
    <header
      class="hidden md:flex items-center justify-between gap-1.5 sm:gap-2 px-3 py-2 bg-white dark:bg-[#1E1F23] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex-shrink-0 select-none min-h-[48px]"
      data-testid="calendar-toolbar"
    >
      {/* ── LEFT: Navigation & Period Title ── */}
      <div class="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-shrink-0">
        <Show when={props.onSwitchToMail && !props.hideRedundantTopBarItems}>
          <button
            type="button"
            onClick={() => props.onSwitchToMail?.()}
            class="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
            data-testid="back-to-mail-btn"
            title="Switch back to Mail"
            aria-label="Switch back to Mail"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2] pointer-events-none" viewBox="0 0 24 24">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            <span class="hidden md:inline text-xs">Mail</span>
          </button>
        </Show>

        {/* Sidebar menu trigger for tablet and mobile (< lg) */}
        <button
          type="button"
          onClick={() => props.onOpenMobileSidebar?.()}
          class="lg:hidden p-1.5 rounded-lg text-[#6F7173] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
          aria-label="Open calendar sidebar"
          data-testid="calendar-sidebar-toggle-btn"
        >
          <svg class="w-5 h-5 stroke-current fill-none stroke-[2] pointer-events-none" viewBox="0 0 24 24">
            <line x1="3" y1="8" x2="21" y2="8" />
            <line x1="3" y1="16" x2="21" y2="16" />
          </svg>
        </button>

        {/* Today Button */}
        <button
          type="button"
          onClick={() => props.onToday()}
          class="h-9 min-h-[36px] px-3 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] text-xs sm:text-sm font-semibold text-[#3C3D3E] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer flex-shrink-0 focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
          data-testid="calendar-today-btn"
        >
          Today
        </button>

        {/* Chevrons */}
        <div class="flex items-center">
          <button
            type="button"
            onClick={() => props.onPrev()}
            class="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center border border-r-0 border-[#E2DFD8] dark:border-[#2A2D35] rounded-l-lg text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
            aria-label="Previous period"
            data-testid="calendar-prev-btn"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2] pointer-events-none" viewBox="0 0 24 24">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => props.onNext()}
            class="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center border border-[#E2DFD8] dark:border-[#2A2D35] rounded-r-lg text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
            aria-label="Next period"
            data-testid="calendar-next-btn"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2] pointer-events-none" viewBox="0 0 24 24">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Current Period Title */}
        <h2 class="text-sm sm:text-base font-bold text-[#3C3D3E] dark:text-[#ECEBE8] truncate max-w-[140px] sm:max-w-none ml-0.5">
          {props.periodTitle}
        </h2>
      </div>

      {/* ── RIGHT: Search + View Switcher + Action Icons ── */}
      <div class="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
        {/* Network / Offline Status Badge */}
        <Show when={!props.hideRedundantTopBarItems}>
        <div
          data-testid="calendar-network-status-badge"
          class={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-medium border ${
            isOffline()
              ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-400/30"
              : hasPendingSync()
              ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-400/30"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-400/30"
          }`}
          title={isOffline() ? "Offline - Changes queued locally" : hasPendingSync() ? "Syncing..." : "Online"}
        >
          <span
            class={`w-2 h-2 rounded-full ${
              isOffline()
                ? "bg-amber-400"
                : hasPendingSync()
                ? "bg-blue-400 animate-pulse"
                : "bg-emerald-400"
            }`}
          />
          <span class="text-xs font-semibold">
            {isOffline()
              ? `Offline${hasPendingSync() ? ` (${props.offlineQueueCount})` : ""}`
              : hasPendingSync()
              ? `Syncing (${props.offlineQueueCount})`
              : "Online"}
          </span>
          <Show when={hasPendingSync() && !isOffline()}>
            <button
              type="button"
              onClick={() => props.onSyncOffline?.()}
              class="underline hover:text-blue-600 text-xs ml-0.5 cursor-pointer"
              title="Sync queued changes"
            >
              Sync
            </button>
          </Show>
        </div>

        </Show>

        {/* Search Input */}
        <Show when={!props.hideRedundantTopBarItems}>
        <div class="relative hidden xl:block w-32 2xl:w-40">
          <input
            type="text"
            placeholder="Search…"
            value={props.searchQuery}
            onInput={(e) => props.onSearchChange(e.currentTarget.value)}
            class="w-full pl-7 pr-5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-sm text-[#3C3D3E] dark:text-[#ECEBE8] placeholder-[#6F7173] focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
            data-testid="calendar-search-input"
          />
          <svg
            class="w-3.5 h-3.5 stroke-[#6F7173] fill-none stroke-[2] absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <Show when={props.searchQuery}>
            <button
              type="button"
              onClick={() => props.onSearchChange("")}
              class="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] cursor-pointer"
              aria-label="Clear search"
            >
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2] pointer-events-none" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>

        </Show>

        {/* View Mode Segmented Control (Crisp, Stable Active Indicator without Glitchy Jumping) */}
        <div
          class="flex items-center p-0.5 rounded-xl bg-[#F0EEE9] dark:bg-[#2A2D35] border border-[#E2DFD8]/80 dark:border-[#2E3138] text-xs font-semibold gap-0.5"
          role="group"
          aria-label="Calendar view"
        >
          <For each={viewModes}>
            {(mode) => (
              <button
                type="button"
                onClick={() => props.onChangeViewMode(mode)}
                class={`h-9 min-h-[36px] px-3 rounded-lg text-xs sm:text-sm font-semibold flex items-center justify-center transition-all duration-150 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]/40 ${
                  props.viewMode === mode
                    ? "bg-white dark:bg-[#1E1F23] text-[#1A1B1E] dark:text-[#ECEBE8] font-bold shadow-2xs"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/5"
                }`}
                data-testid={`view-${mode}-btn`}
                aria-pressed={props.viewMode === mode}
              >
                {viewLabels[mode]}
              </button>
            )}
          </For>
        </div>

        {/* Action Icons Bar (Simplified: Bin/Trash and Calendar Settings only) */}
        <div class="flex items-center gap-0.5">
          {/* Deleted Events Trash */}
          <Show when={props.onOpenTrash}>
            <button
              type="button"
              onClick={() => props.onOpenTrash?.()}
              class="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
              aria-label="Deleted Events Trash"
              data-testid="calendar-trash-btn"
              title="Deleted Events (30-day Trash)"
            >
              <svg class="w-5 h-5 stroke-current fill-none stroke-[2] pointer-events-none" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </Show>

          {/* Calendar Settings */}
          <Show when={props.onOpenSettings}>
            <button
              type="button"
              onClick={() => props.onOpenSettings?.()}
              class="w-9 h-9 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]"
              aria-label="Open Calendar Settings"
              data-testid="calendar-settings-btn"
              title="Calendar Settings"
            >
              <svg class="w-5 h-5 stroke-current fill-none stroke-[2] pointer-events-none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          </Show>
        </div>
      </div>
    </header>
  );
};
