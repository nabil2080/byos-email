import { Component, JSX, For, createSignal, Show, createEffect } from "solid-js";
import { Mailbox, UserMe } from "../../api";
import { TopFixedBar, AppModule } from "../../components/TopFixedBar";
import { t } from "../../utils/i18n";

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
  keywords: string[];
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
  theme?: string;
  onToggleTheme?: () => void;
  onSwitchModule?: (mod: AppModule) => void;
  isOnline?: boolean;
  onOpenContacts?: () => void;
}

export const SettingsLayout: Component<SettingsLayoutProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [mobileMenuOpen, setMobileMenuOpen] = createSignal(false);

  const categories = (): SettingsCategoryGroup[] => [
    {
      category: t("Account & Security"),
      tabs: [
        {
          id: "account",
          label: t("Account"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          ),
          description: t("First name, last name, display name, language, theme, and time format"),
          keywords: [
            "first name",
            "last name",
            "display name",
            "name",
            "email",
            "language",
            "time",
            "time format",
            "date",
            "clock",
            "format",
            "12h",
            "24h",
            "profile",
            "identity",
            "regional",
            "localization",
            "theme",
            "themes",
            "appearance",
            "dark mode",
            "light mode",
            "color",
            "mode",
          ],
        },
        {
          id: "security",
          label: t("Security & Sessions"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          ),
          description: t("Password, 2FA, passkeys, and recovery"),
          keywords: [
            "password",
            "change password",
            "2fa",
            "two-factor",
            "totp",
            "passkey",
            "passkeys",
            "webauthn",
            "recovery",
            "keys",
            "backup",
            "session",
            "sessions",
            "device",
            "devices",
            "security",
            "phrase",
            "fingerprint",
          ],
        },
        {
          id: "signatures",
          label: t("Signatures"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
              <line x1="16" y1="8" x2="2" y2="22" />
              <line x1="17.5" y1="15" x2="9" y2="15" />
            </svg>
          ),
          description: t("Rich email signatures, WYSIWYG editor, and reply defaults"),
          keywords: [
            "signature",
            "signatures",
            "sign",
            "formatting",
            "rich text",
            "wysiwyg",
            "compose signature",
            "footer",
            "reply signature",
            "auto-reply signature",
          ],
        },
      ],
    },
    {
      category: t("Mail & Rules"),
      tabs: [
        {
          id: "filters",
          label: t("Filters & Rules"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
          ),
          description: t("Custom rules, Sieve, and allow/block lists"),
          keywords: [
            "filters",
            "rules",
            "sieve",
            "block",
            "allow",
            "whitelist",
            "blacklist",
            "auto sort",
            "spam",
            "forwarding",
            "criteria",
          ],
        },
        {
          id: "autoreply",
          label: t("Auto-Reply"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          ),
          description: t("Automatic vacation responder rules"),
          keywords: [
            "autoreply",
            "auto-reply",
            "vacation",
            "out of office",
            "responder",
            "absence",
            "automatic reply",
            "date range",
          ],
        },
        {
          id: "masked-email",
          label: t("Masked Email"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          ),
          description: t("Burner aliases that forward securely to inbox"),
          keywords: [
            "masked email",
            "alias",
            "aliases",
            "burner",
            "forwarding",
            "hide email",
            "privacy",
            "disposable",
          ],
        },
      ],
    },
    {
      category: t("Integrations & Access"),
      tabs: [
        {
          id: "bridge",
          label: t("Desktop & Mobile Apps"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          ),
          description: t("IMAP/SMTP credentials for Thunderbird & Apple Mail"),
          keywords: [
            "bridge",
            "imap",
            "smtp",
            "thunderbird",
            "apple mail",
            "outlook",
            "apps",
            "desktop",
            "mobile",
            "credentials",
            "port",
            "host",
          ],
        },
        {
          id: "import",
          label: t("Mailbox Import"),
          icon: (
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5]" viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          ),
          description: t("Zero-knowledge import from Gmail or Outlook"),
          keywords: [
            "import",
            "migrate",
            "migration",
            "gmail",
            "outlook",
            "mbox",
            "eml",
            "transfer",
            "oauth",
            "importing",
          ],
        },
      ],
    },
  ];

  const allTabs = () => categories().flatMap((c) => c.tabs);

  // Live Settings Search Filtering across title, description, and keywords
  const filteredCategories = () => {
    const q = searchQuery().trim().toLowerCase();
    if (!q) return categories();

    return categories()
      .map((cat) => ({
        ...cat,
        tabs: cat.tabs.filter((t) => {
          const matchLabel = t.label.toLowerCase().includes(q);
          const matchDesc = t.description.toLowerCase().includes(q);
          const matchKey = t.keywords.some((k) => k.toLowerCase().includes(q) || q.includes(k.toLowerCase()));
          return matchLabel || matchDesc || matchKey;
        }),
      }))
      .filter((cat) => cat.tabs.length > 0);
  };

  const matchingTabs = () => filteredCategories().flatMap((c) => c.tabs);

  return (
    <div
      data-testid="settings-layout"
      class="flex flex-col h-full h-[100dvh] max-h-dvh w-full max-w-full overflow-hidden bg-[#F0EEE9] dark:bg-[#121316] text-[#1A1B1E] dark:text-[#F3F4F6] font-sans p-1.5 sm:p-3 gap-1.5 sm:gap-3"
    >
      {/* Mobile Sidebar Navigation Drawer */}
      <Show when={mobileMenuOpen()}>
        <div
          class="fixed inset-0 bg-black/40 backdrop-blur-xs z-50 md:hidden transition-opacity"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
        <div class="fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#F0EEE9] dark:bg-[#18191D] z-50 md:hidden shadow-2xl flex flex-col p-3 transition-transform duration-200">
          <div class="flex items-center justify-between pb-3 border-b border-[#E2DFD8] dark:border-[#2A2D35]">
            <div class="flex items-center gap-2">
              <div class="w-6 h-6 rounded-xl bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs">
                B
              </div>
              <span class="text-sm font-semibold tracking-tight">BYOS Mail</span>
              <span class="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F]">
                {t("Settings")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              class="w-8 h-8 flex items-center justify-center rounded-lg text-[#6E7075] hover:text-[#1A1B1E] dark:text-[#878A8E] dark:hover:text-[#F3F4F6]"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="py-3">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                props.onClose();
              }}
              data-testid="settings-back-to-inbox-btn-mobile"
              class="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-xs font-semibold text-[#1A1B1E] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition shadow-2xs cursor-pointer"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>{t("Back to Inbox")}</span>
            </button>
          </div>

          <nav class="flex-1 overflow-y-auto space-y-3 custom-scrollbar py-2">
            <For each={filteredCategories()}>
              {(cat) => (
                <div class="space-y-1">
                  <div class="px-2 text-[10px] font-bold uppercase tracking-wider text-[#878A8E]">
                    {cat.category}
                  </div>
                  <For each={cat.tabs}>
                    {(tab) => (
                      <button
                        type="button"
                        onClick={() => {
                          props.onTabChange(tab.id);
                          setMobileMenuOpen(false);
                        }}
                        data-testid={`settings-tab-${tab.id}`}
                        class={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2.5 transition ${
                          props.activeTab === tab.id
                            ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-semibold shadow-2xs"
                            : "text-[#464748] dark:text-[#878A8E] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#2A2D35]/50 font-medium"
                        }`}
                      >
                        <span class="flex-shrink-0">{tab.icon}</span>
                        <div class="min-w-0 flex-1">
                          <div class="text-xs font-semibold truncate">{tab.label}</div>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              )}
            </For>
          </nav>
        </div>
      </Show>

      {/* Main Container with Sidebar + Content Column matching Mailbox */}
      <div class="flex flex-1 min-w-0 min-h-0 h-full overflow-hidden gap-0 sm:gap-2.5 lg:gap-3">
        {/* ── Left Settings Navigation Sidebar (Matching Sidebar.tsx dimensions & styles) ── */}
        <aside
          data-testid="settings-sidebar"
          class="hidden md:flex w-full md:w-64 flex-shrink-0 bg-[#F0EEE9] dark:bg-[#18191D] flex-col justify-between select-none h-full relative"
        >
          {/* Top Brand Header & Clean Back to Inbox Action */}
          <div class="p-2 pb-2 relative z-50 overflow-visible space-y-2 flex-shrink-0">
            <div class="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
              <div class="flex items-center gap-2">
                <div class="w-6 h-6 rounded-xl bg-[#A27561] flex items-center justify-center text-white font-bold text-xs shadow-2xs tracking-wider ring-1 ring-[#A27561]/30">
                  B
                </div>
                <span class="text-sm font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] tracking-tight">BYOS Mail</span>
              </div>
              <span class="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] border border-[#A27561]/20">
                {t("Settings")}
              </span>
            </div>

            {/* Back to Inbox Action Button (Original clean, understated design restored) */}
            <button
              type="button"
              onClick={props.onClose}
              data-testid="settings-back-to-inbox-btn"
              class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#1E2025] text-xs font-semibold text-[#1A1B1E] dark:text-[#E2DFD8] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition shadow-2xs cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#A27561]/40"
            >
              <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
              <span>{t("Back to Inbox")}</span>
            </button>
          </div>

          {/* Categorized Settings Tabs Navigation list */}
          <div class="flex-1 overflow-y-auto px-2 py-1 space-y-3 custom-scrollbar">
            <Show
              when={filteredCategories().length > 0}
              fallback={
                <div class="p-4 text-center text-xs text-[#878A8E] space-y-2">
                  <p>{t("No settings matching \"{q}\"", { q: searchQuery().trim() })}</p>
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    class="text-xs text-[#A27561] font-semibold hover:underline cursor-pointer"
                  >
                    {t("Clear filter")}
                  </button>
                </div>
              }
            >
              <For each={filteredCategories()}>
                {(cat) => (
                  <div class="space-y-1">
                    <div class="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#878A8E]">
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
                            class={`w-full text-left px-3 py-2 rounded-xl transition-all duration-150 flex items-center gap-2.5 cursor-pointer min-h-[36px] ${
                              isActive()
                                ? "bg-[#F2E8E2] dark:bg-[#2D2522] text-[#A27561] dark:text-[#D4A38F] font-semibold shadow-2xs"
                                : "bg-transparent text-[#464748] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/50 dark:hover:bg-[#2A2D35]/50 font-medium"
                            }`}
                          >
                            <span
                              class={`flex-shrink-0 ${
                                isActive() ? "text-[#A27561] dark:text-[#D4A38F]" : "text-[#6E7075] dark:text-[#878A8E]"
                              }`}
                            >
                              {tab.icon}
                            </span>
                            <div class="min-w-0 flex-1">
                              <div class="text-xs font-semibold truncate leading-snug">{tab.label}</div>
                              <div class="text-[10px] text-[#6E7075] dark:text-[#878A8E] truncate leading-tight mt-0.5">
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
            </Show>
          </div>

          {/* Bottom Security Footer badge matching Sidebar style */}
          <div class="p-2 pt-2 border-t border-[#E2DFD8]/60 dark:border-[#2A2D35]/60 flex-shrink-0">
            <div class="p-2.5 bg-white dark:bg-[#1E2025] rounded-xl border border-[#E2DFD8] dark:border-[#2A2D35] text-[11px] text-[#6E7075] dark:text-[#878A8E] shadow-2xs">
              <span class="font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] block mb-0.5">
                {t("Security & Privacy")}
              </span>
              <span class="text-[10px] leading-tight block">
                {t("Client-side zero-knowledge encryption isolates all mailbox settings.")}
              </span>
            </div>
          </div>
        </aside>

        {/* ── Right Content Column: TopFixedBar + Workspace Card ── */}
        <div class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden gap-1.5 sm:gap-2">
          {/* Top Bar: Module switcher removed; search connected to settings function search */}
          <TopFixedBar
            activeModule="mail"
            hideModuleSwitcher={true}
            searchPlaceholder={t("Search settings (e.g. password, signature, language)...")}
            searchQuery={searchQuery()}
            onSearchChange={setSearchQuery}
            onOpenContacts={props.onOpenContacts}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            isOnline={props.isOnline}
            theme={props.theme}
            onToggleTheme={props.onToggleTheme}
          />

          {/* Live Settings Function Search Results Dropdown Preview */}
          <Show when={searchQuery().trim().length > 0}>
            <div
              data-testid="settings-search-results-dropdown"
              class="relative z-40 px-4 py-3 rounded-2xl bg-white dark:bg-[#1C1E23] border border-[#E2DFD8] dark:border-[#2A2D35] shadow-lg space-y-2 animate-in fade-in duration-150 flex-shrink-0"
            >
              <div class="flex items-center justify-between text-xs text-[#6E7075] dark:text-[#878A8E]">
                <span>
                  {t("Settings search results for \"{q}\":", { q: searchQuery().trim() })}
                </span>
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  class="text-[11px] font-semibold text-[#A27561] hover:underline cursor-pointer"
                >
                  {t("Clear")}
                </button>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                <For each={matchingTabs()}>
                  {(tab) => (
                    <button
                      type="button"
                      data-testid={`settings-search-result-${tab.id}`}
                      onClick={() => {
                        props.onTabChange(tab.id);
                        setSearchQuery("");
                      }}
                      class="flex items-start gap-2.5 p-2 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F7] dark:bg-[#18191D] hover:border-[#A27561] hover:bg-[#F2E8E2]/50 dark:hover:bg-[#2D2522]/50 transition text-left cursor-pointer group"
                    >
                      <span class="p-1 rounded-lg bg-white dark:bg-[#2A2D35] text-[#A27561] dark:text-[#D4A38F] flex-shrink-0 mt-0.5">
                        {tab.icon}
                      </span>
                      <div class="min-w-0">
                        <div class="text-xs font-semibold text-[#1A1B1E] dark:text-[#F3F4F6] group-hover:text-[#A27561]">
                          {tab.label}
                        </div>
                        <div class="text-[10px] text-[#6E7075] dark:text-[#878A8E] truncate">
                          {tab.description}
                        </div>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Mobile Tab Bar (When screen is small and drawer is closed) */}
          <div class="md:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar px-1 py-0.5 flex-shrink-0">
            <For each={matchingTabs()}>
              {(tab) => (
                <button
                  type="button"
                  onClick={() => props.onTabChange(tab.id)}
                  data-testid={`settings-mobile-tab-${tab.id}`}
                  class={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex-shrink-0 transition ${
                    props.activeTab === tab.id
                      ? "bg-[#A27561] text-white shadow-2xs"
                      : "bg-white dark:bg-[#1E2025] border border-[#E2DFD8] dark:border-[#2A2D35] text-[#6E7075] dark:text-[#878A8E]"
                  }`}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>

          {/* ── Main Workspace Card (Exact same styling as Mailbox Workspace Card) ── */}
          <div class="flex-1 min-w-0 min-h-0 flex overflow-hidden">
            <div class="flex-1 rounded-2xl border border-[#E2DFD8] dark:border-[#2A2D35] bg-white dark:bg-[#18191D] shadow-2xs overflow-hidden flex flex-col min-w-0 min-h-0">
              {/* Main Scrollable Content */}
              <main
                class="flex-1 bg-white dark:bg-[#18191D] overflow-y-auto p-4 sm:p-6 md:p-8 custom-scrollbar min-h-0"
                data-testid="settings-main-content"
              >
                <div class="max-w-4xl mx-auto">{props.children}</div>
              </main>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
