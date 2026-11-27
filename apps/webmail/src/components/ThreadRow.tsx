import { Component, Show, For, createEffect } from "solid-js";
import { ThreadSummary, MailboxLabel, ContactItem, ConnectedAccount, OrgMember } from "../api";
import { DisplayMessage } from "./MessageList";
import { formatSmartDate, formatAddress, getDisplayParty, getDisplayPartyEmail } from "./MessageRow";
import { Folder } from "./Sidebar";
import { t } from "../utils/i18n";

export function formatParticipants(
  parts: string[],
  contacts?: ContactItem[],
  connectedAccounts?: ConnectedAccount[],
  currentUserEmail?: string,
  latestMessage?: DisplayMessage,
  orgMembers?: OrgMember[]
): string {
  if (!parts || parts.length === 0) return t("(no sender)");

  const resolvePart = (raw: string) => {
    const formatted = formatAddress(raw);
    const match = raw.match(/<([^>]+)>/);
    const clean = (match ? match[1] : raw).replace(/["']/g, "").trim().toLowerCase();

    // 1. Organization members directory (authoritative for internal organization users)
    if (orgMembers && orgMembers.length > 0) {
      const member = orgMembers.find((m) => m.email && m.email.trim().toLowerCase() === clean);
      if (member && member.display_name && member.display_name.trim()) {
        return { name: member.display_name.trim(), email: clean };
      }
    }
    if (typeof sessionStorage !== "undefined" && clean) {
      const orgName = sessionStorage.getItem("byos_org_member_name_" + clean);
      if (orgName && orgName.trim()) {
        return { name: orgName.trim(), email: clean };
      }
    }
    // 2. Connected accounts
    if (connectedAccounts && connectedAccounts.length > 0) {
      const acc = connectedAccounts.find((a) => a.email && a.email.trim().toLowerCase() === clean);
      if (acc && acc.displayName && acc.displayName.trim()) return { name: acc.displayName.trim(), email: clean };
    }
    // 3. Local contacts
    if (contacts && contacts.length > 0) {
      const found = contacts.find((c) => c.email && c.email.trim().toLowerCase() === clean);
      if (found && found.name && found.name.trim()) return { name: found.name.trim(), email: clean };
    }
    // 4. Explicit senderName on latestMessage if matching this email
    if (latestMessage && latestMessage.senderName && latestMessage.senderName.trim()) {
      const msgMatch = latestMessage.sender ? latestMessage.sender.match(/<([^>]+)>/) : null;
      const msgClean = (msgMatch ? msgMatch[1] : (latestMessage.sender || "")).replace(/["']/g, "").trim().toLowerCase();
      if (msgClean === clean) {
        return { name: latestMessage.senderName.trim(), email: clean };
      }
    }
    // 5. Cached sender display name by email address from previous decrypted messages
    if (typeof sessionStorage !== "undefined") {
      const cached = sessionStorage.getItem("byos_sender_email_name_" + clean);
      if (cached && cached.trim()) return { name: cached.trim(), email: clean };
    }
    // 6. Formatted MIME display name
    if (formatted && formatted.toLowerCase() !== clean && formatted !== raw.replace(/^<|>$/g, "").trim()) {
      return { name: formatted, email: clean };
    }
    return { name: formatted || clean, email: clean };
  };

  // Resolve all parts and deduplicate by email address first, then by resolved display name
  const resolvedMap = new Map<string, string>(); // email -> best resolved display name
  const seenOrder: string[] = [];

  for (const raw of parts) {
    if (!raw || !raw.trim()) continue;
    const { name, email } = resolvePart(raw);
    if (!email) continue;
    const existing = resolvedMap.get(email);
    if (!existing) {
      resolvedMap.set(email, name);
      seenOrder.push(email);
    } else {
      // If the existing name is just the bare email, and the new name is a richer display name, upgrade!
      if (
        (existing.toLowerCase() === email || existing === raw.replace(/^<|>$/g, "").trim()) &&
        name.toLowerCase() !== email
      ) {
        resolvedMap.set(email, name);
      }
    }
  }

  const resolvedList: { name: string; email: string }[] = [];
  const seenNames = new Set<string>();

  for (const email of seenOrder) {
    const name = resolvedMap.get(email) || email;
    const lowerName = name.toLowerCase();
    if (seenNames.has(lowerName)) continue;
    seenNames.add(lowerName);
    resolvedList.push({ name, email });
  }

  if (resolvedList.length === 0) return t("(no sender)");

  const currentClean = currentUserEmail?.trim().toLowerCase();
  let displayNames = resolvedList.map((r) => r.name);
  if (currentClean && resolvedList.length > 1) {
    // If current user is among participants, place them as "me"
    displayNames = resolvedList.map((r) => (r.email === currentClean ? t("me") : r.name));
  }

  if (displayNames.length === 1) return displayNames[0];
  if (displayNames.length === 2) return `${displayNames[0]}, ${displayNames[1]}`;
  return `${displayNames[0]}, ${displayNames[1]} +${displayNames.length - 2}`;
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
  isSelected?: boolean;
  selectedIds?: Set<string>;
  onToggleThreadCheck?: (threadId: string, checked: boolean) => void;
  targetMessage?: DisplayMessage;
  latestMessage?: DisplayMessage;
  currentFolder?: Folder;
  labels?: MailboxLabel[];
  onToggleStarred?: (msg: DisplayMessage) => void;
  onToggleRead?: (msg: DisplayMessage) => void;
  onArchive?: (msg: DisplayMessage) => void;
  onTrash?: (msg: DisplayMessage) => void;
  onDeleteForever?: (msg: DisplayMessage) => void;
  contacts?: ContactItem[];
  connectedAccounts?: ConnectedAccount[];
  currentUserEmail?: string;
  orgMembers?: OrgMember[];
}

export const ThreadRow: Component<ThreadRowProps> = (props) => {
  const isAllChecked = () => {
    if (!props.thread.message_ids || props.thread.message_ids.length === 0) return false;
    return props.thread.message_ids.every((id) => props.selectedIds?.has(id));
  };

  const isIndeterminate = () => {
    if (!props.thread.message_ids || props.thread.message_ids.length === 0) return false;
    const hasAny = props.thread.message_ids.some((id) => props.selectedIds?.has(id));
    return hasAny && !isAllChecked();
  };

  const isSent = () => (props.currentFolder || props.thread.folder) === "sent";

  const isUnread = () => {
    if (isSent()) return false;
    return props.targetMessage ? !props.targetMessage.read : props.thread.unread_count > 0;
  };

  const densityPadding = () => {
    if (props.density === "compact") return props.isSplit ? "py-2 px-3" : "py-1.5 px-3";
    if (props.density === "comfortable") return props.isSplit ? "py-3 px-4" : "py-3 px-4";
    return props.isSplit ? "py-2.5 px-3.5" : "py-2 px-3.5";
  };

  const participantLabel = () =>
    formatParticipants(
      props.thread.participants,
      props.contacts,
      props.connectedAccounts,
      props.currentUserEmail,
      threadLatestMsg(),
      props.orgMembers
    );

  const threadLatestMsg = () => props.latestMessage || props.targetMessage;

  const displayParty = () => {
    if (isSent()) {
      if (props.thread.recipients && props.thread.recipients.length > 0) {
        return getDisplayParty(
          { recipients: props.thread.recipients } as DisplayMessage,
          "sent",
          props.contacts,
          props.connectedAccounts,
          props.currentUserEmail,
          props.orgMembers
        );
      }
      const msg = threadLatestMsg();
      if (msg) {
        return getDisplayParty(msg, "sent", props.contacts, props.connectedAccounts, props.currentUserEmail, props.orgMembers);
      }
    }
    if (props.thread.participants && props.thread.participants.length > 0) {
      return participantLabel();
    }
    const msg = threadLatestMsg();
    if (msg) {
      return getDisplayParty(
        msg,
        props.currentFolder || (props.thread.folder as Folder),
        props.contacts,
        props.connectedAccounts,
        props.currentUserEmail
      );
    }
    return participantLabel();
  };

  const avatarEmail = () => {
    if (isSent()) {
      if (props.thread.recipients && props.thread.recipients.length > 0) {
        return getDisplayPartyEmail(
          { recipients: props.thread.recipients } as DisplayMessage,
          "sent"
        );
      }
      const msg = threadLatestMsg();
      if (msg) {
        return getDisplayPartyEmail(msg, "sent");
      }
    }
    return props.thread.participants && props.thread.participants.length > 0
      ? props.thread.participants[0]
      : "";
  };

  let pressTimer: any = null;
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
    if (e.touches.length !== 1) return;
    isLongPressTriggered = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    clearHoldTimer();
    pressTimer = setTimeout(() => {
      isLongPressTriggered = true;
      props.onToggleThreadCheck?.(props.thread.thread_id, !isAllChecked());
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
      props.onToggleThreadCheck?.(props.thread.thread_id, !isAllChecked());
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
      props.onToggleThreadCheck?.(props.thread.thread_id, !isAllChecked());
    } else {
      props.onClick();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="thread-row"
      onClick={handleClick}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onClick();
        }
      }}
      aria-expanded={props.expanded}
      aria-label={`Thread with ${displayParty()}, ${props.thread.message_count} messages, ${props.subject || t("No subject")}`}
      class={`group relative cursor-pointer border-b border-[#E2DFD8]/60 dark:border-[#2A2D35] transition-colors duration-150 select-none min-w-0 overflow-hidden focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
        props.isSplit ? "p-3 sm:px-4 py-2.5" : densityPadding()
      } ${
        props.isSelected || props.expanded
          ? "bg-[#F3ECE8] dark:bg-[#2D2522] border-l-4 border-l-[#A27561]"
          : isAllChecked()
          ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-l-4 border-[#A27561]"
          : isUnread()
          ? "bg-white dark:bg-[#18191D] hover:bg-[#F9F7F2] dark:hover:bg-[#202227]"
          : "bg-white dark:bg-[#18191D] hover:bg-[#F9F7F2] dark:hover:bg-[#202227]"
      }`}
    >
      <Show
        when={props.isSplit}
        fallback={
          <div class="flex items-center gap-3 min-w-0 overflow-hidden h-7">
            {/* Selection Checkbox */}
            <div
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleThreadCheck?.(props.thread.thread_id, !isAllChecked());
              }}
              class="flex items-center justify-center p-0.5 cursor-pointer flex-shrink-0"
              title={isAllChecked() ? t("Deselect") : t("Select")}
            >
              <input
                type="checkbox"
                checked={isAllChecked()}
                ref={(el) => {
                  createEffect(() => {
                    el.indeterminate = isIndeterminate();
                  });
                }}
                class="accent-[#A27561] w-4 h-4 cursor-pointer rounded pointer-events-none"
              />
            </div>

            {/* Clickable Star Toggle */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (props.targetMessage && props.onToggleStarred) {
                  props.onToggleStarred(props.targetMessage);
                }
              }}
              class="transition flex-shrink-0 cursor-pointer p-0.5 text-[#878A8E] hover:text-amber-500 flex items-center justify-center"
              title={props.thread.is_starred ? t("Unstar") : t("Star")}
            >
              <Show
                when={props.thread.is_starred}
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

            {/* Unread indicator dot */}
            <Show
              when={isUnread()}
              fallback={<span class="w-1.5 h-1.5 flex-shrink-0"></span>}
            >
              <span
                class="w-1.5 h-1.5 rounded-full bg-[#A27561] flex-shrink-0"
                title={t("Unread")}
              ></span>
            </Show>

            {/* Sender / Participants cluster */}
            <div class="w-28 sm:w-48 md:w-56 min-w-0 flex-shrink-0 flex items-center gap-2 truncate">
              <Show when={threadLatestMsg()?.accountColor}>
                <span
                  class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ "background-color": threadLatestMsg()!.accountColor }}
                  title={threadLatestMsg()?.accountEmail || "Connected Account"}
                  data-testid="account-chip"
                />
              </Show>
              <span
                data-testid="thread-sender-name"
                class={`truncate font-sans text-sm ${isUnread() ? "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]" : "font-normal text-[#6F7173] dark:text-[#8A8E94]"}`}
              >
                <Show when={isSent()}>
                  <span class="text-[#6F7173] dark:text-[#8A8E94] font-normal mr-0.5">{t("To")}: </span>
                </Show>
                {displayParty()}
              </span>
              <Show when={props.thread.message_count > 1}>
                <span class="text-xs font-mono font-medium px-1.5 py-0.5 rounded-full bg-[#F0EEE9] dark:bg-[#2E3138] text-[#6F7173] dark:text-[#A1A1AA] flex-shrink-0">
                  {props.thread.message_count}
                </span>
              </Show>
            </div>

            {/* Label Chips */}
            <Show when={props.labels && props.targetMessage?.labelIds && props.targetMessage.labelIds.length > 0}>
              <div class="flex items-center gap-1 flex-shrink-0">
                <For each={props.targetMessage!.labelIds}>
                  {(lblId) => {
                    const lbl = () => props.labels?.find((l) => l.id === lblId);
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

            {/* Subject + Snippet */}
            <div class="flex-1 min-w-0 overflow-hidden text-sm flex items-center gap-2">
              <span
                data-testid="thread-subject"
                class={`truncate ${
                  isUnread()
                    ? "font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]"
                    : "font-normal text-[#2B2C2D] dark:text-[#E2DFD8]"
                }`}
              >
                {props.subject || t("(Thread conversation)")}
              </span>
              <Show when={props.snippet}>
                <span class="truncate text-xs text-[#878A8E] hidden sm:inline">
                  — {props.snippet}
                </span>
              </Show>
            </div>

            {/* Attachment indicator */}
            <Show when={props.thread.has_attachments}>
              <span class="text-[#878A8E] flex-shrink-0" title={t("Has attachments")}>
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </span>
            </Show>

            {/* Date Slot & Hover Quick Actions Pill */}
            <div class="w-20 sm:w-28 flex-shrink-0 relative flex items-center justify-end">
              <span class="font-mono text-xs text-[#55575B] dark:text-[#9CA3AF] group-hover:invisible transition">
                {formatSmartDate(props.thread.latest_at)}
              </span>

              {/* Hover Quick Actions */}
              <div class="absolute right-0 hidden group-hover:flex items-center gap-1 bg-white/95 dark:bg-[#26282E]/95 px-1.5 py-0.5 rounded-xl border border-[#E2DFD8] dark:border-[#3A3D46] shadow-sm z-10">
                <Show when={props.targetMessage && props.onToggleRead}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggleRead!(props.targetMessage!);
                    }}
                    class="p-1 hover:bg-[#F3ECE8] dark:hover:bg-[#343842] rounded-lg text-[#5E6063] hover:text-[#A27561] transition cursor-pointer"
                    title={isUnread() ? t("Mark as read") : t("Mark as unread")}
                  >
                    <Show
                      when={!isUnread()}
                      fallback={
                        <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        </svg>
                      }
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <rect x="2" y="4" width="20" height="16" rx="2" />
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                      </svg>
                    </Show>
                  </button>
                </Show>

                <Show when={props.targetMessage && props.onArchive && props.targetMessage.folder !== "sent" && props.targetMessage.folder !== "trash" && props.targetMessage.folder !== "drafts" && props.targetMessage.folder !== "archive"}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onArchive!(props.targetMessage!);
                    }}
                    class="p-1 hover:bg-[#F3ECE8] dark:hover:bg-[#343842] rounded-lg text-[#5E6063] hover:text-[#A27561] transition cursor-pointer"
                    title={t("Archive")}
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <polyline points="21 8 21 21 3 21 3 8" />
                      <rect x="1" y="3" width="22" height="5" />
                      <line x1="10" y1="12" x2="14" y2="12" />
                    </svg>
                  </button>
                </Show>

                <Show when={props.targetMessage && (props.onTrash || props.onDeleteForever)}>
                  <Show
                    when={props.targetMessage?.folder === "trash" && props.onDeleteForever}
                    fallback={
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          props.onTrash?.(props.targetMessage!);
                        }}
                        class="p-1 hover:bg-[#F3ECE8] dark:hover:bg-[#343842] rounded-lg text-[#5E6063] hover:text-rose-500 transition cursor-pointer"
                        title={t("Move to Trash")}
                      >
                        <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
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
                        props.onDeleteForever?.(props.targetMessage!);
                      }}
                      class="p-1 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg text-rose-600 hover:text-rose-700 transition cursor-pointer"
                      title={t("Delete Forever")}
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="14" y2="15" />
                        <line x1="14" y1="11" x2="10" y2="15" />
                      </svg>
                    </button>
                  </Show>
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
              props.onToggleThreadCheck?.(props.thread.thread_id, !isAllChecked());
            }}
            class={isAllChecked()
              ? "w-6 h-6 rounded-full bg-[#A27561] text-white flex items-center justify-center shrink-0 shadow-xs cursor-pointer select-none transition-colors duration-150 mt-0.5"
              : "hidden"}
            data-testid="thread-mobile-select-btn"
            title={isAllChecked() ? t("Deselect") : t("Select")}
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
                <Show when={threadLatestMsg()?.accountColor}>
                  <span
                    class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ "background-color": threadLatestMsg()!.accountColor }}
                    title={threadLatestMsg()?.accountEmail || "Connected Account"}
                  />
                </Show>
                <span
                  class={`truncate text-sm tracking-tight ${
                    isUnread()
                      ? "font-bold text-[#1A1B1E] dark:text-[#F3F4F6]"
                      : "font-semibold text-[#444746] dark:text-[#C4C7C5]"
                  }`}
                  data-testid="thread-sender-name"
                >
                  <Show when={isSent()}>
                    <span class="text-[#878A8E] dark:text-[#8A8E94] font-normal mr-0.5">{t("To")}: </span>
                  </Show>
                  {displayParty()}
                </span>
                <Show when={props.thread.message_count > 1}>
                  <span class="text-xs font-mono font-medium px-1.5 py-0.2 rounded-full bg-[#F0EEE9] dark:bg-[#2E3138] text-[#6F7173] dark:text-[#A1A1AA] flex-shrink-0">
                    {props.thread.message_count}
                  </span>
                </Show>
                <Show when={props.thread.has_attachments}>
                  <span class="text-[#878A8E] flex-shrink-0 ml-0.5">
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </span>
                </Show>
              </div>

              {/* Date */}
              <span class="font-mono text-xs text-[#80868B] dark:text-[#8E918F] flex-shrink-0 ml-2">
                {formatSmartDate(props.thread.latest_at)}
              </span>
            </div>

            {/* Row 2: Subject */}
            <div class="truncate text-[13px] leading-snug">
              <span
                data-testid="thread-subject"
                class={`truncate block ${
                  isUnread()
                    ? "font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]"
                    : "font-normal text-[#55575B] dark:text-[#A8AAAA]"
                }`}
              >
                {props.subject || t("(Thread conversation)")}
              </span>
            </div>

            {/* Row 3: Snippet + Star Button */}
            <div class="flex items-center justify-between gap-2 mt-0.5">
              <span class="truncate text-xs text-[#75777B] dark:text-[#8E918F] flex-1">
                {props.snippet || t("(No content preview)")}
              </span>

              {/* Star Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (props.targetMessage && props.onToggleStarred) {
                    props.onToggleStarred(props.targetMessage);
                  }
                }}
                class="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 -mr-2 text-[#878A8E] hover:text-amber-500 flex-shrink-0 transition cursor-pointer"
                title={props.thread.is_starred ? t("Unstar") : t("Star")}
                aria-label={props.thread.is_starred ? t("Unstar message") : t("Star message")}
                data-testid="thread-mobile-star"
              >
                <Show
                  when={props.thread.is_starred}
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
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
