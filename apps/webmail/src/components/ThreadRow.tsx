import { Component, Show } from "solid-js";
import { ThreadSummary } from "../api";
import { ProfileAvatar } from "./ProfileAvatar";
import { formatSmartDate } from "./MessageRow";

export function formatParticipants(parts: string[]): string {
  if (!parts || parts.length === 0) return "(no sender)";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts.join(", ");
  return `${parts[0]}, ${parts[1]} +${parts.length - 2}`;
}

export function getUnreadClass(unreadCount: number): string {
  return unreadCount > 0
    ? "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
    : "font-normal text-[#6F7173] dark:text-[#8A8E94]";
}

export interface ThreadRowProps {
  thread: ThreadSummary;
  expanded: boolean;
  onClick: () => void;
  subject?: string;
  snippet?: string;
  density?: "compact" | "cozy" | "comfortable";
  isSplit?: boolean;
}

export const ThreadRow: Component<ThreadRowProps> = (props) => {
  const isUnread = () => props.thread.unread_count > 0;

  const densityPadding = () => {
    if (props.density === "compact") return props.isSplit ? "py-2 px-3" : "py-1.5 px-3";
    if (props.density === "comfortable") return props.isSplit ? "py-3 px-4" : "py-3 px-4";
    return props.isSplit ? "py-2.5 px-3.5" : "py-2 px-3.5";
  };

  const participantLabel = () => formatParticipants(props.thread.participants);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick();
        }
      }}
      aria-expanded={props.expanded}
      aria-label={`Thread with ${participantLabel()}, ${props.thread.message_count} messages, ${props.subject || "No subject"}`}
      class={`group relative cursor-pointer border-b border-[#E2DFD8]/60 dark:border-[#2A2D35] transition-all select-none min-w-0 overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${densityPadding()} ${
        props.expanded
          ? "bg-[#F3ECE8] dark:bg-[#2D2522] border-l-4 border-l-[#A27561]"
          : isUnread()
          ? "bg-white dark:bg-[#1E2025] hover:bg-[#FAF9F6] dark:hover:bg-[#252830]"
          : "bg-[#FAF9F6]/50 dark:bg-[#1A1B1E]/40 hover:bg-[#FAF9F6] dark:hover:bg-[#252830]"
      }`}
    >
      <div class="flex items-center gap-3 min-w-0 overflow-hidden">
        {/* Unread indicator dot */}
        <Show
          when={isUnread()}
          fallback={<span class="w-1.5 h-1.5 flex-shrink-0"></span>}
        >
          <span
            class="w-1.5 h-1.5 rounded-full bg-[#A27561] flex-shrink-0"
            title="Unread"
          ></span>
        </Show>

        {/* Sender / Participants cluster */}
        <div class="w-48 sm:w-56 min-w-0 flex-shrink-0 flex items-center gap-2 truncate">
          <Show when={props.thread.participants && props.thread.participants.length > 0}>
            <ProfileAvatar email={props.thread.participants[0]} size="xs" />
          </Show>
          <span
            class={`truncate font-sans text-sm ${getUnreadClass(props.thread.unread_count)}`}
          >
            {participantLabel()}
          </span>
          <Show when={props.thread.message_count > 1}>
            <span class="text-[11px] font-mono font-medium px-1.5 py-0.2 rounded-full bg-[#F0EEE9] dark:bg-[#2E3138] text-[#6F7173] dark:text-[#A1A1AA] flex-shrink-0">
              {props.thread.message_count}
            </span>
          </Show>
        </div>

        {/* Subject + Snippet */}
        <div class="flex-1 min-w-0 overflow-hidden text-sm flex items-center gap-2">
          <span
            class={`truncate ${
              isUnread()
                ? "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                : "font-normal text-[#2B2C2D] dark:text-[#E2DFD8]"
            }`}
          >
            {props.subject || "(Thread conversation)"}
          </span>
          <Show when={props.snippet}>
            <span class="truncate text-xs text-[#878A8E] hidden sm:inline">
              — {props.snippet}
            </span>
          </Show>
        </div>

        {/* Star indicator */}
        <Show when={props.thread.is_starred}>
          <span class="text-amber-500 flex-shrink-0" title="Starred">
            <svg class="w-3.5 h-3.5 fill-amber-400 stroke-amber-500 stroke-[1.4]" viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </span>
        </Show>

        {/* Attachment indicator */}
        <Show when={props.thread.has_attachments}>
          <span class="text-[#878A8E] flex-shrink-0" title="Has attachments">
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </span>
        </Show>

        {/* Timestamp */}
        <span class="text-xs text-[#878A8E] flex-shrink-0 font-sans">
          {formatSmartDate(props.thread.latest_at)}
        </span>
      </div>
    </div>
  );
};
