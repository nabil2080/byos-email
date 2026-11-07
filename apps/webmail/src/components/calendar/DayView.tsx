import { Component, For, Show, createMemo, onMount, onCleanup, createSignal } from "solid-js";
import { UserCalendar } from "../../api";
import { DecryptedEventRecord } from "./CalendarSidebar";
import { AlternateCalendarSystem, formatAlternateDate } from "../../utils/alternateCalendar";
import { formatZonedTime, getTimeZoneAbbr, zonedTimeToUtc } from "../../utils/calendarTimezones";
import { isTimeInWorkingHours, getEffectiveDailyWorkLocation } from "../../utils/calendarAvailability";
import { CalendarSettings, DEFAULT_CALENDAR_SETTINGS } from "./settings/calendarSettingsStore";
import { layoutDayTimedEvents } from "../../utils/calendarLayout";
import { detectCategory } from "./kashcalParser";
import { KashcalCategoryIcon } from "./KashcalCategoryIcon";

interface DayViewProps {
  currentDate: Date;
  calendars: UserCalendar[];
  events: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  onSlotClick: (start: Date, end: Date) => void;
  hourHeight?: number;
  timeFormat?: "12h" | "24h";
  workingHoursEnabled?: boolean;
  workingDays?: number[];
  workHoursStart?: string;
  workHoursEnd?: string;
  alternateCalendar?: AlternateCalendarSystem;
  primaryTimeZone?: string;
  showSecondaryTimeZone?: boolean;
  secondaryTimeZone?: string;
  secondaryTimeZoneLabel?: string;
  calendarSettings?: CalendarSettings;
  onPrev?: () => void;
  onNext?: () => void;
}

