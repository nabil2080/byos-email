import fs from "fs";
import path from "path";

const root = process.cwd();

// 1. notesStore.ts
const notesStorePath = path.join(root, "apps", "webmail", "src", "components", "notes", "notesStore.ts");
let notesStoreCode = fs.readFileSync(notesStorePath, "utf-8");

notesStoreCode = notesStoreCode.replace(
  `const STORAGE_PREFIX = "byos_notes_";\nconst LABELS_STORAGE_PREFIX = "byos_note_labels_";`,
  `const STORAGE_PREFIX = "byos_notes_";\nconst LABELS_STORAGE_PREFIX = "byos_note_labels_";\nconst LABELS_INITIALIZED_PREFIX = "byos_note_labels_init_";`
);

const oldLoadLabels = `export function loadLabels(mailboxId?: string): string[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return ["Personal", "Work", "Inspiration"];
  }
  try {
    const raw = localStorage.getItem(getLabelsStorageKey(mailboxId));
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Failed to load note labels:", err);
  }
  const defaultLabels = ["Personal", "Work", "Inspiration"];
  saveLabels(mailboxId, defaultLabels);
  return defaultLabels;
}`;

const newLoadLabels = `export function loadLabels(mailboxId?: string): string[] {
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
}`;

const oldSaveLabels = `export function saveLabels(mailboxId: string | undefined, labels: string[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    localStorage.setItem(getLabelsStorageKey(mailboxId), JSON.stringify(labels));
  } catch (err) {
    console.warn("Failed to save note labels:", err);
  }
}`;

const newSaveLabels = `export function saveLabels(mailboxId: string | undefined, labels: string[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const key = getLabelsStorageKey(mailboxId);
  try {
    localStorage.setItem(key, JSON.stringify(labels));
    localStorage.setItem(LABELS_INITIALIZED_PREFIX + key, "true");
  } catch (err) {
    console.warn("Failed to save note labels:", err);
  }
}`;

const oldDeleteLabel = `export function deleteLabel(mailboxId: string | undefined, name: string): boolean {
  const labels = loadLabels(mailboxId);
  const filtered = labels.filter((l) => l.toLowerCase() !== name.toLowerCase());
  if (filtered.length !== labels.length) {
    saveLabels(mailboxId, filtered);

    // Remove label from all notes
    const notes = loadNotes(mailboxId);
    let changed = false;
    for (const n of notes) {
      if (n.labels && n.labels.includes(name)) {
        n.labels = n.labels.filter((l) => l !== name);
        changed = true;
      }
    }
    if (changed) saveNotes(mailboxId, notes);
    return true;
  }
  return false;
}`;

const newDeleteLabel = `export function deleteLabel(mailboxId: string | undefined, name: string): boolean {
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
}`;

notesStoreCode = notesStoreCode.replace(oldLoadLabels, newLoadLabels);
notesStoreCode = notesStoreCode.replace(oldSaveLabels, newSaveLabels);
notesStoreCode = notesStoreCode.replace(oldDeleteLabel, newDeleteLabel);

fs.writeFileSync(notesStorePath, notesStoreCode, "utf-8");
console.log("Updated notesStore.ts successfully.");

// 2. NotesView.tsx
const notesViewPath = path.join(root, "apps", "webmail", "src", "components", "notes", "NotesView.tsx");
let notesViewCode = fs.readFileSync(notesViewPath, "utf-8");

// Add reactive tracking createEffect for props.mailboxId || props.selectedMailbox?.id
notesViewCode = notesViewCode.replace(
  `  onMount(() => {\n    refreshAll();`,
  `  createEffect(() => {\n    // Re-load notes and labels reactively when active mailbox changes\n    const _mb = props.mailboxId || props.selectedMailbox?.id;\n    refreshAll();\n  });\n\n  onMount(() => {\n    refreshAll();`
);

// In EditLabelsModal call, pass mailboxId={props.mailboxId || props.selectedMailbox?.id}
notesViewCode = notesViewCode.replace(
  `mailboxId={props.mailboxId}\n        labels={labels()}`,
  `mailboxId={props.mailboxId || props.selectedMailbox?.id}\n        labels={labels()}`
);

fs.writeFileSync(notesViewPath, notesViewCode, "utf-8");
console.log("Updated NotesView.tsx successfully.");

