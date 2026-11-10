import { Component, Show, For } from "solid-js";
import { NoteItem, NOTE_COLORS } from "./notesStore";
import { formatMessageDate } from "../../utils/dateTime";

export interface NotesListItemProps {
  note: NoteItem;
  isSelected: boolean;
  onSelect: (note: NoteItem) => void;
  onTogglePin?: (e: MouseEvent, note: NoteItem) => void;
  onToggleFavorite?: (e: MouseEvent, note: NoteItem) => void;
}

export const NotesListItem: Component<NotesListItemProps> = (props) => {
  const displayTitle = () => {
    if (props.note.title && props.note.title.trim()) {
      return props.note.title.trim();
    }
    if (props.note.content && props.note.content.trim()) {
      const clean = props.note.content
        .replace(/<[^>]+>/g, " ")
        .replace(/[\*\#\_\~\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const firstLine = clean.split("\n")[0];
      return firstLine.substring(0, 40) || "Untitled Note";
    }
    if (props.note.isChecklist && props.note.checklistItems && props.note.checklistItems.length > 0) {
      return props.note.checklistItems[0].text || "Untitled Checklist";
    }
    return "Untitled Note";
  };

  const previewSnippet = () => {
    if (props.note.content && props.note.content.trim()) {
      return props.note.content
        .replace(/<[^>]+>/g, " ")
        .replace(/[\*\#\_\~\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (props.note.isChecklist && props.note.checklistItems) {
      const items = props.note.checklistItems.filter((i) => i.text.trim());
      if (items.length > 0) {
        return items.map((i) => `${i.completed ? "✓" : "○"} ${i.text}`).join("  •  ");
      }
    }
    if ((props.note.images || []).length > 0) {
      return `[${props.note.images!.length} image${props.note.images!.length > 1 ? "s" : ""}]`;
    }
    if ((props.note.drawings || []).length > 0) {
      return `[Drawing attached]`;
    }
    return "No content";
  };

  const formattedDate = () => {
    const ts = props.note.updatedAt || props.note.createdAt || Date.now();
    return formatMessageDate(new Date(ts).toISOString());
  };

  const completedChecklistCount = () => {
    if (!props.note.checklistItems) return { done: 0, total: 0 };
    const total = props.note.checklistItems.length;
    const done = props.note.checklistItems.filter((i) => i.completed).length;
    return { done, total };
  };

  const getColorBorder = () => {
    if (!props.note.color || props.note.color === "default") return "";
    const found = NOTE_COLORS.find((c) => c.id === props.note.color);
    return found ? found.borderLight : "";
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="notes-list-item"
      data-note-id={props.note.id}
      onClick={() => props.onSelect(props.note)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onSelect(props.note);
        }
      }}
      class={`group relative w-full text-left p-3.5 transition-all duration-150 cursor-pointer select-none border-b border-[#E2DFD8]/60 dark:border-[#2E3138]/60 focus:outline-none ${
        props.isSelected
          ? "bg-[#F2E8E2] dark:bg-[#2D2522] border-l-4 border-l-[#9E725F] dark:border-l-[#D4A38F]"
          : "bg-white dark:bg-[#1E2025] hover:bg-[#F9F7F2] dark:hover:bg-[#26282E] border-l-4 border-l-transparent"
      }`}
    >
      {/* Top Row: Title, Date, Pin/Favorite status */}
      <div class="flex items-start justify-between gap-2 mb-1">
        <h4
          class={`text-sm font-semibold truncate leading-tight flex-1 ${
            props.isSelected
              ? "text-[#1A1B1E] dark:text-[#F3F4F6]"
              : "text-[#2B2C2D] dark:text-[#E2DFD8] group-hover:text-[#1A1B1E] dark:group-hover:text-white"
          }`}
        >
          {displayTitle()}
        </h4>

        <div class="flex items-center gap-1.5 flex-shrink-0">
          {/* Pin Indicator */}
          <Show when={props.note.isPinned}>
            <span
              title="Pinned note"
              class="text-[#9E725F] dark:text-[#D4A38F] flex items-center"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-current" viewBox="0 0 24 24">
                <path d="M16 3l1 1-4 4 3 3-2 2-3-3-4 4-2-2 4-4-3-3 2-2 3 3 4-4z" />
                <path d="M4 20l4-4" stroke-width="2" stroke-linecap="round" />
              </svg>
            </span>
          </Show>

          {/* Favorite Indicator */}
          <Show when={props.note.isFavorite}>
            <span
              title="Favorite note"
              class="text-amber-500 flex items-center"
            >
              <svg class="w-3.5 h-3.5 fill-current stroke-current" viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </span>
          </Show>

          {/* Formatted Date */}
          <span class="text-[11px] font-mono text-[#6F7173] dark:text-[#878A8E] tabular-nums whitespace-nowrap">
            {formattedDate()}
          </span>
        </div>
      </div>

      {/* Snippet Preview (2 lines) */}
      <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA] line-clamp-2 leading-relaxed mb-2.5 break-words">
        {previewSnippet()}
      </p>

      {/* Badges / Metadata Row */}
      <div class="flex items-center justify-between gap-2 text-[11px] text-[#6F7173] dark:text-[#878A8E]">
        <div class="flex items-center gap-2 flex-wrap overflow-hidden">
          {/* Checklist progress */}
          <Show when={props.note.isChecklist && (props.note.checklistItems || []).length > 0}>
            <span
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 font-mono text-[10px]"
              title={`${completedChecklistCount().done} of ${completedChecklistCount().total} tasks completed`}
            >
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <polyline points="9 11 12 14 22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <span>{completedChecklistCount().done}/{completedChecklistCount().total}</span>
            </span>
          </Show>

          {/* Images or Drawings badge */}
          <Show when={(props.note.images || []).length > 0 || (props.note.drawings || []).length > 0}>
            <span
              class="inline-flex items-center gap-1 text-[10px] text-[#878A8E]"
              title="Has attachments or drawings"
            >
              <svg class="w-3 h-3 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </span>
          </Show>

          {/* Reminder Bell */}
          <Show when={props.note.reminder}>
            <span
              class="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400"
              title={`Reminder set: ${props.note.reminder?.label || "Scheduled"}`}
            >
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
          </Show>

          {/* User Labels */}
          <For each={(props.note.labels || []).slice(0, 2)}>
            {(lbl) => (
              <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-medium truncate max-w-[100px]">
                {lbl}
              </span>
            )}
          </For>
          <Show when={(props.note.labels || []).length > 2}>
            <span class="text-[10px] text-[#878A8E]">
              +{(props.note.labels || []).length - 2}
            </span>
          </Show>
        </div>

        {/* Note Color Indicator */}
        <Show when={props.note.color && props.note.color !== "default"}>
          <span
            title={`Color: ${props.note.color}`}
            class={`w-2.5 h-2.5 rounded-full flex-shrink-0 border border-black/10 dark:border-white/10 ${
              NOTE_COLORS.find((c) => c.id === props.note.color)?.swatchClass || ""
            }`}
          />
        </Show>
      </div>
    </div>
  );
};
