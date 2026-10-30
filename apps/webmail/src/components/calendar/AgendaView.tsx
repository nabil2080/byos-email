import { Component, For, Show, createMemo } from "solid-js";
import { UserCalendar } from "../../api";
import { DecryptedEventRecord } from "./CalendarSidebar";

interface AgendaViewProps {
  calendars: UserCalendar[];
  events: DecryptedEventRecord[];
  onSelectEvent: (ev: DecryptedEventRecord) => void;
  onOpenCreateEvent: () => void;
}

interface GroupedAgenda {
  dateKey: string;
  displayDate: string;
  isToday: boolean;
  events: DecryptedEventRecord[];
}

export const AgendaView: Component<AgendaViewProps> = (props) => {
  const grouped = createMemo<GroupedAgenda[]>(() => {
    const sorted = [...props.events].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    const now = new Date();
    const map = new Map<string, GroupedAgenda>();

    for (const ev of sorted) {
      const d = ev.startTime;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;

      if (!map.has(key)) {
        const isToday =
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate();

        const displayDate = d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });

        map.set(key, {
          dateKey: key,
          displayDate,
          isToday,
          events: [],
        });
      }

      map.get(key)!.events.push(ev);
    }

    return Array.from(map.values());
  });

  return (
    <div class="flex-1 h-full min-h-0 bg-[#FAF9F5] dark:bg-[#18191D] overflow-y-auto p-4 md:p-6 select-none">
      <div class="max-w-3xl mx-auto flex flex-col gap-6">
        <Show
          when={grouped().length > 0}
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
              <h3 class="text-sm font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">No events scheduled</h3>
              <p class="text-xs text-[#6F7173] dark:text-[#878A8E] max-w-sm mt-1">
                There are no events in the selected time window. Create an event to get started.
              </p>
              <button
                type="button"
                onClick={() => props.onOpenCreateEvent()}
                class="mt-4 px-4 py-2 bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                Create Event
              </button>
            </div>
          }
        >
          <For each={grouped()}>
            {(group) => (
              <div class="flex flex-col gap-2">
                {/* Date Header */}
                <div class="flex items-center gap-2 sticky top-0 bg-[#FAF9F5] dark:bg-[#18191D] py-1.5 z-10">
                  <h3
                    class={`text-xs font-bold uppercase tracking-wider ${
                      group.isToday ? "text-[#9E725F] dark:text-[#D4A38F]" : "text-[#6F7173] dark:text-[#878A8E]"
                    }`}
                  >
                    {group.displayDate}
                  </h3>
                  <Show when={group.isToday}>
                    <span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-[#F2E8E2] dark:bg-[#3D2C24] text-[#9E725F] dark:text-[#D4A38F]">
                      TODAY
                    </span>
                  </Show>
                  <div class="flex-1 h-[1px] bg-[#E2DFD8] dark:border-[#2A2D35]" />
                </div>

                {/* Event Cards */}
                <div class="flex flex-col gap-2">
                  <For each={group.events}>
                    {(ev) => {
                      const cal = props.calendars.find((c) => c.id === ev.calendarId);
                      const calColor = cal?.color || "#9E725F";

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
                          class="flex items-start gap-4 p-4 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] hover:border-[#9E725F]/50 shadow-2xs hover:shadow-xs text-left transition-all cursor-pointer group"
                        >
                          {/* Calendar Color Strip */}
                          <div
                            class="w-1.5 self-stretch rounded-full flex-shrink-0"
                            style={{ "background-color": calColor }}
                          />

                          {/* Time & Calendar Pill */}
                          <div class="w-32 flex-shrink-0 flex flex-col gap-0.5">
                            <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                              {timeStr}
                            </span>
                            <span
                              class="text-[10px] font-medium truncate inline-block"
                              style={{ color: calColor }}
                            >
                              {cal?.name}
                            </span>
                          </div>

                          {/* Event Details */}
                          <div class="flex-1 min-w-0">
                            <h4 class="text-sm font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] group-hover:text-[#9E725F] transition-colors">
                              {ev.details.title}
                            </h4>

                            <Show when={ev.details.description}>
                              <p class="text-xs text-[#6F7173] dark:text-[#878A8E] line-clamp-2 mt-0.5">
                                {ev.details.description}
                              </p>
                            </Show>

                            <div class="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                              <Show when={ev.details.location}>
                                <span class="flex items-center gap-1 truncate">
                                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                    <circle cx="12" cy="10" r="3" />
                                  </svg>
                                  <span>{ev.details.location}</span>
                                </span>
                              </Show>

                              <Show when={ev.details.meetingUrl}>
                                <span class="flex items-center gap-1 text-[#9E725F] dark:text-[#D4A38F] truncate">
                                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                  </svg>
                                  <span>Video call link</span>
                                </span>
                              </Show>

                              <Show when={ev.details.attendees && ev.details.attendees.length > 0}>
                                <span class="flex items-center gap-1">
                                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                  </svg>
                                  <span>{ev.details.attendees!.length} attendee(s)</span>
                                </span>
                              </Show>
                            </div>
                          </div>
                        </button>
                      );
                    }}
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
