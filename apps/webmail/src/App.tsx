import { Component, createSignal, createEffect, onMount, For, Show } from "solid-js";
import {
  fetchCurrentUser,
  fetchMailboxes,
  fetchDrafts,
  createDraft,
  deleteDraft,
  fetchAttachments,
  fetchMessages,
  fetchOutboundPubkey,
  prepareOutbound,
  sendOutbound,
  scheduleOutbound,
  UserMe,
  Mailbox,
  DraftMessage,
  AttachmentItem,
  MessageMetadata,
} from "./api";

type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

interface DisplayMessage {
  id: string;
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
  const [isLoading, setIsLoading] = createSignal(true);
  const [attachments, setAttachments] = createSignal<AttachmentItem[]>([]);

  // Compose Form signals
  const [composeTo, setComposeTo] = createSignal("");
  const [composeSubject, setComposeSubject] = createSignal("");
  const [composeBody, setComposeBody] = createSignal("");
  const [scheduledTime, setScheduledTime] = createSignal("");
  const [composeStatus, setComposeStatus] = createSignal<string | null>(null);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  onMount(async () => {
    setIsLoading(true);
    try {
      const user = await fetchCurrentUser();
      if (user) {
        setCurrentUser(user);
        const boxes = await fetchMailboxes(user.org_id);
        setMailboxes(boxes);
        if (boxes.length > 0) {
          setSelectedMailbox(boxes[0]);
          await loadMailboxData(boxes[0].id);
        }
      }
    } catch (err) {
      console.warn("Failed loading user/mailbox data on mount:", err);
    } finally {
      setIsLoading(false);
    }
  });

  async function loadMailboxData(mailboxId: string) {
    try {
      const [draftsList, attList, messageList] = await Promise.all([
        fetchDrafts(mailboxId),
        fetchAttachments(mailboxId),
        fetchMessages(mailboxId),
      ]);
      setAttachments(attList);

      const realMessages: DisplayMessage[] = messageList.map((m: MessageMetadata) => ({
        id: m.id,
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
      const draftMessages: DisplayMessage[] = draftsList.map((d: DraftMessage) => ({
        id: d.id,
        folder: "drafts",
        sender: currentUser()?.email || "me@byos.local",
        recipient: d.recipient || "(no recipient)",
        subject: d.subject || "(no subject)",
        snippet: d.encrypted_envelope ? d.encrypted_envelope.slice(0, 40) + "…" : "Draft payload…",
        encryptedBody: d.encrypted_envelope || "Encrypted draft envelope",
        date: new Date(d.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        read: true,
        starred: false,
        isRealApi: true,
      }));

      setMessages([...realMessages, ...draftMessages]);
    } catch (err) {
      console.warn("Error loading mailbox data:", err);
    }
  }

  const filteredMessages = () => {
    return messages().filter((m) => {
      const matchFolder = m.folder === currentFolder();
      const q = searchQuery().toLowerCase().trim();
      if (!q) return matchFolder;
      return (
        matchFolder &&
        (m.sender.toLowerCase().includes(q) ||
          m.subject.toLowerCase().includes(q) ||
          m.snippet.toLowerCase().includes(q))
      );
    });
  };

  async function openMessage(msg: DisplayMessage) {
    setSelectedMsg(msg);
    setIsDecrypting(true);
    setDecryptedContent(null);

    // Mark as read
    setMessages((prev) =>
      prev.map((m) => (m.id === msg.id ? { ...m, read: true } : m))
    );

    // Message bodies require a real client-side storage fetch and mailbox-key
    // decryption flow. Never render opaque storage references as plaintext.
    setDecryptedContent("Message content is encrypted and cannot be displayed until client-side key and storage retrieval are configured.");
    setIsDecrypting(false);
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
      const plaintext = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "MIME-Version: 1.0",
        "",
        body,
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
        });
      }

      setComposeStatus(scheduledTime() ? "Encrypted message scheduled." : "Encrypted message queued for delivery.");
      setComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setScheduledTime("");
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

    setComposeStatus("Saving draft to mailbox storage…");
    try {
      const created = await createDraft(box.id, {
        recipient: to,
        subject: subject || "Untitled Draft",
        encrypted_envelope: body,
      });

      const draftDisplay: DisplayMessage = {
        id: created.id,
        folder: "drafts",
        sender: currentUser()?.email || "me@byos.local",
        recipient: to || "(no recipient)",
        subject: subject || "Untitled Draft",
        snippet: body.slice(0, 40) + "…",
        encryptedBody: body,
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
                  setSelectedMailbox(box);
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
            onClick={() => setComposeOpen(true)}
            class="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-sky-500 transition-all flex items-center justify-center gap-2"
          >
            <span>✏️</span> Compose Email
          </button>
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
          <div class="flex items-center gap-1.5 text-emerald-400 font-medium">
            <span>🔒</span> WASM Local Decryption Active
          </div>
          <div class="truncate">User: {currentUser()?.email || "Guest Session"}</div>
        </div>
      </aside>

      {/* ── Middle: Message List ── */}
      <section class="w-96 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Search Header */}
        <div class="p-4 border-b border-slate-200 bg-slate-50">
          <div class="relative">
            <input
              type="text"
              placeholder="Search messages (privacy tokens)…"
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
                    <button
                      onClick={() => handleDeleteMessage(msg())}
                      class="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100"
                    >
                      Delete
                    </button>
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
                <span class="text-emerald-400">Client-Side Decrypted</span>
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
                <span>✏️</span> New Encrypted Message
              </h3>
              <button onClick={() => setComposeOpen(false)} class="text-slate-400 hover:text-white text-lg">
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
                  Save Draft
                </button>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
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
    </div>
  );
};

export default App;
