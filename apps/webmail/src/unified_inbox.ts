import { ConnectedAccount, MessageMetadata, AttachmentItem, getAccountColor } from "./api";
import { formatMessageDate } from "./utils/dateTime";
import { FocusedCategory } from "./focused_inbox";

export interface DisplayMessage {
  id: string;
  messageSeq?: number;
  version?: number;
  folder: "inbox" | "sent" | "scheduled" | "drafts" | "snoozed" | "archive" | "spam" | "trash" | "unified_inbox";
  folderId?: string | null;
  labelIds?: string[];
  sender: string;
  recipient: string;
  recipients?: string[];
  subject: string;
  snippet: string;
  encryptedBody: string;
  date: string;
  read: boolean;
  starred: boolean;
  snoozedUntil?: string;
  isRealApi?: boolean;
  messageId?: string;
  hasAttachments?: boolean;
  attachmentCount?: number;
  attachmentTypes?: string[];
  trackingToken?: string;
  trackingInfo?: {
    openCount: number;
    firstOpenedAt?: string;
    lastOpenedAt?: string;
  };
  draftStorageRef?: string;
  scheduledAt?: string;
  status?: string;
  decryptedContent?: string;
  sendFailed?: boolean;
  mailboxId?: string;
  accountEmail?: string;
  accountColor?: string;
  replyViaAlias?: string;
  aliasLabel?: string;
  category?: FocusedCategory;
  categoryOverride?: string | null;
}

function getAttachmentExt(filename: string): string {
  const ext = filename.split(".").pop()?.toUpperCase() || "";
  return ext.length > 4 ? ext.slice(0, 4) : ext;
}

/**
 * Merges messages from multiple connected accounts into a unified list.
 * Each message row is tagged with its owning mailbox ID, account email,
 * and deterministic account color chip.
 * Results are client-side deduplicated by message ID and sorted descending
 * by received_at / date.
 */
export function mergeUnifiedMessages(
  accountData: Array<{
    account: ConnectedAccount;
    messages: MessageMetadata[];
    attachments?: AttachmentItem[];
  }>,
  timeFormat: "12h" | "24h" = "12h",
  language: string = "en"
): DisplayMessage[] {
  const allDisplayMessages: DisplayMessage[] = [];
  const seenIds = new Set<string>();

  for (const { account, messages, attachments = [] } of accountData) {
    const color = getAccountColor(account.id);
    const attachmentsByMsgId = new Map<string, AttachmentItem[]>();
    for (const att of attachments) {
      if (att.message_id) {
        const existing = attachmentsByMsgId.get(att.message_id) || [];
        existing.push(att);
        attachmentsByMsgId.set(att.message_id, existing);
      }
    }

    for (const m of messages) {
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);

      const cachedSubject = typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("byos_msg_subject_" + m.id)
        : null;
      const cachedSnippet = typeof sessionStorage !== "undefined"
        ? sessionStorage.getItem("byos_msg_snippet_" + m.id)
        : null;

      const msgAtts = attachmentsByMsgId.get(m.id) || [];
      const uniqueTypes = Array.from(
        new Set(
          msgAtts
            .map((a) => getAttachmentExt(a.filename))
            .filter(Boolean)
        )
      );
      const attCount = msgAtts.length > 0 ? msgAtts.length : (m.has_attachments ? 1 : 0);

      const rawDate = m.received_at || m.sent_at || m.scheduled_at || new Date().toISOString();

      allDisplayMessages.push({
        id: m.id,
        messageId: m.id,
        messageSeq: m.message_seq,
        folder: "inbox",
        folderId: m.folder_id || null,
        labelIds: m.label_ids || [],
        sender: m.sender,
        recipient: (m.recipients || []).join(", "),
        recipients: m.recipients || [],
        subject: cachedSubject || "(Encrypted message)",
        snippet: cachedSnippet || `Encrypted payload • ${m.storage_object_id || ""}`,
        encryptedBody: m.storage_object_id || "",
        scheduledAt: rawDate,
        date: formatMessageDate(rawDate, timeFormat, language),
        read: m.is_read ?? false,
        starred: m.is_starred ?? false,
        snoozedUntil: m.snoozed_until,
        isRealApi: true,
        hasAttachments: m.has_attachments || msgAtts.length > 0,
        attachmentCount: attCount,
        attachmentTypes: uniqueTypes,
        mailboxId: account.id,
        accountEmail: account.email,
        accountColor: color,
        replyViaAlias: m.reply_via_alias,
        aliasLabel: m.alias_label,
        category: (m.category_override as FocusedCategory) || "primary",
        categoryOverride: m.category_override,
      });
    }
  }

  // Sort by received_at / date descending using raw timestamps
  return allDisplayMessages.sort((a, b) => {
    const timeA = new Date(a.scheduledAt || a.date).getTime();
    const timeB = new Date(b.scheduledAt || b.date).getTime();
    return timeB - timeA;
  });
}

