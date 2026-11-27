import { Component, createSignal, createMemo, Show, For } from "solid-js";
import { NoteItem } from "./notesStore";
import { NotesListItem } from "./NotesListItem";
import { NotesEmptyState } from "./NotesEmptyState";

export type NoteSortOrder = "updated" | "created" | "title";

export interface NotesListProps {
  notes: NoteItem[];
  selectedNote: NoteItem | null;
  activeCategoryTitle: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectNote: (note: NoteItem) => void;
  onNewNote: () => void;
  onOpenMobileSidebar?: () => void;
  sortOrder?: NoteSortOrder;
  onSortChange?: (sort: NoteSortOrder) => void;
  class?: string;
}

export const NotesList: Component<NotesListProps> = (props) => {
  const [internalSort, setInternalSort] = createSignal<NoteSortOrder>(props.sortOrder || "updated");
  const [showSortMenu, setShowSortMenu] = createSignal(false);

  const activeSort = () => props.sortOrder || internalSort();
  const setSort = (s: NoteSortOrder) => {
    setInternalSort(s);
    props.onSortChange?.(s);
    setShowSortMenu(false);
  };

  // Sort notes (a flat list, matching the email list — no pin grouping)
  const sortedNotes = createMemo(() => {
    const list = [...props.notes];
    const s = activeSort();

    return list.sort((a, b) => {
      if (s === "title") {
        const titleA = (a.title || a.content || "").toLowerCase();
        const titleB = (b.title || b.content || "").toLowerCase();
        return titleA.localeCompare(titleB);
      }
      if (s === "created") {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      // default: updated
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    });
  });

  return (
    <div
      data-testid="notes-list-pane"
      class={`w-full h-full bg-white dark:bg-[#18191D] flex flex-col min-h-0 overflow-hidden select-none transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        props.selectedNote ? "border-r border-[#E2DFD8] dark:border-[#2E3138]" : ""
      } ${
        props.class || ""
      }`}
    >
      {/* ── Top Header Bar ── */}
      <div class="px-3.5 py-2.5 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between gap-2 bg-white dark:bg-[#18191D] flex-shrink-0">
        <div class="flex items-center gap-2 min-w-0">
          <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6] truncate tracking-tight">
            {props.activeCategoryTitle}
          </h3>

          <span class="text-[11px] font-mono tabular-nums px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-[#6F7173] dark:text-[#878A8E] flex-shrink-0">
            {props.notes.length}
          </span>
        </div>

        {/* Action Controls */}
        <div class="flex items-center gap-1 flex-shrink-0">
          {/* Sort Controls Menu */}
          <div class="relative">
            <button
              type="button"
              onClick={() => setShowSortMenu(!showSortMenu())}
              data-testid="notes-list-sort-btn"
              title="Sort notes"
              class={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
                showSortMenu()
                  ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                  : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="7" y1="12" x2="17" y2="12" />
                <line x1="10" y1="18" x2="14" y2="18" />
              </svg>
            </button>

            <Show when={showSortMenu()}>
              <div
                class="absolute right-0 top-full mt-1.5 w-44 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg p-1 z-30 text-xs flex flex-col gap-0.5"
                onClick={(e) => e.stopPropagation()}
              >
                <div class="px-2.5 py-1 text-[10px] font-mono text-[#878A8E] uppercase tracking-wider">
                  Sort by
                </div>
                <button
                  type="button"
                  onClick={() => setSort("updated")}
                  class={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer font-medium ${
                    activeSort() === "updated"
                      ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                      : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <span>Last updated</span>
                  <Show when={activeSort() === "updated"}><span>✓</span></Show>
                </button>
                <button
                  type="button"
                  onClick={() => setSort("created")}
                  class={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer font-medium ${
                    activeSort() === "created"
                      ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                      : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <span>Date created</span>
                  <Show when={activeSort() === "created"}><span>✓</span></Show>
                </button>
                <button
                  type="button"
                  onClick={() => setSort("title")}
                  class={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer font-medium ${
                    activeSort() === "title"
                      ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                      : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  <span>Title (A-Z)</span>
                  <Show when={activeSort() === "title"}><span>✓</span></Show>
                </button>
              </div>
            </Show>
          </div>

          {/* Quick New Note Button (hidden on phone view, desktop only) */}
          <button
            type="button"
            onClick={props.onNewNote}
            data-testid="notes-list-new-note-btn"
            title="Create note"
            class="hidden md:flex w-8 h-8 rounded-lg items-center justify-center bg-[#9E725F] hover:bg-[#865E4D] text-white transition shadow-2xs cursor-pointer ml-0.5 active:scale-95"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Note Items List (Scrollable) ── */}
      <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <Show
          when={props.notes.length > 0}
          fallback={
            <NotesEmptyState
              type={props.searchQuery ? "search-empty" : "category-empty"}
              categoryName={props.activeCategoryTitle}
              searchQuery={props.searchQuery}
              onNewNote={props.onNewNote}
              onClearSearch={() => props.onSearchChange("")}
            />
          }
        >
          {/* Flat note list — no pinned/unpinned sections */}
          <For each={sortedNotes()}>
            {(note) => (
              <NotesListItem
                note={note}
                isSelected={props.selectedNote?.id === note.id}
                onSelect={props.onSelectNote}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
