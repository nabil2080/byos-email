import { Component, createSignal, createEffect, Show, For, onMount, onCleanup } from "solid-js";
import DOMPurify from "dompurify";
import { DisplayMessage } from "./MessageList";
import { AttachmentItem, MailboxFolder, MailboxLabel, downloadAndDecryptAttachment } from "../api";
import { AttachmentBadge } from "./AttachmentBadge";
import { SnoozeMenu } from "./SnoozeMenu";
import { formatScheduledBanner } from "../utils/dateTime";
import { sanitizeOnReceive } from "../composer_sanitizer";
import { highlightCodeBlocks } from "../utils/code_highlight";
import { getMailboxKeyFor } from "../session_isolation";
import { formatAddress } from "./MessageRow";
import { InvitationCard } from "./calendar/InvitationCard";
import type { ParsedIcsEvent } from "../utils/calendarIcs";
import { extractEventFromEmail, DetectedEmailEvent } from "../utils/calendarEmailExtractor";
import { EmailEventSuggestionCard } from "./calendar/integrations/EmailEventSuggestionCard";
import {
  getIntegrationSettings,
  getDismissedSuggestionIds,
  dismissSuggestion,
  getLinkedEmailEvents,
  linkEmailToCalendarEvent,
  unlinkEmailEvent,
} from "./calendar/integrations/calendarIntegrationsStore";
import { buildEmlContent, downloadEmlFile } from "../utils/eml_export";
import {
  extractUnsubscribeLink,
  isSenderUnsubscribed,
  unsubscribeSender,
} from "../subscriptions_store";
import { UnsubscribeConfirmModal } from "./modals/UnsubscribeConfirmModal";
import {
  translateEmail,
  detectLanguage,
  getLanguageName,
  SUPPORTED_LANGUAGES,
} from "../utils/translator";
import { t, locale } from "../utils/i18n";

export interface ReadingPaneProps {
  message: DisplayMessage;
  isDecrypting: boolean;
  decryptedContent: string | null;
  calendarIcs?: string | null;
  onRsvpInvitation?: (status: "ACCEPTED" | "TENTATIVE" | "DECLINED", event: ParsedIcsEvent) => Promise<void>;
  onOpenCalendarEvent?: (eventId: string) => void;
  onAddSuggestedCalendarEvent?: (event: DetectedEmailEvent) => Promise<void>;
  onRemoveSuggestedCalendarEvent?: (event: DetectedEmailEvent) => Promise<void>;
  mailboxKey?: Uint8Array | null;
  lockedAccount?: { email: string; mailboxId: string; isHistorical?: boolean } | null;
  hasHistoricalLocked?: boolean;
  onUnlockAccount?: (account: { email: string; mailboxId: string; isHistorical?: boolean }) => void;
  senderVerification?: { verified: boolean; error?: string } | null;
  attachments: AttachmentItem[];
  downloadingAttachmentId: string | null;
  onDownloadAttachment: (att: AttachmentItem) => void;
  onBack: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onArchive: (msg: DisplayMessage) => void;
  onSnooze?: (msg: DisplayMessage, until: Date) => void;
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
  onCancelScheduled?: (msg: DisplayMessage) => void;
  onEditScheduled?: (msg: DisplayMessage) => void;
  customFolders?: MailboxFolder[];
  labels?: MailboxLabel[];
  onToggleLabel?: (msg: DisplayMessage, labelId: string) => void;
  onExportEml?: (msg: DisplayMessage) => Promise<void> | void;
  currentUserEmail?: string;
  currentUserPhotoUrl?: string | null;
  onShowToast?: (message: string) => void;
  onTrashSenderMessages?: (sender: string) => void;
  fontScale?: "default" | "large" | "xlarge";
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
  const [moreMenuOpen, setMoreMenuOpen] = createSignal(false);
  const [moreSubmenu, setMoreSubmenu] = createSignal<"main" | "move" | "label">("main");
  const [snoozeMenuOpen, setSnoozeMenuOpen] = createSignal(false);
  const [allowRemoteImages, setAllowRemoteImages] = createSignal(false);
  const [showTrackerDetails, setShowTrackerDetails] = createSignal(false);

  // Gmail-style inline message translation
  const [showTranslationBar, setShowTranslationBar] = createSignal(false);
  const [sourceLang, setSourceLang] = createSignal("auto");
  const [targetLang, setTargetLang] = createSignal(
    typeof window !== "undefined" ? localStorage.getItem("byos_language") || "en" : "en"
  );
  const [isTranslated, setIsTranslated] = createSignal(false);
  const [alwaysTranslate, setAlwaysTranslate] = createSignal(false);

  // Auto-detect source language based on subject and content
  const detectedSourceLang = () => {
    const raw = (props.message.subject || "") + " " + (props.decryptedContent || props.message.snippet || "");
    return detectLanguage(raw);
  };

  const effectiveSourceLang = () => {
    return sourceLang() === "auto" ? detectedSourceLang() : sourceLang();
  };

  createEffect(() => {
    // When message ID changes, check auto translation preference
    props.message.id;
    const detected = detectedSourceLang();
    const alwaysKey = "byos_always_translate_" + detected;
    const isAlways = typeof window !== "undefined" && localStorage.getItem(alwaysKey) === "true";
    if (isAlways) {
      setAlwaysTranslate(true);
      setShowTranslationBar(true);
      setIsTranslated(true);
    } else {
      setAlwaysTranslate(false);
      setShowTranslationBar(false);
      setIsTranslated(false);
    }
  });

