import { Component, For, Show, createMemo, onMount, onCleanup, createSignal } from "solid-js";
import { UserCalendar } from "../../api";
import { DecryptedEventRecord } from "./CalendarSidebar";
import { AlternateCalendarSystem, formatAlternateDate } from "../../utils/alternateCalendar";
import { formatZonedTime, getTimeZoneAbbr, zonedTimeToUtc } from "../../utils/calendarTimezones";
import { isTimeInWorkingHours, getEffectiveDailyWorkLocation } from "../../utils/calendarAvailability";
import { CalendarSettings, DEFAULT_CALENDAR_SETTINGS } from "./settings/calendarSettingsStore";
import { TaskItem } from "./tasks/taskTypes";
import { getTasksForDate, isTaskOverdue } from "./tasks/taskStore";
import { layoutDayTimedEvents } from "../../utils/calendarLayout";

interface WeekViewProps {
  currentDate: Date;
  calendars: UserCalendar[];
  events: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  onSlotClick: (start: Date, end: Date) => void;
  timeFormat?: "12h" | "24h";
  weekStart?: "sunday" | "monday" | "saturday";
  showWeekends?: boolean;
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
  tasks?: TaskItem[];
  showTasks?: boolean;
  onToggleTaskComplete?: (taskId: string) => void;
  onSelectTask?: (task: TaskItem) => void;
}

const HOUR_HEIGHT = 50; // px per hour