export const DayView: Component<DayViewProps> = (props) => {
  const hourHeight = () => props.hourHeight || 56;
  const [now, setNow] = createSignal(new Date());
  let timer: any = null;
  let scrollContainerRef: HTMLDivElement | undefined;
  let touchStartX = 0;
  let touchStartY = 0;

  const handleTouchStart = (e: TouchEvent) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: TouchEvent) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0) {
        props.onNext?.();
      } else {
        props.onPrev?.();
      }
    }
  };

  onMount(() => {
    timer = setInterval(() => setNow(new Date()), 60000);
    setTimeout(() => {
      if (scrollContainerRef) {
        const targetScroll = isCurrentDayToday()
          ? Math.max(0, nowTop() - 120)
          : 8 * hourHeight();
        scrollContainerRef.scrollTo({ top: targetScroll, behavior: "smooth" });
      }
    }, 150);
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  const hours = Array.from({ length: 24 }, (_, i) => i);

  function formatHour(h: number): string {
    if (h === 0) return "";
    if (props.timeFormat === "24h") {
      return `${String(h).padStart(2, "0")}:00`;
    }
    return h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
  }

  function formatSecondaryHour(h: number): string {
    if (h === 0) return "";
    const primaryTz = props.primaryTimeZone || "UTC";
    const secTz = props.secondaryTimeZone || "America/New_York";
    const curr = props.currentDate;
    const instant = zonedTimeToUtc(curr.getFullYear(), curr.getMonth() + 1, curr.getDate(), h, 0, primaryTz);
    return formatZonedTime(instant, secTz, props.timeFormat || "12h");
  }

  const primaryAbbr = createMemo(() => {
    return getTimeZoneAbbr(props.currentDate, props.primaryTimeZone || "UTC");
  });

  const secondaryAbbr = createMemo(() => {
    return props.secondaryTimeZoneLabel || getTimeZoneAbbr(props.currentDate, props.secondaryTimeZone || "America/New_York");
  });

  const effectiveSettings = createMemo<CalendarSettings>(() => {
    if (props.calendarSettings) return props.calendarSettings;
    return {
      ...DEFAULT_CALENDAR_SETTINGS,
      workingHoursEnabled: props.workingHoursEnabled ?? false,
      workingDays: props.workingDays ?? [1, 2, 3, 4, 5],
      workHoursStart: props.workHoursStart ?? "09:00",
      workHoursEnd: props.workHoursEnd ?? "17:00",
      primaryTimeZone: props.primaryTimeZone ?? "UTC",
      timeFormat: props.timeFormat ?? "12h",
    };
  });

  function isWorkingHour(day: Date, hour: number): boolean {
    const s = effectiveSettings();
    if (!s.workingHoursEnabled) return false;
    const instant = zonedTimeToUtc(
      day.getFullYear(),
      day.getMonth() + 1,
      day.getDate(),
      hour,
      0,
      props.primaryTimeZone || s.primaryTimeZone || "UTC"
    );
    return isTimeInWorkingHours(instant, s, props.primaryTimeZone || s.primaryTimeZone);
  }

  function isToday(d: Date): boolean {
    const n = now();
    return (
      d.getFullYear() === n.getFullYear() &&
      d.getMonth() === n.getMonth() &&
      d.getDate() === n.getDate()
    );
  }

  const isCurrentDayToday = createMemo(() => isToday(props.currentDate));

  const dayEvents = createMemo(() => {
    const curr = props.currentDate;
    const dayStart = new Date(curr.getFullYear(), curr.getMonth(), curr.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(curr.getFullYear(), curr.getMonth(), curr.getDate(), 23, 59, 59, 999);
    return props.events.filter((ev) => {
      return ev.startTime <= dayEnd && ev.endTime >= dayStart;
    });
  });

  const allDayEvents = createMemo(() => dayEvents().filter((ev) => ev.isAllDay));
  const timedEvents = createMemo(() => dayEvents().filter((ev) => !ev.isAllDay));

  const nowTop = createMemo(() => {
    const n = now();
    const minutes = n.getHours() * 60 + n.getMinutes();
    return (minutes / 60) * hourHeight();
  });

  return (
    <div
      class="flex flex-col flex-1 h-full min-h-0 bg-[#FAF9F5] dark:bg-[#18191D] select-none overflow-hidden [--calendar-surface-base:#ffffff] dark:[--calendar-surface-base:#1E1F23]"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* ── Day Header ── */}
      <div class="flex items-center justify-between px-6 py-3 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] flex-shrink-0">
        <div class="flex items-center gap-3">
          <div
            class={`w-10 h-10 flex items-center justify-center text-lg font-bold rounded-full ${
              isCurrentDayToday()
                ? "bg-[#9E725F] text-white"
                : "bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8]"
            }`}
          >
            {props.currentDate.getDate()}
          </div>
          <div class="flex flex-col">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                {props.currentDate.toLocaleDateString("en-US", { weekday: "long" })}
              </span>
              <Show when={props.alternateCalendar && props.alternateCalendar !== "none"}>
                {(() => {
                  const alt = formatAlternateDate(props.currentDate, props.alternateCalendar!);
                  if (!alt) return null;
                  return (
                    <span
                      class="px-2 py-0.5 rounded-md text-[11px] font-medium bg-[#EFECE6] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#A6A8AA]"
                      data-testid="day-alternate-date"
                      title={alt.fullText}
                    >
                      {alt.fullText}
                    </span>
                  );
                })()}
              </Show>
            </div>
            <span class="text-xs text-[#6F7173] dark:text-[#878A8E]">
              {props.currentDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </span>
          </div>
        </div>

        {/* Timezone & Location Badges */}
        <div class="flex items-center gap-2 text-xs">
          {(() => {
            const s = effectiveSettings();
            const loc = getEffectiveDailyWorkLocation(props.currentDate, s, props.primaryTimeZone || s.primaryTimeZone);
            if (!loc || loc === "unspecified" || loc === "office") return null;
            const label = loc.charAt(0).toUpperCase() + loc.slice(1);
            return (
              <span
                class="px-2 py-0.5 rounded-md bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#9E725F] dark:text-[#D4A38F] font-semibold text-[11px] flex items-center gap-1.5"
                data-testid="day-work-location"
                title={`Working location: ${label}`}
              >
                {loc === "home" ? (
                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                    <polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                ) : loc === "remote" ? (
                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                ) : (
                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                )}
                <span>{label}</span>
              </span>
            );
          })()}
          <Show when={props.showSecondaryTimeZone}>
            <span
              class="px-2 py-0.5 rounded-md bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#9E725F] dark:text-[#D4A38F] font-semibold text-[11px]"
              data-testid="day-secondary-tz-badge"
            >
              {secondaryAbbr()}: {props.secondaryTimeZone}
            </span>
          </Show>
          <span
            class="px-2 py-0.5 rounded-md bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] font-medium text-[11px]"
            data-testid="day-primary-tz-badge"
          >
            {primaryAbbr()}: {props.primaryTimeZone || "UTC"}
          </span>
        </div>
      </div>

      {/* ── All Day Row ── */}
      <Show when={allDayEvents().length > 0}>
        <div class="flex border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#F5F3EF] dark:bg-[#202126] p-2 gap-2 flex-shrink-0 text-xs">
          <span class={`text-[10px] text-[#6F7173] font-semibold ${props.showSecondaryTimeZone ? "w-28 sm:w-32" : "w-16 sm:w-20"} pt-1 shrink-0 text-center sm:text-right pr-2`}>All-day</span>
          <div class="flex flex-wrap gap-1.5 flex-1 min-w-0 max-h-28 sm:max-h-36 overflow-y-auto custom-scrollbar">
            <For each={allDayEvents()}>
              {(ev) => {
                const cal = props.calendars.find((c) => c.id === ev.calendarId);
                return (
                  <button
                    type="button"
                    data-testid="calendar-event-pill"
                    onClick={() => props.onSelectEvent(ev)}
                    class="max-w-full px-2.5 py-1 rounded-md text-xs font-semibold text-white shadow-2xs cursor-pointer hover:opacity-90 flex items-center gap-1.5 min-w-0 overflow-hidden"
                    style={{ "background-color": cal?.color || "#9E725F" }}
                  >
                    <Show when={ev.details.eventType === "out_of_office" || ev.status === "out_of_office"}>
                      <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-amber-500/40 text-white shrink-0" data-testid="ooo-event-badge">
                        OOO
                      </span>
                    </Show>
                    <Show when={ev.details.eventType === "focus_time"}>
                      <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-indigo-500/40 text-white shrink-0" data-testid="focus-time-badge">
                        Focus
                      </span>
                    </Show>
                    <Show when={ev.details.eventType === "working_location"}>
                      <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-emerald-500/40 text-white shrink-0" data-testid="working-location-badge">
                        Location
                      </span>
                    </Show>
                    <span class="truncate min-w-0" data-testid="calendar-event-item">
                      <span class="truncate" data-testid="calendar-allday-event">{ev.details.title}</span>
                    </span>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* ── Time Grid ── */}
      <div
        ref={scrollContainerRef}
        class="flex-1 min-h-0 overflow-y-auto relative flex bg-white dark:bg-[#18191D] custom-scrollbar"
      >
        {/* Time Labels Column (Single or Dual) */}
        <Show
          when={props.showSecondaryTimeZone}
          fallback={
            <div
              class="w-16 sm:w-20 flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] select-none relative z-10"
              style={{ height: `${24 * hourHeight()}px` }}
              data-testid="day-timeline-left-gutter"
            >
              <For each={hours}>
                {(h) => (
                  <div
                    class="pr-3 text-right text-xs font-medium text-[#6F7173] dark:text-[#878A8E] -translate-y-[9px] leading-none font-mono"
                    style={{ height: `${hourHeight()}px` }}
                  >
                    {h === 0 ? "" : formatHour(h)}
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div
            class="w-28 sm:w-32 flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] select-none grid grid-cols-2 divide-x divide-[#E2DFD8]/60 dark:divide-[#2A2D35]/60 relative z-10"
            style={{ height: `${24 * hourHeight()}px` }}
            data-testid="day-dual-timezone-gutter"
          >
            {/* Secondary Time Column */}
            <div class="bg-[#FAF9F5]/40 dark:bg-[#141518]/40">
              <For each={hours}>
                {(h) => (
                  <div
                    class="pr-2 text-right text-xs font-medium text-[#9E725F] dark:text-[#D4A38F] -translate-y-[9px] leading-none font-mono"
                    style={{ height: `${hourHeight()}px` }}
                    data-testid="day-secondary-hour"
                  >
                    {formatSecondaryHour(h)}
                  </div>
                )}
              </For>
            </div>
            {/* Primary Time Column */}
            <div>
              <For each={hours}>
                {(h) => (
                  <div
                    class="pr-2 text-right text-xs font-medium text-[#6F7173] dark:text-[#878A8E] -translate-y-[9px] leading-none font-mono"
                    style={{ height: `${hourHeight()}px` }}
                    data-testid="day-primary-hour"
                  >
                    {formatHour(h)}
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Day Column */}
        <div class="flex-1 relative" style={{ height: `${24 * hourHeight()}px` }}>
          {/* Horizontal lines */}
          <For each={hours}>
            {(h) => (
              <div
                class={`group/slot relative border-b border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 cursor-pointer transition-colors ${
                  isWorkingHour(props.currentDate, h)
                    ? "bg-white dark:bg-[#18191D] hover:bg-[#F3ECE8]/40 dark:hover:bg-[#2A2D35]/40"
                    : props.workingHoursEnabled
                    ? "bg-[#FAF9F5]/70 dark:bg-[#141518]/70 hover:bg-[#F3ECE8]/50 dark:hover:bg-[#2A2D35]/50"
                    : "hover:bg-[#F3ECE8]/30 dark:hover:bg-[#2A2D35]/30"
                }`}
                style={{ height: `${hourHeight()}px` }}
                onClick={() => {
                  const s = new Date(props.currentDate);
                  s.setHours(h, 0, 0, 0);
                  const e = new Date(props.currentDate);
                  e.setHours(h + 1, 0, 0, 0);
                  props.onSlotClick(s, e);
                }}
              >
                {/* Snappy Hover Affordance: subtle dashed highlight and floating + New Event indicator */}
                <div class="opacity-0 group-hover/slot:opacity-100 transition-opacity duration-150 absolute inset-x-1 inset-y-0.5 border border-dashed border-[#A27561]/50 rounded-lg pointer-events-none flex items-center justify-between px-3">
                  <span class="text-[11px] font-semibold text-[#A27561] flex items-center gap-1.5 bg-white/90 dark:bg-[#1E2025]/90 py-0.5 px-2 rounded-md shadow-2xs">
                    <svg class="w-3 h-3 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    <span>New Event</span>
                  </span>
                  <span class="text-[10px] font-mono text-[#878A8E] bg-white/90 dark:bg-[#1E2025]/90 py-0.5 px-1.5 rounded">
                    {formatHour(h)} - {formatHour(h + 1)}
                  </span>
                </div>
              </div>
            )}
          </For>

          {/* Current time line */}
          <Show when={isCurrentDayToday()}>
            <div
              class="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
              style={{ top: `${nowTop()}px` }}
            >
              <div class="relative flex items-center justify-center -ml-1.5">
                <span class="absolute w-3.5 h-3.5 rounded-full bg-[#B85D38]/30 animate-ping" />
                <span class="w-2.5 h-2.5 rounded-full bg-[#B85D38] shadow-xs" />
              </div>
              <div class="flex-1 h-[2px] bg-[#B85D38]" />
            </div>
          </Show>

          {/* Timed event blocks with side-by-side collision layout */}
          <For each={layoutDayTimedEvents(timedEvents(), hourHeight(), { isDayView: true })}>
            {(item) => {
              const ev = item.event;
              const cal = props.calendars.find((c) => c.id === ev.calendarId);
              const calColor = ev.details.color || cal?.color || "#9E725F";

              return (
                <button
                  type="button"
                  data-testid="calendar-event-pill"
                  title={`${ev.details.title} (${ev.startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${ev.endTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`}
                  onClick={() => props.onSelectEvent(ev)}
                  class="absolute p-2.5 rounded-xl text-left overflow-hidden shadow-2xs border border-[#E2DFD8] dark:border-[#2A2D35] border-l-4 transition-all hover:z-50 hover:scale-[1.01] hover:shadow-md cursor-pointer flex flex-col justify-between"
                  style={{
                    top: `${item.top}px`,
                    height: `${item.height}px`,
                    left: `calc(${item.leftPercent}% + 4px)`,
                    width: `calc(${item.widthPercent}% - 8px)`,
                    "min-width": "64px",
                    "z-index": item.zIndex || 10,
                    "border-left-color": calColor,
                    "background-color": `color-mix(in srgb, ${calColor} 14%, var(--calendar-surface-base, #ffffff))`,
                  }}
                >
                  <div>
                    <div class="flex items-center gap-1.5 min-w-0">
                      {/* KashCal Category Stroke SVG Icon */}
                      <KashcalCategoryIcon
                        category={detectCategory(ev.details.title)}
                        class="w-3.5 h-3.5 shrink-0 stroke-current fill-none stroke-[2]"
                        style={{ color: calColor }}
                      />
                      <Show when={ev.details.visibility === "private" || ev.details.visibility === "confidential"}>
                        <svg class="w-3 h-3 shrink-0 stroke-current fill-none stroke-[2.5]" style={{ color: calColor }} viewBox="0 0 24 24">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </Show>
                      <Show when={ev.details.attachments && ev.details.attachments.length > 0}>
                        <svg class="w-3 h-3 shrink-0 stroke-current fill-none stroke-[2]" style={{ color: calColor }} viewBox="0 0 24 24">
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                      </Show>
                      <Show when={ev.rrule || ev.isOccurrence}>
                        <span title="Recurring event" class="inline-flex shrink-0">
                          <svg class="w-3 h-3 shrink-0 stroke-current fill-none stroke-[2.2]" style={{ color: calColor }} viewBox="0 0 24 24" data-testid="recurring-event-icon">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                          </svg>
                        </span>
                      </Show>
                      <Show when={ev.isException}>
                        <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0" data-testid="exception-event-badge" title="Modified occurrence">
                          *
                        </span>
                      </Show>
                      <Show when={ev.details.eventType === "out_of_office" || ev.status === "out_of_office"}>
                        <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-amber-500/30 text-amber-700 dark:text-amber-300 shrink-0" data-testid="ooo-event-badge">
                          OOO
                        </span>
                      </Show>
                      <Show when={ev.details.eventType === "focus_time"}>
                        <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-indigo-500/30 text-indigo-700 dark:text-indigo-300 shrink-0" data-testid="focus-time-badge">
                          Focus
                        </span>
                      </Show>
                      <Show when={ev.details.eventType === "working_location"}>
                        <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 shrink-0" data-testid="working-location-badge">
                          Location
                        </span>
                      </Show>
                      <h4 class="text-xs font-bold leading-tight truncate" style={{ color: calColor }} data-testid="calendar-event-item">
                        <span data-testid="calendar-timed-event">{ev.details.title}</span>
                      </h4>
                    </div>
                    <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E] mt-0.5">
                      {ev.startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      {" - "}
                      {ev.endTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </p>
                  </div>
                  <Show when={ev.details.location}>
                    <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] truncate flex items-center gap-1">
                      <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span class="truncate">{ev.details.location}</span>
                    </p>
                  </Show>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};
