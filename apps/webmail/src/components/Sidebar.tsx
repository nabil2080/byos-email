import { Component, Show, For, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { UserMe, Mailbox, ConnectedAccount, MailboxFolder, MailboxLabel, getAccountColor } from "../api";
import { AccountSwitcher } from "./AccountSwitcher";
import { FocusedCategory } from "../focused_inbox";
import {
  buildLabelTree,
  flattenVisibleLabelTree,
  loadExpandedLabels,
  saveExpandedLabels,
} from "../utils/nested_labels";
import { t } from "../utils/i18n";

export type Folder = "inbox" | "sent" | "scheduled" | "drafts" | "snoozed" | "archive" | "spam" | "trash" | "unified_inbox";

function getFolderName(folder: Folder | string): string {
  switch (folder) {
    case "inbox": return t("Inbox");
    case "sent": return t("Sent");
    case "drafts": return t("Drafts");
    case "trash": return t("Trash");
    case "archive": return t("Archive");
    case "spam": return t("Spam");
    case "starred": return t("Starred");
    case "snoozed": return t("Snoozed");
    case "scheduled": return t("Scheduled");
    case "unified_inbox": return t("All Inboxes");
    default: return folder;
  }
}

interface SidebarProps {
  currentUser: UserMe | null;
  selectedMailbox: Mailbox | null;
  currentFolder: Folder;
  onSelectFolder: (folder: Folder) => void;
  folderCounts: Record<Folder, number>;
  onCompose: () => void;
  onOpenContacts: () => void;
  onOpenCalendar?: () => void;
  activeModule?: "mail" | "calendar" | "notes";
  onSwitchModule?: (mod: "mail" | "calendar" | "notes") => void;
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
  focusedInboxEnabled?: boolean;
  focusedCategory?: FocusedCategory;
  onSelectCategory?: (cat: FocusedCategory) => void;
  categoryCounts?: Record<FocusedCategory, { total: number; unread: number }>;
  onOpenSubscriptions?: () => void;
  profilePhotoUrl?: string | null;
  photoUrls?: Record<string, string>;
}

export const Sidebar: Component<SidebarProps> = (props) => {
  const [dragOverTarget, setDragOverTarget] = createSignal<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = createSignal<string | null>(null);
  const [openLabelMenuId, setOpenLabelMenuId] = createSignal<string | null>(null);
  const [expandedLabelIds, setExpandedLabelIds] = createSignal<Set<string>>(new Set());
  const [showUnifiedConfig, setShowUnifiedConfig] = createSignal(false);

  // Morphing sliding highlight pills for Folders, Custom Folders, and Labels
  const [navPillStyle, setNavPillStyle] = createSignal<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0,
  });
  const folderRefs = new Map<string, HTMLElement>();

  const [customFolderPillStyle, setCustomFolderPillStyle] = createSignal<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0,
  });
  const customFolderRefs = new Map<string, HTMLElement>();

  const [labelPillStyle, setLabelPillStyle] = createSignal<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 0,
    opacity: 0,
  });
  const labelRefs = new Map<string, HTMLElement>();

  const activeFolderKey = () => {
    if (props.activeLabelId || props.activeFolderId) return null;
    if (props.focusedCategory && props.focusedCategory !== "primary" && props.currentFolder === "inbox") {
      return null;
    }
    if (props.activeAccountId === "__all__" || props.currentFolder === "unified_inbox") {
      return "unified_inbox";
    }
    return props.currentFolder;
  };

  const updateFolderPill = () => {
    const key = activeFolderKey();
    if (!key) {
      setNavPillStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const el = folderRefs.get(key);
    if (el) {
      setNavPillStyle({
        top: el.offsetTop,
        height: el.offsetHeight,
        opacity: 1,
      });
    } else {
      setNavPillStyle((prev) => ({ ...prev, opacity: 0 }));
    }
  };

  const updateCustomFolderPill = () => {
    const activeId = props.activeFolderId;
    if (activeId && customFolderRefs.has(activeId)) {
      const el = customFolderRefs.get(activeId);
      if (el) {
        setCustomFolderPillStyle({
          top: el.offsetTop,
          height: el.offsetHeight,
          opacity: 1,
        });
        return;
      }
    }
    setCustomFolderPillStyle((prev) => ({ ...prev, opacity: 0 }));
  };

  const updateLabelPill = () => {
    const activeId = props.activeLabelId;
    if (activeId && labelRefs.has(activeId)) {
      const el = labelRefs.get(activeId);
      if (el) {
        setLabelPillStyle({
          top: el.offsetTop,
          height: el.offsetHeight,
          opacity: 1,
        });
        return;
      }
    }
    setLabelPillStyle((prev) => ({ ...prev, opacity: 0 }));
  };

  createEffect(() => {
    activeFolderKey();
    updateFolderPill();
    setTimeout(updateFolderPill, 20);
  });

  createEffect(() => {
    props.activeFolderId;
    updateCustomFolderPill();
    setTimeout(updateCustomFolderPill, 20);
  });

  createEffect(() => {
    props.activeLabelId;
    updateLabelPill();
    setTimeout(updateLabelPill, 20);
  });

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
    const triggerAllPills = () => {
      updateFolderPill();
      updateCustomFolderPill();
      updateLabelPill();
    };
    setTimeout(triggerAllPills, 30);
    setTimeout(triggerAllPills, 100);
    setTimeout(triggerAllPills, 250);

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
  const folderLabels = (f: Folder): string => getFolderName(f);

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
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
            <circle cx="15" cy="16" r="3" />
            <polyline points="15 15 15 16 16 16" />
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
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
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
      default:
        return null;
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

  return (
    <aside data-testid="sidebar" class={`w-full md:w-64 flex-shrink-0 bg-[#F0EEE9] dark:bg-[#18191D] flex flex-col justify-between select-none h-full relative ${props.class || ""}`}>
      {/* FIXED TOP: Brand Header & Mode Toggle, Account Switcher, Compose, Quick Actions */}
      <div class="p-2 pb-2 relative z-50 overflow-visible space-y-2 flex-shrink-0">
        {/* Top-Left App Brand Header */}
        <div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-xl bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30">
              B
            </div>
            <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">BYOS Mail</span>
          </div>
          <Show when={props.onCloseMobile}>
            <button
              type="button"
              onClick={props.onCloseMobile}
              class="md:hidden flex items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl text-[#6F7173] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] transition cursor-pointer"
              title="Close navigation menu"
              aria-label="Close navigation menu"
            >
              <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
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
          profilePhotoUrl={props.profilePhotoUrl}
          photoUrls={props.photoUrls}
        />



        {/* Compose Pill & Quick Actions */}
        <div class="space-y-1.5">
          <button
            data-testid="sidebar-compose-btn"
            onClick={() => {
              props.onCompose();
              props.onCloseMobile?.();
            }}
            class="w-full bg-gradient-to-b from-[#A27561] via-[#986A57] to-[#8E6351] hover:from-[#966855] hover:to-[#825746] text-white text-[13px] tracking-wide font-semibold py-2.5 px-4 min-h-[44px] rounded-xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.3),0_2px_4px_rgba(162,117,97,0.25)] hover:shadow-[inset_0_1px_1px_rgba(255,255,255,0.35),0_3px_8px_rgba(162,117,97,0.3)] transition-all duration-150 flex items-center justify-between cursor-pointer active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40"
          >
            <div class="flex items-center gap-2">
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{t("New Message")}</span>
            </div>
            <kbd class="hidden sm:inline-block text-xs font-mono text-white/80 bg-black/20 px-1.5 py-0.5 rounded border border-white/15 leading-none">C</kbd>
          </button>
        </div>
      </div>

      {/* SCROLLABLE MIDDLE: Folders & Labels (z-10, overflow-y-auto) */}
      <div class="flex-1 min-h-0 overflow-y-auto px-2 py-1 space-y-3 custom-scrollbar relative z-10">
        {/* Navigation Folders List with Morphing Pill */}
        <nav data-testid="sidebar-folders-nav" class="space-y-0.5 relative">
          {/* Morphing Sliding Highlight Pill */}
          <div
            data-testid="sidebar-folder-pill"
            class="absolute left-0 right-0 rounded-xl bg-[#F2E8E2] dark:bg-[#2D2522] shadow-2xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
            style={{
              top: `${navPillStyle().top}px`,
              height: `${navPillStyle().height}px`,
              opacity: navPillStyle().opacity,
            }}
          />

          {/* Dynamic Top Inbox Folder: 'All Inboxes' when Unified, or 'Inbox' for selected account */}
          <div class="relative group">
            <button
              ref={(el) => {
                if (el) {
                  folderRefs.set("inbox", el);
                  folderRefs.set("unified_inbox", el);
                  updateFolderPill();
                }
              }}
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
                  props.onSelectCategory?.("primary");
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
              class={`relative z-10 w-full flex items-center justify-between px-3 py-2 min-h-[36px] text-sm rounded-xl transition-all duration-150 cursor-pointer select-none bg-transparent ${
                dragOverTarget() === (isAllInboxes() ? "unified_inbox" : "inbox")
                  ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                  : (isAllInboxes() ? props.currentFolder === "unified_inbox" : (props.currentFolder === "inbox" && (!props.focusedCategory || props.focusedCategory === "primary")))
                  ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
                  : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
              }`}
              data-testid={isAllInboxes() ? "unified-inbox-button" : "folder-inbox"}
            >
              <div class="flex items-center gap-2.5">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                  <line x1="6" y1="2" x2="18" y2="2" />
                </svg>
                <span data-testid="folder-name-inbox">{isAllInboxes() ? t("All Inboxes") : t("Inbox")}</span>
              </div>
              <div class="flex items-center gap-1.5">
                <Show when={(isAllInboxes() ? (props.unifiedUnreadCount || 0) : (props.folderCounts?.inbox || 0)) > 0}>
                  <span
                    class={`text-xs font-mono px-1.5 py-0.5 rounded-full ${
                      (isAllInboxes() ? props.currentFolder === "unified_inbox" : (props.currentFolder === "inbox" && (!props.focusedCategory || props.focusedCategory === "primary")))
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
                  <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] text-xs uppercase tracking-wider font-mono">
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

          {/* Focused Inbox Independent Folders (Only in Tab and Phone View: Newsletters & Social) */}
          <Show when={(props.focusedInboxEnabled ?? true) && props.onSelectCategory}>
            <div
              data-testid="sidebar-focused-inbox-folders"
              data-testid-alt="sidebar-focused-inbox-subfolders"
              class="lg:hidden space-y-1"
            >
              <For
                each={[
                  {
                    id: "newsletters" as FocusedCategory,
                    label: t("Newsletters"),
                    icon: (
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    ),
                  },
                  {
                    id: "social" as FocusedCategory,
                    label: t("Social"),
                    icon: (
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                    ),
                  },
                ]}
              >
                {(cat) => {
                  const isCatActive = () => props.currentFolder === "inbox" && (props.focusedCategory || "primary") === cat.id;
                  const unread = () => props.categoryCounts?.[cat.id]?.unread || 0;
                  return (
                    <button
                      type="button"
                      data-testid={`sidebar-focused-tab-${cat.id}`}
                      onClick={() => {
                        props.onSelectFolder("inbox");
                        props.onSelectCategory?.(cat.id);
                        props.onCloseMobile?.();
                      }}
                      class={`relative z-10 w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all duration-150 cursor-pointer select-none bg-transparent ${
                        isCatActive()
                          ? "text-[#A27561] dark:text-[#D4A38F] font-semibold bg-[#F2E8E2]/60 dark:bg-[#2D2522]/60"
                          : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
                      }`}
                    >
                      <div class="flex items-center gap-2.5">
                        {cat.icon}
                        <span>{cat.label}</span>
                      </div>
                      <Show when={unread() > 0}>
                        <span class={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded-full ${isCatActive() ? "bg-[#A27561] text-white font-semibold" : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"}`}>
                          {unread()}
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
              <Show when={props.onOpenSubscriptions}>
                <button
                  type="button"
                  data-testid="sidebar-manage-subscriptions-btn"
                  onClick={() => {
                    props.onOpenSubscriptions?.();
                    props.onCloseMobile?.();
                  }}
                  class="w-full flex items-center justify-between px-3 py-2 min-h-[36px] text-xs sm:text-sm rounded-xl text-[#75777B] dark:text-[#A1A1AA] hover:text-[#A27561] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium cursor-pointer transition-colors"
                >
                  <div class="flex items-center gap-2 pl-6">
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span>{t("Manage Subscriptions")}</span>
                  </div>
                </button>
              </Show>
            </div>
          </Show>

          {/* Remaining Folders */}
          <For each={(["sent", "scheduled", "drafts", "snoozed", "archive", "spam", "trash"] as Folder[])}>
            {(f) => {
              const isActive = () => props.currentFolder === f;
              const isDropTarget = () => dragOverTarget() === f;
              const count = () => (props.folderCounts ? props.folderCounts[f] || 0 : 0);

              return (
                <button
                  ref={(el) => { if (el) folderRefs.set(f, el); }}
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
                  class={`relative z-10 w-full flex items-center justify-between px-3 py-2 min-h-[36px] text-sm rounded-xl transition-all duration-150 cursor-pointer select-none bg-transparent ${
                    isDropTarget()
                      ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                      : isActive()
                      ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
                      : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium"
                  }`}
                  data-testid={`folder-${f}`}
                >
                  <div class="flex items-center gap-2.5">
                    {renderFolderIcon(f)}
                    <span data-testid={`folder-name-${f}`}>{folderLabels(f)}</span>
                  </div>
                  <Show when={f !== "sent" && count() > 0}>
                    <span class={`text-xs font-mono tabular-nums px-1.5 py-0.5 rounded-full ${isActive() ? "bg-[#A27561] text-white font-semibold" : "bg-[#E8E5DF] dark:bg-[#2E3138] text-[#3C3D3E] dark:text-[#E2DFD8]"}`}>
                      {count()}
                    </span>
                  </Show>
                </button>
              );
            }}
          </For>
        </nav>

        {/* Custom Folders Section */}
        <div class="px-2 pt-2 border-t border-[#E2DFD8]/50 dark:border-[#2E3138]">
          <div class="flex items-center justify-between px-2 py-1 text-xs font-semibold text-[#878A8E] uppercase tracking-wider font-mono">
            <span>{t("Folders")}</span>
            <button
              onClick={() => props.onOpenCreateFolder?.()}
              class="w-7 h-7 min-w-[28px] min-h-[28px] flex items-center justify-center rounded-md hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer transition"
              title="Create folder"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div class="space-y-0.5 mt-0.5 relative">
            {/* Morphing Sliding Highlight Pill */}
            <div
              class="absolute left-0 right-0 rounded-xl bg-[#F2E8E2] dark:bg-[#2D2522] shadow-2xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
              style={{
                top: `${customFolderPillStyle().top}px`,
                height: `${customFolderPillStyle().height}px`,
                opacity: customFolderPillStyle().opacity,
              }}
            />
            <For each={props.customFolders || []}>
              {(f) => {
                const isActive = () => props.activeFolderId === f.id;
                const isDropTarget = () => dragOverTarget() === f.id;
                return (
                  <div
                    ref={(el) => { if (el) customFolderRefs.set(f.id, el); }}
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
                    class={`group relative z-10 w-full flex items-center justify-between px-2.5 py-2 md:py-1.5 min-h-[38px] text-xs rounded-xl transition-all cursor-pointer bg-transparent ${
                      f.parent_id ? "pl-5" : ""
                    } ${
                      isDropTarget()
                        ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                        : isActive()
                        ? "text-[#A27561] dark:text-[#D4A38F] font-semibold"
                        : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium transition-colors"
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
              <div class="px-3 py-1 text-xs text-[#878A8E] italic">No folders</div>
            </Show>
          </div>
        </div>

        {/* Labels Section */}
        <div class="px-2 pt-2 border-t border-[#E2DFD8]/50 dark:border-[#2E3138]">
          <div class="flex items-center justify-between px-2 py-1 text-xs font-semibold text-[#878A8E] uppercase tracking-wider font-mono">
            <span>{t("Labels")}</span>
            <button
              onClick={() => props.onOpenCreateLabel?.()}
              class="w-7 h-7 min-w-[28px] min-h-[28px] flex items-center justify-center rounded-md hover:bg-[#E8E5DF] dark:hover:bg-[#26282E] text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer transition"
              title="Create label"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <div class="space-y-0.5 mt-0.5 relative" role="tree" aria-label="Labels">
            {/* Morphing Sliding Highlight Pill */}
            <div
              class="absolute left-0 right-0 rounded-xl bg-[#F2E8E2] dark:bg-[#2D2522] shadow-2xs pointer-events-none transition-all duration-250 ease-[cubic-bezier(0.2,0,0,1)] z-0"
              style={{
                top: `${labelPillStyle().top}px`,
                height: `${labelPillStyle().height}px`,
                opacity: labelPillStyle().opacity,
              }}
            />
            <For each={visibleLabels()}>
              {(node) => {
                const isActive = () => props.activeLabelId === node.label.id;
                const isDropTarget = () => dragOverTarget() === node.label.id;
                return (
                  <div
                    ref={(el) => { if (el) labelRefs.set(node.label.id, el); }}
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
                    class={`group relative z-10 w-full flex items-center justify-between pr-2.5 py-1.5 min-h-[36px] text-xs rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 bg-transparent ${
                      isDropTarget()
                        ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#9E725F] border-dashed rounded-xl scale-[1.02]"
                        : isActive()
                        ? "text-[#9E725F] dark:text-[#D4A38F] font-semibold"
                        : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#26282E]/50 font-medium transition-colors"
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
              <div class="px-3 py-1 text-xs text-[#878A8E] italic">No labels</div>
            </Show>
          </div>
        </div>

      </div>

      {/* FIXED BOTTOM: Unified Contacts | Settings | Sign out Capsule Pill */}
      <div class="p-2 border-t border-[#E2DFD8]/60 dark:border-[#333336] relative z-40 overflow-visible flex-shrink-0">
        <div class="w-full rounded-full bg-[#EAE7DF]/85 dark:bg-[#1E2025] border border-[#DDD8CE] dark:border-[#2E3138] p-1 flex items-center justify-between shadow-2xs transition-colors">
          {/* Contacts */}
          <div class="relative group flex-1 flex justify-center">
            <button
              type="button"
              onClick={() => {
                props.onOpenContacts();
                props.onCloseMobile?.();
              }}
              data-testid="sidebar-contacts-btn"
              data-testid-secondary="contacts-nav-btn"
              aria-label={t("Contacts")}
              class="w-full h-9 min-h-[36px] flex items-center justify-center py-1.5 px-2 rounded-full text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-150 cursor-pointer select-none"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span class="sr-only">{t("Contacts")}</span>
            </button>
            <div
              role="tooltip"
              class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:-translate-y-0.5 transition-all duration-150 ease-out z-50 px-2.5 py-1 rounded-lg bg-[#1E2025] dark:bg-[#2A2D35] text-[#F3F4F6] text-xs font-medium shadow-md whitespace-nowrap"
            >
              {t("Contacts")}
              <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1E2025] dark:border-t-[#2A2D35]" />
            </div>
          </div>

          <div class="w-px h-3.5 bg-[#D2CDC3] dark:bg-[#383B44] flex-shrink-0" />

          {/* Settings */}
          <div class="relative group flex-1 flex justify-center">
            <button
              type="button"
              onClick={() => {
                props.onOpenSettings();
                props.onCloseMobile?.();
              }}
              data-testid="sidebar-settings-btn"
              aria-label={t("Settings")}
              class="w-full h-9 min-h-[36px] flex items-center justify-center py-1.5 px-2 rounded-full text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-150 cursor-pointer select-none"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span class="sr-only">{t("Settings")}</span>
            </button>
            <div
              role="tooltip"
              class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:-translate-y-0.5 transition-all duration-150 ease-out z-50 px-2.5 py-1 rounded-lg bg-[#1E2025] dark:bg-[#2A2D35] text-[#F3F4F6] text-xs font-medium shadow-md whitespace-nowrap"
            >
              {t("Settings")}
              <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1E2025] dark:border-t-[#2A2D35]" />
            </div>
          </div>

          <div class="w-px h-3.5 bg-[#D2CDC3] dark:bg-[#383B44] flex-shrink-0" />

          {/* Sign out */}
          <div class="relative group flex-1 flex justify-center">
            <button
              type="button"
              onClick={() => props.onLogout?.(props.selectedMailbox?.id, false)}
              data-testid="sidebar-signout-btn"
              aria-label={t("Sign out")}
              class="w-full h-9 min-h-[36px] flex items-center justify-center py-1.5 px-2 rounded-full text-[#5E6063] dark:text-[#A1A1AA] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 dark:hover:bg-red-500/15 transition-all duration-150 cursor-pointer select-none"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span class="sr-only">{t("Sign out")}</span>
            </button>
            <div
              role="tooltip"
              class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:-translate-y-0.5 transition-all duration-150 ease-out z-50 px-2.5 py-1 rounded-lg bg-[#1E2025] dark:bg-[#2A2D35] text-[#F3F4F6] text-xs font-medium shadow-md whitespace-nowrap"
            >
              {t("Sign out")}
              <div class="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1E2025] dark:border-t-[#2A2D35]" />
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
