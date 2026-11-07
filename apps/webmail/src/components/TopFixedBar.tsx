import { Component, Show, createSignal, createEffect, onMount } from "solid-js";

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
  const isDark = () => props.theme === "dark";

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
      class="@container w-full h-12 min-h-[48px] px-1 sm:px-2 bg-[#F0EEE9] dark:bg-[#18191D] border-b-0 flex items-center justify-between gap-2 sm:gap-3 select-none flex-shrink-0 transition-colors"
    >
      {/* ── LEFT: Mobile Menu Toggle + Search Bar ── */}
      <div class="flex items-center gap-2 flex-1 min-w-0 max-w-[480px]">
        {/* Mobile Sidebar Hamburger Toggle */}
        <Show when={props.onOpenMobileMenu}>
          <button
            type="button"
            onClick={props.onOpenMobileMenu}
            class="md:hidden flex items-center justify-center w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] transition cursor-pointer flex-shrink-0 shadow-2xs"
            title="Open navigation menu"
            aria-label="Open navigation menu"
            data-testid="top-bar-mobile-menu-btn"
          >
            <svg class="w-5 h-5 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </Show>

        {/* Search Bar */}
        <div data-testid="search-bar" class="relative flex-1 min-w-0">
          <input
            id="webmail-search-input"
            type="text"
            data-testid={props.activeModule === "calendar" ? "calendar-search-input" : "top-fixed-search-input"}
            data-testid-search="top-fixed-search-input"
            placeholder={searchPlaceholder()}
            value={props.searchQuery || ""}
            onInput={(e) => props.onSearchChange?.(e.currentTarget.value)}
            class="w-full h-9 min-h-[36px] rounded-xl border border-[#E2DFD8] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] pl-8.5 pr-8 text-xs sm:text-sm text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)] focus:outline-none focus:border-[#9E725F] focus:ring-1 focus:ring-[#9E725F]/30 transition-all duration-150 leading-normal"
          />
          <svg
            class="w-3.5 h-3.5 text-[#878A8E] absolute left-2.5 top-1/2 -translate-y-1/2 stroke-current fill-none stroke-[1.8] pointer-events-none"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <Show
            when={props.searchQuery}
            fallback={
              <kbd class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none hidden sm:inline-flex items-center gap-0.5 text-xs font-mono text-[#878A8E] bg-[#EAE7E0]/70 dark:bg-[#2A2D35]/70 px-1.5 py-0.5 rounded border border-[#DDD9D0]/80 dark:border-[#383B44]/80 leading-none select-none">
                /
              </kbd>
            }
          >
            <button
              type="button"
              onClick={() => props.onSearchChange?.("")}
              class="absolute right-2 top-1/2 -translate-y-1/2 text-[#6E7075] dark:text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] cursor-pointer w-8 h-8 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 active:scale-90 transition-all duration-100"
              title="Clear search"
              aria-label="Clear search"
            >
              <svg class="w-3 h-3 stroke-current fill-none stroke-[2]" viewBox="0 0 24 24">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Show>
        </div>
      </div>

      {/* ── RIGHT: Consolidated Module Switcher & Appearance Controls ── */}
      <div
        data-testid="right-utility-bar"
        class="flex items-center gap-1 sm:gap-2 flex-shrink-0"
      >
        {/* Module Switcher Segmented Control (Emails, Calendar, Notes) */}
        <nav
          aria-label="Module Switcher"
          data-testid="top-bar-module-switcher"
          class="relative hidden lg:grid grid-cols-3 p-0.5 rounded-xl bg-[#EAE7E0] dark:bg-[#202227] border border-[#DDD9D0] dark:border-[#2E3138] shadow-2xs isolate select-none"
        >
          {/* Authentic, GPU-accelerated background highlight pill element */}
          <div
            data-testid="right-bar-morphing-pill"
            class="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/3)] pointer-events-none rounded-lg bg-white dark:bg-[#2D2522] border border-[#9E725F]/30 dark:border-[#E2B7A3]/30 shadow-xs transition-transform duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform z-0"
            style={{
              transform: `translateX(${
                props.activeModule === "mail"
                  ? "0%"
                  : props.activeModule === "calendar"
                  ? "100%"
                  : "200%"
              })`,
            }}
          />

          {/* 1. Emails Module */}
          <button
            type="button"
            onClick={() => props.onSwitchModule?.("mail")}
            data-testid="nav-emails-tab"
            title="Emails (Mailbox)"
            aria-label="Switch to Emails"
            aria-selected={props.activeModule === "mail"}
            class={`relative z-10 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]/40 active:scale-95 min-h-[36px] h-9 ${
              props.activeModule === "mail"
                ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
                : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
            }`}
          >
            <span data-testid="right-bar-emails-btn" class="inline-flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span class="hidden sm:inline">Emails</span>
            </span>
          </button>

          {/* 2. Calendar Module */}
          <button
            type="button"
            onClick={() => props.onSwitchModule?.("calendar")}
            data-testid="nav-calendar-tab"
            title="Calendar"
            aria-label="Switch to Calendar"
            aria-selected={props.activeModule === "calendar"}
            class={`relative z-10 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]/40 active:scale-95 min-h-[36px] h-9 ${
              props.activeModule === "calendar"
                ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
                : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
            }`}
          >
            <span data-testid="right-bar-calendar-btn" class="inline-flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <span class="hidden sm:inline">Calendar</span>
            </span>
          </button>

          {/* 3. Notes Module */}
          <button
            type="button"
            onClick={() => props.onSwitchModule?.("notes")}
            data-testid="nav-notes-tab"
            title="Notes"
            aria-label="Switch to Notes"
            aria-selected={props.activeModule === "notes"}
            class={`relative z-10 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]/40 active:scale-95 min-h-[36px] h-9 ${
              props.activeModule === "notes"
                ? "text-[#9E725F] dark:text-[#E2B7A3] font-semibold"
                : "text-[#6E7075] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6]"
            }`}
          >
            <span data-testid="right-bar-notes-btn" class="inline-flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 stroke-current fill-none stroke-[1.8] flex-shrink-0" viewBox="0 0 24 24">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span class="hidden sm:inline">Notes</span>
            </span>
          </button>
        </nav>

        {/* 4. Appearance & UI Customizer Toggle (Palette Icon - ONLY shown when activeModule === "mail") */}
        <Show when={props.activeModule === "mail"}>
          {/* Vertical divider */}
          <div class="h-5 w-[1px] bg-[#DDD9D0] dark:bg-[#2E3138] mx-0.5 sm:mx-1 flex-shrink-0" />

          <button
            type="button"
            onClick={() => props.onToggleCustomizer?.()}
            data-testid="top-bar-appearance-btn"
            data-customizer-toggle="true"
            aria-expanded={props.isCustomizerOpen}
            aria-label="Toggle UI Appearance and Customizer Panel"
            title={props.isCustomizerOpen ? "Close UI Customizer (Esc)" : "Customize Appearance & Themes"}
            class={`relative w-9 h-9 min-w-[36px] min-h-[36px] rounded-xl border flex items-center justify-center transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]/40 active:scale-95 shadow-2xs ${
              props.isCustomizerOpen
                ? "bg-[#F3ECE8] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#E2B7A3] font-semibold border-[#9E725F]/40"
                : "border-[#DDD9D0] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#252830]"
            }`}
          >
            <span data-testid="ui-customizer-toggle" class="inline-flex items-center justify-center w-full h-full">
              <span data-testid="right-bar-appearance-btn" class="relative inline-flex items-center justify-center w-4 h-4">
                {/* Palette Icon: rotates 90 degrees and fades out when customizer is open */}
                <svg
                  class={`absolute inset-0 w-4 h-4 stroke-current fill-none stroke-[1.8] transform transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    props.isCustomizerOpen
                      ? "opacity-0 rotate-90 scale-75 pointer-events-none"
                      : "opacity-100 rotate-0 scale-100"
                  }`}
                  viewBox="0 0 24 24"
                >
                  <circle cx="13.5" cy="6.5" r="1.5" />
                  <circle cx="17.5" cy="10.5" r="1.5" />
                  <circle cx="8.5" cy="7.5" r="1.5" />
                  <circle cx="6.5" cy="12.5" r="1.5" />
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 9.5 10c.8 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.4-.4-.8-.4-1.4 0-1.1.9-2 2-2h2.3c3.6 0 6.5-2.9 6.5-6.5C23 6 18 2 12 2z" />
                </svg>

                {/* Close 'X' Icon: cross-fades and counter-rotates in when customizer is open */}
                <svg
                  class={`absolute inset-0 w-4 h-4 stroke-current fill-none stroke-[2] transform transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    props.isCustomizerOpen
                      ? "opacity-100 rotate-0 scale-100"
                      : "opacity-0 -rotate-90 scale-75 pointer-events-none"
                  }`}
                  viewBox="0 0 24 24"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>

                {/* Animated active indicator badge */}
                <span
                  class={`absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full bg-[#9E725F] dark:bg-[#E2B7A3] transition-all duration-200 ease-out ${
                    props.isCustomizerOpen ? "scale-100 opacity-100" : "scale-0 opacity-0"
                  }`}
                />
              </span>
            </span>
          </button>
        </Show>

        {/* Vertical divider before Theme Toggle when palette is hidden */}
        <Show when={props.activeModule !== "mail"}>
          <div class="h-5 w-[1px] bg-[#DDD9D0] dark:bg-[#2E3138] mx-0.5 sm:mx-1 flex-shrink-0" />
        </Show>

        {/* 5. Theme Toggle (Light / Dark Mode Switcher) */}
        <button
          type="button"
          onClick={() => props.onToggleTheme?.()}
          data-testid="top-bar-theme-toggle"
          aria-label={isDark() ? "Switch to Light Mode" : "Switch to Dark Mode"}
          title={isDark() ? "Light Mode (Cloud Dancer)" : "Dark Mode"}
          class="w-9 h-9 min-w-[36px] min-h-[36px] rounded-xl border border-[#DDD9D0] dark:border-[#2E3138] bg-white dark:bg-[#1E2025] flex items-center justify-center text-[#55575B] dark:text-[#A1A1AA] hover:text-[#1A1B1E] dark:hover:text-[#F3F4F6] hover:bg-[#F0EEE9] dark:hover:bg-[#252830] transition-all duration-150 ease-out cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#9E725F]/40 active:scale-95 shadow-2xs"
        >
          <span data-testid="right-bar-theme-toggle" class="inline-flex items-center justify-center w-full h-full">
            <Show
              when={isDark()}
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
          </span>
        </button>
      </div>
    </div>
  );
};
