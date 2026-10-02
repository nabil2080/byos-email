import { Component, createSignal, onMount, For, Show } from "solid-js";
import {
  Mailbox,
  MailRule,
  MailboxLabel,
  AddressRuleItem,
  fetchRules,
  createRule,
  updateRule,
  deleteRule,
  fetchLabels,
  fetchMessages,
  fetchAddressRules,
  createAddressRule,
  deleteAddressRule,
} from "../../api";

interface FiltersTabProps {
  mailbox: Mailbox;
}

export const FiltersTab: Component<FiltersTabProps> = (props) => {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [successMsg, setSuccessMsg] = createSignal<string | null>(null);

  // Mail Rules State
  const [rules, setRules] = createSignal<MailRule[]>([]);
  const [labels, setLabels] = createSignal<MailboxLabel[]>([]);
  const [ruleModalOpen, setRuleModalOpen] = createSignal(false);
  const [savingRule, setSavingRule] = createSignal(false);

  // Create / Edit Rule Form State
  const [editingRuleId, setEditingRuleId] = createSignal<string | null>(null);
  const [ruleName, setRuleName] = createSignal("");
  const [ruleEnabled, setRuleEnabled] = createSignal(true);
  const [matchSender, setMatchSender] = createSignal("");
  const [matchRecipient, setMatchRecipient] = createSignal("");
  const [matchAttachments, setMatchAttachments] = createSignal<"any" | "yes" | "no">("any");
  const [matchMinSizeKB, setMatchMinSizeKB] = createSignal<string>("");
  const [actionType, setActionType] = createSignal<"move" | "label" | "mark_read" | "delete">("move");
  const [actionFolder, setActionFolder] = createSignal("archive");
  const [actionLabelId, setActionLabelId] = createSignal("");

  // Test Rule State
  const [testingRule, setTestingRule] = createSignal(false);
  const [testResult, setTestResult] = createSignal<string | null>(null);

  // Address Rules (Spam, Block, Allow) State
  const [activeRuleTab, setActiveRuleTab] = createSignal<"spam" | "block" | "allow">("spam");
  const [addressRules, setAddressRules] = createSignal<AddressRuleItem[]>([]);
  const [addAddressModalOpen, setAddAddressModalOpen] = createSignal(false);
  const [newRuleListType, setNewRuleListType] = createSignal<"spam" | "block" | "allow">("spam");
  const [newRuleValue, setNewRuleValue] = createSignal("");
  const [savingAddressRule, setSavingAddressRule] = createSignal(false);

  async function loadData() {
    try {
      setLoading(true);
      const [rulesList, labelsList, addressRulesList] = await Promise.all([
        fetchRules(props.mailbox.id),
        fetchLabels(props.mailbox.id),
        fetchAddressRules(props.mailbox.id),
      ]);
      setRules(rulesList);
      setLabels(labelsList);
      setAddressRules(addressRulesList);
      if (labelsList.length > 0 && !actionLabelId()) {
        setActionLabelId(labelsList[0].id);
      }
    } catch (err: any) {
      console.error("Failed to load filters and rules:", err);
      setError("Failed to load rules");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadData();
  });

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  }

  // ── Mail Rules Actions ──
  function openCreateRule() {
    setEditingRuleId(null);
    setRuleName("");
    setRuleEnabled(true);
    setMatchSender("");
    setMatchRecipient("");
    setMatchAttachments("any");
    setMatchMinSizeKB("");
    setActionType("move");
    setActionFolder("archive");
    if (labels().length > 0) {
      setActionLabelId(labels()[0].id);
    } else {
      setActionLabelId("");
    }
    setTestResult(null);
    setRuleModalOpen(true);
  }

  function openEditRule(rule: MailRule) {
    setEditingRuleId(rule.id);
    setRuleName(rule.name);
    setRuleEnabled(rule.enabled);
    setMatchSender(rule.match_sender || "");
    setMatchRecipient(rule.match_recipient || "");
    if (rule.match_has_attachments === true) {
      setMatchAttachments("yes");
    } else if (rule.match_has_attachments === false) {
      setMatchAttachments("no");
    } else {
      setMatchAttachments("any");
    }
    setMatchMinSizeKB(
      rule.match_min_size_bytes != null && rule.match_min_size_bytes > 0
        ? Math.round(rule.match_min_size_bytes / 1024).toString()
        : ""
    );
    setActionType(rule.action_type);
    setActionFolder(rule.action_folder || "archive");
    setActionLabelId(rule.action_label_id || (labels()[0]?.id || ""));
    setTestResult(null);
    setRuleModalOpen(true);
  }

  async function handleToggleRuleEnabled(rule: MailRule) {
    try {
      const updated = await updateRule(props.mailbox.id, rule.id, {
        enabled: !rule.enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err: any) {
      setError(err?.message || "Failed to toggle rule.");
    }
  }

  async function handleDeleteRule(rule: MailRule) {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await deleteRule(props.mailbox.id, rule.id);
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      showSuccess(`Rule "${rule.name}" deleted.`);
    } catch (err: any) {
      setError(err?.message || "Failed to delete rule.");
    }
  }

  async function handleTestRule() {
    setTestingRule(true);
    setTestResult(null);
    try {
      const allMsgs = await fetchMessages(props.mailbox.id);
      const sample = allMsgs.slice(0, 20);
      if (sample.length === 0) {
        setTestResult("No messages in mailbox to test against.");
        return;
      }

      const senderFilter = matchSender().trim().toLowerCase();
      const recipientFilter = matchRecipient().trim().toLowerCase();
      const attachmentsChoice = matchAttachments();
      const minKB = parseInt(matchMinSizeKB().trim(), 10);
      const minBytes = !isNaN(minKB) && minKB > 0 ? minKB * 1024 : null;

      let matchCount = 0;
      for (const msg of sample) {
        if (senderFilter && !msg.sender.toLowerCase().includes(senderFilter)) {
          continue;
        }
        if (recipientFilter) {
          const recMatches = (msg.recipients || []).some((r) =>
            r.toLowerCase().includes(recipientFilter)
          );
          if (!recMatches) continue;
        }
        if (attachmentsChoice === "yes" && !msg.has_attachments) {
          continue;
        }
        if (attachmentsChoice === "no" && msg.has_attachments) {
          continue;
        }
        if (minBytes !== null && (msg.size_bytes || 0) < minBytes) {
          continue;
        }
        matchCount++;
      }

      setTestResult(`Matched ${matchCount} of the last ${sample.length} message(s).`);
    } catch (err: any) {
      setTestResult("Could not test: " + (err?.message || "failed to fetch messages"));
    } finally {
      setTestingRule(false);
    }
  }

  async function handleSaveRule(e: Event) {
    e.preventDefault();
    if (!ruleName().trim()) return;

    if (actionType() === "move" && !actionFolder().trim()) {
      setError("Please select a target folder.");
      return;
    }
    if (actionType() === "label" && !actionLabelId()) {
      setError("Please select a label to apply.");
      return;
    }

    setSavingRule(true);
    setError(null);

    const minKB = parseInt(matchMinSizeKB().trim(), 10);
    const minBytes = !isNaN(minKB) && minKB > 0 ? minKB * 1024 : null;

    let hasAtt: boolean | null = null;
    if (matchAttachments() === "yes") hasAtt = true;
    if (matchAttachments() === "no") hasAtt = false;

    const payload: Partial<MailRule> = {
      name: ruleName().trim(),
      enabled: ruleEnabled(),
      match_sender: matchSender().trim() || null,
      match_recipient: matchRecipient().trim() || null,
      match_has_attachments: hasAtt,
      match_min_size_bytes: minBytes,
      action_type: actionType(),
      action_folder: actionType() === "move" ? actionFolder().trim() : (actionType() === "delete" ? "trash" : null),
      action_label_id: actionType() === "label" ? actionLabelId() : null,
    };

    try {
      if (editingRuleId()) {
        const updated = await updateRule(props.mailbox.id, editingRuleId()!, payload);
        setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showSuccess(`Rule "${updated.name}" updated.`);
      } else {
        const created = await createRule(props.mailbox.id, payload);
        setRules((prev) => [...prev, created]);
        showSuccess(`Rule "${created.name}" created.`);
      }
      setRuleModalOpen(false);
    } catch (err: any) {
      setError(err?.message || "Failed to save rule.");
    } finally {
      setSavingRule(false);
    }
  }

  // ── Address Rules (Spam, Block, Allow) ──
  const currentTabRules = () => addressRules().filter((r) => r.list_type === activeRuleTab());

  async function handleAddAddressRule(e: Event) {
    e.preventDefault();
    const val = newRuleValue().trim();
    if (!val) return;
    setSavingAddressRule(true);
    setError(null);
    try {
      const created = await createAddressRule(props.mailbox.id, {
        list_type: newRuleListType(),
        value: val,
      });
      setAddressRules((prev) => [created, ...prev]);
      setAddAddressModalOpen(false);
      setNewRuleValue("");
      showSuccess(`Added "${val}" to ${newRuleListType()} list.`);
    } catch (err: any) {
      setError(err?.message || "Failed to add address rule.");
    } finally {
      setSavingAddressRule(false);
    }
  }

  async function handleDeleteAddressRule(rule: AddressRuleItem) {
    try {
      await deleteAddressRule(props.mailbox.id, rule.id);
      setAddressRules((prev) => prev.filter((r) => r.id !== rule.id));
      showSuccess(`Removed "${rule.value}".`);
    } catch (err: any) {
      setError(err?.message || "Failed to delete address rule.");
    }
  }

  function getLabelName(labelId?: string | null): string {
    if (!labelId) return "Label";
    const found = labels().find((l) => l.id === labelId);
    return found ? (found.path || found.name) : "Label";
  }

  function formatConditions(rule: MailRule): string {
    const parts: string[] = [];
    if (rule.match_sender) {
      parts.push(`From contains "${rule.match_sender}"`);
    }
    if (rule.match_recipient) {
      parts.push(`To/Cc contains "${rule.match_recipient}"`);
    }
    if (rule.match_has_attachments === true) {
      parts.push("Has attachments");
    } else if (rule.match_has_attachments === false) {
      parts.push("No attachments");
    }
    if (rule.match_min_size_bytes) {
      parts.push(`Size ≥ ${Math.round(rule.match_min_size_bytes / 1024)} KB`);
    }
    return parts.length > 0 ? parts.join(" • ") : "Matches all incoming messages";
  }

  function formatAction(rule: MailRule): string {
    switch (rule.action_type) {
      case "move":
        return `Move to "${rule.action_folder || "folder"}"`;
      case "label":
        return `Apply label "${getLabelName(rule.action_label_id)}"`;
      case "mark_read":
        return "Mark as read";
      case "delete":
        return "Delete (move to Trash)";
      default:
        return rule.action_type;
    }
  }

  return (
    <div class="space-y-6 pb-12">
      <div>
        <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Filters & Rules</h3>
        <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-1">
          Automate message sorting at ingest based on sender, recipient, attachments, and size.
        </p>
      </div>

      <Show when={error()}>
        <div class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5">
            <span>⚠</span>
            <span>{error()}</span>
          </div>
          <button onClick={() => setError(null)} class="text-rose-500 hover:text-rose-800 p-1 cursor-pointer">✕</button>
        </div>
      </Show>

      <Show when={successMsg()}>
        <div class="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
          <svg class="w-4 h-4 stroke-emerald-600 stroke-2 fill-none" viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{successMsg()}</span>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-8 border border-[#E2DFD8] dark:border-[#2E3138] text-center">
          <div class="inline-block animate-spin w-6 h-6 border-2 border-[#A27561] border-t-transparent rounded-full mb-2"></div>
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">Loading rules and filters…</p>
        </div>
      </Show>

      <Show when={!loading()}>
        <div class="space-y-6">
          {/* 1. Mail Rules Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Mail Rules
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Rules evaluate at ingest time. First matching rule takes effect. Subject and body remain end-to-end encrypted.
                </p>
              </div>

              <button
                type="button"
                onClick={openCreateRule}
                class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Add Rule</span>
              </button>
            </div>

            {/* Rules List */}
            <div class="border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden divide-y divide-[#E2DFD8] dark:divide-[#2E3138]">
              <Show
                when={rules().length > 0}
                fallback={
                  <div class="p-8 text-center text-xs text-[#6E7075] dark:text-[#A1A1AA]">
                    No mail rules configured. Click "Add Rule" to automatically sort your incoming mail.
                  </div>
                }
              >
                <For each={rules()}>
                  {(rule) => (
                    <div class="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F8F7F4] dark:hover:bg-[#18191D] transition">
                      <div class="space-y-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] truncate">
                            {rule.name}
                          </span>
                          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#252830] text-[#6E7075] dark:text-[#A1A1AA] border border-[#E2DFD8] dark:border-[#2E3138]">
                            {rule.action_type}
                          </span>
                        </div>
                        <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] truncate">
                          {formatConditions(rule)}
                        </div>
                        <div class="text-[11px] font-medium text-[#A27561] dark:text-[#C59B89]">
                          → {formatAction(rule)}
                        </div>
                      </div>

                      <div class="flex items-center gap-2.5 self-end sm:self-auto shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleRuleEnabled(rule)}
                          class={`px-2.5 py-1 rounded-full text-[11px] font-mono font-medium border transition cursor-pointer ${
                            rule.enabled
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                              : "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700"
                          }`}
                        >
                          {rule.enabled ? "Enabled" : "Disabled"}
                        </button>

                        <button
                          type="button"
                          onClick={() => openEditRule(rule)}
                          class="p-1.5 text-[#6E7075] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] rounded-lg transition cursor-pointer"
                          title="Edit Rule"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteRule(rule)}
                          class="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition cursor-pointer"
                          title="Delete Rule"
                        >
                          <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>

          {/* 2. Spam, Block, and Allow Lists Card (preserved) */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Spam, Block, and Allow Lists
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Manage static sender and domain inbound policies:
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setNewRuleListType(activeRuleTab());
                  setNewRuleValue("");
                  setAddAddressModalOpen(true);
                }}
                class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Add Address or Domain</span>
              </button>
            </div>

            {/* List Type Tabs */}
            <div class="flex border-b border-[#E2DFD8] dark:border-[#2E3138] gap-6 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveRuleTab("spam")}
                class={`pb-3 transition relative cursor-pointer ${
                  activeRuleTab() === "spam"
                    ? "text-[#A27561] font-bold border-b-2 border-[#A27561]"
                    : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
                }`}
              >
                <span>Spam ({addressRules().filter((r) => r.list_type === "spam").length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveRuleTab("block")}
                class={`pb-3 transition relative cursor-pointer ${
                  activeRuleTab() === "block"
                    ? "text-[#A27561] font-bold border-b-2 border-[#A27561]"
                    : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
                }`}
              >
                <span>Block ({addressRules().filter((r) => r.list_type === "block").length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveRuleTab("allow")}
                class={`pb-3 transition relative cursor-pointer ${
                  activeRuleTab() === "allow"
                    ? "text-[#A27561] font-bold border-b-2 border-[#A27561]"
                    : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
                }`}
              >
                <span>Allow ({addressRules().filter((r) => r.list_type === "allow").length})</span>
              </button>
            </div>

            {/* Address Rule Items Table */}
            <div class="border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden divide-y divide-[#E2DFD8] dark:divide-[#2E3138]">
              <Show
                when={currentTabRules().length > 0}
                fallback={
                  <div class="p-8 text-center text-xs text-[#6E7075] dark:text-[#A1A1AA]">
                    No addresses or domains currently on the {activeRuleTab()} list.
                  </div>
                }
              >
                <For each={currentTabRules()}>
                  {(rule) => (
                    <div class="p-3.5 flex items-center justify-between hover:bg-[#F8F7F4] dark:hover:bg-[#18191D] transition">
                      <div class="flex items-center gap-3">
                        <span class="text-xs font-mono font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                          {rule.value}
                        </span>
                        <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#252830] text-[#6E7075] dark:text-[#A1A1AA]">
                          {rule.target_type}
                        </span>
                      </div>

                      <div class="flex items-center gap-3">
                        <span class="text-[11px] text-[#878A8E] font-mono">
                          Added {new Date(rule.created_at).toLocaleDateString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDeleteAddressRule(rule)}
                          class="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition cursor-pointer"
                          title="Remove from list"
                        >
                          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
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

      {/* ── CREATE / EDIT RULE MODAL ── */}
      <Show when={ruleModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                {editingRuleId() ? "Edit Mail Rule" : "Create Mail Rule"}
              </h3>
              <button onClick={() => setRuleModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveRule} class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Rule Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Move newsletters to archive"
                  value={ruleName()}
                  onInput={(e) => setRuleName(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rule-enabled-chk"
                  checked={ruleEnabled()}
                  onChange={(e) => setRuleEnabled(e.currentTarget.checked)}
                  class="rounded border-[#E2DFD8] text-[#A27561] focus:ring-[#A27561]"
                />
                <label for="rule-enabled-chk" class="text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer">
                  Rule enabled
                </label>
              </div>

              {/* Conditions Section */}
              <div class="p-3 bg-[#F8F7F4] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                    Conditions (All specified must match — AND)
                  </span>
                  <span class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA]">
                    Leave blank to match any
                  </span>
                </div>

                <div>
                  <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA] mb-0.5">
                    Sender contains:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. @notifications.github.com or newsletter"
                    value={matchSender()}
                    onInput={(e) => setMatchSender(e.currentTarget.value)}
                    class="w-full px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
                  />
                </div>

                <div>
                  <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA] mb-0.5">
                    Recipient contains:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. dev+alerts@domain.com"
                    value={matchRecipient()}
                    onInput={(e) => setMatchRecipient(e.currentTarget.value)}
                    class="w-full px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
                  />
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA] mb-0.5">
                      Has Attachments:
                    </label>
                    <select
                      value={matchAttachments()}
                      onChange={(e) => setMatchAttachments(e.currentTarget.value as any)}
                      class="w-full px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                    >
                      <option value="any">Any</option>
                      <option value="yes">Yes (Must have attachments)</option>
                      <option value="no">No (Must have no attachments)</option>
                    </select>
                  </div>

                  <div>
                    <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA] mb-0.5">
                      Min Size (KB):
                    </label>
                    <input
                      type="number"
                      min="0"
                      placeholder="e.g. 50"
                      value={matchMinSizeKB()}
                      onInput={(e) => setMatchMinSizeKB(e.currentTarget.value)}
                      class="w-full px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
                    />
                  </div>
                </div>
              </div>

              {/* Action Section */}
              <div class="space-y-3 pt-2">
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
                  Action
                </label>

                <select
                  value={actionType()}
                  onChange={(e) => setActionType(e.currentTarget.value as any)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer font-medium"
                >
                  <option value="move">Move to folder</option>
                  <option value="label">Apply label</option>
                  <option value="mark_read">Mark as read</option>
                  <option value="delete">Delete (move to Trash)</option>
                </select>

                <Show when={actionType() === "move"}>
                  <div class="space-y-1">
                    <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA]">
                      Target Folder:
                    </label>
                    <select
                      value={actionFolder()}
                      onChange={(e) => setActionFolder(e.currentTarget.value)}
                      class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                    >
                      <option value="inbox">Inbox</option>
                      <option value="archive">Archive</option>
                      <option value="spam">Spam</option>
                      <option value="trash">Trash</option>
                    </select>
                  </div>
                </Show>

                <Show when={actionType() === "label"}>
                  <div class="space-y-1">
                    <label class="block text-[11px] font-medium text-[#6E7075] dark:text-[#A1A1AA]">
                      Select Label:
                    </label>
                    <Show
                      when={labels().length > 0}
                      fallback={
                        <p class="text-xs text-rose-500">
                          No labels found. Create a label in Settings → Labels first.
                        </p>
                      }
                    >
                      <select
                        value={actionLabelId()}
                        onChange={(e) => setActionLabelId(e.currentTarget.value)}
                        class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                      >
                        <For each={labels()}>
                          {(lbl) => (
                            <option value={lbl.id}>
                              {lbl.path || lbl.name} ({lbl.color_name})
                            </option>
                          )}
                        </For>
                      </select>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Test Rule Section */}
              <div class="p-3 bg-[#F0EEE9] dark:bg-[#252830] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA]">
                  <span class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Verification: </span>
                  Test conditions against recent messages.
                </div>
                <button
                  type="button"
                  onClick={handleTestRule}
                  disabled={testingRule()}
                  class="px-3 py-1.5 bg-white dark:bg-[#1E2025] hover:border-[#A27561] border border-[#E2DFD8] dark:border-[#2E3138] text-[#1A1B1E] dark:text-[#F3F4F6] text-xs font-semibold rounded-lg transition cursor-pointer self-start sm:self-auto disabled:opacity-50"
                >
                  {testingRule() ? "Testing…" : "Test against last 20 messages"}
                </button>
              </div>

              <Show when={testResult()}>
                <div class="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900/50 text-sky-800 dark:text-sky-300 text-xs font-mono">
                  {testResult()}
                </div>
              </Show>

              {/* Footer Buttons */}
              <div class="flex justify-end gap-2 pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                <button
                  type="button"
                  onClick={() => setRuleModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRule()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] cursor-pointer disabled:opacity-50"
                >
                  {savingRule() ? "Saving Rule…" : "Save Rule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* ── ADD ADDRESS RULE MODAL (Spam, Block, Allow) ── */}
      <Show when={addAddressModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-md w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                Add Address or Domain
              </h3>
              <button onClick={() => setAddAddressModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleAddAddressRule} class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  List Type
                </label>
                <select
                  value={newRuleListType()}
                  onChange={(e) => setNewRuleListType(e.currentTarget.value as any)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                >
                  <option value="spam">Spam (routes to Spam folder)</option>
                  <option value="block">Block (drops/blocks message)</option>
                  <option value="allow">Allow (always delivers to Inbox)</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Email Address or Domain
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. spammer@bad.com or @phishing.org"
                  value={newRuleValue()}
                  onInput={(e) => setNewRuleValue(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
                <p class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA] mt-1">
                  Enter an address (user@domain.com) or a domain (@domain.com or domain.com).
                </p>
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAddAddressModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAddressRule()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] cursor-pointer"
                >
                  {savingAddressRule() ? "Adding…" : "Add to List"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};
