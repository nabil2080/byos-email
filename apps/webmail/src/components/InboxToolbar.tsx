import { Component, createSignal, createEffect, Show, For, onCleanup, onMount } from "solid-js";
import { MailboxFolder, MailboxLabel } from "../api";

export type SelectionFilter = "all" | "none" | "read" | "unread" | "starred" | "unstarred";
export type SortOrder = "newest" | "oldest" | "unread";

interface InboxToolbarProps {
  selectedCount: number;
  totalVisibleCount: number;
  totalCount: number;
  onSelectFilter: (filter: SelectionFilter) => void;
  onRefresh: () => void;
  sortOrder: SortOrder;
  onSortChange: (order: SortOrder) => void;
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  currentPage: number;
  pageSize: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onBatchArchive: () => void;
  onBatchSpam: () => void;
  onBatchTrash: () => void;
  onBatchDeleteForever?: () => void;
  currentFolder?: string;
  onBatchToggleRead: (read: boolean) => void;
  isAllSelectedRead?: boolean;
  onBatchToggleStarred: (starred: boolean) => void;
  onBatchMoveTo: (folder: string) => void;
  onClearSelection: () => void;
  isAllConversationsSelected?: boolean;
  onSelectAllConversations?: () => void;
  customFolders?: MailboxFolder[];
  labels?: MailboxLabel[];
  onBatchToggleLabel?: (labelId: string) => void;
  isSplit?: boolean;
  theme?: string;
  onSetTheme?: (t: "cloud_dancer" | "dark") => void;
  onToggleTheme?: () => void;
}

