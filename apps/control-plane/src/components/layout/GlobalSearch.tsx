import { Component, createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { useOrg } from "../../context/OrgContext";
import {
  searchOrganization,
  SearchDomainResult,
  SearchMailboxResult,
  SearchMemberResult,
  NavigationItem,
  NAVIGATION_DESTINATIONS,
} from "../../lib/api/search";

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

type UnifiedResultItem =
  | { type: "navigation"; data: NavigationItem }
  | { type: "domain"; data: SearchDomainResult }
  | { type: "mailbox"; data: SearchMailboxResult }
  | { type: "member"; data: SearchMemberResult };

export const GlobalSearch: Component<GlobalSearchProps> = (props) => {
  const org = useOrg();
  const navigate = useNavigate();

  const [query, setQuery] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [domains, setDomains] = createSignal<SearchDomainResult[]>([]);
  const [mailboxes, setMailboxes] = createSignal<SearchMailboxResult[]>([]);
  const [members, setMembers] = createSignal<SearchMemberResult[]>([]);
  const [navResults, setNavResults] = createSignal<NavigationItem[]>([]);
  const [activeIndex, setActiveIndex] = createSignal(0);

  let inputRef: HTMLInputElement | undefined;
  let abortController: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Flattened active items for arrow key navigation
  const flattenedItems = createMemo<UnifiedResultItem[]>(() => {
    const q = query().trim();
    if (!q) {
      // In empty state, offer top suggested navigation items
      return NAVIGATION_DESTINATIONS.slice(0, 5).map((n) => ({
        type: "navigation",
        data: n,
      }));
    }

    const items: UnifiedResultItem[] = [];
    for (const n of navResults()) {
      items.push({ type: "navigation", data: n });
    }
    for (const d of domains()) {
      items.push({ type: "domain", data: d });
    }
    for (const m of mailboxes()) {
      items.push({ type: "mailbox", data: m });
    }
    for (const u of members()) {
      items.push({ type: "member", data: u });
    }
    return items;
  });

  const totalResultsCount = createMemo(() => {
    return (
      navResults().length +
      domains().length +
      mailboxes().length +
      members().length
    );
  });

  const executeSearch = (searchQuery: string) => {
    if (abortController) {
      abortController.abort();
    }
    abortController = new AbortController();

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setDomains([]);
      setMailboxes([]);
      setMembers([]);
      setNavResults([]);
      setLoading(false);
      setActiveIndex(0);
      return;
    }

    setLoading(true);
    searchOrganization(org.orgId, trimmed, abortController.signal)
      .then((res) => {
        setDomains(res.domains);
        setMailboxes(res.mailboxes);
        setMembers(res.members);
        setNavResults(res.navigation);
        setActiveIndex(0);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        setLoading(false);
      });
  };

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      executeSearch(val);
    }, 200);
  };

  const selectItem = (item: UnifiedResultItem) => {
    props.onClose();
    if (item.type === "navigation") {
      navigate(item.data.href);
    } else if (item.type === "domain") {
      navigate("/dashboard/domains");
    } else if (item.type === "mailbox") {
      navigate("/dashboard/mailboxes");
    } else if (item.type === "member") {
      navigate("/dashboard/members");
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return;
    }

    const items = flattenedItems();
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1 >= items.length ? 0 : prev + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 < 0 ? items.length - 1 : prev - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = items[activeIndex()];
      if (current) {
        selectItem(current);
      }
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onClose();
        }
      };
      window.addEventListener("keydown", handleEscape);
      onCleanup(() => {
        window.removeEventListener("keydown", handleEscape);
      });

      setTimeout(() => {
        inputRef?.focus();
        inputRef?.select();
      }, 50);
    } else {
      setQuery("");
      setDomains([]);
      setMailboxes([]);
      setMembers([]);
      setNavResults([]);
      setActiveIndex(0);
    }
  });

  onCleanup(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (abortController) abortController.abort();
  });

  return (
    <Show when={props.isOpen}>
      <div
        class="fixed inset-0 z-50 flex items-start justify-center pt-14 sm:pt-20 px-4 sm:px-6"
        data-testid="global-search-modal"
      >
        {/* Backdrop */}
        <div
          class="fixed inset-0 bg-[#2B2C2D]/50 backdrop-blur-sm transition-opacity"
          onClick={props.onClose}
          aria-hidden="true"
        />

        {/* Command Palette Card */}
        <div
          class="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#E2DFD8] overflow-hidden flex flex-col max-h-[80vh] z-10 animate-in fade-in zoom-in-95 duration-150"
          onKeyDown={handleKeyDown}
        >
          {/* Input Bar */}
          <div class="flex items-center gap-3 px-4 py-3.5 border-b border-[#E2DFD8] bg-white">
            <svg
              class="w-5 h-5 text-[#6F7173] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>

            <input
              ref={inputRef}
              type="text"
              value={query()}
              onInput={(e) => handleInput(e.currentTarget.value)}
              placeholder="Search mailboxes, domains, people, navigation..."
              class="w-full bg-transparent text-[#3C3D3E] placeholder-[#6F7173] text-sm focus:outline-none"
              aria-label="Search input"
              data-testid="global-search-input"
            />

            <Show when={loading()}>
              <div
                class="w-4 h-4 border-2 border-[#9E725F]/30 border-t-[#9E725F] rounded-full animate-spin shrink-0"
                aria-label="Searching..."
              />
            </Show>

            <Show when={query().length > 0}>
              <button
                type="button"
                onClick={() => handleInput("")}
                class="p-1 rounded text-[#6F7173] hover:text-[#3C3D3E] hover:bg-[#F0EEE9] text-xs font-semibold"
                aria-label="Clear search"
              >
                ✕
              </button>
            </Show>

            <span class="hidden sm:inline-flex items-center text-[10px] font-mono text-[#6F7173] bg-[#F0EEE9] px-2 py-0.5 rounded border border-[#E2DFD8]">
              ESC
            </span>
          </div>

          {/* Results Container */}
          <div class="overflow-y-auto flex-1 p-3 divide-y divide-[#E2DFD8]/40">
            {/* Empty State / Suggested */}
            <Show when={!query().trim()}>
              <div class="py-2 px-3">
                <div class="text-[11px] font-bold uppercase tracking-wider text-[#6F7173] mb-2">
                  Suggested Destinations
                </div>
                <div class="space-y-1">
                  <For each={NAVIGATION_DESTINATIONS.slice(0, 5)}>
                    {(item, idx) => {
                      const isSelected = () => activeIndex() === idx();
                      return (
                        <div
                          class={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-sm transition-colors ${
                            isSelected()
                              ? "bg-[#F3ECE8] text-[#9E725F]"
                              : "text-[#3C3D3E] hover:bg-[#F0EEE9]/70"
                          }`}
                          onClick={() => selectItem({ type: "navigation", data: item })}
                          onMouseEnter={() => setActiveIndex(idx())}
                        >
                          <div class="flex items-center gap-3">
                            <span class="w-2 h-2 rounded-full bg-[#9E725F]" />
                            <span class="font-medium">{item.title}</span>
                            <span class="text-xs text-[#6F7173] hidden sm:inline">
                              {item.description}
                            </span>
                          </div>
                          <span class="text-xs text-[#6F7173]">↵</span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>

            {/* No Results State */}
            <Show when={query().trim() && !loading() && totalResultsCount() === 0}>
              <div
                class="py-12 px-6 text-center text-[#6F7173]"
                data-testid="search-no-results"
              >
                <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-[#F0EEE9] flex items-center justify-center text-[#6F7173]">
                  <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <p class="text-sm font-medium text-[#3C3D3E]">
                  No resources matching "{query()}"
                </p>
                <p class="text-xs text-[#6F7173] mt-1">
                  Try searching for a domain name, mailbox handle, member email, or section title.
                </p>
              </div>
            </Show>

            {/* 1. Navigation Results */}
            <Show when={navResults().length > 0}>
              <div class="py-2 px-1">
                <div class="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6F7173] flex items-center justify-between">
                  <span>Navigation</span>
                  <span class="text-[10px] font-mono text-[#9E725F] bg-[#9E725F]/10 px-1.5 py-0.5 rounded">
                    {navResults().length}
                  </span>
                </div>
                <div class="space-y-1">
                  <For each={navResults()}>
                    {(item) => {
                      const itemIdx = () =>
                        flattenedItems().findIndex(
                          (fi) => fi.type === "navigation" && fi.data.id === item.id
                        );
                      const isSelected = () => activeIndex() === itemIdx();
                      return (
                        <div
                          class={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-sm transition-colors ${
                            isSelected()
                              ? "bg-[#F3ECE8] text-[#9E725F]"
                              : "text-[#3C3D3E] hover:bg-[#F0EEE9]/70"
                          }`}
                          onClick={() => selectItem({ type: "navigation", data: item })}
                          onMouseEnter={() => setActiveIndex(itemIdx())}
                          data-testid={`search-result-${item.id}`}
                        >
                          <div class="flex items-center gap-3">
                            <span class="w-7 h-7 rounded-lg bg-[#9E725F]/10 text-[#9E725F] flex items-center justify-center text-xs font-bold shrink-0">
                              →
                            </span>
                            <div>
                              <div class="font-semibold text-xs sm:text-sm">{item.title}</div>
                              <div class="text-[11px] text-[#6F7173]">{item.description}</div>
                            </div>
                          </div>
                          <span class="text-xs text-[#9E725F] font-mono">Jump</span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>

            {/* 2. Domain Results */}
            <Show when={domains().length > 0}>
              <div class="py-2 px-1">
                <div class="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6F7173] flex items-center justify-between">
                  <span>Domains</span>
                  <span class="text-[10px] font-mono text-[#9E725F] bg-[#9E725F]/10 px-1.5 py-0.5 rounded">
                    {domains().length}
                  </span>
                </div>
                <div class="space-y-1">
                  <For each={domains()}>
                    {(item) => {
                      const itemIdx = () =>
                        flattenedItems().findIndex(
                          (fi) => fi.type === "domain" && fi.data.id === item.id
                        );
                      const isSelected = () => activeIndex() === itemIdx();
                      return (
                        <div
                          class={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-sm transition-colors ${
                            isSelected()
                              ? "bg-[#F3ECE8] text-[#9E725F]"
                              : "text-[#3C3D3E] hover:bg-[#F0EEE9]/70"
                          }`}
                          onClick={() => selectItem({ type: "domain", data: item })}
                          onMouseEnter={() => setActiveIndex(itemIdx())}
                          data-testid={`search-result-domain-${item.id}`}
                        >
                          <div class="flex items-center gap-3">
                            <span class="w-7 h-7 rounded-lg bg-[#9E725F]/10 text-[#9E725F] flex items-center justify-center text-xs shrink-0">
                              🌐
                            </span>
                            <div>
                              <div class="font-semibold text-xs sm:text-sm">{item.name}</div>
                              <div class="text-[11px] text-[#6F7173] font-mono">
                                ID: {item.id.slice(0, 8)}...
                              </div>
                            </div>
                          </div>
                          <span
                            class={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded ${
                              item.is_verified
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            {item.is_verified ? "Verified" : "Pending"}
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>

            {/* 3. Mailbox Results */}
            <Show when={mailboxes().length > 0}>
              <div class="py-2 px-1">
                <div class="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6F7173] flex items-center justify-between">
                  <span>Mailboxes</span>
                  <span class="text-[10px] font-mono text-[#9E725F] bg-[#9E725F]/10 px-1.5 py-0.5 rounded">
                    {mailboxes().length}
                  </span>
                </div>
                <div class="space-y-1">
                  <For each={mailboxes()}>
                    {(item) => {
                      const itemIdx = () =>
                        flattenedItems().findIndex(
                          (fi) => fi.type === "mailbox" && fi.data.id === item.id
                        );
                      const isSelected = () => activeIndex() === itemIdx();
                      return (
                        <div
                          class={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-sm transition-colors ${
                            isSelected()
                              ? "bg-[#F3ECE8] text-[#9E725F]"
                              : "text-[#3C3D3E] hover:bg-[#F0EEE9]/70"
                          }`}
                          onClick={() => selectItem({ type: "mailbox", data: item })}
                          onMouseEnter={() => setActiveIndex(itemIdx())}
                          data-testid={`search-result-mailbox-${item.id}`}
                        >
                          <div class="flex items-center gap-3">
                            <span class="w-7 h-7 rounded-lg bg-[#9E725F]/10 text-[#9E725F] flex items-center justify-center text-xs shrink-0">
                              ✉
                            </span>
                            <div>
                              <div class="font-semibold text-xs sm:text-sm font-mono text-[#3C3D3E]">
                                {item.email}
                              </div>
                              <div class="text-[11px] text-[#6F7173] capitalize">
                                {item.mode.replace("_", " ")}
                              </div>
                            </div>
                          </div>
                          <span class="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                            {item.status || "Active"}
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>

            {/* 4. Member Results */}
            <Show when={members().length > 0}>
              <div class="py-2 px-1">
                <div class="px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-[#6F7173] flex items-center justify-between">
                  <span>Team & Members</span>
                  <span class="text-[10px] font-mono text-[#9E725F] bg-[#9E725F]/10 px-1.5 py-0.5 rounded">
                    {members().length}
                  </span>
                </div>
                <div class="space-y-1">
                  <For each={members()}>
                    {(item) => {
                      const itemIdx = () =>
                        flattenedItems().findIndex(
                          (fi) => fi.type === "member" && fi.data.id === item.id
                        );
                      const isSelected = () => activeIndex() === itemIdx();
                      return (
                        <div
                          class={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-sm transition-colors ${
                            isSelected()
                              ? "bg-[#F3ECE8] text-[#9E725F]"
                              : "text-[#3C3D3E] hover:bg-[#F0EEE9]/70"
                          }`}
                          onClick={() => selectItem({ type: "member", data: item })}
                          onMouseEnter={() => setActiveIndex(itemIdx())}
                          data-testid={`search-result-member-${item.id}`}
                        >
                          <div class="flex items-center gap-3">
                            <span class="w-7 h-7 rounded-lg bg-[#9E725F]/10 text-[#9E725F] flex items-center justify-center text-xs shrink-0 font-bold uppercase">
                              {item.display_name ? item.display_name[0] : item.email[0]}
                            </span>
                            <div>
                              <div class="font-semibold text-xs sm:text-sm">
                                {item.display_name || item.email.split("@")[0]}
                              </div>
                              <div class="text-[11px] text-[#6F7173] font-mono">
                                {item.email}
                              </div>
                            </div>
                          </div>
                          <span class="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-[#9E725F]/15 text-[#9E725F]">
                            {item.role}
                          </span>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          {/* Footer Shortcuts */}
          <div class="px-4 py-2.5 bg-[#F0EEE9]/60 border-t border-[#E2DFD8] flex items-center justify-between text-[11px] text-[#6F7173]">
            <div class="flex items-center gap-4">
              <span class="flex items-center gap-1">
                <kbd class="px-1.5 py-0.5 rounded bg-white border border-[#E2DFD8] font-mono text-[10px]">↑</kbd>
                <kbd class="px-1.5 py-0.5 rounded bg-white border border-[#E2DFD8] font-mono text-[10px]">↓</kbd>
                <span>to navigate</span>
              </span>
              <span class="flex items-center gap-1">
                <kbd class="px-1.5 py-0.5 rounded bg-white border border-[#E2DFD8] font-mono text-[10px]">↵</kbd>
                <span>to select</span>
              </span>
            </div>
            <span class="text-[10px] font-mono text-[#9E725F] font-semibold">
              Organization Scope: {org.orgId.slice(0, 8)}...
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default GlobalSearch;
