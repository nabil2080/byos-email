import { Component, createSignal, createEffect, onMount, For, Show } from "solid-js";
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
  downloadAttachmentForDisplay,
  uploadEncryptedAttachment,
  fetchContacts,
  createContact,
  updateContact,
  deleteContact,
  deleteAttachment,
  fetchMessages,
  fetchMessageBody,
  fetchOutboundPubkey,
  prepareOutbound,
  sendOutbound,
  scheduleOutbound,
  searchMailboxTokens,
  indexSearchToken,
  UserMe,
  Mailbox,
  DraftMessage,
  AttachmentItem,
  ContactItem,
  MessageMetadata,
} from "./api";
import {
  unlockMailboxKey,
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

type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

interface DisplayMessage {
  id: string;
  messageSeq?: number;
  version?: number;
  folder: Folder;
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

  // Mailbox key custody: in-memory only, derived per unlock from the recovery
  // phrase. Cleared on mailbox switch and lock. Never persisted or logged.
  const [mailboxKey, setMailboxKey] = createSignal<Uint8Array | null>(null);
  const [searchKey, setSearchKey] = createSignal<string | null>(null);
  const [serverMatchedMsgIds, setServerMatchedMsgIds] = createSignal<string[]>([]);
  const [isSearchingTokens, setIsSearchingTokens] = createSignal(false);
  const [unlockedBoxId, setUnlockedBoxId] = createSignal<string | null>(null);
  const [unlockMnemonic, setUnlockMnemonic] = createSignal("");
  const [unlocking, setUnlocking] = createSignal(false);
  const [unlockError, setUnlockError] = createSignal<string | null>(null);

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
  const [scheduledTime, setScheduledTime] = createSignal("");
  const [composeStatus, setComposeStatus] = createSignal<string | null>(null);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [composeAttachments, setComposeAttachments] = createSignal<AttachmentItem[]>([]);
  // When set, saving updates this draft (optimistic version) instead of creating.
  const [editingDraft, setEditingDraft] = createSignal<{ id: string; version: number } | null>(null);

  // Login form state. The password lives in a signal only while typing and is
  // cleared on every submit attempt, success or failure.
  const [loginEmail, setLoginEmail] = createSignal("");
  const [loginPassword, setLoginPassword] = createSignal("");
  const [loginBusy, setLoginBusy] = createSignal(false);
  const [loginError, setLoginError] = createSignal<string | null>(null);

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

  async function bootstrapSession(user: UserMe) {
    setCurrentUser(user);
    const boxes = await fetchMailboxes(user.org_id);
    setMailboxes(boxes);
    if (boxes.length > 0) {
      setSelectedMailbox(boxes[0]);
      refreshSignature(boxes[0].id);
      await loadMailboxData(boxes[0].id);
    }
  }

  onMount(async () => {
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
      await login(email, password);
      setLoginPassword("");
      setIsLoading(true);
      const user = await fetchCurrentUser();
      if (!user) throw new Error("Session was not established.");
      await bootstrapSession(user);
    } catch (err) {
      // The server answers wrong/unknown credentials with the same generic
      // 401, so this message cannot leak which half was wrong.
      setLoginError("Invalid email or password.");
    } finally {
      setLoginPassword("");
      setLoginBusy(false);
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    // Revoke server-side best-effort, then always tear down local state: a
    // failed request must never leave a signed-in UI (shared-machine threat).
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
  }

  async function loadMailboxData(mailboxId: string) {
    try {
      const [draftsList, messageList] = await Promise.all([
        fetchDrafts(mailboxId),
        fetchMessages(mailboxId),
      ]);

      const realMessages: DisplayMessage[] = messageList.map((m: MessageMetadata) => ({
        id: m.id,
        messageId: m.id, // For attachment filtering
        messageSeq: m.message_seq,
        folder: m.direction === "sent" ? "sent" : "inbox",
        sender: m.sender,
        recipient: m.recipients.join(", "),
        subject: "(Encrypted message)",
        snippet: `Encrypted payload • ${m.storage_object_id}`,
        encryptedBody: m.storage_object_id,
        date: new Date(m.sent_at || m.received_at).toLocaleString(),
        read: false,
        starred: false,
        isRealApi: true,
      }));
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
          date: new Date(d.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          read: true,
          starred: false,
          isRealApi: true,
        };
      });

      setMessages([...realMessages, ...draftMessages]);
    } catch (err) {
      console.warn("Error loading mailbox data:", err);
    }
  }

  function lockMailbox() {
    setMailboxKey(null);
    setSearchKey(null);
    setServerMatchedMsgIds([]);
    setUnlockedBoxId(null);
    setUnlockMnemonic("");
    setUnlockError(null);
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
  }

  async function handleUnlock() {
    const box = selectedMailbox();
    const words = unlockMnemonic().trim();
    if (!box || !words) {
      setUnlockError("Select a mailbox and enter its recovery phrase.");
      return;
    }
    setUnlocking(true);
    setUnlockError(null);
    try {
      const detail = await fetchMailboxDetail(box.id);
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const key = unlockMailboxKey(wasm, words, box.id, detail.mailbox_sk_wrapped);
      const sKey = deriveSearchKeyFromMnemonic(wasm, words);
      setMailboxKey(key);
      setSearchKey(sKey);
      setUnlockedBoxId(box.id);
      setUnlockMnemonic("");
      await loadMailboxData(box.id);
    } catch (err) {
      lockMailbox();
      setUnlockError(err instanceof Error ? err.message : "Unlock failed.");
    } finally {
      setUnlocking(false);
    }
  }

  const filteredMessages = () => {
    const q = searchQuery().toLowerCase().trim();
    const matchedIds = new Set(serverMatchedMsgIds());
    return messages().filter((m) => {
      const matchFolder = m.folder === currentFolder();
      if (!q) return matchFolder;
      const localMatch =
        m.sender.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.snippet.toLowerCase().includes(q);
      const serverTokenMatch = matchedIds.has(m.id) || (m.messageId ? matchedIds.has(m.messageId) : false);
      return matchFolder && (localMatch || serverTokenMatch);
    });
  };

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
      const { encryptedBlob } = await downloadAttachmentForDisplay(box.id, att.id);
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
        `Unlock the mailbox with the recovery phrase to download decrypted files.`
      );
    } catch (err) {
      console.error("Failed to download attachment:", err);
      alert(`Failed to download attachment: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setDownloadingAttachment(null);
    }
  }

  async function openMessage(msg: DisplayMessage) {
    setSelectedMsg(msg);
    setIsDecrypting(true);
    setDecryptedContent(null);
    setEditablePlaintext(null);
    setMessagePlaintext(null);
    setMessageAttachments([]);

    // Mark as read
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
    );

    const box = selectedMailbox();
    if (!box) {
      setDecryptedContent("No mailbox selected.");
      setIsDecrypting(false);
      return;
    }

    try {
      // Drafts live outside message_metadata: decrypt the stored envelope
      // directly instead of fetching a message body (which would 404).
      if (msg.folder === "drafts") {
        const key = mailboxKey();
        if (!key || unlockedBoxId() !== box.id) {
          setDecryptedContent("Mailbox is locked. Unlock with the recovery phrase to read this draft.");
          return;
        }
        const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
        const plaintext = decryptDraftEnvelope(wasm, key, box.id, msg.encryptedBody);
        setDecryptedContent(plaintext);
        setEditablePlaintext(plaintext);
        return;
      }
      const body = await fetchMessageBody(box.id, msg.id);

      // Fetch attachments for this message - use stable msg.id with fallback for legacy messageId
      const allAttachments = await fetchAttachments(box.id);
      const targetId = msg.messageId ?? msg.id;
      const msgAttachments = allAttachments.filter((a) => {
        const attMessageId = a.message_id ?? (a as unknown as { messageId?: string }).messageId;
        return attMessageId != null && attMessageId !== "" && attMessageId === targetId;
      });
      setMessageAttachments(msgAttachments);

      // Decrypt locally when unlocked. The key, phrase, and plaintext never
      // leave the browser; failures show a generic message, never key material.
      const key = mailboxKey();
      if (!key || unlockedBoxId() !== box.id || msg.messageSeq === undefined) {
        setDecryptedContent("Mailbox is locked. Unlock with the recovery phrase to decrypt this message.");
        return;
      }
      const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
      const plaintext = decryptMessageEnvelope(wasm, key, box.id, {
        message_seq: msg.messageSeq,
        encryption_version: body.encryption_version,
        encrypted_body: body.encrypted_body,
        content_key_hpke_wrapped: body.content_key_hpke_wrapped,
      });
      setDecryptedContent(plaintext);
      setMessagePlaintext(plaintext);

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
      console.error("Failed to open message:", err);
      setDecryptedContent(
        `Failed to open message: ${err instanceof Error ? err.message : "unknown error"}`
      );
    } finally {
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
        "Unlock the mailbox to attach files: attachments must be client-encrypted."
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
      setContactsError("Unlock the mailbox to manage contacts: entries are client-encrypted.");
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
          // One corrupt entry must not hide the rest; surface it explicitly.
          shown.push({ id: c.id, version: c.version, name: "( undecryptable entry )", email: "", notes: "" });
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
    if (c && c.name.startsWith("( undecryptable")) return;
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
      setContactsError("Unlock the mailbox to save contacts.");
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
    setScheduledTime("");
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
      const plaintext = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "MIME-Version: 1.0",
        "",
        signedBody,
      ].join("\r\n");
      const plaintextB64 = bytesToBase64(new TextEncoder().encode(plaintext));
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
      setErrorMessage("Unlock the mailbox to save drafts: draft bodies must be client-encrypted.");
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

  const folderIcons: Record<Folder, string> = {
    inbox: "📥",
    sent: "📤",
    drafts: "▤",
    archive: "📦",
    spam: "⚠️",
    trash: "🗑️",
  };

  return (
    <Show
      when={currentUser() !== null || isLoading()}
      fallback={
        <div class="flex h-screen w-screen items-center justify-center bg-slate-100 p-4">
          <div class="w-full max-w-sm rounded-xl bg-white shadow-xl border border-slate-200 p-8">
            <div class="flex items-center gap-2">
              <span class="text-xl font-bold tracking-wider">BYOS</span>
              <span class="text-xs bg-sky-600 text-white px-2 py-0.5 rounded font-mono">Webmail</span>
            </div>
            <p class="mt-2 text-sm text-slate-500">Sign in to access your encrypted mailbox.</p>
            <Show when={loginError()}>
              <div role="alert" class="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
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
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <input
                type="password"
                autocomplete="current-password"
                placeholder="Password"
                value={loginPassword()}
                onInput={(e) => setLoginPassword(e.currentTarget.value)}
                disabled={loginBusy()}
                class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <button
                type="submit"
                disabled={loginBusy() || !loginEmail().trim() || !loginPassword()}
                class="w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
              >
                {loginBusy() ? "Signing in…" : "Sign in"}
              </button>
            </form>
            <p class="mt-4 text-[11px] text-slate-400">
              Passwords verify server-side only. Mailbox decryption additionally requires unlocking with a recovery phrase.
            </p>
          </div>
        </div>
      }
    >
    <div class="flex h-screen w-screen overflow-hidden bg-slate-100 text-slate-900 font-sans">
      {/* ── Left Navigation Sidebar ── */}
      <aside class="w-64 flex-shrink-0 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800">
        <div class="p-4 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-xl font-bold text-white tracking-wider">BYOS</span>
            <span class="text-xs bg-sky-600 text-white px-2 py-0.5 rounded font-mono">Webmail</span>
          </div>
        </div>

        {/* Mailbox Selector */}
        <Show when={mailboxes().length > 0}>
          <div class="px-4 pt-3 pb-1 text-xs font-mono text-slate-400">
            <label class="block text-[11px] text-slate-500 uppercase tracking-wider mb-1">Active Mailbox</label>
            <select
              value={selectedMailbox()?.id || ""}
              onChange={(e) => {
                const box = mailboxes().find((m) => m.id === e.currentTarget.value);
                if (box) {
                  lockMailbox();
                  setSelectedMailbox(box);
                  refreshSignature(box.id);
                  loadMailboxData(box.id);
                }
              }}
              class="w-full bg-slate-800 text-slate-200 text-xs rounded border border-slate-700 px-2 py-1 focus:outline-none"
            >
              <For each={mailboxes()}>
                {(m) => <option value={m.id}>{m.local_part} ({m.mode})</option>}
              </For>
            </select>
          </div>
        </Show>

        {/* Compose Button */}
        <div class="p-4">
          <button
            onClick={() => {
              setComposeAttachments([]);
              setEditingDraft(null);
              setComposeOpen(true);
            }}
            class="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-sky-500 transition-all flex items-center justify-center gap-2"
          >
            <span>✏️</span> Compose Email
          </button>
          <button
            onClick={openContacts}
            class="mt-2 w-full rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
          >
            <span>👥</span> Contacts
          </button>
        </div>

        {/* Mailbox Unlock */}
        <div class="px-4 pb-3">
          <Show
            when={mailboxKey() && unlockedBoxId() === selectedMailbox()?.id}
            fallback={
              <div>
                <label class="block text-[11px] text-slate-500 uppercase tracking-wider mb-1">
                  Mailbox locked
                </label>
                <input
                  type="password"
                  autocomplete="off"
                  placeholder="Recovery phrase to unlock"
                  value={unlockMnemonic()}
                  onInput={(e) => setUnlockMnemonic(e.currentTarget.value)}
                  disabled={unlocking()}
                  class="w-full bg-slate-800 text-slate-200 text-xs rounded border border-slate-700 px-2 py-1.5 focus:outline-none mb-2"
                />
                <button
                  onClick={handleUnlock}
                  disabled={unlocking() || !unlockMnemonic().trim() || !selectedMailbox()}
                  class="w-full rounded bg-emerald-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {unlocking() ? "Unlocking…" : "🔓 Unlock mailbox"}
                </button>
                <Show when={unlockError()}>
                  <div class="mt-2 text-[11px] text-red-400">{unlockError()}</div>
                </Show>
                <div class="mt-2 text-[11px] text-slate-500">
                  Unlock decrypts messages, drafts, and attachments locally. The phrase never leaves this browser.
                </div>
              </div>
            }
          >
            <div>
              <div class="text-[11px] text-emerald-400 font-medium">🔓 Mailbox unlocked</div>
              <button
                onClick={lockMailbox}
                class="mt-2 w-full rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Lock mailbox
              </button>
            </div>
          </Show>
        </div>

        {/* Mailbox Signature (device-local) */}
        <div class="px-4 pb-3">
          <label class="block text-[11px] text-slate-500 uppercase tracking-wider mb-1">
            Signature
          </label>
          <textarea
            rows={3}
            placeholder="Name&#10;Title · Company&#10;Phone"
            value={signatureText()}
            onInput={(e) => { setSignatureText(e.currentTarget.value); setSignatureSaved(false); }}
            class="w-full bg-slate-800 text-slate-200 text-xs rounded border border-slate-700 px-2 py-1.5 focus:outline-none"
          />
          <button
            onClick={handleSaveSignature}
            disabled={!selectedMailbox()}
            class="mt-1 w-full rounded border border-slate-700 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            {signatureSaved() ? "Saved!" : "Save signature"}
          </button>
          <div class="mt-1 text-[11px] text-slate-500">
            Appended to sent mail. Stored only in this browser, per mailbox.
          </div>
        </div>

        {/* Folders List */}
        <nav class="flex-1 px-3 space-y-1 overflow-y-auto">
          {(Object.keys(folderNames) as Folder[]).map((f) => (
            <button
              onClick={() => {
                setCurrentFolder(f);
                setSelectedMsg(null);
              }}
              class={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors ${
                currentFolder() === f
                  ? "bg-slate-800 text-white font-medium"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-200"
              }`}
            >
              <div class="flex items-center gap-2.5">
                <span>{folderIcons[f]}</span>
                <span>{folderNames[f]}</span>
              </div>
              <span class="text-xs font-mono text-slate-500">
                {messages().filter((m) => m.folder === f).length}
              </span>
            </button>
          ))}
        </nav>

        {/* Security Footer */}
        <div class="p-4 border-t border-slate-800 text-xs text-slate-500 space-y-1">
          <div class="flex items-center gap-1.5 font-medium">
            <Show
              when={mailboxKey() && unlockedBoxId() === selectedMailbox()?.id}
              fallback={<><span>🔒</span><span class="text-slate-400">Mailbox locked — metadata only</span></>}
            >
              <span>🔓</span><span class="text-emerald-400">Mailbox unlocked — local decryption</span>
            </Show>
          </div>
          <div class="truncate">User: {currentUser()?.email || "Guest Session"}</div>
          <button
            onClick={handleLogout}
            class="mt-1 w-full rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Middle: Message List ── */}
      <section class="w-96 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Search Header */}
        <div class="p-4 border-b border-slate-200 bg-slate-50">
          <div class="relative">
            <input
              type="text"
              placeholder="Filter messages…"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <span class="absolute left-3 top-2 text-slate-400 text-sm">🔍</span>
          </div>
          <div class="mt-2 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center justify-between">
            <span>{folderNames[currentFolder()]}</span>
            <span>{filteredMessages().length} messages</span>
          </div>
        </div>

        {/* Messages List */}
        <div class="flex-1 overflow-y-auto divide-y divide-slate-100">
          <Show when={isLoading()}>
            <div class="p-8 text-center text-xs text-slate-400 font-mono animate-pulse">
              Syncing sovereign mailbox…
            </div>
          </Show>
          <For each={filteredMessages()}>
            {(msg) => (
              <div
                onClick={() => openMessage(msg)}
                class={`p-4 cursor-pointer transition-colors ${
                  selectedMsg()?.id === msg.id
                    ? "bg-sky-50 border-l-4 border-sky-600"
                    : msg.read
                    ? "hover:bg-slate-50"
                    : "bg-white font-semibold hover:bg-slate-50"
                }`}
              >
                <div class="flex items-center justify-between text-xs text-slate-500">
                  <span class="font-medium text-slate-900 truncate max-w-[200px]">{msg.sender}</span>
                  <span class="font-mono text-[11px]">{msg.date}</span>
                </div>
                <div class="mt-1 text-sm font-medium text-slate-800 truncate">{msg.subject}</div>
                <div class="mt-0.5 text-xs text-slate-500 truncate">{msg.snippet}</div>
              </div>
            )}
          </For>
          <Show when={!isLoading() && filteredMessages().length === 0}>
            <div class="p-8 text-center text-sm text-slate-400">No messages in {folderNames[currentFolder()]}.</div>
          </Show>
        </div>
      </section>

      {/* ── Right: Message Reader ── */}
      <main class="flex-1 bg-white flex flex-col min-w-0">
        <Show
          when={selectedMsg()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-slate-400 text-sm flex-col gap-2">
              <span class="text-4xl">✉️</span>
              <span>Select a message to view encrypted content.</span>
            </div>
          }
        >
          {(msg) => (
            <div class="flex-1 flex flex-col h-full overflow-hidden">
              {/* Message Header */}
              <div class="p-6 border-b border-slate-200 bg-slate-50">
                <div class="flex items-start justify-between">
                  <h1 class="text-xl font-bold text-slate-900">{msg().subject}</h1>
                  <div class="flex gap-2">
                    {/* Server-side delete exists only for drafts; other
                        folders triage locally. */}
                    <Show when={msg().folder === "drafts"}>
                      <button
                        onClick={() => handleDeleteMessage(msg())}
                        class="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Delete
                      </button>
                    </Show>
                    {/* Drafts decrypt locally when unlocked; editing reloads
                        the plaintext into compose and saves via versioned PUT. */}
                    <Show
                      when={
                        msg().folder === "drafts" &&
                        mailboxKey() &&
                        unlockedBoxId() === selectedMailbox()?.id &&
                        editablePlaintext() !== null
                      }
                    >
                      <button
                        onClick={() => startEditDraft(msg(), editablePlaintext() as string)}
                        class="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Edit
                      </button>
                    </Show>
                    {/* Reply/Forward need decrypted plaintext; they submit
                        through the same encrypted send path as compose. */}
                    <Show when={msg().folder !== "drafts" && messagePlaintext() !== null}>
                      <button
                        onClick={() => startReply(msg())}
                        class="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Reply
                      </button>
                      <button
                        onClick={() => startForward(msg())}
                        class="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Forward
                      </button>
                    </Show>
                  </div>
                </div>
                <div class="mt-3 flex items-center gap-4 text-xs text-slate-600">
                  <div><span class="font-semibold text-slate-700">From:</span> {msg().sender}</div>
                  <div><span class="font-semibold text-slate-700">To:</span> {msg().recipient}</div>
                  <div class="ml-auto font-mono text-slate-400">{msg().date}</div>
                </div>
              </div>

              {/* Encrypted Envelope Banner */}
              <div class="px-6 py-2 bg-slate-900 text-slate-300 text-xs font-mono flex items-center justify-between">
                <span>Payload: AES-256-GCM Sovereign Storage</span>
                <Show
                  when={mailboxKey() && unlockedBoxId() === selectedMailbox()?.id}
                  fallback={<span class="text-amber-400">Locked — showing metadata only</span>}
                >
                  <span class="text-emerald-400">Client-Side Decrypted</span>
                </Show>
              </div>

              {/* Decrypted Body Reader */}
              <div class="p-6 flex-1 overflow-y-auto text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                <Show when={isDecrypting()}>
                  <div class="flex items-center gap-2 text-sky-600 animate-pulse font-mono text-xs">
                    <span>⚙️</span> Decrypting message payload locally via Rust/WASM…
                  </div>
                </Show>
                <Show when={!isDecrypting() && decryptedContent()}>
                  {decryptedContent()}
                </Show>

                {/* Attachments Section */}
                <Show when={messageAttachments().length > 0}>
                  <div class="mt-6 pt-6 border-t border-slate-200">
                    <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                      Attachments ({messageAttachments().length})
                    </h3>
                    <div class="space-y-2">
                      <For each={messageAttachments()}>
                        {(att) => (
                          <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <div class="flex items-center gap-3">
                              <span class="text-lg">📎</span>
                              <div>
                                <div class="text-sm font-medium text-slate-700">{att.filename}</div>
                                <div class="text-xs text-slate-500">
                                  {Math.round(att.size_bytes / 1024)} KB • {att.content_type}
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDownloadAttachment(att)}
                              disabled={downloadingAttachment() === att.id}
                              class="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {downloadingAttachment() === att.id ? "Downloading..." : "Download"}
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </main>

      {/* ── Compose Email Modal ── */}
      <Show when={composeOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div class="w-full max-w-xl rounded-xl bg-white shadow-2xl overflow-hidden flex flex-col border border-slate-200">
            <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 class="font-semibold text-sm flex items-center gap-2">
                <span>✏️</span> {editingDraft() ? "Edit Encrypted Draft" : "New Encrypted Message"}
              </h3>
              <button onClick={() => { setComposeOpen(false); clearComposeForm(); setComposeStatus(null); }} class="text-slate-400 hover:text-white text-lg">
                ✕
              </button>
            </div>

            <Show when={composeStatus()}>
              <div class="bg-sky-50 px-6 py-2 text-xs text-sky-800 font-mono animate-pulse border-b border-sky-100">
                {composeStatus()}
              </div>
            </Show>

            <Show when={errorMessage()}>
              <div class="bg-red-50 px-6 py-2 text-xs text-red-700 border-b border-red-100">
                {errorMessage()}
              </div>
            </Show>

            <form onSubmit={handleSend} class="p-6 space-y-4 flex-1">
              <div>
                <label class="block text-xs font-medium text-slate-700">To</label>
                <input
                  type="email"
                  required
                  placeholder="recipient@example.com"
                  value={composeTo()}
                  onInput={(e) => setComposeTo(e.currentTarget.value)}
                  class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-700">Subject</label>
                <input
                  type="text"
                  required
                  placeholder="Subject"
                  value={composeSubject()}
                  onInput={(e) => setComposeSubject(e.currentTarget.value)}
                  class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-700">Message Body</label>
                <textarea
                  rows={6}
                  required
                  placeholder="Type your message here. Content is client-encrypted before outbound dispatch…"
                  value={composeBody()}
                  onInput={(e) => setComposeBody(e.currentTarget.value)}
                  class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Attachments Section — uploads disabled until a real
                  per-mailbox key source exists (SEC-001). No "encrypted"
                  claim is made while uploads are blocked. */}
              <div class="rounded-lg border border-slate-200 p-3 bg-slate-50">
                <label class="block text-xs font-medium text-slate-700 mb-2">Attachments (Unavailable — encryption key not configured)</label>
                <input
                  type="file"
                  multiple
                  disabled
                  onChange={handleAttachmentSelected}
                  class="block w-full text-xs text-slate-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-sky-100 file:text-sky-700 hover:file:bg-sky-200 disabled:opacity-50"
                />
                <span class="text-[11px] text-slate-500 mt-1 block">
                  Attachment uploads are disabled in this build until mailbox key exchange is configured.
                </span>
                <Show when={composeAttachments().length > 0}>
                  <ul class="mt-2 space-y-1 bg-white border border-slate-200 rounded-md p-2">
                    <For each={composeAttachments()}>
                      {(att) => (
                        <li class="text-xs text-slate-600 flex items-center justify-between">
                          <span class="truncate pr-4">{att.filename} ({Math.round(att.size_bytes / 1024)} KB)</span>
                          <button
                            type="button"
                            onClick={() => removeComposeAttachment(att.id)}
                            class="text-red-500 hover:text-red-700 font-mono flex-shrink-0"
                          >
                            Remove
                          </button>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>

              {/* Scheduled Send Option */}
              <div class="rounded-lg bg-slate-50 p-3 border border-slate-200">
                <label class="block text-xs font-medium text-slate-700">
                  <span>⏰</span> Scheduled Send (Section 18)
                </label>
                <input
                  type="datetime-local"
                  value={scheduledTime()}
                  onInput={(e) => setScheduledTime(e.currentTarget.value)}
                  class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 bg-white"
                />
                <span class="text-[11px] text-slate-500 mt-1 block">
                  Message will be stored safely and dispatched automatically at the chosen time.
                </span>
              </div>

              <div class="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  class="rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {editingDraft() ? `Update Draft (v${editingDraft()!.version})` : "Save Draft"}
                </button>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setComposeOpen(false); clearComposeForm(); setComposeStatus(null); }}
                    class="rounded-md border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    class="rounded-md bg-sky-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-sky-500"
                  >
                    {scheduledTime() ? "Schedule Send" : "Send Encrypted"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* ── Contacts Modal ── */}
      <Show when={contactsOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div class="w-full max-w-xl rounded-xl bg-white shadow-2xl overflow-hidden flex flex-col border border-slate-200 max-h-[85vh]">
            <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <h3 class="font-semibold text-sm flex items-center gap-2">
                <span>👥</span> Contacts (client-encrypted)
              </h3>
              <button onClick={() => { setContactsOpen(false); startEditContact(null); setContactsError(null); }} class="text-slate-400 hover:text-white text-lg">
                ✕
              </button>
            </div>
            <div class="p-6 space-y-4 overflow-y-auto">
              <Show when={contactsError()}>
                <div class="rounded-md bg-red-50 p-3 text-xs text-red-700">{contactsError()}</div>
              </Show>
              <Show when={contactsLoading()}>
                <div class="text-xs text-slate-500 animate-pulse font-mono">Decrypting contacts locally…</div>
              </Show>
              <Show when={!contactsLoading() && contacts().length === 0 && !contactsError()}>
                <div class="text-sm text-slate-400">No contacts yet. Entries are encrypted in your browser before upload.</div>
              </Show>
              <For each={contacts()}>
                {(c) => (
                  <div class="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div class="min-w-0">
                      <div class="text-sm font-medium text-slate-800 truncate">{c.name}</div>
                      <div class="text-xs text-slate-500 truncate">{c.email}</div>
                      <Show when={c.notes}>
                        <div class="text-xs text-slate-400 truncate">{c.notes}</div>
                      </Show>
                    </div>
                    <div class="flex gap-2 flex-shrink-0 ml-3">
                      <button
                        onClick={() => startEditContact(c)}
                        class="rounded border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteContact(c.id)}
                        class="rounded border border-slate-300 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </For>
              <div class="pt-2 border-t border-slate-200">
                <h4 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {editingContact() ? "Edit contact" : "New contact"}
                </h4>
                <div class="space-y-2">
                  <input
                    type="text"
                    placeholder="Name"
                    value={contactName()}
                    onInput={(e) => setContactName(e.currentTarget.value)}
                    class="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="email@example.com"
                    value={contactEmail()}
                    onInput={(e) => setContactEmail(e.currentTarget.value)}
                    class="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={contactNotes()}
                    onInput={(e) => setContactNotes(e.currentTarget.value)}
                    class="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <div class="flex gap-2">
                    <button
                      onClick={handleSaveContact}
                      class="rounded-md bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
                    >
                      {editingContact() ? "Update contact" : "Add contact"}
                    </button>
                    <Show when={editingContact()}>
                      <button
                        onClick={() => startEditContact(null)}
                        class="rounded-md border border-slate-300 px-4 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
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
    </div>
    </Show>
  );
};

export default App;