  function handleToggleAlwaysTranslate(enabled: boolean) {
    setAlwaysTranslate(enabled);
    const lang = effectiveSourceLang();
    if (typeof window !== "undefined") {
      if (enabled) {
        localStorage.setItem("byos_always_translate_" + lang, "true");
      } else {
        localStorage.removeItem("byos_always_translate_" + lang);
      }
    }
  }

  const translatedSubject = () => {
    if (!isTranslated()) return props.message.subject || "(No subject)";
    return translateEmail(props.message.subject || "", effectiveSourceLang(), targetLang());
  };

  const translatedBody = () => {
    const rawHtml = sanitizeResult().sanitized;
    if (!isTranslated()) return rawHtml;
    const translated = translateEmail(rawHtml, effectiveSourceLang(), targetLang());
    return sanitizeOnReceive(translated, { allowRemoteImages: allowRemoteImages() }).sanitized;
  };

  let readingContentRef: HTMLDivElement | undefined;
  let createdObjectUrls: string[] = [];

  const sanitizeResult = () => {
    const raw = props.decryptedContent || "";
    if (!raw) return { sanitized: "", hasBlockedImages: false, blockedCount: 0 };
    return sanitizeOnReceive(raw, { allowRemoteImages: allowRemoteImages() });
  };

  createEffect(() => {
    const raw = props.decryptedContent;
    const allow = allowRemoteImages();
    isTranslated();
    if (!readingContentRef || !raw) return;

    // Highlight code blocks
    highlightCodeBlocks(readingContentRef);

    // Resolve byos-storage:// images
    const imgs = readingContentRef.querySelectorAll("img");
    imgs.forEach(async (img) => {
      const src = img.getAttribute("src") || "";
      if (src.startsWith("byos-storage://")) {
        const match = src.match(/^byos-storage:\/\/([^/]+)\/(.+)$/);
        if (match) {
          const [, boxId, attId] = match;
          const key = props.mailboxKey || getMailboxKeyFor(boxId);
          if (key) {
            try {
              const blob = await downloadAndDecryptAttachment(boxId, attId, key);
              const objUrl = URL.createObjectURL(blob);
              createdObjectUrls.push(objUrl);
              img.src = objUrl;
            } catch (err) {
              console.warn("Failed to decrypt inline image:", err);
            }
          }
        }
      }
    });
  });

  let paneToolbarRef: HTMLDivElement | undefined;

  function handleClickOutside(e: MouseEvent) {
    if (paneToolbarRef && !paneToolbarRef.contains(e.target as Node)) {
      setMoreMenuOpen(false);
      setMoreSubmenu("main");
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (snoozeMenuOpen()) {
        setSnoozeMenuOpen(false);
        e.stopPropagation();
        return;
      }
      if (moreSubmenu() !== "main") {
        setMoreSubmenu("main");
        e.stopPropagation();
        return;
      }
      if (moreMenuOpen()) {
        setMoreMenuOpen(false);
        e.stopPropagation();
        return;
      }
      if (detailsOpen()) {
        setDetailsOpen(false);
        e.stopPropagation();
        return;
      }
      props.onBack();
    }
  }

  const mailboxId = () => props.message.mailboxId || (props.message as any).mailbox_id || "";
  const [integrationsUpdated, setIntegrationsUpdated] = createSignal(0);
  const [unsubTick, setUnsubTick] = createSignal(0);
  const [unsubConfirmOpen, setUnsubConfirmOpen] = createSignal(false);

  const isUnsubscribed = () => {
    unsubTick();
    return isSenderUnsubscribed(mailboxId(), senderEmail());
  };

  const unsubLink = () => {
    const headers = (props.message as any).headers;
    return extractUnsubscribeLink(headers, props.decryptedContent || props.message.snippet);
  };

