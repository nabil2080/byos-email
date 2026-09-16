import { Component, createSignal, onMount, Show } from "solid-js";
import DOMPurify from "dompurify";

export interface RichTextEditorProps {
  value?: string;
  placeholder?: string;
  onChange?: (data: { html: string; text: string }) => void;
  minHeight?: string;
  maxHeight?: string;
  class?: string;
  contentClass?: string;
  showHtmlToggle?: boolean;
}

export const RichTextEditor: Component<RichTextEditorProps> = (props) => {
  let editorRef: HTMLDivElement | undefined;
  const [isHtmlMode, setIsHtmlMode] = createSignal(false);
  const [currentHtml, setCurrentHtml] = createSignal(props.value || "");
  const [showLinkModal, setShowLinkModal] = createSignal(false);
  const [linkUrl, setLinkUrl] = createSignal("https://");
  const [linkText, setLinkText] = createSignal("");
  const [showImageModal, setShowImageModal] = createSignal(false);
  const [imageUrl, setImageUrl] = createSignal("");
  const [imageAlt, setImageAlt] = createSignal("");
  const [imageWidth, setImageWidth] = createSignal("200");

  let savedRange: Range | null = null;

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }

  function restoreSelection() {
    if (savedRange) {
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }
  }

  function syncContent() {
    if (!editorRef) return;
    const rawHtml = editorRef.innerHTML;
    const html = DOMPurify.sanitize(rawHtml);
    if (rawHtml !== html) {
      editorRef.innerHTML = html;
    }
    const text = editorRef.innerText || editorRef.textContent || "";
    setCurrentHtml(html);
    props.onChange?.({ html, text });
  }

  function handleFormat(command: string, value?: string) {
    if (editorRef) {
      editorRef.focus();
    }
    document.execCommand(command, false, value);
    syncContent();
  }

  function insertDivider() {
    if (editorRef) editorRef.focus();
    document.execCommand(
      "insertHTML",
      false,
      `<hr style="border: 0; border-top: 1px solid #E2DFD8; margin: 12px 0;" />`
    );
    syncContent();
  }

  function openLinkModal() {
    saveSelection();
    const sel = window.getSelection();
    setLinkText(sel ? sel.toString() : "");
    setLinkUrl("https://");
    setShowLinkModal(true);
  }

  function applyLink(e: Event) {
    e.preventDefault();
    restoreSelection();
    let url = linkUrl().trim();
    if (!url) {
      setShowLinkModal(false);
      return;
    }
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) {
      url = "https://" + url;
    }
    if (linkText().trim() && (!savedRange || savedRange.collapsed)) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.style.color = "#A27561";
      a.style.textDecoration = "underline";
      a.textContent = linkText().trim();
      const clean = DOMPurify.sanitize(a.outerHTML);
      document.execCommand("insertHTML", false, clean);
    } else {
      document.execCommand("createLink", false, url);
    }
    syncContent();
    setShowLinkModal(false);
  }

  function openImageModal() {
    saveSelection();
    setImageUrl("");
    setImageAlt("");
    setImageWidth("200");
    setShowImageModal(true);
  }

  function applyImage(e: Event) {
    e.preventDefault();
    restoreSelection();
    const url = imageUrl().trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      setShowImageModal(false);
      return;
    }
    const width = parseInt(imageWidth(), 10) || 200;
    const alt = imageAlt().trim() || "Embedded Image";
    const img = document.createElement("img");
    img.src = url;
    img.alt = alt;
    img.style.maxWidth = width + "px";
    img.style.height = "auto";
    img.style.borderRadius = "4px";
    img.style.display = "inline-block";
    img.style.verticalAlign = "middle";
    img.style.margin = "6px 0";
    const clean = DOMPurify.sanitize(img.outerHTML);
    document.execCommand("insertHTML", false, clean);
    syncContent();
    setShowImageModal(false);
  }

  function handleHtmlTextareaInput(val: string) {
    setCurrentHtml(val);
    const cleanHtml = DOMPurify.sanitize(val);
    const temp = document.createElement("div");
    temp.innerHTML = cleanHtml;
    const text = temp.innerText || temp.textContent || "";
    props.onChange?.({ html: cleanHtml, text });
    if (editorRef) {
      editorRef.innerHTML = cleanHtml;
    }
  }

  onMount(() => {
    if (editorRef && props.value) {
      editorRef.innerHTML = DOMPurify.sanitize(props.value);
    }
  });

  return (
    <div class={`flex flex-col border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden bg-white dark:bg-[#1E2025] ${props.class || ""}`}>
      {/* ── WYSIWYG Ribbon Bar ── */}
      <div class="flex flex-wrap items-center gap-0.5 sm:gap-1 p-1.5 bg-[#FAF9F6] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2E3138] select-none">
        {/* Bold */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("bold")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-xs font-bold text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Bold (Ctrl+B)"
        >
          B
        </button>

        {/* Italic */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("italic")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-xs italic font-serif text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Italic (Ctrl+I)"
        >
          I
        </button>

        {/* Underline */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("underline")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-xs underline text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Underline (Ctrl+U)"
        >
          U
        </button>

        {/* Strikethrough */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("strikeThrough")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-xs line-through text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Strikethrough"
        >
          S
        </button>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-1" />

        {/* Font Sizes */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("fontSize", "2")}
          class="px-1.5 h-7 flex items-center justify-center rounded-lg text-[11px] font-medium text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Small text"
        >
          Small
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("fontSize", "3")}
          class="px-1.5 h-7 flex items-center justify-center rounded-lg text-xs font-medium text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Normal text"
        >
          Normal
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("fontSize", "4")}
          class="px-1.5 h-7 flex items-center justify-center rounded-lg text-xs font-bold text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Large text"
        >
          Large
        </button>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-1" />

        {/* Unordered List */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("insertUnorderedList")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Bullet List"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <circle cx="4" cy="6" r="1.5" fill="currentColor" />
            <circle cx="4" cy="12" r="1.5" fill="currentColor" />
            <circle cx="4" cy="18" r="1.5" fill="currentColor" />
          </svg>
        </button>

        {/* Ordered List */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("insertOrderedList")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Numbered List"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <line x1="10" y1="6" x2="21" y2="6" />
            <line x1="10" y1="12" x2="21" y2="12" />
            <line x1="10" y1="18" x2="21" y2="18" />
            <path d="M4 6h2v-4" />
            <path d="M4 14h2.5c.8 0 1.5-.7 1.5-1.5s-.7-1.5-1.5-1.5H4" />
          </svg>
        </button>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-1" />

        {/* Link */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLinkModal}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Insert Link"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>

        {/* Image */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openImageModal}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Insert Image / Logo"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>

        {/* Divider */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertDivider}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Insert Divider"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
        </button>

        {/* Clear formatting */}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("removeFormat")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Clear Formatting"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M4 7V4h16v3" />
            <line x1="9" y1="20" x2="15" y2="20" />
            <line x1="12" y1="4" x2="12" y2="20" />
            <line x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </button>

        <div class="flex-1" />

        {/* Toggle HTML Code View */}
        <Show when={props.showHtmlToggle !== false}>
          <button
            type="button"
            onClick={() => {
              const next = !isHtmlMode();
              setIsHtmlMode(next);
              if (!next && editorRef) {
                editorRef.innerHTML = DOMPurify.sanitize(currentHtml());
              }
            }}
            class={`px-2.5 h-7 flex items-center gap-1 rounded-lg text-[11px] font-mono transition cursor-pointer ${
              isHtmlMode()
                ? "bg-[#A27561] text-white"
                : "text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6]"
            }`}
            title="Toggle HTML Source"
          >
            <svg class="w-3 h-3 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span>HTML</span>
          </button>
        </Show>
      </div>

      {/* ── Contenteditable Editor Area ── */}
      <div class="flex-1 min-h-0 relative">
        <Show
          when={!isHtmlMode()}
          fallback={
            <textarea
              placeholder={props.placeholder || "Enter HTML content…"}
              value={currentHtml()}
              onInput={(e) => handleHtmlTextareaInput(e.currentTarget.value)}
              class="w-full h-full p-3.5 bg-white dark:bg-[#1E2025] text-xs font-mono text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none resize-none"
              style={{
                "min-height": props.minHeight || "160px",
                "max-height": props.maxHeight || "none",
              }}
            />
          }
        >
          <div
            ref={(el) => {
              editorRef = el;
              if (el && currentHtml()) {
                el.innerHTML = DOMPurify.sanitize(currentHtml());
              }
            }}
            contenteditable="true"
            onInput={syncContent}
            data-placeholder={props.placeholder || "Write your message here…"}
            class={`w-full h-full p-3.5 bg-white dark:bg-[#1E2025] text-xs sm:text-sm text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none overflow-y-auto leading-relaxed break-words font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-[#878A8E] empty:before:pointer-events-none ${
              props.contentClass || ""
            }`}
            style={{
              "min-height": props.minHeight || "160px",
              "max-height": props.maxHeight || "none",
            }}
          />
        </Show>
      </div>

      {/* ── Insert Link Modal ── */}
      <Show when={showLinkModal()}>
        <div class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Insert Hyperlink</h3>
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                class="text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] p-1 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <form onSubmit={applyLink} class="space-y-3">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Text to Display
                </label>
                <input
                  type="text"
                  placeholder="e.g. Visit our website"
                  value={linkText()}
                  onInput={(e) => setLinkText(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                />
              </div>
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Link URL (href)
                </label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  value={linkUrl()}
                  onInput={(e) => setLinkUrl(e.currentTarget.value)}
                  required
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                />
              </div>
              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(false)}
                  class="px-3.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="px-4 py-1.5 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition cursor-pointer"
                >
                  Insert Link
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* ── Insert Image Modal ── */}
      <Show when={showImageModal()}>
        <div class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Insert Image</h3>
              <button
                type="button"
                onClick={() => setShowImageModal(false)}
                class="text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] p-1 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <form onSubmit={applyImage} class="space-y-3">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Image URL
                </label>
                <input
                  type="url"
                  placeholder="https://example.com/image.png"
                  value={imageUrl()}
                  onInput={(e) => setImageUrl(e.currentTarget.value)}
                  required
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                />
              </div>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                    Max Width (px)
                  </label>
                  <input
                    type="number"
                    min="30"
                    max="600"
                    value={imageWidth()}
                    onInput={(e) => setImageWidth(e.currentTarget.value)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                    Alt Text
                  </label>
                  <input
                    type="text"
                    placeholder="Image description"
                    value={imageAlt()}
                    onInput={(e) => setImageAlt(e.currentTarget.value)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                  />
                </div>
              </div>
              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImageModal(false)}
                  class="px-3.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="px-4 py-1.5 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition cursor-pointer"
                >
                  Insert Image
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};
