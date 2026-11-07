import { Component, For, Show, createMemo, createEffect, onMount } from "solid-js";
import { UserCalendar } from "../../api";
import { DecryptedEventRecord } from "./CalendarSidebar";
import { detectCategory } from "./kashcalParser";
import { KashcalCategoryIcon } from "./KashcalCategoryIcon";

export interface AgendaViewProps {
  calendars: UserCalendar[];
  events: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  onOpenCreateEvent?: (date?: Date) => void;
  currentDate?: Date;
}

interface DayAgendaGroup {
  date: Date;
  dateKey: string;
  dayNum: number;
  weekdayAbbr: string;
  isToday: boolean;
  events: DecryptedEventRecord[];
}

interface MonthAgendaSection {
  monthKey: string;
  monthTitle: string;
  days: DayAgendaGroup[];
}

export const AgendaView: Component<AgendaViewProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  // Group events by Month and Day into authentic Google Calendar Schedule sections
  const monthSections = createMemo<MonthAgendaSection[]>(() => {
    const sorted = [...props.events].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    const now = new Date();
    const monthsMap = new Map<string, { title: string; daysMap: Map<string, DayAgendaGroup> }>();

    // Always ensure Today exists in the schedule feed (Google Calendar pattern)
    const todayMKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const todayDKey = `${todayMKey}-${String(now.getDate()).padStart(2, "0")}`;
    monthsMap.set(todayMKey, {
      title: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      daysMap: new Map([[
        todayDKey,
        {
          date: now,
          dateKey: todayDKey,
          dayNum: now.getDate(),
          weekdayAbbr: now.toLocaleDateString("en-US", { weekday: "short" }),
          isToday: true,
          events: [],
        },
      ]]),
    });

    // Also ensure currentDate exists in the schedule feed so user can jump to it even if empty
    if (props.currentDate) {
      const curr = props.currentDate;
      const currMKey = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}`;
      const currDKey = `${currMKey}-${String(curr.getDate()).padStart(2, "0")}`;
      if (!monthsMap.has(currMKey)) {
        monthsMap.set(currMKey, {
          title: curr.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
          daysMap: new Map(),
        });
      }
      const mEntry = monthsMap.get(currMKey)!;
      if (!mEntry.daysMap.has(currDKey)) {
        mEntry.daysMap.set(currDKey, {
          date: curr,
          dateKey: currDKey,
          dayNum: curr.getDate(),
          weekdayAbbr: curr.toLocaleDateString("en-US", { weekday: "short" }),
          isToday: isSameDay(curr, now),
          events: [],
        });
      }
    }

    for (const ev of sorted) {
      const d = ev.startTime;
      const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const dKey = `${mKey}-${String(d.getDate()).padStart(2, "0")}`;

      if (!monthsMap.has(mKey)) {
        monthsMap.set(mKey, {
          title: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
          daysMap: new Map(),
        });
      }

      const mEntry = monthsMap.get(mKey)!;
      if (!mEntry.daysMap.has(dKey)) {
        mEntry.daysMap.set(dKey, {
          date: d,
          dateKey: dKey,
          dayNum: d.getDate(),
          weekdayAbbr: d.toLocaleDateString("en-US", { weekday: "short" }),
          isToday: isSameDay(d, now),
          events: [],
        });
      }

      mEntry.daysMap.get(dKey)!.events.push(ev);
    }

    const sections: MonthAgendaSection[] = [];
    const sortedMonthKeys = Array.from(monthsMap.keys()).sort();
    for (const mKey of sortedMonthKeys) {
      const entry = monthsMap.get(mKey)!;
      sections.push({
        monthKey: mKey,
        monthTitle: entry.title,
        days: Array.from(entry.daysMap.values()).sort(
          (a, b) => a.date.getTime() - b.date.getTime()
        ),
      });
    }

    return sections;
  });

  createEffect(() => {
    const curr = props.currentDate;
    if (!curr || !containerRef) return;
    const key = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}-${String(curr.getDate()).padStart(2, "0")}`;
    requestAnimationFrame(() => {
      const el = containerRef?.querySelector(`#agenda-day-${key}`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  onMount(() => {
    setTimeout(() => {
      const curr = props.currentDate || new Date();
      const key = `${curr.getFullYear()}-${String(curr.getMonth() + 1).padStart(2, "0")}-${String(curr.getDate()).padStart(2, "0")}`;
      const el = containerRef?.querySelector(`#agenda-day-${key}`) as HTMLElement | null;
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 150);
  });

  return (
    <div
      ref={containerRef}
      class="flex-1 h-full min-h-0 bg-[#FAF9F5] dark:bg-[#18191D] overflow-y-auto p-2 sm:p-4 select-none custom-scrollbar"
      data-testid="calendar-agenda-view"
    >
      <div class="max-w-2xl mx-auto flex flex-col gap-6">
        <Show
          when={monthSections().length > 0}
          fallback={
            <div class="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-2xs mt-8">
              <svg
                class="w-12 h-12 stroke-[#6F7173] dark:text-[#878A8E] fill-none stroke-[1.5] mb-3"
                viewBox="0 0 24 24"
              >
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <h3 class="text-sm font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                No events scheduled
              </h3>
              <p class="text-xs text-[#6F7173] dark:text-[#878A8E] max-w-sm mt-1">
                There are no events in the selected time window. Create an event to get started.
              </p>
              <button
                type="button"
                onClick={() => props.onOpenCreateEvent?.()}
                class="mt-4 px-4 py-2 bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Create Event
              </button>
            </div>
          }
        >
          <For each={monthSections()}>
            {(section) => (
              <div class="flex flex-col gap-3">
                {/* ── Google Calendar Month Transition Banner ── */}
                <div class="sticky top-0 z-20 flex items-center justify-between px-3 py-2 bg-[#FAF9F5]/95 dark:bg-[#18191D]/95 backdrop-blur-md border-b border-[#E2DFD8] dark:border-[#2A2D35] rounded-xl">
                  <div class="flex items-center gap-2">
                    <div class="w-2 h-2 rounded-full bg-[#9E725F]" />
                    <h2 class="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-[#3C3D3E] dark:text-[#ECEBE8]">
                      {section.monthTitle}
                    </h2>
                  </div>
                </div>

                {/* Days list in this month */}
                <div class="flex flex-col gap-4">
                  <For each={section.days}>
                    {(dayGroup) => (
                      <div
                        id={`agenda-day-${dayGroup.dateKey}`}
                        class="flex items-start gap-2.5 sm:gap-4 scroll-mt-14"
                      >
                        {/* ── Left Column: Google Calendar Date Bubble ── */}
                        <div class="w-11 sm:w-13 flex-shrink-0 flex flex-col items-center pt-0.5 select-none">
                          <span
                            class={`text-[10px] font-bold uppercase tracking-wider ${
                              dayGroup.isToday
                                ? "text-[#9E725F] dark:text-[#D4A38F]"
                                : "text-[#6F7173] dark:text-[#878A8E]"
                            }`}
                          >
                            {dayGroup.weekdayAbbr}
                          </span>
                          <div
                            class={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold transition-all ${
                              dayGroup.isToday
                                ? "bg-[#9E725F] text-white shadow-xs"
                                : "text-[#3C3D3E] dark:text-[#ECEBE8]"
                            }`}
                          >
                            {dayGroup.dayNum}
                          </div>
                        </div>

                        {/* ── Right Column: Stack of Event Cards ── */}
                        <div class="flex-1 flex flex-col gap-2 min-w-0">
                          <Show
                            when={dayGroup.events.length > 0}
                            fallback={
                              <div class="px-3.5 py-2.5 rounded-2xl bg-white/70 dark:bg-[#1E1F23]/70 border border-dashed border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between text-xs text-[#6F7173] dark:text-[#878A8E]">
                                <span>No events scheduled</span>
                                <button
                                  type="button"
                                  onClick={() => props.onOpenCreateEvent?.(dayGroup.date)}
                                  class="text-[11px] font-semibold text-[#9E725F] dark:text-[#D4A38F] hover:underline cursor-pointer"
                                >
                                  + Create
                                </button>
                              </div>
                            }
                          >
                            <For each={dayGroup.events}>
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
                                <Show
                                  when={!ev.isAllDay}
                                  fallback={
                                    /* All-day Pill Card */
                                    <button
                                      type="button"
                                      data-testid="calendar-event-pill"
                                      onClick={() => props.onSelectEvent(ev)}
                                      class="w-full px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer shadow-2xs hover:shadow-xs group flex items-center justify-between border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23]"
                                      style={{
                                        "border-left-width": "5px",
                                        "border-left-color": calColor,
                                      }}
                                    >
                                      <div class="flex items-center gap-2 min-w-0">
                                        <KashcalCategoryIcon
                                          category={detectCategory(ev.details.title)}
                                          class="w-3.5 h-3.5 shrink-0 stroke-current fill-none stroke-[2]"
                                          style={{ color: calColor }}
                                        />
                                        <span class="text-xs font-bold text-[#3C3D3E] dark:text-[#ECEBE8] truncate">
                                          {ev.details.title}
                                        </span>
                                      </div>
                                      <span class="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] flex-shrink-0">
                                        All day
                                      </span>
                                    </button>
                                  }
                                >
                                  {/* Timed Event Card */}
                                  <button
                                    type="button"
                                    data-testid="calendar-event-pill"
                                    onClick={() => props.onSelectEvent(ev)}
                                    class="w-full flex items-start gap-3 p-3.5 rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] hover:border-[#9E725F]/60 text-left transition-all cursor-pointer shadow-2xs group active:scale-[0.99]"
                                  >
                                    {/* Left Accent Strip */}
                                    <div
                                      class="w-1.5 self-stretch rounded-full flex-shrink-0"
                                      style={{ "background-color": calColor }}
                                    />

                                    {/* Event Information */}
                                    <div class="flex-1 min-w-0">
                                      <div class="flex items-center justify-between gap-2">
                                        <div class="flex items-center gap-2 min-w-0">
                                          <KashcalCategoryIcon
                                            category={detectCategory(ev.details.title)}
                                            class="w-3.5 h-3.5 shrink-0 stroke-current fill-none stroke-[2]"
                                            style={{ color: calColor }}
                                          />
                                          <h4 class="text-xs sm:text-sm font-bold text-[#3C3D3E] dark:text-[#ECEBE8] group-hover:text-[#9E725F] transition-colors truncate">
                                            {ev.details.title}
                                          </h4>
                                        </div>
                                        <span class="text-[11px] font-mono font-medium text-[#6F7173] dark:text-[#878A8E] flex-shrink-0">
                                          {timeStr}
                                        </span>
                                      </div>

                                      <Show when={ev.details.description}>
                                        <p class="text-xs text-[#6F7173] dark:text-[#878A8E] line-clamp-1 mt-0.5">
                                          {ev.details.description}
                                        </p>
                                      </Show>

                                      <div class="flex flex-wrap items-center gap-3 mt-1.5 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                                        <Show when={ev.details.location}>
                                          <span class="flex items-center gap-1 truncate">
                                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                              <circle cx="12" cy="10" r="3" />
                                            </svg>
                                            <span class="truncate">{ev.details.location}</span>
                                          </span>
                                        </Show>

                                        <Show when={ev.details.meetingUrl}>
                                          <span class="flex items-center gap-1 text-[#9E725F] dark:text-[#D4A38F] truncate">
                                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                            </svg>
                                            <span>Video meeting</span>
                                          </span>
                                        </Show>

                                        <Show when={cal?.name}>
                                          <span class="text-[10px] font-medium" style={{ color: calColor }}>
                                            • {cal?.name}
                                          </span>
                                        </Show>
                                      </div>
                                    </div>
                                  </button>
                                </Show>
                              );
                            }}
                          </For>
                        </Show>
                      </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
