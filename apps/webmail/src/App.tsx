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
  deleteAttachment,
  fetchMessages,
  fetchMessageBody,
  fetchOutboundPubkey,
  prepareOutbound,
  sendOutbound,
  scheduleOutbound,
  searchMailboxTokens,
  indexSearchToken,
  fetchMailboxSettings,
  updateMailboxSettings,
  registerTracking,
  fetchTrackingList,
  MessageTrackingItem,
  getTrackingPixelUrl,
  UserMe,
  Mailbox,
  DraftMessage,
  AttachmentItem,
  ContactItem,
  MailboxFolder,
  MailboxLabel,
  MessageMetadata,
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
} from "./api";
import {
  unlockMailboxKey,
  autoUnwrapMailboxKey,
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
} from "./message_crypto";
import { loadSignature, saveSignature, applySignature } from "./signature";
import { SetupAccount } from "./routes/setup-account";
import { SettingsLayout, SettingsTabId } from "./routes/settings/SettingsLayout";
import { SignaturesTab } from "./routes/settings/SignaturesTab";
import { BridgeTab } from "./routes/settings/BridgeTab";
import { AppearanceTab } from "./routes/settings/AppearanceTab";
import { AutoReplyTab } from "./routes/settings/AutoReplyTab";
import { SecurityTab } from "./routes/settings/SecurityTab";
import { FiltersTab } from "./routes/settings/FiltersTab";
import { ComposeDrawer } from "./components/ComposeDrawer";
import { StorageStatusPill } from "./components/StorageStatusPill";
import { Sidebar } from "./components/Sidebar";
import { MessageList } from "./components/MessageList";
import { ReadingPane } from "./components/ReadingPane";
import { SelectionFilter, SortOrder } from "./components/InboxToolbar";
import { AddMailboxModal } from "./components/AddMailboxModal";
import { CreateLabelModal } from "./components/modals/CreateLabelModal";
import { CreateFolderModal } from "./components/modals/CreateFolderModal";
import { ImportEmailsModal } from "./components/modals/ImportEmailsModal";
import { formatMessageDate } from "./utils/dateTime";

type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

interface DisplayMessage {
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
}

