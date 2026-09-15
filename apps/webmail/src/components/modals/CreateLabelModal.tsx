import { Component, createSignal, createEffect, For, Show } from "solid-js";
import { MailboxLabel } from "../../api";

export interface ColorSwatch {
  name: string;
  hex: string;
}

export const LABEL_SWATCHES: ColorSwatch[] = [
  { name: "Cobalt", hex: "#4D6BFE" },
  { name: "Lavender", hex: "#7B68EE" },
  { name: "Bubblegum", hex: "#D660B0" },
  { name: "Tangerine", hex: "#FA7246" },
  { name: "Mocha", hex: "#9E725F" },
  { name: "Royal Blue", hex: "#2B4CDE" },
  { name: "Plum", hex: "#6A37A5" },
  { name: "Crimson", hex: "#D13438" },
  { name: "Burnt Orange", hex: "#D6511B" },
  { name: "Cocoa", hex: "#704E3E" },
  { name: "Sky Blue", hex: "#38ACFF" },
  { name: "Teal", hex: "#20B2AA" },
  { name: "Pine", hex: "#2E8B57" },
  { name: "Leaf Green", hex: "#64BB5C" },
  { name: "Olive", hex: "#808000" },
  { name: "Periwinkle", hex: "#6C88D4" },
  { name: "Ocean", hex: "#007AA6" },
  { name: "Forest", hex: "#1B6A47" },
  { name: "Emerald", hex: "#107C41" },
  { name: "Mustard", hex: "#C19A2B" },
];

interface CreateLabelModalProps {
  isOpen: boolean;
  onClose: () => void;
  labelToEdit?: MailboxLabel | null;
  onSave: (name: string, color: string, colorName: string) => Promise<void> | void;
}

export const CreateLabelModal: Component<CreateLabelModalProps> = (props) => {
  const [labelName, setLabelName] = createSignal("");
  const [selectedColor, setSelectedColor] = createSignal<ColorSwatch>(LABEL_SWATCHES[4]); // Mocha default
  const [hoveredColor, setHoveredColor] = createSignal<ColorSwatch | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.isOpen) {
      if (props.labelToEdit) {
        setLabelName(props.labelToEdit.name);
        const match = LABEL_SWATCHES.find(
          (s) => s.hex.toLowerCase() === props.labelToEdit!.color.toLowerCase()
        ) || {
          name: props.labelToEdit.color_name || "Custom",
          hex: props.labelToEdit.color,
        };
        setSelectedColor(match);
      } else {
        setLabelName("");
        setSelectedColor(LABEL_SWATCHES[4]);
      }
      setHoveredColor(null);
      setError(null);
      setIsSaving(false);
    }
  });

  async function handleSubmit(e?: Event) {
    if (e) e.preventDefault();
    const name = labelName().trim();
    if (!name) {
      setError("Label name is required.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await props.onSave(name, selectedColor().hex, selectedColor().name);
      props.onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to save label.");
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
          aria-labelledby="create-label-title"
        >
          {/* Header */}
          <div class="px-6 py-4 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between">
            <h3 id="create-label-title" class="font-semibold text-base text-[#2B2C2D] dark:text-[#F3F4F6]">
              {props.labelToEdit ? "Edit label" : "Create label"}
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
          <form onSubmit={handleSubmit} class="p-6 space-y-5">
            <Show when={error()}>
              <div role="alert" class="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-400">
                {error()}
              </div>
            </Show>

            {/* Label Name Field */}
            <div class="space-y-1.5">
              <label for="label-name-input" class="block text-xs font-medium text-[#5E6063] dark:text-[#A1A1AA]">
                Label name
              </label>
              <input
                id="label-name-input"
                type="text"
                placeholder="Label name"
                value={labelName()}
                onInput={(e) => setLabelName(e.currentTarget.value)}
                autofocus
                disabled={isSaving()}
                class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3.5 py-2.5 text-sm text-[#2B2C2D] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none focus:ring-1 focus:ring-[#A27561] focus:border-[#A27561] bg-[#FAF9F6] dark:bg-[#18191D] transition"
              />
            </div>

            {/* Color Swatches Grid */}
            <div class="space-y-2">
              <div class="text-xs font-medium text-[#5E6063] dark:text-[#A1A1AA]">
                Color: <span class="font-semibold text-[#2B2C2D] dark:text-[#F3F4F6]">{hoveredColor() ? hoveredColor()!.name : selectedColor().name}</span>
              </div>
              <div class="grid grid-cols-5 gap-3 pt-1">
                <For each={LABEL_SWATCHES}>
                  {(swatch) => {
                    const isSelected = () => selectedColor().hex === swatch.hex;
                    return (
                      <button
                        type="button"
                        onClick={() => setSelectedColor(swatch)}
                        onMouseEnter={() => setHoveredColor(swatch)}
                        onMouseLeave={() => setHoveredColor(null)}
                        style={{ "background-color": swatch.hex }}
                        class="w-8 h-8 rounded-full cursor-pointer flex items-center justify-center transition-transform hover:scale-110 shadow-2xs focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#A27561] dark:focus:ring-offset-[#1E2025]"
                        title={swatch.name}
                        aria-label={swatch.name}
                      >
                        <Show when={isSelected()}>
                          <span class="w-2.5 h-2.5 bg-white rounded-full shadow-sm" />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
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
                disabled={isSaving() || !labelName().trim()}
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
