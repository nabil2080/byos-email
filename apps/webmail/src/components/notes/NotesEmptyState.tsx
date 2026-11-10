import { Component, Show } from "solid-js";

export interface NotesEmptyStateProps {
  type: "no-selection" | "category-empty" | "search-empty";
  categoryName?: string;
  searchQuery?: string;
  onNewNote?: () => void;
  onClearSearch?: () => void;
}

export const NotesEmptyState: Component<NotesEmptyStateProps> = (props) => {
  return (
    <div
      data-testid="notes-empty-state"
      class="flex-1 flex flex-col items-center justify-center p-8 text-center select-none min-h-[300px]"
    >
      <div class="w-16 h-16 rounded-2xl bg-[#F2E8E2] dark:bg-[#2D2522] border border-[#E2DFD8] dark:border-[#3D322E] flex items-center justify-center text-[#9E725F] dark:text-[#D4A38F] mb-4 shadow-2xs">
        <Show
          when={props.type === "search-empty"}
          fallback={
            <Show
              when={props.type === "category-empty"}
              fallback={
                // No note selected icon
                <svg class="w-8 h-8 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline stroke-linecap="round" stroke-linejoin="round" points="14 2 14 8 20 8" />
                  <line stroke-linecap="round" stroke-linejoin="round" x1="16" y1="13" x2="8" y2="13" />
                  <line stroke-linecap="round" stroke-linejoin="round" x1="16" y1="17" x2="8" y2="17" />
                  <polyline stroke-linecap="round" stroke-linejoin="round" points="10 9 9 9 8 9" />
                </svg>
              }
            >
              {/* Category empty icon */}
              <svg class="w-8 h-8 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
                <path stroke-linecap="round" stroke-linejoin="round" d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
              </svg>
            </Show>
          }
        >
          {/* Search empty icon */}
          <svg class="w-8 h-8 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </Show>
      </div>

      <h3 class="text-base font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1.5">
        <Show when={props.type === "no-selection"}>Select a note to read or edit</Show>
        <Show when={props.type === "category-empty"}>
          No notes in {props.categoryName || "this view"}
        </Show>
        <Show when={props.type === "search-empty"}>
          No notes matching "{props.searchQuery}"
        </Show>
      </h3>

      <p class="text-xs text-[#6F7173] dark:text-[#878A8E] max-w-sm leading-relaxed mb-5">
        <Show when={props.type === "no-selection"}>
          Choose a note from the list on the left, or create a new note with zero-knowledge encryption to capture thoughts, tasks, and drawings.
        </Show>
        <Show when={props.type === "category-empty"}>
          Notes in this section will appear here. Create a new note to start writing.
        </Show>
        <Show when={props.type === "search-empty"}>
          Check for spelling mistakes, try more general keywords, or clear your search query.
        </Show>
      </p>

      <Show when={props.type === "no-selection" && props.onNewNote}>
        <button
          type="button"
          onClick={props.onNewNote}
          data-testid="notes-empty-new-note-btn"
          class="px-4 py-2 bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Create Note</span>
        </button>
      </Show>

      <Show when={props.type === "search-empty" && props.onClearSearch}>
        <button
          type="button"
          onClick={props.onClearSearch}
          class="px-3.5 py-1.5 border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-[#F3ECE8] dark:hover:bg-[#26282E] text-[#9E725F] dark:text-[#D4A38F] text-xs font-medium rounded-lg transition cursor-pointer"
        >
          Clear Search Query
        </button>
      </Show>
    </div>
  );
};
