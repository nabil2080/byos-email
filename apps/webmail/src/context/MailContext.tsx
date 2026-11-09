import {
  createContext,
  useContext,
  createSignal,
  type Accessor,
  type Setter,
  type JSX,
} from "solid-js";
import type { AttachmentItem, MailboxFolder, MailboxLabel, ThreadSummary } from "../api";
import type { SortOrder } from "../components/InboxToolbar";
import { type FocusedCategory, getFocusedInboxEnabled } from "../focused_inbox";
import type { PendingSend } from "../undo_send";

export type Folder =
  | "inbox"
  | "sent"
  | "scheduled"
  | "drafts"
  | "snoozed"
  | "archive"
  | "spam"
  | "trash"
  | "unified_inbox";

export interface DisplayMessage {
  id: string;
  messageSeq?: number;
  version?: number;
  isDraft?: boolean;
  folder: Folder;
  folderId?: string | null;
  labelIds?: string[];
  sender: string;
  senderName?: string;
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
  bodyPlaintext?: string;
  bodyHtml?: string;
}

export interface MailContextValue {
  // Navigation & Folders
  currentFolder: Accessor<Folder>;
  setCurrentFolder: Setter<Folder>;
  customFolders: Accessor<MailboxFolder[]>;
  setCustomFolders: Setter<MailboxFolder[]>;
  activeCustomFolder: Accessor<MailboxFolder | null>;
  setActiveCustomFolder: Setter<MailboxFolder | null>;
  labels: Accessor<MailboxLabel[]>;
  setLabels: Setter<MailboxLabel[]>;
  activeLabel: Accessor<MailboxLabel | null>;
  setActiveLabel: Setter<MailboxLabel | null>;

  // Messages & Threads
  messages: Accessor<DisplayMessage[]>;
  setMessages: Setter<DisplayMessage[]>;
  selectedMsg: Accessor<DisplayMessage | null>;
  setSelectedMsg: Setter<DisplayMessage | null>;
  threads: Accessor<ThreadSummary[]>;
  setThreads: Setter<ThreadSummary[]>;
  expandedThreadId: Accessor<string | null>;
  setExpandedThreadId: Setter<string | null>;
  viewMode: Accessor<"threads" | "flat">;
  setViewMode: Setter<"threads" | "flat">;

  // Selection & Sorting & Pagination
  selectedIds: Accessor<Set<string>>;
  setSelectedIds: Setter<Set<string>>;
  sortOrder: Accessor<SortOrder>;
  setSortOrder: Setter<SortOrder>;
  currentPage: Accessor<number>;
  setCurrentPage: Setter<number>;
  pageSize: number;

  // Search & Indexing
  searchQuery: Accessor<string>;
  setSearchQuery: Setter<string>;
  serverMatchedMsgIds: Accessor<string[]>;
  setServerMatchedMsgIds: Setter<string[]>;
  isSearchingTokens: Accessor<boolean>;
  setIsSearchingTokens: Setter<boolean>;

  // Focused Inbox
  focusedCategory: Accessor<FocusedCategory>;
  setFocusedCategory: Setter<FocusedCategory>;
  focusedInboxEnabled: Accessor<boolean>;
  setFocusedInboxEnabled: Setter<boolean>;

  // Decryption & Attachments
  isDecrypting: Accessor<boolean>;
  setIsDecrypting: Setter<boolean>;
  decryptedContent: Accessor<string | null>;
  setDecryptedContent: Setter<string | null>;
  decryptedCalendarIcs: Accessor<string | null>;
  setDecryptedCalendarIcs: Setter<string | null>;
  editablePlaintext: Accessor<string | null>;
  setEditablePlaintext: Setter<string | null>;
  messagePlaintext: Accessor<string | null>;
  setMessagePlaintext: Setter<string | null>;
  senderVerification: Accessor<{ verified: boolean; error?: string } | null>;
  setSenderVerification: Setter<{ verified: boolean; error?: string } | null>;
  messageAttachments: Accessor<AttachmentItem[]>;
  setMessageAttachments: Setter<AttachmentItem[]>;
  downloadingAttachment: Accessor<string | null>;
  setDownloadingAttachment: Setter<string | null>;

  // Drafts & Scheduled
  editingDraft: Accessor<{ id: string; version: number } | null>;
  setEditingDraft: Setter<{ id: string; version: number } | null>;
  draftDirty: Accessor<boolean>;
  setDraftDirty: Setter<boolean>;
  lastSavedDraftSnapshot: Accessor<string>;
  setLastSavedDraftSnapshot: Setter<string>;
  isAutoSaving: Accessor<boolean>;
  setIsAutoSaving: Setter<boolean>;
  editingScheduledId: Accessor<string | null>;
  setEditingScheduledId: Setter<string | null>;
  pendingSend: Accessor<PendingSend | null>;
  setPendingSend: Setter<PendingSend | null>;

  // Selection Helpers
  toggleSelectMessage: (id: string, checked?: boolean) => void;
  clearSelection: () => void;
  selectAllVisible: (ids: string[]) => void;
}

