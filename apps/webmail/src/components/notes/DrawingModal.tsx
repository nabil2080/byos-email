import { Component, createSignal, createEffect, onMount, onCleanup, For, Show } from "solid-js";

export interface DrawingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}

const DRAWING_COLORS = [
  { id: "black", color: "#1A1B1E", name: "Black" },
  { id: "mocha", color: "#9E725F", name: "Mocha" },
  { id: "blue", color: "#0284C7", name: "Sky" },
  { id: "green", color: "#059669", name: "Emerald" },
  { id: "red", color: "#DC2626", name: "Crimson" },
  { id: "amber", color: "#D97706", name: "Amber" },
  { id: "purple", color: "#7C3AED", name: "Purple" },
];

const STROKE_WIDTHS = [
  { id: "thin", size: 2, label: "Thin" },
  { id: "medium", size: 5, label: "Medium" },
  { id: "thick", size: 10, label: "Thick" },
];

export const DrawingModal: Component<DrawingModalProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  const [selectedColor, setSelectedColor] = createSignal("#1A1B1E");
  const [selectedWidth, setSelectedWidth] = createSignal(5);
  const [isEraser, setIsEraser] = createSignal(false);
  const [isDrawing, setIsDrawing] = createSignal(false);
  const [history, setHistory] = createSignal<ImageData[]>([]);

  const saveCanvasState = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    const imgData = ctx.getImageData(0, 0, canvasRef.width, canvasRef.height);
    setHistory((prev) => [...prev.slice(-15), imgData]);
  };

  const initCanvas = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvasRef.width, canvasRef.height);
    saveCanvasState();
  };

  const setupCanvas = (el: HTMLCanvasElement) => {
    canvasRef = el;
    setHistory([]);
    setIsEraser(false);
    initCanvas();
  };

  createEffect(() => {
    if (props.isOpen) {
      setIsEraser(false);
      if (canvasRef) {
        setHistory([]);
        initCanvas();
      }
    } else {
      canvasRef = undefined;
    }
  });

  onMount(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && props.isOpen) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => window.removeEventListener("keydown", handleKeyDown));
  });

  const getPos = (e: MouseEvent | TouchEvent) => {
    if (!canvasRef) return { x: 0, y: 0 };
    const rect = canvasRef.getBoundingClientRect();
    const scaleX = canvasRef.width / rect.width;
    const scaleY = canvasRef.height / rect.height;

    if ("touches" in e) {
      const touch = e.touches[0] || (e as any).changedTouches?.[0];
      if (touch) {
        return {
          x: (touch.clientX - rect.left) * scaleX,
          y: (touch.clientY - rect.top) * scaleY,
        };
      }
    }
    const mouse = e as MouseEvent;
    return {
      x: (mouse.clientX - rect.left) * scaleX,
      y: (mouse.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: MouseEvent | TouchEvent) => {
    if (!canvasRef) return;
    e.preventDefault();
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    saveCanvasState();
    setIsDrawing(true);
    const { x, y } = getPos(e);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = selectedWidth();
    ctx.strokeStyle = isEraser() ? "#FFFFFF" : selectedColor();
  };

  const draw = (e: MouseEvent | TouchEvent) => {
    if (!isDrawing() || !canvasRef) return;
    e.preventDefault();
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;

    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    if (!isDrawing() || !canvasRef) return;
    setIsDrawing(false);
    const ctx = canvasRef.getContext("2d");
    if (ctx) ctx.closePath();
  };

  const handleUndo = () => {
    if (!canvasRef || history().length <= 1) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    const nextHistory = [...history()];
    nextHistory.pop(); // Remove current state
    const prevState = nextHistory[nextHistory.length - 1];
    if (prevState) {
      ctx.putImageData(prevState, 0, 0);
      setHistory(nextHistory);
    }
  };

  const handleClear = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    saveCanvasState();
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, canvasRef.width, canvasRef.height);
  };

  const handleSave = () => {
    if (!canvasRef) return;
    const dataUrl = canvasRef.toDataURL("image/png");
    props.onSave(dataUrl);
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add Drawing"
        data-testid="drawing-modal"
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs select-none"
      >
        <div class="w-full max-w-2xl bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-2xl overflow-hidden flex flex-col">
          {/* Header */}
          <div class="px-4 py-3 border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between bg-[#FAF9F5] dark:bg-[#18191D]">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-[#9E725F] stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                <path d="M2 2l7.586 7.586" />
                <circle cx="11" cy="11" r="2" />
              </svg>
              <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#ECEBE8]">Add Drawing</h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              data-testid="close-drawing-modal-btn"
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#1A1B1E] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              aria-label="Close drawing modal"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Canvas Toolbar */}
          <div class="px-4 py-2 border-b border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Tool Mode: Pen vs Eraser */}
            <div class="flex items-center gap-1 bg-[#F0EEE9] dark:bg-[#26282E] p-0.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138]">
              <button
                type="button"
                onClick={() => setIsEraser(false)}
                data-testid="drawing-tool-pen"
                class={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  !isEraser()
                    ? "bg-white dark:bg-[#1E1F23] text-[#9E725F] font-semibold shadow-2xs"
                    : "text-[#6F7173] dark:text-[#878A8E]"
                }`}
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" />
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                </svg>
                <span>Pen</span>
              </button>
              <button
                type="button"
                onClick={() => setIsEraser(true)}
                data-testid="drawing-tool-eraser"
                class={`px-2.5 py-1 rounded-md font-medium transition cursor-pointer flex items-center gap-1.5 ${
                  isEraser()
                    ? "bg-white dark:bg-[#1E1F23] text-[#9E725F] font-semibold shadow-2xs"
                    : "text-[#6F7173] dark:text-[#878A8E]"
                }`}
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L18 15" />
                  <line x1="18" y1="15" x2="6" y2="15" />
                </svg>
                <span>Eraser</span>
              </button>
            </div>

            {/* Colors (hidden when eraser is active) */}
            <Show when={!isEraser()}>
              <div class="flex items-center gap-1.5" data-testid="drawing-color-palette">
                <For each={DRAWING_COLORS}>
                  {(c) => (
                    <button
                      type="button"
                      onClick={() => setSelectedColor(c.color)}
                      title={c.name}
                      data-testid={`drawing-color-${c.id}`}
                      class={`w-5 h-5 rounded-full transition-transform cursor-pointer border ${
                        selectedColor() === c.color
                          ? "scale-125 ring-2 ring-[#9E725F] border-white shadow-xs"
                          : "border-black/20 hover:scale-110"
                      }`}
                      style={{ "background-color": c.color }}
                    />
                  )}
                </For>
              </div>
            </Show>

            {/* Stroke Widths */}
            <div class="flex items-center gap-1 bg-[#F0EEE9] dark:bg-[#26282E] p-0.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138]">
              <For each={STROKE_WIDTHS}>
                {(sw) => (
                  <button
                    type="button"
                    onClick={() => setSelectedWidth(sw.size)}
                    data-testid={`drawing-width-${sw.id}`}
                    class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition cursor-pointer ${
                      selectedWidth() === sw.size
                        ? "bg-white dark:bg-[#1E1F23] text-[#1A1B1E] dark:text-white font-semibold shadow-2xs"
                        : "text-[#6F7173] dark:text-[#878A8E]"
                    }`}
                  >
                    {sw.label}
                  </button>
                )}
              </For>
            </div>

            {/* Undo & Clear */}
            <div class="flex items-center gap-1">
              <button
                type="button"
                onClick={handleUndo}
                data-testid="drawing-undo-btn"
                title="Undo last stroke"
                class="p-1 rounded-md text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M3 7v6h6" />
                  <path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleClear}
                data-testid="drawing-clear-btn"
                title="Clear canvas"
                class="px-2 py-1 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 font-medium cursor-pointer"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Interactive Canvas */}
          <div class="p-3 bg-[#F0EEE9] dark:bg-[#121316] flex items-center justify-center overflow-hidden">
            <canvas
              ref={setupCanvas}
              width={640}
              height={380}
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
              data-testid="drawing-canvas"
              class="w-full max-w-[640px] h-[340px] sm:h-[380px] bg-white rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-xs cursor-crosshair touch-none"
            />
          </div>

          {/* Footer Actions */}
          <div class="px-4 py-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={props.onClose}
              data-testid="cancel-drawing-btn"
              class="px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#6F7173] dark:text-[#878A8E] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              data-testid="save-drawing-btn"
              class="px-4 py-1.5 rounded-xl bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs font-semibold shadow-xs transition cursor-pointer"
            >
              Save Drawing
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
