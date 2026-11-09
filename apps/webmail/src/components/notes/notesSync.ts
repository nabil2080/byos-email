import {
  storeMailboxStorageObject,
  retrieveMailboxStorageObject,
  listMailboxStorageObjects,
  deleteMailboxStorageObject,
} from "../../api";
import {
  NoteItem,
  NoteChecklistItem,
  NoteReminder,
  NoteVersion,
  loadNotes,
  saveNotes,
  resolveNotesMailboxKey,
  getRawMediaRecordFromIDB,
  saveRawMediaRecordToIDB,
  deleteMediaFromIDB,
  encryptNotesMedia,
  decryptNotesMedia,
} from "./notesStore";
import { bytesToHex, hexToBytes } from "../../attachment_crypto";
import { registerSessionCleanupHook } from "../../session_isolation";

export type SyncStatus = "idle" | "syncing" | "synced" | "failed" | "offline";

export interface RemoteEncryptedNotePayload {
  id: string;
  title: string;
  content: string;
  isChecklist?: boolean;
  checklistItems?: NoteChecklistItem[];
  images?: string[];
  drawings?: string[];
  collaborators?: string[];
  color: string;
  isPinned: boolean;
  isArchived: boolean;
  isInBin: boolean;
  labels: string[];
  reminder?: NoteReminder | null;
  versionHistory?: NoteVersion[];
  createdAt: number;
  updatedAt: number;
  clientRevision?: number;
  isDeleted?: boolean;
  deletedAt?: number;
}

export interface NotesSyncQueueItem {
  id: string;
  mailboxId: string;
  noteId: string;
  action: "upsert" | "delete";
  timestamp: number;
  retryCount: number;
}

const MAX_SYNC_RETRIES = 5;

// ── SYNC STATUS & LISTENERS ──
let currentSyncStatus: SyncStatus = "idle";
const statusListeners = new Set<(status: SyncStatus) => void>();

export function getNotesSyncStatus(): SyncStatus {
  return currentSyncStatus;
}

export function setNotesSyncStatus(status: SyncStatus): void {
  currentSyncStatus = status;
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch (err) {
      console.warn("[notesSync] Status listener error:", err);
    }
  }
}

export function subscribeNotesSyncStatus(callback: (status: SyncStatus) => void): () => void {
  statusListeners.add(callback);
  callback(currentSyncStatus);
  return () => {
    statusListeners.delete(callback);
  };
}

// ── SYNC QUEUE MANAGEMENT ──
function getQueueStorageKey(mailboxId: string): string {
  return `byos_notes_sync_queue_${mailboxId || "local_default"}`;
}

export function getNotesSyncQueue(mailboxId: string): NotesSyncQueueItem[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(getQueueStorageKey(mailboxId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn("[notesSync] Failed to read sync queue:", err);
  }
  return [];
}

export function saveNotesSyncQueue(mailboxId: string, queue: NotesSyncQueueItem[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(getQueueStorageKey(mailboxId), JSON.stringify(queue));
  } catch (err) {
    console.warn("[notesSync] Failed to save sync queue:", err);
  }
}

export function enqueueNoteSync(
  mailboxId: string | undefined,
  noteId: string,
  action: "upsert" | "delete",
  noteTimestamp?: number
): void {
  if (!mailboxId) return;
  const queue = getNotesSyncQueue(mailboxId);
  // Remove existing pending action for the same note
  const filtered = queue.filter((item) => item.noteId !== noteId);
  filtered.push({
    id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mailboxId,
    noteId,
    action,
    timestamp: Math.max(Date.now(), (noteTimestamp || 0) + 1),
    retryCount: 0,
  });
  saveNotesSyncQueue(mailboxId, filtered);
}

export function dequeueNoteSync(mailboxId: string | undefined, noteId: string): void {
  if (!mailboxId) return;
  const queue = getNotesSyncQueue(mailboxId);
  const filtered = queue.filter((item) => item.noteId !== noteId);
  saveNotesSyncQueue(mailboxId, filtered);
}

export function clearNotesSyncQueue(mailboxId: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  localStorage.removeItem(getQueueStorageKey(mailboxId));
}

// ── REMOTE ENVELOPE CRYPTOGRAPHY (ZERO-KNOWLEDGE AES-GCM) ──
export async function encryptRemoteNote(
  mailboxKey: Uint8Array,
  mailboxId: string,
  payload: RemoteEncryptedNotePayload
): Promise<Uint8Array> {
  if (!mailboxKey || mailboxKey.length !== 32) {
    throw new Error("Invalid mailbox encryption key for remote note encryption");
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`byos-notes-v2:${mailboxId}:${payload.id}`);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    mailboxKey as unknown as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
      additionalData: aad as unknown as BufferSource,
    },
    cryptoKey,
    plaintext as unknown as BufferSource
  );

  const ciphertext = new Uint8Array(ciphertextBuffer);
  // Section 12 binary envelope framing: 0x01 (version byte) || IV (12-byte random nonce) || AES-256-GCM Ciphertext || 16-byte GHASH/GMAC Authentication Tag
  const envelope = new Uint8Array(1 + 12 + ciphertext.length);
  envelope[0] = 0x01;
  envelope.set(iv, 1);
  envelope.set(ciphertext, 13);
  return envelope;
}

