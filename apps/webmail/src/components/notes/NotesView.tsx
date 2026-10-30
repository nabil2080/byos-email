import { Component, createSignal, createMemo, createEffect, Show, For, onMount, onCleanup } from "solid-js";
import { UserMe, Mailbox, ConnectedAccount } from "../../api";
import {
  NoteItem,
  NoteChecklistItem,
  NOTE_COLORS,
  loadNotes,
  saveNotes,
  createNote,
  updateNote,
  deleteNote,
  deleteNoteForever,
  restoreNoteFromBin,
  emptyBin,
  archiveNote,
  unarchiveNote,
  togglePinNote,
  duplicateNote,
  loadLabels,
  addNoteDrawing,
  removeNoteDrawing,
  addNoteImage,
  removeNoteImage,
  toggleNoteChecklist,
  restoreNoteVersion,
  addNoteCollaborator,
  removeNoteCollaborator,
} from "./notesStore";
import { NotesSidebar, NotesViewFilter } from "./NotesSidebar";
import { EditLabelsModal } from "./EditLabelsModal";
import { DrawingModal } from "./DrawingModal";
import { VersionHistoryModal } from "./VersionHistoryModal";
import { TopFixedBar, AppModule } from "../TopFixedBar";

export interface NotesViewProps {
  currentUser?: UserMe | null;
  selectedMailbox?: Mailbox | null;
  connectedAccounts?: ConnectedAccount[];
  activeAccountId?: string;
  onSelectAccount?: (account: ConnectedAccount) => void;
  onSelectAllInboxes?: () => void;
  onOpenAddMailbox?: () => void;
  onLogout?: (accountId?: string, logOutAll?: boolean) => void;
  profilePhotoUrl?: string | null;
  photoUrls?: Record<string, string>;
  isUnlocked?: boolean;
  storageError?: string | null;
  accountUnreadCounts?: Record<string, number>;
  unifiedUnreadCount?: number;
  mailboxId?: string;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  activeModule: AppModule;
  onSwitchModule: (mod: AppModule) => void;
  onOpenContacts: () => void;
  onOpenSettings?: () => void;
  isOnline?: boolean;
  isCustomizerOpen?: boolean;
  onToggleCustomizer?: () => void;
  theme?: string;
  onToggleTheme?: () => void;
}

