import { Component, createSignal, onMount, onCleanup, createEffect, Show, For } from "solid-js";
import DOMPurify from "dompurify";
import { cleanPastedContent, sanitizeOnReceive } from "../composer_sanitizer";
import { highlightCodeBlocks } from "../utils/code_highlight";

export interface RichTextEditorProps {
  value?: string;
  placeholder?: string;
  onChange?: (data: { html: string; text: string }) => void;
  minHeight?: string;
  maxHeight?: string;
  class?: string;
  contentClass?: string;
  showHtmlToggle?: boolean;
  onUploadInlineImage?: (file: File) => Promise<{ storageRef: string; alt?: string; localUrl?: string }>;
}

const SUPPORTED_LANGUAGES = [
  { id: "plaintext", label: "Plain Text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "bash", label: "Bash / Shell" },
  { id: "sql", label: "SQL" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
];

export const RichTextEditor: Component<RichTextEditorProps> = (props) => {
  let editorRef: HTMLDivElement | undefined;
  let previewRef: HTMLDivElement | undefined;
  let imageFileInputRef: HTMLInputElement | undefined;

  const [isHtmlMode, setIsHtmlMode] = createSignal(false);
  const [isPreviewMode, setIsPreviewMode] = createSignal(false);
  const [currentHtml, setCurrentHtml] = createSignal(props.value || "");

  // Link Dialog Modal
  const [showLinkModal, setShowLinkModal] = createSignal(false);
  const [linkUrl, setLinkUrl] = createSignal("https://");
  const [linkText, setLinkText] = createSignal("");

  // Table Dialog Modal
  const [showTableModal, setShowTableModal] = createSignal(false);
  const [tableRows, setTableRows] = createSignal(3);
  const [tableCols, setTableCols] = createSignal(2);
  const [tableHeader, setTableHeader] = createSignal(true);

  // Caret Context Signals
  const [isInTable, setIsInTable] = createSignal(false);
  const [activeTableElement, setActiveTableElement] = createSignal<HTMLTableElement | null>(null);
  const [activeCellElement, setActiveCellElement] = createSignal<HTMLTableCellElement | null>(null);

  const [isInCodeBlock, setIsInCodeBlock] = createSignal(false);
  const [activeCodeElement, setActiveCodeElement] = createSignal<HTMLElement | null>(null);
  const [currentCodeLang, setCurrentCodeLang] = createSignal("plaintext");

  // Error toast / banner for inline images
  const [imageError, setImageError] = createSignal<string | null>(null);

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
    // Don't re-sanitize immediately during every keystroke if it would destroy cursor,
    // but normalize and record state
    const text = editorRef.innerText || editorRef.textContent || "";
    setCurrentHtml(rawHtml);
    props.onChange?.({ html: rawHtml, text });
  }

  function updateCaretContext() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef) {
      setIsInTable(false);
      setActiveTableElement(null);
      setActiveCellElement(null);
      setIsInCodeBlock(false);
      setActiveCodeElement(null);
      return;
    }

    let node: Node | null = sel.anchorNode;
    let foundCell: HTMLTableCellElement | null = null;
    let foundTable: HTMLTableElement | null = null;
    let foundCode: HTMLElement | null = null;

    while (node && node !== editorRef) {
      if (node instanceof HTMLTableCellElement) {
        foundCell = node;
      }
      if (node instanceof HTMLTableElement) {
        foundTable = node;
      }
      if (
        node instanceof HTMLElement &&
        (node.tagName.toLowerCase() === "code" || node.tagName.toLowerCase() === "pre")
      ) {
        foundCode = node;
      }
      node = node.parentNode;
    }

    setActiveCellElement(foundCell);
    setActiveTableElement(foundTable);
    setIsInTable(Boolean(foundTable));

    if (foundCode) {
      const codeEl =
        foundCode.tagName.toLowerCase() === "code"
          ? foundCode
          : (foundCode.querySelector("code") || foundCode);
      setActiveCodeElement(codeEl as HTMLElement);
      setIsInCodeBlock(true);

      const cls = codeEl.className || "";
      const match = cls.match(/language-([a-z0-9_-]+)/i);
      const dataLang = codeEl.getAttribute("data-language");
      const lang = dataLang || (match ? match[1] : "plaintext");
      setCurrentCodeLang(lang);
    } else {
      setActiveCodeElement(null);
      setIsInCodeBlock(false);
    }
  }

  function handleFormat(command: string, value?: string) {
    if (editorRef) {
      editorRef.focus();
    }
    document.execCommand(command, false, value);
    syncContent();
    updateCaretContext();
  }

  function insertHorizontalRule() {
    if (editorRef) editorRef.focus();
    saveSelection();
    restoreSelection();
    document.execCommand(
      "insertHTML",
      false,
      `<hr class="my-3 border-t border-[#E2DFD8] dark:border-[#2E3138]" />`
    );
    syncContent();
    updateCaretContext();
  }

  function insertInlineCode() {
    if (editorRef) editorRef.focus();
    saveSelection();
    restoreSelection();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const code = document.createElement("code");
      code.className = "bg-[#F0EEE9] dark:bg-[#26282E] px-1 py-0.5 rounded font-mono text-xs";
      code.appendChild(range.extractContents());
      range.insertNode(code);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.selectNodeContents(code);
      sel.addRange(newRange);
      syncContent();
      updateCaretContext();
    } else if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const code = document.createElement("code");
      code.className = "bg-[#F0EEE9] dark:bg-[#26282E] px-1 py-0.5 rounded font-mono text-xs";
      code.textContent = "code";
      range.insertNode(code);
      syncContent();
      updateCaretContext();
    }
  }

  function insertCodeBlock() {
    if (editorRef) editorRef.focus();
    saveSelection();
    restoreSelection();
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString() : "";

    const pre = document.createElement("pre");
    pre.className = "bg-[#F8F7F4] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-lg p-3 my-3 font-mono text-xs";

    const code = document.createElement("code");
    code.className = "language-plaintext";
    code.setAttribute("data-language", "plaintext");
    code.textContent = selectedText || "// Type code here\n";
    pre.appendChild(code);

    let inserted = false;
    if (editorRef) {
      if (savedRange && editorRef.contains(savedRange.commonAncestorContainer)) {
        restoreSelection();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          const hasTextSel = !range.collapsed && selectedText && range.commonAncestorContainer.nodeType === Node.TEXT_NODE;
          if (hasTextSel) {
            range.deleteContents();
          } else {
            range.collapse(false);
          }
          range.insertNode(pre);

          const p = document.createElement("p");
          p.innerHTML = "<br>";
          if (pre.nextSibling) {
            pre.parentNode?.insertBefore(p, pre.nextSibling);
          } else {
            pre.parentNode?.appendChild(p);
          }
          inserted = true;
        }
      }
      if (!inserted) {
        editorRef.appendChild(pre);
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        editorRef.appendChild(p);
      }
      editorRef.focus();
    }

    // Position caret inside code element and set active state
    try {
      const newRange = document.createRange();
      newRange.selectNodeContents(code);
      newRange.collapse(false);
      const sel2 = window.getSelection();
      if (sel2) {
        sel2.removeAllRanges();
        sel2.addRange(newRange);
      }
    } catch {}
    savedRange = null;
    setActiveCodeElement(code);
    setIsInCodeBlock(true);
    setCurrentCodeLang("plaintext");

    syncContent();
  }

  function handleLanguageChange(newLang: string) {
    setCurrentCodeLang(newLang);
    const code = activeCodeElement();
    if (code) {
      code.className = `language-${newLang}`;
      code.setAttribute("data-language", newLang);
      syncContent();
    }
  }

  // ── Table Insertion & Context Actions ──

  function openTableModal() {
    saveSelection();
    setTableRows(3);
    setTableCols(2);
    setTableHeader(true);
    setShowTableModal(true);
  }

  function applyInsertTable(e: Event) {
    e.preventDefault();
    restoreSelection();
    const rows = Math.max(1, tableRows());
    const cols = Math.max(1, tableCols());
    const withHeader = tableHeader();

    const table = document.createElement("table");
    table.className = "w-full my-3 border-collapse border border-[#E2DFD8] dark:border-[#2E3138]";

    if (withHeader) {
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c++) {
        const th = document.createElement("th");
        th.className = "border border-[#E2DFD8] dark:border-[#2E3138] p-2 bg-[#FAF9F6] dark:bg-[#18191D] font-bold text-left";
        th.textContent = `Header ${c + 1}`;
        tr.appendChild(th);
      }
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    const tbody = document.createElement("tbody");
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c++) {
        const td = document.createElement("td");
        td.className = "border border-[#E2DFD8] dark:border-[#2E3138] p-2";
        td.textContent = `Cell ${r + 1},${c + 1}`;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    let inserted = false;
    if (editorRef) {
      if (savedRange && editorRef.contains(savedRange.commonAncestorContainer)) {
        restoreSelection();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.collapse(false);
          range.insertNode(table);

          const p = document.createElement("p");
          p.innerHTML = "<br>";
          if (table.nextSibling) {
            table.parentNode?.insertBefore(p, table.nextSibling);
          } else {
            table.parentNode?.appendChild(p);
          }
          inserted = true;
        }
      }
      if (!inserted) {
        editorRef.appendChild(table);
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        editorRef.appendChild(p);
      }
      editorRef.focus();
    }

    savedRange = null;
    syncContent();
    setShowTableModal(false);
    updateCaretContext();
  }

  function addRow(position: "above" | "below") {
    const cell = activeCellElement();
    if (!cell) return;
    const tr = cell.closest("tr");
    if (!tr || !tr.parentElement) return;

    const colCount = tr.children.length;
    const newTr = document.createElement("tr");
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement("td");
      td.className = "border border-[#E2DFD8] dark:border-[#2E3138] p-2";
      td.innerHTML = "<br>";
      newTr.appendChild(td);
    }

    if (position === "above") {
      tr.parentElement.insertBefore(newTr, tr);
    } else {
      tr.parentElement.insertBefore(newTr, tr.nextSibling);
    }
    syncContent();
    updateCaretContext();
  }

  function addColumn(position: "left" | "right") {
    const cell = activeCellElement();
    const table = activeTableElement();
    if (!cell || !table) return;

    const colIndex = cell.cellIndex;
    const allRows = table.querySelectorAll("tr");

    allRows.forEach((row) => {
      const isHeaderRow = row.parentElement?.tagName.toLowerCase() === "thead";
      const newCell = document.createElement(isHeaderRow ? "th" : "td");
      newCell.className = `border border-[#E2DFD8] dark:border-[#2E3138] p-2 ${
        isHeaderRow ? "bg-[#FAF9F6] dark:bg-[#18191D] font-bold text-left" : ""
      }`;
      newCell.innerHTML = "<br>";

      const targetCell = row.children[colIndex];
      if (position === "left") {
        row.insertBefore(newCell, targetCell);
      } else {
        row.insertBefore(newCell, targetCell ? targetCell.nextSibling : null);
      }
    });

    syncContent();
    updateCaretContext();
  }

  function deleteRow() {
    const cell = activeCellElement();
    const table = activeTableElement();
    if (!cell || !table) return;

    const tr = cell.closest("tr");
    if (tr) {
      tr.remove();
      const remainingRows = table.querySelectorAll("tr");
      if (remainingRows.length === 0) {
        table.remove();
      }
    }
    syncContent();
    updateCaretContext();
  }

  function deleteColumn() {
    const cell = activeCellElement();
    const table = activeTableElement();
    if (!cell || !table) return;

    const colIndex = cell.cellIndex;
    const allRows = table.querySelectorAll("tr");
    allRows.forEach((row) => {
      if (row.children[colIndex]) {
        row.children[colIndex].remove();
      }
    });

    const firstRow = table.querySelector("tr");
    if (!firstRow || firstRow.children.length === 0) {
      table.remove();
    }
    syncContent();
    updateCaretContext();
  }

  function toggleHeaderRow() {
    const table = activeTableElement();
    if (!table) return;

    const thead = table.querySelector("thead");
    if (thead) {
      // Remove header, convert th to td into tbody
      const tbody = table.querySelector("tbody") || table;
      const theadRows = Array.from(thead.querySelectorAll("tr"));
      theadRows.forEach((row) => {
        Array.from(row.querySelectorAll("th")).forEach((th) => {
          const td = document.createElement("td");
          td.className = "border border-[#E2DFD8] dark:border-[#2E3138] p-2";
          td.innerHTML = th.innerHTML;
          row.replaceChild(td, th);
        });
        tbody.insertBefore(row, tbody.firstChild);
      });
      thead.remove();
    } else {
      // Convert first row of tbody into thead
      const firstRow = table.querySelector("tr");
      if (firstRow) {
        const newThead = document.createElement("thead");
        Array.from(firstRow.querySelectorAll("td")).forEach((td) => {
          const th = document.createElement("th");
          th.className = "border border-[#E2DFD8] dark:border-[#2E3138] p-2 bg-[#FAF9F6] dark:bg-[#18191D] font-bold text-left";
          th.innerHTML = td.innerHTML;
          firstRow.replaceChild(th, td);
        });
        firstRow.remove();
        newThead.appendChild(firstRow);
        table.insertBefore(newThead, table.firstChild);
      }
    }
    syncContent();
    updateCaretContext();
  }

  // ── Hyperlink Modal ──

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
      a.className = "text-[#A27561] underline hover:text-[#8F6452]";
      a.textContent = linkText().trim();
      const clean = DOMPurify.sanitize(a.outerHTML);
      document.execCommand("insertHTML", false, clean);
    } else {
      const tempA = document.createElement("a");
      tempA.href = url;
      document.execCommand("createLink", false, tempA.href);
    }
    syncContent();
    setShowLinkModal(false);
    updateCaretContext();
  }

  // ── Inline Image Embedding ──

  async function handleImageFileSelected(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = ""; // reset input so same file can be selected again
    setImageError(null);
    if (!file) return;

    // Enforce 2 MB limit
    if (file.size > 2 * 1024 * 1024) {
      setImageError("Image exceeds 2 MB limit.");
      return;
    }

    // Enforce max 5 images per message
    if (editorRef) {
      const existingImages = editorRef.querySelectorAll("img").length;
      if (existingImages >= 5) {
        setImageError("Maximum 5 inline images per message.");
        return;
      }
    }

    if (editorRef) editorRef.focus();
    restoreSelection();

    let storageRef = "";
    let altText = file.name;
    let localUrl = "";

    if (props.onUploadInlineImage) {
      try {
        const uploadRes = await props.onUploadInlineImage(file);
        storageRef = uploadRes.storageRef;
        if (uploadRes.alt) altText = uploadRes.alt;
        if (uploadRes.localUrl) localUrl = uploadRes.localUrl;
      } catch (err: any) {
        console.warn("Upload inline image error:", err);
      }
    }

    if (!storageRef) {
      // Fallback to data URL
      localUrl = URL.createObjectURL(file);
      storageRef = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
    }

    const img = document.createElement("img");
    img.src = storageRef;
    img.alt = altText;
    if (localUrl) img.setAttribute("data-local-src", localUrl);
    img.className = "max-w-full h-auto rounded-lg my-2 inline-block align-middle";
    img.style.maxWidth = "100%";
    img.style.height = "auto";

    let inserted = false;
    if (editorRef) {
      if (savedRange && editorRef.contains(savedRange.commonAncestorContainer)) {
        restoreSelection();
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.collapse(false);
          range.insertNode(img);

          const p = document.createElement("p");
          p.innerHTML = "<br>";
          if (img.nextSibling) {
            img.parentNode?.insertBefore(p, img.nextSibling);
          } else {
            img.parentNode?.appendChild(p);
          }
          inserted = true;
        }
      }
      if (!inserted) {
        editorRef.appendChild(img);
        const p = document.createElement("p");
        p.innerHTML = "<br>";
        editorRef.appendChild(p);
      }
      editorRef.focus();
    }

    savedRange = null;
    syncContent();
    updateCaretContext();
  }

  // ── Clipboard Paste Interception ──

  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const html = clipboardData.getData("text/html");
    const text = clipboardData.getData("text/plain");

    const cleaned = cleanPastedContent(html, text);
    if (!cleaned) return;

    let inserted = false;
    const sel = window.getSelection();
    if (editorRef && sel && sel.rangeCount > 0 && editorRef.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const fragment = range.createContextualFragment(cleaned);
      range.insertNode(fragment);
      inserted = true;
    }
    if (!inserted && editorRef) {
      const fragment = document.createRange().createContextualFragment(cleaned);
      editorRef.appendChild(fragment);
    }
    syncContent();
    updateCaretContext();
  }

  // ── Keyboard Shortcuts ──

  function handleEditorKeyDown(e: KeyboardEvent) {
    const isCtrlOrMeta = e.ctrlKey || e.metaKey;
    if (isCtrlOrMeta) {
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        handleFormat("bold");
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        handleFormat("italic");
      } else if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        handleFormat("underline");
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        openLinkModal();
      } else if (e.shiftKey && (e.key === "7" || e.code === "Digit7")) {
        e.preventDefault();
        handleFormat("insertOrderedList");
      } else if (e.shiftKey && (e.key === "8" || e.code === "Digit8")) {
        e.preventDefault();
        handleFormat("insertUnorderedList");
      } else if (e.shiftKey && (e.key === "9" || e.code === "Digit9")) {
        e.preventDefault();
        handleFormat("formatBlock", "<blockquote>");
      }
    }
  }

  // ── Preview Mode ──

  createEffect(() => {
    if (isPreviewMode() && previewRef) {
      highlightCodeBlocks(previewRef);
      // Resolve any local image sources in preview if available
      const previewImgs = previewRef.querySelectorAll("img");
      previewImgs.forEach((img) => {
        const localSrc = img.getAttribute("data-local-src");
        if (localSrc && img.src.startsWith("byos-storage://")) {
          img.src = localSrc;
        }
      });
    }
  });

  function togglePreview() {
    if (editorRef) syncContent();
    const next = !isPreviewMode();
    setIsPreviewMode(next);
    if (!next && editorRef) {
      editorRef.innerHTML = DOMPurify.sanitize(currentHtml());
    }
  }

  function sanitizedPreviewHtml() {
    return sanitizeOnReceive(currentHtml()).sanitized;
  }

  onMount(() => {
    if (editorRef && props.value) {
      editorRef.innerHTML = DOMPurify.sanitize(props.value);
    }
    document.addEventListener("selectionchange", updateCaretContext);
  });

  onCleanup(() => {
    document.removeEventListener("selectionchange", updateCaretContext);
  });

  return (
    <div
      class={`flex flex-col border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden bg-white dark:bg-[#1E2025] ${
        props.class || ""
      }`}
    >
      {/* ── WYSIWYG Ribbon Bar ── */}
      <div class="flex flex-wrap items-center gap-0.5 sm:gap-1 p-1.5 bg-[#FAF9F6] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2E3138] select-none">
        {/* Bold */}
        <button
          type="button"
          data-testid="composer-bold-btn"
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
          data-testid="composer-italic-btn"
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
          data-testid="composer-underline-btn"
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
          data-testid="composer-strike-btn"
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
          data-testid="composer-size-small"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("fontSize", "2")}
          class="px-1.5 h-7 flex items-center justify-center rounded-lg text-[11px] font-medium text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Small text"
        >
          Small
        </button>
        <button
          type="button"
          data-testid="composer-size-normal"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("fontSize", "3")}
          class="px-1.5 h-7 flex items-center justify-center rounded-lg text-xs font-medium text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Normal text"
        >
          Normal
        </button>
        <button
          type="button"
          data-testid="composer-size-large"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("fontSize", "4")}
          class="px-1.5 h-7 flex items-center justify-center rounded-lg text-xs font-bold text-[#2B2C2D] dark:text-[#E2DFD8] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Large text"
        >
          Large
        </button>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-1" />

        {/* Bullet List */}
        <button
          type="button"
          data-testid="composer-bullet-list-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("insertUnorderedList")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Bullet List (Ctrl+Shift+8)"
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
          data-testid="composer-ordered-list-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("insertOrderedList")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Numbered List (Ctrl+Shift+7)"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <line x1="10" y1="6" x2="21" y2="6" />
            <line x1="10" y1="12" x2="21" y2="12" />
            <line x1="10" y1="18" x2="21" y2="18" />
            <path d="M4 6h2v-4" />
            <path d="M4 14h2.5c.8 0 1.5-.7 1.5-1.5s-.7-1.5-1.5-1.5H4" />
          </svg>
        </button>

        {/* Indent & Outdent */}
        <button
          type="button"
          data-testid="composer-outdent-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("outdent")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Outdent"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <polyline points="7 8 3 12 7 16" />
            <line x1="21" y1="12" x2="11" y2="12" />
            <line x1="21" y1="6" x2="11" y2="6" />
            <line x1="21" y1="18" x2="11" y2="18" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="composer-indent-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleFormat("indent")}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Indent"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <polyline points="7 16 11 12 7 8" />
            <line x1="3" y1="12" x2="13" y2="12" />
            <line x1="21" y1="6" x2="3" y2="6" />
            <line x1="21" y1="18" x2="3" y2="18" />
          </svg>
        </button>

        <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138] mx-1" />

        {/* Link */}
        <button
          type="button"
          data-testid="composer-link-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLinkModal}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Insert Link (Ctrl+K)"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>

        {/* Inline Code */}
        <button
          type="button"
          data-testid="composer-code-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertInlineCode}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer font-mono text-[11px]"
          title="Inline Code"
        >
          &lt;/&gt;
        </button>

        {/* Code Block */}
        <button
          type="button"
          data-testid="composer-code-block-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertCodeBlock}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Code Block"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </button>

        {/* Table */}
        <button
          type="button"
          data-testid="composer-table-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openTableModal}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Insert Table"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>

        {/* Image */}
        <button
          type="button"
          data-testid="composer-image-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => imageFileInputRef?.click()}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Insert Inline Image (Max 2 MB, 5 max)"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>

        {/* Horizontal Rule */}
        <button
          type="button"
          data-testid="composer-hr-btn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertHorizontalRule}
          class="w-7 h-7 flex items-center justify-center rounded-lg text-[#55575B] dark:text-[#A1A1AA] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] transition cursor-pointer"
          title="Horizontal Rule"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <line x1="3" y1="12" x2="21" y2="12" />
          </svg>
        </button>

        <div class="flex-1" />

        {/* Preview Mode Toggle */}
        <button
          type="button"
          data-testid="composer-preview-btn"
          onClick={togglePreview}
          class={`px-2.5 h-7 flex items-center gap-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${
            isPreviewMode()
              ? "bg-[#A27561] text-white shadow-2xs"
              : "text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6]"
          }`}
          title="Toggle Preview Mode"
        >
          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{isPreviewMode() ? "Edit" : "Preview"}</span>
        </button>

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
            class={`px-2 h-7 flex items-center gap-1 rounded-lg text-[11px] font-mono transition cursor-pointer ${
              isHtmlMode()
                ? "bg-[#A27561] text-white"
                : "text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#EAE8E3] dark:hover:bg-[#26282E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6]"
            }`}
            title="Toggle HTML Source"
          >
            <span>&lt;HTML&gt;</span>
          </button>
        </Show>
      </div>

      {/* ── Contextual Floating Action Bar (Code block language or Table tools) ── */}
      <Show when={isInCodeBlock() || isInTable()}>
        <div class="px-2.5 py-1.5 bg-[#F2E8E2] dark:bg-[#26211E] border-b border-[#E2DFD8] dark:border-[#2E3138] flex flex-wrap items-center gap-2 text-xs">
          {/* Code block language selector */}
          <Show when={isInCodeBlock()}>
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] font-mono text-[#A27561] dark:text-[#D4A38F] font-semibold">
                Language:
              </span>
              <select
                data-testid="code-language-select"
                value={currentCodeLang()}
                onChange={(e) => handleLanguageChange(e.currentTarget.value)}
                class="px-2 py-0.5 text-xs rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
              >
                <For each={SUPPORTED_LANGUAGES}>
                  {(lang) => <option value={lang.id}>{lang.label}</option>}
                </For>
              </select>
            </div>
          </Show>

          {/* Table contextual actions */}
          <Show when={isInTable()}>
            <div class="flex items-center gap-1">
              <span class="text-[11px] font-mono text-[#A27561] dark:text-[#D4A38F] font-semibold mr-1">
                Table:
              </span>
              <button
                type="button"
                onClick={() => addRow("above")}
                class="px-2 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-[#FAF9F6] text-[11px] text-[#2B2C2D] dark:text-[#E2DFD8] cursor-pointer"
                title="Add row above"
              >
                + Row Above
              </button>
              <button
                type="button"
                onClick={() => addRow("below")}
                class="px-2 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-[#FAF9F6] text-[11px] text-[#2B2C2D] dark:text-[#E2DFD8] cursor-pointer"
                title="Add row below"
              >
                + Row Below
              </button>
              <button
                type="button"
                onClick={() => addColumn("left")}
                class="px-2 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-[#FAF9F6] text-[11px] text-[#2B2C2D] dark:text-[#E2DFD8] cursor-pointer"
                title="Add column left"
              >
                + Col Left
              </button>
              <button
                type="button"
                onClick={() => addColumn("right")}
                class="px-2 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-[#FAF9F6] text-[11px] text-[#2B2C2D] dark:text-[#E2DFD8] cursor-pointer"
                title="Add column right"
              >
                + Col Right
              </button>
              <button
                type="button"
                onClick={deleteRow}
                class="px-2 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-rose-50 hover:text-rose-600 text-[11px] text-rose-500 cursor-pointer"
                title="Delete current row"
              >
                Delete Row
              </button>
              <button
                type="button"
                onClick={deleteColumn}
                class="px-2 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-rose-50 hover:text-rose-600 text-[11px] text-rose-500 cursor-pointer"
                title="Delete current column"
              >
                Delete Col
              </button>
              <button
                type="button"
                onClick={toggleHeaderRow}
                class="px-2 py-0.5 rounded bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-[#FAF9F6] text-[11px] text-[#2B2C2D] dark:text-[#E2DFD8] cursor-pointer"
                title="Toggle table header row"
              >
                Toggle Header
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Image Error Alert */}
      <Show when={imageError()}>
        <div class="px-3 py-1.5 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{imageError()}</span>
          <button
            type="button"
            onClick={() => setImageError(null)}
            class="text-rose-500 hover:text-rose-800 text-xs font-bold px-1 cursor-pointer"
          >
            ✕
          </button>
        </div>
      </Show>

      {/* Hidden File Input for Image Upload */}
      <input
        ref={imageFileInputRef}
        type="file"
        data-testid="composer-image-input"
        accept="image/*"
        onChange={handleImageFileSelected}
        class="hidden"
      />

      {/* ── Content Area: Edit Mode, HTML Mode, or Preview Mode ── */}
      <div class="flex-1 min-h-0 relative">
        <Show
          when={!isPreviewMode()}
          fallback={
            <div
              ref={previewRef}
              data-testid="composer-preview-container"
              class="composer-preview-content w-full h-full p-3.5 bg-[#FAF9F6] dark:bg-[#18191D] text-xs sm:text-sm text-[#1A1B1E] dark:text-[#F3F4F6] overflow-y-auto leading-relaxed break-words font-sans"
              style={{
                "min-height": props.minHeight || "160px",
                "max-height": props.maxHeight || "none",
              }}
              innerHTML={sanitizedPreviewHtml()}
            />
          }
        >
          <Show
            when={!isHtmlMode()}
            fallback={
              <textarea
                placeholder={props.placeholder || "Enter HTML content…"}
                value={currentHtml()}
                onInput={(e) => {
                  const val = e.currentTarget.value;
                  setCurrentHtml(val);
                  props.onChange?.({ html: val, text: val.replace(/<[^>]+>/g, "") });
                  if (editorRef) {
                    editorRef.innerHTML = DOMPurify.sanitize(val);
                  }
                }}
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
              data-testid="compose-body-input"
              onInput={syncContent}
              onPaste={handlePaste}
              onKeyDown={handleEditorKeyDown}
              onKeyUp={updateCaretContext}
              onMouseUp={updateCaretContext}
              data-placeholder={props.placeholder || "Write your message here…"}
              class={`rich-text-editor-content w-full h-full p-3.5 bg-white dark:bg-[#1E2025] text-xs sm:text-sm text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none overflow-y-auto leading-relaxed break-words font-sans empty:before:content-[attr(data-placeholder)] empty:before:text-[#878A8E] empty:before:pointer-events-none ${
                props.contentClass || ""
              }`}
              style={{
                "min-height": props.minHeight || "160px",
                "max-height": props.maxHeight || "none",
              }}
            />
          </Show>
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

      {/* ── Insert Table Modal ── */}
      <Show when={showTableModal()}>
        <div class="fixed inset-0 z-[60] bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Insert Table</h3>
              <button
                type="button"
                onClick={() => setShowTableModal(false)}
                class="text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] p-1 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <form onSubmit={applyInsertTable} class="space-y-3">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                    Rows
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={tableRows()}
                    onInput={(e) => setTableRows(parseInt(e.currentTarget.value, 10) || 1)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                    Columns
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={tableCols()}
                    onInput={(e) => setTableCols(parseInt(e.currentTarget.value, 10) || 1)}
                    class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                  />
                </div>
              </div>

              <div class="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="includeHeaderCheckbox"
                  checked={tableHeader()}
                  onChange={(e) => setTableHeader(e.currentTarget.checked)}
                  class="rounded border-[#E2DFD8] text-[#A27561] focus:ring-[#A27561]"
                />
                <label for="includeHeaderCheckbox" class="text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer">
                  Include Header Row
                </label>
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTableModal(false)}
                  class="px-3.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="composer-insert-table-btn"
                  class="px-4 py-1.5 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition cursor-pointer"
                >
                  Insert Table
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};