export async function decryptRemoteNote(
  mailboxKey: Uint8Array,
  mailboxId: string,
  envelopeBytes: Uint8Array,
  expectedNoteId: string
): Promise<RemoteEncryptedNotePayload | null> {
  if (!mailboxKey || mailboxKey.length !== 32 || !envelopeBytes || envelopeBytes.length < 29) {
    return null;
  }
  if (envelopeBytes[0] !== 0x01) {
    return null;
  }
  const iv = envelopeBytes.subarray(1, 13);
  const ciphertext = envelopeBytes.subarray(13);
  const aad = new TextEncoder().encode(`byos-notes-v2:${mailboxId}:${expectedNoteId}`);

  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      mailboxKey as unknown as BufferSource,
      "AES-GCM",
      false,
      ["decrypt"]
    );

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
        additionalData: aad as unknown as BufferSource,
      },
      cryptoKey,
      ciphertext as unknown as BufferSource
    );

    const jsonStr = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(jsonStr) as RemoteEncryptedNotePayload;
  } catch (err) {
    console.warn(`[notesSync] Failed to decrypt remote note ${expectedNoteId}:`, err);
    return null;
  }
}

// ── MEDIA SYNC HELPERS ──
async function syncLocalMediaToRemote(
  mailboxId: string,
  mediaId: string,
  mailboxKey: Uint8Array,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const cleanMediaId = mediaId.replace(/^idb:/, "");
    const remoteKey = `mailboxes/${mailboxId}/notes/media/${cleanMediaId}.enc`;

    // Check if raw media record exists in IndexedDB
    const rawRecord = await getRawMediaRecordFromIDB(mediaId);
    if (!rawRecord) return false;

    let envelopeBytes: Uint8Array | null = null;
    if (rawRecord.encryptedDataUrl) {
      envelopeBytes = hexToBytes(rawRecord.encryptedDataUrl);
    } else if (rawRecord.dataUrl && rawRecord.dataUrl !== "(Encrypted Media)") {
      // Encrypt on the fly if unencrypted
      const encHex = encryptNotesMedia(mailboxKey, mailboxId, rawRecord.dataUrl, mediaId);
      if (encHex) envelopeBytes = hexToBytes(encHex);
    }

    if (!envelopeBytes || envelopeBytes.length < 29) return false;

    await storeMailboxStorageObject(mailboxId, remoteKey, envelopeBytes, undefined, signal);
    return true;
  } catch (err) {
    console.warn(`[notesSync] Failed to sync media ${mediaId} to remote:`, err);
    return false;
  }
}

