import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";
import {
  fetchCurrentUser,
  login,
  logout,
  fetchMailboxes,
  fetchMailboxDetail,
  fetchDrafts,
  createDraft,
  updateDraft,
  deleteDraft,
  fetchAttachments,
  downloadAndDecryptAttachment,
  downloadAttachment,
  uploadEncryptedAttachment,
  fetchContacts,
  createContact,
  updateContact,
  deleteContact,
  fetchFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  fetchLabels,
  createLabel,
  updateLabel,
  deleteLabel,
  updateMessageFolder,
  attachMessageLabel,
  detachMessageLabel,
  setMessageRead,
  snoozeMessage,
  deleteAttachment,
  fetchMessages,
  fetchMessageBody,
  fetchOutboundPubkey,
  prepareOutbound,
  sendOutbound,
  scheduleOutbound,
  schedulePathA,
  cancelScheduledMessage,
  updateScheduledMessage,
  fetchScheduledDraft,
  searchMailboxTokens,
  indexSearchToken,
  fetchMailboxSettings,
  updateMailboxSettings,
  registerTracking,
  fetchTrackingList,
  MessageTrackingItem,
  getTrackingPixelUrl,
  apiBase,
  UserMe,
  Mailbox,
  DraftMessage,
  AttachmentItem,
  ContactItem,
  MailboxFolder,
  MailboxLabel,
  MessageMetadata,
  MessageBodyResponse,
  ConnectedAccount,
  fetchPasskeyLoginOptions,
  loginWithPasskey,
  verifyLogin2FA,
  sendLogin2FACode,
  fetchRecoveryOptions,
  requestRecoveryChallenge,
  resetPasswordWithRecovery,
  reactivateHistoricalKeys,
  apiRequest,
  RecoveryOptionItem,
  publishMailboxKeys,
  lookupMailboxKeys,
  sendInternal,
  uploadAttachmentChunk,
  fetchMessageAttachmentEnvelopes,
  fetchMessageAttachmentChunk,
  AttachmentEnvelope,
  KeyDirectoryRecord,
  InternalSendRequest,
  InternalSendResponse,
  fetchThreads,
  fetchThreadMessages,
  ThreadSummary,
  toggleMessageStar,
  fetchMaskedAliases,
  MaskedAliasItem,
  getProfilePhoto,
  deleteProfilePhoto,
} from "./api";
import {
  preparePathAAttachment,
  decryptPathAAttachment,
  MAX_ATTACHMENT_SIZE,
  decryptChunk,
} from "./attachment_crypto";
import {
  unlockMailboxKey,
  autoUnwrapMailboxKey,
  autoUnwrapKeys,
  unwrapMailboxKeyWithRecoveryPhrase,
  decryptMessageEnvelope,
  encryptDraftEnvelope,
  decryptDraftEnvelope,
  encryptContactEnvelope,
  decryptContactEnvelope,
  deriveSearchKeyFromMnemonic,
  computeSearchToken,
  extractKeywords,
  ContactPlaintext,
  bytesToBase64,
  hexToBase64,
  bytesToHex,
  base64ToBytes,
  decryptPathAEnvelope,
} from "./message_crypto";
import { loadSignature, loadSignatureHtml, saveSignature, saveSignatureHtml, applySignature, applySignatureHtml, formatQuotedHtml } from "./signature";
import { PendingSend, buildPendingSendPayload, restoreComposeState } from "./undo_send";
import { parseMime, getHeader } from "./mime";
import { SetupAccount } from "./routes/setup-account";
import { SettingsLayout, SettingsTabId } from "./routes/settings/SettingsLayout";
import { AccountTab } from "./routes/settings/AccountTab";
import { SignaturesTab } from "./routes/settings/SignaturesTab";
import { BridgeTab } from "./routes/settings/BridgeTab";
import { AppearanceTab } from "./routes/settings/AppearanceTab";
import { AutoReplyTab } from "./routes/settings/AutoReplyTab";
import { SecurityTab } from "./routes/settings/SecurityTab";
import { FiltersTab } from "./routes/settings/FiltersTab";
import { MaskedEmailTab } from "./routes/settings/MaskedEmailTab";
import { ComposeDrawer } from "./components/ComposeDrawer";
import { StorageStatusPill } from "./components/StorageStatusPill";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { ReadingPane } from "./components/ReadingPane";
import {
  savePersistentSession,
  restorePersistentSession,
  clearPersistentSession,
} from "./persistent_session";
import { SelectionFilter, SortOrder } from "./components/InboxToolbar";
import { AddMailboxModal } from "./components/AddMailboxModal";
import { CreateLabelModal } from "./components/modals/CreateLabelModal";
import { ChangeParentModal } from "./components/modals/ChangeParentModal";
import { CreateFolderModal } from "./components/modals/CreateFolderModal";
import { ImportEmailsModal } from "./components/modals/ImportEmailsModal";
import { ContactsModal } from "./components/modals/ContactsModal";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ShortcutHandler, isTextInputElement, matchShortcut } from "./keyboard_shortcuts";
import { formatMessageDate } from "./utils/dateTime";
import { formatSnoozeTime } from "./snooze";
import { getSubtreeLabelIds } from "./utils/nested_labels";
import { GlobalErrorBanner } from "./components/GlobalErrorBanner";
import { setGlobalError } from "./errors";
import {
  FocusedCategory,
  getFocusedInboxEnabled,
  resolveMessageCategory,
  setMessageCategoryOverride,
  parseRawHeaders,
  extractSenderEmail,
} from "./focused_inbox";
import {
  mergeUnifiedMessages,
  filterUnifiedMessages,
  getReplyFromAddress,
  getTargetAccountForAction,
  deduplicateSearchResults,
  getMailboxKeyForMessage,
} from "./unified_inbox";
import {
  rotateSessionGeneration,
  clearAllSensitiveSessionKeys,
  clearAccountKeys,
  persistAccountListForDisplay,
  readSessionGeneration,
  SESSION_GENERATION_KEY,
  formatSessionExpiredError,
  validateRestoredAccount,
  removeStaleAccount,
  getSigningSeedFor,
  getMailboxKeyFor,
  getXWingSeedFor,
  unsealAccountKeys,
} from "./session_isolation";
import { OfflineBanner } from "./components/OfflineBanner";
import { sanitizeOnSend } from "./composer_sanitizer";
import {
  initNetworkListeners,
  onNetworkReconnect,
  isOffline,
  registerServiceWorker,
  clearServiceWorkerCaches,
} from "./offline";
import {
  cacheInboxMessages,
  getCachedInbox,
  getCachedMessageBody,
  saveCachedMessageBody,
  clearOfflineCache,
  saveOfflineDraft,
  getOfflineDrafts,
  removeOfflineDraft,
} from "./offline_cache";
import { enqueueSend, replayQueue } from "./send_queue";

type Folder = "inbox" | "sent" | "scheduled" | "drafts" | "snoozed" | "archive" | "spam" | "trash" | "unified_inbox";

