import {
  wasm_aes_gcm_encrypt,
  wasm_aes_gcm_decrypt,
} from "../../generated/crypto-core/byos_crypto_core.js";
import { bytesToHex, hexToBytes } from "../../attachment_crypto";

export interface NoteChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface NoteReminder {
  timestamp: number;
  label?: string;
}

export interface NoteVersion {
  id: string;
  timestamp: number;
  title: string;
  content: string;
  isChecklist?: boolean;
  checklistItems?: NoteChecklistItem[];
  images?: string[];
  drawings?: string[];
  encryptedPayload?: string;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  isChecklist?: boolean;
  checklistItems?: NoteChecklistItem[];
  images?: string[];
  drawings?: string[];
  collaborators?: string[];
  color: string; // 'default' | 'peach' | 'amber' | 'sage' | 'sky' | 'lavender' | 'pink' | 'sand'
  isPinned: boolean;
  isArchived: boolean;
  isInBin: boolean;
  labels: string[];
  reminder?: NoteReminder | null;
  versionHistory?: NoteVersion[];
  createdAt: number;
  updatedAt: number;
  encryptedPayload?: string;
  _isLocked?: boolean;
  _decrypted?: boolean;
}

export const NOTE_COLORS: Array<{
  id: string;
  name: string;
  lightBg: string;
  darkBg: string;
  borderLight: string;
  borderDark: string;
  swatchClass: string;
}> = [
  {
    id: "default",
    name: "Default",
    lightBg: "bg-white",
    darkBg: "dark:bg-[#1E1F23]",
    borderLight: "border-[#E2DFD8]",
    borderDark: "dark:border-[#2A2D35]",
    swatchClass: "bg-white border-[#E2DFD8]",
  },
  {
    id: "peach",
    name: "Peach",
    lightBg: "bg-[#FFF2EB]",
    darkBg: "dark:bg-[#342721]",
    borderLight: "border-[#FADCD0]",
    borderDark: "dark:border-[#4E3931]",
    swatchClass: "bg-[#FADCD0] border-[#E8BFB0]",
  },
  {
    id: "amber",
    name: "Amber",
    lightBg: "bg-[#FEF8EA]",
    darkBg: "dark:bg-[#362F1F]",
    borderLight: "border-[#FCE7B8]",
    borderDark: "dark:border-[#52462C]",
    swatchClass: "bg-[#FDE68A] border-[#F59E0B]",
  },
  {
    id: "sage",
    name: "Sage",
    lightBg: "bg-[#F1F8F3]",
    darkBg: "dark:bg-[#203126]",
    borderLight: "border-[#D1EBD8]",
    borderDark: "dark:border-[#2F4A38]",
    swatchClass: "bg-[#BBF7D0] border-[#10B981]",
  },
  {
    id: "sky",
    name: "Sky",
    lightBg: "bg-[#F0F7FF]",
    darkBg: "dark:bg-[#1E2C3D]",
    borderLight: "border-[#CCE4FF]",
    borderDark: "dark:border-[#2A435E]",
    swatchClass: "bg-[#BAE6FD] border-[#0EA5E9]",
  },
  {
    id: "lavender",
    name: "Lavender",
    lightBg: "bg-[#F7F3FF]",
    darkBg: "dark:bg-[#2E243D]",
    borderLight: "border-[#E5D7FF]",
    borderDark: "dark:border-[#473461]",
    swatchClass: "bg-[#E9D5FF] border-[#8B5CF6]",
  },
  {
    id: "pink",
    name: "Pink",
    lightBg: "bg-[#FFF0F5]",
    darkBg: "dark:bg-[#3A222E]",
    borderLight: "border-[#F8D7E3]",
    borderDark: "dark:border-[#52293E]",
    swatchClass: "bg-[#FBCFE8] border-[#EC4899]",
  },
  {
    id: "sand",
    name: "Sand",
    lightBg: "bg-[#FAF5EF]",
    darkBg: "dark:bg-[#2D2A26]",
    borderLight: "border-[#E8DFD5]",
    borderDark: "dark:border-[#453F39]",
    swatchClass: "bg-[#E7E5E4] border-[#A8A29E]",
  },
];