async function syncRemoteMediaToLocal(
  mailboxId: string,
  mediaId: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    const cleanMediaId = mediaId.replace(/^idb:/, "");
    const remoteKey = `mailboxes/${mailboxId}/notes/media/${cleanMediaId}.enc`;

    // Check if already in local IDB
    const existing = await getRawMediaRecordFromIDB(mediaId);
    if (existing && existing.encryptedDataUrl) return true;

    const data = await retrieveMailboxStorageObject(mailboxId, remoteKey, undefined, signal);
    if (!data || data.length < 29 || data[0] !== 0x01) return false;

    const encHex = bytesToHex(data);
    await saveRawMediaRecordToIDB({
      id: mediaId,
      encryptedDataUrl: encHex,
      dataUrl: "(Encrypted Media)",
    });
    return true;
  } catch (err) {
    console.warn(`[notesSync] Failed to sync media ${mediaId} from remote:`, err);
    return false;
  }
}

// ── SYNC ORCHESTRATION ──
let activeSyncController: AbortController | null = null;
let activeSyncMailboxId: string | null = null;
let isSyncInProgress = false;

// Register session cleanup hook for multi-account safety
registerSessionCleanupHook(() => {
  if (activeSyncController) {
    activeSyncController.abort();
    activeSyncController = null;
  }
  activeSyncMailboxId = null;
  isSyncInProgress = false;
  setNotesSyncStatus("idle");
});