export const InboxToolbar: Component<InboxToolbarProps> = (props) => {
  const [selectMenuOpen, setSelectMenuOpen] = createSignal(false);
  const [sortMenuOpen, setSortMenuOpen] = createSignal(false);
  const [moveMenuOpen, setMoveMenuOpen] = createSignal(false);
  const [labelMenuOpen, setLabelMenuOpen] = createSignal(false);
  const [isSpinning, setIsSpinning] = createSignal(false);

  let toolbarRef: HTMLDivElement | undefined;

  function openOnlyMenu(menu: "select" | "sort" | "move" | "label" | null) {
    setSelectMenuOpen(menu === "select");
    setSortMenuOpen(menu === "sort");
    setMoveMenuOpen(menu === "move");
    setLabelMenuOpen(menu === "label");
  }

  function toggleMenu(menu: "select" | "sort" | "move" | "label" | null) {
    if (menu === null) {
      openOnlyMenu(null);
      return;
    }
    const isOpen =
      (menu === "select" && selectMenuOpen()) ||
      (menu === "sort" && sortMenuOpen()) ||
      (menu === "move" && moveMenuOpen()) ||
      (menu === "label" && labelMenuOpen());
    openOnlyMenu(isOpen ? null : menu);
  }

  function handleClickOutside(e: MouseEvent) {
    if (toolbarRef && !toolbarRef.contains(e.target as Node)) {
      toggleMenu(null);
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
  });

  const isPartiallySelected = () =>
    props.selectedCount > 0 && props.selectedCount < props.totalVisibleCount;

  const isAllSelected = () =>
    props.totalVisibleCount > 0 && props.selectedCount >= props.totalVisibleCount;

  const pageStart = () => (props.totalCount === 0 ? 0 : (props.currentPage - 1) * props.pageSize + 1);
  const pageEnd = () => Math.min(props.currentPage * props.pageSize, props.totalCount);

  const renderMasterCheckbox = () => (
    <div class="relative flex items-center bg-white dark:bg-[#1E2025] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] p-0.5 shadow-2xs">
      <button
        type="button"
        onClick={() => {
          if (props.selectedCount > 0) {
            props.onClearSelection();
          } else {
            props.onSelectFilter("all");
          }
        }}
        class="px-1.5 py-1 text-xs text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] rounded transition cursor-pointer flex items-center justify-center"
        title={props.selectedCount > 0 ? "Deselect all" : "Select all visible"}
      >
        <input
          type="checkbox"
          checked={isAllSelected()}
          ref={(el) => {
            createEffect(() => {
              el.indeterminate = isPartiallySelected();
            });
          }}
          class="accent-[#A27561] w-3.5 h-3.5 cursor-pointer rounded pointer-events-none"
        />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleMenu("select");
        }}
        class="px-1 py-1 text-[#878A8E] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] rounded transition cursor-pointer"
        title="Select options"
      >
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Select Dropdown Menu (z-50) */}
      <Show when={selectMenuOpen()}>
        <div
          onClick={(e) => e.stopPropagation()}
          class="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-xl z-50 py-1 flex flex-col text-xs font-sans"
        >
          <button
            type="button"
            onClick={() => {
              props.onSelectFilter("all");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => {
              props.onSelectFilter("none");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer"
          >
            None
          </button>
          <button
            type="button"
            onClick={() => {
              props.onSelectFilter("read");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer"
          >
            Read
          </button>
          <button
            type="button"
            onClick={() => {
              props.onSelectFilter("unread");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer"
          >
            Unread
          </button>
          <button
            type="button"
            onClick={() => {
              props.onSelectFilter("starred");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer"
          >
            Starred
          </button>
          <button
            type="button"
            onClick={() => {
              props.onSelectFilter("unstarred");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer"
          >
            Unstarred
          </button>
        </div>
      </Show>
    </div>
  );

  const renderMoveToMenu = (alignment: "left-0" | "right-0" = "right-0") => (
    <div class="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleMenu("move");
        }}
        class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
        title="Move to folder"
      >
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      <Show when={moveMenuOpen()}>
        <div
          onClick={(e) => e.stopPropagation()}
          class={`absolute ${alignment} top-full mt-1.5 w-48 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl py-1 z-50 text-xs font-sans max-h-64 overflow-y-auto`}
        >
          <div class="px-3 py-1 text-[10px] font-bold text-[#878A8E] dark:text-[#71717A] uppercase tracking-wider font-mono">
            System Folders
          </div>
          <button
            type="button"
            onClick={() => {
              props.onBatchMoveTo("inbox");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer flex items-center gap-2"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
            <span>Inbox</span>
          </button>
          <button
            type="button"
            onClick={() => {
              props.onBatchMoveTo("archive");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer flex items-center gap-2"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <polyline points="21 8 21 21 3 21 3 8" />
              <rect x="1" y="3" width="22" height="5" />
              <line x1="10" y1="12" x2="14" y2="12" />
            </svg>
            <span>Archive</span>
          </button>
          <button
            type="button"
            onClick={() => {
              props.onBatchMoveTo("spam");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer flex items-center gap-2"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Spam</span>
          </button>
          <button
            type="button"
            onClick={() => {
              props.onBatchMoveTo("trash");
              toggleMenu(null);
            }}
            class="w-full text-left px-3 py-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition cursor-pointer flex items-center gap-2"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            <span>Trash</span>
          </button>

          <Show when={props.customFolders && props.customFolders.length > 0}>
            <div class="my-1 border-t border-[#E2DFD8] dark:border-[#2E3138]"></div>
            <div class="px-3 py-1 text-[10px] font-bold text-[#878A8E] dark:text-[#71717A] uppercase tracking-wider font-mono">
              Custom Folders
            </div>
            <For each={props.customFolders}>
              {(folder) => (
                <button
                  type="button"
                  onClick={() => {
                    props.onBatchMoveTo(folder.id);
                    toggleMenu(null);
                  }}
                  class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer flex items-center gap-2 truncate"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5] flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span class="truncate">{folder.name}</span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );

  const renderLabelAsMenu = (alignment: "left-0" | "right-0" = "right-0") => (
    <div class="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleMenu("label");
        }}
        class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
        title="Label as"
      >
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
      </button>

      <Show when={labelMenuOpen()}>
        <div
          onClick={(e) => e.stopPropagation()}
          class={`absolute ${alignment} top-full mt-1.5 w-48 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl py-1 z-50 text-xs font-sans max-h-64 overflow-y-auto`}
        >
          <div class="px-3 py-1 text-[10px] font-bold text-[#878A8E] dark:text-[#71717A] uppercase tracking-wider font-mono">
            Labels
          </div>
          <For each={props.labels || []}>
            {(label) => (
              <button
                type="button"
                onClick={() => {
                  props.onBatchToggleLabel?.(label.id);
                  toggleMenu(null);
                }}
                class="w-full text-left px-3 py-1.5 hover:bg-[#F3ECE8] dark:hover:bg-[#2D2522] hover:text-[#A27561] dark:hover:text-[#D4A38F] text-[#3C3D3E] dark:text-[#E2DFD8] transition cursor-pointer flex items-center justify-between gap-2"
              >
                <div class="flex items-center gap-2 truncate min-w-0">
                  <span
                    class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ "background-color": label.color }}
                  />
                  <span class="truncate">{label.name}</span>
                </div>
              </button>
            )}
          </For>
          <Show when={!props.labels || props.labels.length === 0}>
            <div class="px-3 py-1.5 text-[#878A8E] dark:text-[#71717A] text-[11px] italic">
              No labels created
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );

  return (
    <div
      ref={toolbarRef}
      class="px-3.5 pt-2.5 pb-2 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F6] dark:bg-[#18191D] flex flex-col gap-2 select-none relative z-20"
    >
      {/* Top Header Row: Search Input + Light/Dark Mode Switch all the way to the right */}
      <div class="flex items-center justify-between gap-2.5 w-full">
        {/* Search Bar with mathematically centered icon */}
        <div class="relative flex-1 max-w-[540px]">
          <input
            type="text"
            placeholder="Search by sender, subject, or keywords…"
            value={props.searchQuery || ""}
            onInput={(e) => props.onSearchChange?.(e.currentTarget.value)}
            class="w-full h-8.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] pl-9 pr-8 text-xs sm:text-sm text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#6E7075] dark:placeholder-[#878A8E] shadow-2xs focus:outline-none focus:border-[#A27561] focus:ring-1 focus:ring-[#A27561]/20 transition-all leading-normal"
          />
          <svg
            class="w-4 h-4 text-[#6E7075] dark:text-[#878A8E] absolute left-3 top-1/2 -translate-y-1/2 stroke-current fill-none stroke-[1.8] pointer-events-none"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <Show when={props.searchQuery}>
            <button
              type="button"
              onClick={() => props.onSearchChange?.("")}
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6E7075] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] cursor-pointer p-0.5"
              title="Clear search"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>

        {/* Light / Dark Mode Switch (All the way to the right) */}
        <div class="flex items-center flex-shrink-0">
          <div class="flex items-center p-0.5 bg-[#E8E5DF] dark:bg-[#26282E] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138]">
            <button
              type="button"
              onClick={() => props.onSetTheme ? props.onSetTheme("cloud_dancer") : props.onToggleTheme?.()}
              class={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                props.theme !== "dark"
                  ? "bg-white text-[#1A1B1E] shadow-2xs font-semibold"
                  : "text-[#6E7075] hover:text-[#1A1B1E] dark:text-[#A1A1AA] dark:hover:text-[#F3F4F6]"
              }`}
              title="Cloud Dancer (Light Mode)"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
              <span class="hidden sm:inline">Light</span>
            </button>
            <button
              type="button"
              onClick={() => props.onSetTheme ? props.onSetTheme("dark") : props.onToggleTheme?.()}
              class={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                props.theme === "dark"
                  ? "bg-[#18191D] text-[#F3F4F6] shadow-2xs font-semibold"
                  : "text-[#6E7075] hover:text-[#1A1B1E] dark:text-[#A1A1AA] dark:hover:text-[#F3F4F6]"
              }`}
              title="Dark Mode"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              <span class="hidden sm:inline">Dark</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dual-State Action Bar */}
      <Show
        when={props.isSplit && props.selectedCount > 0}
        fallback={
          /* Single-Row Toolbar for Full-Width or Unselected Split Mode */
          <div class="flex items-center justify-between min-h-[32px] flex-nowrap whitespace-nowrap gap-2 relative">
            {/* Left Side: Checkbox & Contextual Actions */}
            <div class="flex items-center gap-1 sm:gap-2 min-w-0">
              {renderMasterCheckbox()}

              <Show
                when={props.selectedCount > 0}
                fallback={
                  /* Default State: Refresh & Sort */
                  <div class="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSpinning(true);
                        props.onRefresh();
                        setTimeout(() => setIsSpinning(false), 800);
                      }}
                      class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                      title="Refresh mail"
                    >
                      <svg
                        class={`w-3.5 h-3.5 stroke-current fill-none stroke-[1.8] ${
                          isSpinning() ? "animate-spin text-[#A27561]" : ""
                        }`}
                        viewBox="0 0 24 24"
                      >
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                    </button>

                    {/* Sort / Filter dropdown */}
                    <div class="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMenu("sort");
                        }}
                        class="px-2 py-1 text-xs text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138] flex items-center gap-1 font-medium"
                        title="Sort order"
                      >
                        <span class="capitalize">{props.sortOrder}</span>
                        <svg class="w-3 h-3 text-[#878A8E] dark:text-[#71717A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      <Show when={sortMenuOpen()}>
                        <div
                          onClick={(e) => e.stopPropagation()}
                          class="absolute right-0 top-full mt-1.5 w-44 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-xl z-50 py-1 flex flex-col text-xs font-sans"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              props.onSortChange("newest");
                              toggleMenu(null);
                            }}
                            class={`w-full text-left px-3 py-1.5 transition cursor-pointer flex items-center justify-between ${
                              props.sortOrder === "newest"
                                ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-semibold"
                                : "hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] text-[#3C3D3E] dark:text-[#E2DFD8]"
                            }`}
                          >
                            <span>Newest first</span>
                            <Show when={props.sortOrder === "newest"}>
                              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </Show>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              props.onSortChange("oldest");
                              toggleMenu(null);
                            }}
                            class={`w-full text-left px-3 py-1.5 transition cursor-pointer flex items-center justify-between ${
                              props.sortOrder === "oldest"
                                ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-semibold"
                                : "hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] text-[#3C3D3E] dark:text-[#E2DFD8]"
                            }`}
                          >
                            <span>Oldest first</span>
                            <Show when={props.sortOrder === "oldest"}>
                              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </Show>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              props.onSortChange("unread");
                              toggleMenu(null);
                            }}
                            class={`w-full text-left px-3 py-1.5 transition cursor-pointer flex items-center justify-between ${
                              props.sortOrder === "unread"
                                ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-semibold"
                                : "hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] text-[#3C3D3E] dark:text-[#E2DFD8]"
                            }`}
                          >
                            <span>Unread first</span>
                            <Show when={props.sortOrder === "unread"}>
                              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </Show>
                          </button>
                        </div>
                      </Show>
                    </div>
                  </div>
                }
              >
                {/* Selection State: Count Badge & Batch Actions */}
                <div class="flex items-center gap-1 sm:gap-1.5">
                  <span class="px-2 py-0.5 rounded-md bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-medium text-xs font-mono">
                    {props.selectedCount} selected
                  </span>

                  {/* Archive */}
                  <button
                    type="button"
                    onClick={props.onBatchArchive}
                    class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                    title="Archive selected"
                  >
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <polyline points="21 8 21 21 3 21 3 8" />
                      <rect x="1" y="3" width="22" height="5" />
                      <line x1="10" y1="12" x2="14" y2="12" />
                    </svg>
                  </button>

                  {/* Report Spam */}
                  <button
                    type="button"
                    onClick={props.onBatchSpam}
                    class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                    title="Report Spam"
                  >
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </button>

                  {/* Delete / Trash or Delete Forever */}
                  <Show
                    when={props.currentFolder === "trash" && props.onBatchDeleteForever}
                    fallback={
                      <button
                        type="button"
                        onClick={props.onBatchTrash}
                        class="p-1.5 text-[#464748] dark:text-[#A1A1AA] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                        title="Move to Trash"
                      >
                        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    }
                  >
                    <button
                      type="button"
                      onClick={props.onBatchDeleteForever}
                      class="p-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50"
                      title="Delete Forever"
                    >
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="14" y2="15" />
                        <line x1="14" y1="11" x2="10" y2="15" />
                      </svg>
                    </button>
                  </Show>

                  {/* Single Contextual Read/Unread Smart Toggle */}
                  <button
                    type="button"
                    onClick={() => props.onBatchToggleRead(!props.isAllSelectedRead)}
                    class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                    title={props.isAllSelectedRead ? "Mark as unread" : "Mark as read"}
                  >
                    <Show
                      when={props.isAllSelectedRead}
                      fallback={
                        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                        </svg>
                      }
                    >
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </Show>
                  </button>

                  {/* Star toggle */}
                  <button
                    type="button"
                    onClick={() => props.onBatchToggleStarred(true)}
                    class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-amber-500 hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                    title="Add star"
                  >
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>

                  {renderMoveToMenu("right-0")}
                  {renderLabelAsMenu("right-0")}
                </div>
              </Show>
            </div>

            {/* Right Side: Pagination */}
            <div class="flex items-center gap-1.5 text-xs text-[#878A8E] dark:text-[#71717A] font-mono">
              <span>
                {pageStart()}–{pageEnd()} of {props.totalCount}
              </span>
              <div class="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={props.onPrevPage}
                  disabled={props.currentPage <= 1}
                  class="p-1 rounded text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-white dark:hover:bg-[#1E2025] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                  title="Previous page"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={props.onNextPage}
                  disabled={pageEnd() >= props.totalCount}
                  class="p-1 rounded text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-white dark:hover:bg-[#1E2025] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                  title="Next page"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        }
      >
        {/* Two-Row Toolbar for Split View when items are selected */}
        <div class="flex flex-col gap-1.5 p-1 bg-[#FAF9F6] dark:bg-[#18191D] relative z-20">
          {/* Row 1: Selection Status & Deselect */}
          <div class="flex items-center justify-between min-h-[32px]">
            <div class="flex items-center gap-2">
              {renderMasterCheckbox()}
              <span class="text-xs font-semibold text-[#A27561] dark:text-[#D4A38F] bg-[#F2E8E2] dark:bg-[#2D2522] px-2 py-0.5 rounded-md font-mono">
                {props.selectedCount} selected
              </span>
            </div>
            <button
              type="button"
              onClick={props.onClearSelection}
              class="text-xs text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] px-2 py-0.5 rounded hover:bg-[#E8E5DF]/60 dark:hover:bg-[#26282E] transition cursor-pointer font-medium"
            >
              Cancel
            </button>
          </div>

          {/* Row 2: Action Icons Cluster with Full Width */}
          <div class="flex items-center justify-between border-t border-[#E2DFD8]/60 dark:border-[#2E3138] pt-1.5">
            <div class="flex items-center gap-1">
              <button
                type="button"
                onClick={props.onBatchArchive}
                class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                title="Archive selected"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
              </button>
              <Show
                when={props.currentFolder === "trash" && props.onBatchDeleteForever}
                fallback={
                  <button
                    type="button"
                    onClick={props.onBatchTrash}
                    class="p-1.5 text-[#464748] dark:text-[#A1A1AA] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:border-[#2E3138]"
                    title="Move to Trash"
                  >
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={props.onBatchDeleteForever}
                  class="p-1.5 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition cursor-pointer border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50"
                  title="Delete Forever"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="14" y2="15" />
                    <line x1="14" y1="11" x2="10" y2="15" />
                  </svg>
                </button>
              </Show>
              <button
                type="button"
                onClick={() => props.onBatchToggleRead(!props.isAllSelectedRead)}
                class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-[#A27561] dark:hover:text-[#D4A38F] hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                title={props.isAllSelectedRead ? "Mark as unread" : "Mark as read"}
              >
                <Show
                  when={props.isAllSelectedRead}
                  fallback={
                    <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </svg>
                  }
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </Show>
              </button>
              <button
                type="button"
                onClick={() => props.onBatchToggleStarred(true)}
                class="p-1.5 text-[#55575B] dark:text-[#A1A1AA] hover:text-amber-500 hover:bg-white dark:hover:bg-[#1E2025] rounded-lg transition cursor-pointer border border-transparent hover:border-[#E2DFD8] dark:hover:border-[#2E3138]"
                title="Add star"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
            </div>
            <div class="flex items-center gap-1">
              {renderMoveToMenu("right-0")}
              {renderLabelAsMenu("right-0")}
            </div>
          </div>
        </div>
      </Show>

      {/* Select all across mailbox banner when all page items selected */}
      <Show
        when={
          isAllSelected() &&
          props.totalCount > props.totalVisibleCount &&
          !props.isAllConversationsSelected
        }
      >
        <div class="bg-[#F3ECE8] dark:bg-[#2D2522] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl px-3 py-1.5 text-xs text-[#3C3D3E] dark:text-[#E2DFD8] text-center">
          All {props.totalVisibleCount} conversations on this page are selected.{" "}
          <button
            type="button"
            onClick={props.onSelectAllConversations}
            class="text-[#A27561] dark:text-[#D4A38F] font-bold hover:underline cursor-pointer"
          >
            Select all {props.totalCount} conversations in {props.totalCount}
          </button>
        </div>
      </Show>
    </div>
  );
};
