import { Component, createSignal, createEffect, Show, For } from "solid-js";
import { parseIcs, ParsedIcsEvent, ParsedIcs } from "../../utils/calendarIcs";

export interface InvitationCardProps {
  icsString: string;
  currentUserEmail?: string;
  messageSender?: string;
  mailboxId?: string;
  onRsvp?: (status: "ACCEPTED" | "TENTATIVE" | "DECLINED", event: ParsedIcsEvent) => Promise<void>;
}

export const InvitationCard: Component<InvitationCardProps> = (props) => {
  const [parsedIcs, setParsedIcs] = createSignal<ParsedIcs | null>(null);
  const [primaryEvent, setPrimaryEvent] = createSignal<ParsedIcsEvent | null>(null);
  const [userRsvpStatus, setUserRsvpStatus] = createSignal<"ACCEPTED" | "TENTATIVE" | "DECLINED" | "NEEDS-ACTION">("NEEDS-ACTION");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [actionFeedback, setActionFeedback] = createSignal<string | null>(null);
  const [isDetailsExpanded, setIsDetailsExpanded] = createSignal(false);

  const method = () => primaryEvent()?.method || parsedIcs()?.method || "REQUEST";
  const isCancelled = () => method() === "CANCEL" || primaryEvent()?.status === "CANCELLED";
  const isUpdate = () => (primaryEvent()?.sequence || 0) > 0 && method() === "REQUEST";
  const isReply = () => method() === "REPLY";
  const isSenderMismatch = () => {
    if (!props.messageSender || !primaryEvent()?.organizer?.email) return false;
    const s = props.messageSender.toLowerCase().trim();
    const o = primaryEvent()!.organizer!.email.toLowerCase().trim();
    return s !== o;
  };

  createEffect(() => {
    if (!props.icsString) {
      setParsedIcs(null);
      setPrimaryEvent(null);
      return;
    }

    try {
      const parsed = parseIcs(props.icsString);
      setParsedIcs(parsed);
      if (parsed.events.length > 0) {
        const ev = parsed.events[0];
        setPrimaryEvent(ev);

        // Detect current user's RSVP status if listed in attendees
        if (props.currentUserEmail) {
          const userLower = props.currentUserEmail.toLowerCase();
          const att = ev.attendees.find((a) => a.email.toLowerCase() === userLower);
          if (att?.partstat) {
            setUserRsvpStatus(att.partstat);
          } else {
            setUserRsvpStatus("NEEDS-ACTION");
          }
        }
      }
    } catch (e) {
      console.warn("[InvitationCard] Failed to parse ICS:", e);
      setParsedIcs(null);
      setPrimaryEvent(null);
    }
  });

  async function handleRsvpClick(status: "ACCEPTED" | "TENTATIVE" | "DECLINED") {
    const ev = primaryEvent();
    if (!ev || isSubmitting()) return;

    setIsSubmitting(true);
    setActionFeedback(null);
    try {
      if (props.onRsvp) {
        await props.onRsvp(status, ev);
      }
      setUserRsvpStatus(status);
      setActionFeedback(
        status === "ACCEPTED"
          ? "Invitation accepted and added to your calendar."
          : status === "TENTATIVE"
          ? "Tentatively accepted and marked on your calendar."
          : "Invitation declined."
      );
    } catch (err: any) {
      console.error("[InvitationCard] RSVP error:", err);
      setActionFeedback(`Failed to update RSVP: ${err?.message || "Unknown error"}`);
    } finally {
      setIsSubmitting(false);
    }
  }

  function formatDateTimeRange(start: Date, end: Date, isAllDay: boolean, tz?: string): string {
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
    };

    if (isAllDay) {
      return `${start.toLocaleDateString(undefined, dateOptions)} (All day)`;
    }

    const startDayStr = start.toLocaleDateString(undefined, dateOptions);
    const endDayStr = end.toLocaleDateString(undefined, dateOptions);
    const startTimeStr = start.toLocaleTimeString(undefined, timeOptions);
    const endTimeStr = end.toLocaleTimeString(undefined, timeOptions);

    const tzStr = tz ? ` (${tz})` : "";

    if (startDayStr === endDayStr) {
      return `${startDayStr} · ${startTimeStr} – ${endTimeStr}${tzStr}`;
    }
    return `${startDayStr} ${startTimeStr} – ${endDayStr} ${endTimeStr}${tzStr}`;
  }

  return (
    <Show when={primaryEvent()}>
      {(ev) => (
        <div
          data-testid="calendar-invitation-card"
          class="my-4 p-4 sm:p-5 rounded-2xl border bg-white dark:bg-[#1E2025] shadow-xs transition-all duration-200"
          classList={{
            "border-[#E2DFD8] dark:border-[#2E3138]": !isCancelled(),
            "border-rose-200 dark:border-rose-900/50 bg-rose-50/20 dark:bg-rose-950/10": isCancelled(),
          }}
        >
          {/* Header Badge & Method Label */}
          <div class="flex items-center justify-between gap-3 mb-3 pb-3 border-b border-[#F0EDE8] dark:border-[#2A2D34]">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-xl bg-[#FAF6F3] dark:bg-[#2A2724] border border-[#EBE3DE] dark:border-[#3D3530] flex items-center justify-center text-[#A27561] flex-shrink-0">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div>
                <span
                  class="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full"
                  classList={{
                    "bg-[#F3ECE8] text-[#A27561] dark:bg-[#2E2824] dark:text-[#C59B88]": !isCancelled() && !isUpdate() && !isReply(),
                    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300": isUpdate(),
                    "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300": isCancelled(),
                    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300": isReply(),
                  }}
                >
                  {isCancelled()
                    ? "Event Cancelled"
                    : isUpdate()
                    ? `Updated Invitation (v${ev().sequence})`
                    : isReply()
                    ? "RSVP Response"
                    : "Calendar Invitation"}
                </span>
              </div>
            </div>

            {/* RSVP status badge */}
            <Show when={!isCancelled() && !isReply()}>
                <div class="flex items-center gap-1.5 text-xs font-medium">
                  <Show when={userRsvpStatus() === "ACCEPTED"}>
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40">
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Accepted
                    </span>
                  </Show>
                  <Show when={userRsvpStatus() === "TENTATIVE"}>
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40">
                      Tentative
                    </span>
                  </Show>
                  <Show when={userRsvpStatus() === "DECLINED"}>
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/40">
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      Declined
                    </span>
                  </Show>
                  <Show when={userRsvpStatus() === "NEEDS-ACTION"}>
                    <span class="text-xs text-[#878A8E] dark:text-[#A1A1AA]">Response requested</span>
                  </Show>
                </div>
              </Show>
            </div>

            {/* Authenticity / Sender Mismatch Warning */}
            <Show when={isSenderMismatch()}>
              <div
                data-testid="invitation-authenticity-warning"
                class="mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2] flex-shrink-0 mt-0.5" viewBox="0 0 24 24">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <div>
                  <span class="font-semibold">Authenticity Notice:</span> The calendar organizer ({primaryEvent()?.organizer?.email}) differs from the email sender ({props.messageSender}).
                </div>
              </div>
            </Show>

            {/* Event Details */}
            <div class="space-y-2.5">
              <h2 class="text-base sm:text-lg font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] leading-tight">
                {ev().summary || "(Untitled Event)"}
              </h2>

              {/* Recurrence Instance Badge if Single Exception */}
              <Show when={ev().recurrenceId}>
                <div class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/40">
                  <span>Single Occurrence Exception</span>
                </div>
              </Show>

              {/* Time */}
              <div class="flex items-center gap-2 text-xs sm:text-sm text-[#464748] dark:text-[#D1D5DB]">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0 text-[#878A8E]" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>{formatDateTimeRange(ev().startTime, ev().endTime, ev().isAllDay, ev().timezone)}</span>
              </div>

              {/* Recurrence Rule */}
              <Show when={ev().rrule}>
                <div class="flex items-center gap-2 text-xs text-[#6E7075] dark:text-[#9CA3AF] pl-6">
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                    <polyline points="17 1 21 5 17 9" />
                    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                    <polyline points="7 23 3 19 7 15" />
                    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                  </svg>
                  <span>Repeats: {ev().rrule}</span>
                </div>
              </Show>

              {/* Location */}
              <Show when={ev().location}>
                <div class="flex items-center gap-2 text-xs sm:text-sm text-[#464748] dark:text-[#D1D5DB]">
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0 text-[#878A8E]" viewBox="0 0 24 24">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  <span>{ev().location}</span>
                </div>
              </Show>

              {/* Meeting URL (Only safe HTTP/HTTPS schemes rendered) */}
              <Show when={ev().url && /^https?:\/\//i.test(ev().url || "")}>
                <div class="flex items-center gap-2 text-xs sm:text-sm text-[#464748] dark:text-[#D1D5DB]">
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0 text-[#878A8E]" viewBox="0 0 24 24">
                    <polygon points="23 7 16 12 23 17 23 7" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  <a
                    href={ev().url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-[#A27561] hover:underline truncate max-w-sm"
                  >
                    {ev().url}
                  </a>
                </div>
              </Show>

              {/* Organizer */}
              <Show when={ev().organizer}>
                <div class="flex items-center gap-2 text-xs text-[#6E7075] dark:text-[#9CA3AF]">
                  <span class="font-medium">Organizer:</span>
                  <span>{ev().organizer?.name ? `${ev().organizer?.name} (${ev().organizer?.email})` : ev().organizer?.email}</span>
                </div>
              </Show>

              {/* Description preview / collapsible */}
              <Show when={ev().description}>
                <div class="mt-2 pt-2 border-t border-[#F0EDE8] dark:border-[#2A2D34]">
                  <p class="text-xs text-[#464748] dark:text-[#D1D5DB] whitespace-pre-wrap">
                    {isDetailsExpanded() || (ev().description?.length || 0) < 180
                      ? ev().description
                      : `${ev().description?.slice(0, 180)}…`}
                  </p>
                  <Show when={(ev().description?.length || 0) >= 180}>
                    <button
                      type="button"
                      onClick={() => setIsDetailsExpanded(!isDetailsExpanded())}
                      class="mt-1 text-[11px] font-medium text-[#A27561] hover:underline cursor-pointer"
                    >
                      {isDetailsExpanded() ? "Show less" : "Show more"}
                    </button>
                  </Show>
                </div>
              </Show>
            </div>

            {/* Action Buttons for Invitations */}
            <Show when={!isCancelled() && !isReply()}>
              <div class="mt-4 pt-3 border-t border-[#F0EDE8] dark:border-[#2A2D34] flex flex-wrap items-center gap-2">
                <span class="text-xs font-medium text-[#6E7075] dark:text-[#9CA3AF] mr-1">Going?</span>
                <button
                  type="button"
                  data-testid="invitation-accept-btn"
                  onClick={() => handleRsvpClick("ACCEPTED")}
                  disabled={isSubmitting()}
                  class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer border shadow-2xs"
                  classList={{
                    "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700": userRsvpStatus() === "ACCEPTED",
                    "bg-white dark:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] border-[#E2DFD8] dark:border-[#3E424B] hover:border-emerald-600 hover:text-emerald-600": userRsvpStatus() !== "ACCEPTED",
                  }}
                >
                  Yes (Accept)
                </button>
                <button
                  type="button"
                  data-testid="invitation-tentative-btn"
                  onClick={() => handleRsvpClick("TENTATIVE")}
                  disabled={isSubmitting()}
                  class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer border shadow-2xs"
                  classList={{
                    "bg-amber-600 text-white border-amber-600 hover:bg-amber-700": userRsvpStatus() === "TENTATIVE",
                    "bg-white dark:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] border-[#E2DFD8] dark:border-[#3E424B] hover:border-amber-600 hover:text-amber-600": userRsvpStatus() !== "TENTATIVE",
                  }}
                >
                  Maybe (Tentative)
                </button>
                <button
                  type="button"
                  data-testid="invitation-decline-btn"
                  onClick={() => handleRsvpClick("DECLINED")}
                  disabled={isSubmitting()}
                  class="px-3.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer border shadow-2xs"
                  classList={{
                    "bg-rose-600 text-white border-rose-600 hover:bg-rose-700": userRsvpStatus() === "DECLINED",
                    "bg-white dark:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] border-[#E2DFD8] dark:border-[#3E424B] hover:border-rose-600 hover:text-rose-600": userRsvpStatus() !== "DECLINED",
                  }}
                >
                  No (Decline)
                </button>
              </div>
            </Show>

            {/* Reply Display Info */}
            <Show when={isReply()}>
              <div class="mt-3 pt-3 border-t border-[#F0EDE8] dark:border-[#2A2D34] text-xs text-[#6E7075] dark:text-[#9CA3AF]">
                <span>
                  {ev().attendees[0]?.name || ev().attendees[0]?.email || "The attendee"} responded:{" "}
                  <strong class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
                    {ev().attendees[0]?.partstat || "Replied"}
                  </strong>
                </span>
              </div>
            </Show>

            {/* Action Feedback Banner */}
            <Show when={actionFeedback()}>
              <div
                data-testid="invitation-action-feedback"
                class="mt-3 text-xs px-3 py-1.5 rounded-lg bg-[#FAF6F3] dark:bg-[#2A2724] text-[#A27561] border border-[#EBE3DE] dark:border-[#3D3530]"
              >
                {actionFeedback()}
              </div>
            </Show>
          </div>
        )}
      </Show>
    );
  };
