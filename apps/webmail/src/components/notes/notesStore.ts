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

// ── NOTES STORE ──
export function loadNotes(mailboxId?: string): NoteItem[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(getNotesStorageKey(mailboxId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((n) => ({
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
        }));
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
  saveNotes(mailboxId, defaultNotes);
  return defaultNotes;
}

export function saveNotes(mailboxId: string | undefined, notes: NoteItem[]): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    localStorage.setItem(getNotesStorageKey(mailboxId), JSON.stringify(notes));
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
    images: extra?.images || [],
    drawings: extra?.drawings || [],
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

export function updateNote(
  mailboxId: string | undefined,
  id: string,
  patch: Partial<NoteItem>
): NoteItem | null {
  const notes = loadNotes(mailboxId);
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return null;

  const updatedNote: NoteItem = {
    ...notes[idx],
    ...patch,
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
  const filtered = notes.filter((n) => n.id !== id);
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
  const kept = notes.filter((n) => !n.isInBin);
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
  const clone: NoteItem = {
    ...note,
    id: `note-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    title: note.title ? `${note.title} (Copy)` : "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const updated = [clone, ...notes];
  saveNotes(mailboxId, updated);
  return clone;
}

export function addNoteImage(mailboxId: string | undefined, id: string, dataUrl: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  saveNoteVersion(mailboxId, id);
  note.images = [...(note.images || []), dataUrl];
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function removeNoteImage(mailboxId: string | undefined, id: string, index: number): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note || !note.images) return false;
  saveNoteVersion(mailboxId, id);
  note.images = note.images.filter((_, i) => i !== index);
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function addNoteDrawing(mailboxId: string | undefined, id: string, dataUrl: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  saveNoteVersion(mailboxId, id);
  note.drawings = [...(note.drawings || []), dataUrl];
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function removeNoteDrawing(mailboxId: string | undefined, id: string, index: number): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note || !note.drawings) return false;
  saveNoteVersion(mailboxId, id);
  note.drawings = note.drawings.filter((_, i) => i !== index);
  note.updatedAt = Date.now();
  saveNotes(mailboxId, notes);
  return true;
}

export function toggleNoteChecklist(mailboxId: string | undefined, id: string): boolean {
  const notes = loadNotes(mailboxId);
  const note = notes.find((n) => n.id === id);
  if (!note) return false;
  saveNoteVersion(mailboxId, id);

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

  // Snapshot before restoring
  saveNoteVersion(mailboxId, noteId);

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