const App: Component = () => {
  const [currentUser, setCurrentUser] = createSignal<UserMe | null>(null);
  const [mailboxes, setMailboxes] = createSignal<Mailbox[]>([]);
  const [selectedMailbox, setSelectedMailbox] = createSignal<Mailbox | null>(null);
  const [currentFolder, setCurrentFolder] = createSignal<Folder>("inbox");
  const [messages, setMessages] = createSignal<DisplayMessage[]>([]);
  const [selectedMsg, setSelectedMsg] = createSignal<DisplayMessage | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [composeOpen, setComposeOpen] = createSignal(false);
  const [isDecrypting, setIsDecrypting] = createSignal(false);
  const [decryptedContent, setDecryptedContent] = createSignal<string | null>(null);
  // Plaintext available for editing. Set ONLY on successful decrypt — the
  // Edit action must never load a locked/error placeholder into compose.
  const [editablePlaintext, setEditablePlaintext] = createSignal<string | null>(null);
  // Message plaintext for reply/forward quoting. Same discipline: success-only.
  const [messagePlaintext, setMessagePlaintext] = createSignal<string | null>(null);
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
  const [searchKey, setSearchKey] = createSignal<string | null>(null);
  const [serverMatchedMsgIds, setServerMatchedMsgIds] = createSignal<string[]>([]);
  const [isSearchingTokens, setIsSearchingTokens] = createSignal(false);
  const [unlockedBoxId, setUnlockedBoxId] = createSignal<string | null>(null);
  const [storageErrorBanner, setStorageErrorBanner] = createSignal<string | null>(null);

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
  const [scheduledTime, setScheduledTime] = createSignal("");
  const [composeTrackOpens, setComposeTrackOpens] = createSignal(false);
  const [composeStatus, setComposeStatus] = createSignal<string | null>(null);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [composeAttachments, setComposeAttachments] = createSignal<AttachmentItem[]>([]);
  // When set, saving updates this draft (optimistic version) instead of creating.
  const [editingDraft, setEditingDraft] = createSignal<{ id: string; version: number } | null>(null);

  // Settings suite & Layout preferences
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [activeSettingsTab, setActiveSettingsTab] = createSignal<SettingsTabId>("signatures");
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

  function toggleMessageStarred(msg: DisplayMessage) {
    const origStarred = msg.starred;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, starred: !origStarred } : m))
    );
    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg({ ...selectedMsg()!, starred: !origStarred });
    }
  }

  function toggleMessageRead(msg: DisplayMessage) {
    const origRead = msg.read;
    const newRead = !origRead;
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, read: newRead } : m))
    );
    if (selectedMsg()?.id === msg.id) {
      setSelectedMsg({ ...selectedMsg()!, read: newRead });
    }
    const box = selectedMailbox();
    if (box) {
      setMessageRead(box.id, msg.id, newRead).catch((err) => {
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

    const box = selectedMailbox();
    if (box) {
      const backendFolder = customFolder ? "custom" : targetFolder;
      messageIds.forEach((id) => {
        updateMessageFolder(box.id, id, backendFolder, newFolderId).catch((err) => {
          console.error("Failed to update message folder:", err);
        });
      });
    }

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

  // Contacts manager state. Plaintext contacts live only in memory while the
  // mailbox is unlocked; the server stores opaque envelopes exclusively.
  interface DisplayContact extends ContactPlaintext {
    id: string;
    version: number;
  }
  const [contactsOpen, setContactsOpen] = createSignal(false);
  const [contacts, setContacts] = createSignal<DisplayContact[]>([]);
  const [contactsLoading, setContactsLoading] = createSignal(false);
  const [contactsError, setContactsError] = createSignal<string | null>(null);
  const [editingContact, setEditingContact] = createSignal<DisplayContact | null>(null);
  const [contactName, setContactName] = createSignal("");
  const [contactEmail, setContactEmail] = createSignal("");
  const [contactNotes, setContactNotes] = createSignal("");

  // Multi-Mailbox state & toast notifications
  const [connectedAccounts, setConnectedAccounts] = createSignal<ConnectedAccount[]>([]);
  const [addMailboxModalOpen, setAddMailboxModalOpen] = createSignal(false);
  const [toastMessage, setToastMessage] = createSignal<string | null>(null);
  let toastTimer: any = null;

  function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer);
    setToastMessage(msg);
    toastTimer = setTimeout(() => setToastMessage(null), 3500);
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

  async function handleSaveLabel(name: string, color: string, colorName: string) {
    const box = selectedMailbox();
    if (!box) return;
    const editing = labelToEdit();
    const cleanName = name.trim();
    if (!cleanName) return;

    // Deduplication check (case-insensitive)
    const duplicate = labels().some(
      (l) => l.name.trim().toLowerCase() === cleanName.toLowerCase() && (!editing || l.id !== editing.id)
    );
    if (duplicate) {
      showToast(`Label "${cleanName}" already exists`);
      return;
    }

    try {
      if (editing) {
        const updated = await updateLabel(box.id, editing.id, { name: cleanName, color, color_name: colorName });
        setLabels((prev) =>
          prev.map((l) => (l.id === editing.id ? updated : l)).sort((a, b) => a.name.localeCompare(b.name))
        );
        if (activeLabel()?.id === editing.id) {
          setActiveLabel(updated);
        }
        setLabelToEdit(null);
        showToast(`Label "${cleanName}" updated`);
      } else {
        const created = await createLabel(box.id, { name: cleanName, color, color_name: colorName });
        setLabels((prev) => {
          const exists = prev.some((l) => l.id === created.id || l.name.trim().toLowerCase() === cleanName.toLowerCase());
          if (exists) return prev;
          return [...prev, created].sort((a, b) => a.name.localeCompare(b.name));
        });
        showToast(`Label "${cleanName}" created`);
      }
    } catch (err: any) {
      showToast(err?.message || "Failed to save label");
    }
  }

  function handleOpenEditLabel(label: MailboxLabel) {
    setLabelToEdit(label);
    setCreateLabelModalOpen(true);
  }

  async function handleDeleteLabel(label: MailboxLabel) {
    const box = selectedMailbox();
    if (!box) return;
    if (!confirm(`Delete label "${label.name}"?`)) return;
    try {
      await deleteLabel(box.id, label.id);
      setLabels((prev) => prev.filter((l) => l.id !== label.id));
      if (activeLabel()?.id === label.id) {
        setActiveLabel(null);
      }
      // Detach label from all messages in memory
      setMessages((prev) =>
        prev.map((m) =>
          m.labelIds ? { ...m, labelIds: m.labelIds.filter((lid) => lid !== label.id) } : m
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

  async function bootstrapSession(user: UserMe, password?: string, sessionToken?: string) {
    setCurrentUser(user);
    const boxes = await fetchMailboxes(user.org_id);
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
      targetBox = boxes[0];
    }

    if (targetBox) {
      setMailboxes([targetBox]);
      setSelectedMailbox(targetBox);
      refreshSignature(targetBox.id);

      let currentSkHex = "";
      let currentSKey = "";

      // Automated key unwrapping upon login (Section 14 / Section 15)
      const wrappedSk = user.wrapped_sk_user || targetBox.wrapped_sk_user;
      if (password && wrappedSk) {
        try {
          const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
          const skBytes = autoUnwrapMailboxKey(wasm, password, wrappedSk);
          currentSkHex = Array.from(skBytes, (b) => b.toString(16).padStart(2, "0")).join("");
          currentSKey = wasm.wasm_derive_search_key(currentSkHex);
          setMailboxKey(skBytes);
          setSearchKey(currentSKey);
          setUnlockedBoxId(targetBox.id);
          sessionStorage.setItem("byos_mailbox_sk_" + targetBox.id, currentSkHex);
          sessionStorage.setItem("byos_mailbox_skey_" + targetBox.id, currentSKey);
        } catch (err) {
          console.warn("Auto-unwrap of mailbox key failed:", err);
        }
      } else if (!password) {
        // Restore from sessionStorage if user refreshed during an active session
        const savedSk = sessionStorage.getItem("byos_mailbox_sk_" + targetBox.id);
        const savedSKey = sessionStorage.getItem("byos_mailbox_skey_" + targetBox.id);
        if (savedSk) {
          try {
            const bytes = new Uint8Array(savedSk.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
            setMailboxKey(bytes);
            if (savedSKey) setSearchKey(savedSKey);
            setUnlockedBoxId(targetBox.id);
            currentSkHex = savedSk;
            currentSKey = savedSKey || "";
          } catch {
            sessionStorage.removeItem("byos_mailbox_sk_" + targetBox.id);
            sessionStorage.removeItem("byos_mailbox_skey_" + targetBox.id);
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
      };

      const savedAccountsStr = sessionStorage.getItem("byos_connected_accounts");
      let list: ConnectedAccount[] = [];
      if (savedAccountsStr) {
        try {
          list = JSON.parse(savedAccountsStr);
        } catch {}
      }
      if (!Array.isArray(list)) list = [];
      list = list.filter((a) => a.id !== activeAcc.id && a.email.toLowerCase() !== activeAcc.email.toLowerCase());
      list.unshift(activeAcc);
      sessionStorage.setItem("byos_connected_accounts", JSON.stringify(list));
      setConnectedAccounts(list);

      await loadMailboxData(targetBox.id);
    } else {
      setMailboxes([]);
      setSelectedMailbox(null);
    }
  }

  async function handleSwitchAccount(account: ConnectedAccount) {
    setIsLoading(true);
    try {
      // 1. Set active session token
      if (account.sessionToken) {
        sessionStorage.setItem("byos_active_session_token", account.sessionToken);
      }

      // 2. Set active cryptographic keys in memory
      if (account.mailboxSkHex) {
        try {
          const bytes = new Uint8Array(account.mailboxSkHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
          setMailboxKey(bytes);
          setSearchKey(account.searchKeyHex);
          setUnlockedBoxId(account.id);
          sessionStorage.setItem("byos_mailbox_sk_" + account.id, account.mailboxSkHex);
          sessionStorage.setItem("byos_mailbox_skey_" + account.id, account.searchKeyHex);
        } catch (err) {
          console.warn("Failed restoring mailbox key on switch:", err);
        }
      } else {
        setMailboxKey(null);
        setSearchKey(null);
        setUnlockedBoxId(null);
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

      // 4. Reload messages, drafts, folders
      await loadMailboxData(account.id);
      refreshSignature(account.id);
    } catch (err) {
      console.error("Failed to switch account:", err);
    } finally {
      setIsLoading(false);
    }
  }

  function handleAccountAdded(account: ConnectedAccount) {
    setConnectedAccounts((prev) => {
      const filtered = prev.filter((a) => a.id !== account.id && a.email.toLowerCase() !== account.email.toLowerCase());
      return [account, ...filtered];
    });
    setAddMailboxModalOpen(false);
    handleSwitchAccount(account);
    showToast(`Connected ${account.email} successfully`);
  }

  async function handleExitImpersonation() {
    sessionStorage.removeItem("byos_impersonation_token");
    try {
      await logout();
    } catch {}
    window.location.href = "http://127.0.0.1:3000/dashboard/mailboxes";
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (selectedMsg()) {
        setSelectedMsg(null);
      } else if (selectedIds().size > 0) {
        setSelectedIds(new Set<string>());
      }
    }
  }

  onMount(async () => {
    window.addEventListener("keydown", handleKeyDown);

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

    // Restore connected accounts list if present in sessionStorage
    const savedAccountsStr = sessionStorage.getItem("byos_connected_accounts");
    if (savedAccountsStr) {
      try {
        const list = JSON.parse(savedAccountsStr);
        if (Array.isArray(list)) {
          setConnectedAccounts(list);
        }
      } catch {}
    }

    setIsLoading(true);
    try {
      const user = await fetchCurrentUser();
      if (user) {
        await bootstrapSession(user);
      }
    } catch (err) {
      console.warn("Failed loading user/mailbox data on mount:", err);
    } finally {
      setIsLoading(false);
    }
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
  });

  async function handleLogin(e: Event) {
    e.preventDefault();
    const email = loginEmail().trim();
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
        sessionStorage.setItem("byos_active_session_token", loginRes.token);
      }
      const user = await fetchCurrentUser();
      if (!user) throw new Error("Session was not established.");
      if (loginRes.wrapped_sk_user && !user.wrapped_sk_user) {
        user.wrapped_sk_user = loginRes.wrapped_sk_user;
      }
      await bootstrapSession(user, password, loginRes.token);
    } catch (err) {
      setLoginError("Invalid email or password.");
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
      const user = await fetchCurrentUser();
      if (!user) throw new Error("Session was not established.");
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

      const allowCreds = opts.allowCredentials?.map((c) => ({
        id: base64URLToBuffer(c.id),
        type: "public-key" as const,
      }));

      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: base64URLToBuffer(opts.challenge),
          rpId: opts.rpId,
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
      setConnectedAccounts([]);
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key && (key.startsWith("byos_mailbox_sk_") || key.startsWith("byos_mailbox_skey_"))) {
          sessionStorage.removeItem(key);
        }
      }
      setIsImpersonating(false);
      try {
        await logout();
      } catch (err) {
        console.warn("Server logout failed, clearing local session anyway:", err);
      }
      lockMailbox();
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

    // 1. Remove target account keys from sessionStorage
    sessionStorage.removeItem("byos_mailbox_sk_" + targetId);
    sessionStorage.removeItem("byos_mailbox_skey_" + targetId);

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

    // 4. If target was active account, smoothly switch to the first remaining account
    if (targetId === currentBoxId && remaining.length > 0) {
      await handleSwitchAccount(remaining[0]);
      showToast(`Signed out of ${targetEmail}. Switched to ${remaining[0].email}.`);
    } else {
      showToast(`Signed out of ${targetEmail}.`);
    }
  }

  async function loadMailboxData(mailboxId: string) {
    try {
      setStorageErrorBanner(null);
      const [draftsList, messageList, folderList, labelList, attachmentList] = await Promise.all([
        fetchDrafts(mailboxId),
        fetchMessages(mailboxId),
        fetchFolders(mailboxId),
        fetchLabels(mailboxId),
        fetchAttachments(mailboxId).catch(() => []),
      ]);

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

      const realMessages: DisplayMessage[] = messageList.map((m: MessageMetadata) => {
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

        return {
          id: m.id,
          messageId: m.id, // For attachment filtering
          messageSeq: m.message_seq,
          folder: (m.folder === "custom" ? "inbox" : (m.folder as Folder)) || (m.direction === "sent" ? "sent" : "inbox"),
          folderId: m.folder_id || null,
          labelIds: m.label_ids || [],
          sender: m.sender,
          recipient: m.recipients.join(", "),
          subject: cachedSubject || "(Encrypted message)",
          snippet: cachedSnippet || `Encrypted payload • ${m.storage_object_id}`,
          encryptedBody: m.storage_object_id,
          date: formatMessageDate(m.sent_at || m.received_at, timeFormat(), language()),
          read: m.is_read ?? false,
          starred: false,
          isRealApi: true,
          hasAttachments: m.has_attachments || msgAtts.length > 0,
          attachmentCount: attCount,
          attachmentTypes: uniqueTypes,
        };
      });
      const key = mailboxKey();
      const keyBoxId = unlockedBoxId();
      let wasm: typeof import("./generated/crypto-core/byos_crypto_core.js") | null = null;
      if (key && keyBoxId === mailboxId) {
        try {
          wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        } catch {
          wasm = null;
        }
      }
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
          subject: d.subject || "(no subject)",
          snippet,
          encryptedBody: d.encrypted_envelope || "Encrypted draft envelope",
          date: formatMessageDate(d.created_at, timeFormat(), language()),
          read: true,
          starred: false,
          isRealApi: true,
        };
      });

      setMessages([...realMessages, ...draftMessages]);

      // Background preview decryptor for visible real messages
      if (key && wasm && keyBoxId === mailboxId) {
        (async () => {
          for (const m of realMessages) {
            if (sessionStorage.getItem("byos_msg_subject_" + m.id)) continue;
            try {
              const body = await fetchMessageBody(mailboxId, m.id);
              const plaintext = decryptMessageEnvelope(wasm!, key!, mailboxId, {
                message_seq: m.messageSeq!,
                encryption_version: body.encryption_version,
                encrypted_body: body.encrypted_body,
                content_key_hpke_wrapped: body.content_key_hpke_wrapped,
              });
              let sub = m.subject;
              const subMatch = plaintext.match(/^Subject:\s*(.*)$/im);
              if (subMatch && subMatch[1]) sub = subMatch[1].trim();
              const bodyParts = plaintext.split(/\r?\n\r?\n/);
              const bodyText = bodyParts.length > 1 ? bodyParts.slice(1).join("\n\n") : plaintext;
              const snip = bodyText.trim().slice(0, 100).replace(/\s+/g, " ");

              sessionStorage.setItem("byos_msg_subject_" + m.id, sub);
              sessionStorage.setItem("byos_msg_snippet_" + m.id, snip);

              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === m.id ? { ...msg, subject: sub, snippet: snip } : msg
                )
              );
            } catch {}
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
    } catch (err) {
      console.warn("Error loading mailbox data:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("503") || msg.includes("storage_disconnected") || msg.includes("storage disconnected")) {
        setStorageErrorBanner("Mailbox storage is currently disconnected or unreachable. Inbound emails are held safely at the mail transfer agent and will deliver automatically once storage is reconnected.");
      }
    }
  }

  function lockMailbox() {
    setMailboxKey(null);
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
    setEditingContact(null);
    setContactName("");
    setContactEmail("");
    setContactNotes("");
    setContactsError(null);
    setCustomFolders([]);
    setLabels([]);
    setActiveCustomFolder(null);
    setActiveLabel(null);
  }

  const filteredMessages = () => {
    const q = searchQuery().toLowerCase().trim();
    const matchedIds = new Set(serverMatchedMsgIds());
    return messages().filter((m) => {
      let matchFolder = false;
      const customFolder = activeCustomFolder();
      const label = activeLabel();

      if (customFolder) {
        matchFolder = m.folderId === customFolder.id && m.folder !== "trash";
      } else if (label) {
        matchFolder = Boolean(m.labelIds?.includes(label.id)) && m.folder !== "trash";
      } else {
        const cur = currentFolder();
        if (cur === "inbox") {
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
      return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    if (order === "oldest") {
      return list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }
    if (order === "unread") {
      return list.sort((a, b) => {
        if (a.read === b.read) {
          return new Date(b.date).getTime() - new Date(a.date).getTime();
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
    const sKey = searchKey();
    const box = selectedMailbox();
    if (!q || !sKey || !box) {
      setServerMatchedMsgIds([]);
      return;
    }
    const keywords = extractKeywords(q);
    if (keywords.length === 0) {
      setServerMatchedMsgIds([]);
      return;
    }
    let cancelled = false;
    setIsSearchingTokens(true);
    (async () => {
      try {
        const matched = new Set<string>();
        for (const kw of keywords) {
          const tokenHex = await computeSearchToken(sKey, kw);
          if (cancelled) return;
          const ids = await searchMailboxTokens(box.id, tokenHex);
          if (cancelled) return;
          for (const id of ids) matched.add(id);
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
    const box = selectedMailbox();
    if (!box) return;

    setDownloadingAttachment(att.id);
    try {
      const key = mailboxKey();
      if (key && unlockedBoxId() === box.id) {
        // Decrypt locally with the unlocked mailbox key.
        const decrypted = await downloadAndDecryptAttachment(box.id, att.id, key);
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
      const encryptedBlob = await downloadAttachment(box.id, att.id);
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

    // Mark as read (optimistic + persist)
    if (!msg.read) {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
      );
      const box = selectedMailbox();
      if (box) {
        setMessageRead(box.id, msg.id, true).catch(() => {});
      }
    }

    const box = selectedMailbox();
    if (!box) {
      if (seq === currentDecryptSeq) {
        setDecryptedContent("No mailbox selected.");
        setIsDecrypting(false);
      }
      return;
    }

    try {
      // Drafts live outside message_metadata: decrypt the stored envelope
      // directly instead of fetching a message body (which would 404).
      if (msg.folder === "drafts") {
        const key = mailboxKey();
        if (!key || unlockedBoxId() !== box.id) {
          if (seq === currentDecryptSeq) {
            setDecryptedContent("Mailbox is locked. Please sign in with your password to read this draft.");
            setIsDecrypting(false);
          }
          return;
        }
        const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        const plaintext = decryptDraftEnvelope(wasm, key, box.id, msg.encryptedBody);
        if (seq === currentDecryptSeq) {
          setDecryptedContent(plaintext);
          setEditablePlaintext(plaintext);
          setIsDecrypting(false);
        }
        return;
      }
      const [body, allAttachments] = await Promise.all([
        fetchMessageBody(box.id, msg.id),
        fetchAttachments(box.id).catch(() => []),
      ]);

      if (seq !== currentDecryptSeq) return;

      // Fetch attachments for this message - use stable msg.id with fallback for legacy messageId
      const targetId = msg.messageId ?? msg.id;
      const msgAttachments = allAttachments.filter((a) => {
        const attMessageId = a.message_id ?? (a as unknown as { messageId?: string }).messageId;
        return attMessageId != null && attMessageId !== "" && attMessageId === targetId;
      });
      if (seq === currentDecryptSeq) {
        setMessageAttachments(msgAttachments);
      }

      // Decrypt locally when unlocked. The key, phrase, and plaintext never
      // leave the browser; failures show a generic message, never key material.
      const key = mailboxKey();
      if (!key || unlockedBoxId() !== box.id || msg.messageSeq === undefined) {
        if (seq === currentDecryptSeq) {
          setDecryptedContent("Mailbox is locked. Please sign in with your password to decrypt this message.");
          setIsDecrypting(false);
        }
        return;
      }
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const plaintext = decryptMessageEnvelope(wasm, key, box.id, {
        message_seq: msg.messageSeq,
        encryption_version: body.encryption_version,
        encrypted_body: body.encrypted_body,
        content_key_hpke_wrapped: body.content_key_hpke_wrapped,
      });

      let extractedSubject = msg.subject;
      let extractedBody = plaintext;
      const subMatch = plaintext.match(/^Subject:\s*(.*)$/im);
      if (subMatch && subMatch[1]) {
        extractedSubject = subMatch[1].trim();
      }
      const bodyParts = plaintext.split(/\r?\n\r?\n/);
      if (bodyParts.length > 1) {
        extractedBody = bodyParts.slice(1).join("\n\n");
      }
      const extractedSnippet = extractedBody.trim().slice(0, 100).replace(/\s+/g, " ");

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
        setDecryptedContent(extractedBody.trim() || plaintext);
        setMessagePlaintext(extractedBody.trim() || plaintext);
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
              await indexSearchToken(box.id, msg.id, tokenHex);
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

  async function handleAttachmentSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const box = selectedMailbox();
    const key = mailboxKey();
    // Attachments must be encrypted with the real per-mailbox key before
    // transit. Without an unlocked mailbox there is no key, so refuse —
    // never fall back to a constant or fabricated key.
    if (!box || !key || unlockedBoxId() !== box.id) {
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

  async function openContacts() {
    const box = selectedMailbox();
    const key = mailboxKey();
    if (!box || !key || unlockedBoxId() !== box.id) {
      setContactsError("Please sign in with your password to view contacts.");
      setContacts([]);
      setContactsOpen(true);
      return;
    }
    setContactsOpen(true);
    setContactsLoading(true);
    setContactsError(null);
    try {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const items = await fetchContacts(box.id);
      const shown: DisplayContact[] = [];
      for (const c of items) {
        try {
          const pt = decryptContactEnvelope(wasm, key, box.id, c.encrypted_envelope);
          shown.push({ id: c.id, version: c.version, ...pt });
        } catch {
          // Skip unreadable or corrupted envelopes to keep contact list clean
        }
      }
      setContacts(shown);
    } catch (err) {
      setContactsError(`Failed to load contacts: ${err instanceof Error ? err.message : "unknown error"}`);
      setContacts([]);
    } finally {
      setContactsLoading(false);
    }
  }

  function startEditContact(c: DisplayContact | null) {
    setEditingContact(c);
    setContactName(c?.name ?? "");
    setContactEmail(c?.email ?? "");
    setContactNotes(c?.notes ?? "");
    setContactsError(null);
  }

  async function handleSaveContact() {
    const box = selectedMailbox();
    const key = mailboxKey();
    if (!box || !key || unlockedBoxId() !== box.id) {
      setContactsError("Please sign in with your password to view contacts.");
      return;
    }
    const name = contactName().trim();
    const email = contactEmail().trim();
    const notes = contactNotes().trim();
    if (!name) {
      setContactsError("Contact name is required.");
      return;
    }
    if (!email.includes("@")) {
      setContactsError("Contact email must contain @.");
      return;
    }
    setContactsError(null);
    try {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const envelope = encryptContactEnvelope(wasm, key, box.id, { name, email, notes });
      const editing = editingContact();
      if (editing) {
        try {
          const updated = await updateContact(box.id, editing.id, {
            encrypted_envelope: envelope,
            version: editing.version,
          });
          setContacts((prev) =>
            prev.map((c) =>
              c.id === editing.id ? { ...c, name, email, notes, version: updated.version } : c
            )
          );
        } catch (err: any) {
          if (err?.status === 409) {
            setContactsError("This contact changed elsewhere. Reload to get the latest version.");
            await openContacts();
          } else {
            throw err;
          }
          return;
        }
      } else {
        const created = await createContact(box.id, { encrypted_envelope: envelope });
        setContacts((prev) => [{ id: created.id, version: created.version, name, email, notes }, ...prev]);
      }
      startEditContact(null);
    } catch (err) {
      setContactsError(`Failed to save contact: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  async function handleDeleteContact(id: string) {
    const box = selectedMailbox();
    if (!box) return;
    if (!window.confirm("Delete this contact? This cannot be undone.")) return;
    try {
      await deleteContact(box.id, id);
      setContacts((prev) => prev.filter((c) => c.id !== id));
      if (editingContact()?.id === id) startEditContact(null);
    } catch (err) {
      setContactsError(`Failed to delete contact: ${err instanceof Error ? err.message : "unknown error"}`);
    }
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
  }

  function startEditDraft(msg: DisplayMessage, plaintext: string) {
    setComposeTo(msg.recipient === "(no recipient)" ? "" : msg.recipient);
    setComposeSubject(msg.subject === "(no subject)" ? "" : msg.subject);
    setComposeBody(plaintext);
    setScheduledTime("");
    setComposeAttachments([]);
    setEditingDraft({ id: msg.id, version: msg.version ?? 1 });
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
    setComposeTo(msg.sender);
    setComposeSubject(withSubjectPrefix(msg.subject, "Re:"));
    setComposeBody(quoteOriginal(msg, plaintext));
    setScheduledTime("");
    setComposeAttachments([]);
    setEditingDraft(null);
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
        ? `\n[Note: ${messageAttachments().length} original attachment(s) not carried by forwarding in V1.]\n`
        : "";
    setComposeTo("");
    setComposeSubject(withSubjectPrefix(msg.subject, "Fwd:"));
    setComposeBody(
      `${attachNote}\n--- Forwarded message from ${msg.sender} (${msg.date}) ---\n${plaintext}`
    );
    setScheduledTime("");
    setComposeAttachments([]);
    setEditingDraft(null);
    setComposeOpen(true);
  }

  async function handleSend(e: Event) {
    e.preventDefault();
    const to = composeTo().trim();
    const subject = composeSubject().trim();
    const body = composeBody();
    if (!to || !subject || !body.trim()) return;

    setErrorMessage(null);
    const box = selectedMailbox();

    if (!box) {
      setErrorMessage("Select a mailbox before sending.");
      return;
    }

    setComposeStatus("Preparing encrypted message…");
    try {
      const [pubkey, reservation] = await Promise.all([
        fetchOutboundPubkey(),
        prepareOutbound(box.id),
      ]);
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const mailboxIdHex = box.id.replace(/-/g, "");
      const signedBody = applySignature(body, loadSignature(box.id));
      const htmlBody = composeBodyHtml();

      let trackingToken: string | undefined;
      if (composeTrackOpens()) {
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

      let mimeMessage: string;
      const trackingPixelHtml = trackingToken
        ? `<img src="${getTrackingPixelUrl(trackingToken)}" alt="" width="1" height="1" style="display:none !important; width:1px; height:1px; border:0;" />`
        : "";

      if (htmlBody && htmlBody.trim() && htmlBody !== body) {
        const fullHtml = trackingPixelHtml ? `${htmlBody}\r\n${trackingPixelHtml}` : htmlBody;
        const boundary = "----=_Part_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        mimeMessage = [
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
        mimeMessage = [
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
        mimeMessage = [
          `To: ${to}`,
          `Subject: ${subject}`,
          "Content-Type: text/plain; charset=utf-8",
          "MIME-Version: 1.0",
          "",
          signedBody,
        ].join("\r\n");
      }

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

      const attIDs = composeAttachments().map((a) => a.id);

      if (scheduledTime()) {
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
          scheduled_at: new Date(scheduledTime()).toISOString(),
          attachment_ids: attIDs.length > 0 ? attIDs : undefined,
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
        });
      }

      setComposeStatus(scheduledTime() ? "Encrypted message scheduled." : "Encrypted message queued for delivery.");
      setComposeOpen(false);
      clearComposeForm();
    } catch (err) {
      setErrorMessage(`Failed to send securely: ${err instanceof Error ? err.message : "unknown error"}`);
      setComposeStatus(null);
    }
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async function handleSaveDraft() {
    const to = composeTo().trim();
    const subject = composeSubject().trim();
    const body = composeBody();
    const box = selectedMailbox();
    if (!box) return;

    // Draft bodies are ciphertext-only server-side. Refuse to submit anything
    // the client has not actually encrypted: no plaintext envelope may reach
    // the drafts API.
    const key = mailboxKey();
    if (!key || unlockedBoxId() !== box.id) {
      setErrorMessage("Sign in again to save drafts.");
      setComposeStatus(null);
      return;
    }

    setComposeStatus("Saving draft to mailbox storage…");
    try {
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const envelope = encryptDraftEnvelope(wasm, key, box.id, body);
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
                    subject: subject || "(no subject)",
                    snippet: body.slice(0, 80) + (body.length > 80 ? "…" : ""),
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
        subject: subject || "Untitled Draft",
        snippet: body.slice(0, 80) + (body.length > 80 ? "…" : ""),
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

  const folderNames: Record<Folder, string> = {
    inbox: "Inbox",
    sent: "Sent",
    drafts: "Drafts",
    archive: "Archive",
    spam: "Spam",
    trash: "Trash",
  };

  const folderCounts = () => {
    const counts: Record<Folder, number> = {
      inbox: 0,
      sent: 0,
      drafts: 0,
      archive: 0,
      spam: 0,
      trash: 0,
    };
    for (const m of messages()) {
      if (m.folder === "trash") {
        counts.trash++;
      } else {
        if (m.folder === "inbox") {
          // Exclude messages in custom folders from inbox count
          if (!m.folderId) {
            counts.inbox++;
          }
        } else if (counts[m.folder] !== undefined) {
          counts[m.folder]++;
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
    const counts: Record<string, number> = {};
    for (const m of messages()) {
      if (m.folder !== "trash" && m.labelIds) {
        for (const lid of m.labelIds) {
          counts[lid] = (counts[lid] || 0) + 1;
        }
      }
    }
    return counts;
  };

  return (
    <Show when={!isSetupAccount()} fallback={<SetupAccount />}>
      <Show
        when={(currentUser() !== null && mailboxKey() !== null) || isLoading()}
        fallback={
          <div class="flex h-screen w-screen items-center justify-center bg-[#F0EEE9] p-4">
            <div class="w-full max-w-sm rounded-2xl bg-white shadow-xl border border-[#E2DFD8] p-8">
              <div class="flex items-center gap-2">
                <span class="text-xl font-bold tracking-wider text-[#3C3D3E]">BYOS</span>
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
                          <p class="mt-2 text-sm text-[#6F7173]">Sign in to access your encrypted mailbox.</p>
                          <Show when={loginError()}>
                            <div role="alert" class="mt-4 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
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
                              class="w-full rounded-xl border border-[#E2DFD8] px-3 py-2 text-xs focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6]"
                            />
                            <div>
                              <input
                                type="password"
                                autocomplete="current-password"
                                placeholder="Password"
                                value={loginPassword()}
                                onInput={(e) => setLoginPassword(e.currentTarget.value)}
                                disabled={loginBusy()}
                                class="w-full rounded-xl border border-[#E2DFD8] px-3 py-2 text-xs focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6]"
                              />
                              <div class="flex justify-end mt-1.5">
                                <button
                                  type="button"
                                  onClick={handleOpenForgotPassword}
                                  class="text-[11px] text-[#A27561] hover:underline cursor-pointer font-medium"
                                >
                                  Forgot password?
                                </button>
                              </div>
                            </div>
                            <button
                              type="submit"
                              disabled={loginBusy() || !loginEmail().trim() || !loginPassword()}
                              class="w-full rounded-xl bg-[#A27561] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer shadow-2xs"
                            >
                              {loginBusy() ? "Signing in…" : "Sign in"}
                            </button>
                            <div class="relative flex py-1 items-center">
                              <div class="flex-grow border-t border-[#E2DFD8]"></div>
                              <span class="flex-shrink mx-3 text-[10px] uppercase tracking-wider text-[#878A8E] font-medium">or</span>
                              <div class="flex-grow border-t border-[#E2DFD8]"></div>
                            </div>
                            <button
                              type="button"
                              onClick={handlePasskeyLogin}
                              disabled={loginBusy()}
                              class="w-full rounded-xl border border-[#E2DFD8] hover:border-[#A27561] bg-white hover:bg-[#FAF9F6] px-4 py-2 text-xs font-medium text-[#2B2C2D] transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
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
                            <h2 class="text-sm font-semibold text-[#3C3D3E]">Two-Step Verification</h2>
                            <p class="text-[11px] text-[#6F7173]">Security challenge required</p>
                          </div>
                        </div>

                        <p class="mt-3 text-xs text-[#6F7173] leading-relaxed">
                          {twoFactorChallenge()?.preferred_method === "totp"
                            ? "Enter the 6-digit code from your authenticator app to complete sign in."
                            : `Enter the 6-digit security code sent to ${twoFactorChallenge()?.destination_masked}.`}
                        </p>

                        <Show when={twoFactorError()}>
                          <div role="alert" class="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-700">
                            {twoFactorError()}
                          </div>
                        </Show>

                        <form onSubmit={handleVerifyLogin2FA} class="mt-4 space-y-3">
                          <div>
                            <label class="block text-[11px] font-medium text-[#6F7173] mb-1">
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
                              class="w-full tracking-widest text-center font-mono rounded-xl border border-[#E2DFD8] px-3 py-2 text-sm focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6]"
                            />
                          </div>

                          <Show when={(twoFactorChallenge()?.methods?.length || 0) > 1}>
                            <div class="flex items-center justify-between text-[11px] text-[#6F7173] pt-1">
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
                            class="w-full rounded-xl border border-[#E2DFD8] bg-white hover:bg-[#FAF9F6] px-4 py-2 text-xs font-medium text-[#6F7173] hover:text-[#3C3D3E] transition cursor-pointer"
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
                  <h2 class="text-base font-semibold text-[#2B2C2D]">Unlock your mailbox</h2>
                  <p class="mt-1 text-xs text-[#6F7173]">
                    Signed in as <span class="font-medium text-[#2B2C2D]">{currentUser()?.email}</span>
                  </p>
                  <Show when={loginError()}>
                    <div role="alert" class="mt-3 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                      {loginError()}
                    </div>
                  </Show>
                  <Show
                    when={!useRecoveryPhrase()}
                    fallback={
                      <form onSubmit={handleUnlockWithRecovery} class="mt-4 space-y-3">
                        <div>
                          <label class="block text-[11px] font-medium text-[#6F7173] mb-1">
                            24-Word Recovery Phrase
                          </label>
                          <textarea
                            rows={3}
                            placeholder="word1 word2 word3 ... word24"
                            value={recoveryPhraseInput()}
                            onInput={(e) => setRecoveryPhraseInput(e.currentTarget.value)}
                            disabled={loginBusy()}
                            autofocus
                            class="w-full rounded-xl border border-[#E2DFD8] px-3.5 py-2 text-xs focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6] resize-none font-mono"
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
                        class="w-full rounded-xl border border-[#E2DFD8] px-3.5 py-2.5 text-xs focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 bg-[#FAF9F6]"
                      />
                      <button
                        type="submit"
                        disabled={loginBusy() || !loginPassword()}
                        class="w-full rounded-xl bg-[#A27561] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#8F6452] transition disabled:opacity-50 cursor-pointer shadow-2xs"
                      >
                        {loginBusy() ? "Unlocking…" : "Unlock Mailbox"}
                      </button>
                      <div class="relative flex py-1 items-center">
                        <div class="flex-grow border-t border-[#E2DFD8]"></div>
                        <span class="flex-shrink mx-3 text-[10px] uppercase tracking-wider text-[#878A8E] font-medium">or</span>
                        <div class="flex-grow border-t border-[#E2DFD8]"></div>
                      </div>
                      <button
                        type="button"
                        onClick={handlePasskeyLogin}
                        disabled={loginBusy()}
                        class="w-full rounded-xl border border-[#E2DFD8] hover:border-[#A27561] bg-white hover:bg-[#FAF9F6] px-4 py-2 text-xs font-medium text-[#2B2C2D] transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
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
                          class="text-xs text-[#6F7173] hover:text-[#2B2C2D] hover:underline cursor-pointer"
                        >
                          Unlock with 24-word recovery phrase instead
                        </button>
                      </div>
                    </form>
                  </Show>
                  <div class="mt-4 pt-3 border-t border-[#E2DFD8] flex justify-between items-center text-[11px]">
                    <button
                      type="button"
                      onClick={() => handleLogout()}
                      class="text-[#878A8E] hover:text-[#2B2C2D] hover:underline cursor-pointer"
                    >
                      Sign in with a different account
                    </button>
                  </div>
                </div>
              </Show>
            </div>

            {/* ── Forgot Password / Account Recovery Modal ── */}
            <Show when={forgotPasswordModalOpen()}>
              <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-fade-in font-sans">
                <div class="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2DFD8] overflow-hidden">
                  {/* Modal Header */}
                  <div class="px-6 py-4 border-b border-[#E2DFD8] flex items-center justify-between bg-[#FAF9F6]">
                    <div class="flex items-center gap-2">
                      <div class="w-7 h-7 rounded-lg bg-[#A27561]/10 text-[#A27561] flex items-center justify-center">
                        <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      </div>
                      <h3 class="text-sm font-semibold text-[#3C3D3E]">Account Password Recovery</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForgotPasswordModalOpen(false)}
                      class="text-[#878A8E] hover:text-[#2B2C2D] p-1 rounded-lg hover:bg-[#E2DFD8]/40 transition cursor-pointer"
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
                      <div class="mb-4 rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">
                        {forgotError()}
                      </div>
                    </Show>

                    {/* Step 1: Find Account & Select Recovery Option */}
                    <Show when={forgotStep() === 1}>
                      <Show
                        when={forgotMethods().length > 0}
                        fallback={
                          <form onSubmit={handleFindRecoveryMethods} class="space-y-4">
                            <p class="text-xs text-[#6F7173] leading-relaxed">
                              Enter your BYOS email address. We will look up the verified 2-step verification and recovery options configured on your account.
                            </p>
                            <div>
                              <label class="block text-xs font-medium text-[#3C3D3E] mb-1.5">
                                Account Email
                              </label>
                              <input
                                type="email"
                                value={forgotEmail()}
                                onInput={(e) => setForgotEmail(e.currentTarget.value)}
                                placeholder="you@example.com"
                                required
                                class="w-full bg-[#FAF9F6] border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-xs text-[#3C3D3E] outline-none"
                              />
                            </div>
                            <div class="flex items-center justify-end gap-2 pt-2">
                              <button
                                type="button"
                                onClick={() => setForgotPasswordModalOpen(false)}
                                class="px-4 py-2 border border-[#E2DFD8] text-[#6F7173] hover:text-[#3C3D3E] text-xs font-medium rounded-xl transition cursor-pointer"
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
                          <p class="text-xs text-[#6F7173] leading-relaxed">
                            Select how you would like to receive or verify your security recovery code:
                          </p>
                          <div class="space-y-2">
                            <For each={forgotMethods()}>
                              {(method) => (
                                <label
                                  class={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                                    forgotSelectedMethod() === method.type
                                      ? "border-[#A27561] bg-[#A27561]/5 ring-1 ring-[#A27561]"
                                      : "border-[#E2DFD8] bg-[#FAF9F6] hover:bg-stone-50"
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
                                      <span class="text-xs font-medium text-[#3C3D3E] capitalize block">
                                        {method.type === "totp" ? "Authenticator App" : method.type + " Verification"}
                                      </span>
                                      <span class="text-[11px] text-[#6F7173] font-mono">
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
                              class="text-xs text-[#6F7173] hover:text-[#3C3D3E] cursor-pointer"
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
                        <div class="p-3 bg-[#FAF9F6] rounded-xl border border-[#E2DFD8] text-xs text-[#6F7173]">
                          <span class="font-medium text-[#3C3D3E] block mb-0.5">Verification required</span>
                          {forgotSelectedMethod() === "totp"
                            ? "Enter the 6-digit code from your authenticator app."
                            : `Enter the 6-digit code sent to ${forgotDestinationMasked()}.`}
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-[#3C3D3E] mb-1">
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
                            class="w-full tracking-widest text-center font-mono bg-[#FAF9F6] border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-sm text-[#3C3D3E] outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-[#3C3D3E] mb-1">
                            New Password (min 12 chars)
                          </label>
                          <input
                            type="password"
                            value={forgotNewPassword()}
                            onInput={(e) => setForgotNewPassword(e.currentTarget.value)}
                            placeholder="At least 12 characters"
                            required
                            minlength="12"
                            class="w-full bg-[#FAF9F6] border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-xs text-[#3C3D3E] outline-none"
                          />
                        </div>

                        <div>
                          <label class="block text-xs font-medium text-[#3C3D3E] mb-1">
                            Confirm New Password
                          </label>
                          <input
                            type="password"
                            value={forgotConfirmPassword()}
                            onInput={(e) => setForgotConfirmPassword(e.currentTarget.value)}
                            placeholder="Re-enter new password"
                            required
                            minlength="12"
                            class="w-full bg-[#FAF9F6] border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-2 text-xs text-[#3C3D3E] outline-none"
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
                            <div class="mt-2 space-y-1.5 p-3 rounded-xl bg-[#F4F1EA] border border-[#E2DFD8]">
                              <p class="text-[11px] text-[#6F7173] leading-relaxed">
                                Entering your 24-word recovery phrase re-wraps your historical encryption keys under your new password, keeping all past messages decrypted immediately. If you don't have it right now, you can leave this blank and reactivate past messages later in Settings.
                              </p>
                              <textarea
                                rows={2}
                                value={forgotRecoveryPhrase()}
                                onInput={(e) => setForgotRecoveryPhrase(e.currentTarget.value)}
                                placeholder="word1 word2 word3 ... word24 (optional)"
                                class="w-full bg-[#FAF9F6] border border-[#E2DFD8] focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 rounded-xl px-3 py-1.5 text-xs text-[#3C3D3E] outline-none font-mono resize-none"
                              />
                            </div>
                          </Show>
                        </div>

                        <div class="flex items-center justify-between pt-2">
                          <button
                            type="button"
                            onClick={() => setForgotStep(1)}
                            class="text-xs text-[#6F7173] hover:text-[#3C3D3E] cursor-pointer"
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
                        <div class="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                          <svg class="w-6 h-6 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </div>
                        <h4 class="text-base font-semibold text-[#3C3D3E]">Password Successfully Reset</h4>
                        <p class="text-xs text-[#6F7173] max-w-sm mx-auto leading-relaxed">
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
            onClose={() => setSettingsOpen(false)}
            currentUser={currentUser()}
            selectedMailbox={selectedMailbox()}
          >
            <Show when={activeSettingsTab() === "signatures" && selectedMailbox()}>
              <SignaturesTab mailbox={selectedMailbox()!} currentUser={currentUser()} />
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
              <SecurityTab mailbox={selectedMailbox()!} currentUser={currentUser()} />
            </Show>
          </SettingsLayout>
        }
      >
      <div class="flex flex-col h-screen w-screen overflow-hidden bg-[#F0EEE9] dark:bg-[#121316] text-[#1A1B1E] dark:text-[#F3F4F6] font-sans p-2.5 sm:p-3 gap-2.5 sm:gap-3">
        {/* Audited Impersonation Banner */}
        <Show when={isImpersonating()}>
          <div class="bg-amber-600 text-white px-4 py-2 flex items-center justify-between text-xs sm:text-sm font-medium shadow-sm z-50 rounded-xl">
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
          <div class="bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2.5 flex items-center justify-between text-xs font-medium rounded-xl shadow-xs">
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

        <div class="flex flex-1 overflow-hidden gap-3">
          {/* ── Left Navigation Sidebar (Unified with Canvas #F0EEE9) ── */}
          <Sidebar
            currentUser={currentUser()}
            selectedMailbox={selectedMailbox()}
            currentFolder={currentFolder()}
            onSelectFolder={(f) => {
              setCurrentFolder(f);
              setActiveCustomFolder(null);
              setActiveLabel(null);
              setSelectedMsg(null);
              setSelectedIds(new Set<string>());
              setCurrentPage(1);
            }}
            folderCounts={folderCounts()}
            customFolderCounts={customFolderCounts()}
            labelCounts={labelCounts()}
            onCompose={() => {
              setComposeAttachments([]);
              setEditingDraft(null);
              setComposeOpen(true);
            }}
            onOpenContacts={openContacts}
            onOpenImport={() => setImportEmailsModalOpen(true)}
            onOpenSettings={() => {
              setActiveSettingsTab("signatures");
              setSettingsOpen(true);
            }}
            onLogout={handleLogout}
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
              setCreateLabelModalOpen(true);
            }}
            onEditLabel={handleOpenEditLabel}
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
              layoutMode() === "full" && selectedMsg()
                ? "hidden"
                : selectedMsg()
                ? "w-[380px] min-w-[340px] max-w-[420px] flex-shrink-0"
                : "w-full flex-1"
            } transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] h-full overflow-hidden`}
          >
            <MessageList
              currentFolder={currentFolder()}
              messages={paginatedMessages()}
              selectedMessage={selectedMsg()}
              selectedIds={selectedIds()}
              isSplit={Boolean(selectedMsg())}
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
            />
          </div>

          {/* ── Reading Pane (Only mounted when selectedMsg()) ── */}
          <Show when={selectedMsg()}>
            <div class="flex-1 min-w-0 h-full overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]">
              <ReadingPane
                message={selectedMsg()!}
                isDecrypting={isDecrypting()}
                decryptedContent={decryptedContent()}
                attachments={messageAttachments()}
                downloadingAttachmentId={downloadingAttachment()}
                onDownloadAttachment={handleDownloadAttachment}
                onBack={() => setSelectedMsg(null)}
                hasPrev={hasPrevMessage()}
                hasNext={hasNextMessage()}
                onPrev={handlePrevMessage}
                onNext={handleNextMessage}
                onArchive={handleArchiveMessage}
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
              />
            </div>
          </Show>
        </div>

      {/* ── Docking Compose Drawer ── */}
      <ComposeDrawer
        isOpen={composeOpen()}
        onClose={() => {
          setComposeOpen(false);
          clearComposeForm();
          setComposeStatus(null);
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
        senderAddress={
          selectedMailbox()
            ? `${selectedMailbox()!.local_part}@${currentUser()?.email.split("@")[1] || "byos.local"}`
            : currentUser()?.email || ""
        }
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
      <Show when={contactsOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div class="w-full max-w-xl rounded-2xl bg-white dark:bg-[#1E2025] shadow-2xl overflow-hidden flex flex-col border border-[#E2DFD8] dark:border-[#2E3138] max-h-[85vh] font-sans">
            <div class="px-6 py-4 bg-white dark:bg-[#1E2025] border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between">
              <h3 class="font-medium text-base text-[#2B2C2D] dark:text-[#F3F4F6]">
                Contacts
              </h3>
              <button
                onClick={() => { setContactsOpen(false); startEditContact(null); setContactsError(null); }}
                class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] p-1 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                aria-label="Close contacts"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div class="p-6 space-y-4 overflow-y-auto">
              <Show when={contactsError()}>
                <div class="rounded-xl bg-red-50 dark:bg-rose-950/40 p-3 text-xs text-red-700 dark:text-rose-400 border border-red-200 dark:border-rose-900/50">{contactsError()}</div>
              </Show>
              <Show when={contactsLoading()}>
                <div class="text-xs text-[#6F7173] dark:text-[#878A8E] animate-pulse font-mono">Loading contacts…</div>
              </Show>
              <Show when={!contactsLoading() && contacts().length === 0 && !contactsError()}>
                <div class="text-sm text-[#6F7173] dark:text-[#878A8E]">No contacts yet.</div>
              </Show>
              <For each={contacts()}>
                {(c) => (
                  <div class="flex items-center justify-between p-3.5 bg-[#F8F7F4] dark:bg-[#26282E] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138]">
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-[#2B2C2D] dark:text-[#F3F4F6] truncate">{c.name}</div>
                      <div class="text-xs text-[#6F7173] dark:text-[#A1A1AA] truncate">{c.email}</div>
                      <Show when={c.notes}>
                        <div class="text-xs text-[#878A8E] dark:text-[#71717A] truncate mt-0.5">{c.notes}</div>
                      </Show>
                    </div>
                    <div class="flex gap-2 flex-shrink-0 ml-3">
                      <button
                        onClick={() => startEditContact(c)}
                        class="rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] px-2.5 py-1 text-xs text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-white dark:hover:bg-[#1E2025] transition cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteContact(c.id)}
                        class="rounded-lg border border-rose-200 dark:border-rose-900/50 px-2.5 py-1 text-xs text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </For>
              <div class="pt-4 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                <h4 class="text-xs font-semibold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider mb-2 font-mono">
                  {editingContact() ? "Edit contact" : "New contact"}
                </h4>
                <div class="space-y-3">
                  <input
                    type="text"
                    placeholder="Name"
                    value={contactName()}
                    onInput={(e) => setContactName(e.currentTarget.value)}
                    class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] bg-[#FAF9F6] dark:bg-[#18191D] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] transition"
                  />
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={contactEmail()}
                    onInput={(e) => setContactEmail(e.currentTarget.value)}
                    class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] bg-[#FAF9F6] dark:bg-[#18191D] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] transition"
                  />
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={contactNotes()}
                    onInput={(e) => setContactNotes(e.currentTarget.value)}
                    class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] bg-[#FAF9F6] dark:bg-[#18191D] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] transition"
                  />
                  <div class="flex gap-2 pt-1">
                    <button
                      onClick={handleSaveContact}
                      class="bg-[#A27561] hover:bg-[#8F6452] text-white font-medium px-4 py-2 rounded-xl transition-all text-xs cursor-pointer shadow-xs"
                    >
                      {editingContact() ? "Update contact" : "Add contact"}
                    </button>
                    <Show when={editingContact()}>
                      <button
                        onClick={() => startEditContact(null)}
                        class="rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-4 py-2 text-xs font-medium text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
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
        }}
        labelToEdit={labelToEdit()}
        onSave={handleSaveLabel}
      />

      {/* ── Import Emails Modal ── */}
      <ImportEmailsModal
        isOpen={importEmailsModalOpen()}
        onClose={() => setImportEmailsModalOpen(false)}
        mailboxId={selectedMailbox()?.id || ""}
        folders={customFolders()}
        onSuccess={() => {
          const box = selectedMailbox();
          if (box) {
            loadMailboxData(box.id);
            showToast("Emails successfully imported");
          }
        }}
      />

      {/* ── Global Notification Toast ── */}
      <Show when={toastMessage()}>
        <div class="fixed bottom-6 right-6 z-50 bg-[#3C3D3E] text-white px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2.5 text-xs font-sans border border-[#E2DFD8]/20 animate-fade-in">
          <svg class="w-4 h-4 stroke-[#A27561] fill-none stroke-2 flex-shrink-0" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{toastMessage()}</span>
        </div>
      </Show>
      </div>
    </Show>
    </Show>
    </Show>
  );
};

export default App;
