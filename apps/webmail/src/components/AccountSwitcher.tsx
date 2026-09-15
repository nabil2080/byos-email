import { Component, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { ConnectedAccount } from "../api";
import { ProfileAvatar } from "./ProfileAvatar";

interface AccountSwitcherProps {
  currentEmail: string;
  isPrivate: boolean;
  connectedAccounts: ConnectedAccount[];
  activeAccountId: string;
  onSelectAccount: (account: ConnectedAccount) => void;
  onOpenAddMailbox: () => void;
  onSignOut: (accountId?: string, logOutAll?: boolean) => void;
}

export const AccountSwitcher: Component<AccountSwitcherProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let dropdownRef: HTMLDivElement | undefined;

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

  const hasMultipleAccounts = () => (props.connectedAccounts?.length || 0) > 1;

  return (
    <div class="relative w-full" ref={dropdownRef}>
      {/* Trigger Badge */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="w-full flex items-center justify-between p-1.5 rounded-xl hover:bg-[#E8E5DF]/70 dark:hover:bg-[#2A2A2E] transition-colors text-left group cursor-pointer border border-transparent hover:border-[#E2DFD8]/50 dark:hover:border-[#333336]"
        title={`Mailbox: ${props.currentEmail} (${props.isPrivate ? "Private Zero-Knowledge" : "Org-Managed"})`}
      >
        <div class="flex items-center gap-2 min-w-0">
          <ProfileAvatar email={props.currentEmail} size="sm" />
          <div class="min-w-0 flex flex-col">
            <span class="text-xs font-semibold text-[#2B2C2D] dark:text-[#ECEBE8] truncate">
              {props.currentEmail}
            </span>
            <span class="text-[10px] text-[#878A8E] truncate">
              {props.isPrivate ? "Private Mailbox" : "Org-Managed"}
            </span>
          </div>
        </div>

        <div class="flex items-center gap-1 flex-shrink-0 ml-1">
          <span class="text-[9px] font-mono font-bold bg-[#E8E5DF] dark:bg-[#2E2E32] text-[#6F7173] dark:text-[#A3A3A3] px-1.5 py-0.5 rounded">
            BYOS
          </span>
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

      {/* Dropdown Menu */}
      {isOpen() && (
        <div class="absolute left-0 top-full mt-1.5 w-64 bg-white dark:bg-[#222225] border border-[#E2DFD8] dark:border-[#333336] rounded-2xl shadow-xl z-50 p-1.5 space-y-1 overflow-hidden font-sans">
          <div class="px-2.5 py-1 text-[10px] font-bold text-[#878A8E] uppercase tracking-wider font-mono">
            Connected Mailboxes
          </div>

          <div class="max-h-56 overflow-y-auto space-y-0.5 custom-scrollbar">
            <For each={props.connectedAccounts}>
              {(acc) => {
                const isActive = () => acc.id === props.activeAccountId || acc.email === props.currentEmail;
                return (
                  <div
                    class={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer text-left group ${
                      isActive()
                        ? "bg-[#F3ECE8] dark:bg-[#342722] text-[#A27561] dark:text-[#D5A795] font-medium"
                        : "hover:bg-[#F0EEE9] dark:hover:bg-[#2A2A2E] text-[#3C3D3E] dark:text-[#ECEBE8]"
                    }`}
                    onClick={() => {
                      setIsOpen(false);
                      if (!isActive()) {
                        props.onSelectAccount(acc);
                      }
                    }}
                  >
                    <div class="flex items-center gap-2 min-w-0 flex-1">
                      <ProfileAvatar email={acc.email} displayName={acc.displayName} size="xs" />
                      <div class="min-w-0 flex flex-col">
                        <span class="truncate font-medium text-[#2B2C2D] dark:text-[#ECEBE8]">{acc.email}</span>
                        <span class="text-[10px] text-[#878A8E] capitalize">
                          {acc.privacyMode === "private" ? "Private Mailbox" : "Org-Managed"}
                        </span>
                      </div>
                    </div>

                    <div class="flex items-center gap-1">
                      {isActive() && (
                        <svg class="w-3.5 h-3.5 text-[#A27561] dark:text-[#D5A795] stroke-current fill-none stroke-[2] flex-shrink-0" viewBox="0 0 24 24">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                      <Show when={hasMultipleAccounts()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsOpen(false);
                            props.onSignOut(acc.id, false);
                          }}
                          title={`Sign out of ${acc.email}`}
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

          <div class="border-t border-[#E2DFD8] my-1"></div>

          {/* Add Another Mailbox Button */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              props.onOpenAddMailbox();
            }}
            class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-[#A27561] hover:bg-[#F3ECE8] transition cursor-pointer text-left"
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
                class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 transition cursor-pointer text-left"
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
              class="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-[#3C3D3E] hover:bg-[#F0EEE9] dark:hover:bg-[#2A2A2E] transition cursor-pointer text-left"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span class="truncate">Sign out of {props.currentEmail.split("@")[0]}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                props.onSignOut(undefined, true);
              }}
              class="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium text-rose-600 hover:bg-rose-50 transition cursor-pointer text-left"
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
