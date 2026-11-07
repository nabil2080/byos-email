import { Component, createSignal, Show } from "solid-js";

export interface UnsubscribeConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  senderName: string;
  senderEmail: string;
  unsubscribeUrl?: string;
  unsubscribeEmail?: string;
  messageCount?: number;
  onConfirmUnsubscribe: (moveToTrash: boolean) => Promise<void> | void;
}

export const UnsubscribeConfirmModal: Component<UnsubscribeConfirmModalProps> = (props) => {
  const [moveToTrash, setMoveToTrash] = createSignal(false);
  const [isSubmitting, setIsSubmitting] = createSignal(false);

  async function handleConfirm() {
    setIsSubmitting(true);
    try {
      await props.onConfirmUnsubscribe(moveToTrash());
      props.onClose();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs select-none"
        onClick={props.onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsub-modal-title"
        data-testid="unsubscribe-confirm-modal"
      >
        <div
          class="w-full max-w-md bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl p-6 overflow-hidden flex flex-col gap-4 text-left transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="flex items-start gap-3.5">
            <div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600 dark:text-amber-400 flex-shrink-0">
              <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div class="flex-1 min-w-0">
              <h2 id="unsub-modal-title" class="text-base font-bold text-[#1A1B1E] dark:text-[#F3F4F6] truncate">
                Unsubscribe from {props.senderName}?
              </h2>
              <p class="text-xs text-[#75777B] dark:text-[#8E918F] font-mono truncate">
                {props.senderEmail}
              </p>
            </div>
          </div>

          {/* Description */}
          <div class="text-xs text-[#55575B] dark:text-[#A8AAAA] leading-relaxed space-y-2">
            <p>
              Are you sure you want to stop receiving messages from <strong>{props.senderName}</strong>? Future newsletters will be blocked from your inbox.
            </p>
            <Show when={props.unsubscribeUrl}>
              <div class="p-2.5 rounded-xl bg-[#FAF9F7] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between gap-2">
                <span class="truncate text-[11px] text-[#75777B] dark:text-[#8E918F]">
                  Official opt-out link available
                </span>
                <a
                  href={props.unsubscribeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[11px] font-semibold text-[#A27561] hover:underline flex-shrink-0"
                >
                  Visit link ↗
                </a>
              </div>
            </Show>
          </div>

          {/* Options */}
          <Show when={(props.messageCount || 0) > 0}>
            <label class="flex items-center gap-2.5 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={moveToTrash()}
                onChange={(e) => setMoveToTrash(e.currentTarget.checked)}
                class="accent-[#A27561] w-4 h-4 rounded"
                data-testid="unsub-move-trash-checkbox"
              />
              <span>Also move {props.messageCount} existing email{(props.messageCount || 0) > 1 ? "s" : ""} to Trash</span>
            </label>
          </Show>

          {/* Action Buttons */}
          <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E2DFD8]/60 dark:border-[#2E3138]">
            <button
              type="button"
              onClick={props.onClose}
              disabled={isSubmitting()}
              class="px-4 py-2 rounded-xl text-xs font-semibold text-[#55575B] dark:text-[#A8AAAA] hover:bg-stone-100 dark:hover:bg-[#252830] transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting()}
              data-testid="unsub-confirm-btn"
              class="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white shadow-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Show when={isSubmitting()}>
                <span class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              </Show>
              <span>Unsubscribe</span>
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
