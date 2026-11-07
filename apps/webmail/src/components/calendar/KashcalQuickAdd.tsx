import { Component, createSignal, createMemo, Show, For } from "solid-js";
import { parseNaturalLanguageEvent, ParsedKashcalEvent } from "./kashcalParser";
import { KashcalCategoryIcon } from "./KashcalCategoryIcon";
import { UserCalendar } from "../../api";

interface KashcalQuickAddProps {
  calendars: UserCalendar[];
  activeCalendarId?: string;
  onQuickCreate: (event: {
    calendarId: string;
    title: string;
    startTime: Date;
    endTime: Date;
    isAllDay: boolean;
    category: string;
  }) => Promise<void>;
  isOpen?: boolean;
  onClose?: () => void;
}

export const KashcalQuickAdd: Component<KashcalQuickAddProps> = (props) => {
  const [inputText, setInputText] = createSignal("");
  const [selectedCalendarId, setSelectedCalendarId] = createSignal<string>(
    props.activeCalendarId || (props.calendars[0]?.id ?? "")
  );
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);

  // Sync selectedCalendarId when props change
  createMemo(() => {
    if (props.activeCalendarId && !selectedCalendarId()) {
      setSelectedCalendarId(props.activeCalendarId);
    } else if (!selectedCalendarId() && props.calendars.length > 0) {
      setSelectedCalendarId(props.calendars[0].id);
    }
  });

  const parsed = createMemo<ParsedKashcalEvent>(() => {
    return parseNaturalLanguageEvent(inputText());
  });

  const activeCal = createMemo(() => {
    const id = selectedCalendarId();
    return props.calendars.find((c) => c.id === id) || props.calendars[0];
  });

  const quickShortcuts = [
    { label: "Tomorrow 9am", text: "Team sync tomorrow 9am 30m" },
    { label: "Tomorrow 2pm", text: "Coffee with Alex tomorrow 2pm" },
    { label: "Friday 10am", text: "Design review Friday 10am 45m" },
    { label: "Gym Today 6pm", text: "Gym workout today 6pm 1h" },
  ];

  const durationChips = [
    { label: "15m", value: "15m" },
    { label: "30m", value: "30m" },
    { label: "45m", value: "45m" },
    { label: "1h", value: "1h" },
    { label: "2h", value: "2h" },
  ];

  function handleApplyShortcut(preset: string) {
    setInputText(preset);
  }

  function handleAppendDuration(dur: string) {
    const current = inputText().trim();
    // Replace any existing duration or append
    const replaced = current.replace(/\b(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/i, "").trim();
    setInputText(`${replaced} ${dur}`.trim());
  }

  async function handleSubmit() {
    const text = inputText().trim();
    if (!text || isSubmitting()) return;

    const p = parsed();
    const calId = selectedCalendarId() || props.calendars[0]?.id;
    if (!calId) return;

    try {
      setIsSubmitting(true);
      await props.onQuickCreate({
        calendarId: calId,
        title: p.title,
        startTime: p.startDate,
        endTime: p.endDate,
        isAllDay: p.isAllDay,
        category: p.category,
      });

      setToastMessage(`Created "${p.title}" on ${p.startDate.toLocaleDateString([], { month: "short", day: "numeric" })}`);
      setInputText("");
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      console.error("[KashcalQuickAdd] Failed to create event:", err);
      setToastMessage(`Error: ${err?.message || "Failed to create event"}`);
      setTimeout(() => setToastMessage(null), 4000);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === "Escape") {
      props.onClose?.();
    }
  }

  return (
    <div
      class="px-3.5 py-2.5 bg-[#FAF9F5] dark:bg-[#1C1D21] border-b border-[#E2DFD8] dark:border-[#2A2D35] transition-all duration-200"
      data-testid="kashcal-quick-add-panel"
    >
      <div class="max-w-4xl mx-auto space-y-2">
        {/* Main Input Bar */}
        <div class="relative flex items-center gap-2">
          {/* Category Icon Badge */}
          <div
            class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border border-[#E2DFD8] dark:border-[#2A2D35] transition-colors"
            style={{
              "background-color": `color-mix(in srgb, ${activeCal()?.color || "#9E725F"} 14%, var(--calendar-surface-base, #ffffff))`,
              color: activeCal()?.color || "#9E725F",
            }}
            title={`Detected category: ${parsed().category}`}
          >
            <KashcalCategoryIcon category={parsed().category} class="w-4 h-4 stroke-current fill-none stroke-[2]" />
          </div>

          {/* Natural Language Input */}
          <div class="relative flex-1">
            <input
              type="text"
              value={inputText()}
              onInput={(e) => setInputText(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder='Smart Add: "Coffee with Sarah tomorrow 3pm" or "Review Friday 10am 45m" (Enter to create)'
              class="w-full px-3.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] text-xs sm:text-sm text-[#3C3D3E] dark:text-[#ECEBE8] placeholder-[#878A8E] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/30 focus:border-[#9E725F] transition-all shadow-2xs"
              data-testid="kashcal-quick-add-input"
              autofocus
            />
            <Show when={inputText()}>
              <button
                type="button"
                onClick={() => setInputText("")}
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#878A8E] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] cursor-pointer"
                aria-label="Clear input"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </Show>
          </div>

          {/* Calendar Selector Dropdown */}
          <div class="shrink-0 hidden sm:block">
            <select
              value={selectedCalendarId()}
              onChange={(e) => setSelectedCalendarId(e.currentTarget.value)}
              class="text-xs px-2.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] text-[#3C3D3E] dark:text-[#ECEBE8] focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
              data-testid="kashcal-calendar-selector"
            >
              <For each={props.calendars}>
                {(cal) => (
                  <option value={cal.id}>
                    {cal.name}
                  </option>
                )}
              </For>
            </select>
          </div>

          {/* Submit Action Button */}
          <button
            type="button"
            disabled={!inputText().trim() || isSubmitting()}
            onClick={handleSubmit}
            class="px-3.5 py-1.5 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] disabled:opacity-40 text-white text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95"
            data-testid="kashcal-quick-create-btn"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{isSubmitting() ? "Creating..." : "Create"}</span>
          </button>
        </div>

        {/* Live Parsed Preview Chips */}
        <Show when={inputText().trim().length > 0}>
          <div
            class="flex items-center flex-wrap gap-1.5 pt-0.5 animate-in fade-in duration-150 text-[11px]"
            data-testid="kashcal-parsed-preview"
          >
            <span class="text-[#878A8E] font-medium mr-1">Parsed:</span>

            {/* Category Chip */}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] font-medium capitalize">
              <KashcalCategoryIcon category={parsed().category} class="w-3 h-3 stroke-current fill-none stroke-[2]" />
              <span>{parsed().category}</span>
            </span>

            {/* Title Chip */}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8] font-semibold">
              <span>{parsed().title}</span>
            </span>

            {/* Date Chip */}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8]">
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>{parsed().startDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
            </span>

            {/* Time Chip */}
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#3C3D3E] dark:text-[#ECEBE8]">
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>
                {parsed().isAllDay
                  ? "All Day"
                  : `${parsed().startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${parsed().endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${parsed().durationMinutes}m)`}
              </span>
            </span>
          </div>
        </Show>

        {/* Quick Suggestion Chips */}
        <div class="flex items-center flex-wrap gap-1.5 pt-0.5 text-[10px]">
          <span class="text-[#878A8E]">Suggestions:</span>
          <For each={quickShortcuts}>
            {(sc) => (
              <button
                type="button"
                onClick={() => handleApplyShortcut(sc.text)}
                class="px-2 py-0.5 rounded-md bg-white dark:bg-[#18191D] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] transition-colors cursor-pointer"
              >
                {sc.label}
              </button>
            )}
          </For>

          <span class="text-[#878A8E] ml-2">Duration:</span>
          <For each={durationChips}>
            {(dur) => (
              <button
                type="button"
                onClick={() => handleAppendDuration(dur.value)}
                class="px-1.5 py-0.5 rounded-md bg-white dark:bg-[#18191D] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] hover:text-[#3C3D3E] dark:hover:text-[#ECEBE8] transition-colors cursor-pointer"
              >
                +{dur.label}
              </button>
            )}
          </For>
        </div>

        {/* Toast / Feedback Notice */}
        <Show when={toastMessage()}>
          <div
            class="flex items-center gap-2 p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs animate-in fade-in duration-150"
            data-testid="kashcal-quick-add-toast"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2.5] text-emerald-600 shrink-0" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span class="font-medium truncate">{toastMessage()}</span>
          </div>
        </Show>
      </div>
    </div>
  );
};
