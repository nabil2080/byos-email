import { Component, For, Show, createMemo } from "solid-js";
import { UserCalendar } from "../../api";
import { DecryptedEventRecord } from "./CalendarSidebar";
import { AlternateCalendarSystem, formatAlternateDate } from "../../utils/alternateCalendar";
import { getWeekNumber } from "../../utils/calendarTimezones";
import { TaskItem } from "./tasks/taskTypes";
import { getTasksForDate, isTaskOverdue } from "./tasks/taskStore";

interface MonthViewProps {
  currentDate: Date;
  calendars: UserCalendar[];
  events: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  onSelectDate: (d: Date) => void;
  onSlotClick: (start: Date, end: Date) => void;
  weekStart?: "sunday" | "monday" | "saturday";
  showWeekNumbers?: boolean;
  firstWeekOfYear?: "four_day_week" | "first_day" | "full_week";
  alternateCalendar?: AlternateCalendarSystem;
  primaryTimeZone?: string;
  tasks?: TaskItem[];
  showTasks?: boolean;
  onToggleTaskComplete?: (taskId: string) => void;
  onSelectTask?: (task: TaskItem) => void;
}

interface MonthCell {
  date: Date;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export const MonthView: Component<MonthViewProps> = (props) => {
  const weekDayHeaders = createMemo(() => {
    const ws = props.weekStart || "sunday";
    if (ws === "monday") {
      return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    } else if (ws === "saturday") {
      return ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
    }
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  });

  const monthDays = createMemo<MonthCell[]>(() => {
    const year = props.currentDate.getFullYear();
    const month = props.currentDate.getMonth();
    const rawFirstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
    const ws = props.weekStart || "sunday";
    let firstDayIndex = rawFirstDay;
    if (ws === "monday") {
      firstDayIndex = (rawFirstDay + 6) % 7;
    } else if (ws === "saturday") {
      firstDayIndex = (rawFirstDay + 1) % 7;
    }

    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const now = new Date();
    const cells: MonthCell[] = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, daysInPrevMonth - i);
      cells.push({
        date: d,
        dayNum: daysInPrevMonth - i,
        isCurrentMonth: false,
        isToday: isSameDay(d, now),
      });
    }

    // Current month days
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      const d = new Date(year, month, i);
      cells.push({
        date: d,
        dayNum: i,
        isCurrentMonth: true,
        isToday: isSameDay(d, now),
      });
    }

