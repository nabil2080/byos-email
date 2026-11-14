import { Component, createSignal, createMemo, createEffect, Show, onMount, onCleanup } from "solid-js";
import { UserMe, Mailbox, ConnectedAccount } from "../../api";
import {
  NoteItem,
  loadNotes,
  saveNotes,
  createNote,
  updateNote,
  deleteNote,
  deleteNoteForever,
  restoreNoteFromBin,
  archiveNote,
  unarchiveNote,
  toggleFavoriteNote,
  duplicateNote,
  loadLabels,
  saveLabels,
  addNoteDrawing,
  removeNoteDrawing,
  addNoteImage,
  removeNoteImage,
  restoreNoteVersion,
  setNotesMailboxKey,
  getCachedMedia,
  getMediaFromIDB,
  offloadMediaIfDataUrl,
  clearNotesMediaCache,
} from "./notesStore";
import { NotesSidebar, NotesViewFilter } from "./NotesSidebar";
import { NotesList, NoteSortOrder } from "./NotesList";
import { NotesEditor } from "./NotesEditor";
import { EditLabelsModal } from "./EditLabelsModal";
import { DrawingModal } from "./DrawingModal";
import { VersionHistoryModal } from "./VersionHistoryModal";
import { TopFixedBar, AppModule } from "../TopFixedBar";
import { getMailboxKeyFor } from "../../session_isolation";
import {
  getNotesSyncStatus,
  subscribeNotesSyncStatus,
  syncNotesWithRemote,
  triggerNotesSync,
  initNotesSyncAutoListener,
} from "./notesSync";

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
  mailboxKey?: Uint8Array | null;
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
  onShareViaMail?: (file: File, defaultSubject: string, defaultBody: string) => void;
}

