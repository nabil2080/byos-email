import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import {
  TrashEventRecord,
  getTrashEvents,
  restoreEventFromTrash,
  deletePermanentlyFromTrash,
  emptyTrash,
} from "./calendarTrashStore";

interface CalendarTrashModalProps {
  isOpen: boolean;
  mailboxId: string;
  onClose: () => void;
  onRestore: (event: TrashEventRecord) => Promise<void> | void;
}

export const CalendarTrashModal: Component<CalendarTrashModalProps> = (props) => {
  const [items, setItems] = createSignal<TrashEventRecord[]>([]);
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);

  function refreshItems() {
    if (props.mailboxId) {
      setItems(getTrashEvents(props.mailboxId));
    }
  }

  onMount(() => {
    refreshItems();
    const handleUpdate = () => refreshItems();
    window.addEventListener("byos_calendar_trash_updated", handleUpdate);
    onCleanup(() => {
      window.removeEventListener("byos_calendar_trash_updated", handleUpdate);
    });
  });

  // Re-fetch when modal opens
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape" && props.isOpen) {
      props.onClose();
    }
  }

  async function handleRestore(item: TrashEventRecord) {
    try {
      setActionLoading(item.trashId);
      const restored = restoreEventFromTrash(props.mailboxId, item.trashId);
      if (restored) {
        await props.onRestore(restored);
      }
      refreshItems();
    } finally {
      setActionLoading(null);
    }
  }

  function handleDeleteForever(item: TrashEventRecord) {
    deletePermanentlyFromTrash(props.mailboxId, item.trashId);
    refreshItems();
  }

  function handleEmptyAll() {
    if (confirm("Are you sure you want to permanently delete all items in trash?")) {
      emptyTrash(props.mailboxId);
      refreshItems();
    }
  }

  function calculateDaysRemaining(expiresAt: string): number {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return (
    <Show when={props.isOpen}>
      <div
        data-testid="calendar-trash-modal"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-trash-title"
        onKeyDown={handleKeyDown}
      >
        <div class="bg-[#1A1817] border border-[#302B27] rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] text-[#E3DDD4] animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-[#302B27]">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-red-950/40 border border-red-800/40 flex items-center justify-center text-red-400">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h2 id="calendar-trash-title" class="text-base font-semibold text-[#E3DDD4]">
                  Calendar Trash
                </h2>
                <p class="text-xs text-[#9E9085]">
                  Deleted events are retained for 30 days before permanent deletion.
                </p>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Show when={items().length > 0}>
                <button
                  type="button"
                  data-testid="empty-trash-btn"
                  onClick={handleEmptyAll}
                  class="px-2.5 py-1 text-xs font-medium text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-900/40 border border-red-800/40 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/40"
                >
                  Empty Trash
                </button>
              </Show>
              <button
                type="button"
                data-testid="calendar-trash-close-btn"
                onClick={props.onClose}
                aria-label="Close trash modal"
                class="p-1.5 text-[#9E9085] hover:text-[#E3DDD4] hover:bg-[#252220] rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* List body */}
          <div class="p-6 overflow-y-auto flex-1 space-y-3">
            <Show
              when={items().length > 0}
              fallback={
                <div
                  data-testid="trash-empty-state"
                  class="flex flex-col items-center justify-center py-12 text-center"
                >
                  <div class="w-12 h-12 rounded-full bg-[#252220] flex items-center justify-center text-[#9E9085] mb-3">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </div>
                  <p class="text-sm font-medium text-[#E3DDD4]">Trash is empty</p>
                  <p class="text-xs text-[#9E9085] mt-1">
                    Deleted calendar events will appear here and can be recovered within 30 days.
                  </p>
                </div>
              }
            >
              <For each={items()}>
                {(item) => (
                  <div
                    data-testid={`trash-item-${item.trashId}`}
                    class="flex items-center justify-between p-3.5 bg-[#252220]/70 border border-[#302B27] rounded-xl hover:border-[#423C36] transition-all"
                  >
                    <div class="min-w-0 pr-4">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-[#E3DDD4] truncate">
                          {item.event.details.title || "(Untitled Event)"}
                        </span>
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-[#302B27] text-[#9E9085]">
                          {item.calendarName}
                        </span>
                      </div>
                      <div class="flex items-center gap-3 text-xs text-[#9E9085] mt-1">
                        <span>
                          Deleted {new Date(item.deletedAt).toLocaleDateString()}
                        </span>
                        <span>•</span>
                        <span class="text-amber-400/90 font-medium">
                          {calculateDaysRemaining(item.expiresAt)} days left
                        </span>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        data-testid={`trash-restore-btn-${item.trashId}`}
                        disabled={actionLoading() === item.trashId}
                        onClick={() => handleRestore(item)}
                        class="px-2.5 py-1 text-xs font-medium text-[#D19A66] hover:text-[#E5B584] bg-[#9E725F]/15 hover:bg-[#9E725F]/25 border border-[#9E725F]/30 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50"
                      >
                        {actionLoading() === item.trashId ? "Restoring..." : "Restore"}
                      </button>
                      <button
                        type="button"
                        data-testid={`trash-delete-forever-btn-${item.trashId}`}
                        onClick={() => handleDeleteForever(item)}
                        title="Delete permanently"
                        class="p-1.5 text-[#9E9085] hover:text-red-400 hover:bg-[#302B27] rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/40"
                      >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
