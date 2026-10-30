import { Component, For, Show, createSignal, createMemo, onMount, onCleanup } from "solid-js";
import { UserCalendar } from "../../api";
import { DecryptedEventRecord } from "./CalendarSidebar";
import { AlternateCalendarSystem, formatAlternateDate } from "../../utils/alternateCalendar";

export interface YearViewProps {
  currentDate: Date;
  calendars: UserCalendar[];
  events: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  onSelectDate: (d: Date) => void;
  onSelectMonth?: (monthIndex: number, year: number) => void;
  onSlotClick: (start: Date, end: Date) => void;
  weekStart?: "sunday" | "monday" | "saturday";
  alternateCalendar?: AlternateCalendarSystem;
}

interface SelectedDayState {
  date: Date;
  events: DecryptedEventRecord[];
}

export const YearView: Component<YearViewProps> = (props) => {
  const [selectedDay, setSelectedDay] = createSignal<SelectedDayState | null>(null);

  const year = createMemo(() => props.currentDate.getFullYear());

  const monthNames = [
    "January", "February", "March", "April",
    "May", "June", "July", "August",
    "September", "October", "November", "December"
  ];

  const weekDayHeaders = createMemo(() => {
    const ws = props.weekStart || "sunday";
    if (ws === "monday") {
      return ["M", "T", "W", "T", "F", "S", "S"];
    } else if (ws === "saturday") {
      return ["S", "S", "M", "T", "W", "T", "F"];
    }
    return ["S", "M", "T", "W", "T", "F", "S"];
  });

  function isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  // Pre-calculate month cell grids
  interface MonthGridData {
    monthIndex: number;
    monthName: string;
    leadingBlanks: number;
    days: Array<{
      date: Date;
      dayNum: number;
      isToday: boolean;
      events: DecryptedEventRecord[];
      hasHoliday: boolean;
    }>;
  }

  const monthsData = createMemo<MonthGridData[]>(() => {
    const y = year();
    const ws = props.weekStart || "sunday";
    const now = new Date();
    const allEvents = props.events;

    return monthNames.map((name, m) => {
      const rawFirstDay = new Date(y, m, 1).getDay(); // 0 is Sunday
      let firstDayIndex = rawFirstDay;
      if (ws === "monday") {
        firstDayIndex = (rawFirstDay + 6) % 7;
      } else if (ws === "saturday") {
        firstDayIndex = (rawFirstDay + 1) % 7;
      }

      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const days = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(y, m, d);
        const dayEvents = allEvents.filter((ev) => isSameDay(ev.startTime, date));
        const hasHoliday = dayEvents.some((ev) => ev.isHoliday);

        days.push({
          date,
          dayNum: d,
          isToday: isSameDay(date, now),
          events: dayEvents,
          hasHoliday,
        });
      }

      return {
        monthIndex: m,
        monthName: name,
        leadingBlanks: firstDayIndex,
        days,
      };
    });
  });

  // Handle escape key to dismiss day inspector
  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedDay()) {
        setSelectedDay(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <div
      class="flex flex-col flex-1 h-full min-h-0 bg-[#FAF9F5] dark:bg-[#18191D] select-none overflow-y-auto"
      data-testid="calendar-year-view"
    >
      {/* ── 12-Month Grid ── */}
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 p-3 sm:p-5 max-w-7xl mx-auto w-full">
        <For each={monthsData()}>
          {(monthData) => {
            const monthTotalEvents = () =>
              monthData.days.reduce((acc, d) => acc + d.events.length, 0);

            return (
              <div
                class="flex flex-col bg-white dark:bg-[#1E1F23] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] p-3 shadow-2xs hover:shadow-xs transition-shadow min-w-0"
                data-testid={`year-month-card-${monthData.monthIndex}`}
              >
                {/* Month Card Header */}
                <div class="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (props.onSelectMonth) {
                        props.onSelectMonth(monthData.monthIndex, year());
                      } else {
                        props.onSelectDate(new Date(year(), monthData.monthIndex, 1));
                      }
                    }}
                    class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8] hover:text-[#9E725F] dark:hover:text-[#D4A38F] hover:underline cursor-pointer transition-colors text-left focus:outline-none focus:ring-1 focus:ring-[#9E725F] rounded px-1 -mx-1"
                    title={`View ${monthData.monthName} in month view`}
                    data-testid={`year-view-month-btn-${monthData.monthIndex}`}
                  >
                    {monthData.monthName}
                  </button>

                  <Show when={monthTotalEvents() > 0}>
                    <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796]">
                      {monthTotalEvents()} {monthTotalEvents() === 1 ? "event" : "events"}
                    </span>
                  </Show>
                </div>

                {/* Day of Week Headers */}
                <div class="grid grid-cols-7 mb-1 text-center">
                  <For each={weekDayHeaders()}>
                    {(header) => (
                      <span class="text-[10px] font-semibold text-[#6F7173] dark:text-[#878A8E] py-0.5">
                        {header}
                      </span>
                    )}
                  </For>
                </div>

                {/* Month Days Grid */}
                <div class="grid grid-cols-7 gap-y-1 text-center">
                  {/* Leading blanks */}
                  <For each={Array(monthData.leadingBlanks).fill(0)}>
                    {() => <div class="w-7 h-7 mx-auto" />}
                  </For>

                  {/* Month Days */}
                  <For each={monthData.days}>
                    {(day) => {
                      const hasEvents = () => day.events.length > 0;
                      const isSelected = () =>
                        selectedDay() && isSameDay(selectedDay()!.date, day.date);

                      return (
                        <div
                          role="button"
                          tabindex="0"
                          aria-label={`${monthData.monthName} ${day.dayNum}, ${year()}${
                            hasEvents() ? `, ${day.events.length} events` : ""
                          }`}
                          onClick={() => {
                            setSelectedDay({
                              date: day.date,
                              events: day.events,
                            });
                          }}
                          onDblClick={() => {
                            props.onSelectDate(day.date);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setSelectedDay({
                                date: day.date,
                                events: day.events,
                              });
                            }
                          }}
                          class={`w-7 h-7 mx-auto flex flex-col items-center justify-center rounded-lg text-xs cursor-pointer transition-all relative group focus:outline-none focus:ring-2 focus:ring-[#9E725F]/60 ${
                            day.isToday
                              ? "bg-[#9E725F] text-white font-bold shadow-2xs hover:bg-[#865E4D]"
                              : isSelected()
                              ? "bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796] font-bold"
                              : hasEvents()
                              ? "font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
                              : "text-[#2B2C2D] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
                          }`}
                          data-testid="year-day-cell"
                          data-date={`${year()}-${String(monthData.monthIndex + 1).padStart(2, "0")}-${String(
                            day.dayNum
                          ).padStart(2, "0")}`}
                        >
                          <span class="text-[11px] leading-none">{day.dayNum}</span>

                          {/* Event Dots */}
                          <Show when={hasEvents()}>
                            <div class="flex items-center justify-center gap-0.5 mt-0.5">
                              <For each={day.events.slice(0, 3)}>
                                {(ev) => {
                                  const cal = props.calendars.find((c) => c.id === ev.calendarId);
                                  const dotColor = ev.isHoliday
                                    ? "#10B981"
                                    : cal?.color || "#9E725F";

                                  return (
                                    <span
                                      class={`w-1 h-1 rounded-full ${
                                        day.isToday ? "bg-white" : ""
                                      }`}
                                      style={{
                                        "background-color": day.isToday ? undefined : dotColor,
                                      }}
                                    />
                                  );
                                }}
                              </For>
                            </div>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            );
          }}
        </For>
      </div>

      {/* ── Interactive Day Inspector Modal / Popover ── */}
      <Show when={selectedDay()}>
        {(current) => {
          const dateStr = current().date.toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          });

          return (
            <div
              class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150"
              onClick={() => setSelectedDay(null)}
              data-testid="year-day-inspector-backdrop"
            >
              <div
                class="w-full max-w-md bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
                data-testid="year-day-inspector"
              >
                {/* Modal Header */}
                <div class="flex items-center justify-between p-4 border-b border-[#F0EEE9] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D]">
                  <div class="flex flex-col min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-xs font-semibold text-[#9E725F] dark:text-[#D4A38F] uppercase tracking-wider">
                        {year()} Schedule
                      </span>
                      <Show when={props.alternateCalendar && props.alternateCalendar !== "none"}>
                        {(() => {
                          const alt = formatAlternateDate(current().date, props.alternateCalendar!);
                          if (!alt) return null;
                          return (
                            <span
                              class="text-[11px] font-medium px-2 py-0.5 rounded bg-[#EFECE6] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#A6A8AA]"
                              data-testid="year-inspector-alternate-date"
                              title={alt.fullText}
                            >
                              {alt.fullText}
                            </span>
                          );
                        })()}
                      </Show>
                    </div>
                    <h3 class="text-base font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate">
                      {dateStr}
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedDay(null)}
                    class="p-1.5 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
                    aria-label="Close inspector"
                    data-testid="year-day-inspector-close"
                  >
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                {/* Events List */}
                <div
                  class="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5"
                  data-testid="year-inspector-events-list"
                >
                  <Show
                    when={current().events.length > 0}
                    fallback={
                      <div class="py-8 text-center flex flex-col items-center gap-2 text-[#6F7173] dark:text-[#878A8E]">
                        <svg class="w-8 h-8 stroke-current fill-none stroke-[1.5] text-[#9E725F]/60" viewBox="0 0 24 24">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <p class="text-sm font-medium">No events scheduled for this day</p>
                        <p class="text-xs text-[#9E725F]">Click "+ Add Event" below to schedule one.</p>
                      </div>
                    }
                  >
                    <For each={current().events}>
                      {(ev) => {
                        const cal = props.calendars.find((c) => c.id === ev.calendarId);
                        const calColor = ev.isHoliday ? "#10B981" : cal?.color || "#9E725F";

                        const timeRange = () => {
                          if (ev.isAllDay) return "All Day";
                          const st = ev.startTime.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          });
                          const et = ev.endTime.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          });
                          return `${st} – ${et}`;
                        };

                        return (
                          <div
                            role="button"
                            tabindex="0"
                            onClick={() => {
                              setSelectedDay(null);
                              props.onSelectEvent(ev);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedDay(null);
                                props.onSelectEvent(ev);
                              }
                            }}
                            class="flex items-start gap-3 p-3 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#FAF9F5] dark:hover:bg-[#18191D] transition-colors cursor-pointer group focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                            data-testid="year-inspector-event-item"
                          >
                            <span
                              class="w-3 h-3 rounded-full flex-shrink-0 mt-0.5"
                              style={{ "background-color": calColor }}
                            />

                            <div class="flex-1 min-w-0">
                              <div class="flex items-center justify-between gap-2">
                                <h4 class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8] truncate group-hover:text-[#9E725F] transition-colors">
                                  {ev.details.title}
                                </h4>
                                <Show when={ev.isHoliday}>
                                  <span class="text-[10px] px-1.5 py-0.2 rounded font-medium bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 flex-shrink-0">
                                    Holiday
                                  </span>
                                </Show>
                              </div>

                              <p class="text-xs text-[#6F7173] dark:text-[#878A8E] mt-0.5 font-medium">
                                {timeRange()}
                              </p>

                              <Show when={ev.details.location}>
                                <p class="text-xs text-[#6F7173] dark:text-[#878A8E] truncate mt-0.5 flex items-center gap-1">
                                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                    <circle cx="12" cy="10" r="3" />
                                  </svg>
                                  <span class="truncate">{ev.details.location}</span>
                                </p>
                              </Show>

                              <Show when={ev.holidayMeta?.provisionalNote}>
                                <p class="text-[11px] text-amber-700 dark:text-amber-300 mt-1 italic flex items-center gap-1">
                                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="16" x2="12" y2="12" />
                                    <line x1="12" y1="8" x2="12.01" y2="8" />
                                  </svg>
                                  <span>{ev.holidayMeta?.provisionalNote}</span>
                                </p>
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>

                {/* Modal Footer Actions */}
                <div class="flex items-center justify-between p-3.5 border-t border-[#F0EEE9] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const d = current().date;
                      setSelectedDay(null);
                      props.onSelectDate(d);
                    }}
                    class="px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] transition-colors cursor-pointer"
                    data-testid="year-inspector-view-day-btn"
                  >
                    Go to Day
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const d = current().date;
                      const s = new Date(d);
                      s.setHours(9, 0, 0, 0);
                      const e = new Date(d);
                      e.setHours(10, 0, 0, 0);
                      setSelectedDay(null);
                      props.onSlotClick(s, e);
                    }}
                    class="px-3.5 py-1.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                    data-testid="year-inspector-add-btn"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span>New Event</span>
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
};