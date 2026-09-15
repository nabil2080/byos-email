import { Component, Show, For } from "solid-js";
import { DisplayMessage } from "./MessageList";
import { MailboxLabel } from "../api";
import { ProfileAvatar } from "./ProfileAvatar";
import { AttachmentBadge } from "./AttachmentBadge";

interface MessageRowProps {
  message: DisplayMessage;
  isSelected: boolean;
  isChecked: boolean;
  isSplit: boolean;
  density?: "compact" | "cozy" | "comfortable";
  selectedIds?: Set<string>;
  onSelect: (msg: DisplayMessage) => void;
  onToggleCheck: (msg: DisplayMessage, checked: boolean) => void;
  onToggleStarred: (msg: DisplayMessage) => void;
  onToggleRead: (msg: DisplayMessage) => void;
  onArchive: (msg: DisplayMessage) => void;
  onTrash: (msg: DisplayMessage) => void;
  onDeleteForever?: (msg: DisplayMessage) => void;
  labels?: MailboxLabel[];
}

export function formatSmartDate(
  dateStr: string,
  timeFormat?: "12h" | "24h",
  locale?: string
): string {
  const tf = timeFormat || (typeof window !== "undefined" ? (localStorage.getItem("byos_time_format") as any) || "12h" : "12h");
  const lang = locale || (typeof window !== "undefined" ? localStorage.getItem("byos_language") || "en" : "en");
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) {
    return d.toLocaleTimeString(lang, {
      hour: "numeric",
      minute: "2-digit",
      hour12: tf === "12h",
    });
  }

  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString(lang, { month: "short", day: "numeric" });
  }

  return d.toLocaleDateString(lang, { month: "short", day: "numeric", year: "2-digit" });
}