/**
 * Filter unified messages based on user exclusion preferences.
 */
export function filterUnifiedMessages(
  messages: DisplayMessage[],
  excludedAccountIds: string[]
): DisplayMessage[] {
  if (!excludedAccountIds || excludedAccountIds.length === 0) return messages;
  const excludedSet = new Set(excludedAccountIds);
  return messages.filter((m) => !m.mailboxId || !excludedSet.has(m.mailboxId));
}

/**
 * Resolves the From: email address when replying/forwarding a message.
 * Must match the message's owning account, NOT the active account.
 */
export function getReplyFromAddress(
  message: { mailboxId?: string; accountEmail?: string },
  activeAccount: ConnectedAccount | null,
  connectedAccounts: ConnectedAccount[]
): string {
  if (message.mailboxId) {
    const matched = connectedAccounts.find((a) => a.id === message.mailboxId);
    if (matched && matched.email) return matched.email;
  }
  if (message.accountEmail) return message.accountEmail;
  return activeAccount?.email || "";
}

/**
 * Determines target mailbox ID and authorization token for routing actions (snooze, star, etc.)
 */
export function getTargetAccountForAction(
  message: { mailboxId?: string },
  activeAccountId: string,
  connectedAccounts: ConnectedAccount[]
): { mailboxId: string; token?: string } {
  const targetId = message.mailboxId || activeAccountId;
  const acc = connectedAccounts.find((a) => a.id === targetId);
  return {
    mailboxId: targetId,
    token: acc?.sessionToken,
  };
}

/**
 * Client-side search deduplication across accounts.
 */
export function deduplicateSearchResults<T extends { id: string }>(results: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of results) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

/**
 * Multi-account SSE router interface.
 */
export interface MailboxEventData {
  type: string;
  mailboxId: string;
  folder?: string;
  messageId?: string;
  unreadDelta?: number;
}

export class MultiAccountSSEManager {
  private activeStreams = new Map<string, { close: () => void }>();
  private listeners = new Map<string, Set<(event: MailboxEventData) => void>>();

  connect(
    mailboxId: string,
    factory: (mailboxId: string, onEvent: (ev: MailboxEventData) => void) => { close: () => void }
  ) {
    if (this.activeStreams.has(mailboxId)) return;
    const stream = factory(mailboxId, (ev) => {
      this.routeEvent(ev);
    });
    this.activeStreams.set(mailboxId, stream);
  }

  disconnect(mailboxId: string) {
    const stream = this.activeStreams.get(mailboxId);
    if (stream) {
      stream.close();
      this.activeStreams.delete(mailboxId);
    }
  }

  disconnectAll() {
    for (const [id] of this.activeStreams) {
      this.disconnect(id);
    }
  }

  isConnected(mailboxId: string): boolean {
    return this.activeStreams.has(mailboxId);
  }

