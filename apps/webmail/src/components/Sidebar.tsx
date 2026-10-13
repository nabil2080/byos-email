import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { StorageStatusPill } from "./StorageStatusPill";
import { UserMe, Mailbox, ConnectedAccount, MailboxFolder, MailboxLabel, getAccountColor } from "../api";
import { AccountSwitcher } from "./AccountSwitcher";
import {
  buildLabelTree,
  flattenVisibleLabelTree,
  loadExpandedLabels,
  saveExpandedLabels,
} from "../utils/nested_labels";

export type Folder = "inbox" | "sent" | "scheduled" | "drafts" | "snoozed" | "archive" | "spam" | "trash" | "unified_inbox";

interface SidebarProps {
  currentUser: UserMe | null;
  selectedMailbox: Mailbox | null;
  currentFolder: Folder;
  onSelectFolder: (folder: Folder) => void;
  folderCounts: Record<Folder, number>;
  onCompose: () => void;
  onOpenContacts: () => void;
  onOpenSettings: () => void;
  onOpenImport?: () => void;
  onLogout: (accountId?: string, logOutAll?: boolean) => void;
  isUnlocked?: boolean;
  storageError?: string | null;
  connectedAccounts?: ConnectedAccount[];
  onSelectAccount?: (account: ConnectedAccount) => void;
  onSelectAllInboxes?: () => void;
  activeAccountId?: string;
  onOpenAddMailbox?: () => void;
  customFolders?: MailboxFolder[];
  activeFolderId?: string | null;
  onSelectCustomFolder?: (folder: MailboxFolder) => void;
  onOpenCreateFolder?: () => void;
  onEditFolder?: (folder: MailboxFolder) => void;
  onDeleteFolder?: (folder: MailboxFolder) => void;
  labels?: MailboxLabel[];
  activeLabelId?: string | null;
  onSelectLabel?: (label: MailboxLabel) => void;
  onOpenCreateLabel?: () => void;
  onEditLabel?: (label: MailboxLabel) => void;
  onNewSublabel?: (parentLabel: MailboxLabel) => void;
  onChangeParent?: (label: MailboxLabel) => void;
  onDeleteLabel?: (label: MailboxLabel) => void;
  onMoveMessages?: (messageIds: string[], folderOrId: string) => void;
  onAttachLabel?: (messageIds: string[], labelId: string) => void;
  customFolderCounts?: Record<string, number>;
  labelCounts?: Record<string, number>;
  theme?: string;
  onToggleTheme?: () => void;
  onSetTheme?: (theme: "cloud_dancer" | "dark") => void;
  class?: string;
  onCloseMobile?: () => void;
  unifiedUnreadCount?: number;
  accountUnreadCounts?: Record<string, number>;
  excludedAccountIds?: Set<string> | string[];
  onToggleAccountInclusion?: (accountId: string, included?: boolean) => void;
}