interface DisplayMessage {
  id: string;
  messageSeq?: number;
  version?: number;
  folder: Folder;
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
  messageId?: string; // For attachment filtering
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

export function buildMimeString(params: {
  to: string;
  subject: string;
  signedBody: string;
  htmlBody: string;
  trackingToken?: string;
  body?: string;
  from?: string;
  replyTo?: string;
}): string {
  const { to, subject, signedBody, htmlBody, trackingToken, body, from, replyTo } = params;
  const trackingPixelHtml = trackingToken
    ? `<img src="${getTrackingPixelUrl(trackingToken)}" alt="" width="1" height="1" style="display:none !important; width:1px; height:1px; border:0;" />`
    : "";

  const extraHeaders: string[] = [];
  if (from) extraHeaders.push(`From: ${from}`);
  if (replyTo) extraHeaders.push(`Reply-To: ${replyTo}`);

  const isHtml = body !== undefined ? htmlBody !== body : htmlBody !== signedBody;
  if (htmlBody && htmlBody.trim() && isHtml) {
    const fullHtml = trackingPixelHtml ? `${htmlBody}\r\n${trackingPixelHtml}` : htmlBody;
    const boundary = "----=_Part_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    return [
      ...extraHeaders,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      signedBody,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      fullHtml,
      `--${boundary}--`,
    ].join("\r\n");
  } else if (trackingPixelHtml) {
    const boundary = "----=_Part_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const autoHtml = `<div style="font-family: sans-serif; font-size: 14px; color: #1a1a1a; white-space: pre-wrap;">${signedBody}</div>\r\n${trackingPixelHtml}`;
    return [
      ...extraHeaders,
      `To: ${to}`,
      `Subject: ${subject}`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      signedBody,
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      autoHtml,
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    return [
      ...extraHeaders,
      `To: ${to}`,
      `Subject: ${subject}`,
      "Content-Type: text/plain; charset=utf-8",
      "MIME-Version: 1.0",
      "",
      signedBody,
    ].join("\r\n");
  }
}

export type PathAResult =
  | { kind: "sent"; messageId: string }
  | { kind: "failed"; error: string }
  | { kind: "fallback" };

export interface PathADeps {
  lookupMailboxKeys?: (email: string) => Promise<KeyDirectoryRecord>;
  sendInternal?: (req: InternalSendRequest) => Promise<InternalSendResponse>;
  sealSignedEnvelope?: (
    recipientXwingPkHex: string,
    keyId: string,
    keyEpoch: number,
    plaintextHex: string,
    senderSigningSeedHex: string,
  ) => Promise<string> | string;
}

export async function tryPathASend(
  params: {
    recipient: string;
    senderMailboxId: string;
    mimeMessage: string;
    signingSeed: Uint8Array;
    senderXwingSeed?: Uint8Array;
    attachmentEnvelopes?: AttachmentEnvelope[];
    senderAttachmentEnvelopes?: AttachmentEnvelope[];
    token?: string;
  },
  deps?: PathADeps,
): Promise<PathAResult> {
  const { recipient, senderMailboxId, mimeMessage, signingSeed, senderXwingSeed, attachmentEnvelopes, senderAttachmentEnvelopes, token } = params;
  const lookupFn = deps?.lookupMailboxKeys ?? lookupMailboxKeys;
  const sendFn = deps?.sendInternal ?? ((req: InternalSendRequest) => sendInternal(req, token));

  // 1. Look up recipient keys
  let record: KeyDirectoryRecord;
  try {
    record = await lookupFn(recipient);
  } catch {
    // 404 (external) or network error → silent fallback
    return { kind: "fallback" };
  }

  // 2. Validate the record
  if (
    !record ||
    record.status !== "active" ||
    !record.xwing_public_key ||
    !record.key_id ||
    !record.key_epoch
  ) {
    // BYOS user without X-Wing keys published yet → fallback to Path B
    console.warn("Recipient has no usable X-Wing key; using Path B");
    return { kind: "fallback" };
  }

  // 3. Convert base64 xwing_public_key → hex
  let xwingPkHex: string;
  try {
    const bytes = base64ToBytes(record.xwing_public_key);
    if (bytes.length !== 1216) {
      console.warn("Recipient X-Wing key has wrong length; using Path B");
      return { kind: "fallback" };
    }
    xwingPkHex = bytesToHex(bytes);
  } catch {
    return { kind: "fallback" };
  }

  // 4. Assemble signed envelopes
  let envelopeJson: string;
  let senderEnvelopeJson: string | undefined;
  try {
    const plaintextHex = bytesToHex(new TextEncoder().encode(mimeMessage));
    const signingSeedHex = bytesToHex(signingSeed);
    if (deps?.sealSignedEnvelope) {
      envelopeJson = await deps.sealSignedEnvelope(
        xwingPkHex,
        record.key_id,
        record.key_epoch,
        plaintextHex,
        signingSeedHex,
      );
      if (senderXwingSeed) {
        senderEnvelopeJson = await deps.sealSignedEnvelope(
          "mock-sender-xwing-pk",
          senderMailboxId,
          1,
          plaintextHex,
          signingSeedHex,
        );
      }
    } else {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      // Canonical form is AAD || ciphertext (raw bytes). Attachment envelopes are excluded from message envelope signature.
      envelopeJson = wasm.wasm_seal_xwing_envelope_signed(
        xwingPkHex,
        record.key_id,
        record.key_epoch,
        plaintextHex,
        signingSeedHex,
      );
      if (senderXwingSeed) {
        const senderXwingPkHex = wasm.wasm_xwing_public_key_from_seed(
          bytesToHex(senderXwingSeed),
        );
        senderEnvelopeJson = wasm.wasm_seal_xwing_envelope_signed(
          senderXwingPkHex,
          senderMailboxId,
          1, // TODO: use sender's real key_epoch when rotation is implemented
          plaintextHex,
          signingSeedHex,
        );
      }
    }
  } catch (e: unknown) {
    // Local crypto failure — treat as a real failure, not a fallback.
    const errMsg = e instanceof Error ? e.message : (typeof e === "string" ? e : JSON.stringify(e) || String(e));
    return {
      kind: "failed",
      error: `Local encryption failed: ${errMsg}`,
    };
  }

  // 5. Submit to server. No fallback after this point.
  try {
    const resp = await sendFn({
      envelope_json: envelopeJson,
      sender_envelope_json: senderEnvelopeJson,
      recipient,
      sender_mailbox_id: senderMailboxId,
      attachment_envelopes: attachmentEnvelopes,
      sender_attachment_envelopes: senderAttachmentEnvelopes,
    });
    return { kind: "sent", messageId: resp.message_id };
  } catch (e) {
    return {
      kind: "failed",
      error: e instanceof Error ? e.message : "internal delivery failed",
    };
  }
}

const App: Component = () => {
  const [isMobile, setIsMobile] = createSignal(typeof window !== "undefined" ? window.innerWidth < 768 : false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);

  onMount(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
    });
  });

  createEffect(() => {
    if (mobileSidebarOpen()) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setMobileSidebarOpen(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
    }
  });

  const [currentUser, setCurrentUser] = createSignal<UserMe | null>(null);
  const [mailboxes, setMailboxes] = createSignal<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = createSignal<Mailbox | null>(null);
  const [currentFolder, setCurrentFolder] = createSignal<Folder>("inbox");
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
  createEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_view_mode", viewMode());
      sessionStorage.setItem("byos_view_mode", viewMode());
    }
  });
  const [focusedCategory, setFocusedCategory] = createSignal<FocusedCategory>("primary");
  const [focusedInboxEnabled, setFocusedInboxEnabledState] = createSignal<boolean>(getFocusedInboxEnabled());
  onMount(() => {
    if (typeof window === "undefined") return;
    const handleFocusedInboxChange = (e: any) => {
      if (e?.detail && typeof e.detail.enabled === "boolean") {
        setFocusedInboxEnabledState(e.detail.enabled);
      } else {
        setFocusedInboxEnabledState(getFocusedInboxEnabled());
      }
    };
    window.addEventListener("byos_focused_inbox_changed", handleFocusedInboxChange);
    window.addEventListener("storage", handleFocusedInboxChange);
    onCleanup(() => {
      window.removeEventListener("byos_focused_inbox_changed", handleFocusedInboxChange);
      window.removeEventListener("storage", handleFocusedInboxChange);
    });
  });
  const [searchQuery, setSearchQuery] = createSignal("");
  const [composeOpen, setComposeOpen] = createSignal(false);
  const [composeAccountId, setComposeAccountId] = createSignal<string | null>(null);
  const [composeFromAlias, setComposeFromAlias] = createSignal<string | null>(null);
  const [maskedAliases, setMaskedAliases] = createSignal<MaskedAliasItem[]>([]);
  const refreshMaskedAliases = async () => {
    try {
      const res = await fetchMaskedAliases();
      setMaskedAliases(res.aliases || []);
    } catch {
      // ignore
    }
  };
  const [accountUnreadCounts, setAccountUnreadCounts] = createSignal<Record<string, number>>({});
  const [excludedAccountIds, setExcludedAccountIds] = createSignal<string[]>(
    (() => {
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem("byos_unified_inbox_excluded") : null;
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    })()
  );
  createEffect(() => {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("byos_unified_inbox_excluded", JSON.stringify(excludedAccountIds()));
      }
    } catch {}
  });
  const handleToggleAccountInclusion = (id: string) => {
    setExcludedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const unifiedUnreadCount = () => {
    const counts = accountUnreadCounts();
    const excluded = new Set(excludedAccountIds());
    let total = 0;
    for (const [id, count] of Object.entries(counts)) {
      if (!excluded.has(id)) {
        total += count;
      }
    }
    return total;
  };
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = createSignal(false);
  const [isDecrypting, setIsDecrypting] = createSignal(false);
  const [decryptedContent, setDecryptedContent] = createSignal<string | null>(null);
  // Plaintext available for editing. Set ONLY on successful decrypt — the
  // Edit action must never load a locked/error placeholder into compose.
  const [editablePlaintext, setEditablePlaintext] = createSignal<string | null>(null);
  // Message plaintext for reply/forward quoting. Same discipline: success-only.
  const [messagePlaintext, setMessagePlaintext] = createSignal<string | null>(null);
  const [senderVerification, setSenderVerification] = createSignal<{
    verified: boolean;
    error?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = createSignal(true);
  const [messageAttachments, setMessageAttachments] = createSignal<AttachmentItem[]>([]);
  const [downloadingAttachment, setDownloadingAttachment] = createSignal<string | null>(null);

  // Setup Account & Impersonation state
  const [isSetupAccount, setIsSetupAccount] = createSignal(false);
  const [isImpersonating, setIsImpersonating] = createSignal(false);
  const [impersonateMailboxId, setImpersonateMailboxId] = createSignal<string | null>(null);
  const [impersonateEmail, setImpersonateEmail] = createSignal<string | null>(null);

  // Mailbox key custody: in-memory only, derived per unlock from the recovery
  // phrase. Cleared on mailbox switch and lock. Never persisted or logged.
  const [mailboxKey, setMailboxKey] = createSignal<Uint8Array | null>(null);
  const [signingSeed, setSigningSeed] = createSignal<Uint8Array | null>(null);
  const [xwingSeed, setXwingSeed] = createSignal<Uint8Array | null>(null);
  const [searchKey, setSearchKey] = createSignal<string | null>(null);
  const [serverMatchedMsgIds, setServerMatchedMsgIds] = createSignal<string[]>([]);
  const [isSearchingTokens, setIsSearchingTokens] = createSignal(false);
  const [unlockedBoxId, setUnlockedBoxId] = createSignal<string | null>(null);
  const [storageErrorBanner, setStorageErrorBanner] = createSignal<string | null>(null);
  const [lockedReadingAccount, setLockedReadingAccount] = createSignal<{ mailboxId: string; email: string } | null>(null);
  const [unlockAccountTarget, setUnlockAccountTarget] = createSignal<{ mailboxId: string; email: string } | null>(null);
  const [unlockAccountPassword, setUnlockAccountPassword] = createSignal("");
  const [unlockAccountError, setUnlockAccountError] = createSignal<string | null>(null);
  const [unlockAccountBusy, setUnlockAccountBusy] = createSignal(false);
  const [pendingSwitchAccount, setPendingSwitchAccount] = createSignal<ConnectedAccount | null>(null);

  // Per-mailbox signature draft (device-local; see signature.ts).
  const [signatureText, setSignatureText] = createSignal("");
  const [signatureSaved, setSignatureSaved] = createSignal(false);

  function refreshSignature(boxId: string | null) {
    setSignatureText(boxId ? loadSignature(boxId) : "");
    setSignatureSaved(false);
  }

  function handleSaveSignature() {
    const box = selectedMailbox();
    if (!box) return;
    saveSignature(box.id, signatureText());
    setSignatureText(loadSignature(box.id));
    setSignatureSaved(true);
    setTimeout(() => setSignatureSaved(false), 2000);
  }

  // Compose Form signals
  const [composeTo, setComposeTo] = createSignal("");
  const [composeSubject, setComposeSubject] = createSignal("");
  const [composeBody, setComposeBody] = createSignal("");
  const [composeBodyHtml, setComposeBodyHtml] = createSignal("");
  const [composeSignatureApplied, setComposeSignatureApplied] =
    createSignal<boolean>(false);
  const [scheduledTime, setScheduledTime] = createSignal("");
  const [composeTrackOpens, setComposeTrackOpens] = createSignal(false);
  const [composeStatus, setComposeStatus] = createSignal<string | null>(null);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [composeAttachments, setComposeAttachments] = createSignal<AttachmentItem[]>([]);
  // When set, saving updates this draft (optimistic version) instead of creating.
  const [editingDraft, setEditingDraft] = createSignal<{ id: string; version: number } | null>(null);
  // When set, user is editing a pending scheduled message non-destructively.
  const [editingScheduledId, setEditingScheduledId] = createSignal<string | null>(null);
  const [pendingSend, setPendingSend] = createSignal<PendingSend | null>(null);

  // Settings suite & Layout preferences
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<SettingsTabId>("account");
  const [profilePhotoUrl, setProfilePhotoUrl] = createSignal<string | null>(null);

  async function loadDecryptedProfilePhoto(
    key?: Uint8Array | null,
    sessionToken?: string
  ) {
    const k = key || mailboxKey();
    if (!k) return;
    try {
      const ciphertext = await getProfilePhoto(sessionToken);
      const decrypted = await decryptChunk(ciphertext, k);
      const blob = new Blob([decrypted as unknown as BlobPart], { type: "image/jpeg" });
      const objectUrl = URL.createObjectURL(blob);
      if (profilePhotoUrl() && profilePhotoUrl() !== objectUrl) {
        URL.revokeObjectURL(profilePhotoUrl()!);
      }
      setProfilePhotoUrl(objectUrl);
    } catch {
      // Photo not found (404) or decrypt error: no photo set
    }
  }

  const [density, setDensity] = createSignal<"compact" | "cozy" | "comfortable">(
    (typeof window !== "undefined" && (localStorage.getItem("byos_density") as any)) || "cozy"
  );
  const [layoutMode, setLayoutMode] = createSignal<"split" | "full">(
    (typeof window !== "undefined" && (localStorage.getItem("byos_layout") as any)) || "split"
  );
  const [theme, setTheme] = createSignal<"cloud_dancer" | "dark">(
    (typeof window !== "undefined" && (localStorage.getItem("byos_theme") as any)) || "cloud_dancer"
  );
  const [language, setLanguage] = createSignal<string>(
    (typeof window !== "undefined" && localStorage.getItem("byos_language")) || "en"
  );
  const [timeFormat, setTimeFormat] = createSignal<"12h" | "24h">(
    (typeof window !== "undefined" && (localStorage.getItem("byos_time_format") as "12h" | "24h")) || "12h"
  );
  const [weekStart, setWeekStart] = createSignal<"sunday" | "monday" | "saturday">(
    (typeof window !== "undefined" && (localStorage.getItem("byos_week_start") as any)) || "sunday"
  );

  function handleSetTheme(newTheme: "cloud_dancer" | "dark", persistToBackend = true) {
    setTheme(newTheme);
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_theme", newTheme);
      document.documentElement.dataset.theme = newTheme;
      if (newTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
    if (persistToBackend) {
      const box = selectedMailbox();
      if (box) {
        updateMailboxSettings(box.id, { theme: newTheme }).catch((err: any) =>
          console.warn("Failed to update mailbox theme in backend:", err)
        );
      }
    }
  }

  function handleSetDensity(newDensity: "compact" | "cozy" | "comfortable", persistToBackend = false) {
    setDensity(newDensity);
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_density", newDensity);
    }
    if (persistToBackend) {
      const box = selectedMailbox();
      if (box) {
        updateMailboxSettings(box.id, { density: newDensity }).catch((err: any) =>
          console.warn("Failed to update mailbox density in backend:", err)
        );
      }
    }
  }

  function handleSetLayoutMode(newLayout: "split" | "full", persistToBackend = false) {
    setLayoutMode(newLayout);
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_layout", newLayout);
    }
    if (persistToBackend) {
      const box = selectedMailbox();
      if (box) {
        updateMailboxSettings(box.id, { layout_mode: newLayout }).catch((err: any) =>
          console.warn("Failed to update mailbox layout in backend:", err)
        );
      }
    }
  }

  createEffect(() => {
    const currentTheme = theme();
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_theme", currentTheme);
      document.documentElement.dataset.theme = currentTheme;
      if (currentTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  });

  createEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_density", density());
    }
  });

  createEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("byos_layout", layoutMode());
    }
  });

  // Selection, Sorting, and Pagination state
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = createSignal<SortOrder>("newest");
  const [currentPage, setCurrentPage] = createSignal(1);
  const pageSize = 50;

  // Optimistic updates & Undo toast state
  const [undoAction, setUndoAction] = createSignal<{
    messageId: string;
    previousFolder: Folder;
    timer: any;
  } | null>(null);

  function handleToggleThreadCheck(threadId: string, checked: boolean) {
    const thread = threads().find((t) => t.thread_id === threadId);
    if (!thread || !thread.message_ids) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of thread.message_ids) {
        if (checked) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }
      return next;
    });
  }

  function toggleMessageStarred(msg: DisplayMessage) {
    const origStarred = msg.starred;
    const newStarred = !origStarred;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, starred: newStarred } : m))
    );
    setThreads((prev) =>
      prev.map((t) =>
        t.message_ids?.includes(msg.id)
          ? { ...t, is_starred: newStarred }
          : t
      )
    );
    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg({ ...selectedMsg()!, starred: newStarred });
    }

    const target = getTargetAccountForAction(msg, selectedMailbox()?.id || "", connectedAccounts());
    if (target.mailboxId && msg.isRealApi) {
      toggleMessageStar(target.mailboxId, msg.id, newStarred, target.token)
        .then((res) => {
          if (res.is_starred !== newStarred) {
            setMessages((prev) =>
              prev.map((m) => (m.id === msg.id ? { ...m, starred: res.is_starred } : m))
            );
            setThreads((prev) =>
              prev.map((t) =>
                t.message_ids?.includes(msg.id)
                  ? { ...t, is_starred: res.is_starred }
                  : t
              )
            );
            if (selectedMsg()?.id === msg.id) {
              setSelectedMsg({ ...selectedMsg()!, starred: res.is_starred });
            }
          }
        })
        .catch((err) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, starred: origStarred } : m))
          );
          setThreads((prev) =>
            prev.map((t) =>
              t.message_ids?.includes(msg.id)
                ? { ...t, is_starred: origStarred }
                : t
            )
          );
          if (selectedMsg()?.id === msg.id) {
            setSelectedMsg({ ...selectedMsg()!, starred: origStarred });
          }
          showToast(`Failed to update star: ${err instanceof Error ? err.message : "unknown error"}`);
        });
    }
  }

  function toggleMessageRead(msg: DisplayMessage) {
    const origRead = msg.read;
    const newRead = !origRead;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, read: newRead } : m))
    );
    setThreads((prev) =>
      prev.map((t) => {
        if (t.message_ids?.includes(msg.id)) {
          const delta = newRead ? -1 : 1;
          return { ...t, unread_count: Math.max(0, t.unread_count + delta) };
        }
        return t;
      })
    );
    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg({ ...selectedMsg()!, read: newRead });
    }
    const target = getTargetAccountForAction(msg, selectedMailbox()?.id || "", connectedAccounts());
    if (target.mailboxId) {
      setMessageRead(target.mailboxId, msg.id, newRead, target.token).catch((err) => {
        console.error("Failed to persist read state:", err);
      });
    }
  }

  function handleArchiveMessage(msg: DisplayMessage) {
    const origFolder = msg.folder;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, folder: "archive" as Folder } : m))
    );
    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg(null);
    }
    if (undoAction()?.timer) clearTimeout(undoAction()!.timer);
    const timer = setTimeout(() => setUndoAction(null), 5000);
    setUndoAction({ messageId: msg.id, previousFolder: origFolder, timer });
  }

  function handleSnoozeMessage(msg: DisplayMessage, until: Date) {
    const target = getTargetAccountForAction(msg, selectedMailbox()?.id || "", connectedAccounts());
    if (!target.mailboxId) return;

    const untilISO = until.toISOString();
    const prevSnooze = msg.snoozedUntil;

    // Optimistically update message and thread
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id ? { ...m, snoozedUntil: untilISO, read: false } : m
      )
    );
    setThreads((prev) =>
      prev.map((t) =>
        t.message_ids?.includes(msg.id)
          ? { ...t, snoozed_until: untilISO }
          : t
      )
    );

    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg(null);
    }

    snoozeMessage(target.mailboxId, msg.id, untilISO, target.token)
      .then(async () => {
        try {
          const updated = await fetchThreads(target.mailboxId, undefined, target.token);
          setThreads(updated);
        } catch {}
        const timeLabel = formatSnoozeTime(until);
        const toastId = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
        addToast({
          id: toastId,
          message: `Snoozed until ${timeLabel}.`,
          duration: 6000,
          action: {
            label: "Undo",
            onClick: () => {
              removeToast(toastId);
              snoozeMessage(target.mailboxId, msg.id, null, target.token)
                .then(async () => {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === msg.id ? { ...m, snoozedUntil: prevSnooze, read: false } : m
                    )
                  );
                  try {
                    const updated = await fetchThreads(target.mailboxId, undefined, target.token);
                    setThreads(updated);
                  } catch {}
                  showToast("Snooze cancelled.");
                })
                .catch((err) => {
                  showToast(`Failed to undo snooze: ${err instanceof Error ? err.message : "unknown error"}`);
                });
            },
          },
        });
      })
      .catch((err) => {
        // Rollback
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msg.id ? { ...m, snoozedUntil: prevSnooze } : m
          )
        );
        setThreads((prev) =>
          prev.map((t) =>
            t.message_ids?.includes(msg.id)
              ? { ...t, snoozed_until: prevSnooze }
              : t
          )
        );
        showToast(`Failed to snooze: ${err instanceof Error ? err.message : "unknown error"}`);
      });
  }

  function handleTrashMessage(msg: DisplayMessage) {
    const origFolder = msg.folder;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, folder: "trash" as Folder } : m))
    );
    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg(null);
    }
    if (undoAction()?.timer) clearTimeout(undoAction()!.timer);
    const timer = setTimeout(() => setUndoAction(null), 5000);
    setUndoAction({ messageId: msg.id, previousFolder: origFolder, timer });
  }

  function handleDeleteForever(msg: DisplayMessage) {
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg(null);
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(msg.id);
      return next;
    });
    showToast("Message permanently deleted");
  }

  function handleUndo() {
    const action = undoAction();
    if (!action) return;
    clearTimeout(action.timer);
    setMessages((prev) =>
      prev.map((m) =>
        m.id === action.messageId ? { ...m, folder: action.previousFolder } : m
      )
    );
    setUndoAction(null);
  }

  // Batch actions with immutable signal updates
  function handleToggleCheck(msg: DisplayMessage, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(msg.id);
      } else {
        next.delete(msg.id);
      }
      return next;
    });
  }

  function handleSelectFilter(filter: SelectionFilter) {
    const visible = paginatedMessages();
    if (filter === "none") {
      setSelectedIds(new Set<string>());
    } else if (filter === "all") {
      setSelectedIds(new Set(visible.map((m) => m.id)));
    } else if (filter === "read") {
      setSelectedIds(new Set(visible.filter((m) => m.read).map((m) => m.id)));
    } else if (filter === "unread") {
      setSelectedIds(new Set(visible.filter((m) => !m.read).map((m) => m.id)));
    } else if (filter === "starred") {
      setSelectedIds(new Set(visible.filter((m) => m.starred).map((m) => m.id)));
    } else if (filter === "unstarred") {
      setSelectedIds(new Set(visible.filter((m) => !m.starred).map((m) => m.id)));
    }
  }

  function handleBatchArchive() {
    const ids = selectedIds();
    if (ids.size === 0) return;
    const count = ids.size;
    setMessages((prev) =>
      prev.map((m) => (ids.has(m.id) ? { ...m, folder: "archive" as Folder } : m))
    );
    if (selectedMsg() && ids.has(selectedMsg()!.id)) {
      setSelectedMsg(null);
    }
    showToast(`Archived ${count} ${count === 1 ? "conversation" : "conversations"}`);
    setSelectedIds(new Set<string>());
  }

  function handleBatchSpam() {
    const ids = selectedIds();
    if (ids.size === 0) return;
    const count = ids.size;
    setMessages((prev) =>
      prev.map((m) => (ids.has(m.id) ? { ...m, folder: "spam" as Folder } : m))
    );
    if (selectedMsg() && ids.has(selectedMsg()!.id)) {
      setSelectedMsg(null);
    }
    showToast(`Moved ${count} ${count === 1 ? "conversation" : "conversations"} to Spam`);
    setSelectedIds(new Set<string>());
  }

  function handleBatchTrash() {
    const ids = selectedIds();
    if (ids.size === 0) return;
    const count = ids.size;
    setMessages((prev) =>
      prev.map((m) => (ids.has(m.id) ? { ...m, folder: "trash" as Folder } : m))
    );
    if (selectedMsg() && ids.has(selectedMsg()!.id)) {
      setSelectedMsg(null);
    }
    showToast(`Moved ${count} ${count === 1 ? "conversation" : "conversations"} to Trash`);
    setSelectedIds(new Set<string>());
  }

  function handleBatchDeleteForever() {
    const ids = selectedIds();
    if (ids.size === 0) return;
    const count = ids.size;
    setMessages((prev) => prev.filter((m) => !ids.has(m.id)));
    if (selectedMsg() && ids.has(selectedMsg()!.id)) {
      setSelectedMsg(null);
    }
    setSelectedIds(new Set<string>());
    showToast(`Permanently deleted ${count} ${count === 1 ? "conversation" : "conversations"}`);
  }

  function handleEmptyTrash() {
    const trashCount = messages().filter((m) => m.folder === "trash").length;
    if (trashCount === 0) return;
    if (!confirm(`Are you sure you want to empty the bin? This will permanently delete ${trashCount} message(s).`)) {
      return;
    }
    setMessages((prev) => prev.filter((m) => m.folder !== "trash"));
    if (selectedMsg()?.folder === "trash") {
      setSelectedMsg(null);
    }
    setSelectedIds(new Set<string>());
    showToast("Bin emptied successfully");
  }

  function handleBatchToggleRead(read: boolean) {
    const ids = selectedIds();
    if (ids.size === 0) return;
    const count = ids.size;
    setMessages((prev) =>
      prev.map((m) => (ids.has(m.id) ? { ...m, read } : m))
    );
    if (selectedMsg() && ids.has(selectedMsg()!.id)) {
      setSelectedMsg({ ...selectedMsg()!, read });
    }
    showToast(`Marked ${count} as ${read ? "read" : "unread"}`);
    setSelectedIds(new Set<string>());
    const box = selectedMailbox();
    if (box) {
      Array.from(ids).forEach((id) => {
        setMessageRead(box.id, id, read).catch((err) => {
          console.error("Failed to persist read state:", err);
        });
      });
    }
  }

  function handleBatchToggleStarred(starred: boolean) {
    const ids = selectedIds();
    if (ids.size === 0) return;
    const count = ids.size;
    setMessages((prev) =>
      prev.map((m) => (ids.has(m.id) ? { ...m, starred } : m))
    );
    if (selectedMsg() && ids.has(selectedMsg()!.id)) {
      setSelectedMsg({ ...selectedMsg()!, starred });
    }
    showToast(starred ? `Starred ${count}` : `Unstarred ${count}`);
    setSelectedIds(new Set<string>());
  }

  function handleMoveMessages(messageIds: string[], targetFolder: string) {
    if (!messageIds.length) return;
    const idSet = new Set(messageIds);
    const count = messageIds.length;

    const customFolder = customFolders().find((cf) => cf.id === targetFolder);
    const newFolder: Folder = customFolder ? "inbox" : (targetFolder as Folder);
    const newFolderId = customFolder ? customFolder.id : null;

    setMessages((prev) =>
      prev.map((m) =>
        idSet.has(m.id)
          ? { ...m, folder: newFolder, folderId: newFolderId }
          : m
      )
    );
    if (selectedMsg() && idSet.has(selectedMsg()!.id)) {
      setSelectedMsg(null);
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      messageIds.forEach((id) => next.delete(id));
      return next;
    });

    const backendFolder = customFolder ? "custom" : targetFolder;
    messageIds.forEach((id) => {
      const msg = messages().find((m) => m.id === id);
      const target = getTargetAccountForAction(msg || {}, selectedMailbox()?.id || "", connectedAccounts());
      if (target.mailboxId) {
        updateMessageFolder(target.mailboxId, id, backendFolder, newFolderId, target.token).catch((err) => {
          console.error("Failed to update message folder:", err);
        });
      }
    });

    const folderName = customFolder ? customFolder.name : targetFolder;
    showToast(`Moved ${count} ${count === 1 ? "conversation" : "conversations"} to ${folderName}`);
  }

  function handleAttachLabel(messageIds: string[], labelId: string) {
    if (!messageIds.length) return;
    const label = labels().find((l) => l.id === labelId);
    const labelName = label ? label.name : "Label";
    const idSet = new Set(messageIds);

    // Optimistically attach label to messages
    setMessages((prev) =>
      prev.map((m) => {
        if (!idSet.has(m.id)) return m;
        const currentLabelIds = m.labelIds || [];
        if (currentLabelIds.includes(labelId)) return m;
        return { ...m, labelIds: [...currentLabelIds, labelId] };
      })
    );

    if (selectedMsg() && idSet.has(selectedMsg()!.id)) {
      setSelectedMsg((prev) => {
        if (!prev) return null;
        const currentLabelIds = prev.labelIds || [];
        if (currentLabelIds.includes(labelId)) return prev;
        return { ...prev, labelIds: [...currentLabelIds, labelId] };
      });
    }

    const box = selectedMailbox();
    if (box) {
      messageIds.forEach((id) => {
        attachMessageLabel(box.id, id, labelId).catch((err) => {
          console.error("Failed to attach message label:", err);
        });
      });
    }

    showToast(
      `Applied label "${labelName}" to ${messageIds.length} ${
        messageIds.length === 1 ? "conversation" : "conversations"
      }`
    );
  }

  function toggleMessageLabel(messageIds: string[], labelId: string) {
    if (!messageIds.length) return;
    const label = labels().find((l) => l.id === labelId);
    const labelName = label ? label.name : "Label";
    const idSet = new Set(messageIds);

    const targetMsgs = messages().filter((m) => idSet.has(m.id));
    const allHaveLabel = targetMsgs.length > 0 && targetMsgs.every((m) => m.labelIds?.includes(labelId));

    if (allHaveLabel) {
      setMessages((prev) =>
        prev.map((m) => {
          if (!idSet.has(m.id)) return m;
          const currentLabelIds = m.labelIds || [];
          return { ...m, labelIds: currentLabelIds.filter((id) => id !== labelId) };
        })
      );
      if (selectedMsg() && idSet.has(selectedMsg()!.id)) {
        setSelectedMsg((prev) =>
          prev ? { ...prev, labelIds: (prev.labelIds || []).filter((id) => id !== labelId) } : null
        );
      }

      const box = selectedMailbox();
      if (box) {
        messageIds.forEach((id) => {
          detachMessageLabel(box.id, id, labelId).catch((err) => {
            console.error("Failed to detach message label:", err);
          });
        });
      }
      showToast(`Removed label "${labelName}"`);
    } else {
      setMessages((prev) =>
        prev.map((m) => {
          if (!idSet.has(m.id)) return m;
          const currentLabelIds = m.labelIds || [];
          if (currentLabelIds.includes(labelId)) return m;
          return { ...m, labelIds: [...currentLabelIds, labelId] };
        })
      );
      if (selectedMsg() && idSet.has(selectedMsg()!.id)) {
        setSelectedMsg((prev) => {
          if (!prev) return null;
          const currentLabelIds = prev.labelIds || [];
          if (currentLabelIds.includes(labelId)) return prev;
          return { ...prev, labelIds: [...currentLabelIds, labelId] };
        });
      }

      const box = selectedMailbox();
      if (box) {
        messageIds.forEach((id) => {
          attachMessageLabel(box.id, id, labelId).catch((err) => {
            console.error("Failed to attach message label:", err);
          });
        });
      }
      showToast(`Applied label "${labelName}"`);
    }
  }

  function handleBatchToggleLabel(labelId: string) {
    const ids = Array.from(selectedIds());
    if (ids.length > 0) {
      toggleMessageLabel(ids, labelId);
    } else if (selectedMsg()) {
      toggleMessageLabel([selectedMsg()!.id], labelId);
    }
  }

  function handleBatchMoveTo(targetFolder: string) {
    const ids = Array.from(selectedIds());
    if (ids.length === 0) return;
    handleMoveMessages(ids, targetFolder);
  }

  // Login form state. The password lives in a signal only while typing and is
  // cleared on every submit attempt, success or failure.
  const [loginEmail, setLoginEmail] = createSignal("");
  const [loginPassword, setLoginPassword] = createSignal("");
  const [loginBusy, setLoginBusy] = createSignal(false);
  const [loginError, setLoginError] = createSignal<string | null>(null);
  const [useRecoveryPhrase, setUseRecoveryPhrase] = createSignal(false);
  const [recoveryPhraseInput, setRecoveryPhraseInput] = createSignal("");
  const [rememberDevice, setRememberDevice] = createSignal(false);

  // 2FA Challenge at Login
  const [twoFactorChallenge, setTwoFactorChallenge] = createSignal<{
    challenge_token: string;
    methods: string[];
    preferred_method: string;
    destination_masked: string;
  } | null>(null);
  const [twoFactorCodeInput, setTwoFactorCodeInput] = createSignal("");
  const [cachedPassword, setCachedPassword] = createSignal("");
  const [twoFactorBusy, setTwoFactorBusy] = createSignal(false);
  const [twoFactorError, setTwoFactorError] = createSignal<string | null>(null);
  const [selected2FAMethod, setSelected2FAMethod] = createSignal<string>("totp");

  // Forgot Password / Account Recovery state
  const [forgotPasswordModalOpen, setForgotPasswordModalOpen] = createSignal(false);
  const [forgotStep, setForgotStep] = createSignal<1 | 2 | 3>(1);
  const [forgotEmail, setForgotEmail] = createSignal("");
  const [forgotMethods, setForgotMethods] = createSignal<RecoveryOptionItem[]>([]);
  const [forgotSelectedMethod, setForgotSelectedMethod] = createSignal<string>("email");
  const [forgotChallengeToken, setForgotChallengeToken] = createSignal("");
  const [forgotDestinationMasked, setForgotDestinationMasked] = createSignal("");
  const [forgotCode, setForgotCode] = createSignal("");
  const [forgotNewPassword, setForgotNewPassword] = createSignal("");
  const [forgotConfirmPassword, setForgotConfirmPassword] = createSignal("");
  const [forgotBusy, setForgotBusy] = createSignal(false);
  const [forgotError, setForgotError] = createSignal<string | null>(null);
  const [forgotMailboxId, setForgotMailboxId] = createSignal("");
  const [forgotOldWrappedSk, setForgotOldWrappedSk] = createSignal("");
  const [forgotRecoveryPhrase, setForgotRecoveryPhrase] = createSignal("");
  const [showPhraseInput, setShowPhraseInput] = createSignal(false);

  // Contacts manager state.
  const [contactsOpen, setContactsOpen] = createSignal(false);
  const [contacts, setContacts] = createSignal<ContactItem[]>([]);

  // Multi-Mailbox state & toast notifications
  const [connectedAccounts, setConnectedAccounts] = createSignal<ConnectedAccount[]>([]);
  const [addMailboxModalOpen, setAddMailboxModalOpen] = createSignal(false);
  interface ToastItem {
    id: string;
    message: string;
    action?: {
      label: string;
      onClick: () => void;
    };
  }
  const [toasts, setToasts] = createSignal<ToastItem[]>([]);

  function addToast(toast: ToastItem & { duration?: number }) {
    setToasts((prev) => [...prev.filter((t) => t.id !== toast.id), toast]);
    if (toast.duration) {
      setTimeout(() => {
        removeToast(toast.id);
      }, toast.duration);
    }
  }

  function removeToast(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  function updateToast(id: string, message: string) {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, message } : t))
    );
  }

  function showToast(msg: string) {
    const id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    addToast({
      id,
      message: msg,
      duration: 3500,
    });
  }

  // Custom Folders & Labels state
  const [customFolders, setCustomFolders] = createSignal<MailboxFolder[]>([]);
  const [activeCustomFolder, setActiveCustomFolder] = createSignal<MailboxFolder | null>(null);
  const [createFolderModalOpen, setCreateFolderModalOpen] = createSignal(false);
  const [folderToEdit, setFolderToEdit] = createSignal<MailboxFolder | null>(null);
  const [importEmailsModalOpen, setImportEmailsModalOpen] = createSignal(false);

  const [labels, setLabels] = createSignal<MailboxLabel[]>([]);
  const [activeLabel, setActiveLabel] = createSignal<MailboxLabel | null>(null);
  const [createLabelModalOpen, setCreateLabelModalOpen] = createSignal(false);
  const [labelToEdit, setLabelToEdit] = createSignal<MailboxLabel | null>(null);
  const [initialParentLabelId, setInitialParentLabelId] = createSignal<string | null>(null);
  const [changeParentLabel, setChangeParentLabel] = createSignal<MailboxLabel | null>(null);

  async function handleSaveFolder(name: string, parentId?: string | null, notify?: boolean) {
    const box = selectedMailbox();
    if (!box) return;
    const editing = folderToEdit();
    const cleanName = name.trim();
    if (!cleanName) return;

    // Deduplication check (case-insensitive)
    const duplicate = customFolders().some(
      (f) => f.name.trim().toLowerCase() === cleanName.toLowerCase() && (!editing || f.id !== editing.id)
    );
    if (duplicate) {
      showToast(`Folder "${cleanName}" already exists`);
      return;
    }

    try {
      if (editing) {
        const updated = await updateFolder(box.id, editing.id, { name: cleanName, parent_id: parentId, notify });
        setCustomFolders((prev) =>
          prev.map((f) => (f.id === editing.id ? updated : f)).sort((a, b) => a.name.localeCompare(b.name))
        );
        if (activeCustomFolder()?.id === editing.id) {
          setActiveCustomFolder(updated);
        }
        setFolderToEdit(null);
        showToast(`Folder "${cleanName}" updated`);
      } else {
        const created = await createFolder(box.id, { name: cleanName, parent_id: parentId, notify });
        setCustomFolders((prev) => {
          const exists = prev.some((f) => f.id === created.id || f.name.trim().toLowerCase() === cleanName.toLowerCase());
          if (exists) return prev;
          return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
        });
        showToast(`Folder "${cleanName}" created`);
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to save folder");
    }
  }

  function handleOpenEditFolder(folder: MailboxFolder) {
    setFolderToEdit(folder);
    setCreateFolderModalOpen(true);
  }

  async function handleDeleteFolder(folder: MailboxFolder) {
    const box = selectedMailbox();
    if (!box) return;
    if (!confirm(`Delete folder "${folder.name}"? Contained messages will return to your Inbox.`)) return;
    try {
      await deleteFolder(box.id, folder.id);
      setCustomFolders((prev) => prev.filter((f) => f.id !== folder.id));
      if (activeCustomFolder()?.id === folder.id) {
        setActiveCustomFolder(null);
        setCurrentFolder("inbox");
      }
      // Contained messages move to inbox
      setMessages((prev) =>
        prev.map((m) => (m.folderId === folder.id ? { ...m, folderId: null, folder: "inbox" as Folder } : m))
      );
      showToast(`Folder "${folder.name}" deleted`);
    } catch (err: any) {
      alert("Failed to delete folder: " + (err?.message || "unknown error"));
    }
  }

  async function handleSaveLabel(name: string, color: string, colorName: string, parentLabelId?: string | null) {
    const box = selectedMailbox();
    if (!box) return;
    const editing = labelToEdit();
    const cleanName = name.trim();
    if (!cleanName) return;

    // Sibling deduplication check (case-insensitive) under the SAME parent
    const targetParent = parentLabelId || null;
    const duplicate = labels().some(
      (l) =>
        (l.parent_label_id || null) === targetParent &&
        l.name.trim().toLowerCase() === cleanName.toLowerCase() &&
        (!editing || l.id !== editing.id)
    );
    if (duplicate) {
      showToast(`A label named "${cleanName}" already exists under this parent`);
      return;
    }

    try {
      if (editing) {
        const updated = await updateLabel(box.id, editing.id, {
          name: cleanName,
          color,
          color_name: colorName,
          parent_label_id: parentLabelId,
        });
        const refreshed = await fetchLabels(box.id);
        setLabels(refreshed);
        if (activeLabel()?.id === editing.id) {
          const freshActive = refreshed.find((l) => l.id === editing.id) || updated;
          setActiveLabel(freshActive);
        }
        setLabelToEdit(null);
        setInitialParentLabelId(null);
        showToast(`Label "${cleanName}" updated`);
      } else {
        await createLabel(box.id, {
          name: cleanName,
          color,
          color_name: colorName,
          parent_label_id: parentLabelId,
        });
        const refreshed = await fetchLabels(box.id);
        setLabels(refreshed);
        setInitialParentLabelId(null);
        showToast(`Label "${cleanName}" created`);
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to save label");
    }
  }

  async function handleChangeParent(labelId: string, newParentId: string | null) {
    const box = selectedMailbox();
    if (!box) return;
    try {
      await updateLabel(box.id, labelId, { parent_label_id: newParentId });
      const refreshed = await fetchLabels(box.id);
      setLabels(refreshed);
      if (activeLabel()?.id === labelId) {
        const fresh = refreshed.find((l) => l.id === labelId);
        if (fresh) setActiveLabel(fresh);
      }
      setChangeParentLabel(null);
      showToast("Label moved");
    } catch (err: any) {
      showToast(err?.message || "Failed to move label");
    }
  }

  function handleOpenEditLabel(label: MailboxLabel) {
    setLabelToEdit(label);
    setInitialParentLabelId(label.parent_label_id || null);
    setCreateLabelModalOpen(true);
  }

  function handleOpenNewSublabel(parentLabel: MailboxLabel) {
    setLabelToEdit(null);
    setInitialParentLabelId(parentLabel.id);
    setCreateLabelModalOpen(true);
  }

  async function handleDeleteLabel(label: MailboxLabel) {
    const box = selectedMailbox();
    if (!box) return;
    const all = labels();
    const subtreeIds = getSubtreeLabelIds(label.id, all);
    const subCount = subtreeIds.length - 1;

    let confirmMsg = `Delete label "${label.name}"? Messages with this label will not be deleted.`;
    if (subCount > 0) {
      confirmMsg = `This will also delete ${subCount} sublabel${subCount > 1 ? "s" : ""}. Messages with those labels will not be deleted.`;
    }
    if (!confirm(confirmMsg)) return;

    try {
      await deleteLabel(box.id, label.id);
      const remaining = all.filter((l) => !subtreeIds.includes(l.id));
      setLabels(remaining);
      if (activeLabel() && subtreeIds.includes(activeLabel()!.id)) {
        setActiveLabel(null);
      }
      // Detach label and descendants from all messages in memory
      const deletedSet = new Set(subtreeIds);
      setMessages((prev) =>
        prev.map((m) =>
          m.labelIds ? { ...m, labelIds: m.labelIds.filter((lid) => !deletedSet.has(lid)) } : m
        )
      );
      showToast(`Label "${label.name}" deleted`);
    } catch (err: any) {
      alert("Failed to delete label: " + (err?.message || "unknown error"));
    }
  }

  function handleSelectCustomFolder(folder: MailboxFolder) {
    setActiveCustomFolder(folder);
    setActiveLabel(null);
    setSelectedMsg(null);
    setSelectedIds(new Set<string>());
  }

  function handleSelectLabel(label: MailboxLabel) {
    setActiveLabel(label);
    setActiveCustomFolder(null);
    setSelectedMsg(null);
    setSelectedIds(new Set<string>());
  }

  async function publishKeysOnce(
    boxId: string,
    signingSeed: Uint8Array,
    xwingSeed: Uint8Array,
  ): Promise<void> {
    try {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const signingPubHex = wasm.wasm_signing_public_key_from_seed(
        bytesToHex(signingSeed),
      );
      const xwingPubHex = wasm.wasm_xwing_public_key_from_seed(
        bytesToHex(xwingSeed),
      );
      const key = "byos_keys_published_" + boxId + "_" + signingPubHex + "_" + xwingPubHex;
      if (typeof window === "undefined" || sessionStorage.getItem(key)) return;

      await publishMailboxKeys({
        ed25519_signing_public_key: hexToBase64(signingPubHex),
        xwing_public_key: hexToBase64(xwingPubHex),
      });
      sessionStorage.setItem(key, "1");
    } catch (e) {
      console.warn("Key publication failed:", e);
    }
  }

  async function bootstrapSession(user: UserMe, password?: string, sessionToken?: string) {
    // Rule 1: Fresh login (password present) → rotate session generation.
    // This purges every byos_* key from sessionStorage and wipes the stale
    // connected-accounts list from localStorage before any new state is written.
    // A login as user A can never inherit user B's stale session tokens or keys.
    if (password) {
      rotateSessionGeneration();
    }

    setCurrentUser(user);
    let boxes: Mailbox[] = [];
    try {
      boxes = await fetchMailboxes(user.org_id);
    } catch (err: any) {
      console.error("fetchMailboxes failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = msg.includes("401") || msg.includes("Unauthorized") || msg.includes("unauthorized");
      setGlobalError(`Failed to load mailboxes: ${msg}`, isAuth);
      return;
    }
    let targetBox: Mailbox | undefined;

    // Strict user-mailbox binding per Section 12 & 14
    if (user.mailbox_id) {
      targetBox = boxes.find((b) => b.id === user.mailbox_id);
      if (!targetBox && user.mailbox_local_part) {
        targetBox = {
          id: user.mailbox_id,
          local_part: user.mailbox_local_part,
          domain_id: "",
          mode: user.mailbox_mode || "org_managed",
        };
      }
    }
    if (!targetBox && isImpersonating() && impersonateMailboxId()) {
      targetBox = boxes.find((b) => b.id === impersonateMailboxId());
    }
    if (!targetBox && boxes.length > 0) {
      // User's own mailbox is missing. Do NOT silently fall back to 
      // another mailbox — that would show one user another user's mail.
      console.error(
        "No mailbox found for authenticated user; refusing to fall back",
        {
          userId: user.id,
          expectedMailboxId: user.mailbox_id,
          availableBoxes: boxes.map((b) => b.id),
        },
      );
      setErrorMessage(
        "Your mailbox could not be found. Please contact support or log in again.",
      );
      setSelectedMailbox(null);
      setUnlockedBoxId(null);
      return;
    }

    if (targetBox) {
      setMailboxes([targetBox]);
      setSelectedMailbox(targetBox);
      refreshSignature(targetBox.id);

      let currentSkHex = "";
      let currentSKey = "";

      // Automated key unwrapping upon login (Section 14 / Section 15 / Rule 3)
      const wrappedSk = user.wrapped_sk_user || targetBox.wrapped_sk_user;
      if (password && wrappedSk) {
        try {
          const unwrapped = await unsealAccountKeys(targetBox.id, password, wrappedSk);
          currentSkHex = Array.from(unwrapped.mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
          currentSKey = unwrapped.searchKeyHex;
          setMailboxKey(unwrapped.mailboxSk);
          setSearchKey(unwrapped.searchKeyHex);
          setUnlockedBoxId(targetBox.id);
          setSigningSeed(unwrapped.signingSeed);
          setXwingSeed(unwrapped.xwingSeed);

          if (unwrapped.signingSeed && unwrapped.xwingSeed) {
            publishKeysOnce(targetBox.id, unwrapped.signingSeed, unwrapped.xwingSeed);
          }

          if (rememberDevice() && (user.id || (user as any).user_id)) {
            savePersistentSession({
              userId: user.id || (user as any).user_id || "",
              mailboxId: targetBox.id,
              mailboxSkHex: currentSkHex,
              searchKeyHex: currentSKey,
              signingSeedHex: unwrapped.signingSeed
                ? Array.from(unwrapped.signingSeed, (b) => b.toString(16).padStart(2, "0")).join("")
                : undefined,
              xwingSeedHex: unwrapped.xwingSeed
                ? Array.from(unwrapped.xwingSeed, (b) => b.toString(16).padStart(2, "0")).join("")
                : undefined,
              sessionToken: sessionToken || (typeof window !== "undefined" ? sessionStorage.getItem("byos_active_session_token") || "" : ""),
              email: user.email || "",
            }).catch((err) => console.warn("[persistent-session] Failed saving device keys:", err));
          } else if (user.id || (user as any).user_id) {
            clearPersistentSession(user.id || (user as any).user_id).catch(() => {});
          }
        } catch (err) {
          console.warn("Auto-unwrap of mailbox key failed:", err);
        }
      } else if (!password) {
        // Restore from sessionStorage if user refreshed during an active session
        const savedSk = sessionStorage.getItem("byos_mailbox_sk_" + targetBox.id);
        const savedSKey = sessionStorage.getItem("byos_mailbox_skey_" + targetBox.id);
        const savedSigningSeed = sessionStorage.getItem("byos_signing_seed_" + targetBox.id);
        const savedXWingSeed = sessionStorage.getItem("byos_xwing_seed_" + targetBox.id);
        if (savedSk) {
          try {
            const bytes = new Uint8Array(savedSk.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
            setMailboxKey(bytes);
            if (savedSKey) setSearchKey(savedSKey);
            setUnlockedBoxId(targetBox.id);
            currentSkHex = savedSk;
            currentSKey = savedSKey || "";

            let restoredSigningSeed: Uint8Array | null = null;
            if (savedSigningSeed) {
              const seedBytes = new Uint8Array(savedSigningSeed.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
              setSigningSeed(seedBytes);
              restoredSigningSeed = seedBytes;
            } else {
              setSigningSeed(null);
            }

            let restoredXWingSeed: Uint8Array | null = null;
            if (savedXWingSeed) {
              const seedBytes = new Uint8Array(savedXWingSeed.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
              setXwingSeed(seedBytes);
              restoredXWingSeed = seedBytes;
            } else {
              setXwingSeed(null);
            }

            if (restoredSigningSeed && restoredXWingSeed) {
              publishKeysOnce(targetBox.id, restoredSigningSeed, restoredXWingSeed);
            }
          } catch {
            sessionStorage.removeItem("byos_mailbox_sk_" + targetBox.id);
            sessionStorage.removeItem("byos_mailbox_skey_" + targetBox.id);
            sessionStorage.removeItem("byos_signing_seed_" + targetBox.id);
            sessionStorage.removeItem("byos_xwing_seed_" + targetBox.id);
          }
        }
      }

      // Sync into ConnectedAccount & sessionStorage
      const tokenToSave = sessionToken || sessionStorage.getItem("byos_active_session_token") || "";
      if (tokenToSave) {
        sessionStorage.setItem("byos_active_session_token", tokenToSave);
      }

      const activeAcc: ConnectedAccount = {
        id: targetBox.id,
        email: user.email,
        displayName: user.display_name || targetBox.local_part || user.email.split("@")[0],
        role: user.role || "member",
        privacyMode: targetBox.mode || "org_managed",
        sessionToken: tokenToSave,
        mailboxSkHex: currentSkHex,
        searchKeyHex: currentSKey,
        profile_photo_ref: user.profile_photo_ref || targetBox.profile_photo_ref || undefined,
      };

      // Rule 1+4: After session rotation, sessionStorage is clean.
      // Read only from sessionStorage (never from localStorage here — localStorage
      // may contain prior-generation stripped metadata from a previous login).
      const savedAccountsStr = sessionStorage.getItem("byos_connected_accounts");
      let list: ConnectedAccount[] = [];
      if (savedAccountsStr) {
        try {
          list = JSON.parse(savedAccountsStr);
        } catch {}
      }
      if (!Array.isArray(list)) list = [];
      list = list.filter(
        (a) =>
          Boolean(a) &&
          a.id !== activeAcc.id &&
          (!a.email || a.email.toLowerCase() !== activeAcc.email.toLowerCase())
      );
      list.unshift(activeAcc);
      try {
        sessionStorage.setItem("byos_connected_accounts", JSON.stringify(list));
      } catch {}
      // Rule 4: localStorage stores ONLY stripped metadata (no tokens, no keys).
      persistAccountListForDisplay(list);
      setConnectedAccounts(list);

      await loadMailboxData(targetBox.id);
      if (user.profile_photo_ref || targetBox.profile_photo_ref) {
        loadDecryptedProfilePhoto(mailboxKey(), tokenToSave);
      }
    } else {
      setMailboxes([]);
      setSelectedMailbox(null);
    }
  }

  async function handleSwitchAccount(account: ConnectedAccount) {
    // Rule 1: Switch must load or unlock the target account's keys.
    // Check whether the target account's keys are in the per-account key store.
    let targetKey = getMailboxKeyFor(account.id);
    if (!targetKey && account.mailboxSkHex) {
      try {
        targetKey = new Uint8Array(account.mailboxSkHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      } catch {}
    }

    if (!targetKey) {
      // Rule 1: Account is locked. Show the "Unlock {email}" password prompt.
      // Do NOT switch active account label without switching active crypto context.
      setPendingSwitchAccount(account);
      setUnlockAccountTarget({ mailboxId: account.id, email: account.email });
      setUnlockAccountPassword("");
      setUnlockAccountError(null);
      return;
    }

    if (profilePhotoUrl()) {
      URL.revokeObjectURL(profilePhotoUrl()!);
      setProfilePhotoUrl(null);
    }

    setIsLoading(true);
    try {
      // 1. Set active session token
      if (account.sessionToken) {
        sessionStorage.setItem("byos_active_session_token", account.sessionToken);
      }

      // 2. Set active cryptographic keys in memory (Rule 1 & Rule 6)
      const skHex = bytesToHex(targetKey);
      const searchKeyHex = account.searchKeyHex || sessionStorage.getItem("byos_mailbox_skey_" + account.id) || "";
      setMailboxKey(targetKey);
      setSearchKey(searchKeyHex);
      setUnlockedBoxId(account.id);
      sessionStorage.setItem("byos_mailbox_sk_" + account.id, skHex);
      if (searchKeyHex) {
        sessionStorage.setItem("byos_mailbox_skey_" + account.id, searchKeyHex);
      }

      // Restore signing seed if present (Rule 2 & Rule 6)
      const switchedSigningSeed = getSigningSeedFor(account.id);
      setSigningSeed(switchedSigningSeed);

      // Restore X-Wing seed if present (Rule 2 & Rule 6)
      const switchedXWingSeed = getXWingSeedFor(account.id);
      setXwingSeed(switchedXWingSeed);

      if (switchedSigningSeed && switchedXWingSeed) {
        publishKeysOnce(account.id, switchedSigningSeed, switchedXWingSeed);
      }

      // 3. Update active mailbox and user in reactive store
      const switchedBox: Mailbox = {
        id: account.id,
        local_part: account.email.split("@")[0],
        domain_id: "",
        mode: account.privacyMode,
      };
      setSelectedMailbox(switchedBox);
      setMailboxes([switchedBox]);
      setCurrentUser({
        id: account.id,
        user_id: account.id,
        email: account.email,
        org_id: currentUser()?.org_id || "",
        role: account.role,
        mailbox_id: account.id,
        mailbox_mode: account.privacyMode,
      });

      // 4. Update connected accounts list to keep active account prominent (Rule 4: other accounts untouched)
      setConnectedAccounts((prev) => {
        const remaining = prev.filter(
          (a) =>
            Boolean(a) &&
            a.id !== account.id &&
            (!a.email || a.email.toLowerCase() !== account.email.toLowerCase())
        );
        const updated = [{ ...account, isLocked: false }, ...remaining];
        try {
          sessionStorage.setItem("byos_connected_accounts", JSON.stringify(updated));
        } catch {}
        // Rule 4: localStorage stores ONLY stripped metadata (no tokens, no keys).
        persistAccountListForDisplay(updated);
        return updated;
      });

      // 5. If currently in unified inbox, switch to account's inbox
      if (currentFolder() === "unified_inbox") {
        setCurrentFolder("inbox");
        setActiveCustomFolder(null);
        setActiveLabel(null);
        setSelectedMsg(null);
        setSelectedIds(new Set<string>());
        setCurrentPage(1);
      }
      // 6. Reload messages, drafts, folders
      await loadMailboxData(account.id);
      refreshSignature(account.id);
      if (account.profile_photo_ref) {
        loadDecryptedProfilePhoto(targetKey, account.sessionToken);
      } else {
        if (profilePhotoUrl()) {
          URL.revokeObjectURL(profilePhotoUrl()!);
          setProfilePhotoUrl(null);
        }
      }
    } catch (err) {
      console.error("Failed to switch account:", err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleAccountAdded(account: ConnectedAccount) {
    setConnectedAccounts((prev) => {
      const filtered = prev.filter(
        (a) =>
          Boolean(a) &&
          a.id !== account.id &&
          (!a.email || a.email.toLowerCase() !== account.email.toLowerCase())
      );
      const updated = [account, ...filtered];
      try {
        sessionStorage.setItem("byos_connected_accounts", JSON.stringify(updated));
      } catch {}
      // Rule 4: localStorage stores ONLY stripped metadata (no tokens, no keys).
      persistAccountListForDisplay(updated);
      return updated;
    });
    setAddMailboxModalOpen(false);
    if (!selectedMailbox()) {
      handleSwitchAccount(account);
    }
    showToast(`Connected ${account.email} successfully`);
  }

  async function handleExitImpersonation() {
    sessionStorage.removeItem("byos_impersonation_token");
    try {
      await logout();
    } catch {}
    window.location.href = "http://127.0.0.1:3000/dashboard/mailboxes";
  }

  function focusSearch() {
    const input = document.getElementById("webmail-search-input") as HTMLInputElement | null;
    if (input) {
      input.focus();
      input.select();
    }
  }

  function navigateList(direction: 1 | -1) {
    const list = sortedMessages();
    if (list.length === 0) return;
    const currentId = selectedMsg()?.id;
    if (!currentId) {
      const target = direction === 1 ? list[0] : list[list.length - 1];
      openMessage(target);
      return;
    }
    const idx = list.findIndex((m) => m.id === currentId);
    if (idx === -1) {
      const target = direction === 1 ? list[0] : list[list.length - 1];
      openMessage(target);
      return;
    }
    const next = list[idx + direction];
    if (next) openMessage(next);
  }

  function closeAllModals() {
    if (shortcutsHelpOpen()) {
      setShortcutsHelpOpen(false);
      return;
    }
    if (composeOpen()) {
      setComposeOpen(false);
      return;
    }
    if (settingsOpen()) {
      setSettingsOpen(false);
      return;
    }
    if (contactsOpen()) {
      setContactsOpen(false);
      return;
    }
    if (addMailboxModalOpen()) {
      setAddMailboxModalOpen(false);
      return;
    }
    if (createFolderModalOpen()) {
      setCreateFolderModalOpen(false);
      return;
    }
    if (importEmailsModalOpen()) {
      setImportEmailsModalOpen(false);
      return;
    }
    if (createLabelModalOpen()) {
      setCreateLabelModalOpen(false);
      return;
    }
    if (document.activeElement instanceof HTMLElement && isTextInputElement(document.activeElement)) {
      document.activeElement.blur();
      return;
    }
    if (selectedMsg()) {
      setSelectedMsg(null);
      return;
    }
    if (selectedIds().size > 0) {
      setSelectedIds(new Set<string>());
      return;
    }
  }

  const shortcuts: ShortcutHandler[] = [
    { key: "c", description: "Compose", action: () => startNewCompose() },
    {
      key: "r",
      description: "Reply",
      action: () => {
        const msg = selectedMsg();
        if (msg) startReply(msg);
      },
    },
    {
      key: "a",
      description: "Reply all",
      action: () => {
        const msg = selectedMsg();
        if (msg) startReply(msg);
      },
    },
    {
      key: "f",
      description: "Forward",
      action: () => {
        const msg = selectedMsg();
        if (msg) startForward(msg);
      },
    },
    {
      key: "e",
      description: "Archive",
      action: () => {
        const msg = selectedMsg();
        if (msg) handleArchiveMessage(msg);
      },
    },
    { key: "j", description: "Next message", action: () => navigateList(1) },
    { key: "k", description: "Previous message", action: () => navigateList(-1) },
    { key: "/", description: "Search", action: () => focusSearch() },
    { key: "?", shift: true, description: "Show help", action: () => setShortcutsHelpOpen(true) },
    { key: "Escape", description: "Close", action: () => closeAllModals(), firesInInput: true },
    {
      key: "g i",
      description: "Go to Inbox",
      action: () => {
        setActiveCustomFolder(null);
        setActiveLabel(null);
        setSelectedMsg(null);
        setSelectedIds(new Set<string>());
        setCurrentPage(1);
        if (currentFolder() === "unified_inbox") {
          loadUnifiedInboxMessages();
        } else {
          setCurrentFolder("inbox");
          const box = selectedMailbox();
          if (box) loadMailboxData(box.id);
        }
      },
    },
  ];

  let gSequenceActive = false;
  let gSequenceTimer: any = null;

  function handleKeyDown(e: KeyboardEvent) {
    // Ignore if modifier keys are held (browser shortcuts win)
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Ignore if focus is in a text input unless firesInInput
    const inInput = isTextInputElement(document.activeElement);

    if (inInput) {
      gSequenceActive = false;
    } else {
      if (e.key === "g") {
        gSequenceActive = true;
        clearTimeout(gSequenceTimer);
        gSequenceTimer = setTimeout(() => {
          gSequenceActive = false;
        }, 1000);
        return;
      }
      if (gSequenceActive && e.key === "i") {
        gSequenceActive = false;
        clearTimeout(gSequenceTimer);
        e.preventDefault();
        setActiveCustomFolder(null);
        setActiveLabel(null);
        setSelectedMsg(null);
        setSelectedIds(new Set<string>());
        setCurrentPage(1);
        if (currentFolder() === "unified_inbox") {
          loadUnifiedInboxMessages();
        } else {
          setCurrentFolder("inbox");
          const box = selectedMailbox();
          if (box) loadMailboxData(box.id);
        }
        return;
      }
      gSequenceActive = false;
    }

    for (const s of shortcuts) {
      if (matchShortcut(e, s)) {
        if (inInput && !s.firesInInput) continue;
        e.preventDefault();
        s.action();
        return;
      }
    }
  }

  function handleStorageChange(e: StorageEvent) {
    if (e.key === SESSION_GENERATION_KEY) {
      // Another tab started a fresh login — our session is now stale.
      // Clear accounts from this tab too.
      const newGen = e.newValue;
      const ourGen = sessionStorage.getItem(SESSION_GENERATION_KEY);
      if (newGen && newGen !== ourGen) {
        setConnectedAccounts([]);
        clearAllSensitiveSessionKeys();
        sessionStorage.removeItem("byos_connected_accounts");
      }
      return;
    }
    if (e.key === "byos_connected_accounts" && e.newValue) {
      // Only sync if the other tab's session generation matches ours.
      const ourGen = sessionStorage.getItem(SESSION_GENERATION_KEY);
      const otherGen = localStorage.getItem(SESSION_GENERATION_KEY);
      if (ourGen && otherGen && ourGen !== otherGen) {
        // Different generation — ignore cross-tab sync.
        return;
      }
      try {
        const list = JSON.parse(e.newValue);
        if (Array.isArray(list)) {
          setConnectedAccounts(list);
          sessionStorage.setItem("byos_connected_accounts", e.newValue);
        }
      } catch {}
    }
  }

  onMount(async () => {
    initNetworkListeners();
    registerServiceWorker().catch(() => {});
    onNetworkReconnect(async () => {
      try {
        const res = await replayQueue({
          sendInternal: (req, token) => sendInternal(req, token),
          sendOutbound: async (item: any, token) => {
            const [pubkey, reservation] = await Promise.all([
              fetchOutboundPubkey(token),
              prepareOutbound(item.mailbox_id, token),
            ]);
            const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
            const mailboxIdHex = item.mailbox_id.replace(/-/g, "");
            const mime = item.payload?.mime_message || item.mime_message || item.payload?.envelope_json || "";
            const plaintextB64 = bytesToBase64(new TextEncoder().encode(mime));
            const encrypted = JSON.parse(
              wasm.wasm_encrypt_outbound(pubkey, mailboxIdHex, BigInt(reservation.outbox_seq), plaintextB64),
            ) as { ciphertext: string; send_token_wrapped: string; iv: string };
            return sendOutbound(
              {
                reservation_id: reservation.reservation_id,
                mailbox_id: item.mailbox_id,
                recipient: item.recipient,
                encrypted_message: encrypted.ciphertext,
                send_token_wrapped: encrypted.send_token_wrapped,
                outbox_seq: reservation.outbox_seq,
                encryption_version: reservation.encryption_version,
                aad_version: reservation.aad_version,
                encryption_iv: encrypted.iv,
                alias_id: item.payload?.alias_id || item.alias_id || undefined,
                client_queue_id: item.client_queue_id,
              },
              token,
            );
          },
          getToken: (mId) => {
            const acc = connectedAccounts().find((a) => a.id === mId);
            return acc?.sessionToken || sessionStorage.getItem("byos_active_session_token") || undefined;
          },
        });
        showToast("Back online. Pending messages synced.");
        if (res.sent > 0) {
          showToast(`Sent ${res.sent} queued message${res.sent > 1 ? "s" : ""}.`);
        }
        try {
          const offlineDrafts = await getOfflineDrafts();
          for (const d of offlineDrafts) {
            try {
              const dKey = getMailboxKeyFor(d.mailbox_id);
              if (!dKey) continue;
              const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
              const richContent = d.bodyHtml || d.body;
              const env = d.encrypted_envelope || encryptDraftEnvelope(wasm, dKey, d.mailbox_id, richContent);
              await createDraft(d.mailbox_id, {
                recipient: d.recipient,
                subject: d.subject || "Untitled Draft",
                encrypted_envelope: env,
              });
              await removeOfflineDraft(d.id);
            } catch (dErr) {
              console.warn("[offline] Draft sync error:", dErr);
            }
          }
        } catch {}

        const currentBox = selectedMailbox();
        if (currentBox) {
          await loadMailboxData(currentBox.id);
        }
      } catch (err) {
        console.warn("[offline] Auto-sync on reconnect error:", err);
      }
    });

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("storage", handleStorageChange);

    const urlParams = new URLSearchParams(window.location.search);
    if (window.location.pathname === "/setup-account" || urlParams.has("token")) {
      setIsSetupAccount(true);
      setIsLoading(false);
      return;
    }

    if (urlParams.get("impersonate") === "1") {
      setIsImpersonating(true);
      setImpersonateMailboxId(urlParams.get("mailbox_id"));
      setImpersonateEmail(urlParams.get("email"));
      const token = urlParams.get("session_token");
      if (token) {
        sessionStorage.setItem("byos_impersonation_token", token);
      }
    }

    // Rule 2: Session-generation-gated account restoration.
    //
    // sessionStorage is the source of truth for the live session.
    // localStorage is only used as a cache of stripped metadata (no tokens/keys)
    // from the current generation so the sidebar can show avatars/emails while
    // validation runs.
    //
    // We read from sessionStorage first. If sessionStorage is empty (tab was
    // closed and reopened) we read from localStorage, but ONLY if the stored
    // session generation matches the current generation key. A mismatch means
    // the user logged in as a different account or explicitly cleared the session
    // — in that case we discard the stale list entirely.
    //
    // After reading, we filter out any entry whose sessionToken fails a
    // lightweight /v1/users/me/mailboxes probe. This catches revoked or expired
    // tokens from prior sessions even within the same generation.

    const storedGen = readSessionGeneration();
    const savedAccountsStr =
      sessionStorage.getItem("byos_connected_accounts") ||
      (storedGen && typeof window !== "undefined"
        ? localStorage.getItem("byos_connected_accounts")
        : null);

    if (savedAccountsStr) {
      try {
        const rawList: ConnectedAccount[] = JSON.parse(savedAccountsStr);
        if (Array.isArray(rawList) && rawList.length > 0) {
          // Show the list immediately so the sidebar is not empty while
          // we validate. Tokens marked as stale will be removed below.
          setConnectedAccounts(rawList);
          sessionStorage.setItem("byos_connected_accounts", JSON.stringify(rawList));
          if (!sessionStorage.getItem("byos_active_session_token") && rawList[0].sessionToken) {
            sessionStorage.setItem("byos_active_session_token", rawList[0].sessionToken);
          }

          // Async token validation: probe each secondary account's sessionToken.
          // The primary account (index 0) will be validated via fetchCurrentUser()
          // below — skip it here to avoid double-validating.
          if (rawList.length > 1) {
            const { fetchUserMailboxes } = await import("./api");
            const validated: ConnectedAccount[] = [rawList[0]]; // primary — validated below
            for (const acc of rawList.slice(1)) {
              if (!acc.sessionToken) {
                // No token stored → account was from a stale localStorage read,
                // keys are missing. Drop it silently.
                clearAccountKeys(acc.id);
                continue;
              }
              try {
                await fetchUserMailboxes(acc.sessionToken);
                validated.push(acc); // token is still valid
              } catch (err: any) {
                const status = err?.status ?? err?.statusCode;
                if (status === 401 || status === 403) {
                  // Token revoked or expired — remove all keys for this account.
                  console.info(
                    `[session-isolation] Removing stale account ${acc.email}: token invalid (${status})`,
                  );
                  clearAccountKeys(acc.id);
                  // Rule 5: no generic "unauthorized" — account is silently removed.
                } else {
                  // Network error — keep account but mark as needing re-auth
                  console.warn(`[session-isolation] Could not validate ${acc.email}:`, err);
                  validated.push(acc);
                }
              }
            }
            // Update sidebar to reflect only validated accounts
            setConnectedAccounts(validated);
            sessionStorage.setItem("byos_connected_accounts", JSON.stringify(validated));
            persistAccountListForDisplay(validated);
          }
        }
      } catch {
        // Corrupt storage entry — clear and proceed fresh
        sessionStorage.removeItem("byos_connected_accounts");
        localStorage.removeItem("byos_connected_accounts");
      }
    }

    setIsLoading(true);
    try {
      let hasSession = !!(typeof window !== "undefined" && sessionStorage.getItem("byos_active_session_token"));
      if (!hasSession) {
        try {
          const restored = await restorePersistentSession();
          if (restored) {
            console.info("[persistent-session] Restored 30-day session for user:", restored.userId);
            hasSession = true;
          }
        } catch (err) {
          console.warn("[persistent-session] Could not restore persistent session:", err);
        }
      }

      if (hasSession) {
        const user = await fetchCurrentUser();
        if (user) {
          await bootstrapSession(user);
        } else {
          await clearPersistentSession();
        }
      } else {
        await clearPersistentSession();
        try {
          await logout();
        } catch {}
      }
    } catch (err) {
      console.warn("Failed loading user/mailbox data on mount:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = msg.includes("401") || msg.includes("Unauthorized") || msg.includes("unauthorized");
      if (isAuth) {
        await clearPersistentSession();
      }
      setGlobalError(`Failed to load user session: ${msg}`, isAuth);
    } finally {
      setIsLoading(false);
    }

    // Check for pending send (Undo Send V1)
    const rawPending = typeof window !== "undefined" ? sessionStorage.getItem("byos_pending_send") : null;
    if (rawPending) {
      try {
        const payload: PendingSend = JSON.parse(rawPending);
        if (Date.now() >= payload.expiresAt) {
          // Expired while the tab was closed — send immediately
          sessionStorage.removeItem("byos_pending_send");
          executeSend(payload);
        } else {
          // Still in the window — resume the countdown
          setPendingSend(payload);
          showUndoToast(payload);
        }
      } catch {
        sessionStorage.removeItem("byos_pending_send");
      }
    }
  });

  onCleanup(() => {
    if (profilePhotoUrl()) {
      URL.revokeObjectURL(profilePhotoUrl()!);
    }
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("storage", handleStorageChange);
  });

  async function handleLogin(e: Event) {
    e.preventDefault();
    const email = loginEmail().trim().toLowerCase();
    const password = loginPassword();
    if (!email || !password) {
      setLoginError("Enter your email and password.");
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const loginRes = await login(email, password);

      // Check if 2FA challenge is required
      if (loginRes.two_factor_required) {
        setTwoFactorChallenge({
          challenge_token: loginRes.challenge_token || "",
          methods: loginRes.methods || ["email"],
          preferred_method: loginRes.preferred_method || "email",
          destination_masked: loginRes.destination_masked || "",
        });
        setSelected2FAMethod(loginRes.preferred_method || "email");
        setCachedPassword(password);
        setTwoFactorCodeInput("");
        setTwoFactorError(null);
        setLoginBusy(false);
        return;
      }

      setIsLoading(true);
      if (loginRes.token) {
        try {
          sessionStorage.setItem("byos_active_session_token", loginRes.token);
        } catch {}
      }
      let user = await fetchCurrentUser();
      if (!user && loginRes.id) {
        user = {
          id: loginRes.id,
          user_id: loginRes.id,
          email: loginRes.email || email,
          org_id: loginRes.org_id || loginRes.organization_id || "",
          role: loginRes.role || "member",
          plan: loginRes.plan || "solo",
          mailbox_id: loginRes.mailbox_id,
          mailbox_local_part: loginRes.mailbox_local_part,
          mailbox_mode: loginRes.mailbox_mode,
          wrapped_sk_user: loginRes.wrapped_sk_user,
          previous_wrapped_sk_user: loginRes.previous_wrapped_sk_user,
        } as UserMe;
      }
      if (!user) throw new Error("Session was not established.");
      if (loginRes.wrapped_sk_user && !user.wrapped_sk_user) {
        user.wrapped_sk_user = loginRes.wrapped_sk_user;
      }
      await bootstrapSession(user, password, loginRes.token);
    } catch (err: any) {
      console.error("[handleLogin error]", err);
      const status = err?.status;
      if (status === 429) {
        setLoginError("Too many attempts. Please try again later.");
      } else if (status === 401) {
        setLoginError("Invalid email or password.");
      } else {
        setLoginError(err?.message || "Failed to log in.");
      }
    } finally {
      setLoginPassword("");
      setLoginBusy(false);
      setIsLoading(false);
    }
  }

  async function handleVerifyLogin2FA(e: Event) {
    e.preventDefault();
    const challenge = twoFactorChallenge();
    const code = twoFactorCodeInput().trim();
    if (!challenge || !code) {
      setTwoFactorError("Please enter your 6-digit verification code.");
      return;
    }
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    try {
      const loginRes = await verifyLogin2FA(challenge.challenge_token, code);
      setIsLoading(true);
      if (loginRes.token) {
        sessionStorage.setItem("byos_active_session_token", loginRes.token);
      }
      let user = currentUser();
      if (!user) {
        user = {
          id: loginRes.id || "",
          user_id: loginRes.id || "",
          email: loginRes.email || "",
          org_id: loginRes.org_id || loginRes.organization_id || "",
          role: loginRes.role || "member",
          mailbox_id: loginRes.mailbox_id,
          mailbox_local_part: loginRes.mailbox_local_part,
          mailbox_mode: loginRes.mailbox_mode,
        } as UserMe;
      }
      if (loginRes.wrapped_sk_user && !user.wrapped_sk_user) {
        user.wrapped_sk_user = loginRes.wrapped_sk_user;
      }
      const pass = cachedPassword();
      await bootstrapSession(user, pass, loginRes.token);
      setTwoFactorChallenge(null);
      setCachedPassword("");
      setTwoFactorCodeInput("");
    } catch (err: any) {
      setTwoFactorError(err?.message || "Invalid or expired verification code.");
    } finally {
      setTwoFactorBusy(false);
      setIsLoading(false);
    }
  }

  async function handleSwitchLogin2FAMethod(method: "email" | "phone") {
    const challenge = twoFactorChallenge();
    if (!challenge) return;
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    try {
      const res = await sendLogin2FACode(challenge.challenge_token, method);
      if (res.success) {
        setSelected2FAMethod(method);
        setTwoFactorChallenge((prev) =>
          prev
            ? {
                ...prev,
                preferred_method: method,
                destination_masked: res.destination_masked,
              }
            : null
        );
      }
    } catch (err: any) {
      setTwoFactorError(err?.message || "Failed to send verification code.");
    } finally {
      setTwoFactorBusy(false);
    }
  }

  function handleCancelLogin2FA() {
    setTwoFactorChallenge(null);
    setCachedPassword("");
    setTwoFactorCodeInput("");
    setTwoFactorError(null);
  }

  function handleOpenForgotPassword() {
    setForgotEmail(loginEmail().trim());
    setForgotStep(1);
    setForgotMethods([]);
    setForgotSelectedMethod("email");
    setForgotChallengeToken("");
    setForgotDestinationMasked("");
    setForgotCode("");
    setForgotNewPassword("");
    setForgotConfirmPassword("");
    setForgotMailboxId("");
    setForgotOldWrappedSk("");
    setForgotRecoveryPhrase("");
    setShowPhraseInput(false);
    setForgotError(null);
    setForgotPasswordModalOpen(true);
  }

  async function handleFindRecoveryMethods(e: Event) {
    e.preventDefault();
    const email = forgotEmail().trim().toLowerCase();
    if (!email || !email.includes("@")) {
      setForgotError("Please enter a valid email address.");
      return;
    }
    setForgotBusy(true);
    setForgotError(null);
    try {
      const res = await fetchRecoveryOptions(email);
      const m = res.methods || [];
      setForgotMethods(m);
      if (m.length > 0) {
        setForgotSelectedMethod(m[0].type);
      }
    } catch (err: any) {
      setForgotError(err?.message || "Failed to find recovery options.");
    } finally {
      setForgotBusy(false);
    }
  }

  async function handleRequestRecoveryCode(e: Event) {
    e.preventDefault();
    const email = forgotEmail().trim().toLowerCase();
    const method = (forgotSelectedMethod() || "email") as "email" | "phone" | "totp";
    if (!email) return;
    setForgotBusy(true);
    setForgotError(null);
    try {
      const res = await requestRecoveryChallenge(email, method);
      setForgotChallengeToken(res.challenge_token);
      setForgotDestinationMasked(res.destination_masked);
      if (res.mailbox_id) setForgotMailboxId(res.mailbox_id);
      if (res.wrapped_sk_user) setForgotOldWrappedSk(res.wrapped_sk_user);
      setForgotStep(2);
    } catch (err: any) {
      setForgotError(err?.message || "Failed to request recovery code.");
    } finally {
      setForgotBusy(false);
    }
  }

  async function handleResetPasswordWithRecovery(e: Event) {
    e.preventDefault();
    const token = forgotChallengeToken();
    const code = forgotCode().trim();
    const newPass = forgotNewPassword();
    const confirmPass = forgotConfirmPassword();

    if (code.length !== 6) {
      setForgotError("Please enter the 6-digit verification code.");
      return;
    }
    if (newPass.length < 12) {
      setForgotError("New password must be at least 12 characters.");
      return;
    }
    if (newPass !== confirmPass) {
      setForgotError("Passwords do not match.");
      return;
    }

    setForgotBusy(true);
    setForgotError(null);
    try {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      let newMailboxPk = "";
      let newWrappedSkUser = "";

      const phrase = forgotRecoveryPhrase().trim();
      const words = phrase.split(/\s+/).filter(Boolean);

      if (words.length === 24 && forgotOldWrappedSk() && forgotMailboxId()) {
        try {
          const boxId = forgotMailboxId();
          const oldWrapped = forgotOldWrappedSk();
          const skBytes = unwrapMailboxKeyWithRecoveryPhrase(wasm, phrase, boxId, oldWrapped);
          const skHex = Array.from(skBytes, (b) => b.toString(16).padStart(2, "0")).join("");

          const salt = new Uint8Array(16);
          crypto.getRandomValues(salt);
          const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
          const passphraseEnvelope = wasm.wasm_passphrase_wrap_key(newPass, saltHex, skHex);

          const rootHex = wasm.wasm_recover_root_secret(phrase);
          const boxIdClean = boxId.replace(/-/g, "");
          const boxIdHex = Array.from(new TextEncoder().encode(boxIdClean))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const rootWrappedHex = wasm.wasm_wrap_mailbox_key(rootHex, skHex, boxIdHex);

          newWrappedSkUser = JSON.stringify({
            salt: saltHex,
            envelope: passphraseEnvelope,
            root_wrapped: rootWrappedHex,
          });
        } catch (phraseErr) {
          console.warn("Could not unseal old key with recovery phrase, generating fresh keypair:", phraseErr);
        }
      }

      // If user did not provide recovery phrase, generate fresh keypair so mailbox works immediately
      if (!newWrappedSkUser) {
        const kpJson = wasm.wasm_generate_keypair();
        const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
        newMailboxPk = kp.public_key;

        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
        const passphraseEnvelope = wasm.wasm_passphrase_wrap_key(newPass, saltHex, kp.secret_key);

        newWrappedSkUser = JSON.stringify({
          salt: saltHex,
          envelope: passphraseEnvelope,
        });
      }

      await resetPasswordWithRecovery(token, code, newPass, newMailboxPk, newWrappedSkUser);
      setForgotStep(3);
      setLoginEmail(forgotEmail().trim());
      setLoginPassword(newPass);
    } catch (err: any) {
      setForgotError(err?.message || "Failed to reset password. Please verify your code and try again.");
    } finally {
      setForgotBusy(false);
    }
  }

  function base64URLToBuffer(base64URL: string): ArrayBuffer {
    const base64 = base64URL.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
    const raw = atob(base64 + pad);
    const buffer = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      buffer[i] = raw.charCodeAt(i);
    }
    return buffer.buffer as ArrayBuffer;
  }

  function bufferToBase64URL(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = "";
    for (let i = 0; i < bytes.length; i++) {
      str += String.fromCharCode(bytes[i]);
    }
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  }

  async function handlePasskeyLogin() {
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      setLoginError("Passkeys are not supported in this browser.");
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const email = loginEmail().trim() || undefined;
      const opts = await fetchPasskeyLoginOptions(email);

      const effectiveRpId =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? window.location.hostname
          : (opts.rpId || window.location.hostname);

      const allowCreds = opts.allowCredentials?.map((c) => ({
        id: base64URLToBuffer(c.id),
        type: "public-key" as const,
      }));

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: base64URLToBuffer(opts.challenge),
          rpId: effectiveRpId,
          userVerification: opts.userVerification as any,
          timeout: opts.timeout,
          allowCredentials: allowCreds && allowCreds.length > 0 ? allowCreds : undefined,
        },
      })) as PublicKeyCredential;

      if (!assertion) {
        throw new Error("Passkey login was cancelled.");
      }

      const credId = bufferToBase64URL(assertion.rawId);
      const resp = assertion.response as AuthenticatorAssertionResponse;
      const sigHex = Array.from(new Uint8Array(resp.signature), (b) => b.toString(16).padStart(2, "0")).join("");
      const clientDataB64 = bufferToBase64URL(resp.clientDataJSON);

      const loginRes = await loginWithPasskey({
        credential_id: credId,
        challenge_token: opts.challenge,
        signature: sigHex,
        client_data_json: clientDataB64,
      });

      setIsLoading(true);
      if (loginRes.token) {
        sessionStorage.setItem("byos_active_session_token", loginRes.token);
      }

      // Check local device vault for this passkey's unsealed mailbox key for 1-touch unlock
      let vaultData: { mailbox_id: string; mailbox_sk_hex: string; search_key_hex?: string } | null = null;
      if (typeof window !== "undefined") {
        const rawVault = localStorage.getItem(`byos_passkey_vault_${credId}`);
        if (rawVault) {
          try {
            vaultData = JSON.parse(rawVault);
          } catch {}
        }
      }

      if (vaultData && vaultData.mailbox_sk_hex) {
        try {
          const skBytes = new Uint8Array(vaultData.mailbox_sk_hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
          setMailboxKey(skBytes);
          if (vaultData.search_key_hex) setSearchKey(vaultData.search_key_hex);
          setUnlockedBoxId(vaultData.mailbox_id);
          sessionStorage.setItem("byos_mailbox_sk_" + vaultData.mailbox_id, vaultData.mailbox_sk_hex);
          if (vaultData.search_key_hex) {
            sessionStorage.setItem("byos_mailbox_skey_" + vaultData.mailbox_id, vaultData.search_key_hex);
          }
          let passkeySigningSeed: Uint8Array | null = null;
          const savedSigningSeed = (vaultData as any).signing_seed_hex || sessionStorage.getItem("byos_signing_seed_" + vaultData.mailbox_id);
          if (savedSigningSeed) {
            const seedBytes = new Uint8Array(savedSigningSeed.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
            setSigningSeed(seedBytes);
            sessionStorage.setItem("byos_signing_seed_" + vaultData.mailbox_id, savedSigningSeed);
            passkeySigningSeed = seedBytes;
          } else {
            setSigningSeed(null);
          }

          let passkeyXWingSeed: Uint8Array | null = null;
          const savedXWingSeed = (vaultData as any).xwing_seed_hex || sessionStorage.getItem("byos_xwing_seed_" + vaultData.mailbox_id);
          if (savedXWingSeed) {
            const seedBytes = new Uint8Array(savedXWingSeed.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
            setXwingSeed(seedBytes);
            sessionStorage.setItem("byos_xwing_seed_" + vaultData.mailbox_id, savedXWingSeed);
            passkeyXWingSeed = seedBytes;
          } else {
            setXwingSeed(null);
          }

          if (passkeySigningSeed && passkeyXWingSeed) {
            publishKeysOnce(vaultData.mailbox_id, passkeySigningSeed, passkeyXWingSeed);
          }
        } catch (vaultErr) {
          console.warn("Failed restoring mailbox key from passkey vault:", vaultErr);
        }
      }

      const user = await fetchCurrentUser();
      if (!user) throw new Error("Session was not established.");
      await bootstrapSession(user, undefined, loginRes.token);
    } catch (err: any) {
      setLoginError(err?.message || "Passkey login failed.");
    } finally {
      setLoginBusy(false);
      setIsLoading(false);
    }
  }

  async function handleUnlock(e: Event) {
    e.preventDefault();
    const user = currentUser();
    const password = loginPassword();
    if (!user || !password) {
      setLoginError("Enter your password.");
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const loginRes = await login(user.email, password);

      if (loginRes.two_factor_required) {
        setTwoFactorChallenge({
          challenge_token: loginRes.challenge_token || "",
          methods: loginRes.methods || ["email"],
          preferred_method: loginRes.preferred_method || "email",
          destination_masked: loginRes.destination_masked || "",
        });
        setSelected2FAMethod(loginRes.preferred_method || "email");
        setCachedPassword(password);
        setTwoFactorCodeInput("");
        setTwoFactorError(null);
        setLoginBusy(false);
        return;
      }

      setIsLoading(true);
      if (loginRes.token) {
        sessionStorage.setItem("byos_active_session_token", loginRes.token);
      }
      let targetWrappedSk = loginRes.wrapped_sk_user || user.wrapped_sk_user;

      // Self-healing: if an account has no active wrapped key material, generate and register a fresh keypair
      if (!targetWrappedSk && loginRes.mailbox_id) {
        try {
          const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
          const kpJson = wasm.wasm_generate_keypair();
          const kp = JSON.parse(kpJson) as { secret_key: string; public_key: string };
          const salt = new Uint8Array(16);
          crypto.getRandomValues(salt);
          const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
          const passphraseEnvelope = wasm.wasm_passphrase_wrap_key(password, saltHex, kp.secret_key);
          const healWrapped = JSON.stringify({
            salt: saltHex,
            envelope: passphraseEnvelope,
          });
          await reactivateHistoricalKeys(loginRes.mailbox_id, healWrapped, kp.public_key);
          targetWrappedSk = healWrapped;
        } catch (healErr) {
          console.warn("Self-healing mailbox key failed:", healErr);
        }
      }

      const targetUser = { ...user, wrapped_sk_user: targetWrappedSk };
      await bootstrapSession(targetUser, password, loginRes.token);
      if (!mailboxKey()) {
        throw new Error("Unable to unlock mailbox with this password. If your mailbox was created with a recovery phrase, use your recovery phrase below.");
      }
    } catch (err: any) {
      setLoginError(err?.message || "Invalid password.");
    } finally {
      setLoginPassword("");
      setLoginBusy(false);
      setIsLoading(false);
    }
  }

  async function handleUnlockWithRecovery(e: Event) {
    e.preventDefault();
    const user = currentUser();
    const phrase = recoveryPhraseInput().trim();
    if (!user || !phrase) {
      setLoginError("Enter your 24-word recovery phrase.");
      return;
    }
    setLoginBusy(true);
    setLoginError(null);
    try {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const box = selectedMailbox() || mailboxes()[0];
      if (!box) throw new Error("No mailbox found.");
      const wrappedSk = user.wrapped_sk_user || box.wrapped_sk_user;
      if (!wrappedSk) throw new Error("No encrypted key found for this mailbox.");

      const skBytes = unwrapMailboxKeyWithRecoveryPhrase(wasm, phrase, box.id, wrappedSk);
      const currentSkHex = Array.from(skBytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const currentSKey = wasm.wasm_derive_search_key(currentSkHex);
      setMailboxKey(skBytes);
      setSearchKey(currentSKey);
      setUnlockedBoxId(box.id);
      sessionStorage.setItem("byos_mailbox_sk_" + box.id, currentSkHex);
      sessionStorage.setItem("byos_mailbox_skey_" + box.id, currentSKey);

      const words = phrase.trim();
      const rootHex = /^[0-9a-fA-F]{64}$/.test(words)
        ? words
        : wasm.wasm_recover_root_secret(words);
      const boxIdHex = box.id.replace(/-/g, "").toLowerCase();
      let recoveredSigningSeed: Uint8Array | null = null;
      try {
        const seedHex = wasm.wasm_derive_signing_seed(rootHex, boxIdHex, 1);
        const seedBytes = new Uint8Array(seedHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        setSigningSeed(seedBytes);
        sessionStorage.setItem("byos_signing_seed_" + box.id, seedHex);
        recoveredSigningSeed = seedBytes;
      } catch (seedErr) {
        console.warn("Failed deriving signing seed from recovery root:", seedErr);
        setSigningSeed(null);
      }

      let recoveredXWingSeed: Uint8Array | null = null;
      try {
        const xwingSeedHex = wasm.wasm_derive_xwing_seed(rootHex, boxIdHex, 1);
        const xwingSeedBytes = new Uint8Array(xwingSeedHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        setXwingSeed(xwingSeedBytes);
        sessionStorage.setItem("byos_xwing_seed_" + box.id, xwingSeedHex);
        recoveredXWingSeed = xwingSeedBytes;
      } catch (seedErr) {
        console.warn("Failed deriving X-Wing seed from recovery root:", seedErr);
        setXwingSeed(null);
      }

      if (recoveredSigningSeed && recoveredXWingSeed) {
        publishKeysOnce(box.id, recoveredSigningSeed, recoveredXWingSeed);
      }

      await loadMailboxData(box.id);
    } catch (err: any) {
      setLoginError(err?.message || "Invalid recovery phrase or failed to unlock mailbox keys.");
    } finally {
      setRecoveryPhraseInput("");
      setLoginBusy(false);
    }
  }

  async function handleLogout(accountIdToLogout?: string | unknown, logOutAll: boolean = false) {
    const accounts = connectedAccounts();
    const currentBoxId = selectedMailbox()?.id || currentUser()?.id;
    const targetId = typeof accountIdToLogout === "string" ? accountIdToLogout : currentBoxId;

    // Full sign out if explicitly requested, or if only 1 account (or 0) connected
    if (logOutAll || !targetId || accounts.length <= 1) {
      sessionStorage.removeItem("byos_impersonation_token");
      sessionStorage.removeItem("byos_active_session_token");
      sessionStorage.removeItem("byos_connected_accounts");
      // Clear the session generation marker so the next login always starts fresh.
      sessionStorage.removeItem(SESSION_GENERATION_KEY);
      try {
        localStorage.removeItem("byos_connected_accounts");
        localStorage.removeItem(SESSION_GENERATION_KEY);
      } catch {}
      setConnectedAccounts([]);
      // Rule 3: comprehensive sweep of all byos_* sensitive keys.
      clearAllSensitiveSessionKeys();
      clearPersistentSession().catch(() => {});
      clearOfflineCache().catch(() => {});
      clearServiceWorkerCaches().catch(() => {});
      setIsImpersonating(false);
      try {
        await logout();
      } catch (err) {
        console.warn("Server logout failed, clearing local session anyway:", err);
      }
      lockMailbox();
      if (profilePhotoUrl()) {
        URL.revokeObjectURL(profilePhotoUrl()!);
        setProfilePhotoUrl(null);
      }
      setComposeOpen(false);
      clearComposeForm();
      setCurrentUser(null);
      setMailboxes([]);
      setSelectedMailbox(null);
      setMessages([]);
      refreshSignature(null);
      setLoginPassword("");
      setLoginError(null);
      return;
    }

    // MULTI-ACCOUNT SELECTIVE LOGOUT: Disconnect only the targeted account
    const targetAccount = accounts.find((a) => a.id === targetId);
    const targetEmail = targetAccount?.email || "Account";

    // 1. Rule 3: Remove ALL target account keys from sessionStorage using the
    // comprehensive helper (handles all byos_* prefixes for this account ID).
    clearAccountKeys(targetId);
    clearPersistentSession(targetId).catch(() => {});

    // 2. Best-effort server session revocation for target account
    if (targetAccount?.sessionToken) {
      try {
        await apiRequest("/v1/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${targetAccount.sessionToken}`,
          },
        });
      } catch {}
    }

    // 3. Filter target out of connected accounts and persist remaining
    const remaining = accounts.filter((a) => a.id !== targetId);
    setConnectedAccounts(remaining);
    sessionStorage.setItem("byos_connected_accounts", JSON.stringify(remaining));
    // Rule 4: localStorage stores ONLY stripped metadata (no tokens, no keys).
    persistAccountListForDisplay(remaining);

    // 4. Selection reset: if target was active account OR user was viewing All Inboxes with <= 1 account remaining,
    // smoothly switch to the first remaining account
    if ((targetId === currentBoxId || (currentFolder() === "unified_inbox" && remaining.length <= 1)) && remaining.length > 0) {
      await handleSwitchAccount(remaining[0]);
      showToast(`Signed out of ${targetEmail}. Switched to ${remaining[0].email}.`);
    } else if (currentFolder() === "unified_inbox" && remaining.length > 1) {
      loadUnifiedInboxMessages();
      showToast(`Signed out of ${targetEmail}.`);
    } else {
      showToast(`Signed out of ${targetEmail}.`);
    }
  }

  async function loadMailboxData(mailboxId: string) {
    try {
      setStorageErrorBanner(null);
      const [draftsList, messageList, scheduledList, folderList, labelList, attachmentList, threadList] = await Promise.all([
        fetchDrafts(mailboxId),
        fetchMessages(mailboxId),
        fetchMessages(mailboxId, "scheduled"),
        fetchFolders(mailboxId),
        fetchLabels(mailboxId),
        fetchAttachments(mailboxId),
        fetchThreads(mailboxId),
      ]);

      cacheInboxMessages(mailboxId, messageList).catch(() => {});
      fetchContacts(mailboxId).then(setContacts).catch(() => {});

      function deduplicateByName<T extends { id: string; name: string }>(items: T[]): T[] {
        const seen = new Set<string>();
        const res: T[] = [];
        for (const item of items) {
          const k = item.name.trim().toLowerCase();
          if (!seen.has(k)) {
            seen.add(k);
            res.push(item);
          }
        }
        return res;
      }

      setCustomFolders(deduplicateByName(folderList));
      setLabels(deduplicateByName(labelList));

      const attachmentsByMsgId = new Map<string, AttachmentItem[]>();
      for (const att of (attachmentList || [])) {
        if (att.message_id) {
          const existing = attachmentsByMsgId.get(att.message_id) || [];
          existing.push(att);
          attachmentsByMsgId.set(att.message_id, existing);
        }
      }

      function getAttachmentExt(filename: string): string {
        const ext = filename.split(".").pop()?.toUpperCase() || "";
        return ext.length > 4 ? ext.slice(0, 4) : ext;
      }

      const key = getMailboxKeyFor(mailboxId);
      const keyBoxId = key ? mailboxId : null;
      let wasm: typeof import("./generated/crypto-core/byos_crypto_core.js") | null = null;
      if (key && keyBoxId === mailboxId) {
        try {
          wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        } catch {
          wasm = null;
        }
      }

      const allApiMessages = [...messageList, ...(scheduledList || [])];
      const realMessages: DisplayMessage[] = allApiMessages.map((m: MessageMetadata) => {
        const isScheduled = m.folder === "scheduled";
        const cachedSubject = sessionStorage.getItem("byos_msg_subject_" + m.id);
        const cachedSnippet = sessionStorage.getItem("byos_msg_snippet_" + m.id);
        const msgAtts = attachmentsByMsgId.get(m.id) || [];
        const uniqueTypes = Array.from(
          new Set(
            msgAtts
              .map((a) => getAttachmentExt(a.filename))
              .filter(Boolean)
          )
        );
        const attCount = msgAtts.length > 0 ? msgAtts.length : (m.has_attachments ? 1 : 0);

        const draftRef = m.draft_storage_ref || (isScheduled ? m.storage_object_id : "");
        let subject = cachedSubject || "";
        let snippet = cachedSnippet || "";

        if (isScheduled) {
          if (!draftRef || !draftRef.startsWith("mailboxes/")) {
            subject = "[Scheduled message missing storage reference - this is a bug]";
            snippet = "[Scheduled message missing storage reference - this is a bug]";
            console.error("Scheduled message missing valid customer storage reference. Row ID:", m.id, "ref:", draftRef);
          } else if (cachedSubject) {
            subject = cachedSubject;
            snippet = cachedSnippet || `Scheduled send to ${m.recipients.join(", ")}`;
          } else if (key && wasm && keyBoxId === mailboxId) {
            subject = "(Scheduled message)";
            snippet = `Scheduled send to ${m.recipients.join(", ")}`;
            // Asynchronously fetch from customer storage and decrypt preview
            fetchScheduledDraft(mailboxId, m.id)
              .then(async (resp) => {
                try {
                  const text = decryptDraftEnvelope(wasm, key, mailboxId, resp.encrypted_envelope);
                  let parsedSubj = "";
                  let parsedBody = text;
                  try {
                    const parsed = JSON.parse(text);
                    if (parsed && typeof parsed === "object") {
                      if (parsed.subject) parsedSubj = parsed.subject;
                      if (parsed.body) parsedBody = parsed.body;
                    }
                  } catch {}
                  const finalSubj = parsedSubj || "(no subject)";
                  const finalSnippet = parsedBody.slice(0, 80) + (parsedBody.length > 80 ? "…" : "");
                  sessionStorage.setItem("byos_msg_subject_" + m.id, finalSubj);
                  sessionStorage.setItem("byos_msg_snippet_" + m.id, finalSnippet);
                  setMessages((prev) =>
                    prev.map((item) =>
                      item.id === m.id
                        ? { ...item, subject: finalSubj, snippet: finalSnippet }
                        : item
                    )
                  );
                } catch (decErr) {
                  console.error("Scheduled message preview decryption failed. Row ID:", m.id, "Error:", decErr);
                }
              })
              .catch((fetchErr) => {
                console.error("Scheduled message storage retrieval failed. Row ID:", m.id, "Error:", fetchErr);
              });
          } else {
            subject = "(Scheduled message)";
            snippet = `Scheduled send to ${m.recipients.join(", ")}`;
          }
        } else {
          if (!subject) subject = "(Encrypted message)";
          if (!snippet) snippet = `Encrypted payload • ${m.storage_object_id}`;
        }

        const initialCategory = resolveMessageCategory(
          m.id,
          m.category_override,
          subject && subject !== "(Encrypted message)" && subject !== "(Scheduled message)"
            ? {
                senderEmail: m.sender,
                subject,
                headers: {},
              }
            : {
                senderEmail: m.sender,
                subject: "",
                headers: {},
              }
        );

        return {
          id: m.id,
          messageId: m.id, // For attachment filtering
          messageSeq: m.message_seq,
          folder: (m.folder === "custom" ? "inbox" : (m.folder as Folder)) || (m.direction === "sent" ? "sent" : "inbox"),
          folderId: m.folder_id || null,
          labelIds: m.label_ids || [],
          sender: m.sender,
          recipient: (m.recipients || []).join(", "),
          recipients: m.recipients || [],
          subject,
          snippet,
          encryptedBody: isScheduled ? draftRef : m.storage_object_id,
          draftStorageRef: draftRef,
          scheduledAt: m.send_at || m.scheduled_at || m.sent_at || m.received_at,
          status: m.status,
          date: formatMessageDate(m.send_at || m.scheduled_at || m.sent_at || m.received_at, timeFormat(), language()),
          read: isScheduled ? true : (m.is_read ?? false),
          starred: m.is_starred ?? false,
          snoozedUntil: m.snoozed_until,
          isRealApi: true,
          hasAttachments: m.has_attachments || msgAtts.length > 0,
          attachmentCount: attCount,
          attachmentTypes: uniqueTypes,
          mailboxId: mailboxId,
          accountEmail: currentUser()?.email,
          replyViaAlias: m.reply_via_alias,
          aliasLabel: m.alias_label,
          category: initialCategory,
          categoryOverride: m.category_override,
        };
      });
      const draftMessages: DisplayMessage[] = draftsList.map((d: DraftMessage) => {
        let snippet = "Encrypted draft — unlock mailbox to preview.";
        if (key && wasm && keyBoxId === mailboxId && d.encrypted_envelope) {
          try {
            const text = decryptDraftEnvelope(wasm, key, mailboxId, d.encrypted_envelope);
            snippet = text.slice(0, 80) + (text.length > 80 ? "…" : "");
          } catch {
            snippet = "Encrypted draft (decryption failed).";
          }
        } else if (!d.encrypted_envelope) {
          snippet = "Draft payload…";
        }
        return {
          id: d.id,
          version: d.version,
          folder: "drafts",
          sender: currentUser()?.email || "me@byos.local",
          recipient: d.recipient || "(no recipient)",
          recipients: d.recipient ? d.recipient.split(",").map((s) => s.trim()).filter(Boolean) : [],
          subject: d.subject || "(no subject)",
          snippet,
          encryptedBody: d.encrypted_envelope || "Encrypted draft envelope",
          date: formatMessageDate(d.created_at, timeFormat(), language()),
          read: true,
          starred: false,
          isRealApi: true,
          sendFailed: d.send_failed,
          mailboxId: mailboxId,
          accountEmail: currentUser()?.email,
        };
      });

      setMessages([...realMessages, ...draftMessages]);
      setThreads(threadList);

      // Background preview decryptor for visible real messages
      if (key && wasm && keyBoxId === mailboxId) {
        (async () => {
          for (const m of realMessages) {
            if (m.folder === "scheduled") continue;
            if (
              sessionStorage.getItem("byos_msg_subject_" + m.id) &&
              sessionStorage.getItem("byos_msg_category_" + m.id)
            )
              continue;
            try {
              const body = await fetchMessageBody(mailboxId, m.id);
              saveCachedMessageBody(mailboxId, m.id, body).catch(() => {});
              let plaintext = "";
              const mKeys = getMailboxKeyForMessage(m);
              if (body.xwing_envelope_json && body.xwing_envelope_json.trim()) {
                if (mKeys?.xwingSeedHex) {
                  const seed = new Uint8Array(mKeys.xwingSeedHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
                  const res = await decryptPathAEnvelope(body.xwing_envelope_json, m.sender, seed);
                  plaintext = res.plaintext;
                }
              } else if (body.encrypted_body && (!body.content_key_hpke_wrapped || body.content_key_hpke_wrapped === "")) {
                const rawDraft = decryptDraftEnvelope(wasm!, key!, mailboxId, body.encrypted_body);
                try {
                  const parsed = JSON.parse(rawDraft);
                  if (parsed && typeof parsed === "object") {
                    plaintext = `Subject: ${parsed.subject || ""}\r\n\r\n${parsed.body || ""}`;
                  } else {
                    plaintext = rawDraft;
                  }
                } catch {
                  plaintext = rawDraft;
                }
              } else if (m.messageSeq !== undefined && body.content_key_hpke_wrapped) {
                plaintext = decryptMessageEnvelope(wasm!, key!, mailboxId, {
                  message_seq: m.messageSeq!,
                  encryption_version: body.encryption_version,
                  encrypted_body: body.encrypted_body,
                  content_key_hpke_wrapped: body.content_key_hpke_wrapped,
                });
              }
              if (plaintext) {
                let sub = m.subject;
                const subMatch = plaintext.match(/^Subject:\s*(.*)$/im);
                if (subMatch && subMatch[1]) sub = subMatch[1].trim();
                const bodyParts = plaintext.split(/\r?\n\r?\n/);
                const rawHeaders = bodyParts.length > 0 ? bodyParts[0] : "";
                const parsedHeaders = parseRawHeaders(rawHeaders);
                const bodyText = bodyParts.length > 1 ? bodyParts.slice(1).join("\n\n") : plaintext;
                const snip = bodyText.trim().slice(0, 100).replace(/\s+/g, " ");

                const cat = resolveMessageCategory(
                  m.id,
                  m.categoryOverride,
                  {
                    senderEmail: extractSenderEmail(parsedHeaders["from"], m.sender),
                    subject: sub,
                    headers: parsedHeaders,
                  }
                );

                sessionStorage.setItem("byos_msg_subject_" + m.id, sub);
                sessionStorage.setItem("byos_msg_snippet_" + m.id, snip);
                sessionStorage.setItem("byos_msg_category_" + m.id, cat);

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === m.id ? { ...msg, subject: sub, snippet: snip, category: cat } : msg
                  )
                );
              }
            } catch (err) {
              console.error("Preview decrypt error for msg " + m.id + ":", err);
            }
          }
        })();
      }

      // Load appearance preferences and regional settings
      fetchMailboxSettings(mailboxId)
        .then((s) => {
          if (s.density) {
            setDensity(s.density);
            if (typeof window !== "undefined") localStorage.setItem("byos_density", s.density);
          }
          if (s.layout_mode) {
            setLayoutMode(s.layout_mode);
            if (typeof window !== "undefined") localStorage.setItem("byos_layout", s.layout_mode);
          }
          if (s.theme) {
            handleSetTheme(s.theme, false);
          }
          if (s.language) {
            setLanguage(s.language);
            if (typeof window !== "undefined") localStorage.setItem("byos_language", s.language);
          }
          if (s.time_format) {
            setTimeFormat(s.time_format as "12h" | "24h");
            if (typeof window !== "undefined") localStorage.setItem("byos_time_format", s.time_format);
          }
          if (s.week_start) {
            setWeekStart(s.week_start as "sunday" | "monday" | "saturday");
            if (typeof window !== "undefined") localStorage.setItem("byos_week_start", s.week_start);
          }
          if (s.signature_plain !== undefined) {
            saveSignature(mailboxId, s.signature_plain);
          }
          if (s.signature_html !== undefined) {
            saveSignatureHtml(mailboxId, s.signature_html);
          }
          if (selectedMailbox()?.id === mailboxId) {
            refreshSignature(mailboxId);
          }
        })
        .catch(() => {});

      // Fetch tracking list for sent message read receipts
      fetchTrackingList(mailboxId)
        .then((trackList) => {
          if (!trackList || trackList.length === 0) return;
          const trackBySubjAndTo = new Map<string, MessageTrackingItem>();
          const trackByToken = new Map<string, MessageTrackingItem>();
          for (const item of trackList) {
            if (item.tracking_token) trackByToken.set(item.tracking_token, item);
            const key = `${(item.subject || "").trim().toLowerCase()}:::${(item.recipient || "").trim().toLowerCase()}`;
            trackBySubjAndTo.set(key, item);
          }
          setMessages((prev) =>
            prev.map((m) => {
              const matched =
                (m.trackingToken ? trackByToken.get(m.trackingToken) : undefined) ||
                trackBySubjAndTo.get(`${(m.subject || "").trim().toLowerCase()}:::${(m.recipient || "").trim().toLowerCase()}`);
              if (matched) {
                return {
                  ...m,
                  trackingToken: matched.tracking_token,
                  trackingInfo: {
                    openCount: matched.open_count,
                    firstOpenedAt: matched.first_opened_at,
                    lastOpenedAt: matched.last_opened_at,
                  },
                };
              }
              return m;
            })
          );
        })
        .catch(() => {});
    } catch (err: any) {
      console.warn("Error loading mailbox data:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (isOffline() || msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("offline")) {
        try {
          const [cached, offlineDrafts] = await Promise.all([
            getCachedInbox(mailboxId).catch(() => []),
            getOfflineDrafts(mailboxId).catch(() => []),
          ]);
          const draftDisplayMsgs: DisplayMessage[] = (offlineDrafts || []).map((d) => ({
            id: d.id,
            version: 1,
            folder: "drafts",
            sender: currentUser()?.email || "me@byos.local",
            recipient: d.recipient || "(no recipient)",
            recipients: d.recipient ? d.recipient.split(",").map((s) => s.trim()).filter(Boolean) : [],
            subject: d.subject || "Untitled Draft",
            snippet: (d.bodyHtml || d.body).replace(/<[^>]+>/g, "").slice(0, 80) + "…",
            bodyPlaintext: d.body || d.bodyHtml,
            bodyHtml: d.bodyHtml || d.body,
            encryptedBody: d.encrypted_envelope || "",
            date: "Just now",
            read: true,
            starred: false,
            isRealApi: true,
            mailboxId: mailboxId,
          }));
          const cachedDisplay: DisplayMessage[] = (cached || []).map((m: MessageMetadata) => {
            const cachedSubject = sessionStorage.getItem("byos_msg_subject_" + m.id) || m.subject || "";
            const cachedSnippet = sessionStorage.getItem("byos_msg_snippet_" + m.id) || "";
            return {
              id: m.id,
              messageId: m.id,
              messageSeq: m.message_seq,
              folder: (m.folder as Folder) || "inbox",
              folderId: m.folder_id || null,
              labelIds: m.label_ids || [],
              sender: m.sender,
              recipient: (m.recipients || []).join(", "),
              recipients: m.recipients || [],
              subject: cachedSubject,
              snippet: cachedSnippet,
              encryptedBody: m.storage_object_id,
              status: m.status,
              date: formatMessageDate(m.received_at, timeFormat(), language()),
              read: m.is_read ?? false,
              starred: m.is_starred ?? false,
              isRealApi: true,
              hasAttachments: m.has_attachments,
              attachmentCount: m.attachment_count,
              mailboxId: mailboxId,
              accountEmail: currentUser()?.email,
            };
          });
          setMessages([...draftDisplayMsgs, ...cachedDisplay]);
          return;
        } catch (cacheErr) {
          console.warn("[offline] Failed to load cached inbox or drafts:", cacheErr);
        }
      }
      if (msg.includes("503") || msg.includes("storage_disconnected") || msg.includes("storage disconnected")) {
        setStorageErrorBanner("Mailbox storage is currently disconnected or unreachable. Inbound emails are held safely at the mail transfer agent and will deliver automatically once storage is reconnected.");
      }
      const isAuth = err?.status === 401 || err?.status === 403 || msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("Unauthorized");
      if (err?.status === 401 || msg.includes("401") || msg.includes("unauthorized") || msg.includes("Unauthorized")) {
        // Rule 5: Distinguish "session expired" from "unauthorized".
        // Name the specific account and remove it from the sidebar. Do not show generic "unauthorized". Do not retry.
        const acc = connectedAccounts().find((a) => a.id === mailboxId);
        const email = acc?.email || currentUser()?.email || "your account";
        setGlobalError(formatSessionExpiredError(email), true);

        // Remove that account from the sidebar if multi-account, or purge persistent session
        if (connectedAccounts().length > 1 && acc) {
          const remaining = removeStaleAccount(mailboxId, connectedAccounts());
          setConnectedAccounts(remaining);
          clearPersistentSession(mailboxId).catch(() => {});
          if ((selectedMailbox()?.id === mailboxId || (currentFolder() === "unified_inbox" && remaining.length <= 1)) && remaining.length > 0) {
            handleSwitchAccount(remaining[0]);
          }
        } else {
          clearPersistentSession().catch(() => {});
        }
      } else {
        setGlobalError(`Failed to load mailbox data: ${msg}`, isAuth);
      }
    }
  }

  async function loadUnifiedInboxMessages() {
    try {
      setStorageErrorBanner(null);
      let accounts = connectedAccounts();
      if (accounts.length === 0) {
        const box = selectedMailbox();
        const user = currentUser();
        if (box && user) {
          accounts = [{
            id: box.id,
            email: user.email,
            displayName: user.display_name || box.local_part || user.email.split("@")[0],
            sessionToken: sessionStorage.getItem("byos_active_session_token") || "",
            role: "owner",
            privacyMode: "standard",
            mailboxSkHex: sessionStorage.getItem("byos_mailbox_sk_" + box.id) || "",
            searchKeyHex: sessionStorage.getItem("byos_mailbox_skey_" + box.id) || "",
          }];
        }
      }
      if (accounts.length === 0) {
        setMessages([]);
        return;
      }

      const results = await Promise.all(
        accounts.map(async (acc) => {
          try {
            const [msgs, atts] = await Promise.all([
              fetchMessages(acc.id, "inbox", acc.sessionToken),
              fetchAttachments(acc.id, acc.sessionToken).catch(() => []),
            ]);
            return { account: acc, messages: msgs, attachments: atts };
          } catch (err) {
            console.warn(`Failed fetching messages for ${acc.email}:`, err);
            return { account: acc, messages: [] as MessageMetadata[], attachments: [] as AttachmentItem[] };
          }
        })
      );

      const counts: Record<string, number> = {};
      for (const res of results) {
        counts[res.account.id] = res.messages.filter((m) => !m.is_read).length;
      }
      setAccountUnreadCounts(counts);

      const merged = mergeUnifiedMessages(results, timeFormat(), language());
      const visible = filterUnifiedMessages(merged, excludedAccountIds());
      setMessages(visible);

      // Background preview decryptor for visible messages across accounts
      let wasm: typeof import("./generated/crypto-core/byos_crypto_core.js") | null = null;
      try {
        wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      } catch {
        wasm = null;
      }

      if (wasm) {
        (async () => {
          for (const m of visible) {
            if (
              sessionStorage.getItem("byos_msg_subject_" + m.id) &&
              sessionStorage.getItem("byos_msg_category_" + m.id)
            )
              continue;
            const accId = m.mailboxId;
            if (!accId) continue;
            const acc = accounts.find((a) => a.id === accId);
            const token = acc?.sessionToken;
            const savedSk = sessionStorage.getItem("byos_mailbox_sk_" + accId) || acc?.mailboxSkHex;
            if (!savedSk) continue;
            let key: Uint8Array | null = null;
            try {
              key = new Uint8Array(savedSk.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
            } catch {
              continue;
            }

            try {
              const body = await fetchMessageBody(accId, m.id, token);
              let plaintext = "";
              if (body.xwing_envelope_json && body.xwing_envelope_json.trim()) {
                const savedXWing = sessionStorage.getItem("byos_xwing_seed_" + accId);
                if (savedXWing) {
                  const seed = new Uint8Array(savedXWing.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
                  const res = await decryptPathAEnvelope(body.xwing_envelope_json, m.sender, seed);
                  plaintext = res.plaintext;
                }
              } else if (body.encrypted_body && (!body.content_key_hpke_wrapped || body.content_key_hpke_wrapped === "")) {
                const rawDraft = decryptDraftEnvelope(wasm!, key!, accId, body.encrypted_body);
                try {
                  const parsed = JSON.parse(rawDraft);
                  if (parsed && typeof parsed === "object") {
                    plaintext = `Subject: ${parsed.subject || ""}\r\n\r\n${parsed.body || ""}`;
                  } else {
                    plaintext = rawDraft;
                  }
                } catch {
                  plaintext = rawDraft;
                }
              } else if (m.messageSeq !== undefined && body.content_key_hpke_wrapped) {
                plaintext = decryptMessageEnvelope(wasm!, key!, accId, {
                  message_seq: m.messageSeq!,
                  encryption_version: body.encryption_version,
                  encrypted_body: body.encrypted_body,
                  content_key_hpke_wrapped: body.content_key_hpke_wrapped,
                });
              }

              if (plaintext) {
                let sub = m.subject;
                const subMatch = plaintext.match(/^Subject:\s*(.*)$/im);
                if (subMatch && subMatch[1]) sub = subMatch[1].trim();
                const bodyParts = plaintext.split(/\r?\n\r?\n/);
                const rawHeaders = bodyParts.length > 0 ? bodyParts[0] : "";
                const parsedHeaders = parseRawHeaders(rawHeaders);
                const bodyText = bodyParts.length > 1 ? bodyParts.slice(1).join("\n\n") : plaintext;
                const snip = bodyText.trim().slice(0, 100).replace(/\s+/g, " ");

                const cat = resolveMessageCategory(
                  m.id,
                  m.categoryOverride,
                  {
                    senderEmail: extractSenderEmail(parsedHeaders["from"], m.sender),
                    subject: sub,
                    headers: parsedHeaders,
                  }
                );

                sessionStorage.setItem("byos_msg_subject_" + m.id, sub);
                sessionStorage.setItem("byos_msg_snippet_" + m.id, snip);
                sessionStorage.setItem("byos_msg_category_" + m.id, cat);

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === m.id ? { ...msg, subject: sub, snippet: snip, category: cat } : msg
                  )
                );
              }
            } catch {}
          }
        })();
      }
    } catch (err) {
      console.warn("Error loading unified inbox data:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setGlobalError(`Failed to load unified inbox: ${msg}`);
    }
  }

  function lockMailbox() {
    setMailboxKey(null);
    setSigningSeed(null);
    setXwingSeed(null);
    setSearchKey(null);
    setServerMatchedMsgIds([]);
    setUnlockedBoxId(null);
    setSelectedIds(new Set<string>());
    setCurrentPage(1);
    setSelectedMsg(null);
    setDecryptedContent(null);
    setEditablePlaintext(null);
    setMessagePlaintext(null);
    setEditingDraft(null);
    setContacts([]);
    setContactsOpen(false);
    setCustomFolders([]);
    setLabels([]);
    setActiveCustomFolder(null);
    setActiveLabel(null);
  }

  const activeLabelSubtreeIds = () => {
    const lbl = activeLabel();
    if (!lbl) return new Set<string>();
    return new Set(getSubtreeLabelIds(lbl.id, labels()));
  };

  const filteredMessages = () => {
    const q = searchQuery().toLowerCase().trim();
    const matchedIds = new Set(serverMatchedMsgIds());
    const now = Date.now();
    return messages().filter((m) => {
      const isSnoozed = Boolean(m.snoozedUntil && new Date(m.snoozedUntil).getTime() > now);
      const cur = currentFolder();

      if (cur === "unified_inbox" && m.mailboxId && excludedAccountIds().includes(m.mailboxId)) {
        return false;
      }

      if (cur === "snoozed") {
        if (!isSnoozed) return false;
      } else if (isSnoozed && m.folder !== "sent" && m.folder !== "trash") {
        return false;
      }

      let matchFolder = false;
      const customFolder = activeCustomFolder();
      const label = activeLabel();

      if (cur === "snoozed") {
        matchFolder = true;
      } else if (customFolder) {
        matchFolder = m.folderId === customFolder.id && m.folder !== "trash";
      } else if (label) {
        const subtreeIds = activeLabelSubtreeIds();
        matchFolder = Boolean(m.labelIds?.some((lid) => subtreeIds.has(lid))) && m.folder !== "trash";
      } else {
        if (cur === "inbox") {
          const isInbox = (!m.folderId || m.folderId === "") && (!m.folder || m.folder === "inbox");
          if (!isInbox) {
            matchFolder = false;
          } else if (focusedInboxEnabled()) {
            matchFolder = (m.category || "primary") === focusedCategory();
          } else {
            matchFolder = true;
          }
        } else if (cur === "unified_inbox") {
          matchFolder = (!m.folderId || m.folderId === "") && (!m.folder || m.folder === "inbox");
        } else {
          matchFolder = m.folder === cur;
        }
      }

      if (!q) return matchFolder;
      const localMatch =
        m.sender.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.snippet.toLowerCase().includes(q);
      const serverTokenMatch = matchedIds.has(m.id) || (m.messageId ? matchedIds.has(m.messageId) : false);
      return matchFolder && (localMatch || serverTokenMatch);
    });
  };

  const sortedMessages = () => {
    const list = [...filteredMessages()];
    const order = sortOrder();
    if (order === "newest") {
      return list.sort((a, b) => new Date(b.scheduledAt || b.date).getTime() - new Date(a.scheduledAt || a.date).getTime());
    }
    if (order === "oldest") {
      return list.sort((a, b) => new Date(a.scheduledAt || a.date).getTime() - new Date(b.scheduledAt || b.date).getTime());
    }
    if (order === "unread") {
      return list.sort((a, b) => {
        if (a.read === b.read) {
          return new Date(b.scheduledAt || b.date).getTime() - new Date(a.scheduledAt || a.date).getTime();
        }
        return a.read ? 1 : -1;
      });
    }
    return list;
  };

  const paginatedMessages = () => {
    const list = sortedMessages();
    const start = (currentPage() - 1) * pageSize;
    return list.slice(start, start + pageSize);
  };

  const supportsThreading = () => {
    const cur = currentFolder();
    return cur !== "drafts" && cur !== "scheduled";
  };

  const filteredThreads = () => {
    const cur = currentFolder();
    if (!supportsThreading()) return [];

    const activeCust = activeCustomFolder();
    const activeLbl = activeLabel();
    const q = searchQuery().toLowerCase().trim();
    const now = Date.now();
    const allMsgs = messages();

    return threads().filter((t) => {
      const isSnoozed = Boolean(
        (t.snoozed_until && new Date(t.snoozed_until).getTime() > now) ||
        allMsgs.some((m) => t.message_ids?.includes(m.id) && m.snoozedUntil && new Date(m.snoozedUntil).getTime() > now)
      );

      if (cur === "snoozed") {
        if (!isSnoozed) return false;
      } else if (isSnoozed && t.folder !== "sent" && t.folder !== "trash") {
        return false;
      }

      if (activeCust) {
        const hasCustomMsg = allMsgs.some((m) => t.message_ids?.includes(m.id) && m.folderId === activeCust.id);
        if (!hasCustomMsg) return false;
      } else if (activeLbl) {
        const subtreeIds = activeLabelSubtreeIds();
        const hasLabelMsg = allMsgs.some((m) => t.message_ids?.includes(m.id) && m.labelIds?.some((lid) => subtreeIds.has(lid)));
        if (!hasLabelMsg) return false;
      } else if (cur !== "snoozed") {
        const hasFolderMsg = (t.folder || "inbox") === cur || allMsgs.some((m) => t.message_ids?.includes(m.id) && m.folder === cur);
        if (!hasFolderMsg) return false;
        if (cur === "inbox" && focusedInboxEnabled()) {
          const threadMsgs = allMsgs.filter((m) => t.message_ids?.includes(m.id));
          const latestMsg = threadMsgs[threadMsgs.length - 1];
          const cat = latestMsg?.category || "primary";
          if (cat !== focusedCategory()) return false;
        }
      }

      if (!q) return true;
      const matchParticipant = (t.participants || []).some((p) => p.toLowerCase().includes(q));
      const matchMsg = allMsgs.some(
        (m) =>
          t.message_ids?.includes(m.id) &&
          (m.subject.toLowerCase().includes(q) || m.snippet.toLowerCase().includes(q))
      );
      return matchParticipant || matchMsg;
    });
  };

  const categoryCounts = () => {
    const allMsgs = messages();
    const now = Date.now();
    const counts: Record<FocusedCategory, { total: number; unread: number }> = {
      primary: { total: 0, unread: 0 },
      notifications: { total: 0, unread: 0 },
      newsletters: { total: 0, unread: 0 },
      social: { total: 0, unread: 0 },
    };
    for (const m of allMsgs) {
      const isSnoozed = Boolean(m.snoozedUntil && new Date(m.snoozedUntil).getTime() > now);
      if (isSnoozed) continue;
      const isInbox = (!m.folderId || m.folderId === "") && (!m.folder || m.folder === "inbox");
      if (!isInbox) continue;
      const cat = (m.category || "primary") as FocusedCategory;
      if (counts[cat]) {
        counts[cat].total++;
        if (!m.read) counts[cat].unread++;
      }
    }
    return counts;
  };

  const handleMoveToCategory = (msg: DisplayMessage, category: FocusedCategory) => {
    setMessageCategoryOverride(msg.id, category);
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem("byos_msg_category_" + msg.id, category);
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, category } : m))
    );
    showToast(`Moved to ${category.charAt(0).toUpperCase() + category.slice(1)}`);
  };

  const effectiveViewMode = () =>
    supportsThreading() && viewMode() === "threads" && filteredThreads().length > 0 ? "threads" : "flat";

  const currentMsgIndex = () => {
    const sel = selectedMsg();
    if (!sel) return -1;
    return sortedMessages().findIndex((m) => m.id === sel.id);
  };

  const hasPrevMessage = () => currentMsgIndex() > 0;
  const hasNextMessage = () => {
    const idx = currentMsgIndex();
    return idx >= 0 && idx < sortedMessages().length - 1;
  };

  function handlePrevMessage() {
    const idx = currentMsgIndex();
    if (idx > 0) {
      openMessage(sortedMessages()[idx - 1]);
    }
  }

  function handleNextMessage() {
    const idx = currentMsgIndex();
    if (idx >= 0 && idx < sortedMessages().length - 1) {
      openMessage(sortedMessages()[idx + 1]);
    }
  }

  createEffect(() => {
    const q = searchQuery().trim();
    if (!q) {
      setServerMatchedMsgIds([]);
      return;
    }
    const keywords = extractKeywords(q);
    if (keywords.length === 0) {
      setServerMatchedMsgIds([]);
      return;
    }
    const isUnified = currentFolder() === "unified_inbox";
    let cancelled = false;
    setIsSearchingTokens(true);
    (async () => {
      try {
        const matched = new Set<string>();
        if (isUnified) {
          const accounts = connectedAccounts();
          await Promise.all(
            accounts.map(async (acc) => {
              if (excludedAccountIds().includes(acc.id)) return;
              const sKey = sessionStorage.getItem("byos_mailbox_skey_" + acc.id) || acc.searchKeyHex || (unlockedBoxId() === acc.id ? searchKey() : null);
              if (!sKey) return;
              for (const kw of keywords) {
                if (cancelled) return;
                try {
                  const tokenHex = await computeSearchToken(sKey, kw);
                  if (cancelled) return;
                  const ids = await searchMailboxTokens(acc.id, tokenHex, acc.sessionToken);
                  if (cancelled) return;
                  for (const id of ids) matched.add(id);
                } catch {}
              }
            })
          );
        } else {
          const sKey = searchKey();
          const box = selectedMailbox();
          if (!sKey || !box) {
            if (!cancelled) setServerMatchedMsgIds([]);
            return;
          }
          for (const kw of keywords) {
            const tokenHex = await computeSearchToken(sKey, kw);
            if (cancelled) return;
            const ids = await searchMailboxTokens(box.id, tokenHex);
            if (cancelled) return;
            for (const id of ids) matched.add(id);
          }
        }
        if (!cancelled) {
          setServerMatchedMsgIds(Array.from(matched));
        }
      } catch (err) {
        console.error("Token search error:", err);
      } finally {
        if (!cancelled) setIsSearchingTokens(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  async function handleDownloadAttachment(att: AttachmentItem) {
    const selected = selectedMsg();
    const targetBoxId = att.mailbox_id || (selected as any)?.mailbox_id || selected?.mailboxId || selectedMailbox()?.id;
    if (!targetBoxId) return;
    const targetAcc = connectedAccounts().find((a) => a.id === targetBoxId);
    const targetToken = targetAcc?.sessionToken || sessionStorage.getItem("byos_active_session_token") || undefined;
    const keyMaterial = getMailboxKeyForMessage(selected || { mailboxId: targetBoxId });

    setDownloadingAttachment(att.id);
    try {
      if (att.isPathA && att.envelope) {
        if (!keyMaterial?.xwingSeedHex) {
          alert(`Please unlock ${targetAcc?.email || "mailbox"} to load your X-Wing key to decrypt this attachment.`);
          return;
        }
        if (!selected) return;

        const chunkCount = att.envelope.chunk_count || att.envelope.chunks.length;
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < chunkCount; i++) {
          const chunkBytes = await fetchMessageAttachmentChunk(
            targetBoxId,
            selected.id,
            att.envelope.attachment_id,
            i,
            targetToken,
          );
          chunks.push(chunkBytes);
        }

        const result = await decryptPathAAttachment(
          att.envelope,
          chunks,
          keyMaterial.xwingSeedHex,
          targetBoxId,
        );

        if (result.isCorrupted || !result.data) {
          alert(`Attachment "${att.filename}" is corrupted or could not be decrypted.`);
          return;
        }

        const blob = new Blob([result.data.buffer as ArrayBuffer], {
          type: result.mimeType || att.content_type,
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = att.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }

      if (keyMaterial?.mailboxSkHex) {
        const key = new Uint8Array(keyMaterial.mailboxSkHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        // Decrypt locally with the unlocked mailbox key.
        const decrypted = await downloadAndDecryptAttachment(targetBoxId, att.id, key, targetToken);
        const url = URL.createObjectURL(decrypted);
        const a = document.createElement("a");
        a.href = url;
        a.download = att.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return;
      }
      const encryptedBlob = await downloadAttachment(targetBoxId, att.id, targetToken);
      // Locked: hand over the still-encrypted bytes explicitly marked as such.
      const url = URL.createObjectURL(encryptedBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename + ".encrypted";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      alert(
        `Attachment downloaded as encrypted file (${att.filename}.encrypted).\n\n` +
        `Sign in again to download decrypted files.`
      );
    } catch (err) {
      console.error("Failed to download attachment:", err);
      alert(`Failed to download attachment: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setDownloadingAttachment(null);
    }
  }

  let currentDecryptSeq = 0;
  async function openMessage(msg: DisplayMessage) {
    const seq = ++currentDecryptSeq;
    setSelectedMsg(msg);
    setIsDecrypting(true);
    setDecryptedContent(null);
    setEditablePlaintext(null);
    setMessagePlaintext(null);
    setMessageAttachments([]);
    setSenderVerification(null);

    const targetBoxId = (msg as any).mailbox_id || msg.mailboxId || selectedMailbox()?.id;
    if (!targetBoxId) {
      if (seq === currentDecryptSeq) {
        setDecryptedContent("No mailbox selected.");
        setIsDecrypting(false);
      }
      return;
    }
    const targetAcc = connectedAccounts().find((a) => a.id === targetBoxId);
    const targetEmail = msg.accountEmail || targetAcc?.email || (targetBoxId === selectedMailbox()?.id ? currentUser()?.email : undefined) || "account";
    const targetToken = targetAcc?.sessionToken || sessionStorage.getItem("byos_active_session_token") || undefined;

    // Rule 1 & Rule 2: Resolve key material strictly using owning mailbox ID
    const keyMaterial = getMailboxKeyForMessage(msg);
    if (!keyMaterial || (!keyMaterial.xwingSeedHex && !keyMaterial.mailboxSkHex)) {
      if (seq === currentDecryptSeq) {
        setIsDecrypting(false);
        setLockedReadingAccount({ mailboxId: targetBoxId, email: targetEmail });
        setDecryptedContent(`Unlock ${targetEmail} to read this message.`);
      }
      return;
    }
    setLockedReadingAccount(null);

    // Mark as read (optimistic + persist)
    if (!msg.read && msg.folder !== "scheduled") {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
      );
      setThreads((prev) =>
        prev.map((t) => {
          if (t.message_ids?.includes(msg.id)) {
            return { ...t, unread_count: Math.max(0, t.unread_count - 1) };
          }
          return t;
        })
      );
      setMessageRead(targetBoxId, msg.id, true, targetToken).catch(() => {});
    }

    try {
      if (msg.folder === "scheduled") {
        if (!keyMaterial.mailboxSkHex) {
          if (seq === currentDecryptSeq) {
            setDecryptedContent(`Mailbox ${targetEmail} secret key is locked. Unlock ${targetEmail} to read this message.`);
            setLockedReadingAccount({ mailboxId: targetBoxId, email: targetEmail });
            setIsDecrypting(false);
          }
          return;
        }
        const key = new Uint8Array(keyMaterial.mailboxSkHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        const draftRef = msg.draftStorageRef || msg.encryptedBody;
        if (!draftRef || !draftRef.startsWith("mailboxes/")) {
          if (seq === currentDecryptSeq) {
            setDecryptedContent("[Scheduled message missing storage reference - this is a bug]");
            console.error("Scheduled message missing valid customer storage reference. Row ID:", msg.id, "ref:", draftRef);
            setIsDecrypting(false);
          }
          return;
        }
        const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        try {
          const resp = await fetchScheduledDraft(targetBoxId, msg.id, targetToken);
          const plaintext = decryptDraftEnvelope(wasm, key, targetBoxId, resp.encrypted_envelope);
          let bodyText = plaintext;
          let parsedSubject = "";
          try {
            const parsed = JSON.parse(plaintext);
            if (parsed && typeof parsed === "object") {
              if (parsed.body) bodyText = parsed.body;
              if (parsed.subject) parsedSubject = parsed.subject;
            }
          } catch {}
          if (parsedSubject) {
            sessionStorage.setItem("byos_msg_subject_" + msg.id, parsedSubject);
          }
          sessionStorage.setItem("byos_msg_snippet_" + msg.id, bodyText.slice(0, 80));
          if (seq === currentDecryptSeq) {
            setDecryptedContent(bodyText);
            setEditablePlaintext(bodyText);
            setIsDecrypting(false);
          }
        } catch (err: any) {
          console.error("Scheduled message retrieval or decryption failed. Row ID:", msg.id, "Ref:", draftRef, "ErrorType:", err?.name || "DecryptError", err);
          if (seq === currentDecryptSeq) {
            setDecryptedContent("[Scheduled message could not be decrypted]");
            setIsDecrypting(false);
          }
        }
        return;
      }

      // Drafts live outside message_metadata: decrypt the stored envelope
      // directly instead of fetching a message body (which would 404).
      if (msg.folder === "drafts") {
        if (!keyMaterial.mailboxSkHex) {
          if (seq === currentDecryptSeq) {
            setDecryptedContent(`Mailbox ${targetEmail} secret key is locked. Unlock ${targetEmail} to read this message.`);
            setLockedReadingAccount({ mailboxId: targetBoxId, email: targetEmail });
            setIsDecrypting(false);
          }
          return;
        }
        const key = new Uint8Array(keyMaterial.mailboxSkHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        const plaintext = decryptDraftEnvelope(wasm, key, targetBoxId, msg.encryptedBody);
        if (seq === currentDecryptSeq) {
          setDecryptedContent(plaintext);
          setEditablePlaintext(plaintext);
          setIsDecrypting(false);
        }
        return;
      }
      let body: MessageBodyResponse;
      let allAttachments: AttachmentItem[] = [];
      let pathAEnvelopes: AttachmentEnvelope[] = [];
      try {
        const [b, atts, pAtts] = await Promise.all([
          fetchMessageBody(targetBoxId, msg.id, targetToken),
          fetchAttachments(targetBoxId, targetToken).catch(() => []),
          fetchMessageAttachmentEnvelopes(targetBoxId, msg.id, targetToken).catch(() => []),
        ]);
        body = b;
        allAttachments = atts;
        pathAEnvelopes = pAtts;
        saveCachedMessageBody(targetBoxId, msg.id, body).catch(() => {});
      } catch (fetchErr: unknown) {
        const cachedBody = await getCachedMessageBody(msg.id).catch(() => undefined);
        if (cachedBody) {
          body = cachedBody;
        } else {
          const errText = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          throw new Error(`Failed to decrypt end-to-end message: storage fetch: ${errText}`);
        }
      }

      if (seq !== currentDecryptSeq) return;

      let msgAttachments: AttachmentItem[] = [];
      if (pathAEnvelopes && pathAEnvelopes.length > 0) {
        msgAttachments = pathAEnvelopes.map((env) => ({
          id: env.attachment_id,
          mailbox_id: targetBoxId,
          message_id: msg.id,
          filename: env.filename,
          content_type: env.mime_type,
          size_bytes: env.size_bytes,
          byte_size: env.size_bytes,
          encrypted: true,
          created_at: new Date().toISOString(),
          isPathA: true,
          envelope: env,
        }));
      } else {
        // Fetch attachments for this message - use stable msg.id with fallback for legacy messageId
        const targetId = msg.messageId ?? msg.id;
        msgAttachments = allAttachments.filter((a) => {
          const attMessageId = a.message_id ?? (a as unknown as { messageId?: string }).messageId;
          return attMessageId != null && attMessageId !== "" && attMessageId === targetId;
        });
      }

      if (seq === currentDecryptSeq) {
        setMessageAttachments(msgAttachments);
      }

      let plaintext: string;
      if (body.xwing_envelope_json && body.xwing_envelope_json.trim()) {
        if (!keyMaterial.xwingSeedHex) {
          throw new Error(
            `Failed to decrypt end-to-end message: key unwrap: Mailbox ${targetEmail} X-Wing private key is locked. Unlock ${targetEmail} to read this message.`
          );
        }
        const seed = new Uint8Array(keyMaterial.xwingSeedHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        const result = await decryptPathAEnvelope(
          body.xwing_envelope_json,
          msg.sender,
          seed,
        );
        plaintext = result.plaintext;
        if (seq === currentDecryptSeq) {
          setSenderVerification({
            verified: result.senderVerified,
            error: result.senderVerifyError,
          });
        }
      } else {
        // Decrypt locally when unlocked. The key, phrase, and plaintext never
        // leave the browser; failures show a generic message, never key material.
        if (!keyMaterial.mailboxSkHex || msg.messageSeq === undefined) {
          if (seq === currentDecryptSeq) {
            setDecryptedContent(`Mailbox ${targetEmail} secret key is locked. Unlock ${targetEmail} to read this message.`);
            setLockedReadingAccount({ mailboxId: targetBoxId, email: targetEmail });
            setIsDecrypting(false);
          }
          return;
        }
        const key = new Uint8Array(keyMaterial.mailboxSkHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        if (body.encrypted_body && (!body.content_key_hpke_wrapped || body.content_key_hpke_wrapped === "")) {
          const rawDraft = decryptDraftEnvelope(wasm, key, targetBoxId, body.encrypted_body);
          try {
            const parsed = JSON.parse(rawDraft);
            if (parsed && typeof parsed === "object") {
              if (parsed.bodyHtml) {
                plaintext = `Subject: ${parsed.subject || ""}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${parsed.bodyHtml}`;
              } else {
                plaintext = `Subject: ${parsed.subject || ""}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${parsed.body || ""}`;
              }
            } else {
              plaintext = rawDraft;
            }
          } catch {
            plaintext = rawDraft;
          }
        } else {
          plaintext = decryptMessageEnvelope(wasm, key, targetBoxId, {
            message_seq: msg.messageSeq,
            encryption_version: body.encryption_version,
            encrypted_body: body.encrypted_body,
            content_key_hpke_wrapped: body.content_key_hpke_wrapped,
          });
        }
      }

      let extractedSubject = msg.subject;
      const headerEnd = plaintext.search(/\r?\n\r?\n/);
      const rawHeaders = headerEnd !== -1 ? plaintext.slice(0, headerEnd) : "";
      const headerSubject = getHeader(rawHeaders, "subject");
      if (headerSubject) {
        extractedSubject = headerSubject.trim();
      } else {
        const subMatch = plaintext.match(/^Subject:\s*(.*)$/im);
        if (subMatch && subMatch[1]) {
          extractedSubject = subMatch[1].trim();
        }
      }

      const parsed = parseMime(plaintext);
      const displayContent = parsed.textHtml || parsed.textPlain || plaintext;
      const quoteContent = parsed.textPlain || parsed.textHtml || plaintext;

      const extractedSnippet = quoteContent.trim().slice(0, 100).replace(/\s+/g, " ");

      sessionStorage.setItem("byos_msg_subject_" + msg.id, extractedSubject);
      sessionStorage.setItem("byos_msg_snippet_" + msg.id, extractedSnippet);

      const updatedMsg: DisplayMessage = {
        ...msg,
        subject: extractedSubject,
        snippet: extractedSnippet || msg.snippet,
        read: true,
      };

      if (seq === currentDecryptSeq) {
        setSelectedMsg(updatedMsg);
        setMessages((prev) =>
          prev.map((m) => (m.id === msg.id ? updatedMsg : m))
        );
        setDecryptedContent(displayContent);
        setMessagePlaintext(quoteContent);
        setIsDecrypting(false);
      }

      // Asynchronously index search tokens for this message under search_key (Section 16).
      // Only HMAC-SHA256 tokens reach the server; plaintext terms never leave the browser.
      const sKey = searchKey();
      if (sKey) {
        const textToIndex = `${msg.subject} ${plaintext}`;
        const keywords = extractKeywords(textToIndex);
        (async () => {
          for (const kw of keywords) {
            try {
              const tokenHex = await computeSearchToken(sKey, kw);
              await indexSearchToken(targetBoxId, msg.id, tokenHex, targetToken);
            } catch {
              // Non-blocking indexing
            }
          }
        })();
      }
    } catch (err) {
      if (seq !== currentDecryptSeq) return;
      console.error("Failed to open message:", err);
      const msgStr = err instanceof Error ? err.message : String(err);
      if (msgStr.includes("503") || msgStr.includes("storage_disconnected") || msgStr.includes("storage disconnected")) {
        setStorageErrorBanner("Mailbox storage is currently disconnected or unreachable. Inbound emails are held safely at the mail transfer agent and will deliver automatically once storage is reconnected.");
      }
      setDecryptedContent(
        `Failed to open message: ${err instanceof Error ? err.message : "unknown error"}`
      );
      setIsDecrypting(false);
    }
  }

  async function handlePerformUnlockAccount(e?: Event) {
    if (e) e.preventDefault();
    const target = unlockAccountTarget();
    const password = unlockAccountPassword();
    if (!target || !password) return;

    setUnlockAccountBusy(true);
    setUnlockAccountError(null);
    try {
      let wrappedSk = "";
      let sessionToken = "";

      try {
        const loginRes = await login(target.email, password);
        wrappedSk = loginRes.wrapped_sk_user || "";
        sessionToken = loginRes.token || "";
      } catch (loginErr) {
        if (currentUser()?.email.toLowerCase() === target.email.toLowerCase() && currentUser()?.wrapped_sk_user) {
          wrappedSk = currentUser()!.wrapped_sk_user!;
        } else if (selectedMailbox()?.id === target.mailboxId && selectedMailbox()?.wrapped_sk_user) {
          wrappedSk = selectedMailbox()!.wrapped_sk_user!;
        } else {
          throw loginErr;
        }
      }

      if (!wrappedSk) {
        throw new Error("No wrapped encryption keys found for this account.");
      }

      // Rule 3: Single shared unseal function
      const unwrapped = await unsealAccountKeys(target.mailboxId, password, wrappedSk);
      const skBytes = unwrapped.mailboxSk;
      const currentSkHex = bytesToHex(skBytes);
      const currentSKey = unwrapped.searchKeyHex;

      let xwingSeedHex = "";
      if (unwrapped.xwingSeed) {
        xwingSeedHex = bytesToHex(unwrapped.xwingSeed);
      }

      let signingSeedHex = "";
      if (unwrapped.signingSeed) {
        signingSeedHex = bytesToHex(unwrapped.signingSeed);
      }

      if (unwrapped.signingSeed && unwrapped.xwingSeed) {
        publishKeysOnce(target.mailboxId, unwrapped.signingSeed, unwrapped.xwingSeed);
      }

      setConnectedAccounts((prev) =>
        prev.map((a) => {
          if (a.id === target.mailboxId || (a.email && a.email.toLowerCase() === target.email.toLowerCase())) {
            return {
              ...a,
              sessionToken: sessionToken || a.sessionToken,
              mailboxSkHex: currentSkHex,
              searchKeyHex: currentSKey,
              xwingSeedHex: xwingSeedHex || a.xwingSeedHex,
              signingSeedHex: signingSeedHex || a.signingSeedHex,
              isLocked: false,
            };
          }
          return a;
        })
      );

      // Rule 1: If switch was requested for this account, complete switch to target account
      const pending = pendingSwitchAccount();
      if (pending && (pending.id === target.mailboxId || pending.email.toLowerCase() === target.email.toLowerCase())) {
        setPendingSwitchAccount(null);
        setUnlockAccountTarget(null);
        setUnlockAccountPassword("");
        showToast(`Unlocked ${target.email}`);
        await handleSwitchAccount({
          ...pending,
          sessionToken: sessionToken || pending.sessionToken,
          mailboxSkHex: currentSkHex,
          searchKeyHex: currentSKey,
          xwingSeedHex: xwingSeedHex || pending.xwingSeedHex,
          signingSeedHex: signingSeedHex || pending.signingSeedHex,
          isLocked: false,
        });
        return;
      }

      if (selectedMailbox()?.id === target.mailboxId) {
        setMailboxKey(skBytes);
        setSearchKey(currentSKey);
        setUnlockedBoxId(target.mailboxId);
        if (unwrapped.xwingSeed) setXwingSeed(unwrapped.xwingSeed);
        if (unwrapped.signingSeed) setSigningSeed(unwrapped.signingSeed);
      }

      if (lockedReadingAccount()?.mailboxId === target.mailboxId) {
        setLockedReadingAccount(null);
      }
      setUnlockAccountTarget(null);
      setUnlockAccountPassword("");
      showToast(`Unlocked ${target.email}`);

      // Auto retry decrypting the currently selected message (Rule 2)
      const currentMsg = selectedMsg();
      if (currentMsg && ((currentMsg as any).mailbox_id === target.mailboxId || currentMsg.mailboxId === target.mailboxId)) {
        openMessage(currentMsg);
      }
    } catch (err) {
      setUnlockAccountError(err instanceof Error ? err.message : "Invalid password or failed to unlock keys");
    } finally {
      setUnlockAccountBusy(false);
    }
  }

  async function handleSelectThread(threadId: string) {
    setExpandedThreadId((prev) => (prev === threadId ? null : threadId));
    const box = selectedMailbox();
    if (!box) return;

    // V1 Simplification: open the latest message in the thread directly in the reading pane.
    // Full multi-message accordion view in the reading pane is deferred to V1.1.
    const thread = threads().find((t) => t.thread_id === threadId);
    let targetMsg: DisplayMessage | undefined;

    if (thread && thread.message_ids && thread.message_ids.length > 0) {
      const threadMsgs = messages().filter((m) => thread.message_ids.includes(m.id));
      if (threadMsgs.length > 0) {
        targetMsg = threadMsgs[threadMsgs.length - 1];
      }
    }

    if (!targetMsg) {
      try {
        const metas = await fetchThreadMessages(box.id, threadId);
        if (metas.length > 0) {
          const latestMeta = metas[metas.length - 1];
          targetMsg = messages().find((m) => m.id === latestMeta.id);
        }
      } catch (err) {
        console.warn("Failed to fetch thread messages:", err);
      }
    }

    if (targetMsg) {
      await openMessage(targetMsg);
    }
  }

  async function handleAttachmentSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const boxId = composeAccountId() || selectedMailbox()?.id;
    const box = boxId ? (mailboxes().find((b) => b.id === boxId) || selectedMailbox()) : selectedMailbox();
    const key = box ? getMailboxKeyFor(box.id) : null;
    // Attachments must be encrypted with the real per-mailbox key before
    // transit. Without an unlocked mailbox there is no key, so refuse —
    // never fall back to a constant or fabricated key.
    if (!box || !key) {
      input.value = ""; // reset
      setErrorMessage(
        "Sign in again to attach files."
      );
      setComposeStatus(null);
      return;
    }
    const file = input.files?.[0];
    input.value = ""; // reset; the encrypted upload below carries the bytes
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) {
      setErrorMessage("Attachment exceeds the 40 MB V1 budget.");
      return;
    }
    setComposeStatus("Encrypting attachment…");
    try {
      const uploaded = await uploadEncryptedAttachment(box.id, file, key);
      uploaded.rawFile = file;
      setComposeAttachments((prev) => [...prev, uploaded]);
      setComposeStatus(null);
    } catch (err) {
      setErrorMessage(
        `Failed to upload attachment: ${err instanceof Error ? err.message : "unknown error"}`
      );
      setComposeStatus(null);
    }
  }

  function removeComposeAttachment(id: string) {
    const box = selectedMailbox();
    const target = composeAttachments().find((a) => a.id === id);
    // Server-persisted uploads must be destroyed row+object, not merely
    // detached — otherwise every removed file lingers as an orphaned blob.
    // On failure the item stays attached (and stays linked at send) with an
    // error, so removal is never silently half-done.
    if (box && target) {
      deleteAttachment(box.id, id)
        .then(() => setComposeAttachments((prev) => prev.filter((a) => a.id !== id)))
        .catch((err) => {
          setErrorMessage(
            `Failed to delete attachment (kept attached): ${err instanceof Error ? err.message : "unknown error"}`
          );
        });
      return;
    }
    setComposeAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function openContacts() {
    setContactsOpen(true);
  }

  function clearComposeForm() {
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeBodyHtml("");
    setScheduledTime("");
    setComposeTrackOpens(false);
    setComposeAttachments([]);
    setEditingDraft(null);
    setEditingScheduledId(null);
    setComposeSignatureApplied(false);
    setComposeAccountId(null);
    setComposeFromAlias(null);
    setErrorMessage(null);
    setComposeStatus(null);
  }

  function startNewCompose() {
    clearComposeForm();
    const accounts = connectedAccounts();
    const activeBox = selectedMailbox();
    const defaultAccId = (activeBox?.id) || (accounts.length > 0 ? accounts[0].id : null);
    if (defaultAccId) {
      setComposeAccountId(defaultAccId);
      const sigPlain = loadSignature(defaultAccId);
      const sigHtml = loadSignatureHtml(defaultAccId);
      if (sigPlain) {
        setComposeBody(`\n\n-- \n${sigPlain}`);
      }
      if (sigHtml) {
        setComposeBodyHtml(
          `<p><br></p><div class="byos-signature"><p>-- </p>${sigHtml}</div>`,
        );
      }
      if (sigPlain || sigHtml) {
        setComposeSignatureApplied(true);
      }
    }
    refreshMaskedAliases();
    setComposeOpen(true);
  }

  function startEditDraft(msg: DisplayMessage, plaintext: string) {
    clearComposeForm();
    setComposeTo(msg.recipient === "(no recipient)" ? "" : msg.recipient);
    setComposeSubject(msg.subject === "(no subject)" ? "" : msg.subject);
    setComposeBody(plaintext);
    if (msg.bodyHtml) {
      setComposeBodyHtml(msg.bodyHtml);
    } else if (plaintext.includes("<") && plaintext.includes(">")) {
      setComposeBodyHtml(plaintext);
    }
    setScheduledTime("");
    setComposeAttachments([]);
    setEditingDraft({ id: msg.id, version: msg.version ?? 1 });
    const targetBoxId = msg.mailboxId || selectedMailbox()?.id;
    if (targetBoxId) setComposeAccountId(targetBoxId);
    const sigPlain = targetBoxId ? loadSignature(targetBoxId) : "";
    const hasSig = sigPlain ? plaintext.includes(`-- \n${sigPlain}`) : false;
    setComposeSignatureApplied(hasSig);
    setComposeOpen(true);
  }

  // NOTE: no Reply All — the send API accepts exactly one recipient per
  // message, so a multi-recipient reply-all would either silently drop
  // recipients or submit a malformed bundle. Single reply + forward only.
  function withSubjectPrefix(subject: string, prefix: "Re:" | "Fwd:"): string {
    const clean = subject === "(Encrypted message)" ? "" : subject;
    if (new RegExp(`^${prefix}\\s`, "i").test(clean)) return clean;
    return clean ? `${prefix} ${clean}` : prefix;
  }

  function quoteOriginal(msg: DisplayMessage, plaintext: string): string {
    const quoted = plaintext
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    return `\n\n--- On ${msg.date}, ${msg.sender} wrote: ---\n${quoted}`;
  }

  function startReply(msg: DisplayMessage) {
    const plaintext = messagePlaintext();
    if (plaintext === null) return;
    clearComposeForm();
    if (msg.replyViaAlias) {
      setComposeFromAlias(msg.replyViaAlias);
    }
    const replyBoxId = msg.mailboxId || selectedMailbox()?.id || null;
    if (replyBoxId) {
      setComposeAccountId(replyBoxId);
      const savedSeed = getSigningSeedFor(replyBoxId);
      if (!savedSeed) {
        const acc = connectedAccounts().find((a) => a.id === replyBoxId);
        const name = acc?.email || "account";
        showToast(`Unlock ${name} to reply`);
      }
    }
    const sigPlain = replyBoxId ? loadSignature(replyBoxId) : "";
    const sigHtml = replyBoxId ? loadSignatureHtml(replyBoxId) : "";
    const quotedPlain = quoteOriginal(msg, plaintext);

    setComposeTo(msg.sender);
    setComposeSubject(withSubjectPrefix(msg.subject, "Re:"));
    if (sigPlain) {
      setComposeBody(`${quotedPlain}\n\n-- \n${sigPlain}`);
    } else {
      setComposeBody(quotedPlain);
    }

    const quoteHtml = formatQuotedHtml(quotedPlain);
    if (sigHtml) {
      setComposeBodyHtml(`${quoteHtml}<div class="byos-signature"><br>-- <br>${sigHtml}</div>`);
    } else {
      setComposeBodyHtml(quoteHtml);
    }

    setScheduledTime("");
    setComposeAttachments([]);
    setEditingDraft(null);
    if (sigPlain || sigHtml) {
      setComposeSignatureApplied(true);
    }
    refreshMaskedAliases();
    setComposeOpen(true);
  }

  function startForward(msg: DisplayMessage) {
    const plaintext = messagePlaintext();
    if (plaintext === null) return;
    // Body-only forward in V1: the original's attachments are separate
    // storage objects and are not re-attached. Say so when there are any,
    // instead of dropping them silently.
    const attachNote =
      messageAttachments().length > 0
        ? `[Note: ${messageAttachments().length} original attachment(s) not carried by forwarding in V1.]\n\n`
        : "";
    clearComposeForm();
    const fwdBoxId = msg.mailboxId || selectedMailbox()?.id || null;
    if (fwdBoxId) {
      setComposeAccountId(fwdBoxId);
      const savedSeed = getSigningSeedFor(fwdBoxId);
      if (!savedSeed) {
        const acc = connectedAccounts().find((a) => a.id === fwdBoxId);
        const name = acc?.email || "account";
        showToast(`Unlock ${name} to forward`);
      }
    }
    const sigPlain = fwdBoxId ? loadSignature(fwdBoxId) : "";
    const sigHtml = fwdBoxId ? loadSignatureHtml(fwdBoxId) : "";
    const fwdContent = `${attachNote}--- Forwarded message from ${msg.sender} (${msg.date}) ---\n${plaintext}`;
    const quotedPlain = `\n\n${fwdContent}`;

    setComposeTo("");
    setComposeSubject(withSubjectPrefix(msg.subject, "Fwd:"));
    if (sigPlain) {
      setComposeBody(`${quotedPlain}\n\n-- \n${sigPlain}`);
    } else {
      setComposeBody(quotedPlain);
    }

    const quoteHtml = formatQuotedHtml(fwdContent);
    if (sigHtml) {
      setComposeBodyHtml(`${quoteHtml}<div class="byos-signature"><br>-- <br>${sigHtml}</div>`);
    } else {
      setComposeBodyHtml(quoteHtml);
    }

    setScheduledTime("");
    setComposeAttachments([]);
    setEditingDraft(null);
    if (sigPlain || sigHtml) {
      setComposeSignatureApplied(true);
    }
    setComposeOpen(true);
  }

  function prepareSendPayload(): PendingSend | null {
    const boxId = composeAccountId() || selectedMailbox()?.id;
    if (!boxId) return null;
    return buildPendingSendPayload({
      to: composeTo(),
      subject: composeSubject(),
      body: composeBody(),
      bodyHtml: sanitizeOnSend(composeBodyHtml()),
      boxId: boxId,
      signatureApplied: composeSignatureApplied(),
      sigPlain: loadSignature(boxId),
      sigHtml: loadSignatureHtml(boxId),
      attachments: composeAttachments(),
      scheduledTime: scheduledTime(),
      trackOpens: composeTrackOpens(),
      fromAlias: composeFromAlias() || undefined,
    });
  }

  function restoreComposeFromPayload(payload: PendingSend) {
    if (payload.mailboxId) {
      setComposeAccountId(payload.mailboxId);
    }
    restoreComposeState(payload, {
      setTo: setComposeTo,
      setSubject: setComposeSubject,
      setBody: setComposeBody,
      setBodyHtml: setComposeBodyHtml,
      setAttachments: setComposeAttachments,
      setScheduledTime: setScheduledTime,
      setTrackOpens: setComposeTrackOpens,
      setSignatureApplied: setComposeSignatureApplied,
      setFromAlias: setComposeFromAlias,
      setOpen: setComposeOpen,
    });
  }

  let undoIntervalTimer: any = null;

  function showUndoToast(payload: PendingSend) {
    const toastId = payload.id;
    if (undoIntervalTimer) {
      clearInterval(undoIntervalTimer);
      undoIntervalTimer = null;
    }

    const initialRemaining = Math.max(1, Math.ceil((payload.expiresAt - Date.now()) / 1000));

    addToast({
      id: toastId,
      message: `Sending in ${initialRemaining}…`,
      action: {
        label: "Undo",
        onClick: () => {
          if (undoIntervalTimer) {
            clearInterval(undoIntervalTimer);
            undoIntervalTimer = null;
          }
          setPendingSend(null);
          try {
            sessionStorage.removeItem("byos_pending_send");
          } catch {}
          removeToast(toastId);
          restoreComposeFromPayload(payload);
        },
      },
    });

    undoIntervalTimer = setInterval(() => {
      const remaining = Math.ceil((payload.expiresAt - Date.now()) / 1000);
      if (remaining <= 0) {
        clearInterval(undoIntervalTimer);
        undoIntervalTimer = null;
        removeToast(toastId);
        setPendingSend(null);
        try {
          sessionStorage.removeItem("byos_pending_send");
        } catch {}
        executeSend(payload);
      } else {
        updateToast(toastId, `Sending in ${remaining}…`);
      }
    }, 250);
  }

  async function executeSend(payload: PendingSend) {
    const matchingAccount = connectedAccounts().find((a) => a.id === payload.mailboxId);
    const box: Mailbox = mailboxes().find((b) => b.id === payload.mailboxId) ||
      (matchingAccount ? {
        id: matchingAccount.id,
        local_part: matchingAccount.email.split("@")[0],
        domain_id: "",
        mode: matchingAccount.privacyMode,
      } : (selectedMailbox()?.id === payload.mailboxId ? selectedMailbox()! : { id: payload.mailboxId, local_part: "", domain_id: "", mode: "org_managed" }));
    if (!box || !box.id) return;

    setComposeStatus("Preparing encrypted message…");
    try {
      const to = payload.recipient;
      const subject = payload.subject;
      const signedBody = payload.bodyPlaintext;
      const htmlBody = sanitizeOnSend(payload.bodyHtml);

      let trackingToken: string | undefined;
      if (payload.trackOpens) {
        trackingToken = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID().replace(/-/g, "")
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
        try {
          await registerTracking(box.id, trackingToken, subject, to);
        } catch (trackErr) {
          console.warn("Failed to register tracking token:", trackErr);
          trackingToken = undefined;
        }
      }

      const senderFrom = payload.fromAlias || matchingAccount?.email || (currentUser()?.email ? currentUser()!.email : (box?.local_part ? `${box.local_part}@byos.local` : undefined));
      const mimeMessage = buildMimeString({
        to,
        subject,
        signedBody,
        htmlBody,
        trackingToken,
        body: signedBody,
        from: senderFrom,
        replyTo: senderFrom,
      });

      if (isOffline()) {
        const clientQueueId = (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : "cq-" + Date.now();

        let sealedPathA = false;
        let envJson = "";
        let senderEnvJson = "";
        const singleRec = !to.includes(",") && !to.includes(";");
        const sSeed = getSigningSeedFor(payload.mailboxId);
        const sXwing = getXWingSeedFor(payload.mailboxId);

        if (singleRec && sSeed && sXwing) {
          try {
            const recRecord = await lookupMailboxKeys(to).catch(() => null);
            if (recRecord && recRecord.status === "active" && recRecord.xwing_public_key) {
              const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
              const bytes = base64ToBytes(recRecord.xwing_public_key);
              const xwingPkHex = bytesToHex(bytes);
              const plaintextHex = bytesToHex(new TextEncoder().encode(mimeMessage));
              const signingSeedHex = bytesToHex(sSeed);
              envJson = wasm.wasm_seal_xwing_envelope_signed(
                xwingPkHex,
                recRecord.key_id,
                recRecord.key_epoch,
                plaintextHex,
                signingSeedHex,
              );
              const senderXwingPkHex = wasm.wasm_xwing_public_key_from_seed(bytesToHex(sXwing));
              senderEnvJson = wasm.wasm_seal_xwing_envelope_signed(
                senderXwingPkHex,
                box.id,
                1,
                plaintextHex,
                signingSeedHex,
              );
              sealedPathA = true;
            }
          } catch {}
        }

        await enqueueSend({
          client_queue_id: clientQueueId,
          mailbox_id: box.id,
          recipient: to,
          payload: sealedPathA ? {
            envelope_json: envJson,
            sender_envelope_json: senderEnvJson,
            alias_id: payload.fromAlias,
            sender_email: senderFrom,
          } : {
            mime_message: mimeMessage,
            envelope_json: "",
            sender_email: senderFrom,
            alias_id: payload.fromAlias,
          },
          is_path_a: sealedPathA,
        });

        showToast("You are offline. Message queued to send on reconnect.");
        setComposeStatus(null);
        return;
      }

      // Path A routing
      const hasAttachments = (payload.attachments || []).length > 0;
      const isScheduled = Boolean(payload.scheduledTime);
      // Rule 2 & Rule 5: Resolve keys strictly from the payload's sending account (From:), never global signal
      const senderSeed = getSigningSeedFor(payload.mailboxId);
      const senderXwing = getXWingSeedFor(payload.mailboxId);

      const singleRecipient = !to.includes(",") && !to.includes(";");

      if (!isScheduled && singleRecipient && senderSeed && senderXwing) {
        setComposeStatus("Delivering via end-to-end encrypted Path A…");

        let recipientAttEnvelopes: AttachmentEnvelope[] | undefined;
        let senderAttEnvelopes: AttachmentEnvelope[] | undefined;

        if (hasAttachments) {
          // Check recipient key directory first to ensure Path A is eligible before preparing/uploading chunks
          let recRecord: KeyDirectoryRecord | null = null;
          try {
            recRecord = await lookupMailboxKeys(to);
          } catch {
            recRecord = null;
          }

          if (recRecord && recRecord.status === "active" && recRecord.xwing_public_key && recRecord.key_id) {
            // Verify size budget
            const totalAttBytes = (payload.attachments || []).reduce(
              (sum, a) => sum + (a.size_bytes || a.byte_size || 0),
              0,
            );
            if (totalAttBytes > MAX_ATTACHMENT_SIZE) {
              setErrorMessage("Total attachments exceed 40 MB maximum size limit.");
              setComposeStatus(null);
              showToast("Attachments exceed 40 MB limit.");
              return;
            }

            setComposeStatus("Encrypting attachments for recipient…");
            const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
            const senderXwingPkHex = wasm.wasm_xwing_public_key_from_seed(bytesToHex(senderXwing));
            const recXwingBytes = base64ToBytes(recRecord.xwing_public_key);
            const recXwingPkHex = bytesToHex(recXwingBytes);

            recipientAttEnvelopes = [];
            senderAttEnvelopes = [];

            const key = getMailboxKeyFor(box.id);

            for (const att of payload.attachments || []) {
              let fileData: Uint8Array;
              if (att.rawFile) {
                fileData = new Uint8Array(await att.rawFile.arrayBuffer());
              } else if (key) {
                const blob = await downloadAndDecryptAttachment(box.id, att.id, key);
                fileData = new Uint8Array(await blob.arrayBuffer());
              } else {
                throw new Error("Cannot read attachment data for Path A encryption");
              }

              const prep = await preparePathAAttachment({
                file: { name: att.filename, type: att.content_type, data: fileData },
                senderMailboxId: box.id,
                recipientMailboxId: recRecord.key_id,
                recipientXWingPkHex: recXwingPkHex,
                senderXWingPkHex: senderXwingPkHex,
              });

              // Upload recipient chunks to storage
              for (const ch of prep.recipientChunks) {
                await uploadAttachmentChunk(box.id, ch.storageRef, ch.data);
              }
              // Upload sender Sent chunks to storage
              for (const ch of prep.senderChunks) {
                await uploadAttachmentChunk(box.id, ch.storageRef, ch.data);
              }

              recipientAttEnvelopes.push(prep.recipientEnvelope);
              senderAttEnvelopes.push(prep.senderEnvelope);
            }
          }
        }

        const senderAccount = connectedAccounts().find((a) => a.id === payload.mailboxId);
        const sendToken = senderAccount?.sessionToken || (payload.mailboxId === selectedMailbox()?.id ? sessionStorage.getItem("byos_active_session_token") || undefined : undefined);

        const result = await tryPathASend({
          recipient: to,
          senderMailboxId: box.id,
          mimeMessage,
          signingSeed: senderSeed,
          senderXwingSeed: senderXwing,
          attachmentEnvelopes: recipientAttEnvelopes,
          senderAttachmentEnvelopes: senderAttEnvelopes,
          token: sendToken,
        });

        if (result.kind === "sent") {
          setComposeStatus("Message delivered securely.");
          showToast("Message sent.");
          loadMailboxData(box.id).catch((err) => {
            console.warn("Failed to refresh mailbox after send:", err);
          });
          return;
        }

        if (result.kind === "failed") {
          setErrorMessage(
            `Internal encrypted delivery failed: ${result.error}. Message was not sent.`,
          );
          setComposeStatus(null);
          showToast(`Send failed: ${result.error}`);
          return;
        }

        // kind === "fallback" → fall through to Path B
        setComposeStatus("Preparing encrypted message…");
      }

      // Path A scheduling: if the send is scheduled, has no attachments, and
      // the recipient is a BYOS X-Wing user, pre-seal the envelope now.
      // This preserves E2E encryption for scheduled messages.
      let schedDraftRef = "";
      if (payload.scheduledTime) {
        const key = getMailboxKeyFor(box.id);
        if (!key) {
          setErrorMessage("Your mailbox key is locked. Unlock it to schedule this message.");
          setComposeStatus(null);
          showToast("Your mailbox key is locked. Unlock it to schedule this message.");
          return;
        }
        try {
          const wasmDraft = await import("./generated/crypto-core/byos_crypto_core.js");
          const draftPayload = JSON.stringify({
            to,
            subject: subject || "(no subject)",
            body: signedBody,
            bodyHtml: htmlBody,
            attachments: payload.attachments || [],
          });
          schedDraftRef = encryptDraftEnvelope(wasmDraft, key, box.id, draftPayload);
        } catch (e) {
          console.error("[SCHEDULE_ERROR] Failed to encrypt scheduled draft envelope:", e);
        }
      }

      if (payload.scheduledTime && !schedDraftRef) {
        setErrorMessage("Failed to encrypt scheduled message envelope. Message was not scheduled.");
        setComposeStatus(null);
        showToast("Scheduling failed: Could not encrypt draft payload");
        return;
      }

      if (editingScheduledId() && payload.scheduledTime) {
        setComposeStatus("Updating scheduled message…");
        await updateScheduledMessage(box.id, editingScheduledId()!, {
          scheduled_at: new Date(payload.scheduledTime).toISOString(),
          draft_envelope: schedDraftRef,
          draft_storage_ref: schedDraftRef,
          subject: subject || "(no subject)",
        });
        setEditingScheduledId(null);
        setComposeStatus("Scheduled send updated.");
        setComposeOpen(false);
        clearComposeForm();
        showToast("Scheduled send updated.");
        loadMailboxData(box.id).catch((err) => {
          console.warn("Failed to refresh mailbox after update:", err);
        });
        return;
      }

      if (editingScheduledId() && !payload.scheduledTime) {
        try {
          await cancelScheduledMessage(box.id, editingScheduledId()!);
        } catch (cancelErr) {
          console.warn("Failed to cancel scheduled message during immediate send:", cancelErr);
        }
        setEditingScheduledId(null);
      }

      if (payload.scheduledTime && singleRecipient && senderSeed && senderXwing) {
        try {
          const record = await lookupMailboxKeys(to);
          if (
            record?.status === "active" &&
            record.xwing_public_key &&
            record.key_id &&
            record.key_epoch
          ) {
            const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
            const xwingPkBytes = base64ToBytes(record.xwing_public_key);
            if (xwingPkBytes.length === 1216) {
              const envelopeJson = wasm.wasm_seal_xwing_envelope_signed(
                bytesToHex(xwingPkBytes),
                record.key_id,
                record.key_epoch,
                bytesToHex(new TextEncoder().encode(mimeMessage)),
                bytesToHex(senderSeed),
              );

              let recipientAttEnvelopes: AttachmentEnvelope[] | undefined;
              let senderAttEnvelopes: AttachmentEnvelope[] | undefined;

              if (hasAttachments) {
                // Verify size budget
                const totalAttBytes = (payload.attachments || []).reduce(
                  (sum, a) => sum + (a.size_bytes || a.byte_size || 0),
                  0,
                );
                if (totalAttBytes > MAX_ATTACHMENT_SIZE) {
                  setErrorMessage("Total attachments exceed 40 MB maximum size limit.");
                  setComposeStatus(null);
                  showToast("Attachments exceed 40 MB limit.");
                  return;
                }

                setComposeStatus("Encrypting attachments for recipient…");
                const senderXwingPkHex = wasm.wasm_xwing_public_key_from_seed(bytesToHex(senderXwing));
                const recXwingPkHex = bytesToHex(xwingPkBytes);

                recipientAttEnvelopes = [];
                senderAttEnvelopes = [];

                const key = getMailboxKeyFor(box.id);

                for (const att of payload.attachments || []) {
                  let fileData: Uint8Array;
                  if (att.rawFile) {
                    fileData = new Uint8Array(await att.rawFile.arrayBuffer());
                  } else if (key) {
                    const blob = await downloadAndDecryptAttachment(box.id, att.id, key);
                    fileData = new Uint8Array(await blob.arrayBuffer());
                  } else {
                    throw new Error("Cannot read attachment data for Path A encryption");
                  }

                  const prep = await preparePathAAttachment({
                    file: { name: att.filename, type: att.content_type, data: fileData },
                    senderMailboxId: box.id,
                    recipientMailboxId: record.key_id,
                    recipientXWingPkHex: recXwingPkHex,
                    senderXWingPkHex: senderXwingPkHex,
                  });

                  // Upload recipient chunks to storage
                  for (const ch of prep.recipientChunks) {
                    await uploadAttachmentChunk(box.id, ch.storageRef, ch.data);
                  }
                  // Upload sender Sent chunks to storage
                  for (const ch of prep.senderChunks) {
                    await uploadAttachmentChunk(box.id, ch.storageRef, ch.data);
                  }

                  recipientAttEnvelopes.push(prep.recipientEnvelope);
                  senderAttEnvelopes.push(prep.senderEnvelope);
                }
              }

              await schedulePathA({
                mailbox_id: box.id,
                recipient: to,
                envelope_json: envelopeJson,
                deliver_at: new Date(payload.scheduledTime).toISOString(),
                draft_envelope: schedDraftRef || undefined,
                draft_storage_ref: schedDraftRef || undefined,
                subject: subject || "(no subject)",
                attachment_envelopes: recipientAttEnvelopes,
                sender_attachment_envelopes: senderAttEnvelopes,
              });
              setComposeStatus("Encrypted message scheduled (end-to-end).");
              setComposeOpen(false);
              clearComposeForm();
              showToast("Message scheduled for delivery.");
              return;
            }
          }
        } catch (err) {
          console.warn("Path A scheduled send attempt failed, falling back to Path B:", err);
        }
      }

      const [pubkey, reservation] = await Promise.all([
        fetchOutboundPubkey(),
        prepareOutbound(box.id),
      ]);
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const mailboxIdHex = box.id.replace(/-/g, "");

      const plaintextB64 = bytesToBase64(new TextEncoder().encode(mimeMessage));
      const encrypted = JSON.parse(
        wasm.wasm_encrypt_outbound(pubkey, mailboxIdHex, BigInt(reservation.outbox_seq), plaintextB64)
      ) as {
        ciphertext: string;
        send_token_wrapped: string;
        iv: string;
      };

      if (!encrypted.ciphertext || !encrypted.send_token_wrapped || !encrypted.iv) {
        throw new Error("Crypto core returned an incomplete outbound envelope");
      }

      const attIDs = (payload.attachments || []).map((a: any) => a.id);

      if (payload.scheduledTime) {
        await scheduleOutbound({
          reservation_id: reservation.reservation_id,
          mailbox_id: box.id,
          recipient: to,
          encrypted_message: encrypted.ciphertext,
          send_token_wrapped: encrypted.send_token_wrapped,
          outbox_seq: reservation.outbox_seq,
          encryption_version: reservation.encryption_version,
          aad_version: reservation.aad_version,
          encryption_iv: encrypted.iv,
          scheduled_at: new Date(payload.scheduledTime).toISOString(),
          attachment_ids: attIDs.length > 0 ? attIDs : undefined,
          draft_envelope: schedDraftRef || undefined,
          draft_storage_ref: schedDraftRef || undefined,
          subject: subject || "(no subject)",
        });
      } else {
        await sendOutbound({
          reservation_id: reservation.reservation_id,
          mailbox_id: box.id,
          recipient: to,
          encrypted_message: encrypted.ciphertext,
          send_token_wrapped: encrypted.send_token_wrapped,
          outbox_seq: reservation.outbox_seq,
          encryption_version: reservation.encryption_version,
          aad_version: reservation.aad_version,
          encryption_iv: encrypted.iv,
          attachment_ids: attIDs.length > 0 ? attIDs : undefined,
          alias_id: payload.fromAlias || undefined,
        });
      }

      setComposeStatus(payload.scheduledTime ? "Encrypted message scheduled." : "Encrypted message queued for delivery.");
      showToast(payload.scheduledTime ? "Message scheduled." : "Message sent.");
      loadMailboxData(box.id).catch((err) => {
        console.warn("Failed to refresh mailbox after send:", err);
      });
    } catch (err: any) {
      console.error("[SCHEDULE_ERROR] send or schedule failed:", {
        message: err?.message || err,
        status: err?.status,
        scheduledTime: payload.scheduledTime,
      });
      const errMsg = err instanceof Error ? err.message : String(err || "unknown error");
      const formattedErr = errMsg.startsWith("schedule: ") ? errMsg.slice(10) : errMsg;
      setErrorMessage(`Failed to send securely: ${formattedErr}`);
      setComposeStatus(null);
      showToast(`Send failed: ${formattedErr}`);
    }
  }

  async function handleSend(e: Event) {
    e.preventDefault();
    if (pendingSend()) return; // ignore double-send

    const payload = prepareSendPayload();
    if (!payload) {
      setErrorMessage("Fill in recipient, subject, and body.");
      return;
    }

    setPendingSend(payload);
    try {
      sessionStorage.setItem("byos_pending_send", JSON.stringify(payload));
    } catch {}

    // Close the compose drawer and clear the form immediately
    setComposeOpen(false);
    clearComposeForm();

    showUndoToast(payload);
  }

  async function handleSaveDraft() {
    const to = composeTo().trim();
    const subject = composeSubject().trim();
    const body = composeBody();
    const bodyHtml = composeBodyHtml();
    const richContent = bodyHtml || body;
    const boxId = composeAccountId() || selectedMailbox()?.id;
    const box = boxId ? (mailboxes().find((b) => b.id === boxId) || selectedMailbox()) : selectedMailbox();
    if (!box) return;

    // Handle offline draft saving to IndexedDB
    if (isOffline()) {
      const draftId = editingDraft()?.id || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "draft-" + Date.now());
      let envelope = "";
      const key = getMailboxKeyFor(box.id);
      if (key) {
        try {
          const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
          envelope = encryptDraftEnvelope(wasm, key, box.id, richContent);
        } catch {}
      }

      await saveOfflineDraft({
        id: draftId,
        mailbox_id: box.id,
        recipient: to,
        subject: subject || "Untitled Draft",
        body: body || richContent,
        bodyHtml: richContent,
        encrypted_envelope: envelope,
        updated_at: Date.now(),
      });

      const draftDisplay: DisplayMessage = {
        id: draftId,
        version: 1,
        folder: "drafts",
        sender: currentUser()?.email || "me@byos.local",
        recipient: to || "(no recipient)",
        recipients: to ? to.split(",").map((s) => s.trim()).filter(Boolean) : [],
        subject: subject || "Untitled Draft",
        snippet: richContent.replace(/<[^>]+>/g, "").slice(0, 80) + (richContent.length > 80 ? "…" : ""),
        bodyPlaintext: body || richContent,
        bodyHtml: richContent,
        encryptedBody: envelope,
        date: "Just now",
        read: true,
        starred: false,
        isRealApi: true,
      };

      setMessages((prev) => [draftDisplay, ...prev.filter((m) => m.id !== draftId)]);
      setComposeOpen(false);
      clearComposeForm();
      setComposeStatus(null);
      return;
    }

    // Draft bodies are ciphertext-only server-side. Refuse to submit anything
    // the client has not actually encrypted: no plaintext envelope may reach
    // the drafts API.
    const key = getMailboxKeyFor(box.id);
    if (!key) {
      setErrorMessage("Sign in again to save drafts.");
      setComposeStatus(null);
      return;
    }

    setComposeStatus("Saving draft to mailbox storage…");
    try {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const envelope = encryptDraftEnvelope(wasm, key, box.id, richContent);
      const editing = editingDraft();
      if (editing) {
        try {
          const updated = await updateDraft(box.id, editing.id, {
            recipient: to,
            subject: subject || "Untitled Draft",
            encrypted_envelope: envelope,
            version: editing.version,
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === editing.id
                ? {
                    ...m,
                    recipient: to || "(no recipient)",
                    recipients: to ? to.split(",").map((s) => s.trim()).filter(Boolean) : [],
                    subject: subject || "(no subject)",
                    snippet: richContent.replace(/<[^>]+>/g, "").slice(0, 80) + (richContent.length > 80 ? "…" : ""),
                    bodyPlaintext: body || richContent,
                    bodyHtml: richContent,
                    encryptedBody: envelope,
                    version: updated.version,
                    date: "Just now",
                  }
                : m
            )
          );
        } catch (err: any) {
          if (err?.status === 409) {
            setErrorMessage(
              "This draft changed elsewhere (version conflict). Reload the mailbox to get the latest version, then re-apply your edits."
            );
            if (box) await loadMailboxData(box.id);
          } else {
            throw err;
          }
          setComposeStatus(null);
          return;
        }
        setComposeOpen(false);
        clearComposeForm();
        setComposeStatus(null);
        return;
      }
      const created = await createDraft(box.id, {
        recipient: to,
        subject: subject || "Untitled Draft",
        encrypted_envelope: envelope,
      });

      const draftDisplay: DisplayMessage = {
        id: created.id,
        version: created.version,
        folder: "drafts",
        sender: currentUser()?.email || "me@byos.local",
        recipient: to || "(no recipient)",
        recipients: to ? to.split(",").map((s) => s.trim()).filter(Boolean) : [],
        subject: subject || "Untitled Draft",
        snippet: richContent.replace(/<[^>]+>/g, "").slice(0, 80) + (richContent.length > 80 ? "…" : ""),
        bodyPlaintext: body || richContent,
        bodyHtml: richContent,
        encryptedBody: envelope,
        date: "Just now",
        read: true,
        starred: false,
        isRealApi: true,
      };

      setMessages((prev) => [draftDisplay, ...prev]);
      setComposeOpen(false);
      setComposeStatus(null);
    } catch (err: any) {
      setErrorMessage("Failed to save draft: " + err.message);
      setComposeStatus(null);
    }
  }

  async function handleDeleteMessage(msg: DisplayMessage) {
    if (msg.isRealApi && msg.folder === "drafts" && selectedMailbox()) {
      try {
        await deleteDraft(selectedMailbox()!.id, msg.id);
      } catch (err) {
        console.warn("deleteDraft error:", err);
      }
      if (editingDraft()?.id === msg.id) {
        setComposeOpen(false);
        clearComposeForm();
      }
    }
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, folder: "trash" } : m))
    );
    setSelectedMsg(null);
  }

  interface SSEConnRecord {
    es: EventSource;
    timer: number | null;
    delay: number;
  }
  const sseConnMap = new Map<string, SSEConnRecord>();

  function disconnectAccountSSE(mailboxId: string) {
    const record = sseConnMap.get(mailboxId);
    if (record) {
      if (record.timer) {
        window.clearTimeout(record.timer);
      }
      record.es.close();
      sseConnMap.delete(mailboxId);
    }
  }

  function disconnectAllSSE() {
    for (const [id] of sseConnMap) {
      disconnectAccountSSE(id);
    }
  }

  function connectAccountSSE(mailboxId: string, token?: string) {
    if (!mailboxId) return;
    if (sseConnMap.has(mailboxId)) return;

    const base = apiBase();
    let url = `${base}/api/v1/mailboxes/${mailboxId}/events`;
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    try {
      const es = new EventSource(url, { withCredentials: true });
      const record: SSEConnRecord = {
        es,
        timer: null,
        delay: 1000,
      };
      sseConnMap.set(mailboxId, record);

      es.onopen = () => {
        record.delay = 1000;
      };

      es.onmessage = (event) => {
        if (!event.data) return;
        try {
          const data = JSON.parse(event.data);
          if (!data || !data.mailboxId || data.mailboxId !== mailboxId) return;

          // Route event to correct account and update views
          if (currentFolder() === "unified_inbox") {
            loadUnifiedInboxMessages().catch(() => {});
          } else if (selectedMailbox()?.id === mailboxId) {
            loadMailboxData(mailboxId).catch(() => {});
          }

          // Always update unread count for this mailbox
          fetchMessages(mailboxId, "inbox", token).then((msgs) => {
            const unread = msgs.filter((m) => !m.is_read).length;
            setAccountUnreadCounts((prev) => ({ ...prev, [mailboxId]: unread }));
          }).catch(() => {});

          if (data.type === "message.created" && data.folder === "inbox" && (data.unreadDelta || 0) > 0) {
            showToast("New message received");
          }
        } catch {}
      };

      es.onerror = () => {
        es.close();
        sseConnMap.delete(mailboxId);
        record.timer = window.setTimeout(() => {
          record.delay = Math.min(record.delay * 2, 30000);
          connectAccountSSE(mailboxId, token);
        }, record.delay);
      };
    } catch (err) {
      console.error("Failed to setup SSE connection for mailbox:", mailboxId, err);
    }
  }

  function syncSSEConnections() {
    const user = currentUser();
    if (!user) {
      disconnectAllSSE();
      return;
    }

    const accounts = connectedAccounts();
    const activeIds = new Set<string>();
    if (accounts.length > 0) {
      for (const a of accounts) {
        activeIds.add(a.id);
        connectAccountSSE(a.id, a.sessionToken);
      }
    } else {
      const box = selectedMailbox();
      if (box && box.id) {
        activeIds.add(box.id);
        connectAccountSSE(box.id, sessionStorage.getItem("byos_active_session_token") || undefined);
      }
    }

    // Close any streams that are no longer in connected accounts
    for (const [id] of sseConnMap) {
      if (!activeIds.has(id)) {
        disconnectAccountSSE(id);
      }
    }
  }

  createEffect(() => {
    connectedAccounts();
    selectedMailbox();
    currentUser();
    syncSSEConnections();
  });

  onCleanup(() => {
    disconnectAllSSE();
  });

  function formatDatetimeLocal(dateInput?: string | Date | number): string {
    if (!dateInput) return "";
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "";
    const pad = (n: number) => n.toString().padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  async function handleEditScheduled(msg: DisplayMessage) {
    clearComposeForm();
    const box = selectedMailbox();
    const key = mailboxKey();
    let bodyText = editablePlaintext() || decryptedContent() || (msg.snippet?.endsWith("…") ? "" : msg.snippet || "");
    let cleanSub = msg.subject && !msg.subject.startsWith("(") && !msg.subject.startsWith("[") ? msg.subject : "";
    let rcpt = msg.recipient === "(no recipient)" ? "" : msg.recipient || "";

    if ((!bodyText || !cleanSub) && box && key && unlockedBoxId() === box.id && msg.draftStorageRef?.startsWith("mailboxes/")) {
      try {
        const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        const resp = await fetchScheduledDraft(box.id, msg.id);
        const plaintext = decryptDraftEnvelope(wasm, key, box.id, resp.encrypted_envelope);
        bodyText = plaintext;
        try {
          const parsed = JSON.parse(plaintext);
          if (parsed && typeof parsed === "object") {
            if (parsed.body) bodyText = parsed.body;
            if (parsed.subject) cleanSub = parsed.subject;
            if (parsed.to) rcpt = Array.isArray(parsed.to) ? parsed.to.join(", ") : parsed.to;
          }
        } catch {}
      } catch (err) {
        console.error("Failed to load draft for editing:", err);
      }
    }

    setComposeTo(rcpt);
    setComposeSubject(cleanSub);
    setComposeBody(bodyText);
    setScheduledTime(formatDatetimeLocal(msg.scheduledAt || msg.date));
    setEditingScheduledId(msg.id);
    setComposeOpen(true);
  }

  async function handleCancelScheduled(msg: DisplayMessage) {
    const box = selectedMailbox();
    if (!box) return;
    try {
      setComposeStatus("Cancelling scheduled send…");
      await cancelScheduledMessage(box.id, msg.id);
      await loadMailboxData(box.id);
      setSelectedMsg(null);
      showToast("Scheduled send cancelled. Saved to Drafts.");
    } catch (err: any) {
      console.error("Failed to cancel scheduled send:", err);
      showToast("Failed to cancel scheduled send: " + (err.message || "Unknown error"));
    } finally {
      setComposeStatus(null);
    }
  }

  const folderNames: Record<Folder, string> = {
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

  const folderCounts = () => {
    const counts: Record<Folder, number> = {
      inbox: 0,
      sent: 0,
      scheduled: 0,
      drafts: 0,
      archive: 0,
      spam: 0,
      trash: 0,
      snoozed: 0,
      unified_inbox: 0,
    };
    const now = Date.now();
    for (const m of messages()) {
      if (m.folder === "scheduled") {
        counts.scheduled++;
        continue;
      }
      const isSnoozed = Boolean(m.snoozedUntil && new Date(m.snoozedUntil).getTime() > now);
      if (isSnoozed) {
        counts.snoozed++;
        continue;
      }
      if (!m.read) {
        if (m.folder === "inbox") {
          // Exclude messages in custom folders from inbox count
          if (!m.folderId || m.folderId === "") {
            counts.inbox++;
          }
        } else if (m.folder === "archive") {
          counts.archive++;
        } else if (m.folder === "spam") {
          counts.spam++;
        }
      }
    }
    return counts;
  };

  const customFolderCounts = () => {
    const counts: Record<string, number> = {};
    for (const m of messages()) {
      if (m.folder !== "trash" && m.folderId) {
        counts[m.folderId] = (counts[m.folderId] || 0) + 1;
      }
    }
    return counts;
  };

  const labelCounts = () => {
    const allLabels = labels();
    const counts: Record<string, number> = {};
    const msgs = messages();

    if (msgs.length > 0) {
      const directUnreadMsgIds = new Map<string, Set<string>>();
      for (const m of msgs) {
        if (!m.read && m.folder !== "trash" && m.labelIds) {
          for (const lid of m.labelIds) {
            let set = directUnreadMsgIds.get(lid);
            if (!set) {
              set = new Set();
              directUnreadMsgIds.set(lid, set);
            }
            set.add(m.id);
          }
        }
      }

      for (const l of allLabels) {
        const subtreeIds = getSubtreeLabelIds(l.id, allLabels);
        const uniqueMsgIds = new Set<string>();
        for (const sid of subtreeIds) {
          const directSet = directUnreadMsgIds.get(sid);
          if (directSet) {
            for (const mid of directSet) {
              uniqueMsgIds.add(mid);
            }
          }
        }
        counts[l.id] = uniqueMsgIds.size;
      }
    } else {
      for (const l of allLabels) {
        counts[l.id] = l.unread_count || 0;
      }
    }
    return counts;
  };

  return (
    <>
      <GlobalErrorBanner />
      <OfflineBanner />
      <Show when={!isSetupAccount()} fallback={<SetupAccount />}>
      <Show
        when={currentUser() !== null || isLoading()}
        fallback={
          <div class="flex h-screen w-screen items-center justify-center bg-[#F0EEE9] dark:bg-[#121316] p-4 text-[#2B2C2D] dark:text-[#F3F4F6]">
            <div class="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1E2025] shadow-xl border border-[#E2DFD8] dark:border-[#2E3138] p-8 text-[#2B2C2D] dark:text-[#F3F4F6]">
              <div class="flex items-center gap-2">
                <span class="text-xl font-bold tracking-wider text-[#3C3D3E] dark:text-[#F3F4F6]">BYOS</span>
                <span class="text-xs bg-[#A27561] text-white px-2 py-0.5 rounded-lg font-mono">Webmail</span>
              </div>
              <Show
                when={currentUser()}
                fallback={
                  <div>
                    {/* Two-Factor Authentication Challenge during Sign In */}
                    <Show
                      when={twoFactorChallenge()}
                      fallback={
                        <div>
                          <p class="mt-2 text-sm text-[#6F7173] dark:text-[#A1A1AA]">Sign in to access your encrypted mailbox.</p>
                          <Show when={loginError()}>
                            <div role="alert" class="mt-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-300">
                              {loginError()}
                            </div>
                          </Show>
                          <form onSubmit={handleLogin} class="mt-4 space-y-3">
                            <input
                              type="email"
                              autocomplete="username"
                              placeholder="you@example.com"
                              value={loginEmail()}
                              onInput={(e) => setLoginEmail(e.currentTarget.value)}
                              disabled={loginBusy()}
                              class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3 py-2 text-xs text-[#2B2C2D] dark:text-[#F3F4F6] focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6] dark:bg-[#18191D] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50"
                            />
                            <div>
                              <input
                                type="password"
                                autocomplete="current-password"
                                placeholder="Password"
                                value={loginPassword()}
                                onInput={(e) => setLoginPassword(e.currentTarget.value)}
                                disabled={loginBusy()}
                                class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3 py-2 text-xs text-[#2B2C2D] dark:text-[#F3F4F6] focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6] dark:bg-[#18191D] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50"
                              />
                              <div class="flex justify-end mt-1.5">
                                <button
                                  type="button"
                                  onClick={handleOpenForgotPassword}
                                  class="text-[11px] text-[#A27561] dark:text-[#C59380] hover:underline cursor-pointer font-medium"
                                >
                                  Forgot password?
                                </button>
                              </div>
                            </div>
                            <div class="space-y-1.5 pt-1">
                              <label class="flex items-center gap-2 text-xs text-[#2B2C2D] dark:text-[#F3F4F6] cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  data-testid="remember-device-checkbox"
                                  checked={rememberDevice()}
                                  onChange={(e) => setRememberDevice(e.currentTarget.checked)}
                                  disabled={loginBusy()}
                                  class="rounded border-[#E2DFD8] dark:border-[#2E3138] text-[#A27561] focus:ring-[#A27561]/20 cursor-pointer"
                                />
                                <span>Remember this device for 30 days</span>
                              </label>
                              <p
                                data-testid="remember-device-disclosure"
                                class={`text-[10px] leading-relaxed transition-opacity ${
                                  rememberDevice()
                                    ? "text-[#6E7075] dark:text-[#878A8E] opacity-100"
                                    : "text-[#878A8E]/60 dark:text-[#6E7075]/60 opacity-75"
                                }`}
                              >
                                Storing your key on this device means anyone with access to this browser profile can read your mail without your password. Do not enable on a shared computer.
                              </p>
                            </div>
                            <button
                              type="submit"
                              disabled={loginBusy() || !loginEmail().trim() || !loginPassword()}
                              class="w-full rounded-xl bg-[#A27561] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer shadow-2xs"
                            >
                              {loginBusy() ? "Signing in…" : "Sign in"}
                            </button>
                            <div class="relative flex py-1 items-center">
                              <div class="flex-grow border-t border-[#E2DFD8] dark:border-[#2E3138]"></div>
                              <span class="flex-shrink mx-3 text-[10px] uppercase tracking-wider text-[#878A8E] dark:text-[#6E7075] font-medium">or</span>
                              <div class="flex-grow border-t border-[#E2DFD8] dark:border-[#2E3138]"></div>
                            </div>
                            <button
                              type="button"
                              onClick={handlePasskeyLogin}
                              disabled={loginBusy()}
                              class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] dark:hover:border-[#A27561] bg-white dark:bg-[#18191D] hover:bg-[#FAF9F6] dark:hover:bg-[#23262D] px-4 py-2 text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6] transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                            >
                              <svg class="w-4 h-4 stroke-current fill-none stroke-2 text-[#A27561]" viewBox="0 0 24 24">
                                <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 001.99 5.334" />
                              </svg>
                              Sign in with Passkey / Biometrics
                            </button>
                          </form>
                        </div>
                      }
                    >
                      {/* 2FA Challenge View */}
                      <div>
                        <div class="mt-2 flex items-center gap-2">
                          <div class="w-7 h-7 rounded-lg bg-[#A27561]/10 text-[#A27561] flex items-center justify-center">
                            <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                            </svg>
                          </div>
                          <div>
                            <h2 class="text-sm font-semibold text-[#3C3D3E] dark:text-[#F3F4F6]">Two-Step Verification</h2>
                            <p class="text-[11px] text-[#6F7173] dark:text-[#A1A1AA]">Security challenge required</p>
                          </div>
                        </div>

                        <p class="mt-3 text-xs text-[#6F7173] dark:text-[#A1A1AA] leading-relaxed">
                          {twoFactorChallenge()?.preferred_method === "totp"
                            ? "Enter the 6-digit code from your authenticator app to complete sign in."
                            : `Enter the 6-digit security code sent to ${twoFactorChallenge()?.destination_masked}.`}
                        </p>

                        <Show when={twoFactorError()}>
                          <div role="alert" class="mt-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-2.5 text-xs text-rose-700 dark:text-rose-300">
                            {twoFactorError()}
                          </div>
                        </Show>

                        <form onSubmit={handleVerifyLogin2FA} class="mt-4 space-y-3">
                          <div>
                            <label class="block text-[11px] font-medium text-[#6F7173] dark:text-[#A1A1AA] mb-1">
                              Verification Code
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxlength="6"
                              placeholder="123456"
                              value={twoFactorCodeInput()}
                              onInput={(e) => setTwoFactorCodeInput(e.currentTarget.value.replace(/[^0-9]/g, ""))}
                              disabled={twoFactorBusy()}
                              autofocus
                              class="w-full tracking-widest text-center font-mono rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3 py-2 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6] dark:bg-[#18191D] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50"
                            />
                          </div>

                          <Show when={(twoFactorChallenge()?.methods?.length || 0) > 1}>
                            <div class="flex items-center justify-between text-[11px] text-[#6F7173] dark:text-[#A1A1AA] pt-1">
                              <span>Try another method:</span>
                              <div class="flex items-center gap-1.5">
                                <Show when={twoFactorChallenge()?.methods.includes("email") && twoFactorChallenge()?.preferred_method !== "email"}>
                                  <button
                                    type="button"
                                    onClick={() => handleSwitchLogin2FAMethod("email")}
                                    disabled={twoFactorBusy()}
                                    class="text-[#A27561] hover:underline cursor-pointer"
                                  >
                                    Email OTP
                                  </button>
                                </Show>
                                <Show when={twoFactorChallenge()?.methods.includes("phone") && twoFactorChallenge()?.preferred_method !== "phone"}>
                                  <button
                                    type="button"
                                    onClick={() => handleSwitchLogin2FAMethod("phone")}
                                    disabled={twoFactorBusy()}
                                    class="text-[#A27561] hover:underline cursor-pointer"
                                  >
                                    SMS Code
                                  </button>
                                </Show>
                              </div>
                            </div>
                          </Show>

                          <button
                            type="submit"
                            disabled={twoFactorBusy() || twoFactorCodeInput().trim().length !== 6}
                            class="w-full rounded-xl bg-[#A27561] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer shadow-2xs"
                          >
                            {twoFactorBusy() ? "Verifying…" : "Verify & Sign In"}
                          </button>

                          <button
                            type="button"
                            onClick={handleCancelLogin2FA}
                            disabled={twoFactorBusy()}
                            class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#18191D] hover:bg-[#FAF9F6] dark:hover:bg-[#23262D] px-4 py-2 text-xs font-medium text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#3C3D3E] dark:hover:text-[#F3F4F6] transition cursor-pointer"
                          >
                            Back to Sign In
                          </button>
                        </form>
                      </div>
                    </Show>
                  </div>
                }
              >
                <div class="mt-3">
                  <h2 class="text-base font-semibold text-[#2B2C2D] dark:text-[#F3F4F6]">Unlock your mailbox</h2>
                  <p class="mt-1 text-xs text-[#6F7173] dark:text-[#A1A1AA]">
                    Signed in as <span class="font-medium text-[#2B2C2D] dark:text-[#F3F4F6]">{currentUser()?.email}</span>
                  </p>
                  <Show when={loginError()}>
                    <div role="alert" class="mt-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-300">
                      {loginError()}
                    </div>
                  </Show>
                  <Show
                    when={!useRecoveryPhrase()}
                    fallback={
                      <form onSubmit={handleUnlockWithRecovery} class="mt-4 space-y-3">
                        <div>
                          <label class="block text-[11px] font-medium text-[#6F7173] dark:text-[#A1A1AA] mb-1">
                            24-Word Recovery Phrase
                          </label>
                          <textarea
                            rows={3}
                            placeholder="word1 word2 word3 ... word24"
                            value={recoveryPhraseInput()}
                            onInput={(e) => setRecoveryPhraseInput(e.currentTarget.value)}
                            disabled={loginBusy()}
                            autofocus
                            class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2 text-xs text-[#2B2C2D] dark:text-[#F3F4F6] focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6] dark:bg-[#18191D] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50 resize-none font-mono"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={loginBusy() || !recoveryPhraseInput().trim()}
                          class="w-full rounded-xl bg-[#A27561] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer shadow-2xs"
                        >
                          {loginBusy() ? "Unwrapping keys…" : "Unlock with Recovery Phrase"}
                        </button>
                        <div class="text-center pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setUseRecoveryPhrase(false);
                              setLoginError(null);
                            }}
                            class="text-xs text-[#A27561] hover:underline cursor-pointer"
                          >
                            ← Use account password instead
                          </button>
                        </div>
                      </form>
                    }
                  >
                    <form onSubmit={handleUnlock} class="mt-4 space-y-3">
                      <input
                        type="password"
                        autocomplete="current-password"
                        placeholder="Enter password to unlock"
                        value={loginPassword()}
                        onInput={(e) => setLoginPassword(e.currentTarget.value)}
                        disabled={loginBusy()}
                        autofocus
                        class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2.5 text-xs text-[#2B2C2D] dark:text-[#F3F4F6] focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6] dark:bg-[#18191D] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50"
                      />
                      <button
                        type="submit"
                        disabled={loginBusy() || !loginPassword()}
                        class="w-full rounded-xl bg-[#A27561] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer shadow-2xs"
                      >
                        {loginBusy() ? "Unlocking…" : "Unlock Mailbox"}
                      </button>
                      <div class="relative flex py-1 items-center">
                        <div class="flex-grow border-t border-[#E2DFD8] dark:border-[#2E3138]"></div>
                        <span class="flex-shrink mx-3 text-[10px] uppercase tracking-wider text-[#878A8E] dark:text-[#6E7075] font-medium">or</span>
                        <div class="flex-grow border-t border-[#E2DFD8] dark:border-[#2E3138]"></div>
                      </div>
                      <button
                        type="button"
                        onClick={handlePasskeyLogin}
                        disabled={loginBusy()}
                        class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] dark:hover:border-[#A27561] bg-white dark:bg-[#18191D] hover:bg-[#FAF9F6] dark:hover:bg-[#23262D] px-4 py-2 text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6] transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
                      >
                        <svg class="w-4 h-4 stroke-current fill-none stroke-2 text-[#A27561]" viewBox="0 0 24 24">
                          <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 004 11m0 0a8 8 0 001.99 5.334" />
                        </svg>
                        Unlock with Passkey / Biometrics
                      </button>
                      <div class="text-center pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setUseRecoveryPhrase(true);
                            setLoginError(null);
                          }}
                          class="text-xs text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:underline cursor-pointer"
                        >
                          Unlock with 24-word recovery phrase instead
                        </button>
                      </div>
                    </form>
                  </Show>
                  <div class="mt-4 pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138] flex justify-between items-center text-[11px]">
                    <button
                      type="button"
                      onClick={() => handleLogout()}
                      class="text-[#878A8E] dark:text-[#6E7075] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:underline cursor-pointer"
                    >
                      Sign in with a different account
                    </button>
                  </div>
                </div>
              </Show>
            </div>

            {/* ── Forgot Password / Account Recovery Modal ── */}
            <Show when={forgotPasswordModalOpen()}>
              <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-fade-in font-sans">
                <div class="w-full max-w-md bg-white dark:bg-[#1E2025] rounded-2xl shadow-2xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden">
                  {/* Modal Header */}
                  <div class="px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between bg-[#FAF9F6] dark:bg-[#18191D]">
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-lg bg-[#A27561]/10 text-[#A27561] flex items-center justify-center">
                        <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </div>
                      <h3 class="text-sm font-semibold text-[#3C3D3E] dark:text-[#F3F4F6]">Account Password Recovery</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForgotPasswordModalOpen(false)}
                      class="text-[#878A8E] dark:text-[#6E7075] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] p-1 rounded-lg hover:bg-[#E2DFD8]/40 dark:hover:bg-[#2E3138]/40 transition cursor-pointer"
                    >
                      <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>

                  <div class="p-6">
                    {/* Error Notice */}
                    <Show when={forgotError()}>
                      <div class="mb-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-300">
                        {forgotError()}
                      </div>
                    </Show>

                    {/* Step 1: Find Account & Select Recovery Option */}
                    <Show when={forgotStep() === 1}>
                      <Show
                        when={forgotMethods().length > 0}
                        fallback={
                          <form onSubmit={handleFindRecoveryMethods} class="space-y-4">
                            <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA] leading-relaxed">
                              Enter your BYOS email address. We will look up the verified 2-step verification and recovery options configured on your account.
                            </p>
                            <div>
                              <label class="block text-xs font-medium text-[#3C3D3E] dark:text-[#D1D5DB] mb-1.5">
                                Account Email
                              </label>
                              <input
                                type="email"
                                value={forgotEmail()}
                                onInput={(e) => setForgotEmail(e.currentTarget.value)}
                                placeholder="you@example.com"
                                required
                                class="w-full bg-[#FAF9F6] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-xs text-[#3C3D3E] dark:text-[#F3F4F6] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50 outline-none"
                              />
                            </div>
                            <div class="flex items-center justify-end gap-2 pt-2">
                              <button
                                type="button"
                                onClick={() => setForgotPasswordModalOpen(false)}
                                class="px-4 py-2 border border-[#E2DFD8] dark:border-[#2E3138] text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#3C3D3E] dark:hover:text-[#F3F4F6] text-xs font-medium rounded-xl transition cursor-pointer bg-white dark:bg-[#18191D]"
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                disabled={forgotBusy() || !forgotEmail().trim()}
                                class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white text-xs font-medium rounded-xl transition cursor-pointer shadow-2xs"
                              >
                                {forgotBusy() ? "Finding methods…" : "Continue"}
                              </button>
                            </div>
                          </form>
                        }
                      >
                        <form onSubmit={handleRequestRecoveryCode} class="space-y-4">
                          <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA] leading-relaxed">
                            Select how you would like to receive or verify your security recovery code:
                          </p>
                          <div class="space-y-2">
                            <For each={forgotMethods()}>
                              {(method) => (
                                <label
                                  class={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                                    forgotSelectedMethod() === method.type
                                      ? "border-[#A27561] bg-[#A27561]/5 ring-1 ring-[#A27561]"
                                      : "border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F6] dark:bg-[#18191D] hover:bg-stone-50 dark:hover:bg-[#23262D]"
                                  }`}
                                >
                                  <div class="flex items-center gap-3">
                                    <input
                                      type="radio"
                                      name="recovery_method"
                                      value={method.type}
                                      checked={forgotSelectedMethod() === method.type}
                                      onChange={() => setForgotSelectedMethod(method.type)}
                                      class="text-[#A27561] focus:ring-[#A27561]"
                                    />
                                    <div>
                                      <span class="text-xs font-medium text-[#3C3D3E] dark:text-[#F3F4F6] capitalize block">
                                        {method.type === "totp" ? "Authenticator App" : method.type + " Verification"}
                                      </span>
                                      <span class="text-[11px] text-[#6F7173] dark:text-[#A1A1AA] font-mono">
                                        {method.destination_masked}
                                      </span>
                                    </div>
                                  </div>
                                  <span class="text-[10px] text-[#A27561] font-mono font-medium">
                                    {method.type === "totp" ? "TOTP" : "OTP"}
                                  </span>
                                </label>
                              )}
                            </For>
                          </div>

                          <div class="flex items-center justify-between pt-2">
                            <button
                              type="button"
                              onClick={() => setForgotMethods([])}
                              class="text-xs text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#3C3D3E] dark:hover:text-[#F3F4F6] cursor-pointer"
                            >
                              Change email
                            </button>
                            <button
                              type="submit"
                              disabled={forgotBusy()}
                              class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white text-xs font-medium rounded-xl transition cursor-pointer shadow-2xs"
                            >
                              {forgotBusy() ? "Sending code…" : "Send Recovery Code"}
                            </button>
                          </div>
                        </form>
                      </Show>
                    </Show>

                    {/* Step 2: Code Entry & New Password */}
                    <Show when={forgotStep() === 2}>
                      <form onSubmit={handleResetPasswordWithRecovery} class="space-y-4">
                        <div class="p-3 bg-[#FAF9F6] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#6F7173] dark:text-[#A1A1AA]">
                          <span class="font-medium text-[#3C3D3E] dark:text-[#F3F4F6] block mb-0.5">Verification required</span>
                          {forgotSelectedMethod() === "totp"
                            ? "Enter the 6-digit code from your authenticator app."
                            : `Enter the 6-digit code sent to ${forgotDestinationMasked()}.`}
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-[#3C3D3E] dark:text-[#D1D5DB] mb-1">
                            6-Digit Security Code
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxlength="6"
                            value={forgotCode()}
                            onInput={(e) => setForgotCode(e.currentTarget.value.replace(/[^0-9]/g, ""))}
                            placeholder="123456"
                            required
                            class="w-full tracking-widest text-center font-mono bg-[#FAF9F6] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-sm text-[#3C3D3E] dark:text-[#F3F4F6] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50 outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-[#3C3D3E] dark:text-[#D1D5DB] mb-1">
                            New Password (min 12 chars)
                          </label>
                          <input
                            type="password"
                            value={forgotNewPassword()}
                            onInput={(e) => setForgotNewPassword(e.currentTarget.value)}
                            placeholder="At least 12 characters"
                            required
                            minlength="12"
                            class="w-full bg-[#FAF9F6] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-xs text-[#3C3D3E] dark:text-[#F3F4F6] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50 outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-[#3C3D3E] dark:text-[#D1D5DB] mb-1">
                            Confirm New Password
                          </label>
                          <input
                            type="password"
                            value={forgotConfirmPassword()}
                            onInput={(e) => setForgotConfirmPassword(e.currentTarget.value)}
                            placeholder="Re-enter new password"
                            required
                            minlength="12"
                            class="w-full bg-[#FAF9F6] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-xs text-[#3C3D3E] dark:text-[#F3F4F6] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50 outline-none"
                          />
                        </div>

                        {/* Optional 24-Word Recovery Phrase */}
                        <div class="pt-1">
                          <button
                            type="button"
                            onClick={() => setShowPhraseInput(!showPhraseInput())}
                            class="text-[11px] text-[#A27561] hover:underline flex items-center gap-1 cursor-pointer font-medium"
                          >
                            <span>{showPhraseInput() ? "− Hide recovery phrase (optional)" : "+ Have your 24-word recovery phrase? (Optional)"}</span>
                          </button>
                          <Show when={showPhraseInput()}>
                            <div class="mt-2 space-y-1.5 p-3 rounded-xl bg-[#F4F1EA] dark:bg-[#141518] border border-[#E2DFD8] dark:border-[#2E3138]">
                              <p class="text-[11px] text-[#6F7173] dark:text-[#A1A1AA] leading-relaxed">
                                Entering your 24-word recovery phrase re-wraps your historical encryption keys under your new password, keeping all past messages decrypted immediately. If you don't have it right now, you can leave this blank and reactivate past messages later in Settings.
                              </p>
                              <textarea
                                rows={2}
                                value={forgotRecoveryPhrase()}
                                onInput={(e) => setForgotRecoveryPhrase(e.currentTarget.value)}
                                placeholder="word1 word2 word3 ... word24 (optional)"
                                class="w-full bg-[#FAF9F6] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-1.5 text-xs text-[#3C3D3E] dark:text-[#F3F4F6] placeholder:text-[#6F7173]/50 dark:placeholder:text-[#A1A1AA]/50 outline-none font-mono resize-none"
                              />
                            </div>
                          </Show>
                        </div>

                        <div class="flex items-center justify-between pt-2">
                          <button
                            type="button"
                            onClick={() => setForgotStep(1)}
                            class="text-xs text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#3C3D3E] dark:hover:text-[#F3F4F6] cursor-pointer"
                          >
                            Back
                          </button>
                          <button
                            type="submit"
                            disabled={
                              forgotBusy() ||
                              forgotCode().trim().length !== 6 ||
                              forgotNewPassword().length < 12 ||
                              forgotNewPassword() !== forgotConfirmPassword()
                            }
                            class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] disabled:opacity-50 text-white text-xs font-medium rounded-xl transition cursor-pointer shadow-2xs"
                          >
                            {forgotBusy() ? "Resetting…" : "Reset Password"}
                          </button>
                        </div>
                      </form>
                    </Show>

                    {/* Step 3: Success State */}
                    <Show when={forgotStep() === 3}>
                      <div class="text-center py-4 space-y-3">
                        <div class="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                          <svg class="w-6 h-6 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                        <h4 class="text-base font-semibold text-[#3C3D3E] dark:text-[#F3F4F6]">Password Successfully Reset</h4>
                        <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA] max-w-sm mx-auto leading-relaxed">
                          Your password has been updated. You can now sign in to BYOS Webmail. Historical encrypted messages remain securely sealed under your 24-word recovery phrase.
                        </p>
                        <div class="pt-3">
                          <button
                            type="button"
                            onClick={() => {
                              setForgotPasswordModalOpen(false);
                              setLoginEmail(forgotEmail().trim());
                              setLoginPassword(forgotNewPassword());
                            }}
                            class="w-full px-4 py-2.5 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-medium rounded-xl transition cursor-pointer shadow-2xs"
                          >
                            Sign In with New Password
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        }
      >
      <Show
        when={!settingsOpen()}
        fallback={
          <SettingsLayout
            activeTab={activeSettingsTab()}
            onTabChange={setActiveSettingsTab}
            onClose={() => {
              setFocusedInboxEnabledState(getFocusedInboxEnabled());
              setSettingsOpen(false);
            }}
            currentUser={currentUser()}
            selectedMailbox={selectedMailbox()}
          >
            <Show when={activeSettingsTab() === "account" && selectedMailbox()}>
              <AccountTab
                mailbox={selectedMailbox()!}
                currentUser={currentUser()}
                mailboxKey={mailboxKey()}
                profilePhotoUrl={profilePhotoUrl()}
                onPhotoUpdated={(newUrl, newRef) => {
                  if (profilePhotoUrl() && profilePhotoUrl() !== newUrl) {
                    URL.revokeObjectURL(profilePhotoUrl()!);
                  }
                  setProfilePhotoUrl(newUrl);
                  const box = selectedMailbox();
                  if (box) {
                    const updatedBox = { ...box, profile_photo_ref: newRef };
                    setSelectedMailbox(updatedBox);
                    setMailboxes(mailboxes().map((m) => (m.id === box.id ? updatedBox : m)));
                  }
                  const usr = currentUser();
                  if (usr) {
                    setCurrentUser({ ...usr, profile_photo_ref: newRef });
                  }
                  setConnectedAccounts((prev) =>
                    prev.map((a) => (a.id === box?.id ? { ...a, profile_photo_ref: newRef || undefined } : a))
                  );
                }}
                showToast={showToast}
              />
            </Show>
            <Show when={activeSettingsTab() === "signatures" && selectedMailbox()}>
              <SignaturesTab mailbox={selectedMailbox()!} currentUser={currentUser()} />
            </Show>
            <Show when={activeSettingsTab() === "masked-email" && selectedMailbox()}>
              <MaskedEmailTab mailbox={selectedMailbox()!} currentUser={currentUser()} />
            </Show>
            <Show when={activeSettingsTab() === "bridge" && selectedMailbox()}>
              <BridgeTab mailbox={selectedMailbox()!} currentUser={currentUser()} />
            </Show>
            <Show when={activeSettingsTab() === "appearance" && selectedMailbox()}>
              <AppearanceTab
                mailbox={selectedMailbox()!}
                currentDensity={density()}
                currentLayout={layoutMode()}
                currentTheme={theme()}
                currentTimeFormat={timeFormat()}
                currentLanguage={language()}
                currentWeekStart={weekStart()}
                onDensityChange={handleSetDensity}
                onLayoutChange={handleSetLayoutMode}
                onThemeChange={(t) => handleSetTheme(t, false)}
                onTimeFormatChange={(tf) => {
                  setTimeFormat(tf);
                  if (typeof window !== "undefined") localStorage.setItem("byos_time_format", tf);
                }}
                onLanguageChange={(l) => {
                  setLanguage(l);
                  if (typeof window !== "undefined") localStorage.setItem("byos_language", l);
                }}
                onWeekStartChange={(ws) => {
                  setWeekStart(ws);
                  if (typeof window !== "undefined") localStorage.setItem("byos_week_start", ws);
                }}
              />
            </Show>
            <Show when={activeSettingsTab() === "autoreply" && selectedMailbox()}>
              <AutoReplyTab mailbox={selectedMailbox()!} />
            </Show>
            <Show when={activeSettingsTab() === "filters" && selectedMailbox()}>
              <FiltersTab mailbox={selectedMailbox()!} />
            </Show>
            <Show when={activeSettingsTab() === "security" && selectedMailbox()}>
              <SecurityTab
                mailbox={selectedMailbox()!}
                currentUser={currentUser()}
                mailboxKey={mailboxKey()}
                signingSeed={signingSeed()}
                xwingSeed={xwingSeed()}
                onReactivateSuccess={() => {
                const box = selectedMailbox();
                if (box) {
                  const updatedBox = { ...box, previous_wrapped_sk_user: undefined };
                  setSelectedMailbox(updatedBox as any);
                  setMailboxes(mailboxes().map(m => m.id === box.id ? (updatedBox as any) : m));
                }
                const user = currentUser();
                if (user) {
                  setCurrentUser({ ...user, previous_wrapped_sk_user: undefined });
                }
              }} />
            </Show>
          </SettingsLayout>
        }
      >
      <div class="flex flex-col h-screen w-screen overflow-hidden bg-[#F0EEE9] dark:bg-[#121316] text-[#1A1B1E] dark:text-[#F3F4F6] font-sans p-1.5 sm:p-3 gap-1.5 sm:gap-3">
        {/* Audited Impersonation Banner */}
        <Show when={isImpersonating()}>
          <div class="bg-amber-600 text-white px-3 sm:px-4 py-2 flex items-center justify-between text-xs sm:text-sm font-medium shadow-sm z-50 rounded-xl">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 stroke-current fill-none stroke-2 flex-shrink-0" viewBox="0 0 24 24">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span class="font-bold tracking-wide">AUDITED SESSION:</span>
              <span>
                Viewing {impersonateEmail() || currentUser()?.email || selectedMailbox()?.local_part || "Mailbox"} as Administrator
              </span>
            </div>
            <button
              onClick={handleExitImpersonation}
              class="bg-black/30 hover:bg-black/50 text-white text-xs px-3 py-1 rounded-lg transition font-semibold cursor-pointer"
            >
              Exit Session
            </button>
          </div>
        </Show>

        {/* Historical Messages Locked Warning Banner (Tier 2 Recovery) */}
        <Show when={selectedMailbox()?.previous_wrapped_sk_user || currentUser()?.previous_wrapped_sk_user}>
          <div class="bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 px-3 sm:px-4 py-2 sm:py-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs font-medium rounded-xl shadow-xs gap-2">
            <div class="flex items-center gap-2.5">
              <svg class="w-4 h-4 stroke-amber-600 dark:stroke-amber-400 fill-none stroke-2 shrink-0" viewBox="0 0 24 24">
                <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <span>
                <strong class="font-semibold">Historical Messages Locked:</strong> Your account password was recently reset. Your previous encrypted messages remain locked until you reactivate your historical keys with your 24-word recovery phrase or old password.
              </span>
            </div>
            <button
              onClick={() => {
                setActiveSettingsTab("security");
                setSettingsOpen(true);
              }}
              class="bg-amber-600 hover:bg-amber-700 text-white text-xs px-3 py-1.5 rounded-lg transition font-semibold cursor-pointer shrink-0 shadow-xs"
            >
              Reactivate Keys
            </button>
          </div>
        </Show>

        {/* Mobile Navigation Drawer with Backdrop */}
        <Show when={mobileSidebarOpen()}>
          <div
            class="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 md:hidden transition-opacity"
            onClick={() => setMobileSidebarOpen(false)}
            aria-hidden="true"
          />
          <div class="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#F0EEE9] dark:bg-[#18191D] z-50 md:hidden shadow-2xl flex flex-col transition-transform duration-200">
            <Sidebar
              currentUser={currentUser()}
              selectedMailbox={selectedMailbox()}
              activeAccountId={currentFolder() === "unified_inbox" ? "__all__" : selectedMailbox()?.id || "__all__"}
              onSelectAllInboxes={() => {
                setCurrentFolder("unified_inbox");
                setActiveCustomFolder(null);
                setActiveLabel(null);
                setSelectedMsg(null);
                setSelectedIds(new Set<string>());
                setCurrentPage(1);
                loadUnifiedInboxMessages();
                setMobileSidebarOpen(false);
              }}
              currentFolder={currentFolder()}
              onSelectFolder={(f) => {
                setCurrentFolder(f);
                setActiveCustomFolder(null);
                setActiveLabel(null);
                setSelectedMsg(null);
                setSelectedIds(new Set<string>());
                setCurrentPage(1);
                if (f === "unified_inbox") {
                  loadUnifiedInboxMessages();
                } else if (!isOffline()) {
                  const box = selectedMailbox();
                  if (box) loadMailboxData(box.id);
                }
                setMobileSidebarOpen(false);
              }}
              unifiedUnreadCount={unifiedUnreadCount()}
              accountUnreadCounts={accountUnreadCounts()}
              excludedAccountIds={excludedAccountIds()}
              onToggleAccountInclusion={handleToggleAccountInclusion}
              folderCounts={folderCounts()}
              customFolderCounts={customFolderCounts()}
              labelCounts={labelCounts()}
              onCompose={() => {
                startNewCompose();
                setMobileSidebarOpen(false);
              }}
              onOpenContacts={() => {
                openContacts();
                setMobileSidebarOpen(false);
              }}
              onOpenImport={() => {
                setImportEmailsModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              onOpenSettings={() => {
                setActiveSettingsTab("account");
                setSettingsOpen(true);
                setMobileSidebarOpen(false);
              }}
              onLogout={handleLogout}
              profilePhotoUrl={profilePhotoUrl()}
              isUnlocked={Boolean(mailboxKey() && unlockedBoxId() === selectedMailbox()?.id)}
              storageError={storageErrorBanner()}
              connectedAccounts={connectedAccounts()}
              onSelectAccount={(acc) => {
                handleSwitchAccount(acc);
                setMobileSidebarOpen(false);
              }}
              onOpenAddMailbox={() => {
                setAddMailboxModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              customFolders={customFolders()}
              activeFolderId={activeCustomFolder()?.id}
              onSelectCustomFolder={(f) => {
                handleSelectCustomFolder(f);
                setMobileSidebarOpen(false);
              }}
              onOpenCreateFolder={() => {
                setFolderToEdit(null);
                setCreateFolderModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              onEditFolder={handleOpenEditFolder}
              onDeleteFolder={handleDeleteFolder}
              labels={labels()}
              activeLabelId={activeLabel()?.id}
              onSelectLabel={(l) => {
                handleSelectLabel(l);
                setMobileSidebarOpen(false);
              }}
              onOpenCreateLabel={() => {
                setLabelToEdit(null);
                setInitialParentLabelId(null);
                setCreateLabelModalOpen(true);
                setMobileSidebarOpen(false);
              }}
              onEditLabel={handleOpenEditLabel}
              onNewSublabel={(parent) => {
                handleOpenNewSublabel(parent);
                setMobileSidebarOpen(false);
              }}
              onChangeParent={(lbl) => {
                setChangeParentLabel(lbl);
                setMobileSidebarOpen(false);
              }}
              onDeleteLabel={handleDeleteLabel}
              onMoveMessages={handleMoveMessages}
              onAttachLabel={handleAttachLabel}
              theme={theme()}
              onSetTheme={handleSetTheme}
              onToggleTheme={() => handleSetTheme(theme() === "dark" ? "cloud_dancer" : "dark")}
              onCloseMobile={() => setMobileSidebarOpen(false)}
            />
          </div>
        </Show>

        <main class="flex flex-1 overflow-hidden gap-3 bg-[#F0EEE9] dark:bg-[#18191D]" data-testid="main-content">
          {/* ── Left Navigation Sidebar (Unified with Canvas #F0EEE9) ── */}
          <Sidebar
            class="hidden md:flex"
            currentUser={currentUser()}
            selectedMailbox={selectedMailbox()}
            activeAccountId={currentFolder() === "unified_inbox" ? "__all__" : selectedMailbox()?.id || "__all__"}
            onSelectAllInboxes={() => {
              setCurrentFolder("unified_inbox");
              setActiveCustomFolder(null);
              setActiveLabel(null);
              setSelectedMsg(null);
              setSelectedIds(new Set<string>());
              setCurrentPage(1);
              loadUnifiedInboxMessages();
            }}
            currentFolder={currentFolder()}
            onSelectFolder={(f) => {
              setCurrentFolder(f);
              setActiveCustomFolder(null);
              setActiveLabel(null);
              setSelectedMsg(null);
              setSelectedIds(new Set<string>());
              setCurrentPage(1);
              if (f === "unified_inbox") {
                loadUnifiedInboxMessages();
              } else if (!isOffline()) {
                const box = selectedMailbox();
                if (box) loadMailboxData(box.id);
              }
            }}
            unifiedUnreadCount={unifiedUnreadCount()}
            accountUnreadCounts={accountUnreadCounts()}
            excludedAccountIds={excludedAccountIds()}
            onToggleAccountInclusion={handleToggleAccountInclusion}
            folderCounts={folderCounts()}
            customFolderCounts={customFolderCounts()}
            labelCounts={labelCounts()}
            onCompose={startNewCompose}
            onOpenContacts={openContacts}
            onOpenImport={() => setImportEmailsModalOpen(true)}
            onOpenSettings={() => {
              setActiveSettingsTab("account");
              setSettingsOpen(true);
            }}
            onLogout={handleLogout}
            profilePhotoUrl={profilePhotoUrl()}
            isUnlocked={Boolean(mailboxKey() && unlockedBoxId() === selectedMailbox()?.id)}
            storageError={storageErrorBanner()}
            connectedAccounts={connectedAccounts()}
            onSelectAccount={handleSwitchAccount}
            onOpenAddMailbox={() => setAddMailboxModalOpen(true)}
            customFolders={customFolders()}
            activeFolderId={activeCustomFolder()?.id}
            onSelectCustomFolder={handleSelectCustomFolder}
            onOpenCreateFolder={() => {
              setFolderToEdit(null);
              setCreateFolderModalOpen(true);
            }}
            onEditFolder={handleOpenEditFolder}
            onDeleteFolder={handleDeleteFolder}
            labels={labels()}
            activeLabelId={activeLabel()?.id}
            onSelectLabel={handleSelectLabel}
            onOpenCreateLabel={() => {
              setLabelToEdit(null);
              setInitialParentLabelId(null);
              setCreateLabelModalOpen(true);
            }}
            onEditLabel={handleOpenEditLabel}
            onNewSublabel={handleOpenNewSublabel}
            onChangeParent={(lbl) => setChangeParentLabel(lbl)}
            onDeleteLabel={handleDeleteLabel}
            onMoveMessages={handleMoveMessages}
            onAttachLabel={handleAttachLabel}
            theme={theme()}
            onSetTheme={handleSetTheme}
            onToggleTheme={() => handleSetTheme(theme() === "dark" ? "cloud_dancer" : "dark")}
          />

          {/* ── Message List Column (Dynamic Full-Width, 380px Split, or Hidden in Full Mode) ── */}
          <div
            class={`${
              (layoutMode() === "full" && selectedMsg()) || (isMobile() && selectedMsg())
                ? "hidden"
                : selectedMsg()
                ? "w-full md:w-[380px] md:min-w-[340px] md:max-w-[420px] md:flex-shrink-0"
                : "w-full flex-1"
            } transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] h-full overflow-hidden flex flex-col`}
          >
            {/* Label Filter Chip Row */}
            <Show when={activeLabel()}>
              <div class="px-3.5 py-2 bg-[#FAF9F6] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between text-xs flex-shrink-0">
                <div class="flex items-center gap-2 truncate min-w-0">
                  <span class="text-[#6F7173] dark:text-[#878A8E] text-[11px] font-medium flex-shrink-0">Label filter:</span>
                  <span
                    class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-white text-[11px] font-medium shadow-2xs truncate max-w-[280px]"
                    style={{ "background-color": activeLabel()!.color }}
                    title={activeLabel()!.path || activeLabel()!.name}
                  >
                    <span class="truncate">{activeLabel()!.path || activeLabel()!.name}</span>
                    <Show when={getSubtreeLabelIds(activeLabel()!.id, labels()).length > 1}>
                      <span class="text-[9px] opacity-80 flex-shrink-0">(or descendants)</span>
                    </Show>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveLabel(null)}
                  class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] text-xs hover:underline cursor-pointer flex-shrink-0 ml-2"
                >
                  Clear filter
                </button>
              </div>
            </Show>

            <div class="flex-1 min-h-0 overflow-hidden">
            <MessageList
              currentFolder={currentFolder()}
              messages={paginatedMessages()}
              selectedMessage={selectedMsg()}
              selectedIds={selectedIds()}
              isSplit={isMobile() || Boolean(selectedMsg())}
              onSelectMessage={openMessage}
              onToggleCheck={handleToggleCheck}
              onSelectFilter={handleSelectFilter}
              onClearSelection={() => setSelectedIds(new Set<string>())}
              onRefresh={() => {
                const box = selectedMailbox();
                if (box) {
                  loadMailboxData(box.id);
                  showToast("Mailbox refreshed");
                }
              }}
              sortOrder={sortOrder()}
              onSortChange={setSortOrder}
              searchQuery={searchQuery()}
              onSearchChange={setSearchQuery}
              currentPage={currentPage()}
              pageSize={pageSize}
              totalCount={sortedMessages().length}
              onPrevPage={() => setCurrentPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setCurrentPage((p) => p + 1)}
              onBatchArchive={handleBatchArchive}
              onBatchSpam={handleBatchSpam}
              onBatchTrash={handleBatchTrash}
              onBatchDeleteForever={handleBatchDeleteForever}
              onEmptyTrash={handleEmptyTrash}
              onBatchToggleRead={handleBatchToggleRead}
              onBatchToggleStarred={handleBatchToggleStarred}
              onBatchMoveTo={handleBatchMoveTo}
              onBatchToggleLabel={handleBatchToggleLabel}
              storageError={storageErrorBanner()}
              onDismissStorageError={() => setStorageErrorBanner(null)}
              isLoading={isLoading()}
              density={density()}
              onToggleStarred={toggleMessageStarred}
              onToggleRead={toggleMessageRead}
              onArchive={handleArchiveMessage}
              onTrash={handleTrashMessage}
              onDeleteForever={handleDeleteForever}
              customFolders={customFolders()}
              labels={labels()}
              theme={theme()}
              onSetTheme={handleSetTheme}
              onToggleTheme={() => handleSetTheme(theme() === "dark" ? "cloud_dancer" : "dark")}
              threads={filteredThreads()}
              viewMode={effectiveViewMode()}
              expandedThreadId={expandedThreadId()}
              onSelectThread={handleSelectThread}
              onOpenMobileMenu={() => setMobileSidebarOpen(true)}
              onToggleViewMode={() => setViewMode((prev) => (prev === "threads" ? "flat" : "threads"))}
              onToggleThreadCheck={handleToggleThreadCheck}
              focusedCategory={focusedCategory()}
              onSelectCategory={setFocusedCategory}
              categoryCounts={categoryCounts()}
              focusedInboxEnabled={focusedInboxEnabled()}
              onMoveToCategory={handleMoveToCategory}
              currentUserEmail={currentUser()?.email}
              currentUserPhotoUrl={profilePhotoUrl()}
            />
            </div>
          </div>

          {/* ── Reading Pane (Only mounted when selectedMsg()) ── */}
          <Show when={selectedMsg()}>
            <div class="flex-1 min-w-0 w-full h-full overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
              <ReadingPane
                message={selectedMsg()!}
                isDecrypting={isDecrypting()}
                decryptedContent={decryptedContent()}
                mailboxKey={mailboxKey()}
                senderVerification={senderVerification()}
                lockedAccount={lockedReadingAccount()}
                onUnlockAccount={(acc) => {
                  setUnlockAccountTarget(acc);
                  setUnlockAccountPassword("");
                  setUnlockAccountError(null);
                }}
                attachments={messageAttachments()}
                downloadingAttachmentId={downloadingAttachment()}
                onDownloadAttachment={handleDownloadAttachment}
                onBack={() => setSelectedMsg(null)}
                hasPrev={hasPrevMessage()}
                hasNext={hasNextMessage()}
                onPrev={handlePrevMessage}
                onNext={handleNextMessage}
                onArchive={handleArchiveMessage}
                onSnooze={handleSnoozeMessage}
                onSpam={(msg) => {
                  setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, folder: "spam" } : m)));
                  setSelectedMsg(null);
                  showToast("Moved to Spam");
                }}
                onTrash={handleTrashMessage}
                onDeleteForever={handleDeleteForever}
                onToggleRead={toggleMessageRead}
                onToggleStarred={toggleMessageStarred}
                onMoveTo={(msg, f) => handleMoveMessages([msg.id], f)}
                onReply={startReply}
                onForward={startForward}
                customFolders={customFolders()}
                labels={labels()}
                onToggleLabel={(msg, lid) => toggleMessageLabel([msg.id], lid)}
                onEditDraft={(msg) => {
                  if (editablePlaintext()) {
                    startEditDraft(msg, editablePlaintext()!);
                  }
                }}
                onDeleteDraft={handleDeleteMessage}
                onCancelScheduled={(msg) => handleCancelScheduled(msg)}
                onEditScheduled={(msg) => handleEditScheduled(msg)}
                currentUserEmail={currentUser()?.email}
                currentUserPhotoUrl={profilePhotoUrl()}
              />
            </div>
          </Show>
        </main>

      {/* ── Docking Compose Drawer ── */}
      <ComposeDrawer
        isOpen={composeOpen()}
        onClose={() => {
          if (composeBody().trim() || composeBodyHtml().trim() || composeSubject().trim()) {
            handleSaveDraft();
          } else {
            setComposeOpen(false);
            clearComposeForm();
            setComposeStatus(null);
          }
        }}
        to={composeTo()}
        onToChange={setComposeTo}
        subject={composeSubject()}
        onSubjectChange={setComposeSubject}
        body={composeBody()}
        onBodyChange={setComposeBody}
        bodyHtml={composeBodyHtml()}
        onBodyHtmlChange={setComposeBodyHtml}
        attachments={composeAttachments()}
        onAttachmentSelected={handleAttachmentSelected}
        onRemoveAttachment={removeComposeAttachment}
        scheduledTime={scheduledTime()}
        onScheduledTimeChange={setScheduledTime}
        trackOpens={composeTrackOpens()}
        onTrackOpensChange={setComposeTrackOpens}
        onSend={handleSend}
        onSaveDraft={handleSaveDraft}
        status={composeStatus()}
        errorMessage={errorMessage()}
        isEditingDraft={Boolean(editingDraft())}
        contacts={contacts()}
        mailboxId={selectedMailbox()?.id}
        connectedAccounts={connectedAccounts()}
        selectedAccountId={composeAccountId() || selectedMailbox()?.id}
        aliases={maskedAliases().filter((a) => a.is_enabled)}
        fromAlias={composeFromAlias()}
        onSelectFromAlias={(alias) => setComposeFromAlias(alias)}
        onSelectAccount={(id) => {
          setComposeFromAlias(null);
          setComposeAccountId(id);
          const sigPlain = loadSignature(id);
          const sigHtml = loadSignatureHtml(id);
          if (sigPlain) {
            setComposeBody(`\n\n-- \n${sigPlain}`);
          }
          if (sigHtml) {
            setComposeBodyHtml(`<p><br></p><div class="byos-signature"><p>-- </p>${sigHtml}</div>`);
          }
        }}
        isUnified={currentFolder() === "unified_inbox"}
        senderAddress={
          (() => {
            if (composeFromAlias()) return composeFromAlias()!;
            const accId = composeAccountId() || selectedMailbox()?.id;
            if (accId) {
              const acc = connectedAccounts().find((a) => a.id === accId);
              if (acc) return acc.email;
            }
            return selectedMailbox()
              ? `${selectedMailbox()!.local_part}@${currentUser()?.email.split("@")[1] || "byos.local"}`
              : currentUser()?.email || "";
          })()
        }
        onUploadInlineImage={async (file: File) => {
          const boxId = composeAccountId() || selectedMailbox()?.id;
          const key = boxId ? getMailboxKeyFor(boxId) : null;
          const localUrl = URL.createObjectURL(file);
          if (boxId && key && !isOffline()) {
            try {
              const att = await uploadEncryptedAttachment(boxId, file, key);
              return {
                storageRef: `byos-storage://${boxId}/${att.id}`,
                alt: file.name,
                localUrl,
              };
            } catch (err) {
              console.warn("Upload inline image failed, falling back to data URL:", err);
            }
          }
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          });
          return {
            storageRef: dataUrl,
            alt: file.name,
            localUrl,
          };
        }}
      />

      {/* Floating Optimistic Undo Toast */}
      <Show when={undoAction()}>
        <div class="fixed bottom-6 left-6 sm:left-72 z-40 bg-[#3C3D3E] text-white px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-3 text-xs font-sans border border-[#E2DFD8]/20">
          <span>Message moved to {undoAction()?.previousFolder === "inbox" ? "Archive" : "Trash"}</span>
          <button
            onClick={handleUndo}
            class="text-[#A27561] hover:text-[#c4927b] font-bold uppercase tracking-wider underline cursor-pointer"
          >
            Undo
          </button>
        </div>
      </Show>

      {/* ── Contacts Modal ── */}
      <Show when={contactsOpen() && selectedMailbox()}>
        <ContactsModal
          mailboxId={selectedMailbox()!.id}
          onClose={() => setContactsOpen(false)}
          onContactsUpdated={setContacts}
          onComposeTo={(email) => {
            clearComposeForm();
            setComposeTo(email);
            setComposeOpen(true);
          }}
        />
      </Show>

      {/* ── Add Mailbox Modal ── */}
      <AddMailboxModal
        isOpen={addMailboxModalOpen()}
        onClose={() => setAddMailboxModalOpen(false)}
        onSuccess={handleAccountAdded}
      />

      {/* ── Create Folder Modal ── */}
      <CreateFolderModal
        isOpen={createFolderModalOpen()}
        onClose={() => {
          setCreateFolderModalOpen(false);
          setFolderToEdit(null);
        }}
        folders={customFolders()}
        folderToEdit={folderToEdit()}
        onSave={handleSaveFolder}
      />

      {/* ── Create Label Modal ── */}
      <CreateLabelModal
        isOpen={createLabelModalOpen()}
        onClose={() => {
          setCreateLabelModalOpen(false);
          setLabelToEdit(null);
          setInitialParentLabelId(null);
        }}
        labelToEdit={labelToEdit()}
        initialParentId={initialParentLabelId()}
        allLabels={labels()}
        onSave={handleSaveLabel}
      />

      {/* ── Change Parent Modal ── */}
      <ChangeParentModal
        isOpen={Boolean(changeParentLabel())}
        onClose={() => setChangeParentLabel(null)}
        label={changeParentLabel()}
        allLabels={labels()}
        onSave={handleChangeParent}
      />

      {/* ── Import Emails Modal ── */}
      <ImportEmailsModal
        isOpen={importEmailsModalOpen()}
        onClose={() => setImportEmailsModalOpen(false)}
        mailboxId={selectedMailbox()?.id || ""}
        folders={customFolders()}
        userEmail={
          currentUser()?.email ||
          (selectedMailbox()
            ? `${selectedMailbox()!.local_part}@${currentUser()?.email?.split("@")[1] || "byos.local"}`
            : "")
        }
        onSuccess={() => {
          const box = selectedMailbox();
          if (box) {
            loadMailboxData(box.id);
            showToast("Emails successfully imported");
          }
        }}
      />

      {/* ── Shortcuts Help Modal ── */}
      <ShortcutsHelp
        open={shortcutsHelpOpen()}
        onClose={() => setShortcutsHelpOpen(false)}
      />

      {/* ── Unlock Account Modal (Rule 2) ── */}
      <Show when={unlockAccountTarget()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div class="w-full max-w-md rounded-2xl bg-white dark:bg-[#1E2025] shadow-2xl overflow-hidden flex flex-col border border-[#E2DFD8] dark:border-[#2E3138] font-sans">
            <div class="px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between">
              <h3 class="font-medium text-base text-[#2B2C2D] dark:text-[#F3F4F6]">
                Unlock {unlockAccountTarget()?.email}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setUnlockAccountTarget(null);
                  setUnlockAccountPassword("");
                  setUnlockAccountError(null);
                }}
                class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] p-1 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                aria-label="Close"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <form onSubmit={handlePerformUnlockAccount} class="p-6 space-y-4">
              <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA]">
                Enter your account password to decrypt and load end-to-end encryption keys for{" "}
                <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">{unlockAccountTarget()?.email}</span>.
              </p>

              <Show when={unlockAccountError()}>
                <div
                  data-testid="unlock-account-error"
                  class="rounded-xl bg-red-50 dark:bg-rose-950/40 p-3 text-xs text-red-700 dark:text-rose-400 border border-red-200 dark:border-rose-900/50"
                >
                  {unlockAccountError()}
                </div>
              </Show>

              <div class="space-y-1.5">
                <label class="block text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8]">
                  Password
                </label>
                <input
                  type="password"
                  data-testid="unlock-account-password-input"
                  value={unlockAccountPassword()}
                  onInput={(e) => setUnlockAccountPassword(e.currentTarget.value)}
                  placeholder="Enter password"
                  required
                  autofocus
                  class="w-full px-3 py-2 text-xs rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#18191D] text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setUnlockAccountTarget(null);
                    setUnlockAccountPassword("");
                    setUnlockAccountError(null);
                  }}
                  class="px-4 py-2 text-xs font-medium rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-[#6F7173] dark:text-[#A1A1AA] hover:bg-[#FAF9F7] dark:hover:bg-[#26282E] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="unlock-account-submit-btn"
                  disabled={unlockAccountBusy() || !unlockAccountPassword()}
                  class="px-5 py-2 text-xs font-semibold rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white transition disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {unlockAccountBusy() ? "Unlocking…" : "Unlock Mailbox"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* ── Global Notification Toasts ── */}
      <div
        class="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none"
        role="region"
        aria-label="Notifications"
      >
        <For each={toasts()}>
          {(toast) => (
            <div
              role="status"
              class="pointer-events-auto bg-[#3C3D3E] text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-3 text-xs font-sans border border-[#E2DFD8]/20 animate-fade-in"
            >
              <svg class="w-4 h-4 stroke-[#A27561] fill-none stroke-2 flex-shrink-0" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{toast.message}</span>
              <Show when={toast.action}>
                <button
                  type="button"
                  onClick={toast.action!.onClick}
                  class="ml-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-[#A27561] hover:bg-[#8F6452] text-white transition focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 cursor-pointer"
                >
                  {toast.action!.label}
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
      </div>
    </Show>
    </Show>
    </Show>
    </>
  );
};

export default App;
