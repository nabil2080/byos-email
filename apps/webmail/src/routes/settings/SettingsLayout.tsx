import { Component, JSX, For } from "solid-js";
import { Mailbox, UserMe } from "../../api";

export type SettingsTabId =
  | "account"
  | "signatures"
  | "masked-email"
  | "bridge"
  | "autoreply"
  | "filters"
  | "security"
  | "import";

interface SettingsTabItem {
  id: SettingsTabId;
  label: string;
  icon: JSX.Element;
  description: string;
}

export interface SettingsCategoryGroup {
  category: string;
  tabs: SettingsTabItem[];
}

interface SettingsLayoutProps {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  onClose: () => void;
  selectedMailbox: Mailbox | null;
  currentUser: UserMe | null;
  children: JSX.Element;
}

export const SettingsLayout: Component<SettingsLayoutProps> = (props) => {
  const categories: SettingsCategoryGroup[] = [
    {
      category: "Account & Security",
      tabs: [
        {
          id: "account",
          label: "Account",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          ),
          description: "Language, display, and account preferences",
        },
        {
          id: "security",
          label: "Security & Sessions",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          ),
          description: "Password, 2FA, passkeys, and recovery",
        },
        {
          id: "signatures",
          label: "Signatures & Identities",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
              <line x1="16" y1="8" x2="2" y2="22" />
              <line x1="17.5" y1="15" x2="9" y2="15" />
            </svg>
          ),
          description: "Display names, aliases, and signatures",
        },
      ],
    },
    {
      category: "Mail & Rules",
      tabs: [
        {
          id: "filters",
          label: "Filters & Rules",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          ),
          description: "Custom rules, Sieve, and allow/block lists",
        },
        {
          id: "autoreply",
          label: "Auto-Reply",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ),
          description: "Automatic vacation responder rules",
        },
        {
          id: "masked-email",
          label: "Masked Email",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ),
          description: "Burner aliases that forward securely to inbox",
        },
      ],
    },
    {
      category: "Integrations & Access",
      tabs: [
        {
          id: "bridge",
          label: "Desktop & Mobile Apps",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          ),
          description: "IMAP/SMTP credentials for Thunderbird & Apple Mail",
        },
        {
          id: "import",
          label: "Mailbox Import",
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          ),
          description: "Zero-knowledge import from Gmail or Outlook",
        },
      ],
    },
  ];

  return (
    <div
      data-testid="settings-layout"
      class="h-screen w-screen bg-[#FAF9F6] dark:bg-[#18191D] text-[#1A1B1E] dark:text-[#F3F4F6] flex flex-col overflow-hidden font-sans"
    >
      {/* Settings Top Bar */}
      <header class="h-14 bg-[#FAF9F6] dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35] px-4 sm:px-6 flex items-center justify-between flex-shrink-0 select-none">
        <div class="flex items-center gap-4">
          <button
            type="button"
            onClick={props.onClose}
            data-testid="settings-back-to-inbox-btn"
            class="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-xs font-semibold text-[#1A1B1E] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition shadow-2xs cursor-pointer"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Back to Inbox</span>
          </button>
          <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2A2D35]"></div>
          <div class="flex items-center gap-2.5">
            <div class="w-6 h-6 rounded-xl bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30">
              B
            </div>
            <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">BYOS Mail</span>
            <span class="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] border border-[#A27561]/20">
              Settings
            </span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="text-right hidden sm:block">
            <div class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              {props.selectedMailbox?.local_part}@{props.currentUser?.email.split("@")[1] || "byos.local"}
            </div>
            <div class="text-[10px] text-[#6E7075] dark:text-[#878A8E] font-mono capitalize">
              {props.selectedMailbox?.mode === "private" ? "Private Mailbox" : "Org-Managed"}
            </div>
          </div>
          <div class="w-8 h-8 rounded-xl bg-[#A27561] text-white flex items-center justify-center font-bold text-xs shadow-2xs ring-1 ring-[#A27561]/30">
            {(props.currentUser?.email?.[0] || "U").toUpperCase()}
          </div>
        </div>
      </header>

      {/* Main Settings Body with Categorized Sidebar */}
      <div class="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* Categorized Navigation Sidebar */}
        <aside
          data-testid="settings-sidebar"
          class="w-full md:w-68 bg-[#F0EEE9] dark:bg-[#18191D] border-b md:border-b-0 md:border-r border-[#E2DFD8] dark:border-[#2A2D35] flex flex-col p-2.5 sm:p-4 flex-shrink-0 select-none"
        >
          <div class="px-2 py-1 mb-1 hidden md:block">
            <h2 class="text-xs font-bold text-[#6E7075] dark:text-[#878A8E] uppercase tracking-wider font-mono">
              Settings Categories
            </h2>
          </div>

          <nav class="flex flex-row md:flex-col gap-2 md:gap-3 overflow-x-auto no-scrollbar flex-1 pb-1 md:pb-0 overflow-y-auto">
            <For each={categories}>
              {(cat) => (
                <div class="flex flex-row md:flex-col gap-1 md:gap-1 shrink-0 md:shrink">
                  <div class="hidden md:block px-2.5 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[#878A8E] dark:text-[#878A8E]">
                    {cat.category}
                  </div>
                  <For each={cat.tabs}>
                    {(tab) => {
                      const isActive = () => props.activeTab === tab.id;
                      return (
                        <button
                          type="button"
                          onClick={() => props.onTabChange(tab.id)}
                          data-testid={`settings-tab-${tab.id}`}
                          class={`flex-shrink-0 md:w-full text-left px-3 py-2 md:p-2.5 rounded-xl transition-all duration-150 flex items-center md:items-start gap-2 md:gap-2.5 cursor-pointer min-h-[36px] ${
                            isActive()
                              ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-semibold shadow-2xs"
                              : "bg-transparent text-[#464748] dark:text-[#878A8E] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#2A2D35]/50 font-medium"
                          }`}
                        >
                          <span class={`flex-shrink-0 mt-0.5 ${isActive() ? "text-[#A27561] dark:text-[#D4A38F]" : "text-[#6E7075] dark:text-[#878A8E]"}`}>
                            {tab.icon}
                          </span>
                          <div class="min-w-0">
                            <div class="text-xs font-semibold truncate leading-snug whitespace-nowrap md:whitespace-normal">{tab.label}</div>
                            <div class="text-[10px] text-[#6E7075] dark:text-[#878A8E] truncate leading-tight mt-0.5 hidden md:block">
                              {tab.description}
                            </div>
                          </div>
                        </button>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </nav>

          <div class="hidden md:block p-3 mt-3 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] text-[11px] text-[#6E7075] dark:text-[#878A8E] shadow-2xs">
            <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] block mb-0.5">Security & Encryption</span>
            Client-side keys protect your privacy. Settings are encrypted and isolated per mailbox.
          </div>
        </aside>

        {/* Tab Content Panel */}
        <main class="flex-1 bg-[#FAF9F6] dark:bg-[#18191D] overflow-y-auto p-3 sm:p-6 md:p-8 custom-scrollbar">
          <div class="max-w-4xl mx-auto">{props.children}</div>
        </main>
      </div>
    </div>
  );
};