  const showUnsubscribe = () => {
    if (props.message.folder === "sent" || props.message.folder === "drafts") return false;
    if (isUnsubscribed()) return true;
    if (props.message.category === "newsletters") return true;
    const headers = (props.message as any).headers;
    if (headers && (headers["list-unsubscribe"] || headers["List-Unsubscribe"] || headers["list-id"] || headers["List-Id"])) return true;
    return Boolean(unsubLink());
  };

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    const handleIntegrationsUpdate = () => setIntegrationsUpdated((c) => c + 1);
    window.addEventListener("byos_calendar_integrations_updated", handleIntegrationsUpdate);
    const handleUnsubUpdate = () => setUnsubTick((c) => c + 1);
    window.addEventListener("byos_subscriptions_updated", handleUnsubUpdate);
    const handleLanguageUpdate = (e: Event) => {
      const custom = e as CustomEvent<{ language?: string }>;
      if (custom.detail?.language) {
        setTargetLang(custom.detail.language);
      }
    };
    window.addEventListener("byos_language_changed", handleLanguageUpdate);
    onCleanup(() => {
      window.removeEventListener("byos_calendar_integrations_updated", handleIntegrationsUpdate);
      window.removeEventListener("byos_subscriptions_updated", handleUnsubUpdate);
      window.removeEventListener("byos_language_changed", handleLanguageUpdate);
    });
  });

  const integrationSettings = () => {
    integrationsUpdated();
    return getIntegrationSettings(mailboxId());
  };

  const dismissedIds = () => {
    integrationsUpdated();
    return new Set(getDismissedSuggestionIds(mailboxId()));
  };

  const linkedEvents = () => {
    integrationsUpdated();
    return getLinkedEmailEvents(mailboxId());
  };

  const detectedEvent = () => {
    if (props.isDecrypting || !props.decryptedContent) return null;
    const settings = integrationSettings();
    if (!settings.enabled || !settings.autoSuggestInReadingPane) return null;

    const detected = extractEventFromEmail(
      {
        id: props.message.id,
        subject: props.message.subject || "",
        body: props.decryptedContent,
      },
      {
        enabled: settings.enabled,
        categories: settings.categories,
      }
    );

    if (!detected) return null;
    if (dismissedIds().has(detected.id)) return null;
    return detected;
  };

  const isEventAdded = () => {
    const ev = detectedEvent();
    if (!ev) return false;
    return Boolean(linkedEvents()[props.message.id]);
  };

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
    document.removeEventListener("keydown", handleKeyDown);
    createdObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  });

  const senderEmail = () => {
    const match = props.message.sender.match(/<([^>]+)>/);
    return match ? match[1] : props.message.sender;
  };

  const senderDisplayName = () => {
    const match = props.message.sender.match(/^([^<]+)/);
    return match ? match[1].trim() : props.message.sender;
  };

  const recipientSummary = () => {
    if (props.message.recipients && props.message.recipients.length > 0) {
      const valid = props.message.recipients
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
      if (valid.length > 0) {
        return valid.map(formatAddress).join(", ");
      }
    }
    if (props.message.recipient && props.message.recipient.trim()) {
      const parts = props.message.recipient
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
      if (parts.length > 0) {
        return parts.map(formatAddress).join(", ");
      }
    }
    return props.message.folder === "sent" ? "No recipient" : (props.message.accountEmail || "me");
  };

  const recipientFull = () => {
    if (props.message.recipients && props.message.recipients.length > 0) {
      const valid = props.message.recipients
        .map((r) => r.trim())
        .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
      if (valid.length > 0) {
        return valid.join(", ");
      }
    }
    if (props.message.recipient && props.message.recipient.trim()) {
      const r = props.message.recipient.trim();
      if (r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient") {
        return r;
      }
    }
    return props.message.folder === "sent" ? "(no recipient)" : (props.message.accountEmail || "me");
  };

  const isMessageLocked = () =>
    Boolean(
      props.lockedAccount ||
      props.hasHistoricalLocked ||
      (props.decryptedContent &&
        (props.decryptedContent.includes("key is locked") ||
         props.decryptedContent.includes("key unwrap") ||
         props.decryptedContent.includes("Failed to decrypt") ||
         props.decryptedContent.includes("Failed to open") ||
         props.decryptedContent.includes("Historical Messages Locked")))
    );

  const canReply = () =>
    props.message.folder !== "drafts" &&
    props.message.folder !== "scheduled" &&
    !props.isDecrypting &&
    !isMessageLocked() &&
    props.decryptedContent !== null &&
    !props.decryptedContent.startsWith("Failed to open") &&
    !props.decryptedContent.startsWith("Mailbox is locked") &&
    !props.decryptedContent.startsWith("Unlock ");

  const isExternalSenderError = () => {
    const err = props.senderVerification?.error;
    if (!err) return false;
    return err.includes("outside BYOS") || err.includes("cannot be cryptographically verified");
  };

  return (
    <section data-testid="reading-pane" class="flex-1 bg-white dark:bg-[#18191D] flex flex-col min-w-0 overflow-hidden h-full">
      {/* ── Top Reading Pane Action Toolbar ── */}
      <div
        ref={paneToolbarRef}
        class="px-2.5 sm:px-4 py-2 sm:py-2.5 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F6] dark:bg-[#18191D] flex items-center justify-between gap-1.5 sm:gap-2 flex-shrink-0 select-none relative z-30"
      >
        {/* Left Side: Back button & Sequential Switchers */}
        <div class="flex items-center gap-1.5 sm:gap-2">
          {/* Back to full message list button */}
          <button
            type="button"
            onClick={props.onBack}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] hover:text-[#A27561] dark:hover:text-[#A27561] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] transition cursor-pointer border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] shadow-2xs min-h-[36px]"
            title={t("Back to messages (Esc)")}
            aria-label={t("Back to messages")}
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span>{t("Back")}</span>
          </button>

          <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

          {/* Sequential Prev/Next Chevrons */}
          <div class="flex items-center gap-0.5 bg-white dark:bg-[#1E2025] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={props.onPrev}
              disabled={!props.hasPrev}
              class="p-1 rounded text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
              title={t("Previous message (Older)")}
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
              title={t("Next message (Newer)")}
            >
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </div>
        </div>

        {/* Right Side: Standard Triage Actions & More Overflow */}
        <div class="flex items-center gap-1 sm:gap-1.5">
          {/* 1. Archive */}
          <button
            type="button"
            onClick={() => props.onArchive(props.message)}
            class="w-8 h-8 sm:w-9 sm:h-9 min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 sm:p-2 flex items-center justify-center text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] rounded-xl transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
            title={t("Archive")}
            aria-label={t("Archive")}
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
          </button>

          {/* 2. Trash or Delete Forever */}
          <Show
            when={props.message.folder === "trash"}
            fallback={
              <button
                type="button"
                onClick={() => props.onTrash(props.message)}
                class="w-8 h-8 sm:w-9 sm:h-9 min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 sm:p-2 flex items-center justify-center text-[#464748] dark:text-[#A3A3A3] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                title={t("Move to Trash")}
                aria-label={t("Move to Trash")}
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
              class="w-8 h-8 sm:w-9 sm:h-9 min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 sm:p-2 flex items-center justify-center text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition cursor-pointer border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50 focus:outline-none focus:ring-2 focus:ring-rose-400/50"
              title={t("Delete Forever")}
              aria-label={t("Delete Forever")}
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="14" y2="15" />
                <line x1="14" y1="11" x2="10" y2="15" />
              </svg>
            </button>
          </Show>

          {/* 3. Single Contextual Read/Unread Smart Toggle */}
          <button
            type="button"
            onClick={() => props.onToggleRead(props.message)}
            class="w-8 h-8 sm:w-9 sm:h-9 min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 sm:p-2 flex items-center justify-center text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] rounded-xl transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
            title={props.message.read ? t("Mark as unread") : t("Mark as read")}
            aria-label={props.message.read ? t("Mark as unread") : t("Mark as read")}
          >
            <Show
              when={props.message.read}
              fallback={
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
              }
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </Show>
          </button>

          {/* 4. Star toggle */}
          <button
            type="button"
            onClick={() => props.onToggleStarred(props.message)}
            class={`w-8 h-8 sm:w-9 sm:h-9 min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 sm:p-2 flex items-center justify-center rounded-xl transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
              props.message.starred
                ? "text-amber-500 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100/60 dark:hover:bg-amber-950/50"
                : "text-[#464748] dark:text-[#A3A3A3] hover:text-amber-500 hover:bg-[#F0EEE9] dark:hover:bg-[#26282E]"
            }`}
            title={props.message.starred ? t("Unstar") : t("Star")}
            aria-label={props.message.starred ? t("Unstar") : t("Star")}
          >
            <Show
              when={props.message.starred}
              fallback={
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              }
            >
              <svg class="w-4 h-4 fill-amber-400 stroke-amber-500 stroke-[1.5]" viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </Show>
          </button>

          {/* 5. More Actions Overflow Menu (⋮) */}
          <div class="relative">
            <button
              type="button"
              data-testid="reading-pane-overflow-btn"
              data-testid-alt="reading-pane-more-btn"
              onClick={() => {
                const willOpen = !moreMenuOpen();
                setMoreMenuOpen(willOpen);
                if (willOpen) setMoreSubmenu("main");
              }}
              class={`w-8 h-8 sm:w-9 sm:h-9 min-w-[32px] min-h-[32px] sm:min-w-[36px] sm:min-h-[36px] p-1.5 sm:p-2 flex items-center justify-center rounded-xl transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 ${
                moreMenuOpen()
                  ? "bg-[#F0EEE9] dark:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6]"
                  : "text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E]"
              }`}
              title={t("More actions")}
              aria-label={t("More actions")}
              aria-haspopup="menu"
              aria-expanded={moreMenuOpen()}
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="1.25" fill="currentColor" />
                <circle cx="12" cy="12" r="1.25" fill="currentColor" />
                <circle cx="12" cy="19" r="1.25" fill="currentColor" />
              </svg>
            </button>

            {/* Overflow Dropdown: Always in DOM for querySelector / test compatibility, toggled via styling */}
            <div
              role="menu"
              aria-label="More actions menu"
              class={`absolute right-0 top-full mt-1.5 w-56 bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl py-1.5 z-50 text-xs font-sans transition-all duration-150 origin-top-right ${
                moreMenuOpen() ? "opacity-100 scale-100 pointer-events-auto" : "opacity-0 scale-95 pointer-events-none hidden"
              }`}
            >
              <Show when={moreSubmenu() === "main"}>
                {/* Snooze */}
                <button
                  type="button"
                  role="menuitem"
                  data-testid="reading-pane-snooze-btn"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setSnoozeMenuOpen(true);
                  }}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2.5"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span>{t("Snooze")}</span>
                </button>

                {/* Move to folder */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setMoreSubmenu("move")}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center justify-between gap-2.5"
                >
                  <div class="flex items-center gap-2.5">
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span>{t("Move to folder")}</span>
                  </div>
                  <svg class="w-3.5 h-3.5 text-[#878A8E]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Label as */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setMoreSubmenu("label")}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center justify-between gap-2.5"
                >
                  <div class="flex items-center gap-2.5">
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                      <line x1="7" y1="7" x2="7.01" y2="7" />
                    </svg>
                    <span>{t("Labels")}</span>
                  </div>
                  <svg class="w-3.5 h-3.5 text-[#878A8E]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Report Spam */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    props.onSpam(props.message);
                  }}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2.5"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{t("Report spam")}</span>
                </button>

                <div class="my-1 border-t border-[#E2DFD8] dark:border-[#2E3138]" />

                {/* Print */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    window.print();
                  }}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2.5"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <polyline points="6 9 6 2 18 2 18 9" />
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                    <rect x="6" y="14" width="12" height="8" />
                  </svg>
                  <span>{t("Print message")}</span>
                </button>

                {/* Download (.eml) */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setMoreMenuOpen(false);
                    if (props.onExportEml) {
                      await props.onExportEml(props.message);
                    } else {
                      const eml = buildEmlContent({
                        from: props.message.sender,
                        to: props.message.recipient,
                        subject: props.message.subject || "(no subject)",
                        date: props.message.date,
                        bodyPlain: props.decryptedContent || props.message.snippet,
                      });
                      downloadEmlFile(
                        (props.message.subject || "message").replace(/[^a-zA-Z0-9_-]/g, "_"),
                        eml
                      );
                    }
                  }}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2.5"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{t("Download (.eml)")}</span>
                </button>

                {/* View headers */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setDetailsOpen(!detailsOpen());
                  }}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2.5"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>{detailsOpen() ? t("Hide headers") : t("View headers")}</span>
                </button>

                {/* Translate message */}
                <button
                  type="button"
                  role="menuitem"
                  data-testid="reading-pane-translate-menu-btn"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    setShowTranslationBar(true);
                    const detected = effectiveSourceLang();
                    let target = targetLang();
                    if (detected === target) {
                      const preferred = locale();
                      target = preferred && preferred !== detected ? preferred : (detected === "en" ? "es" : "en");
                      setTargetLang(target);
                    }
                  }}
                  class="w-full text-left px-3.5 py-2 min-h-[34px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2.5"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <path d="m5 8 6 6" />
                    <path d="m4 14 6-6 2-3" />
                    <path d="M2 5h12" />
                    <path d="M7 2h1" />
                    <path d="m22 22-5-10-5 10" />
                    <path d="M14 18h6" />
                  </svg>
                  <span>{isTranslated() ? t("Translation options") : t("Translate message")}</span>
                </button>
              </Show>

              {/* Submenu: Move to Folder */}
              <Show when={moreSubmenu() === "move"}>
                <div class="flex items-center gap-2 px-3 py-1.5 border-b border-[#E2DFD8] dark:border-[#2E3138] font-semibold text-[11px] text-[#6E7075] dark:text-[#878A8E]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoreSubmenu("main");
                    }}
                    class="p-0.5 hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] rounded transition"
                    title="Back to options"
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span>Move to folder</span>
                </div>
                <div class="max-h-60 overflow-y-auto py-1">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      props.onMoveTo(props.message, "inbox");
                      setMoreMenuOpen(false);
                      setMoreSubmenu("main");
                    }}
                    class="w-full text-left px-3.5 py-1.5 min-h-[32px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                    </svg>
                    <span>Inbox</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      props.onMoveTo(props.message, "archive");
                      setMoreMenuOpen(false);
                      setMoreSubmenu("main");
                    }}
                    class="w-full text-left px-3.5 py-1.5 min-h-[32px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
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
                    role="menuitem"
                    onClick={() => {
                      props.onMoveTo(props.message, "spam");
                      setMoreMenuOpen(false);
                      setMoreSubmenu("main");
                    }}
                    class="w-full text-left px-3.5 py-1.5 min-h-[32px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2"
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
                    role="menuitem"
                    onClick={() => {
                      props.onMoveTo(props.message, "trash");
                      setMoreMenuOpen(false);
                      setMoreSubmenu("main");
                    }}
                    class="w-full text-left px-3.5 py-1.5 min-h-[32px] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition cursor-pointer flex items-center gap-2"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    <span>Trash</span>
                  </button>

                  <Show when={props.customFolders && props.customFolders.length > 0}>
                    <div class="my-1 border-t border-[#E2DFD8] dark:border-[#2E3138]" />
                    <div class="px-3.5 py-1 text-[10px] font-bold text-[#878A8E] dark:text-[#71717A] uppercase tracking-wider font-mono">
                      Custom Folders
                    </div>
                    <For each={props.customFolders}>
                      {(folder) => (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            props.onMoveTo(props.message, folder.name);
                            setMoreMenuOpen(false);
                            setMoreSubmenu("main");
                          }}
                          class="w-full text-left px-3.5 py-1.5 min-h-[32px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center gap-2 truncate"
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

              {/* Submenu: Labels */}
              <Show when={moreSubmenu() === "label"}>
                <div class="flex items-center gap-2 px-3 py-1.5 border-b border-[#E2DFD8] dark:border-[#2E3138] font-semibold text-[11px] text-[#6E7075] dark:text-[#878A8E]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMoreSubmenu("main");
                    }}
                    class="p-0.5 hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] rounded transition"
                    title="Back to options"
                  >
                    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <span>Labels</span>
                </div>
                <div class="max-h-60 overflow-y-auto py-1">
                  <Show
                    when={props.labels && props.labels.length > 0}
                    fallback={
                      <div class="px-3.5 py-3 text-center text-[#878A8E] dark:text-[#71717A] text-xs">
                        No labels created yet
                      </div>
                    }
                  >
                    <For each={props.labels}>
                      {(lbl) => {
                        const hasLabel = () => Boolean(props.message.labelIds?.includes(lbl.id));
                        return (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => props.onToggleLabel?.(props.message, lbl.id)}
                            class="w-full text-left px-3.5 py-1.5 min-h-[32px] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] transition cursor-pointer flex items-center justify-between gap-2"
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
          </div>

          {/* SnoozeMenu Dialog */}
          <SnoozeMenu
            open={snoozeMenuOpen()}
            onClose={() => setSnoozeMenuOpen(false)}
            onSelect={(until) => {
              setSnoozeMenuOpen(false);
              props.onSnooze?.(props.message, until);
            }}
          />

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
        <Show when={props.message.folder === "scheduled"}>
          <div class="px-6 py-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/60 flex items-center justify-between gap-4 text-xs flex-shrink-0">
            <div class="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-medium">
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{formatScheduledBanner(props.message.scheduledAt || props.message.date, props.message.status)}</span>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => (props.onEditScheduled ? props.onEditScheduled(props.message) : props.onEditDraft?.(props.message))}
                class="px-3 py-1 bg-white dark:bg-[#1E2025] hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 font-medium rounded-md border border-amber-300 dark:border-amber-800 transition cursor-pointer"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => props.onCancelScheduled?.(props.message)}
                class="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-md transition cursor-pointer shadow-2xs"
              >
                Cancel send
              </button>
            </div>
          </div>
        </Show>

        {/* Header & Sender Metadata */}
        <div class="p-6 border-b border-[#E2DFD8]/70 dark:border-[#2E3138] bg-white dark:bg-[#1E2025]">
          <div class="flex items-start justify-between gap-4">
            <div class="flex flex-col gap-1.5 min-w-0">
              <h1 class="text-xl font-bold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight leading-snug break-words">
                {isTranslated() ? translatedSubject() : (props.message.subject || "(No subject)")}
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
              {/* Sender & Recipient details */}
              <div class="flex flex-col min-w-0 text-xs">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <Show when={props.message.folder === "sent"}>
                    <span class="text-[#878A8E] dark:text-[#8A8E94] font-normal mr-0.5">from</span>
                  </Show>
                  <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] truncate">
                    {senderDisplayName()}
                  </span>
                  <span class="text-[#6E7075] dark:text-[#878A8E] font-mono text-[11px] truncate">
                    &lt;{senderEmail()}&gt;
                  </span>
                  <Show when={showUnsubscribe()}>
                    <span class="text-[#878A8E] dark:text-[#6E7075] select-none mx-0.5">•</span>
                    <Show
                      when={isUnsubscribed()}
                      fallback={
                        <button
                          type="button"
                          onClick={() => setUnsubConfirmOpen(true)}
                          class="text-[11px] font-medium text-[#A27561] dark:text-[#C59380] hover:text-[#885A47] dark:hover:text-[#DEAC98] hover:underline cursor-pointer"
                          data-testid="reading-pane-unsubscribe-btn"
                        >
                          Unsubscribe
                        </button>
                      }
                    >
                      <span
                        class="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1"
                        data-testid="reading-pane-unsubscribed-badge"
                      >
                        ✓ Unsubscribed
                      </span>
                    </Show>
                  </Show>
                  <Show when={props.senderVerification}>
                    <Show when={props.senderVerification?.verified}>
                      <span class="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2 py-0.5 rounded-full shadow-2xs">
                        ✓ Verified sender
                      </span>
                    </Show>
                    <Show when={!props.senderVerification?.verified && !isExternalSenderError()}>
                      <span class="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-2 py-0.5 rounded-full shadow-2xs">
                        ⚠ Unverified sender
                      </span>
                    </Show>
                  </Show>
                  <Show when={props.message.replyViaAlias}>
                    <span
                      class="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#9E725F] dark:text-[#D4A38F] bg-[#F2E8E2] dark:bg-[#2D2522] border border-[#E2DFD8] dark:border-[#3E332E] px-2 py-0.5 rounded-full shadow-2xs font-mono"
                      data-testid="reading-pane-alias-badge"
                    >
                      <svg class="w-3 h-3 stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <path d="M9 12l2 2 4-4" />
                      </svg>
                      <span>
                        Received via {props.message.aliasLabel ? props.message.aliasLabel : props.message.replyViaAlias}
                      </span>
                    </span>
                  </Show>
                </div>

                {/* Recipient summary pill with interactive dropdown */}
                <div class="relative mt-0.5">
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(!detailsOpen())}
                    class="inline-flex items-center gap-1.5 text-[#464748] dark:text-[#A3A3A3] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] cursor-pointer"
                  >
                    <Show when={props.message.accountColor}>
                      <span
                        class="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ "background-color": props.message.accountColor }}
                        title={props.message.accountEmail || "Account"}
                        data-testid="reading-pane-account-dot"
                      />
                    </Show>
                    <span>to {recipientSummary()}</span>
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
                        <span class="text-[#1A1B1E] dark:text-[#F3F4F6] break-all">{recipientFull()}</span>
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

        {/* Inline Translation Bar (Gmail-style) */}
        <Show when={showTranslationBar()}>
          <div
            data-testid="email-translation-bar"
            class="px-4 sm:px-6 py-2.5 bg-[#FAF9F6] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex flex-wrap items-center justify-between gap-3 text-xs flex-shrink-0"
          >
            <div class="flex items-center gap-2.5 flex-wrap">
              <div class="flex items-center gap-1.5 text-[#A27561] dark:text-[#D4A38F] font-semibold">
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <path d="m5 8 6 6" />
                  <path d="m4 14 6-6 2-3" />
                  <path d="M2 5h12" />
                  <path d="M7 2h1" />
                  <path d="m22 22-5-10-5 10" />
                  <path d="M14 18h6" />
                </svg>
                <span class="hidden sm:inline">{t("Translate")}:</span>
              </div>

              {/* Source Language dropdown */}
              <div class="flex items-center gap-1.5">
                <select
                  data-testid="translation-source-lang"
                  value={sourceLang()}
                  onChange={(e) => setSourceLang(e.currentTarget.value)}
                  class="px-2.5 py-1 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] cursor-pointer"
                >
                  <option value="auto">{t("Auto-detect ({lang})", { lang: getLanguageName(detectedSourceLang()) })}</option>
                  <For each={SUPPORTED_LANGUAGES}>
                    {(lang) => <option value={lang.code}>{t(lang.name)}</option>}
                  </For>
                </select>

                <svg class="w-3.5 h-3.5 text-[#878A8E] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>

                {/* Target Language dropdown */}
                <select
                  data-testid="translation-target-lang"
                  value={targetLang()}
                  onChange={(e) => setTargetLang(e.currentTarget.value)}
                  class="px-2.5 py-1 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] cursor-pointer"
                >
                  <For each={SUPPORTED_LANGUAGES}>
                    {(lang) => <option value={lang.code}>{t(lang.name)}</option>}
                  </For>
                </select>
              </div>

              {/* Translate message / Show original action button */}
              <button
                type="button"
                data-testid="translate-action-btn"
                onClick={() => {
                  if (!isTranslated()) {
                    const detected = effectiveSourceLang();
                    if (detected === targetLang()) {
                      setTargetLang(detected === "en" ? "es" : "en");
                    }
                    setIsTranslated(true);
                  } else {
                    setIsTranslated(false);
                  }
                }}
                class={`px-3 py-1 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                  isTranslated()
                    ? "bg-[#E2DFD8] dark:bg-[#2E3138] text-[#1A1B1E] dark:text-[#F3F4F6] hover:bg-[#D5D1C8]"
                    : "bg-[#A27561] hover:bg-[#8F6452] text-white"
                }`}
              >
                {isTranslated() ? t("Show original") : t("Translate message")}
              </button>

              {/* Always translate toggle */}
              <label class="hidden md:flex items-center gap-1.5 text-[11px] text-[#6E7075] dark:text-[#878A8E] cursor-pointer select-none">
                <input
                  type="checkbox"
                  data-testid="always-translate-checkbox"
                  checked={alwaysTranslate()}
                  onChange={(e) => handleToggleAlwaysTranslate(e.currentTarget.checked)}
                  class="accent-[#A27561] rounded w-3.5 h-3.5 cursor-pointer"
                />
                <span>{t("Always translate {lang}", { lang: getLanguageName(effectiveSourceLang()) })}</span>
              </label>
            </div>

            {/* Dismiss bar button */}
            <button
              type="button"
              data-testid="close-translation-bar-btn"
              onClick={() => {
                setShowTranslationBar(false);
                setIsTranslated(false);
              }}
              class="p-1 rounded-lg text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
              title={t("Close translation bar")}
              aria-label={t("Close translation bar")}
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </Show>

        {/* Decrypted Message Body */}
        <div class="p-6 flex-1 text-sm text-[#1A1B1E] dark:text-[#F3F4F6] leading-relaxed whitespace-pre-wrap font-sans select-text">
          {/* Active Translation Notice */}
          <Show when={isTranslated()}>
            <div
              data-testid="translated-notice"
              class="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] text-xs font-medium border border-[#A27561]/20 shadow-2xs"
            >
              <span>{t("Translated from {from} to {to}", { from: getLanguageName(effectiveSourceLang()), to: getLanguageName(targetLang()) })}</span>
              <button
                type="button"
                data-testid="show-original-inline-btn"
                onClick={() => setIsTranslated(false)}
                class="underline hover:text-[#885A47] dark:hover:text-[#DEAC98] cursor-pointer font-semibold ml-1"
              >
                {t("Show original")}
              </button>
            </div>
          </Show>
          {/* Tracker Blocker / Remote Image Privacy Banner */}
          <Show when={sanitizeResult().hasBlockedImages}>
            <div class="mb-5 p-3.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-xs flex flex-col gap-2">
              <div class="flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                  <span class="p-1 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                  </span>
                  <span class="font-bold text-amber-900 dark:text-amber-200">
                    {sanitizeResult().blockedCount} remote image{sanitizeResult().blockedCount > 1 ? "s" : ""} blocked
                  </span>
                  <span class="text-amber-800/80 dark:text-amber-300/80 hidden sm:inline">
                    — Protected your reading activity and location from the sender.
                  </span>
                </div>

                <div class="flex items-center gap-2 flex-shrink-0">
                  <Show when={!allowRemoteImages()}>
                    <button
                      type="button"
                      data-testid="load-remote-images-btn"
                      onClick={() => setAllowRemoteImages(true)}
                      class="px-2.5 py-1 text-[11px] font-medium border border-amber-300 dark:border-amber-800 rounded-lg hover:bg-white dark:hover:bg-[#1E2025] transition cursor-pointer"
                    >
                      Load Remote Images
                    </button>
                  </Show>
                </div>
              </div>
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
              <div class="h-3 skeleton rounded-md w-3/4" />
              <div class="h-3 skeleton rounded-md w-full" />
              <div class="h-3 skeleton rounded-md w-5/6" />
              <div class="h-3 skeleton rounded-md w-2/3" />
            </div>
          </Show>

          <Show when={props.senderVerification && !props.senderVerification.verified && !isExternalSenderError()}>
            <div role="alert" class="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
              <span class="text-sm leading-none mt-0.5">⚠</span>
              <div>
                <p class="font-semibold">
                  Sender could not be verified
                </p>
                <p class="mt-0.5">
                  {props.senderVerification?.error || 
                   "This message could not be cryptographically verified against the sender's public key."}
                </p>
              </div>
            </div>
          </Show>

          {/* Locked Account / Historical Messages Placeholder & Unlock Button */}
          <Show when={isMessageLocked()}>
            <div
              data-testid="locked-account-placeholder"
              class="my-8 p-6 rounded-2xl bg-[#FAF9F6] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] flex flex-col items-center justify-center text-center space-y-3"
            >
              <div class="w-12 h-12 rounded-full bg-[#A27561]/10 flex items-center justify-center text-[#A27561]">
                <svg class="w-6 h-6 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div class="space-y-1">
                <p class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]" data-testid="locked-account-message">
                  <Show
                    when={props.lockedAccount?.isHistorical || props.hasHistoricalLocked}
                    fallback={`Unlock ${props.lockedAccount?.email || props.message.recipient || props.message.sender} to read this message.`}
                  >
                    Historical Messages Locked: Unlock {props.lockedAccount?.email || props.message.recipient || props.message.sender} to read this message.
                  </Show>
                </p>
                <p class="text-xs text-[#878A8E] dark:text-[#A1A1AA] max-w-md">
                  <Show
                    when={props.lockedAccount?.isHistorical || props.hasHistoricalLocked}
                    fallback={`End-to-end encryption keys for ${props.lockedAccount?.email || props.message.recipient || props.message.sender} are not currently in memory.`}
                  >
                    Your account password was recently reset. Your previous encrypted messages remain locked until you reactivate your historical keys with your 24-word recovery phrase or old password.
                  </Show>
                </p>
              </div>
              <button
                type="button"
                data-testid="unlock-mails-btn"
                data-account-unlock-btn="true"
                onClick={() => {
                  const target = props.lockedAccount || {
                    email: props.message.accountEmail || props.message.recipient || props.message.sender,
                    mailboxId: props.message.mailboxId || (props.message as any).mailbox_id,
                    isHistorical: Boolean(props.hasHistoricalLocked),
                  };
                  props.onUnlockAccount?.(target);
                }}
                class="mt-2 px-5 py-2.5 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition cursor-pointer shadow-xs"
              >
                Unlock mails
              </button>
            </div>
          </Show>

          {/* Email Event Suggestion Card (Category 13) */}
          <Show when={!isMessageLocked() && !props.isDecrypting && detectedEvent()}>
            <EmailEventSuggestionCard
              event={detectedEvent()!}
              isAdded={isEventAdded()}
              onAdd={async (ev) => {
                if (props.onAddSuggestedCalendarEvent) {
                  await props.onAddSuggestedCalendarEvent(ev);
                } else {
                  linkEmailToCalendarEvent(mailboxId(), {
                    messageId: props.message.id,
                    eventId: `email_event_${props.message.id}`,
                    calendarId: "primary",
                    category: ev.category,
                    confirmationCode: ev.confirmationCode,
                    title: ev.title,
                    addedAt: new Date().toISOString(),
                  });
                }
              }}
              onDismiss={(ev) => {
                dismissSuggestion(mailboxId(), ev.id);
              }}
              onViewInCalendar={() => {
                const linked = linkedEvents()[props.message.id];
                if (props.onOpenCalendarEvent && linked) {
                  props.onOpenCalendarEvent(linked.eventId);
                } else if (typeof window !== "undefined") {
                  window.dispatchEvent(
                    new CustomEvent("byos_open_calendar_event", {
                      detail: { eventId: linked?.eventId || `email_event_${props.message.id}` },
                    })
                  );
                }
              }}
              onRemoveFromCalendar={async (ev) => {
                if (props.onRemoveSuggestedCalendarEvent) {
                  await props.onRemoveSuggestedCalendarEvent(ev);
                } else {
                  unlinkEmailEvent(mailboxId(), props.message.id);
                }
              }}
            />
          </Show>

          {/* Calendar Invitation Card (Phase 5) */}
          <Show when={!isMessageLocked() && !props.isDecrypting && props.calendarIcs}>
            <InvitationCard
              icsString={props.calendarIcs!}
              currentUserEmail={props.currentUserEmail}
              messageSender={props.message.sender}
              mailboxId={props.message.mailboxId || (props.message as any).mailbox_id}
              onRsvp={props.onRsvpInvitation}
            />
          </Show>

          <Show when={!isMessageLocked() && !props.isDecrypting && props.decryptedContent}>
            <div class="animate-fade-in">
            <Show
              when={/<[a-z][\s\S]*>/i.test(props.decryptedContent || "")}
              fallback={
                <div class={`whitespace-pre-wrap font-sans ${props.fontScale === "xlarge" ? "text-scale-xlarge" : props.fontScale === "large" ? "text-scale-large" : "text-scale-default"}`}>
                  {isTranslated() ? translateEmail(props.decryptedContent || "", effectiveSourceLang(), targetLang()) : props.decryptedContent}
                </div>
              }
            >
              <div
                ref={readingContentRef}
                class={`reading-pane-content ${props.fontScale === "xlarge" ? "text-scale-xlarge" : props.fontScale === "large" ? "text-scale-large" : "text-scale-default"}`}
                innerHTML={isTranslated() ? translatedBody() : sanitizeResult().sanitized}
              />
            </Show>
            </div>
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
                    <div data-testid="reading-pane-attachment-item" class="flex items-center justify-between p-3 bg-[#FAF9F6] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561]/50 transition group">
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
                        data-testid="reading-pane-attachment-download-btn"
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
            data-testid="reading-pane-reply-btn"
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] dark:hover:border-[#A27561] text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] hover:text-[#A27561] dark:hover:text-[#A27561] transition cursor-pointer shadow-2xs"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polyline points="9 14 4 9 9 4" />
              <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
            </svg>
            <span>{t("Reply")}</span>
          </button>

          <button
            type="button"
            onClick={() => props.onForward(props.message)}
            data-testid="reading-pane-forward-btn"
            class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] dark:hover:border-[#A27561] text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] hover:text-[#A27561] dark:hover:text-[#A27561] transition cursor-pointer shadow-2xs"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polyline points="15 14 20 9 15 4" />
              <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
            </svg>
            <span>{t("Forward")}</span>
          </button>
        </div>
      </Show>

      <UnsubscribeConfirmModal
        isOpen={unsubConfirmOpen()}
        onClose={() => setUnsubConfirmOpen(false)}
        senderName={senderDisplayName()}
        senderEmail={senderEmail()}
        unsubscribeUrl={unsubLink()?.url}
        unsubscribeEmail={unsubLink()?.mailto}
        onConfirmUnsubscribe={async (moveToTrash) => {
          unsubscribeSender(mailboxId(), senderEmail(), senderDisplayName(), unsubLink()?.url);
          if (moveToTrash) {
            props.onTrash(props.message);
          }
        }}
      />
    </section>
  );
};
