import { Component, createSignal, For, Show } from "solid-js";
import { AttachmentItem } from "../api";
import { AttachmentBadge } from "./AttachmentBadge";
import { RichTextEditor } from "./RichTextEditor";

export type DrawerMode = "minimized" | "docked" | "maximized";

interface ComposeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  to: string;
  onToChange: (val: string) => void;
  subject: string;
  onSubjectChange: (val: string) => void;
  body: string;
  onBodyChange: (val: string) => void;
  bodyHtml?: string;
  onBodyHtmlChange?: (val: string) => void;
  attachments: AttachmentItem[];
  onAttachmentSelected: (e: Event) => void;
  onRemoveAttachment: (id: string) => void;
  scheduledTime: string;
  onScheduledTimeChange: (val: string) => void;
  trackOpens?: boolean;
  onTrackOpensChange?: (val: boolean) => void;
  onSend: (e: Event) => void;
  onSaveDraft: () => void;
  status: string | null;
  errorMessage: string | null;
  isEditingDraft: boolean;
  senderAddress: string;
}

export const ComposeDrawer: Component<ComposeDrawerProps> = (props) => {
  const [drawerMode, setDrawerMode] = createSignal<DrawerMode>("docked");
  const [showScheduleInput, setShowScheduleInput] = createSignal(false);

  // Hidden file input ref
  let fileInputRef: HTMLInputElement | undefined;

  function toggleMinimize(e?: Event) {
    e?.stopPropagation();
    setDrawerMode((prev) => (prev === "minimized" ? "docked" : "minimized"));
  }

  function toggleMaximize(e?: Event) {
    e?.stopPropagation();
    setDrawerMode((prev) => (prev === "maximized" ? "docked" : "maximized"));
  }

  function handleClose() {
    props.onClose();
    setDrawerMode("docked");
  }

  return (
    <Show when={props.isOpen}>
      {/* Backdrop only when maximized */}
      <Show when={drawerMode() === "maximized"}>
        <div
          onClick={() => setDrawerMode("docked")}
          class="fixed inset-0 bg-black/30 backdrop-blur-xs z-40 transition-opacity"
        ></div>
      </Show>

      {/* Main Compose Drawer Container with tactile spring cubic-bezier */}
      <div
        class={`fixed z-50 bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          drawerMode() === "minimized"
            ? "bottom-0 right-6 sm:right-10 w-80 h-12 rounded-t-xl cursor-pointer"
            : drawerMode() === "docked"
            ? "bottom-0 right-6 sm:right-10 w-[580px] h-[560px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-64px)] rounded-t-2xl"
            : "top-8 bottom-6 inset-x-0 mx-auto w-[860px] max-w-[95vw] h-[calc(100vh-56px)] rounded-2xl"
        }`}
        onClick={() => {
          if (drawerMode() === "minimized") setDrawerMode("docked");
        }}
      >
        {/* Drawer Title Bar / Controls */}
        <header class="h-12 bg-[#3C3D3E] dark:bg-[#18191D] text-white px-4 flex items-center justify-between flex-shrink-0 select-none cursor-default border-b dark:border-[#2E3138]">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span class="text-xs font-semibold tracking-wide truncate">
              {props.isEditingDraft
                ? `Edit Draft: ${props.subject || "(no subject)"}`
                : props.subject || "New Message"}
            </span>
          </div>

          <div class="flex items-center gap-1.5 flex-shrink-0 text-stone-300">
            {/* Minimize / Expand button */}
            <button
              type="button"
              onClick={toggleMinimize}
              title={drawerMode() === "minimized" ? "Expand" : "Minimize"}
              class="w-7 h-7 rounded-lg hover:bg-stone-700/70 dark:hover:bg-[#26282E] flex items-center justify-center text-xs transition cursor-pointer text-stone-300 hover:text-white"
            >
              <Show
                when={drawerMode() === "minimized"}
                fallback={
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                }
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </Show>
            </button>

            {/* Maximize / Restore button */}
            <button
              type="button"
              onClick={toggleMaximize}
              title={drawerMode() === "maximized" ? "Restore to Dock" : "Maximize"}
              class="w-7 h-7 rounded-lg hover:bg-stone-700/70 dark:hover:bg-[#26282E] flex items-center justify-center text-xs transition cursor-pointer text-stone-300 hover:text-white"
            >
              <Show
                when={drawerMode() === "maximized"}
                fallback={
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                }
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <rect x="4" y="8" width="12" height="12" rx="2" />
                  <path d="M8 4h10a2 2 0 0 1 2 2v10" />
                </svg>
              </Show>
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={handleClose}
              title="Save draft & Close"
              class="w-7 h-7 rounded-lg hover:bg-rose-600 hover:text-white flex items-center justify-center text-xs transition cursor-pointer text-stone-300"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </header>

        {/* Drawer Body (Visible when not minimized) */}
        <Show when={drawerMode() !== "minimized"}>
          <form onSubmit={props.onSend} class="flex flex-col flex-1 min-h-0 bg-white dark:bg-[#1E2025]">
            {/* Header Fields (From, To, Subject) */}
            <div class="px-4 py-2 border-b border-[#E2DFD8] dark:border-[#2E3138] space-y-2 flex-shrink-0 bg-[#FAF9F7] dark:bg-[#18191D]">
              {/* From Row */}
              <div class="flex items-center gap-2 text-xs">
                <span class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium">From:</span>
                <span class="font-mono text-[#1A1B1E] dark:text-[#F3F4F6] font-medium select-all">
                  {props.senderAddress}
                </span>
                <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold">
                  Sovereign Outbound
                </span>
              </div>

              {/* To Row */}
              <div class="flex items-center gap-2 text-xs">
                <label for="composeToInput" class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium">
                  To:
                </label>
                <input
                  id="composeToInput"
                  type="email"
                  placeholder="recipient@example.com"
                  value={props.to}
                  onInput={(e) => props.onToChange(e.currentTarget.value)}
                  required
                  class="flex-1 bg-transparent text-xs text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none py-1"
                />
              </div>

              {/* Subject Row */}
              <div class="flex items-center gap-2 text-xs border-t border-[#E2DFD8]/60 dark:border-[#2E3138] pt-2">
                <label for="composeSubjectInput" class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium">
                  Subject:
                </label>
                <input
                  id="composeSubjectInput"
                  type="text"
                  placeholder="Message subject"
                  value={props.subject}
                  onInput={(e) => props.onSubjectChange(e.currentTarget.value)}
                  required
                  class="flex-1 bg-transparent text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none py-1"
                />
              </div>

              {/* Scheduled Send Bar (optional toggle) */}
              <Show when={showScheduleInput()}>
                <div class="flex items-center gap-2 text-xs border-t border-[#E2DFD8]/60 dark:border-[#2E3138] pt-2 bg-amber-50/70 dark:bg-amber-950/40 -mx-4 px-4 py-2">
                  <span class="w-16 text-amber-900 dark:text-amber-200 font-medium">Schedule:</span>
                  <input
                    type="datetime-local"
                    value={props.scheduledTime}
                    onInput={(e) => props.onScheduledTimeChange(e.currentTarget.value)}
                    class="bg-white dark:bg-[#1E2025] border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      props.onScheduledTimeChange("");
                      setShowScheduleInput(false);
                    }}
                    class="text-xs text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 underline ml-2 cursor-pointer"
                  >
                    Clear & Send Immediately
                  </button>
                </div>
              </Show>
            </div>

            {/* Attachments Pills List */}
            <Show when={props.attachments.length > 0}>
              <div class="px-4 py-2 bg-[#F8F7F4] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2E3138] flex flex-wrap gap-2 flex-shrink-0">
                <For each={props.attachments}>
                  {(att) => (
                    <div class="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-mono text-[#1A1B1E] dark:text-[#F3F4F6] shadow-2xs">
                      <AttachmentBadge filename={att.filename} contentType={att.content_type} size="xs" showLabel={false} />
                      <span class="truncate max-w-[160px]">{att.filename}</span>
                      <span class="text-[10px] text-[#55575B] dark:text-[#A1A1AA]">
                        ({Math.round((att.byte_size ?? att.size_bytes ?? 0) / 1024)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={() => props.onRemoveAttachment(att.id)}
                        class="text-rose-500 hover:text-rose-700 p-0.5 ml-0.5 cursor-pointer rounded hover:bg-rose-50 dark:hover:bg-rose-950/40 transition"
                        title="Remove attachment"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Error or Status message */}
            <Show when={props.errorMessage}>
              <div class="mx-4 mt-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
                <span>{props.errorMessage}</span>
              </div>
            </Show>

            <Show when={props.status}>
              <div class="mx-4 mt-2 p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                <div class="w-3 h-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
                <span>{props.status}</span>
              </div>
            </Show>

            {/* Message Body Rich Editor */}
            <div class="flex-1 min-h-0 flex flex-col">
              <RichTextEditor
                value={props.bodyHtml || props.body}
                placeholder="Write your encrypted message here…"
                onChange={({ html, text }) => {
                  props.onBodyChange(text);
                  props.onBodyHtmlChange?.(html);
                }}
                class="flex-1 border-0 rounded-none bg-white dark:bg-[#1E2025]"
                contentClass="p-4"
                minHeight="220px"
              />
            </div>

            {/* Hidden Attachment Input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={props.onAttachmentSelected}
              class="hidden"
            />

            {/* Bottom Action Footer */}
            <footer class="h-14 border-t border-[#E2DFD8] dark:border-[#2E3138] px-4 bg-[#FAF9F7] dark:bg-[#18191D] flex items-center justify-between flex-shrink-0">
              <div class="flex items-center gap-2">
                {/* Send Button Group */}
                <button
                  type="submit"
                  disabled={Boolean(props.status)}
                  class="px-4 py-2 rounded-xl bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold transition flex items-center gap-2 shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <Show when={props.status}>
                    <div class="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  </Show>
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  <span>
                    {props.scheduledTime ? "Schedule Encrypted Send" : "Send Encrypted"}
                  </span>
                </button>

                {/* Schedule Send Trigger */}
                <button
                  type="button"
                  onClick={() => setShowScheduleInput(!showScheduleInput())}
                  title="Schedule send for later"
                  class="p-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer flex items-center justify-center"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </button>

                {/* Attach File Button */}
                <button
                  type="button"
                  onClick={() => fileInputRef?.click()}
                  title="Attach file"
                  class="p-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition flex items-center gap-1 cursor-pointer"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  <span class="text-[11px] font-medium hidden sm:inline">Attach</span>
                </button>

                {/* Open Tracking Toggle Button */}
                <button
                  type="button"
                  onClick={() => props.onTrackOpensChange?.(!props.trackOpens)}
                  title={props.trackOpens ? "Email open tracking is enabled" : "Track when recipient opens this email"}
                  class={`p-2 rounded-xl border transition flex items-center gap-1.5 cursor-pointer text-xs ${
                    props.trackOpens
                      ? "border-[#A27561] bg-[#F3ECE8] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-bold shadow-2xs"
                      : "border-[#E2DFD8] dark:border-[#2E3138] text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E]"
                  }`}
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span class="text-[11px] font-medium hidden sm:inline">
                    {props.trackOpens ? "Tracking On" : "Track Opens"}
                  </span>
                </button>
              </div>

              {/* Save Draft / Discard */}
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={props.onSaveDraft}
                  class="px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  class="p-2 text-[#878A8E] hover:text-rose-600 transition text-xs cursor-pointer flex items-center justify-center"
                  title="Discard"
                >
                  <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </footer>
          </form>
        </Show>
      </div>
    </Show>
  );
};