const STORAGE_PREFIX = "byos_notes_";
const LABELS_STORAGE_PREFIX = "byos_note_labels_";
const LABELS_INITIALIZED_PREFIX = "byos_note_labels_init_";

export function getNotesStorageKey(mailboxId?: string): string {
  return `${STORAGE_PREFIX}${mailboxId || "local_default"}`;
}

export function getLabelsStorageKey(mailboxId?: string): string {
  return `${LABELS_STORAGE_PREFIX}${mailboxId || "local_default"}`;
}

// ── LABELS STORE ──
export function loadLabels(mailboxId?: string): string[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return ["Personal", "Work", "Inspiration"];
  }
  const key = getLabelsStorageKey(mailboxId);
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
    // If this mailbox was previously initialized (even if all labels were deleted), do not restore defaults
    if (localStorage.getItem(LABELS_INITIALIZED_PREFIX + key) === "true") {
      return [];
    }
  } catch (err) {
    console.warn("Failed to load note labels:", err);
  }
  const defaultLabels = ["Personal", "Work", "Inspiration"];
  saveLabels(mailboxId, defaultLabels);
  return defaultLabels;
}

export function saveLabels(mailboxId: string | undefined, labels: string[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const key = getLabelsStorageKey(mailboxId);
  try {
    localStorage.setItem(key, JSON.stringify(labels));
    localStorage.setItem(LABELS_INITIALIZED_PREFIX + key, "true");
  } catch (err) {
    console.warn("Failed to save note labels:", err);
  }
}

export function addLabel(mailboxId: string | undefined, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const labels = loadLabels(mailboxId);
  if (labels.some((l) => l.toLowerCase() === trimmed.toLowerCase())) {
    return false;
  }
  const updated = [...labels, trimmed];
  saveLabels(mailboxId, updated);
  return true;
}

export function renameLabel(mailboxId: string | undefined, oldName: string, newName: string): boolean {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const labels = loadLabels(mailboxId);
  const idx = labels.findIndex((l) => l.toLowerCase() === oldName.toLowerCase());
  if (idx === -1) return false;
  labels[idx] = trimmed;
  saveLabels(mailboxId, labels);

  // Update notes that used the old label name
  const notes = loadNotes(mailboxId);
  let changed = false;
  for (const n of notes) {
    if (n.labels && n.labels.includes(oldName)) {
      n.labels = n.labels.map((l) => (l === oldName ? trimmed : l));
      changed = true;
    }
  }
  if (changed) saveNotes(mailboxId, notes);
  return true;
}

export function deleteLabel(mailboxId: string | undefined, name: string): boolean {
  const labels = loadLabels(mailboxId);
  const filtered = labels.filter((l) => l.toLowerCase() !== name.toLowerCase());
  saveLabels(mailboxId, filtered);

  // Remove label from all notes (case-insensitive cleanup)
  const notes = loadNotes(mailboxId);
  let changed = false;
  for (const n of notes) {
    if (n.labels && n.labels.some((l) => l.toLowerCase() === name.toLowerCase())) {
      n.labels = n.labels.filter((l) => l.toLowerCase() !== name.toLowerCase());
      changed = true;
    }
  }
  if (changed) saveNotes(mailboxId, notes);
  return true;
}

// ── ZERO-KNOWLEDGE CRYPTO & MEDIA STORAGE ──
export const NOTES_AAD_PREFIX = "byos-notes-v1";

export function computeNotesAad(mailboxId?: string): Uint8Array {
  return new TextEncoder().encode(`${NOTES_AAD_PREFIX}:${mailboxId || "local_default"}`);
}

export interface NoteSensitivePayload {
  title: string;
  content: string;
  checklistItems?: NoteChecklistItem[];
  versionHistory?: NoteVersion[];
}

let storeMailboxKey: Uint8Array | null = null;

export function setNotesMailboxKey(key: Uint8Array | null): void {
  storeMailboxKey = key;
}

export function getNotesMailboxKey(): Uint8Array | null {
  return storeMailboxKey;
}

export function encryptNoteSensitiveSync(
  mailboxKey: Uint8Array,
  mailboxId: string | undefined,
  sensitive: NoteSensitivePayload
): string {
  if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32) {
    throw new Error("Invalid mailbox encryption key: 32 bytes required");
  }
  const keyHex = bytesToHex(mailboxKey);
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(sensitive));
  const plaintextHex = bytesToHex(plaintextBytes);
  const aadBytes = computeNotesAad(mailboxId);
  const aadHex = bytesToHex(aadBytes);

  return wasm_aes_gcm_encrypt(keyHex, plaintextHex, aadHex);
}

