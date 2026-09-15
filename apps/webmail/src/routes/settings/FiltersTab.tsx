import { Component, createSignal, onMount, For, Show } from "solid-js";
import {
  Mailbox,
  FilterItem,
  AddressRuleItem,
  FilterCondition,
  FilterRulesJSON,
  fetchFilters,
  createFilter,
  updateFilter,
  deleteFilter,
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

  // Filters State
  const [filters, setFilters] = createSignal<FilterItem[]>([]);
  const [customFilterModalOpen, setCustomFilterModalOpen] = createSignal(false);
  const [sieveFilterModalOpen, setSieveFilterModalOpen] = createSignal(false);
  const [savingFilter, setSavingFilter] = createSignal(false);

  // Custom Filter Builder State
  const [editingFilterId, setEditingFilterId] = createSignal<string | null>(null);
  const [filterName, setFilterName] = createSignal("");
  const [filterMatch, setFilterMatch] = createSignal<"all" | "any">("all");
  const [filterConditions, setFilterConditions] = createSignal<FilterCondition[]>([
    { field: "from", comparator: "contains", value: "" },
  ]);
  const [actionMoveFolder, setActionMoveFolder] = createSignal("archive");
  const [actionApplyMove, setActionApplyMove] = createSignal(false);
  const [actionMarkRead, setActionMarkRead] = createSignal(false);
  const [actionStar, setActionStar] = createSignal(false);

  // Sieve Filter Builder State
  const [sieveFilterName, setSieveFilterName] = createSignal("");
  const [sieveScript, setSieveScript] = createSignal(
    `require ["fileinto", "imap4flags"];\n\nif header :contains "subject" "receipt" {\n    fileinto "Receipts";\n    setflag "\\\\Seen";\n}`
  );

  // Address Rules (Spam, Block, Allow) State
  const [activeRuleTab, setActiveRuleTab] = createSignal<"spam" | "block" | "allow">("spam");
  const [addressRules, setAddressRules] = createSignal<AddressRuleItem[]>([]);
  const [addRuleModalOpen, setAddRuleModalOpen] = createSignal(false);
  const [newRuleListType, setNewRuleListType] = createSignal<"spam" | "block" | "allow">("spam");
  const [newRuleValue, setNewRuleValue] = createSignal("");
  const [savingRule, setSavingRule] = createSignal(false);

  async function loadData() {
    try {
      setLoading(true);
      const [fList, rList] = await Promise.all([
        fetchFilters(props.mailbox.id),
        fetchAddressRules(props.mailbox.id),
      ]);
      setFilters(fList);
      setAddressRules(rList);
    } catch (err: any) {
      setError(err?.message || "Failed to load filters and rules.");
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

  // ── Custom Filter Actions ──
  function handleAddCondition() {
    setFilterConditions((prev) => [...prev, { field: "from", comparator: "contains", value: "" }]);
  }

  function handleRemoveCondition(index: number) {
    setFilterConditions((prev) => prev.filter((_, i) => i !== index));
  }

  function handleUpdateCondition(index: number, key: keyof FilterCondition, val: any) {
    setFilterConditions((prev) =>
      prev.map((c, i) => (i === index ? { ...c, [key]: val } : c))
    );
  }

  function openCreateCustomFilter() {
    setEditingFilterId(null);
    setFilterName("");
    setFilterMatch("all");
    setFilterConditions([{ field: "from", comparator: "contains", value: "" }]);
    setActionApplyMove(false);
    setActionMoveFolder("archive");
    setActionMarkRead(false);
    setActionStar(false);
    setCustomFilterModalOpen(true);
  }

  function openEditCustomFilter(item: FilterItem) {
    setEditingFilterId(item.id);
    setFilterName(item.name);
    if (item.rules_json) {
      setFilterMatch(item.rules_json.match || "all");
      setFilterConditions(
        item.rules_json.conditions?.length
          ? item.rules_json.conditions
          : [{ field: "from", comparator: "contains", value: "" }]
      );
      if (item.rules_json.actions?.folder) {
        setActionApplyMove(true);
        setActionMoveFolder(item.rules_json.actions.folder);
      } else {
        setActionApplyMove(false);
      }
      setActionMarkRead(Boolean(item.rules_json.actions?.mark_read));
      setActionStar(Boolean(item.rules_json.actions?.star));
    }
    setCustomFilterModalOpen(true);
  }

  async function handleSaveCustomFilter(e: Event) {
    e.preventDefault();
    if (!filterName().trim()) return;
    setSavingFilter(true);
    setError(null);

    const rulesJSON: FilterRulesJSON = {
      match: filterMatch(),
      conditions: filterConditions().filter((c) => c.value.trim() !== ""),
      actions: {
        folder: actionApplyMove() ? actionMoveFolder() : undefined,
        mark_read: actionMarkRead() || undefined,
        star: actionStar() || undefined,
      },
    };

    try {
      if (editingFilterId()) {
        const updated = await updateFilter(props.mailbox.id, editingFilterId()!, {
          name: filterName().trim(),
          filter_type: "custom",
          rules_json: rulesJSON,
        });
        setFilters((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
        showSuccess(`Filter "${updated.name}" updated.`);
      } else {
        const created = await createFilter(props.mailbox.id, {
          name: filterName().trim(),
          filter_type: "custom",
          rules_json: rulesJSON,
        });
        setFilters((prev) => [...prev, created]);
        showSuccess(`Filter "${created.name}" created.`);
      }
      setCustomFilterModalOpen(false);
    } catch (err: any) {
      setError(err?.message || "Failed to save filter.");
    } finally {
      setSavingFilter(false);
    }
  }

  // ── Sieve Filter Actions ──
  function openCreateSieveFilter() {
    setSieveFilterName("");
    setSieveFilterModalOpen(true);
  }

  async function handleSaveSieveFilter(e: Event) {
    e.preventDefault();
    if (!sieveFilterName().trim() || !sieveScript().trim()) return;
    setSavingFilter(true);
    setError(null);
    try {
      const created = await createFilter(props.mailbox.id, {
        name: sieveFilterName().trim(),
        filter_type: "sieve",
        sieve_script: sieveScript(),
      });
      setFilters((prev) => [...prev, created]);
      setSieveFilterModalOpen(false);
      showSuccess(`Sieve filter "${created.name}" saved.`);
    } catch (err: any) {
      setError(err?.message || "Failed to save Sieve filter.");
    } finally {
      setSavingFilter(false);
    }
  }

  async function handleToggleFilterActive(filter: FilterItem) {
    try {
      const updated = await updateFilter(props.mailbox.id, filter.id, {
        is_active: !filter.is_active,
      });
      setFilters((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } catch (err: any) {
      setError(err?.message || "Failed to toggle filter status.");
    }
  }

  async function handleDeleteFilter(filter: FilterItem) {
    if (!confirm(`Delete filter "${filter.name}"?`)) return;
    try {
      await deleteFilter(props.mailbox.id, filter.id);
      setFilters((prev) => prev.filter((f) => f.id !== filter.id));
      showSuccess(`Filter "${filter.name}" deleted.`);
    } catch (err: any) {
      setError(err?.message || "Failed to delete filter.");
    }
  }

  // ── Address Rules (Spam, Block, Allow) ──
  const currentTabRules = () => addressRules().filter((r) => r.list_type === activeRuleTab());

  async function handleAddAddressRule(e: Event) {
    e.preventDefault();
    const val = newRuleValue().trim();
    if (!val) return;
    setSavingRule(true);
    setError(null);
    try {
      const created = await createAddressRule(props.mailbox.id, {
        list_type: newRuleListType(),
        value: val,
      });
      setAddressRules((prev) => [created, ...prev]);
      setAddRuleModalOpen(false);
      setNewRuleValue("");
      showSuccess(`Added "${val}" to ${newRuleListType()} list.`);
    } catch (err: any) {
      setError(err?.message || "Failed to add address rule.");
    } finally {
      setSavingRule(false);
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

  return (
    <div class="space-y-6 pb-12">
      <div>
        <h3 class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Filters & Rules</h3>
        <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-1">
          Automate message sorting with visual custom rules, Sieve scripts, and inbound address lists.
        </p>
      </div>

      <Show when={error()}>
        <div class="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
          <span>{error()}</span>
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
          <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA]">Loading filters and address rules…</p>
        </div>
      </Show>

      <Show when={!loading()}>
        <div class="space-y-6">
          {/* 1. Custom & Sieve Filters Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Custom Filters
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Add a custom filter to automatically perform certain actions, like labeling or archiving messages.
                </p>
              </div>

              <div class="flex items-center gap-2">
                <button
                  type="button"
                  onClick={openCreateCustomFilter}
                  class="px-4 py-2 bg-[#A27561] hover:bg-[#8F6452] text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Add Filter</span>
                </button>

                <button
                  type="button"
                  onClick={openCreateSieveFilter}
                  class="px-4 py-2 border border-[#E2DFD8] dark:border-[#2E3138] hover:border-[#A27561] text-[#1A1B1E] dark:text-[#F3F4F6] text-xs font-semibold rounded-xl transition hover:bg-[#F3ECE8] dark:hover:bg-[#252830] flex items-center gap-1.5 cursor-pointer"
                >
                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  <span>Add Sieve Filter</span>
                </button>
              </div>
            </div>

            {/* Filter List */}
            <div class="border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl overflow-hidden divide-y divide-[#E2DFD8] dark:divide-[#2E3138]">
              <Show
                when={filters().length > 0}
                fallback={
                  <div class="p-8 text-center text-xs text-[#6E7075] dark:text-[#A1A1AA]">
                    No custom filters configured. Click "Add Filter" to create your first inbox sorting rule.
                  </div>
                }
              >
                <For each={filters()}>
                  {(item) => (
                    <div class="p-4 flex items-center justify-between hover:bg-[#F8F7F4] dark:hover:bg-[#18191D] transition">
                      <div class="space-y-1">
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                            {item.name}
                          </span>
                          <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#F0EEE9] dark:bg-[#252830] text-[#6E7075] dark:text-[#A1A1AA] border border-[#E2DFD8] dark:border-[#2E3138]">
                            {item.filter_type}
                          </span>
                        </div>
                        <Show when={item.filter_type === "custom" && item.rules_json}>
                          <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA]">
                            Matches {item.rules_json!.match === "all" ? "all" : "any"} of {item.rules_json!.conditions?.length || 0} condition(s)
                            {item.rules_json!.actions?.folder && ` • Move to "${item.rules_json!.actions.folder}"`}
                            {item.rules_json!.actions?.mark_read && " • Mark as read"}
                            {item.rules_json!.actions?.star && " • Star"}
                          </div>
                        </Show>
                        <Show when={item.filter_type === "sieve"}>
                          <div class="text-[11px] text-[#6E7075] dark:text-[#A1A1AA] font-mono truncate max-w-md">
                            RFC 5228 Sieve Script
                          </div>
                        </Show>
                      </div>

                      <div class="flex items-center gap-3">
                        {/* Toggle active */}
                        <button
                          type="button"
                          onClick={() => handleToggleFilterActive(item)}
                          class={`px-2.5 py-1 rounded-full text-[11px] font-mono font-medium border transition cursor-pointer ${
                            item.is_active
                              ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
                              : "bg-stone-100 text-stone-600 border-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:border-stone-700"
                          }`}
                        >
                          {item.is_active ? "Enabled" : "Disabled"}
                        </button>

                        <Show when={item.filter_type === "custom"}>
                          <button
                            type="button"
                            onClick={() => openEditCustomFilter(item)}
                            class="p-1.5 text-[#6E7075] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] rounded-lg transition cursor-pointer"
                            title="Edit Filter"
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </Show>

                        <button
                          type="button"
                          onClick={() => handleDeleteFilter(item)}
                          class="p-1.5 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition cursor-pointer"
                          title="Delete Filter"
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

          {/* 2. Spam, Block, and Allow Lists Card */}
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl p-6 border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs space-y-5">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 class="text-xs font-bold text-[#1A1B1E] dark:text-[#F3F4F6] uppercase tracking-wider font-mono">
                  Spam, Block, and Allow Lists
                </h4>
                <p class="text-xs text-[#6E7075] dark:text-[#A1A1AA] mt-0.5">
                  Take control over what lands in your inbox by creating the following lists:
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setNewRuleListType(activeRuleTab());
                  setNewRuleValue("");
                  setAddRuleModalOpen(true);
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

            {/* Explainer for Active List */}
            <div class="p-3 bg-[#F8F7F4] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs text-[#6E7075] dark:text-[#A1A1AA]">
              <Show when={activeRuleTab() === "spam"}>
                <span class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Spam list: </span>
                To prevent junk mail from clogging up your inbox. Messages from these senders or domains are placed directly in Spam.
              </Show>
              <Show when={activeRuleTab() === "block"}>
                <span class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Block list: </span>
                To stop phishing or suspicious emails from entering your email system. Inbound messages will be blocked.
              </Show>
              <Show when={activeRuleTab() === "allow"}>
                <span class="font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">Allow list: </span>
                To ensure critical messages don't end up in spam and getting missed. Bypasses spam filtering.
              </Show>
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

      {/* ── MODALS ── */}

      {/* 1. Custom Filter Modal */}
      <Show when={customFilterModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                {editingFilterId() ? "Edit Custom Filter" : "Add Custom Filter"}
              </h3>
              <button onClick={() => setCustomFilterModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveCustomFilter} class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Filter Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Invoices & Billing"
                  value={filterName()}
                  onInput={(e) => setFilterName(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] focus:outline-none focus:ring-2 focus:ring-[#A27561]"
                />
              </div>

              {/* Conditions Block */}
              <div class="space-y-2 pt-1">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">When a message matches</span>
                    <select
                      value={filterMatch()}
                      onChange={(e) => setFilterMatch(e.currentTarget.value as "all" | "any")}
                      class="px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs font-bold text-[#A27561] cursor-pointer"
                    >
                      <option value="all">ALL conditions (AND)</option>
                      <option value="any">ANY condition (OR)</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddCondition}
                    class="text-xs text-[#A27561] hover:underline font-semibold cursor-pointer"
                  >
                    + Add Condition
                  </button>
                </div>

                <div class="space-y-2">
                  <For each={filterConditions()}>
                    {(cond, idx) => (
                      <div class="flex items-center gap-2 p-2 bg-[#F8F7F4] dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138]">
                        <select
                          value={cond.field}
                          onChange={(e) => handleUpdateCondition(idx(), "field", e.currentTarget.value)}
                          class="px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                        >
                          <option value="from">Sender (From)</option>
                          <option value="to">Recipient (To)</option>
                          <option value="subject">Subject</option>
                        </select>

                        <select
                          value={cond.comparator}
                          onChange={(e) => handleUpdateCondition(idx(), "comparator", e.currentTarget.value)}
                          class="px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6] cursor-pointer"
                        >
                          <option value="contains">contains</option>
                          <option value="is">is exactly</option>
                          <option value="starts_with">starts with</option>
                          <option value="ends_with">ends with</option>
                          <option value="not_contains">does not contain</option>
                        </select>

                        <input
                          type="text"
                          required
                          placeholder="Search text"
                          value={cond.value}
                          onInput={(e) => handleUpdateCondition(idx(), "value", e.currentTarget.value)}
                          class="flex-1 px-3 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
                        />

                        <Show when={filterConditions().length > 1}>
                          <button
                            type="button"
                            onClick={() => handleRemoveCondition(idx())}
                            class="p-1 text-rose-500 hover:text-rose-700 cursor-pointer"
                            title="Remove Condition"
                          >
                            ✕
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* Actions Block */}
              <div class="space-y-2 pt-2 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
                  Perform these actions:
                </label>

                <div class="space-y-2 text-xs text-[#1A1B1E] dark:text-[#F3F4F6]">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={actionApplyMove()}
                      onChange={(e) => setActionApplyMove(e.currentTarget.checked)}
                      class="rounded border-[#E2DFD8] text-[#A27561] focus:ring-[#A27561]"
                    />
                    <span>Move to folder:</span>
                    <select
                      disabled={!actionApplyMove()}
                      value={actionMoveFolder()}
                      onChange={(e) => setActionMoveFolder(e.currentTarget.value)}
                      class="px-2 py-1 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs disabled:opacity-50 cursor-pointer"
                    >
                      <option value="inbox">Inbox</option>
                      <option value="archive">Archive</option>
                      <option value="spam">Spam</option>
                      <option value="trash">Trash</option>
                    </select>
                  </label>

                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={actionMarkRead()}
                      onChange={(e) => setActionMarkRead(e.currentTarget.checked)}
                      class="rounded border-[#E2DFD8] text-[#A27561] focus:ring-[#A27561]"
                    />
                    <span>Mark as read</span>
                  </label>

                  <label class="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={actionStar()}
                      onChange={(e) => setActionStar(e.currentTarget.checked)}
                      class="rounded border-[#E2DFD8] text-[#A27561] focus:ring-[#A27561]"
                    />
                    <span>Star message</span>
                  </label>
                </div>
              </div>

              <div class="flex justify-end gap-2 pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                <button
                  type="button"
                  onClick={() => setCustomFilterModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFilter()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] cursor-pointer disabled:opacity-50"
                >
                  {savingFilter() ? "Saving Filter…" : "Save Filter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* 2. Sieve Filter Modal */}
      <Show when={sieveFilterModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-xl w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                Add Sieve Filter
              </h3>
              <button onClick={() => setSieveFilterModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveSieveFilter} class="space-y-4">
              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Sieve Filter Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Advanced Sieve Router"
                  value={sieveFilterName()}
                  onInput={(e) => setSieveFilterName(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-xs text-[#1A1B1E] dark:text-[#F3F4F6]"
                />
              </div>

              <div>
                <label class="block text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] mb-1">
                  Sieve Script (RFC 5228)
                </label>
                <textarea
                  rows={8}
                  required
                  value={sieveScript()}
                  onInput={(e) => setSieveScript(e.currentTarget.value)}
                  class="w-full p-3 font-mono text-xs rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#F8F7F4] dark:bg-[#18191D] text-[#1A1B1E] dark:text-[#F3F4F6]"
                />
              </div>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSieveFilterModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingFilter()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] cursor-pointer"
                >
                  {savingFilter() ? "Saving Sieve…" : "Save Sieve Filter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* 3. Add Address or Domain Modal */}
      <Show when={addRuleModalOpen()}>
        <div class="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div class="bg-white dark:bg-[#1E2025] rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xl max-w-md w-full p-6 space-y-4">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-[#1A1B1E] dark:text-[#F3F4F6]">
                Add Address or Domain
              </h3>
              <button onClick={() => setAddRuleModalOpen(false)} class="text-[#6E7075] p-1 cursor-pointer">✕</button>
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
                  onClick={() => setAddRuleModalOpen(false)}
                  class="px-4 py-2 rounded-xl border border-[#E2DFD8] text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRule()}
                  class="px-5 py-2 rounded-xl bg-[#A27561] text-white text-xs font-semibold hover:bg-[#8F6452] cursor-pointer"
                >
                  {savingRule() ? "Adding…" : "Add to List"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>
    </div>
  );
};