export function createMailState(overrides?: Partial<MailContextValue>): MailContextValue {
  const [currentFolder, setCurrentFolder] = createSignal<Folder>("inbox");
  const [customFolders, setCustomFolders] = createSignal<MailboxFolder[]>([]);
  const [activeCustomFolder, setActiveCustomFolder] = createSignal<MailboxFolder | null>(null);
  const [labels, setLabels] = createSignal<MailboxLabel[]>([]);
  const [activeLabel, setActiveLabel] = createSignal<MailboxLabel | null>(null);

  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [selectedMsg, setSelectedMsg] = createSignal<DisplayMessage | null>(null);
  const [threads, setThreads] = createSignal<ThreadSummary[]>([]);
  const [expandedThreadId, setExpandedThreadId] = createSignal<string | null>(null);

  const [viewMode, setViewMode] = createSignal<"threads" | "flat">(
    typeof window !== "undefined"
      ? ((localStorage.getItem("byos_view_mode") as "threads" | "flat") ||
         (sessionStorage.getItem("byos_view_mode") as "threads" | "flat") ||
         "flat")
      : "flat"
  );

  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = createSignal<SortOrder>("newest");
  const [currentPage, setCurrentPage] = createSignal(1);
  const pageSize = 50;

  const [searchQuery, setSearchQuery] = createSignal("");
  const [serverMatchedMsgIds, setServerMatchedMsgIds] = createSignal<string[]>([]);
  const [isSearchingTokens, setIsSearchingTokens] = createSignal(false);

  const [focusedCategory, setFocusedCategory] = createSignal<FocusedCategory>("primary");
  const [focusedInboxEnabled, setFocusedInboxEnabled] = createSignal<boolean>(getFocusedInboxEnabled());

  const [isDecrypting, setIsDecrypting] = createSignal(false);
  const [decryptedContent, setDecryptedContent] = createSignal<string | null>(null);
  const [decryptedCalendarIcs, setDecryptedCalendarIcs] = createSignal<string | null>(null);
  const [editablePlaintext, setEditablePlaintext] = createSignal<string | null>(null);
  const [messagePlaintext, setMessagePlaintext] = createSignal<string | null>(null);
  const [senderVerification, setSenderVerification] = createSignal<{
    verified: boolean;
    error?: string;
  } | null>(null);
  const [messageAttachments, setMessageAttachments] = createSignal<AttachmentItem[]>([]);
  const [downloadingAttachment, setDownloadingAttachment] = createSignal<string | null>(null);

  const [editingDraft, setEditingDraft] = createSignal<{ id: string; version: number } | null>(null);
  const [draftDirty, setDraftDirty] = createSignal(false);
  const [lastSavedDraftSnapshot, setLastSavedDraftSnapshot] = createSignal("");
  const [isAutoSaving, setIsAutoSaving] = createSignal(false);
  const [editingScheduledId, setEditingScheduledId] = createSignal<string | null>(null);
  const [pendingSend, setPendingSend] = createSignal<PendingSend | null>(null);

  const toggleSelectMessage = (id: string, checked?: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const isChecked = checked !== undefined ? checked : !next.has(id);
      if (isChecked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set<string>());
  };

  const selectAllVisible = (ids: string[]) => {
    setSelectedIds(new Set<string>(ids));
  };

  const base: MailContextValue = {
    currentFolder,
    setCurrentFolder,
    customFolders,
    setCustomFolders,
    activeCustomFolder,
    setActiveCustomFolder,
    labels,
    setLabels,
    activeLabel,
    setActiveLabel,
    messages,
    setMessages,
    selectedMsg,
    setSelectedMsg,
    threads,
    setThreads,
    expandedThreadId,
    setExpandedThreadId,
    viewMode,
    setViewMode,
    selectedIds,
    setSelectedIds,
    sortOrder,
    setSortOrder,
    currentPage,
    setCurrentPage,
    pageSize,
    searchQuery,
    setSearchQuery,
    serverMatchedMsgIds,
    setServerMatchedMsgIds,
    isSearchingTokens,
    setIsSearchingTokens,
    focusedCategory,
    setFocusedCategory,
    focusedInboxEnabled,
    setFocusedInboxEnabled,
    isDecrypting,
    setIsDecrypting,
    decryptedContent,
    setDecryptedContent,
    decryptedCalendarIcs,
    setDecryptedCalendarIcs,
    editablePlaintext,
    setEditablePlaintext,
    messagePlaintext,
    setMessagePlaintext,
    senderVerification,
    setSenderVerification,
    messageAttachments,
    setMessageAttachments,
    downloadingAttachment,
    setDownloadingAttachment,
    editingDraft,
    setEditingDraft,
    draftDirty,
    setDraftDirty,
    lastSavedDraftSnapshot,
    setLastSavedDraftSnapshot,
    isAutoSaving,
    setIsAutoSaving,
    editingScheduledId,
    setEditingScheduledId,
    pendingSend,
    setPendingSend,
    toggleSelectMessage,
    clearSelection,
    selectAllVisible,
  };

  return Object.assign(base, overrides);
}

const MailContext = createContext<MailContextValue | undefined>(undefined);

export interface MailProviderProps {
  value?: MailContextValue;
  children: JSX.Element;
}

export function MailProvider(props: MailProviderProps) {
  const state = props.value ?? createMailState();
  return (
    <MailContext.Provider value={state}>
      {props.children}
    </MailContext.Provider>
  );
}

export function useMail(): MailContextValue {
  const context = useContext(MailContext);
  if (!context) {
    throw new Error("useMail must be used within a MailProvider");
  }
  return context;
}

export function useOptionalMail(): MailContextValue | undefined {
  return useContext(MailContext);
}