export function decryptNoteSensitiveSync(
  mailboxKey: Uint8Array,
  mailboxId: string | undefined,
  envelopeHex: string
): NoteSensitivePayload | null {
  if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32 || !envelopeHex) {
    return null;
  }
  try {
    const keyHex = bytesToHex(mailboxKey);
    const aadBytes = computeNotesAad(mailboxId);
    const aadHex = bytesToHex(aadBytes);
    const plaintextHex = wasm_aes_gcm_decrypt(keyHex, envelopeHex, aadHex);
    const plaintextBytes = hexToBytes(plaintextHex);
    const jsonStr = new TextDecoder().decode(plaintextBytes);
    return JSON.parse(jsonStr) as NoteSensitivePayload;
  } catch (err) {
    console.warn("Failed to decrypt note envelope with WASM:", err);
    return null;
  }
}

export async function encryptNoteSensitiveSubtle(
  mailboxKey: Uint8Array,
  mailboxId: string | undefined,
  sensitive: NoteSensitivePayload
): Promise<string> {
  if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32) {
    throw new Error("Invalid mailbox encryption key: 32 bytes required");
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(sensitive));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = computeNotesAad(mailboxId);

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
  const envelope = new Uint8Array(1 + 12 + ciphertext.length);
  envelope[0] = 0x01;
  envelope.set(iv, 1);
  envelope.set(ciphertext, 13);

  return bytesToHex(envelope);
}

export async function decryptNoteSensitiveSubtle(
  mailboxKey: Uint8Array,
  mailboxId: string | undefined,
  envelopeHex: string
): Promise<NoteSensitivePayload | null> {
  if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32 || !envelopeHex) {
    return null;
  }
  try {
    const envelope = hexToBytes(envelopeHex);
    if (envelope.length < 29 || envelope[0] !== 0x01) {
      return null;
    }
    const iv = envelope.subarray(1, 13);
    const ciphertext = envelope.subarray(13);
    const aad = computeNotesAad(mailboxId);

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
    return JSON.parse(jsonStr) as NoteSensitivePayload;
  } catch (err) {
    console.warn("Failed to decrypt note envelope with Web Crypto:", err);
    return null;
  }
}

// ── INDEXEDDB MEDIA STORAGE (DRAWINGS & PHOTOS) ──
const MEDIA_DB_NAME = "byos_notes_media_db";
const MEDIA_STORE_NAME = "media";
const MEDIA_DB_VERSION = 1;

let mediaDbPromise: Promise<IDBDatabase | null> | null = null;
const MAX_MEDIA_CACHE_SIZE = 150;
const mediaCache = new Map<string, string>();

export function getCachedMedia(id: string): string | undefined {
  return mediaCache.get(id);
}

export function setCachedMedia(id: string, dataUrl: string): void {
  if (mediaCache.has(id)) {
    mediaCache.delete(id);
  } else if (mediaCache.size >= MAX_MEDIA_CACHE_SIZE) {
    const oldestKey = mediaCache.keys().next().value;
    if (oldestKey) mediaCache.delete(oldestKey);
  }
  mediaCache.set(id, dataUrl);
}

export function clearNotesMediaCache(): void {
  mediaCache.clear();
  mediaDbPromise = null;
}

