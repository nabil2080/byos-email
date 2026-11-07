import { Component, createSignal, onMount, onCleanup, For, Show } from "solid-js";
import {
  Mailbox,
  UserMe,
  MaskedAliasItem,
  fetchMaskedAliases,
  createMaskedAlias,
  updateMaskedAlias,
  deleteMaskedAlias,
} from "../../api";

interface MaskedEmailTabProps {
  mailbox: Mailbox;
  currentUser: UserMe | null;
}

export const RESERVED_LOCAL_PARTS = new Set([
  "admin", "administrator", "postmaster", "abuse", "support", "help", "info",
  "noreply", "no-reply", "mailer-daemon", "root", "webmaster", "security",
  "billing", "sales", "marketing", "system", "test", "demo", "api", "www"
]);

export function validateLocalPart(lp: string): { valid: boolean; error: string | null } {
  const trimmed = lp.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { valid: false, error: null };
  }
  if (/[^a-z0-9._-]/.test(trimmed)) {
    return { valid: false, error: "Only lowercase letters, numbers, and . - _ are allowed" };
  }
  if (trimmed.length < 3) {
    return { valid: false, error: "Must be at least 3 characters" };
  }
  if (trimmed.length > 32) {
    return { valid: false, error: "Must be at most 32 characters" };
  }
  if (/^[._-]/.test(trimmed) || /[._-]$/.test(trimmed)) {
    return { valid: false, error: "Must not start or end with ., -, or _" };
  }
  if (/[._-]{2,}/.test(trimmed)) {
    return { valid: false, error: "Must not contain two consecutive ., -, or _ characters" };
  }
  if (RESERVED_LOCAL_PARTS.has(trimmed)) {
    return { valid: false, error: "This alias name is reserved" };
  }
  return { valid: true, error: null };
}