export const Sidebar: Component<SidebarProps> = (props) => {
  const [dragOverTarget, setDragOverTarget] = createSignal<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = createSignal<string | null>(null);
  const [openLabelMenuId, setOpenLabelMenuId] = createSignal<string | null>(null);
  const [expandedLabelIds, setExpandedLabelIds] = createSignal<Set<string>>(new Set());
  const [showUnifiedConfig, setShowUnifiedConfig] = createSignal(false);

  // Load expanded labels on mount or mailbox change
  createEffect(() => {
    const boxId = props.selectedMailbox?.id;
    if (boxId) {
      setExpandedLabelIds(loadExpandedLabels(boxId));
    }
  });

  function toggleExpandLabel(labelId: string) {
    const boxId = props.selectedMailbox?.id;
    setExpandedLabelIds((prev) => {
      const next = new Set(prev);
      if (next.has(labelId)) {
        next.delete(labelId);
      } else {
        next.add(labelId);
      }
      if (boxId) {
        saveExpandedLabels(boxId, next);
      }
      return next;
    });
  }

  const labelTree = () => buildLabelTree(props.labels || []);
  const visibleLabels = () => flattenVisibleLabelTree(labelTree(), expandedLabelIds());

  onMount(() => {
    const handleGlobalClick = () => {
      setOpenFolderMenuId(null);
      setOpenLabelMenuId(null);
    };
    window.addEventListener("click", handleGlobalClick);
    onCleanup(() => {
      window.removeEventListener("click", handleGlobalClick);
    });
  });

  function handleDrop(e: DragEvent, targetId: string, isLabel = false) {
    e.preventDefault();
    setDragOverTarget(null);
    const raw = e.dataTransfer?.getData("application/json");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.messageIds) && parsed.messageIds.length > 0) {
        if (isLabel) {
          props.onAttachLabel?.(parsed.messageIds, targetId);
        } else {
          props.onMoveMessages?.(parsed.messageIds, targetId);
        }
      }
    } catch {}
  }
  const folderLabels: Record<Folder, string> = {
    inbox: "Inbox",
    sent: "Sent",
    scheduled: "Scheduled",
    drafts: "Drafts",
    archive: "Archive",
    spam: "Spam",
    trash: "Trash",
    snoozed: "Snoozed",
    unified_inbox: "Unified Inbox",
  };

  function renderFolderIcon(f: Folder) {
    switch (f) {
      case "inbox":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
        );
      case "sent":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        );
      case "scheduled":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
            <line x1="18.5" y1="5.5" x2="20.5" y2="3.5" />
            <polyline points="19 3 21 3 21 5" />
          </svg>
        );
      case "drafts":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        );
      case "archive":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        );
      case "spam":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        );
      case "snoozed":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        );
      case "trash":
        return (
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        );
    }
  }

  const mailboxEmail = () => {
    if (!props.selectedMailbox) return props.currentUser?.email || "byos.email";
    if ((props.selectedMailbox as any)?.email) return (props.selectedMailbox as any).email;
    if ((props.selectedMailbox as any)?.domain_name) {
      return `${props.selectedMailbox.local_part}@${(props.selectedMailbox as any).domain_name}`;
    }
    const domain = props.currentUser?.email?.split("@")[1] || "byos.email";
    return `${props.selectedMailbox.local_part}@${domain}`;
  };

  const isPrivate = () => props.selectedMailbox?.mode === "private";

  const isAllInboxes = () =>
    props.activeAccountId === "__all__" || props.currentFolder === "unified_inbox";

  const currentSelectionColor = () => {
    if (isAllInboxes()) {
      return "#A27561";
    }
    const targetId = props.activeAccountId || props.selectedMailbox?.id || props.connectedAccounts?.[0]?.id || "";
    return getAccountColor(targetId);
  };

  return (
    <aside class={`w-full md:w-64 flex-shrink-0 bg-[#F0EEE9] dark:bg-[#18191D] flex flex-col justify-between select-none h-full relative ${props.class || ""}`}>
      {/* FIXED TOP: Brand Header & Mode Toggle, Account Switcher, Compose, Quick Actions */}
      <div class="p-2 pb-2 relative z-50 overflow-visible space-y-2 flex-shrink-0">
        {/* Top-Left App Brand Header */}
        <div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-lg bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider">
              B
            </div>
            <span class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">BYOS Mail</span>
          </div>
          <Show when={props.onCloseMobile}>
            <button
              type="button"
              onClick={props.onCloseMobile}
              class="md:hidden flex items-center justify-center w-8 h-8 rounded-lg text-[#6F7173] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] transition cursor-pointer"
              title="Close navigation menu"
              aria-label="Close navigation menu"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>

        {/* User Identity & Account Switcher (Top-Left) */}
        <AccountSwitcher
          currentEmail={mailboxEmail()}
          isPrivate={isPrivate()}
          connectedAccounts={props.connectedAccounts || []}
          activeAccountId={props.activeAccountId || (isAllInboxes() ? "__all__" : props.selectedMailbox?.id || "")}
          onSelectAccount={(acc) => {
            props.onSelectAccount?.(acc);
            props.onCloseMobile?.();
          }}
          onSelectAllInboxes={() => {
            if (props.onSelectAllInboxes) {
              props.onSelectAllInboxes();
            } else {
              props.onSelectFolder("unified_inbox");
            }
            props.onCloseMobile?.();
          }}
          onOpenAddMailbox={() => {
            props.onOpenAddMailbox?.();
            props.onCloseMobile?.();
          }}
          onSignOut={props.onLogout}
          unreadCounts={props.accountUnreadCounts}
          totalUnifiedUnread={props.unifiedUnreadCount}
        />

        {/* Compose Pill & Quick Actions */}
        <div class="space-y-1.5">
          <button
            data-testid="sidebar-compose-btn"
            onClick={() => {
              props.onCompose();
              props.onCloseMobile?.();
            }}
            class="w-full bg-[#A27561] hover:bg-[#8F6452] dark:bg-[#A27561] dark:hover:bg-[#B2826F] text-white text-xs font-medium py-2.5 px-3.5 min-h-[40px] rounded-xl shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Message</span>
          </button>

          {/* Sub-actions: Contacts, Import & Settings */}
          <div class="grid grid-cols-3 gap-1 pt-0.5">
            <button
              onClick={() => {
                props.onOpenContacts();
                props.onCloseMobile?.();
              }}
              class="flex items-center justify-center gap-1 py-2 px-1.5 min-h-[36px] rounded-lg text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] transition-colors cursor-pointer"
              title="Contacts"
              data-testid="contacts-nav-btn"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>Contacts</span>
            </button>

            <button
              onClick={() => {
                props.onOpenImport?.();
                props.onCloseMobile?.();
              }}
              class="flex items-center justify-center gap-1 py-2 px-1.5 min-h-[36px] rounded-lg text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] transition-colors cursor-pointer"
              title="Import Emails (.eml / .mbox)"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>Import</span>
            </button>

            <button
              onClick={() => {
                props.onOpenSettings();
                props.onCloseMobile?.();
              }}
              data-testid="sidebar-settings-btn"
              class="flex items-center justify-center gap-1 py-2 px-1.5 min-h-[36px] rounded-lg text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] transition-colors cursor-pointer"
              title="Settings"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>Settings</span>
            </button>
          </div>
        </div>
      </div>

      {/* SCROLLABLE MIDDLE: Folders & Labels (z-10, overflow-y-auto) */}
      <div class="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-3 custom-scrollbar relative z-10">
        {/* Navigation Folders List */}
        <nav class="space-y-0.5">
          {/* Dynamic Top Inbox Folder: 'All Inboxes' when Unified, or 'Inbox' for selected account */}
          <div class="relative group">
            <button
              type="button"
              onClick={() => {
                if (isAllInboxes()) {
                  if (props.onSelectAllInboxes) {
                    props.onSelectAllInboxes();
                  } else {
                    props.onSelectFolder("unified_inbox");
                  }
                } else {
                  props.onSelectFolder("inbox");
                }
                props.onCloseMobile?.();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                setDragOverTarget(isAllInboxes() ? "unified_inbox" : "inbox");
              }}
              onDragLeave={() => {
                if (dragOverTarget() === (isAllInboxes() ? "unified_inbox" : "inbox")) {
                  setDragOverTarget(null);
                }
              }}
              onDrop={(e) => handleDrop(e, isAllInboxes() ? "unified_inbox" : "inbox", false)}
              class={`w-full flex items-center justify-between px-3 py-2.5 md:py-2 min-h-[40px] text-sm rounded-xl transition-all cursor-pointer ${
                dragOverTarget() === (isAllInboxes() ? "unified_inbox" : "inbox")
                  ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                  : (isAllInboxes() ? props.currentFolder === "unified_inbox" : props.currentFolder === "inbox")
                  ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold"
                  : "text-[#3C3D3E] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"
              }`}
              data-testid={isAllInboxes() ? "unified-inbox-button" : "folder-inbox"}
            >
              <div class="flex items-center gap-2.5">
                <span
                  class="w-2 h-2 rounded-full flex-shrink-0 transition-colors"
                  style={{ "background-color": currentSelectionColor() }}
                  data-testid="folder-selection-dot"
                />
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                  <line x1="6" y1="2" x2="18" y2="2" />
                </svg>
                <span data-testid="folder-name-inbox">{isAllInboxes() ? "All Inboxes" : "Inbox"}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <Show when={(isAllInboxes() ? (props.unifiedUnreadCount || 0) : (props.folderCounts?.inbox || 0)) > 0}>
                  <span
                    class={`text-xs font-mono px-1.5 py-0.2 rounded-full ${
                      (isAllInboxes() ? props.currentFolder === "unified_inbox" : props.currentFolder === "inbox")
                        ? "bg-[#A27561] text-white font-semibold"
                        : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"
                    }`}
                    data-testid="folder-unread-inbox"
                  >
                    {isAllInboxes() ? props.unifiedUnreadCount : props.folderCounts?.inbox}
                  </span>
                </Show>
                <Show when={isAllInboxes() && (props.connectedAccounts?.length || 0) > 1}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowUnifiedConfig(!showUnifiedConfig());
                    }}
                    class="p-1 rounded-md text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer"
                    title="Configure accounts in Unified Inbox"
                    aria-label="Configure accounts in Unified Inbox"
                    data-testid="configure-unified-inbox-btn"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
                    </svg>
                  </button>
                </Show>
              </div>
            </button>

            {/* Popover to configure which accounts are included */}
            <Show when={isAllInboxes() && showUnifiedConfig()}>
              <div class="absolute left-2 right-2 top-full mt-1 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl p-2.5 z-50 text-xs space-y-2">
                <div class="flex items-center justify-between">
                  <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] text-[10px] uppercase tracking-wider font-mono">
                    Included Accounts
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowUnifiedConfig(false)}
                    class="text-[#878A8E] hover:text-[#1A1B1E] text-xs font-bold cursor-pointer"
                  >
                    ×
                  </button>
                </div>
                <div class="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                  <For each={props.connectedAccounts || []}>
                    {(acc) => {
                      const isIncluded = () => {
                        if (!props.excludedAccountIds) return true;
                        if (props.excludedAccountIds instanceof Set) {
                          return !props.excludedAccountIds.has(acc.id);
                        }
                        return !props.excludedAccountIds.includes(acc.id);
                      };
                      return (
                        <label class="flex items-center gap-2 cursor-pointer hover:bg-[#FAF9F7] dark:hover:bg-[#26282E] p-1 rounded-lg">
                          <input
                            type="checkbox"
                            checked={isIncluded()}
                            onChange={(e) => props.onToggleAccountInclusion?.(acc.id, e.currentTarget.checked)}
                            class="accent-[#A27561] rounded w-3.5 h-3.5 cursor-pointer"
                          />
                          <span
                            class="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ "background-color": getAccountColor(acc.id) }}
                          />
                          <span class="truncate font-medium text-[#2B2C2D] dark:text-[#ECEBE8]">
                            {acc.email}
                          </span>
                        </label>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          {/* Remaining Folders */}
          {(["sent", "scheduled", "drafts", "snoozed", "archive", "spam", "trash"] as Folder[]).map((f) => {
            const isActive = () => props.currentFolder === f;
            const isDropTarget = () => dragOverTarget() === f;
            const count = () => (props.folderCounts ? props.folderCounts[f] || 0 : 0);

            return (
              <button
                onClick={() => {
                  props.onSelectFolder(f);
                  props.onCloseMobile?.();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                  setDragOverTarget(f);
                }}
                onDragLeave={() => {
                  if (dragOverTarget() === f) setDragOverTarget(null);
                }}
                onDrop={(e) => handleDrop(e, f, false)}
                class={`w-full flex items-center justify-between px-3 py-2.5 md:py-2 min-h-[40px] text-sm rounded-xl transition-all cursor-pointer ${
                  isDropTarget()
                    ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                    : isActive()
                    ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold"
                    : "text-[#3C3D3E] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"
                }`}
                data-testid={`folder-${f}`}
              >
                <div class="flex items-center gap-2.5">
                  <span
                    class="w-2 h-2 rounded-full flex-shrink-0 transition-colors"
                    style={{ "background-color": currentSelectionColor() }}
                    data-testid="folder-selection-dot"
                  />
                  {renderFolderIcon(f)}
                  <span>{folderLabels[f]}</span>
                </div>
                <Show when={count() > 0}>
                  <span class={`text-xs font-mono ${isActive() ? "text-[#A27561] dark:text-[#D4A38F] font-semibold" : "text-[#6F7173] dark:text-[#808288]"}`}>
                    {count()}
                  </span>
                </Show>
              </button>
            );
          })}
        </nav>

        {/* Custom Folders Section */}
        <div class="px-2 pt-2 border-t border-[#E2DFD8]/50 dark:border-[#2E3138]">
          <div class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-[#878A8E] uppercase tracking-wider font-mono">
            <span>Folders</span>
            <button
              onClick={() => props.onOpenCreateFolder?.()}
              class="w-5 h-5 flex items-center justify-center rounded-md hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer transition"
              title="Create folder"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div class="space-y-0.5 mt-0.5">
            <For each={props.customFolders || []}>
              {(f) => {
                const isActive = () => props.activeFolderId === f.id;
                const isDropTarget = () => dragOverTarget() === f.id;
                return (
                  <div
                    onClick={() => {
                      props.onSelectCustomFolder?.(f);
                      props.onCloseMobile?.();
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      setDragOverTarget(f.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverTarget() === f.id) setDragOverTarget(null);
                    }}
                    onDrop={(e) => handleDrop(e, f.id, false)}
                    class={`group relative w-full flex items-center justify-between px-2.5 py-2 md:py-1.5 min-h-[38px] text-xs rounded-xl transition-all cursor-pointer ${
                      f.parent_id ? "pl-5" : ""
                    } ${
                      isDropTarget()
                        ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                        : isActive()
                        ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold"
                        : "text-[#3C3D3E] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"
                    }`}
                  >
                    <div class="flex items-center gap-2 truncate min-w-0 flex-1">
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      <span class="truncate">{f.name}</span>
                    </div>

                    <div class="flex items-center gap-1 flex-shrink-0">
                      <Show when={props.customFolderCounts && (props.customFolderCounts[f.id] || 0) > 0}>
                        <span class={`text-xs font-mono px-1.5 py-0.2 rounded ${
                          isActive() ? "text-[#A27561] dark:text-[#D4A38F] font-semibold" : "text-[#6F7173] dark:text-[#808288]"
                        }`}>
                          {props.customFolderCounts![f.id]}
                        </span>
                      </Show>

                      {/* 3-dots Context Menu Button */}
                      <div class="relative flex items-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenFolderMenuId(openFolderMenuId() === f.id ? null : f.id);
                            setOpenLabelMenuId(null);
                          }}
                          class={`p-1 rounded text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer ${
                            openFolderMenuId() === f.id ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          }`}
                          title="Folder options"
                        >
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>

                        <Show when={openFolderMenuId() === f.id}>
                          <div
                            class="absolute right-0 top-full mt-1 w-24 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg py-1 z-30 text-xs font-sans"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenFolderMenuId(null);
                                props.onEditFolder?.(f);
                              }}
                              class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2A2522] text-[#3C3D3E] dark:text-[#ECEBE8] hover:text-[#A27561] dark:hover:text-[#D4A38F] transition cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenFolderMenuId(null);
                                props.onDeleteFolder?.(f);
                              }}
                              class="w-full text-left px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
            <Show when={!props.customFolders || props.customFolders.length === 0}>
              <div class="px-3 py-1 text-[11px] text-[#878A8E] italic">No folders</div>
            </Show>
          </div>
        </div>

        {/* Labels Section */}
        <div class="px-2 pt-2 border-t border-[#E2DFD8]/50 dark:border-[#2E3138]">
          <div class="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-[#878A8E] uppercase tracking-wider font-mono">
            <span>Labels</span>
            <button
              onClick={() => props.onOpenCreateLabel?.()}
              class="w-5 h-5 flex items-center justify-center rounded-md hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer transition"
              title="Create label"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div class="space-y-0.5 mt-0.5" role="tree" aria-label="Labels">
            <For each={visibleLabels()}>
              {(node) => {
                const isActive = () => props.activeLabelId === node.label.id;
                const isDropTarget = () => dragOverTarget() === node.label.id;
                return (
                  <div
                    tabIndex={0}
                    role="treeitem"
                    aria-expanded={node.hasChildren ? node.isExpanded : undefined}
                    aria-label={`${node.label.name}${node.hasChildren ? (node.isExpanded ? ", expanded" : ", collapsed") : ""}`}
                    onClick={() => {
                      props.onSelectLabel?.(node.label);
                      props.onCloseMobile?.();
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenLabelMenuId(openLabelMenuId() === node.label.id ? null : node.label.id);
                      setOpenFolderMenuId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        props.onSelectLabel?.(node.label);
                        props.onCloseMobile?.();
                      } else if (e.key === "ArrowRight") {
                        if (node.hasChildren && !node.isExpanded) {
                          e.preventDefault();
                          toggleExpandLabel(node.label.id);
                        }
                      } else if (e.key === "ArrowLeft") {
                        if (node.hasChildren && node.isExpanded) {
                          e.preventDefault();
                          toggleExpandLabel(node.label.id);
                        }
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      setDragOverTarget(node.label.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverTarget() === node.label.id) setDragOverTarget(null);
                    }}
                    onDrop={(e) => handleDrop(e, node.label.id, true)}
                    style={{ "padding-left": `${node.depth * 12 + 6}px` }}
                    class={`group relative w-full flex items-center justify-between pr-2.5 py-1.5 min-h-[36px] text-xs rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                      isDropTarget()
                        ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#9E725F] border-dashed rounded-xl scale-[1.02]"
                        : isActive()
                        ? "bg-[#F2E8E2] text-[#9E725F] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold"
                        : "text-[#3C3D3E] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"
                    }`}
                  >
                    <div class="flex items-center gap-1.5 truncate min-w-0 flex-1">
                      {/* Chevron or Spacer */}
                      <Show
                        when={node.hasChildren}
                        fallback={<span class="w-4 h-4 flex-shrink-0" />}
                      >
                        <button
                          type="button"
                          aria-label={node.isExpanded ? "Collapse" : "Expand"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpandLabel(node.label.id);
                          }}
                          class="w-4 h-4 flex items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 transition-transform duration-150 cursor-pointer flex-shrink-0 text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6]"
                          style={{
                            transform: node.isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                          }}
                        >
                          <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      </Show>

                      {/* Color Dot */}
                      <span
                        class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ "background-color": node.label.color }}
                      />
                      <span class="truncate" title={node.label.path || node.label.name}>
                        {node.label.name}
                      </span>
                    </div>

                    <div class="flex items-center gap-1 flex-shrink-0">
                      {/* Unread badge: sum of own + descendants */}
                      <Show when={props.labelCounts && (props.labelCounts[node.label.id] || 0) > 0}>
                        <span
                          class={`text-xs font-mono px-1.5 py-0.2 rounded ${
                            isActive()
                              ? "text-[#9E725F] dark:text-[#D4A38F] font-semibold"
                              : "text-[#6F7173] dark:text-[#808288]"
                          }`}
                        >
                          {props.labelCounts![node.label.id]}
                        </span>
                      </Show>

                      {/* 3-dots Context Menu Button */}
                      <div class="relative flex items-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenLabelMenuId(openLabelMenuId() === node.label.id ? null : node.label.id);
                            setOpenFolderMenuId(null);
                          }}
                          class={`p-1 rounded text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer ${
                            openLabelMenuId() === node.label.id ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          }`}
                          title="Label options"
                        >
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>

                        <Show when={openLabelMenuId() === node.label.id}>
                          <div
                            class="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg py-1 z-30 text-xs font-sans"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                props.onEditLabel?.(node.label);
                              }}
                              class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2A2522] text-[#3C3D3E] dark:text-[#ECEBE8] hover:text-[#9E725F] dark:hover:text-[#D4A38F] transition cursor-pointer"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                props.onNewSublabel?.(node.label);
                              }}
                              class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2A2522] text-[#3C3D3E] dark:text-[#ECEBE8] hover:text-[#9E725F] dark:hover:text-[#D4A38F] transition cursor-pointer"
                            >
                              New sublabel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                props.onChangeParent?.(node.label);
                              }}
                              class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2A2522] text-[#3C3D3E] dark:text-[#ECEBE8] hover:text-[#9E725F] dark:hover:text-[#D4A38F] transition cursor-pointer"
                            >
                              Change parent
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                props.onDeleteLabel?.(node.label);
                              }}
                              class="w-full text-left px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition cursor-pointer"
                            >
                              Delete
                            </button>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
            <Show when={!props.labels || props.labels.length === 0}>
              <div class="px-3 py-1 text-[11px] text-[#878A8E] italic">No labels</div>
            </Show>
          </div>
        </div>

      </div>

      {/* FIXED BOTTOM: Ambient Storage Pill & Sign Out (z-40, overflow-visible) */}
      <div class="p-2 border-t border-[#E2DFD8]/70 dark:border-[#333336] space-y-1 relative z-40 overflow-visible flex-shrink-0">
        <StorageStatusPill
          isUnlocked={Boolean(props.isUnlocked)}
          storageError={props.storageError}
        />

        <div class="flex items-center justify-between px-2 py-1 text-xs text-[#878A8E]">
          <span class="text-[11px] truncate max-w-[120px] font-mono">
            {props.currentUser?.email?.split("@")[0] || "User"}
          </span>
          <button
            onClick={() => props.onLogout?.(props.selectedMailbox?.id, false)}
            class="text-[11px] text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:underline cursor-pointer font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
};