export const WeekView: Component<WeekViewProps> = (props) => {
  // Current time marker update
  const [now, setNow] = createSignal(new Date());
  let timer: any = null;

  onMount(() => {
    timer = setInterval(() => setNow(new Date()), 60000); // update every minute
  });
  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  // Calculate days of the week starting from weekStart setting of currentDate
  const weekDays = createMemo(() => {
    const curr = props.currentDate;
    const startOfWeek = new Date(curr);
    const startPref = props.weekStart || "sunday";
    let dayOffset = curr.getDay(); // 0 is Sunday
    if (startPref === "monday") {
      dayOffset = (curr.getDay() + 6) % 7;
    } else if (startPref === "saturday") {
      dayOffset = (curr.getDay() + 1) % 7;
    }
    startOfWeek.setDate(curr.getDate() - dayOffset);
    startOfWeek.setHours(0, 0, 0, 0);

    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      if (props.showWeekends === false) {
        if (d.getDay() === 0 || d.getDay() === 6) {
          continue;
        }
      }
      days.push(d);
    }
    return days;
  });

  const hasWeekTasks = createMemo(() => {
    if (props.showTasks === false || !props.tasks || props.tasks.length === 0) return false;
    return weekDays().some((day) => getTasksForDate(props.tasks || [], day, props.primaryTimeZone || "UTC").length > 0);
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

  // All-day events vs timed events
  const allDayEvents = createMemo(() => {
    return props.events.filter((ev) => ev.isAllDay);
  });

  const timedEvents = createMemo(() => {
    return props.events.filter((ev) => !ev.isAllDay);
  });

  // Position calculation for current time line
  const nowTop = createMemo(() => {
    const n = now();
    const minutes = n.getHours() * 60 + n.getMinutes();
    return (minutes / 60) * HOUR_HEIGHT;
  });

  // Drag-to-create state
  const [dragStart, setDragStart] = createSignal<{ day: Date; hour: number; minute: number } | null>(null);
  const [dragCurrent, setDragCurrent] = createSignal<{ hour: number; minute: number } | null>(null);

  function handleSlotMouseDown(day: Date, hour: number, e: MouseEvent) {
    if (e.button !== 0) return; // primary click only
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const minute = clickY > 25 ? 30 : 0;
    setDragStart({ day, hour, minute });
    setDragCurrent({ hour, minute: minute + 30 });
  }

  function handleSlotMouseMove(hour: number, e: MouseEvent) {
    if (!dragStart()) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const minute = clickY > 25 ? 30 : 0;
    setDragCurrent({ hour, minute: minute + 30 });
  }

  function handleSlotMouseUp() {
    const start = dragStart();
    const curr = dragCurrent();
    if (!start || !curr) {
      setDragStart(null);
      setDragCurrent(null);
      return;
    }

    const startDate = new Date(start.day);
    startDate.setHours(start.hour, start.minute, 0, 0);

    const endDate = new Date(start.day);
    let endHour = curr.hour;
    let endMin = curr.minute;
    if (endHour < start.hour || (endHour === start.hour && endMin <= start.minute)) {
      endHour = start.hour;
      endMin = start.minute + 60;
    }
    endDate.setHours(endHour, endMin, 0, 0);

    setDragStart(null);
    setDragCurrent(null);
    props.onSlotClick(startDate, endDate);
  }

  return (
    <div
      class="flex flex-col flex-1 h-full min-h-0 bg-[#FAF9F5] dark:bg-[#18191D] select-none overflow-hidden [--calendar-surface-base:#ffffff] dark:[--calendar-surface-base:#1E1F23]"
      onMouseUp={handleSlotMouseUp}
    >
      {/* ── Days Header ── */}
      <div class="flex border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] flex-shrink-0 pr-3">
        {/* Time column offset */}
        <Show
          when={props.showSecondaryTimeZone}
          fallback={
            <div
              class="w-14 sm:w-16 flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-center text-[10px] text-[#6F7173] font-medium"
              data-testid="week-primary-tz-header"
            >
              {primaryAbbr()}
            </div>
          }
        >
          <div
            class="w-24 sm:w-28 flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] grid grid-cols-2 text-[10px] text-[#6F7173] font-medium divide-x divide-[#E2DFD8] dark:divide-[#2A2D35]"
            data-testid="week-dual-timezone-header"
          >
            <div class="flex items-center justify-center text-[#9E725F] dark:text-[#D4A38F] font-bold truncate px-0.5" title={props.secondaryTimeZone || "Secondary"}>
              {secondaryAbbr()}
            </div>
            <div class="flex items-center justify-center font-semibold truncate px-0.5" title={props.primaryTimeZone || "Primary"}>
              {primaryAbbr()}
            </div>
          </div>
        </Show>

        {/* Day Headers */}
        <div class="grid flex-1" style={{ "grid-template-columns": `repeat(${weekDays().length}, minmax(0, 1fr))` }}>
          <For each={weekDays()}>
            {(day) => {
              const today = isToday(day);
              return (
                <div class="flex flex-col items-center justify-center py-2 border-r border-[#E2DFD8] dark:border-[#2A2D35] last:border-r-0">
                  <span
                    class={`text-[11px] font-semibold tracking-wider uppercase ${
                      today ? "text-[#9E725F] dark:text-[#D4A38F]" : "text-[#6F7173] dark:text-[#878A8E]"
                    }`}
                  >
                    {day.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <div
                    class={`w-7 h-7 flex items-center justify-center text-sm font-bold rounded-full mt-0.5 ${
                      today
                        ? "bg-[#9E725F] text-white"
                        : "text-[#2B2C2D] dark:text-[#ECEBE8]"
                    }`}
                  >
                    {day.getDate()}
                  </div>
                  <Show when={props.alternateCalendar && props.alternateCalendar !== "none"}>
                    {(() => {
                      const alt = formatAlternateDate(day, props.alternateCalendar!);
                      if (!alt) return null;
                      return (
                        <span
                          class="text-[10px] font-medium text-[#6F7173] dark:text-[#878A8E] mt-0.5 tracking-tight truncate max-w-[80px]"
                          title={alt.fullText}
                          data-testid="week-alternate-date"
                        >
                          {alt.badge}
                        </span>
                      );
                    })()}
                  </Show>
                  {(() => {
                    const s = effectiveSettings();
                    const loc = getEffectiveDailyWorkLocation(day, s, props.primaryTimeZone || s.primaryTimeZone);
                    if (!loc || loc === "unspecified") return null;
                    const label = loc.charAt(0).toUpperCase() + loc.slice(1);
                    return (
                      <span
                        class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[#FAF9F5] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#9E725F] dark:text-[#D4A38F] mt-1 flex items-center gap-1 max-w-[85px] truncate"
                        title={`Working location: ${label}`}
                        data-testid="day-work-location"
                      >
                        {loc === "office" ? (
                          <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                            <path d="M3 21h18M9 8h1M9 12h1M9 16h1M14 8h1M14 12h1M14 16h1M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
                          </svg>
                        ) : loc === "home" ? (
                          <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                            <polyline points="9 22 9 12 15 12 15 22" />
                          </svg>
                        ) : loc === "remote" ? (
                          <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                            <line x1="8" y1="21" x2="16" y2="21" />
                            <line x1="12" y1="17" x2="12" y2="21" />
                          </svg>
                        ) : (
                          <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                        )}
                        <span class="truncate">{label}</span>
                      </span>
                    );
                  })()}
                </div>
              );
            }}
          </For>
        </div>
      </div>

      {/* ── All-Day Row (if any) ── */}
      <Show when={allDayEvents().length > 0}>
        <div class="flex border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#F5F3EF] dark:bg-[#202126] flex-shrink-0 text-xs">
          <div class={`${props.showSecondaryTimeZone ? "w-24 sm:w-28" : "w-14 sm:w-16"} flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] p-1.5 text-[10px] text-[#6F7173] font-semibold`}>
            All-day
          </div>
          <div class="grid flex-1 p-1 gap-1" style={{ "grid-template-columns": `repeat(${weekDays().length}, minmax(0, 1fr))` }}>
            <For each={weekDays()}>
              {(day) => {
                const dayAllDay = allDayEvents().filter(
                  (ev) =>
                    ev.startTime.getFullYear() === day.getFullYear() &&
                    ev.startTime.getMonth() === day.getMonth() &&
                    ev.startTime.getDate() === day.getDate()
                );
                return (
                  <div class="flex flex-col gap-1 min-h-[24px]">
                    <For each={dayAllDay}>
                      {(ev) => {
                        const cal = props.calendars.find((c) => c.id === ev.calendarId);
                        const eventColor = ev.details.color || cal?.color || "#9E725F";
                        const isDeclined = ev.status === "declined" || ev.status === "cancelled" || ev.details.status === "declined";
                        return (
                          <button
                            type="button"
                            data-testid="calendar-event-pill"
                            data-is-declined={isDeclined ? "true" : "false"}
                            onClick={() => props.onSelectEvent(ev)}
                            class={`px-1.5 py-0.5 rounded text-[11px] font-medium truncate text-left text-white shadow-2xs cursor-pointer hover:opacity-90 flex items-center gap-1 ${
                              isDeclined ? "line-through opacity-50 italic" : ""
                            }`}
                            style={{ "background-color": eventColor }}
                          >
                            <Show when={ev.details.visibility === "private" || ev.details.visibility === "confidential"}>
                              <svg class="w-2.5 h-2.5 shrink-0 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            </Show>
                            <Show when={ev.rrule || ev.isOccurrence}>
                              <svg class="w-2.5 h-2.5 shrink-0 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24" data-testid="recurring-event-icon" title="Recurring event">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                              </svg>
                            </Show>
                            <Show when={ev.isException}>
                              <span class="inline-block px-1 py-0.2 text-[8px] font-bold rounded bg-amber-500/30 text-white shrink-0" data-testid="exception-event-badge" title="Modified occurrence">
                                *
                              </span>
                            </Show>
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
                            <span class="truncate">{ev.details.title}</span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* ── Tasks Row (Category 11) ── */}
      <Show when={hasWeekTasks()}>
        <div class="flex border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] flex-shrink-0 text-xs">
          <div class={`${props.showSecondaryTimeZone ? "w-24 sm:w-28" : "w-14 sm:w-16"} flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] p-1.5 text-[10px] text-[#6F7173] font-semibold flex items-center justify-between`}>
            <span>Tasks</span>
          </div>
          <div class="grid flex-1 p-1 gap-1" style={{ "grid-template-columns": `repeat(${weekDays().length}, minmax(0, 1fr))` }}>
            <For each={weekDays()}>
              {(day) => {
                const dayTasks = () => getTasksForDate(props.tasks || [], day, props.primaryTimeZone || "UTC");
                return (
                  <div class="flex flex-col gap-1 min-h-[22px]">
                    <For each={dayTasks()}>
                      {(task) => {
                        const overdue = () => isTaskOverdue(task, new Date(), props.primaryTimeZone || "UTC");
                        return (
                          <div
                            class={`group flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium border border-[#E2DFD8] dark:border-[#2A2D35] transition-all cursor-pointer ${
                              task.completed
                                ? "bg-neutral-100 dark:bg-neutral-900 text-[#6F7173] opacity-60"
                                : overdue()
                                ? "bg-red-50 dark:bg-red-950/20 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
                                : "bg-white dark:bg-[#1E1F23] hover:border-[#9E725F] text-[#2B2C2D] dark:text-[#ECEBE8]"
                            }`}
                            data-testid="calendar-task-item"
                          >
                            <input
                              type="checkbox"
                              checked={task.completed}
                              onChange={(e) => {
                                e.stopPropagation();
                                props.onToggleTaskComplete?.(task.id);
                              }}
                              class="w-3 h-3 rounded text-[#9E725F] focus:ring-[#9E725F] cursor-pointer"
                              data-testid="calendar-task-checkbox"
                              title={task.completed ? "Reopen task" : "Mark as completed"}
                            />
                            <span
                              class={`truncate flex-1 ${task.completed ? "line-through text-[#6F7173]" : ""}`}
                              onClick={() => props.onSelectTask?.(task)}
                            >
                              {task.title}
                            </span>
                            <Show when={overdue()}>
                              <span class="text-[9px] font-bold text-red-600 dark:text-red-400" data-testid="task-overdue-badge">!</span>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* ── Scrollable 24-Hour Time Grid ── */}
      <div class="flex-1 overflow-y-auto overflow-x-hidden relative flex">
        {/* Left Time Column (Single or Dual) */}
        <Show
          when={props.showSecondaryTimeZone}
          fallback={
            <div class="w-14 sm:w-16 flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] select-none">
              <For each={hours}>
                {(h) => (
                  <div
                    class="h-[50px] pr-2 text-right text-[10px] font-medium text-[#6F7173] dark:text-[#878A8E] -translate-y-2"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                  >
                    {formatHour(h)}
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div
            class="w-24 sm:w-28 flex-shrink-0 border-r border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] select-none grid grid-cols-2 divide-x divide-[#E2DFD8]/60 dark:divide-[#2A2D35]/60"
            data-testid="week-dual-timezone-gutter"
          >
            {/* Secondary Time Column */}
            <div class="bg-[#FAF9F5]/40 dark:bg-[#141518]/40">
              <For each={hours}>
                {(h) => (
                  <div
                    class="h-[50px] pr-1.5 text-right text-[10px] font-medium text-[#9E725F] dark:text-[#D4A38F] -translate-y-2 font-mono"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                    data-testid="week-secondary-hour"
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
                    class="h-[50px] pr-1.5 text-right text-[10px] font-medium text-[#6F7173] dark:text-[#878A8E] -translate-y-2 font-mono"
                    style={{ height: `${HOUR_HEIGHT}px` }}
                    data-testid="week-primary-hour"
                  >
                    {formatHour(h)}
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Columns for the days */}
        <div class="grid flex-1 relative bg-white dark:bg-[#18191D]" style={{ "grid-template-columns": `repeat(${weekDays().length}, minmax(0, 1fr))` }}>
          {/* Horizontal Hour Lines Background */}
          <div class="absolute inset-0 pointer-events-none">
            <For each={hours}>
              {() => (
                <div
                  class="border-b border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 w-full"
                  style={{ height: `${HOUR_HEIGHT}px` }}
                />
              )}
            </For>
          </div>

          {/* Each day column */}
          <For each={weekDays()}>
            {(day) => {
              const today = isToday(day);

              // Filter events belonging to this day
              const dayEvents = () =>
                timedEvents().filter((ev) => {
                  const s = ev.startTime;
                  return (
                    s.getFullYear() === day.getFullYear() &&
                    s.getMonth() === day.getMonth() &&
                    s.getDate() === day.getDate()
                  );
                });

              return (
                <div class="relative border-r border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 last:border-r-0 h-[1200px]">
                  {/* Current Time Line on Today */}
                  <Show when={today}>
                    <div
                      class="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                      style={{ top: `${nowTop()}px` }}
                    >
                      <div class="w-2.5 h-2.5 rounded-full bg-[#B85D38] -ml-1.5 shadow-sm animate-pulse" />
                      <div class="flex-1 h-[2px] bg-[#B85D38]" />
                    </div>
                  </Show>

                  {/* Empty click/drag hour slots */}
                  <For each={hours}>
                    {(h) => (
                      <div
                        class={`h-[50px] cursor-pointer transition-colors ${
                          isWorkingHour(day, h)
                            ? "bg-white dark:bg-[#18191D] hover:bg-[#F0EEE9]/40 dark:hover:bg-[#2A2D35]/40"
                            : props.workingHoursEnabled
                            ? "bg-[#FAF9F5]/70 dark:bg-[#141518]/70 hover:bg-[#F0EEE9]/50 dark:hover:bg-[#2A2D35]/50"
                            : "hover:bg-[#F0EEE9]/30 dark:hover:bg-[#2A2D35]/30"
                        }`}
                        style={{ height: `${HOUR_HEIGHT}px` }}
                        onMouseDown={(e) => handleSlotMouseDown(day, h, e)}
                        onMouseMove={(e) => handleSlotMouseMove(h, e)}
                        onClick={() => {
                          const s = new Date(day);
                          s.setHours(h, 0, 0, 0);
                          const e = new Date(day);
                          e.setHours(h + 1, 0, 0, 0);
                          props.onSlotClick(s, e);
                        }}
                      />
                    )}
                  </For>

                  {/* Render timed events in this day with side-by-side collision layout */}
                  <For each={layoutDayTimedEvents(dayEvents(), HOUR_HEIGHT, { isDayView: false })}>
                    {(item) => {
                      const ev = item.event;
                      const cal = props.calendars.find((c) => c.id === ev.calendarId);
                      const calColor = ev.details.color || cal?.color || "#9E725F";
                      const isDeclined = ev.status === "declined" || ev.status === "cancelled" || ev.details.status === "declined";

                      return (
                        <button
                          type="button"
                          data-testid="calendar-event-pill"
                          data-is-declined={isDeclined ? "true" : "false"}
                          title={`${ev.details.title} (${ev.startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - ${ev.endTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onSelectEvent(ev);
                          }}
                          class={`absolute p-1 sm:p-1.5 rounded-lg text-left overflow-hidden shadow-2xs border border-[#E2DFD8] dark:border-[#2A2D35] border-l-[3.5px] transition-all hover:z-50 hover:scale-[1.02] hover:shadow-md cursor-pointer ${
                            isDeclined ? "line-through opacity-50 italic" : ""
                          }`}
                          style={{
                            top: `${item.top}px`,
                            height: `${item.height}px`,
                            left: `calc(${item.leftPercent}% + 2px)`,
                            width: `calc(${item.widthPercent}% - 4px)`,
                            "min-width": "44px",
                            "z-index": item.zIndex || 10,
                            "border-left-color": calColor,
                            "background-color": `color-mix(in srgb, ${calColor} 14%, var(--calendar-surface-base, #ffffff))`,
                          }}
                        >
                          <div class="flex items-center gap-1 min-w-0">
                            <Show when={ev.details.visibility === "private" || ev.details.visibility === "confidential"}>
                              <svg class="w-2.5 h-2.5 shrink-0 stroke-current fill-none stroke-[2.5]" style={{ color: calColor }} viewBox="0 0 24 24">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            </Show>
                            <Show when={ev.details.attachments && ev.details.attachments.length > 0}>
                              <svg class="w-2.5 h-2.5 shrink-0 stroke-current fill-none stroke-[2]" style={{ color: calColor }} viewBox="0 0 24 24">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                              </svg>
                            </Show>
                            <Show when={ev.rrule || ev.isOccurrence}>
                              <svg class="w-2.5 h-2.5 shrink-0 stroke-current fill-none stroke-[2.2]" style={{ color: calColor }} viewBox="0 0 24 24" data-testid="recurring-event-icon" title="Recurring event">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                              </svg>
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
                            <span
                              class="text-[11px] font-bold truncate leading-tight"
                              style={{ color: calColor }}
                            >
                              {ev.details.title}
                            </span>
                          </div>
                          <Show when={item.height >= 36}>
                            <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] truncate mt-0.5">
                              {ev.startTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                              {" - "}
                              {ev.endTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                            </p>
                          </Show>
                          <Show when={item.height >= 50 && ev.details.location}>
                            <p class="text-[9px] text-[#6F7173] dark:text-[#878A8E] truncate flex items-center gap-1">
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
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
};