export const MessageRow: Component<MessageRowProps> = (props) => {
  const densityPadding = () => {
    if (props.density === "compact") return props.isSplit ? "py-2 px-3" : "py-1.5 px-3";
    if (props.density === "comfortable") return props.isSplit ? "py-3 px-4" : "py-3 px-4";
    return props.isSplit ? "py-2.5 px-3.5" : "py-2 px-3.5";
  };

  const formattedDate = () => formatSmartDate(props.message.date);

  const handleDragStart = (e: DragEvent) => {
    if (!e.dataTransfer) return;
    const ids =
      props.isChecked && props.selectedIds && props.selectedIds.size > 0
        ? Array.from(props.selectedIds)
        : [props.message.id];

    e.dataTransfer.setData("application/json", JSON.stringify({ messageIds: ids }));
    e.dataTransfer.effectAllowed = "all";

    // Drag Ghost Pill: "Move N conversation(s)"
    const count = ids.length;
    const ghost = document.createElement("div");
    ghost.textContent = `Move ${count} conversation${count > 1 ? "s" : ""}`;
    ghost.style.position = "absolute";
    ghost.style.top = "-9999px";
    ghost.style.left = "-9999px";
    ghost.style.backgroundColor = "#A27561";
    ghost.style.color = "#FFFFFF";
    ghost.style.padding = "6px 14px";
    ghost.style.borderRadius = "9999px";
    ghost.style.fontSize = "12px";
    ghost.style.fontWeight = "600";
    ghost.style.boxShadow = "0 4px 12px rgba(0,0,0,0.18)";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "9999";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2 || 40, ghost.offsetHeight / 2 || 14);
    setTimeout(() => {
      if (document.body.contains(ghost)) {
        document.body.removeChild(ghost);
      }
    }, 0);
  };

  return (
    <div
      draggable={true}
      onDragStart={handleDragStart}
      onClick={() => props.onSelect(props.message)}
      class={`group relative cursor-pointer border-b border-[#E2DFD8]/60 dark:border-[#2A2D35] transition-all select-none min-w-0 overflow-hidden ${densityPadding()} ${
        props.isSelected
          ? "bg-[#F3ECE8] dark:bg-[#2D2522] border-l-4 border-l-[#A27561]"
          : props.isChecked
          ? "bg-[#F8F5F2] dark:bg-[#26282E]"
          : props.message.read
          ? "bg-white dark:bg-[#1E2025] hover:bg-[#FAF9F6] dark:hover:bg-[#252830]"
          : "bg-white dark:bg-[#1E2025] hover:bg-[#FAF9F6] dark:hover:bg-[#252830]"
      }`}
    >
      <Show
        when={props.isSplit}
        fallback={
          /* ── Full-Width Mode: Streamlined Single-Line Layout ── */
          <div class="flex items-center gap-3 min-w-0 overflow-hidden h-7">
            {/* Selection Checkbox */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleCheck(props.message, !props.isChecked);
              }}
              class="flex items-center justify-center p-0.5 cursor-pointer flex-shrink-0"
              title={props.isChecked ? "Deselect" : "Select"}
            >
              <input
                type="checkbox"
                checked={props.isChecked}
                onChange={() => {}}
                class="accent-[#A27561] w-4 h-4 cursor-pointer rounded pointer-events-none"
              />
            </div>

            {/* Star Icon (Enlarged SVG) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleStarred(props.message);
              }}
              class="transition flex-shrink-0 cursor-pointer p-0.5 text-[#878A8E] hover:text-amber-500 flex items-center justify-center"
              title={props.message.starred ? "Unstar" : "Star"}
            >
              <Show
                when={props.message.starred}
                fallback={
                  <svg class="w-[18px] h-[18px] stroke-current fill-none stroke-[1.6] text-[#878A8E] hover:text-amber-500 transition" viewBox="0 0 24 24">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                }
              >
                <svg class="w-[18px] h-[18px] text-amber-500 fill-amber-400 stroke-amber-500 stroke-[1.4] transition" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </Show>
            </button>

            {/* Unread Indicator Dot */}
            <Show
              when={!props.message.read}
              fallback={<span class="w-1.5 h-1.5 flex-shrink-0"></span>}
            >
              <span
                class="w-1.5 h-1.5 rounded-full bg-[#A27561] flex-shrink-0"
                title="Unread"
              ></span>
            </Show>

            {/* Sender Column with ProfileAvatar */}
            <div class="w-48 sm:w-56 min-w-0 flex-shrink-0 flex items-center gap-2 truncate">
              <ProfileAvatar email={props.message.sender} size="xs" />
              <span
                class={`truncate font-sans text-sm ${
                  props.message.read
                    ? "font-medium text-[#2B2C2D] dark:text-[#E2DFD8]"
                    : "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                {props.message.sender}
              </span>
            </div>

            {/* Colored Label Badges next to Sender */}
            <Show when={props.message.labelIds && props.message.labelIds.length > 0}>
              <div class="flex items-center gap-1 flex-shrink-0">
                <For each={props.message.labelIds}>
                  {(lid) => {
                    const lbl = () => props.labels?.find((l) => l.id === lid);
                    return (
                      <Show when={lbl()}>
                        <span
                          class="text-[10px] font-semibold text-white px-2 py-0.5 rounded-full shadow-2xs truncate max-w-[90px]"
                          style={{ "background-color": lbl()!.color }}
                          title={lbl()!.name}
                        >
                          {lbl()!.name}
                        </span>
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Streamlined Subject Line */}
            <div class="flex-1 min-w-0 overflow-hidden text-sm">
              <span
                class={`truncate block ${
                  props.message.read
                    ? "font-medium text-[#2B2C2D] dark:text-[#E2DFD8]"
                    : "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                {props.message.subject || "(No subject)"}
              </span>
            </div>

            {/* Unified File-Type Attachment Indicator */}
            <Show when={props.message.hasAttachments || (props.message.attachmentCount && props.message.attachmentCount > 0)}>
              <AttachmentBadge
                category={(props.message.attachmentTypes || [])[0]}
                count={props.message.attachmentCount}
                size="xs"
              />
            </Show>

            {/* Right Date & Floating Hover Action Pill (Fixed Width Slot) */}
            <div class="w-28 flex-shrink-0 relative flex items-center justify-end">
              {/* Monospace Short Date */}
              <span class="font-mono text-xs text-[#55575B] dark:text-[#9CA3AF] group-hover:invisible transition">
                {formattedDate()}
              </span>

              {/* Floating Hover Action Pill (Gmail style) */}
              <div class="absolute right-0 hidden group-hover:flex items-center gap-1 bg-white/95 dark:bg-[#26282E]/95 px-1.5 py-0.5 rounded-xl border border-[#E2DFD8] dark:border-[#3A3D46] shadow-sm z-10">
                {/* Single Contextual Read/Unread Smart Toggle */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggleRead(props.message);
                  }}
                  class="p-1 hover:bg-[#F3ECE8] rounded-lg text-[#5E6063] hover:text-[#A27561] transition cursor-pointer"
                  title={props.message.read ? "Mark as unread" : "Mark as read"}
                >
                  <Show
                    when={props.message.read}
                    fallback={
                      /* Open Envelope icon when message is unread -> clicking marks as read */
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    }
                  >
                    {/* Closed Envelope icon when message is read -> clicking marks as unread */}
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </Show>
                </button>

                {/* Quick Archive */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onArchive(props.message);
                  }}
                  class="p-1 hover:bg-[#F3ECE8] rounded-lg text-[#5E6063] hover:text-[#A27561] transition cursor-pointer"
                  title="Archive"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                </button>

                {/* Quick Trash or Delete Forever */}
                <Show
                  when={props.message.folder === "trash" && props.onDeleteForever}
                  fallback={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onTrash(props.message);
                      }}
                      class="p-1 hover:bg-rose-50 rounded-lg text-[#5E6063] hover:text-rose-600 transition cursor-pointer"
                      title="Move to Trash"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  }
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDeleteForever?.(props.message);
                    }}
                    class="p-1 hover:bg-rose-50 rounded-lg text-rose-600 hover:text-rose-700 transition cursor-pointer"
                    title="Delete Forever"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <line x1="10" y1="11" x2="14" y2="15" />
                      <line x1="14" y1="11" x2="10" y2="15" />
                    </svg>
                  </button>
                </Show>
              </div>
            </div>
          </div>
        }
      >
        {/* ── Split-Pane Mode: Stacked Compact Card Layout ── */}
        <div class="flex flex-col gap-1 min-w-0 overflow-hidden text-xs">
          {/* Top Line: Checkbox, Star, Sender, and Date/Actions */}
          <div class="flex items-center justify-between min-w-0 gap-2">
            <div class="flex items-center gap-2 min-w-0 overflow-hidden">
              {/* Selection Checkbox */}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  props.onToggleCheck(props.message, !props.isChecked);
                }}
                class="flex items-center justify-center p-0.5 cursor-pointer flex-shrink-0"
                title={props.isChecked ? "Deselect" : "Select"}
              >
                <input
                  type="checkbox"
                  checked={props.isChecked}
                  onChange={() => {}}
                  class="accent-[#A27561] w-3.5 h-3.5 cursor-pointer rounded pointer-events-none"
                />
              </div>

              {/* Star Icon (Enlarged SVG) */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onToggleStarred(props.message);
                }}
                class="transition flex-shrink-0 cursor-pointer p-0.5 text-[#878A8E] hover:text-amber-500 flex items-center justify-center"
                title={props.message.starred ? "Unstar" : "Star"}
              >
                <Show
                  when={props.message.starred}
                  fallback={
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.6] text-[#878A8E] hover:text-amber-500 transition" viewBox="0 0 24 24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  }
                >
                  <svg class="w-4 h-4 text-amber-500 fill-amber-400 stroke-amber-500 stroke-[1.4] transition" viewBox="0 0 24 24">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </Show>
              </button>

              {/* Unread Dot */}
              <Show
                when={!props.message.read}
                fallback={<span class="w-1.5 h-1.5 flex-shrink-0"></span>}
              >
                <span
                  class="w-1.5 h-1.5 rounded-full bg-[#A27561] flex-shrink-0"
                  title="Unread"
                ></span>
              </Show>

              {/* Sender with ProfileAvatar */}
              <div class="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                <ProfileAvatar email={props.message.sender} size="xs" />
                <span
                  class={`truncate min-w-0 font-sans text-sm ${
                    props.message.read ? "font-medium text-[#2B2C2D] dark:text-[#E2DFD8]" : "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                  }`}
                >
                  {props.message.sender}
                </span>
              </div>
            </div>

            {/* Date & Hover Micro Actions */}
            <div class="relative flex items-center justify-end flex-shrink-0 min-w-[70px]">
              <span class="font-mono text-[11px] text-[#55575B] dark:text-[#9CA3AF] group-hover:invisible transition">
                {formattedDate()}
              </span>

              {/* Floating Hover Action Pill */}
              <div class="absolute right-0 hidden group-hover:flex items-center gap-0.5 bg-white/95 dark:bg-[#26282E]/95 px-1 py-0.5 rounded-lg border border-[#E2DFD8] dark:border-[#3A3D46] shadow-sm z-10">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggleRead(props.message);
                  }}
                  class="p-1 hover:bg-[#F3ECE8] dark:hover:bg-[#32353E] rounded text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] transition cursor-pointer"
                  title={props.message.read ? "Mark as unread" : "Mark as read"}
                >
                  <Show
                    when={props.message.read}
                    fallback={
                      <svg class="w-3 h-3 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    }
                  >
                    <svg class="w-3 h-3 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  </Show>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onArchive(props.message);
                  }}
                  class="p-1 hover:bg-[#F3ECE8] dark:hover:bg-[#32353E] rounded text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] transition cursor-pointer"
                  title="Archive"
                >
                  <svg class="w-3 h-3 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                </button>
                {/* Quick Trash or Delete Forever */}
                <Show
                  when={props.message.folder === "trash" && props.onDeleteForever}
                  fallback={
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onTrash(props.message);
                      }}
                      class="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded text-[#464748] dark:text-[#A1A1AA] hover:text-rose-600 dark:hover:text-rose-400 transition cursor-pointer"
                      title="Move to Trash"
                    >
                      <svg class="w-3 h-3 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  }
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDeleteForever?.(props.message);
                    }}
                    class="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition cursor-pointer"
                    title="Delete Forever"
                  >
                    <svg class="w-3 h-3 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <line x1="10" y1="11" x2="14" y2="15" />
                      <line x1="14" y1="11" x2="10" y2="15" />
                    </svg>
                  </button>
                </Show>
              </div>
            </div>
          </div>

          {/* Middle Line: Subject & Attachment */}
          <div class="flex items-center justify-between gap-2 min-w-0 overflow-hidden pl-7">
            <div class="flex items-center gap-1.5 min-w-0 overflow-hidden flex-1">
              <Show when={props.message.labelIds && props.message.labelIds.length > 0}>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <For each={props.message.labelIds}>
                    {(lid) => {
                      const lbl = () => props.labels?.find((l) => l.id === lid);
                      return (
                        <Show when={lbl()}>
                          <span
                            class="text-[9px] font-semibold text-white px-1.5 py-0.2 rounded-full shadow-2xs truncate max-w-[65px]"
                            style={{ "background-color": lbl()!.color }}
                            title={lbl()!.name}
                          >
                            {lbl()!.name}
                          </span>
                        </Show>
                      );
                    }}
                  </For>
                </div>
              </Show>
              <span
                class={`truncate min-w-0 text-[13px] flex-1 ${
                  props.message.read ? "font-medium text-[#2B2C2D] dark:text-[#E2DFD8]" : "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                }`}
              >
                {props.message.subject || "(No subject)"}
              </span>
            </div>
            <Show when={props.message.hasAttachments || (props.message.attachmentCount && props.message.attachmentCount > 0)}>
              <AttachmentBadge
                category={(props.message.attachmentTypes || [])[0]}
                count={props.message.attachmentCount}
                size="xs"
              />
            </Show>
          </div>

          {/* Bottom Line: Snippet */}
          <div class="text-xs text-[#4A4C50] dark:text-[#A1A1AA] font-normal truncate min-w-0 pl-7">
            {props.message.snippet || "Empty message body"}
          </div>
        </div>
      </Show>
    </div>
  );
};
