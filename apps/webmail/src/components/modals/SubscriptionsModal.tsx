import { Component, createSignal, createMemo, Show, For, onMount, onCleanup } from "solid-js";
import { DisplayMessage } from "../MessageList";
import {
  SubscriptionItem,
  detectSubscriptions,
  unsubscribeSender,
  resubscribeSender,
} from "../../subscriptions_store";
import { UnsubscribeConfirmModal } from "./UnsubscribeConfirmModal";

export interface SubscriptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  messages: DisplayMessage[];
  mailboxId: string;
  onTrashSenderMessages?: (senderEmail: string) => void;
}

export const SubscriptionsModal: Component<SubscriptionsModalProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [activeFilter, setActiveFilter] = createSignal<"all" | "active" | "unsubscribed">("all");
  const [storeTick, setStoreTick] = createSignal(0);
  const [confirmTarget, setConfirmTarget] = createSignal<SubscriptionItem | null>(null);

  onMount(() => {
    const handleUpdate = () => setStoreTick((t) => t + 1);
    window.addEventListener("byos_subscriptions_updated", handleUpdate);
    onCleanup(() => {
      window.removeEventListener("byos_subscriptions_updated", handleUpdate);
    });
  });

  const subscriptions = createMemo(() => {
    storeTick();
    return detectSubscriptions(props.messages, props.mailboxId);
  });

  const totalCount = createMemo(() => subscriptions().length);
  const activeCount = createMemo(() => subscriptions().filter((s) => s.status === "subscribed").length);
  const unsubscribedCount = createMemo(() => subscriptions().filter((s) => s.status === "unsubscribed").length);

  const filteredSubscriptions = createMemo(() => {
    const q = searchQuery().trim().toLowerCase();
    const filter = activeFilter();
    return subscriptions().filter((sub) => {
      if (filter === "active" && sub.status !== "subscribed") return false;
      if (filter === "unsubscribed" && sub.status !== "unsubscribed") return false;
      if (q) {
        return (
          sub.senderName.toLowerCase().includes(q) ||
          sub.senderEmail.toLowerCase().includes(q) ||
          (sub.subjectSample && sub.subjectSample.toLowerCase().includes(q))
        );
      }
      return true;
    });
  });

  async function handleConfirmUnsubscribe(moveToTrash: boolean) {
    const target = confirmTarget();
    if (!target) return;
    unsubscribeSender(props.mailboxId, target.senderEmail, target.senderName, target.unsubscribeUrl);
    if (moveToTrash && props.onTrashSenderMessages) {
      props.onTrashSenderMessages(target.senderEmail);
    }
    setConfirmTarget(null);
  }

  function handleResubscribe(sub: SubscriptionItem) {
    resubscribeSender(props.mailboxId, sub.senderEmail);
  }

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-xs select-none"
        onClick={props.onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscriptions-modal-title"
        data-testid="subscriptions-modal"
      >
        <div
          class="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-[#1E2025] rounded-3xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-2xl flex flex-col overflow-hidden text-left transition-all"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div class="p-4 sm:p-6 border-b border-[#E2DFD8]/70 dark:border-[#2E3138] flex items-center justify-between gap-3 bg-[#FAF9F7] dark:bg-[#18191D]">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-2xl bg-[#A27561]/10 dark:bg-[#A27561]/20 flex items-center justify-center text-[#A27561] flex-shrink-0">
                <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <div class="min-w-0">
                <h2 id="subscriptions-modal-title" class="text-base sm:text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6] truncate">
                  Manage Subscriptions
                </h2>
                <p class="text-xs text-[#75777B] dark:text-[#8E918F] truncate">
                  Review commercial senders and unsubscribe with a single click.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              class="w-8 h-8 rounded-xl hover:bg-stone-200 dark:hover:bg-[#282C34] flex items-center justify-center text-[#6E7075] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-white transition cursor-pointer flex-shrink-0"
              title="Close (Esc)"
              data-testid="subscriptions-modal-close"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2.2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Search & Filter Toolbar */}
          <div class="px-4 sm:px-6 py-3 border-b border-[#E2DFD8]/60 dark:border-[#2E3138] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-[#1E2025]">
            {/* Search Input */}
            <div class="relative flex-1 min-w-0">
              <input
                type="text"
                placeholder="Search by publication or sender..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-[#FAF9F7] dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] focus:outline-none focus:ring-1 focus:ring-[#A27561]"
                data-testid="subscriptions-search-input"
              />
              <svg class="w-4 h-4 text-[#878A8E] absolute left-2.5 top-2 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>

            {/* Filter Tabs */}
            <div class="flex items-center gap-1 bg-[#FAF9F7] dark:bg-[#18191D] p-0.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                class={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  activeFilter() === "all"
                    ? "bg-white dark:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] shadow-2xs font-semibold"
                    : "text-[#75777B] dark:text-[#8E918F] hover:text-[#1A1B1E]"
                }`}
              >
                All ({totalCount()})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("active")}
                class={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  activeFilter() === "active"
                    ? "bg-white dark:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] shadow-2xs font-semibold"
                    : "text-[#75777B] dark:text-[#8E918F] hover:text-[#1A1B1E]"
                }`}
              >
                Active ({activeCount()})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("unsubscribed")}
                class={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  activeFilter() === "unsubscribed"
                    ? "bg-white dark:bg-[#26282E] text-[#1A1B1E] dark:text-[#F3F4F6] shadow-2xs font-semibold"
                    : "text-[#75777B] dark:text-[#8E918F] hover:text-[#1A1B1E]"
                }`}
              >
                Unsubscribed ({unsubscribedCount()})
              </button>
            </div>
          </div>

          {/* Subscriptions List */}
          <div class="flex-1 overflow-y-auto divide-y divide-[#E2DFD8]/50 dark:divide-[#2A2D35] p-2 sm:p-4 min-h-[220px]">
            <Show
              when={filteredSubscriptions().length > 0}
              fallback={
                <div class="py-12 flex flex-col items-center justify-center text-center gap-2 text-[#75777B] dark:text-[#8E918F]">
                  <svg class="w-10 h-10 stroke-current fill-none stroke-[1.5] text-stone-300 dark:text-stone-600" viewBox="0 0 24 24">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <line x1="2" y1="2" x2="22" y2="22" />
                  </svg>
                  <p class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">No subscriptions found</p>
                  <p class="text-xs">
                    {searchQuery() ? "Try clearing your search query." : "No newsletter senders detected in your mailbox."}
                  </p>
                </div>
              }
            >
              <For each={filteredSubscriptions()}>
                {(sub) => {
                  const isUnsub = () => sub.status === "unsubscribed";
                  return (
                    <div
                      class="p-3 sm:p-4 flex items-center justify-between gap-3 hover:bg-[#FAF9F7] dark:hover:bg-[#202227] rounded-2xl transition"
                      data-testid={`subscription-row-${sub.senderEmail}`}
                    >
                      {/* Left: Info */}
                      <div class="flex items-center gap-3 min-w-0 flex-1">
                        <div class="w-8 h-8 rounded-lg bg-[#F5F2EB] dark:bg-[#2A2D35] flex items-center justify-center text-[#75777B] dark:text-[#9CA3AF] flex-shrink-0">
                          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                            <polyline points="22,6 12,13 2,6" />
                          </svg>
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6] truncate">
                              {sub.senderName}
                            </span>
                            <Show
                              when={isUnsub()}
                              fallback={
                                <span class="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                                  Active
                                </span>
                              }
                            >
                              <span class="text-[10px] font-semibold text-stone-600 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 px-2 py-0.5 rounded-full border border-stone-200 dark:border-stone-700">
                                Unsubscribed
                              </span>
                            </Show>
                          </div>
                          <div class="flex items-center gap-2 text-xs text-[#75777B] dark:text-[#8E918F] font-mono truncate mt-0.5">
                            <span class="truncate">{sub.senderEmail}</span>
                            <span>•</span>
                            <span class="flex-shrink-0 font-sans text-[11px]">
                              {sub.messageCount} email{sub.messageCount > 1 ? "s" : ""}
                            </span>
                          </div>
                          <Show when={sub.subjectSample}>
                            <p class="text-[11px] text-[#878A8E] truncate mt-0.5 hidden sm:block">
                              Latest: "{sub.subjectSample}"
                            </p>
                          </Show>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div class="flex items-center gap-2 flex-shrink-0">
                        <Show
                          when={isUnsub()}
                          fallback={
                            <button
                              type="button"
                              onClick={() => setConfirmTarget(sub)}
                              data-testid={`unsubscribe-btn-${sub.senderEmail}`}
                              class="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/50 border border-rose-200 dark:border-rose-900/60 transition cursor-pointer"
                            >
                              Unsubscribe
                            </button>
                          }
                        >
                          <button
                            type="button"
                            onClick={() => handleResubscribe(sub)}
                            data-testid={`resubscribe-btn-${sub.senderEmail}`}
                            class="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#A27561] hover:text-[#885d4b] bg-[#F2E8E2]/70 dark:bg-[#2D2522] hover:bg-[#EBDDD5] border border-[#E2DFD8] dark:border-[#3E3430] transition cursor-pointer"
                          >
                            Resubscribe
                          </button>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>
          </div>

          {/* Footer */}
          <div class="p-3 sm:p-4 border-t border-[#E2DFD8]/70 dark:border-[#2E3138] flex items-center justify-between text-xs text-[#75777B] dark:text-[#8E918F] bg-[#FAF9F7] dark:bg-[#18191D]">
            <span>
              Showing {filteredSubscriptions().length} of {totalCount()} subscription{totalCount() !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-1.5 rounded-xl text-xs font-semibold text-[#55575B] dark:text-[#A8AAAA] hover:bg-stone-200 dark:hover:bg-[#282C34] transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>

        {/* Unsubscribe Confirmation Modal */}
        <Show when={confirmTarget()}>
          <UnsubscribeConfirmModal
            isOpen={Boolean(confirmTarget())}
            onClose={() => setConfirmTarget(null)}
            senderName={confirmTarget()!.senderName}
            senderEmail={confirmTarget()!.senderEmail}
            unsubscribeUrl={confirmTarget()!.unsubscribeUrl}
            messageCount={confirmTarget()!.messageCount}
            onConfirmUnsubscribe={handleConfirmUnsubscribe}
          />
        </Show>
      </div>
    </Show>
  );
};