export const NotesView: Component<NotesViewProps> = (props) => {
  const [notes, setNotes] = createSignal<NoteItem[]>([]);
  const [labels, setLabels] = createSignal<string[]>([]);
  const [activeView, setActiveView] = createSignal<NotesViewFilter>("notes");
  const [isEditLabelsOpen, setIsEditLabelsOpen] = createSignal(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);

  // Modals for Drawing & Version History
  const [isDrawingModalOpen, setIsDrawingModalOpen] = createSignal(false);
  const [drawingTargetNoteId, setDrawingTargetNoteId] = createSignal<string | null>(null); // null means composer

  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = createSignal(false);
  const [versionHistoryTargetNote, setVersionHistoryTargetNote] = createSignal<NoteItem | null>(null);

  // Compose State
  const [isComposing, setIsComposing] = createSignal(false);
  const [newTitle, setNewTitle] = createSignal("");
  const [newContent, setNewContent] = createSignal("");
  const [newIsChecklist, setNewIsChecklist] = createSignal(false);
  const [newChecklistItems, setNewChecklistItems] = createSignal<NoteChecklistItem[]>([]);
  const [newDrawings, setNewDrawings] = createSignal<string[]>([]);
  const [newImages, setNewImages] = createSignal<string[]>([]);
  const [newCollaborators, setNewCollaborators] = createSignal<string[]>([]);
  const [newColor, setNewColor] = createSignal("default");
  const [newIsPinned, setNewIsPinned] = createSignal(false);
  const [newReminder, setNewReminder] = createSignal<number | null>(null);
  const [newSelectedLabels, setNewSelectedLabels] = createSignal<string[]>([]);

  // Composer Popovers
  const [showComposePalette, setShowComposePalette] = createSignal(false);
  const [showComposeReminder, setShowComposeReminder] = createSignal(false);
  const [showComposeCollaborator, setShowComposeCollaborator] = createSignal(false);
  const [showComposeMenu, setShowComposeMenu] = createSignal(false);
  const [showComposeLabelMenu, setShowComposeLabelMenu] = createSignal(false);
  const [showFormattingBar, setShowFormattingBar] = createSignal(false);
  const [collaboratorInput, setCollaboratorInput] = createSignal("");

  // Undo / Redo history for composer
  const [composerHistory, setComposerHistory] = createSignal<Array<{ title: string; content: string }>>([]);
  const [composerHistoryIdx, setComposerHistoryIdx] = createSignal(-1);

  // Hidden file inputs
  let composeImageInputRef: HTMLInputElement | undefined;
  let cardImageInputRef: HTMLInputElement | undefined;
  const [cardUploadTargetId, setCardUploadTargetId] = createSignal<string | null>(null);

  // Edit Modal State
  const [editingNote, setEditingNote] = createSignal<NoteItem | null>(null);
  const [editTitle, setEditTitle] = createSignal("");
  const [editContent, setEditContent] = createSignal("");
  const [editIsChecklist, setEditIsChecklist] = createSignal(false);
  const [editChecklistItems, setEditChecklistItems] = createSignal<NoteChecklistItem[]>([]);
  const [editColor, setEditColor] = createSignal("default");
  const [editIsPinned, setEditIsPinned] = createSignal(false);
  const [editLabels, setEditLabels] = createSignal<string[]>([]);
  const [showEditPalette, setShowEditPalette] = createSignal(false);

  // Popover tracking on cards
  const [activePaletteCardId, setActivePaletteCardId] = createSignal<string | null>(null);
  const [activeReminderCardId, setActiveReminderCardId] = createSignal<string | null>(null);
  const [activeMenuCardId, setActiveMenuCardId] = createSignal<string | null>(null);
  const [activeLabelMenuCardId, setActiveLabelMenuCardId] = createSignal<string | null>(null);
  const [activeCollabCardId, setActiveCollabCardId] = createSignal<string | null>(null);

  createEffect(() => {
    // Re-load notes and labels reactively when active mailbox changes
    const _mb = props.mailboxId || props.selectedMailbox?.id;
    refreshAll();
  });

  onMount(() => {
    refreshAll();

    const handleGlobalClick = (e?: MouseEvent) => {
      const target = e?.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          'button, input, textarea, [data-testid*="palette"], [data-testid*="popover"], [data-testid*="menu"], [data-testid*="modal"]'
        )
      ) {
        return;
      }
      setShowComposePalette(false);
      setShowComposeReminder(false);
      setShowComposeCollaborator(false);
      setShowComposeMenu(false);
      setShowComposeLabelMenu(false);
      setActivePaletteCardId(null);
      setActiveReminderCardId(null);
      setActiveMenuCardId(null);
      setActiveLabelMenuCardId(null);
      setActiveCollabCardId(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleGlobalClick();
      }
    };

    document.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      document.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  function refreshAll() {
    setNotes(loadNotes(props.mailboxId));
    setLabels(loadLabels(props.mailboxId));
  }

  function getColorDef(colorId: string) {
    return NOTE_COLORS.find((c) => c.id === colorId) || NOTE_COLORS[0];
  }

  // Filter notes by sidebar view
  const viewFilteredNotes = createMemo(() => {
    const v = activeView();
    const list = notes();

    if (v === "bin") {
      return list.filter((n) => n.isInBin);
    }
    if (v === "archive") {
      return list.filter((n) => !n.isInBin && n.isArchived);
    }
    if (v === "reminders") {
      return list.filter((n) => !n.isInBin && !n.isArchived && Boolean(n.reminder));
    }
    if (v.startsWith("label:")) {
      const lblName = v.substring(6);
      return list.filter((n) => !n.isInBin && !n.isArchived && n.labels.includes(lblName));
    }
    // "notes" (default active notes)
    return list.filter((n) => !n.isInBin && !n.isArchived);
  });

  // Filter by search query
  const searchFilteredNotes = createMemo(() => {
    const q = (props.searchQuery || "").trim().toLowerCase();
    const list = viewFilteredNotes();
    if (!q) return list;
    return list.filter((n) => {
      const titleMatch = n.title.toLowerCase().includes(q);
      const contentMatch = n.content.toLowerCase().includes(q);
      const labelMatch = n.labels.some((l) => l.toLowerCase().includes(q));
      const checklistMatch = n.checklistItems?.some((item) => item.text.toLowerCase().includes(q));
      return titleMatch || contentMatch || labelMatch || checklistMatch;
    });
  });

  const pinnedNotes = createMemo(() => searchFilteredNotes().filter((n) => n.isPinned));
  const otherNotes = createMemo(() => searchFilteredNotes().filter((n) => !n.isPinned));

  // Counts for sidebar badges
  const notesCounts = createMemo(() => {
    const list = notes();
    const active = list.filter((n) => !n.isInBin && !n.isArchived);
    const reminders = list.filter((n) => !n.isInBin && !n.isArchived && Boolean(n.reminder));
    const archive = list.filter((n) => !n.isInBin && n.isArchived);
    const bin = list.filter((n) => n.isInBin);

    const labelCounts: Record<string, number> = {};
    for (const lbl of labels()) {
      labelCounts[lbl] = list.filter((n) => !n.isInBin && !n.isArchived && n.labels.includes(lbl)).length;
    }

    return {
      notes: active.length,
      reminders: reminders.length,
      archive: archive.length,
      bin: bin.length,
      labelCounts,
    };
  });

  // Compose Actions
  function handleStartCompose(checklist: boolean = false) {
    setIsComposing(true);
    setNewIsChecklist(checklist);
    if (checklist && newChecklistItems().length === 0) {
      setNewChecklistItems([{ id: `item-${Date.now()}`, text: "", completed: false }]);
    }
    // Auto-apply current label if in label view
    if (activeView().startsWith("label:")) {
      const currentLbl = activeView().substring(6);
      setNewSelectedLabels([currentLbl]);
    } else {
      setNewSelectedLabels([]);
    }
    setComposerHistory([{ title: "", content: "" }]);
    setComposerHistoryIdx(0);
  }

  function pushComposerHistory(title: string, content: string) {
    const curIdx = composerHistoryIdx();
    const next = [...composerHistory().slice(0, curIdx + 1), { title, content }];
    setComposerHistory(next.slice(-20));
    setComposerHistoryIdx(next.length - 1);
  }

  function handleUndoComposer() {
    const idx = composerHistoryIdx();
    if (idx > 0) {
      const prev = composerHistory()[idx - 1];
      setNewTitle(prev.title);
      setNewContent(prev.content);
      setComposerHistoryIdx(idx - 1);
    }
  }

  function handleRedoComposer() {
    const idx = composerHistoryIdx();
    if (idx < composerHistory().length - 1) {
      const next = composerHistory()[idx + 1];
      setNewTitle(next.title);
      setNewContent(next.content);
      setComposerHistoryIdx(idx + 1);
    }
  }

  function handleAddChecklistItem() {
    setNewChecklistItems([
      ...newChecklistItems(),
      { id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`, text: "", completed: false },
    ]);
  }

  function handleUpdateChecklistItem(id: string, text: string) {
    setNewChecklistItems(
      newChecklistItems().map((it) => (it.id === id ? { ...it, text } : it))
    );
  }

  function handleToggleNewChecklistItem(id: string) {
    setNewChecklistItems(
      newChecklistItems().map((it) => (it.id === id ? { ...it, completed: !it.completed } : it))
    );
  }

  function handleRemoveChecklistItem(id: string) {
    setNewChecklistItems(newChecklistItems().filter((it) => it.id !== id));
  }

  function handleSaveNewNote() {
    const title = newTitle().trim();
    const content = newContent().trim();
    const items = newChecklistItems().filter((it) => it.text.trim());
    const drawings = newDrawings();
    const images = newImages();

    if (title || content || items.length > 0 || drawings.length > 0 || images.length > 0) {
      createNote(props.mailboxId, title, content, newColor(), newIsPinned(), {
        isChecklist: newIsChecklist(),
        checklistItems: items,
        drawings,
        images,
        collaborators: newCollaborators(),
        labels: newSelectedLabels(),
        reminder: newReminder()
          ? {
              timestamp: newReminder()!,
              label: formatReminderLabel(newReminder()!),
            }
          : null,
      });
      refreshAll();
    }

    // Reset compose
    setNewTitle("");
    setNewContent("");
    setNewIsChecklist(false);
    setNewChecklistItems([]);
    setNewDrawings([]);
    setNewImages([]);
    setNewCollaborators([]);
    setNewColor("default");
    setNewIsPinned(false);
    setNewReminder(null);
    setNewSelectedLabels([]);
    setShowComposePalette(false);
    setShowComposeReminder(false);
    setShowComposeCollaborator(false);
    setShowComposeMenu(false);
    setShowComposeLabelMenu(false);
    setShowFormattingBar(false);
    setIsComposing(false);
  }

  function formatReminderLabel(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return `Today, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    const tomorrow = new Date(now.getTime() + 86400000);
    if (d.toDateString() === tomorrow.toDateString()) {
      return `Tomorrow, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // Image Upload handler
  function handleImageFileSelected(e: Event, targetNoteId: string | null) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (targetNoteId) {
        addNoteImage(props.mailboxId, targetNoteId, dataUrl);
        refreshAll();
      } else {
        setNewImages([...newImages(), dataUrl]);
      }
    };
    reader.readAsDataURL(file);
    input.value = "";
  }

  // Drawing Save handler
  function handleDrawingSaved(dataUrl: string) {
    const noteId = drawingTargetNoteId();
    if (noteId) {
      addNoteDrawing(props.mailboxId, noteId, dataUrl);
      refreshAll();
    } else {
      setNewDrawings([...newDrawings(), dataUrl]);
    }
    setIsDrawingModalOpen(false);
    setDrawingTargetNoteId(null);
  }

  // Card Quick Actions
  function handleTogglePin(id: string, e: MouseEvent) {
    e.stopPropagation();
    togglePinNote(props.mailboxId, id);
    refreshAll();
  }

  function handleArchive(id: string, e: MouseEvent) {
    e.stopPropagation();
    archiveNote(props.mailboxId, id);
    refreshAll();
  }

  function handleUnarchive(id: string, e: MouseEvent) {
    e.stopPropagation();
    unarchiveNote(props.mailboxId, id);
    refreshAll();
  }

  function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    deleteNote(props.mailboxId, id);
    refreshAll();
  }

  function handleRestore(id: string, e: MouseEvent) {
    e.stopPropagation();
    restoreNoteFromBin(props.mailboxId, id);
    refreshAll();
  }

  function handleDeleteForever(id: string, e: MouseEvent) {
    e.stopPropagation();
    deleteNoteForever(props.mailboxId, id);
    refreshAll();
  }

  function handleDuplicate(id: string, e: MouseEvent) {
    e.stopPropagation();
    duplicateNote(props.mailboxId, id);
    refreshAll();
  }

  function handleCardChecklistToggle(note: NoteItem, itemId: string, e: MouseEvent) {
    e.stopPropagation();
    const items = (note.checklistItems || []).map((it) =>
      it.id === itemId ? { ...it, completed: !it.completed } : it
    );
    updateNote(props.mailboxId, note.id, { checklistItems: items });
    refreshAll();
  }

  function handleSetCardColor(id: string, color: string, e: MouseEvent) {
    e.stopPropagation();
    updateNote(props.mailboxId, id, { color });
    refreshAll();
    setActivePaletteCardId(null);
  }

  function handleSetCardReminder(id: string, hoursAhead: number, e: MouseEvent) {
    e.stopPropagation();
    const ts = Date.now() + hoursAhead * 3600000;
    updateNote(props.mailboxId, id, {
      reminder: { timestamp: ts, label: formatReminderLabel(ts) },
    });
    refreshAll();
    setActiveReminderCardId(null);
  }

  function handleRemoveCardReminder(id: string, e: MouseEvent) {
    e.stopPropagation();
    updateNote(props.mailboxId, id, { reminder: null });
    refreshAll();
  }

  function handleToggleCardLabel(id: string, label: string, e: MouseEvent) {
    e.stopPropagation();
    const note = notes().find((n) => n.id === id);
    if (!note) return;
    const current = note.labels || [];
    const updated = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    updateNote(props.mailboxId, id, { labels: updated });
    refreshAll();
  }

  // Edit Modal Actions
  function openEditModal(note: NoteItem) {
    if (note.isInBin) return; // Read-only in bin
    setEditingNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditIsChecklist(Boolean(note.isChecklist));
    setEditChecklistItems(note.checklistItems ? JSON.parse(JSON.stringify(note.checklistItems)) : []);
    setEditColor(note.color || "default");
    setEditIsPinned(note.isPinned);
    setEditLabels(note.labels || []);
    setShowEditPalette(false);
  }

  function handleSaveEdit() {
    const note = editingNote();
    if (!note) return;
    const title = editTitle().trim();
    const content = editContent().trim();
    const items = editChecklistItems().filter((it) => it.text.trim());

    if (!title && !content && items.length === 0 && (!note.drawings || note.drawings.length === 0) && (!note.images || note.images.length === 0)) {
      deleteNote(props.mailboxId, note.id);
    } else {
      updateNote(props.mailboxId, note.id, {
        title,
        content,
        isChecklist: editIsChecklist(),
        checklistItems: items,
        color: editColor(),
        isPinned: editIsPinned(),
        labels: editLabels(),
      });
    }
    refreshAll();
    setEditingNote(null);
  }

  function getViewTitle(): string {
    const v = activeView();
    if (v === "bin") return "Bin";
    if (v === "archive") return "Archive";
    if (v === "reminders") return "Reminders";
    if (v.startsWith("label:")) return v.substring(6);
    return "Notes";
  }

  return (
    <div
      data-testid="notes-view"
      class="flex-1 flex min-w-0 h-full overflow-hidden bg-transparent text-[#1A1B1E] dark:text-[#ECEBE8] select-none gap-2.5 sm:gap-3"
    >
      {/* Hidden File Inputs */}
      <input
        ref={composeImageInputRef}
        type="file"
        accept="image/*"
        class="hidden"
        onChange={(e) => handleImageFileSelected(e, null)}
      />
      <input
        ref={cardImageInputRef}
        type="file"
        accept="image/*"
        class="hidden"
        onChange={(e) => handleImageFileSelected(e, cardUploadTargetId())}
      />

      {/* ── 1. BYOS NOTES SIDEBAR (Matching Sidebar.tsx BYOS Design System) ── */}
      <div class="hidden md:flex flex-shrink-0 h-full">
        <NotesSidebar
          currentUser={props.currentUser}
          selectedMailbox={props.selectedMailbox}
          connectedAccounts={props.connectedAccounts}
          activeAccountId={props.activeAccountId}
          onSelectAccount={props.onSelectAccount}
          onSelectAllInboxes={props.onSelectAllInboxes}
          onOpenAddMailbox={props.onOpenAddMailbox}
          onLogout={props.onLogout}
          profilePhotoUrl={props.profilePhotoUrl}
          photoUrls={props.photoUrls}
          isUnlocked={props.isUnlocked}
          storageError={props.storageError}
          accountUnreadCounts={props.accountUnreadCounts}
          unifiedUnreadCount={props.unifiedUnreadCount}
          activeView={activeView()}
          onSelectView={setActiveView}
          labels={labels()}
          notesCounts={notesCounts()}
          onOpenEditLabels={() => setIsEditLabelsOpen(true)}
          onOpenContacts={props.onOpenContacts}
          onOpenSettings={props.onOpenSettings}
        />
      </div>

      {/* ── Mobile Sidebar Drawer ── */}
      <Show when={mobileSidebarOpen()}>
        <div
          class="fixed inset-0 bg-black/40 z-50 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
        <div class="fixed inset-y-0 left-0 w-64 bg-[#F0EEE9] dark:bg-[#18191D] z-50 md:hidden shadow-xl flex flex-col">
          <NotesSidebar
            currentUser={props.currentUser}
            selectedMailbox={props.selectedMailbox}
            connectedAccounts={props.connectedAccounts}
            activeAccountId={props.activeAccountId}
            onSelectAccount={(acc) => {
              props.onSelectAccount?.(acc);
              setMobileSidebarOpen(false);
            }}
            onSelectAllInboxes={() => {
              props.onSelectAllInboxes?.();
              setMobileSidebarOpen(false);
            }}
            onOpenAddMailbox={() => {
              props.onOpenAddMailbox?.();
              setMobileSidebarOpen(false);
            }}
            onLogout={props.onLogout}
            profilePhotoUrl={props.profilePhotoUrl}
            photoUrls={props.photoUrls}
            isUnlocked={props.isUnlocked}
            storageError={props.storageError}
            accountUnreadCounts={props.accountUnreadCounts}
            unifiedUnreadCount={props.unifiedUnreadCount}
            onCloseMobile={() => setMobileSidebarOpen(false)}
            activeView={activeView()}
            onSelectView={(v) => {
              setActiveView(v);
              setMobileSidebarOpen(false);
            }}
            labels={labels()}
            notesCounts={notesCounts()}
            onOpenEditLabels={() => {
              setMobileSidebarOpen(false);
              setIsEditLabelsOpen(true);
            }}
            onOpenContacts={() => {
              props.onOpenContacts?.();
              setMobileSidebarOpen(false);
            }}
            onOpenSettings={() => {
              props.onOpenSettings?.();
              setMobileSidebarOpen(false);
            }}
          />
        </div>
      </Show>

      {/* ── 2. MAIN WORKSPACE CARD (Matches Email List Section Radius & Card Styling) ── */}
      <div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] shadow-2xs overflow-hidden flex flex-col min-w-0 h-full">
        {/* Top Fixed Bar (Inside Workspace Card, Beside Sidebar) */}
        <TopFixedBar
          activeModule={props.activeModule}
          onSwitchModule={props.onSwitchModule}
          searchQuery={props.searchQuery || ""}
          onSearchChange={props.onSearchChange || (() => {})}
          onOpenContacts={props.onOpenContacts}
          onOpenMobileMenu={() => setMobileSidebarOpen(!mobileSidebarOpen())}
          isOnline={props.isOnline}
          isCustomizerOpen={props.isCustomizerOpen}
          onToggleCustomizer={props.onToggleCustomizer}
          theme={props.theme}
          onToggleTheme={props.onToggleTheme}
        />

        {/* Notes Scrollable Body */}
        <div class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 py-6">
          <div class="max-w-5xl mx-auto">
            {/* ── Bin Notice Banner ── */}
            <Show when={activeView() === "bin"}>
              <div
                data-testid="notes-bin-banner"
                class="mb-6 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs flex items-center justify-between gap-2"
              >
                <span class="text-amber-800 dark:text-amber-300 font-medium">
                  Notes in the Bin are kept safe until permanently cleared.
                </span>
                <Show when={searchFilteredNotes().length > 0}>
                  <button
                    type="button"
                    onClick={() => {
                      emptyBin(props.mailboxId);
                      refreshAll();
                    }}
                    data-testid="empty-bin-btn"
                    class="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer shadow-2xs"
                  >
                    Empty Bin
                  </button>
                </Show>
              </div>
            </Show>

            {/* ── TOP COMPOSE BAR (Only on Notes view) ── */}
            <Show when={activeView() === "notes" && !props.searchQuery}>
              <div class="max-w-2xl mx-auto mb-8">
                <Show
                  when={isComposing()}
                  fallback={
                    /* Collapsed Composer */
                    <div
                      data-testid="notes-compose-collapsed"
                      onClick={() => handleStartCompose(false)}
                      class="w-full h-12 px-4 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E1F23] shadow-xs hover:shadow-md transition-shadow cursor-text flex items-center justify-between text-[#6F7173] dark:text-[#878A8E]"
                    >
                      <span class="text-sm font-medium">Take a note…</span>
                      <div class="flex items-center gap-1">
                        {/* Checklist trigger */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartCompose(true);
                          }}
                          data-testid="compose-new-list-btn"
                          title="New list"
                          class="p-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <polyline points="9 11 12 14 22 4" />
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                          </svg>
                        </button>
                        {/* New Drawing trigger */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartCompose(false);
                            setDrawingTargetNoteId(null);
                            setIsDrawingModalOpen(true);
                          }}
                          data-testid="compose-new-drawing-btn"
                          title="New note with drawing"
                          class="p-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <path d="M12 19l7-7 3 3-7 7-3-3z" />
                            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                          </svg>
                        </button>
                        {/* New Image trigger */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartCompose(false);
                            composeImageInputRef?.click();
                          }}
                          data-testid="compose-new-image-btn"
                          title="New note with image"
                          class="p-2 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#2A2D35] text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  }
                >
                  {/* Expanded Composer (Matching Attachment 4) */}
                  <div
                    data-testid="notes-compose-expanded"
                    class={`w-full rounded-2xl border p-4 shadow-lg transition-colors ${
                      getColorDef(newColor()).lightBg
                    } ${getColorDef(newColor()).darkBg} ${
                      getColorDef(newColor()).borderLight
                    } ${getColorDef(newColor()).borderDark}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Title & Pin row (Attachment 4) */}
                    <div class="flex items-center justify-between gap-2 mb-2">
                      <input
                        type="text"
                        placeholder="Title"
                        value={newTitle()}
                        onInput={(e) => {
                          const val = e.currentTarget.value;
                          setNewTitle(val);
                          pushComposerHistory(val, newContent());
                        }}
                        data-testid="new-note-title-input"
                        class="w-full text-base font-bold bg-transparent outline-none text-[#1A1B1E] dark:text-[#ECEBE8] placeholder-[#878A8E]"
                        autofocus
                      />
                      <button
                        type="button"
                        onClick={() => setNewIsPinned(!newIsPinned())}
                        data-testid="new-note-pin-btn"
                        title={newIsPinned() ? "Unpin note" : "Pin note"}
                        class={`p-1.5 rounded-lg transition cursor-pointer ${
                          newIsPinned()
                            ? "text-[#9E725F] bg-[#9E725F]/15"
                            : "text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        <svg
                          class={`w-4 h-4 ${newIsPinned() ? "fill-current" : "fill-none stroke-current stroke-[2]"}`}
                          viewBox="0 0 24 24"
                        >
                          <path d="M16 3l1 1-2 2 3 3-1 1-3-3-4 4v5l-2-2-1 1-1-1 1-1-2-2h5l4-4-3-3 1-1 3 3 2-2 1 1-2 2z" />
                        </svg>
                      </button>
                    </div>

                    {/* Previews: Attached Drawings */}
                    <Show when={newDrawings().length > 0}>
                      <div class="mb-3 flex flex-wrap gap-2">
                        <For each={newDrawings()}>
                          {(drawing, idx) => (
                            <div class="relative group rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden bg-white">
                              <img src={drawing} alt="Drawing" class="h-24 w-auto object-contain" />
                              <button
                                type="button"
                                onClick={() => setNewDrawings(newDrawings().filter((_, i) => i !== idx()))}
                                class="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-red-600 transition cursor-pointer"
                                title="Remove drawing"
                              >
                                <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    {/* Previews: Attached Images */}
                    <Show when={newImages().length > 0}>
                      <div class="mb-3 flex flex-wrap gap-2">
                        <For each={newImages()}>
                          {(img, idx) => (
                            <div class="relative group rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden bg-black/5">
                              <img src={img} alt="Image attachment" class="h-24 w-auto object-cover" />
                              <button
                                type="button"
                                onClick={() => setNewImages(newImages().filter((_, i) => i !== idx()))}
                                class="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-red-600 transition cursor-pointer"
                                title="Remove image"
                              >
                                <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    {/* Note Content: Checklist vs Plain Text */}
                    <Show
                      when={newIsChecklist()}
                      fallback={
                        <textarea
                          placeholder="Take a note…"
                          value={newContent()}
                          onInput={(e) => {
                            const val = e.currentTarget.value;
                            setNewContent(val);
                            pushComposerHistory(newTitle(), val);
                          }}
                          data-testid="new-note-content-input"
                          class="w-full min-h-[96px] text-sm bg-transparent outline-none resize-none text-[#3C3D3E] dark:text-[#ECEBE8] placeholder-[#878A8E] leading-relaxed"
                          rows={3}
                        />
                      }
                    >
                      {/* Checklist Mode */}
                      <div class="flex flex-col gap-1.5 my-2">
                        <For each={newChecklistItems()}>
                          {(item) => (
                            <div class="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={item.completed}
                                onChange={() => handleToggleNewChecklistItem(item.id)}
                                class="w-4 h-4 rounded text-[#9E725F] cursor-pointer"
                              />
                              <input
                                type="text"
                                placeholder="List item"
                                value={item.text}
                                onInput={(e) => handleUpdateChecklistItem(item.id, e.currentTarget.value)}
                                class={`flex-1 text-sm bg-transparent outline-none ${
                                  item.completed ? "line-through text-[#878A8E]" : "text-[#1A1B1E] dark:text-[#ECEBE8]"
                                }`}
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveChecklistItem(item.id)}
                                class="p-1 text-[#878A8E] hover:text-red-500 cursor-pointer"
                              >
                                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </For>
                        <button
                          type="button"
                          onClick={handleAddChecklistItem}
                          class="flex items-center gap-2 text-xs text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#ECEBE8] font-medium py-1 cursor-pointer"
                        >
                          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                          </svg>
                          <span>List item</span>
                        </button>
                      </div>
                    </Show>

                    {/* Previews: Collaborators & Labels & Reminders */}
                    <div class="flex flex-wrap gap-1.5 mb-2">
                      <Show when={newReminder()}>
                        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F]">
                          <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                          </svg>
                          <span>{formatReminderLabel(newReminder()!)}</span>
                          <button
                            type="button"
                            onClick={() => setNewReminder(null)}
                            class="hover:text-red-500 cursor-pointer ml-0.5"
                          >
                            ×
                          </button>
                        </span>
                      </Show>

                      <For each={newCollaborators()}>
                        {(collab) => (
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-black/5 dark:bg-white/10 text-[#3C3D3E] dark:text-[#ECEBE8]">
                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            <span>{collab}</span>
                            <button
                              type="button"
                              onClick={() => setNewCollaborators(newCollaborators().filter((c) => c !== collab))}
                              class="hover:text-red-500 cursor-pointer"
                            >
                              ×
                            </button>
                          </span>
                        )}
                      </For>

                      <For each={newSelectedLabels()}>
                        {(lbl) => (
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-black/5 dark:bg-white/10 text-[#3C3D3E] dark:text-[#ECEBE8]">
                            <span>{lbl}</span>
                            <button
                              type="button"
                              onClick={() => setNewSelectedLabels(newSelectedLabels().filter((l) => l !== lbl))}
                              class="hover:text-red-500 cursor-pointer"
                            >
                              ×
                            </button>
                          </span>
                        )}
                      </For>
                    </div>

                    {/* Formatting Bar (Toggleable via 'A' button) */}
                    <Show when={showFormattingBar()}>
                      <div class="flex items-center gap-1 py-1.5 px-2 mb-2 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs">
                        <button
                          type="button"
                          onClick={() => setNewContent((c) => `**${c || "bold text"}**`)}
                          class="px-2 py-0.5 rounded hover:bg-black/10 font-bold"
                          title="Bold"
                        >
                          B
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewContent((c) => `*${c || "italic text"}*`)}
                          class="px-2 py-0.5 rounded hover:bg-black/10 italic"
                          title="Italic"
                        >
                          I
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewContent((c) => `<u>${c || "underlined"}</u>`)}
                          class="px-2 py-0.5 rounded hover:bg-black/10 underline"
                          title="Underline"
                        >
                          U
                        </button>
                        <div class="h-3 w-px bg-black/10 dark:bg-white/10 mx-1" />
                        <button
                          type="button"
                          onClick={() => setNewContent((c) => (c ? c.split("\n").map((l) => `• ${l}`).join("\n") : "• List item"))}
                          class="px-2 py-0.5 rounded hover:bg-black/10"
                          title="Bullet list"
                        >
                          • List
                        </button>
                      </div>
                    </Show>

                    {/* ── BOTTOM TOOLBAR (Matches Attachment 4) ── */}
                    {/* A, Palette, Reminder, Collaborator, Image, Three-Dot, Undo, Redo, Close */}
                    <div class="flex items-center justify-between pt-2 border-t border-black/5 dark:border-white/5 relative">
                      <div class="flex items-center gap-0.5 sm:gap-1 text-[#6F7173] dark:text-[#878A8E]">
                        {/* 1. Formatting Button 'A' */}
                        <button
                          type="button"
                          onClick={() => setShowFormattingBar(!showFormattingBar())}
                          data-testid="compose-formatting-btn"
                          title="Formatting options"
                          class={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs transition cursor-pointer ${
                            showFormattingBar() ? "bg-black/10 text-[#1A1B1E] dark:text-white" : "hover:bg-black/5 dark:hover:bg-white/5"
                          }`}
                        >
                          <span class="underline">A</span>
                        </button>

                        {/* 2. Palette Button 🎨 */}
                        <div class="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowComposePalette(!showComposePalette());
                            }}
                            data-testid="new-note-color-palette-btn"
                            title="Background options"
                            class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="10" />
                              <circle cx="12" cy="7" r="1.5" />
                              <circle cx="16.5" cy="10.5" r="1.5" />
                              <circle cx="16.5" cy="15.5" r="1.5" />
                              <circle cx="7.5" cy="10.5" r="1.5" />
                              <circle cx="7.5" cy="15.5" r="1.5" />
                            </svg>
                          </button>

                          <Show when={showComposePalette()}>
                            <div
                              data-testid="compose-palette-popover"
                              class="absolute left-0 bottom-full mb-2 p-1.5 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg flex items-center gap-1.5 z-30"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <For each={NOTE_COLORS}>
                                {(color) => (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewColor(color.id);
                                      setShowComposePalette(false);
                                    }}
                                    title={color.name}
                                    class={`w-6 h-6 rounded-full border transition-transform hover:scale-110 cursor-pointer ${
                                      color.swatchClass
                                    } ${newColor() === color.id ? "ring-2 ring-[#9E725F]" : ""}`}
                                  />
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>

                        {/* 3. Reminder Button 🔔 */}
                        <div class="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowComposeReminder(!showComposeReminder());
                            }}
                            data-testid="new-note-reminder-btn"
                            title="Remind me"
                            class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                          </button>

                          <Show when={showComposeReminder()}>
                            <div
                              class="absolute left-0 bottom-full mb-2 w-44 p-1.5 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xl flex flex-col gap-1 z-30 text-xs"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setNewReminder(Date.now() + 4 * 3600000);
                                  setShowComposeReminder(false);
                                }}
                                class="px-2.5 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                              >
                                Later today (4 hours)
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewReminder(Date.now() + 24 * 3600000);
                                  setShowComposeReminder(false);
                                }}
                                class="px-2.5 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                              >
                                Tomorrow morning
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewReminder(Date.now() + 168 * 3600000);
                                  setShowComposeReminder(false);
                                }}
                                class="px-2.5 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                              >
                                Next week
                              </button>
                            </div>
                          </Show>
                        </div>

                        {/* 4. Collaborator Button 👤+ */}
                        <div class="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowComposeCollaborator(!showComposeCollaborator());
                            }}
                            data-testid="new-note-collaborator-btn"
                            title="Add collaborator"
                            class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="8.5" cy="7" r="4" />
                              <line x1="20" y1="8" x2="20" y2="14" />
                              <line x1="23" y1="11" x2="17" y2="11" />
                            </svg>
                          </button>

                          <Show when={showComposeCollaborator()}>
                            <div
                              class="absolute left-0 bottom-full mb-2 w-64 p-3 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xl flex flex-col gap-2 z-30 text-xs"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span class="font-semibold text-[#1A1B1E] dark:text-[#ECEBE8]">Add Collaborator</span>
                              <div class="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  placeholder="Person or email…"
                                  value={collaboratorInput()}
                                  onInput={(e) => setCollaboratorInput(e.currentTarget.value)}
                                  class="flex-1 px-2.5 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] text-xs outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const val = collaboratorInput().trim();
                                    if (val && !newCollaborators().includes(val)) {
                                      setNewCollaborators([...newCollaborators(), val]);
                                      setCollaboratorInput("");
                                      setShowComposeCollaborator(false);
                                    }
                                  }}
                                  class="px-2.5 py-1 rounded-lg bg-[#9E725F] text-white font-semibold cursor-pointer text-xs"
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                          </Show>
                        </div>

                        {/* 5. Image Attachment Button 🖼️ */}
                        <button
                          type="button"
                          onClick={() => composeImageInputRef?.click()}
                          data-testid="new-note-image-btn"
                          title="Add image"
                          class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <polyline points="21 15 16 10 5 21" />
                          </svg>
                        </button>

                        {/* 6. Three-Dot Button ⋮ (Attachment 5 Options) */}
                        <div class="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowComposeMenu(!showComposeMenu());
                            }}
                            data-testid="new-note-more-menu-btn"
                            title="More options"
                            class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <circle cx="12" cy="12" r="1" />
                              <circle cx="12" cy="5" r="1" />
                              <circle cx="12" cy="19" r="1" />
                            </svg>
                          </button>

                          <Show when={showComposeMenu()}>
                            <div
                              data-testid="compose-more-menu-popover"
                              class="absolute left-0 bottom-full mb-2 w-48 p-1.5 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xl flex flex-col gap-0.5 z-30 text-xs"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {/* 1. Add label */}
                              <div class="relative">
                                <button
                                  type="button"
                                  onClick={() => setShowComposeLabelMenu(!showComposeLabelMenu())}
                                  data-testid="menu-add-label-btn"
                                  class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between cursor-pointer font-medium"
                                >
                                  <span>Add label</span>
                                  <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                    <polyline points="9 18 15 12 9 6" />
                                  </svg>
                                </button>
                                <Show when={showComposeLabelMenu()}>
                                  <div class="p-2 border-t border-black/5 dark:border-white/5 max-h-32 overflow-y-auto space-y-1">
                                    <For each={labels()}>
                                      {(lbl) => (
                                        <label class="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-black/5 cursor-pointer text-[11px]">
                                          <input
                                            type="checkbox"
                                            checked={newSelectedLabels().includes(lbl)}
                                            onChange={() => {
                                              if (newSelectedLabels().includes(lbl)) {
                                                setNewSelectedLabels(newSelectedLabels().filter((l) => l !== lbl));
                                              } else {
                                                setNewSelectedLabels([...newSelectedLabels(), lbl]);
                                              }
                                            }}
                                            class="w-3.5 h-3.5 rounded text-[#9E725F]"
                                          />
                                          <span class="truncate">{lbl}</span>
                                        </label>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>

                              {/* 2. Add drawing */}
                              <button
                                type="button"
                                onClick={() => {
                                  setShowComposeMenu(false);
                                  setDrawingTargetNoteId(null);
                                  setIsDrawingModalOpen(true);
                                }}
                                data-testid="menu-add-drawing-btn"
                                class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                              >
                                Add drawing
                              </button>

                              {/* 3. Make a copy */}
                              <button
                                type="button"
                                onClick={() => {
                                  setShowComposeMenu(false);
                                  handleSaveNewNote();
                                }}
                                data-testid="menu-make-copy-btn"
                                class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                              >
                                Make a copy
                              </button>

                              {/* 4. Show / Hide tick boxes */}
                              <button
                                type="button"
                                onClick={() => {
                                  setShowComposeMenu(false);
                                  const next = !newIsChecklist();
                                  setNewIsChecklist(next);
                                  if (next && newChecklistItems().length === 0) {
                                    setNewChecklistItems([{ id: `item-${Date.now()}`, text: "", completed: false }]);
                                  }
                                }}
                                data-testid="menu-toggle-tickboxes-btn"
                                class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                              >
                                {newIsChecklist() ? "Hide tick boxes" : "Show tick boxes"}
                              </button>

                              {/* 5. Version history */}
                              <button
                                type="button"
                                onClick={() => {
                                  setShowComposeMenu(false);
                                  setVersionHistoryTargetNote(null);
                                  setIsVersionHistoryOpen(true);
                                }}
                                data-testid="menu-version-history-btn"
                                class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                              >
                                Version history
                              </button>

                              {/* Divider Line (Attachment 5) */}
                              <div class="h-px bg-[#E2DFD8] dark:bg-[#2E3138] my-1" />

                              {/* 6. Delete note */}
                              <button
                                type="button"
                                onClick={() => {
                                  setShowComposeMenu(false);
                                  setIsComposing(false);
                                  setNewTitle("");
                                  setNewContent("");
                                  setNewDrawings([]);
                                  setNewImages([]);
                                }}
                                data-testid="menu-delete-note-btn"
                                class="w-full px-3 py-1.5 text-left rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 cursor-pointer font-medium"
                              >
                                Delete note
                              </button>
                            </div>
                          </Show>
                        </div>

                        {/* 7. Undo ↶ */}
                        <button
                          type="button"
                          onClick={handleUndoComposer}
                          data-testid="compose-undo-btn"
                          title="Undo"
                          class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <path d="M3 7v6h6" />
                            <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                          </svg>
                        </button>

                        {/* 8. Redo ↷ */}
                        <button
                          type="button"
                          onClick={handleRedoComposer}
                          data-testid="compose-redo-btn"
                          title="Redo"
                          class="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <path d="M21 7v6h-6" />
                            <path d="M3 17a9 9 0 019-9 9 9 0 016 2.3L21 13" />
                          </svg>
                        </button>
                      </div>

                      {/* Close / Save Button on the right */}
                      <button
                        type="button"
                        onClick={handleSaveNewNote}
                        data-testid="new-note-save-btn"
                        class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#9E725F] text-white hover:bg-[#8B6453] transition shadow-2xs cursor-pointer"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            {/* ── Active Search / View Header ── */}
            <Show when={props.searchQuery || activeView() !== "notes"}>
              <div class="mb-4 flex items-center justify-between px-2 text-xs text-[#6F7173] dark:text-[#878A8E]">
                <span class="font-medium">
                  {props.searchQuery ? (
                    <>Search results for "<strong>{props.searchQuery}</strong>"</>
                  ) : (
                    <span class="text-sm font-bold text-[#1A1B1E] dark:text-[#ECEBE8]">{getViewTitle()}</span>
                  )}
                  {" "}({searchFilteredNotes().length} notes)
                </span>
              </div>
            </Show>

            {/* ── EMPTY STATE ── */}
            <Show when={searchFilteredNotes().length === 0}>
              <div
                data-testid="notes-empty-state"
                class="flex flex-col items-center justify-center py-20 text-center"
              >
                <div class="w-16 h-16 rounded-full bg-[#E2DFD8]/40 dark:bg-[#2A2D35]/50 flex items-center justify-center text-[#878A8E] mb-4">
                  <svg class="w-8 h-8 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <path d="M9 18h6" />
                    <path d="M10 22h4" />
                    <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z" />
                  </svg>
                </div>
                <h3 class="text-base font-semibold text-[#1A1B1E] dark:text-[#ECEBE8] mb-1">
                  {props.searchQuery
                    ? "No matching notes found"
                    : activeView() === "bin"
                    ? "No notes in Bin"
                    : activeView() === "archive"
                    ? "Your archived notes appear here"
                    : activeView() === "reminders"
                    ? "Notes with upcoming reminders appear here"
                    : "Notes you add appear here"}
                </h3>
                <p class="text-xs text-[#6F7173] dark:text-[#878A8E] max-w-sm">
                  {props.searchQuery
                    ? "Try searching for different keywords or clear the search filter."
                    : activeView() === "bin"
                    ? "Deleted notes stay in the bin until emptied."
                    : "Capture ideas, checklists, drawings, and daily reminders with encrypted privacy."}
                </p>
              </div>
            </Show>

            {/* ── PINNED NOTES SECTION ── */}
            <Show when={pinnedNotes().length > 0}>
              <div class="mb-8" data-testid="notes-pinned-section">
                <h4 class="text-[11px] font-bold tracking-wider uppercase text-[#6F7173] dark:text-[#878A8E] px-2 mb-3">
                  PINNED
                </h4>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <For each={pinnedNotes()}>{(note) => renderNoteCard(note)}</For>
                </div>
              </div>
            </Show>

            {/* ── OTHERS / ALL NOTES SECTION ── */}
            <Show when={otherNotes().length > 0}>
              <div data-testid="notes-others-section">
                <Show when={pinnedNotes().length > 0}>
                  <h4 class="text-[11px] font-bold tracking-wider uppercase text-[#6F7173] dark:text-[#878A8E] px-2 mb-3">
                    OTHERS
                  </h4>
                </Show>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  <For each={otherNotes()}>{(note) => renderNoteCard(note)}</For>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* ── EDIT LABELS MODAL ── */}
      <EditLabelsModal
        mailboxId={props.mailboxId || props.selectedMailbox?.id}
        labels={labels()}
        isOpen={isEditLabelsOpen()}
        onClose={() => setIsEditLabelsOpen(false)}
        onLabelsChange={refreshAll}
      />

      {/* ── DRAWING MODAL ── */}
      <DrawingModal
        isOpen={isDrawingModalOpen()}
        onClose={() => {
          setIsDrawingModalOpen(false);
          setDrawingTargetNoteId(null);
        }}
        onSave={handleDrawingSaved}
      />

      {/* ── VERSION HISTORY MODAL ── */}
      <VersionHistoryModal
        isOpen={isVersionHistoryOpen()}
        note={versionHistoryTargetNote()}
        onClose={() => {
          setIsVersionHistoryOpen(false);
          setVersionHistoryTargetNote(null);
        }}
        onRestoreVersion={(verId) => {
          const note = versionHistoryTargetNote();
          if (note) {
            restoreNoteVersion(props.mailboxId, note.id, verId);
            refreshAll();
          }
        }}
      />

      {/* ── FULL EDIT NOTE MODAL ── */}
      <Show when={editingNote()}>
        <div
          class="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
          onClick={handleSaveEdit}
          data-testid="edit-note-modal-backdrop"
        >
          <div
            class={`w-full max-w-lg rounded-2xl border p-5 shadow-2xl transition-all ${
              getColorDef(editColor()).lightBg
            } ${getColorDef(editColor()).darkBg} ${
              getColorDef(editColor()).borderLight
            } ${getColorDef(editColor()).borderDark}`}
            onClick={(e) => e.stopPropagation()}
            data-testid="edit-note-modal"
          >
            {/* Title & Pin row */}
            <div class="flex items-center justify-between gap-2 mb-3">
              <input
                type="text"
                placeholder="Title"
                value={editTitle()}
                onInput={(e) => setEditTitle(e.currentTarget.value)}
                data-testid="edit-note-title-input"
                class="w-full text-base font-bold bg-transparent outline-none text-[#1A1B1E] dark:text-[#ECEBE8] placeholder-[#878A8E]"
              />
              <button
                type="button"
                onClick={() => setEditIsPinned(!editIsPinned())}
                data-testid="edit-note-pin-btn"
                title={editIsPinned() ? "Unpin note" : "Pin note"}
                class={`p-1.5 rounded-lg transition cursor-pointer ${
                  editIsPinned()
                    ? "text-[#9E725F] bg-[#9E725F]/15"
                    : "text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <svg
                  class={`w-4 h-4 ${editIsPinned() ? "fill-current" : "fill-none stroke-current stroke-[2]"}`}
                  viewBox="0 0 24 24"
                >
                  <path d="M16 3l1 1-2 2 3 3-1 1-3-3-4 4v5l-2-2-1 1-1-1 1-1-2-2h5l4-4-3-3 1-1 3 3 2-2 1 1-2 2z" />
                </svg>
              </button>
            </div>

            {/* Previews: Attached Drawings */}
            <Show when={(editingNote()?.drawings || []).length > 0}>
              <div class="mb-3 flex flex-wrap gap-2">
                <For each={editingNote()!.drawings!}>
                  {(drawing, idx) => (
                    <div class="relative group rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden bg-white">
                      <img src={drawing} alt="Drawing" class="h-24 w-auto object-contain" />
                      <button
                        type="button"
                        onClick={() => {
                          removeNoteDrawing(props.mailboxId, editingNote()!.id, idx());
                          refreshAll();
                          setEditingNote(notes().find((n) => n.id === editingNote()!.id) || null);
                        }}
                        class="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-red-600 transition cursor-pointer"
                        title="Remove drawing"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Previews: Attached Images */}
            <Show when={(editingNote()?.images || []).length > 0}>
              <div class="mb-3 flex flex-wrap gap-2">
                <For each={editingNote()!.images!}>
                  {(img, idx) => (
                    <div class="relative group rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] overflow-hidden bg-black/5">
                      <img src={img} alt="Attachment" class="h-24 w-auto object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          removeNoteImage(props.mailboxId, editingNote()!.id, idx());
                          refreshAll();
                          setEditingNote(notes().find((n) => n.id === editingNote()!.id) || null);
                        }}
                        class="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-red-600 transition cursor-pointer"
                        title="Remove image"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Content: Checklist vs Plain Text */}
            <Show
              when={editIsChecklist()}
              fallback={
                <textarea
                  placeholder="Note"
                  value={editContent()}
                  onInput={(e) => setEditContent(e.currentTarget.value)}
                  data-testid="edit-note-content-input"
                  class="w-full min-h-[140px] text-sm bg-transparent outline-none resize-none text-[#3C3D3E] dark:text-[#ECEBE8] placeholder-[#878A8E] leading-relaxed mb-4"
                  rows={5}
                />
              }
            >
              <div class="flex flex-col gap-2 my-2 max-h-72 overflow-y-auto">
                <For each={editChecklistItems()}>
                  {(item) => (
                    <div class="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => {
                          setEditChecklistItems(
                            editChecklistItems().map((it) =>
                              it.id === item.id ? { ...it, completed: !it.completed } : it
                            )
                          );
                        }}
                        class="w-4 h-4 rounded text-[#9E725F] cursor-pointer"
                      />
                      <input
                        type="text"
                        value={item.text}
                        onInput={(e) => {
                          const val = e.currentTarget.value;
                          setEditChecklistItems(
                            editChecklistItems().map((it) => (it.id === item.id ? { ...it, text: val } : it))
                          );
                        }}
                        class={`flex-1 text-sm bg-transparent outline-none ${
                          item.completed ? "line-through text-[#878A8E]" : "text-[#1A1B1E] dark:text-[#ECEBE8]"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setEditChecklistItems(editChecklistItems().filter((it) => it.id !== item.id));
                        }}
                        class="p-1 text-[#878A8E] hover:text-red-500 cursor-pointer"
                      >
                        <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
                <button
                  type="button"
                  onClick={() => {
                    setEditChecklistItems([
                      ...editChecklistItems(),
                      { id: `item-${Date.now()}`, text: "", completed: false },
                    ]);
                  }}
                  class="flex items-center gap-2 text-xs text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#ECEBE8] font-medium py-1 cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>List item</span>
                </button>
              </div>
            </Show>

            {/* Bottom Actions */}
            <div class="flex items-center justify-between pt-3 border-t border-black/5 dark:border-white/5 relative">
              <div class="flex items-center gap-1">
                {/* Palette button */}
                <div class="relative">
                  <button
                    type="button"
                    onClick={() => setShowEditPalette(!showEditPalette())}
                    data-testid="edit-note-color-palette-btn"
                    title="Background color"
                    class="p-1.5 rounded-lg text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  >
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="7" r="1.5" />
                      <circle cx="16.5" cy="10.5" r="1.5" />
                      <circle cx="16.5" cy="15.5" r="1.5" />
                      <circle cx="7.5" cy="10.5" r="1.5" />
                      <circle cx="7.5" cy="15.5" r="1.5" />
                    </svg>
                  </button>

                  <Show when={showEditPalette()}>
                    <div class="absolute left-0 bottom-full mb-2 p-1.5 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg flex items-center gap-1.5 z-30">
                      <For each={NOTE_COLORS}>
                        {(color) => (
                          <button
                            type="button"
                            onClick={() => {
                              setEditColor(color.id);
                              setShowEditPalette(false);
                            }}
                            title={color.name}
                            class={`w-6 h-6 rounded-full border transition-transform hover:scale-110 cursor-pointer ${
                              color.swatchClass
                            } ${editColor() === color.id ? "ring-2 ring-[#9E725F]" : ""}`}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </div>

                {/* Add Drawing */}
                <button
                  type="button"
                  onClick={() => {
                    if (editingNote()) {
                      setDrawingTargetNoteId(editingNote()!.id);
                      setIsDrawingModalOpen(true);
                    }
                  }}
                  data-testid="edit-note-add-drawing-btn"
                  title="Add drawing"
                  class="p-1.5 rounded-lg text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <path d="M12 19l7-7 3 3-7 7-3-3z" />
                    <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                  </svg>
                </button>

                {/* Add Image */}
                <button
                  type="button"
                  onClick={() => {
                    if (editingNote()) {
                      setCardUploadTargetId(editingNote()!.id);
                      cardImageInputRef?.click();
                    }
                  }}
                  data-testid="edit-note-add-image-btn"
                  title="Add image"
                  class="p-1.5 rounded-lg text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                </button>

                {/* Version History */}
                <button
                  type="button"
                  onClick={() => {
                    if (editingNote()) {
                      setVersionHistoryTargetNote(editingNote()!);
                      setIsVersionHistoryOpen(true);
                    }
                  }}
                  data-testid="edit-note-version-history-btn"
                  title="Version history"
                  class="p-1.5 rounded-lg text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 14 14" />
                  </svg>
                </button>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={(e) => editingNote() && handleDelete(editingNote()!.id, e)}
                  data-testid="edit-note-delete-btn"
                  title="Delete note"
                  class="p-1.5 rounded-lg text-[#6F7173] hover:text-red-600 dark:text-[#878A8E] dark:hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>

              {/* Close / Save Button */}
              <button
                type="button"
                onClick={handleSaveEdit}
                data-testid="edit-note-save-btn"
                class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#9E725F] text-white hover:bg-[#8B6453] transition shadow-2xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );

  // ── RENDER NOTE CARD COMPONENT ──
  function renderNoteCard(note: NoteItem) {
    return (
      <div
        data-testid={`note-card-${note.id}`}
        onClick={() => openEditModal(note)}
        class={`group relative rounded-xl border p-4 shadow-2xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between ${
          getColorDef(note.color).lightBg
        } ${getColorDef(note.color).darkBg} ${getColorDef(note.color).borderLight} ${
          getColorDef(note.color).borderDark
        }`}
      >
        <div>
          {/* Title & Pin row */}
          <div class="flex items-start justify-between gap-2 mb-2">
            <Show when={note.title}>
              <h4 class="font-bold text-sm text-[#1A1B1E] dark:text-[#ECEBE8] leading-snug line-clamp-2">
                {note.title}
              </h4>
            </Show>
            <Show when={!note.isInBin}>
              <button
                type="button"
                onClick={(e) => handleTogglePin(note.id, e)}
                data-testid={`note-pin-btn-${note.id}`}
                title={note.isPinned ? "Unpin note" : "Pin note"}
                class={`p-1 rounded transition cursor-pointer flex-shrink-0 ${
                  note.isPinned
                    ? "text-[#9E725F] hover:bg-black/5"
                    : "text-[#6F7173] dark:text-[#878A8E] opacity-90 sm:opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <svg
                  class={`w-4 h-4 ${note.isPinned ? "fill-current" : "fill-none stroke-current stroke-[2]"}`}
                  viewBox="0 0 24 24"
                >
                  <path d="M16 3l1 1-2 2 3 3-1 1-3-3-4 4v5l-2-2-1 1-1-1 1-1-2-2h5l4-4-3-3 1-1 3 3 2-2 1 1-2 2z" />
                </svg>
              </button>
            </Show>
          </div>

          {/* Attached Drawings Gallery */}
          <Show when={note.drawings && note.drawings.length > 0}>
            <div class="mb-2 flex flex-wrap gap-1.5">
              <For each={note.drawings}>
                {(drawing) => (
                  <div class="rounded-lg border border-black/10 overflow-hidden bg-white">
                    <img src={drawing} alt="Drawing preview" class="h-16 w-auto object-contain" />
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Attached Images Gallery */}
          <Show when={note.images && note.images.length > 0}>
            <div class="mb-2 flex flex-wrap gap-1.5">
              <For each={note.images}>
                {(img) => (
                  <div class="rounded-lg border border-black/10 overflow-hidden bg-black/5">
                    <img src={img} alt="Image preview" class="h-16 w-auto object-cover" />
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Content: Checklist vs Plain Text */}
          <Show
            when={note.isChecklist && note.checklistItems && note.checklistItems.length > 0}
            fallback={
              <p class="text-xs text-[#3C3D3E] dark:text-[#ECEBE8] whitespace-pre-wrap leading-relaxed line-clamp-6">
                {note.content}
              </p>
            }
          >
            <div class="flex flex-col gap-1.5 my-1">
              <For each={note.checklistItems!.slice(0, 6)}>
                {(item) => (
                  <div
                    class="flex items-center gap-2 text-xs"
                    onClick={(e) => handleCardChecklistToggle(note, item.id, e)}
                  >
                    <input
                      type="checkbox"
                      checked={item.completed}
                      readOnly
                      class="w-3.5 h-3.5 rounded text-[#9E725F] pointer-events-none"
                    />
                    <span
                      class={`truncate ${
                        item.completed ? "line-through text-[#878A8E]" : "text-[#1A1B1E] dark:text-[#ECEBE8]"
                      }`}
                    >
                      {item.text}
                    </span>
                  </div>
                )}
              </For>
              <Show when={(note.checklistItems?.length || 0) > 6}>
                <span class="text-[11px] text-[#878A8E] font-medium">+{(note.checklistItems?.length || 0) - 6} more items</span>
              </Show>
            </div>
          </Show>

          {/* Reminder Badge */}
          <Show when={note.reminder}>
            <div class="mt-2.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-black/5 dark:bg-white/10 text-[#6F7173] dark:text-[#878A8E]">
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span>{note.reminder!.label || "Reminder"}</span>
              <button
                type="button"
                onClick={(e) => handleRemoveCardReminder(note.id, e)}
                class="hover:text-red-500 cursor-pointer ml-0.5"
                title="Delete reminder"
              >
                ×
              </button>
            </div>
          </Show>

          {/* Collaborator Badges */}
          <Show when={note.collaborators && note.collaborators.length > 0}>
            <div class="mt-2 flex flex-wrap gap-1">
              <For each={note.collaborators}>
                {(collab) => (
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 dark:bg-white/10 text-[#6F7173] dark:text-[#878A8E]">
                    <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <span>{collab}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeNoteCollaborator(props.mailboxId, note.id, collab);
                        refreshAll();
                      }}
                      class="hover:text-red-500 cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                )}
              </For>
            </div>
          </Show>

          {/* Labels Badges */}
          <Show when={note.labels && note.labels.length > 0}>
            <div class="mt-2 flex flex-wrap gap-1">
              <For each={note.labels}>
                {(lbl) => (
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-black/5 dark:bg-white/10 text-[#6F7173] dark:text-[#878A8E]">
                    <span>{lbl}</span>
                    <button
                      type="button"
                      onClick={(e) => handleToggleCardLabel(note.id, lbl, e)}
                      class="hover:text-red-500 cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Card Footer / Hover actions */}
        <div class="mt-4 pt-2 flex items-center justify-between text-[11px] text-[#878A8E]">
          <span>
            {new Date(note.updatedAt || note.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>

          {/* Actions toolbar on card hover */}
          <div class="flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
            <Show
              when={note.isInBin}
              fallback={
                <>
                  {/* Reminder button */}
                  <div class="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveReminderCardId(activeReminderCardId() === note.id ? null : note.id);
                      }}
                      data-testid={`note-reminder-btn-${note.id}`}
                      title="Remind me"
                      class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </button>

                    <Show when={activeReminderCardId() === note.id}>
                      <div
                        class="absolute left-0 bottom-full mb-1 w-36 p-1.5 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg flex flex-col gap-1 z-30 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={(e) => handleSetCardReminder(note.id, 4, e)}
                          class="px-2 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                        >
                          Later today (4h)
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleSetCardReminder(note.id, 24, e)}
                          class="px-2 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                        >
                          Tomorrow morning
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleSetCardReminder(note.id, 168, e)}
                          class="px-2 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                        >
                          Next week
                        </button>
                      </div>
                    </Show>
                  </div>

                  {/* Palette picker */}
                  <div class="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActivePaletteCardId(activePaletteCardId() === note.id ? null : note.id);
                      }}
                      data-testid={`note-color-btn-${note.id}`}
                      title="Change color"
                      class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" />
                        <circle cx="12" cy="7" r="1.5" />
                        <circle cx="16.5" cy="10.5" r="1.5" />
                        <circle cx="16.5" cy="15.5" r="1.5" />
                        <circle cx="7.5" cy="10.5" r="1.5" />
                        <circle cx="7.5" cy="15.5" r="1.5" />
                      </svg>
                    </button>

                    <Show when={activePaletteCardId() === note.id}>
                      <div
                        class="absolute right-0 bottom-full mb-1 p-1 rounded-lg bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg flex items-center gap-1 z-30"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <For each={NOTE_COLORS}>
                          {(color) => (
                            <button
                              type="button"
                              onClick={(e) => handleSetCardColor(note.id, color.id, e)}
                              title={color.name}
                              class={`w-5 h-5 rounded-full border transition-transform hover:scale-110 cursor-pointer ${
                                color.swatchClass
                              } ${note.color === color.id ? "ring-2 ring-[#9E725F]" : ""}`}
                            />
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>

                  {/* Image attachment */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCardUploadTargetId(note.id);
                      cardImageInputRef?.click();
                    }}
                    data-testid={`note-image-btn-${note.id}`}
                    title="Add image"
                    class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>

                  {/* Archive / Unarchive */}
                  <button
                    type="button"
                    onClick={(e) => (note.isArchived ? handleUnarchive(note.id, e) : handleArchive(note.id, e))}
                    data-testid={`note-archive-btn-${note.id}`}
                    title={note.isArchived ? "Unarchive" : "Archive"}
                    class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <polyline points="21 8 21 21 3 21 3 8" />
                      <rect x="1" y="3" width="22" height="5" />
                      <line x1="10" y1="12" x2="14" y2="12" />
                    </svg>
                  </button>

                  {/* Delete (moves to Bin) */}
                  <button
                    type="button"
                    onClick={(e) => handleDelete(note.id, e)}
                    data-testid={`note-delete-btn-${note.id}`}
                    title="Delete note"
                    class="p-1 rounded hover:bg-red-500/10 text-[#6F7173] hover:text-red-600 dark:text-[#878A8E] dark:hover:text-red-400 cursor-pointer"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>

                  {/* Three-Dot Menu Button (Attachment 5 Options) */}
                  <div class="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuCardId(activeMenuCardId() === note.id ? null : note.id);
                      }}
                      data-testid={`note-more-menu-btn-${note.id}`}
                      title="More options"
                      class="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-[#6F7173] dark:text-[#878A8E] cursor-pointer"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="12" cy="5" r="1" />
                        <circle cx="12" cy="19" r="1" />
                      </svg>
                    </button>

                    <Show when={activeMenuCardId() === note.id}>
                      <div
                        class="absolute right-0 bottom-full mb-1 w-44 p-1.5 rounded-xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xl flex flex-col gap-0.5 z-30 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* 1. Add label */}
                        <div class="relative">
                          <button
                            type="button"
                            onClick={() => setActiveLabelMenuCardId(activeLabelMenuCardId() === note.id ? null : note.id)}
                            class="w-full px-2.5 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between cursor-pointer font-medium"
                          >
                            <span>Add label</span>
                            <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </button>
                          <Show when={activeLabelMenuCardId() === note.id}>
                            <div class="p-1.5 border-t border-black/5 dark:border-white/5 max-h-32 overflow-y-auto space-y-1">
                              <For each={labels()}>
                                {(lbl) => (
                                  <label class="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-black/5 cursor-pointer text-[11px]">
                                    <input
                                      type="checkbox"
                                      checked={(note.labels || []).includes(lbl)}
                                      onChange={(e) => handleToggleCardLabel(note.id, lbl, e as unknown as MouseEvent)}
                                      class="w-3.5 h-3.5 rounded text-[#9E725F]"
                                    />
                                    <span class="truncate">{lbl}</span>
                                  </label>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>

                        {/* 2. Add drawing */}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuCardId(null);
                            setDrawingTargetNoteId(note.id);
                            setIsDrawingModalOpen(true);
                          }}
                          class="w-full px-2.5 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                        >
                          Add drawing
                        </button>

                        {/* 3. Make a copy */}
                        <button
                          type="button"
                          onClick={(e) => {
                            setActiveMenuCardId(null);
                            handleDuplicate(note.id, e);
                          }}
                          class="w-full px-2.5 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                        >
                          Make a copy
                        </button>

                        {/* 4. Show / Hide tick boxes */}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuCardId(null);
                            toggleNoteChecklist(props.mailboxId, note.id);
                            refreshAll();
                          }}
                          class="w-full px-2.5 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                        >
                          {note.isChecklist ? "Hide tick boxes" : "Show tick boxes"}
                        </button>

                        {/* 5. Version history */}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMenuCardId(null);
                            setVersionHistoryTargetNote(note);
                            setIsVersionHistoryOpen(true);
                          }}
                          class="w-full px-2.5 py-1 text-left rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer font-medium"
                        >
                          Version history
                        </button>

                        {/* Divider Line (Attachment 5) */}
                        <div class="h-px bg-[#E2DFD8] dark:bg-[#2E3138] my-1" />

                        {/* 6. Delete note */}
                        <button
                          type="button"
                          onClick={(e) => {
                            setActiveMenuCardId(null);
                            handleDelete(note.id, e);
                          }}
                          class="w-full px-2.5 py-1 text-left rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 cursor-pointer font-medium"
                        >
                          Delete note
                        </button>
                      </div>
                    </Show>
                  </div>
                </>
              }
            >
              {/* Bin Actions */}
              <button
                type="button"
                onClick={(e) => handleRestore(note.id, e)}
                data-testid={`note-restore-btn-${note.id}`}
                title="Restore note"
                class="px-2 py-0.5 rounded text-xs font-semibold bg-[#9E725F]/15 text-[#9E725F] hover:bg-[#9E725F]/25 cursor-pointer"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={(e) => handleDeleteForever(note.id, e)}
                data-testid={`note-delete-forever-btn-${note.id}`}
                title="Delete forever"
                class="p-1 rounded hover:bg-red-500/10 text-red-600 dark:text-red-400 cursor-pointer"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </Show>
          </div>
        </div>
      </div>
    );
  }
};
