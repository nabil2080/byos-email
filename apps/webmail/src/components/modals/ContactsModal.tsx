import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import {
  ContactItem,
  fetchContacts,
  createContact,
  updateContact,
  deleteContact,
  importContacts,
  getExportContactsUrl,
} from "../../api";

interface ContactsModalProps {
  mailboxId: string;
  onClose: () => void;
  onComposeTo?: (email: string) => void;
  onContactsUpdated?: (contacts: ContactItem[]) => void;
}

export function ContactsModal(props: ContactsModalProps) {
  const [contacts, setContacts] = createSignal<ContactItem[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [selectedGroup, setSelectedGroup] = createSignal("");
  const [selectedContactId, setSelectedContactId] = createSignal<string | null>(null);

  // Form / Edit state
  const [isEditing, setIsEditing] = createSignal(false);
  const [isCreating, setIsCreating] = createSignal(false);
  const [formName, setFormName] = createSignal("");
  const [formEmail, setFormEmail] = createSignal("");
  const [formGroup, setFormGroup] = createSignal("");
  const [formNotes, setFormNotes] = createSignal("");
  const [formError, setFormError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  // Delete confirmation
  const [deleteConfirmId, setDeleteConfirmId] = createSignal<string | null>(null);
  const [importStatus, setImportStatus] = createSignal<string | null>(null);

  let fileInputRef: HTMLInputElement | undefined;
  let searchDebounceTimer: any = null;

  async function loadContacts(query: string = "", group: string = "") {
    if (!props.mailboxId) return;
    setLoading(true);
    setError(null);
    try {
      const items = await fetchContacts(props.mailboxId, query, group);
      setContacts(items);
      props.onContactsUpdated?.(items);

      // If selected contact not in list, clear or select first
      if (selectedContactId() && !items.some((c) => c.id === selectedContactId())) {
        setSelectedContactId(items.length > 0 ? items[0].id : null);
      } else if (!selectedContactId() && items.length > 0 && !isCreating()) {
        setSelectedContactId(items[0].id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load contacts";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  onMount(() => {
    loadContacts();
  });

  function handleSearchInput(val: string) {
    setSearchQuery(val);
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      loadContacts(val.trim(), selectedGroup());
    }, 200);
  }

  function handleGroupChange(group: string) {
    setSelectedGroup(group);
    loadContacts(searchQuery().trim(), group);
  }

  // Compute distinct groups
  const availableGroups = createMemo(() => {
    const groups = new Set<string>();
    contacts().forEach((c) => {
      if (c.group_name && c.group_name.trim()) {
        groups.add(c.group_name.trim());
      }
    });
    return Array.from(groups).sort();
  });

  const selectedContact = createMemo(() => {
    const id = selectedContactId();
    if (!id) return null;
    return contacts().find((c) => c.id === id) || null;
  });

  function startCreate() {
    setIsCreating(true);
    setIsEditing(false);
    setSelectedContactId(null);
    setFormName("");
    setFormEmail("");
    setFormGroup(selectedGroup() || "");
    setFormNotes("");
    setFormError(null);
  }

  function startEdit(contact: ContactItem) {
    setIsEditing(true);
    setIsCreating(false);
    setSelectedContactId(contact.id);
    setFormName(contact.name || "");
    setFormEmail(contact.email || "");
    setFormGroup(contact.group_name || "");
    setFormNotes(contact.notes || "");
    setFormError(null);
  }

  function cancelForm() {
    setIsCreating(false);
    setIsEditing(false);
    setFormError(null);
    if (!selectedContactId() && contacts().length > 0) {
      setSelectedContactId(contacts()[0].id);
    }
  }

  async function handleSave() {
    const name = formName().trim();
    const email = formEmail().trim();
    const groupName = formGroup().trim();
    const notes = formNotes().trim();

    if (!name) {
      setFormError("Name is required.");
      return;
    }
    if (!email || !email.includes("@")) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (notes.length > 2000) {
      setFormError("Notes must not exceed 2000 characters.");
      return;
    }
    if (groupName.length > 50) {
      setFormError("Group name must not exceed 50 characters.");
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      if (isCreating()) {
        const created = await createContact(props.mailboxId, {
          name,
          email,
          notes,
          group_name: groupName,
        });
        await loadContacts(searchQuery().trim(), selectedGroup());
        setSelectedContactId(created.id);
        setIsCreating(false);
      } else if (isEditing() && selectedContactId()) {
        const contactId = selectedContactId()!;
        await updateContact(props.mailboxId, contactId, {
          name,
          email,
          notes,
          group_name: groupName,
        });
        await loadContacts(searchQuery().trim(), selectedGroup());
        setIsEditing(false);
      }
    } catch (err: any) {
      if (err?.status === 409 || err?.message?.includes("contact_exists")) {
        setFormError("A contact with this email address already exists.");
      } else {
        setFormError(err instanceof Error ? err.message : "Failed to save contact");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(contactId: string) {
    setLoading(true);
    try {
      await deleteContact(props.mailboxId, contactId);
      setDeleteConfirmId(null);
      await loadContacts(searchQuery().trim(), selectedGroup());
      if (selectedContactId() === contactId) {
        setSelectedContactId(contacts().length > 0 ? contacts()[0].id : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete contact");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const isVcard = fileName.endsWith(".vcf") || fileName.endsWith(".vcard");
    const isCsv = fileName.endsWith(".csv");

    if (!isCsv && !isVcard) {
      setError("Please select a .csv or .vcf / .vcard file.");
      return;
    }

    const format = isVcard ? "vcard" : "csv";
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = (reader.result as string).split(",")[1] || (reader.result as string);
        setLoading(true);
        setImportStatus("Importing contacts…");
        const res = await importContacts(props.mailboxId, { format, data });
        setImportStatus(`Imported ${res.imported} contacts (${res.skipped} skipped duplicates).`);
        await loadContacts(searchQuery().trim(), selectedGroup());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      } finally {
        setLoading(false);
        if (fileInputRef) fileInputRef.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  function triggerExport(format: "csv" | "vcard") {
    const url = getExportContactsUrl(props.mailboxId, format);
    const a = document.createElement("a");
    a.href = url;
    a.download = format === "csv" ? "contacts.csv" : "contacts.vcf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-2 sm:p-4 font-sans">
      <div
        class="w-full max-w-5xl h-[85vh] max-h-[750px] rounded-2xl bg-white dark:bg-[#1E2025] shadow-2xl overflow-hidden flex flex-col border border-[#E2DFD8] dark:border-[#2E3138]"
        data-testid="contacts-modal"
      >
        {/* Hidden Import File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.vcf,.vcard"
          onChange={handleFileUpload}
          class="hidden"
          data-testid="contacts-import-file-input"
        />

        {/* Modal Header & Top-Right Toolbar */}
        <div class="px-5 py-3.5 bg-white dark:bg-[#1E2025] border-b border-[#E2DFD8] dark:border-[#2E3138] flex items-center justify-between select-none">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-[#A27561]/15 text-[#A27561] dark:text-[#E5B5A1] flex items-center justify-center font-bold">
              <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <h3 class="font-semibold text-sm sm:text-base text-[#2B2C2D] dark:text-[#F3F4F6]">
                Contacts
              </h3>
              <p class="text-[11px] text-[#6F7173] dark:text-[#878A8E]">
                {contacts().length} contact{contacts().length === 1 ? "" : "s"} in address book
              </p>
            </div>
          </div>

          <div class="flex items-center gap-2">
            {/* Import Button */}
            <button
              type="button"
              onClick={() => fileInputRef?.click()}
              class="px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] transition flex items-center gap-1.5 cursor-pointer"
              data-testid="contacts-import-btn"
              title="Import contacts from CSV or vCard"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span>Import</span>
            </button>

            {/* Export Dropdown */}
            <div class="relative group">
              <button
                type="button"
                class="px-2.5 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] transition flex items-center gap-1.5 cursor-pointer"
                data-testid="contacts-export-btn"
              >
                <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Export</span>
              </button>
              <div class="absolute right-0 top-full mt-1 hidden group-hover:block w-36 bg-white dark:bg-[#1E2025] rounded-xl shadow-xl border border-[#E2DFD8] dark:border-[#2E3138] py-1 z-30">
                <button
                  type="button"
                  onClick={() => triggerExport("csv")}
                  class="w-full text-left px-3 py-1.5 text-xs text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] cursor-pointer"
                  data-testid="export-csv-btn"
                >
                  Export as CSV
                </button>
                <button
                  type="button"
                  onClick={() => triggerExport("vcard")}
                  class="w-full text-left px-3 py-1.5 text-xs text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] cursor-pointer"
                  data-testid="export-vcard-btn"
                >
                  Export as vCard
                </button>
              </div>
            </div>

            {/* Close Button */}
            <button
              type="button"
              onClick={props.onClose}
              class="text-[#6F7173] dark:text-[#878A8E] hover:text-[#2B2C2D] dark:hover:text-[#F3F4F6] p-1.5 rounded-lg hover:bg-[#F0EEE9] dark:hover:bg-[#26282E] transition cursor-pointer ml-1"
              aria-label="Close contacts"
              data-testid="contacts-close-btn"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Status / Alert Banners */}
        <Show when={error()}>
          <div class="px-5 py-2 bg-red-50 dark:bg-rose-950/40 text-xs text-red-700 dark:text-rose-400 border-b border-red-200 dark:border-rose-900/50 flex justify-between items-center">
            <span>{error()}</span>
            <button onClick={() => setError(null)} class="text-red-500 hover:text-red-700 font-bold ml-2">×</button>
          </div>
        </Show>
        <Show when={importStatus()}>
          <div class="px-5 py-2 bg-emerald-50 dark:bg-emerald-950/40 text-xs text-emerald-800 dark:text-emerald-300 border-b border-emerald-200 dark:border-emerald-900/50 flex justify-between items-center">
            <span>{importStatus()}</span>
            <button onClick={() => setImportStatus(null)} class="text-emerald-600 hover:text-emerald-800 font-bold ml-2">×</button>
          </div>
        </Show>

        {/* ── Three-Pane Layout ── */}
        <div class="flex-1 min-h-0 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-[#E2DFD8] dark:divide-[#2E3138]">
          {/* ── Left Rail: Search, Group Filter, New Contact Button (25% width, min 200px) ── */}
          <div class="w-full md:w-1/4 md:min-w-[200px] md:max-w-[260px] p-3.5 bg-[#FAF9F6] dark:bg-[#18191D] flex flex-col gap-3 select-none flex-shrink-0">
            {/* Search Box */}
            <div class="relative">
              <svg class="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#878A8E] stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search contacts…"
                value={searchQuery()}
                onInput={(e) => handleSearchInput(e.currentTarget.value)}
                class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] pl-8 pr-3 py-1.5 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] bg-white dark:bg-[#1E2025] focus:outline-none focus:ring-1 focus:ring-[#A27561] transition"
                data-testid="contacts-search-input"
              />
            </div>

            {/* Group Filter Dropdown */}
            <div class="space-y-1">
              <label class="text-[11px] font-medium text-[#6F7173] dark:text-[#878A8E]">Group:</label>
              <select
                value={selectedGroup()}
                onChange={(e) => handleGroupChange(e.currentTarget.value)}
                class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-2.5 py-1.5 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] bg-white dark:bg-[#1E2025] focus:outline-none focus:ring-1 focus:ring-[#A27561] transition cursor-pointer"
                data-testid="contacts-group-filter"
              >
                <option value="">All Groups</option>
                <For each={availableGroups()}>
                  {(g) => <option value={g}>{g}</option>}
                </For>
              </select>
            </div>

            {/* New Contact Button */}
            <button
              type="button"
              onClick={startCreate}
              class="w-full mt-1 px-3 py-2 rounded-xl bg-[#A27561] hover:bg-[#8D624F] text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
              data-testid="contacts-new-btn"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New Contact</span>
            </button>
          </div>

          {/* ── Middle Pane: Contact List (Alphabetical) ── */}
          <div class="w-full md:w-[38%] flex-1 min-h-0 flex flex-col bg-white dark:bg-[#1E2025]">
            <div class="px-4 py-2 border-b border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F6] dark:bg-[#18191D] text-[11px] font-medium text-[#6F7173] dark:text-[#878A8E] flex justify-between select-none">
              <span>Name</span>
              <span>{contacts().length} found</span>
            </div>

            <div class="flex-1 overflow-y-auto divide-y divide-[#E2DFD8]/60 dark:divide-[#2E3138]/60" data-testid="contacts-list">
              <Show when={loading() && contacts().length === 0}>
                <div class="p-4 text-xs text-[#878A8E] animate-pulse">Loading contacts…</div>
              </Show>

              <Show when={!loading() && contacts().length === 0}>
                <div class="p-6 text-center text-xs text-[#878A8E] dark:text-[#71717A]">
                  No contacts found.
                </div>
              </Show>

              <For each={contacts()}>
                {(c) => {
                  const initial = (c.name ? c.name[0] : (c.email || "U")[0]).toUpperCase();
                  const isSelected = selectedContactId() === c.id;
                  return (
                    <div
                      onClick={() => {
                        setSelectedContactId(c.id);
                        setIsCreating(false);
                        setIsEditing(false);
                      }}
                      class={`px-3.5 py-2.5 flex items-center justify-between cursor-pointer transition select-none group ${
                        isSelected
                          ? "bg-[#F5F2EB] dark:bg-[#2B2D33]"
                          : "hover:bg-[#FAF9F6] dark:hover:bg-[#24262C]"
                      }`}
                      data-testid="contact-row"
                      data-contact-id={c.id}
                      data-name={c.name}
                      data-email={c.email}
                    >
                      <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-7 h-7 rounded-full bg-[#A27561]/20 text-[#A27561] dark:text-[#E5B5A1] flex items-center justify-center font-bold text-xs flex-shrink-0">
                          {initial}
                        </div>
                        <div class="min-w-0">
                          <div class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] truncate">
                            {c.name || c.email}
                          </div>
                          <div class="text-[11px] text-[#6F7173] dark:text-[#878A8E] truncate">
                            {c.email}
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <Show when={c.group_name}>
                          <span class="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-medium">
                            {c.group_name}
                          </span>
                        </Show>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(c);
                          }}
                          class="opacity-0 group-hover:opacity-100 p-1 text-[#6F7173] hover:text-[#1A1B1E] dark:hover:text-white rounded transition cursor-pointer"
                          title="Edit"
                          data-testid="contact-row-edit"
                        >
                          <svg class="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmId(c.id);
                          }}
                          class="opacity-0 group-hover:opacity-100 p-1 text-rose-500 hover:text-rose-700 rounded transition cursor-pointer"
                          title="Delete"
                          data-testid="contact-row-delete"
                        >
                          <svg class="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>

          {/* ── Right Pane: Detail & Inline Editor (Rest of space) ── */}
          <div class="w-full md:flex-1 min-h-0 flex flex-col bg-[#FAF9F6]/50 dark:bg-[#18191D]/50 p-5 overflow-y-auto">
            {/* Create or Edit Form */}
            <Show when={isCreating() || isEditing()}>
              <div class="space-y-4 max-w-md mx-auto w-full bg-white dark:bg-[#1E2025] p-5 rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs">
                <h4 class="font-semibold text-sm text-[#1A1B1E] dark:text-[#F3F4F6] border-b border-[#E2DFD8] dark:border-[#2E3138] pb-2">
                  {isCreating() ? "New Contact" : "Edit Contact"}
                </h4>

                <Show when={formError()}>
                  <div
                    class="p-2.5 rounded-xl bg-red-50 dark:bg-rose-950/40 text-xs text-red-700 dark:text-rose-400 border border-red-200 dark:border-rose-900/50"
                    data-testid="contact-form-error"
                  >
                    {formError()}
                  </div>
                </Show>

                <div class="space-y-3">
                  <div>
                    <label class="block text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] mb-1">
                      Name *
                    </label>
                    <input
                      type="text"
                      placeholder="Full Name"
                      value={formName()}
                      onInput={(e) => setFormName(e.currentTarget.value)}
                      class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3 py-1.5 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] bg-white dark:bg-[#1E2025] focus:outline-none focus:ring-1 focus:ring-[#A27561] transition"
                      data-testid="contact-form-name"
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] mb-1">
                      Email *
                    </label>
                    <input
                      type="email"
                      placeholder="user@example.com"
                      value={formEmail()}
                      onInput={(e) => setFormEmail(e.currentTarget.value)}
                      class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3 py-1.5 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] bg-white dark:bg-[#1E2025] focus:outline-none focus:ring-1 focus:ring-[#A27561] transition"
                      data-testid="contact-form-email"
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] mb-1">
                      Group (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Work, Family, Clients"
                      value={formGroup()}
                      onInput={(e) => setFormGroup(e.currentTarget.value)}
                      class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] px-3 py-1.5 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] bg-white dark:bg-[#1E2025] focus:outline-none focus:ring-1 focus:ring-[#A27561] transition"
                      data-testid="contact-form-group"
                    />
                  </div>

                  <div>
                    <label class="block text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] mb-1">
                      Notes (optional)
                    </label>
                    <textarea
                      placeholder="Personal notes, phone number, address…"
                      value={formNotes()}
                      onInput={(e) => setFormNotes(e.currentTarget.value)}
                      rows={3}
                      class="w-full rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] p-2.5 text-xs text-[#1A1B1E] dark:text-[#F3F4F6] bg-white dark:bg-[#1E2025] focus:outline-none focus:ring-1 focus:ring-[#A27561] transition resize-none"
                      data-testid="contact-form-notes"
                    />
                  </div>

                  <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#E2DFD8] dark:border-[#2E3138]">
                    <button
                      type="button"
                      onClick={cancelForm}
                      class="px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#55575B] dark:text-[#A1A1AA] hover:bg-[#FAF9F6] dark:hover:bg-[#24262C] transition cursor-pointer"
                      data-testid="contact-cancel-btn"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving()}
                      class="px-4 py-1.5 rounded-xl bg-[#A27561] hover:bg-[#8D624F] text-white text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
                      data-testid="contact-save-btn"
                    >
                      {saving() ? "Saving…" : "Save Contact"}
                    </button>
                  </div>
                </div>
              </div>
            </Show>

            {/* Read Detail Mode */}
            <Show when={!isCreating() && !isEditing() && selectedContact()}>
              <div class="space-y-5 max-w-md mx-auto w-full bg-white dark:bg-[#1E2025] p-6 rounded-2xl border border-[#E2DFD8] dark:border-[#2E3138] shadow-xs">
                {/* Header: Large Avatar & Name */}
                <div class="flex items-start justify-between">
                  <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-full bg-[#A27561] text-white flex items-center justify-center font-bold text-lg shadow-sm">
                      {(selectedContact()?.name ? selectedContact()!.name![0] : selectedContact()!.email![0]).toUpperCase()}
                    </div>
                    <div>
                      <h4
                        class="text-base font-bold text-[#1A1B1E] dark:text-[#F3F4F6]"
                        data-testid="contact-detail-name"
                      >
                        {selectedContact()?.name || "Unnamed Contact"}
                      </h4>
                      <Show when={selectedContact()?.group_name}>
                        <span class="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#FAF7F2] dark:bg-[#2A2D34] text-[#A27561] dark:text-[#E5B5A1] border border-[#E2DFD8] dark:border-[#383C45]">
                          {selectedContact()?.group_name}
                        </span>
                      </Show>
                    </div>
                  </div>

                  <div class="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => startEdit(selectedContact()!)}
                      class="px-2.5 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F8F7F4] dark:hover:bg-[#26282E] transition flex items-center gap-1 cursor-pointer"
                      data-testid="contact-edit-btn"
                    >
                      <svg class="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(selectedContact()!.id)}
                      class="px-2.5 py-1.5 rounded-xl border border-rose-200 dark:border-rose-900/50 text-xs font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition flex items-center gap-1 cursor-pointer"
                      data-testid="contact-delete-btn"
                    >
                      <svg class="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                      <span>Delete</span>
                    </button>
                  </div>
                </div>

                {/* Email Section */}
                <div class="pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138] space-y-1">
                  <div class="text-[11px] font-medium text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider">
                    Email Address
                  </div>
                  <div class="flex items-center justify-between">
                    <span
                      class="text-xs font-medium text-[#1A1B1E] dark:text-[#F3F4F6] select-all"
                      data-testid="contact-detail-email"
                    >
                      {selectedContact()?.email}
                    </span>
                    <Show when={props.onComposeTo}>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedContact()?.email) {
                            props.onComposeTo!(selectedContact()!.email!);
                            props.onClose();
                          }
                        }}
                        class="text-[11px] text-[#A27561] hover:underline font-medium cursor-pointer"
                      >
                        Send message
                      </button>
                    </Show>
                  </div>
                </div>

                {/* Notes Section */}
                <div class="pt-3 border-t border-[#E2DFD8] dark:border-[#2E3138] space-y-1">
                  <div class="text-[11px] font-medium text-[#6F7173] dark:text-[#878A8E] uppercase tracking-wider">
                    Notes
                  </div>
                  <div
                    class="text-xs text-[#2B2C2D] dark:text-[#D1D5DB] whitespace-pre-wrap leading-relaxed"
                    data-testid="contact-detail-notes"
                  >
                    {selectedContact()?.notes || "No notes recorded."}
                  </div>
                </div>
              </div>
            </Show>

            {/* Empty State */}
            <Show when={!isCreating() && !isEditing() && !selectedContact()}>
              <div
                class="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#878A8E] dark:text-[#71717A]"
                data-testid="contacts-empty-state"
              >
                <div class="w-12 h-12 rounded-full bg-[#EFECE6] dark:bg-[#2A2D34] flex items-center justify-center mb-3">
                  <svg class="w-6 h-6 stroke-current fill-none stroke-2 text-[#878A8E]" viewBox="0 0 24 24">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <p class="text-xs font-medium">Select a contact or create a new one</p>
              </div>
            </Show>
          </div>
        </div>

        {/* Delete Confirmation Modal / Prompt */}
        <Show when={deleteConfirmId()}>
          <div
            class="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4"
            data-testid="delete-confirmation-dialog"
          >
            <div class="w-full max-w-sm rounded-2xl bg-white dark:bg-[#1E2025] p-5 shadow-2xl border border-red-200 dark:border-rose-900/50 space-y-3">
              <h4 class="font-bold text-sm text-[#1A1B1E] dark:text-[#F3F4F6]">
                Delete Contact?
              </h4>
              <p class="text-xs text-[#6F7173] dark:text-[#A1A1AA]">
                Are you sure you want to delete this contact? This action cannot be undone.
              </p>
              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  class="px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#FAF9F6] dark:hover:bg-[#24262C] cursor-pointer"
                  data-testid="cancel-delete-btn"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(deleteConfirmId()!)}
                  class="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                  data-testid="confirm-delete-btn"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