export async function syncNotesWithRemote(
  mailboxId: string,
  mailboxKey?: Uint8Array | null,
  signal?: AbortSignal
): Promise<{ success: boolean; syncedCount: number; conflictCount: number; error?: string }> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setNotesSyncStatus("offline");
    return { success: false, syncedCount: 0, conflictCount: 0, error: "Network offline" };
  }

  const key = resolveNotesMailboxKey(mailboxId, mailboxKey);
  if (!key || key.length !== 32) {
    return { success: false, syncedCount: 0, conflictCount: 0, error: "Mailbox encryption key unavailable" };
  }

  if (isSyncInProgress && activeSyncMailboxId === mailboxId) {
    return { success: true, syncedCount: 0, conflictCount: 0 };
  }

  isSyncInProgress = true;
  activeSyncMailboxId = mailboxId;
  setNotesSyncStatus("syncing");

  const abortController = new AbortController();
  activeSyncController = abortController;

  const combinedSignal = signal || abortController.signal;

  let syncedCount = 0;
  let conflictCount = 0;
  const syncStartTime = Date.now();
  const deletedInSync = new Set<string>();
  const conflictedInSync = new Set<string>();

  try {
    // Load local notes
    let localNotes = loadNotes(mailboxId, key);

    // ── STEP 1: List and pull remote objects (PULL-BEFORE-PUSH) ──
    const listResponse = await listMailboxStorageObjects(mailboxId, "notes/", undefined, combinedSignal);
    const remoteObjectKeys = listResponse.objects || [];

    // Filter to note objects (exclude media subfolder and manifest)
    const noteObjectKeys = remoteObjectKeys.filter((k) => {
      const parts = k.split("/");
      const filename = parts[parts.length - 1];
      return !k.includes("/media/") && filename.endsWith(".enc") && filename !== "manifest.enc";
    });

    const remoteNoteIds = new Set<string>();

    for (const objKey of noteObjectKeys) {
      if (combinedSignal.aborted) break;
      const parts = objKey.split("/");
      const filename = parts[parts.length - 1];
      const remoteNoteId = filename.replace(/\.enc$/, "");
      remoteNoteIds.add(remoteNoteId);

      try {
        const rawBytes = await retrieveMailboxStorageObject(mailboxId, objKey, undefined, combinedSignal);
        if (!rawBytes || rawBytes.length < 29) continue;

        const remotePayload = await decryptRemoteNote(key, mailboxId, rawBytes, remoteNoteId);
        if (!remotePayload) continue;

        const localIndex = localNotes.findIndex((n) => n.id === remoteNoteId);
        const localNote = localIndex >= 0 ? localNotes[localIndex] : null;

        if (remotePayload.isDeleted) {
          // Remote tombstone
          if (localNote) {
            if (localNote.updatedAt <= (remotePayload.deletedAt || remotePayload.updatedAt)) {
              // Delete locally
              localNotes = localNotes.filter((n) => n.id !== remoteNoteId);
              deletedInSync.add(remoteNoteId);
              dequeueNoteSync(mailboxId, remoteNoteId);
              syncedCount++;
            } else {
              // Local was modified after remote deletion: re-upload local note
              enqueueNoteSync(mailboxId, remoteNoteId, "upsert");
            }
          }
          continue;
        }

        // Pull any media references missing locally
        const mediaRefs = [...(remotePayload.images || []), ...(remotePayload.drawings || [])];
        for (const m of mediaRefs) {
          if (m.startsWith("idb:")) {
            await syncRemoteMediaToLocal(mailboxId, m, combinedSignal);
          }
        }

        const initialQueue = getNotesSyncQueue(mailboxId);
        const pendingDelete = initialQueue.find((q) => q.noteId === remoteNoteId && q.action === "delete");
        if (pendingDelete && remotePayload.updatedAt <= pendingDelete.timestamp) {
          // Local deletion is newer than remote note: do not resurrect from remote
          continue;
        }

        if (!localNote) {
          // New note from remote device
          const newLocalNote: NoteItem = {
            id: remotePayload.id,
            title: remotePayload.title,
            content: remotePayload.content,
            isChecklist: remotePayload.isChecklist,
            checklistItems: remotePayload.checklistItems || [],
            images: remotePayload.images || [],
            drawings: remotePayload.drawings || [],
            collaborators: remotePayload.collaborators || [],
            color: remotePayload.color || "default",
            isPinned: Boolean(remotePayload.isPinned),
            isArchived: Boolean(remotePayload.isArchived),
            isInBin: Boolean(remotePayload.isInBin),
            labels: remotePayload.labels || [],
            reminder: remotePayload.reminder,
            versionHistory: remotePayload.versionHistory || [],
            createdAt: remotePayload.createdAt,
            updatedAt: remotePayload.updatedAt,
            syncedRevision: remotePayload.updatedAt,
            syncStatus: "synced",
            _decrypted: true,
          };
          localNotes.push(newLocalNote);
          dequeueNoteSync(mailboxId, remoteNoteId);
          syncedCount++;
        } else {
          // Note exists on both devices: check revision and detect conflicts
          const remoteUpdated = remotePayload.updatedAt || 0;
          const localUpdated = localNote.updatedAt || 0;
          const lastSynced = localNote.syncedRevision || 0;

          const isRemoteModifiedSinceSync = remoteUpdated > lastSynced;
          const isLocalModifiedSinceSync = localUpdated > lastSynced;
          const isContentIdentical =
            remotePayload.title === localNote.title &&
            remotePayload.content === localNote.content &&
            JSON.stringify(remotePayload.checklistItems || []) === JSON.stringify(localNote.checklistItems || []);

          if (isRemoteModifiedSinceSync && isLocalModifiedSinceSync && !isContentIdentical) {
            // CONFLICT DETECTED: simultaneous concurrent edits on both devices since last sync
            conflictCount++;
            conflictedInSync.add(remoteNoteId);
            const conflictId = `note-conflict-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const conflictCopy: NoteItem = {
              ...localNote,
              id: conflictId,
              title: `${localNote.title || "Untitled"} (Conflict copy - ${new Date(localUpdated).toLocaleDateString()})`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              syncedRevision: undefined,
              syncStatus: "saving",
              _decrypted: true,
            };
            localNotes.push(conflictCopy);
            enqueueNoteSync(mailboxId, conflictId, "upsert");

            // Adopt remote note for the primary note ID
            localNotes[localIndex] = {
              ...localNote,
              title: remotePayload.title,
              content: remotePayload.content,
              isChecklist: remotePayload.isChecklist,
              checklistItems: remotePayload.checklistItems || [],
              images: remotePayload.images || [],
              drawings: remotePayload.drawings || [],
              collaborators: remotePayload.collaborators || [],
              color: remotePayload.color,
              isPinned: Boolean(remotePayload.isPinned),
              isArchived: Boolean(remotePayload.isArchived),
              isInBin: Boolean(remotePayload.isInBin),
              labels: remotePayload.labels || [],
              reminder: remotePayload.reminder,
              versionHistory: remotePayload.versionHistory || [],
              updatedAt: remotePayload.updatedAt,
              syncedRevision: remotePayload.updatedAt,
              syncStatus: "synced",
              _decrypted: true,
            };
            dequeueNoteSync(mailboxId, remoteNoteId);
            syncedCount++;
          } else if (remoteUpdated > localUpdated) {
            // Clean fast-forward: remote is newer and local was not concurrently modified
            localNotes[localIndex] = {
              ...localNote,
              title: remotePayload.title,
              content: remotePayload.content,
              isChecklist: remotePayload.isChecklist,
              checklistItems: remotePayload.checklistItems || [],
              images: remotePayload.images || [],
              drawings: remotePayload.drawings || [],
              collaborators: remotePayload.collaborators || [],
              color: remotePayload.color,
              isPinned: Boolean(remotePayload.isPinned),
              isArchived: Boolean(remotePayload.isArchived),
              isInBin: Boolean(remotePayload.isInBin),
              labels: remotePayload.labels || [],
              reminder: remotePayload.reminder,
              versionHistory: remotePayload.versionHistory || [],
              updatedAt: remotePayload.updatedAt,
              syncedRevision: remotePayload.updatedAt,
              syncStatus: "synced",
              _decrypted: true,
            };
            dequeueNoteSync(mailboxId, remoteNoteId);
            syncedCount++;
          } else if (localUpdated > remoteUpdated) {
            // Local is newer and remote was not modified since last sync: enqueue for upload
            enqueueNoteSync(mailboxId, localNote.id, "upsert");
          } else {
            // Already in sync
            localNote.syncedRevision = localNote.updatedAt;
            localNote.syncStatus = "synced";
            dequeueNoteSync(mailboxId, remoteNoteId);
          }
        }
      } catch (err) {
        console.warn(`[notesSync] Error syncing remote note ${objKey}:`, err);
      }
    }

    // ── STEP 2: Process and drain local offline sync queue (PUSH) ──
    const queue = getNotesSyncQueue(mailboxId);
    const remainingQueue: NotesSyncQueueItem[] = [];
    for (const item of queue) {
      if (combinedSignal.aborted) break;
      if ((item.retryCount || 0) >= MAX_SYNC_RETRIES) {
        console.warn(`[notesSync] Dropping permanently failing queue item ${item.noteId} after ${item.retryCount} retries`);
        continue;
      }
      try {
        if (item.action === "delete") {
          const tombstoneTimestamp = Math.max(Date.now(), (item.timestamp || 0) + 1);
          const tombstonePayload: RemoteEncryptedNotePayload = {
            id: item.noteId,
            title: "",
            content: "",
            color: "default",
            isPinned: false,
            isArchived: false,
            isInBin: true,
            labels: [],
            createdAt: tombstoneTimestamp,
            updatedAt: tombstoneTimestamp,
            isDeleted: true,
            deletedAt: tombstoneTimestamp,
          };
          const encTombstone = await encryptRemoteNote(key, mailboxId, tombstonePayload);
          const remoteKey = `mailboxes/${mailboxId}/notes/${item.noteId}.enc`;
          await storeMailboxStorageObject(mailboxId, remoteKey, encTombstone, undefined, combinedSignal);
          syncedCount++;
        } else {
          const note = localNotes.find((n) => n.id === item.noteId);
          if (note && !note.isDeleted) {
            // Sync all attached media first
            const allMedia = [...(note.images || []), ...(note.drawings || [])];
            for (const m of allMedia) {
              if (m.startsWith("idb:")) {
                await syncLocalMediaToRemote(mailboxId, m, key, combinedSignal);
              }
            }

            const remotePayload: RemoteEncryptedNotePayload = {
              id: note.id,
              title: note.title,
              content: note.content,
              isChecklist: note.isChecklist,
              checklistItems: note.checklistItems,
              images: note.images,
              drawings: note.drawings,
              collaborators: note.collaborators,
              color: note.color,
              isPinned: note.isPinned,
              isArchived: note.isArchived,
              isInBin: note.isInBin,
              labels: note.labels,
              reminder: note.reminder,
              versionHistory: note.versionHistory,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
              clientRevision: note.updatedAt,
            };

            const encNote = await encryptRemoteNote(key, mailboxId, remotePayload);
            const remoteKey = `mailboxes/${mailboxId}/notes/${note.id}.enc`;
            await storeMailboxStorageObject(mailboxId, remoteKey, encNote, undefined, combinedSignal);

            note.syncedRevision = note.updatedAt;
            note.syncStatus = "synced";
            syncedCount++;
          }
        }
      } catch (err) {
        console.warn(`[notesSync] Failed to process queue item ${item.noteId}:`, err);
        item.retryCount = (item.retryCount || 0) + 1;
        if (item.retryCount < MAX_SYNC_RETRIES) {
          remainingQueue.push(item);
        }
      }
    }
    saveNotesSyncQueue(mailboxId, remainingQueue);

    // ── STEP 3: Check local notes not present on remote ──
    for (const localNote of localNotes) {
      if (!remoteNoteIds.has(localNote.id) && !localNote.isDeleted && !localNote.isInBin) {
        // Enqueue newly created local notes for remote storage
        enqueueNoteSync(mailboxId, localNote.id, "upsert");
      }
    }

    // ── STEP 4: Merge any concurrent local edits made while sync was in flight ──
    const freshLocalNotes = loadNotes(mailboxId, key);
    for (const fresh of freshLocalNotes) {
      if (deletedInSync.has(fresh.id)) continue;
      const idx = localNotes.findIndex((n) => n.id === fresh.id);
      if (idx === -1) {
        if ((fresh.createdAt || 0) >= syncStartTime) {
          localNotes.push(fresh);
        }
      } else if (!conflictedInSync.has(fresh.id) && (fresh.updatedAt || 0) > (localNotes[idx].updatedAt || 0)) {
        // User made a newer local edit while async sync network requests were in flight
        localNotes[idx] = fresh;
      }
    }

    // Save consolidated local state
    saveNotes(mailboxId, localNotes, key);
    setNotesSyncStatus("synced");
    return { success: true, syncedCount, conflictCount };
  } catch (err) {
    console.warn("[notesSync] Sync failed:", err);
    setNotesSyncStatus("failed");
    return { success: false, syncedCount, conflictCount, error: String(err) };
  } finally {
    isSyncInProgress = false;
    activeSyncController = null;
  }
}

// ── DEBOUNCED SYNC TRIGGER ──
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function triggerNotesSync(
  mailboxId: string | undefined,
  mailboxKey?: Uint8Array | null,
  delayMs = 1200
): Promise<void> {
  if (!mailboxId) return Promise.resolve();
  if (typeof window === "undefined" && !process?.env?.TEST_STORAGE_SYNC) {
    return Promise.resolve();
  }
  if (debounceTimer) clearTimeout(debounceTimer);

  return new Promise((resolve) => {
    debounceTimer = setTimeout(async () => {
      try {
        await syncNotesWithRemote(mailboxId, mailboxKey);
      } finally {
        resolve();
      }
    }, delayMs);
  });
}

// ── AUTO-LISTENER FOR ONLINE & VISIBILITY RECONNECTS ──
export function initNotesSyncAutoListener(): () => void {
  if (typeof window === "undefined") return () => {};

  const handleOnline = () => {
    setNotesSyncStatus("idle");
    if (activeSyncMailboxId) {
      triggerNotesSync(activeSyncMailboxId, null, 300);
    }
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible" && activeSyncMailboxId) {
      triggerNotesSync(activeSyncMailboxId, null, 1000);
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
