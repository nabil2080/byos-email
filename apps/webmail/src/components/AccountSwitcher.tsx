import { Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ConnectedAccount, getAccountColor } from "../api";
import { ProfileAvatar } from "./ProfileAvatar";

export interface AccountSwitcherProps {
  currentEmail: string;
  isPrivate: boolean;
  connectedAccounts: ConnectedAccount[];
  activeAccountId: string;
  onSelectAccount: (account: ConnectedAccount) => void;
  onSelectAllInboxes?: () => void;
  onOpenAddMailbox: () => void;
  onSignOut: (accountId?: string, logOutAll?: boolean) => void;
  unreadCounts?: Record<string, number>;
  totalUnifiedUnread?: number;
  profilePhotoUrl?: string | null;
  photoUrls?: Record<string, string>;
}

export const AccountSwitcher: Component<AccountSwitcherProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [focusedIndex, setFocusedIndex] = createSignal(0);
  let dropdownRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  const isAll = () => props.activeAccountId === "__all__";

  const currentSelectionLabel = () => {
    if (isAll()) return "All Inboxes";
    return props.currentEmail || "Account";
  };

  const currentSelectionColor = () => {
    if (isAll()) return "#A27561";
    return getAccountColor(props.activeAccountId || props.connectedAccounts?.[0]?.id || "");
  };

  const currentSelectionUnread = () => {
    if (isAll()) {
      return props.totalUnifiedUnread || 0;
    }
    return props.unreadCounts ? props.unreadCounts[props.activeAccountId] || 0 : 0;
  };

  const hasMultipleAccounts = () => (props.connectedAccounts?.length || 0) > 1;

  const isAccountLocked = (id?: string) => {
    if (typeof window === "undefined" || !id) return false;
    if (id === "__all__") {
      return (props.connectedAccounts || []).some(
        (a) => !sessionStorage.getItem("byos_mailbox_sk_" + a.id) && !sessionStorage.getItem("byos_xwing_seed_" + a.id)
      );
    }
    return !sessionStorage.getItem("byos_mailbox_sk_" + id) && !sessionStorage.getItem("byos_xwing_seed_" + id);
  };

  function handleClickOutside(e: MouseEvent) {
    if (dropdownRef && !dropdownRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }

  onMount(() => {
    document.addEventListener("mousedown", handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener("mousedown", handleClickOutside);
  });

  const showAllInboxes = () => (props.connectedAccounts?.length || 0) > 1;
  const totalOptionsCount = () => (showAllInboxes() ? 1 : 0) + (props.connectedAccounts?.length || 0) + 1; // (All Inboxes if 2+) + accounts + Add Mailbox

  function handleTriggerKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setIsOpen((prev) => !prev);
      setFocusedIndex(0);
    }
  }

  function handleDropdownKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      triggerRef?.focus();
      return;
    }

    const total = totalOptionsCount();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => (prev - 1 + total) % total);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const idx = focusedIndex();
      if (showAllInboxes()) {
        if (idx === 0) {
          // All Inboxes
          setIsOpen(false);
          props.onSelectAllInboxes?.();
          triggerRef?.focus();
        } else if (idx <= (props.connectedAccounts?.length || 0)) {
          // Account index
          const acc = props.connectedAccounts[idx - 1];
          if (acc) {
            setIsOpen(false);
            props.onSelectAccount(acc);
            triggerRef?.focus();
          }
        } else {
          // Add Mailbox
          setIsOpen(false);
          props.onOpenAddMailbox();
        }
      } else {
        if (idx < (props.connectedAccounts?.length || 0)) {
          // Account index
          const acc = props.connectedAccounts[idx];
          if (acc) {
            setIsOpen(false);
            props.onSelectAccount(acc);
            triggerRef?.focus();
          }
        } else {
          // Add Mailbox
          setIsOpen(false);
          props.onOpenAddMailbox();
        }
      }
    }
  }

  return (
    <div class="relative w-full" ref={dropdownRef}>
      {/* ── Compact Account Chip Selector ── */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        onKeyDown={handleTriggerKeyDown}
        aria-expanded={isOpen()}
        aria-haspopup="listbox"
        data-testid="account-chip-selector"
        data-account-switcher="true"
        title={`Current mailbox context: ${currentSelectionLabel()}`}
        class="w-full flex items-center justify-between px-2.5 py-2 rounded-xl bg-[#FAF9F7] dark:bg-[#1E2025] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#2A2A2E] border border-[#E2DFD8] dark:border-[#333336] transition-all text-left group cursor-pointer shadow-2xs focus:outline-none focus:ring-2 focus:ring-[#A27561]/50"
      >
        <div class="flex items-center gap-2 min-w-0">
          {/* Avatar replacing colored dot (24x24px chip size) */}
          <ProfileAvatar
            size="chip"
            mailboxId={isAll() ? "__all__" : (props.activeAccountId || props.connectedAccounts?.[0]?.id)}
            email={isAll() ? "All Inboxes" : props.currentEmail}
            displayName={isAll() ? "All Inboxes" : props.connectedAccounts?.find((a) => a.id === props.activeAccountId)?.displayName}
            isAll={isAll()}
            photoUrl={props.profilePhotoUrl}
            testId="account-chip-dot"
            class="ring-1 ring-black/10 dark:ring-white/20"
          />

          {/* Email or 'All Inboxes' label */}
          <span
            class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] truncate"
            data-testid="account-chip-text"
          >
            {currentSelectionLabel()}
          </span>
        </div>

        <div class="flex items-center gap-1.5 flex-shrink-0 ml-1">
          {/* Lock badge if locked */}
          <Show when={isAccountLocked(props.activeAccountId || props.connectedAccounts?.[0]?.id)}>
            <span
              title="Mailbox keys locked"
              data-testid="account-chip-locked"
              class="text-amber-600 dark:text-amber-400 flex items-center"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </span>
          </Show>

          {/* Unread badge if count > 0 */}
          <Show when={currentSelectionUnread() > 0}>
            <span
              class="text-[10px] font-mono font-medium px-1.5 py-0.2 rounded-full bg-[#A27561] text-white"
              data-testid="account-chip-unread"
            >
              {currentSelectionUnread()}
            </span>
          </Show>

          {/* Chevron */}
          <svg
            class={`w-3.5 h-3.5 text-[#878A8E] group-hover:text-[#2B2C2D] dark:group-hover:text-[#ECEBE8] transition-transform duration-200 ${
              isOpen() ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* ── Dropdown Menu ── */}
      {isOpen() && (
        <div
          role="listbox"
          tabindex="0"
          onKeyDown={handleDropdownKeyDown}
          class="absolute left-0 top-full mt-1.5 w-68 bg-white dark:bg-[#222225] border border-[#E2DFD8] dark:border-[#333336] rounded-2xl shadow-xl z-50 p-1.5 space-y-1 overflow-hidden font-sans outline-none focus:ring-1 focus:ring-[#A27561]/40"
        >
          <div class="px-2.5 py-1 text-[10px] font-bold text-[#878A8E] uppercase tracking-wider font-mono">
            Mailbox Context
          </div>

          <div class="max-h-64 overflow-y-auto space-y-0.5 custom-scrollbar">
            {/* Option 1: All Inboxes (Only shown when 2+ accounts connected) */}
            <Show when={showAllInboxes()}>
              <div
                role="option"
                aria-selected={isAll()}
                data-testid="account-dropdown-all"
                onClick={() => {
                  setIsOpen(false);
                  props.onSelectAllInboxes?.();
                  triggerRef?.focus();
                }}
                class={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer text-left group ${
                  isAll()
                    ? "bg-[#F3ECE8] dark:bg-[#342722] text-[#A27561] dark:text-[#D5A795] font-semibold"
                    : focusedIndex() === 0
                    ? "bg-[#F0EEE9] dark:bg-[#2A2A2E] text-[#3C3D3E] dark:text-[#ECEBE8]"
                    : "hover:bg-[#F0EEE9] dark:hover:bg-[#2A2A2E] text-[#3C3D3E] dark:text-[#ECEBE8]"
                }`}
              >
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <ProfileAvatar
                    size="dropdown"
                    mailboxId="__all__"
                    email="All Inboxes"
                    isAll={true}
                    testId="account-dot-all"
                    class="ring-1 ring-black/10 dark:ring-white/20"
                  />
                  <div class="min-w-0 flex flex-col">
                    <span
                      class="truncate font-medium text-[#2B2C2D] dark:text-[#ECEBE8]"
                      data-testid="account-dropdown-all-label"
                    >
                      All Inboxes
                    </span>
                    <span class="text-[10px] text-[#878A8E]">Aggregated view across mailboxes</span>
                  </div>
                </div>

                <div class="flex items-center gap-1.5">
                  <Show when={(props.totalUnifiedUnread || 0) > 0}>
                    <span
                      class="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#A27561] text-white font-medium"
                      data-testid="account-unread-all"
                    >
                      {props.totalUnifiedUnread}
                    </span>
                  </Show>
                  <Show when={isAll()}>
                    <svg class="w-3.5 h-3.5 text-[#A27561] dark:text-[#D5A795] stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </Show>
                </div>
              </div>
            </Show>

            {/* Option 2..N: Individual Connected Accounts */}
            <For each={props.connectedAccounts}>
              {(acc, i) => {
                const isActive = () => !isAll() && (acc.id === props.activeAccountId || acc.email === props.currentEmail);
                const isFocused = () => focusedIndex() === (showAllInboxes() ? i() + 1 : i());
                const unread = () => (props.unreadCounts ? props.unreadCounts[acc.id] || 0 : 0);

                return (
                  <div
                    role="option"
                    aria-selected={isActive()}
                    data-testid={`account-dropdown-${acc.id}`}
                    onClick={() => {
                      setIsOpen(false);
                      props.onSelectAccount(acc);
                      triggerRef?.focus();
                    }}
                    class={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer text-left group ${
                      isActive()
                        ? "bg-[#F3ECE8] dark:bg-[#342722] text-[#A27561] dark:text-[#D5A795] font-semibold"
                        : isFocused()
                        ? "bg-[#F0EEE9] dark:bg-[#2A2A2E] text-[#3C3D3E] dark:text-[#ECEBE8]"
                        : "hover:bg-[#F0EEE9] dark:hover:bg-[#2A2A2E] text-[#3C3D3E] dark:text-[#ECEBE8]"
                    }`}
                  >
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      <ProfileAvatar
                        size="dropdown"
                        mailboxId={acc.id}
                        email={acc.email}
                        displayName={acc.displayName}
                        photoUrl={props.photoUrls?.[acc.id] || (acc.id === props.activeAccountId ? props.profilePhotoUrl : undefined)}
                        testId={`sidebar-dot-${acc.id}`}
                        class="ring-1 ring-black/10 dark:ring-white/20"
                      />
                      <div class="min-w-0 flex flex-col">
                        <span
                          class="truncate font-medium text-[#2B2C2D] dark:text-[#ECEBE8]"
                          data-testid={`account-dropdown-label-${acc.id}`}
                        >
                          {acc.email}
                        </span>
                        <span class="text-[10px] text-[#878A8E] capitalize">
                          {acc.privacyMode === "private" ? "Private Mailbox" : "Org-Managed"}
                        </span>
                      </div>
                    </div>

                    <div class="flex items-center gap-1.5">
                      <Show when={isAccountLocked(acc.id)}>
                        <span
                          class="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5"
                          title="Keys locked"
                          data-testid={`account-locked-${acc.id}`}
                        >
                          <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                          </svg>
                          <span class="hidden sm:inline font-mono">Locked</span>
                        </span>
                      </Show>
                      <Show when={unread() > 0}>
                        <span
                          class="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-[#A27561] text-white font-medium"
                          data-testid={`account-unread-${acc.id}`}
                        >
                          {unread()}
                        </span>
                      </Show>
                      <Show when={isActive()}>
                        <svg class="w-3.5 h-3.5 text-[#A27561] dark:text-[#D5A795] stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </Show>
                      <Show when={hasMultipleAccounts()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(false);
                            props.onSignOut(acc.id, false);
                          }}
                          title={`Sign out of ${acc.email}`}
                          data-testid={`account-signout-${acc.id}`}
                          class="p-1 rounded-lg text-[#878A8E] hover:text-rose-600 hover:bg-rose-100/60 dark:hover:bg-rose-950/40 transition cursor-pointer opacity-0 group-hover:opacity-100"
                        >
                          <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                        </button>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          <div class="border-t border-[#E2DFD8] dark:border-[#333336] my-1"></div>

          {/* Action: Add Another Mailbox */}
          <button
            type="button"
            data-testid="add-mailbox-button"
            onClick={() => {
              setIsOpen(false);
              props.onOpenAddMailbox();
            }}
            class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-[#A27561] hover:bg-[#F3ECE8] dark:hover:bg-[#342722] transition cursor-pointer text-left"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>Add another mailbox</span>
          </button>

          {/* Sign Out Actions */}
          <Show
            when={hasMultipleAccounts()}
            fallback={
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  props.onSignOut();
                }}
                class="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer text-left"
              >
                <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <span>Sign out</span>
              </button>
            }
          >
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                props.onSignOut(props.activeAccountId, false);
              }}
              class="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-[#3C3D3E] dark:text-[#A3A3A3] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2A2E] transition cursor-pointer text-left"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span class="truncate">Sign out of {currentSelectionLabel()}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                props.onSignOut(undefined, true);
              }}
              class="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition cursor-pointer text-left"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <line x1="12" y1="2" x2="12" y2="12" />
              </svg>
              <span>Sign out of all accounts</span>
            </button>
          </Show>
        </div>
      )}
    </div>
  );
};