  addListener(mailboxId: string, listener: (event: MailboxEventData) => void) {
    let set = this.listeners.get(mailboxId);
    if (!set) {
      set = new Set();
      this.listeners.set(mailboxId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  routeEvent(event: MailboxEventData) {
    if (!event || !event.mailboxId) return;
    const set = this.listeners.get(event.mailboxId);
    if (set) {
      for (const listener of set) {
        listener(event);
      }
    }
  }
}

/**
 * Resolves the account chip label and selection state.
 */
export function getAccountChipSelection(
  activeAccountId: string,
  currentEmail: string,
  connectedAccounts: ConnectedAccount[]
): { label: string; isAll: boolean; color: string } {
  const isAll = activeAccountId === "__all__";
  if (isAll) {
    return {
      label: "All Inboxes",
      isAll: true,
      color: "#A27561",
    };
  }
  const acc = connectedAccounts.find(
    (a) => a.id === activeAccountId || (currentEmail && a.email?.toLowerCase() === currentEmail.toLowerCase())
  );
  return {
    label: acc?.email || currentEmail || "Account",
    isAll: false,
    color: getAccountColor(activeAccountId || acc?.id || ""),
  };
}

/**
 * Returns the dropdown options including "All Inboxes" and connected accounts.
 */
export function getAccountDropdownOptions(
  connectedAccounts: ConnectedAccount[],
  activeAccountId: string
): Array<{ id: string; email: string; label: string; isAll: boolean; isSelected: boolean; color: string }> {
  const isAll = activeAccountId === "__all__";
  const options: Array<{ id: string; email: string; label: string; isAll: boolean; isSelected: boolean; color: string }> = [];
  if (connectedAccounts.length > 1) {
    options.push({
      id: "__all__",
      email: "",
      label: "All Inboxes",
      isAll: true,
      isSelected: isAll,
      color: "#A27561",
    });
  }
  options.push(
    ...connectedAccounts.map((acc) => ({
      id: acc.id,
      email: acc.email,
      label: acc.email,
      isAll: false,
      isSelected: !isAll && acc.id === activeAccountId,
      color: getAccountColor(acc.id),
    }))
  );
  return options;
}

/**
 * Returns the dynamic folder list for the sidebar based on active account selection.
 */
export function getSidebarFoldersForSelection(
  activeAccountId: string,
  folderCounts: Record<string, number>,
  unifiedUnreadCount: number
): Array<{ id: string; label: string; count: number; isTopInbox: boolean; color: string }> {
  const isAll = activeAccountId === "__all__";
  const selectionColor = isAll ? "#A27561" : getAccountColor(activeAccountId);

  const topInbox = isAll
    ? {
        id: "unified_inbox",
        label: "All Inboxes",
        count: unifiedUnreadCount || 0,
        isTopInbox: true,
        color: selectionColor,
      }
    : {
        id: "inbox",
        label: "Inbox",
        count: folderCounts["inbox"] || 0,
        isTopInbox: true,
        color: selectionColor,
      };

  const remainingFolders = ["sent", "scheduled", "drafts", "snoozed", "archive", "spam", "trash"].map((f) => ({
    id: f,
    label: f.charAt(0).toUpperCase() + f.slice(1),
    count: folderCounts[f] || 0,
    isTopInbox: false,
    color: selectionColor,
  }));

  return [topInbox, ...remainingFolders];
}

export interface MailboxKeyMaterial {
  xwingSeedHex: string;
  mailboxSkHex: string;
}

/**
 * Resolves the cryptographic keys (X-Wing seed and/or mailbox secret key)
 * for a message strictly using its owning mailbox ID (message.mailbox_id / message.mailboxId).
 * Returns null if the key material is not present/unlocked.
 */
export function getMailboxKeyForMessage(
  message: DisplayMessage | { mailbox_id?: string; mailboxId?: string },
  keyMap?: Map<string, MailboxKeyMaterial> | Record<string, MailboxKeyMaterial>,
): { xwingSeedHex: string; mailboxSkHex: string } | null {
  const boxId = (message as any)?.mailbox_id || (message as DisplayMessage)?.mailboxId;
  if (!boxId) return null;

  if (keyMap) {
    if (keyMap instanceof Map) {
      const entry = keyMap.get(boxId);
      if (entry && (entry.xwingSeedHex || entry.mailboxSkHex)) return entry;
      return null;
    }
    const entry = (keyMap as Record<string, MailboxKeyMaterial>)[boxId];
    if (entry && (entry.xwingSeedHex || entry.mailboxSkHex)) return entry;
    return null;
  }

  if (typeof sessionStorage !== "undefined") {
    const xwingSeedHex = sessionStorage.getItem("byos_xwing_seed_" + boxId) || "";
    const mailboxSkHex = sessionStorage.getItem("byos_mailbox_sk_" + boxId) || "";
    if (xwingSeedHex || mailboxSkHex) {
      return { xwingSeedHex, mailboxSkHex };
    }
  }

  return null;
}
