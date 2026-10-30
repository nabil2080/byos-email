import { Component, createSignal, For, Show } from "solid-js";
import { addLabel, renameLabel, deleteLabel } from "./notesStore";

export interface EditLabelsModalProps {
  mailboxId?: string;
  labels: string[];
  isOpen: boolean;
  onClose: () => void;
  onLabelsChange: () => void;
}

export const EditLabelsModal: Component<EditLabelsModalProps> = (props) => {
  const [newLabelText, setNewLabelText] = createSignal("");
  const [editingLabelName, setEditingLabelName] = createSignal<string | null>(null);
  const [editingValue, setEditingValue] = createSignal("");

  function handleCreateLabel() {
    const txt = newLabelText().trim();
    if (!txt) return;
    addLabel(props.mailboxId, txt);
    setNewLabelText("");
    props.onLabelsChange();
  }

  function handleStartRename(name: string) {
    setEditingLabelName(name);
    setEditingValue(name);
  }

  function handleSaveRename() {
    const oldName = editingLabelName();
    if (!oldName) return;
    const newName = editingValue().trim();
    if (newName && newName !== oldName) {
      renameLabel(props.mailboxId, oldName, newName);
      props.onLabelsChange();
    }
    setEditingLabelName(null);
  }

  function handleDelete(name: string) {
    deleteLabel(props.mailboxId, name);
    props.onLabelsChange();
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-in fade-in duration-150"
        onClick={props.onClose}
        data-testid="edit-labels-modal-backdrop"
      >
        <div
          class="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1E1F23] border border-[#E2DFD8] dark:border-[#2A2D35] p-5 shadow-2xl text-[#1A1B1E] dark:text-[#ECEBE8] select-none"
          onClick={(e) => e.stopPropagation()}
          data-testid="edit-labels-modal"
        >
          <h3 class="text-base font-bold mb-4">Edit labels</h3>

          {/* Create new label row */}
          <div class="flex items-center gap-2 mb-4 pb-3 border-b border-[#E2DFD8] dark:border-[#2A2D35]">
            <button
              type="button"
              onClick={() => setNewLabelText("")}
              class="p-1 text-[#6F7173] hover:text-[#1A1B1E] dark:hover:text-[#ECEBE8]"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <input
              type="text"
              placeholder="Create new label"
              value={newLabelText()}
              onInput={(e) => setNewLabelText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateLabel();
              }}
              data-testid="create-label-input"
              class="flex-1 text-sm bg-transparent outline-none placeholder-[#878A8E]"
            />
            <button
              type="button"
              onClick={handleCreateLabel}
              data-testid="create-label-btn"
              title="Create label"
              class="p-1 rounded text-[#9E725F] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          </div>

          {/* List of existing labels */}
          <div class="max-h-60 overflow-y-auto flex flex-col gap-2 mb-4">
            <For each={props.labels}>
              {(lbl) => (
                <div class="flex items-center justify-between gap-2 py-1 px-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 group">
                  <Show
                    when={editingLabelName() === lbl}
                    fallback={
                      <>
                        <div class="flex items-center gap-2.5 truncate flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => handleDelete(lbl)}
                            data-testid={`delete-label-btn-${lbl}`}
                            title="Delete label"
                            class="p-1 text-[#6F7173] hover:text-red-500 cursor-pointer"
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                          <span class="text-sm truncate font-medium">{lbl}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleStartRename(lbl)}
                          data-testid={`edit-label-btn-${lbl}`}
                          title="Rename label"
                          class="p-1 text-[#6F7173] hover:text-[#1A1B1E] dark:hover:text-[#ECEBE8] opacity-80 group-hover:opacity-100 cursor-pointer"
                        >
                          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                          </svg>
                        </button>
                      </>
                    }
                  >
                    <input
                      type="text"
                      value={editingValue()}
                      onInput={(e) => setEditingValue(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveRename();
                      }}
                      class="flex-1 text-sm bg-transparent outline-none border-b border-[#9E725F]"
                      autofocus
                    />
                    <button
                      type="button"
                      onClick={handleSaveRename}
                      data-testid={`save-rename-label-btn-${lbl}`}
                      class="p-1 text-[#9E725F] cursor-pointer"
                    >
                      <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>

          {/* Done button */}
          <div class="flex justify-end pt-2 border-t border-[#E2DFD8] dark:border-[#2A2D35]">
            <button
              type="button"
              onClick={props.onClose}
              data-testid="edit-labels-done-btn"
              class="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#9E725F] text-white hover:bg-[#8B6453] transition shadow-2xs cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
