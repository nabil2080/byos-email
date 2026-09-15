import { Component, createSignal, Show, For, onMount, onCleanup } from "solid-js";
import { DisplayMessage } from "./MessageList";
import { AttachmentItem, MailboxFolder, MailboxLabel } from "../api";
import { ProfileAvatar } from "./ProfileAvatar";
import { AttachmentBadge } from "./AttachmentBadge";

export interface ReadingPaneProps {
  message: DisplayMessage;
  isDecrypting: boolean;
  decryptedContent: string | null;
  attachments: AttachmentItem[];
  downloadingAttachmentId: string | null;
  onDownloadAttachment: (att: AttachmentItem) => void;
  onBack: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onArchive: (msg: DisplayMessage) => void;
  onSpam: (msg: DisplayMessage) => void;
  onTrash: (msg: DisplayMessage) => void;
  onDeleteForever?: (msg: DisplayMessage) => void;
  onToggleRead: (msg: DisplayMessage) => void;
  onToggleStarred: (msg: DisplayMessage) => void;
  onMoveTo: (msg: DisplayMessage, folder: string) => void;
  onReply: (msg: DisplayMessage) => void;
  onForward: (msg: DisplayMessage) => void;
  onEditDraft?: (msg: DisplayMessage) => void;
  onDeleteDraft?: (msg: DisplayMessage) => void;
  customFolders?: MailboxFolder[];
  labels?: MailboxLabel[];
  onToggleLabel?: (msg: DisplayMessage, labelId: string) => void;
}

function getSenderInitials(sender: string): string {
  if (!sender) return "?";
  const clean = sender.replace(/<.*?>/g, "").trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase() || "?";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentTypeInfo {
  typeLabel: string;
  badgeClass: string;
  icon: () => any;
}

function getAttachmentTypeInfo(filename: string, contentType: string): AttachmentTypeInfo {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const ct = (contentType || "").toLowerCase();

  // 1. PDF (Red)
  if (ext === "pdf" || ct.includes("pdf")) {
    return {
      typeLabel: "PDF",
      badgeClass: "bg-rose-50 text-rose-600 border border-rose-200",
      icon: () => (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 15h6" />
        </svg>
      ),
    };
  }

  // 2. Image (Blue)
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext) || ct.startsWith("image/")) {
    return {
      typeLabel: "IMG",
      badgeClass: "bg-blue-50 text-blue-600 border border-blue-200",
      icon: () => (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      ),
    };
  }

  // 3. Spreadsheet / Sheet (Emerald Green)
  if (["xlsx", "xls", "csv", "tsv", "ods"].includes(ext) || ct.includes("spreadsheet") || ct.includes("csv") || ct.includes("excel")) {
    return {
      typeLabel: "SHEET",
      badgeClass: "bg-emerald-50 text-emerald-600 border border-emerald-200",
      icon: () => (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      ),
    };
  }

  // 4. Document / Word / Text (Indigo)
  if (["doc", "docx", "txt", "rtf", "odt", "md"].includes(ext) || ct.includes("word") || ct.startsWith("text/")) {
    return {
      typeLabel: "DOC",
      badgeClass: "bg-indigo-50 text-indigo-600 border border-indigo-200",
      icon: () => (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    };
  }

  // 5. Archive / Zip (Amber)
  if (["zip", "tar", "gz", "7z", "rar", "bz2", "xz"].includes(ext) || ct.includes("zip") || ct.includes("tar") || ct.includes("compressed") || ct.includes("archive")) {
    return {
      typeLabel: "ZIP",
      badgeClass: "bg-amber-50 text-amber-600 border border-amber-200",
      icon: () => (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
          <polyline points="21 8 21 21 3 21 3 8" />
          <rect x="1" y="3" width="22" height="5" />
          <line x1="10" y1="12" x2="14" y2="12" />
        </svg>
      ),
    };
  }

  // 6. Generic / Other (Warm Sand)
  return {
    typeLabel: ext ? ext.toUpperCase().slice(0, 4) : "FILE",
    badgeClass: "bg-[#F0EEE9] text-[#A27561] border border-[#E2DFD8]",
    icon: () => (
      <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
    ),
  };
}

