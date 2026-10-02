import { Component, createSignal, createEffect, For, Show, onMount, onCleanup } from "solid-js";
import { MailboxLabel } from "../../api";
import { buildLabelTree, getSubtreeLabelIds, validateReparent, LabelTreeNode } from "../../utils/nested_labels";

interface ChangeParentModalProps {
  isOpen: boolean;
  onClose: () => void;
  label: MailboxLabel | null;
  allLabels: MailboxLabel[];
  onSave: (labelId: string, newParentId: string | null) => Promise<void> | void;
}

export const ChangeParentModal: Component<ChangeParentModalProps> = (props) => {
  const [selectedParentId, setSelectedParentId] = createSignal<string>("");
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && props.isOpen) {
      props.onClose();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
    });
  });

  createEffect(() => {
    if (props.isOpen && props.label) {
      setSelectedParentId(props.label.parent_label_id || "");
      setError(null);
      setIsSaving(false);
    }
  });

  const parentOptions = () => {
    if (!props.label) return [];
    const all = props.allLabels || [];
    const tree = buildLabelTree(all);
    const editingId = props.label.id;
    const forbiddenIds = new Set(getSubtreeLabelIds(editingId, all));

    const options: { id: string; name: string; depth: number; disabled: boolean }[] = [];

    function walk(node: LabelTreeNode) {
      const isForbidden = forbiddenIds.has(node.label.id);
      options.push({
        id: node.label.id,
        name: node.label.name,
        depth: node.depth,
        disabled: isForbidden,
      });
      for (const child of node.children) {
        walk(child);
      }
    }

    for (const root of tree) {
      walk(root);
    }

    return options;
  };

  async function handleSubmit(e?: Event) {
    if (e) e.preventDefault();
    if (!props.label) return;

    const chosenParent = selectedParentId().trim() || null;
    const validation = validateReparent(props.label.id, chosenParent, props.allLabels || []);
    if (!validation.valid) {
      setError(validation.error || "Invalid parent selection.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await props.onSave(props.label.id, chosenParent);
      props.onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to change parent.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Show when={props.isOpen && props.label}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
        <div
          class="w-full max-w-md rounded-2xl bg-white dark:bg-[#1E2025] shadow-2xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150 font-sans"
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-parent-title"
        >
          {/* Header */}
          <div class="px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between">
            <h3 id="change-parent-title" class="font-semibold text-base text-[#2B2C2D] dark:text-[#F3F4F6]">
              Change parent for "{props.label?.name}"
            </h3>
            <button
              onClick={props.onClose}
              class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] cursor-pointer p-1.5 rounded-lg hover:bg-[#F0EEE9]/60 dark:hover:bg-[#26282E] transition focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              aria-label="Close"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} class="p-6 space-y-5">
            <Show when={error()}>
              <div role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-400">
                {error()}
              </div>
            </Show>

            <div class="space-y-1.5">
              <label for="change-parent-select" class="block text-xs font-medium text-[#5E6063] dark:text-[#A1A1AA]">
                Select new parent label
              </label>
              <select
                id="change-parent-select"
                value={selectedParentId()}
                onChange={(e) => setSelectedParentId(e.currentTarget.value)}
                disabled={isSaving()}
                class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2.5 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] bg-[#FAF9F6] dark:bg-[#18191D] focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 focus:border-[#9E725F] transition cursor-pointer"
              >
                <option value="">(None - Top Level / Root)</option>
                <For each={parentOptions()}>
                  {(opt) => (
                    <option value={opt.id} disabled={opt.disabled}>
                      {"\u00A0\u00A0".repeat(opt.depth * 2) + (opt.depth > 0 ? "↳ " : "") + opt.name + (opt.disabled ? " (Self/Descendant)" : "")}
                    </option>
                  )}
                </For>
              </select>
              <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E] mt-1">
                Moving a label moves all of its sublabels with it. Nesting max depth is 5 levels.
              </p>
            </div>

            <div class="pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={props.onClose}
                disabled={isSaving()}
                class="px-4 py-2 rounded-xl text-xs font-medium text-[#5E6063] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving()}
                class="px-5 py-2 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold shadow-2xs transition disabled:opacity-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              >
                {isSaving() ? "Moving…" : "Move"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};
