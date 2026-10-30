import { Component, For, Show } from "solid-js";
import { NoteItem, NoteVersion } from "./notesStore";

export interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  note: NoteItem | null;
  onRestoreVersion: (versionId: string) => void;
}

export const VersionHistoryModal: Component<VersionHistoryModalProps> = (props) => {
  const versions = () => props.note?.versionHistory || [];

  return (
    <Show when={props.isOpen && props.note}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Version History"
        data-testid="version-history-modal"
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs select-none"
      >
        <div class="w-full max-w-lg bg-white dark:bg-[#1E1F23] rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
          {/* Header */}
          <div class="px-5 py-3.5 border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between bg-[#FAF9F5] dark:bg-[#18191D]">
            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-[#9E725F] stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 14 14" />
              </svg>
              <h3 class="text-sm font-semibold text-[#1A1B1E] dark:text-[#ECEBE8]">
                Version History: {props.note?.title || "Untitled"}
              </h3>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              data-testid="close-version-history-modal-btn"
              class="p-1 rounded-lg text-[#6F7173] hover:text-[#1A1B1E] dark:hover:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              aria-label="Close version history"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Versions List */}
          <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {/* Current Active Version Indicator */}
            <div class="p-3 rounded-xl bg-[#F3ECE8] dark:bg-[#2D2522] border border-[#A27561]/30 text-xs">
              <div class="flex items-center justify-between font-semibold text-[#9E725F] dark:text-[#D4A38F] mb-1">
                <span>Current Version</span>
                <span>{new Date(props.note!.updatedAt).toLocaleString()}</span>
              </div>
              <p class="text-[#3C3D3E] dark:text-[#E2DFD8] line-clamp-2">
                {props.note!.content || (props.note!.checklistItems || []).map((i) => i.text).join(", ") || "(empty)"}
              </p>
            </div>

            <Show
              when={versions().length > 0}
              fallback={
                <div class="text-center py-8 text-xs text-[#6F7173] dark:text-[#878A8E]">
                  <p class="font-medium">No prior versions recorded yet.</p>
                  <p class="mt-1 opacity-80">Revisions are automatically captured when note contents change.</p>
                </div>
              }
            >
              <div class="space-y-2.5">
                <span class="text-[11px] font-semibold text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider block px-1">
                  Previous Revisions
                </span>
                <For each={versions()}>
                  {(ver) => (
                    <div
                      data-testid={`version-item-${ver.id}`}
                      class="p-3 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] hover:border-[#9E725F]/40 transition text-xs flex flex-col gap-2"
                    >
                      <div class="flex items-center justify-between">
                        <span class="font-medium text-[#1A1B1E] dark:text-[#ECEBE8]">
                          {new Date(ver.timestamp).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            props.onRestoreVersion(ver.id);
                            props.onClose();
                          }}
                          data-testid={`restore-version-btn-${ver.id}`}
                          class="px-2.5 py-1 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-[11px] font-semibold cursor-pointer shadow-2xs transition"
                        >
                          Restore
                        </button>
                      </div>
                      <div class="text-[#6F7173] dark:text-[#878A8E] bg-white dark:bg-[#1E1F23] p-2 rounded-lg border border-[#E2DFD8]/60 dark:border-[#2A2D35]/60">
                        <Show when={ver.title}>
                          <p class="font-bold text-[#1A1B1E] dark:text-[#ECEBE8] mb-0.5">{ver.title}</p>
                        </Show>
                        <p class="line-clamp-2">
                          {ver.content || (ver.checklistItems || []).map((i) => i.text).join(", ") || "(empty)"}
                        </p>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="px-5 py-3 border-t border-[#E2DFD8] dark:border-[#2A2D35] bg-[#FAF9F5] dark:bg-[#18191D] flex justify-end">
            <button
              type="button"
              onClick={props.onClose}
              data-testid="done-version-history-btn"
              class="px-4 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-semibold text-[#1A1B1E] dark:text-[#ECEBE8] hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