export const ReadingPane: Component<ReadingPaneProps> = (props) => {
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [moveMenuOpen, setMoveMenuOpen] = createSignal(false);
  const [labelMenuOpen, setLabelMenuOpen] = createSignal(false);
  const [moreMenuOpen, setMoreMenuOpen] = createSignal(false);
  const [allowRemoteImages, setAllowRemoteImages] = createSignal(false);
  const [showTrackerDetails, setShowTrackerDetails] = createSignal(false);

  // Email Tracker Blocker detection and neutralization
  const trackerInfo = () => {
    const text = props.decryptedContent || "";
    if (!text) return { count: 0, urls: [] as string[], sanitized: "" };

    const urls: string[] = [];
    let count = 0;
    const imgRegex = /<img\s+[^>]*?src=["']?(https?:\/\/[^"'\s>]+)["']?[^>]*?>/gi;

    const sanitized = text.replace(imgRegex, (match, src) => {
      const isTiny = /width=["']?(0|1)["']?/i.test(match) && /height=["']?(0|1)["']?/i.test(match);
      const isHidden = /display:\s*none/i.test(match) || /visibility:\s*hidden/i.test(match) || /width:\s*(0|1)px/i.test(match);
      const isTrackerUrl = /(track|pixel|open|beacon|wf\/open|mandrillapp|mailfoogae|sidekick|hubspot|sendgrid|convertkit|\/v1\/track)/i.test(src);

      if (isTiny || isHidden || isTrackerUrl) {
        count++;
        if (!urls.includes(src)) urls.push(src);
        if (!allowRemoteImages()) {
          return `<!-- [BYOS Shield: Blocked Tracker: ${src}] -->`;
        }
      }
      return match;
    });

    return { count, urls, sanitized };
  };

  let paneToolbarRef: HTMLDivElement | undefined;

  function handleClickOutside(e: MouseEvent) {
    if (paneToolbarRef && !paneToolbarRef.contains(e.target as Node)) {
      setMoveMenuOpen(false);
      setLabelMenuOpen(false);
      setMoreMenuOpen(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      props.onBack();
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleKeyDown);
  });

  const initials = () => getSenderInitials(props.message.sender);

  const senderEmail = () => {
    const match = props.message.sender.match(/<([^>]+)>/);
    return match ? match[1] : props.message.sender;
  };

  const senderDisplayName = () => {
    const match = props.message.sender.match(/^([^<]+)/);
    return match ? match[1].trim() : props.message.sender;
  };

  const canReply = () =>
    props.message.folder !== "drafts" &&
    !props.isDecrypting &&
    props.decryptedContent !== null &&
    !props.decryptedContent.startsWith("Failed to open") &&
    !props.decryptedContent.startsWith("Mailbox is locked");

  return (
    <main class="flex-1 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2A2D35] rounded-2xl flex flex-col min-w-0 shadow-2xs overflow-hidden h-full">
      {/* ── Top Reading Pane Action Toolbar ── */}
      <div
        ref={paneToolbarRef}
        class="px-4 py-2.5 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F6] dark:bg-[#18191D] flex items-center justify-between gap-2 flex-shrink-0 select-none relative z-20"
      >
        {/* Left Side: Back button & Sequential Switchers */}
        <div class="flex items-center gap-1.5 sm:gap-2">
          {/* Back to full message list button */}
          <button
            type="button"
            onClick={props.onBack}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] hover:text-[#A27561] dark:hover:text-[#A27561] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] transition cursor-pointer border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] shadow-2xs"
            title="Back to messages (Esc)"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>Back</span>
          </button>

          <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

          {/* Sequential Prev/Next Chevrons */}
          <div class="flex items-center gap-0.5 bg-white dark:bg-[#1E2025] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={props.onPrev}
              disabled={!props.hasPrev}
              class="p-1 rounded text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="Previous message (Older)"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="18 15 12 9 6 15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={props.onNext}
              disabled={!props.hasNext}
              class="p-1 rounded text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title="Next message (Newer)"
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>

        {/* Right Side: Message Triage Actions */}
        <div class="flex items-center gap-1">
          {/* Archive */}
          <button
            type="button"
            onClick={() => props.onArchive(props.message)}
            class="p-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-[#A27561] dark:hover:text-[#A27561] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
            title="Archive"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </button>

          {/* Spam */}
          <button
            type="button"
            onClick={() => props.onSpam(props.message)}
            class="p-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-[#A27561] dark:hover:text-[#A27561] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
            title="Report Spam"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </button>

          {/* Trash or Delete Forever */}
          <Show
            when={props.message.folder === "trash"}
            fallback={
              <button
                type="button"
                onClick={() => props.onTrash(props.message)}
                class="p-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
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
              onClick={() => props.onDeleteForever?.(props.message)}
              class="p-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition cursor-pointer border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50"
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

          {/* Single Contextual Read/Unread Smart Toggle */}
          <button
            type="button"
            onClick={() => props.onToggleRead(props.message)}
            class="p-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-[#A27561] dark:hover:text-[#A27561] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
            title={props.message.read ? "Mark as unread" : "Mark as read"}
          >
            <Show
              when={props.message.read}
              fallback={
                /* When unread, show open envelope icon to mark as read */
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              }
            >
              {/* When read, show closed envelope icon to mark as unread */}
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </Show>
          </button>

          {/* Star toggle */}
          <button
            type="button"
            onClick={() => props.onToggleStarred(props.message)}
            class={`p-1.5 rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138] ${
              props.message.starred ? "text-amber-500 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/60 dark:hover:bg-amber-950/50" : "text-[#464748] dark:text-[#A3A3A3] hover:text-amber-500 hover:bg-white dark:hover:bg-[#1E2025]"
            }`}
            title={props.message.starred ? "Unstar" : "Star"}
          >
            <Show
              when={props.message.starred}
              fallback={
                <svg class="w-[18px] h-[18px] stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              }
            >
              <svg class="w-[18px] h-[18px] fill-amber-400 stroke-amber-500 stroke-[1.5]" viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </Show>
          </button>

          {/* Move to folder dropdown */}
          <div class="relative">
            <button
              type="button"
              onClick={() => setMoveMenuOpen(!moveMenuOpen())}
              class="p-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-[#A27561] dark:hover:text-[#A27561] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
              title="Move to folder"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>

            <Show when={moveMenuOpen()}>
              <div class="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg py-1 z-30 text-xs font-sans max-h-64 overflow-y-auto">
                <div class="px-3 py-1 text-[10px] font-bold text-[#6E7075] dark:text-[#878A8E] uppercase tracking-wider font-mono">
                  System Folders
                </div>
                <button
                  type="button"
                  onClick={() => {
                    props.onMoveTo(props.message, "inbox");
                    setMoveMenuOpen(false);
                  }}
                  class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                  </svg>
                  <span>Inbox</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.onMoveTo(props.message, "archive");
                    setMoveMenuOpen(false);
                  }}
                  class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                  <span>Archive</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.onMoveTo(props.message, "spam");
                    setMoveMenuOpen(false);
                  }}
                  class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Spam</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.onMoveTo(props.message, "trash");
                    setMoveMenuOpen(false);
                  }}
                  class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-rose-600 dark:text-rose-400 transition cursor-pointer flex items-center gap-2"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>Trash</span>
                </button>

                <Show when={props.customFolders && props.customFolders.length > 0}>
                  <div class="my-1 border-t border-[#E2DFD8] dark:border-[#2E3138]"></div>
                  <div class="px-3 py-1 text-[10px] font-bold text-[#6E7075] dark:text-[#878A8E] uppercase tracking-wider font-mono">
                    Custom Folders
                  </div>
                  <For each={props.customFolders}>
                    {(folder) => (
                      <button
                        type="button"
                        onClick={() => {
                          props.onMoveTo(props.message, folder.id);
                          setMoveMenuOpen(false);
                        }}
                        class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2 truncate"
                      >
                        <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span class="truncate">{folder.name}</span>
                      </button>
                    )}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          {/* Label as dropdown */}
          <div class="relative">
            <button
              type="button"
              onClick={() => setLabelMenuOpen(!labelMenuOpen())}
              class="p-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-[#A27561] dark:hover:text-[#A27561] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
              title="Label as"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                <line x1="7" y1="7" x2="7.01" y2="7" />
              </svg>
            </button>

            <Show when={labelMenuOpen()}>
              <div class="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg py-1 z-30 text-xs font-sans max-h-64 overflow-y-auto">
                <div class="px-3 py-1 text-[10px] font-bold text-[#6E7075] dark:text-[#878A8E] uppercase tracking-wider font-mono">
                  Label as
                </div>
                <Show
                  when={props.labels && props.labels.length > 0}
                  fallback={<div class="px-3 py-2 text-[#6E7075] dark:text-[#878A8E] italic text-xs">No labels created</div>}
                >
                  <For each={props.labels}>
                    {(lbl) => {
                      const hasLabel = () => props.message.labelIds?.includes(lbl.id);
                      return (
                        <button
                          type="button"
                          onClick={() => props.onToggleLabel?.(props.message, lbl.id)}
                          class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center justify-between gap-2"
                        >
                          <div class="flex items-center gap-2 truncate">
                            <span
                              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ "background-color": lbl.color || "#878A8E" }}
                            />
                            <span class="truncate">{lbl.name}</span>
                          </div>
                          <Show when={hasLabel()}>
                            <svg class="w-3.5 h-3.5 text-[#A27561] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </Show>
              </div>
            </Show>
          </div>

          {/* More Actions Overflow Menu (⋮) */}
          <div class="relative">
            <button
              type="button"
              onClick={() => setMoreMenuOpen(!moreMenuOpen())}
              class="p-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
              title="More actions"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </button>

            <Show when={moreMenuOpen()}>
              <div class="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg py-1 z-30 text-xs font-sans">
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    window.print();
                  }}
                  class="w-full text-left px-3 py-2 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  <span>Print message</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    const blob = new Blob([
                      `From: ${props.message.sender}\nTo: ${props.message.recipient}\nSubject: ${props.message.subject}\nDate: ${props.message.date}\n\n${props.decryptedContent || props.message.snippet}`
                    ], { type: "message/rfc822" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${(props.message.subject || "message").replace(/[^a-zA-Z0-9_-]/g, "_")}.eml`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  class="w-full text-left px-3 py-2 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Download (.eml)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setDetailsOpen(!detailsOpen());
                  }}
                  class="w-full text-left px-3 py-2 hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>{detailsOpen() ? "Hide headers" : "View headers"}</span>
                </button>
              </div>
            </Show>
          </div>

          {/* Draft Specific Actions */}
          <Show when={props.message.folder === "drafts"}>
            <Show when={props.onEditDraft}>
              <button
                type="button"
                onClick={() => props.onEditDraft?.(props.message)}
                class="px-2.5 py-1 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1 shadow-2xs"
                title="Edit Draft"
              >
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                <span>Edit</span>
              </button>
            </Show>
            <Show when={props.onDeleteDraft}>
              <button
                type="button"
                onClick={() => props.onDeleteDraft?.(props.message)}
                class="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition cursor-pointer"
                title="Delete Draft"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </Show>
          </Show>
        </div>
      </div>

      {/* ── Message Content Area ── */}
      <div class="flex-1 flex flex-col overflow-y-auto min-h-0 bg-white dark:bg-[#1E2025]">
        {/* Header & Sender Metadata */}
        <div class="p-6 border-b border-[#E2DFD8]/70 dark:border-[#2E3138] bg-white dark:bg-[#1E2025]">
          <div class="flex items-start justify-between gap-4">
            <div class="flex flex-col gap-1.5 min-w-0">
              <h1 class="text-xl font-bold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight leading-snug break-words">
                {props.message.subject || "(No subject)"}
              </h1>
              {/* Label Badges */}
              <Show when={props.message.labelIds && props.message.labelIds.length > 0}>
                <div class="flex flex-wrap items-center gap-1.5 mt-0.5">
                  <For each={props.message.labelIds}>
                    {(lid) => {
                      const lbl = () => props.labels?.find((l) => l.id === lid);
                      return (
                        <Show when={lbl()}>
                          <span
                            class="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-md text-white shadow-2xs"
                            style={{ "background-color": lbl()!.color || "#878A8E" }}
                          >
                            <span class="w-1.5 h-1.5 rounded-full bg-white/70" />
                            <span>{lbl()!.name}</span>
                            <button
                              type="button"
                              onClick={() => props.onToggleLabel?.(props.message, lid)}
                              class="hover:bg-black/20 rounded-full w-3.5 h-3.5 flex items-center justify-center transition cursor-pointer text-xs font-bold leading-none ml-0.5"
                              title={`Remove ${lbl()!.name}`}
                            >
                              ×
                            </button>
                          </span>
                        </Show>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
            <Show when={props.message.folder !== "inbox"}>
              <span class="px-2 py-0.5 rounded-md bg-[#FAF9F6] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] text-[10px] uppercase font-mono tracking-wider text-[#6E7075] dark:text-[#878A8E] flex-shrink-0">
                {props.message.folder}
              </span>
            </Show>
          </div>

          {/* Sender & Recipient Bar */}
          <div class="mt-4 flex items-start justify-between gap-3">
            <div class="flex items-start gap-3 min-w-0">
              {/* Sender Avatar */}
              <ProfileAvatar
                email={senderEmail()}
                displayName={senderDisplayName()}
                size="md"
              />

              {/* Sender & Recipient details */}
              <div class="flex flex-col min-w-0 text-xs">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] truncate">
                    {senderDisplayName()}
                  </span>
                  <span class="text-[#6E7075] dark:text-[#878A8E] font-mono text-[11px] truncate">
                    &lt;{senderEmail()}&gt;
                  </span>
                </div>

                {/* Recipient summary pill with interactive dropdown */}
                <div class="relative mt-0.5">
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(!detailsOpen())}
                    class="inline-flex items-center gap-1 text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] cursor-pointer"
                  >
                    <span>to {props.message.recipient}</span>
                    <svg class="w-2.5 h-2.5 text-[#6E7075] dark:text-[#878A8E]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  <Show when={detailsOpen()}>
                    <div class="absolute left-0 top-full mt-1.5 w-72 bg-white dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg p-3 z-30 text-[11px] font-sans flex flex-col gap-2">
                      <div class="grid grid-cols-[50px_1fr] gap-1">
                        <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">from:</span>
                        <span class="text-[#1A1B1E] dark:text-[#F3F4F6] break-all">{props.message.sender}</span>
                      </div>
                      <div class="grid grid-cols-[50px_1fr] gap-1">
                        <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">to:</span>
                        <span class="text-[#1A1B1E] dark:text-[#F3F4F6] break-all">{props.message.recipient}</span>
                      </div>
                      <div class="grid grid-cols-[50px_1fr] gap-1">
                        <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">date:</span>
                        <span class="text-[#1A1B1E] dark:text-[#F3F4F6] font-mono">{props.message.date}</span>
                      </div>
                      <div class="grid grid-cols-[50px_1fr] gap-1">
                        <span class="text-[#6E7075] dark:text-[#878A8E] font-medium">security:</span>
                        <span class="text-[#A27561] dark:text-[#C59380] font-medium flex items-center gap-1.5">
                          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          <span>End-to-End Encrypted</span>
                        </span>
                      </div>
                    </div>
                  </Show>
                </div>
              </div>
            </div>

            {/* Date in Monospace & Sent Tracking Status */}
            <div class="flex flex-col items-end gap-1 flex-shrink-0">
              <div class="font-mono text-xs text-[#6E7075] dark:text-[#878A8E]">
                {props.message.date}
              </div>

              <Show when={props.message.folder === "sent" && props.message.trackingInfo}>
                <div class="text-[11px] font-mono flex items-center gap-1">
                  <Show
                    when={props.message.trackingInfo!.openCount > 0}
                    fallback={
                      <span class="text-[#878A8E]">✓ Sent • Not opened yet</span>
                    }
                  >
                    <span class="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                      <span>✓✓</span>
                      <span>
                        Opened {props.message.trackingInfo!.openCount} time{props.message.trackingInfo!.openCount > 1 ? "s" : ""}
                      </span>
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>

        {/* Decrypted Message Body */}
        <div class="p-6 flex-1 text-sm text-[#1A1B1E] dark:text-[#F3F4F6] leading-relaxed whitespace-pre-wrap font-sans select-text">
          {/* Tracker Blocker Privacy Banner */}
          <Show when={trackerInfo().count > 0}>
            <div class="mb-5 p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs flex flex-col gap-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span class="p-1 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </span>
                  <span class="font-bold text-amber-900 dark:text-amber-200">
                    {trackerInfo().count} email tracker{trackerInfo().count > 1 ? "s" : ""} blocked
                  </span>
                  <span class="text-amber-800/80 dark:text-amber-300/80 hidden sm:inline">
                    — Protected your reading activity and location from the sender.
                  </span>
                </div>

                <div class="flex items-center gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowTrackerDetails(!showTrackerDetails())}
                    class="text-[11px] text-[#A27561] hover:underline font-semibold cursor-pointer"
                  >
                    {showTrackerDetails() ? "Hide Details" : "View Details"}
                  </button>
                  <Show when={!allowRemoteImages()}>
                    <button
                      type="button"
                      onClick={() => setAllowRemoteImages(true)}
                      class="px-2.5 py-1 text-[11px] font-medium border border-amber-300 dark:border-amber-800 rounded-lg hover:bg-white dark:hover:bg-[#1E2025] transition cursor-pointer"
                    >
                      Load Remote Images
                    </button>
                  </Show>
                </div>
              </div>

              <Show when={showTrackerDetails()}>
                <div class="pt-2 border-t border-amber-200/80 dark:border-amber-900/50 space-y-1">
                  <span class="text-[10px] font-mono uppercase text-amber-800 dark:text-amber-300">Blocked Tracker URLs:</span>
                  <For each={trackerInfo().urls}>
                    {(url) => (
                      <div class="text-[11px] font-mono text-[#464748] dark:text-[#E2DFD8] truncate bg-white/70 dark:bg-[#1E2025] px-2 py-1 rounded border border-amber-200/70 dark:border-amber-900/40">
                        {url}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={props.isDecrypting}>
            <div class="flex flex-col gap-3 animate-pulse py-4">
              <div class="flex items-center gap-2 text-[#A27561] dark:text-[#C59380] text-xs font-mono">
                <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <span>Decrypting sovereign message…</span>
              </div>
              <div class="h-3 bg-[#F0EEE9] dark:bg-[#26282E] rounded-md w-3/4" />
              <div class="h-3 bg-[#F0EEE9] dark:bg-[#26282E] rounded-md w-full" />
              <div class="h-3 bg-[#F0EEE9] dark:bg-[#26282E] rounded-md w-5/6" />
              <div class="h-3 bg-[#F0EEE9] dark:bg-[#26282E] rounded-md w-2/3" />
            </div>
          </Show>

          <Show when={!props.isDecrypting && props.decryptedContent}>
            <Show
              when={/<[a-z][\s\S]*>/i.test(props.decryptedContent || "")}
              fallback={props.decryptedContent}
            >
              <div innerHTML={trackerInfo().sanitized} />
            </Show>
          </Show>

          {/* Attachment Chips Section */}
          <Show when={props.attachments.length > 0}>
            <div class="mt-8 pt-6 border-t border-[#E2DFD8]/80 dark:border-[#2E3138]">
              <h3 class="text-xs font-semibold text-[#464748] dark:text-[#A1A1AA] uppercase tracking-wider mb-3 font-mono flex items-center gap-1.5">
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
                <span>Attachments ({props.attachments.length})</span>
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <For each={props.attachments}>
                  {(att) => (
                    <div class="flex items-center justify-between p-3 bg-[#FAF9F6] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561]/50 transition group">
                      <div class="flex items-center gap-2.5 min-w-0 pr-2">
                        <AttachmentBadge filename={att.filename} contentType={att.content_type} size="md" showLabel={false} />
                        <div class="min-w-0">
                          <div class="flex items-center gap-1.5">
                            <span class="text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] truncate" title={att.filename}>
                              {att.filename}
                            </span>
                            <AttachmentBadge filename={att.filename} contentType={att.content_type} size="xs" />
                          </div>
                          <div class="text-[10px] text-[#6E7075] dark:text-[#878A8E] font-mono truncate">
                            {formatFileSize(att.size_bytes)} • {att.content_type}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => props.onDownloadAttachment(att)}
                        disabled={props.downloadingAttachmentId === att.id}
                        class="rounded-lg bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] px-2.5 py-1 text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] hover:text-[#A27561] dark:hover:text-[#A27561] disabled:opacity-50 cursor-pointer shadow-2xs transition-all flex-shrink-0"
                      >
                        {props.downloadingAttachmentId === att.id ? "Downloading…" : "Download"}
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* ── Bottom Quick Reply Dock ── */}
      <Show when={canReply()}>
        <div class="p-4 border-t border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F6] dark:bg-[#18191D] flex items-center gap-2.5 flex-shrink-0">
          <button
            type="button"
            onClick={() => props.onReply(props.message)}
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] dark:hover:border-[#A27561] text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] hover:text-[#A27561] dark:hover:text-[#A27561] transition cursor-pointer shadow-2xs"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polyline points="9 14 4 9 9 4" />
              <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
            </svg>
            <span>Reply</span>
          </button>

          <button
            type="button"
            onClick={() => props.onForward(props.message)}
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] dark:hover:border-[#A27561] text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] hover:text-[#A27561] dark:hover:text-[#A27561] transition cursor-pointer shadow-2xs"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polyline points="15 14 20 9 15 4" />
              <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
            </svg>
            <span>Forward</span>
          </button>
        </div>
      </Show>
    </main>
  );
};
