import { Component, createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import DOMPurify from "dompurify";
import { NoteItem, NoteChecklistItem, NOTE_COLORS } from "./notesStore";
import { NotesEditorToolbar } from "./NotesEditorToolbar";
import { NotesEmptyState } from "./NotesEmptyState";
import { formatFullDateTime } from "../../utils/dateTime";
import { cleanPastedContent } from "../../composer_sanitizer";
import {
  generatePdfFromNote,
  generateDocxFromNote,
  downloadDocumentFile,
  createDocumentExportFile,
  getSafeExportFilename,
} from "../../utils/documentExport";

export const NOTES_SANITIZER_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del",
    "a", "ul", "ol", "li", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6", "div", "span", "img"
  ],
  ALLOWED_ATTR: [
    "href", "target", "rel", "class", "title", "style",
    "src", "alt", "width", "height",
    "data-width", "data-height", "data-align", "data-display", "data-aspect-ratio",
    "data-wrap", "data-rotate", "data-crop", "data-href", "data-orig-width", "data-orig-height", "data-image-link"
  ],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|data|blob):|idb:)/i,
};

const ALLOWED_CSS_PROPS = new Set([
  "color",
  "font-size",
  "font-family",
  "text-align",
  "width",
  "height",
  "max-width",
  "max-height",
  "min-width",
  "margin",
  "margin-left",
  "margin-right",
  "margin-top",
  "margin-bottom",
  "display",
  "float",
  "clear",
  "transform",
  "clip-path",
  "object-fit",
  "object-position",
  "box-shadow",
  "border-radius",
  "cursor",
]);

let isSanitizerHookAdded = false;
function ensureSanitizerHook() {
  if (isSanitizerHookAdded || typeof DOMPurify.addHook !== "function") return;
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName === "style") {
      const rawStyle = data.attrValue || "";
      const declarations = rawStyle.split(";");
      const safeDeclarations: string[] = [];
      for (const decl of declarations) {
        const colonIdx = decl.indexOf(":");
        if (colonIdx === -1) continue;
        const prop = decl.substring(0, colonIdx).trim().toLowerCase();
        const val = decl.substring(colonIdx + 1).trim();
        if (/expression|javascript|behavior/i.test(val)) continue;
        if (ALLOWED_CSS_PROPS.has(prop)) {
          safeDeclarations.push(`${prop}: ${val}`);
        }
      }
      data.attrValue = safeDeclarations.join("; ");
    }
  });
  isSanitizerHookAdded = true;
}
ensureSanitizerHook();

export function sanitizeNotesHtml(raw: string): string {
  if (!raw) return "";
  return String(DOMPurify.sanitize(raw, NOTES_SANITIZER_CONFIG));
}

export interface NotesEditorProps {
  note: NoteItem | null;
  allLabels: string[];
  onUpdateNote: (patch: Partial<NoteItem>) => void;
  onTogglePin: () => void;
  onToggleFavorite: () => void;
  onDeleteNote: () => void;
  onDeleteForever?: () => void;
  onRestoreFromBin?: () => void;
  onArchiveNote: () => void;
  onUnarchiveNote?: () => void;
  onDuplicateNote?: () => void;
  onOpenDrawingModal?: () => void;
  onOpenVersionHistory?: () => void;
  onUploadImage?: (file: File) => void;
  onRemoveImage?: (index: number) => void;
  onRemoveDrawing?: (index: number) => void;
  resolveMediaUri: (uri: string) => string;
  saveStatus: "idle" | "saving" | "saved" | "failed";
  saveErrorMessage: string | null;
  syncStatus: string;
  onBackToNotesList?: () => void;
  onNewNote?: () => void;
  onShareViaMail?: (file: File, defaultSubject: string, defaultBody: string) => void;
  class?: string;
}

/**
 * Converts markdown or plaintext content to sanitized HTML for backward compatibility.
 * If content already contains HTML markup, it passes through DOMPurify directly.
 */
export function markdownToSanitizedHtml(raw: string): string {
  if (!raw) return "";

  // Check if content already contains rich HTML tags
  if (/<(p|b|strong|i|em|u|s|strike|del|h[1-6]|ul|ol|li|blockquote|pre|code|a|br|div|span|img)[^>]*>/i.test(raw)) {
    return sanitizeNotesHtml(raw);
  }

  const lines = raw.split("\n");
  const htmlLines: string[] = [];
  let inUl = false;
  let inOl = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    const isBullet = /^[\*\-\+]\s+(.*)$/.test(line);
    const isNumbered = /^\d+\.\s+(.*)$/.test(line);

    if (isBullet) {
      if (!inUl) {
        if (inOl) {
          htmlLines.push("</ol>");
          inOl = false;
        }
        htmlLines.push("<ul>");
        inUl = true;
      }
      line = line.replace(/^[\*\-\+]\s+(.*)$/, "<li>$1</li>");
    } else if (isNumbered) {
      if (!inOl) {
        if (inUl) {
          htmlLines.push("</ul>");
          inUl = false;
        }
        htmlLines.push("<ol>");
        inOl = true;
      }
      line = line.replace(/^\d+\.\s+(.*)$/, "<li>$1</li>");
    } else {
      if (inUl) {
        htmlLines.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        htmlLines.push("</ol>");
        inOl = false;
      }
    }

    if (/^###\s+(.*)$/.test(line)) {
      line = `<h3>${line.replace(/^###\s+/, "")}</h3>`;
    } else if (/^##\s+(.*)$/.test(line)) {
      line = `<h2>${line.replace(/^##\s+/, "")}</h2>`;
    } else if (/^#\s+(.*)$/.test(line)) {
      line = `<h1>${line.replace(/^#\s+/, "")}</h1>`;
    } else if (/^>\s+(.*)$/.test(line)) {
      line = `<blockquote>${line.replace(/^>\s+/, "")}</blockquote>`;
    } else if (!isBullet && !isNumbered) {
      if (line.trim() === "") {
        line = "<br>";
      } else {
        line = `<div>${line}</div>`;
      }
    }

    line = line
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/<u>([^<]+)<\/u>/g, "<u>$1</u>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    htmlLines.push(line);
  }

  if (inUl) htmlLines.push("</ul>");
  if (inOl) htmlLines.push("</ol>");

  return sanitizeNotesHtml(htmlLines.join(""));
}

