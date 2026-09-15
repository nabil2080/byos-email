import { Component, JSX, For } from "solid-js";
import { UserMe, Mailbox } from "../../api";

export type SettingsTabId = "signatures" | "bridge" | "appearance" | "autoreply" | "filters" | "security";

interface SettingsLayoutProps {
  activeTab: SettingsTabId;
  onTabChange: (tab: SettingsTabId) => void;
  onClose: () => void;
  currentUser: UserMe | null;
  selectedMailbox: Mailbox | null;
  children: JSX.Element;
}

export const SettingsLayout: Component<SettingsLayoutProps> = (props) => {
  const tabs: { id: SettingsTabId; label: string; icon: JSX.Element; description: string }[] = [
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
      description: "Display names, aliases, and rich email signatures",
    },
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
      description: "IMAP/SMTP credentials for Thunderbird, Apple Mail, Outlook",
    },
    {
      id: "appearance",
      label: "Appearance",
      icon: (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="21" x2="9" y2="9" />
        </svg>
      ),
      description: "Inbox density, split-pane layout, language, and color palettes",
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
      id: "filters",
      label: "Filters & Rules",
      icon: (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      ),
      description: "Custom filters, Sieve scripts, and Spam/Block/Allow lists",
    },
    {
      id: "security",
      label: "Security & Sessions",
      icon: (
        <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
      description: "Password, 2FA, key exports, and session audit",
    },
  ];

  return (
    <div class="h-screen w-screen bg-[#F0EEE9] dark:bg-[#121316] text-[#1A1B1E] dark:text-[#F3F4F6] flex flex-col overflow-hidden font-sans">
      {/* Settings Top Bar */}
      <header class="h-14 bg-white dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2E3138] px-6 flex items-center justify-between flex-shrink-0">
        <div class="flex items-center gap-4">
          <button
            onClick={props.onClose}
            class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#E2DFD8] dark:border-[#2E3138] text-xs font-medium text-[#464748] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition cursor-pointer"
          >
            <span>←</span>
            <span>Back to Inbox</span>
          </button>
          <div class="h-4 w-px bg-[#E2DFD8] dark:bg-[#2E3138]"></div>
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">BYOS</span>
            <span class="text-[11px] uppercase tracking-widest bg-[#A27561] text-white px-2 py-0.5 rounded font-mono font-medium">
              Settings
            </span>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="text-right hidden sm:block">
            <div class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6]">
              {props.selectedMailbox?.local_part}@{props.currentUser?.email.split("@")[1] || "byos.local"}
            </div>
            <div class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA] font-mono capitalize">
              {props.selectedMailbox?.mode === "private" ? "Private Mailbox" : "Org-Managed"}
            </div>
          </div>
          <div class="w-8 h-8 rounded-full bg-[#A27561] text-white flex items-center justify-center font-bold text-xs">
            {(props.currentUser?.email?.[0] || "U").toUpperCase()}
          </div>
        </div>
      </header>

      {/* Main Settings Body with Secondary Sidebar */}
      <div class="flex flex-1 overflow-hidden">
        {/* Navigation Tabs Sidebar */}
        <aside class="w-72 bg-white dark:bg-[#18191D] border-r border-[#E2DFD8] dark:border-[#2E3138] flex flex-col p-4 flex-shrink-0">
          <div class="px-2 py-1 mb-2">
            <h2 class="text-xs font-bold text-[#6E7075] dark:text-[#A1A1AA] uppercase tracking-wider font-mono">
              Mailbox Settings
            </h2>
          </div>
          <nav class="space-y-1.5 flex-1">
            <For each={tabs}>
              {(tab) => {
                const isActive = () => props.activeTab === tab.id;
                return (
                  <button
                    onClick={() => props.onTabChange(tab.id)}
                    class={`w-full text-left p-3 rounded-xl transition flex items-start gap-3 border cursor-pointer ${
                      isActive()
                        ? "bg-[#F3ECE8] dark:bg-[#2D2522] border-[#A27561] text-[#A27561] dark:text-[#D4A38F] shadow-xs"
                        : "bg-transparent border-transparent text-[#464748] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830]"
                    }`}
                  >
                    <span class={`flex-shrink-0 mt-0.5 ${isActive() ? "text-[#A27561] dark:text-[#D4A38F]" : "text-[#6E7075] dark:text-[#A1A1AA]"}`}>
                      {tab.icon}
                    </span>
                    <div class="min-w-0">
                      <div class="text-xs font-semibold truncate leading-snug">{tab.label}</div>
                      <div class="text-[10px] text-[#6E7075] dark:text-[#A1A1AA] truncate leading-tight mt-0.5">
                        {tab.description}
                      </div>
                    </div>
                  </button>
                );
              }}
            </For>
          </nav>

          <div class="p-3 bg-[#F8F7F4] dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] text-[11px] text-[#6E7075] dark:text-[#A1A1AA]">
            <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] block mb-0.5">Security & Encryption</span>
            Client-side keys protect your privacy. Settings are encrypted and isolated per mailbox.
          </div>
        </aside>

        {/* Tab Content Panel */}
        <main class="flex-1 bg-[#F0EEE9] dark:bg-[#121316] overflow-y-auto p-6 sm:p-8">
          <div class="max-w-3xl mx-auto">{props.children}</div>
        </main>
      </div>
    </div>
  );
};
