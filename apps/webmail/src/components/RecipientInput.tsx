import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { ContactItem, OrgMember, ConnectedAccount, fetchContacts } from "../api";
import {
  RecipientChip,
  RecipientSuggestion,
  buildRecipientCandidates,
  filterAndSortRecipientSuggestions,
  resolveRecipientChip,
} from "../recipient_suggestions";

export type { RecipientChip, RecipientSuggestion };
export { buildRecipientCandidates, filterAndSortRecipientSuggestions, resolveRecipientChip };

export interface RecipientInputProps {
  id?: string;
  label: string;
  value: string; // Comma-separated string of emails
  onChange: (value: string) => void;
  contacts?: ContactItem[];
  orgMembers?: OrgMember[];
  connectedAccounts?: ConnectedAccount[];
  recentSenders?: Array<{ name?: string; email: string }>;
  senderAddress?: string;
  mailboxId?: string;
  placeholder?: string;
  required?: boolean;
}

export function RecipientInput(props: RecipientInputProps) {
  const [chips, setChips] = createSignal<RecipientChip[]>([]);
  const [inputValue, setInputValue] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<RecipientSuggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [isOpen, setIsOpen] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;
  let debounceTimer: any = null;

  let lastEmittedValue = "";

  function getAllCandidates(): RecipientSuggestion[] {
    return buildRecipientCandidates({
      orgMembers: props.orgMembers,
      contacts: props.contacts,
      connectedAccounts: props.connectedAccounts,
      recentSenders: props.recentSenders,
      senderAddress: props.senderAddress,
    });
  }

  // Initialize chips from incoming comma-separated value
  createEffect(() => {
    const raw = (props.value || "").trim();
    if (raw === lastEmittedValue) return;
    lastEmittedValue = raw;

    const parsedEmails = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const candidates = getAllCandidates();
    const newChips: RecipientChip[] = parsedEmails.map((email) => resolveRecipientChip(email, candidates));
    setChips(newChips);
    setInputValue("");
  });

  function emitChange(updatedChips: RecipientChip[]) {
    setChips(updatedChips);
    const emails = updatedChips.map((c) => c.email);
    const serialized = emails.join(", ");
    lastEmittedValue = serialized;
    props.onChange(serialized);
  }

  function addChip(name: string | undefined, email: string) {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return;

    // Duplicate prevention (case-insensitive)
    const exists = chips().some((c) => c.email.toLowerCase() === trimmedEmail.toLowerCase());
    if (exists) {
      setInputValue("");
      setIsOpen(false);
      emitChange(chips());
      return;
    }

    // Resolve name from known candidates if not explicitly provided
    let resolvedName = name?.trim();
    if (!resolvedName) {
      const candidates = getAllCandidates();
      const match = candidates.find((c) => c.email.toLowerCase() === trimmedEmail.toLowerCase());
      resolvedName = match?.name;
    }

    const nextChips = [...chips(), { name: resolvedName || undefined, email: trimmedEmail }];
    setInputValue("");
    setIsOpen(false);
    emitChange(nextChips);
  }

  function removeChip(index: number) {
    const nextChips = chips().filter((_, i) => i !== index);
    emitChange(nextChips);
  }

  function commitCurrentInput() {
    const trimmed = inputValue().trim().replace(/[,;]$/, "");
    if (trimmed && trimmed.includes("@")) {
      addChip(undefined, trimmed);
    }
  }

  function handleInputChange(val: string) {
    setInputValue(val);

    // If user types a comma or semicolon, commit immediately
    if (val.includes(",") || val.includes(";")) {
      const parts = val.split(/[,;]/);
      for (const part of parts) {
        const t = part.trim();
        if (t) addChip(undefined, t);
      }
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    const query = val.trim();
    // Gmail-style minimum character threshold: 3 characters or an explicit '@' domain search
    if (query.length < 3 && !query.startsWith("@")) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    debounceTimer = setTimeout(async () => {
      const candidates = getAllCandidates();
      const selectedEmails = new Set(chips().map((c) => c.email.toLowerCase()));

      let matches = filterAndSortRecipientSuggestions({
        query,
        candidates,
        selectedEmails,
        minQueryLength: 3,
      });

      // If local had fewer than 5 or was empty, query backend contacts if mailboxId provided
      if (matches.length < 5 && props.mailboxId) {
        try {
          const backendContacts = await fetchContacts(props.mailboxId, query);
          for (const bc of backendContacts) {
            if (!bc.email) continue;
            const clean = bc.email.trim().toLowerCase();
            if (!selectedEmails.has(clean) && !matches.some((m) => m.email.toLowerCase() === clean)) {
              matches.push({
                name: bc.name?.trim() || undefined,
                email: bc.email.trim(),
                source: "contact",
                group_name: bc.group_name || undefined,
              });
            }
          }
          matches = filterAndSortRecipientSuggestions({
            query,
            candidates: matches,
            selectedEmails,
          });
        } catch {
          // ignore error
        }
      }

      setSuggestions(matches.slice(0, 8));
      setHighlightedIndex(0);
      setIsOpen(matches.length > 0);
    }, 100);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (isOpen() && suggestions().length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % suggestions().length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + suggestions().length) % suggestions().length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = suggestions()[highlightedIndex()];
        if (selected && selected.email) {
          addChip(selected.name, selected.email);
        }
        return;
      }
      if (e.key === "Escape") {
        setIsOpen(false);
        return;
      }
    }

    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      const trimmed = inputValue().trim().replace(/[,;]$/, "");
      if (trimmed) {
        e.preventDefault();
        addChip(undefined, trimmed);
      }
      return;
    }

    if (e.key === "Backspace" && inputValue() === "" && chips().length > 0) {
      e.preventDefault();
      removeChip(chips().length - 1);
    }
  }

  function handleBlur() {
    setTimeout(() => {
      commitCurrentInput();
      setIsOpen(false);
    }, 150);
  }

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });

  return (
    <div class="relative flex items-center gap-2 text-xs flex-wrap min-h-[32px]">
      <label
        for={props.id || (props.label === "To" ? "composeToInput" : undefined)}
        class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium select-none"
      >
        {props.label}:
      </label>

      <div
        class="flex-1 flex flex-wrap items-center gap-1.5 py-1 min-w-0"
        onClick={() => inputRef?.focus()}
      >
        {/* Rendered Chips */}
        <For each={chips()}>
          {(chip, index) => {
            const displayName = chip.name || chip.email;
            return (
              <span
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EFECE6] dark:bg-[#2A2D34] text-[#1A1B1E] dark:text-[#F3F4F6] text-xs font-medium border border-[#D5D1C8] dark:border-[#383C45] group select-none shadow-xs transition"
                title={chip.email}
                data-testid="recipient-chip"
                data-email={chip.email}
              >
                <Show when={chip.name}>
                  <span
                    class="w-4 h-4 rounded-full bg-[#A27561] text-white flex items-center justify-center text-[10px] font-bold"
                    data-testid="chip-avatar"
                  >
                    {chip.name![0].toUpperCase()}
                  </span>
                </Show>
                <span class="max-w-[140px] truncate" data-testid="chip-label">{displayName}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChip(index());
                  }}
                  class="text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-white rounded-full p-0.5 transition cursor-pointer"
                  aria-label="Remove recipient"
                >
                  <svg class="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            );
          }}
        </For>

        {/* Text Input */}
        <div class="relative flex-1 min-w-[120px]">
          <input
            id={props.id || (props.label === "To" ? "composeToInput" : undefined)}
            ref={inputRef}
            type="text"
            placeholder={chips().length === 0 ? props.placeholder || "recipient@example.com" : ""}
            value={inputValue()}
            onInput={(e) => handleInputChange(e.currentTarget.value)}
            onFocus={() => {
              if (inputValue().trim()) {
                handleInputChange(inputValue());
              }
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            required={props.required && chips().length === 0}
            class="w-full bg-transparent text-xs text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none py-0.5"
            autocomplete="off"
            data-testid="recipient-input"
          />

          {/* Autocomplete Dropdown */}
          <Show when={isOpen() && suggestions().length > 0}>
            <ul
              class="absolute left-0 top-full mt-1 w-80 max-h-64 overflow-y-auto bg-white dark:bg-[#1E2025] rounded-xl shadow-xl border border-[#E2DFD8] dark:border-[#2E3138] py-1.5 z-50 font-sans"
              role="listbox"
              data-testid="autocomplete-dropdown"
            >
              <For each={suggestions()}>
                {(item, index) => {
                  const initial = (item.name ? item.name[0] : (item.email || "U")[0]).toUpperCase();
                  const isHighlighted = index() === highlightedIndex();
                  return (
                    <li
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseDown={(e) => {
                        e.preventDefault(); // Prevent input blur before selection
                        addChip(item.name, item.email);
                      }}
                      onClick={() => {
                        addChip(item.name, item.email);
                      }}
                      onMouseEnter={() => setHighlightedIndex(index())}
                      class={`px-3 py-2 flex items-center gap-2.5 cursor-pointer text-xs transition ${
                        isHighlighted
                          ? "bg-[#FAF7F2] dark:bg-[#282B32] text-[#A27561] dark:text-[#E5B5A1]"
                          : "text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F8F7F4] dark:hover:bg-[#26282E]"
                      }`}
                      data-testid="autocomplete-item"
                      data-email={item.email}
                      data-name={item.name || ""}
                    >
                      <div class="w-7 h-7 rounded-full bg-[#A27561]/20 text-[#A27561] dark:text-[#E5B5A1] flex items-center justify-center font-bold text-xs flex-shrink-0">
                        {initial}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="font-medium truncate flex items-center gap-1.5">
                          <span>{item.name || item.email}</span>
                        </div>
                        <Show when={item.name}>
                          <div class="text-[11px] text-[#6F7173] dark:text-[#878A8E] truncate">
                            {item.email}
                          </div>
                        </Show>
                      </div>
                      <Show when={item.source === "colleague"}>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-medium border border-amber-200/60 dark:border-amber-800/40 flex-shrink-0">
                          Colleague
                        </span>
                      </Show>
                      <Show when={item.source === "contact"}>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-medium border border-blue-200/60 dark:border-blue-800/40 flex-shrink-0">
                          {item.group_name || "Contact"}
                        </span>
                      </Show>
                      <Show when={item.source === "account"}>
                        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 font-medium border border-stone-200/60 dark:border-stone-700/40 flex-shrink-0">
                          Account
                        </span>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </div>
  );
}