export const NotesEditor: Component<NotesEditorProps> = (props) => {
  // Local reactive editing state synced with props.note
  const [title, setTitle] = createSignal("");
  const [content, setContent] = createSignal("");
  const [isChecklist, setIsChecklist] = createSignal(false);
  const [checklistItems, setChecklistItems] = createSignal<NoteChecklistItem[]>([]);
  const [color, setColor] = createSignal("default");
  const [labels, setLabels] = createSignal<string[]>([]);
  const [reminder, setReminder] = createSignal<number | null>(null);

  // Active toolbar formats state (e.g. bold, italic, underline, heading, etc.)
  const [activeFormats, setActiveFormats] = createSignal<Record<string, boolean>>({});
  const [currentFontFamily, setCurrentFontFamily] = createSignal<string>("sans");
  const [currentFontSize, setCurrentFontSize] = createSignal<string>("14px");
  const [currentColor, setCurrentColor] = createSignal<string>("#1A1B1E");
  const [currentAlign, setCurrentAlign] = createSignal<"left" | "center" | "right">("left");

  // Selected image and Word-style direct resizing state
  const [selectedImageEl, setSelectedImageEl] = createSignal<HTMLImageElement | null>(null);
  const [overlayRect, setOverlayRect] = createSignal<{
    top: number;
    left: number;
    width: number;
    height: number;
    naturalWidth: number;
    naturalHeight: number;
  } | null>(null);
  const [isResizing, setIsResizing] = createSignal(false);
  const [resizingDimensions, setResizingDimensions] = createSignal<{ width: number; height: number } | null>(null);

  // Picture formatting toolbar state
  const [currentImageWrap, setCurrentImageWrap] = createSignal<"inline" | "square" | "top-bottom">("inline");
  const [currentImageLink, setCurrentImageLink] = createSignal<string | null>(null);
  const [showCustomSizePopover, setShowCustomSizePopover] = createSignal(false);
  const [customWidthInput, setCustomWidthInput] = createSignal("400");
  const [customHeightInput, setCustomHeightInput] = createSignal("300");
  const [lockAspectRatio, setLockAspectRatio] = createSignal(true);
  const [showCropPopover, setShowCropPopover] = createSignal(false);
  const [cropTop, setCropTop] = createSignal(0);
  const [cropRight, setCropRight] = createSignal(0);
  const [cropBottom, setCropBottom] = createSignal(0);
  const [cropLeft, setCropLeft] = createSignal(0);
  const [showLinkPopover, setShowLinkPopover] = createSignal(false);
  const [imageLinkInput, setImageLinkInput] = createSignal("");
  const [imageLinkNewTab, setImageLinkNewTab] = createSignal(true);
  const [showAltTextPopover, setShowAltTextPopover] = createSignal(false);
  const [altTextInput, setAltTextInput] = createSignal("");

  // Popover menus state
  const [showPaletteMenu, setShowPaletteMenu] = createSignal(false);
  const [showReminderMenu, setShowReminderMenu] = createSignal(false);
  const [showLabelMenu, setShowLabelMenu] = createSignal(false);
  const [showMoreMenu, setShowMoreMenu] = createSignal(false);
  const [showShareModal, setShowShareModal] = createSignal(false);
  const [isExporting, setIsExporting] = createSignal(false);
  const [newLabelInput, setNewLabelInput] = createSignal("");

  // History for undo/redo state tracking
  const [history, setHistory] = createSignal<Array<{ title: string; content: string }>>([]);
  const [historyIdx, setHistoryIdx] = createSignal(-1);

  // Uninserted visual assets (images attached to the note but not yet embedded inline)
  const uninsertedImages = createMemo(() => {
    const allImgs = props.note?.images || [];
    const body = content() || "";
    return allImgs.filter((img) => {
      const resolved = props.resolveMediaUri(img);
      return !body.includes(img) && (!resolved || !body.includes(resolved));
    });
  });

  // DOM References
  let contentEditorRef: HTMLDivElement | undefined;
  let editorWrapperRef: HTMLDivElement | undefined;
  let scrollContainerRef: HTMLDivElement | undefined;
  let titleTextareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let replaceFileInputRef: HTMLInputElement | undefined;

  // Auto-resize the title textarea to fit multiline headings without horizontal scroll
  const adjustTitleHeight = () => {
    if (!titleTextareaRef) return;
    titleTextareaRef.style.height = "auto";
    const newHeight = Math.max(38, titleTextareaRef.scrollHeight);
    titleTextareaRef.style.height = `${newHeight}px`;
  };

  // Inspect current caret / selection in the editor to highlight toolbar buttons
  const updateActiveFormats = () => {
    if (!contentEditorRef) return;
    try {
      const formats: Record<string, boolean> = {
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strikethrough: document.queryCommandState("strikeThrough"),
        bullet: document.queryCommandState("insertUnorderedList"),
        numbered: document.queryCommandState("insertOrderedList"),
      };

      const blockVal = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      if (blockVal.includes("h1")) formats.h1 = true;
      if (blockVal.includes("h2")) formats.h2 = true;
      if (blockVal.includes("h3")) formats.h3 = true;
      if (blockVal.includes("blockquote")) formats.quote = true;
      if (blockVal.includes("pre")) formats.code = true;

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node: Node | null = sel.anchorNode;
        while (node && node !== contentEditorRef) {
          if (node instanceof HTMLElement) {
            const tag = node.tagName.toLowerCase();
            if (tag === "code") formats.code = true;
            if (node.style.textAlign) {
              const a = node.style.textAlign.toLowerCase();
              if (a === "center" || a === "right" || a === "left") setCurrentAlign(a as any);
            }
            if (node.getAttribute("data-align")) {
              const a = node.getAttribute("data-align")?.toLowerCase();
              if (a === "center" || a === "right" || a === "left") setCurrentAlign(a as any);
            }
            if (node.style.fontSize) {
              setCurrentFontSize(node.style.fontSize);
            }
            if (node.style.fontFamily) {
              const fam = node.style.fontFamily.toLowerCase();
              if (fam.includes("serif") && !fam.includes("sans")) setCurrentFontFamily("serif");
              else if (fam.includes("mono")) setCurrentFontFamily("mono");
              else setCurrentFontFamily("sans");
            }
            if (node.style.color) {
              setCurrentColor(node.style.color);
            }
          }
          node = node.parentNode;
        }
      }

      setActiveFormats(formats);
    } catch {
      // Ignore queryCommand errors when selection is outside
    }
  };

  // Measure and position the overlay exactly over selectedImageEl
  const updateOverlayRect = () => {
    const img = selectedImageEl();
    if (!img || !editorWrapperRef || !img.isConnected) {
      if (selectedImageEl()) {
        setSelectedImageEl(null);
        setOverlayRect(null);
      }
      return;
    }
    const imgRect = img.getBoundingClientRect();
    const wrapRect = editorWrapperRef.getBoundingClientRect();
    setOverlayRect({
      top: imgRect.top - wrapRect.top,
      left: imgRect.left - wrapRect.left,
      width: imgRect.width,
      height: imgRect.height,
      naturalWidth: img.naturalWidth || imgRect.width,
      naturalHeight: img.naturalHeight || imgRect.height,
    });
  };

  // Image Selection Management
  const handleSelectImage = (img: HTMLImageElement) => {
    setSelectedImageEl(img);
    const w = Math.round(img.clientWidth || img.naturalWidth || 400);
    const h = Math.round(img.clientHeight || img.naturalHeight || 300);
    setCustomWidthInput(w.toString());
    setCustomHeightInput(h.toString());
    setAltTextInput(img.getAttribute("alt") || "");
    const link = img.getAttribute("data-href") || img.closest("a")?.getAttribute("href") || "";
    setImageLinkInput(link);
    setCurrentImageLink(link || null);
    setCurrentImageWrap((img.getAttribute("data-wrap") || (img.style.float ? "square" : "inline")) as any);

    const crop = img.getAttribute("data-crop");
    if (crop) {
      const parts = crop.split(",").map((p) => parseFloat(p.trim()) || 0);
      setCropTop(parts[0] || 0);
      setCropRight(parts[1] || 0);
      setCropBottom(parts[2] || 0);
      setCropLeft(parts[3] || 0);
    } else {
      setCropTop(0);
      setCropRight(0);
      setCropBottom(0);
      setCropLeft(0);
    }

    queueMicrotask(() => {
      updateOverlayRect();
    });
  };

  const handleDeselectImage = () => {
    setSelectedImageEl(null);
    setOverlayRect(null);
    setShowCustomSizePopover(false);
    setShowCropPopover(false);
    setShowLinkPopover(false);
    setShowAltTextPopover(false);
  };

  // Selection change listener to keep toolbar buttons synced with caret position
  onMount(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && contentEditorRef && contentEditorRef.contains(sel.anchorNode)) {
        updateActiveFormats();
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("resize", adjustTitleHeight);

    const onScrollOrResize = () => {
      if (selectedImageEl()) {
        updateOverlayRect();
      }
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    const onGlobalClick = (e: MouseEvent) => {
      // If clicked outside contentEditorRef, outside floating controls, and outside popovers, deselect
      const target = e.target as HTMLElement;
      if (
        selectedImageEl() &&
        !target.closest("[data-testid='image-floating-controls']") &&
        !target.closest("[data-testid='image-selection-overlay']") &&
        !target.closest("[data-image-popover]") &&
        target !== selectedImageEl()
      ) {
        handleDeselectImage();
      }
    };
    document.addEventListener("mousedown", onGlobalClick);

    onCleanup(() => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("resize", adjustTitleHeight);
      document.removeEventListener("mousedown", onGlobalClick);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    });
  });

  // Track note id to reset local state when switching notes or when content rehydrates
  let currentNoteId: string | null = null;
  let lastLoadedContent: string | null = null;

  createEffect(() => {
    const n = props.note;
    if (n) {
      const isDifferentNote = currentNoteId !== n.id;
      const isContentDecryptedOrUpdated =
        !isDifferentNote &&
        n.content !== undefined &&
        n.content !== lastLoadedContent &&
        n.content !== content();

      if (isDifferentNote || isContentDecryptedOrUpdated) {
        currentNoteId = n.id;
        lastLoadedContent = n.content || "";
        setTitle(n.title || "");
        const formattedHtml = markdownToSanitizedHtml(n.content || "");
        setContent(formattedHtml);
        setIsChecklist(Boolean(n.isChecklist));
        setChecklistItems(n.checklistItems ? JSON.parse(JSON.stringify(n.checklistItems)) : []);
        setColor(n.color || "default");
        setLabels(n.labels ? [...n.labels] : []);
        setReminder(n.reminder?.timestamp || null);
        setHistory([{ title: n.title || "", content: formattedHtml }]);
        setHistoryIdx(0);
        handleDeselectImage();

        queueMicrotask(() => {
          if (contentEditorRef && currentNoteId === n.id) {
            contentEditorRef.innerHTML = formattedHtml;
          }
          adjustTitleHeight();
        });
      }
    } else {
      currentNoteId = null;
      lastLoadedContent = null;
      handleDeselectImage();
    }
  });

  // Debounced auto-save dispatcher
  let saveTimer: any = null;
  const triggerDebouncedSave = (immediatePatch?: Partial<NoteItem>) => {
    if (!props.note) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const rawContent = immediatePatch?.content !== undefined ? immediatePatch.content : content();
      const sanitized = sanitizeNotesHtml(rawContent);
      lastLoadedContent = sanitized;
      props.onUpdateNote({
        title: title(),
        content: sanitized,
        isChecklist: isChecklist(),
        checklistItems: checklistItems(),
        color: color(),
        labels: labels(),
        reminder: reminder() ? { timestamp: reminder()!, label: new Date(reminder()!).toLocaleDateString() } : null,
        ...immediatePatch,
        ...(immediatePatch?.content !== undefined ? { content: sanitized } : {}),
      });
    }, 350);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val);
    triggerDebouncedSave({ title: val });
  };

  const handleEditorInput = () => {
    if (!contentEditorRef) return;
    const rawHtml = contentEditorRef.innerHTML;
    setContent(rawHtml);
    triggerDebouncedSave({ content: rawHtml });
    updateActiveFormats();
  };

  const handleEditorPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const html = clipboardData.getData("text/html");
    const text = clipboardData.getData("text/plain");

    const cleaned = cleanPastedContent(html, text);
    if (!cleaned) return;

    let inserted = false;
    const sel = window.getSelection();
    if (contentEditorRef && sel && sel.rangeCount > 0 && contentEditorRef.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const fragment = range.createContextualFragment(cleaned);
      range.insertNode(fragment);
      inserted = true;
    }
    if (!inserted && contentEditorRef) {
      const fragment = document.createRange().createContextualFragment(cleaned);
      contentEditorRef.appendChild(fragment);
    }
    handleEditorInput();
  };

  // Word count & Char count based on human readable text
  const wordCount = createMemo(() => {
    let plainText = "";
    if (contentEditorRef) {
      plainText = contentEditorRef.innerText || contentEditorRef.textContent || "";
    } else {
      plainText = (content() || "").replace(/<[^>]+>/g, " ");
    }
    const text = (title() + " " + plainText).trim();
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  });

  const charCount = createMemo(() => {
    let plainText = "";
    if (contentEditorRef) {
      plainText = contentEditorRef.innerText || contentEditorRef.textContent || "";
    } else {
      plainText = (content() || "").replace(/<[^>]+>/g, "");
    }
    return (title() + plainText).length;
  });

  // Apply Document Styles (Alignment, Font size, Font family, Color)
  const applyAlignment = (align: "left" | "center" | "right") => {
    setCurrentAlign(align);
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !contentEditorRef) return;

    let node: Node | null = sel.anchorNode;
    let blockEl: HTMLElement | null = null;
    while (node && node !== contentEditorRef) {
      if (node instanceof HTMLElement) {
        const tag = node.tagName.toLowerCase();
        if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "div", "li"].includes(tag)) {
          blockEl = node;
          break;
        }
      }
      node = node.parentNode;
    }

    if (blockEl) {
      blockEl.style.textAlign = align;
      blockEl.setAttribute("data-align", align);
    } else {
      document.execCommand(
        align === "center" ? "justifyCenter" : align === "right" ? "justifyRight" : "justifyLeft",
        false
      );
    }
    handleEditorInput();
  };

  const applyInlineStyle = (prop: "fontSize" | "fontFamily" | "color", value: string) => {
    if (prop === "fontSize") setCurrentFontSize(value);
    if (prop === "fontFamily") {
      if (value.includes("serif") && !value.includes("sans")) setCurrentFontFamily("serif");
      else if (value.includes("mono")) setCurrentFontFamily("mono");
      else setCurrentFontFamily("sans");
    }
    if (prop === "color") setCurrentColor(value);

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !contentEditorRef) return;

    if (sel.isCollapsed) {
      let node: Node | null = sel.anchorNode;
      while (node && node !== contentEditorRef) {
        if (node instanceof HTMLElement && node.tagName.toLowerCase() === "span") {
          node.style[prop] = value;
          handleEditorInput();
          return;
        }
        node = node.parentNode;
      }
      return;
    }

    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.style[prop] = value;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    handleEditorInput();
  };

  // WYSIWYG Formatting tool execution
  const handleApplyFormat = (format: string, value?: string) => {
    if (!contentEditorRef) return;
    contentEditorRef.focus();

    if (format === "bold") {
      document.execCommand("bold", false);
    } else if (format === "italic") {
      document.execCommand("italic", false);
    } else if (format === "underline") {
      document.execCommand("underline", false);
    } else if (format === "strikethrough") {
      document.execCommand("strikeThrough", false);
    } else if (format === "p") {
      document.execCommand("formatBlock", false, "<p>");
    } else if (format === "h1") {
      const blockVal = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      document.execCommand("formatBlock", false, blockVal.includes("h1") ? "<p>" : "<h1>");
    } else if (format === "h2") {
      const blockVal = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      document.execCommand("formatBlock", false, blockVal.includes("h2") ? "<p>" : "<h2>");
    } else if (format === "h3") {
      const blockVal = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      document.execCommand("formatBlock", false, blockVal.includes("h3") ? "<p>" : "<h3>");
    } else if (format === "bullet") {
      document.execCommand("insertUnorderedList", false);
    } else if (format === "numbered") {
      document.execCommand("insertOrderedList", false);
    } else if (format === "checklist") {
      handleToggleChecklistMode();
      return;
    } else if (format === "quote") {
      const blockVal = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      document.execCommand("formatBlock", false, blockVal.includes("blockquote") ? "<p>" : "<blockquote>");
    } else if (format === "code") {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        let parent = range.commonAncestorContainer as HTMLElement;
        if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentElement as HTMLElement;
        if (parent && parent.closest("code")) {
          const codeEl = parent.closest("code")!;
          const textNode = document.createTextNode(codeEl.textContent || "");
          codeEl.parentNode?.replaceChild(textNode, codeEl);
        } else {
          const code = document.createElement("code");
          code.appendChild(range.extractContents());
          range.insertNode(code);
          sel.removeAllRanges();
          const newRange = document.createRange();
          newRange.selectNodeContents(code);
          sel.addRange(newRange);
        }
      } else {
        const blockVal = (document.queryCommandValue("formatBlock") || "").toLowerCase();
        document.execCommand("formatBlock", false, blockVal.includes("pre") ? "<p>" : "<pre>");
      }
    } else if (format === "link") {
      const url = window.prompt("Enter link URL:", "https://");
      if (url && url.trim()) {
        document.execCommand("createLink", false, url.trim());
      }
    } else if (format === "insertImage") {
      fileInputRef?.click();
      return;
    } else if (format === "align" && value) {
      applyAlignment(value as "left" | "center" | "right");
    } else if (format === "fontSize" && value) {
      applyInlineStyle("fontSize", value);
    } else if (format === "fontFamily" && value) {
      applyInlineStyle("fontFamily", value);
    } else if (format === "color" && value) {
      applyInlineStyle("color", value);
    }

    handleEditorInput();
  };

  // Insert image directly into editor canvas
  const insertInlineImage = (src: string) => {
    if (!contentEditorRef) return;
    contentEditorRef.focus();
    const imgHtml = `<img src="${src}" alt="Document Image" style="max-width: 100%; height: auto; display: block; margin: 16px auto;" data-align="center" data-wrap="inline" class="rounded-lg shadow-2xs my-3 cursor-pointer transition-shadow" />`;

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && contentEditorRef.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const frag = range.createContextualFragment(imgHtml);
      range.insertNode(frag);
    } else {
      const frag = document.createRange().createContextualFragment(imgHtml);
      contentEditorRef.appendChild(frag);
    }
    handleEditorInput();
  };

  // Direct Mouse / Pointer Drag Resizing with 8 Handles
  const startResize = (handle: string, e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const img = selectedImageEl();
    if (!img) return;

    const targetEl = e.currentTarget as HTMLElement;
    try {
      targetEl.setPointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = img.clientWidth || img.getBoundingClientRect().width;
    const startH = img.clientHeight || img.getBoundingClientRect().height;
    const aspect = startW / (startH || 1);
    const containerW = contentEditorRef?.clientWidth || 700;

    setIsResizing(true);
    setResizingDimensions({ width: Math.round(startW), height: Math.round(startH) });

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const deltaX = ev.clientX - startX;
      const deltaY = ev.clientY - startY;

      let newW = startW;
      let newH = startH;

      if (handle === "se" || handle === "ne" || handle === "sw" || handle === "nw") {
        // Proportional corner resize
        const dirX = handle === "se" || handle === "ne" ? 1 : -1;
        newW = Math.max(50, Math.min(startW + deltaX * dirX, containerW));
        newH = Math.round(newW / aspect);
      } else if (handle === "e" || handle === "w") {
        const dirX = handle === "e" ? 1 : -1;
        newW = Math.max(50, Math.min(startW + deltaX * dirX, containerW));
        newH = startH;
      } else if (handle === "s" || handle === "n") {
        const dirY = handle === "s" ? 1 : -1;
        newH = Math.max(30, startH + deltaY * dirY);
        newW = startW;
      }

      img.style.width = `${Math.round(newW)}px`;
      img.style.maxWidth = "100%";
      if (handle === "s" || handle === "n" || handle === "e" || handle === "w") {
        img.style.height = `${Math.round(newH)}px`;
      } else {
        img.style.height = "auto";
      }
      img.setAttribute("data-width", `${Math.round(newW)}px`);
      img.setAttribute("data-height", `${Math.round(newH)}px`);

      setResizingDimensions({ width: Math.round(newW), height: Math.round(newH) });
      updateOverlayRect();
    };

    const onPointerUp = (ev: PointerEvent) => {
      try {
        targetEl.releasePointerCapture(ev.pointerId);
      } catch {
        // Ignore
      }
      targetEl.removeEventListener("pointermove", onPointerMove);
      targetEl.removeEventListener("pointerup", onPointerUp);
      targetEl.removeEventListener("pointercancel", onPointerUp);
      setIsResizing(false);
      setResizingDimensions(null);
      handleEditorInput();
      updateOverlayRect();
    };

    targetEl.addEventListener("pointermove", onPointerMove);
    targetEl.addEventListener("pointerup", onPointerUp);
    targetEl.addEventListener("pointercancel", onPointerUp);
  };

  // Image Controls: Original Size, Fit to Width, Align, Wrap, Rotate, Crop, Link, Delete
  const handleImageOriginalSize = () => {
    const img = selectedImageEl();
    if (!img) return;
    img.style.width = "auto";
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.removeAttribute("width");
    img.removeAttribute("height");
    img.removeAttribute("data-width");
    img.removeAttribute("data-height");
    updateOverlayRect();
    handleEditorInput();
  };

  const handleImageFitWidth = () => {
    const img = selectedImageEl();
    if (!img) return;
    img.style.width = "100%";
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.setAttribute("data-width", "100%");
    updateOverlayRect();
    handleEditorInput();
  };

  const handleImageAlign = (align: "left" | "center" | "right") => {
    const img = selectedImageEl();
    if (!img) return;
    img.setAttribute("data-align", align);
    const wrap = img.getAttribute("data-wrap") || "inline";

    if (wrap === "square") {
      img.style.display = "inline-block";
      img.style.clear = "none";
      if (align === "right") {
        img.style.float = "right";
        img.style.margin = "8px 0 16px 20px";
      } else {
        img.style.float = "left";
        img.style.margin = "8px 20px 16px 0";
      }
    } else {
      img.style.display = "block";
      img.style.float = "none";
      img.style.clear = "both";
      if (align === "left") {
        img.style.marginLeft = "0";
        img.style.marginRight = "auto";
      } else if (align === "right") {
        img.style.marginLeft = "auto";
        img.style.marginRight = "0";
      } else {
        img.style.marginLeft = "auto";
        img.style.marginRight = "auto";
      }
    }

    updateOverlayRect();
    handleEditorInput();
  };

  const handleImageWrap = (wrap: "inline" | "square" | "top-bottom") => {
    const img = selectedImageEl();
    if (!img) return;
    const align = (img.getAttribute("data-align") || "center") as "left" | "center" | "right";
    setCurrentImageWrap(wrap);
    img.setAttribute("data-wrap", wrap);

    if (wrap === "square") {
      img.style.display = "inline-block";
      img.style.clear = "none";
      if (align === "right") {
        img.style.float = "right";
        img.style.margin = "8px 0 16px 20px";
      } else {
        img.style.float = "left";
        img.style.margin = "8px 20px 16px 0";
      }
    } else if (wrap === "top-bottom") {
      img.style.display = "block";
      img.style.float = "none";
      img.style.clear = "both";
      img.style.margin = "24px auto";
    } else {
      // inline (default)
      img.style.display = "block";
      img.style.float = "none";
      img.style.clear = "both";
      if (align === "left") {
        img.style.marginLeft = "0";
        img.style.marginRight = "auto";
      } else if (align === "right") {
        img.style.marginLeft = "auto";
        img.style.marginRight = "0";
      } else {
        img.style.marginLeft = "auto";
        img.style.marginRight = "auto";
      }
    }

    updateOverlayRect();
    handleEditorInput();
  };

  const handleImageRotate = (dir: "cw" | "ccw") => {
    const img = selectedImageEl();
    if (!img) return;
    const cur = parseInt(img.getAttribute("data-rotate") || "0", 10);
    const next = dir === "cw" ? (cur + 90) % 360 : (cur - 90 + 360) % 360;
    img.setAttribute("data-rotate", next.toString());
    img.style.transform = next ? `rotate(${next}deg)` : "none";
    updateOverlayRect();
    handleEditorInput();
  };

  const handleApplyCustomSize = (wStr: string, hStr: string) => {
    const img = selectedImageEl();
    if (!img) return;
    const w = parseInt(wStr, 10);
    const h = parseInt(hStr, 10);
    if (!isNaN(w) && w > 0) {
      img.style.width = `${w}px`;
      img.setAttribute("data-width", `${w}px`);
      if (!isNaN(h) && h > 0) {
        img.style.height = `${h}px`;
        img.setAttribute("data-height", `${h}px`);
      } else {
        img.style.height = "auto";
        img.removeAttribute("data-height");
      }
      updateOverlayRect();
      handleEditorInput();
    }
    setShowCustomSizePopover(false);
  };

  const handleApplyCrop = (top: number, right: number, bottom: number, left: number) => {
    const img = selectedImageEl();
    if (!img) return;
    if (top === 0 && right === 0 && bottom === 0 && left === 0) {
      img.style.clipPath = "none";
      img.removeAttribute("data-crop");
    } else {
      img.style.clipPath = `inset(${top}% ${right}% ${bottom}% ${left}%)`;
      img.setAttribute("data-crop", `${top},${right},${bottom},${left}`);
    }
    updateOverlayRect();
    handleEditorInput();
    setShowCropPopover(false);
  };

  const handleResetCrop = () => {
    const img = selectedImageEl();
    if (!img) return;
    img.style.clipPath = "none";
    img.removeAttribute("data-crop");
    setCropTop(0);
    setCropRight(0);
    setCropBottom(0);
    setCropLeft(0);
    updateOverlayRect();
    handleEditorInput();
    setShowCropPopover(false);
  };

  const handleApplyLink = (url: string, newTab: boolean) => {
    const img = selectedImageEl();
    if (!img) return;
    const trimmed = url.trim();
    if (!trimmed) {
      handleRemoveLink();
      setShowLinkPopover(false);
      return;
    }
    const isSafe = /^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed);
    if (!isSafe) {
      alert("Please enter a valid URL starting with https:// or http://");
      return;
    }

    const parentA = img.closest("a");
    if (parentA) {
      parentA.setAttribute("href", trimmed);
      if (newTab) {
        parentA.setAttribute("target", "_blank");
        parentA.setAttribute("rel", "noopener noreferrer");
      } else {
        parentA.removeAttribute("target");
        parentA.removeAttribute("rel");
      }
    } else {
      const a = document.createElement("a");
      a.href = trimmed;
      if (newTab) {
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.setAttribute("data-image-link", "true");
      img.parentNode?.insertBefore(a, img);
      a.appendChild(img);
    }
    img.setAttribute("data-href", trimmed);
    setCurrentImageLink(trimmed);
    updateOverlayRect();
    handleEditorInput();
    setShowLinkPopover(false);
  };

  const handleRemoveLink = () => {
    const img = selectedImageEl();
    if (!img) return;
    const parentA = img.closest("a");
    if (parentA) {
      parentA.parentNode?.insertBefore(img, parentA);
      parentA.parentNode?.removeChild(parentA);
    }
    img.removeAttribute("data-href");
    setCurrentImageLink(null);
    updateOverlayRect();
    handleEditorInput();
    setShowLinkPopover(false);
  };

  const handleApplyAltText = (alt: string) => {
    const img = selectedImageEl();
    if (!img) return;
    const trimmed = alt.trim();
    if (trimmed) {
      img.setAttribute("alt", trimmed);
      img.alt = trimmed;
    } else {
      img.removeAttribute("alt");
      img.alt = "";
    }
    handleEditorInput();
    setShowAltTextPopover(false);
  };

  const handleReplaceImage = (f: File) => {
    const img = selectedImageEl();
    if (!img) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      img.src = dataUrl;
      img.onload = () => {
        updateOverlayRect();
        handleEditorInput();
      };
      if (props.onUploadImage) {
        props.onUploadImage(f);
      }
    };
    reader.readAsDataURL(f);
  };

  const handleImageDelete = () => {
    const img = selectedImageEl();
    if (!img) return;
    const parentA = img.closest("a");
    if (parentA && parentA.querySelectorAll("img").length <= 1) {
      parentA.parentNode?.removeChild(parentA);
    } else {
      img.parentNode?.removeChild(img);
    }
    handleDeselectImage();
    handleEditorInput();
  };

  const handleImageResize = (factor: number) => {
    const img = selectedImageEl();
    if (!img || !contentEditorRef) return;
    const parentWidth = contentEditorRef.clientWidth || 700;
    const targetWidth = Math.round(parentWidth * factor);
    img.style.width = `${targetWidth}px`;
    img.style.maxWidth = "100%";
    img.style.height = "auto";
    img.setAttribute("data-width", `${targetWidth}px`);
    updateOverlayRect();
    handleEditorInput();
  };

  // Keyboard shortcuts handler
  const handleEditorKeyDown = (e: KeyboardEvent) => {
    if (selectedImageEl()) {
      const img = selectedImageEl()!;
      if (e.key === "Escape") {
        handleDeselectImage();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleImageDelete();
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 2 : 10;
        const curW = img.clientWidth;
        const delta = e.key === "ArrowRight" ? step : -step;
        const newW = Math.max(50, Math.min(curW + delta, contentEditorRef?.clientWidth || 700));
        img.style.width = `${newW}px`;
        img.style.height = "auto";
        img.setAttribute("data-width", `${newW}px`);
        updateOverlayRect();
        handleEditorInput();
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        document.execCommand("bold", false);
        handleEditorInput();
      } else if (key === "i") {
        e.preventDefault();
        document.execCommand("italic", false);
        handleEditorInput();
      } else if (key === "u") {
        e.preventDefault();
        document.execCommand("underline", false);
        handleEditorInput();
      }
    }
  };

  // Editor Click Listener to detect image selection
  const handleEditorClick = (e: MouseEvent) => {
    const target = e.target;
    if (target instanceof HTMLImageElement && contentEditorRef?.contains(target)) {
      e.preventDefault();
      e.stopPropagation();
      handleSelectImage(target);
    } else if (selectedImageEl()) {
      const isOverlay = (target as HTMLElement)?.closest?.("[data-testid='image-selection-overlay']");
      const isControls = (target as HTMLElement)?.closest?.("[data-testid='image-floating-controls']");
      const isPopover = (target as HTMLElement)?.closest?.("[data-image-popover]");
      if (!isOverlay && !isControls && !isPopover && target !== selectedImageEl()) {
        handleDeselectImage();
      }
    }
  };

  // Document Export & Mail Sharing Handlers
  const handleDownloadExport = async (format: "pdf" | "docx") => {
    if (!props.note) return;
    setIsExporting(true);
    try {
      const filename = getSafeExportFilename(props.note.title, format);
      const blob =
        format === "pdf"
          ? await generatePdfFromNote(props.note, props.resolveMediaUri)
          : await generateDocxFromNote(props.note, props.resolveMediaUri);
      downloadDocumentFile(blob, filename);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareDocument = async (format: "pdf" | "docx") => {
    if (!props.note) return;
    setIsExporting(true);
    try {
      const filename = getSafeExportFilename(props.note.title, format);
      const blob =
        format === "pdf"
          ? await generatePdfFromNote(props.note, props.resolveMediaUri)
          : await generateDocxFromNote(props.note, props.resolveMediaUri);
      const file = createDocumentExportFile(blob, filename);
      const subject = `Shared document: ${props.note.title || "Untitled Document"}`;
      const body = `Please find attached the document "${props.note.title || "Untitled Document"}" exported from BYOS Notes.`;
      props.onShareViaMail?.(file, subject, body);
      setShowShareModal(false);
    } catch (err) {
      console.error("Share via mail failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  // Checklists manipulation
  const handleToggleChecklistItem = (itemId: string) => {
    const next = checklistItems().map((it) =>
      it.id === itemId ? { ...it, completed: !it.completed } : it
    );
    setChecklistItems(next);
    triggerDebouncedSave({ checklistItems: next });
  };

  const handleUpdateChecklistItemText = (itemId: string, text: string) => {
    const next = checklistItems().map((it) =>
      it.id === itemId ? { ...it, text } : it
    );
    setChecklistItems(next);
    triggerDebouncedSave({ checklistItems: next });
  };

  const handleAddChecklistItem = () => {
    const newItem: NoteChecklistItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      text: "",
      completed: false,
    };
    const next = [...checklistItems(), newItem];
    setChecklistItems(next);
    triggerDebouncedSave({ checklistItems: next });
  };

  const handleRemoveChecklistItem = (itemId: string) => {
    const next = checklistItems().filter((it) => it.id !== itemId);
    setChecklistItems(next);
    triggerDebouncedSave({ checklistItems: next });
  };

  const handleToggleChecklistMode = () => {
    const nextMode = !isChecklist();
    setIsChecklist(nextMode);
    if (nextMode && checklistItems().length === 0) {
      const plainText = contentEditorRef ? (contentEditorRef.innerText || contentEditorRef.textContent || "") : content();
      const lines = plainText.split("\n").filter((l) => l.trim());
      if (lines.length > 0) {
        setChecklistItems(
          lines.map((l, i) => ({
            id: `item-${Date.now()}-${i}`,
            text: l.replace(/^[•\-\*]\s*/, ""),
            completed: false,
          }))
        );
      } else {
        setChecklistItems([{ id: `item-${Date.now()}`, text: "", completed: false }]);
      }
    }
    triggerDebouncedSave({ isChecklist: nextMode });
  };

  // Label management popover
  const handleToggleLabel = (lbl: string) => {
    let next: string[];
    if (labels().includes(lbl)) {
      next = labels().filter((l) => l !== lbl);
    } else {
      next = [...labels(), lbl];
    }
    setLabels(next);
    triggerDebouncedSave({ labels: next });
  };

  const handleCreateAndAddLabel = () => {
    const txt = newLabelInput().trim();
    if (!txt) return;
    if (!labels().includes(txt)) {
      const next = [...labels(), txt];
      setLabels(next);
      triggerDebouncedSave({ labels: next });
    }
    setNewLabelInput("");
  };

  const getColorTheme = () => {
    return NOTE_COLORS.find((c) => c.id === color()) || NOTE_COLORS[0];
  };

  const editorBgClass = () => {
    const theme = getColorTheme();
    if (theme.id === "default") {
      return "bg-[#FAF9F5] dark:bg-[#14161A]";
    }
    return `${theme.lightBg} ${theme.darkBg}`;
  };

  const formattedUpdatedTime = () => {
    if (!props.note?.updatedAt) return "Just now";
    return formatFullDateTime(new Date(props.note.updatedAt).toISOString());
  };

  return (
    <div
      data-testid="notes-editor-pane"
      class={`flex-1 min-w-0 min-h-0 h-full ${editorBgClass()} flex flex-col overflow-hidden relative transition-colors duration-200 ${
        props.class || ""
      }`}
    >
      <Show
        when={props.note}
        fallback={
          <NotesEmptyState
            type="no-selection"
            onNewNote={props.onNewNote}
          />
        }
      >
        {/* Hidden File Input for Image Uploads */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (props.onUploadImage) {
                props.onUploadImage(f);
              }
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                insertInlineImage(dataUrl);
              };
              reader.readAsDataURL(f);
            }
            if (e.target) e.target.value = "";
          }}
        />

        {/* Hidden File Input for Replacing Selected Image */}
        <input
          ref={replaceFileInputRef}
          type="file"
          accept="image/*"
          class="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && selectedImageEl()) {
              handleReplaceImage(f);
            }
            if (e.target) e.target.value = "";
          }}
        />

        {/* ── Top Header Actions Bar ── */}
        <div class="h-13 px-4 border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between gap-3 bg-white dark:bg-[#1E2025] flex-shrink-0 select-none">
          {/* Left: Mobile Back + Note Quick Actions */}
          <div class="flex items-center gap-1.5 min-w-0">
            {/* Mobile Back to Notes Button */}
            <Show when={props.onBackToNotesList}>
              <button
                type="button"
                onClick={props.onBackToNotesList}
                data-testid="notes-editor-back-btn"
                class="md:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#9E725F] dark:text-[#D4A38F] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span>Notes</span>
              </button>
            </Show>

            {/* Pin / Unpin Action */}
            <button
              type="button"
              onClick={props.onTogglePin}
              data-testid="notes-editor-pin-btn"
              title={props.note?.isPinned ? "Unpin note" : "Pin note"}
              class={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
                props.note?.isPinned
                  ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                  : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <line x1="12" y1="17" x2="12" y2="22" stroke-linecap="round" />
                <path
                  d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  fill={props.note?.isPinned ? "currentColor" : "none"}
                />
              </svg>
            </button>

            {/* Favorite Action */}
            <button
              type="button"
              onClick={props.onToggleFavorite}
              data-testid="notes-editor-favorite-btn"
              title={props.note?.isFavorite ? "Remove from favorites" : "Add to favorites"}
              class={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
                props.note?.isFavorite
                  ? "text-amber-500 hover:text-amber-600 bg-amber-50 dark:bg-amber-950/30"
                  : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <svg
                class="w-4 h-4"
                viewBox="0 0 24 24"
                fill={props.note?.isFavorite ? "currentColor" : "none"}
                stroke="currentColor"
                stroke-width="1.8"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </button>

            {/* Reminder Popover */}
            <div class="relative">
              <button
                type="button"
                onClick={() => setShowReminderMenu(!showReminderMenu())}
                data-testid="notes-editor-reminder-btn"
                title="Reminder"
                class={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
                  reminder()
                    ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                    : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              </button>

              <Show when={showReminderMenu()}>
                <div
                  class="absolute left-0 top-full mt-1.5 w-48 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg p-1.5 z-30 text-xs flex flex-col gap-1"
                  onClick={() => setShowReminderMenu(false)}
                >
                  <div class="text-[10px] font-mono text-[#878A8E] px-2 py-0.5 uppercase tracking-wider">
                    Set Reminder
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const tomorrow = Date.now() + 24 * 3600 * 1000;
                      setReminder(tomorrow);
                      triggerDebouncedSave({
                        reminder: { timestamp: tomorrow, label: "Tomorrow" },
                      });
                    }}
                    class="w-full text-left px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  >
                    Tomorrow 9:00 AM
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextWeek = Date.now() + 7 * 24 * 3600 * 1000;
                      setReminder(nextWeek);
                      triggerDebouncedSave({
                        reminder: { timestamp: nextWeek, label: "Next Week" },
                      });
                    }}
                    class="w-full text-left px-2 py-1 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                  >
                    Next Week
                  </button>
                  <Show when={reminder()}>
                    <button
                      type="button"
                      onClick={() => {
                        setReminder(null);
                        triggerDebouncedSave({ reminder: null });
                      }}
                      class="w-full text-left px-2 py-1 rounded text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer border-t border-[#E2DFD8] dark:border-[#2E3138] mt-0.5 pt-1"
                    >
                      Remove reminder
                    </button>
                  </Show>
                </div>
              </Show>
            </div>

            {/* Labels Popover */}
            <div class="relative">
              <button
                type="button"
                onClick={() => setShowLabelMenu(!showLabelMenu())}
                data-testid="notes-editor-labels-btn"
                title="Manage labels"
                class={`w-8 h-8 rounded-lg flex items-center justify-center transition cursor-pointer ${
                  labels().length > 0
                    ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F]"
                    : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                  <line x1="7" y1="7" x2="7.01" y2="7" />
                </svg>
              </button>

              <Show when={showLabelMenu()}>
                <div
                  class="absolute left-0 top-full mt-1.5 w-56 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl p-2 z-30 text-xs flex flex-col gap-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div class="text-[10px] font-mono text-[#878A8E] px-1 uppercase tracking-wider">
                    Note Labels
                  </div>
                  <div class="flex items-center gap-1">
                    <input
                      type="text"
                      placeholder="Add label…"
                      value={newLabelInput()}
                      onInput={(e) => setNewLabelInput(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateAndAddLabel();
                        }
                      }}
                      class="flex-1 px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F5] dark:bg-[#14161A] text-xs outline-none focus:ring-1 focus:ring-[#9E725F]"
                    />
                    <button
                      type="button"
                      onClick={handleCreateAndAddLabel}
                      class="px-2 py-1 bg-[#9E725F] text-white rounded-lg text-xs font-semibold hover:bg-[#865E4D] cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  <div class="max-h-40 overflow-y-auto space-y-0.5 custom-scrollbar pt-1">
                    <For each={props.allLabels}>
                      {(lbl) => (
                        <label class="flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-xs">
                          <input
                            type="checkbox"
                            checked={labels().includes(lbl)}
                            onChange={() => handleToggleLabel(lbl)}
                            class="w-3.5 h-3.5 rounded text-[#9E725F] cursor-pointer"
                          />
                          <span class="truncate">{lbl}</span>
                        </label>
                      )}
                    </For>
                    <Show when={props.allLabels.length === 0}>
                      <div class="px-2 py-1 text-xs text-[#878A8E] italic text-center">
                        No labels yet
                      </div>
                    </Show>
                  </div>
                </div>
              </Show>
            </div>

            {/* Color Palette Popover */}
            <div class="relative">
              <button
                type="button"
                onClick={() => setShowPaletteMenu(!showPaletteMenu())}
                data-testid="notes-editor-palette-btn"
                title="Note color"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="7" r="1.5" />
                  <circle cx="16.5" cy="10.5" r="1.5" />
                  <circle cx="16.5" cy="15.5" r="1.5" />
                  <circle cx="7.5" cy="10.5" r="1.5" />
                  <circle cx="7.5" cy="15.5" r="1.5" />
                </svg>
              </button>

              <Show when={showPaletteMenu()}>
                <div
                  data-testid="notes-color-picker-menu"
                  class="absolute left-0 top-full mt-1.5 p-2 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-lg flex items-center gap-1.5 z-30"
                  onClick={(e) => e.stopPropagation()}
                >
                  <For each={NOTE_COLORS}>
                    {(c) => (
                      <button
                        type="button"
                        onClick={() => {
                          setColor(c.id);
                          props.onUpdateNote({ color: c.id });
                          setShowPaletteMenu(false);
                        }}
                        title={c.name}
                        data-testid={`notes-color-option-${c.id}`}
                        class={`w-6 h-6 rounded-full border transition-transform hover:scale-110 cursor-pointer flex items-center justify-center ${
                          c.swatchClass
                        } ${color() === c.id ? "ring-2 ring-[#9E725F] ring-offset-1 scale-110" : ""}`}
                      >
                        <Show when={color() === c.id}>
                          <span class="w-1.5 h-1.5 rounded-full bg-[#9E725F] dark:bg-[#D4A38F]" />
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>

          {/* Right: Auto-save status + More Actions Menu */}
          <div class="flex items-center gap-2 flex-shrink-0">
            {/* Auto-save / Sync State Indicator */}
            <div class="flex items-center gap-1 text-xs text-[#878A8E] dark:text-[#A1A1AA]">
              <Show when={props.saveStatus === "saving"}>
                <span class="inline-flex items-center gap-1 text-[#9E725F] dark:text-[#D4A38F] font-medium">
                  <svg class="animate-spin w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <circle cx="12" cy="10" r="10" stroke-opacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <span>Saving…</span>
                </span>
              </Show>
              <Show when={props.saveStatus === "saved" || props.saveStatus === "idle"}>
                <span class="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">
                  <span>✓ Saved</span>
                </span>
              </Show>
              <Show when={props.saveStatus === "failed"}>
                <button
                  type="button"
                  onClick={() => triggerDebouncedSave()}
                  data-testid="notes-editor-save-failed-retry"
                  class="text-rose-600 dark:text-rose-400 font-medium text-[11px] hover:underline cursor-pointer flex items-center gap-1"
                  title={props.saveErrorMessage || "Save failed. Click to retry."}
                >
                  <span>⚠️ Save failed</span>
                </button>
              </Show>
            </div>

            {/* More Actions Overflow Menu */}
            <div class="relative">
              <button
                type="button"
                onClick={() => setShowMoreMenu(!showMoreMenu())}
                data-testid="notes-editor-more-btn"
                title="More note actions"
                class="w-8 h-8 rounded-lg flex items-center justify-center text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.25" fill="currentColor" />
                  <circle cx="12" cy="12" r="1.25" fill="currentColor" />
                  <circle cx="12" cy="19" r="1.25" fill="currentColor" />
                </svg>
              </button>

              <Show when={showMoreMenu()}>
                <div
                  class="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl p-1 z-30 text-xs flex flex-col gap-0.5"
                  onClick={() => setShowMoreMenu(false)}
                >
                  {/* Export to PDF */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoreMenu(false);
                      handleDownloadExport("pdf");
                    }}
                    data-testid="editor-menu-export-pdf"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                    <span>Download as PDF (.pdf)</span>
                  </button>

                  {/* Export to Word */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoreMenu(false);
                      handleDownloadExport("docx");
                    }}
                    data-testid="editor-menu-export-docx"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <path d="M4 4v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6a2 2 0 0 0-2 2z" />
                      <path d="M14 2v6h6" />
                      <path d="M8 13l2 5 2-5 2 5 2-5" />
                    </svg>
                    <span>Download as Word (.docx)</span>
                  </button>

                  {/* Share via Mail */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMoreMenu(false);
                      setShowShareModal(true);
                    }}
                    data-testid="editor-menu-share-mail"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium text-[#9E725F] dark:text-[#D4A38F]"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    <span>Share via BYOS Mail</span>
                  </button>

                  <div class="h-px bg-[#E2DFD8] dark:bg-[#2E3138] my-1" />

                  {/* Add Drawing */}
                  <button
                    type="button"
                    onClick={() => props.onOpenDrawingModal?.()}
                    data-testid="editor-menu-add-drawing"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                    <span>Add drawing</span>
                  </button>

                  {/* Add Image */}
                  <button
                    type="button"
                    onClick={() => fileInputRef?.click()}
                    data-testid="editor-menu-add-image"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                    <span>Attach / Insert image</span>
                  </button>

                  {/* Toggle Tick Boxes */}
                  <button
                    type="button"
                    onClick={handleToggleChecklistMode}
                    data-testid="editor-menu-toggle-checklist"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <polyline points="9 11 12 14 22 4" />
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                    </svg>
                    <span>{isChecklist() ? "Hide checkboxes" : "Show checkboxes"}</span>
                  </button>

                  {/* Duplicate Note */}
                  <button
                    type="button"
                    onClick={() => props.onDuplicateNote?.()}
                    data-testid="editor-menu-duplicate"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    <span>Make a copy</span>
                  </button>

                  {/* Version History */}
                  <button
                    type="button"
                    onClick={() => props.onOpenVersionHistory?.()}
                    data-testid="editor-menu-version-history"
                    class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                  >
                    <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 14 14" />
                    </svg>
                    <span>Version history</span>
                  </button>

                  <div class="h-px bg-[#E2DFD8] dark:bg-[#2E3138] my-1" />

                  {/* Archive / Unarchive */}
                  <Show
                    when={props.note?.isArchived}
                    fallback={
                      <button
                        type="button"
                        onClick={props.onArchiveNote}
                        data-testid="editor-menu-archive"
                        class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                      >
                        <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                          <polyline points="21 8 21 21 3 21 3 8" />
                          <rect x="1" y="3" width="22" height="5" />
                          <line x1="10" y1="12" x2="14" y2="12" />
                        </svg>
                        <span>Archive note</span>
                      </button>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => props.onUnarchiveNote?.()}
                      data-testid="editor-menu-unarchive"
                      class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                        <polyline points="21 8 21 21 3 21 3 8" />
                        <rect x="1" y="3" width="22" height="5" />
                        <line x1="10" y1="12" x2="14" y2="12" />
                      </svg>
                      <span>Unarchive note</span>
                    </button>
                  </Show>

                  {/* Delete or Restore Note */}
                  <Show
                    when={props.note?.isInBin}
                    fallback={
                      <button
                        type="button"
                        onClick={props.onDeleteNote}
                        data-testid="editor-menu-delete"
                        class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center gap-2 cursor-pointer font-medium"
                      >
                        <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                        <span>Move to trash</span>
                      </button>
                    }
                  >
                    <button
                      type="button"
                      onClick={() => props.onRestoreFromBin?.()}
                      data-testid="editor-menu-restore"
                      class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                        <polyline points="1 4 1 10 7 10" />
                        <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                      </svg>
                      <span>Restore from trash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onDeleteForever?.()}
                      data-testid="editor-menu-delete-forever"
                      class="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center gap-2 cursor-pointer font-medium"
                    >
                      <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                      <span>Delete forever</span>
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>

        {/* ── Rich-Text & Document Formatting Toolbar ── */}
        <NotesEditorToolbar
          onApplyFormat={handleApplyFormat}
          activeFormats={activeFormats()}
          currentFontFamily={currentFontFamily()}
          currentFontSize={currentFontSize()}
          currentColor={currentColor()}
          currentAlign={currentAlign()}
          onToggleChecklistMode={handleToggleChecklistMode}
          isChecklistMode={isChecklist()}
          wordCount={wordCount()}
          charCount={charCount()}
          onInsertImageClick={() => fileInputRef?.click()}
        />

        {/* ── Word-Style Picture Tools Bar (When an image is selected) ── */}
        <Show when={selectedImageEl()}>
          <div
            data-testid="image-floating-controls"
            class="sticky top-0 z-30 px-3 py-1.5 bg-[#FAF9F5] dark:bg-[#1E2025] border-b border-[#E2DFD8] dark:border-[#2E3138] shadow-xs flex items-center justify-between gap-2 flex-wrap text-xs select-none"
          >
            <div class="flex items-center gap-1 flex-wrap">
              {/* Category indicator */}
              <div class="flex items-center gap-1 font-semibold text-[#9E725F] dark:text-[#D4A38F] px-1 py-0.5 rounded text-[11px] uppercase tracking-wider">
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <span>Picture Tools</span>
              </div>

              <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

              {/* Sizing: Original Size */}
              <button
                type="button"
                onClick={handleImageOriginalSize}
                data-testid="image-control-original-size"
                title="Reset to Original Dimensions"
                class="px-2 py-1 rounded-md bg-black/5 dark:bg-white/5 hover:bg-[#F2E8E2] dark:hover:bg-[#2D2522] text-[#1A1B1E] dark:text-[#F3F4F6] font-medium transition cursor-pointer"
              >
                Original
              </button>

              {/* Sizing: Fit to Width */}
              <button
                type="button"
                onClick={handleImageFitWidth}
                data-testid="image-control-fit-width"
                title="Fit Image to Content Width"
                class="px-2 py-1 rounded-md bg-black/5 dark:bg-white/5 hover:bg-[#F2E8E2] dark:hover:bg-[#2D2522] text-[#1A1B1E] dark:text-[#F3F4F6] font-medium transition cursor-pointer"
              >
                Fit Width
              </button>

              {/* Sizing: Custom Size Popover Trigger */}
              <button
                type="button"
                onClick={() => {
                  setShowCustomSizePopover(!showCustomSizePopover());
                  setShowCropPopover(false);
                  setShowLinkPopover(false);
                  setShowAltTextPopover(false);
                }}
                data-testid="image-control-custom-size"
                title="Custom Dimensions"
                class={`px-2 py-1 rounded-md text-[#1A1B1E] dark:text-[#F3F4F6] font-medium transition cursor-pointer ${
                  showCustomSizePopover() ? "bg-[#9E725F] text-white" : "bg-black/5 dark:bg-white/5 hover:bg-[#F2E8E2] dark:hover:bg-[#2D2522]"
                }`}
              >
                Custom…
              </button>

              <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

              {/* Alignment */}
              <div class="flex items-center rounded-lg bg-black/5 dark:bg-white/5 p-0.5">
                <button
                  type="button"
                  onClick={() => handleImageAlign("left")}
                  data-testid="image-control-align-left"
                  title="Align Left"
                  class="w-6 h-6 rounded flex items-center justify-center hover:bg-white dark:hover:bg-[#2E3138] transition cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <line x1="17" y1="10" x2="3" y2="10" />
                    <line x1="21" y1="6" x2="3" y2="6" />
                    <line x1="21" y1="14" x2="3" y2="14" />
                    <line x1="17" y1="18" x2="3" y2="18" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleImageAlign("center")}
                  data-testid="image-control-align-center"
                  title="Align Center"
                  class="w-6 h-6 rounded flex items-center justify-center hover:bg-white dark:hover:bg-[#2E3138] transition cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <line x1="18" y1="10" x2="6" y2="10" />
                    <line x1="21" y1="6" x2="3" y2="6" />
                    <line x1="21" y1="14" x2="3" y2="14" />
                    <line x1="18" y1="18" x2="6" y2="18" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleImageAlign("right")}
                  data-testid="image-control-align-right"
                  title="Align Right"
                  class="w-6 h-6 rounded flex items-center justify-center hover:bg-white dark:hover:bg-[#2E3138] transition cursor-pointer"
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

              {/* Text Wrapping */}
              <div class="flex items-center rounded-lg bg-black/5 dark:bg-white/5 p-0.5">
                <button
                  type="button"
                  onClick={() => handleImageWrap("inline")}
                  data-testid="image-control-wrap-inline"
                  title="Wrap: In Line with Text"
                  class={`px-1.5 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                    currentImageWrap() === "inline"
                      ? "bg-white dark:bg-[#2E3138] text-[#9E725F] dark:text-[#D4A38F] shadow-2xs font-bold"
                      : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-white"
                  }`}
                >
                  Inline
                </button>
                <button
                  type="button"
                  onClick={() => handleImageWrap("square")}
                  data-testid="image-control-wrap-square"
                  title="Wrap: Square (Text wraps around)"
                  class={`px-1.5 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                    currentImageWrap() === "square"
                      ? "bg-white dark:bg-[#2E3138] text-[#9E725F] dark:text-[#D4A38F] shadow-2xs font-bold"
                      : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-white"
                  }`}
                >
                  Square
                </button>
                <button
                  type="button"
                  onClick={() => handleImageWrap("top-bottom")}
                  data-testid="image-control-wrap-top-bottom"
                  title="Wrap: Top and Bottom"
                  class={`px-1.5 py-0.5 rounded text-[11px] font-medium transition cursor-pointer ${
                    currentImageWrap() === "top-bottom"
                      ? "bg-white dark:bg-[#2E3138] text-[#9E725F] dark:text-[#D4A38F] shadow-2xs font-bold"
                      : "text-[#6F7173] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-white"
                  }`}
                >
                  Top/Bottom
                </button>
              </div>

              <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

              {/* Rotation */}
              <button
                type="button"
                onClick={() => handleImageRotate("ccw")}
                data-testid="image-control-rotate-ccw"
                title="Rotate 90° CCW"
                class="w-6 h-6 rounded hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center transition cursor-pointer text-[#3C3D3E] dark:text-[#E2DFD8]"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleImageRotate("cw")}
                data-testid="image-control-rotate-cw"
                title="Rotate 90° CW"
                class="w-6 h-6 rounded hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center transition cursor-pointer text-[#3C3D3E] dark:text-[#E2DFD8]"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                </svg>
              </button>

              <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-0.5" />

              {/* Visual Crop */}
              <button
                type="button"
                onClick={() => {
                  setShowCropPopover(!showCropPopover());
                  setShowCustomSizePopover(false);
                  setShowLinkPopover(false);
                  setShowAltTextPopover(false);
                }}
                data-testid="image-control-crop"
                title="Visual Crop"
                class={`px-2 py-1 rounded-md text-[#1A1B1E] dark:text-[#F3F4F6] font-medium transition cursor-pointer flex items-center gap-1 ${
                  showCropPopover() ? "bg-[#9E725F] text-white" : "hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 2v14a2 2 0 0 0 2 2h14"/>
                  <path d="M18 22V8a2 2 0 0 0-2-2H2"/>
                </svg>
                <span>Crop</span>
              </button>

              {/* Hyperlink */}
              <button
                type="button"
                onClick={() => {
                  setShowLinkPopover(!showLinkPopover());
                  setShowCustomSizePopover(false);
                  setShowCropPopover(false);
                  setShowAltTextPopover(false);
                }}
                data-testid="image-control-link"
                title="Hyperlink Image"
                class={`px-2 py-1 rounded-md text-[#1A1B1E] dark:text-[#F3F4F6] font-medium transition cursor-pointer flex items-center gap-1 ${
                  currentImageLink() || showLinkPopover()
                    ? "bg-[#9E725F] text-white"
                    : "hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <span>Link{currentImageLink() ? " ✓" : ""}</span>
              </button>

              {/* Alt Text */}
              <button
                type="button"
                onClick={() => {
                  setShowAltTextPopover(!showAltTextPopover());
                  setShowCustomSizePopover(false);
                  setShowCropPopover(false);
                  setShowLinkPopover(false);
                }}
                data-testid="image-control-alt"
                title="Edit Alternative Text"
                class={`px-2 py-1 rounded-md text-[#1A1B1E] dark:text-[#F3F4F6] font-medium transition cursor-pointer flex items-center gap-1 ${
                  showAltTextPopover() ? "bg-[#9E725F] text-white" : "hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <span>Alt</span>
              </button>

              {/* Replace Image */}
              <button
                type="button"
                onClick={() => replaceFileInputRef?.click()}
                data-testid="image-control-replace"
                title="Replace with another image"
                class="px-2 py-1 rounded-md text-[#1A1B1E] dark:text-[#F3F4F6] font-medium transition cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              >
                Replace…
              </button>
            </div>

            <div class="flex items-center gap-1">
              {/* Delete */}
              <button
                type="button"
                onClick={handleImageDelete}
                data-testid="image-control-delete"
                title="Remove image from document"
                class="px-2 py-1 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 font-medium transition cursor-pointer flex items-center gap-1"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <span>Remove</span>
              </button>

              {/* Deselect / Close */}
              <button
                type="button"
                onClick={handleDeselectImage}
                title="Done"
                class="w-6 h-6 rounded-full hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-center text-xs text-[#878A8E] cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        </Show>

        {/* Custom Size Popover */}
        <Show when={selectedImageEl() && showCustomSizePopover()}>
          <div
            data-testid="image-custom-size-popover"
            data-image-popover="true"
            class="sticky top-11 z-30 mx-4 my-1 p-3 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-lg max-w-xs space-y-2.5 text-xs"
          >
            <div class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Custom Image Dimensions</div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[10px] text-[#878A8E] block mb-0.5">Width (px)</label>
                <input
                  type="number"
                  value={customWidthInput()}
                  onInput={(e) => {
                    const val = e.currentTarget.value;
                    setCustomWidthInput(val);
                    if (lockAspectRatio() && selectedImageEl()) {
                      const curImg = selectedImageEl()!;
                      const naturalRatio = (curImg.naturalWidth || 400) / (curImg.naturalHeight || 300);
                      const parsed = parseInt(val, 10);
                      if (!isNaN(parsed) && parsed > 0) {
                        setCustomHeightInput(Math.round(parsed / naturalRatio).toString());
                      }
                    }
                  }}
                  data-testid="image-custom-width-input"
                  class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded font-mono text-xs outline-none"
                />
              </div>
              <div>
                <label class="text-[10px] text-[#878A8E] block mb-0.5">Height (px)</label>
                <input
                  type="number"
                  value={customHeightInput()}
                  onInput={(e) => {
                    const val = e.currentTarget.value;
                    setCustomHeightInput(val);
                    if (lockAspectRatio() && selectedImageEl()) {
                      const curImg = selectedImageEl()!;
                      const naturalRatio = (curImg.naturalWidth || 400) / (curImg.naturalHeight || 300);
                      const parsed = parseInt(val, 10);
                      if (!isNaN(parsed) && parsed > 0) {
                        setCustomWidthInput(Math.round(parsed * naturalRatio).toString());
                      }
                    }
                  }}
                  data-testid="image-custom-height-input"
                  class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded font-mono text-xs outline-none"
                />
              </div>
            </div>
            <div class="flex items-center gap-1.5 pt-1">
              <input
                type="checkbox"
                id="lock-aspect"
                checked={lockAspectRatio()}
                onChange={(e) => setLockAspectRatio(e.currentTarget.checked)}
                class="rounded text-[#9E725F]"
              />
              <label for="lock-aspect" class="text-[11px] text-[#6F7173] dark:text-[#A1A1AA] cursor-pointer">
                Lock Aspect Ratio
              </label>
            </div>
            <div class="flex items-center justify-end gap-2 pt-1 border-t border-[#E2DFD8] dark:border-[#2E3138]">
              <button
                type="button"
                onClick={() => setShowCustomSizePopover(false)}
                class="px-2 py-1 text-xs text-[#878A8E] hover:text-[#1A1B1E] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleApplyCustomSize(customWidthInput(), customHeightInput())}
                data-testid="image-custom-size-apply"
                class="px-3 py-1 rounded bg-[#9E725F] hover:bg-[#8A6352] text-white font-medium text-xs cursor-pointer shadow-2xs"
              >
                Apply Size
              </button>
            </div>
          </div>
        </Show>

        {/* Crop Popover */}
        <Show when={selectedImageEl() && showCropPopover()}>
          <div
            data-testid="image-crop-popover"
            data-image-popover="true"
            class="sticky top-11 z-30 mx-4 my-1 p-3 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-lg max-w-sm space-y-2.5 text-xs"
          >
            <div class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Visual Crop (Insets %)</div>
            <div class="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <label class="text-[#878A8E] block">Top (%)</label>
                <input
                  type="number"
                  min="0"
                  max="49"
                  value={cropTop()}
                  onInput={(e) => setCropTop(Math.max(0, Math.min(49, parseInt(e.currentTarget.value, 10) || 0)))}
                  data-testid="image-crop-top"
                  class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded font-mono outline-none"
                />
              </div>
              <div>
                <label class="text-[#878A8E] block">Right (%)</label>
                <input
                  type="number"
                  min="0"
                  max="49"
                  value={cropRight()}
                  onInput={(e) => setCropRight(Math.max(0, Math.min(49, parseInt(e.currentTarget.value, 10) || 0)))}
                  data-testid="image-crop-right"
                  class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded font-mono outline-none"
                />
              </div>
              <div>
                <label class="text-[#878A8E] block">Bottom (%)</label>
                <input
                  type="number"
                  min="0"
                  max="49"
                  value={cropBottom()}
                  onInput={(e) => setCropBottom(Math.max(0, Math.min(49, parseInt(e.currentTarget.value, 10) || 0)))}
                  data-testid="image-crop-bottom"
                  class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded font-mono outline-none"
                />
              </div>
              <div>
                <label class="text-[#878A8E] block">Left (%)</label>
                <input
                  type="number"
                  min="0"
                  max="49"
                  value={cropLeft()}
                  onInput={(e) => setCropLeft(Math.max(0, Math.min(49, parseInt(e.currentTarget.value, 10) || 0)))}
                  data-testid="image-crop-left"
                  class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded font-mono outline-none"
                />
              </div>
            </div>
            <div class="flex items-center justify-between gap-2 pt-1 border-t border-[#E2DFD8] dark:border-[#2E3138]">
              <button
                type="button"
                onClick={handleResetCrop}
                data-testid="image-crop-reset"
                class="px-2 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded cursor-pointer"
              >
                Reset Crop
              </button>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCropPopover(false)}
                  class="px-2 py-1 text-xs text-[#878A8E] hover:text-[#1A1B1E] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyCrop(cropTop(), cropRight(), cropBottom(), cropLeft())}
                  data-testid="image-crop-apply"
                  class="px-3 py-1 rounded bg-[#9E725F] hover:bg-[#8A6352] text-white font-medium text-xs cursor-pointer shadow-2xs"
                >
                  Apply Crop
                </button>
              </div>
            </div>
          </div>
        </Show>

        {/* Hyperlink Popover */}
        <Show when={selectedImageEl() && showLinkPopover()}>
          <div
            data-testid="image-link-popover"
            data-image-popover="true"
            class="sticky top-11 z-30 mx-4 my-1 p-3 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-lg max-w-sm space-y-2.5 text-xs"
          >
            <div class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Picture Hyperlink</div>
            <div>
              <label class="text-[10px] text-[#878A8E] block mb-0.5">Target Web Address (URL)</label>
              <input
                type="url"
                placeholder="https://example.com"
                value={imageLinkInput()}
                onInput={(e) => setImageLinkInput(e.currentTarget.value)}
                data-testid="image-link-url-input"
                class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded text-xs outline-none font-mono"
              />
            </div>
            <div class="flex items-center gap-1.5 pt-0.5">
              <input
                type="checkbox"
                id="link-new-tab"
                checked={imageLinkNewTab()}
                onChange={(e) => setImageLinkNewTab(e.currentTarget.checked)}
                data-testid="image-link-new-tab"
                class="rounded text-[#9E725F]"
              />
              <label for="link-new-tab" class="text-[11px] text-[#6F7173] dark:text-[#A1A1AA] cursor-pointer">
                Open in new browser tab
              </label>
            </div>
            <div class="flex items-center justify-between gap-2 pt-1 border-t border-[#E2DFD8] dark:border-[#2E3138]">
              <Show when={currentImageLink()}>
                <button
                  type="button"
                  onClick={handleRemoveLink}
                  data-testid="image-link-remove"
                  class="px-2 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded cursor-pointer"
                >
                  Remove Link
                </button>
              </Show>
              <div class="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setShowLinkPopover(false)}
                  class="px-2 py-1 text-xs text-[#878A8E] hover:text-[#1A1B1E] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleApplyLink(imageLinkInput(), imageLinkNewTab())}
                  data-testid="image-link-apply"
                  class="px-3 py-1 rounded bg-[#9E725F] hover:bg-[#8A6352] text-white font-medium text-xs cursor-pointer shadow-2xs"
                >
                  Apply Link
                </button>
              </div>
            </div>
          </div>
        </Show>

        {/* Alt Text Popover */}
        <Show when={selectedImageEl() && showAltTextPopover()}>
          <div
            data-testid="image-alt-popover"
            data-image-popover="true"
            class="sticky top-11 z-30 mx-4 my-1 p-3 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-lg max-w-sm space-y-2.5 text-xs"
          >
            <div class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">Alternative Text (Alt Text)</div>
            <div>
              <label class="text-[10px] text-[#878A8E] block mb-0.5">Describe image content for accessibility and screen readers</label>
              <input
                type="text"
                placeholder="Brief visual description…"
                value={altTextInput()}
                onInput={(e) => setAltTextInput(e.currentTarget.value)}
                data-testid="image-alt-input"
                class="w-full px-2 py-1 bg-black/5 dark:bg-white/5 border border-[#E2DFD8] dark:border-[#2E3138] rounded text-xs outline-none"
              />
            </div>
            <div class="flex items-center justify-end gap-2 pt-1 border-t border-[#E2DFD8] dark:border-[#2E3138]">
              <button
                type="button"
                onClick={() => setShowAltTextPopover(false)}
                class="px-2 py-1 text-xs text-[#878A8E] hover:text-[#1A1B1E] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleApplyAltText(altTextInput())}
                data-testid="image-alt-apply"
                class="px-3 py-1 rounded bg-[#9E725F] hover:bg-[#8A6352] text-white font-medium text-xs cursor-pointer shadow-2xs"
              >
                Apply
              </button>
            </div>
          </div>
        </Show>

        {/* ── Main Scrollable Note Body Container ── */}
        <div
          ref={(el) => (scrollContainerRef = el)}
          class="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 custom-scrollbar"
        >
          <div class="max-w-5xl mx-auto space-y-4">
            {/* Title Textarea with multiline auto-expand */}
            <textarea
              ref={(el) => {
                titleTextareaRef = el;
                adjustTitleHeight();
              }}
              value={title()}
              onInput={(e) => {
                handleTitleChange(e.currentTarget.value);
                adjustTitleHeight();
              }}
              placeholder="Title"
              rows={1}
              data-testid="notes-editor-title-input"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  contentEditorRef?.focus();
                }
              }}
              class="w-full text-2xl md:text-3xl font-bold bg-transparent border-none outline-none resize-none overflow-hidden text-[#1A1B1E] dark:text-[#F3F4F6] placeholder:text-[#A1A1AA] pb-1 leading-tight tracking-tight break-words block"
            />

            {/* Labels Chips Display */}
            <Show when={labels().length > 0}>
              <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
                <For each={labels()}>
                  {(lbl) => (
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] border border-[#E2DFD8]/60 dark:border-[#3D322E]">
                      <span>{lbl}</span>
                      <button
                        type="button"
                        onClick={() => handleToggleLabel(lbl)}
                        class="hover:text-rose-600 cursor-pointer text-xs"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </Show>

            {/* Attached Drawings Gallery */}
            <Show when={(props.note?.drawings || []).length > 0}>
              <div class="space-y-2 pt-2">
                <div class="text-[11px] font-mono text-[#878A8E] uppercase tracking-wider">Drawings</div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <For each={props.note!.drawings!}>
                    {(drw, idx) => (
                      <div class="relative group rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden bg-white shadow-2xs">
                        <img
                          src={props.resolveMediaUri(drw)}
                          alt="Drawing"
                          class="w-full h-32 object-contain bg-white p-2"
                        />
                        <button
                          type="button"
                          onClick={() => props.onRemoveDrawing?.(idx())}
                          class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* Note Body: Checklist Mode vs WYSIWYG ContentEditable Surface */}
            <Show
              when={isChecklist()}
              fallback={
                <div ref={(el) => (editorWrapperRef = el)} class="relative w-full">
                  <div
                    ref={(el) => {
                      contentEditorRef = el;
                      if (el) {
                        el.innerHTML = markdownToSanitizedHtml(content());
                      }
                    }}
                    contentEditable={true}
                    data-testid="notes-editor-content-input"
                    data-placeholder="Start writing or format text…"
                    onInput={handleEditorInput}
                    onPaste={handleEditorPaste}
                    onKeyDown={handleEditorKeyDown}
                    onClick={handleEditorClick}
                    onKeyUp={updateActiveFormats}
                    onMouseUp={updateActiveFormats}
                    class="w-full min-h-[420px] bg-transparent border-none outline-none text-sm md:text-base leading-relaxed text-[#1A1B1E] dark:text-[#F3F4F6] placeholder:text-[#A1A1AA] font-sans break-words focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-[#A1A1AA] empty:before:pointer-events-none [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_li]:my-0.5 [&_blockquote]:border-l-4 [&_blockquote]:border-[#9E725F] [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-[#6F7173] dark:[&_blockquote]:text-[#A1A1AA] [&_blockquote]:my-2 [&_pre]:bg-black/5 dark:[&_pre]:bg-white/5 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:font-mono [&_pre]:text-xs [&_pre]:overflow-x-auto [&_pre]:my-2 [&_code]:bg-black/5 dark:[&_code]:bg-white/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:font-mono [&_code]:text-xs [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-[#1A1B1E] dark:[&_h1]:text-[#F3F4F6] [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-[#1A1B1E] dark:[&_h2]:text-[#F3F4F6] [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-[#1A1B1E] dark:[&_h3]:text-[#F3F4F6] [&_h3]:mt-2 [&_h3]:mb-1 [&_a]:text-[#9E725F] dark:[&_a]:text-[#D4A38F] [&_a]:underline cursor-text"
                  />

                  {/* Word-Style Detached Image Selection Overlay & 8 Handles */}
                  <Show when={selectedImageEl() && overlayRect()}>
                    <div
                      data-testid="image-selection-overlay"
                      class="absolute pointer-events-none z-10"
                      style={{
                        left: `${overlayRect()!.left}px`,
                        top: `${overlayRect()!.top}px`,
                        width: `${overlayRect()!.width}px`,
                        height: `${overlayRect()!.height}px`,
                        outline: "2px solid #9E725F",
                        "outline-offset": "2px",
                      }}
                    >
                      {/* Live Dimension Badge */}
                      <Show when={isResizing() && resizingDimensions()}>
                        <div
                          data-testid="image-dimension-badge"
                          class="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/85 text-white text-[10px] font-mono font-medium shadow pointer-events-none select-none z-20"
                        >
                          {resizingDimensions()!.width} × {resizingDimensions()!.height} px
                        </div>
                      </Show>

                      {/* Quick Link Badge */}
                      <Show when={currentImageLink()}>
                        <div
                          data-testid="image-link-badge"
                          class="absolute top-2 left-2 max-w-[200px] truncate px-2 py-0.5 rounded bg-black/85 hover:bg-black text-white text-[10px] font-sans font-medium shadow pointer-events-auto cursor-pointer z-20 flex items-center gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowLinkPopover(true);
                          }}
                          title={currentImageLink()!}
                        >
                          <span>🔗 {currentImageLink()}</span>
                        </div>
                      </Show>

                      {/* NW Handle */}
                      <div
                        data-testid="image-handle-nw"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-nwse-resize z-20"
                        style={{ top: "-5px", left: "-5px" }}
                        onPointerDown={(e) => startResize("nw", e)}
                      />
                      {/* N Handle */}
                      <div
                        data-testid="image-handle-n"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-ns-resize z-20"
                        style={{ top: "-5px", left: "calc(50% - 5px)" }}
                        onPointerDown={(e) => startResize("n", e)}
                      />
                      {/* NE Handle */}
                      <div
                        data-testid="image-handle-ne"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-nesw-resize z-20"
                        style={{ top: "-5px", right: "-5px" }}
                        onPointerDown={(e) => startResize("ne", e)}
                      />
                      {/* E Handle */}
                      <div
                        data-testid="image-handle-e"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-ew-resize z-20"
                        style={{ top: "calc(50% - 5px)", right: "-5px" }}
                        onPointerDown={(e) => startResize("e", e)}
                      />
                      {/* SE Handle */}
                      <div
                        data-testid="image-handle-se"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-nwse-resize z-20"
                        style={{ bottom: "-5px", right: "-5px" }}
                        onPointerDown={(e) => startResize("se", e)}
                      />
                      {/* S Handle */}
                      <div
                        data-testid="image-handle-s"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-ns-resize z-20"
                        style={{ bottom: "-5px", left: "calc(50% - 5px)" }}
                        onPointerDown={(e) => startResize("s", e)}
                      />
                      {/* SW Handle */}
                      <div
                        data-testid="image-handle-sw"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-nesw-resize z-20"
                        style={{ bottom: "-5px", left: "-5px" }}
                        onPointerDown={(e) => startResize("sw", e)}
                      />
                      {/* W Handle */}
                      <div
                        data-testid="image-handle-w"
                        class="absolute w-2.5 h-2.5 bg-white border border-[#9E725F] rounded-xs shadow-xs pointer-events-auto cursor-ew-resize z-20"
                        style={{ top: "calc(50% - 5px)", left: "-5px" }}
                        onPointerDown={(e) => startResize("w", e)}
                      />
                    </div>
                  </Show>
                </div>
              }
            >
              {/* Checklist Mode Interface */}
              <div class="space-y-2 pt-2" data-testid="notes-editor-checklist-items">
                <For each={checklistItems()}>
                  {(item) => (
                    <div class="flex items-center gap-2 group/item">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => handleToggleChecklistItem(item.id)}
                        class="w-4 h-4 rounded text-[#9E725F] cursor-pointer"
                      />
                      <input
                        type="text"
                        value={item.text}
                        onInput={(e) => handleUpdateChecklistItemText(item.id, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddChecklistItem();
                          }
                        }}
                        placeholder="List item"
                        class={`flex-1 bg-transparent border-none outline-none text-sm leading-relaxed ${
                          item.completed
                            ? "line-through text-[#878A8E] dark:text-[#6F7173]"
                            : "text-[#1A1B1E] dark:text-[#F3F4F6]"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveChecklistItem(item.id)}
                        class="opacity-0 group-hover/item:opacity-100 text-[#878A8E] hover:text-rose-600 transition cursor-pointer px-1 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </For>

                <button
                  type="button"
                  onClick={handleAddChecklistItem}
                  data-testid="notes-editor-add-checklist-item-btn"
                  class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#9E725F] dark:text-[#D4A38F] hover:bg-[#F2E8E2] dark:hover:bg-[#2D2522] rounded-lg transition cursor-pointer mt-2"
                >
                  <span>+ Add item</span>
                </button>
              </div>
            </Show>

            {/* Uninserted Images Tray (Only shows images NOT yet inserted into document body) */}
            <Show when={uninsertedImages().length > 0}>
              <div
                data-testid="uninserted-images-tray"
                class="mt-8 pt-4 border-t border-[#E2DFD8] dark:border-[#2E3138] space-y-2"
              >
                <div class="text-[11px] font-mono text-[#878A8E] uppercase tracking-wider flex items-center justify-between">
                  <span>Uninserted Attachments ({uninsertedImages().length})</span>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <For each={uninsertedImages()}>
                    {(img, idx) => (
                      <div class="relative group rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden bg-white dark:bg-[#1E2025] shadow-2xs p-2 flex flex-col items-center">
                        <img
                          src={props.resolveMediaUri(img)}
                          alt="Attachment"
                          class="max-h-36 w-auto object-contain mx-auto rounded-lg"
                        />
                        <div class="flex items-center justify-between w-full mt-2 pt-2 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                          <button
                            type="button"
                            onClick={() => insertInlineImage(props.resolveMediaUri(img))}
                            data-testid="gallery-insert-note-btn"
                            class="px-2 py-1 rounded bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] text-[11px] font-medium hover:bg-[#9E725F] hover:text-white transition cursor-pointer"
                          >
                            + Insert into document
                          </button>
                          <button
                            type="button"
                            onClick={() => props.onRemoveImage?.(idx())}
                            class="text-[#878A8E] hover:text-rose-600 transition cursor-pointer text-xs px-2"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* ── Share via BYOS Mail Modal ── */}
        <Show when={showShareModal()}>
          <div
            data-testid="notes-share-mail-modal"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
            onClick={() => setShowShareModal(false)}
          >
            <div
              class="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div class="flex items-center justify-between">
                <div class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6] flex items-center gap-2">
                  <svg class="w-4 h-4 text-[#9E725F]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                  <span>Share Note via BYOS Mail</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  class="text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-white cursor-pointer text-sm"
                >
                  ✕
                </button>
              </div>

              <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA]">
                Export this note into a document and attach it directly to a new encrypted email draft.
              </p>

              <div class="space-y-2 pt-1">
                {/* PDF Option */}
                <button
                  type="button"
                  onClick={() => handleShareDocument("pdf")}
                  disabled={isExporting()}
                  data-testid="share-mail-pdf-btn"
                  class="w-full text-left p-3 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#9E725F] dark:hover:border-[#D4A38F] hover:bg-[#FAF9F5] dark:hover:bg-[#14161A] transition cursor-pointer flex items-center justify-between group"
                >
                  <div class="flex items-center gap-3">
                    <span class="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 flex items-center justify-center font-bold text-xs">
                      PDF
                    </span>
                    <div>
                      <div class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] group-hover:text-[#9E725F]">
                        PDF Document (.pdf)
                      </div>
                      <div class="text-[11px] text-[#878A8E]">Read-only formatted document</div>
                    </div>
                  </div>
                  <svg class="w-4 h-4 text-[#878A8E] group-hover:translate-x-0.5 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>

                {/* Word DOCX Option */}
                <button
                  type="button"
                  onClick={() => handleShareDocument("docx")}
                  disabled={isExporting()}
                  data-testid="share-mail-docx-btn"
                  class="w-full text-left p-3 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#9E725F] dark:hover:border-[#D4A38F] hover:bg-[#FAF9F5] dark:hover:bg-[#14161A] transition cursor-pointer flex items-center justify-between group"
                >
                  <div class="flex items-center gap-3">
                    <span class="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs">
                      DOC
                    </span>
                    <div>
                      <div class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] group-hover:text-[#9E725F]">
                        Word Document (.docx)
                      </div>
                      <div class="text-[11px] text-[#878A8E]">Editable OpenXML Word document</div>
                    </div>
                  </div>
                  <svg class="w-4 h-4 text-[#878A8E] group-hover:translate-x-0.5 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>

              <div class="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowShareModal(false)}
                  class="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#6F7173] dark:text-[#A1A1AA] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </Show>

        {/* ── Editor Footer / Status Bar ── */}
        <div class="h-9 px-4 border-t border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between text-[11px] font-mono text-[#878A8E] dark:text-[#6F7173] bg-[#FAF9F5]/90 dark:bg-[#18191D]/90 select-none flex-shrink-0">
          <div class="flex items-center gap-3">
            <span>Last updated {formattedUpdatedTime()}</span>
          </div>

          <div class="flex items-center gap-3">
            <span class="inline-flex items-center gap-1 text-[#9E725F] dark:text-[#D4A38F]">
              <span>🔒 Zero-Knowledge Encrypted</span>
            </span>
            <span class="capitalize">Sync: {props.syncStatus}</span>
          </div>
        </div>
      </Show>
    </div>
  );
};