// 3. CalendarSidebar.tsx
const calSidebarPath = path.join(root, "apps", "webmail", "src", "components", "calendar", "CalendarSidebar.tsx");
let calSidebarCode = fs.readFileSync(calSidebarPath, "utf-8");

const oldCalHeader = `<div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-xl bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30">
              B
            </div>
            <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">
              BYOS Calendar
            </span>
          </div>`;

const newCalHeader = `<div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-gradient-to-br from-[#A27561] to-[#8E6351] flex items-center justify-center text-white font-bold text-xs shadow-xs tracking-wider ring-1 ring-black/5 dark:ring-white/10 select-none">
              B
            </div>
            <div class="flex flex-col">
              <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight leading-tight">BYOS Calendar</span>
              <span class="text-[10px] font-mono text-[#878A8E] tracking-wider uppercase leading-none mt-0.5">Zero-Knowledge</span>
            </div>
          </div>`;

calSidebarCode = calSidebarCode.replace(oldCalHeader, newCalHeader);
fs.writeFileSync(calSidebarPath, calSidebarCode, "utf-8");
console.log("Updated CalendarSidebar.tsx successfully.");

// 4. NotesSidebar.tsx
const notesSidebarPath = path.join(root, "apps", "webmail", "src", "components", "notes", "NotesSidebar.tsx");
let notesSidebarCode = fs.readFileSync(notesSidebarPath, "utf-8");

const oldNotesHeader = `<div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2">
            <div class="w-6 h-6 rounded-xl bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30">
              B
            </div>
            <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">
              BYOS Notes
            </span>
          </div>`;

const newNotesHeader = `<div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <div class="flex items-center gap-2.5">
            <div class="w-7 h-7 rounded-xl bg-gradient-to-br from-[#A27561] to-[#8E6351] flex items-center justify-center text-white font-bold text-xs shadow-xs tracking-wider ring-1 ring-black/5 dark:ring-white/10 select-none">
              B
            </div>
            <div class="flex flex-col">
              <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight leading-tight">BYOS Notes</span>
              <span class="text-[10px] font-mono text-[#878A8E] tracking-wider uppercase leading-none mt-0.5">Zero-Knowledge</span>
            </div>
          </div>`;

notesSidebarCode = notesSidebarCode.replace(oldNotesHeader, newNotesHeader);

// Update nav buttons to include border-l-2 and tabular-nums
notesSidebarCode = notesSidebarCode.replaceAll(
  `isSelected("notes")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"`,
  `isSelected("notes")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs border-l-2 border-l-[#A27561]"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium border-l-2 border-l-transparent"`
);

notesSidebarCode = notesSidebarCode.replaceAll(
  `isSelected("reminders")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"`,
  `isSelected("reminders")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs border-l-2 border-l-[#A27561]"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium border-l-2 border-l-transparent"`
);

notesSidebarCode = notesSidebarCode.replaceAll(
  `isSelected("archive")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"`,
  `isSelected("archive")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs border-l-2 border-l-[#A27561]"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium border-l-2 border-l-transparent"`
);

notesSidebarCode = notesSidebarCode.replaceAll(
  `isSelected("bin")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"`,
  `isSelected("bin")\n              ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs border-l-2 border-l-[#A27561]"\n              : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium border-l-2 border-l-transparent"`
);

notesSidebarCode = notesSidebarCode.replaceAll(
  `isSelected(\`label:\${lbl}\`)\n                  ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs"\n                  : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium"`,
  `isSelected(\`label:\${lbl}\`)\n                  ? "bg-[#F2E8E2] text-[#A27561] dark:bg-[#2D2522] dark:text-[#D4A38F] font-semibold shadow-2xs border-l-2 border-l-[#A27561]"\n                  : "text-[#464748] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] font-medium border-l-2 border-l-transparent"`
);

notesSidebarCode = notesSidebarCode.replaceAll(
  `class={\`text-xs font-mono px-1.5 py-0.2 rounded-full \${`,
  `class={\`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full \${`
);

fs.writeFileSync(notesSidebarPath, notesSidebarCode, "utf-8");
console.log("Updated NotesSidebar.tsx successfully.");

