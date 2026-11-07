import { Component, Show, For, createSignal } from "solid-js";
import { DisplayMessage } from "./MessageList";
import { MailboxLabel } from "../api";
import { AttachmentBadge } from "./AttachmentBadge";
import { FocusedCategory } from "../focused_inbox";

import { Folder } from "./Sidebar";

interface MessageRowProps {
  message: DisplayMessage;
  isSelected: boolean;
  isChecked: boolean;
  isSplit: boolean;
  currentFolder?: Folder;
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
  onMoveToCategory?: (msg: DisplayMessage, category: FocusedCategory) => void;
  currentUserEmail?: string;
  currentUserPhotoUrl?: string | null;
}

export function formatAddress(raw: string): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const match = trimmed.match(/^["']?([^"'<]+)["']?\s*<([^>]+)>/);
  if (match && match[1].trim()) {
    const name = match[1].trim().replace(/^["']+|["']+$/g, "").trim();
    if (name.length > 0) {
      return name;
    }
  }
  const angleMatch = trimmed.match(/<([^>]+)>/);
  if (angleMatch && angleMatch[1].trim()) {
    return angleMatch[1].trim();
  }
  return trimmed.replace(/^["']+|["']+$/g, "").trim();
}

export function getDisplayParty(message: DisplayMessage, folder?: Folder): string {
  const currentFolder = folder || message.folder;
  if (currentFolder === "sent" || currentFolder === "drafts" || currentFolder === "scheduled") {
    let recipients: string[] = [];
    if (message.recipients && message.recipients.length > 0) {
      recipients = message.recipients
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
    } else if (message.recipient && message.recipient.trim()) {
      recipients = message.recipient
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
    }
    if (recipients.length === 0) {
      return currentFolder === "drafts" ? "No recipient" : "(no recipient)";
    }
    const first = formatAddress(recipients[0]);
    return recipients.length > 1 ? `${first} +${recipients.length - 1}` : first;
  }
  if (message.senderName && message.senderName.trim()) {
    return message.senderName.trim();
  }
  return formatAddress(message.sender);
}

export function getDisplayPartyEmail(message: DisplayMessage, folder?: Folder): string {
  const currentFolder = folder || message.folder;
  if (currentFolder === "sent" || currentFolder === "drafts" || currentFolder === "scheduled") {
    let recipients: string[] = [];
    if (message.recipients && message.recipients.length > 0) {
      recipients = message.recipients
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
    } else if (message.recipient && message.recipient.trim()) {
      recipients = message.recipient
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
    }
    if (recipients.length > 0) {
      const match = recipients[0].match(/<([^>]+)>/);
      return match ? match[1].trim() : recipients[0].trim();
    }
    return "";
  }
  const match = message.sender ? message.sender.match(/<([^>]+)>/) : null;
  return match ? match[1].trim() : (message.sender || "").trim();
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

import { formatScheduledChip } from "../utils/dateTime";

export const MessageRow: Component<MessageRowProps> = (props) => {
  const isSent = () => (props.currentFolder || props.message.folder) === "sent";
  const isUnread = () => !props.message.read && !isSent();
  const partyLabel = () => getDisplayParty(props.message, props.currentFolder);
  const partyEmail = () => getDisplayPartyEmail(props.message, props.currentFolder);

  const densityPadding = () => {
    if (props.density === "compact") return props.isSplit ? "py-2 px-3" : "py-1.5 px-3";
    if (props.density === "comfortable") return props.isSplit ? "py-3 px-4" : "py-3 px-4";
    return props.isSplit ? "py-2.5 px-3.5" : "py-2 px-3.5";
  };

  const formattedDate = () => {
    if (props.message.folder === "scheduled") {
      return formatScheduledChip(props.message.scheduledAt || props.message.date, props.message.status);
    }
    return formatSmartDate(props.message.date);
  };

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

  const [contextMenuPos, setContextMenuPos] = createSignal<{ x: number; y: number } | null>(null);

  const handleContextMenu = (e: MouseEvent) => {
    if (props.onMoveToCategory && (props.currentFolder === "inbox" || props.message.folder === "inbox")) {
      e.preventDefault();
      e.stopPropagation();
      setContextMenuPos({ x: e.clientX, y: e.clientY });
    }
  };

  const closeContextMenu = () => {
    setContextMenuPos(null);
  };

  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let isLongPressTriggered = false;
  let startX = 0;
  let startY = 0;

  function clearHoldTimer() {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  function handleTouchStart(e: TouchEvent) {
    isLongPressTriggered = false;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    clearHoldTimer();
    pressTimer = setTimeout(() => {
      isLongPressTriggered = true;
      props.onToggleCheck(props.message, !props.isChecked);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(40);
      }
    }, 450);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!pressTimer) return;
    const touch = e.touches[0];
    if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 10) {
      clearHoldTimer();
    }
  }

  function handleTouchEnd() {
    clearHoldTimer();
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isLongPressTriggered = false;
    startX = e.clientX;
    startY = e.clientY;
    clearHoldTimer();
    pressTimer = setTimeout(() => {
      isLongPressTriggered = true;
      props.onToggleCheck(props.message, !props.isChecked);
    }, 450);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!pressTimer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 10) {
      clearHoldTimer();
    }
  }

  function handleMouseUp() {
    clearHoldTimer();
  }

  function handleClick(e: MouseEvent) {
    if (isLongPressTriggered) {
      e.preventDefault();
      e.stopPropagation();
      isLongPressTriggered = false;
      return;
    }
    // If in multi-select mode (one or more items already selected), tapping row toggles selection
    if ((props.selectedIds?.size || 0) > 0) {
      props.onToggleCheck(props.message, !props.isChecked);
    } else {
      props.onSelect(props.message);
    }
  }

  return (
    <div
      draggable={!props.isSplit}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
      data-testid="message-row"
      data-message-id={props.message.id}
      class={`group relative cursor-pointer border-b border-[#E2DFD8]/60 dark:border-[#2A2D35] transition-colors duration-150 select-none min-w-0 overflow-hidden ${
        props.isSplit ? "p-3 sm:px-4 py-2.5" : densityPadding()
      } ${
        props.isSelected
          ? "bg-[#F3ECE8] dark:bg-[#2D2522] border-l-[3px] border-l-[#A27561]"
          : props.isChecked
          ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-l-4 border-[#A27561]"
          : isUnread()
          ? "bg-white dark:bg-[#18191D] hover:bg-[#FAF9F6] dark:hover:bg-[#202227]"
          : "bg-[#FAF9F6]/80 dark:bg-[#18191D]/80 hover:bg-white dark:hover:bg-[#202227]"
      }`}
    >
      <Show
        when={props.isSplit}
        fallback={
          /* ── Full-Width Mode: Streamlined Single-Line Layout ── */
          <div class="flex items-center gap-3 min-w-0 overflow-hidden h-8">
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
              when={isUnread()}
              fallback={<span class="w-1.5 h-1.5 flex-shrink-0"></span>}
            >
              <span
                class="w-1.5 h-1.5 rounded-full bg-[#A27561] flex-shrink-0"
                title="Unread"
              ></span>
            </Show>

            {/* Display Party Column (Clean typography, avatar system wiped) */}
            <div class="w-28 sm:w-48 md:w-56 min-w-0 flex-shrink-0 flex items-center gap-2 truncate">
              <Show when={props.message.accountColor}>
                <span
                  class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ "background-color": props.message.accountColor }}
                  title={props.message.accountEmail || "Connected Account"}
                  data-testid="account-chip"
                />
              </Show>
              <span
                data-testid="message-sender-name"
                class={`truncate font-sans text-sm tracking-tight ${
                  isUnread()
                    ? "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                    : "font-normal text-[#878A8E] dark:text-[#8A8E94]"
                }`}
              >
                <Show when={isSent()}>
                  <span class="text-[#878A8E] dark:text-[#8A8E94] font-normal mr-0.5">To: </span>
                </Show>
                {partyLabel()}
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
                          class="text-xs font-semibold text-white px-2 py-0.5 rounded-full shadow-2xs truncate max-w-[150px]"
                          style={{ "background-color": lbl()!.color }}
                          title={lbl()!.path || lbl()!.name}
                        >
                          {lbl()!.path || lbl()!.name}
                        </span>
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Streamlined Subject Line */}
            <div class="flex-1 min-w-0 overflow-hidden text-sm flex items-center gap-2">
              <Show when={props.message.sendFailed}>
                <span class="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/60 px-1.5 py-0.5 rounded flex-shrink-0">
                  <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  Send failed
                </span>
              </Show>
              <span
                data-testid="message-subject"
                class={`truncate block ${
                  isUnread()
                    ? "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                    : "font-normal text-[#2B2C2D] dark:text-[#E2DFD8]"
                }`}
              >
                {props.message.subject || "(no subject)"}
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
            <div class="w-20 sm:w-28 flex-shrink-0 relative flex items-center justify-end">
              {/* Monospace Short Date */}
              <span class="font-mono text-xs text-[#55575B] dark:text-[#9CA3AF] group-hover:invisible transition">
                {formattedDate()}
              </span>

              {/* Floating Hover Action Pill (Gmail style) */}
              <div class="absolute right-0 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 pointer-events-none group-hover:pointer-events-auto transition-[transform,opacity] duration-150 ease-out flex items-center gap-1 bg-white/95 dark:bg-[#202227]/95 backdrop-blur-md px-1.5 py-0.5 rounded-xl border border-[#E2DFD8] dark:border-[#333640] shadow-xs z-10">
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
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                      </svg>
                    }
                  >
                    {/* Closed Envelope icon when message is read -> clicking marks as unread */}
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
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
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
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
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
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
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
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
        {/* ── Mobile / Tablet View: Full-Width Typography Layout (Wiped Circular Avatar Silhouette) ── */}
        <div class="flex items-start gap-2.5 min-w-0 overflow-hidden w-full">
          {/* Active selection checkmark badge (visible ONLY when item is selected) */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleCheck(props.message, !props.isChecked);
            }}
            class={props.isChecked
              ? "w-6 h-6 rounded-full bg-[#A27561] text-white flex items-center justify-center shrink-0 shadow-xs cursor-pointer select-none transition-colors duration-150 mt-0.5"
              : "hidden"}
            data-testid="message-mobile-select-btn"
            title={props.isChecked ? "Deselect" : "Select"}
          >
            <svg class="w-4 h-4 stroke-white fill-none stroke-[2.5]" viewBox="0 0 24 24">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>

          {/* 2. Middle & Right 3-Row Content */}
          <div class="flex-1 min-w-0 flex flex-col gap-0.5">
            {/* Row 1: Sender Name + Date */}
            <div class="flex items-baseline justify-between gap-2 min-w-0">
              <div class="flex items-center gap-1.5 min-w-0 truncate">
                <Show when={props.message.accountColor}>
                  <span
                    class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ "background-color": props.message.accountColor }}
                    title={props.message.accountEmail || "Connected Account"}
                  />
                </Show>
                <span
                  class={`truncate text-sm tracking-tight ${
                    isUnread()
                      ? "font-bold text-[#1A1B1E] dark:text-[#F3F4F6]"
                      : "font-semibold text-[#444746] dark:text-[#C4C7C5]"
                  }`}
                  data-testid="message-sender-name"
                >
                  <Show when={isSent()}>
                    <span class="text-[#878A8E] dark:text-[#8A8E94] font-normal mr-0.5">To: </span>
                  </Show>
                  {partyLabel()}
                </span>
                <Show when={props.message.hasAttachments || (props.message.attachmentCount && props.message.attachmentCount > 0)}>
                  <span class="text-[#878A8E] flex-shrink-0 ml-0.5">
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </span>
                </Show>
              </div>

              {/* Date */}
              <span class="font-mono text-xs text-[#80868B] dark:text-[#8E918F] flex-shrink-0 ml-2">
                {formattedDate()}
              </span>
            </div>

            {/* Row 2: Subject */}
            <div class="truncate text-[13px] leading-snug">
              <span
                data-testid="message-subject"
                class={`truncate block ${
                  isUnread()
                    ? "font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]"
                    : "font-normal text-[#55575B] dark:text-[#A8AAAA]"
                }`}
              >
                {props.message.subject || "(no subject)"}
              </span>
            </div>

            {/* Row 3: Snippet + Star Button */}
            <div class="flex items-center justify-between gap-2 mt-0.5">
              <span class="truncate text-xs text-[#75777B] dark:text-[#8E918F] flex-1">
                {props.message.snippet || "(No content preview)"}
              </span>

              {/* Star Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onToggleStarred(props.message);
                }}
                class="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 -mr-2 text-[#878A8E] hover:text-amber-500 flex-shrink-0 transition cursor-pointer"
                title={props.message.starred ? "Unstar" : "Star"}
                aria-label={props.message.starred ? "Unstar message" : "Star message"}
                data-testid="message-mobile-star"
              >
                <Show
                  when={props.message.starred}
                  fallback={
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.6]" viewBox="0 0 24 24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  }
                >
                  <svg class="w-4 h-4 text-amber-500 fill-amber-400 stroke-amber-500 stroke-[1.4]" viewBox="0 0 24 24">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Right-click Move to Category Menu */}
      <Show when={contextMenuPos()}>
        <div
          class="fixed z-50 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg py-1 w-44 text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6]"
          style={{
            left: `${Math.min(contextMenuPos()!.x, typeof window !== "undefined" ? window.innerWidth - 180 : 200)}px`,
            top: `${Math.min(contextMenuPos()!.y, typeof window !== "undefined" ? window.innerHeight - 170 : 200)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="px-3 py-1.5 text-xs uppercase font-bold text-[#878A8E] dark:text-[#6E7075] border-b border-[#E2DFD8]/60 dark:border-[#2E3138]">
            Move to category
          </div>
          <button
            type="button"
            data-testid="move-to-primary"
            onClick={(e) => {
              e.stopPropagation();
              closeContextMenu();
              props.onMoveToCategory?.(props.message, "primary");
            }}
            class="w-full text-left px-3 py-2 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] flex items-center gap-2 cursor-pointer transition"
          >
            <span class="w-2 h-2 rounded-full bg-blue-500"></span>
            Primary
          </button>

          <button
            type="button"
            data-testid="move-to-newsletters"
            onClick={(e) => {
              e.stopPropagation();
              closeContextMenu();
              props.onMoveToCategory?.(props.message, "newsletters");
            }}
            class="w-full text-left px-3 py-2 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] flex items-center gap-2 cursor-pointer transition"
          >
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
            Newsletters
          </button>
          <button
            type="button"
            data-testid="move-to-social"
            onClick={(e) => {
              e.stopPropagation();
              closeContextMenu();
              props.onMoveToCategory?.(props.message, "social");
            }}
            class="w-full text-left px-3 py-2 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] flex items-center gap-2 cursor-pointer transition"
          >
            <span class="w-2 h-2 rounded-full bg-purple-500"></span>
            Social
          </button>
        </div>
        <div
          class="fixed inset-0 z-40"
          onClick={(e) => {
            e.stopPropagation();
            closeContextMenu();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            closeContextMenu();
          }}
        />
      </Show>
    </div>
  );
};