export function getIDBFactory(): IDBFactory | undefined {
  if (typeof indexedDB !== "undefined") {
    return indexedDB;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).indexedDB) {
    return (globalThis as any).indexedDB;
  }
  return undefined;
}

export function openNotesMediaDB(): Promise<IDBDatabase | null> {
  const factory = getIDBFactory();
  if (!factory) return Promise.resolve(null);
  if (mediaDbPromise) return mediaDbPromise;

  mediaDbPromise = new Promise((resolve) => {
    try {
      const req = factory.open(MEDIA_DB_NAME, MEDIA_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MEDIA_STORE_NAME)) {
          db.createObjectStore(MEDIA_STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        console.warn("Failed to open notes media IndexedDB:", req.error);
        mediaDbPromise = null;
        resolve(null);
      };
    } catch (e) {
      console.warn("IndexedDB open error:", e);
      mediaDbPromise = null;
      resolve(null);
    }
  });

  return mediaDbPromise;
}

export async function saveMediaToIDB(id: string, dataUrl: string): Promise<string> {
  mediaCache.set(id, dataUrl);
  const db = await openNotesMediaDB();
  if (!db) return id;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      const store = tx.objectStore(MEDIA_STORE_NAME);
      const req = store.put({ id, dataUrl, createdAt: Date.now() });
      req.onsuccess = () => resolve(id);
      req.onerror = () => {
        console.warn("Failed to put media in IDB:", req.error);
        resolve(id);
      };
    } catch (err) {
      console.warn("Transaction error in saveMediaToIDB:", err);
      resolve(id);
    }
  });
}

