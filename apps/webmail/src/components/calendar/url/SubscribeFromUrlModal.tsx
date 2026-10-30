import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import {
  subscribeUrlFeed,
  isValidCalendarUrl,
  normalizeCalendarUrl,
  fetchAndParseUrlFeed,
  CachedUrlEvent,
} from "./urlCalendarStore";

interface SubscribeFromUrlModalProps {
  isOpen: boolean;
  onClose: () => void;
  mailboxId: string;
  onSubscribed?: (feedId: string) => void;
}

const COLOR_OPTIONS = [
  { hex: "#2563EB", label: "Ocean Blue" },
  { hex: "#059669", label: "Emerald Green" },
  { hex: "#7C3AED", label: "Royal Violet" },
  { hex: "#E11D48", label: "Crimson Rose" },
  { hex: "#D97706", label: "Amber Orange" },
  { hex: "#0891B2", label: "Teal Cyan" },
  { hex: "#4F46E5", label: "Indigo" },
];

export const SubscribeFromUrlModal: Component<SubscribeFromUrlModalProps> = (props) => {
  const [url, setUrl] = createSignal("");
  const [name, setName] = createSignal("");
  const [selectedColor, setSelectedColor] = createSignal(COLOR_OPTIONS[0].hex);
  const [refreshMinutes, setRefreshMinutes] = createSignal(1440); // daily
  const [isFetching, setIsFetching] = createSignal(false);
  const [previewEvents, setPreviewEvents] = createSignal<CachedUrlEvent[] | null>(null);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  const [warningMsg, setWarningMsg] = createSignal<string | null>(null);

  let urlInputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (props.isOpen) {
      setUrl("");
      setName("");
      setSelectedColor(COLOR_OPTIONS[0].hex);
      setRefreshMinutes(1440);
      setIsFetching(false);
      setPreviewEvents(null);
      setErrorMsg(null);
      setWarningMsg(null);
      setTimeout(() => urlInputRef?.focus(), 50);
    }
  });

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  async function handleFetchPreview() {
    setErrorMsg(null);
    setWarningMsg(null);
    const rawUrl = url().trim();

    if (!isValidCalendarUrl(rawUrl)) {
      setErrorMsg("Please enter a valid calendar URL starting with http://, https://, or webcal://");
      return;
    }

    setIsFetching(true);
    try {
      const res = await fetchAndParseUrlFeed(rawUrl);
      if (res.title && !name()) {
        setName(res.title);
      }
      setPreviewEvents(res.events);
      if (res.events.length === 0) {
        setWarningMsg("Connected successfully, but no events were found in the feed.");
      }
    } catch (err: any) {
      setWarningMsg(
        "Could not preview remote feed directly (may be blocked by CORS). You can still subscribe and feeds will sync when accessible."
      );
      setPreviewEvents([]);
    } finally {
      setIsFetching(false);
    }
  }

  async function handleSubscribe() {
    setErrorMsg(null);
    const rawUrl = url().trim();

    if (!isValidCalendarUrl(rawUrl)) {
      setErrorMsg("Please enter a valid calendar URL starting with http://, https://, or webcal://");
      return;
    }

    if (!props.mailboxId) {
      setErrorMsg("No active mailbox selected.");
      return;
    }

    let eventsToSave = previewEvents() || [];

    // If not previewed yet, attempt one fetch or subscribe gracefully
    if (previewEvents() === null) {
      setIsFetching(true);
      try {
        const res = await fetchAndParseUrlFeed(rawUrl);
        if (res.title && !name()) {
          setName(res.title);
        }
        eventsToSave = res.events;
      } catch (err) {
        // Fallback: save subscription with empty events
        eventsToSave = [];
      } finally {
        setIsFetching(false);
      }
    }

    const sub = subscribeUrlFeed(props.mailboxId, {
      url: rawUrl,
      name: name().trim() || undefined,
      color: selectedColor(),
      refreshIntervalMinutes: refreshMinutes(),
      initialEvents: eventsToSave,
    });

    props.onSubscribed?.(sub.calendarId);
    props.onClose();
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
        data-testid="subscribe-from-url-modal"
      >
        <div
          class="w-full max-w-lg rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] p-5 sm:p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150"
          role="dialog"
          aria-modal="true"
          aria-labelledby="subscribe-from-url-title"
        >
          {/* Header */}
          <div class="flex items-center justify-between pb-3.5 border-b border-[#E2DFD8] dark:border-[#2A2D35]">
            <div class="flex items-center gap-2.5">
              <div class="w-8 h-8 rounded-lg bg-[#F2E8E2] dark:bg-[#3D2E28] text-[#9E725F] dark:text-[#D1A796] flex items-center justify-center">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </div>
              <div>
                <h2 id="subscribe-from-url-title" class="text-sm sm:text-base font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  Subscribe to Calendar from URL
                </h2>
                <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                  Subscribe to any public or webcal iCalendar (.ics) feed
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => props.onClose()}
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition-colors cursor-pointer"
              aria-label="Close dialog"
              data-testid="subscribe-url-close-btn"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Form Body */}
          <div class="mt-4 space-y-4">
            {/* Error & Warning Banners */}
            <Show when={errorMsg()}>
              <div class="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
                {errorMsg()}
              </div>
            </Show>
            <Show when={warningMsg()}>
              <div class="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs">
                {warningMsg()}
              </div>
            </Show>

            {/* URL Input */}
            <div>
              <label for="subscribe-url-input" class="block text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                Calendar URL <span class="text-rose-500">*</span>
              </label>
              <div class="flex gap-2">
                <input
                  id="subscribe-url-input"
                  ref={urlInputRef}
                  type="text"
                  placeholder="https://example.com/calendar.ics or webcal://..."
                  value={url()}
                  onInput={(e) => setUrl(e.currentTarget.value)}
                  class="flex-1 px-3 py-2 text-xs rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 transition-all font-mono"
                  data-testid="subscribe-url-input"
                />
                <button
                  type="button"
                  onClick={handleFetchPreview}
                  disabled={isFetching() || !url().trim()}
                  class="px-3 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                  data-testid="subscribe-url-preview-btn"
                >
                  {isFetching() ? "Testing..." : "Test Feed"}
                </button>
              </div>
              <p class="text-[10px] text-[#6F7173] dark:text-[#878A8E] mt-1">
                Supports webcal://, https://, and http:// endpoints containing valid iCalendar data.
              </p>
            </div>

            {/* Calendar Name */}
            <div>
              <label for="subscribe-url-name-input" class="block text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                Calendar Name (Optional)
              </label>
              <input
                id="subscribe-url-name-input"
                type="text"
                placeholder="e.g. Company Schedule, Sports Team"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                class="w-full px-3 py-2 text-xs rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 transition-all"
                data-testid="subscribe-url-name-input"
              />
            </div>

            {/* Color & Refresh Row */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Color Picker */}
              <div>
                <label class="block text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1.5">
                  Calendar Color
                </label>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <For each={COLOR_OPTIONS}>
                    {(c) => (
                      <button
                        type="button"
                        onClick={() => setSelectedColor(c.hex)}
                        class={`w-6 h-6 rounded-full transition-transform cursor-pointer flex items-center justify-center ${
                          selectedColor() === c.hex ? "scale-115 ring-2 ring-offset-2 ring-[#9E725F]" : "hover:scale-105"
                        }`}
                        style={{ "background-color": c.hex }}
                        title={c.label}
                        aria-label={c.label}
                      />
                    )}
                  </For>
                </div>
              </div>

              {/* Refresh Interval */}
              <div>
                <label for="subscribe-url-refresh-select" class="block text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] mb-1">
                  Auto-Refresh Frequency
                </label>
                <select
                  id="subscribe-url-refresh-select"
                  value={refreshMinutes()}
                  onChange={(e) => setRefreshMinutes(Number(e.currentTarget.value))}
                  class="w-full px-3 py-2 text-xs rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#ECEBE8] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 cursor-pointer"
                  data-testid="subscribe-url-refresh-select"
                >
                  <option value={0}>Manual Only</option>
                  <option value={60}>Every hour</option>
                  <option value={1440}>Every day (Recommended)</option>
                  <option value={10080}>Every week</option>
                </select>
              </div>
            </div>

            {/* Feed Preview if tested */}
            <Show when={previewEvents() && (previewEvents()?.length || 0) > 0}>
              <div class="p-3 rounded-xl bg-[#FAF9F5] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2A2D35] space-y-2">
                <div class="flex items-center justify-between text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  <span>Feed Preview</span>
                  <span class="text-[10px] text-[#6F7173]">{previewEvents()?.length} events found</span>
                </div>
                <div class="max-h-28 overflow-y-auto space-y-1 pr-1">
                  <For each={previewEvents()?.slice(0, 5) || []}>
                    {(ev) => (
                      <div class="flex items-center justify-between text-[11px] p-1.5 rounded bg-white dark:bg-[#1E1F23] border border-[#E2DFD8]/50 dark:border-[#2A2D35]/50">
                        <span class="font-medium text-[#2B2C2D] dark:text-[#ECEBE8] truncate pr-2">{ev.summary}</span>
                        <span class="text-[10px] text-[#6F7173] shrink-0">
                          {new Date(ev.startTime).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          {/* Footer Actions */}
          <div class="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-[#E2DFD8] dark:border-[#2A2D35]">
            <button
              type="button"
              onClick={() => props.onClose()}
              class="px-3.5 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={isFetching() || !url().trim()}
              class="px-4 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold transition-all shadow-sm cursor-pointer disabled:opacity-50"
              data-testid="subscribe-url-confirm-btn"
            >
              {isFetching() ? "Connecting..." : "Subscribe"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
