import { Component, For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { UserCalendar } from "../../api";
import { DecryptedEventRecord } from "./CalendarSidebar";
import { detectCategory } from "./kashcalParser";
import { KashcalCategoryIcon } from "./KashcalCategoryIcon";

export interface MobileMonthSplitViewProps {
  currentDate: Date;
  onSelectDate: (d: Date) => void;
  calendars: UserCalendar[];
  events: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  onOpenCreateEvent?: () => void;
  onSlotClick?: (start: Date, end: Date) => void;
  weekStart?: "sunday" | "monday" | "saturday";
  onPrev?: () => void;
  onNext?: () => void;
}

interface SplitCalendarDay {
  date: Date;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

export const MobileMonthSplitView: Component<MobileMonthSplitViewProps> = (props) => {
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const isEventOnDay = (ev: DecryptedEventRecord, day: Date): boolean => {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
    return ev.startTime <= dayEnd && ev.endTime >= dayStart;
  };

  const weekdayHeaders = createMemo(() => {
    if (props.weekStart === "monday") {
      return ["M", "T", "W", "T", "F", "S", "S"];
    }
    if (props.weekStart === "saturday") {
      return ["S", "S", "M", "T", "W", "T", "F"];
    }
    return ["S", "M", "T", "W", "T", "F", "S"];
  });

  const [slideAnim, setSlideAnim] = createSignal<string>("");
  let prevDateMonth = props.currentDate.getFullYear() * 12 + props.currentDate.getMonth();

  createEffect(() => {
    const currMonth = props.currentDate.getFullYear() * 12 + props.currentDate.getMonth();
    if (currMonth > prevDateMonth) {
      setSlideAnim("");
      requestAnimationFrame(() => setSlideAnim("animate-month-slide-next"));
    } else if (currMonth < prevDateMonth) {
      setSlideAnim("");
      requestAnimationFrame(() => setSlideAnim("animate-month-slide-prev"));
    }
    prevDateMonth = currMonth;
  });

  // Touch swipe gestures
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

  // Month days grid for top half (consistent 7x6 = 42 cells)
  const daysGrid = createMemo<SplitCalendarDay[]>(() => {
    const year = props.currentDate.getFullYear();
    const month = props.currentDate.getMonth();
    const weekStartIndex = props.weekStart === "monday" ? 1 : props.weekStart === "saturday" ? 6 : 0;
    const rawFirstDay = new Date(year, month, 1).getDay();
    const firstDayIndex = (rawFirstDay - weekStartIndex + 7) % 7;
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const now = new Date();
    const selected = props.currentDate;
    const days: SplitCalendarDay[] = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, daysInPrevMonth - i);
      days.push({
        date: d,
        dayNum: daysInPrevMonth - i,
        isCurrentMonth: false,
        isToday: isSameDay(d, now),
        isSelected: isSameDay(d, selected),
      });
    }

    // Current month days
    for (let i = 1; i <= daysInCurrentMonth; i++) {
      const d = new Date(year, month, i);
      days.push({
        date: d,
        dayNum: i,
        isCurrentMonth: true,
        isToday: isSameDay(d, now),
        isSelected: isSameDay(d, selected),
      });
    }

    // Next month padding (complete exactly 42 cells for consistent 6 rows)
    let nextMonthDay = 1;
    while (days.length < 42) {
      const d = new Date(year, month + 1, nextMonthDay++);
      days.push({
        date: d,
        dayNum: d.getDate(),
        isCurrentMonth: false,
        isToday: isSameDay(d, now),
        isSelected: isSameDay(d, selected),
      });
    }

    return days;
  });

  // Map of date string -> events for fast dot lookup
  const eventsByDayMap = createMemo(() => {
    const map = new Map<string, DecryptedEventRecord[]>();
    for (const ev of props.events) {
      const start = new Date(ev.startTime);
      const end = new Date(ev.endTime);
      const curr = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

      while (curr <= endDay) {
        const key = `${curr.getFullYear()}-${curr.getMonth()}-${curr.getDate()}`;
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key)!.push(ev);
        curr.setDate(curr.getDate() + 1);
      }
    }
    return map;
  });

  const getDotsForDate = (date: Date) => {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return eventsByDayMap().get(key) || [];
  };

  // Events occurring on the selected date
  const selectedDayEvents = createMemo<DecryptedEventRecord[]>(() => {
    const target = props.currentDate;
    return props.events
      .filter((ev) => isEventOnDay(ev, target))
      .sort((a, b) => {
        if (a.isAllDay && !b.isAllDay) return -1;
        if (!a.isAllDay && b.isAllDay) return 1;
        return a.startTime.getTime() - b.startTime.getTime();
      });
  });

  const selectedDateHeader = createMemo(() => {
    const d = props.currentDate;
    const now = new Date();
    const isToday = isSameDay(d, now);

    const fullStr = d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    return { fullStr, isToday };
  });

  return (
    <div
      class="flex-1 flex flex-col min-h-0 bg-[#FAF9F5] dark:bg-[#18191D] overflow-hidden select-none"
      data-testid="mobile-month-split-view"
    >
      {/* ── TOP HALF: Compact 7-column Month Grid ── */}
      <div
        class="p-3 bg-white dark:bg-[#1E1F23] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex-shrink-0 shadow-2xs"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Days of week header */}
        <div class="grid grid-cols-7 gap-1 text-center mb-1 text-[11px] font-bold text-[#6F7173] dark:text-[#878A8E]">
          <For each={weekdayHeaders()}>
            {(h) => <div>{h}</div>}
          </For>
        </div>

        {/* Calendar Day Cells */}
        <div
          class={`grid grid-cols-7 gap-1 text-center ${slideAnim()}`}
          onAnimationEnd={() => setSlideAnim("")}
        >
          <For each={daysGrid()}>
            {(day) => {
              const dots = () => getDotsForDate(day.date);
              return (
                <button
                  type="button"
                  data-testid="month-cell"
                  onClick={() => props.onSelectDate(day.date)}
                  class={`h-11 flex flex-col items-center justify-start pt-1 rounded-xl transition-all cursor-pointer relative ${
                    day.isSelected
                      ? "bg-[#3C3D3E] dark:bg-[#ECEBE8] text-white dark:text-[#18191D] font-bold shadow-xs"
                      : day.isToday
                      ? "text-[#9E725F] font-bold ring-1 ring-[#9E725F]/60"
                      : day.isCurrentMonth
                      ? "text-[#3C3D3E] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
                      : "text-[#B8B6B0] dark:text-[#565961] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
                  }`}
                  aria-label={day.date.toDateString()}
                  aria-selected={day.isSelected}
                >
                  <span class="text-xs leading-none">
                    {day.dayNum}
                  </span>

                  {/* Indicator Dots for Events */}
                  <div class="flex items-center justify-center gap-0.5 mt-1 h-1.5 overflow-hidden">
                    <For each={dots().slice(0, 3)}>
                      {(ev) => {
                        const cal = props.calendars.find((c) => c.id === ev.calendarId);
                        const dotColor = ev.details?.color || cal?.color || "#9E725F";
                        return (
                          <span
                            class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              day.isSelected ? "bg-white dark:bg-[#18191D]" : ""
                            }`}
                            style={{ "background-color": day.isSelected ? undefined : dotColor }}
                          />
                        );
                      }}
                    </For>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* ── BOTTOM HALF: Selected Day Agenda Feed ── */}
      <div class="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar">
        {/* Sticky Subheader for Selected Day */}
        <div class="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 bg-[#FAF9F5] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35]">
          <div class="flex items-center gap-2">
            <h3 class="text-xs font-bold uppercase tracking-wider text-[#3C3D3E] dark:text-[#ECEBE8]">
              {selectedDateHeader().fullStr}
            </h3>
            <Show when={selectedDateHeader().isToday}>
              <span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-[#F2E8E2] dark:bg-[#3D2C24] text-[#9E725F] dark:text-[#D4A38F]">
                TODAY
              </span>
            </Show>
          </div>
          <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E]">
            {selectedDayEvents().length} event{selectedDayEvents().length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Events List or Empty State */}
        <div class="p-3 flex flex-col gap-2">
          <Show
            when={selectedDayEvents().length > 0}
            fallback={
              <div class="flex flex-col items-center justify-center p-8 text-center bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] mt-2">
                <svg
                  class="w-8 h-8 stroke-[#878A8E] fill-none stroke-[1.6] mb-2"
                  viewBox="0 0 24 24"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <p class="text-xs font-semibold text-[#3C3D3E] dark:text-[#ECEBE8]">
                  No events on this day
                </p>
                <Show when={props.onOpenCreateEvent}>
                  <button
                    type="button"
                    onClick={props.onOpenCreateEvent}
                    class="mt-3 px-3 py-1.5 rounded-xl bg-[#F0EEE9] dark:bg-[#2A2D35] hover:bg-[#E2DFD8] text-xs font-semibold text-[#3C3D3E] dark:text-[#ECEBE8] transition-colors cursor-pointer"
                  >
                    Create event
                  </button>
                </Show>
              </div>
            }
          >
            <For each={selectedDayEvents()}>
              {(ev) => {
                const cal = props.calendars.find((c) => c.id === ev.calendarId);
                const calColor = ev.details?.color || cal?.color || "#9E725F";

                const timeStr = ev.isAllDay
                  ? "All day"
                  : `${ev.startTime.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })} - ${ev.endTime.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}`;

                return (
                  <button
                    type="button"
                    data-testid="calendar-event-pill"
                    onClick={() => props.onSelectEvent(ev)}
                    class="flex items-start gap-3 p-3.5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] hover:border-[#9E725F]/60 text-left transition-all cursor-pointer shadow-2xs group active:scale-[0.99]"
                  >
                    {/* Left Accent Strip */}
                    <div
                      class="w-1.5 self-stretch rounded-full flex-shrink-0"
                      style={{ "background-color": calColor }}
                    />

                    {/* Details Column */}
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5 min-w-0">
                          <KashcalCategoryIcon
                            category={detectCategory(ev.details.title)}
                            class="w-3.5 h-3.5 shrink-0 stroke-current fill-none stroke-[2]"
                            style={{ color: calColor }}
                          />
                          <span class="text-xs font-bold text-[#3C3D3E] dark:text-[#ECEBE8] group-hover:text-[#9E725F] transition-colors truncate">
                            {ev.details.title}
                          </span>
                        </div>
                        <span class="text-[11px] font-mono font-medium text-[#6F7173] dark:text-[#878A8E] flex-shrink-0">
                          {timeStr}
                        </span>
                      </div>

                      <Show when={ev.details.location}>
                        <div class="flex items-center gap-1 mt-1 text-[11px] text-[#6F7173] dark:text-[#878A8E] truncate">
                          <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          <span class="truncate">{ev.details.location}</span>
                        </div>
                      </Show>

                      <Show when={ev.details.meetingUrl}>
                        <div class="flex items-center gap-1 mt-1 text-[11px] text-[#9E725F] dark:text-[#D4A38F] truncate">
                          <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                          <span>Video meeting</span>
                        </div>
                      </Show>
                    </div>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};