// 5. ReadingPane.tsx
const readingPanePath = path.join(root, "apps", "webmail", "src", "components", "ReadingPane.tsx");
let readingPaneCode = fs.readFileSync(readingPanePath, "utf-8");

readingPaneCode = readingPaneCode.replace(
  `<section data-testid="reading-pane" class="flex-1 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2A2D35] rounded-2xl flex flex-col min-w-0 shadow-2xs overflow-hidden h-full">`,
  `<section data-testid="reading-pane" class="flex-1 bg-white dark:bg-[#18191D] flex flex-col min-w-0 overflow-hidden h-full">`
);

fs.writeFileSync(readingPanePath, readingPaneCode, "utf-8");
console.log("Updated ReadingPane.tsx successfully.");

// 6. App.tsx
const appPath = path.join(root, "apps", "webmail", "src", "App.tsx");
let appCode = fs.readFileSync(appPath, "utf-8");

appCode = appCode.replace(
  `<div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] shadow-2xs overflow-hidden flex min-w-0 h-full">`,
  `<div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] shadow-2xs overflow-hidden flex min-w-0 h-full">`
);

fs.writeFileSync(appPath, appCode, "utf-8");
console.log("Updated App.tsx successfully.");

// 7. MessageRow.tsx
const messageRowPath = path.join(root, "apps", "webmail", "src", "components", "MessageRow.tsx");
let messageRowCode = fs.readFileSync(messageRowPath, "utf-8");

// Unread jewel dot
messageRowCode = messageRowCode.replaceAll(
  `<span\n                class="w-1.5 h-1.5 rounded-full bg-[#A27561] flex-shrink-0"\n                title="Unread"\n              ></span>`,
  `<span\n                class="w-2 h-2 rounded-full bg-[#A27561] shadow-[0_0_6px_rgba(162,117,97,0.5)] ring-2 ring-white dark:ring-[#1E2025] flex-shrink-0"\n                title="Unread"\n              ></span>`
);

messageRowCode = messageRowCode.replaceAll(
  `<span\n                  class="w-1.5 h-1.5 rounded-full bg-[#A27561] flex-shrink-0"\n                  title="Unread"\n                ></span>`,
  `<span\n                  class="w-2 h-2 rounded-full bg-[#A27561] shadow-[0_0_6px_rgba(162,117,97,0.5)] ring-2 ring-white dark:ring-[#1E2025] flex-shrink-0"\n                  title="Unread"\n                ></span>`
);

// Floating hover action pill full mode
messageRowCode = messageRowCode.replace(
  `<div class="absolute right-0 hidden group-hover:flex items-center gap-1 bg-white/95 dark:bg-[#26282E]/95 backdrop-blur-sm px-1.5 py-0.5 rounded-xl border border-[#E2DFD8] dark:border-[#3A3D46] shadow-sm z-10">`,
  `<div class="absolute right-0 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-150 ease-out flex items-center gap-1 bg-white/95 dark:bg-[#202227]/95 backdrop-blur-md px-1.5 py-0.5 rounded-xl border border-[#E2DFD8] dark:border-[#333640] shadow-xs z-10">`
);

// Floating hover action pill split mode
messageRowCode = messageRowCode.replace(
  `<div class="absolute right-0 hidden group-hover:flex items-center gap-0.5 bg-white/95 dark:bg-[#26282E]/95 backdrop-blur-sm px-1 py-0.5 rounded-lg border border-[#E2DFD8] dark:border-[#3A3D46] shadow-sm z-10">`,
  `<div class="absolute right-0 opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 pointer-events-none group-hover:pointer-events-auto transition-all duration-150 ease-out flex items-center gap-0.5 bg-white/95 dark:bg-[#202227]/95 backdrop-blur-md px-1 py-0.5 rounded-lg border border-[#E2DFD8] dark:border-[#333640] shadow-xs z-10">`
);

// Selected row inner highlight
messageRowCode = messageRowCode.replace(
  `props.isSelected\n          ? "bg-[#F3ECE8] dark:bg-[#2D2522] border-l-[3px] border-l-[#A27561]"`,
  `props.isSelected\n          ? "bg-[#F3ECE8] dark:bg-[#2D2522] border-l-[3px] border-l-[#A27561] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"`
);

fs.writeFileSync(messageRowPath, messageRowCode, "utf-8");
console.log("Updated MessageRow.tsx successfully.");