    // Next month padding
    const remaining = (7 - (cells.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      cells.push({
        date: d,
        dayNum: i,
        isCurrentMonth: false,
        isToday: isSameDay(d, now),
      });
    }

    return cells;
  });

  function isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  return (
    <div class="flex flex-col flex-1 h-full min-h-0 bg-white dark:bg-[#18191D] select-none overflow-hidden">
      {/* ── Days of Week Header ── */}
      <div class="grid grid-cols-7 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] flex-shrink-0">
        <For each={weekDayHeaders()}>
          {(dayName) => (
            <div class="py-2 text-center text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] border-r border-[#E2DFD8] dark:border-[#2A2D35] last:border-r-0">
              {dayName}
            </div>
          )}
        </For>
      </div>

      {/* ── Month Grid ── */}
      <div class="grid grid-cols-7 flex-1 auto-rows-fr overflow-y-auto custom-scrollbar">
        <For each={monthDays()}>
          {(cell, idx) => {
            const cellEvents = () =>
              props.events.filter((ev) => isSameDay(ev.startTime, cell.date));

            return (
              <div
                class={`min-h-[90px] border-b border-r border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 p-1.5 flex flex-col transition-colors cursor-pointer ${
                  cell.isCurrentMonth
                    ? "bg-white dark:bg-[#18191D] hover:bg-[#FAF9F5] dark:hover:bg-[#1E1F23]"
                    : "bg-[#F7F6F2] dark:bg-[#15161A] hover:bg-[#EFECE6] dark:hover:bg-[#1E1F23]"
                }`}
                onClick={() => {
                  const s = new Date(cell.date);
                  s.setHours(9, 0, 0, 0);
                  const e = new Date(cell.date);
                  e.setHours(10, 0, 0, 0);
                  props.onSlotClick(s, e);
                }}
              >
                {/* Day Number Header */}
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-1">
                    <span
                      class={`w-6 h-6 flex items-center justify-center text-xs rounded-full font-bold ${
                        cell.isToday
                          ? "bg-[#9E725F] text-white"
                          : cell.isCurrentMonth
                          ? "text-[#2B2C2D] dark:text-[#ECEBE8]"
                          : "text-[#B3B1AC] dark:text-[#5E6063]"
                      }`}
                    >
                      {cell.dayNum}
                    </span>
                    <Show when={props.showWeekNumbers && idx() % 7 === 0}>
                      <span
                        class="text-[9px] font-mono px-1 py-0.2 rounded bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] font-semibold"
                        data-testid="month-week-number"
                        title="Week Number"
                      >
                        W{getWeekNumber(cell.date, props.weekStart, props.firstWeekOfYear)}
                      </span>
                    </Show>
                  </div>
                  <Show when={props.alternateCalendar && props.alternateCalendar !== "none"}>
                    {(() => {
                      const alt = formatAlternateDate(cell.date, props.alternateCalendar!);
                      if (!alt) return null;
                      return (
                        <span
                          class="text-[10px] font-medium text-[#6F7173] dark:text-[#878A8E] truncate max-w-[65px] text-right"
                          title={alt.fullText}
                          data-testid="month-alternate-date"
                        >
                          {alt.badge}
                        </span>
                      );
                    })()}
                  </Show>
                </div>

                {/* Event Pills */}
                <div class="flex flex-col gap-1 overflow-hidden flex-1">
                  <For each={cellEvents().slice(0, 3)}>
                    {(ev) => {
                      const cal = props.calendars.find((c) => c.id === ev.calendarId);
                      const calColor = ev.details.color || cal?.color || "#9E725F";
                      const isDeclined = ev.status === "declined" || ev.status === "cancelled" || ev.details.status === "declined";

                      return (
                        <button
                          type="button"
                          data-testid="calendar-event-pill"
                          data-is-holiday={ev.isHoliday ? "true" : "false"}
                          data-is-declined={isDeclined ? "true" : "false"}
                          data-event-title={ev.details.title}
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onSelectEvent(ev);
                          }}
                          class={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[11px] font-medium truncate text-left shadow-2xs hover:opacity-90 cursor-pointer ${
                            isDeclined ? "line-through opacity-50 italic" : ""
                          }`}
                          style={{
                            "background-color": `${calColor}20`,
                            "border-left": `3px solid ${calColor}`,
                          }}
                        >
                          <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ "background-color": calColor }} />
                          <Show when={ev.details.visibility === "private" || ev.details.visibility === "confidential"}>
                            <svg class="w-2.5 h-2.5 shrink-0 stroke-current fill-none stroke-[2.5]" style={{ color: calColor }} viewBox="0 0 24 24">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
                          <span class={`truncate font-semibold ${isDeclined ? "line-through" : ""}`} style={{ color: calColor }}>
                            {ev.details.title}
                          </span>
                        </button>
                      );
                    }}
                  </For>

                  {/* Tasks in this day (Category 11) */}
                  <Show when={props.showTasks !== false && (props.tasks || []).length > 0}>
                    <For each={getTasksForDate(props.tasks || [], cell.date, props.primaryTimeZone || "UTC")}>
                      {(task) => {
                        const overdue = () => isTaskOverdue(task, new Date(), props.primaryTimeZone || "UTC");
                        return (
                          <div
                            class={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border border-[#E2DFD8] dark:border-[#2A2D35] transition-all cursor-pointer ${
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
                              <span class="text-[8px] font-bold text-red-600 dark:text-red-400" data-testid="task-overdue-badge">!</span>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </Show>

                  {/* Overflow indicator */}
                  <Show when={cellEvents().length > 3}>
                    <span class="text-[10px] font-medium text-[#6F7173] dark:text-[#878A8E] pl-1">
                      +{cellEvents().length - 3} more
                    </span>
                  </Show>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