export const NotesView: Component<NotesViewProps> = (props) => {
  const [notes, setNotes] = createSignal<NoteItem[]>([]);
  const [labels, setLabels] = createSignal<string[]>([]);
  const [activeView, setActiveView] = createSignal<NotesViewFilter>("notes");
  const [selectedNoteId, setSelectedNoteId] = createSignal<string | null>(null);
  const [sortOrder, setSortOrder] = createSignal<NoteSortOrder>("updated");

  // Mobile single-pane navigation flow: 'sidebar' | 'list' | 'editor'
  // Always default to 'list' on mobile — the note list is the entry point, not the sidebar.
  const [mobilePane, setMobilePane] = createSignal<"sidebar" | "list" | "editor">("list");

  // Modals state
  const [isEditLabelsOpen, setIsEditLabelsOpen] = createSignal(false);
  const [isDrawingModalOpen, setIsDrawingModalOpen] = createSignal(false);
  const [drawingTargetNoteId, setDrawingTargetNoteId] = createSignal<string | null>(null);
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = createSignal(false);
  const [versionHistoryTargetNote, setVersionHistoryTargetNote] = createSignal<NoteItem | null>(null);

  // Saving / Sync State
  const [saveStatus, setSaveStatus] = createSignal<"idle" | "saving" | "saved" | "failed">("idle");
  const [saveErrorMessage, setSaveErrorMessage] = createSignal<string | null>(null);
  const [syncStatus, setSyncStatus] = createSignal(getNotesSyncStatus());

  // Media resolver with reactive signal
  const [resolvedMedia, setResolvedMedia] = createSignal<Record<string, string>>({});
  const resolveMedia = (uri: string) => {
    if (!uri || !uri.startsWith("idb:")) return uri;
    return resolvedMedia()[uri] || getCachedMedia(uri) || uri;
  };

  const effectiveMailboxId = () => props.mailboxId || props.selectedMailbox?.id;

  let lastMailboxId: string | undefined = undefined;

  createEffect(() => {
    const mb = effectiveMailboxId();
    const validKey =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    setNotesMailboxKey(validKey);

    if (lastMailboxId !== undefined && lastMailboxId !== mb) {
      setSelectedNoteId(null);
      setResolvedMedia({});
      clearNotesMediaCache();
      setSaveStatus("idle");
      setSaveErrorMessage(null);
    }
    lastMailboxId = mb;

    refreshAll();
  });

  onMount(() => {
    refreshAll();

    const unsubSync = subscribeNotesSyncStatus((status) => {
      setSyncStatus(status);
      if (status === "synced") {
        refreshAll();
      }
    });
    const cleanupAutoSync = initNotesSyncAutoListener();

    const mb = effectiveMailboxId();
    const key = props.mailboxKey || (mb ? getMailboxKeyFor(mb) : null);
    if (mb && key) {
      syncNotesWithRemote(mb, key).then(() => refreshAll());
    }

    onCleanup(() => {
      unsubSync();
      cleanupAutoSync();
    });

    const handleStorageChange = (e: StorageEvent) => {
      const mb = effectiveMailboxId();
      if (e.key && (e.key === `byos_notes_${mb}` || e.key === `byos_labels_${mb}`)) {
        refreshAll();
      }
    };
    window.addEventListener("storage", handleStorageChange);

    // Escape closes the mobile navigation drawer and returns to the note list.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && mobilePane() === "sidebar") {
        setMobilePane("list");
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    onCleanup(() => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  function refreshAll() {
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    const loaded = loadNotes(mb, key);
    setNotes(loaded);

    // Merge stored labels with any labels present on existing notes
    const storedLabels = loadLabels(mb);
    const noteLabels = new Set<string>(storedLabels);
    for (const n of loaded) {
      if (Array.isArray(n.labels)) {
        for (const l of n.labels) {
          if (typeof l === "string" && l.trim()) {
            noteLabels.add(l.trim());
          }
        }
      }
    }
    const mergedLabels = Array.from(noteLabels);
    if (mergedLabels.length > storedLabels.length) {
      saveLabels(mb, mergedLabels);
    }
    setLabels(mergedLabels);

    const mbKey = props.mailboxKey || (mb ? getMailboxKeyFor(mb) : null);
    for (const n of loaded) {
      if (n.images) {
        for (const img of n.images) {
          if (img && img.startsWith("idb:") && !getCachedMedia(img)) {
            getMediaFromIDB(img, mbKey, mb).then((url) => {
              if (url) {
                setResolvedMedia((prev) => ({ ...prev, [img]: url }));
              }
            });
          }
        }
      }
      if (n.drawings) {
        for (const drw of n.drawings) {
          if (drw && drw.startsWith("idb:") && !getCachedMedia(drw)) {
            getMediaFromIDB(drw, mbKey, mb).then((url) => {
              if (url) {
                setResolvedMedia((prev) => ({ ...prev, [drw]: url }));
              }
            });
          }
        }
      }
    }
  }

  // Filter notes by sidebar view category
  const viewFilteredNotes = createMemo(() => {
    const v = activeView();
    const list = notes();

    if (v === "bin") {
      return list.filter((n) => n.isInBin);
    }
    if (v === "archive") {
      return list.filter((n) => !n.isInBin && n.isArchived);
    }
    if (v === "favorites") {
      return list.filter((n) => !n.isInBin && !n.isArchived && Boolean(n.isFavorite));
    }
    if (v === "reminders") {
      return list.filter((n) => !n.isInBin && !n.isArchived && Boolean(n.reminder));
    }
    if (v.startsWith("label:")) {
      const lblName = v.substring(6).toLowerCase();
      return list.filter((n) => !n.isInBin && !n.isArchived && (n.labels || []).some((l) => l.toLowerCase() === lblName));
    }
    // "notes" (all notes)
    return list.filter((n) => !n.isInBin && !n.isArchived);
  });

  // Filter by search query
  const searchFilteredNotes = createMemo(() => {
    const q = (props.searchQuery || "").trim().toLowerCase();
    const list = viewFilteredNotes();
    if (!q) return list;
    return list.filter((n) => {
      const titleMatch = (n.title || "").toLowerCase().includes(q);
      const contentMatch = (n.content || "").toLowerCase().includes(q);
      const labelMatch = (n.labels || []).some((l) => l.toLowerCase().includes(q));
      const checklistMatch = n.checklistItems?.some((item) => item.text.toLowerCase().includes(q));
      return titleMatch || contentMatch || labelMatch || checklistMatch;
    });
  });

  // Counts for sidebar badges
  const notesCounts = createMemo(() => {
    const list = notes();
    const active = list.filter((n) => !n.isInBin && !n.isArchived);
    const favorites = list.filter((n) => !n.isInBin && !n.isArchived && Boolean(n.isFavorite));
    const reminders = list.filter((n) => !n.isInBin && !n.isArchived && Boolean(n.reminder));
    const archive = list.filter((n) => !n.isInBin && n.isArchived);
    const bin = list.filter((n) => n.isInBin);

    const labelCounts: Record<string, number> = {};
    for (const lbl of labels()) {
      const lower = lbl.toLowerCase();
      labelCounts[lbl] = list.filter(
        (n) => !n.isInBin && !n.isArchived && (n.labels || []).some((l) => l.toLowerCase() === lower)
      ).length;
    }

    return {
      notes: active.length,
      favorites: favorites.length,
      reminders: reminders.length,
      archive: archive.length,
      bin: bin.length,
      labelCounts,
    };
  });

  // Selected note accessor
  const selectedNote = createMemo(() => {
    const id = selectedNoteId();
    if (!id) return null;
    return notes().find((n) => n.id === id) || null;
  });

  // Keep selectedNoteId valid when the filtered list changes.
  // If the currently selected note disappears from the filtered list, deselect.
  // Do NOT auto-select any note — the editor only opens on an explicit click.
  createEffect(() => {
    const currentId = selectedNoteId();
    if (!currentId) return;
    const currentList = searchFilteredNotes();
    const exists = currentList.some((n) => n.id === currentId);
    if (!exists) {
      setSelectedNoteId(null);
    }
  });

  // With no selection there is no editor pane, so the phone view must stay on the list.
  createEffect(() => {
    if (!selectedNote() && mobilePane() === "editor") {
      setMobilePane("list");
    }
  });

  // Sequential Prev / Next note navigation (matches email ReadingPane)
  const currentNoteIndex = () => {
    const id = selectedNoteId();
    if (!id) return -1;
    return searchFilteredNotes().findIndex((n) => n.id === id);
  };

  const hasPrevNote = () => currentNoteIndex() > 0;
  const hasNextNote = () => {
    const idx = currentNoteIndex();
    return idx >= 0 && idx < searchFilteredNotes().length - 1;
  };

  const handlePrevNote = () => {
    const idx = currentNoteIndex();
    if (idx > 0) {
      setSelectedNoteId(searchFilteredNotes()[idx - 1].id);
    }
  };

  const handleNextNote = () => {
    const idx = currentNoteIndex();
    if (idx >= 0 && idx < searchFilteredNotes().length - 1) {
      setSelectedNoteId(searchFilteredNotes()[idx + 1].id);
    }
  };

  function getViewTitle(): string {
    const v = activeView();
    if (v === "notes") return "All Notes";
    if (v === "favorites") return "Favorites";
    if (v === "reminders") return "Reminders";
    if (v === "archive") return "Archive";
    if (v === "bin") return "Trash";
    if (v.startsWith("label:")) return `# ${v.substring(6)}`;
    return "Notes";
  }

  // ── Note Actions ──

  function handleNewNote() {
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    if (!key || key.length !== 32) {
      setSaveStatus("failed");
      setSaveErrorMessage("Encryption key unavailable. Unlock mailbox first.");
      return;
    }

    const initialLabels = activeView().startsWith("label:") ? [activeView().substring(6)] : [];
    const isFavoriteView = activeView() === "favorites";

    const created = createNote(
      mb,
      "",
      "",
      "default",
      false,
      {
        labels: initialLabels,
        isFavorite: isFavoriteView,
      },
      key
    );

    if (created) {
      if (isFavoriteView) {
        created.isFavorite = true;
        updateNote(mb, created.id, { isFavorite: true }, key);
      }
      refreshAll();
      setSelectedNoteId(created.id);
      setMobilePane("editor");
    }
  }

  function handleUpdateNote(patch: Partial<NoteItem>) {
    const n = selectedNote();
    if (!n) return;

    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    if (!key || key.length !== 32) {
      setSaveStatus("failed");
      setSaveErrorMessage("Encryption key unavailable.");
      return;
    }

    setSaveStatus("saving");
    const updated = updateNote(mb, n.id, patch, key);
    if (updated) {
      refreshAll();
      setSaveStatus("saved");
      setSaveErrorMessage(null);
    } else {
      setSaveStatus("failed");
      setSaveErrorMessage("Failed to save note.");
    }
  }

  function handleToggleFavorite() {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    toggleFavoriteNote(mb, n.id, key);
    refreshAll();
  }

  function handleDeleteNote() {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    deleteNote(mb, n.id, key);
    refreshAll();
    const remaining = searchFilteredNotes();
    if (remaining.length > 0) {
      setSelectedNoteId(remaining[0].id);
    } else {
      setSelectedNoteId(null);
      setMobilePane("list");
    }
  }

  function handleDeleteForever() {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    deleteNoteForever(mb, n.id, key);
    refreshAll();
    const remaining = searchFilteredNotes();
    if (remaining.length > 0) {
      setSelectedNoteId(remaining[0].id);
    } else {
      setSelectedNoteId(null);
      setMobilePane("list");
    }
  }

  function handleRestoreFromBin() {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    restoreNoteFromBin(mb, n.id, key);
    refreshAll();
  }

  function handleArchiveNote() {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    archiveNote(mb, n.id, key);
    refreshAll();
  }

  function handleUnarchiveNote() {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    unarchiveNote(mb, n.id, key);
    refreshAll();
  }

  function handleDuplicateNote() {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    const cloned = duplicateNote(mb, n.id, key);
    if (cloned) {
      refreshAll();
      setSelectedNoteId(cloned.id);
    }
  }

  function handleUploadImage(file: File) {
    const n = selectedNote();
    if (!n) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const mb = effectiveMailboxId();
      const key =
        (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
      addNoteImage(mb, n.id, dataUrl, key);
      refreshAll();
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveImage(index: number) {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    removeNoteImage(mb, n.id, index, key);
    refreshAll();
  }

  function handleRemoveDrawing(index: number) {
    const n = selectedNote();
    if (!n) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    removeNoteDrawing(mb, n.id, index, key);
    refreshAll();
  }

  function handleDrawingSaved(dataUrl: string) {
    const noteId = drawingTargetNoteId() || selectedNoteId();
    if (!noteId) return;
    const mb = effectiveMailboxId();
    const key =
      (props.isUnlocked !== false ? props.mailboxKey : null) || (mb ? getMailboxKeyFor(mb) : null);
    addNoteDrawing(mb, noteId, dataUrl, key);
    refreshAll();
    setIsDrawingModalOpen(false);
    setDrawingTargetNoteId(null);
  }

  return (
    <div
      data-testid="notes-view"
      class="flex flex-1 min-w-0 min-h-0 h-full overflow-hidden bg-[#F0EEE9] dark:bg-[#18191D] gap-0 sm:gap-2.5 lg:gap-3"
    >
      {/* ── Mobile Navigation Backdrop (fades with the drawer, matches Mail/Calendar) ── */}
      <div
        data-testid="notes-mobile-nav-backdrop"
        class={`fixed inset-0 bg-black/40 backdrop-blur-xs z-50 md:hidden transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
          mobilePane() === "sidebar" ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobilePane("list")}
        aria-hidden="true"
      />

      {/* ── PANE 1: Notes Navigation Sidebar (256px in-flow on desktop, sliding overlay drawer on mobile) ── */}
      <div
        data-testid="notes-sidebar-shell"
        class={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] flex-shrink-0 h-full transition-[translate,visibility] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${
          mobilePane() === "sidebar"
            ? "translate-x-0 visible shadow-2xl"
            : "-translate-x-full invisible"
        } md:static md:visible md:translate-x-0 md:w-64 md:min-w-[256px] md:max-w-[256px] md:shadow-none md:transition-none`}
      >
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
          onSelectView={(v) => {
            setActiveView(v);
            setMobilePane("list");
          }}
          onNewNote={handleNewNote}
          labels={labels()}
          onOpenEditLabels={() => setIsEditLabelsOpen(true)}
          notesCounts={notesCounts()}
          onOpenContacts={props.onOpenContacts}
          onOpenSettings={props.onOpenSettings}
          onCloseMobile={() => setMobilePane("list")}
        />
      </div>

      {/* ── Right Content Column beside NotesSidebar: TopFixedBar + 2-Pane Workspace Card ── */}
      <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden gap-1.5 sm:gap-2">
        {/* Top Fixed Bar (Beside NotesSidebar, not on top of it) */}
        <TopFixedBar
          activeModule={props.activeModule}
          onSwitchModule={props.onSwitchModule}
          searchQuery={props.searchQuery || ""}
          onSearchChange={props.onSearchChange || (() => {})}
          onOpenContacts={props.onOpenContacts}
          onOpenMobileMenu={() => setMobilePane(mobilePane() === "sidebar" ? "list" : "sidebar")}
          isOnline={props.isOnline}
          isCustomizerOpen={props.isCustomizerOpen}
          onToggleCustomizer={props.onToggleCustomizer}
          theme={props.theme}
          onToggleTheme={props.onToggleTheme}
        />

        {/* ── Main Three-Pane Container Card (Pane 2: List + Pane 3: Reading/Editing Panel) ── */}
        <div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] shadow-2xs overflow-hidden flex min-w-0 min-h-0">
          {/* ── PANE 2: Notes List (full-width alone, 320–350px beside the editor) ── */}
          <div
            class={`${
              mobilePane() === "list" ? "block" : "hidden"
            } md:block h-full min-w-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              selectedNote()
                ? "w-full md:w-[320px] lg:w-[350px] md:min-w-[320px] lg:min-w-[350px] md:max-w-[350px] md:flex-shrink-0"
                : "w-full md:flex-1"
            }`}
          >
            <NotesList
              notes={searchFilteredNotes()}
              selectedNote={selectedNote()}
              activeCategoryTitle={getViewTitle()}
              searchQuery={props.searchQuery || ""}
              onSearchChange={props.onSearchChange || (() => {})}
              onSelectNote={(note) => {
                setSelectedNoteId(note.id);
                setMobilePane("editor");
              }}
              onNewNote={handleNewNote}
              onOpenMobileSidebar={() => setMobilePane("sidebar")}
              sortOrder={sortOrder()}
              onSortChange={setSortOrder}
            />
          </div>

          {/* ── PANE 3: Reading and Editing Panel — mounted only when a note is open, like the mail reading pane ── */}
          <Show when={selectedNote()}>
            <div
              class={`${
                mobilePane() === "editor" ? "block" : "hidden"
              } md:flex md:flex-1 min-w-0 h-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`}
            >
              <NotesEditor
                note={selectedNote()}
                allLabels={labels()}
                onUpdateNote={handleUpdateNote}
                onToggleFavorite={handleToggleFavorite}
                onDeleteNote={handleDeleteNote}
                onDeleteForever={handleDeleteForever}
                onRestoreFromBin={handleRestoreFromBin}
                onArchiveNote={handleArchiveNote}
                onUnarchiveNote={handleUnarchiveNote}
                onDuplicateNote={handleDuplicateNote}
                onOpenDrawingModal={() => {
                  setDrawingTargetNoteId(selectedNoteId());
                  setIsDrawingModalOpen(true);
                }}
                onOpenVersionHistory={() => {
                  setVersionHistoryTargetNote(selectedNote());
                  setIsVersionHistoryOpen(true);
                }}
                onUploadImage={handleUploadImage}
                onRemoveImage={handleRemoveImage}
                onRemoveDrawing={handleRemoveDrawing}
                resolveMediaUri={resolveMedia}
                saveStatus={saveStatus()}
                saveErrorMessage={saveErrorMessage()}
                syncStatus={syncStatus()}
                hasPrevNote={hasPrevNote()}
                hasNextNote={hasNextNote()}
                onPrevNote={handlePrevNote}
                onNextNote={handleNextNote}
                onBackToNotesList={() => {
                  setSelectedNoteId(null);
                  setMobilePane("list");
                }}
                onNewNote={handleNewNote}
                onShareViaMail={props.onShareViaMail}
              />
            </div>
          </Show>
        </div>
      </div>

      {/* ── Modals: Edit Labels, Drawing, Version History ── */}
      <EditLabelsModal
        mailboxId={effectiveMailboxId()}
        labels={labels()}
        isOpen={isEditLabelsOpen()}
        onClose={() => setIsEditLabelsOpen(false)}
        onLabelsChange={refreshAll}
      />

      <DrawingModal
        isOpen={isDrawingModalOpen()}
        onClose={() => {
          setIsDrawingModalOpen(false);
          setDrawingTargetNoteId(null);
        }}
        onSave={handleDrawingSaved}
      />

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
            const restored = restoreNoteVersion(effectiveMailboxId(), note.id, verId);
            if (restored) {
              refreshAll();
              const freshNotes = loadNotes(effectiveMailboxId());
              const updated = freshNotes.find((n) => n.id === note.id);
              if (updated) {
                setVersionHistoryTargetNote(updated);
              }
            }
          }
        }}
      />
    </div>
  );
};
