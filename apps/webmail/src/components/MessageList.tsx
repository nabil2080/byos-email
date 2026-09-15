import { Component, For, Show } from "solid-js";
import { Folder } from "./Sidebar";
import { InboxToolbar, SelectionFilter, SortOrder } from "./InboxToolbar";
import { MessageRow } from "./MessageRow";
import { MailboxFolder, MailboxLabel } from "../api";

export interface DisplayMessage {
  id: string;
  messageSeq?: number;
  version?: number;
  folder: Folder;
  folderId?: string | null;
  labelIds?: string[];
  sender: string;
  recipient: string;
  subject: string;
  snippet: string;
  encryptedBody: string;
  date: string;
  read: boolean;
  starred: boolean;
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
}

interface MessageListProps {
  currentFolder: Folder;
  messages: DisplayMessage[];
  selectedMessage: DisplayMessage | null;
  selectedIds: Set<string>;
  isSplit: boolean;
  onSelectMessage: (msg: DisplayMessage) => void;
  onToggleCheck: (msg: DisplayMessage, checked: boolean) => void;
  onSelectFilter: (filter: SelectionFilter) => void;
  onClearSelection: () => void;
  onRefresh: () => void;
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  currentPage: number;
  pageSize: number;
  totalCount: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onBatchArchive: () => void;
  onBatchSpam: () => void;
  onBatchTrash: () => void;
  onBatchToggleRead: (read: boolean) => void;
  onBatchToggleStarred: (starred: boolean) => void;
  onBatchMoveTo: (folder: string) => void;
  storageError: string | null;
  onDismissStorageError: () => void;
  isLoading: boolean;
  density?: "compact" | "cozy" | "comfortable";
  onToggleStarred: (msg: DisplayMessage) => void;
  onToggleRead: (msg: DisplayMessage) => void;
  onArchive: (msg: DisplayMessage) => void;
  onTrash: (msg: DisplayMessage) => void;
  onDeleteForever?: (msg: DisplayMessage) => void;
  onEmptyTrash?: () => void;
  onBatchDeleteForever?: () => void;
  customFolders?: MailboxFolder[];
  labels?: MailboxLabel[];
  onBatchToggleLabel?: (labelId: string) => void;
  theme?: string;
  onSetTheme?: (t: "cloud_dancer" | "dark") => void;
  onToggleTheme?: () => void;
}

export const MessageList: Component<MessageListProps> = (props) => {
  const folderNames: Record<Folder, string> = {
    inbox: "Inbox",
    sent: "Sent",
    drafts: "Drafts",
    archive: "Archive",
    spam: "Spam",
    trash: "Trash",
  };

  const isAllSelectedRead = () => {
    if (props.selectedIds.size === 0) return false;
    const selected = props.messages.filter((m) => props.selectedIds.has(m.id));
    return selected.length > 0 && selected.every((m) => m.read);
  };

  return (
    <section class="w-full bg-[#FAF9F6] dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2A2D35] rounded-2xl flex flex-col min-w-0 overflow-hidden shadow-2xs h-full">
      {/* Storage Outage / Disconnected Banner (Section 11) */}
      <Show when={props.storageError}>
        <div role="alert" class="p-3 bg-amber-50/90 border-b border-amber-200/80 text-xs text-amber-900 flex items-start justify-between gap-2 flex-shrink-0">
          <div class="flex items-start gap-2">
            <svg class="w-4 h-4 text-amber-600 stroke-current fill-none stroke-[2] flex-shrink-0 mt-0.5" viewBox="0 0 24 24">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span class="text-[11px] leading-tight">{props.storageError}</span>
          </div>
          <button
            onClick={props.onDismissStorageError}
            class="text-amber-700 hover:text-amber-950 font-bold text-xs cursor-pointer p-0.5"
            title="Dismiss"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </Show>

      {/* Embedded Gmail/Proton Dual-State Inbox Toolbar */}
      <InboxToolbar
        selectedCount={props.selectedIds.size}
        totalVisibleCount={props.messages.length}
        totalCount={props.totalCount}
        onSelectFilter={props.onSelectFilter}
        onRefresh={props.onRefresh}
        sortOrder={props.sortOrder}
        onSortChange={props.onSortChange}
        searchQuery={props.searchQuery}
        onSearchChange={props.onSearchChange}
        currentPage={props.currentPage}
        pageSize={props.pageSize}
        onPrevPage={props.onPrevPage}
        onNextPage={props.onNextPage}
        onBatchArchive={props.onBatchArchive}
        onBatchSpam={props.onBatchSpam}
        onBatchTrash={props.onBatchTrash}
        onBatchDeleteForever={props.onBatchDeleteForever}
        currentFolder={props.currentFolder}
        onBatchToggleRead={props.onBatchToggleRead}
        isAllSelectedRead={isAllSelectedRead()}
        onBatchToggleStarred={props.onBatchToggleStarred}
        onBatchMoveTo={props.onBatchMoveTo}
        onClearSelection={props.onClearSelection}
        customFolders={props.customFolders}
        labels={props.labels}
        onBatchToggleLabel={props.onBatchToggleLabel}
        isSplit={props.isSplit}
        theme={props.theme}
        onSetTheme={props.onSetTheme}
        onToggleTheme={props.onToggleTheme}
      />

      {/* 30-Day Auto-Delete Bin Notice Banner */}
      <Show when={props.currentFolder === "trash"}>
        <div class="px-4 py-2 bg-[#F3ECE8] dark:bg-[#2D2522] border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between gap-3 text-xs text-[#464748] dark:text-[#E2DFD8] flex-shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <svg class="w-4 h-4 text-[#A27561] stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span class="truncate sm:overflow-visible sm:whitespace-normal">
              Messages that have been in the Bin for more than 30 days will be deleted automatically.
            </span>
          </div>
          <button
            type="button"
            onClick={props.onEmptyTrash}
            class="text-[#A27561] hover:text-[#8F6452] dark:hover:text-[#D4A38F] font-semibold hover:underline cursor-pointer flex-shrink-0 whitespace-nowrap text-xs"
          >
            Empty Bin now
          </button>
        </div>
      </Show>

      {/* Messages Scroll Area */}
      <div class="flex-1 overflow-y-auto min-w-0 overflow-x-hidden">
        <Show when={props.isLoading}>
          <div class="p-8 text-center text-xs text-[#6E7075] dark:text-[#878A8E] font-mono animate-pulse">
            Syncing sovereign mailbox…
          </div>
        </Show>

        <For each={props.messages}>
          {(msg) => (
            <MessageRow
              message={msg}
              isSelected={props.selectedMessage?.id === msg.id}
              isChecked={props.selectedIds.has(msg.id)}
              isSplit={props.isSplit}
              density={props.density}
              selectedIds={props.selectedIds}
              onSelect={props.onSelectMessage}
              onToggleCheck={props.onToggleCheck}
              onToggleStarred={props.onToggleStarred}
              onToggleRead={props.onToggleRead}
              onArchive={props.onArchive}
              onTrash={props.onTrash}
              onDeleteForever={props.onDeleteForever}
              labels={props.labels}
            />
          )}
        </For>

        <Show when={!props.isLoading && props.messages.length === 0}>
          <div class="p-12 text-center text-xs text-[#878A8E] flex flex-col items-center justify-center gap-2 select-none">
            <svg class="w-8 h-8 stroke-current fill-none stroke-[1.2] text-[#878A8E]/50" viewBox="0 0 24 24">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <span>No messages in {folderNames[props.currentFolder]}.</span>
          </div>
        </Show>
      </div>
    </section>
  );
};
