import { Component, createSignal, createMemo, createEffect, For } from "solid-js";

interface MiniMonthPickerProps {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
}

export const MiniMonthPicker: Component<MiniMonthPickerProps> = (props) => {
  // Navigation month/year state
  const [viewMonth, setViewMonth] = createSignal(props.selectedDate.getMonth());
  const [viewYear, setViewYear] = createSignal(props.selectedDate.getFullYear());
  let gridRef: HTMLDivElement | undefined;

  createEffect(() => {
    setViewMonth(props.selectedDate.getMonth());
    setViewYear(props.selectedDate.getFullYear());
  });

  const monthName = createMemo(() => {
    const d = new Date(viewYear(), viewMonth(), 1);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  });

  function prevMonth() {
    if (viewMonth() === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
    if (gridRef) {
      gridRef.classList.remove("animate-month-slide-next", "animate-month-slide-prev");
      void gridRef.offsetWidth;
      gridRef.classList.add("animate-month-slide-prev");
    }
  }

  function nextMonth() {
    if (viewMonth() === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
    if (gridRef) {
      gridRef.classList.remove("animate-month-slide-next", "animate-month-slide-prev");
      void gridRef.offsetWidth;
      gridRef.classList.add("animate-month-slide-next");
    }
  }

  interface CalendarDay {
    date: Date;
    dayNum: number;
    isCurrentMonth: boolean;
    isToday: boolean;
    isSelected: boolean;
  }

  const daysGrid = createMemo<CalendarDay[]>(() => {
    const year = viewYear();
    const month = viewMonth();
    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const now = new Date();
    const selected = props.selectedDate;

    const days: CalendarDay[] = [];

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

    // Next month padding (to reach 35 or 42 cells)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({
        date: d,
        dayNum: i,
        isCurrentMonth: false,
        isToday: isSameDay(d, now),
        isSelected: isSameDay(d, selected),
      });
    }

    return days;
  });

  function isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  return (
    <div class="p-3 bg-white dark:bg-[#1E1F23] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] select-none shadow-2xs">
      {/* Month & Year header with arrow navigation */}
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">{monthName()}</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            class="p-1 rounded-md text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
            aria-label="Previous month"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={nextMonth}
            class="p-1 rounded-md text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
            aria-label="Next month"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Days of week header */}
      <div class="grid grid-cols-7 gap-1 text-center mb-1 text-[10px] font-semibold text-[#6F7173] dark:text-[#878A8E]">
        <div>S</div>
        <div>M</div>
        <div>T</div>
        <div>W</div>
        <div>T</div>
        <div>F</div>
        <div>S</div>
      </div>

      {/* Calendar Grid */}
      <div
        ref={gridRef}
        class="grid grid-cols-7 gap-1 text-center"
        onAnimationEnd={() => gridRef?.classList.remove("animate-month-slide-next", "animate-month-slide-prev")}
      >
        <For each={daysGrid()}>
          {(day) => (
            <button
              type="button"
              onClick={() => props.onSelectDate(day.date)}
              class={`w-6 h-6 mx-auto flex items-center justify-center text-[11px] rounded-full transition-colors cursor-pointer ${
                day.isSelected
                  ? "bg-[#9E725F] text-white font-semibold"
                  : day.isToday
                  ? "bg-[#F2E8E2] text-[#9E725F] dark:bg-[#3D2C24] dark:text-[#D4A38F] font-semibold"
                  : day.isCurrentMonth
                  ? "text-[#2B2C2D] dark:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
                  : "text-[#B3B1AC] dark:text-[#5E6063] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35]"
              }`}
            >
              {day.dayNum}
            </button>
          )}
        </For>
      </div>
    </div>
  );
};
