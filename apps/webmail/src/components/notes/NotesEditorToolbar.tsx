import { Component, createSignal, Show, For } from "solid-js";

export interface NotesEditorToolbarProps {
  onApplyFormat: (format: string, value?: string) => void;
  activeFormats?: Record<string, boolean>;
  currentFontFamily?: string;
  currentFontSize?: string;
  currentColor?: string;
  currentAlign?: "left" | "center" | "right";
  onToggleChecklistMode?: () => void;
  isChecklistMode?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  wordCount?: number;
  charCount?: number;
  onInsertImageClick?: () => void;
  class?: string;
}

export const FONT_SIZES = [
  { label: "10px", value: "10px" },
  { label: "12px", value: "12px" },
  { label: "14px", value: "14px" },
  { label: "16px", value: "16px" },
  { label: "18px", value: "18px" },
  { label: "24px", value: "24px" },
  { label: "32px", value: "32px" },
];

export const FONT_FAMILIES = [
  { label: "Sans Serif", value: "sans", stack: "Inter, ui-sans-serif, system-ui, sans-serif" },
  { label: "Serif", value: "serif", stack: "Merriweather, Georgia, Cambria, serif" },
  { label: "Monospace", value: "mono", stack: "JetBrains Mono, ui-monospace, Menlo, Consolas, monospace" },
];

export const FONT_COLORS = [
  { name: "Black", hex: "#1A1B1E" },
  { name: "Dark Gray", hex: "#6F7173" },
  { name: "Brown (BYOS)", hex: "#9E725F" },
  { name: "Blue", hex: "#2563EB" },
  { name: "Green", hex: "#16A34A" },
  { name: "Red", hex: "#DC2626" },
  { name: "Purple", hex: "#7C3AED" },
];

