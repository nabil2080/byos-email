import { Component, createSignal, onMount, For, Show } from "solid-js";
import {
  Mailbox,
  AutoReplyRule,
  fetchAutoReplyRule,
  updateAutoReplyRule,
} from "../../api";

interface AutoReplyTabProps {
  mailbox: Mailbox;
}

export const AutoReplyTab: Component<AutoReplyTabProps> = (props) => {
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [savedSuccess, setSavedSuccess] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const [isActive, setIsActive] = createSignal(false);
  const [subjectTemplate, setSubjectTemplate] = createSignal("Out of Office: {subject}");
  const [bodyTemplate, setBodyTemplate] = createSignal(
    "Hello,\n\nThank you for reaching out. I am currently away and have limited access to email. I will respond to your message upon my return.\n\nBest regards"
  );
  const [replyAll, setReplyAll] = createSignal(false);
  const [startTime, setStartTime] = createSignal("");
  const [endTime, setEndTime] = createSignal("");

  const [allowedSenders, setAllowedSenders] = createSignal<string[]>([]);
  const [allowedInput, setAllowedInput] = createSignal("");

  const [blockedSenders, setBlockedSenders] = createSignal<string[]>([]);
  const [blockedInput, setBlockedInput] = createSignal("");

  onMount(async () => {
    try {
      setLoading(true);
      const rule = await fetchAutoReplyRule(props.mailbox.id);
      setIsActive(rule.is_active || false);
      if (rule.subject_template) setSubjectTemplate(rule.subject_template);
      if (rule.body_template) setBodyTemplate(rule.body_template);
      setReplyAll(rule.reply_all || false);
      setAllowedSenders(rule.allowed_senders || []);
      setBlockedSenders(rule.blocked_senders || []);

      if (rule.start_time) {
        setStartTime(new Date(rule.start_time).toISOString().slice(0, 16));
      }
      if (rule.end_time) {
        setEndTime(new Date(rule.end_time).toISOString().slice(0, 16));
      }
    } catch (err: any) {
      // If none exists, keep sensible defaults
      console.warn("No existing auto-reply rule found or failed to load:", err);
    } finally {
      setLoading(false);
    }
  });

  function addAllowedSender() {
    const val = allowedInput().trim();
    if (val && !allowedSenders().includes(val)) {
      setAllowedSenders([...allowedSenders(), val]);
      setAllowedInput("");
    }
  }

  function removeAllowedSender(sender: string) {
    setAllowedSenders(allowedSenders().filter((s) => s !== sender));
  }

  function addBlockedSender() {
    const val = blockedInput().trim();
    if (val && !blockedSenders().includes(val)) {
      setBlockedSenders([...blockedSenders(), val]);
      setBlockedInput("");
    }
  }

  function removeBlockedSender(sender: string) {
    setBlockedSenders(blockedSenders().filter((s) => s !== sender));
  }

  async function handleSave(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload: Partial<AutoReplyRule> = {
        is_active: isActive(),
        subject_template: subjectTemplate().trim(),
        body_template: bodyTemplate().trim(),
        reply_all: replyAll(),
        allowed_senders: allowedSenders(),
        blocked_senders: blockedSenders(),
        start_time: startTime() ? new Date(startTime()).toISOString() : undefined,
        end_time: endTime() ? new Date(endTime()).toISOString() : undefined,
      };

      await updateAutoReplyRule(props.mailbox.id, payload);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save auto-reply settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="space-y-6">
      <div>
        <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Automation & Auto-Reply</h3>
        <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-1">
          Configure automated vacation responders with loop prevention.
        </p>
      </div>

      <Show when={error()}>
        <div class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{error()}</span>
          <button onClick={() => setError(null)} class="text-rose-500 hover:text-rose-800 dark:hover:text-rose-200 p-0.5 cursor-pointer" title="Dismiss">
            <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </Show>

      <Show when={savedSuccess()}>
        <div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <svg class="w-4 h-4 text-emerald-600 dark:text-emerald-400 stroke-current fill-none stroke-[2.5]" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>Auto-reply rule saved successfully.</span>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-8 border border-[#E2DFD8] dark:border-[#2E3138] text-center">
          <div class="inline-block animate-spin w-6 h-6 border-2 border-[#A27561] border-t-transparent rounded-full mb-2"></div>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">Loading auto-reply configuration…</p>
        </div>
      </Show>

      <Show when={!loading()}>
        <form onSubmit={handleSave} class="space-y-6">
          {/* Main Activation Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Vacation Responder Status
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  When active, incoming messages automatically receive your template response.
                </p>
              </div>

              {/* Toggle Switch */}
              <label class="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive()}
                  onChange={(e) => setIsActive(e.currentTarget.checked)}
                  class="sr-only peer"
                />
                <div class="w-11 h-6 bg-stone-300 dark:bg-stone-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#A27561]"></div>
              </label>
            </div>

            {/* Time Window */}
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138]">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Start Date & Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={startTime()}
                  onInput={(e) => setStartTime(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  End Date & Time (Optional)
                </label>
                <input
                  type="datetime-local"
                  value={endTime()}
                  onInput={(e) => setEndTime(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
                />
              </div>
            </div>
          </div>

          {/* Template Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
              Auto-Reply Message Template
            </h4>

            <div>
              <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                Subject Template
              </label>
              <input
                type="text"
                placeholder="Out of Office: {subject}"
                value={subjectTemplate()}
                onInput={(e) => setSubjectTemplate(e.currentTarget.value)}
                required
                class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs font-mono text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
              />
              <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] mt-1">
                Use <code class="font-mono text-[#A27561] dark:text-[#D4A38F] bg-[#F3ECE8] dark:bg-[#2D2522] px-1 rounded">&#123;subject&#125;</code> to interpolate the sender's original subject line.
              </p>
            </div>

            <div>
              <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                Response Body
              </label>
              <textarea
                rows={6}
                value={bodyTemplate()}
                onInput={(e) => setBodyTemplate(e.currentTarget.value)}
                required
                class="w-full p-3 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs font-sans text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition resize-y"
              ></textarea>
            </div>

            <div class="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="replyAll"
                checked={replyAll()}
                onChange={(e) => setReplyAll(e.currentTarget.checked)}
                class="w-4 h-4 rounded text-[#A27561] border-[#E2DFD8] dark:border-[#2E3138] focus:ring-[#A27561]"
              />
              <label for="replyAll" class="text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer">
                Send auto-reply to CC'd recipients as well (Reply All)
              </label>
            </div>
          </div>

          {/* Senders Whitelist / Blacklist Filters */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
              Audience Filtering (Allowed & Blocked)
            </h4>

            {/* Allowed Senders */}
            <div>
              <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                Only Reply to Senders Matching (Whitelist)
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. @company.com or alice@client.org"
                  value={allowedInput()}
                  onInput={(e) => setAllowedInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addAllowedSender();
                    }
                  }}
                  class="flex-1 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
                />
                <button
                  type="button"
                  onClick={addAllowedSender}
                  class="px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#464748] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
                >
                  Add
                </button>
              </div>

              <div class="flex flex-wrap gap-1.5 mt-2">
                <For each={allowedSenders()}>
                  {(sender) => (
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50 text-xs font-mono">
                      <span>{sender}</span>
                      <button
                        type="button"
                        onClick={() => removeAllowedSender(sender)}
                        class="hover:text-emerald-950 dark:hover:text-emerald-100 p-0.5 cursor-pointer"
                        title="Remove"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  )}
                </For>
              </div>
              <p class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] mt-1">
                Leave empty to reply to all legitimate non-bulk senders.
              </p>
            </div>

            {/* Blocked Senders */}
            <div class="pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138]">
              <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                Never Reply to Senders Matching (Blacklist)
              </label>
              <div class="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. @noreply.com or newsletter@domain.com"
                  value={blockedInput()}
                  onInput={(e) => setBlockedInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addBlockedSender();
                    }
                  }}
                  class="flex-1 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561] focus:bg-white dark:focus:bg-[#1E2025] transition"
                />
                <button
                  type="button"
                  onClick={addBlockedSender}
                  class="px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#464748] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
                >
                  Add
                </button>
              </div>

              <div class="flex flex-wrap gap-1.5 mt-2">
                <For each={blockedSenders()}>
                  {(sender) => (
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 text-xs font-mono">
                      <span>{sender}</span>
                      <button
                        type="button"
                        onClick={() => removeBlockedSender(sender)}
                        class="hover:text-rose-950 dark:hover:text-rose-100 p-0.5 cursor-pointer"
                        title="Remove"
                      >
                        <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </span>
                  )}
                </For>
              </div>
            </div>
          </div>

          {/* Loop Prevention Note */}
          <div class="p-4 rounded-xl bg-[#F8F7F4] dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#6E7075] dark:text-[#A1A1AA] space-y-1">
            <span class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6] block">Loop Prevention:</span>
            Automatic replies will only be sent once to each sender to prevent loops.
          </div>

          {/* Submit */}
          <div class="flex justify-end pt-2">
            <button
              type="submit"
              disabled={saving()}
              class="px-5 py-2.5 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] transition disabled:opacity-50 flex items-center gap-2 shadow-sm cursor-pointer"
            >
              <Show when={saving()}>
                <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </Show>
              <span>{saving() ? "Saving Changes…" : "Save Auto-Reply Rule"}</span>
            </button>
          </div>
        </form>
      </Show>
    </div>
  );
};
