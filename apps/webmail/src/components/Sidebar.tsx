import { Component, Show, For, createSignal, onMount, onCleanup } from "solid-js";
import { StorageStatusPill } from "./StorageStatusPill";
import { UserMe, Mailbox, ConnectedAccount, MailboxFolder, MailboxLabel } from "../api";
import { AccountSwitcher } from "./AccountSwitcher";

export type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

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
  onDeleteLabel?: (label: MailboxLabel) => void;
  onMoveMessages?: (messageIds: string[], folderOrId: string) => void;
  onAttachLabel?: (messageIds: string[], labelId: string) => void;
  customFolderCounts?: Record<string, number>;
  labelCounts?: Record<string, number>;
  theme?: string;
  onToggleTheme?: () => void;
  onSetTheme?: (theme: "cloud_dancer" | "dark") => void;
}

export const Sidebar: Component<SidebarProps> = (props) => {
  const [dragOverTarget, setDragOverTarget] = createSignal<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = createSignal<string | null>(null);
  const [openLabelMenuId, setOpenLabelMenuId] = createSignal<string | null>(null);

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
    drafts: "Drafts",
    archive: "Archive",
    spam: "Spam",
    trash: "Trash",
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

  return (
    <aside class="w-64 flex-shrink-0 bg-[#F0EEE9] dark:bg-[#18191D] border-r border-[#E2DFD8]/80 dark:border-[#2E3138] flex flex-col justify-between select-none h-full relative">
      {/* FIXED TOP: Brand Header & Mode Toggle, Account Switcher, Compose, Quick Actions */}
      <div class="p-2 pb-2 relative z-50 overflow-visible space-y-2 flex-shrink-0">
        {/* Top-Left App Brand Header */}
        <div class="flex items-center gap-2 px-1.5 pt-0.5 pb-0.5">
          <div class="w-6 h-6 rounded-lg bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider">
            B
          </div>
          <span class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">BYOS Mail</span>
        </div>

        {/* User Identity & Account Switcher (Top-Left) */}
        <AccountSwitcher
          currentEmail={mailboxEmail()}
          isPrivate={isPrivate()}
          connectedAccounts={props.connectedAccounts || []}
          activeAccountId={props.selectedMailbox?.id || ""}
          onSelectAccount={(acc) => props.onSelectAccount?.(acc)}
          onOpenAddMailbox={() => props.onOpenAddMailbox?.()}
          onSignOut={props.onLogout}
        />

        {/* Compose Pill & Quick Actions */}
        <div class="space-y-1.5">
          <button
            onClick={props.onCompose}
            class="w-full bg-[#A27561] hover:bg-[#8F6452] dark:bg-[#A27561] dark:hover:bg-[#B2826F] text-white text-xs font-medium py-2 px-3.5 rounded-xl shadow-none transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
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
              onClick={props.onOpenContacts}
              class="flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] transition-colors cursor-pointer"
              title="Contacts"
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
              onClick={props.onOpenImport}
              class="flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] transition-colors cursor-pointer"
              title="Import Emails (.eml / .mbox)"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>Import</span>
            </button>

            <button
              onClick={props.onOpenSettings}
              class="flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] transition-colors cursor-pointer"
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
          {(["inbox", "sent", "drafts", "archive", "spam", "trash"] as Folder[]).map((f) => {
            const isActive = () => props.currentFolder === f;
            const isDropTarget = () => dragOverTarget() === f;
            const count = () => props.folderCounts[f] || 0;

            return (
              <button
                onClick={() => props.onSelectFolder(f)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                  setDragOverTarget(f);
                }}
                onDragLeave={() => {
                  if (dragOverTarget() === f) setDragOverTarget(null);
                }}
                onDrop={(e) => handleDrop(e, f, false)}
                class={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-xl transition-all cursor-pointer ${
                  isDropTarget()
                    ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                    : isActive()
                    ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold"
                    : "text-[#3C3D3E] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"
                }`}
              >
                <div class="flex items-center gap-2.5">
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
                    onClick={() => props.onSelectCustomFolder?.(f)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      setDragOverTarget(f.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverTarget() === f.id) setDragOverTarget(null);
                    }}
                    onDrop={(e) => handleDrop(e, f.id, false)}
                    class={`group relative w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-xl transition-all cursor-pointer ${
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
                          class={`p-0.5 rounded text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer ${
                            openFolderMenuId() === f.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
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
          <div class="space-y-0.5 mt-0.5">
            <For each={props.labels || []}>
              {(l) => {
                const isActive = () => props.activeLabelId === l.id;
                const isDropTarget = () => dragOverTarget() === l.id;
                return (
                  <div
                    onClick={() => props.onSelectLabel?.(l)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                      setDragOverTarget(l.id);
                    }}
                    onDragLeave={() => {
                      if (dragOverTarget() === l.id) setDragOverTarget(null);
                    }}
                    onDrop={(e) => handleDrop(e, l.id, true)}
                    class={`group relative w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-xl transition-all cursor-pointer ${
                      isDropTarget()
                        ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-2 border-[#A27561] border-dashed rounded-xl scale-[1.02]"
                        : isActive()
                        ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold"
                        : "text-[#3C3D3E] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"
                    }`}
                  >
                    <div class="flex items-center gap-2 truncate min-w-0 flex-1">
                      <span
                        class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ "background-color": l.color }}
                      />
                      <span class="truncate">{l.name}</span>
                    </div>

                    <div class="flex items-center gap-1 flex-shrink-0">
                      <Show when={props.labelCounts && (props.labelCounts[l.id] || 0) > 0}>
                        <span class={`text-xs font-mono px-1.5 py-0.2 rounded ${
                          isActive() ? "text-[#A27561] dark:text-[#D4A38F] font-semibold" : "text-[#6F7173] dark:text-[#808288]"
                        }`}>
                          {props.labelCounts![l.id]}
                        </span>
                      </Show>

                      {/* 3-dots Context Menu Button */}
                      <div class="relative flex items-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenLabelMenuId(openLabelMenuId() === l.id ? null : l.id);
                            setOpenFolderMenuId(null);
                          }}
                          class={`p-0.5 rounded text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/10 transition cursor-pointer ${
                            openLabelMenuId() === l.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                          title="Label options"
                        >
                          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="5" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="12" cy="19" r="2" />
                          </svg>
                        </button>

                        <Show when={openLabelMenuId() === l.id}>
                          <div
                            class="absolute right-0 top-full mt-1 w-24 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg py-1 z-30 text-xs font-sans"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                props.onEditLabel?.(l);
                              }}
                              class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2A2522] text-[#3C3D3E] dark:text-[#ECEBE8] hover:text-[#A27561] dark:hover:text-[#D4A38F] transition cursor-pointer"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenLabelMenuId(null);
                                props.onDeleteLabel?.(l);
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