export const NotesEditorToolbar: Component<NotesEditorToolbarProps> = (props) => {
  const [showHeadingsMenu, setShowHeadingsMenu] = createSignal(false);
  const [showFontFamilyMenu, setShowFontFamilyMenu] = createSignal(false);
  const [showFontSizeMenu, setShowFontSizeMenu] = createSignal(false);
  const [showColorMenu, setShowColorMenu] = createSignal(false);
  const [customColorInput, setCustomColorInput] = createSignal("#9E725F");

  const isFormatActive = (format: string) => Boolean(props.activeFormats?.[format]);

  const activeFontFamilyLabel = () => {
    const fam = props.currentFontFamily || "sans";
    return FONT_FAMILIES.find((f) => f.value === fam)?.label || "Sans Serif";
  };

  const activeFontSizeLabel = () => {
    return props.currentFontSize || "14px";
  };

  return (
    <div
      data-testid="notes-editor-toolbar"
      class={`px-3 py-1.5 border-b border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F5] dark:bg-[#18191D] flex items-center justify-between gap-1 flex-wrap select-none ${
        props.class || ""
      }`}
    >
      <div class="flex items-center gap-1 flex-wrap">
        {/* ==================================================================== */}
        {/* GROUP 1: Text Formatting (Bold, Italic, Underline, Strikethrough)    */}
        {/* ==================================================================== */}
        <div class="flex items-center gap-0.5" data-testid="toolbar-group-formatting">
          {/* Bold */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("bold")}
            data-testid="toolbar-bold-btn"
            title="Bold (Ctrl+B)"
            class={`w-7 h-7 rounded-lg text-xs font-bold transition flex items-center justify-center cursor-pointer ${
              isFormatActive("bold")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            B
          </button>

          {/* Italic */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("italic")}
            data-testid="toolbar-italic-btn"
            title="Italic (Ctrl+I)"
            class={`w-7 h-7 rounded-lg text-xs italic font-serif transition flex items-center justify-center cursor-pointer ${
              isFormatActive("italic")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            I
          </button>

          {/* Underline */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("underline")}
            data-testid="toolbar-underline-btn"
            title="Underline (Ctrl+U)"
            class={`w-7 h-7 rounded-lg text-xs underline transition flex items-center justify-center cursor-pointer ${
              isFormatActive("underline")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            U
          </button>

          {/* Strikethrough */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("strikethrough")}
            data-testid="toolbar-strikethrough-btn"
            title="Strikethrough"
            class={`w-7 h-7 rounded-lg text-xs line-through transition flex items-center justify-center cursor-pointer ${
              isFormatActive("strikethrough")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            S
          </button>
        </div>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

        {/* ==================================================================== */}
        {/* GROUP 2: Structure (Headings, Lists, Checklist, Quote, Code)         */}
        {/* ==================================================================== */}
        <div class="flex items-center gap-0.5" data-testid="toolbar-group-structure">
          {/* Headings Dropdown */}
          <div class="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowHeadingsMenu(!showHeadingsMenu());
                setShowFontFamilyMenu(false);
                setShowFontSizeMenu(false);
                setShowColorMenu(false);
              }}
              data-testid="toolbar-headings-btn"
              title="Heading style"
              class={`h-7 px-2 rounded-lg text-xs font-semibold transition flex items-center gap-1 cursor-pointer ${
                isFormatActive("h1") || isFormatActive("h2") || isFormatActive("h3")
                  ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                  : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span>
                {isFormatActive("h1")
                  ? "Heading 1"
                  : isFormatActive("h2")
                  ? "Heading 2"
                  : isFormatActive("h3")
                  ? "Heading 3"
                  : "Format"}
              </span>
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <Show when={showHeadingsMenu()}>
              <div
                class="absolute left-0 top-full mt-1 w-36 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg p-1 z-30 text-xs flex flex-col gap-0.5"
                onClick={() => setShowHeadingsMenu(false)}
              >
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => props.onApplyFormat("p")}
                  class="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-[#1A1B1E] dark:text-[#F3F4F6]"
                >
                  Normal text
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => props.onApplyFormat("h1")}
                  class={`w-full text-left px-2.5 py-1.5 rounded-lg font-bold text-sm cursor-pointer ${
                    isFormatActive("h1")
                      ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                      : "text-[#1A1B1E] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  Heading 1
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => props.onApplyFormat("h2")}
                  class={`w-full text-left px-2.5 py-1.5 rounded-lg font-semibold text-xs cursor-pointer ${
                    isFormatActive("h2")
                      ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                      : "text-[#1A1B1E] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  Heading 2
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => props.onApplyFormat("h3")}
                  class={`w-full text-left px-2.5 py-1.5 rounded-lg font-medium text-xs cursor-pointer ${
                    isFormatActive("h3")
                      ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                      : "text-[#1A1B1E] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
                  }`}
                >
                  Heading 3
                </button>
              </div>
            </Show>
          </div>

          {/* Bullet List */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("bullet")}
            data-testid="toolbar-bullet-btn"
            title="Bulleted List"
            class={`w-7 h-7 rounded-lg text-xs transition flex items-center justify-center cursor-pointer ${
              isFormatActive("bullet")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" stroke-width="3" />
              <line x1="3" y1="12" x2="3.01" y2="12" stroke-width="3" />
              <line x1="3" y1="18" x2="3.01" y2="18" stroke-width="3" />
            </svg>
          </button>

          {/* Numbered List */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("numbered")}
            data-testid="toolbar-numbered-btn"
            title="Numbered List"
            class={`w-7 h-7 rounded-lg text-xs font-mono transition flex items-center justify-center cursor-pointer ${
              isFormatActive("numbered")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            1.
          </button>

          {/* Checklist Toggle */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (props.onToggleChecklistMode) {
                props.onToggleChecklistMode();
              } else {
                props.onApplyFormat("checklist");
              }
            }}
            data-testid="toolbar-checklist-btn"
            title="Checklist / Tasks"
            class={`w-7 h-7 rounded-lg text-xs transition flex items-center justify-center cursor-pointer ${
              props.isChecklistMode
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-semibold"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </button>

          {/* Quote */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("quote")}
            data-testid="toolbar-quote-btn"
            title="Blockquote"
            class={`w-7 h-7 rounded-lg text-xs font-serif transition flex items-center justify-center cursor-pointer ${
              isFormatActive("quote")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            “
          </button>

          {/* Code */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("code")}
            data-testid="toolbar-code-btn"
            title="Code block"
            class={`w-7 h-7 rounded-lg text-xs font-mono transition flex items-center justify-center cursor-pointer ${
              isFormatActive("code")
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            &lt;/&gt;
          </button>
        </div>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

        {/* ==================================================================== */}
        {/* GROUP 3: Document Appearance (Family, Size, Color, Alignments)      */}
        {/* ==================================================================== */}
        <div class="flex items-center gap-0.5" data-testid="toolbar-group-appearance">
          {/* Font Family Dropdown */}
          <div class="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowFontFamilyMenu(!showFontFamilyMenu());
                setShowHeadingsMenu(false);
                setShowFontSizeMenu(false);
                setShowColorMenu(false);
              }}
              data-testid="toolbar-font-family-btn"
              title="Font family"
              class="h-7 px-2 rounded-lg text-xs font-medium text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center gap-1 cursor-pointer"
            >
              <span class="truncate max-w-[80px]">{activeFontFamilyLabel()}</span>
              <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <Show when={showFontFamilyMenu()}>
              <div
                class="absolute left-0 top-full mt-1 w-36 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg p-1 z-30 text-xs flex flex-col gap-0.5"
                onClick={() => setShowFontFamilyMenu(false)}
              >
                <For each={FONT_FAMILIES}>
                  {(fam) => (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => props.onApplyFormat("fontFamily", fam.stack)}
                      class={`w-full text-left px-2.5 py-1.5 rounded-lg cursor-pointer text-xs ${
                        props.currentFontFamily === fam.value
                          ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-semibold"
                          : "text-[#1A1B1E] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                      style={{ "font-family": fam.stack }}
                    >
                      {fam.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Font Size Dropdown */}
          <div class="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowFontSizeMenu(!showFontSizeMenu());
                setShowHeadingsMenu(false);
                setShowFontFamilyMenu(false);
                setShowColorMenu(false);
              }}
              data-testid="toolbar-font-size-btn"
              title="Font size"
              class="h-7 px-1.5 rounded-lg text-xs font-mono text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center gap-1 cursor-pointer"
            >
              <span>{activeFontSizeLabel()}</span>
              <svg class="w-2.5 h-2.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            <Show when={showFontSizeMenu()}>
              <div
                class="absolute left-0 top-full mt-1 w-24 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg p-1 z-30 text-xs flex flex-col gap-0.5 max-h-48 overflow-y-auto"
                onClick={() => setShowFontSizeMenu(false)}
              >
                <For each={FONT_SIZES}>
                  {(sz) => (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => props.onApplyFormat("fontSize", sz.value)}
                      class={`w-full text-left px-2.5 py-1 rounded-lg cursor-pointer text-xs font-mono ${
                        props.currentFontSize === sz.value
                          ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-semibold"
                          : "text-[#1A1B1E] dark:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
                      }`}
                    >
                      {sz.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Font Color Popover */}
          <div class="relative">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setShowColorMenu(!showColorMenu());
                setShowHeadingsMenu(false);
                setShowFontFamilyMenu(false);
                setShowFontSizeMenu(false);
              }}
              data-testid="toolbar-color-btn"
              title="Text Color"
              class="w-7 h-7 rounded-lg text-xs text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5 transition flex flex-col items-center justify-center cursor-pointer relative"
            >
              <span class="font-bold text-[12px] leading-none">A</span>
              <span
                class="w-3.5 h-0.5 rounded-full mt-0.5"
                style={{ "background-color": props.currentColor || "#1A1B1E" }}
              />
            </button>

            <Show when={showColorMenu()}>
              <div
                class="absolute left-0 top-full mt-1 w-44 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg p-2 z-30 text-xs flex flex-col gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <div class="text-[10px] font-mono text-[#878A8E] uppercase tracking-wider">
                  Text Color
                </div>
                <div class="grid grid-cols-4 gap-1.5">
                  <For each={FONT_COLORS}>
                    {(col) => (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          props.onApplyFormat("color", col.hex);
                          setShowColorMenu(false);
                        }}
                        title={col.name}
                        class="w-7 h-7 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-center hover:scale-105 transition cursor-pointer"
                        style={{ "background-color": col.hex }}
                      />
                    )}
                  </For>
                </div>
                <div class="flex items-center gap-1.5 pt-1 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                  <input
                    type="color"
                    value={customColorInput()}
                    onInput={(e) => setCustomColorInput(e.currentTarget.value)}
                    class="w-6 h-6 rounded cursor-pointer border-none bg-transparent"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      props.onApplyFormat("color", customColorInput());
                      setShowColorMenu(false);
                    }}
                    class="flex-1 px-2 py-0.5 rounded bg-[#9E725F] text-white text-[11px] font-medium hover:bg-[#865E4D] cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </Show>
          </div>

          {/* Align Left */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("align", "left")}
            data-testid="toolbar-align-left-btn"
            title="Align Left"
            class={`w-7 h-7 rounded-lg text-xs transition flex items-center justify-center cursor-pointer ${
              props.currentAlign === "left" || !props.currentAlign
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="17" y1="10" x2="3" y2="10" />
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="14" x2="3" y2="14" />
              <line x1="17" y1="18" x2="3" y2="18" />
            </svg>
          </button>

          {/* Align Center */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("align", "center")}
            data-testid="toolbar-align-center-btn"
            title="Align Center"
            class={`w-7 h-7 rounded-lg text-xs transition flex items-center justify-center cursor-pointer ${
              props.currentAlign === "center"
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="18" y1="10" x2="6" y2="10" />
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="14" x2="3" y2="14" />
              <line x1="18" y1="18" x2="6" y2="18" />
            </svg>
          </button>

          {/* Align Right */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("align", "right")}
            data-testid="toolbar-align-right-btn"
            title="Align Right"
            class={`w-7 h-7 rounded-lg text-xs transition flex items-center justify-center cursor-pointer ${
              props.currentAlign === "right"
                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                : "text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="21" y1="10" x2="7" y2="10" />
              <line x1="21" y1="6" x2="3" y2="6" />
              <line x1="21" y1="14" x2="3" y2="14" />
              <line x1="21" y1="18" x2="7" y2="18" />
            </svg>
          </button>
        </div>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

        {/* ==================================================================== */}
        {/* GROUP 4: Insert (Link, Insert Image)                                 */}
        {/* ==================================================================== */}
        <div class="flex items-center gap-0.5" data-testid="toolbar-group-insert">
          {/* Link */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => props.onApplyFormat("link")}
            data-testid="toolbar-link-btn"
            title="Insert Link"
            class="w-7 h-7 rounded-lg text-xs text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center justify-center cursor-pointer"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>

          {/* Insert Image */}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (props.onInsertImageClick) {
                props.onInsertImageClick();
              } else {
                props.onApplyFormat("insertImage");
              }
            }}
            data-testid="toolbar-insert-image-btn"
            title="Insert Image"
            class="w-7 h-7 rounded-lg text-xs text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5 transition flex items-center justify-center cursor-pointer"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
        </div>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

        {/* ==================================================================== */}
        {/* Undo / Redo                                                          */}
        {/* ==================================================================== */}
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onUndo}
            disabled={props.canUndo === false}
            data-testid="toolbar-undo-btn"
            title="Undo (Ctrl+Z)"
            class="w-7 h-7 rounded-lg text-xs text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition flex items-center justify-center cursor-pointer"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={props.onRedo}
            disabled={props.canRedo === false}
            data-testid="toolbar-redo-btn"
            title="Redo (Ctrl+Y)"
            class="w-7 h-7 rounded-lg text-xs text-[#3C3D3E] dark:text-[#E2DFD8] hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-40 disabled:pointer-events-none transition flex items-center justify-center cursor-pointer"
          >
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Word / Character Count (Far Right) ── */}
      <Show when={props.wordCount !== undefined}>
        <div class="text-[11px] font-mono text-[#878A8E] dark:text-[#6F7173] px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 select-none tabular-nums whitespace-nowrap">
          <span>{props.wordCount} words</span>
          <Show when={props.charCount !== undefined}>
            <span class="opacity-60 ml-1.5">• {props.charCount} chars</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};
