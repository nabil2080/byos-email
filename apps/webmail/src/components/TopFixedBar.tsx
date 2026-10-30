import { Component, Show } from "solid-js";

export type AppModule = "mail" | "calendar" | "notes";

export interface TopFixedBarProps {
  activeModule: AppModule;
  onSwitchModule?: (module: AppModule) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onOpenContacts?: () => void;
  onOpenMobileMenu?: () => void;
  isOnline?: boolean;
  isCustomizerOpen?: boolean;
  onToggleCustomizer?: () => void;
  theme?: string;
  onToggleTheme?: () => void;
}

export const TopFixedBar: Component<TopFixedBarProps> = (props) => {
  const searchPlaceholder = () => {
    switch (props.activeModule) {
      case "calendar":
        return "Search calendar…";
      case "notes":
        return "Search notes…";
      case "mail":
      default:
        return "Search emails";
    }
  };

  return (
    <div
      data-testid="top-fixed-bar"
      class="@container w-full h-14 min-h-[56px] px-2.5 sm:px-4 bg-white dark:bg-[#18191D] border-b border-[#E2DFD8] dark:border-[#2A2D35] flex items-center justify-between gap-1.5 sm:gap-3 select-none flex-shrink-0 z-20 transition-colors"
    >
      {/* ── LEFT: Mobile Menu + Search Bar ── */}
      <div class="flex items-center gap-2 flex-1 min-w-0 max-w-[560px]">
        {/* Mobile Sidebar Hamburger Toggle */}
        <Show when={props.onOpenMobileMenu}>
          <button
            type="button"
            onClick={props.onOpenMobileMenu}
            class="md:hidden flex items-center justify-center w-8.5 h-8.5 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F5] dark:bg-[#1E2025] text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] transition cursor-pointer flex-shrink-0 shadow-2xs"
            title="Open navigation menu"
            aria-label="Open navigation menu"
            data-testid="top-bar-mobile-menu-btn"
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </Show>

        {/* Search Bar matching Attachment 1 */}
        <div data-testid="search-bar" class="relative flex-1 min-w-0">
          <input
            id="webmail-search-input"
            type="text"
            data-testid={props.activeModule === "calendar" ? "calendar-search-input" : "top-fixed-search-input"}
            data-testid-search="top-fixed-search-input"
            placeholder={searchPlaceholder()}
            value={props.searchQuery || ""}
            onInput={(e) => props.onSearchChange?.(e.currentTarget.value)}
            class="w-full h-9 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F5] dark:bg-[#1E2025] pl-9 pr-10 text-xs sm:text-sm text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] focus:outline-none focus:border-[#9E725F] focus:ring-2 focus:ring-[#9E725F]/20 transition-all duration-150 leading-normal"
          />
          <svg
            class="w-4 h-4 text-[#878A8E] absolute left-3 top-1/2 -translate-y-1/2 stroke-current fill-none stroke-[1.8] pointer-events-none"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <Show
            when={props.searchQuery}
            fallback={
              <kbd class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none hidden sm:inline-flex items-center gap-0.5 text-[10px] font-mono text-[#878A8E] bg-[#EAE7E0]/70 dark:bg-[#2A2D35]/70 px-1.5 py-0.5 rounded border border-[#DDD9D0]/80 dark:border-[#383B44]/80 leading-none select-none">
                /
              </kbd>
            }
          >
            <button
              type="button"
              onClick={() => props.onSearchChange?.("")}
              class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6E7075] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] cursor-pointer p-0.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 active:scale-90 transition-all duration-100"
              title="Clear search"
              aria-label="Clear search"
            >
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>
      </div>

      {/* ── RIGHT: UI Customizer & Light/Dark Mode Switcher ── */}
      <div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
        {/* Appearance & UI Customizer Toggle (Artist Painting Palette Icon) */}
        <button
          type="button"
          onClick={() => props.onToggleCustomizer?.()}
          data-testid="top-bar-appearance-btn"
          data-testid-secondary="theme-customizer-btn"
          aria-expanded={props.isCustomizerOpen}
          aria-label="Toggle UI Appearance and Customizer Panel"
          title={props.isCustomizerOpen ? "Close UI Customizer (Esc)" : "Customize Appearance & Themes"}
          class={`relative w-9 h-9 rounded-xl border flex items-center justify-center transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 shadow-2xs ${
            props.isCustomizerOpen
              ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#E2B7A3] font-semibold border-[#9E725F]/40"
              : "border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F5] dark:bg-[#1E2025] text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#252830]"
          }`}
        >
          <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
            <circle cx="13.5" cy="6.5" r="1.5" />
            <circle cx="17.5" cy="10.5" r="1.5" />
            <circle cx="8.5" cy="7.5" r="1.5" />
            <circle cx="6.5" cy="12.5" r="1.5" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 9.5 10c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.4-.8-.4-1.4 0-1.1.9-2 2-2h2.3c3.6 0 6.5-2.9 6.5-6.5C23 6 18 2 12 2z" />
          </svg>
          <Show when={props.isCustomizerOpen}>
            <span class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#9E725F]" />
          </Show>
        </button>

        {/* Single-Icon Light / Dark Mode Toggle */}
        <button
          type="button"
          onClick={() => props.onToggleTheme?.()}
          data-testid="top-bar-theme-toggle"
          data-testid-secondary="theme-toggle-btn"
          aria-label={props.theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          title={props.theme === "dark" ? "Light Mode (Cloud Dancer)" : "Dark Mode"}
          class="w-9 h-9 rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-[#FAF9F5] dark:bg-[#1E2025] flex items-center justify-center text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#9E725F]/40 active:scale-95 shadow-2xs"
        >
          <Show
            when={props.theme === "dark"}
            fallback={
              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            }
          >
            <svg class="w-4 h-4 stroke-current fill-none stroke-[1.8]" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          </Show>
        </button>
      </div>
    </div>
  );
};
