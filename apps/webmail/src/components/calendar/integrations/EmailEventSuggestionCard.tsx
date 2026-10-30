/**
 * BYOS Calendar - Category 13: Email Event Suggestion Card
 * Displays reviewable suggestions directly in ReadingPane with provenance, actions, and deduplication.
 */

import { Component, Show, createSignal } from "solid-js";
import { DetectedEmailEvent } from "../../../utils/calendarEmailExtractor";

interface EmailEventSuggestionCardProps {
  event: DetectedEmailEvent;
  isAdded: boolean;
  onAdd: (event: DetectedEmailEvent) => Promise<void> | void;
  onDismiss: (event: DetectedEmailEvent) => void;
  onViewInCalendar?: () => void;
  onRemoveFromCalendar?: (event: DetectedEmailEvent) => Promise<void> | void;
}

export const EmailEventSuggestionCard: Component<EmailEventSuggestionCardProps> = (props) => {
  const [isAdding, setIsAdding] = createSignal(false);
  const [isRemoving, setIsRemoving] = createSignal(false);

  async function handleAdd() {
    setIsAdding(true);
    try {
      await props.onAdd(props.event);
    } finally {
      setIsAdding(false);
    }
  }

  async function handleRemove() {
    if (!props.onRemoveFromCalendar) return;
    setIsRemoving(true);
    try {
      await props.onRemoveFromCalendar(props.event);
    } finally {
      setIsRemoving(false);
    }
  }

  // Format date display
  function formatEventRange(startIso: string, endIso: string): string {
    try {
      const s = new Date(startIso);
      const e = new Date(endIso);
      const dateStr = s.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const startTimeStr = s.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      const endTimeStr = e.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `${dateStr} • ${startTimeStr} - ${endTimeStr}`;
    } catch {
      return startIso;
    }
  }

  return (
    <div
      class="mb-4 p-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#1E1F23] shadow-sm transition-all"
      data-testid="email-event-suggestion-card"
    >
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
        <div class="flex items-center gap-2">
          {/* Category Icon */}
          <div class="w-8 h-8 rounded-lg bg-[#9E725F]/10 dark:bg-[#9E725F]/20 text-[#9E725F] dark:text-[#D1A796] flex items-center justify-center flex-shrink-0">
            <Show when={props.event.category === "flight"}>
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3.5c-.5-.5-2.5 0-4 1.5L13.5 8.5 5.3 6.7c-.5-.1-.9.1-1.2.4L3 8.2l6.2 3.8L5.5 15.7 3 15.5l-1.5 1.5 3.5 2 2 3.5 1.5-1.5-.2-2.5 3.7-3.7 3.8 6.2 1.1-1.1c.3-.3.5-.7.4-1.2z" />
              </svg>
            </Show>
            <Show when={props.event.category === "hotel"}>
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 21h18M19 21v-4a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v4M9 3v4M15 3v4M3 7h18a2 2 0 0 1 2 2v2H1V9a2 2 0 0 1 2-2z" />
              </svg>
            </Show>
            <Show when={props.event.category === "restaurant"}>
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 2v20M2 12h8a4 4 0 0 1 4 4v6M6 2v7M2 4h8" />
              </svg>
            </Show>
            <Show when={props.event.category === "ticket"}>
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v2z" />
              </svg>
            </Show>
            <Show when={props.event.category === "event"}>
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </Show>
          </div>

          <div>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[11px] font-semibold uppercase tracking-wider text-[#9E725F] dark:text-[#D1A796]">
                Suggested from email
              </span>
              <span class="text-[11px] text-[#A3A3A3]">•</span>
              <span
                class="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#464748] dark:text-[#ECEBE8]"
                data-testid="suggestion-category-badge"
              >
                {props.event.categoryLabel}
              </span>
              <Show when={props.event.provider}>
                <span class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                  via {props.event.provider}
                </span>
              </Show>
            </div>
          </div>
        </div>

        {/* Status / Cancellation Badge */}
        <div class="flex items-center gap-2">
          <Show when={props.event.isCancellation}>
            <span
              class="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900/50"
              data-testid="suggestion-cancellation-notice"
            >
              Cancellation Notice
            </span>
          </Show>

          <Show when={props.isAdded}>
            <span
              class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 flex items-center gap-1"
              data-testid="suggestion-added-badge"
            >
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Added to Calendar
            </span>
          </Show>
        </div>
      </div>

      {/* Event Details */}
      <div class="space-y-1 mb-3">
        <h4
          class="text-sm font-bold text-[#2B2C2D] dark:text-[#ECEBE8]"
          data-testid="suggestion-title"
        >
          {props.event.title}
        </h4>
        <div
          class="text-xs text-[#6F7173] dark:text-[#878A8E] flex items-center gap-1"
          data-testid="suggestion-datetime"
        >
          <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{formatEventRange(props.event.startTime, props.event.endTime)}</span>
        </div>
        <Show when={props.event.location}>
          <div class="text-xs text-[#6F7173] dark:text-[#878A8E] flex items-center gap-1">
            <svg class="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>{props.event.location}</span>
          </div>
        </Show>
        <Show when={props.event.confirmationCode}>
          <div
            class="text-xs text-[#464748] dark:text-[#A1A1AA] flex items-center gap-1.5 pt-0.5"
            data-testid="suggestion-confirmation-code"
          >
            <span class="font-semibold text-[#6F7173] dark:text-[#878A8E]">Confirmation Code:</span>
            <span class="font-mono bg-[#F0EEE9] dark:bg-[#2A2D35] px-1.5 py-0.5 rounded text-[11px] font-bold text-[#2B2C2D] dark:text-[#ECEBE8]">
              {props.event.confirmationCode}
            </span>
          </div>
        </Show>
      </div>

      {/* Actions */}
      <div class="flex items-center gap-2 pt-2 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60">
        <Show when={!props.isAdded}>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isAdding()}
            class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#9E725F] hover:bg-[#865E4D] text-white transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            data-testid="add-suggested-event-btn"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <line x1="12" y1="14" x2="12" y2="18" />
              <line x1="10" y1="16" x2="14" y2="16" />
            </svg>
            <span>{isAdding() ? "Adding..." : "Add to Calendar"}</span>
          </button>

          <button
            type="button"
            onClick={() => props.onDismiss(props.event)}
            class="px-3 py-1.5 rounded-lg text-xs font-medium text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] transition cursor-pointer"
            data-testid="dismiss-suggested-event-btn"
          >
            Dismiss
          </button>
        </Show>

        <Show when={props.isAdded}>
          <Show when={props.onViewInCalendar}>
            <button
              type="button"
              onClick={props.onViewInCalendar}
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#F0EEE9] dark:bg-[#2A2D35] text-[#2B2C2D] dark:text-[#ECEBE8] hover:bg-[#E2DFD8] dark:hover:bg-[#343842] transition flex items-center gap-1.5 cursor-pointer"
              data-testid="view-suggested-event-btn"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span>View in Calendar</span>
            </button>
          </Show>

          <Show when={props.event.isCancellation && props.onRemoveFromCalendar}>
            <button
              type="button"
              onClick={handleRemove}
              disabled={isRemoving()}
              class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              data-testid="remove-suggested-event-btn"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              <span>{isRemoving() ? "Removing..." : "Remove from Calendar"}</span>
            </button>
          </Show>
        </Show>
      </div>
    </div>
  );
};