export async function getMediaFromIDB(id: string): Promise<string | null> {
  if (mediaCache.has(id)) {
    return mediaCache.get(id)!;
  }
  const db = await openNotesMediaDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MEDIA_STORE_NAME, "readonly");
      const store = tx.objectStore(MEDIA_STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result?.dataUrl) {
          mediaCache.set(id, req.result.dataUrl);
          resolve(req.result.dataUrl);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function deleteMediaFromIDB(id: string): Promise<boolean> {
  mediaCache.delete(id);
  const db = await openNotesMediaDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(MEDIA_STORE_NAME, "readwrite");
      const store = tx.objectStore(MEDIA_STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export function offloadMediaIfDataUrl(dataUrl: string, prefix: "drawing" | "image"): string {
  if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
    const id = `idb:${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    saveMediaToIDB(id, dataUrl);
    return id;
  }
  return dataUrl;
}

// ── SELECTION-AWARE MARKDOWN FORMATTING HELPER ──
export function applyMarkdownFormat(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  format: "bold" | "italic" | "underline" | "bullet"
): { newContent: string; newSelectionStart: number; newSelectionEnd: number } {
  const len = content.length;
  const start = Math.max(0, Math.min(selectionStart, len));
  const end = Math.max(0, Math.min(selectionEnd, len));
  const actualStart = Math.min(start, end);
  const actualEnd = Math.max(start, end);

  const before = content.substring(0, actualStart);
  const selected = content.substring(actualStart, actualEnd);
  const after = content.substring(actualEnd);

  let prefix = "";
  let suffix = "";
  let defaultText = "";

  switch (format) {
    case "bold":
      prefix = "**";
      suffix = "**";
      defaultText = "bold text";
      break;
    case "italic":
      prefix = "*";
      suffix = "*";
      defaultText = "italic text";
      break;
    case "underline":
      prefix = "<u>";
      suffix = "</u>";
      defaultText = "underlined";
      break;
    case "bullet": {
      if (actualStart !== actualEnd) {
        const lines = selected.split("\n");
        const bulleted = lines.map((l) => (l.startsWith("• ") ? l : `• ${l}`)).join("\n");
        const newContent = before + bulleted + after;
        return {
          newContent,
          newSelectionStart: actualStart,
          newSelectionEnd: actualStart + bulleted.length,
        };
      } else {
        const textToInsert = "• List item";
        const newContent = before + textToInsert + after;
        return {
          newContent,
          newSelectionStart: actualStart,
          newSelectionEnd: actualStart + textToInsert.length,
        };
      }
    }
  }

  if (actualStart !== actualEnd) {
    const formatted = prefix + selected + suffix;
    const newContent = before + formatted + after;
    return {
      newContent,
      newSelectionStart: actualStart + prefix.length,
      newSelectionEnd: actualStart + prefix.length + selected.length,
    };
  } else {
    const formatted = prefix + defaultText + suffix;
    const newContent = before + formatted + after;
    return {
      newContent,
      newSelectionStart: actualStart + prefix.length,
      newSelectionEnd: actualStart + prefix.length + defaultText.length,
    };
  }
}

// ── NOTES STORE ──
export function loadNotes(mailboxId?: string, mailboxKey?: Uint8Array | null): NoteItem[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  const key = mailboxKey !== undefined ? mailboxKey : storeMailboxKey;

  try {
    const raw = localStorage.getItem(getNotesStorageKey(mailboxId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((n: any) => {
          const item: NoteItem = {
            ...n,
            isArchived: Boolean(n.isArchived),
            isInBin: Boolean(n.isInBin),
            labels: Array.isArray(n.labels) ? n.labels : [],
            isChecklist: Boolean(n.isChecklist),
            checklistItems: Array.isArray(n.checklistItems) ? n.checklistItems : [],
            images: Array.isArray(n.images) ? n.images : [],
            drawings: Array.isArray(n.drawings) ? n.drawings : [],
            collaborators: Array.isArray(n.collaborators) ? n.collaborators : [],
            versionHistory: Array.isArray(n.versionHistory) ? n.versionHistory : [],
          };

          if (n.encryptedPayload) {
            item.encryptedPayload = n.encryptedPayload;
            if (key && key.length === 32) {
              const decrypted = decryptNoteSensitiveSync(key, mailboxId, n.encryptedPayload);
              if (decrypted) {
                item.title = decrypted.title ?? "";
                item.content = decrypted.content ?? "";
                item.checklistItems = Array.isArray(decrypted.checklistItems) ? decrypted.checklistItems : [];
                item.versionHistory = Array.isArray(decrypted.versionHistory) ? decrypted.versionHistory : [];
                item._decrypted = true;
              } else {
                item.title = "(Encrypted Note)";
                item.content = "";
                item._isLocked = true;
              }
            } else {
              item.title = "(Encrypted Note)";
              item.content = "";
              item._isLocked = true;
            }
          } else {
            // Legacy plaintext note fallback
            item._decrypted = true;
          }

          return item;
        });
      }
    }
  } catch (err) {
    console.warn("Failed to load notes from localStorage:", err);
  }

  // Provide initial welcome notes if empty
  const defaultNotes: NoteItem[] = [
    {
      id: "note-welcome",
      title: "Welcome to BYOS Notes",
      content: "Capture thoughts, checklists, meeting briefs, and daily reminders with zero-knowledge encryption.",
      color: "peach",
      isPinned: true,
      isArchived: false,
      isInBin: false,
      labels: ["Inspiration"],
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3600000,
    },
    {
      id: "note-security-checklist",
      title: "Security & Encryption Checklist",
      content: "✓ Historical key reactivation completed\n✓ Argon2id + ChaCha20-Poly1305 active\n✓ Offline sync ready",
      isChecklist: true,
      checklistItems: [
        { id: "item-1", text: "Historical key reactivation verified", completed: true },
        { id: "item-2", text: "Argon2id + ChaCha20-Poly1305 active", completed: true },
        { id: "item-3", text: "Offline sync ready", completed: true },
        { id: "item-4", text: "End-to-end encrypted notes storage", completed: false },
      ],
      color: "sage",
      isPinned: false,
      isArchived: false,
      isInBin: false,
      labels: ["Work"],
      reminder: {
        timestamp: Date.now() + 86400000,
        label: "Tomorrow, 8:00 AM",
      },
      createdAt: Date.now() - 1800000,
      updatedAt: Date.now() - 1800000,
    },
  ];
  saveNotes(mailboxId, defaultNotes, key);
  return defaultNotes;
}

export function saveNotes(mailboxId: string | undefined, notes: NoteItem[], mailboxKey?: Uint8Array | null): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  const key = mailboxKey !== undefined ? mailboxKey : storeMailboxKey;

  try {
    const toStore = notes.map((n) => {
      // Offload any inline data URLs in images/drawings to IDB if needed
      const drawings = (n.drawings || []).map((d) => offloadMediaIfDataUrl(d, "drawing"));
      const images = (n.images || []).map((img) => offloadMediaIfDataUrl(img, "image"));

      if (key && key.length === 32) {
        // If note was locked and not decrypted, retain its original encrypted payload!
        if (n._isLocked && n.encryptedPayload) {
          return {
            ...n,
            title: "",
            content: "",
            checklistItems: [],
            versionHistory: [],
            drawings,
            images,
          };
        }

        const sensitive: NoteSensitivePayload = {
          title: n.title || "",
          content: n.content || "",
          checklistItems: n.checklistItems || [],
          versionHistory: n.versionHistory || [],
        };

        const encryptedHex = encryptNoteSensitiveSync(key, mailboxId, sensitive);
        return {
          ...n,
          title: "", // Redacted in storage
          content: "", // Redacted in storage
          checklistItems: [], // Redacted in storage
          versionHistory: [], // Redacted in storage
          encryptedPayload: encryptedHex,
          drawings,
          images,
        };
      } else {
        // Unencrypted save (legacy or when unlocked without key)
        return {
          ...n,
          drawings,
          images,
        };
      }
    });

    localStorage.setItem(getNotesStorageKey(mailboxId), JSON.stringify(toStore));
  } catch (err) {
    console.warn("Failed to save notes to localStorage:", err);
  }
}

export function createNote(
  mailboxId: string | undefined,
  title: string,
  content: string,
  color: string = "default",
  isPinned: boolean = false,
  extra?: Partial<NoteItem>
): NoteItem {
  const notes = loadNotes(mailboxId);
  const images = (extra?.images || []).map((img) => offloadMediaIfDataUrl(img, "image"));
  const drawings = (extra?.drawings || []).map((drw) => offloadMediaIfDataUrl(drw, "drawing"));

  const newNote: NoteItem = {
    id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    title: title.trim(),
    content: content.trim(),
    color: color || "default",
    isPinned,
    isArchived: false,
    isInBin: false,
    labels: extra?.labels || [],
    isChecklist: extra?.isChecklist || false,
    checklistItems: extra?.checklistItems || [],
    images,
    drawings,
    collaborators: extra?.collaborators || [],
    reminder: extra?.reminder || null,
    versionHistory: extra?.versionHistory || [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const updated = [newNote, ...notes];
  saveNotes(mailboxId, updated);
  return newNote;
}

export function getAllNoteMediaIds(note: NoteItem): string[] {
  const ids = new Set<string>();
  for (const d of note.drawings || []) {
    if (d && d.startsWith("idb:")) ids.add(d);
  }
  for (const img of note.images || []) {
    if (img && img.startsWith("idb:")) ids.add(img);
  }
  for (const v of note.versionHistory || []) {
    for (const d of v.drawings || []) {
      if (d && d.startsWith("idb:")) ids.add(d);
    }
    for (const img of v.images || []) {
      if (img && img.startsWith("idb:")) ids.add(img);
    }
  }
  return Array.from(ids);
}

export function isMediaReferencedInNotes(notes: NoteItem[], mediaId: string, excludeNoteId?: string): boolean {
  for (const n of notes) {
    if (excludeNoteId && n.id === excludeNoteId) continue;
    for (const d of n.drawings || []) {
      if (d === mediaId) return true;
    }
    for (const img of n.images || []) {
      if (img === mediaId) return true;
    }
    for (const v of n.versionHistory || []) {
      for (const d of v.drawings || []) {
        if (d === mediaId) return true;
      }
      for (const img of v.images || []) {
        if (img === mediaId) return true;
      }
    }
  }
  return false;
}

export function updateNote(
  mailboxId: string | undefined,
  id: string,
  patch: Partial<NoteItem>
): NoteItem | null {
  const notes = loadNotes(mailboxId);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return null;

  if (notes[idx]._isLocked) {
    console.warn("Cannot update locked encrypted note without decryption key");
    return null;
  }

  const patchImages = patch.images
    ? patch.images.map((img) => offloadMediaIfDataUrl(img, "image"))
    : undefined;
  const patchDrawings = patch.drawings
    ? patch.drawings.map((drw) => offloadMediaIfDataUrl(drw, "drawing"))
    : undefined;

  const updatedNote: NoteItem = {
    ...notes[idx],
    ...patch,
    ...(patchImages ? { images: patchImages } : {}),
    ...(patchDrawings ? { drawings: patchDrawings } : {}),
    updatedAt: Date.now(),
  };

  notes[idx] = updatedNote;
  saveNotes(mailboxId, notes);
  return updatedNote;
}

export function deleteNote(mailboxId: string | undefined, id: string): boolean {
  // Google Keep deletes move to Bin first!
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;

  if (!note.isInBin) {
    note.isInBin = true;
    note.isPinned = false; // unpin when binned
    note.updatedAt = Date.now();
    saveNotes(mailboxId, notes);
    return true;
  } else {
    // Permanent deletion from bin
    return deleteNoteForever(mailboxId, id);
  }
}

export function deleteNoteForever(mailboxId: string | undefined, id: string): boolean {
  const notes = loadNotes(mailboxId);
  const target = notes.find((n) => n.id === id);
  const filtered = notes.filter((n) => n.id !== id);
  if (target) {
    const allMedia = getAllNoteMediaIds(target);
    for (const m of allMedia) {
      if (!isMediaReferencedInNotes(filtered, m)) {
        deleteMediaFromIDB(m);
      }
    }
  }
  if (filtered.length !== notes.length) {
    saveNotes(mailboxId, filtered);
    return true;
  }
  return false;
}

export function restoreNoteFromBin(mailboxId: string | undefined, id: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  note.isInBin = false;
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function emptyBin(mailboxId: string | undefined): number {
  const notes = loadNotes(mailboxId);
  const toDelete = notes.filter((n) => n.isInBin);
  const kept = notes.filter((n) => !n.isInBin);
  for (const n of toDelete) {
    const allMedia = getAllNoteMediaIds(n);
    for (const m of allMedia) {
      if (!isMediaReferencedInNotes(kept, m)) {
        deleteMediaFromIDB(m);
      }
    }
  }
  const count = notes.length - kept.length;
  saveNotes(mailboxId, kept);
  return count;
}

export function archiveNote(mailboxId: string | undefined, id: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  note.isArchived = true;
  note.isPinned = false;
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function unarchiveNote(mailboxId: string | undefined, id: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  note.isArchived = false;
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function togglePinNote(mailboxId: string | undefined, id: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  note.isPinned = !note.isPinned;
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function duplicateNote(mailboxId: string | undefined, id: string): NoteItem | null {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return null;
  if (note._isLocked) {
    console.warn("Cannot duplicate locked encrypted note without decryption key");
    return null;
  }
  const clone: NoteItem = {
    ...note,
    id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    title: note.title ? `${note.title} (Copy)` : "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  delete clone.encryptedPayload;
  delete clone._isLocked;
  delete clone._decrypted;
  const updated = [clone, ...notes];
  saveNotes(mailboxId, updated);
  return clone;
}

export function addNoteImage(mailboxId: string | undefined, id: string, dataUrl: string): boolean {
  saveNoteVersion(mailboxId, id);
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  const storedRef = offloadMediaIfDataUrl(dataUrl, "image");
  note.images = [...(note.images || []), storedRef];
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function removeNoteImage(mailboxId: string | undefined, id: string, index: number): boolean {
  saveNoteVersion(mailboxId, id);
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note || !note.images) return false;
  // Do NOT delete media from IDB here because saveNoteVersion preserves it in version history
  note.images = note.images.filter((_, i) => i !== index);
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function addNoteDrawing(mailboxId: string | undefined, id: string, dataUrl: string): boolean {
  saveNoteVersion(mailboxId, id);
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  const storedRef = offloadMediaIfDataUrl(dataUrl, "drawing");
  note.drawings = [...(note.drawings || []), storedRef];
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function removeNoteDrawing(mailboxId: string | undefined, id: string, index: number): boolean {
  saveNoteVersion(mailboxId, id);
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note || !note.drawings) return false;
  // Do NOT delete media from IDB here because saveNoteVersion preserves it in version history
  note.drawings = note.drawings.filter((_, i) => i !== index);
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function toggleNoteChecklist(mailboxId: string | undefined, id: string): boolean {
  saveNoteVersion(mailboxId, id);
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;

  if (note.isChecklist) {
    // Convert checklist to plaintext
    const lines = (note.checklistItems || []).map((item) => (item.completed ? `✓ ${item.text}` : item.text));
    note.content = lines.join("\n");
    note.isChecklist = false;
    note.checklistItems = [];
  } else {
    // Convert plaintext to checklist
    const lines = (note.content || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    note.checklistItems = lines.map((text, idx) => ({
      id: `item-${Date.now()}-${idx}`,
      text: text.startsWith("✓ ") ? text.replace(/^✓\s*/, "") : text,
      completed: text.startsWith("✓ "),
    }));
    note.isChecklist = true;
  }

  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function saveNoteVersion(mailboxId: string | undefined, id: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;

  const version: NoteVersion = {
    id: `v-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    timestamp: note.updatedAt || Date.now(),
    title: note.title,
    content: note.content,
    isChecklist: note.isChecklist,
    checklistItems: note.checklistItems ? JSON.parse(JSON.stringify(note.checklistItems)) : [],
    images: note.images ? [...note.images] : [],
    drawings: note.drawings ? [...note.drawings] : [],
  };

  const history = note.versionHistory || [];
  // Keep up to 25 historical revisions
  note.versionHistory = [version, ...history].slice(0, 25);
  saveNotes(mailboxId, notes);
  return true;
}

export function restoreNoteVersion(mailboxId: string | undefined, noteId: string, versionId: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === noteId);
  if (!note || !note.versionHistory) return false;

  const ver = note.versionHistory.find((v) => v.id === versionId);
  if (!ver) return false;

  // Snapshot current state before restoring
  const snapshot: NoteVersion = {
    id: "ver-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    timestamp: Date.now(),
    title: note.title,
    content: note.content,
    isChecklist: note.isChecklist,
    checklistItems: note.checklistItems ? JSON.parse(JSON.stringify(note.checklistItems)) : [],
    images: note.images ? [...note.images] : [],
    drawings: note.drawings ? [...note.drawings] : [],
  };
  const history = note.versionHistory || [];
  note.versionHistory = [snapshot, ...history].slice(0, 25);

  note.title = ver.title;
  note.content = ver.content;
  note.isChecklist = ver.isChecklist;
  note.checklistItems = ver.checklistItems ? JSON.parse(JSON.stringify(ver.checklistItems)) : [];
  note.images = ver.images ? [...ver.images] : [];
  note.drawings = ver.drawings ? [...ver.drawings] : [];
  note.updatedAt = Date.now();

  saveNotes(mailboxId, notes);
  return true;
}

export function addNoteCollaborator(mailboxId: string | undefined, id: string, collaborator: string): boolean {
  const trimmed = collaborator.trim();
  if (!trimmed) return false;
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  const collabs = note.collaborators || [];
  if (collabs.includes(trimmed)) return false;
  note.collaborators = [...collabs, trimmed];
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function removeNoteCollaborator(mailboxId: string | undefined, id: string, collaborator: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note || !note.collaborators) return false;
  note.collaborators = note.collaborators.filter((c) => c !== collaborator);
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}