export const MaskedEmailTab: Component<MaskedEmailTabProps> = (props) => {
  const [aliases, setAliases] = createSignal<MaskedAliasItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [generating, setGenerating] = createSignal(false);
  const [rateLimitError, setRateLimitError] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [createError, setCreateError] = createSignal<string | null>(null);
  const [copiedId, setCopiedId] = createSignal<string | null>(null);

  // Modals state
  const [generateModalOpen, setGenerateModalOpen] = createSignal(false);
  const [creationMode, setCreationMode] = createSignal<"random" | "custom">("random");
  const [customLocalPart, setCustomLocalPart] = createSignal("");
  const [customCharError, setCustomCharError] = createSignal<string | null>(null);
  const [newLabel, setNewLabel] = createSignal("");

  const customValidation = () => validateLocalPart(customLocalPart());
  const isCustomValid = () => customValidation().valid && !customCharError();
  const canSubmit = () => {
    if (generating()) return false;
    if (creationMode() === "random") return true;
    return isCustomValid();
  };

  const [editModalOpen, setEditModalOpen] = createSignal(false);
  const [editingAlias, setEditingAlias] = createSignal<MaskedAliasItem | null>(null);
  const [editLabel, setEditLabel] = createSignal("");
  const [savingEdit, setSavingEdit] = createSignal(false);

  const [deleteModalOpen, setDeleteModalOpen] = createSignal(false);
  const [deletingAlias, setDeletingAlias] = createSignal<MaskedAliasItem | null>(null);
  const [deleting, setDeleting] = createSignal(false);

  let copyTimeout: any = null;

  async function loadAliases() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMaskedAliases();
      setAliases(res.aliases || []);
    } catch (err: any) {
      setError(err.message || "Failed to load masked aliases");
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadAliases();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (generateModalOpen()) setGenerateModalOpen(false);
        if (editModalOpen()) setEditModalOpen(false);
        if (deleteModalOpen()) setDeleteModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown);
      if (copyTimeout) clearTimeout(copyTimeout);
    });
  });

  async function handleCreateAlias(e?: Event) {
    if (e) e.preventDefault();
    if (!canSubmit()) return;
    setGenerating(true);
    setRateLimitError(null);
    setError(null);
    setCreateError(null);
    try {
      let created: MaskedAliasItem;
      if (creationMode() === "custom") {
        created = await createMaskedAlias({
          label: newLabel().trim(),
          local_part: customLocalPart().trim().toLowerCase(),
        });
      } else {
        created = await createMaskedAlias(newLabel().trim());
      }
      setAliases([created, ...aliases()]);
      setGenerateModalOpen(false);
      setNewLabel("");
      setCustomLocalPart("");
      setCustomCharError(null);
      setCreateError(null);
      setCreationMode("random");
    } catch (err: any) {
      if (err.message && (err.message.includes("429") || err.message.includes("rate_limit_exceeded"))) {
        const msg = "You've reached the daily limit for new aliases. Try again tomorrow.";
        setCreateError(msg);
        setRateLimitError(msg);
      } else if (err.status === 409 || err.message?.includes("already taken") || err.message?.includes("already exists") || err.message?.includes("alias_taken")) {
        const msg = "That alias is already taken. Try a different name.";
        setCreateError(msg);
        setError(msg);
      } else {
        const msg = err.message || "Failed to create alias";
        setCreateError(msg);
        setError(msg);
      }
    } finally {
      setGenerating(false);
    }
  }

  async function handleToggleEnabled(alias: MaskedAliasItem) {
    setError(null);
    try {
      const updated = await updateMaskedAlias(alias.id, { is_enabled: !alias.is_enabled });
      setAliases(aliases().map((a) => (a.id === updated.id ? updated : a)));
    } catch (err: any) {
      setError(err.message || "Failed to update alias status");
    }
  }

  async function handleSaveEdit(e?: Event) {
    if (e) e.preventDefault();
    const target = editingAlias();
    if (!target) return;
    setSavingEdit(true);
    setError(null);
    try {
      const updated = await updateMaskedAlias(target.id, { label: editLabel().trim() });
      setAliases(aliases().map((a) => (a.id === updated.id ? updated : a)));
      setEditModalOpen(false);
      setEditingAlias(null);
    } catch (err: any) {
      setError(err.message || "Failed to update alias label");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDelete() {
    const target = deletingAlias();
    if (!target) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteMaskedAlias(target.id);
      setAliases(aliases().filter((a) => a.id !== target.id));
      setDeleteModalOpen(false);
      setDeletingAlias(null);
    } catch (err: any) {
      setError(err.message || "Failed to delete alias");
    } finally {
      setDeleting(false);
    }
  }

  function handleCopy(aliasAddress: string, id: string) {
    navigator.clipboard.writeText(aliasAddress).then(() => {
      setCopiedId(id);
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        setCopiedId(null);
      }, 2000);
    }).catch(() => {
      // Fallback
      setCopiedId(id);
      if (copyTimeout) clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        setCopiedId(null);
      }, 2000);
    });
  }

  function formatRelativeDate(dateStr: string): string {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHours = Math.floor(diffMin / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffDays > 30) {
        return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
      }
      if (diffDays > 0) {
        return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
      }
      if (diffHours > 0) {
        return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
      }
      if (diffMin > 0) {
        return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`;
      }
      return "Just now";
    } catch {
      return dateStr;
    }
  }

  return (
    <div class="space-y-6">
      {/* Header section */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E2DFD8] dark:border-[#2E3138]">
        <div>
          <h1 class="text-xl sm:text-2xl font-bold text-[#3C3D3E] dark:text-neutral-100 flex items-center gap-2">
            <svg class="w-6 h-6 text-[#9E725F] stroke-current fill-none stroke-[1.75]" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            Masked Email
          </h1>
          <p class="text-xs sm:text-sm text-[#6F7173] dark:text-neutral-400 mt-1 max-w-2xl leading-relaxed">
            Generate alias addresses that forward to your inbox. Use them for signups, newsletters, or anywhere you don't want to share your real address.
          </p>
        </div>
        <button
          onClick={() => {
            setNewLabel("");
            setCustomLocalPart("");
            setCustomCharError(null);
            setCreateError(null);
            setCreationMode("random");
            setGenerateModalOpen(true);
          }}
          data-testid="generate-alias-btn"
          class="flex-shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs sm:text-sm font-medium transition shadow-sm focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 cursor-pointer"
        >
          <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Generate new alias
        </button>
      </div>

      {/* Rate limit banner */}
      <Show when={rateLimitError()}>
        <div class="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-start gap-3">
          <svg class="w-5 h-5 text-amber-600 dark:text-amber-400 stroke-current fill-none stroke-2 flex-shrink-0 mt-0.5" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div class="flex-1">
            <h3 class="text-xs sm:text-sm font-semibold text-amber-900 dark:text-amber-200">Daily limit reached</h3>
            <p class="text-xs text-amber-700 dark:text-amber-300 mt-0.5">{rateLimitError()}</p>
          </div>
          <button
            onClick={() => setRateLimitError(null)}
            class="text-amber-600 hover:text-amber-800 dark:text-amber-400 text-xs p-1 cursor-pointer"
            aria-label="Dismiss banner"
          >
            ✕
          </button>
        </div>
      </Show>

      {/* General error alert */}
      <Show when={error()}>
        <div class="p-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-start gap-3">
          <svg class="w-5 h-5 text-rose-600 dark:text-rose-400 stroke-current fill-none stroke-2 flex-shrink-0 mt-0.5" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <div class="flex-1">
            <h3 class="text-xs sm:text-sm font-semibold text-rose-900 dark:text-rose-200">Error</h3>
            <p class="text-xs text-rose-700 dark:text-rose-300 mt-0.5">{error()}</p>
          </div>
          <button
            onClick={() => setError(null)}
            class="text-rose-600 hover:text-rose-800 dark:text-rose-400 text-xs p-1 cursor-pointer"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      </Show>

      {/* Loading state */}
      <Show when={loading()}>
        <div class="py-16 text-center text-[#6F7173] dark:text-neutral-400">
          <div class="inline-block animate-spin w-6 h-6 border-2 border-[#9E725F] border-t-transparent rounded-full mb-3"></div>
          <p class="text-xs sm:text-sm font-medium">Loading masked aliases…</p>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && aliases().length === 0}>
        <div class="py-16 px-4 text-center rounded-xl border border-dashed border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#18191D]">
          <div class="w-12 h-12 mx-auto mb-4 rounded-full bg-[#F2E8E2] dark:bg-[#252830] flex items-center justify-center text-[#9E725F]">
            <svg class="w-6 h-6 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>
          <h2 class="text-base font-semibold text-[#3C3D3E] dark:text-neutral-100">You haven't created any aliases yet.</h2>
          <p class="text-xs sm:text-sm text-[#6F7173] dark:text-neutral-400 mt-1 max-w-md mx-auto">
            Create burner aliases to protect your personal identity. Inbound messages route seamlessly to your private inbox.
          </p>
          <div class="mt-6">
            <button
              onClick={() => {
                setNewLabel("");
                setCustomLocalPart("");
                setCustomCharError(null);
                setCreationMode("random");
                setGenerateModalOpen(true);
              }}
              data-testid="generate-alias-btn"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs sm:text-sm font-medium transition shadow-sm focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 cursor-pointer"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Generate your first alias
            </button>
          </div>
        </div>
      </Show>

      {/* Aliases Table / List */}
      <Show when={!loading() && aliases().length > 0}>
        <div class="bg-white dark:bg-[#18191D] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] overflow-hidden shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs sm:text-sm border-collapse min-w-[640px]">
              <thead>
                <tr class="border-b border-[#E2DFD8] dark:border-[#2E3138] bg-[#F0EEE9]/50 dark:bg-[#252830]/40 text-[#6F7173] dark:text-neutral-400 font-medium">
                  <th class="py-3 px-4">Alias Address</th>
                  <th class="py-3 px-4">Label</th>
                  <th class="py-3 px-4">Status</th>
                  <th class="py-3 px-4">Created</th>
                  <th class="py-3 px-4 text-center">Replies</th>
                  <th class="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#E2DFD8] dark:divide-[#2E3138]">
                <For each={aliases()}>
                  {(alias) => (
                    <tr class="hover:bg-[#F0EEE9]/30 dark:hover:bg-[#252830]/20 transition-colors">
                      <td class="py-3.5 px-4 font-mono text-xs sm:text-sm text-[#3C3D3E] dark:text-neutral-200">
                        <div class="flex items-center gap-2">
                          <span class="select-all">{alias.alias_address}</span>
                          <div class="relative">
                            <button
                              onClick={() => handleCopy(alias.alias_address, alias.id)}
                              class="p-1 text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-white rounded hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                              title="Copy to clipboard"
                              aria-label={`Copy ${alias.alias_address}`}
                            >
                              <Show
                                when={copiedId() === alias.id}
                                fallback={
                                  <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.75]" viewBox="0 0 24 24">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                  </svg>
                                }
                              >
                                <svg class="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </Show>
                            </button>
                            <Show when={copiedId() === alias.id}>
                              <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-[#3C3D3E] text-white text-[10px] px-1.5 py-0.5 rounded shadow whitespace-nowrap z-10">
                                Copied!
                              </div>
                            </Show>
                          </div>
                        </div>
                      </td>
                      <td class="py-3.5 px-4">
                        <Show
                          when={alias.label && alias.label.trim().length > 0}
                          fallback={<span class="text-[#6F7173] dark:text-neutral-500 italic text-xs">No label</span>}
                        >
                          <span class="text-[#3C3D3E] dark:text-neutral-200 font-medium">{alias.label}</span>
                        </Show>
                      </td>
                      <td class="py-3.5 px-4">
                        <Show
                          when={alias.is_enabled}
                          fallback={
                            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-[#6F7173] border border-[#E2DFD8] dark:bg-stone-800 dark:text-stone-400">
                              <span class="w-1.5 h-1.5 rounded-full bg-stone-400"></span>
                              Disabled
                            </span>
                          }
                        >
                          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            Enabled
                          </span>
                        </Show>
                      </td>
                      <td class="py-3.5 px-4 text-xs text-[#6F7173] dark:text-neutral-400 whitespace-nowrap">
                        {formatRelativeDate(alias.created_at)}
                      </td>
                      <td class="py-3.5 px-4 text-center text-xs font-mono text-[#6F7173] dark:text-neutral-400">
                        {alias.reply_count}
                      </td>
                      <td class="py-3.5 px-4 text-right">
                        <div class="inline-flex items-center gap-1">
                          {/* Toggle Active / Disabled */}
                          <button
                            onClick={() => handleToggleEnabled(alias)}
                            class="px-2 py-1 rounded text-xs font-medium border border-[#E2DFD8] dark:border-[#2E3138] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition text-[#3C3D3E] dark:text-neutral-300 focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                            title={alias.is_enabled ? "Disable alias" : "Enable alias"}
                          >
                            {alias.is_enabled ? "Disable" : "Enable"}
                          </button>
                          {/* Edit Label */}
                          <button
                            onClick={() => {
                              setEditingAlias(alias);
                              setEditLabel(alias.label || "");
                              setEditModalOpen(true);
                            }}
                            class="p-1 text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-white rounded hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition focus:outline-none focus:ring-1 focus:ring-[#9E725F] cursor-pointer"
                            title="Edit label"
                            aria-label={`Edit label for ${alias.alias_address}`}
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.75]" viewBox="0 0 24 24">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          {/* Delete */}
                          <button
                            onClick={() => {
                              setDeletingAlias(alias);
                              setDeleteModalOpen(true);
                            }}
                            class="p-1 text-[#6F7173] hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/30 transition focus:outline-none focus:ring-1 focus:ring-rose-500 cursor-pointer"
                            title="Delete alias"
                            aria-label={`Delete ${alias.alias_address}`}
                          >
                            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.75]" viewBox="0 0 24 24">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </Show>

      {/* Generate Alias Modal */}
      <Show when={generateModalOpen()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div
            class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 font-sans"
            role="dialog"
            aria-modal="true"
            aria-labelledby="generate-modal-title"
          >
            <div class="flex items-center justify-between">
              <h2 id="generate-modal-title" class="text-base font-semibold text-[#3C3D3E] dark:text-neutral-100 flex items-center gap-2">
                <svg class="w-5 h-5 text-[#9E725F] stroke-current fill-none stroke-[1.75]" viewBox="0 0 24 24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                Create Masked Email
              </h2>
              <button
                onClick={() => setGenerateModalOpen(false)}
                class="text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-white p-1 rounded cursor-pointer"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            {/* Mode toggle */}
            <div class="flex items-center p-1 bg-[#F0EEE9] dark:bg-[#252830] rounded-lg border border-[#E2DFD8] dark:border-[#2E3138]">
              <button
                type="button"
                onClick={() => {
                  setCreationMode("random");
                  setCustomCharError(null);
                  setCreateError(null);
                }}
                data-testid="alias-mode-random"
                class={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition cursor-pointer ${
                  creationMode() === "random"
                    ? "bg-white dark:bg-[#18191D] text-[#3C3D3E] dark:text-white shadow-xs font-semibold"
                    : "text-[#6F7173] dark:text-neutral-400 hover:text-[#3C3D3E] dark:hover:text-white"
                }`}
              >
                Random
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreationMode("custom");
                  setCreateError(null);
                }}
                data-testid="alias-mode-custom"
                class={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition cursor-pointer ${
                  creationMode() === "custom"
                    ? "bg-white dark:bg-[#18191D] text-[#3C3D3E] dark:text-white shadow-xs font-semibold"
                    : "text-[#6F7173] dark:text-neutral-400 hover:text-[#3C3D3E] dark:hover:text-white"
                }`}
              >
                Custom
              </button>
            </div>

            {/* Error display inside modal */}
            <Show when={createError()}>
              <div data-testid="alias-modal-error" class="p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300">
                {createError()}
              </div>
            </Show>

            <Show
              when={creationMode() === "custom"}
              fallback={
                <p class="text-xs sm:text-sm text-[#6F7173] dark:text-neutral-400">
                  A random, unique address at <span class="font-mono font-medium text-[#3C3D3E] dark:text-neutral-200">masked.byos.local</span> will be generated and routed to your mailbox.
                </p>
              }
            >
              <div class="space-y-1.5">
                <label for="custom-local-part-input" class="block text-xs font-medium text-[#3C3D3E] dark:text-neutral-300">
                  Alias Name
                </label>
                <div class="flex items-center rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#252830] overflow-hidden focus-within:ring-2 focus-within:ring-[#9E725F]/50">
                  <input
                    id="custom-local-part-input"
                    data-testid="custom-local-part-input"
                    type="text"
                    placeholder="amazon"
                    value={customLocalPart()}
                    onInput={(e) => {
                      const lower = e.currentTarget.value.toLowerCase();
                      e.currentTarget.value = lower;
                      setCustomLocalPart(lower);
                      if (/[^a-z0-9._-]/.test(lower)) {
                        setCustomCharError("Only lowercase letters, numbers, and . - _ are allowed");
                      } else {
                        setCustomCharError(null);
                      }
                    }}
                    class="flex-1 px-3 py-2 text-xs sm:text-sm font-mono text-[#3C3D3E] dark:text-neutral-100 bg-transparent focus:outline-none"
                    autofocus
                  />
                  <span class="px-3 py-2 text-xs sm:text-sm font-mono text-[#6F7173] dark:text-neutral-400 bg-[#F0EEE9]/60 dark:bg-[#1E2025] border-l border-[#E2DFD8] dark:border-[#2E3138] select-none">
                    @masked.byos.local
                  </span>
                </div>

                {/* Inline error or help text */}
                <Show when={customCharError() || customValidation().error}>
                  <p data-testid="alias-validation-error" class="text-[11px] text-rose-600 dark:text-rose-400 font-medium pt-0.5">
                    {customCharError() || customValidation().error}
                  </p>
                </Show>

                {/* Live address preview */}
                <div class="mt-2 p-2 rounded-lg bg-[#FAF9F7] dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between text-xs">
                  <span class="text-[#6F7173] dark:text-neutral-400">Address Preview:</span>
                  <span data-testid="alias-address-preview" class="font-mono font-medium text-[#9E725F] dark:text-[#D4A38F]">
                    {(customLocalPart().trim().toLowerCase() || "…") + "@masked.byos.local"}
                  </span>
                </div>
              </div>
            </Show>

            <form onSubmit={handleCreateAlias} class="space-y-4">
              <div>
                <label for="alias-label-input" class="block text-xs font-medium text-[#3C3D3E] dark:text-neutral-300 mb-1">
                  Label (Optional)
                </label>
                <input
                  id="alias-label-input"
                  data-testid="alias-label-input"
                  type="text"
                  placeholder="e.g. Shopping, Newsletter, Forum..."
                  value={newLabel()}
                  onInput={(e) => setNewLabel(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#252830] text-xs sm:text-sm text-[#3C3D3E] dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                />
              </div>

              <div class="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setGenerateModalOpen(false)}
                  disabled={generating()}
                  class="px-4 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs sm:text-sm font-medium text-[#3C3D3E] dark:text-neutral-300 hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit()}
                  data-testid="alias-create-submit-btn"
                  class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs sm:text-sm font-medium transition shadow-sm focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Show when={generating()} fallback={creationMode() === "custom" ? "Create Alias" : "Generate Alias"}>
                    <span class="inline-block animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                    <span>Creating…</span>
                  </Show>
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* Edit Label Modal */}
      <Show when={editModalOpen() && editingAlias()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div
            class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-xl max-w-md w-full p-6 space-y-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-modal-title"
          >
            <div class="flex items-center justify-between">
              <h2 id="edit-modal-title" class="text-base font-semibold text-[#3C3D3E] dark:text-neutral-100">
                Edit Alias Label
              </h2>
              <button
                onClick={() => setEditModalOpen(false)}
                class="text-[#6F7173] hover:text-[#3C3D3E] dark:hover:text-white p-1 rounded cursor-pointer"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <p class="font-mono text-xs text-[#6F7173] dark:text-neutral-400 break-all">
              {editingAlias()?.alias_address}
            </p>

            <form onSubmit={handleSaveEdit} class="space-y-4">
              <div>
                <label for="edit-alias-label-input" class="block text-xs font-medium text-[#3C3D3E] dark:text-neutral-300 mb-1">
                  Label
                </label>
                <input
                  id="edit-alias-label-input"
                  type="text"
                  placeholder="e.g. Shopping, Newsletter, Forum..."
                  value={editLabel()}
                  onInput={(e) => setEditLabel(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#252830] text-xs sm:text-sm text-[#3C3D3E] dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50"
                  autofocus
                />
              </div>

              <div class="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  disabled={savingEdit()}
                  class="px-4 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs sm:text-sm font-medium text-[#3C3D3E] dark:text-neutral-300 hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEdit()}
                  class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#9E725F] hover:bg-[#865E4D] text-white text-xs sm:text-sm font-medium transition shadow-sm focus:outline-none focus:ring-2 focus:ring-[#9E725F]/50 disabled:opacity-50 cursor-pointer"
                >
                  <Show when={savingEdit()} fallback="Save Label">
                    <span class="inline-block animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                    <span>Saving…</span>
                  </Show>
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      {/* Delete Confirmation Modal */}
      <Show when={deleteModalOpen() && deletingAlias()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div
            class="bg-white dark:bg-[#18191D] border border-[#E2DFD8] dark:border-[#2E3138] rounded-xl shadow-xl max-w-md w-full p-6 space-y-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
          >
            <div class="flex items-center gap-3 text-rose-600 dark:text-rose-400">
              <div class="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center flex-shrink-0">
                <svg class="w-5 h-5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 id="delete-modal-title" class="text-base font-semibold text-[#3C3D3E] dark:text-neutral-100">
                Delete Masked Email
              </h2>
            </div>

            <p class="text-xs sm:text-sm text-[#6F7173] dark:text-neutral-400 leading-relaxed">
              Delete <strong class="text-[#3C3D3E] dark:text-neutral-200 font-mono">{deletingAlias()?.alias_address}</strong>? Messages sent to this address will no longer reach you. This cannot be undone.
            </p>

            <div class="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting()}
                class="px-4 py-2 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs sm:text-sm font-medium text-[#3C3D3E] dark:text-neutral-300 hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting()}
                data-testid="confirm-delete-alias-btn"
                class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-medium transition shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-500 disabled:opacity-50 cursor-pointer"
              >
                <Show when={deleting()} fallback="Delete Alias">
                  <span class="inline-block animate-spin w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                  <span>Deleting…</span>
                </Show>
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
