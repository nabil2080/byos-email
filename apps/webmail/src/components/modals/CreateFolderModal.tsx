import { Component, createSignal, createEffect, For, Show } from "solid-js";
import { MailboxFolder } from "../../api";

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  folders: MailboxFolder[];
  folderToEdit?: MailboxFolder | null;
  onSave: (name: string, parentId?: string | null, notify?: boolean) => Promise<void> | void;
}

export const CreateFolderModal: Component<CreateFolderModalProps> = (props) => {
  const [folderName, setFolderName] = createSignal("");
  const [parentId, setParentId] = createSignal<string>("");
  const [notify, setNotify] = createSignal(true);
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.isOpen) {
      if (props.folderToEdit) {
        setFolderName(props.folderToEdit.name);
        setParentId(props.folderToEdit.parent_id || "");
        setNotify(props.folderToEdit.notify ?? true);
      } else {
        setFolderName("");
        setParentId("");
        setNotify(true);
      }
      setError(null);
      setIsSaving(false);
    }
  });

  async function handleSubmit(e?: Event) {
    if (e) e.preventDefault();
    const name = folderName().trim();
    if (!name) {
      setError("Folder name is required.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await props.onSave(name, parentId() ? parentId() : null, notify());
      props.onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save folder.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div
          class="w-full max-w-md rounded-2xl bg-white dark:bg-[#1E2025] shadow-2xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 font-sans"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-folder-title"
        >
          {/* Header */}
          <div class="px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between">
            <h3 id="create-folder-title" class="font-semibold text-base text-[#2B2C2D] dark:text-[#F3F4F6]">
              {props.folderToEdit ? "Edit folder" : "Create folder"}
            </h3>
            <button
              onClick={props.onClose}
              class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer p-1.5 rounded-lg hover:bg-[#F0EEE9]/60 dark:hover:bg-[#26282E] transition"
              aria-label="Close"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Form Content */}
          <form onSubmit={handleSubmit} class="p-6 space-y-4">
            <Show when={error()}>
              <div role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-400">
                {error()}
              </div>
            </Show>

            {/* Helper Description  */}
            <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA] leading-relaxed">
              Name your new folder and select the parent folder you want to put it in. If you do not select a parent folder, this new folder will be created as a top level folder.
            </p>

            {/* Folder Name Field */}
            <div class="space-y-1.5">
              <label for="folder-name-input" class="block text-xs font-medium text-[#5E6063] dark:text-[#A1A1AA]">
                Folder name
              </label>
              <input
                id="folder-name-input"
                type="text"
                placeholder="Folder name"
                value={folderName()}
                onInput={(e) => setFolderName(e.currentTarget.value)}
                autofocus
                disabled={isSaving()}
                class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2.5 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] bg-[#FAF9F6] dark:bg-[#18191D] transition"
              />
            </div>

            {/* Folder Location Dropdown */}
            <div class="space-y-1.5">
              <label for="folder-location-select" class="block text-xs font-medium text-[#5E6063] dark:text-[#A1A1AA]">
                Folder location
              </label>
              <div class="relative">
                <select
                  id="folder-location-select"
                  value={parentId()}
                  onChange={(e) => setParentId(e.currentTarget.value)}
                  disabled={isSaving()}
                  class="w-full appearance-none rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2.5 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] bg-[#FAF9F6] dark:bg-[#18191D] transition cursor-pointer pr-10"
                >
                  <option value="" class="bg-white dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#F3F4F6]">No parent folder</option>
                  <For each={props.folders.filter((f) => !props.folderToEdit || f.id !== props.folderToEdit.id)}>
                    {(f) => (
                      <option value={f.id} class="bg-white dark:bg-[#18191D] text-[#2B2C2D] dark:text-[#F3F4F6]">
                        {f.name}
                      </option>
                    )}
                  </For>
                </select>
                <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-[#6F7173] dark:text-[#878A8E]">
                  <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Notification Toggle Row */}
            <div class="flex items-center justify-between py-2 border-t border-[#E2DFD8]/60 dark:border-[#2E3138]">
              <div class="flex items-center gap-1.5">
                <span class="text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6]">Notification</span>
                <span class="text-xs text-[#878A8E] dark:text-[#71717A] cursor-help" title="Receive alerts when new messages arrive in this folder">
                  ⓘ
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notify()}
                onClick={() => setNotify(!notify())}
                class={`w-11 h-6 rounded-full transition-colors cursor-pointer relative p-0.5 ${
                  notify() ? "bg-[#A27561]" : "bg-[#E2DFD8] dark:bg-[#2E3138]"
                }`}
              >
                <span
                  class={`block w-5 h-5 rounded-full bg-white dark:bg-[#F3F4F6] shadow-md transform transition-transform ${
                    notify() ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Footer Buttons */}
            <div class="pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={props.onClose}
                disabled={isSaving()}
                class="px-4 py-2 rounded-xl text-xs font-medium text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving() || !folderName().trim()}
                class="px-5 py-2 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold shadow-2xs transition disabled:opacity-50 cursor-pointer"
              >
                {isSaving() ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
